import { describe, expect, it } from 'vitest';
import { play, wire } from '../test/keys';
import { expressionText } from './format';
import { calculatorReducer, initialState, MAX_DIGITS } from './reducer';
import type { CalculatorState, KeyAction } from './types';

const DIVISION_BY_ZERO = 'Division by zero is undefined.';
const NEGATIVE_ROOT = "The square root of a negative number isn't a real number.";

function expression(state: CalculatorState): string {
  return expressionText(state.pending);
}

function press(state: CalculatorState, action: KeyAction): CalculatorState {
  return calculatorReducer(state, action);
}

describe('rule 1: digit entry', () => {
  it.each([
    ['1 . 5', '1.5'],
    ['1 . . 5', '1.5'],
    ['.', '0.'],
    ['. 5', '0.5'],
    ['0 0 7', '7'],
    ['0 0', '0'],
    ['0 . 0 5', '0.05'],
    ['1 2 3 bs', '12'],
    ['5 bs', '0'],
    ['0 bs', '0'],
    ['1 2 3 ac', '0'],
    ['1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7', '123456789012345'],
  ])('%s leaves %s on screen', (keys, display) => {
    expect(play(keys).state.display).toBe(display);
  });

  it('stops at 15 digits and ignores the 16th', () => {
    const { state } = play('9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9');
    expect(state.display).toBe('9'.repeat(MAX_DIGITS));
  });

  it('counts the leading zero of 0.xxx toward the limit', () => {
    const { state } = play('. 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6');
    expect(state.display).toBe('0.12345678901234');
  });

  it('refuses a decimal point once the limit is reached', () => {
    const { state } = play('9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 .');
    expect(state.display).toBe('9'.repeat(MAX_DIGITS));
  });

  it('starts a fresh 0. when the decimal point follows a result', () => {
    expect(play('2 + 3 = .').state.display).toBe('0.');
  });

  it('keeps editing a typed number with backspace down through the sign', () => {
    expect(play('1 . 5 neg bs bs').state.display).toBe('-1');
    expect(play('1 . 5 neg bs bs bs').state.display).toBe('0');
    expect(play('5 neg bs').state.display).toBe('0');
    expect(play('0 . 5 neg bs bs').state.display).toBe('0');
  });
});

describe('rule 2: negate', () => {
  it.each([
    ['5 neg', '-5'],
    ['5 neg neg', '5'],
    ['neg', '0'],
    ['0 neg', '0'],
    ['0 . neg', '0.'],
    ['1 . 5 neg', '-1.5'],
    ['1 . 5 neg 2', '-1.52'],
  ])('%s leaves %s on screen', (keys, display) => {
    expect(play(keys).state.display).toBe(display);
  });

  it('makes no API call', () => {
    expect(play('5 neg neg neg').requests).toHaveLength(0);
  });

  it('flips a finished result, which stays finished', () => {
    const { state } = play('2 + 3 = neg');
    expect(state.display).toBe('-5');
    expect(play('2 + 3 = neg 7').state.display).toBe('7');
  });

  it('turns the number shown after an operator into the right operand', () => {
    const { state, requests } = play('2 + neg =');
    expect(wire(requests)).toEqual([{ operation: 'add', operands: [2, -2] }]);
    expect(state.display).toBe('0');
  });

  it('sends a negated right operand as a negative JSON number', () => {
    const { requests } = play('2 + 3 neg =');
    expect(wire(requests)).toEqual([{ operation: 'add', operands: [2, -3] }]);
  });
});

describe('rule 2: backspace', () => {
  it('does nothing on a result', () => {
    expect(play('2 + 3 = bs').state.display).toBe('5');
  });

  it('does nothing right after an operator', () => {
    const { state } = play('2 + bs');
    expect(state.display).toBe('2');
    expect(expression(state)).toBe('2 +');
  });
});

describe('rules 3 to 5 and 7: operators, chaining and repeat', () => {
  it.each([
    { keys: '2 + 3 +', display: '5', expr: '5 +', calls: 1 },
    { keys: '2 + 3 + 4 =', display: '9', expr: '', calls: 2 },
    { keys: '5 * 2 =', display: '10', expr: '', calls: 1 },
    { keys: '5 * 2 = =', display: '20', expr: '', calls: 2 },
    { keys: '5 * 2 = = =', display: '40', expr: '', calls: 3 },
    { keys: '5 + * 3 =', display: '15', expr: '', calls: 1 },
    { keys: '2 + 3 = 7', display: '7', expr: '', calls: 1 },
    { keys: '2 + 3 = * 4 =', display: '20', expr: '', calls: 2 },
    { keys: '=', display: '0', expr: '', calls: 0 },
    { keys: '2 +', display: '2', expr: '2 +', calls: 0 },
    { keys: '5 + =', display: '10', expr: '', calls: 1 },
    { keys: '2 + 3 = +', display: '5', expr: '5 +', calls: 1 },
    { keys: '1 0 / 4 =', display: '2.5', expr: '', calls: 1 },
    { keys: '7 - 1 0 =', display: '-3', expr: '', calls: 1 },
    { keys: '1 . 5 0 +', display: '1.50', expr: '1.5 +', calls: 0 },
  ])(
    '$keys shows $display, expression "$expr", $calls call(s)',
    ({ keys, display, expr, calls }) => {
      const { state, requests } = play(keys);
      expect(state.display).toBe(display);
      expect(expression(state)).toBe(expr);
      expect(requests).toHaveLength(calls);
    },
  );

  it('replaces a pending operator without calling the API (rule 3)', () => {
    const { state, requests } = play('5 + - * /');
    expect(requests).toHaveLength(0);
    expect(expression(state)).toBe('5 ÷');
  });

  it('sends the repeat step with the previous result as the left operand', () => {
    const { requests } = play('5 * 2 = =');
    expect(wire(requests)).toEqual([
      { operation: 'multiply', operands: [5, 2] },
      { operation: 'multiply', operands: [10, 2] },
    ]);
  });

  it('runs a chain left to right', () => {
    const { requests } = play('2 + 3 * 4 =');
    expect(wire(requests)).toEqual([
      { operation: 'add', operands: [2, 3] },
      { operation: 'multiply', operands: [5, 4] },
    ]);
  });

  it('keeps the repeat after the next number is typed', () => {
    const { state, requests } = play('2 + 3 = 7 =');
    expect(wire(requests)[1]).toEqual({ operation: 'add', operands: [7, 3] });
    expect(state.display).toBe('10');
  });

  it('uses the typed right operand for the repeat, not the left one', () => {
    const { state } = play('9 - 4 = = =');
    expect(state.display).toBe('-3');
  });

  it('writes the left operand the way JavaScript prints it', () => {
    expect(expression(play('0 . +').state)).toBe('0 +');
  });

  it.each([
    ['+', '+'],
    ['-', '-'],
    ['*', '×'],
    ['/', '÷'],
    ['^', '^'],
    ['%', '%'],
  ])('shows %s as %s in the expression line', (key, glyph) => {
    expect(expression(play(`4 ${key}`).state)).toBe(`4 ${glyph}`);
  });
});

describe('percent and power', () => {
  it('sends percentage with the percent value first', () => {
    const { state, requests } = play('1 5 % 2 0 0 =');
    expect(wire(requests)).toEqual([{ operation: 'percentage', operands: [15, 200] }]);
    expect(state.display).toBe('30');
  });

  it('sends power with the base first', () => {
    const { state, requests } = play('2 ^ 1 0 =');
    expect(wire(requests)).toEqual([{ operation: 'power', operands: [2, 10] }]);
    expect(state.display).toBe('1024');
  });
});

describe('rule 6: unary keys', () => {
  it.each<[string, string, number[], string]>([
    ['9 sqrt', 'sqrt', [9], '3'],
    ['4 recip', 'reciprocal', [4], '0.25'],
    ['5 sq', 'square', [5], '25'],
    ['3 sq sq', 'square', [9], '81'],
    ['2 sqrt', 'sqrt', [2], '1.4142135623731'],
  ])('%s sends %s with %j and shows %s', (keys, operation, operands, display) => {
    const { state, requests } = play(keys);
    expect(wire(requests).at(-1)).toEqual({ operation, operands });
    expect(state.display).toBe(display);
  });

  it('keeps a pending binary operation pending', () => {
    const { state, requests } = play('2 + 9 sqrt');
    expect(state.display).toBe('3');
    expect(expression(state)).toBe('2 +');
    expect(requests).toHaveLength(1);
  });

  it('feeds the unary result into the pending operation as its right operand', () => {
    const { state, requests } = play('2 + 9 sqrt =');
    expect(wire(requests)).toEqual([
      { operation: 'sqrt', operands: [9] },
      { operation: 'add', operands: [2, 3] },
    ]);
    expect(state.display).toBe('5');
  });

  it('acts on the number shown after an operator', () => {
    const { requests } = play('3 * sq =');
    expect(wire(requests)).toEqual([
      { operation: 'square', operands: [3] },
      { operation: 'multiply', operands: [3, 9] },
    ]);
  });

  it('starts a new number on the next digit and continues on the next operator (rule 7)', () => {
    expect(play('9 sqrt 5').state.display).toBe('5');
    const { state, requests } = play('9 sqrt + 1 =');
    expect(wire(requests).at(-1)).toEqual({ operation: 'add', operands: [3, 1] });
    expect(state.display).toBe('4');
  });

  it('applies to a finished result', () => {
    expect(play('2 + 3 = sq').state.display).toBe('25');
  });
});

describe('rule 8: memory', () => {
  it('adds the screen to memory through the API, memory first', () => {
    const { state, requests } = play('5 m+');
    expect(wire(requests)).toEqual([{ operation: 'add', operands: [0, 5] }]);
    expect(state.memory).toBe('5');
    expect(state.display).toBe('5');
  });

  it('follows the golden sequence of item 3.6', () => {
    let played = play('5 m+ 3 m+');
    expect(wire(played.requests)).toEqual([
      { operation: 'add', operands: [0, 5] },
      { operation: 'add', operands: [5, 3] },
    ]);
    expect(played.state.memory).toBe('8');

    played = play('ac mr', played.state);
    expect(played.state.display).toBe('8');

    played = play('2 m-', played.state);
    expect(wire(played.requests)).toEqual([{ operation: 'subtract', operands: [8, 2] }]);
    expect(played.state.memory).toBe('6');

    played = play('ac mr', played.state);
    expect(played.state.display).toBe('6');

    played = play('mc', played.state);
    expect(played.state.memory).toBe('0');
    expect(play('mr', played.state).state.display).toBe('0');
  });

  it('empties memory when it goes back to zero', () => {
    expect(play('5 m+ 5 m-').state.memory).toBe('0');
  });

  it('survives All clear', () => {
    expect(play('5 m+ ac').state.memory).toBe('5');
  });

  it('treats every memory key as a finished entry, so a digit starts a new number', () => {
    expect(play('5 m+ 3').state.display).toBe('3');
    expect(play('5 m+ ac mr 3').state.display).toBe('3');
    expect(play('1 2 mc 3').state.display).toBe('3');
  });

  it('recalls into the right operand of a pending operator', () => {
    const { requests } = play('5 m+ ac 2 + mr =');
    expect(wire(requests).at(-1)).toEqual({ operation: 'add', operands: [2, 5] });
  });

  it('is excluded from history by its request kind', () => {
    const { requests } = play('5 m+');
    expect(requests[0]?.after.kind).toBe('memory');
  });

  it('uses the number after an operator for memory add and leaves the operator pending', () => {
    const { state } = play('2 + m+');
    expect(state.memory).toBe('2');
    expect(expression(state)).toBe('2 +');
  });
});

describe('rule 9 and 11: errors', () => {
  it('shows the problem text and drops the pending operation', () => {
    const { state } = play('1 / 0 =');
    expect(state.error).toBe(DIVISION_BY_ZERO);
    expect(state.pending).toBeNull();
    expect(state.repeat).toBeNull();
    expect(state.request).toBeNull();
  });

  it('reports a negative square root', () => {
    expect(play('4 neg sqrt').state.error).toBe(NEGATIVE_ROOT);
  });

  it('reports the reciprocal of zero', () => {
    expect(play('0 recip').state.error).toBe(DIVISION_BY_ZERO);
  });

  it('shows the message of a failed chain step', () => {
    const { state, requests } = play('1 / 0 +');
    expect(requests).toHaveLength(1);
    expect(state.error).toBe(DIVISION_BY_ZERO);
    expect(state.pending).toBeNull();
  });

  it('drops a pending operation when a unary key fails', () => {
    const { state } = play('2 + 0 recip');
    expect(state.error).toBe(DIVISION_BY_ZERO);
    expect(state.pending).toBeNull();
  });

  it.each<[string, KeyAction]>([
    ['an operator', { type: 'operator', operation: 'add' }],
    ['equals', { type: 'equals' }],
    ['a unary key', { type: 'unary', operation: 'square' }],
    ['negate', { type: 'negate' }],
    ['memory recall', { type: 'memoryRecall' }],
    ['memory add', { type: 'memoryAdd' }],
    ['memory subtract', { type: 'memorySubtract' }],
    ['a history pick', { type: 'pick', value: '20' }],
  ])('ignores %s in the error state', (_name, action) => {
    const errored = play('1 / 0 =').state;
    expect(press(errored, action)).toBe(errored);
  });

  it('clears the error when a digit starts a fresh number', () => {
    const { state } = play('1 / 0 = 5');
    expect(state.error).toBeNull();
    expect(state.display).toBe('5');
  });

  it('clears the error when the decimal point starts a fresh number', () => {
    const { state } = play('1 / 0 = .');
    expect(state.error).toBeNull();
    expect(state.display).toBe('0.');
  });

  it('clears the error on backspace', () => {
    const { state } = play('1 / 0 = bs');
    expect(state.error).toBeNull();
    expect(state.display).toBe('0');
  });

  it('clears the error on All clear', () => {
    const { state } = play('1 / 0 = ac');
    expect(state).toEqual(initialState);
  });

  it('lets Memory clear act without clearing the error', () => {
    const { state } = play('5 m+ 1 / 0 = mc');
    expect(state.memory).toBe('0');
    expect(state.error).toBe(DIVISION_BY_ZERO);
  });

  it('keeps memory through an error', () => {
    expect(play('5 m+ 1 / 0 =').state.memory).toBe('5');
  });

  it('lets the next calculation succeed', () => {
    const { state } = play('1 / 0 = 5 + 3 =');
    expect(state.display).toBe('8');
    expect(state.error).toBeNull();
  });

  it('forgets the repeat step so Equals does nothing afterwards', () => {
    const { state, requests } = play('2 * 3 = 1 / 0 = 5 =');
    expect(state.display).toBe('5');
    expect(requests).toHaveLength(2);
  });

  it('ignores a failure that has no request', () => {
    const state = calculatorReducer(initialState, { type: 'failed', message: 'late' });
    expect(state).toBe(initialState);
  });
});

describe('rule 10: requests in flight', () => {
  const inFlight = press(play('2 + 3').state, { type: 'equals' });

  it('stores the request and nothing else changes', () => {
    expect(inFlight.request).toMatchObject({ operation: 'add', operands: [2, 3] });
  });

  it.each<[string, KeyAction]>([
    ['a digit', { type: 'digit', digit: '5' }],
    ['the decimal point', { type: 'decimal' }],
    ['negate', { type: 'negate' }],
    ['backspace', { type: 'backspace' }],
    ['All clear', { type: 'allClear' }],
    ['an operator', { type: 'operator', operation: 'multiply' }],
    ['a unary key', { type: 'unary', operation: 'sqrt' }],
    ['equals', { type: 'equals' }],
    ['memory clear', { type: 'memoryClear' }],
    ['memory recall', { type: 'memoryRecall' }],
    ['memory add', { type: 'memoryAdd' }],
    ['memory subtract', { type: 'memorySubtract' }],
    ['a history pick', { type: 'pick', value: '7' }],
  ])('ignores %s', (_name, action) => {
    expect(press(inFlight, action)).toBe(inFlight);
  });

  it('settles on the result', () => {
    const settled = calculatorReducer(inFlight, { type: 'resolved', result: 5 });
    expect(settled.display).toBe('5');
    expect(settled.request).toBeNull();
  });

  it('settles on a failure', () => {
    const settled = calculatorReducer(inFlight, { type: 'failed', message: 'down' });
    expect(settled.error).toBe('down');
    expect(settled.request).toBeNull();
  });

  it('ignores a result that nobody asked for', () => {
    const state = calculatorReducer(initialState, { type: 'resolved', result: 3 });
    expect(state).toBe(initialState);
  });
});

describe('rule 13: picking a history entry', () => {
  it('puts the result on screen as a finished number', () => {
    const picked = press(initialState, { type: 'pick', value: '20' });
    expect(picked.display).toBe('20');
    expect(calculatorReducer(picked, { type: 'digit', digit: '7' }).display).toBe('7');
  });

  it('continues from the picked number with an operator', () => {
    const picked = press(play('2 + 3 =').state, { type: 'pick', value: '20' });
    const { requests } = play('+ 1 =', picked);
    expect(wire(requests)).toEqual([{ operation: 'add', operands: [20, 1] }]);
  });

  it('becomes the right operand of a pending operator', () => {
    const picked = press(play('2 +').state, { type: 'pick', value: '20' });
    const { requests } = play('=', picked);
    expect(wire(requests)).toEqual([{ operation: 'add', operands: [2, 20] }]);
  });

  it.each(['', '  ', 'abc', 'Infinity', 'NaN'])('ignores the stored text "%s"', (value) => {
    expect(press(initialState, { type: 'pick', value })).toBe(initialState);
  });

  it('accepts exponent text', () => {
    expect(press(initialState, { type: 'pick', value: '1e+21' }).display).toBe('1e+21');
  });
});

describe('All clear', () => {
  it('resets the display, pending operation and repeat but not memory', () => {
    const { state } = play('5 m+ 2 * 3 = ac');
    expect(state).toEqual({ ...initialState, memory: '5' });
  });

  it('removes the repeat step', () => {
    const { requests } = play('5 * 2 = ac =');
    expect(requests).toHaveLength(1);
  });
});

describe('purity', () => {
  it('does not change the state it is given', () => {
    const before = play('2 + 3').state;
    const snapshot = structuredClone(before);
    calculatorReducer(before, { type: 'digit', digit: '4' });
    calculatorReducer(before, { type: 'equals' });
    calculatorReducer(before, { type: 'negate' });
    expect(before).toEqual(snapshot);
  });

  it('gives the same answer for the same input', () => {
    const state = play('2 + 3').state;
    const action: KeyAction = { type: 'equals' };
    expect(calculatorReducer(state, action)).toEqual(calculatorReducer(state, action));
  });
});
