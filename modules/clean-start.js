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

async function performCleanStart(options = {}) {
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

  // 1. VACUUM INTO — final backup στον φάκελο της τρέχουσας περιόδου
  const backupDir = path.join(dataFolder, 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  const finalPath = path.join(backupDir, _buildBackupName(true));

  // Αφαίρεση τυχόν υπάρχοντος 0-byte αρχείου από αποτυχημένη προηγούμενη προσπάθεια
  try {
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size === 0) {
      fs.unlinkSync(finalPath);
    }
  } catch(e) {}

  try {
    const vacuumResult = await new Promise((resolve) => {
      const id  = 'vacuum-' + Date.now();
      const req = JSON.stringify({ method: 'vacuum_into', args: [finalPath], id }) + '\n';
      state.pyPending.set(id, resolve);
      try { state.pyProcess.stdin.write(req); }
      catch(e) { state.pyPending.delete(id); resolve({ ok: false, error: e.message }); }
      setTimeout(() => {
        if (state.pyPending.has(id)) { state.pyPending.delete(id); resolve({ ok: false, error: 'timeout' }); }
      }, 30000);
    });
    if (!vacuumResult?.ok) fs.copyFileSync(dbPath, finalPath);
  } catch(e) {
    try { fs.copyFileSync(dbPath, finalPath); } catch(e2) {}
  }

  // Επαλήθευση — αν το FINAL.db δεν δημιουργήθηκε σωστά, σταματάμε
  try {
    const finalSize = fs.existsSync(finalPath) ? fs.statSync(finalPath).size : 0;
    if (finalSize === 0) {
      try { fs.unlinkSync(finalPath); } catch(e) {}
      return { ok: false, error: 'Αποτυχία δημιουργίας backup — το Clean Start ακυρώθηκε' };
    }
  } catch(e) {
    return { ok: false, error: 'Αποτυχία επαλήθευσης backup: ' + e.message };
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

  // 3. Clean start μέσω Python — διαγραφή δειγμάτων, CE deactivation, επιλογές
  const cleanResult = await new Promise((resolve) => {
    const id  = 'clean-' + Date.now();
    const req = JSON.stringify({
      method: 'clean_start',
      args:   [finalPath, keepTechnicians, keepProducts],
      id
    }) + '\n';
    state.pyPending.set(id, resolve);
    try { state.pyProcess.stdin.write(req); }
    catch(e) { state.pyPending.delete(id); resolve({ ok: false, error: e.message }); }
    setTimeout(() => {
      if (state.pyPending.has(id)) { state.pyPending.delete(id); resolve({ ok: false, error: 'timeout' }); }
    }, 30000);
  });

  if (!cleanResult?.ok) return cleanResult;

  // 4. Διαγραφή daily backups — κρατάμε μόνο το FINAL
  _pruneBackups(backupDir, 0);

  // 5. Reset config — μόνο το dataFolder/activePeriodStart καθαρίζονται
  //    (θα οριστούν ξανά μέσω wizard στην επόμενη εκκίνηση)· όλες οι
  //    υπόλοιπες global ρυθμίσεις (cloud remote, retention, sync status)
  //    ΔΕΝ αφορούν συγκεκριμένη περίοδο και πρέπει να διατηρηθούν.
  saveConfig({
    cloudRemotePath:           cfg.cloudRemotePath || null,
    cloudRetentionDays:        cfg.cloudRetentionDays,
    cloudRetentionAutoEnabled: cfg.cloudRetentionAutoEnabled,
    cloudLastSync:             cfg.cloudLastSync,
    cloudLastSyncStatus:       cfg.cloudLastSyncStatus,
  });

  return { ok: true, finalPath, deleted: cleanResult.deleted };
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
