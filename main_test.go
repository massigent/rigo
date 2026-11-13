package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
