-- ============================================================
-- Migration 004: Μπλε Μεθυλενίου — weight_m0 + moisture_pct
-- EN 933-9 §7: M1 = M0 / (1 + W/100)
-- ============================================================

ALTER TABLE tbl_methylene_blue ADD COLUMN weight_m0    REAL;
ALTER TABLE tbl_methylene_blue ADD COLUMN moisture_pct REAL;

INSERT INTO tbl_schema_version (version, description)
VALUES (4, 'Methylene Blue weight_m0 + moisture_pct — EN 933-9 §7');
