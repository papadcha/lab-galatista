// Οδηγός Χρήσης της εφαρμογής: λίστα θεμάτων + iframe περιεχομένου,
// μέσα στο ήδη υπάρχον γενικό modal (App.showModal, main-app.js) — ίδιο
// modular pattern με τους οδηγούς δοκιμών (src/pages/tests/guides/, βλ.
// tests.js GUIDE_FILES): κάθε θέμα είναι ανεξάρτητο static HTML αρχείο.
(function() {
  const TOPICS = [
    { id: 'dashboard',           title: 'Αρχική (Dashboard)' },
    { id: 'samples',             title: 'Καταχώρηση Δείγματος' },
    { id: 'tests',               title: 'Δοκιμές' },
    { id: 'history',             title: 'Ιστορικό' },
    { id: 'reports',             title: 'Εκθέσεις' },
    { id: 'library',             title: 'Βιβλιοθήκη Εγγράφων' },
    { id: 'settings-lab',        title: 'Ρυθμίσεις: Εργαστήριο & CE' },
    { id: 'settings-materials',  title: 'Ρυθμίσεις: Υλικά, Πηγές, Τεχνικοί' },
    { id: 'settings-specs',      title: 'Ρυθμίσεις: Προδιαγραφές' },
    { id: 'settings-email',      title: 'Ρυθμίσεις: Email' },
    { id: 'settings-storage',    title: 'Ρυθμίσεις: Αποθήκευση' },
    { id: 'multi-install',       title: 'Πολλαπλές Εγκαταστάσεις & Ενημέρωση' },
    { id: 'troubleshooting',     title: 'Συχνά Προβλήματα' },
  ];

  let activeTopic = TOPICS[0].id;

  function buildContent() {
    const topicsHtml = TOPICS.map(t =>
      `<div class="app-guide-topic${t.id === activeTopic ? ' active' : ''}" data-topic="${t.id}">${t.title}</div>`
    ).join('');
    return `
      <div class="app-guide-layout">
        <nav id="app-guide-topics">${topicsHtml}</nav>
        <iframe id="app-guide-iframe" src="pages/guide/topics/${activeTopic}.html" frameborder="0"></iframe>
      </div>`;
  }

  function wireTopicClicks() {
    document.querySelectorAll('#app-guide-topics .app-guide-topic').forEach(node => {
      node.addEventListener('click', () => selectTopic(node.dataset.topic));
    });
  }

  function selectTopic(id) {
    activeTopic = id;
    const iframe = document.getElementById('app-guide-iframe');
    if (iframe) iframe.src = `pages/guide/topics/${id}.html`;
    document.querySelectorAll('#app-guide-topics .app-guide-topic').forEach(node => {
      node.classList.toggle('active', node.dataset.topic === id);
    });
  }

  function open() {
    if (typeof App === 'undefined' || !App.showModal) return;
    App.showModal('Οδηγός Χρήσης', buildContent(), []);
    wireTopicClicks();
  }

  function close() {
    if (typeof App !== 'undefined' && App.closeModal) App.closeModal();
  }

  window.AppGuide = { open, close, selectTopic };
})();
