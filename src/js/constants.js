// constants.js — Constantes globales, métadonnées, palette DSFR, formes

const PW = 794, PH = 1123, MAR = 40, BAR_H = 0, CT_PAD = 6;
const LINK_COLOR = '#1d4ed8'; /* Couleur liens & appels de note — contraste ≥ 4.5:1 sur blanc */
const pageWrap = document.getElementById('page-wrap');


const CREATOR = 'Générateur de PDF'
const PRODUCER = ''; // Laisser vide pour éviter d'ajouter une info inutile dans le PDF
const FS = { h1: 32, h2: 28, h3: 24, h4: 20, h5: 18, h6: 16, p: 13, list: 13, link: 13, table: 12, quote: 13, note: 8, aside: 12, code: 12 };

// Définitions des blocs
const BLOCK_META = {
  h1: { label: 'Titre H1', w: 240, h: 65, content: 'Titre principal' },
  h2: { label: 'Titre H2', w: 215, h: 60, content: 'Titre de section' },
  h3: { label: 'Titre H3', w: 185, h: 55, content: 'Titre de sous-section' },
  h4: { label: 'Titre H4', w: 155, h: 50, content: 'Sous-sous-section' },
  h5: { label: 'Titre H5', w: 140, h: 45, content: 'Titre de niveau 5' },
  h6: { label: 'Titre H6', w: 130, h: 45, content: 'Titre de niveau 6' },
  p: { label: 'Paragraphe', w: 165, h: 45, content: 'Texte de paragraphe...' },
  ul: { label: 'Liste à puces', w: 220, h: 94, content: 'Élément 1\nÉlément 2\nÉlément 3' },
  ol: { label: 'Liste numérotée', w: 220, h: 94, content: 'Élément 1\nÉlément 2\nÉlément 3' },
  img: { label: 'Image', w: 240, h: 180, alt: '', imgData: null, imgLinkUrl: '' },
  link: { label: 'Lien hypertexte', w: 200, h: 50, linkText: 'Lien vers ceci', linkUrl: 'https://example.com' },
  table: { label: 'Tableau', w: 360, h: 94, tableData: [['Col 1', 'Col 2', 'Col 3'], ['Cellule 1', 'Cellule 2', 'Cellule 3'], ['Cellule 4', 'Cellule 5', 'Cellule 6']] },
  quote: { label: 'Citation', w: 380, h: 90, content: 'Texte de la citation.', quoteSource: '— Auteur' },
  note: { label: 'Note', w: 340, h: 40, content: 'Texte de la note de bas de page.', noteRef: '1' },
  hr: { label: 'Séparateur', w: 500, h: 24 },
  aside: { label: 'Encadré', w: 380, h: 80, content: 'Contenu de l\'encadré.', asideStyle: 'info' },
  code: { label: 'Code', w: 380, h: 80, content: 'function exemple() {\n  return true;\n}' },
  shape: { label: 'Forme décorative', w: 100, h: 100, shapeKind: 'circle', shapeColor: '#000091', shapeOpacity: 1, shapeFillNone: false, shapeBorderEnabled: false, shapeBorderColor: '#000091', shapeBorderWidth: 2 },
  freeform: { label: 'Forme libre', w: 200, h: 200, shapeColor: '#000091', shapeOpacity: 1, strokeWidth: 2, shapeFilled: false, pathClosed: true, pathPoints: [] },
  /* ── Champs de formulaire ── */
  'form-text': { label: 'Champ texte', w: 300, h: 58, formLabel: 'Libellé', formPlaceholder: 'Saisir…', formRequired: false, formReadonly: false, formDefaultValue: '' },
  'form-textarea': { label: 'Zone de texte', w: 300, h: 100, formLabel: 'Libellé', formPlaceholder: 'Saisir…', formRequired: false, formReadonly: false, formDefaultValue: '' },
  'form-checkbox': { label: 'Case à cocher', w: 260, h: 40, formLabel: 'Libellé de la case', formRequired: false, formReadonly: false, formChecked: false },
  'form-radio': { label: 'Boutons radio', w: 260, h: 90, formLabel: 'Groupe de choix', formOptions: 'Option 1\nOption 2\nOption 3', formRequired: false, formReadonly: false },
  'form-select': { label: 'Liste déroulante', w: 280, h: 60, formLabel: 'Libellé', formOptions: 'Choix 1\nChoix 2\nChoix 3', formRequired: false, formReadonly: false, formDefaultValue: '' },

  chart: {
    label: 'Graphique', w: 340, h: 220,
    chartKind: 'pie',
    chartTitle: '',
    alt: '',
    chartData: [
      { label: 'Série A', value: 40, color: '#000091', pattern: 'solid' },
      { label: 'Série B', value: 30, color: '#e1000f', pattern: 'diag1' },
      { label: 'Série C', value: 20, color: '#00a95f', pattern: 'hlines' },
      { label: 'Série D', value: 10, color: '#fcc63a', pattern: 'dots' },
    ],
  },
};

// Alias pour accès rapide aux labels et dimensions de chaque type de bloc
const DEFS = BLOCK_META;
const LABELS = Object.fromEntries(Object.entries(BLOCK_META).map(([k, v]) => [k, v.label]));

/* ── PALETTE DSFR — couleurs officielles du système de design de l'État ── */
const DSFR_COLORS = [
  { label: 'Bleu France — 975 (fond)', hex: '#f5f5fe', group: 'Bleu France' },
  { label: 'Bleu France — 950', hex: '#ececfe', group: 'Bleu France' },
  { label: 'Bleu France — 900', hex: '#cacafb', group: 'Bleu France' },
  { label: 'Bleu France — 850', hex: '#b6b6f8', group: 'Bleu France' },
  { label: 'Bleu France — 750', hex: '#8585f6', group: 'Bleu France' },
  { label: 'Bleu France — 625', hex: '#6a6af4', group: 'Bleu France' },
  { label: 'Bleu France (principal)', hex: '#000091', group: 'Bleu France' },
  { label: 'Bleu Écume — 975 (fond)', hex: '#f4f6ff', group: 'Bleu Écume' },
  { label: 'Bleu Écume — 900', hex: '#c8d0fb', group: 'Bleu Écume' },
  { label: 'Bleu Écume — 800', hex: '#91a5f4', group: 'Bleu Écume' },
  { label: 'Bleu Écume (principal)', hex: '#465f9d', group: 'Bleu Écume' },
  { label: 'Bleu Écume — foncé', hex: '#2f4077', group: 'Bleu Écume' },
  { label: 'Rouge Marianne — 975', hex: '#fff5f5', group: 'Rouge Marianne' },
  { label: 'Rouge Marianne — 950', hex: '#fee9e9', group: 'Rouge Marianne' },
  { label: 'Rouge Marianne — 900', hex: '#fcbfbf', group: 'Rouge Marianne' },
  { label: 'Rouge Marianne — 800', hex: '#f08080', group: 'Rouge Marianne' },
  { label: 'Rouge Marianne — vif', hex: '#e1000f', group: 'Rouge Marianne' },
  { label: 'Rouge Marianne (principal)', hex: '#c9191e', group: 'Rouge Marianne' },
  { label: 'Rouge Marianne — foncé', hex: '#9e1a25', group: 'Rouge Marianne' },
  { label: 'Vert Bourgeon — 975', hex: '#f3f6ed', group: 'Vert Bourgeon' },
  { label: 'Vert Bourgeon — 900', hex: '#c9ddb7', group: 'Vert Bourgeon' },
  { label: 'Vert Bourgeon (principal)', hex: '#68a51a', group: 'Vert Bourgeon' },
  { label: 'Vert Bourgeon — foncé', hex: '#447049', group: 'Vert Bourgeon' },
  { label: 'Vert Émeraude — fond', hex: '#e6feda', group: 'Vert Émeraude' },
  { label: 'Vert Émeraude (principal)', hex: '#00a95f', group: 'Vert Émeraude' },
  { label: 'Vert Émeraude — foncé', hex: '#297254', group: 'Vert Émeraude' },
  { label: 'Vert Archipel (principal)', hex: '#009099', group: 'Vert Archipel' },
  { label: 'Vert Archipel — foncé', hex: '#006a6f', group: 'Vert Archipel' },
  { label: 'Jaune Tournesol — fond', hex: '#fef7da', group: 'Jaune Tournesol' },
  { label: 'Jaune Tournesol (principal)', hex: '#fcc63a', group: 'Jaune Tournesol' },
  { label: 'Jaune Tournesol — foncé', hex: '#716043', group: 'Jaune Tournesol' },
  { label: 'Orange Terre Battue', hex: '#e18b76', group: 'Orange' },
  { label: 'Orange Terre Battue — foncé', hex: '#755348', group: 'Orange' },
  { label: 'Rose Macaron', hex: '#e06a8c', group: 'Rose' },
  { label: 'Rose Macaron — foncé', hex: '#8d4a60', group: 'Rose' },
  { label: 'Rose Tuile', hex: '#ce614a', group: 'Rose' },
  { label: 'Rose Tuile — foncé', hex: '#a94645', group: 'Rose' },
  { label: 'Gris — 975', hex: '#f6f6f6', group: 'Gris' },
  { label: 'Gris — 950', hex: '#eeeeee', group: 'Gris' },
  { label: 'Gris — 900', hex: '#e5e5e5', group: 'Gris' },
  { label: 'Gris — 850', hex: '#dddddd', group: 'Gris' },
  { label: 'Gris foncé', hex: '#3a3a3a', group: 'Gris' },
  { label: 'Noir texte', hex: '#161616', group: 'Gris' },
  { label: 'Blanc', hex: '#ffffff', group: 'Noir & Blanc' },
  { label: 'Noir', hex: '#000000', group: 'Noir & Blanc' },
];

/* Trouver la couleur DSFR la plus proche par hex (insensible à la casse) */
function dsfrClosest(hex) {
  const h = (hex || '').toLowerCase();
  const exact = DSFR_COLORS.find(c => c.hex.toLowerCase() === h);
  return exact ? exact.hex : DSFR_COLORS[6].hex; /* fallback: Bleu France principal */
}

/**
 * Construit un <select> de couleurs DSFR avec un swatch de prévisualisation.
 * @param {string}   id       — id HTML du select
 * @param {string}   value    — valeur hex courante
 * @param {function} onChange — callback(hexValue)
 * @returns {HTMLElement} wrapper div contenant le select + le swatch
 */
function makeDsfrColorSelect(id, value, onChange) {
  const resolved = dsfrClosest(value);

  /* Swatch de couleur à droite du select */
  const swatch = document.createElement('span');
  swatch.id = id + '-swatch';
  swatch.style.cssText = `display:inline-block;width:20px;height:20px;border-radius:3px;` +
    `border:1px solid #e5e7eb;flex-shrink:0;background:${resolved}`;

  const sel = document.createElement('select');
  sel.id = id;
  sel.style.cssText = 'flex:1;font-size:11px;padding:3px 5px;border:1px solid #e5e7eb;' +
    'border-radius:5px;background:#fff;color:#1a1a1a';

  /* Grouper par famille */
  const groups = {};
  DSFR_COLORS.forEach(c => { (groups[c.group] = groups[c.group] || []).push(c); });
  Object.entries(groups).forEach(([gName, colors]) => {
    const og = document.createElement('optgroup');
    og.label = gName;
    colors.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.hex;
      opt.textContent = c.label;
      if (c.hex.toLowerCase() === resolved.toLowerCase()) opt.selected = true;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });

  sel.onchange = () => {
    swatch.style.background = sel.value;
    onChange(sel.value);
  };

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px';
  wrap.append(sel, swatch);
  return wrap;
}

/* ══════════════════════════════════════════════════════════════
   SHAPE_RENDERERS — table de rendu unifiée SVG ↔ PDF
   Chaque entrée expose :
     label          : string
     icon           : string
     svg(w,h)       → innerHTML SVG en coordonnées locales (0,0)→(w,h)
     pdf(doc,w,h,cmd) → dessine en coords locales ; cmd = 'fill' | 'fillAndStroke' | 'stroke'
                        La transformation CTM est appliquée par l'appelant.
   ══════════════════════════════════════════════════════════════ */
const SHAPE_RENDERERS = {

  circle: {
    label: 'Cercle', icon: '●',
    svg: (w, h) => { const r = Math.min(w, h) / 2; const [cx, cy] = [w / 2, h / 2]; return `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r}" fill="currentColor"/>`; },
    pdf: (doc, w, h, cmd = 'fill') => { const r = Math.min(w, h) / 2; doc.circle(w / 2, h / 2, r)[cmd](); },
  },

  halfcircle: {
    label: 'Demi-cercle', icon: '◑',
    svg: (w, h) => { const [cx, cy] = [w / 2, h / 2]; return `<path d="M0,${cy} A${cx},${cy} 0 0,1 ${w},${cy} Z" fill="currentColor"/>`; },
    pdf: (doc, w, h, cmd = 'fill') => {
      /* Approximation Bézier cubique d'une demi-ellipse (rx=w/2, ry=h/2)
         Deux quarts d'arc, facteur de Bézier k ≈ 0.5523 pour erreur < 0.03%
         SVG : M 0,cy  A rx,ry 0 0,1  w,cy  Z  (bombé vers le haut)
         Point de départ : (0, cy)  →  sommet : (cx, 0)  →  arrivée : (w, cy) */
      const cx = w / 2, cy = h / 2, k = 0.5523;
      doc.moveTo(0, cy)
        .bezierCurveTo(0, cy - k * cy, cx - k * cx, 0, cx, 0)       // quart gauche
        .bezierCurveTo(cx + k * cx, 0, w, cy - k * cy, w, cy)       // quart droit
        .lineTo(0, cy)
        .closePath()[cmd]();
    },
  },

  star: { label: 'Étoile 5 pts', icon: '★', svg: (w, h) => _starSVG(w, h, 5, 0.4), pdf: (doc, w, h, cmd = 'fill') => _starPDF(doc, w, h, 5, 0.4, cmd) },
  star6: { label: 'Étoile 6 pts', icon: '✶', svg: (w, h) => _starSVG(w, h, 6, 0.5), pdf: (doc, w, h, cmd = 'fill') => _starPDF(doc, w, h, 6, 0.5, cmd) },

  triangle: {
    label: 'Triangle', icon: '▲',
    svg: (w, h) => `<polygon points="${w / 2},0 ${w},${h} 0,${h}" fill="currentColor"/>`,
    pdf: (doc, w, h, cmd = 'fill') => { doc.moveTo(w / 2, 0).lineTo(w, h).lineTo(0, h).closePath()[cmd](); },
  },

  diamond: {
    label: 'Losange', icon: '◆',
    svg: (w, h) => `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" fill="currentColor"/>`,
    pdf: (doc, w, h, cmd = 'fill') => { doc.moveTo(w / 2, 0).lineTo(w, h / 2).lineTo(w / 2, h).lineTo(0, h / 2).closePath()[cmd](); },
  },

  square: {
    label: 'Carré', icon: '■',
    svg: (w, h) => `<rect x="0" y="0" width="${w}" height="${h}" fill="currentColor"/>`,
    pdf: (doc, w, h, cmd = 'fill') => { doc.rect(0, 0, w, h)[cmd](); },
  },

  cross: {
    label: 'Croix', icon: '✚',
    svg: (w, h) => {
      const [cx, cy, t] = [w / 2, h / 2, Math.min(w, h) * 0.25];
      return `<path d="M${cx - t / 2},0 L${cx + t / 2},0 L${cx + t / 2},${cy - t / 2} L${w},${cy - t / 2} L${w},${cy + t / 2} L${cx + t / 2},${cy + t / 2} L${cx + t / 2},${h} L${cx - t / 2},${h} L${cx - t / 2},${cy + t / 2} L0,${cy + t / 2} L0,${cy - t / 2} L${cx - t / 2},${cy - t / 2} Z" fill="currentColor"/>`;
    },
    pdf: (doc, w, h, cmd = 'fill') => {
      const [cx, cy, t] = [w / 2, h / 2, Math.min(w, h) * 0.25];
      doc.moveTo(cx - t / 2, 0).lineTo(cx + t / 2, 0).lineTo(cx + t / 2, cy - t / 2).lineTo(w, cy - t / 2)
        .lineTo(w, cy + t / 2).lineTo(cx + t / 2, cy + t / 2).lineTo(cx + t / 2, h).lineTo(cx - t / 2, h)
        .lineTo(cx - t / 2, cy + t / 2).lineTo(0, cy + t / 2).lineTo(0, cy - t / 2).lineTo(cx - t / 2, cy - t / 2)
        .closePath()[cmd]();
    },
  },

  arrow: {
    label: 'Flèche', icon: '➤',
    svg: (w, h) => {
      const cy = h / 2;
      return `<polygon points="${w},${cy} ${w * 0.5},0 ${w * 0.5},${cy * 0.4} 0,${cy * 0.4} 0,${cy * 1.6} ${w * 0.5},${cy * 1.6} ${w * 0.5},${h}" fill="currentColor"/>`;
    },
    pdf: (doc, w, h, cmd = 'fill') => {
      const cy = h / 2;
      doc.moveTo(w, cy).lineTo(w * 0.5, 0).lineTo(w * 0.5, cy * 0.4).lineTo(0, cy * 0.4)
        .lineTo(0, cy * 1.6).lineTo(w * 0.5, cy * 1.6).lineTo(w * 0.5, h).closePath()[cmd]();
    },
  },

  wave: {
    label: 'Vague', icon: '〜',
    /* La vague est un tracé ouvert — fill inapplicable, toujours stroke */
    svg: (w, h) => {
      const [cx, cy, sw] = [w / 2, h / 2, Math.max(2, h * 0.12)];
      return `<path d="M0,${cy} C${w * 0.15},${cy - h * 0.35} ${w * 0.35},${cy - h * 0.35} ${cx},${cy} S${w * 0.85},${cy + h * 0.35} ${w},${cy}" stroke="currentColor" stroke-width="${sw}" fill="none"/>`;
    },
    pdf: (doc, w, h) => {
      const [cx, cy] = [w / 2, h / 2];
      doc.lineWidth(Math.max(2, h * 0.12))
        .moveTo(0, cy).bezierCurveTo(w * 0.15, cy - h * 0.35, w * 0.35, cy - h * 0.35, cx, cy)
        .bezierCurveTo(cx + w * 0.15, cy + h * 0.35, w * 0.85, cy + h * 0.35, w, cy).stroke();
    },
  },
};
// Helpers pour dessiner les étoiles
const _starPointsCache = new Map();
function _starPoints(w, h, n, ir_ratio) {
  const key = `${w},${h},${n},${ir_ratio}`;
  if (_starPointsCache.has(key)) return _starPointsCache.get(key);
  const cx = w / 2, cy = h / 2, or = Math.min(cx, cy), ir = or * ir_ratio;
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 === 0 ? or : ir, a = (Math.PI / n) * i - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  _starPointsCache.set(key, pts);
  return pts;
}
function _starSVG(w, h, n, ir_ratio) {
  return `<polygon points="${_starPoints(w, h, n, ir_ratio).map(p => p.join(',')).join(' ')}" fill="currentColor"/>`;
}
function _starPDF(doc, w, h, n, ir_ratio, cmd = 'fill') {
  const pts = _starPoints(w, h, n, ir_ratio);
  doc.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(p => doc.lineTo(p[0], p[1]));
  doc.closePath()[cmd]();
}

// Compatibilité avec le reste du code
function shapeSVGPath(kind, w, h) {
  const r = SHAPE_RENDERERS[kind] || SHAPE_RENDERERS.circle;
  return r.svg(w, h);
}

// Garder les labels et icônes des formes
const SHAPE_DEFS = Object.fromEntries(
  Object.entries(SHAPE_RENDERERS).map(([k, v]) => [k, { label: v.label, icon: v.icon }])
);