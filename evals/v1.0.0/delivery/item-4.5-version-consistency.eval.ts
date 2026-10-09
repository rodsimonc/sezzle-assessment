import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repoRoot } from '../../lib/contract';
import { startServer } from '../../lib/server';

const VERSION = '1.0.0';
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');

test.describe('4.5 Version consistency', () => {
  test('the three package.json files name 1.0.0', () => {
    for (const file of ['package.json', 'frontend/package.json', 'evals/package.json']) {
      const pkg = JSON.parse(read(file)) as { version: string };
      expect(pkg.version, file).toBe(VERSION);
    }
  });

  test('version.go and openapi.yaml name 1.0.0', () => {
    expect(read('backend/internal/version/version.go')).toContain(`"${VERSION}"`);
    const info = /^info:\s*\n(?:[ \t]+.*\n)*?[ \t]+version:\s*["']?([^\s"']+)/m.exec(
      read('backend/api/openapi.yaml'),
    );
    expect(info?.[1]).toBe(VERSION);
  });

  test('GET /healthz reports 1.0.0', async () => {
    const server = await startServer();
    try {
      const response = await fetch(`${server.url}/healthz`);
      const body = (await response.json()) as { version: string };
      expect(response.status).toBe(200);
      expect(body.version).toBe(VERSION);
    } finally {
      await server.stop();
    }
  });

  test.skip('the CHANGELOG has a "## [1.0.0] - <date>" heading (after the release closes)', () => {
    expect(read('CHANGELOG.md')).toMatch(/^## \[1\.0\.0\] - \d{4}-\d{2}-\d{2}$/m);
  });
});
