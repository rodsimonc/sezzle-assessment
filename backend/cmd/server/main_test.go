package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"calculator/internal/config"
)

func env(pairs ...string) func(string) string {
	m := map[string]string{}
	for len(pairs) >= 2 {
		m[pairs[0]] = pairs[1]
		pairs = pairs[2:]
	}
	return func(k string) string { return m[k] }
}

func portOf(t *testing.T, rawURL string) string {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	return u.Port()
}

func freePort(t *testing.T) string {
	t.Helper()
	ln, err := listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ln.Close() }()
	return strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
}

func TestHealthcheckFlag(t *testing.T) {
	healthy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"status":"ok","version":"1.0.0"}`))
	}))
	defer healthy.Close()
	sick := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer sick.Close()

	tests := []struct {
		name string
		env  func(string) string
		want int
		msg  string
	}{
		{"healthy", env("PORT", portOf(t, healthy.URL)), 0, ""},
		{"unhealthy", env("PORT", portOf(t, sick.URL)), 1, "status 503"},
		{"nothing listening", env("PORT", freePort(t)), 1, "healthcheck failed"},
		{"bad config", env("PORT", "abc"), 1, "PORT"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			got := runContext(t.Context(), []string{"-healthcheck"}, tt.env, &stdout, &stderr)
			if got != tt.want {
				t.Fatalf("exit = %d, want %d (stderr %q)", got, tt.want, stderr.String())
			}
			if !strings.Contains(stderr.String(), tt.msg) {
				t.Fatalf("stderr = %q, want it to contain %q", stderr.String(), tt.msg)
			}
			if stdout.Len() != 0 {
				t.Fatalf("stdout = %q", stdout.String())
			}
		})
	}
}

func TestRunWrapperHandlesTheHealthcheck(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if got := run([]string{"-healthcheck"}, env("PORT", freePort(t)), &stdout, &stderr); got != 1 {
		t.Fatalf("exit = %d", got)
	}
}

func TestUnknownFlag(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if got := runContext(t.Context(), []string{"-nope"}, env(), &stdout, &stderr); got != 2 {
		t.Fatalf("exit = %d, want 2", got)
	}
	if !strings.Contains(stderr.String(), "nope") {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestConfigErrorStopsTheStart(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if got := runContext(t.Context(), nil, env("RATE_LIMIT_BURST", "0"), &stdout, &stderr); got != 1 {
		t.Fatalf("exit = %d", got)
	}
	if !strings.Contains(stderr.String(), "RATE_LIMIT_BURST") || stdout.Len() != 0 {
		t.Fatalf("stderr = %q, stdout = %q", stderr.String(), stdout.String())
	}
}

func TestServesUntilCancelled(t *testing.T) {
	port := freePort(t)
	var stdout, stderr bytes.Buffer
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan int, 1)
	go func() {
		done <- runContext(ctx, nil, env("PORT", port, "LOG_FORMAT", "text", "SHUTDOWN_TIMEOUT_SECONDS", "2"), &stdout, &stderr)
	}()

	target := "http://127.0.0.1:" + port + "/api/v1/calculations"
	var body string
	deadline := time.Now().Add(5 * time.Second)
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(`{"operation":"add","operands":[0.1,0.2]}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			b, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			body = string(b)
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the server never answered: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if body != `{"operation":"add","operands":[0.1,0.2],"result":0.3}` {
		t.Fatalf("body = %s", body)
	}

	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit = %d, stderr %q", code, stderr.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the server did not stop")
	}
	if !strings.Contains(stdout.String(), "starting") || !strings.Contains(stdout.String(), "shutting down") {
		t.Fatalf("logs = %q", stdout.String())
	}
}

func TestHealthURL(t *testing.T) {
	tests := []struct {
		host string
		port int
		want string
	}{
		{"", 8080, "http://127.0.0.1:8080/healthz"},
		{"0.0.0.0", 8080, "http://127.0.0.1:8080/healthz"},
		{"::", 9000, "http://127.0.0.1:9000/healthz"},
		{"127.0.0.1", 8080, "http://127.0.0.1:8080/healthz"},
		{"::1", 8080, "http://[::1]:8080/healthz"},
		{"192.168.1.5", 3000, "http://192.168.1.5:3000/healthz"},
		{"localhost", 8080, "http://localhost:8080/healthz"},
	}
	for _, tt := range tests {
		if got := healthURL(config.Config{Host: tt.host, Port: tt.port}); got != tt.want {
			t.Errorf("healthURL(%q, %d) = %q, want %q", tt.host, tt.port, got, tt.want)
		}
	}
}

func TestStartFailsWhenThePortIsTaken(t *testing.T) {
	ln, err := listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ln.Close() }()
	var stdout, stderr bytes.Buffer
	port := strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
	if got := runContext(t.Context(), nil, env("PORT", port), &stdout, &stderr); got != 1 {
		t.Fatalf("exit = %d", got)
	}
	if !strings.Contains(stdout.String(), "server stopped") {
		t.Fatalf("logs = %q", stdout.String())
	}
}

func TestProbeRejectsABadURL(t *testing.T) {
	if err := probe(t.Context(), "http://127.0.0.1:1/\x7f"); err == nil {
		t.Fatal("expected an error")
	}
}

func TestNewLogger(t *testing.T) {
	var jsonOut, textOut bytes.Buffer
	newLogger(&jsonOut, config.Config{LogFormat: "json"}).Info("hello", "k", "v")
	newLogger(&textOut, config.Config{LogFormat: "text"}).Info("hello", "k", "v")
	if !strings.HasPrefix(jsonOut.String(), "{") || !strings.Contains(jsonOut.String(), `"k":"v"`) {
		t.Errorf("json logger wrote %q", jsonOut.String())
	}
	if strings.HasPrefix(textOut.String(), "{") || !strings.Contains(textOut.String(), "k=v") {
		t.Errorf("text logger wrote %q", textOut.String())
	}
	var quiet bytes.Buffer
	newLogger(&quiet, config.Config{LogFormat: "json", LogLevel: 4}).Info("hidden")
	if quiet.Len() != 0 {
		t.Errorf("an info record passed an error-level logger: %q", quiet.String())
	}
}

// listen binds a TCP listener. A context-aware call keeps the noctx linter quiet.
func listen(addr string) (net.Listener, error) {
	var lc net.ListenConfig
	return lc.Listen(context.Background(), "tcp", addr)
}
