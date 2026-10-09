import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repoRoot } from '../../lib/contract';
import { npm } from '../../lib/exec';

const BACKEND_PACKAGES = ['domain', 'service', 'handler', 'middleware', 'problem', 'config', 'server'];

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}

test.describe('4.2 Unit tests and coverage', () => {
  test('npm test exits 0', () => {
    const result = npm(['test']);
    expect(result.code, result.stdout.slice(-2000) + result.stderr.slice(-2000)).toBe(0);
  });

  test('npm run coverage meets the gates and writes the snapshot', () => {
    const result = npm(['run', 'coverage']);
    expect(result.code, result.stdout.slice(-2000) + result.stderr.slice(-2000)).toBe(0);

    const summary = path.join(repoRoot, 'docs', 'coverage', 'SUMMARY.md');
    expect(existsSync(summary)).toBe(true);
    expect(readFileSync(summary, 'utf8')).toMatch(/\d+\.\d%/);
    expect(existsSync(path.join(repoRoot, 'docs', 'coverage', 'backend', 'index.html'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'docs', 'coverage', 'frontend', 'index.html'))).toBe(true);
  });

  test('every backend package has a test file', () => {
    const files = listFiles(path.join(repoRoot, 'backend', 'internal')).filter((f) =>
      f.endsWith('_test.go'),
    );
    for (const pkg of BACKEND_PACKAGES) {
      const has = files.some((f) => path.basename(path.dirname(f)) === pkg);
      expect(has, `no _test.go file in internal/${pkg}`).toBe(true);
    }
  });

  test('the frontend modules and components have test files', () => {
    const files = listFiles(path.join(repoRoot, 'frontend', 'src'));
    const tests = files.filter((f) => /\.test\.tsx?$/.test(f)).map((f) => path.basename(f));
    const components = files
      .filter((f) => f.includes(`${path.sep}components${path.sep}`))
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
      .map((f) => path.basename(f).replace(/\.tsx$/, ''));

    expect(components.length).toBeGreaterThan(0);
    for (const name of ['reducer', 'client', 'storage', ...components]) {
      expect(
        tests.some((t) => t.startsWith(`${name}.test.`)),
        `missing test for ${name}`,
      ).toBe(true);
    }
  });
});
