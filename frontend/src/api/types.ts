/** The nine operations the backend accepts (release item 2.2). */
export type OperationName =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'power'
  | 'sqrt'
  | 'percentage'
  | 'reciprocal'
  | 'square';

export interface CalculationRequest {
  operation: OperationName;
  operands: readonly number[];
}

export interface CalculationResponse {
  operation: OperationName;
  operands: number[];
  result: number;
}

export interface FieldError {
  field: string;
  message: string;
}

/**
 * RFC 7807 Problem Details as the backend sends them (docs/ERROR-CONTRACT.md). The client only
 * insists on `status`, `detail` and `code`. Everything else is read when present.
 */
export interface Problem {
  type?: string;
  title?: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  requestId?: string;
  errors?: FieldError[];
  retryAfter?: number;
}
