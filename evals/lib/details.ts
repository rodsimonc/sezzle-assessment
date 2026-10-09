/** Fixed `detail` texts from docs/ERROR-CONTRACT.md. Only the codes with one fixed sentence are here. */
export const DETAIL = {
  INVALID_JSON: "The request body isn't valid JSON.",
  INVALID_REQUEST: 'The request body is invalid.',
  INVALID_OPERAND_COUNT: 'The request has the wrong number of operands.',
  DIVISION_BY_ZERO: 'Division by zero is undefined.',
  NEGATIVE_SQUARE_ROOT: "The square root of a negative number isn't a real number.",
  UNDEFINED_RESULT: "The result isn't a real number.",
  RESULT_OUT_OF_RANGE: 'The result is too large to represent.',
  PAYLOAD_TOO_LARGE: 'The request body must be 4096 bytes or smaller.',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type must be application/json.',
  CORS_ORIGIN_NOT_ALLOWED: "Origin isn't allowed.",
} as const;

export type FixedDetailCode = keyof typeof DETAIL;

export function unknownOperationDetail(name: string): string {
  return `Unknown operation "${name}".`;
}

/** `errors[0].message` of INVALID_OPERAND_COUNT, for example "add needs 2 operands, got 1." */
export function operandCountMessage(operation: string, expected: 1 | 2, got: number): string {
  return `${operation} needs ${expected} operand${expected === 1 ? '' : 's'}, got ${got}.`;
}

export function notFoundDetail(method: string, path: string): string {
  return `No route matches ${method} ${path}.`;
}

export function methodNotAllowedDetail(method: string, path: string, allowed: string): string {
  return `${method} isn't allowed on ${path}. Allowed: ${allowed}.`;
}

export function rateLimitDetail(seconds: number): string {
  return `Too many requests. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
}
