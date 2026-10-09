import type { Page } from '@playwright/test';
import { test, expect } from '../../lib/fixtures';
import { CalculatorPage, KEY_NAMES } from '../../lib/ui';

const MIN_TARGET = 44;
// Layout math in fractional pixels can land a hair under a whole number.
const EPSILON = 0.01;
const FIFTEEN_NINES = '999999999999999';

const NARROW_VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 320, height: 568 },
];

async function openAt(page: Page, width: number, height: number): Promise<CalculatorPage> {
  await page.setViewportSize({ width, height });
  const calc = new CalculatorPage(page);
  await calc.open();
  return calc;
}

async function pageOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

/** Right edge of the keypad (its widest key) and left edge of the History section. */
async function columns(calc: CalculatorPage): Promise<{ keypadRight: number; historyLeft: number }> {
  const keys = await calc.keyBoxes();
  const keypadRight = Math.max(...keys.map(({ box }) => (box ? box.x + box.width : -Infinity)));
  const history = await calc.historySection().boundingBox();
  return { keypadRight, historyLeft: history ? history.x : -Infinity };
}

test.describe('3.9 Responsive layout', () => {
  for (const viewport of NARROW_VIEWPORTS) {
    const size = `${viewport.width}x${viewport.height}`;

    test(`${size}: the fresh page has no horizontal scroll`, async ({ page }) => {
      await openAt(page, viewport.width, viewport.height);

      const { scrollWidth, clientWidth } = await pageOverflow(page);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
    });

    test(`${size}: 15 digits on the display add no horizontal scroll`, async ({ page }) => {
      const calc = await openAt(page, viewport.width, viewport.height);

      await calc.typeNumber(FIFTEEN_NINES);

      await expect(calc.display()).toHaveText(FIFTEEN_NINES);
      const { scrollWidth, clientWidth } = await pageOverflow(page);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });

    test(`${size}: an open History with a long entry adds no horizontal scroll`, async ({
      page,
    }) => {
      const calc = await openAt(page, viewport.width, viewport.height);
      // Operands and result all stay at 15 digits, so only the History entry is long.
      await calc.typeNumber('999999999999998');
      await calc.press('Add', '1', 'Equals');
      await expect(calc.display()).toHaveText(FIFTEEN_NINES);

      await calc.historyDisclosure().click();

      await expect(calc.historyDisclosure()).toHaveAttribute('aria-expanded', 'true');
      await expect(calc.historyEntries()).toHaveCount(1);
      const { scrollWidth, clientWidth } = await pageOverflow(page);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }

  test('360x640: every key is at least 44 by 44 CSS pixels and sits inside the viewport', async ({
    page,
  }) => {
    const calc = await openAt(page, 360, 640);

    const keys = await calc.keyBoxes();

    expect(keys).toHaveLength(KEY_NAMES.length);
    for (const { name, box } of keys) {
      expect.soft(box, `${name} has a layout box`).not.toBeNull();
      if (box === null) continue;
      expect.soft(box.width, `${name} width`).toBeGreaterThanOrEqual(MIN_TARGET - EPSILON);
      expect.soft(box.height, `${name} height`).toBeGreaterThanOrEqual(MIN_TARGET - EPSILON);
      expect.soft(box.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
      expect.soft(box.x + box.width, `${name} right edge`).toBeLessThanOrEqual(360 + EPSILON);
    }
  });

  test('360x640: 15 nines fit inside the display box', async ({ page }) => {
    const calc = await openAt(page, 360, 640);

    await calc.typeNumber(FIFTEEN_NINES);
    await expect(calc.display()).toHaveText(FIFTEEN_NINES);

    const fit = await calc.display().evaluate((element) => {
      // An inline element has no box of its own, so measure against the first block above it.
      let frame: Element = element;
      while (getComputedStyle(frame).display === 'inline' && frame.parentElement) {
        frame = frame.parentElement;
      }
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const box = frame.getBoundingClientRect();
      return {
        textLeft: text.left,
        textRight: text.right,
        boxLeft: box.left,
        boxRight: box.right,
        clipped: frame.scrollWidth - frame.clientWidth,
        viewport: document.documentElement.clientWidth,
      };
    });
    expect(fit.textRight).toBeGreaterThan(fit.textLeft);
    expect(fit.textLeft).toBeGreaterThanOrEqual(fit.boxLeft - 1);
    expect(fit.textRight).toBeLessThanOrEqual(fit.boxRight + 1);
    expect(fit.clipped).toBeLessThanOrEqual(1);
    expect(fit.textRight).toBeLessThanOrEqual(fit.viewport);
  });

  test('360x640: the History disclosure starts collapsed and opens on a click', async ({
    page,
  }) => {
    const calc = await openAt(page, 360, 640);
    await calc.press('2', 'Add', '3', 'Equals');
    const disclosure = calc.historyDisclosure();

    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(calc.historyEntry('2 + 3 = 5')).toBeHidden();

    await disclosure.click();

    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(calc.historySection()).toBeVisible();
    await expect(calc.historyEntry('2 + 3 = 5')).toBeVisible();
  });

  test('360x640: an empty History is hidden until the disclosure opens', async ({ page }) => {
    const calc = await openAt(page, 360, 640);

    await expect(calc.historyDisclosure()).toHaveAttribute('aria-expanded', 'false');
    await expect(calc.emptyState()).toBeHidden();

    await calc.historyDisclosure().click();

    await expect(calc.emptyState()).toBeVisible();
  });

  test('1280x800: History is visible without a click, to the right of the keypad', async ({
    page,
  }) => {
    const calc = await openAt(page, 1280, 800);

    await expect(calc.historySection()).toBeVisible();
    await expect(calc.emptyState()).toBeVisible();
    const { keypadRight, historyLeft } = await columns(calc);
    expect(keypadRight).toBeGreaterThan(0);
    expect(historyLeft).toBeGreaterThanOrEqual(keypadRight);
    const { scrollWidth, clientWidth } = await pageOverflow(page);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('768x900: History is already always visible, to the right of the keypad', async ({
    page,
  }) => {
    const calc = await openAt(page, 768, 900);

    await expect(calc.historySection()).toBeVisible();
    await expect(calc.emptyState()).toBeVisible();
    const { keypadRight, historyLeft } = await columns(calc);
    expect(historyLeft).toBeGreaterThanOrEqual(keypadRight);
  });

  test('767x900: the History disclosure still applies', async ({ page }) => {
    const calc = await openAt(page, 767, 900);

    await expect(calc.historyDisclosure()).toHaveAttribute('aria-expanded', 'false');
    await expect(calc.emptyState()).toBeHidden();
  });
});
