import { calculate } from '../../lib/calc';
import { DETAIL } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { useOwnServer } from '../../lib/own-server';
import { expectProblem } from '../../lib/problem';

const ORIGIN = 'https://app.example.com';
const EVIL = 'https://evil.example';
const CALCULATIONS = '/api/v1/calculations';

const CALCULATION_BODY = { operation: 'add', operands: [2, 3] };

test.describe('2.8 Headers, CORS and health', () => {
  test.describe('request ids', () => {
    test('a response with no incoming id carries 32 hex characters, and each response gets its own', async ({
      request,
    }) => {
      const first = await request.get('/api/v1/operations');
      const second = await request.get('/api/v1/operations');

      expect(first.headers()['x-request-id']).toMatch(/^[0-9a-f]{32}$/);
      expect(second.headers()['x-request-id']).toMatch(/^[0-9a-f]{32}$/);
      expect(second.headers()['x-request-id']).not.toBe(first.headers()['x-request-id']);
    });

    for (const id of ['abc123', 'trace.id_42-x', 'A'.repeat(64)]) {
      test(`a valid incoming id of ${id.length} characters is echoed`, async ({ request }) => {
        const res = await request.get('/api/v1/operations', { headers: { 'X-Request-Id': id } });

        expect(res.headers()['x-request-id']).toBe(id);
      });
    }

    for (const [label, id] of [
      ['one with a space', 'bad id'],
      ['one with 65 characters', 'A'.repeat(65)],
      ['one with a slash', 'a/b'],
    ] as const) {
      test(`an invalid incoming id (${label}) is replaced`, async ({ request }) => {
        const res = await request.get('/api/v1/operations', { headers: { 'X-Request-Id': id } });

        expect(res.headers()['x-request-id']).not.toBe(id);
        expect(res.headers()['x-request-id']).toMatch(/^[0-9a-f]{32}$/);
      });
    }

    test('an error body repeats the request id as requestId', async ({ request }) => {
      const res = await request.post(CALCULATIONS, {
        data: { operation: 'add', operands: [1] },
        headers: { 'X-Request-Id': 'trace-me-123' },
      });
      const problem = await expectProblem(res, { status: 400, code: 'INVALID_OPERAND_COUNT' });

      expect(res.headers()['x-request-id']).toBe('trace-me-123');
      expect(problem.requestId).toBe('trace-me-123');
    });

    for (const path of ['/healthz', '/api/v1/openapi.yaml', '/api/v1/nothing']) {
      test(`GET ${path} carries X-Request-Id`, async ({ request }) => {
        const res = await request.get(path);

        expect(res.headers()['x-request-id']).toMatch(/^[0-9A-Za-z._-]{1,64}$/);
      });
    }
  });

  test.describe('security headers', () => {
    for (const target of [
      { label: 'a success under /api/', method: 'GET', path: '/api/v1/operations', api: true },
      { label: 'an error under /api/', method: 'GET', path: '/api/v1/nothing', api: true },
      { label: 'a 405 under /api/', method: 'PUT', path: CALCULATIONS, api: true },
      { label: '/healthz', method: 'GET', path: '/healthz', api: false },
    ]) {
      test(`${target.label} carries the security headers`, async ({ request }) => {
        const res = await request.fetch(target.path, { method: target.method });
        const headers = res.headers();

        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['x-frame-options']).toBe('DENY');
        expect(headers['referrer-policy']).toBe('no-referrer');
        expect(headers['content-security-policy']).toContain("default-src 'self'");
        expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
        if (target.api) expect(headers['cache-control']).toBe('no-store');
      });
    }

    test('a calculation response carries the headers too, with Cache-Control: no-store', async ({ request }) => {
      const res = await calculate(request, 'add', [2, 3]);
      const headers = res.headers();

      expect(res.status()).toBe(200);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['cache-control']).toBe('no-store');
    });
  });

  test.describe('health', () => {
    test('GET /healthz returns 200 and {"status":"ok","version":"1.0.0"}', async ({ request }) => {
      const res = await request.get('/healthz');
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^application\/json/);

      expect(await res.json()).toEqual({ status: 'ok', version: '1.0.0' });
    });
  });

  test.describe('CORS allowlist', () => {
    test.describe.configure({ mode: 'default' });
    const serverUrl = useOwnServer({ staticDir: null, env: { CORS_ALLOWED_ORIGINS: ORIGIN } });

    test('a preflight from the allowed origin returns 204 with the allow headers', async ({ request }) => {
      const res = await request.fetch(`${serverUrl()}${CALCULATIONS}`, {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      const headers = res.headers();

      expect(res.status()).toBe(204);
      expect(headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(headers['vary']).toMatch(/\bOrigin\b/i);
      expect(headers['access-control-allow-methods']).toContain('POST');
      expect(headers['access-control-allow-headers']?.toLowerCase()).toContain('content-type');
    });

    for (const origin of [EVIL, 'http://app.example.com', 'https://app.example.com.evil.example']) {
      test(`a preflight from ${origin} returns 403 CORS_ORIGIN_NOT_ALLOWED`, async ({ request }) => {
        const res = await request.fetch(`${serverUrl()}${CALCULATIONS}`, {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
        });
        await expectProblem(res, {
          status: 403,
          code: 'CORS_ORIGIN_NOT_ALLOWED',
          instance: CALCULATIONS,
          detail: DETAIL.CORS_ORIGIN_NOT_ALLOWED,
        });

        expect(res.headers()['access-control-allow-origin']).toBeUndefined();
      });
    }

    test('a normal POST from the evil origin is served but gets no Access-Control-Allow-Origin', async ({ request }) => {
      const res = await request.post(`${serverUrl()}${CALCULATIONS}`, {
        data: CALCULATION_BODY,
        headers: { Origin: EVIL },
      });
      expect(res.status()).toBe(200);

      expect(await res.json()).toEqual({ ...CALCULATION_BODY, result: 5 });
      expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    });

    test('a normal POST from the allowed origin gets its origin back', async ({ request }) => {
      const res = await request.post(`${serverUrl()}${CALCULATIONS}`, {
        data: CALCULATION_BODY,
        headers: { Origin: ORIGIN },
      });
      expect(res.status()).toBe(200);

      expect(res.headers()['access-control-allow-origin']).toBe(ORIGIN);
      expect(res.headers()['vary']).toMatch(/\bOrigin\b/i);
    });
  });

  test.describe('CORS_ALLOWED_ORIGINS unset', () => {
    test.describe.configure({ mode: 'default' });
    const serverUrl = useOwnServer({ staticDir: null });

    test('no response carries Access-Control-Allow-Origin, whatever the Origin', async ({ request }) => {
      const base = serverUrl();
      const responses = [
        await request.post(`${base}${CALCULATIONS}`, { data: CALCULATION_BODY, headers: { Origin: ORIGIN } }),
        await request.get(`${base}/api/v1/operations`, { headers: { Origin: ORIGIN } }),
        await request.get(`${base}/healthz`, { headers: { Origin: ORIGIN } }),
        await request.fetch(`${base}${CALCULATIONS}`, {
          method: 'OPTIONS',
          headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
        }),
      ];

      expect(responses[0]?.status()).toBe(200);
      for (const res of responses) {
        expect(res.headers()['access-control-allow-origin']).toBeUndefined();
      }
    });
  });
});
