import { calculate, postRaw } from '../../lib/calc';
import { OPERATIONS, type OperationName } from '../../lib/contract';
import { DETAIL, unknownOperationDetail } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { ARITY, FIRST_ROWS } from '../../lib/golden';
import { withoutRequestId } from '../../lib/openapi';
import { expectProblem } from '../../lib/problem';

interface Case {
  operation: OperationName;
  operands: number[];
}

// One success per operation, one wrong operand count per operation, then the arithmetic failures.
const cases: Case[] = [
  ...FIRST_ROWS.map((row) => ({ operation: row.operation, operands: row.operands })),
  ...OPERATIONS.map((operation) => ({ operation, operands: ARITY[operation] === 1 ? [1, 2] : [1] })),
  { operation: 'divide', operands: [5, 0] },
  { operation: 'sqrt', operands: [-4] },
  { operation: 'power', operands: [-8, 0.5] },
  { operation: 'power', operands: [0, -1] },
  { operation: 'multiply', operands: [1e308, 10] },
  { operation: 'reciprocal', operands: [0] },
  { operation: 'square', operands: [1e200] },
];

/** The body without the two fields that differ by design between the routes. */
function comparable(body: unknown): unknown {
  const copy = { ...(withoutRequestId(body) as Record<string, unknown>) };
  delete copy.instance;
  return copy;
}

test.describe('2.3 Operation routes', () => {
  test('/operations/add with {"operands":[2,3]} returns the golden body', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/operations/add', '{"operands":[2,3]}');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/^application\/json/);

    expect(await res.json()).toEqual({ operation: 'add', operands: [2, 3], result: 5 });
  });

  test('/operations/divide with {"operands":[5,0]} returns 422 DIVISION_BY_ZERO', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/operations/divide', '{"operands":[5,0]}');
    await expectProblem(res, {
      status: 422,
      code: 'DIVISION_BY_ZERO',
      instance: '/api/v1/operations/divide',
      detail: DETAIL.DIVISION_BY_ZERO,
    });
  });

  for (const row of cases) {
    test(`${row.operation} ${JSON.stringify(row.operands)} answers the same on both routes`, async ({ request }) => {
      const viaBody = await calculate(request, row.operation, row.operands);
      const viaPath = await request.post(`/api/v1/operations/${row.operation}`, { data: { operands: row.operands } });

      expect(viaPath.status()).toBe(viaBody.status());
      expect(viaPath.headers()['content-type']).toBe(viaBody.headers()['content-type']);
      expect(comparable(await viaPath.json())).toEqual(comparable(await viaBody.json()));

      if (viaPath.status() >= 400) {
        const problem = (await viaPath.json()) as { instance: string };
        expect(problem.instance).toBe(`/api/v1/operations/${row.operation}`);
      }
    });
  }

  test('an unknown name in the path returns 404 UNKNOWN_OPERATION without field errors', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/operations/modulo', '{"operands":[7,3]}');
    const problem = await expectProblem(res, {
      status: 404,
      code: 'UNKNOWN_OPERATION',
      instance: '/api/v1/operations/modulo',
      detail: unknownOperationDetail('modulo'),
    });

    expect(problem).not.toHaveProperty('errors');
  });

  test('names in the path are case-sensitive: /operations/ADD returns 404', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/operations/ADD', '{"operands":[2,3]}');
    await expectProblem(res, { status: 404, code: 'UNKNOWN_OPERATION', instance: '/api/v1/operations/ADD' });
  });

  test('a body that carries an operation field returns 400 INVALID_REQUEST', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/operations/add', '{"operation":"add","operands":[2,3]}');
    const problem = await expectProblem(res, {
      status: 400,
      code: 'INVALID_REQUEST',
      instance: '/api/v1/operations/add',
      detail: DETAIL.INVALID_REQUEST,
    });

    expect(problem.errors?.[0]?.field).toBe('operation');
    expect(problem).not.toHaveProperty('result');
  });

  test('a body without operands returns 400 INVALID_REQUEST naming operands', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/operations/add', '{}');
    const problem = await expectProblem(res, { status: 400, code: 'INVALID_REQUEST' });

    expect(problem.errors?.[0]?.field).toBe('operands');
  });
});
