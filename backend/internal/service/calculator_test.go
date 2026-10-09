package service

import (
	"errors"
	"math"
	"testing"

	"calculator/internal/domain"
)

func TestCalculate(t *testing.T) {
	maxFloat := math.MaxFloat64
	tests := []struct {
		name     string
		op       string
		operands []float64
		want     float64
	}{
		{"add", "add", []float64{2, 3}, 5},
		{"float noise is rounded", "add", []float64{0.1, 0.2}, 0.3},
		{"subtract noise", "subtract", []float64{0.3, 0.1}, 0.2},
		{"multiply noise", "multiply", []float64{1.1, 1.1}, 1.21},
		{"multiply 4.35 by 100", "multiply", []float64{4.35, 100}, 435},
		{"divide to 15 digits", "divide", []float64{1, 3}, 0.333333333333333},
		{"sqrt 2 drops the trailing zero", "sqrt", []float64{2}, 1.4142135623731},
		{"15 digits stay exact", "add", []float64{999999999999999, 1}, 1000000000000000},
		{"16 digits are rounded", "add", []float64{1234567890123456, 1}, 1234567890123460},
		{"largest float64 survives rounding", "add", []float64{maxFloat, 0}, maxFloat},
		{"smallest denormal survives", "add", []float64{5e-324, 0}, 5e-324},
		{"negative zero becomes zero", "multiply", []float64{0, -5}, 0},
		{"sqrt of negative zero", "sqrt", []float64{math.Copysign(0, -1)}, 0},
		{"percentage", "percentage", []float64{1e308, 50}, 5e307},
	}
	c := New()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := c.Calculate(tt.op, tt.operands)
			if err != nil {
				t.Fatalf("Calculate error = %v", err)
			}
			if res.Value != tt.want {
				t.Fatalf("Value = %v, want %v", res.Value, tt.want)
			}
			if tt.want == 0 && math.Signbit(res.Value) {
				t.Fatal("result is negative zero")
			}
			if res.Operation != tt.op || len(res.Operands) != len(tt.operands) {
				t.Fatalf("Result echoes %q %v", res.Operation, res.Operands)
			}
		})
	}
}

func TestCalculateErrors(t *testing.T) {
	tests := []struct {
		name     string
		op       string
		operands []float64
		code     string
	}{
		{"divide by zero", "divide", []float64{5, 0}, domain.CodeDivisionByZero},
		{"negative root", "sqrt", []float64{-4}, domain.CodeNegativeSquareRoot},
		{"undefined power", "power", []float64{-8, 0.5}, domain.CodeUndefinedResult},
		{"multiply overflows", "multiply", []float64{1e308, 10}, CodeResultOutOfRange},
		{"add overflows", "add", []float64{math.MaxFloat64, math.MaxFloat64}, CodeResultOutOfRange},
		{"power overflows", "power", []float64{10, 400}, CodeResultOutOfRange},
		{"reciprocal overflows", "reciprocal", []float64{5e-324}, CodeResultOutOfRange},
		{"square overflows", "square", []float64{1e200}, CodeResultOutOfRange},
	}
	c := New()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := c.Calculate(tt.op, tt.operands)
			var de *domain.Error
			if !errors.As(err, &de) || de.Code != tt.code {
				t.Fatalf("error = %v, want code %s", err, tt.code)
			}
		})
	}
}

func TestCalculateRejectsNaN(t *testing.T) {
	c := &Calculator{lookup: func(string) (domain.Operation, bool) {
		return domain.Operation{Name: "nan", Arity: 1, Apply: func([]float64) (float64, error) { return math.NaN(), nil }}, true
	}}
	_, err := c.Calculate("nan", []float64{1})
	var de *domain.Error
	if !errors.As(err, &de) || de.Code != domain.CodeUndefinedResult {
		t.Fatalf("error = %v, want %s", err, domain.CodeUndefinedResult)
	}
}

func TestCalculateUnknownOperation(t *testing.T) {
	c := New()
	for _, name := range []string{"modulo", "ADD", "Add", ""} {
		// The operand count is wrong on purpose: an unknown name wins.
		_, err := c.Calculate(name, []float64{1, 2, 3})
		var unknown *UnknownOperationError
		if !errors.As(err, &unknown) || unknown.Name != name {
			t.Fatalf("Calculate(%q) error = %v, want UnknownOperationError", name, err)
		}
		if unknown.Error() == "" {
			t.Fatal("empty error text")
		}
	}
}

func TestCalculateOperandCount(t *testing.T) {
	tests := []struct {
		op       string
		operands []float64
		want     string
	}{
		{"add", []float64{1}, "add needs 2 operands, got 1"},
		{"add", nil, "add needs 2 operands, got 0"},
		{"add", []float64{1, 2, 3}, "add needs 2 operands, got 3"},
		{"sqrt", []float64{1, 2}, "sqrt needs 1 operand, got 2"},
		{"square", nil, "square needs 1 operand, got 0"},
	}
	c := New()
	for _, tt := range tests {
		_, err := c.Calculate(tt.op, tt.operands)
		var count *OperandCountError
		if !errors.As(err, &count) {
			t.Fatalf("Calculate(%s, %v) error = %v, want OperandCountError", tt.op, tt.operands, err)
		}
		if count.Error() != tt.want {
			t.Errorf("message = %q, want %q", count.Error(), tt.want)
		}
	}
}

func TestOperations(t *testing.T) {
	if got := New().Operations(); len(got) != 9 || got[0].Name != "add" || got[8].Name != "square" {
		t.Fatalf("Operations() = %d entries", len(got))
	}
}
