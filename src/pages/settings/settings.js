/**
 * settings.js
 * Εργαστήριο Λατομείων Γαλάτιστας
 * ─────────────────────────────────────────────────────────────
 * Έκδοση : 0.99.3
 * Ημ/νία  : 2026-06-02
 * ─────────────────────────────────────────────────────────────
 * Ιστορικό:
 *   0.99.2 — CE period management UI + subperiod modal
 *   0.99.0 — Προσθήκη επικεφαλίδας έκδοσης
 */
(() => {

  // ============================================================
  // ΣΤΑΘΕΡΕΣ
  // ============================================================

  // Τυπικά κόσκινα ISO 3310-1 που χρησιμοποιούνται στα αδρανή
  // Φορτώνεται από tbl_sieves κατά την init — περιέχει ISO + custom
  // Fallback στη hardcoded ISO λίστα αν δεν φορτωθεί
  const ISO_SIEVES_FALLBACK = [
    63, 45, 31.5, 22.4, 16, 11.2, 8, 5.6, 4, 2.8,
    2, 1.4, 1, 0.71, 0.5, 0.355, 0.25, 0.18, 0.125, 0.09, 0.063
  ];

  const CATEGORY_LABELS = {
    'ΛΕΠΤΟΚΟΚΚΟ':  'Λεπτόκοκκο (0/d)',
    'ΧΟΝΔΡΟΚΟΚΚΟ': 'Χονδρόκοκκο (d/D)',
    'ALL_IN':      'All-In (Μικτό)',
  };

  const CATEGORY_BADGES = {
    'ΛΕΠΤΟΚΟΚΚΟ':  '<span class="badge" style="background:var(--info-light,#e8f4fd);color:var(--info,#1976d2);">Λεπτόκοκκο</span>',
    'ΧΟΝΔΡΟΚΟΚΚΟ': '<span class="badge" style="background:var(--warning-light,#fff3e0);color:var(--warning,#e65100);">Χονδρόκοκκο</span>',
    'ALL_IN':      '<span class="badge" style="background:var(--success-light,#e8f5e9);color:var(--success,#2e7d32);">All-In</span>',
  };

  // ============================================================
  // STATE
  // ============================================================

  const state = {
    activeTab:        'lab',
    products:         [],
    selectedProductId: null,    // για sieves card
    selectedSieves:   [],       // τρέχουσα επιλογή κόσκινων
    existingSieves:   [],       // κόσκινα που ήδη χρησιμοποιούνται σε δοκιμές
    sources:          [],
    technicians:      [],
    specs:            [],
    sieves:           [],
  };

  // ============================================================
  // HELPERS
  // ============================================================

  const el  = id => document.getElementById(id);
  const val = id => el(id)?.value?.trim() || '';
  const esc = s  => {
    if (s == null) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };

  function fmtMm(mm) {
    // Μορφοποίηση mm: 31.5 → "31.5", 0.063 → "0.063"
    return parseFloat(mm) % 1 === 0
      ? parseInt(mm).toString()
      : parseFloat(mm).toString();
  }

  // ============================================================
  // INIT
  // ============================================================

  // Προκαθορισμένα σετ κόσκινων ανά εύρος κόκκου (EN 933-1 practice)
  // key: "dmin/dmax", value: [κόσκινα φθίνουσα]
  const PRESET_SIEVES = {
    '0/4':     [4, 2, 1, 0.5, 0.25, 0.125, 0.063],
    '0/2':     [2, 1, 0.5, 0.25, 0.125, 0.063],
    '0/5.6':   [5.6, 4, 2, 1, 0.5, 0.25, 0.063],
    '0/8':     [8, 4, 2, 1, 0.5, 0.25, 0.063],
    '4/8':     [8, 5.6, 4, 2, 0.063],
    '4/11.2':  [11.2, 8, 5.6, 4, 2, 0.063],
    '4/16':    [16, 11.2, 8, 5.6, 4, 2, 0.063],
    '8/16':    [16, 11.2, 8, 5.6, 4, 0.063],
    '11.2/22.4': [22.4, 16, 11.2, 8, 4, 0.063],
    '16/31.5': [31.5, 22.4, 16, 11.2, 8, 4, 0.063],
    '22.4/45': [45, 31.5, 22.4, 16, 8, 0.063],
    '31.5/63': [63, 45, 31.5, 22.4, 16, 8, 0.063],
    '0/31.5':  [31.5, 16, 8, 4, 2, 0.5, 0.063],
    '0/63':    [63, 31.5, 16, 8, 4, 2, 0.063],
  };

  function _getPresetSieves(dMin, dMax) {
    const mn  = parseFloat(dMin);
    const mx  = parseFloat(dMax);
    const fmt = v => v === Math.floor(v) ? String(Math.floor(v)) : String(v);
    const key = `${fmt(mn)}/${fmt(mx)}`;
    return PRESET_SIEVES[key] || null;
  }

  async function init() {
    // Φόρτωση κόσκινων από tbl_sieves
    const sieves = await pyCall('get_all_sieves') || [];
    state._allSieves = sieves
      .map(s => parseFloat(s.sieve_mm))
      .sort((a, b) => b - a);
    if (state._allSieves.length === 0) state._allSieves = [...ISO_SIEVES_FALLBACK];

    await populateSpecProducts();
    switchTab('lab');
  }

  async function populateSpecProducts() {
    const sel = el('spec-product');
    if (!sel) return;
    // Χρησιμοποιούμε τα ενεργά προϊόντα από AppState
    const products = AppState?.products || await pyCall('get_products') || [];
    products.forEach(p => {
      const opt       = document.createElement('option');
      opt.value       = p.id;
      opt.textContent = `${p.name}mm`;
      sel.appendChild(opt);
    });
  }

  // ============================================================
  // TAB NAVIGATION
  // ============================================================

  async function switchTab(tab) {
    state.activeTab = tab;

    document.querySelectorAll('.settings-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab)
    );
    document.querySelectorAll('.settings-panel').forEach(p => {
      const isActive = p.id === `tab-${tab}`;
      p.classList.toggle('active', isActive);
      if (isActive) p.classList.remove('hidden');
    });

    if (tab === 'lab')         await loadLab();
    if (tab === 'materials')   await loadProducts();
    if (tab === 'sources')     await loadSources();
    if (tab === 'technicians') await loadTechnicians();
    if (tab === 'email')       await loadSmtp();
    if (tab === 'storage')     await loadStorageSettings();
  }

  // ============================================================
  // TAB 1: ΕΡΓΑΣΤΗΡΙΟ
  // ============================================================

  async function loadLab() {
    const lab = await pyCall('get_lab_info');
    if (!lab) return;
    el('lab-name').value    = lab.name    || '';
    el('lab-address').value = lab.address || '';
    el('lab-phone').value   = lab.phone   || '';
    el('lab-email').value   = lab.email   || '';
    el('lab-ce-number').value = lab.ce_number    || '';
    el('lab-ce-body').value   = lab.ce_body      || '';
    el('lab-ce-from').value   = lab.ce_valid_from || '';
    el('lab-ce-to').value     = lab.ce_valid_to   || '';
    const fontSel = el('lab-pdf-font');
    if (fontSel) fontSel.value = lab.pdf_font || 'LiberationSans';
    const guideEnabled = await pyCall('get_guide_enabled');
    const cb = el('lab-guide-enabled');
    if (cb) cb.checked = guideEnabled !== false;
    if (typeof AppState !== 'undefined') AppState.guideEnabled = guideEnabled !== false;
  }

  async function saveGuideEnabled(enabled) {
    try {
      await pyCallStrict('set_guide_enabled', enabled ? 1 : 0);
      if (typeof AppState !== 'undefined') AppState.guideEnabled = enabled;
      App.toast(enabled ? 'Οδηγός ενεργοποιήθηκε' : 'Οδηγός απενεργοποιήθηκε', 'ok');
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  async function saveLab() {
    const data = {
      name:         val('lab-name'),
      address:      val('lab-address'),
      phone:        val('lab-phone'),
      email:        val('lab-email'),
      ce_number:    val('lab-ce-number'),
      ce_body:      val('lab-ce-body'),
      ce_valid_from:val('lab-ce-from'),
      ce_valid_to:  val('lab-ce-to'),
      pdf_font:     el('lab-pdf-font')?.value || 'LiberationSans',
    };
    if (!data.name) {
      App.toast('Η επωνυμία είναι υποχρεωτική', 'warn');
      el('lab-name').focus();
      return;
    }
    try {
      await pyCallStrict('save_lab_info', data);
      App.toast('Στοιχεία εργαστηρίου αποθηκεύτηκαν', 'ok');
      const labEl = document.getElementById('sidebar-ce-number');
      if (labEl && data.ce_number) labEl.textContent = data.ce_number;
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  // ============================================================
  // TAB 2: ΑΔΡΑΝΗ — Λίστα Προϊόντων
  // ============================================================

  async function loadProducts() {
    state.products = await pyCall('get_all_products') || [];

    // Τα κόσκινα έρχονται ενσωματωμένα — ένα call αρκεί
    state.productSieves = {};
    state.products.forEach(p => {
      state.productSieves[p.id] = p.sieves || [];
    });

    renderProducts();

    if (state.selectedProductId) {
      const still = state.products.find(p => p.id === state.selectedProductId);
      if (!still) closeSievesCard();
    }
  }

  /**
   * Επιστρέφει HTML με τα κόσκινα του προϊόντος ως pills:
   *   🟢 πράσινο  = επιλεγμένο κόσκινο (υπάρχει στο tbl_product_sieves)
   *   🔴 κόκκινο  = εκτός εύρους κόκκου (sieve_mm > d_max ή sieve_mm < d_min για χονδρόκοκκα)
   *   ⚪ γκρι     = εντός εύρους αλλά μη επιλεγμένο (δεν βρίσκεται στη λίστα)
   *
   * Εμφανίζει ΟΛΛΑ τα κόσκινα ALL_SIEVES ώστε να φαίνεται τι λείπει.
   * Για λόγους χώρου εμφανίζουμε μόνο τα κόσκινα εντός εύρους ±1 βαθμίδα
   * και τα επιλεγμένα (ακόμα κι αν είναι εκτός εύρους — αυτό είναι σφάλμα δεδομένων).
   */
  function _renderSievePills(p) {
    const sieves = state.productSieves[p.id] || [];
    const dMax   = parseFloat(p.d_max);
    const dMin   = parseFloat(p.d_min);

    if (sieves.length === 0) {
      return '<span style="color:var(--text-muted);font-size:11px;font-style:italic;">Χωρίς κόσκινα</span>';
    }

    return sieves.map(s => {
      // Κόκκινο μόνο αν είναι εμφανώς εκτός εύρους
      const isRed = s > dMax * 3 || (dMin > 0 && s < dMin / 10 && s !== 0.063 && s !== 0.075);
      return `<span title="${fmtMm(s)} mm${isRed ? ' — εκτός εύρους' : ''}" style="
        display:inline-block;padding:2px 7px;border-radius:10px;
        border:1px solid ${isRed ? '#ef9a9a' : '#a5d6a7'};
        background:${isRed ? '#fce4ec' : '#e8f5e9'};
        color:${isRed ? '#c62828' : '#1b5e20'};
        font-size:11px;font-weight:600;font-family:monospace;white-space:nowrap;
      ">${fmtMm(s)}${isRed ? ' ⚠' : ''}</span>`;
    }).join(' ');
  }

  function renderProducts() {
    const tbody = el('products-list');
    if (!tbody) return;

    if (state.products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Δεν υπάρχουν είδη αδρανών</td></tr>';
      return;
    }

    tbody.innerHTML = state.products.map(p => {
      const isSelected = p.id === state.selectedProductId;
      return `
        <tr class="${isSelected ? 'row-selected' : ''}"
            style="cursor:pointer;${!p.active ? 'opacity:0.55;' : ''}"
            onclick="SettingsPage.openSievesCard(${p.id})">
          <td>
            <strong>${esc(p.name)}</strong>
            <div style="font-size:11px;color:var(--text-muted);font-family:monospace;">
              ${fmtMm(p.d_min)}/${fmtMm(p.d_max)} mm
              &nbsp;·&nbsp;
              <span style="color:var(--accent);">${esc(p.code || '—')}</span>
            </div>
          </td>
          <td>${CATEGORY_BADGES[p.category] || esc(p.category) || '—'}</td>
          <td style="font-size:11px;color:var(--text-muted);">${esc(p.standard || '—')}</td>
          <td style="max-width:340px;">
            <div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;">
              ${_renderSievePills(p)}
            </div>
            <div style="margin-top:4px;font-size:10px;color:var(--text-muted);">
              ${(state.productSieves[p.id] || []).length} κόσκινα
              &nbsp;·&nbsp;
              <span style="color:#2e7d32;font-weight:600;">●</span> επιλεγμένο
              &nbsp;
              <span style="color:#c62828;font-weight:600;">●</span> εκτός εύρους
            </div>
          </td>
          <td>
            ${p.active
              ? '<span class="badge badge-ok">Ενεργό</span>'
              : '<span class="badge badge-none">Ανενεργό</span>'}
          </td>
          <td onclick="event.stopPropagation()">
            <button class="btn-sm"
                    onclick="SettingsPage.editProduct(${p.id})"
                    title="Επεξεργασία">✎</button>
            <button class="btn-sm"
                    onclick="SettingsPage.toggleProduct(${p.id}, ${p.active})"
                    title="${p.active ? 'Απενεργοποίηση' : 'Ενεργοποίηση'}">
              ${p.active ? '⊘' : '✓'}
            </button>
            ${!parseInt(p.active) ? `
            <button class="btn-sm" style="color:#c62828;border-color:#ef9a9a;"
                    onclick="SettingsPage.deleteProduct(${p.id})"
                    title="Οριστική διαγραφή">Διαγραφή</button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  // ─── Modal: Νέο Προϊόν ───

  async function showAddProduct() {
    // Φόρτωση υπαρχόντων τύπων για autocomplete
    const types = await pyCall('get_material_types') || [];

    App.showModal('Νέο Είδος Αδρανούς', `
      <div class="form-grid">
        <div class="form-group" style="position:relative;">
          <label>Τύπος Υλικού <span class="required">*</span></label>
          <input type="text" id="prod-material-type"
                 placeholder="πχ ΑΜΜΟΣ, ΓΑΡΜΠΙΛΙ, ΣΚΥΡΑ"
                 autocomplete="off"
                 style="text-transform:uppercase;width:100%;"
                 oninput="SettingsPage._materialTypeInput(this)"
                 onblur="setTimeout(()=>SettingsPage._hideMaterialDropdown(),150)">
          <div id="material-type-dropdown"
               style="display:none;position:absolute;top:100%;left:0;right:0;
                      background:var(--bg-card,#fff);border:1px solid var(--border);
                      border-radius:var(--radius);box-shadow:0 4px 12px rgba(0,0,0,0.15);
                      z-index:200;max-height:160px;overflow-y:auto;">
          </div>
          <small class="form-hint">Επιλέξτε από τα υπάρχοντα ή πληκτρολογήστε νέο</small>
        </div>
        <div class="form-group">
          <label>Κατηγορία <span class="required">*</span></label>
          <select id="prod-category">
            <option value="">— Επιλέξτε —</option>
            <option value="ΛΕΠΤΟΚΟΚΚΟ">Λεπτόκοκκο (0/d)</option>
            <option value="ΧΟΝΔΡΟΚΟΚΚΟ">Χονδρόκοκκο (d/D)</option>
            <option value="ALL_IN">All-In (Μικτό)</option>
          </select>
        </div>
        <div class="form-group">
          <label>d<sub>min</sub> (mm) <span class="required">*</span></label>
          <input type="number" id="prod-dmin"
                 min="0" max="200" step="0.5" placeholder="πχ 0"
                 oninput="SettingsPage._updateProductNamePreview()">
          <small class="form-hint">0 για λεπτόκοκκα</small>
        </div>
        <div class="form-group">
          <label>d<sub>max</sub> (mm) <span class="required">*</span></label>
          <input type="number" id="prod-dmax"
                 min="0.1" max="200" step="0.5" placeholder="πχ 4"
                 oninput="SettingsPage._updateProductNamePreview()">
        </div>
        <div class="form-group full-width">
          <label>Πρότυπο EN</label>
          <input type="text" id="prod-standard"
                 placeholder="πχ EN12620/EN13043/EN13242">
        </div>
      </div>
      <div id="prod-name-preview"
           style="display:none;margin-top:8px;padding:8px 12px;
                  background:var(--bg-input);border-radius:var(--radius);
                  font-size:13px;color:var(--text-muted);">
        Όνομα: <strong id="prod-name-preview-text"></strong>
      </div>
      <p style="margin-top:10px;font-size:11px;color:var(--text-muted);">
        Μετά τη δημιουργία, ρυθμίστε τα κόσκινα από τον πίνακα.
      </p>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '+ Προσθήκη', action: 'SettingsPage._saveNewProduct()' },
    ]);

    // Αρχικοποίηση autocomplete με υπάρχοντες τύπους
    state._materialTypes = types;
    setTimeout(() => {
      const inp = el('prod-material-type');
      if (inp) inp.addEventListener('input', () => {
        const pos = inp.selectionStart;
        inp.value = inp.value.toUpperCase();
        inp.setSelectionRange(pos, pos);
        _updateProductNamePreview();
      });
    }, 100);
  }

  function _materialTypeInput(input) {
    const val  = input.value.toUpperCase();
    const drop = el('material-type-dropdown');
    if (!drop) return;
    const types = state._materialTypes || [];
    const matches = types.filter(t => t.toUpperCase().startsWith(val));
    if (!val || matches.length === 0) { drop.style.display = 'none'; return; }
    drop.innerHTML = matches.map(t => `
      <div onclick="SettingsPage._selectMaterialType('${t}')"
           style="padding:7px 12px;cursor:pointer;font-size:13px;"
           onmouseover="this.style.background='var(--bg-hover,#f5f5f5)'"
           onmouseout="this.style.background=''">
        ${esc(t)}
      </div>
    `).join('');
    drop.style.display = 'block';
  }

  function _selectMaterialType(type) {
    const inp = el('prod-material-type');
    if (inp) inp.value = type;
    _hideMaterialDropdown();
    _updateProductNamePreview();
  }

  function _hideMaterialDropdown() {
    const drop = el('material-type-dropdown');
    if (drop) drop.style.display = 'none';
  }

  function _updateProductNamePreview() {
    const type = el('prod-material-type')?.value?.trim().toUpperCase() || '';
    const dmin = parseFloat(el('prod-dmin')?.value);
    const dmax = parseFloat(el('prod-dmax')?.value);
    const preview = el('prod-name-preview');
    const text    = el('prod-name-preview-text');
    if (!preview || !text) return;
    if (type && !isNaN(dmin) && !isNaN(dmax) && dmin < dmax) {
      const fmtV = v => v === Math.floor(v) ? String(Math.floor(v)) : String(v);
      text.textContent = `${type} ${fmtV(dmin)}/${fmtV(dmax)}`;
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  }

  async function _saveNewProduct() {
    const materialType = el('prod-material-type')?.value?.trim().toUpperCase();
    const category     = el('prod-category')?.value;
    const dmin         = parseFloat(el('prod-dmin')?.value);
    const dmax         = parseFloat(el('prod-dmax')?.value);
    const standard     = el('prod-standard')?.value?.trim() || '';

    if (!materialType) { App.toast('Εισάγετε τύπο υλικού', 'warn'); return; }
    if (!category)     { App.toast('Επιλέξτε κατηγορία', 'warn'); return; }
    if (isNaN(dmin) || isNaN(dmax)) {
      App.toast('Συμπληρώστε τα όρια κόκκου (d_min, d_max)', 'warn');
      return;
    }
    if (dmin >= dmax) {
      App.toast('Το d_min πρέπει να είναι μικρότερο από d_max', 'warn');
      return;
    }

    try {
      const newId = await pyCallStrict(
        'add_product', materialType, dmin, dmax, standard, category
      );
      App.closeModal();
      App.toast(`Προϊόν "${name}" προστέθηκε`, 'ok');
      await loadProducts();
      await _refreshAppStateProducts();
      if (newId) openSievesCard(newId);
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  // ─── Modal: Επεξεργασία Προϊόντος ───

  function editProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;

    App.showModal('Επεξεργασία Είδους Αδρανούς', `
      <div class="form-grid">
        <div class="form-group">
          <label>Τύπος Υλικού <span class="required">*</span></label>
          <input type="text" id="prod-edit-material-type"
                 value="${esc(p.material_type || p.name)}"
                 style="text-transform:uppercase;">
          <small class="form-hint">Το όνομα θα ενημερωθεί αυτόματα</small>
        </div>
        <div class="form-group">
          <label>Κωδικός Δείγματος <span class="required">*</span></label>
          <input type="text" id="prod-edit-code"
                 value="${esc(p.code || '')}"
                 maxlength="8"
                 style="text-transform:uppercase;font-family:monospace;width:120px;">
          <small class="form-hint">Χρησιμοποιείται στον κωδικό δείγματος (πχ ΑΜΜ04)</small>
        </div>
        <div class="form-group">
          <label>Κατηγορία <span class="required">*</span></label>
          <select id="prod-edit-category">
            <option value="ΛΕΠΤΟΚΟΚΚΟ"  ${p.category==='ΛΕΠΤΟΚΟΚΚΟ'  ? 'selected':''}>Λεπτόκοκκο (0/d)</option>
            <option value="ΧΟΝΔΡΟΚΟΚΚΟ" ${p.category==='ΧΟΝΔΡΟΚΟΚΚΟ' ? 'selected':''}>Χονδρόκοκκο (d/D)</option>
            <option value="ALL_IN"      ${p.category==='ALL_IN'       ? 'selected':''}>All-In (Μικτό)</option>
          </select>
        </div>
        <div class="form-group">
          <label>d<sub>min</sub> (mm)</label>
          <input type="number" id="prod-edit-dmin"
                 value="${p.d_min}" min="0" max="100" step="0.5">
        </div>
        <div class="form-group">
          <label>d<sub>max</sub> (mm)</label>
          <input type="number" id="prod-edit-dmax"
                 value="${p.d_max}" min="0.1" max="200" step="0.5">
        </div>
        <div class="form-group full-width">
          <label>Πρότυπο EN</label>
          <input type="text" id="prod-edit-standard"
                 value="${esc(p.standard || '')}">
        </div>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '✓ Αποθήκευση', action: `SettingsPage._saveEditProduct(${id})` },
    ]);
  }

  async function _saveEditProduct(id) {
    const materialType = el('prod-edit-material-type')?.value?.trim().toUpperCase();
    const code         = el('prod-edit-code')?.value?.trim().toUpperCase();
    const category     = el('prod-edit-category')?.value;
    const dmin         = parseFloat(el('prod-edit-dmin')?.value);
    const dmax         = parseFloat(el('prod-edit-dmax')?.value);
    const standard     = el('prod-edit-standard')?.value?.trim() || '';

    if (!materialType) { App.toast('Εισάγετε τύπο υλικού', 'warn'); return; }
    if (!code)         { App.toast('Εισάγετε κωδικό δείγματος', 'warn'); return; }
    if (!category)     { App.toast('Επιλέξτε κατηγορία', 'warn'); return; }
    if (isNaN(dmin) || isNaN(dmax) || dmin >= dmax) {
      App.toast('Ελέγξτε τα όρια κόκκου', 'warn');
      return;
    }

    try {
      await pyCallStrict('update_product', id, materialType, dmin, dmax, standard, category, code);
      App.closeModal();
      App.toast('Είδος αδρανούς ενημερώθηκε', 'ok');
      await loadProducts();
      await _refreshAppStateProducts();
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  async function toggleProduct(id, currentActive) {
    const p      = state.products.find(x => x.id === id);
    const active = parseInt(currentActive); // SQLite επιστρέφει 0/1 ως int
    const label  = active ? 'Απενεργοποίηση' : 'Ενεργοποίηση';
    const action = active ? 'απενεργοποιηθεί' : 'ενεργοποιηθεί';
    const note   = active ? ' Δεν θα εμφανίζεται σε νέα δείγματα.' : '';

    App.showModal(label + ' Είδους', `
      <p style="color:var(--text-muted);margin:8px 0;">
        Το είδος <strong>${esc(p?.name || '')}</strong> θα ${action}.${note}
      </p>
    `, [
      { label: 'Ακύρωση',  action: 'App.closeModal()', secondary: true },
      { label: label,      action: `SettingsPage._doToggleProduct(${id}, ${active})` },
    ]);
  }

  async function _doToggleProduct(id, currentActive) {
    App.closeModal();
    try {
      await pyCallStrict('toggle_product', id, currentActive ? 0 : 1);
      App.toast('Κατάσταση είδους ενημερώθηκε', 'ok');
      await loadProducts();
      await _refreshAppStateProducts();
    } catch(e) {
      App.toast(e.message, 'fail');
    }
  }

  function deleteProduct(id) {
    const p = state.products.find(x => x.id === id);
    App.showModal('Οριστική Διαγραφή', `
      <p style="color:var(--text-muted);margin:8px 0;">
        Το είδος <strong>${esc(p?.name || '')}</strong> θα διαγραφεί οριστικά
        μαζί με τα κόσκινά του.
      </p>
      <p style="color:#c62828;font-size:12px;margin:8px 0;">
        ⚠ Η ενέργεια δεν αναιρείται.
      </p>
    `, [
      { label: 'Ακύρωση',          action: 'App.closeModal()', secondary: true },
      { label: 'Οριστική Διαγραφή', action: `SettingsPage._doDeleteProduct(${id})` },
    ]);
  }

  async function _doDeleteProduct(id) {
    App.closeModal();
    try {
      await pyCallStrict('delete_product', id);
      App.toast('Είδος αδρανούς διαγράφηκε', 'ok');
      if (state.selectedProductId === id) closeSievesCard();
      await loadProducts();
      await _refreshAppStateProducts();
    } catch(e) {
      App.toast(e.message, 'fail');
    }
  }

  async function _refreshAppStateProducts() {
    if (window.AppState) {
      AppState.products = await pyCall('get_products') || [];
      // Ανανέωση και των spec-product options
      const sel = el('spec-product');
      if (sel) {
        sel.innerHTML = '<option value="">— Επιλέξτε —</option>';
        AppState.products.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.name}mm`;
          sel.appendChild(opt);
        });
      }
    }
  }

  // ============================================================
  // TAB 2: ΑΔΡΑΝΗ — Κόσκινα (inline card)
  // ============================================================

  async function openSievesCard(productId) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;

    state.selectedProductId = productId;

    const current = await pyCall('get_product_sieves_full', productId) || [];
    // Ταξινόμηση φθίνουσα
    state.selectedSieves = current
      .map(r => parseFloat(r.sieve_mm))
      .sort((a, b) => b - a);

    el('sieves-card-title').textContent =
      `Κόσκινα — ${p.name} (${fmtMm(p.d_min)}/${fmtMm(p.d_max)} mm)`;
    el('sieves-card-subtitle').textContent =
      `${CATEGORY_LABELS[p.category] || p.category}  •  ${p.standard || ''}`;

    // Αν δεν υπάρχουν κόσκινα, προτείνουμε preset
    if (state.selectedSieves.length === 0) {
      const preset = _getPresetSieves(p.d_min, p.d_max);
      if (preset) {
        state.selectedSieves = [...preset];
        state._showingPreset = true;
      } else {
        state._showingPreset = false;
      }
    } else {
      state._showingPreset = false;
    }

    renderSievesSelector();

    el('sieves-card').style.display = 'block';
    renderProducts();
    el('sieves-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeSievesCard() {
    state.selectedProductId = null;
    state.selectedSieves    = [];
    el('sieves-card').style.display = 'none';
    renderProducts();
  }

  /**
   * Sieves card UI:
   *  • Pills για κάθε κόσκινο που υπάρχει ήδη — κλικ αριστερό = τίποτα,
   *    δεξί κλικ = διαγραφή (context menu)
   *  • Κόκκινο pill αν sieve_mm > d_max * 3  (προφανής ασυμφωνία)
   *  • Free entry: input + autocomplete από ISO_SIEVES
   */
  function renderSievesSelector() {
    const container = el('sieves-selector');
    if (!container) return;

    const p    = state.products.find(x => x.id === state.selectedProductId);
    const dMax = p ? parseFloat(p.d_max) : Infinity;
    const dMin = p ? parseFloat(p.d_min) : 0;

    // Pills των ήδη επιλεγμένων κόσκινων (φθίνουσα σειρά)
    const pillsHtml = state.selectedSieves.length === 0
      ? '<span style="color:var(--text-muted);font-size:12px;font-style:italic;">Δεν έχουν οριστεί κόσκινα</span>'
      : state.selectedSieves.map(s => {
          // Κόκκινο μόνο αν είναι εμφανώς εκτός εύρους (πχ 63mm σε ΑΜΜΟΣ 0/4)
          const tooLarge = s > dMax * 3;
          const tooSmall = dMin > 0 && s < dMin / 10 && s !== 0.063 && s !== 0.075;
          const isRed    = tooLarge || tooSmall;

          const bg      = isRed ? '#fce4ec' : '#e8f5e9';
          const color   = isRed ? '#c62828' : '#1b5e20';
          const border  = isRed ? '#ef9a9a' : '#66bb6a';
          const tooltip = isRed
            ? `Πιθανή ασυμφωνία με εύρος ${fmtMm(dMin)}/${fmtMm(dMax)}mm`
            : `${fmtMm(s)} mm — δεξί κλικ για αφαίρεση`;

          return `<span
            class="sieve-pill"
            data-mm="${s}"
            title="${tooltip}"
            oncontextmenu="SettingsPage._sievePillContextMenu(event, ${s})"
            style="
              display:inline-flex;align-items:center;gap:4px;
              padding:4px 10px;border-radius:12px;
              border:1px solid ${border};
              background:${bg};color:${color};
              font-size:13px;font-weight:600;font-family:monospace;
              cursor:default;user-select:none;
              transition:opacity 0.15s;
            "
          >${fmtMm(s)} mm${isRed ? ' ⚠' : ''}</span>`;
        }).join('');

    // Autocomplete suggestions: ISO κόσκινα που ΔΕΝ υπάρχουν ήδη
    const existing = new Set(state.selectedSieves);
    const suggestions = (state._allSieves || ISO_SIEVES_FALLBACK).filter(s => !existing.has(s));

    container.innerHTML = `
      <!-- Banner preset -->
      ${state._showingPreset ? `
      <div style="padding:8px 12px;background:var(--info-light,#e8f4fd);
                  border:1px solid var(--info,#1976d2);border-radius:var(--radius);
                  font-size:12px;color:var(--info,#1976d2);margin-bottom:10px;
                  display:flex;justify-content:space-between;align-items:center;">
        <span>📋 Προτεινόμενα κόσκινα — τροποποιήστε αν χρειάζεται και πατήστε Αποθήκευση</span>
        <button onclick="SettingsPage._clearPreset()"
                style="background:none;border:none;cursor:pointer;
                       font-size:11px;color:var(--info,#1976d2);text-decoration:underline;">
          Καθαρισμός
        </button>
      </div>
      ` : ''}
      <!-- Pills των επιλεγμένων κόσκινων -->
      <div id="sieve-pills-area"
           style="display:flex;flex-wrap:wrap;gap:6px;
                  min-height:36px;align-items:center;
                  padding:10px;border-radius:var(--radius);
                  border:1px solid var(--border);
                  background:var(--bg-input);
                  margin-bottom:12px;">
        ${pillsHtml}
      </div>

      <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">
        💡 Δεξί κλικ σε κόσκινο για αφαίρεση
      </div>

      <!-- Free entry -->
      <div style="display:flex;gap:8px;align-items:center;position:relative;">
        <div style="position:relative;flex:1;max-width:220px;">
          <input type="number"
                 id="sieve-add-input"
                 min="0.001" max="200" step="any"
                 placeholder="πχ 0.075, 37.5 ..."
                 style="width:100%;background:var(--bg-input);
                        border:1px solid var(--border);
                        border-radius:var(--radius);
                        color:var(--text);padding:7px 10px;
                        font-family:monospace;"
                 oninput="SettingsPage._sieveInputChange(this)"
                 onkeydown="if(event.key==='Enter'){SettingsPage._addSieveFromInput();event.preventDefault();}
                            if(event.key==='Escape'){SettingsPage._hideSieveDropdown();}">
          <!-- Autocomplete dropdown -->
          <div id="sieve-autocomplete"
               style="display:none;position:absolute;top:100%;left:0;right:0;
                      background:var(--bg-card,#fff);border:1px solid var(--border);
                      border-radius:var(--radius);box-shadow:0 4px 12px rgba(0,0,0,0.15);
                      z-index:100;max-height:200px;overflow-y:auto;">
          </div>
        </div>
        <button class="btn-primary" style="padding:7px 16px;white-space:nowrap;"
                onclick="SettingsPage._addSieveFromInput()">
          + Προσθήκη
        </button>
      </div>

      <!-- Context menu (hidden) -->
      <div id="sieve-context-menu"
           style="display:none;position:fixed;
                  background:var(--bg-card,#fff);
                  border:1px solid var(--border);
                  border-radius:var(--radius);
                  box-shadow:0 4px 16px rgba(0,0,0,0.2);
                  z-index:1000;min-width:160px;padding:4px 0;">
        <div style="padding:4px 8px;font-size:11px;color:var(--text-muted);
                    border-bottom:1px solid var(--border);margin-bottom:2px;"
             id="ctx-menu-title"></div>
        <div onclick="SettingsPage._confirmRemoveSieve()"
             style="padding:8px 16px;cursor:pointer;font-size:13px;color:#c62828;
                    display:flex;align-items:center;gap:8px;"
             onmouseover="this.style.background='#fce4ec'"
             onmouseout="this.style.background=''">
          🗑 Αφαίρεση κόσκινου
        </div>
        <div onclick="SettingsPage._hideSieveContextMenu()"
             style="padding:8px 16px;cursor:pointer;font-size:13px;color:var(--text-muted);
                    display:flex;align-items:center;gap:8px;"
             onmouseover="this.style.background='var(--bg-hover,#f5f5f5)'"
             onmouseout="this.style.background=''">
          ✕ Ακύρωση
        </div>
      </div>
    `;

    // Κλείσιμο context menu αν κάνει κλικ αλλού
    document.addEventListener('click', _hideSieveContextMenu, { once: false });
  }

  // ─── Context menu ───

  let _ctxSieveMm = null;

  function _sievePillContextMenu(event, sieveMm) {
    event.preventDefault();
    event.stopPropagation();
    _ctxSieveMm = sieveMm;

    const menu = el('sieve-context-menu');
    const title = el('ctx-menu-title');
    if (!menu) return;

    title.textContent = `Κόσκινο ${fmtMm(sieveMm)} mm`;
    menu.style.display = 'block';

    // Τοποθέτηση κοντά στο cursor
    const x = Math.min(event.clientX, window.innerWidth  - 180);
    const y = Math.min(event.clientY, window.innerHeight - 100);
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
  }

  function _hideSieveContextMenu() {
    const menu = el('sieve-context-menu');
    if (menu) menu.style.display = 'none';
    _ctxSieveMm = null;
  }

  function _confirmRemoveSieve() {
    const mm = _ctxSieveMm;
    _hideSieveContextMenu();
    if (mm === null) return;
    _removeSieve(mm);
  }

  function _removeSieve(mm) {
    const idx = state.selectedSieves.indexOf(mm);
    if (idx < 0) return;
    state.selectedSieves.splice(idx, 1);
    renderSievesSelector();
  }

  // ─── Autocomplete & free entry ───

  function _sieveInputChange(input) {
    const val  = parseFloat(input.value);
    const drop = el('sieve-autocomplete');
    if (!drop) return;

    const existing = new Set(state.selectedSieves);
    const allSieves = state._allSieves || ISO_SIEVES_FALLBACK;
    const matches  = allSieves.filter(s => {
      if (existing.has(s)) return false;
      if (!input.value)    return true;   // show all if empty
      return String(s).startsWith(input.value) || s === val;
    }).slice(0, 10);

    if (matches.length === 0 || !input.value) {
      drop.style.display = 'none';
      return;
    }

    drop.innerHTML = matches.map(s => `
      <div onclick="SettingsPage._addSieve(${s})"
           style="padding:7px 12px;cursor:pointer;font-family:monospace;font-size:13px;"
           onmouseover="this.style.background='var(--bg-hover,#f5f5f5)'"
           onmouseout="this.style.background=''">
        ${fmtMm(s)} mm
      </div>
    `).join('');
    drop.style.display = 'block';
  }

  function _hideSieveDropdown() {
    const drop = el('sieve-autocomplete');
    if (drop) drop.style.display = 'none';
  }

  function _addSieve(mm) {
    _hideSieveDropdown();
    const input = el('sieve-add-input');
    if (input) input.value = '';

    if (state.selectedSieves.includes(mm)) {
      App.toast(`Το κόσκινο ${fmtMm(mm)} mm υπάρχει ήδη`, 'warn');
      return;
    }
    state.selectedSieves.push(mm);
    state.selectedSieves.sort((a, b) => b - a);

    // Αν είναι custom, προσθήκη στο state._allSieves για άμεσο autocomplete
    if (!state._allSieves) state._allSieves = [...ISO_SIEVES_FALLBACK];
    if (!state._allSieves.includes(mm)) {
      state._allSieves.push(mm);
      state._allSieves.sort((a, b) => b - a);
    }

    renderSievesSelector();
  }

  function _addSieveFromInput() {
    _hideSieveDropdown();
    const input = el('sieve-add-input');
    if (!input) return;

    const raw = input.value.replace(',', '.').trim();
    const mm  = parseFloat(raw);

    if (isNaN(mm) || mm <= 0 || mm > 200) {
      App.toast('Εισάγετε έγκυρη τιμή κόσκινου (0.001 – 200 mm)', 'warn');
      return;
    }

    // Στρογγυλοποίηση σε 3 δεκαδικά για αποφυγή floating-point artifacts
    const rounded = Math.round(mm * 1000) / 1000;
    input.value = '';
    _addSieve(rounded);
  }

  function _clearPreset() {
    state.selectedSieves  = [];
    state._showingPreset  = false;
    renderSievesSelector();
  }

  // ─── Αποθήκευση ───

  async function saveSieves() {
    if (!state.selectedProductId) return;

    if (state.selectedSieves.length === 0) {
      App.toast('Προσθέστε τουλάχιστον ένα κόσκινο', 'warn');
      return;
    }

    const sorted  = [...state.selectedSieves].sort((a, b) => b - a);
    const product = state.products.find(x => x.id === state.selectedProductId);

    try {
      await pyCallStrict('set_product_sieves', state.selectedProductId, sorted);
      App.toast(
        `Κόσκινα "${product?.name || ''}" αποθηκεύτηκαν (${sorted.length} κόσκινα)`,
        'ok'
      );
      state._showingPreset = false;
      state.productSieves[state.selectedProductId] = sorted;
      if (product) product.sieves = sorted;
      renderProducts();
    } catch(e) {
      App.toast(e.message, 'fail');
    }
  }

  // ============================================================
  // TAB 3: ΠΗΓΕΣ ΥΛΙΚΟΥ
  // ============================================================

  async function loadSources() {
    state.sources = await pyCall('get_sources') || [];
    renderSources();
  }

  function renderSources() {
    const tbody = el('sources-list');
    if (!tbody) return;
    if (state.sources.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">Δεν υπάρχουν πηγές</td></tr>';
      return;
    }
    tbody.innerHTML = state.sources.map(s => `
      <tr>
        <td><code style="font-family:monospace;font-weight:700;">${esc(s.code)}</code></td>
        <td>${esc(s.name)}</td>
        <td style="color:var(--text-muted);font-size:12px;">${esc(s.location || '—')}</td>
        <td>
          ${s.active
            ? '<span class="badge badge-ok">Ενεργή</span>'
            : '<span class="badge badge-none">Ανενεργή</span>'}
        </td>
        <td>
          <button class="btn-sm"
                  onclick="SettingsPage.editSource(${s.id})">✎</button>
          <button class="btn-sm"
                  onclick="SettingsPage.toggleSource(${s.id}, ${s.active})">
            ${s.active ? '⊘' : '✓'}
          </button>
        </td>
      </tr>
    `).join('');
  }

  function showAddSource() {
    App.showModal('Νέα Προέλευση Υλικού', `
      <div class="form-grid">
        <div class="form-group">
          <label>Κωδικός <span class="required">*</span></label>
          <input type="text" id="src-code" placeholder="πχ ΓΑΛ"
                 style="text-transform:uppercase;font-family:monospace;"
                 maxlength="6">
        </div>
        <div class="form-group">
          <label>Επωνυμία <span class="required">*</span></label>
          <input type="text" id="src-name" placeholder="πχ Λατομείο Γαλάτιστας">
        </div>
        <div class="form-group full-width">
          <label>Τοποθεσία</label>
          <input type="text" id="src-location" placeholder="Διεύθυνση/Περιοχή">
        </div>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: 'Αποθήκευση', action: 'SettingsPage._saveNewSource()' },
    ]);
  }

  async function _saveNewSource() {
    const code     = el('src-code')?.value?.trim().toUpperCase();
    const name     = el('src-name')?.value?.trim();
    const location = el('src-location')?.value?.trim();
    if (!code || !name) {
      App.toast('Κωδικός και επωνυμία είναι υποχρεωτικά', 'warn');
      return;
    }
    try {
      await pyCallStrict('add_source', code, name, location || null);
      App.closeModal();
      App.toast(`Προέλευση ${code} προστέθηκε`, 'ok');
      await loadSources();
      if (window.AppState) AppState.sources = state.sources;
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  function editSource(id) {
    const src = state.sources.find(s => s.id === id);
    if (!src) return;
    App.showModal('Επεξεργασία Προέλευσης', `
      <div class="form-grid">
        <div class="form-group">
          <label>Κωδικός</label>
          <input type="text" id="src-edit-code"
                 value="${esc(src.code)}"
                 style="font-family:monospace;font-weight:700;" readonly>
          <small style="color:var(--text-muted);font-size:11px;">
            Ο κωδικός δεν μπορεί να αλλάξει
          </small>
        </div>
        <div class="form-group">
          <label>Επωνυμία <span class="required">*</span></label>
          <input type="text" id="src-edit-name" value="${esc(src.name)}">
        </div>
        <div class="form-group full-width">
          <label>Τοποθεσία</label>
          <input type="text" id="src-edit-location"
                 value="${esc(src.location || '')}">
        </div>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: 'Αποθήκευση', action: `SettingsPage._saveEditSource(${id})` },
    ]);
  }

  async function _saveEditSource(id) {
    const name     = el('src-edit-name')?.value?.trim();
    const location = el('src-edit-location')?.value?.trim();
    if (!name) { App.toast('Η επωνυμία είναι υποχρεωτική', 'warn'); return; }
    try {
      await pyCallStrict('update_source', id, name, location || null);
      App.closeModal();
      App.toast('Προέλευση ενημερώθηκε', 'ok');
      await loadSources();
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  async function toggleSource(id, currentActive) {
    const active = parseInt(currentActive);
    const label  = active ? 'Απενεργοποίηση' : 'Ενεργοποίηση';
    App.showModal(label + ' Προέλευσης', `
      <p style="color:var(--text-muted);margin:8px 0;">
        Η προέλευση θα ${active ? 'απενεργοποιηθεί' : 'ενεργοποιηθεί'}.
        Τα υπάρχοντα δείγματα δεν επηρεάζονται.
      </p>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: label,     action: `SettingsPage._doToggleSource(${id}, ${active})` },
    ]);
  }

  async function _doToggleSource(id, currentActive) {
    App.closeModal();
    try {
      await pyCallStrict('toggle_source', id, currentActive ? 0 : 1);
      App.toast('Κατάσταση προέλευσης ενημερώθηκε', 'ok');
      await loadSources();
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  // ============================================================
  // TAB 4: ΤΕΧΝΙΚΟΙ
  // ============================================================

  async function loadTechnicians() {
    state.technicians = await pyCall('get_all_technicians') || [];
    renderTechnicians();
  }

  function renderTechnicians() {
    const tbody = el('technicians-list');
    if (!tbody) return;
    if (state.technicians.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-msg">Δεν υπάρχουν τεχνικοί</td></tr>';
      return;
    }
    tbody.innerHTML = state.technicians.map(t => `
      <tr>
        <td>${esc(t.name)}</td>
        <td>
          ${t.active
            ? '<span class="badge badge-ok">Ενεργός</span>'
            : '<span class="badge badge-none">Ανενεργός</span>'}
        </td>
        <td>
          <button class="btn-sm"
                  onclick="SettingsPage.toggleTechnician(${t.id}, ${t.active})">
            ${t.active ? '⊘ Απενεργοποίηση' : '✓ Ενεργοποίηση'}
          </button>
        </td>
      </tr>
    `).join('');
  }

  function showAddTechnician() {
    App.showModal('Νέος Τεχνικός', `
      <div class="form-group">
        <label>Ονοματεπώνυμο <span class="required">*</span></label>
        <input type="text" id="tech-name" placeholder="πχ Παπαδόπουλος Γιώργος"
               style="width:100%;margin-top:6px;">
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: 'Αποθήκευση', action: 'SettingsPage._saveNewTechnician()' },
    ]);
  }

  async function _saveNewTechnician() {
    const name = el('tech-name')?.value?.trim();
    if (!name) { App.toast('Το ονοματεπώνυμο είναι υποχρεωτικό', 'warn'); return; }
    try {
      await pyCallStrict('add_technician', name);
      App.closeModal();
      App.toast(`Τεχνικός "${name}" προστέθηκε`, 'ok');
      AppState.technicians = await pyCall('get_technicians') || [];
      await loadTechnicians();
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  async function toggleTechnician(id, currentActive) {
    try {
      await pyCallStrict('toggle_technician', id, currentActive ? 0 : 1);
      App.toast('Κατάσταση τεχνικού ενημερώθηκε', 'ok');
      AppState.technicians = await pyCall('get_technicians') || [];
      await loadTechnicians();
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  // ============================================================
  // TAB 5: ΠΡΟΔΙΑΓΡΑΦΕΣ
  // ============================================================

  async function loadSpecs() {
    const productId = parseInt(el('spec-product')?.value) || null;
    const existingWrap = el('spec-existing-wrap');
    const btnNew       = el('btn-new-spec');
    const area         = el('specs-table-area');
    const actions      = el('specs-actions');
    const editArea     = el('spec-edit-area');

    // Reset
    if (editArea) editArea.style.display = 'none';
    if (actions)  actions.style.display  = 'none';
    if (area) area.innerHTML = '<p class="form-card-intro">Επιλέξτε προδιαγραφή.</p>';

    if (!productId) {
      if (existingWrap) existingWrap.style.display = 'none';
      if (btnNew)       btnNew.style.display       = 'none';
      if (area) area.innerHTML = '<p class="form-card-intro">Επιλέξτε προϊόν.</p>';
      return;
    }

    // Φόρτωση κόσκινων & προδιαγραφών
    state.sieves  = await pyCall('get_product_sieves', productId) || [];
    const allSpecs = await pyCall('get_specifications', productId) || [];

    // Μοναδικά ονόματα προδιαγραφών
    const specNames = [...new Set(allSpecs.map(s => `${s.spec_type}|||${s.spec_name}`))];

    if (existingWrap && btnNew) {
      if (specNames.length > 0) {
        const sel = el('spec-existing');
        sel.innerHTML = '<option value="">— Επιλέξτε —</option>' +
          specNames.map(sn => {
            const [type, name] = sn.split('|||');
            return `<option value="${sn}">${name}</option>`;
          }).join('');
        existingWrap.style.display = 'block';
      } else {
        existingWrap.style.display = 'none';
      }
      btnNew.style.display = 'block';
    }

    state.allSpecs = allSpecs;
  }

  function selectSpec() {
    const val     = el('spec-existing')?.value;
    const area    = el('specs-table-area');
    const actions = el('specs-actions');
    const editArea = el('spec-edit-area');

    if (!val) {
      if (area) area.innerHTML = '<p class="form-card-intro">Επιλέξτε προδιαγραφή.</p>';
      if (actions) actions.style.display = 'none';
      if (editArea) editArea.style.display = 'none';
      return;
    }

    const [specType, specName] = val.split('|||');
    const specs = (state.allSpecs || []).filter(s => s.spec_name === specName);

    // Ενημέρωση edit area
    if (editArea) {
      editArea.style.display = 'flex';
      if (el('spec-type')) el('spec-type').value = specType;
      if (el('spec-name')) el('spec-name').value = specName;
    }

    _renderSpecTable(specs);
    if (actions) actions.style.display = 'flex';
  }

  function newSpec() {
    const area    = el('specs-table-area');
    const actions = el('specs-actions');
    const editArea = el('spec-edit-area');

    // Καθαρισμός επιλογής
    if (el('spec-existing')) el('spec-existing').value = '';
    if (el('spec-name'))     el('spec-name').value     = '';
    if (el('spec-type'))     el('spec-type').value     = 'EN';

    if (editArea) editArea.style.display = 'flex';

    // Άδειος πίνακας με τα κόσκινα του προϊόντος
    _renderSpecTable([]);
    if (actions) actions.style.display = 'flex';
  }

  function _renderSpecTable(specs) {
    const area      = el('specs-table-area');
    const productId = parseInt(el('spec-product')?.value) || null;
    if (!area || !productId) return;

    // Συγχώνευση κόσκινων προϊόντος + κόσκινων προδιαγραφής
    const specSieves = specs.map(s => s.sieve_mm);
    const allSieves  = [...new Set([...state.sieves, ...specSieves])].sort((a,b) => b - a);

    if (allSieves.length === 0) {
      area.innerHTML = '<p class="form-card-intro">Δεν βρέθηκαν κόσκινα.</p>';
      return;
    }

    area.innerHTML = `
      <table class="data-table full-width" style="margin-top:8px;">
        <thead>
          <tr>
            <th>Κόσκινο (mm)</th>
            <th>Κατώτερο Όριο (%)</th>
            <th>Ανώτερο Όριο (%)</th>
          </tr>
        </thead>
        <tbody>
          ${allSieves.map(sieve => {
            const spec = specs.find(s => s.sieve_mm === sieve);
            const id   = String(sieve).replace('.','_');
            return `
              <tr>
                <td><strong>${fmtMm(sieve)}</strong></td>
                <td>
                  <input type="number" id="spec-lo-${id}"
                         value="${spec?.lower_limit ?? ''}"
                         min="0" max="100" step="0.1" placeholder="—"
                         style="width:100px;background:var(--bg-input);
                                border:1px solid var(--border);
                                border-radius:var(--radius);
                                color:var(--text);padding:5px 8px;">
                </td>
                <td>
                  <input type="number" id="spec-hi-${id}"
                         value="${spec?.upper_limit ?? ''}"
                         min="0" max="100" step="0.1" placeholder="—"
                         style="width:100px;background:var(--bg-input);
                                border:1px solid var(--border);
                                border-radius:var(--radius);
                                color:var(--text);padding:5px 8px;">
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">
        Αφήστε κενό αν δεν υπάρχει όριο για συγκεκριμένο κόσκινο.
      </p>
    `;
  }

  async function deleteSpec() {
    const val = el('spec-existing')?.value;
    if (!val) return;
    const [, specName] = val.split('|||');
    const productId = parseInt(el('spec-product')?.value) || null;
    if (!productId) return;

    if (!confirm(`Διαγραφή προδιαγραφής "${specName}";`)) return;

    try {
      await pyCallStrict('save_specifications', productId,
        el('spec-type').value, specName, []);
      App.toast('Προδιαγραφή διαγράφηκε', 'ok');
      await loadSpecs();
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  async function saveSpecs() {
    const productId = parseInt(el('spec-product')?.value) || null;
    const specType  = el('spec-type')?.value || 'EN';
    const specName  = el('spec-name')?.value?.trim();
    if (!productId) { App.toast('Επιλέξτε προϊόν', 'warn'); return; }
    if (!specName)  { App.toast('Εισάγετε όνομα προδιαγραφής', 'warn'); return; }

    // Συγχώνευση κόσκινων
    const specSieves = (state.allSpecs || [])
      .filter(s => s.spec_name === specName)
      .map(s => s.sieve_mm);
    const allSieves = [...new Set([...state.sieves, ...specSieves])].sort((a,b) => b - a);

    const specs = allSieves.map(sieve => ({
      sieve_mm:    sieve,
      lower_limit: parseFloat(el(`spec-lo-${String(sieve).replace('.','_')}`)?.value) || null,
      upper_limit: parseFloat(el(`spec-hi-${String(sieve).replace('.','_')}`)?.value) || null,
    }));

    try {
      await pyCallStrict('save_specifications', productId, specType, specName, specs);
      App.toast('Προδιαγραφές αποθηκεύτηκαν', 'ok');
      await loadSpecs();
      // Επαναεπιλογή της αποθηκευμένης προδιαγραφής
      setTimeout(() => {
        const sel = el('spec-existing');
        if (sel) {
          const opt = [...sel.options].find(o => o.value.includes(specName));
          if (opt) { sel.value = opt.value; selectSpec(); }
        }
      }, 100);
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  // ============================================================
  // TAB 6: EMAIL / SMTP
  // ============================================================

  async function loadSmtp() {
    const cfg = await pyCall('get_smtp_config') || {};
    el('smtp-host').value = cfg.host  || '';
    el('smtp-port').value = cfg.port  || 587;
    el('smtp-user').value = cfg.user  || '';
    el('smtp-pass').value = cfg.pass  || '';
    el('smtp-from').value = cfg.from  || '';
  }

  async function saveSmtp() {
    const cfg = {
      host: val('smtp-host'),
      port: val('smtp-port') || '587',
      user: val('smtp-user'),
      pass: val('smtp-pass'),
      from: val('smtp-from'),
    };
    if (!cfg.host || !cfg.user) {
      App.toast('Server και username είναι υποχρεωτικά', 'warn');
      return;
    }
    try {
      await pyCallStrict('save_smtp_config', cfg);
      App.toast('Ρυθμίσεις email αποθηκεύτηκαν', 'ok');
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }

  async function testSmtp() {
    const cfg = {
      host: val('smtp-host'),
      port: val('smtp-port') || '587',
      user: val('smtp-user'),
      pass: val('smtp-pass'),
    };
    if (!cfg.host || !cfg.user || !cfg.pass) {
      App.toast('Συμπληρώστε server, username και password', 'warn');
      return;
    }
    App.toast('Δοκιμή σύνδεσης...', 'ok');
    try {
      const result = await window.pyBridge['test-smtp-ipc']?.(cfg);
      if (result?.success) {
        App.toast('✓ Σύνδεση επιτυχής!', 'ok');
      } else {
        App.toast('✗ Αποτυχία: ' + (result?.error || 'Άγνωστο σφάλμα'), 'fail');
      }
    } catch(e) {
      App.toast('Σφάλμα: ' + e.message, 'fail');
    }
  }


  // ============================================================
  // CLOUD SYNC
  // ============================================================

  async function loadCloudSync() {
    // Βήμα 1: Έλεγχος rclone
    const rclone = await pyBridgeCall('cloud-check-rclone');
    const step1Num    = document.getElementById('cloud-step-1')?.querySelector('.cloud-step-num');
    const step1Status = document.getElementById('cloud-step-1-status');
    const step1Body   = document.getElementById('cloud-step-1-body');

    if (rclone?.installed) {
      if (step1Num)    { step1Num.textContent = '✓'; step1Num.classList.add('ok'); }
      if (step1Status) { step1Status.textContent = 'Εγκατεστημένο · v' + (rclone.version || ''); step1Status.className = 'cloud-step-status ok'; }
    } else {
      if (step1Num)    { step1Num.textContent = '!'; step1Num.classList.add('fail'); }
      if (step1Status) { step1Status.textContent = 'Δεν βρέθηκε'; step1Status.className = 'cloud-step-status fail'; }
      if (step1Body)   step1Body.classList.remove('hidden');
      return; // Σταματάμε εδώ
    }

    // Βήμα 2: Remotes
    const remotes = await pyBridgeCall('cloud-list-remotes');
    const step2Num    = document.getElementById('cloud-step-2')?.querySelector('.cloud-step-num');
    const step2Status = document.getElementById('cloud-step-2-status');
    const step2Body   = document.getElementById('cloud-step-2-body');
    const remotesList = document.getElementById('cloud-remotes-list');

    if (remotes?.list?.length > 0) {
      if (step2Num)    { step2Num.textContent = '✓'; step2Num.classList.add('ok'); }
      if (step2Status) { step2Status.textContent = remotes.list.length + ' remote(s)'; step2Status.className = 'cloud-step-status ok'; }
      if (remotesList) {
        remotesList.innerHTML = remotes.list.map(r =>
          `<button class="btn-secondary btn-sm" style="margin:2px;"
                   onclick="SettingsPage.selectRemote('${r}')">${r}</button>`
        ).join('');
      }
      if (step2Body) step2Body.classList.remove('hidden');
    } else {
      if (step2Num)    { step2Num.textContent = '2'; }
      if (step2Status) { step2Status.textContent = 'Κανένα remote'; }
      if (step2Body)   step2Body.classList.remove('hidden');
    }

    // Βήμα 3: Αποθηκευμένο path
    const cfg = await pyBridgeCall('cloud-get-config');
    const step3Body = document.getElementById('cloud-step-3-body');
    const pathInput = document.getElementById('cloud-remote-path');
    const actions   = document.getElementById('cloud-actions');
    const lastSync  = document.getElementById('cloud-last-sync');

    if (cfg?.remotePath) {
      if (pathInput) pathInput.value = cfg.remotePath;
      const step3Num    = document.getElementById('cloud-step-3')?.querySelector('.cloud-step-num');
      const step3Status = document.getElementById('cloud-step-3-status');
      if (step3Num)    { step3Num.textContent = '✓'; step3Num.classList.add('ok'); }
      if (step3Status) { step3Status.textContent = cfg.remotePath; step3Status.className = 'cloud-step-status ok'; }
      if (actions) actions.classList.remove('hidden');
      if (lastSync && cfg.lastSync) {
        lastSync.textContent = 'Τελευταίο sync: ' + cfg.lastSync + (cfg.lastSyncStatus === 'ok' ? ' ✓' : ' ✗');
      }
    } else {
      if (step3Body) step3Body.classList.remove('hidden');
    }
  }

  async function pyBridgeCall(method, ...args) {
    try {
      const fn = window.pyBridge?.[method];
      if (typeof fn === 'function') return await fn(...args);
      return await window.pyBridge?.call?.(method, ...args);
    } catch(e) { return null; }
  }

  function selectRemote(remote) {
    const inp = document.getElementById('cloud-remote-path');
    if (inp) {
      const current = inp.value;
      // Αν έχει ήδη path μετά το remote, κράτα το path
      const pathPart = current.includes(':') ? current.split(':').slice(1).join(':') : 'lab-galatista';
      inp.value = remote + pathPart;
    }
    document.getElementById('cloud-step-3-body')?.classList.remove('hidden');
  }

  async function testCloudConnection() {
    const path  = document.getElementById('cloud-remote-path')?.value?.trim();
    const result_el = document.getElementById('cloud-test-result');
    if (!path) { if (result_el) { result_el.textContent = 'Εισάγετε remote path'; result_el.style.color = 'var(--warn-light)'; } return; }
    if (result_el) { result_el.textContent = 'Έλεγχος...'; result_el.style.color = 'var(--text-muted)'; }
    const result = await pyBridgeCall('cloud-test', path);
    if (result_el) {
      if (result?.ok) {
        result_el.textContent = '✓ Σύνδεση επιτυχής';
        result_el.style.color = 'var(--ok-light)';
      } else {
        result_el.textContent = '✗ ' + (result?.error || 'Αποτυχία σύνδεσης');
        result_el.style.color = 'var(--fail-light)';
      }
    }
  }

  async function saveCloudPath() {
    const path = document.getElementById('cloud-remote-path')?.value?.trim();
    if (!path) { App.toast('Εισάγετε remote path', 'warn'); return; }
    await pyBridgeCall('cloud-save-config', path);
    App.toast('Cloud path αποθηκεύτηκε', 'ok');
    await loadCloudSync();
  }

  function changeCloudPath() {
    document.getElementById('cloud-step-3-body')?.classList.remove('hidden');
    document.getElementById('cloud-actions')?.classList.add('hidden');
  }

  async function syncNow() {
    App.toast('Sync σε εξέλιξη...', 'info');
    const result = await pyBridgeCall('cloud-sync');
    if (result?.ok) {
      App.toast('Sync ολοκληρώθηκε', 'ok');
    } else if (result?.noInternet) {
      App.toast('Δεν υπάρχει σύνδεση internet', 'warn');
    } else {
      App.toast('Σφάλμα sync: ' + (result?.error || ''), 'fail');
    }
    await loadCloudSync();
  }

  async function restoreFromCloud() {
    App.confirm(
      'Επαναφορά από Cloud',
      'Θα κατεβαστούν τα αρχεία από το cloud στον τοπικό φάκελο backup. Συνέχεια;',
      async () => {
        App.toast('Επαναφορά σε εξέλιξη...', 'info');
        const result = await pyBridgeCall('cloud-restore');
        if (result?.ok) {
          App.toast('Επαναφορά ολοκληρώθηκε', 'ok');
        } else {
          App.toast('Σφάλμα: ' + (result?.error || ''), 'fail');
        }
      }
    );
  }

  async function openRcloneConfig() {
    await pyBridgeCall('cloud-open-terminal');
  }

  async function openLink(url) {
    await pyBridgeCall('open-external-link', url);
  }


  // ============================================================
  // PUBLIC API
  // ============================================================

  // ============================================================
  // ΑΠΟΘΗΚΕΥΣΗ — Φάκελος δεδομένων & Backup
  // ============================================================

  async function loadStorageSettings() {
    const result = await window.pyBridge['get-data-folder']?.();
    const folder = result?.folder || '';
    const inp = document.getElementById('data-folder-path');
    if (inp) inp.value = folder;
    await loadCloudSync();
    await loadCePeriods();
  }

  async function selectDataFolder() {
    const result = await window.pyBridge['select-data-folder']?.();
    if (result?.success) {
      const inp = document.getElementById('data-folder-path');
      if (inp) inp.value = result.folder;
      App.toast('Φάκελος δεδομένων ορίστηκε', 'ok');
    }
  }

  async function manualBackup() {
    const result = await window.pyBridge['backup-database']?.();
    if (result?.success) {
      App.toast(`Backup: ${result.path}`, 'ok');
    } else if (result?.reason === 'no_folder') {
      App.toast('Ορίστε πρώτα φάκελο δεδομένων', 'warn');
    } else {
      App.toast('Σφάλμα backup: ' + (result?.error || ''), 'fail');
    }
  }

  async function clearDataFolder() {
    await window.pyBridge['set-config']?.({ dataFolder: null });
    const inp = document.getElementById('data-folder-path');
    if (inp) inp.value = '';
    App.toast('Φάκελος δεδομένων εκκαθαρίστηκε', 'ok');
  }

  async function openDataFolder() {
    const result = await window.pyBridge['get-data-folder']?.();
    if (result?.folder) {
      await window.pyBridge['open-pdf']?.(result.folder);
    } else {
      App.toast('Δεν έχει οριστεί φάκελος δεδομένων', 'warn');
    }
  }

  // ============================================================
  // CE PERIOD MANAGEMENT
  // ============================================================

  async function loadCePeriods() {
    const period = await window.pyBridge?.get_active_ce_period?.();
    _renderActiveCePeriod(period);
    const all = await window.pyBridge?.get_all_ce_periods?.();
    _allPeriodsCache = all || [];
    _renderCeHistory(all || []);
  }

  function _renderActiveCePeriod(period) {
    const numEl    = document.getElementById('ce-current-number');
    const datesEl  = document.getElementById('ce-current-dates');
    const folderEl = document.getElementById('ce-current-folder');
    const badgeEl  = document.getElementById('ce-expiry-badge');
    const subCard  = document.getElementById('ce-subperiod-card');
    if (!numEl) return;

    if (!period || !period.ce_number) {
      numEl.textContent   = 'Δεν έχει οριστεί CE period';
      datesEl.textContent = '';
      return;
    }

    numEl.textContent   = period.ce_number + (period.ce_body ? ' — ' + period.ce_body : '');
    datesEl.textContent = `${_fmtDate(period.valid_from)} — ${_fmtDate(period.valid_to)}`;
    folderEl.textContent = period.data_folder || '';

    // Expiry badge
    const daysLeft = period._days_left;
    if (period._expiry_status && period._expiry_status !== 'ok') {
      const colors = { warning: '#f59e0b', urgent: '#ef4444', expired: '#dc2626' };
      const labels = {
        warning: `⚠ Λήγει σε ${daysLeft} μέρες`,
        urgent:  `🔴 Λήγει σε ${daysLeft} μέρες`,
        expired: `🔴 Έχει λήξει`,
      };
      badgeEl.style.display     = 'inline-block';
      badgeEl.style.background  = colors[period._expiry_status] + '22';
      badgeEl.style.color       = colors[period._expiry_status];
      badgeEl.style.border      = `1px solid ${colors[period._expiry_status]}`;
      badgeEl.textContent       = labels[period._expiry_status] || '';
    } else {
      badgeEl.style.display = 'none';
    }

    // Active subperiod
    const sub = period.active_subperiod;
    if (sub) {
      subCard.style.display = 'block';
      document.getElementById('ce-sub-report').textContent =
        sub.lab_report_number ? `Έκθεση: ${sub.lab_report_number}` : 'Χωρίς αριθμό έκθεσης';
      document.getElementById('ce-sub-from').textContent = `Από: ${_fmtDate(sub.valid_from)}`;
      const vals = [
        sub.ext_mb_value != null ? `MB: ${sub.ext_mb_value} g/kg` : null,
        sub.ext_se_value != null ? `SE: ${sub.ext_se_value}%`     : null,
        sub.ext_fl_value != null ? `FI: ${sub.ext_fl_value}%`     : null,
      ].filter(Boolean).join(' · ');
      document.getElementById('ce-sub-values').textContent = vals;
    } else {
      subCard.style.display = 'none';
    }
  }

  function _renderCeHistory(periods) {
    const el = document.getElementById('ce-history-list');
    if (!el) return;
    const inactive = periods.filter(p => !p.active);
    if (!inactive.length) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">Δεν υπάρχει ιστορικό</div>';
      return;
    }
    el.innerHTML = inactive.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;
           padding:8px 10px;border:1px solid var(--border);border-radius:6px;
           margin-bottom:6px;font-size:13px;">
        <div>
          <strong>${_esc(p.ce_number)}</strong>
          <span style="color:var(--text-muted);margin-left:8px;">${_fmtDate(p.valid_from)} — ${_fmtDate(p.valid_to)}</span>
          ${p.data_folder ? `<div style="font-size:11px;color:var(--text-muted);font-family:monospace;">${_esc(p.data_folder)}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;">
          <button class="btn-secondary btn-sm"
                  onclick="SettingsPage._enterArchiveFromHistory(${p.id})"
                  title="Είσοδος σε Archive Mode">
            🗄
          </button>
          ${p.data_folder ? `
          <button class="btn-secondary btn-sm"
                  onclick="SettingsPage._openCeFolder('${_esc(p.data_folder)}')">
            📂
          </button>` : ''}
          <button class="btn-secondary btn-sm"
                  onclick="SettingsPage.deleteCePeriod(${p.id})"
                  style="color:var(--fail);">
            ✕
          </button>
        </div>
      </div>
    `).join('');
  }

  async function showCePeriodView(periodId) {
    const all = await window.pyBridge?.get_all_ce_periods?.() || [];
    const period = all.find(p => p.id === periodId);
    if (!period) return;

    const subRows = (period.subperiods || []).map(s => {
      const vals = [
        s.ext_mb_value != null ? `MB: ${s.ext_mb_value}` : null,
        s.ext_se_value != null ? `SE: ${s.ext_se_value}%` : null,
        s.ext_fl_value != null ? `FI: ${s.ext_fl_value}%` : null,
      ].filter(Boolean).join('  ·  ');
      return `
        <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <div style="display:flex;justify-content:space-between;">
            <strong>${_esc(s.lab_report_number || '—')}</strong>
            <span style="color:var(--text-muted);">από ${_fmtDate(s.valid_from)}</span>
          </div>
          ${vals ? `<div style="color:var(--text-muted);margin-top:2px;">${vals}</div>` : ''}
          ${s.notes ? `<div style="color:var(--text-muted);margin-top:2px);font-style:italic;">${_esc(s.notes)}</div>` : ''}
        </div>`;
    }).join('') || '<div style="color:var(--text-muted);font-size:13px;">Δεν υπάρχουν υποπερίοδοι</div>';

    App.showModal(
      `📋 ${_esc(period.ce_number)} — Αρχείο`,
      `<div style="font-size:13px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;
                    padding:10px;background:var(--bg-card);border-radius:6px;margin-bottom:14px;">
          <div><span style="color:var(--text-muted);">Φορέας</span><br>
               <strong>${_esc(period.ce_body || '—')}</strong></div>
          <div><span style="color:var(--text-muted);">Ισχύς</span><br>
               <strong>${_fmtDate(period.valid_from)} – ${_fmtDate(period.valid_to)}</strong></div>
          ${period.data_folder ? `
          <div style="grid-column:1/-1;">
            <span style="color:var(--text-muted);">Φάκελος</span><br>
            <span style="font-family:monospace;font-size:11px;">${_esc(period.data_folder)}</span>
            <button class="btn-secondary btn-sm" style="margin-left:8px;"
                    onclick="SettingsPage._openCeFolder('${_esc(period.data_folder)}')">📂</button>
          </div>` : ''}
        </div>
        <div style="font-weight:600;margin-bottom:8px;">Υποπερίοδοι</div>
        ${subRows}
      </div>`,
      [{ label: 'Κλείσιμο', action: 'App.closeModal()', secondary: true }]
    );
  }

  let _allPeriodsCache = [];

  async function _enterArchiveFromHistory(periodId) {
    // Refresh cache αν χρειάζεται
    if (!_allPeriodsCache.length) {
      _allPeriodsCache = await window.pyBridge?.get_all_ce_periods?.() || [];
    }
    const period = _allPeriodsCache.find(p => p.id === periodId);
    if (!period) { App.toast('Δεν βρέθηκε η περίοδος', 'fail'); return; }
    await App.enterArchiveMode(period);
  }

  async function _openCeFolder(folder) {
    await window.pyBridge?.['open-pdf']?.(folder);
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _fmtDate(d) {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
      const [y, m, day] = d.substring(0, 10).split('-');
      return `${day}/${m}/${y}`;
    }
    return d;
  }

  // ── Επεξεργασία Υποπεριόδου ────────────────────────────────

  async function showEditSubperiodModal() {
    const period = await window.pyBridge?.get_active_ce_period?.();
    const sub = period?.active_subperiod;
    if (!sub) { App.toast('Δεν υπάρχει ενεργή υποπερίοδος', 'warn'); return; }
    const subId = sub.id;
    App.showModal('Επεξεργασία Υποπεριόδου', `
      <div class="form-grid">
        <div class="form-group full-width">
          <label>Αριθμός Έκθεσης Εξωτερικού Εργαστηρίου</label>
          <input type="text" id="edit-sub-report"
                 value="${_esc(sub.lab_report_number || '')}"
                 placeholder="πχ ΕΛΤΕΚ-2026-4471"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>MB (g/kg)</label>
          <input type="number" step="0.01" id="edit-sub-mb"
                 value="${sub.ext_mb_value ?? ''}"
                 placeholder="πχ 0.40" style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>SE (%)</label>
          <input type="number" step="0.1" id="edit-sub-se"
                 value="${sub.ext_se_value ?? ''}"
                 placeholder="πχ 78.0" style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>FI (%)</label>
          <input type="number" step="0.1" id="edit-sub-fl"
                 value="${sub.ext_fl_value ?? ''}"
                 placeholder="πχ 12.0" style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>Παρατηρήσεις</label>
          <textarea id="edit-sub-notes" rows="2"
                    style="width:100%;margin-top:4px;resize:vertical;">${_esc(sub.notes || '')}</textarea>
        </div>
        <div class="form-group full-width">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="edit-sub-pdf-subfolder"
                   ${sub.pdf_subfolder ? 'checked' : ''}
                   style="width:16px;height:16px;">
            <span>Ξεχωριστός υποφάκελος PDF για αυτή την υποπερίοδο</span>
          </label>
        </div>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '✓ Αποθήκευση', action: 'SettingsPage._saveEditSubperiod(' + subId + ')' },
    ]);
  }

  async function _saveEditSubperiod(subperiodId) {
    const reportNumber = document.getElementById('edit-sub-report')?.value?.trim() || null;
    const mb           = parseFloat(document.getElementById('edit-sub-mb')?.value)  || null;
    const se           = parseFloat(document.getElementById('edit-sub-se')?.value)  || null;
    const fl           = parseFloat(document.getElementById('edit-sub-fl')?.value)  || null;
    const notes        = document.getElementById('edit-sub-notes')?.value?.trim()   || null;
    const pdfSub       = document.getElementById('edit-sub-pdf-subfolder')?.checked ? 1 : 0;
    App.closeModal();
    const ok = await window.pyBridge?.update_subperiod?.(
      subperiodId, reportNumber, notes, pdfSub, mb, se, fl, null
    );
    if (ok) {
      App.toast('Υποπερίοδος ενημερώθηκε', 'ok');
      await loadCePeriods();
    } else {
      App.toast('Σφάλμα αποθήκευσης', 'fail');
    }
  }

  // ── Νέα Υποπερίοδος ─────────────────────────────────────

  async function showNewSubperiodModal() {
    const period = await window.pyBridge?.get_active_ce_period?.();
    if (!period?.id) {
      App.toast('Δεν υπάρχει ενεργή CE period', 'warn'); return;
    }
    const today = new Date().toISOString().substring(0, 10);
    App.showModal('Νέα Υποπερίοδος', `
      <div class="form-grid">
        <div class="form-group full-width">
          <label>Ημερομηνία Έναρξης <span class="required">*</span></label>
          <input type="date" id="sub-valid-from" value="${today}" style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>Αριθμός Έκθεσης Εξωτερικού Εργαστηρίου</label>
          <input type="text" id="sub-report-number" placeholder="πχ ΕΛΤΕΚ-2026-4471"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>MB (g/kg)</label>
          <input type="number" step="0.01" id="sub-mb" placeholder="πχ 0.40"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>SE (%)</label>
          <input type="number" step="0.1" id="sub-se" placeholder="πχ 78.0"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>FI (%)</label>
          <input type="number" step="0.1" id="sub-fl" placeholder="πχ 12.0"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>Παρατηρήσεις</label>
          <textarea id="sub-notes" rows="2"
                    style="width:100%;margin-top:4px;resize:vertical;"></textarea>
        </div>
        <div class="form-group full-width">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="sub-pdf-subfolder" style="width:16px;height:16px;">
            <span>Ξεχωριστός υποφάκελος PDF για αυτή την υποπερίοδο</span>
          </label>
        </div>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '✓ Δημιουργία', action: 'SettingsPage._saveNewSubperiod()' },
    ]);
    const subFromEl = document.getElementById('sub-valid-from');
    if (subFromEl) subFromEl._ceperiodId = period.id;
  }

  async function _saveNewSubperiod() {
    const validFrom    = document.getElementById('sub-valid-from')?.value?.trim();
    const reportNumber = document.getElementById('sub-report-number')?.value?.trim() || null;
    const mb           = parseFloat(document.getElementById('sub-mb')?.value) || null;
    const se           = parseFloat(document.getElementById('sub-se')?.value) || null;
    const fl           = parseFloat(document.getElementById('sub-fl')?.value) || null;
    const notes        = document.getElementById('sub-notes')?.value?.trim() || null;
    const pdfSub       = document.getElementById('sub-pdf-subfolder')?.checked ? 1 : 0;

    if (!validFrom) { App.toast('Εισάγετε ημερομηνία έναρξης', 'warn'); return; }

    const period = await window.pyBridge?.get_active_ce_period?.();
    if (!period?.id) { App.toast('Δεν υπάρχει ενεργή CE period', 'fail'); return; }

    App.closeModal();
    const id = await window.pyBridge?.create_subperiod?.(
      period.id, validFrom, reportNumber, notes, pdfSub, mb, se, fl, null
    );
    if (id) {
      // Ενημέρωση ημερομηνίας έναρξης για ονοματοδοσία backups
      await window.pyBridge?.['set-config']?.({ activePeriodStart: validFrom });
      App.toast('Νέα υποπερίοδος δημιουργήθηκε', 'ok');
      await loadCePeriods();
    } else {
      App.toast('Σφάλμα δημιουργίας υποπεριόδου', 'fail');
    }
  }

  // ── Επεξεργασία CE Period ───────────────────────────────────

  async function showEditCePeriodModal() {
    const period = await window.pyBridge?.get_active_ce_period?.();
    if (!period?.id) { App.toast('Δεν υπάρχει ενεργή CE period', 'warn'); return; }
    App.showModal('Επεξεργασία CE Period', `
      <div class="form-grid">
        <div class="form-group full-width">
          <label>Αριθμός Πιστοποιητικού <span class="required">*</span></label>
          <input type="text" id="edit-ce-number"
                 value="${_esc(period.ce_number || '')}"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>Φορέας Πιστοποίησης</label>
          <input type="text" id="edit-ce-body"
                 value="${_esc(period.ce_body || '')}"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>Ισχύς Από <span class="required">*</span></label>
          <input type="date" id="edit-ce-from"
                 value="${_toIsoDate(period.valid_from)}"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>Ισχύς Έως <span class="required">*</span></label>
          <input type="date" id="edit-ce-to"
                 value="${_toIsoDate(period.valid_to)}"
                 style="width:100%;margin-top:4px;">
        </div>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '✓ Αποθήκευση', action: 'SettingsPage._saveEditCePeriod(' + period.id + ')' },
    ]);
  }

  async function _saveEditCePeriod(periodId) {
    const ceNum  = document.getElementById('edit-ce-number')?.value?.trim();
    const ceBody = document.getElementById('edit-ce-body')?.value?.trim() || null;
    const from   = document.getElementById('edit-ce-from')?.value?.trim();
    const to     = document.getElementById('edit-ce-to')?.value?.trim();
    if (!ceNum || !from || !to) {
      App.toast('Συμπληρώστε τα υποχρεωτικά πεδία', 'warn'); return;
    }
    App.closeModal();

    // Ενημέρωση tbl_ce_periods
    const ok = await window.pyBridge?.call?.('update_ce_period', periodId, ceNum, ceBody, from, to);
    if (ok) {
      // Ενημέρωση και tbl_laboratory για συμβατότητα
      await window.pyBridge?.call?.('save_lab_info', {
        ce_number: ceNum, ce_body: ceBody || '',
        ce_valid_from: from, ce_valid_to: to,
      });
      await window.pyBridge?.['ce-notify-clear-snooze']?.();
      App.toast('CE period ενημερώθηκε', 'ok');
      await loadCePeriods();
      // Ενημέρωση sidebar
      if (window.App?.updateSidebarCeBadge) window.App.updateSidebarCeBadge();
    } else {
      App.toast('Σφάλμα αποθήκευσης', 'fail');
    }
  }

  // Βοηθητική: DD/MM/YYYY ή YYYY-MM-DD → YYYY-MM-DD για date input
  function _toIsoDate(d) {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
    // DD/MM/YYYY
    const parts = d.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    return d;
  }

  // ── Νέα CE Period ────────────────────────────────────────

  async function showNewCePeriodModal() {
    const current = await window.pyBridge?.get_active_ce_period?.();
    const lab     = await window.pyBridge?.call?.('get_lab_info') || {};

    // Προτεινόμενα στοιχεία από tbl_laboratory
    const prefillNum  = _esc(lab.ce_number  || '');
    const prefillBody = _esc(lab.ce_body    || current?.ce_body || '');
    const prefillFrom = _toIsoDate(lab.ce_valid_from || '');
    const prefillTo   = _toIsoDate(lab.ce_valid_to   || '');

    App.showModal('Νέα CE Period', `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">
        Η τρέχουσα period (${_esc(current?.ce_number || '—')}) θα αρχειοθετηθεί.
        Ο νέος φάκελος δεδομένων θα οριστεί αυτόματα ως ο κύριος φάκελος.
      </p>
      <div class="form-grid">
        <div class="form-group full-width">
          <label>Αριθμός Πιστοποιητικού <span class="required">*</span></label>
          <input type="text" id="nce-number" value="${prefillNum}"
                 placeholder="πχ 1128-CPR-0221"
                 style="width:100%;margin-top:4px;"
                 oninput="SettingsPage._updateSuggestedFolder()">
        </div>
        <div class="form-group full-width">
          <label>Φορέας Πιστοποίησης</label>
          <input type="text" id="nce-body" value="${prefillBody}"
                 placeholder="πχ EUROCERT Α.Ε."
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>Ισχύς Από <span class="required">*</span></label>
          <input type="date" id="nce-from" value="${prefillFrom}"
                 style="width:100%;margin-top:4px;"
                 oninput="SettingsPage._updateSuggestedFolder()">
        </div>
        <div class="form-group">
          <label>Ισχύς Έως <span class="required">*</span></label>
          <input type="date" id="nce-to" value="${prefillTo}"
                 style="width:100%;margin-top:4px;"
                 oninput="SettingsPage._updateSuggestedFolder()">
        </div>
        <div class="form-group full-width">
          <label>Φάκελος Δεδομένων <span class="required">*</span></label>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
            <input type="text" id="nce-folder"
                   placeholder="Προτείνεται αυτόματα"
                   style="flex:1;">
            <button class="btn-secondary btn-sm"
                    onclick="SettingsPage._selectNewCeFolder()">📂</button>
          </div>
          <small class="form-hint" id="nce-folder-hint"></small>
        </div>
      </div>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '✓ Δημιουργία', action: 'SettingsPage._saveNewCePeriod()' },
    ]);

    // Αυτόματη πρόταση φακέλου αμέσως μετά το άνοιγμα
    setTimeout(() => SettingsPage._updateSuggestedFolder(), 100);
  }

  async function _updateSuggestedFolder() {
    const ceNum  = document.getElementById('nce-number')?.value?.trim();
    const from   = document.getElementById('nce-from')?.value;
    const to     = document.getElementById('nce-to')?.value;
    if (!ceNum) return;
    const result = await window.pyBridge?.['ce-get-suggested-folder']?.(ceNum, from, to);
    if (result?.ok) {
      const inp = document.getElementById('nce-folder');
      if (inp && !inp._manuallyEdited) inp.value = result.folder;
      const hint = document.getElementById('nce-folder-hint');
      if (hint) hint.textContent = 'Προτεινόμενος φάκελος — μπορείτε να τον αλλάξετε';
    }
  }

  async function _selectNewCeFolder() {
    const result = await window.pyBridge?.['ce-select-folder']?.();
    if (result?.success) {
      const inp = document.getElementById('nce-folder');
      if (inp) { inp.value = result.folder; inp._manuallyEdited = true; }
    }
  }

  async function _saveNewCePeriod() {
    const ceNum  = document.getElementById('nce-number')?.value?.trim();
    const ceBody = document.getElementById('nce-body')?.value?.trim() || null;
    const from   = document.getElementById('nce-from')?.value?.trim();
    const to     = document.getElementById('nce-to')?.value?.trim();
    const folder = document.getElementById('nce-folder')?.value?.trim() || null;

    if (!ceNum || !from || !to) {
      App.toast('Συμπληρώστε τα υποχρεωτικά πεδία', 'warn'); return;
    }

    App.closeModal();
    const id = await window.pyBridge?.create_ce_period?.(ceNum, ceBody, from, to, folder);
    if (id) {
      // Ενημέρωση dataFolder + lab info
      if (folder) {
        await window.pyBridge?.['set-config']?.({ dataFolder: folder });
        await window.pyBridge?.update_ce_period_folder?.(id, folder);
        const inp = document.getElementById('data-folder-path');
        if (inp) inp.value = folder;
      }
      // Ενημέρωση CE στοιχείων εργαστηρίου
      await window.pyBridge?.call?.('save_lab_info', {
        ce_number: ceNum, ce_body: ceBody || '',
        ce_valid_from: from, ce_valid_to: to,
      });
      // Καθαρισμός CE notification snooze
      await window.pyBridge?.['ce-notify-clear-snooze']?.();
      // Αποθήκευση ημερομηνίας έναρξης για ονοματοδοσία backups
      await window.pyBridge?.['set-config']?.({ activePeriodStart: from });
      App.toast('Νέα CE period δημιουργήθηκε', 'ok');
      await loadCePeriods();
      await loadStorageSettings();
    } else {
      App.toast('Σφάλμα δημιουργίας CE period', 'fail');
    }
  }

  // ── Clean Start ─────────────────────────────────────────────

  async function showCleanStartModal() {
    const period      = await window.pyBridge?.get_active_ce_period?.();
    const sampleCount = await window.pyBridge?.call?.('get_samples_count') ?? '?';
    App.showModal('🗑 Clean Start — Κλείσιμο Περιόδου', `
      <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);
                  border-radius:8px;padding:12px;margin-bottom:14px;">
        <div style="font-weight:600;color:#ef4444;margin-bottom:6px;">⚠ Μη αναστρέψιμη ενέργεια</div>
        <div style="font-size:13px;color:var(--text-muted);">
          Θα διαγραφούν <strong style="color:var(--text);">${sampleCount} δείγματα</strong>
          και όλες οι εξαρτημένες δοκιμές της περιόδου
          <strong style="color:var(--text);">${_esc(period?.ce_number || '')}</strong>.
          Η περίοδος αρχειοθετείται και η εφαρμογή επιστρέφει στον οδηγό εγκατάστασης.
        </div>
      </div>

      <div style="font-size:13px;margin-bottom:10px;"><strong>Τι θα γίνει αυτόματα:</strong></div>
      <div style="font-size:13px;color:var(--text-muted);display:flex;flex-direction:column;gap:5px;margin-bottom:16px;">
        <div>✓ Final backup (VACUUM INTO) + cloud sync</div>
        <div>✓ Διαγραφή δειγμάτων & δοκιμών</div>
        <div>✓ Αρχειοθέτηση CE period (παραμένει για ανάγνωση)</div>
        <div>✓ Reset μετρητή δειγμάτων</div>
        <div>✓ Επιστροφή στον οδηγό νέας περιόδου</div>
      </div>

      <div style="font-size:13px;margin-bottom:8px;"><strong>Τι να κρατηθεί:</strong></div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
          <input type="checkbox" id="cs-keep-technicians" checked
                 style="width:15px;height:15px;cursor:pointer;">
          Τεχνικοί
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
          <input type="checkbox" id="cs-keep-products" checked
                 style="width:15px;height:15px;cursor:pointer;">
          Πηγές αδρανών & Προδιαγραφές
        </label>
      </div>

      <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">
        Για επιβεβαίωση πληκτρολογήστε <strong>CLEAN</strong>:
      </div>
      <input type="text" id="clean-confirm-input"
             placeholder="CLEAN" autocomplete="off"
             style="width:100%;font-family:monospace;">
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '🗑 Εκτέλεση Clean Start', action: 'SettingsPage._doCleanStart()' },
    ]);
  }

  async function _doCleanStart() {
    const input = document.getElementById('clean-confirm-input')?.value?.trim();
    if (input !== 'CLEAN') {
      App.toast('Πληκτρολογήστε CLEAN για επιβεβαίωση', 'warn'); return;
    }

    const keepTechnicians = document.getElementById('cs-keep-technicians')?.checked ?? true;
    const keepProducts    = document.getElementById('cs-keep-products')?.checked ?? true;

    App.closeModal();

    // Βήμα 1: Παραγωγή PDF βιβλιοθήκης πριν τη διαγραφή
    App.toast('Βήμα 1/2 — Παραγωγή PDF βιβλιοθήκης...', 'info');
    if (window.ReportsPage?.generatePdfLibrary) {
      await window.ReportsPage.generatePdfLibrary(true); // silent=true
    }

    // Βήμα 2: Clean Start
    App.toast('Βήμα 2/2 — Clean Start σε εξέλιξη...', 'info');
    const result = await window.pyBridge?.['clean-start']?.({ keepTechnicians, keepProducts });
    if (result?.ok) {
      App.toast(
        `Clean Start ολοκληρώθηκε — ${result.deleted} δείγματα διαγράφηκαν. Επανεκκίνηση σε λίγο...`,
        'ok'
      );
      // Η επανεκκίνηση γίνεται αυτόματα από το main process (2.5s)
    } else {
      App.toast('Σφάλμα Clean Start: ' + (result?.error || 'άγνωστο'), 'fail');
    }
  }

  // ── Διαγραφή Υποπεριόδου & CE Period ───────────────────────

  async function deleteActiveSubperiod() {
    const period = await window.pyBridge?.get_active_ce_period?.();
    const sub = period?.active_subperiod;
    if (!sub) return;
    App.showModal('Διαγραφή Υποπεριόδου', `
      <p>Είστε σίγουροι ότι θέλετε να διαγράψετε την υποπερίοδο
         <strong>${_esc(sub.lab_report_number || 'χωρίς αριθμό έκθεσης')}</strong>
         (από ${_fmtDate(sub.valid_from)});</p>
      <p style="color:var(--text-muted);font-size:13px;">
        Αν υπάρχουν δείγματα που την αναφέρουν, η διαγραφή δεν θα επιτραπεί.
      </p>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '✕ Διαγραφή', action: 'SettingsPage._doDeleteSubperiod(' + sub.id + ')' },
    ]);
  }

  async function _doDeleteSubperiod(subperiodId) {
    App.closeModal();
    const result = await window.pyBridge?.delete_subperiod?.(subperiodId);
    if (result?.ok) {
      App.toast('Υποπερίοδος διαγράφηκε', 'ok');
      await loadCePeriods();
    } else if (result?.reason === 'has_samples') {
      App.toast(`Δεν είναι δυνατή η διαγραφή — υπάρχουν ${result.count} δείγματα`, 'warn');
    } else if (result?.reason === 'last_subperiod') {
      App.toast('Δεν μπορεί να διαγραφεί η μοναδική υποπερίοδος', 'warn');
    } else {
      App.toast('Σφάλμα διαγραφής', 'fail');
    }
  }

  async function deleteCePeriod(periodId) {
    App.showModal('Διαγραφή CE Period', `
      <p>Είστε σίγουροι ότι θέλετε να διαγράψετε αυτή την CE period
         και όλες τις υποπεριόδους της;</p>
      <p style="color:var(--text-muted);font-size:13px;">
        Αν υπάρχουν δείγματα που την αναφέρουν, η διαγραφή δεν θα επιτραπεί.
      </p>
    `, [
      { label: 'Ακύρωση', action: 'App.closeModal()', secondary: true },
      { label: '✕ Διαγραφή', action: 'SettingsPage._doDeleteCePeriod(' + periodId + ')' },
    ]);
  }

  async function _doDeleteCePeriod(periodId) {
    App.closeModal();
    const result = await window.pyBridge?.delete_ce_period?.(periodId);
    if (result?.ok) {
      App.toast('CE period διαγράφηκε', 'ok');
      // Ενημέρωση dataFolder με το path της νέας active period
      const newPeriod = await window.pyBridge?.get_active_ce_period?.();
      if (newPeriod?.data_folder) {
        await window.pyBridge?.['set-config']?.({ dataFolder: newPeriod.data_folder });
        const inp = document.getElementById('data-folder-path');
        if (inp) inp.value = newPeriod.data_folder;
      }
      await loadCePeriods();
    } else if (result?.reason === 'has_samples') {
      App.toast(`Δεν είναι δυνατή η διαγραφή — υπάρχουν ${result.count} δείγματα`, 'warn');
    } else if (result?.reason === 'last_period') {
      App.toast('Δεν μπορεί να διαγραφεί η μοναδική CE period', 'warn');
    } else {
      App.toast('Σφάλμα διαγραφής', 'fail');
    }
  }

  window.SettingsPage = {
    switchTab,
    // Lab
    saveLab,
    saveGuideEnabled,
    // Materials
    showAddProduct, _saveNewProduct,
    _materialTypeInput, _selectMaterialType,
    _hideMaterialDropdown, _updateProductNamePreview,
    editProduct,    _saveEditProduct,
    toggleProduct,  _doToggleProduct,
    deleteProduct,  _doDeleteProduct,
    openSievesCard, closeSievesCard,
    saveSieves,
    _addSieve, _addSieveFromInput,
    _sieveInputChange, _hideSieveDropdown,
    _clearPreset,
    _sievePillContextMenu, _hideSieveContextMenu, _confirmRemoveSieve,
    // Sources
    showAddSource, _saveNewSource,
    editSource,    _saveEditSource,
    toggleSource,  _doToggleSource,
    // Technicians
    showAddTechnician, _saveNewTechnician,
    toggleTechnician,
    // Specs
    loadSpecs, selectSpec, newSpec, deleteSpec, saveSpecs,
    // Email
    saveSmtp, testSmtp,
    // Storage
    selectDataFolder, clearDataFolder, manualBackup, openDataFolder,
    loadCloudSync, selectRemote, testCloudConnection, saveCloudPath,
    changeCloudPath, syncNow, restoreFromCloud, openRcloneConfig, openLink,
    // CE Periods
    loadCePeriods, showNewSubperiodModal, _saveNewSubperiod,
    showEditSubperiodModal, _saveEditSubperiod,
    showEditCePeriodModal, _saveEditCePeriod,
    showCleanStartModal, _doCleanStart,
    deleteActiveSubperiod, _doDeleteSubperiod,
    deleteCePeriod, _doDeleteCePeriod,
    showNewCePeriodModal, _updateSuggestedFolder, _selectNewCeFolder,
    _saveNewCePeriod, _openCeFolder, showCePeriodView,
    _enterArchiveFromHistory,
  };

  // ============================================================
  // KICKOFF
  // ============================================================

  init().catch(e => console.error('[SettingsPage] init error:', e));

})();
