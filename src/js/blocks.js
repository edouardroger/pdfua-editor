// blocks.js — Manipulation des blocs : création, sélection, propriétés, panneaux

/* ══════════════════════════════════════════════════════════════
   MISE EN FORME INLINE — gras, italique, lien hypertexte
   Blocs concernés : p, quote, aside, note
   Stockage : b.richContent (HTML sérialisé)
              b.content     (texte brut — fallback + blocs non-rich)
   ══════════════════════════════════════════════════════════════ */

const RICH_TYPES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'quote', 'aside', 'note', 'ul', 'ol']);

/* ── Parseur HTML → runs PDF ──────────────────────────────────
   Transforme le innerHTML d'un éditeur en tableau de runs plats :
   [{ text, bold, italic, linkUrl, linkText }, …]

   Sauts de ligne :
     <br>              → run { text: '\n' }
     fin de <div>/<p>  → '\n' si le dernier run ne se termine pas déjà par '\n'
     Séquences de \n multiples sont préservées (paragraphes séparés).
   ─────────────────────────────────────────────────────────── */
function htmlToRuns(html) {
  if (!html) return [];

  /* Cache LRU léger — évite de recréer un div + parser le HTML à chaque rendu
     de bloc (updTree, refreshBlockFonts, PDF build, export-code appellent tous
     htmlToRuns sur le même richContent sans le modifier).
     32 entrées couvrent largement un document typique. */
  if (!htmlToRuns._cache) {
    htmlToRuns._cache = new Map();
    htmlToRuns._MAX = 32;
  }
  const cache = htmlToRuns._cache;
  if (cache.has(html)) {
    /* LRU : déplacer en tête */
    const hit = cache.get(html);
    cache.delete(html);
    cache.set(html, hit);
    return hit;
  }

  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const runs = [];
  const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote']);
  const pushNL = ctx => { const last = runs[runs.length - 1]; if (!last || last.text.endsWith('\n')) return; runs.push({ ...ctx, text: '\n' }); };
  function walk(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent;
      if (t) runs.push({ ...ctx, text: t.replace(/\r\n/g, '\n').replace(/\r/g, '\n') });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    const next = { ...ctx };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    if (tag === 'em' || tag === 'i') next.italic = true;
    if (tag === 'a') { next.linkUrl = node.getAttribute('href') || ''; next.linkText = node.textContent || ''; }
    if (tag === 'sup' && node.dataset?.noteId) { runs.push({ ...ctx, text: node.textContent || '', superscript: true, noteId: node.dataset.noteId }); return; }
    if (tag === 'br') { runs.push({ ...ctx, text: '\n' }); return; }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && runs.length) pushNL(ctx);
    for (const child of node.childNodes) walk(child, next);
    if (isBlock) pushNL(ctx);
  }
  walk(tmp, { bold: false, italic: false, linkUrl: null, linkText: null });
  while (runs.length && runs[runs.length - 1].text === '\n') runs.pop();

  /* Stocker dans le cache — éviction FIFO si plein */
  if (cache.size >= htmlToRuns._MAX) cache.delete(cache.keys().next().value);
  cache.set(html, runs);
  return runs;
}

/* Invalider le cache htmlToRuns quand le contenu d'un bloc change */
function invalidateHtmlToRunsCache(html) {
  if (htmlToRuns._cache) htmlToRuns._cache.delete(html);
}

// Extraire le texte brut d'un innerHTML
function htmlToPlain(html) { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent || ''; }

function syncRichContent() {
  if (!sid) return;
  const b = blocks.find(x => x.id === sid);
  if (!b || !RICH_TYPES.has(b.type)) return;
  _syncRichFromDOM(b);
  if (typeof saveSession === 'function') saveSession();
}

function getRichEditEl(blockId) {
  const ct = document.getElementById('ct-' + blockId); if (!ct) return null;
  const b = blocks.find(x => x.id === blockId);
  if (b && (b.type === 'ul' || b.type === 'ol')) {
    const focused = ct.querySelector('li:focus');
    if (focused) return focused;
    const all = ct.querySelectorAll('li[contenteditable]');
    return all.length ? all[all.length - 1] : null;
  }
  return ct.querySelector('[contenteditable="true"]');
}
let fmtBar = null, linkModal = null;
let _savedRange = null;      // Range sauvegardée avant ouverture de la modale lien
let _noteSavedSid = null;    // sid sauvegardé au mousedown du bouton †
let _noteSavedRange = null;  // sélection sauvegardée au mousedown du bouton †

function initFmtBar() {
  /* Barre */
  fmtBar = document.createElement('div');
  fmtBar.id = 'fmt-bar';
  fmtBar.setAttribute('role', 'toolbar');
  fmtBar.setAttribute('aria-label', 'Mise en forme du texte sélectionné');

  const mkBtn = (id, label, content, cmd) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fmt-btn';
    btn.id = 'fmt-' + id;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = content;
    if (cmd) btn.onclick = e => { e.preventDefault(); e.stopPropagation(); applyFmt(cmd); };
    return btn;
  };

  const sep = () => { const d = document.createElement('div'); d.className = 'fmt-sep'; d.setAttribute('aria-hidden', 'true'); return d; };

  fmtBar.appendChild(mkBtn('bold', 'Gras (Ctrl+B)', '<strong>G</strong>', 'bold'));
  fmtBar.appendChild(mkBtn('italic', 'Italique (Ctrl+I)', '<em>I</em>', 'italic'));
  fmtBar.appendChild(sep());
  const lnkBtn = mkBtn('link', 'Insérer un lien hypertexte', '🔗', null);
  lnkBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); openLinkModal(); };
  fmtBar.appendChild(lnkBtn);
  fmtBar.appendChild(sep());
  const noteBtn = mkBtn('note', 'Insérer une note de bas de page', '<sup style="font-size:9px">†</sup>', null);
  /* Capturer sid + Range au pointerdown, avant toute perte de focus.
     pointerdown précède mousedown et blur — e.preventDefault() y est plus fiable.
     On capture inconditionnellement (écrase ce que positionFmtBar a mis). */
  const _captureNoteState = e => {
    e.preventDefault();
    e.stopPropagation();
    const s = window.getSelection();
    if (s && s.rangeCount > 0 && !s.isCollapsed) {
      const range = s.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      const ct = el?.closest('[id^="ct-"]');
      const effectiveSid = sid || (ct ? ct.id.replace('ct-', '') : null);
      if (effectiveSid) {
        _noteSavedSid = effectiveSid;
        _noteSavedRange = range.cloneRange();
      }
    }
  };
  noteBtn.addEventListener('pointerdown', _captureNoteState);
  noteBtn.addEventListener('mousedown', _captureNoteState); // fallback navigateurs sans pointer events
  noteBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); insertNoteAnchor(); });
  fmtBar.appendChild(noteBtn);
  fmtBar.appendChild(sep());
  const clrBtn = mkBtn('clear', 'Supprimer la mise en forme', '✕', null);
  clrBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); clearFmt(); };
  fmtBar.appendChild(clrBtn);

  document.body.appendChild(fmtBar);

  /* Modale URL */
  linkModal = document.createElement('div');
  linkModal.id = 'link-modal';
  linkModal.setAttribute('role', 'dialog');
  linkModal.setAttribute('aria-modal', 'true');
  linkModal.setAttribute('aria-label', 'Saisir l\'URL du lien');
  linkModal.innerHTML = `
    <label for="link-url-input">URL du lien</label>
    <input id="link-url-input" type="url" placeholder="https://…" autocomplete="off">
    <label for="link-text-input">Texte du lien (optionnel)</label>
    <input id="link-text-input" type="text" placeholder="Laisser vide pour conserver la sélection">
    <div class="link-modal-row">
      <button type="button" id="link-cancel">Annuler</button>
      <button type="button" id="link-confirm" class="primary">Insérer</button>
    </div>`;
  document.body.appendChild(linkModal);

  document.getElementById('link-cancel').onclick = closeLinkModal;
  document.getElementById('link-confirm').onclick = confirmLink;
  linkModal.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLinkModal();
    if (e.key === 'Enter') { e.preventDefault(); confirmLink(); }
  });
}

function positionFmtBar() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !fmtBar) return;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width) return;

  fmtBar.classList.add('visible');

  /* Pré-capturer sid + Range dès que la barre est visible.
     Si sid est null (texte sélectionné sans clic préalable sur le bloc),
     on le déduit depuis le nœud ancre de la sélection. */
  const _sidFromRange = range => {
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const ct = el?.closest('[id^="ct-"]');
    return ct ? ct.id.replace('ct-', '') : null;
  };
  const effectiveSid = sid || _sidFromRange(range);
  /* Mettre sid à jour silencieusement si nécessaire (sans updBP pour éviter les effets de bord) */
  if (effectiveSid && effectiveSid !== sid) {
    if (sid) document.getElementById('el-' + sid)?.classList.remove('sel');
    sid = effectiveSid;
    document.getElementById('el-' + effectiveSid)?.classList.add('sel');
  }
  _noteSavedSid = effectiveSid;
  _noteSavedRange = range.cloneRange();

  /* Lire les dimensions AVANT de toucher au DOM pour éviter un forced reflow.
     fmtBar est déjà rendu (visibility:hidden) donc offsetWidth est fiable. */
  const bw = fmtBar.offsetWidth || 180;
  const bh = fmtBar.offsetHeight || 36;
  let left = rect.left + rect.width / 2 - bw / 2;
  let top = rect.top - bh - 10 + window.scrollY;

  /* Ne pas sortir à gauche/droite */
  left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
  if (top < 4) top = rect.bottom + 10 + window.scrollY;

  /* Écrire position ET visibilité en une seule passe */
  fmtBar.style.cssText = fmtBar.style.cssText
    .replace(/left:[^;]+;?/g, '')
    .replace(/top:[^;]+;?/g, '')
    + `left:${left}px;top:${top}px;`;
  fmtBar.classList.add('visible');

  /* Marquer les boutons actifs selon l'état de la sélection */
  document.getElementById('fmt-bold').classList.toggle('active', document.queryCommandState('bold'));
  document.getElementById('fmt-italic').classList.toggle('active', document.queryCommandState('italic'));
  const anchor = sel.anchorNode && sel.anchorNode.parentElement;
  document.getElementById('fmt-link').classList.toggle('active', !!anchor?.closest('a'));
}

function hideFmtBar() {
  if (fmtBar) fmtBar.classList.remove('visible');
  /* NE PAS effacer _noteSavedSid/_noteSavedRange ici :
     _captureNoteState (pointerdown/mousedown sur †) les rafraîchit juste avant insertNoteAnchor.
     Les effacer ici causerait une race condition si hideFmtBar est appelé entre
     pointerdown et click (ce qui n'arrive pas, mais on préfère ne pas en dépendre). */
}

function applyFmt(cmd) {
  document.execCommand(cmd); // bold | italic
  syncRichContent();
  positionFmtBar();
}

function clearFmt() {
  document.execCommand('removeFormat');
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    const range = sel.getRangeAt(0), frag = range.cloneContents();
    frag.querySelectorAll('a').forEach(a => a.replaceWith(document.createTextNode(a.textContent)));
    range.deleteContents(); range.insertNode(frag);
  }
  syncRichContent(); hideFmtBar();
}


function openLinkModal() {
  const sel = window.getSelection();
  _savedRange = (sel && !sel.isCollapsed) ? sel.getRangeAt(0).cloneRange() : null;
  if (_savedRange) {
    const anchor = sel.anchorNode?.parentElement?.closest('a');
    document.getElementById('link-url-input').value = anchor?.href || '';
    document.getElementById('link-text-input').value = sel.toString() || '';
  }
  hideFmtBar();
  const rect = _savedRange ? _savedRange.getBoundingClientRect() : { left: 200, bottom: 200 };
  linkModal.style.left = Math.max(8, rect.left) + 'px';
  linkModal.style.top = (rect.bottom + 8 + window.scrollY) + 'px';
  linkModal.classList.add('visible');
  requestAnimationFrame(() => document.getElementById('link-url-input').focus());
}

function closeLinkModal() {
  linkModal.classList.remove('visible');
  document.getElementById('link-url-input').value = '';
  document.getElementById('link-text-input').value = '';
  _savedRange = null;
}

function confirmLink() {
  const url = document.getElementById('link-url-input').value.trim();
  const txt = document.getElementById('link-text-input').value.trim();
  const savedRange = _savedRange;
  closeLinkModal();
  if (!url) return;
  if (savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  const cur = window.getSelection(), hasSel = cur && !cur.isCollapsed;
  if (hasSel) {
    document.execCommand('createLink', false, url);
    const a = cur.anchorNode?.parentElement?.closest('a') || cur.focusNode?.parentElement?.closest('a');
    if (a) { a.removeAttribute('target'); a.removeAttribute('rel'); }
  } else {
    const a = document.createElement('a'); a.href = url; a.textContent = txt || url;
    document.execCommand('insertHTML', false, a.outerHTML);
  }
  syncRichContent();
}

/* ══════════════════════════════════════════════════════════════
   NOTES DE BAS DE PAGE — insertion façon Word
   ─────────────────────────────────────────────────────────────
   insertNoteAnchor() :
     1. Calcule le prochain numéro de note dans le document
     2. Insère un <sup data-note-id="…"> dans le bloc rich actif
     3. Crée un bloc note positionné en bas de la page courante
        avec anchorBlockId pointant vers le bloc parent
   ══════════════════════════════════════════════════════════════ */
function insertNoteAnchor() {
  const targetSid = _noteSavedSid !== null ? _noteSavedSid : sid;
  const savedRange = _noteSavedRange;
  _noteSavedSid = null;
  _noteSavedRange = null;

  const b = blocks.find(x => x.id === targetSid);
  if (!b || !RICH_TYPES.has(b.type)) {
    announce('Sélectionnez du texte dans un paragraphe pour insérer une note.');
    return;
  }
  const editEl = getRichEditEl(b.id);
  if (!editEl) return;

  /* Restaurer la sélection sauvegardée dans le contenteditable */
  let insertRange = null;
  if (savedRange) {
    insertRange = savedRange.cloneRange();
    insertRange.collapse(false); // insérer après la sélection
    /* Remettre le focus + la sélection pour que les opérations DOM fonctionnent */
    editEl.focus();
    const sel = window.getSelection();
    sel && sel.removeAllRanges();
    sel && sel.addRange(savedRange);
  } else {
    /* Fallback : sélection live */
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      insertRange = sel.getRangeAt(0).cloneRange();
      insertRange.collapse(false);
    } else if (sel && sel.rangeCount > 0) {
      insertRange = sel.getRangeAt(0).cloneRange();
    }
  }

  /* Calculer le prochain numéro de note global */
  const noteNums = blocks
    .filter(x => x.type === 'note')
    .map(x => parseInt(x.noteRef) || 0)
    .filter(n => n > 0);
  const nextNum = noteNums.length ? Math.max(...noteNums) + 1 : 1;
  const noteRef = String(nextNum);

  /* Créer le bloc note — _repositionNotes() calculera la position exacte */
  snapshotState();
  const pageIdx = Math.floor(b.y / PH);
  const ph = pageH(pageIdx);
  const pw = pageW(pageIdx);
  /* Position temporaire en bas de page — sera ajustée par renumberNotes > _repositionNotes */
  const noteId = addBlock('note', MAR, pageIdx * PH + ph - 48, {
    noteRef,
    anchorBlockId: b.id,
    content: 'Note ' + noteRef + '.',
    w: pw - 2 * MAR,
    h: 36,
  });

  /* Re-focaliser l'éditeur et restaurer le curseur pour l'insertion du <sup> */
  editEl.focus();
  {
    const sel = window.getSelection();
    if (insertRange) {
      sel && sel.removeAllRanges();
      sel && sel.addRange(insertRange);
    }
  }

  /* Insérer le <sup> dans le contenu rich */
  const sup = document.createElement('sup');
  sup.dataset.noteId = noteId;
  sup.textContent = noteRef;
  sup.style.cssText = `color:${LINK_COLOR};cursor:pointer;font-size:0.65em`;
  sup.title = 'Note ' + noteRef + ' — cliquer pour sélectionner';
  sup.onclick = e => { e.stopPropagation(); sel(noteId); switchTab('bloc'); };

  const liveRange = insertRange ? window.getSelection()?.getRangeAt(0) : null;
  if (liveRange) {
    liveRange.deleteContents();
    liveRange.insertNode(sup);
    const after = document.createRange();
    after.setStartAfter(sup);
    after.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(after);
  } else {
    editEl.appendChild(sup);
  }

  /* Synchroniser richContent depuis le DOM */
  _syncRichFromDOM(b);
  /* Renuméroter toutes les notes selon l'ordre de lecture */
  renumberNotes();
  updUA(); updTree();

  /* Re-sélectionner le bloc note pour que l'utilisateur puisse saisir son texte */
  setTimeout(() => { sel(noteId); switchTab('bloc'); }, 50);
  announce('Note ' + noteRef + ' insérée. Rédigez le texte dans le bloc Note créé en bas de page.');
}


/* ── Helper partagé : découpe un tableau de runs en segments délimités par '\n' ── */
function _parseSegments(runs) {
  const segments = [];
  let cur = [];
  for (const run of runs) {
    if (run.text === '\n') { segments.push(cur); cur = []; }
    else cur.push(run);
  }
  segments.push(cur);
  while (segments.length && segments[0].length === 0) segments.shift();
  while (segments.length && segments[segments.length - 1].length === 0) segments.pop();
  return segments;
}
/* ── Helper partagé : parse les <li> depuis richContent (ou fallback content) ── */
function _parseListItems(b) {
  if (b.richContent) {
    const tmp = document.createElement('div');
    tmp.innerHTML = b.richContent;
    const items = [...tmp.querySelectorAll('li')].map(li => {
      const runs = htmlToRuns(li.innerHTML || '');
      while (runs.length && runs[runs.length - 1].text === '\n') runs.pop();
      return runs;
    }).filter(runs => runs.some(r => r.text.trim() || r.noteId));
    if (items.length) return items;
  }
  return (b.content || '').split('\n').filter(l => l.trim())
    .map(l => [{ text: l.trim(), bold: false, italic: false, linkUrl: null }]);
}

function _syncRichFromDOM(b) {
  const ct = document.getElementById('ct-' + b.id); if (!ct) return;
  if (b.type === 'ul' || b.type === 'ol') {
    const lst = ct.querySelector('ul, ol');
    if (lst) {
      if (b.richContent) invalidateHtmlToRunsCache(b.richContent);
      b.richContent = lst.outerHTML;
      b.content = [...lst.querySelectorAll('li')].map(li => li.textContent).join('\n');
    }
  } else {
    const editEl = ct.querySelector('[contenteditable="true"]');
    if (editEl) {
      if (b.richContent) invalidateHtmlToRunsCache(b.richContent);
      b.richContent = editEl.innerHTML;
      b.content = htmlToPlain(b.richContent);
    }
  }
}

/* ── Écoute globale selectionchange ── */
let _selTimer = null;
document.addEventListener('selectionchange', () => {
  clearTimeout(_selTimer);
  _selTimer = setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hideFmtBar(); return; }

    /* Vérifier que la sélection est dans un bloc rich.
       anchorNode peut être un nœud texte — remonter à son parentElement. */
    const anchor = sel.anchorNode;
    if (!anchor) { hideFmtBar(); return; }
    const el = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
    const ct = el?.closest('.fb-ct');
    if (!ct) { hideFmtBar(); return; }
    const blockId = ct.id.replace('ct-', '');
    const b = blocks.find(x => x.id === blockId);
    if (!b || !RICH_TYPES.has(b.type)) { hideFmtBar(); return; }

    positionFmtBar();
  }, 60);
});

/* Fermer la barre si clic hors d'un bloc ou de la barre elle-même */
document.addEventListener('mousedown', e => {
  if (fmtBar && !fmtBar.contains(e.target) && !linkModal?.contains(e.target)) {
    const ct = e.target.closest('.fb-ct');
    if (!ct) hideFmtBar();
  }
});

/* Raccourcis clavier Ctrl+B / Ctrl+I dans les blocs rich */
document.addEventListener('keydown', e => {
  if (!sid) return;
  const b = blocks.find(x => x.id === sid);
  if (!b || !RICH_TYPES.has(b.type)) return;
  const active = document.activeElement;
  if (!active || !active.isContentEditable) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); applyFmt('bold'); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); applyFmt('italic'); }
}, true); // capture phase pour priorité

/* ── FONCTIONS SIMPLES — Pas d'abstraction ── */

function uid() { return 'b' + (++cnt); }
function labelForType(type) { return LABELS[type] || type; }
/* Cache du tri — invalidé à chaque modification structurelle des blocs */
let _ordCache = null;
let _ordCacheKey = '';
function _ordKey() { return blocks.length + '|' + blocks.map(b => b.id + ':' + b.order).join(','); }
function ordB() {
  const key = _ordKey();
  if (key !== _ordCacheKey) { _ordCache = [...blocks].sort((a, b) => a.order - b.order); _ordCacheKey = key; }
  return _ordCache;
}
function getCanvasPage(pageIdx) { return document.getElementById('cpage-' + pageIdx); }
function docFont() { return (window.FONTS && window.FONTS.cssFamily) || "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"; }
function refreshBlockFonts() { blocks.forEach(b => { const ct = document.getElementById('el-' + b.id)?.querySelector('.fb-ct'); if (ct) fillCt(ct, b); }); }
/* ── Construit le DOM d'une page (label + div) sans l'attacher ni annoncer ── */
function _createCanvasPage(pageIdx) {
  if (!pageOrientations[pageIdx]) pageOrientations[pageIdx] = 'portrait';
  const label = Object.assign(document.createElement('div'), { className: 'page-label' });
  label.dataset.page = pageIdx;
  const pg = Object.assign(document.createElement('div'), { className: 'canvas-page', id: 'cpage-' + pageIdx });
  pg.setAttribute('aria-label', 'Page ' + (pageIdx + 1) + ' — zone de dépôt des blocs');
  pg.dataset.page = pageIdx;
  applyPageOrientation(pg, pageIdx); setupPageDrop(pg, pageIdx);
  return { label, pg };
}

function addCanvasPage() {
  const pageIdx = numPages++;
  const { label, pg } = _createCanvasPage(pageIdx);
  pageWrap.appendChild(label); pageWrap.appendChild(pg);
  _updatePageLabel(pageIdx); rebuildGridOverlays();
  announce('Page ' + (pageIdx + 1) + ' ajoutée.');
}

function setupPageDrop(pg, pageIdx) {
  pg.addEventListener('dragover', e => { e.preventDefault(); pg.classList.add('drop-target'); });
  pg.addEventListener('dragleave', e => { if (!pg.contains(e.relatedTarget)) pg.classList.remove('drop-target'); });
  pg.addEventListener('drop', e => {
    e.preventDefault(); pg.classList.remove('drop-target');
    const type = e.dataTransfer.getData('btype'); if (!type) return;
    const shapeKind = e.dataTransfer.getData('bshape');
    const r = pg.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top + pageIdx * PH;
    const newId = addBlock(type, x, y, shapeKind ? { shapeKind } : {});
    if (type === 'freeform' && newId) {
      requestAnimationFrame(() => startFreeformDraw(newId));
    }
  });
  pg.addEventListener('mousedown', e => {
    if (e.target === pg) desel();
  });
  /* Touch : tap sur le fond de la page = désélection */
  pg.addEventListener('touchend', e => {
    if (e.target === pg && e.changedTouches.length === 1) desel();
  }, { passive: true });
}

/* Initialiser la première page — réutilise _createCanvasPage() */
(function initFirstPage() {
  pageOrientations[0] = pageOrientations[0] || 'portrait';
  const { label, pg } = _createCanvasPage(0);
  pageWrap.appendChild(label);
  pageWrap.appendChild(pg);
  _updatePageLabel(0);
})();


/* ══════════════════════════════
   ONGLETS — motif ARIA Tabs
   Navigation flèches + Home/End
   ══════════════════════════════ */
const tabBtns = [...document.querySelectorAll('.rtab')];
const tabNames = tabBtns.map(b => b.dataset.tab);

/* Effets de bord par onglet — évite les if séparés dans switchTab */
const TAB_EFFECTS = { ua: () => { updUA(); updTree(); }, save: () => { }, bloc: updBP, export: () => { } };

function switchTab(name) {
  const idx = tabNames.indexOf(name); if (idx === -1) return;
  tabBtns.forEach((btn, i) => {
    const on = i === idx;
    btn.classList.toggle('on', on); btn.setAttribute('aria-selected', String(on)); btn.setAttribute('tabindex', on ? '0' : '-1');
  });
  document.querySelectorAll('.rp').forEach(panel => {
    const on = panel.id === 'tp-' + name;
    panel.classList.toggle('on', on); on ? panel.removeAttribute('hidden') : panel.setAttribute('hidden', '');
  });
  TAB_EFFECTS[name]?.();
}

/* Clic */
tabBtns.forEach(btn => btn.addEventListener('click', () => {
  switchTab(btn.dataset.tab);
  btn.focus();
}));

/* Navigation clavier dans le tablist */
document.querySelector('.rtabs').addEventListener('keydown', e => {
  const current = tabBtns.indexOf(document.activeElement);
  if (current === -1) return;
  let next = -1;
  if (e.key === 'ArrowRight') next = (current + 1) % tabBtns.length;
  if (e.key === 'ArrowLeft') next = (current - 1 + tabBtns.length) % tabBtns.length;
  if (e.key === 'Home') next = 0;
  if (e.key === 'End') next = tabBtns.length - 1;
  if (next !== -1) {
    e.preventDefault();
    tabBtns[next].focus();
    switchTab(tabBtns[next].dataset.tab);
  }
});

/* ── DRAG depuis SIDEBAR ── */
let dragType = null;

document.querySelectorAll('.bsrc').forEach(btn => {
  btn.addEventListener('dragstart', e => {
    if (btn.dataset.t === 'freeform') { e.preventDefault(); return; }
    dragType = btn.dataset.t;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('btype', btn.dataset.t);
    if (btn.dataset.shape) e.dataTransfer.setData('bshape', btn.dataset.shape);
  });
  btn.addEventListener('dragend', () => { dragType = null; });

  /* Alternative clavier : Entrée ajoute le bloc en haut de la page 1 */
  btn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const d = DEFS[btn.dataset.t] || { w: 200, h: 60 };
      const x = pageW(0) / 2 - d.w / 2;
      const y = MAR + blocks.filter(b => Math.floor(b.y / PH) === 0).length * 24;
      const extra = btn.dataset.shape ? { shapeKind: btn.dataset.shape } : {};
      const newId = addBlock(btn.dataset.t, x, y, extra);
      if (btn.dataset.t === 'freeform' && newId) {
        requestAnimationFrame(() => startFreeformDraw(newId));
      }
    }
  });

  /* Touch : tap = insertion sur la page la plus visible dans le viewport */
  (function () {
    let _tMoved = false, _tSx = 0, _tSy = 0;
    btn.addEventListener('touchstart', e => {
      _tMoved = false; _tSx = e.touches[0].clientX; _tSy = e.touches[0].clientY;
    }, { passive: true });
    btn.addEventListener('touchmove', e => {
      if (Math.abs(e.touches[0].clientX - _tSx) > 8 || Math.abs(e.touches[0].clientY - _tSy) > 8) _tMoved = true;
    }, { passive: true });
    btn.addEventListener('touchend', e => {
      if (_tMoved) return;
      if (btn.dataset.t === 'freeform') return; /* géré par le click listener ci-dessous */
      e.preventDefault();
      /* Trouver la page canvas la plus visible dans le viewport */
      const pages = [...document.querySelectorAll('.canvas-page')];
      let targetPage = pages[0]; let bestVis = 0;
      pages.forEach(pg => {
        const r = pg.getBoundingClientRect();
        const vis = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
        if (vis > bestVis) { bestVis = vis; targetPage = pg; }
      });
      const pageIdx = targetPage ? (parseInt(targetPage.dataset.page) || 0) : 0;
      const pw = pageW(pageIdx);
      const d = DEFS[btn.dataset.t] || { w: 200, h: 60 };
      const x = pw / 2 - d.w / 2;
      const blocksOnPage = blocks.filter(b => Math.floor(b.y / PH) === pageIdx);
      const y = pageIdx * PH + MAR + blocksOnPage.length * 28;
      const extra = btn.dataset.shape ? { shapeKind: btn.dataset.shape } : {};
      addBlock(btn.dataset.t, x, y, extra);
      announce('Bloc ajouté à la page ' + (pageIdx + 1) + '.');
      /* Faire défiler jusqu'au bloc ajouté */
      const vp = document.getElementById('viewport');
      if (vp && targetPage) vp.scrollTo({ top: targetPage.offsetTop - 20, behavior: 'smooth' });
    }, { passive: false });
  })();

  /* Clic direct sur le bouton Forme libre */
  if (btn.dataset.t === 'freeform') {
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => {
      const d = DEFS.freeform;
      const x = pageW(0) / 2 - d.w / 2;
      const y = MAR + 40;
      const newId = addBlock('freeform', x, y, {});
      if (newId) requestAnimationFrame(() => startFreeformDraw(newId));
    });
  }
});

/* ── AJOUTER UN BLOC ── */
function addBlock(type, x, y, extraProps) {
  snapshotState();
  const d = DEFS[type] || { w: 200, h: 60 };
  const b = Object.assign(structuredClone(d), { id: uid(), type, x: Math.round(x), y: Math.round(y), order: blocks.length, content: d.content || '' }, extraProps || {});
  blocks.push(b);
  getCanvasPage(Math.floor(b.y / PH))?.appendChild(buildEl(b));
  sel(b.id); switchTab('bloc'); updUA(); updTree(); saveSession();
  return b.id;
}

/* ── Helper de construction DOM ── */
function el(tag, { cls, style, attrs = {}, html, text, on = {} } = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls; if (style) e.style.cssText = style;
  if (html) e.innerHTML = html; if (text) e.textContent = text;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  Object.entries(on).forEach(([ev, fn]) => e.addEventListener(ev, fn));
  return e;
}

/* ── CONSTRUIRE L'ÉLÉMENT ── */
function buildEl(b) {
  const label = labelForType(b.type), localY = b.y % PH;
  const isDecorative = b.type === 'shape' || b.type === 'freeform';
  const wrapper = el('div', { cls: 'fb' + (isDecorative ? ' shape-block' : ''), style: `left:${b.x}px;top:${localY}px;width:${b.w}px;height:${b.h}px;z-index:${b.zIndex || 0}`, attrs: { id: 'el-' + b.id } });
  const bar = el('div', { cls: 'fb-bar', attrs: { 'aria-hidden': 'true' } });
  bar.append(
    el('span', { cls: 'fb-bar-lbl', text: label }),
    el('button', { cls: 'fb-dup', html: '<span aria-hidden="true">⧉</span>', attrs: { type: 'button', 'aria-label': 'Dupliquer le bloc ' + label }, on: { click: e => { e.stopPropagation(); dupB(b.id); } } }),
    el('button', { cls: 'fb-del', html: '<span aria-hidden="true">×</span>', attrs: { type: 'button', 'aria-label': 'Supprimer le bloc ' + label }, on: { click: e => { e.stopPropagation(); rmB(b.id); } } })
  );
  attachDrag(bar, wrapper, b);
  const ct = el('div', { cls: 'fb-ct', attrs: { id: 'ct-' + b.id } });
  fillCt(ct, b);
  const rsz = el('div', { cls: 'fb-rsz', attrs: { 'aria-hidden': 'true' } });
  attachRsz(rsz, wrapper, b);
  wrapper.append(bar, ct, rsz);
  if (isDecorative) {
    const rot = el('div', { cls: 'fb-rot', attrs: { 'aria-hidden': 'true', title: 'Faire glisser pour pivoter' } });
    attachRot(rot, wrapper, b); wrapper.appendChild(rot);
  }
  wrapper.addEventListener('mousedown', e => { if (e.target.closest('.fb-bar') || e.target === rsz) return; sel(b.id); });

  /* Touch : tap sur le bloc = sélection (iOS ne déclenche pas toujours mousedown) */
  (function () {
    let _tMoved = false, _tSx = 0, _tSy = 0;
    wrapper.addEventListener('touchstart', e => {
      _tMoved = false; _tSx = e.touches[0].clientX; _tSy = e.touches[0].clientY;
    }, { passive: true });
    wrapper.addEventListener('touchmove', e => {
      if (Math.abs(e.touches[0].clientX - _tSx) > 8 || Math.abs(e.touches[0].clientY - _tSy) > 8) _tMoved = true;
    }, { passive: true });
    wrapper.addEventListener('touchend', e => {
      if (_tMoved) return;
      if (e.target.closest('.fb-del, .fb-dup, .fb-bar, .fb-rsz, .fb-rot')) return;
      sel(b.id);
    }, { passive: true });
  })();

  return wrapper;
}

/* ══════════════════════════════════════════════════════════
   CONSTANTES DE RENDU WYSIWYG↔PDF
   Toutes les tailles sont en points (pt).
   1pt CSS = 1pt PDF — la page canvas fait 794×1123 CSS px
   qui correspondent à 794×1123 PDF pts (A4 @72dpi).
   BAR_H  : hauteur de la barre de titre du bloc (px = pt)
   CT_PAD : padding horizontal de .fb-ct (px = pt)
   ══════════════════════════════════════════════════════════ */

/* ── CONTENU DES BLOCS — table de dispatch IHM ── */

/* ── Styles des encadrés — partagé entre FILL_CT, BLOCK_RENDERERS et exportCode ── */
const ASIDE_STYLES = {
  info: { bg: '#eff6ff', border: '#3b82f6', icon: 'ℹ', iconColor: '#1d4ed8' },
  warn: { bg: '#fffbeb', border: '#f59e0b', icon: '⚠', iconColor: '#92400e' },
  tip: { bg: '#f0fdf4', border: '#22c55e', icon: '✓', iconColor: '#166534' },
  neutral: { bg: '#f9fafb', border: '#9ca3af', icon: '▮', iconColor: '#6b7280' },
};

/* ── Helper : crée un div contenteditable rich avec oninput → richContent ── */
function _mkRichDiv(b, ariaLabel, style) {
  const t = document.createElement('div');
  t.contentEditable = 'true';
  t.setAttribute('role', 'textbox');
  t.setAttribute('aria-multiline', 'true');
  t.setAttribute('aria-label', ariaLabel);
  t.style.cssText = style;
  if (b.richContent) t.innerHTML = b.richContent; else t.textContent = b.content || '';
  t.oninput = () => { invalidateHtmlToRunsCache(b.richContent); b.richContent = t.innerHTML; b.content = htmlToPlain(t.innerHTML); };
  t.onmousedown = e => e.stopPropagation();
  return t;
}

const FILL_CT = {

  'form-text'(ct, b) {
    ct.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:2px 0';
    const lbl = document.createElement('label');
    lbl.style.cssText = `font-size:10px;font-weight:700;font-family:${docFont()};color:#3a3a3a;pointer-events:none;line-height:1.5`;
    lbl.textContent = (b.formLabel || 'Libellé') + (b.formRequired ? ' *' : '');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.placeholder = b.formPlaceholder || '';
    inp.value = b.formDefaultValue || ''; inp.readOnly = true;
    /* DSFR : fond #eeeeee, arrondi haut 4px, bordure bas 2px #3a3a3a */
    inp.style.cssText = `font-size:10px;font-family:${docFont()};border:none;border-bottom:2px solid #3a3a3a;border-radius:4px 4px 0 0;padding:6px 12px;background:${b.formReadonly ? '#dedede' : '#eeeeee'};color:#3a3a3a;pointer-events:none;width:100%;box-sizing:border-box;outline:none`;
    ct.append(lbl, inp); ct.appendChild(utag('Form', 'u-f'));
  },

  'form-textarea'(ct, b) {
    ct.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:2px 0';
    const lbl = document.createElement('label');
    lbl.style.cssText = `font-size:10px;font-weight:700;font-family:${docFont()};color:#3a3a3a;pointer-events:none;line-height:1.5`;
    lbl.textContent = (b.formLabel || 'Libellé') + (b.formRequired ? ' *' : '');
    const ta = document.createElement('textarea');
    ta.placeholder = b.formPlaceholder || ''; ta.value = b.formDefaultValue || ''; ta.readOnly = true;
    ta.style.cssText = `font-size:10px;font-family:${docFont()};border:none;border-bottom:2px solid #3a3a3a;border-radius:4px 4px 0 0;padding:6px 12px;background:${b.formReadonly ? '#dedede' : '#eeeeee'};color:#3a3a3a;pointer-events:none;width:100%;box-sizing:border-box;resize:none;flex:1;min-height:40px;outline:none`;
    ct.append(lbl, ta); ct.appendChild(utag('Form', 'u-f'));
  },

  'form-checkbox'(ct, b) {
    /* DSFR v1.14 : 24×24px, border-radius 4px, fond #000091 + coche #f5f5fe si coché */
    ct.style.cssText = 'display:flex;align-items:center;gap:12px;padding:4px 0';
    const box = document.createElement('span');
    box.style.cssText = `flex-shrink:0;width:24px;height:24px;border-radius:4px;border:1px solid ${b.formChecked ? '#000091' : '#3a3a3a'};background:${b.formChecked ? '#000091' : '#fff'};display:flex;align-items:center;justify-content:center;box-sizing:border-box`;
    if (b.formChecked) box.innerHTML = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='16' height='16' aria-hidden='true'><path fill='#f5f5fe' d='M10 15.17l9.2-9.2 1.4 1.42L10 18l-6.36-6.36 1.4-1.42z'/></svg>`;
    const lbl = document.createElement('span');
    lbl.style.cssText = `font-size:10px;font-family:${docFont()};color:#3a3a3a;pointer-events:none;line-height:1.5`;
    lbl.textContent = (b.formLabel || 'Case à cocher') + (b.formRequired ? ' *' : '');
    ct.append(box, lbl); ct.appendChild(utag('Form', 'u-f'));
  },

  'form-radio'(ct, b) {
    /* DSFR v1.14 : cercle 24px, fond blanc, bordure #3a3a3a */
    ct.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:2px 0';
    const grpLbl = document.createElement('span');
    grpLbl.style.cssText = `font-size:10px;font-weight:700;font-family:${docFont()};color:#3a3a3a;pointer-events:none;line-height:1.5`;
    grpLbl.textContent = (b.formLabel || 'Groupe') + (b.formRequired ? ' *' : '');
    ct.appendChild(grpLbl);
    (b.formOptions || 'Option 1\nOption 2').split('\n').filter(o => o.trim()).forEach(opt => {
      const row = document.createElement('label');
      row.style.cssText = `display:flex;align-items:center;gap:12px;font-size:10px;font-family:${docFont()};color:#3a3a3a;pointer-events:none;line-height:1.5`;
      const circ = document.createElement('span');
      circ.style.cssText = 'flex-shrink:0;width:24px;height:24px;border-radius:50%;border:1px solid #3a3a3a;background:#fff;box-sizing:border-box';
      row.append(circ, document.createTextNode(opt.trim()));
      ct.appendChild(row);
    });
    ct.appendChild(utag('Form', 'u-f'));
  },

  'form-select'(ct, b) {
    /* DSFR v1.14 : fond #eeeeee, coins arrondis haut, bordure bas, zone chevron distincte */
    ct.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:2px 0';
    const lbl = document.createElement('label');
    lbl.style.cssText = `font-size:10px;font-weight:700;font-family:${docFont()};color:#3a3a3a;pointer-events:none;line-height:1.5`;
    lbl.textContent = (b.formLabel || 'Libellé') + (b.formRequired ? ' *' : '');

    /* Wrapper positionné pour superposer la zone chevron */
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:100%;pointer-events:none;display:flex';

    /* Zone texte principale */
    const textZone = document.createElement('div');
    const opts = (b.formOptions || 'Choix 1\nChoix 2').split('\n').filter(o => o.trim());
    const displayVal = b.formDefaultValue && opts.includes(b.formDefaultValue)
      ? b.formDefaultValue : (opts[0] || '');
    textZone.style.cssText = `flex:1;font-size:10px;font-family:${docFont()};border-top:none;border-left:none;border-right:none;border-bottom:2px solid #3a3a3a;border-radius:4px 0 0 0;padding:5px 8px;background:${b.formReadonly ? '#dedede' : '#eeeeee'};color:#3a3a3a;pointer-events:none;box-sizing:border-box;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
    textZone.textContent = displayVal;

    /* Zone chevron séparée (32px) */
    const chevZone = document.createElement('div');
    chevZone.style.cssText = `width:32px;flex-shrink:0;background:#dcdcdc;border-bottom:2px solid #3a3a3a;border-radius:0 4px 0 0;border-left:0.5px solid #3a3a3a;display:flex;align-items:center;justify-content:center;pointer-events:none;box-sizing:border-box`;
    chevZone.innerHTML = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='#161616' width='14' height='14' aria-hidden='true'><path d='M12 13.1l5-4.9 1.4 1.4L12 15.9l-6.4-6.4L7 8.1z'/></svg>`;

    wrap.append(textZone, chevZone);
    ct.append(lbl, wrap);
    ct.appendChild(utag('Form', 'u-f'));
  },


  _heading(ct, b) {
    /* On utilise un <div> neutre (pas de <h1>…<h6>) pour ne pas polluer
       la hiérarchie sémantique de l'IHM — le vrai tag hX n'existe que dans le PDF produit. */
    ct.appendChild(_mkRichDiv(b,
      labelForType(b.type) + ' — contenu éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS[b.type]}px;font-weight:700;font-family:${docFont()};line-height:1.2;outline:none;display:block`
    ));
    ct.appendChild(utag(b.type.toUpperCase(), 'u-h'));
  },

  p(ct, b) {
    ct.appendChild(_mkRichDiv(b,
      'Paragraphe — contenu éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS.p}px;font-family:${docFont()};line-height:1.6;outline:none;white-space:normal`
    ));
    ct.appendChild(utag('P', 'u-p'));
  },

  _list(ct, b) {
    const lst = document.createElement(b.type);
    lst.className = 'list-preview fb-rich';
    lst.setAttribute('aria-label', (b.type === 'ul' ? 'Liste à puces' : 'Liste numérotée') + ' — un élément par ligne');

    /* Construire les <li contenteditable> depuis b.content ou b.richContent */
    const _rebuildLi = () => {
      lst.innerHTML = '';
      /* Si richContent existe (contient des <sup> de notes), restaurer depuis là */
      if (b.richContent) {
        const tmp = document.createElement('div');
        tmp.innerHTML = b.richContent;
        const savedLis = tmp.querySelectorAll('li');
        if (savedLis.length) {
          savedLis.forEach(savedLi => {
            const li = document.createElement('li');
            li.contentEditable = 'true';
            li.innerHTML = savedLi.innerHTML || '<br>';
            _attachLi(li);
            lst.appendChild(li);
          });
          return;
        }
      }
      const lines = (b.content || '').split('\n').filter(l => l.trim() !== '');
      (lines.length ? lines : ['']).forEach(line => {
        const li = document.createElement('li');
        li.contentEditable = 'true';
        li.innerHTML = line || '<br>';
        _attachLi(li);
        lst.appendChild(li);
      });
    };

    const _attachLi = li => {
      li.onmousedown = e => e.stopPropagation();
      li.oninput = _syncContent;
      li.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const newLi = document.createElement('li');
          newLi.contentEditable = 'true';
          newLi.innerHTML = '<br>';
          _attachLi(newLi);
          li.insertAdjacentElement('afterend', newLi);
          const range = document.createRange();
          range.setStart(newLi, 0);
          range.collapse(true);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
          _syncContent();
        } else if (e.key === 'Backspace') {
          const isEmpty = li.textContent.trim() === '' && !li.querySelector('sup');
          if (isEmpty && lst.children.length > 1) {
            e.preventDefault();
            const prev = li.previousElementSibling;
            li.remove();
            if (prev) {
              const range = document.createRange();
              range.selectNodeContents(prev);
              range.collapse(false);
              window.getSelection().removeAllRanges();
              window.getSelection().addRange(range);
            }
            _syncContent();
          }
        }
      };
    };

    const _syncContent = () => {
      /* Sérialiser les <li> en texte brut (ignorer les <sup> dans le compte de lignes) */
      b.content = [...lst.querySelectorAll('li')]
        .map(li => li.textContent).join('\n');
      /* Synchroniser richContent pour les sup de notes */
      b.richContent = lst.outerHTML;
      if (typeof saveSession === 'function') saveSession();
    };

    _rebuildLi();
    lst.style.fontSize = (b.fontSize || FS.list) + 'px';
    if (b.listNoBullet) lst.classList.add('list-no-bullet');
    else lst.classList.remove('list-no-bullet');
    ct.appendChild(lst);
    ct.appendChild(utag(b.type.toUpperCase(), 'u-l'));
  },

  img(ct, b) {
    const ph = document.createElement('div');
    ph.className = 'iph';
    if (b.imgData) {
      const im = document.createElement('img');
      im.src = b.imgData;
      im.setAttribute('alt', b.alt || '');
      ph.appendChild(im);
    }
    const lbl2 = document.createElement('span');
    lbl2.textContent = b.imgData ? '↺ Changer' : '🖼 Choisir une image';
    ph.appendChild(lbl2);
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
    fi.setAttribute('aria-label', 'Choisir un fichier image');
    fi.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = ev => { b.imgData = ev.target.result; const c = document.getElementById('ct-' + b.id); if (c) fillCt(c, b); updUA(); announce('Image chargée.'); };
      reader.readAsDataURL(f);
    };
    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.setAttribute('aria-label', 'Choisir une image');
    chooseBtn.style.cssText = 'background:none;border:none;cursor:pointer;width:100%;height:100%;position:absolute;inset:0;';
    chooseBtn.onclick = e => { e.stopPropagation(); fi.click(); };
    ph.style.position = 'relative';
    ph.appendChild(fi); ph.appendChild(chooseBtn);
    /* Badge lien image — contour bleu si linkUrl défini */
    ph.style.outline = b.imgLinkUrl ? '2px solid #1d4ed8' : '';
    ph.style.outlineOffset = b.imgLinkUrl ? '-2px' : '';
    if (b.imgLinkUrl) {
      const badge = Object.assign(document.createElement('span'), { textContent: '↗ lien' });
      badge.style.cssText = 'position:absolute;top:3px;right:3px;background:#1d4ed8;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;pointer-events:none;z-index:2';
      badge.setAttribute('aria-hidden', 'true');
      ph.appendChild(badge);
    }
    ct.appendChild(ph);
    /* Tag structurel : Link>Figure si lien, Figure si alt, Artifact sinon */
    const imgTag = b.imgLinkUrl ? 'LINK' : (b.alt ? 'IMG' : 'DECO');
    const imgCls = b.imgLinkUrl ? 'u-k' : (b.alt ? 'u-i' : 'u-d');
    ct.appendChild(utag(imgTag, imgCls));
    if (b.alt || b.imgLinkUrl) {
      const ad = document.createElement('p');
      const hasAlt = !!b.alt;
      ad.style.cssText = `font-size:9px;color:${hasAlt ? '#9d174d' : '#1d4ed8'};margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
      ad.textContent = (b.imgLinkUrl ? '↗ ' + b.imgLinkUrl.slice(0, hasAlt ? 28 : 40) + (hasAlt ? '  |  ' : '') : '') +
        (hasAlt ? 'alt : ' + b.alt : '');
      ct.appendChild(ad);
    }
  },

  link(ct, b) {
    const a = Object.assign(document.createElement('div'), { textContent: b.linkText || 'Lien' });
    a.style.cssText = 'font-size:12px;color:#1d4ed8;text-decoration:underline;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    a.setAttribute('aria-label', 'Lien : ' + (b.linkText || b.linkUrl || 'sans texte'));
    ct.appendChild(a);
    ct.appendChild(utag('LINK', 'u-k'));
  },

  table(ct, b) {
    const tbl = document.createElement('table');
    tbl.setAttribute('aria-label', 'Tableau éditable');
    tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;line-height:1.5';
    const thead = tbl.createTHead();
    const tbody = tbl.createTBody();
    (b.tableData || []).forEach((row, ri) => {
      const isHdr = ri === 0;
      const section = isHdr ? thead : tbody;
      const tr = section.insertRow();
      if (!isHdr) tr.style.backgroundColor = ri % 2 === 1 ? '#ffffff' : '#f6f6f6';
      row.forEach((cell, ci) => {
        const td = document.createElement(isHdr ? 'th' : 'td');
        if (isHdr) td.setAttribute('scope', 'col');
        td.contentEditable = 'true';
        td.setAttribute('aria-label', (isHdr ? 'En-tête colonne ' : 'Cellule ligne ' + ri + ' colonne ') + (ci + 1));
        td.textContent = cell;
        const borderBottom = isHdr ? '2px solid #999999' : '1px solid #e0e0e0';
        td.style.cssText = 'padding:9px 12px;text-align:left;vertical-align:middle;border:none;' +
          'border-bottom:' + borderBottom + ';' +
          (isHdr ? 'font-weight:700;background-color:#f6f6f6;' : 'background:transparent;');
        td.oninput = () => { b.tableData[ri][ci] = td.textContent; };
        td.onmousedown = e => e.stopPropagation();
        tr.appendChild(td);
      });
    });
    const btnStyle = 'margin-top:3px;font-size:9px;padding:2px 6px;border:1px solid #e5e7eb;border-radius:3px;cursor:pointer;background:#f9fafb';
    const mkTableBtn = (label, ariaLabel, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = btnStyle;
      btn.textContent = label;
      btn.setAttribute('aria-label', ariaLabel);
      btn.onclick = e => { e.stopPropagation(); onClick(); const c = document.getElementById('ct-' + b.id); if (c) fillCt(c, b); };
      return btn;
    };
    const addRowBtn = mkTableBtn('+ Ligne', 'Ajouter une ligne au tableau', () => {
      b.tableData.push(b.tableData[0].map(() => ''));
      announce('Ligne ajoutée au tableau.');
    });
    const addColBtn = mkTableBtn('+ Colonne', 'Ajouter une colonne au tableau', () => {
      b.tableData.forEach(row => row.push(''));
      announce('Colonne ajoutée au tableau.');
    });
    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    btnWrap.append(addRowBtn, addColBtn);
    ct.appendChild(tbl); ct.appendChild(btnWrap);
    ct.appendChild(utag('TABLE', 'u-t'));
  },

  quote(ct, b) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border-left:3px solid #6366f1;padding-left:8px;height:100%;display:flex;flex-direction:column;gap:4px';

    const txt = _mkRichDiv(b,
      'Citation — texte éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS.quote}px;font-style:italic;font-family:${docFont()};line-height:1.6;outline:none;white-space:normal;color:#1e1b4b;flex:1`
    );

    const src = document.createElement('div');
    src.contentEditable = 'true';
    src.setAttribute('role', 'textbox');
    src.setAttribute('aria-label', 'Source / auteur de la citation — éditable');
    src.setAttribute('data-ph', '— Auteur, Œuvre');
    src.style.cssText = `font-size:9px;color:#6b7280;font-family:${docFont()};outline:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
    src.textContent = b.quoteSource || '';
    src.oninput = () => { b.quoteSource = src.textContent.trim(); saveSession(); };
    src.onmousedown = e => e.stopPropagation();

    wrap.appendChild(txt); wrap.appendChild(src);
    ct.appendChild(wrap); ct.appendChild(utag('QUOTE', 'u-q'));
  },

  note(ct, b) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:5px;align-items:flex-start';
    const ref = document.createElement('sup');
    ref.style.cssText = `font-size:8px;color:${LINK_COLOR};font-family:${docFont()};flex-shrink:0;font-weight:700`;
    ref.textContent = b.noteRef || '1';
    const txt = _mkRichDiv(b,
      'Note — texte éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS.note}px;font-family:${docFont()};line-height:1.6;outline:none;white-space:normal;color:#374151`
    );
    wrap.appendChild(ref); wrap.appendChild(txt);
    ct.appendChild(wrap);
    /* Indicateur de lien vers le bloc ancre (si note ancrée) */
    if (b.anchorBlockId) {
      const anchorHint = document.createElement('div');
      anchorHint.style.cssText = 'font-size:9px;color:#9ca3af;margin-top:2px;cursor:pointer';
      anchorHint.textContent = '\u2191 Aller \u00e0 l\u2019ancre dans le texte';
      anchorHint.title = 'Cliquer pour sélectionner le bloc texte parent';
      anchorHint.onclick = e => { e.stopPropagation(); sel(b.anchorBlockId); switchTab('bloc'); };
      ct.appendChild(anchorHint);
    }
    ct.appendChild(utag('NOTE', 'u-n'));
  },

  hr(ct) {
    const line = Object.assign(document.createElement('div'), { ariaHidden: 'true' });
    line.style.cssText = 'width:100%;height:1px;background:#d1d5db;margin-top:calc(50% - 1px)';
    line.setAttribute('aria-hidden', 'true');
    ct.appendChild(line);
    ct.appendChild(utag('HR', 'u-sep'));
  },

  aside(ct, b) {
    const st = ASIDE_STYLES[b.asideStyle || 'info'];
    const wrap = document.createElement('div');
    wrap.style.cssText = `background:${st.bg};border-left:3px solid ${st.border};padding:6px 8px;height:100%;display:flex;gap:6px;border-radius:0 3px 3px 0`;
    const icon = document.createElement('span');
    icon.style.cssText = `color:${st.iconColor};font-size:12px;flex-shrink:0;margin-top:1px`;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = st.icon;
    const txt = _mkRichDiv(b,
      'Encadré — contenu éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS.aside}px;font-family:${docFont()};line-height:1.6;outline:none;white-space:normal;color:#1a1a1a`
    );
    wrap.appendChild(icon); wrap.appendChild(txt);
    ct.appendChild(wrap); ct.appendChild(utag('ASIDE', 'u-as'));
  },

  code(ct, b) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:#1e293b;border-radius:3px;padding:6px 8px;height:100%;overflow:hidden;margin:0';
    const code = document.createElement('code');
    code.contentEditable = 'true';
    code.setAttribute('aria-label', 'Bloc de code — contenu éditable');
    code.style.cssText = `font-size:${FS.code}px;font-family:'Courier New',monospace;line-height:1.5;outline:none;white-space:pre-wrap;color:#e2e8f0;display:block`;
    code.textContent = b.content || '';
    code.oninput = () => { b.content = code.textContent; };
    code.onmousedown = e => e.stopPropagation();
    pre.appendChild(code); ct.appendChild(pre);
    ct.appendChild(utag('CODE', 'u-cd'));
  },

  shape(ct, b) {
    const w = 100, h = 100; // viewBox normalisé — SVG s'étire via CSS
    const rotation = b.shapeRotation || 0;
    const hasBorder = b.shapeBorderEnabled && b.shapeKind !== 'wave';
    const fillNone = b.shapeFillNone && b.shapeKind !== 'wave';

    const svg = document.createElementNS(_SVG_NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.color = b.shapeColor || '#000091';
    svg.style.opacity = b.shapeOpacity != null ? b.shapeOpacity : 1;
    svg.style.display = 'block';
    svg.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    svg.style.transformOrigin = '50% 50%';
    svg.innerHTML = shapeSVGPath(b.shapeKind || 'circle', w, h);

    svg.querySelectorAll('ellipse,path,polygon,rect').forEach(el => {
      if (fillNone) el.setAttribute('fill', 'none');
      if (hasBorder) {
        el.setAttribute('stroke', b.shapeBorderColor || '#1d4ed8');
        el.setAttribute('stroke-width', b.shapeBorderWidth || 2);
        el.setAttribute('stroke-linejoin', 'round');
        el.setAttribute('paint-order', 'stroke');
      }
    });

    ct.appendChild(svg); ct.appendChild(utag('FORME', 'u-sh'));
  },

  freeform(ct, b) {
    renderFreeformInCt(ct, b);
  },

  chart(ct, b) {
    renderChartInCt(ct, b);
  },
};

/* Aliaser les types heading et list vers leurs handlers partagés */
['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(t => { FILL_CT[t] = FILL_CT._heading; });
['ul', 'ol'].forEach(t => { FILL_CT[t] = FILL_CT._list; });

function fillCt(ct, b) { ct.innerHTML = ''; const fn = FILL_CT[b.type]; if (fn) fn(ct, b); }

/* ── SÉLECTION ── */
function sel(id) {
  /* Retirer la sélection du bloc précédent sans querySelectorAll global */
  if (sid && sid !== id) {
    document.getElementById('el-' + sid)?.classList.remove('sel');
  }
  sid = id;
  document.getElementById('el-' + id)?.classList.add('sel');
  updBP();
}

function desel() {
  if (sid) document.getElementById('el-' + sid)?.classList.remove('sel');
  sid = null;
  $('bp-none').style.display = 'block';
  $('bp-fields').style.display = 'none';
}


/* ══════════════════════════════════════════════════════════════
   RENUMÉROTATION DES NOTES
   Parcourt les blocs riches dans l'ordre de lecture (page, Y),
   puis les <sup> dans l'ordre DOM, et renuméote les blocs note
   correspondants + met à jour les sup + les titres.
   ══════════════════════════════════════════════════════════════ */
function renumberNotes() {
  /* ── 1. Numéroter dans l'ordre de lecture (page > y > x) ── */
  const readOrder = [...blocks].sort((a, b) => {
    const pa = Math.floor(a.y / PH), pb = Math.floor(b.y / PH);
    return pa !== pb ? pa - pb : a.y !== b.y ? a.y - b.y : a.x - b.x;
  });

  let counter = 0;
  readOrder.forEach(b => {
    if (!RICH_TYPES.has(b.type)) return;
    const ct = document.getElementById('ct-' + b.id);
    if (!ct) return;
    const sups = ct.querySelectorAll('sup[data-note-id]');
    if (!sups.length) return;
    sups.forEach(sup => {
      const noteId = sup.dataset.noteId;
      const noteBlock = blocks.find(x => x.id === noteId);
      if (!noteBlock) return;
      counter++;
      const ref = String(counter);
      noteBlock.noteRef = ref;
      sup.textContent = ref;
      sup.title = 'Note ' + ref + ' — cliquer pour sélectionner';
      const noteEl = document.getElementById('ct-' + noteId);
      if (noteEl) {
        const refEl = noteEl.querySelector('.note-ref');
        if (refEl) refEl.textContent = '[' + ref + ']';
      }
    });
    _syncRichFromDOM(b);
  });

  /* ── 2. Repositionner les notes par page, empilées en bas ── */
  _repositionNotes();

  saveSession();
}

/* Empile les blocs note en bas de leur page respective, dans l'ordre de leur numéro,
   comme Word : la note 1 est la plus haute, les suivantes descendent. */
function _repositionNotes() {
  /* Grouper les notes par page d'ancrage */
  const byPage = {};
  blocks
    .filter(b => b.type === 'note')
    .sort((a, b) => (parseInt(a.noteRef) || 0) - (parseInt(b.noteRef) || 0))
    .forEach(b => {
      /* La note doit apparaître sur la même page que son ancre */
      const anchorBlock = blocks.find(x => x.id === b.anchorBlockId);
      const pageIdx = anchorBlock ? Math.floor(anchorBlock.y / PH) : Math.floor(b.y / PH);
      if (!byPage[pageIdx]) byPage[pageIdx] = [];
      byPage[pageIdx].push(b);
    });

  Object.entries(byPage).forEach(([pageIdxStr, notes]) => {
    const pageIdx = parseInt(pageIdxStr);
    const ph = pageH(pageIdx);
    const pw = pageW(pageIdx);
    const NOTE_H = 36;          /* hauteur d'un bloc note */
    const NOTE_W = pw - 2 * MAR; /* largeur calée sur les marges */
    const BOTTOM_PAD = 12;      /* marge basse avant le bord de page */

    /* Empiler de bas en haut : la dernière note est la plus basse */
    notes.forEach((b, i) => {
      const newY = pageIdx * PH + ph - BOTTOM_PAD - NOTE_H * (notes.length - i);
      const newX = MAR;

      if (b.y === newY && b.x === newX && b.w === NOTE_W && b.h === NOTE_H) return;

      b.x = newX; b.y = newY; b.w = NOTE_W; b.h = NOTE_H;

      const domEl = document.getElementById('el-' + b.id);
      if (!domEl) return;

      /* Déplacer dans la bonne page canvas si nécessaire */
      const currentPage = domEl.parentElement;
      const targetPage = getCanvasPage(pageIdx);
      if (targetPage && currentPage !== targetPage) targetPage.appendChild(domEl);

      domEl.style.left = b.x + 'px';
      domEl.style.top = (b.y % PH) + 'px';
      domEl.style.width = b.w + 'px';
      domEl.style.height = b.h + 'px';
    });
  });
}

/* ── SUPPRESSION DE PAGE ── */
function deletePage(idx) {
  if (idx === 0 || numPages <= 1) return;
  snapshotState();
  /* 1. Supprimer les blocs sur cette page */
  blocks.filter(b => Math.floor(b.y / PH) === idx).forEach(b => { _removeNoteAnchor(b); document.getElementById('el-' + b.id)?.remove(); });
  blocks = blocks.filter(b => Math.floor(b.y / PH) !== idx);
  /* 2. Redescendre les blocs des pages suivantes */
  blocks.forEach(b => { if (Math.floor(b.y / PH) > idx) { b.y -= PH; const domEl = document.getElementById('el-' + b.id); if (domEl) domEl.style.top = (b.y % PH) + 'px'; } });
  /* 3. Déplacer les enfants DOM des pages suivantes vers la page précédente */
  for (let i = idx + 1; i < numPages; i++) {
    const pg = document.getElementById('cpage-' + i), prev = document.getElementById('cpage-' + (i - 1));
    if (pg && prev) [...pg.children].forEach(c => prev.appendChild(c));
  }
  /* 4. Supprimer le DOM de la dernière page */
  const last = document.getElementById('cpage-' + (numPages - 1));
  if (last) { pageWrap.querySelector(`.page-label[data-page="${numPages - 1}"]`)?.remove(); last.remove(); }
  /* 5. Réindexer */
  pageOrientations.splice(idx, 1); numPages--;
  for (let i = idx; i < numPages; i++) {
    const pg = document.getElementById('cpage-' + (i + 1)) || pageWrap.querySelectorAll('.canvas-page')[i];
    if (pg) { pg.id = 'cpage-' + i; pg.dataset.page = i; pg.setAttribute('aria-label', 'Page ' + (i + 1) + ' — zone de dépôt des blocs'); applyPageOrientation(pg, i); setupPageDrop(pg, i); }
    _updatePageLabel(i);
  }
  if (sid && !blocks.find(b => b.id === sid)) desel();
  rebuildGridOverlays(); updUA(); updTree(); saveSession();
  announce('Page ' + (idx + 1) + ' supprimée. Ctrl+Z pour annuler.');
}
/* ── Helper : retire le <sup> d'ancre dans le bloc parent d'une note ── */
function _removeNoteAnchor(b) {
  if (b.type !== 'note' || !b.anchorBlockId) return;
  const parent = blocks.find(x => x.id === b.anchorBlockId); if (!parent) return;
  document.getElementById('ct-' + parent.id)?.querySelector('sup[data-note-id="' + b.id + '"]')?.remove();
  _syncRichFromDOM(parent);
}

function rmB(id) {
  snapshotState();
  const b = blocks.find(x => x.id === id);
  if (b) _removeNoteAnchor(b);
  blocks = blocks.filter(x => x.id !== id);
  document.getElementById('el-' + id)?.remove();
  if (sid === id) desel();
  if (b?.type === 'note' && b.anchorBlockId) renumberNotes();
  else if (blocks.some(x => x.type === 'note')) _repositionNotes();
  updUA(); updTree(); saveSession();
  announce('Bloc ' + (b ? labelForType(b.type) : 'bloc') + ' supprimé. Ctrl+Z pour annuler.');
}

function dupB(id) {
  snapshotState();
  const orig = blocks.find(b => b.id === id); if (!orig) return;
  const copy = JSON.parse(JSON.stringify({ ...orig, _bmNode: undefined }));
  copy.id = uid(); copy.x = orig.x + 16; copy.y = orig.y + 16; copy.order = blocks.length;
  blocks.push(copy);
  getCanvasPage(Math.floor(copy.y / PH))?.appendChild(buildEl(copy));
  sel(copy.id); updUA(); updTree(); saveSession();
  announce('Bloc dupliqué.');
}

function bprop(k, v) {
  const b = blocks.find(x => x.id === sid); if (!b) return;
  b[k] = v;
  if (k === 'alt' || k === 'linkText') rr(b.id);
  /* Quand le type change (ex. h1→h2), mettre à jour le label visible dans la barre du bloc */
  if (k === 'type') {
    const newLabel = labelForType(v);
    const wrapper = document.getElementById('el-' + b.id);
    if (wrapper) {
      const lbl = wrapper.querySelector('.fb-bar-lbl');
      if (lbl) lbl.textContent = newLabel;
      /* Mettre à jour aussi les aria-label des boutons dup/del */
      const dup = wrapper.querySelector('.fb-dup');
      const del = wrapper.querySelector('.fb-del');
      if (dup) dup.setAttribute('aria-label', 'Dupliquer le bloc ' + newLabel);
      if (del) del.setAttribute('aria-label', 'Supprimer le bloc ' + newLabel);
    }
  }
  updUA(); saveSession();
}

function rr(id) { const b = blocks.find(x => x.id === id); if (!b) return; const c = document.getElementById('ct-' + b.id); if (c) fillCt(c, b); }

function applyPos() {
  const b = blocks.find(x => x.id === sid); if (!b) return;
  const oldPageIdx = Math.floor(b.y / PH);
  b.x = parseInt(document.getElementById('bx').value) || 0;
  b.y = parseInt(document.getElementById('by').value) || 0;
  const domEl = document.getElementById('el-' + b.id);
  if (domEl) {
    domEl.style.left = b.x + 'px'; domEl.style.top = (b.y % PH) + 'px';
    const newPageIdx = Math.floor(b.y / PH);
    if (newPageIdx !== oldPageIdx) getCanvasPage(newPageIdx)?.appendChild(domEl);
  }
}

function applySz() {
  const b = blocks.find(x => x.id === sid); if (!b) return;
  const isDecorative = b.type === 'shape' || b.type === 'freeform' || b.type === 'hr';
  const minW = isDecorative ? 1 : 80;
  const minH = isDecorative ? 1 : 28;
  b.w = Math.max(minW, parseInt(document.getElementById('bw').value) || minW);
  b.h = Math.max(minH, parseInt(document.getElementById('bh').value) || minH);
  const domEl = document.getElementById('el-' + b.id);
  if (domEl) { domEl.style.width = b.w + 'px'; domEl.style.height = b.h + 'px'; }
}

function qa(d) {
  const b = blocks.find(x => x.id === sid); if (!b) return;
  const pageIdx = Math.floor(b.y / PH), pw = pageW(pageIdx);
  const ALIGN = { l: () => ({ x: MAR }), r: () => ({ x: pw - MAR - b.w }), c: () => ({ x: Math.round((pw - b.w) / 2) }), t: () => ({ y: pageIdx * PH + MAR }) };
  Object.assign(b, ALIGN[d]?.());
  const domEl = document.getElementById('el-' + b.id);
  if (domEl) { domEl.style.left = b.x + 'px'; domEl.style.top = (b.y % PH) + 'px'; }
  updBP();
}

/* Gestion des calques (z-index visuel, indépendant de l'ordre de lecture PDF) */
function chZ(d) {
  const b = blocks.find(x => x.id === sid); if (!b) return;
  snapshotState();
  b.zIndex = (b.zIndex || 0) + d;
  const domEl = document.getElementById('el-' + b.id);
  if (domEl) domEl.style.zIndex = b.zIndex;
  updBP(); saveSession();
  announce('Calque : niveau ' + b.zIndex);
}

function getZLabel(z) {
  if (!z) return 'Normal (0)';
  return (z > 0 ? 'Au-dessus' : 'En dessous') + ' (' + (z > 0 ? '+' : '') + z + ')';
}

function chOrd(d) {
  const b = blocks.find(x => x.id === sid); if (!b) return;
  snapshotState();
  const sorted = ordB();
  const i = sorted.findIndex(x => x.id === sid);
  const j = i + d; if (j < 0 || j >= sorted.length) return;
  const o = sorted[j];
  const tmp = b.order; b.order = o.order; o.order = tmp;
  updTree(); updBP();
  saveSession();
}

/* Recalcule b.order de tous les blocs selon leur position spatiale
   (page → Y → X). Résout les désalignements dus à des ajouts successifs. */
function syncOrderToPosition() {
  if (!blocks.length) return;
  snapshotState();
  [...blocks]
    .sort((a, b) => {
      const pa = Math.floor(a.y / PH), pb = Math.floor(b.y / PH);
      return pa !== pb ? pa - pb : a.y !== b.y ? a.y - b.y : a.x - b.x;
    })
    .forEach((b, i) => { b.order = i; });
  _ordCacheKey = ''; // invalider le cache
  updTree(); updBP(); saveSession();
  announce('Ordre de lecture synchronisé sur la position des blocs.');
}

/* ══════════════════════════════════════════════════════════════
   PANEL_BINDINGS — table déclarative des panneaux conditionnels
   Chaque entrée : {
     panel   : id du div à afficher/masquer
     types   : liste des types qui activent ce panneau
     fill(b) : remplit les champs quand le panneau est visible
   }
   ══════════════════════════════════════════════════════════════ */
const PANEL_BINDINGS = [
  {
    panel: 'bp-alt',
    types: ['img'],
    fill: b => {
      $('bav').value = b.alt || '';
      $('bimglink').value = b.imgLinkUrl || '';
    },
  },
  {
    panel: 'bp-fontsize',
    types: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'quote', 'note', 'aside'],
    fill: b => {
      const inp = $('bfontsize');
      if (inp) inp.value = b.fontSize != null ? b.fontSize : '';
    },
  },
  {
    panel: 'bp-lnk',
    types: ['link'],
    fill: b => { $('blt').value = b.linkText || ''; $('blu').value = b.linkUrl || ''; },
  },
  {
    panel: 'bp-hlv',
    types: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    fill: b => { $('bhlv').value = b.type; },
  },
  {
    panel: 'bp-bookmark',
    types: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    fill: b => { $('bbookmark').checked = (b.bookmark !== false); },
  },
  {
    panel: 'bp-quote',
    types: ['quote'],
    fill: b => { $('bqsrc').value = b.quoteSource || ''; },
  },
  {
    panel: 'bp-note',
    types: ['note'],
    fill: b => {
      $('bnref').value = b.noteRef || '';
      /* Désactiver la modification du numéro si la note est ancrée */
      const inp = $('bnref');
      if (inp) {
        inp.readOnly = !!b.anchorBlockId;
        inp.title = b.anchorBlockId ? 'Numéro géré automatiquement (note ancrée)' : '';
        inp.style.background = b.anchorBlockId ? '#f3f4f6' : '';
      }
    },
  },
  {
    panel: 'bp-form',
    types: ['form-text', 'form-textarea', 'form-checkbox', 'form-radio', 'form-select'],
    fill: b => {
      $('bform-label').value = b.formLabel || '';
      $('bform-placeholder').value = b.formPlaceholder || '';
      $('bform-default').value = b.formDefaultValue || '';
      $('bform-required').checked = !!b.formRequired;
      $('bform-readonly').checked = !!b.formReadonly;
      $('bform-checked').checked = !!b.formChecked;
      $('bform-options').value = b.formOptions || '';
      const isCheckbox = b.type === 'form-checkbox';
      const isRadio = b.type === 'form-radio';
      const isSelect = b.type === 'form-select';
      const hasPlaceholder = ['form-text', 'form-textarea', 'form-select'].includes(b.type);
      const hasDefault = ['form-text', 'form-textarea', 'form-select'].includes(b.type);
      _show('bform-row-placeholder', hasPlaceholder);
      _show('bform-row-default', hasDefault);
      _show('bform-row-checked', isCheckbox);
      _show('bform-row-options', isRadio || isSelect);
      _show('bform-row-readonly', !isCheckbox && !isRadio);
      _show('bform-row-required', true);
    },
  },

  {
    panel: 'bp-aside',
    types: ['aside'],
    fill: b => { $('basidestyle').value = b.asideStyle || 'info'; },
  },
  {
    panel: 'bp-shape',
    types: ['shape'],
    fill: b => {
      $('bshapekind').value = b.shapeKind || 'circle';
      /* Couleur de remplissage */
      _fillColorWrap('bshapecolor-wrap', 'bshapecolor', b.shapeColor || '#000091', 'shapeColor');
      const transpChk = $('bshapetransparent');
      if (transpChk) transpChk.checked = !!b.shapeFillNone;
      setSlider('bshapeopacity', b.shapeOpacity ?? 1, v => Math.round(v * 100) + '%');
      setSlider('bshaperotation', b.shapeRotation || 0, v => v + '°');
      /* Bordure */
      const borderChk = $('bshapeborder');
      if (borderChk) borderChk.checked = !!b.shapeBorderEnabled;
      _fillColorWrap('bshapebordercolor-wrap', 'bshapebordercolor', b.shapeBorderColor || '#000091', 'shapeBorderColor');
      setSlider('bshapeborderwidth', b.shapeBorderWidth || 2, v => v + 'px');
    },
  },
  {
    panel: 'bp-freeform',
    types: ['freeform'],
    fill: b => {
      _fillColorWrap('bffcolor-wrap', 'bffcolor', b.shapeColor || '#000091', 'shapeColor');
      setSlider('bffopacity', b.shapeOpacity ?? 1, v => Math.round(v * 100) + '%');
      setSlider('bffrotation', b.shapeRotation || 0, v => v + '°');
      setSlider('bffstroke', b.strokeWidth || 2, v => v + 'px');
      const fill = $('bfffill'); if (fill) fill.checked = !!b.shapeFilled;
      const closed = $('bffclosed'); if (closed) closed.checked = b.pathClosed !== false;
    },
  },
  {
    panel: 'bp-list',
    types: ['ul', 'ol'],
    fill: b => { const chk = $('blistnobullet'); if (chk) chk.checked = !!b.listNoBullet; },
  },
  {
    panel: 'bp-chart',
    types: ['chart'],
    fill: b => {
      $('bchartkind').value = b.chartKind || 'pie';
      $('bcharttitle').value = b.chartTitle || '';
      $('bchartalt').value = b.alt || '';
      _chartRebuildRows(b);
    },
  },
];

/* Raccourcis internes à updBP */
const $ = id => document.getElementById(id);
const _show = (id, visible) => { const el = $(id); if (el) el.style.display = visible ? '' : 'none'; };

function setSlider(id, value, fmt) {
  const input = $(id); if (!input) return;
  input.value = value;
  const lbl = $(id + '-val'); if (lbl) lbl.textContent = fmt(value);
}

/**
 * Peuple un conteneur div avec un sélecteur couleur DSFR.
 * Si le sélecteur existe déjà (même id), met à jour sa valeur.
 */
function _fillColorWrap(wrapperId, selectId, value, propKey) {
  const wrap = $(wrapperId);
  if (!wrap) return;
  let sel = $(selectId);
  if (sel) {
    /* Mettre à jour la valeur existante */
    const resolved = dsfrClosest(value);
    sel.value = resolved;
    const swatch = $(selectId + '-swatch');
    if (swatch) swatch.style.background = resolved;
  } else {
    /* Créer le sélecteur la première fois */
    wrap.innerHTML = '';
    const widget = makeDsfrColorSelect(selectId, value, hex => {
      bprop(propKey, hex);
      rr(sid);
    });
    wrap.appendChild(widget);
  }
}

function updBP() {
  const b = blocks.find(x => x.id === sid);
  $('bp-none').style.display = b ? 'none' : 'block';
  const _zLbl = $('z-level-lbl'); if (_zLbl && b) _zLbl.textContent = getZLabel(b.zIndex || 0);
  $('bp-fields').style.display = b ? 'block' : 'none';
  if (!b) return;
  $('bx').value = Math.round(b.x); $('by').value = Math.round(b.y);
  $('bw').value = Math.round(b.w); $('bh').value = Math.round(b.h);
  $('oi').textContent = `Page ${Math.floor(b.y / PH) + 1} — Position lecture : ${ordB().findIndex(x => x.id === b.id) + 1} / ${blocks.length}`;
  PANEL_BINDINGS.forEach(({ panel, types, fill }) => { const on = types.includes(b.type); $(panel).style.display = on ? 'block' : 'none'; if (on) fill(b); });
}

/* ── CHECKLIST PDF/UA ── */
let _updUA_lastKey = '';
function updUA() {
  const meta = _collectMeta();
  const s = ordB();

  /* Fingerprint rapide — si l'état pertinent pour la checklist n'a pas changé,
     on évite de reconstruire le DOM (innerHTML + map = coûteux sur gros docs) */
  const uaKey = `${meta.title}|${meta.lang}|${s.length}|` +
    s.map(b => `${b.type}:${b.alt ?? ''}:${b.linkText ?? ''}:${b.linkUrl ?? ''}`).join(',');
  if (uaKey === _updUA_lastKey) return;
  _updUA_lastKey = uaKey;

  const hasH1 = s.some(b => b.type === 'h1');
  const badAlt = s.filter(b => b.type === 'img' && !b.alt).length;
  const lkOk = s.filter(b => b.type === 'link').every(b => b.linkText && b.linkUrl && b.linkUrl !== 'https://');
  const hs = s.filter(b => ['h1', 'h2', 'h3'].includes(b.type)).map(b => +b.type[1]);
  const hok = hs.every((h, i) => i === 0 || h <= hs[i - 1] + 1);

  const chks = [
    { l: 'Titre du document défini', ok: meta.title.length > 0 },
    { l: 'Langue déclarée', ok: meta.lang !== '' },
    { l: 'Au moins un titre H1', ok: hasH1 },
    { l: 'Hiérarchie des titres correcte', ok: hok },
    { l: 'Images avec texte alternatif', ok: badAlt === 0, warn: badAlt > 0 && s.some(b => b.type === 'img') },
    { l: 'Liens avec texte significatif', ok: lkOk },
    { l: 'Document non vide', ok: blocks.length > 0 },
  ];

  /* Construire le HTML en une passe, une seule écriture DOM */
  document.getElementById('ual').innerHTML = chks.map(ck => {
    const status = ck.ok ? 'ua-ok' : ck.warn ? 'ua-warn' : 'ua-err';
    const label = ck.ok ? 'Conforme : ' : (ck.warn ? 'Avertissement : ' : 'Non conforme : ');
    return `<div class="ua-item ${status}"><div class="ua-dot" aria-hidden="true"></div>` +
      `<span class="sr-only">${label}</span><span>${ck.l}</span></div>`;
  }).join('');
  window._patchUABadge?.();
}

/* ── ARBRE DES TAGS ── */

/* Table de description pour chaque type dans l'arbre de structure */
const TREE_LABELS = {};
['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(t => { TREE_LABELS[t] = b => ({ tg: t.toUpperCase(), co: (b.content || '').slice(0, 26) }); });
Object.assign(TREE_LABELS, {
  p: b => ({ tg: 'P', co: htmlToPlain(b.richContent || b.content || '').slice(0, 26) }),
  ul: b => ({ tg: 'L(ul)', co: (b.content || '').split('\n').filter(l => l.trim()).length + ' items' }),
  ol: b => ({ tg: 'L(ol)', co: (b.content || '').split('\n').filter(l => l.trim()).length + ' items' }),
  img: b => ({ tg: b.imgLinkUrl ? 'Link>Figure' : b.alt ? 'Figure' : 'Artifact', co: (b.imgLinkUrl ? '↗ ' : '') + (b.alt ? 'alt : ' + b.alt.slice(0, 18) : 'décoratif') }),
  link: b => ({ tg: 'Link', co: (b.linkText || '').slice(0, 22) }),
  table: b => ({ tg: 'Table', co: ((b.tableData || []).length - 1) + ' lignes' }),
  quote: b => ({ tg: 'BlockQuote', co: (b.content || '').slice(0, 22) }),
  note: b => ({ tg: 'Note', co: (b.anchorBlockId ? '†' : '') + 'ref ' + (b.noteRef || '?') + ' — ' + (b.content || '').slice(0, 16) }),
  hr: _ => ({ tg: 'Artifact', co: 'Séparateur décoratif' }),
  aside: b => ({ tg: 'Sect', co: (b.asideStyle || 'info') + ' — ' + (b.content || '').slice(0, 16) }),
  code: b => ({ tg: 'Code', co: (b.content || '').slice(0, 26) }),
  shape: b => ({ tg: 'Artifact', co: (SHAPE_DEFS[b.shapeKind] || {}).label || 'forme' }),
  freeform: b => ({ tg: 'Artifact', co: 'Forme libre — ' + (b.pathPoints || []).length + ' pts' }),
  chart: b => ({ tg: 'Figure', co: (b.chartKind || 'pie') + (b.chartTitle ? ' — ' + b.chartTitle.slice(0, 18) : '') }),
});

function updTree() {
  const tree = document.getElementById('tagt');
  /* Nœud racine et nœud de fermeture (statiques, pas de listeners) */
  const mkStatic = html => Object.assign(document.createElement('div'),
    { className: 'tn', innerHTML: html, role: 'treeitem' });
  const root = mkStatic('<span class="tg">&lt;Document&gt;</span>');
  root.setAttribute('aria-expanded', 'true');

  const frag = document.createDocumentFragment();
  frag.appendChild(root);

  ordB().forEach((b, i) => {
    const { tg, co } = TREE_LABELS[b.type]?.(b) ?? { tg: b.type, co: '' };
    const n = document.createElement('div');
    n.className = 'tn';
    n.setAttribute('role', 'treeitem');
    n.setAttribute('tabindex', '0');
    n.style.paddingLeft = '14px';
    n.setAttribute('aria-label', `Nœud ${i + 1} : ${labelForType(b.type)}${b.content ? ' — ' + b.content.slice(0, 30) : ''}`);
    n.onclick = () => { sel(b.id); switchTab('bloc'); };
    n.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel(b.id); switchTab('bloc'); } };
    n.innerHTML = `<span aria-hidden="true" style="color:#9ca3af">${String(i + 1).padStart(2, '0')} </span><span class="tg" aria-hidden="true">&lt;${tg}&gt;</span> <span class="tc" aria-hidden="true">${co}</span>`;
    frag.appendChild(n);
  });

  frag.appendChild(mkStatic('<span class="tg" aria-hidden="true">&lt;/Document&gt;</span>'));
  tree.replaceChildren(frag);
}

/* ── Versions debounce de updUA et updTree ─────────────────────────────────
   Ces fonctions reconstruisent tout l'arbre et recalculent tous les checks
   PDF/UA. Sur un document dense ou lors d'une frappe rapide, les appeler en
   rafale est coûteux. Un debounce de 150 ms regroupe les appels successifs
   en un seul rendu, sans impacter la réactivité perçue. */
let _uaTimer = null, _treeTimer = null;
const _updUA = updUA;
const _updTree = updTree;
updUA = () => { clearTimeout(_uaTimer); _uaTimer = setTimeout(_updUA, 150); };
updTree = () => { clearTimeout(_treeTimer); _treeTimer = setTimeout(_updTree, 150); };

/* ══════════════════════════════════════════════════════════════
   ADAPTATIONS TACTILES — touch events, zoom canvas, sidebar tap
   Activées sur tous écrans ≤ 1100px ou pointer:coarse.
   Intégrées directement ici pour éviter un fichier supplémentaire.
   ══════════════════════════════════════════════════════════════ */
(function initMobile() {

  const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches ||
    ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const IS_NARROW = window.matchMedia('(max-width: 1100px)').matches;
  if (!IS_TOUCH && !IS_NARROW) return;

  /* ── 1. PATCH useDrag — touch events sur déplacement, resize, rotation ──
     useDrag est défini dans editor-ui.js. Il est réécrit ici pour inclure
     nativement les handlers touchstart/touchmove/touchend en parallèle
     des handlers mouse existants. On surcharge la référence globale
     après que editor-ui.js l'ait définie (ce fichier est chargé après). */
  function _normTouch(e, touch) {
    /* Renvoie un objet compatible MouseEvent à partir d'un Touch */
    return {
      clientX: touch.clientX, clientY: touch.clientY,
      target: e.target,
      preventDefault: () => e.preventDefault(),
      stopPropagation: () => e.stopPropagation(),
    };
  }

  function _addTouchToHandle(handle, { onStart, onMove, onEnd, guard } = {}) {
    let _ctx = null, _id = null, _rafPending = false, _lastTouch = null;
    handle.addEventListener('touchstart', e => {
      if (e.touches.length > 1) return;
      const proxy = _normTouch(e, e.changedTouches[0]);
      if (guard?.(proxy)) return;
      e.preventDefault();
      _id = e.changedTouches[0].identifier;
      _ctx = onStart?.(proxy) ?? {};
    }, { passive: false });
    handle.addEventListener('touchmove', e => {
      if (_ctx === null) return;
      const touch = [...e.changedTouches].find(t => t.identifier === _id); if (!touch) return;
      e.preventDefault();
      _lastTouch = touch;
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(() => {
        _rafPending = false;
        if (_lastTouch) onMove?.(_normTouch(e, _lastTouch), _ctx);
      });
    }, { passive: false });
    const _end = e => {
      if (_ctx === null) return;
      const touch = [...e.changedTouches].find(t => t.identifier === _id); if (!touch) return;
      onEnd?.(_normTouch(e, touch), _ctx);
      _ctx = null; _id = null;
    };
    handle.addEventListener('touchend', _end, { passive: false });
    handle.addEventListener('touchcancel', _end, { passive: false });
  }

  /* Attacher les touch events sur les éléments d'un bloc (.fb) */
  function _touchifyBlock(fbEl) {
    if (fbEl._mobileReady) return;
    fbEl._mobileReady = true;
    const elId = () => fbEl.id.replace('el-', '');
    const getB = () => blocks.find(x => x.id === elId());

    /* Barre titre → déplacement */
    const bar = fbEl.querySelector('.fb-bar');
    if (bar) _addTouchToHandle(bar, {
      guard: e => !!e.target?.closest?.('.fb-del, .fb-dup'),
      onStart: e => { const b = getB(); if (!b) return null; sel(b.id); snapshotState(); fbEl.classList.add('moving'); return { sx: e.clientX, sy: e.clientY, ox: b.x, oy: b.y, b }; },
      onMove: (e, ctx) => {
        if (!ctx?.b) return; const { sx, sy, ox, oy, b } = ctx;
        const pi = Math.floor(b.y / PH);
        const _isDecorative = b.type === 'shape' || b.type === 'freeform' || b.type === 'hr';
        const _newX = ox + (e.clientX - sx);
        b.x = snapVal(_isDecorative ? _newX : Math.max(0, Math.min(pageW(pi) - b.w, _newX)));
        b.y = snapVal(oy + (e.clientY - sy));
        fbEl.style.left = b.x + 'px'; fbEl.style.top = (b.y % PH) + 'px';
        const ni = Math.floor(b.y / PH);
        if (ni !== pi) { const pg = getCanvasPage(ni); if (pg) pg.appendChild(fbEl); }
        updBP();
      },
      onEnd: (e, ctx) => {
        if (!ctx?.b) return;
        fbEl.classList.remove('moving');
        const { b } = ctx;
        const hasAnchors = b.type !== 'note' && RICH_TYPES.has(b.type) && document.getElementById('ct-' + b.id)?.querySelector('sup[data-note-id]');
        if (hasAnchors || b.type === 'note') renumberNotes();
        updTree(); saveSession();
      },
    });

    /* Poignée resize */
    const rsz = fbEl.querySelector('.fb-rsz');
    if (rsz) _addTouchToHandle(rsz, {
      onStart: e => { const b = getB(); if (!b) return null; return { sx: e.clientX, sy: e.clientY, sw: b.w, sh: b.h, b }; },
      onMove: (e, ctx) => {
        if (!ctx?.b) return; const { sx, sy, sw, sh, b } = ctx;
        const isDecorative = b.type === 'shape' || b.type === 'freeform' || b.type === 'hr';
        const minW = isDecorative ? 1 : 80;
        const minH = isDecorative ? 1 : 28;
        b.w = Math.max(minW, Math.min(pageW(Math.floor(b.y / PH)) - b.x, snapVal(sw + (e.clientX - sx))));
        b.h = Math.max(minH, snapVal(sh + (e.clientY - sy)));
        fbEl.style.width = b.w + 'px'; fbEl.style.height = b.h + 'px'; updBP();
      },
      onEnd: () => saveSession(),
    });

    /* Poignée rotation (formes décoratives) */
    const rot = fbEl.querySelector('.fb-rot');
    if (rot) _addTouchToHandle(rot, {
      onStart: e => {
        const b = getB(); if (!b) return null; snapshotState();
        const r = fbEl.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        return { cx, cy, sa: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI, sr: b.shapeRotation || 0, b };
      },
      onMove: (e, { cx, cy, sa, sr, b }) => {
        if (!b) return;
        b.shapeRotation = ((Math.round(sr + Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI - sa) % 360) + 360) % 360;
        const ct = document.getElementById('ct-' + b.id); if (ct) fillCt(ct, b); updBP();
      },
      onEnd: () => saveSession(),
    });
  }

  /* Observer les blocs existants + futurs, et l'overlay plume —
     Un seul MutationObserver sur body couvre les deux besoins. */
  document.querySelectorAll('.fb').forEach(_touchifyBlock);

  const _s = (type, t) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY, button: 0, buttons: type !== 'mouseup' ? 1 : 0 });

  new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      /* Blocs canvas */
      if (n.classList?.contains('fb')) _touchifyBlock(n);
      n.querySelectorAll?.('.fb').forEach(_touchifyBlock);
      /* ── 2. OUTIL PLUME — overlay freeform ── */
      if (n.id === 'ff-overlay') {
        let _fId = null;
        n.addEventListener('touchstart', e => {
          if (e.touches.length > 1) return; e.preventDefault();
          _fId = e.changedTouches[0].identifier; n.dispatchEvent(_s('mousedown', e.changedTouches[0]));
        }, { passive: false });
        n.addEventListener('touchmove', e => {
          const t = [...e.changedTouches].find(x => x.identifier === _fId); if (!t) return; e.preventDefault();
          n.dispatchEvent(_s('mousemove', t));
        }, { passive: false });
        const _up = e => { const t = [...e.changedTouches].find(x => x.identifier === _fId); if (!t) return; n.dispatchEvent(_s('mouseup', t)); _fId = null; };
        n.addEventListener('touchend', _up, { passive: false });
        n.addEventListener('touchcancel', () => { n.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); _fId = null; });
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  /* ── 3. SCROLL AUTOMATIQUE vers le bloc sélectionné ── */
  const _origSel = sel;
  /* sel() est défini dans editor-ui.js — on ne peut pas la surcharger ici
     car elle n'est pas encore définie au moment de l'exécution de ce bloc IIFE.
     On l'enveloppe après le chargement complet. */
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof sel !== 'function') return;
    /* sel est une fonction locale dans editor-ui.js, non exposée sur window —
       on patch via le nœud d'arbre (onClick) plutôt que la fonction directe. */
  }, { once: true });

  /* L'arbre de tags utilise n.onclick → on le surcharge dans updTree.
     On réécrit la partie onclick après chaque reconstruction de l'arbre
     via un MutationObserver sur #tagt. */
  const tagt = document.getElementById('tagt');
  if (tagt) new MutationObserver(() => {
    tagt.querySelectorAll('.tn[tabindex="0"]').forEach(n => {
      if (n._scrollPatched) return;
      n._scrollPatched = true;
      const origClick = n.onclick;
      n.onclick = e => {
        origClick?.call(n, e);
        requestAnimationFrame(() => {
          const selEl = document.querySelector('.fb.sel');
          const vp = document.getElementById('viewport');
          if (!selEl || !vp) return;
          const er = selEl.getBoundingClientRect(), vr = vp.getBoundingClientRect();
          if (er.top < vr.top || er.bottom > vr.bottom) selEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      };
    });
  }).observe(tagt, { childList: true, subtree: true });

  /* ── 4. BARRE DE FORMAT — repositionnement fallback sur iOS ── */
  document.addEventListener('selectionchange', () => {
    const fb = document.getElementById('fmt-bar');
    if (!fb || !fb.classList.contains('visible')) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const rect = s.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) return; /* déjà correct */
    /* Fallback : centrer en haut de l'écran */
    const bw = fb.offsetWidth || 200;
    fb.style.left = Math.max(8, (window.innerWidth - bw) / 2) + 'px';
    fb.style.top = (80 + window.scrollY) + 'px';
  });

  /* Fermeture de la modale lien au tap en dehors */
  document.addEventListener('touchend', e => {
    const lm = document.getElementById('link-modal');
    if (!lm || !lm.classList.contains('visible')) return;
    if (!lm.contains(e.target)) { if (typeof closeLinkModal === 'function') closeLinkModal(); }
  }, { passive: true });

  /* ── 5. ZOOM DU CANVAS ── */
  let _zoom = 1.0;
  const ZMIN = 0.3, ZMAX = 1.5, ZSTEP = 0.1;

  function applyZoom(z) {
    _zoom = Math.max(ZMIN, Math.min(ZMAX, z));
    const pw = document.getElementById('page-wrap'); if (!pw) return;
    pw.style.transform = `scale(${_zoom})`;
    pw.style.transformOrigin = 'top center';
    const lbl = document.getElementById('mob-zoom-lbl'); if (lbl) lbl.textContent = Math.round(_zoom * 100) + '%';
  }

  function autoZoom() {
    const vp = document.getElementById('viewport'); if (!vp) return;
    const avail = vp.clientWidth - 48;
    if (avail < PW) applyZoom(Math.max(ZMIN, avail / PW));
  }

  /* Barre flottante +/−/⟳ */
  const zBar = document.createElement('div');
  zBar.id = 'mob-zoom-bar';
  zBar.setAttribute('role', 'toolbar');
  zBar.setAttribute('aria-label', 'Niveau de zoom');
  zBar.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;background:#1e293b;color:#e2e8f0;border-radius:22px;padding:5px 12px;z-index:8000;box-shadow:0 4px 16px rgba(0,0,0,.3);font-size:12px;user-select:none';

  const mkZBtn = (label, txt, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-label', label); b.textContent = txt;
    b.style.cssText = 'background:none;border:none;color:#e2e8f0;font-size:17px;cursor:pointer;min-width:36px;min-height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center';
    b.addEventListener('click', fn);
    return b;
  };
  const zLbl = document.createElement('span');
  zLbl.id = 'mob-zoom-lbl';
  zLbl.textContent = '100%';
  zLbl.style.cssText = 'min-width:40px;text-align:center;font-weight:600';
  zBar.append(
    mkZBtn('Dézoomer', '−', () => applyZoom(_zoom - ZSTEP)),
    zLbl,
    mkZBtn('Zoomer', '+', () => applyZoom(_zoom + ZSTEP)),
    mkZBtn('Réinitialiser', '⟳', () => applyZoom(1))
  );
  document.body.appendChild(zBar);

  /* Pinch-to-zoom sur #viewport */
  const vp = document.getElementById('viewport');
  if (vp) {
    let _pd = null, _pz = 1;
    vp.addEventListener('touchstart', e => { if (e.touches.length === 2) { _pd = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY); _pz = _zoom; } }, { passive: true });
    vp.addEventListener('touchmove', e => {
      if (e.touches.length !== 2 || _pd === null) return; e.preventDefault();
      applyZoom(_pz * Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY) / _pd);
    }, { passive: false });
    vp.addEventListener('touchend', () => { _pd = null; }, { passive: true });
  }

  /* Zoom initial adaptatif */
  autoZoom();
  window.addEventListener('resize', () => { if (_zoom < 1) autoZoom(); });
  window.addEventListener('orientationchange', () => setTimeout(autoZoom, 300));

  /* ── 6. BANNIÈRE INFO — première visite sur mobile ── */
  if (IS_TOUCH && window.matchMedia('(max-width: 768px)').matches && !sessionStorage.getItem('mob_ok')) {
    const ban = document.createElement('div');
    ban.setAttribute('role', 'alert');
    ban.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#1e3a5f;color:#fff;padding:9px 42px 9px 12px;font-size:11px;line-height:1.5;z-index:10000;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    ban.innerHTML = '📱 <strong>Mode mobile</strong> — tapez un bloc dans la barre latérale pour l\'ajouter. Pincez le canvas pour zoomer.';
    const cls = document.createElement('button');
    cls.type = 'button'; cls.setAttribute('aria-label', 'Fermer'); cls.textContent = '×';
    cls.style.cssText = 'position:absolute;top:4px;right:8px;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;min-width:32px;min-height:32px;line-height:1';
    cls.addEventListener('click', () => { ban.remove(); sessionStorage.setItem('mob_ok', '1'); });
    ban.appendChild(cls); document.body.appendChild(ban);
  }

})(); /* fin initMobile */
