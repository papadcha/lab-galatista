import sys
import io
import json
import os
import logging
from logging.handlers import RotatingFileHandler

# Ορισμός UTF-8 για stdin/stdout/stderr — κρίσιμο για PyInstaller on Windows
# (το PYTHONIOENCODING env var δεν είναι αρκετό για bundled exe)
if hasattr(sys.stdin, 'buffer'):
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8',
                                   errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'buffer'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8',
                                   errors='replace', line_buffering=True)

# Προσθήκη του root φακέλου στο path
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# Ανεξάρτητο rotating log file — δεν εξαρτάται από το αν ο Node προλαβαίνει
# να προωθήσει/αποθηκεύσει το stdout (modules/logger.js, main.js side).
# LAB_LOG_DIR έρχεται από modules/python-bridge.js's spawn env· αν λείπει
# (π.χ. τρέξιμο του server.py έξω από το Electron app), απλά δεν γράφεται
# αρχείο — τα logging.* calls απλά δεν πάνε πουθενά, χωρίς σφάλμα.
_log_dir = os.environ.get('LAB_LOG_DIR')
if _log_dir:
    try:
        os.makedirs(_log_dir, exist_ok=True)
        _handler = RotatingFileHandler(
            os.path.join(_log_dir, 'python.log'),
            maxBytes=5 * 1024 * 1024, backupCount=3, encoding='utf-8'
        )
        _handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
        logging.getLogger().addHandler(_handler)
        logging.getLogger().setLevel(logging.INFO)
    except Exception:
        pass

from i18n import t
from database.db_manager import (
    get_all_products,
    add_product,
    update_product,
    toggle_product,
    get_product_sieves_full,
    delete_product,
    get_all_sieves,
    get_material_types,
    get_guide_enabled,
    set_guide_enabled,
    set_product_sieves,
    create_sample_with_rename,
    get_sources,
    initialize_database,
    generate_sample_code,
    create_sample,
    get_sample,
    update_sample,
    search_samples,
    get_products,
    get_technicians,
    get_product_sieves,
    save_sieve_analysis,
    get_sieve_analysis,
    save_methylene_blue,
    get_last_mb_volume,
    save_sand_equivalent,
    save_flakiness,
    # --- Νέα από v1.1 ---
    save_lab_info,
    get_smtp_config,
    save_smtp_config,
    add_source, update_source, toggle_source, delete_source, get_all_sources,
    get_all_technicians, toggle_technician, delete_technician,
    save_specifications,
    get_specifications,
    get_required_tests,
    set_required_tests,
    get_default_required_tests,
    initialize_required_tests_default,
    get_test_history,
    mark_run_rejected,
    update_rejected_reason,
    promote_run_to_official,
    delete_test_run,
    is_test_allowed_for_category,
    get_allowed_tests_for_category,
    TEST_REGISTRY,
    # --- CE Periods & Subperiods (v0.99.2) ---
    get_active_ce_period,
    get_all_ce_periods,
    get_subperiod_for_date,
    get_subperiod_by_id,
    create_ce_period,
    create_subperiod,
    update_ce_period_folder,
    update_active_ce_period_folder,
    update_ce_period,
    delete_subperiod,
    delete_ce_period,
    clean_start,
    vacuum_into,
    check_db_integrity,
    switch_db,
    restore_db,
    find_archive_db,
    inspect_backup_samples,
    check_sample_code_conflict,
    merge_sample_from_backup,
    get_doc_sections,
    create_doc_section,
    update_doc_section,
    delete_doc_section,
    get_documents,
    create_document,
    update_document,
    delete_document,
    get_documents_for_standards_check,
    export_document_library,
    import_document_library,
    get_samples_count,
    get_init_status,
    update_subperiod,
    get_ce_expiry_status,
    get_subperiod_specs,
    set_subperiod_specs,
    get_subperiod_specifications,
    save_subperiod_specifications,
    get_effective_specifications,
    copy_previous_subperiod_specs,
    _build_product_name,
)
from calculations import (
    suggest_mb_initial_volume,
    get_full_sample_report,
)
from datetime import date

def _check_value(value, lower, upper):
    if lower is not None and value < lower: return 'fail'
    if upper is not None and value > upper: return 'fail'
    return 'ok'

def _get_full_report_with_specs(sample_id):
    r = get_full_sample_report(sample_id)

    # Inject spec_checks από tbl_test_limits ανεξάρτητα από calculations.py
    from database.db_manager import get_connection
    conn = get_connection()
    product_id = r.get('sample', {}).get('product_id')

    try:
        for test_type, test_key, val_key in [
            ('mb',  'methylene_blue',  'mb_value'),
            ('se',  'sand_equivalent', 'se_final'),
            ('fi',  'flakiness',       'fi_index'),
        ]:
            test = r.get('tests', {}).get(test_key)
            if not test:
                continue
            value = test.get(val_key)
            if value is None:
                continue
            rows = conn.execute(
                'SELECT * FROM tbl_test_limits WHERE product_id=? AND test_type=?',
                (product_id, test_type)
            ).fetchall()
            checks = []
            for row in rows:
                row = dict(row)
                lower = row['limit_value'] if row['parameter'].endswith('_min') else None
                upper = row['limit_value'] if row['parameter'].endswith('_max') else None
                checks.append({
                    'spec_type':   row['spec_type'],
                    'spec_name':   row['spec_name'],
                    val_key:       value,
                    'lower_limit': lower,
                    'upper_limit': upper,
                    'status':      _check_value(value, lower, upper),
                })
            test['spec_checks'] = checks
    finally:
        conn.close()
    return r


# ============================================================
# BATCH PDF LIBRARY
# ============================================================

def generate_pdf_library(data_folder: str) -> dict:
    """
    Δημιουργεί PDF για όλα τα ολοκληρωμένα δείγματα της τρέχουσας DB.
    Ολοκληρωμένο = όλες οι δηλωμένες δοκιμές έχουν is_official=1.
    Αποθηκεύει στο {data_folder}/pdf/{UP<id>?}/{productFolder}/{code}.pdf
    """
    import re as _re
    from database.db_manager import get_connection as _get_conn
    conn = _get_conn()
    try:
        samples = conn.execute("""
            SELECT s.id, s.code, s.date, s.subperiod_id,
                   p.name  AS product_name,
                   p.code  AS product_code,
                   p.d_min, p.d_max,
                   sp.pdf_subfolder,
                   sp.id   AS subperiod_seq
            FROM tbl_samples s
            JOIN tbl_products p ON p.id = s.product_id
            LEFT JOIN tbl_subperiods sp ON sp.id = s.subperiod_id
            WHERE
              EXISTS (SELECT 1 FROM tbl_required_tests WHERE sample_id = s.id)
              AND s.id NOT IN (
                SELECT DISTINCT s2.id FROM tbl_samples s2
                JOIN tbl_required_tests rt ON rt.sample_id = s2.id
                WHERE
                  (rt.test_type = 'sieve' AND NOT EXISTS (
                      SELECT 1 FROM tbl_sieve_analysis sa
                       WHERE sa.sample_id = s2.id AND sa.is_official = 1))
                  OR (rt.test_type = 'flakiness' AND NOT EXISTS (
                      SELECT 1 FROM tbl_flakiness fl
                       WHERE fl.sample_id = s2.id AND fl.is_official = 1))
                  OR (rt.test_type = 'mb' AND NOT EXISTS (
                      SELECT 1 FROM tbl_methylene_blue mb
                       WHERE mb.sample_id = s2.id AND mb.is_official = 1))
                  OR (rt.test_type = 'se' AND NOT EXISTS (
                      SELECT 1 FROM tbl_sand_equivalent se
                       WHERE se.sample_id = s2.id AND se.is_official = 1))
              )
            ORDER BY s.date, s.code
        """).fetchall()
        conn.close()
    except Exception as e:
        try: conn.close()
        except: pass
        return {'ok': False, 'error': str(e)}

    generated, skipped, errors = 0, 0, []

    for row in samples:
        s = dict(row)
        try:
            # ── Κατασκευή path ───────────────────────────────
            code  = s.get('product_code') or ''
            d_min = s.get('d_min')
            d_max = s.get('d_max')
            def _fmt(v):
                if v is None: return ''
                n = float(v)
                return str(int(n)) if n % 1 == 0 else str(n)
            pf = f"{code}{_fmt(d_min)}-{_fmt(d_max)}" if code else (s.get('product_name') or 'ΑΛΛΟ')
            pf = _re.sub(r'[/\?%*:|"<>]', '-', pf).strip()

            sub_dir = f"UP{s['subperiod_seq']}" if s.get('pdf_subfolder') else None
            out_dir = (os.path.join(data_folder, 'pdf', sub_dir, pf)
                       if sub_dir else os.path.join(data_folder, 'pdf', pf))
            os.makedirs(out_dir, exist_ok=True)
            output_path = os.path.join(out_dir, f"{s['code']}.pdf")

            # ── Παραγωγή PDF ─────────────────────────────────
            result = _generate_pdf_report(
                s['id'], ['sieve', 'flakiness', 'se', 'mb'], output_path
            )
            if result.get('success'):
                generated += 1
            else:
                skipped += 1
                errors.append(f"{s['code']}: {result.get('error', '')}")
        except Exception as e:
            skipped += 1
            errors.append(f"{s['code']}: {str(e)}")

    return {'ok': True, 'generated': generated, 'skipped': skipped,
            'total': len(samples), 'errors': errors}


# ============================================================
# QUERY για dashboard — λαμβάνει υπόψη is_official=1
# ============================================================

SAMPLES_BASE_QUERY = """
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
           -- Required tests από tbl_required_tests (comma-separated)
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
"""


# ============================================================
# DASHBOARD HELPERS
# ============================================================

def get_lab_info():
    """Στοιχεία εργαστηρίου."""
    from database.db_manager import get_connection
    conn = get_connection()
    lab = conn.execute("SELECT * FROM tbl_laboratory WHERE id=1").fetchone()
    conn.close()
    return dict(lab) if lab else {}


def get_dashboard_stats():
    """
    Στατιστικά για την αρχική οθόνη.
    CE period, εκκρεμή, εκτός προδιαγραφών.
    """
    from database.db_manager import get_connection, get_active_ce_period
    conn  = get_connection()
    today = date.today().isoformat()

    # CE Period από tbl_ce_periods (όχι tbl_laboratory)
    period = get_active_ce_period()
    ce_from = period.get('valid_from') if period else None
    ce_to   = period.get('valid_to')   if period else None

    # Μορφοποίηση ημερομηνιών για εμφάνιση
    def fmt(d):
        if not d: return ''
        if '-' in str(d) and len(str(d)) >= 10:
            parts = str(d)[:10].split('-')
            return f"{parts[2]}/{parts[1]}/{parts[0]}"
        return str(d)

    ce_period = f"{fmt(ce_from)} — {fmt(ce_to)}" if ce_from and ce_to else ""

    # Μέτρηση δειγμάτων περιόδου
    if ce_from:
        # Υποστήριξη DD/MM/YYYY και YYYY-MM-DD
        from_iso = ce_from
        if '/' in str(ce_from):
            p = str(ce_from).split('/')
            from_iso = f"{p[2]}-{p[1].zfill(2)}-{p[0].zfill(2)}"
        ce_count = conn.execute(
            "SELECT COUNT(*) FROM tbl_samples WHERE date >= ?", (from_iso[:10],)
        ).fetchone()[0]
    else:
        ce_count = conn.execute("SELECT COUNT(*) FROM tbl_samples").fetchone()[0]

    today_count = conn.execute(
        "SELECT COUNT(*) FROM tbl_samples WHERE date=?", (today,)
    ).fetchone()[0]

    # Εκκρεμή
    pending_count = conn.execute("""
        SELECT COUNT(DISTINCT s.id)
          FROM tbl_samples s
          JOIN tbl_required_tests rt ON rt.sample_id = s.id
         WHERE
            (rt.test_type = 'sieve' AND NOT EXISTS (
                SELECT 1 FROM tbl_sieve_analysis sa
                 WHERE sa.sample_id = s.id AND sa.is_official = 1
            ))
            OR (rt.test_type = 'flakiness' AND NOT EXISTS (
                SELECT 1 FROM tbl_flakiness fl
                 WHERE fl.sample_id = s.id AND fl.is_official = 1
            ))
            OR (rt.test_type = 'mb' AND NOT EXISTS (
                SELECT 1 FROM tbl_methylene_blue mb
                 WHERE mb.sample_id = s.id AND mb.is_official = 1
            ))
            OR (rt.test_type = 'se' AND NOT EXISTS (
                SELECT 1 FROM tbl_sand_equivalent se
                 WHERE se.sample_id = s.id AND se.is_official = 1
            ))
    """).fetchone()[0]

    recent_count = conn.execute("SELECT COUNT(*) FROM tbl_samples").fetchone()[0]

    # Εκτός προδιαγραφών — σύγκριση με tbl_test_limits
    fail_count = conn.execute("""
        SELECT COUNT(DISTINCT s.id) FROM tbl_samples s
        WHERE
          -- MB εκτός
          EXISTS (
            SELECT 1 FROM tbl_methylene_blue mb
            JOIN tbl_test_limits lim ON lim.product_id = s.product_id
              AND lim.test_type = 'mb'
            WHERE mb.sample_id = s.id AND mb.mb_value IS NOT NULL
              AND (
                (lim.parameter LIKE '%_max' AND mb.mb_value > lim.limit_value) OR
                (lim.parameter LIKE '%_min' AND mb.mb_value < lim.limit_value)
              )
          )
          OR
          -- SE εκτός
          EXISTS (
            SELECT 1 FROM tbl_sand_equivalent se
            JOIN tbl_test_limits lim ON lim.product_id = s.product_id
              AND lim.test_type = 'se'
            WHERE se.sample_id = s.id AND se.se_final IS NOT NULL
              AND (
                (lim.parameter LIKE '%_max' AND se.se_final > lim.limit_value) OR
                (lim.parameter LIKE '%_min' AND se.se_final < lim.limit_value)
              )
          )
          OR
          -- FI εκτός
          EXISTS (
            SELECT 1 FROM tbl_flakiness fl
            JOIN tbl_test_limits lim ON lim.product_id = s.product_id
              AND lim.test_type = 'fi'
            WHERE fl.sample_id = s.id AND fl.fi_index IS NOT NULL
              AND (
                (lim.parameter LIKE '%_max' AND fl.fi_index > lim.limit_value) OR
                (lim.parameter LIKE '%_min' AND fl.fi_index < lim.limit_value)
              )
          )
    """).fetchone()[0]

    conn.close()

    return {
        "ce_count":     ce_count,
        "ce_period":    ce_period,
        "pending":      pending_count,
        "recent_count": min(recent_count, 20),
        "recent_today": today_count,
        "fail":         fail_count,
    }


def get_dashboard_samples(filter_type: str = "recent") -> list:
    """
    Επιστρέφει δείγματα για τον πίνακα αρχικής.
    filter_type: "recent" | "pending" | "fail"

    «pending»: δείγματα με τουλάχιστον μία απαιτούμενη δοκιμή
               που δεν έχει official run.
    """
    from database.db_manager import get_connection
    conn = get_connection()

    if filter_type == "pending":
        query = f"""
            {SAMPLES_BASE_QUERY}
            WHERE EXISTS (
                SELECT 1 FROM tbl_required_tests rt
                 WHERE rt.sample_id = s.id
                   AND (
                     (rt.test_type = 'sieve'     AND sa.id IS NULL) OR
                     (rt.test_type = 'flakiness' AND fl.id IS NULL) OR
                     (rt.test_type = 'mb'        AND mb.id IS NULL) OR
                     (rt.test_type = 'se'        AND se.id IS NULL)
                   )
            )
            ORDER BY s.date DESC, s.id DESC
            LIMIT 50
        """
    elif filter_type == "fail":
        query = f"""
            {SAMPLES_BASE_QUERY}
            WHERE EXISTS (
                SELECT 1 FROM tbl_test_limits lim
                WHERE lim.product_id = s.product_id
                  AND (
                    (lim.test_type='mb' AND mb.mb_value IS NOT NULL AND (
                      (lim.parameter LIKE '%_max' AND mb.mb_value > lim.limit_value) OR
                      (lim.parameter LIKE '%_min' AND mb.mb_value < lim.limit_value)
                    )) OR
                    (lim.test_type='se' AND se.se_final IS NOT NULL AND (
                      (lim.parameter LIKE '%_max' AND se.se_final > lim.limit_value) OR
                      (lim.parameter LIKE '%_min' AND se.se_final < lim.limit_value)
                    )) OR
                    (lim.test_type='fi' AND fl.fi_index IS NOT NULL AND (
                      (lim.parameter LIKE '%_max' AND fl.fi_index > lim.limit_value) OR
                      (lim.parameter LIKE '%_min' AND fl.fi_index < lim.limit_value)
                    ))
                  )
            )
            ORDER BY s.date DESC
            LIMIT 50
        """
    else:  # recent
        query = f"""
            {SAMPLES_BASE_QUERY}
            ORDER BY s.date DESC, s.id DESC
            LIMIT 20
        """

    results = [dict(r) for r in conn.execute(query).fetchall()]
    conn.close()
    return results


# ============================================================
# SAMPLE-LEVEL ACTIONS
# ============================================================

def delete_sample(sample_id: int) -> bool:
    """
    Διαγραφή δείγματος και όλων των δοκιμών του.

    Σημαντικό: το ON DELETE CASCADE των parent tables (tbl_samples)
    διαγράφει τα test records, αλλά τα children records
    (tbl_sieve_results, tbl_se_measurements, tbl_flakiness_results)
    δεν έχουν cascade. Πρέπει να καθαριστούν χειροκίνητα ΠΡΙΝ.
    """
    from database.db_manager import get_connection
    conn = get_connection()

    # SE measurements (όλα τα runs, όχι μόνο official)
    conn.execute("""
        DELETE FROM tbl_se_measurements WHERE se_id IN
            (SELECT id FROM tbl_sand_equivalent WHERE sample_id=?)
    """, (sample_id,))
    conn.execute(
        "DELETE FROM tbl_sand_equivalent WHERE sample_id=?", (sample_id,)
    )

    # MB (δεν έχει children)
    conn.execute(
        "DELETE FROM tbl_methylene_blue WHERE sample_id=?", (sample_id,)
    )

    # Flakiness results
    conn.execute("""
        DELETE FROM tbl_flakiness_results WHERE flakiness_id IN
            (SELECT id FROM tbl_flakiness WHERE sample_id=?)
    """, (sample_id,))
    conn.execute(
        "DELETE FROM tbl_flakiness WHERE sample_id=?", (sample_id,)
    )

    # Sieve results
    conn.execute("""
        DELETE FROM tbl_sieve_results WHERE sieve_analysis_id IN
            (SELECT id FROM tbl_sieve_analysis WHERE sample_id=?)
    """, (sample_id,))
    conn.execute(
        "DELETE FROM tbl_sieve_analysis WHERE sample_id=?", (sample_id,)
    )

    # tbl_required_tests έχει CASCADE → διαγράφεται αυτόματα.
    conn.execute("DELETE FROM tbl_samples WHERE id=?", (sample_id,))
    conn.commit()
    conn.close()
    return True


def update_sample_info(sample_id: int, code: str, date: str,
                       technician_id, location: str, batch: str, comments: str) -> bool:
    """Ενημέρωση στοιχείων δείγματος."""
    return update_sample(
        sample_id,
        code=code, date=date,
        technician_id=technician_id,
        location=location, batch=batch, comments=comments,
    )


def add_technician(name: str) -> int:
    """Προσθήκη νέου τεχνικού."""
    from database.db_manager import get_connection
    conn = get_connection()
    cursor = conn.execute(
        "INSERT INTO tbl_technicians (name, active) VALUES (?, 1)", (name,)
    )
    conn.commit()
    tech_id = cursor.lastrowid
    conn.close()
    return tech_id


# ============================================================
# WRAPPERS που γεφυρώνουν παλιό API ↔ νέο db_manager
# ============================================================

def create_sample_with_plan_and_rename(code_info, date, product_id,
                                       technician_id=None, location=None,
                                       batch=None, comments=None,
                                       required_tests=None, source_id=1):
    """
    Νέα έκδοση: δέχεται code_info dict από generate_sample_code
    (με rename_id/rename_to) και source_id.
    """
    # Αν code_info είναι dict, χρησιμοποιούμε create_sample_with_rename
    if isinstance(code_info, dict):
        sample_id = create_sample_with_rename(
            code_info=code_info, date=date, product_id=product_id,
            technician_id=technician_id, location=location,
            batch=batch, comments=comments, source_id=source_id,
        )
    else:
        # Fallback για manual κωδικό (string)
        sample_id = create_sample(
            code=str(code_info), date=date, product_id=product_id,
            technician_id=technician_id, location=location,
            batch=batch, comments=comments, source_id=source_id,
        )
    # Ορισμός πλάνου
    # ΣΗΜΑΝΤΙΚΟ: required_tests=None → default, required_tests=[] → κενό πλάνο,
    # required_tests=[...] → συγκεκριμένο πλάνο
    if required_tests is None:
        initialize_required_tests_default(sample_id, product_id)
    else:
        # Και για κενή λίστα και για μη-κενή — πάντα αποθηκεύουμε αυτό που επέλεξε ο χρήστης
        set_required_tests(sample_id, required_tests)
    return sample_id


def create_sample_with_plan(code, date, product_id,
                            technician_id=None, location=None,
                            batch=None, comments=None,
                            required_tests=None):
    """
    Δημιουργία δείγματος + ορισμός πλάνου σε μία κλήση.
    Αν required_tests=None → χρησιμοποιεί τις προτεινόμενες της κατηγορίας.
    Αν required_tests=[]   → δείγμα χωρίς πλάνο.
    Αν required_tests=[..] → ακριβώς αυτές (με validation).
    """
    sample_id = create_sample(
        code=code, date=date, product_id=product_id,
        technician_id=technician_id, location=location,
        batch=batch, comments=comments,
    )
    if required_tests is None:
        initialize_required_tests_default(sample_id, product_id)
    else:
        if required_tests:
            set_required_tests(sample_id, required_tests)
    return sample_id


def get_test_registry_meta() -> dict:
    """
    Επιστρέφει meta του TEST_REGISTRY για χρήση από το frontend.
    Δεν επιστρέφει sets (μη-JSON-serializable) — μετατροπή σε lists.
    """
    return {
        tt: {
            'label':              meta['label'],
            'standard':           meta['standard'],
            'allowed_categories': sorted(meta['allowed_categories']),
        }
        for tt, meta in TEST_REGISTRY.items()
    }


# ============================================================
# DISPATCHER — Δρομολόγηση κλήσεων
# ============================================================

# Μέθοδοι που επιτρέπεται να καλέσει το renderer (μέσω pyBridge.call /
# window.pyBridge.<method>) — ελέγχεται από το main process
# (modules/python-bridge.js) πριν προωθηθεί οποιοδήποτε 'py-call' αίτημα
# εδώ. Οτιδήποτε στο METHODS παρακάτω αλλά ΟΧΙ εδώ (π.χ. vacuum_into,
# clean_start, switch_db, restore_db, find_archive_db) καλείται ΜΟΝΟ από
# το main process (μέσω _pyCallMain), ποτέ απευθείας από το renderer —
# defense-in-depth ώστε ένα μελλοντικό XSS να μην έχει πρόσβαση σε
# ευαίσθητες λειτουργίες (διαγραφή δεδομένων, αλλαγή ενεργής βάσης κλπ).
RENDERER_METHODS = frozenset({
    'add_product', 'add_source', 'add_technician',
    'copy_previous_subperiod_specs',
    'create_ce_period', 'create_doc_section', 'create_document',
    'create_sample_with_plan_and_rename', 'create_subperiod',
    'delete_ce_period', 'delete_doc_section', 'delete_document',
    'delete_product', 'delete_sample', 'delete_source', 'delete_subperiod',
    'delete_technician',
    'generate_sample_code',
    'get_active_ce_period', 'get_all_ce_periods', 'get_all_products',
    'get_all_sieves', 'get_all_sources', 'get_all_technicians',
    'get_dashboard_samples', 'get_dashboard_stats', 'get_doc_sections',
    'get_documents', 'get_documents_for_standards_check',
    'get_effective_specifications', 'get_full_report', 'get_guide_enabled',
    'get_init_status', 'get_lab_info', 'get_material_types',
    'get_product_sieves', 'get_product_sieves_full', 'get_products',
    'get_required_tests', 'get_samples_count', 'get_smtp_config',
    'get_sources', 'get_specifications', 'get_subperiod_by_id',
    'get_subperiod_specifications', 'get_subperiod_specs',
    'get_technicians', 'get_test_history', 'get_test_registry_meta',
    'promote_run_to_official',
    'save_flakiness', 'save_lab_info', 'save_methylene_blue',
    'save_sand_equivalent', 'save_sieve_analysis', 'save_smtp_config',
    'save_specifications', 'save_subperiod_specifications',
    'search_samples',
    'set_guide_enabled', 'set_product_sieves', 'set_required_tests',
    'set_subperiod_specs', 'suggest_initial_volume',
    'toggle_product', 'toggle_source', 'toggle_technician',
    'update_ce_period', 'update_ce_period_folder', 'update_doc_section',
    'update_document', 'update_product', 'update_rejected_reason',
    'update_sample', 'update_source', 'update_subperiod',
})

METHODS = {
    'list_renderer_methods': lambda args: sorted(RENDERER_METHODS),

    # --- ΥΠΑΡΧΟΥΣΕΣ (συμβατές με παλιό frontend) ---

    'get_products':          lambda args: get_products(),
    'get_technicians':       lambda args: get_technicians(),
    'generate_sample_code':  lambda args: generate_sample_code(
        source_id=args[0]  if len(args) > 0 else 1,
        product_id=args[1] if len(args) > 1 else 1,
        entry_date=args[2] if len(args) > 2 else None,
    ),
    'create_sample_with_rename': lambda args: create_sample_with_rename(
        code_info=args[0], date=args[1], product_id=args[2],
        technician_id=args[3] if len(args) > 3 else None,
        location=args[4]      if len(args) > 4 else None,
        batch=args[5]         if len(args) > 5 else None,
        comments=args[6]      if len(args) > 6 else None,
        source_id=args[7]     if len(args) > 7 else 1,
    ),
    'get_sources': lambda args: get_sources(),
    'get_product_sieves':    lambda args: get_product_sieves(args[0]),
    'get_dashboard_stats':   lambda args: get_dashboard_stats(),
    'get_dashboard_samples': lambda args: get_dashboard_samples(
                                args[0] if args else 'recent'),
    'get_lab_info':          lambda args: get_lab_info(),

    'create_sample': lambda args: create_sample(
        code=args[0], date=args[1], product_id=args[2],
        technician_id=args[3] if len(args) > 3 else None,
        location=args[4]      if len(args) > 4 else None,
        batch=args[5]         if len(args) > 5 else None,
        comments=args[6]      if len(args) > 6 else None,
    ),

    'save_sieve_analysis': lambda args: save_sieve_analysis(
        sample_id=args[0], date=args[1],
        weight_initial=args[2], weight_dry=args[3],
        weight_washed=args[4], sieve_results=args[5],
        comments=args[6]        if len(args) > 6 else None,
        as_new_run=args[7]      if len(args) > 7 else False,
        rejected_reason=args[8] if len(args) > 8 else None,
    ),

    'get_sieve_analysis': lambda args: get_sieve_analysis(
        args[0],
        run_id=args[1] if len(args) > 1 else None,
    ),

    'save_methylene_blue': lambda args: save_methylene_blue(
        sample_id=args[0], date=args[1],
        weight_sample=args[2], water_volume=args[3],
        volume_initial=args[4], volume_final=args[5],
        comments=args[6]        if len(args) > 6 else None,
        as_new_run=args[7]      if len(args) > 7 else False,
        rejected_reason=args[8] if len(args) > 8 else None,
    ),

    'suggest_initial_volume': lambda args: suggest_mb_initial_volume(args[0]),

    'save_sand_equivalent': lambda args: save_sand_equivalent(
        sample_id=args[0], date=args[1],
        measurements=args[2],
        comments=args[3]        if len(args) > 3 else None,
        as_new_run=args[4]      if len(args) > 4 else False,
        rejected_reason=args[5] if len(args) > 5 else None,
    ),

    'save_flakiness': lambda args: save_flakiness(
        sample_id=args[0], date=args[1],
        fractions=args[2],
        weight_m0=args[3]          if len(args) > 3 else None,
        comments=args[4]           if len(args) > 4 else None,
        as_new_run=args[5]         if len(args) > 5 else False,
        rejected_reason=args[6]    if len(args) > 6 else None,
    ),

    'search_samples': lambda args: search_samples(
        product_id=args[0] if len(args) > 0 else None,
        date_from=args[1]  if len(args) > 1 else None,
        date_to=args[2]    if len(args) > 2 else None,
        code=args[3]       if len(args) > 3 else None,
        limit=args[4]      if len(args) > 4 else 200,
    ),

    'add_technician':  lambda args: add_technician(args[0]),
    'delete_sample':   lambda args: delete_sample(args[0]),
    'update_sample':   lambda args: update_sample_info(
        args[0], args[1], args[2], args[3], args[4], args[5], args[6]
    ),
    'get_full_report':     lambda args: _get_full_report_with_specs(args[0]),
    'generate_pdf_report': lambda args: _generate_pdf_report(
                               args[0],
                               args[1] if len(args) > 1 else [],
                               args[2] if len(args) > 2 else os.path.join(os.environ.get('TEMP', '/tmp'), 'report.pdf'),
                           ),
    'merge_pdfs':          lambda args: _merge_pdfs(args[0], args[1], args[2]),

    # --- SETTINGS (v1.2) ---
    'save_lab_info':        lambda args: save_lab_info(args[0]),
    'add_source':           lambda args: add_source(
                                args[0], args[1],
                                args[2] if len(args) > 2 else None),
    'update_source':        lambda args: update_source(
                                args[0], args[1],
                                args[2] if len(args) > 2 else None),
    'toggle_source':        lambda args: toggle_source(args[0], args[1]),
    'delete_source':        lambda args: delete_source(int(args[0])),
    'get_all_sources':      lambda args: get_all_sources(),
    'get_all_technicians':  lambda args: get_all_technicians(),
    'toggle_technician':    lambda args: toggle_technician(args[0], args[1]),
    'delete_technician':    lambda args: delete_technician(int(args[0])),
    'save_specifications':  lambda args: save_specifications(
                                args[0], args[1], args[2], args[3]),
    'get_specifications':   lambda args: get_specifications(args[0]),
    'get_smtp_config':      lambda args: get_smtp_config(),
    'save_smtp_config':     lambda args: save_smtp_config(args[0]),

    # --- ΝΕΕΣ (v1.1) ---

    # Πλάνο δοκιμών
    'get_required_tests':         lambda args: get_required_tests(args[0]),
    'set_required_tests':         lambda args: set_required_tests(args[0], args[1]),
    'get_default_required_tests': lambda args: get_default_required_tests(args[0]),
    'create_sample_with_plan_and_rename': lambda args: create_sample_with_plan_and_rename(
        code_info=args[0], date=args[1], product_id=args[2],
        technician_id=args[3]  if len(args) > 3 else None,
        location=args[4]       if len(args) > 4 else None,
        batch=args[5]          if len(args) > 5 else None,
        comments=args[6]       if len(args) > 6 else None,
        required_tests=args[7] if len(args) > 7 else None,
        source_id=args[8]      if len(args) > 8 else 1,
    ),
    'create_sample_with_plan':    lambda args: create_sample_with_plan(
        code=args[0], date=args[1], product_id=args[2],
        technician_id=args[3]  if len(args) > 3 else None,
        location=args[4]       if len(args) > 4 else None,
        batch=args[5]          if len(args) > 5 else None,
        comments=args[6]       if len(args) > 6 else None,
        required_tests=args[7] if len(args) > 7 else None,
    ),

    # Run management
    'get_test_history':         lambda args: get_test_history(args[0], args[1]),
    'mark_run_rejected':        lambda args: mark_run_rejected(
                                    args[0], args[1], args[2]),
    'update_rejected_reason':   lambda args: update_rejected_reason(
                                    args[0], args[1], args[2]),
    'promote_run_to_official':  lambda args: promote_run_to_official(
                                    args[0], args[1], args[2]),
    'delete_test_run':          lambda args: delete_test_run(args[0], args[1]),

    # Test metadata
    'is_test_allowed_for_category':   lambda args: is_test_allowed_for_category(
                                          args[0], args[1]),
    'get_allowed_tests_for_category': lambda args: get_allowed_tests_for_category(
                                          args[0]),
    'get_test_registry_meta':         lambda args: get_test_registry_meta(),
    # --- SETTINGS v2 — Είδη Αδρανών & Κόσκινα ---
    'get_all_products':       lambda args: get_all_products(),
    'add_product':            lambda args: add_product(
                                  args[0], float(args[1]), float(args[2]),
                                  args[3], args[4]),
    'get_all_sieves':          lambda args: get_all_sieves(),
    'get_material_types':      lambda args: get_material_types(),
    'get_guide_enabled':       lambda args: get_guide_enabled(),
    'set_guide_enabled':       lambda args: set_guide_enabled(bool(int(args[0]))),
    'update_product':         lambda args: update_product(
                                  int(args[0]), args[1], float(args[2]),
                                  float(args[3]), args[4], args[5],
                                  args[6] if len(args) > 6 else None),
    'toggle_product':         lambda args: toggle_product(int(args[0]), int(args[1])),
    'get_product_sieves_full':lambda args: get_product_sieves_full(args[0]),
    'set_product_sieves':     lambda args: set_product_sieves(args[0], args[1], bool(args[2]) if len(args) > 2 else False),
    'delete_product':         lambda args: delete_product(int(args[0])),

    # --- CE Periods & Subperiods ---
    'get_active_ce_period':    lambda args: get_active_ce_period(),
    'get_all_ce_periods':      lambda args: get_all_ce_periods(),
    'get_ce_expiry_status':    lambda args: get_ce_expiry_status(),
    'create_ce_period':        lambda args: create_ce_period(
                                   args[0], args[1], args[2], args[3],
                                   args[4] if len(args) > 4 else None),
    'create_subperiod':        lambda args: create_subperiod(
                                   int(args[0]), args[1],
                                   lab_report_number=args[2] if len(args) > 2 else None,
                                   notes=args[3]             if len(args) > 3 else None,
                                   pdf_subfolder=bool(args[4]) if len(args) > 4 else False,
                                   ext_mb_value=args[5]      if len(args) > 5 else None,
                                   ext_se_value=args[6]      if len(args) > 6 else None,
                                   ext_fl_value=args[7]      if len(args) > 7 else None,
                                   ext_sieve_results=args[8] if len(args) > 8 else None),
    'update_ce_period_folder': lambda args: update_ce_period_folder(int(args[0]), args[1]),
    'get_subperiod_for_date':  lambda args: get_subperiod_for_date(args[0]),
    'get_subperiod_by_id':     lambda args: get_subperiod_by_id(int(args[0])),
    'get_init_status':     lambda args: get_init_status(),
    'get_samples_count':   lambda args: get_samples_count(),
    'generate_periodic_pdf': lambda args: _generate_periodic_pdf_report(
        int(args[0]), args[1] if args[1] else None, args[2] if args[2] else None,
        int(args[3]) if len(args)>3 and args[3] else None,
        args[4]),
    'vacuum_into':         lambda args: vacuum_into(args[0]),
    'check_db_integrity':  lambda args: check_db_integrity(args[0]),
    'clean_start':         lambda args: clean_start(
                               args[0] if args else '',
                               bool(args[1]) if len(args) > 1 else True,
                               bool(args[2]) if len(args) > 2 else True),
    'switch_db':           lambda args: switch_db(args[0]),
    'restore_db':          lambda args: restore_db(),
    'find_archive_db':               lambda args: find_archive_db(args[0]),
    'inspect_backup_samples':        lambda args: inspect_backup_samples(args[0]),
    'check_sample_code_conflict':    lambda args: check_sample_code_conflict(args[0]),
    'merge_sample_from_backup':      lambda args: merge_sample_from_backup(
                                          args[0], args[1], args[2] if len(args) > 2 else None),
    # Document Library
    'get_doc_sections':              lambda args: get_doc_sections(),
    'create_doc_section':            lambda args: create_doc_section(args[0], args[1] if len(args)>1 else '📁'),
    'update_doc_section':            lambda args: update_doc_section(int(args[0]), args[1], args[2]),
    'delete_doc_section':            lambda args: delete_doc_section(int(args[0])),
    'get_documents':                 lambda args: get_documents(int(args[0])),
    'create_document':               lambda args: create_document(
                                         int(args[0]), args[1],
                                         args[2] if len(args)>2 else None,
                                         args[3] if len(args)>3 else None,
                                         args[4] if len(args)>4 else None,
                                         args[5] if len(args)>5 else None,
                                         args[6] if len(args)>6 else None,
                                         args[7] if len(args)>7 else None),
    'update_document':               lambda args: update_document(
                                         int(args[0]), args[1],
                                         args[2] if len(args)>2 else None,
                                         args[3] if len(args)>3 else None,
                                         args[4] if len(args)>4 else None,
                                         args[5] if len(args)>5 else None,
                                         args[6] if len(args)>6 else None,
                                         args[7] if len(args)>7 else None),
    'delete_document':               lambda args: delete_document(int(args[0])),
    'get_documents_for_standards_check': lambda args: get_documents_for_standards_check(),
    'export_document_library':  lambda args: export_document_library(),
    'import_document_library':  lambda args: import_document_library(args[0]),
    'update_active_ce_period_folder': lambda args: update_active_ce_period_folder(args[0]),
    'generate_pdf_library': lambda args: generate_pdf_library(args[0]),
    'delete_subperiod':    lambda args: delete_subperiod(int(args[0])),
    'delete_ce_period':    lambda args: delete_ce_period(int(args[0])),
    'update_ce_period':    lambda args: update_ce_period(
                               int(args[0]), args[1],
                               args[2] if len(args) > 2 else None,
                               args[3], args[4]),
    'update_subperiod':        lambda args: update_subperiod(
                                   int(args[0]),
                                   lab_report_number=args[1] if len(args) > 1 else None,
                                   notes=args[2]             if len(args) > 2 else None,
                                   pdf_subfolder=bool(args[3]) if len(args) > 3 else None,
                                   ext_mb_value=args[4]      if len(args) > 4 else None,
                                   ext_se_value=args[5]      if len(args) > 5 else None,
                                   ext_fl_value=args[6]      if len(args) > 6 else None,
                                   ext_sieve_results=args[7] if len(args) > 7 else None,
                                   valid_from=args[8]        if len(args) > 8 else None),
    'get_subperiod_specs': lambda args: get_subperiod_specs(int(args[0])),
    'set_subperiod_specs': lambda args: set_subperiod_specs(int(args[0]), args[1]),
    'get_subperiod_specifications':  lambda args: get_subperiod_specifications(int(args[0]), int(args[1])),
    'save_subperiod_specifications': lambda args: save_subperiod_specifications(
                                         int(args[0]), int(args[1]), args[2], args[3], args[4]),
    'get_effective_specifications':  lambda args: get_effective_specifications(int(args[0]), int(args[1])),
    'copy_previous_subperiod_specs': lambda args: copy_previous_subperiod_specs(int(args[0])),

}


def handle_request(line: str) -> dict:
    """Επεξεργασία αίτησης JSON."""
    req_id = None
    try:
        req    = json.loads(line.strip())
        method = req.get('method')
        args   = req.get('args', [])
        req_id = req.get('id')  # optional request ID για matching

        if method not in METHODS:
            resp = {'error': f"Άγνωστη μέθοδος: {method}"}
            if req_id is not None: resp['id'] = req_id
            return resp

        result = METHODS[method](args)

        resp = {'result': result}
        if req_id is not None: resp['id'] = req_id
        return resp

    except ValueError as e:
        # Σφάλματα επικύρωσης (κατηγορία, blocked removal κλπ) — αναμενόμενα,
        # δεν χρειάζονται πλήρες traceback στο log.
        logging.warning('Validation error: %s — αίτημα: %s', e, line[:200])
        resp = {'error': str(e)}
        if req_id is not None: resp['id'] = req_id
        return resp
    except Exception as e:
        logging.exception('Μη αναμενόμενο σφάλμα κατά την επεξεργασία αιτήματος: %s', line[:200])
        resp = {'error': str(e)}
        if req_id is not None: resp['id'] = req_id
        return resp


# ============================================================
# PDF REPORT με reportlab — παράγει PDF απευθείας από Python
# ============================================================


def _generate_pdf_report(sample_id: int, tests: list, output_path: str) -> dict:
    """
    Παράγει PDF δελτίο αποτελεσμάτων με reportlab.
    Χρησιμοποιεί canvas απευθείας — χωρίς merge, χωρίς BytesIO.
    """
    try:
        import math
        from reportlab.lib.pagesizes import A4, landscape as rl_landscape
        from reportlab.lib import colors
        from reportlab.lib.units import mm
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import (Table, TableStyle, Paragraph,
                                         SimpleDocTemplate, Spacer, PageBreak,
                                         BaseDocTemplate, Frame, PageTemplate,
                                         NextPageTemplate)
        from reportlab.graphics.shapes import Drawing, Line, PolyLine, Circle, String, Polygon
        from reportlab.pdfgen import canvas as rl_canvas

        # ── Δεδομένα ──────────────────────────────────────────
        report  = _get_full_report_with_specs(sample_id)
        sample  = report.get('sample', {})
        t_data  = report.get('tests', {})

        from database.db_manager import get_connection
        conn    = get_connection()
        lab_row = conn.execute('SELECT * FROM tbl_laboratory WHERE id=1').fetchone()
        lab     = dict(lab_row) if lab_row else {}
        conn.close()
        specs = (get_effective_specifications(sample['subperiod_id'], sample.get('product_id'))
                 if sample.get('subperiod_id')
                 else get_specifications(sample.get('product_id')))
        sieve_specs = [s for s in specs if s.get('sieve_mm') is not None]

        # ── Σελίδες ───────────────────────────────────────────
        page_list = []
        has_se = 'se' in tests and t_data.get('sand_equivalent')
        has_mb = 'mb' in tests and t_data.get('methylene_blue')
        if 'sieve' in tests and t_data.get('sieve_analysis'):
            page_list += ['sieve-table', 'sieve-chart']
        if 'flakiness' in tests and t_data.get('flakiness'):
            page_list.append('flakiness')
        if has_se or has_mb:
            page_list.append('se-mb')
        if not page_list:
            return {'success': False, 'error': t('pdf.common.no_data', 'Δεν υπάρχουν δεδομένα')}

        total_pages = len(page_list)

        # ── Χρώματα / Styles ──────────────────────────────────
        BLUE_DARK  = colors.HexColor('#3a6bb0')
        BLUE_MID   = colors.HexColor('#2563a8')
        BLUE_LIGHT = colors.HexColor('#e8f0fa')
        RED_FAIL   = colors.HexColor('#b91c1c')
        GREEN_OK   = colors.HexColor('#166534')
        GRAY_ROW   = colors.HexColor('#f5f5f5')
        WHITE      = colors.white
        BLACK      = colors.black
        # Εγγραφή TTF fonts για σωστή υποστήριξη ελληνικών
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        import sys as _sys_fonts

        # Bundled fonts (PyInstaller: sys._MEIPASS, dev: project root)
        _bundle = os.path.join(
            getattr(_sys_fonts, '_MEIPASS', os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            'fonts'
        )

        def _find_font(*paths):
            for p in paths:
                if os.path.exists(p): return p
            return None

        def _bf(name):  # bundled font shortcut
            return os.path.join(_bundle, name)

        _FONT_CATALOG = {}
        _r = _find_font(_bf('LiberationSans-Regular.ttf'),
                        '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
                        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf')
        _b = _find_font(_bf('LiberationSans-Bold.ttf'),
                        '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
                        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf')
        if _r and _b: _FONT_CATALOG['LiberationSans'] = (_r, _b)

        _r = _find_font(_bf('Inter-Regular.ttf'))
        _b = _find_font(_bf('Inter-Bold.ttf'))
        if _r and _b: _FONT_CATALOG['Inter'] = (_r, _b)

        _r = _find_font(_bf('IBMPlexSans-Regular.ttf'))
        _b = _find_font(_bf('IBMPlexSans-Bold.ttf'))
        if _r and _b: _FONT_CATALOG['IBMPlexSans'] = (_r, _b)

        _r = _find_font(_bf('NotoSans-Regular.ttf'),
                        '/usr/share/fonts/noto/NotoSans-Regular.ttf',
                        '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf')
        _b = _find_font(_bf('NotoSans-Bold.ttf'),
                        '/usr/share/fonts/noto/NotoSans-Bold.ttf',
                        '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf')
        if _r and _b: _FONT_CATALOG['NotoSans'] = (_r, _b)

        _r = _find_font(_bf('DejaVuSans-Regular.ttf'),
                        '/usr/share/fonts/TTF/DejaVuSans.ttf',
                        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
        _b = _find_font(_bf('DejaVuSans-Bold.ttf'),
                        '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
                        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
        if _r and _b: _FONT_CATALOG['DejaVuSans'] = (_r, _b)

        # Διαβάζω επιλογή font από τη βάση (pdf_font)
        _preferred = lab.get('pdf_font', 'IBMPlexSans') or 'IBMPlexSans'
        # Αν δεν υπάρχει στον κατάλογο, fallback στο πρώτο διαθέσιμο
        if _preferred not in _FONT_CATALOG:
            _preferred = next(iter(_FONT_CATALOG), None)
        # Βάζω το preferred πρώτο, μετά τα υπόλοιπα ως fallback
        _font_order = [_preferred] + [k for k in _FONT_CATALOG if k != _preferred]

        try:
            from reportlab.pdfbase.pdfmetrics import registerFontFamily
            F, FB = 'Helvetica', 'Helvetica-Bold'
            for _fname in _font_order:
                _fr, _fb = _FONT_CATALOG[_fname]
                try:
                    if os.path.exists(_fr) and os.path.exists(_fb):
                        if _fname not in pdfmetrics.getRegisteredFontNames():
                            pdfmetrics.registerFont(TTFont(_fname, _fr))
                        _fb_name = f'{_fname}-Bold'
                        if _fb_name not in pdfmetrics.getRegisteredFontNames():
                            pdfmetrics.registerFont(TTFont(_fb_name, _fb))
                        registerFontFamily(_fname,
                            normal=_fname, bold=_fb_name,
                            italic=_fname, boldItalic=_fb_name)
                        F, FB = _fname, _fb_name
                        break
                except Exception:
                    continue
        except Exception as _fe:
            import sys as _sys3
            print(f'[PDF] Font error: {_fe}', file=_sys3.stderr)
            F, FB = 'Helvetica', 'Helvetica-Bold'

        ss = getSampleStyleSheet()
        # Override του Normal parent για να αποφύγουμε Times-Roman
        _base = ParagraphStyle('Base', fontName=F, fontSize=9, leading=12,
                               textColor=BLACK, bulletFontName=F,
                               allowWidows=0, allowOrphans=0)
        def sty(name, **kw):
            return ParagraphStyle(name, parent=_base, **kw)

        # Δηλώνω στο reportlab XML parser ότι <b> → FB, <i> → F
        # Αυτό αποτρέπει fallback σε Times-Roman για bold text
        try:
            from reportlab.platypus.paraparser import ParaFrag
            from reportlab.lib.fonts import addMapping
            addMapping(F, 0, 0, F)        # normal
            addMapping(F, 1, 0, FB)       # bold
            addMapping(F, 0, 1, F)        # italic → same
            addMapping(F, 1, 1, FB)       # bold+italic → bold
        except Exception:
            pass
        ST_TITLE   = sty('Ti', fontSize=13, textColor=BLUE_DARK, leading=16,
                         spaceAfter=4*mm, fontName=FB)
        ST_SECTION = sty('Se', fontSize=10, textColor=BLUE_DARK, leading=13,
                         spaceAfter=2*mm, fontName=FB)
        ST_BODY    = sty('Bo', fontSize=9,  textColor=BLACK,    leading=12, fontName=F)
        ST_SMALL   = sty('Sm', fontSize=8,  textColor=colors.HexColor('#444'), leading=10, fontName=F)
        ST_FAIL    = sty('Fa', fontSize=9,  textColor=RED_FAIL,  leading=12, fontName=FB)
        ST_OK      = sty('Ok', fontSize=9,  textColor=GREEN_OK,  leading=12, fontName=FB)

        import sys as _sys_logo
        _logo_base = getattr(_sys_logo, '_MEIPASS', ROOT)
        LOGO_PATH = os.path.join(_logo_base, 'src', 'assets', 'logopage.png')
        ML = 14*mm; MT = 31*mm; MB = 16*mm
        LOGO_W, LOGO_H = 160*mm, 19*mm

        def fmt_date(v):
            if not v: return '—'
            try:
                p = str(v).split('-')
                return f'{p[2]}/{p[1]}/{p[0]}'
            except: return str(v)

        def esc(v): return '—' if v is None else str(v)


        # ── Chrome (header/footer) ────────────────────────────
        def draw_chrome(c, pagesize, pnum):
            W, H = pagesize
            top_y = H - 10*mm
            if os.path.exists(LOGO_PATH):
                try:
                    c.drawImage(LOGO_PATH, ML, top_y - LOGO_H, width=LOGO_W, height=LOGO_H,
                                preserveAspectRatio=True, mask='auto')
                except Exception:
                    pass
            c.setFont(FB, 10); c.setFillColor(BLUE_DARK)
            
            c.setFont(F, 8); c.setFillColor(colors.HexColor('#444444'))
            
            cx = W - ML
            ce = lab.get('ce_number','')
            if ce:
                c.setFont(FB,9); c.setFillColor(BLUE_DARK)
                c.drawRightString(cx, top_y-6*mm, ce)
            cb = lab.get('ce_body','')
            if cb:
                c.setFont(F,7.5); c.setFillColor(colors.HexColor('#444'))
                c.drawRightString(cx, top_y-10*mm, cb)
            cf, ct = lab.get('ce_valid_from',''), lab.get('ce_valid_to','')
            if cf and ct:
                c.setFont(F,7.5); c.setFillColor(colors.HexColor('#444'))
                c.drawRightString(cx, top_y-14*mm, t('pdf.common.validity', 'Ισχύς: {from_} — {to}').format(from_=fmt_date(cf), to=fmt_date(ct)))
            c.setStrokeColor(BLUE_DARK); c.setLineWidth(1.2)
            c.line(ML, top_y - LOGO_H, W-ML, top_y - LOGO_H)
            c.setFont(F,7.5); c.setFillColor(colors.HexColor('#555'))
            c.drawString(ML, 9*mm, t('pdf.common.issue_date', 'Ημερομηνία έκδοσης: {date}').format(date=fmt_date(date.today().isoformat())))
            c.drawCentredString(W/2, 9*mm, t('pdf.common.disclaimer', 'Το παρόν δελτίο αφορά αποκλειστικά το ανωτέρω δείγμα.'))
            c.drawRightString(W-ML, 9*mm, t('pdf.common.page_of', 'Σελίδα {page} από {total}').format(page=pnum, total=total_pages))

        # ── BaseDocTemplate με δύο PageTemplates ─────────────
        pf = Frame(ML, MB, A4[0]-2*ML, A4[1]-MT-MB, id='portrait')
        LW, LH = rl_landscape(A4)
        lf = Frame(ML, MB, LW-2*ML, LH-MT-MB, id='landscape')

        class ReportCanvas(rl_canvas.Canvas):
            def showPage(self):
                pnum = self._pageNumber  # 1-based, σωστός αριθμός σελίδας
                draw_chrome(self, self._pagesize, pnum)
                super().showPage()
            def save(self):
                super().save()

        doc = BaseDocTemplate(
            output_path,
            pageTemplates=[
                PageTemplate(id='Portrait',  frames=[pf], pagesize=A4),
                PageTemplate(id='Landscape', frames=[lf], pagesize=rl_landscape(A4)),
            ],
            pagesize=A4,
        )

        # ── Βοηθητικές ────────────────────────────────────────
        W_p = A4[0] - 2*ML
        W_l = LW   - 2*ML

        def meta_tbl(W=None):
            if W is None: W = W_p
            ps = esc(_build_product_name(
                sample.get('product_name', ''), sample.get('d_min', 0), sample.get('d_max', 0)
            ))
            rows = [
                [Paragraph(f'<b>{t("pdf.meta.sample_code", "Κωδικός Δείγματος")}</b>', ST_SMALL),
                 Paragraph(f'<b>{esc(sample.get("code"))}</b>', ST_BODY),
                 Paragraph(f'<b>{t("pdf.meta.sampling_date", "Ημ/νία Δειγματοληψίας")}</b>', ST_SMALL),
                 Paragraph(fmt_date(sample.get('date','')), ST_BODY)],
                [Paragraph(f'<b>{t("pdf.meta.product", "Προϊόν")}</b>', ST_SMALL),
                 Paragraph(ps, ST_BODY),
                 Paragraph(f'<b>{t("pdf.meta.technician", "Τεχνικός")}</b>', ST_SMALL),
                 Paragraph(esc(sample.get('technician_name')), ST_BODY)],
            ]
            if sample.get('location'):
                rows.append([Paragraph(f'<b>{t("pdf.meta.location", "Σημείο")}</b>', ST_SMALL),
                              Paragraph(esc(sample.get('location')), ST_BODY),'',''])
            tbl = Table(rows, colWidths=[35*mm, W/2-35*mm, 35*mm, W/2-35*mm])
            tbl.setStyle(TableStyle([
                ('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#ccc')),
                ('BACKGROUND',(0,0),(0,-1),BLUE_LIGHT),
                ('BACKGROUND',(2,0),(2,-1),BLUE_LIGHT),
                ('ROWBACKGROUNDS',(0,0),(-1,-1),[WHITE,GRAY_ROW]),
                ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                ('TOPPADDING',(0,0),(-1,-1),2*mm),
                ('BOTTOMPADDING',(0,0),(-1,-1),2*mm),
                ('SPAN',(1,2),(3,2)),
            ]))
            return tbl

        def base_tbl_style():
            return [
                ('BACKGROUND',(0,0),(-1,0),BLUE_DARK),
                ('TEXTCOLOR',(0,0),(-1,0),WHITE),
                ('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#ccc')),
                ('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE,GRAY_ROW]),
                ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                ('TOPPADDING',(0,0),(-1,-1),1.5*mm),
                ('BOTTOMPADDING',(0,0),(-1,-1),1.5*mm),
            ]

        def spec_chk_tbl(checks, val_key, unit='', W=None):
            if not checks: return None
            if W is None: W = W_p
            rows = [[Paragraph(f'<b>{t("pdf.spec.name", "Προδιαγραφή")}</b>',ST_SMALL),
                     Paragraph(f'<b>{t("pdf.spec.type", "Τύπος")}</b>',ST_SMALL),
                     Paragraph(f'<b>{t("pdf.spec.value", "Τιμή")}</b>',ST_SMALL),
                     Paragraph(f'<b>{t("pdf.spec.requirement", "Απαίτηση")}</b>',ST_SMALL)]]
            for c in checks:
                st  = c.get('status','')
                val = c.get(val_key)
                lo  = c.get('lower_limit')
                hi  = c.get('upper_limit')
                lim = (f'≤{hi}{unit}' if hi is not None else
                       f'≥{lo}{unit}' if lo is not None else None)
                if lim is None:
                    continue
                lim_style = ST_OK if st=='ok' else ST_FAIL
                rows.append([
                    Paragraph(esc(c.get('spec_name')),ST_SMALL),
                    Paragraph(esc(c.get('spec_type')),ST_SMALL),
                    Paragraph(f'{int(val)}{unit}' if val is not None and val == int(val) else (f'{val:.2f}{unit}' if val is not None else '—'),ST_SMALL),
                    Paragraph(f'<b>{lim}</b>', lim_style),
                ])
            if len(rows) <= 1: return None
            tbl = Table(rows, colWidths=[W*.32, W*.18, W*.18, W*.32], repeatRows=1)
            tbl.setStyle(TableStyle(base_tbl_style()))
            return tbl

        # ── Story ─────────────────────────────────────────────
        story = []
        spec_names = list(dict.fromkeys(s['spec_name'] for s in sieve_specs))

        # ══ ΣΕΛΙΔΑ 1: Κοκκομετρία — Πίνακας ══════════════════
        if 'sieve-table' in page_list:
            sa         = t_data['sieve_analysis']
            all_res    = sa.get('data',{}).get('results',[])
            results    = sorted([r for r in all_res if r.get('sieve_mm',0)>0],
                                key=lambda x: x['sieve_mm'], reverse=True)
            pan        = next((r for r in all_res if r.get('sieve_mm',0)==0), None)
            analysis   = sa.get('data',{}).get('analysis',{})
            n_sp       = len(spec_names)
            base_w     = [18*mm, 30*mm, 28*mm]
            sp_w       = (W_p-sum(base_w))/max(n_sp,1) if n_sp else 0

            story += [Paragraph(t('pdf.common.title', 'ΔΕΛΤΙΟ ΑΠΟΤΕΛΕΣΜΑΤΩΝ ΔΟΚΙΜΩΝ'), ST_TITLE),
                      meta_tbl(), Spacer(1,4*mm),
                      Paragraph(t('pdf.sieve.section_title', 'Κοκκομετρική Ανάλυση — EN 933-1'), ST_SECTION)]

            hdr = ([Paragraph(f'<b>{t("pdf.sieve.col_sieve", "Κόσκινο")}\n(mm)</b>',ST_SMALL),
                    Paragraph(f'<b>{t("pdf.sieve.col_weight_retained", "Βάρος Συγκρ.")}\n(g)</b>',ST_SMALL),
                    Paragraph(f'<b>{t("pdf.sieve.col_passing", "Διερχόμενο")}\n(%)</b>',ST_SMALL)] +
                   [Paragraph(f'<b>{n}</b>',ST_SMALL) for n in spec_names])
            rows = [hdr]; bg = []
            for i, r in enumerate(results):
                pct = r.get('passing_percent')
                fail = any(
                    (sp.get('lower_limit') is not None and pct is not None and pct < sp['lower_limit']) or
                    (sp.get('upper_limit') is not None and pct is not None and pct > sp['upper_limit'])
                    for sp in sieve_specs if sp.get('sieve_mm') == r.get('sieve_mm')
                )
                sp_cells = []
                for sn in spec_names:
                    sp = next((s for s in sieve_specs
                                if s['spec_name']==sn and s.get('sieve_mm')==r.get('sieve_mm')), None)
                    if sp:
                        lo,hi = sp.get('lower_limit'), sp.get('upper_limit')
                        if lo is not None or hi is not None:
                            cell = (f'{lo}–{hi}%' if lo is not None and hi is not None else
                                    f'≥{lo}%' if lo is not None else f'≤{hi}%')
                            within = ((lo is None or (pct is not None and pct >= lo)) and
                                      (hi is None or (pct is not None and pct <= hi)))
                            sp_cells.append(Paragraph(f'<b>{cell}</b>', ST_OK if within else ST_FAIL))
                        else:
                            sp_cells.append(Paragraph('—', ST_SMALL))
                    else:
                        sp_cells.append(Paragraph('—', ST_SMALL))
                rows.append([
                    Paragraph(f'<b>{r.get("sieve_mm")}</b>', ST_BODY),
                    Paragraph(f'{r.get("weight_retained",0):.1f}' if r.get("weight_retained") is not None else '—', ST_SMALL),
                    Paragraph(f'<b>{pct:.1f}%</b>' if pct is not None else '—', ST_BODY),
                ] + sp_cells)
            if pan:
                rows.append([Paragraph(f'<b>{t("pdf.sieve.pan", "Τυφλό")}</b>',ST_BODY),
                              Paragraph(f'{pan.get("weight_retained",0):.1f}' if pan.get("weight_retained") is not None else '—',ST_SMALL),
                              Paragraph('<b>0.0%</b>',ST_BODY)] + [Paragraph('—',ST_SMALL)]*n_sp)
            tbl = Table(rows, colWidths=base_w+[sp_w]*n_sp, repeatRows=1)
            tbl.setStyle(TableStyle(base_tbl_style()+[('ALIGN',(1,1),(-1,-1),'CENTER')]))
            story.append(tbl)
            parts = []
            if analysis.get('weight_initial') is not None: parts.append(f'{t("pdf.sieve.weight_initial", "Βάρος αρχικό")}: <b>{analysis["weight_initial"]:.1f}g</b>')
            if analysis.get('weight_dry')     is not None: parts.append(f'{t("pdf.sieve.weight_dry", "Βάρος ξηρού")}: <b>{analysis["weight_dry"]:.1f}g</b>')
            if analysis.get('wash_loss_pct')  is not None: parts.append(f'{t("pdf.sieve.wash_loss", "Απώλεια πλύσης")}: <b>{analysis["wash_loss_pct"]:.2f}%</b>')
            if parts: story += [Spacer(1,2*mm), Paragraph('  |  '.join(parts),ST_SMALL)]
            # Αν ακολουθεί γράφημα, η επόμενη σελίδα είναι landscape
            if 'sieve-chart' in page_list:
                story.append(NextPageTemplate('Landscape'))
            story.append(PageBreak())

        # ══ ΣΕΛΙΔΑ 2: Γράφημα (landscape) ════════════════════
        if 'sieve-chart' in page_list:

            story.append(Paragraph(t('pdf.sieve.chart_section_title', 'Κοκκομετρική Ανάλυση — EN 933-1 — Διάγραμμα'), ST_SECTION))
            sa       = t_data['sieve_analysis']
            all_res  = sa.get('data',{}).get('results',[])
            pts      = sorted([r for r in all_res if r.get('sieve_mm',0)>0],
                               key=lambda x: x['sieve_mm'])
            Y_TITLE_W = 20*mm  # χώρος για τίτλο y-άξονα
            DW, DH   = W_l*0.9 - Y_TITLE_W, 90*mm
            X_LABEL_PAD = 14*mm   # χώρος για labels x-άξονα + lower diamonds κάτω από Drawing
            drawing  = Drawing(DW + Y_TITLE_W, DH + X_LABEL_PAD)
            xmn = 0.045
            max_sieve = max((r['sieve_mm'] for r in pts), default=90)
            std_sieves = [0.063,0.125,0.25,0.5,1,2,4,8,11.2,16,22.4,31.5,45,63,90]
            xmx = next((s for s in std_sieves if s >= max_sieve * 1.1), 90)

            def tx(v):
                if v<=0: return Y_TITLE_W + DW
                return Y_TITLE_W + DW - (math.log10(max(v,xmn))-math.log10(xmn))/(math.log10(xmx)-math.log10(xmn))*DW
            def ty(v): return X_LABEL_PAD + float(v)/100*DH

            for yv in range(0,110,10):
                yp=ty(yv)
                drawing.add(Line(Y_TITLE_W,yp,Y_TITLE_W+DW,yp,strokeColor=colors.HexColor('#ddd'),strokeWidth=0.5))
                drawing.add(String(Y_TITLE_W-3*mm,yp-3.5,f'{yv}%',fontSize=7,fillColor=colors.HexColor('#666'),fontName=F,textAnchor='end'))
            for sv in [0.063,0.125,0.25,0.5,1,2,4,8,11.2,16,22.4,31.5,45,63,90]:
                xp=tx(sv)
                if Y_TITLE_W<=xp<=Y_TITLE_W+DW:
                    drawing.add(Line(xp,X_LABEL_PAD,xp,X_LABEL_PAD+DH,strokeColor=colors.HexColor('#ddd'),strokeWidth=0.5))
                    drawing.add(String(xp-4, X_LABEL_PAD - 7*mm, str(int(sv)) if sv>=1 else str(sv),
                                        fontSize=6.5,fillColor=colors.HexColor('#666'),fontName=F))
            drawing.add(Line(Y_TITLE_W,X_LABEL_PAD,Y_TITLE_W+DW,X_LABEL_PAD,strokeColor=BLACK,strokeWidth=1))
            drawing.add(Line(Y_TITLE_W,X_LABEL_PAD,Y_TITLE_W,X_LABEL_PAD+DH,strokeColor=BLACK,strokeWidth=1))

            sp_colors=[colors.HexColor('#ef4444'),colors.HexColor('#22c55e'),
                       colors.HexColor('#f59e0b'),colors.HexColor('#8b5cf6')]
            for si,sn in enumerate(spec_names[:4]):
                sc=sp_colors[si%4]
                sn_s=sorted([s for s in sieve_specs if s['spec_name']==sn],key=lambda x:x.get('sieve_mm',0))
                for sp in sn_s:
                    sv=sp.get('sieve_mm')
                    if not sv or sv<=0: continue
                    if sv < xmn or sv > max_sieve: continue  # εκτός εύρους μετρημένων κόσκινων
                    xp=tx(sv); d=4
                    if sp.get('upper_limit') is not None:
                        yp=ty(sp['upper_limit'])
                        drawing.add(PolyLine([xp,yp+d, xp+d,yp, xp,yp-d, xp-d,yp, xp,yp+d],
                                             strokeColor=sc, strokeWidth=1))
                    if sp.get('lower_limit') is not None:
                        yp = ty(sp['lower_limit'])
                        drawing.add(Polygon([xp,yp+d, xp+d,yp, xp,yp-d, xp-d,yp],
                                            strokeColor=sc, strokeWidth=1, fillColor=sc))

            if len(pts)>1:
                coords=[]
                for r in pts: coords+=[tx(r['sieve_mm']),ty(r.get('passing_percent',0))]
                drawing.add(PolyLine(coords,strokeColor=BLUE_MID,strokeWidth=2))
                for r in pts:
                    drawing.add(Circle(tx(r['sieve_mm']),ty(r.get('passing_percent',0)),3,
                                        fillColor=BLUE_MID,strokeColor=WHITE,strokeWidth=1))
            # Ετικέτα y-άξονα (κατακόρυφη) αριστερά του άξονα
            from reportlab.graphics.shapes import Group
            ylab = String(0, 0, t('pdf.sieve.chart_y_label', 'Διερχόμενο (%)'), fontSize=8, fillColor=colors.HexColor('#444'), fontName=F)
            g = Group(ylab)
            g.transform = (0, 1, -1, 0, Y_TITLE_W*0.45, X_LABEL_PAD + DH/2 - 20)
            drawing.add(g)
            # Ετικέτα x-άξονα
            drawing.add(String(Y_TITLE_W + DW/2, X_LABEL_PAD - 12*mm, t('pdf.sieve.chart_x_label', 'Άνοιγμα βροχίδας (mm)'),
                               fontSize=8, fillColor=colors.HexColor('#444'), fontName=F,
                               textAnchor='middle'))
            story += [drawing, Spacer(1,2*mm)]
            if spec_names:
                leg_items = []
                # "Αποτέλεσμα" label + circle marker
                leg_items.append((BLUE_MID, t('pdf.sieve.chart_legend_result', 'Αποτέλεσμα'), False))
                for si, sn in enumerate(spec_names[:4]):
                    leg_items.append((sp_colors[si%4], sn, True))
                leg_d = Drawing(W_l, 8)
                lx = 0
                for color, label, filled in leg_items:
                    r = 4  # diamond half-size in points
                    if filled:
                        leg_d.add(Polygon([lx,r, lx+r,0, lx+2*r,r, lx+r,2*r],
                                          strokeColor=color, strokeWidth=1, fillColor=color))
                    else:
                        leg_d.add(Circle(lx+r, r, r, fillColor=BLUE_MID, strokeColor=WHITE, strokeWidth=1))
                    lx += 2*r + 4
                    leg_d.add(String(lx, 2, label, fontSize=8, fillColor=colors.HexColor('#444'), fontName=F))
                    lx += len(label)*5 + 12
                story.append(leg_d)
            story.append(NextPageTemplate('Portrait'))
            story.append(PageBreak())

        # ══ ΣΕΛΙΔΑ 3: Πλακοειδή ══════════════════════════════
        if 'flakiness' in page_list:
            fl = t_data['flakiness']
            story += [Paragraph(t('pdf.common.title', 'ΔΕΛΤΙΟ ΑΠΟΤΕΛΕΣΜΑΤΩΝ ΔΟΚΙΜΩΝ'),ST_TITLE),
                      meta_tbl(), Spacer(1,4*mm),
                      Paragraph(t('pdf.flakiness.section_title', 'Δείκτης Πλακοειδών — EN 933-3'),ST_SECTION)]
            fracs    = fl.get('fractions',[])
            fi_index = fl.get('fi_index')
            fr_hdr=[Paragraph(f'<b>{t("pdf.flakiness.col_class", "Κλάση Rᵢ (mm)")}</b>',ST_SMALL),
                    Paragraph(f'<b>{t("pdf.flakiness.col_fraction_weight", "Βάρος κλάσματος (g)")}</b>',ST_SMALL),
                    Paragraph(f'<b>{t("pdf.flakiness.col_flaky_weight", "Πλακοειδή mᵢ (g)")}</b>',ST_SMALL),
                    Paragraph(f'<b>{t("pdf.flakiness.col_flaky_pct", "Πλακοειδή (%)")}</b>',ST_SMALL)]
            fr_rows=[fr_hdr]
            for fr in fracs:
                sv  = fr.get('sieve_mm')
                wf  = fr.get('weight_fraction') or fr.get('weight_m1') or fr.get('m1')
                wp  = fr.get('weight_passing')  or fr.get('weight_m2') or fr.get('m2')
                fi_fr = (wp/wf*100) if (wf and wp is not None) else None
                fr_rows.append([
                    Paragraph(f'{sv}' if sv else '—', ST_SMALL),
                    Paragraph(f'{wf:.1f}' if wf is not None else '—', ST_SMALL),
                    Paragraph(f'{wp:.1f}' if wp is not None else '—', ST_SMALL),
                    Paragraph(f'{fi_fr:.1f}%' if fi_fr is not None else '—', ST_SMALL),
                ])
            fr_rows.append([Paragraph(f'<b>{t("pdf.flakiness.fi_label", "Δείκτης FI")}</b>',ST_SMALL),'','',
                             Paragraph(f'<b>{int(round(fi_index))}%</b>' if fi_index is not None else '—',ST_BODY)])
            ft=Table(fr_rows,colWidths=[W_p/4]*4,repeatRows=1)
            ft.setStyle(TableStyle(base_tbl_style()+[
                ('BACKGROUND',(0,-1),(-1,-1),BLUE_LIGHT),
                ('ALIGN',(1,0),(-1,-1),'CENTER'),
            ]))
            story.append(ft)
            story.append(Spacer(1,3*mm))
            fi_chk=spec_chk_tbl(fl.get('spec_checks',[]),'fi_index','%')
            if fi_chk: story.append(fi_chk)
            story.append(PageBreak())

        # ══ ΣΕΛΙΔΑ 4: SE + MB ════════════════════════════════
        if 'se-mb' in page_list:
            story += [Paragraph(t('pdf.common.title', 'ΔΕΛΤΙΟ ΑΠΟΤΕΛΕΣΜΑΤΩΝ ΔΟΚΙΜΩΝ'),ST_TITLE),
                      meta_tbl(), Spacer(1,4*mm)]
            if has_se:
                se = t_data['sand_equivalent']
                story.append(Paragraph(t('pdf.se.section_title', 'Ισοδύναμο Άμμου — EN 933-8'),ST_SECTION))
                meas    = se.get('measurements',[])
                se_fin  = se.get('se_final')
                mhdr    = [Paragraph(f'<b>{t("pdf.se.col_measurement", "Μέτρηση")}</b>',ST_SMALL),
                           Paragraph('<b>h1 (mm)</b>',ST_SMALL),
                           Paragraph('<b>h2 (mm)</b>',ST_SMALL),
                           Paragraph('<b>SE (%)</b>',ST_SMALL)]
                mrows=[mhdr]
                for m in meas:
                    h1=m.get('h1') or m.get('sediment_height')
                    h2=m.get('h2') or m.get('sand_height')
                    sv=(h2/h1*100) if h1 and h1>0 else None
                    mrows.append([
                        Paragraph(f'#{m.get("measurement_no","")}',ST_SMALL),
                        Paragraph(f'{h1:.1f}' if h1 is not None else '—',ST_SMALL),
                        Paragraph(f'{h2:.1f}' if h2 is not None else '—',ST_SMALL),
                        Paragraph(f'{sv:.1f}%' if sv is not None else '—',ST_SMALL),
                    ])
                mrows.append([Paragraph(f'<b>{t("pdf.se.average_label", "Μέσος SE")}</b>',ST_SMALL),'','',
                               Paragraph(f'<b>{int(round(se_fin))}%</b>' if se_fin is not None else '—',ST_BODY)])
                mt=Table(mrows,colWidths=[W_p*0.25]*4,repeatRows=1)
                mt.setStyle(TableStyle(base_tbl_style()+[
                    ('BACKGROUND',(0,-1),(-1,-1),BLUE_LIGHT),
                    ('ALIGN',(1,0),(-1,-1),'CENTER'),
                ]))
                story.append(mt); story.append(Spacer(1,2*mm))
                se_chk=spec_chk_tbl(se.get('spec_checks',[]),'se_final','%')
                if se_chk: story.append(se_chk)
                story.append(Spacer(1,5*mm))
            if has_mb:
                mb = t_data['methylene_blue']
                story.append(Paragraph(t('pdf.mb.section_title', 'Μπλε Μεθυλενίου — EN 933-9'),ST_SECTION))
                half=W_p/2
                mb_rows=[
                    [Paragraph(f'<b>{t("pdf.mb.weight_sample", "Βάρος δείγματος")}</b>',ST_SMALL),
                     Paragraph(f'{mb.get("weight_sample",0):.1f}g',ST_BODY),
                     Paragraph(f'<b>{t("pdf.mb.volume_final", "Όγκος MB τελικός")}</b>',ST_SMALL),
                     Paragraph(f'{mb.get("volume_final",0):.1f}ml',ST_BODY)],
                    [Paragraph(f'<b>{t("pdf.mb.value_label", "MB Τιμή")}</b>',ST_SMALL),
                     Paragraph(''),
                     Paragraph(''),
                     Paragraph(f'<b>{mb.get("mb_value",0):.2f} g/kg</b>',ST_BODY)],
                ]
                cw=[35*mm, half-35*mm, 35*mm, half-35*mm]
                mbt=Table(mb_rows,colWidths=cw)
                mbt.setStyle(TableStyle([
                    ('BACKGROUND',(0,0),(0,-1),BLUE_LIGHT),
                    ('BACKGROUND',(2,0),(2,0),BLUE_LIGHT),
                    ('SPAN',(0,1),(2,1)),
                    ('BACKGROUND',(0,1),(2,1),BLUE_LIGHT),
                    ('GRID',(0,0),(-1,-1),0.5,colors.HexColor('#ccc')),
                    ('ROWBACKGROUNDS',(0,0),(-1,-1),[WHITE,GRAY_ROW]),
                    ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                    ('TOPPADDING',(0,0),(-1,-1),2*mm),
                    ('BOTTOMPADDING',(0,0),(-1,-1),2*mm),
                ]))
                story.append(mbt); story.append(Spacer(1,2*mm))
                mb_chk=spec_chk_tbl(mb.get('spec_checks',[]),'mb_value',' g/kg')
                if mb_chk: story.append(mb_chk)

        # ── Build ─────────────────────────────────────────────
        doc.build(story, canvasmaker=ReportCanvas)

        return {'success': True, 'path': output_path}

    except Exception as e:
        import traceback
        return {'success': False, 'error': str(e),
                'traceback': traceback.format_exc()}



def _merge_pdfs(portrait_path: str, landscape_path: str, output_path: str) -> dict:
    """
    Ενώνει δύο PDF αρχεία (portrait + landscape) με τη σωστή σειρά σελίδων.
    page_order: λίστα με ('p', σελίδα) ή ('l', σελίδα) — 0-indexed
    """
    try:
        from pypdf import PdfWriter, PdfReader
        writer  = PdfWriter()
        portrait  = PdfReader(portrait_path)
        landscape = PdfReader(landscape_path)

        # Σειρά: όλες οι portrait σελίδες, μετά όλες οι landscape
        # Αλλά θέλουμε: p0, l0, p1, p2 (sieve, chart, fi, se/mb)
        # Η σειρά περνιέται ως page_order
        for page in portrait.pages:
            writer.add_page(page)
        for page in landscape.pages:
            writer.add_page(page)

        with open(output_path, 'wb') as f:
            writer.write(f)

        return {'success': True, 'path': output_path}
    except Exception as e:
        return {'success': False, 'error': str(e)}


# ============================================================
# PERIODIC REPORT PDF — ReportLab
# ============================================================

def _generate_periodic_pdf_report(product_id: int, from_date: str, to_date: str,
                                    source_id, output_path: str) -> dict:
    """
    Παράγει PDF περιοδικής αναφοράς με ReportLab.
    Ίδιο header/στυλ με τα δελτία αποτελεσμάτων.
    """
    try:
        import math
        from reportlab.lib.pagesizes import A4, landscape as rl_landscape
        from reportlab.lib import colors
        from reportlab.lib.units import mm
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import (Table, TableStyle, Paragraph,
                                         SimpleDocTemplate, Spacer,
                                         BaseDocTemplate, Frame, PageTemplate)
        from reportlab.pdfgen import canvas as rl_canvas
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from datetime import date as dt_date

        from database.db_manager import get_connection, get_active_ce_period
        conn = get_connection()
        lab_row = conn.execute('SELECT * FROM tbl_laboratory WHERE id=1').fetchone()
        lab = dict(lab_row) if lab_row else {}
        product_row = conn.execute('SELECT * FROM tbl_products WHERE id=?', (product_id,)).fetchone()
        product = dict(product_row) if product_row else {}
        conn.close()

        # Φόρτωση δειγμάτων
        samples = search_samples(product_id, from_date, to_date, source_id, 500) or []
        if source_id:
            samples = [s for s in samples if s.get('source_id') == source_id]
        if not samples:
            return {'success': False, 'error': t('pdf.periodic.no_samples', 'Δεν βρέθηκαν δείγματα')}

        reports = [_get_full_report_with_specs(s['id']) for s in samples[:100]]
        reports = [r for r in reports if r]

        # Δηλωμένες τιμές από ενεργή υποπερίοδο — προτεραιότητα στις
        # per-προϊόν τιμές (tbl_subperiod_specs), fallback στις επίπεδες
        # τιμές της υποπεριόδου (ίδια λογική με το frontend, reports.js)
        period = get_active_ce_period() or {}
        sub = period.get('active_subperiod') or {}
        ext_mb = sub.get('ext_mb_value')
        ext_se = sub.get('ext_se_value')
        ext_fl = sub.get('ext_fl_value')
        if sub.get('id'):
            product_spec = next(
                (r for r in get_subperiod_specs(sub['id']) if r['product_id'] == product_id),
                None
            )
            if product_spec:
                ext_mb = product_spec.get('mb') if product_spec.get('mb') is not None else ext_mb
                ext_se = product_spec.get('se') if product_spec.get('se') is not None else ext_se
                ext_fl = product_spec.get('fl') if product_spec.get('fl') is not None else ext_fl

        # Fonts
        ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        import sys as _sys_pf
        _bundle_pf = os.path.join(
            getattr(_sys_pf, '_MEIPASS', ROOT), 'fonts'
        )
        def _find_font(*paths):
            for p in paths:
                if os.path.exists(p): return p
            return None
        _r = _find_font(
            os.path.join(_bundle_pf, 'Inter-Regular.ttf'),
            os.path.join(_bundle_pf, 'LiberationSans-Regular.ttf'),
            '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            '/usr/share/fonts/TTF/DejaVuSans.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        )
        _b = _find_font(
            os.path.join(_bundle_pf, 'Inter-Bold.ttf'),
            os.path.join(_bundle_pf, 'LiberationSans-Bold.ttf'),
            '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
            '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        )
        F, FB = 'Helvetica', 'Helvetica-Bold'
        if _r and _b:
            try:
                if 'LabFont' not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont('LabFont', _r))
                    pdfmetrics.registerFont(TTFont('LabFont-Bold', _b))
                F, FB = 'LabFont', 'LabFont-Bold'
            except: pass

        # Χρώματα
        BLUE_DARK  = colors.HexColor('#3a6bb0')
        BLUE_LIGHT = colors.HexColor('#e8f0fa')
        GRAY_ROW   = colors.HexColor('#f5f5f5')
        WHITE      = colors.white
        BLACK      = colors.black
        RED        = colors.HexColor('#b91c1c')

        LW, LH = rl_landscape(A4)
        ML = 14*mm; MT = 31*mm; MB = 16*mm
        import sys as _sys_logo2
        LOGO_PATH = os.path.join(getattr(_sys_logo2, '_MEIPASS', ROOT), 'src', 'assets', 'logopage.png')

        def fmt_date(v):
            if not v: return '—'
            try:
                p = str(v).split('-')
                if len(p) == 3: return f'{p[2]}/{p[1]}/{p[0]}'
            except: pass
            return str(v)

        def draw_chrome(c, pnum, total):
            W, H = LW, LH
            top_y = H - 10*mm
            if os.path.exists(LOGO_PATH):
                try:
                    c.drawImage(LOGO_PATH, ML, top_y - 19*mm,
                                width=160*mm, height=19*mm,
                                preserveAspectRatio=True, mask='auto')
                except: pass
            cx = W - ML
            ce = lab.get('ce_number','')
            if ce:
                c.setFont(FB,9); c.setFillColor(BLUE_DARK)
                c.drawRightString(cx, top_y-6*mm, ce)
            cb = lab.get('ce_body','')
            if cb:
                c.setFont(F,7.5); c.setFillColor(colors.HexColor('#444'))
                c.drawRightString(cx, top_y-10*mm, cb)
            cf, ct = lab.get('ce_valid_from',''), lab.get('ce_valid_to','')
            if cf and ct:
                c.setFont(F,7.5); c.setFillColor(colors.HexColor('#444'))
                c.drawRightString(cx, top_y-14*mm, t('pdf.common.validity', 'Ισχύς: {from_} — {to}').format(from_=fmt_date(cf), to=fmt_date(ct)))
            c.setStrokeColor(BLUE_DARK); c.setLineWidth(1.2)
            c.line(ML, top_y - 19*mm, W-ML, top_y - 19*mm)
            # Footer
            c.setFont(F,7.5); c.setFillColor(colors.HexColor('#555'))
            # Έκθεση πάνω από γραμμή (δεξιά)
            if sub_report:
                c.drawRightString(W-ML, 15*mm, t('pdf.periodic.report_label', 'Έκθεση: {report}').format(report=sub_report))
            # Γραμμή διαχωρισμού
            c.setStrokeColor(colors.HexColor('#ccc')); c.setLineWidth(0.5)
            c.line(ML, 13*mm, W-ML, 13*mm)
            # Ημερομηνία + σελίδα κάτω από γραμμή
            c.drawString(ML, 8*mm, t('pdf.common.issue_date', 'Ημερομηνία έκδοσης: {date}').format(date=fmt_date(dt_date.today().isoformat())))
            c.drawRightString(W-ML, 8*mm, t('pdf.common.page_of', 'Σελίδα {page} από {total}').format(page=pnum, total=total))

        class PeriodicCanvas(rl_canvas.Canvas):
            _total = 1
            def showPage(self):
                draw_chrome(self, self._pageNumber, self.__class__._total)
                super().showPage()
            def save(self):
                # Μην καλείς draw_chrome στο save — το showPage το καλεί ήδη
                super().save()

        # ── Στατιστικά ────────────────────────────────────────
        def avg(arr): return sum(arr)/len(arr) if arr else None
        def mx(arr):  return max(arr) if arr else None
        def fmt(v, dec=2): return '—' if v is None else f'{v:.{dec}f}'
        def diff(mo, ext, dec=2):
            if mo is None or ext is None: return '—'
            d = mo - ext
            return ('+' if d >= 0 else '') + f'{d:.{dec}f}'

        mb_vals = [r['tests']['methylene_blue']['mb_value']
                   for r in reports if r.get('tests',{}).get('methylene_blue',{}).get('mb_value') is not None]
        se_vals = [r['tests']['sand_equivalent']['se_final']
                   for r in reports if r.get('tests',{}).get('sand_equivalent',{}).get('se_final') is not None]
        fi_vals = [r['tests']['flakiness']['fi_index']
                   for r in reports if r.get('tests',{}).get('flakiness',{}).get('fi_index') is not None]

        mb_mo = avg(mb_vals); mb_mx = mx(mb_vals)
        se_mo = avg(se_vals); se_mx = mx(se_vals)
        fi_mo = avg(fi_vals); fi_mx = mx(fi_vals)

        # Κοκκομετρία
        sieve_data = {}
        for r in reports:
            results = r.get('tests',{}).get('sieve_analysis',{}).get('data',{}).get('results',[])
            for res in results:
                mm_key = res.get('sieve_mm')
                if mm_key and mm_key > 0:
                    if mm_key not in sieve_data: sieve_data[mm_key] = []
                    if res.get('passing_percent') is not None:
                        sieve_data[mm_key].append(res['passing_percent'])

        sieve_rows = sorted([
            (k, avg(v), mx(v), len(v))
            for k, v in sieve_data.items()
        ], reverse=True)

        d_min = product.get('d_min','')
        d_max = product.get('d_max','')
        prod_name = _build_product_name(product.get('name',''), d_min, d_max) if product else ''
        period_str = f"{fmt_date(from_date)} — {fmt_date(to_date)}"
        sub_report = sub.get('lab_report_number','') or ''

        # ── Δημιουργία PDF ────────────────────────────────────
        pf = Frame(ML, MB, LW-2*ML, LH-MT-MB, id='main', showBoundary=0)
        pt = PageTemplate(id='main', frames=[pf])

        class Doc(BaseDocTemplate):
            def __init__(self, *a, **kw):
                super().__init__(*a, **kw)
                self.addPageTemplates([pt])

        doc = Doc(output_path, pagesize=rl_landscape(A4),
                  leftMargin=ML, rightMargin=ML,
                  topMargin=MT, bottomMargin=MB)

        story = []

        def sty(name, **kw):
            kw.setdefault('fontName', F)
            s = ParagraphStyle(name, **kw)
            return s

        ST_TITLE   = sty('T', fontSize=13, textColor=BLUE_DARK, leading=16, fontName=FB)
        ST_SUB     = sty('S', fontSize=9,  textColor=colors.HexColor('#444'), leading=12)
        ST_LABEL   = sty('L', fontSize=8,  textColor=colors.HexColor('#666'), leading=11)
        ST_VALUE   = sty('V', fontSize=10, textColor=BLACK, leading=13, fontName=FB)

        # Τίτλος
        samples_with_tests = len(reports)
        # ── Γραμμή 1: τίτλος + υλικό δεξιά ─────────────────
        ST_RIGHT = sty('R', fontSize=9, textColor=colors.HexColor('#444'),
                        leading=12, alignment=2)  # 2=RIGHT
        title_data = [[
            Paragraph(t('pdf.periodic.title', 'Στατιστική Αναφορά για την περίοδο από {from_} ως {to}').format(from_=fmt_date(from_date), to=fmt_date(to_date)), ST_TITLE),
            Paragraph(f'{prod_name}', sty('PN', fontSize=13, textColor=BLUE_DARK,
                                           fontName=FB, leading=16, alignment=2))
        ]]
        title_tbl = Table(title_data, colWidths=[LW-2*ML-60*mm, 60*mm])
        title_tbl.setStyle(TableStyle([
            ('VALIGN',  (0,0),(-1,-1), 'BOTTOM'),
            ('LEFTPADDING',  (0,0),(-1,-1), 0),
            ('RIGHTPADDING', (0,0),(-1,-1), 0),
            ('TOPPADDING',   (0,0),(-1,-1), 0),
            ('BOTTOMPADDING',(0,0),(-1,-1), 0),
        ]))
        story.append(title_tbl)

        # ── Γραμμή 2: σύνολο δειγμάτων δεξιά ────────────────
        story.append(Spacer(1, 1*mm))
        n_str = t('pdf.periodic.total_samples', 'Σύνολο δειγμάτων: {n}').format(n=len(samples))
        if samples_with_tests != len(samples):
            n_str += '  |  ' + t('pdf.periodic.samples_with_tests', 'Δείγματα με δοκιμές: {n}').format(n=samples_with_tests)
        story.append(Paragraph(n_str, sty('NS', fontSize=9,
                                           textColor=colors.HexColor('#444'),
                                           leading=12, alignment=2)))

        # ── Section header: Εργαστηριακές Δοκιμές Αδρανών ───
        story.append(Spacer(1, 3*mm))
        ST_SECTION_HDR = sty('SH', fontSize=11, textColor=BLUE_DARK,
                               fontName=FB, leading=14, alignment=1, spaceAfter=2*mm)
        story.append(Paragraph(t('pdf.periodic.section_title', 'Εργαστηριακές Δοκιμές Αδρανών'), ST_SECTION_HDR))
        story.append(Spacer(1, 6*mm))

        # ── Πίνακας MB / SE / FI ─────────────────────────────
        def stat_col(label, unit, vals, mo, mx_v, ext, dec):
            d = diff(mo, ext, dec)
            d_color = RED if (d != '—' and float(d) > 0) else colors.HexColor('#166534')
            rows = [
                [Paragraph(f'<b>{label}</b> ({unit})', ParagraphStyle('h', fontName=FB, fontSize=9, textColor=BLUE_DARK))],
                [t('pdf.periodic.stat_count', 'Πλήθος: {n}').format(n=len(vals) or '—')],
                [t('pdf.periodic.stat_avg', 'Μ.Ο.: {v}').format(v=fmt(mo, dec))],
                [t('pdf.periodic.stat_max', 'Μέγιστη: {v}').format(v=fmt(mx_v, dec))],
                [t('pdf.periodic.stat_declared', 'Δηλωμένη: {v}').format(v=fmt(ext, dec))],
                [t('pdf.periodic.stat_deviation', 'Απόκλιση: {v}').format(v=d)],
            ]
            col_w = (LW - 2*ML - 2*3*mm) / 3
            tbl = Table(rows, colWidths=[col_w])
            tbl.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), BLUE_LIGHT),
                ('BACKGROUND', (0,1), (-1,-1), WHITE),
                ('ROWBACKGROUNDS', (0,2), (-1,-1), [WHITE, GRAY_ROW]),
                ('FONTNAME',   (0,0), (-1,-1), F),
                ('FONTSIZE',   (0,0), (-1,-1), 9),
                ('FONTNAME',   (0,2), (-1,2), FB),
                ('TOPPADDING',    (0,0), (-1,-1), 4),
                ('BOTTOMPADDING', (0,0), (-1,-1), 4),
                ('LEFTPADDING',   (0,0), (-1,-1), 5),
                ('RIGHTPADDING',  (0,0), (-1,-1), 5),
                ('BOX',    (0,0), (-1,-1), 0.5, BLUE_DARK),
                ('INNERGRID', (0,0), (-1,-1), 0.3, colors.HexColor('#ddd')),
                ('ALIGN', (0,0), (-1,-1), 'LEFT'),
            ]))
            return tbl

        col_w = (LW - 2*ML - 20*mm) / 3
        avail_w = LW - 2*ML
        gap     = 3*mm
        col_w3  = (avail_w - 2*gap) / 3
        stat_table = Table(
            [[stat_col('MB','g/kg', mb_vals, mb_mo, mb_mx, ext_mb, 2),
              stat_col('SE','%',    se_vals, se_mo, se_mx, ext_se, 1),
              stat_col('FI','%',    fi_vals, fi_mo, fi_mx, ext_fl, 1)]],
            colWidths=[col_w3, col_w3, col_w3],
            hAlign='LEFT', spaceAfter=0,
            spaceBefore=0
        )
        stat_table.setStyle(TableStyle([
            ('LEFTPADDING',  (0,0),(0,-1),  0),
            ('LEFTPADDING',  (1,0),(1,-1),  gap),
            ('LEFTPADDING',  (2,0),(2,-1),  gap),
            ('RIGHTPADDING', (0,0),(-1,-1), 0),
            ('TOPPADDING',   (0,0),(-1,-1), 0),
            ('BOTTOMPADDING',(0,0),(-1,-1), 0),
            ('VALIGN', (0,0),(-1,-1), 'TOP'),
        ]))
        story.append(stat_table)
        story.append(Spacer(1, 8*mm))

        # ── Πίνακας Κοκκομετρίας ─────────────────────────────
        if sieve_rows:
            story.append(Spacer(1, 3*mm))
            sieve_count = sieve_rows[0][3] if sieve_rows else 0

            sieve_mm_list = [r[0] for r in sieve_rows]
            avgs   = [r[1] for r in sieve_rows]
            maxs   = [r[2] for r in sieve_rows]

            # Δηλωμένες από ext_sieve_results
            ext_sieve = {}
            if sub.get('ext_sieve_results'):
                try:
                    import json
                    for item in json.loads(sub['ext_sieve_results']):
                        ext_sieve[item['sieve_mm']] = item['passing_pct']
                except: pass
            decl = [ext_sieve.get(mm_k) for mm_k in sieve_mm_list]

            col_w_s = (LW - 2*ML) / (len(sieve_mm_list) + 1)
            header_row = [t('pdf.periodic.sieve_col_sieve', 'Κόσκινο (mm)')] + [str(m) for m in sieve_mm_list]
            mo_row     = [t('pdf.periodic.sieve_col_avg', 'Μ.Ο. (%)')]     + [fmt(v,1) for v in avgs]
            max_row    = [t('pdf.periodic.sieve_col_max', 'Μέγιστη (%)')]  + [fmt(v,1) for v in maxs]
            decl_row   = [t('pdf.periodic.sieve_col_declared', 'Δηλωμένη (%)')] + [fmt(v,1) for v in decl]

            title_row = [Paragraph(t('pdf.periodic.sieve_title', 'Κοκκομετρία'), sty('KH3', fontSize=10,
                           textColor=BLUE_DARK, fontName=FB, leading=13))] +                          ['' for _ in sieve_mm_list]
            count_row  = [Paragraph(t('pdf.periodic.stat_count', 'Πλήθος: {n}').format(n=sieve_count), ST_LABEL)] +                          ['' for _ in sieve_mm_list]
            s_data = [title_row, count_row, header_row, mo_row, max_row, decl_row]
            s_col_widths = [col_w_s * 1.4] + [col_w_s * 0.95] * len(sieve_mm_list)
            s_table = Table(s_data, colWidths=s_col_widths)
            s_table.setStyle(TableStyle([
                # Γραμμή 0: τίτλος Κοκκομετρία
                ('BACKGROUND',    (0,0), (-1,0),  BLUE_LIGHT),
                ('SPAN',          (0,0), (-1,0)),
                ('FONTNAME',      (0,0), (-1,0),  FB),
                ('FONTSIZE',      (0,0), (-1,0),  10),
                ('TEXTCOLOR',     (0,0), (-1,0),  BLUE_DARK),
                # Γραμμή 1: πλήθος
                ('BACKGROUND',    (0,1), (-1,1),  colors.HexColor('#f8f8f8')),
                ('SPAN',          (0,1), (-1,1)),
                ('FONTSIZE',      (0,1), (-1,1),  8),
                ('TEXTCOLOR',     (0,1), (-1,1),  colors.HexColor('#666')),
                # Γραμμή 2: κόσκινα header
                ('BACKGROUND',    (0,2), (-1,2),  BLUE_DARK),
                ('TEXTCOLOR',     (0,2), (-1,2),  WHITE),
                ('FONTNAME',      (0,2), (-1,2),  FB),
                # Γραμμή 3: ΜΟ bold
                ('BACKGROUND',    (0,3), (-1,3),  BLUE_LIGHT),
                ('FONTNAME',      (0,3), (-1,3),  FB),
                # Γραμμές 4+
                ('ROWBACKGROUNDS',(0,4), (-1,-1), [WHITE, GRAY_ROW]),
                # Γενικά
                ('FONTNAME',      (0,0), (0,-1),  FB),
                ('FONTSIZE',      (0,2), (-1,-1), 8),
                ('ALIGN',         (1,0), (-1,-1), 'CENTER'),
                ('ALIGN',         (0,0), (0,-1),  'LEFT'),
                ('TOPPADDING',    (0,0), (-1,-1), 4),
                ('BOTTOMPADDING', (0,0), (-1,-1), 4),
                ('LEFTPADDING',   (0,0), (-1,-1), 5),
                ('RIGHTPADDING',  (0,0), (-1,-1), 5),
                ('BOX',           (0,0), (-1,-1), 0.5, BLUE_DARK),
                ('INNERGRID',     (0,2), (-1,-1), 0.3, colors.HexColor('#ccc')),
            ]))
            story.append(s_table)

        # Single pass — περιοδική αναφορά χωράει σε 1 σελίδα
        PeriodicCanvas._total = 1
        doc.build(story, canvasmaker=PeriodicCanvas)
        return {'success': True, 'path': output_path}

    except Exception as e:
        import traceback
        return {'success': False, 'error': str(e), 'traceback': traceback.format_exc()}

# ============================================================
# ΚΥΡΙΟ LOOP
# ============================================================

if __name__ == '__main__':
    try:
        initialize_database()
        print('[Python] Έτοιμο — Βάση δεδομένων αρχικοποιήθηκε', flush=True)
        logging.info('Βάση δεδομένων αρχικοποιήθηκε')
    except Exception as e:
        print(f'[Python] Σφάλμα αρχικοποίησης: {e}', flush=True)
        logging.exception('Σφάλμα αρχικοποίησης')
        sys.exit(1)

    print('[Python] Αναμονή εντολών...', flush=True)
    logging.info('Αναμονή εντολών...')

    # handle_request() ήδη πιάνει τα δικά της exceptions — αυτό το εξωτερικό
    # try/except είναι άμυνα-σε-βάθος για οτιδήποτε ξεφύγει από αυτό (π.χ.
    # σφάλμα στο ίδιο το print/json.dumps), ώστε ένα πραγματικό crash του
    # κύριου loop να καταγραφεί με πλήρες traceback πριν πεθάνει η διεργασία,
    # αντί να αφήσει μόνο ένα σιωπηλό exit code στον Node.
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            response = handle_request(line)
            print(json.dumps(response, ensure_ascii=False), flush=True)
    except Exception:
        logging.exception('Μη αναμενόμενο σφάλμα στο κύριο loop — τερματισμός')
        raise

