import { test, expect } from '../../lib/fixtures';
import { CalculatorPage, type CalculationBody, type KeyName } from '../../lib/ui';

interface Row {
  keys: KeyName[];
  /** Every request the sequence sends, in order. The last one is the "last request body" column. */
  requests: CalculationBody[];
  display: string;
  /** All history entries, newest first. The first one is the "history entry" column. */
  history: string[];
}

// The golden case table of item 3.4.
const ROWS: Row[] = [
  {
    keys: ['9', 'Square root'],
    requests: [{ operation: 'sqrt', operands: [9] }],
    display: '3',
    history: ['√(9) = 3'],
  },
  {
    keys: ['4', 'Reciprocal'],
    requests: [{ operation: 'reciprocal', operands: [4] }],
    display: '0.25',
    history: ['1/(4) = 0.25'],
  },
  {
    keys: ['5', 'Square'],
    requests: [{ operation: 'square', operands: [5] }],
    display: '25',
    history: ['(5)² = 25'],
  },
  {
    keys: ['1', '5', 'Percent', '2', '0', '0', 'Equals'],
    requests: [{ operation: 'percentage', operands: [15, 200] }],
    display: '30',
    history: ['15 % 200 = 30'],
  },
  {
    keys: ['2', 'Power', '1', '0', 'Equals'],
    requests: [{ operation: 'power', operands: [2, 10] }],
    display: '1024',
    history: ['2 ^ 10 = 1024'],
  },
  {
    keys: ['3', 'Square', 'Square'],
    requests: [
      { operation: 'square', operands: [3] },
      { operation: 'square', operands: [9] },
    ],
    display: '81',
    history: ['(9)² = 81', '(3)² = 9'],
  },
  {
    keys: ['2', 'Add', '9', 'Square root', 'Equals'],
    requests: [
      { operation: 'sqrt', operands: [9] },
      { operation: 'add', operands: [2, 3] },
    ],
    display: '5',
    history: ['2 + 3 = 5', '√(9) = 3'],
  },
];

test.describe('3.4 Unary and percentage keys', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const row of ROWS) {
    test(`${row.keys.join(' ')} shows ${row.display}`, async ({ page }) => {
      const calc = new CalculatorPage(page);
      const calls = calc.recordCalculations();
      await calc.open();

      await calc.press(...row.keys);

      await expect(calc.display()).toHaveText(row.display);
      await expect(calc.historyEntries()).toHaveText(row.history);
      expect(calls).toEqual(row.requests);
    });
  }

  test('a unary key leaves the pending binary operation pending', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('2', 'Add', '9', 'Square root');

    await expect(calc.display()).toHaveText('3');
    await expect(calc.expression()).toHaveText('2 +');
    expect(calls).toEqual([{ operation: 'sqrt', operands: [9] }]);
  });

  test('Percent puts "15 %" on the expression line and waits for the second number', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('1', '5', 'Percent');

    await expect(calc.expression()).toHaveText('15 %');
    expect(calls).toHaveLength(0);
    await expect(calc.historyEntries()).toHaveCount(0);
  });

  test('after a unary key a digit starts a new number', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await calc.press('9', 'Square root');
    await expect(calc.display()).toHaveText('3');

    await calc.press('5');
    await expect(calc.display()).toHaveText('5');
    await expect(calc.display()).not.toHaveText('35');
  });

  test('after a unary key an operator continues from the number on screen', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('9', 'Square root', 'Add', '1', 'Equals');

    await expect(calc.display()).toHaveText('4');
    expect(calls).toEqual([
      { operation: 'sqrt', operands: [9] },
      { operation: 'add', operands: [3, 1] },
    ]);
  });
});
