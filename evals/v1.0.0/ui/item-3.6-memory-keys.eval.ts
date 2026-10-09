import { test, expect } from '../../lib/fixtures';
import { CalculatorPage, type CalculationBody } from '../../lib/ui';

const add = (memory: number, screen: number): CalculationBody => ({
  operation: 'add',
  operands: [memory, screen],
});
const subtract = (memory: number, screen: number): CalculationBody => ({
  operation: 'subtract',
  operands: [memory, screen],
});

test.describe('3.6 Memory keys', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a fresh page shows no memory indicator', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await expect(calc.memoryIndicator()).toHaveCount(0);
    await expect(calc.display()).toHaveText('0');
  });

  test('5 Memory add shows M, keeps 5 on the display and sends add [0, 5]', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('5', 'Memory add');

    await expect(calc.memoryIndicator()).toHaveText('M');
    await expect(calc.display()).toHaveText('5');
    expect(calls).toEqual([add(0, 5)]);
  });

  test('Memory add and Memory subtract send memory first and the screen second', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('5', 'Memory add', '3', 'Memory add');
    await calc.press('All clear', 'Memory recall');
    await expect(calc.display()).toHaveText('8');

    await calc.press('2', 'Memory subtract');
    await calc.press('All clear', 'Memory recall');
    await expect(calc.display()).toHaveText('6');

    await expect(calc.memoryIndicator()).toHaveText('M');
    expect(calls).toEqual([add(0, 5), add(5, 3), subtract(8, 2)]);
    await expect(calc.historyEntries()).toHaveCount(0);
  });

  test('5 Memory add 5 Memory subtract brings memory back to zero and hides the indicator', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('5', 'Memory add');
    await expect(calc.memoryIndicator()).toHaveText('M');

    await calc.press('5', 'Memory subtract');
    await expect(calc.memoryIndicator()).toHaveCount(0);
    expect(calls).toEqual([add(0, 5), subtract(5, 5)]);
  });

  test('Memory clear hides the indicator and Memory recall then shows 0', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('5', 'Memory add');
    await expect(calc.memoryIndicator()).toHaveText('M');

    await calc.press('Memory clear');
    await expect(calc.memoryIndicator()).toHaveCount(0);

    await calc.press('Memory recall');
    await expect(calc.display()).toHaveText('0');
    expect(calls).toHaveLength(1);
  });

  test('reloading the page resets memory', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await calc.press('5', 'Memory add');
    await expect(calc.memoryIndicator()).toHaveText('M');

    await calc.reload();

    await expect(calc.memoryIndicator()).toHaveCount(0);
    await calc.press('Memory recall');
    await expect(calc.display()).toHaveText('0');
  });

  test('Memory recall puts the value on screen as a finished number', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();

    await calc.press('5', 'Memory add', 'All clear', 'Memory recall');
    await expect(calc.display()).toHaveText('5');

    await calc.press('7');
    await expect(calc.display()).toHaveText('7');
    await expect(calc.display()).not.toHaveText('57');

    await calc.press('Memory recall', 'Add', '1', 'Equals');
    await expect(calc.display()).toHaveText('6');
    expect(calls.at(-1)).toEqual(add(5, 1));
  });

  test('the value that memory holds comes from the API response', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await page.route('**/api/v1/calculations', async (route) => {
      const sent = route.request().postDataJSON() as CalculationBody;
      // 42 is wrong on purpose. A page that adds in the browser would store 5.
      await route.fulfill({
        status: 200,
        json: { operation: sent.operation, operands: sent.operands, result: 42 },
      });
    });
    await calc.open();

    await calc.press('5', 'Memory add', 'All clear', 'Memory recall');

    await expect(calc.display()).toHaveText('42');
    await expect(calc.display()).not.toHaveText('5');
  });
});
