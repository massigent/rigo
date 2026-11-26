package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// --- Host authority policy (unit) -----------------------------------------

func TestHostAuthorityPolicy(t *testing.T) {
	const port = 43210
	b := newLoopbackBoundary(port)

	allowed := []string{
		"127.0.0.1:43210",
		"localhost:43210",
		"LOCALHOST:43210",
		"LocalHost:43210",
	}
	for _, host := range allowed {
		if !b.hostAllowed(host) {
			t.Errorf("host %q must be accepted for the listener on :%d", host, port)
		}
	}

	blocked := []string{
		"",
		"attacker.example:43210",   // DNS-rebinding hostname
		"127.0.0.1.evil.com:43210", // lookalike
		"localhost.evil.com:43210", // lookalike
		"127.0.0.1:43211",          // wrong port
		"127.0.0.1",                // port omitted on a non-default port
		"127.0.0.1:",               // empty port
		"127.0.0.1:043210",         // non-canonical port
		"127.0.0.1:+43210",         // signed port
		"127.0.0.1:43210:0",        // ambiguous authority
		"user@127.0.0.1:43210",     // userinfo
		"http://127.0.0.1:43210",   // scheme in authority
		"127.0.0.1:43210/path",     // path
		"127.0.0.1:43210?x=1",      // query
		"127.0.0.1:43210#frag",     // fragment
		"[::1]:43210",              // IPv6 is not served by this listener
		"[::1]",
		"[::ffff:127.0.0.1]:43210", // IPv4-mapped IPv6 (dotted form)
		"[::ffff:7f00:1]:43210",    // IPv4-mapped IPv6 (hex form)
		"[::FFFF:7F00:1]:43210",    // ... uppercase hex
		"[::ffff:127.0.0.1]",
		"0.0.0.0:43210",      // non-loopback
		"192.168.1.10:43210", // non-loopback
		"localhost.:43210",   // trailing dot is not the allowed form
		" 127.0.0.1:43210",   // whitespace
		"127.0.0.1:43210 ",
		"127.0.0.1:65536",             // out of range
		"[127.0.0.1]:43210",           // brackets around IPv4
		"127.0.0.1:43210,127.0.0.1",   // multiple authorities
		"127.0.0.1:43210\\@evil.test", // ambiguous parse
	}
	for _, host := range blocked {
		if b.hostAllowed(host) {
			t.Errorf("host %q must be refused for the listener on :%d", host, port)
		}
	}
}

func TestHostAuthorityDefaultHTTPPort(t *testing.T) {
	b := newLoopbackBoundary(80)
	for _, host := range []string{"127.0.0.1", "127.0.0.1:80", "localhost", "localhost:80"} {
		if !b.hostAllowed(host) {
			t.Errorf("host %q must be accepted for a listener on the http default port", host)
		}
	}
	for _, host := range []string{
		"127.0.0.1:8080",
		"localhost:81",
		"attacker.example",
		"[::ffff:127.0.0.1]",
		"[::ffff:127.0.0.1]:80",
		"[::ffff:7f00:1]",
	} {
		if b.hostAllowed(host) {
			t.Errorf("host %q must be refused for a listener on the http default port", host)
		}
	}
}

// --- Origin policy (unit) --------------------------------------------------

func TestOriginPolicy(t *testing.T) {
	const port = 43210
	b := newLoopbackBoundary(port)
	const reqHost = "127.0.0.1:43210"

	allowed := []string{
		"http://127.0.0.1:43210",
		"HTTP://127.0.0.1:43210", // scheme is case-insensitive
	}
	for _, origin := range allowed {
		if !b.originAllowed(reqHost, origin) {
			t.Errorf("origin %q must be accepted for host %q", origin, reqHost)
		}
	}

	blocked := []string{
		"",
		"null",
		"*",
		"https://127.0.0.1:43210",          // different scheme
		"http://127.0.0.1:43211",           // different port
		"http://localhost:43210",           // different hostname (cross-origin)
		"http://attacker.example:43210",    // external origin
		"http://127.0.0.1.evil.com:43210",  // lookalike
		"http://user@127.0.0.1:43210",      // userinfo
		"http://user:pass@127.0.0.1:43210", // userinfo
		"http://127.0.0.1:43210/",          // trailing slash is not an origin
		"http://127.0.0.1:43210/path",      // path
		"http://127.0.0.1:43210?x=1",       // query
		"http://127.0.0.1:43210#frag",      // fragment
		" http://127.0.0.1:43210",          // whitespace
		"http://127.0.0.1:43210 ",
		"http://127.0.0.1:43210,http://127.0.0.1:43210", // multiple origins in one value
		"file://127.0.0.1:43210",                        // non-http scheme
		"http://[::ffff:127.0.0.1]:43210",               // IPv4-mapped IPv6, dotted form
		"http://[::ffff:7f00:1]:43210",                  // IPv4-mapped IPv6, hex form
		"HTTP://[::FFFF:7F00:1]:43210",                  // ... uppercase
		"http://127.0.0.1:43210#",                       // empty fragment delimiter
	}
	for _, origin := range blocked {
		if b.originAllowed(reqHost, origin) {
			t.Errorf("origin %q must be refused for host %q", origin, reqHost)
		}
	}

	// Same-origin is per request authority: a page served from localhost talks to
	// localhost, not to the 127.0.0.1 spelling of the same listener.
	if !b.originAllowed("localhost:43210", "http://localhost:43210") {
		t.Error("localhost origin must match a localhost authority")
	}
	if b.originAllowed("localhost:43210", "http://127.0.0.1:43210") {
		t.Error("127.0.0.1 origin must not match a localhost authority")
	}

	// Default port normalisation: http://host and http://host:80 are the same.
	b80 := newLoopbackBoundary(80)
	if !b80.originAllowed("127.0.0.1", "http://127.0.0.1:80") {
		t.Error("origin on the default http port must match a port-less authority")
	}
	if !b80.originAllowed("127.0.0.1", "HTTP://127.0.0.1") {
		t.Error("scheme case must not change a same-origin match on the default port")
	}
	if b80.originAllowed("127.0.0.1", "http://127.0.0.1:8080") {
		t.Error("a non-default origin port must be refused")
	}
	for _, origin := range []string{
		"http://[::ffff:127.0.0.1]:80",
		"http://[::ffff:7f00:1]",
		"HTTP://[::FFFF:127.0.0.1]:80",
		"http://127.0.0.1:#",
	} {
		if b80.originAllowed("127.0.0.1", origin) {
			t.Errorf("origin %q must be refused even on the default port", origin)
		}
	}
}

// --- Integration through the real composed stack ---------------------------
//
// The tests below start the real handler (newHTTPHandler + setupMux) on a real
// 127.0.0.1 listener with a system-assigned port. No HOME directory, no browser
// launch: recents are not initialised and noBrowser is forced for the duration.

type boundaryTestEnv struct {
	t        *testing.T
	port     int
	base     string
	boundary *httpBoundary
	client   *http.Client
}

func newBoundaryTestEnv(t *testing.T) *boundaryTestEnv {
	t.Helper()

	appToken = "test-token-http-boundary"
	controlToken = "test-control-http-boundary"
	prevNoBrowser := noBrowser
	noBrowser = true
	activeFileMu.Lock()
	prevPath, prevDir := activePath, activeDir
	activePath, activeDir = "", t.TempDir()
	activeFileMu.Unlock()

	// Never read or write the real recents file: tests get an empty, unsaved list.
	recentsMu.Lock()
	prevRecentsPath, prevRecents := recentsPath, append([]string(nil), recentsList...)
	recentsPath = ""
	recentsList = nil
	recentsMu.Unlock()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen on loopback: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if port <= 0 {
		t.Fatalf("expected a system-assigned listener port, got %d", port)
	}
	boundary := newLoopbackBoundary(port)
	srv := &http.Server{
		Handler:           newHTTPHandler(setupMux(), boundary),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() { _ = srv.Serve(ln) }()

	t.Cleanup(func() {
		// Shutdown (not Close) waits for in-flight handlers, including the SSE
		// stream: only then is it safe to restore the globals they read.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
		activeFileMu.Lock()
		activePath, activeDir = prevPath, prevDir
		activeFileMu.Unlock()
		recentsMu.Lock()
		recentsPath, recentsList = prevRecentsPath, prevRecents
		recentsMu.Unlock()
		noBrowser = prevNoBrowser
	})

	return &boundaryTestEnv{
		t:        t,
		port:     port,
		base:     fmt.Sprintf("http://127.0.0.1:%d", port),
		boundary: boundary,
		client: &http.Client{
			Transport: &http.Transport{Proxy: nil}, // ignore HTTP_PROXY from the environment
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
			Timeout: 5 * time.Second,
		},
	}
}

// request sends a request through the real listener. hostHeader overrides the
// Host header (empty = the loopback URL authority); origins are added as Origin
// header values (repeated for multi-value cases).
func (e *boundaryTestEnv) request(method, path, hostHeader string, headers map[string]string, origins []string, body io.Reader) (*http.Response, []byte) {
	e.t.Helper()
	req, err := http.NewRequest(method, e.base+path, body)
	if err != nil {
		e.t.Fatalf("build %s %s: %v", method, path, err)
	}
	if hostHeader != "" {
		req.Host = hostHeader
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	for _, o := range origins {
		req.Header.Add("Origin", o)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	_ = resp.Body.Close()
	return resp, data
}

func (e *boundaryTestEnv) validHost() string {
	return "127.0.0.1:" + strconv.Itoa(e.port)
}

func (e *boundaryTestEnv) wrongPort() int {
	if e.port == 65535 {
		return e.port - 1
	}
	return e.port + 1
}

func assertSecurityHeaders(t *testing.T, resp *http.Response) {
	t.Helper()
	for header, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy":        "no-referrer",
		"X-Frame-Options":        "DENY",
	} {
		if got := resp.Header.Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if resp.Header.Get("Content-Security-Policy") == "" {
		t.Error("Content-Security-Policy must be present")
	}
}

func TestBoundaryInitHandshake(t *testing.T) {
	env := newBoundaryTestEnv(t)

	// Valid Host, no Origin: the UI handshake keeps working.
	resp, body := env.request("GET", "/api/init", "", nil, nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid host + no Origin: got %d, want 200", resp.StatusCode)
	}
	var init InitResponse
	if err := json.Unmarshal(body, &init); err != nil {
		t.Fatalf("decode /api/init: %v", err)
	}
	if init.Token == "" || init.Token != appToken {
		t.Fatal("the handshake must return the current UI token over a valid Host")
	}
	assertSecurityHeaders(t, resp)

	// Valid Host + same-origin Origin.
	sameOrigin := "http://" + env.validHost()
	if resp, _ := env.request("GET", "/api/init", "", nil, []string{sameOrigin}, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("valid host + same-origin Origin: got %d, want 200", resp.StatusCode)
	}

	// localhost spelling and uppercase hostname are accepted, IPv6 is not.
	if resp, _ := env.request("GET", "/api/init", "LOCALHOST:"+strconv.Itoa(env.port), nil, nil, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("LOCALHOST host: got %d, want 200", resp.StatusCode)
	}
	if resp, _ := env.request("GET", "/api/init", "localhost:"+strconv.Itoa(env.port), nil, []string{"http://localhost:" + strconv.Itoa(env.port)}, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("localhost host + localhost origin: got %d, want 200", resp.StatusCode)
	}

	// Public landing page and static assets with a valid Host.
	for _, path := range []string{"/", "/static/js/app.js", "/static/css/app.css"} {
		if resp, _ := env.request("GET", path, "", nil, nil, nil); resp.StatusCode != http.StatusOK {
			t.Errorf("%s with valid host: got %d, want 200", path, resp.StatusCode)
		}
	}
}

func TestBoundaryRejectsForeignHostEverywhere(t *testing.T) {
	env := newBoundaryTestEnv(t)

	foreignHosts := []string{
		"attacker.example:" + strconv.Itoa(env.port),
		"127.0.0.1.evil.com:" + strconv.Itoa(env.port),
		"localhost.evil.com:" + strconv.Itoa(env.port),
		"127.0.0.1:" + strconv.Itoa(env.wrongPort()),
		"127.0.0.1",
		"127.0.0.1:",
		"user@127.0.0.1:" + strconv.Itoa(env.port),
		"[::1]:" + strconv.Itoa(env.port),
		"[::ffff:127.0.0.1]:" + strconv.Itoa(env.port),
		"[::ffff:7f00:1]:" + strconv.Itoa(env.port),
		"[::FFFF:7F00:1]:" + strconv.Itoa(env.port),
		"127.0.0.1:0" + strconv.Itoa(env.port),
	}
	paths := []string{
		"/",
		"/static/js/app.js",
		"/api/init",
		"/api/stat?path=/tmp/x.md",
		"/api/events",
		"/does-not-exist",
	}
	headers := map[string]string{"X-Rigo-Token": appToken}

	for _, host := range foreignHosts {
		for _, path := range paths {
			resp, body := env.request("GET", path, host, headers, nil, nil)
			if resp.StatusCode != http.StatusForbidden {
				t.Errorf("host %q on %s: got %d, want 403", host, path, resp.StatusCode)
			}
			if strings.Contains(string(body), appToken) {
				t.Errorf("host %q on %s leaked the UI token", host, path)
			}
			if strings.Contains(string(body), controlToken) {
				t.Errorf("host %q on %s leaked the control secret", host, path)
			}
			assertSecurityHeaders(t, resp)
		}
	}

	// Write endpoints inherit the same global guard.
	postPaths := []string{"/api/save", "/api/mkdir", "/api/rename", "/api/internal/open"}
	for _, host := range foreignHosts {
		for _, path := range postPaths {
			resp, body := env.request("POST", path, host, map[string]string{
				"X-Rigo-Token":   appToken,
				"X-Rigo-Control": controlToken,
				"Content-Type":   "application/json",
			}, nil, strings.NewReader(`{"path":"/tmp/x.md","name":"x","old_path":"","new_path":"/tmp/x.md","content":"x","paths":[]}`))
			if resp.StatusCode != http.StatusForbidden {
				t.Errorf("POST host %q on %s: got %d, want 403", host, path, resp.StatusCode)
			}
			if strings.Contains(string(body), appToken) || strings.Contains(string(body), controlToken) {
				t.Errorf("POST host %q on %s leaked a secret", host, path)
			}
		}
	}

	// Forwarded headers must not extend trust.
	spoof := map[string]string{
		"X-Rigo-Token":      appToken,
		"X-Forwarded-Host":  env.validHost(),
		"X-Forwarded-Proto": "http",
		"Forwarded":         "host=" + env.validHost() + ";proto=http",
	}
	resp, body := env.request("GET", "/api/init", "attacker.example:"+strconv.Itoa(env.port), spoof, nil, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("forwarded headers must not validate a foreign Host, got %d", resp.StatusCode)
	}
	if strings.Contains(string(body), appToken) {
		t.Fatal("a refused handshake must not return the token")
	}
}

func TestBoundaryOriginPolicyThroughStack(t *testing.T) {
	env := newBoundaryTestEnv(t)
	validHost := env.validHost()
	portText := strconv.Itoa(env.port)

	badOrigins := []string{
		"http://attacker.example:" + portText,
		"http://127.0.0.1.evil.com:" + portText,
		"https://" + validHost,
		"http://127.0.0.1:" + strconv.Itoa(env.wrongPort()),
		"http://localhost:" + portText,
		"null",
		"*",
		"http://user@127.0.0.1:" + portText,
		"http://127.0.0.1:" + portText + "/path",
		"http://127.0.0.1:" + portText + "?x=1",
		"http://127.0.0.1:" + portText + "#frag",
		"http://127.0.0.1:" + portText + "#",
		"http://[::ffff:127.0.0.1]:" + portText,
		"http://[::ffff:7f00:1]:" + portText,
		"HTTP://[::FFFF:7F00:1]:" + portText,
	}
	for _, origin := range badOrigins {
		resp, body := env.request("GET", "/api/init", validHost, nil, []string{origin}, nil)
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("origin %q: got %d, want 403", origin, resp.StatusCode)
		}
		if strings.Contains(string(body), appToken) {
			t.Errorf("origin %q leaked the token", origin)
		}
		assertSecurityHeaders(t, resp)
	}

	// Multiple Origin header values.
	resp, _ := env.request("GET", "/api/init", validHost, nil,
		[]string{"http://" + validHost, "http://attacker.example:" + portText}, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("multiple Origin values: got %d, want 403", resp.StatusCode)
	}

	// A same-origin Origin is accepted on a protected API too.
	tmp := filepath.Join(t.TempDir(), "origin.md")
	if err := os.WriteFile(tmp, []byte("# x"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := "/api/file?path=" + url.QueryEscape(tmp) + "&token=" + url.QueryEscape(appToken)
	resp, _ = env.request("GET", path, validHost, nil, []string{"http://" + validHost}, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid same-origin Origin on a protected API: got %d, want 200", resp.StatusCode)
	}
}

func TestBoundaryKeepsTokenAndSecretAuth(t *testing.T) {
	env := newBoundaryTestEnv(t)

	tmp := filepath.Join(t.TempDir(), "auth.md")
	if err := os.WriteFile(tmp, []byte("# x"), 0o644); err != nil {
		t.Fatal(err)
	}
	statPath := "/api/stat?path=" + url.QueryEscape(tmp)

	// Valid Host, token missing/wrong -> 401 (the boundary is not the auth).
	if resp, _ := env.request("GET", statPath, "", nil, nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing token on a valid Host: got %d, want 401", resp.StatusCode)
	}
	if resp, _ := env.request("GET", statPath, "", map[string]string{"X-Rigo-Token": "wrong"}, nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token on a valid Host: got %d, want 401", resp.StatusCode)
	}
	if resp, _ := env.request("GET", statPath+"&token="+url.QueryEscape(appToken), "", nil, nil, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("valid token on a valid Host: got %d, want 200", resp.StatusCode)
	}

	// A write denied by the missing token must not create the file.
	deniedTarget := filepath.Join(t.TempDir(), "no-token.md")
	saveBody, _ := json.Marshal(map[string]interface{}{"path": deniedTarget, "content": "nope"})
	if resp, _ := env.request("POST", "/api/save", "", nil, nil, strings.NewReader(string(saveBody))); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("save without token on a valid Host: got %d, want 401", resp.StatusCode)
	}
	if _, err := os.Stat(deniedTarget); !os.IsNotExist(err) {
		t.Fatal("a token-less save must not write the document")
	}

	// Internal channel: the control secret is still required on a valid Host.
	internalBody := `{"focus":false,"paths":[]}`
	if resp, _ := env.request("POST", "/api/internal/open", "", nil, nil, strings.NewReader(internalBody)); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("internal channel without control secret: got %d, want 403", resp.StatusCode)
	}
	if resp, _ := env.request("POST", "/api/internal/open", "", map[string]string{"X-Rigo-Control": "wrong"}, nil, strings.NewReader(internalBody)); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("internal channel with a wrong control secret: got %d, want 403", resp.StatusCode)
	}
	resp, body := env.request("POST", "/api/internal/open", "", map[string]string{"X-Rigo-Control": controlToken}, nil, strings.NewReader(internalBody))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("internal channel with the control secret: got %d, want 200 (%s)", resp.StatusCode, body)
	}
}

func TestBoundaryDeniedRequestsHaveNoEffect(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	target := filepath.Join(dir, "denied.md")
	other := filepath.Join(dir, "other.md")

	activeFileMu.RLock()
	beforePath, beforeDir := activePath, activeDir
	activeFileMu.RUnlock()

	saveBody, _ := json.Marshal(map[string]interface{}{
		"path":    target,
		"content": "must not be written",
	})
	foreignHost := "attacker.example:" + strconv.Itoa(env.port)
	resp, _ := env.request("POST", "/api/save", foreignHost,
		map[string]string{"X-Rigo-Token": appToken, "Content-Type": "application/json"},
		nil, strings.NewReader(string(saveBody)))
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("denied save: got %d, want 403", resp.StatusCode)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("a denied request must not write the document")
	}

	// The internal channel with the right secret but a foreign Host changes
	// nothing and never echoes the secret.
	internalBody, _ := json.Marshal(map[string]interface{}{"paths": []string{other}, "focus": false})
	resp, body := env.request("POST", "/api/internal/open", foreignHost,
		map[string]string{"X-Rigo-Control": controlToken, "Content-Type": "application/json"},
		nil, strings.NewReader(string(internalBody)))
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("denied internal open: got %d, want 403", resp.StatusCode)
	}
	if strings.Contains(string(body), controlToken) || strings.Contains(string(body), appToken) {
		t.Fatal("a denied internal request must not echo any secret")
	}

	activeFileMu.RLock()
	afterPath, afterDir := activePath, activeDir
	activeFileMu.RUnlock()
	if afterPath != beforePath || afterDir != beforeDir {
		t.Fatalf("denied requests mutated the active document: %q/%q -> %q/%q",
			beforePath, beforeDir, afterPath, afterDir)
	}

	// A denied save must not add recents either (the environment starts empty).
	recentsMu.Lock()
	recentsCopy := append([]string(nil), recentsList...)
	recentsMu.Unlock()
	if len(recentsCopy) != 0 {
		t.Fatalf("denied requests touched the recents list: %v", recentsCopy)
	}
}

func TestBoundaryEventsStream(t *testing.T) {
	env := newBoundaryTestEnv(t)

	// Legitimate SSE stream opens and sends its first line; the context timeout
	// and the deferred close keep the test from blocking.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", env.base+"/api/events?token="+url.QueryEscape(appToken), nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = env.validHost()
	resp, err := env.client.Do(req)
	if err != nil {
		t.Fatalf("open SSE stream: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("SSE with a valid host: got %d, want 200", resp.StatusCode)
	}
	line, err := bufio.NewReader(resp.Body).ReadString('\n')
	if err != nil {
		t.Fatalf("read SSE greeting: %v", err)
	}
	if !strings.HasPrefix(line, ": connected") {
		t.Fatalf("unexpected SSE greeting %q", line)
	}

	// The same stream with a foreign Host is refused before subscribing.
	denied, _ := env.request("GET", "/api/events?token="+url.QueryEscape(appToken),
		"attacker.example:"+strconv.Itoa(env.port), nil, nil, nil)
	if denied.StatusCode != http.StatusForbidden {
		t.Fatalf("SSE with a foreign host: got %d, want 403", denied.StatusCode)
	}
}

func TestBoundaryDeniedRequestsHideDocumentContent(t *testing.T) {
	env := newBoundaryTestEnv(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "secret.md")
	const content = "TOP SECRET DOCUMENT"
	if err := os.WriteFile(doc, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	activeFileMu.Lock()
	activePath, activeDir = doc, dir
	activeFileMu.Unlock()

	foreign := "attacker.example:" + strconv.Itoa(env.port)
	paths := []string{
		"/api/file?path=" + url.QueryEscape(doc),
		"/static/js/app.js",
		"/api/init",
		"/",
	}
	for _, path := range paths {
		resp, body := env.request("GET", path, foreign, map[string]string{"X-Rigo-Token": appToken}, nil, nil)
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s with a foreign host: got %d, want 403", path, resp.StatusCode)
		}
		text := string(body)
		if strings.Contains(text, content) {
			t.Errorf("%s with a foreign host leaked document content", path)
		}
		if strings.Contains(text, appToken) || strings.Contains(text, controlToken) {
			t.Errorf("%s with a foreign host leaked a secret", path)
		}
	}
}
