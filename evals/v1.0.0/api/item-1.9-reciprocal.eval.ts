import { calculate, postRaw } from '../../lib/calc';
import { DETAIL, operandCountMessage, type FixedDetailCode } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.9.
const results: { operands: number[]; result: number }[] = [
  { operands: [4], result: 0.25 },
  { operands: [-0.5], result: -2 },
];

const failures: { operands: number[]; code: FixedDetailCode }[] = [
  { operands: [0], code: 'DIVISION_BY_ZERO' },
  { operands: [5e-324], code: 'RESULT_OUT_OF_RANGE' },
];

test.describe('1.9 Reciprocal', () => {
  for (const row of results) {
    test(`reciprocal ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, 'reciprocal', row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(body.operation).toBe('reciprocal');
      expect(body.operands).toEqual(row.operands);
      expect(body.result).toBe(row.result);
    });
  }

  for (const row of failures) {
    test(`reciprocal ${JSON.stringify(row.operands)} returns 422 ${row.code}`, async ({ request }) => {
      const res = await calculate(request, 'reciprocal', row.operands);
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

  test('reciprocal of negative zero is also a division by zero', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/calculations', '{"operation":"reciprocal","operands":[-0]}');
    await expectProblem(res, {
      status: 422,
      code: 'DIVISION_BY_ZERO',
      instance: '/api/v1/calculations',
      detail: DETAIL.DIVISION_BY_ZERO,
    });
  });

  for (const operands of [[4, 2], [], [1, 2, 3]]) {
    test(`reciprocal ${JSON.stringify(operands)} is rejected with 400 INVALID_OPERAND_COUNT`, async ({ request }) => {
      const res = await calculate(request, 'reciprocal', operands);
      const problem = await expectProblem(res, {
        status: 400,
        code: 'INVALID_OPERAND_COUNT',
        instance: '/api/v1/calculations',
        detail: DETAIL.INVALID_OPERAND_COUNT,
      });

      expect(problem.errors?.[0]?.field).toBe('operands');
      expect(problem.errors?.[0]?.message).toBe(operandCountMessage('reciprocal', 1, operands.length));
    });
  }
});
