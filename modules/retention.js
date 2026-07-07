// Remote backup retention: ο διαχειριστής και ο χειριστής μοιράζονται το
// ίδιο cloud remote — ο αυτόματος καθαρισμός παλαιών backups στο remote
// είναι επικίνδυνος αν ενεργοποιηθεί ταυτόχρονα σε δύο εγκαταστάσεις με
// διαφορετικό αριθμό ημερών (η πιο αυστηρή θα "έτρωγε" τα backups που η
// άλλη θεωρεί ακόμα έγκυρα). Λύση: ένα lock file πάνω στο ίδιο το remote
// δηλώνει ποια εγκατάσταση έχει το δικαίωμα να τρέχει αυτόματο καθαρισμό·
// μόνο αυτή περνάει τον έλεγχο.
//
// Κυκλική εξάρτηση με cloud-sync.js (βλ. σχόλιο εκεί) — ασφαλής επειδή η
// _maybeRunAutoRetention καλείται μόνο μέσα σε συνάρτηση, ποτέ στο
// top-level evaluation.
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig, saveConfig } from './config.js';
import { runRclone } from './cloud-sync.js';

function _myHostname() {
  return (os.hostname() || 'machine').replace(/[^A-Za-z0-9_-]/g, '_');
}

function _retentionLockRemotePath(remotePath) {
  return `${remotePath}/.retention-lock.json`;
}

async function _readRetentionLock(remotePath) {
  const result = await runRclone(['cat', _retentionLockRemotePath(remotePath)], 15000);
  if (!result.ok || !result.stdout) return null;
  try { return JSON.parse(result.stdout); } catch(e) { return null; }
}

async function _writeRetentionLock(remotePath) {
  const tmpDir  = path.join(os.tmpdir(), 'lab-galatista-retention');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, '.retention-lock.json');
  const payload = { hostname: _myHostname(), enabledAt: new Date().toISOString() };
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf-8');
  const up = await runRclone(['copyto', tmpFile, _retentionLockRemotePath(remotePath)], 30000);
  return up.ok ? payload : null;
}

async function _deleteRetentionLock(remotePath) {
  return runRclone(['deletefile', _retentionLockRemotePath(remotePath)], 30000);
}

// Τρέχει το αυτόματο καθάρισμα μόνο αν αυτή η εγκατάσταση κατέχει
// πραγματικά το lock ΤΗ ΣΤΙΓΜΗ ΑΥΤΗ (επανέλεγχος σε κάθε sync — δεν
// εμπιστευόμαστε μόνο την τοπική σημαία cloudRetentionAutoEnabled).
export async function _maybeRunAutoRetention(remotePath) {
  const cfg = loadConfig();
  if (!cfg.cloudRetentionAutoEnabled) return;
  const lock = await _readRetentionLock(remotePath);
  if (!lock || lock.hostname !== _myHostname()) return; // το lock χάθηκε/άλλαξε ιδιοκτήτη
  const days = cfg.cloudRetentionDays || 90;
  const result = await runRclone([
    'delete', `${remotePath}/backup`,
    '--min-age', `${days}d`, '--exclude', '*_FINAL.db',
  ], 120000);
  if (result.ok) console.log('[Retention] Καθαρισμός remote backups ολοκληρώθηκε');
  else console.warn('[Retention] Σφάλμα καθαρισμού:', result.error);
}

ipcMain.handle('retention-get-status', async () => {
  const cfg = loadConfig();
  const remotePath = cfg.cloudRemotePath;
  if (!remotePath) return { ok: false, error: 'Δεν έχει οριστεί remote path' };
  const lock = await _readRetentionLock(remotePath);
  return {
    ok: true,
    days: cfg.cloudRetentionDays || 90,
    autoEnabled: !!cfg.cloudRetentionAutoEnabled,
    lock,
    isMine: !!(lock && lock.hostname === _myHostname()),
  };
});

ipcMain.handle('retention-set-days', async (event, days) => {
  const n = parseInt(days, 10) || 90;
  saveConfig({ ...loadConfig(), cloudRetentionDays: n });
  return { ok: true, days: n };
});

ipcMain.handle('retention-enable-auto', async () => {
  const cfg = loadConfig();
  const remotePath = cfg.cloudRemotePath;
  if (!remotePath) return { ok: false, error: 'Δεν έχει οριστεί remote path' };
  const existing = await _readRetentionLock(remotePath);
  if (existing && existing.hostname !== _myHostname()) {
    return { ok: false, error: 'owned_by_other', lock: existing };
  }
  const written = await _writeRetentionLock(remotePath);
  if (!written) return { ok: false, error: 'Αποτυχία εγγραφής lock file' };
  saveConfig({ ...loadConfig(), cloudRetentionAutoEnabled: true });
  return { ok: true, lock: written };
});

ipcMain.handle('retention-disable-auto', async () => {
  const cfg = loadConfig();
  const remotePath = cfg.cloudRemotePath;
  saveConfig({ ...loadConfig(), cloudRetentionAutoEnabled: false });
  if (remotePath) {
    const existing = await _readRetentionLock(remotePath);
    if (existing && existing.hostname === _myHostname()) {
      await _deleteRetentionLock(remotePath);
    }
  }
  return { ok: true };
});

// Εξαναγκασμένη απελευθέρωση — για όταν η εγκατάσταση που κατείχε το
// lock δεν υπάρχει πια (π.χ. αντικαταστάθηκε το μηχάνημα).
ipcMain.handle('retention-force-release', async () => {
  const cfg = loadConfig();
  const remotePath = cfg.cloudRemotePath;
  if (!remotePath) return { ok: false, error: 'Δεν έχει οριστεί remote path' };
  await _deleteRetentionLock(remotePath);
  return { ok: true };
});

ipcMain.handle('retention-preview', async () => {
  const cfg = loadConfig();
  const remotePath = cfg.cloudRemotePath;
  if (!remotePath) return { ok: false, error: 'Δεν έχει οριστεί remote path' };
  const days = cfg.cloudRetentionDays || 90;
  const result = await runRclone([
    'lsf', `${remotePath}/backup`, '-R', '--files-only',
    '--min-age', `${days}d`, '--exclude', '*_FINAL.db',
  ], 60000);
  if (!result.ok) return { ok: false, error: result.error };
  const files = result.stdout ? result.stdout.split('\n').filter(Boolean) : [];
  return { ok: true, files, days };
});

ipcMain.handle('retention-run-cleanup', async () => {
  const cfg = loadConfig();
  const remotePath = cfg.cloudRemotePath;
  if (!remotePath) return { ok: false, error: 'Δεν έχει οριστεί remote path' };
  const days = cfg.cloudRetentionDays || 90;
  const result = await runRclone([
    'delete', `${remotePath}/backup`,
    '--min-age', `${days}d`, '--exclude', '*_FINAL.db',
  ], 120000);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
});
