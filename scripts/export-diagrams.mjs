#!/usr/bin/env node
// Exports each docs/diagrams/*.mmd to a PNG next to it with mermaid-cli. Pass --force to rebuild every PNG.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAGRAMS = join(ROOT, 'docs', 'diagrams');
const MMDC = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'mmdc.cmd' : 'mmdc');
const MMDC_ENTRY = join(ROOT, 'node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js');

// Returns the command and the leading arguments that run mermaid-cli.
// Windows cannot execFile a .cmd shim without a shell, so it runs the CLI entry with node.
export function mermaidCommand() {
  return process.platform === 'win32' ? [process.execPath, [MMDC_ENTRY]] : [MMDC, []];
}

// Lists the Mermaid sources in docs/diagrams, sorted by name.
export function listSources(dir = DIAGRAMS) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.mmd'))
    .sort()
    .map((name) => join(dir, name));
}

// Tells whether a PNG is current. A PNG is current when it is at least as new as its source.
export function isCurrent(source, output) {
  return existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs;
}

// Writes the puppeteer config. CI runners need --no-sandbox, and a local Chromium path can come from the environment.
export function puppeteerConfig(env) {
  const config = { args: env.CI ? ['--no-sandbox'] : [] };
  if (env.PUPPETEER_EXECUTABLE_PATH) config.executablePath = env.PUPPETEER_EXECUTABLE_PATH;
  return config;
}

async function exportOne(source, configFile, command, prefix) {
  const output = source.replace(/\.mmd$/, '.png');
  await execFileAsync(
    command,
    [...prefix, '-i', source, '-o', output, '-b', 'white', '-s', '2', '-t', 'neutral', '-p', configFile],
    { cwd: ROOT, timeout: 180000, windowsHide: true },
  );
  return output;
}

async function main() {
  const force = process.argv.includes('--force');
  const sources = listSources();
  if (sources.length === 0) {
    console.error(`export-diagrams: no .mmd files found in ${DIAGRAMS}.`);
    return 1;
  }
  if (!existsSync(MMDC) && !existsSync(MMDC_ENTRY)) {
    console.error('export-diagrams: mermaid-cli is not installed. Run npm ci first.');
    return 1;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'export-diagrams-'));
  const configFile = join(tmp, 'puppeteer.json');
  writeFileSync(configFile, `${JSON.stringify(puppeteerConfig(process.env), null, 2)}\n`);
  const [command, prefix] = mermaidCommand();

  let failures = 0;
  try {
    for (const source of sources) {
      const output = source.replace(/\.mmd$/, '.png');
      if (!force && isCurrent(source, output)) {
        console.log(`skip ${basename(output)} (up to date)`);
        continue;
      }
      try {
        await exportOne(source, configFile, command, prefix);
        console.log(`wrote ${basename(output)}`);
      } catch (error) {
        failures += 1;
        console.error(`export-diagrams: ${basename(source)} failed: ${(error.stderr || error.message).trim()}`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await main());
}
