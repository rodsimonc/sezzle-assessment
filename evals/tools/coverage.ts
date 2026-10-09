// Eval coverage table (release item 4.6). Run with: npm run evals:coverage
//
// Every "#### N.M" heading of releases/v<version>.md needs one eval file named
// evals/v<version>/<layer>/item-N.M-<slug>.eval.ts with at least 3 expect( calls.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseItems, repoRoot, type ReleaseItem } from '../lib/contract';

/** Smallest number of expect( calls an eval file may have (release file, "Eval conventions"). */
export const MIN_EXPECTS = 3;

export interface EvalSource {
  /** Path from the repository root, with forward slashes. */
  path: string;
  source: string;
}

export interface EvalFileInfo {
  path: string;
  /** Requirement id from the file name, or null when the name doesn't follow item-N.M-slug.eval.ts. */
  id: string | null;
  expectCount: number;
}

/** `covered`: eval found. `thin`: eval found with too few expect( calls. `missing`: no eval. */
export type Mark = 'covered' | 'thin' | 'missing';

export interface CoverageRow {
  id: string;
  title: string;
  files: string[];
  mark: Mark;
}

export interface CoverageReport {
  version: string;
  rows: CoverageRow[];
  files: EvalFileInfo[];
  /** Requirements that have at least one eval file. */
  covered: number;
  total: number;
  /** Rounded down to one decimal, so only a full set of evals can print 100%. */
  percent: number;
  /** One sentence per reason the run fails. Empty means exit 0. */
  problems: string[];
}

export interface CoverageRun {
  report: CoverageReport;
  output: string;
  exitCode: 0 | 1;
}

const FILE_NAME = /^item-(\d+\.\d+)-.+\.eval\.ts$/;

/** Returns the requirement id from an eval file name such as item-1.10-square.eval.ts. */
export function parseEvalFileName(fileName: string): { id: string } | null {
  const match = FILE_NAME.exec(fileName);
  return match?.[1] ? { id: match[1] } : null;
}

/**
 * Counts expect( calls, including expect.soft( and expect.poll(. Block comments that open a line
 * and whole-line // comments are dropped first, so commented-out assertions don't count. Helper
 * calls such as expectProblem( don't count either.
 */
export function countExpects(source: string): number {
  const code = source.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/.*$/gm, '');
  return (code.match(/\bexpect(?:\.(?:soft|poll))?\s*\(/g) ?? []).length;
}

function toPercent(covered: number, total: number): number {
  if (total === 0) return 0;
  return Math.floor((covered / total) * 1000) / 10;
}

function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

/** Pure core: compares the release headings with the eval files and lists every problem. */
export function buildReport(
  version: string,
  items: readonly ReleaseItem[],
  sources: readonly EvalSource[],
): CoverageReport {
  const files: EvalFileInfo[] = sources
    .map((entry) => ({
      path: entry.path,
      id: parseEvalFileName(path.posix.basename(entry.path))?.id ?? null,
      expectCount: countExpects(entry.source),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const headingIds = new Set(items.map((item) => item.id));
  const filesById = new Map<string, EvalFileInfo[]>();
  for (const file of files) {
    if (file.id === null) continue;
    filesById.set(file.id, [...(filesById.get(file.id) ?? []), file]);
  }

  const rows: CoverageRow[] = items.map((item) => {
    const matches = filesById.get(item.id) ?? [];
    let mark: Mark = 'covered';
    if (matches.length === 0) mark = 'missing';
    else if (matches.some((file) => file.expectCount < MIN_EXPECTS)) mark = 'thin';
    return { id: item.id, title: item.title, files: matches.map((file) => file.path), mark };
  });

  const problems: string[] = [];
  if (items.length === 0) {
    problems.push(`releases/v${version}.md has no "#### N.M" requirement headings.`);
  }
  for (const row of rows) {
    if (row.mark === 'missing') {
      problems.push(
        `Requirement ${row.id} (${row.title}) has no eval. Expected evals/v${version}/<layer>/item-${row.id}-<slug>.eval.ts.`,
      );
    }
  }
  for (const file of files) {
    if (file.id === null) {
      problems.push(`${file.path} doesn't follow the item-<id>-<slug>.eval.ts naming.`);
    } else if (!headingIds.has(file.id)) {
      problems.push(`${file.path} matches no "#### ${file.id}" heading in releases/v${version}.md.`);
    }
  }
  for (const [id, matches] of filesById) {
    if (matches.length > 1) {
      problems.push(
        `Requirement ${id} has ${matches.length} eval files: ${matches.map((file) => file.path).join(', ')}.`,
      );
    }
  }
  for (const file of files) {
    if (file.expectCount < MIN_EXPECTS) {
      problems.push(`${file.path} has ${file.expectCount} expect( calls. The minimum is ${MIN_EXPECTS}.`);
    }
  }

  const covered = rows.filter((row) => row.mark !== 'missing').length;
  return {
    version,
    rows,
    files,
    covered,
    total: items.length,
    percent: toPercent(covered, items.length),
    problems,
  };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

const MARKS: Record<Mark, string> = { covered: '[x]', thin: '[!]', missing: '[ ]' };

/** The summary line that the delivery eval for item 4.6 and the release checklist read. */
export function summaryLine(report: CoverageReport): string {
  return `Eval coverage: ${report.covered}/${report.total} requirements (${formatPercent(report.percent)})`;
}

export function formatReport(report: CoverageReport): string {
  const idWidth = Math.max(2, ...report.rows.map((row) => row.id.length));
  const titleWidth = Math.max(11, ...report.rows.map((row) => row.title.length));
  const fileCells = report.rows.map((row) => (row.files.length > 0 ? row.files.join(', ') : '(none)'));
  const fileWidth = Math.max(9, ...fileCells.map((cell) => cell.length));

  const lines: string[] = [];
  lines.push(`Eval coverage for release v${report.version}`, '');
  lines.push(`${pad('Id', idWidth)}  ${pad('Requirement', titleWidth)}  ${pad('Eval file', fileWidth)}  Mark`);
  lines.push(`${'-'.repeat(idWidth)}  ${'-'.repeat(titleWidth)}  ${'-'.repeat(fileWidth)}  ----`);
  report.rows.forEach((row, index) => {
    lines.push(
      `${pad(row.id, idWidth)}  ${pad(row.title, titleWidth)}  ${pad(fileCells[index] ?? '', fileWidth)}  ${MARKS[row.mark]}`,
    );
  });
  lines.push('', '[x] eval found   [ ] no eval   [!] eval found with too few expect( calls', '');
  lines.push(summaryLine(report), '');

  lines.push(`expect( calls per eval file (minimum ${MIN_EXPECTS})`);
  if (report.files.length === 0) lines.push('  (no eval files)');
  for (const file of report.files) {
    const flag = file.expectCount < MIN_EXPECTS ? `  <- needs at least ${MIN_EXPECTS}` : '';
    lines.push(`${String(file.expectCount).padStart(4)}  ${file.path}${flag}`);
  }
  lines.push('');

  if (report.problems.length === 0) {
    lines.push('Result: PASS');
  } else {
    lines.push(`Result: FAIL (${report.problems.length} problem${report.problems.length === 1 ? '' : 's'})`);
    for (const problem of report.problems) lines.push(`  - ${problem}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Finds every *.eval.ts under evals/v<version>, with paths relative to `root`. */
export function collectEvalFiles(version: string, root: string = repoRoot): EvalSource[] {
  const base = path.join(root, 'evals', `v${version}`);
  const found: EvalSource[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.eval.ts')) {
        found.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          source: readFileSync(full, 'utf8'),
        });
      }
    }
  };

  if (existsSync(base)) walk(base);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

export interface RunOptions {
  version?: string;
  root?: string;
  /** Requirement headings. Defaults to the ones in releases/v<version>.md. */
  items?: readonly ReleaseItem[];
}

export function runCoverage(options: RunOptions = {}): CoverageRun {
  const version = options.version ?? '1.0.0';
  const root = options.root ?? repoRoot;
  const items = options.items ?? releaseItems(version);
  const report = buildReport(version, items, collectEvalFiles(version, root));
  return { report, output: formatReport(report), exitCode: report.problems.length === 0 ? 0 : 1 };
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  const there = path.resolve(entry);
  return process.platform === 'win32' ? here.toLowerCase() === there.toLowerCase() : here === there;
}

function main(): void {
  const version = (process.argv[2] ?? '1.0.0').replace(/^v/, '');
  try {
    const run = runCoverage({ version });
    process.stdout.write(run.output);
    process.exitCode = run.exitCode;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Could not build the eval coverage table for v${version}: ${reason}\n`);
    process.exitCode = 1;
  }
}

if (isEntryPoint()) main();
