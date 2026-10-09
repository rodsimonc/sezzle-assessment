#!/usr/bin/env node
// Runs gofmt, go vet and golangci-lint over the backend and stops at the first failing step.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'backend');
const GOLANGCI_LINT = 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.14.0';

// Tells whether the backend has any Go source, so the scripts can explain a missing backend instead of failing inside go.
function hasGoSources(dir) {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory() ? hasGoSources(join(dir, entry.name)) : entry.name.endsWith(".go"),
  );
}

// Adds the Go install directory to PATH when the shell that started this script predates the Go install.
function withGoOnPath(env) {
  const probe = spawnSync('go', ['version'], { env, stdio: 'ignore', windowsHide: true });
  if (probe.status === 0) return env;
  const goBin = process.platform === 'win32' ? 'C:\\Program Files\\Go\\bin' : '/usr/local/go/bin';
  return { ...env, PATH: `${goBin}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}` };
}

// Returns the unformatted file list gofmt -l prints, one path per line.
export function parseGofmtOutput(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function run(env, command, args, options = {}) {
  return spawnSync(command, args, { env, cwd: ROOT, stdio: 'inherit', windowsHide: true, ...options });
}

function main() {
  if (!hasGoSources(BACKEND)) {
    console.error('lint-backend: backend sources not found (no .go files under backend/), so there is nothing to lint.');
    return 1;
  }
  const env = withGoOnPath(process.env);

  const gofmt = spawnSync('gofmt', ['-l', 'backend'], { env, cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (gofmt.error || gofmt.status !== 0) {
    console.error(`lint-backend: gofmt failed to run${gofmt.stderr ? `: ${gofmt.stderr.trim()}` : '.'}`);
    return 1;
  }
  const unformatted = parseGofmtOutput(gofmt.stdout);
  if (unformatted.length > 0) {
    console.error('lint-backend: gofmt -l lists files that need formatting. Run gofmt -w backend.');
    for (const file of unformatted) console.error(`  ${file}`);
    return 1;
  }
  console.log('lint-backend: gofmt clean.');

  if (run(env, 'go', ['-C', BACKEND, 'vet', './...']).status !== 0) {
    console.error('lint-backend: go vet reported problems.');
    return 1;
  }
  console.log('lint-backend: go vet clean.');

  const golangci = run(env, 'go', ['-C', BACKEND, 'run', GOLANGCI_LINT, 'run', './...']);
  if (golangci.status !== 0) {
    console.error('lint-backend: golangci-lint reported problems.');
    return 1;
  }
  console.log('lint-backend: golangci-lint clean.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
