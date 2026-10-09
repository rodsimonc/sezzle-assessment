import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, headingSlugs, slugify } from './check-links.mjs';

test('slugify follows GitHub anchor rules', () => {
  assert.equal(slugify('Lifecycle contract'), 'lifecycle-contract');
  assert.equal(slugify('Run `npm test` (fast)'), 'run-npm-test-fast');
  assert.equal(slugify('Use [the API](./api.md)'), 'use-the-api');
});

test('headingSlugs suffixes repeated headings and skips fenced code', () => {
  const markdown = ['# Intro', '## Intro', '```', '# Not a heading', '```', '### Intro'].join('\n');
  assert.deepEqual([...headingSlugs(markdown)].sort(), ['intro', 'intro-1', 'intro-2']);
});

test('extractLinks finds links and images but ignores code spans and fences', () => {
  const markdown = [
    'See [spec](./specs.md#stack) and ![logo](docs/images/logo.png).',
    'Literal `[no](link.md)` here.',
    '```',
    '[fenced](missing.md)',
    '```',
  ].join('\n');
  assert.deepEqual(extractLinks(markdown), [
    { line: 1, target: './specs.md#stack' },
    { line: 1, target: 'docs/images/logo.png' },
  ]);
});
