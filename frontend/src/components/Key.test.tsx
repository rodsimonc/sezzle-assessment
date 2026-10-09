import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Key } from './Key';

describe('Key', () => {
  it('is a button named by its label when name and label match', () => {
    render(<Key name="7" label="7" variant="digit" onPress={vi.fn()} />);

    const button = screen.getByRole('button', { name: '7' });
    expect(button).toHaveTextContent('7');
    expect(button).not.toHaveAttribute('aria-label');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('keeps the contract name for a glyph label', () => {
    render(<Key name="Multiply" label="×" variant="operator" onPress={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Multiply' });
    expect(button).toHaveTextContent('×');
    expect(button).toHaveAttribute('aria-label', 'Multiply');
  });

  it('calls onPress once per click', async () => {
    const onPress = vi.fn();
    render(<Key name="Equals" label="=" variant="equals" onPress={onPress} />);

    await userEvent.click(screen.getByRole('button', { name: 'Equals' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('calls onPress from the keyboard with Space', async () => {
    const onPress = vi.fn();
    render(<Key name="Add" label="+" variant="operator" onPress={onPress} />);
    screen.getByRole('button', { name: 'Add' }).focus();

    await userEvent.keyboard(' ');

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each(['digit', 'operator', 'function', 'memory', 'equals'] as const)(
    'styles the %s variant through a class',
    (variant) => {
      render(<Key name="K" label="K" variant={variant} onPress={vi.fn()} />);

      expect(screen.getByRole('button')).toHaveClass('key', `key--${variant}`);
    },
  );
});
