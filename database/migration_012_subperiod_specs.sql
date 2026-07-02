-- ============================================================
-- Migration 012: Προδιαγραφές ανά προϊόν & υποπερίοδο
-- Εργαστήριο Λατομείων Γαλάτιστας
-- Έκδοση : 0.99.0
-- Ημ/νία  : 2026-07-02
-- ============================================================
-- Νέος πίνακας:
--   tbl_subperiod_specs — δηλωμένες τιμές MB/SE/FL ανά
--                          (υποπερίοδο, προϊόν). Συμπληρώνει
--                          τα ext_mb/se/fl_value του
--                          tbl_subperiods, που είναι μία τιμή
--                          κοινή για όλα τα προϊόντα — εδώ κάθε
--                          προϊόν μπορεί να έχει διαφορετική
--                          δηλωμένη τιμή στην ίδια υποπερίοδο.
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tbl_subperiod_specs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    subperiod_id  INTEGER NOT NULL,
    product_id    INTEGER NOT NULL,
    mb            REAL,              -- MB (g/kg)
    se            REAL,              -- SE (%)
    fl            REAL,              -- Δείκτης Πλακοειδούς (%)
    FOREIGN KEY (subperiod_id) REFERENCES tbl_subperiods(id),
    FOREIGN KEY (product_id) REFERENCES tbl_products(id),
    UNIQUE(subperiod_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_subperiod_specs_subperiod
    ON tbl_subperiod_specs(subperiod_id);
