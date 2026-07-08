/**
 * history.js
 * ΔAiγμα LiMS
 * ─────────────────────────────────────────────────────────────
 * Έκδοση : 0.99.0
 * Ημ/νία  : 2026-06-02
 */
// ES module — φορτώνεται με πραγματικό <script type="module" src="...">
// (βλ. main-app.js: Pages.history.module + navigateTo()).
import { pyCall, App, AppState } from '../../main-app.js';
import { t } from '../../i18n/i18n.js';

(() => {

  // ============================================================
  // HELPERS
  // ============================================================

  const el  = id => document.getElementById(id);
  const esc = s  => {
    if (s == null) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    populateProducts();
    // Αυτόματη αναζήτηση με τα τελευταία 50 δείγματα
    await search();
  }


  // Auto-format ημερομηνίας: προσθήκη / αυτόματα
  function autoSlashDate(input) {
    const old = input.value;
    let v = old.replace(/[^0-9]/g, '');
    if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5);
    v = v.slice(0,10);
    if (v !== old) {
      input.value = v;
      input.setSelectionRange(v.length, v.length);
    }
  }

  function populateProducts() {
    const sel = el('h-product');
    if (!sel) return;
    // Αφαίρεση παλιών options εκτός από το πρώτο
    while (sel.options.length > 1) sel.remove(1);
    AppState.products.forEach(p => {
      const opt = document.createElement('option');
      opt.value       = p.id;
      opt.textContent = `${p.name} ${p.d_min}/${p.d_max}mm`;
      sel.appendChild(opt);
    });
  }

  // ============================================================
  // ΑΝΑΖΗΤΗΣΗ
  // ============================================================

  async function search() {
    const code    = el('h-code')?.value?.trim()    || null;
    const product = parseInt(el('h-product')?.value) || null;

    // Μετατροπή ημερομηνίας → yyyy-mm-dd για το query
    // Δέχεται: dd/mm/yyyy ή ddmmyyyy ή d/m/yyyy
    function toISO(v) {
      if (!v || !v.trim()) return null;
      const s = v.trim().replace(/[.\-]/g, '/');
      // dd/mm/yyyy ή d/m/yyyy
      const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
      // ddmmyyyy (8 ψηφία χωρίς διαχωριστικό)
      const m2 = s.match(/^(\d{2})(\d{2})(\d{4})$/);
      if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
      // ήδη yyyy-mm-dd
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      return null;
    }
    function isValidDate(iso) {
      if (!iso) return false;
      const d = new Date(iso);
      return !isNaN(d.getTime()) && d.toISOString().startsWith(iso);
    }
    const from = toISO(el('h-from')?.value);
    const to   = toISO(el('h-to')?.value);
    if (from && !isValidDate(from)) { App.toast(t('history.invalid_date_from', 'Μη έγκυρη ημερομηνία "Από"'), 'warn'); return; }
    if (to   && !isValidDate(to))   { App.toast(t('history.invalid_date_to', 'Μη έγκυρη ημερομηνία "Έως"'), 'warn'); return; }

    const results = await pyCall('search_samples',
      product, from, to, code, 200
    ) || [];

    // Φιλτράρισμα κατηγορίας (client-side — δεν έχει server-side filter ακόμα)
    const cat    = el('h-category')?.value || '';
    const status = el('h-status')?.value   || '';

    let filtered = results;

    if (cat) {
      filtered = filtered.filter(s => s.category === cat);
    }

    if (status === 'pending') {
      filtered = filtered.filter(s => isPending(s));
    } else if (status === 'complete') {
      filtered = filtered.filter(s => !isPending(s));
    }

    renderResults(filtered);
  }

  function reset() {
    ['h-code','h-from','h-to'].forEach(id => {
      const e = el(id); if (e) e.value = '';
    });
    ['h-product','h-category','h-status'].forEach(id => {
      const e = el(id); if (e) e.selectedIndex = 0;
    });
    search();
  }

  // ============================================================
  // ΚΑΤΑΣΤΑΣΗ ΕΚΚΡΕΜΟΤΗΤΑΣ
  // ============================================================

  function isPending(sample) {
    // Βασίζεται στα has_* flags που επιστρέφει το SAMPLES_BASE_QUERY
    // και στην κατηγορία του προϊόντος
    const product = AppState.products.find(p => p.id === sample.product_id);
    if (!product) return false;
    return App.pendingTests(sample).length > 0;
  }

  // ============================================================
  // RENDER
  // ============================================================

  function renderResults(results) {
    const tbody = el('h-results');
    const count = el('h-result-count');
    if (!tbody) return;

    if (count) {
      count.textContent = results.length === 0
        ? t('history.no_results', 'Δεν βρέθηκαν αποτελέσματα')
        : `${results.length} ${results.length === 1 ? t('history.result_count_one', 'δείγμα') : t('history.result_count_many', 'δείγματα')}`;
    }

    if (results.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-msg">${t('history.no_results', 'Δεν βρέθηκαν αποτελέσματα')}</td>
        </tr>`;
      return;
    }

    tbody.innerHTML = results.map(s => {
      const pending     = App.pendingTests(s);
      const isComplete  = pending.length === 0;
      const statusBadge = isComplete
        ? `<span class="badge badge-ok">${t('history.status_complete', '✓ Ολοκλ.')}</span>`
        : `<span class="badge badge-warn">${t('history.status_pending_prefix', '⏳')} ${pending.length} ${t('history.status_pending_suffix', 'εκκρ.')}</span>`;

      const catBadge = {
        'ΛΕΠΤΟΚΟΚΚΟ':  `<span class="badge badge-cat-fine">${t('history.cat_fine', 'ΛΕΠΤ.')}</span>`,
        'ΧΟΝΔΡΟΚΟΚΚΟ': `<span class="badge badge-cat-coarse">${t('history.cat_coarse', 'ΧΟΝΔΡ.')}</span>`,
        'ALL_IN':       `<span class="badge badge-cat-allin">${t('history.cat_allin', 'ALL-IN')}</span>`,
      }[s.category] || '<span class="badge badge-none">—</span>';

      return `
        <tr class="clickable-row" style="cursor:pointer;"
            onclick="HistoryPage.openSample(${s.id})"
            title="${t('history.row_hint', 'Διπλό κλικ για άνοιγμα')}">
          <td><span class="sample-code">${esc(s.code)}</span></td>
          <td>${App.formatDate(s.date)}</td>
          <td>
            <strong>${App.formatProduct(s)}</strong>
          </td>
          <td>${catBadge}</td>
          <td>${App.testBadges(s)}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // ============================================================
  // NAVIGATION
  // ============================================================

  function buildSampleView(s, tests) {
    return `
      <!-- Στοιχεία δείγματος -->
      <div class="sample-info-grid">
        <div><span class="info-label">${t('sampleModal.info_date', 'Ημερομηνία')}</span> ${App.formatDate(s.date)}</div>
        <div><span class="info-label">${t('sampleModal.info_source', 'Προέλευση')}</span> ${s.source_name || '—'}</div>
        <div><span class="info-label">${t('sampleModal.info_technician', 'Τεχνικός')}</span> ${s.technician_name || '—'}</div>
        <div><span class="info-label">${t('sampleModal.info_batch', 'Παρτίδα')}</span> ${App.formatBatch(s.batch)}</div>
        <div><span class="info-label">${t('sampleModal.info_location', 'Σημείο')}</span> ${s.location || '—'}</div>
        ${s.comments ? `<div class="full-width">
          <span class="info-label">${t('sampleModal.info_comments', 'Σχόλια')}</span> ${s.comments}
        </div>` : ''}
      </div>

      <!-- Δοκιμές — 2 columns: αριστερά κοκκομετρία, δεξιά οι 3 -->
      <div class="tests-grid-2col">
        <div class="tests-col-left">
          ${buildTestSection(t('sampleModal.test_sieve', 'Κοκκομετρία EN 933-1'), tests.sieve_analysis, 'sieve')}
        </div>
        <div class="tests-col-right">
          ${(s.category === 'ΧΟΝΔΡΟΚΟΚΚΟ' || s.category === 'ALL_IN') ? buildTestSection(t('sampleModal.test_flakiness', 'Πλακοειδή EN 933-3'), tests.flakiness,       'fi') : ''}
          ${(s.category === 'ΛΕΠΤΟΚΟΚΚΟ'  || s.category === 'ALL_IN') ? buildTestSection(t('sampleModal.test_se', 'Ισοδύναμο Άμμου EN 933-8'),  tests.sand_equivalent, 'se') : ''}
          ${(s.category === 'ΛΕΠΤΟΚΟΚΚΟ'  || s.category === 'ALL_IN') ? buildTestSection(t('sampleModal.test_mb', 'Μπλε Μεθυλενίου EN 933-9'),  tests.methylene_blue,  'mb') : ''}
        </div>
      </div>
    `;
  }

  function buildTestSection(title, testData, type) {
    if (!testData) return `
      <div class="test-section test-empty">
        <div class="test-section-title">${title}</div>
        <div class="test-section-empty">${t('sampleModal.test_empty', 'Δεν έχει καταχωρηθεί')}</div>
      </div>`;

    let content = '';

    if (type === 'sieve') {
      const an = testData.data?.analysis;
      const results = testData.data?.results || [];
      const d = testData.characteristic_diameters || {};
      content = `
        <div class="test-weights">
          <span class="badge badge-none">${t('sampleModal.sieve_weight', 'Βάρος')}: ${an?.weight_initial || '—'}g</span>
          <span class="badge badge-none">${t('sampleModal.sieve_dry', 'Ξηρό')}: ${an?.weight_dry || '—'}g</span>
          <span class="badge badge-none">${t('sampleModal.sieve_washed', 'Πλυμένο')}: ${an?.weight_washed || '—'}g</span>
          <span class="badge badge-none">${t('sampleModal.sieve_loss', 'Απώλεια')}: ${an?.wash_loss_pct || '—'}%</span>
        </div>
        <table class="mini-table">
          <thead><tr>
            <th>${t('sampleModal.sieve_col_sieve', 'Κόσκινο')}</th>
            <th style="text-align:right">${t('sampleModal.sieve_col_retained', 'Συγκρ.(g)')}</th>
            <th style="text-align:right">${t('sampleModal.sieve_col_passing', 'Διερχ.(%)')}</th>
          </tr></thead>
          <tbody>
            ${results.map(r => `
              <tr>
                <td>${r.sieve_mm}mm</td>
                <td style="text-align:right">${r.weight_retained}</td>
                <td style="text-align:right;font-weight:600">${r.passing_percent}%</td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${d.D60 ? `<div class="diameters-row">
          ${d.D10 != null ? `<span class="badge badge-none">D10=${d.D10}</span>` : ''}
          ${d.D30 != null ? `<span class="badge badge-none">D30=${d.D30}</span>` : ''}
          ${d.D60 != null ? `<span class="badge badge-none">D60=${d.D60}</span>` : ''}
          ${d.Cu  != null ? `<span class="badge badge-none">Cu=${d.Cu}</span>`  : ''}
          ${d.Cc  != null ? `<span class="badge badge-none">Cc=${d.Cc}</span>`  : ''}
          <span class="badge badge-ok">${d.classification || ''}</span>
        </div>` : ''}
      `;
    } else if (type === 'fi') {
      const statusClass = testData.overall_status === 'OK' ? 'badge-ok'
                        : testData.overall_status === 'WARNING' ? 'badge-warn'
                        : 'badge-fail';
      content = `
        <div class="big-value" style="justify-content:flex-end">
          ${testData.fi_index}%
          <span class="badge ${statusClass}">FI</span>
        </div>`;
    } else if (type === 'mb') {
      const statusClass = testData.overall_status === 'OK' ? 'badge-ok'
                        : testData.overall_status === 'WARNING' ? 'badge-warn'
                        : 'badge-fail';
      content = `
        <div class="big-value" style="justify-content:flex-end">
          ${testData.mb_value} <span style="font-size:14px;color:var(--text-muted)">g/kg</span>
          <span class="badge ${statusClass}">MB</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-align:right">
          V1=${testData.volume_final}ml / M1=${testData.weight_sample}g
        </div>`;
    } else if (type === 'se') {
      const statusClass = testData.overall_status === 'OK' ? 'badge-ok'
                        : testData.overall_status === 'WARNING' ? 'badge-warn'
                        : 'badge-fail';
      content = `
        <div class="big-value" style="justify-content:flex-end">
          ${testData.se_final}%
          <span class="badge ${statusClass}">SE</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;justify-content:flex-end">
          ${(testData.measurements || []).map((m,i) =>
            `<span class="badge badge-none">Μ${i+1}: ${m.se_value}%</span>`
          ).join('')}
        </div>`;
    }

    const statusClass = testData.overall_status === 'OK' ? 'test-ok'
                      : testData.overall_status === 'WARNING' ? 'test-warn'
                      : 'test-fail';

    return `
      <div class="test-section ${statusClass}">
        <div class="test-section-title">${title}</div>
        ${content}
      </div>`;
  }

  async function openSample(id) {
    const data = await pyCall('get_full_report', id);
    if (!data) { App.toast(t('sampleModal.not_found', 'Δεν βρέθηκε το δείγμα'), 'fail'); return; }

    const s     = data.sample;
    const tests = data.tests || {};

    App.showModal(
      `${s.code} — ${App.formatProduct(s)}`,
      buildSampleView(s, tests),
      [
        { label: t('common.close', 'Κλείσιμο'),  action: 'App.closeModal()', secondary: true },
        { label: t('common.delete', '🗑 Διαγραφή'), action: `HistoryPage.deleteSample(${id})`, danger: true },
        { label: t('common.pdf', '▤ PDF'),       action: `HistoryPage.printSample(${id})` },
        { label: t('common.edit', '✎ Επεξεργασία'), action: `HistoryPage.editSample(${id})` },
      ]
    );
  }

  function editSample(id) {
    App.closeModal();
    window._currentSampleId = id;
    window._fromHistory = true;
    App.go('tests');
  }

  async function deleteSample(id) {
    App.closeModal();
    App.showModal(
      t('sampleModal.delete_title', 'Διαγραφή Δείγματος'),
      `<p style="color:var(--fail);">${t('sampleModal.delete_warning', '⚠ Η διαγραφή είναι μη αναστρέψιμη.<br>Θα διαγραφούν και όλες οι δοκιμές του δείγματος.')}</p>` +
      `<p>${t('sampleModal.delete_confirm', 'Είστε σίγουροι;')}</p>`,
      [
        { label: t('common.cancel', 'Ακύρωση'),       action: 'App.closeModal()', secondary: true },
        { label: t('common.delete', '🗑 Διαγραφή'),   action: `HistoryPage.confirmDelete(${id})`, danger: true },
      ]
    );
  }

  async function confirmDelete(id) {
    App.closeModal();
    const ok = await pyCall('delete_sample', id);
    if (ok) {
      App.toast(t('sampleModal.delete_success', 'Το δείγμα διαγράφηκε'), 'ok');
      await search();
    } else {
      App.toast(t('sampleModal.delete_error', 'Σφάλμα κατά τη διαγραφή'), 'fail');
    }
  }

  async function printSample(id) {
    App.toast(t('sampleModal.pdf_generating', 'Δημιουργία PDF…'), 'info');
    const opts = { sampleId: id, tests: ['sieve', 'flakiness', 'se', 'mb'] };
    const result = await window.pyBridge?.['generate-report-pdf']?.(opts);
    if (!result?.success) {
      App.toast(t('sampleModal.pdf_error', 'Σφάλμα παραγωγής PDF: ') + (result?.error || ''), 'fail');
      return;
    }
    await window.pyBridge?.['open-pdf']?.(result.path);
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  window.HistoryPage = { search, reset, openSample, editSample, deleteSample, confirmDelete, printSample };
  window.autoSlashDate = autoSlashDate;

  // ============================================================
  // KICKOFF
  // ============================================================

  init().catch(e => console.error('[HistoryPage] init error:', e));

})();
