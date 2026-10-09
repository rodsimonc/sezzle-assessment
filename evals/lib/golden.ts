import type { OperationName } from './contract';

export interface GoldenRow {
  operation: OperationName;
  operands: number[];
  result: number;
}

/** Operands per operation: sqrt, reciprocal and square take one, the rest take two. */
export const ARITY: Readonly<Record<OperationName, 1 | 2>> = {
  add: 2,
  subtract: 2,
  multiply: 2,
  divide: 2,
  power: 2,
  sqrt: 1,
  percentage: 2,
  reciprocal: 1,
  square: 1,
};

/** The first golden row of release items 1.1 to 1.10, one per operation, in catalogue order. */
export const FIRST_ROWS: readonly GoldenRow[] = [
  { operation: 'add', operands: [2, 3], result: 5 },
  { operation: 'subtract', operands: [10, 4], result: 6 },
  { operation: 'multiply', operands: [6, 7], result: 42 },
  { operation: 'divide', operands: [10, 4], result: 2.5 },
  { operation: 'power', operands: [2, 10], result: 1024 },
  { operation: 'sqrt', operands: [9], result: 3 },
  { operation: 'percentage', operands: [15, 200], result: 30 },
  { operation: 'reciprocal', operands: [4], result: 0.25 },
  { operation: 'square', operands: [-3], result: 9 },
];
