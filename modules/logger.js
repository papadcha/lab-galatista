// Persistent rotating log file για το main process. Σε packaged build δεν
// υπάρχει terminal να δει κανείς τα console.log/error — χωρίς αυτό, ένα
// crash δεν αφήνει κανένα ίχνος για post-mortem. Το initLogger() κάνει
// monkey-patch τα console.log/warn/error ώστε ΚΑΘΕ κλήση τους (και οι ήδη
// υπάρχουσες, σε main.js και σε όλα τα modules/*.js — άρα και τα
// forwarded [Python]/[Python Error] logs) να γράφονται επιπλέον σε αρχείο,
// χωρίς να χρειάζεται να αλλάξει κάθε μεμονωμένο call site.
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5MB — μετά rotation σε .old (1 αντίγραφο)

function _logDir() {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function _fmt(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch(e) { return String(a); }
}

export function initLogger() {
  const logPath = path.join(_logDir(), 'main.log');

  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_BYTES) {
      const rotatedPath = logPath + '.old';
      try { fs.unlinkSync(rotatedPath); } catch(e) {}
      fs.renameSync(logPath, rotatedPath);
    }
  } catch(e) {}

  const stream = fs.createWriteStream(logPath, { flags: 'a' });

  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      try {
        const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${args.map(_fmt).join(' ')}\n`;
        stream.write(line);
      } catch(e) {}
    };
  }

  // Χωρίς αυτά, ένα uncaught exception/rejection στο main process σκοτώνει
  // την εφαρμογή αθόρυβα (τίποτα στο log) — τα καταγράφουμε πρώτα και μετά
  // τερματίζουμε ρητά, διατηρώντας την ίδια crash-συμπεριφορά με πριν.
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled rejection:', reason);
    process.exit(1);
  });

  return logPath;
}
