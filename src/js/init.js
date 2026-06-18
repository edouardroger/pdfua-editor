// init.js — Point d'entrée : restauration session et démarrage

/* ── INIT ── */
switchTab('meta');
initFmtBar();

const sessionRestored = loadSession();
if (sessionRestored && blocks.length > 0) {
  /* Différer la restaurationt : canvas visible immédiatement */
  requestAnimationFrame(() => {
    restoreSessionBlocks();
    refreshBlockFonts();
    updUA();
    updTree();
    announce('Session restaurée (' + blocks.length + ' bloc' + (blocks.length > 1 ? 's' : '') + ').');
  });
} else {
  addBlock('h1', MAR, MAR);
  addBlock('p', MAR, MAR + 105);
}

/* Différer les passes lourdest */
requestAnimationFrame(() => {
  refreshBlockFonts();
  requestAnimationFrame(() => {
    updUA();
    updTree();
  });
});

/* ── Listeners panneau droit, méta, grille ──
   Définis dans blocks.js (qui possède bprop, rr, updUA, etc.). */
initPanelListeners();

/* ── Sauvegarde session ── */
['m-title', 'm-author', 'm-subject', 'm-lang'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => saveSession());
});
document.addEventListener('input', e => {
  if (e.target.isContentEditable || e.target.classList.contains('list-ta')) {
    saveSession();
  }
});

/* ── Badge PDF/UA dans la topbar ──
   Appelé depuis updUA() après chaque vérification de conformité. */
window._patchUABadge = function () {
  const badge = document.getElementById('tb-ua-status');
  const label = document.getElementById('tb-ua-label');
  if (!badge || !label) return;
  const errs = document.querySelectorAll('#ual .ua-err').length;
  const warns = document.querySelectorAll('#ual .ua-warn').length;
  badge.classList.remove('ok', 'err');
  if (errs === 0 && warns === 0) {
    const items = document.querySelectorAll('#ual .ua-item').length;
    if (items === 0) { badge.className = ''; label.textContent = 'PDF/UA'; }
    else badge.classList.add('ok');
  } else {
    badge.classList.add('err');
  }
};

/* ── Met à jour le H2 sr-only du panneau switchTab. */
(function () {
  const _orig = switchTab;
  const PANEL_LABELS = { meta: 'Document', bloc: 'Bloc sélectionné', ua: 'PDF/UA', export: 'Paramètres' };
  switchTab = function (name) {
    _orig(name);
    const h2 = document.getElementById('panel-heading');
    if (h2) h2.textContent = 'Panneau — ' + (PANEL_LABELS[name] || name);
  };
})();

/* ── Topbar── */
document.getElementById('btn-gen')?.addEventListener('click', () => genPDF());
document.getElementById('btn-prev')?.addEventListener('click', () => prevPDF());
document.getElementById('btn-exp')?.addEventListener('click', () => exportCode());
document.getElementById('btn-add-page')?.addEventListener('click', () => addCanvasPage());

(function () {
  const btnSave = document.querySelector('.tb-btn[title="Sauvegarder le projet (.pdfua)"]');
  const btnOpen = document.querySelector('.tb-btn[title="Ouvrir un projet"]');
  const fileInput = document.getElementById('open-project-input');
  const btnUndo = document.querySelector('.tb-btn[title="Annuler (Ctrl+Z)"]');
  if (btnSave) btnSave.addEventListener('click', () => saveProject());
  if (btnOpen && fileInput) btnOpen.addEventListener('click', () => fileInput.click());
  if (fileInput) fileInput.addEventListener('change', () => openProject(fileInput));
  if (btnUndo) btnUndo.addEventListener('click', () => undoLast());
})();

/* ── Sidebar mobile ── */
window.toggleMobileSidebar = function (forceState) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btn = document.getElementById('tb-hamburger');
  const open = forceState !== undefined ? forceState : !sidebar.classList.contains('mobile-open');
  sidebar.classList.toggle('mobile-open', open);
  overlay.classList.toggle('visible', open);
  btn.setAttribute('aria-expanded', String(open));
  if (open) { const first = sidebar.querySelector('.bsrc'); if (first) first.focus(); }
};

document.getElementById('tb-hamburger')?.addEventListener('click', () => toggleMobileSidebar());
document.getElementById('sidebar-overlay')?.addEventListener('click', () => toggleMobileSidebar(false));
/* Échap ferme la sidebar (complément du listener unifié d'editor-ui.js
   qui gère les modales et raccourcis éditeur — la sidebar n'est pas une .modal). */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') toggleMobileSidebar(false);
});
