// Writing-style gate for the Markdown docs. The rules mirror "Writing style" in AGENTS.md.
// Usage: node scripts/check-writing-style.mjs [--root <dir>] [file ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/main.mjs';
import {
  collectMarkdownFiles,
  lineIndex,
  normalizeQuotes,
  readMarkdown,
  stripMarkdown,
} from './lib/markdown.mjs';

// The banned lists live here so a change to the style is a change to this object only.
export const BANNED = {
  // Matched with their common inflections (leverage, leverages, leveraged, leveraging).
  words: [
    'delve', 'realm', 'harness', 'unlock', 'tapestry', 'paradigm', 'cutting-edge', 'revolutionize',
    'landscape', 'intricate', 'intricacies', 'showcasing', 'crucial', 'pivotal', 'surpass',
    'meticulously', 'vibrant', 'unparalleled', 'underscore', 'leverage', 'synergy', 'innovative',
    'game-changer', 'testament', 'commendable', 'meticulous', 'highlight', 'emphasize', 'boast',
    'groundbreaking', 'align', 'foster', 'showcase', 'enhance', 'holistic', 'garner', 'accentuate',
    'pioneering', 'trailblazing', 'unleash', 'versatile', 'transformative', 'redefine', 'seamless',
    'optimize', 'scalable', 'robust', 'breakthrough', 'empower', 'streamline', 'frictionless',
    'elevate', 'adaptive', 'effortless', 'data-driven', 'insightful', 'proactive', 'mission-critical',
    'visionary', 'disruptive', 'reimagine', 'unprecedented', 'intuitive', 'leading-edge', 'synergize',
    'democratize', 'accelerate', 'state-of-the-art', 'dynamic', 'immersive', 'predictive',
    'transparent', 'proprietary', 'integrated', 'plug-and-play', 'turnkey', 'future-proof',
    'supercharge', 'enduring', 'interplay', 'valuable', 'captivate', 'straightforward',
  ],
  // "boasts" is covered by the word "boast". "In order to" has its own rule (inOrderTo).
  phrases: [
    'serves as',
    'stands as',
    'marks a',
    'represents a',
    "it's worth noting",
    'it is worth noting',
    'furthermore',
    'additionally',
    'moreover',
    'that said',
    'that being said',
    'on top of that',
    "let's dive in",
    'moving forward',
    'at the end of the day',
  ],
  inOrderTo: 'in order to',
};

const SEPARATOR = '[-\\u2010\\u2011 ]';

// Builds the regex source for a word and its inflections: verb forms, plurals and -ly adverbs,
// plus the -ise spelling of every -ize word.
export function wordPattern(word) {
  const w = word.toLowerCase();
  if (w.includes('-')) return `\\b${w.split('-').join(SEPARATOR)}s?\\b`;
  const spelled = (stem) => stem.replace(/iz/g, 'i[sz]');
  if (/[^aeiou]y$/.test(w)) return `\\b${w.slice(0, -1)}(?:y|ies|ied|ying|ily)\\b`;
  if (w.endsWith('e')) {
    const endings = w.endsWith('le') ? '(?:e|es|ed|ing|ely|y)' : '(?:e|es|ed|ing|ely)';
    return `\\b${spelled(w.slice(0, -1))}${endings}\\b`;
  }
  return `\\b${w}(?:s|es|ed|ing|ly${w.endsWith('ic') ? '|ally' : ''})?\\b`;
}

function phrasePattern(phrase) {
  return `\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`;
}

const WORD_RULES = BANNED.words.map((word) => ({
  word,
  regex: new RegExp(wordPattern(word), 'gi'),
}));
const PHRASE_RULES = BANNED.phrases.map((phrase) => ({
  phrase,
  regex: new RegExp(phrasePattern(phrase), 'gi'),
}));
const IN_ORDER_TO = new RegExp(phrasePattern(BANNED.inOrderTo), 'gi');

// A sentence body: anything except a sentence end. A "." followed by a non-space ("v1.0.0") doesn't end it.
const S = String.raw`(?:[^.!?]|[.!?](?!\s|$))`;

// Negative parallelism and reframing. `group` picks the capture group that marks the start of the hit.
export const PARALLELISM_PATTERNS = [
  { name: 'not only ... but', regex: new RegExp(String.raw`\bnot\s+only\b${S}{0,200}?\bbut\b`, 'gi') },
  { name: 'not just', regex: /\bnot\s+just\b/gi },
  {
    name: "isn't X. It's Y",
    regex: new RegExp(
      String.raw`\b(?:isn't|is\s+not|aren't|are\s+not|wasn't|was\s+not|weren't|were\s+not)\b${S}{1,120}[.!?]\s+(?:it's|it\s+is|this\s+is|that's|that\s+is|these\s+are|they're|they\s+are)\b`,
      'gi',
    ),
  },
  {
    name: "isn't X, it's Y",
    regex: new RegExp(
      String.raw`\b(?:isn't|is\s+not|aren't|are\s+not)\b[^.!?;]{1,80}?,\s*(?:it's|it\s+is|this\s+is|that's|that\s+is)\b`,
      'gi',
    ),
  },
  { name: 'not X, but Y', regex: /\bnot\b[^.!?;,\n]{1,40},\s+but\b/gi },
  { name: 'less X, more Y', regex: /\bless\b[^.!?,;\n]{1,40},\s*more\b/gi },
  {
    name: 'Stop X-ing. Start Y',
    regex: new RegExp(String.raw`\bstop\s+\w+ing\b[^.!?]{0,60}[.!?,;]\s*(?:and\s+)?start\b`, 'gi'),
  },
  { name: 'X? No. Y', regex: /\?\s+(No[.!]\s+\S)/g, group: 1 },
  { name: 'Forget X', regex: /(?:^|[.!?]\s+|\n\s*)(Forget\s+\S+)/g, group: 1 },
];

const PLACEHOLDER = /\b[XYZ]\b/;

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of', 'on', 'or', 'the',
  'to', 'vs', 'via', 'with',
]);

// True for headings such as "Title Case With Many Capitals". Acronyms and small words don't count.
export function looksTitleCased(heading) {
  const words = (heading.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).slice(1);
  const counted = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()) && w !== w.toUpperCase());
  const capitalised = counted.filter((w) => /^[A-Z]/.test(w));
  return capitalised.length >= 3 && capitalised.length / counted.length >= 0.75;
}

function shorten(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

// A rule has an id, a severity and find(text), which returns { index, message, match } hits.
export const RULES = [
  {
    id: 'banned-word',
    severity: 'error',
    find(text) {
      const hits = [];
      for (const { word, regex } of WORD_RULES) {
        for (const match of text.matchAll(regex)) {
          const found = match[0].toLowerCase() === word ? '' : ` (found "${match[0]}")`;
          hits.push({ index: match.index, match: match[0], message: `banned word "${word}"${found}` });
        }
      }
      return hits;
    },
  },
  {
    id: 'banned-phrase',
    severity: 'error',
    find(text) {
      const hits = [];
      for (const { phrase, regex } of PHRASE_RULES) {
        for (const match of text.matchAll(regex)) {
          hits.push({ index: match.index, match: match[0], message: `banned phrase "${phrase}"` });
        }
      }
      return hits;
    },
  },
  {
    id: 'em-dash',
    severity: 'error',
    find(text) {
      return [...text.matchAll(/\u2014/g)].map((match) => ({
        index: match.index,
        match: match[0],
        message: 'em dash (U+2014): use a comma, period, colon or parentheses',
      }));
    },
  },
  {
    id: 'negative-parallelism',
    severity: 'error',
    find(text) {
      const hits = [];
      const seen = new Set();
      for (const { name, regex, group } of PARALLELISM_PATTERNS) {
        for (const match of text.matchAll(regex)) {
          // A pattern written with the placeholders X, Y or Z is a mention (AGENTS.md describes the rule that way).
          if (PLACEHOLDER.test(match[0])) continue;
          const index = match.index + (group ? match[0].length - match[group].length : 0);
          // "not only X, but also Y" also fits "not X, but Y". The first pattern in the list wins.
          if (seen.has(index)) continue;
          seen.add(index);
          hits.push({
            index,
            match: match[0],
            message: `negative parallelism (${name}): state the positive claim. Found "${shorten(match[0])}"`,
          });
        }
      }
      return hits;
    },
  },
  {
    id: 'in-order-to',
    severity: 'error',
    find(text) {
      return [...text.matchAll(IN_ORDER_TO)].map((match) => ({
        index: match.index,
        match: match[0],
        message: '"In order to": write "to"',
      }));
    },
  },
  {
    id: 'heading-case',
    severity: 'warning',
    find(text) {
      const hits = [];
      for (const match of text.matchAll(/^[ ]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm)) {
        if (looksTitleCased(match[1])) {
          hits.push({
            index: match.index + match[0].indexOf(match[1]),
            match: match[1],
            message: `heading looks like Title Case, use sentence case: "${shorten(match[1])}"`,
          });
        }
      }
      return hits;
    },
  },
];

// Scans one Markdown text. Code, comments, link targets and URLs are skipped.
export function scanText(source, file = '') {
  const text = stripMarkdown(normalizeQuotes(source));
  const position = lineIndex(text);
  const findings = [];
  for (const rule of RULES) {
    for (const hit of rule.find(text)) {
      const { line, column } = position(hit.index);
      findings.push({
        file,
        line,
        column,
        rule: rule.id,
        severity: rule.severity,
        message: hit.message,
        match: hit.match,
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
}

export function checkMarkdown(root, files = collectMarkdownFiles(root)) {
  const findings = [];
  for (const relative of files) {
    findings.push(...scanText(readMarkdown(path.resolve(root, relative)), relative));
  }
  return { files, findings };
}

export function formatFinding(finding) {
  return `${finding.file}:${finding.line}:${finding.column}  ${finding.severity}  ${finding.rule}  ${finding.message}`;
}

function parseArgs(argv, defaultRoot) {
  let root = defaultRoot;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      root = path.resolve(argv[++i] ?? '');
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      return { help: true, root, files };
    } else {
      files.push(argv[i]);
    }
  }
  return { help: false, root, files };
}

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Returns the exit code: 1 when any error is found, 0 otherwise (warnings don't fail the run).
export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  const { help, root, files } = parseArgs(argv, defaultRoot);
  if (help) {
    out.write('Usage: node scripts/check-writing-style.mjs [--root <dir>] [file ...]\n');
    return 0;
  }
  const missing = files.filter((file) => !fs.existsSync(path.resolve(root, file)));
  if (missing.length > 0) {
    err.write(`File not found: ${missing.join(', ')}\n`);
    return 1;
  }
  const targets = files.length > 0 ? files : collectMarkdownFiles(root);
  const { findings } = checkMarkdown(root, targets);
  for (const finding of findings) out.write(`${formatFinding(finding)}\n`);
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  out.write(
    `Writing style: ${plural(targets.length, 'file')} checked, ${plural(errors, 'error')}, ${plural(warnings, 'warning')}.\n`,
  );
  return errors > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = main();
}
