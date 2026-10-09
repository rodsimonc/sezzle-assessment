import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_LIMIT, type HistoryEntry, type HistoryStorage } from './storage';
import { useHistory } from './useHistory';

function fakeStorage(initial: HistoryEntry[] = []): HistoryStorage & { saved: HistoryEntry[][] } {
  const saved: HistoryEntry[][] = [];
  return {
    saved,
    load: () => initial,
    save: (next) => {
      saved.push([...next]);
    },
  };
}

function stored(n: number): HistoryEntry {
  return { expression: `${n} + 0`, result: String(n), timestamp: '2026-01-01T00:00:00.000Z' };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useHistory', () => {
  it('starts with what the storage loads', () => {
    const { result } = renderHook(() => useHistory(fakeStorage([stored(1)])));

    expect(result.current.entries).toEqual([stored(1)]);
  });

  it('adds the newest entry first, with an ISO timestamp, and saves the list', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T05:06:07.000Z'));
    const storage = fakeStorage([stored(1)]);
    const { result } = renderHook(() => useHistory(storage));

    act(() => {
      result.current.add({ expression: '2 + 3', result: '5' });
    });

    expect(result.current.entries).toEqual([
      { expression: '2 + 3', result: '5', timestamp: '2026-03-04T05:06:07.000Z' },
      stored(1),
    ]);
    expect(storage.saved.at(-1)).toEqual(result.current.entries);
  });

  it('keeps two adds from the same tick', () => {
    const { result } = renderHook(() => useHistory(fakeStorage()));

    act(() => {
      result.current.add({ expression: '1 + 1', result: '2' });
      result.current.add({ expression: '2 + 2', result: '4' });
    });

    expect(result.current.entries.map((item) => item.result)).toEqual(['4', '2']);
  });

  it('caps the list at 50 and drops the oldest', () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_value, index) => stored(index));
    const storage = fakeStorage(full);
    const { result } = renderHook(() => useHistory(storage));

    act(() => {
      result.current.add({ expression: '9 + 9', result: '18' });
    });

    expect(result.current.entries).toHaveLength(HISTORY_LIMIT);
    expect(result.current.entries[0]?.result).toBe('18');
    expect(result.current.entries.at(-1)).toEqual(stored(HISTORY_LIMIT - 2));
    expect(storage.saved.at(-1)).toHaveLength(HISTORY_LIMIT);
  });

  it('clears the list and saves the empty list', () => {
    const storage = fakeStorage([stored(1), stored(2)]);
    const { result } = renderHook(() => useHistory(storage));

    act(() => {
      result.current.clear();
    });

    expect(result.current.entries).toEqual([]);
    expect(storage.saved.at(-1)).toEqual([]);
  });

  it('keeps stable add and clear callbacks across renders', () => {
    const storage = fakeStorage();
    const { result, rerender } = renderHook(() => useHistory(storage));
    const { add, clear } = result.current;

    rerender();

    expect(result.current.add).toBe(add);
    expect(result.current.clear).toBe(clear);
  });
});
