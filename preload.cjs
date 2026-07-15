const { contextBridge, ipcRenderer } = require('electron');

/* ------------------------------------------------------------ */
/* Generic dispatcher (νέο)                                     */
/* ------------------------------------------------------------ */

const call = (method, ...args) =>
  ipcRenderer.invoke('py-call', method, ...args);

/* ------------------------------------------------------------ */
/* Έκθεση API στο frontend                                       */
/* ------------------------------------------------------------ */

contextBridge.exposeInMainWorld('pyBridge', {

  /* ----- Generic ----- */
  // Νέος preferred τρόπος: window.pyBridge.call('method_name', arg1, arg2, ...)
  call,

  /* ----- Παλιά API (backwards-compatible) ----- */
  // Αυτά διατηρούνται για να μην χρειαστεί αλλαγή σε
  // dashboard.js, samples.js και οποιονδήποτε άλλο κώδικα
  // που τα χρησιμοποιεί ήδη.

  // Reference data
  get_products:           ()         => call('get_products'),
  get_technicians:        ()         => call('get_technicians'),
  generate_sample_code:   (source_id, product_id) => call('generate_sample_code', source_id, product_id),
  get_product_sieves:     (id)       => call('get_product_sieves', id),
  get_lab_info:           ()         => call('get_lab_info'),

  // Dashboard
  get_dashboard_stats:    ()         => call('get_dashboard_stats'),
  get_dashboard_samples:  (filter)   => call('get_dashboard_samples', filter),

  // Sample CRUD
  create_sample: (code, date, product_id, technician_id, location, batch, comments) =>
    call('create_sample', code, date, product_id, technician_id, location, batch, comments),

  search_samples: (product_id, date_from, date_to, code) =>
    call('search_samples', product_id, date_from, date_to, code),

  add_technician: (name) =>
    call('add_technician', name),

  delete_sample: (sample_id) =>
    call('delete_sample', sample_id),

  update_sample: (sample_id, code, date, technician_id, location, batch, comments) =>
    call('update_sample', sample_id, code, date, technician_id, location, batch, comments),

  get_full_report: (sample_id) =>
    call('get_full_report', sample_id),

  // Test data
  save_sieve_analysis: (...args) => call('save_sieve_analysis', ...args),

  get_sieve_analysis: (sample_id) =>
    call('get_sieve_analysis', sample_id),

  save_methylene_blue: (...args) => call('save_methylene_blue', ...args),

  suggest_initial_volume: (product_id) =>
    call('suggest_initial_volume', product_id),

  save_sand_equivalent: (...args) => call('save_sand_equivalent', ...args),

  save_flakiness: (...args) => call('save_flakiness', ...args),

  /* ----- Νέο API v1.1 (πλάνο δοκιμών + multiple runs) -----
   *
   * Αυτές προστίθενται ως convenience aliases. Μπορούν να
   * χρησιμοποιηθούν είτε ως window.pyBridge.get_required_tests(id)
   * είτε ως window.pyBridge.call('get_required_tests', id).
   */

  // Πλάνο δοκιμών
  get_required_tests:           (sample_id) => call('get_required_tests', sample_id),
  set_required_tests:           (sample_id, list) => call('set_required_tests', sample_id, list),
  get_default_required_tests:   (product_id) => call('get_default_required_tests', product_id),

  create_sample_with_plan: (code, date, product_id, technician_id,
                            location, batch, comments, required_tests) =>
    call('create_sample_with_plan', code, date, product_id, technician_id,
         location, batch, comments, required_tests),

  // Run history & management
  get_test_history:        (test_type, sample_id) =>
    call('get_test_history', test_type, sample_id),

  mark_run_rejected:       (test_type, run_id, reason) =>
    call('mark_run_rejected', test_type, run_id, reason),

  update_rejected_reason:  (test_type, run_id, reason) =>
    call('update_rejected_reason', test_type, run_id, reason),

  promote_run_to_official: (test_type, run_id, demote_reason) =>
    call('promote_run_to_official', test_type, run_id, demote_reason),

  delete_test_run:         (test_type, run_id) =>
    call('delete_test_run', test_type, run_id),

  // Guide window
  'open-guide':   (testType) => ipcRenderer.invoke('open-guide', testType),

  // Custom titlebar — window controls (frameless window)
  'window-minimize':        () => ipcRenderer.invoke('window-minimize'),
  'window-maximize-toggle': () => ipcRenderer.invoke('window-maximize-toggle'),
  'window-close':            () => ipcRenderer.invoke('window-close'),
  'window-is-maximized':    () => ipcRenderer.invoke('window-is-maximized'),
  'on-window-maximized-change': (cb) => ipcRenderer.on('window-maximized-change', (_e, isMax) => cb(isMax)),

  // Cloud Sync
  'cloud-check-rclone': ()           => ipcRenderer.invoke('cloud-check-rclone'),
  'cloud-list-remotes': ()           => ipcRenderer.invoke('cloud-list-remotes'),
  'cloud-get-config':   ()           => ipcRenderer.invoke('cloud-get-config'),
  'cloud-save-config':  (path)       => ipcRenderer.invoke('cloud-save-config', path),
  'cloud-test':         (path)       => ipcRenderer.invoke('cloud-test', path),
  'cloud-sync':         ()           => ipcRenderer.invoke('cloud-sync'),
  'cloud-restore':      ()           => ipcRenderer.invoke('cloud-restore'),
  'sync-document-library': ()        => ipcRenderer.invoke('sync-document-library'),
  'retention-get-status':   ()       => ipcRenderer.invoke('retention-get-status'),
  'retention-set-days':     (days)   => ipcRenderer.invoke('retention-set-days', days),
  'retention-enable-auto':  ()       => ipcRenderer.invoke('retention-enable-auto'),
  'retention-disable-auto': ()       => ipcRenderer.invoke('retention-disable-auto'),
  'retention-force-release':()       => ipcRenderer.invoke('retention-force-release'),
  'retention-preview':      ()       => ipcRenderer.invoke('retention-preview'),
  'retention-run-cleanup':  ()       => ipcRenderer.invoke('retention-run-cleanup'),
  'cloud-open-terminal':()           => ipcRenderer.invoke('cloud-open-terminal'),
  'open-external-link': (url)        => ipcRenderer.invoke('open-external-link', url),
  'close-guide':  ()         => ipcRenderer.invoke('close-guide'),
  'on-guide-closed': (cb)    => ipcRenderer.on('guide-closed', (_e, tt) => cb(tt)),

  // PDF & Email (IPC — δεν πάνε μέσω Python)
  'print-to-pdf':        (options)                      => ipcRenderer.invoke('print-to-pdf', options),
  'generate-report-pdf': (opts)                          => ipcRenderer.invoke('generate-report-pdf', opts),
  'save-pdf':            (pdfPath, name, productFolder, subperiodFolder) =>
    ipcRenderer.invoke('save-pdf', pdfPath, name, productFolder, subperiodFolder),
  'save-statistics':          (pdfPath, name)  => ipcRenderer.invoke('save-statistics', pdfPath, name),
  'generate-periodic-pdf':    (opts)           => ipcRenderer.invoke('generate-periodic-pdf', opts),
  'open-pdf':            (pdfPath)                       => ipcRenderer.invoke('open-pdf', pdfPath),
  'print-pdf':           (pdfPath)                       => ipcRenderer.invoke('print-pdf', pdfPath),
  'send-email':          (smtpCfg, emailData)            => ipcRenderer.invoke('send-email', smtpCfg, emailData),
  'test-smtp-ipc':       (smtpCfg)                       => ipcRenderer.invoke('test-smtp', smtpCfg),

  // Φάκελος δεδομένων & Backup
  'select-data-folder':  ()                              => ipcRenderer.invoke('select-data-folder'),
  'get-data-folder':     ()                              => ipcRenderer.invoke('get-data-folder'),
  'backup-database':       ()                              => ipcRenderer.invoke('backup-database'),
  'backup-database-final': ()                              => ipcRenderer.invoke('backup-database-final'),
  'list-backups':        ()                              => ipcRenderer.invoke('list-backups'),
  'select-backup-file':  ()                              => ipcRenderer.invoke('select-backup-file'),
  'restore-backup':      (backupPath)                    => ipcRenderer.invoke('restore-backup', backupPath),
  'get-config':          ()                              => ipcRenderer.invoke('get-config'),
  'set-config':          (updates)                       => ipcRenderer.invoke('set-config', updates),

  // Validation & metadata
  is_test_allowed_for_category:    (test_type, category) =>
    call('is_test_allowed_for_category', test_type, category),

  get_allowed_tests_for_category:  (category) =>
    call('get_allowed_tests_for_category', category),

  get_test_registry_meta:          () => call('get_test_registry_meta'),

  // --- CE Periods & Subperiods (v0.99.2) ---
  'ce-get-suggested-folder': (ceNumber, validFrom, validTo) =>
    ipcRenderer.invoke('ce-get-suggested-folder', ceNumber, validFrom, validTo),
  'ce-select-folder':        ()                  => ipcRenderer.invoke('ce-select-folder'),
  'ce-notify-snooze':        (days)              => ipcRenderer.invoke('ce-notify-snooze', days),
  'ce-notify-clear-snooze':  ()                  => ipcRenderer.invoke('ce-notify-clear-snooze'),
  'on-ce-expiry':            (cb)                => ipcRenderer.on('ce-expiry-notification', (_e, status) => cb(status)),
  'on-data-folder-mismatch': (cb)                => ipcRenderer.on('data-folder-mismatch', (_e, info) => cb(info)),
  'data-folder-notify-snooze': (days)            => ipcRenderer.invoke('data-folder-notify-snooze', days),
  'on-cloud-sync-failed':    (cb)                => ipcRenderer.on('cloud-sync-failed', (_e, info) => cb(info)),
  'cloud-sync-notify-snooze': (days)             => ipcRenderer.invoke('cloud-sync-notify-snooze', days),
  'on-python-ready':         (cb)                => ipcRenderer.once('python-ready', () => cb()),
  'is-python-ready':         ()                  => ipcRenderer.invoke('python-is-ready'),
  'on-update-available':     (cb)                => ipcRenderer.once('update-available', (_e, info) => cb(info)),
  'open-update-url':         (url)               => ipcRenderer.invoke('open-update-url', url),
  'install-update':          (localPath)         => ipcRenderer.invoke('install-update', localPath),
  'get-app-version':         ()                  => ipcRenderer.invoke('get-app-version'),
  'get-version-history':     ()                  => ipcRenderer.invoke('get-version-history'),
  'get-allowed-versions':    ()                  => ipcRenderer.invoke('get-allowed-versions'),
  'report-version-issue':    (lastGood, desc)    => ipcRenderer.invoke('report-version-issue', lastGood, desc),
  'report-problem':         (desc)              => ipcRenderer.invoke('report-problem', desc),
  'report-crash':           ()                  => ipcRenderer.invoke('report-crash'),
  'on-previous-crash':       (cb)                => ipcRenderer.on('previous-crash-detected', (_e, tail) => cb(tail)),

  'generate-pdf-library':    (folder)            => ipcRenderer.invoke('generate-pdf-library', folder),
  'upload-document':         (opts)              => ipcRenderer.invoke('upload-document', opts),
  'open-document':           (cloudPath)         => ipcRenderer.invoke('open-document', cloudPath),
  'delete-document-cloud':   (cloudPath)         => ipcRenderer.invoke('delete-document-cloud', cloudPath),

  // CE period py-calls (via pyBridge.call)
  get_active_ce_period:      ()                  => call('get_active_ce_period'),
  get_all_ce_periods:        ()                  => call('get_all_ce_periods'),
  get_ce_expiry_status:      ()                  => call('get_ce_expiry_status'),
  create_ce_period:          (ceNumber, ceBody, validFrom, validTo, dataFolder) =>
    call('create_ce_period', ceNumber, ceBody, validFrom, validTo, dataFolder),
  create_subperiod:          (cePeriodId, validFrom, reportNumber, notes, pdfSubfolder,
                               extMb, extSe, extFl, extSieve) =>
    call('create_subperiod', cePeriodId, validFrom, reportNumber, notes, pdfSubfolder,
         extMb, extSe, extFl, extSieve),
  update_ce_period_folder:   (periodId, folder)  => call('update_ce_period_folder', periodId, folder),
  'clean-start':             (options)             => ipcRenderer.invoke('clean-start', options),
  'switch-to-archive':       (opts)                => ipcRenderer.invoke('switch-to-archive', opts),
  'restore-from-archive':    ()                    => ipcRenderer.invoke('restore-from-archive'),
  'is-archive-mode':         ()                    => ipcRenderer.invoke('is-archive-mode'),
  'inspect-backup-samples':      (backupPath)                     => ipcRenderer.invoke('inspect-backup-samples', backupPath),
  'check-sample-code-conflict':  (code)                           => ipcRenderer.invoke('check-sample-code-conflict', code),
  'merge-sample-from-backup':    (opts)                           => ipcRenderer.invoke('merge-sample-from-backup', opts),
  'switch-to-backup-file':       (backupPath)                     => ipcRenderer.invoke('switch-to-backup-file', backupPath),
  get_init_status:           ()                    => call('get_init_status'),
  delete_subperiod:          (id)                  => call('delete_subperiod', id),
  delete_ce_period:          (id)                  => call('delete_ce_period', id),
  update_ce_period:          (id, ceNumber, ceBody, validFrom, validTo) =>
    call('update_ce_period', id, ceNumber, ceBody, validFrom, validTo),
  get_subperiod_for_date:    (date)               => call('get_subperiod_for_date', date),
  update_subperiod:          (id, reportNumber, notes, pdfSub, mb, se, fl, sieve, validFrom) =>
    call('update_subperiod', id, reportNumber, notes, pdfSub, mb, se, fl, sieve, validFrom),
});
