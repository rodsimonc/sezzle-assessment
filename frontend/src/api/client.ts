import { networkError, parseProblem, problemError, unexpectedResponseError } from './problem';
import type { OperationName } from './types';

/** The only thing the calculator needs from the backend. Tests swap in a fake. */
export interface CalculatorApi {
  calculate(operation: OperationName, operands: readonly number[]): Promise<number>;
}

export const DEFAULT_BASE_URL = '/api/v1';
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpCalculatorApiOptions {
  /** Defaults to `VITE_API_BASE_URL`, then to `/api/v1`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** A request that takes longer is reported as a network failure. */
  timeoutMs?: number;
}

/** Trims whitespace and trailing slashes, and falls back to the default for an empty value. */
export function resolveBaseUrl(configured: string | undefined): string {
  const trimmed = configured?.trim();
  return (trimmed ? trimmed : DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function readResult(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const { result } = body as { result?: unknown };
  return typeof result === 'number' && Number.isFinite(result) ? result : null;
}

export class HttpCalculatorApi implements CalculatorApi {
  private readonly baseUrl: string;
  private readonly send: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpCalculatorApiOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl ?? import.meta.env.VITE_API_BASE_URL);
    // Looked up per call so a stubbed global fetch is picked up, and called without `this`.
    this.send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async calculate(operation: OperationName, operands: readonly number[]): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    let text: string;
    try {
      response = await this.send(`${this.baseUrl}/calculations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ operation, operands }),
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      throw networkError();
    } finally {
      clearTimeout(timer);
    }

    const body = parseJson(text);
    if (response.ok) {
      const result = readResult(body);
      if (result === null) throw unexpectedResponseError();
      return result;
    }

    const problem = parseProblem(body);
    throw problem ? problemError(problem) : unexpectedResponseError();
  }
}
