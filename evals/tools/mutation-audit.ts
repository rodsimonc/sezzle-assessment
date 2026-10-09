// Mutation audit (release item 4.6). Run with: npm run evals:audit
//
// Copies backend/ into evals/.tmp/mutants/<id>, applies one one-line break, builds the copy and runs
// the API evals against that binary through EVAL_SERVER_BINARY. The run has to fail. A run that
// passes means a mutant survived, and the matching eval needs to get stricter.
// The real backend/ directory is only read. A hash taken before and after proves it.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../lib/contract';

export interface Mutation {
  id: string;
  /** Path inside backend/, with forward slashes. */
  file: string;
  /** One fragment of one line. It has to occur exactly once in the file. */
  find: string;
  replace: string;
  why: string;
}

/** The breaks. Each one changes a single line and still compiles. */
export const MUTATIONS: Mutation[] = [
  { id: 'add-sign', file: 'internal/domain/operation.go', find: 'return o[0] + o[1], nil', replace: 'return o[0] - o[1], nil', why: 'add subtracts' },
  { id: 'subtract-sign', file: 'internal/domain/operation.go', find: 'return o[0] - o[1], nil', replace: 'return o[0] + o[1], nil', why: 'subtract adds' },
  { id: 'multiply-sign', file: 'internal/domain/operation.go', find: 'return o[0] * o[1], nil', replace: 'return o[0] + o[1], nil', why: 'multiply adds' },
  { id: 'divide-zero-check', file: 'internal/domain/operation.go', find: 'if o[1] == 0 {', replace: 'if false {', why: 'divide drops the zero-divisor check' },
  { id: 'reciprocal-zero-check', file: 'internal/domain/operation.go', find: 'if o[0] == 0 {', replace: 'if false {', why: 'reciprocal drops the zero check' },
  { id: 'power-zero-negative', file: 'internal/domain/operation.go', find: 'if base == 0 && exp < 0 {', replace: 'if false {', why: 'power drops 0 to a negative exponent' },
  { id: 'sqrt-negative-check', file: 'internal/domain/operation.go', find: 'if o[0] < 0 {', replace: 'if false {', why: 'sqrt drops the negative check' },
  { id: 'percentage-divisor', file: 'internal/domain/operation.go', find: 'o[0] / 100 * o[1]', replace: 'o[0] / 10 * o[1]', why: 'percentage divides by 10' },
  { id: 'drop-rounding', file: 'internal/service/calculator.go', find: "strconv.FormatFloat(x, 'g', 15, 64)", replace: "strconv.FormatFloat(x, 'g', -1, 64)", why: 'results lose the 15-digit rounding' },
  { id: 'negative-zero', file: 'internal/service/calculator.go', find: 'if rounded == 0 {', replace: 'if false {', why: 'negative zero stays negative' },
  { id: 'overflow-check', file: 'internal/service/calculator.go', find: 'case math.IsInf(value, 0):', replace: 'case false:', why: 'an overflowed result reaches the encoder' },
  { id: 'operand-count-check', file: 'internal/service/calculator.go', find: 'if len(operands) != op.Arity {', replace: 'if false {', why: 'the operand count goes unchecked' },
  { id: 'status-200-on-errors', file: 'internal/problem/problem.go', find: 'w.WriteHeader(status)', replace: 'w.WriteHeader(http.StatusOK)', why: 'every error answers 200' },
  { id: 'problem-media-type', file: 'internal/problem/problem.go', find: '"application/problem+json"', replace: '"application/json"', why: 'errors lose the problem+json type' },
  { id: 'unprocessable-to-bad-request', file: 'internal/handler/handler.go', find: 'problem.Write(w, r, http.StatusUnprocessableEntity, rule.Code, rule.Message)', replace: 'problem.Write(w, r, http.StatusBadRequest, rule.Code, rule.Message)', why: 'a rule violation answers 400 instead of 422' },
  { id: 'accept-unknown-fields', file: 'internal/handler/decode.go', find: 'fields = append(fields, unknownFields(members, "operation", "operands")...)', replace: '_ = unknownFields', why: 'unknown body fields pass' },
  { id: 'drop-request-id', file: 'internal/middleware/basic.go', find: 'w.Header().Set(requestIDHeader, id)', replace: '_ = requestIDHeader', why: 'no X-Request-Id on responses' },
  { id: 'drop-nosniff-header', file: 'internal/middleware/basic.go', find: 'h.Set("X-Content-Type-Options", "nosniff")', replace: '_ = h', why: 'no X-Content-Type-Options' },
  { id: 'drop-csp-header', file: 'internal/middleware/basic.go', find: 'h.Set("Content-Security-Policy", contentSecurityPolicy)', replace: '_ = h', why: 'no Content-Security-Policy' },
  { id: 'drop-no-store', file: 'internal/middleware/basic.go', find: 'h.Set("Cache-Control", "no-store")', replace: '_ = h', why: 'API responses lose no-store' },
  { id: 'body-limit-doubled', file: 'internal/middleware/basic.go', find: 'const MaxBodyBytes = 4096', replace: 'const MaxBodyBytes = 8192', why: 'the body limit doubles' },
  { id: 'drop-cors-check', file: 'internal/middleware/cors.go', find: '_, ok := set[origin]', replace: 'ok := true', why: 'every origin counts as allowed' },
  { id: 'drop-cors-vary', file: 'internal/middleware/cors.go', find: 'h.Add("Vary", "Origin")', replace: '_ = h', why: 'no Vary: Origin' },
  { id: 'drop-retry-after', file: 'internal/middleware/ratelimit.go', find: 'w.Header().Set("Retry-After", strconv.Itoa(wait))', replace: '_ = strconv.Itoa(wait)', why: '429 without Retry-After' },
  { id: 'remove-rate-limiter', file: 'internal/server/server.go', find: 'chained = rateLimit(chained)', replace: '_ = rateLimit', why: 'the rate limiter leaves the chain' },
];

const evalsDir = path.resolve(repoRoot, 'evals');
const backendDir = path.join(repoRoot, 'backend');
const workRoot = path.join(evalsDir, '.tmp', 'mutants');
const binaryName = process.platform === 'win32' ? 'server.exe' : 'server';
const SKIPPED_TOP_LEVEL = new Set(['bin', 'coverage', 'coverage.out']);
const STARTUP_FAILURES = ['Backend binary not found', 'exited during startup', 'did not answer GET /healthz'];

interface JsonTest {
  status?: string;
  results: Array<{ status: string; error?: { message?: string } }>;
}
interface JsonSpec {
  title: string;
  file: string;
  ok: boolean;
  tests: JsonTest[];
}
interface JsonSuite {
  title: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}
interface JsonReport {
  suites: JsonSuite[];
  stats: { expected: number; unexpected: number };
}

interface Failure {
  file: string;
  title: string;
  message: string;
}

function backendHash(): string {
  const hash = createHash('sha256');
  const walk = (dir: string, depth: number): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (depth === 0 && SKIPPED_TOP_LEVEL.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else hash.update(path.relative(backendDir, full)).update(readFileSync(full));
    }
  };
  walk(backendDir, 0);
  return hash.digest('hex');
}

function copyBackend(target: string): void {
  cpSync(backendDir, target, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(backendDir, source);
      return !SKIPPED_TOP_LEVEL.has(relative.split(path.sep)[0] ?? '');
    },
  });
}

function applyMutation(root: string, mutation: Mutation): void {
  const file = path.join(root, ...mutation.file.split('/'));
  if (!existsSync(file)) {
    throw new Error(`Mutant ${mutation.id}: ${mutation.file} does not exist in the copy.`);
  }
  const source = readFileSync(file, 'utf8');
  const found = source.split(mutation.find).length - 1;
  if (found !== 1) {
    throw new Error(
      `Mutant ${mutation.id}: the break pattern ${JSON.stringify(mutation.find)} matched ${found} times in ${mutation.file}, expected exactly 1. Update the table.`,
    );
  }
  writeFileSync(file, source.replace(mutation.find, () => mutation.replace));
}

function build(root: string, id: string): string {
  const output = path.join('bin', binaryName);
  const result = spawnSync('go', ['-C', root, 'build', '-trimpath', '-o', output, './cmd/server'], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `${result.stdout}${result.stderr}`.trim();
    throw new Error(`Mutant ${id} does not compile, so the break is not a valid test:\n${reason}`);
  }
  return path.join(root, output);
}

function collectFailures(suites: JsonSuite[], trail: string[] = []): Failure[] {
  const failures: Failure[] = [];
  for (const suite of suites) {
    const here = suite.title.endsWith('.ts') ? trail : [...trail, suite.title];
    for (const spec of suite.specs ?? []) {
      if (spec.ok) continue;
      const failed = spec.tests.flatMap((test) => test.results).find((r) => r.status !== 'passed' && r.status !== 'skipped');
      failures.push({
        file: spec.file,
        title: [...here, spec.title].join(' > '),
        message: failed?.error?.message ?? '',
      });
    }
    failures.push(...collectFailures(suite.suites ?? [], here));
  }
  return failures;
}

function runApiEvals(binary: string, outputDir: string, stopAtFirstFailure: boolean): { status: number; report: JsonReport } {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const args = [cli, 'test', '--project=api', '--reporter=json', `--output=${outputDir}`];
  if (stopAtFirstFailure) args.push('--max-failures=1');

  const env: NodeJS.ProcessEnv = { ...process.env, EVAL_SERVER_BINARY: binary };
  delete env.EVAL_BASE_URL; // an external server would answer for every mutant
  delete env.CI;

  const result = spawnSync(process.execPath, args, {
    cwd: evalsDir,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 5 * 60_000,
  });
  if (result.error) throw new Error(`Could not run Playwright: ${result.error.message}`);
  try {
    return { status: result.status ?? 1, report: JSON.parse(result.stdout) as JsonReport };
  } catch {
    throw new Error(`Playwright printed no JSON report (exit ${result.status}).\n${result.stdout.slice(0, 2000)}\n${result.stderr.slice(0, 2000)}`);
  }
}

function oneLine(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]?.trim() ?? '';
}

function main(): void {
  const hashBefore = backendHash();
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
  const outputDir = path.join(workRoot, '_results');
  let killed = 0;

  try {
    const baselineRoot = path.join(workRoot, '_baseline');
    copyBackend(baselineRoot);
    const baseline = runApiEvals(build(baselineRoot, 'baseline'), outputDir, false);
    if (baseline.status !== 0 || baseline.report.stats.unexpected > 0) {
      const first = collectFailures(baseline.report.suites)[0];
      throw new Error(
        `The unmodified copy of the backend fails the API evals, so the audit cannot tell kills from noise.\n${first ? `${first.file} > ${first.title}: ${oneLine(first.message)}` : 'See the Playwright output.'}`,
      );
    }
    process.stdout.write(`baseline  ${baseline.report.stats.expected} API evals pass against the copy\n`);

    for (const mutation of MUTATIONS) {
      const root = path.join(workRoot, mutation.id);
      copyBackend(root);
      applyMutation(root, mutation);
      const { status, report } = runApiEvals(build(root, mutation.id), outputDir, true);
      const failures = collectFailures(report.suites);
      const first = failures[0];

      if (status === 0 || !first) {
        process.stdout.write(`SURVIVED  ${mutation.id}  (${mutation.why}): all API evals still pass\n`);
        continue;
      }
      const startup = STARTUP_FAILURES.find((marker) => first.message.includes(marker));
      if (startup) {
        throw new Error(`Mutant ${mutation.id} stopped the server from starting (${startup}). Pick a break that changes behavior only.`);
      }
      killed += 1;
      process.stdout.write(`killed    ${mutation.id}  (${mutation.why})  <-  ${first.file} > ${first.title}\n`);
    }
  } finally {
    if (process.env.AUDIT_KEEP !== '1') rmSync(workRoot, { recursive: true, force: true });
  }

  if (backendHash() !== hashBefore) {
    throw new Error('backend/ changed during the audit. The audit must only read it.');
  }
  process.stdout.write(`Mutation audit: ${killed}/${MUTATIONS.length} killed\n`);
  if (killed !== MUTATIONS.length) process.exit(1);
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  const there = path.resolve(entry);
  return process.platform === 'win32' ? here.toLowerCase() === there.toLowerCase() : here === there;
}

if (isEntryPoint()) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Mutation audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
