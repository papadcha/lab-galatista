/**
 * i18n.js — πρώτο βήμα εξωτερίκευσης strings (βλ. TODOLIST.md).
 *
 * Πεδίο εφαρμογής ΑΥΤΟΥ του πρώτου βήματος: μόνο το στατικό markup που
 * ζει στο index.html (sidebar/titlebar/splash) — ό,τι φέρει
 * data-i18n/data-i18n-title attribute. Τα strings μέσα στα 7 page
 * scripts (dashboard.js, samples.js, ...) ΔΕΝ έχουν μεταφερθεί ακόμα σε
 * αυτό το πέρασμα· θα μεταναστεύσουν σταδιακά, σελίδα-σελίδα.
 *
 * Resource αρχεία: src/i18n/<locale>.json (σήμερα μόνο el.json).
 */

let _dict = {};
let _locale = 'el';

// Ίδιο μοτίβο με main-app.js's loadFile() — XHR αντί για fetch() για
// συμβατότητα με το file:// protocol σε packaged build.
function _loadFile(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) resolve(xhr.responseText);
      else reject(new Error(`HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send();
  });
}

export async function initI18n(locale = 'el') {
  _locale = locale;
  try {
    const text = await _loadFile(`i18n/${locale}.json`);
    _dict = JSON.parse(text);
  } catch (e) {
    console.error('[i18n] Αποτυχία φόρτωσης locale:', locale, e.message);
    _dict = {};
  }
  applyI18n(document);
  return _dict;
}

export function t(key, fallback) {
  return _dict[key] ?? fallback ?? key;
}

export function currentLocale() {
  return _locale;
}

/**
 * Εφαρμόζει τις μεταφράσεις σε ένα υποδέντρο του DOM (default: ολόκληρο
 * το document). Καλείται ξανά μετά από κάθε δυναμική αλλαγή markup που
 * ενδέχεται να φέρει νέα data-i18n στοιχεία (π.χ. re-render sidebar).
 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key, el.textContent);
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key, el.title);
  });
}
