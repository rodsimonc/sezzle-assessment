import { test, expect } from '../../lib/fixtures';
import { CalculatorPage, type KeyName } from '../../lib/ui';

interface Row {
  title: string;
  keys: KeyName[];
  display: string;
}

const NINE: KeyName = '9';

// The golden case table of item 3.2, minus the last row (it needs the API, see below).
const ROWS: Row[] = [
  { title: '1 Decimal point 5', keys: ['1', 'Decimal point', '5'], display: '1.5' },
  {
    title: '1 Decimal point Decimal point 5',
    keys: ['1', 'Decimal point', 'Decimal point', '5'],
    display: '1.5',
  },
  { title: 'Decimal point', keys: ['Decimal point'], display: '0.' },
  { title: 'Decimal point 5', keys: ['Decimal point', '5'], display: '0.5' },
  { title: '0 0 7', keys: ['0', '0', '7'], display: '7' },
  { title: '0 0', keys: ['0', '0'], display: '0' },
  { title: '1 2 3 Backspace', keys: ['1', '2', '3', 'Backspace'], display: '12' },
  { title: '5 Backspace', keys: ['5', 'Backspace'], display: '0' },
  { title: '5 Negate', keys: ['5', 'Negate'], display: '-5' },
  { title: '5 Negate Negate', keys: ['5', 'Negate', 'Negate'], display: '5' },
  { title: 'Negate', keys: ['Negate'], display: '0' },
  { title: '1 2 3 All clear', keys: ['1', '2', '3', 'All clear'], display: '0' },
  {
    title: 'sixteen 9 keys',
    keys: Array.from({ length: 16 }, () => NINE),
    display: '9'.repeat(15),
  },
];

test.describe('3.2 Decimals and editing', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const row of ROWS) {
    test(`${row.title} leaves ${row.display} on the display with no API call`, async ({ page }) => {
      const calc = new CalculatorPage(page);
      const posts = await calc.recordApiPosts();
      await calc.open();

      await calc.press(...row.keys);

      await expect(calc.display()).toHaveText(row.display);
      await expect(calc.expression()).toHaveText('');
      expect(posts).toEqual([]);
    });
  }

  test('2 Add 3 Equals Backspace keeps 5 on the display', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const posts = await calc.recordApiPosts();
    await calc.open();

    await calc.press('2', 'Add', '3', 'Equals');
    await expect(calc.display()).toHaveText('5');
    await calc.press('Backspace');

    await expect(calc.display()).toHaveText('5');
    await expect(calc.display()).not.toHaveText('0');
    expect(posts).toEqual(['/api/v1/calculations']);
  });

  test('All clear drops a pending operator, so Equals has nothing to run', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const posts = await calc.recordApiPosts();
    await calc.open();

    await calc.press('2', 'Add', '3', 'All clear');
    await expect(calc.display()).toHaveText('0');
    await expect(calc.expression()).toHaveText('');

    await calc.press('5', 'Equals');
    await expect(calc.display()).toHaveText('5');
    expect(posts).toEqual([]);
  });
});
