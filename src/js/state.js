// state.js — État global, historique undo/redo, session, projet, grille

// État global du document
let blocks = [];           // liste de tous les blocs
let sid = null;            // id du bloc sélectionné
let cnt = 0;               // compteur d'id
let numPages = 1;          // nombre de pages A4 créées
let pageOrientations = ['portrait']; // orientation par index de page ['portrait'|'landscape', …]


function _isLandscape(idx) { return (pageOrientations[idx] || 'portrait') === 'landscape'; }
function pageW(idx) { return _isLandscape(idx) ? PH : PW; }
function pageH(idx) { return _isLandscape(idx) ? PW : PH; }

/* Appliquer l'orientation CSS d'une page canvas */
function applyPageOrientation(pg, idx) {
  if (!pg) return;
  [pg.style.width, pg.style.height] = _isLandscape(idx) ? [PH + 'px', PW + 'px'] : [PW + 'px', PH + 'px'];
}

/* Basculer l'orientation d'une page et mettre à jour l'IHM */
function togglePageOrientation(idx) {
  pageOrientations[idx] = _isLandscape(idx) ? 'portrait' : 'landscape';
  const pg = document.getElementById('cpage-' + idx);
  if (pg) applyPageOrientation(pg, idx);
  _updatePageLabel(idx);
  rebuildGridOverlays();
  saveSession();
  announce('Page ' + (idx + 1) + ' : ' + (pageOrientations[idx] === 'landscape' ? 'paysage' : 'portrait') + '.');
}

function _updatePageLabel(idx) {
  const isLand = _isLandscape(idx);
  const label = pageWrap.querySelector(`.page-label[data-page="${idx}"]`);
  if (!label) return;
  label.innerHTML = '';
  label.appendChild(el('span', { text: 'Page ' + (idx + 1) }));
  label.appendChild(el('button', {
    cls: 'page-orient-btn',
    html: isLand ? '⬜ Paysage' : '▭ Portrait',
    attrs: { type: 'button', title: isLand ? 'Basculer en portrait' : 'Basculer en paysage', 'aria-label': 'Orientation de la page ' + (idx + 1) + ' : ' + (isLand ? 'paysage' : 'portrait') + '. Cliquer pour changer.' },
    on: { click: e => { e.stopPropagation(); togglePageOrientation(idx); } },
  }));
  if (idx > 0) {
    label.appendChild(el('button', {
      cls: 'page-delete-btn', text: '✕',
      attrs: { type: 'button', title: 'Supprimer la page ' + (idx + 1), 'aria-label': 'Supprimer la page ' + (idx + 1) },
      on: {
        click: e => {
          e.stopPropagation();
          if (blocks.some(b => Math.floor(b.y / PH) === idx) &&
            !confirm('La page ' + (idx + 1) + ' contient des blocs qui seront supprimés. Continuer ?')) return;
          deletePage(idx);
        }
      },
    }));
  }
}


const History = {
  _stack: [], _lock: false, MAX_DEPTH: 50,
  snapshot() {
    if (this._lock) return;
    try {
      const c = _cleanBlocks();
      this._stack.push({ blocks: structuredClone(c), cnt });
      if (this._stack.length > this.MAX_DEPTH) this._stack.shift();
    } catch { }
  },
  undo() {
    if (!this._stack.length) { announce('Aucune action à annuler.'); return; }
    const prev = this._stack.pop();
    this._lock = true;
    blocks.forEach(b => document.getElementById('el-' + b.id)?.remove());
    blocks = prev.blocks; cnt = prev.cnt;
    _ordCacheKey = ''; // invalider le cache de tri après réassignation de blocks
    const maxPage = blocks.reduce((m, b) => Math.max(m, Math.floor(b.y / PH)), 0);
    while (numPages <= maxPage) addCanvasPage();
    blocks.forEach(b => { const pg = getCanvasPage(Math.floor(b.y / PH)); if (pg) pg.appendChild(buildEl(b)); });
    sid = null; desel(); updUA(); updTree(); saveSession();
    this._lock = false;
    announce('Action annulée.');
  },
};

// Alias pour garder la compatibilité avec le reste du code
function snapshotState() { History.snapshot(); }
function undoLast() { History.undo(); }

// Grille magnétique 
let gridEnabled = false;   // magnétisme actif ?
let gridVisible = false;   // affichage de la grille ?
let gridSize = 20;      // taille de la cellule (px)
let gridOverlays = [];      // éléments canvas de grille
let _gridLastState = '';    // cache : évite de tout redessiner si rien ne change

function snapVal(v) { return gridEnabled ? Math.round(v / gridSize) * gridSize : v; }
function snapPt(x, y) { return { x: snapVal(x), y: snapVal(y) }; }
function applyGridToEl(el, b) { el.style.left = b.x + 'px'; el.style.top = (b.y % PH) + 'px'; }

function rebuildGridOverlays() {
  /* Clé d'état : si visible + taille + orientations n'ont pas changé, rien à faire */
  const stateKey = `${gridVisible}|${gridSize}|${numPages}|${pageOrientations.join(',')}`;
  if (stateKey === _gridLastState && gridOverlays.length > 0) return;
  _gridLastState = stateKey;

  /* Supprimer les anciens overlays */
  gridOverlays.forEach(o => o.remove());
  gridOverlays = [];
  if (!gridVisible) return;

  const dpr = window.devicePixelRatio || 1;
  const TWO_PI = Math.PI * 2;

  document.querySelectorAll('.canvas-page').forEach(pg => {
    const pageIdx = parseInt(pg.dataset.page) || 0;
    const cw = pageW(pageIdx);
    const ch = pageH(pageIdx);

    const canvas = document.createElement('canvas');
    /* Taille physique = taille CSS × dpr → rendu net sur écrans Retina */
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.cssText =
      `position:absolute;inset:0;pointer-events:none;z-index:1;opacity:0.45;` +
      `width:${cw}px;height:${ch}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#6366f1';
    ctx.fillStyle = '#6366f1';
    ctx.lineWidth = 0.5;

    /* Une seule passe : lignes verticales + points sur chaque intersection */
    for (let x = 0; x <= cw; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
      for (let y = 0; y <= ch; y += gridSize) {
        ctx.beginPath(); ctx.arc(x, y, 1, 0, TWO_PI); ctx.fill();
      }
    }
    /* Lignes horizontales (points déjà tracés ci-dessus) */
    for (let y = 0; y <= ch; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }

    pg.appendChild(canvas);
    gridOverlays.push(canvas);
  });
}

function toggleGrid(enabled, visible, size) {
  if (enabled !== undefined) gridEnabled = enabled;
  if (visible !== undefined) gridVisible = visible;
  if (size !== undefined) gridSize = size;
  _gridLastState = ''; // invalider le cache pour forcer le redessinage
  rebuildGridOverlays();
  [['grid-snap', 'checked', gridEnabled], ['grid-show', 'checked', gridVisible], ['grid-size', 'value', gridSize]]
    .forEach(([id, prop, val]) => { const e = document.getElementById(id); if (e) e[prop] = val; });
}

/* ── Helpers ── */
function _cleanBlocks() { return blocks.map(b => { const c = { ...b }; delete c._bmNode; return c; }); }
function _collectMeta() { const g = id => document.getElementById(id)?.value || ''; return { title: g('m-title'), author: g('m-author'), subject: g('m-subject'), lang: g('m-lang'), font: g('m-font') }; }

// Sauvegarde de session dans le navigateur
const SESSION_KEY = 'pdfua_editor_v1';

/* Debounce interne : évite les sauvegardes multiples sur oninput rapides */
let _saveTimer = null;
function saveSession() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const meta = _collectMeta();
      const cleanBlocks = _cleanBlocks();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ blocks: cleanBlocks, cnt, meta, pageOrientations }));
    } catch { /* quota dépassé ou désactivé */ }
  }, 80);
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.blocks)) return false;
    blocks = saved.blocks; cnt = saved.cnt || 0;
    _ordCacheKey = '';
    if (Array.isArray(saved.pageOrientations)) { pageOrientations = saved.pageOrientations; }
    if (saved.meta) {
      ['title', 'author', 'subject', 'lang'].forEach(k => { const e = document.getElementById('m-' + k); if (e && saved.meta[k]) e.value = saved.meta[k]; });
    }
    return true;
  } catch { return false; }
}

function _restorePages() {
  for (let i = 0; i < numPages; i++) { applyPageOrientation(document.getElementById('cpage-' + i), i); _updatePageLabel(i); }
}

function restoreSessionBlocks() {
  const maxPage = blocks.reduce((m, b) => Math.max(m, Math.floor(b.y / PH)), 0);
  while (numPages <= maxPage) addCanvasPage();
  _restorePages();
  blocks.forEach(b => { const pg = getCanvasPage(Math.floor(b.y / PH)); if (pg) pg.appendChild(buildEl(b)); });
  _reattachNoteAnchors();
}

function _reattachNoteAnchors() {
  blocks.forEach(b => {
    if (!RICH_TYPES.has(b.type)) return;
    const editEl = getRichEditEl(b.id); if (!editEl) return;
    editEl.querySelectorAll('sup[data-note-id]').forEach(sup => {
      const noteId = sup.dataset.noteId;
      sup.style.cssText = `color:${LINK_COLOR};cursor:pointer;font-size:0.65em`;
      sup.onclick = e => { e.stopPropagation(); sel(noteId); switchTab('bloc'); };
      const noteBlock = blocks.find(x => x.id === noteId);
      if (noteBlock) sup.title = 'Note ' + (noteBlock.noteRef || '') + ' — cliquer pour sélectionner';
    });
  });
}

// Sauvegarde et ouverture de projets (.pdfua)
// Format : JSON compressé en gzip contenant l'état du document
const PROJECT_VERSION = 1;
const PROJECT_EXT = '.pdfua';

// Sérialiser l'état courant en objet
function _projectSnapshot() {
  return {
    v: PROJECT_VERSION,
    meta: _collectMeta(),
    blocks: _cleanBlocks(),
    cnt,
    grid: { enabled: gridEnabled, visible: gridVisible, size: gridSize },
    pageOrientations: [...pageOrientations],
  };
}

// Compresser en gzip (ou JSON brut en fallback)
/* ── Helper : lit tous les chunks d'un ReadableStream en Uint8Array ── */
async function _readStream(readable) {
  /* Response.arrayBuffer() est natif et évite l'itération manuelle des chunks */
  return new Uint8Array(await new Response(readable).arrayBuffer());
}

async function _compress(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') return bytes;
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(bytes); w.close();
  return _readStream(cs.readable);
}

// Décompresser en gzip
async function _decompress(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return JSON.parse(new TextDecoder().decode(await _readStream(ds.readable)));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Sauvegarde du projet
async function saveProject() {
  try {
    const snapshot = _projectSnapshot();
    const title = (snapshot.meta.title || 'document').replace(/[^a-z0-9_\-]/gi, '_');
    const url = URL.createObjectURL(new Blob([await _compress(snapshot)], { type: 'application/octet-stream' }));
    Object.assign(document.createElement('a'), { href: url, download: title + PROJECT_EXT }).click();
    URL.revokeObjectURL(url);
    announce('Projet sauvegardé — ' + title + PROJECT_EXT);
  } catch (e) { announce('Erreur lors de la sauvegarde : ' + e.message); }
}

// Ouverture d'un projet
async function openProject(input) {
  const file = input?.files?.[0]; if (!file) return;
  input.value = '';
  try {
    const project = await _decompress(await file.arrayBuffer());
    if (!project || typeof project.v === 'undefined') { announce('Fichier invalide — impossible de lire le projet.'); return; }
    if (project.v > PROJECT_VERSION) { announce('Ce fichier a été créé avec une version plus récente de l\'éditeur.'); return; }

    History.snapshot();
    blocks.forEach(b => document.getElementById('el-' + b.id)?.remove());
    document.querySelectorAll('.canvas-page').forEach((pg, i) => { if (i > 0) pg.remove(); });
    document.querySelectorAll('.page-label').forEach((l, i) => { if (i > 0) l.remove(); });
    blocks = []; cnt = 0; numPages = 1; pageOrientations = ['portrait']; sid = null;
    _ordCacheKey = '';

    if (project.meta) ['title', 'author', 'subject', 'lang', 'font'].forEach(k => { const e = document.getElementById('m-' + k); if (e && project.meta[k]) e.value = project.meta[k]; });
    if (project.grid) toggleGrid(project.grid.enabled, project.grid.visible, project.grid.size || 20);
    if (Array.isArray(project.pageOrientations)) pageOrientations = project.pageOrientations;

    blocks = project.blocks || []; cnt = project.cnt || 0;
    _ordCacheKey = '';
    const maxPage = blocks.reduce((m, b) => Math.max(m, Math.floor(b.y / PH)), 0);
    while (numPages <= maxPage) addCanvasPage();
    _restorePages();
    blocks.forEach(b => { const pg = getCanvasPage(Math.floor(b.y / PH)); if (pg) pg.appendChild(buildEl(b)); });

    desel(); updUA(); updTree(); saveSession();
    announce('Projet ouvert — ' + (project.meta?.title || file.name));
  } catch (e) { announce('Erreur lors de l\'ouverture : ' + e.message); console.error(e); }
}
