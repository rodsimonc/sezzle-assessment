import type { CalculatorApi } from '../api/client';
import type { OperationName } from '../api/types';
import { fakeArithmetic } from './fakeArithmetic';

export interface RecordedCall {
  operation: OperationName;
  operands: number[];
}

/** A CalculatorApi for tests. It records every call and can hold or fail the next one. */
export class FakeCalculatorApi implements CalculatorApi {
  readonly calls: RecordedCall[] = [];
  private nextFailure: Error | null = null;
  private gate: Promise<void> | null = null;

  /** The next call rejects with `error`. */
  failNext(error: Error): void {
    this.nextFailure = error;
  }

  /** The next call waits until the returned function runs. Use it to test the in-flight state. */
  holdNext(): () => void {
    let release: () => void = () => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      release();
    };
  }

  async calculate(operation: OperationName, operands: readonly number[]): Promise<number> {
    this.calls.push({ operation, operands: [...operands] });
    const gate = this.gate;
    this.gate = null;
    if (gate) await gate;
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      throw failure;
    }
    return fakeArithmetic(operation, operands);
  }
}
