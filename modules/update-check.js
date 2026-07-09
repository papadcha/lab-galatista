// Έλεγχος ενημερώσεων: allowed-versions-v2.json manifest από GitHub raw,
// σύγκριση semantic version, update/rollback banner στο renderer, και
// η ροή αναφοράς προβλήματος έκδοσης (report-version-issue) — δημιουργεί
// GitHub issue μέσω του κοινού createGithubIssue() (modules/problem-report.js,
// fine-grained PAT).
//
// Ξεχωριστό αρχείο manifest από το v1.x's allowed-versions.json (το οποίο
// παραμένει αμετάβλητο σε αυτή τη θέση, ώστε οι ήδη εγκατεστημένες v1.x
// εφαρμογές — που εξακολουθούν να το fetch-άρουν από το master branch —
// να μην επηρεαστούν από συστάσεις της γραμμής v2.x.
import { app, shell, net, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { state } from './state.js';
import { createGithubIssue } from './problem-report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const appRootDir = path.join(__dirname, '..');

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

// allowed-versions-v2.json — χειροκίνητα συντηρούμενο αρχείο στο GitHub. Δεν
// συμπίπτει απαραίτητα με το τελευταίο release: αν μια έκδοση αποδειχτεί
// προβληματική, το latestRecommendedVersion παραμένει εσκεμμένα πίσω μέχρι
// να διορθωθεί (βλ. TODOLIST.md).
async function _fetchAllowedVersions() {
  try {
    // Ίδιο cache-busting τέχνασμα με πριν — μοναδικό URL ανά κλήση.
    return await _fetchJsonViaNet(
      `https://raw.githubusercontent.com/papadcha/lab-galatista/master/allowed-versions-v2.json?_=${Date.now()}`,
      { 'User-Agent': 'lab-galatista-updater' }
    );
  } catch(e) {
    return null;
  }
}

export async function checkForUpdates() {
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
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-allowed-versions', async () => {
  const allowed = await _fetchAllowedVersions();
  return allowed || { versions: [], latestRecommendedVersion: null, safeDowngradeFloor: null, notice: null };
});

// Δημιουργεί GitHub issue μέσω createGithubIssue() (modules/problem-report.js
// — βλ. εκεί για το security model/token rotation instructions). Ένας
// άνθρωπος (εγώ) βλέπει το issue και αποφασίζει αν θα ενημερωθεί το
// allowed-versions-v2.json — δεν αλλάζει τίποτα αυτόματα.
ipcMain.handle('report-version-issue', async (event, lastGoodVersion, description) => {
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

  return createGithubIssue(
    `[Αναφορά χρήστη] Πρόβλημα από v${currentVersion} — τελευταία σταθερή κατά τον χρήστη v${lastGoodVersion}`,
    bodyText
  );
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-version-history', () => {
  try {
    const filePath = path.join(appRootDir, 'VERSIONS.md');
    return { ok: true, content: fs.readFileSync(filePath, 'utf-8') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
