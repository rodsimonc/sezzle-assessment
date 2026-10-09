import { DETAIL, methodNotAllowedDetail, notFoundDetail } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { expectProblem } from '../../lib/problem';
import { asApiResponse, baseUrlOf, rawRequest } from '../../lib/raw-http';

const VALID_BODY = '{"operation":"add","operands":[1,2]}';

/** A valid JSON object of exactly `size` bytes: the request, then a padding string of spaces. */
function bodyOfSize(size: number): string {
  const body = VALID_BODY + ' '.repeat(size - VALID_BODY.length);
  expect(Buffer.byteLength(body, 'utf8')).toBe(size);
  return body;
}

/** A 5000-byte JSON object with a valid request in it and one padding field. */
function paddedBody(): string {
  const head = '{"operation":"add","operands":[1,2],"pad":"';
  const tail = '"}';
  return head + 'x'.repeat(5000 - head.length - tail.length) + tail;
}

test.describe('2.6 HTTP hygiene', () => {
  test('GET /api/v1/nothing returns 404 NOT_FOUND', async ({ request }) => {
    const res = await request.get('/api/v1/nothing');
    await expectProblem(res, {
      status: 404,
      code: 'NOT_FOUND',
      instance: '/api/v1/nothing',
      detail: notFoundDetail('GET', '/api/v1/nothing'),
    });
  });

  const methodRows = [
    { method: 'PUT', path: '/api/v1/calculations', allow: 'POST' },
    { method: 'GET', path: '/api/v1/calculations', allow: 'POST' },
    { method: 'DELETE', path: '/api/v1/operations', allow: 'GET' },
  ];
  for (const row of methodRows) {
    test(`${row.method} ${row.path} returns 405 METHOD_NOT_ALLOWED with Allow: ${row.allow}`, async ({ request }) => {
      const res = await request.fetch(row.path, { method: row.method });
      await expectProblem(res, {
        status: 405,
        code: 'METHOD_NOT_ALLOWED',
        instance: row.path,
        detail: methodNotAllowedDetail(row.method, row.path, row.allow),
      });

      expect(res.headers()['allow']).toBe(row.allow);
    });
  }

  test('POST with Content-Type text/plain returns 415 UNSUPPORTED_MEDIA_TYPE', async ({ baseURL }) => {
    const raw = await rawRequest({
      baseUrl: baseUrlOf(baseURL),
      method: 'POST',
      path: '/api/v1/calculations',
      headers: { 'Content-Type': 'text/plain' },
      body: VALID_BODY,
    });

    await expectProblem(asApiResponse(raw), {
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      instance: '/api/v1/calculations',
      detail: DETAIL.UNSUPPORTED_MEDIA_TYPE,
    });
  });

  test('POST with Content-Type application/x-www-form-urlencoded returns 415', async ({ baseURL }) => {
    const raw = await rawRequest({
      baseUrl: baseUrlOf(baseURL),
      method: 'POST',
      path: '/api/v1/calculations',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'operation=add&operands=1',
    });

    await expectProblem(asApiResponse(raw), { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  test('POST with no Content-Type header returns 415 UNSUPPORTED_MEDIA_TYPE', async ({ baseURL }) => {
    const raw = await rawRequest({
      baseUrl: baseUrlOf(baseURL),
      method: 'POST',
      path: '/api/v1/calculations',
      body: VALID_BODY,
    });

    expect(raw.headers['content-type'] ?? '').toMatch(/^application\/problem\+json/);
    await expectProblem(asApiResponse(raw), {
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      instance: '/api/v1/calculations',
      detail: DETAIL.UNSUPPORTED_MEDIA_TYPE,
    });
  });

  test('a 5000-byte JSON body returns 413 PAYLOAD_TOO_LARGE', async ({ baseURL }) => {
    const body = paddedBody();
    expect(Buffer.byteLength(body, 'utf8')).toBe(5000);

    const raw = await rawRequest({
      baseUrl: baseUrlOf(baseURL),
      method: 'POST',
      path: '/api/v1/calculations',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    await expectProblem(asApiResponse(raw), {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      instance: '/api/v1/calculations',
      detail: DETAIL.PAYLOAD_TOO_LARGE,
    });
  });

  test('the size limit sits at 4096 bytes: 4096 is served and 4097 is refused', async ({ baseURL }) => {
    const send = (body: string) =>
      rawRequest({
        baseUrl: baseUrlOf(baseURL),
        method: 'POST',
        path: '/api/v1/calculations',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

    const atLimit = await send(bodyOfSize(4096));
    expect(atLimit.status).toBe(200);

    const overLimit = await send(bodyOfSize(4097));
    await expectProblem(asApiResponse(overLimit), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  test('the media type is checked before the size: text/plain with 5000 bytes returns 415', async ({ baseURL }) => {
    const raw = await rawRequest({
      baseUrl: baseUrlOf(baseURL),
      method: 'POST',
      path: '/api/v1/calculations',
      headers: { 'Content-Type': 'text/plain' },
      body: paddedBody(),
    });

    await expectProblem(asApiResponse(raw), { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  test('Content-Type application/json; charset=utf-8 with a valid body returns 200', async ({ baseURL }) => {
    const raw = await rawRequest({
      baseUrl: baseUrlOf(baseURL),
      method: 'POST',
      path: '/api/v1/calculations',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: VALID_BODY,
    });

    expect(raw.status).toBe(200);
    expect(JSON.parse(raw.body.toString('utf8'))).toEqual({ operation: 'add', operands: [1, 2], result: 3 });
  });
});
