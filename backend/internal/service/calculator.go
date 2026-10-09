// Package service owns the calculation rules: operation lookup, operand counts,
// rejection of NaN and infinity, 15-digit rounding and negative-zero cleanup.
package service

import (
	"fmt"
	"math"
	"strconv"

	"calculator/internal/domain"
)

// CodeResultOutOfRange marks a result that overflowed float64.
const CodeResultOutOfRange = "RESULT_OUT_OF_RANGE"

var errResultOutOfRange = &domain.Error{Code: CodeResultOutOfRange, Message: "The result is too large to represent."}

// UnknownOperationError reports a name that no operation answers to.
type UnknownOperationError struct{ Name string }

func (e *UnknownOperationError) Error() string {
	return fmt.Sprintf("unknown operation %q", e.Name)
}

// OperandCountError reports an operand list of the wrong length.
type OperandCountError struct {
	Operation string
	Want      int
	Got       int
}

func (e *OperandCountError) Error() string {
	noun := "operands"
	if e.Want == 1 {
		noun = "operand"
	}
	return fmt.Sprintf("%s needs %d %s, got %d", e.Operation, e.Want, noun, e.Got)
}

// Result is one finished calculation.
type Result struct {
	Operation string
	Operands  []float64
	Value     float64
}

// Calculator runs operations. It keeps no state between calls. lookup is a field so a test can
// add an operation that returns NaN, which no real operation can.
type Calculator struct {
	lookup func(name string) (domain.Operation, bool)
}

// New returns a Calculator.
func New() *Calculator { return &Calculator{lookup: domain.Lookup} }

// Operations lists the catalogue in its fixed order.
func (*Calculator) Operations() []domain.Operation { return domain.All() }

// Calculate validates the request, runs the operation and cleans up the result.
func (c *Calculator) Calculate(name string, operands []float64) (Result, error) {
	op, ok := c.lookup(name)
	if !ok {
		return Result{}, &UnknownOperationError{Name: name}
	}
	if len(operands) != op.Arity {
		return Result{}, &OperandCountError{Operation: name, Want: op.Arity, Got: len(operands)}
	}
	value, err := op.Apply(operands)
	if err != nil {
		return Result{}, err
	}
	switch {
	case math.IsNaN(value):
		return Result{}, domain.ErrUndefinedResult
	case math.IsInf(value, 0):
		return Result{}, errResultOutOfRange
	}
	return Result{Operation: name, Operands: operands, Value: clean(value)}, nil
}

// clean rounds to 15 significant digits and turns negative zero into zero.
// Rounding can push a value just under MaxFloat64 over the edge. ParseFloat then
// reports a range error and the unrounded value stays.
func clean(x float64) float64 {
	rounded, err := strconv.ParseFloat(strconv.FormatFloat(x, 'g', 15, 64), 64)
	if err != nil {
		rounded = x
	}
	if rounded == 0 {
		return 0
	}
	return rounded
}
