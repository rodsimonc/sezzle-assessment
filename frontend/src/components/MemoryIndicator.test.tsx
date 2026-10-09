import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryIndicator } from './MemoryIndicator';

describe('MemoryIndicator', () => {
  it('shows the letter M under the memory-indicator test id', () => {
    render(<MemoryIndicator />);

    expect(screen.getByTestId('memory-indicator')).toHaveTextContent(/^M$/);
  });

  it('has a name a screen reader can say', () => {
    render(<MemoryIndicator />);

    expect(screen.getByRole('img', { name: 'Memory in use' })).toBeInTheDocument();
  });
});
