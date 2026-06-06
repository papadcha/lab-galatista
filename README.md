# Εργαστήριο Λατομείων Γαλάτιστας

Σύστημα διαχείρισης ποιοτικού ελέγχου για εργαστήριο αδρανών υλικών. Καλύπτει τον πλήρη κύκλο ζωής δείγματος: καταχώρηση → εκτέλεση δοκιμών → έκδοση PDF δελτίου αποτελεσμάτων → αρχειοθέτηση.

---

## Δυνατότητες

- **Καταχώρηση δειγμάτων** — κωδικοποίηση, προϊόν, ημερομηνία, τεχνικός
- **Δοκιμές** — Κοκκομετρική ανάλυση (EN 933-1), Πλακοειδή (EN 933-3), Ισοδύναμο άμμου (EN 933-8), Μπλε μεθυλενίου (EN 933-9)
- **PDF δελτία αποτελεσμάτων** — αυτόματη παραγωγή με λογότυπο, CE στοιχεία, διαγράμματα κοκκομετρίας
- **Περιοδική αναφορά** — συγκεντρωτικά αποτελέσματα ανά υποπερίοδο
- **Βιβλιοθήκη PDF** — μαζική παραγωγή για όλα τα ολοκληρωμένα δείγματα
- **Διαχείριση CE Period** — περίοδοι/υποπερίοδοι, ειδοποιήσεις λήξης
- **Archive Mode** — προβολή και επεξεργασία παλιών περιόδων παράλληλα με την τρέχουσα
- **Clean Start** — κλείσιμο περιόδου με αυτόματο backup + παραγωγή βιβλιοθήκης PDF
- **Cloud Sync** — συγχρονισμός DB και PDF μέσω rclone (MEGA, Google Drive, κ.ά.)
- **Βιβλιοθήκη Εγγράφων** — προδιαγραφές, πιστοποιητικά, εξοπλισμός με έλεγχο έκδοσης
- **Αποστολή email** — αποστολή PDF δελτίων μέσω SMTP

---

## Τεχνολογίες

| Στρώμα | Τεχνολογία |
|--------|-----------|
| UI | Electron 28 |
| Backend | Python 3 (ReportLab, SQLite) |
| Βάση δεδομένων | SQLite (migrations 001–010) |
| Cloud | rclone |
| Email | nodemailer |

---

## Απαιτήσεις

- **Node.js** 18+ και npm
- **Python** 3.10+
- **rclone** (για cloud sync)
- `pip install reportlab`

---

## Εγκατάσταση (Linux)

```bash
# 1. Clone
git clone https://github.com/papadcha/lab-galatista
cd lab-galatista

# 2. Node dependencies
npm install

# 3. Python dependencies
pip install reportlab --break-system-packages

# 4. Εκκίνηση
npm start
```

Κατά την πρώτη εκκίνηση εμφανίζεται ο **οδηγός αρχικής ρύθμισης** (3 βήματα):
1. Στοιχεία εργαστηρίου
2. CE Period & φάκελος δεδομένων
3. Υποπερίοδος (προαιρετικό)

---

## Εγκατάσταση (macOS)

Ίδια βήματα με Linux. Για εκτέλεση χωρίς code signing:
```bash
# Αν το macOS μπλοκάρει την εφαρμογή:
xattr -d com.apple.quarantine /path/to/app
```

---

## Ρύθμιση Cloud Sync (rclone)

```bash
# Διαμόρφωση remote (π.χ. MEGA)
rclone config

# Στη συνέχεια από τις Ρυθμίσεις → Αποθήκευση:
# - Επιλογή remote
# - Ορισμός Remote Path (π.χ. mega:lab-galatista)
```

---

## Δομή φακέλου δεδομένων

```
LabData/
└── CE_1128-CPR-0196_2026-2028/
    ├── pdf/
    │   ├── ΑΜΜ0-4/
    │   │   └── ΓΑΛ-2026-0001.pdf
    │   └── ΓΡΒ4-16/
    ├── backup/
    │   └── lab_20260101_20261231_FINAL.db
    └── statistics/
        └── statistics_ΑΜΜΟΣ_20260101_20261231.pdf
```

---

## Δομή Project

```
lab-galatista/
├── main.js                  # Electron main process
├── preload.js               # IPC bridge
├── calculations.py          # Υπολογισμοί δοκιμών
├── standards.json           # Τελευταίες εκδόσεις προδιαγραφών EN
├── backend/
│   └── server.py            # Python backend (ReportLab, dispatcher)
├── database/
│   ├── db_manager.py        # SQLite functions
│   ├── schema.sql
│   └── migration_001-010.sql
└── src/
    ├── main-app.js          # Navigation, wizard, archive mode
    ├── index.html
    └── pages/
        ├── dashboard/
        ├── samples/
        ├── history/
        ├── reports/
        ├── library/
        └── settings/
```

---

## Ανάπτυξη

```bash
# Εκκίνηση με DevTools
npm start

# Deploy αλλαγών στο GitHub
./deploy.sh "μήνυμα commit"
```

---

## Άδεια

ISC — Λατομεία Γαλάτιστας ΑΕ
