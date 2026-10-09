import { calculate } from '../../lib/calc';
import { DETAIL, operandCountMessage } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.7.
const results: { operands: number[]; result: number }[] = [
  { operands: [9], result: 3 },
  { operands: [2], result: 1.4142135623731 },
  { operands: [0], result: 0 },
  { operands: [0.25], result: 0.5 },
];

test.describe('1.7 Square root', () => {
  for (const row of results) {
    test(`sqrt ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, 'sqrt', row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(body.operation).toBe('sqrt');
      expect(body.operands).toEqual(row.operands);
      expect(body.result).toBe(row.result);
    });
  }

  test('sqrt [-4] returns 422 NEGATIVE_SQUARE_ROOT', async ({ request }) => {
    const res = await calculate(request, 'sqrt', [-4]);
    const problem = await expectProblem(res, {
      status: 422,
      code: 'NEGATIVE_SQUARE_ROOT',
      instance: '/api/v1/calculations',
      detail: DETAIL.NEGATIVE_SQUARE_ROOT,
    });

    expect(problem).not.toHaveProperty('result');
    expect(await res.text()).not.toMatch(/NaN/);
  });

  test('sqrt [-0.0001] is also negative: small magnitudes do not slip through', async ({ request }) => {
    const res = await calculate(request, 'sqrt', [-0.0001]);
    await expectProblem(res, { status: 422, code: 'NEGATIVE_SQUARE_ROOT', instance: '/api/v1/calculations' });
  });

  for (const operands of [[4, 9], [], [1, 2, 3]]) {
    test(`sqrt ${JSON.stringify(operands)} returns 400 INVALID_OPERAND_COUNT`, async ({ request }) => {
      const res = await calculate(request, 'sqrt', operands);
      const problem = await expectProblem(res, {
        status: 400,
        code: 'INVALID_OPERAND_COUNT',
        instance: '/api/v1/calculations',
        detail: DETAIL.INVALID_OPERAND_COUNT,
      });

      expect(problem.errors?.[0]?.field).toBe('operands');
      expect(problem.errors?.[0]?.message).toBe(operandCountMessage('sqrt', 1, operands.length));
      expect(problem).not.toHaveProperty('result');
    });
  }
});
