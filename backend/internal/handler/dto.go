package handler

// CalculationRequest is the body of POST /api/v1/calculations.
type CalculationRequest struct {
	Operation string    `json:"operation"`
	Operands  []float64 `json:"operands"`
}

// OperandsRequest is the body of POST /api/v1/operations/{name}.
type OperandsRequest struct {
	Operands []float64 `json:"operands"`
}

// CalculationResponse is the body of a successful calculation.
type CalculationResponse struct {
	Operation string    `json:"operation"`
	Operands  []float64 `json:"operands"`
	Result    float64   `json:"result"`
}

// OperationResponse describes one operation in the catalogue.
type OperationResponse struct {
	Name        string `json:"name"`
	Symbol      string `json:"symbol"`
	Arity       int    `json:"arity"`
	Description string `json:"description"`
}

// OperationListResponse is the body of GET /api/v1/operations.
type OperationListResponse struct {
	Items []OperationResponse `json:"items"`
	Total int                 `json:"total"`
}

type healthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}
