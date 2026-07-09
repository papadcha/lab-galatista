-- ============================================================
--  MIGRATION 017 — Audit trail: ποιος τεχνικός δημιούργησε/τροποποίησε
--  Ημερομηνία: 2026-07-09
--  Αναιρέσιμη με: δεν υπάρχει αυτόματο rollback (οι στήλες μένουν αν
--  χρειαστεί να αναιρεθούν χειροκίνητα με DROP COLUMN — SQLite 3.35+)
-- ============================================================
--
--  Πρόβλημα: δεν υπάρχει καταγραφή ποιος τεχνικός κατάχώρησε ένα
--  δείγμα ή εκτέλεσε/τροποποίησε μια δοκιμή — μόνο tbl_samples.
--  technician_id υπάρχει, και σημαίνει "ποιος πήρε το δείγμα", όχι
--  "ποιος το κατάχώρησε" ή "ποιος έκανε τη δοκιμή".
--
--  Fix: προσθήκη created_by/modified_by (FK σε tbl_technicians) στο
--  tbl_samples και στους 4 πίνακες test-run (sieve/flakiness/mb/se).
--  Χωρίς backfill — ιστορικές εγγραφές μένουν NULL.
-- ============================================================

ALTER TABLE tbl_samples ADD COLUMN created_by INTEGER REFERENCES tbl_technicians(id);
ALTER TABLE tbl_samples ADD COLUMN modified_by INTEGER REFERENCES tbl_technicians(id);

ALTER TABLE tbl_sieve_analysis ADD COLUMN created_by INTEGER REFERENCES tbl_technicians(id);
ALTER TABLE tbl_sieve_analysis ADD COLUMN modified_by INTEGER REFERENCES tbl_technicians(id);

ALTER TABLE tbl_flakiness ADD COLUMN created_by INTEGER REFERENCES tbl_technicians(id);
ALTER TABLE tbl_flakiness ADD COLUMN modified_by INTEGER REFERENCES tbl_technicians(id);

ALTER TABLE tbl_methylene_blue ADD COLUMN created_by INTEGER REFERENCES tbl_technicians(id);
ALTER TABLE tbl_methylene_blue ADD COLUMN modified_by INTEGER REFERENCES tbl_technicians(id);

ALTER TABLE tbl_sand_equivalent ADD COLUMN created_by INTEGER REFERENCES tbl_technicians(id);
ALTER TABLE tbl_sand_equivalent ADD COLUMN modified_by INTEGER REFERENCES tbl_technicians(id);
