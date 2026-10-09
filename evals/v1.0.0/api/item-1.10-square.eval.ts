import { calculate } from '../../lib/calc';
import { DETAIL, operandCountMessage } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.10.
const results: { operands: number[]; result: number }[] = [
  { operands: [-3], result: 9 },
  { operands: [1.5], result: 2.25 },
  { operands: [0], result: 0 },
];

test.describe('1.10 Square', () => {
  for (const row of results) {
    test(`square ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, 'square', row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(body.operation).toBe('square');
      expect(body.operands).toEqual(row.operands);
      expect(body.result).toBe(row.result);
    });
  }

  test('square [1e200] returns 422 RESULT_OUT_OF_RANGE', async ({ request }) => {
    const res = await calculate(request, 'square', [1e200]);
    const problem = await expectProblem(res, {
      status: 422,
      code: 'RESULT_OUT_OF_RANGE',
      instance: '/api/v1/calculations',
      detail: DETAIL.RESULT_OUT_OF_RANGE,
    });

    expect(problem).not.toHaveProperty('result');
    expect(await res.text()).not.toMatch(/Infinity|NaN/);
  });

  test('square [1e150] still fits: the limit sits at the square root of the largest float64', async ({ request }) => {
    const res = await calculate(request, 'square', [1e150]);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.result).toBe(1e300);
  });

  for (const operands of [[2, 3], [], [1, 2, 3]]) {
    test(`square ${JSON.stringify(operands)} is rejected with 400 INVALID_OPERAND_COUNT`, async ({ request }) => {
      const res = await calculate(request, 'square', operands);
      const problem = await expectProblem(res, {
        status: 400,
        code: 'INVALID_OPERAND_COUNT',
        instance: '/api/v1/calculations',
        detail: DETAIL.INVALID_OPERAND_COUNT,
      });

      expect(problem.errors?.[0]?.field).toBe('operands');
      expect(problem.errors?.[0]?.message).toBe(operandCountMessage('square', 1, operands.length));
      expect(problem).not.toHaveProperty('result');
    });
  }
});
