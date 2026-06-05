-- Migration 010: Document Library

CREATE TABLE IF NOT EXISTS tbl_doc_sections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    icon       TEXT    DEFAULT '📁',
    is_custom  INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO tbl_doc_sections (id, name, icon, is_custom, sort_order) VALUES
    (1, 'Προδιαγραφές δοκιμών',            '📋', 0, 1),
    (2, 'Πιστοποιητικά CE',                 '📜', 0, 2),
    (3, 'Εκθέσεις εξωτερικού εργαστηρίου', '📊', 0, 3),
    (4, 'Εξοπλισμός & Βαθμονόμηση',        '🔧', 0, 4),
    (5, 'Προσωπικό',                         '👤', 0, 5),
    (6, 'Εσωτερικές διαδικασίες',           '📁', 0, 6);

CREATE TABLE IF NOT EXISTS tbl_documents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES tbl_doc_sections(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    code       TEXT,
    version    TEXT,
    expires_at TEXT,
    cloud_path TEXT,
    url        TEXT,
    notes      TEXT,
    created_at TEXT    DEFAULT (datetime('now')),
    updated_at TEXT    DEFAULT (datetime('now'))
);
