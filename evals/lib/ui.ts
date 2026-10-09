import { expect, type Locator, type Page } from '@playwright/test';

/** localStorage key that holds the history (UI contract, rule 12). */
export const HISTORY_STORAGE_KEY = 'calculator.history.v1';

/** Text the History section shows while it has no entries. */
export const EMPTY_HISTORY_TEXT = 'No calculations yet.';

/**
 * Accessible name of every keypad key, mapped to its visible label.
 * Copied from the UI contract table in releases/v1.0.0.md.
 */
export const KEY_LABELS = {
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  'Decimal point': '.',
  Add: '+',
  Subtract: '-',
  Multiply: '×',
  Divide: '÷',
  Power: 'xʸ',
  Percent: '%',
  'Square root': '√',
  Reciprocal: '1/x',
  Square: 'x²',
  Negate: '±',
  Equals: '=',
  'All clear': 'AC',
  Backspace: '⌫',
  'Memory clear': 'MC',
  'Memory recall': 'MR',
  'Memory add': 'M+',
  'Memory subtract': 'M-',
} as const;

export type KeyName = keyof typeof KEY_LABELS;

/** The 28 keypad keys. The History section has one more button, `Clear history`. */
export const KEY_NAMES = Object.keys(KEY_LABELS) as KeyName[];

export type ButtonName = KeyName | 'Clear history';

/** What the page posts to /api/v1/calculations. */
export interface CalculationBody {
  operation: string;
  operands: number[];
}

/** One element of the history array in localStorage. */
export interface HistoryRecord {
  expression: string;
  result: string;
  timestamp: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConsoleProblem {
  type: 'error' | 'warning';
  text: string;
}

/** Live view of what the page reported while a test ran. */
export interface RuntimeLog {
  consoleProblems: ConsoleProblem[];
  pageErrors: string[];
}

interface CspWindow {
  __evalCspViolations?: string[];
}

const SEED_FLAG = '__evalStorageSeeded';

/** Collapses runs of whitespace so text from innerText compares cleanly. */
export function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Page object for the calculator. It knows the accessible names, test ids and ARIA hooks from
 * the UI contract and nothing about the frontend's source code.
 */
export class CalculatorPage {
  constructor(readonly page: Page) {}

  /** Loads the app and waits for the display to read 0. */
  async open(): Promise<void> {
    await this.page.goto('/');
    await expect(this.display()).toHaveText('0');
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await expect(this.display()).toHaveText('0');
  }

  display(): Locator {
    return this.page.getByTestId('display');
  }

  expression(): Locator {
    return this.page.getByTestId('expression');
  }

  alert(): Locator {
    return this.page.getByRole('alert');
  }

  memoryIndicator(): Locator {
    return this.page.getByTestId('memory-indicator');
  }

  /** Matches the keypad container while a request is in flight. */
  busyRegion(): Locator {
    return this.page.locator('[aria-busy="true"]');
  }

  /** `section[aria-label="History"]`, found even while it's collapsed. */
  historySection(): Locator {
    return this.page.locator('section[aria-label="History"]');
  }

  /** The disclosure button that shows below 768 px. */
  historyDisclosure(): Locator {
    return this.page.getByRole('button', { name: 'History', exact: true });
  }

  /** One `li` per entry, newest first. */
  historyEntries(): Locator {
    return this.historySection().locator('li');
  }

  /** The clickable text of one entry, such as `2 + 3 = 5`. */
  historyEntry(text: string): Locator {
    return this.historySection().getByText(text, { exact: true });
  }

  emptyState(): Locator {
    return this.page.getByText(EMPTY_HISTORY_TEXT, { exact: true });
  }

  button(name: ButtonName): Locator {
    return this.page.getByRole('button', { name, exact: true });
  }

  /** Clicks each key in order and waits for the keypad to leave aria-busy between presses. */
  async press(...names: ButtonName[]): Promise<void> {
    for (const name of names) {
      await this.button(name).click();
      await this.settled();
    }
  }

  /**
   * Clicks one key and returns at once. `force` skips the actionability checks, so a key that
   * is disabled or ignored can be pressed to prove nothing happens.
   */
  async tap(name: ButtonName, options: { force?: boolean } = {}): Promise<void> {
    await this.button(name).click({ force: options.force ?? false });
  }

  /** Waits until no element carries aria-busy="true". */
  async settled(): Promise<void> {
    await expect(this.busyRegion()).toHaveCount(0);
  }

  /** Presses the digit keys and the decimal point for text such as `123` or `0.5`. */
  async typeNumber(text: string): Promise<void> {
    for (const char of text) {
      if (char === '.') {
        await this.press('Decimal point');
      } else if (char >= '0' && char <= '9') {
        await this.press(char as KeyName);
      } else {
        throw new Error(`typeNumber can't press "${char}". Use digits and "." only.`);
      }
    }
  }

  async displayText(): Promise<string> {
    return squash((await this.display().textContent()) ?? '');
  }

  async expressionText(): Promise<string> {
    return squash((await this.expression().textContent()) ?? '');
  }

  /** The visible text of every history entry, newest first. */
  async historyTexts(): Promise<string[]> {
    const texts = await this.historyEntries().locator('button').allInnerTexts();
    return texts.map(squash);
  }

  /** Size and position of every keypad key. `box` is null for a key that isn't rendered. */
  async keyBoxes(): Promise<Array<{ name: KeyName; box: Box | null }>> {
    return Promise.all(
      KEY_NAMES.map(async (name) => ({ name, box: await this.button(name).boundingBox() })),
    );
  }

  /**
   * Starts recording every POST to /api/v1/calculations the page makes. The returned array
   * grows as requests go out. A body that isn't JSON shows up as an entry with the operation
   * `<unreadable body>`, which no test expects, so it fails loudly.
   */
  recordCalculations(): CalculationBody[] {
    const calls: CalculationBody[] = [];
    this.page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      if (new URL(request.url()).pathname !== '/api/v1/calculations') return;
      try {
        calls.push(JSON.parse(request.postData() ?? '') as CalculationBody);
      } catch {
        calls.push({ operation: '<unreadable body>', operands: [] });
      }
    });
    return calls;
  }

  /**
   * Starts counting POST requests to any /api/ path, by route interception. The returned array
   * holds one path per request. Call it before open().
   */
  async recordApiPosts(): Promise<string[]> {
    const paths: string[] = [];
    await this.page.route('**/api/**', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') paths.push(new URL(request.url()).pathname);
      await route.continue();
    });
    return paths;
  }

  /**
   * Collects console errors and warnings, uncaught page errors and Content-Security-Policy
   * violations. Call it before open(). Read the violations with cspViolations().
   */
  async watchRuntime(): Promise<RuntimeLog> {
    const log: RuntimeLog = { consoleProblems: [], pageErrors: [] };
    this.page.on('console', (message) => {
      const type = message.type();
      if (type === 'error' || type === 'warning') {
        log.consoleProblems.push({ type, text: message.text() });
      }
    });
    this.page.on('pageerror', (error) => {
      log.pageErrors.push(error.message);
    });
    await this.page.addInitScript(() => {
      const target = window as unknown as CspWindow;
      target.__evalCspViolations = [];
      window.addEventListener(
        'securitypolicyviolation',
        (event) => {
          target.__evalCspViolations?.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
        },
        true,
      );
    });
    return log;
  }

  async cspViolations(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as CspWindow).__evalCspViolations ?? []);
  }

  /**
   * Writes `raw` to the history key before the page's own scripts run. It writes once per tab,
   * so a reload keeps whatever the page saved since.
   */
  async seedStorage(raw: string): Promise<void> {
    await this.page.addInitScript(
      ({ key, value, flag }) => {
        try {
          if (window.sessionStorage.getItem(flag) !== null) return;
          window.sessionStorage.setItem(flag, '1');
          window.localStorage.setItem(key, value);
        } catch {
          // Storage can be blocked, for example on about:blank. The page then starts empty.
        }
      },
      { key: HISTORY_STORAGE_KEY, value: raw, flag: SEED_FLAG },
    );
  }

  async seedHistory(entries: HistoryRecord[]): Promise<void> {
    await this.seedStorage(JSON.stringify(entries));
  }

  /** The raw string under the history key, or null when nothing is stored. */
  async storedHistory(): Promise<string | null> {
    return this.page.evaluate((key) => window.localStorage.getItem(key), HISTORY_STORAGE_KEY);
  }
}
