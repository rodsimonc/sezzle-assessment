import { test } from './fixtures';
import { externalBaseUrl, startServer, type RunningServer, type StartServerOptions } from './server';

export const OWN_SERVER_SKIP_REASON =
  'EVAL_BASE_URL is set, so this eval cannot start a server with its own configuration.';

/**
 * Call inside a test.describe. Starts one server for the group with the options `setup`
 * returns, and stops it after the last test. The group skips itself when EVAL_BASE_URL is set.
 * `teardown` runs after the server has stopped. The returned function gives the server URL.
 */
export function useOwnServer(
  setup: StartServerOptions | (() => StartServerOptions),
  teardown?: () => void,
): () => string {
  let server: RunningServer | undefined;

  test.skip(externalBaseUrl !== undefined, OWN_SERVER_SKIP_REASON);

  test.beforeAll(async () => {
    if (externalBaseUrl !== undefined) return;
    server = await startServer(typeof setup === 'function' ? setup() : setup);
  });

  test.afterAll(async () => {
    try {
      await server?.stop();
    } finally {
      server = undefined;
      teardown?.();
    }
  });

  return () => {
    if (server === undefined) throw new Error('The eval server is not running.');
    return server.url;
  };
}
