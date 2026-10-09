import { useCallback, useRef, useState } from 'react';
import type { CalculationRecord } from '../calculator/types';
import {
  browserHistoryStorage,
  HISTORY_LIMIT,
  type HistoryEntry,
  type HistoryStorage,
} from './storage';

export interface HistoryController {
  /** Newest first, at most 50. */
  entries: readonly HistoryEntry[];
  add: (record: CalculationRecord) => void;
  clear: () => void;
}

export function useHistory(storage: HistoryStorage = browserHistoryStorage): HistoryController {
  const [entries, setEntries] = useState<readonly HistoryEntry[]>(() => storage.load());
  // Two calls in one tick must see each other's entry, so the latest list sits in a ref.
  const latest = useRef(entries);

  const commit = useCallback(
    (next: readonly HistoryEntry[]) => {
      latest.current = next;
      storage.save(next);
      setEntries(next);
    },
    [storage],
  );

  const add = useCallback(
    (record: CalculationRecord) => {
      const entry: HistoryEntry = { ...record, timestamp: new Date().toISOString() };
      commit([entry, ...latest.current].slice(0, HISTORY_LIMIT));
    },
    [commit],
  );

  const clear = useCallback(() => {
    commit([]);
  }, [commit]);

  return { entries, add, clear };
}
