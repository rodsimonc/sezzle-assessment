import type { APIRequestContext, APIResponse } from '@playwright/test';
import { rateLimitDetail } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { useOwnServer } from '../../lib/own-server';
import { expectProblem } from '../../lib/problem';
import { createStaticSite, FIXTURE_ASSET_URL_PATH, type StaticSite } from '../../lib/static-site';

const BURST = 5;

// 6 per minute refills one token every 10 seconds, so a drained bucket stays drained for the whole test.
const SLOW_REFILL = { RATE_LIMIT_PER_MINUTE: '6', RATE_LIMIT_BURST: String(BURST) };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculation(
  request: APIRequestContext,
  base: string,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  return request.post(`${base}/api/v1/calculations`, {
    data: { operation: 'add', operands: [2, 3] },
    headers,
  });
}

/** Spends the whole burst on 200 answers, then returns the next response, which should be the 429. */
async function drain(
  request: APIRequestContext,
  base: string,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  for (let i = 1; i <= BURST; i++) {
    const res = await calculation(request, base, headers);
    expect(res.status(), `request ${i} of ${BURST} fits in the burst`).toBe(200);
  }
  return calculation(request, base, headers);
}

test.describe('2.7 Rate limiting', () => {
  test.describe('60 per minute with a burst of 5', () => {
    test.describe.configure({ mode: 'serial' });
    const serverUrl = useOwnServer({
      staticDir: null,
      env: { RATE_LIMIT_PER_MINUTE: '60', RATE_LIMIT_BURST: String(BURST) },
    });

    test('six quick requests give five 200s and then 429 RATE_LIMITED, and waiting Retry-After recovers', async ({
      request,
    }) => {
      const base = serverUrl();
      const limited = await drain(request, base);

      const retryHeader = limited.headers()['retry-after'] ?? '';
      expect(retryHeader).toMatch(/^[1-9]\d*$/);
      const retryAfter = Number(retryHeader);
      expect(retryAfter).toBeLessThanOrEqual(2);

      const problem = await expectProblem(limited, {
        status: 429,
        code: 'RATE_LIMITED',
        instance: '/api/v1/calculations',
        detail: rateLimitDetail(retryAfter),
      });
      expect(problem.retryAfter).toBe(retryAfter);

      // Real wait: the Retry-After the server named, plus a small margin for the network.
      await sleep(retryAfter * 1000 + 100);
      const recovered = await calculation(request, base);
      expect(recovered.status()).toBe(200);
      expect(await recovered.json()).toEqual({ operation: 'add', operands: [2, 3], result: 5 });
    });
  });

  test.describe('a drained bucket', () => {
    test.describe.configure({ mode: 'serial' });
    let site: StaticSite | undefined;
    const serverUrl = useOwnServer(
      () => {
        site = createStaticSite();
        return { staticDir: site.dir, env: SLOW_REFILL };
      },
      () => site?.cleanup(),
    );

    test('limits every /api/ route and leaves /healthz and static files open', async ({ request }) => {
      const base = serverUrl();
      const limited = await drain(request, base);
      expect(limited.status()).toBe(429);

      const operations = await request.get(`${base}/api/v1/operations`);
      await expectProblem(operations, { status: 429, code: 'RATE_LIMITED', instance: '/api/v1/operations' });

      const health = await request.get(`${base}/healthz`);
      expect(health.status()).toBe(200);

      const page = await request.get(`${base}/`);
      expect(page.status()).toBe(200);

      const asset = await request.get(`${base}${FIXTURE_ASSET_URL_PATH}`);
      expect(asset.status()).toBe(200);

      const stillLimited = await calculation(request, base);
      expect(stillLimited.status()).toBe(429);
    });
  });

  test.describe('TRUST_PROXY=true', () => {
    test.describe.configure({ mode: 'serial' });
    const serverUrl = useOwnServer({ staticDir: null, env: { ...SLOW_REFILL, TRUST_PROXY: 'true' } });

    test('two different X-Forwarded-For values have separate buckets', async ({ request }) => {
      const base = serverUrl();
      const first = { 'X-Forwarded-For': '203.0.113.10' };
      const second = { 'X-Forwarded-For': '203.0.113.11' };

      const limited = await drain(request, base, first);
      expect(limited.status()).toBe(429);

      const otherClient = await calculation(request, base, second);
      expect(otherClient.status()).toBe(200);

      const firstAgain = await calculation(request, base, first);
      expect(firstAgain.status()).toBe(429);
    });

    test('only the first X-Forwarded-For entry names the client', async ({ request }) => {
      const base = serverUrl();

      const limited = await drain(request, base, { 'X-Forwarded-For': '198.51.100.7, 10.0.0.1' });
      expect(limited.status()).toBe(429);

      const sameClient = await calculation(request, base, { 'X-Forwarded-For': '198.51.100.7, 10.0.0.2' });
      expect(sameClient.status()).toBe(429);

      const otherClient = await calculation(request, base, { 'X-Forwarded-For': '198.51.100.8, 10.0.0.1' });
      expect(otherClient.status()).toBe(200);
    });
  });

  test.describe('TRUST_PROXY unset', () => {
    test.describe.configure({ mode: 'serial' });
    const serverUrl = useOwnServer({ staticDir: null, env: SLOW_REFILL });

    test('the X-Forwarded-For header is ignored: changing it does not buy a new bucket', async ({ request }) => {
      const base = serverUrl();

      for (let i = 1; i <= BURST; i++) {
        const res = await calculation(request, base, { 'X-Forwarded-For': `192.0.2.${i}` });
        expect(res.status(), `request ${i} fits in the burst`).toBe(200);
      }

      const sixth = await calculation(request, base, { 'X-Forwarded-For': '192.0.2.200' });
      await expectProblem(sixth, { status: 429, code: 'RATE_LIMITED', instance: '/api/v1/calculations' });
    });
  });

  test.describe('RATE_LIMIT_PER_MINUTE=0', () => {
    test.describe.configure({ mode: 'serial' });
    const serverUrl = useOwnServer({ staticDir: null, env: { RATE_LIMIT_PER_MINUTE: '0', RATE_LIMIT_BURST: '1' } });

    test('the limiter is off: 40 quick requests all return 200', async ({ request }) => {
      const base = serverUrl();
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) {
        statuses.push((await calculation(request, base)).status());
      }

      expect(statuses.filter((status) => status !== 200)).toEqual([]);
      expect(statuses).toHaveLength(40);
    });
  });
});
