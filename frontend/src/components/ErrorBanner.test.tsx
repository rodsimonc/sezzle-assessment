import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorBanner } from './ErrorBanner';

describe('ErrorBanner', () => {
  it('renders no alert while there is no message', () => {
    render(<ErrorBanner message={null} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the message in an alert', () => {
    render(<ErrorBanner message="Division by zero is undefined." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Division by zero is undefined.');
  });

  it('removes the alert when the message goes away', () => {
    const { rerender } = render(<ErrorBanner message="Something failed." />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<ErrorBanner message={null} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps its slot so the layout does not jump', () => {
    const { container } = render(<ErrorBanner message={null} />);

    expect(container.querySelector('.error-slot')).toBeInTheDocument();
  });
});
