import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBackendPercent, readFrontendPercent, renderSummary, row } from './coverage-report.mjs';

test('row passes at the gate and fails below it', () => {
  assert.equal(row('Backend', 90, 90).passed, true);
  assert.equal(row('Frontend', 79.9, 80).passed, false);
});

test('renderSummary writes a table with one decimal and no timestamp', () => {
  const text = renderSummary([row('Backend (Go statements)', 91.25, 90), row('Frontend (lines)', 70, 80)]);
  assert.match(text, /\| Backend \(Go statements\) \| 91\.3% \| 90% \| pass \|/);
  assert.match(text, /\| Frontend \(lines\) \| 70\.0% \| 80% \| fail \|/);
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/);
});

test('readers reject summaries without a numeric total', () => {
  assert.equal(readBackendPercent({ total: 88.5, packages: {} }), 88.5);
  assert.throws(() => readBackendPercent({}), /no numeric "total"/);
  assert.equal(readFrontendPercent({ total: { lines: { pct: 84 } } }), 84);
  assert.throws(() => readFrontendPercent({ total: {} }), /total\.lines\.pct/);
});
