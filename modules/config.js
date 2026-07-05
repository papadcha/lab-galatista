// Config (lab-config.json) + φάκελος δεδομένων + backup της βάσης.
// Ένα module, όπως ήταν ήδη μία ενότητα στο main.js πριν το modularization
// ("CONFIG — Φάκελος δεδομένων + Backup") — παραμένουν μαζί γιατί το
// backup εξαρτάται στενά από τα path helpers παρακάτω.
import { app, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { state } from './state.js';
import { _pyCallMain } from './python-bridge.js';

let _configPath = null;
export function getConfigPath() {
  if (!_configPath) _configPath = path.join(app.getPath('userData'), 'lab-config.json');
  return _configPath;
}

export function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch(e) {
    console.error('[Config] Σφάλμα ανάγνωσης, το αρχείο πιθανώς είναι κατεστραμμένο:', e.message);
    try {
      const corruptedPath = `${configPath}.corrupted-${Date.now()}`;
      fs.copyFileSync(configPath, corruptedPath);
      console.error('[Config] Αντίγραφο του κατεστραμμένου αρχείου αποθηκεύτηκε:', corruptedPath);
    } catch(e2) {}
  }
  return {};
}

export function saveConfig(cfg) {
  try {
    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('[Config] Αποθηκεύτηκε:', configPath, cfg);
    return true;
  } catch(e) {
    console.error('[Config] Σφάλμα αποθήκευσης:', e.message);
    return false;
  }
}

// Βοηθητικές για δομή φακέλου
export function getDataFolder() {
  const cfg = loadConfig();
  // Archive mode: χρησιμοποιεί τον φάκελο της αρχειοθετημένης περιόδου
  if (state.archiveMode && state.archiveDataFolder) return state.archiveDataFolder;
  if (cfg.archiveDataFolder)                        return cfg.archiveDataFolder;
  return cfg.dataFolder || null;
}

// Καθαρισμός segment πριν μπει σε path.join — π.χ. ο κωδικός δείγματος
// περιέχει πάντα "/" από το εύρος κόκκου (π.χ. "ΑΜΜ0/4"), που το Windows/Node
// το διαβάζει σαν directory separator αν περάσει ακαθάριστο σε filename.
export function _sanitizeFsSegment(s) {
  return String(s).replace(/[/\\?%*:|"<>]/g, '-').trim();
}

export function getPdfPath(productFolder, fileName, subperiodFolder = null) {
  // productFolder: πχ "ΑΜΜ0-4" ή "3Α0-31.5"
  // subperiodFolder: πχ "UP1" αν pdf_subfolder=true, αλλιώς null
  const base = getDataFolder();
  if (!base) return null;
  const safe = _sanitizeFsSegment(productFolder || 'ΑΛΛΟ');
  const dir  = subperiodFolder
    ? path.join(base, 'pdf', subperiodFolder, safe)
    : path.join(base, 'pdf', safe);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, _sanitizeFsSegment(fileName));
}

export function getStatisticsPath(fileName) {
  const base = getDataFolder();
  if (!base) return null;
  const dir = path.join(base, 'statistics');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, _sanitizeFsSegment(fileName));
}

export function getBackupPath() {
  const base = getDataFolder();
  if (!base) return null;
  const year = new Date().getFullYear().toString();
  const dir  = path.join(base, 'backup', year);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Εύρεση βάσης δεδομένων
export function getDbPath() {
  // Ίδιος υπολογισμός με το LAB_DB_PATH που δίνεται στο Python backend
  // (startPythonBackend) — έτσι backup/restore αγγίζουν πάντα το ΙΔΙΟ
  // αρχείο που διαβάζει/γράφει η ζωντανή εφαρμογή. Παλιότερα εδώ υπήρχε
  // λίστα από candidate paths δίπλα στο __dirname (πριν το v1.0.4, όταν η
  // βάση ζούσε δίπλα στην εφαρμογή) — σε dev mode ένα stale τέτοιο αρχείο
  // μπορούσε να "κερδίσει" έναντι του πραγματικού userData path.
  const dbPath = path.join(app.getPath('userData'), 'laboratory.db');
  if (fs.existsSync(dbPath)) {
    console.log('[Backup] Βρέθηκε DB:', dbPath);
    return dbPath;
  }
  console.error('[Backup] Δεν βρέθηκε βάση δεδομένων στο:', dbPath);
  return null;
}

// Backup βάσης
function getPeriodStartStamp() {
  // Διαβάζει την ημερομηνία έναρξης της ενεργής υποπεριόδου από config
  // (αποθηκεύεται κατά τη δημιουργία υποπεριόδου)
  const cfg = loadConfig();
  const d = cfg.activePeriodStart;
  if (!d) return '00000000';
  // Μετατροπή DD/MM/YYYY ή YYYY-MM-DD → YYYYMMDD
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.replace(/-/g, '').substring(0, 8);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(d)) {
    const [day, mon, yr] = d.split('/');
    return `${yr}${mon}${day}`;
  }
  return '00000000';
}

function _fileHash(filePath) {
  return new Promise((resolve) => {
    try {
      const hash   = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data',  (chunk) => hash.update(chunk));
      stream.on('end',   () => resolve(hash.digest('hex')));
      stream.on('error', () => resolve(null));
    } catch(e) {
      resolve(null);
    }
  });
}

function _latestBackupFile(backupDir, final) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db') && f.includes('_FINAL') === final)
      .map(f => ({ path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.path || null;
  } catch(e) {
    return null;
  }
}

export async function performBackup(final = false) {
  const dbPath    = getDbPath();
  const backupDir = getBackupPath();
  if (!dbPath || !backupDir) return { success: false, reason: 'no_folder' };

  const dest    = path.join(backupDir, _buildBackupName(final));
  const tmpDest = dest + '.tmp';

  try {
    // VACUUM INTO παίρνει συνεπές snapshot της τρέχουσας λογικής κατάστασης
    // της DB (μαζί με commits που βρίσκονται ακόμα στο -wal), σε αντίθεση
    // με ωμό αντίγραφο αρχείου που μπορεί να είναι stale.
    const vacuumResult = await _pyCallMain('vacuum_into', [tmpDest], 30000);
    if (!vacuumResult?.ok) fs.copyFileSync(dbPath, tmpDest);

    // Επαλήθευση ότι το φρέσκο backup είναι πραγματικά μια έγκυρη, μη
    // κατεστραμμένη βάση δεδομένων — πριν το εμπιστευτούμε ως backup.
    const integrity = await _pyCallMain('check_db_integrity', [tmpDest], 30000);
    if (!integrity?.ok) {
      fs.unlinkSync(tmpDest);
      return { success: false, error: 'Το backup απέτυχε τον έλεγχο ακεραιότητας: ' + (integrity?.result || integrity?.error || 'άγνωστο σφάλμα') };
    }

    // Αν το περιεχόμενο είναι ίδιο με το πιο πρόσφατο backup του ίδιου τύπου
    // (final/non-final), δεν κρατάμε διπλότυπο — άσχετα από ημέρα/ώρα.
    const latest = _latestBackupFile(backupDir, final);
    if (latest && (await _fileHash(latest)) === (await _fileHash(tmpDest))) {
      fs.unlinkSync(tmpDest);
      return { success: true, path: latest, skipped: true };
    }

    fs.renameSync(tmpDest, dest);
    if (!final) _pruneBackups(backupDir, 7);
    return { success: true, path: dest };
  } catch(e) {
    try { fs.unlinkSync(tmpDest); } catch(e2) {}
    return { success: false, error: e.message };
  }
}

function _buildBackupName(final = false) {
  const now        = new Date();
  const todayStamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const periodStamp = getPeriodStartStamp();
  if (final) return `lab_${periodStamp}_${todayStamp}_FINAL.db`;
  const timeStamp = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  return `lab_${periodStamp}_${todayStamp}_${timeStamp}.db`;
}

function _pruneBackups(backupDir, keep = 7) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db') && !f.includes('_FINAL'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // νεότερα πρώτα
    for (const f of files.slice(keep)) {
      fs.unlinkSync(path.join(backupDir, f.name));
    }
  } catch(e) {
    console.warn('[Backup] Prune warning:', e.message);
  }
}

// IPC: Get/Set config
ipcMain.handle('get-config', async () => {
  return loadConfig();
});

ipcMain.handle('set-config', async (event, updates) => {
  const cfg = { ...loadConfig(), ...updates };
  return { success: saveConfig(cfg) };
});

// IPC: Επιλογή φακέλου δεδομένων
ipcMain.handle('select-data-folder', async () => {
  const result = await dialog.showOpenDialog(state.mainWindow, {
    title:      'Επιλογή Φακέλου Δεδομένων',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return { success: false, canceled: true };
  const folder = result.filePaths[0];
  // Δημιουργία δομής
  fs.mkdirSync(path.join(folder, 'pdf'),    { recursive: true });
  fs.mkdirSync(path.join(folder, 'backup'), { recursive: true });
  // Αποθήκευση
  const cfg = { ...loadConfig(), dataFolder: folder };
  saveConfig(cfg);
  return { success: true, folder };
});

// IPC: Χειροκίνητο backup
ipcMain.handle('backup-database', async () => {
  return performBackup();
});

// IPC: FINAL backup (αλλαγή υποπεριόδου)
ipcMain.handle('backup-database-final', async () => {
  return performBackup(true);
});

// IPC: Λίστα τελευταίων 5 backup αρχείων
ipcMain.handle('list-backups', async () => {
  const dataFolder = getDataFolder();
  if (!dataFolder) return { ok: false, files: [] };
  const backupRoot = path.join(dataFolder, 'backup');
  if (!fs.existsSync(backupRoot)) return { ok: true, files: [] };

  const files = [];
  async function scanDir(dir) {
    try {
      for (const name of await fs.promises.readdir(dir)) {
        const full = path.join(dir, name);
        const stat = await fs.promises.stat(full);
        if (stat.isDirectory()) { await scanDir(full); }
        else if (name.endsWith('.db')) {
          files.push({ name, path: full, size: stat.size, mtime: stat.mtimeMs });
        }
      }
    } catch(e) {}
  }
  await scanDir(backupRoot);
  files.sort((a, b) => b.mtime - a.mtime);
  return { ok: true, files: files.slice(0, 5) };
});

// IPC: Επιλογή αρχείου backup μέσω dialog
ipcMain.handle('select-backup-file', async () => {
  const result = await dialog.showOpenDialog(state.mainWindow, {
    title:   'Επιλογή αρχείου backup',
    properties: ['openFile'],
    filters: [{ name: 'Βάση Δεδομένων', extensions: ['db'] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  const fp   = result.filePaths[0];
  const stat = fs.statSync(fp);
  return { ok: true, path: fp, name: path.basename(fp), size: stat.size };
});

// IPC: Επαναφορά βάσης από backup
ipcMain.handle('restore-backup', async (event, backupPath) => {
  try {
    const dbPath = getDbPath();
    if (!dbPath)                      return { ok: false, error: 'Δεν βρέθηκε βάση δεδομένων' };
    if (!fs.existsSync(backupPath))   return { ok: false, error: 'Το αρχείο backup δεν βρέθηκε' };

    // 1. Auto-backup της τρέχουσας βάσης πριν αντικατασταθεί
    const dataFolder = getDataFolder();
    if (dataFolder) {
      const backupDir = path.join(dataFolder, 'backup');
      fs.mkdirSync(backupDir, { recursive: true });
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
      fs.copyFileSync(dbPath, path.join(backupDir, `lab_pre_restore_${stamp}.db`));
    }

    // 2. Διαγραφή WAL/SHM για καθαρή επαναφορά
    for (const ext of ['-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + ext); } catch(e) {}
    }

    // 3. Αντικατάσταση με το επιλεγμένο backup
    fs.copyFileSync(backupPath, dbPath);

    // 4. Επανεκκίνηση
    setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// IPC: Get data folder
ipcMain.handle('get-data-folder', async () => {
  const folder = getDataFolder();
  console.log('[Config] get-data-folder:', folder, 'configPath:', getConfigPath());
  return { folder };
});
