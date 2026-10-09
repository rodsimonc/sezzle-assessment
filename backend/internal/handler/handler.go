// Package handler holds the HTTP handlers. They decode, call the service and encode. They do no arithmetic.
package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"calculator/internal/domain"
	"calculator/internal/problem"
	"calculator/internal/service"
	"calculator/internal/version"
)

// Calculator is the part of the service the handlers use.
type Calculator interface {
	Calculate(name string, operands []float64) (service.Result, error)
	Operations() []domain.Operation
}

// Handler serves the API routes.
type Handler struct {
	calc   Calculator
	logger *slog.Logger
	spec   []byte
}

// New builds a Handler. spec is the OpenAPI document served at /api/v1/openapi.yaml.
func New(calc Calculator, logger *slog.Logger, spec []byte) *Handler {
	return &Handler{calc: calc, logger: logger, spec: spec}
}

// NotFound answers a request that matches no route.
func NotFound(w http.ResponseWriter, r *http.Request) {
	problem.Write(w, r, http.StatusNotFound, problem.CodeNotFound, problem.NotFoundDetail(r.Method, r.URL.Path))
}

// MethodNotAllowed answers a known path called with the wrong method. Go's own 405 is plain text,
// so every route checks the method itself.
func MethodNotAllowed(w http.ResponseWriter, r *http.Request, allowed ...string) {
	w.Header().Set("Allow", strings.Join(allowed, ", "))
	problem.Write(w, r, http.StatusMethodNotAllowed, problem.CodeMethodNotAllowed, problem.MethodNotAllowedDetail(r.Method, r.URL.Path, allowed))
}

func allow(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method == method {
		return true
	}
	MethodNotAllowed(w, r, method)
	return false
}

// Calculations handles POST /api/v1/calculations.
func (h *Handler) Calculations(w http.ResponseWriter, r *http.Request) {
	if !allow(w, r, http.MethodPost) {
		return
	}
	body, bad := readBody(r)
	if bad != nil {
		bad.write(w, r)
		return
	}
	req, bad := decodeCalculation(body)
	if bad != nil {
		bad.write(w, r)
		return
	}
	h.calculate(w, r, req.Operation, req.Operands, false)
}

// RunOperation handles POST /api/v1/operations/{name}.
func (h *Handler) RunOperation(w http.ResponseWriter, r *http.Request) {
	if !allow(w, r, http.MethodPost) {
		return
	}
	body, bad := readBody(r)
	if bad != nil {
		bad.write(w, r)
		return
	}
	req, bad := decodeOperands(body)
	if bad != nil {
		bad.write(w, r)
		return
	}
	h.calculate(w, r, r.PathValue("name"), req.Operands, true)
}

// Operations handles GET /api/v1/operations.
func (h *Handler) Operations(w http.ResponseWriter, r *http.Request) {
	if !allow(w, r, http.MethodGet) {
		return
	}
	ops := h.calc.Operations()
	items := make([]OperationResponse, len(ops))
	for i, op := range ops {
		items[i] = OperationResponse{Name: op.Name, Symbol: op.Symbol, Arity: op.Arity, Description: op.Description}
	}
	h.writeJSON(w, r, OperationListResponse{Items: items, Total: len(items)})
}

// OpenAPI handles GET /api/v1/openapi.yaml.
func (h *Handler) OpenAPI(w http.ResponseWriter, r *http.Request) {
	if !allow(w, r, http.MethodGet) {
		return
	}
	w.Header().Set("Content-Type", "application/yaml")
	_, _ = w.Write(h.spec)
}

// Health handles GET /healthz.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	if !allow(w, r, http.MethodGet) {
		return
	}
	h.writeJSON(w, r, healthResponse{Status: "ok", Version: version.Version})
}

func (h *Handler) calculate(w http.ResponseWriter, r *http.Request, name string, operands []float64, fromPath bool) {
	res, err := h.calc.Calculate(name, operands)
	if err != nil {
		h.fail(w, r, err, fromPath)
		return
	}
	h.writeJSON(w, r, CalculationResponse{Operation: res.Operation, Operands: res.Operands, Result: res.Value})
}

// fail maps a service error to a Problem. An unknown name is a 422 in a body and a 404 in the path.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error, fromPath bool) {
	var unknown *service.UnknownOperationError
	var count *service.OperandCountError
	var rule *domain.Error
	switch {
	case errors.As(err, &unknown) && fromPath:
		problem.Write(w, r, http.StatusNotFound, problem.CodeUnknownOperation, problem.UnknownOperationDetail(unknown.Name))
	case errors.As(err, &unknown):
		problem.Write(w, r, http.StatusUnprocessableEntity, problem.CodeUnknownOperation, problem.UnknownOperationDetail(unknown.Name),
			problem.WithErrors(problem.FieldError{Field: "operation", Message: h.validNames()}))
	case errors.As(err, &count):
		problem.Write(w, r, http.StatusBadRequest, problem.CodeInvalidOperandCount, problem.DetailInvalidOperandCount,
			problem.WithErrors(problem.FieldError{Field: "operands", Message: count.Error() + "."}))
	case errors.As(err, &rule):
		problem.Write(w, r, http.StatusUnprocessableEntity, rule.Code, rule.Message)
	default:
		h.internalError(w, r, err)
	}
}

func (h *Handler) validNames() string {
	ops := h.calc.Operations()
	names := make([]string, len(ops))
	for i, op := range ops {
		names[i] = op.Name
	}
	return "must be one of: " + strings.Join(names, ", ") + "."
}

func (h *Handler) internalError(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.Error("request failed", "error", err, "requestId", problem.RequestID(r.Context()))
	problem.Write(w, r, http.StatusInternalServerError, problem.CodeInternalError, problem.DetailInternalError)
}

func (h *Handler) writeJSON(w http.ResponseWriter, r *http.Request, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		h.internalError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}
