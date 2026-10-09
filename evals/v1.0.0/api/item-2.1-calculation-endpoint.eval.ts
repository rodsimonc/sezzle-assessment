import { calculate, postRaw } from '../../lib/calc';
import { OPERATIONS } from '../../lib/contract';
import { FIRST_ROWS } from '../../lib/golden';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

test.describe('2.1 Calculation endpoint', () => {
  test('the acceptance request returns exactly {operation, operands, result}', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/calculations', '{"operation":"add","operands":[2,3]}');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/^application\/json/);

    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ operation: 'add', operands: [2, 3], result: 5 });
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['operands', 'operation', 'result']);
    expect(text).not.toContain('null');
  });

  test('the golden rows cover all 9 operations in catalogue order', () => {
    expect(FIRST_ROWS.map((row) => row.operation)).toEqual([...OPERATIONS]);
  });

  for (const row of FIRST_ROWS) {
    test(`${row.operation} ${JSON.stringify(row.operands)} returns ${row.result}`, async ({ request }) => {
      const res = await calculate(request, row.operation, row.operands);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(['operands', 'operation', 'result']);
      expect(body.operation).toBe(row.operation);
      expect(body.operands).toEqual(row.operands);
      expect(body.result).toBe(row.result);
    });
  }

  test('the endpoint is stateless: the same request twice gives the same body', async ({ request }) => {
    const first = await calculate(request, 'multiply', [6, 7]);
    const second = await calculate(request, 'multiply', [6, 7]);

    expect(await first.json()).toEqual(await second.json());
  });

  test('an operation the service does not run is refused instead of answered', async ({ request }) => {
    const res = await calculate(request, 'modulo', [7, 3]);
    const problem = await expectProblem(res, { status: 422, code: 'UNKNOWN_OPERATION' });

    expect(problem).not.toHaveProperty('result');
  });
});
