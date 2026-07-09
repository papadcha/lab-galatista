-- ============================================================
--  MIGRATION 018 — Γρήγορη Πρόσβαση: σήμανση εγγράφων Βιβλιοθήκης
--  Ημερομηνία: 2026-07-09
--  Αναιρέσιμη με: δεν υπάρχει αυτόματο rollback (οι στήλες μένουν αν
--  χρειαστεί να αναιρεθούν χειροκίνητα με DROP COLUMN — SQLite 3.35+)
-- ============================================================
--
--  Πρόβλημα: η Βιβλιοθήκη Εγγράφων δεν έχει καμία έννοια κατηγορίας/
--  τύπου πέρα από section_id — δεν υπάρχει τρόπος να σημαδευτεί "αυτό
--  το συγκεκριμένο PDF είναι το τρέχον CE Πιστοποιητικό/DoP/Πρότυπο"
--  ώστε το sidebar να μπορεί να το ανοίξει απευθείας.
--
--  Fix: προσθήκη quick_access_type/product_id/standard/group στο
--  tbl_documents + partial unique indexes ώστε μόνο ένα έγγραφο να
--  κατέχει κάθε θέση τη φορά (ίδιο πνεύμα με is_official στους
--  πίνακες test-run).
-- ============================================================

ALTER TABLE tbl_documents ADD COLUMN quick_access_type TEXT;
ALTER TABLE tbl_documents ADD COLUMN quick_access_product_id INTEGER REFERENCES tbl_products(id);
ALTER TABLE tbl_documents ADD COLUMN quick_access_standard TEXT;
ALTER TABLE tbl_documents ADD COLUMN quick_access_group TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_ce_cert ON tbl_documents(quick_access_type)
  WHERE quick_access_type='ce_certificate' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_tests ON tbl_documents(quick_access_type, quick_access_product_id)
  WHERE quick_access_type='official_tests' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_dop ON tbl_documents(quick_access_type, quick_access_standard, quick_access_product_id)
  WHERE quick_access_type IN ('dop','ce_mark') AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_std ON tbl_documents(quick_access_type, quick_access_group, quick_access_standard)
  WHERE quick_access_type='standard' AND deleted_at IS NULL;
