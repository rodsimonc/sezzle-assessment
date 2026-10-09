import { describe, expect, it } from 'vitest';
import {
  canonicalNumber,
  displaySize,
  expressionText,
  formatNumber,
  historyExpression,
  historyLabel,
  isNumericText,
  OPERATOR_GLYPHS,
} from './format';
import type { PendingRequest } from './types';

describe('formatNumber', () => {
  it.each([
    [5, '5'],
    [-3, '-3'],
    [2.5, '2.5'],
    [0.3, '0.3'],
    [0, '0'],
    [-0, '0'],
    [1e21, '1e+21'],
    [5e-7, '5e-7'],
  ])('writes %s as %s', (value, text) => {
    expect(formatNumber(value)).toBe(text);
  });
});

describe('canonicalNumber', () => {
  it.each([
    ['0.', '0'],
    ['1.50', '1.5'],
    ['-0', '0'],
    ['007', '7'],
    ['-5.', '-5'],
  ])('rewrites %s as %s', (typed, canonical) => {
    expect(canonicalNumber(typed)).toBe(canonical);
  });
});

describe('isNumericText', () => {
  it.each(['5', '-1.5', '0.', '1e+21', ' 7 '])('accepts %j', (text) => {
    expect(isNumericText(text)).toBe(true);
  });

  it.each(['', '   ', 'abc', 'Infinity', '-Infinity', 'NaN', '1,5'])('rejects %j', (text) => {
    expect(isNumericText(text)).toBe(false);
  });
});

describe('expressionText', () => {
  it('is empty when nothing is pending', () => {
    expect(expressionText(null)).toBe('');
  });

  it.each([
    ['add', '2 +'],
    ['subtract', '2 -'],
    ['multiply', '2 ×'],
    ['divide', '2 ÷'],
    ['power', '2 ^'],
    ['percentage', '2 %'],
  ] as const)('shows %s as "%s"', (operator, text) => {
    expect(expressionText({ left: '2', operator, awaitingRight: true })).toBe(text);
  });

  it('uses the six glyphs of the UI contract', () => {
    expect(Object.values(OPERATOR_GLYPHS)).toEqual(['+', '-', '×', '÷', '^', '%']);
  });
});

describe('historyExpression', () => {
  const unary = (operation: 'sqrt' | 'reciprocal' | 'square', value: number): PendingRequest => ({
    arity: 1,
    operation,
    operands: [value],
    after: { kind: 'unary' },
  });

  it.each([
    [unary('sqrt', 9), '√(9)'],
    [unary('reciprocal', 4), '1/(4)'],
    [unary('square', 5), '(5)²'],
    [unary('square', -2.5), '(-2.5)²'],
  ])('writes unary call %#', (request, text) => {
    expect(historyExpression(request)).toBe(text);
  });

  it('writes a binary call with its operator glyph', () => {
    const request: PendingRequest = {
      arity: 2,
      operation: 'percentage',
      operands: [15, 200],
      after: { kind: 'chain', next: 'add' },
    };
    expect(historyExpression(request)).toBe('15 % 200');
  });

  it('writes operands in canonical form', () => {
    const request: PendingRequest = {
      arity: 2,
      operation: 'subtract',
      operands: [7, -10],
      after: { kind: 'memory' },
    };
    expect(historyExpression(request)).toBe('7 - -10');
  });
});

describe('historyLabel', () => {
  it('joins expression and result with an equals sign', () => {
    expect(historyLabel({ expression: '2 + 3', result: '5' })).toBe('2 + 3 = 5');
  });
});

describe('displaySize', () => {
  it.each([
    ['0', 'lg'],
    ['123456789', 'lg'],
    ['1234567890', 'md'],
    ['123456789012', 'md'],
    ['1234567890123', 'sm'],
    ['1234567890123456', 'sm'],
    ['12345678901234567', 'xs'],
    ['-0.333333333333333', 'xs'],
  ])('sizes %s as %s', (text, size) => {
    expect(displaySize(text)).toBe(size);
  });
});
