-- ============================================================
-- Migration 009: CE Periods & Subperiods
-- ΔAiγμα LiMS
-- Έκδοση : 0.99.0
-- Ημ/νία  : 2026-06-02
-- ============================================================
-- Νέοι πίνακες:
--   tbl_ce_periods   — μία εγγραφή ανά CE period
--   tbl_subperiods   — υποπερίοδοι εντός CE period
--                      (επανέλεγχος εξωτερικού εργαστηρίου)
-- Αλλαγές σε υπάρχοντες:
--   tbl_samples      — + subperiod_id
-- ============================================================

PRAGMA foreign_keys = ON;

-- ── CE Periods ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_ce_periods (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ce_number       TEXT NOT NULL,          -- πχ 1128-CPR-0196
    ce_body         TEXT,                   -- πχ EUROCERT Α.Ε.
    valid_from      TEXT NOT NULL,          -- ημ/νία έναρξης (YYYY-MM-DD)
    valid_to        TEXT NOT NULL,          -- ημ/νία λήξης   (YYYY-MM-DD)
    data_folder     TEXT,                   -- απόλυτο path φακέλου δεδομένων
    active          INTEGER DEFAULT 0,      -- 1 = τρέχουσα περίοδος
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ── Υποπερίοδοι ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_subperiods (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ce_period_id        INTEGER NOT NULL,
    lab_report_number   TEXT,               -- αριθμός έκθεσης εξωτ. εργαστηρίου
    valid_from          TEXT NOT NULL,      -- ημ/νία έναρξης υποπεριόδου
    notes               TEXT,              -- προαιρετικές παρατηρήσεις
    pdf_subfolder       INTEGER DEFAULT 0, -- 1 = ξεχωριστός υποφάκελος στα PDF
    -- Τιμές από έκθεση εξωτερικού εργαστηρίου
    ext_mb_value        REAL,              -- MB (g/kg)
    ext_se_value        REAL,              -- SE (%)
    ext_fl_value        REAL,              -- Δείκτης Πλακοειδούς (%)
    ext_sieve_results   TEXT,              -- JSON: [{sieve_mm, passing_pct}, ...]
    active              INTEGER DEFAULT 0, -- 1 = τρέχουσα υποπερίοδος
    created_at          TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (ce_period_id) REFERENCES tbl_ce_periods(id)
);

-- ── Προσθήκη subperiod_id στα δείγματα ───────────────────
-- (χρησιμοποιεί ALTER TABLE γιατί το δεν υποστηρίζει ADD COLUMN με FK)
ALTER TABLE tbl_samples ADD COLUMN subperiod_id INTEGER
    REFERENCES tbl_subperiods(id);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ce_periods_active
    ON tbl_ce_periods(active);
CREATE INDEX IF NOT EXISTS idx_subperiods_ce_period
    ON tbl_subperiods(ce_period_id);
CREATE INDEX IF NOT EXISTS idx_subperiods_active
    ON tbl_subperiods(active);
CREATE INDEX IF NOT EXISTS idx_samples_subperiod
    ON tbl_samples(subperiod_id);

-- ── Αρχικοποίηση από υπάρχοντα στοιχεία εργαστηρίου ─────
-- Δημιουργεί την πρώτη CE period από τα στοιχεία που υπάρχουν ήδη
-- στο tbl_laboratory, ώστε τα παλιά δείγματα να έχουν context.
INSERT OR IGNORE INTO tbl_ce_periods (
    id, ce_number, ce_body, valid_from, valid_to, active
)
SELECT
    1,
    COALESCE(ce_number, 'ΑΓΝΩΣΤΟ'),
    ce_body,
    COALESCE(ce_valid_from, '2000-01-01'),
    COALESCE(ce_valid_to,   '2099-12-31'),
    1
FROM tbl_laboratory WHERE id = 1;

-- Δημιουργεί την πρώτη υποπερίοδο (χωρίς στοιχεία εξωτ. εργαστηρίου)
INSERT OR IGNORE INTO tbl_subperiods (
    id, ce_period_id, valid_from, notes, active
) VALUES (
    1, 1,
    (SELECT COALESCE(ce_valid_from, '2000-01-01') FROM tbl_laboratory WHERE id=1),
    'Αρχική υποπερίοδος — από migration',
    1
);

-- Ενημέρωση υπαρχόντων δειγμάτων με την αρχική υποπερίοδο
UPDATE tbl_samples SET subperiod_id = 1 WHERE subperiod_id IS NULL;

