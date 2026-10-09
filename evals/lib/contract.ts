import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The nine operations in catalogue order (release item 2.2). */
export const OPERATIONS = [
  'add',
  'subtract',
  'multiply',
  'divide',
  'power',
  'sqrt',
  'percentage',
  'reciprocal',
  'square',
] as const;

export type OperationName = (typeof OPERATIONS)[number];

/** Evals walk the spec by key name, so a loose shape keeps them readable. */
export type OpenApiDocument = Record<string, any>;

export interface ReleaseItem {
  id: string;
  title: string;
}

const openApiPath = path.join(repoRoot, 'backend', 'api', 'openapi.yaml');
const errorContractPath = path.join(repoRoot, 'docs', 'ERROR-CONTRACT.md');

/** The OpenAPI file exactly as it sits on disk, for byte comparisons. */
export function openApiRaw(): Buffer {
  return readFileSync(openApiPath);
}

export function loadOpenApi(): OpenApiDocument {
  return parse(openApiRaw().toString('utf8')) as OpenApiDocument;
}

/** Codes from the table rows of docs/ERROR-CONTRACT.md. Repeated rows collapse into one entry. */
export function loadErrorCodes(): Set<string> {
  const codes = new Set<string>();
  for (const line of readFileSync(errorContractPath, 'utf8').split(/\r?\n/)) {
    const match = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/.exec(line);
    if (match?.[1]) codes.add(match[1]);
  }
  return codes;
}

/** Every `#### N.M Title` heading of releases/v<version>.md, in file order. */
export function releaseItems(version = '1.0.0'): ReleaseItem[] {
  const file = path.join(repoRoot, 'releases', `v${version}.md`);
  const items: ReleaseItem[] = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^#### (\d+\.\d+) (.+)$/.exec(line);
    if (match?.[1] && match[2]) items.push({ id: match[1], title: match[2].trim() });
  }
  return items;
}
