import type { FieldError, Problem } from './types';

export const NETWORK_ERROR_MESSAGE =
  "Can't reach the calculator service. Check your connection and try again.";

export const UNEXPECTED_RESPONSE_MESSAGE =
  'The calculator service returned an unexpected response.';

/** Every failure the client reports. `message` is safe to show to a person. */
export class ApiError extends Error {
  readonly problem: Problem | undefined;

  constructor(message: string, problem?: Problem) {
    super(message);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

export function networkError(): ApiError {
  return new ApiError(NETWORK_ERROR_MESSAGE);
}

export function unexpectedResponseError(): ApiError {
  return new ApiError(UNEXPECTED_RESPONSE_MESSAGE);
}

export function problemError(problem: Problem): ApiError {
  return new ApiError(problem.detail, problem);
}

/** Text for the error banner. Anything that isn't an ApiError counts as an unexpected response. */
export function describeError(error: unknown): string {
  return error instanceof ApiError ? error.message : UNEXPECTED_RESPONSE_MESSAGE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFieldErrors(value: unknown): FieldError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: FieldError[] = [];
  for (const item of value as unknown[]) {
    if (isRecord(item) && typeof item.field === 'string' && typeof item.message === 'string') {
      items.push({ field: item.field, message: item.message });
    }
  }
  return items;
}

/**
 * Returns the Problem when the body has the Problem Details shape, or null. The media type is
 * not checked: a proxy may relabel the body, and the shape is what the UI relies on.
 */
export function parseProblem(body: unknown): Problem | null {
  if (!isRecord(body)) return null;
  const { status, detail, code } = body;
  if (typeof status !== 'number' || typeof detail !== 'string' || detail === '') return null;
  if (typeof code !== 'string') return null;

  const problem: Problem = { status, detail, code };
  if (typeof body.type === 'string') problem.type = body.type;
  if (typeof body.title === 'string') problem.title = body.title;
  if (typeof body.instance === 'string') problem.instance = body.instance;
  if (typeof body.requestId === 'string') problem.requestId = body.requestId;
  if (typeof body.retryAfter === 'number') problem.retryAfter = body.retryAfter;
  const errors = readFieldErrors(body.errors);
  if (errors) problem.errors = errors;
  return problem;
}
