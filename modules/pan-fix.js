// Έλεγχος παλαιών κοκκομετριών με διπλομετρημένο βάρος τυφλού (fix
// b174af5/83fb1b6 — δεν έγινε retroactive recalculation, ο χειριστής
// επιλέγει ρητά ποιες να ελέγξει/ξανα-αποθηκεύσει μέσω modal στο startup).
import { ipcMain } from 'electron';
import { state } from './state.js';
import { _pyCallMain } from './python-bridge.js';
import { loadConfig, saveConfig } from './config.js';

export async function checkPanDoublecountFix() {
  try {
    const cfg = loadConfig();
    if (cfg.hidePanFixNotice) return;

    const affected = await _pyCallMain('get_pan_doublecount_affected_samples', []);
    if (!affected || affected.length === 0) return;

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('pan-fix-needed', affected);
    }
  } catch (e) {
    console.error('[PanFix] Έλεγχος επηρεαζόμενων κοκκομετριών απέτυχε:', e.message);
  }
}

ipcMain.handle('pan-fix-notice-dismiss', async () => {
  const cfg = loadConfig();
  cfg.hidePanFixNotice = true;
  saveConfig(cfg);
  return { ok: true };
});
