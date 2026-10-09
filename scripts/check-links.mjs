#!/usr/bin/env node
// Checks relative links, images and #fragments in the project Markdown files.
// Anchors follow GitHub's slug rules, so a link that works on GitHub also passes here.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOP_LEVEL_FILES = ['README.md', 'CHANGELOG.md', 'BACKLOG.md', 'RELEASING.md', 'AGENTS.md', 'CLAUDE.md', 'specs.md'];
const SKIP_DIRS = new Set(['node_modules', '.git']);

// Turns a heading into the anchor GitHub generates for it.
export function slugify(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

// Splits Markdown into lines and marks the ones inside fenced code blocks.
export function scanLines(markdown) {
  const lines = [];
  let fence = null;
  markdown.split(/\r?\n/).forEach((text, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(text);
    if (fence === null && marker) {
      fence = marker[1];
      lines.push({ line: index + 1, text, code: true });
      return;
    }
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && text.trim() === marker[1]) {
        fence = null;
      }
      lines.push({ line: index + 1, text, code: true });
      return;
    }
    lines.push({ line: index + 1, text, code: false });
  });
  return lines;
}

// Returns the set of anchors a Markdown document exposes, with -1, -2 suffixes for repeats.
export function headingSlugs(markdown) {
  const counts = new Map();
  const slugs = new Set();
  for (const { text, code } of scanLines(markdown)) {
    if (code) continue;
    const match = /^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(text);
    if (!match) continue;
    const base = slugify(match[1]);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    slugs.add(seen === 0 ? base : `${base}-${seen}`);
  }
  return slugs;
}

// Finds every inline link and image target outside code.
export function extractLinks(markdown) {
  const links = [];
  for (const { line, text, code } of scanLines(markdown)) {
    if (code) continue;
    const withoutCodeSpans = text.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length));
    for (const match of withoutCodeSpans.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ line, target: match[1] });
    }
  }
  return links;
}

// Returns a problem message for a broken target, or null when the link resolves.
export function validateTarget(target, fromFile, anchorCache) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const hash = target.indexOf('#');
  const rawPath = hash === -1 ? target : target.slice(0, hash);
  const fragment = hash === -1 ? '' : target.slice(hash + 1);

  let pathPart;
  try {
    pathPart = decodeURIComponent(rawPath);
  } catch {
    return `malformed link "${target}"`;
  }

  const targetFile = pathPart === '' ? fromFile : resolve(dirname(fromFile), pathPart);
  if (!existsSync(targetFile)) return `missing target "${rawPath}"`;
  if (fragment === '' || statSync(targetFile).isDirectory() || !targetFile.endsWith('.md')) return null;

  if (!anchorCache.has(targetFile)) {
    anchorCache.set(targetFile, headingSlugs(readFileSync(targetFile, 'utf8')));
  }
  if (!anchorCache.get(targetFile).has(fragment)) {
    return `missing anchor "#${fragment}" in ${relative(ROOT, targetFile).split(sep).join('/')}`;
  }
  return null;
}

function walk(dir, found) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== join(ROOT, 'docs', 'coverage')) walk(full, found);
    } else if (entry.name.endsWith('.md')) {
      found.push(full);
    }
  }
}

// Lists the Markdown files the link check covers.
export function markdownFiles(root = ROOT) {
  const found = TOP_LEVEL_FILES.map((name) => join(root, name)).filter(existsSync);
  walk(join(root, 'releases'), found);
  walk(join(root, 'docs'), found);
  return found;
}

// Runs the check over the repository and returns the file count and the failure messages.
export function checkLinks(root = ROOT) {
  const files = markdownFiles(root);
  const anchorCache = new Map();
  const failures = [];
  for (const file of files) {
    const markdown = readFileSync(file, 'utf8');
    for (const { line, target } of extractLinks(markdown)) {
      const problem = validateTarget(target, file, anchorCache);
      if (problem) {
        failures.push(`${relative(root, file).split(sep).join('/')}:${line}: ${problem}`);
      }
    }
  }
  return { files: files.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { files, failures } = checkLinks();
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(`check-links: ${failures.length} broken link(s) in ${files} file(s).`);
    process.exit(1);
  }
  console.log(`check-links: all links resolve in ${files} file(s).`);
}
