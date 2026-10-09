import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { repoRoot } from '../../lib/contract';
import { npm } from '../../lib/exec';

const HEADINGS = [
  'What it is',
  'Quick start',
  'Project layout',
  'Architecture',
  'API reference',
  'Using the calculator',
  'Configuration',
  'Testing and quality',
  'Eval suite',
  'Design decisions',
  'Known limits',
  'How this was built',
  'License',
];
const DIAGRAMS = [
  'system-context',
  'backend-layers',
  'request-sequence',
  'error-mapping',
  'frontend-state',
  'docker-deployment',
  'ci-pipeline',
  'aidlc-lifecycle',
];

const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');

test.describe('4.3 Documentation', () => {
  test('README has the level-2 headings in order', () => {
    const found = [...read('README.md').matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]);
    expect(found).toEqual(HEADINGS);
  });

  test('README embeds all 8 diagrams and each PNG is as new as its source', () => {
    const readme = read('README.md');
    for (const name of DIAGRAMS) {
      const mmd = path.join(repoRoot, 'docs', 'diagrams', `${name}.mmd`);
      const png = path.join(repoRoot, 'docs', 'diagrams', `${name}.png`);
      expect(readme, `README does not embed ${name}`).toContain(`docs/diagrams/${name}.png`);
      expect(existsSync(mmd), `${name}.mmd`).toBe(true);
      expect(existsSync(png), `${name}.png`).toBe(true);
      expect(statSync(png).mtimeMs, `${name}.png is older than its source`).toBeGreaterThanOrEqual(
        statSync(mmd).mtimeMs,
      );
    }
  });

  test('npm run lint:docs exits 0 (style and relative links)', () => {
    const result = npm(['run', 'lint:docs']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/broken|unresolved/i);
  });

  test('requests.http and the Postman collection cover the endpoints and error cases', () => {
    const http = read('requests.http');
    const postman = read('postman_collection.json');
    expect(() => JSON.parse(postman)).not.toThrow();
    for (const text of [http, postman]) {
      expect(text).toContain('/api/v1/calculations');
      expect(text).toContain('/api/v1/operations');
      expect(text).toContain('/healthz');
      expect(text).toMatch(/\b400\b/);
      expect(text).toMatch(/\b422\b/);
      expect(text).toMatch(/\b404\b/);
    }
  });

  test('LICENSE is MIT', () => {
    const license = read('LICENSE');
    expect(readdirSync(repoRoot)).toContain('LICENSE');
    expect(license).toMatch(/^MIT License/);
    expect(license).toContain('Permission is hereby granted, free of charge');
  });
});
