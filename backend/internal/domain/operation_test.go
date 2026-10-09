package domain

import (
	"errors"
	"math"
	"testing"
)

func TestAllOrderAndShape(t *testing.T) {
	want := []struct {
		name, symbol string
		arity        int
	}{
		{"add", "+", 2}, {"subtract", "-", 2}, {"multiply", "*", 2}, {"divide", "/", 2},
		{"power", "^", 2}, {"sqrt", "sqrt", 1}, {"percentage", "%", 2}, {"reciprocal", "1/x", 1}, {"square", "x^2", 1},
	}
	got := All()
	if len(got) != len(want) {
		t.Fatalf("All() has %d operations, want %d", len(got), len(want))
	}
	for i, w := range want {
		if got[i].Name != w.name || got[i].Symbol != w.symbol || got[i].Arity != w.arity {
			t.Errorf("All()[%d] = %s %s %d, want %s %s %d", i, got[i].Name, got[i].Symbol, got[i].Arity, w.name, w.symbol, w.arity)
		}
		if got[i].Description == "" || got[i].Apply == nil {
			t.Errorf("All()[%d] (%s) lacks a description or an Apply function", i, got[i].Name)
		}
	}
}

func TestAllReturnsACopy(t *testing.T) {
	first := All()
	first[0].Name = "changed"
	if All()[0].Name != "add" {
		t.Fatal("changing the slice from All() changed the registry")
	}
}

func TestLookup(t *testing.T) {
	tests := []struct {
		name string
		ok   bool
	}{
		{"add", true}, {"square", true}, {"ADD", false}, {"Add", false}, {"modulo", false}, {"", false},
	}
	for _, tt := range tests {
		op, ok := Lookup(tt.name)
		if ok != tt.ok {
			t.Errorf("Lookup(%q) ok = %v, want %v", tt.name, ok, tt.ok)
		}
		if ok && op.Name != tt.name {
			t.Errorf("Lookup(%q) returned %q", tt.name, op.Name)
		}
	}
}

func TestApply(t *testing.T) {
	tests := []struct {
		name     string
		op       string
		operands []float64
		want     float64
		wantCode string
	}{
		{name: "add", op: "add", operands: []float64{2, 3}, want: 5},
		{name: "add keeps float noise", op: "add", operands: []float64{0.1, 0.2}, want: 0.30000000000000004},
		{name: "subtract", op: "subtract", operands: []float64{10, 4}, want: 6},
		{name: "multiply", op: "multiply", operands: []float64{6, 7}, want: 42},
		{name: "divide", op: "divide", operands: []float64{10, 4}, want: 2.5},
		{name: "divide by zero", op: "divide", operands: []float64{5, 0}, wantCode: CodeDivisionByZero},
		{name: "divide by negative zero", op: "divide", operands: []float64{5, math.Copysign(0, -1)}, wantCode: CodeDivisionByZero},
		{name: "zero over zero", op: "divide", operands: []float64{0, 0}, wantCode: CodeDivisionByZero},
		{name: "power", op: "power", operands: []float64{2, 10}, want: 1024},
		{name: "power negative exponent", op: "power", operands: []float64{2, -1}, want: 0.5},
		{name: "power root", op: "power", operands: []float64{9, 0.5}, want: 3},
		{name: "zero to zero", op: "power", operands: []float64{0, 0}, want: 1},
		{name: "negative base integer exponent", op: "power", operands: []float64{-2, 3}, want: -8},
		{name: "negative base fractional exponent", op: "power", operands: []float64{-8, 0.5}, wantCode: CodeUndefinedResult},
		{name: "zero to negative exponent", op: "power", operands: []float64{0, -1}, wantCode: CodeDivisionByZero},
		{name: "power overflows to infinity", op: "power", operands: []float64{10, 400}, want: math.Inf(1)},
		{name: "sqrt", op: "sqrt", operands: []float64{9}, want: 3},
		{name: "sqrt zero", op: "sqrt", operands: []float64{0}, want: 0},
		{name: "sqrt negative", op: "sqrt", operands: []float64{-4}, wantCode: CodeNegativeSquareRoot},
		{name: "percentage", op: "percentage", operands: []float64{15, 200}, want: 30},
		{name: "percentage divides first", op: "percentage", operands: []float64{1e308, 50}, want: 5e307},
		{name: "reciprocal", op: "reciprocal", operands: []float64{4}, want: 0.25},
		{name: "reciprocal zero", op: "reciprocal", operands: []float64{0}, wantCode: CodeDivisionByZero},
		{name: "reciprocal overflows", op: "reciprocal", operands: []float64{5e-324}, want: math.Inf(1)},
		{name: "square", op: "square", operands: []float64{-3}, want: 9},
		{name: "square overflows", op: "square", operands: []float64{1e200}, want: math.Inf(1)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			op, ok := Lookup(tt.op)
			if !ok {
				t.Fatalf("no operation %q", tt.op)
			}
			got, err := op.Apply(tt.operands)
			if tt.wantCode != "" {
				var de *Error
				if !errors.As(err, &de) || de.Code != tt.wantCode {
					t.Fatalf("Apply error = %v, want code %s", err, tt.wantCode)
				}
				if de.Error() != de.Message || de.Message == "" {
					t.Fatalf("Error() = %q, Message = %q", de.Error(), de.Message)
				}
				return
			}
			if err != nil {
				t.Fatalf("Apply error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("Apply = %v, want %v", got, tt.want)
			}
		})
	}
}
