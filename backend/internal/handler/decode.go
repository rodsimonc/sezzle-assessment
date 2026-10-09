package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"sort"

	"calculator/internal/problem"
)

// badRequest is a decoding failure ready to be written as a Problem.
type badRequest struct {
	status int
	code   string
	detail string
	fields []problem.FieldError
}

func (b *badRequest) write(w http.ResponseWriter, r *http.Request) {
	problem.Write(w, r, b.status, b.code, b.detail, problem.WithErrors(b.fields...))
}

func invalidRequest(fields ...problem.FieldError) *badRequest {
	return &badRequest{status: http.StatusBadRequest, code: problem.CodeInvalidRequest, detail: problem.DetailInvalidRequest, fields: fields}
}

func invalidJSON() *badRequest {
	return &badRequest{status: http.StatusBadRequest, code: problem.CodeInvalidJSON, detail: problem.DetailInvalidJSON}
}

// readBody checks the media type (415), then reads the body within the size limit (413).
// The order is part of the contract: a 5000-byte text/plain body is a 415.
func readBody(r *http.Request) ([]byte, *badRequest) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return nil, &badRequest{status: http.StatusUnsupportedMediaType, code: problem.CodeUnsupportedMediaType, detail: problem.DetailUnsupportedMediaType}
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, &badRequest{status: http.StatusRequestEntityTooLarge, code: problem.CodePayloadTooLarge, detail: problem.DetailPayloadTooLarge}
		}
		return nil, invalidJSON()
	}
	return body, nil
}

// parseObject accepts exactly one JSON object and returns its members undecoded.
func parseObject(body []byte) (map[string]json.RawMessage, *badRequest) {
	dec := json.NewDecoder(bytes.NewReader(body))
	var value json.RawMessage
	if err := dec.Decode(&value); err != nil {
		return nil, invalidJSON()
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, invalidJSON()
	}
	var members map[string]json.RawMessage
	if value[0] != '{' || json.Unmarshal(value, &members) != nil {
		return nil, invalidRequest()
	}
	return members, nil
}

// decodeCalculation reads {operation, operands} and rejects anything else.
func decodeCalculation(body []byte) (CalculationRequest, *badRequest) {
	members, bad := parseObject(body)
	if bad != nil {
		return CalculationRequest{}, bad
	}
	var req CalculationRequest
	var fields []problem.FieldError
	var fe *problem.FieldError
	if req.Operation, fe = readOperation(members); fe != nil {
		fields = append(fields, *fe)
	}
	if req.Operands, fe = readOperands(members); fe != nil {
		fields = append(fields, *fe)
	}
	fields = append(fields, unknownFields(members, "operation", "operands")...)
	if len(fields) > 0 {
		return CalculationRequest{}, invalidRequest(fields...)
	}
	return req, nil
}

// decodeOperands reads {operands}. An operation key counts as unknown here, because the path names the operation.
func decodeOperands(body []byte) (OperandsRequest, *badRequest) {
	members, bad := parseObject(body)
	if bad != nil {
		return OperandsRequest{}, bad
	}
	var req OperandsRequest
	var fields []problem.FieldError
	var fe *problem.FieldError
	if req.Operands, fe = readOperands(members); fe != nil {
		fields = append(fields, *fe)
	}
	fields = append(fields, unknownFields(members, "operands")...)
	if len(fields) > 0 {
		return OperandsRequest{}, invalidRequest(fields...)
	}
	return req, nil
}

func readOperation(members map[string]json.RawMessage) (string, *problem.FieldError) {
	raw, present := members["operation"]
	if !present {
		return "", &problem.FieldError{Field: "operation", Message: "is required."}
	}
	var name string
	if isNull(raw) || json.Unmarshal(raw, &name) != nil {
		return "", &problem.FieldError{Field: "operation", Message: "must be a string."}
	}
	return name, nil
}

// readOperands needs an array of finite numbers. A string, null, boolean or nested value fails,
// and so does a number outside the float64 range.
func readOperands(members map[string]json.RawMessage) ([]float64, *problem.FieldError) {
	raw, present := members["operands"]
	if !present {
		return nil, &problem.FieldError{Field: "operands", Message: "is required."}
	}
	invalid := &problem.FieldError{Field: "operands", Message: "must be an array of numbers."}
	var items []json.RawMessage
	if isNull(raw) || json.Unmarshal(raw, &items) != nil {
		return nil, invalid
	}
	operands := make([]float64, len(items))
	for i, item := range items {
		if isNull(item) || json.Unmarshal(item, &operands[i]) != nil {
			return nil, invalid
		}
	}
	return operands, nil
}

func isNull(raw json.RawMessage) bool { return bytes.Equal(raw, []byte("null")) }

// unknownFields lists every member outside known, sorted so the answer is deterministic.
func unknownFields(members map[string]json.RawMessage, known ...string) []problem.FieldError {
	var names []string
	for name := range members {
		if !contains(known, name) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	fields := make([]problem.FieldError, len(names))
	for i, name := range names {
		fields[i] = problem.FieldError{Field: name, Message: "isn't allowed."}
	}
	return fields
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}
