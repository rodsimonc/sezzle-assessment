import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { networkError, UNEXPECTED_RESPONSE_MESSAGE } from '../api/problem';
import { FakeCalculatorApi } from '../test/fakeApi';
import { keyActions } from '../test/keys';
import type { CalculatorController } from './useCalculator';
import { useCalculator } from './useCalculator';

interface Session {
  api: FakeCalculatorApi;
  onCalculated: ReturnType<typeof vi.fn<(record: { expression: string; result: string }) => void>>;
  current: () => CalculatorController;
  /** Presses keys, one `act` each, and waits for any request to settle. */
  type: (sequence: string) => Promise<void>;
  rerender: () => void;
  unmount: () => void;
}

function setup(api = new FakeCalculatorApi()): Session {
  const onCalculated = vi.fn<(record: { expression: string; result: string }) => void>();
  const hook = renderHook(() => useCalculator(api, onCalculated));
  return {
    api,
    onCalculated,
    current: () => hook.result.current,
    async type(sequence) {
      for (const action of keyActions(sequence)) {
        act(() => {
          hook.result.current.press(action);
        });
        await waitFor(() => {
          expect(hook.result.current.busy).toBe(false);
        });
      }
    },
    rerender: hook.rerender,
    unmount: hook.unmount,
  };
}

describe('useCalculator', () => {
  it('starts at 0 with no expression, no error and no memory', () => {
    const { current } = setup();

    expect(current()).toMatchObject({
      display: '0',
      expression: '',
      error: null,
      busy: false,
      memoryActive: false,
    });
  });

  it('shows the pending expression after an operator', async () => {
    const session = setup();

    await session.type('2 +');

    expect(session.current().expression).toBe('2 +');
    expect(session.api.calls).toEqual([]);
  });

  it('calls the API once on Equals, shows the answer and reports the calculation', async () => {
    const session = setup();

    await session.type('2 + 3 =');

    expect(session.api.calls).toEqual([{ operation: 'add', operands: [2, 3] }]);
    expect(session.current().display).toBe('5');
    expect(session.onCalculated).toHaveBeenCalledTimes(1);
    expect(session.onCalculated).toHaveBeenCalledWith({ expression: '2 + 3', result: '5' });
  });

  it('is busy while a request is in flight and ignores key presses until it settles', async () => {
    const session = setup();
    await session.type('5 + 3');
    const release = session.api.holdNext();

    act(() => {
      session.current().press({ type: 'equals' });
    });
    expect(session.current().busy).toBe(true);

    for (const action of keyActions('= + 9 sqrt')) {
      act(() => {
        session.current().press(action);
      });
    }
    expect(session.api.calls).toHaveLength(1);

    act(() => {
      release();
    });
    await waitFor(() => {
      expect(session.current().busy).toBe(false);
    });
    expect(session.current().display).toBe('8');
    expect(session.api.calls).toHaveLength(1);
    expect(session.onCalculated).toHaveBeenCalledTimes(1);
  });

  it('reports each chained step to the history', async () => {
    const session = setup();

    await session.type('2 + 3 + 4 =');

    expect(session.onCalculated.mock.calls.map(([record]) => record)).toEqual([
      { expression: '2 + 3', result: '5' },
      { expression: '5 + 4', result: '9' },
    ]);
  });

  it('reports a unary call', async () => {
    const session = setup();

    await session.type('9 sqrt');

    expect(session.onCalculated).toHaveBeenCalledWith({ expression: '√(9)', result: '3' });
  });

  it('keeps memory keys out of the history and shows the memory flag', async () => {
    const session = setup();

    await session.type('5 m+');

    expect(session.api.calls).toEqual([{ operation: 'add', operands: [0, 5] }]);
    expect(session.current().memoryActive).toBe(true);
    expect(session.current().display).toBe('5');
    expect(session.onCalculated).not.toHaveBeenCalled();

    await session.type('5 m-');

    expect(session.api.calls.at(-1)).toEqual({ operation: 'subtract', operands: [5, 5] });
    expect(session.current().memoryActive).toBe(false);
  });

  it('shows Error and the API message when a call fails, with no history entry', async () => {
    const session = setup();

    await session.type('1 / 0 =');

    expect(session.current().display).toBe('Error');
    expect(session.current().error).toBe('Division by zero is undefined.');
    expect(session.current().expression).toBe('');
    expect(session.onCalculated).not.toHaveBeenCalled();
  });

  it('shows the network message when the service is unreachable', async () => {
    const session = setup();
    session.api.failNext(networkError());

    await session.type('2 + 3 =');

    expect(session.current().error).toBe(
      "Can't reach the calculator service. Check your connection and try again.",
    );
  });

  it('treats a failure that is not an ApiError as an unexpected response', async () => {
    const session = setup();
    session.api.failNext(new Error('boom'));

    await session.type('2 + 3 =');

    expect(session.current().error).toBe(UNEXPECTED_RESPONSE_MESSAGE);
  });

  it('recovers: a digit clears the error and the next calculation works', async () => {
    const session = setup();
    await session.type('4 neg sqrt');
    expect(session.current().error).toBe(
      "The square root of a negative number isn't a real number.",
    );

    await session.type('5');
    expect(session.current()).toMatchObject({ display: '5', error: null });

    await session.type('+ 1 =');
    expect(session.current().display).toBe('6');
  });

  it('does not send a request again when the api or the callback changes identity', async () => {
    const api = new FakeCalculatorApi();
    const first = vi.fn<(record: { expression: string; result: string }) => void>();
    const second = vi.fn<(record: { expression: string; result: string }) => void>();
    let onCalculated = first;
    const hook = renderHook(() => useCalculator(api, onCalculated));
    for (const action of keyActions('2 + 3')) {
      act(() => {
        hook.result.current.press(action);
      });
    }
    const release = api.holdNext();
    act(() => {
      hook.result.current.press({ type: 'equals' });
    });

    onCalculated = second;
    hook.rerender();
    act(() => {
      release();
    });
    await waitFor(() => {
      expect(hook.result.current.display).toBe('5');
    });

    expect(api.calls).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drops the answer of a request that finishes after unmount', async () => {
    const api = new FakeCalculatorApi();
    const calculate = vi.spyOn(api, 'calculate');
    const onCalculated = vi.fn<(record: { expression: string; result: string }) => void>();
    const hook = renderHook(() => useCalculator(api, onCalculated));
    for (const action of keyActions('2 + 3')) {
      act(() => {
        hook.result.current.press(action);
      });
    }
    const release = api.holdNext();
    act(() => {
      hook.result.current.press({ type: 'equals' });
    });
    await waitFor(() => {
      expect(calculate).toHaveBeenCalledTimes(1);
    });

    hook.unmount();
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(onCalculated).not.toHaveBeenCalled();
  });
});
