// init.js — Point d'entrée : restauration session et démarrage

/* ── INIT ── */
switchTab('meta');
initFmtBar();

const sessionRestored = loadSession();
if (sessionRestored && blocks.length > 0) {
  /* Différer la restauration : canvas visible immédiatement */
  requestAnimationFrame(() => {
    restoreSessionBlocks();
    refreshBlockFonts();
    updUA();
    updTree();
    /* Mettre à jour la prévisualisation de la marge */
    const _mprev = document.getElementById('m-margin-preview');
    const _minp = document.getElementById('m-margin');
    if (_mprev && _minp) _mprev.textContent = '≈ ' + (parseInt(_minp.value || 40) * 0.03528).toFixed(2) + ' cm';
    invalidateMarginGuides();
    announce('Session restaurée (' + blocks.length + ' bloc' + (blocks.length > 1 ? 's' : '') + ').');
  });
} else {
  addBlock('h1', MAR, MAR, {}, { noSelect: true });
  addBlock('p', MAR, MAR + 105, {}, { noSelect: true });
}

/* Différer les passes lourdes */
requestAnimationFrame(() => {
  refreshBlockFonts();
  requestAnimationFrame(() => {
    updUA();
    updTree();
    /* Guides de marge — premier affichage (les pages existent à ce stade) */
    rebuildMarginGuides();
  });
});

/* ── Listeners panneau droit, méta, grille ──
   Définis dans blocks.js (qui possède bprop, rr, updUA, etc.). */
initPanelListeners();

/* ── Sauvegarde session ── */
['m-title', 'm-author', 'm-subject', 'm-lang', 'm-margin'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => saveSession());
});

/* Mise à jour de la prévisualisation de la marge */
(function () {
  const inp = document.getElementById('m-margin');
  const prev = document.getElementById('m-margin-preview');
  if (!inp || !prev) return;
  const update = () => {
    const v = parseInt(inp.value, 10) || 40;
    prev.textContent = '≈ ' + (v * 0.03528).toFixed(2) + ' cm';
    invalidateMarginGuides();
  };
  inp.addEventListener('input', update);
  update();
})();
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
    if (items === 0) {
      badge.className = '';
      label.textContent = 'PDF/UA';
      badge.setAttribute('aria-label', 'Afficher le panneau PDF/UA — statut inconnu');
    } else {
      badge.classList.add('ok');
      badge.setAttribute('aria-label', 'Afficher le panneau PDF/UA — conforme (' + items + ' critères validés)');
    }
  } else {
    badge.classList.add('err');
    const detail = [];
    if (errs > 0) detail.push(errs + ' erreur' + (errs > 1 ? 's' : ''));
    if (warns > 0) detail.push(warns + ' avertissement' + (warns > 1 ? 's' : ''));
    badge.setAttribute('aria-label', 'Afficher le panneau PDF/UA — non conforme : ' + detail.join(', '));
  }
};

/* ── Mise à jour du H2 sr-only du panneau */
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