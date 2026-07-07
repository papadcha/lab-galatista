// Έλεγχος ενημερώσεων: allowed-versions.json manifest από GitHub raw,
// σύγκριση semantic version, update/rollback banner στο renderer, και
// η ροή αναφοράς προβλήματος έκδοσης (report-version-issue) που δημιουργεί
// GitHub issue μέσω fine-grained PAT.
import { app, shell, net, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { state } from './state.js';

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
    const raw = fs.readFileSync(path.join(appRootDir, 'github-token.json'), 'utf-8');
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
    const filePath = path.join(appRootDir, 'VERSIONS.md');
    return { ok: true, content: fs.readFileSync(filePath, 'utf-8') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
