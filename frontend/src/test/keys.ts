import { describeError } from '../api/problem';
import { calculatorReducer, initialState } from '../calculator/reducer';
import type { CalculatorState, KeyAction, PendingRequest } from '../calculator/types';
import { fakeArithmetic } from './fakeArithmetic';

/** Short names for key presses, so a reducer test reads like the keys a person would press. */
const TOKENS: Readonly<Record<string, KeyAction>> = {
  '0': { type: 'digit', digit: '0' },
  '1': { type: 'digit', digit: '1' },
  '2': { type: 'digit', digit: '2' },
  '3': { type: 'digit', digit: '3' },
  '4': { type: 'digit', digit: '4' },
  '5': { type: 'digit', digit: '5' },
  '6': { type: 'digit', digit: '6' },
  '7': { type: 'digit', digit: '7' },
  '8': { type: 'digit', digit: '8' },
  '9': { type: 'digit', digit: '9' },
  '.': { type: 'decimal' },
  neg: { type: 'negate' },
  bs: { type: 'backspace' },
  ac: { type: 'allClear' },
  '+': { type: 'operator', operation: 'add' },
  '-': { type: 'operator', operation: 'subtract' },
  '*': { type: 'operator', operation: 'multiply' },
  '/': { type: 'operator', operation: 'divide' },
  '^': { type: 'operator', operation: 'power' },
  '%': { type: 'operator', operation: 'percentage' },
  sqrt: { type: 'unary', operation: 'sqrt' },
  recip: { type: 'unary', operation: 'reciprocal' },
  sq: { type: 'unary', operation: 'square' },
  '=': { type: 'equals' },
  mc: { type: 'memoryClear' },
  mr: { type: 'memoryRecall' },
  'm+': { type: 'memoryAdd' },
  'm-': { type: 'memorySubtract' },
};

/** Turns `'2 + 3 ='` into key actions. */
export function keyActions(sequence: string): KeyAction[] {
  return sequence
    .split(/\s+/)
    .filter((token) => token !== '')
    .map((token) => {
      const action = TOKENS[token];
      if (!action) throw new Error(`Unknown key token "${token}".`);
      return action;
    });
}

export interface Played {
  state: CalculatorState;
  /** Every request the reducer made, in order. */
  requests: PendingRequest[];
}

/**
 * Presses the keys in order. Each request the reducer makes is answered at once by the fake
 * arithmetic, the way a fast backend would, so the sequence reads like a person's key presses.
 */
export function play(sequence: string, start: CalculatorState = initialState): Played {
  let state = start;
  const requests: PendingRequest[] = [];
  for (const action of keyActions(sequence)) {
    state = calculatorReducer(state, action);
    while (state.request) {
      const { request } = state;
      requests.push(request);
      try {
        const result = fakeArithmetic(request.operation, request.operands);
        state = calculatorReducer(state, { type: 'resolved', result });
      } catch (error) {
        state = calculatorReducer(state, { type: 'failed', message: describeError(error) });
      }
    }
  }
  return { state, requests };
}

/** What the API calls looked like, without the reducer's bookkeeping. */
export function wire(
  requests: readonly PendingRequest[],
): { operation: string; operands: number[] }[] {
  return requests.map((request) => ({
    operation: request.operation,
    operands: [...request.operands],
  }));
}
