// Python backend: εκκίνηση της child process, JSON-RPC-over-stdio
// επικοινωνία, και ο γενικός 'py-call' IPC δίαυλος προς το frontend.
// Εξάγει τη λειτουργικότητα — η ίδια η κατάσταση (pyProcess, pyPending
// κλπ) ζει στο state.js, αφού αρκετός κώδικας αλλού στο main.js ακόμα
// την αγγίζει άμεσα (θα καθαρίσει πλήρως σε επόμενο βήμα modularization).
import { ipcMain, app } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { state } from './state.js';

// Περιμένει το σήμα "Αναμονή εντολών" από τον Python backend αντί για
// αυθαίρετο delay· αν δεν έρθει εγκαίρως, προχωράμε ούτως ή άλλως (timeout
// ίδιο με το splash fallback, main-app.js).
export function waitForPythonReady(timeoutMs = 15000) {
  if (state.pythonReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    state.pyReadyWaiters.push(() => { clearTimeout(timer); resolve(true); });
  });
}

// appRootDir: ο φάκελος του main.js (πριν το ESM redesign ήταν __dirname
// μέσα σε αυτή την ίδια συνάρτηση — τώρα περνιέται ρητά, αφού αυτό το
// αρχείο ζει σε υποφάκελο modules/ και το δικό του __dirname θα ήταν λάθος).
export function startPythonBackend(appRootDir) {
  let cmd, args, cwd;

  if (app.isPackaged) {
    // Production: χρησιμοποιεί bundled PyInstaller exe
    const backendDir = path.join(process.resourcesPath, 'lab-backend');
    cmd  = path.join(backendDir, 'lab-backend.exe');
    args = [];
    cwd  = backendDir;
  } else {
    // Development: χρησιμοποιεί system Python
    const scriptPath = path.join(appRootDir, 'backend', 'server.py');
    cmd  = process.platform === 'win32' ? 'python' : 'python3';
    args = ['-u', scriptPath];
    cwd  = appRootDir;
  }

  // Η βάση αποθηκεύεται στο userData (εγγράψιμο και για non-admin users)
  const labDbPath = path.join(app.getPath('userData'), 'laboratory.db');
  // Ίδιος φάκελος logs/ με το Electron-side main.log (modules/logger.js) —
  // ένα σημείο για τον χειριστή να ψάξει και τα δύο post-mortem.
  const labLogDir = path.join(app.getPath('userData'), 'logs');
  state.pyProcess = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', LAB_DB_PATH: labDbPath, LAB_LOG_DIR: labLogDir },
  });

  // Κεντρικός stdout listener — routing με ID
  let _pyBuf = '';
  state.pyProcess.stdout.on('data', (data) => {
    _pyBuf += data.toString();
    const lines = _pyBuf.split('\n');
    _pyBuf = lines.pop();  // κρατάμε το ημιτελές
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('{')) {
        console.log(`[Python] ${t}`);
        // Ειδοποίηση renderer όταν ο Python είναι έτοιμος
        if (t.includes('Αναμονή εντολών')) {
          state.pythonReady = true;
          state.mainWindow?.webContents.send('python-ready');
          for (const notify of state.pyReadyWaiters.splice(0)) notify();
          _loadRendererMethods(); // προ-φόρτωση whitelist, βλ. py-call handler
        }
        continue;
      }
      try {
        const parsed = JSON.parse(t);
        const id = parsed.id;
        if (id !== undefined && state.pyPending.has(id)) {
          const resolve = state.pyPending.get(id);
          state.pyPending.delete(id);
          // Επιστρέφουμε το result (ή ολόκληρο το parsed αν δεν έχει result)
          resolve(parsed.result !== undefined ? parsed.result : parsed);
        } else {
          console.log(`[Python] ${t}`);
        }
      } catch {
        console.log(`[Python] ${t}`);
      }
    }
  });

  state.pyProcess.stderr.on('data', (data) => {
    console.error(`[Python Error] ${data.toString().trim()}`);
  });

  state.pyProcess.on('close', (code) => {
    console.log(`[Python] Έκλεισε με κωδικό: ${code}`);
    // Απορρίπτουμε όλα τα εκκρεμή requests
    for (const [id, resolve] of state.pyPending) {
      resolve({ error: 'Python process terminated' });
    }
    state.pyPending.clear();
  });

  return state.pyProcess;
}

export async function _pyCallMain(method, args = [], timeoutMs = 15000) {
  return new Promise((resolve) => {
    const id  = method + '-' + Date.now();
    const req = JSON.stringify({ method, args, id }) + '\n';
    const timer = setTimeout(() => {
      if (state.pyPending.has(id)) { state.pyPending.delete(id); resolve({ ok: false, error: 'timeout' }); }
    }, timeoutMs);
    state.pyPending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    try { state.pyProcess.stdin.write(req); }
    catch(e) { state.pyPending.delete(id); clearTimeout(timer); resolve({ ok: false, error: e.message }); }
  });
}

// Helper για κλήση Python από main process
export function callPython(method, args = [], timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!state.pyProcess) { resolve({ error: 'Python δεν τρέχει' }); return; }
    const id      = ++state.pyReqId;
    const request = JSON.stringify({ method, args, id }) + '\n';
    const timer = setTimeout(() => {
      if (state.pyPending.has(id)) {
        state.pyPending.delete(id);
        resolve({ error: 'Timeout' });
      }
    }, timeoutMs);
    state.pyPending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    state.pyProcess.stdin.write(request);
  });
}

// Renderer queries this on startup to handle the race where Python was
// ready before DOM loaded
ipcMain.handle('python-is-ready', () => state.pythonReady);

// Whitelist των μεθόδων που επιτρέπεται να καλέσει το renderer μέσω
// 'py-call' — auto-derived από το ίδιο το Python (backend/server.py's
// RENDERER_METHODS), όχι hand-maintained αντίγραφο εδώ που θα μπορούσε να
// ξεμείνει πίσω. Defense-in-depth: το window.pyBridge.call() είναι
// εκτεθειμένο στο main world (contextBridge) και δέχεται οποιοδήποτε
// method string — χωρίς αυτόν τον έλεγχο, ένα μελλοντικό XSS θα μπορούσε
// να καλέσει ΟΠΟΙΑΔΗΠΟΤΕ μέθοδο της Python (π.χ. vacuum_into, clean_start,
// switch_db, restore_db), όχι μόνο όσες πραγματικά χρησιμοποιεί το UI.
let _rendererMethodsPromise = null;
function _loadRendererMethods() {
  if (!_rendererMethodsPromise) {
    _rendererMethodsPromise = callPython('list_renderer_methods', []).then((result) => {
      if (Array.isArray(result)) return new Set(result);
      console.error('[py-call] Αποτυχία φόρτωσης renderer methods whitelist:', result);
      return new Set(); // fail-closed — τίποτα δεν επιτρέπεται αν η φόρτωση αποτύχει
    });
  }
  return _rendererMethodsPromise;
}

ipcMain.handle('py-call', async (event, method, ...args) => {
  const allowed = await _loadRendererMethods();
  if (!allowed.has(method)) {
    console.error(`[py-call] Μπλοκαρίστηκε μη επιτρεπόμενη μέθοδος: ${method}`);
    return { error: `Μη επιτρεπόμενη μέθοδος: ${method}` };
  }
  if (!state.pyProcess) return { error: 'Python backend δεν τρέχει' };
  return new Promise((resolve) => {
    const id      = ++state.pyReqId;
    const request = JSON.stringify({ method, args, id }) + '\n';
    const timer = setTimeout(() => {
      if (state.pyPending.has(id)) {
        state.pyPending.delete(id);
        resolve({ error: 'Timeout — το Python δεν απάντησε' });
      }
    }, 10000);
    state.pyPending.set(id, (result) => { clearTimeout(timer); resolve(result); });
    state.pyProcess.stdin.write(request);
  });
});
