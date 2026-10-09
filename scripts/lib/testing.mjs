// Test helpers: fixture trees in a temp folder whose name contains a space, so every test also
// proves the scripts cope with spaces in paths.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created = [];

export function makeTree(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts test '));
  created.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

export function cleanTrees() {
  for (const root of created.splice(0)) fs.rmSync(root, { recursive: true, force: true });
}

// A writable stream stand-in that keeps what was written.
export function capture() {
  let text = '';
  return {
    write(chunk) {
      text += String(chunk);
      return true;
    },
    get text() {
      return text;
    },
  };
}
