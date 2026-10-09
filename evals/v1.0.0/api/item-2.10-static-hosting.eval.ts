import { notFoundDetail } from '../../lib/details';
import { test, expect } from '../../lib/fixtures';
import { useOwnServer } from '../../lib/own-server';
import { expectProblem } from '../../lib/problem';
import { rawRequest } from '../../lib/raw-http';
import { createStaticSite, FIXTURE_ASSET_URL_PATH, type StaticSite } from '../../lib/static-site';

const ROOT_MARKER = '<div id="root">';

// Paths that try to leave the site folder. They go on the wire untouched, so dot segments and %2f survive.
const TRAVERSAL_PATHS = [
  '/../../etc/passwd',
  '/%2e%2e/%2e%2e/etc/passwd',
  '/..%2f..%2fetc%2fpasswd',
  '/../secret.txt',
  '/%2e%2e/secret.txt',
  '/..%2fsecret.txt',
  '/%2e%2e%2fsecret.txt',
  '/..%5csecret.txt',
  '/assets/../../secret.txt',
];

test.describe('2.10 Static hosting', () => {
  test.describe('STATIC_DIR set', () => {
    test.describe.configure({ mode: 'default' });
    let site: StaticSite | undefined;
    const serverUrl = useOwnServer(
      () => {
        site = createStaticSite();
        return { staticDir: site.dir };
      },
      () => site?.cleanup(),
    );
    const fixtureSite = (): StaticSite => {
      if (site === undefined) throw new Error('The static fixture site was not created.');
      return site;
    };

    test('GET / returns 200, text/html and the page with <div id="root">', async ({ request }) => {
      const res = await request.get(`${serverUrl()}/`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toMatch(/^text\/html/);

      const html = await res.text();
      expect(html).toContain(ROOT_MARKER);
      expect(html).toBe(fixtureSite().indexHtml);
    });

    test('a hashed file under /assets/ is cached for a year and immutable', async ({ request }) => {
      const res = await request.get(`${serverUrl()}${FIXTURE_ASSET_URL_PATH}`);
      expect(res.status()).toBe(200);

      expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(await res.text()).toContain('fixture');
    });

    for (const path of ['/', '/index.html']) {
      test(`GET ${path} carries Cache-Control: no-cache`, async ({ request }) => {
        const res = await request.get(`${serverUrl()}${path}`);
        expect(res.status()).toBe(200);

        expect(res.headers()['cache-control']).toBe('no-cache');
        expect(await res.text()).toContain(ROOT_MARKER);
      });
    }

    for (const path of ['/some/deep/link', '/calculator/history']) {
      test(`GET ${path} falls back to the page served at /`, async ({ request }) => {
        const res = await request.get(`${serverUrl()}${path}`);
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toMatch(/^text\/html/);

        expect(await res.text()).toBe(fixtureSite().indexHtml);
      });
    }

    test('GET /api/v1/nothing still returns the 404 Problem Details, never the page', async ({ request }) => {
      const res = await request.get(`${serverUrl()}/api/v1/nothing`);
      await expectProblem(res, {
        status: 404,
        code: 'NOT_FOUND',
        instance: '/api/v1/nothing',
        detail: notFoundDetail('GET', '/api/v1/nothing'),
      });

      expect(await res.text()).not.toContain(ROOT_MARKER);
    });

    test('the API keeps working next to the site', async ({ request }) => {
      const base = serverUrl();
      const calculation = await request.post(`${base}/api/v1/calculations`, {
        data: { operation: 'add', operands: [2, 3] },
      });
      expect(calculation.status()).toBe(200);
      expect(await calculation.json()).toEqual({ operation: 'add', operands: [2, 3], result: 5 });

      const health = await request.get(`${base}/healthz`);
      expect(health.status()).toBe(200);
    });

    for (const path of TRAVERSAL_PATHS) {
      test(`GET ${path} never returns a file from outside the directory`, async () => {
        const raw = await rawRequest({ baseUrl: serverUrl(), method: 'GET', path });
        const text = raw.body.toString('utf8');

        expect([200, 400, 404]).toContain(raw.status);
        expect(text).not.toContain(fixtureSite().canary);
        expect(text).not.toMatch(/root:.*:0:0/);
        if (raw.status === 200) expect(text).toBe(fixtureSite().indexHtml);
      });
    }

    test('HEAD / returns 200 with no body', async ({ request }) => {
      const res = await request.head(`${serverUrl()}/`);
      expect(res.status()).toBe(200);

      expect((await res.body()).length).toBe(0);
    });

    test('POST / returns 405 METHOD_NOT_ALLOWED', async ({ request }) => {
      const res = await request.post(`${serverUrl()}/`, { data: {} });
      await expectProblem(res, { status: 405, code: 'METHOD_NOT_ALLOWED', instance: '/' });

      expect(res.headers()['allow']).toContain('GET');
    });
  });

  test.describe('STATIC_DIR unset', () => {
    test.describe.configure({ mode: 'default' });
    const serverUrl = useOwnServer({ staticDir: null });

    for (const path of ['/', '/index.html', FIXTURE_ASSET_URL_PATH, '/some/deep/link']) {
      test(`GET ${path} returns 404 NOT_FOUND: the service is API-only`, async ({ request }) => {
        const res = await request.get(`${serverUrl()}${path}`);
        const problem = await expectProblem(res, {
          status: 404,
          code: 'NOT_FOUND',
          instance: path,
          detail: notFoundDetail('GET', path),
        });

        expect(problem).not.toHaveProperty('result');
        expect(await res.text()).not.toContain(ROOT_MARKER);
      });
    }

    test('the API answers without a static directory', async ({ request }) => {
      const base = serverUrl();
      const operations = await request.get(`${base}/api/v1/operations`);
      expect(operations.status()).toBe(200);

      const health = await request.get(`${base}/healthz`);
      expect(health.status()).toBe(200);
    });
  });
});
