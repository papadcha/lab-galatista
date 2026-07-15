// Έλεγχος ενημερώσεων: allowed-versions-v2.json manifest από GitHub raw,
// σύγκριση semantic version, background auto-download του installer (μόνο
// το τρέξιμό του/η εγκατάσταση μένει χειροκίνητη), update/rollback banner
// στο renderer, και η ροή αναφοράς προβλήματος έκδοσης (report-version-issue)
// — δημιουργεί GitHub issue μέσω του κοινού createGithubIssue()
// (modules/problem-report.js, fine-grained PAT).
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

const UPDATES_DIR = path.join(app.getPath('userData'), 'updates');

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

// timeoutMs προστατεύει από hang (π.χ. VPN/δίκτυο που "κόβει" σιωπηλά τη
// σύνδεση χωρίς error/close event) — χωρίς αυτό, μια κολλημένη σύνδεση
// κρατάει το Promise ανεπίλυτο επ' άπειρον.
function _fetchJsonViaNet(url, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };

    const timer = setTimeout(() => {
      try { request.abort(); } catch {}
      done(reject, new Error('Timeout'));
    }, timeoutMs);

    const request = net.request({ method: 'GET', url, headers });
    let data = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { data += chunk.toString(); });
      response.on('end', () => {
        try { done(resolve, JSON.parse(data)); } catch(e) { done(reject, e); }
      });
      response.on('error', (e) => done(reject, e));
    });
    request.on('error', (e) => done(reject, e));
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

// Κατεβάζει ένα αρχείο μέσω net.request και το γράφει στο destPath — αλλά
// μόνο αφού επιβεβαιωθεί ότι είναι πραγματικά Windows executable (μαγικά
// bytes "MZ"), όχι π.χ. η HTML σελίδα του GitHub releases (αν το downloadUrl
// στο manifest δείχνει κατά λάθος εκεί αντί για direct asset link).
// idleTimeoutMs: resets σε κάθε chunk δεδομένων — προστατεύει από hang σε
// κολλημένη/αργή σύνδεση (VPN κλπ) χωρίς να κόβει μια απλά αργή αλλά ενεργή
// λήψη ενός installer ~100MB.
function _downloadFile(url, destPath, idleTimeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const clear = () => clearTimeout(timer);
    const done = (fn, arg) => { if (!settled) { settled = true; clear(); fn(arg); } };
    const resetTimer = () => {
      clear();
      timer = setTimeout(() => {
        try { request.abort(); } catch {}
        done(reject, new Error('Timeout λήψης (καμία δραστηριότητα δικτύου)'));
      }, idleTimeoutMs);
    };

    const request = net.request({ method: 'GET', url });
    const chunks = [];
    resetTimer();
    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        done(reject, new Error('HTTP ' + response.statusCode));
        return;
      }
      response.on('data', (chunk) => { resetTimer(); chunks.push(chunk); });
      response.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 2 || buf[0] !== 0x4D || buf[1] !== 0x5A) {
          done(reject, new Error('Το ληφθέν αρχείο δεν είναι έγκυρο installer (.exe)'));
          return;
        }
        try {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.writeFileSync(destPath, buf);
          done(resolve);
        } catch (e) { done(reject, e); }
      });
      response.on('error', (e) => done(reject, e));
    });
    request.on('error', (e) => done(reject, e));
    request.end();
  });
}

// Κατεβάζει τον installer της προτεινόμενης έκδοσης στο background, χωρίς
// καμία ενέργεια χρήστη — μόνο η ίδια η εγκατάσταση (τρέξιμο του .exe) μένει
// χειροκίνητη. Επιστρέφει το τοπικό path αν πέτυχε, αλλιώς null (οπότε ο
// caller πέφτει πίσω στο παλιό "άνοιξε τον σύνδεσμο στον browser" flow).
async function _downloadUpdateInBackground(version, downloadUrl) {
  if (!downloadUrl) return null;
  const fileName = `Setup.${version}.exe`;
  const destPath = path.join(UPDATES_DIR, fileName);
  if (fs.existsSync(destPath)) return destPath; // ήδη κατεβασμένο σε προηγούμενη εκκίνηση

  try {
    await _downloadFile(downloadUrl, destPath);
    // Κρατάμε μόνο τον τελευταίο ληφθέντα installer, ώστε ο φάκελος updates/
    // να μην μεγαλώνει επ' άπειρον — καθαρισμός ΜΟΝΟ μετά από επιτυχή λήψη,
    // ώστε ένας προηγούμενος έγκυρος installer να μην χαθεί αν αποτύχει η νέα λήψη.
    if (fs.existsSync(UPDATES_DIR)) {
      for (const f of fs.readdirSync(UPDATES_DIR)) {
        if (f !== fileName) { try { fs.rmSync(path.join(UPDATES_DIR, f), { force: true }); } catch {} }
      }
    }
    return destPath;
  } catch (e) {
    console.log('[Update] Αποτυχία background λήψης installer:', e.message);
    try { fs.rmSync(destPath, { force: true }); } catch {}
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

  const kind = cmp > 0 ? 'update' : (cmp < 0 && allowed.notice ? 'rollback' : null);
  if (!kind) return;

  const fallbackUrl = entry?.downloadUrl || `https://github.com/papadcha/lab-galatista/releases/tag/v${recommended}`;

  // Το banner εμφανίζεται ΑΜΕΣΩΣ — δεν περιμένει τη λήψη του installer.
  // Αν περίμενε (await) εδώ, μια κολλημένη/αργή σύνδεση θα κρατούσε το
  // banner αόρατο επ' άπειρον, με κανένα σφάλμα να το προδίδει (ακριβώς το
  // bug που έκανε το v2.4.0 «αόρατο» σε κάποιο μηχάνημα).
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('update-available', {
      kind,
      current:   currentVersion,
      latest:    recommended,
      url:       fallbackUrl,
      localPath: null, // ο installer δεν έχει κατέβει ακόμα — το κουμπί ξεκινά ως "⬇ Λήψη"
      notes:     kind === 'rollback' ? allowed.notice : (entry?.notes || ''),
    });
  }

  // Η λήψη τρέχει ξεχωριστά, στο background — αν πετύχει, ενημερώνει το
  // ήδη ορατό banner ώστε το κουμπί να γίνει "⚙ Εγκατάσταση".
  const localPath = await _downloadUpdateInBackground(recommended, entry?.downloadUrl);
  if (localPath && state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send('update-ready', { latest: recommended, localPath });
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

// Τρέχει τον ήδη κατεβασμένο installer (background download) — ο ίδιος ο
// installer wizard παραμένει χειροκίνητος (clicks του χρήστη), μόνο η λήψη
// του .exe έγινε αυτόματα πριν.
ipcMain.handle('install-update', async (event, localPath) => {
  try {
    if (!localPath || !fs.existsSync(localPath)) {
      return { ok: false, error: 'Ο installer δεν βρέθηκε τοπικά.' };
    }
    const result = await shell.openPath(localPath); // κενό string = επιτυχία
    if (result) return { ok: false, error: result };
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
