// pdf-renderers.js — Renderers PDF des blocs texte, media, structure

function emitRichRuns(doc, parentStruct, runs, x, y, w, h, fontSize, color, extraOpts) {
  if (!runs.length) {
    parentStruct.add(doc.struct('Span', () => {
      doc.fontSize(fontSize).font('Regular').fillColor(color)
        .text(' ', x, y, { width: w, height: h, lineBreak: false });
    }));
    return;
  }

  /* Regrouper les runs en segments séparés par '\n'. */
  const segments = _parseSegments(runs);

  if (!segments.length) return;

  /* Hauteur approximative d'une ligne — permet de positionner les segments suivants */
  const lineH = fontSize * 1.6;
  let curY = y;
  let isVeryFirst = true;

  segments.forEach((seg, segIdx) => {
    if (!seg.length) { curY += lineH; return; }

    const segRuns = seg;
    const totalInSeg = segRuns.length;
    let skipNext = false;

    segRuns.forEach((run, idx) => {
      if (skipNext) { skipNext = false; return; }

      const isFirst = isVeryFirst;
      const isLastRun = idx === totalInSeg - 1;
      isVeryFirst = false;

      const defaultBold = extraOpts.bold || false;
      const runFont = (run.bold || defaultBold) ? (run.italic ? 'BoldItalic' : 'Bold') : run.italic ? 'Italic' : 'Regular';
      const runNoteId = run.noteId || null;
      const runColor = run.linkUrl ? LINK_COLOR : runNoteId ? LINK_COLOR : color;
      const runText = run.text;
      const runLink = run.linkUrl || null;
      const runAlt = run.linkText || run.text;

      const layoutOpts = Object.assign(
        { width: w, lineBreak: true, ellipsis: true, continued: !isLastRun },
        isFirst ? { height: h } : {},
        extraOpts,
        runLink ? { link: runLink, underline: true } : {}
      );

      const captureX = isFirst ? x : undefined;
      const captureY = isFirst ? curY : undefined;
      const captFirst = isFirst;

      const drawFn = () => {
        doc.fontSize(fontSize).font(runFont).fillColor(runColor);
        if (captFirst) doc.text(runText, captureX, captureY, layoutOpts);
        else doc.text(runText, layoutOpts);
      };

      const RUN_EMIT = {
        note: () => {
          const captNoteId = runNoteId;
          const nextRun = !isLastRun ? segRuns[idx + 1] : null;
          if (nextRun && !nextRun.noteId) skipNext = true;
          const isEffectivelyLast = isLastRun || (nextRun && !nextRun.noteId ? idx + 1 === totalInSeg - 1 : isLastRun);
          const refS = doc.struct('Reference');
          parentStruct.add(refS);
          const lnkS = doc.struct('Link', { alt: 'Note ' + runText });
          refS.add(lnkS);
          lnkS.add(() => {
            const cx = doc.x, cy = doc.y;
            const supFontSize = fontSize * 0.58;
            const supRise = fontSize * 0.38;
            doc.fontSize(supFontSize).font(runFont).fillColor(LINK_COLOR);
            const supW = doc.widthOfString(runText) + 1;
            doc.text(runText, cx, cy - supRise, { lineBreak: false, continued: true, width: supW + 4, height: supFontSize * 1.5, underline: false });
            doc.goTo(cx, cy - supRise, supW + 2, supFontSize * 1.5, 'note-' + captNoteId, { structParent: lnkS });
          });
          lnkS.end(); refS.end();
          parentStruct.add(() => {
            doc.fontSize(fontSize).font(runFont).fillColor(color);
            if (nextRun && !nextRun.noteId) {
              doc.fontSize(fontSize).font(nextRun.bold ? 'Bold' : nextRun.italic ? 'Italic' : 'Regular').fillColor(nextRun.linkUrl ? LINK_COLOR : color);
              doc.text(nextRun.text, { lineBreak: false, continued: !isEffectivelyLast, ellipsis: true, link: nextRun.linkUrl || undefined, underline: !!nextRun.linkUrl });
            } else if (!isLastRun) {
              doc.text('', { continued: true, lineBreak: false });
            } else {
              try { doc.text('', { continued: false }); } catch (_) { }
            }
          });
        },
        link: () => {
          const lnkS = doc.struct('Link', { alt: runAlt });
          lnkS.add(drawFn); lnkS.end();
          parentStruct.add(lnkS);
        },
        normal: () => parentStruct.add(drawFn),
      };
      (runNoteId ? RUN_EMIT.note : runLink ? RUN_EMIT.link : RUN_EMIT.normal)();
    });

    /* Après le dernier run du segment, PDFKit a avancé son curseur y.
       On l'enregistre pour le segment suivant (approximation). */
    curY += lineH;

    /* Clore explicitement le flux continued après chaque segment */
    try { doc.text('', { continued: false }); } catch (_) { }
  });
}

  /* ── Helpers de coordonnées ─────────────────────────────────────────
     Dans l'IHM, chaque bloc .fb a :
       position CSS : (b.x, b.y % PH)
       La barre de titre flotte en dehors du bloc (top:-20px) — elle ne
       consomme plus de hauteur de contenu (BAR_H = 0).
       padding ct   : CT_PAD = 6 px gauche/droite, 4 px haut/bas
     Donc la zone de contenu commence à :
       ox = b.x + CT_PAD
       oy = b.y - pageTop          (BAR_H = 0)
     et mesure :
       cw = b.w - CT_PAD * 2
       ch = b.h - 8
     ──────────────────────────────────────────────────────────────── */
  const ctCoords = (b) => {
    const pageTop = Math.floor(b.y / PH) * PH;
    return {
      ox: b.x + CT_PAD,
      oy: b.y - pageTop + BAR_H,
      cw: Math.max(10, b.w - CT_PAD * 2),
      ch: Math.max(4, b.h - BAR_H - 8),
    };
  };

  /* ── Helper : appliquer rotation CTM autour du centre d'une zone ── */
  const withRotation = (doc, cx, cy, deg, fn) => {
    if (!deg) { fn(); return; }
    doc.save();
    doc.translate(cx, cy).rotate(deg, { origin: [0, 0] }).translate(-cx, -cy);
    fn();
    doc.restore();
  };

  /* ══════════════════════════════════════════════════════════════════
     TABLE DE DISPATCH — un renderer par type de bloc
     Chaque renderer reçoit (doc, docStruct, b) et est responsable
     de créer sa structure PDF/UA et de dessiner.
     ══════════════════════════════════════════════════════════════════ */
  const BLOCK_RENDERERS = {

    /* ── Titres ── */
    ...Object.fromEntries(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(t => [t, _renderHeading])),

    /* ── Paragraphe ── */
    p(doc, ds, b) {
      const { ox, oy, cw, ch } = ctCoords(b);
      const runs = htmlToRuns(b.richContent || b.content || '');
      const pS = doc.struct('P');
      ds.add(pS);
      emitRichRuns(doc, pS, runs, ox, oy, cw, ch, b.fontSize || FS.p, '#111111', { lineGap: 2 });
      pS.end();
    },

    /* ── Listes ── */
    ul: _renderList, ol: _renderList,

    /* ── Image ── */
    img(doc, ds, b) {
      if (!b.imgData) return;
      const ix = b.x, iy = b.y - Math.floor(b.y / PH) * PH;
      const iw = b.w, ih = b.h;

      if (b.imgLinkUrl) {
        /* Image cliquable : structure Link seul, sans Figure enfant.
           Mettre Figure dans Link génère systématiquement le warning PAC
           "possibly inappropriate use of Figure" (Matterhorn Protocol) car
           Figure enfant de Link est un pattern jugé ambigu par les validateurs.
           Solution conforme PDF/UA-1 : l'image est dessinée dans le callback
           du Link, Alt sur Link = description image + destination.
           Structure résultante : Link → [OBJR, MCR(image)] — valide, sans warning. */
        const alt = b.alt
          ? b.alt + (b.imgLinkUrl ? ' — ' + b.imgLinkUrl : '')
          : b.imgLinkUrl;
        const lnkS = doc.struct('Link', { alt });
        ds.add(lnkS);
        lnkS.add(() => {
          doc.image(b.imgData, ix, iy, { fit: [iw, ih] });
          doc.link(ix, iy, iw, ih, b.imgLinkUrl, { structParent: lnkS });
        });
        lnkS.end();
      } else {
        /* Image simple : Figure avec Alt */
        const figS = doc.struct('Figure');
        figS.dictionary.data.Alt = new String(b.alt || 'Image');
        figS.dictionary.data.Pg = doc.page.dictionary;
        figS.dictionary.data.A = [{ O: 'Layout', BBox: [ix, PH - (iy + ih), ix + iw, PH - iy], Placement: 'Block' }];
        figS.add(() => { doc.image(b.imgData, ix, iy, { fit: [iw, ih] }); });
        figS.end();
        ds.add(figS);
      }
    },

    /* ── Lien ── */
    link(doc, ds, b) {
      const { ox, oy, cw, ch } = ctCoords(b);
      const url = b.linkUrl || 'https://';
      const txt = (b.linkText || 'Lien') + ' ';
      const pS = doc.struct('P');
      const lnkS = doc.struct('Link', { alt: txt }, () => {
        doc.fontSize(FS.link).font('Regular').fillColor(LINK_COLOR)
          .text(txt, ox, oy, { width: cw, height: ch, lineBreak: true, ellipsis: true, underline: true });
        /* Annotation Link créée APRÈS le texte mais DANS le callback struct
           → correctement imbriquée dans l'élément Link (PDF/UA) */
        const lw = Math.min(doc.widthOfString(txt, { fontSize: FS.link }), cw);
        doc.link(ox, oy, lw, FS.link * 1.2, url, { structParent: lnkS });
      });
      pS.add(lnkS); ds.add(pS); pS.end();
    },

    /* ── Citation ── */
    quote(doc, ds, b) {
      const { ox, oy, cw, ch } = ctCoords(b);
      /* Barre latérale décorative — tracée hors callback, avec guard page */
      if (doc.page) {
        doc.markContent('Artifact');
        doc.save().lineWidth(3).strokeColor('#6366f1')
          .moveTo(ox, oy).lineTo(ox, oy + ch).stroke().restore();
        doc.endMarkedContent();
      }

      const qS = doc.struct('BlockQuote');
      ds.add(qS);
      const runs = htmlToRuns(b.richContent || b.content || '');
      emitRichRuns(doc, qS, runs, ox + 8, oy, cw - 8, ch * 0.8, b.fontSize || FS.quote, '#1e1b4b', {});
      if (b.quoteSource) {
        qS.add(doc.struct('P', () => {
          const prev = doc._fontSize;
          doc.fontSize(9).font('Regular').fillColor('#6b7280')
            .text(b.quoteSource, ox + 8, oy + ch * 0.8, { width: cw - 8, lineBreak: false });
          doc._fontSize = prev;
        }));
      }
      qS.end();
    },

    /* ── Note ── */
    note(doc, ds, b) {
      const { ox, oy, cw, ch } = ctCoords(b);
      const pS = doc.struct('P');
      pS.dictionary.data.ID = new String('note-' + b.id);
      ds.add(pS);

      const ref = (b.noteRef || '1');
      pS.add(doc.struct('Span', () => {
        doc.fontSize(FS.note).font('Regular').fillColor(LINK_COLOR)
          .text('[' + ref + ']', ox, oy, { width: 20, lineBreak: false, destination: 'note-' + b.id });
      }));

      const runs = htmlToRuns(b.richContent || b.content || '');
      emitRichRuns(doc, pS, runs, ox + 24, oy, cw - 26, ch, b.fontSize || FS.note, '#374151', { lineGap: 1 });
      pS.end();
    },

    /* ── Séparateur ── */
    hr(doc, ds, b) {
      const { ox, oy, cw, ch } = ctCoords(b);
      if (!doc.page) return;
      doc.markContent('Artifact');
      doc.save()
        .lineWidth(0.75).strokeColor('#d1d5db')
        .moveTo(ox, oy + ch / 2).lineTo(ox + cw, oy + ch / 2)
        .stroke().restore();
      doc.endMarkedContent();
    },

    /* ── Encadré ── */
    aside(doc, ds, b) {
      const { ox, oy, cw, ch } = ctCoords(b);
      const st = ASIDE_STYLES[b.asideStyle || 'info'];

      /* Décorations (fond + barre + icône) : Artifacts directs, hors structure */
      if (doc.page) {
        doc.markContent('Artifact');
        doc.save();
        doc.fillColor(st.bg).rect(ox, oy, cw, ch).fill();
        doc.fillColor(st.border).rect(ox, oy, 3, ch).fill();
        doc.restore();
        doc.endMarkedContent();

      }

      /* Contenu textuel : tag P (neutre, accepté par PAC sans warning) */
      const asideS = doc.struct('P');
      ds.add(asideS);
      const textX = ox + 24, textW = cw - 26;
      const runs = htmlToRuns(b.richContent || b.content || '');
      emitRichRuns(doc, asideS, runs, textX, oy + 4, textW, ch - 8, FS.p, '#1a1a1a', { lineGap: 1 });
      asideS.end();
    },

    /* ── Code ── */
    code(doc, ds, b) {
      const { ox, oy, cw, ch } = ctCoords(b);

      /* Fond sombre : Artifact direct */
      doc.markContent('Artifact');
      doc.save().fillColor('#1e293b').rect(ox, oy, cw, ch).fill().restore();
      doc.endMarkedContent();

      /* Texte : structure logique P > Code (bottom-up puis ds.add en dernier) */
      const codeS = doc.struct('Code');
      codeS.add(() => {
        doc.fontSize(FS.code).font('Regular').fillColor('#e2e8f0')
          .text((b.content || '') + ' ', ox + 6, oy + 5, {
            width: cw - 12, height: ch - 10,
            lineBreak: true, ellipsis: true, lineGap: 1,
          });
      });
      codeS.end();
      const codePara = doc.struct('P');
      codePara.add(codeS);
      codePara.end();
      ds.add(codePara);
    },

    /* ── Tableau  ── */
    table(doc, ds, b) {
      const { ox, oy, cw } = ctCoords(b);
      const rows = b.tableData || [];
      if (!rows.length) return;

      const colCount = Math.max(...rows.map(r => r.length));
      const colW = cw / colCount;

      // CSS IHM : font-size 14px × line-height 1.5 = 21px + padding 8px×2 = 37px
      // PDF : FS.table = 10pt, même ratio → rowH = 10 × 1.5 + 8×2 ≈ 31pt
      // On arrondit à 30 pour rester dans le bloc sans débordement.
      const rowH = 30;
      const padX = 12; // padding: 8px 12px → padX=12, padY centré
      const tableH = rows.length * rowH;

      /* ── Rendu graphique (Artifact) — style DS État ── */
      doc.markContent('Artifact');
      doc.save();

      // Fond en-tête (#f6f6f6)
      doc.fillColor('#f6f6f6').rect(ox, oy, cw, rowH).fill();

      // Zèbre lignes paires du corps (2e, 4e… en base-0 = ri=2,4,6)
      for (let ri = 2; ri < rows.length; ri++) {
        if (ri % 2 === 0)
          doc.fillColor('#fafafa').rect(ox, oy + ri * rowH, cw, rowH).fill();
      }

      // Séparateurs horizontaux 0.5pt #dddddd sous chaque ligne du corps
      doc.lineWidth(0.5).strokeColor('#dddddd');
      for (let ri = 2; ri <= rows.length; ri++)
        doc.moveTo(ox, oy + ri * rowH).lineTo(ox + cw, oy + ri * rowH).stroke();

      // Trait gris 1.5pt sous l'en-tête
      doc.lineWidth(1.5).strokeColor('#dddddd');
      doc.moveTo(ox, oy + rowH).lineTo(ox + cw, oy + rowH).stroke();

      doc.restore();
      doc.endMarkedContent();

      /* ── Structure PDF/UA (inchangée) ── */
      const thIds = Array.from({ length: colCount }, (_, i) => `th-${b.id}-${i}`);

      const table = doc.struct('Table');

      /* ── THead ── */
      const thead = doc.struct('THead');
      const trHead = doc.struct('TR');

      rows[0].forEach((cell, ci) => {
        const th = doc.struct('TH');

        th.dictionary.data.A = { O: 'Table', Scope: 'Column' };
        th.dictionary.data.ID = new String(thIds[ci]);

        th.add(() => {
          // Centrage vertical : (rowH - FS.table) / 2
          const textY = oy + (rowH - FS.table) / 2;
          doc.font('Bold').fontSize(FS.table)
            .text(String(cell ?? ''), ox + ci * colW + padX, textY, {
              width: colW - padX * 2,
              height: FS.table + 2,
              lineBreak: false,
              ellipsis: true,
            });
        });

        trHead.add(th);
      });

      thead.add(trHead);
      table.add(thead);

      /* ── TBody ── */
      if (rows.length > 1) {
        const tbody = doc.struct('TBody');

        for (let ri = 1; ri < rows.length; ri++) {
          const tr = doc.struct('TR');

          for (let ci = 0; ci < colCount; ci++) {
            const td = doc.struct('TD');

            td.dictionary.data.Headers = [new String(thIds[ci])];

            td.add(() => {
              const textY = oy + ri * rowH + (rowH - FS.table) / 2;
              doc.font('Regular').fontSize(FS.table)
                .text(String(rows[ri][ci] ?? ''), ox + ci * colW + padX, textY, {
                  width: colW - padX * 2,
                  height: FS.table + 2,
                  lineBreak: false,
                  ellipsis: true,
                });
            });

            tr.add(td);
          }

          tbody.add(tr);
        }

        table.add(tbody);
      }

      table.end();
      ds.add(table);
    },

    /* ── Forme libre ── */
    freeform(doc, ds, b) {
      const pts = b.pathPoints || [];
      if (pts.length < 2) return;
      const { ox, oy, cw, ch } = ctCoords(b);
      const color = b.shapeColor || '#3b82f6';
      const opacity = b.shapeOpacity != null ? b.shapeOpacity : 1;
      const rot = b.shapeRotation || 0;
      const filled = b.shapeFilled || false;
      const closed = b.pathClosed !== false;
      const cx = ox + cw / 2, cy = oy + ch / 2;

      doc.markContent('Artifact');
      doc.save();
      doc.opacity(opacity);
      doc.fillColor(color).strokeColor(color)
        .lineWidth(b.strokeWidth || 2).lineJoin('round').lineCap('round');
      withRotation(doc, cx, cy, rot, () => {
        const p0 = pts[0];
        doc.moveTo(ox + p0.x, oy + p0.y);
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1], cur = pts[i];
          const c1 = prev.cp1, c2 = cur.cp2;
          (c1 && c2) ? doc.bezierCurveTo(ox + c1.x, oy + c1.y, ox + c2.x, oy + c2.y, ox + cur.x, oy + cur.y)
            : c1 ? doc.quadraticCurveTo(ox + c1.x, oy + c1.y, ox + cur.x, oy + cur.y)
              : c2 ? doc.quadraticCurveTo(ox + c2.x, oy + c2.y, ox + cur.x, oy + cur.y)
                : doc.lineTo(ox + cur.x, oy + cur.y);
        }
        if (closed) doc.closePath();
        if (filled) doc.fillAndStroke(); else doc.stroke();
      });
      doc.restore();
      doc.endMarkedContent();
    },

    /* ── Forme ── */
    shape(doc, ds, b) {
      const { ox, oy, cw, ch } = ctCoords(b);
      const shapeKind = b.shapeKind || 'circle';
      const renderer = SHAPE_RENDERERS[shapeKind];
      if (!renderer) return;

      const color = b.shapeColor || '#3b82f6';
      const opacity = b.shapeOpacity != null ? b.shapeOpacity : 1;
      const rot = b.shapeRotation || 0;
      const hasBorder = b.shapeBorderEnabled && shapeKind !== 'wave';
      const fillNone = b.shapeFillNone && shapeKind !== 'wave';
      const borderColor = b.shapeBorderColor || '#1d4ed8';
      const borderWidth = b.shapeBorderWidth || 2;

      /* Déterminer la commande de dessin selon l'état du remplissage/bordure */
      const cmd = fillNone ? 'stroke' : hasBorder ? 'fillAndStroke' : 'fill';

      doc.markContent('Artifact');
      doc.save();
      doc.opacity(opacity);
      doc.fillColor(color).strokeColor(hasBorder ? borderColor : color)
        .lineWidth(hasBorder ? borderWidth : 0).lineJoin('round');

      if (rot) doc.translate(ox + cw / 2, oy + ch / 2).rotate(rot, { origin: [0, 0] }).translate(-cw / 2, -ch / 2);
      else doc.translate(ox, oy);
      renderer.pdf(doc, cw, ch, cmd);

      doc.restore();
      doc.endMarkedContent();
    },

    /* ── Graphique ── */
    chart(doc, ds, b) {
      const { ox, oy, cw, ch } = ctCoords(b);
      const data = (b.chartData || []).filter(d => d.value > 0);
      if (!data.length) return;

      /* Structure PDF/UA : Figure — le dessin entier (y compris légende) est
         à l'intérieur de la structure pour éviter le warning PAC
         "marked content tagged as Artifact contains text". */
      const altText = b.alt ||
        (b.chartTitle ? b.chartTitle + ' : ' : '') +
        data.map(d => d.label + ' ' + d.value).join(', ');
      const figS = doc.struct('Figure');
      figS.dictionary.data.Alt = new String(altText);
      figS.dictionary.data.Pg = doc.page.dictionary;
      figS.dictionary.data.A = [{ O: 'Layout', BBox: [ox, PH - (oy + ch), ox + cw, PH - oy], Placement: 'Block' }];
      figS.add(() => {
        doc.save();
        _pdfDrawChart(doc, b.chartKind || 'pie', data, ox, oy, cw, ch, b.chartTitle || '');
        doc.restore();
      });
      figS.end();
      ds.add(figS);
    },
    /* ── Champs de formulaire ── */
    /* Helper partagé : dessine le fond + bordure du champ et le label au-dessus */
    'form-text'(doc, ds, b) { _renderFormField(doc, ds, b, 'text'); },
    'form-textarea'(doc, ds, b) { _renderFormField(doc, ds, b, 'textarea'); },
    'form-checkbox'(doc, ds, b) { _renderFormField(doc, ds, b, 'checkbox'); },
    'form-radio'(doc, ds, b) { _renderFormField(doc, ds, b, 'radio'); },
    'form-select'(doc, ds, b) { _renderFormField(doc, ds, b, 'select'); },
  };

  /* ── Dessinateur de graphique PDF (vectoriel natif PDFKit) ── */
  function _pdfDrawChart(doc, kind, data, ox, oy, cw, ch, title) {
    const titleH = title ? 14 : 0;
    const legItemH = Math.max(9, Math.min(cw / 18, 16));
    const legSq = Math.max(7, legItemH - 2);
    const legFs = Math.max(6, legItemH * 0.62);
    const legGap = Math.max(10, legSq + 3);
    const legendRows = Math.ceil(data.length / 2);
    const legendH = legendRows * legItemH + 4;
    const drawH = Math.max(10, ch - titleH - legendH - 8);

    /* Titre */
    if (title) {
      doc.fontSize(9).font('Bold').fillColor('#111111')
        .text(title, ox, oy, { width: cw, height: titleH, lineBreak: false, ellipsis: true, align: 'center' });
    }
    const drawY = oy + titleH + 4;

    const CHART_PDF = {
      pie: () => CHART_PDF.donut(),
      donut: () => {
        const cx = ox + cw / 2, cy = drawY + drawH / 2;
        const r = Math.min(cw / 2, drawH / 2) * 0.85;
        const innerR = kind === 'donut' ? r * 0.5 : 0;
        const total = data.reduce((s, d) => s + d.value, 0);
        let angle = -Math.PI / 2;
        data.forEach((d, idx) => {
          const sweep = (d.value / total) * Math.PI * 2;
          const a1 = angle, a2 = angle + sweep;
          const color = d.color || '#000091';
          const _drawSector = () => {
            if (innerR > 0) { doc.moveTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1)); _pdfArc(doc, cx, cy, r, a1, a2); doc.lineTo(cx + innerR * Math.cos(a2), cy + innerR * Math.sin(a2)); _pdfArcRev(doc, cx, cy, innerR, a2, a1); }
            else { doc.moveTo(cx, cy).lineTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1)); _pdfArc(doc, cx, cy, r, a1, a2); }
            doc.closePath();
          };
          _pdfFillWithPattern(doc, d, color, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, _drawSector);
          /* Séparateur blanc fin entre secteurs */
          doc.save().lineWidth(0.75).strokeColor('#ffffff');
          _drawSector();
          doc.stroke().restore();
          angle += sweep;
        });

      },
      bar: () => {
        const maxVal = Math.max(...data.map(d => d.value));
        const n = data.length;
        const gap = 3;
        const barW = Math.max(4, (cw - gap * (n + 1)) / n);
        /* Grille */
        doc.save().lineWidth(0.4).strokeColor('#e5e7eb');
        [0.25, 0.5, 0.75, 1].forEach(frac => {
          const gy = drawY + drawH - frac * (drawH - 4);
          doc.moveTo(ox, gy).lineTo(ox + cw, gy).stroke();
        });
        doc.restore();
        /* Barres */
        data.forEach((d, i) => {
          const barH = (d.value / (maxVal || 1)) * (drawH - 4);
          const bx = ox + gap + i * (barW + gap);
          const by = drawY + drawH - barH;
          const color = d.color || '#000091';
          _pdfFillWithPattern(doc, d, color, { x: bx, y: by, w: barW, h: barH },
            () => doc.rect(bx, by, barW, barH));
        });
        /* Axe X */
        doc.save().lineWidth(0.75).strokeColor('#9ca3af')
          .moveTo(ox, drawY + drawH).lineTo(ox + cw, drawY + drawH).stroke().restore();

      },
      line: () => {
        const vals = data.map(d => d.value);
        const maxVal = Math.max(...vals);
        const minVal = Math.min(0, Math.min(...vals));
        const range = (maxVal - minVal) || 1;
        const n = data.length;
        const marginL = 22, marginB = 14, marginR = 4, marginT = 2;
        const plotW = cw - marginL - marginR;
        const plotH = drawH - marginB - marginT;
        const toX = i => ox + marginL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
        const toY = v => drawY + marginT + plotH - ((v - minVal) / range) * plotH;

        /* Grille horizontale + étiquettes Y */
        doc.save().lineWidth(0.4);
        [0, 0.25, 0.5, 0.75, 1].forEach(frac => {
          const yVal = minVal + frac * range;
          const gy = toY(yVal);
          doc.strokeColor(frac === 0 ? '#9ca3af' : '#e5e7eb').lineWidth(frac === 0 ? 0.75 : 0.4);
          doc.moveTo(ox + marginL, gy).lineTo(ox + marginL + plotW, gy).stroke();
          doc.fontSize(5.5).font('Regular').fillColor('#9ca3af')
            .text(Math.round(yVal), ox, gy - 3, { width: marginL - 3, align: 'right', lineBreak: false });
        });
        doc.restore();

        /* Étiquettes X */
        const maxLabels = Math.min(n, Math.floor(plotW / 18));
        const step = Math.max(1, Math.ceil(n / maxLabels));
        doc.save().fontSize(5.5).font('Regular').fillColor('#9ca3af');
        data.forEach((d, i) => {
          if (i % step !== 0 && i !== n - 1) return;
          const lbl = d.label.length > 8 ? d.label.slice(0, 7) + '…' : d.label;
          doc.text(lbl, toX(i) - 12, drawY + marginT + plotH + 3, { width: 24, align: 'center', lineBreak: false });
        });
        doc.restore();

        /* Aire sous la courbe */
        if (n >= 2) {
          const mainColor = data[0].color || '#000091';
          doc.save().fillColor(mainColor).opacity(0.08);
          doc.moveTo(toX(0), drawY + marginT + plotH);
          data.forEach((d, i) => doc.lineTo(toX(i), toY(d.value)));
          doc.lineTo(toX(n - 1), drawY + marginT + plotH).closePath().fill();
          doc.restore();
          /* Ligne */
          doc.save().lineWidth(1.5).strokeColor(mainColor).lineJoin('round').lineCap('round');
          doc.moveTo(toX(0), toY(data[0].value));
          data.slice(1).forEach((d, i) => doc.lineTo(toX(i + 1), toY(d.value)));
          doc.stroke();
          doc.restore();
        }
        /* Points */
        data.forEach((d, i) => {
          const ptColor = d.color || '#000091';
          doc.circle(toX(i), toY(d.value), 2.5).fillColor('#ffffff').fill();
          doc.circle(toX(i), toY(d.value), 1.8).fillColor(ptColor).fill();
        });
      },
    };
    (CHART_PDF[kind] || CHART_PDF.pie)();

    /* ── Légende ── */
    const legY = drawY + drawH + 5;
    const colW = cw / 2;
    data.forEach((d, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const lx = ox + col * colW, ly = legY + row * legItemH;
      const color = d.color || '#000091';
      _pdfFillWithPattern(doc, d, color, { x: lx, y: ly, w: legSq, h: legSq },
        () => doc.rect(lx, ly, legSq, legSq));
      doc.fontSize(legFs).font('Regular').fillColor('#374151')
        .text(d.label + ' (' + d.value + ')', lx + legGap, ly + 1, { width: colW - legGap - 2, lineBreak: false, ellipsis: true });
    });
  }

  /* ── Remplissage PDF : fond coloré + motif blanc discret par-dessus ──
     Les motifs PDF reproduisent exactement ceux du SVG :
     - step = 1/6 de la plus petite dimension, clampé 4–12pt
     - lw et dotR identiques aux ratios SVG (0.18 × step, 0.22 × step)
     - Les diagonales utilisent la même logique que les <pattern> SVG (tile répété) */
  function _pdfFillWithPattern(doc, d, color, bbox, pathFn) {
    const pat = d.pattern || 'solid';

    // 1. On remplit d'abord le fond normalement
    doc.save();
    doc.fillColor(color);
    pathFn();
    doc.fill();
    doc.restore();

    if (pat === 'solid') return;

    // 2. Pour le motif, on isole strictement les changements d'état
    doc.save();

    // On définit la zone de découpe (clipping)
    pathFn();
    doc.clip();

    // IMPORTANT : On ne change les couleurs/opacité qu'APRÈS avoir fermé 
    // le chemin du clip ou AVANT de commencer le tracé du motif.
    doc.strokeColor('#ffffff')
      .fillColor('#ffffff')
      .lineWidth(Math.max(0.5, (Math.min(bbox.w, bbox.h) / 6) * 0.18))
      .opacity(0.30);

    const { x, y, w, h } = bbox;
    const step = Math.max(4, Math.min(Math.min(w, h) / 6, 12));
    const dotR = Math.max(0.6, step * 0.22);

    // Dessin des motifs
    const PAT_DRAW = {
      hlines: () => { for (let ty = y; ty <= y + h; ty += step) doc.moveTo(x, ty + step / 2).lineTo(x + w, ty + step / 2).stroke(); },
      vlines: () => { for (let tx = x; tx <= x + w; tx += step) doc.moveTo(tx + step / 2, y).lineTo(tx + step / 2, y + h).stroke(); },
      diag1: () => { for (let ty = y - h; ty < y + h; ty += step) for (let tx = x - w; tx < x + w; tx += step) doc.moveTo(tx, ty + step).lineTo(tx + step, ty).stroke(); },
      diag2: () => { for (let ty = y - h; ty < y + h; ty += step) for (let tx = x - w; tx < x + w; tx += step) doc.moveTo(tx, ty).lineTo(tx + step, ty + step).stroke(); },
      cross: () => {
        for (let ty = y; ty <= y + h; ty += step) doc.moveTo(x, ty + step / 2).lineTo(x + w, ty + step / 2).stroke();
        for (let tx = x; tx <= x + w; tx += step) doc.moveTo(tx + step / 2, y).lineTo(tx + step / 2, y + h).stroke();
      },
      dots: () => { for (let ty = y; ty < y + h; ty += step) for (let tx = x; tx < x + w; tx += step) doc.circle(tx + step / 2, ty + step / 2, dotR).fill(); },
      dashes: () => { const dl = step * 0.6; for (let ty = y; ty < y + h; ty += step) for (let tx = x; tx < x + w; tx += step) doc.moveTo(tx, ty + step / 2).lineTo(tx + dl, ty + step / 2).stroke(); },
    };
    PAT_DRAW[pat]?.();

    doc.restore();
  }


  /* Arc Bézier (sens horaire ou antihoraire) — précis à < 0.5% */
  function _pdfArcBase(doc, cx, cy, r, a1, a2) {
    const segments = Math.ceil(Math.abs(a2 - a1) / (Math.PI / 2));
    const step = (a2 - a1) / segments;
    for (let i = 0; i < segments; i++) {
      const s = a1 + i * step, e = s + step;
      const k = (4 / 3) * Math.tan((e - s) / 4);
      doc.bezierCurveTo(
        cx + r * (Math.cos(s) - k * Math.sin(s)), cy + r * (Math.sin(s) + k * Math.cos(s)),
        cx + r * (Math.cos(e) + k * Math.sin(e)), cy + r * (Math.sin(e) - k * Math.cos(e)),
        cx + r * Math.cos(e), cy + r * Math.sin(e)
      );
    }
  }
  function _pdfArc(doc, cx, cy, r, a1, a2) { _pdfArcBase(doc, cx, cy, r, a1, a2); }
  const _pdfArcRev = _pdfArc; // même implémentation, alias sémantique
  function _renderHeading(doc, ds, b) {
    const { ox, oy, cw, ch } = ctCoords(b);
    const hS = doc.struct(b.type.toUpperCase());
    ds.add(hS);
    /* Utiliser richContent si disponible (liens, gras…), sinon contenu brut */
    const fs = b.fontSize || FS[b.type];
    if (b.richContent) {
      const runs = htmlToRuns(b.richContent);
      emitRichRuns(doc, hS, runs, ox, oy, cw, ch, fs, '#111111', { bold: true });
    } else {
      hS.add(() => {
        doc.fontSize(fs).font('Bold').fillColor('#111111')
          .text((b.content || 'Titre') + ' ', ox, oy, { width: cw, height: ch, lineBreak: true, ellipsis: true });
      });
    }
    hS.end();
  }

  function _renderList(doc, ds, b) {
    const { ox, oy, cw, ch } = ctCoords(b);

    const itemRunsList = _parseListItems(b);

    const listS = doc.struct('L');
    const listFs = b.fontSize || FS.list;
    /* Sans puces : interligne serré = lineH naturel de la police,
       comme un paragraphe. Avec puces : répartir la hauteur du bloc. */
    const lineH = b.listNoBullet
      ? listFs * 1.6
      : Math.max(listFs * 1.6, ch / Math.max(itemRunsList.length, 1));

    ds.add(listS);

    let iy = oy;

    itemRunsList.forEach((seg, i) => {
      const liS = doc.struct('LI');
      const label = b.type === 'ul' ? '• ' : (i + 1) + '. ';
      const bodyX = b.listNoBullet ? ox : ox + 20;
      const bodyW = b.listNoBullet ? cw : cw - 20;

      /* Mesurer la hauteur réelle de l'item avec PDFKit (tient compte du wrapping) */
      const segText = seg.map(r => r.text).join('');
      let itemH;
      try {
        doc.fontSize(listFs).font('Regular');
        itemH = doc.heightOfString(segText, { width: bodyW, lineBreak: true });
      } catch (_) {
        itemH = lineH;
      }
      itemH = Math.max(itemH, lineH);

      if (!b.listNoBullet) {
        liS.add(doc.struct('Lbl', () => {
          doc.fontSize(listFs).font('Regular').fillColor('#111111')
            .text(label, ox, iy, { width: 20, lineBreak: false });
        }));
      }

      const lbodyS = doc.struct('LBody');
      liS.add(lbodyS);
      const bodyH = Math.max(itemH, oy + ch - iy);
      emitRichRuns(doc, lbodyS, seg, bodyX, iy, bodyW, bodyH, listFs, '#111111', {});
      lbodyS.end();

      liS.end(); listS.add(liS);
      iy += itemH;
    });
    listS.end();
  }

  /* ── Boucle principale ── */
