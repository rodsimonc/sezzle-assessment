import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { repoRoot } from './contract';

export interface RunningServer {
  url: string;
  stop(): Promise<void>;
}

export interface StartServerOptions {
  /** Extra environment variables. They win over the eval defaults. */
  env?: Record<string, string>;
  /** Folder for STATIC_DIR. `null` runs the server API-only. Default: frontend/dist. */
  staticDir?: string | null;
}

/** Set when the evals should hit an already running service instead of starting one. */
export const externalBaseUrl: string | undefined =
  process.env.EVAL_BASE_URL?.trim().replace(/\/+$/, '') || undefined;

const STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
const STDERR_TAIL_BYTES = 8_192;

// Settings the server reads. A value left over in the caller's shell must not leak in.
const SERVER_ENV_KEYS = [
  'LISTEN_HOST',
  'PORT',
  'RATE_LIMIT_PER_MINUTE',
  'RATE_LIMIT_BURST',
  'TRUST_PROXY',
  'CORS_ALLOWED_ORIGINS',
  'STATIC_DIR',
  'LOG_LEVEL',
  'LOG_FORMAT',
];

/** EVAL_SERVER_BINARY points the evals at another build, such as a mutant from the mutation audit. */
function binaryPath(): string {
  const override = process.env.EVAL_SERVER_BINARY?.trim();
  if (override) return path.resolve(override);
  return path.join(
    repoRoot,
    'backend',
    'bin',
    process.platform === 'win32' ? 'server.exe' : 'server',
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('Could not read the free port from the probe socket.'));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
  });
}

/** Starts backend/bin/server on a free port and resolves once GET /healthz answers 200. */
export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const binary = binaryPath();
  if (!existsSync(binary)) {
    throw new Error(
      `Backend binary not found at ${binary}. Run "npm run build:backend" first, or fix EVAL_SERVER_BINARY.`,
    );
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;

  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of SERVER_ENV_KEYS) delete env[key];
  Object.assign(env, {
    LISTEN_HOST: '127.0.0.1',
    PORT: String(port),
    RATE_LIMIT_PER_MINUTE: '0',
    LOG_LEVEL: 'warn',
    LOG_FORMAT: 'json',
  });
  if (options.staticDir !== null) {
    env.STATIC_DIR = options.staticDir ?? path.join(repoRoot, 'frontend', 'dist');
  }
  Object.assign(env, options.env);

  const child = spawn(binary, [], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let stderrTail = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
  });
  // Nobody reads stdout, but an unread pipe would eventually block the server.
  child.stdout?.resume();

  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });

  const exited = waitForExit(child);
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
  };

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`Could not start ${binary}: ${spawnError.message}`);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The server exited during startup (code ${child.exitCode}, signal ${child.signalCode}).\n${stderrTail}`,
      );
    }
    if (await isHealthy(url)) return { url, stop };
    await sleep(100);
  }

  await stop();
  throw new Error(
    `The server did not answer GET /healthz with 200 within ${STARTUP_TIMEOUT_MS / 1000}s on ${url}.\n${stderrTail}`,
  );
}
