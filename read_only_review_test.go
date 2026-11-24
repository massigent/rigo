package main

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
)

// Rename needs removal rights in the source directory, not only write access
// to the source file. Never report success when that removal actually failed.
func TestReviewRenameDoesNotIgnoreSourceRemovalPermissionFailure(t *testing.T) {
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
	dest := filepath.Join(t.TempDir(), "moved.md")
	beforePath, beforeDir, beforeRecents := setActive(t, src)
	if err := os.Chmod(srcDir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(srcDir, 0o755) })

	status, body := env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "edited content", "expected_revision": rev,
	})
	if status == http.StatusOK {
		t.Errorf("source removal is denied, but rename reported success: %v", body)
	}
	if status != http.StatusForbidden || errorCode(body) != "write_forbidden" {
		t.Errorf("expected explicit permission failure, got %d: %v", status, body)
	}
	if got := readDoc(t, src); got != "source content" {
		t.Errorf("source changed: %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

// Other-class write bits let the coarse preflight pass, but the directory
// owner's permissions still forbid unlink. This exercises the real handler's
// post-write partial branch without races, mocks or production test hooks.
func TestReviewRenamePartialOutcomePreservesSourceAndActiveState(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires non-privileged POSIX directory permission enforcement")
	}
	env := newBoundaryTestEnv(t)
	srcDir := filepath.Join(t.TempDir(), "owner-cannot-unlink")
	if err := os.Mkdir(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(srcDir, "source.md")
	rev := writeDoc(t, src, "source content")
	dest := filepath.Join(t.TempDir(), "existing.md")
	writeDoc(t, dest, "previous target")
	beforePath, beforeDir, beforeRecents := setActive(t, src)
	if err := os.Chmod(srcDir, 0o577); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(srcDir, 0o755) })

	status, body := env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "edited content",
		"expected_revision": rev, "overwrite": true,
	})
	if status != http.StatusForbidden || errorCode(body) != "write_forbidden" || body["partial"] != true || body["success"] != false {
		t.Fatalf("expected explicit post-write partial refusal, got %d: %v", status, body)
	}
	if body["path"] != dest {
		t.Fatalf("partial outcome must identify the written destination: %v", body)
	}
	if got := readDoc(t, src); got != "source content" {
		t.Errorf("source changed: %q", got)
	}
	if got := readDoc(t, dest); got != "edited content" {
		t.Errorf("written destination was rolled back or misreported: %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestReviewReadOnlyFilesystemWriteErrorsArePermissionRefusals(t *testing.T) {
	err := &os.PathError{Op: "open", Path: "/readonly/new.md", Err: syscall.EROFS}
	status, code := writeFailureStatus(err)
	if status != http.StatusForbidden || code != "write_forbidden" {
		t.Fatalf("EROFS must be a write refusal, not a generic server failure: %d %q", status, code)
	}
}
