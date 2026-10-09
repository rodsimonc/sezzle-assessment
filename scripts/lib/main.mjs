import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function canonical(file) {
  const resolved = path.resolve(file);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

// True when the module runs as the entry point (node scripts/x.mjs) and false when a test imports it.
// Windows paths compare case-insensitively because argv[1] and import.meta.url can differ in drive case.
export function isMain(metaUrl, entry = process.argv[1], platform = process.platform) {
  if (!entry) return false;
  const self = canonical(fileURLToPath(metaUrl));
  const other = canonical(entry);
  return platform === 'win32' ? self.toLowerCase() === other.toLowerCase() : self === other;
}

// Arguments shared by the doc checkers: an optional --root <dir> and then the files to check.
export function parseCliArgs(argv, defaultRoot) {
  const parsed = { root: defaultRoot, files: [], help: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--root') {
      const value = argv[++i];
      if (!value) parsed.error = '--root needs a folder.';
      else parsed.root = path.resolve(value);
    } else if (arg.startsWith('--')) {
      parsed.error = `Unknown option ${arg}.`;
    } else {
      parsed.files.push(arg);
    }
  }
  return parsed;
}

export function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
