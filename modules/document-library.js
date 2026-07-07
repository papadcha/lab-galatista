// Document Library: upload/open/delete εγγράφων στο cloud remote (rclone),
// δημιουργία PDF library μέσω Python, και force-quit (έξοδος χωρίς
// αναμονή graceful archive-mode restore).
import { app, dialog, shell, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { state } from './state.js';
import { _pyCallMain } from './python-bridge.js';
import { loadConfig } from './config.js';
import { runRclone } from './cloud-sync.js';

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
