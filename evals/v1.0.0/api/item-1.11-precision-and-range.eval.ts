import { calculate, postRaw } from '../../lib/calc';
import { DETAIL } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

const MAX_FLOAT64 = 1.7976931348623157e308;

// Golden case of release item 1.11, plus a few rounding rows of the same rule.
const results: { operation: string; operands: number[]; result: number }[] = [
  { operation: 'multiply', operands: [1.1, 1.1], result: 1.21 },
  { operation: 'multiply', operands: [4.35, 100], result: 435 },
  { operation: 'add', operands: [999999999999999, 1], result: 1000000000000000 },
  { operation: 'add', operands: [1234567890123456, 1], result: 1234567890123460 },
  { operation: 'add', operands: [MAX_FLOAT64, 0], result: MAX_FLOAT64 },
  { operation: 'add', operands: [5e-324, 0], result: 5e-324 },
  { operation: 'add', operands: [0.1, 0.7], result: 0.8 },
  { operation: 'subtract', operands: [0.3, 0.1], result: 0.2 },
  { operation: 'divide', operands: [1, 3], result: 0.333333333333333 },
];

const outOfRange: { operation: string; operands: number[] }[] = [
  { operation: 'multiply', operands: [1e308, 10] },
  { operation: 'add', operands: [MAX_FLOAT64, MAX_FLOAT64] },
];

// Each of these produces -0 before the service normalises it.
const negativeZero: { operation: string; operands: number[] }[] = [
  { operation: 'multiply', operands: [-1, 0] },
  { operation: 'multiply', operands: [0, -5] },
  { operation: 'divide', operands: [0, -5] },
];

test.describe('1.11 Precision and range', () => {
  for (const row of results) {
    test(`${row.operation} ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, row.operation, row.operands);
      expect(res.status()).toBe(200);

      const body = await res.json();
      expect(body.result).toBe(row.result);
      expect(Number.isFinite(body.result)).toBe(true);
    });
  }

  for (const row of outOfRange) {
    test(`${row.operation} ${JSON.stringify(row.operands)} returns 422 RESULT_OUT_OF_RANGE`, async ({ request }) => {
      const res = await calculate(request, row.operation, row.operands);
      const problem = await expectProblem(res, {
        status: 422,
        code: 'RESULT_OUT_OF_RANGE',
        instance: '/api/v1/calculations',
        detail: DETAIL.RESULT_OUT_OF_RANGE,
      });

      expect(problem).not.toHaveProperty('result');
      expect(await res.text()).not.toMatch(/Infinity|NaN/);
    });
  }

  for (const row of negativeZero) {
    test(`${row.operation} ${JSON.stringify(row.operands)} returns 0, never -0`, async ({ request }) => {
      const res = await calculate(request, row.operation, row.operands);
      expect(res.status()).toBe(200);

      const body = await res.json();
      expect(Object.is(body.result, -0)).toBe(false);
      expect(body.result).toBe(0);
    });
  }

  test('a negative zero operand is accepted and adds as zero', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/calculations', '{"operation":"add","operands":[-0,5]}');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.result).toBe(5);
  });

  test('rounding keeps 15 significant digits: 2/3 returns 0.666666666666667', async ({ request }) => {
    const res = await calculate(request, 'divide', [2, 3]);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.result).toBe(0.666666666666667);
  });
});
