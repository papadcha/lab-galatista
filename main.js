import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

import { initLogger } from './modules/logger.js';
import { state } from './modules/state.js';
import { startPythonBackend, waitForPythonReady } from './modules/python-bridge.js';
import { loadConfig, saveConfig, performBackup } from './modules/config.js';
import { performStartupCloudSync } from './modules/cloud-sync.js';
import './modules/retention.js'; // side-effect: ipcMain.handle('retention-*', ...)
import { reconcileArchiveMode } from './modules/archive-mode.js'; // side-effect: ipcMain.handle('*-archive*', 'inspect-backup-samples', ...)
import { reconcileCleanStart } from './modules/clean-start.js'; // side-effect: ipcMain.handle('clean-start', ...)
import { checkForUpdates } from './modules/update-check.js'; // side-effect: ipcMain.handle('open-update-url'/'get-allowed-versions'/'report-version-issue'/'get-app-version'/'get-version-history', ...)
import { checkCeExpiryAndNotify, checkDataFolderMismatch } from './modules/ce-period.js'; // side-effect: ipcMain.handle('data-folder-notify-snooze'/'ce-notify-*'/'ce-get-suggested-folder'/'ce-select-folder', ...)
import './modules/pdf-generation.js'; // side-effect: ipcMain.handle('generate-report-pdf'/'print-to-pdf'/'generate-periodic-pdf'/'save-pdf'/'save-statistics'/'open-pdf'/'print-pdf', ...)
import './modules/email.js'; // side-effect: ipcMain.handle('send-email'/'test-smtp', ...)
import './modules/document-library.js'; // side-effect: ipcMain.handle('upload-document'/'open-document'/'delete-document-cloud'/'generate-pdf-library'/'force-quit', ...)

// Το ESM module graph φορτώνεται ολόκληρο πριν τρέξει οποιοδήποτε top-level
// statement εδώ, οπότε η θέση αυτής της κλήσης δεν προλαβαίνει logging ΜΕΣΑ
// στη φόρτωση των παραπάνω modules — δεν πειράζει, αφού αυτά μόνο κάνουν
// ipcMain.handle() registration στο evaluation τους, καμία πραγματική
// κλήση console.log δεν συμβαίνει πριν αυτά τα handlers κληθούν αργότερα.
initLogger();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

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

    // Αν η προηγούμενη έξοδος από Archive Mode δεν ήταν καθαρή (π.χ. crash) —
    // βλ. modules/archive-mode.js.
    reconcileArchiveMode();

    // Αντίστοιχος έλεγχος για μη ολοκληρωμένο Clean Start (crash μεταξύ
    // Python commit και config reset) — βλ. modules/clean-start.js.
    await reconcileCleanStart();

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
    const timer = setTimeout(() => {
      if (state.pyPending.has(id)) { state.pyPending.delete(id); resolve(null); }
    }, 5000);
    state.pyPending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    try { state.pyProcess.stdin.write(req); }
    catch(e) { state.pyPending.delete(id); clearTimeout(timer); resolve(null); return; }
  });

  const validFrom = period?.active_subperiod?.valid_from || period?.valid_from;
  if (validFrom) {
    saveConfig({ ...loadConfig(), activePeriodStart: validFrom });
  }
}

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


