// PDF Generation: report PDF (reportlab μέσω Python, με fallback μέσω
// κρυφού BrowserWindow + printToPDF — όχι πια puppeteer, βλ. σχόλιο στο
// renderPDF), print-to-pdf (renderer webContents), periodic PDF,
// save/open/print PDF βοηθητικά IPC handlers.
import { app, BrowserWindow, dialog, shell, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { state } from './state.js';
import { callPython } from './python-bridge.js';
import { getPdfPath, getStatisticsPath } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const appRootDir = path.join(__dirname, '..');

// Electron's printToPDF margins είναι σε ίντσες στην πράξη (παρά το ότι το
// bundled electron.d.ts λέει "in pixels" — επαληθεύτηκε εμπειρικά: τιμές σε
// px προκαλούν "margins must be less than or equal to pageSize").
const MM_TO_IN = 1 / 25.4;

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
    const logoPath = path.join(appRootDir, 'src', 'assets', 'logo.png');
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

    const mainCss  = path.join(appRootDir, 'src', 'styles', 'main.css');
    const printCss = path.join(appRootDir, 'src', 'styles', 'reports-print.css');
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

    // Πριν χρησιμοποιούσε puppeteer (ξεχωριστό Chromium download) — ΜΗΝ
    // συσκευαζόταν καν στο installer (`!node_modules/puppeteer/**/*`), άρα
    // αυτό το fallback δεν δούλευε ποτέ στην πραγματική εγκατάσταση. Ένα
    // κρυφό BrowserWindow χρησιμοποιεί το ήδη ενσωματωμένο Chromium του
    // Electron — καμία επιπλέον εξάρτηση, δουλεύει και packaged.
    async function renderPDF(mode, landscape) {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      try {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(makeHTML(mode)));
        await new Promise(r => setTimeout(r, 1500));
        return await win.webContents.printToPDF({
          landscape,
          pageSize: 'A4',
          printBackground: true,
          margins: {
            marginType: 'custom',
            top:    16 * MM_TO_IN,
            bottom: 14 * MM_TO_IN,
            left:   14 * MM_TO_IN,
            right:  14 * MM_TO_IN,
          },
        });
      } finally {
        win.destroy();
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
