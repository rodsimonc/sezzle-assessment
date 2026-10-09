package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"calculator/internal/problem"
)

var ok = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte("ok"))
})

func do(h http.Handler, method, target string, mutate ...func(*http.Request)) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), method, target, nil)
	for _, m := range mutate {
		m(req)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func header(key, value string) func(*http.Request) {
	return func(r *http.Request) { r.Header.Set(key, value) }
}

func problemOf(t *testing.T, rec *httptest.ResponseRecorder) problem.Problem {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	var p problem.Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestIsAPIPath(t *testing.T) {
	tests := map[string]bool{
		"/api": true, "/api/": true, "/api/v1/calculations": true,
		"/apix": false, "/": false, "/healthz": false, "/assets/api/x.js": false,
	}
	for path, want := range tests {
		if got := IsAPIPath(path); got != want {
			t.Errorf("IsAPIPath(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestRequestID(t *testing.T) {
	hex32 := regexp.MustCompile(`^[0-9a-f]{32}$`)
	var seen string
	h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = problem.RequestID(r.Context())
		ok.ServeHTTP(w, r)
	}))

	t.Run("generated", func(t *testing.T) {
		rec := do(h, "GET", "/")
		id := rec.Header().Get("X-Request-Id")
		if !hex32.MatchString(id) || seen != id {
			t.Fatalf("header %q, context %q", id, seen)
		}
		if other := do(h, "GET", "/").Header().Get("X-Request-Id"); other == id {
			t.Fatal("two requests got the same id")
		}
	})
	t.Run("valid incoming id is echoed", func(t *testing.T) {
		for _, in := range []string{"abc-123_X.y", strings.Repeat("a", 64), "a"} {
			if got := do(h, "GET", "/", header("X-Request-Id", in)).Header().Get("X-Request-Id"); got != in || seen != in {
				t.Errorf("incoming %q -> header %q context %q", in, got, seen)
			}
		}
	})
	t.Run("invalid incoming id is replaced", func(t *testing.T) {
		for _, in := range []string{"has space", strings.Repeat("a", 65), "semi;colon", "ünï"} {
			if got := do(h, "GET", "/", header("X-Request-Id", in)).Header().Get("X-Request-Id"); !hex32.MatchString(got) {
				t.Errorf("incoming %q -> %q", in, got)
			}
		}
	})
}

func TestRecover(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	boom := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("secret internal detail") })
	h := RequestID(Recover(logger)(boom))

	rec := do(h, "GET", "/api/v1/calculations")
	p := problemOf(t, rec)
	if rec.Code != 500 || p.Code != "INTERNAL_ERROR" || p.Detail != problem.DetailInternalError || p.RequestID != rec.Header().Get("X-Request-Id") {
		t.Fatalf("got %d %+v", rec.Code, p)
	}
	if strings.Contains(rec.Body.String(), "secret") {
		t.Fatal("the body leaks the panic value")
	}
	if !strings.Contains(logs.String(), "secret internal detail") || !strings.Contains(logs.String(), "stack=") {
		t.Fatalf("the log lacks the panic or the stack: %s", logs.String())
	}

	pass := RequestID(Recover(logger)(ok))
	if rec := do(pass, "GET", "/"); rec.Code != 200 || rec.Body.String() != "ok" {
		t.Fatalf("no panic -> %d %s", rec.Code, rec.Body.String())
	}
}

func TestRecoverRepanicsOnAbortHandler(t *testing.T) {
	abort := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) })
	defer func() {
		if err, isErr := recover().(error); !isErr || !errors.Is(err, http.ErrAbortHandler) {
			t.Fatalf("recovered %v, want http.ErrAbortHandler", err)
		}
	}()
	do(Recover(slog.New(slog.NewTextHandler(io.Discard, nil)))(abort), "GET", "/")
}

func TestSecurityHeaders(t *testing.T) {
	h := SecurityHeaders(ok)
	tests := []struct {
		path    string
		noStore bool
	}{
		{"/", false}, {"/assets/app.js", false}, {"/api/v1/operations", true}, {"/api/v1/nothing", true}, {"/healthz", true},
	}
	for _, tt := range tests {
		rec := do(h, "GET", tt.path)
		want := map[string]string{
			"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
		}
		for k, v := range want {
			if got := rec.Header().Get(k); got != v {
				t.Errorf("%s %s = %q, want %q", tt.path, k, got, v)
			}
		}
		csp := rec.Header().Get("Content-Security-Policy")
		for _, part := range []string{"default-src 'self'", "frame-ancestors 'none'", "script-src 'self'", "base-uri 'self'", "form-action 'self'"} {
			if !strings.Contains(csp, part) {
				t.Errorf("%s CSP %q lacks %s", tt.path, csp, part)
			}
		}
		if got := rec.Header().Get("Cache-Control") == "no-store"; got != tt.noStore {
			t.Errorf("%s no-store = %v, want %v", tt.path, got, tt.noStore)
		}
	}
}

func TestBodyLimit(t *testing.T) {
	read := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.ReadAll(r.Body)
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	h := BodyLimit(MaxBodyBytes)(read)
	send := func(path string, size int) int {
		req := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(strings.Repeat("x", size)))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	tests := []struct {
		path string
		size int
		want int
	}{
		{"/api/v1/calculations", 4096, 204},
		{"/api/v1/calculations", 4097, 413},
		{"/api/v1/operations/add", 5000, 413},
		{"/not-api", 5000, 204},
	}
	for _, tt := range tests {
		if got := send(tt.path, tt.size); got != tt.want {
			t.Errorf("%s %d bytes -> %d, want %d", tt.path, tt.size, got, tt.want)
		}
	}
}

func TestBodyLimitDrainsAnUnreadBody(t *testing.T) {
	var body io.ReadCloser
	h := BodyLimit(MaxBodyBytes)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body = r.Body
		w.WriteHeader(http.StatusUnsupportedMediaType)
	}))
	req := httptest.NewRequestWithContext(t.Context(), "POST", "/api/v1/calculations", strings.NewReader(strings.Repeat("x", 3000)))
	h.ServeHTTP(httptest.NewRecorder(), req)
	if n, err := body.Read(make([]byte, 1)); n != 0 || !errors.Is(err, io.EOF) {
		t.Errorf("unread body left behind: read %d bytes, err %v", n, err)
	}
}

func TestLogging(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	h := RequestID(Logging(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("short and stout"))
	})))

	rec := do(h, "POST", "/api/v1/calculations", header("X-Request-Id", "log-1"))
	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d", rec.Code)
	}
	var entry map[string]any
	if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
		t.Fatalf("log line is not JSON: %v: %s", err, logs.String())
	}
	want := map[string]any{"msg": "request", "method": "POST", "path": "/api/v1/calculations", "status": float64(418), "bytes": float64(15), "requestId": "log-1"}
	for k, v := range want {
		if entry[k] != v {
			t.Errorf("log %s = %v, want %v", k, entry[k], v)
		}
	}
	if _, found := entry["durationMs"]; !found {
		t.Error("log lacks durationMs")
	}
	if strings.Count(logs.String(), "\n") != 1 {
		t.Errorf("expected one record, got %q", logs.String())
	}
}

func TestLoggingDefaultsStatusTo200AndLogsPanicsAs500(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))

	do(Logging(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})), "GET", "/silent")
	do(Logging(logger)(ok), "GET", "/body-only")
	if !strings.Contains(logs.String(), `"path":"/silent","status":200`) || !strings.Contains(logs.String(), `"path":"/body-only","status":200`) {
		t.Fatalf("status should default to 200: %s", logs.String())
	}

	logs.Reset()
	func() {
		defer func() { _ = recover() }()
		do(Logging(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("x") })), "GET", "/boom")
	}()
	if !strings.Contains(logs.String(), `"path":"/boom","status":500`) {
		t.Fatalf("a panic should log a 500: %s", logs.String())
	}
}

func TestStatusWriterUnwrap(t *testing.T) {
	rec := httptest.NewRecorder()
	sw := &statusWriter{ResponseWriter: rec}
	if sw.Unwrap() != http.ResponseWriter(rec) {
		t.Fatal("Unwrap should return the wrapped writer")
	}
	if err := http.NewResponseController(sw).Flush(); err != nil {
		t.Fatalf("Flush through the wrapper failed: %v", err)
	}
	sw.WriteHeader(201)
	sw.WriteHeader(202)
	if sw.status != 201 {
		t.Fatalf("status = %d, want the first one", sw.status)
	}
}

func TestCORS(t *testing.T) {
	const allowed = "https://app.example.com"
	h := CORS([]string{allowed})(ok)
	preflight := func(origin string) *httptest.ResponseRecorder {
		return do(h, "OPTIONS", "/api/v1/calculations", header("Origin", origin), header("Access-Control-Request-Method", "POST"))
	}

	t.Run("allowed preflight", func(t *testing.T) {
		rec := preflight(allowed)
		if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") != allowed {
			t.Fatalf("got %d %v", rec.Code, rec.Header())
		}
		if !strings.Contains(rec.Header().Get("Access-Control-Allow-Methods"), "POST") ||
			!strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), "Content-Type") ||
			rec.Header().Get("Vary") != "Origin" {
			t.Fatalf("headers = %v", rec.Header())
		}
	})
	t.Run("rejected preflight", func(t *testing.T) {
		rec := preflight("https://evil.example")
		p := problemOf(t, rec)
		if rec.Code != 403 || p.Code != "CORS_ORIGIN_NOT_ALLOWED" || p.Detail != "Origin isn't allowed." ||
			rec.Header().Get("Access-Control-Allow-Origin") != "" || rec.Header().Get("Vary") != "Origin" {
			t.Fatalf("got %d %+v %v", rec.Code, p, rec.Header())
		}
	})
	t.Run("simple request from an allowed origin", func(t *testing.T) {
		rec := do(h, "POST", "/api/v1/calculations", header("Origin", allowed))
		if rec.Code != 200 || rec.Header().Get("Access-Control-Allow-Origin") != allowed || rec.Header().Get("Vary") != "Origin" {
			t.Fatalf("got %d %v", rec.Code, rec.Header())
		}
	})
	t.Run("simple request from another origin is served without the header", func(t *testing.T) {
		rec := do(h, "POST", "/api/v1/calculations", header("Origin", "https://evil.example"))
		if rec.Code != 200 || rec.Header().Get("Access-Control-Allow-Origin") != "" || rec.Header().Get("Vary") != "Origin" {
			t.Fatalf("got %d %v", rec.Code, rec.Header())
		}
	})
	t.Run("no origin", func(t *testing.T) {
		rec := do(h, "GET", "/api/v1/operations")
		if rec.Code != 200 || rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("got %d %v", rec.Code, rec.Header())
		}
	})
	t.Run("OPTIONS without a request method goes through", func(t *testing.T) {
		rec := do(h, "OPTIONS", "/api/v1/calculations", header("Origin", allowed))
		if rec.Code != 200 || rec.Header().Get("Access-Control-Allow-Origin") != allowed {
			t.Fatalf("got %d %v", rec.Code, rec.Header())
		}
	})
	t.Run("empty allowlist is inert", func(t *testing.T) {
		inert := CORS(nil)(ok)
		rec := do(inert, "OPTIONS", "/api/v1/calculations", header("Origin", allowed), header("Access-Control-Request-Method", "POST"))
		if rec.Code != 200 || rec.Header().Get("Access-Control-Allow-Origin") != "" || rec.Header().Get("Vary") != "" {
			t.Fatalf("got %d %v", rec.Code, rec.Header())
		}
	})
}

// fakeClock drives the limiter without sleeping.
type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time          { return c.now }
func (c *fakeClock) Advance(d time.Duration) { c.now = c.now.Add(d) }

func newClock() *fakeClock { return &fakeClock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)} }

func limited(t *testing.T, clock *fakeClock, opts RateLimitOptions) http.Handler {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	opts.Now = clock.Now
	return RateLimit(ctx, opts)(ok)
}

func TestRateLimitBurstThenRefill(t *testing.T) {
	clock := newClock()
	h := limited(t, clock, RateLimitOptions{PerMinute: 60, Burst: 5})
	remote := func(r *http.Request) { r.RemoteAddr = "10.0.0.1:5555" }

	for i := 1; i <= 5; i++ {
		if rec := do(h, "POST", "/api/v1/calculations", remote); rec.Code != 200 {
			t.Fatalf("request %d -> %d", i, rec.Code)
		}
	}
	rec := do(h, "POST", "/api/v1/calculations", remote)
	p := problemOf(t, rec)
	if rec.Code != 429 || p.Code != "RATE_LIMITED" || p.RetryAfter != 1 || rec.Header().Get("Retry-After") != "1" ||
		p.Detail != "Too many requests. Try again in 1 second." {
		t.Fatalf("got %d %+v Retry-After=%q", rec.Code, p, rec.Header().Get("Retry-After"))
	}

	if rec := do(h, "GET", "/healthz", remote); rec.Code != 200 {
		t.Fatalf("/healthz while limited -> %d", rec.Code)
	}
	if rec := do(h, "GET", "/index.html", remote); rec.Code != 200 {
		t.Fatalf("static while limited -> %d", rec.Code)
	}

	clock.Advance(500 * time.Millisecond)
	if rec := do(h, "POST", "/api/v1/calculations", remote); rec.Code != 429 || rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("half a token should not be enough: %d", rec.Code)
	}
	clock.Advance(time.Second)
	if rec := do(h, "POST", "/api/v1/calculations", remote); rec.Code != 200 {
		t.Fatalf("after waiting Retry-After -> %d", rec.Code)
	}
}

func TestRateLimitRetryAfterRoundsUp(t *testing.T) {
	clock := newClock()
	h := limited(t, clock, RateLimitOptions{PerMinute: 1, Burst: 1})
	do(h, "POST", "/api/v1/calculations")
	rec := do(h, "POST", "/api/v1/calculations")
	p := problemOf(t, rec)
	if rec.Header().Get("Retry-After") != "60" || p.RetryAfter != 60 || p.Detail != "Too many requests. Try again in 60 seconds." {
		t.Fatalf("got Retry-After=%q %+v", rec.Header().Get("Retry-After"), p)
	}
	clock.Advance(59*time.Second + 500*time.Millisecond)
	if rec := do(h, "POST", "/api/v1/calculations"); rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("0.5 seconds left should round up to 1, got %q", rec.Header().Get("Retry-After"))
	}
}

func TestRateLimitKeys(t *testing.T) {
	forwarded := func(addr, xff string) func(*http.Request) {
		return func(r *http.Request) {
			r.RemoteAddr = addr
			if xff != "" {
				r.Header.Set("X-Forwarded-For", xff)
			}
		}
	}
	t.Run("trusted proxy gives each forwarded address its own bucket", func(t *testing.T) {
		h := limited(t, newClock(), RateLimitOptions{PerMinute: 60, Burst: 1, TrustProxy: true})
		if do(h, "GET", "/api/v1/operations", forwarded("10.0.0.1:1", "1.1.1.1, 10.0.0.1")).Code != 200 ||
			do(h, "GET", "/api/v1/operations", forwarded("10.0.0.1:1", "2.2.2.2")).Code != 200 {
			t.Fatal("different forwarded addresses should not share a bucket")
		}
		if do(h, "GET", "/api/v1/operations", forwarded("10.0.0.1:1", "1.1.1.1")).Code != 429 {
			t.Fatal("the same forwarded address should share a bucket")
		}
	})
	t.Run("an untrusted header is ignored", func(t *testing.T) {
		h := limited(t, newClock(), RateLimitOptions{PerMinute: 60, Burst: 1})
		if do(h, "GET", "/api/v1/operations", forwarded("10.0.0.1:1", "1.1.1.1")).Code != 200 {
			t.Fatal("first request should pass")
		}
		if do(h, "GET", "/api/v1/operations", forwarded("10.0.0.1:2", "2.2.2.2")).Code != 429 {
			t.Fatal("the same remote host should share a bucket whatever the header says")
		}
		if do(h, "GET", "/api/v1/operations", forwarded("10.0.0.2:1", "")).Code != 200 {
			t.Fatal("a different remote host should have its own bucket")
		}
	})
	t.Run("a bad forwarded value falls back to the remote address", func(t *testing.T) {
		h := limited(t, newClock(), RateLimitOptions{PerMinute: 60, Burst: 1, TrustProxy: true})
		do(h, "GET", "/api/v1/operations", forwarded("10.0.0.1:1", "not-an-ip"))
		if do(h, "GET", "/api/v1/operations", forwarded("10.0.0.1:2", "also-bad")).Code != 429 {
			t.Fatal("both requests should map to 10.0.0.1")
		}
	})
	t.Run("a remote address without a port is used as is", func(t *testing.T) {
		if got := clientKey(&http.Request{RemoteAddr: "pipe", Header: http.Header{}}, false); got != "pipe" {
			t.Fatalf("clientKey = %q", got)
		}
	})
}

func TestRateLimitDisabled(t *testing.T) {
	h := limited(t, newClock(), RateLimitOptions{PerMinute: 0, Burst: 1})
	for i := 0; i < 50; i++ {
		if do(h, "GET", "/api/v1/operations").Code != 200 {
			t.Fatalf("request %d was limited", i)
		}
	}
}

func TestLimiterSweepEvictsOnlyIdleBuckets(t *testing.T) {
	clock := newClock()
	l := newLimiter(RateLimitOptions{PerMinute: 60, Burst: 5, Now: clock.Now})
	l.allow("idle")
	clock.Advance(4 * time.Second)
	l.allow("busy")
	l.sweep()
	if l.size() != 2 {
		t.Fatalf("size = %d, want 2: nothing has refilled yet", l.size())
	}
	clock.Advance(2 * time.Second) // idle: 6s >= 5s to refill, busy: 2s
	l.sweep()
	if l.size() != 1 {
		t.Fatalf("size = %d, want 1", l.size())
	}
	if _, found := l.buckets["busy"]; !found {
		t.Fatal("the busy bucket was evicted")
	}
}

func TestLimiterJanitorStopsWithTheContext(t *testing.T) {
	clock := newClock()
	l := newLimiter(RateLimitOptions{PerMinute: 60, Burst: 1, Now: clock.Now})
	l.allow("a")
	clock.Advance(time.Minute)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { l.janitor(ctx, time.Millisecond); close(done) }()

	deadline := time.After(5 * time.Second)
	for l.size() != 0 {
		select {
		case <-deadline:
			t.Fatal("the janitor never evicted the idle bucket")
		case <-time.After(time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-deadline:
		t.Fatal("the janitor kept running after the context ended")
	}
}

func TestRateLimitStartsJanitorWithDefaultInterval(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := RateLimit(ctx, RateLimitOptions{PerMinute: 60, Burst: 1})(ok)
	if do(h, "GET", "/api/v1/operations").Code != 200 {
		t.Fatal("first request should pass with the real clock")
	}
}
