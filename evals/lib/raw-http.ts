import http from 'node:http';
import type { APIResponse } from '@playwright/test';

export interface RawResponse {
  status: number;
  /** Header names are lowercase, as Node reports them. */
  headers: Record<string, string>;
  body: Buffer;
}

export interface RawRequestOptions {
  baseUrl: string;
  method: string;
  /** Goes on the wire as written, so dot segments and %2f survive. URL parsers would rewrite them. */
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

/** One request over node:http with no automatic headers beyond Host, Connection and Content-Length. */
export function rawRequest(options: RawRequestOptions): Promise<RawResponse> {
  const target = new URL(options.baseUrl);
  const payload = options.body === undefined ? undefined : Buffer.from(options.body, 'utf8');
  const headers: Record<string, string> = { ...options.headers };
  if (payload !== undefined) headers['Content-Length'] = String(payload.length);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: target.hostname,
        port: target.port,
        method: options.method,
        path: options.path,
        headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const responseHeaders: Record<string, string> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined) responseHeaders[name] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({ status: res.statusCode ?? 0, headers: responseHeaders, body: Buffer.concat(chunks) });
        });
      },
    );
    req.setTimeout(10_000, () => {
      req.destroy(new Error(`${options.method} ${options.path} timed out after 10s.`));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * Wraps a raw response so lib/problem.ts expectProblem can read it. That helper only calls
 * status(), headers() and json(). The other methods are here so a later caller gets real values.
 */
export function asApiResponse(raw: RawResponse): APIResponse {
  const text = raw.body.toString('utf8');
  const shim = {
    status: () => raw.status,
    ok: () => raw.status >= 200 && raw.status < 300,
    headers: () => raw.headers,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
    body: async () => raw.body,
  };
  return shim as unknown as APIResponse;
}

/** The `baseURL` fixture is typed as optional. Evals that go around Playwright need a plain string. */
export function baseUrlOf(baseURL: string | undefined): string {
  if (!baseURL) throw new Error('The baseURL fixture is empty, so there is no server to call.');
  return baseURL;
}
