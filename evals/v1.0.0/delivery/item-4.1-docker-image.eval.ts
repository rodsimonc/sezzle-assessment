import { test, expect } from '@playwright/test';
import { docker, run } from '../../lib/exec';

const IMAGE = 'calculator:1.0.0';
const NAME = `calculator-eval-${process.pid}`;
const MAX_IMAGE_BYTES = 40 * 1000 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('4.1 Docker image', () => {
  test.describe.configure({ mode: 'serial' });

  let baseUrl = '';

  test.beforeAll(() => {
    const build = docker(['build', '-t', IMAGE, '.'], 15 * 60_000);
    expect(build.code, build.stderr.slice(-2000)).toBe(0);
    docker(['rm', '-f', NAME]);
    const started = docker(['run', '-d', '--name', NAME, '-e', 'RATE_LIMIT_PER_MINUTE=0', '-p', '127.0.0.1::8080', IMAGE]);
    expect(started.code, started.stderr).toBe(0);
    const port = docker(['port', NAME, '8080/tcp']).stdout.trim().split('\n')[0]?.split(':').pop();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  test.afterAll(() => {
    docker(['rm', '-f', NAME]);
  });

  test('the image is under 40 MB and runs as a non-root user', () => {
    const size = Number(docker(['image', 'inspect', IMAGE, '--format', '{{.Size}}']).stdout.trim());
    const user = docker(['image', 'inspect', IMAGE, '--format', '{{.Config.User}}']).stdout.trim();

    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(MAX_IMAGE_BYTES);
    expect(user).not.toBe('');
    expect(user).not.toMatch(/^(root|0)(:|$)/);
  });

  test('the container becomes healthy within 30 seconds', async () => {
    let status = '';
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && status !== 'healthy') {
      status = docker(['inspect', NAME, '--format', '{{.State.Health.Status}}']).stdout.trim();
      if (status !== 'healthy') await sleep(500);
    }
    expect(status).toBe('healthy');
  });

  test('serves the page, the catalogue and a calculation', async () => {
    const page = await fetch(`${baseUrl}/`);
    const catalogue = await fetch(`${baseUrl}/api/v1/operations`);
    const calculation = await fetch(`${baseUrl}/api/v1/calculations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'add', operands: [2, 3] }),
    });

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="root"');
    expect(catalogue.status).toBe(200);
    expect(JSON.stringify(await catalogue.json())).toContain('add');
    expect(calculation.status).toBe(200);
    expect(JSON.stringify(await calculation.json())).toContain('5');
  });

  test('the API evals pass against the container', () => {
    const result = run('npm', ['run', 'evals:api'], {
      env: { EVAL_BASE_URL: baseUrl },
      timeoutMs: 10 * 60_000,
    });
    expect(result.code, result.stdout.slice(-3000)).toBe(0);
    expect(result.stdout).toMatch(/\d+ passed/);
    expect(result.stdout).not.toMatch(/\d+ failed/);
  });

  test('docker compose config passes', () => {
    const result = docker(['compose', 'config', '-q']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('');
    expect(result.stderr.trim()).toBe('');
  });

  test('SIGTERM stops the container with exit code 0 within 10 seconds', () => {
    const started = Date.now();
    const kill = docker(['kill', '--signal=SIGTERM', NAME]);
    const wait = docker(['wait', NAME]);
    const elapsed = Date.now() - started;

    expect(kill.code).toBe(0);
    expect(wait.stdout.trim()).toBe('0');
    expect(elapsed).toBeLessThan(10_000);
  });
});
