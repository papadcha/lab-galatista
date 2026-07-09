// Περιοδική ενημέρωση email: σύνοψη (νέα δείγματα, εκκρεμότητες, εκτός
// προδιαγραφών, λήξη CE) + συνημμένα PDF Περιοδικής Αναφοράς ανά προϊόν με
// δεδομένα στο διάστημα. Ελέγχεται στο startup (ίδιο pattern με
// modules/ce-period.js checkCeExpiryAndNotify), όχι live cron — αναξιόπιστο
// αν η εφαρμογή δεν μένει ανοιχτή. Το "πότε έφτασε η ώρα" κρίνεται από
// periodicEmailLastSentAt στο lab-config.json, όχι από wall-clock timer.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _pyCallMain } from './python-bridge.js';
import { loadConfig, saveConfig } from './config.js';
import { sendEmail } from './email.js';

function fmtGr(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function buildSummaryBody(newSampleCount, stats, ce, fromIso, toIso, attachmentCount) {
  const lines = [
    `Περιοδική ενημέρωση ΔAiγμα LiMS για το διάστημα ${fmtGr(fromIso)} – ${fmtGr(toIso)}.`,
    '',
    `Νέα δείγματα: ${newSampleCount}`,
    `Εκκρεμείς δοκιμές: ${stats.pending ?? '-'}`,
    `Εκτός προδιαγραφών: ${stats.fail ?? '-'}`,
  ];

  if (ce && ce.status && ce.status !== 'ok' && ce.days_left != null) {
    if (ce.status === 'expired') {
      lines.push(`CE περίοδος: ΕΧΕΙ ΛΗΞΕΙ (${fmtGr(ce.valid_to)})`);
    } else {
      lines.push(`CE περίοδος: λήγει σε ${ce.days_left} μέρες (${fmtGr(ce.valid_to)})`);
    }
  }

  lines.push('');
  lines.push(
    attachmentCount > 0
      ? `Συνημμένα: ${attachmentCount} PDF Περιοδικής Αναφοράς (ανά προϊόν με δεδομένα στο διάστημα).`
      : 'Δεν βρέθηκαν προϊόντα με δεδομένα για συνημμένη Περιοδική Αναφορά.'
  );

  return lines.join('\n');
}

export async function checkAndSendPeriodicEmail() {
  try {
    const cfg = loadConfig();
    if (!cfg.periodicEmailEnabled || !cfg.periodicEmailRecipient) return;

    const intervalDays = cfg.periodicEmailIntervalDays || 7;
    const last = cfg.periodicEmailLastSentAt;
    if (last) {
      const daysSince = (Date.now() - new Date(last).getTime()) / 86400000;
      if (daysSince < intervalDays) return; // δεν έφτασε ακόμα η ώρα
    }

    const fromIso = last
      ? last.slice(0, 10)
      : new Date(Date.now() - intervalDays * 86400000).toISOString().slice(0, 10);
    const toIso = new Date().toISOString().slice(0, 10);

    // search_samples(product_id, date_from, date_to, code, limit) — backend/server.py:800
    const newSamples = await _pyCallMain('search_samples', [null, fromIso, toIso, null, 1000]) || [];

    if (newSamples.length === 0) {
      // Καμία δραστηριότητα — προωθούμε το ρολόι ΧΩΡΙΣ αποστολή, ώστε να μη
      // σταλεί άδειο email, αλλά και να μη μεγαλώνει επ' άπειρον το παράθυρο.
      saveConfig({ ...loadConfig(), periodicEmailLastSentAt: new Date().toISOString() });
      return;
    }

    const stats = await _pyCallMain('get_dashboard_stats', []) || {};   // {pending, fail, ...}
    const ce    = await _pyCallMain('get_ce_expiry_status', []) || {};  // {status, days_left, valid_to}
    const smtpConfig = await _pyCallMain('get_smtp_config', []);
    if (!smtpConfig?.host || !smtpConfig?.user) {
      console.warn('[PeriodicEmail] SMTP μη ρυθμισμένο, παράλειψη — δοκιμή ξανά στο επόμενο άνοιγμα');
      return; // ΔΕΝ προωθούμε το ρολόι, να ξαναδοκιμάσει
    }

    // Ένα PDF Περιοδικής Αναφοράς ανά ενεργό προϊόν με δεδομένα στο διάστημα.
    // generate_periodic_pdf ήδη επιστρέφει success:false όταν δεν βρεθούν
    // δείγματα για το προϊόν — απλά το αγνοούμε (όχι σφάλμα).
    const products    = await _pyCallMain('get_products', []) || [];
    const attachments = [];
    for (const p of products) {
      const outPath = path.join(os.tmpdir(), `periodic_email_${p.id}_${Date.now()}.pdf`);
      const pdf = await _pyCallMain(
        'generate_periodic_pdf', [p.id, fromIso, toIso, null, outPath], 60000
      );
      if (pdf?.success) {
        const safeName = (p.name || `product_${p.id}`).replace(/[\\/?%*:|"<>\s]/g, '_');
        attachments.push({ filename: `Periodiki_Anafora_${safeName}_${fromIso}_${toIso}.pdf`, path: pdf.path });
      }
    }

    const result = await sendEmail(smtpConfig, {
      to:      cfg.periodicEmailRecipient,
      subject: `Περιοδική Ενημέρωση ΔAiγμα LiMS (${fmtGr(fromIso)} – ${fmtGr(toIso)})`,
      body:    buildSummaryBody(newSamples.length, stats, ce, fromIso, toIso, attachments.length),
      attachments,
    });

    // Best-effort καθαρισμός των προσωρινών PDF από το os.tmpdir(), σε κάθε
    // περίπτωση (επιτυχία ή αποτυχία αποστολής) — δεν χρειάζονται πλέον.
    for (const a of attachments) {
      fs.promises.unlink(a.path).catch(() => {});
    }

    if (result.success) {
      saveConfig({ ...loadConfig(), periodicEmailLastSentAt: new Date().toISOString() });
    } else {
      console.error('[PeriodicEmail] Αποτυχία αποστολής:', result.error); // δεν προωθούμε το ρολόι
    }
  } catch (e) {
    console.error('[PeriodicEmail] Σφάλμα:', e.message);
  }
}
