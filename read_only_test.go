package main

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
)

func activeSnapshot2() (string, string, []string) {
	p, d := activeSnapshot()
	return p, d, recentsSnapshot()
}

func chmodPath(t *testing.T, path string, mode os.FileMode) {
	t.Helper()
	if err := os.Chmod(path, mode); err != nil {
		t.Fatalf("chmod %s %o: %v", path, mode, err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o644) })
}

func TestReadOnlyFilePolicyAndSaveRefusal(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "protected.md")
	const content = "protected content"
	baseRev := writeDoc(t, doc, content)
	chmodPath(t, doc, 0o444)
	before, err := os.Stat(doc)
	if err != nil {
		t.Fatal(err)
	}
	setActive(t, doc)

	// Metadata: readable snapshot, real read_only flag, revision unchanged by the
	// protection policy (read_only is not part of the content fingerprint).
	status, initBody := env.init(t)
	if status != http.StatusOK {
		t.Fatalf("/api/init: %d %v", status, initBody)
	}
	if initBody["read_only"] != true || initBody["file_revision"] != baseRev || initBody["file_content"] != content {
		t.Fatalf("init metadata for a 0444 file: %v", initBody)
	}
	status, fileBody := env.file(t, doc)
	if status != http.StatusOK || fileBody["read_only"] != true || fileBody["revision"] != baseRev {
		t.Fatalf("/api/file metadata for a 0444 file: %d %v", status, fileBody)
	}
	status, statBody := env.stat(t, doc)
	if status != http.StatusOK || statBody["read_only"] != true || statBody["revision"] != baseRev {
		t.Fatalf("/api/stat metadata for a 0444 file: %d %v", status, statBody)
	}
	// Snapshot of the protected state now that the allowed reads are done.
	beforePath, beforeDir, beforeRecents := activeSnapshot2()

	// Save is refused, also with an explicit force (reserved for content
	// conflicts, not for permissions).
	for _, body := range []map[string]interface{}{
		{"path": doc, "content": "overwrite", "expected_revision": baseRev},
		{"path": doc, "content": "overwrite", "expected_revision": baseRev, "force": true},
	} {
		status, resp := env.save(t, body)
		if status != http.StatusForbidden || errorCode(resp) != "read_only" {
			t.Fatalf("save on a read-only file: status=%d body=%v", status, resp)
		}
	}

	after, err := os.Stat(doc)
	if err != nil {
		t.Fatal(err)
	}
	if got := readDoc(t, doc); got != content {
		t.Fatalf("refused save changed the content: %q", got)
	}
	if after.Mode() != before.Mode() {
		t.Fatalf("refused save changed the mode: %v -> %v", before.Mode(), after.Mode())
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatalf("refused save changed the mtime: %v -> %v", before.ModTime(), after.ModTime())
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestReadOnlySourceCannotBeRenamed(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "protected.md")
	baseRev := writeDoc(t, src, "protected source")
	chmodPath(t, src, 0o444)
	dest := filepath.Join(dir, "dest.md")
	sub := filepath.Join(dir, "new-folder")
	beforePath, beforeDir, beforeRecents := setActive(t, src)

	cases := []map[string]interface{}{
		{"old_path": src, "new_path": dest, "content": "moved", "expected_revision": baseRev},
		{"old_path": src, "new_path": dest, "content": "moved", "expected_revision": baseRev, "overwrite": true},
		{"old_path": src, "new_path": src, "content": "rewritten", "expected_revision": baseRev},
		{"old_path": src, "new_path": src, "content": "rewritten", "expected_revision": baseRev, "overwrite": true},
		{"old_path": src, "new_path": filepath.Join(sub, "nested.md"), "content": "moved", "expected_revision": baseRev},
	}
	for _, body := range cases {
		status, resp := env.rename(t, body)
		if status != http.StatusForbidden || errorCode(resp) != "read_only" {
			t.Fatalf("rename of a protected source: status=%d body=%v", status, resp)
		}
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("a refused rename must not create the destination")
	}
	if _, err := os.Stat(sub); !os.IsNotExist(err) {
		t.Fatal("a refused rename must not create destination folders")
	}
	if got := readDoc(t, src); got != "protected source" {
		t.Fatalf("source changed by a refused rename: %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestProtectedDestinationCannotBeReplaced(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "source.md")
	srcRev := writeDoc(t, src, "source content")
	dest := filepath.Join(dir, "dest.md")
	const destContent = "protected destination"
	writeDoc(t, dest, destContent)
	chmodPath(t, dest, 0o444)

	cases := []map[string]interface{}{
		// Copy flow (empty source) with overwrite consent.
		{"old_path": "", "new_path": dest, "content": "copy", "overwrite": true},
		// Rename onto the protected destination with overwrite consent.
		{"old_path": src, "new_path": dest, "content": "copy", "expected_revision": srcRev, "overwrite": true},
	}
	for _, body := range cases {
		status, resp := env.rename(t, body)
		if status != http.StatusForbidden || errorCode(resp) != "read_only" {
			t.Fatalf("protected destination: status=%d body=%v", status, resp)
		}
	}
	if got := readDoc(t, dest); got != destContent {
		t.Fatalf("protected destination was replaced: %q", got)
	}
	if got := readDoc(t, src); got != "source content" {
		t.Fatalf("source changed by a refused rename: %q", got)
	}
}

func TestProtectedSourceCanBeCopiedToWritableDestination(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "protected.md")
	const srcContent = "protected source"
	writeDoc(t, src, srcContent)
	chmodPath(t, src, 0o444)
	dest := filepath.Join(dir, "copy.md")

	// The copy flow reuses /api/rename with an empty old_path: the source is
	// never written or removed, the destination is a new document.
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "new_path": dest, "content": "edited copy",
	})
	if status != http.StatusOK {
		t.Fatalf("copy from a protected source: status=%d body=%v", status, body)
	}
	if body["read_only"] != false {
		t.Fatalf("a newly written copy must be writable: %v", body)
	}
	if rev, _ := body["revision"].(string); rev != contentRevision([]byte("edited copy")) {
		t.Fatalf("copy revision mismatch: %v", body)
	}
	if got := readDoc(t, src); got != srcContent {
		t.Fatalf("copy flow changed the protected source: %q", got)
	}
	if got := readDoc(t, dest); got != "edited copy" {
		t.Fatalf("copy destination content mismatch: %q", got)
	}
	status, statBody := env.stat(t, dest)
	if status != http.StatusOK || statBody["read_only"] != false {
		t.Fatalf("the copy destination must be writable: %d %v", status, statBody)
	}
	if got := readDoc(t, src); got != srcContent {
		t.Fatalf("source removed by the copy flow: %q", got)
	}
}

func TestWritableFileStillSavesAndPreservesMode(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "writable.md")
	rev := writeDoc(t, doc, "v1")

	status, body := env.save(t, map[string]interface{}{
		"path": doc, "content": "v2", "expected_revision": rev,
	})
	if status != http.StatusOK {
		t.Fatalf("writable file save: %d %v", status, body)
	}
	rev2, _ := body["revision"].(string)

	// 0640 is preserved by the atomic write (no accidental 0600/0644).
	chmodPath(t, doc, 0o640)
	status, body = env.save(t, map[string]interface{}{
		"path": doc, "content": "v3", "expected_revision": rev2,
	})
	if status != http.StatusOK {
		t.Fatalf("save with mode 0640: %d %v", status, body)
	}
	fi, err := os.Stat(doc)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o640 {
		t.Fatalf("mode not preserved: %v", fi.Mode().Perm())
	}
	status, statBody := env.stat(t, doc)
	if status != http.StatusOK || statBody["read_only"] != false {
		t.Fatalf("0640 file must stay writable: %d %v", status, statBody)
	}
}

func TestStatDetectsProtectionChangeWithSameContent(t *testing.T) {
	env := newBoundaryTestEnv(t)
	doc := filepath.Join(t.TempDir(), "mode.md")
	writeDoc(t, doc, "same bytes")
	chmodPath(t, doc, 0o644)

	status, before := env.stat(t, doc)
	if status != http.StatusOK || before["read_only"] != false {
		t.Fatalf("initial stat: %d %v", status, before)
	}
	rev := revOfField(t, before, "revision")

	chmodPath(t, doc, 0o444)
	status, after := env.stat(t, doc)
	if status != http.StatusOK {
		t.Fatalf("stat after chmod: %d", status)
	}
	if after["read_only"] != true {
		t.Fatalf("a protection change with unchanged content must be visible in stat: %v", after)
	}
	if revOfField(t, after, "revision") != rev {
		t.Fatal("read_only must not change the content revision")
	}
}

func TestWriteFailureAfterPreflightIsNotSuccess(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: directory permissions do not deny writes")
	}
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	locked := filepath.Join(dir, "locked")
	if err := os.Mkdir(locked, 0o755); err != nil {
		t.Fatal(err)
	}
	doc := filepath.Join(locked, "doc.md")
	rev := writeDoc(t, doc, "v1")

	// The file itself is writable (0644) but the atomic write needs the directory.
	if err := os.Chmod(locked, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o755) })
	status, body := env.save(t, map[string]interface{}{
		"path": doc, "content": "v2", "expected_revision": rev,
	})
	if status != http.StatusForbidden || errorCode(body) != "write_forbidden" {
		t.Fatalf("save in a non-writable directory: status=%d body=%v", status, body)
	}
	if got := readDoc(t, doc); got != "v1" {
		t.Fatalf("failed save changed the content: %q", got)
	}

	// Same for a rename into that directory: the source is preserved.
	src := filepath.Join(dir, "src.md")
	srcRev := writeDoc(t, src, "source")
	status, body = env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": filepath.Join(locked, "new.md"),
		"content": "moved", "expected_revision": srcRev,
	})
	if status != http.StatusForbidden || errorCode(body) != "write_forbidden" {
		t.Fatalf("rename into a non-writable directory: status=%d body=%v", status, body)
	}
	if got := readDoc(t, src); got != "source" {
		t.Fatalf("failed rename changed the source: %q", got)
	}
	if _, err := os.Stat(filepath.Join(locked, "new.md")); !os.IsNotExist(err) {
		t.Fatal("failed rename created the destination")
	}
}

func TestRenameExistingDestinationWithLockedSourceIsRefused(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires non-privileged POSIX directory permission enforcement")
	}
	env := newBoundaryTestEnv(t)
	srcDir := filepath.Join(t.TempDir(), "locked-source")
	if err := os.Mkdir(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(srcDir, "source.md")
	rev := writeDoc(t, src, "source content")
	dest := filepath.Join(t.TempDir(), "existing.md")
	writeDoc(t, dest, "keep me")
	if err := os.Chmod(srcDir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(srcDir, 0o755) })

	// Even with the destination overwrite consent, the source must be removable
	// for a rename: refuse before touching the existing destination.
	status, body := env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "moved",
		"expected_revision": rev, "overwrite": true,
	})
	if status != http.StatusForbidden || errorCode(body) != "write_forbidden" {
		t.Fatalf("rename with a non-removable source: status=%d body=%v", status, body)
	}
	if got := readDoc(t, dest); got != "keep me" {
		t.Fatalf("existing destination changed by a refused rename: %q", got)
	}
	if got := readDoc(t, src); got != "source content" {
		t.Fatalf("source changed by a refused rename: %q", got)
	}
}

func TestRemoveSourceEntryPropagatesPermissionFailure(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires non-privileged POSIX directory permission enforcement")
	}
	dir := filepath.Join(t.TempDir(), "locked")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(dir, "source.md")
	writeDoc(t, src, "content")
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	// The helper used after the destination write must return the real failure
	// instead of ignoring it; the source is still there.
	removed, err := removeSourceEntry(src, filepath.Join(t.TempDir(), "dest.md"))
	if removed || err == nil {
		t.Fatalf("removal failure was ignored: removed=%v err=%v", removed, err)
	}
	if _, statErr := os.Stat(src); statErr != nil {
		t.Fatalf("source disappeared after a failed removal: %v", statErr)
	}

	// Once the directory allows it, the same helper removes the entry.
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	removed, err = removeSourceEntry(src, filepath.Join(t.TempDir(), "dest.md"))
	if !removed || err != nil {
		t.Fatalf("removal should succeed now: removed=%v err=%v", removed, err)
	}
	if _, statErr := os.Stat(src); !os.IsNotExist(statErr) {
		t.Fatal("source was not removed")
	}
}

func TestSourceRemovalPreflightPolicy(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows directory mode bits are synthetic")
	}
	dir := filepath.Join(t.TempDir(), "src")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	doc := filepath.Join(dir, "a.md")
	writeDoc(t, doc, "x")
	if allowed, reason := sourceRemovalPreflight(doc); !allowed {
		t.Fatalf("a writable directory must pass the preflight: %s", reason)
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	if allowed, reason := sourceRemovalPreflight(doc); allowed || reason == "" {
		t.Fatalf("a 0555 directory must be refused with a reason: allowed=%v reason=%q", allowed, reason)
	}
}

func TestWriteFailureStatusMapsReadOnlyFilesystem(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("EROFS is POSIX-specific")
	}
	direct := &os.PathError{Op: "open", Path: "/readonly/new.md", Err: syscall.EROFS}
	wrapped := fmt.Errorf("mkdir: %w", direct)
	for _, err := range []error{direct, wrapped} {
		status, code := writeFailureStatus(err)
		if status != http.StatusForbidden || code != "write_forbidden" {
			t.Fatalf("EROFS must be a write refusal: %d %q (%v)", status, code, err)
		}
	}
	// Generic I/O errors must not be flattened into permission refusals.
	status, code := writeFailureStatus(errors.New("disk full"))
	if status != http.StatusInternalServerError || code != "write_failed" {
		t.Fatalf("generic I/O error mapping: %d %q", status, code)
	}
}
