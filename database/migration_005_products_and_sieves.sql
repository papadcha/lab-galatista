-- ============================================================
-- Migration 005 — Σύνθετο Όνομα Προϊόντος + Κεντρικός Πίνακας Κόσκινων
-- ============================================================
--
-- Αλλαγές:
--   1. tbl_products: προσθήκη πεδίου material_type (ο τύπος υλικού)
--      το name γίνεται σύνθετο: "[material_type] [d_min]/[d_max]"
--   2. tbl_sieves: νέος κεντρικός πίνακας όλων των γνωστών κόσκινων
--      (ISO + custom που έχουν χρησιμοποιηθεί)
--   3. tbl_products: αφαίρεση πεδίου standard (μεταφέρεται στα comments
--      προς το παρόν — το tbl_product_standards έρχεται σε migration 006)
--
-- ============================================================

-- ── 1. Προσθήκη material_type στα προϊόντα ──────────────────

ALTER TABLE tbl_products ADD COLUMN material_type TEXT;

-- Γεμίζουμε material_type από το υπάρχον name
UPDATE tbl_products SET material_type = name;

-- Ενημέρωση name σε σύνθετο: "[material_type] [d_min]/[d_max]"
-- Χρησιμοποιούμε CAST για καθαρές τιμές (πχ 4.0 → 4, 31.5 → 31.5)
UPDATE tbl_products SET name =
    material_type || ' ' ||
    CASE WHEN d_min = CAST(d_min AS INTEGER)
         THEN CAST(CAST(d_min AS INTEGER) AS TEXT)
         ELSE CAST(d_min AS TEXT) END
    || '/' ||
    CASE WHEN d_max = CAST(d_max AS INTEGER)
         THEN CAST(CAST(d_max AS INTEGER) AS TEXT)
         ELSE CAST(d_max AS TEXT) END;

-- ── 2. Κεντρικός πίνακας κόσκινων ──────────────────────────

CREATE TABLE IF NOT EXISTS tbl_sieves (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sieve_mm    REAL NOT NULL UNIQUE,   -- άνοιγμα κόσκινου (mm)
    is_iso      INTEGER DEFAULT 0,      -- 1=ISO 3310-1, 0=custom
    note        TEXT                    -- πχ "ASTM #200 = 0.075mm"
);

-- Εισαγωγή ISO 3310-1 κόσκινων (basic + supplementary series)
INSERT OR IGNORE INTO tbl_sieves (sieve_mm, is_iso) VALUES
    (63,    1), (45,    1), (31.5,  1), (22.4,  1),
    (16,    1), (11.2,  1), (8,     1), (5.6,   1),
    (4,     1), (2.8,   1), (2,     1), (1.4,   1),
    (1,     1), (0.71,  1), (0.5,   1), (0.355, 1),
    (0.25,  1), (0.18,  1), (0.125, 1), (0.09,  1),
    (0.063, 1);

-- Εισαγωγή custom κόσκινων από tbl_product_sieves που δεν είναι ISO
INSERT OR IGNORE INTO tbl_sieves (sieve_mm, is_iso)
    SELECT DISTINCT ps.sieve_mm, 0
    FROM tbl_product_sieves ps
    WHERE ps.sieve_mm NOT IN (SELECT sieve_mm FROM tbl_sieves);

