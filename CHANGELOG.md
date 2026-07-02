# Changelog

Ιστορικό εκδόσεων και ανοιχτές εκκρεμότητες του Εργαστηρίου Λατομείων Γαλάτιστας.

---

## v1.1.12 — 2026-07-02

**Δελτίο Αποτελεσμάτων (Εκθέσεις)**
- Διαγνωστικό fix: το toast σφάλματος στο κουμπί Αποθήκευση (`saveReport()`) έδειχνε γενικό μήνυμα "Σφάλμα αποθήκευσης PDF" χωρίς λεπτομέρειες. Τώρα δείχνει το πραγματικό μήνυμα σφάλματος του `save-pdf` IPC, ώστε να εντοπιστεί η ακριβής αιτία στο μηχάνημα του χειριστή που αναφέρθηκε πρόβλημα (εκκρεμεί feedback — βλ. Εκκρεμότητες).

## v1.1.11 — 2026-07-02

**Frameless window**
- Νέο: αφαίρεση native Windows title bar και του default Electron menu (File/Edit/View) — αντικαταστάθηκαν με custom titlebar (drag region + κουμπιά ελαχιστοποίησης/μεγιστοποίησης/κλεισίματος) που ακολουθεί το θέμα της εφαρμογής. Λύνει το [#5](https://github.com/papadcha/lab-galatista/issues/5).

**Βιβλιοθήκη Εγγράφων**
- Νέο: sync μεταδεδομένων βιβλιοθήκης εγγράφων μεταξύ εγκαταστάσεων (διαχειριστής/χειριστής). Τα αρχεία ανέβαιναν ήδη σε κοινό cloud path ένα-ένα χειροκίνητα, αλλά οι εγγραφές `tbl_documents`/`tbl_doc_sections` που τα περιγράφουν ήταν μόνο τοπικές — έγγραφο που πρόσθετε το ένα μηχάνημα ήταν αόρατο στο άλλο παρόλο που το αρχείο ήταν ήδη κοινό. Additions-only sync (ίδια φιλοσοφία με backup/pdf sync — ποτέ διαγραφές): κάθε μηχάνημα εξάγει τα τοπικά του έγγραφα σε JSON manifest με όνομα το hostname του, το ανεβάζει στο `documents/_manifests/` στο κοινό remote, κατεβάζει τα manifests των άλλων μηχανημάτων και εισάγει ό,τι δεν υπάρχει ήδη τοπικά (ταίριασμα με `cloud_path`). Ελλείπουσες ενότητες δημιουργούνται αυτόματα με βάση το όνομα. Νέο κουμπί "Sync Βιβλιοθήκης" στις Ρυθμίσεις. Λύνει το [#4](https://github.com/papadcha/lab-galatista/issues/4).
- Εκτός εμβέλειας (σκόπιμα): διάδοση επεξεργασίας/διαγραφής — χρειάζεται soft-delete tombstones ώστε να μη σβήνει κατά λάθος έγγραφα άλλων μηχανημάτων.

## v1.1.10 — 2026-07-01

**Υποπερίοδοι CE**
- Νέο: η ημερομηνία έναρξης μιας υποπεριόδου είναι πλέον επεξεργάσιμη (Ρυθμίσεις → Εργαστήριο → Επεξεργασία Υποπεριόδου). Όταν αλλάζει, όλα τα δείγματα της ίδιας CE period επανα-αξιολογούνται αυτόματα (`get_subperiod_for_date`) και αλλάζουν υποπερίοδο ανάλογα — λύνει την περίπτωση όπου η υποπερίοδος ξεκίνησε μία μέρα αργότερα από τα πραγματικά δείγματα και αυτά δεν έμπαιναν ποτέ στην περιοδική αναφορά.

**Γραμματοσειρές — πλήρης έλεγχος project**
- Fix: ο κωδικός δείγματος στις Εκθέσεις (αναζήτηση + περιοδική αναφορά) εμφανιζόταν σε γενική system monospace γραμματοσειρά αντί για το θέμα της εφαρμογής (IBM Plex Sans) — ίδια κλάση `.sample-code` με το Ιστορικό.
- Εντοπίστηκε το ίδιο μοτίβο (`font-family:monospace` γενικό, όχι IBM Plex Mono) σε ~20 σημεία σε 9 αρχεία (main-app.js, reports.js/html, settings.js/html, history.html, samples.html, library.js, main.css) — όλα διορθώθηκαν στο θέμα της εφαρμογής.
- Ευθυγραμμίστηκαν και οι οδηγοί δοκιμών (SE/MB/ΚΚΜ-ΠΛΚ guide pages) και τα (ανενεργά) SVG diagrams σε IBM Plex Sans, με τοπικό `@font-face` (ίδια bundled TTF, χωρίς εξάρτηση από Google Fonts).

## v1.1.9 — 2026-07-01

**Backup & Cloud Sync**
- Τοπικά backups: `VACUUM INTO` αντί ωμού αντιγράφου αρχείου (δεν χάνει δεδομένα που βρίσκονται ακόμα στο `-wal`), filename με ώρα (όχι μόνο ημέρα — άνοιγμα/κλείσιμο πολλές φορές την ίδια μέρα δεν "παγώνει" πια το backup), hash-based dedup — κρατά τα 7 πιο πρόσφατα distinct backups.
- Cloud sync (backup upload + "Επαναφορά από Cloud"): `rclone sync` → `rclone copy` και στις δύο κατευθύνσεις, ώστε δύο ξεχωριστές εγκαταστάσεις (διαχειριστής/χειριστής) που μοιράζονται το ίδιο cloud remote να μη σβήνουν η μία τα backups/PDF της άλλης.
- Νέο: προειδοποιητικό toast στο startup όταν ο τοπικός φάκελος δεδομένων διαφέρει από το `data_folder` της ενεργής CE period στη βάση (συμβαίνει όταν δημιουργείται νέα CE period σε άλλο μηχάνημα).
- Fix: `getDbPath()` σε dev mode μπορούσε να "κολλήσει" σε παλιό (stale) αρχείο βάσης δίπλα στην εφαρμογή αντί για το πραγματικό (userData) — τώρα πάντα ίδιο path με το ζωντανό backend.
- Αφαίρεση ξεπερασμένου `setup_db.sh` (η αυτόματη migration λογική του `db_manager.py` κάνει ήδη το ίδιο).
- Fix idempotency στο `seed_data.py` (fixed random seed έκανε reruns να σκάνε στο όριο suffix).

**Δελτίο Αποτελεσμάτων (Εκθέσεις)**
- Fix: όνομα προϊόντος εμφανιζόταν σπασμένο (π.χ. "ΑΜΜΟΣmm") αντί για "ΑΜΜΟΣ 0/4" — χρήση του ίδιου `App.formatProduct()` με Ιστορικό/Αρχική.
- Fix: λογότυπο δεν εμφανιζόταν καθόλου (λάθος relative path, σχετικό με reports.js αντί για index.html).
- Fix: επωνυμία εργαστηρίου ήταν hardcoded string αντί να διαβάζεται από τα στοιχεία εργαστηρίου.
- Fix: η προεπισκόπηση είχε άσχετη γραμματοσειρά (Arial/Times New Roman, ασύνδετη από το θέμα της εφαρμογής) — προστέθηκαν τοπικά bundled fonts (ίδια TTF με το reportlab backend) και η προεπισκόπηση ακολουθεί πλέον δυναμικά την επιλεγμένη "Γραμματοσειρά PDF" από τις Ρυθμίσεις.

## v1.1.7 — 2026-07-01

- ALL_IN υλικά (3Α, Ε4 κ.ά.) εμφανίζουν πλέον ΚΚΜ + ΠΛΚ + SE + MB (έχουν και λεπτόκοκκο και χονδρόκοκκο κλάσμα). Σωστή λογική ανά κατηγορία: ΛΕΠΤΟΚΟΚΚΟ / ΧΟΝΔΡΟΚΟΚΚΟ / ALL_IN.

## v1.1.6

- SE/MB κρύβονται για ΧΟΝΔΡΟΚΟΚΚΟ (μόνο ΛΕΠΤΟΚΟΚΚΟ και ALL_IN τα έχουν).

## v1.1.5

- Ονομασία προϊόντος με διαβάθμιση (ΑΜΜΟΣ 0/4 κ.ά.).
- ΠΛΚ κρύβεται για ΛΕΠΤΟΚΟΚΚΟ.
- Κωδικός δείγματος με ημερομηνία δείγματος (όχι σημερινή).
- Logo PDF bundled (`sys._MEIPASS`).
- Fix γραμματοσειράς `.sample-code`.

## v1.1.4

- Migration 011 — προεπιλεγμένη γραμματοσειρά PDF → IBM Plex Sans (ταιριάζει με UI).
- Νέο dropdown επιλογής γραμματοσειράς στις Ρυθμίσεις.

## v1.1.3

- Fix `/tmp/` → `os.tmpdir()` (Windows).
- Bundle 5 TTF γραμματοσειρών στο PyInstaller (Inter, IBM Plex Sans, Noto Sans, DejaVu Sans, Liberation Sans).

## v1.1.2

- FINAL backup (VACUUM INTO) κατά αλλαγή υποπεριόδου.
- Προειδοποιητικό modal για νέα CE περίοδο χωρίς Clean Start.

## v1.1.1

- Refactor `goToTests` (dead code), fix `LAB_DB_PATH` στο `drive-test-installed.mjs`.

## v1.1.0

- Fix `saveMB` ReferenceError (Μπλε Μεθυλενίου).

## v1.0.9

- Delete source/technician με FK protection.

## v1.0.8

- Fix rclone terminal — quote-stripping στο `cmd.exe /k`.

## v1.0.7

- Fix ελληνικών ονομάτων τεχνικών (UTF-8 wrapper στο PyInstaller).
- Fix rclone terminal (`windowsVerbatimArguments`).

## v1.0.6

- Αριθμός έκδοσης στο sidebar footer.

## v1.0.5

- rclone config button, fix spontaneous page navigation.

## v1.0.4

- DB path σε userData (όχι Program Files), fix `MIGRATIONS_DIR`, UTF-8 fix.

## v1.0.3

- IPC race fix (splash), init banner, CE history fix, rclone isolation.

## v1.0.2

- Βασική εφαρμογή, PyInstaller build, electron-builder NSIS installer.

---

## Εκκρεμότητες

### Μικρές / γνωστές

- **Installer ανυπόγραφος (unsigned)** — το Windows SmartScreen δείχνει προειδοποίηση "Windows protected your PC" κατά την εγκατάσταση, ειδικά μόλις κατέβει φρέσκο αρχείο. Επιβεβαιωμένο με `Get-AuthenticodeSignature` → `NotSigned`. Απόφαση: δεν αγοράζουμε πιστοποιητικό code signing προς το παρόν (κόστος) — λύση είναι ο χρήστης να πατήσει "More info" → "Run anyway". Αν χρειαστεί ποτέ, οι επιλογές είναι OV cert (~70-300$/έτος, reputation χτίζεται με τον χρόνο) ή EV cert (~300-500+$/έτος, άμεση SmartScreen αποδοχή).
- **Επιλεκτική επαναφορά backup** — η τωρινή restore αντικαθιστά ολόκληρη τη βάση. Θα ήταν καλύτερα: επιλέγεις backup, βλέπεις τι δείγματα/δοκιμές έχει, φέρνεις μόνο συγκεκριμένα.
- **Διάδοση επεξεργασίας/διαγραφής στη βιβλιοθήκη εγγράφων** — το additions-only sync (v1.1.11) δεν διαδίδει edits/deletes ακόμα, χρειάζεται soft-delete tombstones.
- **Προδιαγραφές ανά υλικό και υποπερίοδο** — νέος πίνακας `tbl_subperiod_specs(subperiod_id, product_id, mb, se, fl)`. Απαιτεί schema migration + UI + στατιστικά.
- **Remote backup retention** — μετά το fix v1.1.9 (sync→copy), τα backups στο cloud remote δεν κλαδεύονται πια αυτόματα (μεγαλώνουν επ' άπειρον). Αποδεκτό προς το παρόν.
- **Επικοινωνία με χειριστή — εκκρεμεί feedback (2026-07-02)**: "Σφάλμα αποθήκευσης PDF" κατά την Αποθήκευση από Εκθέσεις στο μηχάνημα του χειριστή (στον διαχειριστή δουλεύει κανονικά) — πιθανή αιτία, ο τοπικός Φάκελος Δεδομένων στον χειριστή δείχνει σε μη-προσβάσιμο path (βλ. `checkDataFolderMismatch`, μόνο toast προειδοποίησης, όχι auto-fix). Διαγνωστικό fix v1.1.12 δείχνει πλέον το πραγματικό μήνυμα σφάλματος. Εκκρεμεί: screenshot από τον χειριστή του νέου μηνύματος + του Φακέλου Δεδομένων στις Ρυθμίσεις. Ο χειριστής ανέφερε επίσης ότι το fix ημερομηνίας υποπεριόδου (v1.1.10) "δεν λειτούργησε καλά" — εκκρεμούν λεπτομέρειες.

### Μεγάλες / αναβλήθηκαν

- **ESM Redesign** — CommonJS → ESM, αναβάθμιση Electron 28→latest, puppeteer 21→latest (το puppeteer 22+ είναι ESM-only, γι' αυτό είναι pinned στο v21 προς το παρόν).
- **Linux installer** — AppImage ή deb μέσω electron-builder. Χρειάζεται ξεχωριστό PyInstaller build για Linux (ELF binary) και Linux build environment ή CI.
