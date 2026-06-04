-- ============================================================
-- Migration 003: Πλακοειδή — weight_m0 (απλό ADD COLUMN)
-- EN 933-3 §8: έλεγχος ισοζυγίου ±1%
-- ============================================================

-- Απλό ADD COLUMN — αποφεύγουμε DROP/RECREATE λόγω FOREIGN KEY constraints
ALTER TABLE tbl_flakiness ADD COLUMN weight_m0 REAL;

-- Αφαίρεση sieve_analysis_id δεν είναι απαραίτητη — το αγνοούμε απλώς
