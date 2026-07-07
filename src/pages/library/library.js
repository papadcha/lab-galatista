// ES module — φορτώνεται με πραγματικό <script type="module" src="...">
// (βλ. main-app.js: Pages.library.module + navigateTo()).
import { App } from '../../main-app.js';
import { t } from '../../i18n/i18n.js';

(async function () {
  let _sections    = [];
  let _activeSec   = null;
  let _standards   = [];
  let _editDocId   = null;

  // ── Helpers ───────────────────────────────────────────────
  const pyCall = App.pyCall || window.pyCall;
  // _esc: ίδιο όνομα με το global του main-app.js, πανομοιότυπη λογική —
  // αφαιρέθηκε το τοπικό αντίγραφο.
  function _fmt(d) {
    if (!d) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`;
    }
    return d;
  }
  function _daysLeft(dateStr) {
    if (!dateStr) return null;
    let d;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [dd,mm,yy] = dateStr.split('/');
      d = new Date(`${yy}-${mm}-${dd}`);
    } else {
      d = new Date(dateStr);
    }
    return Math.ceil((d - new Date()) / 86400000);
  }

  // ── Sections ─────────────────────────────────────────────
  async function loadSections() {
    _sections = await pyCall('get_doc_sections') || [];
    _standards = await App.fetchStandards();
    renderSections();
    if (_sections.length) selectSection(_sections[0]);
  }

  function renderSections() {
    const el = document.getElementById('section-list');
    if (!el) return;
    el.innerHTML = _sections.map(s => `
      <div class="section-item ${_activeSec?.id === s.id ? 'active' : ''}"
           onclick="LibraryPage.selectSection(${s.id})"
           style="display:flex;align-items:center;gap:8px;padding:8px 10px;
                  border-radius:6px;cursor:pointer;font-size:13px;
                  background:${_activeSec?.id === s.id ? 'var(--bg-active,rgba(59,130,246,.15))' : 'transparent'};
                  border:1px solid ${_activeSec?.id === s.id ? 'rgba(59,130,246,.3)' : 'transparent'};">
        <span>${_esc(s.icon)}</span>
        <span style="flex:1;">${_esc(s.name)}</span>
        <span style="font-size:11px;color:var(--text-muted);">${s.doc_count}</span>
        ${s.is_custom ? `<span onclick="event.stopPropagation();LibraryPage.editSection(${s.id})"
              style="cursor:pointer;opacity:.5;font-size:11px;">✏️</span>` : ''}
      </div>`).join('') +
      (document.getElementById('library-standards-alert') ? '' : '');
  }

  function selectSection(secOrId) {
    const sec = typeof secOrId === 'number'
      ? _sections.find(s => s.id === secOrId)
      : secOrId;
    _activeSec = sec;
    renderSections();
    const title = document.getElementById('section-title');
    if (title) title.textContent = sec ? `${sec.icon} ${sec.name}` : '—';
    loadDocuments();
  }

  // ── Documents ─────────────────────────────────────────────
  async function loadDocuments() {
    if (!_activeSec) return;
    const docs = await pyCall('get_documents', _activeSec.id) || [];
    renderDocuments(docs);
    showStandardsAlert(docs);
  }

  function showStandardsAlert(docs) {
    const alert = document.getElementById('library-standards-alert');
    const msg   = document.getElementById('library-standards-msg');
    if (!alert || !_standards.length) return;
    const outdated = docs.filter(d => App.findOutdatedStandard(d, _standards));
    if (outdated.length) {
      alert.style.display = 'block';
      const word = outdated.length === 1
        ? t('library.outdated_word_singular', 'έγγραφο')
        : t('library.outdated_word_plural', 'έγγραφα');
      msg.textContent = `${outdated.length} ${word}${t('library.outdated_alert_suffix', ' με παλιά έκδοση: ')}` +
        outdated.map(d => `${d.code} (${t('library.outdated_you_have', 'έχεις')}: ${d.version || '—'}, ${t('library.outdated_latest', 'τελευταία')}: ${App.findOutdatedStandard(d, _standards)?.latest})`).join(', ');
    } else {
      alert.style.display = 'none';
    }
  }

  function renderDocuments(docs) {
    const el = document.getElementById('document-list');
    if (!el) return;
    if (!docs.length) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">${t('library.no_documents', 'Δεν υπάρχουν έγγραφα σε αυτή την ενότητα.')}</div>`;
      return;
    }
    el.innerHTML = docs.map(d => {
      const days     = _daysLeft(d.expires_at);
      const expired  = days !== null && days < 0;
      const expiring = days !== null && days >= 0 && days <= 30;
      let expiryBadge = '';
      if (d.expires_at) {
        const col = expired ? '#ef4444' : expiring ? '#f59e0b' : '#22c55e';
        const lbl = expired ? `${t('library.expired_prefix', 'Έληξε')} ${_fmt(d.expires_at)}`
                  : expiring ? `${t('library.expiring_in_prefix', 'Λήγει σε')} ${days} ${t('library.expiring_in_suffix', 'μέρες')}`
                  : `${t('library.expires_prefix', 'Λήγει')} ${_fmt(d.expires_at)}`;
        expiryBadge = `<span style="font-size:11px;padding:2px 7px;border-radius:10px;
                        background:${col}22;color:${col};border:1px solid ${col}44;">${lbl}</span>`;
      }
      // Standards check badge
      const outdatedStd = App.findOutdatedStandard(d, _standards);
      const outdatedBadge = outdatedStd
        ? `<span style="font-size:11px;padding:2px 7px;border-radius:10px;
             background:rgba(180,83,9,.12);color:#b45309;border:1px solid rgba(180,83,9,.3);">
             ${t('library.new_version_badge', 'Νέα έκδοση')}: ${_esc(outdatedStd.latest)}</span>`
        : '';

      return `
        <div style="background:var(--bg-card);border:1px solid var(--border);
                    border-radius:8px;padding:12px 14px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div style="flex:1;">
              <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${_esc(d.title)}</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
                ${d.code ? `<span style="font-size:12px;font-family:'IBM Plex Mono',monospace;
                              background:var(--bg);padding:2px 7px;border-radius:4px;
                              border:1px solid var(--border);">${_esc(d.code)}${d.version ? ' · '+_esc(d.version) : ''}</span>` : ''}
                ${expiryBadge}
                ${outdatedBadge}
              </div>
              ${d.notes ? `<div style="font-size:12px;color:var(--text-muted);">${_esc(d.notes)}</div>` : ''}
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
              ${d.cloud_path ? `<button class="btn-secondary btn-sm" title="${t('library.tooltip_open', 'Άνοιγμα')}"
                  onclick="LibraryPage.openDocument('${_esc(d.cloud_path)}')">📂</button>` : ''}
              ${d.url ? `<button class="btn-secondary btn-sm" title="${t('library.tooltip_official_source', 'Επίσημη πηγή')}"
                  onclick="window.pyBridge['open-pdf']('${_esc(d.url)}')">🌐</button>` : ''}
              <button class="btn-secondary btn-sm" title="${t('library.tooltip_edit', 'Επεξεργασία')}"
                  onclick="LibraryPage.editDocument(${d.id})">✏️</button>
              <button class="btn-secondary btn-sm" title="${t('library.tooltip_delete', 'Διαγραφή')}" style="color:var(--fail);"
                  onclick="LibraryPage.deleteDocument(${d.id}, '${_esc(d.title)}', '${_esc(d.cloud_path||'')}')">🗑</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ── Add / Edit Document Modal ─────────────────────────────
  function showAddDocument() {
    _editDocId = null;
    _showDocModal({});
  }

  async function editDocument(docId) {
    const docs = await pyCall('get_documents', _activeSec?.id) || [];
    const doc  = docs.find(d => d.id === docId);
    if (!doc) return;
    _editDocId = docId;
    _showDocModal(doc);
  }

  function _showDocModal(doc) {
    App.showModal(
      _editDocId ? t('library.edit_document_title', '✏️ Επεξεργασία Εγγράφου') : t('library.add_document_title', '+ Προσθήκη Εγγράφου'),
      `<div class="form-grid">
        <div class="form-group full-width">
          <label>${t('library.field_title', 'Τίτλος')} <span class="required">*</span></label>
          <input type="text" id="doc-title" value="${_esc(doc.title||'')}"
                 placeholder="${t('library.field_title_placeholder', 'πχ EN 12620 — Αδρανή σκυροδέματος')}"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>${t('library.field_code', 'Κωδικός')}</label>
          <input type="text" id="doc-code" value="${_esc(doc.code||'')}"
                 placeholder="${t('library.field_code_placeholder', 'πχ EN 12620')}" style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>${t('library.field_version', 'Έκδοση')}</label>
          <input type="text" id="doc-version" value="${_esc(doc.version||'')}"
                 placeholder="${t('library.field_version_placeholder', 'πχ 2002+A1:2008')}" style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>${t('library.field_expires', 'Ημ/νία Λήξης')}</label>
          <input type="text" id="doc-expires" value="${_esc(doc.expires_at||'')}"
                 placeholder="DD/MM/YYYY" style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group">
          <label>${t('library.field_url', 'URL Επίσημης Πηγής')}</label>
          <input type="text" id="doc-url" value="${_esc(doc.url||'')}"
                 placeholder="https://..." style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>${t('library.field_notes', 'Σημειώσεις')}</label>
          <input type="text" id="doc-notes" value="${_esc(doc.notes||'')}"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>${t('library.field_cloud_file', 'Αρχείο (cloud)')}</label>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
            <input type="text" id="doc-cloud-path" value="${_esc(doc.cloud_path||'')}"
                   placeholder="—" style="flex:1;" readonly>
            <button class="btn-secondary btn-sm" onclick="LibraryPage._pickDocFile()">${t('library.upload_button', '📎 Ανέβασμα')}</button>
          </div>
          <small style="color:var(--text-muted);font-size:11px;">
            ${t('library.cloud_upload_hint', 'Το αρχείο ανεβαίνει στο cloud αυτόματα.')}
          </small>
        </div>
      </div>`,
      [
        { label: t('common.cancel', 'Ακύρωση'), action: 'App.closeModal()', secondary: true },
        { label: _editDocId ? t('library.save_button', '💾 Αποθήκευση') : t('library.add_button_short', '+ Προσθήκη'), action: 'LibraryPage._saveDocument()' },
      ]
    );
  }

  async function _pickDocFile() {
    if (!_activeSec) return;
    App.toast(t('library.uploading_toast', 'Ανέβασμα αρχείου...'), 'info');
    const result = await window.pyBridge?.['upload-document']?.({ sectionName: _activeSec.name });
    if (result?.ok) {
      const inp = document.getElementById('doc-cloud-path');
      if (inp) inp.value = result.cloud_path;
      App.toast(t('library.uploaded_prefix', '✅ Ανέβηκε: ') + result.filename, 'ok');
    } else if (!result?.canceled) {
      App.toast(t('library.generic_error_prefix', 'Σφάλμα: ') + (result?.error || ''), 'fail');
    }
  }

  async function _saveDocument() {
    const title   = document.getElementById('doc-title')?.value?.trim();
    if (!title) { App.toast(t('library.title_required', 'Ο τίτλος είναι υποχρεωτικός'), 'warn'); return; }
    const payload = [
      title,
      document.getElementById('doc-code')?.value?.trim()       || null,
      document.getElementById('doc-version')?.value?.trim()    || null,
      document.getElementById('doc-expires')?.value?.trim()    || null,
      document.getElementById('doc-cloud-path')?.value?.trim() || null,
      document.getElementById('doc-url')?.value?.trim()        || null,
      document.getElementById('doc-notes')?.value?.trim()      || null,
    ];
    let result;
    if (_editDocId) {
      result = await pyCall('update_document', _editDocId, ...payload);
    } else {
      result = await pyCall('create_document', _activeSec.id, ...payload);
    }
    App.closeModal();
    if (result?.ok) {
      App.toast(_editDocId ? t('library.saved_toast', 'Αποθηκεύτηκε') : t('library.added_toast', 'Προστέθηκε'), 'ok');
      await loadSections();
      if (_activeSec) selectSection(_activeSec.id);
    } else {
      App.toast(t('library.generic_error_prefix', 'Σφάλμα: ') + (result?.error || ''), 'fail');
    }
  }

  // ── Open / Delete ─────────────────────────────────────────
  async function openDocument(cloudPath) {
    App.toast(t('library.downloading_toast', 'Λήψη εγγράφου...'), 'info');
    const result = await window.pyBridge?.['open-document']?.(cloudPath);
    if (!result?.ok) App.toast(t('library.generic_error_prefix', 'Σφάλμα: ') + (result?.error || ''), 'fail');
  }

  function deleteDocument(docId, title, cloudPath) {
    App.showModal(
      t('library.delete_document_title', '🗑 Διαγραφή Εγγράφου'),
      `<div style="font-size:13px;">${t('library.delete_document_confirm_prefix', 'Διαγραφή')} <strong>${_esc(title)}</strong>;<br>
       ${cloudPath ? t('library.delete_cloud_note', 'Το αρχείο θα διαγραφεί και από το cloud.') : ''}</div>`,
      [
        { label: t('common.cancel', 'Ακύρωση'), action: 'App.closeModal()', secondary: true },
        { label: t('common.delete', '🗑 Διαγραφή'), action: `LibraryPage._confirmDeleteDocument(${docId}, '${_esc(cloudPath)}')` },
      ]
    );
  }

  async function _confirmDeleteDocument(docId, cloudPath) {
    App.closeModal();
    await pyCall('delete_document', docId);
    if (cloudPath) await window.pyBridge?.['delete-document-cloud']?.(cloudPath);
    App.toast(t('library.deleted_toast', 'Διαγράφηκε'), 'ok');
    await loadSections();
    if (_activeSec) selectSection(_activeSec.id);
  }

  // ── Add / Edit Section ────────────────────────────────────
  function showAddSection() {
    App.showModal(
      t('library.new_section_title', '+ Νέα Ενότητα'),
      `<div class="form-grid">
        <div class="form-group full-width">
          <label>${t('library.field_name', 'Όνομα')} <span class="required">*</span></label>
          <input type="text" id="sec-name" placeholder="${t('library.field_name_placeholder', 'πχ Συμβόλαια')}"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>${t('library.field_icon', 'Εικονίδιο')}</label>
          <input type="text" id="sec-icon" value="📁" maxlength="2"
                 style="width:60px;margin-top:4px;font-size:20px;text-align:center;">
        </div>
      </div>`,
      [
        { label: t('common.cancel', 'Ακύρωση'), action: 'App.closeModal()', secondary: true },
        { label: t('library.add_button_short', '+ Προσθήκη'), action: 'LibraryPage._saveSection()' },
      ]
    );
  }

  function editSection(secId) {
    const sec = _sections.find(s => s.id === secId);
    if (!sec) return;
    App.showModal(
      t('library.edit_section_title', '✏️ Επεξεργασία Ενότητας'),
      `<div class="form-grid">
        <div class="form-group full-width">
          <label>${t('library.field_name', 'Όνομα')}</label>
          <input type="text" id="sec-name" value="${_esc(sec.name)}"
                 style="width:100%;margin-top:4px;">
        </div>
        <div class="form-group full-width">
          <label>${t('library.field_icon', 'Εικονίδιο')}</label>
          <input type="text" id="sec-icon" value="${_esc(sec.icon)}" maxlength="2"
                 style="width:60px;margin-top:4px;font-size:20px;text-align:center;">
        </div>
      </div>`,
      [
        { label: t('common.cancel', 'Ακύρωση'),   action: 'App.closeModal()',                    secondary: true },
        { label: t('common.delete', '🗑 Διαγραφή'), action: `LibraryPage._deleteSection(${secId})`, secondary: true },
        { label: t('library.save_button', '💾 Αποθήκευση'), action: `LibraryPage._saveSection(${secId})` },
      ]
    );
  }

  async function _saveSection(secId) {
    const name = document.getElementById('sec-name')?.value?.trim();
    const icon = document.getElementById('sec-icon')?.value?.trim() || '📁';
    if (!name) { App.toast(t('library.name_required', 'Το όνομα είναι υποχρεωτικό'), 'warn'); return; }
    App.closeModal();
    const result = secId
      ? await pyCall('update_doc_section', secId, name, icon)
      : await pyCall('create_doc_section', name, icon);
    if (result?.ok) { App.toast(t('library.saved_toast', 'Αποθηκεύτηκε'), 'ok'); await loadSections(); }
    else App.toast(t('library.generic_error_prefix', 'Σφάλμα: ') + (result?.error || ''), 'fail');
  }

  async function _deleteSection(secId) {
    App.closeModal();
    const result = await pyCall('delete_doc_section', secId);
    if (result?.ok) {
      App.toast(t('library.deleted_toast', 'Διαγράφηκε'), 'ok');
      if (_activeSec?.id === secId) _activeSec = null;
      await loadSections();
    } else {
      App.toast(t('library.generic_error_prefix', 'Σφάλμα: ') + (result?.error || ''), 'fail');
    }
  }

  // ── Init ──────────────────────────────────────────────────
  await loadSections();

  window.LibraryPage = {
    selectSection: (id) => selectSection(id),
    showAddDocument,
    editDocument,
    openDocument,
    deleteDocument,
    showAddSection,
    editSection,
    _pickDocFile,
    _saveDocument,
    _saveSection,
    _deleteSection,
    _confirmDeleteDocument,
  };
})();
