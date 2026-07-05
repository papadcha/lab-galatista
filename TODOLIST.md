# ΕΡΓΑΣΤΗΡΙΟ ΓΑΛΑΤΙΣΤΑΣ — ΕΚΚΡΕΜΟΤΗΤΕΣ (TO-DO)

Τελευταία ενημέρωση: 2026-07-06 (ESM REDESIGN ΠΛΗΡΩΣ ΟΛΟΚΛΗΡΩΘΗΚΕ — έτοιμο για merge/tag v2.0.0)
Το ιστορικό εκδόσεων ζει σε ξεχωριστό αρχείο: `VERSIONS.md`
(bundled μέσα στην ίδια την εφαρμογή — βλ. εκεί).
Τρέχουσα έκδοση: v1.1.32

---

## ΜΙΚΡΕΣ / ΓΝΩΣΤΕΣ ΕΚΚΡΕΜΟΤΗΤΕΣ

## ESM REDESIGN (εκκρεμότητα μεσαίου μεγέθους) — v2.0.0

- [x] main.js → ESM (`import`/`export`), preload.js → preload.cjs
      (ρητά CommonJS — το Electron 28 αποτυγχάνει σιωπηλά να εκτελέσει ESM
      preload script, επαληθεύτηκε εμπειρικά), `"type": "module"` στο
      package.json. Ολοκληρώθηκε 2026-07-05 (Φάση 1, βλ. CHANGELOG-v2.md).

- [x] Modularization του main.js (προτάθηκε από code review, 2026-07-06)
      — ολοκληρώθηκε 2026-07-05 (Φάση 2, βλ. CHANGELOG-v2.md). main.js:
      1968 → 237 γραμμές. Domain λογική σε 9 νέα modules/ αρχεία:
      state.js, python-bridge.js, config.js, cloud-sync.js, retention.js,
      archive-mode.js, clean-start.js, update-check.js, ce-period.js,
      pdf-generation.js, email.js, document-library.js (μένουν μόνο
      createWindow, app lifecycle, window IPC, init-active-period-start,
      guide window).

- [x] State management (προτάθηκε από code review, 2026-07-06) — έγινε
      μαζί με το modularization παραπάνω: `modules/state.js`, ενιαίο
      mutable state object (`mainWindow`, `pyProcess`, `pyPending`,
      `archiveMode`, κλπ) αντί για διάσπαρτες global μεταβλητές στο main.js
      (το main-app.js είχε ήδη ενιαίο `AppState`, δεν χρειάστηκε αλλαγή
      εκεί).

- [x] `src/` (renderer) → ESM — ΠΛΗΡΩΣ ΟΛΟΚΛΗΡΩΘΗΚΕ 2026-07-05 (Φάση 3,
      βλ. CHANGELOG-v2.md). Μετατράπηκαν όλα:
      - `index.html`: `<script src="main-app.js">` →
        `<script type="module" src="...">`.
      - `main-app.js`: ρητή έκθεση στο `window` κάθε top-level
        function/const που τα pages/inline `onclick` καλούν bare, ΚΑΙ
        πραγματικά `export` για ό,τι τα converted pages εισάγουν ρητά
        (`App`, `pyCall`, `pyCallStrict`, `AppState`, `navigateTo`,
        `_esc`, `_formatCeDate`, `_toIsoDate`,
        `_updateSidebarArchiveBanner`).
      - `Pages.X.module = true` + `navigateTo()` φορτώνει module-σελίδες
        με πραγματικό `<script type="module" src="...?v=timestamp">`
        (cache-busting — απαραίτητο, ο browser κάνει cache τα modules
        ανά URL, χωρίς αυτό δεν θα ξανάτρεχαν σε επόμενη πλοήγηση).
      - Και οι 7 σελίδες: dashboard.js, samples.js, history.js,
        library.js, tests.js, reports.js, settings.js — καθεμία πήρε
        μόνο μία γραμμή `import {...} from '../../main-app.js';`, καμία
        άλλη αλλαγή λογικής.
      - Εντοπίστηκαν και διορθώθηκαν 2 πραγματικά bugs που θα έμεναν
        σιωπηλά αν δεν γινόταν αυτή η προσεκτική εξαγωγή: `_esc`/
        `_toIsoDate`/`_formatCeDate` καλούνταν bare χωρίς guard σε
        library/settings/reports/tests (θα έσπαγαν με ReferenceError)·
        `navigateTo`/`_updateSidebarArchiveBanner` καλούνταν bare ΜΕ
        guard στο settings.js (θα απέτυχαν σιωπηλά — το backend switch
        θα πετύχαινε αλλά το UI δεν θα ενημερωνόταν).
      - Επαληθεύτηκε ζωντανά με playwright-core `_electron` σε κάθε
        σελίδα ξεχωριστά (re-init σε επαναπλοήγηση, πραγματικά modals/
        forms/υπολογισμοί/CRUD flows), 0 console errors παντού.

- [x] Αναβάθμιση Electron 28→43 (Φάση 4, βλ. CHANGELOG-v2.md) —
      ολοκληρώθηκε 2026-07-05. Το puppeteer **αφαιρέθηκε εντελώς** αντί
      να αναβαθμιστεί: ήταν μόνο fallback στο `generate-report-pdf` (η
      κύρια μέθοδος είναι Python/reportlab) και δεν συσκευαζόταν καν
      στο installer (`!node_modules/puppeteer/**/*`) — άρα δεν δούλευε
      ποτέ στην πραγματική εγκατάσταση, μόνο σε dev mode. Αντικαταστάθηκε
      με κρυφό `BrowserWindow` + `webContents.printToPDF()` (μηδέν
      επιπλέον dependency, δουλεύει και packaged). Αφαιρέθηκε επίσης το
      ορφανό `puppeteer-core` (ποτέ δεν το import-άριζε ο κώδικας).
      Βρέθηκε πραγματικό bug κατά την επαλήθευση: τα `margins` του
      `printToPDF` είναι σε ίντσες, όχι pixels όπως λέει (λάθος) το
      bundled `electron.d.ts` — διορθώθηκε.
      **Branch**: `v2-esm-redesign` (δημιουργήθηκε 2026-07-05 από
      master) — το master παίρνει bug fixes/features κανονικά (v1.x),
      περνάνε περιοδικά με merge στο `v2-esm-redesign`· το αντίθετο ΟΧΙ
      μέχρι να ολοκληρωθεί, οπότε γίνεται merge πίσω + tag v2.0.0.

- [x] py-call whitelist auto-derived from Python (Φάση 5, βλ.
      CHANGELOG-v2.md) — ολοκληρώθηκε 2026-07-06. Αντί να καταργηθεί ο
      generic dispatcher (θα απαιτούσε 76+ νέα ρητά IPC endpoints, μεγάλη
      αλλαγή), προστέθηκε whitelist: `backend/server.py`'s νέο
      `RENDERER_METHODS` frozenset (76 μέθοδοι, επαληθευμένες μία-μία
      έναντι πραγματικής χρήσης στο `src/`) + νέα introspection μέθοδος
      `list_renderer_methods`. Το `modules/python-bridge.js`'s `py-call`
      handler τη φορτώνει μία φορά στην εκκίνηση (auto-derived, όχι
      hand-maintained αντίγραφο) και απορρίπτει οτιδήποτε άλλο πριν καν
      φτάσει στην Python — fail-closed αν η φόρτωση αποτύχει. Τα
      `vacuum_into`, `clean_start`, `switch_db`, `restore_db`,
      `find_archive_db` κλπ παραμένουν προσβάσιμα ΜΟΝΟ από το main
      process (`_pyCallMain`, ξεχωριστό μονοπάτι), όπως ήδη ήταν.
      Επαληθεύτηκε ζωντανά: οι ευαίσθητες μέθοδοι μπλοκάρονται όταν
      κληθούν απευθείας μέσω `window.pyBridge.call()` (ακριβώς όπως θα το
      έκανε ένα XSS), η νόμιμη χρήση παραμένει αμετάβλητη σε όλες τις 7
      σελίδες.

**Με αυτό, ο ΠΛΗΡΗΣ επανασχεδιασμός ESM (Φάσεις 1-5) έχει ολοκληρωθεί.**
Επόμενο βήμα: merge `v2-esm-redesign` → `master` + tag `v2.0.0`, όποτε
αποφασιστεί το release (βλ. στρατηγική branch παραπάνω στη Φάση 4).

## ΜΕΤΑ ΤΑ 2 ΜΕΓΑΛΑ UPDATE (ESM redesign v2.0.0 + i18n) — 2026-07-06

Τρία ξεχωριστά items που ο χρήστης έχει αποφασίσει να ξεκινήσουν ΜΟΝΟ
αφού ολοκληρωθούν και τα δύο μεγάλα updates παραπάνω (ESM redesign +
i18n, βλ. ROADMAP) — όχι πριν, γιατί επηρεάζονται από αυτά (το i18n
συγκεντρώνει strings σε resource αρχεία, θα έπρεπε ο οδηγός να γραφτεί
πάνω σε αυτή τη δομή· η μετονομασία αγγίζει branding/strings παντού).

- [ ] Οδηγός χρήσης της εφαρμογής — ενεργοποιείται πατώντας το icon
      της εφαρμογής στο Dashboard. Ο χρήστης σκέφτεται να είναι modular
      (αλλαγή ενός τμήματος χωρίς να αγγίζονται τα υπόλοιπα) — ακριβής
      τρόπος υλοποίησης θέμα περαιτερω συζήτησης όταν έρθει η ώρα.

- [ ] Τεχνικός οδηγός εγκατάστασης & προαπαιτούμενων — είχε ξεκινήσει
      παλιότερα και ξεχάστηκε. Υπάρχει ήδη μερική βάση στο `README.md`
      ("Εγκατάσταση (Linux)"/"(macOS)"), αλλά είναι ξεπερασμένη — περιγράφει
      dev setup μέσω git clone/npm/pip, όχι την πραγματική ροή που
      χρησιμοποιούν σήμερα διαχειριστής/χειριστής (κατέβασμα .exe installer
      από GitHub release). Χρειάζεται ξαναγράψιμο για Windows installer
      flow + πραγματικά προαπαιτούμενα (rclone setup, κλπ).

- [ ] Μετονομασία εφαρμογής + αλλαγή icon — λεπτομέρειες δεν έχουν
      συζητηθεί ακόμα.

## ROADMAP — ΕΓΚΕΚΡΙΜΕΝΑ ΓΙΑ ΤΟ ΜΕΛΛΟΝ (όχι τρέχουσα φάση)

Προτάθηκαν 2026-07-02, ο χρήστης επιβεβαίωσε ότι θα χρειαστούν
τελικά — καταγράφονται εδώ ώστε να μη χαθούν:

- [ ] Διακρίβωση εξοπλισμού (κόσκινα, ζυγαριές) — διαπιστευμένο
      εργαστήριο (CE) χρειάζεται παρακολούθηση λήξης διακρίβωσης ανά
      όργανο. Θα μπορούσε να επαναχρησιμοποιήσει το ήδη δοκιμασμένο
      πρότυπο λήξης CE period (checkCeExpiryAndNotify, main.js) — νέος
      πίνακας με ημερομηνία λήξης ανά όργανο + ίδιο notification/badge.

- [ ] Audit trail / ιστορικό αλλαγών — ποιος άλλαξε τι και πότε
      (προδιαγραφές, δείγματα, ρυθμίσεις), σημαντικό για διαπίστευση.
      Εύρος αναθεωρήθηκε 2026-07-04: το `tbl_technicians` (id, name,
      active) ήδη υπάρχει και συνδέεται με FK στα δείγματα — δεν
      χρειάζεται πλήρες σύστημα σύνδεσης/authentication, μόνο ελαφριά
      επιλογή "ποιος χρησιμοποιεί τώρα την εφαρμογή" από την ήδη
      υπάρχουσα λίστα τεχνικών (χωρίς password/ρόλους), και προσθήκη
      created_by/modified_by στις function που γράφουν στη βάση
      (db_manager.py). Μικρότερο σε δυσκολία απ' ό,τι αρχικά εκτιμήθηκε.

- [ ] Σύγκριση ανάμεσα σε υποπεριόδους — δείχνει πώς άλλαξε η ποιότητα
      ενός προϊόντος (Μ.Ο. MB/SE/FI/κοκκομετρία) ανάμεσα σε δύο
      υποπεριόδους δίπλα-δίπλα, όχι μόνο σύγκριση με τη δηλωμένη τιμή
      όπως κάνει σήμερα η Περιοδική Αναφορά. Θα ξαναχρησιμοποιούσε την
      υποδομή του v1.1.13/v1.1.14 (get_effective_specifications κ.λπ.).

- [ ] Αυτόματη περιοδική ενημέρωση email (π.χ. εβδομαδιαία) — σύνοψη
      προς τη διεύθυνση: δείγματα εκτός προδιαγραφών, ημέρες μέχρι λήξη
      CE, εκκρεμότητες. Συνδυάζει ήδη υπάρχοντα κομμάτια (SMTP,
      get_dashboard_stats, checkCeExpiryAndNotify) σε νέο scheduled
      task — να διευκρινιστεί πριν την υλοποίηση αν πρέπει να δουλεύει
      ακόμα κι όταν η εφαρμογή είναι κλειστή.

- [ ] Γράφημα τάσης στον χρόνο (trend chart) — line chart MB/SE/FI ενός
      προϊόντος σε πολλαπλές υποπεριόδους μαζί (π.χ. τελευταίοι 6-12
      μήνες), πιάνει σταδιακή ολίσθηση ποιότητας. Ο χρήστης το
      χαρακτήρισε "υπερβολή" προς το παρόν — χαμηλή προτεραιότητα.

- [ ] Εξωτερίκευση strings (i18n) — ένα από "τα 2 μεγάλα update" (μαζί
      με το ESM redesign) πριν ξεκινήσουν ο οδηγός χρήσης και η
      μετονομασία/icon (βλ. ενότητα παραπάνω). Προτάθηκε 2026-07-04. Όλα τα
      ελληνικά κείμενα της εφαρμογής (UI + PDF generation στο
      backend/server.py) είναι σήμερα hardcoded literals διάσπαρτα σε
      πολλά αρχεία. Ιδέα: συγκέντρωσή τους σε ένα ή περισσότερα resource
      αρχεία, ώστε (α) να μπορούν να διορθωθούν/ελεγχθούν εύκολα σε ένα
      σημείο, (β) να ανοίξει το ενδεχόμενο επιλογής γλώσσας στο μέλλον
      (ξεχωριστό αρχείο ανά γλώσσα). Μεγάλη σε εύρος αλλαγή — αγγίζει
      σχεδόν κάθε σελίδα του UI και το PDF generator. Ξεχωριστό
      προγραμματισμένο effort, όχι μαζί με κανονικά version bumps.

- [ ] Δομημένο logging (π.χ. `electron-log`) — προτάθηκε 2026-07-04
      (code review). Σήμερα σκόρπια `console.log`/`console.error` σε
      όλο το main.js, χωρίς μόνιμο αρχείο καταγραφής — αν κάτι πάει
      στραβά στη μηχανή του χειριστή, δεν υπάρχει ιστορικό σφαλμάτων να
      ελεγχθεί εκ των υστέρων. Νέα εξάρτηση + αγγίζει όλο το αρχείο,
      χρειάζεται ρητή απόφαση πριν την υλοποίηση.

## ΜΕΓΑΛΕΣ / ΑΝΑΒΛΗΘΗΚΑΝ

- [ ] Linux installer (AppImage/deb, χρειάζεται Linux build env/CI)
