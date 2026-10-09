import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageStats, round1 } from './coverage-backend.mjs';

const MODULE = 'example.com/calc';

test('packageStats weights each package by statement count', () => {
  const profile = [
    'mode: atomic',
    `${MODULE}/internal/domain/add.go:3.1,5.2 4 1`,
    `${MODULE}/internal/domain/sub.go:3.1,5.2 4 0`,
    `${MODULE}/internal/service/svc.go:3.1,5.2 2 5`,
    `${MODULE}/main.go:3.1,5.2 1 0`,
  ].join('\n');
  assert.deepEqual(packageStats(profile, MODULE), {
    'internal/domain': 50,
    'internal/service': 100,
    '.': 0,
  });
});

test('round1 keeps one decimal place', () => {
  assert.equal(round1(90.04), 90);
  assert.equal(round1(89.96), 90);
  assert.equal(round1(89.94), 89.9);
});
