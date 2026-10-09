import { test, expect } from '../../lib/fixtures';
import { CalculatorPage, HISTORY_STORAGE_KEY, type HistoryRecord } from '../../lib/ui';

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ONE_MINUTE_MS = 60_000;

/** Entry 0 is the newest. The oldest one (index 49 of 50) reads `149 + 1`. */
function seededEntries(count: number): HistoryRecord[] {
  const newest = Date.UTC(2026, 0, 1, 12, 0, 0);
  return Array.from({ length: count }, (_, index) => ({
    expression: `${100 + index} + 1`,
    result: String(101 + index),
    timestamp: new Date(newest - index * ONE_MINUTE_MS).toISOString(),
  }));
}

test.describe('3.7 History', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a fresh page shows the empty state', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await expect(calc.emptyState()).toBeVisible();
    await expect(calc.historyEntries()).toHaveCount(0);
  });

  test('entries read newest first and the empty state goes away', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await calc.press('2', 'Add', '3', 'Equals', '4', 'Multiply', '5', 'Equals');

    await expect(calc.historyEntries()).toHaveText(['4 × 5 = 20', '2 + 3 = 5']);
    await expect(calc.emptyState()).toBeHidden();
  });

  test('the same two entries are there after a reload', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await calc.press('2', 'Add', '3', 'Equals', '4', 'Multiply', '5', 'Equals');
    await expect(calc.historyEntries()).toHaveText(['4 × 5 = 20', '2 + 3 = 5']);

    await calc.reload();

    await expect(calc.historyEntries()).toHaveText(['4 × 5 = 20', '2 + 3 = 5']);
    await expect(calc.display()).toHaveText('0');
  });

  test('clicking 4 × 5 = 20 and then Add 1 Equals shows 21', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();
    await calc.press('2', 'Add', '3', 'Equals', '4', 'Multiply', '5', 'Equals', 'All clear');
    await expect(calc.display()).toHaveText('0');

    await calc.historyEntry('4 × 5 = 20').click();
    await expect(calc.display()).toHaveText('20');

    await calc.press('Add', '1', 'Equals');
    await expect(calc.display()).toHaveText('21');
    expect(calls.at(-1)).toEqual({ operation: 'add', operands: [20, 1] });
  });

  test('clicking an older entry replaces the number on screen and a digit then starts a new number', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await calc.press('2', 'Add', '3', 'Equals', '4', 'Multiply', '5', 'Equals');
    await expect(calc.display()).toHaveText('20');

    await calc.historyEntry('2 + 3 = 5').click();
    await expect(calc.display()).toHaveText('5');

    await calc.press('7');
    await expect(calc.display()).toHaveText('7');
    await expect(calc.display()).not.toHaveText('57');
  });

  test('Clear history empties the list and it stays empty after a reload', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await calc.press('2', 'Add', '3', 'Equals');
    await expect(calc.historyEntries()).toHaveCount(1);

    await calc.press('Clear history');
    await expect(calc.historyEntries()).toHaveCount(0);
    await expect(calc.emptyState()).toBeVisible();

    await calc.reload();
    await expect(calc.historyEntries()).toHaveCount(0);
    await expect(calc.emptyState()).toBeVisible();
  });

  test('with 50 stored entries one more calculation drops the oldest and keeps 50', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    await calc.seedHistory(seededEntries(50));
    await calc.open();
    await expect(calc.historyEntries()).toHaveCount(50);
    await expect(calc.historyEntries().last()).toContainText('149 + 1');

    await calc.press('2', 'Add', '3', 'Equals');

    const entries = calc.historyEntries();
    await expect(entries).toHaveCount(50);
    await expect(entries.first()).toHaveText('2 + 3 = 5');
    await expect(entries.nth(1)).toContainText('100 + 1');
    await expect(entries.last()).toContainText('148 + 1');
    await expect(calc.historySection()).not.toContainText('149 + 1');

    const stored = JSON.parse((await calc.storedHistory()) ?? 'null') as unknown[];
    expect(stored).toHaveLength(50);

    const before = await calc.historyTexts();
    await calc.reload();
    expect(await calc.historyTexts()).toEqual(before);
  });

  test('the stored value is a JSON array of expression, result and an ISO 8601 timestamp', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await calc.press('2', 'Add', '3', 'Equals');
    await expect(calc.historyEntries()).toHaveCount(1);

    const raw = await calc.storedHistory();
    expect(raw, `nothing stored under ${HISTORY_STORAGE_KEY}`).not.toBeNull();
    const stored = JSON.parse(raw ?? 'null') as HistoryRecord[];
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(1);

    const entry = stored[0];
    expect(Object.keys(entry ?? {}).sort()).toEqual(['expression', 'result', 'timestamp']);
    expect(typeof entry?.expression).toBe('string');
    expect(entry?.expression.length).toBeGreaterThan(0);
    expect(entry?.result).toBe('5');
    expect(entry?.timestamp).toMatch(ISO_8601);
    const age = Math.abs(Date.now() - Date.parse(entry?.timestamp ?? ''));
    expect(age).toBeLessThan(ONE_MINUTE_MS);
  });

  test('a stored value of "not json" loads as an empty history without console errors', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const runtime = await calc.watchRuntime();
    await calc.seedStorage('not json');

    await calc.open();

    await expect(calc.emptyState()).toBeVisible();
    await expect(calc.historyEntries()).toHaveCount(0);
    expect(runtime.consoleProblems.filter((problem) => problem.type === 'error')).toEqual([]);
    expect(runtime.pageErrors).toEqual([]);

    await calc.press('2', 'Add', '3', 'Equals');
    await expect(calc.display()).toHaveText('5');
    await expect(calc.historyEntries()).toHaveText(['2 + 3 = 5']);
  });

  for (const value of ['{"not":"an array"}', '[1,"x",null,{"expression":5}]']) {
    test(`a stored value of ${value} loads as an empty history`, async ({ page }) => {
      const calc = new CalculatorPage(page);
      const runtime = await calc.watchRuntime();
      await calc.seedStorage(value);

      await calc.open();

      await expect(calc.emptyState()).toBeVisible();
      await expect(calc.historyEntries()).toHaveCount(0);
      expect(runtime.consoleProblems.filter((problem) => problem.type === 'error')).toEqual([]);
      expect(runtime.pageErrors).toEqual([]);
    });
  }

  test('an error adds no entry', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await calc.press('1', 'Divide', '0', 'Equals');

    await expect(calc.alert()).toBeVisible();
    await expect(calc.historyEntries()).toHaveCount(0);
    await expect(calc.emptyState()).toBeVisible();
    expect([null, '[]']).toContain(await calc.storedHistory());
  });

  test('memory keys add no entry', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('5', 'Memory add', 'All clear', 'Memory recall');
    await calc.press('3', 'Memory subtract', 'Memory clear');

    expect(calls).toHaveLength(2);
    await expect(calc.historyEntries()).toHaveCount(0);
    await expect(calc.emptyState()).toBeVisible();
  });

  test('a unary key adds one entry', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('9', 'Square root');

    await expect(calc.historyEntries()).toHaveText(['√(9) = 3']);
    expect(calls).toEqual([{ operation: 'sqrt', operands: [9] }]);
  });
});
