"""
# ============================================================
# db_manager.py
# Εργαστήριο Λατομείων Γαλάτιστας
# ─────────────────────────────────────────────────────────────
# Έκδοση : 0.99.3
# Ημ/νία  : 2026-06-02
# ─────────────────────────────────────────────────────────────
# Ιστορικό:
#   0.99.2 — CE period functions: get/create/update + expiry status
#             subperiod functions: get/create + date lookup
#   0.99.1 — Migration 009: tbl_ce_periods, tbl_subperiods
#             CURRENT_SCHEMA_VERSION → 9
#   0.99.0 — Προσθήκη επικεφαλίδας έκδοσης
# ============================================================
"""
import sqlite3
import os
from datetime import datetime
from typing import Optional, List, Dict, Any

DB_PATH          = os.path.join(os.path.dirname(__file__), 'laboratory.db')
_ORIGINAL_DB_PATH = DB_PATH
SCHEMA_PATH      = os.path.join(os.path.dirname(__file__), 'schema.sql')


# ============================================================
# REGISTRY: συσχετίσεις test_type ↔ table ↔ κατηγορίες
# ============================================================

TEST_REGISTRY = {
    'sieve': {
        'table':              'tbl_sieve_analysis',
        'children_table':     'tbl_sieve_results',
        'children_fk':        'sieve_analysis_id',
        'allowed_categories': {'ΛΕΠΤΟΚΟΚΚΟ', 'ΧΟΝΔΡΟΚΟΚΚΟ', 'ALL_IN'},
        'label':              'Κοκκομετρική Ανάλυση',
        'standard':           'EN 933-1',
    },
    'flakiness': {
        'table':              'tbl_flakiness',
        'children_table':     'tbl_flakiness_results',
        'children_fk':        'flakiness_id',
        'allowed_categories': {'ΧΟΝΔΡΟΚΟΚΚΟ', 'ALL_IN'},
        'label':              'Πλακοειδή',
        'standard':           'EN 933-3',
    },
    'mb': {
        'table':              'tbl_methylene_blue',
        'children_table':     None,
        'children_fk':        None,
        'allowed_categories': {'ΛΕΠΤΟΚΟΚΚΟ', 'ALL_IN'},
        'label':              'Μπλε Μεθυλενίου',
        'standard':           'EN 933-9',
    },
    'se': {
        'table':              'tbl_sand_equivalent',
        'children_table':     'tbl_se_measurements',
        'children_fk':        'se_id',
        'allowed_categories': {'ΛΕΠΤΟΚΟΚΚΟ', 'ALL_IN'},
        'label':              'Ισοδύναμο Άμμου',
        'standard':           'EN 933-8',
    },
}


def _validate_test_type(test_type: str) -> dict:
    """Επιστρέφει το registry entry ή σηκώνει ValueError."""
    if test_type not in TEST_REGISTRY:
        raise ValueError(
            f"Άγνωστος τύπος δοκιμής: '{test_type}'. "
            f"Επιτρέπονται: {', '.join(TEST_REGISTRY.keys())}"
        )
    return TEST_REGISTRY[test_type]


def is_test_allowed_for_category(test_type: str, category: str) -> bool:
    """
    Ελέγχει αν μια δοκιμή επιτρέπεται για συγκεκριμένη κατηγορία αδρανούς.
    Αν η κατηγορία είναι None ή άγνωστη, επιστρέφει False.
    """
    if not category:
        return False
    entry = TEST_REGISTRY.get(test_type)
    if not entry:
        return False
    return category in entry['allowed_categories']


def get_allowed_tests_for_category(category: str) -> List[str]:
    """Επιστρέφει τις επιτρεπόμενες δοκιμές για μια κατηγορία."""
    return [tt for tt, e in TEST_REGISTRY.items()
            if category in e['allowed_categories']]


# ============================================================
# CONNECTION
# ============================================================

def switch_db(archive_path: str) -> dict:
    """Εναλλαγή σε archive DB (global switch)."""
    global DB_PATH
    if not os.path.exists(archive_path):
        return {'ok': False, 'error': 'Το αρχείο δεν βρέθηκε: ' + archive_path}
    DB_PATH = archive_path
    return {'ok': True, 'path': archive_path}

def restore_db() -> dict:
    """Επαναφορά στο κύριο DB."""
    global DB_PATH
    DB_PATH = _ORIGINAL_DB_PATH
    return {'ok': True}

def find_archive_db(data_folder: str) -> dict:
    """Βρίσκει το FINAL backup DB στον φάκελο μιας παλιάς CE period.
    Αγνοεί 0-byte αρχεία, επιλέγει το πιο πρόσφατο αν υπάρχουν πολλά."""
    import glob
    pattern = os.path.join(data_folder, 'backup', '*_FINAL.db')
    files = [f for f in glob.glob(pattern) if os.path.getsize(f) > 0]
    if not files:
        return {'ok': False, 'error': 'Δεν βρέθηκε FINAL backup στο: ' + data_folder}
    # Επιλογή πιο πρόσφατου
    files.sort(key=os.path.getmtime, reverse=True)
    return {'ok': True, 'path': files[0]}

def get_connection() -> sqlite3.Connection:
    """Επιστρέφει σύνδεση με τη βάση δεδομένων."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


# Τρέχουσα έκδοση schema — αυξάνεται με κάθε migration
CURRENT_SCHEMA_VERSION = 9

# Φάκελος με τα SQL migrations
MIGRATIONS_DIR = os.path.join(os.path.dirname(DB_PATH))


def _get_schema_version(conn) -> int:
    """Επιστρέφει την τρέχουσα έκδοση schema από τη βάση."""
    try:
        row = conn.execute(
            "SELECT MAX(version) FROM tbl_schema_version"
        ).fetchone()
        return row[0] if row and row[0] is not None else 0
    except sqlite3.OperationalError:
        return 0


def _run_migration_sql(conn, sql_path: str, version: int):
    """Τρέχει ένα SQL migration file και καταγράφει την έκδοση."""
    with open(sql_path, 'r', encoding='utf-8') as f:
        sql = f.read()
    conn.executescript(sql)
    # Καταγραφή της νέας version στον πίνακα
    conn.execute(
        "INSERT OR REPLACE INTO tbl_schema_version (version, applied_at, description) "        "VALUES (?, datetime('now'), ?)",
        (version, f"Auto-migration {version}")
    )
    conn.commit()
    print(f"[Migration] ✓ version {version} εφαρμόστηκε", flush=True)


def _recalc_all_sieve_passing(conn):
    """
    Ξαναυπολογισμός passing% για όλες τις κοκκομετρίες.
    Καλείται αυτόματα μετά από migration που αλλάζει τον τύπο υπολογισμού.
    EN 933-1 §8.1: βάση = M₁ = weight_dry
    """
    analyses = conn.execute(
        "SELECT id, weight_dry FROM tbl_sieve_analysis ORDER BY id"
    ).fetchall()

    updated = 0
    for an in analyses:
        an_id = an[0]
        M1    = an[1] or 0
        if M1 <= 0:
            continue

        rows = conn.execute(
            "SELECT id, sieve_mm, weight_retained FROM tbl_sieve_results "
            "WHERE sieve_analysis_id=? ORDER BY sieve_mm DESC",
            (an_id,)
        ).fetchall()

        regular  = [(r[0], r[1], r[2]) for r in rows if r[1] > 0]
        pan_rows = [(r[0], r[1], r[2]) for r in rows if r[1] == 0]
        pan_w    = sum(r[2] for r in pan_rows)
        min_s    = min((r[1] for r in regular), default=None)

        cum = 0
        for rid, sieve_mm, ret in regular:
            cum += ret
            if sieve_mm == min_s:
                passing = ((M1 - cum) + pan_w) / M1 * 100 if M1 > 0 else 0
            else:
                passing = (M1 - cum) / M1 * 100 if M1 > 0 else 0
            passing = round(max(0, min(100, passing)), 1)
            conn.execute(
                "UPDATE tbl_sieve_results SET passing_percent=? WHERE id=?",
                (passing, rid)
            )
            updated += 1

    if updated:
        print(f"[Migration] ✓ Ξαναυπολογίστηκαν {updated} passing% (EN 933-1 §8.1)", flush=True)


def initialize_database():
    """
    Αρχικοποίηση + αυτόματες migrations κατά την εκκίνηση.

    Ροή:
      1. Αν δεν υπάρχει βάση → δημιουργία από schema.sql
      2. Έλεγχος schema_version
      3. Εφαρμογή migrations που λείπουν (001, 002, ...)
      4. Recalc αν χρειάζεται

    Ο χρήστης δεν χρειάζεται να τρέξει τίποτα χειροκίνητα.
    """
    # ── Βήμα 1: Δημιουργία βάσης αν δεν υπάρχει ─────────────
    if not os.path.exists(DB_PATH):
        print("[DB] Νέα βάση — εφαρμογή schema...", flush=True)
        with open(SCHEMA_PATH, 'r', encoding='utf-8') as f:
            schema = f.read()
        conn = get_connection()
        conn.executescript(schema)
        conn.commit()
        conn.close()
        print(f"[DB] ✓ Νέα βάση δημιουργήθηκε", flush=True)

    # ── Βήμα 2: Έλεγχος version ──────────────────────────────
    conn = get_connection()
    ver  = _get_schema_version(conn)
    conn.close()
    print(f"[DB] Schema version: {ver} (τρέχουσα: {CURRENT_SCHEMA_VERSION})", flush=True)

    if ver >= CURRENT_SCHEMA_VERSION:
        print("[DB] ✓ Βάση ενημερωμένη — καμία migration απαραίτητη", flush=True)
        return

    # ── Βήμα 3: Εφαρμογή migrations ──────────────────────────
    print(f"[DB] Εφαρμογή migrations {ver+1}→{CURRENT_SCHEMA_VERSION}...", flush=True)

    migration_files = {
        1: os.path.join(MIGRATIONS_DIR, 'migration_001_required_tests_and_runs.sql'),
        2: os.path.join(MIGRATIONS_DIR, 'migration_002_sources_and_codes.sql'),
        3: os.path.join(MIGRATIONS_DIR, 'migration_003_flakiness_weight_m0.sql'),
        4: os.path.join(MIGRATIONS_DIR, 'migration_004_mb_moisture.sql'),
        5: os.path.join(MIGRATIONS_DIR, 'migration_005_products_and_sieves.sql'),
        6: os.path.join(MIGRATIONS_DIR, 'migration_006_specifications.sql'),
        7: os.path.join(MIGRATIONS_DIR, 'migration_007_test_limits.sql'),
        8: os.path.join(MIGRATIONS_DIR, 'migration_008_pdf_font.sql'),
        9: os.path.join(MIGRATIONS_DIR, 'migration_009_ce_periods.sql'),
    }

    needs_recalc = False
    conn = get_connection()
    try:
        for v in range(ver + 1, CURRENT_SCHEMA_VERSION + 1):
            sql_path = migration_files.get(v)
            if not sql_path or not os.path.exists(sql_path):
                print(f"[Migration] ✗ Δεν βρέθηκε: {sql_path}", flush=True)
                raise FileNotFoundError(f"Migration {v} δεν βρέθηκε: {sql_path}")
            _run_migration_sql(conn, sql_path, v)
            if v == 2:
                needs_recalc = True  # migration 002 = νέος τύπος EN 933-1

        # ── Βήμα 4: Recalc αν χρειάζεται ─────────────────────
        if needs_recalc:
            _recalc_all_sieve_passing(conn)

        conn.commit()
        print(f"[DB] ✓ Migrations ολοκληρώθηκαν (version → {CURRENT_SCHEMA_VERSION})", flush=True)
    except Exception as e:
        conn.rollback()
        print(f"[DB] ✗ Σφάλμα migration: {e}", flush=True)
        raise
    finally:
        conn.close()


# ============================================================
# ΚΩΔΙΚΟΣ ΔΕΙΓΜΑΤΟΣ
# ============================================================

# Ελληνικό αλφάβητο για suffix (Α, Β, Γ, ...)
_GREEK_SUFFIX = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'


def generate_sample_code(source_id: int, product_id: int,
                         entry_date: Optional[str] = None) -> str:
    """
    Δημιουργεί αυτόματο κωδικό δείγματος με τη νέα δομή:
    {source.code}-{yymmdd}-{product.code}-{counter:04d}[suffix]

    Λογική suffix:
    - 1ο δείγμα ίδιας (ημέρας + πηγής + είδους) → χωρίς suffix
    - 2ο → 1ο γίνεται +Α, νέο = +Β
    - 3ο+ → νέο παίρνει επόμενο γράμμα

    Επίσης επιστρέφει dict με:
      code:           ο νέος κωδικός
      rename_id:      id υπάρχοντος δείγματος που πρέπει να μετονομαστεί (ή None)
      rename_to:      νέος κωδικός για το rename (ή None)
    """
    if not entry_date:
        entry_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Εξαγωγή yymmdd από entry_date
    dt = datetime.strptime(entry_date[:10], '%Y-%m-%d')
    yymmdd = dt.strftime('%y%m%d')

    conn = get_connection()
    source  = conn.execute(
        "SELECT code FROM tbl_sources WHERE id=?", (source_id,)
    ).fetchone()
    product = conn.execute(
        "SELECT code, d_min, d_max FROM tbl_products WHERE id=?", (product_id,)
    ).fetchone()
    conn.close()

    if not source or not product:
        raise ValueError(f"Δεν βρέθηκε source_id={source_id} ή product_id={product_id}")

    d_min_s   = '0' if product['d_min'] == 0 else str(product['d_min']).rstrip('0').rstrip('.')
    d_max_s   = str(product['d_max']).rstrip('0').rstrip('.')
    prod_part = f"{product['code']}{d_min_s}/{d_max_s}"
    base = f"{source['code']}-{yymmdd}-{prod_part}"

    # Βρες όλα τα υπάρχοντα δείγματα της ίδιας ομάδας (ίδια ημέρα+πηγή+είδος)
    # Χρησιμοποιούμε pattern χωρίς counter για να πιάσουμε όλους τους counters
    conn = get_connection()
    all_existing = conn.execute(
        "SELECT id, code FROM tbl_samples WHERE code LIKE ? ORDER BY code",
        (base + '-%',)
    ).fetchall()
    conn.close()

    # Βρες τον τελευταίο χρησιμοποιούμενο counter
    if not all_existing:
        # Κανένα δείγμα σήμερα — ξεκινάμε από 0001
        root = f"{base}-01"
        return {'code': root, 'rename_id': None, 'rename_to': None}

    # Εύρεση μοναδικών counters
    counters = {}  # {counter_int: [(id, code), ...]}
    for row in all_existing:
        last_part = row['code'].rsplit('-', 1)[-1]
        num_str = last_part.rstrip('ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ')
        try:
            n = int(num_str)
            if n not in counters:
                counters[n] = []
            counters[n].append({'id': row[0], 'code': row[1]})
        except ValueError:
            pass

    if not counters:
        root = f"{base}-01"
        return {'code': root, 'rename_id': None, 'rename_to': None}

    # Χρησιμοποίησε τον ΤΕΛΕΥΤΑΙΟ counter (max) για suffix
    last_counter = max(counters.keys())
    root         = f"{base}-{last_counter:02d}"
    group        = counters[last_counter]
    count        = len(group)

    if count == 1 and not group[0]['code'].rstrip('ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ').endswith(f"{last_counter:04d}"):
        # Έχει ήδη suffix — απλώς προσθέτουμε επόμενο
        count_with_suffix = count

    if count == 1:
        # Ελέγχουμε αν έχει ήδη suffix
        existing_code = group[0]['code']
        has_suffix    = existing_code[-1] in 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'

        if not has_suffix:
            # 2ο δείγμα — το υπάρχον παίρνει Α, το νέο παίρνει Β
            return {
                'code':      root + _GREEK_SUFFIX[1],   # Β
                'rename_id': group[0]['id'],
                'rename_to': root + _GREEK_SUFFIX[0],   # Α
            }
        else:
            # Ήδη έχει suffix — βρες το επόμενο
            current_idx = _GREEK_SUFFIX.index(existing_code[-1])
            return {
                'code':      root + _GREEK_SUFFIX[current_idx + 1],
                'rename_id': None,
                'rename_to': None,
            }
    else:
        # Πολλαπλά — επόμενο γράμμα μετά το τελευταίο
        # Βρες το μεγαλύτερο suffix
        max_suffix_idx = -1
        for item in group:
            c = item['code']
            if c[-1] in 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ':
                idx = _GREEK_SUFFIX.index(c[-1])
                max_suffix_idx = max(max_suffix_idx, idx)

        next_idx = max_suffix_idx + 1
        if next_idx >= len(_GREEK_SUFFIX):
            raise ValueError("Υπέρβαση ορίου suffix (>23 δείγματα ίδιας ομάδας)")

        return {
            'code':      root + _GREEK_SUFFIX[next_idx],
            'rename_id': None,
            'rename_to': None,
        }


def _get_daily_counter(source_id: int, product_id: int, date) -> int:
    """
    Επιστρέφει τον επόμενο counter για νέα ομάδα (ημέρα + πηγή + είδος).
    Μετράει πόσες ΜΟΝΑΔΙΚΕΣ ομάδες υπάρχουν ήδη και επιστρέφει +1.

    Παράδειγμα:
    - ΓΑΛ-260502-ΑΜΜ-0001, ΓΑΛ-260502-ΑΜΜ-0001Α → 1 ομάδα → επόμενος = 2
    - ΓΑΛ-260502-ΑΜΜ-0001, ΓΑΛ-260502-ΑΜΜ-0002  → 2 ομάδες → επόμενος = 3
    """
    conn = get_connection()
    source  = conn.execute("SELECT code FROM tbl_sources  WHERE id=?", (source_id,)).fetchone()
    product = conn.execute("SELECT code, d_min, d_max FROM tbl_products WHERE id=?", (product_id,)).fetchone()
    if not source or not product:
        conn.close()
        return 1

    yymmdd    = date.strftime('%y%m%d')
    d_min_s   = '0' if product['d_min'] == 0 else str(product['d_min']).rstrip('0').rstrip('.')
    d_max_s   = str(product['d_max']).rstrip('0').rstrip('.')
    prod_part = f"{product['code']}{d_min_s}/{d_max_s}"
    pattern = f"{source['code']}-{yymmdd}-{prod_part}-%"

    rows = conn.execute(
        "SELECT code FROM tbl_samples WHERE code LIKE ?", (pattern,)
    ).fetchall()
    conn.close()

    if not rows:
        return 1

    # Συλλογή μοναδικών counters (χωρίς suffix)
    counters = set()
    for row in rows:
        last_part = row['code'].rsplit('-', 1)[-1]
        num_str = last_part.rstrip('ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ')
        try:
            counters.add(int(num_str))
        except ValueError:
            pass

    return max(counters) + 1 if counters else 1


def apply_sample_code_rename(rename_id: int, rename_to: str) -> bool:
    """
    Μετονομάζει υπάρχον δείγμα (για suffix logic).
    Καλείται αυτόματα από create_sample όταν χρειάζεται.
    """
    conn = get_connection()
    conn.execute(
        "UPDATE tbl_samples SET code=?, updated_at=datetime('now') WHERE id=?",
        (rename_to, rename_id)
    )
    conn.commit()
    conn.close()
    return True


def get_sources() -> list:
    """Επιστρέφει όλες τις ενεργές πηγές."""
    conn = get_connection()
    results = [dict(r) for r in conn.execute(
        "SELECT * FROM tbl_sources WHERE active=1 ORDER BY code"
    ).fetchall()]
    conn.close()
    return results


# ============================================================
# ΔΕΙΓΜΑΤΑ
# ============================================================

def create_sample(code: str, date: str, product_id: int,
                  technician_id: Optional[int] = None,
                  location: Optional[str] = None,
                  batch: Optional[str] = None,
                  comments: Optional[str] = None,
                  source_id: Optional[int] = 1) -> int:
    """
    Δημιουργεί νέο δείγμα. Επιστρέφει το id.

    Αν ο κωδικός χρειάζεται rename υπάρχοντος (suffix logic),
    το rename γίνεται αυτόματα μέσα σε transaction.
    """
    entry_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    conn = get_connection()
    try:
        # Έλεγχος αν ο κωδικός έχει παραχθεί από generate_sample_code
        # και αν χρειάζεται rename — αυτό γίνεται transactionally
        # Αν ο κωδικός είναι manual (δεν ακολουθεί τη δομή), αποθηκεύεται αυτούσιος

        # Αυτόματη ανάθεση subperiod_id από την ημερομηνία δείγματος
        subperiod = get_subperiod_for_date(date)
        subperiod_id = subperiod['id'] if subperiod else None

        cursor = conn.execute("""
            INSERT INTO tbl_samples
                (code, date, product_id, technician_id, location,
                 batch, comments, source_id, entry_date, subperiod_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (code, date, product_id, technician_id, location,
              batch, comments, source_id or 1, entry_date, subperiod_id))
        sample_id = cursor.lastrowid
        conn.commit()
        return sample_id
    finally:
        conn.close()


def create_sample_with_rename(code_info: dict, date: str, product_id: int,
                               technician_id: Optional[int] = None,
                               location: Optional[str] = None,
                               batch: Optional[str] = None,
                               comments: Optional[str] = None,
                               source_id: Optional[int] = 1) -> int:
    """
    Δημιουργεί δείγμα με αυτόματο κωδικό από generate_sample_code.
    Χειρίζεται το rename του προηγούμενου δείγματος αν χρειάζεται.

    code_info: αποτέλεσμα generate_sample_code() —
               {'code': ..., 'rename_id': ..., 'rename_to': ...}
    """
    entry_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = get_connection()
    try:
        # Atomic: rename παλιού + insert νέου
        if code_info.get('rename_id'):
            conn.execute(
                "UPDATE tbl_samples SET code=?, updated_at=datetime('now') WHERE id=?",
                (code_info['rename_to'], code_info['rename_id'])
            )

        # Αυτόματη ανάθεση subperiod_id από την ημερομηνία δείγματος
        subperiod = get_subperiod_for_date(date)
        subperiod_id = subperiod['id'] if subperiod else None

        cursor = conn.execute("""
            INSERT INTO tbl_samples
                (code, date, product_id, technician_id, location,
                 batch, comments, source_id, entry_date, subperiod_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (code_info['code'], date, product_id, technician_id,
              location, batch, comments, source_id or 1, entry_date, subperiod_id))
        sample_id = cursor.lastrowid
        conn.commit()
        return sample_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_sample(sample_id: int) -> dict:
    """
    Επιστρέφει δείγμα + flag ποιες δοκιμές υπάρχουν (μόνο is_official=1).
    Συμβατότητα: ίδιο schema αποτελέσματος με την έκδοση 1.0.
    """
    conn = get_connection()
    sample = conn.execute("""
        SELECT s.*, p.name AS product_name, p.d_min, p.d_max,
               p.category, p.code AS product_code, t.name AS technician_name
          FROM tbl_samples s
          LEFT JOIN tbl_products p     ON s.product_id    = p.id
          LEFT JOIN tbl_technicians t  ON s.technician_id = t.id
         WHERE s.id = ?
    """, (sample_id,)).fetchone()

    if not sample:
        conn.close()
        return None

    has_sieve = conn.execute(
        "SELECT id FROM tbl_sieve_analysis "
        "WHERE sample_id=? AND is_official=1",
        (sample_id,)
    ).fetchone()
    has_flakiness = conn.execute(
        "SELECT id FROM tbl_flakiness "
        "WHERE sample_id=? AND is_official=1",
        (sample_id,)
    ).fetchone()
    has_mb = conn.execute(
        "SELECT id FROM tbl_methylene_blue "
        "WHERE sample_id=? AND is_official=1",
        (sample_id,)
    ).fetchone()
    has_se = conn.execute(
        "SELECT id FROM tbl_sand_equivalent "
        "WHERE sample_id=? AND is_official=1",
        (sample_id,)
    ).fetchone()

    conn.close()
    return {
        'sample': dict(sample),
        'tests': {
            'sieve_analysis':  dict(has_sieve)     if has_sieve     else None,
            'flakiness':       dict(has_flakiness) if has_flakiness else None,
            'methylene_blue':  dict(has_mb)        if has_mb        else None,
            'sand_equivalent': dict(has_se)        if has_se        else None,
        }
    }


def update_sample(sample_id: int, **kwargs) -> bool:
    """Ενημερώνει στοιχεία δείγματος."""
    allowed = ['code', 'date', 'product_id', 'technician_id',
               'location', 'batch', 'comments']
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return False
    fields['updated_at'] = datetime.now().isoformat()
    set_clause = ', '.join([f"{k}=?" for k in fields])
    values     = list(fields.values()) + [sample_id]
    conn = get_connection()
    try:
        conn.execute(f"UPDATE tbl_samples SET {set_clause} WHERE id=?", values)
        conn.commit()
    finally:
        conn.close()
    return True


def search_samples(product_id: Optional[int] = None,
                   date_from: Optional[str]  = None,
                   date_to:   Optional[str]  = None,
                   code:      Optional[str]  = None,
                   limit:     int = 200) -> list:
    """
    Αναζήτηση δειγμάτων — επιστρέφει πλήρη στοιχεία
    συμπεριλαμβανομένων has_*, source_name, required_tests.
    """
    query = """
        SELECT s.id, s.code, s.date, s.batch, s.location, s.comments,
               s.product_id,
               p.name AS product_name, p.d_min, p.d_max, p.category,
               p.code AS product_code,
               t.name AS technician_name,
               src.name AS source_name,
               CASE WHEN sa.id IS NOT NULL THEN 1 ELSE 0 END AS has_sieve,
               CASE WHEN fl.id IS NOT NULL THEN 1 ELSE 0 END AS has_flakiness,
               CASE WHEN mb.id IS NOT NULL THEN 1 ELSE 0 END AS has_mb,
               CASE WHEN se.id IS NOT NULL THEN 1 ELSE 0 END AS has_se,
               (SELECT GROUP_CONCAT(rt.test_type)
                FROM tbl_required_tests rt
                WHERE rt.sample_id = s.id) AS required_tests
          FROM tbl_samples s
          LEFT JOIN tbl_products    p   ON s.product_id    = p.id
          LEFT JOIN tbl_technicians t   ON s.technician_id = t.id
          LEFT JOIN tbl_sources     src ON s.source_id     = src.id
          LEFT JOIN tbl_sieve_analysis  sa ON sa.sample_id = s.id AND sa.is_official = 1
          LEFT JOIN tbl_flakiness       fl ON fl.sample_id = s.id AND fl.is_official = 1
          LEFT JOIN tbl_methylene_blue  mb ON mb.sample_id = s.id AND mb.is_official = 1
          LEFT JOIN tbl_sand_equivalent se ON se.sample_id = s.id AND se.is_official = 1
         WHERE 1=1
    """
    params = []
    if product_id:
        query += " AND s.product_id = ?"
        params.append(product_id)
    if date_from:
        query += " AND s.date >= ?"
        params.append(date_from)
    if date_to:
        query += " AND s.date <= ?"
        params.append(date_to)
    if code:
        # Αφήνουμε το φιλτράρισμα κωδικού στην Python για σωστό ελληνικό case insensitive
        code_filter = code.strip().upper()
    else:
        code_filter = None
    query += " GROUP BY s.id ORDER BY s.date DESC, s.id DESC LIMIT ?"
    params.append(limit)

    conn = get_connection()
    results = [dict(r) for r in conn.execute(query, params).fetchall()]
    conn.close()

    # Python-side case insensitive φιλτράρισμα κωδικού (για ελληνικά)
    if code_filter:
        results = [r for r in results if code_filter in r.get('code', '').upper()]

    return results


# ============================================================
# REQUIRED TESTS — Πλάνο δοκιμών ανά δείγμα
# ============================================================

def get_required_tests(sample_id: int) -> List[str]:
    """
    Επιστρέφει λίστα test_types στο πλάνο του δείγματος.
    πχ ['sieve', 'mb', 'se']
    """
    conn = get_connection()
    rows = conn.execute(
        "SELECT test_type FROM tbl_required_tests "
        "WHERE sample_id=? ORDER BY test_type",
        (sample_id,)
    ).fetchall()
    conn.close()
    return [r['test_type'] for r in rows]


def set_required_tests(sample_id: int, test_types: List[str]) -> bool:
    """
    Ορίζει το πλάνο δοκιμών ενός δείγματος (replace mode).
    Επιβάλλει τους κανόνες κατηγορίας — πέταγμα ValueError αν παρακαμφθούν.

    Σημαντικό: ΔΕΝ μπορεί να αφαιρεθεί δοκιμή που έχει ήδη εκτέλεση
    (official ή απορριφθείσα). Πέταγμα ValueError με λεπτομέρειες.
    """
    # 1. Validation επιτρεπόμενων δοκιμών για την κατηγορία
    conn = get_connection()
    sample = conn.execute("""
        SELECT s.id, p.category, p.name, p.d_min, p.d_max
          FROM tbl_samples s
          JOIN tbl_products p ON s.product_id = p.id
         WHERE s.id = ?
    """, (sample_id,)).fetchone()
    if not sample:
        conn.close()
        raise ValueError(f"Δεν βρέθηκε δείγμα με id={sample_id}")

    category = sample['category']
    invalid = [tt for tt in test_types
               if not is_test_allowed_for_category(tt, category)]
    if invalid:
        conn.close()
        labels = [TEST_REGISTRY[tt]['label'] for tt in invalid
                  if tt in TEST_REGISTRY]
        raise ValueError(
            f"Οι δοκιμές {labels} δεν επιτρέπονται για κατηγορία '{category}'."
        )

    # 2. Έλεγχος ότι δεν αφαιρούνται δοκιμές με εκτελέσεις
    current = set(r['test_type'] for r in conn.execute(
        "SELECT test_type FROM tbl_required_tests WHERE sample_id=?",
        (sample_id,)
    ).fetchall())
    requested = set(test_types)
    to_remove = current - requested

    blocked = []
    for tt in to_remove:
        entry = TEST_REGISTRY.get(tt)
        if not entry:
            continue
        existing = conn.execute(
            f"SELECT COUNT(*) AS c FROM {entry['table']} WHERE sample_id=?",
            (sample_id,)
        ).fetchone()
        if existing['c'] > 0:
            blocked.append(entry['label'])

    if blocked:
        conn.close()
        raise ValueError(
            f"Δεν μπορούν να αφαιρεθούν οι δοκιμές {blocked} γιατί "
            f"έχουν ήδη εκτελέσεις. Διαγράψτε πρώτα τις εκτελέσεις."
        )

    # 3. Replace
    conn.execute("DELETE FROM tbl_required_tests WHERE sample_id=?", (sample_id,))
    for tt in test_types:
        conn.execute(
            "INSERT INTO tbl_required_tests (sample_id, test_type) VALUES (?, ?)",
            (sample_id, tt)
        )
    conn.commit()
    conn.close()
    return True


def get_default_required_tests(product_id: int) -> List[str]:
    """
    Επιστρέφει τις προτεινόμενες δοκιμές για ένα προϊόν,
    βάσει της κατηγορίας του.
    """
    conn = get_connection()
    row = conn.execute(
        "SELECT category FROM tbl_products WHERE id=?", (product_id,)
    ).fetchone()
    conn.close()
    if not row:
        return []
    return get_allowed_tests_for_category(row['category'])


def initialize_required_tests_default(sample_id: int, product_id: int) -> bool:
    """
    Δημιουργεί αυτόματα το default πλάνο για ένα νέο δείγμα.
    Καλείται από το create_sample workflow ΟΤΑΝ ο χρήστης δεν επιλέξει
    χειροκίνητα. Αν υπάρχει ήδη πλάνο, δεν κάνει τίποτα.
    """
    existing = get_required_tests(sample_id)
    if existing:
        return False
    defaults = get_default_required_tests(product_id)
    if not defaults:
        return False
    conn = get_connection()
    for tt in defaults:
        conn.execute(
            "INSERT OR IGNORE INTO tbl_required_tests (sample_id, test_type) VALUES (?, ?)",
            (sample_id, tt)
        )
    conn.commit()
    conn.close()
    return True


# ============================================================
# ΚΟΚΚΟΜΕΤΡΙΑ
# ============================================================

def save_sieve_analysis(sample_id: int, date: str,
                        weight_initial: float, weight_dry: float,
                        weight_washed: float,
                        sieve_results: list,
                        comments: Optional[str] = None,
                        as_new_run: bool = False,
                        rejected_reason: Optional[str] = None) -> int:
    """
    Αποθηκεύει κοκκομετρία.

    Παράμετροι νέες:
        as_new_run        : αν True, η τρέχουσα official γίνεται απορριφθείσα
                            και δημιουργείται νέο run. Αν False (default),
                            ενημερώνεται η τρέχουσα official (ή δημιουργείται
                            αν δεν υπάρχει).
        rejected_reason   : υποχρεωτικό όταν as_new_run=True. Λόγος απόρριψης
                            της προηγούμενης εκτέλεσης.

    Επιστρέφει το id του αποθηκευμένου run.
    """
    if as_new_run and not rejected_reason:
        raise ValueError(
            "Όταν as_new_run=True, απαιτείται rejected_reason "
            "για την προηγούμενη εκτέλεση."
        )

    # Επικύρωση κατηγορίας
    _check_test_allowed(sample_id, 'sieve')

    wash_loss = ((weight_dry - weight_washed) / weight_dry * 100
                 if weight_dry and weight_dry > 0 else 0)

    conn = get_connection()
    try:
        current = conn.execute(
            "SELECT id, run_no FROM tbl_sieve_analysis "
            "WHERE sample_id=? AND is_official=1",
            (sample_id,)
        ).fetchone()

        if as_new_run:
            run_no = (current['run_no'] + 1) if current else 1
            if current:
                conn.execute(
                    "UPDATE tbl_sieve_analysis "
                    "SET is_official=0, rejected_reason=? WHERE id=?",
                    (rejected_reason, current['id'])
                )
            analysis_id = _insert_sieve_run(
                conn, sample_id, date,
                weight_initial, weight_dry, weight_washed,
                wash_loss, comments, run_no, sieve_results
            )
        else:
            if current:
                # Update της τρέχουσας official — διαγραφή children + reinsert
                analysis_id = current['id']
                conn.execute("""
                    UPDATE tbl_sieve_analysis
                       SET date=?, weight_initial=?, weight_dry=?,
                           weight_washed=?, wash_loss_pct=?, comments=?
                     WHERE id=?
                """, (date, weight_initial, weight_dry, weight_washed,
                      round(wash_loss, 2), comments, analysis_id))
                conn.execute(
                    "DELETE FROM tbl_sieve_results WHERE sieve_analysis_id=?",
                    (analysis_id,)
                )
                _insert_sieve_results(conn, analysis_id, weight_dry, sieve_results)
            else:
                # Πρώτη εκτέλεση — run_no=1
                analysis_id = _insert_sieve_run(
                    conn, sample_id, date,
                    weight_initial, weight_dry, weight_washed,
                    wash_loss, comments, 1, sieve_results
                )

        conn.commit()
        return analysis_id
    finally:
        conn.close()


def _insert_sieve_run(conn, sample_id, date,
                      weight_initial, weight_dry, weight_washed,
                      wash_loss, comments, run_no, sieve_results) -> int:
    """Helper: εισαγωγή νέου sieve run + children."""
    cursor = conn.execute("""
        INSERT INTO tbl_sieve_analysis
            (sample_id, date, weight_initial, weight_dry, weight_washed,
             wash_loss_pct, comments, run_no, is_official)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    """, (sample_id, date, weight_initial, weight_dry,
          weight_washed, round(wash_loss, 2), comments, run_no))
    analysis_id = cursor.lastrowid
    _insert_sieve_results(conn, analysis_id, weight_dry, sieve_results)
    return analysis_id


def _insert_sieve_results(conn, analysis_id, weight_dry, sieve_results):
    """
    Helper: υπολογισμός passing% και εισαγωγή sieve_results.

    Βάση υπολογισμού: weight_washed (κατά EN 933-1).
    Το υλικό που κοσκινίζεται είναι το πλυμένο — η απώλεια πλύσης
    εμφανίζεται ξεχωριστά ως wash_loss_pct.
    Το pan (sieve_mm=0) αποθηκεύεται με passing=0.
    """
    # Σημ: παράμετρος weight_dry κρατιέται για compatibility
    # αλλά ο υπολογισμός χρειάζεται το w_washed που συνάγεται
    # από: w_washed = Σretained + pan
    # Χρησιμοποιούμε το άθροισμα των retained (= w_washed πρακτικά)
    regular_sieves_data = [r for r in sieve_results if r.get('sieve_mm', 0) > 0]
    pan_data = [r for r in sieve_results if r.get('sieve_mm', 0) == 0]
    total_weight = sum(r.get('weight_retained', 0) for r in regular_sieves_data)
    pan_weight   = sum(r.get('weight_retained', 0) for r in pan_data)
    total_weight = total_weight + pan_weight  # = w_washed
    cumulative_retained = 0
    # Ταξινόμηση: μεγάλα → μικρά, εξαιρώ pan (sieve_mm=0)
    # EN 933-1 §8.1:
    # Παρονομαστής = M₁ = weight_dry για όλα τα κόσκινα
    # Passing%(0.063mm) = ((M₁ - M₂) + P) / M₁ × 100
    #   M₂ = cum_retained ΕΩΣ και ΣΤΟ 0.063mm
    #   P  = βάρος τυφλού (pan)
    M1       = weight_dry or 0
    pan_w    = sum(p.get('weight_retained', 0) for p in pan_data)
    min_sieve = min((r['sieve_mm'] for r in regular_sieves_data), default=0)

    regular_sieves = sorted(
        regular_sieves_data,
        key=lambda x: x['sieve_mm'], reverse=True
    )

    for r in regular_sieves:
        cumulative_retained += r.get('weight_retained', 0)

        if r['sieve_mm'] == min_sieve:
            # Μικρότερο κόσκινο (0.063mm): ειδικός τύπος
            passing = ((M1 - cumulative_retained) + pan_w) / M1 * 100 if M1 > 0 else 0
        else:
            passing = (M1 - cumulative_retained) / M1 * 100 if M1 > 0 else 0

        passing = max(0, min(100, round(passing, 1)))
        conn.execute("""
            INSERT INTO tbl_sieve_results
                (sieve_analysis_id, sieve_mm, weight_retained, passing_percent)
            VALUES (?, ?, ?, ?)
        """, (analysis_id, r['sieve_mm'],
              r.get('weight_retained', 0), passing))

    # Pan: αποθήκευση με passing=0
    for p in pan_data:
        conn.execute("""
            INSERT INTO tbl_sieve_results
                (sieve_analysis_id, sieve_mm, weight_retained, passing_percent)
            VALUES (?, ?, ?, ?)
        """, (analysis_id, 0, p.get('weight_retained', 0), 0.0))


def get_sieve_analysis(sample_id: int, run_id: Optional[int] = None) -> Optional[dict]:
    """
    Επιστρέφει κοκκομετρία δείγματος.
    Default: η is_official=1.
    Αν δοθεί run_id, επιστρέφει αυτό το συγκεκριμένο run (ακόμα κι αν απορριφθέν).
    """
    conn = get_connection()
    if run_id is not None:
        analysis = conn.execute(
            "SELECT * FROM tbl_sieve_analysis WHERE id=? AND sample_id=?",
            (run_id, sample_id)
        ).fetchone()
    else:
        analysis = conn.execute(
            "SELECT * FROM tbl_sieve_analysis "
            "WHERE sample_id=? AND is_official=1",
            (sample_id,)
        ).fetchone()

    if not analysis:
        conn.close()
        return None

    results = conn.execute("""
        SELECT * FROM tbl_sieve_results
         WHERE sieve_analysis_id=?
         ORDER BY sieve_mm DESC
    """, (analysis['id'],)).fetchall()
    conn.close()
    return {
        'analysis': dict(analysis),
        'results':  [dict(r) for r in results]
    }


# ============================================================
# ΠΛΑΚΟΕΙΔΗ
# ============================================================

def save_flakiness(sample_id: int, date: str,
                   fractions: list,
                   weight_m0: Optional[float] = None,
                   comments: Optional[str] = None,
                   as_new_run: bool = False,
                   rejected_reason: Optional[str] = None) -> int:
    """Αποθηκεύει πλακοειδή. weight_m0 = αρχικό βάρος δείγματος για έλεγχο 1% EN 933-3 §8."""
    if as_new_run and not rejected_reason:
        raise ValueError("Όταν as_new_run=True, απαιτείται rejected_reason.")
    _check_test_allowed(sample_id, 'flakiness')

    total_fraction = sum(f.get('weight_fraction', 0) for f in fractions)
    total_passing  = sum(f.get('weight_passing', 0)  for f in fractions)
    fi = round(total_passing / total_fraction * 100) if total_fraction > 0 else 0  # EN 933-3 §8: nearest whole number

    # Έλεγχος ισοζυγίου 1% (EN 933-3 §8)
    if weight_m0 and weight_m0 > 0 and total_fraction > 0:
        balance_pct = abs(weight_m0 - total_fraction) / weight_m0 * 100
        if balance_pct > 1:
            raise ValueError(
                f"Ισοζύγιο {balance_pct:.1f}% > 1% — "
                "Η δοκιμή πρέπει να επαναληφθεί με νέο δείγμα (EN 933-3 §8)"
            )

    conn = get_connection()
    try:
        current = conn.execute(
            "SELECT id, run_no FROM tbl_flakiness "
            "WHERE sample_id=? AND is_official=1",
            (sample_id,)
        ).fetchone()

        if as_new_run:
            run_no = (current['run_no'] + 1) if current else 1
            if current:
                conn.execute(
                    "UPDATE tbl_flakiness "
                    "SET is_official=0, rejected_reason=? WHERE id=?",
                    (rejected_reason, current['id'])
                )
            flakiness_id = _insert_flakiness_run(
                conn, sample_id, weight_m0, date, fi,
                comments, run_no, fractions
            )
        else:
            if current:
                flakiness_id = current['id']
                conn.execute("""
                    UPDATE tbl_flakiness
                       SET weight_m0=?, date=?, fi_index=?, comments=?
                     WHERE id=?
                """, (weight_m0, date, fi, comments, flakiness_id))
                conn.execute(
                    "DELETE FROM tbl_flakiness_results WHERE flakiness_id=?",
                    (flakiness_id,)
                )
                _insert_flakiness_results(conn, flakiness_id, fractions)
            else:
                flakiness_id = _insert_flakiness_run(
                    conn, sample_id, weight_m0, date, fi,
                    comments, 1, fractions
                )

        conn.commit()
        return flakiness_id
    finally:
        conn.close()


def _insert_flakiness_run(conn, sample_id, weight_m0, date,
                          fi, comments, run_no, fractions) -> int:
    cursor = conn.execute("""
        INSERT INTO tbl_flakiness
            (sample_id, weight_m0, date, fi_index, comments,
             run_no, is_official)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    """, (sample_id, weight_m0, date, fi, comments, run_no))
    flakiness_id = cursor.lastrowid
    _insert_flakiness_results(conn, flakiness_id, fractions)
    return flakiness_id


def _insert_flakiness_results(conn, flakiness_id, fractions):
    for f in fractions:
        conn.execute("""
            INSERT INTO tbl_flakiness_results
                (flakiness_id, sieve_mm, weight_fraction, weight_passing)
            VALUES (?, ?, ?, ?)
        """, (flakiness_id, f['sieve_mm'],
              f.get('weight_fraction', 0), f.get('weight_passing', 0)))


# ============================================================
# ΜΠΛΕ ΜΕΘΥΛΕΝΙΟΥ
# ============================================================

def save_methylene_blue(sample_id: int, date: str,
                        weight_sample: float, water_volume: float,
                        volume_initial: float, volume_final: float,
                        weight_m0: Optional[float] = None,
                        moisture_pct: Optional[float] = None,
                        comments: Optional[str] = None,
                        as_new_run: bool = False,
                        rejected_reason: Optional[str] = None) -> int:
    """Αποθηκεύει δοκιμή MB.
    weight_m0 + moisture_pct: προαιρετικά για δείγματα με υγρασία (EN 933-9 §7).
    weight_sample = M1 (ξηρό), υπολογισμένο από frontend.
    """
    if as_new_run and not rejected_reason:
        raise ValueError("Όταν as_new_run=True, απαιτείται rejected_reason.")
    _check_test_allowed(sample_id, 'mb')

    mb_value = (volume_final / weight_sample * 10
                if weight_sample and weight_sample > 0 else 0)

    conn = get_connection()
    try:
        current = conn.execute(
            "SELECT id, run_no FROM tbl_methylene_blue "
            "WHERE sample_id=? AND is_official=1",
            (sample_id,)
        ).fetchone()

        if as_new_run:
            run_no = (current['run_no'] + 1) if current else 1
            if current:
                conn.execute(
                    "UPDATE tbl_methylene_blue "
                    "SET is_official=0, rejected_reason=? WHERE id=?",
                    (rejected_reason, current['id'])
                )
            cursor = conn.execute("""
                INSERT INTO tbl_methylene_blue
                    (sample_id, date, weight_sample, water_volume,
                     volume_initial, volume_final, mb_value,
                     weight_m0, moisture_pct, comments,
                     run_no, is_official)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (sample_id, date, weight_sample, water_volume,
                  volume_initial, volume_final, round(mb_value, 2),
                  weight_m0, moisture_pct, comments, run_no))
            mb_id = cursor.lastrowid
        else:
            if current:
                mb_id = current['id']
                conn.execute("""
                    UPDATE tbl_methylene_blue
                       SET date=?, weight_sample=?, water_volume=?,
                           volume_initial=?, volume_final=?, mb_value=?,
                           weight_m0=?, moisture_pct=?, comments=?
                     WHERE id=?
                """, (date, weight_sample, water_volume, volume_initial,
                      volume_final, round(mb_value, 2),
                      weight_m0, moisture_pct, comments, mb_id))
            else:
                cursor = conn.execute("""
                    INSERT INTO tbl_methylene_blue
                        (sample_id, date, weight_sample, water_volume,
                         volume_initial, volume_final, mb_value,
                         weight_m0, moisture_pct, comments,
                         run_no, is_official)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
                """, (sample_id, date, weight_sample, water_volume,
                      volume_initial, volume_final, round(mb_value, 2),
                      weight_m0, moisture_pct, comments))
                mb_id = cursor.lastrowid

        conn.commit()
        return mb_id
    finally:
        conn.close()


def get_last_mb_volume(product_id: int) -> Optional[float]:
    """
    Επιστρέφει τον τελευταίο V1 (volume_final) για προϊόν — ως πρόταση.
    Λαμβάνει υπόψη ΜΟΝΟ official runs.
    """
    conn = get_connection()
    result = conn.execute("""
        SELECT mb.volume_final
          FROM tbl_methylene_blue mb
          JOIN tbl_samples s ON mb.sample_id = s.id
         WHERE s.product_id = ? AND mb.is_official = 1
         ORDER BY mb.created_at DESC
         LIMIT 1
    """, (product_id,)).fetchone()
    conn.close()
    return result['volume_final'] if result else None


# ============================================================
# ΙΣΟΔΥΝΑΜΟ ΑΜΜΟΥ
# ============================================================

def save_sand_equivalent(sample_id: int, date: str,
                         measurements: list,
                         comments: Optional[str] = None,
                         as_new_run: bool = False,
                         rejected_reason: Optional[str] = None) -> int:
    """Αποθηκεύει SE."""
    if as_new_run and not rejected_reason:
        raise ValueError("Όταν as_new_run=True, απαιτείται rejected_reason.")
    _check_test_allowed(sample_id, 'se')

    se_values = []
    for m in measurements:
        se = (m['h2'] / m['h1'] * 100 if m.get('h1', 0) > 0 else 0)  # SE = (άμμος/άργιλος)*100 — EN 933-8 §9
        se_values.append(round(se, 1))

    # EN 933-8 §9: αν διαφορά > 4, η δοκιμή πρέπει να επαναληφθεί
    if len(se_values) == 2 and abs(se_values[0] - se_values[1]) > 4:
        raise ValueError(
            f"Διαφορά SE ({abs(se_values[0]-se_values[1]):.1f}) > 4 μονάδες — "
            "Η δοκιμή πρέπει να επαναληφθεί (EN 933-8 §9)"
        )
    requires_3rd = False  # Δεν υπάρχει 3η μέτρηση στην EN 933-8
    # EN 933-8 §9: μέσος όρος, στρογγυλοποίηση στον πλησιέστερο ακέραιο
    se_final = round(sum(se_values) / len(se_values)) if se_values else 0

    conn = get_connection()
    try:
        current = conn.execute(
            "SELECT id, run_no FROM tbl_sand_equivalent "
            "WHERE sample_id=? AND is_official=1",
            (sample_id,)
        ).fetchone()

        if as_new_run:
            run_no = (current['run_no'] + 1) if current else 1
            if current:
                conn.execute(
                    "UPDATE tbl_sand_equivalent "
                    "SET is_official=0, rejected_reason=? WHERE id=?",
                    (rejected_reason, current['id'])
                )
            se_id = _insert_se_run(
                conn, sample_id, date, se_final, int(requires_3rd),
                comments, run_no, measurements, se_values
            )
        else:
            if current:
                se_id = current['id']
                conn.execute("""
                    UPDATE tbl_sand_equivalent
                       SET date=?, se_final=?, requires_3rd=?, comments=?
                     WHERE id=?
                """, (date, se_final, int(requires_3rd), comments, se_id))
                conn.execute(
                    "DELETE FROM tbl_se_measurements WHERE se_id=?", (se_id,)
                )
                _insert_se_measurements(conn, se_id, measurements, se_values)
            else:
                se_id = _insert_se_run(
                    conn, sample_id, date, se_final, int(requires_3rd),
                    comments, 1, measurements, se_values
                )

        conn.commit()
        return se_id
    finally:
        conn.close()


def _insert_se_run(conn, sample_id, date, se_final, requires_3rd,
                   comments, run_no, measurements, se_values) -> int:
    cursor = conn.execute("""
        INSERT INTO tbl_sand_equivalent
            (sample_id, date, se_final, requires_3rd, comments,
             run_no, is_official)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    """, (sample_id, date, se_final, requires_3rd, comments, run_no))
    se_id = cursor.lastrowid
    _insert_se_measurements(conn, se_id, measurements, se_values)
    return se_id


def _insert_se_measurements(conn, se_id, measurements, se_values):
    for i, (m, se) in enumerate(zip(measurements, se_values), 1):
        conn.execute("""
            INSERT INTO tbl_se_measurements
                (se_id, measurement_no, h1, h2, se_value)
            VALUES (?, ?, ?, ?, ?)
        """, (se_id, i, m['h1'], m['h2'], se))


# ============================================================
# RUN HISTORY & MANAGEMENT (νέο API)
# ============================================================

def get_test_history(test_type: str, sample_id: int) -> List[dict]:
    """
    Επιστρέφει ΟΛΑ τα runs μιας δοκιμής για ένα δείγμα,
    συμπεριλαμβανομένων των απορριφθεισών.
    Ταξινόμηση: run_no DESC (πιο πρόσφατο πρώτο).

    Κάθε record περιέχει: id, run_no, is_official, rejected_reason,
                          date, created_at + όλα τα test-specific fields
                          + (για sieve/flakiness/se) τα children records.
    """
    entry  = _validate_test_type(test_type)
    table  = entry['table']
    ctable = entry['children_table']
    cfk    = entry['children_fk']

    conn = get_connection()
    rows = conn.execute(
        f"SELECT * FROM {table} WHERE sample_id=? "
        f"ORDER BY run_no DESC",
        (sample_id,)
    ).fetchall()

    history = []
    for r in rows:
        run = dict(r)
        if ctable:
            children = conn.execute(
                f"SELECT * FROM {ctable} WHERE {cfk}=? "
                f"ORDER BY id",
                (run['id'],)
            ).fetchall()
            run['_children'] = [dict(c) for c in children]
        history.append(run)
    conn.close()
    return history


def mark_run_rejected(test_type: str, run_id: int, reason: str) -> bool:
    """
    Μαρκάρει συγκεκριμένο run ως απορριφθέν με λόγο.
    ΠΡΟΣΟΧΗ: Αν είναι το μοναδικό official, μετά την κλήση το δείγμα
    δεν θα έχει official run για αυτή τη δοκιμή. Συνήθως καλείται
    αυτόματα από save_* functions με as_new_run=True.
    """
    if not reason:
        raise ValueError("Λόγος απόρριψης είναι υποχρεωτικός.")
    entry = _validate_test_type(test_type)
    conn = get_connection()
    conn.execute(
        f"UPDATE {entry['table']} "
        f"SET is_official=0, rejected_reason=? WHERE id=?",
        (reason, run_id)
    )
    conn.commit()
    conn.close()
    return True


def update_rejected_reason(test_type: str, run_id: int, reason: str) -> bool:
    """
    Διορθώνει τον λόγο απόρριψης μιας ήδη απορριφθείσας εκτέλεσης.
    Δεν αλλάζει τίποτα άλλο — τα νούμερα της δοκιμής μένουν κλειδωμένα.
    """
    entry = _validate_test_type(test_type)
    conn = get_connection()
    row = conn.execute(
        f"SELECT is_official FROM {entry['table']} WHERE id=?",
        (run_id,)
    ).fetchone()
    if not row:
        conn.close()
        raise ValueError(f"Δεν βρέθηκε run με id={run_id}")
    if row['is_official'] == 1:
        conn.close()
        raise ValueError(
            "Δεν μπορεί να αλλάξει το rejected_reason σε official run. "
            "Πρώτα κάντε το απορριφθέν."
        )
    conn.execute(
        f"UPDATE {entry['table']} SET rejected_reason=? WHERE id=?",
        (reason, run_id)
    )
    conn.commit()
    conn.close()
    return True


def promote_run_to_official(test_type: str, run_id: int,
                            demote_reason: str) -> bool:
    """
    Επανα-promotion: παίρνει ένα απορριφθέν run και το κάνει official,
    υποβαθμίζοντας το τρέχον official σε απορριφθέν.

    Παράμετρος:
        demote_reason : λόγος που το τρέχον official υποβαθμίζεται
                        (πχ "Αποδείχθηκε ότι το συγκεκριμένο είχε άλλο σφάλμα")
    """
    if not demote_reason:
        raise ValueError("Λόγος υποβάθμισης είναι υποχρεωτικός.")
    entry = _validate_test_type(test_type)
    table = entry['table']

    conn = get_connection()
    try:
        # Βρες το προς προαγωγή
        target = conn.execute(
            f"SELECT id, sample_id, is_official FROM {table} WHERE id=?",
            (run_id,)
        ).fetchone()
        if not target:
            raise ValueError(f"Δεν βρέθηκε run με id={run_id}")
        if target['is_official'] == 1:
            raise ValueError("Το run είναι ήδη official.")

        sample_id = target['sample_id']
        # Υποβάθμισε το τρέχον official
        current = conn.execute(
            f"SELECT id FROM {table} WHERE sample_id=? AND is_official=1",
            (sample_id,)
        ).fetchone()

        # Σημείωση: Λόγω του partial unique index, πρέπει πρώτα να
        # υποβαθμίσουμε το τρέχον και μετά να προαγάγουμε το νέο.
        # Σε δύο ξεχωριστά UPDATE μέσα σε ίδιο transaction.
        if current:
            conn.execute(
                f"UPDATE {table} SET is_official=0, rejected_reason=? WHERE id=?",
                (demote_reason, current['id'])
            )

        # Καθαρίζουμε το rejected_reason του νέου official
        conn.execute(
            f"UPDATE {table} SET is_official=1, rejected_reason=NULL WHERE id=?",
            (run_id,)
        )
        conn.commit()
        return True
    finally:
        conn.close()


def delete_test_run(test_type: str, run_id: int) -> bool:
    """
    Διαγράφει ένα run μαζί με τα children του.
    Επιτρέπεται μόνο σε απορριφθέντα runs ή όταν είναι το ΜΟΝΟ run
    και ο χρήστης θέλει να αρχίσει από την αρχή.
    """
    entry  = _validate_test_type(test_type)
    table  = entry['table']
    ctable = entry['children_table']
    cfk    = entry['children_fk']

    conn = get_connection()
    try:
        if ctable:
            conn.execute(f"DELETE FROM {ctable} WHERE {cfk}=?", (run_id,))
        conn.execute(f"DELETE FROM {table} WHERE id=?", (run_id,))
        conn.commit()
        return True
    finally:
        conn.close()


# ============================================================
# ΕΣΩΤΕΡΙΚΕΣ ΒΟΗΘΗΤΙΚΕΣ
# ============================================================

def _check_test_allowed(sample_id: int, test_type: str) -> None:
    """
    Επικυρώνει ότι μια δοκιμή επιτρέπεται για την κατηγορία του δείγματος.
    Πέταγμα ValueError αν όχι.
    """
    conn = get_connection()
    row = conn.execute("""
        SELECT p.category, p.name AS product_name
          FROM tbl_samples s
          JOIN tbl_products p ON s.product_id = p.id
         WHERE s.id = ?
    """, (sample_id,)).fetchone()
    conn.close()
    if not row:
        raise ValueError(f"Δεν βρέθηκε δείγμα με id={sample_id}")
    if not is_test_allowed_for_category(test_type, row['category']):
        label = TEST_REGISTRY[test_type]['label']
        raise ValueError(
            f"Η δοκιμή '{label}' δεν επιτρέπεται για κατηγορία "
            f"'{row['category']}' (προϊόν: {row['product_name']})."
        )


# ============================================================
# ΒΟΗΘΗΤΙΚΕΣ ΠΡΟΪΟΝΤΩΝ / ΤΕΧΝΙΚΩΝ
# ============================================================

def get_products() -> list:
    """Επιστρέφει όλα τα ενεργά προϊόντα."""
    conn = get_connection()
    results = [dict(r) for r in conn.execute(
        "SELECT * FROM tbl_products WHERE active=1 ORDER BY d_min"
    ).fetchall()]
    conn.close()
    return results


def get_technicians() -> list:
    """Επιστρέφει όλους τους ενεργούς τεχνικούς."""
    conn = get_connection()
    results = [dict(r) for r in conn.execute(
        "SELECT * FROM tbl_technicians WHERE active=1 ORDER BY name"
    ).fetchall()]
    conn.close()
    return results


def get_product_sieves(product_id: int) -> list:
    """Επιστρέφει κόσκινα προϊόντος σε σειρά."""
    conn = get_connection()
    results = [dict(r) for r in conn.execute("""
        SELECT sieve_mm, MIN(sieve_order) AS sieve_order
          FROM tbl_product_sieves
         WHERE product_id=?
         GROUP BY sieve_mm
         ORDER BY sieve_order
    """, (product_id,)).fetchall()]
    conn.close()
    return [r['sieve_mm'] for r in results]


def get_specifications(product_id: int) -> list:
    """Επιστρέφει όλες τις προδιαγραφές για προϊόν."""
    conn = get_connection()
    results = [dict(r) for r in conn.execute("""
        SELECT * FROM tbl_specifications
         WHERE product_id=?
         ORDER BY spec_type, sieve_mm DESC
    """, (product_id,)).fetchall()]
    conn.close()
    return results



# ============================================================
# SETTINGS — Lab, Sources, Technicians, Specifications
# ============================================================

def save_lab_info(data: dict) -> bool:
    """Αποθηκεύει στοιχεία εργαστηρίου."""
    allowed = ['name','address','phone','email','logo_path',
               'ce_number','ce_valid_from','ce_valid_to','ce_body','pdf_font']
    fields  = {k: v for k, v in data.items() if k in allowed}
    if not fields:
        return False
    set_clause = ', '.join(f"{k}=?" for k in fields)
    conn = get_connection()
    conn.execute(
        f"UPDATE tbl_laboratory SET {set_clause} WHERE id=1",
        list(fields.values())
    )
    conn.commit()
    conn.close()
    return True


def add_source(code: str, name: str, location: Optional[str] = None) -> int:
    """Προσθέτει νέα πηγή υλικού."""
    conn = get_connection()
    cursor = conn.execute(
        "INSERT INTO tbl_sources (code, name, location, active) VALUES (?, ?, ?, 1)",
        (code.upper(), name, location)
    )
    source_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return source_id


def update_source(source_id: int, name: str,
                  location: Optional[str] = None) -> bool:
    """Ενημερώνει στοιχεία πηγής (εκτός κωδικού)."""
    conn = get_connection()
    conn.execute(
        "UPDATE tbl_sources SET name=?, location=? WHERE id=?",
        (name, location, source_id)
    )
    conn.commit()
    conn.close()
    return True


def toggle_source(source_id: int, active: int) -> bool:
    """Ενεργοποίηση/απενεργοποίηση πηγής."""
    conn = get_connection()
    conn.execute(
        "UPDATE tbl_sources SET active=? WHERE id=?",
        (active, source_id)
    )
    conn.commit()
    conn.close()
    return True


def get_all_technicians() -> list:
    """Επιστρέφει ΟΛΟΥΣ τους τεχνικούς (ενεργούς και μη)."""
    conn = get_connection()
    results = [dict(r) for r in conn.execute(
        "SELECT * FROM tbl_technicians ORDER BY active DESC, name"
    ).fetchall()]
    conn.close()
    return results


def toggle_technician(tech_id: int, active: int) -> bool:
    """Ενεργοποίηση/απενεργοποίηση τεχνικού."""
    conn = get_connection()
    conn.execute(
        "UPDATE tbl_technicians SET active=? WHERE id=?",
        (active, tech_id)
    )
    conn.commit()
    conn.close()
    return True


def save_specifications(product_id: int, spec_type: str,
                        spec_name: str, specs: list) -> bool:
    """
    Αποθηκεύει προδιαγραφές για (product_id, spec_type, spec_name).
    Replace mode: διαγράφει τα παλιά και εισάγει τα νέα.
    """
    conn = get_connection()
    # Διαγραφή παλιών
    conn.execute(
        "DELETE FROM tbl_specifications "
        "WHERE product_id=? AND spec_type=? AND spec_name=?",
        (product_id, spec_type, spec_name)
    )
    # Εισαγωγή νέων (μόνο αν έχουν έστω ένα όριο)
    for s in specs:
        lo = s.get('lower_limit')
        hi = s.get('upper_limit')
        conn.execute("""
            INSERT INTO tbl_specifications
                (product_id, spec_type, spec_name, sieve_mm, lower_limit, upper_limit)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (product_id, spec_type, spec_name, s['sieve_mm'], lo, hi))
    conn.commit()
    conn.close()
    return True

def get_smtp_config() -> dict:
    """Επιστρέφει SMTP ρυθμίσεις από tbl_laboratory."""
    import json as _json
    conn = get_connection()
    row  = conn.execute(
        "SELECT smtp_config FROM tbl_laboratory WHERE id=1"
    ).fetchone()
    conn.close()
    if not row or not row['smtp_config']:
        return {}
    try:
        return _json.loads(row['smtp_config'])
    except Exception:
        return {}


def save_smtp_config(cfg: dict) -> bool:
    """Αποθηκεύει SMTP ρυθμίσεις ως JSON στο tbl_laboratory."""
    import json as _json
    # Μην αποθηκεύεις password σε plaintext — TODO: encryption
    conn = get_connection()
    # Προσθήκη smtp_config column αν δεν υπάρχει
    try:
        conn.execute(
            "ALTER TABLE tbl_laboratory ADD COLUMN smtp_config TEXT"
        )
        conn.commit()
    except Exception:
        pass  # Ήδη υπάρχει
    conn.execute(
        "UPDATE tbl_laboratory SET smtp_config=? WHERE id=1",
        (_json.dumps(cfg),)
    )
    conn.commit()
    conn.close()
    return True

if __name__ == '__main__':
    initialize_database()
    print("✓ Αρχικοποίηση βάσης δεδομένων ολοκληρώθηκε")
    print(f"  Προϊόντα: {len(get_products())}")
    print(f"  Δοκιμές στο registry: {len(TEST_REGISTRY)}")


# ============================================================
# SETTINGS v2 — Είδη Αδρανών & Κόσκινα
# ============================================================

def get_all_products() -> list:
    """
    Επιστρέφει ΟΛΛΑ τα προϊόντα (ενεργά + ανενεργά)
    με τα κόσκινά τους ενσωματωμένα στο πεδίο 'sieves' (λίστα float, φθίνουσα).
    Έτσι το frontend κάνει ένα μόνο call αντί N+1.
    """
    conn = get_connection()
    products = [dict(r) for r in conn.execute(
        "SELECT * FROM tbl_products ORDER BY active DESC, d_min"
    ).fetchall()]

    # Φόρτωση κόσκινων για όλα τα προϊόντα με ένα query
    sieve_rows = conn.execute(
        """SELECT product_id, sieve_mm
             FROM tbl_product_sieves
            ORDER BY product_id, sieve_mm DESC"""
    ).fetchall()
    conn.close()

    # Ομαδοποίηση ανά product_id
    sieves_map = {}
    for row in sieve_rows:
        pid = row[0]
        if pid not in sieves_map:
            sieves_map[pid] = []
        sieves_map[pid].append(float(row[1]))

    for p in products:
        p['sieves'] = sieves_map.get(p['id'], [])

    return products


def add_product(material_type: str, d_min: float, d_max: float,
                standard: str, category: str) -> int:
    """
    Προσθήκη νέου είδους αδρανούς.
    Το name παράγεται αυτόματα: "[material_type] [d_min]/[d_max]"
    Επιστρέφει το νέο id.
    """
    material_type = material_type.strip().upper()
    standard      = standard.strip()
    category      = category.strip()
    d_min         = float(d_min)
    d_max         = float(d_max)

    allowed_cats = {'ΛΕΠΤΟΚΟΚΚΟ', 'ΧΟΝΔΡΟΚΟΚΚΟ', 'ALL_IN'}
    if category not in allowed_cats:
        raise ValueError(
            f"Μη έγκυρη κατηγορία '{category}'. "
            f"Επιτρέπονται: {', '.join(sorted(allowed_cats))}"
        )
    if d_min < 0 or d_max <= 0 or d_min >= d_max:
        raise ValueError(
            f"Μη έγκυρα όρια κόκκου: d_min={d_min}, d_max={d_max}. "
            "Απαιτείται 0 ≤ d_min < d_max."
        )

    name = _build_product_name(material_type, d_min, d_max)

    conn = get_connection()
    try:
        # Duplicate: ίδιος τύπος + ίδιο εύρος
        existing = conn.execute(
            """SELECT id FROM tbl_products
                WHERE UPPER(material_type)=UPPER(?)
                  AND d_min=? AND d_max=?""",
            (material_type, d_min, d_max)
        ).fetchone()
        if existing:
            raise ValueError(
                f"Υπάρχει ήδη '{name}'. "
                "Χρησιμοποιήστε διαφορετικό τύπο ή εύρος κόκκου."
            )
        cursor = conn.execute(
            """INSERT INTO tbl_products
                   (name, material_type, d_min, d_max, standard, category, active)
               VALUES (?, ?, ?, ?, ?, ?, 1)""",
            (name, material_type, d_min, d_max, standard, category)
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def _generate_product_code(name: str) -> str:
    """
    Παράγει σύντομο κωδικό από όνομα προϊόντος.
    πχ 'ΑΜΜΟΣ' → 'AM', 'ΓΑΡΜΠΙΛΙ' → 'GA', 'ΣΥΝΤΡΙΜΜΑ' → 'SY'
    Χρησιμοποιεί τα 2 πρώτα γράμματα (transliterated).
    """
    # Transliteration πρώτων χαρακτήρων
    tr = {
        'Α': 'A', 'Β': 'V', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E',
        'Ζ': 'Z', 'Η': 'I', 'Θ': 'TH', 'Ι': 'I', 'Κ': 'K',
        'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O',
        'Π': 'P', 'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y',
        'Φ': 'F', 'Χ': 'CH', 'Ψ': 'PS', 'Ω': 'O',
    }
    result = ''
    for ch in name.upper():
        if ch in tr:
            result += tr[ch]
        elif ch.isascii() and ch.isalpha():
            result += ch
        if len(result) >= 2:
            break
    return result[:2] if result else 'XX'


def update_product(product_id: int, material_type: str, d_min: float,
                   d_max: float, standard: str, category: str,
                   code: str = None) -> bool:
    """Ενημέρωση στοιχείων είδους αδρανούς."""
    material_type = material_type.strip().upper()
    standard      = standard.strip()
    category      = category.strip()
    d_min         = float(d_min)
    d_max         = float(d_max)
    product_id    = int(product_id)
    if code:
        code = code.strip().upper()

    allowed_cats = {'ΛΕΠΤΟΚΟΚΚΟ', 'ΧΟΝΔΡΟΚΟΚΚΟ', 'ALL_IN'}
    if category not in allowed_cats:
        raise ValueError(f"Μη έγκυρη κατηγορία '{category}'.")
    if d_min < 0 or d_max <= 0 or d_min >= d_max:
        raise ValueError(f"Μη έγκυρα όρια κόκκου: d_min={d_min}, d_max={d_max}.")

    name = _build_product_name(material_type, d_min, d_max)

    conn = get_connection()
    try:
        # Duplicate check (εκτός του ίδιου προϊόντος)
        existing = conn.execute(
            """SELECT id FROM tbl_products
                WHERE UPPER(material_type)=UPPER(?) AND d_min=? AND d_max=?
                  AND id != ?""",
            (material_type, d_min, d_max, product_id)
        ).fetchone()
        if existing:
            raise ValueError(f"Υπάρχει ήδη '{name}'.")

        if code:
            conn.execute(
                """UPDATE tbl_products
                      SET name=?, material_type=?, d_min=?, d_max=?,
                          standard=?, category=?, code=?
                    WHERE id=?""",
                (name, material_type, d_min, d_max, standard, category, code, product_id)
            )
        else:
            conn.execute(
                """UPDATE tbl_products
                      SET name=?, material_type=?, d_min=?, d_max=?,
                          standard=?, category=?
                    WHERE id=?""",
                (name, material_type, d_min, d_max, standard, category, product_id)
            )
        conn.commit()
        return True
    finally:
        conn.close()


def toggle_product(product_id: int, active: int) -> bool:
    """Ενεργοποίηση/απενεργοποίηση είδους αδρανούς."""
    product_id = int(product_id)
    active     = int(active)
    conn = get_connection()
    try:
        # Έλεγχος: δεν επιτρέπεται απενεργοποίηση αν υπάρχουν δείγματα
        if active == 0:
            count = conn.execute(
                "SELECT COUNT(*) FROM tbl_samples WHERE product_id=?",
                (product_id,)
            ).fetchone()[0]
            if count > 0:
                raise ValueError(
                    f"Δεν μπορεί να απενεργοποιηθεί: υπάρχουν {count} δείγματα "
                    "με αυτό το είδος αδρανούς."
                )
        conn.execute(
            "UPDATE tbl_products SET active=? WHERE id=?",
            (active, product_id)
        )
        conn.commit()
        return True
    finally:
        conn.close()


def get_product_sieves_full(product_id: int) -> list:
    """
    Επιστρέφει κόσκινα προϊόντος με πλήρη στοιχεία (id, sieve_mm, sieve_order).
    """
    conn = get_connection()
    results = [dict(r) for r in conn.execute(
        """SELECT id, sieve_mm, sieve_order
             FROM tbl_product_sieves
            WHERE product_id=?
            ORDER BY sieve_order""",
        (product_id,)
    ).fetchall()]
    conn.close()
    return results


def set_product_sieves(product_id: int, sieves: list) -> bool:
    """
    Αντικαθιστά ΟΛΑ τα κόσκινα ενός προϊόντος.
    sieves: λίστα από float (mm), πχ [31.5, 16, 8, 4, 2, 0.063]
    Ελέγχει ότι κανένα κόσκινο δεν χρησιμοποιείται σε ήδη αποθηκευμένες
    κοκκομετρίες (αν αφαιρεθεί κόσκινο που χρησιμοποιείται → error).
    """
    conn = get_connection()
    try:
        # Κόσκινα που ήδη υπάρχουν
        existing = {
            row[0]
            for row in conn.execute(
                "SELECT sieve_mm FROM tbl_product_sieves WHERE product_id=?",
                (product_id,)
            ).fetchall()
        }
        new_set = set(float(s) for s in sieves)
        removed = existing - new_set

        # Έλεγχος αν τα αφαιρούμενα κόσκινα χρησιμοποιούνται σε δοκιμές
        if removed:
            used = []
            for sieve_mm in removed:
                count = conn.execute(
                    """SELECT COUNT(*) FROM tbl_sieve_results sr
                         JOIN tbl_sieve_analysis sa
                              ON sr.sieve_analysis_id = sa.id
                        WHERE sa.sample_id IN
                              (SELECT id FROM tbl_samples WHERE product_id=?)
                          AND sr.sieve_mm = ?""",
                    (product_id, sieve_mm)
                ).fetchone()[0]
                if count > 0:
                    used.append(sieve_mm)
            if used:
                used_str = ', '.join(str(s) for s in sorted(used, reverse=True))
                raise ValueError(
                    f"Δεν μπορεί να αφαιρεθεί το κόσκινο {used_str} mm: "
                    "χρησιμοποιείται σε αποθηκευμένες κοκκομετρίες."
                )

        # Αντικατάσταση
        # Auto-register custom κόσκινα στον κεντρικό πίνακα
        for s in sieves:
            conn.execute(
                "INSERT OR IGNORE INTO tbl_sieves (sieve_mm, is_iso) VALUES (?, 0)",
                (float(s),)
            )
        conn.execute(
            "DELETE FROM tbl_product_sieves WHERE product_id=?",
            (product_id,)
        )
        for order, sieve_mm in enumerate(sieves, start=1):
            conn.execute(
                """INSERT INTO tbl_product_sieves
                       (product_id, sieve_mm, sieve_order)
                   VALUES (?, ?, ?)""",
                (product_id, float(sieve_mm), order)
            )
        conn.commit()
        return True
    finally:
        conn.close()


def delete_product(product_id: int) -> bool:
    """
    Οριστική διαγραφή είδους αδρανούς.
    Επιτρέπεται μόνο αν: active=0 ΚΑΙ δεν υπάρχουν δείγματα.
    Διαγράφει αυτόματα και τα κόσκινά του (CASCADE).
    """
    product_id = int(product_id)
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT name, active FROM tbl_products WHERE id=?",
            (product_id,)
        ).fetchone()
        if not row:
            raise ValueError("Το είδος αδρανούς δεν βρέθηκε.")

        name, active = row[0], int(row[1])
        if active:
            raise ValueError(
                f"Το είδος '{name}' είναι ενεργό. "
                "Απενεργοποιήστε το πρώτα."
            )

        count = conn.execute(
            "SELECT COUNT(*) FROM tbl_samples WHERE product_id=?",
            (product_id,)
        ).fetchone()[0]
        if count > 0:
            raise ValueError(
                f"Δεν μπορεί να διαγραφεί: υπάρχουν {count} δείγματα "
                f"με το είδος '{name}'."
            )

        # Διαγραφή κόσκινων + προδιαγραφών + προϊόντος
        conn.execute("DELETE FROM tbl_product_sieves WHERE product_id=?", (product_id,))
        conn.execute("DELETE FROM tbl_specifications WHERE product_id=?", (product_id,))
        conn.execute("DELETE FROM tbl_products WHERE id=?", (product_id,))
        conn.commit()
        return True
    finally:
        conn.close()


# ============================================================
# ΚΕΝΤΡΙΚΟΣ ΠΙΝΑΚΑΣ ΚΟΣΚΙΝΩΝ (tbl_sieves) — Migration 005
# ============================================================

def get_all_sieves() -> list:
    """
    Επιστρέφει όλα τα γνωστά κόσκινα (ISO + custom) φθίνουσα.
    Χρησιμοποιείται για autocomplete στο settings.
    """
    conn = get_connection()
    rows = [dict(r) for r in conn.execute(
        "SELECT sieve_mm, is_iso, note FROM tbl_sieves ORDER BY sieve_mm DESC"
    ).fetchall()]
    conn.close()
    return rows


def register_sieve(sieve_mm: float) -> bool:
    """
    Καταχωρεί custom κόσκινο στον κεντρικό πίνακα αν δεν υπάρχει ήδη.
    Καλείται αυτόματα από set_product_sieves.
    """
    sieve_mm = round(float(sieve_mm), 3)
    conn = get_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO tbl_sieves (sieve_mm, is_iso) VALUES (?, 0)",
            (sieve_mm,)
        )
        conn.commit()
        return True
    finally:
        conn.close()


def get_material_types() -> list:
    """
    Επιστρέφει μοναδικούς τύπους υλικών από tbl_products.
    Χρησιμοποιείται για autocomplete στο "Τύπος" πεδίο.
    """
    conn = get_connection()
    rows = conn.execute(
        "SELECT DISTINCT material_type FROM tbl_products WHERE material_type IS NOT NULL ORDER BY material_type"
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]


def _build_product_name(material_type: str, d_min: float, d_max: float) -> str:
    """Παράγει σύνθετο όνομα: 'ΑΜΜΟΣ 0/4', 'ΓΑΡΜΠΙΛΙ 4/16.5' κλπ."""
    def fmt(v):
        return str(int(v)) if v == int(v) else str(v)
    return f"{material_type.strip().upper()} {fmt(d_min)}/{fmt(d_max)}"


# ============================================================
# GUIDE SETTINGS
# ============================================================

def get_guide_enabled() -> bool:
    """Επιστρέφει αν το workflow guide είναι ενεργό."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT guide_enabled FROM tbl_laboratory WHERE id=1"
        ).fetchone()
        if row is None:
            return True  # default: ενεργό
        return bool(row[0]) if row[0] is not None else True
    except Exception:
        return True
    finally:
        conn.close()


def set_guide_enabled(enabled: bool) -> bool:
    """Ενεργοποίηση/απενεργοποίηση workflow guide."""
    conn = get_connection()
    try:
        # Προσθήκη column αν δεν υπάρχει
        try:
            conn.execute(
                "ALTER TABLE tbl_laboratory ADD COLUMN guide_enabled INTEGER DEFAULT 1"
            )
            conn.commit()
        except Exception:
            pass  # Ήδη υπάρχει
        conn.execute(
            "UPDATE tbl_laboratory SET guide_enabled=? WHERE id=1",
            (1 if enabled else 0,)
        )
        conn.commit()
        return True
    finally:
        conn.close()


# ============================================================
# CE PERIODS & SUBPERIODS
# ============================================================

def get_active_ce_period() -> dict:
    """Επιστρέφει την τρέχουσα CE period με την ενεργή υποπερίοδο."""
    conn = get_connection()
    try:
        period = conn.execute(
            "SELECT * FROM tbl_ce_periods WHERE active=1 LIMIT 1"
        ).fetchone()
        if not period:
            return {}
        period = dict(period)

        subperiod = conn.execute(
            "SELECT * FROM tbl_subperiods WHERE ce_period_id=? AND active=1 LIMIT 1",
            (period['id'],)
        ).fetchone()
        period['active_subperiod'] = dict(subperiod) if subperiod else None
        # Προσθήκη expiry status για το UI
        expiry = get_ce_expiry_status()
        period['_expiry_status'] = expiry.get('status')
        period['_days_left']     = expiry.get('days_left')
        return period
    finally:
        conn.close()


def get_all_ce_periods() -> list:
    """Επιστρέφει όλες τις CE periods με τις υποπεριόδους τους."""
    conn = get_connection()
    try:
        periods = [dict(r) for r in conn.execute(
            "SELECT * FROM tbl_ce_periods ORDER BY valid_from DESC"
        ).fetchall()]
        for p in periods:
            p['subperiods'] = [dict(r) for r in conn.execute(
                "SELECT * FROM tbl_subperiods WHERE ce_period_id=? ORDER BY valid_from",
                (p['id'],)
            ).fetchall()]
        return periods
    finally:
        conn.close()


def get_subperiod_for_date(sample_date: str) -> Optional[dict]:
    """
    Βρίσκει την υποπερίοδο που ίσχυε για μια συγκεκριμένη ημερομηνία δείγματος.
    Χρησιμοποιείται για αυτόματη ανάθεση subperiod_id κατά τη δημιουργία δείγματος.
    """
    conn = get_connection()
    try:
        # Βρες την CE period που καλύπτει την ημερομηνία
        period = conn.execute("""
            SELECT id FROM tbl_ce_periods
             WHERE valid_from <= ? AND valid_to >= ?
             ORDER BY valid_from DESC LIMIT 1
        """, (sample_date[:10], sample_date[:10])).fetchone()

        if not period:
            # Fallback: ενεργή CE period
            period = conn.execute(
                "SELECT id FROM tbl_ce_periods WHERE active=1 LIMIT 1"
            ).fetchone()

        if not period:
            return None

        # Βρες την υποπερίοδο εντός της CE period
        subperiod = conn.execute("""
            SELECT * FROM tbl_subperiods
             WHERE ce_period_id=? AND valid_from <= ?
             ORDER BY valid_from DESC LIMIT 1
        """, (period['id'], sample_date[:10])).fetchone()

        return dict(subperiod) if subperiod else None
    finally:
        conn.close()


def create_ce_period(ce_number: str, ce_body: str,
                     valid_from: str, valid_to: str,
                     data_folder: Optional[str] = None) -> int:
    """
    Δημιουργεί νέα CE period και την ορίζει ως ενεργή.
    Απενεργοποιεί την προηγούμενη.
    Επιστρέφει το id της νέας περιόδου.
    """
    conn = get_connection()
    try:
        # Απενεργοποίηση τρέχουσας
        conn.execute("UPDATE tbl_ce_periods SET active=0")

        cursor = conn.execute("""
            INSERT INTO tbl_ce_periods
                (ce_number, ce_body, valid_from, valid_to, data_folder, active)
            VALUES (?, ?, ?, ?, ?, 1)
        """, (ce_number, ce_body, valid_from, valid_to, data_folder))
        period_id = cursor.lastrowid
        conn.commit()
        return period_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def create_subperiod(ce_period_id: int, valid_from: str,
                     lab_report_number: Optional[str] = None,
                     notes: Optional[str] = None,
                     pdf_subfolder: bool = False,
                     ext_mb_value: Optional[float] = None,
                     ext_se_value: Optional[float] = None,
                     ext_fl_value: Optional[float] = None,
                     ext_sieve_results: Optional[str] = None) -> int:
    """
    Δημιουργεί νέα υποπερίοδο εντός CE period και την ορίζει ως ενεργή.
    Απενεργοποιεί την προηγούμενη υποπερίοδο της ίδιας CE period.
    Επιστρέφει το id της νέας υποπεριόδου.
    """
    conn = get_connection()
    try:
        # Απενεργοποίηση τρέχουσας υποπεριόδου της ίδιας CE period
        conn.execute(
            "UPDATE tbl_subperiods SET active=0 WHERE ce_period_id=?",
            (ce_period_id,)
        )

        cursor = conn.execute("""
            INSERT INTO tbl_subperiods
                (ce_period_id, lab_report_number, valid_from, notes,
                 pdf_subfolder, ext_mb_value, ext_se_value, ext_fl_value,
                 ext_sieve_results, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """, (ce_period_id, lab_report_number, valid_from, notes,
              1 if pdf_subfolder else 0,
              ext_mb_value, ext_se_value, ext_fl_value, ext_sieve_results))
        subperiod_id = cursor.lastrowid
        conn.commit()
        return subperiod_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_active_ce_period_folder(data_folder: str) -> dict:
    """Αποθηκεύει τον φάκελο στην τρέχουσα ενεργή CE period."""
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE tbl_ce_periods SET data_folder=? WHERE active=1",
            (data_folder,)
        )
        conn.commit()
        return {'ok': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}
    finally:
        conn.close()


def update_ce_period_folder(period_id: int, data_folder: str) -> bool:
    """Ενημερώνει τον φάκελο δεδομένων μιας CE period."""
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE tbl_ce_periods SET data_folder=? WHERE id=?",
            (data_folder, period_id)
        )
        conn.commit()
        return True
    finally:
        conn.close()









def get_init_status() -> dict:
    """
    Ελέγχει την κατάσταση αρχικοποίησης της εφαρμογής.
    Επιστρέφει ποια υποχρεωτικά βήματα έχουν ολοκληρωθεί.
    """
    conn = get_connection()
    try:
        lab = conn.execute(
            "SELECT name, ce_number, ce_valid_from, ce_valid_to FROM tbl_laboratory WHERE id=1"
        ).fetchone()

        has_lab     = bool(lab and lab['name'] and lab['name'].strip())
        has_ce_info = bool(lab and lab['ce_number'] and lab['ce_valid_from'] and lab['ce_valid_to'])

        ce_period = conn.execute(
            "SELECT id FROM tbl_ce_periods WHERE active=1 LIMIT 1"
        ).fetchone()
        has_ce_period = bool(ce_period)

        subperiod = conn.execute(
            "SELECT id FROM tbl_subperiods WHERE active=1 LIMIT 1"
        ).fetchone()
        has_subperiod = bool(subperiod)

        return {
            'has_lab':        has_lab,
            'has_ce_info':    has_ce_info,
            'has_ce_period':  has_ce_period,
            'has_subperiod':  has_subperiod,
            'is_complete':    has_lab and has_ce_period,
            'can_pdf':        has_lab and has_ce_period,
        }
    finally:
        conn.close()

def get_samples_count() -> int:
    """Επιστρέφει τον αριθμό δειγμάτων στη DB."""
    conn = get_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM tbl_samples").fetchone()[0]
    finally:
        conn.close()

def vacuum_into(dest_path: str) -> dict:
    """VACUUM INTO — δημιουργεί συμπιεσμένο αντίγραφο της DB."""
    conn = get_connection()
    try:
        conn.execute(f"VACUUM INTO '{dest_path}'")
        return {'ok': True, 'path': dest_path}
    except Exception as e:
        return {'ok': False, 'error': str(e)}
    finally:
        conn.close()

def clean_start(vacuum_dest_path: str,
                keep_technicians: bool = True,
                keep_products: bool = True) -> dict:
    """
    Clean Start — κλείσιμο τρέχουσας CE period:
    1. Διαγραφή δειγμάτων + εξαρτημένων δοκιμών
    2. Απενεργοποίηση CE period + υποπεριόδων (δεν διαγράφονται — παθητική προβολή)
    3. Reset sample_counter
    4. Προαιρετικά: διαγραφή τεχνικών / προϊόντων & προδιαγραφών
    Επιστρέφει {'ok': True, 'deleted': count} ή {'ok': False, 'error': ...}
    """
    conn = get_connection()
    try:
        # Μέτρηση δειγμάτων πριν
        count = conn.execute("SELECT COUNT(*) FROM tbl_samples").fetchone()[0]

        # Διαγραφή εξαρτημένων δοκιμών (με σειρά λόγω FK)
        conn.execute("DELETE FROM tbl_sieve_results WHERE sieve_analysis_id IN "
                     "(SELECT id FROM tbl_sieve_analysis)")
        conn.execute("DELETE FROM tbl_flakiness_results WHERE flakiness_id IN "
                     "(SELECT id FROM tbl_flakiness)")
        conn.execute("DELETE FROM tbl_se_measurements WHERE se_id IN "
                     "(SELECT id FROM tbl_sand_equivalent)")
        conn.execute("DELETE FROM tbl_sieve_analysis")
        conn.execute("DELETE FROM tbl_flakiness")
        conn.execute("DELETE FROM tbl_methylene_blue")
        conn.execute("DELETE FROM tbl_sand_equivalent")

        # Διαγραφή required_tests αν υπάρχει ο πίνακας
        try:
            conn.execute("DELETE FROM tbl_required_tests")
        except Exception:
            pass

        # Διαγραφή δειγμάτων
        conn.execute("DELETE FROM tbl_samples")

        # Απενεργοποίηση CE period + υποπεριόδων
        # (παραμένουν στη βάση για παθητική προβολή — v1.00)
        conn.execute("UPDATE tbl_ce_periods  SET active=0 WHERE active=1")
        conn.execute("UPDATE tbl_subperiods  SET active=0 WHERE active=1")

        # Reset sample counter
        cols = [r[1] for r in conn.execute("PRAGMA table_info(tbl_laboratory)").fetchall()]
        if 'sample_counter' in cols:
            conn.execute("UPDATE tbl_laboratory SET sample_counter=1 WHERE id=1")

        # Προαιρετική διαγραφή αναφορικών δεδομένων
        if not keep_technicians:
            conn.execute("DELETE FROM tbl_technicians")

        if not keep_products:
            # Σειρά: πρώτα τα παιδιά (FK), μετά οι γονείς
            conn.execute("DELETE FROM tbl_specifications")
            conn.execute("DELETE FROM tbl_product_sieves")
            conn.execute("DELETE FROM tbl_products")

        conn.commit()
        conn.close()

        conn2 = get_connection()
        try:
            conn2.execute("VACUUM")
            conn2.close()
        except Exception:
            pass

        return {'ok': True, 'deleted': count}
    except Exception as e:
        try: conn.rollback()
        except: pass
        try: conn.close()
        except: pass
        return {'ok': False, 'error': str(e)}

def delete_subperiod(subperiod_id: int) -> dict:
    """
    Διαγράφει υποπερίοδο αν δεν έχει δείγματα.
    Αν ήταν active, ενεργοποιεί την προηγούμενη.
    Επιστρέφει {'ok': True} ή {'ok': False, 'reason': ..., 'count': ...}
    """
    conn = get_connection()
    try:
        sub = conn.execute(
            "SELECT * FROM tbl_subperiods WHERE id=?", (subperiod_id,)
        ).fetchone()
        if not sub:
            return {'ok': False, 'reason': 'not_found'}

        # Έλεγχος δειγμάτων
        count = conn.execute(
            "SELECT COUNT(*) FROM tbl_samples WHERE subperiod_id=?",
            (subperiod_id,)
        ).fetchone()[0]
        if count > 0:
            return {'ok': False, 'reason': 'has_samples', 'count': count}

        # Έλεγχος αν είναι μοναδική
        total = conn.execute(
            "SELECT COUNT(*) FROM tbl_subperiods WHERE ce_period_id=?",
            (sub['ce_period_id'],)
        ).fetchone()[0]
        if total <= 1:
            return {'ok': False, 'reason': 'last_subperiod'}

        conn.execute("DELETE FROM tbl_subperiods WHERE id=?", (subperiod_id,))

        # Αν ήταν active → ενεργοποίηση προηγούμενης
        if sub['active']:
            prev = conn.execute(
                """SELECT id FROM tbl_subperiods
                    WHERE ce_period_id=? ORDER BY valid_from DESC LIMIT 1""",
                (sub['ce_period_id'],)
            ).fetchone()
            if prev:
                conn.execute(
                    "UPDATE tbl_subperiods SET active=1 WHERE id=?", (prev['id'],)
                )

        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


def delete_ce_period(period_id: int) -> dict:
    """
    Διαγράφει CE period αν δεν έχει δείγματα και δεν είναι μοναδική.
    Αν ήταν active, ενεργοποιεί την προηγούμενη.
    Επιστρέφει {'ok': True} ή {'ok': False, 'reason': ..., 'count': ...}
    """
    conn = get_connection()
    try:
        period = conn.execute(
            "SELECT * FROM tbl_ce_periods WHERE id=?", (period_id,)
        ).fetchone()
        if not period:
            return {'ok': False, 'reason': 'not_found'}

        # Έλεγχος αν είναι μοναδική
        total = conn.execute(
            "SELECT COUNT(*) FROM tbl_ce_periods"
        ).fetchone()[0]
        if total <= 1:
            return {'ok': False, 'reason': 'last_period'}

        # Έλεγχος δειγμάτων μέσω υποπεριόδων
        count = conn.execute("""
            SELECT COUNT(*) FROM tbl_samples s
             JOIN tbl_subperiods sp ON s.subperiod_id = sp.id
            WHERE sp.ce_period_id=?
        """, (period_id,)).fetchone()[0]
        if count > 0:
            return {'ok': False, 'reason': 'has_samples', 'count': count}

        # Διαγραφή υποπεριόδων και CE period
        conn.execute("DELETE FROM tbl_subperiods WHERE ce_period_id=?", (period_id,))
        conn.execute("DELETE FROM tbl_ce_periods  WHERE id=?", (period_id,))

        # Αν ήταν active → ενεργοποίηση προηγούμενης
        if period['active']:
            prev = conn.execute(
                "SELECT id FROM tbl_ce_periods ORDER BY valid_from DESC LIMIT 1"
            ).fetchone()
            if prev:
                conn.execute(
                    "UPDATE tbl_ce_periods SET active=1 WHERE id=?", (prev['id'],)
                )

        conn.commit()
        return {'ok': True}
    finally:
        conn.close()

def update_ce_period(period_id: int, ce_number: str, ce_body: Optional[str],
                     valid_from: str, valid_to: str) -> bool:
    """Ενημερώνει στοιχεία υπάρχουσας CE period (χωρίς αλλαγή φακέλου/active)."""
    conn = get_connection()
    try:
        conn.execute("""
            UPDATE tbl_ce_periods
               SET ce_number=?, ce_body=?, valid_from=?, valid_to=?
             WHERE id=?
        """, (ce_number, ce_body, valid_from, valid_to, period_id))
        conn.commit()
        return True
    finally:
        conn.close()

def update_subperiod(subperiod_id: int,
                     lab_report_number: Optional[str] = None,
                     notes: Optional[str] = None,
                     pdf_subfolder: Optional[bool] = None,
                     ext_mb_value: Optional[float] = None,
                     ext_se_value: Optional[float] = None,
                     ext_fl_value: Optional[float] = None,
                     ext_sieve_results: Optional[str] = None) -> bool:
    """Ενημερώνει στοιχεία υπάρχουσας υποπεριόδου (εκ των υστερων καταχώρηση έκθεσης)."""
    fields = {}
    if lab_report_number is not None: fields['lab_report_number'] = lab_report_number
    if notes             is not None: fields['notes']             = notes
    if pdf_subfolder     is not None: fields['pdf_subfolder']     = 1 if pdf_subfolder else 0
    if ext_mb_value      is not None: fields['ext_mb_value']      = ext_mb_value
    if ext_se_value      is not None: fields['ext_se_value']      = ext_se_value
    if ext_fl_value      is not None: fields['ext_fl_value']      = ext_fl_value
    if ext_sieve_results is not None: fields['ext_sieve_results'] = ext_sieve_results
    if not fields:
        return False
    set_clause = ', '.join(f"{k}=?" for k in fields)
    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE tbl_subperiods SET {set_clause} WHERE id=?",
            list(fields.values()) + [subperiod_id]
        )
        conn.commit()
        return True
    finally:
        conn.close()

def get_ce_expiry_status() -> dict:
    """
    Ελέγχει την κατάσταση λήξης της ενεργής CE period.
    Επιστρέφει:
      status: 'ok' | 'warning' | 'urgent' | 'expired'
      days_left: int (αρνητικό αν έχει λήξει)
      valid_to: str
    """
    conn = get_connection()
    try:
        period = conn.execute(
            "SELECT valid_to FROM tbl_ce_periods WHERE active=1 LIMIT 1"
        ).fetchone()
        if not period or not period['valid_to']:
            return {'status': 'ok', 'days_left': None, 'valid_to': None}

        from datetime import date
        valid_to_str = period['valid_to']
        # Υποστήριξη DD/MM/YYYY και YYYY-MM-DD
        try:
            if '/' in valid_to_str:
                d, m, y = valid_to_str.split('/')
                expiry = date(int(y), int(m), int(d))
            else:
                expiry = date.fromisoformat(valid_to_str[:10])
        except Exception:
            return {'status': 'ok', 'days_left': None, 'valid_to': valid_to_str}

        days_left = (expiry - date.today()).days

        if days_left < 0:
            status = 'expired'
        elif days_left <= 30:
            status = 'urgent'
        elif days_left <= 90:
            status = 'warning'
        else:
            status = 'ok'

        return {
            'status':    status,
            'days_left': days_left,
            'valid_to':  valid_to_str,
        }
    finally:
        conn.close()
