-- Migration 008: Προσθήκη pdf_font στο tbl_laboratory
ALTER TABLE tbl_laboratory ADD COLUMN pdf_font TEXT DEFAULT 'LiberationSans';
