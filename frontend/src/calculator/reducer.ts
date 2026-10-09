import { canonicalNumber, formatNumber, isNumericText } from './format';
import type {
  BinaryOperation,
  CalculatorAction,
  CalculatorState,
  Digit,
  KeyAction,
  PendingOperation,
  PendingRequest,
  UnaryOperation,
} from './types';

/** Rule 1: a number holds at most 15 digits. */
export const MAX_DIGITS = 15;

export const initialState: CalculatorState = {
  display: '0',
  entry: 'typing',
  pending: null,
  repeat: null,
  memory: '0',
  error: null,
  request: null,
};

function countDigits(text: string): number {
  return text.replace(/[^0-9]/g, '').length;
}

function isZero(text: string): boolean {
  return Number(text) === 0;
}

/** A number landed on screen, so it is now the right operand of any pending operator. */
function claimRight(pending: PendingOperation | null): PendingOperation | null {
  return pending ? { ...pending, awaitingRight: false } : null;
}

/** Puts a finished number on screen: the next digit starts a new number (rule 7). */
function showFinished(state: CalculatorState, text: string): CalculatorState {
  return { ...state, display: text, entry: 'finished', pending: claimRight(state.pending) };
}

function binaryRequest(
  operation: BinaryOperation,
  left: string,
  right: string,
  after: Extract<PendingRequest, { arity: 2 }>['after'],
): PendingRequest {
  return { arity: 2, operation, operands: [Number(left), Number(right)], after };
}

function unaryRequest(operation: UnaryOperation, value: string): PendingRequest {
  return { arity: 1, operation, operands: [Number(value)], after: { kind: 'unary' } };
}

function enterDigit(state: CalculatorState, digit: Digit): CalculatorState {
  if (state.entry === 'finished') {
    return { ...state, display: digit, entry: 'typing', pending: claimRight(state.pending) };
  }
  if (countDigits(state.display) >= MAX_DIGITS) return state;
  return { ...state, display: state.display === '0' ? digit : state.display + digit };
}

function enterDecimal(state: CalculatorState): CalculatorState {
  if (state.entry === 'finished') {
    return { ...state, display: '0.', entry: 'typing', pending: claimRight(state.pending) };
  }
  if (state.display.includes('.') || countDigits(state.display) >= MAX_DIGITS) return state;
  return { ...state, display: `${state.display}.` };
}

function negate(state: CalculatorState): CalculatorState {
  if (isZero(state.display)) return state;
  const display = state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}`;
  return { ...state, display, pending: claimRight(state.pending) };
}

function backspace(state: CalculatorState): CalculatorState {
  if (state.entry !== 'typing') return state;
  const shortened = state.display.slice(0, -1);
  const display = shortened === '' || shortened === '-' || shortened === '-0' ? '0' : shortened;
  return { ...state, display };
}

function pressOperator(state: CalculatorState, operation: BinaryOperation): CalculatorState {
  const { pending } = state;
  if (!pending) {
    return {
      ...state,
      entry: 'finished',
      pending: { left: canonicalNumber(state.display), operator: operation, awaitingRight: true },
    };
  }
  if (pending.awaitingRight) {
    // Rule 3: a second operator before a new number replaces the first. No API call.
    return { ...state, pending: { ...pending, operator: operation } };
  }
  // Rule 4: run the pending operation first, left to right.
  const request = binaryRequest(pending.operator, pending.left, state.display, {
    kind: 'chain',
    next: operation,
  });
  return { ...state, request };
}

function pressEquals(state: CalculatorState): CalculatorState {
  const { pending, repeat } = state;
  if (pending) {
    const operand = canonicalNumber(state.display);
    const request = binaryRequest(pending.operator, pending.left, state.display, {
      kind: 'equals',
      repeat: { operator: pending.operator, operand },
    });
    return { ...state, request };
  }
  if (repeat) {
    // Rule 5: repeat the last operator and right operand against the number on screen.
    const request = binaryRequest(repeat.operator, state.display, repeat.operand, {
      kind: 'equals',
      repeat,
    });
    return { ...state, request };
  }
  return state;
}

function pick(state: CalculatorState, value: string): CalculatorState {
  return isNumericText(value) ? showFinished(state, value) : state;
}

function reduceKey(state: CalculatorState, action: KeyAction): CalculatorState {
  switch (action.type) {
    case 'digit':
      return enterDigit(state, action.digit);
    case 'decimal':
      return enterDecimal(state);
    case 'negate':
      return negate(state);
    case 'backspace':
      return backspace(state);
    case 'allClear':
      return { ...initialState, memory: state.memory };
    case 'operator':
      return pressOperator(state, action.operation);
    case 'unary':
      return { ...state, request: unaryRequest(action.operation, state.display) };
    case 'equals':
      return pressEquals(state);
    case 'memoryClear':
      return { ...state, memory: '0', entry: 'finished' };
    case 'memoryRecall':
      return showFinished(state, state.memory);
    case 'memoryAdd':
      return {
        ...state,
        request: binaryRequest('add', state.memory, state.display, { kind: 'memory' }),
      };
    case 'memorySubtract':
      return {
        ...state,
        request: binaryRequest('subtract', state.memory, state.display, { kind: 'memory' }),
      };
    case 'pick':
      return pick(state, action.value);
  }
}

/** Rule 9: after an error only digits, the decimal point, All clear, Backspace and Memory clear act. */
function reduceInError(state: CalculatorState, action: KeyAction): CalculatorState {
  const fresh: CalculatorState = { ...state, error: null, display: '0', entry: 'typing' };
  switch (action.type) {
    case 'digit':
    case 'decimal':
    case 'backspace':
      return reduceKey(fresh, action);
    case 'allClear':
      return reduceKey(state, action);
    case 'memoryClear':
      return { ...state, memory: '0' };
    default:
      return state;
  }
}

function applyResult(state: CalculatorState, result: number): CalculatorState {
  const { request } = state;
  if (!request) return state;

  const shown = formatNumber(result);
  const settled: CalculatorState = { ...state, request: null, entry: 'finished' };
  if (request.arity === 1) {
    return { ...settled, display: shown, pending: claimRight(state.pending) };
  }

  const { after } = request;
  switch (after.kind) {
    case 'chain':
      return {
        ...settled,
        display: shown,
        pending: { left: shown, operator: after.next, awaitingRight: true },
      };
    case 'equals':
      return { ...settled, display: shown, pending: null, repeat: after.repeat };
    case 'memory':
      return { ...settled, memory: shown };
  }
}

/** A failed call drops the pending operation. Memory survives. */
function applyFailure(state: CalculatorState, message: string): CalculatorState {
  if (!state.request) return state;
  return { ...initialState, memory: state.memory, entry: 'finished', error: message };
}

/**
 * The calculator as a state machine (UI contract rules 1 to 14). It is pure: arithmetic is
 * never done here. When a rule needs a result, the reducer stores a `request`, the controller
 * calls the API, and the answer comes back as a `resolved` or `failed` action.
 */
export function calculatorReducer(
  state: CalculatorState,
  action: CalculatorAction,
): CalculatorState {
  if (action.type === 'resolved') return applyResult(state, action.result);
  if (action.type === 'failed') return applyFailure(state, action.message);
  // Rule 10: key presses are ignored while a request is in flight.
  if (state.request) return state;
  return state.error ? reduceInError(state, action) : reduceKey(state, action);
}
