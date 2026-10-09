import { spawnSync } from 'node:child_process';
import { repoRoot } from './contract';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const WINDOWS = process.platform === 'win32';

/** Runs a command with an argument array and returns its exit code and output. On Windows npm and npx need a shell, so their arguments must not contain spaces. */
export function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    shell: WINDOWS && (command === 'npm' || command === 'npx'),
    timeout: options.timeoutMs ?? 10 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function npm(args: string[], env?: Record<string, string>): RunResult {
  return run('npm', args, { env });
}

export function docker(args: string[], timeoutMs = 5 * 60_000): RunResult {
  return run('docker', args, { timeoutMs });
}
