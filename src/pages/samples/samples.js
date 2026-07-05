/**
 * samples.js
 * Εργαστήριο Λατομείων Γαλάτιστας
 * ─────────────────────────────────────────────────────────────
 * Έκδοση : 0.99.0
 * Ημ/νία  : 2026-06-02
 */
// ES module — φορτώνεται με πραγματικό <script type="module" src="...">
// (βλ. main-app.js: Pages.samples.module + navigateTo()).
import { pyCall, pyCallStrict, App, AppState } from '../../main-app.js';

(() => {

  // ============================================================
  // STATE
  // ============================================================

  const state = {
    currentStep:     1,
    selectedProduct: null,    // αντικείμενο προϊόντος από AppState.products
    selectedSource:  null,    // αντικείμενο προέλευσης
    requiredTests:   new Set(), // test_types στο πλάνο
    savedSampleId:   null,    // μετά την αποθήκευση
    savedSampleCode: null,
  };

  // ============================================================
  // UI HELPERS
  // ============================================================


  // Auto-format ημερομηνίας: προσθήκη / αυτόματα
  function autoSlashDate(input) {
    const pos = input.selectionStart;
    const old = input.value;
    let v = old.replace(/[^0-9]/g, '');
    if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5);
    v = v.slice(0,10);
    if (v !== old) {
      input.value = v;
      // Διατήρηση cursor position
      const newPos = v.length;
      input.setSelectionRange(newPos, newPos);
    }
  }

  function el(id) { return document.getElementById(id); }

  // Εμφάνιση μόνο ενός form-step (αξιοποιεί τα υπάρχοντα CSS classes:
  // .form-step κρυμμένο, .form-step.active ορατό)
  function showOnly(stepId) {
    ['step-1','step-2','step-3','step-success','legacy-redirect'].forEach(s => {
      const node = el(s);
      if (!node) return;
      node.classList.remove('active');
      node.classList.add('hidden');
    });
    const target = el(stepId);
    if (target) {
      target.classList.add('active');
      target.classList.remove('hidden');
    }
  }

  // Ενημέρωση breadcrumb (κάθε bc-step έχει id="bc-N")
  function updateBreadcrumb(stepNumber) {
    [1, 2, 3].forEach(n => {
      const bc = el(`bc-${n}`);
      if (!bc) return;
      bc.classList.remove('active', 'done');
      if (n === stepNumber)      bc.classList.add('active');
      else if (n  < stepNumber)  bc.classList.add('done');
    });
  }

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    if (window._editSampleId) {
      delete window._editSampleId;
      showOnly('legacy-redirect');
      return;
    }

    // Setup
    await populateSources();
    populateProducts();
    populateTechnicians();
    setDefaultDate();

    // Listeners
    el('new-product')?.addEventListener('change', onProductChange);
    el('new-source')?.addEventListener('change', onSourceChange);

    // Πρόταση κωδικού (χρειάζεται source + product)
    await regenerateCode();

    showOnly('step-1');
    updateBreadcrumb(1);
  }

  async function populateSources() {
    // Φόρτωση από backend (πιο fresh από AppState)
    const sources = await pyCall('get_sources') || [];
    const sel = el('new-source');
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    sources.forEach(s => {
      const opt = document.createElement('option');
      opt.value       = s.id;
      opt.textContent = `${s.code} — ${s.name}`;
      opt.dataset.code = s.code;
      sel.appendChild(opt);
    });
    // Default: πρώτη πηγή
    if (sources.length > 0) {
      sel.value = sources[0].id;
      state.selectedSource = sources[0];
    }
  }

  function onSourceChange() {
    const sel = el('new-source');
    const id  = parseInt(sel.value) || null;
    // Βρες από options
    const opt = sel.options[sel.selectedIndex];
    state.selectedSource = id ? { id, code: opt.dataset.code, name: opt.text } : null;
    regenerateCode();
  }

  function populateProducts() {
    const sel  = el('new-product');
    if (!sel) return;
    AppState.products.forEach(p => {
      const opt = document.createElement('option');
      opt.value       = p.id;
      opt.textContent = p.name;
      opt.dataset.cat = p.category || '';
      sel.appendChild(opt);
    });
  }

  function populateTechnicians() {
    const sel = el('new-technician');
    if (!sel) return;
    AppState.technicians.forEach(t => {
      const opt = document.createElement('option');
      opt.value       = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
  }

  function setDefaultDate() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    const today = `${dd}/${mm}/${yyyy}`;
    const dateInput = el('new-date');
    if (dateInput && !dateInput.value) dateInput.value = today;
  }

  // Μετατροπή ημερομηνίας → yyyy-mm-dd για αποθήκευση
  // Δέχεται: dd/mm/yyyy, d/m/yyyy, ddmmyyyy
  function parseDate(v) {
    if (!v) return '';
    const s = v.trim().replace(/[.\-]/g, '/');
    let iso = null;
    const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m1) iso = `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
    const m2 = s.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (m2) iso = `${m2[3]}-${m2[2]}-${m2[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s;
    if (!iso) return v;
    // Έλεγχος εγκυρότητας
    const d = new Date(iso);
    if (isNaN(d.getTime()) || !d.toISOString().startsWith(iso)) return '';
    return iso;
  }

  function onProductChange() {
    const sel       = el('new-product');
    const productId = parseInt(sel.value) || null;
    state.selectedProduct = AppState.products.find(p => p.id === productId) || null;

    const info = el('product-info');
    if (state.selectedProduct) {
      const cat = state.selectedProduct.category || '—';
      const allowed = App.allowedTestsFor(cat).map(App.testLabel).join(', ');
      info.textContent = `Κατηγορία: ${cat} · Δοκιμές: ${allowed || '—'}`;
    } else {
      info.textContent = '';
    }
    // Ανανέωση κωδικού με νέο προϊόν
    regenerateCode();
  }

  // ============================================================
  // BUTTON ACTIONS
  // ============================================================

  async function regenerateCode() {
    const sourceId  = parseInt(el('new-source')?.value)  || 1;
    const productId = parseInt(el('new-product')?.value) || null;
    if (!productId) {
      el('new-code').value = '';
      return;
    }
    const sampleDate = el('new-date')?.value?.trim() || null;
    const result = await pyCall('generate_sample_code', sourceId, productId, sampleDate);
    // result είναι {code, rename_id, rename_to} ή null
    if (result && result.code) {
      el('new-code').value = result.code;
      // Αποθήκευση για χρήση στο save
      state._codeInfo = result;
    }
  }

  async function addTechnician() {
    App.showModal('Νέος Τεχνικός', `
      <div class="form-group">
        <label>Όνομα</label>
        <input type="text" id="new-tech-name" placeholder="Όνομα τεχνικού" autofocus>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '+ Προσθήκη', action: 'SamplesPage._doAddTechnician()' },
    ]);
    setTimeout(() => document.getElementById('new-tech-name')?.focus(), 100);
  }

  async function _doAddTechnician() {
    const name = document.getElementById('new-tech-name')?.value?.trim();
    App.closeModal();
    if (!name) return;
    const id = await pyCall('add_technician', name);
    if (!id) {
      App.toast('Σφάλμα προσθήκης τεχνικού', 'fail');
      return;
    }
    // Ενημέρωση cache + dropdown
    AppState.technicians.push({ id, name: name.trim(), active: 1 });
    const sel = el('new-technician');
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name.trim();
    opt.selected = true;
    sel.appendChild(opt);
    App.toast('Ο τεχνικός προστέθηκε', 'ok');
  }

  // ============================================================
  // STEP NAVIGATION
  // ============================================================

  function goToStep(n) {
    if (n === 2) {
      if (!validateStep1()) return;
      buildPlanCheckboxes();
      _commitStep(n);
      return;
    }
    if (n === 3) {
      if (state.requiredTests.size === 0) {
        App.confirm(
          'Κανένα πλάνο δοκιμών',
          'Δεν έχετε επιλέξει καμία δοκιμή. Μπορείτε να τις ορίσετε ' +
          'αργότερα από τη σελίδα Δοκιμές. Θέλετε να συνεχίσετε;',
          () => { buildConfirmation(); _commitStep(n); }
        );
        return;
      }
      buildConfirmation();
    }
    _commitStep(n);
  }

  function _commitStep(n) {
    state.currentStep = n;
    showOnly(`step-${n}`);
    updateBreadcrumb(n);
  }

  function validateStep1() {
    const code    = el('new-code').value.trim();
    const rawDate = el('new-date').value.trim();
    const date    = parseDate(rawDate);
    const pid     = parseInt(el('new-product').value);

    if (!code) {
      App.toast('Συμπληρώστε τον κωδικό δείγματος', 'fail');
      el('new-code').focus();
      return false;
    }
    if (!rawDate) {
      App.toast('Συμπληρώστε ημερομηνία δειγματοληψίας', 'fail');
      el('new-date').focus();
      return false;
    }
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate) && !/^\d{8}$/.test(rawDate.replace(/\//g,''))) {
      App.toast('Ημερομηνία σε μορφή ηη/μμ/εεεε (πχ 23/05/2026)', 'warn');
      el('new-date').focus();
      return false;
    }
    if (!pid) {
      App.toast('Επιλέξτε προϊόν', 'fail');
      el('new-product').focus();
      return false;
    }
    if (!state.selectedProduct?.category) {
      App.toast('Το προϊόν δεν έχει κατηγορία — έλεγξε τις Ρυθμίσεις', 'fail');
      return false;
    }
    return true;
  }


  // ============================================================
  // STEP 2 — Πλάνο δοκιμών
  // ============================================================

  function buildPlanCheckboxes() {
    const cat       = state.selectedProduct.category;
    const allowed   = App.allowedTestsFor(cat);
    const container = el('plan-checkboxes');
    const summary   = el('plan-summary');

    // Σύνοψη
    summary.innerHTML = `
      <div class="plan-summary-row">
        <span class="plan-label">Προϊόν:</span>
        <span class="plan-value">${escapeHTML(state.selectedProduct.name)}
              mm</span>
      </div>
      <div class="plan-summary-row">
        <span class="plan-label">Κατηγορία:</span>
        <span class="plan-value badge ${App.catBadgeClass(cat)}">${escapeHTML(cat)}</span>
      </div>
      <div class="plan-summary-row">
        <span class="plan-label">Διαθέσιμες δοκιμές:</span>
        <span class="plan-value">${allowed.length}</span>
      </div>
    `;

    // Initial state: αν δεν έχει αρχίσει, προτείνουμε όλες τις διαθέσιμες
    if (state.requiredTests.size === 0) {
      allowed.forEach(tt => state.requiredTests.add(tt));
    } else {
      // Φιλτράρισμα τυχόν δοκιμών που ξέρουμε ότι δεν είναι allowed
      // (πχ αν ο χρήστης άλλαξε προϊόν στο step 1)
      [...state.requiredTests].forEach(tt => {
        if (!allowed.includes(tt)) state.requiredTests.delete(tt);
      });
    }

    // Checkboxes — εμφανίζουμε ΜΟΝΟ τις επιτρεπόμενες
    container.innerHTML = allowed.map(tt => {
      const checked = state.requiredTests.has(tt) ? 'checked' : '';
      const meta    = AppState.testRegistry?.[tt] || {};
      return `
        <label class="plan-check-card">
          <input type="checkbox"
                 data-test="${tt}"
                 ${checked}
                 onchange="SamplesPage.togglePlan(this)">
          <div class="plan-check-content">
            <div class="plan-check-title">
              <strong>${escapeHTML(meta.label || tt)}</strong>
              <span class="plan-check-std">${escapeHTML(meta.standard || '')}</span>
            </div>
            <div class="plan-check-desc">${describeTest(tt)}</div>
          </div>
        </label>
      `;
    }).join('');
  }

  function togglePlan(checkbox) {
    const tt = checkbox.dataset.test;
    if (checkbox.checked) state.requiredTests.add(tt);
    else                  state.requiredTests.delete(tt);
  }

  function describeTest(testType) {
    return ({
      sieve:     'Κοκκομετρική κατανομή με υγρό κοσκίνισμα.',
      flakiness: 'Έλεγχος πλακοειδών κόκκων.',
      mb:        'Δοκιμή μπλε μεθυλενίου για πρόσμικτα.',
      se:        'Ισοδύναμο άμμου — έλεγχος καθαρότητας.',
    })[testType] || '';
  }

  // ============================================================
  // STEP 3 — Επιβεβαίωση
  // ============================================================

  function buildConfirmation() {
    const code = el('new-code').value.trim();
    const date = parseDate(el('new-date').value);
    const tech = el('new-technician');
    const techName = tech.options[tech.selectedIndex]?.text || '—';
    const loc  = el('new-location').value.trim() || '—';
    const bat  = el('new-batch').value.trim()    || '—';
    const com  = el('new-comments').value.trim() || '';

    el('confirm-info').innerHTML = `
      <h3 class="confirm-title">Στοιχεία Δείγματος</h3>
      <div class="confirm-grid">
        <div><span class="lbl">Κωδικός:</span> <code>${escapeHTML(code)}</code></div>
        <div><span class="lbl">Ημερομηνία:</span> ${App.formatDate(date)}</div>
        <div><span class="lbl">Προϊόν:</span> ${escapeHTML(state.selectedProduct.name)}
             mm</div>
        <div><span class="lbl">Κατηγορία:</span> ${escapeHTML(state.selectedProduct.category)}</div>
        <div><span class="lbl">Τεχνικός:</span> ${escapeHTML(techName)}</div>
        <div><span class="lbl">Σημείο:</span> ${escapeHTML(loc)}</div>
        <div><span class="lbl">Παρτίδα:</span> ${escapeHTML(bat)}</div>
        ${com ? `<div class="confirm-grid-full">
                  <span class="lbl">Σχόλια:</span> ${escapeHTML(com)}
                </div>` : ''}
      </div>
    `;

    const planList = [...state.requiredTests];
    el('confirm-plan').innerHTML = `
      <h3 class="confirm-title">Πλάνο Δοκιμών (${planList.length})</h3>
      <div class="confirm-plan-list">
        ${planList.length === 0
          ? '<em class="text-muted">Καμία δοκιμή — μπορεί να οριστεί αργότερα.</em>'
          : planList.map(tt => `
              <span class="badge badge-info">
                ${escapeHTML(App.testLabel(tt))}
                <small>(${escapeHTML(App.testStandard(tt))})</small>
              </span>
            `).join(' ')}
      </div>
    `;
  }

  // ============================================================
  // SAVE
  // ============================================================

  async function saveSample() {
    const btn = el('btn-save');
    btn.disabled    = true;
    btn.textContent = 'Αποθήκευση...';

    try {
      const code = el('new-code').value.trim();
      const date = parseDate(el('new-date').value);
      const pid  = parseInt(el('new-product').value);
      const tid  = parseInt(el('new-technician').value) || null;
      const loc  = el('new-location').value.trim() || null;
      const bat  = el('new-batch').value.trim()    || null;
      const com  = el('new-comments').value.trim() || null;
      const plan = [...state.requiredTests];

      // Χρησιμοποιούμε codeInfo από regenerateCode αν ο κωδικός δεν άλλαξε χειροκίνητα
      const codeInfo = (state._codeInfo && state._codeInfo.code === code)
        ? state._codeInfo
        : { code, rename_id: null, rename_to: null };

      const sourceId = parseInt(el('new-source')?.value) || 1;

      // create_sample_with_rename χειρίζεται suffix + plan atomically
      const sampleId = await pyCallStrict('create_sample_with_plan_and_rename',
        codeInfo, date, pid, tid, loc, bat, com, plan, sourceId
      );

      if (!sampleId) {
        throw new Error('Δεν επιστράφηκε id');
      }

      state.savedSampleId   = sampleId;
      state.savedSampleCode = code;

      el('success-message').innerHTML = `
        Το δείγμα <code>${escapeHTML(code)}</code> καταχωρήθηκε
        ${plan.length > 0
            ? `με <strong>${plan.length}</strong> δοκιμές στο πλάνο.`
            : 'χωρίς δοκιμές στο πλάνο.'}
      `;

      showOnly('step-success');
      updateBreadcrumb(3);  // κρατάμε ως completed
      App.toast('Δείγμα δημιουργήθηκε επιτυχώς', 'ok');

    } catch (err) {
      App.toast('Σφάλμα: ' + err.message, 'fail');
      btn.disabled    = false;
      btn.textContent = '✓ Αποθήκευση Δείγματος';
    }
  }

  // ============================================================
  // POST-SAVE ACTIONS
  // ============================================================

  function startNewSample() {
    // Reset state
    state.currentStep     = 1;
    state.selectedProduct = null;
    state.requiredTests   = new Set();
    state.savedSampleId   = null;
    state.savedSampleCode = null;

    state._codeInfo = null;

    // Reset form
    ['new-location','new-batch','new-comments'].forEach(id => {
      const e = el(id); if (e) e.value = '';
    });

    // Νέος κωδικός
    regenerateCode();

    // Επιστροφή στο step 1
    showOnly('step-1');
    updateBreadcrumb(1);
  }

  function goToTests() {
    if (!state.savedSampleId) {
      App.toast('Δεν υπάρχει αποθηκευμένο δείγμα', 'warn');
      return;
    }
    window._currentSampleId = state.savedSampleId;
    App.go('tests');
  }

  // ============================================================
  // UTILITIES
  // ============================================================

  function escapeHTML(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  window.SamplesPage = {
    regenerateCode,
    addTechnician, _doAddTechnician,
    goToStep,
    togglePlan,
    saveSample,
    startNewSample,
    goToTests,
  };
  window.autoSlashDate = autoSlashDate;

  // ============================================================
  // KICKOFF
  // ============================================================

  init();

})();
