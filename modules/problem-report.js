// Αναφορά προβλήματος/crash προς τον developer: GitHub issue (fine-grained
// PAT, ίδιος μηχανισμός/token με το ήδη υπάρχον report-version-issue στο
// modules/update-check.js — βλ. εκεί για το γιατί το token είναι embedded
// και το security model) + email (μέσω του ήδη ρυθμισμένου SMTP της
// εγκατάστασης, αν υπάρχει). Επίσης ανιχνεύει αν η προηγούμενη εκτέλεση
// τερμάτισε απροσδόκητα (crash), συγκρίνοντας το τελευταίο [FATAL] του log
// με τον clean-shutdown marker.
import { app, net, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { _pyCallMain } from './python-bridge.js';
import { sendEmail } from './email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const appRootDir = path.join(__dirname, '..');

const DEV_EMAIL = 'papadcha@gmail.com'; // σταθερός παραλήπτης developer, ανεξάρτητος ανά εγκατάσταση

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
// μέχρι να αναβαθμιστούν, οπότε ΟΛΕΣ οι ροές αναφοράς (report-version-issue,
// report-problem, report-crash) απλά θα αποτυγχάνουν σιωπηλά γι' αυτές
// μέχρι την αναβάθμιση.
function _loadGithubToken() {
  try {
    const raw = fs.readFileSync(path.join(appRootDir, 'github-token.json'), 'utf-8');
    return JSON.parse(raw).token || null;
  } catch(e) {
    return null;
  }
}

// Δημιουργεί GitHub issue (όχι αλλαγή αρχείου) — reused από
// report-version-issue (update-check.js) ΚΑΙ από το report-problem εδώ.
export async function createGithubIssue(title, body) {
  const token = _loadGithubToken();
  if (!token) return { ok: false, error: 'Η αναφορά δεν είναι διαθέσιμη σε αυτή την εγκατάσταση' };
  try {
    const payload = JSON.stringify({ title, body });
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
}

function _logPath() {
  return path.join(app.getPath('userData'), 'logs', 'main.log');
}

function _logTail(maxBytes = 20000) {
  try {
    const p = _logPath();
    const stat = fs.statSync(p);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf-8');
  } catch (e) {
    return '(δεν βρέθηκε log αρχείο)';
  }
}

export async function sendProblemReport({ description, isAutoCrash }) {
  const version  = app.getVersion();
  const hostname = os.hostname() || 'άγνωστο';
  const tail     = _logTail();
  const title = isAutoCrash
    ? `[Auto crash report] v${version} — ${hostname}`
    : `[Αναφορά προβλήματος] v${version} — ${hostname}`;
  const body = [
    `**Έκδοση:** v${version}`,
    `**Μηχάνημα:** ${hostname}`,
    '',
    '**Περιγραφή:**',
    description || '(καμία περιγραφή)',
    '',
    '**Τελευταίες γραμμές log:**',
    '```',
    tail,
    '```',
  ].join('\n');

  const results = { github: null, email: null };

  results.github = await createGithubIssue(title, body).catch(e => ({ ok: false, error: e.message }));

  try {
    const smtpConfig = await _pyCallMain('get_smtp_config', []);
    if (smtpConfig?.host && smtpConfig?.user) {
      results.email = await sendEmail(smtpConfig, { to: DEV_EMAIL, subject: title, body });
    } else {
      results.email = { success: false, error: 'SMTP μη ρυθμισμένο' };
    }
  } catch (e) {
    results.email = { success: false, error: e.message };
  }

  return results;
}

// --- Ανίχνευση crash προηγούμενης εκτέλεσης ---
const SHUTDOWN_MARKER = '[Shutdown] Καθαρός τερματισμός';
const FATAL_MARKER     = '[FATAL]';

export function markCleanShutdown() {
  console.log(SHUTDOWN_MARKER);
}

export function detectPreviousCrash() {
  try {
    const content = fs.readFileSync(_logPath(), 'utf-8');
    const lastFatal    = content.lastIndexOf(FATAL_MARKER);
    if (lastFatal === -1) return { crashed: false, tail: '' };
    const lastShutdown = content.lastIndexOf(SHUTDOWN_MARKER);
    const crashed = lastShutdown < lastFatal;
    return { crashed, tail: crashed ? content.slice(Math.max(0, lastFatal - 2000)) : '' };
  } catch (e) {
    return { crashed: false, tail: '' };
  }
}

ipcMain.handle('report-problem', async (event, description) =>
  sendProblemReport({ description, isAutoCrash: false })
);

ipcMain.handle('report-crash', async () =>
  sendProblemReport({ description: 'Αυτόματη αναφορά — η προηγούμενη εκτέλεση τερμάτισε απροσδόκητα.', isAutoCrash: true })
);
