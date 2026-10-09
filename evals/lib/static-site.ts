import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const FIXTURE_ASSET_URL_PATH = '/assets/app-3f9c2b7a.js';

export interface StaticSite {
  /** Pass this as `staticDir` to startServer. */
  dir: string;
  /** Text of the fixture index.html. */
  indexHtml: string;
  /** Sits one level above `dir`. A response that contains it leaked a file from outside the directory. */
  canary: string;
  cleanup(): void;
}

/**
 * A tiny site in a temp folder: index.html, one hashed asset and a canary file outside the site
 * folder. It lets static-hosting evals run without a frontend build and gives path traversal
 * checks something concrete to leak.
 */
export function createStaticSite(): StaticSite {
  const parentDir = mkdtempSync(path.join(tmpdir(), 'calculator-eval-site-'));
  const dir = path.join(parentDir, 'site');
  mkdirSync(path.join(dir, 'assets'), { recursive: true });

  const indexHtml = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>Fixture</title></head>',
    `<body><div id="root"></div><script type="module" src="${FIXTURE_ASSET_URL_PATH}"></script></body>`,
    '</html>',
    '',
  ].join('\n');
  const canary = `CANARY-${randomUUID()}`;

  writeFileSync(path.join(dir, 'index.html'), indexHtml);
  writeFileSync(path.join(dir, FIXTURE_ASSET_URL_PATH.slice(1)), 'export const fixture = 1;\n');
  writeFileSync(path.join(parentDir, 'secret.txt'), `${canary}\n`);

  return {
    dir,
    indexHtml,
    canary,
    cleanup: () => rmSync(parentDir, { recursive: true, force: true, maxRetries: 3 }),
  };
}
