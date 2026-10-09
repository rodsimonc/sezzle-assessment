import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../history/storage';
import { HistoryPanel } from './HistoryPanel';

const NEWER: HistoryEntry = {
  expression: '4 × 5',
  result: '20',
  timestamp: '2026-01-01T00:00:02.000Z',
};
const OLDER: HistoryEntry = {
  expression: '2 + 3',
  result: '5',
  timestamp: '2026-01-01T00:00:01.000Z',
};

function setup(entries: readonly HistoryEntry[] = [NEWER, OLDER]) {
  const onSelect = vi.fn<(entry: HistoryEntry) => void>();
  const onClear = vi.fn<() => void>();
  render(<HistoryPanel entries={entries} onSelect={onSelect} onClear={onClear} />);
  return { onSelect, onClear };
}

describe('HistoryPanel', () => {
  it('is a labelled section named History', () => {
    setup();

    expect(screen.getByRole('region', { name: 'History' })).toBeInTheDocument();
  });

  it('shows the empty state and no list when there are no entries', () => {
    setup([]);
    const section = screen.getByRole('region', { name: 'History' });

    expect(within(section).getByText('No calculations yet.')).toBeInTheDocument();
    expect(within(section).queryByRole('list')).not.toBeInTheDocument();
  });

  it('lists entries newest first, each as one button inside one list item', () => {
    setup();
    const section = screen.getByRole('region', { name: 'History' });

    const items = within(within(section).getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['4 × 5 = 20', '2 + 3 = 5']);
    for (const item of items) {
      expect(within(item).getAllByRole('button')).toHaveLength(1);
    }
    expect(within(section).queryByText('No calculations yet.')).not.toBeInTheDocument();
  });

  it('hands the clicked entry to onSelect', async () => {
    const { onSelect } = setup();

    await userEvent.click(screen.getByRole('button', { name: '2 + 3 = 5' }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(OLDER);
  });

  it('clears through the Clear history button, which shows the word Clear', async () => {
    const { onClear } = setup();
    const clear = screen.getByRole('button', { name: 'Clear history' });

    expect(clear).toHaveTextContent('Clear');
    await userEvent.click(clear);

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('starts collapsed and toggles aria-expanded on the disclosure button', async () => {
    setup();
    const toggle = screen.getByRole('button', { name: 'History' });
    const section = screen.getByRole('region', { name: 'History' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', section.id);
    expect(section).toHaveAttribute('data-open', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(section).toHaveAttribute('data-open', 'true');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks its region so Enter keeps its native job inside it', () => {
    const { container } = render(
      <HistoryPanel entries={[]} onSelect={vi.fn()} onClear={vi.fn()} />,
    );

    expect(container.querySelector('[data-native-enter]')).toBeInTheDocument();
  });
});
