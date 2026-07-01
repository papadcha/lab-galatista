/**
 * main.js
 * Εργαστήριο Λατομείων Γαλάτιστας
 * ─────────────────────────────────────────────────────────────
 * Έκδοση : 0.99.4
 * Ημ/νία  : 2026-06-02
 * ─────────────────────────────────────────────────────────────
 * Ιστορικό:
 *   0.99.4 — getPdfPath με υποπερίοδο subfolder
 *             save-statistics IPC handler
 *   0.99.3 — Clean Start, backup naming
 *   0.99.2 — CE expiry + split cloud sync
 *   0.99.0 — Προσθήκη επικεφαλίδας έκδοσης
 * ─────────────────────────────────────────────────────────────
 * Ιστορικό:
 *   0.99.2 — CE expiry notification + split cloud sync
 *             ce-notify-snooze/clear, ce-get-suggested-folder
 *   0.99.0 — Προσθήκη επικεφαλίδας έκδοσης
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path       = require('path');
const fs         = require('fs');
const { spawn }  = require('child_process');
const os         = require('os');
const nodemailer = require('nodemailer');
let _puppeteer = null;
async function getPuppeteer() {
  if (!_puppeteer) _puppeteer = (await import('puppeteer')).default;
  return _puppeteer;
}

let mainWindow;
let guideWindow = null;
let pyProcess   = null;
let _pyReqId    = 0;
const _pyPending = new Map();  // id → resolve
let _pythonReady = false;

// ============================================================
// ΔΗΜΙΟΥΡΓΙΑ ΠΑΡΑΘΥΡΟΥ
// ============================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  1024,
    minHeight: 640,
    title: 'Εργαστήριο Λατομείων Γαλάτιστας',
    webPreferences: {
      nodeIntegration:     false,
      contextIsolation:    true,
      preload:             path.join(__dirname, 'preload.js'),
      webSecurity:         false,  // Επιτρέπει φόρτωση τοπικών αρχείων
    },
    // Εμφάνιση παραθύρου μόνο όταν είναι έτοιμο
    show: false,
  });

  // Φόρτωση κύριας σελίδας
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Εμφάνιση όταν είναι έτοιμο (αποφυγή λευκής οθόνης)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Ανάπτυξη: άνοιγμα DevTools (αφαίρεσε αν δεν χρειάζεται)
  // mainWindow.webContents.openDevTools();


}

// ============================================================
// ΕΚΚΙΝΗΣΗ PYTHON BACKEND
// ============================================================

function startPythonBackend() {
  let cmd, args, cwd;

  if (app.isPackaged) {
    // Production: χρησιμοποιεί bundled PyInstaller exe
    const backendDir = path.join(process.resourcesPath, 'lab-backend');
    cmd  = path.join(backendDir, 'lab-backend.exe');
    args = [];
    cwd  = backendDir;
  } else {
    // Development: χρησιμοποιεί system Python
    const scriptPath = path.join(__dirname, 'backend', 'server.py');
    cmd  = process.platform === 'win32' ? 'python' : 'python3';
    args = ['-u', scriptPath];
    cwd  = __dirname;
  }

  // Η βάση αποθηκεύεται στο userData (εγγράψιμο και για non-admin users)
  const labDbPath = path.join(app.getPath('userData'), 'laboratory.db');
  pyProcess = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', LAB_DB_PATH: labDbPath },
  });

  // Κεντρικός stdout listener — routing με ID
  let _pyBuf = '';
  pyProcess.stdout.on('data', (data) => {
    _pyBuf += data.toString();
    const lines = _pyBuf.split('\n');
    _pyBuf = lines.pop();  // κρατάμε το ημιτελές
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('{')) {
        console.log(`[Python] ${t}`);
        // Ειδοποίηση renderer όταν ο Python είναι έτοιμος
        if (t.includes('Αναμονή εντολών')) {
          _pythonReady = true;
          mainWindow?.webContents.send('python-ready');
        }
        continue;
      }
      try {
        const parsed = JSON.parse(t);
        const id = parsed.id;
        if (id !== undefined && _pyPending.has(id)) {
          const resolve = _pyPending.get(id);
          _pyPending.delete(id);
          // Επιστρέφουμε το result (ή ολόκληρο το parsed αν δεν έχει result)
          resolve(parsed.result !== undefined ? parsed.result : parsed);
        } else {
          console.log(`[Python] ${t}`);
        }
      } catch {
        console.log(`[Python] ${t}`);
      }
    }
  });

  pyProcess.stderr.on('data', (data) => {
    console.error(`[Python Error] ${data.toString().trim()}`);
  });

  pyProcess.on('close', (code) => {
    console.log(`[Python] Έκλεισε με κωδικό: ${code}`);
    // Απορρίπτουμε όλα τα εκκρεμή requests
    for (const [id, resolve] of _pyPending) {
      resolve({ error: 'Python process terminated' });
    }
    _pyPending.clear();
  });

  return pyProcess;
}

// ============================================================
// ΕΚΔΗΛΩΣΕΙΣ APP
// ============================================================

app.whenReady().then(() => {
  createWindow();

  // Εκκίνηση Python backend
  try {
    startPythonBackend();
  } catch (e) {
    console.error('Python backend δεν ξεκίνησε:', e.message);
  }

  // Αυτόματο backup + CE check + cloud sync κατά εκκίνηση
  setTimeout(async () => {
    // ── Τοπικό backup ─────────────────────────────────────
    const result = performBackup();
    if (result.success) {
      console.log('[Backup] Αυτόματο backup:', result.path);
    } else if (result.reason !== 'no_folder') {
      console.error('[Backup] Σφάλμα:', result.error);
    }

    // ── CE Expiry check ────────────────────────────────────
    await checkCeExpiryAndNotify();
    await initActivePeriodStart();

    // ── Έλεγχος νέας έκδοσης ──────────────────────────────
    checkForUpdates().catch(e => console.log('[Update] Σφάλμα:', e.message));

    // ── Cloud sync (backup πάντα, pdf μόνο νέα) ───────────
    const cfg = loadConfig();
    if (cfg.cloudRemotePath) {
      performStartupCloudSync(cfg.cloudRemotePath).catch(e =>
        console.error('[Cloud] Startup sync error:', e.message)
      );
    }
  }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});


// ============================================================
// IPC — Cloud Sync (rclone)
// ============================================================

const { execFile } = require('child_process');

function getRclonePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'rclone', 'rclone.exe');
  }
  return process.platform === 'win32' ? 'rclone' : 'rclone';
}

// Αποκλειστικό rclone config για την εφαρμογή (δεν μοιράζεται με system rclone)
function getRcloneConfigPath() {
  return path.join(app.getPath('userData'), 'rclone.conf');
}

function runRclone(args, timeoutMs = 30000) {
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

function isNetworkError(error) {
  return /network|connect|timeout|unreachable|no route/i.test(error || '');
}

// Renderer queries this on startup to handle the race where Python was ready before DOM loaded
ipcMain.handle('python-is-ready', () => _pythonReady);

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

  const result = await runRclone(
    ['sync', remotePath, dataFolder, '--create-empty-src-dirs'],
    120000
  );

  if (result.ok) return { ok: true };
  if (isNetworkError(result.error)) return { ok: false, noInternet: true, error: result.error };
  return { ok: false, error: result.error };
});

ipcMain.handle('cloud-open-terminal', async () => {
  const configPath = getRcloneConfigPath();
  const rcloneBin  = getRclonePath();
  const configArg  = `--config "${configPath}"`;

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

ipcMain.handle('open-external-link', async (event, url) => {
  const { shell } = require('electron');
  await shell.openExternal(url);
  return { ok: true };
});


// ============================================================
// INIT ACTIVE PERIOD START
// ============================================================

async function initActivePeriodStart() {
  const cfg = loadConfig();
  if (cfg.activePeriodStart) return;

  const id  = 'init-period-' + Date.now();
  const req = JSON.stringify({ method: 'get_active_ce_period', args: [], id }) + '\n';
  const period = await new Promise((resolve) => {
    if (!pyProcess || pyProcess.killed) { resolve(null); return; }
    _pyPending.set(id, resolve);
    try { pyProcess.stdin.write(req); }
    catch(e) { _pyPending.delete(id); resolve(null); return; }
    setTimeout(() => { _pyPending.delete(id); resolve(null); }, 5000);
  });

  const validFrom = period?.active_subperiod?.valid_from || period?.valid_from;
  if (validFrom) {
    saveConfig({ ...loadConfig(), activePeriodStart: validFrom });
  }
}

// ============================================================
// CLEAN START
// ============================================================

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
      _pyPending.set(id, resolve);
      try { pyProcess.stdin.write(req); }
      catch(e) { _pyPending.delete(id); resolve({ ok: false, error: e.message }); }
      setTimeout(() => { _pyPending.delete(id); resolve({ ok: false, error: 'timeout' }); }, 30000);
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
    try { await runSplitCloudSync(dataFolder, cfg.cloudRemotePath); }
    catch(e) { console.warn('[CleanStart] Cloud sync warning:', e.message); }
  }

  // 3. Clean start μέσω Python — διαγραφή δειγμάτων, CE deactivation, επιλογές
  const cleanResult = await new Promise((resolve) => {
    const id  = 'clean-' + Date.now();
    const req = JSON.stringify({
      method: 'clean_start',
      args:   [finalPath, keepTechnicians, keepProducts],
      id
    }) + '\n';
    _pyPending.set(id, resolve);
    try { pyProcess.stdin.write(req); }
    catch(e) { _pyPending.delete(id); resolve({ ok: false, error: e.message }); }
    setTimeout(() => { _pyPending.delete(id); resolve({ ok: false, error: 'timeout' }); }, 30000);
  });

  if (!cleanResult?.ok) return cleanResult;

  // 4. Διαγραφή daily backups — κρατάμε μόνο το FINAL
  _pruneBackups(backupDir, 0);

  // 5. Reset config — κρατάμε μόνο το cloud remote (το dataFolder/activePeriodStart
  //    θα οριστούν ξανά μέσω wizard στην επόμενη εκκίνηση)
  saveConfig({
    cloudRemotePath: cfg.cloudRemotePath || null
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

// ============================================================
// ARCHIVE MODE
// ============================================================

let _archiveMode      = false;
let _archivePeriodId  = null;
let _archiveDataFolder = null;

async function _pyCallMain(method, args = [], timeoutMs = 15000) {
  return new Promise((resolve) => {
    const id  = method + '-' + Date.now();
    const req = JSON.stringify({ method, args, id }) + '\n';
    _pyPending.set(id, resolve);
    try { pyProcess.stdin.write(req); }
    catch(e) { _pyPending.delete(id); resolve({ ok: false, error: e.message }); }
    setTimeout(() => { _pyPending.delete(id); resolve({ ok: false, error: 'timeout' }); }, timeoutMs);
  });
}

ipcMain.handle('find-archive-db', async (event, dataFolder) => {
  return await _pyCallMain('find_archive_db', [dataFolder]);
});

ipcMain.handle('switch-to-archive', async (event, { dataFolder, periodId }) => {
  const found = await _pyCallMain('find_archive_db', [dataFolder]);
  if (!found?.ok) return found;
  const switched = await _pyCallMain('switch_db', [found.path]);
  if (!switched?.ok) return switched;
  _archiveMode       = true;
  _archivePeriodId   = periodId;
  _archiveDataFolder = dataFolder;
  // Αποθήκευση στο config για robustness (επιβιώνει αν χαθεί η μνήμη)
  const cfgA = loadConfig();
  saveConfig({ ...cfgA, archiveDataFolder: dataFolder });
  return { ok: true, dbPath: found.path };
});

ipcMain.handle('restore-from-archive', async () => {
  const result = await _pyCallMain('restore_db', []);
  if (!result?.ok) return result;
  _archiveMode       = false;
  _archivePeriodId   = null;
  _archiveDataFolder = null;
  // Καθαρισμός από config
  const cfgR = loadConfig();
  delete cfgR.archiveDataFolder;
  saveConfig(cfgR);
  return { ok: true };
});

ipcMain.handle('is-archive-mode', () => {
  return { archiveMode: _archiveMode, periodId: _archivePeriodId };
});

// ============================================================
// DOCUMENT LIBRARY — upload / open / delete
// ============================================================

ipcMain.handle('upload-document', async (event, { sectionName }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      'Επιλογή εγγράφου',
    properties: ['openFile'],
    filters: [
      { name: 'Έγγραφα', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg'] },
      { name: 'Όλα τα αρχεία', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

  const localPath    = result.filePaths[0];
  const filename     = path.basename(localPath);
  const safeSection  = (sectionName || 'Άλλα').replace(/[/\:*?"<>|]/g, '-');
  const cloudRelPath = `documents/${safeSection}/${filename}`;
  const cfg          = loadConfig();
  if (!cfg.cloudRemotePath) return { ok: false, error: 'Δεν έχει οριστεί cloud remote' };

  const destRemote = `${cfg.cloudRemotePath}/documents/${safeSection}`;
  const upload = await runRclone(['copy', localPath, destRemote], 120000);
  if (!upload.ok) return { ok: false, error: upload.error };

  return { ok: true, cloud_path: cloudRelPath, filename };
});

ipcMain.handle('open-document', async (event, cloudPath) => {
  const cfg = loadConfig();
  if (!cfg.cloudRemotePath) return { ok: false, error: 'Δεν έχει οριστεί cloud remote' };

  const { app: electronApp, shell } = require('electron');
  const cacheDir  = path.join(electronApp.getPath('userData'), 'documents_cache',
                               path.dirname(cloudPath));
  fs.mkdirSync(cacheDir, { recursive: true });

  const srcRemote = `${cfg.cloudRemotePath}/${cloudPath}`;
  const dl = await runRclone(['copy', srcRemote, cacheDir], 60000);
  if (!dl.ok) return { ok: false, error: dl.error };

  const localFile = path.join(cacheDir, path.basename(cloudPath));
  const openResult = await shell.openPath(localFile);
  if (openResult) return { ok: false, error: openResult };
  return { ok: true };
});

ipcMain.handle('delete-document-cloud', async (event, cloudPath) => {
  const cfg = loadConfig();
  if (!cfg.cloudRemotePath || !cloudPath) return { ok: true }; // nothing to delete
  const fullPath = `${cfg.cloudRemotePath}/${cloudPath}`;
  await runRclone(['delete', fullPath], 30000);
  return { ok: true };
});

// Archive mode quit — handled in createWindow via win.on('close')

ipcMain.handle('generate-pdf-library', async (event, dataFolder) => {
  return await _pyCallMain('generate_pdf_library', [dataFolder], 300000); // 5min timeout
});

ipcMain.handle('force-quit', async () => {
  await _pyCallMain('restore_db', []);
  _archiveMode = false;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  return { ok: true };
});

// ============================================================
// UPDATE CHECK
// ============================================================

async function checkForUpdates() {
  const { net } = require('electron');
  const currentVersion = app.getVersion();

  const request = net.request({
    method: 'GET',
    url: 'https://api.github.com/repos/papadcha/lab-galatista/releases/latest',
    headers: { 'User-Agent': 'lab-galatista-updater' },
  });

  const body = await new Promise((resolve, reject) => {
    let data = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { data += chunk.toString(); });
      response.on('end', () => resolve(data));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });

  const release = JSON.parse(body);
  const latestTag = release.tag_name?.replace(/^v/, '');
  if (!latestTag) return;

  // Σύγκριση semantic version
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i]||0) > (pb[i]||0)) return 1;
      if ((pa[i]||0) < (pb[i]||0)) return -1;
    }
    return 0;
  };

  if (cmp(latestTag, currentVersion) > 0) {
    const downloadUrl = release.assets?.find(a => a.name.endsWith('.exe'))?.browser_download_url
                     || release.html_url;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', {
        current: currentVersion,
        latest:  latestTag,
        url:     downloadUrl,
        notes:   release.body || '',
      });
    }
  }
}

ipcMain.handle('open-update-url', async (event, url) => {
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('get-app-version', () => app.getVersion());

// ============================================================
// CE EXPIRY NOTIFICATION
// ============================================================

async function checkCeExpiryAndNotify() {
  try {
    // Διαβάζει απευθείας από τη DB χωρίς Python IPC (main process)
    const { execFileSync } = require('child_process');
    const dbPath = getDbPath();
    if (!dbPath) return;

    // Χρησιμοποιεί το Python backend μέσω pyBridge για να πάρει το status
    // Στέλνει request στο Python process που ήδη τρέχει
    const status = await new Promise((resolve) => {
      if (!pyProcess || pyProcess.killed) { resolve(null); return; }
      const id = 'ce-check-' + Date.now();
      const reqLine = JSON.stringify({ method: 'get_ce_expiry_status', args: [], id }) + '\n';
      // Σύντομη καθυστέρηση για να είναι σίγουρα έτοιμο το Python
      setTimeout(() => {
        if (!pyProcess || pyProcess.killed) { resolve(null); return; }
        _pyPending.set(id, resolve);
        try { pyProcess.stdin.write(reqLine); }
        catch (e) { _pyPending.delete(id); resolve(null); }
        setTimeout(() => { _pyPending.delete(id); resolve(null); }, 8000);
      }, 1500);
    });

    if (!status || status.status === 'ok') return;

    const cfg = loadConfig();
    const snoozedUntil = cfg.ceNotifySnoozedUntil;
    if (snoozedUntil && new Date(snoozedUntil) > new Date()) return;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ce-expiry-notification', status);
    }
  } catch (e) {
    console.error('[CE] Expiry check error:', e.message);
  }
}

ipcMain.handle('ce-notify-snooze', async (event, days = 7) => {
  const until = new Date();
  until.setDate(until.getDate() + (days || 7));
  saveConfig({ ...loadConfig(), ceNotifySnoozedUntil: until.toISOString() });
  return { ok: true };
});

ipcMain.handle('ce-notify-clear-snooze', async () => {
  const cfg = loadConfig();
  delete cfg.ceNotifySnoozedUntil;
  saveConfig(cfg);
  return { ok: true };
});

// ============================================================
// SPLIT CLOUD SYNC
// ============================================================

async function runSplitCloudSync(dataFolder, remotePath) {
  const backupLocal  = path.join(dataFolder, 'backup');
  const backupRemote = remotePath + '/backup';
  const r1 = await runRclone(
    ['sync', backupLocal, backupRemote, '--create-empty-src-dirs'],
    120000
  );
  if (!r1.ok && !isNetworkError(r1.error)) {
    return { ok: false, error: '[backup] ' + r1.error };
  }

  const pdfLocal  = path.join(dataFolder, 'pdf');
  const pdfRemote = remotePath + '/pdf';
  if (fs.existsSync(pdfLocal)) {
    const r2 = await runRclone(
      ['copy', pdfLocal, pdfRemote,
       '--checksum', '--create-empty-src-dirs'],
      180000
    );
    if (!r2.ok && !isNetworkError(r2.error)) {
      return { ok: false, error: '[pdf] ' + r2.error };
    }
  }

  if (isNetworkError(r1.error)) {
    return { ok: false, noInternet: true, error: 'Δεν υπάρχει σύνδεση' };
  }
  return { ok: true };
}

async function performStartupCloudSync(remotePath) {
  const dataFolder = getDataFolder();
  if (!dataFolder) return;
  console.log('[Cloud] Startup sync...', remotePath);
  const result = await runSplitCloudSync(dataFolder, remotePath);
  const now = new Date().toLocaleString('el-GR');
  if (result.ok) {
    saveConfig({ ...loadConfig(), cloudLastSync: now, cloudLastSyncStatus: 'ok' });
    console.log('[Cloud] Startup sync ✓');
  } else if (result.noInternet) {
    console.log('[Cloud] Startup sync — χωρίς σύνδεση, παράλειψη');
  } else {
    saveConfig({ ...loadConfig(), cloudLastSync: now, cloudLastSyncStatus: 'fail' });
    console.error('[Cloud] Startup sync σφάλμα:', result.error);
  }
}

// ============================================================
// CE PERIOD IPC HANDLERS
// ============================================================

ipcMain.handle('ce-get-suggested-folder', async (event, ceNumber, validFrom, validTo) => {
  try {
    const docs   = app.getPath('documents');
    const yFrom  = (validFrom || '').substring(0, 4) || '????';
    const yTo    = (validTo   || '').substring(0, 4) || '????';
    const safeCe = (ceNumber  || 'CE').replace(/[/\\?%*:|"<>]/g, '-');
    const folder = path.join(docs, 'LabData', `CE_${safeCe}_${yFrom}-${yTo}`);
    return { ok: true, folder };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('ce-select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      'Επιλογή Φακέλου Νέας CE Περιόδου',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return { success: false, canceled: true };
  const folder = result.filePaths[0];
  fs.mkdirSync(path.join(folder, 'pdf'),    { recursive: true });
  fs.mkdirSync(path.join(folder, 'backup'), { recursive: true });
  return { success: true, folder };
});

app.on('window-all-closed', () => {
  // Τερματισμός Python
  if (pyProcess) {
    pyProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================================
// IPC — Επικοινωνία Frontend ↔ Backend
// ============================================================

// Helper για κλήση Python από main process
function callPython(method, args = [], timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!pyProcess) { resolve({ error: 'Python δεν τρέχει' }); return; }
    const id      = ++_pyReqId;
    const request = JSON.stringify({ method, args, id }) + '\n';
    _pyPending.set(id, resolve);
    pyProcess.stdin.write(request);
    setTimeout(() => {
      if (_pyPending.has(id)) {
        _pyPending.delete(id);
        resolve({ error: 'Timeout' });
      }
    }, timeoutMs);
  });
}

ipcMain.handle('py-call', async (event, method, ...args) => {
  if (!pyProcess) return { error: 'Python backend δεν τρέχει' };
  return new Promise((resolve) => {
    const id      = ++_pyReqId;
    const request = JSON.stringify({ method, args, id }) + '\n';
    _pyPending.set(id, (result) => resolve(result));
    pyProcess.stdin.write(request);
    setTimeout(() => {
      if (_pyPending.has(id)) {
        _pyPending.delete(id);
        resolve({ error: 'Timeout — το Python δεν απάντησε' });
      }
    }, 10000);
  });
});

// ============================================================
// IPC — Guide Window
// ============================================================

ipcMain.handle('open-guide', async (event, testType) => {
  if (guideWindow && !guideWindow.isDestroyed()) {
    guideWindow.focus();
    return;
  }

  const guideFiles = {
    'se':        'src/pages/tests/guides/se-guide.html',
    'mb':        'src/pages/tests/guides/mb-guide.html',
    'sieve':     'src/pages/tests/guides/kkm-fi-guide.html',
    'flakiness': 'src/pages/tests/guides/kkm-fi-guide.html',
  };

  const guideFile = guideFiles[testType];
  if (!guideFile) return;

  guideWindow = new BrowserWindow({
    width:  900,
    height: 800,
    minWidth: 500,
    minHeight: 500,
    title: 'Οδηγός Διαδικασίας',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  guideWindow.loadFile(path.join(__dirname, guideFile));
  guideWindow.setMenuBarVisibility(false);

  guideWindow.once('ready-to-show', () => {
    guideWindow.show();
  });

  guideWindow.on('closed', () => {
    guideWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('guide-closed', testType);
    }
  });
});

ipcMain.handle('close-guide', async () => {
  if (guideWindow && !guideWindow.isDestroyed()) {
    guideWindow.close();
  }
});

// ============================================================
// IPC — PDF Generation
// ============================================================

ipcMain.handle('generate-report-pdf', async (event, opts = {}) => {
  try {
    const ts  = Date.now();
    const sid = opts.sampleId != null ? opts.sampleId : 'x';
    const output = path.join(os.tmpdir(), `report_${sid}_${ts}.pdf`);

    // Νέα μέθοδος: reportlab Python — σωστό mixed-orientation PDF
    if (opts.sampleId != null) {
      console.log('[generate-report-pdf] Calling Python with sampleId:', opts.sampleId, 'output:', output);
      const result = await callPython('generate_pdf_report', [
        opts.sampleId,
        opts.tests || ['sieve', 'flakiness', 'se', 'mb'],
        output,
      ], 60000);  // 60s timeout για PDF generation
      console.log('[generate-report-pdf] Python result:', JSON.stringify(result));
      if (result?.success) return { success: true, path: result.path };
      console.error('[generate-report-pdf] Python error:', result?.error, result?.traceback);
      return { success: false, error: result?.error || 'PDF generation failed' };
    }

    // Fallback: παλιά Puppeteer μέθοδος (χωρίς sampleId ή αν Python αποτύχει)
    const logoPath = path.join(__dirname, 'src', 'assets', 'logo.png');
    let logoSrc = '';
    try {
      const logoData = fs.readFileSync(logoPath);
      logoSrc = `data:image/png;base64,${logoData.toString('base64')}`;
    } catch {}

    const reportHTML = await mainWindow.webContents.executeJavaScript(`
      (function() {
        const el = document.getElementById('report-print-container');
        return el ? el.outerHTML : null;
      })()`);

    if (!reportHTML) throw new Error('Δεν βρέθηκε report container');

    const mainCss  = path.join(__dirname, 'src', 'styles', 'main.css');
    const printCss = path.join(__dirname, 'src', 'styles', 'reports-print.css');
    function makeHTML(mode) {
      let mc = '', pc = '';
      try { mc = fs.readFileSync(mainCss,  'utf8'); } catch {}
      try { pc = fs.readFileSync(printCss, 'utf8'); } catch {}
      const html = logoSrc
        ? reportHTML.replace(/src="[^"]*logo[^"]*"/gi, `src="${logoSrc}"`)
        : reportHTML;
      return `<!DOCTYPE html><html lang="el"><head><meta charset="UTF-8">
<style>${mc}</style><style>${pc}</style>
<style>body{margin:0;padding:16px;background:white;}
#sidebar,.nav-menu,.report-controls,.report-toolbar,.report-options,
.single-report-actions,.app-toast{display:none!important;}
.print-page--${mode==='portrait'?'landscape':'portrait'}{display:none!important;}
#report-print-container{display:block!important;}</style>
</head><body>${html}</body></html>`;
    }

    async function renderPDF(mode, landscape) {
      const htmlPath = path.join(tmp, `rpt_${mode}_${ts}.html`);
      fs.writeFileSync(htmlPath, makeHTML(mode), 'utf8');
      const puppeteer = await getPuppeteer();
      const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(fs.readFileSync(htmlPath, 'utf8'), { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 1500));
        return await page.pdf({ format: 'A4', landscape,
          printBackground: true,
          margin: { top: '16mm', bottom: '14mm', left: '14mm', right: '14mm' } });
      } finally {
        await browser.close();
        try { fs.unlinkSync(htmlPath); } catch {}
      }
    }

    const portraitData  = await renderPDF('portrait', false);
    const portraitPath  = path.join(tmp, `rpt_portrait_${ts}.pdf`);
    fs.writeFileSync(portraitPath, portraitData);
    const landscapeData = await renderPDF('landscape', true);
    const landscapePath = path.join(tmp, `rpt_landscape_${ts}.pdf`);
    fs.writeFileSync(landscapePath, landscapeData);

    const mergeResult = await callPython('merge_pdfs', [portraitPath, landscapePath, output]);
    if (!mergeResult?.success) throw new Error(mergeResult?.error || 'Merge failed');
    try { fs.unlinkSync(portraitPath); fs.unlinkSync(landscapePath); } catch {}

    return { success: true, path: output };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('print-to-pdf', async (event, options = {}) => {
  try {
    const pdfData = await mainWindow.webContents.printToPDF({
      marginsType:        0,
      pageSize:           options.pageSize || 'A4',
      printBackground:    true,
      landscape:          options.landscape || false,
    });
    const tmpPath = path.join(app.getPath('temp'), `report_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, pdfData);
    return { success: true, path: tmpPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('generate-periodic-pdf', async (event, opts = {}) => {
  try {
    const ts     = Date.now();
    const output = path.join(os.tmpdir(), `periodic_${ts}.pdf`);
    const result = await callPython('generate_periodic_pdf', [
      opts.productId, opts.from, opts.to,
      opts.sourceId || null, output
    ], 60000);
    if (result?.success) return { success: true, path: result.path };
    return { success: false, error: result?.error || 'PDF generation failed' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-pdf', async (event, pdfPath, suggestedName, productFolder, subperiodFolder) => {
  try {
    // productFolder: πχ "ΑΜΜ0-4", subperiodFolder: πχ "UP1" ή null
    const autoPath = productFolder
      ? getPdfPath(productFolder, suggestedName || path.basename(pdfPath), subperiodFolder || null)
      : null;
    if (autoPath) {
      fs.copyFileSync(pdfPath, autoPath);
      return { success: true, path: autoPath, auto: true };
    }
    // Αλλιώς → dialog
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName || 'report.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled) return { success: false, canceled: true };
    fs.copyFileSync(pdfPath, result.filePath);
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-statistics', async (event, pdfPath, suggestedName) => {
  try {
    const dest = getStatisticsPath(suggestedName || path.basename(pdfPath));
    if (dest) {
      fs.copyFileSync(pdfPath, dest);
      return { success: true, path: dest };
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName || 'statistics.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled) return { success: false, canceled: true };
    fs.copyFileSync(pdfPath, result.filePath);
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-pdf', async (event, pdfPath) => {
  try {
    await shell.openPath(pdfPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('print-pdf', async (event, pdfPath) => {
  try {
    // Άνοιγμα με default viewer που έχει print button
    await shell.openPath(pdfPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================
// IPC — Email (SMTP)
// ============================================================

ipcMain.handle('send-email', async (event, smtpConfig, emailData) => {
  try {
    const transporter = nodemailer.createTransport({
      host:   smtpConfig.host,
      port:   parseInt(smtpConfig.port) || 587,
      secure: smtpConfig.port == 465,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
      },
    });

    await transporter.sendMail({
      from:        smtpConfig.from || smtpConfig.user,
      to:          emailData.to,
      subject:     emailData.subject,
      text:        emailData.body || '',
      attachments: emailData.attachments || [],
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('test-smtp', async (event, smtpConfig) => {
  try {
    const transporter = nodemailer.createTransport({
      host:   smtpConfig.host,
      port:   parseInt(smtpConfig.port) || 587,
      secure: smtpConfig.port == 465,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
      },
    });
    await transporter.verify();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================
// CONFIG — Φάκελος δεδομένων + Backup
// ============================================================

let _configPath = null;
function getConfigPath() {
  if (!_configPath) _configPath = path.join(app.getPath('userData'), 'lab-config.json');
  return _configPath;
}

function loadConfig() {
  try {
    if (fs.existsSync(getConfigPath())) {
      return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveConfig(cfg) {
  try {
    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('[Config] Αποθηκεύτηκε:', configPath, cfg);
    return true;
  } catch(e) {
    console.error('[Config] Σφάλμα αποθήκευσης:', e.message);
    return false;
  }
}

// Βοηθητικές για δομή φακέλου
function getDataFolder() {
  const cfg = loadConfig();
  // Archive mode: χρησιμοποιεί τον φάκελο της αρχειοθετημένης περιόδου
  if (_archiveMode && _archiveDataFolder) return _archiveDataFolder;
  if (cfg.archiveDataFolder)              return cfg.archiveDataFolder;
  return cfg.dataFolder || null;
}

function getPdfPath(productFolder, fileName, subperiodFolder = null) {
  // productFolder: πχ "ΑΜΜ0-4" ή "3Α0-31.5"
  // subperiodFolder: πχ "UP1" αν pdf_subfolder=true, αλλιώς null
  const base = getDataFolder();
  if (!base) return null;
  const safe = (productFolder || 'ΑΛΛΟ').replace(/[?%*:|"<>]/g, '-').trim();
  const dir  = subperiodFolder
    ? path.join(base, 'pdf', subperiodFolder, safe)
    : path.join(base, 'pdf', safe);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, fileName);
}

function getStatisticsPath(fileName) {
  const base = getDataFolder();
  if (!base) return null;
  const dir = path.join(base, 'statistics');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, fileName);
}

function getBackupPath() {
  const base = getDataFolder();
  if (!base) return null;
  const year = new Date().getFullYear().toString();
  const dir  = path.join(base, 'backup', year);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Εύρεση βάσης δεδομένων
function getDbPath() {
  const candidates = [
    path.join(__dirname, 'database', 'laboratory.db'),
    path.join(__dirname, 'database', 'lab.db'),
    path.join(__dirname, 'laboratory.db'),
    path.join(__dirname, 'lab.db'),
    path.join(app.getPath('userData'), 'laboratory.db'),
    path.join(app.getPath('userData'), 'lab.db'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log('[Backup] Βρέθηκε DB:', p);
      return p;
    }
  }
  console.error('[Backup] Δεν βρέθηκε βάση δεδομένων!');
  return null;
}

// Backup βάσης
function getPeriodStartStamp() {
  // Διαβάζει την ημερομηνία έναρξης της ενεργής υποπεριόδου από config
  // (αποθηκεύεται κατά τη δημιουργία υποπεριόδου)
  const cfg = loadConfig();
  const d = cfg.activePeriodStart;
  if (!d) return '00000000';
  // Μετατροπή DD/MM/YYYY ή YYYY-MM-DD → YYYYMMDD
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.replace(/-/g, '').substring(0, 8);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(d)) {
    const [day, mon, yr] = d.split('/');
    return `${yr}${mon}${day}`;
  }
  return '00000000';
}

function performBackup(final = false) {
  const dbPath    = getDbPath();
  const backupDir = getBackupPath();
  if (!dbPath || !backupDir) return { success: false, reason: 'no_folder' };

  const dest = path.join(backupDir, _buildBackupName(final));
  if (fs.existsSync(dest)) return { success: true, path: dest, skipped: true };

  try {
    fs.copyFileSync(dbPath, dest);
    if (!final) _pruneBackups(backupDir, 7);
    return { success: true, path: dest };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function _buildBackupName(final = false) {
  const now       = new Date();
  const todayStamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const periodStamp = getPeriodStartStamp();
  return final
    ? `lab_${periodStamp}_${todayStamp}_FINAL.db`
    : `lab_${periodStamp}_${todayStamp}.db`;
}

function _pruneBackups(backupDir, keep = 7) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db') && !f.includes('_FINAL'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // νεότερα πρώτα
    for (const f of files.slice(keep)) {
      fs.unlinkSync(path.join(backupDir, f.name));
    }
  } catch(e) {
    console.warn('[Backup] Prune warning:', e.message);
  }
}

// IPC: Get/Set config
ipcMain.handle('get-config', async () => {
  return loadConfig();
});

ipcMain.handle('set-config', async (event, updates) => {
  const cfg = { ...loadConfig(), ...updates };
  return { success: saveConfig(cfg) };
});

// IPC: Επιλογή φακέλου δεδομένων
ipcMain.handle('select-data-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      'Επιλογή Φακέλου Δεδομένων',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return { success: false, canceled: true };
  const folder = result.filePaths[0];
  // Δημιουργία δομής
  fs.mkdirSync(path.join(folder, 'pdf'),    { recursive: true });
  fs.mkdirSync(path.join(folder, 'backup'), { recursive: true });
  // Αποθήκευση
  const cfg = { ...loadConfig(), dataFolder: folder };
  saveConfig(cfg);
  return { success: true, folder };
});

// IPC: Χειροκίνητο backup
ipcMain.handle('backup-database', async () => {
  return performBackup();
});

// IPC: FINAL backup (αλλαγή υποπεριόδου)
ipcMain.handle('backup-database-final', async () => {
  return performBackup(true);
});

// IPC: Λίστα τελευταίων 5 backup αρχείων
ipcMain.handle('list-backups', async () => {
  const dataFolder = getDataFolder();
  if (!dataFolder) return { ok: false, files: [] };
  const backupRoot = path.join(dataFolder, 'backup');
  if (!fs.existsSync(backupRoot)) return { ok: true, files: [] };

  const files = [];
  function scanDir(dir) {
    try {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) { scanDir(full); }
        else if (name.endsWith('.db')) {
          files.push({ name, path: full, size: stat.size, mtime: stat.mtimeMs });
        }
      }
    } catch(e) {}
  }
  scanDir(backupRoot);
  files.sort((a, b) => b.mtime - a.mtime);
  return { ok: true, files: files.slice(0, 5) };
});

// IPC: Επιλογή αρχείου backup μέσω dialog
ipcMain.handle('select-backup-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:   'Επιλογή αρχείου backup',
    properties: ['openFile'],
    filters: [{ name: 'Βάση Δεδομένων', extensions: ['db'] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  const fp   = result.filePaths[0];
  const stat = fs.statSync(fp);
  return { ok: true, path: fp, name: path.basename(fp), size: stat.size };
});

// IPC: Επαναφορά βάσης από backup
ipcMain.handle('restore-backup', async (event, backupPath) => {
  try {
    const dbPath = getDbPath();
    if (!dbPath)                      return { ok: false, error: 'Δεν βρέθηκε βάση δεδομένων' };
    if (!fs.existsSync(backupPath))   return { ok: false, error: 'Το αρχείο backup δεν βρέθηκε' };

    // 1. Auto-backup της τρέχουσας βάσης πριν αντικατασταθεί
    const dataFolder = getDataFolder();
    if (dataFolder) {
      const backupDir = path.join(dataFolder, 'backup');
      fs.mkdirSync(backupDir, { recursive: true });
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
      fs.copyFileSync(dbPath, path.join(backupDir, `lab_pre_restore_${stamp}.db`));
    }

    // 2. Διαγραφή WAL/SHM για καθαρή επαναφορά
    for (const ext of ['-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + ext); } catch(e) {}
    }

    // 3. Αντικατάσταση με το επιλεγμένο backup
    fs.copyFileSync(backupPath, dbPath);

    // 4. Επανεκκίνηση
    setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// IPC: Get data folder
ipcMain.handle('get-data-folder', async () => {
  const folder = getDataFolder();
  console.log('[Config] get-data-folder:', folder, 'configPath:', getConfigPath());
  return { folder };
});

