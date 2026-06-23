// editor-ui.js — Rendu WYSIWYG, interactions canvas, formes libres, graphiques, UI globale

/* Namespace SVG — déclaré en tête pour éviter tout risque de TDZ */
const _SVG_NS = 'http://www.w3.org/2000/svg';

/* ══════════════════════════════════════════════════════════════════
   FORME LIBRE — Rendu final + Outil plume avec aperçu Bézier réel
   ══════════════════════════════════════════════════════════════════

   Modèle de point :
     { x, y }                       → point d'ancrage (ligne droite)
     { x, y, cp1:{x,y} }            → ancrage + handle sortant
     { x, y, cp2:{x,y} }            → ancrage + handle entrant
     { x, y, cp1:{x,y}, cp2:{x,y} } → ancrage + deux handles (lisse)

   La commande SVG entre pts[i-1] et pts[i] :
     - C  si pts[i-1].cp1 ET pts[i].cp2
     - Q  si l'un des deux seulement
     - L  sinon
   ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   GRAPHIQUES — Rendu WYSIWYG SVG + Éditeur de données inline
   Types : pie, donut, bar, line
   Stockage dans b.chartData : [{ label, value, color, pattern }, …]
   ══════════════════════════════════════════════════════════════════ */

const CHART_PALETTE = ['#000091', '#e1000f', '#00a95f', '#fcc63a', '#009099', '#e06a8c', '#465f9d', '#68a51a'];

/* ── Générateurs de <pattern> SVG ──
   Principe : fond coloré plein + motif blanc semi-transparent par-dessus.
   chartSize = Math.min(w, h) du graphique — l'espacement est proportionnel. */
function _mkPat(svg, id, size, bgColor, motifContent) {
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(_SVG_NS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  if (defs.querySelector(`[id="${id}"]`)) return `url(#${id})`;
  const pat = document.createElementNS(_SVG_NS, 'pattern');
  pat.setAttribute('id', id);
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('width', size);
  pat.setAttribute('height', size);
  pat.setAttribute('patternTransform', 'translate(0,0)');
  pat.innerHTML = `<rect width="${size}" height="${size}" fill="${bgColor}"/>` + motifContent;
  defs.appendChild(pat);
  return `url(#${id})`;
}
/* Espacement proportionnel : ~1/6 de la plus petite dimension, clampé 4–12px */
function _patStep(chartSize) { return Math.max(4, Math.min(chartSize / 6, 12)); }
function _mkLineW(x1, y1, x2, y2, sw) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${sw}" stroke-opacity="0.35"/>`;
}

/* Générateurs de motifs SVG — chaque fn(svg, uid, color, cs) → fill string */
const _PAT_FNS = {
  hlines(svg, uid, color, cs) { const s = _patStep(cs), sw = Math.max(0.6, s * 0.18); return _mkPat(svg, uid, s, color, _mkLineW(0, s / 2, s, s / 2, sw)); },
  vlines(svg, uid, color, cs) { const s = _patStep(cs), sw = Math.max(0.6, s * 0.18); return _mkPat(svg, uid, s, color, _mkLineW(s / 2, 0, s / 2, s, sw)); },
  diag1(svg, uid, color, cs) { const s = _patStep(cs), sw = Math.max(0.6, s * 0.18); return _mkPat(svg, uid, s, color, _mkLineW(0, s, s, 0, sw) + _mkLineW(-s * 0.1, s * 0.1, s * 0.1, -s * 0.1, sw) + _mkLineW(s * 0.9, s * 1.1, s * 1.1, s * 0.9, sw)); },
  diag2(svg, uid, color, cs) { const s = _patStep(cs), sw = Math.max(0.6, s * 0.18); return _mkPat(svg, uid, s, color, _mkLineW(0, 0, s, s, sw) + _mkLineW(-s * 0.1, s * 0.9, s * 0.1, s * 1.1, sw) + _mkLineW(s * 0.9, -s * 0.1, s * 1.1, s * 0.1, sw)); },
  cross(svg, uid, color, cs) { const s = _patStep(cs), sw = Math.max(0.6, s * 0.18); return _mkPat(svg, uid, s, color, _mkLineW(0, s / 2, s, s / 2, sw) + _mkLineW(s / 2, 0, s / 2, s, sw)); },
  dots(svg, uid, color, cs) { const s = _patStep(cs), r = Math.max(0.7, s * 0.22); return _mkPat(svg, uid, s, color, `<circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="white" fill-opacity="0.35"/>`); },
  dashes(svg, uid, color, cs) { const s = _patStep(cs), sw = Math.max(0.6, s * 0.18), dl = s * 0.6; return _mkPat(svg, uid, s, color, `<line x1="0" y1="${s / 2}" x2="${dl}" y2="${s / 2}" stroke="white" stroke-width="${sw}" stroke-opacity="0.35"/>`); },
};

/* ── Motifs de hachure disponibles — svgFn référence directement _PAT_FNS ── */
const CHART_PATTERNS = [
  { id: 'solid', label: 'Plein', svgFn: null },
  { id: 'hlines', label: 'Lignes horiz.', svgFn: _PAT_FNS.hlines },
  { id: 'vlines', label: 'Lignes vert.', svgFn: _PAT_FNS.vlines },
  { id: 'diag1', label: 'Diagonale /', svgFn: _PAT_FNS.diag1 },
  { id: 'diag2', label: 'Diagonale \\', svgFn: _PAT_FNS.diag2 },
  { id: 'cross', label: 'Croisillons', svgFn: _PAT_FNS.cross },
  { id: 'dots', label: 'Points', svgFn: _PAT_FNS.dots },
  { id: 'dashes', label: 'Tirets', svgFn: _PAT_FNS.dashes },
];

/* Résoudre le fill SVG d'une série. chartSize = Math.min(w, h) du graphique. */
function _chartFill(svg, d, idx, blockId, chartSize) {
  const color = d.color || CHART_PALETTE[idx % CHART_PALETTE.length];
  const patDef = CHART_PATTERNS.find(p => p.id === (d.pattern || 'solid'));
  if (!patDef || !patDef.svgFn) return color;
  const uid = `p-${blockId}-${idx}-${d.pattern}`;
  return patDef.svgFn(svg, uid, color, chartSize);
}

/* ── Rendu SVG dans le bloc WYSIWYG ── */
function renderChartInCt(ct, b) {
  const w = b.w - CT_PAD * 2;
  const h = b.h - BAR_H - 8;
  const data = (b.chartData || []).filter(d => d.value > 0);
  const kind = b.chartKind || 'pie';

  const svg = document.createElementNS(_SVG_NS, 'svg');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'fb-chart-svg');
  /* defs injecté dynamiquement par _mkPat */
  svg.style.fontFamily = window.FONTS?.cssFamily || 'sans-serif';

  const titleH = b.chartTitle ? 14 : 0;
  const legItemHpre = Math.max(9, Math.min((b.w - CT_PAD * 2) / 18, 16));
  const legendRows = Math.ceil(data.length / 2);
  const legendH = legendRows * legItemHpre + 4;
  const drawH = Math.max(10, h - titleH - legendH - 8);
  const f2 = n => +n.toFixed(2);

  /* Titre */
  if (b.chartTitle) {
    const tEl = document.createElementNS(_SVG_NS, 'text');
    tEl.setAttribute('x', w / 2); tEl.setAttribute('y', 11);
    tEl.setAttribute('text-anchor', 'middle');
    tEl.setAttribute('font-size', '9'); tEl.setAttribute('font-weight', '700');
    tEl.setAttribute('fill', '#111111');
    tEl.textContent = b.chartTitle;
    svg.appendChild(tEl);
  }

  const drawY = titleH + 4;

  if (!data.length) {
    const msg = document.createElementNS(_SVG_NS, 'text');
    msg.setAttribute('x', w / 2); msg.setAttribute('y', h / 2);
    msg.setAttribute('text-anchor', 'middle');
    msg.setAttribute('font-size', '9'); msg.setAttribute('fill', '#9ca3af');
    msg.textContent = 'Aucune donnée';
    svg.appendChild(msg);
    ct.appendChild(svg);
    ct.appendChild(utag('CHART', 'u-ch'));
    return;
  }

  const CHART_SVG = {
    pie: () => CHART_SVG.donut(),
    donut: () => {
      const cx = w / 2, cy = drawY + drawH / 2;
      const r = Math.min(w / 2, drawH / 2) * 0.85;
      const innerR = kind === 'donut' ? r * 0.5 : 0;
      const total = data.reduce((s, d) => s + d.value, 0);
      let angle = -Math.PI / 2;
      data.forEach((d, idx) => {
        const sweep = (d.value / total) * Math.PI * 2;
        const a1 = angle, a2 = angle + sweep;
        const large = sweep > Math.PI ? 1 : 0;
        const fill = _chartFill(svg, d, idx, b.id, Math.min(w, drawH));
        const pathD = innerR > 0 ? [
          `M ${f2(cx + r * Math.cos(a1))} ${f2(cy + r * Math.sin(a1))}`,
          `A ${f2(r)} ${f2(r)} 0 ${large} 1 ${f2(cx + r * Math.cos(a2))} ${f2(cy + r * Math.sin(a2))}`,
          `L ${f2(cx + innerR * Math.cos(a2))} ${f2(cy + innerR * Math.sin(a2))}`,
          `A ${f2(innerR)} ${f2(innerR)} 0 ${large} 0 ${f2(cx + innerR * Math.cos(a1))} ${f2(cy + innerR * Math.sin(a1))}`,
          'Z',
        ].join(' ') : [
          `M ${f2(cx)} ${f2(cy)}`,
          `L ${f2(cx + r * Math.cos(a1))} ${f2(cy + r * Math.sin(a1))}`,
          `A ${f2(r)} ${f2(r)} 0 ${large} 1 ${f2(cx + r * Math.cos(a2))} ${f2(cy + r * Math.sin(a2))}`,
          'Z',
        ].join(' ');
        const path = document.createElementNS(_SVG_NS, 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', fill);
        path.setAttribute('stroke', '#fff');
        path.setAttribute('stroke-width', '1');
        svg.appendChild(path);
        angle += sweep;
      });
    },
    bar: () => {
      const maxVal = Math.max(...data.map(d => d.value));
      const n = data.length;
      const gap = 3;
      const barW = Math.max(2, (w - gap * (n + 1)) / n);
      /* Grille horizontale légère */
      [0.25, 0.5, 0.75, 1].forEach(frac => {
        const gy = drawY + drawH - frac * (drawH - 4);
        const gl = document.createElementNS(_SVG_NS, 'line');
        gl.setAttribute('x1', 0); gl.setAttribute('y1', f2(gy));
        gl.setAttribute('x2', w); gl.setAttribute('y2', f2(gy));
        gl.setAttribute('stroke', '#e5e7eb'); gl.setAttribute('stroke-width', '0.5');
        svg.appendChild(gl);
      });
      /* Barres */
      data.forEach((d, i) => {
        const barH = (d.value / (maxVal || 1)) * (drawH - 4);
        const bx = gap + i * (barW + gap);
        const by = drawY + drawH - barH;
        const fill = _chartFill(svg, d, i, b.id, Math.min(w, drawH));
        const rect = document.createElementNS(_SVG_NS, 'rect');
        rect.setAttribute('x', f2(bx)); rect.setAttribute('y', f2(by));
        rect.setAttribute('width', f2(barW)); rect.setAttribute('height', f2(barH));
        rect.setAttribute('fill', fill);
        rect.setAttribute('rx', '1');
        svg.appendChild(rect);
      });
      /* Axe X */
      const axEl = document.createElementNS(_SVG_NS, 'line');
      axEl.setAttribute('x1', 0); axEl.setAttribute('y1', f2(drawY + drawH));
      axEl.setAttribute('x2', w); axEl.setAttribute('y2', f2(drawY + drawH));
      axEl.setAttribute('stroke', '#9ca3af'); axEl.setAttribute('stroke-width', '0.75');
      svg.appendChild(axEl);

    },
    line: () => {
      const vals = data.map(d => d.value);
      const maxVal = Math.max(...vals);
      const minVal = Math.min(0, Math.min(...vals));
      const range = (maxVal - minVal) || 1;
      const n = data.length;

      /* Marges pour les étiquettes d'axe */
      const marginL = 22, marginB = 14, marginR = 4, marginT = 2;
      const plotW = w - marginL - marginR;
      const plotH = drawH - marginB - marginT;

      const toX = i => f2(marginL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW));
      const toY = v => f2(drawY + marginT + plotH - ((v - minVal) / range) * plotH);

      /* Grille horizontale + étiquettes Y */
      const yTicks = [0, 0.25, 0.5, 0.75, 1];
      yTicks.forEach(frac => {
        const yVal = minVal + frac * range;
        const gy = toY(yVal);
        const gl = document.createElementNS(_SVG_NS, 'line');
        gl.setAttribute('x1', marginL); gl.setAttribute('y1', gy);
        gl.setAttribute('x2', f2(marginL + plotW)); gl.setAttribute('y2', gy);
        gl.setAttribute('stroke', frac === 0 ? '#9ca3af' : '#e5e7eb');
        gl.setAttribute('stroke-width', frac === 0 ? '0.75' : '0.5');
        svg.appendChild(gl);
        /* Label Y */
        const yt = document.createElementNS(_SVG_NS, 'text');
        yt.setAttribute('x', f2(marginL - 2)); yt.setAttribute('y', f2(+gy + 3));
        yt.setAttribute('text-anchor', 'end');
        yt.setAttribute('font-size', '6'); yt.setAttribute('fill', '#9ca3af');
        yt.textContent = Math.round(yVal);
        svg.appendChild(yt);
      });

      /* Étiquettes X */
      const maxLabels = Math.min(n, Math.floor(plotW / 18));
      const step = Math.max(1, Math.ceil(n / maxLabels));
      data.forEach((d, i) => {
        if (i % step !== 0 && i !== n - 1) return;
        const xt = document.createElementNS(_SVG_NS, 'text');
        xt.setAttribute('x', toX(i));
        xt.setAttribute('y', f2(drawY + marginT + plotH + 11));
        xt.setAttribute('text-anchor', 'middle');
        xt.setAttribute('font-size', '6'); xt.setAttribute('fill', '#9ca3af');
        xt.textContent = d.label.length > 8 ? d.label.slice(0, 7) + '…' : d.label;
        svg.appendChild(xt);
      });

      if (n >= 2) {
        /* Aire sous la courbe (couleur de la 1ère série, semi-transparente) */
        const mainColor = data[0].color || CHART_PALETTE[0];
        const areaPoints = [
          `${toX(0)},${f2(drawY + marginT + plotH)}`,
          ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
          `${toX(n - 1)},${f2(drawY + marginT + plotH)}`,
        ];
        const area = document.createElementNS(_SVG_NS, 'polygon');
        area.setAttribute('points', areaPoints.join(' '));
        area.setAttribute('fill', mainColor);
        area.setAttribute('opacity', '0.10');
        svg.appendChild(area);

        /* Ligne principale */
        const lineEl = document.createElementNS(_SVG_NS, 'polyline');
        lineEl.setAttribute('points', data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' '));
        lineEl.setAttribute('stroke', mainColor);
        lineEl.setAttribute('stroke-width', '1.5');
        lineEl.setAttribute('fill', 'none');
        lineEl.setAttribute('stroke-linejoin', 'round');
        lineEl.setAttribute('stroke-linecap', 'round');
        svg.appendChild(lineEl);
      }

      /* Points avec couleur individuelle */
      data.forEach((d, i) => {
        const ptColor = d.color || CHART_PALETTE[i % CHART_PALETTE.length];
        /* Halo blanc */
        const halo = document.createElementNS(_SVG_NS, 'circle');
        halo.setAttribute('cx', toX(i)); halo.setAttribute('cy', toY(d.value)); halo.setAttribute('r', '3.5');
        halo.setAttribute('fill', '#fff');
        svg.appendChild(halo);
        const dot = document.createElementNS(_SVG_NS, 'circle');
        dot.setAttribute('cx', toX(i)); dot.setAttribute('cy', toY(d.value)); dot.setAttribute('r', '2.5');
        dot.setAttribute('fill', ptColor);
        svg.appendChild(dot);
      });
    },
  };
  (CHART_SVG[kind] || CHART_SVG.pie)();

  /* ── Légende (commune à tous les types) ── */
  /* Taille proportionnelle à la largeur du graphique */
  const legItemH = Math.max(9, Math.min(w / 18, 16));
  const legSq = Math.max(7, legItemH - 2);
  const legFs = Math.max(6, legItemH * 0.62);
  const legGap = Math.max(10, legSq + 3);
  const legendRows2 = Math.ceil(data.length / 2);
  const legY = drawY + drawH + 4;
  const colW = w / 2;
  data.forEach((d, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = col * colW, ly = legY + row * legItemH;
    const fill = _chartFill(svg, d, i, b.id, Math.min(w, drawH));
    const rect = document.createElementNS(_SVG_NS, 'rect');
    rect.setAttribute('x', lx); rect.setAttribute('y', f2(ly + 1));
    rect.setAttribute('width', legSq); rect.setAttribute('height', legSq);
    rect.setAttribute('fill', fill); rect.setAttribute('rx', '1');
    svg.appendChild(rect);
    const lbl = document.createElementNS(_SVG_NS, 'text');
    lbl.setAttribute('x', lx + legGap); lbl.setAttribute('y', f2(ly + legSq * 0.78));
    lbl.setAttribute('font-size', f2(legFs)); lbl.setAttribute('fill', '#374151');
    lbl.textContent = `${d.label} (${d.value})`;
    svg.appendChild(lbl);
  });

  ct.appendChild(svg);
  ct.appendChild(utag('CHART', 'u-ch'));
}

/* ── Rebuild des lignes de données dans le panneau Bloc ── */
function _chartRebuildRows(b) {
  const container = document.getElementById('bchartrows');
  if (!container) return;
  const data = b.chartData || [];

  /* Mise à jour ciblée : si le nombre de lignes n'a pas changé, on met à jour
     les valeurs des champs existants sans recréer le DOM (évite le flash + coût GC). */
  const existingRows = container.querySelectorAll('.chart-row');
  if (existingRows.length === data.length && data.length > 0) {
    data.forEach((d, i) => {
      const row = existingRows[i];
      /* Sélecteur couleur — délégué à _fillColorWrap via makeColorSelect */
      const colorSel = row.querySelector(`#chartcolor-${i}`);
      if (colorSel) {
        const resolved = typeof paletteClosest === 'function'
          ? paletteClosest(d.color || CHART_PALETTE[i % CHART_PALETTE.length])
          : (d.color || CHART_PALETTE[i % CHART_PALETTE.length]);
        if (colorSel.value !== resolved) {
          colorSel.value = resolved;
          const swatch = row.querySelector(`#chartcolor-${i}-swatch`);
          if (swatch) swatch.style.background = resolved;
        }
      }
      /* Motif */
      const patSel = row.querySelector('.chart-pat-sel');
      if (patSel && patSel.value !== (d.pattern || 'solid')) patSel.value = d.pattern || 'solid';
      /* Label */
      const labelIn = row.querySelector('.chart-label-input');
      if (labelIn && labelIn.value !== (d.label || '')) labelIn.value = d.label || '';
      /* Valeur */
      const valIn = row.querySelector('.chart-val-input');
      if (valIn && parseFloat(valIn.value) !== (d.value ?? 0)) valIn.value = d.value ?? 0;
    });
    return;
  }

  /* Reconstruction complète si le nombre de séries a changé */
  container.innerHTML = '';
  data.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'chart-row';

    /* Sélecteur couleur */
    const colorWrap = document.createElement('div');
    colorWrap.id = `chartcolor-wrap-${i}`;
    colorWrap.className = 'chart-color-wrap';
    const colorWidget = makeColorSelect(
      `chartcolor-${i}`,
      d.color || CHART_PALETTE[i % CHART_PALETTE.length],
      hex => { d.color = hex; rr(sid); saveSession(); }
    );
    colorWrap.appendChild(colorWidget);

    /* Sélecteur de motif */
    const patSel = document.createElement('select');
    patSel.className = 'chart-pat-sel';
    patSel.setAttribute('aria-label', 'Motif série ' + (i + 1));
    CHART_PATTERNS.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      if (p.id === (d.pattern || 'solid')) opt.selected = true;
      patSel.appendChild(opt);
    });
    patSel.onchange = () => { d.pattern = patSel.value; rr(sid); saveSession(); };
    patSel.onmousedown = e => e.stopPropagation();

    /* Label */
    const labelIn = document.createElement('input');
    labelIn.type = 'text';
    labelIn.className = 'chart-label-input';
    labelIn.value = d.label || '';
    labelIn.placeholder = 'Étiquette';
    labelIn.setAttribute('aria-label', 'Étiquette série ' + (i + 1));
    labelIn.oninput = () => { d.label = labelIn.value; rr(sid); saveSession(); };
    labelIn.onmousedown = e => e.stopPropagation();

    /* Valeur */
    const valIn = document.createElement('input');
    valIn.type = 'number';
    valIn.className = 'chart-val-input';
    valIn.value = d.value ?? 0;
    valIn.min = '0';
    valIn.setAttribute('aria-label', 'Valeur série ' + (i + 1));
    valIn.oninput = () => { d.value = parseFloat(valIn.value) || 0; rr(sid); saveSession(); };
    valIn.onmousedown = e => e.stopPropagation();

    /* Supprimer */
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'chart-del-btn';
    delBtn.textContent = '×';
    delBtn.setAttribute('aria-label', 'Supprimer série ' + (i + 1));
    delBtn.onclick = e => {
      e.stopPropagation();
      const blk = blockById(sid);
      if (!blk) return;
      blk.chartData.splice(i, 1);
      _chartRebuildRows(blk);
      rr(sid); saveSession();
    };

    /* Ligne 1 : couleur + motif + supprimer */
    const line1 = document.createElement('div');
    line1.className = 'chart-row-line1';
    line1.append(colorWrap, patSel, delBtn);

    /* Ligne 2 : label + valeur */
    const line2 = document.createElement('div');
    line2.className = 'chart-row-line2';
    line2.append(labelIn, valIn);

    row.append(line1, line2);
    container.appendChild(row);
  });
}

/* ── Ajouter une série ── */
function chartAddRow() {
  const b = blockById(sid);
  if (!b || b.type !== 'chart') return;
  const i = (b.chartData || []).length;
  b.chartData = b.chartData || [];
  b.chartData.push({
    label: 'Série ' + (i + 1),
    value: 10,
    color: CHART_PALETTE[i % CHART_PALETTE.length],
    pattern: CHART_PATTERNS[i % CHART_PATTERNS.length].id,
  });
  _chartRebuildRows(b);
  rr(sid); saveSession();
}

function freeformPathD(pts, closed) {
  if (!pts || pts.length < 2) return '';
  const f = n => +n.toFixed(2);
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], cur = pts[i], c1 = prev.cp1, c2 = cur.cp2;
    d += (c1 && c2) ? ` C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(cur.x)} ${f(cur.y)}`
      : c1 ? ` Q ${f(c1.x)} ${f(c1.y)} ${f(cur.x)} ${f(cur.y)}`
        : c2 ? ` Q ${f(c2.x)} ${f(c2.y)} ${f(cur.x)} ${f(cur.y)}`
          : ` L ${f(cur.x)} ${f(cur.y)}`;
  }
  if (closed) d += ' Z';
  return d;
}

/* ── Rendu final dans le bloc ── */
function renderFreeformInCt(ct, b) {
  const w = b.w - CT_PAD * 2;
  const h = b.h - BAR_H - 8;
  const color = b.shapeColor || '#000091';
  const opacity = b.shapeOpacity != null ? b.shapeOpacity : 1;
  const rotation = b.shapeRotation || 0;
  const stroke = b.strokeWidth || 2;
  const filled = b.shapeFilled || false;
  const closed = b.pathClosed !== false;
  const pts = b.pathPoints || [];

  const svg = document.createElementNS(_SVG_NS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'fb-freeform-svg');
  svg.style.opacity = opacity;
  if (rotation) { svg.style.transform = `rotate(${rotation}deg)`; svg.style.transformOrigin = '50% 50%'; }

  if (pts.length >= 2) {
    const pathEl = document.createElementNS(_SVG_NS, 'path');
    pathEl.setAttribute('d', freeformPathD(pts, closed));
    pathEl.setAttribute('stroke', color);
    pathEl.setAttribute('stroke-width', stroke);
    pathEl.setAttribute('stroke-linejoin', 'round');
    pathEl.setAttribute('stroke-linecap', 'round');
    pathEl.setAttribute('fill', filled ? color : 'none');
    svg.appendChild(pathEl);
  } else {
    const txt = document.createElementNS(_SVG_NS, 'text');
    txt.setAttribute('x', w / 2); txt.setAttribute('y', h / 2 + 4);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('font-size', '10'); txt.setAttribute('fill', '#9ca3af');
    txt.textContent = 'Cliquer « Tracer » pour dessiner';
    svg.appendChild(txt);
  }
  ct.appendChild(svg);
  ct.appendChild(utag('LIBRE', 'u-sh'));
}

/* ── OUTIL PLUME — état global ── */
let _ffDraw = null;

/*
  _ffDraw = {
    blockId,
    pts        : Point[] — points finalisés
    overlay    : HTMLElement
    previewSvg : SVGElement
    pg         : HTMLElement (canvas-page)
    bx,by,bw,bh: dimensions du bloc dans la page (pixels)
    dragging   : { startPg:{x,y}, curPg:{x,y}, active:bool }
                 présent pendant le glisser-avant-relâchement
    mousePos   : {x,y}|null  (dernier mouvement souris libre)
  }
*/

/* ── Démarrer le mode tracé ── */
function startFreeformDraw(blockId) {
  if (_ffDraw) cancelFreeformDraw();
  const b = blockById(blockId);
  if (!b) return;
  const pageIdx = Math.floor(b.y / PH);
  const pg = getCanvasPage(pageIdx);
  if (!pg) return;

  const localY = b.y % PH;
  const bx = b.x + CT_PAD;
  const by = localY + BAR_H;
  const bw = b.w - CT_PAD * 2;
  const bh = b.h - BAR_H - 8;

  /* Overlay couvrant toute la page (clics + déplacements) */
  const overlay = document.createElement('div');
  overlay.className = 'ff-overlay';
  pg.appendChild(overlay);

  /* SVG de prévisualisation au-dessus de tout */
  const previewSvg = document.createElementNS(_SVG_NS, 'svg');
  previewSvg.setAttribute('class', 'ff-preview-svg');
  previewSvg.setAttribute('width', PW);
  previewSvg.setAttribute('height', PH);
  /* Deux calques : ff-static (points validés) et ff-ghost (segment courant + poignées)
     → mousemove ne vide et ne reconstruit que ff-ghost, pas l'ensemble du SVG */
  const ffStatic = document.createElementNS(_SVG_NS, 'g');
  ffStatic.setAttribute('id', 'ff-static');
  const ffGhost = document.createElementNS(_SVG_NS, 'g');
  ffGhost.setAttribute('id', 'ff-ghost');
  previewSvg.appendChild(ffStatic);
  previewSvg.appendChild(ffGhost);
  pg.appendChild(previewSvg);

  _ffDraw = { blockId, pts: [], overlay, previewSvg, ffStatic, ffGhost, pg, bx, by, bw, bh, dragging: null, mousePos: null };

  _ffRedraw();
  overlay.addEventListener('mousedown', _ffMouseDown);
  overlay.addEventListener('mousemove', _ffMouseMoveIdle);
  overlay.addEventListener('dblclick', _ffDblClick);
  document.addEventListener('keydown', _ffKeyDown);
  announce('Mode tracé — Clic : point · Glisser : courbe · Double-clic / Entrée : terminer · Échap : annuler');
}

/* ── Coordonnées souris dans le repère de la page ── */
function _ffPg(e) {
  const r = _ffDraw.pg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
/* ── Coordonnées dans le repère du bloc (pour stockage) ── */
function _ffLocal(pgX, pgY) {
  return {
    x: +(pgX - _ffDraw.bx).toFixed(1),
    y: +(pgY - _ffDraw.by).toFixed(1)
  };
}

/* ── Mousedown sur l'overlay : début d'un point ── */
function _ffMouseDown(e) {
  if (e.detail >= 2) return; // double-clic géré ailleurs
  e.preventDefault(); e.stopPropagation();

  const startPg = _ffPg(e);
  _ffDraw.dragging = { startPg, curPg: { ...startPg }, active: false };
  _ffRedraw();

  function onMove(mv) {
    const cur = _ffPg(mv);
    const dx = cur.x - startPg.x, dy = cur.y - startPg.y;
    if (!_ffDraw.dragging.active && Math.hypot(dx, dy) > 5) {
      _ffDraw.dragging.active = true;
    }
    _ffDraw.dragging.curPg = cur;
    _ffDraw.mousePos = cur;
    _ffRedraw();
  }
  function onUp(up) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    _ffCommitPoint(up);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ── Mouvement libre (pas de bouton enfoncé) ── */
function _ffMouseMoveIdle(e) {
  _ffDraw.mousePos = _ffPg(e);
  _ffRedraw();
}

/* ── Valider un point au relâchement du bouton ── */
function _ffCommitPoint(e) {
  const d = _ffDraw;
  const endPg = _ffPg(e);
  const pt = _ffLocal(endPg.x, endPg.y);

  if (d.dragging && d.dragging.active) {
    /* Glisser → courbe de Bézier
       La direction du glisser définit la tangente au point.
       cp2 (handle entrant) = symétrique de la direction par rapport au point.
       cp1 (handle sortant) = dans la direction du glisser (pour le segment suivant). */
    const sp = d.dragging.startPg;
    const dx = endPg.x - sp.x, dy = endPg.y - sp.y;
    const TENSION = 0.4;
    pt.cp2 = _ffLocal(endPg.x - dx * TENSION, endPg.y - dy * TENSION);
    pt.cp1 = _ffLocal(endPg.x + dx * TENSION, endPg.y + dy * TENSION);
  }
  /* pas de glisser → point angulaire, ni cp1 ni cp2 */

  d.pts.push(pt);
  d.dragging = null;
  d.mousePos = _ffPg(e);
  d._staticDirty = true; // invalider le calque statique
  _ffRedraw();
}

/* ── Double-clic : terminer ── */
function _ffDblClick(e) {
  e.preventDefault();
  /* Le dernier mousedown a déjà ajouté un point : on le retire */
  if (_ffDraw.pts.length > 0) _ffDraw.pts.pop();
  finalizeFreeformDraw(false);
}

/* ── Clavier ── */
function _ffKeyDown(e) {
  if (e.key === 'Escape') { e.preventDefault(); cancelFreeformDraw(); }
  if (e.key === 'Enter') { e.preventDefault(); finalizeFreeformDraw(false); }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    if (_ffDraw.pts.length > 0) { _ffDraw.pts.pop(); _ffDraw._staticDirty = true; _ffRedraw(); }
  }
}


/* ══════════════════════════════════════════════════════════════════
   DESSIN DU PREVIEW — la partie clé
   On dessine :
   1. Le chemin déjà tracé (pts validés)
   2. Le segment fantôme vers la souris :
      - simple ligne si pas de glisser en cours
      - courbe de Bézier cubique live si glisser actif
   3. Les poignées Bézier du dernier point et du point en cours
   4. Les ancres de tous les points
   5. Le cadre du bloc
   ══════════════════════════════════════════════════════════════════ */

function _ffRedraw() {
  if (!_ffDraw) return;
  const { pts, bx, by, bw, bh, dragging, mousePos, previewSvg, ffStatic, ffGhost } = _ffDraw;

  /* helpers SVG */
  const mk = tag => document.createElementNS(_SVG_NS, tag);

  /* ─ Calque statique : chemin validé + ancres + poignées validées + cadre
     Ne reconstruit le calque statique que si demandé par _ffRedrawStatic()
     (au commit d'un point, pas à chaque mousemove). */
  if (_ffDraw._staticDirty !== false) {
    while (ffStatic.firstChild) ffStatic.removeChild(ffStatic.firstChild);

    /* ─ 1. Chemin tracé ─ */
    if (pts.length >= 2) {
      const svgPts = pts.map(p => ({
        x: p.x + bx, y: p.y + by,
        cp1: p.cp1 ? { x: p.cp1.x + bx, y: p.cp1.y + by } : null,
        cp2: p.cp2 ? { x: p.cp2.x + bx, y: p.cp2.y + by } : null,
      }));
      const pathEl = mk('path');
      pathEl.setAttribute('d', freeformPathD(svgPts, false));
      pathEl.setAttribute('stroke', '#3b82f6');
      pathEl.setAttribute('stroke-width', '2');
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('stroke-linejoin', 'round');
      pathEl.setAttribute('stroke-linecap', 'round');
      ffStatic.appendChild(pathEl);
    }

    /* ─ 3. Poignées Bézier des points validés ─ */
    pts.forEach(p => {
      const ax = p.x + bx, ay = p.y + by;
      if (p.cp1) _ffDrawHandle(ffStatic, mk, ax, ay, p.cp1.x + bx, p.cp1.y + by, '#f59e0b');
      if (p.cp2) _ffDrawHandle(ffStatic, mk, ax, ay, p.cp2.x + bx, p.cp2.y + by, '#a78bfa');
    });

    /* ─ 4. Ancres ─ */
    pts.forEach((p, i) => _ffDrawAnchor(ffStatic, mk, p.x + bx, p.y + by, i === 0, false));

    /* ─ 5. Cadre du bloc ─ */
    const frame = mk('rect');
    frame.setAttribute('x', bx); frame.setAttribute('y', by);
    frame.setAttribute('width', bw); frame.setAttribute('height', bh);
    frame.setAttribute('fill', 'none');
    frame.setAttribute('stroke', '#3b82f6');
    frame.setAttribute('stroke-width', '1');
    frame.setAttribute('stroke-dasharray', '6 3');
    frame.setAttribute('rx', '2');
    ffStatic.appendChild(frame);

    _ffDraw._staticDirty = false;
  }

  /* ─ Calque fantôme : segment vers la souris + poignées live
     Vidé et reconstruit à chaque mousemove (contenu minimal). ─ */
  while (ffGhost.firstChild) ffGhost.removeChild(ffGhost.firstChild);

  /* ─ 2. Segment fantôme vers la souris ─ */
  const targetPos = dragging ? dragging.curPg : mousePos;

  if (pts.length >= 1 && targetPos) {
    const lastPt = pts[pts.length - 1];
    const lastSvgX = lastPt.x + bx, lastSvgY = lastPt.y + by;

    if (dragging && dragging.active) {
      const sp = dragging.startPg;
      const ep = dragging.curPg;
      const dx = ep.x - sp.x, dy = ep.y - sp.y;
      const TENSION = 0.4;
      const newPtX = sp.x, newPtY = sp.y;
      const c2x = sp.x - dx * TENSION, c2y = sp.y - dy * TENSION;
      const c1x = sp.x + dx * TENSION, c1y = sp.y + dy * TENSION;
      const c1Prev = lastPt.cp1 ? { x: lastPt.cp1.x + bx, y: lastPt.cp1.y + by }
        : { x: lastSvgX, y: lastSvgY };
      const ghostPath = mk('path');
      ghostPath.setAttribute('d',
        `M ${lastSvgX} ${lastSvgY} C ${c1Prev.x} ${c1Prev.y} ${c2x} ${c2y} ${newPtX} ${newPtY}`
      );
      ghostPath.setAttribute('stroke', '#60a5fa');
      ghostPath.setAttribute('stroke-width', '1.5');
      ghostPath.setAttribute('stroke-dasharray', '6 3');
      ghostPath.setAttribute('fill', 'none');
      ffGhost.appendChild(ghostPath);
      _ffDrawHandle(ffGhost, mk, newPtX, newPtY, c1x, c1y, '#f59e0b');
      _ffDrawHandle(ffGhost, mk, newPtX, newPtY, c2x, c2y, '#a78bfa');
      _ffDrawAnchor(ffGhost, mk, newPtX, newPtY, false, true);
    } else {
      const tx = targetPos.x, ty = targetPos.y;
      const ghostD = lastPt.cp1
        ? `M ${lastSvgX} ${lastSvgY} Q ${lastPt.cp1.x + bx} ${lastPt.cp1.y + by} ${tx} ${ty}`
        : `M ${lastSvgX} ${lastSvgY} L ${tx} ${ty}`;
      const ghostLine = mk('path');
      ghostLine.setAttribute('d', ghostD);
      ghostLine.setAttribute('stroke', '#93c5fd');
      ghostLine.setAttribute('stroke-width', '1');
      ghostLine.setAttribute('stroke-dasharray', '4 3');
      ghostLine.setAttribute('fill', 'none');
      ffGhost.appendChild(ghostLine);
    }
  }

  /* ─ 6. Compteur (mis à jour à chaque mousemove) ─ */
  if (pts.length > 0) {
    const ctr = mk('text');
    ctr.setAttribute('x', bx + bw - 4); ctr.setAttribute('y', by - 6);
    ctr.setAttribute('text-anchor', 'end');
    ctr.setAttribute('font-size', '10'); ctr.setAttribute('fill', '#3b82f6');
    ctr.textContent = pts.length + ' pt' + (pts.length > 1 ? 's' : '') +
      (dragging && dragging.active ? '  ↗ courbe…' : '');
    ffGhost.appendChild(ctr);
  }
}

function _ffDrawHandle(svg, mk, ax, ay, hx, hy, color) {
  const line = mk('line');
  line.setAttribute('x1', ax); line.setAttribute('y1', ay); line.setAttribute('x2', hx); line.setAttribute('y2', hy);
  line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1'); line.setAttribute('stroke-dasharray', '2 2');
  svg.appendChild(line);
  const dot = mk('circle');
  dot.setAttribute('cx', hx); dot.setAttribute('cy', hy); dot.setAttribute('r', '3.5');
  dot.setAttribute('fill', color); dot.setAttribute('stroke', 'white'); dot.setAttribute('stroke-width', '1.5');
  svg.appendChild(dot);
}

function _ffDrawAnchor(svg, mk, cx, cy, isFirst, isGhost) {
  const dot = mk('circle');
  dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', isFirst ? 5.5 : 4);
  dot.setAttribute('fill', isGhost ? 'none' : isFirst ? '#1d4ed8' : 'white');
  dot.setAttribute('stroke', isGhost ? '#60a5fa' : isFirst ? '#1d4ed8' : '#3b82f6');
  dot.setAttribute('stroke-width', '2');
  if (isGhost) dot.setAttribute('stroke-dasharray', '2 1');
  svg.appendChild(dot);
}

function finalizeFreeformDraw(cancelled) {
  if (!_ffDraw) return;
  const { blockId, pts, overlay, previewSvg } = _ffDraw;
  overlay.remove(); previewSvg.remove();
  document.removeEventListener('keydown', _ffKeyDown);
  _ffDraw = null;
  if (!cancelled && pts.length >= 2) {
    snapshotState();
    const b = blockById(blockId);
    if (b) { b.pathPoints = pts; const ct = document.getElementById('ct-' + b.id); if (ct) fillCt(ct, b); sel(b.id); switchTab('bloc'); }
    saveSession();
    announce('Forme libre tracée — ' + pts.length + ' points. Ctrl+Z pour annuler.');
  } else { announce('Tracé annulé.'); }
}
function cancelFreeformDraw() { finalizeFreeformDraw(true); }

function editFreeformPath(id) {
  const b = blockById(id);
  if (!b || b.type !== 'freeform') return;
  b.pathPoints = [];
  const ct = document.getElementById('ct-' + b.id);
  if (ct) fillCt(ct, b);
  startFreeformDraw(id);
}

function utag(txt, cls) {
  const s = document.createElement('span');
  s.className = 'utag ' + cls;
  s.textContent = txt;
  s.setAttribute('aria-hidden', 'true');
  return s;
}

/* ── DÉPLACEMENT AU CLAVIER ─────────────────────────────────────────────
   Appelée depuis le listener keydown du wrapper .fb (blocks.js : buildEl)
   et depuis le listener keydown unifié (ci-dessous).

   Pas de modificateur     → pas (ou grille si activée)
   Shift                   → grand pas (10 × pas de base ou taille de grille)
   Ctrl/⌘                  → redimensionnement (largeur/hauteur) au lieu du déplacement

   Le pas de base est égal à la taille de la grille si le magnétisme est actif,
   sinon 1 px (précision pixel) ou 2 px (Shift = 20 px).
────────────────────────────────────────────────────────────────────────── */

/* État de la touche maintenue : on ne fait snapshotState qu'au premier appui
   d'une séquence, pas à chaque répétition auto. */
let _keyMoveLastId = null;
let _keyMoveActive = false;
let _keyMoveTreeTimer = null;
let _keyMoveSaveTimer = null;

function moveBlockByKey(id, key, shift, resize) {
  const b = blockById(id);
  if (!b) return;

  const step = gridEnabled ? gridSize : 1;
  const big = gridEnabled ? gridSize * 10 : 10;
  const delta = shift ? big : step;

  const pageIdx = Math.floor(b.y / PH);
  const pw = pageW(pageIdx);
  const ph = pageH(pageIdx);
  const isDecorative = b.type === 'shape' || b.type === 'freeform' || b.type === 'hr';

  /* Snapshot uniquement au premier appui d'une nouvelle séquence de déplacement */
  if (_keyMoveLastId !== id || !_keyMoveActive) {
    snapshotState();
    _keyMoveLastId = id;
    _keyMoveActive = true;
    /* Réinitialiser le flag après un court délai (fin de frappe maintenue) */
    clearTimeout(_keyMoveTreeTimer);
    clearTimeout(_keyMoveSaveTimer);
  }

  if (resize) {
    /* Ctrl/⌘ + flèche : redimensionner */
    const minW = isDecorative ? 1 : 80;
    const minH = isDecorative ? 1 : 28;
    const mar = isDecorative ? 0 : MAR;
    const maxW = pw - mar - b.x;
    if (key === 'ArrowRight') b.w = Math.min(maxW, snapVal(b.w + delta));
    if (key === 'ArrowLeft') b.w = Math.max(minW, snapVal(b.w - delta));
    if (key === 'ArrowDown') b.h = snapVal(b.h + delta);
    if (key === 'ArrowUp') b.h = Math.max(minH, snapVal(b.h - delta));
  } else {
    /* Flèche seule ou Shift+flèche : déplacer */
    const mar = isDecorative ? 0 : MAR;
    const minY = pageIdx * PH + mar;
    if (key === 'ArrowRight') b.x = isDecorative ? snapVal(b.x + delta) : Math.min(pw - mar - b.w, snapVal(b.x + delta));
    if (key === 'ArrowLeft') b.x = isDecorative ? snapVal(b.x - delta) : Math.max(mar, snapVal(b.x - delta));
    if (key === 'ArrowDown') b.y = snapVal(b.y + delta);
    if (key === 'ArrowUp') b.y = Math.max(minY, snapVal(b.y - delta));
  }

  /* Mettre à jour le DOM — immédiat (fluidité visuelle) */
  const domEl = document.getElementById('el-' + b.id);
  if (domEl) {
    domEl.style.left = b.x + 'px';
    domEl.style.top = (b.y % PH) + 'px';
    domEl.style.width = b.w + 'px';
    domEl.style.height = b.h + 'px';
    /* Si le bloc a changé de page (déplacement vers le bas) */
    const newPageIdx = Math.floor(b.y / PH);
    if (newPageIdx !== pageIdx) {
      const pg = getCanvasPage(newPageIdx);
      if (pg) pg.appendChild(domEl);
    }
  }

  /* Mettre à jour le aria-label du wrapper */
  if (typeof _updateBlockAriaLabel === 'function') _updateBlockAriaLabel(b);

  updBP(); // léger grâce au cache _bpKey — toujours immédiat

  /* updTree et saveSession sont debouncés : inutile de les appeler à chaque
     répétition auto (typiquement 30-60 Hz). On déclenche en fin de frappe. */
  clearTimeout(_keyMoveTreeTimer);
  clearTimeout(_keyMoveSaveTimer);

  const hasNoteAnchors = b.type !== 'note' && RICH_TYPES.has(b.type) &&
    document.getElementById('ct-' + b.id)?.querySelector('sup[data-note-id]');

  _keyMoveTreeTimer = setTimeout(() => {
    if (hasNoteAnchors || b.type === 'note') renumberNotes();
    updTree();
    _keyMoveActive = false; // fin de séquence → prochain appui = nouveau snapshot
  }, 200);

  _keyMoveSaveTimer = setTimeout(() => {
    saveSession();
  }, 400);
}

function useDrag(handle, { onStart, onMove, onEnd, guard } = {}) {
  handle.addEventListener('mousedown', e => {
    if (guard?.(e)) return;
    e.preventDefault(); e.stopPropagation();
    const ctx = onStart?.(e) ?? {};
    let _rafPending = false;
    let _lastE = null;
    const move = e => {
      _lastE = e;
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(() => {
        _rafPending = false;
        if (_lastE) onMove?.(_lastE, ctx);
      });
    };
    const up = e => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      onEnd?.(e, ctx);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

/* ── DRAG — DÉPLACEMENT ── */
function attachDrag(bar, el, b) {
  useDrag(bar, {
    guard: e => !!e.target.closest('.fb-del'),
    onStart: e => { sel(b.id); snapshotState(); el.classList.add('moving'); return { startX: e.clientX, startY: e.clientY, origX: b.x, origY: b.y }; },
    onMove: (e, { startX, startY, origX, origY }) => {
      const pageIdx = Math.floor(b.y / PH);
      const isDecorative = b.type === 'shape' || b.type === 'freeform' || b.type === 'hr';
      const mar = isDecorative ? 0 : MAR;
      const newX = origX + (e.clientX - startX);
      b.x = snapVal(isDecorative ? newX : Math.max(mar, Math.min(pageW(pageIdx) - mar - b.w, newX)));
      const newY = origY + (e.clientY - startY);
      const minY = pageIdx * PH + (isDecorative ? 0 : mar);
      b.y = snapVal(Math.max(minY, newY));
      el.style.left = b.x + 'px'; el.style.top = (b.y % PH) + 'px';
      if (Math.floor(b.y / PH) !== pageIdx) { const pg = getCanvasPage(Math.floor(b.y / PH)); if (pg) pg.appendChild(el); }
      updBP();
    },
    onEnd: () => {
      el.classList.remove('moving');
      const hasNoteAnchors = b.type !== 'note' && RICH_TYPES.has(b.type) && document.getElementById('ct-' + b.id)?.querySelector('sup[data-note-id]');
      if (hasNoteAnchors || b.type === 'note') renumberNotes();
      updTree(); saveSession();
    },
  });
}

/* ── RESIZE ── */
function attachRsz(rsz, el, b) {
  useDrag(rsz, {
    onStart: e => ({ sx: e.clientX, sy: e.clientY, sw: b.w, sh: b.h }),
    onMove: (e, { sx, sy, sw, sh }) => {
      const isDecorative = b.type === 'shape' || b.type === 'freeform' || b.type === 'hr';
      const mar = isDecorative ? 0 : MAR;
      const maxW = pageW(Math.floor(b.y / PH)) - mar - b.x;
      const minW = isDecorative ? 1 : 80;
      const minH = isDecorative ? 1 : 28;
      b.w = Math.max(minW, Math.min(maxW, snapVal(sw + (e.clientX - sx))));
      b.h = Math.max(minH, snapVal(sh + (e.clientY - sy)));
      el.style.width = b.w + 'px'; el.style.height = b.h + 'px'; updBP();
    },
    onEnd: () => saveSession(),
  });
}

/* ── ROTATION ── */
function attachRot(handle, el, b) {
  useDrag(handle, {
    onStart: e => {
      snapshotState();
      const rect = el.getBoundingClientRect();
      return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, startAngle: Math.atan2(e.clientY - (rect.top + rect.height / 2), e.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI, startRot: b.shapeRotation || 0 };
    },
    onMove: (e, { cx, cy, startAngle, startRot }) => {
      b.shapeRotation = ((Math.round(startRot + Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI - startAngle) % 360) + 360) % 360;
      const ct = document.getElementById('ct-' + b.id); if (ct) fillCt(ct, b); updBP();
    },
    onEnd: () => saveSession(),
  });
}


/* ── MODALE PRÉVISUALISATION ── */
/* ── CLAVIER GLOBAL ── */
/* Géré dans le listener unifié ci-dessous avec openModal/closeModal. */

/* Clic sur le fond de la page = désélection */
pageWrap.addEventListener('mousedown', e => { if (e.target === pageWrap) desel(); });
/* Touch : tap sur le fond = désélection */
pageWrap.addEventListener('touchend', e => { if (e.target === pageWrap && e.changedTouches.length === 1) desel(); }, { passive: true });

/* ── RÉGION LIVE — ANNONCES AT ── */
function announce(msg, priority) {
  const t = document.getElementById('toast');
  clearTimeout(t._timer);
  // Erreurs et avertissements → assertive pour interrompre les AT immédiatement
  const isUrgent = /^⚠|erreur|impossible/i.test(msg);
  t.setAttribute('aria-live', (priority === 'assertive' || isUrgent) ? 'assertive' : 'polite');
  /* Vider d'abord pour forcer la re-lecture par les AT, puis injecter */
  t.textContent = '';
  t.style.display = 'block';
  requestAnimationFrame(() => {
    t.textContent = msg;
    t._timer = setTimeout(() => {
      t.style.display = 'none';
      t.textContent = '';
      // Réinitialiser en polite après disparition
      t.setAttribute('aria-live', 'polite');
    }, 4000);
  });
}
/* ── GESTION GÉNÉRIQUE DES MODALES (<dialog>) ── */

/* Sélecteur des éléments focusables dans une modale */
const _FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/* Mémoire de l'élément déclencheur pour la restauration du focus */
let _modalTrigger = null;
/* Map modalId → gestionnaire keydown de focus trap */
const _modalTrapHandlers = new Map();

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal || modal.open) return;

  modal.showModal();
  document.body.style.overflow = 'hidden';

  /* Focus initial sur le premier élément interactif */
  requestAnimationFrame(() => {
    const focusables = [...modal.querySelectorAll(_FOCUSABLE)].filter(
      el => !el.closest('[hidden]') && el.offsetParent !== null
    );
    if (focusables.length) focusables[0].focus();
  });

  function _trapHandler(e) {
    if (e.key !== 'Tab') return;
    const focusables = [...modal.querySelectorAll(_FOCUSABLE)].filter(
      el => !el.closest('[hidden]') && el.offsetParent !== null
    );
    if (!focusables.length) { e.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || !modal.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !modal.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  modal.addEventListener('keydown', _trapHandler);
  _modalTrapHandlers.set(modalId, _trapHandler);
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal || !modal.open) return;

  /* Retirer le focus trap */
  const handler = _modalTrapHandlers.get(modalId);
  if (handler) { modal.removeEventListener('keydown', handler); _modalTrapHandlers.delete(modalId); }

  modal.close();
  if (!document.querySelector('dialog[open]')) {
    document.body.style.overflow = '';
  }
  /* Restaurer le focus sur l'élément déclencheur */
  if (_modalTrigger && typeof _modalTrigger.focus === 'function') {
    _modalTrigger.focus({ preventScroll: true });
  }
  _modalTrigger = null;
}

/* Écouteur global UNIQUE pour l'ouverture et la fermeture des modales */
document.addEventListener('click', e => {
  // 1. Clic sur un bouton d'ouverture
  const openBtn = e.target.closest('[data-open-modal]');
  if (openBtn) {
    _modalTrigger = openBtn;
    const modalId = openBtn.getAttribute('data-open-modal');
    openModal(modalId);
    return;
  }

  // 2. Clic sur un bouton de fermeture
  const closeBtn = e.target.closest('[data-close-modal]');
  if (closeBtn) {
    const modal = closeBtn.closest('dialog');
    if (modal) closeModal(modal.id);
    return;
  }

  // 3. Clic sur le fond grisé (backdrop) pour fermer
  if (e.target.tagName === 'DIALOG' && e.target.open) {
    closeModal(e.target.id);
  }
});

/* Synchro fermeture native (touche Échap) → nettoyer le trap et restaurer le focus */
document.addEventListener('close', e => {
  if (e.target.tagName !== 'DIALOG') return;
  const handler = _modalTrapHandlers.get(e.target.id);
  if (handler) { e.target.removeEventListener('keydown', handler); _modalTrapHandlers.delete(e.target.id); }
  if (!document.querySelector('dialog[open]')) document.body.style.overflow = '';
  if (_modalTrigger && typeof _modalTrigger.focus === 'function') {
    _modalTrigger.focus({ preventScroll: true });
  }
  _modalTrigger = null;
  /* Vider l'iframe PDF à la fermeture de la modale de prévisualisation */
  if (e.target.id === 'prev-modal') {
    setTimeout(() => { const pif = document.getElementById('pif'); if (pif) pif.src = 'about:blank'; }, 300);
  }
}, true /* capture : l'événement close ne remonte pas */);

/* ── CLAVIER GLOBAL UNIFIÉ ────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const active = document.activeElement;
  const isEditing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
    active.tagName === 'SELECT' || active.isContentEditable);

  /* 1. Ctrl+Delete/Backspace dans un tableau : supprimer la ligne courante */
  if (e.ctrlKey && (e.key === 'Delete' || e.key === 'Backspace')) {
    if (active && active.closest('.fb-table-el')) {
      e.preventDefault();
      const currentRow = active.closest('tr');
      const tbody = active.closest('tbody');
      if (currentRow && tbody) {
        if (tbody.querySelectorAll('tr').length <= 1) {
          if (typeof announce === 'function') announce('⚠ Impossible de supprimer la dernière ligne du tableau.');
          return;
        }
        currentRow.remove();
        if (typeof updTree === 'function') updTree();
      }
      return;
    }
  }

  /* 2. Raccourcis éditeur (uniquement si aucune modale n'est ouverte) */
  if (!document.querySelector('dialog[open]')) {
    /* Ctrl+Z / ⌘Z */
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      if (isEditing && active.isContentEditable) return;
      e.preventDefault();
      if (typeof undoLast === 'function') undoLast();
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && typeof sid !== 'undefined' && sid && !isEditing) {
      e.preventDefault();
      if (typeof rmB === 'function') rmB(sid);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'd' && typeof sid !== 'undefined' && sid && !isEditing) {
      e.preventDefault();
      if (typeof dupB === 'function') dupB(sid);
    }
    /* Flèches : déplacer (ou Ctrl+flèche = redimensionner) le bloc sélectionné */
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
      typeof sid !== 'undefined' && sid && !isEditing) {
      e.preventDefault();
      if (typeof moveBlockByKey === 'function') {
        moveBlockByKey(sid, e.key, e.shiftKey, e.ctrlKey || e.metaKey);
      }
    }
    if (e.key === 'Escape' && typeof sid !== 'undefined' && sid) {
      if (typeof desel === 'function') desel();
    }
  }
});