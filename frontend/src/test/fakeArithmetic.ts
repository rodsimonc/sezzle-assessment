import { ApiError } from '../api/problem';
import type { OperationName } from '../api/types';

/**
 * A stand-in for the backend's arithmetic, used only by tests. It rounds to 15 significant
 * digits and fails with the same messages the real service sends. The shipped frontend has no
 * code like this: every number it shows comes from the API.
 */
export function fakeArithmetic(operation: OperationName, operands: readonly number[]): number {
  const [a = 0, b = 0] = operands;
  let value: number;
  switch (operation) {
    case 'add':
      value = a + b;
      break;
    case 'subtract':
      value = a - b;
      break;
    case 'multiply':
      value = a * b;
      break;
    case 'divide':
      if (b === 0) throw new ApiError('Division by zero is undefined.');
      value = a / b;
      break;
    case 'power':
      value = a ** b;
      break;
    case 'sqrt':
      if (a < 0) throw new ApiError("The square root of a negative number isn't a real number.");
      value = Math.sqrt(a);
      break;
    case 'percentage':
      value = (a / 100) * b;
      break;
    case 'reciprocal':
      if (a === 0) throw new ApiError('Division by zero is undefined.');
      value = 1 / a;
      break;
    case 'square':
      value = a * a;
      break;
  }
  // Adding 0 turns -0 into 0, as the backend does.
  return Number(value.toPrecision(15)) + 0;
}
