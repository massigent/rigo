package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
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
	"net/url"
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
	version      = "1.1.0"
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
	Version     string `json:"version"`
	Token       string `json:"token"`
	ActiveFile  string `json:"active_file"`
	ActiveDir   string `json:"active_dir"`
	DefaultDir  string `json:"default_dir"`
	FileContent string `json:"file_content"`
	// FileRevision describes exactly FileContent: both come from the same
	// snapshot read (see readDiskSnapshot). Empty only when the file is missing.
	FileRevision string `json:"file_revision"`
	// FileExists distinguishes "the active file is really empty" (true, with a
	// revision over the empty bytes) from "the active file is gone" (false).
	FileExists bool `json:"file_exists"`
	// ReadOnly is the application write policy for the active file; it is not
	// part of the content revision. ReadOnlyReason is advisory metadata.
	ReadOnly       bool     `json:"read_only"`
	ReadOnlyReason string   `json:"read_only_reason,omitempty"`
	Recents        []string `json:"recents"`
	OS             string   `json:"os"`
}

type SaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	// ExpectedRevision is the opaque disk revision the client last read for this
	// path. It is required to overwrite an existing file (unless Force is set)
	// and is compared for equality, never by order.
	ExpectedRevision string `json:"expected_revision,omitempty"`
	// Force is the explicit one-shot overwrite authorised by the user after a
	// conflict. It is not a persistent flag and it never resurrects a deleted
	// file that the client knew about.
	Force bool `json:"force,omitempty"`
	// ModTime is the legacy baseline. It is accepted for JSON compatibility but
	// ignored: a legacy client sending only mod_time (including 0) now gets 428
	// revision_required instead of silently bypassing the check.
	ModTime int64 `json:"mod_time,omitempty"`
}

type SaveResponse struct {
	Success bool   `json:"success"`
	Path    string `json:"path"`
	// Revision is the opaque disk revision of the content that was written.
	Revision string `json:"revision"`
	// ModTime is metadata only (unix nano), never an integrity criterion.
	ModTime  int64  `json:"mod_time,omitempty"`
	ReadOnly bool   `json:"read_only"`
	Error    string `json:"error,omitempty"`
}

type FileResponse struct {
	Path           string `json:"path"`
	Content        string `json:"content"`
	Revision       string `json:"revision"`
	ModTime        int64  `json:"mod_time"`
	ReadOnly       bool   `json:"read_only"`
	ReadOnlyReason string `json:"read_only_reason,omitempty"`
}

type StatResponse struct {
	Path           string `json:"path"`
	Exists         bool   `json:"exists"`
	Revision       string `json:"revision"`
	ModTime        int64  `json:"mod_time"`
	Size           int64  `json:"size"`
	ReadOnly       bool   `json:"read_only"`
	ReadOnlyReason string `json:"read_only_reason,omitempty"`
}

type FileNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"`
	IsDir    bool        `json:"is_dir"`
	Children []*FileNode `json:"children,omitempty"`
}

func randomToken() string {
	b := make([]byte, 16)
	// A local secret must never degrade to a predictable value: if the system
	// CSPRNG is unavailable there is no safe fallback, so fail hard.
	if _, err := rand.Read(b); err != nil {
		panic("rigo: crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b)
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
		for _, cand := range []string{"Documents", "Documenti"} {
			doc := filepath.Join(h, cand)
			if st, err := os.Stat(doc); err == nil && st.IsDir() {
				return doc
			}
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
// while keeping the workspace open: any .md anywhere.
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

// tokenEqual compares secrets in constant time so a local process cannot learn
// the token byte by byte from response timing.
func tokenEqual(got, want string) bool {
	if want == "" || len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func checkToken(r *http.Request) bool {
	// Token via header (fetch) or query (?token= for EventSource and <img>,
	// which cannot set headers). The launched browser URL itself carries no
	// token: the page receives it through the /api/init handshake.
	if tokenEqual(r.Header.Get("X-Rigo-Token"), appToken) {
		return true
	}
	return tokenEqual(r.URL.Query().Get("token"), appToken)
}

// --------------------------------------------------------------- HTTP boundary
//
// The UI is served on 127.0.0.1 with an ephemeral port and a random token, but
// neither a loopback listener nor a token alone stops DNS rebinding: a page
// hosted on attacker.example can make that name resolve to 127.0.0.1, so its
// requests arrive with Host: attacker.example:<port> and often no Origin at all
// (several GETs never send one). httpBoundary is the immutable authority policy
// of one instance: it is built once from the effective listener port and is
// enforced for every path (static assets, the /api/init handshake, tokenised
// APIs, SSE, the internal channel and unknown paths) before any handler runs.
//
// Policy:
//   - request authority is taken from r.Host (the effective authority, also for
//     absolute-form requests), parsed structurally, never resolved via DNS;
//   - accepted hostnames are exactly "127.0.0.1" and "localhost"
//     (case-insensitive). IPv6 literals are not served by the 127.0.0.1
//     listener and are refused;
//   - the port must be the effective listener port (the scheme default port may
//     be omitted, which a browser does for port 80);
//   - a malformed or ambiguous authority is refused;
//   - Forwarded / X-Forwarded-Host / X-Forwarded-Proto are never consulted: the
//     app is not behind a reverse proxy and those headers grant no trust;
//   - an Origin header, when present, must be exactly one value, with no
//     userinfo/path/query/fragment, the same scheme, and the same host and
//     effective port as the (already validated) request Host, i.e. same-origin;
//     "null", external origins, different schemes/ports and multiple values are
//     refused. Absence of Origin is allowed only after a valid Host.
//
// Rejections are always 403 (malformed authority included, so the response does
// not distinguish "malformed" from "not allowed"), carry the security headers
// because the boundary runs inside securityHeaders, and never expose document
// content, the UI token or the control secret.
type httpBoundary struct {
	port   int
	scheme string
	hosts  []string
}

// newLoopbackBoundary fixes the allowed authorities for one listener. The slice
// is never mutated after construction, so the policy cannot change at runtime.
func newLoopbackBoundary(port int) *httpBoundary {
	return &httpBoundary{
		port:   port,
		scheme: "http",
		hosts:  []string{"127.0.0.1", "localhost"},
	}
}

func (b *httpBoundary) defaultPort() int {
	if b.scheme == "https" {
		return 443
	}
	return 80
}

// parseAuthority splits a Host-style authority into a hostname and port. Only
// "host" and "host:port" are accepted: the instance listens on IPv4 loopback
// only, so every bracketed/IPv6 literal is refused instead of being
// canonicalised (net.IP.String() would collapse "::ffff:127.0.0.1" into
// "127.0.0.1" and silently admit an authority the policy never listed, or make
// two distinct browser origins look identical). Empty, ambiguous or
// non-canonical forms (leading zeros in the port, userinfo, paths, whitespace,
// extra colons) are refused too.
func parseAuthority(raw string) (host, port string, hasPort, ok bool) {
	if raw == "" || strings.ContainsAny(raw, " \t\r\n\x00/?#@\\,;\"'<>[]") {
		return "", "", false, false
	}
	if idx := strings.LastIndexByte(raw, ':'); idx >= 0 {
		if strings.Contains(raw[:idx], ":") {
			return "", "", false, false // unbracketed IPv6 or ambiguous
		}
		host, port = raw[:idx], raw[idx+1:]
		if !validPortText(port) {
			return "", "", false, false
		}
		return host, port, true, true
	}
	return raw, "", false, true
}

func validPortText(p string) bool {
	if p == "" || len(p) > 5 {
		return false
	}
	for i := 0; i < len(p); i++ {
		if p[i] < '0' || p[i] > '9' {
			return false
		}
	}
	n, err := strconv.Atoi(p)
	if err != nil || n < 1 || n > 65535 {
		return false
	}
	return strconv.Itoa(n) == p // refuse leading zeros / non-canonical forms
}

func (b *httpBoundary) hostNameAllowed(host string) bool {
	host = strings.ToLower(host)
	for _, allowed := range b.hosts {
		if host == allowed {
			return true
		}
	}
	return false
}

func (b *httpBoundary) authorityAllowed(host string, port string, hasPort bool) bool {
	if !b.hostNameAllowed(host) {
		return false
	}
	if hasPort {
		return port == strconv.Itoa(b.port)
	}
	// A browser omits the port only for the scheme default (http -> 80).
	return b.port == b.defaultPort()
}

func (b *httpBoundary) hostAllowed(rawHost string) bool {
	host, port, hasPort, ok := parseAuthority(rawHost)
	if !ok {
		return false
	}
	return b.authorityAllowed(host, port, hasPort)
}

func (b *httpBoundary) effectivePort(port string, hasPort bool) int {
	if hasPort {
		n, _ := strconv.Atoi(port)
		return n
	}
	return b.defaultPort()
}

// originAllowed validates one Origin header value against the request authority
// (which the caller has already validated). Same-origin only: the UI is served
// from the same host/port that it calls, so a legitimate fetch sends exactly the
// request authority.
func (b *httpBoundary) originAllowed(reqHost, origin string) bool {
	if origin == "" || strings.ContainsAny(origin, " \t\r\n") {
		return false
	}
	// An Origin is a serialised origin and never carries a fragment delimiter,
	// not even an empty one: net/url drops the "#" of "http://host:port#", so the
	// Fragment/RawFragment fields alone cannot detect it.
	if strings.Contains(origin, "#") {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if !strings.EqualFold(u.Scheme, b.scheme) || u.User != nil || u.Opaque != "" || u.Host == "" {
		return false
	}
	// An Origin is a serialised origin: no path, query or fragment is allowed.
	if u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" {
		return false
	}
	originHost, originPort, originHasPort, ok := parseAuthority(u.Host)
	if !ok || !b.authorityAllowed(originHost, originPort, originHasPort) {
		return false
	}
	reqName, reqPort, reqHasPort, ok := parseAuthority(reqHost)
	if !ok {
		return false
	}
	if !strings.EqualFold(originHost, reqName) {
		return false
	}
	return b.effectivePort(originPort, originHasPort) == b.effectivePort(reqPort, reqHasPort)
}

// localBoundaryMiddleware applies the policy before any handler can read the
// request or mutate state. The Origin header is checked only when present, and
// only after the Host has been accepted.
func localBoundaryMiddleware(b *httpBoundary, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if b == nil || !b.hostAllowed(r.Host) {
			http.Error(w, "forbidden: host not allowed", http.StatusForbidden)
			return
		}
		if origins := r.Header.Values("Origin"); len(origins) > 0 {
			if len(origins) != 1 || !b.originAllowed(r.Host, origins[0]) {
				http.Error(w, "forbidden: origin not allowed", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// newHTTPHandler is the single composition point of the local HTTP stack: main()
// builds it once from the real listener port and the integration tests build the
// same stack from a real loopback listener, so there is exactly one Host/Origin
// policy and it is the one that actually runs.
func newHTTPHandler(mux http.Handler, boundary *httpBoundary) http.Handler {
	return securityHeaders(localBoundaryMiddleware(boundary, mux))
}

// migrateLegacyConfig carries the previous release's state over to the new
// config directory, so an upgrade does not lose the recents list or the
// editor preferences. It only acts when the new file/directory is absent and
// the old one exists; every failure is ignored (a missing migration is
// harmless, a crash on startup is not).
func migrateLegacyConfig() {
	home := getHomeDir()
	newDir := filepath.Join(home, ".rigo")
	oldDir := filepath.Join(home, ".typecraft")
	for _, name := range []string{"recents.json"} {
		dst := filepath.Join(newDir, name)
		src := filepath.Join(oldDir, name)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		data, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		_ = os.MkdirAll(newDir, 0o755)
		_ = atomicWrite(dst, data)
	}

	// The browser profile holds the editor's own preferences (theme, font,
	// typewriter, focus, sound) in its localStorage. With the rename a fresh
	// profile would have silently reset all of them, so carry the directory
	// over when the new one does not exist yet. A rename keeps it atomic on
	// the same filesystem; on failure the app starts with a fresh profile,
	// exactly as before.
	newProfile := filepath.Join(newDir, "browser-profile")
	oldProfile := filepath.Join(oldDir, "browser-profile")
	if _, err := os.Stat(newProfile); os.IsNotExist(err) {
		if src, err := os.Stat(oldProfile); err == nil && src.IsDir() {
			_ = os.MkdirAll(newDir, 0o755)
			_ = os.Rename(oldProfile, newProfile)
		}
	}
}

func initRecents() {
	migrateLegacyConfig()
	cfgDir := filepath.Join(getHomeDir(), ".rigo")
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
		// Same durability as a document save: a crash in the middle of the write
		// must not leave a truncated recents.json behind.
		_ = atomicWrite(recentsPath, data)
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

	// Deterministic order (directories first, case-insensitive).
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
	// Remember the mode of the file being replaced: os.CreateTemp always makes
	// 0600, so a plain save used to silently chmod a 0644 document (and strip
	// group access on a shared folder).
	mode := fs.FileMode(0o644)
	if fi, err := os.Stat(filename); err == nil {
		mode = fi.Mode().Perm()
	}

	tmpFile, err := os.CreateTemp(dir, ".rigo_tmp_*")
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
	if err := tmpFile.Chmod(mode); err != nil {
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	if err := os.Rename(tmpName, filename); err != nil {
		return err
	}
	// Make the rename durable too: without this a crash right after a save can
	// leave the old directory entry in place on some filesystems.
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

// ------------------------------------------------------- Disk revisions
//
// A disk revision is an opaque string ("sha256:<64 lowercase hex>") computed
// over the exact bytes of one snapshot. It is compared for equality only: never
// by order, never through Number/parseInt/BigInt, so it survives JSON integer
// precision limits end to end. It is a *content fingerprint*, not a historical
// generation: A -> B -> A produces the same revision again, and replacing the
// file with identical bytes (new inode, new mtime) is not reported as a change.
const diskRevisionPrefix = "sha256:"

// diskWriteMu serialises the read-check-write sequence of save and rename inside
// this process, so two requests carrying the same baseline cannot both pass. It
// does not cover other programs: the window between verification and the atomic
// rename remains (TOCTOU), described in the handlers and in AUDIT.
var diskWriteMu sync.Mutex

func contentRevision(data []byte) string {
	sum := sha256.Sum256(data)
	return diskRevisionPrefix + hex.EncodeToString(sum[:])
}

func validDiskRevision(rev string) bool {
	if !strings.HasPrefix(rev, diskRevisionPrefix) {
		return false
	}
	h := rev[len(diskRevisionPrefix):]
	if len(h) != sha256.Size*2 {
		return false
	}
	for i := 0; i < len(h); i++ {
		c := h[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

var errUnstableSnapshot = errors.New("file changed while it was being read")

type diskSnapshot struct {
	Exists   bool
	Content  []byte
	Revision string
	ModTime  int64
	Size     int64
	Mode     os.FileMode
}

// readDiskSnapshot reads p and computes the revision of the bytes actually
// returned, so content and revision always describe the same snapshot. If the
// file is modified or replaced while it is being read (before/after fstat
// disagree, or the path no longer points at the opened inode), the read is
// retried a bounded number of times and then reported as unstable instead of
// looping.
func readDiskSnapshot(p string) (diskSnapshot, error) {
	const attempts = 3
	for i := 0; i < attempts; i++ {
		snap, stable, err := readSnapshotOnce(p)
		if err != nil {
			if os.IsNotExist(err) {
				return diskSnapshot{Exists: false}, nil
			}
			return diskSnapshot{}, err
		}
		if stable {
			return snap, nil
		}
	}
	return diskSnapshot{}, errUnstableSnapshot
}

func readSnapshotOnce(p string) (diskSnapshot, bool, error) {
	f, err := os.Open(p)
	if err != nil {
		return diskSnapshot{}, false, err
	}
	defer f.Close()

	before, err := f.Stat()
	if err != nil {
		return diskSnapshot{}, false, err
	}
	if !before.Mode().IsRegular() {
		return diskSnapshot{}, false, fmt.Errorf("not a regular file: %s", p)
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return diskSnapshot{}, false, err
	}
	after, err := f.Stat()
	if err != nil {
		return diskSnapshot{}, false, err
	}
	if before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return diskSnapshot{}, false, nil
	}
	// The path must still refer to the inode that was read: an atomic replace in
	// the middle of the read would otherwise attach the old bytes to the new
	// directory entry.
	now, err := os.Stat(p)
	if err != nil || !os.SameFile(after, now) {
		return diskSnapshot{}, false, nil
	}
	return diskSnapshot{
		Exists:   true,
		Content:  data,
		Revision: contentRevision(data),
		ModTime:  after.ModTime().UnixNano(),
		Size:     after.Size(),
		Mode:     after.Mode(),
	}, true, nil
}

// ------------------------------------------------------- Read-only policy
//
// writeProtection decides whether this application will replace/remove an
// existing file. It is a *policy* on top of the OS permissions, deliberately
// conservative:
//
//   - on POSIX, a regular file with no write bit (mode & 0222 == 0) is protected
//     even when a privileged process could still replace it through the parent
//     directory: atomic save uses rename(2), which does not need write access to
//     the file itself;
//   - when the bits allow writing, an effective access check (open O_WRONLY and
//     close, without writing or truncating) catches EACCES/EROFS/... for the
//     running user;
//   - the check never modifies content, permissions, mtime or owner.
//
// Limits (documented in AUDIT): mode.Perm() cannot express Windows ACLs or
// POSIX ACLs/groups beyond the process view; such denials are caught by the
// write itself and reported as write_forbidden (see writeFailureStatus). This is
// not a full ACL/Windows verification, only the app policy plus the OS error.
func writeProtection(path string, snap diskSnapshot) (bool, string) {
	if !snap.Exists {
		return false, ""
	}
	if snap.Mode.Perm()&0o222 == 0 {
		return true, "no_write_bits"
	}
	// Effective access check without touching the document. On POSIX a regular
	// file can be opened O_WRONLY without truncating; we close it immediately.
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		if os.IsPermission(err) || errors.Is(err, fs.ErrPermission) {
			return true, "access_denied"
		}
		// Read-only filesystem and similar hard errors: refuse rather than guess.
		return true, "write_unavailable"
	}
	_ = f.Close()
	return false, ""
}

// writeFailureStatus maps an operational write error to an API status/code. A
// permission problem discovered only when writing is still a refusal, never a
// declared success; it is reported as write_forbidden (not a content conflict).
// pathReadOnly is the destination-side variant of writeProtection: it stats the
// path (no content read) and applies the same policy to an existing regular
// file. It is used before replacing a rename destination.
func pathReadOnly(p string) (bool, string) {
	fi, err := os.Stat(p)
	if err != nil || !fi.Mode().IsRegular() {
		return false, ""
	}
	return writeProtection(p, diskSnapshot{Exists: true, Mode: fi.Mode()})
}

// copyIdentityPath resolves a path for copy alias detection only (it does not
// change the general symlink policy of the app). It walks the path component by
// component, so a relative symlink target is interpreted from the *physical*
// directory that contains the link and a `..` after a symlink is applied after
// that symlink, not with an early lexical Clean of the Readlink text. Symlinked
// directories, relative/absolute targets and dangling links are handled. Once a
// component is missing the already-resolved prefix is kept and the remaining
// components are applied lexically (no deeper entry can exist), so an existing
// prefix of a missing target still compares against the real referent.
// Symlink hops are bounded; a cycle and operational errors (ELOOP, EACCES, I/O)
// are returned explicitly, never degraded to a lexical comparison. A genuinely
// missing source or destination is not an error: absence is not aliasing.
func copyIdentityPath(p string) (string, error) {
	resolved, _, err := copyIdentityPathWithLinks(p)
	return resolved, err
}

// copyIdentityPathWithLinks is copyIdentityPath plus the canonical paths of the
// symlink *entries* actually traversed, including links reached inside a
// Readlink target. The entries are recorded with their physical parent already
// resolved, so they identify the directory entry a rename/atomic write would
// replace (the final link is not followed for this purpose).
func copyIdentityPathWithLinks(p string) (string, []string, error) {
	if p == "" {
		return "", nil, fmt.Errorf("empty path")
	}
	var resolved string
	var parts []string
	if filepath.IsAbs(p) {
		resolved = copyVolumeRoot(p)
		parts = copyPathComponents(p)
	} else {
		cwd, err := os.Getwd()
		if err != nil {
			return "", nil, err
		}
		resolved = cwd
		parts = copyPathComponents(p)
	}

	links := []string{}
	const maxLinks = 40
	hops := 0
	missing := false
	for i := 0; i < len(parts); i++ {
		comp := parts[i]
		if comp == "" || comp == "." {
			continue
		}
		if comp == ".." {
			resolved = filepath.Dir(resolved)
			continue
		}
		if missing {
			resolved = copyJoinRaw(resolved, comp)
			continue
		}
		candidate := copyJoinRaw(resolved, comp)
		fi, err := os.Lstat(candidate)
		if err != nil {
			if !os.IsNotExist(err) {
				return "", nil, err
			}
			resolved = candidate
			missing = true
			continue
		}
		if fi.Mode()&os.ModeSymlink == 0 {
			resolved = candidate
			continue
		}
		// The entry itself is what a destination write would replace: record it
		// before following the link's target.
		links = append(links, candidate)
		target, err := os.Readlink(candidate)
		if err != nil {
			return "", nil, err
		}
		hops++
		if hops > maxLinks {
			return "", nil, fmt.Errorf("too many levels of symbolic links: %s", p)
		}
		if filepath.IsAbs(target) {
			resolved = copyVolumeRoot(target)
		}
		// A relative target is appended to `resolved` (the physical parent of the
		// link) without cleaning its own `..` components first.
		rest := copyPathComponents(target)
		parts = append(rest, parts[i+1:]...)
		i = -1 // continue with the target components, then the original suffix
	}
	return filepath.Clean(resolved), links, nil
}

// copyPathComponents splits an absolute or relative path without normalising
// `..`; only the volume/root is handled separately. On Windows both separators
// are accepted, on Unix the backslash remains a legal filename character.
func copyPathComponents(p string) []string {
	p = strings.TrimPrefix(p, filepath.VolumeName(p))
	return strings.FieldsFunc(p, func(r rune) bool {
		if r == filepath.Separator {
			return true
		}
		return runtime.GOOS == "windows" && r == '/'
	})
}

func copyVolumeRoot(p string) string {
	return filepath.VolumeName(p) + string(filepath.Separator)
}

// copyJoinRaw appends one component without Clean: the caller resolves `..`
// only after the symlinks that precede it have been interpreted.
func copyJoinRaw(dir, comp string) string {
	if dir == "" {
		return comp
	}
	if strings.HasSuffix(dir, string(filepath.Separator)) {
		return dir + comp
	}
	return dir + string(filepath.Separator) + comp
}

// copyDestinationAliasesSource reports whether a copy destination identifies the
// source: same resolved path (including dangling symlink targets), or the same
// existing file (os.SameFile, which also covers hard links, case-insensitive
// filesystems and bind mounts of the same inode — conservative by design).
// It never writes, truncates or changes permissions and never inspects content.
// A genuinely missing source is fine (copying a buffer whose file disappeared is
// allowed); an unverifiable identity on either side is an explicit error, never
// an assumption of difference. This is a preflight under diskWriteMu, not a
// filesystem CAS: an external process can still change the paths afterwards.
func copyDestinationAliasesSource(sourcePath, destPath string) (bool, string, error) {
	srcID, err := copyIdentityPath(sourcePath)
	if err != nil {
		return false, "", err
	}
	dstID, err := copyIdentityPath(destPath)
	if err != nil {
		return false, "", err
	}
	if srcID == dstID {
		return true, "same_path", nil
	}
	srcInfo, err := os.Stat(srcID)
	if err != nil {
		if os.IsNotExist(err) {
			return false, "", nil
		}
		return false, "", err
	}
	dstInfo, err := os.Stat(dstID)
	if err != nil {
		if os.IsNotExist(err) {
			return false, "", nil
		}
		return false, "", err
	}
	if os.SameFile(srcInfo, dstInfo) {
		return true, "same_file", nil
	}
	return false, "", nil
}

// copyEntryIdentityPath returns the identity of the directory *entry* at p:
// its parent is resolved through the same finite symlink resolver, but the final
// component is appended without following it. This is the path a copy's atomic
// write would replace (the link itself, not its referent).
func copyEntryIdentityPath(p string) (string, error) {
	if p == "" {
		return "", fmt.Errorf("empty path")
	}
	if strings.HasSuffix(p, string(filepath.Separator)) {
		return copyIdentityPath(p)
	}
	base := filepath.Base(p)
	if base == "." || base == ".." || base == string(filepath.Separator) {
		return copyIdentityPath(p)
	}
	parent, err := copyIdentityPath(filepath.Dir(p))
	if err != nil {
		return "", err
	}
	return copyJoinRaw(parent, base), nil
}

// copyDestinationReplacesSourceLink reports whether the destination entry is one
// of the symlink entries the source path actually traverses. Replacing such an
// entry with a regular file would break the source's access (for example a
// directory symlink used as an intermediate component), even when the final
// referents are different. The existing referent comparison is deliberately
// separate: this check is about the directory entry, not the resolved target.
// It is a preflight under diskWriteMu, not a filesystem CAS.
func copyDestinationReplacesSourceLink(sourcePath, destPath string) (bool, string, error) {
	_, links, err := copyIdentityPathWithLinks(sourcePath)
	if err != nil {
		return false, "", err
	}
	if len(links) == 0 {
		return false, "", nil
	}
	destEntry, err := copyEntryIdentityPath(destPath)
	if err != nil {
		return false, "", err
	}
	for _, entry := range links {
		if copySameEntry(entry, destEntry) {
			return true, "source_link_entry", nil
		}
	}
	return false, "", nil
}

// copySameEntry compares two existing directory entries without following a
// final symlink. The canonical path comparison covers aliases of the parent
// directory; os.SameFile on Lstat covers the same entry seen through another
// filesystem alias (case-insensitive filesystem or bind mount).
func copySameEntry(a, b string) bool {
	if a == b {
		return true
	}
	ai, err := os.Lstat(a)
	if err != nil {
		return false
	}
	bi, err := os.Lstat(b)
	if err != nil {
		return false
	}
	return os.SameFile(ai, bi)
}

// sourceRemovalPreflight reports whether the application policy allows removing
// the source entry from its directory. On POSIX, unlinking needs write (and
// execute) permission on the *directory*, which a writable file does not imply.
// 0555-style directories are refused before any destination is created; ACLs,
// sticky bits or NFS denials are not visible here and are caught by the real
// os.Remove error after the write (see removeSourceEntry). Windows directory
// mode bits are synthetic, so the check is skipped there.
func sourceRemovalPreflight(path string) (bool, string) {
	if runtime.GOOS == "windows" {
		return true, ""
	}
	dir := filepath.Dir(path)
	fi, err := os.Stat(dir)
	if err != nil || !fi.IsDir() {
		return false, "source_directory_unavailable"
	}
	if fi.Mode().Perm()&0o222 == 0 {
		return false, "source_directory_not_writable"
	}
	return true, ""
}

// removeSourceEntry performs the source removal after the destination was
// written and reports the real outcome. A source that already disappeared counts
// as removed. The caller must not report success when this returns an error,
// must not update the active document/recents, and must not attempt a
// destructive rollback of the destination.
func removeSourceEntry(oldAbs, newAbs string) (bool, error) {
	if oldAbs == "" || oldAbs == newAbs {
		return true, nil
	}
	if _, err := os.Stat(oldAbs); err != nil {
		if os.IsNotExist(err) {
			return true, nil
		}
		return false, err
	}
	if err := os.Remove(oldAbs); err != nil {
		return false, err
	}
	return true, nil
}

func writeFailureStatus(err error) (int, string) {
	// EROFS (read-only mount) is not covered by os.IsPermission; it is a write
	// refusal, also when wrapped in *os.PathError. Generic I/O errors stay 500.
	if os.IsPermission(err) || errors.Is(err, fs.ErrPermission) || isReadOnlyFilesystem(err) {
		return http.StatusForbidden, "write_forbidden"
	}
	return http.StatusInternalServerError, "write_failed"
}

// apiErrorBody is the structured error returned by the write endpoints. `error`
// is the machine code, `conflict` distinguishes 409 reasons (revision_mismatch,
// file_missing, source_changed, source_missing, target_exists).
type apiErrorBody struct {
	Success  bool   `json:"success"`
	Error    string `json:"error"`
	Conflict string `json:"conflict,omitempty"`
	Path     string `json:"path,omitempty"`
	Revision string `json:"revision,omitempty"`
	Message  string `json:"message,omitempty"`
	// Partial marks an operation that had a side effect before failing: a rename
	// whose destination was written but whose source could not be removed. There
	// is no automatic rollback (documented); the client must not claim success.
	Partial bool `json:"partial,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeAPIError(w http.ResponseWriter, status int, code, conflict, path, revision, message string) {
	writeJSON(w, status, apiErrorBody{
		Success:  false,
		Error:    code,
		Conflict: conflict,
		Path:     path,
		Revision: revision,
		Message:  message,
	})
}

// resolveForCompare resolves symlinks so two paths can be compared. A file that
// does not exist yet (a picture referenced by the document but not saved, a
// dangling link) still has a real parent folder: resolve that instead of
// giving up and comparing a relative path against a resolved base (on macOS
// /tmp is a symlink to /private/tmp, which made every missing asset look like a
// traversal attempt).
func resolveForCompare(p string) string {
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		return resolved
	}
	dir := filepath.Dir(p)
	if resolved, err := filepath.EvalSymlinks(dir); err == nil {
		return filepath.Join(resolved, filepath.Base(p))
	}
	return p
}

// pathWithin reports whether target lives inside base (both cleaned, and
// resolved through symlinks when they exist). It is what keeps /api/asset from
// serving any picture on the disk, which is what the endpoint always promised.
func pathWithin(base, target string) bool {
	if base == "" || target == "" {
		return false
	}
	b := resolveForCompare(filepath.Clean(base))
	t := resolveForCompare(filepath.Clean(target))
	rel, err := filepath.Rel(b, t)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
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
	// No artificial delay here: both call sites start this goroutine only after
	// net.Listen has bound the loopback port, so the browser can connect
	// immediately (the old fixed 200ms sleep just slowed every launch).
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
		allLinux := []string{
			"brave-browser",
			"google-chrome",
			"google-chrome-stable",
			"chromium",
			"chromium-browser",
			"microsoft-edge",
		}
		// Cheap PATH scan first: the xdg-settings exec (whose only purpose is
		// to put the default Chromium-family browser first) is skipped entirely
		// when no such browser exists — the common Fedora + Firefox case pays
		// one less process launch on every start.
		var present []string
		for _, b := range allLinux {
			if _, err := exec.LookPath(b); err == nil {
				present = append(present, b)
			}
		}
		if len(present) > 0 {
			def := detectDefaultLinuxBrowser()
			if def != "" {
				browsers = append(browsers, def)
			}
			for _, b := range present {
				if b != def {
					browsers = append(browsers, b)
				}
			}
		}
	}

	profileDir := filepath.Join(getHomeDir(), ".rigo", "browser-profile")
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
					"--class=Rigo",
					"--name=Rigo",
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
		// The loopback Host/Origin boundary is enforced once for the whole stack
		// by newHTTPHandler; here we only separate public assets/handshake from
		// token-protected APIs. The token is generated at startup and injected
		// via /api/init.
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

// securityHeaders hardens the local UI: the app never loads remote code, and no
// request leaks the app origin (or a tokenised asset URL) through the Referer
// header. The window URL itself carries no token anymore (see openDesktopWindow).
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

// --- Single instance (lockfile + TCP forward) ---
func instanceLockPath() string {
	return filepath.Join(getHomeDir(), ".rigo", "instance.lock")
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
	req.Header.Set("X-Rigo-Control", info.Control)

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
	if controlToken == "" || !tokenEqual(r.Header.Get("X-Rigo-Control"), controlToken) {
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
		// Snapshot what the launcher needs before starting a goroutine: reading
		// these globals inside it raced with anything that writes them. The URL
		// carries no token: the page receives it via the /api/init handshake.
		url, forceApp := primaryURL(), appMode
		go openDesktopWindow(url, forceApp)
	}
}

func writeInstanceLock(port int) {
	cfgDir := filepath.Join(getHomeDir(), ".rigo")
	_ = os.MkdirAll(cfgDir, 0o755)
	data, _ := json.Marshal(instanceInfo{Port: port, Control: controlToken})
	_ = os.WriteFile(instanceLockPath(), data, 0o600)
}

func removeInstanceLock() {
	_ = os.Remove(instanceLockPath())
}

// maxBodyBytes bounds the JSON bodies of the write endpoints: a runaway
// client must not be able to buffer an unbounded payload (twice: raw body
// plus decoded string) in memory. Generous for any real Markdown document.
const maxBodyBytes = 32 << 20 // 32 MiB

// decodeJSONBody reads one JSON request body with a size bound. An oversized
// body is 413; malformed JSON keeps the historical 400.
func decodeJSONBody(w http.ResponseWriter, r *http.Request, v interface{}) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
			return err
		}
		http.Error(w, "invalid json payload", http.StatusBadRequest)
		return err
	}
	return nil
}

func setupMux() *http.ServeMux {
	mux := http.NewServeMux()

	// API endpoints
	mux.HandleFunc("/api/init", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		activeFileMu.RLock()
		curPath := activePath
		curDir := activeDir
		activeFileMu.RUnlock()

		// Content and revision come from the same snapshot read: a later
		// /api/stat cannot attach a newer revision to this older text. A read
		// failure is reported as such (503 snapshot_unstable, like /api/file):
		// it is not an empty document. A genuinely missing file is a successful
		// read with exists=false and no revision (the client must not adopt it as
		// a clean, saveable snapshot).
		snap := diskSnapshot{}
		if curPath != "" {
			loaded, err := readDiskSnapshot(curPath)
			if err != nil {
				// The handshake still delivers the session token with the error:
				// the page is local and has already passed the boundary, and the
				// token used to arrive on the launcher URL. Without it a boot-time
				// read failure would leave the UI with no credentials at all.
				writeJSON(w, http.StatusServiceUnavailable, struct {
					InitResponse
					Success bool   `json:"success"`
					Error   string `json:"error"`
					Message string `json:"message,omitempty"`
				}{
					InitResponse{
						Version:    version,
						Token:      appToken,
						OS:         runtime.GOOS,
						ActiveFile: curPath,
						ActiveDir:  curDir,
						DefaultDir: defaultSaveDir(curDir),
					},
					false,
					"snapshot_unstable",
					err.Error(),
				})
				return
			}
			snap = loaded
		}

		recentsMu.Lock()
		recentsCopy := make([]string, len(recentsList))
		copy(recentsCopy, recentsList)
		recentsMu.Unlock()

		resp := InitResponse{
			Version:      version,
			Token:        appToken,
			OS:           runtime.GOOS,
			ActiveFile:   curPath,
			ActiveDir:    curDir,
			DefaultDir:   defaultSaveDir(curDir),
			Recents:      recentsCopy,
			FileContent:  string(snap.Content),
			FileRevision: snap.Revision,
			FileExists:   snap.Exists,
		}
		if snap.Exists {
			resp.ReadOnly, resp.ReadOnlyReason = writeProtection(curPath, snap)
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

		snap, err := readDiskSnapshot(cleanPath)
		if err != nil {
			writeAPIError(w, http.StatusServiceUnavailable, "snapshot_unstable", "", cleanPath, "", err.Error())
			return
		}
		if !snap.Exists {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}

		activeFileMu.Lock()
		activePath = cleanPath
		activeDir = filepath.Dir(cleanPath)
		activeFileMu.Unlock()
		addRecent(cleanPath)

		readOnly, reason := writeProtection(cleanPath, snap)
		writeJSON(w, http.StatusOK, FileResponse{
			Path:           cleanPath,
			Content:        string(snap.Content),
			Revision:       snap.Revision,
			ModTime:        snap.ModTime,
			ReadOnly:       readOnly,
			ReadOnlyReason: reason,
		})
	}))

	// /api/stat reports the reliable content revision without sending the file
	// body. It deliberately reads and hashes the whole file on every call: a
	// cache keyed only on mtime/size would miss changes that preserve both (an
	// in-place rewrite within the filesystem timestamp granularity, a restored
	// backup with the same size, a content swap via mmap). Cost: one read and one
	// SHA-256 per poll per window (the UI polls only while the document is
	// visible). mtime/size are still returned, as metadata only.
	mux.HandleFunc("/api/stat", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		filePath := r.URL.Query().Get("path")
		if filePath == "" {
			http.Error(w, "missing path", http.StatusBadRequest)
			return
		}
		cleanPath, err := cleanAbs(filePath)
		if err != nil || !isSafeMarkdownPath(cleanPath) {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}
		snap, err := readDiskSnapshot(cleanPath)
		if err != nil {
			writeAPIError(w, http.StatusServiceUnavailable, "snapshot_unstable", "", cleanPath, "", err.Error())
			return
		}
		readOnly, reason := writeProtection(cleanPath, snap)
		writeJSON(w, http.StatusOK, StatResponse{
			Path:           cleanPath,
			Exists:         snap.Exists,
			Revision:       snap.Revision,
			ModTime:        snap.ModTime,
			Size:           snap.Size,
			ReadOnly:       readOnly,
			ReadOnlyReason: reason,
		})
	}))

	mux.HandleFunc("/api/save", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req SaveRequest
		if err := decodeJSONBody(w, r, &req); err != nil {
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

		// Revision precondition: equality of an opaque content fingerprint, never
		// an order comparison of timestamps.
		if req.ExpectedRevision != "" && !validDiskRevision(req.ExpectedRevision) {
			writeAPIError(w, http.StatusBadRequest, "invalid_revision", "", cleanPath, "", "expected_revision is not a sha256 revision")
			return
		}

		// Serialise the read-check-write sequence between requests of this
		// process (two saves with the same baseline, save against rename). Other
		// programs are not covered: the file can still change after the check and
		// before atomicWrite replaces it (residual TOCTOU, documented in AUDIT).
		diskWriteMu.Lock()
		defer diskWriteMu.Unlock()

		snap, err := readDiskSnapshot(cleanPath)
		if err != nil {
			writeAPIError(w, http.StatusServiceUnavailable, "snapshot_unstable", "", cleanPath, "", err.Error())
			return
		}

		// Application read-only policy comes before conflict handling: `force`
		// bypasses a content conflict, never the protection of the file. Atomic
		// save would replace the inode without needing write access to it, so
		// refusing here is what makes the read-only intent effective.
		if readOnly, reason := writeProtection(cleanPath, snap); readOnly {
			writeAPIError(w, http.StatusForbidden, "read_only", "", cleanPath, snap.Revision,
				"the file is read-only ("+reason+")")
			return
		}

		if !req.Force {
			switch {
			case req.ExpectedRevision == "":
				// No baseline is not "force": it can only create a new file. A
				// legacy client that sent only mod_time (0 included) now gets 428
				// on an existing file instead of silently bypassing the check.
				if snap.Exists {
					writeAPIError(w, http.StatusPreconditionRequired, "revision_required", "", cleanPath, snap.Revision,
						"an existing file needs expected_revision (or an explicit one-shot force)")
					return
				}
			case !snap.Exists:
				// The client knew this file: never recreate it silently.
				writeAPIError(w, http.StatusConflict, "conflict", "file_missing", cleanPath, "",
					"the file was deleted on disk and is not recreated automatically")
				return
			case snap.Revision != req.ExpectedRevision:
				writeAPIError(w, http.StatusConflict, "conflict", "revision_mismatch", cleanPath, snap.Revision,
					"the file changed on disk")
				return
			}
		} else if req.ExpectedRevision != "" && !snap.Exists {
			// Force overwrites a changed existing file, but it does not resurrect a
			// file the client knew about and that disappeared.
			writeAPIError(w, http.StatusConflict, "conflict", "file_missing", cleanPath, "",
				"the file was deleted on disk; an explicit force does not recreate it")
			return
		}

		// Atomic write. A permission/read-only-filesystem error discovered here is
		// still a refusal (never a success): 403 write_forbidden, distinct from a
		// content conflict.
		if err := atomicWrite(cleanPath, []byte(req.Content)); err != nil {
			status, code := writeFailureStatus(err)
			writeAPIError(w, status, code, "", cleanPath, "", err.Error())
			return
		}
		// Revision of the content that was actually written (atomicWrite replaces
		// the file with exactly these bytes on success).
		revision := contentRevision([]byte(req.Content))

		var newModTime int64
		if fi, err := os.Stat(cleanPath); err == nil {
			newModTime = fi.ModTime().UnixNano()
		}

		activeFileMu.Lock()
		activePath = cleanPath
		activeDir = filepath.Dir(cleanPath)
		activeFileMu.Unlock()
		addRecent(cleanPath)

		writeJSON(w, http.StatusOK, SaveResponse{
			Success:  true,
			Path:     cleanPath,
			Revision: revision,
			ModTime:  newModTime,
			ReadOnly: false,
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
		if err := decodeJSONBody(w, r, &req); err != nil {
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
			// SourcePath is the explicit copy source. It is set only by the
			// Save As / copy flow (old_path empty) and is used exclusively to
			// refuse a destination that aliases the source: it never authorises
			// writing or removing the source, and the source content may differ
			// from the buffer (or be gone) — the copy is written from the buffer.
			SourcePath string `json:"source_path,omitempty"`
			// ExpectedRevision is the source baseline. It is required whenever
			// old_path is set, also when old_path == new_path; the destination
			// `overwrite` flag never bypasses this check.
			ExpectedRevision string `json:"expected_revision,omitempty"`
			Overwrite        bool   `json:"overwrite,omitempty"`
		}
		if err := decodeJSONBody(w, r, &req); err != nil {
			return
		}
		if req.ExpectedRevision != "" && !validDiskRevision(req.ExpectedRevision) {
			writeAPIError(w, http.StatusBadRequest, "invalid_revision", "", req.NewPath, "", "expected_revision is not a sha256 revision")
			return
		}

		newAbs, err := cleanAbs(req.NewPath)
		if err != nil {
			http.Error(w, "invalid new path", http.StatusBadRequest)
			return
		}
		// Never rewrite the name the user typed: silently appending the
		// extension back is the classic way to lose a deliberate name.
		if !isSafeMarkdownPath(newAbs) {
			http.Error(w, "forbidden: save as .md, .markdown, .txt, .mdown, .mkd, .mdwn or .mdx", http.StatusBadRequest)
			return
		}

		// A copy is Save As / Save a copy: old_path empty plus an explicit source
		// context. It shares the destination-entry rule but not the removal rules
		// of a rename.
		copySource := req.OldPath == "" && strings.TrimSpace(req.SourcePath) != ""

		oldAbs := ""
		if req.OldPath != "" {
			a, err := cleanAbs(req.OldPath)
			if err != nil {
				http.Error(w, "invalid old path", http.StatusBadRequest)
				return
			}
			// The old file is removed after the new one is written: an unchecked
			// old_path let a bad request delete any file on the disk.
			if !isSafeMarkdownPath(a) {
				http.Error(w, "forbidden: the previous file is not a markdown document", http.StatusForbidden)
				return
			}
			oldAbs = a
		}

		// Serialise with saves and other renames of this process.
		diskWriteMu.Lock()
		defer diskWriteMu.Unlock()

		// Copy flow (old_path empty + explicit source context): the destination
		// must not identify the source. Refused before any effect; no fallback to
		// save or rename. A same-path RENAME (old_path == new_path) is untouched.
		// The identity is resolved inside the write section so it is ordered with
		// the other process writes; it is a preflight, not a filesystem CAS.
		if copySource {
			alias, reason, err := copyDestinationAliasesSource(req.SourcePath, newAbs)
			if err != nil {
				writeAPIError(w, http.StatusServiceUnavailable, "snapshot_unstable", "", req.SourcePath, "",
					"cannot verify the copy source: "+err.Error())
				return
			}
			if alias {
				writeJSON(w, http.StatusConflict, apiErrorBody{
					Success:  false,
					Error:    "conflict",
					Conflict: "copy_same_source",
					Path:     newAbs,
					Message:  "the copy destination is the source itself (" + reason + "): choose another name or folder",
				})
				return
			}
			// A different final referent is not enough: the destination may be a
			// symlink entry the source path traverses to reach its file. Replacing
			// that entry would make the source unreadable (ENOTDIR), so it is
			// refused before any effect, with or without overwrite.
			replaces, linkReason, err := copyDestinationReplacesSourceLink(req.SourcePath, newAbs)
			if err != nil {
				writeAPIError(w, http.StatusServiceUnavailable, "snapshot_unstable", "", req.SourcePath, "",
					"cannot verify the copy source link entries: "+err.Error())
				return
			}
			if replaces {
				writeJSON(w, http.StatusConflict, apiErrorBody{
					Success:  false,
					Error:    "conflict",
					Conflict: "copy_same_source",
					Path:     newAbs,
					Message:  "the copy destination is a link entry needed to access the source (" + linkReason + "): choose another name or folder",
				})
				return
			}
		}

		// The source revision is verified BEFORE creating the destination folder,
		// writing the destination or removing the source, including when
		// old_path == new_path. A missing or changed source is a distinct
		// conflict: overwrite of the destination does not authorise losing
		// external changes of the source.
		if oldAbs != "" {
			if req.ExpectedRevision == "" {
				writeAPIError(w, http.StatusPreconditionRequired, "revision_required", "", oldAbs, "",
					"renaming an existing document needs expected_revision")
				return
			}
			srcSnap, err := readDiskSnapshot(oldAbs)
			if err != nil {
				writeAPIError(w, http.StatusServiceUnavailable, "snapshot_unstable", "", oldAbs, "", err.Error())
				return
			}
			if !srcSnap.Exists {
				writeAPIError(w, http.StatusConflict, "conflict", "source_missing", oldAbs, "",
					"the source document was deleted on disk")
				return
			}
			// A protected source is never moved/rewritten: `overwrite` is about the
			// destination and cannot authorise losing the read-only intent, also for
			// old_path == new_path.
			if readOnly, reason := writeProtection(oldAbs, srcSnap); readOnly {
				writeAPIError(w, http.StatusForbidden, "read_only", "", oldAbs, srcSnap.Revision,
					"the source document is read-only ("+reason+")")
				return
			}
			if srcSnap.Revision != req.ExpectedRevision {
				writeAPIError(w, http.StatusConflict, "conflict", "source_changed", oldAbs, srcSnap.Revision,
					"the source document changed on disk")
				return
			}
		}

		// A protected destination cannot be replaced by a rename/copy, with or
		// without overwrite:true, and with an empty source (Save As / copy). The
		// read-only refusal is a different case from "destination exists", so the
		// UI never offers an overwrite confirmation that would bypass permissions.
		if oldAbs != newAbs {
			if readOnly, reason := pathReadOnly(newAbs); readOnly {
				writeAPIError(w, http.StatusForbidden, "read_only", "", newAbs, "",
					"the destination is read-only ("+reason+")")
				return
			}
		}

		// Removing the source needs write access to its directory, not only to the
		// file. When that is determinably denied, refuse before creating the
		// destination folder or writing anything.
		if oldAbs != "" && oldAbs != newAbs {
			if allowed, reason := sourceRemovalPreflight(oldAbs); !allowed {
				writeAPIError(w, http.StatusForbidden, "write_forbidden", "", oldAbs, "",
					"the source document cannot be removed from its directory ("+reason+")")
				return
			}
		}

		if err := os.MkdirAll(filepath.Dir(newAbs), 0o755); err != nil {
			status, code := writeFailureStatus(err)
			writeAPIError(w, status, code, "", newAbs, "", err.Error())
			return
		}

		// Refuse to silently replace a different document that already exists. A
		// copy also needs consent when the destination is an existing *entry* whose
		// referent is missing (a dangling symlink): os.Stat would follow the link
		// and report ENOENT, silently replacing the link itself. Lstat distinguishes
		// entry existence from referent identity. The general rename/save policy is
		// unchanged: only the explicit copy flow uses Lstat here.
		if oldAbs != newAbs && !req.Overwrite {
			statEntry := os.Stat
			if copySource {
				statEntry = os.Lstat
			}
			if fi, err := statEntry(newAbs); err == nil && !fi.IsDir() {
				writeAPIError(w, http.StatusConflict, "conflict", "target_exists", newAbs, "",
					"a file with this name is already there")
				return
			}
		}

		if err := atomicWrite(newAbs, []byte(req.Content)); err != nil {
			status, code := writeFailureStatus(err)
			writeAPIError(w, status, code, "", newAbs, "", err.Error())
			return
		}

		// If renaming an existing file and path changed, delete the old file and
		// check the outcome: a failed removal is not a completed rename. The
		// destination is already written at this point, so the error reports the
		// partial outcome explicitly; there is no automatic rollback (it could
		// delete another process's work) and the source stays where it is.
		if oldAbs != "" && oldAbs != newAbs {
			if removed, removeErr := removeSourceEntry(oldAbs, newAbs); !removed {
				status, code := writeFailureStatus(removeErr)
				writeJSON(w, status, apiErrorBody{
					Success:  false,
					Error:    code,
					Path:     newAbs,
					Revision: contentRevision([]byte(req.Content)),
					Partial:  true,
					Message:  "rename incomplete: destination written, source not removed: " + removeErr.Error(),
				})
				return
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

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success":   true,
			"path":      newAbs,
			"revision":  contentRevision([]byte(req.Content)),
			"mod_time":  newMod,
			"read_only": false,
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

		// Confinement: the endpoint only ever serves pictures of the open
		// document's folder and below, as its contract says. Without this the
		// tokenised URL could pull any image (or .svg) anywhere on the disk.
		if baseDir == "" || !pathWithin(baseDir, cleanTarget) {
			http.Error(w, "forbidden: asset outside the document folder", http.StatusForbidden)
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
		fmt.Printf("Rigo v%s — Minimalist Markdown Editor\n", version)
		return
	}
	appMode = *appFlag
	noBrowser = *noBrowserFlag

	args := flag.Args()
	// Single instance: if a Rigo is already running, forward the file and exit.
	if forwardToPrimary(args) {
		fmt.Println("Rigo e' gia' in esecuzione — file inoltrato all'istanza esistente.")
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
		fmt.Fprintf(os.Stderr, "Error starting Rigo server: %v\n", err)
		os.Exit(1)
	}

	actualPort := listener.Addr().(*net.TCPAddr).Port
	primaryPort = actualPort
	// One immutable boundary per listener, composed once with security headers
	// and the routes. No handler is reachable without passing it.
	handler := newHTTPHandler(mux, newLoopbackBoundary(actualPort))
	appURL := fmt.Sprintf("http://127.0.0.1:%d", actualPort)
	writeInstanceLock(actualPort)
	defer removeInstanceLock()
	// Porta scritta anche su file per modalita' --no-browser / Windows GUI.
	portFilePath := filepath.Join(getHomeDir(), ".rigo", "port")
	_ = os.WriteFile(portFilePath, []byte(strconv.Itoa(actualPort)), 0o644)
	defer os.Remove(portFilePath)

	fmt.Println("=====================================================")
	fmt.Printf(" Rigo v%s — Minimalist Markdown Editor\n", version)
	fmt.Printf(" Server running on: %s\n", appURL)
	if activePath != "" {
		fmt.Printf(" Active file:       %s\n", activePath)
	}
	fmt.Println(" Press Ctrl+C to terminate.")
	fmt.Println("=====================================================")

	if !*noBrowserFlag {
		// No token in the URL: it would be readable by other local users through
		// /proc/<pid>/cmdline. The page gets the token from /api/init, which is
		// served same-origin behind the Host/Origin boundary.
		go openDesktopWindow(appURL, *appFlag)
	}

	server := &http.Server{
		Handler:           handler,
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
		fmt.Println("\nShutting down Rigo...")
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
	}
}
