import type { Digit, KeyAction } from './types';

export type KeyVariant = 'digit' | 'operator' | 'function' | 'memory' | 'equals';

export interface KeyDefinition {
  /** Accessible name, exactly as the UI contract lists it. */
  readonly name: string;
  /** What the key shows. */
  readonly label: string;
  readonly variant: KeyVariant;
  readonly action: KeyAction;
}

function digit(value: Digit): KeyDefinition {
  return { name: value, label: value, variant: 'digit', action: { type: 'digit', digit: value } };
}

/**
 * The 28 keys in DOM order, which is also tab order. The keypad is a 4 column grid, so each
 * group of four is one row, top to bottom.
 */
export const KEYPAD_KEYS: readonly KeyDefinition[] = [
  { name: 'Memory clear', label: 'MC', variant: 'memory', action: { type: 'memoryClear' } },
  { name: 'Memory recall', label: 'MR', variant: 'memory', action: { type: 'memoryRecall' } },
  { name: 'Memory add', label: 'M+', variant: 'memory', action: { type: 'memoryAdd' } },
  { name: 'Memory subtract', label: 'M-', variant: 'memory', action: { type: 'memorySubtract' } },

  {
    name: 'Square root',
    label: '√',
    variant: 'function',
    action: { type: 'unary', operation: 'sqrt' },
  },
  {
    name: 'Reciprocal',
    label: '1/x',
    variant: 'function',
    action: { type: 'unary', operation: 'reciprocal' },
  },
  {
    name: 'Square',
    label: 'x²',
    variant: 'function',
    action: { type: 'unary', operation: 'square' },
  },
  {
    name: 'Power',
    label: 'xʸ',
    variant: 'function',
    action: { type: 'operator', operation: 'power' },
  },

  { name: 'All clear', label: 'AC', variant: 'function', action: { type: 'allClear' } },
  { name: 'Backspace', label: '⌫', variant: 'function', action: { type: 'backspace' } },
  {
    name: 'Percent',
    label: '%',
    variant: 'function',
    action: { type: 'operator', operation: 'percentage' },
  },
  {
    name: 'Divide',
    label: '÷',
    variant: 'operator',
    action: { type: 'operator', operation: 'divide' },
  },

  digit('7'),
  digit('8'),
  digit('9'),
  {
    name: 'Multiply',
    label: '×',
    variant: 'operator',
    action: { type: 'operator', operation: 'multiply' },
  },

  digit('4'),
  digit('5'),
  digit('6'),
  {
    name: 'Subtract',
    label: '-',
    variant: 'operator',
    action: { type: 'operator', operation: 'subtract' },
  },

  digit('1'),
  digit('2'),
  digit('3'),
  { name: 'Add', label: '+', variant: 'operator', action: { type: 'operator', operation: 'add' } },

  { name: 'Negate', label: '±', variant: 'function', action: { type: 'negate' } },
  digit('0'),
  { name: 'Decimal point', label: '.', variant: 'function', action: { type: 'decimal' } },
  { name: 'Equals', label: '=', variant: 'equals', action: { type: 'equals' } },
];
