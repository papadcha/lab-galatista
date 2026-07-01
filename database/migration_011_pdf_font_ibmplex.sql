-- Migration 011: Αλλαγή default PDF font σε IBMPlexSans (ταιριάζει με το UI)
UPDATE tbl_laboratory SET pdf_font = 'IBMPlexSans' WHERE pdf_font IS NULL OR pdf_font = 'LiberationSans';
