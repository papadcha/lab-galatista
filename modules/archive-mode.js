// Archive Mode: εναλλαγή της ζωντανής σύνδεσης βάσης σε ένα archived DB
// αρχείο (CE period ή οποιοδήποτε επιλεγμένο backup), ώστε όλη η εφαρμογή
// να δουλεύει διαφανώς πάνω σε αυτό μέχρι να γίνει restore-from-archive.
//
// Επιλεκτική Επαναφορά Δείγματος από Backup ζει εδώ κιόλας — μοιράζεται
// την ίδια υποδομή (Archive Mode γενικεύτηκε ώστε να δέχεται ΟΠΟΙΟΔΗΠΟΤΕ
// backup path, όχι μόνο auto-discovered *_FINAL.db μέσω find_archive_db).
// Δύο μονοπάτια: (α) το δείγμα ανήκει στην ΤΡΕΧΟΥΣΑ ενεργή υποπερίοδο →
// βαθιά αντιγραφή μέσα στη ζωντανή βάση (merge-sample-from-backup)·
// (β) ανήκει σε ΠΡΟΗΓΟΥΜΕΝΗ περίοδο → switch-to-backup-file, οι όποιες
// διορθώσεις γράφονται μόνο εκεί, καμία επίδραση στη ζωντανή χρήση.
import { ipcMain } from 'electron';
import fs from 'fs';
import { state } from './state.js';
import { _pyCallMain } from './python-bridge.js';
import { loadConfig, saveConfig, performBackup } from './config.js';

ipcMain.handle('find-archive-db', async (event, dataFolder) => {
  return await _pyCallMain('find_archive_db', [dataFolder]);
});

ipcMain.handle('switch-to-archive', async (event, { dataFolder, periodId }) => {
  const found = await _pyCallMain('find_archive_db', [dataFolder]);
  if (!found?.ok) return found;
  const switched = await _pyCallMain('switch_db', [found.path]);
  if (!switched?.ok) return switched;
  state.archiveMode       = true;
  state.archivePeriodId   = periodId;
  state.archiveDataFolder = dataFolder;
  // Αποθήκευση στο config για robustness (επιβιώνει αν χαθεί η μνήμη)
  const cfgA = loadConfig();
  saveConfig({ ...cfgA, archiveDataFolder: dataFolder });
  return { ok: true, dbPath: found.path };
});

ipcMain.handle('restore-from-archive', async () => {
  const result = await _pyCallMain('restore_db', []);
  if (!result?.ok) return result;
  state.archiveMode       = false;
  state.archivePeriodId   = null;
  state.archiveDataFolder = null;
  // Καθαρισμός από config
  const cfgR = loadConfig();
  delete cfgR.archiveDataFolder;
  saveConfig(cfgR);
  return { ok: true };
});

ipcMain.handle('is-archive-mode', () => {
  return { archiveMode: state.archiveMode, periodId: state.archivePeriodId };
});

ipcMain.handle('inspect-backup-samples', async (event, backupPath) => {
  return await _pyCallMain('inspect_backup_samples', [backupPath]);
});

ipcMain.handle('check-sample-code-conflict', async (event, code) => {
  return await _pyCallMain('check_sample_code_conflict', [code]);
});

ipcMain.handle('merge-sample-from-backup', async (event, { backupPath, backupSampleId, overwriteSampleId }) => {
  if (state.archiveMode) {
    return { ok: false, error: 'Δεν επιτρέπεται συγχώνευση ενώ βρίσκεστε σε λειτουργία αρχείου — επιστρέψτε πρώτα στην τρέχουσα περίοδο' };
  }
  // Ασφάλεια: πλήρες backup της ζωντανής βάσης πριν από οποιαδήποτε
  // εγγραφή — ώστε μια αντικατάσταση "ξεχασμένων" αλλαγών να είναι
  // αναστρέψιμη αν αποδειχτεί λάθος κίνηση.
  const safety = await performBackup(false);
  if (!safety?.success) {
    return { ok: false, error: 'Δεν ήταν δυνατή η λήψη backup ασφαλείας πριν την επαναφορά: ' + (safety?.error || '') };
  }
  return await _pyCallMain('merge_sample_from_backup',
    [backupPath, backupSampleId, overwriteSampleId ?? null], 30000);
});

ipcMain.handle('switch-to-backup-file', async (event, backupPath) => {
  if (!fs.existsSync(backupPath)) return { ok: false, error: 'Το αρχείο backup δεν βρέθηκε' };
  // Ασφάλεια: αντίγραφο ΤΟΥ ΙΔΙΟΥ backup πριν επιτραπεί επεξεργασία πάνω
  // του — μια διόρθωση εδώ γράφεται απευθείας στο αρχείο, χωρίς undo.
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(backupPath, backupPath + '.before-edit-' + stamp);
  } catch(e) {
    return { ok: false, error: 'Δεν ήταν δυνατή η λήψη αντιγράφου ασφαλείας του backup: ' + e.message };
  }
  const switched = await _pyCallMain('switch_db', [backupPath]);
  if (!switched?.ok) return switched;
  state.archiveMode       = true;
  state.archivePeriodId   = null;
  state.archiveDataFolder = backupPath;
  const cfgA = loadConfig();
  saveConfig({ ...cfgA, archiveDataFolder: backupPath });
  return { ok: true, dbPath: backupPath };
});
