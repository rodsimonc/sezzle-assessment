import type { APIRequestContext, APIResponse } from '@playwright/test';
import { loadErrorCodes, loadOpenApi, openApiRaw, type OpenApiDocument } from '../../lib/contract';
import { test, expect } from '../../lib/fixtures';
import { collectRefs, deref, resolveRef, withoutRequestId } from '../../lib/openapi';

const doc = loadOpenApi();
const CALCULATIONS = '/api/v1/calculations';
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];

interface ResponseExample {
  status: number;
  mediaType: string;
  value: unknown;
}

interface Pair {
  name: string;
  request: unknown;
  response: ResponseExample;
}

/** Response examples of an operation by name, with the status code and media type that hold them. */
function responseExamples(operation: OpenApiDocument): { byName: Map<string, ResponseExample>; duplicates: string[] } {
  const byName = new Map<string, ResponseExample>();
  const duplicates: string[] = [];
  for (const [status, response] of Object.entries(operation.responses as Record<string, unknown>)) {
    const resolved = deref(doc, response);
    for (const [mediaType, content] of Object.entries((resolved.content ?? {}) as Record<string, OpenApiDocument>)) {
      for (const [name, example] of Object.entries((content.examples ?? {}) as Record<string, OpenApiDocument>)) {
        if (byName.has(name)) duplicates.push(name);
        byName.set(name, { status: Number(status), mediaType, value: example.value });
      }
    }
  }
  return { byName, duplicates };
}

function requestExamples(operation: OpenApiDocument): Record<string, OpenApiDocument> {
  const body = deref(doc, operation.requestBody);
  return body.content['application/json'].examples as Record<string, OpenApiDocument>;
}

const calculationsPost: OpenApiDocument = doc.paths[CALCULATIONS].post;
const calculationPairs = responseExamples(calculationsPost);
const calculationRequests = requestExamples(calculationsPost);

const pairs: Pair[] = Object.entries(calculationRequests).flatMap(([name, example]) => {
  const response = calculationPairs.byName.get(name);
  return response === undefined ? [] : [{ name, request: example.value, response }];
});

// /operations/{name}: the path parameter examples share names with the request and response examples.
const runOperation: OpenApiDocument = doc.paths['/api/v1/operations/{name}'].post;
const runOperationResponses = responseExamples(runOperation);
const runOperationRequests = requestExamples(runOperation);
const nameParameter = (runOperation.parameters as unknown[])
  .map((parameter) => deref(doc, parameter))
  .find((parameter) => parameter.name === 'name');
const pathPairs: { name: string; pathValue: string; request: unknown; response: ResponseExample }[] = Object.entries(
  runOperationRequests,
).flatMap(([name, example]) => {
  const response = runOperationResponses.byName.get(name);
  const pathValue = nameParameter?.examples?.[name]?.value as string | undefined;
  return response === undefined || pathValue === undefined
    ? []
    : [{ name, pathValue, request: example.value, response }];
});

async function expectExample(res: APIResponse, expected: ResponseExample): Promise<void> {
  expect(res.status()).toBe(expected.status);
  expect(res.headers()['content-type'] ?? '').toContain(expected.mediaType);
  expect(withoutRequestId(await res.json())).toEqual(withoutRequestId(expected.value));
}

/** The concrete URL path for an operation: `{name}` takes its first example, or the first enum value. */
function concretePath(path: string, operation: OpenApiDocument): string {
  return path.replace(/\{(\w+)\}/g, (_match, param: string) => {
    const parameter = ((operation.parameters ?? []) as unknown[])
      .map((candidate) => deref(doc, candidate))
      .find((candidate) => candidate.name === param);
    const example = Object.values((parameter?.examples ?? {}) as Record<string, OpenApiDocument>)[0];
    const fromSchema = parameter === undefined ? undefined : deref(doc, parameter.schema).enum?.[0];
    return String(example?.value ?? fromSchema);
  });
}

function send(request: APIRequestContext, method: string, path: string, body: unknown): Promise<APIResponse> {
  return request.fetch(path, { method: method.toUpperCase(), ...(body === undefined ? {} : { data: body }) });
}

test.describe('2.9 OpenAPI parity', () => {
  test('the file is OpenAPI 3.0 and info.version is 1.0.0', () => {
    expect(doc.openapi).toMatch(/^3\.0\./);
    expect(doc.info.version).toBe('1.0.0');
    expect(Object.keys(doc.paths).sort()).toEqual(
      [CALCULATIONS, '/api/v1/operations', '/api/v1/operations/{name}', '/api/v1/openapi.yaml', '/healthz'].sort(),
    );
  });

  test('every $ref in the file resolves', () => {
    const refs = collectRefs(doc);
    const dangling = refs.filter((ref) => resolveRef(doc, ref) === undefined);

    expect(refs.length).toBeGreaterThan(10);
    expect(dangling).toEqual([]);
  });

  test('every request example on POST /api/v1/calculations has a response example of the same name, and back', () => {
    expect(calculationPairs.duplicates).toEqual([]);
    expect(Object.keys(calculationRequests).sort()).toEqual([...calculationPairs.byName.keys()].sort());
    expect(pairs).toHaveLength(Object.keys(calculationRequests).length);
    expect(pairs.length).toBeGreaterThanOrEqual(18);
  });

  for (const pair of pairs) {
    test(`example ${pair.name}: POST ${CALCULATIONS} returns ${pair.response.status} with the documented body`, async ({
      request,
    }) => {
      const res = await send(request, 'post', CALCULATIONS, pair.request);

      await expectExample(res, pair.response);
    });
  }

  for (const pair of pathPairs) {
    test(`example ${pair.name}: POST /api/v1/operations/${pair.pathValue} returns ${pair.response.status} with the documented body`, async ({
      request,
    }) => {
      const res = await send(request, 'post', `/api/v1/operations/${pair.pathValue}`, pair.request);

      await expectExample(res, pair.response);
    });
  }

  test('example unknown_operation: POST /api/v1/operations/modulo returns the documented 404', async ({ request }) => {
    const documented = runOperationResponses.byName.get('unknown_operation');
    expect(documented?.status).toBe(404);

    const res = await send(request, 'post', '/api/v1/operations/modulo', { operands: [7, 3] });
    await expectExample(res, documented as ResponseExample);
  });

  for (const [path, item] of Object.entries(doc.paths as Record<string, OpenApiDocument>)) {
    for (const method of HTTP_METHODS.filter((candidate) => candidate in item)) {
      const operation = item[method] as OpenApiDocument;
      test(`${method.toUpperCase()} ${path} answers with a status the file lists for it`, async ({ request }) => {
        const firstRequest = operation.requestBody === undefined ? undefined : Object.values(requestExamples(operation))[0];
        const res = await send(request, method, concretePath(path, operation), firstRequest?.value);

        const listed = Object.keys(operation.responses as Record<string, unknown>);
        expect(listed).toContain(String(res.status()));

        const response = deref(doc, operation.responses[String(res.status())]);
        const mediaTypes = Object.keys((response.content ?? {}) as Record<string, unknown>);
        expect(mediaTypes.some((mediaType) => (res.headers()['content-type'] ?? '').startsWith(mediaType))).toBe(true);
      });
    }
  }

  test('GET /api/v1/openapi.yaml returns 200 and the exact bytes of the file', async ({ request }) => {
    const res = await request.get('/api/v1/openapi.yaml');
    expect(res.status()).toBe(200);

    const served = await res.body();
    expect(served.length).toBeGreaterThan(1000);
    expect(served.equals(openApiRaw())).toBe(true);
  });

  test('the code enum of the Problem schema equals the codes in docs/ERROR-CONTRACT.md', () => {
    const enumCodes = doc.components.schemas.Problem.properties.code.enum as string[];
    const documented = [...loadErrorCodes()].sort();

    expect(documented.length).toBeGreaterThanOrEqual(15);
    expect(new Set(enumCodes).size).toBe(enumCodes.length);
    expect([...enumCodes].sort()).toEqual(documented);
  });

  test('GET /healthz reports the version the file declares', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.status()).toBe(200);

    const body = (await res.json()) as { version: string };
    expect(body.version).toBe(doc.info.version);
  });
});
