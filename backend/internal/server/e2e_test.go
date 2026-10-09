package server

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"calculator/api"
	"calculator/internal/config"
)

// These tests drive the whole chain through httptest. Each section names the release item it covers.

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

func testConfig() config.Config {
	return config.Config{Port: 8080, RateLimitPerMinute: 0, RateLimitBurst: 30, LogFormat: "json", ShutdownTimeout: time.Second}
}

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func newTestHandler(t *testing.T, cfg config.Config, clk *clock) http.Handler {
	t.Helper()
	now := time.Now
	if clk != nil {
		now = clk.Now
	}
	return build(t.Context(), cfg, quietLogger(), now)
}

type request struct {
	method, path, body, contentType string
	headers                         map[string]string
}

func call(t *testing.T, h http.Handler, r request) *httptest.ResponseRecorder {
	t.Helper()
	if r.method == "" {
		r.method = http.MethodPost
	}
	req := httptest.NewRequestWithContext(t.Context(), r.method, r.path, strings.NewReader(r.body))
	req.RemoteAddr = "192.0.2.1:4000"
	if r.contentType != "" {
		req.Header.Set("Content-Type", r.contentType)
	}
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func postJSON(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	return call(t, h, request{path: path, body: body, contentType: "application/json"})
}

type problemBody struct {
	Type       string `json:"type"`
	Title      string `json:"title"`
	Status     int    `json:"status"`
	Detail     string `json:"detail"`
	Instance   string `json:"instance"`
	Code       string `json:"code"`
	RequestID  string `json:"requestId"`
	RetryAfter int    `json:"retryAfter"`
	Errors     []struct {
		Field   string `json:"field"`
		Message string `json:"message"`
	} `json:"errors"`
}

func asProblem(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) problemBody {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d (%s)", rec.Code, status, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	var p problemBody
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if p.Code != code || p.Status != status || p.Type != "about:blank" || p.Title == "" || p.Detail == "" || p.Instance == "" {
		t.Fatalf("problem = %+v, want code %s", p, code)
	}
	if p.RequestID == "" || p.RequestID != rec.Header().Get("X-Request-Id") {
		t.Fatalf("requestId %q does not match the header %q", p.RequestID, rec.Header().Get("X-Request-Id"))
	}
	return p
}

func resultOf(t *testing.T, rec *httptest.ResponseRecorder) float64 {
	t.Helper()
	if rec.Code != 200 {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Result float64 `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Result
}

// Items 1.1 to 1.11: arithmetic.
func TestArithmeticGoldenCases(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	const noCode = ""
	tests := []struct {
		item, op, operands string
		result             float64
		code               string
	}{
		{"1.1", "add", "[2, 3]", 5, noCode},
		{"1.1", "add", "[0.1, 0.2]", 0.3, noCode},
		{"1.1", "add", "[-5, 3]", -2, noCode},
		{"1.1", "add", "[0, 0]", 0, noCode},
		{"1.1", "add", "[123456789012345, 1]", 123456789012346, noCode},
		{"1.2", "subtract", "[10, 4]", 6, noCode},
		{"1.2", "subtract", "[4, 10]", -6, noCode},
		{"1.2", "subtract", "[0.3, 0.1]", 0.2, noCode},
		{"1.2", "subtract", "[5, 5]", 0, noCode},
		{"1.3", "multiply", "[6, 7]", 42, noCode},
		{"1.3", "multiply", "[-2.5, 4]", -10, noCode},
		{"1.3", "multiply", "[0.1, 3]", 0.3, noCode},
		{"1.3", "multiply", "[0, -5]", 0, noCode},
		{"1.4", "divide", "[10, 4]", 2.5, noCode},
		{"1.4", "divide", "[1, 3]", 0.333333333333333, noCode},
		{"1.4", "divide", "[-9, 3]", -3, noCode},
		{"1.4", "divide", "[0, 5]", 0, noCode},
		{"1.5", "divide", "[5, 0]", 0, "DIVISION_BY_ZERO"},
		{"1.5", "divide", "[0, 0]", 0, "DIVISION_BY_ZERO"},
		{"1.5", "divide", "[5, -0]", 0, "DIVISION_BY_ZERO"},
		{"1.6", "power", "[2, 10]", 1024, noCode},
		{"1.6", "power", "[2, -1]", 0.5, noCode},
		{"1.6", "power", "[9, 0.5]", 3, noCode},
		{"1.6", "power", "[0, 0]", 1, noCode},
		{"1.6", "power", "[-2, 3]", -8, noCode},
		{"1.6", "power", "[-8, 0.5]", 0, "UNDEFINED_RESULT"},
		{"1.6", "power", "[0, -1]", 0, "DIVISION_BY_ZERO"},
		{"1.6", "power", "[10, 400]", 0, "RESULT_OUT_OF_RANGE"},
		{"1.7", "sqrt", "[9]", 3, noCode},
		{"1.7", "sqrt", "[2]", 1.4142135623731, noCode},
		{"1.7", "sqrt", "[0]", 0, noCode},
		{"1.7", "sqrt", "[0.25]", 0.5, noCode},
		{"1.7", "sqrt", "[-4]", 0, "NEGATIVE_SQUARE_ROOT"},
		{"1.7", "sqrt", "[4, 9]", 0, "INVALID_OPERAND_COUNT"},
		{"1.8", "percentage", "[15, 200]", 30, noCode},
		{"1.8", "percentage", "[0, 50]", 0, noCode},
		{"1.8", "percentage", "[50, -10]", -5, noCode},
		{"1.8", "percentage", "[12.5, 80]", 10, noCode},
		{"1.8", "percentage", "[1e308, 50]", 5e307, noCode},
		{"1.9", "reciprocal", "[4]", 0.25, noCode},
		{"1.9", "reciprocal", "[-0.5]", -2, noCode},
		{"1.9", "reciprocal", "[0]", 0, "DIVISION_BY_ZERO"},
		{"1.9", "reciprocal", "[5e-324]", 0, "RESULT_OUT_OF_RANGE"},
		{"1.10", "square", "[-3]", 9, noCode},
		{"1.10", "square", "[1.5]", 2.25, noCode},
		{"1.10", "square", "[0]", 0, noCode},
		{"1.10", "square", "[1e200]", 0, "RESULT_OUT_OF_RANGE"},
		{"1.11", "multiply", "[1.1, 1.1]", 1.21, noCode},
		{"1.11", "multiply", "[4.35, 100]", 435, noCode},
		{"1.11", "add", "[999999999999999, 1]", 1000000000000000, noCode},
		{"1.11", "add", "[1234567890123456, 1]", 1234567890123460, noCode},
		{"1.11", "add", "[1.7976931348623157e308, 0]", math.MaxFloat64, noCode},
		{"1.11", "add", "[5e-324, 0]", 5e-324, noCode},
		{"1.11", "multiply", "[1e308, 10]", 0, "RESULT_OUT_OF_RANGE"},
		{"1.11", "add", "[1.7976931348623157e308, 1.7976931348623157e308]", 0, "RESULT_OUT_OF_RANGE"},
	}
	for _, tt := range tests {
		t.Run(tt.item+" "+tt.op+tt.operands, func(t *testing.T) {
			rec := postJSON(t, h, "/api/v1/calculations", `{"operation":"`+tt.op+`","operands":`+tt.operands+`}`)
			if tt.code == "" {
				if got := resultOf(t, rec); got != tt.result {
					t.Fatalf("result = %v, want %v (%s)", got, tt.result, rec.Body.String())
				}
				return
			}
			status := 422
			if tt.code == "INVALID_OPERAND_COUNT" {
				status = 400
			}
			p := asProblem(t, rec, status, tt.code)
			if p.Instance != "/api/v1/calculations" {
				t.Fatalf("instance = %q", p.Instance)
			}
		})
	}
}

// Item 1.3: a negative zero never reaches the wire.
func TestNegativeZeroIsWrittenAsZero(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	body := postJSON(t, h, "/api/v1/calculations", `{"operation":"multiply","operands":[0,-5]}`).Body.String()
	if !strings.Contains(body, `"result":0}`) || strings.Contains(body, "-0") {
		t.Fatalf("body = %s", body)
	}
}

// Item 2.1.
func TestCalculationEndpointShape(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	rec := postJSON(t, h, "/api/v1/calculations", `{"operation":"add","operands":[2,3]}`)
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") ||
		rec.Body.String() != `{"operation":"add","operands":[2,3],"result":5}` {
		t.Fatalf("got %d %q %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
	firstRows := map[string]struct {
		operands string
		result   float64
	}{
		"add": {"[2,3]", 5}, "subtract": {"[10,4]", 6}, "multiply": {"[6,7]", 42}, "divide": {"[10,4]", 2.5},
		"power": {"[2,10]", 1024}, "sqrt": {"[9]", 3}, "percentage": {"[15,200]", 30}, "reciprocal": {"[4]", 0.25}, "square": {"[-3]", 9},
	}
	for name, row := range firstRows {
		got := resultOf(t, postJSON(t, h, "/api/v1/calculations", `{"operation":"`+name+`","operands":`+row.operands+`}`))
		if got != row.result {
			t.Errorf("%s -> %v, want %v", name, got, row.result)
		}
	}
}

// Item 2.2.
func TestOperationCatalogue(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	const want = `{"items":[` +
		`{"name":"add","symbol":"+","arity":2,"description":"Adds two numbers."},` +
		`{"name":"subtract","symbol":"-","arity":2,"description":"Subtracts the second number from the first."},` +
		`{"name":"multiply","symbol":"*","arity":2,"description":"Multiplies two numbers."},` +
		`{"name":"divide","symbol":"/","arity":2,"description":"Divides the first number by the second."},` +
		`{"name":"power","symbol":"^","arity":2,"description":"Raises the first number to the power of the second."},` +
		`{"name":"sqrt","symbol":"sqrt","arity":1,"description":"Returns the square root of a non-negative number."},` +
		`{"name":"percentage","symbol":"%","arity":2,"description":"Returns the first number percent of the second."},` +
		`{"name":"reciprocal","symbol":"1/x","arity":1,"description":"Returns 1 divided by the number."},` +
		`{"name":"square","symbol":"x^2","arity":1,"description":"Multiplies the number by itself."}],"total":9}`
	rec := call(t, h, request{method: "GET", path: "/api/v1/operations"})
	if rec.Code != 200 || rec.Body.String() != want {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	// The catalogue example in the OpenAPI file must carry every description and symbol.
	spec := string(api.Spec)
	var parsed struct {
		Items []struct{ Name, Symbol, Description string } `json:"items"`
	}
	if err := json.Unmarshal([]byte(want), &parsed); err != nil {
		t.Fatal(err)
	}
	for _, item := range parsed.Items {
		if !strings.Contains(spec, "description: "+item.Description) || !strings.Contains(spec, "name: "+item.Name+",") {
			t.Errorf("openapi.yaml catalogue lacks %s", item.Name)
		}
	}
}

// Item 2.3.
func TestOperationRoutes(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	rec := postJSON(t, h, "/api/v1/operations/add", `{"operands":[2,3]}`)
	if rec.Code != 200 || rec.Body.String() != `{"operation":"add","operands":[2,3],"result":5}` {
		t.Fatalf("add -> %d %s", rec.Code, rec.Body.String())
	}
	asProblem(t, postJSON(t, h, "/api/v1/operations/divide", `{"operands":[5,0]}`), 422, "DIVISION_BY_ZERO")
	p := asProblem(t, postJSON(t, h, "/api/v1/operations/modulo", `{"operands":[7,3]}`), 404, "UNKNOWN_OPERATION")
	if p.Instance != "/api/v1/operations/modulo" || len(p.Errors) != 0 {
		t.Fatalf("problem = %+v", p)
	}
	asProblem(t, postJSON(t, h, "/api/v1/operations/add", `{"operation":"add","operands":[2,3]}`), 400, "INVALID_REQUEST")
}

// Item 2.4.
func TestShapeValidation(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	tests := []struct{ body, code, field string }{
		{``, "INVALID_JSON", ""},
		{`{`, "INVALID_JSON", ""},
		{`{"operation":"add","operands":[1,2]} {}`, "INVALID_JSON", ""},
		{`[1,2]`, "INVALID_REQUEST", ""},
		{`{"operands":[1,2]}`, "INVALID_REQUEST", "operation"},
		{`{"operation":"add"}`, "INVALID_REQUEST", "operands"},
		{`{"operation":5,"operands":[1,2]}`, "INVALID_REQUEST", "operation"},
		{`{"operation":"add","operands":"12"}`, "INVALID_REQUEST", "operands"},
		{`{"operation":"add","operands":[1,"2"]}`, "INVALID_REQUEST", "operands"},
		{`{"operation":"add","operands":[1,null]}`, "INVALID_REQUEST", "operands"},
		{`{"operation":"add","operands":[1,2],"extra":true}`, "INVALID_REQUEST", "extra"},
		{`{"operation":"add","operands":[1e999,1]}`, "INVALID_REQUEST", "operands"},
		{`{"operation":"add","operands":[1]}`, "INVALID_OPERAND_COUNT", "operands"},
		{`{"operation":"add","operands":[]}`, "INVALID_OPERAND_COUNT", "operands"},
		{`{"operation":"sqrt","operands":[1,2]}`, "INVALID_OPERAND_COUNT", "operands"},
		{`{"operation":"add","operands":[1,2,3]}`, "INVALID_OPERAND_COUNT", "operands"},
	}
	for _, tt := range tests {
		t.Run(tt.body, func(t *testing.T) {
			p := asProblem(t, postJSON(t, h, "/api/v1/calculations", tt.body), 400, tt.code)
			if tt.field == "" && len(p.Errors) != 0 {
				t.Fatalf("errors = %+v, want none", p.Errors)
			}
			if tt.field != "" && (len(p.Errors) == 0 || p.Errors[0].Field != tt.field) {
				t.Fatalf("errors = %+v, want field %s", p.Errors, tt.field)
			}
		})
	}
}

// Item 2.5.
func TestBusinessValidation(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	for _, name := range []string{"modulo", "ADD", "Add", ""} {
		body := `{"operation":"` + name + `","operands":[7]}`
		p := asProblem(t, postJSON(t, h, "/api/v1/calculations", body), 422, "UNKNOWN_OPERATION")
		if len(p.Errors) != 1 || p.Errors[0].Field != "operation" ||
			p.Errors[0].Message != "must be one of: add, subtract, multiply, divide, power, sqrt, percentage, reciprocal, square." {
			t.Errorf("%q: errors = %+v", name, p.Errors)
		}
	}
	p := asProblem(t, postJSON(t, h, "/api/v1/calculations", `{"operation":"modulo","operands":[7,3]}`), 422, "UNKNOWN_OPERATION")
	if p.Detail != `Unknown operation "modulo".` || p.Title != "Unprocessable Entity" || p.Instance != "/api/v1/calculations" {
		t.Fatalf("problem = %+v", p)
	}
}

// Item 2.6.
func TestHTTPHygiene(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	valid := `{"operation":"add","operands":[1,2]}`

	asProblem(t, call(t, h, request{method: "GET", path: "/api/v1/nothing"}), 404, "NOT_FOUND")
	asProblem(t, call(t, h, request{method: "GET", path: "/api"}), 404, "NOT_FOUND")
	for _, tt := range []struct{ method, path, allow string }{
		{"PUT", "/api/v1/calculations", "POST"}, {"GET", "/api/v1/calculations", "POST"}, {"DELETE", "/api/v1/operations", "GET"},
	} {
		rec := call(t, h, request{method: tt.method, path: tt.path})
		asProblem(t, rec, 405, "METHOD_NOT_ALLOWED")
		if rec.Header().Get("Allow") != tt.allow {
			t.Errorf("%s %s Allow = %q", tt.method, tt.path, rec.Header().Get("Allow"))
		}
	}
	p := asProblem(t, call(t, h, request{method: "PUT", path: "/api/v1/calculations"}), 405, "METHOD_NOT_ALLOWED")
	if p.Detail != "PUT isn't allowed on /api/v1/calculations. Allowed: POST." {
		t.Errorf("detail = %q", p.Detail)
	}
	asProblem(t, call(t, h, request{path: "/api/v1/calculations", body: valid, contentType: "text/plain"}), 415, "UNSUPPORTED_MEDIA_TYPE")
	asProblem(t, call(t, h, request{path: "/api/v1/calculations", body: valid}), 415, "UNSUPPORTED_MEDIA_TYPE")

	big := `{"operation":"add","operands":[1,2],"pad":"` + strings.Repeat("x", 5000) + `"}`
	asProblem(t, postJSON(t, h, "/api/v1/calculations", big), 413, "PAYLOAD_TOO_LARGE")
	asProblem(t, postJSON(t, h, "/api/v1/operations/add", big), 413, "PAYLOAD_TOO_LARGE")
	// The media type is checked before the size.
	asProblem(t, call(t, h, request{path: "/api/v1/calculations", body: big, contentType: "text/plain"}), 415, "UNSUPPORTED_MEDIA_TYPE")
	// The limit is 4096 bytes: a body of exactly that size passes the limit and then fails as JSON.
	exact := `{"operation":"add","operands":[1,2],"pad":"` + strings.Repeat("x", 4096-len(`{"operation":"add","operands":[1,2],"pad":""}`)) + `"}`
	if len(exact) != 4096 {
		t.Fatalf("test body has %d bytes", len(exact))
	}
	asProblem(t, postJSON(t, h, "/api/v1/calculations", exact), 400, "INVALID_REQUEST")

	rec := call(t, h, request{path: "/api/v1/calculations", body: valid, contentType: "application/json; charset=utf-8"})
	if rec.Code != 200 {
		t.Fatalf("charset parameter -> %d", rec.Code)
	}
}

// Item 2.7.
func TestRateLimiting(t *testing.T) {
	cfg := testConfig()
	cfg.RateLimitPerMinute, cfg.RateLimitBurst = 60, 5
	clk := &clock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	h := newTestHandler(t, cfg, clk)
	body := `{"operation":"add","operands":[1,2]}`

	for i := 1; i <= 5; i++ {
		if rec := postJSON(t, h, "/api/v1/calculations", body); rec.Code != 200 {
			t.Fatalf("request %d -> %d", i, rec.Code)
		}
	}
	rec := postJSON(t, h, "/api/v1/calculations", body)
	p := asProblem(t, rec, 429, "RATE_LIMITED")
	retry, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	if err != nil || retry < 1 || p.RetryAfter != retry {
		t.Fatalf("Retry-After %q, retryAfter %d", rec.Header().Get("Retry-After"), p.RetryAfter)
	}
	if rec := call(t, h, request{method: "GET", path: "/healthz"}); rec.Code != 200 {
		t.Fatalf("/healthz while limited -> %d", rec.Code)
	}
	clk.now = clk.now.Add(time.Duration(retry) * time.Second)
	if rec := postJSON(t, h, "/api/v1/calculations", body); rec.Code != 200 {
		t.Fatalf("after waiting %ds -> %d", retry, rec.Code)
	}
}

func TestRateLimitingProxyHeader(t *testing.T) {
	body := `{"operation":"add","operands":[1,2]}`
	send := func(h http.Handler, xff string) int {
		return call(t, h, request{path: "/api/v1/calculations", body: body, contentType: "application/json", headers: map[string]string{"X-Forwarded-For": xff}}).Code
	}
	cfg := testConfig()
	cfg.RateLimitPerMinute, cfg.RateLimitBurst = 60, 1

	cfg.TrustProxy = true
	trusting := newTestHandler(t, cfg, nil)
	if send(trusting, "198.51.100.1") != 200 || send(trusting, "198.51.100.2") != 200 || send(trusting, "198.51.100.1") != 429 {
		t.Fatal("with TRUST_PROXY=true each forwarded address needs its own bucket")
	}

	cfg.TrustProxy = false
	ignoring := newTestHandler(t, cfg, nil)
	if send(ignoring, "198.51.100.1") != 200 || send(ignoring, "198.51.100.2") != 429 {
		t.Fatal("with TRUST_PROXY unset the header must be ignored")
	}
}

// Item 2.8.
func TestRequestIDAndSecurityHeadersOnEveryResponse(t *testing.T) {
	cfg := testConfig()
	cfg.RateLimitPerMinute, cfg.RateLimitBurst = 60, 1
	cfg.CORSAllowedOrigins = []string{"https://app.example.com"}
	h := newTestHandler(t, cfg, &clock{now: time.Now()})
	valid := `{"operation":"add","operands":[1,2]}`
	big := `{"pad":"` + strings.Repeat("x", 5000) + `"}`

	responses := map[string]*httptest.ResponseRecorder{
		"200":        call(t, h, request{method: "GET", path: "/healthz"}),
		"404":        call(t, h, request{method: "GET", path: "/api/v1/nothing"}),
		"405":        call(t, h, request{method: "PUT", path: "/api/v1/operations"}),
		"415":        call(t, h, request{path: "/api/v1/operations/add", body: valid, contentType: "text/plain"}),
		"413":        postJSON(t, h, "/api/v1/operations/add", big),
		"403":        call(t, h, request{method: "OPTIONS", path: "/api/v1/calculations", headers: map[string]string{"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}}),
		"204":        call(t, h, request{method: "OPTIONS", path: "/api/v1/calculations", headers: map[string]string{"Origin": "https://app.example.com", "Access-Control-Request-Method": "POST"}}),
		"static 404": call(t, h, request{method: "GET", path: "/index.html"}),
	}
	postJSON(t, h, "/api/v1/calculations", valid) // spends the single token
	responses["429"] = postJSON(t, h, "/api/v1/calculations", valid)

	for name, rec := range responses {
		if rec.Header().Get("X-Request-Id") == "" || rec.Header().Get("X-Content-Type-Options") != "nosniff" ||
			rec.Header().Get("X-Frame-Options") != "DENY" || rec.Header().Get("Referrer-Policy") != "no-referrer" ||
			!strings.Contains(rec.Header().Get("Content-Security-Policy"), "default-src 'self'") ||
			!strings.Contains(rec.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
			t.Errorf("%s: headers = %v", name, rec.Header())
		}
	}
	for _, name := range []string{"404", "405", "415", "413", "429", "403", "204"} {
		if responses[name].Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s: Cache-Control = %q", name, responses[name].Header().Get("Cache-Control"))
		}
	}
	if code := responses["static 404"].Code; code != 404 {
		t.Errorf("static without STATIC_DIR -> %d", code)
	}
}

func TestPanicBecomesAnOpaque500WithAllHeaders(t *testing.T) {
	boom := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("kaboom") })
	h := withMiddleware(t.Context(), boom, testConfig(), quietLogger(), time.Now)
	rec := call(t, h, request{method: "GET", path: "/api/v1/operations"})
	p := asProblem(t, rec, 500, "INTERNAL_ERROR")
	if p.Detail != "Something went wrong on our side. Quote the request id if you report it." || strings.Contains(rec.Body.String(), "kaboom") {
		t.Fatalf("problem = %+v", p)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("headers = %v", rec.Header())
	}
}

func TestRequestIDEcho(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	get := func(id string) string {
		return call(t, h, request{method: "GET", path: "/healthz", headers: map[string]string{"X-Request-Id": id}}).Header().Get("X-Request-Id")
	}
	if got := get("trace-42.a_b"); got != "trace-42.a_b" {
		t.Errorf("valid id -> %q", got)
	}
	for _, bad := range []string{"has space", strings.Repeat("a", 65)} {
		if got := get(bad); got == bad || len(got) != 32 {
			t.Errorf("invalid id %q -> %q", bad, got)
		}
	}
	p := asProblem(t, call(t, h, request{method: "GET", path: "/api/v1/nothing", headers: map[string]string{"X-Request-Id": "trace-9"}}), 404, "NOT_FOUND")
	if p.RequestID != "trace-9" {
		t.Errorf("requestId = %q", p.RequestID)
	}
}

func TestCORS(t *testing.T) {
	const origin = "https://app.example.com"
	cfg := testConfig()
	cfg.CORSAllowedOrigins = []string{origin}
	h := newTestHandler(t, cfg, nil)

	rec := call(t, h, request{method: "OPTIONS", path: "/api/v1/calculations", headers: map[string]string{"Origin": origin, "Access-Control-Request-Method": "POST"}})
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") != origin || rec.Header().Get("Vary") != "Origin" ||
		!strings.Contains(rec.Header().Get("Access-Control-Allow-Methods"), "POST") ||
		!strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), "Content-Type") {
		t.Fatalf("preflight -> %d %v", rec.Code, rec.Header())
	}
	asProblem(t, call(t, h, request{method: "OPTIONS", path: "/api/v1/calculations", headers: map[string]string{"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}}), 403, "CORS_ORIGIN_NOT_ALLOWED")

	rec = call(t, h, request{path: "/api/v1/calculations", body: `{"operation":"add","operands":[1,2]}`, contentType: "application/json", headers: map[string]string{"Origin": "https://evil.example"}})
	if rec.Code != 200 || rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("foreign POST -> %d %v", rec.Code, rec.Header())
	}

	none := newTestHandler(t, testConfig(), nil)
	for _, r := range []request{
		{method: "OPTIONS", path: "/api/v1/calculations", headers: map[string]string{"Origin": origin, "Access-Control-Request-Method": "POST"}},
		{method: "GET", path: "/api/v1/operations", headers: map[string]string{"Origin": origin}},
	} {
		if rec := call(t, none, r); rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("%s with no allowlist set Access-Control-Allow-Origin", r.method)
		}
	}
}

func TestHealth(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	rec := call(t, h, request{method: "GET", path: "/healthz"})
	if rec.Code != 200 || rec.Body.String() != `{"status":"ok","version":"1.0.0"}` {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

// Item 2.9, the part the backend owns: it serves the exact embedded file.
func TestServesItsOpenAPIFile(t *testing.T) {
	h := newTestHandler(t, testConfig(), nil)
	rec := call(t, h, request{method: "GET", path: "/api/v1/openapi.yaml"})
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/yaml") || !bytes.Equal(rec.Body.Bytes(), api.Spec) {
		t.Fatalf("got %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if !strings.Contains(string(api.Spec), "version: 1.0.0") {
		t.Fatal("info.version is not 1.0.0")
	}
}

func TestNewBuildsTheSameChain(t *testing.T) {
	h := New(testConfig(), quietLogger())
	if rec := call(t, h, request{method: "GET", path: "/healthz"}); rec.Code != 200 || rec.Header().Get("X-Request-Id") == "" {
		t.Fatalf("got %d", rec.Code)
	}
}
