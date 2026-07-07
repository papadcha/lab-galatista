// Clean Start: κλείσιμο CE period/υποπεριόδου — FINAL backup, upload στο
// cloud (με επιβεβαίωση αν αποτύχει), διαγραφή δειγμάτων μέσω Python,
// καθαρισμός ημερήσιων backups, μερικό reset του config (μόνο dataFolder/
// activePeriodStart, όχι οι υπόλοιπες global ρυθμίσεις).
import { app, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { state } from './state.js';
import { _pyCallMain } from './python-bridge.js';
import { loadConfig, saveConfig, getDbPath, getDataFolder, _buildBackupName, _pruneBackups } from './config.js';
import { runSplitCloudSync } from './cloud-sync.js';

export async function performCleanStart(options = {}) {
  const {
    keepTechnicians = true,
    keepProducts    = true
  } = options;

  const dbPath     = getDbPath();
  const dataFolder = getDataFolder();
  if (!dbPath || !dataFolder) return { ok: false, error: 'Δεν βρέθηκε DB ή φάκελος' };

  // 0. Αποθήκευση dataFolder στην τρέχουσα CE period (πριν χαθεί από config reset)
  const cfgPre = loadConfig();
  if (cfgPre.dataFolder) {
    await _pyCallMain('update_active_ce_period_folder', [cfgPre.dataFolder]);
  }

  // 1. VACUUM INTO — final backup στον φάκελο της τρέχουσας περιόδου.
  // tmp + integrity-check + rename (ίδιο pattern με performBackup, config.js)
  // ώστε ένα crash στη μέση του VACUUM να αφήνει μόνο ένα ορφανό .tmp, ποτέ
  // ένα μη-μηδενικό αλλά κατεστραμμένο FINAL αρχείο (η παλιά εκδοχή έλεγχε
  // μόνο size!==0, όχι πραγματική ακεραιότητα SQLite).
  const backupDir = path.join(dataFolder, 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  const finalPath = path.join(backupDir, _buildBackupName(true));
  const tmpPath   = finalPath + '.tmp';
  try { fs.unlinkSync(tmpPath); } catch(e) {}

  try {
    const vacuumResult = await _pyCallMain('vacuum_into', [tmpPath], 30000);
    if (!vacuumResult?.ok) fs.copyFileSync(dbPath, tmpPath);

    const integrity = await _pyCallMain('check_db_integrity', [tmpPath], 30000);
    if (!integrity?.ok) {
      try { fs.unlinkSync(tmpPath); } catch(e) {}
      return { ok: false, error: 'Αποτυχία δημιουργίας backup — αποτυχία ελέγχου ακεραιότητας: ' + (integrity?.result || integrity?.error || 'άγνωστο σφάλμα') };
    }
    fs.renameSync(tmpPath, finalPath);
  } catch(e) {
    try { fs.unlinkSync(tmpPath); } catch(e2) {}
    return { ok: false, error: 'Αποτυχία δημιουργίας backup: ' + e.message };
  }

  // 2. Cloud sync πριν διαγραφή (αν υπάρχει remote)
  const cfg = loadConfig();
  if (cfg.cloudRemotePath) {
    let syncOk = false;
    try {
      const syncResult = await runSplitCloudSync(dataFolder, cfg.cloudRemotePath);
      syncOk = !!syncResult?.ok;
      if (!syncOk) console.warn('[CleanStart] Cloud sync απέτυχε:', syncResult?.error);
    } catch(e) {
      console.warn('[CleanStart] Cloud sync warning:', e.message);
    }
    // Το FINAL backup είναι η μόνη μόνιμη καταγραφή της κλειόμενης περιόδου —
    // αν δεν ανέβηκε στο cloud, ρωτάμε πριν προχωρήσουμε στη διαγραφή, ώστε
    // να μη μείνει το backup ΜΟΝΟ τοπικά χωρίς να το ξέρει κανείς.
    if (!syncOk) {
      const { response } = await dialog.showMessageBox(state.mainWindow, {
        type: 'warning',
        buttons: ['Ακύρωση', 'Συνέχεια χωρίς cloud backup'],
        defaultId: 0,
        cancelId: 0,
        title: 'Αποτυχία Cloud Sync',
        message: 'Το backup της κλειόμενης περιόδου δεν ανέβηκε στο cloud ' +
                 '(πρόβλημα σύνδεσης ή διαμόρφωσης). Αν συνεχίσετε, θα υπάρχει ' +
                 'μόνο τοπικά μέχρι το επόμενο επιτυχημένο sync.',
      });
      if (response !== 1) {
        return { ok: false, error: 'Ακυρώθηκε — αποτυχία cloud sync', canceled: true };
      }
    }
  }

  // Marker πριν την κλήση Python — αν ο Node κλείσει/κολλήσει μετά το commit
  // του Python αλλά πριν προλάβει να τρέξει τα βήματα 4-5 παρακάτω (π.χ.
  // crash ή χαμένη απάντηση πίσω από το 30s timeout), το config θα έμενε να
  // δείχνει σε μια ήδη-κλεισμένη περίοδο χωρίς τίποτα να το ανιχνεύσει στο
  // επόμενο άνοιγμα. Το reconcileCleanStart() στο startup ελέγχει αυτό το
  // marker (βλ. main.js).
  saveConfig({ ...loadConfig(), cleanStartPending: { dataFolder, backupDir } });

  // 3. Clean start μέσω Python — διαγραφή δειγμάτων, CE deactivation, επιλογές
  const cleanResult = await new Promise((resolve) => {
    const id  = 'clean-' + Date.now();
    const req = JSON.stringify({
      method: 'clean_start',
      args:   [finalPath, keepTechnicians, keepProducts],
      id
    }) + '\n';
    const timer = setTimeout(() => {
      if (state.pyPending.has(id)) { state.pyPending.delete(id); resolve({ ok: false, error: 'timeout' }); }
    }, 30000);
    state.pyPending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    try { state.pyProcess.stdin.write(req); }
    catch(e) { state.pyPending.delete(id); clearTimeout(timer); resolve({ ok: false, error: e.message }); }
  });

  if (!cleanResult?.ok) return cleanResult;

  _finishCleanStart(backupDir);

  return { ok: true, finalPath, deleted: cleanResult.deleted };
}

// Βήματα 4-5 (καθαρισμός ημερήσιων backups + partial config reset) —
// ξεχωριστή συνάρτηση ώστε να καλείται είτε αμέσως μετά την επιτυχή Python
// κλήση (κανονική ροή) είτε από reconcileCleanStart() αν ο Node δεν πρόλαβε
// να τα τρέξει πριν από ένα crash. Ο fresh loadConfig()/saveConfig() εδώ
// καθαρίζει αυτόματα το cleanStartPending marker (φτιάχνουμε καινούριο
// object χωρίς αυτό το κλειδί).
function _finishCleanStart(backupDir) {
  _pruneBackups(backupDir, 0);
  const cfg = loadConfig();
  saveConfig({
    cloudRemotePath:           cfg.cloudRemotePath || null,
    cloudRetentionDays:        cfg.cloudRetentionDays,
    cloudRetentionAutoEnabled: cfg.cloudRetentionAutoEnabled,
    cloudLastSync:             cfg.cloudLastSync,
    cloudLastSyncStatus:       cfg.cloudLastSyncStatus,
  });
}

// Καλείται στο startup (main.js), πριν το αυτόματο backup. Αν βρεθεί
// cleanStartPending marker από μη ολοκληρωμένο Clean Start, ρωτάει το Python
// αν η CE period είναι ήδη ανενεργή (δηλ. το clean_start είχε πράγματι κάνει
// commit πριν χαθεί η απάντηση προς τον Node) — αν ναι, ολοκληρώνει τα
// βήματα 4-5 τώρα· αν όχι (crash πριν προλάβει ο Python να κάνει commit),
// απλά καθαρίζει το ξεπερασμένο marker, αφού τίποτα άλλο δεν χρειάζεται.
export async function reconcileCleanStart() {
  const cfg = loadConfig();
  const pending = cfg.cleanStartPending;
  if (!pending) return;

  const period = await _pyCallMain('get_active_ce_period', []);
  if (period?.ok === false) {
    // _pyCallMain απέτυχε (π.χ. timeout) — δεν ξέρουμε πραγματικά αν το
    // clean_start ολοκληρώθηκε, οπότε ΔΕΝ αγγίζουμε τίποτα (θα ξαναδοκιμάσει
    // στο επόμενο άνοιγμα). Παίρνοντας το λάθος κλαδί εδώ θα μπορούσε να
    // διαγράψει backups/κάνει config reset ενώ το clean_start ίσως να μην
    // έχει καν τρέξει ακόμα.
    console.warn('[CleanStart] Αδυναμία ελέγχου κατάστασης CE period στο startup reconcile — παράλειψη προς το παρόν.');
    return;
  }
  if (!period?.id) {
    console.warn('[CleanStart] Βρέθηκε μη ολοκληρωμένο Clean Start (το Python είχε ήδη ολοκληρώσει) — ολοκλήρωση καθαρισμού.');
    _finishCleanStart(pending.backupDir);
  } else {
    console.warn('[CleanStart] Βρέθηκε μη ολοκληρωμένο Clean Start (δεν πρόλαβε να ολοκληρωθεί) — καθαρισμός marker.');
    const cfgClean = loadConfig();
    delete cfgClean.cleanStartPending;
    saveConfig(cfgClean);
  }
}

ipcMain.handle('clean-start', async (event, options = {}) => {
  const result = await performCleanStart(options);
  if (result?.ok) {
    // Επανεκκίνηση μετά από 2.5s — ο renderer προλαβαίνει να δείξει το toast
    // και μετά η εφαρμογή ξεκινάει καθαρά με null dataFolder → wizard
    setTimeout(() => { app.relaunch(); app.exit(0); }, 2500);
  }
  return result;
});
