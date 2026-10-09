// Runs the built backend binary and lets it serve frontend/dist. Works from any cwd.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(
  repoRoot,
  'backend',
  'bin',
  process.platform === 'win32' ? 'server.exe' : 'server',
);

if (!existsSync(binary)) {
  process.stderr.write(`Backend binary not found at ${binary}. Run "npm run build" first.\n`);
  process.exit(1);
}

const env = { ...process.env };
if (!env.STATIC_DIR) {
  env.STATIC_DIR = path.join(repoRoot, 'frontend', 'dist');
}

const child = spawn(binary, [], { stdio: 'inherit', env });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // A Windows console sends Ctrl+C to the child too, and child.kill() there is a hard
    // kill that would cut its graceful shutdown short. Waiting is enough.
    if (signal === 'SIGINT' && process.platform === 'win32') return;
    child.kill(signal);
  });
}

child.on('error', (error) => {
  process.stderr.write(`Could not start ${binary}: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (code !== null) process.exit(code);
  process.exit(signal ? 128 + (os.constants.signals[signal] ?? 1) : 1);
});
