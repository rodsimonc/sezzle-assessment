import { calculate } from '../../lib/calc';
import { DETAIL, operandCountMessage } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.1.
const rows: { operands: number[]; result: number }[] = [
  { operands: [2, 3], result: 5 },
  { operands: [0.1, 0.2], result: 0.3 },
  { operands: [-5, 3], result: -2 },
  { operands: [0, 0], result: 0 },
  { operands: [123456789012345, 1], result: 123456789012346 },
];

test.describe('1.1 Addition', () => {
  for (const row of rows) {
    test(`add ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, 'add', row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(body.operation).toBe('add');
      expect(body.operands).toEqual(row.operands);
      expect(body.result).toBe(row.result);
    });
  }

  for (const operands of [[1], [], [1, 2, 3]]) {
    test(`add ${JSON.stringify(operands)} is rejected with 400 INVALID_OPERAND_COUNT`, async ({ request }) => {
      const res = await calculate(request, 'add', operands);
      const problem = await expectProblem(res, {
        status: 400,
        code: 'INVALID_OPERAND_COUNT',
        instance: '/api/v1/calculations',
        detail: DETAIL.INVALID_OPERAND_COUNT,
      });

      expect(problem.errors?.[0]?.field).toBe('operands');
      expect(problem.errors?.[0]?.message).toBe(operandCountMessage('add', 2, operands.length));
      expect(problem).not.toHaveProperty('result');
    });
  }

  test('add refuses a text operand instead of concatenating it', async ({ request }) => {
    const res = await calculate(request, 'add', [1, '2']);
    const problem = await expectProblem(res, { status: 400, code: 'INVALID_REQUEST' });

    expect(problem.errors?.[0]?.field).toBe('operands');
    expect(problem).not.toHaveProperty('result');
  });
});
