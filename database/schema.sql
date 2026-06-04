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
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    address         TEXT,
    phone           TEXT,
    email           TEXT,
    logo_path       TEXT,
    ce_number       TEXT,       -- Αριθμός πιστοποιητικού CE
    ce_valid_from   TEXT,       -- Ημερομηνία ισχύος CE
    ce_valid_to     TEXT,       -- Λήξη CE
    ce_body         TEXT,       -- Φορέας πιστοποίησης (EUROCERT)
    sample_prefix   TEXT DEFAULT 'ΓΑΛ',  -- Πρόθεμα κωδικού δείγματος
    sample_counter  INTEGER DEFAULT 1    -- Τρέχων μετρητής
);

-- Τεχνικοί
CREATE TABLE IF NOT EXISTS tbl_technicians (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    active      INTEGER DEFAULT 1  -- 1=ενεργός, 0=ανενεργός
);

-- Προϊόντα Λατομείου
CREATE TABLE IF NOT EXISTS tbl_products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,          -- πχ "ΑΜΜΟΣ", "ΓΑΡΜΠΙΛΙ"
    d_min       REAL NOT NULL,          -- κατώτερο όριο κόκκου (mm)
    d_max       REAL NOT NULL,          -- ανώτερο όριο κόκκου (mm)
    standard    TEXT NOT NULL,          -- EN12620 / EN13043 / EN13242
    category    TEXT,                   -- ΛΕΠΤΟΚΟΚΚΟ / ΧΟΝΔΡΟΚΟΚΚΟ
    active      INTEGER DEFAULT 1
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
    FOREIGN KEY (product_id) REFERENCES tbl_products(id),
    FOREIGN KEY (technician_id) REFERENCES tbl_technicians(id),
    FOREIGN KEY (subperiod_id) REFERENCES tbl_subperiods(id)
);

-- ============================================================
-- ΔΟΚΙΜΗ 1: ΚΟΚΚΟΜΕΤΡΙΑ (EN 933-1)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_sieve_analysis (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id       INTEGER NOT NULL UNIQUE,
    date            TEXT NOT NULL,
    weight_initial  REAL,               -- Βάρος δείγματος (g)
    weight_dry      REAL,               -- Βάρος ξηρού (g)
    weight_washed   REAL,               -- Βάρος πλυμένου (g)
    wash_loss_pct   REAL,               -- % Απώλεια πλύσης (υπολογίζεται)
    comments        TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id)
);

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
    sample_id           INTEGER NOT NULL UNIQUE,
    sieve_analysis_id   INTEGER,        -- NULL αν ανεξάρτητη δοκιμή
    date                TEXT NOT NULL,
    fi_index            REAL,           -- Δείκτης Πλακοειδούς (υπολογίζεται)
    comments            TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id),
    FOREIGN KEY (sieve_analysis_id) REFERENCES tbl_sieve_analysis(id)
);

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
    sample_id       INTEGER NOT NULL UNIQUE,
    date            TEXT NOT NULL,
    weight_sample   REAL DEFAULT 200,   -- Βάρος δείγματος M1 (g)
    water_volume    REAL DEFAULT 500,   -- Όγκος νερού (ml)
    volume_initial  REAL DEFAULT 0,     -- Αρχικός όγκος (ml)
    volume_final    REAL,               -- Τελικός όγκος V1 (ml)
    mb_value        REAL,               -- MB = (V1/M1)*10 (g/kg) υπολογίζεται
    comments        TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id)
);

-- ============================================================
-- ΔΟΚΙΜΗ 4: ΙΣΟΔΥΝΑΜΟ ΑΜΜΟΥ (EN 933-8)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_sand_equivalent (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id       INTEGER NOT NULL UNIQUE,
    date            TEXT NOT NULL,
    se_final        REAL,               -- Τελικό SE% (υπολογίζεται)
    requires_3rd    INTEGER DEFAULT 0,  -- 1 αν χρειάστηκε 3η μέτρηση
    comments        TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sample_id) REFERENCES tbl_samples(id)
);

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

-- ============================================================
-- ΑΡΧΙΚΑ ΔΕΔΟΜΕΝΑ
-- ============================================================

-- Στοιχεία Εργαστηρίου
INSERT OR IGNORE INTO tbl_laboratory (
    id, name, address, ce_number, ce_valid_from, ce_valid_to, ce_body, sample_prefix
) VALUES (
    1,
    'ΛΑΤΟΜΕΙΑ ΓΑΛΑΤΙΣΤΑΣ ΑΕ',
    'Θέση «Προφήτης Ηλίας», Γαλάτιστα, Χαλκιδική, 63073',
    '1128-CPR-0196',
    '01/04/2025',
    '31/03/2028',
    'EUROCERT Α.Ε.',
    'ΓΑΛ'
);

-- Προϊόντα από CE πιστοποιητικό
INSERT OR IGNORE INTO tbl_products (id, name, d_min, d_max, standard, category) VALUES
    (1, 'ΑΜΜΟΣ',     0,    4,    'EN12620/EN13043/EN13242', 'ΛΕΠΤΟΚΟΚΚΟ'),
    (2, 'ΓΑΡΜΠΙΛΙ',  4,    16,   'EN12620/EN13043',         'ΧΟΝΔΡΟΚΟΚΚΟ'),
    (3, 'ΣΥΝΤΡΙΜΜΑ',  16,   31.5, 'EN12620/EN13043',         'ΧΟΝΔΡΟΚΟΚΚΟ'),
    (4, '3Α',         0,    31.5, 'EN13242',                 'ΧΟΝΔΡΟΚΟΚΚΟ'),
    (5, 'Ε4',         0,    31.5, 'EN13242',                 'ΧΟΝΔΡΟΚΟΚΚΟ'),
    (6, 'ΣΚΥΡΑ',      31.5, 63,   'EN13242',                 'ΧΟΝΔΡΟΚΟΚΚΟ');

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
