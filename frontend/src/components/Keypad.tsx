import { KEYPAD_KEYS } from '../calculator/keypadLayout';
import type { KeyAction } from '../calculator/types';
import { Key } from './Key';

interface KeypadProps {
  /** True while a request is in flight. */
  busy: boolean;
  onPress: (action: KeyAction) => void;
}

export function Keypad({ busy, onPress }: KeypadProps) {
  return (
    <div
      className="keypad"
      role="group"
      aria-label="Calculator keys"
      aria-busy={busy}
      data-testid="keypad"
    >
      {KEYPAD_KEYS.map((key) => (
        <Key
          key={key.name}
          name={key.name}
          label={key.label}
          variant={key.variant}
          onPress={() => {
            onPress(key.action);
          }}
        />
      ))}
    </div>
  );
}
