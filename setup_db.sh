#!/bin/bash
# ============================================================
#  setup_db.sh — Αρχικοποίηση βάσης δεδομένων
#  Χρήση: bash setup_db.sh [--with-seed]
# ============================================================

set -e  # Σταμάτα αν αποτύχει κάτι

DB_DIR="$(cd "$(dirname "$0")" && pwd)/database"
DB="$DB_DIR/laboratory.db"
MIGRATIONS="$DB_DIR"

echo "=================================================="
echo " Αρχικοποίηση Βάσης Δεδομένων"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=================================================="

# ── Backup αν υπάρχει ήδη βάση ─────────────────────────────
if [ -f "$DB" ]; then
  BACKUP="$DB.backup-$(date +%Y%m%d-%H%M%S)"
  echo "⚠  Βρέθηκε υπάρχουσα βάση — backup: $BACKUP"
  cp "$DB" "$BACKUP"
  rm "$DB"
  echo "   Παλιά βάση διαγράφηκε."
fi

# ── Δημιουργία νέας βάσης από schema ───────────────────────
echo ""
echo "① Δημιουργία νέας βάσης..."
sqlite3 "$DB" < "$DB_DIR/schema.sql"
echo "   ✓ schema.sql εφαρμόστηκε"

# ── Migration 001 ───────────────────────────────────────────
echo ""
echo "② Migration 001 — Required tests + multiple runs..."
sqlite3 "$DB" < "$MIGRATIONS/migration_001_required_tests_and_runs.sql"
echo "   ✓ migration_001 εφαρμόστηκε"

# ── Migration 002 ───────────────────────────────────────────
echo ""
echo "③ Migration 002 — Sources + product codes + specs..."
sqlite3 "$DB" < "$MIGRATIONS/migration_002_sources_and_codes.sql"
echo "   ✓ migration_002 εφαρμόστηκε"

# ── Migration 003 ───────────────────────────────────────────
echo ""
echo "④ Migration 003 — Flakiness weight_m0 + ισοζύγιο 1%..."
sqlite3 "$DB" < "$MIGRATIONS/migration_003_flakiness_weight_m0.sql"
echo "   ✓ migration_003 εφαρμόστηκε"

# ── Migration 004 ───────────────────────────────────────────
echo ""
echo "⑤ Migration 004 — MB moisture (weight_m0 + moisture_pct)..."
sqlite3 "$DB" < "$MIGRATIONS/migration_004_mb_moisture.sql"
echo "   ✓ migration_004 εφαρμόστηκε"

# ── Επαλήθευση ──────────────────────────────────────────────
echo ""
echo "⑥ Επαλήθευση..."
SCHEMA_VER=$(sqlite3 "$DB" "SELECT MAX(version) FROM tbl_schema_version;")
PRODUCTS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM tbl_products;")
SOURCES=$(sqlite3 "$DB" "SELECT COUNT(*) FROM tbl_sources;")
SPECS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM tbl_specifications;")
HAS_FL_M0=$(sqlite3 "$DB" "SELECT COUNT(*) FROM pragma_table_info('tbl_flakiness') WHERE name='weight_m0';")
HAS_MB_M0=$(sqlite3 "$DB" "SELECT COUNT(*) FROM pragma_table_info('tbl_methylene_blue') WHERE name='weight_m0';")
HAS_MB_W=$(sqlite3  "$DB" "SELECT COUNT(*) FROM pragma_table_info('tbl_methylene_blue') WHERE name='moisture_pct';")

echo "   Schema version      : $SCHEMA_VER"
echo "   Προϊόντα            : $PRODUCTS"
echo "   Πηγές               : $SOURCES"
echo "   Specs               : $SPECS"
echo "   flakiness.weight_m0 : $HAS_FL_M0"
echo "   mb.weight_m0        : $HAS_MB_M0"
echo "   mb.moisture_pct     : $HAS_MB_W"

if [ "$SCHEMA_VER" != "4" ]; then
  echo "✗ ΣΦΑΛΜΑ: Αναμενόταν schema version 4, βρέθηκε $SCHEMA_VER"
  exit 1
fi
if [ "$HAS_FL_M0" != "1" ]; then
  echo "✗ ΣΦΑΛΜΑ: tbl_flakiness.weight_m0 δεν βρέθηκε"; exit 1
fi
if [ "$HAS_MB_M0" != "1" ]; then
  echo "✗ ΣΦΑΛΜΑ: tbl_methylene_blue.weight_m0 δεν βρέθηκε"; exit 1
fi
if [ "$HAS_MB_W" != "1" ]; then
  echo "✗ ΣΦΑΛΜΑ: tbl_methylene_blue.moisture_pct δεν βρέθηκε"; exit 1
fi

# ── Seed data (προαιρετικό) ──────────────────────────────────
if [ "$1" = "--with-seed" ]; then
  echo ""
  echo "⑤ Εισαγωγή δοκιμαστικών δεδομένων..."
  cd "$(dirname "$0")"
  python3 seed_data.py
fi

echo ""
echo "=================================================="
echo " ✓ Βάση έτοιμη!"
echo "   $DB"
echo "=================================================="
echo ""
echo "Επόμενο βήμα: ξεκίνησε την εφαρμογή κανονικά."
