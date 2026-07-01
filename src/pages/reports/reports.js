/**
 * reports.js
 * Εργαστήριο Λατομείων Γαλάτιστας
 * ─────────────────────────────────────────────────────────────
 * Έκδοση : 0.99.4
 * Ημ/νία  : 2026-06-02
 * ─────────────────────────────────────────────────────────────
 * Ιστορικό:
 *   0.99.4 — Περιοδική: stats table MB/SE/FI + date limits
 *   0.99.3 — Footer: αριθμός έκθεσης εξωτ. εργαστηρίου
 *   0.99.0 — Προσθήκη επικεφαλίδας έκδοσης
 * ─────────────────────────────────────────────────────────────
 * Ιστορικό:
 *   0.99.3 — Footer: αριθμός έκθεσης εξωτ. εργαστηρίου
 *   0.99.0 — Προσθήκη επικεφαλίδας έκδοσης
 */
(() => {

  // ============================================================
  // STATE
  // ============================================================

  const state = {
    activeTab:      'single',
    selectedSample: null,     // full report από get_full_report
    requiredTests:  [],
    specs:          [],       // specs του επιλεγμένου προϊόντος
    lastPdfPath:    null,     // τελευταίο παραχθέν PDF
    periodicData:   null,
  };

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

  function show(id) { el(id)?.classList.remove('hidden'); }
  function hide(id) { el(id)?.classList.add('hidden'); }

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    populateFilters();
    setDefaultDates();
  }

  function populateFilters() {
    const perProd   = el('per-product');
    const perSource = el('per-source');

    AppState.products?.forEach(p => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `${p.name}mm`;
      perProd?.appendChild(o);
    });

    // Πηγές
    pyCall('get_sources').then(sources => {
      (sources || []).forEach(s => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = `${s.code} — ${s.name}`;
        perSource?.appendChild(o);
      });
    });
  }

  function setDefaultDates() {
    const now  = new Date();
    const from = new Date(now.getFullYear(), 0, 1);  // 1 Ιανουαρίου τρέχοντος έτους
    const fmt  = d => {
      const dd   = String(d.getDate()).padStart(2,'0');
      const mm   = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };
    const fFrom = el('per-from');
    const fTo   = el('per-to');
    if (fFrom && !fFrom.value) fFrom.value = fmt(from);
    if (fTo   && !fTo.value)   fTo.value   = fmt(now);
  }

  // ============================================================
  // TAB NAVIGATION
  // ============================================================

  function switchTab(tab) {
    state.activeTab = tab;
    if (tab === 'periodic') {
      initPeriodicLimits().catch(e => console.warn('[Periodic] limits init:', e));
    }
    document.querySelectorAll('.settings-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab)
    );
    document.querySelectorAll('.settings-panel').forEach(p =>
      p.classList.toggle('active', p.id === `tab-${tab}`)
    );
  }

  // ============================================================
  // TAB A: ΔΕΛΤΙΟ ΑΠΟΤΕΛΕΣΜΑΤΩΝ
  // ============================================================

  async function searchSample() {
    const code = el('single-code-search')?.value?.trim();
    if (!code) return;

    const results = await pyCall('search_samples', null, null, null, code, 20) || [];
    const container = el('single-sample-results');
    if (!container) return;

    if (results.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin-top:6px;">Δεν βρέθηκαν αποτελέσματα</p>';
      return;
    }

    container.innerHTML = `
      <div style="margin-top:8px;border:1px solid var(--border);
                  border-radius:var(--radius);overflow:hidden;">
        ${results.slice(0,10).map(s => `
          <div class="clickable-row"
               onclick="ReportsPage.selectSample(${s.id})"
               style="padding:8px 12px;border-bottom:1px solid var(--border);
                      font-size:13px;cursor:pointer;">
            <span class="sample-code">${esc(s.code)}</span>
            <span style="color:var(--text-muted);margin:0 8px;">·</span>
            ${App.formatProduct(s)}
            <span style="color:var(--text-muted);margin:0 8px;">·</span>
            ${App.formatDate(s.date)}
          </div>
        `).join('')}
      </div>
    `;
  }

  async function selectSample(id) {
    el('single-sample-results').innerHTML = '';

    const [report, requiredTests] = [
      await pyCall('get_full_report', id),
      await pyCall('get_required_tests', id),
    ];

    if (!report) { App.toast('Σφάλμα φόρτωσης δείγματος', 'fail'); return; }

    state.selectedSample = report;
    state.requiredTests  = Array.isArray(requiredTests) ? requiredTests : [];
    state.lastPdfPath    = null;  // νέο δείγμα → νέο PDF

    const s = report.sample;
    el('single-code-search').value = s.code;
    el('si-code').innerHTML    = `<strong>${esc(s.code)}</strong>`;
    el('si-product').textContent = App.formatProduct(s);
    el('si-date').textContent    = App.formatDate(s.date);
    el('si-source').textContent  = s.location || '';

    // Checkboxes δοκιμών
    buildTestsCheckboxes();

    // Specs για κοκκομετρία
    state.specs = await pyCall('get_specifications', s.product_id) || [];
    buildSpecOptions();

    show('single-sample-info');
  }

  function buildTestsCheckboxes() {
    const container = el('single-tests-checkboxes');
    if (!container) return;
    // Κανονική σειρά παρουσίασης: sieve → flakiness → se → mb
    const ORDER = ['sieve', 'flakiness', 'se', 'mb'];
    const tests = [...state.requiredTests].sort(
      (a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)
    );

    container.innerHTML = tests.map(tt => {
      const history = state.selectedSample.tests || {};
      const testKey = tt === 'sieve'     ? 'sieve_analysis'
                         : tt === 'mb'       ? 'methylene_blue'
                         : tt === 'se'       ? 'sand_equivalent'
                         : 'flakiness';
      const testData = state.selectedSample.tests?.[testKey];
      // get_full_report επιστρέφει data nested ή flat
      const hasData  = !!(testData && (
        testData.data || testData.mb_value != null ||
        testData.se_final != null || testData.fi_index != null
      ));
      return `
        <label class="plan-check-card"
               style="${!hasData ? 'opacity:0.5;' : ''}">
          <input type="checkbox" data-test="${tt}"
                 ${hasData ? 'checked' : 'disabled'}
                 style="accent-color:var(--accent);"
                 onchange="ReportsPage.onTestToggle('${tt}', this.checked)">
          <div class="plan-check-content">
            <div class="plan-check-title">
              <strong>${esc(App.testLabel(tt))}</strong>
              <span class="plan-check-std">${esc(App.testStandard(tt))}</span>
            </div>
            <div class="plan-check-desc">
              ${hasData ? '✓ Υπάρχουν αποτελέσματα' : 'Δεν έχει εκτελεστεί'}
            </div>
          </div>
        </label>
      `;
    }).join('');
  }

  function onTestToggle(tt, checked) {
    state.lastPdfPath = null;  // αλλαγή επιλογών → νέο PDF
    if (tt === 'sieve') {
      checked ? show('sieve-options') : hide('sieve-options');
    }
  }

  function buildSpecOptions() {
    const container = el('sieve-spec-options');
    if (!container) return;

    // Μοναδικές spec_names
    const names = [...new Set(state.specs.map(s => s.spec_name))];
    if (names.length === 0) {
      container.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Δεν υπάρχουν προδιαγραφές για αυτό το προϊόν</span>';
      return;
    }

    container.innerHTML = names.map((name, i) => `
      <label style="display:flex;gap:6px;align-items:center;
                    font-size:12px;cursor:pointer;
                    background:var(--bg-card);border:1px solid var(--border);
                    padding:4px 10px;border-radius:12px;">
        <input type="checkbox" data-spec="${esc(name)}"
               ${i === 0 ? 'checked' : ''}
               style="accent-color:var(--accent);">
        ${esc(name)}
      </label>
    `).join('');

    // Εμφάνιση sieve options αν υπάρχει κοκκομετρία
    const hasSieve = state.requiredTests.includes('sieve');
    if (hasSieve) show('sieve-options');
  }

  // ============================================================
  // PREVIEW & PDF
  // ============================================================

  async function previewSingle() {
    if (!state.selectedSample) {
      App.toast('Επιλέξτε δείγμα πρώτα', 'warn');
      return;
    }

    const selectedTests = [...document.querySelectorAll(
      '#single-tests-checkboxes input[type="checkbox"]:checked'
    )].map(c => c.dataset.test).filter(Boolean);

    // Αν δεν υπάρχει επιλογή (κανένα checkbox), χρησιμοποιούμε όλες τις specs
    const checkedSpecs = [...document.querySelectorAll(
      '#sieve-spec-options input[type="checkbox"]:checked'
    )].map(c => c.dataset.spec).filter(Boolean);
    const selectedSpecs = checkedSpecs.length > 0
      ? checkedSpecs
      : [...new Set(state.specs.map(s => s.spec_name))];

    const showChart = el('opt-sieve-chart')?.checked ?? true;
    const showStats = el('opt-sieve-stats')?.checked ?? false;

    const html = await buildReportHTML({
      sample:       state.selectedSample,
      tests:        selectedTests,
      specs:        state.specs.filter(s => selectedSpecs.includes(s.spec_name)),
      showChart,
      showStats,
    });

    const preview = el('report-content');
    if (preview) preview.innerHTML = html;

    hide('single-options');
    show('single-preview');
  }

  function backToOptions() {
    hide('single-preview');
    show('single-options');
  }

  async function _generatePdf() {
    const s = state.selectedSample?.sample;
    if (!s) { App.toast('Δεν υπάρχει επιλεγμένο δείγμα', 'warn'); return null; }

    // Τρέχουσες επιλογές δοκιμών
    const selectedTests = [...document.querySelectorAll(
      '#single-tests-checkboxes input[type="checkbox"]:checked'
    )].map(c => c.dataset.test).filter(Boolean);

    App.toast('Δημιουργία PDF…', 'info');
    const opts   = { sampleId: s.id, sampleCode: s.code,
                     tests: selectedTests.length > 0
                            ? selectedTests
                            : ['sieve', 'flakiness', 'se', 'mb'] };
    // generate-report-pdf είναι IPC wrapper, όχι Python call
    const result = await window.pyBridge?.['generate-report-pdf']?.(opts);

    if (!result?.success) {
      App.toast('Σφάλμα παραγωγής PDF: ' + (result?.error || ''), 'fail');
      return null;
    }
    return result.path;
  }

  function _productFolder(s) {
    // Παράγει φάκελο τύπου "ΑΜΜ0-4" ή "3Α0-31.5"
    const code = s.product_code || '';
    const fmtD = v => {
      if (v == null) return '';
      const n = parseFloat(v);
      // Αφαίρεση .0 για ακέραιους, κρατάμε δεκαδικά για 31.5 κλπ
      return n % 1 === 0 ? String(Math.round(n)) : String(n);
    };
    const dMin = fmtD(s.d_min);
    const dMax = fmtD(s.d_max);
    if (code) return `${code}${dMin}-${dMax}`.replace(/[/\\?%*:|"<>]/g, '-');
    return (s.product_name || 'ΑΛΛΟ').replace(/[/\\?%*:|"<>]/g, '-').trim();
  }

  async function printReport() {
    const init = await pyCall('get_init_status');
    if (!init?.can_pdf) {
      App.toast('Απαιτείται ολοκλήρωση ρύθμισης — μεταβείτε στις Ρυθμίσεις', 'warn'); return;
    }
    const s = state.selectedSample?.sample;
    if (!s) { App.toast('Δεν υπάρχει επιλεγμένο δείγμα', 'warn'); return; }
    const pdfPath = await _generatePdf();
    if (!pdfPath) return;
    await window.pyBridge?.['open-pdf']?.(pdfPath);
  }

  async function saveReport() {
    const init = await pyCall('get_init_status');
    if (!init?.can_pdf) {
      App.toast('Απαιτείται ολοκλήρωση ρύθμισης — μεταβείτε στις Ρυθμίσεις', 'warn'); return;
    }
    if (!state.lastPdfPath) {
      state.lastPdfPath = await _generatePdf();
      if (!state.lastPdfPath) return;
    }
    const s    = state.selectedSample?.sample;
    const checkedTests = [...document.querySelectorAll(
      '#single-tests-checkboxes input[type="checkbox"]:checked'
    )].map(c => c.dataset.test).filter(Boolean);
    const testSuffix = checkedTests.length === 4 || checkedTests.length === 0
      ? 'FULL'
      : checkedTests.map(t => ({
          sieve: 'KKM', flakiness: 'FL', se: 'SE', mb: 'MB'
        }[t] || t.toUpperCase())).join('_');
    const name = s ? `${s.code}_${s.date}_${testSuffix}.pdf` : 'report.pdf';
    // Δομή φακέλου: productCode+dmin/dmax (πχ ΑΜΜ0-4)
    const productFolder = s ? _productFolder(s) : null;
    // Υποπερίοδος subfolder αν έχει οριστεί
    const subPeriod     = await pyCall('get_active_ce_period');
    const activeSub     = subPeriod?.active_subperiod;
    const subFolder     = activeSub?.pdf_subfolder ? `UP${activeSub.id}` : null;
    const saved = await window.pyBridge?.['save-pdf']?.(state.lastPdfPath, name, productFolder, subFolder);
    if (saved?.success) {
      App.toast('PDF αποθηκεύτηκε', 'ok');
    } else if (!saved?.canceled) {
      App.toast('Σφάλμα αποθήκευσης PDF', 'fail');
    }
  }

  async function emailReport() {
    const init = await pyCall('get_init_status');
    if (!init?.can_pdf) {
      App.toast('Απαιτείται ολοκλήρωση ρύθμισης — μεταβείτε στις Ρυθμίσεις', 'warn'); return;
    }
    if (!state.lastPdfPath) {
      state.lastPdfPath = await _generatePdf();
      if (!state.lastPdfPath) return;
    }
    const s = state.selectedSample?.sample;
    App.showModal('Αποστολή Email', `
      <div class="form-grid">
        <div class="form-group full-width">
          <label>Προς <span class="required">*</span></label>
          <input type="email" id="email-to" placeholder="recipient@example.com"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>Θέμα</label>
          <input type="text" id="email-subject"
                 value="Δελτίο Αποτελεσμάτων — ${esc(s?.code || '')}"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>Μήνυμα</label>
          <textarea id="email-body" rows="3"
                    style="width:100%;margin-top:4px;">Επισυνάπτεται το δελτίο αποτελεσμάτων δείγματος ${esc(s?.code || '')}.</textarea>
        </div>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '📧 Αποστολή', action: 'ReportsPage._sendEmail()' },
    ]);
  }

  async function _sendEmail() {
    const to      = document.getElementById('email-to')?.value?.trim();
    const subject = document.getElementById('email-subject')?.value?.trim();
    const body    = document.getElementById('email-body')?.value?.trim();

    if (!to) { App.toast('Εισάγετε email παραλήπτη', 'warn'); return; }
    App.closeModal();

    // Φόρτωση SMTP config
    const smtpCfg = await pyCall('get_smtp_config');
    if (!smtpCfg?.host) {
      App.toast('Ρυθμίστε πρώτα τις παραμέτρους email στις Ρυθμίσεις', 'warn');
      return;
    }

    App.toast('Αποστολή...', 'ok');
    const s = state.selectedSample?.sample;
    const result = await window.pyBridge?.['send-email']?.(smtpCfg, {
      to,
      subject: subject || `Δελτίο Αποτελεσμάτων — ${s?.code || ''}`,
      body,
      attachments: [{
        filename: `${s?.code || 'report'}.pdf`,
        path:     state.lastPdfPath,
      }],
    });

    if (result?.success) {
      App.toast('Email στάλθηκε επιτυχώς ✓', 'ok');
    } else {
      App.toast('Σφάλμα αποστολής: ' + (result?.error || ''), 'fail');
    }
  }

  // ============================================================
  // REPORT HTML BUILDER
  // ============================================================

  async function buildReportHTML({ sample, tests, specs, showChart, showStats }) {
    const s   = sample.sample;
    const t   = sample.tests || {};
    const lab     = await pyCall('get_lab_info') || {};
    // Η προεπισκόπηση ακολουθεί την ίδια γραμματοσειρά με το πραγματικό PDF (reportlab)
    document.documentElement.style.setProperty('--print-font', lab.pdf_font || 'IBMPlexSans');
    // Φόρτωση υποπεριόδου — χρησιμοποιούμε το subperiod_id του δείγματος (ακριβές)
    // αντί για αναζήτηση με ημερομηνία (που μπορεί να επιστρέψει λάθος υποπερίοδο)
    const subperiod = s.subperiod_id
      ? await pyCall('get_subperiod_by_id', s.subperiod_id) || null
      : await pyCall('get_active_ce_period').then(p => p?.active_subperiod || null).catch(() => null);
    const labReportNumber = subperiod?.lab_report_number || null;

    // Υπολογισμός συνολικού αριθμού σελίδων δυναμικά
    const pages = [];
    if (tests.includes('sieve') && t.sieve_analysis?.data) pages.push('sieve-table');
    if (tests.includes('sieve') && t.sieve_analysis?.data && showChart)  pages.push('sieve-chart');
    if (tests.includes('flakiness') && t.flakiness)        pages.push('flakiness');
    const hasSeOrMb = (tests.includes('se') && t.sand_equivalent) ||
                      (tests.includes('mb') && t.methylene_blue);
    if (hasSeOrMb) pages.push('se-mb');
    const totalPages = pages.length;

    // ── Header HTML (portrait) ─────────────────────────────
    function headerHTML(compact = false) {
      return `
        <div class="print-header ${compact ? 'print-header--compact' : ''}">
          <div class="print-header-logo">
            <img src="assets/logo.png" alt="Logo">
            <div class="print-header-company">
              <div class="print-header-name">${esc(lab.name || '')}</div>
              ${!compact ? `<div class="print-header-address">${esc(lab.address || '')}</div>` : ''}
            </div>
          </div>
          <div class="print-header-ce">
            <span class="print-header-ce-number">${esc(lab.ce_number || '')}</span>
            ${esc(lab.ce_body || '')}<br>
            Ισχύς: ${esc(lab.ce_valid_from || '')} — ${esc(lab.ce_valid_to || '')}
          </div>
        </div>`;
    }

    // ── Στοιχεία δείγματος ─────────────────────────────────
    function sampleMetaHTML() {
      return `
        <div class="print-doc-title">ΔΕΛΤΙΟ ΑΠΟΤΕΛΕΣΜΑΤΩΝ ΔΟΚΙΜΩΝ</div>
        <table class="print-meta-table">
          <tr>
            <td class="meta-label">Κωδικός Δείγματος</td>
            <td class="meta-value"><strong>${esc(s.code)}</strong></td>
            <td class="meta-label">Ημερομηνία Δειγματοληψίας</td>
            <td class="meta-value">${App.formatDate(s.date)}</td>
          </tr>
          <tr>
            <td class="meta-label">Προϊόν</td>
            <td class="meta-value">${App.formatProduct(s)}</td>
            <td class="meta-label">Τεχνικός</td>
            <td class="meta-value">${esc(s.technician_name || '—')}</td>
          </tr>
          ${s.location ? `<tr>
            <td class="meta-label">Σημείο Δειγματοληψίας</td>
            <td class="meta-value" colspan="3">${esc(s.location)}</td>
          </tr>` : ''}
          ${s.batch ? `<tr>
            <td class="meta-label">Παρτίδα</td>
            <td class="meta-value" colspan="3">${esc(s.batch)}</td>
          </tr>` : ''}
        </table>`;
    }

    // ── Footer με αρίθμηση ─────────────────────────────────
    function footerHTML(pageNum) {
      const reportLine = labReportNumber
        ? `<div class="print-footer-report">Έκθεση εξωτ. εργαστηρίου: ${esc(labReportNumber)}</div>`
        : '';
      return `
        <div class="print-footer-wrap">
          ${reportLine}
          <div class="print-footer">
            <div>Ημερομηνία έκδοσης: ${new Date().toLocaleDateString('el-GR')}</div>
            <div>Το παρόν δελτίο αφορά αποκλειστικά το ανωτέρω δείγμα.</div>
            <div class="print-page-number">Σελίδα ${pageNum} από ${totalPages}</div>
          </div>
        </div>`;
    }

    let html = `<div id="report-print-container" class="print-document">`;
    let pageNum = 0;

    // ── Σελίδα 1: Πίνακας κόσκινων (portrait) ─────────────
    if (tests.includes('sieve') && t.sieve_analysis?.data) {
      pageNum++;
      html += `
        <div class="print-page print-page--portrait" data-page="sieve-table">
          ${headerHTML()}
          ${sampleMetaHTML()}
          ${buildSieveTableOnly(t.sieve_analysis.data, specs)}
          ${footerHTML(pageNum)}
        </div>`;
    }

    // ── Σελίδα 2: Διάγραμμα (landscape) ───────────────────
    if (tests.includes('sieve') && t.sieve_analysis?.data && showChart) {
      pageNum++;
      html += `
        <div class="print-page print-page--landscape" data-page="sieve-chart">
          ${headerHTML(true)}
          <div class="print-section-title">Κοκκομετρική Ανάλυση — EN 933-1 — Διάγραμμα</div>
          <div class="print-chart-container">
            ${buildSieveChart(t.sieve_analysis.data.results?.filter(r => r.sieve_mm > 0) || [], specs)}
          </div>
          ${footerHTML(pageNum)}
        </div>`;
    }

    // ── Σελίδα 3: Πλακοειδή (portrait) ────────────────────
    if (tests.includes('flakiness') && t.flakiness) {
      pageNum++;
      html += `
        <div class="print-page print-page--portrait" data-page="flakiness">
          ${headerHTML()}
          ${sampleMetaHTML()}
          ${buildFlakinessSection(t.flakiness)}
          ${footerHTML(pageNum)}
        </div>`;
    }

    // ── Σελίδα 4: SE + MB (portrait) ──────────────────────
    if (hasSeOrMb) {
      pageNum++;
      html += `
        <div class="print-page print-page--portrait" data-page="se-mb">
          ${headerHTML()}
          ${sampleMetaHTML()}
          ${tests.includes('se') && t.sand_equivalent ? buildSESection(t.sand_equivalent) : ''}
          ${tests.includes('mb') && t.methylene_blue  ? buildMBSection(t.methylene_blue)  : ''}
          ${footerHTML(pageNum)}
        </div>`;
    }

    html += `</div>`;
    return html;
  }

  // ── Πίνακας κόσκινων (χωρίς chart) ──────────────────────
  function buildSieveTableOnly(data, specs) {
    const allResults = data.results || [];
    const results    = allResults.filter(r => r.sieve_mm > 0);
    const panResult  = allResults.find(r => r.sieve_mm === 0);
    const analysis   = data.analysis || {};

    const specNames = [...new Set(specs.map(s => s.spec_name))];

    let html = `
      <div class="print-section-title">Κοκκομετρική Ανάλυση — EN 933-1</div>
      <table class="print-data-table">
        <thead>
          <tr>
            <th>Κόσκινο (mm)</th>
            <th>Βάρος Συγκρ. (g)</th>
            <th>Διερχόμενο (%)</th>
            ${specNames.map(n => `<th>${esc(n)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>`;

    results.forEach(r => {
      const pct = r.passing_percent;
      html += `
        <tr>
          <td><strong>${r.sieve_mm}</strong></td>
          <td>${r.weight_retained?.toFixed(1) || '—'}</td>
          <td><strong>${pct?.toFixed(1) || '—'}%</strong></td>
          ${specNames.map(name => {
            const spec = specs.find(s => s.spec_name === name && s.sieve_mm === r.sieve_mm);
            if (!spec) return '<td>—</td>';
            const lo = spec.lower_limit, hi = spec.upper_limit;
            if (lo == null && hi == null) return '<td>—</td>';
            const cell = lo != null && hi != null ? `${lo}–${hi}%`
                       : lo != null ? `≥${lo}%` : `≤${hi}%`;
            const within = (lo == null || (pct != null && pct >= lo)) &&
                           (hi == null || (pct != null && pct <= hi));
            const color = within ? 'var(--green,#166534)' : 'var(--red-fail,#b91c1c)';
            return `<td style="color:${color};font-weight:bold">${cell}</td>`;
          }).join('')}
        </tr>`;
    });

    html += `</tbody>`;
    if (panResult) {
      html += `
        <tfoot>
          <tr class="row-total">
            <td><strong>Τυφλό (Pan)</strong></td>
            <td>${panResult.weight_retained?.toFixed(1) || '—'}</td>
            <td><strong>0.0%</strong></td>
            ${specNames.map(() => '<td>—</td>').join('')}
          </tr>
        </tfoot>`;
    }

    html += `</table>
      <div style="font-size:10px;color:#555;margin-top:4px;display:flex;gap:20px;">
        <span>Βάρος αρχικό: <strong>${analysis.weight_initial?.toFixed(1) || '—'}g</strong></span>
        <span>Βάρος ξηρού: <strong>${analysis.weight_dry?.toFixed(1) || '—'}g</strong></span>
        <span>Απώλεια πλύσης: <strong>${analysis.wash_loss_pct?.toFixed(2) || '—'}%</strong></span>
      </div>`;

    return html;
  }

  function buildSieveSection(data, specs, showChart) {
    // data = { analysis: {...}, results: [...] } από get_full_report
    // Διαχωρισμός κανονικών κόσκινων από pan (sieve_mm=0)
    const allResults = data.results || [];
    const results    = allResults.filter(r => r.sieve_mm > 0);
    const panResult  = allResults.find(r => r.sieve_mm === 0);
    const analysis = data.analysis || {};

    let html = `
      <div class="report-section">
        <div class="report-section-title">
          Κοκκομετρική Ανάλυση — EN 933-1
        </div>
        <table class="report-data-table">
          <thead>
            <tr>
              <th>Κόσκινο (mm)</th>
              <th>Βάρος Συγκρ. (g)</th>
              <th>Διερχόμενο (%)</th>
              ${specs.length > 0 ? specs
                  .filter((s,i,a) => a.findIndex(x => x.spec_name===s.spec_name)===i)
                  .map(s => `<th>${esc(s.spec_name)}</th>`).join('') : ''}
            </tr>
          </thead>
          <tbody>
    `;

    const specNames = [...new Set(specs.map(s => s.spec_name))];

    results.forEach(r => {
      const statusClass = getPassingStatus(r.passing_percent, r.sieve_mm, specs);
      html += `
        <tr class="${statusClass}">
          <td><strong>${r.sieve_mm}</strong></td>
          <td>${r.weight_retained?.toFixed(1) || '—'}</td>
          <td class="result-value">${r.passing_percent?.toFixed(1) || '—'}%</td>
          ${specNames.map(name => {
            const spec = specs.find(s => s.spec_name === name && s.sieve_mm === r.sieve_mm);
            if (!spec) return '<td>—</td>';
            const lo = spec.lower_limit;
            const hi = spec.upper_limit;
            const range = lo != null && hi != null ? `${lo}–${hi}%`
                        : lo != null ? `≥${lo}%`
                        : hi != null ? `≤${hi}%` : '—';
            return `<td>${range}</td>`;
          }).join('')}
        </tr>
      `;
    });

    html += `
          </tbody>
            ${panResult ? `
              <tr style="background:#f8fafc;font-weight:700;">
                <td><strong>Τυφλό (Pan)</strong></td>
                <td>${panResult.weight_retained?.toFixed(1) || '—'}</td>
                <td class="result-value">0.0%</td>
                ${specNames.map(() => '<td>—</td>').join('')}
              </tr>` : ''}
        </table>
        <div class="report-meta-row">
          <span>Βάρος αρχικό: <strong>${analysis.weight_initial?.toFixed(1) || '—'}g</strong></span>
          <span>Βάρος ξηρού: <strong>${analysis.weight_dry?.toFixed(1) || '—'}g</strong></span>
          <span>Απώλεια πλύσης: <strong>${analysis.wash_loss_pct?.toFixed(2) || '—'}%</strong></span>
        </div>
    `;

    if (showChart && results.length > 0) {
      html += buildSieveChart(results, specs);
    }

    html += `</div>`;
    return html;
  }

  function getPassingStatus(passing, sieve_mm, specs) {
    if (!specs.length) return '';
    const specEntry = specs.find(s => s.sieve_mm === sieve_mm);
    if (!specEntry) return '';
    const lo = specEntry.lower_limit;
    const hi = specEntry.upper_limit;
    // Αν δεν υπάρχουν όρια για αυτό το κόσκινο → ουδέτερη γραμμή
    if (lo == null && hi == null) return '';
    if (lo != null && passing < lo) return 'report-row-fail';
    if (hi != null && passing > hi) return 'report-row-fail';
    return 'report-row-ok';
  }

  // ─── Helper: PASS/FAIL/WARN badge ────────────────────────
  // ─── Helper: γραμμή ορίων κάτω από το αποτέλεσμα ────────
  // Ομαδοποιεί ανά spec_type, κρατά το αυστηρότερο όριο ανά τύπο,
  // εμφανίζει: "EN ≤ 10 g/kg  ·  ΠΕΤΕΠ 05-03-11-04 ≥ 55%"
  function buildLimitsLine(checks, unit) {
    if (!checks || checks.length === 0) return '';

    // Ομαδοποίηση ανά spec_type → κρατάμε το αυστηρότερο όριο
    const byType = {};
    checks.forEach(c => {
      const t = c.spec_type;
      if (!byType[t]) {
        byType[t] = { spec_type: t, spec_name: c.spec_name,
                      lower_limit: c.lower_limit, upper_limit: c.upper_limit };
      } else {
        // Αυστηρότερο: μεγαλύτερο lower ή μικρότερο upper
        if (c.lower_limit != null) {
          if (byType[t].lower_limit == null || c.lower_limit > byType[t].lower_limit)
            byType[t].lower_limit = c.lower_limit;
        }
        if (c.upper_limit != null) {
          if (byType[t].upper_limit == null || c.upper_limit < byType[t].upper_limit)
            byType[t].upper_limit = c.upper_limit;
        }
        // Για ΠΕΤΕΠ: κρατάμε το spec_name (είναι descriptive)
        if (t === 'ΠΕΤΕΠ') byType[t].spec_name = c.spec_name;
      }
    });

    const u = unit ? ` ${unit}` : '';
    const parts = Object.values(byType).map(g => {
      const label = g.spec_type === 'EN' ? 'EN' : esc(g.spec_name);
      const limit = g.lower_limit != null && g.upper_limit != null
        ? `${g.lower_limit}–${g.upper_limit}${u}`
        : g.lower_limit != null ? `≥ ${g.lower_limit}${u}`
        : g.upper_limit != null ? `≤ ${g.upper_limit}${u}` : null;
      return limit ? `${label} ${limit}` : null;
    }).filter(Boolean);

    if (parts.length === 0) return '';
    return `<tr>
      <td colspan="99" style="border-top:none;background:#fafafa;">
        <span style="display:block;text-align:right;font-size:11px;color:#6b7280;font-weight:400;">${parts.join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</span>
      </td>
    </tr>`;
  }

  function buildMBSection(data) {
    const mbVal  = parseFloat(data.mb_value) || 0;
    const mbStr  = mbVal ? mbVal.toFixed(2) : '—';
    const checks = data.spec_checks || [];

    const mbClass = mbVal <= 1.0 ? 'quality-high'
                  : mbVal <= 2.5 ? 'quality-medium'
                  : mbVal <= 4.0 ? 'quality-low'
                  : 'quality-fail';

    return `
      <div class="report-section">
        <div class="report-section-title">Μπλε Μεθυλενίου — EN 933-9</div>
        <table class="report-data-table">
          <tbody>
            <tr>
              <td class="meta-label">Βάρος Δείγματος M1</td>
              <td>${data.weight_sample || '—'}g</td>
              <td class="meta-label">Τελικός Όγκος V1</td>
              <td>${data.volume_final || '—'}ml</td>
            </tr>
            <tr class="report-row-total">
              <td colspan="3"><strong>MB Τιμή</strong></td>
              <td><strong class="result-big ${mbClass}">${mbStr} g/kg</strong></td>
            </tr>
            ${buildLimitsLine(checks, 'g/kg')}
          </tbody>
        </table>
      </div>
    `;
  }

  function buildSESection(data) {
    const meas    = data.measurements || [];
    const seVal  = parseFloat(data.se_final) || 0;
    const seStr  = seVal ? seVal.toFixed(0) : '—';
    const checks = data.spec_checks || [];

    const seClass = seVal >= 75 ? 'quality-high'
                  : seVal >= 60 ? 'quality-medium'
                  : seVal >= 50 ? 'quality-low'
                  : 'quality-fail';

    return `
      <div class="report-section">
        <div class="report-section-title">Ισοδύναμο Άμμου — EN 933-8</div>
        <table class="report-data-table">
          <thead>
            <tr><th>Μέτρηση</th><th>h₁ (mm)</th><th>h₂ (mm)</th><th>SE%</th></tr>
          </thead>
          <tbody>
            ${meas.map(m => `
              <tr>
                <td>Μ${m.measurement_no}</td>
                <td>${m.h1}</td>
                <td>${m.h2}</td>
                <td>${m.se_value?.toFixed(1) || '—'}%</td>
              </tr>
            `).join('')}
            <tr class="report-row-total">
              <td colspan="3"><strong>SE (Μέσος Όρος)</strong></td>
              <td><strong class="result-big ${seClass}">${seStr}%</strong></td>
            </tr>
            ${buildLimitsLine(checks, '%')}
          </tbody>
        </table>
      </div>
    `;
  }

  function buildFlakinessSection(data) {
    const fiVal  = parseFloat(data.fi_index) || 0;
    const fiStr  = fiVal ? `${Math.round(fiVal)}%` : '—';
    const checks = data.spec_checks || [];

    const fiClass = fiVal <= 15 ? 'quality-high'
                  : fiVal <= 35 ? 'quality-medium'
                  : fiVal <= 50 ? 'quality-low'
                  : 'quality-fail';

    // Κλάσματα — EN 933-3
    const fractions = data.fractions || [];
    let fractionsHTML = '';
    if (fractions.length > 0) {
      const totalFrac = fractions.reduce((s, f) => s + (f.weight_fraction || 0), 0);
      const totalPass = fractions.reduce((s, f) => s + (f.weight_passing  || 0), 0);
      const totalPct  = totalFrac > 0 ? (totalPass / totalFrac * 100).toFixed(1) : '—';
      fractionsHTML = `
        <table class="report-data-table" style="margin-bottom:10px;">
          <thead>
            <tr>
              <th>Κόσκινο Rᵢ (mm)</th>
              <th>Βάρος Κλάσματος (g)</th>
              <th>Πλακοειδή mᵢ (g)</th>
              <th>Πλακοειδή (%)</th>
            </tr>
          </thead>
          <tbody>
            ${fractions.map(f => {
              const pct = (f.weight_fraction || 0) > 0
                ? (f.weight_passing / f.weight_fraction * 100).toFixed(1)
                : '—';
              return `
                <tr>
                  <td>${f.sieve_mm}</td>
                  <td>${f.weight_fraction?.toFixed(1) ?? '—'}</td>
                  <td>${f.weight_passing?.toFixed(1)  ?? '—'}</td>
                  <td>${pct !== '—' ? pct + '%' : '—'}</td>
                </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="report-row-total">
              <td><strong>Σύνολο</strong></td>
              <td><strong>${totalFrac.toFixed(1)}g</strong></td>
              <td><strong>${totalPass.toFixed(1)}g</strong></td>
              <td><strong>${totalPct !== '—' ? totalPct + '%' : '—'}</strong></td>
            </tr>
          </tfoot>
        </table>`;
    }

    return `
      <div class="report-section">
        <div class="report-section-title">Δείκτης Πλακοειδούς — EN 933-3</div>
        ${fractionsHTML}
        <table class="report-data-table">
          <tbody>
            <tr>
              <td class="meta-label">FI (Δείκτης Πλακοειδούς)</td>
              <td><strong class="result-big ${fiClass}">${fiStr}%</strong></td>
            </tr>
            ${buildLimitsLine(checks, '%')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ============================================================
  // SVG ΓΡΑΦΗΜΑ ΚΟΚΚΟΜΕΤΡΙΑΣ
  // ============================================================

  function buildSieveChart(results, specs) {
    // ─── Διαστάσεις ───────────────────────────────────────
    const W = 700, H = 380;
    const margin = { top: 24, right: 40, bottom: 90, left: 68 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top  - margin.bottom;

    // ─── Σειρά κόσκινων ISO 565 (major + minor) ───────────
    // Ο άξονας x είναι: ΛΟΓΑΡΙΘΜΙΚΟΣ + ΑΝΕΣΤΡΑΜΜΕΝΟΣ
    // Αριστερά = μεγάλα κόσκινα, δεξιά = μικρά
    // Major και minor της σειράς ISO 565
    const allMajorISO  = [63, 45, 31.5, 22.4, 16, 11.2, 8, 5.6, 4, 2.8,
                          2, 1.4, 1, 0.71, 0.5, 0.355, 0.25, 0.18, 0.125, 0.09, 0.063];
    const allMinorISO  = [53, 37.5, 26.5, 19, 13.2, 9.5, 6.7, 4.75, 3.35,
                          2.36, 1.7, 1.18, 0.85, 0.6, 0.425, 0.3, 0.212, 0.15, 0.106, 0.075];

    // Εύρος x από τα πραγματικά κόσκινα του δείγματος
    const sieveValues = results.map(r => r.sieve_mm);
    const dataMin     = Math.min(...sieveValues);
    const dataMax     = Math.max(...sieveValues);

    // Padding στη log scale: ένα βήμα ISO πριν και μετά
    // Βρίσκουμε το αμέσως μικρότερο/μεγαλύτερο ISO value
    const isoAll = allMajorISO.concat(allMinorISO).sort((a,b) => a-b);
    const lowerISO = isoAll.filter(v => v < dataMin).pop()  || dataMin * 0.5;
    const upperISO = isoAll.filter(v => v > dataMax).shift() || dataMax * 2;

    const xMin = lowerISO;
    const xMax = upperISO;

    // Φιλτράρισμα major/minor που είναι μέσα στο εύρος
    const majorSieves = allMajorISO.filter(v => v >= xMin * 0.9 && v <= xMax * 1.1);
    const minorSieves = allMinorISO.filter(v => v >  xMin * 0.9 && v <  xMax * 1.1);

    // Log scale ΑΝΕΣΤΡΑΜΜΕΝΟΣ: μεγάλα → αριστερά
    const logMin  = Math.log10(xMin);
    const logMax  = Math.log10(xMax);
    const logSpan = logMax - logMin;
    const xScale  = mm =>
      margin.left + (1 - (Math.log10(mm) - logMin) / logSpan) * w;

    // Linear y: 0% κάτω → 100% πάνω
    const yScale = pct => margin.top + h * (1 - pct / 100);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 ${W} ${H}"
                    style="width:100%;max-width:${W}px;background:#fff;
                           font-family:'IBM Plex Sans',sans-serif;font-size:11px;">`;

    // ─── Background ──────────────────────────────────────
    svg += `<rect width="${W}" height="${H}" fill="#fff"/>`;
    svg += `<rect x="${margin.left}" y="${margin.top}"
                  width="${w}" height="${h}" fill="#fafafa"/>`;

    // ─── Major Y grid (0,10,20...100) ─────────────────────
    for (let p = 0; p <= 100; p += 10) {
      const y      = yScale(p);
      const isMaj  = p % 20 === 0;
      svg += `<line x1="${margin.left}" y1="${y}"
                    x2="${margin.left+w}" y2="${y}"
                    stroke="${isMaj ? '#d1d5db' : '#e9ecef'}"
                    stroke-width="${isMaj ? 1 : 0.5}"/>`;
      if (isMaj) {
        svg += `<text x="${margin.left-6}" y="${y+4}"
                      text-anchor="end" fill="#6b7280"
                      font-size="10">${p}</text>`;
      }
    }

    // ─── Major X grid + labels ─────────────────────────────
    majorSieves.forEach(mm => {
      const x = xScale(mm);
      svg += `<line x1="${x}" y1="${margin.top}"
                    x2="${x}" y2="${margin.top+h}"
                    stroke="#d1d5db" stroke-width="1"/>`;
      svg += `<line x1="${x}" y1="${margin.top+h}"
                    x2="${x}" y2="${margin.top+h+6}"
                    stroke="#374151" stroke-width="1.5"/>`;
      svg += `<text x="${x}" y="${margin.top+h+20}"
                    text-anchor="middle" fill="#374151"
                    font-size="11" font-weight="600">${mm}</text>`;
    });

    // ─── Minor X grid — δεκαδική λογαριθμική διάταξη ──────
    // Γραμμές στις θέσεις 2x,3x...9x για κάθε decade
    const decadeStart = Math.floor(Math.log10(xMin));
    const decadeEnd   = Math.ceil(Math.log10(xMax));
    for (let d = decadeStart; d <= decadeEnd; d++) {
      for (let m = 2; m <= 9; m++) {
        const mm = m * Math.pow(10, d);
        if (mm <= xMin * 0.99 || mm >= xMax * 1.01) continue;
        const x = xScale(mm);
        svg += `<line x1="${x}" y1="${margin.top}"
                      x2="${x}" y2="${margin.top+h}"
                      stroke="#e5e7eb" stroke-width="0.5"/>`;
      }
    }

    // ─── Axes ──────────────────────────────────────────────
    svg += `<line x1="${margin.left}" y1="${margin.top}"
                  x2="${margin.left}" y2="${margin.top+h}"
                  stroke="#374151" stroke-width="2"/>`;
    svg += `<line x1="${margin.left}" y1="${margin.top+h}"
                  x2="${margin.left+w}" y2="${margin.top+h}"
                  stroke="#374151" stroke-width="2"/>`;

    // ─── Axis labels ───────────────────────────────────────
    svg += `<text x="14" y="${margin.top + h/2}"
                  text-anchor="middle" fill="#6b7280"
                  font-size="11"
                  transform="rotate(-90,14,${margin.top+h/2})">Διερχόμενο (%)</text>`;

    // ─── Ζώνη προδιαγραφών (filled polygon) ───────────────
    const specNames  = [...new Set(specs.map(s => s.spec_name))];
    const specColors = ['#dc2626','#16a34a','#d97706','#7c3aed'];

    specNames.forEach((name, idx) => {
      const color = specColors[idx % specColors.length];
      const grp   = specs
        .filter(s => s.spec_name === name)
        .sort((a,b) => b.sieve_mm - a.sieve_mm);  // μεγάλα → μικρά

      // Σχεδιάζουμε σύμβολα (διαμάντια) μόνο για κόσκινα
      // που υπάρχουν στα αποτελέσματα ΚΑΙ έχουν όριο
      const resultSieves = new Set(results.map(r => r.sieve_mm));
      // diamond(cx,cy,r) → path
      const diamond = (cx, cy, r) =>
        `M${cx},${cy-r} L${cx+r},${cy} L${cx},${cy+r} L${cx-r},${cy} Z`;

      grp.forEach(s => {
        if (s.lower_limit == null && s.upper_limit == null) return;
        if (s.sieve_mm < xMin || s.sieve_mm > dataMax) return;  // εκτός εύρους μετρημένων
        const x = xScale(s.sieve_mm);
        const r = 5;
        if (s.upper_limit != null) {
          const y = yScale(s.upper_limit);
          svg += `<path d="${diamond(x, y, r)}"
                        fill="${color}" opacity="0.85"/>`;
        }
        if (s.lower_limit != null) {
          const y = yScale(s.lower_limit);
          svg += `<path d="${diamond(x, y, r)}"
                        fill="none" stroke="${color}" stroke-width="1.5"/>`;
        }
      });
    });

    // ─── Καμπύλη αποτελέσματος ────────────────────────────
    // Διαχωρισμός pan (sieve_mm=0) από κανονικά
    const allRes  = [...results];
    const panRes  = allRes.find(r => r.sieve_mm === 0);
    const mainRes = allRes.filter(r => r.sieve_mm > 0)
                         .sort((a,b) => b.sieve_mm - a.sieve_mm); // μεγάλα → μικρά

    // Θέση pan στο γράφημα: κάτω από το μικρότερο κόσκινο
    // x = μισό log-step κάτω από το min sieve
    const minSieveVal = Math.min(...mainRes.map(r => r.sieve_mm));
    const panX        = xScale(minSieveVal / 2.5); // ~μισό log-step κάτω

    // Καμπύλη κανονικών κόσκινων
    const pts = mainRes
      .map(r => `${xScale(r.sieve_mm).toFixed(1)},${yScale(r.passing_percent).toFixed(1)}`)
      .join(' ');

    // Επέκταση καμπύλης μέχρι το pan (passing=0%)
    const lastMainPt = mainRes[mainRes.length - 1];
    const extendedPts = pts + (panRes
      ? ` ${panX.toFixed(1)},${yScale(0).toFixed(1)}`
      : '');

    svg += `<polyline points="${extendedPts}" fill="none"
                      stroke="#1d4ed8" stroke-width="2.5"
                      stroke-linejoin="round" stroke-linecap="round"/>`;

    // Σημεία κανονικών κόσκινων
    mainRes.forEach(r => {
      const cx = xScale(r.sieve_mm).toFixed(1);
      const cy = yScale(r.passing_percent).toFixed(1);
      svg += `<circle cx="${cx}" cy="${cy}" r="4.5"
                      fill="#fff" stroke="#1d4ed8" stroke-width="2"/>`;
    });

    // Σημείο pan (διαφορετικό σχήμα — τετράγωνο)
    if (panRes) {
      const py = yScale(0).toFixed(1);
      svg += `<rect x="${(panX - 5).toFixed(1)}" y="${(parseFloat(py) - 5).toFixed(1)}"
                    width="10" height="10"
                    fill="#fff" stroke="#1d4ed8" stroke-width="2"/>`;
      svg += `<text x="${panX.toFixed(1)}" y="${(parseFloat(py) + 18).toFixed(1)}"
                    text-anchor="middle" fill="#374151"
                    font-size="9" font-weight="600">Pan</text>`;
      svg += `<text x="${panX.toFixed(1)}" y="${(parseFloat(py) + 28).toFixed(1)}"
                    text-anchor="middle" fill="#6b7280"
                    font-size="8">${panRes.weight_retained?.toFixed(1)}g</text>`;
    }

    // ─── Legend ────────────────────────────────────────────
    const legendY = margin.top + h + 54;
    svg += `<text x="${margin.left+w/2}" y="${margin.top+h+34}"
                  text-anchor="middle" fill="#374151"
                  font-size="12">Άνοιγμα βροχίδας (mm)</text>`;    let   lx      = margin.left;

    svg += `<line x1="${lx}" y1="${legendY}" x2="${lx+24}" y2="${legendY}"
                  stroke="#1d4ed8" stroke-width="2.5"/>`;
    svg += `<circle cx="${lx+12}" cy="${legendY}" r="4"
                    fill="#fff" stroke="#1d4ed8" stroke-width="2"/>`;
    svg += `<text x="${lx+30}" y="${legendY+4}"
                  fill="#374151" font-size="10">Αποτέλεσμα</text>`;
    lx += 110;

    specNames.forEach((name, idx) => {
      const color = specColors[idx % specColors.length];
      const cx = lx + 8, cy = legendY, d = 6;
      svg += `<polygon points="${cx},${cy-d} ${cx+d},${cy} ${cx},${cy+d} ${cx-d},${cy}"
                       fill="${color}" stroke="${color}" stroke-width="1"/>`;
      svg += `<text x="${lx+20}" y="${legendY+4}"
                    fill="#374151" font-size="10">${esc(name)}</text>`;
      lx += name.length * 6.5 + 32;
    });

    svg += '</svg>';
    return `<div class="report-chart">${svg}</div>`;
  }

  // ============================================================
  // TAB B: ΠΕΡΙΟΔΙΚΗ ΑΝΑΦΟΡΑ
  // ============================================================

  let _periodicLimits = { min: null, max: null }; // όρια υποπεριόδου

  async function initPeriodicLimits() {
    const period = await pyCall('get_active_ce_period');
    const sub    = period?.active_subperiod;
    if (!sub) return;

    // min = valid_from υποπεριόδου
    const minDate = sub.valid_from || period.valid_from || '';
    // max = σήμερα
    const today   = new Date().toLocaleDateString('el-GR').split('/').map(p=>p.padStart(2,'0')).join('/');

    _periodicLimits = { min: minDate, max: today };

    // Εμφάνιση hints
    const fmtMin = _fmtDateGR(minDate);
    const fmtMax = today;
    const fromHint = el('per-from-hint');
    const toHint   = el('per-to-hint');
    if (fromHint) fromHint.textContent = fmtMin;
    if (toHint)   toHint.textContent   = fmtMax;

    // Προσυμπλήρωση αν κενά
    const fromEl = el('per-from');
    const toEl   = el('per-to');
    if (fromEl && !fromEl.value) fromEl.value = fmtMin;
    if (toEl   && !toEl.value)   toEl.value   = fmtMax;
  }

  function _fmtDateGR(d) {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
      const [y,m,day] = d.substring(0,10).split('-');
      return `${day}/${m}/${y}`;
    }
    return d;
  }

  function _toISOLocal(v) {
    if (!v || !v.trim()) return null;
    const s = v.trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return null;
  }

  function validatePeriodicDates() {
    const fromVal = el('per-from')?.value?.trim();
    const toVal   = el('per-to')?.value?.trim();
    const fromISO = _toISOLocal(fromVal);
    const toISO   = _toISOLocal(toVal);
    const minISO  = _toISOLocal(_fmtDateGR(_periodicLimits.min) || _periodicLimits.min);
    const maxISO  = _toISOLocal(_periodicLimits.max);

    let valid = true;
    const fromEl = el('per-from');
    const toEl   = el('per-to');
    const btn    = el('per-submit-btn');

    // Reset styles
    if (fromEl) fromEl.style.borderColor = '';
    if (toEl)   toEl.style.borderColor   = '';

    if (fromISO && minISO && fromISO < minISO) {
      if (fromEl) fromEl.style.borderColor = 'var(--fail)';
      valid = false;
    }
    if (toISO && maxISO && toISO > maxISO) {
      if (toEl) toEl.style.borderColor = 'var(--fail)';
      valid = false;
    }
    if (fromISO && toISO && fromISO > toISO) {
      if (fromEl) fromEl.style.borderColor = 'var(--fail)';
      if (toEl)   toEl.style.borderColor   = 'var(--fail)';
      valid = false;
    }

    if (btn) btn.disabled = !valid;
    return valid;
  }

  async function loadPeriodic() {
    const productId = parseInt(el('per-product')?.value) || null;
    if (!productId) {
      App.toast('Επιλέξτε προϊόν για να δημιουργήσετε περιοδική αναφορά', 'warn');
      return;
    }
    if (!validatePeriodicDates()) {
      App.toast('Οι ημερομηνίες είναι εκτός ορίων υποπεριόδου', 'warn');
      return;
    }
    const sourceId  = parseInt(el('per-source')?.value)  || null;

    const from = _toISOLocal(el('per-from')?.value);
    const to   = _toISOLocal(el('per-to')?.value);

    App.toast('Φόρτωση δεδομένων...', 'ok');

    const samples = await pyCall('search_samples',
      productId, from, to, null, 500) || [];

    // Φιλτράρισμα κατά πηγή (client-side)
    const filtered = sourceId
      ? samples.filter(s => s.source_id === sourceId)
      : samples;

    if (filtered.length === 0) {
      App.toast('Δεν βρέθηκαν δείγματα για αυτή την περίοδο', 'warn');
      return;
    }

    // Φόρτωση full reports (μόνο sieve για στατιστικά)
    const reports = [];
    for (const s of filtered.slice(0, 100)) {
      const r = await pyCall('get_full_report', s.id);
      if (r) reports.push(r);
    }

    // Φόρτωση υποπεριόδου για δηλωμένες τιμές
    const activePeriod = await pyCall('get_active_ce_period');
    const activeSub    = activePeriod?.active_subperiod || null;

    state.periodicData = { samples: filtered, reports, productId, from, to, activeSub };
    state.periodicSpecs = [];
    state.periodicAvgResults = [];

    renderPeriodicSummary();
    await renderPeriodicSieveChart();
    renderPeriodicTable();

    show('periodic-content');
  }

  let _activeStatsTab = 'mb';

  function renderPeriodicStats() {
    const { reports, activeSub } = state.periodicData;
    const container = el('periodic-stats-table');
    if (!container) return;

    const extMb = activeSub?.ext_mb_value ?? null;
    const extSe = activeSub?.ext_se_value ?? null;
    const extFl = activeSub?.ext_fl_value ?? null;

    container.innerHTML = `
      <div style="display:flex;gap:0;margin-bottom:12px;border-bottom:2px solid var(--border);">
        <button id="stab-mb" class="periodic-stab active"
                onclick="ReportsPage._switchStatsTab('mb')">
          Μπλε Μεθυλενίου
        </button>
        <button id="stab-se" class="periodic-stab"
                onclick="ReportsPage._switchStatsTab('se')">
          Ισοδύναμο Άμμου
        </button>
        <button id="stab-fi" class="periodic-stab"
                onclick="ReportsPage._switchStatsTab('fi')">
          Πλακοειδή
        </button>
      </div>
      <div id="stats-tab-content"></div>
      ${!extMb && !extSe && !extFl ? '<p style="font-size:12px;color:var(--text-muted);margin-top:8px;">⚠ Δεν υπάρχουν δηλωμένες τιμές — καταχωρήστε τα στοιχεία έκθεσης στις Ρυθμίσεις.</p>' : ''}
    `;
    _activeStatsTab = 'mb';
    _renderStatsTabContent('mb', reports, extMb, extSe, extFl);
  }

  function _switchStatsTab(tab) {
    _activeStatsTab = tab;
    document.querySelectorAll('.periodic-stab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`stab-${tab}`);
    if (btn) btn.classList.add('active');
    const { reports, activeSub } = state.periodicData;
    _renderStatsTabContent(tab, reports,
      activeSub?.ext_mb_value ?? null,
      activeSub?.ext_se_value ?? null,
      activeSub?.ext_fl_value ?? null);
  }

  function _renderStatsTabContent(tab, reports, extMb, extSe, extFl) {
    const container = el('stats-tab-content');
    if (!container) return;

    const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
    const max = arr => arr.length ? Math.max(...arr) : null;
    const fmt = (v, dec=2) => v != null ? (+v).toFixed(dec) : '—';
    const diffFmt = (mo, decl, dec=2) => {
      if (mo == null || decl == null) return '—';
      const d = mo - decl;
      return (d >= 0 ? '+' : '') + d.toFixed(dec);
    };
    const diffColor = v => {
      if (v === '—') return '';
      const n = parseFloat(v);
      return isNaN(n) || n === 0 ? '' : n > 0 ? 'color:var(--warn);' : 'color:var(--accent);';
    };

    let vals, ext, dec, unit, label;
    if (tab === 'mb') {
      vals = reports.map(r => r.tests?.methylene_blue?.mb_value).filter(v => v != null);
      ext = extMb; dec = 2; unit = 'g/kg'; label = 'MB';
    } else if (tab === 'se') {
      vals = reports.map(r => r.tests?.sand_equivalent?.se_final).filter(v => v != null);
      ext = extSe; dec = 1; unit = '%'; label = 'SE';
    } else {
      vals = reports.map(r => r.tests?.flakiness?.fi_index).filter(v => v != null);
      ext = extFl; dec = 1; unit = '%'; label = 'FI';
    }

    const mo  = avg(vals);
    const mx  = max(vals);
    const dif = diffFmt(mo, ext, dec);

    const rows = [
      ['Πλήθος',    vals.length || '—', ''],
      ['Μ.Ο.',      fmt(mo, dec),        'font-weight:600;'],
      ['Μέγιστη',   fmt(mx, dec),        ''],
      ['Δηλωμένη',  fmt(ext, dec),       'color:var(--text-muted);'],
      ['Απόκλιση',  dif,                 `font-style:italic;${diffColor(dif)}`],
    ];

    container.innerHTML = `
      <table style="border-collapse:collapse;font-size:13px;min-width:220px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="text-align:left;padding:8px 16px;color:var(--text-muted);font-weight:500;width:110px;"></th>
            <th style="text-align:center;padding:8px 32px;font-weight:700;font-size:15px;">
              ${label} <span style="font-size:11px;font-weight:400;color:var(--text-muted);">(${unit})</span>
            </th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([lbl, val, style]) => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:10px 16px;color:var(--text-muted);font-size:12px;">${lbl}</td>
              <td style="text-align:center;padding:10px 32px;font-size:15px;${style}">${val}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderPeriodicSummary() {
    const { samples, reports, activeSub } = state.periodicData;
    const container = el('periodic-summary');
    if (!container) return;

    const avg  = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
    const max  = arr => arr.length ? Math.max(...arr) : null;
    const fmt  = (v, dec=2) => v != null ? (+v).toFixed(dec) : '—';
    const diff = (mo, decl, dec=2) => {
      if (mo == null || decl == null) return null;
      const d = mo - decl;
      return (d >= 0 ? '+' : '') + d.toFixed(dec);
    };
    const diffColor = d => {
      if (!d) return '';
      const n = parseFloat(d);
      return isNaN(n)||n===0 ? '' : n>0 ? 'color:var(--warn)' : 'color:var(--accent)';
    };

    const mbVals = reports.map(r=>r.tests?.methylene_blue?.mb_value).filter(v=>v!=null);
    const seVals = reports.map(r=>r.tests?.sand_equivalent?.se_final).filter(v=>v!=null);
    const fiVals = reports.map(r=>r.tests?.flakiness?.fi_index).filter(v=>v!=null);
    const withSieve = reports.filter(r=>r.tests?.sieve_analysis).length;

    const extMb = activeSub?.ext_mb_value ?? null;
    const extSe = activeSub?.ext_se_value ?? null;
    const extFl = activeSub?.ext_fl_value ?? null;

    const mbMo = avg(mbVals); const mbMx = max(mbVals); const mbDiff = diff(mbMo,extMb);
    const seMo = avg(seVals); const seMx = max(seVals); const seDiff = diff(seMo,extSe,1);
    const fiMo = avg(fiVals); const fiMx = max(fiVals); const fiDiff = diff(fiMo,extFl,1);

    const statCard = (label, unit, vals, mo, mx, ext, dif, dec) => `
      <div class="form-card" style="flex:1;min-width:180px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                    letter-spacing:0.5px;color:var(--accent);margin-bottom:10px;">
          ${label} <span style="color:var(--text-muted);font-weight:400;">(${unit})</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          ${[
            ['Πλήθος',   vals.length||'—', ''],
            ['Μ.Ο.',     fmt(mo,dec),       'font-weight:600'],
            ['Μέγιστη',  fmt(mx,dec),       ''],
            ['Δηλωμένη', fmt(ext,dec),      'color:var(--text-muted)'],
            ['Απόκλιση', dif||'—',          diffColor(dif)],
          ].map(([lbl,val,style],i) => `
            <tr style="border-top:1px solid var(--border);">
              <td style="padding:6px 0;font-size:12px;color:var(--text-muted);">${lbl}</td>
              <td style="padding:6px 0;text-align:right;${style}">${val}</td>
            </tr>
          `).join('')}
        </table>
      </div>`;

    // Χρησιμοποιούμε wrapper div αντί για stats-cards flex container
    container.style.display = 'block';
    container.innerHTML = `
      <!-- Γραμμή 1: Σύνολο δειγμάτων -->
      <div class="form-card" style="display:flex;justify-content:space-between;
           align-items:center;margin-bottom:12px;">
        <span style="font-size:13px;color:var(--text-muted);">Σύνολο Δειγμάτων</span>
        <span style="font-size:28px;font-weight:700;color:var(--accent);">${samples.length}</span>
      </div>

      <!-- Γραμμή 2: 3 cards MB/SE/FI ισόποσα -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:0;">
        ${statCard('MB','g/kg', mbVals, mbMo, mbMx, extMb, mbDiff, 2)}
        ${statCard('SE','%',    seVals, seMo, seMx, extSe, seDiff, 1)}
        ${statCard('FI','%',    fiVals, fiMo, fiMx, extFl, fiDiff, 1)}
      </div>
    `;
  }

  function _buildSieveStatsTable(avgResults, activeSub) {
    if (!avgResults || avgResults.length === 0) return '';

    const sieves = avgResults.filter(r => r.sieve_mm > 0)
                             .sort((a,b) => b.sieve_mm - a.sieve_mm);

    const fmt = v => v != null ? (+v).toFixed(1) : '—';

    // Δηλωμένες τιμές κοκκομετρίας από ext_sieve_results
    let extSieve = {};
    if (activeSub?.ext_sieve_results) {
      try {
        const arr = JSON.parse(activeSub.ext_sieve_results);
        arr.forEach(r => { extSieve[r.sieve_mm] = r.passing_pct; });
      } catch(e) {}
    }

    const rowStyle = i => i % 2 === 0
      ? 'background:var(--bg-card);'
      : 'background:var(--surface);';

    const rows = [
      { label: 'Μ.Ο. (%)',    vals: sieves.map(s => fmt(s.passing_percent)) },
      { label: 'Μέγιστη (%)', vals: sieves.map(s => fmt(s.max)) },
      { label: 'Δηλωμένη (%)',vals: sieves.map(s => fmt(extSieve[s.sieve_mm] ?? null)) },
    ];

    return `
      <div class="form-card" style="margin-bottom:12px;overflow-x:auto;">
        <div style="font-size:13px;font-weight:700;color:var(--accent);
                    text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">
          Κοκκομετρία
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
          Πλήθος: ${sieves[0]?.count ?? '—'}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:400px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border);">
              <td style="padding:8px 12px;font-size:11px;font-weight:600;
                         color:var(--text-muted);width:130px;">Κόσκινο (mm)</td>
              ${sieves.map(s => `
                <td style="text-align:center;padding:8px 10px;font-weight:600;">
                  ${s.sieve_mm}
                </td>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map((r,i) => `
              <tr style="${rowStyle(i)}border-bottom:1px solid var(--border);">
                <td style="padding:8px 12px;font-size:12px;color:var(--text-muted);
                           font-weight:500;">${r.label}</td>
                ${r.vals.map(v => `
                  <td style="text-align:center;padding:8px 10px;">${v}</td>
                `).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function renderPeriodicSieveChart() {
    const { reports, productId, activeSub } = state.periodicData;
    const container = el('periodic-sieve-chart');
    if (!container) return;

    // Συλλογή sieve results
    const sieveReports = reports.filter(r => r.tests?.sieve_analysis?.data);
    if (sieveReports.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);">Δεν υπάρχουν κοκκομετρίες στην επιλεγμένη περίοδο.</p>';
      return;
    }

    // Υπολογισμός μέσων όρων ανά κόσκινο
    const sieveData = {};
    sieveReports.forEach(r => {
      const results = r.tests.sieve_analysis.data?.results || [];
      results.forEach(res => {
        if (!sieveData[res.sieve_mm]) sieveData[res.sieve_mm] = [];
        sieveData[res.sieve_mm].push(res.passing_percent);
      });
    });

    const avgResults = Object.entries(sieveData).map(([mm, values]) => ({
      sieve_mm:        parseFloat(mm),
      passing_percent: values.reduce((a,b) => a+b, 0) / values.length,
      count:           values.length,
      min:             Math.min(...values),
      max:             Math.max(...values),
    })).sort((a,b) => b.sieve_mm - a.sieve_mm);  // descending: μεγάλα→μικρά

    // Specs
    const specs = productId
      ? (await pyCall('get_specifications', productId) || [])
      : [];

    // Build spec checkboxes
    const specNames = [...new Set(specs.map(s => s.spec_name))];
    const perSpecs = el('per-spec-options');
    if (perSpecs) {
      perSpecs.innerHTML = specNames.map((name, i) => `
        <label style="display:flex;gap:5px;align-items:center;
                      font-size:11px;cursor:pointer;
                      background:var(--bg-card);border:1px solid var(--border);
                      padding:3px 8px;border-radius:10px;">
          <input type="checkbox" data-spec="${esc(name)}"
                 ${i===0?'checked':''}
                 style="accent-color:var(--accent);"
                 onchange="ReportsPage._rerenderSieveChart()">
          ${esc(name)}
        </label>
      `).join('');
    }

    // Αποθηκεύω για rerender
    state.periodicSpecs = specs;
    state.periodicAvgResults = avgResults;

    const checkedNames = specNames.length > 0 ? [specNames[0]] : [];

    // Πίνακας στατιστικών κοκκομετρίας + chart
    container.innerHTML =
      _buildSieveStatsTable(avgResults, activeSub) +
      buildPeriodicSieveChart(avgResults, specs, checkedNames);
  }

  function _rerenderSieveChart() {
    if (!state.periodicData) return;
    const { reports, productId } = state.periodicData;
    const specs = state.periodicSpecs || [];
    const checkedNames = [...document.querySelectorAll('#per-spec-options input:checked')]
      .map(c => c.dataset.spec);
    const container = el('periodic-sieve-chart');
    if (container) {
      const avgResults = state.periodicAvgResults || [];
      container.innerHTML = buildPeriodicSieveChart(avgResults, specs, checkedNames);
    }
  }

  function buildPeriodicSieveChart(avgResults, specs, selectedSpecs) {
    // Ίδια με buildSieveChart αλλά με min/max zone
    const W = 680, H = 340;
    const margin = { top: 20, right: 30, bottom: 60, left: 60 };  // +10 για y-labels
    const w = W - margin.left - margin.right;
    const h = H - margin.top  - margin.bottom;

    // Αφαιρούμε sieve_mm=0 (τυφλό/pan) — log10(0) = -Infinity
    const avgResultsFiltered = avgResults.filter(r => r.sieve_mm > 0);
    const sieves = avgResultsFiltered.map(r => r.sieve_mm);

    // Ίδια λογική με buildSieveChart: δυναμικό εύρος + ISO padding
    const allISOsorted = [63,45,31.5,22.4,16,11.2,8,5.6,4,2.8,2,1.4,1,0.71,
                          0.5,0.355,0.25,0.18,0.125,0.09,0.063].sort((a,b)=>a-b);
    const dataMinP = Math.min(...sieves);
    const dataMaxP = Math.max(...sieves);
    const xMinP    = allISOsorted.filter(v => v < dataMinP).pop()  || dataMinP * 0.5;
    const xMaxP    = allISOsorted.filter(v => v > dataMaxP).shift() || dataMaxP * 2;
    const logMinP  = Math.log10(xMinP);
    const logSpanP = Math.log10(xMaxP) - logMinP;

    // ΑΝΕΣΤΡΑΜΜΕΝΟΣ: μεγάλα αριστερά
    const xScale = mm =>
      margin.left + (1 - (Math.log10(mm) - logMinP) / logSpanP) * w;

    const majorSievesP = [63,45,31.5,22.4,16,11.2,8,5.6,4,2.8,2,1.4,1,0.71,
                          0.5,0.355,0.25,0.18,0.125,0.09,0.063]
                         .filter(v => v >= xMinP * 0.9 && v <= xMaxP * 1.1);
    const yScale = pct => margin.top + h - (pct / 100) * h;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 ${W} ${H}"
                    style="width:100%;max-width:${W}px;
                           font-family:'IBM Plex Sans',sans-serif;font-size:11px;">`;
    svg += `<rect width="${W}" height="${H}" fill="transparent"/>`;
    // Plot area background λευκό για ευκρίνεια
    svg += `<rect x="${margin.left}" y="${margin.top}" width="${w}" height="${h}" fill="#fff"/>`;

    // Grid
    for (let p = 0; p <= 100; p += 20) {
      const y = yScale(p);
      svg += `<line x1="${margin.left}" y1="${y}" x2="${margin.left+w}" y2="${y}"
                    stroke="#e5e7eb" stroke-width="1"/>`;
      svg += `<text x="${margin.left-6}" y="${y+4}" text-anchor="end" fill="#6b7280">${p}%</text>`;
    }

    // Axes
    svg += `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top+h}"
                  stroke="#374151" stroke-width="1.5"/>`;
    svg += `<line x1="${margin.left}" y1="${margin.top+h}" x2="${margin.left+w}" y2="${margin.top+h}"
                  stroke="#374151" stroke-width="1.5"/>`;

    // X labels — χρησιμοποιούμε major ISO sieves του εύρους
    majorSievesP.forEach(mm => {
      const x = xScale(mm);
      const isMeasured = sieves.some(s => Math.abs(s-mm) < 0.001);
      svg += `<line x1="${x}" y1="${margin.top}"
                    x2="${x}" y2="${margin.top+h}"
                    stroke="#d1d5db" stroke-width="${isMeasured ? 1 : 0.5}"/>`;
      svg += `<line x1="${x}" y1="${margin.top+h}"
                    x2="${x}" y2="${margin.top+h+6}"
                    stroke="#374151" stroke-width="1.5"/>`;
      svg += `<text x="${x}" y="${margin.top+h+18}"
                    text-anchor="middle" fill="#374151"
                    font-size="10" font-weight="${isMeasured ? '600' : '400'}">${mm}</text>`;
    });
    svg += `<text x="${margin.left+w/2}" y="${H-4}"
                  text-anchor="middle" fill="#374151"
                  font-size="12">Άνοιγμα βροχίδας (mm)</text>`;

    // Min/Max zone — μόνο αν υπάρχει πραγματική διακύμανση
    const hasVariance = avgResultsFiltered.some(r => r.max - r.min > 0.5);
    if (hasVariance) {
      const topPoints = avgResultsFiltered.map(r => `${xScale(r.sieve_mm)},${yScale(r.max)}`).join(' ');
      const botPoints = [...avgResultsFiltered].reverse().map(r => `${xScale(r.sieve_mm)},${yScale(r.min)}`).join(' ');
      svg += `<polygon points="${topPoints} ${botPoints}"
                       fill="#93c5fd" opacity="0.25"/>`;
    }

    // Avg line
    const avgPoints = avgResultsFiltered.map(r => `${xScale(r.sieve_mm)},${yScale(r.passing_percent)}`).join(' ');
    svg += `<polyline points="${avgPoints}" fill="none" stroke="#2563eb" stroke-width="2.5"/>`;
    avgResultsFiltered.forEach(r => {
      svg += `<circle cx="${xScale(r.sieve_mm)}" cy="${yScale(r.passing_percent)}"
                      r="4" fill="#2563eb"/>`;
    });

    // Spec lines (επιλεγμένες) — selectedSpecs περνιέται ως παράμετρος
    const specColors = ['#dc2626','#16a34a','#d97706'];

    const diamond = (cx, cy, r) =>
      `M${cx},${cy-r} L${cx+r},${cy} L${cx},${cy+r} L${cx-r},${cy} Z`;

    [...new Set(specs.map(s => s.spec_name))]
      .filter(name => selectedSpecs.includes(name))
      .forEach((name, idx) => {
        const color = specColors[idx % specColors.length];
        const group = specs.filter(s => s.spec_name === name);
        group.forEach(s => {
          if (s.lower_limit == null && s.upper_limit == null) return;
          if (s.sieve_mm <= 0) return;
          const x = xScale(s.sieve_mm);
          const r = 5;
          if (s.upper_limit != null) {
            const y = yScale(s.upper_limit);
            svg += `<path d="${diamond(x, y, r)}" fill="${color}" opacity="0.85"/>`;
          }
          if (s.lower_limit != null) {
            const y = yScale(s.lower_limit);
            svg += `<path d="${diamond(x, y, r)}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
          }
        });
      });

    svg += '</svg>';
    return svg;
  }

  function renderPeriodicTable() {
    const { reports } = state.periodicData;
    const container   = el('periodic-table');
    if (!container) return;

    container.innerHTML = `
      <table class="data-table full-width">
        <thead>
          <tr>
            <th>Κωδικός</th>
            <th>Ημερομηνία</th>
            <th>Προϊόν</th>
            <th>Κοκκομ.</th>
            <th>MB (g/kg)</th>
            <th>SE (%)</th>
            <th>FI (%)</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => {
            const s  = r.sample;
            const t  = r.tests || {};
            return `
              <tr class="clickable-row"
                  onclick="ReportsPage.openSampleFromPeriodic(${s.id})">
                <td><span class="sample-code">${esc(s.code)}</span></td>
                <td>${App.formatDate(s.date)}</td>
                <td>${App.formatProduct(s)}</td>
                <td>${t.sieve_analysis?.data ? '✓' : '—'}</td>
                <td>${t.methylene_blue?.mb_value?.toFixed(2) || '—'}</td>
                <td>${t.sand_equivalent?.se_final?.toFixed(1) || '—'}</td>
                <td>${t.flakiness?.fi_index != null ? Math.round(t.flakiness.fi_index) + '%' : '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function openSampleFromPeriodic(id) {
    window._currentSampleId = id;
    App.go('tests');
  }

  async function exportPeriodicPdf() {
    if (!state.periodicData) {
      App.toast('Φορτώστε δεδομένα πρώτα', 'warn');
      return;
    }
    const { productId, from: fromDate, to: toDate } = state.periodicData;
    const sourceId = parseInt(el('per-source')?.value) || null;
    const result = await window.pyBridge?.['generate-periodic-pdf']?.({
      productId, from: fromDate, to: toDate, sourceId
    });
    if (result?.success) {
      state.lastPdfPath = result.path;
      const { productId, from, to } = state.periodicData;
      const rawName  = AppState.products?.find(p => p.id === productId)?.name || 'report';
      const productName = rawName.replace(/[/\\?%*:|"<>\s]/g, '_');
      const fromStr = (from || '').replace(/-/g, '');
      const toStr   = (to   || '').replace(/-/g, '');
      const fileName = `statistics_${productName}_${fromStr}_${toStr}.pdf`;
      const saved = await window.pyBridge?.['save-statistics']?.(result.path, fileName);
      if (saved?.success) App.toast('Στατιστικά αποθηκεύτηκαν', 'ok');
      else App.toast('Σφάλμα αποθήκευσης αρχείου', 'fail');
    } else {
      App.toast('Σφάλμα παραγωγής PDF: ' + (result?.error || ''), 'fail');
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  async function generatePdfLibrary(silent = false) {
    const cfg = await pyCall('get_init_status');
    if (!cfg?.can_pdf) {
      App.toast('Απαιτείται ολοκλήρωση ρύθμισης', 'warn'); return null;
    }
    // Χρησιμοποιούμε get-data-folder που λαμβάνει υπόψη το archive mode
    const dfResult  = await window.pyBridge?.['get-data-folder']?.();
    const dataFolder = dfResult?.folder;
    if (!dataFolder) {
      App.toast('Δεν βρέθηκε φάκελος δεδομένων', 'warn'); return null;
    }
    const statusEl = document.getElementById('pdf-library-status');
    if (statusEl) {
      statusEl.style.display  = 'block';
      statusEl.style.borderColor = 'var(--border)';
      statusEl.textContent    = '⏳ Παραγωγή PDF βιβλιοθήκης...';
    }
    if (!silent) App.toast('Παραγωγή PDF βιβλιοθήκης...', 'info');
    const result = await window.pyBridge?.['generate-pdf-library']?.(dataFolder);
    if (result?.ok) {
      const msg = '✅ Παρήχθησαν ' + result.generated + ' PDF' +
                  (result.skipped > 0 ? ' · Παραλείφθηκαν ' + result.skipped : '');
      if (statusEl) {
        statusEl.style.borderColor = 'rgba(22,101,52,.4)';
        let html = msg;
        if (result.errors?.length) {
          html += '<br><span style="color:var(--text-muted);font-size:12px;">Παραλείφθηκαν:<br>' +
                  result.errors.map(e => e).join('<br>') + '</span>';
        }
        statusEl.innerHTML = html;
      }
      if (!silent) {
        App.toast(msg, 'ok');
        if (result.errors?.length) {
          result.errors.forEach(e => App.toast('⚠ ' + e, 'warn'));
        }
      }
      window.pyBridge?.['cloud-sync']?.().catch(() => {});
    } else {
      const err = 'Σφάλμα: ' + (result?.error || 'Άγνωστο');
      if (statusEl) { statusEl.style.borderColor = 'rgba(185,28,28,.4)'; statusEl.textContent = err; }
      if (!silent) App.toast(err, 'fail');
    }
    return result;
  }

  window.ReportsPage = {
    switchTab,
    // Tab A
    searchSample, selectSample,
    onTestToggle,
    previewSingle, backToOptions,
    printReport, saveReport, emailReport, _sendEmail,
    generatePdfLibrary,
    // Tab B
    loadPeriodic, exportPeriodicPdf, validatePeriodicDates, initPeriodicLimits, _switchStatsTab,
    _rerenderSieveChart, openSampleFromPeriodic,
  };
  window.autoSlashDate = window.autoSlashDate || function(input) {
    if (!input) return;
    const old = input.value;
    let v = old.replace(/[^0-9]/g, '');
    if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5);
    v = v.slice(0,10);
    if (v !== old) { input.value = v; input.setSelectionRange(v.length, v.length); }
  };

  // ============================================================
  // KICKOFF
  // ============================================================

  init().catch(e => console.error('[ReportsPage] init error:', e));

})();
