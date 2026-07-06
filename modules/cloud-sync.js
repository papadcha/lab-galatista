// Cloud Sync μέσω rclone: σύνδεση remote, sync backup+pdf (split, με
// separate error handling ανά τύπο), sync βιβλιοθήκης εγγράφων, χειροκίνητο
// terminal για rclone config. Domain-συνδεδεμένο με retention.js (η
// αυτόματη διατήρηση backup τρέχει ΜΕΤΑ από επιτυχές startup sync) —
// κυκλική εξάρτηση μεταξύ των δύο modules, ασφαλής επειδή η χρήση γίνεται
// μόνο μέσα σε συναρτήσεις (function declarations, hoisted), ποτέ στο
// top-level evaluation.
import { ipcMain, shell } from 'electron';
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import { state } from './state.js';
import { loadConfig, saveConfig, getDataFolder } from './config.js';
import { _pyCallMain } from './python-bridge.js';
import { _maybeRunAutoRetention } from './retention.js';

export function getRclonePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'rclone', 'rclone.exe');
  }
  return process.platform === 'win32' ? 'rclone' : 'rclone';
}

// Αποκλειστικό rclone config για την εφαρμογή (δεν μοιράζεται με system rclone)
export function getRcloneConfigPath() {
  return path.join(app.getPath('userData'), 'rclone.conf');
}

export function runRclone(args, timeoutMs = 30000) {
  const configPath = getRcloneConfigPath();
  const fullArgs = ['--config', configPath, ...args];
  return new Promise((resolve) => {
    execFile(getRclonePath(), fullArgs, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: stderr?.trim() || err.message });
      } else {
        resolve({ ok: true, stdout: stdout?.trim(), stderr: stderr?.trim() });
      }
    });
  });
}

export function isNetworkError(error) {
  return /network|connect|timeout|unreachable|no route/i.test(error || '');
}

ipcMain.handle('cloud-check-rclone', async () => {
  const result = await runRclone(['version'], 5000);
  if (!result.ok) return { installed: false };
  // Εξαγωγή version από plain text output (πχ "rclone v1.74.2")
  const match = result.stdout.match(/rclone\s+v([\d.]+)/i);
  return { installed: true, version: match ? match[1] : '' };
});

ipcMain.handle('cloud-list-remotes', async () => {
  const result = await runRclone(['listremotes'], 5000);
  if (!result.ok) return { list: [] };
  const list = result.stdout.split('\n').map(r => r.trim()).filter(Boolean);
  return { list };
});

ipcMain.handle('cloud-get-config', async () => {
  const cfg = loadConfig();
  return {
    remotePath:     cfg.cloudRemotePath || null,
    lastSync:       cfg.cloudLastSync   || null,
    lastSyncStatus: cfg.cloudLastSyncStatus || null,
  };
});

ipcMain.handle('cloud-save-config', async (event, remotePath) => {
  const cfg = { ...loadConfig(), cloudRemotePath: remotePath };
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle('cloud-test', async (event, remotePath) => {
  // Ελέγχουμε σύνδεση στο root remote (όχι στον συγκεκριμένο φάκελο που μπορεί να μην υπάρχει)
  const root = remotePath.includes(':') ? remotePath.split(':')[0] + ':' : remotePath;
  const result = await runRclone(['lsd', root, '--max-depth', '1'], 10000);
  if (result.ok) return { ok: true };
  if (isNetworkError(result.error)) return { ok: false, error: 'Δεν υπάρχει σύνδεση internet', noInternet: true };
  return { ok: false, error: result.error };
});

ipcMain.handle('cloud-sync', async () => {
  const cfg        = loadConfig();
  const remotePath = cfg.cloudRemotePath;
  const dataFolder = getDataFolder();

  if (!remotePath) return { ok: false, error: 'Δεν έχει οριστεί remote path' };
  if (!dataFolder) return { ok: false, error: 'Δεν έχει οριστεί φάκελος δεδομένων' };

  const result = await runSplitCloudSync(dataFolder, remotePath);
  const now = new Date().toLocaleString('el-GR');
  if (result.ok) {
    saveConfig({ ...loadConfig(), cloudLastSync: now, cloudLastSyncStatus: 'ok' });
    return { ok: true };
  }
  if (isNetworkError(result.error)) {
    return { ok: false, noInternet: true, error: result.error };
  }
  saveConfig({ ...loadConfig(), cloudLastSync: now, cloudLastSyncStatus: 'fail' });
  return { ok: false, error: result.error };
});

ipcMain.handle('cloud-restore', async () => {
  const cfg        = loadConfig();
  const remotePath = cfg.cloudRemotePath;
  const dataFolder = getDataFolder();

  if (!remotePath) return { ok: false, error: 'Δεν έχει οριστεί remote path' };
  if (!dataFolder) return { ok: false, error: 'Δεν έχει οριστεί φάκελος δεδομένων' };

  // copy (όχι sync): το UI υπόσχεται "κατέβασμα" αρχείων, όχι mirror — sync θα
  // έσβηνε τοπικά αρχεία (π.χ. backups που δεν έχουν προλάβει να ανέβουν ακόμα).
  const result = await runRclone(
    ['copy', remotePath, dataFolder, '--checksum', '--create-empty-src-dirs'],
    120000
  );

  if (result.ok) return { ok: true };
  if (isNetworkError(result.error)) return { ok: false, noInternet: true, error: result.error };
  return { ok: false, error: result.error };
});

// IPC: Sync Βιβλιοθήκης Εγγράφων — μόνο προσθήκες.
// Τα αρχεία ήδη ζουν σε κοινό cloud σημείο (upload-document τα ανεβάζει
// απευθείας εκεί)· αυτό που λείπει είναι οι καταχωρήσεις (τίτλος, κωδικός,
// έκδοση) που ζουν μόνο στην τοπική βάση της κάθε εγκατάστασης. Κάθε
// μηχάνημα εξάγει τις δικές του σε ένα manifest, τα manifests ανταλλάσσονται
// μέσω cloud, και ό,τι λείπει τοπικά (βάσει cloud_path) μπαίνει αυτόματα.
ipcMain.handle('sync-document-library', async () => {
  const cfg        = loadConfig();
  const remotePath = cfg.cloudRemotePath;
  if (!remotePath) return { ok: false, error: 'Δεν έχει οριστεί remote path' };

  try {
    const manifestDir = path.join(os.tmpdir(), 'lab-galatista-doclib');
    fs.mkdirSync(manifestDir, { recursive: true });
    const myName           = (os.hostname() || 'machine').replace(/[^A-Za-z0-9_-]/g, '_');
    const myManifestPath    = path.join(manifestDir, `${myName}.json`);
    const remoteManifestsDir = `${remotePath}/documents/_manifests`;

    // 1. Εξαγωγή τοπικών εγγράφων → JSON
    const localItems = await _pyCallMain('export_document_library', []);
    fs.writeFileSync(myManifestPath, JSON.stringify(localItems ?? [], null, 2), 'utf-8');

    // 2. Upload του δικού μας manifest (πάντα αντικαθιστά το προηγούμενό μας)
    const up = await runRclone(['copy', myManifestPath, remoteManifestsDir], 60000);
    if (isNetworkError(up.error)) return { ok: false, noInternet: true, error: up.error };
    if (!up.ok) return { ok: false, error: up.error };

    // 3. Κατέβασμα όλων των manifests (δικό μας + άλλων εγκαταστάσεων)
    const dl = await runRclone(['copy', remoteManifestsDir, manifestDir], 60000);
    if (!dl.ok && !isNetworkError(dl.error)) return { ok: false, error: dl.error };

    // 4. Συγχώνευση όλων των manifest αρχείων
    const allItems = [];
    for (const f of fs.readdirSync(manifestDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const items = JSON.parse(fs.readFileSync(path.join(manifestDir, f), 'utf-8'));
        if (Array.isArray(items)) allItems.push(...items);
      } catch(e) { /* αγνόησε κατεστραμμένο manifest */ }
    }

    // 5. Upsert εγγράφων βάσει cloud_path + updated_at (προσθήκες, ενημερώσεις,
    //    και soft-delete tombstones από άλλες εγκαταστάσεις)
    const result = await _pyCallMain('import_document_library', [allItems]);
    if (!result?.ok) return { ok: false, error: result?.error || 'Άγνωστο σφάλμα' };
    return { ok: true, added: result.added, updated: result.updated, deleted: result.deleted };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('cloud-open-terminal', async () => {
  const configPath = getRcloneConfigPath();
  const rcloneBin  = getRclonePath();

  function trySpawn(cmd, args) {
    return new Promise((resolve) => {
      try {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.on('error', () => resolve(false));
        child.unref();
        setTimeout(() => resolve(true), 200);
      } catch {
        resolve(false);
      }
    });
  }

  // Windows: spawn a NEW console window via `start cmd.exe /k ...`
  // Plain spawn('cmd.exe', ['/k', ...]) from a GUI process has no visible window.
  // Use windowsVerbatimArguments to avoid Node.js escaping the embedded quotes in the path.
  if (process.platform === 'win32') {
    const innerCmd = `"${rcloneBin}" --config "${configPath}" config`;
    // cmd.exe /k strips the first and last " from its argument, so wrap the
    // entire command in an extra pair of quotes to survive that stripping.
    const ok = await new Promise((resolve) => {
      try {
        const child = spawn('cmd.exe', ['/c', `start cmd.exe /k "${innerCmd}"`], {
          detached: true, stdio: 'ignore', windowsVerbatimArguments: true,
        });
        child.on('error', () => resolve(false));
        child.unref();
        setTimeout(() => resolve(true), 200);
      } catch { resolve(false); }
    });
    if (ok) return { ok: true, configPath };
  }

  const attempts = [
    ['kitty',          [rcloneBin, '--config', configPath, 'config']],
    ['alacritty',      ['-e', rcloneBin, '--config', configPath, 'config']],
    ['konsole',        ['-e', rcloneBin, '--config', configPath, 'config']],
    ['gnome-terminal', ['--', rcloneBin, '--config', configPath, 'config']],
    ['xterm',          ['-e', `${rcloneBin} --config "${configPath}" config`]],
  ];

  for (const [cmd, args] of attempts) {
    const ok = await trySpawn(cmd, args);
    if (ok) return { ok: true, configPath };
  }
  return { ok: false, error: `Εκτελέστε χειροκίνητα: rclone --config "${configPath}" config`, configPath };
});

export async function runSplitCloudSync(dataFolder, remotePath) {
  const backupLocal  = path.join(dataFolder, 'backup');
  const backupRemote = remotePath + '/backup';
  // copy (όχι sync): πολλές εγκαταστάσεις (διαχειριστής/χειριστής) μοιράζονται
  // το ίδιο cloud remote — sync θα έσβηνε τα backups που ανέβασε η άλλη πλευρά
  // και δεν υπάρχουν στον τοπικό φάκελο backup αυτής εδώ της εγκατάστασης.
  const r1 = await runRclone(
    ['copy', backupLocal, backupRemote, '--checksum', '--create-empty-src-dirs'],
    120000
  );
  if (!r1.ok && !isNetworkError(r1.error)) {
    return { ok: false, error: '[backup] ' + r1.error };
  }

  const pdfLocal  = path.join(dataFolder, 'pdf');
  const pdfRemote = remotePath + '/pdf';
  let r2 = null;
  if (fs.existsSync(pdfLocal)) {
    r2 = await runRclone(
      ['copy', pdfLocal, pdfRemote,
       '--checksum', '--create-empty-src-dirs'],
      180000
    );
    if (!r2.ok && !isNetworkError(r2.error)) {
      return { ok: false, error: '[pdf] ' + r2.error };
    }
  }

  if (isNetworkError(r1.error) || isNetworkError(r2?.error)) {
    return { ok: false, noInternet: true, error: 'Δεν υπάρχει σύνδεση' };
  }
  return { ok: true };
}

export async function performStartupCloudSync(remotePath) {
  const dataFolder = getDataFolder();
  if (!dataFolder) return;
  console.log('[Cloud] Startup sync...', remotePath);
  const result = await runSplitCloudSync(dataFolder, remotePath);
  const now = new Date().toLocaleString('el-GR');
  if (result.ok) {
    saveConfig({ ...loadConfig(), cloudLastSync: now, cloudLastSyncStatus: 'ok' });
    console.log('[Cloud] Startup sync ✓');
    _maybeRunAutoRetention(remotePath).catch(e =>
      console.warn('[Retention] Σφάλμα:', e.message)
    );
  } else if (result.noInternet) {
    console.log('[Cloud] Startup sync — χωρίς σύνδεση, παράλειψη');
  } else {
    saveConfig({ ...loadConfig(), cloudLastSync: now, cloudLastSyncStatus: 'fail' });
    console.error('[Cloud] Startup sync σφάλμα:', result.error);
    _notifyCloudSyncFailure(result.error);
  }
}

// Το background startup sync αποτυγχάνει σιωπηλά χωρίς αυτό — ο χειριστής
// θα το έβλεπε μόνο αν άνοιγε ο ίδιος τις Ρυθμίσεις (cloudLastSyncStatus
// εκεί), χωρίς καμία ενεργή προειδοποίηση. Ίδιο pattern με το
// ce-expiry-notification/data-folder-mismatch (main-app.js).
function _notifyCloudSyncFailure(error) {
  const cfg = loadConfig();
  const snoozedUntil = cfg.cloudSyncNotifySnoozedUntil;
  if (snoozedUntil && new Date(snoozedUntil) > new Date()) return;
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('cloud-sync-failed', { error });
  }
}

ipcMain.handle('cloud-sync-notify-snooze', async (event, days = 7) => {
  const until = new Date();
  until.setDate(until.getDate() + (days || 7));
  saveConfig({ ...loadConfig(), cloudSyncNotifySnoozedUntil: until.toISOString() });
  return { ok: true };
});

ipcMain.handle('open-external-link', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
