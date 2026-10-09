import { calculate } from '../../lib/calc';
import { DETAIL, operandCountMessage } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.2.
const rows: { operands: number[]; result: number }[] = [
  { operands: [10, 4], result: 6 },
  { operands: [4, 10], result: -6 },
  { operands: [0.3, 0.1], result: 0.2 },
  { operands: [5, 5], result: 0 },
];

test.describe('1.2 Subtraction', () => {
  for (const row of rows) {
    test(`subtract ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, 'subtract', row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(body.operation).toBe('subtract');
      expect(body.operands).toEqual(row.operands);
      expect(body.result).toBe(row.result);
    });
  }

  test('the first operand is the minuend: [10, 4] and [4, 10] differ in sign only', async ({ request }) => {
    const forward = await (await calculate(request, 'subtract', [10, 4])).json();
    const backward = await (await calculate(request, 'subtract', [4, 10])).json();

    expect(forward.result).toBe(6);
    expect(backward.result).toBe(-forward.result);
  });

  for (const operands of [[7], [], [1, 2, 3]]) {
    test(`subtract ${JSON.stringify(operands)} is rejected with 400 INVALID_OPERAND_COUNT`, async ({ request }) => {
      const res = await calculate(request, 'subtract', operands);
      const problem = await expectProblem(res, {
        status: 400,
        code: 'INVALID_OPERAND_COUNT',
        instance: '/api/v1/calculations',
        detail: DETAIL.INVALID_OPERAND_COUNT,
      });

      expect(problem.errors?.[0]?.field).toBe('operands');
      expect(problem.errors?.[0]?.message).toBe(operandCountMessage('subtract', 2, operands.length));
      expect(problem).not.toHaveProperty('result');
    });
  }
});
