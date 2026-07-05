-- ============================================================
-- ΒΑΣΗ ΔΕΔΟΜΕΝΩΝ ΕΡΓΑΣΤΗΡΙΟΥ ΛΑΤΟΜΕΙΩΝ ΓΑΛΑΤΙΣΤΑΣ
-- Έκδοση: 1.0 → 0.99.1 (migration 009)
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- ΡΥΘΜΙΣΕΙΣ
-- ============================================================

-- Στοιχεία Εργαστηρίου
CREATE TABLE IF NOT EXISTS tbl_laboratory (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    address       TEXT,
    phone         TEXT,
    email         TEXT,
    logo_path     TEXT,
    ce_number     TEXT,
    ce_valid_from TEXT,
    ce_valid_to   TEXT,
    ce_body       TEXT,
    pdf_font      TEXT DEFAULT 'IBMPlexSans'
);

-- Τεχνικοί
CREATE TABLE IF NOT EXISTS tbl_technicians (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    active      INTEGER DEFAULT 1  -- 1=ενεργός, 0=ανενεργός
);

-- Προϊόντα Λατομείου
CREATE TABLE IF NOT EXISTS tbl_products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    d_min         REAL NOT NULL,
    d_max         REAL NOT NULL,
    standard      TEXT NOT NULL,
    category      TEXT,
    active        INTEGER DEFAULT 1,
    code          TEXT,
    material_type TEXT
);

-- Κόσκινα ανά Προϊόν (σειρά κοσκινισμού)
CREATE TABLE IF NOT EXISTS tbl_product_sieves (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL,
    sieve_mm    REAL NOT NULL,          -- άνοιγμα κόσκινου (mm)
    sieve_order INTEGER NOT NULL,       -- σειρά εμφάνισης
    FOREIGN KEY (product_id) REFERENCES tbl_products(id),
    UNIQUE (product_id, sieve_mm)       -- αποτρέπει διπλότυπα
);

-- Προδιαγραφές (όρια κοκκομετρίας)
CREATE TABLE IF NOT EXISTS tbl_specifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      INTEGER NOT NULL,
    spec_type       TEXT NOT NULL,      -- EN / ΕΤΕΠ / CE / INTERNAL
    spec_name       TEXT NOT NULL,      -- πχ "EN 12620", "ΕΤΕΠ 05-03-11-04"
    sieve_mm        REAL NOT NULL,
    lower_limit     REAL,               -- κατώτερο όριο % διερχόμενου
    upper_limit     REAL,               -- ανώτερο όριο % διερχόμενου
    FOREIGN KEY (product_id) REFERENCES tbl_products(id)
);

-- Migration 013: override κοκκομετρίας ανά υποπερίοδο (all-or-nothing
-- ανά spec_name — βλ. get_effective_specifications στο db_manager.py)
CREATE TABLE IF NOT EXISTS tbl_subperiod_specifications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    subperiod_id  INTEGER NOT NULL,
    product_id    INTEGER NOT NULL,
    spec_type     TEXT NOT NULL,
    spec_name     TEXT NOT NULL,
    sieve_mm      REAL NOT NULL,
    lower_limit   REAL,
    upper_limit   REAL,
    FOREIGN KEY (subperiod_id) REFERENCES tbl_subperiods(id),
    FOREIGN KEY (product_id) REFERENCES tbl_products(id)
);
CREATE INDEX IF NOT EXISTS idx_subperiod_specifications_lookup
    ON tbl_subperiod_specifications(subperiod_id, product_id);

-- ============================================================
-- ΔΕΙΓΜΑΤΑ
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_samples (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT NOT NULL UNIQUE,   -- πχ ΓΑΛ-2025-0042
    date            TEXT NOT NULL,          -- ημερομηνία δειγματοληψίας
    product_id      INTEGER NOT NULL,
    technician_id   INTEGER,
    location        TEXT,                   -- σημείο δειγματοληψίας
    batch           TEXT,                   -- παρτίδα παραγωγής
    comments        TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    subperiod_id    INTEGER,
    source_id       INTEGER REFERENCES tbl_sources(id),
    entry_date      TEXT,
    FOREIGN KEY (product_id) REFERENCES tbl_products(id),
    FOREIGN KEY (technician_id) REFERENCES tbl_technicians(id),
    FOREIGN KEY (subperiod_id) REFERENCES tbl_subperiods(id)
);

-- ============================================================
-- ΔΟΚΙΜΗ 1: ΚΟΚΚΟΜΕΤΡΙΑ (EN 933-1)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_sieve_analysis (
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_sieve_one_official
    ON tbl_sieve_analysis(sample_id) WHERE is_official = 1;

-- Αποτελέσματα κόσκινων
CREATE TABLE IF NOT EXISTS tbl_sieve_results (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sieve_analysis_id   INTEGER NOT NULL,
    sieve_mm            REAL NOT NULL,
    weight_retained     REAL,           -- Βάρος συγκρατούμενου (g)
    passing_percent     REAL,           -- % Διερχόμενο (υπολογίζεται)
    FOREIGN KEY (sieve_analysis_id) REFERENCES tbl_sieve_analysis(id)
);

-- ============================================================
-- ΔΟΚΙΜΗ 2: ΠΛΑΚΟΕΙΔΗ (EN 933-3)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_flakiness (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id           INTEGER NOT NULL,
    sieve_analysis_id   INTEGER,
    date                TEXT NOT NULL,
    fi_index            REAL,
    comments            TEXT,
    weight_m0           REAL,
    run_no              INTEGER DEFAULT 1,
    is_official         INTEGER DEFAULT 1,
    rejected_reason     TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id) ON DELETE CASCADE,
    FOREIGN KEY (sieve_analysis_id) REFERENCES tbl_sieve_analysis(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flakiness_one_official
    ON tbl_flakiness(sample_id) WHERE is_official = 1;

-- Αποτελέσματα ανά κλάσμα
CREATE TABLE IF NOT EXISTS tbl_flakiness_results (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    flakiness_id    INTEGER NOT NULL,
    sieve_mm        REAL NOT NULL,      -- τετραγωνικό κόσκινο (mm)
    weight_fraction REAL,               -- βάρος κλάσματος (g)
                                        -- από κοκκομετρία αν συνδεδεμένη
    weight_passing  REAL,               -- βάρος διερχόμενου ραβδωτού (g)
    FOREIGN KEY (flakiness_id) REFERENCES tbl_flakiness(id)
);

-- ============================================================
-- ΔΟΚΙΜΗ 3: ΜΠΛΕ ΜΕΘΥΛΕΝΙΟΥ (EN 933-9)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_methylene_blue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id       INTEGER NOT NULL,
    date            TEXT NOT NULL,
    weight_sample   REAL DEFAULT 200,
    water_volume    REAL DEFAULT 500,
    volume_initial  REAL DEFAULT 0,
    volume_final    REAL,
    mb_value        REAL,
    comments        TEXT,
    weight_m0       REAL,
    moisture_pct    REAL,
    run_no          INTEGER DEFAULT 1,
    is_official     INTEGER DEFAULT 1,
    rejected_reason TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mb_one_official
    ON tbl_methylene_blue(sample_id) WHERE is_official = 1;

-- ============================================================
-- ΔΟΚΙΜΗ 4: ΙΣΟΔΥΝΑΜΟ ΑΜΜΟΥ (EN 933-8)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_sand_equivalent (
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_se_one_official
    ON tbl_sand_equivalent(sample_id) WHERE is_official = 1;

-- Μετρήσεις SE (2 ή 3)
CREATE TABLE IF NOT EXISTS tbl_se_measurements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    se_id           INTEGER NOT NULL,
    measurement_no  INTEGER NOT NULL,   -- 1, 2, ή 3
    h1              REAL,               -- ύψος ιζήματος άμμου (mm)
    h2              REAL,               -- ύψος ιζήματος αργίλου (mm)
    se_value        REAL,               -- SE% = (h1/h2)*100 (υπολογίζεται)
    FOREIGN KEY (se_id) REFERENCES tbl_sand_equivalent(id)
);

-- ============================================================
-- INDEXES για γρήγορη αναζήτηση
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_samples_code 
    ON tbl_samples(code);
CREATE INDEX IF NOT EXISTS idx_samples_date 
    ON tbl_samples(date);
CREATE INDEX IF NOT EXISTS idx_samples_product 
    ON tbl_samples(product_id);
CREATE INDEX IF NOT EXISTS idx_sieve_results_analysis 
    ON tbl_sieve_results(sieve_analysis_id);
CREATE INDEX IF NOT EXISTS idx_flakiness_results 
    ON tbl_flakiness_results(flakiness_id);
CREATE INDEX IF NOT EXISTS idx_se_measurements 
    ON tbl_se_measurements(se_id);

-- Πηγές υλικού
CREATE TABLE IF NOT EXISTS tbl_sources (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    location       TEXT,
    sample_counter INTEGER DEFAULT 0,
    active         INTEGER DEFAULT 1,
    created_at     TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- ΑΡΧΙΚΑ ΔΕΔΟΜΕΝΑ
-- ============================================================

-- Στοιχεία Εργαστηρίου
INSERT OR IGNORE INTO tbl_laboratory (
    id, name, address, ce_number, ce_valid_from, ce_valid_to, ce_body
) VALUES (
    1,
    'ΛΑΤΟΜΕΙΑ ΓΑΛΑΤΙΣΤΑΣ ΑΕ',
    'Θέση «Προφήτης Ηλίας», Γαλάτιστα, Χαλκιδική, 63073',
    '1128-CPR-0196',
    '01/04/2025',
    '31/03/2028',
    'EUROCERT Α.Ε.'
);

-- Πηγή υλικού (ΓΑΛ = Λατομεία Γαλάτιστας)
INSERT OR IGNORE INTO tbl_sources (id, code, name, location, active) VALUES
    (1, 'ΓΑΛ', 'ΛΑΤΟΜΕΙΑ ΓΑΛΑΤΙΣΤΑΣ ΑΕ', 'Θέση «Προφήτης Ηλίας», Γαλάτιστα', 1);

-- Προϊόντα από CE πιστοποιητικό
INSERT OR IGNORE INTO tbl_products (id, name, d_min, d_max, standard, category, code) VALUES
    (1, 'ΑΜΜΟΣ',     0,    4,    'EN12620/EN13043/EN13242', 'ΛΕΠΤΟΚΟΚΚΟ',  'ΑΜΜ'),
    (2, 'ΓΑΡΜΠΙΛΙ',  4,    16,   'EN12620/EN13043',         'ΧΟΝΔΡΟΚΟΚΚΟ', 'ΓΡΒ'),
    (3, 'ΣΥΝΤΡΙΜΜΑ',  16,   31.5, 'EN12620/EN13043',         'ΧΟΝΔΡΟΚΟΚΚΟ', 'ΣΝΤ'),
    (4, '3Α',         0,    31.5, 'EN13242',                 'ALL_IN',      '3Α'),
    (5, 'Ε4',         0,    31.5, 'EN13242',                 'ALL_IN',      'Ε4'),
    (6, 'ΣΚΥΡΑ',      31.5, 63,   'EN13242',                 'ΧΟΝΔΡΟΚΟΚΚΟ', 'ΣΚΥ');

-- Κόσκινα ανά προϊόν
-- ΑΜΜΟΣ 0/4
INSERT OR IGNORE INTO tbl_product_sieves (product_id, sieve_mm, sieve_order) VALUES
    (1, 4,     1),
    (1, 2,     2),
    (1, 1,     3),
    (1, 0.5,   4),
    (1, 0.25,  5),
    (1, 0.125, 6),
    (1, 0.063, 7);

-- ΓΑΡΜΠΙΛΙ 4/16
INSERT OR IGNORE INTO tbl_product_sieves (product_id, sieve_mm, sieve_order) VALUES
    (2, 16,    1),
    (2, 8,     2),
    (2, 4,     3),
    (2, 2,     4),
    (2, 1,     5),
    (2, 0.5,   6),
    (2, 0.063, 7);

-- ΣΥΝΤΡΙΜΜΑ 16/31.5
INSERT OR IGNORE INTO tbl_product_sieves (product_id, sieve_mm, sieve_order) VALUES
    (3, 31.5,  1),
    (3, 16,    2),
    (3, 8,     3),
    (3, 4,     4),
    (3, 2,     5),
    (3, 0.063, 6);

-- 3Α 0/31.5
INSERT OR IGNORE INTO tbl_product_sieves (product_id, sieve_mm, sieve_order) VALUES
    (4, 31.5,  1),
    (4, 16,    2),
    (4, 8,     3),
    (4, 4,     4),
    (4, 2,     5),
    (4, 0.5,   6),
    (4, 0.063, 7);

-- Ε4 0/31.5
INSERT OR IGNORE INTO tbl_product_sieves (product_id, sieve_mm, sieve_order) VALUES
    (5, 31.5,  1),
    (5, 16,    2),
    (5, 8,     3),
    (5, 4,     4),
    (5, 2,     5),
    (5, 0.5,   6),
    (5, 0.063, 7);

-- ΣΚΥΡΑ 31.5/63
INSERT OR IGNORE INTO tbl_product_sieves (product_id, sieve_mm, sieve_order) VALUES
    (6, 63,    1),
    (6, 31.5,  2),
    (6, 16,    3),
    (6, 4,     4);

-- ============================================================
-- CE PERIODS & SUBPERIODS (migration 009)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_ce_periods (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ce_number       TEXT NOT NULL,
    ce_body         TEXT,
    valid_from      TEXT NOT NULL,
    valid_to        TEXT NOT NULL,
    data_folder     TEXT,
    active          INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tbl_subperiods (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ce_period_id        INTEGER NOT NULL,
    lab_report_number   TEXT,
    valid_from          TEXT NOT NULL,
    notes               TEXT,
    pdf_subfolder       INTEGER DEFAULT 0,
    ext_mb_value        REAL,
    ext_se_value        REAL,
    ext_fl_value        REAL,
    ext_sieve_results   TEXT,
    active              INTEGER DEFAULT 0,
    created_at          TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (ce_period_id) REFERENCES tbl_ce_periods(id)
);

CREATE INDEX IF NOT EXISTS idx_ce_periods_active
    ON tbl_ce_periods(active);
CREATE INDEX IF NOT EXISTS idx_subperiods_ce_period
    ON tbl_subperiods(ce_period_id);
CREATE INDEX IF NOT EXISTS idx_subperiods_active
    ON tbl_subperiods(active);
CREATE INDEX IF NOT EXISTS idx_samples_subperiod
    ON tbl_samples(subperiod_id);

-- Πίνακες από migrations (ενσωματωμένοι στο full schema)

CREATE TABLE IF NOT EXISTS tbl_required_tests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id   INTEGER NOT NULL,
    test_type   TEXT    NOT NULL,
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE (sample_id, test_type),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id) ON DELETE CASCADE,
    CHECK (test_type IN ('sieve', 'flakiness', 'mb', 'se'))
);
CREATE INDEX IF NOT EXISTS idx_required_tests_sample
    ON tbl_required_tests(sample_id);

CREATE TABLE IF NOT EXISTS tbl_sieves (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    sieve_mm REAL NOT NULL UNIQUE,
    is_iso   INTEGER DEFAULT 0,
    note     TEXT
);
INSERT OR IGNORE INTO tbl_sieves (sieve_mm, is_iso) VALUES
    (63,    1), (45,    1), (31.5,  1), (22.4,  1),
    (16,    1), (11.2,  1), (8,     1), (5.6,   1),
    (4,     1), (2.8,   1), (2,     1), (1.4,   1),
    (1,     1), (0.71,  1), (0.5,   1), (0.355, 1),
    (0.25,  1), (0.18,  1), (0.125, 1), (0.09,  1),
    (0.063, 1);

CREATE TABLE IF NOT EXISTS tbl_test_limits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL,
    spec_type   TEXT NOT NULL,
    spec_name   TEXT NOT NULL,
    test_type   TEXT NOT NULL,
    parameter   TEXT NOT NULL,
    limit_value REAL NOT NULL,
    FOREIGN KEY (product_id) REFERENCES tbl_products(id)
);

-- Migration 012: δηλωμένες τιμές MB/SE/FL ανά (υποπερίοδο, προϊόν)
CREATE TABLE IF NOT EXISTS tbl_subperiod_specs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    subperiod_id  INTEGER NOT NULL,
    product_id    INTEGER NOT NULL,
    mb            REAL,
    se            REAL,
    fl            REAL,
    FOREIGN KEY (subperiod_id) REFERENCES tbl_subperiods(id),
    FOREIGN KEY (product_id) REFERENCES tbl_products(id),
    UNIQUE(subperiod_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_subperiod_specs_subperiod
    ON tbl_subperiod_specs(subperiod_id);

CREATE TABLE IF NOT EXISTS tbl_doc_sections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    icon       TEXT    DEFAULT '📁',
    is_custom  INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO tbl_doc_sections (id, name, icon, is_custom, sort_order) VALUES
    (1, 'Προδιαγραφές δοκιμών',            '📋', 0, 1),
    (2, 'Πιστοποιητικά CE',                 '📜', 0, 2),
    (3, 'Εκθέσεις εξωτερικού εργαστηρίου', '📊', 0, 3),
    (4, 'Εξοπλισμός & Βαθμονόμηση',        '🔧', 0, 4),
    (5, 'Προσωπικό',                         '👤', 0, 5),
    (6, 'Εσωτερικές διαδικασίες',           '📁', 0, 6);

CREATE TABLE IF NOT EXISTS tbl_documents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES tbl_doc_sections(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    code       TEXT,
    version    TEXT,
    expires_at TEXT,
    cloud_path TEXT,
    url        TEXT,
    notes      TEXT,
    created_at TEXT    DEFAULT (datetime('now')),
    updated_at TEXT    DEFAULT (datetime('now')),
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tbl_schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT DEFAULT (datetime('now')),
    description TEXT
);
