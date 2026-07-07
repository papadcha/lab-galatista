// Αυτοματοποιημένα crash-recovery tests. Τρέχει ΜΕΣΑ σε Electron:
//     npx electron scripts/test-crash-recovery.js
// (εκτός Electron, το `import 'electron'` επιστρέφει απλά το path στο
// binary αντί για το API object — τα modules/*.js δεν θα δούλευαν).
//
// ΠΟΤΕ δεν αγγίζει την πραγματική userData/DB της εγκατάστασης: φτιάχνει
// δικό του απομονωμένο temp φάκελο μέσω app.setPath('userData', ...) πριν
// φορτωθεί οτιδήποτε άλλο module, και τον διαγράφει στο τέλος.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot   = path.join(__dirname, '..');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-galatista-crashtest-'));
app.setPath('userData', testDir);

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else      { console.log(`  ❌ ${msg}`); failed++; }
}

async function main() {
  const { loadConfig, saveConfig, performBackup } = await import('../modules/config.js');
  const { reconcileArchiveMode }                  = await import('../modules/archive-mode.js');
  const { reconcileCleanStart, performCleanStart } = await import('../modules/clean-start.js');
  const { startPythonBackend, waitForPythonReady, _pyCallMain } = await import('../modules/python-bridge.js');
  const { performStartupCloudSync }               = await import('../modules/cloud-sync.js');
  const { state } = await import('../modules/state.js');

  // ── Setup: throwaway data folder + φρέσκια DB μέσω πραγματικού Python backend ──
  const dataFolder = path.join(testDir, 'LabData');
  fs.mkdirSync(path.join(dataFolder, 'backup'), { recursive: true });
  fs.mkdirSync(path.join(dataFolder, 'pdf'),    { recursive: true });
  saveConfig({ dataFolder, activePeriodStart: '2026-01-01' });

  startPythonBackend(appRoot);
  const ready = await waitForPythonReady(15000);
  assert(ready, 'Python backend ξεκίνησε πάνω σε test DB');
  if (!ready) { console.log('Δεν μπορώ να συνεχίσω χωρίς Python — σταματάω.'); return; }

  // ── Test 1: reconcileArchiveMode — stale marker από crash μετά switch-to-archive ──
  console.log('\n[Test 1] reconcileArchiveMode — μη ολοκληρωμένη έξοδος από Archive Mode');
  saveConfig({ ...loadConfig(), archiveDataFolder: 'κάποιος-παλιός-φάκελος' });
  reconcileArchiveMode();
  assert(!loadConfig().archiveDataFolder, 'archiveDataFolder καθαρίστηκε στο startup reconcile');

  // ── Test 2: reconcileCleanStart — Python ΔΕΝ πρόλαβε να κάνει commit ──
  console.log('\n[Test 2] reconcileCleanStart — crash πριν το Python commit');
  const periodId = await _pyCallMain('create_ce_period', ['TEST-CE', 'TEST-BODY', '2026-01-01', '2029-01-01', dataFolder]);
  assert(typeof periodId === 'number' && periodId > 0, `test CE period δημιουργήθηκε (id=${periodId})`);

  const backupDir = path.join(dataFolder, 'backup');
  saveConfig({ ...loadConfig(), cleanStartPending: { dataFolder, backupDir } });
  await reconcileCleanStart();
  const cfgAfterNotCompleted = loadConfig();
  assert(!cfgAfterNotCompleted.cleanStartPending, 'marker καθαρίστηκε (δεν ολοκληρώθηκε)');
  assert(cfgAfterNotCompleted.dataFolder === dataFolder, 'dataFolder ΔΕΝ πειράχτηκε — η period ήταν ακόμα ενεργή');

  // ── Test 3: reconcileCleanStart — Python ΕΙΧΕ κάνει commit πριν χαθεί η απάντηση ──
  console.log('\n[Test 3] reconcileCleanStart — crash μετά το Python commit (χαμένη απάντηση)');
  fs.writeFileSync(path.join(backupDir, 'daily1.db'), 'dummy'); // προσομοίωση ημερήσιου backup προς διαγραφή
  const cleanResult = await _pyCallMain('clean_start', [
    path.join(backupDir, 'FINAL_test3.db'), true, true,
  ], 30000);
  assert(cleanResult?.ok, 'Python clean_start ολοκληρώθηκε (η period τώρα είναι ανενεργή)');

  saveConfig({ ...loadConfig(), dataFolder, activePeriodStart: '2026-01-01', cleanStartPending: { dataFolder, backupDir } });
  await reconcileCleanStart();
  const cfgAfterCompleted = loadConfig();
  assert(!cfgAfterCompleted.cleanStartPending, 'marker καθαρίστηκε (ολοκληρώθηκε)');
  assert(!cfgAfterCompleted.dataFolder, 'dataFolder καθαρίστηκε — reconcile ολοκλήρωσε το reset');
  assert(!fs.existsSync(path.join(backupDir, 'daily1.db')), 'ημερήσιο backup διαγράφηκε (κρατήθηκε μόνο το FINAL)');

  // ── Test 4: reconcileCleanStart — αδυναμία ελέγχου (Python down) δεν αγγίζει τίποτα ──
  console.log('\n[Test 4] reconcileCleanStart — Python μη διαθέσιμο στο reconcile, marker μένει άθικτο');
  saveConfig({ ...loadConfig(), dataFolder, cleanStartPending: { dataFolder, backupDir } });
  const realProcess = state.pyProcess;
  state.pyProcess = null; // προσομοίωση "Python δεν τρέχει" χωρίς να σκοτώσουμε το πραγματικό process ακόμα
  await reconcileCleanStart();
  state.pyProcess = realProcess;
  assert(loadConfig().cleanStartPending, 'marker ΔΕΝ αγγίχτηκε όταν δεν ξέρουμε την πραγματική κατάσταση');
  const cfgClean = loadConfig();
  delete cfgClean.cleanStartPending;
  saveConfig(cfgClean);

  // ── Test 5: performBackup integrity-check πιάνει κατεστραμμένο tmp (προσομοίωση crash mid-write) ──
  console.log('\n[Test 5] performBackup — corrupt αρχείο απορρίπτεται από το integrity check');
  const corruptPath = path.join(testDir, 'corrupt.db.tmp');
  fs.writeFileSync(corruptPath, 'αυτό δεν είναι έγκυρη SQLite βάση');
  const integrity = await _pyCallMain('check_db_integrity', [corruptPath], 10000);
  assert(integrity?.ok === false, 'check_db_integrity σωστά απορρίπτει κατεστραμμένο αρχείο');
  fs.unlinkSync(corruptPath);

  // ── Test 6: πλήρες, πραγματικό performCleanStart() end-to-end (ασφαλές — throwaway DB) ──
  console.log('\n[Test 6] performCleanStart — πλήρες πραγματικό τρέξιμο σε throwaway DB');
  saveConfig({ ...loadConfig(), dataFolder, activePeriodStart: '2026-01-01', cloudRemotePath: null });
  await _pyCallMain('create_ce_period', ['TEST-CE-2', 'TEST-BODY', '2026-02-01', '2029-02-01', dataFolder]);
  const result6 = await performCleanStart({ keepTechnicians: true, keepProducts: true });
  assert(result6?.ok, `performCleanStart ολοκληρώθηκε: ${JSON.stringify(result6?.error || 'ok')}`);
  if (result6?.ok) {
    assert(fs.existsSync(result6.finalPath), 'FINAL backup αρχείο δημιουργήθηκε');
    const finalIntegrity = await _pyCallMain('check_db_integrity', [result6.finalPath], 10000);
    assert(finalIntegrity?.ok, 'FINAL backup περνάει integrity check');
  }
  const cfgAfter6 = loadConfig();
  assert(!cfgAfter6.cleanStartPending, 'marker καθαρίστηκε αυτόματα μετά την κανονική ολοκλήρωση');
  assert(!cfgAfter6.dataFolder, 'dataFolder καθαρίστηκε μετά το πραγματικό clean start');

  // ── Test 7: switch_db απορρίπτει κατεστραμμένο backup αντί να "εναλλάξει" σιωπηλά ──
  console.log('\n[Test 7] switch_db — απόρριψη κατεστραμμένου backup αρχείου (Archive Mode / selective restore)');
  const corruptBackup = path.join(testDir, 'corrupt-backup.db');
  fs.writeFileSync(corruptBackup, 'αυτό δεν είναι έγκυρη SQLite βάση');
  const switchResult = await _pyCallMain('switch_db', [corruptBackup], 10000);
  assert(switchResult?.ok === false, 'switch_db απορρίπτει το κατεστραμμένο αρχείο (ok:false)');
  const restoreCheck = await _pyCallMain('get_active_ce_period', []);
  assert(restoreCheck?.ok !== false, 'η ζωντανή σύνδεση παρέμεινε ανεπηρέαστη μετά την απόρριψη');
  fs.unlinkSync(corruptBackup);

  // Happy path — ένα ΕΓΚΥΡΟ backup (το FINAL από το Test 6) πρέπει να γίνεται
  // κανονικά αποδεκτό, όχι μόνο να μπλοκάρεται το corrupt path.
  const validSwitch = await _pyCallMain('switch_db', [result6.finalPath], 10000);
  assert(validSwitch?.ok, 'switch_db δέχεται κανονικά ένα έγκυρο backup αρχείο');
  await _pyCallMain('restore_db', []); // επαναφορά στη ζωντανή test DB πριν το cleanup

  // ── Test 8: performStartupCloudSync ειδοποιεί το renderer σε πραγματική αποτυχία ──
  console.log('\n[Test 8] performStartupCloudSync — ενεργή ειδοποίηση σε αποτυχία (όχι μόνο παθητικό status)');
  const sentEvents = [];
  state.mainWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => sentEvents.push({ channel, payload }) },
  };
  saveConfig({ ...loadConfig(), dataFolder }); // performStartupCloudSync χρειάζεται getDataFolder()
  await performStartupCloudSync('bogus-remote-that-does-not-exist:'); // rclone: "δεν βρέθηκε remote" — πραγματική αποτυχία, όχι noInternet
  assert(sentEvents.some(e => e.channel === 'cloud-sync-failed'), 'στάλθηκε cloud-sync-failed event στο renderer σε πραγματική αποτυχία');
  assert(loadConfig().cloudLastSyncStatus === 'fail', 'cloudLastSyncStatus ενημερώθηκε σε fail');

  console.log('\n[Test 9] performStartupCloudSync — σεβασμός snooze (καμία επανάληψη ειδοποίησης)');
  sentEvents.length = 0;
  saveConfig({ ...loadConfig(), cloudSyncNotifySnoozedUntil: new Date(Date.now() + 86400000).toISOString() });
  await performStartupCloudSync('bogus-remote-that-does-not-exist:');
  assert(sentEvents.length === 0, 'καμία νέα ειδοποίηση όσο είναι snoozed');
  const cfgClean9 = loadConfig();
  delete cfgClean9.cloudSyncNotifySnoozedUntil;
  saveConfig(cfgClean9);

  // ── Καθαρισμός ──
  try { state.pyProcess?.kill(); } catch(e) {}
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch(e) {}

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Αποτελέσματα: ${passed} πέρασαν, ${failed} απέτυχαν`);
  console.log('='.repeat(50));
  app.exit(failed > 0 ? 1 : 0);
}

app.whenReady().then(main).catch((e) => {
  console.error('Σφάλμα στο test suite:', e);
  app.exit(1);
});
