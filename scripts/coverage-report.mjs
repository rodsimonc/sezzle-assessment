#!/usr/bin/env node
// Writes docs/coverage/SUMMARY.md from the backend and frontend coverage summaries and enforces both gates.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COVERAGE_DIR = join(ROOT, 'docs', 'coverage');
export const GATES = { backend: 90, frontend: 80 };

// Turns a suite's coverage into a table row, with a pass or fail result against its gate.
export function row(label, percent, gate) {
  const passed = percent >= gate;
  return { label, percent, gate, passed };
}

// Renders the summary table. It carries no timestamp, so reruns on the same numbers produce the same file.
export function renderSummary(rows) {
  const lines = [
    '# Coverage summary',
    '',
    '| Suite | Coverage | Gate | Result |',
    '| --- | ---: | ---: | --- |',
    ...rows.map((r) => `| ${r.label} | ${r.percent.toFixed(1)}% | ${r.gate}% | ${r.passed ? 'pass' : 'fail'} |`),
    '',
  ];
  return lines.join('\n');
}

// Reads the backend total from summary.json written by coverage-backend.mjs.
export function readBackendPercent(json) {
  if (typeof json?.total !== 'number') throw new Error('backend summary has no numeric "total".');
  return json.total;
}

// Reads the frontend line coverage from vitest's json-summary reporter.
export function readFrontendPercent(json) {
  const pct = json?.total?.lines?.pct;
  if (typeof pct !== 'number') throw new Error('frontend summary has no numeric total.lines.pct.');
  return pct;
}

function loadJson(path, hint) {
  if (!existsSync(path)) {
    throw new Error(`missing ${path.slice(ROOT.length + 1).split('\\').join('/')}. ${hint}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const backend = readBackendPercent(
    loadJson(join(COVERAGE_DIR, 'backend', 'summary.json'), 'Run npm run coverage:backend first.'),
  );
  const frontend = readFrontendPercent(
    loadJson(
      join(ROOT, 'frontend', 'coverage', 'coverage-summary.json'),
      'Run npm run coverage:frontend first.',
    ),
  );
  const rows = [
    row('Backend (Go statements)', backend, GATES.backend),
    row('Frontend (lines)', frontend, GATES.frontend),
  ];
  mkdirSync(COVERAGE_DIR, { recursive: true });
  writeFileSync(join(COVERAGE_DIR, 'SUMMARY.md'), renderSummary(rows));

  const failed = rows.filter((r) => !r.passed);
  if (failed.length > 0) {
    for (const r of failed) console.error(`coverage-report: ${r.label} is ${r.percent.toFixed(1)}%, under the ${r.gate}% gate.`);
    process.exit(1);
  }
  console.log('coverage-report: both gates pass. Wrote docs/coverage/SUMMARY.md.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`coverage-report: ${error.message}`);
    process.exit(1);
  }
}
