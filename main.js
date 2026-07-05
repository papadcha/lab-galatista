import { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';

import { state } from './modules/state.js';
import { startPythonBackend, waitForPythonReady, _pyCallMain, callPython } from './modules/python-bridge.js';
import {
  loadConfig, saveConfig, getConfigPath, getBackupPath,
  getDbPath, getPdfPath, getStatisticsPath, performBackup, _sanitizeFsSegment,
} from './modules/config.js';
import { runRclone, performStartupCloudSync } from './modules/cloud-sync.js';
import './modules/retention.js'; // side-effect: ipcMain.handle('retention-*', ...)
import './modules/archive-mode.js'; // side-effect: ipcMain.handle('*-archive*', 'inspect-backup-samples', ...)
import './modules/clean-start.js'; // side-effect: ipcMain.handle('clean-start', ...)

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

let _puppeteer = null;
async function getPuppeteer() {
  if (!_puppeteer) _puppeteer = (await import('puppeteer')).default;
  return _puppeteer;
}

// ============================================================
// ΔΗΜΙΟΥΡΓΙΑ ΠΑΡΑΘΥΡΟΥ
// ============================================================

function createWindow() {
  state.mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  1024,
    minHeight: 640,
    title: 'Εργαστήριο Λατομείων Γαλάτιστας',
    frame: false,
    webPreferences: {
      nodeIntegration:     false,
      contextIsolation:    true,
      // .cjs (όχι .js) — τα ESM preload scripts του Electron 28 αποτυγχάνουν
      // σιωπηλά (κανένα contextBridge exposure, καμία εξαίρεση/σφάλμα στο
      // console), επαληθεύτηκε εμπειρικά κατά το ESM redesign. Το .cjs
      // αναγκάζει CommonJS ανεξάρτητα από το "type":"module" του package.json.
      preload:             path.join(__dirname, 'preload.cjs'),
      webSecurity:         true,
    },
    // Εμφάνιση παραθύρου μόνο όταν είναι έτοιμο
    show: false,
  });

  // Φόρτωση κύριας σελίδας
  state.mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Εμφάνιση όταν είναι έτοιμο (αποφυγή λευκής οθόνης)
  state.mainWindow.once('ready-to-show', () => {
    state.mainWindow.show();
  });

  // Ενημέρωση renderer για toggle icon minimize/restore
  state.mainWindow.on('maximize',   () => state.mainWindow.webContents.send('window-maximized-change', true));
  state.mainWindow.on('unmaximize', () => state.mainWindow.webContents.send('window-maximized-change', false));

  // Ανάπτυξη: άνοιγμα DevTools (αφαίρεσε αν δεν χρειάζεται)
  // state.mainWindow.webContents.openDevTools();


}

// Custom titlebar — αφαίρεση native frame + default μενού (File/Edit/View)
Menu.setApplicationMenu(null);

ipcMain.handle('window-minimize', () => state.mainWindow?.minimize());
ipcMain.handle('window-maximize-toggle', () => {
  if (!state.mainWindow) return;
  if (state.mainWindow.isMaximized()) state.mainWindow.unmaximize();
  else state.mainWindow.maximize();
});
ipcMain.handle('window-close', () => state.mainWindow?.close());
ipcMain.handle('window-is-maximized', () => state.mainWindow?.isMaximized() ?? false);

// ============================================================
// ΕΚΔΗΛΩΣΕΙΣ APP
// ============================================================

app.whenReady().then(() => {
  createWindow();

  // Εκκίνηση Python backend
  try {
    startPythonBackend(__dirname);
  } catch (e) {
    console.error('Python backend δεν ξεκίνησε:', e.message);
  }

  // Αυτόματο backup + CE check + cloud sync κατά εκκίνηση —
  // περιμένουμε το backend να είναι πραγματικά έτοιμο (με timeout fallback)
  // αντί για αυθαίρετο delay
  (async () => {
    const ready = await waitForPythonReady();
    if (!ready) console.warn('[Startup] Ο Python backend δεν απάντησε εγκαίρως — συνεχίζουμε ούτως ή άλλως');

    // Αν η προηγούμενη έξοδος από Archive Mode δεν ήταν καθαρή (π.χ. crash),
    // το config μπορεί να έχει μείνει με archiveDataFolder ενώ το Python
    // backend (φρέσκια διεργασία, καμία μνήμη archive mode) συνδέεται πάντα
    // στη ζωντανή βάση — χωρίς αυτό το reconcile, getDataFolder() θα έστελνε
    // backups/PDF στον ΠΑΛΙΟ αρχειοθετημένο φάκελο ενώ η βάση θα ήταν η ζωντανή.
    const cfgStartup = loadConfig();
    if (cfgStartup.archiveDataFolder) {
      console.warn('[Startup] Βρέθηκε archiveDataFolder από μη ολοκληρωμένη έξοδο από Archive Mode — καθαρισμός.');
      const cfgClean = loadConfig();
      delete cfgClean.archiveDataFolder;
      saveConfig(cfgClean);
    }

    // ── Τοπικό backup ─────────────────────────────────────
    const result = await performBackup();
    if (result.success) {
      console.log('[Backup] Αυτόματο backup:', result.path);
    } else if (result.reason !== 'no_folder') {
      console.error('[Backup] Σφάλμα:', result.error);
    }

    // ── CE Expiry check ────────────────────────────────────
    await checkCeExpiryAndNotify();
    await initActivePeriodStart();

    // ── Έλεγχος φακέλου δεδομένων vs ενεργή CE period ─────
    await checkDataFolderMismatch();

    // ── Έλεγχος νέας έκδοσης ──────────────────────────────
    checkForUpdates().catch(e => console.log('[Update] Σφάλμα:', e.message));

    // ── Cloud sync (backup πάντα, pdf μόνο νέα) ───────────
    const cfg = loadConfig();
    if (cfg.cloudRemotePath) {
      performStartupCloudSync(cfg.cloudRemotePath).catch(e =>
        console.error('[Cloud] Startup sync error:', e.message)
      );
    }
  })();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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
    if (!state.pyProcess || state.pyProcess.killed) { resolve(null); return; }
    state.pyPending.set(id, resolve);
    try { state.pyProcess.stdin.write(req); }
    catch(e) { state.pyPending.delete(id); resolve(null); return; }
    setTimeout(() => {
      if (state.pyPending.has(id)) { state.pyPending.delete(id); resolve(null); }
    }, 5000);
  });

  const validFrom = period?.active_subperiod?.valid_from || period?.valid_from;
  if (validFrom) {
    saveConfig({ ...loadConfig(), activePeriodStart: validFrom });
  }
}

// ============================================================
// DOCUMENT LIBRARY — upload / open / delete
// ============================================================

ipcMain.handle('upload-document', async (event, { sectionName }) => {
  const result = await dialog.showOpenDialog(state.mainWindow, {
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

  const cacheDir  = path.join(app.getPath('userData'), 'documents_cache',
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
  state.archiveMode = false;
  if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.destroy();
  return { ok: true };
});

// ============================================================
// UPDATE CHECK
// ============================================================

// Σύγκριση semantic version — a>b: 1, a<b: -1, ίσα: 0
function _cmpVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i]||0) > (pb[i]||0)) return 1;
    if ((pa[i]||0) < (pb[i]||0)) return -1;
  }
  return 0;
}

function _fetchJsonViaNet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url, headers });
    let data = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { data += chunk.toString(); });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

// allowed-versions.json — χειροκίνητα συντηρούμενο αρχείο στο GitHub. Δεν
// συμπίπτει απαραίτητα με το τελευταίο release: αν μια έκδοση αποδειχτεί
// προβληματική, το latestRecommendedVersion παραμένει εσκεμμένα πίσω μέχρι
// να διορθωθεί (βλ. TODOLIST.md).
async function _fetchAllowedVersions() {
  try {
    // Ίδιο cache-busting τέχνασμα με πριν — μοναδικό URL ανά κλήση.
    return await _fetchJsonViaNet(
      `https://raw.githubusercontent.com/papadcha/lab-galatista/master/allowed-versions.json?_=${Date.now()}`,
      { 'User-Agent': 'lab-galatista-updater' }
    );
  } catch(e) {
    return null;
  }
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const allowed = await _fetchAllowedVersions();
  if (!allowed?.latestRecommendedVersion) return; // offline ή αρχείο λείπει — σιωπηλά, όπως πριν

  const recommended = allowed.latestRecommendedVersion;
  const entry = allowed.versions?.find(v => v.version === recommended);
  const cmp = _cmpVersion(recommended, currentVersion);

  if (cmp > 0) {
    // Υπάρχει νεότερη, προτεινόμενη έκδοση
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('update-available', {
        kind:    'update',
        current: currentVersion,
        latest:  recommended,
        url:     entry?.downloadUrl || `https://github.com/papadcha/lab-galatista/releases/tag/v${recommended}`,
        notes:   entry?.notes || '',
      });
    }
  } else if (cmp < 0 && allowed.notice) {
    // Η τρέχουσα έκδοση είναι πιο πρόσφατη από την προτεινόμενη ΚΑΙ υπάρχει
    // ρητή σημείωση προβλήματος — δεν εμφανίζουμε ποτέ αυτό το banner μόνο
    // επειδή ξεχάστηκε να ενημερωθεί το latestRecommendedVersion.
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('update-available', {
        kind:    'rollback',
        current: currentVersion,
        latest:  recommended,
        url:     entry?.downloadUrl || `https://github.com/papadcha/lab-galatista/releases/tag/v${recommended}`,
        notes:   allowed.notice,
      });
    }
  }
}

ipcMain.handle('open-update-url', async (event, url) => {
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('get-allowed-versions', async () => {
  const allowed = await _fetchAllowedVersions();
  return allowed || { versions: [], latestRecommendedVersion: null, safeDowngradeFloor: null, notice: null };
});

// Γιατί το token είναι embedded (και όχι server-side proxy): η εφαρμογή
// δεν έχει δικό της backend/server — μόνο 2 τοπικές εγκαταστάσεις χωρίς
// κοινή υποδομή (βλ. Multi-Install Architecture). Ένα proxy θα σήμαινε
// να στηθεί/συντηρείται ξεχωριστό server μόνο για αυτή τη λειτουργία,
// δυσανάλογο για ένα εσωτερικό εργαλείο 2 χρηστών. Αντ' αυτού, το token
// είναι fine-grained PAT scoped ΜΟΝΟ σε "Issues: write" στο συγκεκριμένο
// repo — επαληθεύτηκε εμπειρικά ότι απορρίπτεται (403) σε write στο
// contents API, άρα ακόμα κι αν εξαχθεί από το .exe το χειρότερο δυνατό
// είναι spam issues, όχι αλλαγή κώδικα/releases/δεδομένων.
//
// Rotation αν ποτέ χρειαστεί (π.χ. issue spam κατάχρηση): (1) revoke το
// τρέχον token στο GitHub (Settings → Developer settings → Fine-grained
// tokens), (2) δημιούργησε νέο με το ΙΔΙΟ στενό scope (μόνο Issues: write,
// μόνο αυτό το repo), (3) αντικατέστησε την τιμή στο τοπικό
// github-token.json (gitignored, ΔΕΝ μπαίνει στο git), (4) νέο release —
// οι ήδη εγκατεστημένες εκδόσεις κρατάνε το παλιό (πλέον ανενεργό) token
// μέχρι να αναβαθμιστούν, οπότε το report-version-issue απλά θα αποτυγχάνει
// σιωπηλά γι' αυτές μέχρι την αναβάθμιση.
function _loadGithubToken() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'github-token.json'), 'utf-8');
    return JSON.parse(raw).token || null;
  } catch(e) {
    return null;
  }
}

// Δημιουργεί GitHub issue (όχι αλλαγή αρχείου) — το token έχει δικαίωμα
// ΜΟΝΟ "Issues: write" στο συγκεκριμένο repo, τίποτα άλλο. Ένας άνθρωπος
// (εγώ) βλέπει το issue και αποφασίζει αν θα ενημερωθεί το
// allowed-versions.json — δεν αλλάζει τίποτα αυτόματα.
ipcMain.handle('report-version-issue', async (event, lastGoodVersion, description) => {
  const token = _loadGithubToken();
  if (!token) return { ok: false, error: 'Η αναφορά δεν είναι διαθέσιμη σε αυτή την εγκατάσταση' };
  const currentVersion = app.getVersion();
  const hostname = os.hostname() || 'άγνωστο';
  const bodyText = [
    `**Τρέχουσα έκδοση (πιθανώς προβληματική):** v${currentVersion}`,
    `**Τελευταία έκδοση που δούλευε σωστά (κατά τον χρήστη):** v${lastGoodVersion}`,
    `**Μηχάνημα:** ${hostname}`,
    '',
    '**Περιγραφή προβλήματος:**',
    description || '(καμία περιγραφή)',
  ].join('\n');

  try {
    const payload = JSON.stringify({
      title: `[Αναφορά χρήστη] Πρόβλημα από v${currentVersion} — τελευταία σταθερή κατά τον χρήστη v${lastGoodVersion}`,
      body:  bodyText,
    });
    const result = await new Promise((resolve, reject) => {
      const request = net.request({
        method: 'POST',
        url: 'https://api.github.com/repos/papadcha/lab-galatista/issues',
        headers: {
          'Authorization':  `Bearer ${token}`,
          'Accept':         'application/vnd.github+json',
          'Content-Type':   'application/json',
          'User-Agent':     'lab-galatista-app',
        },
      });
      let data = '';
      request.on('response', (response) => {
        response.on('data', (chunk) => { data += chunk.toString(); });
        response.on('end', () => resolve({ status: response.statusCode, data }));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.write(payload);
      request.end();
    });
    if (result.status !== 201) {
      return { ok: false, error: `GitHub API σφάλμα ${result.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-version-history', () => {
  try {
    const filePath = path.join(__dirname, 'VERSIONS.md');
    return { ok: true, content: fs.readFileSync(filePath, 'utf-8') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ============================================================
// CE EXPIRY NOTIFICATION
// ============================================================

async function checkCeExpiryAndNotify() {
  try {
    // Διαβάζει απευθείας από τη DB χωρίς Python IPC (main process)
    const dbPath = getDbPath();
    if (!dbPath) return;

    // Χρησιμοποιεί το Python backend μέσω pyBridge για να πάρει το status
    // Στέλνει request στο Python process που ήδη τρέχει
    const status = await new Promise((resolve) => {
      if (!state.pyProcess || state.pyProcess.killed) { resolve(null); return; }
      const id = 'ce-check-' + Date.now();
      const reqLine = JSON.stringify({ method: 'get_ce_expiry_status', args: [], id }) + '\n';
      // Σύντομη καθυστέρηση για να είναι σίγουρα έτοιμο το Python
      setTimeout(() => {
        if (!state.pyProcess || state.pyProcess.killed) { resolve(null); return; }
        state.pyPending.set(id, resolve);
        try { state.pyProcess.stdin.write(reqLine); }
        catch (e) { state.pyPending.delete(id); resolve(null); }
        setTimeout(() => {
          if (state.pyPending.has(id)) { state.pyPending.delete(id); resolve(null); }
        }, 8000);
      }, 1500);
    });

    if (!status || status.status === 'ok') return;

    const cfg = loadConfig();
    const snoozedUntil = cfg.ceNotifySnoozedUntil;
    if (snoozedUntil && new Date(snoozedUntil) > new Date()) return;

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('ce-expiry-notification', status);
    }
  } catch (e) {
    console.error('[CE] Expiry check error:', e.message);
  }
}

async function checkDataFolderMismatch() {
  try {
    const period    = await _pyCallMain('get_active_ce_period', []);
    const dbFolder  = period?.data_folder;
    if (!dbFolder) return;

    const cfg          = loadConfig();
    const localFolder  = cfg.dataFolder;
    if (!localFolder || dbFolder === localFolder) return;

    const snoozedUntil = cfg.dataFolderNotifySnoozedUntil;
    if (snoozedUntil && new Date(snoozedUntil) > new Date()) return;

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('data-folder-mismatch', {
        dbFolder, localFolder,
        existsLocally: fs.existsSync(dbFolder),
      });
    }
  } catch(e) {
    console.error('[DataFolder] Mismatch check error:', e.message);
  }
}

ipcMain.handle('data-folder-notify-snooze', async (event, days = 7) => {
  const until = new Date();
  until.setDate(until.getDate() + (days || 7));
  saveConfig({ ...loadConfig(), dataFolderNotifySnoozedUntil: until.toISOString() });
  return { ok: true };
});

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
  const result = await dialog.showOpenDialog(state.mainWindow, {
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
  if (state.pyProcess && !state.pyProcess.killed) {
    state.pyProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================================
// IPC — Guide Window
// ============================================================

ipcMain.handle('open-guide', async (event, testType) => {
  if (state.guideWindow && !state.guideWindow.isDestroyed()) {
    state.guideWindow.focus();
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

  state.guideWindow = new BrowserWindow({
    width:  900,
    height: 800,
    minWidth: 500,
    minHeight: 500,
    title: 'Οδηγός Διαδικασίας',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  state.guideWindow.loadFile(path.join(__dirname, guideFile));
  state.guideWindow.setMenuBarVisibility(false);

  state.guideWindow.once('ready-to-show', () => {
    state.guideWindow.show();
  });

  state.guideWindow.on('closed', () => {
    state.guideWindow = null;
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('guide-closed', testType);
    }
  });
});

ipcMain.handle('close-guide', async () => {
  if (state.guideWindow && !state.guideWindow.isDestroyed()) {
    state.guideWindow.close();
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

    const reportHTML = await state.mainWindow.webContents.executeJavaScript(`
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
      const htmlPath = path.join(os.tmpdir(), `rpt_${mode}_${ts}.html`);
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
    const portraitPath  = path.join(os.tmpdir(), `rpt_portrait_${ts}.pdf`);
    fs.writeFileSync(portraitPath, portraitData);
    const landscapeData = await renderPDF('landscape', true);
    const landscapePath = path.join(os.tmpdir(), `rpt_landscape_${ts}.pdf`);
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
    const pdfData = await state.mainWindow.webContents.printToPDF({
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
    const result = await dialog.showSaveDialog(state.mainWindow, {
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
    const result = await dialog.showSaveDialog(state.mainWindow, {
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

