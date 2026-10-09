import { calculate } from '../../lib/calc';
import { DETAIL, operandCountMessage } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.8. The last row only survives when the service divides first.
const rows: { operands: number[]; result: number }[] = [
  { operands: [15, 200], result: 30 },
  { operands: [0, 50], result: 0 },
  { operands: [50, -10], result: -5 },
  { operands: [12.5, 80], result: 10 },
  { operands: [1e308, 50], result: 5e307 },
];

test.describe('1.8 Percentage', () => {
  for (const row of rows) {
    test(`percentage ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, 'percentage', row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(body.operation).toBe('percentage');
      expect(body.operands).toEqual(row.operands);
      expect(body.result).toBe(row.result);
    });
  }

  test('the first operand is the percent and the second is the base: [10, 50] returns 5, not 500', async ({ request }) => {
    const res = await calculate(request, 'percentage', [10, 50]);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.result).toBe(5);
  });

  for (const operands of [[15], [], [1, 2, 3]]) {
    test(`percentage ${JSON.stringify(operands)} is rejected with 400 INVALID_OPERAND_COUNT`, async ({ request }) => {
      const res = await calculate(request, 'percentage', operands);
      const problem = await expectProblem(res, {
        status: 400,
        code: 'INVALID_OPERAND_COUNT',
        instance: '/api/v1/calculations',
        detail: DETAIL.INVALID_OPERAND_COUNT,
      });

      expect(problem.errors?.[0]?.field).toBe('operands');
      expect(problem.errors?.[0]?.message).toBe(operandCountMessage('percentage', 2, operands.length));
      expect(problem).not.toHaveProperty('result');
    });
  }
});
