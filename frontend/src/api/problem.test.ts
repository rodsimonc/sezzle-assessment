import { describe, expect, it } from 'vitest';
import {
  ApiError,
  describeError,
  NETWORK_ERROR_MESSAGE,
  networkError,
  parseProblem,
  problemError,
  UNEXPECTED_RESPONSE_MESSAGE,
  unexpectedResponseError,
} from './problem';

const FULL = {
  type: 'https://example.test/problems/division-by-zero',
  title: 'Division by zero',
  status: 422,
  detail: 'Division by zero is undefined.',
  instance: '/api/v1/calculations',
  code: 'DIVISION_BY_ZERO',
  requestId: 'req-1',
  errors: [{ field: 'operands[1]', message: 'must not be 0' }],
  retryAfter: 3,
};

describe('parseProblem', () => {
  it('reads every field of a full Problem Details body', () => {
    expect(parseProblem(FULL)).toEqual(FULL);
  });

  it('accepts the minimum: status, detail and code', () => {
    expect(parseProblem({ status: 500, detail: 'Oops.', code: 'INTERNAL' })).toEqual({
      status: 500,
      detail: 'Oops.',
      code: 'INTERNAL',
    });
  });

  it('drops optional fields of the wrong type', () => {
    const problem = parseProblem({
      status: 422,
      detail: 'Nope.',
      code: 'X',
      type: 1,
      title: 2,
      instance: 3,
      requestId: 4,
      retryAfter: '5',
      errors: 'none',
    });
    expect(problem).toEqual({ status: 422, detail: 'Nope.', code: 'X' });
  });

  it('keeps only well formed field errors', () => {
    const problem = parseProblem({
      status: 400,
      detail: 'Bad.',
      code: 'X',
      errors: [{ field: 'a', message: 'b' }, { field: 'c' }, null, 'text', { message: 'd' }],
    });
    expect(problem?.errors).toEqual([{ field: 'a', message: 'b' }]);
  });

  it.each([
    ['null', null],
    ['a string', 'text'],
    ['a number', 7],
    ['an array', [{ status: 422, detail: 'x', code: 'X' }]],
    ['a body without status', { detail: 'x', code: 'X' }],
    ['a string status', { status: '422', detail: 'x', code: 'X' }],
    ['a body without detail', { status: 422, code: 'X' }],
    ['an empty detail', { status: 422, detail: '', code: 'X' }],
    ['a body without code', { status: 422, detail: 'x' }],
    ['a numeric code', { status: 422, detail: 'x', code: 4 }],
  ])('returns null for %s', (_name, body) => {
    expect(parseProblem(body)).toBeNull();
  });
});

describe('ApiError helpers', () => {
  it('builds the network failure with the contract text', () => {
    const error = networkError();
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(
      "Can't reach the calculator service. Check your connection and try again.",
    );
    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(error.problem).toBeUndefined();
  });

  it('builds the unexpected response failure with the contract text', () => {
    const error = unexpectedResponseError();
    expect(error.message).toBe('The calculator service returned an unexpected response.');
    expect(error.message).toBe(UNEXPECTED_RESPONSE_MESSAGE);
    expect(error.problem).toBeUndefined();
  });

  it('uses the problem detail as the message and keeps the problem', () => {
    const problem = {
      status: 422,
      detail: 'Division by zero is undefined.',
      code: 'DIVISION_BY_ZERO',
    };
    const error = problemError(problem);
    expect(error.message).toBe(problem.detail);
    expect(error.problem).toBe(problem);
    expect(error.name).toBe('ApiError');
  });
});

describe('describeError', () => {
  it('returns the message of an ApiError', () => {
    expect(describeError(new ApiError('Custom text.'))).toBe('Custom text.');
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['undefined', undefined],
  ])('reports %s as an unexpected response', (_name, value) => {
    expect(describeError(value)).toBe(UNEXPECTED_RESPONSE_MESSAGE);
  });
});
