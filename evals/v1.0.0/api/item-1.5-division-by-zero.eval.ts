import { calculate, postRaw } from '../../lib/calc';
import { DETAIL } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 1.5, plus a negative dividend. Operands are raw JSON text because
// JSON.stringify cannot produce the literal -0.
const rows = [
  { operands: '[5,0]' },
  { operands: '[0,0]' },
  { operands: '[5,-0]' },
  { operands: '[-5,0]' },
];

test.describe('1.5 Division by zero', () => {
  for (const row of rows) {
    test(`divide ${row.operands} returns 422 DIVISION_BY_ZERO`, async ({ request }) => {
      const res = await postRaw(
        request,
        '/api/v1/calculations',
        `{"operation":"divide","operands":${row.operands}}`,
      );
      const problem = await expectProblem(res, {
        status: 422,
        code: 'DIVISION_BY_ZERO',
        instance: '/api/v1/calculations',
        detail: DETAIL.DIVISION_BY_ZERO,
      });

      expect(problem.detail.length).toBeGreaterThan(0);
      expect(res.headers()['x-request-id']).toBe(problem.requestId);
    });
  }

  test('the 422 body carries no result and no Infinity or NaN', async ({ request }) => {
    const res = await calculate(request, 'divide', [5, 0]);
    const text = await res.text();

    expect(res.status()).toBe(422);
    expect(text).not.toMatch(/Infinity|NaN/);
    expect(JSON.parse(text)).not.toHaveProperty('result');
  });

  test('a divisor next to zero is still divided: [5, 0.5] returns 10', async ({ request }) => {
    const res = await calculate(request, 'divide', [5, 0.5]);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.result).toBe(10);
  });

  test('a zero dividend with a non-zero divisor is not an error: [0, 5] returns 0', async ({ request }) => {
    const res = await calculate(request, 'divide', [0, 5]);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.result).toBe(0);
  });
});
