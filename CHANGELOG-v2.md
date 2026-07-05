# Changelog — v2.0.0 (ESM Redesign)

Ιστορικό της δουλειάς στο branch `v2-esm-redesign` (βλ. TODOLIST.md για τη
στρατηγική: master συνεχίζει κανονικά v1.x, αλλαγές του περνάνε περιοδικά
εδώ, το αντίθετο όχι μέχρι να ολοκληρωθεί → merge + tag v2.0.0).

Κάθε καταχώρηση παραθέτει και τη **λίστα αρχείων** που άλλαξαν, ώστε να
είναι εύκολο να δοθούν σε Gemini/ChatGPT για έλεγχο χωρίς να χρειάζεται να
ψάχνει κανείς το git diff.

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
