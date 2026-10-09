// Markdown helpers shared by check-writing-style and check-links.
// Every mask function returns a string of the same length with the masked characters turned into
// spaces (line breaks stay), so an offset in the result is an offset in the original.
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DOCS = [
  'README.md',
  'CHANGELOG.md',
  'BACKLOG.md',
  'RELEASING.md',
  'AGENTS.md',
  'CLAUDE.md',
  'specs.md',
];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git']);
const SKIPPED_PATHS = new Set(['docs/coverage']);

export function toPosix(file) {
  return file.split(path.sep).join('/');
}

function isMarkdownName(name) {
  return /\.md$/i.test(name);
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function walkDocs(dir, relative, files) {
  for (const entry of listDir(dir)) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name) || SKIPPED_PATHS.has(child)) continue;
      walkDocs(path.join(dir, entry.name), child, files);
    } else if (entry.isFile() && isMarkdownName(entry.name)) {
      files.push(child);
    }
  }
}

// Returns repo-relative POSIX paths, sorted, for the Markdown files the doc checks cover.
export function collectMarkdownFiles(root) {
  const files = ROOT_DOCS.filter((name) => isFile(path.join(root, name)));
  for (const entry of listDir(path.join(root, 'releases'))) {
    if (entry.isFile() && isMarkdownName(entry.name)) files.push(`releases/${entry.name}`);
  }
  walkDocs(path.join(root, 'docs'), 'docs', files);
  return files.sort();
}

export function readMarkdown(file) {
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
}

// Curly quotes become straight ones, one character for one, so patterns only need to know "'".
export function normalizeQuotes(text) {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

// Maps a string offset to a 1-based line and column.
export function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
}

function blank(segment) {
  return segment.replace(/[^\r\n]/g, ' ');
}

function blankRanges(text, ranges) {
  if (ranges.length === 0) return text;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start < cursor) continue;
    out += text.slice(cursor, start) + blank(text.slice(start, end));
    cursor = end;
  }
  return out + text.slice(cursor);
}

const FENCE_PREFIX = String.raw`^\s*(?:(?:>|[-*+]|\d+[.)])\s+)*`;
const FENCE_OPEN = new RegExp(`${FENCE_PREFIX}(\`{3,}|~{3,})(.*)$`);
const FENCE_CLOSE = new RegExp(`${FENCE_PREFIX}(\`{3,}|~{3,})\\s*$`);

// Blanks fenced code blocks, fences included. An unclosed fence runs to the end of the file.
export function maskFences(text) {
  let open = null;
  return text
    .split('\n')
    .map((line) => {
      const bare = line.replace(/\r$/, '');
      if (open) {
        const close = FENCE_CLOSE.exec(bare);
        if (close && close[1][0] === open.char && close[1].length >= open.length) open = null;
        return blank(line);
      }
      const start = FENCE_OPEN.exec(bare);
      // A backtick fence can't carry backticks in its info string, so "```x```" is inline code.
      if (start && !(start[1][0] === '`' && start[2].includes('`'))) {
        open = { char: start[1][0], length: start[1].length };
        return blank(line);
      }
      return line;
    })
    .join('\n');
}

// Blanks inline code spans. A span ends at a backtick run of the same length in the same paragraph.
export function maskInlineCode(text) {
  const breaks = [...text.matchAll(/\r?\n[ \t]*\r?\n/g)].map((match) => match.index);
  const runs = [...text.matchAll(/`+/g)].map((match) => ({
    index: match.index,
    length: match[0].length,
  }));
  const ranges = [];
  let breakAt = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    while (breakAt < breaks.length && breaks[breakAt] < run.index) breakAt++;
    const paragraphEnd = breakAt < breaks.length ? breaks[breakAt] : text.length;
    for (let j = i + 1; j < runs.length && runs[j].index < paragraphEnd; j++) {
      if (runs[j].length === run.length) {
        ranges.push([run.index, runs[j].index + runs[j].length]);
        i = j;
        break;
      }
    }
  }
  return blankRanges(text, ranges);
}

export function maskComments(text) {
  const ranges = [...text.matchAll(/<!--[\s\S]*?-->/g)].map((m) => [m.index, m.index + m[0].length]);
  return blankRanges(text, ranges);
}

// Fences, inline code and HTML comments: text that is not prose and holds no links.
export function maskCode(text) {
  return maskComments(maskInlineCode(maskFences(text)));
}

function skipSpace(text, from) {
  let i = from;
  while (text[i] === ' ' || text[i] === '\t') i++;
  if (text[i] === '\r') i++;
  if (text[i] === '\n') {
    i++;
    while (text[i] === ' ' || text[i] === '\t') i++;
  }
  return i;
}

// Parses what follows "](": destination, optional title, closing paren. Returns null when it isn't a link.
function parseDestination(text, start) {
  let i = skipSpace(text, start);
  let destStart;
  let destEnd;
  if (text[i] === '<') {
    const close = text.indexOf('>', i + 1);
    if (close === -1 || text.slice(i, close).includes('\n')) return null;
    destStart = i + 1;
    destEnd = close;
    i = close + 1;
  } else {
    destStart = i;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (/\s/.test(ch)) break;
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    destEnd = i;
  }
  i = skipSpace(text, i);
  const opener = text[i];
  if (opener === '"' || opener === "'" || opener === '(') {
    const closer = opener === '(' ? ')' : opener;
    let j = i + 1;
    while (j < text.length && text[j] !== closer) j += text[j] === '\\' ? 2 : 1;
    if (j >= text.length) return null;
    i = skipSpace(text, j + 1);
  }
  if (text[i] !== ')') return null;
  return { start, end: i, destStart, destEnd, dest: text.slice(destStart, destEnd) };
}

function hasOpeningBracket(text, closeAt) {
  let depth = 0;
  const floor = Math.max(0, closeAt - 2000);
  for (let i = closeAt - 1; i >= floor; i--) {
    const ch = text[i];
    if (ch === '\n' && /^[ \t]*\r?\n/.test(text.slice(i + 1))) return false;
    if (text[i - 1] === '\\') continue;
    if (ch === ']') depth++;
    else if (ch === '[') {
      if (depth === 0) return true;
      depth--;
    }
  }
  return false;
}

// Finds inline links and images: [text](dest "title") and ![alt](dest). `start` and `end` bracket
// the parenthesised part (end is the index of the closing paren).
export function findInlineLinks(text) {
  const links = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('](', from);
    if (at === -1) break;
    from = at + 2;
    if (text[at - 1] === '\\' || !hasOpeningBracket(text, at)) continue;
    const parsed = parseDestination(text, at + 2);
    if (!parsed) continue;
    links.push(parsed);
    from = parsed.end + 1;
  }
  return links;
}

// Reference definitions: "[label]: dest". Footnotes ("[^1]:") are prose and stay out.
export function findReferenceDefinitions(text) {
  const definitions = [];
  for (const match of text.matchAll(/^[ ]{0,3}\[(?!\^)[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S*)/gm)) {
    const raw = match[1];
    const dest = raw.startsWith('<') ? raw.slice(1, -1) : raw;
    const destStart = match.index + match[0].length - raw.length + (raw.startsWith('<') ? 1 : 0);
    definitions.push({ dest, destStart, destEnd: destStart + dest.length });
  }
  return definitions;
}

// Prose-only view for the writing-style rules: code, comments, link targets, URLs and HTML tags go blank.
export function stripMarkdown(text) {
  const code = maskCode(text);
  const ranges = [];
  for (const link of findInlineLinks(code)) ranges.push([link.start, link.end]);
  for (const match of code.matchAll(/^[ ]{0,3}\[(?!\^)[^\]\n]+\]:[^\n]*$/gm)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  for (const match of code.matchAll(/\]\[[^\]\n]*\]/g)) {
    ranges.push([match.index + 1, match.index + match[0].length]);
  }
  for (const match of code.matchAll(/<[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*>/g)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  for (const match of code.matchAll(/\b(?:https?|ftp):\/\/[^\s<>]+/g)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  for (const match of code.matchAll(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]{0,500})?\/?>/g)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return blankRanges(code, ranges);
}

function plainHeadingText(raw) {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/(^|[^\w])_+([^_]+)_+(?=[^\w]|$)/g, '$1$2')
    .trim();
}

// GitHub heading slug: lowercase, drop everything but letters, marks, numbers, "_" and "-", then each
// space becomes a hyphen.
export function slugify(heading) {
  return plainHeadingText(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

function headingTexts(text) {
  const lines = maskComments(maskFences(text)).split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const atx = /^[ ]{0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) {
      headings.push(atx[1]);
      continue;
    }
    const previous = i > 0 ? lines[i - 1].replace(/\r$/, '') : '';
    const underline = /^[ ]{0,3}(?:=+|-{2,})[ \t]*$/.test(line);
    // A setext heading is a plain paragraph line over "===" or "---", not a list, quote, table or fence.
    const plain =
      previous.trim() !== '' && !/^[ ]{0,3}(?:#|>|\||[-*+][ \t]|\d+[.)][ \t]|`|~|<)/.test(previous);
    if (underline && plain) headings.push(previous.trim());
  }
  return headings;
}

// Every anchor a link can target in this Markdown text: heading slugs (with GitHub's -1, -2 suffixes
// for repeats) and explicit id or name attributes.
export function collectAnchors(text) {
  const anchors = new Set();
  const seen = new Map();
  for (const heading of headingTexts(text)) {
    const base = slugify(heading);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  for (const match of maskComments(maskFences(text)).matchAll(/<[a-z][^>]*?\s(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  return anchors;
}
