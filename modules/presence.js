// Presence detection πάνω στο ίδιο rclone remote που ήδη χρησιμοποιείται για
// cloud sync (modules/cloud-sync.js) — κάθε εγκατάσταση γράφει periodic
// heartbeat, το presence-list IPC τα συγχωνεύει σε μία λίστα online/offline
// για το Settings UI. Ίδιο manifest-merge pattern με sync-document-library
// (cloud-sync.js): κάθε client γράφει το δικό του αρχείο, ένα rclone copy
// φέρνει όλα τα αρχεία τοπικά, συγχώνευση με τοπικό JSON read.
//
// sendHeartbeat() ΔΕΝ εκτίθεται ως ipcMain.handle — καλείται μόνο από το
// main.js interval, ποτέ απευθείας από τον renderer (ίδια απόφαση με το
// backend/presence.py του expvault: το "ποιος γράφει heartbeat" δεν πρέπει
// να είναι ελεγχόμενο από τη σελίδα Ρυθμίσεων).
import { ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from './config.js';
import { runRclone, isNetworkError } from './cloud-sync.js';

const PRESENCE_SUBDIR = 'presence';

function sanitize(name) {
  return (name || '').replace(/[^A-Za-z0-9_-]/g, '_') || 'machine';
}

function identity() {
  const user = process.env.USERNAME || process.env.USER || os.userInfo().username || 'άγνωστος';
  const computer = os.hostname() || 'machine';
  return { user, computer };
}

function remoteDir() {
  const cfg = loadConfig();
  const remote = cfg.cloudRemotePath;
  if (!remote) return null;
  return `${remote.replace(/\/+$/, '')}/${PRESENCE_SUBDIR}`;
}

ipcMain.handle('presence-whoami', () => identity());

export async function sendHeartbeat() {
  const dir = remoteDir();
  if (!dir) return { ok: true, skipped: true, reason: 'no_remote_configured' };

  const { user, computer } = identity();
  const fileName = `${sanitize(computer)}__${sanitize(user)}.json`;
  const payload  = { user, computer, last_seen: new Date().toISOString() };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-galatista-presence-'));
  try {
    const tmpFile = path.join(tmpDir, fileName);
    fs.writeFileSync(tmpFile, JSON.stringify(payload), 'utf-8');
    const r = await runRclone(['copyto', tmpFile, `${dir}/${fileName}`], 30000);
    if (!r.ok && !isNetworkError(r.error)) {
      console.error('[Presence] heartbeat απέτυχε:', r.error);
    }
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

ipcMain.handle('presence-list', async () => {
  const dir = remoteDir();
  if (!dir) return [];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-galatista-presence-list-'));
  try {
    const r = await runRclone(['copy', dir, tmpDir, '--include', '*.json'], 60000);
    if (!r.ok) return []; // π.χ. presence/ δεν υπάρχει ακόμα — καμία εγκατάσταση δεν έχει
                           // στείλει heartbeat ποτέ — άδεια λίστα, όχι σφάλμα

    const result = [];
    for (const f of fs.readdirSync(tmpDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(tmpDir, f), 'utf-8'));
        if (data.user && data.last_seen) {
          result.push({ user: data.user, computer: data.computer || '', last_seen: data.last_seen });
        }
      } catch { /* αγνόησε κατεστραμμένο/μερικώς-γραμμένο αρχείο */ }
    }
    return result;
  } catch {
    return [];
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
