-- ============================================================
--  MIGRATION 002 — Πηγές Υλικού, Κωδικοί Προϊόντων,
--                  Νέα Λογική Κωδικού Δείγματος,
--                  Προδιαγραφές Κοκκομετρίας
--  Έκδοση: 2.0
--  Αναιρέσιμη με: rollback_002.sql
-- ============================================================
--
--  Αλλαγές:
--   1. Νέος πίνακας tbl_sources (πηγές/λατομεία υλικού)
--   2. tbl_products: νέα στήλη 'code' (πχ ΑΜΜ, ΓΡΒ, 3Α)
--   3. tbl_samples:  νέα στήλη 'source_id' FK → tbl_sources
--                    νέα στήλη 'entry_date' (ημερομηνία εισαγωγής)
--   4. tbl_laboratory: αφαίρεση sample_prefix, sample_counter
--                      (μεταφέρονται στο tbl_sources)
--   5. tbl_specifications: εισαγωγή ορίων EN 12620 για ΑΜΜΟ 0/4
--   6. Backfill υπαρχόντων δειγμάτων με source_id=1 (ΓΑΛ)
-- ============================================================

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- ============================================================
--  ΒΗΜΑ 1: Νέος πίνακας tbl_sources
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT NOT NULL UNIQUE,   -- πχ 'ΓΑΛ'
    name            TEXT NOT NULL,          -- πχ 'Λατομείο Γαλάτιστας'
    location        TEXT,                   -- διεύθυνση/περιοχή
    sample_counter  INTEGER DEFAULT 0,      -- global counter (μηδέν = ανά ημέρα)
    active          INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Εισαγωγή της υπάρχουσας πηγής από tbl_laboratory
INSERT INTO tbl_sources (id, code, name, location, active)
SELECT 1,
       COALESCE(sample_prefix, 'ΓΑΛ'),
       name,
       address,
       1
  FROM tbl_laboratory WHERE id = 1;

-- ============================================================
--  ΒΗΜΑ 2: tbl_products — προσθήκη στήλης 'code'
-- ============================================================

ALTER TABLE tbl_products ADD COLUMN code TEXT;

-- Backfill κωδικών
UPDATE tbl_products SET code = 'ΑΜΜ' WHERE id = 1;  -- ΑΜΜΟΣ 0/4
UPDATE tbl_products SET code = 'ΓΡΒ' WHERE id = 2;  -- ΓΑΡΜΠΙΛΙ 4/16
UPDATE tbl_products SET code = 'ΣΝΤ' WHERE id = 3;  -- ΣΥΝΤΡΙΜΜΑ 16/31.5
UPDATE tbl_products SET code = '3Α'  WHERE id = 4;  -- 3Α 0/31.5
UPDATE tbl_products SET code = 'Ε4'  WHERE id = 5;  -- Ε4 0/31.5
UPDATE tbl_products SET code = 'ΣΚΥ' WHERE id = 6;  -- ΣΚΥΡΑ 31.5/63

-- ============================================================
--  ΒΗΜΑ 3: tbl_samples — προσθήκη source_id + entry_date
-- ============================================================

ALTER TABLE tbl_samples ADD COLUMN source_id  INTEGER REFERENCES tbl_sources(id);
ALTER TABLE tbl_samples ADD COLUMN entry_date TEXT;

-- Backfill: όλα τα υπάρχοντα δείγματα → πηγή ΓΑΛ (id=1)
UPDATE tbl_samples SET source_id  = 1;
UPDATE tbl_samples SET entry_date = created_at;

CREATE INDEX IF NOT EXISTS idx_samples_source
    ON tbl_samples(source_id);

CREATE INDEX IF NOT EXISTS idx_samples_entry_date
    ON tbl_samples(entry_date);

-- ============================================================
--  ΒΗΜΑ 4: tbl_laboratory — καθαρισμός παλιών πεδίων
--  ΣΗΜ: Στο SQLite δεν υπάρχει DROP COLUMN πριν την έκδοση 3.35
--       Κάνουμε rebuild του πίνακα χωρίς τα παλιά πεδία.
-- ============================================================

CREATE TABLE tbl_laboratory_new (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    address         TEXT,
    phone           TEXT,
    email           TEXT,
    logo_path       TEXT,
    ce_number       TEXT,
    ce_valid_from   TEXT,
    ce_valid_to     TEXT,
    ce_body         TEXT
);

INSERT INTO tbl_laboratory_new
    (id, name, address, phone, email, logo_path,
     ce_number, ce_valid_from, ce_valid_to, ce_body)
SELECT id, name, address, phone, email, logo_path,
       ce_number, ce_valid_from, ce_valid_to, ce_body
  FROM tbl_laboratory;

DROP TABLE tbl_laboratory;
ALTER TABLE tbl_laboratory_new RENAME TO tbl_laboratory;

-- ============================================================
--  ΒΗΜΑ 5: tbl_specifications — προδιαγραφές EN 12620
--  Μόνο για ΑΜΜΟ 0/4 (product_id=1) ως αρχικές τιμές.
--  Οι υπόλοιπες εισάγονται από τη σελίδα Ρυθμίσεις.
--
--  Πηγή: EN 12620:2002+A1:2008, Πίνακας 1
--  Κατηγορία GA85 (τυπική για ΑΜΜΟ σκυροδέματος)
-- ============================================================

INSERT OR IGNORE INTO tbl_specifications
    (product_id, spec_type, spec_name, sieve_mm, lower_limit, upper_limit)
VALUES
    -- EN 12620 — ΑΜΜΟΣ 0/4 (GA85)
    (1, 'EN', 'EN 12620 GA85', 4,     85,  100),
    (1, 'EN', 'EN 12620 GA85', 2,     NULL, NULL),
    (1, 'EN', 'EN 12620 GA85', 1,     NULL, NULL),
    (1, 'EN', 'EN 12620 GA85', 0.5,   NULL, NULL),
    (1, 'EN', 'EN 12620 GA85', 0.25,  NULL, NULL),
    (1, 'EN', 'EN 12620 GA85', 0.125, NULL, NULL),
    (1, 'EN', 'EN 12620 GA85', 0.063, 0,   15);

-- ============================================================
--  ΒΗΜΑ 6: Ενημέρωση schema version
-- ============================================================

INSERT INTO tbl_schema_version (version, description)
VALUES (2, 'Sources + product codes + new sample code logic + specs');

COMMIT;
PRAGMA foreign_keys = ON;

-- Επαλήθευση
SELECT 'Schema version: ' || MAX(version) AS status FROM tbl_schema_version;
SELECT 'Sources: '        || COUNT(*)     AS status FROM tbl_sources;
SELECT 'Products with code: ' || COUNT(*) AS status FROM tbl_products WHERE code IS NOT NULL;
SELECT 'Samples with source: '|| COUNT(*) AS status FROM tbl_samples WHERE source_id IS NOT NULL;
SELECT 'Specs inserted: ' || COUNT(*)     AS status FROM tbl_specifications;
