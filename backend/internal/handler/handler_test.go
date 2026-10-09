package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"calculator/api"
	"calculator/internal/domain"
	"calculator/internal/problem"
	"calculator/internal/service"
)

func newMux(calc Calculator, logger *slog.Logger) *http.ServeMux {
	h := New(calc, logger, api.Spec)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/calculations", h.Calculations)
	mux.HandleFunc("/api/v1/operations", h.Operations)
	mux.HandleFunc("/api/v1/operations/{name}", h.RunOperation)
	mux.HandleFunc("/api/v1/openapi.yaml", h.OpenAPI)
	mux.HandleFunc("/healthz", h.Health)
	mux.HandleFunc("/", NotFound)
	return mux
}

func discard() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func send(t *testing.T, mux http.Handler, method, target, body, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, target, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req = req.WithContext(problem.WithRequestID(req.Context(), "req-1"))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func decodeProblem(t *testing.T, rec *httptest.ResponseRecorder) problem.Problem {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q, body %s", ct, rec.Body.String())
	}
	var p problem.Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("body is not a Problem: %v", err)
	}
	if p.RequestID != "req-1" || p.Type != "about:blank" || p.Status != rec.Code {
		t.Fatalf("Problem envelope = %+v", p)
	}
	return p
}

func TestCalculationsSuccess(t *testing.T) {
	mux := newMux(service.New(), discard())
	tests := []struct{ body, want string }{
		{`{"operation":"add","operands":[2,3]}`, `{"operation":"add","operands":[2,3],"result":5}`},
		{`{"operation":"add","operands":[0.1,0.2]}`, `{"operation":"add","operands":[0.1,0.2],"result":0.3}`},
		{`{"operation":"multiply","operands":[0,-5]}`, `{"operation":"multiply","operands":[0,-5],"result":0}`},
		{`{"operation":"sqrt","operands":[9]}`, `{"operation":"sqrt","operands":[9],"result":3}`},
		{` {"operands":[10,4],"operation":"divide"} `, `{"operation":"divide","operands":[10,4],"result":2.5}`},
	}
	for _, tt := range tests {
		rec := send(t, mux, http.MethodPost, "/api/v1/calculations", tt.body, "application/json")
		if rec.Code != 200 || rec.Body.String() != tt.want {
			t.Errorf("%s -> %d %s, want 200 %s", tt.body, rec.Code, rec.Body.String(), tt.want)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q", ct)
		}
	}
}

func TestCalculationsRejectsBadBodies(t *testing.T) {
	tests := []struct {
		name, body, code, field string
		status                  int
	}{
		{"empty", ``, "INVALID_JSON", "", 400},
		{"open brace", `{`, "INVALID_JSON", "", 400},
		{"trailing value", `{"operation":"add","operands":[1,2]} {}`, "INVALID_JSON", "", 400},
		{"trailing garbage", `{"operation":"add","operands":[1,2]} x`, "INVALID_JSON", "", 400},
		{"array", `[1,2]`, "INVALID_REQUEST", "", 400},
		{"null", `null`, "INVALID_REQUEST", "", 400},
		{"string", `"add"`, "INVALID_REQUEST", "", 400},
		{"missing operation", `{"operands":[1,2]}`, "INVALID_REQUEST", "operation", 400},
		{"missing operands", `{"operation":"add"}`, "INVALID_REQUEST", "operands", 400},
		{"operation number", `{"operation":5,"operands":[1,2]}`, "INVALID_REQUEST", "operation", 400},
		{"operation null", `{"operation":null,"operands":[1,2]}`, "INVALID_REQUEST", "operation", 400},
		{"operands string", `{"operation":"add","operands":"12"}`, "INVALID_REQUEST", "operands", 400},
		{"operands null", `{"operation":"add","operands":null}`, "INVALID_REQUEST", "operands", 400},
		{"operands object", `{"operation":"add","operands":{}}`, "INVALID_REQUEST", "operands", 400},
		{"string operand", `{"operation":"add","operands":[1,"2"]}`, "INVALID_REQUEST", "operands", 400},
		{"null operand", `{"operation":"add","operands":[1,null]}`, "INVALID_REQUEST", "operands", 400},
		{"boolean operand", `{"operation":"add","operands":[1,true]}`, "INVALID_REQUEST", "operands", 400},
		{"nested operand", `{"operation":"add","operands":[1,[2]]}`, "INVALID_REQUEST", "operands", 400},
		{"overflowing operand", `{"operation":"add","operands":[1e999,1]}`, "INVALID_REQUEST", "operands", 400},
		{"unknown key", `{"operation":"add","operands":[1,2],"extra":true}`, "INVALID_REQUEST", "extra", 400},
		{"one operand for add", `{"operation":"add","operands":[1]}`, "INVALID_OPERAND_COUNT", "operands", 400},
		{"no operands for add", `{"operation":"add","operands":[]}`, "INVALID_OPERAND_COUNT", "operands", 400},
		{"two operands for sqrt", `{"operation":"sqrt","operands":[1,2]}`, "INVALID_OPERAND_COUNT", "operands", 400},
		{"three operands for add", `{"operation":"add","operands":[1,2,3]}`, "INVALID_OPERAND_COUNT", "operands", 400},
		{"unknown name", `{"operation":"modulo","operands":[7,3]}`, "UNKNOWN_OPERATION", "operation", 422},
		{"upper case name", `{"operation":"ADD","operands":[1,2]}`, "UNKNOWN_OPERATION", "operation", 422},
		{"empty name", `{"operation":"","operands":[1,2]}`, "UNKNOWN_OPERATION", "operation", 422},
		{"unknown name skips the count check", `{"operation":"modulo","operands":[1]}`, "UNKNOWN_OPERATION", "operation", 422},
	}
	mux := newMux(service.New(), discard())
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := send(t, mux, http.MethodPost, "/api/v1/calculations", tt.body, "application/json")
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tt.status, rec.Body.String())
			}
			p := decodeProblem(t, rec)
			if p.Code != tt.code || p.Instance != "/api/v1/calculations" || p.Detail == "" {
				t.Fatalf("problem = %+v", p)
			}
			if tt.field == "" {
				if len(p.Errors) != 0 {
					t.Fatalf("errors = %+v, want none", p.Errors)
				}
				return
			}
			if len(p.Errors) == 0 || p.Errors[0].Field != tt.field {
				t.Fatalf("errors = %+v, want first field %s", p.Errors, tt.field)
			}
		})
	}
}

func TestProblemTexts(t *testing.T) {
	mux := newMux(service.New(), discard())
	tests := []struct {
		name, body, detail, message string
	}{
		{"wrong count", `{"operation":"add","operands":[1]}`, "The request has the wrong number of operands.", "add needs 2 operands, got 1."},
		{"singular operand", `{"operation":"sqrt","operands":[1,2]}`, "The request has the wrong number of operands.", "sqrt needs 1 operand, got 2."},
		{"missing operation", `{"operands":[1,2]}`, "The request body is invalid.", "is required."},
		{"non numeric", `{"operation":"add","operands":[1,"2"]}`, "The request body is invalid.", "must be an array of numbers."},
		{"unknown operation", `{"operation":"modulo","operands":[7,3]}`, `Unknown operation "modulo".`,
			"must be one of: add, subtract, multiply, divide, power, sqrt, percentage, reciprocal, square."},
		{"invalid json", `{`, "The request body isn't valid JSON.", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := decodeProblem(t, send(t, mux, http.MethodPost, "/api/v1/calculations", tt.body, "application/json"))
			if p.Detail != tt.detail {
				t.Errorf("detail = %q, want %q", p.Detail, tt.detail)
			}
			if tt.message != "" && p.Errors[0].Message != tt.message {
				t.Errorf("message = %q, want %q", p.Errors[0].Message, tt.message)
			}
		})
	}
}

func TestBusinessRuleErrors(t *testing.T) {
	tests := []struct {
		body, code, detail string
	}{
		{`{"operation":"divide","operands":[5,0]}`, "DIVISION_BY_ZERO", "Division by zero is undefined."},
		{`{"operation":"divide","operands":[5,-0]}`, "DIVISION_BY_ZERO", "Division by zero is undefined."},
		{`{"operation":"sqrt","operands":[-4]}`, "NEGATIVE_SQUARE_ROOT", "The square root of a negative number isn't a real number."},
		{`{"operation":"power","operands":[-8,0.5]}`, "UNDEFINED_RESULT", "The result isn't a real number."},
		{`{"operation":"multiply","operands":[1e308,10]}`, "RESULT_OUT_OF_RANGE", "The result is too large to represent."},
	}
	mux := newMux(service.New(), discard())
	for _, tt := range tests {
		rec := send(t, mux, http.MethodPost, "/api/v1/calculations", tt.body, "application/json")
		p := decodeProblem(t, rec)
		if rec.Code != 422 || p.Code != tt.code || p.Detail != tt.detail || len(p.Errors) != 0 {
			t.Errorf("%s -> %d %+v", tt.body, rec.Code, p)
		}
	}
}

func TestContentTypeChecks(t *testing.T) {
	mux := newMux(service.New(), discard())
	body := `{"operation":"add","operands":[1,2]}`
	for _, ct := range []string{"", "text/plain", "application/xml", "application/jsonx", "garbage;;"} {
		rec := send(t, mux, http.MethodPost, "/api/v1/calculations", body, ct)
		if rec.Code != 415 || decodeProblem(t, rec).Code != "UNSUPPORTED_MEDIA_TYPE" {
			t.Errorf("Content-Type %q -> %d %s", ct, rec.Code, rec.Body.String())
		}
	}
	for _, ct := range []string{"application/json; charset=utf-8", "Application/JSON"} {
		if rec := send(t, mux, http.MethodPost, "/api/v1/calculations", body, ct); rec.Code != 200 {
			t.Errorf("Content-Type %q -> %d", ct, rec.Code)
		}
	}
}

func TestOversizeBody(t *testing.T) {
	mux := newMux(service.New(), discard())
	big := `{"operation":"add","operands":[1,2],"pad":"` + strings.Repeat("x", 5000) + `"}`
	for _, target := range []string{"/api/v1/calculations", "/api/v1/operations/add"} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, target, strings.NewReader(big))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		req.Body = http.MaxBytesReader(rec, req.Body, 4096)
		mux.ServeHTTP(rec, req)
		if rec.Code != 413 || decodeBare(t, rec).Code != "PAYLOAD_TOO_LARGE" {
			t.Errorf("%s -> %d %s", target, rec.Code, rec.Body.String())
		}
	}
}

func decodeBare(t *testing.T, rec *httptest.ResponseRecorder) problem.Problem {
	t.Helper()
	var p problem.Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

type brokenBody struct{}

func (brokenBody) Read([]byte) (int, error) { return 0, errors.New("connection reset") }

func TestBodyReadFailure(t *testing.T) {
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/calculations", brokenBody{})
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	newMux(service.New(), discard()).ServeHTTP(rec, req)
	if rec.Code != 400 || decodeBare(t, rec).Code != "INVALID_JSON" {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

func TestOperationRoutes(t *testing.T) {
	mux := newMux(service.New(), discard())

	rec := send(t, mux, http.MethodPost, "/api/v1/operations/add", `{"operands":[2,3]}`, "application/json")
	if rec.Code != 200 || rec.Body.String() != `{"operation":"add","operands":[2,3],"result":5}` {
		t.Fatalf("add -> %d %s", rec.Code, rec.Body.String())
	}

	rec = send(t, mux, http.MethodPost, "/api/v1/operations/divide", `{"operands":[5,0]}`, "application/json")
	if p := decodeProblem(t, rec); rec.Code != 422 || p.Code != "DIVISION_BY_ZERO" || p.Instance != "/api/v1/operations/divide" {
		t.Fatalf("divide -> %d %+v", rec.Code, p)
	}

	rec = send(t, mux, http.MethodPost, "/api/v1/operations/modulo", `{"operands":[7,3]}`, "application/json")
	p := decodeProblem(t, rec)
	if rec.Code != 404 || p.Code != "UNKNOWN_OPERATION" || p.Instance != "/api/v1/operations/modulo" ||
		p.Detail != `Unknown operation "modulo".` || len(p.Errors) != 0 {
		t.Fatalf("modulo -> %d %+v", rec.Code, p)
	}

	rec = send(t, mux, http.MethodPost, "/api/v1/operations/add", `{"operation":"add","operands":[2,3]}`, "application/json")
	if p := decodeProblem(t, rec); rec.Code != 400 || p.Code != "INVALID_REQUEST" || p.Errors[0].Field != "operation" {
		t.Fatalf("operation key -> %d %+v", rec.Code, p)
	}

	rec = send(t, mux, http.MethodPost, "/api/v1/operations/add", `{"operands":[2]}`, "application/json")
	if p := decodeProblem(t, rec); rec.Code != 400 || p.Code != "INVALID_OPERAND_COUNT" {
		t.Fatalf("count -> %d %+v", rec.Code, p)
	}

	for _, tt := range []struct{ body, code string }{
		{``, "INVALID_JSON"}, {`[1]`, "INVALID_REQUEST"}, {`{}`, "INVALID_REQUEST"}, {`{"operands":[1,2],"x":1}`, "INVALID_REQUEST"},
	} {
		rec = send(t, mux, http.MethodPost, "/api/v1/operations/add", tt.body, "application/json")
		if rec.Code != 400 || decodeProblem(t, rec).Code != tt.code {
			t.Errorf("body %q -> %d %s", tt.body, rec.Code, rec.Body.String())
		}
	}

	rec = send(t, mux, http.MethodPost, "/api/v1/operations/add", `{"operands":[1,2]}`, "text/plain")
	if rec.Code != 415 {
		t.Fatalf("text/plain -> %d", rec.Code)
	}
}

func TestSameAnswerOnBothRoutes(t *testing.T) {
	mux := newMux(service.New(), discard())
	cases := map[string][]string{
		"add": {"[2,3]", "[1]"}, "subtract": {"[10,4]"}, "multiply": {"[6,7]", "[1e308,10]"}, "divide": {"[10,4]", "[5,0]"},
		"power": {"[2,10]", "[-8,0.5]"}, "sqrt": {"[9]", "[-4]", "[4,9]"}, "percentage": {"[15,200]"},
		"reciprocal": {"[4]", "[0]"}, "square": {"[-3]", "[1e200]"},
	}
	for name, operandSets := range cases {
		for _, operands := range operandSets {
			a := send(t, mux, http.MethodPost, "/api/v1/calculations", `{"operation":"`+name+`","operands":`+operands+`}`, "application/json")
			b := send(t, mux, http.MethodPost, "/api/v1/operations/"+name, `{"operands":`+operands+`}`, "application/json")
			if a.Code != b.Code {
				t.Errorf("%s %s: status %d vs %d", name, operands, a.Code, b.Code)
			}
			if a.Code == 200 && a.Body.String() != b.Body.String() {
				t.Errorf("%s %s: %s vs %s", name, operands, a.Body.String(), b.Body.String())
			}
			if a.Code != 200 {
				pa, pb := decodeBare(t, a), decodeBare(t, b)
				if pa.Code != pb.Code || pa.Detail != pb.Detail {
					t.Errorf("%s %s: %+v vs %+v", name, operands, pa, pb)
				}
			}
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	mux := newMux(service.New(), discard())
	tests := []struct{ method, target, allow, detail string }{
		{"PUT", "/api/v1/calculations", "POST", "PUT isn't allowed on /api/v1/calculations. Allowed: POST."},
		{"GET", "/api/v1/calculations", "POST", ""},
		{"DELETE", "/api/v1/operations", "GET", ""},
		{"POST", "/api/v1/operations", "GET", ""},
		{"GET", "/api/v1/operations/add", "POST", ""},
		{"POST", "/api/v1/openapi.yaml", "GET", ""},
		{"POST", "/healthz", "GET", ""},
	}
	for _, tt := range tests {
		rec := send(t, mux, tt.method, tt.target, "", "")
		p := decodeProblem(t, rec)
		if rec.Code != 405 || p.Code != "METHOD_NOT_ALLOWED" || rec.Header().Get("Allow") != tt.allow {
			t.Errorf("%s %s -> %d %+v Allow=%q", tt.method, tt.target, rec.Code, p, rec.Header().Get("Allow"))
		}
		if tt.detail != "" && p.Detail != tt.detail {
			t.Errorf("detail = %q", p.Detail)
		}
	}
}

func TestMethodNotAllowedListsEveryMethod(t *testing.T) {
	rec := httptest.NewRecorder()
	MethodNotAllowed(rec, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", nil), http.MethodGet, http.MethodHead)
	if rec.Header().Get("Allow") != "GET, HEAD" || !strings.Contains(rec.Body.String(), "Allowed: GET, HEAD.") {
		t.Fatalf("Allow=%q body=%s", rec.Header().Get("Allow"), rec.Body.String())
	}
}

func TestNotFound(t *testing.T) {
	rec := send(t, newMux(service.New(), discard()), http.MethodGet, "/api/v1/nothing", "", "")
	p := decodeProblem(t, rec)
	if rec.Code != 404 || p.Code != "NOT_FOUND" || p.Detail != "No route matches GET /api/v1/nothing." {
		t.Fatalf("got %d %+v", rec.Code, p)
	}
}

func TestCatalogue(t *testing.T) {
	rec := send(t, newMux(service.New(), discard()), http.MethodGet, "/api/v1/operations", "", "")
	var got OperationListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 200 || got.Total != 9 || len(got.Items) != 9 {
		t.Fatalf("got %d total=%d", rec.Code, got.Total)
	}
	first, last := got.Items[0], got.Items[8]
	if first != (OperationResponse{Name: "add", Symbol: "+", Arity: 2, Description: "Adds two numbers."}) ||
		last != (OperationResponse{Name: "square", Symbol: "x^2", Arity: 1, Description: "Multiplies the number by itself."}) {
		t.Fatalf("first=%+v last=%+v", first, last)
	}
	for _, key := range []string{`"name"`, `"symbol"`, `"arity"`, `"description"`, `"items"`, `"total"`} {
		if !strings.Contains(rec.Body.String(), key) {
			t.Errorf("body lacks %s", key)
		}
	}
}

func TestOpenAPIAndHealth(t *testing.T) {
	mux := newMux(service.New(), discard())
	rec := send(t, mux, http.MethodGet, "/api/v1/openapi.yaml", "", "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/yaml" || !bytes.Equal(rec.Body.Bytes(), api.Spec) {
		t.Fatalf("openapi -> %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	rec = send(t, mux, http.MethodGet, "/healthz", "", "")
	if rec.Code != 200 || rec.Body.String() != `{"status":"ok","version":"1.0.0"}` {
		t.Fatalf("healthz -> %d %s", rec.Code, rec.Body.String())
	}
}

type failingCalculator struct{ err error }

func (f failingCalculator) Calculate(string, []float64) (service.Result, error) {
	return service.Result{}, f.err
}
func (failingCalculator) Operations() []domain.Operation { return domain.All() }

func TestUnexpectedErrorIsAnOpaque500(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	mux := newMux(failingCalculator{err: errors.New("database password is hunter2")}, logger)

	rec := send(t, mux, http.MethodPost, "/api/v1/calculations", `{"operation":"add","operands":[1,2]}`, "application/json")
	p := decodeProblem(t, rec)
	if rec.Code != 500 || p.Code != "INTERNAL_ERROR" || p.Detail != problem.DetailInternalError {
		t.Fatalf("got %d %+v", rec.Code, p)
	}
	if strings.Contains(rec.Body.String(), "hunter2") {
		t.Fatal("the response leaks the internal error")
	}
	if !strings.Contains(logs.String(), "hunter2") || !strings.Contains(logs.String(), "req-1") {
		t.Fatalf("the log lacks the error or the request id: %s", logs.String())
	}
}

func TestWriteJSONFailureIsAn500(t *testing.T) {
	h := New(service.New(), discard(), nil)
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil)
	h.writeJSON(rec, req, make(chan int))
	if rec.Code != 500 || decodeBare(t, rec).Code != "INTERNAL_ERROR" {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}
