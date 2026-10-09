// Package server builds the router and the middleware chain, and runs the HTTP server.
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"calculator/api"
	"calculator/internal/config"
	"calculator/internal/handler"
	"calculator/internal/middleware"
	"calculator/internal/service"
)

// New builds the handler with its full middleware chain. The rate limiter's janitor goroutine
// lives as long as the process. Run ties it to its context instead.
func New(cfg config.Config, logger *slog.Logger) http.Handler {
	return build(context.Background(), cfg, logger, time.Now)
}

func build(ctx context.Context, cfg config.Config, logger *slog.Logger, now func() time.Time) http.Handler {
	return withMiddleware(ctx, routes(cfg, logger), cfg, logger, now)
}

func routes(cfg config.Config, logger *slog.Logger) http.Handler {
	h := handler.New(service.New(), logger, api.Spec)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/calculations", h.Calculations)
	mux.HandleFunc("/api/v1/operations", h.Operations)
	mux.HandleFunc("/api/v1/operations/{name}", h.RunOperation)
	mux.HandleFunc("/api/v1/openapi.yaml", h.OpenAPI)
	mux.HandleFunc("/healthz", h.Health)
	mux.HandleFunc("/api", handler.NotFound)
	mux.HandleFunc("/api/", handler.NotFound)
	static := newStatic(cfg.StaticDir, logger)
	mux.Handle("/", static)
	return withoutRedirects(mux, static)
}

// withoutRedirects answers paths with dot segments or doubled slashes itself. ServeMux would send
// those a 307 to the cleaned path. The static handler cleans the path on its own and never leaves
// the site directory, and an API path like that is a plain 404.
func withoutRedirects(mux, static http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "" || r.Method == http.MethodConnect || cleanPath(p) == p {
			mux.ServeHTTP(w, r)
			return
		}
		if p == "/api" || strings.HasPrefix(p, "/api/") {
			handler.NotFound(w, r)
			return
		}
		static.ServeHTTP(w, r)
	})
}

// cleanPath mirrors how ServeMux cleans a path: path.Clean plus the trailing slash.
func cleanPath(p string) string {
	cleaned := path.Clean(p)
	if p[len(p)-1] == '/' && cleaned != "/" {
		cleaned += "/"
	}
	return cleaned
}

// withMiddleware wraps next in the fixed chain. Outermost first: RequestID, Recover, SecurityHeaders,
// Logging, CORS, RateLimit, BodyLimit. Every response, including the ones the inner layers write
// themselves, carries the request id and the security headers.
func withMiddleware(ctx context.Context, next http.Handler, cfg config.Config, logger *slog.Logger, now func() time.Time) http.Handler {
	rateLimit := middleware.RateLimit(ctx, middleware.RateLimitOptions{
		PerMinute:  cfg.RateLimitPerMinute,
		Burst:      cfg.RateLimitBurst,
		TrustProxy: cfg.TrustProxy,
		Now:        now,
	})
	chained := middleware.BodyLimit(middleware.MaxBodyBytes)(next)
	chained = rateLimit(chained)
	chained = middleware.CORS(cfg.CORSAllowedOrigins)(chained)
	chained = middleware.Logging(logger)(chained)
	chained = middleware.SecurityHeaders(chained)
	chained = middleware.Recover(logger)(chained)
	return middleware.RequestID(chained)
}

// Run listens on cfg.Host and cfg.Port and serves until ctx ends, then shuts down within cfg.ShutdownTimeout.
// An empty Host means loopback, the same default config.Load applies.
func Run(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	host := cfg.Host
	if host == "" {
		host = "127.0.0.1"
	}
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(cfg.Port)))
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	return Serve(ctx, ln, cfg, logger)
}

// Serve runs the server on an existing listener. It returns nil after a clean shutdown.
func Serve(ctx context.Context, ln net.Listener, cfg config.Config, logger *slog.Logger) error {
	srv := &http.Server{
		Handler:           build(ctx, cfg, logger, time.Now),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}
	failed := make(chan error, 1)
	go func() { failed <- srv.Serve(ln) }()

	logger.Info("server listening", "addr", ln.Addr().String(), "staticDir", cfg.StaticDir)
	select {
	case err := <-failed:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}

	logger.Info("shutting down", "timeoutSeconds", int(cfg.ShutdownTimeout.Seconds()))
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-failed; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	return nil
}

// staticDirExists reports whether dir is a directory, so New can warn about a bad STATIC_DIR.
func staticDirExists(dir string) bool {
	info, err := os.Stat(dir)
	return err == nil && info.IsDir()
}
