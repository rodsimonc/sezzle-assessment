import { calculate, postRaw } from '../../lib/calc';
import { loadOpenApi, OPERATIONS } from '../../lib/contract';
import { unknownOperationDetail } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { withoutRequestId } from '../../lib/openapi';
import { expectProblem } from '../../lib/problem';

// Golden case of release item 2.5: the `unknown_operation` 422 example in the OpenAPI file.
const unknownOperationExample: unknown = loadOpenApi().paths['/api/v1/calculations'].post.responses['422'].content[
  'application/problem+json'
].examples.unknown_operation.value;

const unknownNames = ['modulo', 'ADD', 'Add', ''];

test.describe('2.5 Business validation', () => {
  test('modulo [7, 3] returns the unknown_operation example of the OpenAPI file', async ({ request }) => {
    const res = await calculate(request, 'modulo', [7, 3]);
    const problem = await expectProblem(res, { status: 422, code: 'UNKNOWN_OPERATION' });

    expect(withoutRequestId(problem)).toEqual(withoutRequestId(unknownOperationExample));
  });

  for (const name of unknownNames) {
    test(`operation ${JSON.stringify(name)} returns 422 UNKNOWN_OPERATION and lists the valid names`, async ({ request }) => {
      const res = await calculate(request, name, [7, 3]);
      const problem = await expectProblem(res, {
        status: 422,
        code: 'UNKNOWN_OPERATION',
        instance: '/api/v1/calculations',
        detail: unknownOperationDetail(name),
      });

      expect(problem.errors?.[0]?.field).toBe('operation');
      const message = problem.errors?.[0]?.message ?? '';
      for (const valid of OPERATIONS) expect(message).toContain(valid);
      expect(problem).not.toHaveProperty('result');
    });
  }

  for (const operands of [[], [1], [1, 2, 3]]) {
    test(`an unknown name with ${operands.length} operands is still UNKNOWN_OPERATION: the count isn't checked`, async ({ request }) => {
      const res = await calculate(request, 'modulo', operands);
      await expectProblem(res, { status: 422, code: 'UNKNOWN_OPERATION', instance: '/api/v1/calculations' });
    });
  }

  test('the lowercase name is accepted, so the 422 above comes from the name and nothing else', async ({ request }) => {
    const res = await calculate(request, 'add', [7, 3]);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.result).toBe(10);
  });

  test('a shape error wins over an unknown name: a body without operands is a 400', async ({ request }) => {
    const res = await postRaw(request, '/api/v1/calculations', '{"operation":"modulo"}');
    const problem = await expectProblem(res, { status: 400, code: 'INVALID_REQUEST' });

    expect(problem.errors?.[0]?.field).toBe('operands');
  });
});
