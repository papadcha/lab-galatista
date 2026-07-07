// CE Period: ειδοποίηση λήξης CE (checkCeExpiryAndNotify), έλεγχος
// αναντιστοιχίας φακέλου δεδομένων vs ενεργή CE period
// (checkDataFolderMismatch), snooze IPC handlers, και τα IPC handlers
// δημιουργίας/επιλογής φακέλου για νέα CE period.
import { app, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { state } from './state.js';
import { _pyCallMain } from './python-bridge.js';
import { loadConfig, saveConfig, getDbPath } from './config.js';

export async function checkCeExpiryAndNotify() {
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
        const timer = setTimeout(() => {
          if (state.pyPending.has(id)) { state.pyPending.delete(id); resolve(null); }
        }, 8000);
        state.pyPending.set(id, (result) => { clearTimeout(timer); resolve(result); });
        try { state.pyProcess.stdin.write(reqLine); }
        catch (e) { state.pyPending.delete(id); clearTimeout(timer); resolve(null); }
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

export async function checkDataFolderMismatch() {
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
