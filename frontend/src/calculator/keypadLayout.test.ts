import { describe, expect, it } from 'vitest';
import { KEYPAD_KEYS } from './keypadLayout';

/** The accessible names and visible labels from the UI contract table. */
const CONTRACT: readonly (readonly [string, string])[] = [
  ['0', '0'],
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['4', '4'],
  ['5', '5'],
  ['6', '6'],
  ['7', '7'],
  ['8', '8'],
  ['9', '9'],
  ['Decimal point', '.'],
  ['Add', '+'],
  ['Subtract', '-'],
  ['Multiply', '×'],
  ['Divide', '÷'],
  ['Power', 'xʸ'],
  ['Percent', '%'],
  ['Square root', '√'],
  ['Reciprocal', '1/x'],
  ['Square', 'x²'],
  ['Negate', '±'],
  ['Equals', '='],
  ['All clear', 'AC'],
  ['Backspace', '⌫'],
  ['Memory clear', 'MC'],
  ['Memory recall', 'MR'],
  ['Memory add', 'M+'],
  ['Memory subtract', 'M-'],
];

describe('KEYPAD_KEYS', () => {
  it('holds exactly the 28 keys of the UI contract, with their names and labels', () => {
    const actual = KEYPAD_KEYS.map((key) => `${key.name}|${key.label}`).sort();
    const expected = CONTRACT.map(([name, label]) => `${name}|${label}`).sort();
    expect(actual).toHaveLength(28);
    expect(actual).toEqual(expected);
  });

  it('gives every key a distinct accessible name', () => {
    expect(new Set(KEYPAD_KEYS.map((key) => key.name)).size).toBe(KEYPAD_KEYS.length);
  });

  it('fills a 4 column grid with 7 full rows', () => {
    expect(KEYPAD_KEYS.length).toBe(4 * 7);
  });

  it('wires each digit key to its own digit', () => {
    const digits = KEYPAD_KEYS.filter((key) => key.variant === 'digit');
    expect(digits).toHaveLength(10);
    for (const key of digits) {
      expect(key.action).toEqual({ type: 'digit', digit: key.name });
    }
  });

  it.each([
    ['Add', { type: 'operator', operation: 'add' }],
    ['Power', { type: 'operator', operation: 'power' }],
    ['Percent', { type: 'operator', operation: 'percentage' }],
    ['Square root', { type: 'unary', operation: 'sqrt' }],
    ['Reciprocal', { type: 'unary', operation: 'reciprocal' }],
    ['Square', { type: 'unary', operation: 'square' }],
    ['Equals', { type: 'equals' }],
    ['Memory subtract', { type: 'memorySubtract' }],
  ])('wires %s to %j', (name, action) => {
    expect(KEYPAD_KEYS.find((key) => key.name === name)?.action).toEqual(action);
  });
});
