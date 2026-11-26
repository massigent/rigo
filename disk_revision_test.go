package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// --- helpers -------------------------------------------------------------

// do is goroutine-safe: it never calls testing.T (unlike boundaryTestEnv.request).
func (e *boundaryTestEnv) do(method, path, body string) (int, []byte, error) {
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, e.base+path, rdr)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("X-Rigo-Token", appToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, data, err
}

func decodeJSON(data []byte) map[string]interface{} {
	var out map[string]interface{}
	_ = json.Unmarshal(data, &out)
	return out
}

func (e *boundaryTestEnv) postJSON(t *testing.T, path string, body interface{}) (int, map[string]interface{}) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	status, data, err := e.do("POST", path, string(raw))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	return status, decodeJSON(data)
}

func (e *boundaryTestEnv) save(t *testing.T, body map[string]interface{}) (int, map[string]interface{}) {
	t.Helper()
	return e.postJSON(t, "/api/save", body)
}

func (e *boundaryTestEnv) rename(t *testing.T, body map[string]interface{}) (int, map[string]interface{}) {
	t.Helper()
	return e.postJSON(t, "/api/rename", body)
}

func (e *boundaryTestEnv) getJSON(t *testing.T, path string) (int, map[string]interface{}) {
	t.Helper()
	status, data, err := e.do("GET", path, "")
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	return status, decodeJSON(data)
}

func (e *boundaryTestEnv) stat(t *testing.T, path string) (int, map[string]interface{}) {
	t.Helper()
	return e.getJSON(t, "/api/stat?path="+url.QueryEscape(path))
}

func (e *boundaryTestEnv) file(t *testing.T, path string) (int, map[string]interface{}) {
	t.Helper()
	return e.getJSON(t, "/api/file?path="+url.QueryEscape(path))
}

func (e *boundaryTestEnv) init(t *testing.T) (int, map[string]interface{}) {
	t.Helper()
	return e.getJSON(t, "/api/init")
}

func writeDoc(t *testing.T, path, content string) string {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return contentRevision([]byte(content))
}

func readDoc(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

func activeSnapshot() (string, string) {
	activeFileMu.RLock()
	defer activeFileMu.RUnlock()
	return activePath, activeDir
}

func recentsSnapshot() []string {
	recentsMu.Lock()
	defer recentsMu.Unlock()
	return append([]string(nil), recentsList...)
}

func setActive(t *testing.T, path string) (string, string, []string) {
	t.Helper()
	activeFileMu.Lock()
	activePath = path
	activeDir = filepath.Dir(path)
	activeFileMu.Unlock()
	recentsMu.Lock()
	recentsList = nil
	recentsMu.Unlock()
	p, d := activeSnapshot()
	return p, d, recentsSnapshot()
}

func requireUnchangedState(t *testing.T, path, dir string, recents []string) {
	t.Helper()
	gotPath, gotDir := activeSnapshot()
	if gotPath != path || gotDir != dir {
		t.Fatalf("active document changed by a refused request: %q/%q -> %q/%q", path, dir, gotPath, gotDir)
	}
	gotRecents := recentsSnapshot()
	if len(gotRecents) != len(recents) {
		t.Fatalf("recents changed by a refused request: %v -> %v", recents, gotRecents)
	}
	for i := range recents {
		if gotRecents[i] != recents[i] {
			t.Fatalf("recents changed by a refused request: %v -> %v", recents, gotRecents)
		}
	}
}

func revOfField(t *testing.T, body map[string]interface{}, key string) string {
	t.Helper()
	v, ok := body[key].(string)
	if !ok || v == "" {
		t.Fatalf("missing string field %q in %v", key, body)
	}
	if !validDiskRevision(v) {
		t.Fatalf("field %q is not a disk revision: %q", key, v)
	}
	return v
}

func conflictCode(body map[string]interface{}) string {
	s, _ := body["conflict"].(string)
	return s
}

func errorCode(body map[string]interface{}) string {
	s, _ := body["error"].(string)
	return s
}

// --- revision snapshots ---------------------------------------------------

func TestInitAndFileSnapshotConsistency(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "snap.md")
	rev1 := writeDoc(t, doc, "# first\n")
	setActive(t, doc)

	status, initBody := env.init(t)
	if status != http.StatusOK {
		t.Fatalf("/api/init: %d", status)
	}
	content, _ := initBody["file_content"].(string)
	fileRev := revOfField(t, initBody, "file_revision")
	if fileRev != contentRevision([]byte(content)) {
		t.Fatal("init must return the revision of the content it returns")
	}
	if fileRev != rev1 {
		t.Fatalf("init revision %q != %q", fileRev, rev1)
	}

	// A new snapshot after an external edit is self-consistent too: content and
	// revision always describe the same read, never a mix of two versions.
	rev2 := writeDoc(t, doc, "# second version\n")
	status, fileBody := env.file(t, doc)
	if status != http.StatusOK {
		t.Fatalf("/api/file: %d", status)
	}
	content2, _ := fileBody["content"].(string)
	fileRev2 := revOfField(t, fileBody, "revision")
	if fileRev2 != contentRevision([]byte(content2)) || fileRev2 != rev2 {
		t.Fatal("/api/file must pair content and revision from the same snapshot")
	}
}

func TestStatRevisionDetectsSameMetadataChange(t *testing.T) {
	env := newBoundaryTestEnv(t)
	doc := filepath.Join(t.TempDir(), "stat.md")
	writeDoc(t, doc, "abcd")
	fi, err := os.Stat(doc)
	if err != nil {
		t.Fatal(err)
	}
	originalMod := fi.ModTime()

	status, body := env.stat(t, doc)
	if status != http.StatusOK {
		t.Fatalf("/api/stat: %d", status)
	}
	rev1 := revOfField(t, body, "revision")

	// Same size, restored mtime: metadata is identical, content is not.
	writeDoc(t, doc, "abce")
	if err := os.Chtimes(doc, originalMod, originalMod); err != nil {
		t.Fatal(err)
	}
	status, body = env.stat(t, doc)
	if status != http.StatusOK {
		t.Fatalf("/api/stat after rewrite: %d", status)
	}
	rev2 := revOfField(t, body, "revision")
	if rev1 == rev2 {
		t.Fatal("a same-size, same-mtime content change must change the revision")
	}

	// Identical content with changed metadata is not a content change: the
	// fingerprint is documented as content-only (no inode/generation tracking).
	if err := os.Chtimes(doc, originalMod.Add(-time.Hour), originalMod.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	status, body = env.stat(t, doc)
	if status != http.StatusOK {
		t.Fatalf("/api/stat after Chtimes: %d", status)
	}
	if got := revOfField(t, body, "revision"); got != rev2 {
		t.Fatalf("identical content must keep the revision: %q -> %q", rev2, got)
	}

	// A missing file is reported explicitly, not as an empty existing document.
	if err := os.Remove(doc); err != nil {
		t.Fatal(err)
	}
	status, body = env.stat(t, doc)
	if status != http.StatusOK || body["exists"] != false {
		t.Fatalf("missing file: status=%d body=%v", status, body)
	}
	if body["revision"] != "" {
		t.Fatalf("missing file must not report a revision: %v", body)
	}
}

// --- save preconditions ---------------------------------------------------

func TestSaveRejectsStaleRevision(t *testing.T) {
	env := newBoundaryTestEnv(t)
	doc := filepath.Join(t.TempDir(), "conflict.md")
	baseRev := writeDoc(t, doc, "aaaa")
	beforePath, beforeDir, beforeRecents := setActive(t, doc)

	// External change with an *older* timestamp: the old order-based check would
	// have accepted the write.
	writeDoc(t, doc, "external content")
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(doc, old, old); err != nil {
		t.Fatal(err)
	}
	status, body := env.save(t, map[string]interface{}{
		"path": doc, "content": "mine", "expected_revision": baseRev,
	})
	if status != http.StatusConflict || conflictCode(body) != "revision_mismatch" {
		t.Fatalf("older-mtime external change: status=%d body=%v", status, body)
	}
	if got := readDoc(t, doc); got != "external content" {
		t.Fatalf("disk must be intact, got %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)

	// Same mtime and same size, different content: timestamps cannot see it.
	baseRev2 := writeDoc(t, doc, "bbbb")
	fi, err := os.Stat(doc)
	if err != nil {
		t.Fatal(err)
	}
	writeDoc(t, doc, "cccc")
	if err := os.Chtimes(doc, fi.ModTime(), fi.ModTime()); err != nil {
		t.Fatal(err)
	}
	status, body = env.save(t, map[string]interface{}{
		"path": doc, "content": "mine again", "expected_revision": baseRev2,
	})
	if status != http.StatusConflict || conflictCode(body) != "revision_mismatch" {
		t.Fatalf("same-mtime external change: status=%d body=%v", status, body)
	}
	if got := readDoc(t, doc); got != "cccc" {
		t.Fatalf("disk must be intact, got %q", got)
	}
}

func TestSaveIdenticalContentIsNotAFalseConflict(t *testing.T) {
	env := newBoundaryTestEnv(t)
	doc := filepath.Join(t.TempDir(), "same.md")
	baseRev := writeDoc(t, doc, "same content")

	// Metadata changes (new inode/mtime) but the bytes stay the same: the
	// content fingerprint does not change, so this is not a conflict.
	if err := atomicWrite(doc, []byte("same content")); err != nil {
		t.Fatal(err)
	}
	status, body := env.save(t, map[string]interface{}{
		"path": doc, "content": "next version", "expected_revision": baseRev,
	})
	if status != http.StatusOK {
		t.Fatalf("identical content + changed metadata: status=%d body=%v", status, body)
	}
	if got := readDoc(t, doc); got != "next version" {
		t.Fatalf("save did not apply: %q", got)
	}
	if revOfField(t, body, "revision") != contentRevision([]byte("next version")) {
		t.Fatal("the response must carry the revision of the written content")
	}
}

func TestSaveRevisionContract(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "contract.md")
	baseRev := writeDoc(t, doc, "v1")
	beforePath, beforeDir, beforeRecents := setActive(t, doc)

	// Missing baseline on an existing file: 428, not a silent overwrite.
	status, body := env.save(t, map[string]interface{}{"path": doc, "content": "x"})
	if status != http.StatusPreconditionRequired || errorCode(body) != "revision_required" {
		t.Fatalf("missing baseline: status=%d body=%v", status, body)
	}
	// The legacy mod_time bypass (0 included) is not honoured anymore.
	for _, legacy := range []int64{0, time.Now().Add(-time.Hour).UnixNano(), time.Now().Add(time.Hour).UnixNano()} {
		status, body = env.save(t, map[string]interface{}{"path": doc, "content": "x", "mod_time": legacy})
		if status != http.StatusPreconditionRequired {
			t.Fatalf("legacy mod_time %d must not bypass the check: status=%d body=%v", legacy, status, body)
		}
	}
	if got := readDoc(t, doc); got != "v1" {
		t.Fatalf("refused saves must not touch the file: %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)

	// Malformed baseline: 400, never interpreted as force.
	for _, bad := range []string{"v1", "sha256:", "sha256:zz", "sha256:" + strings.Repeat("A", 64)} {
		status, body = env.save(t, map[string]interface{}{"path": doc, "content": "x", "expected_revision": bad})
		if status != http.StatusBadRequest || errorCode(body) != "invalid_revision" {
			t.Fatalf("malformed revision %q: status=%d body=%v", bad, status, body)
		}
	}

	// Round trip through JSON: the returned revision is the next baseline.
	status, body = env.save(t, map[string]interface{}{"path": doc, "content": "v2", "expected_revision": baseRev})
	if status != http.StatusOK {
		t.Fatalf("valid baseline: status=%d body=%v", status, body)
	}
	rev2 := revOfField(t, body, "revision")
	if rev2 != contentRevision([]byte("v2")) {
		t.Fatalf("unexpected revision %q", rev2)
	}
	if status, body = env.save(t, map[string]interface{}{"path": doc, "content": "v3", "expected_revision": rev2}); status != http.StatusOK {
		t.Fatalf("revision round-trip: status=%d body=%v", status, body)
	}

	// A brand-new file needs no baseline (creation, not overwrite).
	fresh := filepath.Join(dir, "fresh.md")
	if status, body = env.save(t, map[string]interface{}{"path": fresh, "content": "new"}); status != http.StatusOK {
		t.Fatalf("creating a new file without baseline: status=%d body=%v", status, body)
	}
	if revOfField(t, body, "revision") != contentRevision([]byte("new")) {
		t.Fatal("creation response revision mismatch")
	}
}

func TestSaveDoesNotRecreateDeletedFile(t *testing.T) {
	env := newBoundaryTestEnv(t)
	doc := filepath.Join(t.TempDir(), "deleted.md")
	baseRev := writeDoc(t, doc, "v1")
	if err := os.Remove(doc); err != nil {
		t.Fatal(err)
	}

	status, body := env.save(t, map[string]interface{}{
		"path": doc, "content": "resurrect", "expected_revision": baseRev,
	})
	if status != http.StatusConflict || conflictCode(body) != "file_missing" {
		t.Fatalf("deleted file with baseline: status=%d body=%v", status, body)
	}
	if _, err := os.Stat(doc); !os.IsNotExist(err) {
		t.Fatal("a deleted file must not be recreated automatically")
	}

	// An explicit force does not resurrect a file the client knew about either.
	status, body = env.save(t, map[string]interface{}{
		"path": doc, "content": "resurrect", "expected_revision": baseRev, "force": true,
	})
	if status != http.StatusConflict || conflictCode(body) != "file_missing" {
		t.Fatalf("force on a deleted file: status=%d body=%v", status, body)
	}
	if _, err := os.Stat(doc); !os.IsNotExist(err) {
		t.Fatal("force must not recreate a deleted file")
	}
}

func TestForceIsAnExplicitOneShot(t *testing.T) {
	env := newBoundaryTestEnv(t)
	doc := filepath.Join(t.TempDir(), "force.md")
	baseRev := writeDoc(t, doc, "v1")
	writeDoc(t, doc, "v2 external")

	status, body := env.save(t, map[string]interface{}{
		"path": doc, "content": "ours", "expected_revision": baseRev, "force": true,
	})
	if status != http.StatusOK {
		t.Fatalf("authorised overwrite: status=%d body=%v", status, body)
	}
	revOurs := revOfField(t, body, "revision")
	if got := readDoc(t, doc); got != "ours" {
		t.Fatalf("force did not overwrite: %q", got)
	}

	// The force consent is not persistent: the stale baseline conflicts again.
	status, body = env.save(t, map[string]interface{}{
		"path": doc, "content": "next", "expected_revision": baseRev,
	})
	if status != http.StatusConflict || conflictCode(body) != "revision_mismatch" {
		t.Fatalf("stale baseline after a forced write: status=%d body=%v", status, body)
	}
	// The revision returned by the forced write is the new baseline.
	if status, body = env.save(t, map[string]interface{}{
		"path": doc, "content": "next", "expected_revision": revOurs,
	}); status != http.StatusOK {
		t.Fatalf("baseline from the forced write: status=%d body=%v", status, body)
	}
}

func TestConcurrentSavesSameBaseline(t *testing.T) {
	for round := 0; round < 5; round++ {
		env := newBoundaryTestEnv(t)
		doc := filepath.Join(t.TempDir(), "race.md")
		baseRev := writeDoc(t, doc, "v1")

		type result struct {
			status int
			body   []byte
		}
		results := make([]result, 2)
		contents := []string{"AAAA", "BBBB"}
		var wg sync.WaitGroup
		for i := 0; i < 2; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				payload, _ := json.Marshal(map[string]interface{}{
					"path": doc, "content": contents[i], "expected_revision": baseRev,
				})
				status, body, err := env.do("POST", "/api/save", string(payload))
				if err != nil {
					t.Errorf("concurrent save: %v", err)
					return
				}
				results[i] = result{status, body}
			}(i)
		}
		wg.Wait()

		ok := 0
		conflicts := 0
		winner := ""
		for i, r := range results {
			switch r.status {
			case http.StatusOK:
				ok++
				winner = contents[i]
				if got := revOfField(t, decodeJSON(r.body), "revision"); got != contentRevision([]byte(contents[i])) {
					t.Fatalf("response revision does not describe the winner's content")
				}
			case http.StatusConflict:
				conflicts++
				if conflictCode(decodeJSON(r.body)) != "revision_mismatch" {
					t.Fatalf("unexpected conflict body: %s", r.body)
				}
			default:
				t.Fatalf("unexpected status %d: %s", r.status, r.body)
			}
		}
		if ok != 1 || conflicts != 1 {
			t.Fatalf("exactly one concurrent save must win, got ok=%d conflicts=%d", ok, conflicts)
		}
		if got := readDoc(t, doc); got != winner {
			t.Fatalf("disk %q does not match the winning content %q", got, winner)
		}
	}
}

func TestSaveAndRenameAreSerialized(t *testing.T) {
	for round := 0; round < 5; round++ {
		env := newBoundaryTestEnv(t)
		dir := t.TempDir()
		doc := filepath.Join(dir, "source.md")
		dest := filepath.Join(dir, "renamed.md")
		baseRev := writeDoc(t, doc, "v1")

		saveBody, _ := json.Marshal(map[string]interface{}{
			"path": doc, "content": "SAVE", "expected_revision": baseRev,
		})
		renameBody, _ := json.Marshal(map[string]interface{}{
			"old_path": doc, "new_path": dest, "content": "RENAME", "expected_revision": baseRev,
		})

		statuses := make([]int, 2)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			statuses[0], _, _ = env.do("POST", "/api/save", string(saveBody))
		}()
		go func() {
			defer wg.Done()
			statuses[1], _, _ = env.do("POST", "/api/rename", string(renameBody))
		}()
		wg.Wait()

		saveOK := statuses[0] == http.StatusOK
		renameOK := statuses[1] == http.StatusOK
		if saveOK == renameOK {
			t.Fatalf("exactly one of save/rename must win: save=%d rename=%d", statuses[0], statuses[1])
		}
		if saveOK {
			if got := readDoc(t, doc); got != "SAVE" {
				t.Fatalf("save won but disk is %q", got)
			}
			if _, err := os.Stat(dest); !os.IsNotExist(err) {
				t.Fatal("losing rename must not create the destination")
			}
			if statuses[1] != http.StatusConflict {
				t.Fatalf("losing rename status %d", statuses[1])
			}
		} else {
			if got := readDoc(t, dest); got != "RENAME" {
				t.Fatalf("rename won but destination is %q", got)
			}
			if _, err := os.Stat(doc); !os.IsNotExist(err) {
				t.Fatal("rename must remove the source")
			}
			if statuses[0] != http.StatusConflict {
				t.Fatalf("losing save status %d", statuses[0])
			}
		}
	}
}

// --- rename preconditions -------------------------------------------------

func TestRenameSourceRevisionGuards(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "src.md")
	dest := filepath.Join(dir, "dest.md")
	baseRev := writeDoc(t, src, "v1")
	beforePath, beforeDir, beforeRecents := setActive(t, src)

	writeDoc(t, src, "v2 changed externally")

	status, body := env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "ours", "expected_revision": baseRev,
	})
	if status != http.StatusConflict || conflictCode(body) != "source_changed" {
		t.Fatalf("changed source: status=%d body=%v", status, body)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("a refused rename must not create the destination")
	}
	if got := readDoc(t, src); got != "v2 changed externally" {
		t.Fatalf("the source must be intact, got %q", got)
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)

	// Destination overwrite consent does not authorise losing source changes.
	status, body = env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "ours", "expected_revision": baseRev, "overwrite": true,
	})
	if status != http.StatusConflict || conflictCode(body) != "source_changed" {
		t.Fatalf("changed source with overwrite: status=%d body=%v", status, body)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("a refused rename must not create the destination")
	}

	// old_path == new_path is verified too: no in-place overwrite of an external
	// change disguised as a rename.
	status, body = env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": src, "content": "ours", "expected_revision": baseRev,
	})
	if status != http.StatusConflict || conflictCode(body) != "source_changed" {
		t.Fatalf("same-path rename with changed source: status=%d body=%v", status, body)
	}
	if got := readDoc(t, src); got != "v2 changed externally" {
		t.Fatalf("same-path rename must not overwrite the source, got %q", got)
	}

	// Missing baseline on an existing source: 428, not a blind write.
	status, body = env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "ours",
	})
	if status != http.StatusPreconditionRequired || errorCode(body) != "revision_required" {
		t.Fatalf("rename without source baseline: status=%d body=%v", status, body)
	}

	// Malformed baseline: 400.
	status, body = env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "ours", "expected_revision": "nope",
	})
	if status != http.StatusBadRequest || errorCode(body) != "invalid_revision" {
		t.Fatalf("rename with malformed baseline: status=%d body=%v", status, body)
	}

	// Deleted source: distinct conflict, nothing created or removed.
	currentRev := contentRevision([]byte("v2 changed externally"))
	if err := os.Remove(src); err != nil {
		t.Fatal(err)
	}
	status, body = env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "ours", "expected_revision": currentRev,
	})
	if status != http.StatusConflict || conflictCode(body) != "source_missing" {
		t.Fatalf("missing source: status=%d body=%v", status, body)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("a refused rename must not create the destination")
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)
}

func TestRenameDestinationSemanticsPreserved(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "src.md")
	dest := filepath.Join(dir, "dest.md")
	baseRev := writeDoc(t, src, "v1")

	// Initial Save As (no source): creating a new destination needs no baseline.
	fresh := filepath.Join(dir, "fresh.md")
	status, body := env.rename(t, map[string]interface{}{
		"old_path": "", "new_path": fresh, "content": "brand new",
	})
	if status != http.StatusOK {
		t.Fatalf("initial rename without source: status=%d body=%v", status, body)
	}
	if revOfField(t, body, "revision") != contentRevision([]byte("brand new")) {
		t.Fatal("initial rename response revision mismatch")
	}
	if got := readDoc(t, fresh); got != "brand new" {
		t.Fatalf("initial rename did not write: %q", got)
	}

	// Existing destination without overwrite: protected, and a distinct code.
	writeDoc(t, dest, "keep me")
	status, body = env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "ours", "expected_revision": baseRev,
	})
	if status != http.StatusConflict || conflictCode(body) != "target_exists" {
		t.Fatalf("existing destination: status=%d body=%v", status, body)
	}
	if got := readDoc(t, dest); got != "keep me" {
		t.Fatalf("destination overwritten without consent: %q", got)
	}
	if got := readDoc(t, src); got != "v1" {
		t.Fatalf("source must be intact after a refused rename: %q", got)
	}

	// Explicit overwrite still works after the source revision check.
	status, body = env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "ours", "expected_revision": baseRev, "overwrite": true,
	})
	if status != http.StatusOK {
		t.Fatalf("overwrite rename: status=%d body=%v", status, body)
	}
	if got := readDoc(t, dest); got != "ours" {
		t.Fatalf("destination not overwritten: %q", got)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("rename must remove the source")
	}
	if gotPath, _ := activeSnapshot(); gotPath != dest {
		t.Fatalf("active document should follow the rename: %q", gotPath)
	}

	// Same-path rename with the right baseline updates the content.
	sameRev := contentRevision([]byte("ours"))
	status, body = env.rename(t, map[string]interface{}{
		"old_path": dest, "new_path": dest, "content": "rewritten", "expected_revision": sameRev,
	})
	if status != http.StatusOK {
		t.Fatalf("same-path rename: status=%d body=%v", status, body)
	}
	if got := readDoc(t, dest); got != "rewritten" {
		t.Fatalf("same-path rename did not update: %q", got)
	}
}

func TestWriteFailureIsNeverReportedAsSuccess(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()

	// Rename onto a directory: the atomic rename fails, the source is preserved
	// and the response is an error (not a fake success).
	src := filepath.Join(dir, "src.md")
	baseRev := writeDoc(t, src, "v1")
	blocked := filepath.Join(dir, "blocked.md")
	if err := os.MkdirAll(blocked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blocked, "keep.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	beforePath, beforeDir, beforeRecents := setActive(t, src)

	status, body := env.rename(t, map[string]interface{}{
		"old_path": src, "new_path": blocked, "content": "ours", "expected_revision": baseRev,
	})
	if status != http.StatusInternalServerError || errorCode(body) != "write_failed" {
		t.Fatalf("rename onto a directory: status=%d body=%v", status, body)
	}
	if got := readDoc(t, src); got != "v1" {
		t.Fatalf("failed rename must keep the source: %q", got)
	}
	if _, err := os.Stat(filepath.Join(blocked, "keep.txt")); err != nil {
		t.Fatal("failed rename must not alter the destination directory")
	}
	requireUnchangedState(t, beforePath, beforeDir, beforeRecents)

	// Save onto a path that is not a regular file: the snapshot fails before any
	// write, so the answer is an error and the directory is untouched.
	status, body = env.save(t, map[string]interface{}{
		"path": blocked, "content": "ours", "expected_revision": "", "force": true,
	})
	if status == http.StatusOK || body["success"] == true {
		t.Fatalf("save onto a directory must not report success: status=%d body=%v", status, body)
	}
	if _, err := os.Stat(filepath.Join(blocked, "keep.txt")); err != nil {
		t.Fatal("refused save must not alter the directory")
	}
}

func TestAPIRouteSchema(t *testing.T) {
	// Guard the JSON field names the UI depends on; a rename of these fields is a
	// protocol break, not an internal detail.
	env := newBoundaryTestEnv(t)
	doc := filepath.Join(t.TempDir(), "schema.md")
	rev := writeDoc(t, doc, "v1")
	setActive(t, doc)

	status, initBody := env.init(t)
	if status != http.StatusOK {
		t.Fatalf("init: %d", status)
	}
	for _, key := range []string{"file_content", "file_revision", "file_exists", "active_file", "token"} {
		if _, ok := initBody[key]; !ok {
			t.Errorf("/api/init is missing %q", key)
		}
	}

	status, fileBody := env.file(t, doc)
	if status != http.StatusOK {
		t.Fatalf("file: %d", status)
	}
	for _, key := range []string{"path", "content", "revision", "mod_time", "read_only"} {
		if _, ok := fileBody[key]; !ok {
			t.Errorf("/api/file is missing %q", key)
		}
	}

	status, saveBody := env.save(t, map[string]interface{}{"path": doc, "content": "v2", "expected_revision": rev})
	if status != http.StatusOK {
		t.Fatalf("save: %d", status)
	}
	for _, key := range []string{"success", "path", "revision"} {
		if _, ok := saveBody[key]; !ok {
			t.Errorf("/api/save is missing %q", key)
		}
	}

	status, statBody := env.stat(t, doc)
	if status != http.StatusOK {
		t.Fatalf("stat: %d", status)
	}
	for _, key := range []string{"path", "exists", "revision"} {
		if _, ok := statBody[key]; !ok {
			t.Errorf("/api/stat is missing %q", key)
		}
	}
	if statBody["revision"] != saveBody["revision"] {
		t.Errorf("stat revision %v != save revision %v", statBody["revision"], saveBody["revision"])
	}
}

func TestConflictResponsesAreStructured(t *testing.T) {
	env := newBoundaryTestEnv(t)
	doc := filepath.Join(t.TempDir(), "structured.md")
	rev := writeDoc(t, doc, "v1")
	writeDoc(t, doc, "v2")

	status, body := env.save(t, map[string]interface{}{"path": doc, "content": "x", "expected_revision": rev})
	if status != http.StatusConflict {
		t.Fatalf("expected 409, got %d", status)
	}
	if errorCode(body) != "conflict" || conflictCode(body) != "revision_mismatch" {
		t.Fatalf("conflict body is not structured: %v", body)
	}
	if gotRev, _ := body["revision"].(string); gotRev != contentRevision([]byte("v2")) {
		t.Fatalf("conflict must report the current disk revision, got %v", body["revision"])
	}
	if _, ok := body["path"].(string); !ok {
		t.Fatalf("conflict must report the path: %v", body)
	}
}

func TestConcurrentRenameAndSaveDoNotCorruptState(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	src := filepath.Join(dir, "src.md")
	rev := writeDoc(t, src, "v1")
	dest := filepath.Join(dir, "dest.md")

	// A stale rename (source revision no longer matches) racing a successful save
	// must not remove or recreate anything.
	saveBody, _ := json.Marshal(map[string]interface{}{
		"path": src, "content": "saved", "expected_revision": rev,
	})
	staleRename, _ := json.Marshal(map[string]interface{}{
		"old_path": src, "new_path": dest, "content": "renamed", "expected_revision": rev,
	})
	status, saveResp, err := env.do("POST", "/api/save", string(saveBody))
	if err != nil || status != http.StatusOK {
		t.Fatalf("save: status=%d err=%v body=%s", status, err, saveResp)
	}
	// Now the rename carries the stale baseline.
	status, body, err := env.do("POST", "/api/rename", string(staleRename))
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusConflict || conflictCode(decodeJSON(body)) != "source_changed" {
		t.Fatalf("stale rename after a save: status=%d body=%s", status, body)
	}
	if got := readDoc(t, src); got != "saved" {
		t.Fatalf("source must keep the saved content: %q", got)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("stale rename must not create the destination")
	}
}

func TestInitEmptyAndMissingActiveFile(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()

	// An existing empty file is a valid snapshot: file_exists=true and the
	// revision of the empty bytes, not a missing baseline.
	empty := filepath.Join(dir, "empty.md")
	writeDoc(t, empty, "")
	setActive(t, empty)
	status, body := env.init(t)
	if status != http.StatusOK {
		t.Fatalf("/api/init on an empty file: %d", status)
	}
	if body["file_exists"] != true {
		t.Fatalf("an existing empty file must report file_exists=true: %v", body)
	}
	emptyRev, _ := body["file_revision"].(string)
	if emptyRev != contentRevision([]byte("")) {
		t.Fatalf("wrong revision for an empty file: %q", emptyRev)
	}
	if content, _ := body["file_content"].(string); content != "" {
		t.Fatalf("empty file content mismatch: %q", content)
	}
	// The client can save immediately with that baseline, without force.
	status, saveBody := env.save(t, map[string]interface{}{
		"path": empty, "content": "first line", "expected_revision": emptyRev,
	})
	if status != http.StatusOK {
		t.Fatalf("save with the empty-file baseline: %d %v", status, saveBody)
	}

	// A known-deleted active file: the snapshot is the absence, with no revision;
	// it is not turned into a saveable empty document by the API.
	missing := filepath.Join(dir, "gone.md")
	setActive(t, missing)
	status, body = env.init(t)
	if status != http.StatusOK {
		t.Fatalf("/api/init on a missing file: %d", status)
	}
	if body["file_exists"] != false {
		t.Fatalf("a missing active file must report file_exists=false: %v", body)
	}
	if body["file_revision"] != "" {
		t.Fatalf("a missing active file must not report a revision: %v", body)
	}
}
