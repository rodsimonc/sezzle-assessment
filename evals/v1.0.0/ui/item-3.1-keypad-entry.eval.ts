import { test, expect } from '../../lib/fixtures';
import { CalculatorPage, type CalculationBody, type KeyName } from '../../lib/ui';

interface Row {
  keys: KeyName[];
  body: CalculationBody;
  display: string;
  entry: string;
}

// The golden case table of item 3.1.
const ROWS: Row[] = [
  {
    keys: ['2', 'Add', '3', 'Equals'],
    body: { operation: 'add', operands: [2, 3] },
    display: '5',
    entry: '2 + 3 = 5',
  },
  {
    keys: ['7', 'Subtract', '1', '0', 'Equals'],
    body: { operation: 'subtract', operands: [7, 10] },
    display: '-3',
    entry: '7 - 10 = -3',
  },
  {
    keys: ['6', 'Multiply', '7', 'Equals'],
    body: { operation: 'multiply', operands: [6, 7] },
    display: '42',
    entry: '6 × 7 = 42',
  },
  {
    keys: ['1', '0', 'Divide', '4', 'Equals'],
    body: { operation: 'divide', operands: [10, 4] },
    display: '2.5',
    entry: '10 ÷ 4 = 2.5',
  },
];

test.describe('3.1 Keypad entry', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the page loads with 0 on the display, an empty expression and no request', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await expect(calc.display()).toHaveText('0');
    await expect(calc.expression()).toHaveText('');
    expect(calls).toHaveLength(0);
  });

  for (const row of ROWS) {
    test(`${row.keys.join(' ')} shows ${row.display} after one request`, async ({ page }) => {
      const calc = new CalculatorPage(page);
      const calls = calc.recordCalculations();
      await calc.open();

      await calc.press(...row.keys);

      await expect(calc.display()).toHaveText(row.display);
      await expect(calc.historyEntries()).toHaveText([row.entry]);
      // toEqual compares numbers by type, so a string operand such as "2" fails here.
      expect(calls).toEqual([row.body]);
    });
  }

  test('2 Add puts "2 +" on the expression line and waits for Equals before calling the API', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('2', 'Add');
    await expect(calc.expression()).toHaveText('2 +');

    await calc.press('3');
    await expect(calc.display()).toHaveText('3');
    await expect(calc.expression()).toHaveText('2 +');
    expect(calls).toHaveLength(0);
    await expect(calc.historyEntries()).toHaveCount(0);
  });

  test('the number on the display comes from the API response', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await page.route('**/api/v1/calculations', async (route) => {
      const sent = route.request().postDataJSON() as CalculationBody;
      // 777 is wrong on purpose. A page that does its own arithmetic would show 5.
      await route.fulfill({
        status: 200,
        json: { operation: sent.operation, operands: sent.operands, result: 777 },
      });
    });
    await calc.open();

    await calc.press('2', 'Add', '3', 'Equals');

    await expect(calc.display()).toHaveText('777');
    await expect(calc.display()).not.toHaveText('5');
    await expect(calc.historyEntries()).toHaveText(['2 + 3 = 777']);
  });
});
