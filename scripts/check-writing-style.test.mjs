import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BANNED,
  PARALLELISM_PATTERNS,
  RULES,
  checkMarkdown,
  formatFinding,
  looksTitleCased,
  main,
  scanText,
  wordPattern,
} from './check-writing-style.mjs';
import { capture, cleanTrees, makeTree } from './lib/testing.mjs';

after(cleanTrees);

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-writing-style.mjs');
const rulesOf = (text) => scanText(text).map((finding) => finding.rule);
const errorsOf = (text) => scanText(text).filter((finding) => finding.severity === 'error');

describe('banned words and their inflections', () => {
  const flagged = [
    'We leverage the cache.',
    'It leverages the cache.',
    'They leveraged it, leveraging more.',
    'A robust design, robustly built.',
    'Delve into it. She delved, delving on.',
    'Two tapestries.',
    'An optimised build and an optimized one.',
    'It seamlessly works.',
    'The valuable and the valuably used.',
    'Highlights, highlighted, highlighting.',
    'A game-changer, two game changers.',
    'This is cutting-edge, even cutting edge.',
    'The state-of-the-art.',
    'Dynamically sized.',
    'Holistically planned.',
    'Synergies and synergy.',
    'It is intricately wired.',
    'Showcasing and showcases.',
    'An enduring plan.',
    'The straightforward path.',
    'Enhanced, enhances, enhancing.',
    'Aligned, aligns, aligning.',
  ];
  for (const sentence of flagged) {
    test(`flags: ${sentence}`, () => {
      assert.ok(rulesOf(sentence).includes('banned-word'), sentence);
    });
  }

  test('every word in the banned list is flagged in its base form', () => {
    for (const word of BANNED.words) {
      const hits = errorsOf(`This sentence uses ${word} here.`).filter((f) => f.rule === 'banned-word');
      assert.ok(hits.length >= 1, `"${word}" was not flagged`);
    }
  });

  test('the list holds the 83 words of the style contract, once each', () => {
    assert.equal(BANNED.words.length, 83);
    assert.equal(new Set(BANNED.words).size, BANNED.words.length);
  });

  const clean = [
    'The alignment of the columns.',
    'A plain sentence about arithmetic.',
    'Highlighter pens are yellow.',
    'We use a CSS grid.',
    'The valuables are in the safe.',
    'Dynamo is a database.',
    'A reliable and sturdy design.',
  ];
  for (const sentence of clean) {
    test(`leaves alone: ${sentence}`, () => {
      const words = errorsOf(sentence).filter((f) => f.rule === 'banned-word').map((f) => f.match);
      // "valuables" is an inflection of "valuable" and stays flagged on purpose.
      const expected = sentence.includes('valuables') ? ['valuables'] : [];
      assert.deepEqual(words, expected);
    });
  }

  test('reports the base word and the form that was found', () => {
    const [finding] = scanText('We were leveraging it.');
    assert.equal(finding.message, 'banned word "leverage" (found "leveraging")');
  });

  test('wordPattern builds -ise spellings and plural forms', () => {
    assert.match('optimising', new RegExp(wordPattern('optimize'), 'i'));
    assert.match('tapestries', new RegExp(wordPattern('tapestry'), 'i'));
    assert.doesNotMatch('alignment', new RegExp(wordPattern('align'), 'i'));
  });
});

describe('banned phrases', () => {
  test('every banned phrase is flagged', () => {
    for (const phrase of BANNED.phrases) {
      const found = errorsOf(`Well, ${phrase} we go.`).filter((f) => f.rule === 'banned-phrase');
      assert.ok(found.length >= 1, `"${phrase}" was not flagged`);
    }
  });

  test('matches regardless of case and line wrapping', () => {
    assert.ok(rulesOf('Furthermore, it works.').includes('banned-phrase'));
    assert.ok(rulesOf('The tool serves\nas a gate.').includes('banned-phrase'));
    assert.ok(rulesOf('It’s worth noting the cost.').includes('banned-phrase'));
  });

  test('"boasts" is caught by the banned word "boast"', () => {
    assert.ok(rulesOf('The module boasts a cache.').includes('banned-word'));
  });

  test('does not flag a phrase that only shares a prefix', () => {
    assert.deepEqual(rulesOf('A bookmarks a page.'), []);
    assert.deepEqual(rulesOf('Additional notes follow.'), []);
  });
});

describe('em dashes and "in order to"', () => {
  test('flags every em dash with its position', () => {
    const findings = scanText('One — two.\nThree — four.');
    assert.deepEqual(
      findings.map((f) => [f.rule, f.line, f.column]),
      [
        ['em-dash', 1, 5],
        ['em-dash', 2, 7],
      ],
    );
  });

  test('en dashes and hyphens pass', () => {
    assert.deepEqual(rulesOf('Pages 10–20 and a well-known idea - fine.'), []);
  });

  test('flags "In order to" in any case', () => {
    assert.deepEqual(rulesOf('In order to run it, press go.'), ['in-order-to']);
    assert.deepEqual(rulesOf('Press go in order to run it.'), ['in-order-to']);
    assert.deepEqual(rulesOf('Press go in\norder to run it.'), ['in-order-to']);
  });
});

describe('negative parallelism', () => {
  const flagged = {
    'not only ... but also': 'It is not only fast but also cheap.',
    'not just': 'This is not just a calculator.',
    "isn't X. It's Y": "The API isn't a toy. It's a service.",
    "isn't X. It's Y (is not)": 'The API is not a toy. This is a service.',
    "isn't X, it's Y": "The API isn't a toy, it's a service.",
    'not X, but Y': 'The tool is not a library, but a service.',
    'less X, more Y': 'Write less noise, more signal.',
    'Stop X-ing. Start': 'Stop guessing. Start measuring.',
    'Stop X-ing, start': 'Stop guessing, start measuring.',
    'X? No. Y': 'Is it fast? No. It is slow.',
    'Forget X': 'Forget the old way. This is the new one.',
  };
  for (const [name, sentence] of Object.entries(flagged)) {
    test(`flags ${name}`, () => {
      assert.ok(rulesOf(sentence).includes('negative-parallelism'), sentence);
    });
  }

  test('every pattern in the list is hit by one of the sentences above', () => {
    const hit = new Set();
    for (const sentence of Object.values(flagged)) {
      for (const finding of scanText(sentence)) {
        const name = /^negative parallelism \((.+?)\): /.exec(finding.message)?.[1];
        if (name) hit.add(name);
      }
    }
    for (const { name } of PARALLELISM_PATTERNS) assert.ok(hit.has(name), `${name} was never hit`);
  });

  test('a sentence boundary is found even when a version number holds periods', () => {
    assert.ok(rulesOf("The tool isn't v1.0.0. It's a beta.").includes('negative-parallelism'));
  });

  test('reports one hit when two patterns start at the same word', () => {
    const hits = scanText('It is not only fast, but also cheap.').filter((f) => f.rule === 'negative-parallelism');
    assert.equal(hits.length, 1);
    assert.match(hits[0].message, /not only/);
  });

  test('"Forget" and "No" point at the right column', () => {
    const forget = scanText('Fine text. Forget the old way.')[0];
    assert.deepEqual([forget.line, forget.column], [1, 12]);
    const no = scanText('Is it fast? No. It is slow.')[0];
    assert.deepEqual([no.line, no.column], [1, 13]);
  });

  test('plain negatives, questions and ordinary uses pass', () => {
    const fine = [
      "The cache isn't warm yet.",
      'Do not edit this file.',
      'If the file is missing, the build stops.',
      'Is it fast? Yes.',
      "Don't forget to run the tests.",
      'We stop reading at the end.',
      'It is unless the flag is set, more or less.',
      'The service returns 404, but only for paths.',
    ];
    for (const sentence of fine) assert.deepEqual(rulesOf(sentence), [], sentence);
  });

  test('a pattern described with X, Y or Z placeholders is a mention and passes', () => {
    assert.deepEqual(rulesOf('Avoid "not X, but Y" and "Less X, more Y" and "isn\'t X. It\'s Y".'), []);
    assert.ok(rulesOf('Avoid the pattern: not Alpha, but Beta.').includes('negative-parallelism'));
  });
});

describe('what the scan skips', () => {
  test('fenced code, inline code, comments and link targets are ignored', () => {
    const text = [
      '```js',
      'const leverage = "robust — seamless";',
      '```',
      'Use `delve` here.',
      '<!-- furthermore, leverage this -->',
      'See [the docs](./robust-leverage.md) and https://example.com/seamless.',
      '[ref]: ./pivotal.md "crucial"',
      '<img src="seamless.png" alt="">',
    ].join('\n');
    assert.deepEqual(scanText(text), []);
  });

  test('link text, table cells and list items are scanned', () => {
    assert.deepEqual(rulesOf('See [a robust guide](./x.md).'), ['banned-word']);
    assert.deepEqual(rulesOf('| a | seamless |\n|---|---|'), ['banned-word']);
    assert.deepEqual(rulesOf('- leverage it'), ['banned-word']);
  });

  test('CRLF line endings keep positions right', () => {
    const [finding] = scanText('first line\r\nsecond leverage here\r\n');
    assert.deepEqual([finding.line, finding.column], [2, 8]);
  });
});

describe('heading case', () => {
  test('looksTitleCased spots capitalised words after the first', () => {
    assert.equal(looksTitleCased('Title Case With Many Capitals'), true);
    assert.equal(looksTitleCased('How to Build a Fast Calculator'), true);
    assert.equal(looksTitleCased('Project layout'), false);
    assert.equal(looksTitleCased('Using the calculator'), false);
    assert.equal(looksTitleCased('Testing and quality'), false);
    assert.equal(looksTitleCased('RFC 7807 Problem Details'), false);
    assert.equal(looksTitleCased('GitHub Actions CI'), false);
    assert.equal(looksTitleCased('API'), false);
  });

  test('a Title Case heading is a warning, not an error', () => {
    const findings = scanText('## Title Case With Many Capitals\n');
    assert.deepEqual(
      findings.map((f) => [f.rule, f.severity, f.line, f.column]),
      [['heading-case', 'warning', 1, 4]],
    );
  });

  test('sentence-case headings pass', () => {
    assert.deepEqual(scanText('# What it is\n## Quick start\n### API reference\n'), []);
  });
});

describe('output and exit codes', () => {
  test('formatFinding prints file:line:column first', () => {
    const [finding] = scanText('A leverage here.', 'docs/a.md');
    assert.equal(
      formatFinding(finding),
      'docs/a.md:1:3  error  banned-word  banned word "leverage"',
    );
  });

  test('every rule has an id, a severity and a find function', () => {
    const ids = RULES.map((rule) => rule.id);
    assert.deepEqual(ids, [
      'banned-word',
      'banned-phrase',
      'em-dash',
      'negative-parallelism',
      'in-order-to',
      'heading-case',
    ]);
    for (const rule of RULES) {
      assert.ok(['error', 'warning'].includes(rule.severity));
      assert.equal(typeof rule.find, 'function');
    }
  });

  test('checkMarkdown reads the standard file set', () => {
    const root = makeTree({
      'README.md': '# Fine\n\nPlain words.\n',
      'docs/a.md': 'A leverage here.\n',
      'docs/coverage/SUMMARY.md': 'A leverage here.\n',
    });
    const { files, findings } = checkMarkdown(root);
    assert.deepEqual(files, ['README.md', 'docs/a.md']);
    assert.deepEqual(findings.map((f) => `${f.file}:${f.line}:${f.column}`), ['docs/a.md:1:3']);
  });

  test('main returns 1 and prints each finding when there is an error', () => {
    const root = makeTree({ 'README.md': 'Fine.\n', 'docs/a.md': 'Fine.\nA leverage here.\n' });
    const out = capture();
    assert.equal(main(['--root', root], out, capture()), 1);
    assert.match(out.text, /^docs\/a\.md:2:3 {2}error {2}banned-word/m);
    assert.match(out.text, /Writing style: 2 files checked, 1 error, 0 warnings\./);
  });

  test('main returns 0 for warnings only', () => {
    const root = makeTree({ 'README.md': '# Title Case With Many Capitals\n' });
    const out = capture();
    assert.equal(main(['--root', root], out, capture()), 0);
    assert.match(out.text, /0 errors, 1 warning\./);
  });

  test('main checks only the files it is given', () => {
    const root = makeTree({ 'README.md': 'A leverage here.\n', 'docs/a.md': 'Fine.\n' });
    assert.equal(main(['--root', root, 'docs/a.md'], capture(), capture()), 0);
    assert.equal(main(['--root', root, 'README.md'], capture(), capture()), 1);
  });

  test('main reports a missing file without a stack trace', () => {
    const root = makeTree({ 'README.md': 'Fine.\n' });
    const err = capture();
    assert.equal(main(['--root', root, 'nope.md'], capture(), err), 1);
    assert.equal(err.text, 'File not found: nope.md\n');
  });

  test('the same input gives the same output', () => {
    const root = makeTree({ 'README.md': 'A leverage and a robust idea.\n' });
    const first = capture();
    const second = capture();
    main(['--root', root], first, capture());
    main(['--root', root], second, capture());
    assert.equal(first.text, second.text);
  });
});

describe('command line', () => {
  const run = (root, cwd) =>
    spawnSync(process.execPath, [scriptPath, '--root', root], { cwd, encoding: 'utf8' });

  test('exits 1 with findings, from any working directory and a root with spaces', () => {
    const root = makeTree({ 'README.md': 'A leverage here.\n' });
    const result = run(root, path.dirname(root));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /README\.md:1:3 {2}error {2}banned-word/);
    assert.equal(result.stderr, '');
  });

  test('exits 0 on clean docs and never reads script sources', () => {
    const root = makeTree({
      'README.md': 'Short and plain.\n',
      'scripts/check-writing-style.mjs': '// leverage — robust\n',
    });
    const result = run(root, root);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /1 file checked, 0 errors, 0 warnings\./);
  });
});
