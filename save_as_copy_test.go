package main

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// A copy (Save As) sends old_path:"" plus an explicit source_path. The
// destination must never be the source itself, and the source is never written
// or removed by the copy flow.

func TestCopyRejectsSourceAsDestination(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "source.md")
	writeDoc(t, src, "source content")
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	beforePath, beforeDir, beforeRecents := setActive(t, src)

	cases := []string{
		src, // identical cleaned path
		filepath.Join(dir, "sub", "..", "source.md"), // equivalent segments
	}
	for _, dest := range cases {
		status, body := env.rename(t, map[string]interface{}{
			"old_path": "", "source_path": src, "new_path": dest, "content": "buffer text",
		})
		if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
			t.Fatalf("copy onto the source (%q): status=%d body=%v", dest, status, body)
		}
		if got := readDoc(t, src); got != "source content" {
			t.Fatalf("the source changed: %q", got)
		}
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestCopyRejectsSymlinkAndHardLinkAliases(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink/hardlink creation needs POSIX privileges in this environment")
	}
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "source.md")
	writeDoc(t, src, "source content")
	beforePath, beforeDir, beforeRecents := setActive(t, src)

	link := filepath.Join(dir, "alias.md")
	if err := os.Symlink(src, link); err != nil {
		t.Skipf("cannot create symlink: %v", err)
	}
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": link, "content": "buffer",
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Fatalf("symlink alias: status=%d body=%v", status, body)
	}

	hard := filepath.Join(dir, "hard.md")
	if err := os.Link(src, hard); err != nil {
		t.Skipf("cannot create hard link: %v", err)
	}
	// Hard links are refused conservatively as source aliases (documented).
	status, body = env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": hard, "content": "buffer",
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Fatalf("hard-link alias: status=%d body=%v", status, body)
	}
	if got := readDoc(t, src); got != "source content" {
		t.Fatalf("the source changed: %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestCopyFromChangedOrMissingSource(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "source.md")
	writeDoc(t, src, "original")

	// The source changed externally: the copy still writes the buffer, and the
	// source is neither reverted nor removed.
	writeDoc(t, src, "changed externally")
	dest := filepath.Join(dir, "copy.md")
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer text",
	})
	if status != http.StatusOK {
		t.Fatalf("copy from a changed source: status=%d body=%v", status, body)
	}
	if got := readDoc(t, dest); got != "buffer text" {
		t.Fatalf("copy content mismatch: %q", got)
	}
	if got := readDoc(t, src); got != "changed externally" {
		t.Fatalf("copy altered the source: %q", got)
	}
	if revOfField(t, body, "revision") != contentRevision([]byte("buffer text")) {
		t.Fatal("copy response revision mismatch")
	}

	// A source that disappeared can still be copied from the buffer.
	if err := os.Remove(src); err != nil {
		t.Fatal(err)
	}
	dest2 := filepath.Join(dir, "copy2.md")
	status, body = env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest2, "content": "from buffer",
	})
	if status != http.StatusOK {
		t.Fatalf("copy from a missing source: status=%d body=%v", status, body)
	}
	if got := readDoc(t, dest2); got != "from buffer" {
		t.Fatalf("copy content mismatch: %q", got)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("a copy must not recreate the missing source")
	}
}

func TestCopyDestinationExistingRequiresConsent(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "source.md")
	writeDoc(t, src, "source")
	dest := filepath.Join(dir, "dest.md")
	const destContent = "keep me"
	writeDoc(t, dest, destContent)

	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "copy",
	})
	if status != http.StatusConflict || conflictCode(body) != "target_exists" {
		t.Fatalf("existing destination without consent: status=%d body=%v", status, body)
	}
	if got := readDoc(t, dest); got != destContent {
		t.Fatalf("existing destination changed without consent: %q", got)
	}

	status, body = env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "copy", "overwrite": true,
	})
	if status != http.StatusOK {
		t.Fatalf("existing destination with consent: status=%d body=%v", status, body)
	}
	if got := readDoc(t, dest); got != "copy" {
		t.Fatalf("destination not replaced: %q", got)
	}
	if got := readDoc(t, src); got != "source" {
		t.Fatalf("copy removed/changed the source: %q", got)
	}
}

func TestCopyUnverifiableSourceIdentityFailsExplicitly(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires non-privileged POSIX directory permission enforcement")
	}
	env := newBoundaryTestEnv(t)
	root := t.TempDir()
	srcDir := filepath.Join(root, "hidden-source")
	if err := os.Mkdir(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(srcDir, "source.md")
	writeDoc(t, src, "source")
	// No execute bit: the source identity cannot be stat'ed (EACCES).
	if err := os.Chmod(srcDir, 0o666); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(srcDir, 0o755) })
	dest := filepath.Join(t.TempDir(), "copy.md")

	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer",
	})
	if status != http.StatusServiceUnavailable || errorCode(body) != "snapshot_unstable" {
		t.Fatalf("unverifiable source identity: status=%d body=%v", status, body)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("no destination may be created when the source identity is unverifiable")
	}
}

func TestCopyRejectsSourceLoopAndDanglingChains(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	t.Run("source symlink loop", func(t *testing.T) {
		env := newBoundaryTestEnv(t)
		dir := t.TempDir()
		src := filepath.Join(dir, "loop-source.md")
		if err := os.Symlink("loop-source.md", src); err != nil {
			t.Skipf("cannot create symlink: %v", err)
		}
		dest := filepath.Join(dir, "copy.md")
		status, body := env.rename(t, map[string]interface{}{
			"old_path": "", "source_path": src, "new_path": dest, "content": "buffer",
		})
		if status != http.StatusServiceUnavailable || errorCode(body) != "snapshot_unstable" {
			t.Fatalf("source loop: status=%d body=%v", status, body)
		}
		if _, err := os.Stat(dest); !os.IsNotExist(err) {
			t.Fatal("no destination may be created when the source identity is a loop")
		}
	})

	t.Run("short dangling chain", func(t *testing.T) {
		env := newBoundaryTestEnv(t)
		dir := t.TempDir()
		src := filepath.Join(dir, "source.md")
		if err := os.Symlink("hop.md", src); err != nil {
			t.Skipf("cannot create symlink: %v", err)
		}
		if err := os.Symlink("missing-target.md", filepath.Join(dir, "hop.md")); err != nil {
			t.Fatal(err)
		}
		// The copy would recreate the chain's final referent.
		dest := filepath.Join(dir, "missing-target.md")
		status, body := env.rename(t, map[string]interface{}{
			"old_path": "", "source_path": src, "new_path": dest, "content": "buffer",
		})
		if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
			t.Fatalf("dangling chain target: status=%d body=%v", status, body)
		}
		if _, err := os.Stat(dest); !os.IsNotExist(err) {
			t.Fatal("the dangling chain target must not be created")
		}
		if target, err := os.Readlink(src); err != nil || target != "hop.md" {
			t.Fatalf("source link changed: %q %v", target, err)
		}
	})
}

func TestCopyRejectsAliasThroughSymlinkedDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	root := t.TempDir()
	realDir := filepath.Join(root, "real")
	if err := os.Mkdir(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(realDir, "source.md")
	writeDoc(t, src, "source content")
	linkDir := filepath.Join(root, "linked")
	if err := os.Symlink(realDir, linkDir); err != nil {
		t.Skipf("cannot create symlink: %v", err)
	}

	// The source is addressed through a symlinked directory, the destination is
	// the same file via its real path: the identity is the same file.
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": filepath.Join(linkDir, "source.md"),
		"new_path": src, "content": "buffer",
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Fatalf("symlinked-directory alias: status=%d body=%v", status, body)
	}
	if got := readDoc(t, src); got != "source content" {
		t.Fatalf("source changed: %q", got)
	}
}

func TestCopyResolvesRelativeSourceTargetWithSymlinkBeforeDotDot(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	root := t.TempDir()
	realInside := filepath.Join(root, "real", "inside")
	if err := os.MkdirAll(realInside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(realInside, filepath.Join(root, "entry")); err != nil {
		t.Skipf("cannot create directory symlink: %v", err)
	}
	src := filepath.Join(root, "source.md")
	// The link target itself contains a symlinked component followed by `..`:
	// entry -> real/inside, so entry/.. must resolve to real (physical), not to
	// the fixture root by a lexical Clean of the Readlink text.
	linkTarget := "entry/../original.md"
	if err := os.Symlink(linkTarget, src); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(root, "real", "original.md")
	writeDoc(t, dest, "original content")
	if got := readDoc(t, src); got != "original content" {
		t.Fatalf("invalid fixture: readlink target does not refer to destination: %q", got)
	}
	beforePath, beforeDir, beforeRecents := setActive(t, src)

	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest,
		"content": "buffer text", "overwrite": true,
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Fatalf("copy onto the physical referent after `..`: status=%d body=%v", status, body)
	}
	if got := readDoc(t, dest); got != "original content" {
		t.Fatalf("original document changed: %q", got)
	}
	if target, err := os.Readlink(src); err != nil || target != linkTarget {
		t.Fatalf("source symlink changed: %q %v", target, err)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestCopyResolvesExistingPrefixOfDanglingSourceTarget(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	root := t.TempDir()
	realInside := filepath.Join(root, "real", "inside")
	if err := os.MkdirAll(realInside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(realInside, filepath.Join(root, "entry")); err != nil {
		t.Skipf("cannot create directory symlink: %v", err)
	}
	src := filepath.Join(root, "source.md")
	linkTarget := "entry/missing/original.md"
	if err := os.Symlink(linkTarget, src); err != nil {
		t.Fatal(err)
	}
	missingDir := filepath.Join(realInside, "missing")
	dest := filepath.Join(missingDir, "original.md")
	beforePath, beforeDir, beforeRecents := setActive(t, src)

	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer text",
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Fatalf("copy onto the missing referent of the source: status=%d body=%v", status, body)
	}
	if _, err := os.Lstat(missingDir); !os.IsNotExist(err) {
		t.Fatalf("copy created the missing parent of the source referent: %v", err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatalf("copy recreated the dangling source referent: %v", err)
	}
	if target, err := os.Readlink(src); err != nil || target != linkTarget {
		t.Fatalf("source symlink changed: %q %v", target, err)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestCopyDanglingDestinationNeedsConsentAndExplicitOverwriteReplacesOnlyTheEntry(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	root := t.TempDir()
	src := filepath.Join(root, "source.md")
	writeDoc(t, src, "source content")
	dest := filepath.Join(root, "destination.md")
	if err := os.Symlink("missing-target.md", dest); err != nil {
		t.Skipf("cannot create symlink: %v", err)
	}
	referent := filepath.Join(root, "missing-target.md")
	beforePath, beforeDir, beforeRecents := setActive(t, src)

	// The destination entry exists even though its referent does not: without
	// consent the link must not be replaced.
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer copy",
	})
	if status != http.StatusConflict || conflictCode(body) != "target_exists" {
		t.Fatalf("dangling destination without consent: status=%d body=%v", status, body)
	}
	if target, err := os.Readlink(dest); err != nil || target != "missing-target.md" {
		t.Fatalf("destination symlink was replaced without consent: %q %v", target, err)
	}
	if _, err := os.Lstat(referent); !os.IsNotExist(err) {
		t.Fatalf("destination referent was created without consent: %v", err)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)

	// Explicit consent replaces the destination entry (the symlink itself), not
	// its referent, and never touches the source.
	status, body = env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest,
		"content": "buffer copy", "overwrite": true,
	})
	if status != http.StatusOK {
		t.Fatalf("explicit overwrite of a dangling destination: status=%d body=%v", status, body)
	}
	fi, err := os.Lstat(dest)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		t.Fatal("explicit overwrite left the dangling symlink in place")
	}
	if got := readDoc(t, dest); got != "buffer copy" {
		t.Fatalf("destination content mismatch: %q", got)
	}
	if _, err := os.Lstat(referent); !os.IsNotExist(err) {
		t.Fatalf("the dangling link's referent was created: %v", err)
	}
	if got := readDoc(t, src); got != "source content" {
		t.Fatalf("source changed: %q", got)
	}
}

func TestCopyRejectsDestinationThroughParentAliasOfSourceLink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	root := t.TempDir()
	realDir := filepath.Join(root, "real")
	if err := os.Mkdir(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	referent := filepath.Join(realDir, "original.md")
	writeDoc(t, referent, "original content")
	entry := filepath.Join(root, "entry.md")
	if err := os.Symlink("real", entry); err != nil {
		t.Skipf("cannot create directory symlink: %v", err)
	}
	src := filepath.Join(root, "source.md")
	if err := os.Symlink("entry.md/original.md", src); err != nil {
		t.Fatal(err)
	}
	// The destination names the same symlink entry through another alias of its
	// parent directory: a string-prefix comparison would miss it.
	parentAlias := filepath.Join(root, "parent-alias")
	if err := os.Symlink(root, parentAlias); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(parentAlias, "entry.md")
	beforePath, beforeDir, beforeRecents := setActive(t, src)

	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest,
		"content": "buffer text", "overwrite": true,
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Fatalf("copy through a parent alias of the source link: status=%d body=%v", status, body)
	}
	if target, err := os.Readlink(entry); err != nil || target != "real" {
		t.Fatalf("directory symlink used by the source changed: %q %v", target, err)
	}
	if got, err := os.ReadFile(src); err != nil || string(got) != "original content" {
		t.Fatalf("source is no longer readable with the original content: %q %v", got, err)
	}
	if got := readDoc(t, referent); got != "original content" {
		t.Fatalf("original bytes changed: %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}
