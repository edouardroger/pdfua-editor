// init.js — Point d'entrée : restauration session et démarrage

/* ── INIT ── */
switchTab('meta');
initFmtBar();

const sessionRestored = loadSession();
if (sessionRestored && blocks.length > 0) {
  /* Différer la restauration après le premier paint : canvas visible immédiatement */
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

/* Différer les passes lourdes (arbre de structure, accessibilité, fonts)
   après le premier paint — le canvas est déjà visible, ces mises à jour
   sont invisibles pour l'utilisateur au démarrage. */
requestAnimationFrame(() => {
  refreshBlockFonts();
  requestAnimationFrame(() => {
    updUA();
    updTree();
  });
});

/* Sauvegarder à chaque édition des méta */
['m-title', 'm-author', 'm-subject', 'm-lang'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => saveSession());
});

/* Sauvegarder à chaque frappe dans un contenteditable ou textarea de liste */
document.addEventListener('input', e => {
  if (e.target.isContentEditable || e.target.classList.contains('list-ta')) {
    saveSession();
  }
});