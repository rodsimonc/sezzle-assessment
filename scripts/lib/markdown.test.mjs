import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  collectAnchors,
  collectMarkdownFiles,
  findInlineLinks,
  findReferenceDefinitions,
  lineIndex,
  maskCode,
  maskComments,
  maskFences,
  maskInlineCode,
  normalizeQuotes,
  slugify,
  stripMarkdown,
  toPosix,
} from './markdown.mjs';
import { cleanTrees, makeTree } from './testing.mjs';

after(cleanTrees);

describe('collectMarkdownFiles', () => {
  test('finds the root docs, releases and docs, and skips coverage, node_modules and dist', () => {
    const root = makeTree({
      'README.md': '# a',
      'specs.md': '# b',
      'NOTES.md': '# not in the list',
      'releases/v1.0.0.md': '# c',
      'releases/notes.txt': 'x',
      'docs/ERROR-CONTRACT.md': '# d',
      'docs/deep/er/page.md': '# e',
      'docs/coverage/SUMMARY.md': '# skipped',
      'docs/dist/page.md': '# skipped',
      'docs/node_modules/pkg/README.md': '# skipped',
      'node_modules/pkg/README.md': '# skipped',
      'frontend/README.md': '# not covered',
    });
    assert.deepEqual(collectMarkdownFiles(root), [
      'README.md',
      'docs/ERROR-CONTRACT.md',
      'docs/deep/er/page.md',
      'releases/v1.0.0.md',
      'specs.md',
    ]);
  });

  test('returns an empty list for a folder with no docs', () => {
    assert.deepEqual(collectMarkdownFiles(makeTree()), []);
  });
});

describe('masking', () => {
  test('maskFences blanks backtick and tilde fences and keeps the lines around them', () => {
    const text = 'before\n```js\nconst leverage = 1;\n```\nafter\n~~~\nrobust\n~~~\nend';
    const masked = maskFences(text);
    assert.equal(masked.length, text.length);
    assert.ok(!masked.includes('leverage'));
    assert.ok(!masked.includes('robust'));
    assert.ok(masked.includes('before') && masked.includes('after') && masked.includes('end'));
  });

  test('a longer fence is not closed by a shorter one', () => {
    const masked = maskFences('````\n```\ninside\n```\n````\noutside');
    assert.ok(!masked.includes('inside'));
    assert.ok(masked.includes('outside'));
  });

  test('an unclosed fence runs to the end of the file', () => {
    const masked = maskFences('text\n```\ncode\nmore code');
    assert.ok(masked.includes('text'));
    assert.ok(!masked.includes('code'));
  });

  test('fences inside list items and block quotes are found', () => {
    const masked = maskFences('- item\n- ```sh\n  npm run x\n  ```\n> ```\n> quoted\n> ```\nok');
    assert.ok(!masked.includes('npm run x'));
    assert.ok(!masked.includes('quoted'));
    assert.ok(masked.includes('ok'));
  });

  test('CRLF files keep their line breaks', () => {
    const text = 'a\r\n```\r\nx\r\n```\r\nb\r\n';
    const masked = maskFences(text);
    assert.equal(masked.length, text.length);
    assert.equal(masked.split('\n').length, text.split('\n').length);
  });

  test('a one-line triple backtick span is inline code, not a fence', () => {
    assert.ok(maskFences('use ```x``` here\nnext').includes('next'));
    assert.ok(maskFences('use ```x``` here\nnext').includes('use'));
  });

  test('maskInlineCode blanks single and double backtick spans', () => {
    const masked = maskInlineCode('a `one` b ``t`wo`` c');
    assert.equal(masked.replace(/\s+/g, ' ').trim(), 'a b c');
  });

  test('an unmatched backtick stays literal and a span never crosses a blank line', () => {
    const text = 'lone ` tick\n\nsecond ` paragraph';
    assert.equal(maskInlineCode(text), text);
  });

  test('maskComments blanks single and multi-line comments', () => {
    const masked = maskComments('a <!-- x\ny --> b');
    assert.equal(masked.length, 'a <!-- x\ny --> b'.length);
    assert.ok(!masked.includes('x'));
    assert.ok(masked.includes('\n'));
    assert.ok(masked.includes('a') && masked.includes('b'));
  });

  test('maskCode keeps offsets', () => {
    const text = 'x `a` <!-- c -->\n```\nz\n```\ny';
    assert.equal(maskCode(text).length, text.length);
  });
});

describe('findInlineLinks', () => {
  const dests = (text) => findInlineLinks(text).map((link) => link.dest);

  test('reads links and images', () => {
    assert.deepEqual(dests('[a](one.md) and ![alt](img/two.png)'), ['one.md', 'img/two.png']);
  });

  test('ignores a title and keeps balanced parentheses in the destination', () => {
    assert.deepEqual(dests('[a](x.md "title") [b](p_(1).md) [c](<with space.md>)'), [
      'x.md',
      'p_(1).md',
      'with space.md',
    ]);
  });

  test('reports an empty destination', () => {
    assert.deepEqual(dests('[todo]()'), ['']);
  });

  test('skips a "](" with no opening bracket, an escaped one and a broken one', () => {
    assert.deepEqual(dests('plain ](x.md) text'), []);
    assert.deepEqual(dests(String.raw`[a\](x.md)`), []);
    assert.deepEqual(dests('[a](x.md'), []);
  });

  test('gives the offsets of the parenthesised part', () => {
    const text = 'see [a](x.md) now';
    const [link] = findInlineLinks(text);
    assert.equal(text.slice(link.start, link.end), 'x.md');
    assert.equal(text.slice(link.destStart, link.destEnd), 'x.md');
  });
});

describe('findReferenceDefinitions', () => {
  test('reads definitions and skips footnotes', () => {
    const text = '[one]: ./a.md\n[two]: <./b c.md> "t"\n[^1]: a footnote\nplain';
    assert.deepEqual(
      findReferenceDefinitions(text).map((d) => d.dest),
      ['./a.md', './b c.md'],
    );
  });

  test('offsets point at the destination', () => {
    const text = 'x\n[one]: ./a.md';
    const [definition] = findReferenceDefinitions(text);
    assert.equal(text.slice(definition.destStart, definition.destEnd), './a.md');
  });
});

describe('stripMarkdown', () => {
  test('keeps link text and drops link targets, URLs, tags and code', () => {
    const text = [
      'Read [the guide](./leverage.md) at https://example.com/robust today.',
      'Use `delve` or <b>bold</b>.',
      '<https://example.com/seamless>',
      '[ref]: ./pivotal.md',
      '[^1]: footnote prose stays',
    ].join('\n');
    const stripped = stripMarkdown(text);
    assert.equal(stripped.length, text.length);
    assert.ok(stripped.includes('the guide'));
    assert.ok(stripped.includes('footnote prose stays'));
    for (const hidden of ['leverage', 'robust', 'delve', 'seamless', 'pivotal', '<b>']) {
      assert.ok(!stripped.includes(hidden), `${hidden} should be hidden`);
    }
    assert.ok(stripped.includes('bold'));
  });

  test('hides the label of a reference-style link', () => {
    assert.ok(!stripMarkdown('[text][seamless-label]').includes('seamless'));
    assert.ok(stripMarkdown('[text][label]').includes('text'));
  });
});

describe('slugify', () => {
  const cases = [
    ['What it is', 'what-it-is'],
    ['API reference', 'api-reference'],
    ['Testing and quality', 'testing-and-quality'],
    ['1.0.0 release', '100-release'],
    ['Q&A', 'qa'],
    ['C++ and Go', 'c-and-go'],
    ['Use `npm run dev`', 'use-npm-run-dev'],
    ['A [link](./x.md) inside', 'a-link-inside'],
    ['snake_case name', 'snake_case-name'],
    ['_emphasis_ here', 'emphasis-here'],
    ['Two  spaces', 'two--spaces'],
    ['Cómo funciona', 'cómo-funciona'],
    ['What is 400 or 422?', 'what-is-400-or-422'],
  ];
  for (const [heading, slug] of cases) {
    test(`"${heading}" becomes ${slug}`, () => assert.equal(slugify(heading), slug));
  }
});

describe('collectAnchors', () => {
  test('collects ATX and setext headings and numbers repeats', () => {
    const anchors = collectAnchors('# One\n\nTwo\n===\n\n## Same\n\n## Same\n\n### Same\n\nThree\n---\n');
    assert.deepEqual([...anchors].sort(), ['one', 'same', 'same-1', 'same-2', 'three', 'two']);
  });

  test('ignores headings inside fences and comments', () => {
    const anchors = collectAnchors('# Real\n```\n# Fake\n```\n<!--\n# Hidden\n-->\n');
    assert.deepEqual([...anchors], ['real']);
  });

  test('handles closing hashes and inline code in a heading', () => {
    assert.deepEqual([...collectAnchors('## `npm run dev` ##')], ['npm-run-dev']);
  });

  test('picks up explicit id and name attributes', () => {
    const anchors = collectAnchors('<a name="old-anchor"></a>\n<h2 id="custom">x</h2>');
    assert.ok(anchors.has('old-anchor') && anchors.has('custom'));
  });

  test('a list item or table row over dashes is not a setext heading', () => {
    assert.deepEqual([...collectAnchors('- item\n---\n| a |\n--\n')], []);
  });
});

describe('small helpers', () => {
  test('lineIndex maps offsets to line and column', () => {
    const at = lineIndex('ab\ncd\n\nef');
    assert.deepEqual(at(0), { line: 1, column: 1 });
    assert.deepEqual(at(1), { line: 1, column: 2 });
    assert.deepEqual(at(3), { line: 2, column: 1 });
    assert.deepEqual(at(7), { line: 4, column: 1 });
  });

  test('normalizeQuotes straightens curly quotes without changing length', () => {
    const text = 'it’s “quoted”';
    assert.equal(normalizeQuotes(text), 'it\'s "quoted"');
    assert.equal(normalizeQuotes(text).length, text.length);
  });

  test('toPosix turns separators into slashes', () => {
    assert.equal(toPosix(['a', 'b', 'c.md'].join(process.platform === 'win32' ? '\\' : '/')), 'a/b/c.md');
  });
});
