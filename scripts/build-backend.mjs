// Builds backend/bin/server (server.exe on Windows). Works from any cwd.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(repoRoot, 'backend');
const output = path.join('bin', process.platform === 'win32' ? 'server.exe' : 'server');

// -C makes Go run inside backend/, so -o and the package path are relative to it.
const result = spawnSync(
  'go',
  ['-C', backendDir, 'build', '-trimpath', '-o', output, './cmd/server'],
  { stdio: 'inherit' },
);

if (result.error) {
  const reason =
    result.error.code === 'ENOENT'
      ? 'Go was not found on PATH. Install Go 1.27 or add its bin folder to PATH.'
      : result.error.message;
  process.stderr.write(`Backend build failed: ${reason}\n`);
  process.exit(1);
}

if (result.status !== 0) {
  process.stderr.write(
    `Backend build failed: go exited with code ${result.status ?? 'unknown'}.\n`,
  );
  process.exit(result.status ?? 1);
}

process.stdout.write(`Built ${path.join(backendDir, output)}\n`);
