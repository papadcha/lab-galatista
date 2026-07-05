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
  state.pyProcess = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', LAB_DB_PATH: labDbPath },
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
    state.pyPending.set(id, resolve);
    try { state.pyProcess.stdin.write(req); }
    catch(e) { state.pyPending.delete(id); resolve({ ok: false, error: e.message }); }
    setTimeout(() => {
      if (state.pyPending.has(id)) { state.pyPending.delete(id); resolve({ ok: false, error: 'timeout' }); }
    }, timeoutMs);
  });
}

// Helper για κλήση Python από main process
export function callPython(method, args = [], timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!state.pyProcess) { resolve({ error: 'Python δεν τρέχει' }); return; }
    const id      = ++state.pyReqId;
    const request = JSON.stringify({ method, args, id }) + '\n';
    state.pyPending.set(id, resolve);
    state.pyProcess.stdin.write(request);
    setTimeout(() => {
      if (state.pyPending.has(id)) {
        state.pyPending.delete(id);
        resolve({ error: 'Timeout' });
      }
    }, timeoutMs);
  });
}

// Renderer queries this on startup to handle the race where Python was
// ready before DOM loaded
ipcMain.handle('python-is-ready', () => state.pythonReady);

ipcMain.handle('py-call', async (event, method, ...args) => {
  if (!state.pyProcess) return { error: 'Python backend δεν τρέχει' };
  return new Promise((resolve) => {
    const id      = ++state.pyReqId;
    const request = JSON.stringify({ method, args, id }) + '\n';
    state.pyPending.set(id, (result) => resolve(result));
    state.pyProcess.stdin.write(request);
    setTimeout(() => {
      if (state.pyPending.has(id)) {
        state.pyPending.delete(id);
        resolve({ error: 'Timeout — το Python δεν απάντησε' });
      }
    }, 10000);
  });
});
