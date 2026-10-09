import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BASE_URL,
  HttpCalculatorApi,
  resolveBaseUrl,
  type HttpCalculatorApiOptions,
} from './client';
import { ApiError, NETWORK_ERROR_MESSAGE, UNEXPECTED_RESPONSE_MESSAGE } from './problem';

function problemResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

function fetchReturning(response: Response | (() => Response)) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(typeof response === 'function' ? response() : response),
  );
}

function apiWith(fetchMock: typeof fetch, options: HttpCalculatorApiOptions = {}) {
  return new HttpCalculatorApi({ fetch: fetchMock, ...options });
}

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('The call was expected to fail.');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('resolveBaseUrl', () => {
  it.each([
    [undefined, DEFAULT_BASE_URL],
    ['', DEFAULT_BASE_URL],
    ['   ', DEFAULT_BASE_URL],
    ['/api/v2', '/api/v2'],
    ['/api/v2///', '/api/v2'],
    ['  http://localhost:8080/api/v1/ ', 'http://localhost:8080/api/v1'],
  ])('turns %j into %j', (configured, expected) => {
    expect(resolveBaseUrl(configured)).toBe(expected);
  });
});

describe('HttpCalculatorApi.calculate', () => {
  it('posts the operation and operands as JSON and returns the result', async () => {
    const fetchMock = fetchReturning(
      new Response(JSON.stringify({ operation: 'add', operands: [2, 3], result: 5 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await apiWith(fetchMock).calculate('add', [2, 3]);

    expect(result).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/calculations');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(init?.body).toBe('{"operation":"add","operands":[2,3]}');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends operands as JSON numbers, negatives and decimals included', async () => {
    const fetchMock = fetchReturning(() => new Response('{"result":-2.5}', { status: 200 }));

    await apiWith(fetchMock).calculate('multiply', [-2.5, 1]);

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"operation":"multiply","operands":[-2.5,1]}');
  });

  it('sends a single operand for a unary operation', async () => {
    const fetchMock = fetchReturning(() => new Response('{"result":3}', { status: 200 }));

    await apiWith(fetchMock).calculate('sqrt', [9]);

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"operation":"sqrt","operands":[9]}');
  });

  it('uses the configured base URL', async () => {
    const fetchMock = fetchReturning(() => new Response('{"result":1}', { status: 200 }));

    await apiWith(fetchMock, { baseUrl: 'http://localhost:8080/api/v1/' }).calculate('add', [0, 1]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/api/v1/calculations');
  });

  it('reads VITE_API_BASE_URL when no base URL is passed', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/from-env/');
    const fetchMock = fetchReturning(() => new Response('{"result":1}', { status: 200 }));

    await apiWith(fetchMock).calculate('add', [0, 1]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/from-env/calculations');
  });

  it('calls the global fetch when none is injected', async () => {
    const globalFetch = fetchReturning(() => new Response('{"result":7}', { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);

    const result = await new HttpCalculatorApi().calculate('add', [3, 4]);

    expect(result).toBe(7);
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it('shows the detail of a 422 Problem Details body', async () => {
    const body = {
      type: 'https://example.test/problems/division-by-zero',
      title: 'Division by zero',
      status: 422,
      detail: 'Division by zero is undefined.',
      instance: '/api/v1/calculations',
      code: 'DIVISION_BY_ZERO',
      requestId: 'req-1',
    };

    const error = await failureOf(
      apiWith(fetchReturning(problemResponse(422, body))).calculate('divide', [1, 0]),
    );

    expect(error.message).toBe('Division by zero is undefined.');
    expect(error.problem?.code).toBe('DIVISION_BY_ZERO');
    expect(error.problem?.status).toBe(422);
  });

  it('shows the detail of a 500 Problem Details body', async () => {
    const body = {
      status: 500,
      detail: 'Something went wrong on our side. Quote the request id if you report it.',
      code: 'INTERNAL_ERROR',
      requestId: 'req-2',
    };

    const error = await failureOf(
      apiWith(fetchReturning(problemResponse(500, body))).calculate('add', [1, 1]),
    );

    expect(error.message).toBe(body.detail);
    expect(error.problem?.requestId).toBe('req-2');
  });

  it('reports a 502 HTML page as an unexpected response', async () => {
    const html = new Response('<html><body>Bad gateway</body></html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });

    const error = await failureOf(apiWith(fetchReturning(html)).calculate('add', [1, 1]));

    expect(error.message).toBe(UNEXPECTED_RESPONSE_MESSAGE);
    expect(error.problem).toBeUndefined();
  });

  it('reports an error body without the Problem Details fields as unexpected', async () => {
    const error = await failureOf(
      apiWith(fetchReturning(problemResponse(400, { message: 'bad' }))).calculate('add', [1, 1]),
    );

    expect(error.message).toBe(UNEXPECTED_RESPONSE_MESSAGE);
  });

  it('reports a 200 response that is not JSON as unexpected', async () => {
    const error = await failureOf(
      apiWith(fetchReturning(new Response('OK', { status: 200 }))).calculate('add', [1, 1]),
    );

    expect(error.message).toBe(UNEXPECTED_RESPONSE_MESSAGE);
  });

  it.each([
    ['a missing result', '{"operation":"add"}'],
    ['a string result', '{"result":"5"}'],
    ['a null result', '{"result":null}'],
    ['a JSON null body', 'null'],
  ])('reports %s as unexpected', async (_name, text) => {
    const error = await failureOf(
      apiWith(fetchReturning(new Response(text, { status: 200 }))).calculate('add', [1, 1]),
    );

    expect(error.message).toBe(UNEXPECTED_RESPONSE_MESSAGE);
  });

  it('reports a rejected fetch as a network failure', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')));

    const error = await failureOf(apiWith(fetchMock).calculate('add', [1, 1]));

    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(error.problem).toBeUndefined();
  });

  it('reports a body that fails while reading as a network failure', async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError('connection reset'));
        },
      }),
      { status: 200 },
    );

    const error = await failureOf(apiWith(fetchReturning(broken)).calculate('add', [1, 1]));

    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('aborts a request that outlasts the timeout and reports a network failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const outcome = failureOf(apiWith(fetchMock, { timeoutMs: 250 }).calculate('add', [1, 1]));
    await vi.advanceTimersByTimeAsync(250);
    const error = await outcome;

    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('leaves no timer running after a quick answer', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchReturning(() => new Response('{"result":2}', { status: 200 }));

    await apiWith(fetchMock).calculate('add', [1, 1]);

    expect(vi.getTimerCount()).toBe(0);
  });
});
