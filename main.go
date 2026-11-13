package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed web
var embeddedWebFS embed.FS

var (
	version      = "1.0.2"
	activeFileMu sync.RWMutex
	activePath   string
	activeDir    string
	appToken     string
	recentsPath  string
	recentsMu    sync.Mutex
	recentsList  []string
	controlToken string
	events       = newEventHub()
	primaryPort  int
	appMode      = true
	noBrowser    = false

	idleShutdownTimer *time.Timer
	idleShutdownMu    sync.Mutex
	serverShutdownFn  func()
)

func scheduleIdleShutdown(d time.Duration) {
	idleShutdownMu.Lock()
	defer idleShutdownMu.Unlock()
	if idleShutdownTimer != nil {
		idleShutdownTimer.Stop()
	}
	idleShutdownTimer = time.AfterFunc(d, func() {
		if events.count() == 0 && !noBrowser {
			if serverShutdownFn != nil {
				serverShutdownFn()
			}
		}
	})
}

func cancelIdleShutdown() {
	idleShutdownMu.Lock()
	defer idleShutdownMu.Unlock()
	if idleShutdownTimer != nil {
		idleShutdownTimer.Stop()
		idleShutdownTimer = nil
	}
}

func primaryURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", primaryPort)
}

type InitResponse struct {
	Version     string   `json:"version"`
	Token       string   `json:"token"`
	ActiveFile  string   `json:"active_file"`
	ActiveDir   string   `json:"active_dir"`
	DefaultDir  string   `json:"default_dir"`
	FileContent string   `json:"file_content"`
	Recents     []string `json:"recents"`
	OS          string   `json:"os"`
}

type SaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	ModTime int64  `json:"mod_time,omitempty"` // unix nano; 0 = no check (first save)
}

type SaveResponse struct {
	Success bool   `json:"success"`
	Path    string `json:"path"`
	ModTime int64  `json:"mod_time,omitempty"`
	Error   string `json:"error,omitempty"`
}

type FileResponse struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	ModTime  int64  `json:"mod_time"`
	ReadOnly bool   `json:"read_only"`
}

type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"is_dir"`
	Children []*FileNode `json:"children,omitempty"`
}

func randomToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err == nil {
		return hex.EncodeToString(b)
	}
	return fmt.Sprintf("tk_%d", time.Now().UnixNano())
}

func initSecurityToken() {
	appToken = randomToken()
	controlToken = randomToken()
}

func getHomeDir() string {
	if h, err := os.UserHomeDir(); err == nil {
		return h
	}
	return os.TempDir()
}

func getDefaultSaveDir() string {
	if h, err := os.UserHomeDir(); err == nil {
		doc := filepath.Join(h, "Documenti")
		if st, err := os.Stat(doc); err == nil && st.IsDir() {
			return doc
		}
		return h
	}
	pwd, err := os.Getwd()
	if err == nil {
		return pwd
	}
	return os.TempDir()
}

// defaultSaveDir prefers the folder of the document currently open, then the
// user's Documents folder. The UI uses it to pre-fill "Save as".
func defaultSaveDir(preferred string) string {
	if preferred != "" {
		if fi, err := os.Stat(preferred); err == nil && fi.IsDir() {
			return preferred
		}
	}
	return getDefaultSaveDir()
}

// cleanAbs resolves path to absolute + cleaned form. Rejects NUL bytes and empty.
func cleanAbs(p string) (string, error) {
	if strings.ContainsRune(p, 0) {
		return "", fmt.Errorf("invalid path")
	}
	p = strings.TrimSpace(p)
	if p == "" {
		return "", fmt.Errorf("empty path")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

// isSafeMarkdownPath allows only markdown-ish files. Blocks dotfiles inside
// hidden dirs? No — allows them, but blocks executables and null bytes.
// This prevents /api/save from overwriting ~/.bashrc or binaries by mistake
// while keeping the workspace open (Typora-style: any .md anywhere).
func isSafeMarkdownPath(abs string) bool {
	ext := strings.ToLower(filepath.Ext(abs))
	switch ext {
	case ".md", ".markdown", ".txt", ".mdown", ".mkd", ".mdwn", ".mdx":
		return true
	}
	return false
}

// isSafeImagePath guards /api/asset: only pictures referenced by a document can
// be served, never arbitrary files.
func isSafeImagePath(abs string) bool {
	switch strings.ToLower(filepath.Ext(abs)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg", ".ico":
		return true
	}
	return false
}

func checkToken(r *http.Request) bool {
	// Token via header (fetch) or query (?token= for window.open / img).
	if r.Header.Get("X-Typecraft-Token") == appToken && appToken != "" {
		return true
	}
	if r.URL.Query().Get("token") == appToken && appToken != "" {
		return true
	}
	return false
}

func initRecents() {
	cfgDir := filepath.Join(getHomeDir(), ".typecraft")
	_ = os.MkdirAll(cfgDir, 0o755)
	recentsPath = filepath.Join(cfgDir, "recents.json")

	data, err := os.ReadFile(recentsPath)
	if err == nil {
		var list []string
		if json.Unmarshal(data, &list) == nil {
			recentsList = list
		}
	}
}

func addRecent(p string) {
	if p == "" {
		return
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = p
	}

	recentsMu.Lock()
	defer recentsMu.Unlock()

	var updated []string
	updated = append(updated, abs)
	for _, item := range recentsList {
		if item != abs && len(updated) < 20 {
			if _, err := os.Stat(item); err == nil {
				updated = append(updated, item)
			}
		}
	}
	recentsList = updated

	data, err := json.MarshalIndent(recentsList, "", "  ")
	if err == nil {
		_ = os.WriteFile(recentsPath, data, 0o644)
	}
}

func isMarkdown(path string) bool {
	return isSafeMarkdownPath(path)
}

func buildWorkspaceTree(root string, depth int) (*FileNode, error) {
	if depth > 5 {
		return nil, nil
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}

	node := &FileNode{
		Name:  info.Name(),
		Path:  root,
		IsDir: info.IsDir(),
	}

	if !info.IsDir() {
		return node, nil
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return node, nil
	}

	// Deterministic order (Typora-style file tree).
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.IsDir() != b.IsDir() {
			return a.IsDir()
		}
		return strings.ToLower(a.Name()) < strings.ToLower(b.Name())
	})

	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") || name == "node_modules" || name == ".git" {
			continue
		}
		childPath := filepath.Join(root, name)
		// Never follow symlinks out of the workspace (avoid loops).
		if fi, err := os.Lstat(childPath); err == nil && fi.Mode()&os.ModeSymlink != 0 {
			continue
		}
		if entry.IsDir() {
			childNode, _ := buildWorkspaceTree(childPath, depth+1)
			// Keep empty dirs too (unlike before): user can create files in them.
			if childNode != nil {
				node.Children = append(node.Children, childNode)
			}
		} else if isMarkdown(name) {
			node.Children = append(node.Children, &FileNode{
				Name:  name,
				Path:  childPath,
				IsDir: false,
			})
		}
	}
	return node, nil
}

func atomicWrite(filename string, data []byte) error {
	dir := filepath.Dir(filename)
	tmpFile, err := os.CreateTemp(dir, ".typecraft_tmp_*")
	if err != nil {
		return err
	}
	tmpName := tmpFile.Name()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpName)
	}()

	if _, err := tmpFile.Write(data); err != nil {
		return err
	}
	if err := tmpFile.Sync(); err != nil {
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	return os.Rename(tmpName, filename)
}

func dirExists(p string) bool {
	if p == "" {
		return false
	}
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func getStandardDirs(home string) (docs, desktop, downloads string) {
	if home == "" {
		return "", "", ""
	}
	for _, cand := range []string{"Documents", "Documenti"} {
		p := filepath.Join(home, cand)
		if dirExists(p) {
			docs = p
			break
		}
	}
	if docs == "" {
		docs = filepath.Join(home, "Documents")
	}
	for _, cand := range []string{"Desktop", "Scrivania"} {
		p := filepath.Join(home, cand)
		if dirExists(p) {
			desktop = p
			break
		}
	}
	if desktop == "" {
		desktop = filepath.Join(home, "Desktop")
	}
	for _, cand := range []string{"Downloads", "Scaricati"} {
		p := filepath.Join(home, cand)
		if dirExists(p) {
			downloads = p
			break
		}
	}
	if downloads == "" {
		downloads = filepath.Join(home, "Downloads")
	}
	return
}

func sanitizeLinuxEnv(cmd *exec.Cmd) {
	if runtime.GOOS != "linux" {
		return
	}
	env := os.Environ()
	filtered := make([]string, 0, len(env))
	for _, e := range env {
		if strings.HasPrefix(e, "LD_LIBRARY_PATH=") ||
			strings.HasPrefix(e, "LD_PRELOAD=") ||
			strings.HasPrefix(e, "PYTHONPATH=") ||
			strings.HasPrefix(e, "PERLLIB=") ||
			strings.HasPrefix(e, "FONTCONFIG_PATH=") ||
			strings.HasPrefix(e, "FONTCONFIG_FILE=") {
			continue
		}
		filtered = append(filtered, e)
	}
	cmd.Env = filtered
}

func detectDefaultLinuxBrowser() string {
	cmd := exec.Command("xdg-settings", "get", "default-web-browser")
	sanitizeLinuxEnv(cmd)
	if out, err := cmd.Output(); err == nil {
		s := strings.ToLower(strings.TrimSpace(string(out)))
		if strings.Contains(s, "brave") {
			return "brave-browser"
		}
		if strings.Contains(s, "google-chrome") || strings.Contains(s, "chrome") {
			return "google-chrome"
		}
		if strings.Contains(s, "chromium") {
			return "chromium"
		}
		if strings.Contains(s, "edge") {
			return "microsoft-edge"
		}
	}
	return ""
}

func openDesktopWindow(targetURL string, forceApp bool) {
	time.Sleep(200 * time.Millisecond)
	sep := "?"
	if strings.Contains(targetURL, "?") {
		sep = "&"
	}
	targetURL = targetURL + sep + "token=" + appToken

	if !forceApp {
		openDefaultBrowser(targetURL)
		return
	}

	// Browser candidates
	browsers := []string{}
	switch runtime.GOOS {
	case "darwin":
		browsers = []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		}
	case "windows":
		browsers = []string{
			os.Getenv("PROGRAMFILES") + `\Google\Chrome\Application\chrome.exe`,
			os.Getenv("PROGRAMFILES(X86)") + `\Google\Chrome\Application\chrome.exe`,
			os.Getenv("LOCALAPPDATA") + `\Google\Chrome\Application\chrome.exe`,
			os.Getenv("PROGRAMFILES(X86)") + `\Microsoft\Edge\Application\msedge.exe`,
		}
	default: // Linux / Unix
		def := detectDefaultLinuxBrowser()
		allLinux := []string{
			"brave-browser",
			"google-chrome",
			"google-chrome-stable",
			"chromium",
			"chromium-browser",
			"microsoft-edge",
		}
		if def != "" {
			browsers = append(browsers, def)
		}
		for _, b := range allLinux {
			if b != def {
				browsers = append(browsers, b)
			}
		}
	}

	profileDir := filepath.Join(getHomeDir(), ".typecraft", "browser-profile")
	_ = os.MkdirAll(profileDir, 0o700)

	appLaunched := false
	for _, b := range browsers {
		binPath, err := exec.LookPath(b)
		if err == nil && binPath != "" {
			var args []string
			if runtime.GOOS == "linux" {
				args = []string{
					"--user-data-dir=" + profileDir,
					"--app=" + targetURL,
					"--class=TypeCraft",
					"--name=TypeCraft",
					"--no-first-run",
					"--no-default-browser-check",
				}
			} else {
				args = []string{"--app=" + targetURL, "--new-window"}
			}
			cmd := exec.Command(binPath, args...)
			sanitizeLinuxEnv(cmd)
			if err := cmd.Start(); err == nil {
				appLaunched = true
				break
			}
		}
	}

	if !appLaunched {
		openDefaultBrowser(targetURL)
	}
}

func openDefaultBrowser(u string) {
	switch runtime.GOOS {
	case "darwin":
		cmd := exec.Command("open", u)
		_ = cmd.Start()
	case "windows":
		cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
		_ = cmd.Start()
	default:
		for _, tool := range []string{"xdg-open", "gio", "gnome-open", "kde-open", "sensible-browser", "firefox", "x-www-browser"} {
			if bin, err := exec.LookPath(tool); err == nil && bin != "" {
				var cmd *exec.Cmd
				if tool == "gio" {
					cmd = exec.Command(bin, "open", u)
				} else {
					cmd = exec.Command(bin, u)
				}
				sanitizeLinuxEnv(cmd)
				if err := cmd.Start(); err == nil {
					return
				}
			}
		}
	}
}

func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Origin check (DNS-rebinding mitigation) + token check (real auth).
		// Token is generated at startup and injected via /api/init.
		origin := r.Header.Get("Origin")
		if origin != "" && !strings.HasPrefix(origin, "http://127.0.0.1") && !strings.HasPrefix(origin, "http://localhost") {
			http.Error(w, "Forbidden origin", http.StatusForbidden)
			return
		}
		// Public endpoints: landing page, init handshake (issues token to local UI).
		if r.URL.Path == "/" || r.URL.Path == "/api/init" || strings.HasPrefix(r.URL.Path, "/static/") {
			next(w, r)
			return
		}
		if !checkToken(r) {
			http.Error(w, "missing or invalid token", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// securityHeaders hardens the local UI: the app never loads remote code, and a
// document cannot leak the ?token= of the window through the Referer header.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; "+
				"base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

// --- Single instance (rubato a Ferrite: lockfile + TCP forward) ---
func instanceLockPath() string {
	return filepath.Join(getHomeDir(), ".typecraft", "instance.lock")
}

// ---------------------------------------------------------------- Event hub
//
// Keeps the UI in sync when a second process forwards files to the primary.
type eventHub struct {
	mu   sync.Mutex
	subs map[chan string]struct{}
}

func newEventHub() *eventHub {
	return &eventHub{subs: make(map[chan string]struct{})}
}

func (h *eventHub) subscribe() chan string {
	cancelIdleShutdown()
	ch := make(chan string, 8)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *eventHub) unsubscribe(ch chan string) {
	h.mu.Lock()
	if _, ok := h.subs[ch]; ok {
		delete(h.subs, ch)
		close(ch)
	}
	remaining := len(h.subs)
	h.mu.Unlock()

	if h == events && remaining == 0 && !noBrowser {
		scheduleIdleShutdown(4 * time.Second)
	}
}

func (h *eventHub) publish(path string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- path:
		default: // slow client: drop instead of blocking the editor
		}
	}
}

// count reports how many windows are currently attached. When it is zero the
// server is alive but nobody is showing the document (the user closed the app
// window), so a launcher must open a fresh one instead of just forwarding.
func (h *eventHub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

type instanceInfo struct {
	Port    int    `json:"port"`
	Control string `json:"control"`
}

// openForwardedFile applies a path received from a second launcher and tells
// every connected UI to open it.
func openForwardedFile(p string) {
	if p == "" || p == "__FOCUS__" {
		events.publish("__FOCUS__")
		return
	}
	abs, err := cleanAbs(p)
	if err != nil || !isSafeMarkdownPath(abs) {
		return
	}
	activeFileMu.Lock()
	activePath = abs
	activeDir = filepath.Dir(abs)
	activeFileMu.Unlock()
	events.publish(abs)
}

// forwardToPrimary hands the file list to a running instance over HTTP (the old
// implementation wrote raw text to the HTTP port, so the file was silently lost).
func forwardToPrimary(args []string) bool {
	data, err := os.ReadFile(instanceLockPath())
	if err != nil {
		return false
	}
	var info instanceInfo
	if json.Unmarshal(data, &info) != nil || info.Port <= 0 || info.Port > 65535 || info.Control == "" {
		_ = os.Remove(instanceLockPath()) // lock from an older/incomplete run
		return false
	}

	paths := make([]string, 0, len(args))
	for _, a := range args {
		if abs, err := cleanAbs(a); err == nil {
			paths = append(paths, abs)
		}
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"paths": paths,
		"focus": len(paths) == 0,
	})

	url := fmt.Sprintf("http://127.0.0.1:%d/api/internal/open", info.Port)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Typecraft-Control", info.Control)

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		_ = os.Remove(instanceLockPath()) // stale lock, we are the primary now
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	return resp.StatusCode == http.StatusOK
}

// handleInternalOpen is the single-instance control channel. It is
// authenticated with a per-run secret stored in the 0600 lock file, never with
// the UI token, so no page and no other local process can drive it.
func handleInternalOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if controlToken == "" || r.Header.Get("X-Typecraft-Control") != controlToken {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Paths []string `json:"paths"`
		Focus bool     `json:"focus"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}
	if req.Focus || len(req.Paths) == 0 {
		openForwardedFile("__FOCUS__")
	}
	for _, p := range req.Paths {
		openForwardedFile(p)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, "ok")

	// Nobody is showing the document: the window was closed while the server kept
	// running. Re-open the UI instead of silently swallowing the request (this is
	// why a second double-click on the AppImage appeared to do nothing).
	if events.count() == 0 && !noBrowser {
		go openDesktopWindow(primaryURL(), appMode)
	}
}

func writeInstanceLock(port int) {
	cfgDir := filepath.Join(getHomeDir(), ".typecraft")
	_ = os.MkdirAll(cfgDir, 0o755)
	data, _ := json.Marshal(instanceInfo{Port: port, Control: controlToken})
	_ = os.WriteFile(instanceLockPath(), data, 0o600)
}

func removeInstanceLock() {
	_ = os.Remove(instanceLockPath())
}

func setupMux() *http.ServeMux {
	mux := http.NewServeMux()

	// API endpoints
	mux.HandleFunc("/api/init", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		activeFileMu.RLock()
		curPath := activePath
		curDir := activeDir
		activeFileMu.RUnlock()

		content := ""
		if curPath != "" {
			if data, err := os.ReadFile(curPath); err == nil {
				content = string(data)
			}
		}

		recentsMu.Lock()
		recentsCopy := make([]string, len(recentsList))
		copy(recentsCopy, recentsList)
		recentsMu.Unlock()

		resp := InitResponse{
			Version:     version,
			Token:       appToken,
			ActiveFile:  curPath,
			ActiveDir:   curDir,
			DefaultDir:  defaultSaveDir(curDir),
			Recents:     recentsCopy,
			FileContent: content,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))

	mux.HandleFunc("/api/file", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		filePath := r.URL.Query().Get("path")
		if filePath == "" {
			http.Error(w, "missing path", http.StatusBadRequest)
			return
		}

		cleanPath, err := cleanAbs(filePath)
		if err != nil {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}

		if !isSafeMarkdownPath(cleanPath) {
			http.Error(w, "forbidden: only markdown files are accessible", http.StatusForbidden)
			return
		}

		content, err := os.ReadFile(cleanPath)
		if err != nil {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}

		var modTime int64
		if fi, err := os.Stat(cleanPath); err == nil {
			modTime = fi.ModTime().UnixNano()
		}

		activeFileMu.Lock()
		activePath = cleanPath
		activeDir = filepath.Dir(cleanPath)
		activeFileMu.Unlock()
		addRecent(cleanPath)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(FileResponse{
			Path:     cleanPath,
			Content:  string(content),
			ModTime:  modTime,
			ReadOnly: false,
		})
	}))

	mux.HandleFunc("/api/save", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req SaveRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json payload", http.StatusBadRequest)
			return
		}

		if req.Path == "" {
			http.Error(w, "path is required", http.StatusBadRequest)
			return
		}

		cleanPath, err := cleanAbs(req.Path)
		if err != nil {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}

		// Security: save refuses paths that do not end in markdown extensions.
		if !isSafeMarkdownPath(cleanPath) {
			http.Error(w, "forbidden: cannot save as non-markdown file", http.StatusForbidden)
			return
		}

		// Conflict detection: verify modification time if file exists
		if fi, err := os.Stat(cleanPath); err == nil {
			diskMod := fi.ModTime().UnixNano()
			if req.ModTime > 0 && diskMod > req.ModTime {
				// File changed externally on disk
				http.Error(w, "conflict: file modified on disk", http.StatusConflict)
				return
			}
		}

		// Atomic write
		if err := atomicWrite(cleanPath, []byte(req.Content)); err != nil {
			http.Error(w, fmt.Sprintf("failed to save: %v", err), http.StatusInternalServerError)
			return
		}

		var newModTime int64
		if fi, err := os.Stat(cleanPath); err == nil {
			newModTime = fi.ModTime().UnixNano()
		}

		activeFileMu.Lock()
		activePath = cleanPath
		activeDir = filepath.Dir(cleanPath)
		activeFileMu.Unlock()
		addRecent(cleanPath)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(SaveResponse{
			Success: true,
			Path:    cleanPath,
			ModTime: newModTime,
		})
	}))

	// Interactive filesystem browser for Save As / Open dialog
	mux.HandleFunc("/api/fs", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		reqPath := strings.TrimSpace(r.URL.Query().Get("path"))
		home := getHomeDir()
		docsDir, desktopDir, downloadsDir := getStandardDirs(home)

		activeFileMu.RLock()
		curDir := activeDir
		activeFileMu.RUnlock()

		if reqPath == "" || reqPath == "~" {
			if curDir != "" && dirExists(curDir) {
				reqPath = curDir
			} else if docsDir != "" && dirExists(docsDir) {
				reqPath = docsDir
			} else if home != "" {
				reqPath = home
			} else {
				reqPath = "."
			}
		}

		abs, err := cleanAbs(reqPath)
		if err != nil {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}

		st, err := os.Stat(abs)
		if err != nil || !st.IsDir() {
			http.Error(w, "directory not found", http.StatusNotFound)
			return
		}

		entries, err := os.ReadDir(abs)
		if err != nil {
			http.Error(w, "cannot read directory: "+err.Error(), http.StatusInternalServerError)
			return
		}

		type fsItem struct {
			Name  string `json:"name"`
			IsDir bool   `json:"is_dir"`
			Size  int64  `json:"size"`
		}

		var items []fsItem
		for _, e := range entries {
			name := e.Name()
			if strings.HasPrefix(name, ".") {
				continue // skip hidden files and directories
			}
			if e.IsDir() {
				items = append(items, fsItem{Name: name, IsDir: true, Size: 0})
			} else if isSafeMarkdownPath(name) {
				var sz int64
				if info, err := e.Info(); err == nil {
					sz = info.Size()
				}
				items = append(items, fsItem{Name: name, IsDir: false, Size: sz})
			}
		}

		sort.Slice(items, func(i, j int) bool {
			if items[i].IsDir != items[j].IsDir {
				return items[i].IsDir // directories first
			}
			return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
		})

		parent := filepath.Dir(abs)
		if parent == abs {
			parent = ""
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"current":   abs,
			"parent":    parent,
			"home":      home,
			"documents": docsDir,
			"desktop":   desktopDir,
			"downloads": downloadsDir,
			"workspace": curDir,
			"items":     items,
		})
	}))

	// Create directory endpoint
	mux.HandleFunc("/api/mkdir", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Path string `json:"path"`
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" || strings.ContainsAny(req.Name, `/\`) || strings.HasPrefix(req.Name, ".") {
			http.Error(w, "invalid folder name", http.StatusBadRequest)
			return
		}
		absParent, err := cleanAbs(req.Path)
		if err != nil {
			http.Error(w, "invalid parent path", http.StatusBadRequest)
			return
		}
		target := filepath.Join(absParent, req.Name)
		if err := os.MkdirAll(target, 0o755); err != nil {
			http.Error(w, "cannot create folder: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"path":    target,
		})
	}))

	// Rename / Move / Save As endpoint
	mux.HandleFunc("/api/rename", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			OldPath string `json:"old_path"`
			NewPath string `json:"new_path"`
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}

		newAbs, err := cleanAbs(req.NewPath)
		if err != nil {
			http.Error(w, "invalid new path", http.StatusBadRequest)
			return
		}
		if !isSafeMarkdownPath(newAbs) {
			newAbs += ".md"
		}

		if err := os.MkdirAll(filepath.Dir(newAbs), 0o755); err != nil {
			http.Error(w, "cannot create target folder: "+err.Error(), http.StatusInternalServerError)
			return
		}

		oldAbs := ""
		if req.OldPath != "" {
			if a, err := cleanAbs(req.OldPath); err == nil {
				oldAbs = a
			}
		}

		if err := atomicWrite(newAbs, []byte(req.Content)); err != nil {
			http.Error(w, "failed to save file: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// If renaming an existing file and path changed, delete the old file
		if oldAbs != "" && oldAbs != newAbs {
			if _, err := os.Stat(oldAbs); err == nil {
				_ = os.Remove(oldAbs)
			}
		}

		var newMod int64
		if fi, err := os.Stat(newAbs); err == nil {
			newMod = fi.ModTime().UnixNano()
		}

		activeFileMu.Lock()
		activePath = newAbs
		activeDir = filepath.Dir(newAbs)
		activeFileMu.Unlock()
		addRecent(newAbs)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"path":     newAbs,
			"mod_time": newMod,
		})
	}))

	// SaveResponse kept for tests/compat.

	mux.HandleFunc("/api/workspace", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		dir := r.URL.Query().Get("path")
		if dir == "" {
			activeFileMu.RLock()
			dir = activeDir
			activeFileMu.RUnlock()
		}
		if dir == "" {
			dir = "."
		}

		absDir, err := cleanAbs(dir)
		if err != nil {
			http.Error(w, "invalid directory", http.StatusBadRequest)
			return
		}

		tree, err := buildWorkspaceTree(absDir, 3)
		if err != nil {
			http.Error(w, "cannot scan workspace", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"root": absDir,
			"tree": tree,
		})
	}))

	mux.HandleFunc("/api/export/html", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			HTML  string `json:"html"`
			Title string `json:"title"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(req.HTML))
	}))

	// /api/asset serves pictures referenced by the open document (![alt](./img.png)),
	// scoped strictly to the document directory and its descendants (path traversal guard).
	mux.HandleFunc("/api/asset", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		rawPath := r.URL.Query().Get("path")
		if rawPath == "" {
			http.Error(w, "missing path", http.StatusBadRequest)
			return
		}

		activeFileMu.RLock()
		baseDir := activeDir
		activeFileMu.RUnlock()

		target := rawPath
		if !filepath.IsAbs(target) {
			if baseDir == "" {
				http.Error(w, "no active document directory", http.StatusBadRequest)
				return
			}
			target = filepath.Join(baseDir, target)
		}

		cleanTarget, err := cleanAbs(target)
		if err != nil {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}

		if !isSafeImagePath(cleanTarget) {
			http.Error(w, "forbidden asset path", http.StatusForbidden)
			return
		}

		http.ServeFile(w, r, cleanTarget)
	}))

	// /api/events is a Server-Sent-Events stream: a second launcher forwards a
	// file and every open window reacts without polling the disk.
	mux.HandleFunc("/api/events", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		ch := events.subscribe()
		defer events.unsubscribe(ch)

		_, _ = io.WriteString(w, ": connected\n\n")
		flusher.Flush()

		ping := time.NewTicker(25 * time.Second)
		defer ping.Stop()
		for {
			select {
			case path, open := <-ch:
				if !open {
					return
				}
				payload, _ := json.Marshal(path)
				_, _ = fmt.Fprintf(w, "event: open\ndata: %s\n\n", payload)
				flusher.Flush()
			case <-ping.C:
				_, _ = io.WriteString(w, ": ping\n\n")
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))

	mux.HandleFunc("/api/internal/open", handleInternalOpen)

	// Embedded web assets
	webContent, err := fs.Sub(embeddedWebFS, "web")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Fatal: failed to load embedded web assets: %v\n", err)
		os.Exit(1)
	}

	fileServer := http.FileServer(http.FS(webContent))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		fileServer.ServeHTTP(w, r)
	})

	return mux
}

func main() {
	initSecurityToken()
	initRecents()

	portFlag := flag.Int("port", 0, "Port to listen on (0 for automatic)")
	noBrowserFlag := flag.Bool("no-browser", false, "Do not launch app window or browser")
	appFlag := flag.Bool("app", true, "Try to launch in application standalone window")
	verFlag := flag.Bool("version", false, "Print version")
	flag.Parse()

	if *verFlag {
		fmt.Printf("TypeCraft v%s — Minimalist Markdown Editor\n", version)
		return
	}
	appMode = *appFlag
	noBrowser = *noBrowserFlag

	args := flag.Args()
	// Single-instance: se c'e' gia' un TypeCraft, inoltra il file e esci (come Ferrite).
	if forwardToPrimary(args) {
		fmt.Println("TypeCraft e' gia' in esecuzione — file inoltrato all'istanza esistente.")
		return
	}
	if len(args) > 0 {
		target := args[0]
		if abs, err := cleanAbs(target); err == nil {
			info, err := os.Stat(abs)
			if err == nil {
				if info.IsDir() {
					activeDir = abs
				} else {
					activePath = abs
					activeDir = filepath.Dir(abs)
					addRecent(abs)
				}
			} else {
				activePath = abs
				activeDir = filepath.Dir(abs)
			}
		}
	}

	if activeDir == "" {
		if pwd, err := os.Getwd(); err == nil {
			activeDir = pwd
		}
	}

	mux := setupMux()
	listenAddr := fmt.Sprintf("127.0.0.1:%d", *portFlag)
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error starting TypeCraft server: %v\n", err)
		os.Exit(1)
	}

	actualPort := listener.Addr().(*net.TCPAddr).Port
	primaryPort = actualPort
	appURL := fmt.Sprintf("http://127.0.0.1:%d", actualPort)
	writeInstanceLock(actualPort)
	defer removeInstanceLock()
	// Porta scritta anche su file per modalita' --no-browser / Windows GUI.
	portFilePath := filepath.Join(getHomeDir(), ".typecraft", "port")
	_ = os.WriteFile(portFilePath, []byte(strconv.Itoa(actualPort)), 0o644)
	defer os.Remove(portFilePath)

	fmt.Println("=====================================================")
	fmt.Printf(" TypeCraft v%s — Minimalist Markdown Editor\n", version)
	fmt.Printf(" Server running on: %s\n", appURL)
	if activePath != "" {
		fmt.Printf(" Active file:       %s\n", activePath)
	}
	fmt.Println(" Press Ctrl+C to terminate.")
	fmt.Println("=====================================================")

	if !*noBrowserFlag {
		go openDesktopWindow(appURL, *appFlag)
	}

	server := &http.Server{
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)

	serverShutdownFn = func() {
		select {
		case stopChan <- syscall.SIGTERM:
		default:
		}
	}

	go func() {
		<-stopChan
		cancelIdleShutdown()
		fmt.Println("\nShutting down TypeCraft...")
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
	}
}
