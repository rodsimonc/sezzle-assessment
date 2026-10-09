import type { Page, Route } from '@playwright/test';
import { test, expect } from '../../lib/fixtures';
import { CalculatorPage, type CalculationBody, type KeyName } from '../../lib/ui';

const DIVISION_BY_ZERO = 'Division by zero is undefined.';
const NEGATIVE_ROOT = "The square root of a negative number isn't a real number.";
const NO_SERVICE = "Can't reach the calculator service. Check your connection and try again.";
const INTERNAL_DETAIL = 'Something went wrong on our side. Quote the request id if you report it.';
const UNEXPECTED_RESPONSE = 'The calculator service returned an unexpected response.';
const STUB_DETAIL = 'This sentence comes from the stubbed API.';

function problemJson(status: number, title: string, code: string, detail: string): string {
  return JSON.stringify({
    type: 'about:blank',
    title,
    status,
    detail,
    instance: '/api/v1/calculations',
    code,
    requestId: '3f9c2b7a1d4e8f60a5b2c9d1e7f3a408',
  });
}

/** Answers the first calculation request with `respond` and lets every later one through. */
async function failFirstRequest(
  page: Page,
  respond: (route: Route) => Promise<void>,
): Promise<void> {
  let failed = false;
  await page.route('**/api/v1/calculations', async (route) => {
    if (failed) {
      await route.continue();
      return;
    }
    failed = true;
    await respond(route);
  });
}

interface BackendError {
  keys: KeyName[];
  detail: string;
  request: CalculationBody;
}

// Errors the real backend produces. The detail comes from docs/ERROR-CONTRACT.md.
const BACKEND_ERRORS: BackendError[] = [
  {
    keys: ['1', 'Divide', '0', 'Equals'],
    detail: DIVISION_BY_ZERO,
    request: { operation: 'divide', operands: [1, 0] },
  },
  {
    keys: ['4', 'Negate', 'Square root'],
    detail: NEGATIVE_ROOT,
    request: { operation: 'sqrt', operands: [-4] },
  },
  {
    keys: ['0', 'Reciprocal'],
    detail: DIVISION_BY_ZERO,
    request: { operation: 'reciprocal', operands: [0] },
  },
];

interface Failure {
  title: string;
  alert: string;
  respond: (route: Route) => Promise<void>;
}

// Failures the browser has to interpret: no response, Problem Details, anything else.
const FAILURES: Failure[] = [
  {
    title: 'an aborted request',
    alert: NO_SERVICE,
    respond: (route) => route.abort('failed'),
  },
  {
    title: 'a 500 Problem Details response',
    alert: INTERNAL_DETAIL,
    respond: (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: problemJson(500, 'Internal Server Error', 'INTERNAL_ERROR', INTERNAL_DETAIL),
      }),
  },
  {
    title: 'a 502 text/html response',
    alert: UNEXPECTED_RESPONSE,
    respond: (route) =>
      route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<html><body><h1>502 Bad Gateway</h1></body></html>',
      }),
  },
  {
    // A page that maps the code to its own sentence would show the division text here.
    title: 'a 422 Problem Details response with a detail of its own',
    alert: STUB_DETAIL,
    respond: (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: problemJson(422, 'Unprocessable Entity', 'DIVISION_BY_ZERO', STUB_DETAIL),
      }),
  },
];

// Rule 9: in the error state only these keys act.
const IGNORED_IN_ERROR: KeyName[] = [
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Power',
  'Percent',
  'Square root',
  'Reciprocal',
  'Square',
  'Negate',
  'Equals',
  'Memory recall',
  'Memory add',
  'Memory subtract',
];

test.describe('3.5 Error handling', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const error of BACKEND_ERRORS) {
    test(`${error.keys.join(' ')} shows Error and the API detail`, async ({ page }) => {
      const calc = new CalculatorPage(page);
      const calls = calc.recordCalculations();
      await calc.open();

      await calc.press(...error.keys);

      await expect(calc.display()).toHaveText('Error');
      await expect(calc.alert()).toHaveText(error.detail);
      // Negate edits the string, so only the final key reached the API.
      expect(calls).toEqual([error.request]);
    });

    test(`a calculation works right after ${error.keys.join(' ')}`, async ({ page }) => {
      const calc = new CalculatorPage(page);
      const calls = calc.recordCalculations();
      await calc.open();

      await calc.press(...error.keys);
      await expect(calc.alert()).toBeVisible();
      await calc.press('2', 'Add', '3', 'Equals');

      await expect(calc.display()).toHaveText('5');
      await expect(calc.alert()).toHaveCount(0);
      expect(calls.at(-1)).toEqual({ operation: 'add', operands: [2, 3] });
    });
  }

  test('1 Divide 0 Equals keeps the history, ignores operator keys and lets a digit clear the alert', async ({
    page,
  }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    await calc.open();
    await calc.press('2', 'Add', '3', 'Equals');
    await expect(calc.historyEntries()).toHaveText(['2 + 3 = 5']);

    await calc.press('1', 'Divide', '0', 'Equals');
    await expect(calc.display()).toHaveText('Error');
    await expect(calc.alert()).toHaveText(DIVISION_BY_ZERO);
    await expect(calc.historyEntries()).toHaveText(['2 + 3 = 5']);

    const callsBefore = calls.length;
    for (const key of IGNORED_IN_ERROR) {
      await calc.tap(key, { force: true });
    }
    await calc.settled();
    await expect(calc.display()).toHaveText('Error');
    await expect(calc.alert()).toHaveText(DIVISION_BY_ZERO);
    await expect(calc.memoryIndicator()).toHaveCount(0);
    expect(calls).toHaveLength(callsBefore);

    await calc.press('5');
    await expect(calc.alert()).toHaveCount(0);
    await expect(calc.display()).toHaveText('5');
  });

  test('All clear leaves the error state and clears the alert', async ({ page }) => {
    const calc = new CalculatorPage(page);
    await calc.open();

    await calc.press('1', 'Divide', '0', 'Equals');
    await expect(calc.alert()).toBeVisible();

    await calc.press('All clear');
    await expect(calc.alert()).toHaveCount(0);
    await expect(calc.display()).toHaveText('0');
  });

  for (const failure of FAILURES) {
    test(`2 Add 3 Equals with ${failure.title} shows the right alert and recovers`, async ({
      page,
    }) => {
      const calc = new CalculatorPage(page);
      const calls = calc.recordCalculations();
      await failFirstRequest(page, failure.respond);
      await calc.open();

      await calc.press('2', 'Add', '3', 'Equals');
      await expect(calc.display()).toHaveText('Error');
      await expect(calc.alert()).toHaveText(failure.alert);
      await expect(calc.historyEntries()).toHaveCount(0);

      await calc.press('2', 'Add', '3', 'Equals');
      await expect(calc.display()).toHaveText('5');
      await expect(calc.alert()).toHaveCount(0);
      expect(calls.at(-1)).toEqual({ operation: 'add', operands: [2, 3] });
    });
  }

  test('key presses are ignored while a request is in flight', async ({ page }) => {
    const calc = new CalculatorPage(page);
    const calls = calc.recordCalculations();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/calculations', async (route) => {
      await gate;
      await route.continue();
    });
    await calc.open();

    try {
      await calc.press('5', 'Add', '3');
      await calc.tap('Equals');
      await expect(calc.busyRegion()).toHaveCount(1);

      // Equals and Add would each send a second request if the page accepted them.
      await calc.tap('Equals', { force: true });
      await calc.tap('Add', { force: true });
      await calc.tap('9', { force: true });
      await page.keyboard.press('Enter');
      await page.keyboard.press('7');
      expect(calls).toHaveLength(1);
    } finally {
      release();
    }

    await calc.settled();
    await expect(calc.display()).toHaveText('8');
    await expect(calc.historyEntries()).toHaveText(['5 + 3 = 8']);
    expect(calls).toEqual([{ operation: 'add', operands: [5, 3] }]);
  });
});
