import { calculate, postRaw } from '../../lib/calc';
import { DETAIL, operandCountMessage } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.3.
const rows: { operands: number[]; result: number }[] = [
  { operands: [6, 7], result: 42 },
  { operands: [-2.5, 4], result: -10 },
  { operands: [0.1, 3], result: 0.3 },
  { operands: [0, -5], result: 0 },
];

// A "-0" that is not followed by a digit or a dot. It would be negative zero as a JSON number.
const NEGATIVE_ZERO = /-0(?![.\d])/;

test.describe('1.3 Multiplication', () => {
  for (const row of rows) {
    test(`multiply ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, 'multiply', row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(body.operation).toBe('multiply');
      expect(body.operands).toEqual(row.operands);
      // toBe compares with Object.is, so a -0 result fails here.
      expect(body.result).toBe(row.result);
    });
  }

  test('multiply [0, -5] puts "result":0 in the raw body and never -0', async ({ request }) => {
    const res = await calculate(request, 'multiply', [0, -5]);
    const text = await res.text();

    expect(res.status()).toBe(200);
    expect(text).toMatch(/"result":0[,}]/);
    expect(text).not.toMatch(NEGATIVE_ZERO);
  });

  test('multiply [-0, 5] sent as the literal -0 still returns result 0', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/calculations', '{"operation":"multiply","operands":[-0,5]}');
    const text = await res.text();

    expect(res.status()).toBe(200);
    expect(text).toMatch(/"result":0[,}]/);
    expect(text).not.toMatch(/"result":-0/);
    expect(JSON.parse(text).result).toBe(0);
  });

  for (const operands of [[6], [], [1, 2, 3]]) {
    test(`multiply ${JSON.stringify(operands)} is rejected with 400 INVALID_OPERAND_COUNT`, async ({ request }) => {
      const res = await calculate(request, 'multiply', operands);
      const problem = await expectProblem(res, {
        status: 400,
        code: 'INVALID_OPERAND_COUNT',
        instance: '/api/v1/calculations',
        detail: DETAIL.INVALID_OPERAND_COUNT,
      });

      expect(problem.errors?.[0]?.field).toBe('operands');
      expect(problem.errors?.[0]?.message).toBe(operandCountMessage('multiply', 2, operands.length));
      expect(problem).not.toHaveProperty('result');
    });
  }
});
