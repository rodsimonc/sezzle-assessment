import { test, expect } from '../../lib/fixtures';
import { CalculatorPage, type CalculationBody } from '../../lib/ui';

type FollowKey = 'Enter' | 'Backspace' | 'Escape';

interface Row {
  typed: string;
  then?: FollowKey;
  display: string;
  request?: CalculationBody;
}

// The golden case table of item 3.8, with the request each calculation should send.
const ROWS: Row[] = [
  { typed: '2+3', then: 'Enter', display: '5', request: { operation: 'add', operands: [2, 3] } },
  { typed: '2*3=', display: '6', request: { operation: 'multiply', operands: [2, 3] } },
  {
    typed: '9/3',
    then: 'Enter',
    display: '3',
    request: { operation: 'divide', operands: [9, 3] },
  },
  {
    typed: '2^3',
    then: 'Enter',
    display: '8',
    request: { operation: 'power', operands: [2, 3] },
  },
  {
    typed: '15%200',
    then: 'Enter',
    display: '30',
    request: { operation: 'percentage', operands: [15, 200] },
  },
  {
    typed: '7-10',
    then: 'Enter',
    display: '-3',
    request: { operation: 'subtract', operands: [7, 10] },
  },
  { typed: '1.5', display: '1.5' },
  { typed: '123', then: 'Backspace', display: '12' },
  { typed: '123', then: 'Escape', display: '0' },
];

interface KeyLogWindow {
  __evalKeydowns?: KeyboardEvent[];
}

test.describe('3.8 Keyboard input', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const row of ROWS) {
    const followed = row.then ? ` then ${row.then}` : '';
    test(`typing ${row.typed}${followed} shows ${row.display}`, async ({ page }) => {
      const calc = new CalculatorPage(page);
      const calls = calc.recordCalculations();
      await calc.open();

      await page.keyboard.type(row.typed);
      if (row.then) await page.keyboard.press(row.then);

      await expect(calc.display()).toHaveText(row.display);
      await calc.settled();
      expect(calls).toEqual(row.request ? [row.request] : []);
    });
  }

  test('Escape also drops a pending operator', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await page.keyboard.type('2+3');
    await expect(calc.expression()).toHaveText('2 +');
    await page.keyboard.press('Escape');

    await expect(calc.display()).toHaveText('0');
    await expect(calc.expression()).toHaveText('');
  });

  test('Enter after clicking the on-screen 5 evaluates once and does not press 5 again', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();
    await calc.press('2', 'Add', '5');
    // A mouse click leaves the button focused. The call makes that explicit.
    await calc.button('5').focus();
    await expect(calc.button('5')).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(calc.display()).toHaveText('7');
    await expect(calc.display()).not.toHaveText('55');
    await calc.settled();
    expect(calls).toEqual([{ operation: 'add', operands: [2, 5] }]);
  });

  test('Ctrl+R and Ctrl+C are left alone', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await page.addInitScript(() => {
      const log: KeyboardEvent[] = [];
      (window as unknown as KeyLogWindow).__evalKeydowns = log;
      // Capture phase on window runs before the page's own listeners. The event objects keep
      // their defaultPrevented flag, so reading it later shows what the page did.
      window.addEventListener('keydown', (event) => log.push(event), true);
    });
    await calc.open();
    await page.keyboard.type('12');
    await expect(calc.display()).toHaveText('12');

    await page.keyboard.press('Control+r');
    await page.keyboard.press('Control+c');

    const seen = await page.evaluate(() =>
      ((window as unknown as KeyLogWindow).__evalKeydowns ?? [])
        .filter((event) => event.ctrlKey && event.key !== 'Control')
        .map((event) => ({ key: event.key.toLowerCase(), prevented: event.defaultPrevented })),
    );
    expect(seen).toEqual([
      { key: 'r', prevented: false },
      { key: 'c', prevented: false },
    ]);
    await expect(calc.display()).toHaveText('12');

    await page.keyboard.type('3');
    await expect(calc.display()).toHaveText('123');
  });
});
