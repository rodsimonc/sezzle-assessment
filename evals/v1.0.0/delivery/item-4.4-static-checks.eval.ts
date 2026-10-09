import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repoRoot } from '../../lib/contract';
import { npm, run } from '../../lib/exec';

function listFiles(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, ext) : ext.test(entry.name) ? [full] : [];
  });
}

test.describe('4.4 Static checks', () => {
  test('npm run lint exits 0', () => {
    const result = npm(['run', 'lint']);
    expect(result.code, result.stdout.slice(-2000) + result.stderr.slice(-2000)).toBe(0);
  });

  test('npm run audit exits 0', () => {
    const result = npm(['run', 'audit']);
    expect(result.code, result.stdout.slice(-2000) + result.stderr.slice(-2000)).toBe(0);
  });

  test('gofmt -l backend prints nothing', () => {
    const result = run('gofmt', ['-l', 'backend']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test('tsc --noEmit passes with strict on', () => {
    const files = listFiles(path.join(repoRoot, 'frontend'), /^tsconfig.*\.json$/).filter(
      (f) => !f.includes(`${path.sep}src${path.sep}`),
    );
    const strict = files.some((f) => /"strict":\s*true/.test(readFileSync(f, 'utf8')));
    const result = run('npx', ['tsc', '--noEmit', '-p', 'frontend'], { timeoutMs: 5 * 60_000 });

    expect(strict).toBe(true);
    expect(result.code, result.stdout).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test('no any, ts-ignore or console.log in the frontend source', () => {
    const files = listFiles(path.join(repoRoot, 'frontend', 'src'), /\.tsx?$/);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/:\s*any\b|\bas any\b|<any>|@ts-ignore|console\.log/);
    }
  });

  test('no panic( outside tests and main, and no fmt.Print in the backend', () => {
    const files = listFiles(path.join(repoRoot, 'backend'), /\.go$/).filter(
      (f) => !f.endsWith('_test.go'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\bfmt\.Print/);
      if (!file.includes(`${path.sep}cmd${path.sep}`)) {
        // Recover re-raises http.ErrAbortHandler with panic(v), as the net/http contract requires.
        const withoutReRaise = text.replace(/panic\(v\)\s*\/\/[^\n]*ErrAbortHandler[^\n]*|panic\(v\)[^\n]*abort[^\n]*/g, '');
        expect(withoutReRaise, file).not.toMatch(/\bpanic\(/);
      }
    }
  });
});
