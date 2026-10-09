import { describe, expect, it } from 'vitest';
import { actionForKey } from './keymap';
import type { KeyAction } from './types';

describe('actionForKey', () => {
  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const)(
    'maps %s to a digit',
    (key) => {
      expect(actionForKey(key)).toEqual({ type: 'digit', digit: key });
    },
  );

  it.each([
    ['+', 'add'],
    ['-', 'subtract'],
    ['*', 'multiply'],
    ['/', 'divide'],
    ['^', 'power'],
    ['%', 'percentage'],
  ] as const)('maps %s to the %s operator', (key, operation) => {
    expect(actionForKey(key)).toEqual({ type: 'operator', operation });
  });

  it.each([
    ['.', { type: 'decimal' }],
    [',', { type: 'decimal' }],
    ['Enter', { type: 'equals' }],
    ['=', { type: 'equals' }],
    ['Escape', { type: 'allClear' }],
    ['Backspace', { type: 'backspace' }],
  ] as [string, KeyAction][])('maps %s to %j', (key, action) => {
    expect(actionForKey(key)).toEqual(action);
  });

  it.each(['a', 'x', 'Tab', 'Shift', 'ArrowUp', ' ', '', '10', 'F5', 'Delete'])(
    'ignores %j',
    (key) => {
      expect(actionForKey(key)).toBeNull();
    },
  );
});
