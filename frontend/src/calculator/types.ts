import type { OperationName } from '../api/types';

export type UnaryOperation = Extract<OperationName, 'sqrt' | 'reciprocal' | 'square'>;
export type BinaryOperation = Exclude<OperationName, UnaryOperation>;

export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** What a key press means. The keypad, the keyboard and the history list all produce these. */
export type KeyAction =
  | { type: 'digit'; digit: Digit }
  | { type: 'decimal' }
  | { type: 'negate' }
  | { type: 'backspace' }
  | { type: 'allClear' }
  | { type: 'operator'; operation: BinaryOperation }
  | { type: 'unary'; operation: UnaryOperation }
  | { type: 'equals' }
  | { type: 'memoryClear' }
  | { type: 'memoryRecall' }
  | { type: 'memoryAdd' }
  | { type: 'memorySubtract' }
  /** A history entry was chosen. `value` is its stored result text. */
  | { type: 'pick'; value: string };

/** Everything the reducer accepts: key presses plus the two outcomes of an API call. */
export type CalculatorAction =
  KeyAction | { type: 'resolved'; result: number } | { type: 'failed'; message: string };

/** A binary operator waits for its right operand. */
export interface PendingOperation {
  readonly left: string;
  readonly operator: BinaryOperation;
  /** True from the operator key until a new number lands on screen. */
  readonly awaitingRight: boolean;
}

/** What a repeated Equals applies again. */
export interface RepeatOperation {
  readonly operator: BinaryOperation;
  readonly operand: string;
}

/** The API call the reducer wants made. The controller performs it and reports the outcome. */
export type PendingRequest =
  | {
      readonly arity: 2;
      readonly operation: BinaryOperation;
      readonly operands: readonly [number, number];
      readonly after:
        | { readonly kind: 'chain'; readonly next: BinaryOperation }
        | { readonly kind: 'equals'; readonly repeat: RepeatOperation }
        | { readonly kind: 'memory' };
    }
  | {
      readonly arity: 1;
      readonly operation: UnaryOperation;
      readonly operands: readonly [number];
      readonly after: { readonly kind: 'unary' };
    };

export interface CalculatorState {
  /** The number on screen, as text. While typing it can end in a decimal point. */
  readonly display: string;
  /** `typing` appends digits. `finished` means the next digit starts a new number. */
  readonly entry: 'typing' | 'finished';
  readonly pending: PendingOperation | null;
  readonly repeat: RepeatOperation | null;
  /** The memory value as text. `0` means empty. */
  readonly memory: string;
  /** The message shown in the error banner, or null. */
  readonly error: string | null;
  /** Set while a call is in flight. Key presses are ignored until it settles. */
  readonly request: PendingRequest | null;
}

/** One finished calculation, ready for the history list. */
export interface CalculationRecord {
  expression: string;
  result: string;
}
