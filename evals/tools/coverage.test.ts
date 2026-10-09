// Run from evals/: npx tsx --test tools/coverage.test.ts
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ReleaseItem } from '../lib/contract';
import {
  buildReport,
  collectEvalFiles,
  countExpects,
  formatReport,
  parseEvalFileName,
  runCoverage,
  summaryLine,
  type EvalSource,
} from './coverage';

const ITEMS: ReleaseItem[] = [
  { id: '1.1', title: 'Addition' },
  { id: '1.2', title: 'Subtraction' },
  { id: '2.1', title: 'Calculation endpoint' },
];

const THREE_EXPECTS = 'expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n';

function evalFile(file: string, source: string = THREE_EXPECTS): EvalSource {
  return { path: `evals/v1.0.0/${file}`, source };
}

const FULL_SET: EvalSource[] = [
  evalFile('api/item-1.1-addition.eval.ts'),
  evalFile('api/item-1.2-subtraction.eval.ts'),
  evalFile('api/item-2.1-calculation-endpoint.eval.ts'),
];

describe('parseEvalFileName', () => {
  it('reads the id from item-N.M-slug.eval.ts', () => {
    assert.deepEqual(parseEvalFileName('item-1.1-addition.eval.ts'), { id: '1.1' });
    assert.deepEqual(parseEvalFileName('item-3.10-accessibility.eval.ts'), { id: '3.10' });
  });

  it('rejects names that break the pattern', () => {
    assert.equal(parseEvalFileName('addition.eval.ts'), null);
    assert.equal(parseEvalFileName('item-1.1.eval.ts'), null);
    assert.equal(parseEvalFileName('item-1-addition.eval.ts'), null);
    assert.equal(parseEvalFileName('item-1.1-addition.spec.ts'), null);
  });
});

describe('countExpects', () => {
  it('counts plain, soft and poll assertions', () => {
    const source = 'expect(a).toBe(1);\nexpect.soft(b).toBe(2);\nawait expect.poll(() => c).toBe(3);\n';
    assert.equal(countExpects(source), 3);
  });

  it('ignores whole-line comments and block comments', () => {
    const source = [
      '// expect(a).toBe(1);',
      '  /* expect(b).toBe(2); */',
      '/**',
      ' * expect(c).toBe(3);',
      ' */',
      'expect(d).toBe(4);',
    ].join('\n');
    assert.equal(countExpects(source), 1);
  });

  it('ignores helpers whose names only start with expect', () => {
    assert.equal(countExpects('expectProblem(res, {});\nexpectOk(res);\n'), 0);
  });
});

describe('buildReport', () => {
  it('reports 100% and no problems when every requirement has an eval', () => {
    const report = buildReport('1.0.0', ITEMS, FULL_SET);
    assert.equal(report.covered, 3);
    assert.equal(report.total, 3);
    assert.equal(report.percent, 100);
    assert.deepEqual(report.problems, []);
    assert.deepEqual(
      report.rows.map((row) => row.mark),
      ['covered', 'covered', 'covered'],
    );
    assert.equal(summaryLine(report), 'Eval coverage: 3/3 requirements (100%)');
  });

  it('fails a requirement that has no eval and rounds the percentage down', () => {
    const report = buildReport('1.0.0', ITEMS, FULL_SET.slice(0, 2));
    assert.equal(report.covered, 2);
    assert.equal(report.percent, 66.6);
    assert.equal(summaryLine(report), 'Eval coverage: 2/3 requirements (66.6%)');
    assert.equal(report.rows[2]?.mark, 'missing');
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0] ?? '', /Requirement 2\.1 .* has no eval/);
  });

  it('fails an eval file that matches no heading', () => {
    const report = buildReport('1.0.0', ITEMS, [...FULL_SET, evalFile('api/item-9.9-ghost.eval.ts')]);
    assert.equal(report.covered, 3);
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0] ?? '', /item-9\.9-ghost\.eval\.ts matches no "#### 9\.9" heading/);
  });

  it('fails an eval file whose name has no item id', () => {
    const report = buildReport('1.0.0', ITEMS, [...FULL_SET, evalFile('api/helpers.eval.ts')]);
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0] ?? '', /helpers\.eval\.ts doesn't follow the item-<id>-<slug>/);
  });

  it('fails when two files share an id', () => {
    const report = buildReport('1.0.0', ITEMS, [...FULL_SET, evalFile('ui/item-1.1-addition-again.eval.ts')]);
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0] ?? '', /Requirement 1\.1 has 2 eval files/);
  });

  it('fails a file with 2 expect calls and passes one with exactly 3', () => {
    const thin = evalFile('api/item-1.1-addition.eval.ts', 'expect(a).toBe(1);\nexpect(b).toBe(2);\n');
    const report = buildReport('1.0.0', ITEMS, [thin, ...FULL_SET.slice(1)]);
    assert.equal(report.rows[0]?.mark, 'thin');
    assert.equal(report.covered, 3);
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0] ?? '', /item-1\.1-addition\.eval\.ts has 2 expect\( calls/);
    assert.deepEqual(buildReport('1.0.0', ITEMS, FULL_SET).problems, []);
  });

  it('keeps 1.1 and 1.10 apart', () => {
    const items: ReleaseItem[] = [
      { id: '1.1', title: 'Addition' },
      { id: '1.10', title: 'Square' },
    ];
    const report = buildReport('1.0.0', items, [evalFile('api/item-1.10-square.eval.ts')]);
    assert.equal(report.rows[0]?.mark, 'missing');
    assert.equal(report.rows[1]?.mark, 'covered');
  });

  it('fails when the release file has no requirement headings', () => {
    const report = buildReport('1.0.0', [], []);
    assert.equal(report.percent, 0);
    assert.match(report.problems[0] ?? '', /has no "#### N\.M" requirement headings/);
  });
});

describe('formatReport', () => {
  it('prints one row per requirement with id, title, path and mark', () => {
    const output = formatReport(buildReport('1.0.0', ITEMS, FULL_SET.slice(0, 2)));
    assert.match(output, /^1\.1\s+Addition\s+evals\/v1\.0\.0\/api\/item-1\.1-addition\.eval\.ts\s+\[x\]$/m);
    assert.match(output, /^2\.1\s+Calculation endpoint\s+\(none\)\s+\[ \]$/m);
    assert.match(output, /^Eval coverage: 2\/3 requirements \(66\.6%\)$/m);
    assert.match(output, /^Result: FAIL \(1 problem\)$/m);
  });

  it('flags files with fewer than 3 expect calls in the per-file counts', () => {
    const thin = evalFile('api/item-1.1-addition.eval.ts', 'expect(a).toBe(1);\n');
    const output = formatReport(buildReport('1.0.0', ITEMS, [thin, ...FULL_SET.slice(1)]));
    assert.match(output, /^\s+1\s+evals\/v1\.0\.0\/api\/item-1\.1-addition\.eval\.ts {2}<- needs at least 3$/m);
    assert.match(output, /^\s+3\s+evals\/v1\.0\.0\/api\/item-1\.2-subtraction\.eval\.ts$/m);
    assert.match(output, /\[!\]/);
  });

  it('ends with PASS when nothing is wrong', () => {
    const output = formatReport(buildReport('1.0.0', ITEMS, FULL_SET));
    assert.match(output, /^Result: PASS$/m);
  });
});

describe('collectEvalFiles and runCoverage on disk', () => {
  const folders: string[] = [];

  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  function fixtureRoot(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'eval-coverage-'));
    folders.push(root);
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(root, ...name.split('/'));
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return root;
  }

  it('walks nested folders, keeps only *.eval.ts and returns forward-slash paths', () => {
    const root = fixtureRoot({
      'evals/v1.0.0/api/item-1.1-addition.eval.ts': THREE_EXPECTS,
      'evals/v1.0.0/ui/item-1.2-subtraction.eval.ts': THREE_EXPECTS,
      'evals/v1.0.0/delivery/support.ts': 'export {};',
      'evals/v1.0.0/delivery/.gitkeep': '',
      'evals/v2.0.0/api/item-9.9-other.eval.ts': THREE_EXPECTS,
    });
    assert.deepEqual(
      collectEvalFiles('1.0.0', root).map((file) => file.path),
      ['evals/v1.0.0/api/item-1.1-addition.eval.ts', 'evals/v1.0.0/ui/item-1.2-subtraction.eval.ts'],
    );
  });

  it('returns an empty list when the release folder is missing', () => {
    assert.deepEqual(collectEvalFiles('1.0.0', fixtureRoot({ 'README.md': '' })), []);
  });

  it('exits 0 for a complete tree and 1 once one eval is removed', () => {
    const files = {
      'evals/v1.0.0/api/item-1.1-addition.eval.ts': THREE_EXPECTS,
      'evals/v1.0.0/api/item-1.2-subtraction.eval.ts': THREE_EXPECTS,
      'evals/v1.0.0/ui/item-2.1-calculation-endpoint.eval.ts': THREE_EXPECTS,
    };
    const complete = runCoverage({ version: '1.0.0', root: fixtureRoot(files), items: ITEMS });
    assert.equal(complete.exitCode, 0);

    delete (files as Record<string, string>)['evals/v1.0.0/api/item-1.2-subtraction.eval.ts'];
    const partial = runCoverage({ version: '1.0.0', root: fixtureRoot(files), items: ITEMS });
    assert.equal(partial.exitCode, 1);
    assert.match(partial.output, /Eval coverage: 2\/3 requirements/);
  });
});

describe('command line', () => {
  const evalsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  it('prints the summary line and exits 1 exactly when the result is FAIL', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/coverage.ts'], {
      cwd: evalsDir,
      encoding: 'utf8',
    });
    assert.match(result.stdout, /^Eval coverage: \d+\/\d+ requirements \(\d+(\.\d)?%\)$/m);
    const failed = /^Result: FAIL/m.test(result.stdout);
    assert.equal(result.status, failed ? 1 : 0);
  });

  it('exits 1 with a message when the release file does not exist', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/coverage.ts', '9.9.9'], {
      cwd: evalsDir,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not build the eval coverage table for v9\.9\.9/);
  });

  it('is importable without printing anything', () => {
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '-e', "import('./tools/coverage.ts').then(() => process.stdout.write('imported'))"],
      { cwd: evalsDir, encoding: 'utf8' },
    );
    assert.equal(output, 'imported');
  });
});
