import type { OpenApiDocument } from './contract';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Every `$ref` string found anywhere in the node, in walk order. */
export function collectRefs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
  } else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push(value);
      else collectRefs(value, found);
    }
  }
  return found;
}

/** Follows a local JSON pointer such as `#/components/schemas/Problem`. Returns undefined when it dangles. */
export function resolveRef(doc: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = doc;
  for (const segment of ref.slice(2).split('/')) {
    const key = decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isRecord(node) || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

/** Returns the object a node stands for, following a chain of `$ref`s. Throws when one dangles. */
export function deref(doc: OpenApiDocument, node: unknown): OpenApiDocument {
  let current = node;
  for (let hops = 0; hops < 10; hops++) {
    if (!isRecord(current)) break;
    const ref = current['$ref'];
    if (typeof ref !== 'string') return current;
    current = resolveRef(doc, ref);
  }
  throw new Error(`Could not resolve an OpenAPI node to an object: ${JSON.stringify(node)}`);
}

/** Copy of a JSON value with every `requestId` key removed, at any depth. */
export function withoutRequestId(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRequestId);
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key !== 'requestId') copy[key] = withoutRequestId(inner);
    }
    return copy;
  }
  return value;
}
