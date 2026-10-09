package problem

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTitleTable(t *testing.T) {
	tests := map[int]string{
		400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
		413: "Content Too Large", 415: "Unsupported Media Type", 422: "Unprocessable Entity",
		429: "Too Many Requests", 500: "Internal Server Error",
		409: "Conflict", // outside the table: standard text
	}
	for status, want := range tests {
		if got := Title(status); got != want {
			t.Errorf("Title(%d) = %q, want %q", status, got, want)
		}
	}
}

func TestWrite(t *testing.T) {
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/calculations", nil)
	req = req.WithContext(WithRequestID(req.Context(), "abc123"))
	rec := httptest.NewRecorder()

	Write(rec, req, http.StatusTooManyRequests, CodeRateLimited, RateLimitedDetail(3),
		WithErrors(FieldError{Field: "operands", Message: "bad."}), WithRetryAfter(3))

	if rec.Code != 429 {
		t.Fatalf("status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	var got Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := Problem{
		Type: "about:blank", Title: "Too Many Requests", Status: 429, Detail: "Too many requests. Try again in 3 seconds.",
		Instance: "/api/v1/calculations", Code: "RATE_LIMITED", RequestID: "abc123",
		Errors: []FieldError{{Field: "operands", Message: "bad."}}, RetryAfter: 3,
	}
	if got.Type != want.Type || got.Title != want.Title || got.Status != want.Status || got.Detail != want.Detail ||
		got.Instance != want.Instance || got.Code != want.Code || got.RequestID != want.RequestID ||
		got.RetryAfter != want.RetryAfter || len(got.Errors) != 1 || got.Errors[0] != want.Errors[0] {
		t.Fatalf("body = %+v, want %+v", got, want)
	}
}

func TestWriteOmitsOptionalFields(t *testing.T) {
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/nothing", nil)
	rec := httptest.NewRecorder()
	Write(rec, req, http.StatusNotFound, CodeNotFound, "x")
	body := rec.Body.String()
	for _, key := range []string{`"errors"`, `"retryAfter"`} {
		if strings.Contains(body, key) {
			t.Errorf("body %s contains %s", body, key)
		}
	}
	if !strings.Contains(body, `"requestId":""`) {
		t.Errorf("body %s lacks an empty requestId", body)
	}
}

func TestRequestIDWithoutValue(t *testing.T) {
	if id := RequestID(context.Background()); id != "" {
		t.Fatalf("RequestID = %q", id)
	}
}

func TestDetails(t *testing.T) {
	tests := []struct{ got, want string }{
		{NotFoundDetail("GET", "/api/v1/nothing"), "No route matches GET /api/v1/nothing."},
		{MethodNotAllowedDetail("PUT", "/api/v1/calculations", []string{"POST"}), "PUT isn't allowed on /api/v1/calculations. Allowed: POST."},
		{MethodNotAllowedDetail("POST", "/", []string{"GET", "HEAD"}), "POST isn't allowed on /. Allowed: GET, HEAD."},
		{RateLimitedDetail(1), "Too many requests. Try again in 1 second."},
		{RateLimitedDetail(12), "Too many requests. Try again in 12 seconds."},
		{UnknownOperationDetail("modulo"), `Unknown operation "modulo".`},
	}
	for _, tt := range tests {
		if tt.got != tt.want {
			t.Errorf("got %q, want %q", tt.got, tt.want)
		}
	}
}
