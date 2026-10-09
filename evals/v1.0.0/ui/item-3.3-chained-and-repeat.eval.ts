import { test, expect } from '../../lib/fixtures';
import { CalculatorPage, type CalculationBody, type KeyName } from '../../lib/ui';

interface Row {
  keys: KeyName[];
  display: string;
  /** Checked when given. */
  expression?: string;
  /** The "API calls" column of the golden case. */
  calls: number;
  /** The bodies those calls send, in order. */
  requests: CalculationBody[];
}

const add = (left: number, right: number): CalculationBody => ({
  operation: 'add',
  operands: [left, right],
});
const multiply = (left: number, right: number): CalculationBody => ({
  operation: 'multiply',
  operands: [left, right],
});

// The golden case table of item 3.3, plus left-to-right evaluation from rule 4.
const ROWS: Row[] = [
  {
    keys: ['2', 'Add', '3', 'Add'],
    display: '5',
    expression: '5 +',
    calls: 1,
    requests: [add(2, 3)],
  },
  {
    keys: ['2', 'Add', '3', 'Add', '4', 'Equals'],
    display: '9',
    calls: 2,
    requests: [add(2, 3), add(5, 4)],
  },
  {
    keys: ['5', 'Multiply', '2', 'Equals'],
    display: '10',
    calls: 1,
    requests: [multiply(5, 2)],
  },
  {
    keys: ['5', 'Multiply', '2', 'Equals', 'Equals'],
    display: '20',
    calls: 2,
    requests: [multiply(5, 2), multiply(10, 2)],
  },
  {
    keys: ['5', 'Multiply', '2', 'Equals', 'Equals', 'Equals'],
    display: '40',
    calls: 3,
    requests: [multiply(5, 2), multiply(10, 2), multiply(20, 2)],
  },
  {
    keys: ['5', 'Add', 'Multiply', '3', 'Equals'],
    display: '15',
    calls: 1,
    requests: [multiply(5, 3)],
  },
  {
    keys: ['2', 'Add', '3', 'Equals', '7'],
    display: '7',
    calls: 1,
    requests: [add(2, 3)],
  },
  {
    keys: ['2', 'Add', '3', 'Equals', 'Multiply', '4', 'Equals'],
    display: '20',
    calls: 2,
    requests: [add(2, 3), multiply(5, 4)],
  },
  { keys: ['Equals'], display: '0', calls: 0, requests: [] },
  {
    keys: ['2', 'Add', '3', 'Multiply', '4', 'Equals'],
    display: '20',
    calls: 2,
    requests: [add(2, 3), multiply(5, 4)],
  },
];

test.describe('3.3 Chained and repeated operations', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const row of ROWS) {
    test(`${row.keys.join(' ')} shows ${row.display} after ${row.calls} API calls`, async ({
      page,
    }) => {
      const calc = new CalculatorPage(page);
      const calls = calc.recordCalculations();
      await calc.open();

      await calc.press(...row.keys);

      await expect(calc.display()).toHaveText(row.display);
      if (row.expression !== undefined) {
        await expect(calc.expression()).toHaveText(row.expression);
      }
      expect(calls).toHaveLength(row.calls);
      expect(calls).toEqual(row.requests);
    });
  }

  test('a second operator replaces the first and the expression line shows the new one', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('5', 'Add');
    await expect(calc.expression()).toHaveText('5 +');

    await calc.press('Multiply');
    await expect(calc.expression()).toHaveText('5 ×');
    await expect(calc.expression()).not.toContainText('+');
    await expect(calc.display()).toHaveText('5');
    expect(calls).toHaveLength(0);
  });
});
