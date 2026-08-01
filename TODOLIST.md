# ΕΡΓΑΣΤΗΡΙΟ ΓΑΛΑΤΙΣΤΑΣ — ΕΚΚΡΕΜΟΤΗΤΕΣ (TO-DO)

Τελευταία ενημέρωση: 2026-08-01 (presence detection υλοποιήθηκε και εδώ, μετά το expvault — εκκρεμεί ακόμα στο invoicebook)
Το ιστορικό εκδόσεων ζει σε ξεχωριστό αρχείο: `VERSIONS.md`
(bundled μέσα στην ίδια την εφαρμογή — βλ. εκεί). Το τεχνικό ιστορικό
του ESM redesign ζει στο `CHANGELOG-v2.md`. Οι διορθώσεις της v1.x
ζωντανεύουν πλέον στο branch `v1-maintenance` (κλαδεύτηκε από το master
πριν το merge), όχι εδώ.

---

## ΕΚΚΡΕΜΕΙ ΕΠΙΒΕΒΑΙΩΣΗ

- [ ] Ζωντανή δοκιμή dual-install migration v1.1.33 → v2.3.0 — οδηγός
      στο `C:\Users\papadcha\Downloads\Odigies-Dipli-Egkatastasi-v1-v2.md`
      (εκτός repo). Περιγράφει παράλληλη εγκατάσταση + μεταφορά
      `laboratory.db`. Βρέθηκε 2026-07-24 ότι το `config.json` δεν
      αντιγράφεται μαζί με τη βάση, οπότε η v2.3.0 δείχνει προειδοποίηση
      "Ο φάκελος δεδομένων φαίνεται ξεπερασμένος" (`checkDataFolderMismatch`,
      `modules/ce-period.js`) μέχρι να συγχρονιστεί χειροκίνητα το
      "Φάκελος Δεδομένων" στις Ρυθμίσεις. Προστέθηκε ως βήμα 8 στον
      οδηγό, αλλά όλο το migration path δεν έχει δοκιμαστεί ζωντανά
      ακόμα σε πραγματικό restore.

- [ ] Εναλλακτική εξεταζόμενη: μετακόμιση (όχι αντιγραφή) του παλιού
      φακέλου δεδομένων της v1.1.33 κάτω από τη δομή του νέου
      προγράμματος (v2.3.0), αντί να μείνει στην παλιά του θέση. Αυτό
      **δεν λύνεται με απλή αντιγραφή αρχείων** — το `data_folder` της
      ενεργής CE period μέσα στη βάση θα συνεχίσει να δείχνει την παλιά
      διεύθυνση, και δεν υπάρχει σήμερα UI στις Ρυθμίσεις για αλλαγή
      του `data_folder` σε ήδη-ενεργή period (μόνο κατά τη δημιουργία
      νέας). Θα χρειαστεί μετακίνηση αρχείων + χειροκίνητη ενημέρωση
      εγγραφής στη βάση, με κλειστή την εφαρμογή. Προς το παρόν
      προτείνεται η απλή λύση (σημείο στον υπάρχοντα παλιό φάκελο) εκτός
      αν ζητηθεί ρητά η μετακόμιση.

## ROADMAP — ΕΓΚΕΚΡΙΜΕΝΑ ΓΙΑ ΤΟ ΜΕΛΛΟΝ (όχι τρέχουσα φάση)

Προτάθηκαν 2026-07-02, ο χρήστης επιβεβαίωσε ότι θα χρειαστούν
τελικά — καταγράφονται εδώ ώστε να μη χαθούν:

- [ ] Διακρίβωση εξοπλισμού (κόσκινα, ζυγαριές) — διαπιστευμένο
      εργαστήριο (CE) χρειάζεται παρακολούθηση λήξης διακρίβωσης ανά
      όργανο. Θα μπορούσε να επαναχρησιμοποιήσει το ήδη δοκιμασμένο
      πρότυπο λήξης CE period (checkCeExpiryAndNotify, main.js) — νέος
      πίνακας με ημερομηνία λήξης ανά όργανο + ίδιο notification/badge.

- [ ] Σύγκριση ανάμεσα σε υποπεριόδους — δείχνει πώς άλλαξε η ποιότητα
      ενός προϊόντος (Μ.Ο. MB/SE/FI/κοκκομετρία) ανάμεσα σε δύο
      υποπεριόδους δίπλα-δίπλα, όχι μόνο σύγκριση με τη δηλωμένη τιμή
      όπως κάνει σήμερα η Περιοδική Αναφορά. Θα ξαναχρησιμοποιούσε την
      υποδομή του v1.1.13/v1.1.14 (get_effective_specifications κ.λπ.).

- [ ] Γράφημα τάσης στον χρόνο (trend chart) — line chart MB/SE/FI ενός
      προϊόντος σε πολλαπλές υποπεριόδους μαζί (π.χ. τελευταίοι 6-12
      μήνες), πιάνει σταδιακή ολίσθηση ποιότητας. Ο χρήστης το
      χαρακτήρισε "υπερβολή" προς το παρόν — χαμηλή προτεραιότητα.

- [ ] Language switcher — η υποδομή έγινε 2026-07-08 (dropdown στις
      Ρυθμίσεις `#lab-locale`/`SettingsPage.saveLocale()`, αποθήκευση
      στο `get-config`/`set-config`, `initI18n(savedLocale)` στο
      `main-app.js` αντί για hardcoded `'el'` — επαληθεύτηκε ζωντανά με
      Playwright `_electron`). Μένει μόνο ένα 2ο locale ώστε το dropdown
      να έχει πραγματικό νόημα: νέο `src/i18n/<locale>.json` + μία
      ακόμα `<option>` στο `settings.html`, καμία άλλη συρματολόγηση.

- [x] **expvault** — υλοποιήθηκε 2026-08-01 (`backend/presence.py`, branch
      `v2`), προσαρμοσμένο στο pattern του `backup.py` εκεί (rclone μόνο από
      Python backend, όχι από τη JS main process όπως εδώ). Heartbeat
      key `<computer>__<user>.json` (όχι μόνο hostname, ώστε δύο μηχανήματα
      με ίδιο default hostname να μην αλληλοεπικαλύπτονται) στο
      `<remote>/presence/`.
- [x] **lab-galatista** — υλοποιήθηκε 2026-08-01 (`modules/presence.js`,
      νέος IPC handler `presence-list` στο `preload.cjs`, heartbeat interval
      στο `main.js`, UI στο Settings → Storage tab). Κλέβει το pattern του
      `backend/presence.py` του expvault (heartbeat key
      `<computer>__<user>.json`, main-process-only `sendHeartbeat()` — όχι
      εκτεθειμένο ως IPC), προσαρμοσμένο στο εδώ JS-only rclone μοτίβο
      (`runRclone()`/`isNetworkError()` από το `modules/cloud-sync.js`, ίδιο
      manifest-merge σχήμα με `sync-document-library`). Presence μοιράζεται
      το ίδιο `cloudRemotePath` config κλειδί με το cloud sync, οπότε
      εξαρτάται από το ίδιο βήμα 1 (rclone εγκατεστημένο) — δεν προστέθηκε
      νέο UI ρύθμισης remote.
- [ ] **invoicebook** — εκκρεμεί ακόμα. Presence detection μέσω MEGA/rclone
      sync — κάθε client (πολλαπλά μηχανήματα του ίδιου χρήστη) γράφει
      periodic heartbeat (`presence.json`: user, last_seen, computer) στο
      ίδιο MEGA remote που ήδη χρησιμοποιείται για DB backup/sync. Sync
      στην εκκίνηση + κάθε 1-2 λεπτά όσο τρέχει η εφαρμογή. UI: "● online"
      αν `last_seen` < 2 λεπτά, αλλιώς "τελευταία σύνδεση: πριν Χ". Τώρα
      υπάρχουν δύο reference υλοποιήσεις (expvault: Python backend,
      lab-galatista: JS main process) — για invoicebook μένει να επιλεγεί
      ποιο pattern ταιριάζει ανάλογα με την αρχιτεκτονική του.

## ΜΕΓΑΛΕΣ / ΑΝΑΒΛΗΘΗΚΑΝ

- [ ] Linux installer (AppImage/deb, χρειάζεται Linux build env/CI)
