// Package domain holds the pure arithmetic. It knows nothing about HTTP, rounding or request shapes.
package domain

import "math"

// Operation describes one calculator operation. Apply expects exactly Arity operands,
// and the service checks the count before it calls.
type Operation struct {
	Name        string
	Symbol      string
	Description string
	Arity       int
	Apply       func(operands []float64) (float64, error)
}

var operations = []Operation{
	{Name: "add", Symbol: "+", Arity: 2, Description: "Adds two numbers.", Apply: add},
	{Name: "subtract", Symbol: "-", Arity: 2, Description: "Subtracts the second number from the first.", Apply: subtract},
	{Name: "multiply", Symbol: "*", Arity: 2, Description: "Multiplies two numbers.", Apply: multiply},
	{Name: "divide", Symbol: "/", Arity: 2, Description: "Divides the first number by the second.", Apply: divide},
	{Name: "power", Symbol: "^", Arity: 2, Description: "Raises the first number to the power of the second.", Apply: power},
	{Name: "sqrt", Symbol: "sqrt", Arity: 1, Description: "Returns the square root of a non-negative number.", Apply: sqrt},
	{Name: "percentage", Symbol: "%", Arity: 2, Description: "Returns the first number percent of the second.", Apply: percentage},
	{Name: "reciprocal", Symbol: "1/x", Arity: 1, Description: "Returns 1 divided by the number.", Apply: reciprocal},
	{Name: "square", Symbol: "x^2", Arity: 1, Description: "Multiplies the number by itself.", Apply: square},
}

// All returns the operations in catalogue order. The slice is a copy.
func All() []Operation {
	out := make([]Operation, len(operations))
	copy(out, operations)
	return out
}

// Lookup finds an operation by its exact, case-sensitive name.
func Lookup(name string) (Operation, bool) {
	for _, op := range operations {
		if op.Name == name {
			return op, true
		}
	}
	return Operation{}, false
}

func add(o []float64) (float64, error)      { return o[0] + o[1], nil }
func subtract(o []float64) (float64, error) { return o[0] - o[1], nil }
func multiply(o []float64) (float64, error) { return o[0] * o[1], nil }
func square(o []float64) (float64, error)   { return o[0] * o[0], nil }

func divide(o []float64) (float64, error) {
	if o[1] == 0 {
		return 0, ErrDivisionByZero
	}
	return o[0] / o[1], nil
}

func power(o []float64) (float64, error) {
	base, exp := o[0], o[1]
	if base == 0 && exp < 0 {
		return 0, ErrDivisionByZero
	}
	if base < 0 && exp != math.Trunc(exp) {
		return 0, ErrUndefinedResult
	}
	return math.Pow(base, exp), nil
}

func sqrt(o []float64) (float64, error) {
	if o[0] < 0 {
		return 0, ErrNegativeSquareRoot
	}
	return math.Sqrt(o[0]), nil
}

// percentage divides first so that 1e308 percent of 50 stays finite.
func percentage(o []float64) (float64, error) { return o[0] / 100 * o[1], nil }

func reciprocal(o []float64) (float64, error) {
	if o[0] == 0 {
		return 0, ErrDivisionByZero
	}
	return 1 / o[0], nil
}
