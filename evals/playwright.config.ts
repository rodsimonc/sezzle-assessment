import { defineConfig, devices } from '@playwright/test';

// No webServer block: lib/fixtures.ts starts one backend per worker, or uses EVAL_BASE_URL.
export default defineConfig({
  testDir: './v1.0.0',
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  projects: [
    {
      name: 'api',
      testMatch: 'api/**/*.eval.ts',
      fullyParallel: true,
    },
    {
      name: 'ui',
      testMatch: 'ui/**/*.eval.ts',
      fullyParallel: true,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'delivery',
      testMatch: 'delivery/**/*.eval.ts',
      timeout: 15 * 60_000,
    },
  ],
});
