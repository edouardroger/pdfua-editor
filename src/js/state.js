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

/* ── Validation d'URL — bloque javascript:, data:, vbscript: etc.
   Utilisé par confirmLink (blocks.js), bprop, _validateImportedBlock et openProject.
   Défini ici (state.js) car ce fichier est chargé en premier. ── */
function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase().replace(/[\u200b-\u200d\ufeff\u00ad]/g, '');
  /* Rejeter tout schéma dangereux connu */
  if (/^(javascript|vbscript|data|blob):/i.test(trimmed)) return false;
  /* N'autoriser que http, https et mailto */
  return /^(https?:|mailto:)/i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('.');
}

// Sauvegarde de session dans le navigateur
const SESSION_KEY = 'pdfua_editor_v1';

/* ── Liste blanche des types de blocs valides ── */
const _ALLOWED_BLOCK_TYPES = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol',
  'img', 'link', 'table', 'quote', 'note', 'hr', 'aside', 'code',
  'shape', 'freeform', 'chart',
  'form-text', 'form-textarea', 'form-checkbox', 'form-radio', 'form-select',
]);
const _ALLOWED_ORIENTATIONS = new Set(['portrait', 'landscape']);

/* ── Validation et nettoyage d'un bloc importé (projet ou sessionStorage) ──
   • Rejette les blocs dont le type est inconnu
   • Sanitise richContent via _sanitizeRichContent (définie dans blocks.js,
     appelée uniquement après son chargement — ok car loadSession/openProject
     ne sont appelées qu'au runtime, bien après le chargement de blocks.js)
   • Valide les URLs (linkUrl, imgLinkUrl)
   • Garantit que les champs numériques sont bien des nombres
   Retourne le bloc nettoyé, ou null si le bloc est invalide. ── */
function _validateImportedBlock(b) {
  if (!b || typeof b !== 'object') return null;
  if (!_ALLOWED_BLOCK_TYPES.has(b.type)) return null;

  const clean = { ...b };

  /* Champs numériques */
  for (const k of ['x', 'y', 'w', 'h', 'order', 'zIndex', 'fontSize',
    'textIndent', 'shapeOpacity', 'shapeRotation', 'strokeWidth', 'shapeBorderWidth']) {
    if (clean[k] !== undefined) clean[k] = Number(clean[k]) || 0;
  }

  /* Champs booléens */
  for (const k of ['formRequired', 'formReadonly', 'formChecked', 'shapeFillNone',
    'shapeBorderEnabled', 'shapeFilled', 'pathClosed', 'listNoBullet', 'bookmark']) {
    if (clean[k] !== undefined) clean[k] = Boolean(clean[k]);
  }

  /* Champs texte — forcer string, tronquer à 10 000 caractères */
  for (const k of ['content', 'alt', 'linkText', 'noteRef', 'quoteSource',
    'formLabel', 'formPlaceholder', 'formDefaultValue', 'formOptions',
    'chartTitle', 'shapeColor', 'shapeBorderColor', 'asideStyle',
    'chartKind', 'shapeKind']) {
    if (clean[k] !== undefined) clean[k] = String(clean[k]).slice(0, 10000);
  }

  /* id : alphanumérique uniquement */
  if (clean.id !== undefined) clean.id = String(clean.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

  /* URLs — valider avec isSafeUrl */
  for (const k of ['linkUrl', 'imgLinkUrl']) {
    if (clean[k] && !isSafeUrl(clean[k])) clean[k] = '';
  }

  /* imgData — n'accepter que data:image/... ou URL https (pas javascript:, pas data:text…) */
  if (clean.imgData !== undefined) {
    const d = String(clean.imgData);
    const isDataImage = /^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp|ico);base64,/i.test(d);
    const isHttps = /^https:\/\//i.test(d);
    if (!isDataImage && !isHttps) clean.imgData = null;
  }

  /* richContent — sanitiser via _sanitizeRichContent si disponible */
  if (clean.richContent) {
    clean.richContent = typeof _sanitizeRichContent === 'function'
      ? _sanitizeRichContent(clean.richContent)
      : String(clean.richContent).slice(0, 200000); // fallback conservatif si appelé très tôt
  }

  /* tableData — forcer tableau de tableaux de strings */
  if (clean.tableData !== undefined) {
    if (!Array.isArray(clean.tableData)) { clean.tableData = []; }
    else clean.tableData = clean.tableData.slice(0, 200).map(row =>
      Array.isArray(row) ? row.slice(0, 50).map(c => String(c ?? '').slice(0, 1000)) : []
    );
  }

  /* chartData — valider chaque série */
  if (clean.chartData !== undefined) {
    if (!Array.isArray(clean.chartData)) { clean.chartData = []; }
    else clean.chartData = clean.chartData.slice(0, 50).map(d => ({
      label: String(d?.label ?? '').slice(0, 200),
      value: Number(d?.value) || 0,
      color: typeof d?.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(d.color) ? d.color : '#000091',
      pattern: String(d?.pattern ?? 'solid').replace(/[^a-z0-9_]/g, '').slice(0, 20),
    }));
  }

  /* pathPoints — valider chaque point */
  if (clean.pathPoints !== undefined) {
    if (!Array.isArray(clean.pathPoints)) { clean.pathPoints = []; }
    else clean.pathPoints = clean.pathPoints.slice(0, 5000).map(p => {
      if (!p || typeof p !== 'object') return null;
      const pt = { x: Number(p.x) || 0, y: Number(p.y) || 0 };
      if (p.cp1 && typeof p.cp1 === 'object') pt.cp1 = { x: Number(p.cp1.x) || 0, y: Number(p.cp1.y) || 0 };
      if (p.cp2 && typeof p.cp2 === 'object') pt.cp2 = { x: Number(p.cp2.x) || 0, y: Number(p.cp2.y) || 0 };
      return pt;
    }).filter(Boolean);
  }

  return clean;
}

/* Debounce interne : évite les sauvegardes multiples sur oninput rapides */
let _saveTimer = null;
function saveSession() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const meta = _collectMeta();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        v: PROJECT_VERSION,
        blocks: blocks.map(_serializeBlock),
        meta,
        pageOrientations: pageOrientations.slice(0, MAX_PAGES),
      }));
    } catch { /* quota dépassé ou désactivé */ }
  }, 80);
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.blocks)) return false;
    /* Valider et sanitiser chaque bloc avant restauration.
       La session peut être d'une version antérieure — appliquer les migrations. */
    const fileVersion = typeof saved.v === 'number' ? saved.v : 1;
    blocks = saved.blocks
      .map(b => _migrateBlock(b, fileVersion))
      .map(_validateImportedBlock)
      .filter(Boolean)
      .map((b, i) => { b.order = i; return b; });

    /* Recalculer cnt depuis les ids — ne pas le restaurer depuis le stockage (point 3) */
    cnt = blocks.reduce((max, b) => {
      const n = parseInt(String(b.id).replace(/^b/, ''), 10);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);

    _ordCacheKey = '';

    /* Borner pageOrientations à MAX_PAGES (point 6) */
    if (Array.isArray(saved.pageOrientations)) {
      pageOrientations = saved.pageOrientations
        .slice(0, MAX_PAGES)
        .map(o => _ALLOWED_ORIENTATIONS.has(o) ? o : 'portrait');
    }
    if (saved.meta && typeof saved.meta === 'object') {
      ['title', 'author', 'subject', 'lang'].forEach(k => {
        const e = document.getElementById('m-' + k);
        if (e && saved.meta[k] && typeof saved.meta[k] === 'string') e.value = saved.meta[k].slice(0, 500);
      });
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
const PROJECT_VERSION = 2;
const PROJECT_EXT = '.pdfua';

/* ── Limite de pages : protège contre l'import de fichiers forgés ── */
const MAX_PAGES = 50;

/* ══════════════════════════════════════════════════════════════════════════
   FORMAT DE FICHIER .pdfua v2 — Enveloppe binaire
   ──────────────────────────────────────────────────────────────────────────

   Objectifs (points 2 et 5) :
     • Séparer les données binaires (imgData base64) du JSON :
       - JSON réduit, auditable en texte, compressible efficacement
       - Images stockées en binaire natif (gain ~25% vs base64, ~35% après gzip)
     • Garantir l'intégrité avec un hash SHA-256 sur l'ensemble du contenu.
     • Rétrocompatibilité avec les anciens fichiers gzip purs (v1).

   Structure binaire du fichier .pdfua v2 :
   ┌──────────────────────────────────────────────────────────────────────┐
   │ HEADER                                                               │
   │   magic       4 B  : 0x50 0x44 0x55 0x41  ("PDUA")                  │
   │   fmtVer      1 B  : 0x02                                            │
   │   hash       32 B  : SHA-256(jsonGzip ‖ data₀ ‖ data₁ ‖ … ‖ dataₙ) │
   │ JSON                                                                 │
   │   jsonLen     4 B  : uint32 BE — longueur du JSON gzippé             │
   │   jsonGzip    N B  : JSON UTF-8 gzippé (sans les imgData)            │
   │ ASSETS                                                               │
   │   assetCount  2 B  : uint16 BE — nombre d'assets (0..65535)          │
   │   Pour chaque asset i :                                              │
   │     idLen     2 B  : uint16 BE — longueur de l'id (max 200 B)        │
   │     id        * B  : UTF-8 — id du bloc propriétaire                 │
   │     mimeLen   1 B  : longueur du type MIME (max 64 B)                │
   │     mime      * B  : UTF-8 — ex. "image/png"                         │
   │     dataLen   4 B  : uint32 BE — longueur binaire (max 20 Mo)        │
   │     data      * B  : octets bruts de l'image (décodé depuis base64)  │
   └──────────────────────────────────────────────────────────────────────┘

   Intégrité :
     Le hash couvre exactement : jsonGzip + data₀ + data₁ + … (dans l'ordre
     de lecture du fichier). Il est vérifié AVANT tout parsing du JSON.

   Rétrocompatibilité :
     Anciens fichiers (magic 0x1f 0x8b = gzip) → parseur v1 automatique.
══════════════════════════════════════════════════════════════════════════ */

const _ENVELOPE_MAGIC = new Uint8Array([0x50, 0x44, 0x55, 0x41]); // "PDUA"
const _ENVELOPE_FORMAT_VERSION = 0x02;
const _MAX_ASSET_SIZE = 20 * 1024 * 1024; // 20 Mo par image
const _MAX_JSON_COMPRESSED = 50 * 1024 * 1024; // 50 Mo JSON (compressé ou non)

/* ── Helper : lit un ReadableStream entier en Uint8Array ── */
async function _readStream(readable) {
  return new Uint8Array(await new Response(readable).arrayBuffer());
}

/* ── Compression gzip du JSON ── */
async function _compressJson(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') return bytes;
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(bytes); w.close();
  return _readStream(cs.readable);
}

/* ── Décodage data-URL base64 → Uint8Array ── */
function _b64ToBin(dataUrl) {
  const b64 = dataUrl.split(',').pop();
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── Encodage Uint8Array → data-URL base64
   Traite par blocs de 8 192 octets pour éviter le stack overflow
   que causerait String.fromCharCode(...largeArray) sur les grandes images. ── */
function _binToDataUrl(bytes, mime) {
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return 'data:' + (mime || 'image/png') + ';base64,' + btoa(bin);
}

/* ── Extraction du MIME depuis une data-URL ── */
function _mimeFromDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;,]+)/);
  return (m && m[1]) ? m[1] : 'image/png';
}

/* ── SHA-256 sur une liste ordonnée de Uint8Array (concaténés) ── */
async function _sha256(...parts) {
  let totalLen = 0;
  for (const p of parts) totalLen += p.byteLength;
  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) {
    merged.set(p instanceof Uint8Array ? p : new Uint8Array(p.buffer ?? p), off);
    off += p.byteLength;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', merged));
}

/* ── Helpers lecture/écriture entiers big-endian ── */
function _u32be(view, pos) { return view.getUint32(pos, false); }
function _u16be(view, pos) { return view.getUint16(pos, false); }
function _putU32(view, pos, v) { view.setUint32(pos, v, false); }
function _putU16(view, pos, v) { view.setUint16(pos, v, false); }

/* ── Construire l'enveloppe binaire .pdfua v2 ──────────────────────────────
   assets : [{ id: string, data: Uint8Array, mime: string }, ...]
   Le hash couvre : jsonBytes ‖ data₀ ‖ data₁ ‖ … (dans cet ordre).
────────────────────────────────────────────────────────────────────────── */
async function _buildEnvelope(jsonBytes, assets) {
  const enc = new TextEncoder();

  /* Pré-encoder les métadonnées de chaque asset */
  const prepared = assets.map(a => ({
    idB: enc.encode(String(a.id).slice(0, 200)),
    mimeB: enc.encode((a.mime || 'image/png').slice(0, 64)),
    data: a.data,
  }));

  /* Hash sur jsonBytes + data de chaque asset dans l'ordre */
  const hash = await _sha256(jsonBytes, ...prepared.map(p => p.data));

  /* Taille totale :
     4 (magic) + 1 (fmtVer) + 32 (hash)
     + 4 (jsonLen) + jsonBytes
     + 2 (assetCount)
     + Σ [ 2+idLen + 1+mimeLen + 4+dataLen ]  pour chaque asset */
  let size = 4 + 1 + 32 + 4 + jsonBytes.byteLength + 2;
  for (const p of prepared) {
    size += 2 + p.idB.byteLength + 1 + p.mimeB.byteLength + 4 + p.data.byteLength;
  }

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let pos = 0;

  /* Header */
  u8.set(_ENVELOPE_MAGIC, pos); pos += 4;
  u8[pos++] = _ENVELOPE_FORMAT_VERSION;
  u8.set(hash, pos); pos += 32;

  /* JSON */
  _putU32(view, pos, jsonBytes.byteLength); pos += 4;
  u8.set(jsonBytes, pos); pos += jsonBytes.byteLength;

  /* Assets */
  _putU16(view, pos, prepared.length); pos += 2;
  for (const p of prepared) {
    _putU16(view, pos, p.idB.byteLength); pos += 2;
    u8.set(p.idB, pos); pos += p.idB.byteLength;
    u8[pos++] = p.mimeB.byteLength;
    u8.set(p.mimeB, pos); pos += p.mimeB.byteLength;
    _putU32(view, pos, p.data.byteLength); pos += 4;
    u8.set(p.data, pos); pos += p.data.byteLength;
  }

  return u8;
}

/* ── Parser l'enveloppe binaire .pdfua v2 ──────────────────────────────────
   Ordre des opérations :
     1. Vérifier magic + version
     2. Lire hash stocké
     3. Lire jsonGzip et tous les assets (dans l'ordre de lecture)
     4. Recalculer le hash et comparer → erreur si divergence
     5. Décompresser + parser le JSON
     6. Réinjecter les imgData dans les blocs
────────────────────────────────────────────────────────────────────────── */
async function _parseEnvelope(buffer) {
  /* S'assurer d'avoir un ArrayBuffer natif pour DataView */
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
  const u8 = new Uint8Array(ab);
  const view = new DataView(ab);
  const dec = new TextDecoder();
  let pos = 0;

  /* 1. Magic */
  if (u8.byteLength < 4 + 1 + 32 + 4 + 2)
    throw new Error('Fichier .pdfua trop court pour être valide.');
  for (let i = 0; i < 4; i++) {
    if (u8[pos + i] !== _ENVELOPE_MAGIC[i])
      throw new Error('Fichier .pdfua invalide (magic header incorrect).');
  }
  pos += 4;

  /* 2. Version de format */
  const fmtVer = u8[pos++];
  if (fmtVer !== _ENVELOPE_FORMAT_VERSION)
    throw new Error('Version de format .pdfua non supportée (' + fmtVer + '). Mettez à jour l\'éditeur.');

  /* 3. Hash stocké */
  const storedHash = u8.slice(pos, pos + 32); pos += 32;

  /* 4. JSON gzippé */
  const jsonLen = _u32be(view, pos); pos += 4;
  if (jsonLen > _MAX_JSON_COMPRESSED)
    throw new Error('Section JSON trop volumineuse (' + jsonLen + ' o).');
  if (pos + jsonLen > u8.byteLength)
    throw new Error('Fichier tronqué (section JSON).');
  const jsonGzip = u8.slice(pos, pos + jsonLen); pos += jsonLen;

  /* 5. Assets — lus dans l'ordre pour correspondre au hash */
  if (pos + 2 > u8.byteLength) throw new Error('Fichier tronqué (compteur assets).');
  const assetCount = _u16be(view, pos); pos += 2;
  if (assetCount > 10000)
    throw new Error('Nombre d\'assets excessif (' + assetCount + ').');

  const assetList = []; /* tableau ordonné — même ordre que lors de la construction */

  for (let i = 0; i < assetCount; i++) {
    if (pos + 2 > u8.byteLength) throw new Error('Fichier tronqué (asset ' + i + ', idLen).');
    const idLen = _u16be(view, pos); pos += 2;
    if (idLen === 0 || idLen > 200)
      throw new Error('Longueur d\'id invalide pour l\'asset ' + i + ' (' + idLen + ').');
    if (pos + idLen > u8.byteLength) throw new Error('Fichier tronqué (asset ' + i + ', id).');
    const id = dec.decode(u8.slice(pos, pos + idLen)); pos += idLen;

    if (pos + 1 > u8.byteLength) throw new Error('Fichier tronqué (asset ' + i + ', mimeLen).');
    const mimeLen = u8[pos++];
    if (mimeLen > 64)
      throw new Error('Longueur MIME invalide pour l\'asset ' + i + ' (' + mimeLen + ').');
    if (pos + mimeLen > u8.byteLength) throw new Error('Fichier tronqué (asset ' + i + ', mime).');
    const mime = dec.decode(u8.slice(pos, pos + mimeLen)); pos += mimeLen;

    if (pos + 4 > u8.byteLength) throw new Error('Fichier tronqué (asset ' + i + ', dataLen).');
    const dataLen = _u32be(view, pos); pos += 4;
    if (dataLen > _MAX_ASSET_SIZE)
      throw new Error('Asset ' + i + ' trop volumineux (' + dataLen + ' o, max ' + _MAX_ASSET_SIZE + ').');
    if (pos + dataLen > u8.byteLength) throw new Error('Fichier tronqué (asset ' + i + ', data).');
    const data = u8.slice(pos, pos + dataLen); pos += dataLen;

    assetList.push({ id, mime, data });
  }

  /* 6. Vérification d'intégrité SHA-256
     Hash recalculé sur : jsonGzip + data₀ + data₁ + …
     (même ordre que _buildEnvelope — tableau ordonné, pas Object.values) */
  const computedHash = await _sha256(jsonGzip, ...assetList.map(a => a.data));
  for (let i = 0; i < 32; i++) {
    if (computedHash[i] !== storedHash[i])
      throw new Error('Intégrité du fichier compromise — le hash SHA-256 est invalide. Le fichier a été modifié ou corrompu.');
  }

  /* 7. Décompresser et parser le JSON */
  let jsonObj;
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(jsonGzip); w.close();
    const decompressed = await _readStream(ds.readable);
    if (decompressed.byteLength > _MAX_JSON_COMPRESSED)
      throw new Error('JSON trop volumineux après décompression (' + decompressed.byteLength + ' o).');
    jsonObj = JSON.parse(new TextDecoder().decode(decompressed));
  } else {
    /* Fallback : navigateur sans DecompressionStream — tenter JSON brut */
    if (jsonGzip.byteLength > _MAX_JSON_COMPRESSED)
      throw new Error('JSON trop volumineux (' + jsonGzip.byteLength + ' o).');
    jsonObj = JSON.parse(new TextDecoder().decode(jsonGzip));
  }

  /* 8. Réinjecter les imgData dans les blocs depuis la table d'assets */
  if (Array.isArray(jsonObj.blocks)) {
    const assetMap = Object.fromEntries(assetList.map(a => [a.id, a]));
    for (const b of jsonObj.blocks) {
      if (b.type === 'img' && b.id && assetMap[b.id]) {
        const { data, mime } = assetMap[b.id];
        b.imgData = _binToDataUrl(data, mime);
      }
    }
  }

  return jsonObj;
}

/* ── Schéma canonique par type de bloc ─────────────────────────────────────
   Seuls ces champs sont sérialisés dans le fichier projet.
   Avantages :
     • Fichiers plus petits (suppression des champs redondants/internes)
     • Format prévisible et auditable
     • Évolutions futures sans pollution de champs obsolètes
   Le champ `order` est omis volontairement : il est recalculé à l'import
   depuis la position des blocs dans le tableau (ordre de lecture stable).
   Le champ `content` est omis pour les blocs rich (redondant avec richContent).
────────────────────────────────────────────────────────────────────────── */
const _BLOCK_FIELDS = {
  /* Communs à tous les types */
  _base: ['id', 'type', 'x', 'y', 'w', 'h', 'zIndex'],
  /* Surcharges par type — fusionnées avec _base à la sérialisation */
  h1: ['richContent', 'content', 'fontSize'],
  h2: ['richContent', 'content', 'fontSize'],
  h3: ['richContent', 'content', 'fontSize'],
  h4: ['richContent', 'content', 'fontSize'],
  h5: ['richContent', 'content', 'fontSize'],
  h6: ['richContent', 'content', 'fontSize'],
  p: ['richContent', 'content', 'fontSize', 'textIndent'],
  ul: ['richContent', 'content', 'listNoBullet', 'fontSize'],
  ol: ['richContent', 'content', 'listNoBullet', 'fontSize'],
  img: ['imgData', 'alt', 'imgLinkUrl'],
  link: ['linkText', 'linkUrl'],
  table: ['tableData'],
  quote: ['richContent', 'content', 'quoteSource', 'fontSize'],
  note: ['richContent', 'content', 'noteRef', 'anchorBlockId', 'fontSize'],
  hr: [],
  aside: ['richContent', 'content', 'asideStyle', 'fontSize'],
  code: ['content'],
  shape: ['shapeKind', 'shapeColor', 'shapeOpacity', 'shapeFillNone',
    'shapeBorderEnabled', 'shapeBorderColor', 'shapeBorderWidth', 'shapeRotation'],
  freeform: ['shapeColor', 'shapeOpacity', 'strokeWidth', 'shapeFilled', 'pathClosed', 'pathPoints', 'shapeRotation'],
  chart: ['chartKind', 'chartTitle', 'chartData', 'alt'],
  'form-text': ['formLabel', 'formPlaceholder', 'formDefaultValue', 'formRequired', 'formReadonly'],
  'form-textarea': ['formLabel', 'formPlaceholder', 'formDefaultValue', 'formRequired', 'formReadonly'],
  'form-checkbox': ['formLabel', 'formChecked', 'formRequired', 'formReadonly'],
  'form-radio': ['formLabel', 'formOptions', 'formRequired', 'formReadonly'],
  'form-select': ['formLabel', 'formOptions', 'formDefaultValue', 'formRequired', 'formReadonly'],
};

/* Sérialise un bloc en ne gardant que ses champs canoniques. */
function _serializeBlock(b) {
  const specific = _BLOCK_FIELDS[b.type];
  if (!specific) return { ...b }; // type inconnu — fallback full copy (ne devrait pas arriver)
  const fields = [..._BLOCK_FIELDS._base, ...specific];
  const out = {};
  for (const k of fields) {
    if (b[k] !== undefined) out[k] = b[k];
  }
  return out;
}

/* ── Migrations de schéma ───────────────────────────────────────────────────
   Chaque entrée décrit les transformations à appliquer sur un bloc
   pour le passer d'une version à la suivante.
   Pattern : migrate[fromV][type](block) → block modifié.
   Actuellement : v1 → v2 ne nécessite aucune transformation de données
   (v2 introduit seulement la sérialisation par liste blanche de champs).
────────────────────────────────────────────────────────────────────────── */
const _MIGRATIONS = {
  1: {
    /* v1 → v2 : aucune transformation de données requise.
       Les champs parasites (order, label…) seront simplement ignorés
       par _validateImportedBlock comme avant. */
    _any: b => b,
  },
};

/* Applique toutes les migrations nécessaires de fromV jusqu'à PROJECT_VERSION. */
function _migrateBlock(b, fromV) {
  let block = { ...b };
  for (let v = fromV; v < PROJECT_VERSION; v++) {
    const vMigrations = _MIGRATIONS[v];
    if (!vMigrations) continue;
    const migrateFn = vMigrations[block.type] || vMigrations._any;
    if (migrateFn) block = migrateFn(block) || block;
  }
  return block;
}

// Sérialiser l'état courant en objet
function _projectSnapshot() {
  return {
    v: PROJECT_VERSION,
    meta: _collectMeta(),
    /* Sérialisation par liste blanche : champs canoniques uniquement */
    blocks: blocks.map(_serializeBlock),
    /* cnt est omis volontairement — recalculé à l'import depuis les ids */
    grid: { enabled: gridEnabled, visible: gridVisible, size: gridSize },
    /* Borner pageOrientations à MAX_PAGES par sécurité */
    pageOrientations: pageOrientations.slice(0, MAX_PAGES),
  };
}

// Décompresser — gère les deux formats :
//   • Enveloppe binaire v2 (magic PDUA)
//   • Ancien format gzip pur (v1, rétrocompatibilité)
async function _decompress(buffer) {
  const u8 = new Uint8Array(buffer);
  const MAX_DECOMPRESSED = 50 * 1024 * 1024;

  /* Détection du format par magic */
  const isPDUA = u8[0] === 0x50 && u8[1] === 0x44 && u8[2] === 0x55 && u8[3] === 0x41;
  if (isPDUA) {
    /* Nouveau format enveloppe — parsing complet avec vérification SHA-256 */
    return _parseEnvelope(buffer);
  }

  /* Ancien format : gzip pur (v1) — rétrocompatibilité */
  if (u8[0] === 0x1f && u8[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(u8); w.close();
    const decompressed = await _readStream(ds.readable);
    if (decompressed.byteLength > MAX_DECOMPRESSED) throw new Error('Fichier trop volumineux après décompression.');
    return JSON.parse(new TextDecoder().decode(decompressed));
  }

  /* Fallback JSON brut (ancien format sans compression) */
  if (u8.byteLength > MAX_DECOMPRESSED) throw new Error('Fichier trop volumineux.');
  return JSON.parse(new TextDecoder().decode(u8));
}

// Sauvegarde du projet
async function saveProject() {
  try {
    const snapshot = _projectSnapshot();

    /* Extraire les imgData des blocs avant sérialisation JSON (point 2) :
       - Les données binaires sont stockées séparément dans l'enveloppe
       - Le JSON ne contient plus que des références légères (imgData absent)
       - Économie de ~25% sur la taille + JSON auditable sans décoder les images */
    const assets = [];
    const blocksForJson = snapshot.blocks.map(b => {
      if (b.type === 'img' && b.imgData && typeof b.imgData === 'string' && b.imgData.startsWith('data:')) {
        const mime = _mimeFromDataUrl(b.imgData);
        const binData = _b64ToBin(b.imgData);
        assets.push({ id: b.id, data: binData, mime });
        /* Retourner le bloc sans imgData dans le JSON */
        const { imgData: _removed, ...blockWithoutImg } = b;
        return blockWithoutImg;
      }
      return b;
    });

    const jsonGzip = await _compressJson({ ...snapshot, blocks: blocksForJson });
    const envelopeBytes = await _buildEnvelope(jsonGzip, assets);

    const title = (snapshot.meta.title || 'document').replace(/[^a-z0-9_\-]/gi, '_');
    const url = URL.createObjectURL(new Blob([envelopeBytes], { type: 'application/octet-stream' }));
    Object.assign(document.createElement('a'), { href: url, download: title + PROJECT_EXT }).click();
    URL.revokeObjectURL(url);
    announce('Projet sauvegardé — ' + title + PROJECT_EXT);
  } catch (e) { announce('Erreur lors de la sauvegarde : ' + e.message); }
}

// Ouverture d'un projet
async function openProject(input) {
  const file = input?.files?.[0]; if (!file) return;
  input.value = '';
  /* Limite de taille du fichier brut — un projet légitime ne dépasse pas 10 Mo compressé
     (la limite réelle est surtout sur le décompressé, voir _decompress). */
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) { announce('Fichier trop volumineux (max 10 Mo).'); return; }
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

    /* Sanitiser les méta — champs texte uniquement */
    if (project.meta && typeof project.meta === 'object') {
      ['title', 'author', 'subject', 'lang', 'font'].forEach(k => {
        const e = document.getElementById('m-' + k);
        if (e && project.meta[k] && typeof project.meta[k] === 'string') e.value = project.meta[k].slice(0, 500);
      });
    }

    if (project.grid) {
      const gridSizeRaw = Number(project.grid.size);
      /* Valider la taille de grille : entier entre 5 et 200px, fallback 20 */
      const safeGridSize = Number.isFinite(gridSizeRaw) && gridSizeRaw >= 5 && gridSizeRaw <= 200
        ? Math.round(gridSizeRaw) : 20;
      toggleGrid(!!project.grid.enabled, !!project.grid.visible, safeGridSize);
    }

    /* Valider les orientations — borner à MAX_PAGES (point 6) */
    if (Array.isArray(project.pageOrientations)) {
      pageOrientations = project.pageOrientations
        .slice(0, MAX_PAGES)
        .map(o => _ALLOWED_ORIENTATIONS.has(o) ? o : 'portrait');
    }

    /* Appliquer les migrations de schéma si le fichier est d'une version antérieure,
       puis valider et sanitiser chaque bloc (point 1 + point 4) */
    const fileVersion = typeof project.v === 'number' ? project.v : 1;
    const rawBlocks = Array.isArray(project.blocks) ? project.blocks : [];
    blocks = rawBlocks
      .map(b => _migrateBlock(b, fileVersion))   // migrations v1→v2, v2→v3, etc.
      .map(_validateImportedBlock)               // validation + sanitisation
      .filter(Boolean)
      .map((b, i) => { b.order = i; return b; }); // recalculer order depuis la position

    /* Recalculer cnt depuis les ids existants — ne pas le restaurer depuis le fichier (point 3).
       uid() génère 'b' + (++cnt), donc cnt = max des suffixes numériques des ids. */
    cnt = blocks.reduce((max, b) => {
      const n = parseInt(String(b.id).replace(/^b/, ''), 10);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);

    _ordCacheKey = '';
    const maxPage = blocks.reduce((m, b) => Math.max(m, Math.floor(b.y / PH)), 0);
    while (numPages <= maxPage) addCanvasPage();
    _restorePages();
    blocks.forEach(b => { const pg = getCanvasPage(Math.floor(b.y / PH)); if (pg) pg.appendChild(buildEl(b)); });

    desel(); updUA(); updTree(); saveSession();
    announce('Projet ouvert — ' + (typeof project.meta?.title === 'string' ? project.meta.title.slice(0, 200) : file.name));
  } catch (e) { announce('Erreur lors de l\'ouverture : ' + e.message); console.error(e); }
}
