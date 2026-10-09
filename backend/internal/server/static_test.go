package server

import (
	"bytes"
	"context"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"calculator/internal/config"
)

const indexHTML = `<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app-3f9a.js"></script></body></html>`

func staticSite(t *testing.T) http.Handler {
	t.Helper()
	dir := t.TempDir()
	write := func(name, content string) {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", indexHTML)
	write("assets/app-3f9a.js", "console.warn(1)")
	write("assets/style-77.css", "body{margin:0}")
	write("favicon.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>")
	write("notes.unknownext", "plain notes")
	cfg := testConfig()
	cfg.StaticDir = dir
	return newTestHandler(t, cfg, nil)
}

// Item 2.10.
func TestStaticHosting(t *testing.T) {
	h := staticSite(t)
	get := func(path string) *struct {
		code            int
		ct, cache, body string
	} {
		rec := call(t, h, request{method: "GET", path: path})
		return &struct {
			code            int
			ct, cache, body string
		}{rec.Code, rec.Header().Get("Content-Type"), rec.Header().Get("Cache-Control"), rec.Body.String()}
	}

	for _, path := range []string{"/", "/index.html"} {
		r := get(path)
		if r.code != 200 || !strings.HasPrefix(r.ct, "text/html") || !strings.Contains(r.body, `<div id="root">`) || r.cache != "no-cache" {
			t.Errorf("%s -> %d %q %q", path, r.code, r.ct, r.cache)
		}
	}
	js := get("/assets/app-3f9a.js")
	if js.code != 200 || js.cache != "public, max-age=31536000, immutable" || !strings.HasPrefix(js.ct, "text/javascript") || js.body != "console.warn(1)" {
		t.Errorf("js -> %+v", js)
	}
	if css := get("/assets/style-77.css"); css.code != 200 || !strings.HasPrefix(css.ct, "text/css") || css.cache != "public, max-age=31536000, immutable" {
		t.Errorf("css -> %+v", css)
	}
	if svg := get("/favicon.svg"); svg.code != 200 || svg.ct != "image/svg+xml" || svg.cache != "no-cache" {
		t.Errorf("svg -> %+v", svg)
	}
	if other := get("/notes.unknownext"); other.code != 200 || other.body != "plain notes" || other.ct == "" {
		t.Errorf("unknown extension -> %+v", other)
	}

	for _, path := range []string{"/some/deep/link", "/assets", "/assets/", "/settings"} {
		if r := get(path); r.code != 200 || r.body != indexHTML || r.cache != "no-cache" {
			t.Errorf("fallback %s -> %d %q", path, r.code, r.cache)
		}
	}

	p := asProblem(t, call(t, h, request{method: "GET", path: "/api/v1/nothing"}), 404, "NOT_FOUND")
	if strings.Contains(p.Detail, "html") {
		t.Errorf("detail = %q", p.Detail)
	}
	asProblem(t, call(t, h, request{method: "GET", path: "/api"}), 404, "NOT_FOUND")
	asProblem(t, call(t, h, request{method: "GET", path: "/assets/missing-123.js"}), 404, "NOT_FOUND")
}

func TestStaticHeadAndMethods(t *testing.T) {
	h := staticSite(t)
	head := call(t, h, request{method: "HEAD", path: "/"})
	if head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("Content-Type") == "" {
		t.Fatalf("HEAD / -> %d, %d body bytes", head.Code, head.Body.Len())
	}
	if head := call(t, h, request{method: "HEAD", path: "/some/deep/link"}); head.Code != 200 {
		t.Fatalf("HEAD deep link -> %d", head.Code)
	}
	for _, method := range []string{"POST", "PUT", "DELETE", "PATCH"} {
		rec := call(t, h, request{method: method, path: "/"})
		asProblem(t, rec, 405, "METHOD_NOT_ALLOWED")
		if rec.Header().Get("Allow") != "GET, HEAD" {
			t.Errorf("%s Allow = %q", method, rec.Header().Get("Allow"))
		}
	}
	// An API path never falls back to the page, whatever the method.
	asProblem(t, call(t, h, request{method: "POST", path: "/api/v1/nothing"}), 404, "NOT_FOUND")
}

func TestStaticRangeRequest(t *testing.T) {
	h := staticSite(t)
	rec := call(t, h, request{method: "GET", path: "/assets/app-3f9a.js", headers: map[string]string{"Range": "bytes=0-6"}})
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "console" {
		t.Fatalf("range -> %d %q", rec.Code, rec.Body.String())
	}
}

func TestStaticNeverEscapesTheDirectory(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(root, "secret.txt")
	if err := os.WriteFile(outside, []byte("TOP-SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	site := filepath.Join(root, "site")
	if err := os.MkdirAll(site, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(site, "index.html"), []byte(indexHTML), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := testConfig()
	cfg.StaticDir = site
	h := newTestHandler(t, cfg, nil)

	attacks := []string{
		"/../secret.txt", "/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc%2fpasswd", "/%2e%2e%2fsecret.txt",
		"/assets/../../secret.txt", "/..\\secret.txt", "/%5c..%5csecret.txt", "/C:/Windows/win.ini", "/..%00/secret.txt",
	}
	for _, attack := range attacks {
		req := mustRequest(t, http.MethodGet, attack)
		rec := httptestRecord(h, req)
		if strings.Contains(rec.Body.String(), "TOP-SECRET") || strings.Contains(rec.Body.String(), "root:") {
			t.Errorf("%s leaked file contents", attack)
		}
		if rec.Code >= 500 {
			t.Errorf("%s -> %d", attack, rec.Code)
		}
	}
}

func TestStaticWithoutDirIsAPIOnly(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	for _, method := range []string{"GET", "HEAD", "POST"} {
		asProblem(t, call(t, h, request{method: method, path: "/"}), 404, "NOT_FOUND")
	}
	asProblem(t, call(t, h, request{method: "GET", path: "/some/deep/link"}), 404, "NOT_FOUND")
}

func TestStaticWithMissingDirWarnsAndAnswers404(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	cfg := testConfig()
	cfg.StaticDir = filepath.Join(t.TempDir(), "does-not-exist")
	h := withMiddleware(t.Context(), routes(cfg, logger), cfg, logger, time.Now)
	asProblem(t, call(t, h, request{method: "GET", path: "/"}), 404, "NOT_FOUND")
	if !strings.Contains(logs.String(), "STATIC_DIR") {
		t.Fatalf("expected a warning, got %q", logs.String())
	}
}

func TestStaticDirWithoutIndexAnswers404(t *testing.T) {
	cfg := testConfig()
	cfg.StaticDir = t.TempDir()
	asProblem(t, call(t, newTestHandler(t, cfg, nil), request{method: "GET", path: "/anything"}), 404, "NOT_FOUND")
}

type noSeekFS struct{ fstest.MapFS }

func (n noSeekFS) Open(name string) (fs.File, error) {
	f, err := n.MapFS.Open(name)
	if err != nil {
		return nil, err
	}
	return struct{ fs.File }{f}, nil
}

func TestStaticFileWithoutSeekIsNotServed(t *testing.T) {
	s := &staticHandler{files: noSeekFS{fstest.MapFS{"index.html": {Data: []byte(indexHTML)}}}}
	rec := httptestRecord(s, mustRequest(t, "GET", "/"))
	if rec.Code != 404 {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestServeAndGracefulShutdown(t *testing.T) {
	ln, err := listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cfg := testConfig()
	cfg.ShutdownTimeout = 2 * time.Second
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, ln, cfg, quietLogger()) }()

	resp := getEventually(t, "http://"+ln.Addr().String()+"/healthz")
	status, requestID := resp.StatusCode, resp.Header.Get("X-Request-Id")
	_ = resp.Body.Close()
	if status != 200 || requestID == "" {
		t.Fatalf("healthz -> %d", status)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Serve returned %v after a clean shutdown", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return after the context ended")
	}
	if resp, err := getOnce(t, "http://"+ln.Addr().String()+"/healthz"); err == nil {
		_ = resp.Body.Close()
		t.Fatal("the listener still accepts requests after shutdown")
	}
}

func TestServeReturnsTheListenerFailure(t *testing.T) {
	ln, err := listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	if err := Serve(t.Context(), ln, testConfig(), quietLogger()); err == nil || !strings.Contains(err.Error(), "serve") {
		t.Fatalf("err = %v", err)
	}
}

func TestRunFailsWhenThePortIsTaken(t *testing.T) {
	ln, err := listen(":0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ln.Close() }()
	cfg := config.Config{Port: ln.Addr().(*net.TCPAddr).Port, ShutdownTimeout: time.Second}
	if err := Run(t.Context(), cfg, quietLogger()); err == nil || !strings.Contains(err.Error(), "listen") {
		t.Fatalf("err = %v", err)
	}
}

func TestRunServesAndStops(t *testing.T) {
	probe, err := listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	if err := probe.Close(); err != nil {
		t.Fatal(err)
	}
	cfg := testConfig()
	cfg.Port = port
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- Run(ctx, cfg, quietLogger()) }()
	resp := getEventually(t, "http://127.0.0.1:"+strconv.Itoa(port)+"/healthz")
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if string(body) != `{"status":"ok","version":"1.0.0"}` {
		t.Fatalf("body = %s", body)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run returned %v", err)
	}
}

func httptestRecord(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func mustRequest(t *testing.T, method, target string) *http.Request {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, "http://example.test"+target, http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	return req
}

func getOnce(t *testing.T, url string) (*http.Response, error) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	return http.DefaultClient.Do(req)
}

// getEventually retries until the server under test accepts connections.
func getEventually(t *testing.T, url string) *http.Response {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		resp, err := getOnce(t, url)
		if err == nil {
			return resp
		}
		if time.Now().After(deadline) {
			t.Fatalf("server never answered %s: %v", url, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// listen binds a TCP listener. A context-aware call keeps the noctx linter quiet.
func listen(addr string) (net.Listener, error) {
	var lc net.ListenConfig
	return lc.Listen(context.Background(), "tcp", addr)
}
