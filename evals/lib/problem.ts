import { expect, type APIResponse } from '@playwright/test';

/** Fixed title per status, from docs/ERROR-CONTRACT.md. */
export const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

export interface ProblemFieldError {
  field: string;
  message: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  requestId: string;
  errors?: ProblemFieldError[];
  retryAfter?: number;
}

export interface ExpectedProblem {
  status: number;
  code: string;
  /** Checked when given. */
  instance?: string;
  /** Exact text when given. Otherwise any non-empty string passes. */
  detail?: string;
}

/** Asserts the full Problem Details contract and returns the parsed body for extra checks. */
export async function expectProblem(res: APIResponse, expected: ExpectedProblem): Promise<Problem> {
  expect(res.status()).toBe(expected.status);
  expect(res.headers()['content-type'] ?? '').toMatch(/^application\/problem\+json/);

  const body = (await res.json()) as Problem;
  expect(body.type).toBe('about:blank');
  expect(body.title).toBe(TITLES[expected.status]);
  expect(body.status).toBe(expected.status);
  expect(body.code).toBe(expected.code);

  if (expected.detail === undefined) {
    expect(typeof body.detail).toBe('string');
    expect(body.detail.length).toBeGreaterThan(0);
  } else {
    expect(body.detail).toBe(expected.detail);
  }

  if (expected.instance !== undefined) {
    expect(body.instance).toBe(expected.instance);
  }

  const headerId = res.headers()['x-request-id'];
  expect(headerId).toBeTruthy();
  expect(body.requestId).toBe(headerId);

  return body;
}
