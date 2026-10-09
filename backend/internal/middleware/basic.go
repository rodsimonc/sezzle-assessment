// Package middleware holds the HTTP middleware. Each one has the shape func(http.Handler) http.Handler
// (or a function that returns one), so the server composes them in a fixed order.
package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"strings"

	"calculator/internal/problem"
)

// MaxBodyBytes is the request body limit for /api/ routes.
const MaxBodyBytes = 4096

const requestIDHeader = "X-Request-Id"

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
	"connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// IsAPIPath reports whether a path belongs to the API (/api or anything under /api/).
func IsAPIPath(path string) bool {
	return path == "/api" || strings.HasPrefix(path, "/api/")
}

// RequestID gives every request an id. A valid incoming X-Request-Id is kept. Anything else is replaced
// with 16 random bytes as 32 hex characters.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(requestIDHeader)
		if !validRequestID.MatchString(id) {
			id = newRequestID()
		}
		w.Header().Set(requestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(problem.WithRequestID(r.Context(), id)))
	})
}

func newRequestID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b) // never fails since Go 1.24
	return hex.EncodeToString(b)
}

// Recover turns a panic into a 500 Problem. The body never carries the panic value or the stack.
// Those go to the log.
func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if err, isErr := v.(error); isErr && errors.Is(err, http.ErrAbortHandler) {
					panic(v) // net/http uses this value to abort a response quietly
				}
				logger.Error("panic recovered", "panic", v, "stack", string(debug.Stack()), "requestId", problem.RequestID(r.Context()))
				problem.Write(w, r, http.StatusInternalServerError, problem.CodeInternalError, problem.DetailInternalError)
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeaders sets the fixed hardening headers on every response and no-store on API and health responses.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		if IsAPIPath(r.URL.Path) || r.URL.Path == "/healthz" {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

// BodyLimit caps API request bodies. It wraps the body instead of answering itself, so the handler
// can check the media type first (415) and report an oversize body (413) when it reads.
func BodyLimit(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if IsAPIPath(r.URL.Path) {
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}
