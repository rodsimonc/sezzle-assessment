// Package config reads and validates the environment variables the service understands.
package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config holds the validated settings.
type Config struct {
	Port               int
	StaticDir          string
	CORSAllowedOrigins []string
	RateLimitPerMinute int
	RateLimitBurst     int
	TrustProxy         bool
	LogLevel           slog.Level
	LogFormat          string
	ShutdownTimeout    time.Duration
}

// Load reads the settings through getenv. An unset or empty variable takes its default.
// A bad value returns an error that names the variable.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		StaticDir: getenv("STATIC_DIR"),
	}
	var err error
	if cfg.Port, err = intVar(getenv, "PORT", 8080, 1, 65535); err != nil {
		return Config{}, err
	}
	if cfg.RateLimitPerMinute, err = intVar(getenv, "RATE_LIMIT_PER_MINUTE", 120, 0, 1_000_000); err != nil {
		return Config{}, err
	}
	if cfg.RateLimitBurst, err = intVar(getenv, "RATE_LIMIT_BURST", 30, 1, 1_000_000); err != nil {
		return Config{}, err
	}
	seconds, err := intVar(getenv, "SHUTDOWN_TIMEOUT_SECONDS", 10, 1, 3600)
	if err != nil {
		return Config{}, err
	}
	cfg.ShutdownTimeout = time.Duration(seconds) * time.Second

	if cfg.TrustProxy, err = boolVar(getenv, "TRUST_PROXY", false); err != nil {
		return Config{}, err
	}
	if cfg.LogLevel, err = levelVar(getenv, "LOG_LEVEL"); err != nil {
		return Config{}, err
	}
	if cfg.LogFormat, err = formatVar(getenv, "LOG_FORMAT"); err != nil {
		return Config{}, err
	}
	if cfg.CORSAllowedOrigins, err = originsVar(getenv, "CORS_ALLOWED_ORIGINS"); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func intVar(getenv func(string) string, name string, def, lo, hi int) (int, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < lo || n > hi {
		return 0, fmt.Errorf("%s must be a whole number from %d to %d, got %q", name, lo, hi, raw)
	}
	return n, nil
}

func boolVar(getenv func(string) string, name string, def bool) (bool, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false, got %q", name, raw)
	}
	return b, nil
}

func levelVar(getenv func(string) string, name string) (slog.Level, error) {
	raw := strings.ToLower(strings.TrimSpace(getenv(name)))
	switch raw {
	case "", "info":
		return slog.LevelInfo, nil
	case "debug":
		return slog.LevelDebug, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	}
	return 0, fmt.Errorf("%s must be debug, info, warn or error, got %q", name, raw)
}

func formatVar(getenv func(string) string, name string) (string, error) {
	raw := strings.ToLower(strings.TrimSpace(getenv(name)))
	switch raw {
	case "", "json":
		return "json", nil
	case "text":
		return "text", nil
	}
	return "", fmt.Errorf("%s must be json or text, got %q", name, raw)
}

// originsVar parses a comma-separated allowlist. Each entry is a bare origin such as https://app.example.com.
func originsVar(getenv func(string) string, name string) ([]string, error) {
	var origins []string
	for _, entry := range strings.Split(getenv(name), ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		u, err := url.Parse(entry)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return nil, fmt.Errorf("%s entries must look like https://app.example.com, got %q", name, entry)
		}
		origins = append(origins, entry)
	}
	return origins, nil
}
