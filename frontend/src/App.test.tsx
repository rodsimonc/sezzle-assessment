import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { networkError, problemError, unexpectedResponseError } from './api/problem';
import { HISTORY_KEY, type HistoryEntry } from './history/storage';
import { FakeCalculatorApi } from './test/fakeApi';

const DIVISION_BY_ZERO = 'Division by zero is undefined.';
const NEGATIVE_ROOT = "The square root of a negative number isn't a real number.";

type User = ReturnType<typeof userEvent.setup>;

interface Session {
  api: FakeCalculatorApi;
  user: User;
  /** Clicks each key by accessible name and waits for the keypad to settle after each one. */
  press: (...names: string[]) => Promise<void>;
  /** Unmounts the page and mounts a fresh one, as a browser reload does. */
  reload: () => void;
}

function start(api = new FakeCalculatorApi()): Session {
  const user = userEvent.setup();
  let view = render(<App api={api} />);
  return {
    api,
    user,
    async press(...names) {
      for (const name of names) {
        await user.click(screen.getByRole('button', { name }));
        await settled();
      }
    },
    reload() {
      view.unmount();
      view = render(<App api={api} />);
    },
  };
}

async function settled(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('keypad')).not.toHaveAttribute('aria-busy', 'true');
  });
}

function display(): string {
  return screen.getByTestId('display').textContent;
}

function expressionLine(): string {
  return screen.getByTestId('expression').textContent;
}

function historyTexts(): string[] {
  return screen.queryAllByRole('listitem').map((item) => item.textContent);
}

function storedHistory(): HistoryEntry[] {
  return JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]') as HistoryEntry[];
}

function seeded(count: number): HistoryEntry[] {
  return Array.from({ length: count }, (_value, index) => ({
    expression: `${index} + 1`,
    result: String(index + 1),
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 59 - (index % 60))).toISOString(),
  }));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('first render', () => {
  it('shows 0, an empty expression, the empty history and nothing else', () => {
    start();

    expect(display()).toBe('0');
    expect(expressionLine()).toBe('');
    expect(screen.getByText('No calculations yet.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('memory-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('keypad')).not.toHaveAttribute('aria-busy', 'true');
  });

  it('has one main, one h1 and the display inside a polite status region', () => {
    const { container } = render(<App api={new FakeCalculatorApi()} />);

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(within(status).getByTestId('display')).toBeInTheDocument();
  });

  it('names every button from the UI contract and nothing else', () => {
    start();

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    const keys = [
      ...'0123456789'.split(''),
      'Decimal point',
      'Add',
      'Subtract',
      'Multiply',
      'Divide',
      'Power',
      'Percent',
      'Square root',
      'Reciprocal',
      'Square',
      'Negate',
      'Equals',
      'All clear',
      'Backspace',
      'Memory clear',
      'Memory recall',
      'Memory add',
      'Memory subtract',
    ];
    expect([...names].sort()).toEqual([...keys, 'History', 'Clear history'].sort());
  });

  it('uses no inline style attribute and no inline script', () => {
    const { container } = render(<App api={new FakeCalculatorApi()} />);

    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    expect(container.querySelectorAll('script')).toHaveLength(0);
  });
});

describe('3.1 keypad entry', () => {
  it.each([
    [['2', 'Add', '3', 'Equals'], { operation: 'add', operands: [2, 3] }, '5', '2 + 3 = 5'],
    [
      ['7', 'Subtract', '1', '0', 'Equals'],
      { operation: 'subtract', operands: [7, 10] },
      '-3',
      '7 - 10 = -3',
    ],
    [
      ['6', 'Multiply', '7', 'Equals'],
      { operation: 'multiply', operands: [6, 7] },
      '42',
      '6 × 7 = 42',
    ],
    [
      ['1', '0', 'Divide', '4', 'Equals'],
      { operation: 'divide', operands: [10, 4] },
      '2.5',
      '10 ÷ 4 = 2.5',
    ],
  ])('%j sends %j, shows %s and logs %s', async (keys, body, shown, entry) => {
    const { api, press } = start();

    await press(...keys);

    expect(api.calls).toEqual([body]);
    expect(display()).toBe(shown);
    expect(historyTexts()).toEqual([entry]);
    expect(expressionLine()).toBe('');
  });

  it('shows the pending expression after an operator', async () => {
    const { press, api } = start();

    await press('2', 'Add');

    expect(expressionLine()).toBe('2 +');
    expect(display()).toBe('2');
    expect(api.calls).toEqual([]);
  });
});

describe('3.2 decimals and editing', () => {
  it.each([
    [['1', 'Decimal point', '5'], '1.5'],
    [['1', 'Decimal point', 'Decimal point', '5'], '1.5'],
    [['Decimal point'], '0.'],
    [['Decimal point', '5'], '0.5'],
    [['0', '0', '7'], '7'],
    [['0', '0'], '0'],
    [['1', '2', '3', 'Backspace'], '12'],
    [['5', 'Backspace'], '0'],
    [['5', 'Negate'], '-5'],
    [['5', 'Negate', 'Negate'], '5'],
    [['Negate'], '0'],
    [['1', '2', '3', 'All clear'], '0'],
    [Array.from({ length: 16 }, () => '9'), '9'.repeat(15)],
    [['2', 'Add', '3', 'Equals', 'Backspace'], '5'],
  ])('%j leaves %s on screen', async (keys, shown) => {
    const { press } = start();

    await press(...keys);

    expect(display()).toBe(shown);
  });

  it('makes no API call for editing keys', async () => {
    const { press, api } = start();

    await press('1', '2', '3', 'Backspace', 'Negate', 'Decimal point', '5', 'All clear');

    expect(api.calls).toEqual([]);
  });

  it('clears the expression with All clear', async () => {
    const { press } = start();

    await press('1', '2', 'Add', '3', 'All clear');

    expect(expressionLine()).toBe('');
    expect(display()).toBe('0');
  });
});

describe('3.3 chained and repeated operations', () => {
  it.each([
    [['2', 'Add', '3', 'Add'], '5', 1],
    [['2', 'Add', '3', 'Add', '4', 'Equals'], '9', 2],
    [['5', 'Multiply', '2', 'Equals'], '10', 1],
    [['5', 'Multiply', '2', 'Equals', 'Equals'], '20', 2],
    [['5', 'Multiply', '2', 'Equals', 'Equals', 'Equals'], '40', 3],
    [['5', 'Add', 'Multiply', '3', 'Equals'], '15', 1],
    [['2', 'Add', '3', 'Equals', '7'], '7', 1],
    [['2', 'Add', '3', 'Equals', 'Multiply', '4', 'Equals'], '20', 2],
    [['Equals'], '0', 0],
  ])('%j shows %s after %i API calls', async (keys, shown, calls) => {
    const { press, api } = start();

    await press(...keys);

    expect(display()).toBe(shown);
    expect(api.calls).toHaveLength(calls);
  });

  it('shows the running total in the expression after a chained operator', async () => {
    const { press } = start();

    await press('2', 'Add', '3', 'Add');

    expect(expressionLine()).toBe('5 +');
  });

  it('repeats with the last right operand against the number on screen', async () => {
    const { press, api } = start();

    await press('5', 'Multiply', '2', 'Equals', 'Equals');

    expect(api.calls[1]).toEqual({ operation: 'multiply', operands: [10, 2] });
  });
});

describe('3.4 unary and percentage keys', () => {
  it.each([
    [['9', 'Square root'], { operation: 'sqrt', operands: [9] }, '3', '√(9) = 3'],
    [['4', 'Reciprocal'], { operation: 'reciprocal', operands: [4] }, '0.25', '1/(4) = 0.25'],
    [['5', 'Square'], { operation: 'square', operands: [5] }, '25', '(5)² = 25'],
    [
      ['1', '5', 'Percent', '2', '0', '0', 'Equals'],
      { operation: 'percentage', operands: [15, 200] },
      '30',
      '15 % 200 = 30',
    ],
    [
      ['2', 'Power', '1', '0', 'Equals'],
      { operation: 'power', operands: [2, 10] },
      '1024',
      '2 ^ 10 = 1024',
    ],
    [['3', 'Square', 'Square'], { operation: 'square', operands: [9] }, '81', '(9)² = 81'],
    [
      ['2', 'Add', '9', 'Square root', 'Equals'],
      { operation: 'add', operands: [2, 3] },
      '5',
      '2 + 3 = 5',
    ],
  ])('%j ends with %j, shows %s and logs %s', async (keys, last, shown, entry) => {
    const { press, api } = start();

    await press(...keys);

    expect(api.calls.at(-1)).toEqual(last);
    expect(display()).toBe(shown);
    expect(historyTexts()[0]).toBe(entry);
  });

  it('keeps the pending operation after a unary key', async () => {
    const { press } = start();

    await press('2', 'Add', '9', 'Square root');

    expect(expressionLine()).toBe('2 +');
  });
});

describe('3.5 error handling', () => {
  it('shows Error and the API detail for a division by zero, with no history entry', async () => {
    const { press } = start();

    await press('1', 'Divide', '0', 'Equals');

    expect(display()).toBe('Error');
    expect(screen.getByRole('alert')).toHaveTextContent(DIVISION_BY_ZERO);
    expect(historyTexts()).toEqual([]);
    expect(screen.getByText('No calculations yet.')).toBeInTheDocument();
  });

  it('ignores operator keys in the error state', async () => {
    const { press, api } = start();
    await press('1', 'Divide', '0', 'Equals');

    await press('Add', 'Equals', 'Square', 'Negate', 'Memory add', 'Memory recall', 'Percent');

    expect(display()).toBe('Error');
    expect(screen.getByRole('alert')).toHaveTextContent(DIVISION_BY_ZERO);
    expect(api.calls).toHaveLength(1);
  });

  it('clears the alert and starts a fresh number when a digit is pressed', async () => {
    const { press } = start();
    await press('1', 'Divide', '0', 'Equals');

    await press('5');

    expect(display()).toBe('5');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the alert with All clear', async () => {
    const { press } = start();
    await press('1', 'Divide', '0', 'Equals');

    await press('All clear');

    expect(display()).toBe('0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the alert for the square root of a negative number', async () => {
    const { press } = start();

    await press('4', 'Negate', 'Square root');

    expect(display()).toBe('Error');
    expect(screen.getByRole('alert')).toHaveTextContent(NEGATIVE_ROOT);
  });

  it('shows the alert for the reciprocal of zero', async () => {
    const { press } = start();

    await press('0', 'Reciprocal');

    expect(screen.getByRole('alert')).toHaveTextContent(DIVISION_BY_ZERO);
  });

  it.each([
    [
      'a network failure',
      networkError(),
      "Can't reach the calculator service. Check your connection and try again.",
    ],
    [
      'a 500 Problem Details body',
      problemError({
        status: 500,
        detail: 'Something went wrong on our side. Quote the request id if you report it.',
        code: 'INTERNAL_ERROR',
      }),
      'Something went wrong on our side. Quote the request id if you report it.',
    ],
    [
      'a 502 HTML page',
      unexpectedResponseError(),
      'The calculator service returned an unexpected response.',
    ],
  ])('shows Error and the right text for %s, then recovers', async (_name, failure, text) => {
    const { press, api } = start();
    api.failNext(failure);

    await press('2', 'Add', '3', 'Equals');

    expect(display()).toBe('Error');
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(historyTexts()).toEqual([]);

    await press('All clear', '2', 'Add', '3', 'Equals');
    expect(display()).toBe('5');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(historyTexts()).toEqual(['2 + 3 = 5']);
  });

  it('keeps memory through an error and lets Memory clear act in the error state', async () => {
    const { press } = start();
    await press('5', 'Memory add', 'All clear', '1', 'Divide', '0', 'Equals');
    expect(screen.getByTestId('memory-indicator')).toBeInTheDocument();

    await press('Memory clear');

    expect(screen.queryByTestId('memory-indicator')).not.toBeInTheDocument();
    expect(display()).toBe('Error');
  });
});

describe('rule 10: requests in flight', () => {
  it('marks the keypad busy and ignores every key until the answer arrives', async () => {
    const { api, user } = start();
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    const release = api.holdNext();

    await user.click(screen.getByRole('button', { name: 'Equals' }));
    await waitFor(() => {
      expect(screen.getByTestId('keypad')).toHaveAttribute('aria-busy', 'true');
    });
    await user.click(screen.getByRole('button', { name: 'Equals' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: '9' }));
    await user.keyboard('{Enter}7');
    expect(api.calls).toHaveLength(1);

    release();
    await settled();

    expect(display()).toBe('8');
    expect(api.calls).toHaveLength(1);
    expect(historyTexts()).toEqual(['5 + 3 = 8']);
  });
});

describe('3.6 memory keys', () => {
  it('follows the golden sequence', async () => {
    const { press, api } = start();

    await press('5', 'Memory add');
    expect(screen.getByTestId('memory-indicator')).toHaveTextContent('M');
    expect(display()).toBe('5');
    expect(api.calls.at(-1)).toEqual({ operation: 'add', operands: [0, 5] });

    await press('3', 'Memory add');
    expect(api.calls.at(-1)).toEqual({ operation: 'add', operands: [5, 3] });

    await press('All clear', 'Memory recall');
    expect(display()).toBe('8');

    await press('2', 'Memory subtract');
    expect(api.calls.at(-1)).toEqual({ operation: 'subtract', operands: [8, 2] });

    await press('All clear', 'Memory recall');
    expect(display()).toBe('6');

    await press('Memory clear');
    expect(screen.queryByTestId('memory-indicator')).not.toBeInTheDocument();

    await press('Memory recall');
    expect(display()).toBe('0');
  });

  it('drops the indicator when memory returns to zero', async () => {
    const { press } = start();

    await press('5', 'Memory add', '5', 'Memory subtract');

    expect(screen.queryByTestId('memory-indicator')).not.toBeInTheDocument();
  });

  it('adds no history entry', async () => {
    const { press } = start();

    await press('5', 'Memory add', 'Memory recall', 'Memory subtract', 'Memory clear');

    expect(historyTexts()).toEqual([]);
  });

  it('starts a new number after Memory recall', async () => {
    const { press } = start();

    await press('8', 'Memory add', 'All clear', 'Memory recall', '4');

    expect(display()).toBe('4');
  });

  it('resets on reload', async () => {
    const session = start();
    await session.press('5', 'Memory add');
    expect(screen.getByTestId('memory-indicator')).toBeInTheDocument();

    session.reload();

    expect(screen.queryByTestId('memory-indicator')).not.toBeInTheDocument();
  });
});

describe('3.7 history', () => {
  it('lists calculations newest first and keeps them after a reload', async () => {
    const session = start();

    await session.press('2', 'Add', '3', 'Equals', '4', 'Multiply', '5', 'Equals');
    expect(historyTexts()).toEqual(['4 × 5 = 20', '2 + 3 = 5']);

    session.reload();
    expect(historyTexts()).toEqual(['4 × 5 = 20', '2 + 3 = 5']);
  });

  it('stores a JSON array of expression, result and ISO 8601 timestamp', async () => {
    const { press } = start();

    await press('2', 'Add', '3', 'Equals');

    const stored = storedHistory();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({
      expression: '2 + 3',
      result: '5',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) as string,
    });
    expect(Number.isNaN(Date.parse(stored[0]?.timestamp ?? ''))).toBe(false);
  });

  it('continues from a clicked entry as a finished number', async () => {
    const { press, user } = start();
    await press('2', 'Add', '3', 'Equals', '4', 'Multiply', '5', 'Equals');

    await user.click(screen.getByRole('button', { name: '4 × 5 = 20' }));
    expect(display()).toBe('20');
    await press('Add', '1', 'Equals');

    expect(display()).toBe('21');
  });

  it('starts a new number when a digit follows a clicked entry', async () => {
    const { press, user } = start();
    await press('2', 'Add', '3', 'Equals');

    await user.click(screen.getByRole('button', { name: '2 + 3 = 5' }));
    await press('7');

    expect(display()).toBe('7');
  });

  it('empties with Clear history and stays empty after a reload', async () => {
    const session = start();
    await session.press('2', 'Add', '3', 'Equals');

    await session.press('Clear history');
    expect(historyTexts()).toEqual([]);
    expect(screen.getByText('No calculations yet.')).toBeInTheDocument();
    expect(storedHistory()).toEqual([]);

    session.reload();
    expect(historyTexts()).toEqual([]);
    expect(screen.getByText('No calculations yet.')).toBeInTheDocument();
  });

  it('keeps 50 entries when one more arrives, newest first, oldest gone', async () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(seeded(50)));
    const { press } = start();
    expect(historyTexts()).toHaveLength(50);

    await press('1', 'Add', '1', 'Equals');

    const texts = historyTexts();
    expect(texts).toHaveLength(50);
    expect(texts[0]).toBe('1 + 1 = 2');
    expect(texts).toContain('48 + 1 = 49');
    expect(texts).not.toContain('49 + 1 = 50');
    expect(storedHistory()).toHaveLength(50);
  });

  it('loads and shows the empty state when the stored value is not JSON', () => {
    window.localStorage.setItem(HISTORY_KEY, 'not json');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    start();

    expect(screen.getByText('No calculations yet.')).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('keeps working when localStorage throws on every access', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied.', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Access denied.', 'SecurityError');
    });
    const { press } = start();
    // The in-memory fallback is module state that earlier tests may have filled.
    await press('Clear history');
    expect(screen.getByText('No calculations yet.')).toBeInTheDocument();

    await press('2', 'Add', '3', 'Equals');

    expect(display()).toBe('5');
    expect(historyTexts()).toEqual(['2 + 3 = 5']);
  });

  it('adds nothing for errors or memory keys, and one entry for a unary key', async () => {
    const { press } = start();

    await press('1', 'Divide', '0', 'Equals', 'All clear', '5', 'Memory add', 'Memory recall');
    expect(historyTexts()).toEqual([]);

    await press('9', 'Square root');
    expect(historyTexts()).toEqual(['√(9) = 3']);
  });

  it('toggles the disclosure button under 768 px with aria-expanded', async () => {
    const { user } = start();
    const toggle = screen.getByRole('button', { name: 'History' });
    const section = screen.getByRole('region', { name: 'History' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(section).toHaveAttribute('data-open', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(section).toHaveAttribute('data-open', 'true');
  });
});

describe('3.8 keyboard input', () => {
  it.each([
    ['2+3{Enter}', '5'],
    ['2*3=', '6'],
    ['9/3{Enter}', '3'],
    ['2^3{Enter}', '8'],
    ['15%200{Enter}', '30'],
    ['7-10{Enter}', '-3'],
    ['1.5', '1.5'],
    ['123{Backspace}', '12'],
    ['123{Escape}', '0'],
  ])('typing %s shows %s', async (typed, shown) => {
    const { user } = start();

    await user.keyboard(typed);
    await settled();

    expect(display()).toBe(shown);
  });

  it('evaluates once when Enter follows a click on a key, without pressing the key again', async () => {
    const { press, user, api } = start();
    await press('2', 'Add', '5');
    expect(screen.getByRole('button', { name: '5' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await settled();

    expect(display()).toBe('7');
    expect(api.calls).toEqual([{ operation: 'add', operands: [2, 5] }]);
  });

  it('prevents the default for handled keys only', async () => {
    const { user } = start();
    const outcomes: [string, boolean][] = [];
    const record = (event: KeyboardEvent): void => {
      outcomes.push([event.key, event.defaultPrevented]);
    };
    window.addEventListener('keydown', record);

    await user.keyboard('5a{Control>}r{/Control}');
    window.removeEventListener('keydown', record);

    expect(outcomes.filter(([key]) => ['5', 'a', 'r'].includes(key))).toEqual([
      ['5', true],
      ['a', false],
      ['r', false],
    ]);
  });

  it('leaves Ctrl+C and Ctrl+R alone', async () => {
    const { user } = start();

    await user.keyboard('{Control>}c{/Control}{Control>}r{/Control}{Control>}5{/Control}');

    expect(display()).toBe('0');
  });

  it('lets Enter activate a focused history entry instead of pressing Equals', async () => {
    const { press, user, api } = start();
    await press('2', 'Add', '3', 'Equals', '9');
    expect(display()).toBe('9');

    screen.getByRole('button', { name: '2 + 3 = 5' }).focus();
    await user.keyboard('{Enter}');

    expect(display()).toBe('5');
    expect(api.calls).toHaveLength(1);
  });

  it('lets Enter toggle the focused History disclosure', async () => {
    const { user, api } = start();
    const toggle = screen.getByRole('button', { name: 'History' });
    toggle.focus();

    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(api.calls).toEqual([]);
  });
});
