/**
 * tests.js
 * Εργαστήριο Λατομείων Γαλάτιστας
 * ─────────────────────────────────────────────────────────────
 * Έκδοση : 0.99.0
 * Ημ/νία  : 2026-06-02
 */
// ES module — φορτώνεται με πραγματικό <script type="module" src="...">
// (βλ. main-app.js: Pages.tests.module + navigateTo()).
import { pyCall, pyCallStrict, App, AppState, _esc } from '../../main-app.js';

(() => {

  // ============================================================
  // STATE
  // ============================================================

  const state = {
    sampleId:     null,
    sample:       null,       // από get_full_report
    requiredTests:[],         // από get_required_tests
    history:      {},         // { test_type: [runs...] }
    sieves:       [],         // κόσκινα τρέχοντος προϊόντος
    activeTest:   null,       // test_type που είναι ανοιχτό
    se3rdAdded:   false,
    product:      null,
  };

  // ============================================================
  // HELPERS
  // ============================================================

  const el  = id => document.getElementById(id);
  const txt = (id, v) => { const e = el(id); if (e) e.textContent = v; };

  function show(id) { el(id)?.classList.remove('hidden'); }
  function hide(id) { el(id)?.classList.add('hidden');    }

  // Alias του imported _esc — κρατάει το τοπικό όνομα (πολλά call sites)
  // αντί να μετονομαστούν όλα σε _esc.
  const esc = _esc;

  // ============================================================
  // INIT
  // ============================================================

  // Guard: αν ο χρήστης φύγει από τη σελίδα πριν τελειώσει το async init,
  // τα App.go() calls δεν πρέπει να πυροδοτηθούν.
  function stillOnPage() { return AppState.currentPage === 'tests'; }

  async function init() {
    const id = window._currentSampleId;
    if (!id) {
      App.toast('Δεν ορίστηκε δείγμα', 'fail');
      setTimeout(() => { if (stillOnPage()) App.go('dashboard'); }, 1200);
      return;
    }
    delete window._currentSampleId;
    state.sampleId    = id;
    state.fromHistory = !!window._fromHistory;  // διαβάζουμε ΠΡΙΝ το reset
    delete window._fromHistory;
    await loadSample();
  }

  async function loadSample() {
    hide('tests-content');
    hide('tests-empty');
    show('tests-loading');

    // Σειριακά — το Python backend δεν υποστηρίζει παράλληλα requests
    const report        = await pyCall('get_full_report', state.sampleId);
    const requiredTests = await pyCall('get_required_tests', state.sampleId);

    hide('tests-loading');

    if (!report) {
      App.toast('Δεν βρέθηκε το δείγμα', 'fail');
      if (stillOnPage()) App.go('dashboard');
      return;
    }

    state.sample       = report;
    // Defensive — IPC μπορεί να αλλάξει τύπο
    const TEST_ORDER = ['sieve', 'flakiness', 'se', 'mb'];
    const raw = Array.isArray(requiredTests)
      ? requiredTests
      : (requiredTests ? Object.values(requiredTests) : []);
    state.requiredTests = raw.sort(
      (a, b) => TEST_ORDER.indexOf(a) - TEST_ORDER.indexOf(b)
    );

    state.product = AppState.products.find(
      p => p.id === report.sample.product_id
    ) || null;

    // Αν δεν υπάρχει πλάνο (παλιό δείγμα πριν migration ή bug),
    // δημιούργησε default βάσει κατηγορίας
    if (state.requiredTests.length === 0 && state.product?.category) {
      console.warn('[TestsPage] Κανένα πλάνο — auto-init από κατηγορία');
      const defaultPlan = App.allowedTestsFor(state.product.category);
      if (defaultPlan.length > 0) {
        try {
          await pyCallStrict('set_required_tests', state.sampleId, defaultPlan);
          state.requiredTests = defaultPlan;
        } catch(e) {
          console.error('[TestsPage] auto-init plan failed:', e);
          state.requiredTests = defaultPlan; // τοπικό fallback
        }
      }
    }

    // Φόρτωση κόσκινων
    if (state.product) {
      state.sieves = await pyCall('get_product_sieves', state.product.id) || [];
    }

    // Φόρτωση ιστορικού για κάθε required test — σειριακά (Python backend είναι sequential)
    state.history = {};
    for (const tt of state.requiredTests) {
      state.history[tt] = await pyCall('get_test_history', tt, state.sampleId) || [];
    }

    renderHeader();
    renderCards();

    if (state.requiredTests.length === 0) {
      show('tests-empty');
    } else {
      show('tests-content');
    }
  }

  // ============================================================
  // HEADER
  // ============================================================

  function renderHeader() {
    const s = state.sample.sample;
    txt('tests-sample-title',
      `${s.code} — ${s.product_name}mm`
    );
    txt('tests-sample-subtitle',
      `${App.formatDate(s.date)}` +
      (s.technician_name ? ` · ${s.technician_name}` : '') +
      (s.location        ? ` · ${s.location}`        : '') +
      (s.batch           ? ` · Παρτίδα: ${s.batch}`  : '')
    );

    const infoBar = el('tests-info-bar');
    if (infoBar) {
      const cat = state.product?.category || '';
      infoBar.className = `sample-info-bar sample-info-bar--${App.catBadgeClass(cat).replace('badge-cat-','')}`;
      infoBar.innerHTML = `<span class="info-bar-cat">${esc(cat || '—')}</span>`;
    }
  }

  // ============================================================
  // CARDS — Toggle button pattern (όχι checkboxes)
  // ============================================================

  function renderCards() {
    const container = el('tests-cards');
    if (!container) return;

    const tests = state.sample.tests || {};
    container.innerHTML = state.requiredTests.map(tt => {
      const history  = state.history[tt] || [];
      const official = history.find(h => h.is_official === 1);
      const runCount = history.length;
      const isDone   = !!official;
      const isActive = state.activeTest === tt;

      const statusClass = isDone   ? 'done'
                        : isActive ? 'selected'
                        :            '';
      const statusText  = isDone   ? '✓ Ολοκληρώθηκε'
                        : isActive ? '● Σε εξέλιξη'
                        :            'Εκκρεμεί';
      const statusCls   = isDone   ? 'status-done'
                        : isActive ? 'status-active'
                        :            'status-pending';

      const runInfo = runCount > 1
        ? `<span class="run-badge">Run ${official?.run_no || runCount}</span>`
        : '';

      return `
        <div class="test-card ${statusClass}" data-test="${tt}"
             onclick="TestsPage.selectTest('${tt}')">
          <div class="test-card-title">
            ${esc(App.testLabel(tt))} ${runInfo}
          </div>
          <div class="test-card-footer">
            <span class="test-card-subtitle">${esc(App.testStandard(tt))}</span>
            <span class="test-card-status ${statusCls}">${statusText}</span>
          </div>
          ${isDone && runCount > 1 ? `
            <div class="history-peek">
              ${runCount - 1} προηγ. εκτέλεση${runCount - 1 > 1 ? 'εις' : ''}
            </div>` : ''}
        </div>
      `;
    }).join('');

    // Inline history strips κάτω από τα cards
    renderHistoryStrips();
  }

  function renderHistoryStrips() {
    const container = el('tests-cards');
    if (!container) return;

    state.requiredTests.forEach(tt => {
      const history = state.history[tt] || [];
      const rejected = history.filter(h => h.is_official === 0);
      if (rejected.length === 0) return;

      const stripId = `history-strip-${tt}`;
      // Αφαίρεσε παλιό αν υπάρχει
      el(stripId)?.remove();

      const strip = document.createElement('div');
      strip.id        = stripId;
      strip.className = 'history-strip';
      strip.dataset.test = tt;
      strip.innerHTML = `
        <button class="history-toggle"
                onclick="TestsPage.toggleHistory('${tt}')">
          📜 ${rejected.length} προηγ. εκτέλεση${rejected.length > 1 ? 'εις' : ''} ▾
        </button>
        <div class="history-table hidden" id="history-table-${tt}">
          <table class="sieve-table" style="margin-top:8px;">
            <thead>
              <tr>
                <th>Run</th>
                <th>Ημερομηνία</th>
                <th>Αποτέλεσμα</th>
                <th>Λόγος Απόρριψης</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rejected.map(r => `
                <tr>
                  <td>Run ${r.run_no}</td>
                  <td>${App.formatDate(r.date)}</td>
                  <td>${formatRunResult(tt, r)}</td>
                  <td class="reject-reason">
                    ${esc(r.rejected_reason || '—')}
                  </td>
                  <td>
                    <button class="btn-sm"
                            onclick="TestsPage.editReason('${tt}', ${r.id})">
                      ✎
                    </button>
                    <button class="btn-sm"
                            onclick="TestsPage.promoteRun('${tt}', ${r.id})">
                      ⇪
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Εισαγωγή αμέσως μετά το card της δοκιμής
      const card = container.querySelector(`[data-test="${tt}"]`);
      if (card) card.after(strip);
    });
  }

  function formatRunResult(tt, run) {
    if (tt === 'mb')   return run.mb_value    ? `MB = ${run.mb_value} g/kg` : '—';
    if (tt === 'se')   return run.se_final    ? `SE = ${run.se_final}%`     : '—';
    if (tt === 'flakiness') return run.fi_index ? `FI = ${run.fi_index}%`  : '—';
    if (tt === 'sieve') return run.wash_loss_pct != null
      ? `Απώλεια: ${run.wash_loss_pct}%` : '—';
    return '—';
  }

  function toggleHistory(tt) {
    const table = el(`history-table-${tt}`);
    if (!table) return;
    table.classList.toggle('hidden');
    const btn = table.previousElementSibling;
    if (btn) btn.textContent = table.classList.contains('hidden')
      ? btn.textContent.replace('▴', '▾')
      : btn.textContent.replace('▾', '▴');
  }

  // ============================================================
  // TEST SELECTION — Toggle cards
  // ============================================================

  // Mapping: test type → guide file
  const GUIDE_FILES = {
    'se':       'pages/tests/guides/se-guide.html',
    'mb':       'pages/tests/guides/mb-guide.html',
    'sieve':    'pages/tests/guides/kkm-fi-guide.html',
    'flakiness':'pages/tests/guides/kkm-fi-guide.html',
  };

  function selectTest(tt) {
    // Toggle off
    if (state.activeTest === tt) {
      state.activeTest = null;
      _guideDismissed.delete(tt);
      closeGuidePanel();
      el('tests-form-area').innerHTML = '';
      renderCards();
      return;
    }

    state.activeTest = tt;
    renderCards();

    // Guide μόνο για brand new δοκιμή (κανένα run ακόμα)
    // ΚΑΙ όχι αν ήρθαμε από ιστορικό (συνέχεια εκκρεμούς)
    const history     = state.history[tt] || [];
    const isNew       = history.length === 0;


    if (isNew && AppState?.guideEnabled !== false && GUIDE_FILES[tt]) {
      showTestGuide(tt);
    } else {
      closeGuidePanel();
      buildTestForm(tt);
    }

    // Scroll στη φόρμα
    setTimeout(() => {
      el('tests-form-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  // Δοκιμές για τις οποίες ο χρήστης έκλεισε το guide — δεν ξανανοίγει
  const _guideDismissed = new Set();

  const GUIDE_TITLES = {
    'se':        'Οδηγός — Ισοδύναμο Άμμου (SE)',
    'mb':        'Οδηγός — Μπλε Μεθυλενίου (MB)',
    'sieve':     'Οδηγός — Κοκκομετρία / ΔΙ',
    'flakiness': 'Οδηγός — Κοκκομετρία / ΔΙ',
  };

  function showTestGuide(tt) {
    const panel  = document.getElementById('tests-guide-panel');
    const iframe = document.getElementById('tests-guide-iframe');
    const title  = document.getElementById('tests-guide-title');
    const split  = document.getElementById('tests-split');
    if (!panel || !iframe) return;

    const src = GUIDE_FILES[tt];
    if (!src) return;

    title.textContent   = GUIDE_TITLES[tt] || 'Οδηγός';
    iframe.src          = src;
    panel.classList.remove('hidden');
    split.classList.add('guide-open');

    // Φόρτωσε επίσης τη φόρμα δίπλα
    buildTestForm(tt);
  }

  function closeGuidePanel() {
    const panel = document.getElementById('tests-guide-panel');
    const split = document.getElementById('tests-split');
    if (!panel) return;
    // Σημείωσε ότι ο χρήστης έκλεισε το guide για την ενεργή δοκιμή
    if (state.activeTest) _guideDismissed.add(state.activeTest);
    panel.classList.add('hidden');
    split.classList.remove('guide-open');
    const iframe = document.getElementById('tests-guide-iframe');
    if (iframe) iframe.src = '';
  }

  function _closeGuide() {
    closeGuidePanel();
  }

  function _skipGuide(tt) {
    closeGuidePanel();
    buildTestForm(tt);
  }

  // ============================================================
  // FORMS — μεταφερμένες από παλιό samples.js, προσαρμοσμένες
  // ============================================================

  async function buildTestForm(tt) {
    // Container: tests-form-area (πάντα υπάρχει)
    const container = el('tests-form-area');
    if (!container) return;
    container.innerHTML = '<div style="padding:20px;color:var(--text-muted);">Φόρτωση...</div>';

    const report  = state.sample;
    const history = state.history[tt] || [];
    const official = history.find(h => h.is_official === 1);

    switch (tt) {
      case 'sieve':     await buildSieveForm(container, official);     break;
      case 'mb':        await buildMbForm(container, official);        break;
      case 'se':             buildSeForm(container, official);         break;
      case 'flakiness': await buildFlakinessForm(container, official); break;
    }
  }

  // Καθαρή φόρμα για νέα εκτέλεση (επαναληπτική)
  async function buildTestFormEmpty(tt) {
    const container = el('tests-form-area');
    if (!container) return;
    // Πλήρης καθαρισμός πρώτα — αποτρέπει διπλά κουμπιά
    container.innerHTML = '';
    state.se3rdAdded = false;
    await new Promise(r => setTimeout(r, 0)); // microtask flush

    container.innerHTML = '<div style="padding:20px;color:var(--text-muted);">Φόρτωση νέας φόρμας...</div>';

    switch (tt) {
      case 'sieve':     await buildSieveForm(container, null);     break;
      case 'mb':        await buildMbForm(container, null);        break;
      case 'se':             buildSeForm(container, null);         break;
      case 'flakiness': await buildFlakinessForm(container, null); break;
    }
  }

  // --- ΚΟΚΚΟΜΕΤΡΙΑ ---

  async function buildSieveForm(container, existing) {
    const an      = existing;
    const results = an?._children || [];

    container.innerHTML = `
      <div class="form-card">
        <h2>Κοκκομετρική Ανάλυση — EN 933-1
          <small style="font-weight:400;color:var(--text-muted);margin-left:10px;">
            ${esc(state.product?.name)}mm
          </small>
        </h2>
        <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px;">
          <div class="form-group">
            <label>Βάρος Δείγματος (g)</label>
            <input type="number" id="w-initial" step="0.1"
                   value="${an?.weight_initial || ''}" placeholder="0.0"
                   onchange="TestsPage.calcWashLoss()">
          </div>
          <div class="form-group">
            <label>Βάρος Ξηρού (g)</label>
            <input type="number" id="w-dry" step="0.1"
                   value="${an?.weight_dry || ''}" placeholder="0.0"
                   onchange="TestsPage.calcWashLoss()">
          </div>
          <div class="form-group">
            <label>Βάρος Πλυμένου (g)</label>
            <input type="number" id="w-washed" step="0.1"
                   value="${an?.weight_washed || ''}" placeholder="0.0"
                   onchange="TestsPage.calcPassing()">
          </div>
        </div>
        <div id="wash-loss-display" style="margin-bottom:12px;
             ${an ? '' : 'display:none'}">
          <span class="badge badge-none">Απώλεια πλύσης:
            <strong id="wash-loss-val">${an?.wash_loss_pct || '0.00'}</strong>%
          </span>
        </div>
        <table class="sieve-table">
          <thead>
            <tr>
              <th>Κόσκινο (mm)</th>
              <th>Βάρος Συγκρ. (g)</th>
              <th>Διερχόμενο (%)</th>
            </tr>
          </thead>
          <tbody id="sieve-tbody">
            ${state.sieves.map((s, i) => {
              const ex = results.find(r => r.sieve_mm === s);
              return `
                <tr id="sieve-row-${i}">
                  <td class="sieve-label">${s}</td>
                  <td>
                    <input type="number" id="sieve-ret-${i}"
                           step="0.1" min="0"
                           value="${ex?.weight_retained || ''}"
                           placeholder="0.0"
                           onchange="TestsPage.calcPassing()"
                           onkeydown="TestsPage.sieveKeyNav(event,${i})">
                  </td>
                  <td>
                    <span class="passing-display" id="sieve-pass-${i}">
                      ${ex?.passing_percent ? ex.passing_percent + '%' : '—'}
                    </span>
                  </td>
                </tr>`;
            }).join('')}
            ${(() => {
              // Τυφλό κόσκινο (pan) — sieve_mm=0
              const exPan = results.find(r => r.sieve_mm === 0);
              const panCalc = ''; // υπολογίζεται από calcPassing
              return `
                <tr id="sieve-row-pan" style="background:var(--bg-input);">
                  <td class="sieve-label" style="font-weight:700;">
                    Τυφλό (Pan)
                  </td>
                  <td>
                    <input type="number" id="sieve-ret-pan"
                           step="0.1" min="0"
                           value="${exPan?.weight_retained || ''}"
                           placeholder="0.0"
                           onchange="TestsPage.calcPassing()"
                           onkeydown="TestsPage.sieveKeyNav(event,${state.sieves.length})">
                    <span id="pan-check" style="font-size:11px;display:block;margin-top:3px;"></span>
                  </td>
                  <td style="display:flex;flex-direction:column;gap:2px;">
                    <span class="passing-display" style="color:var(--text-muted);">0.0%</span>
                  </td>
                </tr>`;
            })()}
          </tbody>
        </table>
        ${renderFormActions('sieve', !!existing)}
      </div>
    `;

    setTimeout(() => {
      const first = state.sieves.findIndex((s, i) =>
        !el(`sieve-ret-${i}`)?.value
      );
      focusSieveRow(first >= 0 ? first : 0);
    }, 50);
  }

  function focusSieveRow(idx) {
    document.querySelectorAll('#sieve-tbody tr')
      .forEach(r => r.classList.remove('active-row'));
    el(`sieve-row-${idx}`)?.classList.add('active-row');
    const inp = el(`sieve-ret-${idx}`);
    if (inp) { inp.focus(); inp.select(); }
  }

  function sieveKeyNav(event, idx) {
    const maxIdx = state.sieves.length; // το pan είναι index = sieves.length
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (idx < maxIdx) {
        if (idx === maxIdx - 1) {
          // Πάμε στο pan
          el('sieve-ret-pan')?.focus();
          el('sieve-row-pan')?.classList.add('active-row');
          document.querySelectorAll('#sieve-tbody tr')
            .forEach(r => { if (r.id !== 'sieve-row-pan') r.classList.remove('active-row'); });
        } else {
          focusSieveRow(idx + 1);
        }
      }
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (idx === state.sieves.length) {
        // Από pan → τελευταίο κόσκινο
        focusSieveRow(state.sieves.length - 1);
      } else if (idx > 0) {
        focusSieveRow(idx - 1);
      }
    }
  }

  function calcWashLoss() {
    const dry    = parseFloat(el('w-dry')?.value)    || 0;
    const washed = parseFloat(el('w-washed')?.value) || 0;
    if (dry > 0 && washed > 0) {
      txt('wash-loss-val', ((dry - washed) / dry * 100).toFixed(2));
      if (el('wash-loss-display')) el('wash-loss-display').style.display = 'block';
    }
    calcPassing();
  }

  function calcPassing() {
    // EN 933-1 §8.1:
    // Παρονομαστής = M₁ = w_dry (ξηρό βάρος δείγματος)
    // Passing%(κόσκινο i) = (M₁ - cum_retained) / M₁ × 100
    // Passing%(0.063mm)   = ((M₁ - M₂) + P) / M₁ × 100
    //   όπου M₂ = κατακρατημένο στο 0.063, P = τυφλό
    const wDry    = parseFloat(el('w-dry')?.value)    || 0;
    const wWashed = parseFloat(el('w-washed')?.value) || 0;
    if (wDry <= 0) return;

    let cum = 0;
    const lastIdx = state.sieves.length - 1;
    state.sieves.forEach((s, i) => {
      const ret = parseFloat(el(`sieve-ret-${i}`)?.value) || 0;
      cum += ret;

      let pass;
      if (i === lastIdx) {
        // Κόσκινο 0.063mm: ειδικός τύπος EN 933-1
        // passing = ((M1 - M2) + P) / M1 × 100
        // M2 = cum (κατακρατημένο ΕΩΣ και ΣΤΟ 0.063)
        // P  = τυφλό
        const pan = parseFloat(el('sieve-ret-pan')?.value) || 0;
        pass = Math.max(0, Math.min(100, ((wDry - cum) + pan) / wDry * 100));
      } else {
        pass = Math.max(0, Math.min(100, (wDry - cum) / wDry * 100));
      }
      txt(`sieve-pass-${i}`, pass.toFixed(1) + '%');
    });

    // Pan cross-check: pan = w_washed - Σretained_sieves
    const panCalc   = Math.max(0, wWashed - cum);
    const panManual = parseFloat(el('sieve-ret-pan')?.value) || null;
    const checkEl   = el('pan-check');

    if (checkEl) {
      if (panManual === null) {
        checkEl.textContent = `Υπολ.: ${panCalc.toFixed(1)}g`;
        checkEl.style.color = 'var(--text-muted)';
      } else {
        const diff = Math.abs(panManual - panCalc);
        if (diff <= 0.5) {
          checkEl.textContent = `✓ ${panCalc.toFixed(1)}g`;
          checkEl.style.color = 'var(--ok-light)';
        } else {
          checkEl.textContent = `⚠ Υπολ.: ${panCalc.toFixed(1)}g (Δ=${diff.toFixed(1)}g)`;
          checkEl.style.color = 'var(--warn)';
        }
      }
    }
  }

  async function saveSieve() {
    const wInitial = parseFloat(el('w-initial')?.value) || 0;
    const wDry     = parseFloat(el('w-dry')?.value)     || 0;
    const wWashed  = parseFloat(el('w-washed')?.value)  || 0;

    if (!wWashed) { App.toast('Συμπληρώστε το βάρος πλυμένου', 'warn'); return; }

    const results = state.sieves.map((s, i) => ({
      sieve_mm:        s,
      weight_retained: parseFloat(el(`sieve-ret-${i}`)?.value) || 0,
    }));

    // Τυφλό κόσκινο (pan) — αποθηκεύεται ως sieve_mm=0
    const panVal = parseFloat(el('sieve-ret-pan')?.value) || null;
    if (panVal !== null) {
      results.push({ sieve_mm: 0, weight_retained: panVal });
    } else {
      // Auto-υπολογισμός αν δεν έχει συμπληρωθεί χειροκίνητα
      let retainedSum = results.reduce((a,b) => a + b.weight_retained, 0);
      const panCalc = Math.max(0, wWashed - retainedSum);
      if (panCalc > 0.01) {
        results.push({ sieve_mm: 0, weight_retained: parseFloat(panCalc.toFixed(1)) });
      }
    }

    await doSave('sieve', async (asNewRun, reason) => {
      await pyCallStrict('save_sieve_analysis',
        state.sampleId, state.sample.sample.date,
        wInitial, wDry, wWashed, results,
        null, asNewRun, reason
      );
    });
  }

  // --- ΜΠΛΕ ΜΕΘΥΛΕΝΙΟΥ ---

  async function buildMbForm(container, existing) {
    const suggestion = await pyCall('suggest_initial_volume', state.product?.id);
    const mb = existing;

    container.innerHTML = `
      <div class="form-card">
        <h2>Μπλε Μεθυλενίου — EN 933-9
          <small style="font-weight:400;color:var(--text-muted);margin-left:10px;">
            ${esc(state.product?.name)}mm
          </small>
        </h2>

        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="form-group">
            <label>Βάρος Δείγματος M₁ (g)
              <span style="font-size:10px;color:var(--text-muted);">— ξηρό, 110°C</span>
            </label>
            <input type="number" id="mb-weight"
                   value="${mb?.weight_sample || ''}" step="0.1" min="200" placeholder="≥200"
                   onchange="TestsPage.calcMB()">
            <small class="form-hint">Κλάσμα 0/2mm, σταθερή μάζα</small>
          </div>
          <div class="form-group">
            <label>Όγκος Νερού (ml)</label>
            <input type="number" id="mb-water"
                   value="${mb?.water_volume || 500}" step="1">
          </div>
          <div class="form-group">
            <label>Αρχικός Όγκος (ml)</label>
            <input type="number" id="mb-v-initial"
                   value="${mb?.volume_initial ?? suggestion?.volume ?? 0}"
                   step="5" min="0"
                   style="${suggestion?.is_suggestion && !mb ? 'border-color:var(--warn)' : ''}"
                   onchange="TestsPage.checkMbWarning()">
            ${suggestion?.is_suggestion && !mb ? `
              <div class="volume-warning">
                ⚠ Πρόταση από τελευταία δοκιμή (V1=${suggestion.based_on}ml)
              </div>` : ''}
          </div>
          <div class="form-group">
            <label>Τελικός Όγκος V1 (ml)</label>
            <input type="number" id="mb-v-final"
                   value="${mb?.volume_final || ''}"
                   step="5" min="0" placeholder="0"
                   onchange="TestsPage.calcMB()">
          </div>
        </div>
        <div class="mb-result" id="mb-result" style="${mb ? '' : 'display:none'}">
          <div>
            <div class="mb-result-label">MB</div>
            <div class="mb-result-value" id="mb-value-display">${mb?.mb_value || '—'}</div>
            <div class="mb-result-unit">g/kg</div>
          </div>
          <div id="mb-formula" style="font-size:12px;color:var(--text-muted)">MB = (V1 / M1) × 10</div>
        </div>
        <div class="form-group" style="margin-top:16px;">
          <label>Σχόλια</label>
          <input type="text" id="mb-comments" value="${mb?.comments || ''}">
        </div>
        ${renderFormActions('mb', !!existing)}
      </div>
    `;
  }

  function checkMbWarning() {
    const v = parseFloat(el('mb-v-initial')?.value) || 0;
    const inp = el('mb-v-initial');
    if (inp) inp.style.borderColor = v > 0 ? 'var(--warn)' : '';
  }

  function calcMB() {
    const m1 = parseFloat(el('mb-weight')?.value)  || 0;
    const v1 = parseFloat(el('mb-v-final')?.value) || 0;
    if (m1 > 0 && v1 > 0) {
      const mb = (v1 / m1 * 10).toFixed(2);
      txt('mb-value-display', mb);
      txt('mb-formula', `MB = (${v1} / ${m1.toFixed(1)}) × 10 = ${mb} g/kg`);
      if (el('mb-result')) el('mb-result').style.display = 'flex';
    }
  }

  async function saveMB() {
    const weight = parseFloat(el('mb-weight')?.value)    || 0;
    const water  = parseFloat(el('mb-water')?.value)     || 0;
    const vInit  = parseFloat(el('mb-v-initial')?.value) || 0;
    const vFinal = parseFloat(el('mb-v-final')?.value)   || 0;

    if (!weight) { App.toast('Συμπληρώστε το βάρος δείγματος M₁', 'warn'); return; }
    if (!vFinal) { App.toast('Συμπληρώστε τον τελικό όγκο V1', 'warn'); return; }

    await doSave('mb', async (asNewRun, reason) => {
      await pyCallStrict('save_methylene_blue',
        state.sampleId, state.sample.sample.date,
        weight, water, vInit, vFinal,
        el('mb-comments')?.value || '',
        asNewRun, reason
      );
    });
  }

  // --- ΙΣΟΔΥΝΑΜΟ ΑΜΜΟΥ ---

  function buildSeForm(container, existing) {
    state.se3rdAdded = false;
    const measurements = existing?._children || [];

    container.innerHTML = `
      <div class="form-card">
        <h2>Ισοδύναμο Άμμου — EN 933-8</h2>
        <div class="se-measurements" id="se-measurements">
          ${[1,2].map(i => seRowHTML(i, measurements[i-1])).join('')}
        </div>
        <div class="se-diff-warning" id="se-diff-warning">
          ⚠ Διαφορά &gt; 4 μονάδες — Η δοκιμή πρέπει να επαναληφθεί (EN 933-8 §9)
        </div>
        <div id="se-3rd-container"></div>
        <div class="mb-result" id="se-result"
             style="${existing ? '' : 'display:none'}">
          <div>
            <div class="mb-result-label">SE</div>
            <div class="mb-result-value" id="se-final-display">
              ${existing?.se_final || '—'}
            </div>
            <div class="mb-result-unit">%</div>
          </div>
          <div id="se-breakdown" style="font-size:12px;color:var(--text-muted)">
            ${measurements.map((m,i) => `Μ${i+1}=${m.se_value}%`).join(' | ')}
          </div>
        </div>
        <div class="form-group" style="margin-top:16px;">
          <label>Σχόλια</label>
          <input type="text" id="se-comments" value="${existing?.comments || ''}">
        </div>
        ${renderFormActions('se', !!existing)}
      </div>
    `;

    // Legacy: παλιές εγγραφές με 3 μετρήσεις (πριν EN 933-8 §9 correction)
    if (measurements.length === 3) {
      state.se3rdAdded = true;
      el('se-3rd-container').innerHTML = seRowHTML(3, measurements[2], true);
    }
  }

  function seRowHTML(i, data = null, isWarning = false) {
    return `
      <div class="se-row ${isWarning ? 'warning-row' : ''}" id="se-row-${i}">
        <div class="se-row-label">Μέτρηση ${i}</div>
        <div class="form-group">
          <label title="Ύψος αιωρήματος αργίλου — διαβάζεται αμέσως μετά τα 20 λεπτά ιζηματοποίησης, χωρίς ράβδο">
            h1 — Άργιλος (mm)
          </label>
          <input type="number" id="se-h1-${i}"
                 value="${data?.h1 || ''}" step="0.5" min="0" placeholder="0.0"
                 onchange="TestsPage.calcSE()">
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">📏 Κορυφή αιωρήματος αργίλου</div>
        </div>
        <div class="form-group">
          <label title="Ύψος ιζήματος άμμου — διαβάζεται αφού κατεβεί η ράβδος πίεσης και ακουμπήσει στην άμμο">
            h2 — Άμμος (mm)
          </label>
          <input type="number" id="se-h2-${i}"
                 value="${data?.h2 || ''}" step="0.5" min="0" placeholder="0.0"
                 onchange="TestsPage.calcSE()">
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">📏 Κορυφή ιζήματος άμμου (με ράβδο πίεσης)</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">SE%</div>
          <div class="se-value-display" id="se-val-${i}">
            ${data?.se_value ? data.se_value + '%' : '—'}
          </div>
        </div>
      </div>
    `;
  }

  function calcSE() {
    // EN 933-8 §9: μόνο 2 κύλινδροι — αν διαφορά > 4, επανάληψη ολόκληρης δοκιμής
    const values = [];
    for (let i = 1; i <= 2; i++) {
      const h1 = parseFloat(el(`se-h1-${i}`)?.value) || 0;
      const h2 = parseFloat(el(`se-h2-${i}`)?.value) || 0;
      if (h1 > 0 && h2 > 0) {
        const se = (h2 / h1 * 100).toFixed(1); // SE = (άμμος/άργιλος)*100
        txt(`se-val-${i}`, se + '%');
        values.push(parseFloat(se));
      }
    }
    if (values.length === 2) {
      const diff = Math.abs(values[0] - values[1]);
      const warn = el('se-diff-warning');
      if (diff > 4) {
        warn?.classList.add('visible');
        if (el('se-result')) el('se-result').style.display = 'none';
        // Καθαρισμός πεδίων — η δοκιμή ξεκινά από το 0
        setTimeout(() => {
          for (let i = 1; i <= 2; i++) {
            const fh1 = el(`se-h1-${i}`); if (fh1) fh1.value = '';
            const fh2 = el(`se-h2-${i}`); if (fh2) fh2.value = '';
            txt(`se-val-${i}`, '—');
          }
        }, 1500); // μικρή καθυστέρηση για να δει ο χρήστης ποιες τιμές απορρίφθηκαν
        return;
      } else {
        warn?.classList.remove('visible');
      }
    }
    if (values.length === 2) {
      // EN 933-8 §9: μέσος όρος, στρογγυλοποίηση στον πλησιέστερο ακέραιο
      const avg = Math.round((values[0] + values[1]) / 2);
      txt('se-final-display', avg + '%');
      txt('se-breakdown', values.map((v,i) => `Μ${i+1}=${v}%`).join(' | '));
      if (el('se-result')) el('se-result').style.display = 'flex';
    }
  }

  async function saveSE() {
    const measurements = [];
    for (let i = 1; i <= 2; i++) {
      const h1 = parseFloat(el(`se-h1-${i}`)?.value) || 0;
      const h2 = parseFloat(el(`se-h2-${i}`)?.value) || 0;
      if (h1 > 0 && h2 > 0) measurements.push({h1, h2});
    }
    if (measurements.length < 2) {
      App.toast('Συμπληρώστε και τις 2 μετρήσεις', 'warn');
      return;
    }
    // EN 933-8 §9: αν διαφορά > 4, δεν επιτρέπεται αποθήκευση
    const seVals = measurements.map(m => m.h1 > 0 ? m.h2 / m.h1 * 100 : 0);
    if (Math.abs(seVals[0] - seVals[1]) > 4) {
      App.toast('Διαφορά > 4 μονάδες — Επαναλάβετε τη δοκιμή (EN 933-8 §9)', 'error');
      return;
    }
    await doSave('se', async (asNewRun, reason) => {
      await pyCallStrict('save_sand_equivalent',
        state.sampleId, state.sample.sample.date,
        measurements, el('se-comments')?.value || '',
        asNewRun, reason
      );
    });
  }

  // --- ΠΛΑΚΟΕΙΔΗ ---

  async function buildFlakinessForm(container, existing) {
    const fracs      = existing?._children || [];
    const sieveHist  = state.history['sieve'] || [];
    const sieveOff   = sieveHist.find(h => h.is_official === 1);
    const sieveResults = sieveOff?._children || [];
    const hasSieve   = sieveResults.length > 0;

    // Αν υπάρχει κοκκομετρία: μόνο κλάσματα με weight_retained > 0 και sieve_mm >= 2
    // Αν δεν υπάρχει: όλα τα κόσκινα >= 2 του προϊόντος
    const coarse = hasSieve
      ? sieveResults.filter(r => r.sieve_mm >= 2 && r.weight_retained > 0).map(r => r.sieve_mm)
      : state.sieves.filter(s => s >= 2);

    // M0: άθροισμα όλων των κατακρατημένων >= 2mm από κοκκομετρία (για έλεγχο 1%)
    const m0fromSieve = hasSieve
      ? sieveResults.filter(r => r.sieve_mm >= 2).reduce((s, r) => s + (r.weight_retained || 0), 0)
      : 0;

    container.innerHTML = `
      <div class="form-card">
        <h2>Πλακοειδή — EN 933-3
          <small style="font-weight:400;color:var(--text-muted);margin-left:10px;">
            ${esc(state.product?.name)}mm
          </small>
        </h2>
        ${!hasSieve ? `
          <div class="volume-warning" style="margin-bottom:12px;">
            ⚠ Δεν βρέθηκε κοκκομετρία — εισάγετε χειροκίνητα τα βάρη κλασμάτων
          </div>` : `
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
            ✓ Βάρη κλασμάτων (Rᵢ) από κοκκομετρία — εισάγετε μόνο το Βάρος Ραβδωτού (mᵢ)
          </div>`}
        <div class="form-group" style="margin-bottom:12px;">
          <label>Βάρος Δείγματος M₀ (g)
            <span style="font-size:11px;color:var(--text-muted);font-weight:400;">
              — για έλεγχο ισοζυγίου ±1% (EN 933-3 §8)
            </span>
          </label>
          <input type="number" id="fl-m0" step="0.1" min="0" placeholder="0.0"
                 value="${existing?.weight_m0 || (hasSieve ? m0fromSieve.toFixed(1) : '')}"
                 onchange="TestsPage.calcFI()">
        </div>
        <table class="sieve-table">
          <thead>
            <tr>
              <th>Κλάσμα (mm)</th>
              <th>Rᵢ — Βάρος Κλάσματος (g)</th>
              <th>mᵢ — Βάρος Ραβδωτού (g)</th>
            </tr>
          </thead>
          <tbody>
            ${coarse.map((s, i) => {
              const fromSieve = sieveResults.find(r => r.sieve_mm === s);
              const fromExist = fracs.find(f => f.sieve_mm === s);
              // Rᵢ: από κοκκομετρία αν υπάρχει, αλλιώς από existing ή κενό
              const fracVal   = fromExist?.weight_fraction
                ?? (hasSieve && fromSieve ? fromSieve.weight_retained : '');
              const passVal   = fromExist?.weight_passing ?? '';
              const fracRO    = hasSieve && fromSieve; // readonly αν από κοκκομετρία
              return `
                <tr>
                  <td class="sieve-label">${s}</td>
                  <td>
                    <input type="number" id="fl-frac-${i}"
                           value="${fracVal}" step="0.1" min="0"
                           data-sieve="${s}" placeholder="0.0"
                           ${fracRO ? 'readonly style="background:var(--ok-bg);border-color:var(--ok);color:var(--text-muted);" title="Από κοκκομετρία"' : ''}
                           onchange="TestsPage.calcFI()">
                  </td>
                  <td>
                    <input type="number" id="fl-pass-${i}"
                           value="${passVal}" step="0.1" min="0"
                           placeholder="0.0"
                           onchange="TestsPage.calcFI()">
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        <div class="se-diff-warning" id="fi-balance-warning">
          ⚠ Ισοζύγιο &gt; 1% — Η δοκιμή πρέπει να επαναληφθεί με νέο δείγμα (EN 933-3 §8)
        </div>
        <div class="mb-result" id="fi-result" style="${existing ? '' : 'display:none'}">
          <div>
            <div class="mb-result-label">FI</div>
            <div class="mb-result-value" id="fi-value-display">${existing?.fi_index || '—'}</div>
            <div class="mb-result-unit">%</div>
          </div>
          <div id="fi-formula" style="font-size:12px;color:var(--text-muted)"></div>
        </div>
        <div class="form-group" style="margin-top:16px;">
          <label>Σχόλια</label>
          <input type="text" id="fl-comments" value="${existing?.comments || ''}">
        </div>
        ${renderFormActions('flakiness', !!existing)}
      </div>
    `;

    if (existing) calcFI();
  }

  function calcFI() {
    let totalFrac = 0, totalPass = 0, i = 0;
    while (el(`fl-frac-${i}`)) {
      totalFrac += parseFloat(el(`fl-frac-${i}`)?.value) || 0;
      totalPass += parseFloat(el(`fl-pass-${i}`)?.value) || 0;
      i++;
    }

    // Έλεγχος ισοζυγίου 1% (EN 933-3 §8)
    const m0 = parseFloat(el('fl-m0')?.value) || 0;
    const balanceWarn = el('fi-balance-warning');
    if (m0 > 0 && totalFrac > 0) {
      const balancePct = Math.abs(m0 - totalFrac) / m0 * 100;
      if (balancePct > 1) {
        balanceWarn?.classList.add('visible');
        if (el('fi-result')) el('fi-result').style.display = 'none';
        return;
      } else {
        balanceWarn?.classList.remove('visible');
      }
    }

    if (totalFrac > 0) {
      const fi = Math.round(totalPass / totalFrac * 100); // EN 933-3 §8: nearest whole number
      txt('fi-value-display', fi + '%');
      txt('fi-formula', `FI = (${totalPass.toFixed(1)} / ${totalFrac.toFixed(1)}) × 100 = ${fi}`);
      if (el('fi-result')) el('fi-result').style.display = 'flex';
    }
  }

  async function saveFlakiness() {
    const fractions = [];
    let i = 0;
    while (el(`fl-frac-${i}`)) {
      const sieve = parseFloat(el(`fl-frac-${i}`)?.dataset?.sieve);
      const frac  = parseFloat(el(`fl-frac-${i}`)?.value) || 0;
      const pass  = parseFloat(el(`fl-pass-${i}`)?.value) || 0;
      if (frac > 0) fractions.push({ sieve_mm: sieve, weight_fraction: frac, weight_passing: pass });
      i++;
    }
    if (fractions.length === 0) {
      App.toast('Συμπληρώστε τουλάχιστον ένα κλάσμα', 'warn');
      return;
    }
    // Έλεγχος ισοζυγίου 1% (EN 933-3 §8)
    const m0 = parseFloat(el('fl-m0')?.value) || 0;
    const totalFrac = fractions.reduce((s, f) => s + f.weight_fraction, 0);
    if (m0 > 0) {
      const balancePct = Math.abs(m0 - totalFrac) / m0 * 100;
      if (balancePct > 1) {
        App.toast(`Ισοζύγιο ${balancePct.toFixed(1)}% > 1% — Επαναλάβετε με νέο δείγμα (EN 933-3 §8)`, 'error');
        return;
      }
    }
    await doSave('flakiness', async (asNewRun, reason) => {
      await pyCallStrict('save_flakiness',
        state.sampleId, state.sample.sample.date,
        fractions, m0 || null,
        el('fl-comments')?.value || '',
        asNewRun, reason
      );
    });
  }

  // ============================================================
  // FORM ACTIONS — Κουμπιά φόρμας + λογική επαναληπτικής
  // ============================================================

  function renderFormActions(tt, hasExisting) {
    const isPendingNewRun = !!state._pendingNewRun;
    // Αν είμαστε σε νέο run: «Αποθήκευση» και κρύβουμε το «Επαναληπτική»
    // Αν edit υπάρχοντος: «Ενημέρωση» + κουμπί «Επαναληπτική»
    // Αν νέο: «Αποθήκευση» χωρίς «Επαναληπτική»
    const saveLabel = (hasExisting && !isPendingNewRun) ? 'Ενημέρωση ✓' : 'Αποθήκευση ✓';
    const showRepeat = hasExisting && !isPendingNewRun;
    const saveFn    = {
      sieve: 'saveSieve', mb: 'saveMB', se: 'saveSE', flakiness: 'saveFlakiness'
    }[tt];

    return `
      <div class="form-actions">
        <button class="btn-secondary"
                onclick="TestsPage.closeForm()">
          ← Πίσω
        </button>
        ${showRepeat ? `
          <button class="btn-secondary"
                  onclick="TestsPage.startNewRun('${tt}')">
            ↺ Επαναληπτική
          </button>
        ` : ''}
        ${isPendingNewRun ? `
          <div style="font-size:12px;color:var(--accent);align-self:center;">
            ● Νέα εκτέλεση — συμπληρώστε και αποθηκεύστε
          </div>
        ` : ''}
        <button class="btn-primary"
                onclick="TestsPage.${saveFn}()">
          ${saveLabel}
        </button>
      </div>
    `;
  }

  function closeForm() {
    // Αν ακυρώθηκε επαναληπτική, καθαρίζουμε το pending state
    if (state._pendingNewRun) {
      delete state._pendingNewRun;
      delete state._pendingRejectReason;
      App.toast('Η επαναληπτική ακυρώθηκε', 'warn');
    }
    state.activeTest = null;
    state.se3rdAdded = false;
    el('tests-form-area').innerHTML = '';
    renderCards();
    el('tests-cards')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Επαναληπτική εκτέλεση: ζητάει λόγο μέσω App.showModal
   * και καλεί το save με as_new_run=true.
   */
  function startNewRun(tt) {
    App.showModal(
      `Επαναληπτική Εκτέλεση — ${App.testLabel(tt)}`,
      `
        <p style="color:var(--text-muted);margin-bottom:12px;">
          Η τρέχουσα επίσημη εκτέλεση θα μαρκαριστεί ως
          <strong>απορριφθείσα</strong> και θα αποθηκευτεί νέα.
        </p>
        <div class="form-group">
          <label>Λόγος Επαναληπτικής <span class="required">*</span></label>
          <textarea id="reject-reason-input" rows="3"
                    placeholder="πχ Λάθος ζύγισμα, εκ παραδρομής λάθος κόσκινο..."
                    style="width:100%;margin-top:6px;"></textarea>
        </div>
      `,
      [
        { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
        { label: 'Επιβεβαίωση',
          action: `TestsPage._confirmNewRun('${tt}')` },
      ]
    );
  }

  // Καλείται από το modal button — διαβάζει τον λόγο και ξεκινά save με flag
  function _confirmNewRun(tt) {
    // Διαβάζουμε ΠΡΙΝ closeModal
    const textarea = el('reject-reason-input')
      || document.querySelector('#modal-content textarea');
    const reason = textarea?.value?.trim();
    if (!reason) {
      App.toast('Ο λόγος είναι υποχρεωτικός', 'warn');
      return;
    }
    App.closeModal();

    // Αποθηκεύουμε τον λόγο — θα χρησιμοποιηθεί στο επόμενο save
    state._pendingRejectReason = reason;
    state._pendingNewRun       = true;

    // ΔΕΝ αποθηκεύουμε αμέσως — ανοίγουμε καθαρή φόρμα για νέες μετρήσεις
    // Ο χρήστης συμπληρώνει και πατάει «Αποθήκευση» κανονικά
    state.activeTest = tt;
    renderCards();
    buildTestFormEmpty(tt);

    // Visual feedback
    App.toast(`Συμπληρώστε τις νέες μετρήσεις και πατήστε Αποθήκευση`, 'ok');

    // Scroll στη φόρμα
    setTimeout(() => {
      el('tests-form-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  /**
   * Κοινή λογική save: αν υπάρχει pending new run, περνάει τις παραμέτρους.
   * saveFn(asNewRun, reason) → κλήση στο Python
   */
  async function doSave(tt, saveFn) {
    // Guard: αποτροπή διπλού save
    if (state._saving) return;
    state._saving = true;

    // Disable save buttons
    document.querySelectorAll('#tests-form-area .btn-primary').forEach(b => {
      b.disabled = true;
      b.textContent = 'Αποθήκευση...';
    });

    const asNewRun = !!state._pendingNewRun;
    const reason   = state._pendingRejectReason || null;

    // Cleanup state αμέσως για να μην ξαναχρησιμοποιηθεί
    delete state._pendingNewRun;
    delete state._pendingRejectReason;

    try {
      await saveFn(asNewRun, reason);
      App.toast(`${App.testLabel(tt)} αποθηκεύτηκε ✓`, 'ok');
      await reloadAfterSave(tt);
    } catch (e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
      // Re-enable αν αποτύχει
      document.querySelectorAll('#tests-form-area .btn-primary').forEach(b => {
        b.disabled = false;
        b.textContent = 'Αποθήκευση ✓';
      });
    } finally {
      state._saving = false;
    }
  }

  async function reloadAfterSave(tt) {
    // Φόρτωση νέου ιστορικού για τη δοκιμή που άλλαξε
    state.history[tt] = await pyCall('get_test_history', tt, state.sampleId) || [];
    // Ανανέωση report
    state.sample = await pyCall('get_full_report', state.sampleId) || state.sample;

    state.activeTest = null;
    state.se3rdAdded = false;
    el('tests-form-area').innerHTML = '';
    renderCards();
  }

  // ============================================================
  // HISTORY MANAGEMENT
  // ============================================================

  function editReason(tt, runId) {
    App.showModal(
      'Επεξεργασία Λόγου Απόρριψης',
      `
        <div class="form-group">
          <label>Νέος Λόγος</label>
          <textarea id="edit-reason-input" rows="3"
                    style="width:100%;margin-top:6px;"
                    placeholder="Λόγος απόρριψης..."></textarea>
        </div>
      `,
      [
        { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
        { label: 'Αποθήκευση',
          action: `TestsPage._saveEditReason('${tt}', ${runId})` },
      ]
    );
  }

  async function _saveEditReason(tt, runId) {
    const reason = el('edit-reason-input')?.value?.trim();
    if (!reason) { App.toast('Ο λόγος δεν μπορεί να είναι κενός', 'warn'); return; }
    App.closeModal();
    try {
      await pyCallStrict('update_rejected_reason', tt, runId, reason);
      App.toast('Λόγος ενημερώθηκε', 'ok');
      state.history[tt] = await pyCall('get_test_history', tt, state.sampleId) || [];
      renderCards();
    } catch (e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  function promoteRun(tt, runId) {
    App.showModal(
      'Επαναφορά ως Επίσημη Εκτέλεση',
      `
        <p style="color:var(--text-muted);margin-bottom:12px;">
          Η τρέχουσα επίσημη εκτέλεση θα γίνει απορριφθείσα.
          Η επιλεγμένη θα γίνει η νέα επίσημη.
        </p>
        <div class="form-group">
          <label>Λόγος υποβάθμισης της τρέχουσας <span class="required">*</span></label>
          <textarea id="demote-reason-input" rows="3"
                    style="width:100%;margin-top:6px;"
                    placeholder="πχ Αποδείχθηκε ότι η νεότερη είχε σφάλμα..."></textarea>
        </div>
      `,
      [
        { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
        { label: 'Επιβεβαίωση',
          action: `TestsPage._promoteRun('${tt}', ${runId})` },
      ]
    );
  }

  async function _promoteRun(tt, runId) {
    const reason = el('demote-reason-input')?.value?.trim();
    if (!reason) { App.toast('Ο λόγος είναι υποχρεωτικός', 'warn'); return; }
    App.closeModal();
    try {
      await pyCallStrict('promote_run_to_official', tt, runId, reason);
      App.toast('Η εκτέλεση επαναφέρθηκε ως επίσημη', 'ok');
      state.history[tt] = await pyCall('get_test_history', tt, state.sampleId) || [];
      state.sample = await pyCall('get_full_report', state.sampleId) || state.sample;
      renderCards();
    } catch (e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  // ============================================================
  // EDIT ΣΤΟΙΧΕΙΩΝ ΔΕΙΓΜΑΤΟΣ
  // ============================================================

  async function editInfo() {
    const s = state.sample.sample;
    const techOptions = (AppState.technicians || [])
      .map(t => `<option value="${t.id}" ${t.id === s.technician_id ? 'selected' : ''}>${esc(t.name)}</option>`)
      .join('');
    App.showModal('Επεξεργασία Στοιχείων', `
      <div class="form-grid">
        <div class="form-group">
          <label>Κωδικός</label>
          <input type="text" id="edit-code" value="${esc(s.code)}">
        </div>
        <div class="form-group">
          <label>Ημερομηνία</label>
          <input type="date" id="edit-date" value="${s.date}">
        </div>
        <div class="form-group">
          <label>Τεχνικός</label>
          <div class="input-with-action">
            <select id="edit-technician">
              <option value="">— Χωρίς —</option>
              ${techOptions}
            </select>
            <button class="icon-btn" onclick="TestsPage._addTechnicianInline()" title="Νέος τεχνικός">+</button>
          </div>
        </div>
        <div class="form-group">
          <label>Σημείο</label>
          <input type="text" id="edit-location" value="${esc(s.location || '')}">
        </div>
        <div class="form-group">
          <label>Παρτίδα</label>
          <input type="text" id="edit-batch" value="${esc(s.batch || '')}">
        </div>
        <div class="form-group full-width">
          <label>Σχόλια</label>
          <textarea id="edit-comments" rows="2">${esc(s.comments || '')}</textarea>
        </div>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: 'Αποθήκευση', action: 'TestsPage._saveInfo()' },
    ]);
  }

  async function _saveInfo() {
    const newCode       = el('edit-code')?.value?.trim();
    const newDate       = el('edit-date')?.value;
    const newTechId     = parseInt(el('edit-technician')?.value) || null;
    const newLocation   = el('edit-location')?.value?.trim() || '';
    const newBatch      = el('edit-batch')?.value?.trim() || '';
    const newComments   = el('edit-comments')?.value?.trim() || '';
    App.closeModal();
    try {
      await pyCallStrict('update_sample',
        state.sampleId,
        newCode,
        newDate,
        newTechId,
        newLocation,
        newBatch,
        newComments,
      );
      App.toast('Στοιχεία ενημερώθηκαν', 'ok');
      state.sample = await pyCall('get_full_report', state.sampleId) || state.sample;
      renderHeader();
    } catch (e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  // ============================================================
  // EDIT ΠΛΑΝΟΥ ΔΟΚΙΜΩΝ
  // ============================================================

  function editPlan() {
    // Ensure requiredTests is always array
    if (!Array.isArray(state.requiredTests)) {
      state.requiredTests = state.requiredTests ? Object.values(state.requiredTests) : [];
    }
    const cat     = state.product?.category || '';
    const allowed = App.allowedTestsFor(cat);

    App.showModal('Τροποποίηση Πλάνου Δοκιμών', `
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:14px;">
        Δεν μπορεί να αφαιρεθεί δοκιμή που έχει ήδη εκτελέσεις.
        Μπορείτε μόνο να προσθέσετε.
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${allowed.map(tt => {
          const inPlan  = Array.isArray(state.requiredTests) && state.requiredTests.includes(tt);
          const hasDone = (state.history[tt] || []).length > 0;
          const locked  = hasDone;  // δεν αφαιρείται αν έχει runs
          return `
            <label style="display:flex;gap:10px;align-items:center;
                          padding:10px 14px;background:var(--bg-card);
                          border:1px solid var(--border);border-radius:var(--radius);
                          cursor:${locked ? 'default' : 'pointer'};">
              <input type="checkbox" data-test="${tt}"
                     ${inPlan ? 'checked' : ''}
                     ${locked ? 'disabled' : ''}
                     style="width:16px;height:16px;accent-color:var(--accent);">
              <div>
                <div style="font-weight:600;">${esc(App.testLabel(tt))}</div>
                <div style="font-size:11px;color:var(--text-muted);">
                  ${esc(App.testStandard(tt))}
                  ${locked ? ' · <em>Έχει εκτελέσεις — δεν αφαιρείται</em>' : ''}
                </div>
              </div>
            </label>
          `;
        }).join('')}
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: 'Αποθήκευση', action: 'TestsPage._savePlan()' },
    ]);
  }

  async function _savePlan() {
    App.closeModal();
    const checkboxes = document.querySelectorAll('[data-test]:not([disabled])');
    const selected = [...checkboxes]
      .filter(c => c.checked)
      .map(c => c.dataset.test);

    // Πάντα κρατάμε τις δοκιμές με εκτελέσεις (locked)
    const locked = (Array.isArray(state.requiredTests) ? state.requiredTests : []).filter(
      tt => (state.history[tt] || []).length > 0
    );

    const newPlan = [...new Set([...locked, ...selected])];

    try {
      await pyCallStrict('set_required_tests', state.sampleId, newPlan);
      App.toast('Πλάνο ενημερώθηκε', 'ok');
      state.requiredTests = newPlan;
      // Φόρτωση history για τυχόν νέες δοκιμές — σειριακά
      for (const tt of newPlan.filter(tt2 => !state.history[tt2])) {
        state.history[tt] = await pyCall('get_test_history', tt, state.sampleId) || [];
      }
      if (newPlan.length === 0) {
        hide('tests-content'); show('tests-empty');
      } else {
        show('tests-content'); hide('tests-empty');
        renderCards();
      }
    } catch (e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  async function _addTechnicianInline() {
    const name = await new Promise(resolve => {
      App.showModal('Νέος Τεχνικός', `
        <div class="form-group">
          <label>Όνομα</label>
          <input type="text" id="inline-tech-name" placeholder="Όνομα τεχνικού">
        </div>
      `, [
        { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
        { label: '+ Προσθήκη', action: 'TestsPage._doAddTechnicianInline()' },
      ]);
      setTimeout(() => document.getElementById('inline-tech-name')?.focus(), 100);
    });
  }

  async function _doAddTechnicianInline() {
    const name = document.getElementById('inline-tech-name')?.value?.trim();
    App.closeModal();
    if (!name) return;
    const id = await pyCall('add_technician', name);
    if (!id) { App.toast('Σφάλμα προσθήκης τεχνικού', 'fail'); return; }
    // Ενημέρωση AppState
    AppState.technicians = AppState.technicians || [];
    AppState.technicians.push({ id, name, active: 1 });
    // Ξαναάνοιξε το editInfo με τον νέο τεχνικό
    await editInfo();
    // Προεπέλεξε τον νέο
    const sel = document.getElementById('edit-technician');
    if (sel) sel.value = id;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  window.TestsPage = {
    _skipGuide, _closeGuide, closeGuidePanel,
    // Navigation
    selectTest, closeForm,
    toggleHistory,
    // Form calcs (καλούνται από onchange)
    calcWashLoss, calcPassing, sieveKeyNav,
    calcMB, checkMbWarning,
    calcSE,
    calcFI,
    // Save
    saveSieve, saveMB, saveSE, saveFlakiness,
    // Run management
    startNewRun, _confirmNewRun,
    editReason,  _saveEditReason,
    promoteRun,  _promoteRun,
    // Edit
    editInfo, _saveInfo, _addTechnicianInline, _doAddTechnicianInline,
    editPlan, _savePlan,
  };

  // ============================================================
  // KICKOFF
  // ============================================================

  init().catch(e => console.error('[TestsPage] init error:', e));

})();
