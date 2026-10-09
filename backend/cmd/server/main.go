// Command server runs the calculator API and, when STATIC_DIR is set, the built frontend.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"calculator/internal/config"
	"calculator/internal/server"
	"calculator/internal/version"
)

func main() {
	os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}

// run starts the service and returns the process exit code. SIGINT and SIGTERM end it cleanly.
func run(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runContext(ctx, args, getenv, stdout, stderr)
}

func runContext(ctx context.Context, args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("server", flag.ContinueOnError)
	flags.SetOutput(stderr)
	healthcheck := flags.Bool("healthcheck", false, "probe /healthz on 127.0.0.1 and exit 0 when it answers 200")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	cfg, err := config.Load(getenv)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "config error: %v\n", err)
		return 1
	}

	if *healthcheck {
		if err := probe(ctx, healthURL(cfg)); err != nil {
			_, _ = fmt.Fprintf(stderr, "healthcheck failed: %v\n", err)
			return 1
		}
		return 0
	}

	logger := newLogger(stdout, cfg)
	logger.Info("starting", "version", version.Version, "port", cfg.Port)
	if err := server.Run(ctx, cfg, logger); err != nil {
		logger.Error("server stopped", "error", err)
		return 1
	}
	return 0
}

func newLogger(w io.Writer, cfg config.Config) *slog.Logger {
	opts := &slog.HandlerOptions{Level: cfg.LogLevel}
	if cfg.LogFormat == "text" {
		return slog.New(slog.NewTextHandler(w, opts))
	}
	return slog.New(slog.NewJSONHandler(w, opts))
}

// healthURL is where the running service answers /healthz. A wildcard listen address such as 0.0.0.0
// is reached through loopback, because the probe runs inside the same container or host.
func healthURL(cfg config.Config) string {
	host := cfg.Host
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, strconv.Itoa(cfg.Port)) + "/healthz"
}

// probe sends GET to url with a 3 second limit and wants a 200.
func probe(ctx context.Context, url string) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}
