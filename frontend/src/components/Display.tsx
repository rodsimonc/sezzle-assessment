import { displaySize } from '../calculator/format';
import { MemoryIndicator } from './MemoryIndicator';

interface DisplayProps {
  /** The number on screen, or `Error`. */
  value: string;
  /** The pending expression, such as `2 +`. Empty when nothing is pending. */
  expression: string;
  memoryActive: boolean;
}

export function Display({ value, expression, memoryActive }: DisplayProps) {
  return (
    <div className="display">
      {memoryActive ? <MemoryIndicator /> : null}
      <div className="display__live" role="status" aria-live="polite">
        <p className="display__expression" data-testid="expression">
          {expression}
        </p>
        <p className="display__value" data-testid="display" data-size={displaySize(value)}>
          {value}
        </p>
      </div>
    </div>
  );
}
