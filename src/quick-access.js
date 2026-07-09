// quick-access.js
// ΔAiγμα LiMS — Γρήγορη Πρόσβαση: sidebar badges + cascading στήλες
// πάνω σε εγγράφα της Βιβλιοθήκης σημαδεμένα με quick_access_type
// (βλ. database/db_manager.py: set_document_quick_access / get_quick_access_*).
import { App, pyCall } from './main-app.js';
import { t } from './i18n/i18n.js';

let _flyoutEl = null;
let _openType = null;

export function initQuickAccess() {
  _flyoutEl = document.getElementById('qa-flyout');
  if (!_flyoutEl) return;

  document.querySelectorAll('.qa-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.dataset.qaType;
      if (_openType === type) { closeQuickAccess(); return; }
      openBadge(type);
    });
  });

  document.addEventListener('click', (e) => {
    if (!_openType) return;
    if (_flyoutEl.contains(e.target)) return;
    closeQuickAccess();
  });
}

export function closeQuickAccess() {
  _openType = null;
  document.querySelectorAll('.qa-btn').forEach(b => b.classList.remove('active'));
  if (_flyoutEl) { _flyoutEl.innerHTML = ''; _flyoutEl.classList.add('hidden'); }
}

async function openBadge(type) {
  _openType = type;
  document.querySelectorAll('.qa-btn').forEach(b => b.classList.toggle('active', b.dataset.qaType === type));
  _flyoutEl.innerHTML = '';
  _flyoutEl.classList.remove('hidden');

  if (type === 'ce_certificate') {
    const doc = await pyCall('get_quick_access_ce_certificate');
    if (!doc) { renderEmptyColumn(); return; }
    await openFile(doc);
    closeQuickAccess();
    return;
  }

  if (type === 'official_tests') {
    const products = await pyCall('get_quick_access_official_tests_products') || [];
    renderColumn(0, t('quickAccess.col_material', 'Υλικό'), products, p => p.product_name, async (p) => {
      const doc = await pyCall('get_quick_access_official_tests_doc', p.product_id);
      if (doc) { await openFile(doc); closeQuickAccess(); }
    });
    return;
  }

  if (type === 'standard') {
    const groups = await pyCall('get_quick_access_standard_groups') || [];
    renderColumn(0, t('quickAccess.col_group', 'Ομάδα'), groups, g => g, async (g) => {
      const docs = await pyCall('get_quick_access_standards', g) || [];
      renderColumn(1, t('quickAccess.col_standard', 'Πρότυπο'), docs, d => d.quick_access_standard || d.title, async (d) => {
        await openFile(d);
        closeQuickAccess();
      });
    });
    return;
  }

  if (type === 'dop') {
    const standards = await pyCall('get_quick_access_dop_standards') || [];
    renderColumn(0, t('quickAccess.col_standard', 'Πρότυπο'), standards, s => s, async (std) => {
      const products = await pyCall('get_quick_access_dop_products', std) || [];
      renderColumn(1, t('quickAccess.col_material', 'Υλικό'), products, p => p.product_name, async (p) => {
        const files = await pyCall('get_quick_access_dop_files', std, p.product_id);
        renderFileColumn(2, files);
      });
    });
    return;
  }
}

function renderColumn(index, title, items, labelFn, onClick) {
  _flyoutEl.querySelectorAll('.qa-col').forEach((c, i) => { if (i >= index) c.remove(); });

  const col = document.createElement('div');
  col.className = 'qa-col';

  const titleEl = document.createElement('div');
  titleEl.className = 'qa-col-title';
  titleEl.textContent = title;
  col.appendChild(titleEl);

  if (!items.length) {
    col.appendChild(_emptyRow());
  } else {
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'qa-col-item';
      row.textContent = labelFn(item);
      row.addEventListener('click', () => {
        col.querySelectorAll('.qa-col-item').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        onClick(item);
      });
      col.appendChild(row);
    });
  }
  _flyoutEl.appendChild(col);
}

function renderFileColumn(index, files) {
  _flyoutEl.querySelectorAll('.qa-col').forEach((c, i) => { if (i >= index) c.remove(); });

  const col = document.createElement('div');
  col.className = 'qa-col';

  const titleEl = document.createElement('div');
  titleEl.className = 'qa-col-title';
  titleEl.textContent = t('quickAccess.title', 'Γρήγορη Πρόσβαση');
  col.appendChild(titleEl);

  const entries = [
    { label: t('quickAccess.file_ce_mark', 'CE Mark'), doc: files?.ce_mark },
    { label: t('quickAccess.file_dop', 'DOP'),         doc: files?.dop },
  ].filter(e => e.doc);

  if (!entries.length) {
    col.appendChild(_emptyRow());
  } else {
    entries.forEach(e => {
      const btn = document.createElement('div');
      btn.className = 'qa-file-btn';
      btn.textContent = e.label;
      btn.addEventListener('click', async () => { await openFile(e.doc); closeQuickAccess(); });
      col.appendChild(btn);
    });
  }
  _flyoutEl.appendChild(col);
}

function renderEmptyColumn() {
  const col = document.createElement('div');
  col.className = 'qa-col';
  col.appendChild(_emptyRow());
  _flyoutEl.appendChild(col);
}

function _emptyRow() {
  const empty = document.createElement('div');
  empty.className = 'qa-col-empty';
  empty.textContent = t('quickAccess.empty', 'Δεν έχει σημαδευτεί έγγραφο');
  return empty;
}

async function openFile(doc) {
  if (!doc?.cloud_path) {
    App.toast(t('quickAccess.empty', 'Δεν έχει σημαδευτεί έγγραφο'), 'warn');
    return;
  }
  App.toast(t('quickAccess.downloading', 'Λήψη εγγράφου...'), 'info');
  const result = await window.pyBridge?.['open-document']?.(doc.cloud_path);
  if (!result?.ok) {
    App.toast(t('settings.generic_error_prefix', 'Σφάλμα: ') + (result?.error || ''), 'fail');
  }
}
