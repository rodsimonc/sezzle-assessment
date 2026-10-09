import { test as base, expect } from '@playwright/test';
import { externalBaseUrl, startServer } from './server';

interface WorkerFixtures {
  sharedServerUrl: string;
}

/**
 * API and UI evals import `test` and `expect` from here. Each worker gets its own backend,
 * or all of them share EVAL_BASE_URL when it's set.
 */
export const test = base.extend<object, WorkerFixtures>({
  sharedServerUrl: [
    async ({}, use) => {
      if (externalBaseUrl) {
        await use(externalBaseUrl);
        return;
      }
      const server = await startServer();
      try {
        await use(server.url);
      } finally {
        await server.stop();
      }
    },
    { scope: 'worker', auto: true },
  ],
  baseURL: async ({ sharedServerUrl }, use) => {
    await use(sharedServerUrl);
  },
});

export { expect };
