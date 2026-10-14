// Explicit source allowlist; never copies node_modules, runtime state or credentials.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(app, process.argv[2] ?? '../../submission-package-ready');
if (fs.existsSync(target)) throw new Error('Output directory already exists. Preserve it and pass a new output path before packaging again.');
const roots = ['src', 'scripts', 'docs', 'experiments', 'public'];
const files = ['package.json', 'package-lock.json', 'README.md', 'README-legacy.md', 'DATA_SOURCES.md',
  '.gitignore', '.env.example', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json',
  'eslint.config.mjs', 'vitest.config.mts', 'vitest.in-process.config.mjs'];
const omitted = new Set(['CLAUDE.md', 'AGENTS.md', 'h25-june.json']);
const entries = [];
function copy(relative) {
  const source = path.join(app, relative);
  if (!fs.existsSync(source) || omitted.has(path.basename(relative))) return;
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(source)) {
      if (['node_modules', 'runs', '.git', '.next', '__pycache__'].includes(name)) continue;
      copy(path.join(relative, name));
    }
    return;
  }
  if (/^\.env/.test(path.basename(relative)) && path.basename(relative) !== '.env.example') throw new Error(`Unexpected environment file: ${relative}`);
  const bytes = fs.readFileSync(source);
  const dest = path.join(target, 'paypal-solar', relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  entries.push({ file: `paypal-solar/${relative.replaceAll('\\', '/')}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const entry of [...roots, ...files]) copy(entry);
for (const name of ['README.md', 'LICENSE', 'render.yaml']) {
  const source = path.join(app, '..', name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, name));
}
fs.writeFileSync(path.join(target, 'SOURCE-MANIFEST.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: 'Source bundle from the current working tree, not a claim of a published release. See docs/VERIFICATION.md.',
  omitted: ['core/', 'assistant instruction files', 'runtime runs/', 'credentials', 'node_modules', 'downloaded BDEW H25'],
  files: entries,
}, null, 2) + '\n');
console.log(`Prepared ${entries.length} files in ${target}`);
