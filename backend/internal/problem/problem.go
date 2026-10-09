// Package problem writes RFC 7807 Problem Details, the one error shape the API uses.
package problem

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Error codes. docs/ERROR-CONTRACT.md lists them with their statuses.
const (
	CodeInvalidJSON          = "INVALID_JSON"
	CodeInvalidRequest       = "INVALID_REQUEST"
	CodeInvalidOperandCount  = "INVALID_OPERAND_COUNT"
	CodeUnknownOperation     = "UNKNOWN_OPERATION"
	CodeNotFound             = "NOT_FOUND"
	CodeMethodNotAllowed     = "METHOD_NOT_ALLOWED"
	CodePayloadTooLarge      = "PAYLOAD_TOO_LARGE"
	CodeUnsupportedMediaType = "UNSUPPORTED_MEDIA_TYPE"
	CodeCORSOriginNotAllowed = "CORS_ORIGIN_NOT_ALLOWED"
	CodeRateLimited          = "RATE_LIMITED"
	CodeInternalError        = "INTERNAL_ERROR"
)

// Fixed detail sentences from the error contract.
const (
	DetailInvalidJSON          = "The request body isn't valid JSON."
	DetailInvalidRequest       = "The request body is invalid."
	DetailInvalidOperandCount  = "The request has the wrong number of operands."
	DetailPayloadTooLarge      = "The request body must be 4096 bytes or smaller."
	DetailUnsupportedMediaType = "Content-Type must be application/json."
	DetailCORSOriginNotAllowed = "Origin isn't allowed."
	DetailInternalError        = "Something went wrong on our side. Quote the request id if you report it."
)

// FieldError names one invalid field.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Problem is the response body for every error.
type Problem struct {
	Type       string       `json:"type"`
	Title      string       `json:"title"`
	Status     int          `json:"status"`
	Detail     string       `json:"detail"`
	Instance   string       `json:"instance"`
	Code       string       `json:"code"`
	RequestID  string       `json:"requestId"`
	Errors     []FieldError `json:"errors,omitempty"`
	RetryAfter int          `json:"retryAfter,omitempty"`
}

// Option adjusts a Problem before it's written.
type Option func(*Problem)

// WithErrors attaches field-level errors.
func WithErrors(errs ...FieldError) Option {
	return func(p *Problem) { p.Errors = errs }
}

// WithRetryAfter sets the whole seconds a rate-limited client should wait.
func WithRetryAfter(seconds int) Option {
	return func(p *Problem) { p.RetryAfter = seconds }
}

// titles is fixed so a Go upgrade can't change the wording of http.StatusText.
var titles = map[int]string{
	http.StatusBadRequest:            "Bad Request",
	http.StatusForbidden:             "Forbidden",
	http.StatusNotFound:              "Not Found",
	http.StatusMethodNotAllowed:      "Method Not Allowed",
	http.StatusRequestEntityTooLarge: "Content Too Large",
	http.StatusUnsupportedMediaType:  "Unsupported Media Type",
	http.StatusUnprocessableEntity:   "Unprocessable Entity",
	http.StatusTooManyRequests:       "Too Many Requests",
	http.StatusInternalServerError:   "Internal Server Error",
}

// Title returns the fixed title for a status. A status outside the table falls back to the standard text.
func Title(status int) string {
	if t, ok := titles[status]; ok {
		return t
	}
	return http.StatusText(status)
}

type requestIDKey struct{}

// WithRequestID stores the request id in a context.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestID returns the request id stored by the RequestID middleware, or an empty string.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// Write sends a Problem. Instance comes from the request path and requestId from the request context.
func Write(w http.ResponseWriter, r *http.Request, status int, code, detail string, opts ...Option) {
	p := Problem{
		Type:      "about:blank",
		Title:     Title(status),
		Status:    status,
		Detail:    detail,
		Instance:  r.URL.Path,
		Code:      code,
		RequestID: RequestID(r.Context()),
	}
	for _, opt := range opts {
		opt(&p)
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(p)
}

// NotFoundDetail words the 404 for an unknown route.
func NotFoundDetail(method, path string) string {
	return fmt.Sprintf("No route matches %s %s.", method, path)
}

// MethodNotAllowedDetail words the 405 and lists the allowed methods.
func MethodNotAllowedDetail(method, path string, allowed []string) string {
	return fmt.Sprintf("%s isn't allowed on %s. Allowed: %s.", method, path, strings.Join(allowed, ", "))
}

// RateLimitedDetail words the 429 for a wait of whole seconds.
func RateLimitedDetail(seconds int) string {
	if seconds == 1 {
		return "Too many requests. Try again in 1 second."
	}
	return fmt.Sprintf("Too many requests. Try again in %d seconds.", seconds)
}

// UnknownOperationDetail words the unknown-operation error.
func UnknownOperationDetail(name string) string {
	return fmt.Sprintf("Unknown operation %q.", name)
}
