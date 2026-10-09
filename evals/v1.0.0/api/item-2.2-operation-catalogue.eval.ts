import { calculate } from '../../lib/calc';
import { loadOpenApi, OPERATIONS } from '../../lib/contract';
import { test, expect } from '../../lib/fixtures';
import { ARITY } from '../../lib/golden';
import { expectProblem } from '../../lib/problem';

interface Descriptor {
  name: string;
  symbol: string;
  arity: number;
  description: string;
}

interface Catalogue {
  items: Descriptor[];
  total: number;
}

// Golden case of release item 2.2: the `catalogue` example in the OpenAPI file.
const catalogueExample: Catalogue = loadOpenApi().paths['/api/v1/operations'].get.responses['200'].content[
  'application/json'
].examples.catalogue.value;

test.describe('2.2 Operation catalogue', () => {
  test('GET /api/v1/operations deep-equals the catalogue example of the OpenAPI file', async ({ request }) => {
    const res = await request.get('/api/v1/operations');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/^application\/json/);

    expect(await res.json()).toEqual(catalogueExample);
  });

  test('total is 9 and items lists the nine names in catalogue order', async ({ request }) => {
    const res = await request.get('/api/v1/operations');
    const body = (await res.json()) as Catalogue;

    expect(body.total).toBe(9);
    expect(body.items).toHaveLength(9);
    expect(body.items.map((item) => item.name)).toEqual([...OPERATIONS]);
  });

  test('every entry has exactly name, symbol, arity and description', async ({ request }) => {
    const res = await request.get('/api/v1/operations');
    const body = (await res.json()) as Catalogue;

    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['arity', 'description', 'name', 'symbol']);
      expect(item.symbol.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  test('arity is 1 for sqrt, reciprocal and square and 2 for the rest', async ({ request }) => {
    const res = await request.get('/api/v1/operations');
    const body = (await res.json()) as Catalogue;

    const arities = Object.fromEntries(body.items.map((item) => [item.name, item.arity]));
    expect(arities).toEqual(ARITY);
  });

  for (const name of OPERATIONS) {
    test(`${name} behaves as its catalogue arity says`, async ({ request }) => {
      const arity = ARITY[name];
      const accepted = await calculate(request, name, arity === 1 ? [4] : [4, 2]);
      expect(accepted.status()).toBe(200);

      const rejected = await calculate(request, name, arity === 1 ? [4, 2] : [4]);
      await expectProblem(rejected, { status: 400, code: 'INVALID_OPERAND_COUNT' });
    });
  }
});
