// Guards against the class of bug behind v1.1.16: a file the backend needs
// at runtime (a migration .sql, an i18n resource) exists in the repo but was
// never added to lab-backend.spec's `datas`, so PyInstaller doesn't bundle it
// and the packaged backend crashes on the operator's machine instead of here.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const specText = readFileSync(join(ROOT, 'lab-backend.spec'), 'utf8');

function filesMatching(dir, pattern) {
  return readdirSync(join(ROOT, dir)).filter((f) => pattern.test(f));
}

const checks = [
  { dir: 'database', pattern: /\.sql$/ },
  { dir: 'src/i18n', pattern: /\.json$/ },
];

const missing = [];
for (const { dir, pattern } of checks) {
  for (const file of filesMatching(dir, pattern)) {
    const relPath = `${dir}/${file}`;
    if (!specText.includes(relPath)) {
      missing.push(relPath);
    }
  }
}

if (missing.length > 0) {
  console.error('\nlab-backend.spec is missing datas entries for:');
  for (const f of missing) console.error(`  - ${f}`);
  console.error('\nAdd each one to the `datas` list in lab-backend.spec before building — otherwise');
  console.error('the packaged backend will fail on the operator\'s machine instead of here.\n');
  process.exit(1);
}

console.log('check-spec-datas: all migration/i18n files are present in lab-backend.spec.');
