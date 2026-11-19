package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicWriteAndReadFile(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "test.md")
	content := []byte("# Hello TypeCraft\n\nTesting atomic save.")

	if err := atomicWrite(filePath, content); err != nil {
		t.Fatalf("atomicWrite failed: %v", err)
	}

	readBack, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}

	if string(readBack) != string(content) {
		t.Fatalf("Content mismatch: expected %q, got %q", string(content), string(readBack))
	}
}

func TestBuildWorkspaceTree(t *testing.T) {
	tmpDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(tmpDir, "doc1.md"), []byte("# Doc 1"), 0o644)
	_ = os.WriteFile(filepath.Join(tmpDir, "doc2.markdown"), []byte("# Doc 2"), 0o644)
	_ = os.WriteFile(filepath.Join(tmpDir, "ignore.png"), []byte("..."), 0o644)

	subDir := filepath.Join(tmpDir, "chapters")
	_ = os.Mkdir(subDir, 0o755)
	_ = os.WriteFile(filepath.Join(subDir, "ch1.md"), []byte("# Chapter 1"), 0o644)

	tree, err := buildWorkspaceTree(tmpDir, 0)
	if err != nil {
		t.Fatalf("buildWorkspaceTree failed: %v", err)
	}

	if tree == nil {
		t.Fatal("tree is nil")
	}

	if !tree.IsDir {
		t.Fatal("root should be a directory")
	}

	// Should contain doc1.md, doc2.markdown, chapters folder (with ch1.md), but ignore.png omitted
	var foundDoc1, foundDoc2, foundChapters bool
	for _, child := range tree.Children {
		if child.Name == "doc1.md" {
			foundDoc1 = true
		}
		if child.Name == "doc2.markdown" {
			foundDoc2 = true
		}
		if child.Name == "chapters" && child.IsDir {
			foundChapters = true
			if len(child.Children) != 1 || child.Children[0].Name != "ch1.md" {
				t.Fatalf("unexpected chapters children: %+v", child.Children)
			}
		}
		if child.Name == "ignore.png" {
			t.Fatal("ignore.png should not be in markdown file tree")
		}
	}

	if !foundDoc1 || !foundDoc2 || !foundChapters {
		t.Fatalf("missing expected children in tree: foundDoc1=%v, foundDoc2=%v, foundChapters=%v", foundDoc1, foundDoc2, foundChapters)
	}
}

func TestAuthMiddleware(t *testing.T) {
	appToken = "test-token-123"
	handler := authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Allowed localhost origin + valid token
	reqLocal := httptest.NewRequest("GET", "/api/test", nil)
	reqLocal.Header.Set("Origin", "http://127.0.0.1:8080")
	reqLocal.Header.Set("X-Typecraft-Token", "test-token-123")
	recLocal := httptest.NewRecorder()
	handler(recLocal, reqLocal)
	if recLocal.Code != http.StatusOK {
		t.Fatalf("expected 200 for local origin, got %d", recLocal.Code)
	}

	// Missing token -> 401
	reqNoToken := httptest.NewRequest("GET", "/api/test", nil)
	reqNoToken.Header.Set("Origin", "http://127.0.0.1:8080")
	recNoToken := httptest.NewRecorder()
	handler(recNoToken, reqNoToken)
	if recNoToken.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing token, got %d", recNoToken.Code)
	}

	// Forbidden malicious origin
	reqMalicious := httptest.NewRequest("GET", "/api/test", nil)
	reqMalicious.Header.Set("Origin", "http://evil-site.com")
	recMalicious := httptest.NewRecorder()
	handler(recMalicious, reqMalicious)
	if recMalicious.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for external origin, got %d", recMalicious.Code)
	}
}

func TestSaveEndpoint(t *testing.T) {
	appToken = "test-token-123"
	tmpDir := t.TempDir()
	saveTarget := filepath.Join(tmpDir, "saved.md")

	reqBody := SaveRequest{
		Path:    saveTarget,
		Content: "# Saved Content\n\nTesting save endpoint.",
	}
	data, _ := json.Marshal(reqBody)

	saveHandler := authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		var req SaveRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if err := atomicWrite(req.Path, []byte(req.Content)); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		_ = json.NewEncoder(w).Encode(SaveResponse{Success: true, Path: req.Path})
	})

	req := httptest.NewRequest("POST", "/api/save", bytes.NewReader(data))
	req.Header.Set("X-Typecraft-Token", "test-token-123")
	rec := httptest.NewRecorder()
	saveHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	content, err := os.ReadFile(saveTarget)
	if err != nil || string(content) != reqBody.Content {
		t.Fatalf("saved content mismatch: %v, content=%q", err, string(content))
	}
}

func TestPathSafety(t *testing.T) {
	if !isSafeMarkdownPath("/tmp/doc.md") {
		t.Fatal("doc.md should be allowed")
	}
	if isSafeMarkdownPath("/tmp/image.png") {
		t.Fatal("image.png should be blocked")
	}
	if isSafeMarkdownPath("/home/u/.bashrc") {
		t.Fatal(".bashrc (no md ext) should be blocked")
	}
	if _, err := cleanAbs("/tmp/\x00evil"); err == nil {
		t.Fatal("NUL byte path should be rejected")
	}
}

// --- Regression tests for the 1.0.2 review -------------------------------

func TestIsSafeImagePath(t *testing.T) {
	allowed := []string{"/tmp/a.png", "/tmp/a.JPG", "/tmp/a.jpeg", "/tmp/a.svg", "/tmp/a.webp"}
	for _, p := range allowed {
		if !isSafeImagePath(p) {
			t.Fatalf("%s should be served as an image", p)
		}
	}
	blocked := []string{"/etc/passwd", "/tmp/a.md", "/home/u/.bashrc", "/tmp/a.html", "/tmp/a.js"}
	for _, p := range blocked {
		if isSafeImagePath(p) {
			t.Fatalf("%s must not be served by /api/asset", p)
		}
	}
}

func TestMarkdownExtensionsAreConsistent(t *testing.T) {
	// The file tree used to hide .mkd while /api/file accepted it.
	for _, p := range []string{"a.md", "a.markdown", "a.txt", "a.mdown", "a.mkd", "a.mdwn"} {
		if !isMarkdown(p) {
			t.Fatalf("%s should be listed in the workspace tree", p)
		}
		if !isSafeMarkdownPath(p) {
			t.Fatalf("%s should be openable", p)
		}
	}
	if isMarkdown("a.png") || isSafeMarkdownPath("a.png") {
		t.Fatal("images are not markdown documents")
	}
}

func TestDefaultSaveDirPrefersExistingFolder(t *testing.T) {
	tmp := t.TempDir()
	if got := defaultSaveDir(tmp); got != tmp {
		t.Fatalf("expected %q, got %q", tmp, got)
	}
	missing := filepath.Join(tmp, "does-not-exist")
	if got := defaultSaveDir(missing); got == missing {
		t.Fatal("a missing folder must not be suggested as save target")
	}
}

func TestEventHubPublishAndUnsubscribe(t *testing.T) {
	hub := newEventHub()
	a := hub.subscribe()
	b := hub.subscribe()

	hub.publish("/tmp/x.md")

	if got := <-a; got != "/tmp/x.md" {
		t.Fatalf("subscriber a got %q", got)
	}
	if got := <-b; got != "/tmp/x.md" {
		t.Fatalf("subscriber b got %q", got)
	}

	hub.unsubscribe(b)
	if _, open := <-b; open {
		t.Fatal("channel of an unsubscribed client must be closed")
	}
	// Publishing after the last subscriber leaves must not block or panic.
	hub.unsubscribe(a)
	hub.publish("/tmp/y.md")
}

func TestInternalOpenRequiresControlSecret(t *testing.T) {
	controlToken = "control-secret"
	tmp := t.TempDir()
	doc := filepath.Join(tmp, "forwarded.md")
	if err := os.WriteFile(doc, []byte("# f"), 0o644); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]interface{}{"paths": []string{doc}})

	forbidden := httptest.NewRequest("POST", "/api/internal/open", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handleInternalOpen(rec, forbidden)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without the control secret, got %d", rec.Code)
	}

	ok := httptest.NewRequest("POST", "/api/internal/open", bytes.NewReader(body))
	ok.Header.Set("X-Typecraft-Control", "control-secret")
	recOK := httptest.NewRecorder()
	handleInternalOpen(recOK, ok)
	if recOK.Code != http.StatusOK {
		t.Fatalf("expected 200 with the control secret, got %d", recOK.Code)
	}

	activeFileMu.RLock()
	got := activePath
	activeFileMu.RUnlock()
	if got != doc {
		t.Fatalf("forwarded file not activated: got %q want %q", got, doc)
	}

	// Non-markdown paths must be ignored even with a valid secret.
	bad, _ := json.Marshal(map[string]interface{}{"paths": []string{"/etc/hosts"}})
	reqBad := httptest.NewRequest("POST", "/api/internal/open", bytes.NewReader(bad))
	reqBad.Header.Set("X-Typecraft-Control", "control-secret")
	recBad := httptest.NewRecorder()
	handleInternalOpen(recBad, reqBad)
	activeFileMu.RLock()
	after := activePath
	activeFileMu.RUnlock()
	if after == "/etc/hosts" {
		t.Fatal("a non-markdown path must never become the active file")
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))

	for header, want := range map[string]string{
		"Referrer-Policy":        "no-referrer",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Fatalf("header %s = %q, want %q", header, got, want)
		}
	}
	if csp := rec.Header().Get("Content-Security-Policy"); csp == "" {
		t.Fatal("Content-Security-Policy must be set")
	}
}

func TestEventHubCountTracksAttachedWindows(t *testing.T) {
	hub := newEventHub()
	if got := hub.count(); got != 0 {
		t.Fatalf("a fresh hub must report 0 windows, got %d", got)
	}
	a := hub.subscribe()
	hub.subscribe()
	if got := hub.count(); got != 2 {
		t.Fatalf("expected 2 attached windows, got %d", got)
	}
	hub.unsubscribe(a)
	if got := hub.count(); got != 1 {
		t.Fatalf("expected 1 attached window after close, got %d", got)
	}
}

func TestFsAndRenameEndpoints(t *testing.T) {
	appToken = "test-token-fs"
	tmpDir := t.TempDir()

	subDir := filepath.Join(tmpDir, "subfolder")
	if err := os.Mkdir(subDir, 0o755); err != nil {
		t.Fatal(err)
	}
	testFile := filepath.Join(tmpDir, "note.md")
	if err := os.WriteFile(testFile, []byte("# Original Note"), 0o644); err != nil {
		t.Fatal(err)
	}

	mux := setupMux()

	// 1. Test /api/fs
	fsReq := httptest.NewRequest("GET", "/api/fs?path="+tmpDir, nil)
	fsReq.Header.Set("X-Typecraft-Token", "test-token-fs")
	fsRec := httptest.NewRecorder()
	mux.ServeHTTP(fsRec, fsReq)

	if fsRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from /api/fs, got %d: %s", fsRec.Code, fsRec.Body.String())
	}
	var fsData struct {
		Current string `json:"current"`
		Parent  string `json:"parent"`
		Items   []struct {
			Name  string `json:"name"`
			IsDir bool   `json:"is_dir"`
		} `json:"items"`
	}
	if err := json.Unmarshal(fsRec.Body.Bytes(), &fsData); err != nil {
		t.Fatalf("failed to decode /api/fs response: %v", err)
	}
	if fsData.Current != tmpDir {
		t.Fatalf("expected current=%s, got %s", tmpDir, fsData.Current)
	}
	foundSub := false
	foundNote := false
	for _, it := range fsData.Items {
		if it.Name == "subfolder" && it.IsDir {
			foundSub = true
		}
		if it.Name == "note.md" && !it.IsDir {
			foundNote = true
		}
	}
	if !foundSub || !foundNote {
		t.Fatalf("missing items in /api/fs: items=%+v", fsData.Items)
	}

	// 2. Test /api/mkdir
	mkdirBody, _ := json.Marshal(map[string]string{
		"path": tmpDir,
		"name": "new_created_dir",
	})
	mkdirReq := httptest.NewRequest("POST", "/api/mkdir", bytes.NewReader(mkdirBody))
	mkdirReq.Header.Set("X-Typecraft-Token", "test-token-fs")
	mkdirRec := httptest.NewRecorder()
	mux.ServeHTTP(mkdirRec, mkdirReq)

	if mkdirRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from /api/mkdir, got %d: %s", mkdirRec.Code, mkdirRec.Body.String())
	}
	createdPath := filepath.Join(tmpDir, "new_created_dir")
	if fi, err := os.Stat(createdPath); err != nil || !fi.IsDir() {
		t.Fatalf("expected directory %s to be created on disk", createdPath)
	}

	// 3. Test /api/rename (Rename & Move)
	destPath := filepath.Join(createdPath, "renamed_note.md")
	renameBody, _ := json.Marshal(map[string]string{
		"old_path": testFile,
		"new_path": destPath,
		"content":  "# Renamed Content",
	})
	renameReq := httptest.NewRequest("POST", "/api/rename", bytes.NewReader(renameBody))
	renameReq.Header.Set("X-Typecraft-Token", "test-token-fs")
	renameRec := httptest.NewRecorder()
	mux.ServeHTTP(renameRec, renameReq)

	if renameRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from /api/rename, got %d: %s", renameRec.Code, renameRec.Body.String())
	}

	// Verify new file exists with new content
	newContent, err := os.ReadFile(destPath)
	if err != nil || string(newContent) != "# Renamed Content" {
		t.Fatalf("failed reading new file %s: %v, content=%q", destPath, err, string(newContent))
	}
	// Verify old file was cleanly removed
	if _, err := os.Stat(testFile); !os.IsNotExist(err) {
		t.Fatalf("expected old file %s to be removed, but it still exists", testFile)
	}

	// Verify activePath was updated
	activeFileMu.RLock()
	curActive := activePath
	activeFileMu.RUnlock()
	if curActive != destPath {
		t.Fatalf("expected activePath to be %s, got %s", destPath, curActive)
	}
}

// --- Regression tests for the 1.0.3 review -------------------------------

func TestIsLocalOriginRejectsLookalikeHosts(t *testing.T) {
	allowed := []string{
		"http://127.0.0.1:8080",
		"http://localhost:1234",
		"http://127.0.0.1",
		"http://[::1]:8080",
		"https://localhost",
	}
	for _, o := range allowed {
		if !isLocalOrigin(o) {
			t.Fatalf("%q is a loopback origin and must be allowed", o)
		}
	}
	blocked := []string{
		"http://127.0.0.1.evil.com",
		"http://localhost.evil.com",
		"http://evil.com",
		"http://192.168.1.10:8080",
		"ftp://127.0.0.1",
		"null",
		"",
	}
	for _, o := range blocked {
		if isLocalOrigin(o) {
			t.Fatalf("%q must not pass the DNS-rebinding guard", o)
		}
	}
}

func TestPathWithin(t *testing.T) {
	base := t.TempDir()
	inside := filepath.Join(base, "assets", "a.png")
	if err := os.MkdirAll(filepath.Dir(inside), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inside, []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !pathWithin(base, inside) {
		t.Fatalf("%s should be inside %s", inside, base)
	}
	if !pathWithin(base, base) {
		t.Fatal("a folder is inside itself")
	}
	if pathWithin(base, filepath.Join(base, "..", "other.png")) {
		t.Fatal("a sibling path must be outside")
	}
	if pathWithin(base, "/etc/passwd") {
		t.Fatal("/etc/passwd must be outside")
	}

	// A symlink inside the document folder pointing outside must not leak.
	outside := filepath.Join(t.TempDir(), "secret.png")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "link.png")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if pathWithin(base, link) {
		t.Fatal("a symlink escaping the document folder must be refused")
	}
}

func TestAssetEndpointConfinedToDocumentFolder(t *testing.T) {
	appToken = "test-token-asset"
	docDir := t.TempDir()
	inside := filepath.Join(docDir, "ok.png")
	if err := os.WriteFile(inside, []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	outsideDir := t.TempDir()
	outside := filepath.Join(outsideDir, "private.png")
	if err := os.WriteFile(outside, []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	activeFileMu.Lock()
	prevDir := activeDir
	activeDir = docDir
	activeFileMu.Unlock()
	defer func() {
		activeFileMu.Lock()
		activeDir = prevDir
		activeFileMu.Unlock()
	}()

	mux := setupMux()
	get := func(p string) int {
		req := httptest.NewRequest("GET", "/api/asset?path="+urlQueryEscape(p), nil)
		req.Header.Set("X-Typecraft-Token", "test-token-asset")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := get(inside); code != http.StatusOK {
		t.Fatalf("expected 200 for an image next to the document, got %d", code)
	}
	if code := get(outside); code != http.StatusForbidden {
		t.Fatalf("expected 403 for an image outside the document folder, got %d", code)
	}
	if code := get("../" + filepath.Base(outside)); code != http.StatusForbidden {
		t.Fatalf("expected 403 for a traversal attempt, got %d", code)
	}
}

func urlQueryEscape(p string) string {
	return url.QueryEscape(p)
}

func TestRenameRefusesToDeleteNonMarkdownAndToOverwrite(t *testing.T) {
	appToken = "test-token-rename"
	dir := t.TempDir()
	secret := filepath.Join(dir, "private.png")
	if err := os.WriteFile(secret, []byte("not markdown"), 0o644); err != nil {
		t.Fatal(err)
	}
	existing := filepath.Join(dir, "existing.md")
	if err := os.WriteFile(existing, []byte("keep me"), 0o644); err != nil {
		t.Fatal(err)
	}

	mux := setupMux()
	post := func(body map[string]interface{}) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "/api/rename", bytes.NewReader(data))
		req.Header.Set("X-Typecraft-Token", "test-token-rename")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	// 1. old_path pointing at a non-markdown file must not be deleted.
	rec := post(map[string]interface{}{
		"old_path": secret,
		"new_path": filepath.Join(dir, "moved.md"),
		"content":  "x",
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a non-markdown old_path, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(secret); err != nil {
		t.Fatalf("the non-markdown file was removed: %v", err)
	}

	// 2. an unknown extension is refused instead of silently rewritten.
	rec = post(map[string]interface{}{
		"new_path": filepath.Join(dir, "doc.fountain"),
		"content":  "x",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an unsupported extension, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "doc.fountain")); !os.IsNotExist(err) {
		t.Fatal("nothing should have been written for a refused extension")
	}

	// 3. an existing different document is not replaced without asking.
	rec = post(map[string]interface{}{
		"new_path": existing,
		"content":  "overwritten",
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 when the target exists, got %d: %s", rec.Code, rec.Body.String())
	}
	if data, _ := os.ReadFile(existing); string(data) != "keep me" {
		t.Fatalf("existing file was overwritten without consent: %q", string(data))
	}

	// 4. ... and is replaced when the caller explicitly says so.
	rec = post(map[string]interface{}{
		"new_path":  existing,
		"content":   "overwritten",
		"overwrite": true,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with overwrite, got %d: %s", rec.Code, rec.Body.String())
	}
	if data, _ := os.ReadFile(existing); string(data) != "overwritten" {
		t.Fatalf("overwrite did not happen: %q", string(data))
	}
}

func TestAtomicWritePreservesFileMode(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "shared.md")
	if err := os.WriteFile(target, []byte("old"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := atomicWrite(target, []byte("new")); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if got := fi.Mode().Perm(); got != 0o640 {
		t.Fatalf("expected mode 0640 to survive the save, got %o", got)
	}
	if data, _ := os.ReadFile(target); string(data) != "new" {
		t.Fatalf("content not written: %q", string(data))
	}
}

func TestStatEndpointReportsModTime(t *testing.T) {
	appToken = "test-token-stat"
	dir := t.TempDir()
	doc := filepath.Join(dir, "a.md")
	if err := os.WriteFile(doc, []byte("# hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	mux := setupMux()
	req := httptest.NewRequest("GET", "/api/stat?path="+urlQueryEscape(doc), nil)
	req.Header.Set("X-Typecraft-Token", "test-token-stat")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Path    string `json:"path"`
		ModTime int64  `json:"mod_time"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if out.Path != doc || out.ModTime == 0 {
		t.Fatalf("unexpected stat payload: %+v", out)
	}
}

func TestPathWithinHandlesMissingFileUnderSymlinkedBase(t *testing.T) {
	base := t.TempDir()
	// A picture the document references but that is not on disk yet must be
	// treated as "inside" (the handler then answers 404, not 403).
	if !pathWithin(base, filepath.Join(base, "not-saved-yet.png")) {
		t.Fatal("a missing file inside the document folder must still be inside")
	}
	if pathWithin(base, filepath.Join(base, "..", "outside.png")) {
		t.Fatal("traversal must stay outside")
	}
	// macOS /tmp is a symlink: base resolved and target not.
	symlinkedBase := filepath.Join(os.TempDir(), "typecraft-"+t.Name())
	if err := os.MkdirAll(symlinkedBase, 0o755); err != nil {
		t.Skip(err)
	}
	defer os.RemoveAll(symlinkedBase)
	if !pathWithin(symlinkedBase, filepath.Join(symlinkedBase, "x.png")) {
		t.Fatal("a missing file under a symlinked base must be inside")
	}
}
