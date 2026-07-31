// Πιάνει packaging-only σφάλματα (λάθος PyInstaller hiddenimports/datas,
// σπασμένο reportlab.graphics στο PDF chart rendering, ελληνικό encoding
// στο packaged exe) που δεν φαίνονται σε dev mode (system python) ούτε σε
// static analysis όπως το check-spec-datas.js/check-builder-files.js. Spawn-άρει
// το φρεσκοφτιαγμένο lab-backend.exe ακριβώς όπως το modules/python-bridge.js,
// πάνω σε throwaway φρέσκια βάση (ασκεί και το migration/initialize_database
// path μιας "νέας εγκατάστασης"), και τρέχει τις πιο επικίνδυνες εντολές:
// dashboard read, ελληνικό round-trip μέσω δείγματος, και πλήρες PDF report με
// κοκκομετρικό γράφημα (η μόνη εντολή που αγγίζει reportlab.graphics.shapes,
// βλ. lab-backend.spec hiddenimports).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BACKEND_EXE = process.argv[2] || join(import.meta.dirname, '..', 'dist', 'lab-backend', 'lab-backend.exe');

if (!existsSync(BACKEND_EXE)) {
  console.error(`smoke-test-backend: δεν βρέθηκε το lab-backend.exe στο ${BACKEND_EXE}`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'lab-galatista-smoke-'));
const outDir  = mkdtempSync(join(tmpdir(), 'lab-galatista-smoke-out-'));
const dbPath  = join(workDir, 'laboratory.db');
const logDir  = join(workDir, 'logs');
mkdirSync(logDir, { recursive: true });

const proc = spawn(BACKEND_EXE, [], {
  cwd: join(BACKEND_EXE, '..'),
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', LAB_DB_PATH: dbPath, LAB_LOG_DIR: logDir },
});

let buffer = '';
const pending = new Map();
let readyResolve;
const readyPromise = new Promise((r) => { readyResolve = r; });

let stderrBuf = '';
proc.stderr.on('data', (d) => { stderrBuf += d.toString('utf8'); });

proc.stdout.on('data', (data) => {
  buffer += data.toString('utf8');
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!t.startsWith('{')) {
      // Ίδια σύμβαση με modules/python-bridge.js: plain-text γραμμές είναι
      // logging, όχι JSON-RPC· το readiness σήμα είναι το "Αναμονή εντολών".
      if (t.includes('Αναμονή εντολών')) readyResolve();
      continue;
    }
    try {
      const msg = JSON.parse(t);
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p(msg); }
    } catch {
      // αγνόησε γραμμές που ξεκινούν με '{' αλλά δεν είναι έγκυρο JSON
    }
  }
});

function call(method, args = []) {
  return new Promise((resolve, reject) => {
    const id = `${method}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ id, method, args }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 15_000);
  });
}

const failures = [];
function check(label, cond) {
  if (!cond) failures.push(label);
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}`);
}

try {
  const bootTimeout = setTimeout(() => { throw new Error('backend δεν έστειλε "Αναμονή εντολών" μέσα σε 15s — δες stderr:\n' + stderrBuf); }, 15_000);
  await readyPromise;
  clearTimeout(bootTimeout);
  console.log('lab-backend.exe ready (νέα, άδεια βάση — δοκιμή του initialize_database path σε "νέα εγκατάσταση")');

  // 1. Βασικό read σε άδεια βάση — πιάνει crashes στο migration path.
  //    tbl_products προσυμπληρώνεται από schema.sql (INSERT OR IGNORE),
  //    άρα το ΑΜΜΟΣ (id=1) υπάρχει ήδη χωρίς seed_data.py.
  const products = await call('get_products');
  check('get_products σε νέα βάση', !products.error && Array.isArray(products.result) && products.result.length > 0);

  // 2. Ελληνικό round-trip μέσω stdin/stdout — bug: αλλοιωμένο κείμενο.
  const GREEK = 'ΔΟΚΙΜΗ ΑΜΜΟΣ ΓΑΛΑΤΙΣΤΑΣ — Ωμέγα δείγμα';
  const today = new Date().toISOString().slice(0, 10);
  const sampleCode = 'SMOKE-001';
  const created = await call('create_sample', [sampleCode, today, 1, null, null, null, GREEK]);
  check('create_sample (ελληνικό κείμενο)', !created.error && typeof created.result === 'number');
  const sampleId = typeof created.result === 'number' ? created.result : null;

  const report0 = sampleId ? await call('get_full_report', [sampleId]) : { error: 'no sampleId' };
  const roundTripOk = !report0.error && report0.result?.sample?.comments === GREEK;
  check('ελληνικό κείμενο round-trip χωρίς αλλοίωση', roundTripOk);

  // 3. Πλήρες PDF report με κοκκομετρικό γράφημα — η μοναδική εντολή που
  //    αγγίζει reportlab.graphics.shapes (Drawing/Line/PolyLine/Circle),
  //    ξεχωριστή κατηγορία hiddenimports απ' το απλό reportlab.platypus.
  //    Sieve set του ΑΜΜΟΣ (product_id=1) από schema.sql: 4/2/1/0.5/0.25/0.125/0.063mm.
  const sieveResults = [
    { sieve_mm: 4,     weight_retained: 0 },
    { sieve_mm: 2,     weight_retained: 20 },
    { sieve_mm: 1,     weight_retained: 60 },
    { sieve_mm: 0.5,   weight_retained: 120 },
    { sieve_mm: 0.25,  weight_retained: 150 },
    { sieve_mm: 0.125, weight_retained: 90 },
    { sieve_mm: 0.063, weight_retained: 40 },
  ];
  const sieveSaved = sampleId
    ? await call('save_sieve_analysis', [sampleId, today, 500, 495, 480, sieveResults])
    : { error: 'no sampleId' };
  check('save_sieve_analysis', !sieveSaved.error);

  const pdfPath = join(outDir, 'sieve-report.pdf');
  const pdf = sampleId
    ? await call('generate_pdf_report', [sampleId, ['sieve'], pdfPath])
    : { error: 'no sampleId' };
  const pdfOk = !pdf.error && pdf.result?.success !== false && existsSync(pdfPath) && statSync(pdfPath).size > 0;
  check('generate_pdf_report (sieve chart, reportlab.graphics) παράγει έγκυρο PDF', pdfOk);
  if (pdf.error) console.log(`       error: ${pdf.error}`);
  if (pdf.result?.error) console.log(`       error: ${pdf.result.error}`);
} catch (e) {
  console.error('smoke-test-backend: εξαίρεση:', e.message);
  failures.push(e.message);
} finally {
  proc.kill();
  // Στα Windows η διαγραφή του φακέλου πριν προλάβει η διεργασία να
  // τερματίσει πλήρως (και να ελευθερώσει το lock στο db/log file) σκάει
  // με EPERM — περιμένουμε πρώτα το exit, με timeout ασφαλείας.
  await Promise.race([
    new Promise((r) => proc.once('exit', r)),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  try { rmSync(outDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

if (failures.length > 0) {
  console.error(`\nsmoke-test-backend: ${failures.length} αποτυχία/ες — το lab-backend.exe ΔΕΝ είναι έτοιμο για installer:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nsmoke-test-backend: όλοι οι έλεγχοι πέρασαν.');
