-- ============================================================
-- Migration 013: Προδιαγραφές κοκκομετρίας ανά υποπερίοδο
-- ΔAiγμα LiMS
-- Έκδοση : 0.99.0
-- Ημ/νία  : 2026-07-02
-- ============================================================
-- Νέος πίνακας:
--   tbl_subperiod_specifications — όρια περάσματος (%) ανά κόσκινο,
--                          override του tbl_specifications (global,
--                          per-προϊόν μόνο) για συγκεκριμένη
--                          υποπερίοδο. Μια υποπερίοδος είτε έχει
--                          πλήρες δικό της σετ για ένα (προϊόν,
--                          πρότυπο), είτε κληρονομεί ολόκληρο το
--                          global — όχι merge ανά κόσκινο.
-- ============================================================

PRAGMA foreign_keys = ON;

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
