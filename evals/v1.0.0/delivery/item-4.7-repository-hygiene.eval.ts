import { test, expect } from '@playwright/test';
import { run } from '../../lib/exec';

const git = (args: string[]) => run('git', args);

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{36}/,
  /password\s*=\s*['"][^'"]+['"]/,
];
const CONVENTIONAL =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w./-]+\))?!?: .+/;

// Skipped until the release is closed: the tree must be clean and the tag must exist only then.
test.describe('4.7 Repository hygiene', () => {
  test.skip(true, 'Runs when the release closes: needs a clean tree, committed history and the v1.0.0 tag.');

  test('git status is empty', () => {
    const status = git(['status', '--porcelain']);
    expect(status.code).toBe(0);
    expect(status.stdout.trim()).toBe('');
  });

  test('no .env is tracked, .env.example is, and no tracked path is build output', () => {
    const files = git(['ls-files']).stdout.split('\n').filter(Boolean);
    expect(files).toContain('.env.example');
    expect(files.filter((f) => /(^|\/)\.env$/.test(f))).toEqual([]);
    expect(files.filter((f) => /(^|\/)(node_modules|dist|bin|test-results)\//.test(f))).toEqual([]);
  });

  test('no tracked file or commit message matches a secret pattern', () => {
    const messages = git(['log', '--format=%B']).stdout;
    const files = git(['ls-files']).stdout.split('\n').filter(Boolean);
    for (const pattern of SECRET_PATTERNS) {
      expect(messages).not.toMatch(pattern);
      const hit = git(['grep', '-lE', pattern.source, '--', ...files.filter((f) => !f.startsWith('evals/'))]);
      expect(hit.stdout.trim(), `pattern ${pattern.source}`).toBe('');
    }
  });

  test('every commit subject follows Conventional Commits and tag v1.0.0 is on HEAD', () => {
    const subjects = git(['log', '--format=%s']).stdout.split('\n').filter(Boolean);
    expect(subjects.filter((s) => !CONVENTIONAL.test(s))).toEqual([]);
    const tagged = git(['tag', '--points-at', 'HEAD']).stdout.split('\n');
    expect(tagged).toContain('v1.0.0');
  });
});
