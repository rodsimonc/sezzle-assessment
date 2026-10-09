import { calculate } from '../../lib/calc';
import { DETAIL, operandCountMessage } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.4, plus two rows that follow from "first divided by second,
// rounded to 15 significant digits": the swapped order and a second repeating decimal.
const rows: { operands: number[]; result: number }[] = [
  { operands: [10, 4], result: 2.5 },
  { operands: [1, 3], result: 0.333333333333333 },
  { operands: [-9, 3], result: -3 },
  { operands: [0, 5], result: 0 },
  { operands: [4, 10], result: 0.4 },
  { operands: [2, 3], result: 0.666666666666667 },
];

test.describe('1.4 Division', () => {
  for (const row of rows) {
    test(`divide ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, 'divide', row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(body.operation).toBe('divide');
      expect(body.operands).toEqual(row.operands);
      expect(body.result).toBe(row.result);
    });
  }

  test('divide [1, 3] rounds to 15 significant digits in the raw body', async ({ request }) => {
    const res = await calculate(request, 'divide', [1, 3]);
    const text = await res.text();

    expect(res.status()).toBe(200);
    expect(text).toContain('"result":0.333333333333333');
    expect(text).not.toMatch(/"result":0\.3333333333333333/);
  });

  test('divide [5, 0] is refused instead of returning a number', async ({ request }) => {
    const res = await calculate(request, 'divide', [5, 0]);
    const problem = await expectProblem(res, { status: 422, code: 'DIVISION_BY_ZERO' });

    expect(problem).not.toHaveProperty('result');
  });

  for (const operands of [[10], [], [1, 2, 3]]) {
    test(`divide ${JSON.stringify(operands)} is rejected with 400 INVALID_OPERAND_COUNT`, async ({ request }) => {
      const res = await calculate(request, 'divide', operands);
      const problem = await expectProblem(res, {
        status: 400,
        code: 'INVALID_OPERAND_COUNT',
        instance: '/api/v1/calculations',
        detail: DETAIL.INVALID_OPERAND_COUNT,
      });

      expect(problem.errors?.[0]?.field).toBe('operands');
      expect(problem.errors?.[0]?.message).toBe(operandCountMessage('divide', 2, operands.length));
    });
  }
});
