package middleware

import (
	"log/slog"
	"net/http"
	"time"

	"calculator/internal/problem"
)

// statusWriter records the status and the byte count for the access log.
type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}

// Unwrap lets http.ResponseController reach the real writer for flushing and deadlines.
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Logging writes one slog record per request. A panic that passes through still gets its record, as a 500.
func Logging(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w}
			finished := false
			defer func() {
				status := sw.status
				switch {
				case !finished:
					status = http.StatusInternalServerError
				case status == 0:
					status = http.StatusOK
				}
				logger.LogAttrs(r.Context(), slog.LevelInfo, "request",
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.Int("status", status),
					slog.Int64("durationMs", time.Since(start).Milliseconds()),
					slog.Int("bytes", sw.bytes),
					slog.String("requestId", problem.RequestID(r.Context())),
				)
			}()
			next.ServeHTTP(sw, r)
			finished = true
		})
	}
}
