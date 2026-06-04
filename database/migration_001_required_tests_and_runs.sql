-- ============================================================
--  MIGRATION 001 — Required Tests & Multiple Runs
--  Έκδοση: 1.1
--  Ημερομηνία: 2026-05
--  Αναιρέσιμη με: rollback_001.sql
-- ============================================================
--
--  Αλλαγές:
--   1. Νέα κατηγορία 'ALL_IN' στα προϊόντα 3Α, Ε4
--   2. Νέος πίνακας tbl_required_tests (πλάνο δοκιμών ανά δείγμα)
--   3. Σε όλους τους test tables (sieve, flakiness, mb, se):
--      • Αφαίρεση UNIQUE από sample_id (επιτρέπονται πολλαπλά runs)
--      • Νέα στήλη run_no         INTEGER DEFAULT 1
--      • Νέα στήλη is_official    INTEGER DEFAULT 1
--      • Νέα στήλη rejected_reason TEXT
--      • Partial unique index: ένα μόνο is_official=1 ανά sample
--   4. Backfill: όλα τα υπάρχοντα records παίρνουν run_no=1, is_official=1
--   5. Αυτόματη δημιουργία tbl_required_tests για υπάρχοντα δείγματα
--      βάσει κατηγορίας προϊόντος
-- ============================================================

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- ============================================================
--  ΒΗΜΑ 1: Επανακατηγοριοποίηση 3Α και Ε4 σε ALL_IN
-- ============================================================

UPDATE tbl_products
   SET category = 'ALL_IN'
 WHERE id IN (4, 5)        -- 3Α και Ε4
   AND category != 'ALL_IN';

-- ============================================================
--  ΒΗΜΑ 2: Δημιουργία πίνακα tbl_required_tests
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_required_tests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id   INTEGER NOT NULL,
    test_type   TEXT    NOT NULL,        -- 'sieve' | 'flakiness' | 'mb' | 'se'
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE (sample_id, test_type),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id) ON DELETE CASCADE,
    CHECK (test_type IN ('sieve', 'flakiness', 'mb', 'se'))
);

CREATE INDEX IF NOT EXISTS idx_required_tests_sample
    ON tbl_required_tests(sample_id);

-- ============================================================
--  ΒΗΜΑ 3α: Αναβάθμιση tbl_sieve_analysis
-- ============================================================

CREATE TABLE tbl_sieve_analysis_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id       INTEGER NOT NULL,
    date            TEXT NOT NULL,
    weight_initial  REAL,
    weight_dry      REAL,
    weight_washed   REAL,
    wash_loss_pct   REAL,
    comments        TEXT,
    run_no          INTEGER DEFAULT 1,
    is_official     INTEGER DEFAULT 1,
    rejected_reason TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id) ON DELETE CASCADE
);

INSERT INTO tbl_sieve_analysis_new
    (id, sample_id, date, weight_initial, weight_dry, weight_washed,
     wash_loss_pct, comments, run_no, is_official, rejected_reason, created_at)
SELECT
    id, sample_id, date, weight_initial, weight_dry, weight_washed,
    wash_loss_pct, comments, 1, 1, NULL, created_at
FROM tbl_sieve_analysis;

DROP TABLE tbl_sieve_analysis;
ALTER TABLE tbl_sieve_analysis_new RENAME TO tbl_sieve_analysis;

CREATE UNIQUE INDEX idx_sieve_one_official
    ON tbl_sieve_analysis(sample_id)
    WHERE is_official = 1;

-- ============================================================
--  ΒΗΜΑ 3β: Αναβάθμιση tbl_flakiness
-- ============================================================

CREATE TABLE tbl_flakiness_new (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id           INTEGER NOT NULL,
    sieve_analysis_id   INTEGER,
    date                TEXT NOT NULL,
    fi_index            REAL,
    comments            TEXT,
    run_no              INTEGER DEFAULT 1,
    is_official         INTEGER DEFAULT 1,
    rejected_reason     TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id) ON DELETE CASCADE,
    FOREIGN KEY (sieve_analysis_id) REFERENCES tbl_sieve_analysis(id)
);

INSERT INTO tbl_flakiness_new
    (id, sample_id, sieve_analysis_id, date, fi_index, comments,
     run_no, is_official, rejected_reason, created_at)
SELECT
    id, sample_id, sieve_analysis_id, date, fi_index, comments,
    1, 1, NULL, created_at
FROM tbl_flakiness;

DROP TABLE tbl_flakiness;
ALTER TABLE tbl_flakiness_new RENAME TO tbl_flakiness;

CREATE UNIQUE INDEX idx_flakiness_one_official
    ON tbl_flakiness(sample_id)
    WHERE is_official = 1;

-- ============================================================
--  ΒΗΜΑ 3γ: Αναβάθμιση tbl_methylene_blue
-- ============================================================

CREATE TABLE tbl_methylene_blue_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id       INTEGER NOT NULL,
    date            TEXT NOT NULL,
    weight_sample   REAL DEFAULT 200,
    water_volume    REAL DEFAULT 500,
    volume_initial  REAL DEFAULT 0,
    volume_final    REAL,
    mb_value        REAL,
    comments        TEXT,
    run_no          INTEGER DEFAULT 1,
    is_official     INTEGER DEFAULT 1,
    rejected_reason TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id) ON DELETE CASCADE
);

INSERT INTO tbl_methylene_blue_new
    (id, sample_id, date, weight_sample, water_volume, volume_initial,
     volume_final, mb_value, comments, run_no, is_official, rejected_reason, created_at)
SELECT
    id, sample_id, date, weight_sample, water_volume, volume_initial,
    volume_final, mb_value, comments, 1, 1, NULL, created_at
FROM tbl_methylene_blue;

DROP TABLE tbl_methylene_blue;
ALTER TABLE tbl_methylene_blue_new RENAME TO tbl_methylene_blue;

CREATE UNIQUE INDEX idx_mb_one_official
    ON tbl_methylene_blue(sample_id)
    WHERE is_official = 1;

-- ============================================================
--  ΒΗΜΑ 3δ: Αναβάθμιση tbl_sand_equivalent
-- ============================================================

CREATE TABLE tbl_sand_equivalent_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id       INTEGER NOT NULL,
    date            TEXT NOT NULL,
    se_final        REAL,
    requires_3rd    INTEGER DEFAULT 0,
    comments        TEXT,
    run_no          INTEGER DEFAULT 1,
    is_official     INTEGER DEFAULT 1,
    rejected_reason TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id) ON DELETE CASCADE
);

INSERT INTO tbl_sand_equivalent_new
    (id, sample_id, date, se_final, requires_3rd, comments,
     run_no, is_official, rejected_reason, created_at)
SELECT
    id, sample_id, date, se_final, requires_3rd, comments,
    1, 1, NULL, created_at
FROM tbl_sand_equivalent;

DROP TABLE tbl_sand_equivalent;
ALTER TABLE tbl_sand_equivalent_new RENAME TO tbl_sand_equivalent;

CREATE UNIQUE INDEX idx_se_one_official
    ON tbl_sand_equivalent(sample_id)
    WHERE is_official = 1;

-- ============================================================
--  ΒΗΜΑ 4: Backfill tbl_required_tests για υπάρχοντα δείγματα
-- ============================================================
--
--  Λογική: για κάθε υπάρχον δείγμα, δημιουργούμε required_tests
--  βάσει της κατηγορίας του προϊόντος:
--    ΛΕΠΤΟΚΟΚΚΟ → sieve, mb, se
--    ΧΟΝΔΡΟΚΟΚΚΟ → sieve, flakiness
--    ALL_IN     → sieve, flakiness, mb, se
-- ============================================================

-- Κοκκομετρία: σε όλα
INSERT OR IGNORE INTO tbl_required_tests (sample_id, test_type, notes)
SELECT s.id, 'sieve', 'Auto-generated from migration 001'
  FROM tbl_samples s
  JOIN tbl_products p ON s.product_id = p.id
 WHERE p.category IN ('ΛΕΠΤΟΚΟΚΚΟ', 'ΧΟΝΔΡΟΚΟΚΚΟ', 'ALL_IN');

-- Πλακοειδή: στα ΧΟΝΔΡΟΚΟΚΚΟ και ALL_IN
INSERT OR IGNORE INTO tbl_required_tests (sample_id, test_type, notes)
SELECT s.id, 'flakiness', 'Auto-generated from migration 001'
  FROM tbl_samples s
  JOIN tbl_products p ON s.product_id = p.id
 WHERE p.category IN ('ΧΟΝΔΡΟΚΟΚΚΟ', 'ALL_IN');

-- MB: στα ΛΕΠΤΟΚΟΚΚΟ και ALL_IN
INSERT OR IGNORE INTO tbl_required_tests (sample_id, test_type, notes)
SELECT s.id, 'mb', 'Auto-generated from migration 001'
  FROM tbl_samples s
  JOIN tbl_products p ON s.product_id = p.id
 WHERE p.category IN ('ΛΕΠΤΟΚΟΚΚΟ', 'ALL_IN');

-- SE: στα ΛΕΠΤΟΚΟΚΚΟ και ALL_IN
INSERT OR IGNORE INTO tbl_required_tests (sample_id, test_type, notes)
SELECT s.id, 'se', 'Auto-generated from migration 001'
  FROM tbl_samples s
  JOIN tbl_products p ON s.product_id = p.id
 WHERE p.category IN ('ΛΕΠΤΟΚΟΚΚΟ', 'ALL_IN');

-- ============================================================
--  ΒΗΜΑ 5: Καταγραφή έκδοσης schema (για μελλοντικά migrations)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT DEFAULT (datetime('now')),
    description TEXT
);

INSERT INTO tbl_schema_version (version, description)
VALUES (1, 'Required tests + multiple runs + ALL_IN category');

-- ============================================================
--  COMMIT
-- ============================================================

COMMIT;
PRAGMA foreign_keys = ON;

-- Επαλήθευση
SELECT 'Schema version: ' || version AS status FROM tbl_schema_version;
SELECT 'Total samples: '       || COUNT(*) AS status FROM tbl_samples;
SELECT 'Required tests rows: ' || COUNT(*) AS status FROM tbl_required_tests;
SELECT 'ALL_IN products: '     || COUNT(*) AS status FROM tbl_products WHERE category = 'ALL_IN';
