package domain

// Codes for the failures the arithmetic itself can produce.
const (
	CodeDivisionByZero     = "DIVISION_BY_ZERO"
	CodeNegativeSquareRoot = "NEGATIVE_SQUARE_ROOT"
	CodeUndefinedResult    = "UNDEFINED_RESULT"
)

// Error is a business-rule failure. Message is a full sentence that is safe to show to a user.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

// The sentinels are shared and must be treated as read-only.
var (
	ErrDivisionByZero     = &Error{Code: CodeDivisionByZero, Message: "Division by zero is undefined."}
	ErrNegativeSquareRoot = &Error{Code: CodeNegativeSquareRoot, Message: "The square root of a negative number isn't a real number."}
	ErrUndefinedResult    = &Error{Code: CodeUndefinedResult, Message: "The result isn't a real number."}
)
