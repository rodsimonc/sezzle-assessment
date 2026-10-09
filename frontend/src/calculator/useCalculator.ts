import { useEffect, useReducer, useRef } from 'react';
import type { CalculatorApi } from '../api/client';
import { describeError } from '../api/problem';
import { expressionText, formatNumber, historyExpression } from './format';
import { calculatorReducer, initialState } from './reducer';
import type { CalculationRecord, KeyAction } from './types';

export interface CalculatorController {
  /** The text for the display: the number, or `Error`. */
  display: string;
  /** The pending expression, such as `2 +`. Empty when nothing is pending. */
  expression: string;
  /** The message for the error banner, or null. */
  error: string | null;
  /** True while a request is in flight. */
  busy: boolean;
  /** True while memory holds a value other than zero. */
  memoryActive: boolean;
  press: (action: KeyAction) => void;
}

/**
 * Connects the pure reducer to the API. The reducer decides when a call is needed and parks it
 * in `state.request`. This hook makes the call, reports the outcome, and hands each successful
 * calculation (except memory keys) to `onCalculated` for the history list.
 */
export function useCalculator(
  api: CalculatorApi,
  onCalculated: (record: CalculationRecord) => void,
): CalculatorController {
  const [state, dispatch] = useReducer(calculatorReducer, initialState);

  // The call effect below depends on the request alone. A new `api` or callback identity must
  // not cancel a request in flight and send it again, so both are read through a ref.
  const latest = useRef({ api, onCalculated });
  useEffect(() => {
    latest.current = { api, onCalculated };
  });

  const { request } = state;
  useEffect(() => {
    if (!request) return undefined;
    let active = true;

    const run = async (): Promise<void> => {
      let result: number;
      try {
        result = await latest.current.api.calculate(request.operation, request.operands);
      } catch (error) {
        if (active) dispatch({ type: 'failed', message: describeError(error) });
        return;
      }
      if (!active) return;
      dispatch({ type: 'resolved', result });
      if (request.after.kind !== 'memory') {
        latest.current.onCalculated({
          expression: historyExpression(request),
          result: formatNumber(result),
        });
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [request]);

  return {
    display: state.error ? 'Error' : state.display,
    expression: expressionText(state.pending),
    error: state.error,
    busy: request !== null,
    memoryActive: Number(state.memory) !== 0,
    press: dispatch,
  };
}
