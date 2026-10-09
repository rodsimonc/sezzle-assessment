import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * POST /api/v1/calculations with a JSON body. JSON.stringify turns -0 into 0 and 1e999 into
 * null, so use postRaw for those literals.
 */
export async function calculate(
  request: APIRequestContext,
  operation: string,
  operands: unknown[],
): Promise<APIResponse> {
  return request.post('/api/v1/calculations', { data: { operation, operands } });
}

/**
 * Sends `body` byte for byte. Playwright re-encodes a string body that isn't valid JSON when
 * the content type is JSON, which would hide the INVALID_JSON cases, so the body goes out as
 * a Buffer.
 *
 * Playwright always sends a Content-Type header. `'Content-Type': ''` in `headers` sends it
 * empty, and a bare `request.post` with a Buffer sends `application/octet-stream`. A request
 * with no header at all needs node:http.
 */
export async function postRaw(
  request: APIRequestContext,
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  return request.post(path, {
    data: Buffer.from(body, 'utf8'),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
