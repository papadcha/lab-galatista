// Guards against the class of bug shipped in v2.0.0: main.js (or a module it
// pulls in) imports a local directory at runtime, but that directory was
// never added to package.json's `build.files` whitelist, so electron-builder
// doesn't package it and the installed app crashes immediately
// (ERR_MODULE_NOT_FOUND) instead of here — invisible in dev-mode/Playwright
// tests, only visible in a real installer build+run. Concrete case:
// `modules/**/*` was missing, see memory/TODOLIST.md for full history.
//
// This walks the real import graph starting from the app's entry points and
// checks every local file it touches is covered by `build.files`. It only
// catches relative import()/require() edges — literal path.join(appRootDir,
// 'x') resource references (fonts, VERSIONS.md, github-token.json, ...) are
// not tracked, since those already have explicit entries in `build.files`.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const filesPatterns = pkg.build.files;

const ENTRY_POINTS = ['main.js', 'preload.cjs', 'src/main-app.js'];
const IMPORT_RE = /(?:import\s+(?:[^'"]*?from\s+)?|import\(\s*|require\(\s*)['"](\.[^'"]+)['"]/g;

function resolveRelative(fromFile, relPath) {
  const target = join(dirname(fromFile), relPath);
  if (existsSync(target) && statSync(target).isFile()) return target;
  for (const ext of ['.js', '.cjs', '.mjs']) {
    if (existsSync(target + ext)) return target + ext;
  }
  if (existsSync(target) && statSync(target).isDirectory()) {
    for (const idx of ['index.js', 'index.cjs']) {
      if (existsSync(join(target, idx))) return join(target, idx);
    }
  }
  return null;
}

const visited = new Set();
const required = new Set();

function scan(absPath) {
  if (!absPath || visited.has(absPath)) return;
  visited.add(absPath);
  if (!existsSync(absPath) || !['.js', '.cjs', '.mjs'].includes(extname(absPath))) return;

  required.add(relative(ROOT, absPath).split(/[\\/]/)[0]);

  const text = readFileSync(absPath, 'utf8');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) {
    scan(resolveRelative(absPath, m[1]));
  }
}

for (const entry of ENTRY_POINTS) scan(join(ROOT, entry));

function isCovered(segment) {
  return filesPatterns.some((p) => !p.startsWith('!') && p.split('/')[0] === segment);
}

function isExcluded(segment) {
  return filesPatterns.some((p) => p.startsWith('!') && p.slice(1).split('/')[0] === segment);
}

const missing = [...required].filter((seg) => !isCovered(seg) || isExcluded(seg));

if (missing.length > 0) {
  console.error('\npackage.json build.files is missing entries for runtime-required paths:');
  for (const seg of missing) console.error(`  - ${seg}`);
  console.error('\nAdd each one to `build.files` in package.json before building the installer —');
  console.error('otherwise the packaged app will crash on launch instead of here.\n');
  process.exit(1);
}

console.log(
  `check-builder-files: all ${required.size} runtime-required top-level paths ` +
  `(${[...required].sort().join(', ')}) are present in build.files.`
);
