import type { BinaryOperation, Digit, KeyAction } from './types';

const DIGITS = '0123456789';

const OPERATOR_KEYS: ReadonlyMap<string, BinaryOperation> = new Map<string, BinaryOperation>([
  ['+', 'add'],
  ['-', 'subtract'],
  ['*', 'multiply'],
  ['/', 'divide'],
  ['^', 'power'],
  ['%', 'percentage'],
]);

function isDigit(key: string): key is Digit {
  return key.length === 1 && DIGITS.includes(key);
}

/**
 * Maps `KeyboardEvent.key` to a calculator action, or null when the key means nothing here.
 * A comma types the decimal point too, for keyboards and locales that use it.
 */
export function actionForKey(key: string): KeyAction | null {
  if (isDigit(key)) return { type: 'digit', digit: key };

  const operation = OPERATOR_KEYS.get(key);
  if (operation) return { type: 'operator', operation };

  switch (key) {
    case '.':
    case ',':
      return { type: 'decimal' };
    case 'Enter':
    case '=':
      return { type: 'equals' };
    case 'Escape':
      return { type: 'allClear' };
    case 'Backspace':
      return { type: 'backspace' };
    default:
      return null;
  }
}
