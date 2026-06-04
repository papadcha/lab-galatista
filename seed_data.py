"""
seed_data.py — Εισαγωγή δοκιμαστικών δεδομένων

Δημιουργεί:
  - 15 δείγματα ΑΜΜΟΣ 0/4 (τελευταίοι 3 μήνες)
  - 8 δείγματα ΓΑΡΜΠΙΛΙ 4/16
  - 5 δείγματα 3Α 0/31.5 (ALL_IN)
  
Για κάθε δείγμα:
  - Κοκκομετρία (με ρεαλιστικές τιμές)
  - MB για ΑΜΜΟΣ/3Α
  - SE για ΑΜΜΟΣ/3Α
  - Πλακοειδή για ΓΑΡΜΠΙΛΙ/3Α

Εκτέλεση:
  cd ~/lab-galatista
  python3 seed_data.py
"""

import sys
import os
import random
import sqlite3
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'database'))
from db_manager import (
    get_connection, generate_sample_code, create_sample_with_rename,
    initialize_required_tests_default,
    save_sieve_analysis, save_methylene_blue,
    save_sand_equivalent, save_flakiness,
)

random.seed(42)  # Σταθερό seed για αναπαράγωγα αποτελέσματα


def random_date(days_back=90):
    """Τυχαία ημερομηνία μέσα στους τελευταίους N μέρες."""
    delta = random.randint(0, days_back)
    return (datetime.now() - timedelta(days=delta)).strftime('%Y-%m-%d')


# ============================================================
# ΚΟΚΚΟΜΕΤΡΙΑ — Ρεαλιστικά βάρη ανά προϊόν
# ============================================================

def make_sieve_results_ammos(variation=0.05):
    """
    ΑΜΜΟΣ 0/4 — τυπικές κοκκομετρικές τιμές.
    Βασική κατανομή: coarser sand, mostly passing 0.5-2mm.
    """
    base = {
        4.0:   {'retained': 0,   'passing': 98},
        2.0:   {'retained': 30,  'passing': 94},
        1.0:   {'retained': 80,  'passing': 86},
        0.5:   {'retained': 160, 'passing': 70},
        0.25:  {'retained': 250, 'passing': 45},
        0.125: {'retained': 180, 'passing': 27},
        0.063: {'retained': 120, 'passing': 15},
    }
    # Προσθήκη τυχαίας παραλλαγής
    results = []
    for sieve_mm, vals in base.items():
        variation_factor = 1 + random.uniform(-variation, variation)
        retained = max(0, vals['retained'] * variation_factor)
        results.append({
            'sieve_mm':        sieve_mm,
            'weight_retained': round(retained, 1),
        })
    # Τυφλό (pan) — sieve_mm=0
    results.append({'sieve_mm': 0, 'weight_retained': round(random.uniform(8, 18), 1)})
    return results


def make_sieve_results_garmpili(variation=0.05):
    """ΓΑΡΜΠΙΛΙ 4/16 — χονδρόκοκκο, κυρίαρχα 4-16mm."""
    base = {
        16.0:  {'retained': 5,   'passing': 99},
        8.0:   {'retained': 120, 'passing': 75},
        4.0:   {'retained': 580, 'passing': 18},
        2.0:   {'retained': 80,  'passing': 2},
        1.0:   {'retained': 10,  'passing': 0},
        0.5:   {'retained': 3,   'passing': 0},
        0.063: {'retained': 2,   'passing': 0},
    }
    results = []
    for sieve_mm, vals in base.items():
        vf = 1 + random.uniform(-variation, variation)
        retained = max(0, vals['retained'] * vf)
        results.append({'sieve_mm': sieve_mm, 'weight_retained': round(retained, 1)})
    # Τυφλό (pan) — sieve_mm=0
    results.append({'sieve_mm': 0, 'weight_retained': round(random.uniform(3, 8), 1)})
    return results


def make_sieve_results_3a(variation=0.07):
    """3Α 0/31.5 — all-in, συνεχής κατανομή."""
    base = {
        31.5:  {'retained': 0,   'passing': 100},
        16.0:  {'retained': 80,  'passing': 88},
        8.0:   {'retained': 120, 'passing': 72},
        4.0:   {'retained': 200, 'passing': 50},
        2.0:   {'retained': 180, 'passing': 32},
        0.5:   {'retained': 150, 'passing': 18},
        0.063: {'retained': 70,  'passing': 7},
    }
    # Κόσκινα 3Α
    conn = get_connection()
    sieves = [r[0] for r in conn.execute(
        "SELECT sieve_mm FROM tbl_product_sieves WHERE product_id=4 ORDER BY sieve_order"
    ).fetchall()]
    conn.close()

    results = []
    for sieve_mm in sieves:
        if sieve_mm == 0:
            continue  # το pan το προσθέτουμε χειροκίνητα παρακάτω
        if sieve_mm in base:
            vf = 1 + random.uniform(-variation, variation)
            retained = max(0, base[sieve_mm]['retained'] * vf)
        else:
            retained = random.uniform(0, 20)
        results.append({'sieve_mm': sieve_mm, 'weight_retained': round(retained, 1)})
    # Τυφλό (pan) — sieve_mm=0
    results.append({'sieve_mm': 0, 'weight_retained': round(random.uniform(10, 25), 1)})
    return results


# ============================================================
# SEED
# ============================================================

def seed():
    print("=" * 50)
    print("SEED DATA — Εισαγωγή δοκιμαστικών δεδομένων")
    print("=" * 50)

    # ── ΑΜΜΟΣ 0/4 (product_id=1, ΛΕΠΤΟΚΟΚΚΟ) ─────────────
    print("\n📦 ΑΜΜΟΣ 0/4 — 15 δείγματα...")
    for i in range(15):
        date  = random_date(90)
        code_info = generate_sample_code(1, 1)
        sid = create_sample_with_rename(
            code_info, date, 1, None,
            random.choice(['Σωρός Α', 'Σωρός Β', 'Σωρός Γ']),
            f"2026-{random.randint(1,12):02d}-{random.randint(1,30):02d}",
            None, 1
        )
        initialize_required_tests_default(sid, 1)

        # Κοκκομετρία
        w_initial = round(random.uniform(980, 1020), 1)
        w_dry     = round(w_initial - random.uniform(2, 8), 1)
        w_washed  = round(w_dry - random.uniform(5, 25), 1)
        sieve_res = make_sieve_results_ammos()
        save_sieve_analysis(sid, date, w_initial, w_dry, w_washed, sieve_res)

        # MB
        mb_weight = 200.0
        mb_v_final = round(random.uniform(25, 45), 1)
        save_methylene_blue(sid, date, mb_weight, 500, 0, mb_v_final)

        # SE — 2 μετρήσεις (συχνά κοντά στο 75-85%)
        h1_base = random.uniform(140, 160)  # h1=άργιλος > h2=άμμος
        h2_base = random.uniform(110, 130)  # h2=άμμος < h1
        m1 = {'h1': round(h1_base, 1), 'h2': round(h2_base, 1)}
        m2 = {'h1': round(h1_base + random.uniform(-3, 3), 1),
              'h2': round(h2_base + random.uniform(-3, 3), 1)}
        save_sand_equivalent(sid, date, [m1, m2])

        print(f"  ✓ {code_info['code']} (id={sid})")

    # ── ΓΑΡΜΠΙΛΙ 4/16 (product_id=2, ΧΟΝΔΡΟΚΟΚΚΟ) ────────
    print("\n📦 ΓΑΡΜΠΙΛΙ 4/16 — 8 δείγματα...")
    for i in range(8):
        date      = random_date(90)
        code_info = generate_sample_code(1, 2)
        sid = create_sample_with_rename(
            code_info, date, 2, None,
            random.choice(['Σωρός Α', 'Σωρός Δ']),
            f"2026-{random.randint(1,12):02d}-{random.randint(1,30):02d}",
            None, 1
        )
        initialize_required_tests_default(sid, 2)

        # Κοκκομετρία
        w_initial = round(random.uniform(1480, 1520), 1)
        w_dry     = round(w_initial - random.uniform(1, 3), 1)
        w_washed  = round(w_dry - random.uniform(3, 10), 1)
        sieve_res = make_sieve_results_garmpili()
        save_sieve_analysis(sid, date, w_initial, w_dry, w_washed, sieve_res)

        # Πλακοειδή
        fractions = [
            {'sieve_mm': 16.0, 'weight_fraction': round(random.uniform(180,220),1),
             'weight_passing': round(random.uniform(15,30),1)},
            {'sieve_mm': 8.0,  'weight_fraction': round(random.uniform(350,420),1),
             'weight_passing': round(random.uniform(40,70),1)},
            {'sieve_mm': 4.0,  'weight_fraction': round(random.uniform(150,200),1),
             'weight_passing': round(random.uniform(10,25),1)},
        ]
        save_flakiness(sid, date, fractions)
        print(f"  ✓ {code_info['code']} (id={sid})")

    # ── 3Α 0/31.5 (product_id=4, ALL_IN) ─────────────────
    print("\n📦 3Α 0/31.5 — 5 δείγματα...")
    for i in range(5):
        date      = random_date(60)
        code_info = generate_sample_code(1, 4)
        sid = create_sample_with_rename(
            code_info, date, 4, None,
            'Σωρός Ε',
            f"2026-{random.randint(1,12):02d}-{random.randint(1,30):02d}",
            None, 1
        )
        initialize_required_tests_default(sid, 4)

        # Κοκκομετρία
        w_initial = round(random.uniform(1980, 2020), 1)
        w_dry     = round(w_initial - random.uniform(2, 8), 1)
        w_washed  = round(w_dry - random.uniform(10, 30), 1)
        sieve_res = make_sieve_results_3a()
        save_sieve_analysis(sid, date, w_initial, w_dry, w_washed, sieve_res)

        # Πλακοειδή
        fractions = [
            {'sieve_mm': 31.5, 'weight_fraction': round(random.uniform(100,150),1),
             'weight_passing': round(random.uniform(15,35),1)},
            {'sieve_mm': 16.0, 'weight_fraction': round(random.uniform(300,400),1),
             'weight_passing': round(random.uniform(40,80),1)},
            {'sieve_mm': 8.0,  'weight_fraction': round(random.uniform(250,350),1),
             'weight_passing': round(random.uniform(30,60),1)},
        ]
        save_flakiness(sid, date, fractions)

        # MB
        mb_v_final = round(random.uniform(15, 35), 1)
        save_methylene_blue(sid, date, 200, 500, 0, mb_v_final)

        # SE
        h1_base = random.uniform(130, 150)  # h1=άργιλος > h2=άμμος
        h2_base = random.uniform(100, 120)  # h2=άμμος < h1
        m1 = {'h1': round(h1_base, 1), 'h2': round(h2_base, 1)}
        m2 = {'h1': round(h1_base + random.uniform(-4,4), 1),
              'h2': round(h2_base + random.uniform(-4,4), 1)}
        save_sand_equivalent(sid, date, [m1, m2])

        print(f"  ✓ {code_info['code']} (id={sid})")

    # ── ΕΠΑΛΗΘΕΥΣΗ ─────────────────────────────────────────
    conn = get_connection()
    total   = conn.execute("SELECT COUNT(*) FROM tbl_samples").fetchone()[0]
    sieves  = conn.execute("SELECT COUNT(*) FROM tbl_sieve_analysis").fetchone()[0]
    mb_rows = conn.execute("SELECT COUNT(*) FROM tbl_methylene_blue").fetchone()[0]
    se_rows = conn.execute("SELECT COUNT(*) FROM tbl_sand_equivalent").fetchone()[0]
    fl_rows = conn.execute("SELECT COUNT(*) FROM tbl_flakiness").fetchone()[0]
    conn.close()

    print("\n" + "=" * 50)
    print(f"✓ Σύνολο δειγμάτων:   {total}")
    print(f"  Κοκκομετρίες:       {sieves}")
    print(f"  MB:                 {mb_rows}")
    print(f"  SE:                 {se_rows}")
    print(f"  Πλακοειδή:          {fl_rows}")
    print("=" * 50)
    print("\nΕκτέλεση ολοκληρώθηκε ✓")
    print("Κλείσε και ξανάνοιξε την εφαρμογή για να δεις τα δείγματα.")


if __name__ == '__main__':
    seed()
