/**
 * main-app.js
 * Εργαστήριο Λατομείων Γαλάτιστας
 * ─────────────────────────────────────────────────────────────
 * Έκδοση : 0.99.4
 * Ημ/νία  : 2026-06-02
 * ─────────────────────────────────────────────────────────────
 * Ιστορικό:
 *   0.99.4 — Setup wizard + init banner
 *   0.99.3 — CE expiry sidebar badge + toast
 *   0.99.2 — Sidebar CE badge από tbl_ce_periods
 *   0.99.0 — Προσθήκη επικεφαλίδας έκδοσης
 * ─────────────────────────────────────────────────────────────
 * Ιστορικό:
 *   0.99.3 — CE expiry sidebar badge + toast notification
 *   0.99.2 — Sidebar CE badge από tbl_ce_periods + date format
 *   0.99.0 — Προσθήκη επικεφαλίδας έκδοσης
 */
'use strict';

// ============================================================
// GLOBAL STATE — Κοινά δεδομένα για όλες τις σελίδες
// ============================================================

const AppState = {
  archiveMode:   false,
  archivePeriod: null,
  products:     [],   // Φορτώνεται μία φορά στην εκκίνηση
  technicians:  [],   // Φορτώνεται μία φορά στην εκκίνηση
  currentPage:  null, // Τρέχουσα σελίδα
  labInfo:      null, // Στοιχεία εργαστηρίου (CE κλπ)
  testRegistry: null, // Metadata δοκιμών (label, allowed_categories κλπ)
};

// ============================================================
// PYTHON BRIDGE
// ============================================================

/**
 * Generic Python call.
 *
 * Πρώτα ψάχνει για specific wrapper στο pyBridge (παλιό API).
 * Αν δεν υπάρχει, καλεί το generic `pyBridge.call(method, ...args)`.
 * Έτσι νέες Python methods δουλεύουν χωρίς να χρειάζεται να
 * προστεθούν στο preload.js.
 *
 * Επιστρέφει null σε σφάλμα, εκτός αν δοθεί `{ throwOnError: true }`.
 */
async function pyCall(method, ...args) {
  try {
    let res;
    if (typeof window.pyBridge?.[method] === 'function') {
      res = await window.pyBridge[method](...args);
    } else if (typeof window.pyBridge?.call === 'function') {
      res = await window.pyBridge.call(method, ...args);
    } else {
      console.error(`[pyCall] Δεν υπάρχει pyBridge ή method "${method}"`);
      return null;
    }
    if (res && typeof res === 'object' && res.error) {
      console.error(`[pyCall] ${method}:`, res.error);
      return null;
    }
    // Ξετύλιγμα {result: ...}
    if (res && typeof res === 'object' && 'result' in res) return res.result ?? null;
    return res ?? null;
  } catch (e) {
    console.error(`[pyCall] ${method}:`, e.message);
    return null;
  }
}

/**
 * Όπως pyCall αλλά πετάει exception αντί να επιστρέφει null.
 * Χρήσιμο για να εμφανιστεί error message στον χρήστη.
 */
async function pyCallStrict(method, ...args) {
  let res;
  if (typeof window.pyBridge?.[method] === 'function') {
    res = await window.pyBridge[method](...args);
  } else if (typeof window.pyBridge?.call === 'function') {
    res = await window.pyBridge.call(method, ...args);
  } else {
    throw new Error(`Δεν υπάρχει pyBridge ή method "${method}"`);
  }
  if (res && typeof res === 'object' && res.error) {
    throw new Error(res.error);   // → catch(e) στον caller → App.toast
  }
  if (res && typeof res === 'object' && 'result' in res) return res.result ?? null;
  return res ?? null;
}

// ============================================================
// ΠΛΟΗΓΗΣΗ
// ============================================================

const Pages = {
  dashboard: { html: 'pages/dashboard/dashboard.html', js: 'pages/dashboard/dashboard.js' },
  samples:   { html: 'pages/samples/samples.html',     js: 'pages/samples/samples.js'     },
  tests:     { html: 'pages/tests/tests.html',         js: 'pages/tests/tests.js'         },
  history:   { html: 'pages/history/history.html',     js: 'pages/history/history.js'     },
  reports:   { html: 'pages/reports/reports.html',     js: 'pages/reports/reports.js'     },
  library:   { html: 'pages/library/library.html',     js: 'pages/library/library.js'     },
  settings:  { html: 'pages/settings/settings.html',   js: 'pages/settings/settings.js'   },
};

async function navigateTo(pageId) {
  if (!Pages[pageId]) return;

  // Ενημέρωση sidebar
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${pageId}"]`)?.classList.add('active');

  AppState.currentPage = pageId;

  // Φόρτωση HTML σελίδας μέσω XMLHttpRequest (δουλεύει με file://)
  try {
    const html = await loadFile(Pages[pageId].html);
    document.getElementById('page-container').innerHTML = html;
  } catch(e) {
    document.getElementById('page-container').innerHTML =
      `<div class="page-error">Σφάλμα φόρτωσης: ${pageId} — ${e.message}</div>`;
    return;
  }

  // Αφαίρεση παλιού script
  const oldScript = document.getElementById('page-script');
  if (oldScript) oldScript.remove();

  // Φόρτωση JS περιεχομένου και εκτέλεση ως inline script
  try {
    const jsContent = await loadFile(Pages[pageId].js);

    // Αναμονή για DOM render
    await new Promise(r => setTimeout(r, 50));

    // Wrap σε IIFE + delete window property για καθαρό re-init
    // Αυτό αποφεύγει "already declared" για window.X variables
    const oldContainer = document.getElementById('page-script-container');
    if (oldContainer) oldContainer.remove();

    // Καθαρισμός παλιών page globals
    ['Dashboard','SamplesPage','HistoryPage','ReportsPage','SettingsPage','TestsPage']
      .forEach(k => { if (window[k]) delete window[k]; });

    const container = document.createElement('div');
    container.id    = 'page-script-container';
    document.body.appendChild(container);

    const script       = document.createElement('script');
    script.id          = 'page-script';
    script.textContent = jsContent;
    container.appendChild(script);
    console.log('[NAV] Script loaded:', Pages[pageId].js);
  } catch(e) {
    console.error('[NAV] Script error:', e.message);
  }
}

// Φόρτωση αρχείου συμβατή με file:// protocol
function loadFile(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send();
  });
}

// ============================================================
// GLOBAL UTILITIES — Διαθέσιμα σε όλες τις σελίδες
// ============================================================

const App = {

  // --- Toast notifications ---
  toast(message, type = 'ok') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    // Errors και warnings μένουν περισσότερο
    const duration = (type === 'fail' || type === 'warn') ? 7000 : 3500;
    setTimeout(() => el.remove(), duration);
  },

  // --- Modal ---
  showModal(title, content, buttons = []) {
    document.getElementById('modal-title').textContent   = title;
    document.getElementById('modal-content').innerHTML   = content;
    document.getElementById('modal-actions').innerHTML   = buttons.map(b => `
      <button class="${b.secondary ? 'btn-secondary' : 'btn-primary'}"
              onclick="${b.action}">${b.label}</button>
    `).join('');
    document.getElementById('modal-overlay').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-content').innerHTML = '';
    document.getElementById('modal-actions').innerHTML = '';
  },

  // --- Confirm dialog ---
  confirm(title, message, onConfirm) {
    App.showModal(title, `<p style="color:var(--text-muted);margin:8px 0;">${message}</p>`, [
      { label: 'Ακύρωση',      action: 'App.closeModal()', secondary: true },
      { label: 'Επιβεβαίωση', action: `App.closeModal();(${onConfirm.toString()})()` },
    ]);
  },

  // --- Format helpers ---
  formatDate(dateStr) {
    if (!dateStr) return '—';
    // Αν είναι yyyy-mm-dd → dd/mm/yyyy
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    // Αλλιώς as-is
    return dateStr;
  },

  // Smart format για παρτίδα: yyyy-mm-dd → dd/mm/yyyy, αλλιώς as-is
  formatBatch(val) {
    if (!val) return '—';
    const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return val;
  },

  formatCode(code) {
    return `<span class="sample-code">${code}</span>`;
  },

  // --- Status badge ---
  statusBadge(status) {
    const map = {
      'OK':      '<span class="badge badge-ok">✓ Εντός</span>',
      'WARNING': '<span class="badge badge-warn">⚠ Οριακό</span>',
      'FAIL':    '<span class="badge badge-fail">✗ Εκτός</span>',
    };
    return map[status] ?? '<span class="badge badge-none">—</span>';
  },

  // --- Μορφοποίηση ονόματος προϊόντος με διαβάθμιση ---
  formatProduct(s) {
    const name = s.product_name || '';
    const dmin = s.d_min != null ? (Number.isInteger(s.d_min) ? s.d_min : parseFloat(s.d_min.toFixed(1))) : null;
    const dmax = s.d_max != null ? (Number.isInteger(s.d_max) ? s.d_max : parseFloat(s.d_max.toFixed(1))) : null;
    if (dmin != null && dmax != null) return `${name} ${dmin}/${dmax}`;
    return name;
  },

  // --- Test badges για πίνακα ---
  testBadges(sample) {
    const cat      = sample.category;
    const isFine   = cat === 'ΛΕΠΤΟΚΟΚΚΟ';
    const isCoarse = cat === 'ΧΟΝΔΡΟΚΟΚΚΟ';
    const isAllIn  = cat === 'ALL_IN';
    const tests = [
      { key: 'has_sieve',     label: 'ΚΚΜ', show: true                    },
      { key: 'has_flakiness', label: 'ΠΛΚ', show: isCoarse || isAllIn     },
      { key: 'has_se',        label: 'SE',  show: isFine   || isAllIn     },
      { key: 'has_mb',        label: 'MB',  show: isFine   || isAllIn     },
    ];
    return tests
      .filter(t => t.show)
      .map(t =>
        sample[t.key]
          ? `<span class="badge badge-ok">${t.label}</span>`
          : `<span class="badge badge-none">${t.label}</span>`
      ).join(' ');
  },

  // --- Pending tests για δείγμα ---
  // ΣΗΜ: Διατηρεί την παλιά κατηγορία-based λογική για συμβατότητα.
  //       Όταν ο dashboard.js αναβαθμιστεί ώστε να φέρνει το πλάνο
  //       με κάθε δείγμα, αυτή η συνάρτηση θα δέχεται προαιρετικά
  //       το πλάνο και θα το χρησιμοποιεί κατά προτεραιότητα.
  pendingTests(sample) {
    // Βασίζεται στο tbl_required_tests (required_tests = comma-separated string)
    const required = sample.required_tests
      ? sample.required_tests.split(',').map(t => t.trim())
      : [];

    const labels = {
      sieve:     'Κοκκομετρία',
      flakiness: 'Πλακοειδή',
      mb:        'Μπλε Μεθυλενίου',
      se:        'Ισοδύναμο Άμμου',
    };

    const hasMap = {
      sieve:     sample.has_sieve,
      flakiness: sample.has_flakiness,
      mb:        sample.has_mb,
      se:        sample.has_se,
    };

    return required
      .filter(t => !hasMap[t])
      .map(t => labels[t] || t);
  },

  // ============================================================
  // ΝΕΑ HELPERS v1.1 — Test Registry & required_tests
  // ============================================================

  /**
   * Επιστρέφει την Ελληνική ονομασία μιας δοκιμής από το registry.
   * πχ App.testLabel('sieve') → 'Κοκκομετρική Ανάλυση'
   * Fallback στο test_type αν το registry δεν έχει φορτωθεί.
   */
  testLabel(testType) {
    return AppState.testRegistry?.[testType]?.label ?? testType;
  },

  /**
   * Επιστρέφει το πρότυπο μιας δοκιμής.
   * πχ App.testStandard('sieve') → 'EN 933-1'
   */
  testStandard(testType) {
    return AppState.testRegistry?.[testType]?.standard ?? '';
  },

  /**
   * Σύντομος ελληνικός κωδικός δοκιμής για badges.
   */
  testShortCode(testType) {
    return ({ sieve: 'ΚΚΜ', flakiness: 'ΠΛΚ', mb: 'MB', se: 'SE' })[testType]
      ?? testType.toUpperCase();
  },

  /**
   * Επιτρέπεται μια δοκιμή για συγκεκριμένη κατηγορία;
   * Local check χωρίς round-trip στο Python.
   */
  isTestAllowed(testType, category) {
    const meta = AppState.testRegistry?.[testType];
    return Boolean(meta?.allowed_categories?.includes(category));
  },

  /**
   * Επιστρέφει τις επιτρεπόμενες δοκιμές για κατηγορία (local).
   */
  allowedTestsFor(category) {
    if (!AppState.testRegistry) return [];
    return Object.keys(AppState.testRegistry).filter(tt =>
      AppState.testRegistry[tt].allowed_categories.includes(category)
    );
  },

  // --- Navigate από οποιαδήποτε σελίδα ---
  go(pageId) {
    navigateTo(pageId);
  },
};

// Κάνε το App global
// Helper: CSS class για κατηγορία αδρανούς
App.catBadgeClass = function(category) {
  if (!category) return 'badge-none';
  const cat = category.toUpperCase();
  if (cat === 'ΛΕΠΤΟΚΟΚΚΟ') return 'badge-cat-fine';
  if (cat === 'ΧΟΝΔΡΟΚΟΚΚΟ') return 'badge-cat-coarse';
  if (cat === 'ALL_IN')      return 'badge-cat-allin';
  return 'badge-none';

};

window.App        = App;
window.pyCall     = pyCall;
window.pyCallStrict = pyCallStrict;
window.AppState   = AppState;

// Wizard functions — exposed μετά το App
// ── Archive Mode ─────────────────────────────────────────────

function _updateSidebarArchiveBanner(period) {
  const banner = document.getElementById('sidebar-archive-banner');
  const ceEl   = document.getElementById('archive-banner-ce');
  if (!banner) return;
  if (period) {
    if (ceEl) ceEl.textContent = period.ce_number +
      ' (' + _formatCeDate(period.valid_from) + ' – ' + _formatCeDate(period.valid_to) + ')';
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

async function enterArchiveMode(period) {
  if (!period?.data_folder) {
    App.toast('Δεν βρέθηκε φάκελος για αυτή την περίοδο', 'fail'); return;
  }
  // Confirmation modal
  App.showModal(
    '🗄 Είσοδος σε Archive Mode',
    '<div style="font-size:13px;">' +
    '<div style="background:rgba(180,83,9,.12);border:1px solid rgba(180,83,9,.4);' +
    'border-radius:8px;padding:12px;margin-bottom:12px;">' +
    '<strong style="color:#b45309;">Προσοχή</strong><br>' +
    'Θα μεταβείτε στην περίοδο <strong>' + _esc(period.ce_number) + '</strong>' +
    ' (' + _formatCeDate(period.valid_from) + ' – ' + _formatCeDate(period.valid_to) + ').<br>' +
    'Οι αλλαγές αφορούν <em>αποκλειστικά</em> εκείνη την περίοδο.</div>' +
    'Ένα έντονο banner στο sidebar θα σας υπενθυμίζει ότι είστε σε Archive Mode.</div>',
    [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '🗄 Είσοδος', action: 'App._doEnterArchiveMode()' },
    ]
  );
  window._archivePendingPeriod = period;
}

async function _doEnterArchiveMode() {
  App.closeModal();
  const period = window._archivePendingPeriod;
  if (!period) return;
  App.toast('Σύνδεση με archive DB...', 'info');
  const result = await window.pyBridge?.['switch-to-archive']?.({
    dataFolder: period.data_folder,
    periodId:   period.id,
  });
  if (!result?.ok) {
    App.toast('Σφάλμα: ' + (result?.error || 'Άγνωστο'), 'fail'); return;
  }
  AppState.archiveMode   = true;
  AppState.archivePeriod = period;
  _updateSidebarArchiveBanner(period);
  await updateSidebarCeBadge();
  App.toast('Archive mode: ' + period.ce_number, 'warn');
  navigateTo('samples');
}

async function exitArchiveMode() {
  App.showModal(
    'Έξοδος από Archive Mode',
    '<div style="font-size:13px;">Επιστροφή στην τρέχουσα περίοδο.<br>' +
    'Βεβαιωθείτε ότι ολοκληρώσατε ό,τι χρειαζόταν.</div>',
    [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '↩ Επιστροφή', action: 'App._doExitArchiveMode()' },
    ]
  );
}

async function _doExitArchiveMode() {
  App.closeModal();
  const result = await window.pyBridge?.['restore-from-archive']?.();
  if (!result?.ok) {
    App.toast('Σφάλμα επιστροφής: ' + (result?.error || ''), 'fail'); return;
  }
  AppState.archiveMode   = false;
  AppState.archivePeriod = null;
  _updateSidebarArchiveBanner(null);
  await updateSidebarCeBadge();
  App.toast('Επιστροφή στην τρέχουσα περίοδο', 'ok');
  navigateTo('dashboard');
}

App.showSetupWizard       = showSetupWizard;
App._wizardNext           = _wizardNext;
App._wizardBack           = _wizardBack;
App._wizardFinish         = _wizardFinish;
App._wizardSelectFolder   = _wizardSelectFolder;
App.updateSuggestedWizardFolder = updateSuggestedWizardFolder;
async function _doForceQuit() {
  App.closeModal();
  await window.pyBridge?.['force-quit']?.();
}

// Listener για κλείσιμο παραθύρου σε archive mode
window.pyBridge?.['on-archive-close-dialog']?.(() => {
  App.showModal(
    '🗄 Κλείσιμο — Archive Mode ενεργό',
    '<div style="font-size:13px;">' +
    '<div style="background:rgba(180,83,9,.12);border:1px solid rgba(180,83,9,.35);' +
    'border-radius:8px;padding:12px;margin-bottom:12px;color:var(--text);">' +
    'Είστε σε Archive Mode για την περίοδο <strong>' +
    _esc(AppState.archivePeriod?.ce_number || '') + '</strong>.<br><br>' +
    'Κατά το κλείσιμο η εφαρμογή επιστρέφει αυτόματα στην τρέχουσα περίοδο.</div>' +
    '</div>',
    [
      { label: 'Ακύρωση',   action: 'App.closeModal()',    secondary: true },
      { label: '✕ Κλείσιμο', action: 'App._doForceQuit()' },
    ]
  );
});

// Standards check — μοιραζόμενο μεταξύ sidebar badge (εδώ) και library.js banner/badges
let _standardsCache = null;
async function fetchStandards() {
  if (_standardsCache) return _standardsCache;
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/papadcha/lab-galatista/master/standards.json'
    );
    if (resp.ok) _standardsCache = await resp.json();
  } catch(e) { /* offline or fetch error — silent */ }
  return _standardsCache || [];
}
// Επιστρέφει το matching standard entry αν το έγγραφο έχει παλιά έκδοση, αλλιώς null
function findOutdatedStandard(doc, standards) {
  const std = standards.find(s => s.code === doc.code);
  return (std && std.latest !== doc.version) ? std : null;
}
App.fetchStandards      = fetchStandards;
App.findOutdatedStandard = findOutdatedStandard;

async function checkDocumentStandards() {
  try {
    const standards = await fetchStandards();
    if (!standards.length) return;
    const docs = await pyCall('get_documents_for_standards_check') || [];
    const outdated = docs.filter(d => findOutdatedStandard(d, standards));
    const badge = document.getElementById('library-badge');
    if (badge) {
      badge.style.display = outdated.length ? 'inline' : 'none';
      badge.textContent   = outdated.length ? String(outdated.length) : '!';
    }
    return outdated;
  } catch(e) { /* offline or fetch error — silent */ }
}
App.checkDocumentStandards = checkDocumentStandards;

App.enterArchiveMode      = enterArchiveMode;
App._doEnterArchiveMode   = _doEnterArchiveMode;
App.exitArchiveMode       = exitArchiveMode;
App._doExitArchiveMode    = _doExitArchiveMode;
App._doForceQuit          = _doForceQuit;

// ============================================================
// ΑΡΧΙΚΟΠΟΙΗΣΗ
// ============================================================

// ── Sidebar CE Badge ─────────────────────────────────────────

function _formatCeDate(d) {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
    const [y, m, day] = d.substring(0, 10).split('-');
    return `${day}/${m}/${y}`;
  }
  return d;
}

async function updateSidebarCeBadge() {
  try {
    const period = await pyCall('get_active_ce_period');
    const ceEl   = document.getElementById('sidebar-ce-number');
    const expEl  = document.getElementById('sidebar-ce-expiry');
    const warnEl = document.getElementById('sidebar-ce-warn');
    if (!period || !period.ce_number) return;

    if (ceEl)  ceEl.textContent  = period.ce_number;
    if (expEl && period.valid_to)
      expEl.textContent = 'Ισχύς έως ' + _formatCeDate(period.valid_to);

    // Expiry warning badge
    if (warnEl) {
      const st = period._expiry_status;
      const dl = period._days_left;
      if (!st || st === 'ok') {
        warnEl.style.display = 'none';
      } else {
        const labels = {
          warning: `⚠ Λήγει σε ${dl} μέρες`,
          urgent:  `🔴 Λήγει σε ${dl} μέρες`,
          expired: `🔴 Έχει λήξει`,
        };
        warnEl.style.display = 'block';
        warnEl.className     = 'ce-expiry-warn ' + st;
        warnEl.textContent   = labels[st] || '';
      }
    }

    // Toast notification (με snooze)
    if (period._expiry_status && period._expiry_status !== 'ok') {
      _showCeExpiryToast(period._expiry_status, period._days_left);
    }
  } catch (e) {
    const lab = AppState.labInfo;
    if (!lab) return;
    const ceEl  = document.getElementById('sidebar-ce-number');
    const expEl = document.getElementById('sidebar-ce-expiry');
    if (ceEl && lab.ce_number)    ceEl.textContent  = lab.ce_number;
    if (expEl && lab.ce_valid_to) expEl.textContent = 'Ισχύς έως ' + _formatCeDate(lab.ce_valid_to);
  }
}

function _showCeExpiryToast(status, daysLeft) {
  // Έλεγχος snooze — το main process το ελέγχει επίσης, αλλά ελέγχουμε και εδώ
  if (document.getElementById('ce-expiry-toast')) return; // ήδη εμφανίζεται

  const icons  = { warning: '🟡', urgent: '🔴', expired: '🔴' };
  const titles = {
    warning: 'Υπενθύμιση λήξης CE',
    urgent:  'Επείγουσα υπενθύμιση CE',
    expired: 'Το πιστοποιητικό CE έχει λήξει',
  };
  const msgs = {
    warning: `Το πιστοποιητικό CE λήγει σε ${daysLeft} μέρες. Φροντίστε για την ανανέωσή του.`,
    urgent:  `Το πιστοποιητικό CE λήγει σε ${daysLeft} μέρες. Απαιτείται άμεση ενέργεια.`,
    expired: 'Το πιστοποιητικό CE έχει λήξει. Ενημερώστε τα στοιχεία στις Ρυθμίσεις.',
  };

  const toast = document.createElement('div');
  toast.id = 'ce-expiry-toast';
  toast.className = 'ce-toast';
  toast.innerHTML = `
    <div class="ce-toast-icon">${icons[status]}</div>
    <div class="ce-toast-body">
      <div class="ce-toast-title">${titles[status]}</div>
      <div class="ce-toast-msg">${msgs[status]}</div>
      <div class="ce-toast-actions">
        <button class="btn-secondary btn-sm" onclick="_snoozeCeToast()">
          Το γνωρίζω (7 μέρες)
        </button>
        <button class="btn-primary btn-sm" onclick="_dismissCeToast()">
          ✕ Κλείσιμο
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(toast);
}

function _dismissCeToast() {
  const el = document.getElementById('ce-expiry-toast');
  if (el) el.remove();
}

async function _snoozeCeToast() {
  _dismissCeToast();
  await window.pyBridge?.['ce-notify-snooze']?.(7);
}

// Listener για CE expiry notification από main process
if (window.pyBridge?.['on-ce-expiry']) {
  window.pyBridge['on-ce-expiry']((status) => {
    if (status && status.status !== 'ok') {
      _showCeExpiryToast(status.status, status.days_left);
    }
  });
}

// Listener για ασυμφωνία φακέλου δεδομένων (π.χ. μετά από restore σε άλλο
// μηχάνημα, όπου ο τοπικός φάκελος δεν ενημερώθηκε μαζί με νέα CE period)
if (window.pyBridge?.['on-data-folder-mismatch']) {
  window.pyBridge['on-data-folder-mismatch']((info) => {
    _showDataFolderMismatchToast(info);
  });
}

function _dismissDataFolderToast() {
  document.getElementById('data-folder-toast')?.remove();
}

async function _snoozeDataFolderToast() {
  _dismissDataFolderToast();
  await window.pyBridge?.['data-folder-notify-snooze']?.(7);
}

function _showDataFolderMismatchToast(info) {
  if (document.getElementById('data-folder-toast')) return;

  const warn = info.existsLocally
    ? ''
    : '<div class="ce-toast-msg" style="margin-top:4px;">⚠️ Ο φάκελος της βάσης δεν υπάρχει σε αυτό το μηχάνημα — επιλέξτε τον σωστό τοπικό φάκελο.</div>';

  const toast = document.createElement('div');
  toast.id = 'data-folder-toast';
  toast.className = 'ce-toast';
  toast.innerHTML = `
    <div class="ce-toast-icon">🟡</div>
    <div class="ce-toast-body">
      <div class="ce-toast-title">Ο φάκελος δεδομένων φαίνεται ξεπερασμένος</div>
      <div class="ce-toast-msg">Η ενεργή CE period στη βάση δείχνει διαφορετικό φάκελο δεδομένων από τον τοπικά ρυθμισμένο — τα PDF ενδέχεται να μην εμφανίζονται σωστά.</div>
      ${warn}
      <div class="ce-toast-actions">
        <button class="btn-secondary btn-sm" onclick="_snoozeDataFolderToast()">
          Το γνωρίζω (7 μέρες)
        </button>
        <button class="btn-primary btn-sm" onclick="navigateTo('settings');_dismissDataFolderToast()">
          Ρυθμίσεις →
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(toast);
}

// Listener για νέα έκδοση
if (window.pyBridge?.['on-update-available']) {
  window.pyBridge['on-update-available']((info) => {
    _showUpdateBanner(info);
  });
}

function _showUpdateBanner(info) {
  const existing = document.getElementById('update-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id        = 'update-banner';
  banner.className = 'update-banner';
  banner.innerHTML = `
    <div class="update-banner-icon">⬆</div>
    <div class="update-banner-body">
      <div class="update-banner-title">Νέα έκδοση διαθέσιμη: v${_esc(info.latest)}</div>
      <div class="update-banner-msg">Τρέχουσα: v${_esc(info.current)}</div>
    </div>
    <button class="btn-primary btn-sm" id="update-banner-btn">Λήψη</button>
    <button class="btn-secondary btn-sm" style="margin-left:4px;"
            onclick="document.getElementById('update-banner')?.remove()">✕</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('update-banner-btn')?.addEventListener('click', () => {
    window.pyBridge?.['open-update-url']?.(info.url);
  });
}

async function showVersionHistory() {
  const result = await window.pyBridge?.['get-version-history']?.();
  const content = result?.ok
    ? `<pre style="white-space:pre-wrap;font-family:inherit;font-size:0.85em;line-height:1.5;max-height:60vh;overflow-y:auto;margin:0;">${_esc(result.content)}</pre>`
    : `<p style="color:var(--text-muted);">Δεν ήταν δυνατή η φόρτωση του ιστορικού εκδόσεων.</p>`;
  App.showModal('Ιστορικό Εκδόσεων', content, [
    { label: 'Κλείσιμο', action: 'App.closeModal()' },
  ]);
}

// ============================================================
// ΑΡΧΙΚΟΠΟΙΗΣΗ — Banner + Wizard
// ============================================================

let _initStatus = null;

async function checkAndShowInitBanner() {
  _initStatus = await pyCall('get_init_status');
  if (!_initStatus || _initStatus.is_complete) {
    _removeInitBanner();
    return;
  }
  _showInitBanner(_initStatus);
}

function _removeInitBanner() {
  const el = document.getElementById('init-banner');
  if (el) el.remove();
}

function _showInitBanner(status) {
  _removeInitBanner();
  const missing = [];
  if (!status.has_lab)       missing.push('Στοιχεία εργαστηρίου');
  if (!status.has_ce_period) missing.push('CE Period');

  const banner = document.createElement('div');
  banner.id = 'init-banner';
  banner.className = 'init-banner';
  banner.innerHTML = `
    <div class="init-banner-icon">⚠</div>
    <div class="init-banner-body">
      <div class="init-banner-title">Απαιτείται αρχική ρύθμιση</div>
      <div class="init-banner-msg">Λείπει: ${missing.join(', ')}</div>
    </div>
    <button class="btn-primary btn-sm" onclick="App.showSetupWizard()">
      Ρύθμιση τώρα
    </button>
  `;

  const container = document.getElementById('page-container');
  if (container) container.insertBefore(banner, container.firstChild);
}

// ── Setup Wizard ─────────────────────────────────────────────

async function showSetupWizard() {
  const status = _initStatus || await pyCall('get_init_status');
  const lab    = await pyCall('get_lab_info') || {};

  // Καθορισμός βήματος εκκίνησης
  const startStep = !status.has_lab ? 1 : !status.has_ce_period ? 2 : 3;
  _showWizardStep(startStep, lab);
}

function _showWizardStep(step, lab = {}) {
  const steps = {
    1: _wizardStep1(lab),
    2: _wizardStep2(lab),
    3: _wizardStep3(),
  };
  const total = 3;
  const titles = {
    1: `Βήμα 1 από ${total} — Στοιχεία Εργαστηρίου`,
    2: `Βήμα 2 από ${total} — CE Period & Φάκελος`,
    3: `Βήμα 3 από ${total} — Υποπερίοδος`,
  };

  App.showModal(titles[step], steps[step], _wizardActions(step));
  if (step === 2) setTimeout(() => App.updateSuggestedWizardFolder(), 200);
}

function _wizardStep1(lab) {
  return `
    <div class="form-grid">
      <div class="form-group full-width">
        <label>Επωνυμία <span class="required">*</span></label>
        <input type="text" id="wiz-name" value="${_esc(lab.name||'')}"
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group full-width">
        <label>Διεύθυνση</label>
        <input type="text" id="wiz-address" value="${_esc(lab.address||'')}"
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group">
        <label>Τηλέφωνο</label>
        <input type="text" id="wiz-phone" value="${_esc(lab.phone||'')}"
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="text" id="wiz-email" value="${_esc(lab.email||'')}"
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group full-width">
        <label>Αριθμός Πιστοποιητικού CE <span class="required">*</span></label>
        <input type="text" id="wiz-ce-number" value="${_esc(lab.ce_number||'')}"
               placeholder="πχ 1128-CPR-0196"
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group full-width">
        <label>Φορέας Πιστοποίησης</label>
        <input type="text" id="wiz-ce-body" value="${_esc(lab.ce_body||'')}"
               placeholder="πχ EUROCERT Α.Ε."
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group">
        <label>Ισχύς Από <span class="required">*</span></label>
        <input type="date" id="wiz-ce-from"
               value="${_toIsoDate(lab.ce_valid_from||'')}"
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group">
        <label>Ισχύς Έως <span class="required">*</span></label>
        <input type="date" id="wiz-ce-to"
               value="${_toIsoDate(lab.ce_valid_to||'')}"
               style="width:100%;margin-top:4px;">
      </div>
    </div>`;
}

function _wizardStep2(lab) {
  return `
    <div class="form-grid">
      <div class="form-group full-width">
        <label>Αριθμός Πιστοποιητικού CE <span class="required">*</span></label>
        <input type="text" id="wiz-ce-number"
               value="${_esc(lab.ce_number||'')}"
               placeholder="πχ 1128-CPR-0196"
               style="width:100%;margin-top:4px;"
               oninput="App.updateSuggestedWizardFolder()">
      </div>
      <div class="form-group">
        <label>Ισχύς Από <span class="required">*</span></label>
        <input type="text" id="wiz-ce-from"
               value="${_esc(lab.ce_valid_from||'')}"
               placeholder="DD/MM/YYYY"
               style="width:100%;margin-top:4px;"
               oninput="App.updateSuggestedWizardFolder()">
      </div>
      <div class="form-group">
        <label>Ισχύς Έως <span class="required">*</span></label>
        <input type="text" id="wiz-ce-to"
               value="${_esc(lab.ce_valid_to||'')}"
               placeholder="DD/MM/YYYY"
               style="width:100%;margin-top:4px;"
               oninput="App.updateSuggestedWizardFolder()">
      </div>
      <div class="form-group full-width">
        <label>Φορέας Πιστοποίησης</label>
        <input type="text" id="wiz-ce-body"
               value="${_esc(lab.ce_body||'')}"
               placeholder="πχ EUROCERT Α.Ε."
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group full-width">
        <label>Φάκελος Δεδομένων <span class="required">*</span></label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
          <input type="text" id="wiz-folder"
                 placeholder="Προτείνεται αυτόματα από τα στοιχεία CE"
                 style="flex:1;">
          <button class="btn-secondary btn-sm"
                  onclick="App._wizardSelectFolder()">📂</button>
        </div>
        <small class="form-hint">
          Εδώ αποθηκεύονται τα PDF και τα αντίγραφα ασφαλείας.
        </small>
      </div>
    </div>`;
}

function _wizardStep3() {
  return `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">
      Προαιρετικό — μπορείτε να το συμπληρώσετε αργότερα από τις Ρυθμίσεις.
    </p>
    <div class="form-grid">
      <div class="form-group full-width">
        <label>Αριθμός Έκθεσης Εξωτερικού Εργαστηρίου</label>
        <input type="text" id="wiz-report" placeholder="πχ ΕΛΤΕΚ-2026-4471"
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group">
        <label>MB (g/kg)</label>
        <input type="number" step="0.01" id="wiz-mb"
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group">
        <label>SE (%)</label>
        <input type="number" step="0.1" id="wiz-se"
               style="width:100%;margin-top:4px;">
      </div>
      <div class="form-group">
        <label>FI (%)</label>
        <input type="number" step="0.1" id="wiz-fl"
               style="width:100%;margin-top:4px;">
      </div>
    </div>`;
}

function _wizardActions(step) {
  const actions = [];
  if (step > 1) actions.push({ label: '← Πίσω', action: `App._wizardBack(${step})`, secondary: true });
  else          actions.push({ label: 'Ακύρωση', action: 'App.closeModal()', secondary: true });
  if (step < 3) actions.push({ label: 'Επόμενο →', action: `App._wizardNext(${step})` });
  else          actions.push({ label: '✓ Ολοκλήρωση', action: 'App._wizardFinish()' });
  return actions;
}

async function _wizardNext(step) {
  if (step === 1) {
    // Αποθήκευση βήματος 1
    const name    = document.getElementById('wiz-name')?.value?.trim();
    const ceNum   = document.getElementById('wiz-ce-number')?.value?.trim();
    const ceFrom  = document.getElementById('wiz-ce-from')?.value?.trim();
    const ceTo    = document.getElementById('wiz-ce-to')?.value?.trim();
    if (!name || !ceNum || !ceFrom || !ceTo) {
      App.toast('Συμπληρώστε τα υποχρεωτικά πεδία', 'warn'); return;
    }
    await pyCall('save_lab_info', {
      name, address: document.getElementById('wiz-address')?.value||'',
      phone: document.getElementById('wiz-phone')?.value||'',
      email: document.getElementById('wiz-email')?.value||'',
      ce_number: ceNum, ce_body: document.getElementById('wiz-ce-body')?.value||'',
      ce_valid_from: ceFrom, ce_valid_to: ceTo,
    });
    _showWizardStep(2, { ce_number: ceNum, ce_valid_from: ceFrom, ce_valid_to: ceTo });
  } else if (step === 2) {
    const ceNum  = document.getElementById('wiz-ce-number')?.value?.trim();
    const ceFrom = document.getElementById('wiz-ce-from')?.value?.trim();
    const ceTo   = document.getElementById('wiz-ce-to')?.value?.trim();
    const ceBody = document.getElementById('wiz-ce-body')?.value?.trim() || '';
    const folder = document.getElementById('wiz-folder')?.value?.trim();
    if (!ceNum || !ceFrom || !ceTo) { App.toast('Συμπληρώστε τα στοιχεία CE', 'warn'); return; }
    if (!folder) { App.toast('Επιλέξτε φάκελο δεδομένων', 'warn'); return; }
    // Ενημέρωση CE στοιχείων στο tbl_laboratory αν άλλαξαν
    const lab = await pyCall('get_lab_info') || {};
    if (ceNum !== lab.ce_number || ceFrom !== lab.ce_valid_from || ceTo !== lab.ce_valid_to) {
      await pyCall('save_lab_info', {
        ...lab,
        ce_number: ceNum, ce_body: ceBody,
        ce_valid_from: ceFrom, ce_valid_to: ceTo,
      });
    }
    // Δημιουργία CE period
    const periodId = await pyCall('create_ce_period', ceNum, ceBody, ceFrom, ceTo, folder);
    if (!periodId) { App.toast('Σφάλμα δημιουργίας CE period', 'fail'); return; }
    await pyBridge['set-config']({ dataFolder: folder, activePeriodStart: ceFrom });
    await pyCall('update_ce_period_folder', periodId, folder);
    _showWizardStep(3);
  }
}

async function _wizardBack(step) {
  const lab = await pyCall('get_lab_info') || {};
  _showWizardStep(step - 1, lab);
}

async function _wizardFinish() {
  const report = document.getElementById('wiz-report')?.value?.trim() || null;
  const mb     = parseFloat(document.getElementById('wiz-mb')?.value) || null;
  const se     = parseFloat(document.getElementById('wiz-se')?.value) || null;
  const fl     = parseFloat(document.getElementById('wiz-fl')?.value) || null;

  const period = await pyCall('get_active_ce_period');
  if (period?.id) {
    await pyCall('create_subperiod',
      period.id,
      period.valid_from,
      report, null, 0, mb, se, fl, null
    );
  }
  App.closeModal();
  await checkAndShowInitBanner();
  await updateSidebarCeBadge();
  App.toast('Ρύθμιση ολοκληρώθηκε!', 'ok');
}

async function updateSuggestedWizardFolder() {
  const lab    = await pyCall('get_lab_info') || {};
  const ceNum  = document.getElementById('wiz-ce-number')?.value?.trim()
              || lab.ce_number || '';
  if (!ceNum) return;
  // Μετατροπή DD/MM/YYYY → YYYY-MM-DD αν χρειάζεται
  function toISO(d) {
    if (!d) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
      const [dd,mm,yyyy] = d.split('/');
      return `${yyyy}-${mm}-${dd}`;
    }
    return d;
  }
  const from = toISO(document.getElementById('wiz-ce-from')?.value?.trim() || lab.ce_valid_from || '');
  const to   = toISO(document.getElementById('wiz-ce-to')?.value?.trim()   || lab.ce_valid_to   || '');
  const result = await window.pyBridge?.['ce-get-suggested-folder']?.(ceNum, from, to);
  const inp = document.getElementById('wiz-folder');
  if (inp && result?.ok && !inp._manuallyEdited) {
    inp.value = result.folder;
  }
}

async function _wizardSelectFolder() {
  const result = await window.pyBridge?.['ce-select-folder']?.();
  if (result?.success) {
    const inp = document.getElementById('wiz-folder');
    if (inp) { inp.value = result.folder; inp._manuallyEdited = true; }
  }
}

function _toIsoDate(d) {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
  const parts = d.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  return d;
}

function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const _splashStart = Date.now();
const SPLASH_MIN_MS = 1500; // ελάχιστος χρόνος εμφάνισης splash

function hideSplash() {
  const elapsed   = Date.now() - _splashStart;
  const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
  setTimeout(() => {
    const splash = document.getElementById('splash-overlay');
    if (!splash) return;
    splash.classList.add('hidden');
    setTimeout(() => splash.remove(), 450);
  }, remaining);
}

function initTitlebar() {
  const btnMin   = document.getElementById('titlebar-min');
  const btnMax   = document.getElementById('titlebar-max');
  const btnClose = document.getElementById('titlebar-close');
  if (!btnMin || !window.pyBridge?.['window-minimize']) return;

  btnMin.addEventListener('click',   () => window.pyBridge['window-minimize']());
  btnMax.addEventListener('click',   () => window.pyBridge['window-maximize-toggle']());
  btnClose.addEventListener('click', () => window.pyBridge['window-close']());

  const setMaxIcon = (isMax) => {
    btnMax.textContent = isMax ? '❐' : '▢';
    btnMax.title = isMax ? 'Επαναφορά' : 'Μεγιστοποίηση';
  };
  window.pyBridge['window-is-maximized']?.().then(setMaxIcon);
  window.pyBridge['on-window-maximized-change']?.(setMaxIcon);
}

document.addEventListener('DOMContentLoaded', async () => {
  try {

  // Κρύβω splash όταν ο Python backend είναι έτοιμος.
  // Δύο περιπτώσεις: Python έτοιμος πριν ή μετά το DOMContentLoaded.
  const PYTHON_READY_TIMEOUT_MS = 15000; // αν ο backend δεν απαντήσει ως τότε, κάτι πήγε στραβά στην εκκίνηση
  if (window.pyBridge?.['is-python-ready']) {
    const alreadyReady = await window.pyBridge['is-python-ready']();
    if (alreadyReady) {
      hideSplash();
    } else if (window.pyBridge?.['on-python-ready']) {
      let pythonReadyFired = false;
      window.pyBridge['on-python-ready'](() => {
        pythonReadyFired = true;
        hideSplash();
      });
      setTimeout(() => {
        if (pythonReadyFired) return;
        hideSplash();
        App.toast('Η εφαρμογή δεν μπόρεσε να συνδεθεί με τη βάση δεδομένων. Κλείστε και ανοίξτε ξανά την εφαρμογή· αν επιμένει, επικοινωνήστε με τον διαχειριστή.', 'fail');
      }, PYTHON_READY_TIMEOUT_MS);
    } else {
      setTimeout(hideSplash, 4000);
    }
  } else {
    setTimeout(hideSplash, 4000);
  }

  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.page);
    });
  });

  // Κλείσιμο modal με click εκτός
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') App.closeModal();
  });

  // Φόρτωση κοινών δεδομένων (μία φορά)
  AppState.products    = await pyCall('get_products')    || [];
  AppState.technicians = await pyCall('get_technicians') || [];

  // Νέο: φόρτωση test registry (για helpers όπως App.testLabel)
  AppState.testRegistry = await pyCall('get_test_registry_meta') || null;
  if (!AppState.testRegistry) {
    console.warn('[INIT] Test registry δεν φορτώθηκε — fallback labels');
  }

  // Φόρτωση στοιχείων CE στο sidebar
  const guideEnabled = await pyCall('get_guide_enabled');
  AppState.guideEnabled = guideEnabled !== false;

  const lab = await pyCall('get_lab_info');
  if (lab) { AppState.labInfo = lab; }
  await updateSidebarCeBadge();

  // Εμφάνιση έκδοσης στο sidebar footer — κλικ ανοίγει το ιστορικό εκδόσεων
  if (window.pyBridge?.['get-app-version']) {
    const ver = await window.pyBridge['get-app-version']();
    const el = document.getElementById('sidebar-version');
    if (el && ver) {
      el.textContent = 'v' + ver;
      el.style.cursor = 'pointer';
      el.title = 'Δες τι άλλαξε';
      el.addEventListener('click', showVersionHistory);
    }
  }

  // Custom titlebar — κουμπιά minimize/maximize/close (frameless window)
  initTitlebar();

  // Φόρτωση αρχικής σελίδας πρώτα
  await navigateTo('dashboard');
  // Έλεγχος εκδόσεων προδιαγραφών (async, δεν μπλοκάρει εκκίνηση)
  checkDocumentStandards().catch(() => {});

  // Έλεγχος αρχικοποίησης — μικρή καθυστέρηση για να φορτωθεί το DOM
  setTimeout(() => checkAndShowInitBanner(), 300);

  } catch (e) {
    console.error('[INIT] Fatal initialization error:', e);
    // Σε κρίσιμο σφάλμα, κρύψε το splash ώστε να φανεί τουλάχιστον κάτι
    hideSplash();
  }
});
