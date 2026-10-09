package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

func env(pairs ...string) func(string) string {
	m := map[string]string{}
	for len(pairs) >= 2 {
		m[pairs[0]] = pairs[1]
		pairs = pairs[2:]
	}
	return func(k string) string { return m[k] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(env())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "127.0.0.1" || cfg.Port != 8080 || cfg.StaticDir != "" || len(cfg.CORSAllowedOrigins) != 0 || cfg.RateLimitPerMinute != 120 ||
		cfg.RateLimitBurst != 30 || cfg.TrustProxy || cfg.LogLevel != slog.LevelInfo || cfg.LogFormat != "json" ||
		cfg.ShutdownTimeout != 10*time.Second {
		t.Fatalf("defaults = %+v", cfg)
	}
}

func TestLoadValues(t *testing.T) {
	cfg, err := Load(env(
		"PORT", "9090", "STATIC_DIR", "frontend/dist",
		"CORS_ALLOWED_ORIGINS", " https://app.example.com , http://localhost:5173,,",
		"RATE_LIMIT_PER_MINUTE", "0", "RATE_LIMIT_BURST", "5", "TRUST_PROXY", "true",
		"LOG_LEVEL", "DEBUG", "LOG_FORMAT", "Text", "SHUTDOWN_TIMEOUT_SECONDS", "3",
	))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 9090 || cfg.StaticDir != "frontend/dist" || cfg.RateLimitPerMinute != 0 || cfg.RateLimitBurst != 5 ||
		!cfg.TrustProxy || cfg.LogLevel != slog.LevelDebug || cfg.LogFormat != "text" || cfg.ShutdownTimeout != 3*time.Second {
		t.Fatalf("cfg = %+v", cfg)
	}
	if len(cfg.CORSAllowedOrigins) != 2 || cfg.CORSAllowedOrigins[0] != "https://app.example.com" || cfg.CORSAllowedOrigins[1] != "http://localhost:5173" {
		t.Fatalf("origins = %q", cfg.CORSAllowedOrigins)
	}
}

func TestLoadListenHost(t *testing.T) {
	for _, in := range []string{"0.0.0.0", "::", "::1", "127.0.0.1", "192.168.1.5", "localhost", " 0.0.0.0 "} {
		cfg, err := Load(env("LISTEN_HOST", in))
		if err != nil || cfg.Host != strings.TrimSpace(in) {
			t.Errorf("LISTEN_HOST=%q -> %q, %v", in, cfg.Host, err)
		}
	}
}

func TestLoadLogLevels(t *testing.T) {
	for in, want := range map[string]slog.Level{"debug": slog.LevelDebug, "info": slog.LevelInfo, "warn": slog.LevelWarn, "error": slog.LevelError, "WARN": slog.LevelWarn} {
		cfg, err := Load(env("LOG_LEVEL", in))
		if err != nil || cfg.LogLevel != want {
			t.Errorf("LOG_LEVEL=%s -> %v, %v", in, cfg.LogLevel, err)
		}
	}
}

func TestLoadRejectsBadValuesAndNamesTheVariable(t *testing.T) {
	tests := []struct{ name, value string }{
		{"LISTEN_HOST", "example.com"}, {"LISTEN_HOST", "0.0.0.0:8080"}, {"LISTEN_HOST", "*"},
		{"PORT", "abc"}, {"PORT", "0"}, {"PORT", "70000"}, {"PORT", "-1"}, {"PORT", "80.5"},
		{"RATE_LIMIT_PER_MINUTE", "-1"}, {"RATE_LIMIT_PER_MINUTE", "fast"},
		{"RATE_LIMIT_BURST", "0"}, {"RATE_LIMIT_BURST", "x"},
		{"TRUST_PROXY", "maybe"},
		{"LOG_LEVEL", "verbose"}, {"LOG_FORMAT", "xml"},
		{"SHUTDOWN_TIMEOUT_SECONDS", "0"}, {"SHUTDOWN_TIMEOUT_SECONDS", "soon"},
		{"CORS_ALLOWED_ORIGINS", "*"}, {"CORS_ALLOWED_ORIGINS", "app.example.com"},
		{"CORS_ALLOWED_ORIGINS", "https://app.example.com/"}, {"CORS_ALLOWED_ORIGINS", "https://app.example.com/path"},
		{"CORS_ALLOWED_ORIGINS", "ftp://app.example.com"}, {"CORS_ALLOWED_ORIGINS", "https://ok.example.com,bad"},
		{"CORS_ALLOWED_ORIGINS", "https://user@app.example.com"}, {"CORS_ALLOWED_ORIGINS", "https://app.example.com?x=1"},
		{"CORS_ALLOWED_ORIGINS", "https://%zz"},
	}
	for _, tt := range tests {
		t.Run(tt.name+"="+tt.value, func(t *testing.T) {
			_, err := Load(env(tt.name, tt.value))
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tt.name) {
				t.Fatalf("error %q does not name %s", err, tt.name)
			}
		})
	}
}

func TestLoadBlankValuesUseDefaults(t *testing.T) {
	cfg, err := Load(env("PORT", "  ", "LOG_LEVEL", "", "TRUST_PROXY", " "))
	if err != nil || cfg.Port != 8080 || cfg.TrustProxy {
		t.Fatalf("cfg = %+v, err = %v", cfg, err)
	}
}
