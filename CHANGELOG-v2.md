# Changelog — v2.0.0 (ESM Redesign)

Ιστορικό της δουλειάς στο branch `v2-esm-redesign` (βλ. TODOLIST.md για τη
στρατηγική: master συνεχίζει κανονικά v1.x, αλλαγές του περνάνε περιοδικά
εδώ, το αντίθετο όχι μέχρι να ολοκληρωθεί → merge + tag v2.0.0).

Κάθε καταχώρηση παραθέτει και τη **λίστα αρχείων** που άλλαξαν, ώστε να
είναι εύκολο να δοθούν σε Gemini/ChatGPT για έλεγχο χωρίς να χρειάζεται να
ψάχνει κανείς το git diff.

---

## Αλλαγή appId — gr.galatista.lab → com.daigma.lims (2026-07-09)

**Μετά το tag v2.2.0 — δουλειά κατευθείαν στο `master`.**

Καθαρά τεχνική αλλαγή, καμία λειτουργική διαφορά για τον χρήστη. Ο
χειριστής ετοιμαζόταν να εγκαταστήσει την πρώτη v2.x του δίπλα στην ήδη
εγκατεστημένη v1.1.33, στο ίδιο μηχάνημα, για δοκιμή πριν αντικαταστήσει
οριστικά την παλιά — προέκυψε το ερώτημα τι προβλήματα μπορεί να φέρει
αυτή η παράλληλη εγκατάσταση.

Βρέθηκε ότι το `package.json`'s `build.appId` (`gr.galatista.lab`) ήταν
**ίδιο** στην v1.x γραμμή και σε όλη τη v2.x γραμμή μέχρι τώρα (v2.0.0
έως v2.2.0) — κληρονομημένο από πριν το rebrand. Το `appId` είναι αυτό
που τα Windows χρησιμοποιούν για να αναγνωρίσουν "ίδια εφαρμογή" στο
registry/Add-Remove Programs, ανεξάρτητα από το `productName`
(`"Εργαστήριο Γαλάτιστας"` vs `"ΔAiγμα LiMS"`) — ενώ ο φάκελος δεδομένων
(`userData`, βάση/config/rclone.conf) είναι ήδη πλήρως ξεχωριστός μεταξύ
των δύο γραμμών επειδή βασίζεται στο `package.json`'s `name`
(`lab-galatista` vs `daigma-lims`), όχι στο appId.

Αποφασίστηκε να αλλάξει το appId **τώρα**, στην πρώτη v2.x που θα φτάσει
ποτέ σε πραγματικό μηχάνημα χειριστή — αφού καμία v2.x δεν έχει
εγκατασταθεί ακόμα εκεί με το παλιό appId, η αλλαγή δεν σπάει καμία
μελλοντική ομαλή αναβάθμιση (το κόστος μιας τέτοιας αλλαγής είναι πάντα
εφάπαξ, μόνο για όποιον έχει ήδη εγκατάσταση με το παλιό appId τη στιγμή
της αλλαγής — εδώ δεν υπάρχει κανείς τέτοιος). Από εδώ και πέρα, όλες οι
v2.x εκδόσεις (v2.3.0, v2.4.0, ...) θα μοιράζονται το ίδιο νέο appId,
άρα ομαλές, καθαρές αναβαθμίσεις μεταξύ τους όπως πριν.

**Αρχεία:**
- `package.json` (`build.appId`)

---

## Οδηγός Χρήσης της εφαρμογής — in-app modal (2026-07-09)

**Μετά το tag v2.1.0 — δουλειά κατευθείαν στο `master`.**

Roadmap item από το TODOLIST.md ("ΜΕΤΑ ΤΑ 2 ΜΕΓΑΛΑ UPDATE") που περίμενε
"περαιτέρω συζήτηση όταν έρθει η ώρα" — υλοποιήθηκε σήμερα. Modal με 13
θέματα (μια ενότητα ανά βασική οθόνη + tab Ρυθμίσεων, ένα troubleshooting
και ένα multi-install/update), ανοίγει πατώντας το app icon στο sidebar
header (`.logo-img`, μόνιμα ορατό σε κάθε σελίδα).

- **Reuse εύρημα**: αντί για νέο overlay/CSS από το μηδέν, βρέθηκε ότι
  υπάρχει ήδη γενικό modal component (`App.showModal()`/`App.closeModal()`,
  `src/main-app.js:213-241`, `#modal-overlay`/`#modal`) — theme-aware
  (dark mode compatible μέσω CSS custom properties), επαναχρησιμοποιήθηκε
  αυτούσιο. Μόνο μικρό CSS block προστέθηκε (τέλος `main.css`) για το
  εσωτερικό two-column layout (λίστα θεμάτων + iframe).
- **Modular pattern**: ίδιο ακριβώς σχήμα με τους ήδη υπάρχοντες οδηγούς
  δοκιμών (`src/pages/tests/guides/*.html`, `GUIDE_FILES` στο tests.js) —
  κάθε θέμα είναι ανεξάρτητο static HTML αρχείο
  (`src/pages/guide/topics/*.html`), αλλαγή σε ένα δεν αγγίζει τα άλλα.
- **Περιεχόμενο**: στοιχεία από το README.md + ανά-οθόνη εξήγηση (τι κάνει,
  τι επιλογές έχει ο χρήστης, συχνά προβλήματα ένα προς ένα) — κατ'
  απαίτηση χρήστη. Περιλαμβάνει ρητά το πρόσφατο εύρημα SMTP
  ENETUNREACH/VPN-ETIMEDOUT στα θέματα Email και Συχνά Προβλήματα.

Επαληθεύτηκε ζωντανά από τον χρήστη (Playwright automation μπλόκαρε σε
env-specific spawn ENOENT bug άσχετο με το feature — έγινε manual
verification): άνοιγμα modal, πλοήγηση σε όλα τα 13 θέματα, κλείσιμο.

**Αρχεία:**
- `src/pages/guide/guide.js` (νέο)
- `src/pages/guide/topics/*.html` (13 νέα)
- `src/index.html`
- `src/styles/main.css`

---

## Αυτόματη περιοδική ενημέρωση email (2026-07-09)

**Μετά το tag v2.1.0 — δουλειά κατευθείαν στο `master`.**

Roadmap item #26 (project_pending, εγκρίθηκε 2026-07-02). Σύνοψη (νέα
δείγματα, εκκρεμείς δοκιμές, εκτός προδιαγραφών, λήξη CE) + ένα PDF
Περιοδικής Αναφοράς ανά ενεργό προϊόν με δεδομένα στο διάστημα,
ρυθμιζόμενο διάστημα από τις Ρυθμίσεις.

- **Μηχανισμός**: έλεγχος σε κάθε εκκίνηση της εφαρμογής (όχι live
  cron/εξωτερικός scheduler) — ίδιο pattern με το ήδη δοκιμασμένο
  `checkCeExpiryAndNotify` (`modules/ce-period.js`). Νέο πεδίο
  `periodicEmailLastSentAt` στο `lab-config.json` καθορίζει πότε "έφτασε
  η ώρα", αντί για wall-clock timer — έτσι δεν χρειάζεται η εφαρμογή να
  μένει ανοιχτή τη συγκεκριμένη στιγμή, αρκεί να ανοίγει τουλάχιστον μία
  φορά ανά διάστημα.
- **Παραλήπτες**: μία σταθερή διεύθυνση (π.χ. Google Group) που
  διαχειρίζεται ο χρήστης εκτός εφαρμογής — καμία νέα λίστα παραληπτών
  μέσα στο app.
- **Καμία δραστηριότητα → καμία αποστολή**: αν δεν υπήρξαν νέα δείγματα
  στο διάστημα, δεν στέλνεται κενό email, αλλά το ρολόι προωθείται ούτως
  ή άλλως (πρόταση χρήστη).
- **Συνημμένα**: ένα PDF Περιοδικής Αναφοράς ανά προϊόν με δεδομένα,
  reuse του ήδη υπάρχοντος `generate_periodic_pdf` — καμία αλλαγή σε
  Python.
- **Παράλληλο fix**: `family:4` στα δύο `nodemailer.createTransport()`
  calls (`modules/email.js`) για αποφυγή `ENETUNREACH` σε δίκτυα όπου το
  IPv6 δεν δρομολογείται πραγματικά.

Επαληθεύτηκε ζωντανά (isolated Electron profile + πραγματική αποστολή σε
πραγματικό Google Group με συνημμένο PDF).

**Αρχεία:**
- `modules/periodic-email.js` (νέο)
- `modules/email.js`
- `main.js`
- `src/pages/settings/settings.html`
- `src/pages/settings/settings.js`

---

## Γρήγορη Πρόσβαση CE — sidebar quick-access (2026-07-09)

**Μετά το merge/tag v2.0.0 — δουλειά κατευθείαν στο `master`, δεν έχει
γίνει ακόμα νέο version bump/tag/release.**

Για να δει κανείς το τρέχον CE Πιστοποιητικό, μια Ταυτότητα Επίδοσης, μια
δοκιμή εξωτερικού εργαστηρίου ή ένα πρότυπο, έπρεπε να μπει στη Βιβλιοθήκη
Εγγράφων και να ψάξει χειροκίνητα. Προστέθηκαν 4 badges "Γρήγορη Πρόσβαση"
στο sidebar (πάνω από το ήδη υπάρχον CE badge footer) που ανοίγουν
cascading στήλες δίπλα στο sidebar μέχρι το σωστό PDF — το βάθος
πλοήγησης διαφέρει ανά κατηγορία, αποφασισμένο ρητά με τον χρήστη μέσω
mockup (Artifact) πριν την υλοποίηση:

```
Πιστοποιητικό CE   → 1 αρχείο (καμία λίστα)
Δοκιμές (περιόδου) → Υλικό → 1 αρχείο                       [1 επίπεδο]
Πρότυπα            → Ομάδα (ΕΝ/ΠΕΤΕΠ) → Πρότυπο → 1 αρχείο  [2 επίπεδα]
DoP / CE Marks     → Πρότυπο → Υλικό → {CE Mark, DOP}       [3 επίπεδα]
```

Ο αριθμός καταχωρήσεων σε κάθε στήλη είναι πάντα δυναμικός (query στη
βάση καθώς ο χρήστης κλικάρει, καμία hardcoded λίστα) — αναφορά:
ΑΜΜΟΣ έχει 3 πρότυπα, ΓΑΡΜΠΙΛΙ/ΣΥΝΤΡΙΜΜΑ 2, 3Α/Ε4/ΣΚΥΡΑ 1.

- **Σχήμα**: νέο `database/migration_018_document_quick_access.sql` —
  στήλες `quick_access_type`/`quick_access_product_id`/
  `quick_access_standard`/`quick_access_group` στο `tbl_documents` + 4
  partial unique indexes (ίδιο πνεύμα με το `is_official` στους
  test-run πίνακες — μόνο ένα ενεργό έγγραφο ανά "θέση" τη φορά).
  `CURRENT_SCHEMA_VERSION` 17→18.
- **Backend**: νέο `set_document_quick_access()` (db_manager.py) με
  clear-πριν-set λογική (matching `promote_run_to_official`) + 8 lazy
  getters, μία ανά επίπεδο στήλης. `export_document_library()`/
  `import_document_library()` ενημερώθηκαν ώστε η σήμανση να
  διαδίδεται σωστά μεταξύ των 2 εγκαταστάσεων — το
  `quick_access_product_id` (raw FK, διαφέρει ανά βάση) συγχρονίζεται
  μέσω ονόματος προϊόντος, όχι raw id (ίδιο μάθημα με το
  `merge_sample_from_backup`).
- **Frontend**: επεκτάθηκε το edit-document modal της Βιβλιοθήκης
  (`src/pages/library/library.js`) με dropdown "Γρήγορη Πρόσβαση" +
  conditional υπο-πεδία. Νέο `src/quick-access.js` module (κυκλική
  εισαγωγή με το `main-app.js` — ασφαλής, όλη η χρήση γίνεται μέσα σε
  function bodies) υλοποιεί το cascading UI, με hook στο `navigateTo()`
  ώστε οι ανοιχτές στήλες να κλείνουν αυτόματα σε αλλαγή σελίδας. Το
  sidebar HTML είχε σχόλιο "Κλειδωμένο, δεν αλλάζει ποτέ" — αγνοήθηκε
  σκόπιμα μετά από ρητή επιβεβαίωση του χρήστη.

Επαληθεύτηκε πλήρες end-to-end σε isolated Electron profile (δικό του
`--user-data-dir`, καμία επαφή με πραγματικά δεδομένα) μέσω Playwright
`_electron`: migration 017→018 clean, `set_document_quick_access`
uniqueness/auto-clear συμπεριφορά, και πλήρες ζωντανό UI walkthrough —
και οι 4 βαθμοί βάθους δούλεψαν σωστά, το πιο βαθύ σενάριο (DoP)
επιβεβαιώθηκε με πραγματικά δυναμικά αποτελέσματα, click-outside-close
και αλλαγή-σελίδας-κλείνει-στήλες δούλεψαν, το edit-document modal
έδειξε σωστά προσυμπληρωμένα πεδία σε ήδη σημαδεμένο έγγραφο.

**Αρχεία:**
- `database/migration_018_document_quick_access.sql` (νέο)
- `database/schema.sql`
- `database/db_manager.py`
- `backend/server.py`
- `src/index.html`
- `src/styles/main.css`
- `src/main-app.js`
- `src/quick-access.js` (νέο)
- `src/pages/library/library.js`
- `src/i18n/el.json`

Commits: `f36387a`, `fa9d922` (TODOLIST.md).

---

## Audit trail — τεχνικός ανά δείγμα/δοκιμή (2026-07-09)

**Μετά το merge/tag v2.0.0 — δουλειά κατευθείαν στο `master`, δεν έχει
γίνει ακόμα νέο version bump/tag/release.**

Δεν υπήρχε καταγραφή ποιος τεχνικός κατάχώρησε ένα δείγμα ή εκτέλεσε/
τροποποίησε μια δοκιμή — σημαντικό κενό για διαπιστευμένο εργαστήριο (CE).
Το μόνο υπάρχον στοιχείο ήταν το `tbl_samples.technician_id`, που σημαίνει
"ποιος πήρε το δείγμα", όχι "ποιος το κατάχώρησε" ή "ποιος έκανε τη δοκιμή".

Εύρος περιορίστηκε ρητά σε **δείγματα + εκτέλεση δοκιμών** — reference
data (προϊόντα, προδιαγραφές, πηγές, ρυθμίσεις, έγγραφα) μένουν εκτός.
Καμία νέα έννοια login/session· κάθε ενέργεια ζητάει τον τεχνικό
ξεχωριστά μέσω υποχρεωτικού dropdown (όχι κεντρική "τρέχουσα ταυτότητα").

- **Σχήμα**: νέο `database/migration_017_audit_trail_technician.sql` —
  στήλες `created_by`/`modified_by` (FK σε `tbl_technicians`) σε
  `tbl_samples` + 4 πίνακες test-run (sieve/flakiness/mb/se).
  `CURRENT_SCHEMA_VERSION` 16→17. Χωρίς backfill ιστορικών εγγραφών.
- **Backend** (`database/db_manager.py`, `backend/server.py`): κάθε
  `save_*`/`create_sample*`/`update_sample`/`update_rejected_reason`/
  `promote_run_to_official` γράφει πλέον `created_by` (νέα εγγραφή) ή
  `modified_by` (επεξεργασία υπάρχουσας) ανάλογα με το branch.
- **Frontend**: υποχρεωτικό technician picker στην είσοδο/επεξεργασία
  δείγματος (επαναχρησιμοποίηση υπάρχοντος πεδίου) + 6 νέα σημεία — 4
  φόρμες δοκιμών (πάντα κενό, καμία προσυμπλήρωση) και τα modals
  διόρθωσης λόγου απόρριψης/επαναφοράς ως επίσημη εκτέλεση.
- **Εμφάνιση**: κάρτα δοκιμής + ιστορικό εκτελέσεων (`tests.js`),
  λεπτομέρεια δείγματος (`history.js`), Δελτίο Αποτελεσμάτων (`reports.js`).

**Bug βρέθηκε+διορθώθηκε κατά την επαλήθευση:** η αρχική προσθήκη στο
`reports.js` έγινε στο `buildSieveSection()`, που αποδείχθηκε dead code
(ποτέ δεν καλείται)· η πραγματική συνάρτηση του preview/εκτύπωσης είναι
η `buildSieveTableOnly()` — διορθώθηκε εκεί.

Επαληθεύτηκε πλήρες end-to-end σε isolated Electron profile (δικό του
`--user-data-dir`, καμία επαφή με πραγματικά δεδομένα) μέσω Playwright
`_electron`: mandatory validation μπλόκαρε σωστά σε είσοδο δείγματος και
σε εκτέλεση δοκιμής· save με δύο διαφορετικούς τεχνικούς (ένας για το
δείγμα, άλλος για τη δοκιμή) εμφανίστηκε σωστά και ξεχωριστά στο UI, στο
Ιστορικό, και στην Αναφορά/PDF preview· direct SQL query επιβεβαίωσε τις
τιμές στη βάση. Migration 017 δοκιμάστηκε ξεχωριστά σε προσομοιωμένη v16
βάση (v16→v17 clean), και όλες οι write functions δοκιμάστηκαν άμεσα σε
Python για σωστό created_by/modified_by ανά branch (insert/update/new-run).

**Αρχεία:**
- `database/migration_017_audit_trail_technician.sql` (νέο)
- `database/schema.sql`
- `database/db_manager.py`
- `backend/server.py`
- `calculations.py`
- `src/pages/samples/samples.js`
- `src/pages/tests/tests.js`
- `src/pages/history/history.js`
- `src/pages/reports/reports.js`
- `src/i18n/el.json`

Commits: `0ed1d62`, `3c063ed` (TODOLIST.md).

---

## Φάση 5 — py-call whitelist (2026-07-06)

**Τελευταίο βήμα του ESM redesign· με αυτό ολοκληρώνονται όλες οι Φάσεις 1-5.**

Το `window.pyBridge.call(method, ...args)` είναι εκτεθειμένο στο main
world (contextBridge) και δεχόταν οποιοδήποτε method string, προωθώντας
το κατευθείαν στην Python. Το `METHODS` dict της Python ήδη απορρίπτει
άγνωστα ονόματα, αλλά αυτό δεν εμπόδιζε την εκτέλεση ΠΡΑΓΜΑΤΙΚΩΝ μεθόδων
που προορίζονται ΜΟΝΟ για το main process (`vacuum_into`, `clean_start`,
`switch_db`, `restore_db`, `find_archive_db` κ.ά.) — ένα μελλοντικό XSS
θα είχε πρόσβαση σε όλες, όχι μόνο σε όσες πραγματικά χρησιμοποιεί το UI.

- **`backend/server.py`**: νέο `RENDERER_METHODS` frozenset — 76
  μέθοδοι, επαληθευμένες μία-μία έναντι πραγματικής χρήσης στο `src/`
  (μια πρώτη naive αναζήτηση υποεκτίμησε σοβαρά τον αριθμό, αφού πολλές
  κλήσεις γίνονται μέσω `window.pyBridge?.call?.(...)` απευθείας, όχι
  μέσω `pyCall`/`pyCallStrict`). Νέα είσοδος `list_renderer_methods` στο
  `METHODS` ώστε το JS να παίρνει τη λίστα ζωντανά αντί να κρατάει δικό
  του, πιθανώς ξεπερασμένο αντίγραφο.
- **`modules/python-bridge.js`**: ο χειριστής `py-call` κάνει cache τη
  whitelist (φόρτωση μία φορά όταν η Python γίνεται έτοιμη) και
  απορρίπτει οτιδήποτε δεν είναι μέσα — fail-closed αν η φόρτωση
  αποτύχει. Το `_pyCallMain`/`callPython` (μονοπάτι main-process-only)
  δεν άλλαξε καθόλου — τα `vacuum_into` κλπ συνεχίζουν να δουλεύουν
  κανονικά για τους νόμιμους main-process callers τους.

Επαληθεύτηκε ζωντανά με `playwright-core`'s `_electron`: κλήση των 5
ευαίσθητων μεθόδων + μιας ανύπαρκτης απευθείας μέσω
`window.pyBridge.call()` (ακριβώς όπως θα το έκανε ένα XSS) — όλες
μπλοκαρίστηκαν σωστά με "Μη επιτρεπόμενη μέθοδος"· η νόμιμη μέθοδος
`get_products` συνέχισε να δουλεύει· πλήρης κύκλος πλοήγησης στις 7
σελίδες + πραγματικά flows του settings.js που καλούν
`window.pyBridge.call(...)` απευθείας (`get_all_ce_periods`,
`get_samples_count`) — 0 console errors.

**Αρχεία:**
- `backend/server.py`
- `modules/python-bridge.js`

---

## Φάση 4 — Electron 28→43, αφαίρεση puppeteer (2026-07-05)

- **`package.json`**: `electron` `^28.3.3` → `^43.0.0` (15 major versions —
  ήταν πίσω ειδικά λόγω του puppeteer 22+ ESM-only περιορισμού, που δεν
  ισχύει πια αφού το main process είναι ESM από τη Φάση 1).
  `electron-builder` ήδη στο latest (`^26.15.3`), καμία αλλαγή.
- **Αφαιρέθηκε εντελώς το `puppeteer`** (και το ορφανό `puppeteer-core`,
  που δεν το import-άριζε πουθενά ο κώδικας — ήταν εσωτερική εξάρτηση του
  puppeteer, ο ξεχωριστός top-level ορισμός ήταν κατάλοιπο). Το puppeteer
  ήταν μόνο fallback στο `generate-report-pdf` (η κύρια μέθοδος είναι
  Python/reportlab, όταν δίνεται sampleId) και **δεν συσκευαζόταν καν στο
  installer** (`!node_modules/puppeteer/**/*` στο `files`) — άρα το
  fallback δεν δούλευε ποτέ στην πραγματική εγκατάσταση, μόνο σε dev mode.
- **`modules/pdf-generation.js`**: το fallback αντικαταστάθηκε με κρυφό
  `BrowserWindow` (`show:false`) + `webContents.printToPDF()` — το ήδη
  ενσωματωμένο Chromium του Electron, μηδέν επιπλέον dependency, δουλεύει
  και packaged. Bug που βρέθηκε κατά την επαλήθευση: τα `margins` του
  `printToPDF` είναι σε **ίντσες**, όχι pixels όπως λέει (λάθος) το
  bundled `electron.d.ts` — το πρώτο live test απέτυχε με "margins must
  be less than or equal to pageSize" με τιμές σε pixels· διορθώθηκε.
- **`allowScripts`**: αφαιρέθηκε το ασυνεπές `puppeteer@25.0.4` (δεν
  ταίριαζε με το πραγματικό `puppeteer@21.11.0` dependency), προστέθηκε
  `electron@43.0.0` και το νέο transitive `electron-winstaller@5.4.0`
  (ελέγχθηκε το install script του — αντιγράφει απλώς το σωστό 7z binary
  για το NSIS packaging, ακίνδυνο).

Επαληθεύτηκε: `node --check` σε όλα τα αλλαγμένα αρχεία· ζωντανή εκκίνηση
Electron 43 (Python backend, backup, cloud sync όλα καθαρά)· το νέο
BrowserWindow fallback παρήγαγε πραγματικό, έγκυρο 2-σέλιδο PDF
(portrait+landscape merge) μέσω playwright-core `_electron` (καλέστηκε ο
IPC handler απευθείας χωρίς sampleId για να αναγκαστεί το fallback path,
αφού η πραγματική χρήση περνάει πάντα από το Python path)· πλήρης κύκλος
πλοήγησης στις 7 σελίδες, 0 console errors.

Εκτός scope, για σημείωση: το `npm audit` δείχνει 1 high-severity
ευπάθεια στο `nodemailer` (CRLF injection κ.ά.), άσχετη με αυτή την
αναβάθμιση.

**Αρχεία:**
- `package.json`
- `package-lock.json`
- `modules/pdf-generation.js`

---

## Φάση 3 (ολοκλήρωση) — και οι 7 σελίδες σε ESM (2026-07-05)

Ολοκληρώθηκε η μετατροπή του `src/` σε ESM: dashboard.js, samples.js,
history.js, library.js, tests.js, reports.js, settings.js μετατράπηκαν
ένα-ένα, με το ίδιο πρότυπο που καθιέρωσε το main-app.js/dashboard.js
(βλ. προηγούμενη ενότητα «Φάση 3 (ξεκίνημα)»):

- `Pages.<page>.module = true` στο main-app.js.
- Κάθε σελίδα πήρε **μία μόνο γραμμή** — `import {...} from
  '../../main-app.js';` — καμία άλλη αλλαγή λογικής.
- Το main-app.js's `export {...}` μεγάλωσε σταδιακά όσο κάθε νέα σελίδα
  χρειαζόταν κι άλλο σύμβολο: `_esc` (tests.js), `_formatCeDate`
  (reports.js), και τέλος `navigateTo`/`_toIsoDate`/
  `_updateSidebarArchiveBanner` (settings.js) — σύνολο 9 exports πλέον
  (`App`, `pyCall`, `pyCallStrict`, `AppState`, `navigateTo`, `_esc`,
  `_formatCeDate`, `_toIsoDate`, `_updateSidebarArchiveBanner`).

**Bugs που εντοπίστηκαν κατά τον έλεγχο πριν τη μετατροπή** (θα έμεναν
σιωπηλά χωρίς την προσεκτική εξαγωγή bare references ανά αρχείο):
- `_esc`/`_toIsoDate`/`_formatCeDate`: καλούνταν bare **χωρίς guard** σε
  library.js/settings.js/reports.js/tests.js — θα έσπαγαν με
  ReferenceError.
- `navigateTo`/`_updateSidebarArchiveBanner`: καλούνταν bare **ΜΕ guard**
  (`typeof X === 'function'`) μέσα στο settings.js's
  `_doOpenBackupInArchiveMode()` (ροή «άνοιγμα backup σε Archive Mode»)
  — χωρίς την έκθεσή τους θα απέτυχαν **σιωπηλά**: το backend switch θα
  πετύχαινε, αλλά το sidebar banner δεν θα ενημερωνόταν και δεν θα
  γινόταν πλοήγηση στο dashboard.

Επαληθεύτηκε ζωντανά με `playwright-core`'s `_electron`, ξεχωριστά ανά
σελίδα: re-init σε επαναλαμβανόμενη πλοήγηση, και πραγματικά flows —
πλήρης wizard καταχώρησης δείγματος (samples.js, με πραγματική
αποθήκευση+καθαρισμό), αναζήτηση/άνοιγμα/διαγραφή (history.js),
sections/documents CRUD (library.js), φόρμα κοκκομετρίας +
υπολογισμοί EN 933-1 (tests.js), αναζήτηση/επιλογή δείγματος + tabs
(reports.js), edit CE period modal + archive-from-backup banner/nav
(settings.js). 0 console errors παντού.

Σημείωση: εντοπίστηκε προϋπάρχουσα αστάθεια στο Playwright/Electron
GPU process σε αυτό το automation setup (crash τυχαίο σε ορισμένα
σενάρια, ειδικά όταν γίνεται mutate ενός contextBridge-exposed
αντικειμένου από το main world) — επιβεβαιώθηκε ότι δεν σχετίζεται με
τον κώδικα της εφαρμογής (αναπαράχθηκε και σε προ-αλλαγής κώδικα).

**Αρχεία:**
- `src/main-app.js`
- `src/pages/dashboard/dashboard.js`
- `src/pages/samples/samples.js`
- `src/pages/history/history.js`
- `src/pages/library/library.js`
- `src/pages/tests/tests.js`
- `src/pages/reports/reports.js`
- `src/pages/settings/settings.js`

---

## Φάση 3 (ξεκίνημα) — main-app.js σε ESM (2026-07-05)

Πρώτο βήμα της μετατροπής του `src/` (renderer) σε ESM. Μόνο το
main-app.js άλλαξε — τα 7 page scripts (dashboard.js, samples.js,
tests.js, history.js, reports.js, library.js, settings.js) παραμένουν
classic scripts, χωρίς καμία αλλαγή· ελαχιστοποιεί το ρίσκο σε μια
ζωντανή εφαρμογή καθημερινής χρήσης.

- **`src/index.html`**: `<script src="main-app.js">` →
  `<script type="module" src="main-app.js">`.
- **`src/main-app.js`**: ρητή έκθεση στο `window` κάθε top-level
  function/const που τα page scripts ή inline `onclick="..."` HTML
  καλούν ως γυμνό identifier — απαραίτητο πλέον αφού τα ES modules δεν
  μοιράζονται global scope με τα classic scripts (πριν, οι top-level
  function δηλώσεις γίνονταν αυτόματα window properties). Έλεγχος σε
  όλο το `src/` πριν την αλλαγή αποκάλυψε ότι `_esc`, `_toIsoDate`, και
  `_formatCeDate` καλούνται bare και **χωρίς guard** σε
  library.js/settings.js/reports.js/tests.js — θα έσπαγαν με
  ReferenceError χωρίς αυτή τη ρητή έκθεση. Εκτέθηκαν εξαντλητικά όλα
  τα top-level ονόματα (όχι μόνο όσα βρέθηκαν με grep), ώστε να μη μείνει
  κρυφή αναφορά.
- Επαληθεύτηκε εμπειρικά πριν ξεκινήσει η αλλαγή: τα ES modules
  (static/dynamic `import`) δουλεύουν κανονικά πάνω σε `file://` σε αυτή
  την έκδοση Electron (καμία CORS παρεμπόδιση)· το υπάρχον τέχνασμα
  επαναφόρτωσης σελίδας (αφαίρεση/επανεισαγωγή `<script>`) ΔΕΝ θα
  ξανάτρεχε ένα module με τον ίδιο τρόπο (τα modules γίνονται cache ανά
  URL από τον browser) — δεν επηρεάζει όμως τίποτα εδώ, αφού τα page
  scripts παραμένουν classic και συνεχίζουν να χρησιμοποιούν το ίδιο
  τέχνασμα αμετάβλητο.

Επαληθεύτηκε: ζωντανή οδήγηση της εφαρμογής μέσω `playwright-core`'s
`_electron` — πλοήγηση dashboard→samples→history→reports→library→
settings→dashboard, και άνοιγμα modal ιστορικού εκδόσεων (δοκιμάζει
inline `onclick="App...()"`). 0 console errors· μόνο το προϋπάρχον,
άσχετο CSP dev-warning του Electron.

**Αρχεία:**
- `src/index.html`
- `src/main-app.js`

---

## Φάση 2 (ολοκλήρωση) — modularization: update-check.js, ce-period.js, pdf-generation.js, email.js, document-library.js (2026-07-05)

main.js άδειασε από όλη την υπόλοιπη domain λογική — έμεινε μόνο το entry
point (createWindow, app lifecycle, window IPC, init-active-period-start,
guide window).

- **`modules/update-check.js`** (νέο) — σύγκριση εκδόσεων, fetch
  allowed-versions.json, `checkForUpdates`, `open-update-url`,
  `get-allowed-versions`, `report-version-issue` (GitHub issue μέσω token),
  `get-app-version`, `get-version-history`.
- **`modules/ce-period.js`** (νέο) — `checkCeExpiryAndNotify`,
  `checkDataFolderMismatch`, snooze handlers (`data-folder-notify-snooze`,
  `ce-notify-snooze`, `ce-notify-clear-snooze`), `ce-get-suggested-folder`,
  `ce-select-folder`. Το `app.on('window-all-closed', ...)` που βρισκόταν
  ανάμεσα σε αυτή την ενότητα έμεινε στο main.js (app lifecycle, όχι CE
  domain λογική).
- **`modules/pdf-generation.js`** (νέο) — `generate-report-pdf`
  (reportlab μέσω Python, με Puppeteer fallback + `getPuppeteer`),
  `print-to-pdf`, `generate-periodic-pdf`, `save-pdf`, `save-statistics`,
  `open-pdf`, `print-pdf`.
- **`modules/email.js`** (νέο) — `send-email`, `test-smtp` (nodemailer).
- **`modules/document-library.js`** (νέο) — `upload-document`,
  `open-document`, `delete-document-cloud`, `generate-pdf-library`,
  `force-quit`.
- **`main.js`**: αφαιρέθηκαν οι 5 παραπάνω ενότητες, προστέθηκαν τα
  αντίστοιχα side-effect imports, καθαρίστηκαν όλα τα πλέον αχρησιμοποίητα
  imports (`dialog`, `shell`, `fs`, `os`, `nodemailer`, `net`,
  `_pyCallMain`, `runRclone`, `getConfigPath`, `getBackupPath`, `getDbPath`,
  `getPdfPath`, `getStatisticsPath`, `_sanitizeFsSegment`, `callPython`).
  1074 → 237 γραμμές.

Επαληθεύτηκε: `node --check` σε όλα τα αλλαγμένα/νέα αρχεία, live εκκίνηση
Electron app — Python backend, backup, cloud sync όλα ολοκληρώθηκαν χωρίς
σφάλματα.

**Αρχεία:**
- `modules/update-check.js` (νέο)
- `modules/ce-period.js` (νέο)
- `modules/pdf-generation.js` (νέο)
- `modules/email.js` (νέο)
- `modules/document-library.js` (νέο)
- `main.js`

---

## Φάση 2 (συνέχεια) — modularization: archive-mode.js, clean-start.js (2026-07-05)

- **`modules/archive-mode.js`** (νέο) — `find-archive-db`, `switch-to-archive`,
  `restore-from-archive`, `is-archive-mode`, και η Επιλεκτική Επαναφορά
  Δείγματος από Backup (`inspect-backup-samples`, `check-sample-code-conflict`,
  `merge-sample-from-backup`, `switch-to-backup-file`) — μοιράζονται την ίδια
  υποδομή, γι' αυτό εξήχθησαν μαζί.
- **`modules/clean-start.js`** (νέο) — `performCleanStart` + το IPC handler
  `clean-start`.
- **`modules/config.js`**: το `_buildBackupName` και `_pruneBackups` έγιναν
  `export` (χρειάζονται πλέον από το `clean-start.js`).
- **`main.js`**: αφαιρέθηκαν οι ενότητες "CLEAN START", "ARCHIVE MODE" και
  "ΕΠΙΛΕΚΤΙΚΗ ΕΠΑΝΑΦΟΡΑ ΔΕΙΓΜΑΤΟΣ ΑΠΟ BACKUP", προστέθηκαν τα αντίστοιχα
  side-effect imports· τα `getDataFolder`/`runSplitCloudSync` έφυγαν από τα
  imports του main.js αφού δεν χρησιμοποιούνται πια εκεί. 1074 → 846 γραμμές.

Επαληθεύτηκε: `node --check` σε όλα τα αλλαγμένα αρχεία, live εκκίνηση
Electron app — Python backend, backup, cloud sync όλα ολοκληρώθηκαν χωρίς
σφάλματα.

**Αρχεία:**
- `modules/archive-mode.js` (νέο)
- `modules/clean-start.js` (νέο)
- `modules/config.js`
- `main.js`

---

## Φάση 2 (συνέχεια) — modularization: cloud-sync.js, retention.js (2026-07-05)

Τα δύο modules έχουν πραγματική κυκλική εξάρτηση (`performStartupCloudSync`
στο cloud-sync.js καλεί `_maybeRunAutoRetention` στο retention.js) —
εξήχθησαν μαζί για να μη μείνει ενδιάμεση σπασμένη κατάσταση. Ασφαλής
κυκλική εξάρτηση σε ESM όταν η χρήση γίνεται μόνο μέσα σε function
declarations (hoisted), ποτέ στο top-level evaluation — που ισχύει εδώ.

- **`modules/cloud-sync.js`** (νέο) — rclone path/config helpers,
  `runRclone`, `isNetworkError`, όλα τα `cloud-*` IPC handlers,
  `sync-document-library`, `cloud-open-terminal`, `open-external-link`,
  `runSplitCloudSync`, `performStartupCloudSync`.
- **`modules/retention.js`** (νέο) — lock file μηχανισμός (μία εγκατάσταση
  τη φορά κάνει αυτόματο καθαρισμό remote backups), όλα τα `retention-*`
  IPC handlers.
- **`modules/python-bridge.js`**: προστέθηκε το `python-is-ready` handler
  που ήταν λάθος τοποθετημένο μέσα στην ενότητα Cloud Sync του main.js.
- **`main.js`**: αφαιρέθηκε ολόκληρη η ενότητα "IPC — Cloud Sync (rclone)"
  + "REMOTE BACKUP RETENTION" + "SPLIT CLOUD SYNC", προστέθηκαν τα
  αντίστοιχα imports. main.js: 1498 → 1131 γραμμές.

Επαληθεύτηκε πλήρες end-to-end σε live Electron app: πραγματικό startup
cloud sync ολοκληρώθηκε επιτυχώς (`[Cloud] Startup sync ✓` στα logs),
`cloud-check-rclone`/`cloud-get-config`/`retention-get-status`/
`cloud-list-remotes` όλα σωστά, πλήρης περιήγηση σελίδων χωρίς σφάλματα.

**Αρχεία:**
- `modules/cloud-sync.js` (νέο)
- `modules/retention.js` (νέο)
- `modules/python-bridge.js`
- `main.js`

---

## Φάση 1 — main.js σε ESM, preload.js → preload.cjs (2026-07-05)

Μετατροπή main.js από CommonJS σε ESM (`import`/`export`). Δοκιμάστηκε και
στο preload.js, αλλά το Electron 28 αποτυγχάνει σιωπηλά να εκτελέσει ESM
preload script (κανένα σφάλμα, απλά δεν υπάρχει ποτέ `window.pyBridge`) —
επαληθεύτηκε εμπειρικά. Λύση: `preload.cjs` (ρητά CommonJS, ανεξάρτητο από
το `"type":"module"` του package.json).

`package.json`: `"type": "module"`, έκδοση `"2.0.0-dev"` (ξεχωριστή από τα
`1.1.x` του master, ώστε να μην μπερδεύονται).

**Αρχεία:**
- `main.js`
- `preload.js` → `preload.cjs` (μετονομασία)
- `package.json`

---

## Φάση 2 (ξεκίνημα) — modularization: state.js, python-bridge.js, config.js (2026-07-05)

Πρώτα τρία, θεμελιώδη modules από το main.js (1968 γραμμές πριν). Τα
υπόλοιπα domain modules (cloud-sync, archive-mode, retention, κλπ) θα
εξαχθούν σε επόμενα βήματα, ένα-ένα.

- **`modules/state.js`** (νέο) — ενιαίο, mutable state object
  (`mainWindow`, `pyProcess`, `pyPending`, `archiveMode`, κλπ) αντί για
  διάσπαρτες global μεταβλητές. Καλύπτει ταυτόχρονα και τη Φάση 3 (state
  management), όπως είχε προβλεφθεί ότι θα γίνει μαζί με το modularization.
- **`modules/python-bridge.js`** (νέο) — `startPythonBackend`,
  `_pyCallMain`, `callPython`, `waitForPythonReady`, ο generic `py-call`
  IPC δίαυλος. Εσωτερικά χρησιμοποιεί `state.pyProcess`/`state.pyPending`
  κλπ αντί για δικές του private μεταβλητές, αφού πολύς κώδικας αλλού στο
  main.js (που δεν έχει ακόμα εξαχθεί) τα αγγίζει άμεσα.
- **`modules/config.js`** (νέο) — config load/save, path helpers
  (`getDataFolder`, `getDbPath`, `getBackupPath`, `getPdfPath`,
  `getStatisticsPath`), και όλο το backup (`performBackup` + IPC handlers
  `backup-database`, `list-backups`, `restore-backup`, `select-backup-file`,
  `select-data-folder`, `get-config`/`set-config`, `get-data-folder`).
- **`main.js`**: αφαιρέθηκε ο κώδικας που μετακόμισε στα τρία παραπάνω,
  προστέθηκαν τα αντίστοιχα imports, και όλες οι εναπομείνασες αναφορές σε
  `mainWindow`/`pyProcess`/`_pyPending`/`_archiveMode`/κλπ έγιναν
  `state.mainWindow`/`state.pyProcess`/κλπ (μηχανική μετονομασία, ίδια
  λογική/συμπεριφορά — το main.js περιέχει ακόμα ΟΛΗ την υπόλοιπη domain
  λογική, θα αδειάσει σταδιακά στα επόμενα βήματα).

Επαληθεύτηκε πλήρες end-to-end σε live Electron app: `pyBridge` λειτουργεί,
κλήσεις Python επιτυχείς, config/backup/archive-mode/is-archive-mode όλα
σωστά, καμία σελίδα δεν έδειξε σφάλματα σε πλήρη περιήγηση.

**Αρχεία:**
- `modules/state.js` (νέο)
- `modules/python-bridge.js` (νέο)
- `modules/config.js` (νέο)
- `main.js`
