import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Display } from './Display';

describe('Display', () => {
  it('shows the value and the pending expression', () => {
    render(<Display value="5" expression="2 +" memoryActive={false} />);

    expect(screen.getByTestId('display')).toHaveTextContent('5');
    expect(screen.getByTestId('expression')).toHaveTextContent('2 +');
  });

  it('leaves the expression empty when nothing is pending', () => {
    render(<Display value="0" expression="" memoryActive={false} />);

    expect(screen.getByTestId('expression')).toBeEmptyDOMElement();
  });

  it('puts both lines inside a polite status region', () => {
    render(<Display value="0" expression="" memoryActive={false} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(within(status).getByTestId('display')).toBeInTheDocument();
    expect(within(status).getByTestId('expression')).toBeInTheDocument();
  });

  it('shows the memory indicator only while memory is in use', () => {
    const { rerender } = render(<Display value="0" expression="" memoryActive={false} />);
    expect(screen.queryByTestId('memory-indicator')).not.toBeInTheDocument();

    rerender(<Display value="0" expression="" memoryActive />);
    expect(screen.getByTestId('memory-indicator')).toHaveTextContent('M');
  });

  it.each([
    ['0', 'lg'],
    ['Error', 'lg'],
    ['1234567890', 'md'],
    ['999999999999999', 'sm'],
    ['-0.333333333333333', 'xs'],
  ])('sizes %s with the %s class hook', (value, size) => {
    render(<Display value={value} expression="" memoryActive={false} />);

    expect(screen.getByTestId('display')).toHaveAttribute('data-size', size);
  });

  it('sets no inline style, so the CSP stays satisfied', () => {
    const { container } = render(<Display value="999999999999999" expression="2 +" memoryActive />);

    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
