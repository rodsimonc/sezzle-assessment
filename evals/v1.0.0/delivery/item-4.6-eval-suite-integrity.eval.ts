import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repoRoot } from '../../lib/contract';
import { npm } from '../../lib/exec';

const releases = path.join(repoRoot, 'releases', 'v1.0.0.md');

function evalFiles(): string[] {
  const root = path.join(repoRoot, 'evals', 'v1.0.0');
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(path.join(root, d.name))
        .filter((f) => f.endsWith('.eval.ts'))
        .map((f) => path.join(root, d.name, f)),
    );
}

test.describe('4.6 Eval suite integrity', () => {
  test('the coverage table reports 100% and every heading has an eval', () => {
    const headings = [...readFileSync(releases, 'utf8').matchAll(/^#### (\d+\.\d+) /gm)].map(
      (m) => m[1],
    );
    const names = evalFiles().map((f) => path.basename(f));
    const result = npm(['run', 'evals:coverage']);

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('100%');
    for (const id of headings) {
      expect(
        names.some((n) => n.startsWith(`item-${id}-`)),
        `no eval for ${id}`,
      ).toBe(true);
    }
  });

  test('every eval file has at least 3 expect calls', () => {
    for (const file of evalFiles()) {
      const count = (readFileSync(file, 'utf8').match(/\bexpect(?:\.soft|\.poll)?\(/g) ?? []).length;
      expect(count, path.basename(file)).toBeGreaterThanOrEqual(3);
    }
  });

  test('the mutation audit catches every break and leaves backend/ alone', () => {
    const result = npm(['run', 'evals:audit']);
    const output = result.stdout + result.stderr;

    expect(result.code, output.slice(-3000)).toBe(0);
    const tally = /Mutation audit: (\d+)\/(\d+) killed/.exec(output);
    expect(tally).not.toBeNull();
    expect(Number(tally?.[2])).toBeGreaterThanOrEqual(12);
    expect(tally?.[1]).toBe(tally?.[2]);
    expect(output).not.toMatch(/survived/i);
  });
});
