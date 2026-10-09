#!/usr/bin/env node
// Runs the backend tests with coverage, writes the HTML report and a JSON summary, and enforces the 90% gate.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'backend');
const OUT_DIR = join(ROOT, 'docs', 'coverage', 'backend');

// Tells whether the backend has any Go source, so the scripts can explain a missing backend instead of failing inside go.
function hasGoSources(dir) {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory() ? hasGoSources(join(dir, entry.name)) : entry.name.endsWith(".go"),
  );
}
export const GATE = 90;

// Adds the Go install directory to PATH when the shell that started this script predates the Go install.
export function withGoOnPath(env) {
  const probe = spawnSync('go', ['version'], { env, stdio: 'ignore', windowsHide: true });
  if (probe.status === 0) return env;
  const goBin = process.platform === 'win32' ? 'C:\\Program Files\\Go\\bin' : '/usr/local/go/bin';
  return { ...env, PATH: `${goBin}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}` };
}

// Computes per-package statement coverage from a Go coverprofile, keyed by path relative to the module.
export function packageStats(profileText, modulePath) {
  const totals = new Map();
  for (const line of profileText.split(/\r?\n/)) {
    const match = /^(.+):\d+\.\d+,\d+\.\d+ (\d+) (\d+)$/.exec(line);
    if (!match) continue;
    const file = match[1];
    const dir = file.slice(0, file.lastIndexOf('/'));
    const relativeDir = dir === modulePath ? '.' : dir.slice(modulePath.length + 1);
    const entry = totals.get(relativeDir) ?? { statements: 0, covered: 0 };
    const count = Number(match[2]);
    entry.statements += count;
    if (Number(match[3]) > 0) entry.covered += count;
    totals.set(relativeDir, entry);
  }
  return Object.fromEntries(
    [...totals].map(([name, { statements, covered }]) => [
      name,
      statements === 0 ? 0 : round1((covered / statements) * 100),
    ]),
  );
}

// Keeps one decimal place, the precision the gate and the report display.
export function round1(value) {
  return Math.round(value * 10) / 10;
}

class CoverageError extends Error {}

function fail(message) {
  throw new CoverageError(message);
}

function main() {
  if (!hasGoSources(BACKEND)) {
    fail('backend sources not found (no .go files under backend/), so there is nothing to measure.');
  }
  const env = withGoOnPath(process.env);
  const tmp = mkdtempSync(join(tmpdir(), 'coverage-backend-'));
  try {
    const profile = join(tmp, 'coverage.out');
    const test = spawnSync(
      'go',
      ['-C', BACKEND, 'test', './...', '-covermode=atomic', `-coverprofile=${profile}`],
      { env, stdio: 'inherit', windowsHide: true },
    );
    if (test.status !== 0) fail('backend tests failed, coverage was not written.');

    const func = spawnSync('go', ['-C', BACKEND, 'tool', 'cover', `-func=${profile}`], {
      env,
      encoding: 'utf8',
      windowsHide: true,
    });
    const totalMatch = /total:\s+\(statements\)\s+([\d.]+)%/.exec(func.stdout ?? '');
    if (func.status !== 0 || !totalMatch) fail('could not read the total from go tool cover -func.');
    const total = round1(Number(totalMatch[1]));

    const modulePath = /^module\s+(\S+)/m.exec(readFileSync(join(BACKEND, 'go.mod'), 'utf8'))[1];
    const packages = packageStats(readFileSync(profile, 'utf8'), modulePath);

    mkdirSync(OUT_DIR, { recursive: true });
    const html = spawnSync(
      'go',
      ['-C', BACKEND, 'tool', 'cover', `-html=${profile}`, '-o', join(OUT_DIR, 'index.html')],
      { env, stdio: 'inherit', windowsHide: true },
    );
    if (html.status !== 0) fail('could not write the HTML coverage report.');

    writeFileSync(join(OUT_DIR, 'summary.json'), `${JSON.stringify({ total, packages }, null, 2)}\n`);
    console.log(`coverage-backend: total ${total}% (gate ${GATE}%).`);
    if (total < GATE) fail(`total ${total}% is under the ${GATE}% gate.`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    if (!(error instanceof CoverageError)) throw error;
    console.error(`coverage-backend: ${error.message}`);
    process.exit(1);
  }
}
