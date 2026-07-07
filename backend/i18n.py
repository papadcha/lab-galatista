"""
Python-side i18n loader — διαβάζει το ίδιο bundled src/i18n/el.json
που χρησιμοποιεί το frontend (src/i18n/i18n.js), μία πηγή αλήθειας
αντί για ξεχωριστό Python dict (απόφαση 2026-07-07, βλ. TODOLIST.md).

Flat dict ίδιας μορφής με το JS ('namespace.key' -> 'τιμή'). Ίδιο API
με το JS t(key, fallback): επιστρέφει το fallback αν το key λείπει ή
αν το ίδιο το αρχείο δεν φορτώθηκε (π.χ. ξεχασμένο spec entry —
πιάνεται ήδη build-time από scripts/check-spec-datas.js, αλλά κρατάμε
fallback εδώ ώστε ένα ξεχασμένο key να μην ρίξει ποτέ το PDF).
"""
import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_EL_JSON_PATH = os.path.join(getattr(sys, '_MEIPASS', _ROOT), 'src', 'i18n', 'el.json')

_dict = None


def _load():
    global _dict
    if _dict is not None:
        return _dict
    try:
        with open(_EL_JSON_PATH, encoding='utf-8') as f:
            _dict = json.load(f)
    except Exception:
        _dict = {}
    return _dict


def t(key: str, fallback: str = '') -> str:
    return _load().get(key, fallback)
