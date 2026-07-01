// blocks.js — Manipulation des blocs : création, sélection, propriétés, panneaux

/* MISE EN FORME INLINE (gras/italique/lien) — blocs p, quote, aside, note, ul, ol.
   Stockage : richContent (HTML) + content (texte brut, fallback) */

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
    if (tag === 'u') next.underline = true;
    if (tag === 'span' && node.style?.textDecoration?.includes('underline')) next.underline = true;
    if (tag === 'span') {
      const fw = node.style?.fontWeight;
      const hasTdUnderline = node.style?.textDecoration?.includes('underline');
      if (!hasTdUnderline) {
        /* Modification intentionnelle du gras — pas un artefact de soulignement */
        if (fw === 'normal' || fw === '400') next.bold = false;
        if (fw === 'bold' || fw === '700') next.bold = true;
      }
    }
    if (tag === 'a') { next.linkUrl = node.getAttribute('href') || ''; next.linkText = node.textContent || ''; }
    if (tag === 'sup' && node.dataset?.noteId) { runs.push({ ...ctx, text: node.textContent || '', superscript: true, noteId: node.dataset.noteId }); return; }
    if (tag === 'br') { runs.push({ ...ctx, text: '\n' }); return; }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && runs.length) pushNL(ctx);
    for (const child of node.childNodes) walk(child, next);
    if (isBlock) pushNL(ctx);
  }
  walk(tmp, { bold: undefined, italic: false, underline: false, linkUrl: null, linkText: null });
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

/* ── Sanitisation du richContent importé (projet / sessionStorage) ──────────
   Conserve uniquement les balises et attributs nécessaires au rendu WYSIWYG
   et à l'export PDF : mise en forme inline, liens, appels de notes, listes.
   Bloque tout le reste (script, style, iframe, onclick…) en le remplaçant
   par son contenu texte, ce qui préserve le texte visible sans le balisage
   potentiellement dangereux.
   Liste blanche des balises conservées :
     Inline : strong, b, em, i, u, span, a, sup, br
     Bloc   : div, p, ul, ol, li
   Attributs conservés par balise :
     a   → href (vérifié par isSafeUrl)
     sup → data-note-id, style, title
     span → style (font-weight / text-decoration uniquement)
   Tous les autres attributs sont supprimés.
────────────────────────────────────────────────────────────────────────── */
function _sanitizeRichContent(html) {
  if (!html || typeof html !== 'string') return '';

  /* Parser via un div détaché — jamais injecté dans le DOM principal */
  const root = document.createElement('div');
  root.innerHTML = html;

  /* Balises autorisées (en minuscules) */
  const ALLOWED_TAGS = new Set([
    'strong', 'b', 'em', 'i', 'u', 'span', 'a', 'sup', 'br',
    'div', 'p', 'ul', 'ol', 'li',
  ]);

  /* Pattern de style autorisé pour <span> : font-weight et text-decoration */
  const SAFE_STYLE_RE = /^(font-weight\s*:\s*(bold|normal|\d+)|text-decoration\s*:\s*(underline|none|line-through))(\s*;\s*(font-weight\s*:\s*(bold|normal|\d+)|text-decoration\s*:\s*(underline|none|line-through)))*\s*;?$/i;

  function walk(node) {
    /* Nœud texte — rien à faire */
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); return; }

    const tag = node.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      /* Remplacer la balise non autorisée par ses enfants (on garde le texte) */
      const frag = document.createDocumentFragment();
      while (node.firstChild) frag.appendChild(node.firstChild);
      node.replaceWith(frag);
      return; /* les enfants seront traités par l'itération du parent */
    }

    /* Nettoyer les attributs : ne conserver que ceux de la liste blanche */
    const attrsToRemove = [];
    for (const attr of node.attributes) {
      attrsToRemove.push(attr.name);
    }
    for (const name of attrsToRemove) {
      if (tag === 'a' && name === 'href') {
        if (!isSafeUrl(node.getAttribute('href'))) node.setAttribute('href', '#');
      } else if (tag === 'sup' && (name === 'data-note-id' || name === 'style' || name === 'title')) {
        /* Conserver tel quel */
      } else if (tag === 'span' && name === 'style') {
        const styleVal = (node.getAttribute('style') || '').trim();
        if (!SAFE_STYLE_RE.test(styleVal)) node.removeAttribute('style');
      } else {
        node.removeAttribute(name);
      }
    }

    /* Traiter récursivement les enfants (itérer sur une copie car walk peut modifier la liste) */
    for (const child of [...node.childNodes]) walk(child);
  }

  for (const child of [...root.childNodes]) walk(child);
  return root.innerHTML;
}

function syncRichContent() {
  if (!sid) return;
  const b = blockById(sid);
  if (!b || !RICH_TYPES.has(b.type)) return;
  _syncRichFromDOM(b);
  if (typeof saveSession === 'function') saveSession();
}

function getRichEditEl(blockId) {
  const ct = document.getElementById('ct-' + blockId); if (!ct) return null;
  const b = blockById(blockId);
  if (b && (b.type === 'ul' || b.type === 'ol')) {
    const focused = ct.querySelector('li:focus');
    if (focused) return focused;
    const all = ct.querySelectorAll('li[contenteditable]');
    return all.length ? all[all.length - 1] : null;
  }
  return ct.querySelector('[contenteditable="true"]');
}
/* Suivi du <li> actif et de sa liste racine — capturé au mousedown/focus,
   indépendant de document.activeElement (qui peut changer avant le clic
   sur les boutons Indenter/Désindenter, notamment juste après un retrait
   qui recrée le <li> dans le DOM). */
let _activeListLi = null, _activeListRoot = null;

/* Remonte du <li> jusqu'à la liste racine (seule à exposer _doIndent/_doDedent —
   les sous-listes créées dynamiquement par _flatToDom n'ont pas ces méthodes). */
function _findListRoot(li) {
  let lst = li?.parentElement;
  while (lst && !lst._doIndent) lst = lst.parentElement;
  return lst || null;
}

let fmtBar = null, linkModal = null;
let _savedRange = null;      // Range sauvegardée avant ouverture de la modale lien
let _linkModalTrigger = null; // Élément déclencheur pour restaurer le focus à la fermeture
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
    // Les boutons de bascule exposent leur état via aria-pressed
    if (cmd || id === 'link') btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = content;
    if (cmd) btn.onclick = e => { e.preventDefault(); e.stopPropagation(); applyFmt(cmd); };
    return btn;
  };

  const sep = () => { const d = document.createElement('div'); d.className = 'fmt-sep'; d.setAttribute('aria-hidden', 'true'); return d; };

  fmtBar.appendChild(mkBtn('bold', 'Gras (Ctrl+B)', '<strong>G</strong>', 'bold'));
  fmtBar.appendChild(mkBtn('italic', 'Italique (Ctrl+I)', '<em>I</em>', 'italic'));
  fmtBar.appendChild(mkBtn('underline', 'Souligner (Ctrl+U)', '<u>S</u>', 'underline'));
  fmtBar.appendChild(sep());
  const lnkBtn = mkBtn('link', 'Insérer un lien hypertexte', '🔗', null);
  lnkBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); openLinkModal(); };
  fmtBar.appendChild(lnkBtn);
  fmtBar.appendChild(sep());
  /* ── Boutons indent/dedent — visibles uniquement dans un <li> ── */
  const indentSep = sep();
  indentSep.id = 'fmt-indent-sep';
  fmtBar.appendChild(indentSep);
  const indentBtn = mkBtn('indent', 'Augmenter le retrait', '→', null);
  indentBtn.id = 'fmt-indent';
  /* Capture le <li> actif dès le pointerdown — avant toute perte de focus
     possible sur le bouton — plutôt que de dépendre de document.activeElement
     au moment du click, plus fragile (cf. _captureNoteState, même pattern). */
  indentBtn.addEventListener('pointerdown', _captureListState);
  indentBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); _listIndentFromFmtBar(true); };
  fmtBar.appendChild(indentBtn);
  const dedentBtn = mkBtn('dedent', 'Diminuer le retrait', '←', null);
  dedentBtn.id = 'fmt-dedent';
  dedentBtn.addEventListener('pointerdown', _captureListState);
  dedentBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); _listIndentFromFmtBar(false); };
  fmtBar.appendChild(dedentBtn);
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
  /* mousedown uniquement en fallback pour les navigateurs sans Pointer Events */
  if (!window.PointerEvent) noteBtn.addEventListener('mousedown', _captureNoteState);
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
    if (e.key === 'Escape') { closeLinkModal(); return; }
    if (e.key === 'Enter') { e.preventDefault(); confirmLink(); return; }
  });
}

/* ── Indent/dedent depuis la barre de format ──────────────────────────
   Le <li> perd potentiellement le focus au clic sur le bouton (mousedown
   → blur possible selon navigateur). Solution : _captureListState capture
   le <li> actif et sa liste racine dès le pointerdown sur les boutons
   Indenter/Désindenter — premier événement de l'interaction, avant toute
   perte de focus — puis _listIndentFromFmtBar réutilise cette capture et
   appelle directement lst._doIndent / lst._doDedent (fonctions de la
   closure de la liste), sans dispatchEvent ni dépendance à activeElement.
──────────────────────────────────────────────────────────────────────── */
/* Capture le <li> actif et sa liste racine dès le pointerdown sur les boutons
   Indenter/Désindenter — au tout premier événement, la sélection/le focus
   sont encore garantis sur le <li>, avant toute action par défaut du bouton. */
function _captureListState(e) {
  e.preventDefault();
  const s = window.getSelection();
  const node = s?.rangeCount ? s.getRangeAt(0).commonAncestorContainer : null;
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const li = el?.closest?.('li[contenteditable]') || document.activeElement?.closest?.('li[contenteditable]');
  if (li) { _activeListLi = li; _activeListRoot = _findListRoot(li); }
}

function _listIndentFromFmtBar(indent) {
  const li = _activeListLi;
  const lst = _activeListRoot;
  if (!li || !lst || !lst._doIndent) return;
  indent ? lst._doIndent(li) : lst._doDedent(li);
}

function positionFmtBar() {
  const sel = window.getSelection();
  if (!fmtBar) return;

  /* Détecter si le curseur est dans un <li> (avec ou sans sélection) */
  const focusNode = sel?.focusNode;
  const focusEl = focusNode?.nodeType === Node.TEXT_NODE ? focusNode.parentElement : focusNode;
  const activeLi = focusEl?.closest('li[contenteditable]');

  /* Afficher les boutons indent/dedent seulement dans un <li> */
  const indentVisible = !!activeLi;
  ['fmt-indent-sep', 'fmt-indent', 'fmt-dedent'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = indentVisible ? '' : 'none';
  });

  /* Calculer la position de référence :
     - sélection non vide → utiliser le rect de la sélection
     - curseur dans un <li> sans sélection → utiliser le rect du <li> */
  let rect = null;
  if (sel && !sel.isCollapsed && sel.rangeCount) {
    rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width) rect = null;
  }
  if (!rect && activeLi) {
    rect = activeLi.getBoundingClientRect();
  }
  if (!rect) return;

  /* Sélection non vide : vérifier qu'on est bien dans un bloc RICH */
  if (sel && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const _sidFromRange = r => {
      const node = r.commonAncestorContainer;
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      const ct = el?.closest('[id^="ct-"]');
      return ct ? ct.id.replace('ct-', '') : null;
    };
    const effectiveSid = sid || _sidFromRange(range);
    if (effectiveSid && effectiveSid !== sid) {
      if (sid) document.getElementById('el-' + sid)?.classList.remove('sel');
      sid = effectiveSid;
      document.getElementById('el-' + effectiveSid)?.classList.add('sel');
    }
    _noteSavedSid = effectiveSid;
    _noteSavedRange = range.cloneRange();

    /* Vérifier que le bloc est de type rich */
    const b = blockById(sid);
    if (!b || !RICH_TYPES.has(b.type)) { hideFmtBar(); return; }
  } else if (!activeLi) {
    /* Ni sélection ni <li> → masquer */
    hideFmtBar(); return;
  }

  fmtBar.classList.add('visible');

  /* Positionner */
  const bw = fmtBar.offsetWidth || 220;
  const bh = fmtBar.offsetHeight || 36;
  let left = rect.left + rect.width / 2 - bw / 2;
  let top = rect.top - bh - 10 + window.scrollY;
  left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
  if (top < 4) top = rect.bottom + 10 + window.scrollY;

  fmtBar.style.cssText = fmtBar.style.cssText
    .replace(/left:[^;]+;?/g, '')
    .replace(/top:[^;]+;?/g, '')
    + `left:${left}px;top:${top}px;`;
  fmtBar.classList.add('visible');

  /* État des boutons de formatage (seulement si sélection non vide) */
  if (sel && !sel.isCollapsed) {
    const boldActive = document.queryCommandState('bold');
    const italicActive = document.queryCommandState('italic');
    const underlineActive = document.queryCommandState('underline');
    const boldBtn = document.getElementById('fmt-bold');
    const italicBtn = document.getElementById('fmt-italic');
    const underlineBtn = document.getElementById('fmt-underline');
    boldBtn.classList.toggle('active', boldActive);
    boldBtn.setAttribute('aria-pressed', String(boldActive));
    italicBtn.classList.toggle('active', italicActive);
    italicBtn.setAttribute('aria-pressed', String(italicActive));
    underlineBtn.classList.toggle('active', underlineActive);
    underlineBtn.setAttribute('aria-pressed', String(underlineActive));
    const anchor = sel.anchorNode && sel.anchorNode.parentElement;
    const linkActive = !!anchor?.closest('a');
    document.getElementById('fmt-link').classList.toggle('active', linkActive);
    document.getElementById('fmt-link').setAttribute('aria-pressed', String(linkActive));
  }

  /* État des boutons indent — calculé depuis le modèle plat de la liste racine
     (lst._canIndent / lst._canDedent), seule source de vérité partagée avec
     _doIndent/_doDedent. Évite toute désynchronisation au-delà d'un niveau
     d'imbrication (les anciennes heuristiques DOM — previousElementSibling,
     comparaison de parentList au 1er niveau — divergeaient du modèle réel
     dès le 2e niveau de sous-liste). */
  if (activeLi) {
    const lst = _findListRoot(activeLi);
    const canIndent = lst?._canIndent ? lst._canIndent(activeLi) : false;
    const canDedent = lst?._canDedent ? lst._canDedent(activeLi) : false;
    document.getElementById('fmt-indent').disabled = !canIndent;
    document.getElementById('fmt-dedent').disabled = !canDedent;
  }
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
  _linkModalTrigger = document.activeElement || null;
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
  // Restaurer le focus sur l'élément déclencheur
  if (_linkModalTrigger && typeof _linkModalTrigger.focus === 'function') {
    _linkModalTrigger.focus({ preventScroll: true });
  }
  _linkModalTrigger = null;
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

/* NOTES DE BAS DE PAGE (façon Word) : insertNoteAnchor() calcule le n° suivant,
   insère <sup data-note-id> dans le bloc actif, crée un bloc note en bas de page
   lié via anchorBlockId */
function insertNoteAnchor() {
  const targetSid = _noteSavedSid !== null ? _noteSavedSid : sid;
  const savedRange = _noteSavedRange;
  _noteSavedSid = null;
  _noteSavedRange = null;

  const b = blockById(targetSid);
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
  sup.className = 'note-anchor';
  sup.style.color = LINK_COLOR;
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
/**
 * Parse la structure de liste d'un bloc (ul/ol), en préservant l'imbrication.
 * Retourne un tableau d'objets { runs, depth, type } :
 *   - runs  : tableau de runs de texte (pour emitRichRuns)
 *   - depth : niveau d'imbrication (0 = racine)
 *   - type  : 'ul' ou 'ol'
 */
function _parseListItems(b) {
  if (b.richContent) {
    const tmp = document.createElement('div');
    tmp.innerHTML = b.richContent;
    const rootList = tmp.querySelector('ul, ol');
    if (rootList) {
      const items = [];
      const _walk = (listEl, depth) => {
        const listType = listEl.tagName.toLowerCase();
        for (const child of listEl.children) {
          if (child.tagName !== 'LI') continue;
          /* Cloner le li sans ses sous-listes pour extraire le texte direct */
          const liClone = child.cloneNode(true);
          liClone.querySelectorAll('ul, ol').forEach(sub => sub.remove());
          const runs = htmlToRuns(liClone.innerHTML || '');
          while (runs.length && runs[runs.length - 1].text === '\n') runs.pop();
          if (runs.some(r => r.text.trim() || r.noteId)) {
            items.push({ runs, depth, type: listType });
          }
          /* Sous-listes dans ce li */
          for (const sub of child.children) {
            if (sub.tagName === 'UL' || sub.tagName === 'OL') {
              _walk(sub, depth + 1);
            }
          }
        }
      };
      _walk(rootList, 0);
      if (items.length) return items;
    }
  }
  /* Fallback texte brut → liste plate de niveau 0 */
  return (b.content || '').split('\n').filter(l => l.trim())
    .map(l => ({ runs: [{ text: l.trim(), bold: false, italic: false, linkUrl: null }], depth: 0, type: b.type }));
}

function _syncRichFromDOM(b) {
  const ct = document.getElementById('ct-' + b.id); if (!ct) return;
  if (b.type === 'ul' || b.type === 'ol') {
    const lst = ct.querySelector('ul, ol');
    if (lst) {
      if (b.richContent) invalidateHtmlToRunsCache(b.richContent);
      b.richContent = lst.outerHTML;
      /* Texte brut : uniquement les li directs de chaque niveau (sans sous-listes) */
      b.content = [...lst.querySelectorAll('li')].map(li => {
        const clone = li.cloneNode(true);
        clone.querySelectorAll('ul, ol').forEach(s => s.remove());
        return clone.textContent;
      }).join('\n');
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

    /* Détecter si le curseur (avec ou sans sélection) est dans un <li> */
    const focusNode = sel?.focusNode;
    const focusEl = focusNode?.nodeType === Node.TEXT_NODE ? focusNode.parentElement : focusNode;
    const activeLi = focusEl?.closest('li[contenteditable]');

    if (activeLi) {
      /* Toujours afficher la barre quand on est dans un <li> */
      positionFmtBar();
      return;
    }

    if (!sel || sel.isCollapsed) { hideFmtBar(); return; }

    /* Vérifier que la sélection est dans un bloc rich */
    const anchor = sel.anchorNode;
    if (!anchor) { hideFmtBar(); return; }
    const el = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
    const ct = el?.closest('.fb-ct');
    if (!ct) { hideFmtBar(); return; }
    const blockId = ct.id.replace('ct-', '');
    const b = blockById(blockId);
    if (!b || !RICH_TYPES.has(b.type)) { hideFmtBar(); return; }

    positionFmtBar();
  }, 30);
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
  const b = blockById(sid);
  if (!b || !RICH_TYPES.has(b.type)) return;
  const active = document.activeElement;
  if (!active || !active.isContentEditable) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); applyFmt('bold'); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); applyFmt('italic'); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'u') { e.preventDefault(); applyFmt('underline'); }
}, true); // capture phase pour priorité

/* ── FONCTIONS SIMPLES — Pas d'abstraction ── */

function uid() { return 'b' + (++cnt); }
function labelForType(type) { return LABELS[type] || type; }
function getCanvasPage(pageIdx) { return document.getElementById('cpage-' + pageIdx); }
function docFont() { return (window.FONTS && window.FONTS.cssFamily) || "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"; }
function refreshBlockFonts() { blocks.forEach(b => { const ct = document.getElementById('el-' + b.id)?.querySelector('.fb-ct'); if (ct) { fillCt(ct, b); if (AUTO_HEIGHT_TYPES.has(b.type) && !b.manualHeight) requestAnimationFrame(() => _syncAutoHeight(b)); } }); }
/* ── Construit le DOM d'une page (label + div) sans l'attacher ni annoncer ── */
function _createCanvasPage(pageIdx) {
  if (!pageOrientations[pageIdx]) pageOrientations[pageIdx] = 'portrait';
  const label = Object.assign(document.createElement('div'), { className: 'page-label' });
  label.dataset.page = pageIdx;
  const pg = Object.assign(document.createElement('div'), { className: 'canvas-page', id: 'cpage-' + pageIdx });
  pg.style.isolation = 'isolate';
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


/* ONGLETS — motif ARIA Tabs, navigation clavier flèches + Home/End */
const tabBtns = [...document.querySelectorAll('.rtab')];
const tabNames = tabBtns.map(b => b.dataset.tab);

/* Effets de bord par onglet — évite les if séparés dans switchTab */
/* Effets de bord par onglet */
const TAB_EFFECTS = { ua: () => { updUA(); updTree(); }, bloc: updBP };

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
document.querySelectorAll('.bsrc').forEach(btn => {
  btn.addEventListener('dragstart', e => {
    if (btn.dataset.t === 'freeform') { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('btype', btn.dataset.t);
    if (btn.dataset.shape) e.dataTransfer.setData('bshape', btn.dataset.shape);
  });

  /* Alternative clavier : Entrée ajoute le bloc en haut de la page 1 */
  btn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const d = BLOCK_META[btn.dataset.t] || { w: 200, h: 60 };
      const x = pageW(0) / 2 - d.w / 2;
      const y = MAR + blocks.filter(b => Math.floor(b.y / PH) === 0).length * 24;
      const extra = btn.dataset.shape ? { shapeKind: btn.dataset.shape } : {};
      const newId = addBlock(btn.dataset.t, x, y, extra, { noFocus: false });
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
      const d = BLOCK_META[btn.dataset.t] || { w: 200, h: 60 };
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
      const d = BLOCK_META.freeform;
      const x = pageW(0) / 2 - d.w / 2;
      const y = MAR + 40;
      const newId = addBlock('freeform', x, y, {}, { noFocus: false });
      if (newId) requestAnimationFrame(() => startFreeformDraw(newId));
    });
  }
});

/* ── AJOUTER UN BLOC ── */
function addBlock(type, x, y, extraProps, { noFocus = true, noSelect = false } = {}) {
  snapshotState();
  const d = BLOCK_META[type] || { w: 200, h: 60 };
  const b = Object.assign(structuredClone(d), { id: uid(), type, x: Math.round(x), y: Math.round(y), order: blocks.length, content: d.content || '' }, extraProps || {});
  blocks.push(b);
  _blockMap_set(b);
  _invalidateOrdCache();
  getCanvasPage(Math.floor(b.y / PH))?.appendChild(buildEl(b));
  if (!noSelect) { sel(b.id, noFocus); switchTab('bloc'); }
  updUA(); updTree(); saveSession();
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
/* ── Libellé aria dynamique d'un bloc ── */
function _blockAriaLabel(b) {
  const pageIdx = Math.floor(b.y / PH) + 1;
  const pos = `page ${pageIdx}, x\u202f${Math.round(b.x)}\u202fpx, y\u202f${Math.round(b.y % PH)}\u202fpx`;
  const content = b.content ? ' — ' + b.content.replace(/\n/g, ' ').slice(0, 40) : '';
  return `${labelForType(b.type)}${content}. ${pos}. Entrée pour éditer, flèches pour déplacer.`;
}

/* ── Met à jour le aria-label du wrapper après déplacement ── */
function _updateBlockAriaLabel(b) {
  const w = document.getElementById('el-' + b.id);
  if (w) w.setAttribute('aria-label', _blockAriaLabel(b));
}

function buildEl(b) {
  const label = labelForType(b.type), localY = b.y % PH;
  const isDecorative = b.type === 'shape' || b.type === 'freeform';
  const isAutoH = AUTO_HEIGHT_TYPES.has(b.type) && !b.manualHeight;
  const wrapper = el('div', {
    cls: 'fb' + (isDecorative ? ' shape-block' : '') + (isAutoH ? ' fb-auto-h' : ''),
    style: `left:${b.x}px;top:${localY}px;width:${b.w}px;${isAutoH ? `min-height:${b.h || 28}px` : `height:${b.h}px`};z-index:${b.zIndex || 0}`,
    attrs: {
      id: 'el-' + b.id,
      tabindex: '0',
      role: 'group',
      'aria-label': _blockAriaLabel(b),
      'aria-selected': 'false',
    },
  });
  const bar = el('div', { cls: 'fb-bar' });
  const utagInfo = _utagForBlock(b);
  bar.append(
    el('span', { cls: 'fb-bar-lbl', text: label }),
    ...(utagInfo ? [utag(utagInfo[0], utagInfo[1])] : []),
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
  /* Synchroniser la hauteur après insertion dans le DOM */
  if (isAutoH) requestAnimationFrame(() => _syncAutoHeight(b));
  wrapper.addEventListener('mousedown', e => { if (e.target.closest('.fb-bar') || e.target === rsz) return; sel(b.id); });

  /* Clavier : focus sur le wrapper = sélection + déplacement aux flèches */
  wrapper.addEventListener('keydown', e => {

    /* 1. On protège la saisie : ne pas interférer si le focus est à l'intérieur d'un champ */
    const active = document.activeElement;
    const isInField = active && active !== wrapper &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' || active.isContentEditable);

    /* On sort immédiatement si l'utilisateur est en train d'écrire */
    if (isInField) return;

    /* 2. Entrée / Espace : sélectionner le bloc et basculer sur l'onglet Bloc.
          Exception : si le focus est sur un bouton de la barre (dup, del),
          laisser le comportement natif du bouton s'exécuter (click synthétique). */
    if (e.key === 'Enter' || e.key === ' ') {
      if (active && active.closest('.fb-dup, .fb-del')) return;
      e.preventDefault();
      sel(b.id);
      if (typeof switchTab === 'function') switchTab('bloc');
      return;
    }

    /* 3. Flèches : déplacer le bloc (délégué à moveBlockByKey dans editor-ui.js) */
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      if (typeof moveBlockByKey === 'function') moveBlockByKey(b.id, e.key, e.shiftKey, e.ctrlKey || e.metaKey);
    }
  });

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

/* CONSTANTES DE RENDU WYSIWYG↔PDF (pt) : 1pt CSS = 1pt PDF, page 794×1123 (A4@72dpi).
   BAR_H = barre de titre du bloc, CT_PAD = padding horizontal de .fb-ct */

/* ── CONTENU DES BLOCS — table de dispatch IHM ── */
/* Note : ASIDE_STYLES est défini dans constants.js */

/* ── Helper : crée un div contenteditable rich avec oninput → richContent ── */
/* AUTO-HAUTEUR : les blocs texte suivent leur contenu, sauf resize manuel (b.manualHeight) */
const AUTO_HEIGHT_TYPES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'quote', 'aside', 'note', 'link', 'code']);

function _syncAutoHeight(b) {
  if (!AUTO_HEIGHT_TYPES.has(b.type) || b.manualHeight) return;
  const wrapper = document.getElementById('el-' + b.id);
  if (!wrapper) return;
  const h = wrapper.offsetHeight;
  if (h > 0 && h !== b.h) {
    b.h = h;
    if (sid === b.id) {
      const bhEl = document.getElementById('bh');
      if (bhEl) bhEl.value = Math.round(h);
    }
  }
}

function _mkRichDiv(b, ariaLabel, style, className) {
  const t = document.createElement('div');
  t.contentEditable = 'true';
  t.setAttribute('role', 'textbox');
  t.setAttribute('aria-multiline', 'true');
  t.setAttribute('aria-label', ariaLabel);
  t.className = className || 'fb-rich-flow';
  if (style) t.style.cssText = style;
  if (b.richContent) t.innerHTML = b.richContent; else t.textContent = b.content || '';
  /* aria-placeholder expose le texte indicatif du data-ph aux lecteurs d'écran.
     Le pseudo-élément CSS ::before n'est pas lisible par les AT. */
  const phText = b.content || '';
  if (!phText) {
    const typeLabel = b.type ? (b.type.startsWith('h') ? 'Saisir le titre' : 'Saisir le texte') : 'Saisir du texte';
    t.setAttribute('aria-placeholder', typeLabel);
  }
  t.oninput = () => {
    invalidateHtmlToRunsCache(b.richContent);
    b.richContent = t.innerHTML;
    b.content = htmlToPlain(t.innerHTML);
    if (t.textContent.trim() === '') {
      if (!t.getAttribute('aria-placeholder')) t.setAttribute('aria-placeholder', 'Saisir du texte');
    } else {
      t.removeAttribute('aria-placeholder');
    }
    _syncAutoHeight(b);
  };
  t.onmousedown = e => e.stopPropagation();
  return t;
}

/* ── Table de correspondance type → badge utag ─────────────────────────
   Utilisée par buildEl pour insérer le badge dans la fb-bar.
   Le cas 'img' est dynamique (dépend de b.alt / b.imgLinkUrl) : calculé
   dans _utagForBlock(). */
const _UTAG_MAP = {
  h1: ['H1', 'u-h'], h2: ['H2', 'u-h'], h3: ['H3', 'u-h'],
  h4: ['H4', 'u-h'], h5: ['H5', 'u-h'], h6: ['H6', 'u-h'],
  p: ['P', 'u-p'],
  ul: ['UL', 'u-l'], ol: ['OL', 'u-l'],
  link: ['LINK', 'u-k'],
  table: ['TABLE', 'u-t'],
  quote: ['QUOTE', 'u-q'],
  note: ['NOTE', 'u-n'],
  hr: ['HR', 'u-sep'],
  aside: ['ASIDE', 'u-as'],
  code: ['CODE', 'u-cd'],
  shape: ['FORME', 'u-sh'], freeform: ['LIBRE', 'u-sh'], chart: ['GRAPHIQUE', 'u-ch'],
  'form-text': ['FORM', 'u-f'], 'form-textarea': ['FORM', 'u-f'],
  'form-checkbox': ['FORM', 'u-f'], 'form-radio': ['FORM', 'u-f'],
  'form-select': ['FORM', 'u-f'],
};

function _utagForBlock(b) {
  if (b.type === 'img') {
    if (b.imgLinkUrl) return ['LINK', 'u-k'];
    if (b.alt) return ['IMG', 'u-i'];
    return ['DECO', 'u-d'];
  }
  return _UTAG_MAP[b.type] || null;
}

const FILL_CT = {

  'form-text'(ct, b) {
    ct.className += ' fb-form-ct';
    const inputId = 'preview-inp-' + b.id;
    const lbl = document.createElement('label');
    lbl.className = 'fb-form-lbl';
    lbl.style.fontFamily = docFont();
    lbl.htmlFor = inputId; // Association au champ
    lbl.textContent = (b.formLabel || 'Libellé') + (b.formRequired ? ' *' : '');
    const inp = document.createElement('input');
    inp.id = inputId; // Affectation de l'ID
    inp.type = 'text';
    inp.placeholder = b.formPlaceholder || '';
    inp.value = b.formDefaultValue || ''; inp.readOnly = true;
    inp.className = 'fb-form-input';
    inp.style.fontFamily = docFont();
    if (b.formReadonly) inp.dataset.readonly = 'true';
    ct.append(lbl, inp);
  },

  'form-textarea'(ct, b) {
    ct.className += ' fb-form-ct';
    const inputId = 'preview-ta-' + b.id;
    const lbl = document.createElement('label');
    lbl.className = 'fb-form-lbl';
    lbl.style.fontFamily = docFont();
    lbl.htmlFor = inputId;
    lbl.textContent = (b.formLabel || 'Libellé') + (b.formRequired ? ' *' : '');
    const ta = document.createElement('textarea');
    ta.id = inputId;
    ta.placeholder = b.formPlaceholder || ''; ta.value = b.formDefaultValue || ''; ta.readOnly = true;
    ta.className = 'fb-form-textarea';
    ta.style.fontFamily = docFont();
    if (b.formReadonly) ta.dataset.readonly = 'true';
    ct.append(lbl, ta);
  },

  'form-checkbox'(ct, b) {
    ct.className += ' fb-form-ct--checkbox';
    const box = document.createElement('span');
    box.className = 'fb-checkbox-box' + (b.formChecked ? ' fb-checkbox-box--checked' : '');
    if (b.formChecked) box.innerHTML = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='16' height='16' aria-hidden='true'><path fill='#f5f5fe' d='M10 15.17l9.2-9.2 1.4 1.42L10 18l-6.36-6.36 1.4-1.42z'/></svg>`;
    const lbl = document.createElement('span');
    lbl.className = 'fb-form-lbl--light';
    lbl.style.fontFamily = docFont();
    lbl.textContent = (b.formLabel || 'Case à cocher') + (b.formRequired ? ' *' : '');
    ct.append(box, lbl);
  },

  'form-radio'(ct, b) {
    ct.className += ' fb-form-ct--radio';
    const grpLbl = document.createElement('span');
    grpLbl.className = 'fb-form-lbl';
    grpLbl.style.fontFamily = docFont();
    grpLbl.textContent = (b.formLabel || 'Groupe') + (b.formRequired ? ' *' : '');
    ct.appendChild(grpLbl);
    (b.formOptions || 'Option 1\nOption 2').split('\n').filter(o => o.trim()).forEach(opt => {
      const row = document.createElement('label');
      row.className = 'fb-radio-row';
      row.style.fontFamily = docFont();
      const circ = document.createElement('span');
      circ.className = 'fb-radio-circle';
      row.append(circ, document.createTextNode(opt.trim()));
      ct.appendChild(row);
    });

  },

  'form-select'(ct, b) {
    ct.className += ' fb-form-ct';
    const lbl = document.createElement('label');
    lbl.className = 'fb-form-lbl';
    lbl.style.fontFamily = docFont();
    lbl.textContent = (b.formLabel || 'Libellé') + (b.formRequired ? ' *' : '');

    /* Wrapper positionné pour superposer la zone chevron */
    const wrap = document.createElement('div');
    wrap.className = 'fb-select-wrap';

    /* Zone texte principale */
    const textZone = document.createElement('div');
    const opts = (b.formOptions || 'Choix 1\nChoix 2').split('\n').filter(o => o.trim());
    const displayVal = b.formDefaultValue && opts.includes(b.formDefaultValue)
      ? b.formDefaultValue : (opts[0] || '');
    textZone.className = 'fb-select-text';
    textZone.style.fontFamily = docFont();
    if (b.formReadonly) textZone.dataset.readonly = 'true';
    textZone.textContent = displayVal;

    /* Zone chevron séparée (32px) */
    const chevZone = document.createElement('div');
    chevZone.className = 'fb-select-chev';
    chevZone.innerHTML = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='#161616' width='14' height='14' aria-hidden='true'><path d='M12 13.1l5-4.9 1.4 1.4L12 15.9l-6.4-6.4L7 8.1z'/></svg>`;

    wrap.append(textZone, chevZone);
    ct.append(lbl, wrap);

  },


  _heading(ct, b) {
    /* On utilise un <div> neutre (pas de <h1>…<h6>) pour ne pas polluer
       la hiérarchie sémantique de l'IHM — le vrai tag hX n'existe que dans le PDF produit.
       Note : on ne force pas font-weight:700 ici pour permettre le toggle gras inline. */
    ct.appendChild(_mkRichDiv(b,
      labelForType(b.type) + ' — contenu éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS[b.type]}px;font-family:${docFont()}`,
      'fb-rich-heading'
    ));

  },

  p(ct, b) {
    const indent = b.textIndent ? `text-indent:${b.textIndent}px;` : '';
    ct.appendChild(_mkRichDiv(b,
      'Paragraphe — contenu éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS.p}px;font-family:${docFont()};${indent}`,
      'fb-rich-flow'
    ));

  },

  _list(ct, b) {
    const rootTag = b.type;
    const lst = document.createElement(rootTag);
    lst.className = 'list-preview fb-rich';
    lst.setAttribute('aria-label', (rootTag === 'ul' ? 'Liste à puces' : 'Liste numérotée') + ' — utilisez les boutons Indenter / Désindenter de la barre de mise en forme pour gérer les niveaux');

    /* ── Modèle plat ↔ DOM imbriqué ──────────────────────────────────────
       En interne, la liste est manipulée comme un tableau plat
       [{ html, depth }] (bien plus simple à indenter/dédenter/insérer/
       supprimer qu'une arborescence), puis reconstruite en <ul>/<ol>
       imbriqués. Règle commune (comme Word) : la profondeur d'un item ne
       peut jamais dépasser "profondeur du précédent + 1". ── */

    const flatten = () => {
      const items = [];
      (function walk(listEl, depth) {
        for (const li of listEl.children) {
          if (li.tagName !== 'LI') continue;
          const clone = li.cloneNode(true);
          clone.querySelectorAll('ul, ol').forEach(s => s.remove());
          items.push({ html: clone.innerHTML || '<br>', depth });
          for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') walk(sub, depth + 1);
        }
      })(lst, 0);
      return items;
    };

    const rebuild = items => {
      lst.innerHTML = '';
      const stack = [lst], refs = [];
      items.forEach((item, i) => {
        const depth = i === 0 ? 0 : Math.min(item.depth, stack.length);
        while (stack.length > depth + 1) stack.pop();
        if (stack.length === depth) { const sub = document.createElement(rootTag); refs[i - 1].appendChild(sub); stack.push(sub); }
        const li = document.createElement('li');
        li.contentEditable = 'true';
        li.innerHTML = item.html || '<br>';
        attachLi(li);
        stack[stack.length - 1].appendChild(li);
        refs.push(li);
      });
      return refs;
    };

    /* Place le curseur en fin (ou début) de texte d'un <li> */
    const focusLi = (li, toEnd = true) => {
      if (!li) return;
      const textNode = [...li.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
      const range = document.createRange();
      if (toEnd && textNode) range.setStart(textNode, textNode.length);
      else range.setStart(li, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      li.focus();
    };

    const syncContent = () => {
      b.richContent = lst.outerHTML;
      b.content = [...lst.querySelectorAll('li')].map(li => {
        const clone = li.cloneNode(true);
        clone.querySelectorAll('ul, ol').forEach(s => s.remove());
        return clone.textContent;
      }).join('\n');
      _syncAutoHeight(b);
      if (typeof saveSession === 'function') saveSession();
    };

    const indexOf = li => [...lst.querySelectorAll('li')].indexOf(li);

    /* Applique une transformation au modèle plat pour le <li> ciblé, puis
       reconstruit le DOM et repositionne le curseur.
       fn(items, i) peut renvoyer explicitement `false` pour annuler (rien
       n'est changé). focusAt(i) donne l'index à refocaliser après coup. */
    const mutate = (li, fn, focusAt = i => i, toEnd = true) => {
      const items = flatten();
      const i = indexOf(li);
      if (i < 0 || fn(items, i) === false) return false;
      const refs = rebuild(items);
      focusLi(refs[focusAt(i)], toEnd);
      syncContent();
      return true;
    };

    /* ── Indenter/dédenter — exposés sur lst pour la barre de mise en forme ── */
    lst._doIndent = li => mutate(li, (items, i) =>
      (i === 0 || items[i].depth >= items[i - 1].depth + 1) ? false : void items[i].depth++);
    lst._doDedent = li => mutate(li, (items, i) =>
      items[i].depth === 0 ? false : void items[i].depth--);
    lst._canIndent = li => { const items = flatten(), i = indexOf(li); return i > 0 && items[i].depth < items[i - 1].depth + 1; };
    lst._canDedent = li => { const items = flatten(), i = indexOf(li); return i >= 0 && items[i].depth > 0; };

    const attachLi = li => {
      li.onmousedown = e => e.stopPropagation();
      li.oninput = syncContent;
      li.onkeydown = e => {
        /* Tab/Shift+Tab volontairement inutilisés (WCAG 2.1.1 — pas de piège
           clavier) : le retrait passe exclusivement par les boutons → / ←
           de la barre de mise en forme. */

        if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          const sel = window.getSelection();
          if (!sel?.rangeCount) return;
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const br = document.createElement('br');
          range.insertNode(br);
          const after = document.createRange();
          after.setStartAfter(br); after.collapse(true);
          sel.removeAllRanges(); sel.addRange(after);
          syncContent();
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          /* Le nouvel item hérite de la profondeur du <li> courant */
          mutate(li, (items, i) => { items.splice(i + 1, 0, { html: '<br>', depth: items[i].depth }); }, i => i + 1, false);
          return;
        }

        if (e.key === 'Backspace') {
          const isEmpty = li.textContent.trim() === '' && !li.querySelector('sup') && !li.querySelector('ul, ol');
          if (!isEmpty) return;
          e.preventDefault();
          mutate(li, (items, i) => {
            if (items[i].depth > 0) { items[i].depth--; return; }      // item vide indenté → dédenter
            if (items.length <= 1) return false;                       // dernier item : rien à faire
            items.splice(i, 1);                                        // item vide à la racine → supprimer
          }, i => Math.max(0, i - 1), false);
        }
      };
    };

    const rebuildLi = () => {
      if (b.richContent) {
        const tmp = document.createElement('div');
        tmp.innerHTML = b.richContent;
        const srcList = tmp.querySelector('ul, ol');
        if (srcList && srcList.children.length) {
          lst.innerHTML = srcList.innerHTML;
          /* Normaliser via le modèle plat : corrige toute incohérence de
             profondeur héritée d'un ancien contenu (ou d'un bug antérieur). */
          const items = flatten();
          let prevDepth = -1;
          items.forEach(it => { it.depth = Math.max(0, Math.min(it.depth, prevDepth + 1)); prevDepth = it.depth; });
          rebuild(items);
          return;
        }
      }
      const lines = (b.content || '').split('\n').filter(l => l.trim() !== '');
      rebuild((lines.length ? lines : ['']).map(line => ({ html: line || '<br>', depth: 0 })));
    };

    rebuildLi();
    lst.style.fontSize = (b.fontSize || FS.list) + 'px';
    lst.style.fontFamily = docFont();
    lst.classList.toggle('list-no-bullet', !!b.listNoBullet);
    ct.appendChild(lst);
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
    chooseBtn.className = 'fb-img-choose';
    chooseBtn.setAttribute('aria-label', 'Choisir une image');
    chooseBtn.onclick = e => { e.stopPropagation(); fi.click(); };
    ph.style.position = 'relative';
    ph.appendChild(fi); ph.appendChild(chooseBtn);
    /* Badge lien image — contour bleu si linkUrl défini */
    ph.style.outline = b.imgLinkUrl ? '2px solid #1d4ed8' : '';
    ph.style.outlineOffset = b.imgLinkUrl ? '-2px' : '';
    if (b.imgLinkUrl) {
      const badge = Object.assign(document.createElement('span'), { textContent: '↗ lien' });
      badge.className = 'fb-img-link-badge';
      badge.setAttribute('aria-hidden', 'true');
      ph.appendChild(badge);
    }
    ct.appendChild(ph);
    /* Tag structurel : Link>Figure si lien, Figure si alt, Artifact sinon */
    const imgTag = b.imgLinkUrl ? 'LINK' : (b.alt ? 'IMG' : 'DECO');
    const imgCls = b.imgLinkUrl ? 'u-k' : (b.alt ? 'u-i' : 'u-d');
    if (b.alt || b.imgLinkUrl) {
      const ad = document.createElement('p');
      const hasAlt = !!b.alt;
      ad.className = 'fb-img-alt ' + (hasAlt ? 'fb-img-alt--has-alt' : 'fb-img-alt--link-only');
      ad.textContent = (b.imgLinkUrl ? '↗ ' + b.imgLinkUrl.slice(0, hasAlt ? 28 : 40) + (hasAlt ? '  |  ' : '') : '') +
        (hasAlt ? 'alt : ' + b.alt : '');
      ct.appendChild(ad);
    }
  },

  link(ct, b) {
    const a = Object.assign(document.createElement('div'), { textContent: b.linkText || 'Lien' });
    a.className = 'fb-link-preview';
    a.setAttribute('aria-label', 'Lien : ' + (b.linkText || b.linkUrl || 'sans texte'));
    ct.appendChild(a);

  },

  table(ct, b) {
    const tbl = document.createElement('table');
    tbl.setAttribute('aria-label', 'Tableau éditable');
    tbl.className = 'fb-table-el fb-table-resizable';
    tbl.style.fontFamily = docFont();
    tbl.style.fontSize = (b.fontSize || FS.table) + 'px';
    tbl.style.tableLayout = 'fixed';
    tbl.style.width = '100%';

    /* Initialiser tableColWidths si absent ou incohérent */
    const colCount = Math.max(...(b.tableData || [[]]).map(r => r.length), 1);
    if (!Array.isArray(b.tableColWidths) || b.tableColWidths.length !== colCount) {
      b.tableColWidths = Array(colCount).fill(1);
    }

    /* <colgroup> pour le layout fixe */
    const cg = document.createElement('colgroup');
    const totalW = b.tableColWidths.reduce((s, w) => s + w, 0) || colCount;
    b.tableColWidths.forEach(w => {
      const col = document.createElement('col');
      col.style.width = ((w / totalW) * 100).toFixed(2) + '%';
      cg.appendChild(col);
    });
    tbl.appendChild(cg);

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
        td.className = 'fb-table-cell ' + (isHdr ? 'fb-table-cell--head' : 'fb-table-cell--body');
        td.oninput = () => { b.tableData[ri][ci] = td.textContent; };
        td.onmousedown = e => e.stopPropagation();
        tr.appendChild(td);
      });
    });
    const mkTableBtn = (label, ariaLabel, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sb fb-table-btn';
      btn.textContent = label;
      btn.setAttribute('aria-label', ariaLabel);
      btn.onclick = e => { e.stopPropagation(); onClick(); const c = document.getElementById('ct-' + b.id); if (c) fillCt(c, b); };
      return btn;
    };
    const addRowBtn = mkTableBtn('+ Ligne', 'Ajouter une ligne au tableau', () => {
      b.tableData.push(b.tableData[0].map(() => ''));
      b.tableColWidths = null;
      announce('Ligne ajoutée au tableau.');
    });
    const addColBtn = mkTableBtn('+ Colonne', 'Ajouter une colonne au tableau', () => {
      b.tableData.forEach(row => row.push(''));
      b.tableColWidths = null;
      announce('Colonne ajoutée au tableau.');
    });
    const btnWrap = document.createElement('div');
    btnWrap.className = 'fb-table-btns';
    btnWrap.append(addRowBtn, addColBtn);
    ct.appendChild(tbl); ct.appendChild(btnWrap);


    /* Attacher les poignées de redimensionnement de colonnes */
    _attachColResizers(tbl, b);
  },

  quote(ct, b) {
    const wrap = document.createElement('div');
    wrap.className = 'fb-quote-wrap';

    const txt = _mkRichDiv(b,
      'Citation — texte éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS.quote}px;font-family:${docFont()}`,
      'fb-rich-flow fb-rich-quote'
    );

    const src = document.createElement('div');
    src.contentEditable = 'true';
    src.setAttribute('role', 'textbox');
    src.setAttribute('aria-label', 'Source / auteur de la citation — éditable');
    src.setAttribute('data-ph', '— Auteur, Œuvre');
    src.className = 'fb-quote-src';
    src.style.fontFamily = docFont();
    src.textContent = b.quoteSource || '';
    src.oninput = () => { b.quoteSource = src.textContent.trim(); saveSession(); };
    src.onmousedown = e => e.stopPropagation();

    wrap.appendChild(txt); wrap.appendChild(src);
    ct.appendChild(wrap);
  },

  note(ct, b) {
    const wrap = document.createElement('div');
    wrap.className = 'fb-note-wrap';
    const ref = document.createElement('sup');
    ref.className = 'fb-note-ref';
    ref.style.color = LINK_COLOR;
    ref.style.fontFamily = docFont();
    ref.textContent = b.noteRef || '1';
    const txt = _mkRichDiv(b,
      'Note — texte éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS.note}px;font-family:${docFont()}`,
      'fb-rich-flow fb-rich-note'
    );
    wrap.appendChild(ref); wrap.appendChild(txt);
    ct.appendChild(wrap);
    /* Indicateur de lien vers le bloc ancre (si note ancrée) */
    if (b.anchorBlockId) {
      const anchorHint = document.createElement('div');
      anchorHint.className = 'fb-note-anchor-hint';
      anchorHint.textContent = '\u2191 Aller \u00e0 l\u2019ancre dans le texte';
      anchorHint.title = 'Cliquer pour sélectionner le bloc texte parent';
      anchorHint.onclick = e => { e.stopPropagation(); sel(b.anchorBlockId); switchTab('bloc'); };
      ct.appendChild(anchorHint);
    }

  },

  hr(ct) {
    const line = Object.assign(document.createElement('div'), { ariaHidden: 'true' });
    line.className = 'fb-hr-line';
    line.setAttribute('aria-hidden', 'true');
    ct.appendChild(line);

  },

  aside(ct, b) {
    const style = b.asideStyle || 'info';
    const st = ASIDE_STYLES[style];
    const wrap = document.createElement('div');
    wrap.className = 'fb-aside-wrap fb-aside-wrap--' + style;
    const icon = document.createElement('span');
    icon.className = 'fb-aside-icon fb-aside-icon--' + style;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = st.icon;
    const txt = _mkRichDiv(b,
      'Encadré — contenu éditable. Sélectionner du texte pour le mettre en forme.',
      `font-size:${b.fontSize || FS.aside}px;font-family:${docFont()}`,
      'fb-rich-flow fb-rich-aside'
    );
    wrap.appendChild(icon); wrap.appendChild(txt);
    ct.appendChild(wrap);
  },

  code(ct, b) {
    const pre = document.createElement('pre');
    pre.className = 'ua-code fb-code-pre';

    const code = document.createElement('code');
    code.contentEditable = 'true';
    code.setAttribute('aria-label', 'Bloc de code — contenu éditable');
    code.className = 'fb-code-el';
    code.style.fontSize = FS.code + 'px';

    code.textContent = b.content || '';
    code.oninput = () => { b.content = code.textContent; _syncAutoHeight(b); };
    code.onmousedown = e => e.stopPropagation();

    pre.appendChild(code);
    ct.appendChild(pre);

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
    svg.innerHTML = (SHAPE_RENDERERS[b.shapeKind || 'circle'] || SHAPE_RENDERERS.circle).svg(w, h);

    svg.querySelectorAll('ellipse,path,polygon,rect').forEach(el => {
      if (fillNone) el.setAttribute('fill', 'none');
      if (hasBorder) {
        el.setAttribute('stroke', b.shapeBorderColor || '#1d4ed8');
        el.setAttribute('stroke-width', b.shapeBorderWidth || 2);
        el.setAttribute('stroke-linejoin', 'round');
        el.setAttribute('paint-order', 'stroke');
      }
    });

    ct.appendChild(svg);
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
function sel(id, noFocus = false) {
  /* Retirer la sélection du bloc précédent sans querySelectorAll global */
  if (sid && sid !== id) {
    const prevWrapper = document.getElementById('el-' + sid);
    prevWrapper?.classList.remove('sel');
    prevWrapper?.setAttribute('aria-selected', 'false');
  }
  sid = id;
  const wrapper = document.getElementById('el-' + id);
  wrapper?.classList.add('sel');
  /* Exposer l'état "sélectionné" aux AT via aria-selected */
  wrapper?.setAttribute('aria-selected', 'true');
  /* Déplacer le focus clavier sur le wrapper, sauf si noFocus est vrai
     (cas du chargement initial, pour ne pas voler le focus à la page). */
  if (!noFocus && wrapper && !wrapper.contains(document.activeElement)) {
    wrapper.focus({ preventScroll: true });
  }
  updBP();
}

function desel() {
  if (sid) {
    const prevWrapper = document.getElementById('el-' + sid);
    prevWrapper?.classList.remove('sel');
    prevWrapper?.setAttribute('aria-selected', 'false');
  }
  sid = null;
  _updBP_lastSid = null; _updBP_lastKey = '';
  $('bp-none').style.display = 'block';
  $('bp-fields').style.display = 'none';
}


/* RENUMÉROTATION DES NOTES : parcourt les blocs riches en ordre de lecture puis
   les <sup> DOM, renumérote les blocs note et met à jour sup + titres */
function renumberNotes() {
  /* ── 1. Numéroter dans l'ordre de lecture — réutilise ordB() (déjà trié) ── */
  const readOrder = ordB();

  let counter = 0;
  readOrder.forEach(b => {
    if (!RICH_TYPES.has(b.type)) return;
    const ct = document.getElementById('ct-' + b.id);
    if (!ct) return;
    const sups = ct.querySelectorAll('sup[data-note-id]');
    if (!sups.length) return;
    let changed = false;
    sups.forEach(sup => {
      const noteId = sup.dataset.noteId;
      const noteBlock = blockById(noteId);
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
      changed = true;
    });
    /* Synchroniser richContent une seule fois après tous les sups du bloc */
    if (changed) _syncRichFromDOM(b);
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
      const anchorBlock = blockById(b.anchorBlockId);
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
  blocks.filter(b => Math.floor(b.y / PH) === idx).forEach(b => { _removeNoteAnchor(b); _blockMap_delete(b.id); document.getElementById('el-' + b.id)?.remove(); });
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
    _pageLabelCache[i] = ''; // invalider le cache label pour les pages réindexées
    _updatePageLabel(i);
  }
  if (sid && !blockById(sid)) desel();
  rebuildGridOverlays(); updUA(); updTree(); saveSession();
  announce('Page ' + (idx + 1) + ' supprimée. Ctrl+Z pour annuler.');
}
/* ── Helper : retire le <sup> d'ancre dans le bloc parent d'une note ── */
function _removeNoteAnchor(b) {
  if (b.type !== 'note' || !b.anchorBlockId) return;
  const parent = blockById(b.anchorBlockId); if (!parent) return;
  document.getElementById('ct-' + parent.id)?.querySelector('sup[data-note-id="' + b.id + '"]')?.remove();
  _syncRichFromDOM(parent);
}

function rmB(id) {
  snapshotState();
  const b = blockById(id);
  if (b) _removeNoteAnchor(b);
  blocks = blocks.filter(x => x.id !== id);
  _blockMap_delete(id);
  _invalidateOrdCache();
  document.getElementById('el-' + id)?.remove();
  if (sid === id) desel();
  /* Recalculer la numérotation dès qu'il reste des notes (ou qu'on vient d'en supprimer une) */
  if (blocks.some(x => x.type === 'note') || b?.type === 'note') renumberNotes();
  else _repositionNotes();
  updUA(); updTree(); saveSession();
  announce('Bloc ' + (b ? labelForType(b.type) : 'bloc') + ' supprimé. Ctrl+Z pour annuler.');
}

function dupB(id) {
  snapshotState();
  const orig = blockById(id); if (!orig) return;
  const copy = JSON.parse(JSON.stringify({ ...orig, _bmNode: undefined }));
  copy.id = uid(); copy.x = orig.x + 16; copy.y = orig.y + 16; copy.order = blocks.length;
  blocks.push(copy);
  _blockMap_set(copy);
  _invalidateOrdCache();
  getCanvasPage(Math.floor(copy.y / PH))?.appendChild(buildEl(copy));
  sel(copy.id); updUA(); updTree(); saveSession();
  announce('Bloc dupliqué.');
}

function bprop(k, v) {
  const b = blockById(sid); if (!b) return;
  b[k] = v;
  b._v = (b._v || 0) + 1; // invalide le cache _bpKey en O(1)
  _updBP_lastKey = '';     // forcer le re-fill au prochain updBP
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

function rr(id) {
  const b = blockById(id); if (!b) return;
  const c = document.getElementById('ct-' + b.id);
  if (c) { fillCt(c, b); if (AUTO_HEIGHT_TYPES.has(b.type) && !b.manualHeight) requestAnimationFrame(() => _syncAutoHeight(b)); }
  /* Mettre à jour le badge utag dans la barre (tag peut changer pour img) */
  const wrapper = document.getElementById('el-' + b.id);
  if (wrapper) {
    const existing = wrapper.querySelector('.fb-bar .utag');
    const info = _utagForBlock(b);
    if (existing && info) { existing.textContent = info[0]; existing.className = 'utag ' + info[1]; }
  }
}

function applyPos() {
  const b = blockById(sid); if (!b) return;
  const isDecorative = b.type === 'shape' || b.type === 'freeform' || b.type === 'hr';
  const mar = isDecorative ? 0 : MAR;
  const oldPageIdx = Math.floor(b.y / PH);
  const rawX = parseInt(document.getElementById('bx').value) || 0;
  const rawY = parseInt(document.getElementById('by').value) || 0;
  const pageIdx = Math.floor(rawY / PH);
  b.x = isDecorative ? rawX : Math.max(mar, Math.min(pageW(pageIdx) - mar - b.w, rawX));
  b.y = isDecorative ? rawY : Math.max(pageIdx * PH + mar, rawY);
  b._v = (b._v || 0) + 1;
  const domEl = document.getElementById('el-' + b.id);
  if (domEl) {
    domEl.style.left = b.x + 'px'; domEl.style.top = (b.y % PH) + 'px';
    const newPageIdx = Math.floor(b.y / PH);
    if (newPageIdx !== oldPageIdx) getCanvasPage(newPageIdx)?.appendChild(domEl);
  }
}

function applySz() {
  const b = blockById(sid); if (!b) return;
  const isDecorative = b.type === 'shape' || b.type === 'freeform' || b.type === 'hr';
  const mar = isDecorative ? 0 : MAR;
  const minW = isDecorative ? 1 : 80;
  const minH = isDecorative ? 1 : 28;
  const maxW = pageW(Math.floor(b.y / PH)) - mar - b.x;
  b.w = Math.max(minW, Math.min(maxW, parseInt(document.getElementById('bw').value) || minW));
  b.h = Math.max(minH, parseInt(document.getElementById('bh').value) || minH);
  b._v = (b._v || 0) + 1;
  const domEl = document.getElementById('el-' + b.id);
  if (domEl) { domEl.style.width = b.w + 'px'; domEl.style.height = b.h + 'px'; }
}

function qa(d) {
  const b = blockById(sid); if (!b) return;
  const pageIdx = Math.floor(b.y / PH), pw = pageW(pageIdx);
  const ALIGN = { l: () => ({ x: MAR }), r: () => ({ x: pw - MAR - b.w }), c: () => ({ x: Math.round((pw - b.w) / 2) }), t: () => ({ y: pageIdx * PH + MAR }) };
  Object.assign(b, ALIGN[d]?.());
  const domEl = document.getElementById('el-' + b.id);
  if (domEl) { domEl.style.left = b.x + 'px'; domEl.style.top = (b.y % PH) + 'px'; }
  updBP();
}

/* Gestion des calques (z-index visuel, indépendant de l'ordre de lecture PDF) */
function chZ(d) {
  const b = blockById(sid); if (!b) return;
  snapshotState();
  const next = (b.zIndex || 0) + d;
  b.zIndex = Math.max(-1, next);
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
  const b = blockById(sid); if (!b) return;
  snapshotState();
  const sorted = ordB();
  const i = sorted.findIndex(x => x.id === sid);
  const j = i + d; if (j < 0 || j >= sorted.length) return;
  const o = sorted[j];
  const tmp = b.order; b.order = o.order; o.order = tmp;
  _invalidateOrdCache();
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
  _invalidateOrdCache();
  updTree(); updBP(); saveSession();
  announce('Ordre de lecture synchronisé sur la position des blocs.');
}

/* PANEL_BINDINGS — table déclarative des panneaux conditionnels : { panel, types, fill(b) } */
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
    panel: 'bp-indent',
    types: ['p'],
    fill: b => {
      const inp = $('btextindent');
      if (inp) inp.value = b.textIndent != null ? b.textIndent : 0;
      const lbl = $('btextindent-val');
      if (lbl) lbl.textContent = (b.textIndent || 0) + ' pt';
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
 * Peuple un conteneur div avec un sélecteur couleur.
 * Si le sélecteur existe déjà (même id), met à jour sa valeur.
 */
function _fillColorWrap(wrapperId, selectId, value, propKey) {
  const wrap = $(wrapperId);
  if (!wrap) return;
  let sel = $(selectId);
  if (sel) {
    /* Mettre à jour la valeur existante */
    const resolved = paletteClosest(value);
    sel.value = resolved;
    const swatch = $(selectId + '-swatch');
    if (swatch) swatch.style.background = resolved;
  } else {
    /* Créer le sélecteur la première fois */
    wrap.innerHTML = '';
    const widget = makeColorSelect(selectId, value, hex => {
      bprop(propKey, hex);
      rr(sid);
    });
    wrap.appendChild(widget);
  }
}

/* Cache pour updBP : on ne re-remplit les panneaux que si le bloc sélectionné ou ses
   données ont changé. La clé est un snapshot JSON léger des champs susceptibles de varier. */
let _updBP_lastSid = null;
let _updBP_lastKey = '';

/* ── Cache invalidation du panneau de propriétés ──
   Au lieu de concaténer ~35 champs en string à chaque updBP(),
   on utilise un compteur de version b._v incrémenté dans bprop().
   La clé devient "<id>|<_v>|<blocks.length>|<readPos>" — O(1) à construire. */
function _bpKey(b) {
  if (!b) return '';
  const readPos = ordB().findIndex(x => x.id === b.id);
  return `${b.id}|${b._v ?? 0}|${blocks.length}|${readPos}`;
}

function updBP() {
  const b = blockById(sid);
  $('bp-none').style.display = b ? 'none' : 'block';
  const _zLbl = $('z-level-lbl'); if (_zLbl && b) _zLbl.textContent = getZLabel(b.zIndex || 0);
  $('bp-fields').style.display = b ? 'block' : 'none';
  if (!b) {
    /* Annoncer la désélection */
    const sa = $('sel-announce');
    if (sa) sa.textContent = '';
    _updBP_lastSid = null; _updBP_lastKey = '';
    return;
  }

  const pageNum = Math.floor(b.y / PH) + 1;
  const readPos = ordB().findIndex(x => x.id === b.id) + 1;

  /* Mise à jour légère toujours effectuée (géométrie + position lecture) */
  $('bx').value = Math.round(b.x); $('by').value = Math.round(b.y);
  $('bw').value = Math.round(b.w); $('bh').value = Math.round(b.h);
  $('oi').textContent = `Page ${pageNum} — Position lecture : ${readPos} / ${blocks.length}`;

  /* Annonce AT uniquement au changement de sélection */
  if (_updBP_lastSid !== sid) {
    const sa = $('sel-announce');
    if (sa) {
      const label = labelForType(b.type);
      const preview = b.content ? ' : ' + b.content.replace(/\n/g, ' ').slice(0, 40) : '';
      sa.textContent = `${label}${preview} sélectionné — page ${pageNum}, position ${readPos} sur ${blocks.length}.`;
    }
  }

  /* Panneaux contextuels : re-remplir uniquement si la clé a changé */
  const currentKey = _bpKey(b);
  if (currentKey !== _updBP_lastKey) {
    PANEL_BINDINGS.forEach(({ panel, types, fill }) => { const on = types.includes(b.type); $(panel).style.display = on ? 'block' : 'none'; if (on) fill(b); });
    _updBP_lastKey = currentKey;
  }
  _updBP_lastSid = sid;
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

  /* Construire le HTML en une passe, une seule écriture DOM.
     Sémantique liste pour les AT (role list/listitem), visuel inchangé (.ua-item). */
  const items = chks.map(ck => {
    const status = ck.ok ? 'ua-ok' : ck.warn ? 'ua-warn' : 'ua-err';
    const label = ck.ok ? 'Conforme : ' : (ck.warn ? 'Avertissement : ' : 'Non conforme : ');
    return `<li class="ua-item ${status}">` +
      `<span class="sr-only">${label}</span><span>${ck.l}</span></li>`;
  }).join('');
  document.getElementById('ual').innerHTML = `<ul class="ua-list">${items}</ul>`;
  window._patchUABadge?.();
}

/* ── ARBRE DES TAGS ── */

/* Table de description pour chaque type dans l'arbre de structure */
const TREE_LABELS = {};
['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(t => { TREE_LABELS[t] = b => ({ tg: t.toUpperCase(), co: (b.content || '').slice(0, 26) }); });
Object.assign(TREE_LABELS, {
  p: b => ({ tg: 'P', co: htmlToPlain(b.richContent || b.content || '').slice(0, 26) }),
  ul: b => ({ tg: 'L(ul)', co: b.richContent ? (b.richContent.match(/<li/gi) || []).length + ' items' : (b.content || '').split('\n').filter(l => l.trim()).length + ' items' }),
  ol: b => ({ tg: 'L(ol)', co: b.richContent ? (b.richContent.match(/<li/gi) || []).length + ' items' : (b.content || '').split('\n').filter(l => l.trim()).length + ' items' }),
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
    n.innerHTML = `<span aria-hidden="true" style="color:#9ca3af">${String(i + 1).padStart(2, '0')} </span><span class="tg" aria-hidden="true">&lt;${tg}&gt;</span> <span class="tc" aria-hidden="true">${_esc(co)}</span>`;
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

/* Cache fingerprint pour updTree : on ne reconstruit l'arbre DOM que si la
   structure du document a changé (types, contenu, ordre, nombre de blocs). */
let _treeLastKey = '';
function _updTreeCached() {
  const s = ordB();
  const key = s.map(b =>
    `${b.id}:${b.type}:${(b.content || '').slice(0, 20)}:${b.alt ?? ''}:` +
    `${b.linkText ?? ''}:${b.noteRef ?? ''}:${b.asideStyle ?? ''}:` +
    `${b.shapeKind ?? ''}:${b.chartKind ?? ''}:${(b.pathPoints || []).length}`
  ).join('|');
  if (key === _treeLastKey) return;
  _treeLastKey = key;
  _updTree();
}

updUA = () => { clearTimeout(_uaTimer); _uaTimer = setTimeout(_updUA, 150); };
updTree = () => { clearTimeout(_treeTimer); _treeTimer = setTimeout(_updTreeCached, 150); };

/* ADAPTATIONS TACTILES — touch events, zoom canvas, tiroir mobile (≤1100px ou pointer:coarse) */
/* BOTTOM SHEET (≤640px), piloté par innerWidth (pas matchMedia, pour DevTools mobile) :
   tap/swipe bas sur .ptabs bascule ; switchTab()/sel() ouvrent ; clic fond canvas
   ou resize > 640px ferment */
(function initBottomSheet() {
  const _panel = document.getElementById('panel');
  const _ptabs = document.querySelector('.ptabs');
  const _vp = document.getElementById('viewport');

  /* ── Primitives ──
     On teste window.innerWidth plutôt qu'une matchMedia : les DevTools mobiles
     du navigateur redimensionnent le viewport (innerWidth), mais window.matchMedia
     continue d'évaluer la largeur physique de la fenêtre hôte.
     Le seuil 640 correspond au breakpoint CSS @media (max-width: 640px). */
  function _isActive() { return window.innerWidth <= 640; }
  function _isOpen() { return _panel ? _panel.classList.contains('sheet-open') : false; }

  function openSheet() {
    if (_panel && _isActive()) _panel.classList.add('sheet-open');
  }
  function closeSheet() {
    if (_panel) _panel.classList.remove('sheet-open');
  }

  /* ── Tap / clic sur la poignée : fonctionne souris ET tactile ── */
  let _swipeStartY = null;
  let _swipeMoved = false;

  if (_ptabs) {
    /* Touch */
    _ptabs.addEventListener('touchstart', e => {
      _swipeStartY = e.touches[0].clientY;
      _swipeMoved = false;
    }, { passive: true });

    _ptabs.addEventListener('touchmove', e => {
      if (_swipeStartY === null) return;
      if (Math.abs(e.touches[0].clientY - _swipeStartY) > 8) _swipeMoved = true;
    }, { passive: true });

    _ptabs.addEventListener('touchend', e => {
      if (_swipeStartY === null) return;
      const dy = e.changedTouches[0].clientY - _swipeStartY;
      _swipeStartY = null;
      if (!_isActive()) return;
      if (dy > 60) { closeSheet(); return; }   /* swipe bas  */
      if (!_swipeMoved) { _isOpen() ? closeSheet() : openSheet(); } /* tap */
    }, { passive: true });

    /* Clic souris (DevTools mobile, desktop narrow) */
    _ptabs.addEventListener('click', e => {
      /* Ne pas interférer avec un clic sur un onglet lui-même (géré par switchTab) */
      if (e.target.closest('.rtab')) return;
      if (!_isActive()) return;
      _isOpen() ? closeSheet() : openSheet();
    });
  }

  /* ── Clic / tap sur le fond du canvas → fermeture ── */
  function _onViewportClick(e) {
    if (!_isActive()) return;
    if (e.target === _vp ||
      e.target.id === 'page-wrap' ||
      e.target.classList.contains('canvas-page')) {
      closeSheet();
    }
  }
  if (_vp) {
    _vp.addEventListener('click', _onViewportClick);
    _vp.addEventListener('touchend', _onViewportClick, { passive: true });
  }

  /* ── Patch switchTab : ouvre le panneau à chaque changement d'onglet ── */
  const _origSwitchTab = switchTab;
  switchTab = function (name) {
    _origSwitchTab(name);
    openSheet();
  };

  /* ── Patch sel() : ouvre le panneau à chaque sélection de bloc ── */
  const _origSel = sel;
  sel = function (id, noFocus) {
    _origSel(id, noFocus);
    openSheet();
  };

  /* ── Quand on repasse > 640px : fermer proprement ──
     resize est fiable pour innerWidth (fonctionne aussi avec les DevTools). */
  window.addEventListener('resize', () => {
    if (!_isActive()) closeSheet();
  }, { passive: true });

})();

(function initMobile() {

  const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches ||
    ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const IS_NARROW = window.innerWidth <= 1100;

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
    const getB = () => blockById(elId());

    /* Barre titre → déplacement */
    const bar = fbEl.querySelector('.fb-bar');
    if (bar) _addTouchToHandle(bar, {
      guard: e => !!e.target?.closest?.('.fb-del, .fb-dup'),
      onStart: e => { const b = getB(); if (!b) return null; sel(b.id); snapshotState(); fbEl.classList.add('moving'); return { sx: e.clientX, sy: e.clientY, ox: b.x, oy: b.y, b }; },
      onMove: (e, ctx) => {
        if (!ctx?.b) return; const { sx, sy, ox, oy, b } = ctx;
        const pi = Math.floor(b.y / PH);
        const _isDecorative = b.type === 'shape' || b.type === 'freeform' || b.type === 'hr';
        const _mar = _isDecorative ? 0 : MAR;
        const _newX = ox + (e.clientX - sx);
        b.x = snapVal(_isDecorative ? _newX : Math.max(_mar, Math.min(pageW(pi) - _mar - b.w, _newX)));
        const _newY = oy + (e.clientY - sy);
        b.y = snapVal(Math.max(pi * PH + (_isDecorative ? 0 : _mar), _newY));
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
        const mar = isDecorative ? 0 : MAR;
        const minW = isDecorative ? 1 : 80;
        const minH = isDecorative ? 1 : 28;
        b.w = Math.max(minW, Math.min(pageW(Math.floor(b.y / PH)) - mar - b.x, snapVal(sw + (e.clientX - sx))));
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

  /* ── 3. SCROLL AUTOMATIQUE vers le bloc sélectionné ──

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
    const vp = document.getElementById('viewport');
    if (!vp) return;
    const avail = vp.clientWidth - 48;
    const z = Math.max(
      ZMIN,
      Math.min(ZMAX, avail / PW)
    );
    applyZoom(z);
  }

  /* Barre flottante +/−/⟳ */
  const zBar = document.createElement('div');
  zBar.id = 'mob-zoom-bar';
  zBar.setAttribute('role', 'toolbar');
  zBar.setAttribute('aria-label', 'Niveau de zoom');

  const mkZBtn = (label, txt, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mob-zoom-btn'; b.setAttribute('aria-label', label); b.textContent = txt;
    b.addEventListener('click', fn);
    return b;
  };
  const zLbl = document.createElement('span');
  zLbl.id = 'mob-zoom-lbl';
  zLbl.textContent = '100%';
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
  window.addEventListener('load', autoZoom);
  window.addEventListener('resize', autoZoom);
  window.addEventListener('orientationchange', () => {
    setTimeout(autoZoom, 300);
  });

  requestAnimationFrame(autoZoom);

  /* ── 6. BANNIÈRE INFO — première visite sur mobile ── */
  if (IS_TOUCH && window.matchMedia('(max-width: 768px)').matches && !sessionStorage.getItem('mob_ok')) {
    const ban = document.createElement('div');
    ban.id = 'mob-info-banner';
    ban.setAttribute('role', 'alert');
    ban.innerHTML = '📱 <strong>Mode mobile</strong> — tapez un bloc dans la barre latérale pour l\'ajouter. Pincez le canvas pour zoomer.';
    const cls = document.createElement('button');
    cls.type = 'button'; cls.className = 'mob-info-banner-close'; cls.setAttribute('aria-label', 'Fermer'); cls.textContent = '×';
    cls.addEventListener('click', () => { ban.remove(); sessionStorage.setItem('mob_ok', '1'); });
    ban.appendChild(cls); document.body.appendChild(ban);
  }

})(); /* fin initMobile */

/* INIT PANEL LISTENERS — branche les listeners du panneau droit (Bloc/Méta/Export/Grille),
   appelée depuis init.js une fois le DOM prêt */
function initPanelListeners() {
  const g = id => document.getElementById(id);
  const on = (id, evt, fn) => g(id)?.addEventListener(evt, fn);

  /* ── Méta ── */
  on('m-title', 'input', () => updUA());
  on('m-lang', 'change', () => updUA());
  on('m-font', 'change', function () { window.loadFont(this.value).catch(err => console.error(err)); });

  /* ── Grille ── */
  on('grid-snap', 'change', function () { toggleGrid(this.checked, undefined, undefined); });
  on('grid-show', 'change', function () { toggleGrid(undefined, this.checked, undefined); });
  on('grid-size', 'change', function () { toggleGrid(undefined, undefined, parseInt(this.value)); });

  /* ── Géométrie ── */
  on('bx', 'input', () => applyPos());
  on('by', 'input', () => applyPos());
  on('bw', 'input', () => applySz());
  on('bh', 'input', () => applySz());

  /* ── Typographie ── */
  on('bfontsize', 'input', function () {
    bprop('fontSize', this.value ? +this.value : undefined); rr(sid);
  });
  document.querySelector('#bp-fontsize .sb[title="Remettre la taille par défaut"]')
    ?.addEventListener('click', () => { bprop('fontSize', undefined); g('bfontsize').value = ''; rr(sid); });

  /* ── Alignement ── */
  const alignRow = g('lbl-align');
  if (alignRow) {
    const dirs = ['l', 'c', 'r', 't'];
    [...alignRow.querySelectorAll('.sb')].forEach((btn, i) => btn.addEventListener('click', () => qa(dirs[i])));
  }

  /* ── Ordre de lecture ── */
  (function () {
    /* Remonter depuis #oi jusqu'au .brow frère précédent */
    const oiEl = g('oi');
    const brow = oiEl?.closest('.ps')?.querySelector('.brow');
    if (brow) {
      const [btnUp, btnDown] = brow.querySelectorAll('.sb');
      btnUp?.addEventListener('click', () => chOrd(-1));
      btnDown?.addEventListener('click', () => chOrd(1));
    }
    on('btn-sync-order', 'click', () => syncOrderToPosition());
  })();

  /* ── Calque ── */
  (function () {
    const zEl = g('z-level-lbl');
    const brow = zEl?.closest('.ps')?.querySelector('.brow');
    if (brow) {
      const [btnUp, btnDown] = brow.querySelectorAll('.sb');
      btnUp?.addEventListener('click', () => chZ(1));
      btnDown?.addEventListener('click', () => chZ(-1));
    }
  })();

  /* ── Image ── */
  on('bav', 'input', function () { bprop('alt', this.value); });
  on('bimglink', 'input', function () { bprop('imgLinkUrl', this.value); rr(sid); });

  /* ── Lien ── */
  on('blt', 'input', function () { bprop('linkText', this.value); });
  on('blu', 'input', function () { bprop('linkUrl', this.value); });

  /* ── Retrait de première ligne ── */
  on('btextindent', 'input', function () {
    g('btextindent-val').textContent = this.value + ' pt';
    bprop('textIndent', parseInt(this.value)); rr(sid);
  });

  /* ── Liste ── */
  on('blistnobullet', 'change', function () { bprop('listNoBullet', this.checked); rr(sid); });

  /* ── Titre ── */
  on('bhlv', 'change', function () { bprop('type', this.value); rr(sid); });

  /* ── Signet ── */
  on('bbookmark', 'change', function () { bprop('bookmark', this.checked); });

  /* ── Citation ── */
  on('bqsrc', 'input', function () { bprop('quoteSource', this.value); });

  /* ── Note ── */
  on('bnref', 'input', function () { bprop('noteRef', this.value); });

  /* ── Formulaire ── */
  on('bform-label', 'input', function () { bprop('formLabel', this.value); rr(sid); });
  on('bform-placeholder', 'input', function () { bprop('formPlaceholder', this.value); rr(sid); });
  on('bform-default', 'input', function () { bprop('formDefaultValue', this.value); rr(sid); });
  on('bform-options', 'input', function () { bprop('formOptions', this.value); rr(sid); });
  on('bform-checked', 'change', function () { bprop('formChecked', this.checked); rr(sid); });
  on('bform-required', 'change', function () { bprop('formRequired', this.checked); rr(sid); });
  on('bform-readonly', 'change', function () { bprop('formReadonly', this.checked); rr(sid); });

  /* ── Encadré ── */
  on('basidestyle', 'change', function () { bprop('asideStyle', this.value); rr(sid); });

  /* ── Forme décorative ── */
  on('bshapekind', 'change', function () { bprop('shapeKind', this.value); rr(sid); });
  on('bshapetransparent', 'change', function () { bprop('shapeFillNone', this.checked); rr(sid); });
  on('bshapeopacity', 'input', function () {
    g('bshapeopacity-val').textContent = Math.round(this.value * 100) + '%';
    bprop('shapeOpacity', parseFloat(this.value)); rr(sid);
  });
  on('bshaperotation', 'input', function () {
    g('bshaperotation-val').textContent = this.value + '°';
    bprop('shapeRotation', parseInt(this.value)); rr(sid);
  });
  on('bshapeborder', 'change', function () { bprop('shapeBorderEnabled', this.checked); rr(sid); });
  on('bshapeborderwidth', 'input', function () {
    g('bshapeborderwidth-val').textContent = this.value + 'px';
    bprop('shapeBorderWidth', parseInt(this.value)); rr(sid);
  });

  /* ── Forme libre ── */
  on('bffopacity', 'input', function () {
    g('bffopacity-val').textContent = Math.round(this.value * 100) + '%';
    bprop('shapeOpacity', parseFloat(this.value)); rr(sid);
  });
  on('bffrotation', 'input', function () {
    g('bffrotation-val').textContent = this.value + '°';
    bprop('shapeRotation', parseInt(this.value)); rr(sid);
  });
  on('bffstroke', 'input', function () {
    g('bffstroke-val').textContent = this.value + 'px';
    bprop('strokeWidth', parseInt(this.value)); rr(sid);
  });
  on('bfffill', 'change', function () { bprop('shapeFilled', this.checked); rr(sid); });
  on('bffclosed', 'change', function () { bprop('pathClosed', this.checked); rr(sid); });
  document.querySelector('#bp-freeform .sb-full')?.addEventListener('click', () => editFreeformPath(sid));

  /* ── Graphique ── */
  on('bchartkind', 'change', function () { bprop('chartKind', this.value); rr(sid); });
  on('bcharttitle', 'input', function () { bprop('chartTitle', this.value); rr(sid); });
  on('bchartalt', 'input', function () { bprop('alt', this.value); });
  on('bchartadd', 'click', () => chartAddRow());

  /* ── Export ── */
  on('pg-enabled', 'change', () => updUA());
  on('toc-enabled', 'change', () => updUA());
}
