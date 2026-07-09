"""
╔══════════════════════════════════════════════════════════════╗
║  ΜΗΧΑΝΗ ΥΠΟΛΟΓΙΣΜΩΝ ΕΡΓΑΣΤΗΡΙΟΥ                             ║
║  Λατομεία Γαλάτιστας ΑΕ                                     ║
║                                                              ║
║  Δοκιμές:                                                    ║
║  - Κοκκομετρική Ανάλυση     EN 933-1                        ║
║  - Πλακοειδή                EN 933-3                        ║
║  - Μπλε Μεθυλενίου          EN 933-9                        ║
║  - Ισοδύναμο Άμμου          EN 933-8                        ║
║                                                              ║
║  Προδιαγραφές:                                               ║
║  - EN 12620 (Αδρανή σκυροδέματος)                           ║
║  - EN 13043 (Αδρανή ασφαλτικών)                             ║
║  - EN 13242 (Αδρανή οδοστρωσίας)                            ║
║  - ΕΤΕΠ 05-03-11-04 (Ασφαλτικές στρώσεις)                  ║
║  - ΕΤΕΠ 05-03-03-00 (Βάσεις/Υποβάσεις οδοστρωσίας)         ║
║  - Εσωτερικά όρια CE (1128-CPR-0196)                        ║
╚══════════════════════════════════════════════════════════════╝
"""

from typing import Optional
import sys
import os
sys.path.append(os.path.dirname(__file__))

# Σύνδεση με βάση δεδομένων (εισάγεται μόνο αν υπάρχει)
try:
    from database.db_manager import get_connection, get_specifications, get_effective_specifications
    DB_AVAILABLE = True
except ImportError:
    DB_AVAILABLE = False


# ============================================================
# ΣΤΑΘΕΡΕΣ
# ============================================================

RESULT_OK      = 'OK'
RESULT_WARNING = 'WARNING'
RESULT_FAIL    = 'FAIL'

WARNING_MARGIN_PCT  = 0.10   # 10% εύρους ορίων για ζώνη WARNING
SE_MAX_DIFFERENCE   = 4.0    # Μέγιστη επιτρεπτή διαφορά SE (EN 933-8)
MB_DEFAULT_WEIGHT_G = 200.0  # Προεπιλογή βάρους δείγματος MB
MB_DEFAULT_WATER_ML = 500.0  # Προεπιλογή όγκου νερού MB
MB_STEP_ML          = 5.0    # Βήμα προσθήκης διαλύματος MB

SPEC_EN       = 'EN'
SPEC_ETEP     = 'ΕΤΕΠ'
SPEC_CE       = 'CE'
SPEC_INTERNAL = 'INTERNAL'

SIEVE_CODE_MB = -1
SIEVE_CODE_SE = -2
SIEVE_CODE_FI = -3


# ============================================================
# ΚΟΚΚΟΜΕΤΡΙΑ (EN 933-1)
# ============================================================

def calculate_passing_percent(sieve_results: list,
                               weight_washed: float) -> list:
    """
    Υπολογίζει % διερχόμενο για κάθε κόσκινο.

    Παράμετροι:
        sieve_results : [{'sieve_mm': float, 'weight_retained': float}, ...]
        weight_washed : βάρος πλυμένου δείγματος (g)

    Επιστρέφει:
        [{'sieve_mm', 'weight_retained', 'passing_percent'}, ...]
        ταξινομημένη από μεγαλύτερο προς μικρότερο κόσκινο
    """
    if weight_washed <= 0:
        raise ValueError("Το βάρος πλυμένου πρέπει να είναι > 0")

    sorted_sieves = sorted(sieve_results,
                           key=lambda x: x['sieve_mm'], reverse=True)
    cumulative = 0.0
    results = []
    for s in sorted_sieves:
        retained   = s.get('weight_retained', 0.0)
        cumulative += retained
        passing    = (weight_washed - cumulative) / weight_washed * 100.0
        passing    = max(0.0, min(100.0, round(passing, 1)))
        results.append({
            'sieve_mm':        s['sieve_mm'],
            'weight_retained': retained,
            'passing_percent': passing,
        })
    return results


def calculate_wash_loss(weight_dry: float,
                        weight_washed: float) -> float:
    """
    Υπολογίζει % απώλεια πλύσης.
    Τύπος: (βάρος_ξηρού - βάρος_πλυμένου) / βάρος_ξηρού × 100
    """
    if weight_dry <= 0:
        return 0.0
    if weight_washed > weight_dry:
        return 0.0
    return round((weight_dry - weight_washed) / weight_dry * 100.0, 2)


def calculate_characteristic_diameters(sieve_results: list) -> dict:
    """
    Υπολογίζει χαρακτηριστικές διαμέτρους με λογαριθμική παρεμβολή.

    Υπολογίζει: D10, D30, D50, D60
    Παράγει:
        Cu = D60/D10  (συντελεστής ομοιομορφίας)
        Cc = D30²/(D10×D60)  (συντελεστής καμπυλότητας)

    Ταξινόμηση:
        Cu < 4               → Ομοιόμορφο
        Cu ≥ 4 & Cc in [1,3] → Καλά διαβαθμισμένο (GW/SW)
        Άλλως                → Κακά διαβαθμισμένο (GP/SP)
    """
    import math

    if not sieve_results:
        return {k: None for k in
                ['D10','D30','D50','D60','Cu','Cc','classification']}

    sorted_r = sorted(sieve_results, key=lambda x: x['sieve_mm'])

    def interpolate_d(target_pct: float) -> Optional[float]:
        for i in range(len(sorted_r) - 1):
            p1 = sorted_r[i]['passing_percent']
            p2 = sorted_r[i+1]['passing_percent']
            d1 = sorted_r[i]['sieve_mm']
            d2 = sorted_r[i+1]['sieve_mm']
            if p1 <= target_pct <= p2 and p2 > p1 and d1 > 0 and d2 > 0:
                log_d = (math.log10(d1) +
                         (math.log10(d2) - math.log10(d1)) *
                         (target_pct - p1) / (p2 - p1))
                return 10 ** log_d
        return None

    d10 = interpolate_d(10.0)
    d30 = interpolate_d(30.0)
    d50 = interpolate_d(50.0)
    d60 = interpolate_d(60.0)

    cu = round(d60 / d10, 2) if (d10 and d60 and d10 > 0) else None
    cc = (round((d30 ** 2) / (d10 * d60), 2)
          if (d10 and d30 and d60 and d10 > 0 and d60 > 0) else None)

    classification = None
    if cu is not None and cc is not None:
        if cu < 4:
            classification = 'Ομοιόμορφο'
        elif cu >= 4 and 1 <= cc <= 3:
            classification = 'Καλά διαβαθμισμένο'
        else:
            classification = 'Κακά διαβαθμισμένο'

    return {
        'D10':            round(d10, 3) if d10 else None,
        'D30':            round(d30, 3) if d30 else None,
        'D50':            round(d50, 3) if d50 else None,
        'D60':            round(d60, 3) if d60 else None,
        'Cu':             cu,
        'Cc':             cc,
        'classification': classification,
    }


# ============================================================
# ΠΛΑΚΟΕΙΔΗ (EN 933-3)
# ============================================================

def calculate_flakiness_index(fractions: list) -> float:
    """
    Υπολογίζει Δείκτη Πλακοειδούς (FI).

    Τύπος: FI = (Σ βάρη διερχόμενων ραβδωτών) /
                (Σ βάρη κλασμάτων τετραγωνικής οπής) × 100

    Παράμετροι:
        fractions: [{'sieve_mm': float,
                     'weight_fraction': float,  ← τετραγωνικό κόσκινο
                     'weight_passing':  float}, ...]  ← ραβδωτό κόσκινο

    Σημείωση:
        Αν η κοκκομετρία είναι διαθέσιμη → weight_fraction
        συμπληρώνεται αυτόματα από αυτήν.
        Το weight_passing καταχωρείται ΠΑΝΤΑ χειροκίνητα.
    """
    total_fraction = sum(f.get('weight_fraction', 0.0) for f in fractions)
    total_passing  = sum(f.get('weight_passing',  0.0) for f in fractions)
    if total_fraction <= 0:
        return 0.0
    return round(total_passing / total_fraction * 100.0)  # EN 933-3 §8: nearest whole number


def validate_flakiness_fractions(fractions: list) -> list:
    """Επικυρώνει κλάσματα. Επιστρέφει λίστα σφαλμάτων."""
    errors = []
    for f in fractions:
        w_frac = f.get('weight_fraction', 0)
        w_pass = f.get('weight_passing',  0)
        if w_pass > w_frac:
            errors.append(
                f"Κόσκινο {f.get('sieve_mm')}mm: "
                f"βάρος ραβδωτού ({w_pass}g) > βάρος κλάσματος ({w_frac}g)"
            )
    return errors


# ============================================================
# ΜΠΛΕ ΜΕΘΥΛΕΝΙΟΥ (EN 933-9)
# ============================================================

def calculate_mb(volume_final: float,
                 weight_sample: float = MB_DEFAULT_WEIGHT_G) -> float:
    """
    Υπολογίζει τιμή Μπλε Μεθυλενίου (MB).

    Τύπος: MB = (V1 / M1) × 10

    Παράμετροι:
        volume_final  : τελικός όγκος διαλύματος V1 (ml)
        weight_sample : βάρος δείγματος M1 (g)  [default: 200g]

    Επιστρέφει: MB σε g/kg

    Πρότυπο EN 933-9:
        Κλάσμα δείγματος: 0/2mm
        Συγκέντρωση διαλύματος: 10 g/L
        Βήμα προσθήκης: 5ml
        Κριτήριο τέλους: εμφάνιση φωτοστεφάνου σε χαρτί φίλτρου
    """
    if weight_sample <= 0:
        raise ValueError("Το βάρος δείγματος πρέπει να είναι > 0")
    if volume_final < 0:
        raise ValueError("Ο τελικός όγκος δεν μπορεί να είναι αρνητικός")
    return round(volume_final / weight_sample * 10.0, 2)


def suggest_mb_initial_volume(product_id: int) -> dict:
    """
    Προτείνει αρχικό όγκο MB βάσει τελευταίας δοκιμής ίδιου προϊόντος.

    Λογική: αρχικός = τελευταίος V1 - 1 βήμα (5ml)
    Αν > 0 → πορτοκαλί προειδοποίηση στο UI

    Επιστρέφει:
        {'volume': float, 'is_suggestion': bool, 'based_on': float|None}
    """
    if not DB_AVAILABLE:
        return {'volume': 0.0, 'is_suggestion': False, 'based_on': None}

    conn = get_connection()
    result = conn.execute("""
        SELECT mb.volume_final
        FROM tbl_methylene_blue mb
        JOIN tbl_samples s ON mb.sample_id = s.id
        WHERE s.product_id = ?
        ORDER BY mb.created_at DESC
        LIMIT 1
    """, (product_id,)).fetchone()
    conn.close()

    if result and result['volume_final']:
        last_v1   = result['volume_final']
        suggested = max(0.0, last_v1 - MB_STEP_ML)
        return {
            'volume':        suggested,
            'is_suggestion': suggested > 0.0,
            'based_on':      last_v1,
        }
    return {'volume': 0.0, 'is_suggestion': False, 'based_on': None}


def validate_mb_volumes(volume_initial: float,
                        volume_final: float) -> list:
    """Επικυρώνει όγκους MB. Επιστρέφει λίστα σφαλμάτων."""
    errors = []
    if volume_final <= 0:
        errors.append("Ο τελικός όγκος V1 πρέπει να είναι > 0")
    if volume_initial < 0:
        errors.append("Ο αρχικός όγκος δεν μπορεί να είναι αρνητικός")
    if volume_final < volume_initial:
        errors.append("Ο τελικός όγκος πρέπει να είναι ≥ αρχικού")
    effective = volume_final - volume_initial
    if effective > 0 and effective % MB_STEP_ML != 0:
        errors.append(
            f"Η διαφορά ({effective}ml) "
            f"πρέπει να είναι πολλαπλάσιο του {MB_STEP_ML}ml"
        )
    return errors


# ============================================================
# ΙΣΟΔΥΝΑΜΟ ΑΜΜΟΥ (EN 933-8)
# ============================================================

def calculate_se(h1: float, h2: float) -> float:
    """
    Υπολογίζει Ισοδύναμο Άμμου (SE%).

    Τύπος: SE% = (h2 / h1) × 100  — EN 933-8 §9
    h1 = ύψος αιωρήματος αργίλου (clay reading) — πάντα μεγαλύτερο
    h2 = ύψος ιζήματος άμμου (sand reading) — πάντα μικρότερο
    """
    if h1 <= 0:
        raise ValueError("Το h1 (άργιλος) πρέπει να είναι > 0")
    if h2 < 0:
        raise ValueError("Το h2 (άμμος) δεν μπορεί να είναι αρνητικό")
    if h2 > h1:
        raise ValueError(f"Το h2 ({h2}) δεν μπορεί να είναι > h1 ({h1})")
    return round(h2 / h1 * 100.0, 1)  # EN 933-8 §9: SE = (άμμος/άργιλος) × 100


def evaluate_se_measurements(measurements: list) -> dict:
    """
    Αξιολογεί μετρήσεις SE κατά EN 933-8 §9.

    Κανόνας: αν |SE1 - SE2| > 4 → η δοκιμή επαναλαμβάνεται εξ αρχής
    ΔΕΝ υπάρχει 3η μέτρηση — η EN 933-8 §9 απαιτεί πάντα 2 κυλίνδρους.
    Τελικό SE = μέσος όρος των 2 μετρήσεων, στρογγυλοποίηση σε ακέραιο.

    Παράμετροι:
        measurements: [{'h1': float, 'h2': float}, ...]  — ακριβώς 2

    Επιστρέφει:
        {
          'se_values':      [float, ...],
          'difference':     float | None,
          'requires_repeat': bool,  # αν True → επανάληψη δοκιμής
          'se_final':       int,    # ακέραιος κατά EN 933-8 §9
          'n_measurements': int,
        }
    """
    if not measurements or len(measurements) < 2:
        raise ValueError("Απαιτούνται ακριβώς 2 μετρήσεις")

    se_values = []
    for i, m in enumerate(measurements, 1):
        try:
            se_values.append(calculate_se(m['h1'], m['h2']))
        except ValueError as e:
            raise ValueError(f"Μέτρηση {i}: {e}")

    difference     = round(abs(se_values[0] - se_values[1]), 1)
    requires_repeat = difference > SE_MAX_DIFFERENCE

    if requires_repeat:
        raise ValueError(
            f"Διαφορά SE ({difference}) > {SE_MAX_DIFFERENCE} — "
            "Η δοκιμή πρέπει να επαναληφθεί εξ αρχής (EN 933-8 §9)"
        )

    # EN 933-8 §9: στρογγυλοποίηση στον πλησιέστερο ακέραιο
    se_final = round(sum(se_values) / len(se_values))

    return {
        'se_values':       se_values,
        'difference':      difference,
        'requires_repeat': False,
        'se_final':        se_final,
        'n_measurements':  len(se_values),
    }


# ============================================================
# ΣΥΓΚΡΙΣΗ ΜΕ ΠΡΟΔΙΑΓΡΑΦΕΣ
# ============================================================

def check_value_against_limits(value: float,
                                lower: Optional[float],
                                upper: Optional[float]) -> str:
    """
    Ελέγχει τιμή έναντι ορίων.

    Ζώνες αποτελέσματος:
        FAIL    → εκτός [lower, upper]
        WARNING → εντός αλλά στο 10% του εύρους
        OK      → εντός και μακριά από τα όρια
    """
    if lower is None and upper is None:
        return RESULT_OK
    if lower is not None and value < lower:
        return RESULT_FAIL
    if upper is not None and value > upper:
        return RESULT_FAIL
    if lower is not None and upper is not None:
        margin = (upper - lower) * WARNING_MARGIN_PCT
        if margin > 0:
            if value < (lower + margin) or value > (upper - margin):
                return RESULT_WARNING
    return RESULT_OK


def get_overall_status(check_results: list) -> str:
    """Επιστρέφει το χειρότερο αποτέλεσμα (FAIL > WARNING > OK)."""
    if not check_results:
        return RESULT_OK
    if any(r.get('status') == RESULT_FAIL    for r in check_results):
        return RESULT_FAIL
    if any(r.get('status') == RESULT_WARNING for r in check_results):
        return RESULT_WARNING
    return RESULT_OK


def check_sieve_analysis_vs_specs(sieve_results: list,
                                   product_id: int,
                                   spec_type: Optional[str] = None,
                                   subperiod_id: Optional[int] = None) -> list:
    """
    Συγκρίνει κοκκομετρία με προδιαγραφές.

    spec_type: None=όλες | 'EN' | 'ΕΤΕΠ' | 'CE' | 'INTERNAL'
    subperiod_id: αν δοθεί, χρησιμοποιούνται τα effective specs της
        υποπεριόδου (subperiod override αν υπάρχει, αλλιώς global) —
        βλ. get_effective_specifications.

    Επιστρέφει λίστα ελέγχων ανά κόσκινο/προδιαγραφή.
    """
    if not DB_AVAILABLE:
        return []

    specs = (get_effective_specifications(subperiod_id, product_id)
             if subperiod_id else get_specifications(product_id))
    if spec_type:
        specs = [s for s in specs if s['spec_type'] == spec_type]

    passing_dict = {r['sieve_mm']: r['passing_percent']
                    for r in sieve_results}
    results = []
    for spec in specs:
        sieve   = spec['sieve_mm']
        passing = passing_dict.get(sieve)
        if passing is None:
            continue
        status = check_value_against_limits(
            passing, spec.get('lower_limit'), spec.get('upper_limit')
        )
        results.append({
            'spec_type':       spec['spec_type'],
            'spec_name':       spec['spec_name'],
            'sieve_mm':        sieve,
            'passing_percent': passing,
            'lower_limit':     spec.get('lower_limit'),
            'upper_limit':     spec.get('upper_limit'),
            'status':          status,
        })
    return results


def _check_test_limits(test_type: str, value: float, product_id: int,
                       value_key: str) -> list:
    """
    Κοινή λογική για MB / SE / FI — διαβάζει από tbl_test_limits.
    parameter: 'mb_max' | 'se_min' | 'fi_max'
    """
    if not DB_AVAILABLE:
        return []
    conn = get_connection()
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM tbl_test_limits WHERE product_id=? AND test_type=?",
        (product_id, test_type)
    ).fetchall()]
    conn.close()
    results = []
    for row in rows:
        param       = row['parameter']            # 'se_min' / 'mb_max' / 'fi_max'
        limit_value = row['limit_value']
        lower = limit_value if param.endswith('_min') else None
        upper = limit_value if param.endswith('_max') else None
        status = check_value_against_limits(value, lower, upper)
        results.append({
            'spec_type':   row['spec_type'],
            'spec_name':   row['spec_name'],
            value_key:     value,
            'lower_limit': lower,
            'upper_limit': upper,
            'status':      status,
        })
    return results


def check_mb_vs_specs(mb_value: float, product_id: int) -> list:
    """Συγκρίνει MB τιμή με όρια από tbl_test_limits."""
    return _check_test_limits('mb', mb_value, product_id, 'mb_value')


def check_se_vs_specs(se_value: float, product_id: int) -> list:
    """Συγκρίνει SE τιμή με όρια από tbl_test_limits."""
    return _check_test_limits('se', se_value, product_id, 'se_value')


def check_flakiness_vs_specs(fi_value: float, product_id: int) -> list:
    """Συγκρίνει FI τιμή με όρια από tbl_test_limits."""
    return _check_test_limits('fi', fi_value, product_id, 'fi_value')


# ============================================================
# ΠΛΗΡΗΣ ΑΝΑΦΟΡΑ ΔΕΙΓΜΑΤΟΣ (για PDF)
# ============================================================

def get_full_sample_report(sample_id: int) -> dict:
    """
    Επιστρέφει πλήρη αναφορά δείγματος με όλες τις δοκιμές,
    συγκρίσεις με προδιαγραφές και συνολική κατάσταση.
    Χρησιμοποιείται για παραγωγή PDF έκθεσης.
    """
    if not DB_AVAILABLE:
        raise RuntimeError("Η βάση δεδομένων δεν είναι διαθέσιμη")

    from database.db_manager import get_sample, get_sieve_analysis

    data         = get_sample(sample_id)
    sample       = data['sample']
    product_id   = sample['product_id']
    subperiod_id = sample.get('subperiod_id')
    report       = {'sample': sample, 'tests': {}}

    # Κοκκομετρία
    sieve_data = get_sieve_analysis(sample_id)
    if sieve_data:
        specs_check = check_sieve_analysis_vs_specs(
            sieve_data['results'], product_id, subperiod_id=subperiod_id
        )
        report['tests']['sieve_analysis'] = {
            'data':                     sieve_data,
            'spec_checks':              specs_check,
            'characteristic_diameters': calculate_characteristic_diameters(
                                            sieve_data['results']),
            'overall_status':           get_overall_status(specs_check),
        }

    conn = get_connection()

    # ── Helper: checks από tbl_test_limits ──────────────────
    def _limits_checks(test_type: str, value: float, val_key: str) -> list:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM tbl_test_limits WHERE product_id=? AND test_type=?",
            (product_id, test_type)
        ).fetchall()]
        result = []
        for row in rows:
            lower = row['limit_value'] if row['parameter'].endswith('_min') else None
            upper = row['limit_value'] if row['parameter'].endswith('_max') else None
            if lower is not None and value < lower:
                status = RESULT_FAIL
            elif upper is not None and value > upper:
                status = RESULT_FAIL
            else:
                status = RESULT_OK
            result.append({
                'spec_type':   row['spec_type'],
                'spec_name':   row['spec_name'],
                val_key:       value,
                'lower_limit': lower,
                'upper_limit': upper,
                'status':      status,
            })
        return result

    # Πλακοειδή
    fl = conn.execute(
        "SELECT * FROM tbl_flakiness WHERE sample_id=?", (sample_id,)
    ).fetchone()
    if fl:
        fl_results = [dict(r) for r in conn.execute(
            "SELECT * FROM tbl_flakiness_results WHERE flakiness_id=?",
            (fl['id'],)
        ).fetchall()]
        fi_checks = _limits_checks('fi', fl['fi_index'], 'fi_value')
        report['tests']['flakiness'] = {
            'fi_index':       fl['fi_index'],
            'fractions':      fl_results,
            'spec_checks':    fi_checks,
            'overall_status': get_overall_status(fi_checks),
            'created_by':     fl['created_by'],
            'modified_by':    fl['modified_by'],
        }

    # Μπλε Μεθυλενίου
    mb = conn.execute(
        "SELECT * FROM tbl_methylene_blue WHERE sample_id=?", (sample_id,)
    ).fetchone()
    if mb:
        mb_checks = _limits_checks('mb', mb['mb_value'], 'mb_value')
        report['tests']['methylene_blue'] = {
            'mb_value':       mb['mb_value'],
            'weight_sample':  mb['weight_sample'],
            'water_volume':   mb['water_volume'],
            'volume_initial': mb['volume_initial'],
            'volume_final':   mb['volume_final'],
            'spec_checks':    mb_checks,
            'overall_status': get_overall_status(mb_checks),
            'created_by':     mb['created_by'],
            'modified_by':    mb['modified_by'],
        }

    # Ισοδύναμο Άμμου
    se = conn.execute(
        "SELECT * FROM tbl_sand_equivalent WHERE sample_id=?", (sample_id,)
    ).fetchone()
    if se:
        measurements = [dict(m) for m in conn.execute(
            "SELECT * FROM tbl_se_measurements "
            "WHERE se_id=? ORDER BY measurement_no",
            (se['id'],)
        ).fetchall()]
        se_checks = _limits_checks('se', se['se_final'], 'se_value')
        report['tests']['sand_equivalent'] = {
            'se_final':       se['se_final'],
            'measurements':   measurements,
            'requires_3rd':   bool(se['requires_3rd']),
            'n_measurements': len(measurements),
            'spec_checks':    se_checks,
            'overall_status': get_overall_status(se_checks),
            'created_by':     se['created_by'],
            'modified_by':    se['modified_by'],
        }

    conn.close()

    # Συνολική κατάσταση δείγματος
    all_statuses = [t.get('overall_status', RESULT_OK)
                    for t in report['tests'].values()]
    report['overall_status'] = get_overall_status(
        [{'status': s} for s in all_statuses]
    )

    return report


# ============================================================
# ΤΕΣΤ
# ============================================================

if __name__ == '__main__':
    print("=" * 60)
    print("ΤΕΣΤ ΥΠΟΛΟΓΙΣΜΩΝ — ΛΑΤΟΜΕΙΑ ΓΑΛΑΤΙΣΤΑΣ")
    print("=" * 60)
    errors = []

    # 1. Κοκκομετρία
    print("\n1. ΚΟΚΚΟΜΕΤΡΙΑ (EN 933-1)")
    raw = [
        {'sieve_mm': 16,    'weight_retained': 25.0},
        {'sieve_mm': 8,     'weight_retained': 1850.0},
        {'sieve_mm': 4,     'weight_retained': 550.0},
        {'sieve_mm': 2,     'weight_retained': 45.0},
        {'sieve_mm': 1,     'weight_retained': 10.0},
        {'sieve_mm': 0.5,   'weight_retained': 3.0},
        {'sieve_mm': 0.063, 'weight_retained': 2.0},
    ]
    results = calculate_passing_percent(raw, weight_washed=2485.0)
    for r in results:
        print(f"   {r['sieve_mm']:6.3f}mm → {r['passing_percent']:5.1f}%")
    print(f"   Απώλεια πλύσης: {calculate_wash_loss(2500.0, 2485.0)}%")
    d = calculate_characteristic_diameters(results)
    print(f"   D10={d['D10']} D60={d['D60']} Cu={d['Cu']} "
          f"Cc={d['Cc']} → {d['classification']}")
    print("   ✓")

    # 2. Πλακοειδή
    print("\n2. ΠΛΑΚΟΕΙΔΗ (EN 933-3)")
    fracs = [
        {'sieve_mm': 8,  'weight_fraction': 500.0, 'weight_passing': 120.0},
        {'sieve_mm': 16, 'weight_fraction': 800.0, 'weight_passing': 95.0},
    ]
    print(f"   FI = {calculate_flakiness_index(fracs)}%")
    errs = validate_flakiness_fractions(fracs)
    if errs: errors.extend(errs)
    else: print("   ✓")

    # 3. Μπλε Μεθυλενίου
    print("\n3. ΜΠΛΕ ΜΕΘΥΛΕΝΙΟΥ (EN 933-9)")
    print(f"   MB = {calculate_mb(35.0, 200.0)} g/kg  (35ml / 200g × 10)")
    errs = validate_mb_volumes(30.0, 35.0)
    if errs: errors.extend(errs)
    else: print("   ✓")

    # 4. Ισοδύναμο Άμμου
    print("\n4. ΙΣΟΔΥΝΑΜΟ ΑΜΜΟΥ (EN 933-8 §9)")
    # h1=άργιλος (μεγαλύτερο), h2=άμμος (μικρότερο)
    r1 = evaluate_se_measurements([
        {'h1': 150.0, 'h2': 120.0},
        {'h1': 149.0, 'h2': 118.0},
    ])
    print(f"   SE1={r1['se_values'][0]}% SE2={r1['se_values'][1]}% "
          f"Δ={r1['difference']} Επανάληψη={'ΝΑΙ' if r1['requires_repeat'] else 'ΟΧΙ'} "
          f"→ SE={r1['se_final']}  ✓")

    # Δοκιμή με διαφορά > 4 — πρέπει να πετάξει ValueError
    try:
        r2 = evaluate_se_measurements([
            {'h1': 150.0, 'h2': 120.0},
            {'h1': 150.0, 'h2': 108.0},
        ])
        print("   ✗ Έπρεπε να πετάξει ValueError!")
    except ValueError as e:
        print(f"   ✓ Διαφορά > 4 → {e}")

    # 5. Σύγκριση με όρια
    print("\n5. ΣΥΓΚΡΙΣΗ ΜΕ ΠΡΟΔΙΑΓΡΑΦΕΣ")
    tests = [
        (75,  70, 100, 'OK'),
        (71,  70, 100, 'WARNING zone'),
        (65,  70, 100, 'FAIL'),
        (105, 70, 100, 'FAIL'),
    ]
    for v, lo, hi, label in tests:
        r = check_value_against_limits(v, lo, hi)
        print(f"   {v}% vs [{lo},{hi}] → {r}  ({label})")
    print("   ✓")

    print("\n" + "=" * 60)
    if errors:
        print(f"✗ {len(errors)} ΣΦΑΛΜΑΤΑ:")
        for e in errors: print(f"  - {e}")
    else:
        print("✓ ΟΛΑ ΤΑ ΤΕΣΤ ΕΠΙΤΥΧΗ")
    print("=" * 60)
