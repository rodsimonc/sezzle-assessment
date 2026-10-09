import type { CalculationRecord } from '../calculator/types';

export const HISTORY_KEY = 'calculator.history.v1';
export const HISTORY_LIMIT = 50;

export interface HistoryEntry extends CalculationRecord {
  /** ISO 8601, set when the calculation finished. */
  timestamp: string;
}

export interface HistoryStorage {
  /** Newest first. Missing, corrupt or unreadable storage gives an empty list. */
  load(): HistoryEntry[];
  /** Keeps the newest 50. Never throws. */
  save(entries: readonly HistoryEntry[]): void;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { expression, result, timestamp } = value as Record<string, unknown>;
  return (
    typeof expression === 'string' &&
    typeof result === 'string' &&
    typeof timestamp === 'string' &&
    !Number.isNaN(Date.parse(timestamp))
  );
}

function parseEntries(raw: string): HistoryEntry[] {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const valid = (data as unknown[]).filter(isHistoryEntry);
    return valid.slice(0, HISTORY_LIMIT).map(({ expression, result, timestamp }) => ({
      expression,
      result,
      timestamp,
    }));
  } catch {
    return [];
  }
}

/**
 * Wraps a Storage in the history rules. `getStorage` is called on every read and write because
 * even touching `window.localStorage` can throw (blocked site data, some private windows).
 * When storage fails, the list lives in memory for the rest of the page's life.
 */
export function createHistoryStorage(getStorage: () => Storage): HistoryStorage {
  let memory: HistoryEntry[] = [];

  return {
    load() {
      try {
        const raw = getStorage().getItem(HISTORY_KEY);
        return raw === null ? [] : parseEntries(raw);
      } catch {
        return [...memory];
      }
    },
    save(entries) {
      memory = entries.slice(0, HISTORY_LIMIT).map((entry) => ({ ...entry }));
      try {
        getStorage().setItem(HISTORY_KEY, JSON.stringify(memory));
      } catch {
        // Quota or blocked storage: the in-memory copy above keeps the list alive.
      }
    },
  };
}

/** The storage the app uses: the browser's localStorage. */
export const browserHistoryStorage: HistoryStorage = createHistoryStorage(
  () => window.localStorage,
);
