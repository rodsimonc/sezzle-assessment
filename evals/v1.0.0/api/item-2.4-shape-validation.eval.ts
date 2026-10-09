import { DETAIL } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';
import { asApiResponse, baseUrlOf, rawRequest } from '../../lib/raw-http';

type ShapeCode = 'INVALID_JSON' | 'INVALID_REQUEST' | 'INVALID_OPERAND_COUNT';

interface Row {
  label: string;
  body: string;
  code: ShapeCode;
  /** `undefined` means the row names no field. */
  field?: string;
}

// Golden case of release item 2.4, byte for byte. The bodies are strings because several aren't valid JSON.
const rows: Row[] = [
  { label: 'empty string', body: '', code: 'INVALID_JSON' },
  { label: '{', body: '{', code: 'INVALID_JSON' },
  { label: 'a second JSON value after the first', body: '{"operation":"add","operands":[1,2]} {}', code: 'INVALID_JSON' },
  { label: 'an array', body: '[1,2]', code: 'INVALID_REQUEST' },
  { label: 'null', body: 'null', code: 'INVALID_REQUEST' },
  { label: 'no operation', body: '{"operands":[1,2]}', code: 'INVALID_REQUEST', field: 'operation' },
  { label: 'no operands', body: '{"operation":"add"}', code: 'INVALID_REQUEST', field: 'operands' },
  { label: 'a numeric operation', body: '{"operation":5,"operands":[1,2]}', code: 'INVALID_REQUEST', field: 'operation' },
  { label: 'a text operands value', body: '{"operation":"add","operands":"12"}', code: 'INVALID_REQUEST', field: 'operands' },
  { label: 'a text operand', body: '{"operation":"add","operands":[1,"2"]}', code: 'INVALID_REQUEST', field: 'operands' },
  { label: 'a null operand', body: '{"operation":"add","operands":[1,null]}', code: 'INVALID_REQUEST', field: 'operands' },
  { label: 'an unknown field', body: '{"operation":"add","operands":[1,2],"extra":true}', code: 'INVALID_REQUEST', field: 'extra' },
  { label: 'an operand beyond float64', body: '{"operation":"add","operands":[1e999,1]}', code: 'INVALID_REQUEST', field: 'operands' },
  { label: 'one operand for add', body: '{"operation":"add","operands":[1]}', code: 'INVALID_OPERAND_COUNT', field: 'operands' },
  { label: 'no operands for add', body: '{"operation":"add","operands":[]}', code: 'INVALID_OPERAND_COUNT', field: 'operands' },
  { label: 'two operands for sqrt', body: '{"operation":"sqrt","operands":[1,2]}', code: 'INVALID_OPERAND_COUNT', field: 'operands' },
  { label: 'three operands for add', body: '{"operation":"add","operands":[1,2,3]}', code: 'INVALID_OPERAND_COUNT', field: 'operands' },
];

test.describe('2.4 Shape validation', () => {
  for (const row of rows) {
    test(`${row.label} returns 400 ${row.code}${row.field ? ` on ${row.field}` : ''}`, async ({ baseURL }) => {
      const raw = await rawRequest({
        baseUrl: baseUrlOf(baseURL),
        method: 'POST',
        path: '/api/v1/calculations',
        headers: { 'Content-Type': 'application/json' },
        body: row.body,
      });
      const problem = await expectProblem(asApiResponse(raw), {
        status: 400,
        code: row.code,
        instance: '/api/v1/calculations',
        detail: DETAIL[row.code],
      });

      expect(problem).not.toHaveProperty('result');
      if (row.field !== undefined) {
        expect(problem.errors?.[0]?.field).toBe(row.field);
        expect(problem.errors?.[0]?.message.length).toBeGreaterThan(0);
      } else if (row.code === 'INVALID_JSON') {
        expect(problem).not.toHaveProperty('errors');
      } else {
        expect(problem.errors?.[0]?.field ?? '').toBe('');
      }
    });
  }

  test('the same endpoint accepts a valid body with trailing whitespace', async ({ baseURL }) => {
    const raw = await rawRequest({
      baseUrl: baseUrlOf(baseURL),
      method: 'POST',
      path: '/api/v1/calculations',
      headers: { 'Content-Type': 'application/json' },
      body: '{"operation":"add","operands":[1,2]}\n',
    });

    expect(raw.status).toBe(200);
    expect(JSON.parse(raw.body.toString('utf8'))).toEqual({ operation: 'add', operands: [1, 2], result: 3 });
  });
});
