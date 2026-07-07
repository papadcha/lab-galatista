/**
 * dashboard.js
 * Εργαστήριο Λατομείων Γαλάτιστας
 * ─────────────────────────────────────────────────────────────
 * Έκδοση : 0.99.4
 * Ημ/νία  : 2026-06-02
 * ─────────────────────────────────────────────────────────────
 * Ιστορικό:
 *   0.99.4 — Χρησιμοποιεί get_init_status για block PDF
 *   0.99.0 — Προσθήκη επικεφαλίδας έκδοσης
 */
'use strict';

// ES module — φορτώνεται με πραγματικό <script type="module" src="...">
// (βλ. main-app.js: Pages.dashboard.module + navigateTo()), άρα το relative
// path παρακάτω λύνεται ως προς το πραγματικό path αυτού του αρχείου.
import { pyCall, App } from '../../main-app.js';
import { t } from '../../i18n/i18n.js';

window.Dashboard = (() => {

  let currentFilter = 'recent'; // default — ΠΑΝΤΑ ξεκινα με recent
  let allData       = {};       // cache δεδομένων

  // ============================================================
  // ΑΡΧΙΚΟΠΟΙΗΣΗ
  // ============================================================

  async function init() {
    setDate();
    await loadStats();
    // Εκκίνηση με recent filter — κάρτα ΤΕΛΕΥΤΑΙΑ ενεργή
    currentFilter = 'recent';
    document.querySelectorAll('.stat-clickable').forEach(c =>
      c.classList.remove('stat-active')
    );
    const recentCard = document.getElementById('stat-card-recent');
    if (recentCard) recentCard.classList.add('stat-active');
    await loadTable('recent');
  }

  function setDate() {
    const el = document.getElementById('dashboard-date');
    if (el) el.textContent = new Date().toLocaleDateString('el-GR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  // ============================================================
  // ΣΤΑΤΙΣΤΙΚΑ
  // ============================================================

  async function loadStats() {
    const stats = await pyCall('get_dashboard_stats');
    if (!stats) return;

    allData = stats;

    // CE Period
    setText('stat-ce-count', stats.ce_count ?? '—');
    setText('stat-ce-period', stats.ce_period ?? '');

    // Εκκρεμή
    setText('stat-pending', stats.pending ?? 0);

    // Τελευταία — εμφανίζει πόσα θα δείξει
    setText('stat-recent', stats.recent_count ?? 0);
    setText('stat-recent-sub', `${stats.recent_today ?? 0} ${t('dashboard.stat_recent_sub_today', 'σήμερα')}`);

    // Εκτός Προδιαγραφών
    setText('stat-fail', stats.fail ?? 0);

    // Χρωματισμός κάρτας εκτός αν υπάρχουν
    const failCard = document.getElementById('stat-card-fail');
    if (failCard && stats.fail > 0) {
      failCard.classList.add('stat-has-data');
    }
  }

  // ============================================================
  // ΦΙΛΤΡΑ — Toggle λογική
  // ============================================================

  async function setFilter(filter) {
    // Αν το ίδιο φίλτρο → επιστροφή στο recent
    if (filter === currentFilter && filter !== 'recent') {
      filter = 'recent';
    }

    currentFilter = filter;

    // Ενημέρωση οπτικής κατάστασης καρτών
    document.querySelectorAll('.stat-clickable').forEach(c =>
      c.classList.remove('stat-active')
    );
    const activeCard = document.getElementById(`stat-card-${filter}`);
    if (activeCard) activeCard.classList.add('stat-active');

    // Φόρτωση πίνακα με το νέο φίλτρο
    await loadTable(filter);
  }

  // ============================================================
  // ΠΙΝΑΚΑΣ
  // ============================================================

  async function loadTable(filter) {
    const tbody    = document.getElementById('dashboard-tbody');
    const title    = document.getElementById('table-title');
    const colExtra = document.getElementById('col-extra');

    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="empty-msg">${t('common.loading', 'Φόρτωση...')}</td></tr>`;

    // Τίτλος και επιπλέον στήλη ανά φίλτρο
    const config = {
      recent:  { title: t('dashboard.table_recent', 'Τελευταία Δείγματα'), extra: ''                                     },
      pending: { title: t('dashboard.table_pending', 'Εκκρεμή Δείγματα'),  extra: t('dashboard.extra_pending', 'Λείπει')    },
      fail:    { title: t('dashboard.table_fail', 'Εκτός Προδιαγραφών'),   extra: t('dashboard.extra_fail', 'Πρόβλημα')    },
    };

    if (title)    title.textContent    = config[filter]?.title ?? '';
    if (colExtra) colExtra.textContent = config[filter]?.extra ?? '';

    // Κλήση Python
    const samples = await pyCall('get_dashboard_samples', filter) || [];

    if (samples.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-msg">
        ${filter === 'pending' ? t('dashboard.empty_pending', 'Δεν υπάρχουν εκκρεμή δείγματα ✓') :
          filter === 'fail'    ? t('dashboard.empty_fail', 'Δεν υπάρχουν δείγματα εκτός προδιαγραφών ✓') :
                                 t('dashboard.empty_default', 'Δεν υπάρχουν δείγματα')}
      </td></tr>`;
      return;
    }

    tbody.innerHTML = samples.map(s => renderRow(s, filter)).join('');
  }

  function renderRow(s, filter) {
    // Επιπλέον στήλη ΜΟΝΟ για pending/fail
    let extraCell = '<td></td>';
    if (filter === 'pending') {
      const pending = App.pendingTests(s);
      extraCell = `<td><span style="color:var(--warn-light);font-size:12px;">
        ${pending.join(', ')}
      </span></td>`;
    } else if (filter === 'fail') {
      const fails = (s.failed_tests || []).map(f =>
        `<span style="color:var(--fail-light);font-size:12px;">${f.name}: ${f.value}</span>`
      ).join(', ');
      extraCell = `<td>${fails}</td>`;
    }

    return `
      <tr style="cursor:pointer;" ondblclick="Dashboard.openSample(${s.id})"
          title="${t('dashboard.row_hint', 'Διπλό κλικ για άνοιγμα')}">
        <td><span class="sample-code">${s.code}</span></td>
        <td>${App.formatDate(s.date)}</td>
        <td><strong>${App.formatProduct(s)}</strong></td>
        <td>${App.testBadges(s)}</td>
        ${extraCell}
      </tr>
    `;
  }

  // ============================================================
  // ΕΝΕΡΓΕΙΕΣ ΓΡΑΜΜΗΣ
  // ============================================================

  async function openSample(id) {
    const data = await pyCall('get_full_report', id);
    if (!data) { App.toast(t('dashboard.sample_not_found', 'Δεν βρέθηκε το δείγμα'), 'fail'); return; }

    const s     = data.sample;
    const tests = data.tests || {};

    App.showModal(
      `${s.code} — ${App.formatProduct(s)}`,
      buildSampleView(s, tests),
      [
        { label: t('common.close', 'Κλείσιμο'),  action: 'App.closeModal()', secondary: true },
        { label: t('common.delete', '🗑 Διαγραφή'), action: `Dashboard.deleteSample(${id})`, danger: true },
        { label: t('common.pdf', '▤ PDF'),       action: `Dashboard.printSample(${id})` },
        { label: t('common.edit', '✎ Επεξεργασία'), action: `Dashboard.editSample(${id})` },
      ]
    );
  }

  function buildSampleView(s, tests) {
    return `
      <!-- Στοιχεία δείγματος -->
      <div class="sample-info-grid">
        <div><span class="info-label">${t('dashboard.info_date', 'Ημερομηνία')}</span> ${App.formatDate(s.date)}</div>
        <div><span class="info-label">${t('dashboard.info_source', 'Προέλευση')}</span> ${s.source_name || '—'}</div>
        <div><span class="info-label">${t('dashboard.info_technician', 'Τεχνικός')}</span> ${s.technician_name || '—'}</div>
        <div><span class="info-label">${t('dashboard.info_batch', 'Παρτίδα')}</span> ${App.formatBatch(s.batch)}</div>
        <div><span class="info-label">${t('dashboard.info_location', 'Σημείο')}</span> ${s.location || '—'}</div>
        ${s.comments ? `<div class="full-width">
          <span class="info-label">${t('dashboard.info_comments', 'Σχόλια')}</span> ${s.comments}
        </div>` : ''}
      </div>

      <!-- Δοκιμές — 2 columns: αριστερά κοκκομετρία, δεξιά οι 3 -->
      <div class="tests-grid-2col">
        <div class="tests-col-left">
          ${buildTestSection(t('dashboard.test_sieve', 'Κοκκομετρία EN 933-1'), tests.sieve_analysis, 'sieve')}
        </div>
        <div class="tests-col-right">
          ${(s.category === 'ΧΟΝΔΡΟΚΟΚΚΟ' || s.category === 'ALL_IN') ? buildTestSection(t('dashboard.test_flakiness', 'Πλακοειδή EN 933-3'), tests.flakiness,       'fi') : ''}
          ${(s.category === 'ΛΕΠΤΟΚΟΚΚΟ'  || s.category === 'ALL_IN') ? buildTestSection(t('dashboard.test_se', 'Ισοδύναμο Άμμου EN 933-8'),  tests.sand_equivalent, 'se') : ''}
          ${(s.category === 'ΛΕΠΤΟΚΟΚΚΟ'  || s.category === 'ALL_IN') ? buildTestSection(t('dashboard.test_mb', 'Μπλε Μεθυλενίου EN 933-9'),  tests.methylene_blue,  'mb') : ''}
        </div>
      </div>
    `;
  }


  function buildTestSection(title, testData, type) {
    if (!testData) return `
      <div class="test-section test-empty">
        <div class="test-section-title">${title}</div>
        <div class="test-section-empty">${t('dashboard.test_empty', 'Δεν έχει καταχωρηθεί')}</div>
      </div>`;

    let content = '';

    if (type === 'sieve') {
      const an = testData.data?.analysis;
      const results = testData.data?.results || [];
      const d = testData.characteristic_diameters || {};
      content = `
        <div class="test-weights">
          <span class="badge badge-none">${t('dashboard.sieve_weight', 'Βάρος')}: ${an?.weight_initial || '—'}g</span>
          <span class="badge badge-none">${t('dashboard.sieve_dry', 'Ξηρό')}: ${an?.weight_dry || '—'}g</span>
          <span class="badge badge-none">${t('dashboard.sieve_washed', 'Πλυμένο')}: ${an?.weight_washed || '—'}g</span>
          <span class="badge badge-none">${t('dashboard.sieve_loss', 'Απώλεια')}: ${an?.wash_loss_pct || '—'}%</span>
        </div>
        <table class="mini-table">
          <thead><tr>
            <th>${t('dashboard.sieve_col_sieve', 'Κόσκινο')}</th>
            <th style="text-align:right">${t('dashboard.sieve_col_retained', 'Συγκρ.(g)')}</th>
            <th style="text-align:right">${t('dashboard.sieve_col_passing', 'Διερχ.(%)')}</th>
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


  async function editSample(id) {
    App.closeModal();
    // Περνάμε το id στη σελίδα Καταχώρησης
    window._currentSampleId = id;
    App.go('tests');
  }

  async function deleteSample(id) {
    App.closeModal();
    App.showModal(
      t('dashboard.delete_title', 'Διαγραφή Δείγματος'),
      `<p style="color:var(--fail);">${t('dashboard.delete_warning', '⚠ Η διαγραφή είναι μη αναστρέψιμη.<br>Θα διαγραφούν και όλες οι δοκιμές του δείγματος.')}</p>` +
      `<p>${t('dashboard.delete_confirm', 'Είστε σίγουροι;')}</p>`,
      [
        { label: t('common.cancel', 'Ακύρωση'),   action: 'App.closeModal()', secondary: true },
        { label: t('common.delete', '🗑 Διαγραφή'), action: `Dashboard.confirmDelete(${id})`, danger: true },
      ]
    );
  }

  async function confirmDelete(id) {
    App.closeModal();
    const ok = await pyCall('delete_sample', id);
    if (ok) {
      App.toast(t('dashboard.delete_success', 'Το δείγμα διαγράφηκε'), 'ok');
      await loadStats();
      await loadTable(currentFilter);
    } else {
      App.toast(t('dashboard.delete_error', 'Σφάλμα κατά τη διαγραφή'), 'fail');
    }
  }

  let _printInFlight = false;
  async function printSample(id) {
    if (_printInFlight) return; // αποτροπή διπλού-κλικ ενόσω παράγεται ήδη PDF
    _printInFlight = true;
    try {
      App.toast(t('dashboard.pdf_generating', 'Δημιουργία PDF…'), 'info');
      const opts = { sampleId: id, tests: ['sieve', 'flakiness', 'se', 'mb'] };
      const result = await window.pyBridge?.['generate-report-pdf']?.(opts);
      if (!result?.success) {
        App.toast(t('dashboard.pdf_error', 'Σφάλμα παραγωγής PDF: ') + (result?.error || ''), 'fail');
        return;
      }
      await window.pyBridge?.['open-pdf']?.(result.path);
    } finally {
      _printInFlight = false;
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return { init, setFilter, openSample, editSample, printSample, deleteSample, confirmDelete, _buildSampleView: buildSampleView };

})();

// Εκκίνηση — περιμένουμε να υπάρχει το κρίσιμο element
function waitAndInit(attempts) {
  if (document.getElementById('dashboard-tbody')) {
    window.Dashboard.init().catch(e => console.error('[Dashboard] init error:', e));
  } else if (attempts > 0) {
    setTimeout(() => waitAndInit(attempts - 1), 50);
  } else {
    console.error('[Dashboard] Timeout: dashboard-tbody not found');
  }
}
waitAndInit(20);
