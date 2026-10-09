import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserHistoryStorage,
  createHistoryStorage,
  HISTORY_KEY,
  HISTORY_LIMIT,
  type HistoryEntry,
} from './storage';

/** The smallest Storage that tests need: a map with the five methods. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function entry(n: number): HistoryEntry {
  return {
    expression: `${n} + 1`,
    result: String(n + 1),
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  };
}

function entries(count: number): HistoryEntry[] {
  return Array.from({ length: count }, (_value, index) => entry(index));
}

describe('createHistoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('loads an empty list when nothing is stored', () => {
    expect(createHistoryStorage(() => storage).load()).toEqual([]);
  });

  it('loads valid entries in stored order', () => {
    storage.setItem(HISTORY_KEY, JSON.stringify([entry(2), entry(1), entry(0)]));

    expect(createHistoryStorage(() => storage).load()).toEqual([entry(2), entry(1), entry(0)]);
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['an empty string', ''],
    ['a JSON object', '{"expression":"2 + 3","result":"5"}'],
    ['a JSON string', '"2 + 3 = 5"'],
    ['JSON null', 'null'],
  ])('loads an empty list from %s', (_name, raw) => {
    storage.setItem(HISTORY_KEY, raw);

    expect(createHistoryStorage(() => storage).load()).toEqual([]);
  });

  it('skips entries that miss a field, have the wrong type or carry a bad timestamp', () => {
    const good = entry(1);
    storage.setItem(
      HISTORY_KEY,
      JSON.stringify([
        { expression: '1 + 1', result: '2' },
        { expression: '1 + 1', result: 2, timestamp: good.timestamp },
        { expression: 7, result: '2', timestamp: good.timestamp },
        { expression: '1 + 1', result: '2', timestamp: 'yesterday' },
        null,
        'text',
        good,
      ]),
    );

    expect(createHistoryStorage(() => storage).load()).toEqual([good]);
  });

  it('drops unknown properties of a stored entry', () => {
    const good = entry(1);
    storage.setItem(HISTORY_KEY, JSON.stringify([{ ...good, extra: true }]));

    expect(createHistoryStorage(() => storage).load()).toEqual([good]);
  });

  it('keeps the newest 50 when more are stored', () => {
    storage.setItem(HISTORY_KEY, JSON.stringify(entries(60)));

    const loaded = createHistoryStorage(() => storage).load();

    expect(loaded).toHaveLength(HISTORY_LIMIT);
    expect(loaded[0]).toEqual(entry(0));
    expect(loaded[HISTORY_LIMIT - 1]).toEqual(entry(HISTORY_LIMIT - 1));
  });

  it('saves a JSON array of expression, result and timestamp under the v1 key', () => {
    createHistoryStorage(() => storage).save([entry(1), entry(0)]);

    expect(HISTORY_KEY).toBe('calculator.history.v1');
    const raw = storage.getItem(HISTORY_KEY);
    expect(JSON.parse(raw ?? 'null')).toEqual([
      { expression: '1 + 1', result: '2', timestamp: entry(1).timestamp },
      { expression: '0 + 1', result: '1', timestamp: entry(0).timestamp },
    ]);
  });

  it('saves at most 50 entries and keeps the front of the list', () => {
    createHistoryStorage(() => storage).save(entries(55));

    const stored = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]') as HistoryEntry[];
    expect(stored).toHaveLength(HISTORY_LIMIT);
    expect(stored[0]).toEqual(entry(0));
  });

  it('round trips: what save writes, load reads back in the same order', () => {
    const history = createHistoryStorage(() => storage);
    history.save(entries(3));

    expect(history.load()).toEqual(entries(3));
  });

  it('saves an empty list as an empty array', () => {
    createHistoryStorage(() => storage).save([]);

    expect(storage.getItem(HISTORY_KEY)).toBe('[]');
  });

  describe('when storage is unavailable', () => {
    const blocked = (): Storage => {
      throw new DOMException('Access denied.', 'SecurityError');
    };

    it('loads an empty list without throwing', () => {
      expect(createHistoryStorage(blocked).load()).toEqual([]);
    });

    it('saves without throwing and serves the list from memory', () => {
      const history = createHistoryStorage(blocked);

      expect(() => {
        history.save(entries(2));
      }).not.toThrow();
      expect(history.load()).toEqual(entries(2));
    });

    it('survives a setItem that throws on quota', () => {
      vi.spyOn(storage, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded.', 'QuotaExceededError');
      });
      const history = createHistoryStorage(() => storage);

      expect(() => {
        history.save(entries(2));
      }).not.toThrow();
    });

    it('survives a getItem that throws', () => {
      vi.spyOn(storage, 'getItem').mockImplementation(() => {
        throw new Error('boom');
      });

      expect(createHistoryStorage(() => storage).load()).toEqual([]);
    });
  });
});

describe('browserHistoryStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('reads and writes window.localStorage', () => {
    browserHistoryStorage.save([entry(1)]);

    expect(window.localStorage.getItem(HISTORY_KEY)).toBe(JSON.stringify([entry(1)]));
    expect(browserHistoryStorage.load()).toEqual([entry(1)]);
  });
});
