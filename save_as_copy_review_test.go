package main

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestReviewCopyUnverifiableDestinationIdentityFailsWithoutEffects(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "source.md")
	writeDoc(t, src, "source content")
	dest := filepath.Join(dir, "loop.md")
	if err := os.Symlink("loop.md", dest); err != nil {
		t.Skipf("cannot create symlink: %v", err)
	}
	beforePath, beforeDir, beforeRecents := setActive(t, src)
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer text",
	})
	if status != http.StatusServiceUnavailable || errorCode(body) != "snapshot_unstable" {
		t.Errorf("unverifiable destination must fail explicitly, got %d: %v", status, body)
	}
	if target, err := os.Readlink(dest); err != nil || target != "loop.md" {
		t.Errorf("destination was replaced without verified identity or consent: %q %v", target, err)
	}
	if got := readDoc(t, src); got != "source content" {
		t.Errorf("source changed: %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestReviewCopyCannotRecreateDanglingSourceAtItsTarget(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "source.md")
	dest := filepath.Join(dir, "missing-target.md")
	if err := os.Symlink("missing-target.md", src); err != nil {
		t.Skipf("cannot create symlink: %v", err)
	}
	beforePath, beforeDir, beforeRecents := setActive(t, src)
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer text", "overwrite": true,
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Errorf("copy target is the dangling source's referent, got %d: %v", status, body)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Errorf("copy recreated the original document through its dangling symlink: %v", err)
	}
	if target, err := os.Readlink(src); err != nil || target != "missing-target.md" {
		t.Errorf("source symlink changed: %q %v", target, err)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestReviewCopyResolvesRelativeSourceLinkFromPhysicalParent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	realDir := filepath.Join(dir, "real", "inside")
	if err := os.MkdirAll(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	entry := filepath.Join(dir, "entry")
	if err := os.Symlink(realDir, entry); err != nil {
		t.Skipf("cannot create directory symlink: %v", err)
	}
	src := filepath.Join(entry, "source.md")
	dest := filepath.Join(dir, "real", "original.md")
	writeDoc(t, dest, "original content")
	if err := os.Symlink("../original.md", src); err != nil {
		t.Fatal(err)
	}
	if got := readDoc(t, src); got != "original content" {
		t.Fatalf("invalid fixture: source does not refer to destination: %q", got)
	}
	beforePath, beforeDir, beforeRecents := setActive(t, src)
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer text", "overwrite": true,
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Errorf("copy onto the source's actual referent must fail, got %d: %v", status, body)
	}
	if got := readDoc(t, src); got != "original content" {
		t.Errorf("original document was overwritten through its referent: %q", got)
	}
	if target, err := os.Readlink(src); err != nil || target != "../original.md" {
		t.Errorf("source symlink changed: %q %v", target, err)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestReviewCopyResolvesExistingPrefixOfMissingParents(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	realDir := filepath.Join(dir, "real")
	if err := os.Mkdir(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(realDir, filepath.Join(dir, "entry")); err != nil {
		t.Skipf("cannot create directory symlink: %v", err)
	}
	src := filepath.Join(dir, "source.md")
	linkTarget := filepath.Join("entry", "missing", "original.md")
	if err := os.Symlink(linkTarget, src); err != nil {
		t.Fatal(err)
	}
	missingDir := filepath.Join(realDir, "missing")
	dest := filepath.Join(missingDir, "original.md")
	beforePath, beforeDir, beforeRecents := setActive(t, src)
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer text",
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Errorf("copy onto the dangling source's nested referent must fail, got %d: %v", status, body)
	}
	if _, err := os.Lstat(missingDir); !os.IsNotExist(err) {
		t.Errorf("copy created a missing parent of the original document: %v", err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Errorf("copy recreated the original document: %v", err)
	}
	if target, err := os.Readlink(src); err != nil || target != linkTarget {
		t.Errorf("source symlink changed: %q %v", target, err)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestReviewCopyDoesNotReplaceDistinctDanglingDestinationWithoutConsent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink creation")
	}
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "source.md")
	writeDoc(t, src, "original content")
	dest := filepath.Join(dir, "destination.md")
	if err := os.Symlink("missing-target.md", dest); err != nil {
		t.Skipf("cannot create symlink: %v", err)
	}
	beforePath, beforeDir, beforeRecents := setActive(t, src)
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer text",
	})
	if status != http.StatusConflict || conflictCode(body) != "target_exists" {
		t.Errorf("replacing an existing destination entry requires consent, got %d: %v", status, body)
	}
	if target, err := os.Readlink(dest); err != nil || target != "missing-target.md" {
		t.Errorf("destination symlink was replaced without consent: %q %v", target, err)
	}
	if _, err := os.Lstat(filepath.Join(dir, "missing-target.md")); !os.IsNotExist(err) {
		t.Errorf("destination referent was unexpectedly created: %v", err)
	}
	if got := readDoc(t, src); got != "original content" {
		t.Errorf("original document changed: %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestReviewCopyCannotReplaceDirectoryLinkNeededBySource(t *testing.T) {
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
	dest := filepath.Join(root, "entry.md")
	if err := os.Symlink("real", dest); err != nil {
		t.Skipf("cannot create directory symlink: %v", err)
	}
	src := filepath.Join(root, "source.md")
	if err := os.Symlink("entry.md/original.md", src); err != nil {
		t.Fatal(err)
	}
	if got := readDoc(t, src); got != "original content" {
		t.Fatalf("invalid fixture: source is not readable through the directory link: %q", got)
	}
	beforePath, beforeDir, beforeRecents := setActive(t, src)
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "source_path": src, "new_path": dest, "content": "buffer text", "overwrite": true,
	})
	if status != http.StatusConflict || conflictCode(body) != "copy_same_source" {
		t.Errorf("copy may not replace an entry needed to access the source, got %d: %v", status, body)
	}
	if target, err := os.Readlink(dest); err != nil || target != "real" {
		t.Errorf("directory symlink used by the source changed: %q %v", target, err)
	}
	if got, err := os.ReadFile(src); err != nil || string(got) != "original content" {
		t.Errorf("source is no longer readable with the original content: %q %v", got, err)
	}
	if got := readDoc(t, referent); got != "original content" {
		t.Errorf("original bytes changed: %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}
