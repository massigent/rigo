package main

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// A snapshot failure is not a successfully opened empty document. The active
// path can be replaced externally between launch/selection and the init read.
func TestReviewInitDoesNotHideSnapshotReadFailure(t *testing.T) {
	env := newBoundaryTestEnv(t)
	doc := filepath.Join(t.TempDir(), "replaced.md")
	writeDoc(t, doc, "original document")
	setActive(t, doc)
	if err := os.Remove(doc); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(doc, 0o755); err != nil {
		t.Fatal(err)
	}
	status, body := env.init(t)
	if status == http.StatusOK {
		t.Fatalf("snapshot read failed, but init returned a successful empty document: %v", body)
	}
	if status != http.StatusServiceUnavailable || errorCode(body) != "snapshot_unstable" {
		t.Fatalf("expected explicit snapshot failure consistent with /api/file, got %d: %v", status, body)
	}
}
