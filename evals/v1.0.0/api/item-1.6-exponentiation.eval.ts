import { calculate } from '../../lib/calc';
import { DETAIL, operandCountMessage, type FixedDetailCode } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.6.
const results: { operands: number[]; result: number }[] = [
  { operands: [2, 10], result: 1024 },
  { operands: [2, -1], result: 0.5 },
  { operands: [9, 0.5], result: 3 },
  { operands: [0, 0], result: 1 },
  { operands: [-2, 3], result: -8 },
];

const failures: { operands: number[]; code: FixedDetailCode }[] = [
  { operands: [-8, 0.5], code: 'UNDEFINED_RESULT' },
  { operands: [0, -1], code: 'DIVISION_BY_ZERO' },
  { operands: [10, 400], code: 'RESULT_OUT_OF_RANGE' },
];

test.describe('1.6 Exponentiation', () => {
  for (const row of results) {
    test(`power ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, 'power', row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(body.operation).toBe('power');
      expect(body.operands).toEqual(row.operands);
      expect(body.result).toBe(row.result);
    });
  }

  for (const row of failures) {
    test(`power ${JSON.stringify(row.operands)} returns 422 ${row.code}`, async ({ request }) => {
      const res = await calculate(request, 'power', row.operands);
      const problem = await expectProblem(res, {
        status: 422,
        code: row.code,
        instance: '/api/v1/calculations',
        detail: DETAIL[row.code],
      });

      expect(problem).not.toHaveProperty('result');
      expect(await res.text()).not.toMatch(/Infinity|NaN/);
    });
  }

  test('a negative base with an integer exponent is a real number: [-2, 2] returns 4', async ({ request }) => {
    const res = await calculate(request, 'power', [-2, 2]);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.result).toBe(4);
  });

  for (const operands of [[2], [], [2, 3, 4]]) {
    test(`power ${JSON.stringify(operands)} is rejected with 400 INVALID_OPERAND_COUNT`, async ({ request }) => {
      const res = await calculate(request, 'power', operands);
      const problem = await expectProblem(res, {
        status: 400,
        code: 'INVALID_OPERAND_COUNT',
        instance: '/api/v1/calculations',
        detail: DETAIL.INVALID_OPERAND_COUNT,
      });

      expect(problem.errors?.[0]?.field).toBe('operands');
      expect(problem.errors?.[0]?.message).toBe(operandCountMessage('power', 2, operands.length));
    });
  }
});
