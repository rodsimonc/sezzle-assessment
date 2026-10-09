import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KEYPAD_KEYS } from '../calculator/keypadLayout';
import { Keypad } from './Keypad';

describe('Keypad', () => {
  it('renders the 28 keys as buttons with the contract names, in layout order', () => {
    render(<Keypad busy={false} onPress={vi.fn()} />);

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual(KEYPAD_KEYS.map((key) => key.name));
    expect(names).toHaveLength(28);
  });

  it.each(KEYPAD_KEYS.map((key) => [key.name, key] as const))(
    'sends the action of the %s key when it is clicked',
    async (_name, key) => {
      const onPress = vi.fn();
      render(<Keypad busy={false} onPress={onPress} />);

      await userEvent.click(screen.getByRole('button', { name: key.name }));

      expect(onPress).toHaveBeenCalledExactlyOnceWith(key.action);
    },
  );

  it('sets aria-busy to true while a request is in flight', () => {
    render(<Keypad busy onPress={vi.fn()} />);

    expect(screen.getByTestId('keypad')).toHaveAttribute('aria-busy', 'true');
  });

  it('does not report busy when idle', () => {
    render(<Keypad busy={false} onPress={vi.fn()} />);

    expect(screen.getByTestId('keypad')).not.toHaveAttribute('aria-busy', 'true');
  });

  it('puts every key in tab order', async () => {
    render(<Keypad busy={false} onPress={vi.fn()} />);

    const visited: (string | null)[] = [];
    for (let index = 0; index < KEYPAD_KEYS.length; index++) {
      await userEvent.tab();
      visited.push(
        document.activeElement?.getAttribute('aria-label') ??
          document.activeElement?.textContent ??
          null,
      );
    }

    expect(visited).toEqual(KEYPAD_KEYS.map((key) => key.name));
  });
});
