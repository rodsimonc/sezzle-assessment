import type { BinaryOperation, CalculationRecord, PendingOperation, PendingRequest } from './types';

/** Glyphs for the expression line and history. The keypad labels live in keypadLayout.ts. */
export const OPERATOR_GLYPHS: Readonly<Record<BinaryOperation, string>> = {
  add: '+',
  subtract: '-',
  multiply: '×',
  divide: '÷',
  power: '^',
  percentage: '%',
};

/**
 * Shortest round-trip text for a number. JavaScript switches to exponent form on its own
 * (`1e+21`, `5e-7`), and `String(-0)` is `0`.
 */
export function formatNumber(value: number): string {
  return String(value);
}

/** Re-writes typed text such as `0.` or `1.50` the way formatNumber would print it. */
export function canonicalNumber(text: string): string {
  return formatNumber(Number(text));
}

/** True when `text` reads as a finite number. Guards values that come back from storage. */
export function isNumericText(text: string): boolean {
  return text.trim() !== '' && Number.isFinite(Number(text));
}

/** The pending expression, such as `2 +` or `15 %`. Empty when nothing is pending. */
export function expressionText(pending: PendingOperation | null): string {
  return pending ? `${pending.left} ${OPERATOR_GLYPHS[pending.operator]}` : '';
}

/** The left side of a history entry, such as `2 + 3`, `√(9)` or `(5)²`. */
export function historyExpression(request: PendingRequest): string {
  if (request.arity === 1) {
    const value = formatNumber(request.operands[0]);
    switch (request.operation) {
      case 'sqrt':
        return `√(${value})`;
      case 'reciprocal':
        return `1/(${value})`;
      case 'square':
        return `(${value})²`;
    }
  }
  const [left, right] = request.operands;
  return `${formatNumber(left)} ${OPERATOR_GLYPHS[request.operation]} ${formatNumber(right)}`;
}

/** The text of one history entry, such as `2 + 3 = 5`. */
export function historyLabel(record: CalculationRecord): string {
  return `${record.expression} = ${record.result}`;
}

export type DisplaySize = 'lg' | 'md' | 'sm' | 'xs';

/**
 * Picks a CSS size class by text length. The stylesheet maps each one to a font size, so a long
 * number shrinks instead of overflowing, and no inline style is needed (the CSP forbids it).
 */
export function displaySize(text: string): DisplaySize {
  if (text.length <= 9) return 'lg';
  if (text.length <= 12) return 'md';
  if (text.length <= 16) return 'sm';
  return 'xs';
}
