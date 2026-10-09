import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../../lib/fixtures';
import {
  CalculatorPage,
  KEY_LABELS,
  KEY_NAMES,
  type ButtonName,
  type KeyName,
} from '../../lib/ui';

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type Violation = AxeResults['violations'][number];

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SCHEMES = ['light', 'dark'] as const;
const MAX_TABS = 80;
const FOCUS_TRANSITION_MS = 250;

interface Scenario {
  name: string;
  viewport: { width: number; height: number };
  prepare: (calc: CalculatorPage) => Promise<void>;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'fresh page',
    viewport: { width: 1280, height: 800 },
    prepare: async () => undefined,
  },
  {
    name: 'error state',
    viewport: { width: 1280, height: 800 },
    prepare: async (calc) => {
      await calc.press('1', 'Divide', '0', 'Equals');
      await expect(calc.alert()).toBeVisible();
    },
  },
  {
    name: 'History open on a phone',
    viewport: { width: 360, height: 640 },
    prepare: async (calc) => {
      await calc.press('2', 'Add', '3', 'Equals');
      await calc.historyDisclosure().click();
      await expect(calc.historyDisclosure()).toHaveAttribute('aria-expanded', 'true');
      await expect(calc.historyEntry('2 + 3 = 5')).toBeVisible();
    },
  },
  {
    name: 'History open on a desktop',
    viewport: { width: 1280, height: 800 },
    prepare: async (calc) => {
      await calc.press('2', 'Add', '3', 'Equals');
      await expect(calc.historyEntry('2 + 3 = 5')).toBeVisible();
    },
  },
];

function describeViolations(violations: Violation[]): string[] {
  return violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'no impact'}): ` +
      violation.nodes.map((node) => String(node.target)).join(' | '),
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Runs inside the page: which key has focus, and does it show a focus indicator? */
function readFocus(keys: Element[]): { index: number; indicator: boolean } {
  const active = document.activeElement;
  if (!active) return { index: -1, indicator: false };
  const style = getComputedStyle(active);
  const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  return { index: keys.indexOf(active), indicator: outline || style.boxShadow !== 'none' };
}

test.describe('3.10 Accessibility and runtime health', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const scenario of SCENARIOS) {
    for (const scheme of SCHEMES) {
      test(`axe finds no WCAG A or AA violations: ${scenario.name}, ${scheme} mode`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize(scenario.viewport);
        const calc = new CalculatorPage(page);
        await calc.open();
        await scenario.prepare(calc);

        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

        expect(describeViolations(results.violations)).toEqual([]);
      });
    }
  }

  test('the document has lang="en" and a non-empty title', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle(/\S/);
  });

  test('the page has exactly one main element and one h1', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('the display sits inside role="status" with aria-live="polite"', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    const region = page.locator('[role="status"][aria-live="polite"]');

    await expect(region).toHaveCount(1);
    await expect(region.getByTestId('display')).toHaveText('0');

    await calc.press('2', 'Add', '3', 'Equals');
    await expect(region.getByTestId('display')).toHaveText('5');
  });

  test('every button has an accessible name from the UI contract', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    // One calculation gives History an entry, which brings the Clear history button.
    await calc.press('2', 'Add', '3', 'Equals');
    await expect(calc.historyEntries()).toHaveCount(1);

    const contractButtons: ButtonName[] = [...KEY_NAMES, 'Clear history'];
    for (const name of contractButtons) {
      await expect(calc.button(name), `${name} should exist exactly once`).toHaveCount(1);
    }

    const allowed = new RegExp(
      `^(?:${[...contractButtons, 'History', '2 + 3 = 5'].map(escapeRegExp).join('|')})$`,
    );
    const buttons = page.getByRole('button');
    const total = await buttons.count();
    expect(total).toBeGreaterThanOrEqual(contractButtons.length);
    for (let index = 0; index < total; index++) {
      await expect(buttons.nth(index)).toHaveAccessibleName(allowed);
    }
  });

  test('every key shows the visible label from the UI contract', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await calc.press('2', 'Add', '3', 'Equals');

    for (const name of KEY_NAMES) {
      await expect
        .soft(calc.button(name), `${name} label`)
        .toHaveText(KEY_LABELS[name], { useInnerText: true });
    }
    await expect
      .soft(calc.button('Clear history'), 'Clear history label')
      .toHaveText('Clear', { useInnerText: true });
  });

  test('Tab reaches every key and each focused key shows a focus indicator', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    const handles = await Promise.all(
      KEY_NAMES.map(async (name) => {
        const handle = await calc.button(name).elementHandle();
        if (!handle) throw new Error(`The ${name} key isn't in the DOM.`);
        return handle;
      }),
    );

    const reached = new Set<KeyName>();
    const withoutIndicator = new Set<KeyName>();
    for (let presses = 0; presses < MAX_TABS && reached.size < KEY_NAMES.length; presses++) {
      await page.keyboard.press('Tab');
      let focus = await page.evaluate(readFocus, handles);
      const name = KEY_NAMES[focus.index];
      if (name === undefined) continue;
      if (!focus.indicator) {
        // A CSS transition on the outline can still be running right after focus.
        await page.waitForTimeout(FOCUS_TRANSITION_MS);
        focus = await page.evaluate(readFocus, handles);
      }
      reached.add(name);
      if (!focus.indicator) withoutIndicator.add(name);
    }

    expect(KEY_NAMES.filter((name) => !reached.has(name))).toEqual([]);
    expect([...withoutIndicator]).toEqual([]);
  });

  test('loading the page and running 5 calculations logs no console noise and no CSP violation', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const runtime = await calc.watchRuntime();
    const calls = calc.recordCalculations();

    await calc.open();
    await calc.press('2', 'Add', '3', 'Equals');
    await calc.press('9', 'Square root');
    await calc.press('4', 'Reciprocal');
    await calc.press('5', 'Square');
    await calc.press('1', '5', 'Percent', '2', '0', '0', 'Equals');

    await expect(calc.display()).toHaveText('30');
    expect(calls).toHaveLength(5);
    expect(runtime.consoleProblems).toEqual([]);
    expect(runtime.pageErrors).toEqual([]);
    expect(await calc.cspViolations()).toEqual([]);
  });

  test('the page has no inline script and no inline style attribute', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();
    await expect(page.locator('script:not([src])')).toHaveCount(0);
    await expect(page.locator('[style]')).toHaveCount(0);

    // Check again after the page has rendered a result, History and an error.
    await calc.press('9', 'Square root');
    await expect(calc.historyEntries()).toHaveCount(1);
    await calc.press('1', 'Divide', '0', 'Equals');
    await expect(calc.alert()).toBeVisible();

    await expect(page.locator('script:not([src])')).toHaveCount(0);
    await expect(page.locator('[style]')).toHaveCount(0);
  });
});
