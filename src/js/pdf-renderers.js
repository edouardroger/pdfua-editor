// pdf-renderers.js — Renderers PDF des blocs texte, média, structure

/* ══════════════════════════════════════════════════════════════════════
   BlockRenderer
   ──────────────────────────────────────────────────────────────────────
   Encapsule le rendu PDF/UA d'un bloc donné.
   L'instance est liée à un couple (doc, docStruct) pour toute la durée
   d'une génération de document.

   Usage :
     const r = new BlockRenderer(doc, docStruct);
     r.render(block);            // dispatch automatique selon block.type

   La méthode statique emitRichRuns() est aussi exposée globalement
   (voir bas de fichier) pour compatibilité avec pdf-builder.js et
   export-code.js qui l'appellent directement.
   ══════════════════════════════════════════════════════════════════════ */
class BlockRenderer {
  constructor(doc, docStruct) {
    this.doc = doc;
    this.docStruct = docStruct;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Dispatch
  // ─────────────────────────────────────────────────────────────────────

  render(b) {
    switch (b.type) {
      case 'h1': case 'h2': case 'h3':
      case 'h4': case 'h5': case 'h6': return this.renderHeading(b);
      case 'p': return this.renderParagraph(b);
      case 'ul': case 'ol': return this.renderList(b);
      case 'img': return this.renderImage(b);
      case 'link': return this.renderLink(b);
      case 'quote': return this.renderQuote(b);
      case 'note': return this.renderNote(b);
      case 'hr': return this.renderHr(b);
      case 'aside': return this.renderAside(b);
      case 'code': return this.renderCode(b);
      case 'table': return this.renderTable(b);
      case 'freeform': return this.renderFreeform(b);
      case 'shape': return this.renderShape(b);
      case 'chart': return this.renderChart(b);
      case 'form-text': return _renderFormField(this.doc, this.docStruct, b, 'text');
      case 'form-textarea': return _renderFormField(this.doc, this.docStruct, b, 'textarea');
      case 'form-checkbox': return _renderFormField(this.doc, this.docStruct, b, 'checkbox');
      case 'form-radio': return _renderFormField(this.doc, this.docStruct, b, 'radio');
      case 'form-select': return _renderFormField(this.doc, this.docStruct, b, 'select');
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers de géométrie
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Coordonnées et dimensions de la zone de contenu d'un bloc.
   * Soustrait CT_PAD des côtés, BAR_H du haut, 8px du bas.
   */
  _coords(b) {
    const pageTop = Math.floor(b.y / PH) * PH;
    return {
      ox: b.x + CT_PAD,
      oy: b.y - pageTop + BAR_H,
      cw: Math.max(10, b.w - CT_PAD * 2),
      ch: Math.max(4, b.h - BAR_H - 8),
    };
  }

  /**
   * Applique une rotation CTM autour du centre (cx, cy), exécute fn(),
   * puis restaure la matrice de transformation.
   */
  _withRotation(cx, cy, deg, fn) {
    if (!deg) { fn(); return; }
    this.doc.save();
    this.doc.translate(cx, cy).rotate(deg, { origin: [0, 0] }).translate(-cx, -cy);
    fn();
    this.doc.restore();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Émission de texte riche
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Émet une liste de runs (gras, italique, liens, appels de notes)
   * dans la structure PDF/UA parentStruct.
   *
   * Les runs sont d'abord regroupés en segments délimités par '\n'.
   * Chaque segment est émis en flux continued ; les notes et liens
   * reçoivent leurs propres éléments de structure (Reference, Link).
   */
  emitRichRuns(parentStruct, runs, x, y, w, h, fontSize, color, extraOpts) {
    const { doc } = this;

    if (!runs.length) {
      parentStruct.add(doc.struct('Span', () => {
        doc.fontSize(fontSize).font('Regular').fillColor(color)
          .text(' ', x, y, { width: w, height: h, lineBreak: false });
      }));
      return;
    }

    const segments = _parseSegments(runs);
    if (!segments.length) return;

    const lineH = fontSize * 1.6;
    let curY = y;
    let isVeryFirst = true;

    segments.forEach(seg => {
      if (!seg.length) { curY += lineH; return; }

      const totalInSeg = seg.length;
      let skipNext = false;

      seg.forEach((run, idx) => {
        if (skipNext) { skipNext = false; return; }

        const isFirst = isVeryFirst;
        const isLastRun = idx === totalInSeg - 1;
        isVeryFirst = false;

        const defaultBold = extraOpts.bold || false;
        const isBold = run.bold === false ? false : (run.bold || defaultBold);

        const runFont = isBold
          ? (run.italic ? 'BoldItalic' : 'Bold')
          : run.italic ? 'Italic' : 'Regular';
        const runNoteId = run.noteId || null;
        const runColor = (run.linkUrl || runNoteId) ? LINK_COLOR : color;
        const runLink = run.linkUrl || null;
        const runAlt = run.linkText || run.text;
        const runUnderline = run.underline || false;

        const layoutOpts = Object.assign(
          { width: w, lineBreak: true, ellipsis: true, continued: !isLastRun },
          isFirst ? { height: h } : {},
          extraOpts,
          runLink ? { link: runLink, underline: true } : (runUnderline ? { underline: true } : {})
        );

        const captureX = isFirst ? x : undefined;
        const captureY = isFirst ? curY : undefined;
        const captFirst = isFirst;

        const drawFn = () => {
          doc.fontSize(fontSize).font(runFont).fillColor(runColor);
          if (captFirst) doc.text(run.text, captureX, captureY, layoutOpts);
          else doc.text(run.text, layoutOpts);
        };

        if (runNoteId) {
          // Appel de note : exposant en bleu avec goTo + liaison différée
          const nextRun = !isLastRun ? seg[idx + 1] : null;
          if (nextRun && !nextRun.noteId) skipNext = true;
          const isEffectivelyLast = isLastRun ||
            (nextRun && !nextRun.noteId ? idx + 1 === totalInSeg - 1 : isLastRun);

          const refS = doc.struct('Reference');
          parentStruct.add(refS);
          const lnkS = doc.struct('Link', { alt: 'Note ' + run.text });
          refS.add(lnkS);

          lnkS.add(() => {
            const cx = doc.x, cy = doc.y;
            const supFontSize = fontSize * 0.58;
            const supRise = fontSize * 0.38;
            doc.fontSize(supFontSize).font(runFont).fillColor(LINK_COLOR);
            const supW = doc.widthOfString(run.text) + 1;
            doc.text(run.text, cx, cy - supRise, {
              lineBreak: false, continued: true,
              width: supW + 4, height: supFontSize * 1.5, underline: false,
            });
            doc.goTo(cx, cy - supRise, supW + 2, supFontSize * 1.5,
              'note-' + runNoteId, { structParent: lnkS });
          });
          lnkS.end();
          refS.end();

          // Émettre le run suivant directement si c'est du texte normal
          parentStruct.add(() => {
            doc.fontSize(fontSize).font(runFont).fillColor(color);
            if (nextRun && !nextRun.noteId) {
              const nextIsBold = defaultBold || nextRun.bold;
              const nFont = nextRun.bold ? 'Bold' : nextRun.italic ? 'Italic' : 'Regular';

              doc.fontSize(fontSize).font(nFont)
                .fillColor(nextRun.linkUrl ? LINK_COLOR : color);
              doc.text(nextRun.text, {
                lineBreak: false,
                continued: !isEffectivelyLast,
                ellipsis: true,
                link: nextRun.linkUrl || undefined,
                underline: !!nextRun.linkUrl,
              });
            } else if (!isLastRun) {
              doc.text('', { continued: true, lineBreak: false });
            } else {
              try { doc.text('', { continued: false }); } catch (_) { }
            }
          });

        } else if (runLink) {
          const lnkS = doc.struct('Link', { alt: runAlt });
          lnkS.add(drawFn);
          lnkS.end();
          parentStruct.add(lnkS);
        } else {
          parentStruct.add(drawFn);
        }
      });

      curY += lineH;
      try { doc.text('', { continued: false }); } catch (_) { }
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Renderers par type de bloc
  // ─────────────────────────────────────────────────────────────────────

  renderHeading(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw, ch } = this._coords(b);
    const fs = b.fontSize || FS[b.type];
    const hS = doc.struct(b.type.toUpperCase());
    docStruct.add(hS);
    if (b.richContent) {
      this.emitRichRuns(hS, htmlToRuns(b.richContent),
        ox, oy, cw, ch, fs, '#111111', { bold: true });
    } else {
      hS.add(() => {
        doc.fontSize(fs).font('Bold').fillColor('#111111')
          .text((b.content || 'Titre') + ' ', ox, oy,
            { width: cw, height: ch, lineBreak: true, ellipsis: true });
      });
    }
    hS.end();
  }

  renderParagraph(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw, ch } = this._coords(b);
    const runs = htmlToRuns(b.richContent || b.content || '');
    const pS = doc.struct('P');
    docStruct.add(pS);
    const indent = b.textIndent || 0;
    this.emitRichRuns(pS, runs, ox + indent, oy, cw - indent, ch, b.fontSize || FS.p, '#111111', { lineGap: 2 });
    pS.end();
  }

  renderList(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw, ch } = this._coords(b);
    const itemRunsList = _parseListItems(b);
    const listFs = b.fontSize || FS.list;
    const lineH = b.listNoBullet
      ? listFs * 1.6
      : Math.max(listFs * 1.6, ch / Math.max(itemRunsList.length, 1));

    const listS = doc.struct('L');
    docStruct.add(listS);
    let iy = oy;

    itemRunsList.forEach((seg, i) => {
      const liS = doc.struct('LI');
      const label = b.type === 'ul' ? '• ' : (i + 1) + '. ';
      const bodyX = b.listNoBullet ? ox : ox + 20;
      const bodyW = b.listNoBullet ? cw : cw - 20;

      let itemH;
      try {
        doc.fontSize(listFs).font('Regular');
        itemH = doc.heightOfString(seg.map(r => r.text).join(''), { width: bodyW, lineBreak: true });
      } catch (_) { itemH = lineH; }
      itemH = Math.max(itemH, lineH);

      if (!b.listNoBullet) {
        liS.add(doc.struct('Lbl', () => {
          doc.fontSize(listFs).font('Regular').fillColor('#111111')
            .text(label, ox, iy, { width: 20, lineBreak: false });
        }));
      }

      const lbodyS = doc.struct('LBody');
      liS.add(lbodyS);
      this.emitRichRuns(lbodyS, seg, bodyX, iy, bodyW,
        Math.max(itemH, oy + ch - iy), listFs, '#111111', {});
      lbodyS.end();

      liS.end();
      listS.add(liS);
      iy += itemH;
    });
    listS.end();
  }

  renderImage(b) {
    const { doc, docStruct } = this;
    if (!b.imgData) return;
    const ix = b.x, iy = b.y - Math.floor(b.y / PH) * PH;
    const iw = b.w, ih = b.h;

    if (b.imgLinkUrl) {
      /* Image cliquable : Link sans Figure enfant (conforme PDF/UA-1).
         Mettre Figure dans Link génère un warning PAC "possibly inappropriate
         use of Figure" (Matterhorn Protocol). */
      const alt = b.alt
        ? b.alt + (b.imgLinkUrl ? ' — ' + b.imgLinkUrl : '')
        : b.imgLinkUrl;
      const lnkS = doc.struct('Link', { alt });
      docStruct.add(lnkS);
      lnkS.add(() => {
        doc.image(b.imgData, ix, iy, { fit: [iw, ih] });
        doc.link(ix, iy, iw, ih, b.imgLinkUrl, { structParent: lnkS });
      });
      lnkS.end();
    } else {
      const figS = doc.struct('Figure');
      figS.dictionary.data.Alt = new String(b.alt || 'Image');
      figS.dictionary.data.Pg = doc.page.dictionary;
      figS.dictionary.data.A = [{
        O: 'Layout',
        BBox: [ix, PH - (iy + ih), ix + iw, PH - iy],
        Placement: 'Block',
      }];
      figS.add(() => { doc.image(b.imgData, ix, iy, { fit: [iw, ih] }); });
      figS.end();
      docStruct.add(figS);
    }
  }

  renderLink(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw, ch } = this._coords(b);
    const url = b.linkUrl || 'https://';
    const txt = (b.linkText || 'Lien') + ' ';
    const pS = doc.struct('P');
    /* Annotation Link créée dans le callback → correctement imbriquée (PDF/UA). */
    const lnkS = doc.struct('Link', { alt: txt }, () => {
      doc.fontSize(FS.link).font('Regular').fillColor(LINK_COLOR)
        .text(txt, ox, oy, { width: cw, height: ch, lineBreak: true, ellipsis: true, underline: true });
      const lw = Math.min(doc.widthOfString(txt, { fontSize: FS.link }), cw);
      doc.link(ox, oy, lw, FS.link * 1.2, url, { structParent: lnkS });
    });
    pS.add(lnkS);
    docStruct.add(pS);
    pS.end();
  }

  renderQuote(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw, ch } = this._coords(b);

    // Barre latérale décorative (Artifact — hors structure logique)
    if (doc.page) {
      doc.markContent('Artifact');
      doc.save().lineWidth(3).strokeColor('#6366f1')
        .moveTo(ox, oy).lineTo(ox, oy + ch).stroke().restore();
      doc.endMarkedContent();
    }

    const qS = doc.struct('BlockQuote');
    docStruct.add(qS);
    const runs = htmlToRuns(b.richContent || b.content || '');
    this.emitRichRuns(qS, runs, ox + 8, oy, cw - 8, ch * 0.8, b.fontSize || FS.quote, '#1e1b4b', {});

    if (b.quoteSource) {
      qS.add(doc.struct('P', () => {
        const prev = doc._fontSize;
        doc.fontSize(9).font('Regular').fillColor('#6b7280')
          .text(b.quoteSource, ox + 8, oy + ch * 0.8, { width: cw - 8, lineBreak: false });
        doc._fontSize = prev;
      }));
    }
    qS.end();
  }

  renderNote(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw, ch } = this._coords(b);
    const pS = doc.struct('P');
    pS.dictionary.data.ID = new String('note-' + b.id);
    docStruct.add(pS);

    const ref = b.noteRef || '1';
    pS.add(doc.struct('Span', () => {
      doc.fontSize(FS.note).font('Regular').fillColor(LINK_COLOR)
        .text('[' + ref + ']', ox, oy, { width: 20, lineBreak: false, destination: 'note-' + b.id });
    }));

    const runs = htmlToRuns(b.richContent || b.content || '');
    this.emitRichRuns(pS, runs, ox + 24, oy, cw - 26, ch, b.fontSize || FS.note, '#374151', { lineGap: 1 });
    pS.end();
  }

  renderHr(b) {
    const { doc } = this;
    const { ox, oy, cw, ch } = this._coords(b);
    if (!doc.page) return;
    doc.markContent('Artifact');
    doc.save().lineWidth(0.75).strokeColor('#d1d5db')
      .moveTo(ox, oy + ch / 2).lineTo(ox + cw, oy + ch / 2)
      .stroke().restore();
    doc.endMarkedContent();
  }

  renderAside(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw, ch } = this._coords(b);
    const st = ASIDE_STYLES[b.asideStyle || 'info'];

    // Fond coloré + barre latérale (Artifact)
    if (doc.page) {
      doc.markContent('Artifact');
      doc.save();
      doc.fillColor(st.bg).rect(ox, oy, cw, ch).fill();
      doc.fillColor(st.border).rect(ox, oy, 3, ch).fill();
      doc.restore();
      doc.endMarkedContent();
    }

    // Contenu : tag P neutre (accepté par PAC sans warning)
    const asideS = doc.struct('P');
    docStruct.add(asideS);
    const runs = htmlToRuns(b.richContent || b.content || '');
    this.emitRichRuns(asideS, runs, ox + 24, oy + 4, cw - 26, ch - 8, FS.p, '#1a1a1a', { lineGap: 1 });
    asideS.end();
  }

  renderCode(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw, ch } = this._coords(b);

    // Fond sombre (Artifact)
    doc.markContent('Artifact');
    doc.save().fillColor('#1e293b').rect(ox, oy, cw, ch).fill().restore();
    doc.endMarkedContent();

    // Structure P > Code (PDF/UA)
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
    docStruct.add(codePara);
  }

  renderTable(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw } = this._coords(b);
    const rows = b.tableData || [];
    if (!rows.length) return;

    const colCount = Math.max(...rows.map(r => r.length));
    const colW = cw / colCount;
    // FS.table(10pt) × 1.5 + padding × 2 ≈ 30pt — arrondi pour éviter le débordement
    const rowH = 30;
    const padX = 12;

    // ── Rendu graphique DS État (Artifact) ──
    doc.markContent('Artifact');
    doc.save();
    doc.fillColor('#f6f6f6').rect(ox, oy, cw, rowH).fill();
    for (let ri = 2; ri < rows.length; ri++) {
      if (ri % 2 === 0)
        doc.fillColor('#fafafa').rect(ox, oy + ri * rowH, cw, rowH).fill();
    }
    doc.lineWidth(0.5).strokeColor('#dddddd');
    for (let ri = 2; ri <= rows.length; ri++)
      doc.moveTo(ox, oy + ri * rowH).lineTo(ox + cw, oy + ri * rowH).stroke();
    doc.lineWidth(1.5).strokeColor('#dddddd');
    doc.moveTo(ox, oy + rowH).lineTo(ox + cw, oy + rowH).stroke();
    doc.restore();
    doc.endMarkedContent();

    // ── Structure PDF/UA ──
    const thIds = Array.from({ length: colCount }, (_, i) => `th-${b.id}-${i}`);
    const table = doc.struct('Table');
    const thead = doc.struct('THead');
    const trHead = doc.struct('TR');

    rows[0].forEach((cell, ci) => {
      const th = doc.struct('TH');
      th.dictionary.data.A = { O: 'Table', Scope: 'Column' };
      th.dictionary.data.ID = new String(thIds[ci]);
      th.add(() => {
        const textY = oy + (rowH - FS.table) / 2;
        doc.font('Bold').fontSize(FS.table)
          .text(String(cell ?? ''), ox + ci * colW + padX, textY, {
            width: colW - padX * 2, height: FS.table + 2, lineBreak: false, ellipsis: true,
          });
      });
      trHead.add(th);
    });
    thead.add(trHead);
    table.add(thead);

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
                width: colW - padX * 2, height: FS.table + 2, lineBreak: false, ellipsis: true,
              });
          });
          tr.add(td);
        }
        tbody.add(tr);
      }
      table.add(tbody);
    }

    table.end();
    docStruct.add(table);
  }

  renderFreeform(b) {
    const { doc } = this;
    const pts = b.pathPoints || [];
    if (pts.length < 2) return;
    const { ox, oy, cw, ch } = this._coords(b);

    doc.markContent('Artifact');
    doc.save();
    doc.opacity(b.shapeOpacity ?? 1);
    doc.fillColor(b.shapeColor || '#3b82f6')
      .strokeColor(b.shapeColor || '#3b82f6')
      .lineWidth(b.strokeWidth || 2)
      .lineJoin('round').lineCap('round');

    this._withRotation(ox + cw / 2, oy + ch / 2, b.shapeRotation || 0, () => {
      doc.moveTo(ox + pts[0].x, oy + pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1], cur = pts[i];
        const c1 = prev.cp1, c2 = cur.cp2;
        if (c1 && c2) doc.bezierCurveTo(ox + c1.x, oy + c1.y, ox + c2.x, oy + c2.y, ox + cur.x, oy + cur.y);
        else if (c1) doc.quadraticCurveTo(ox + c1.x, oy + c1.y, ox + cur.x, oy + cur.y);
        else if (c2) doc.quadraticCurveTo(ox + c2.x, oy + c2.y, ox + cur.x, oy + cur.y);
        else doc.lineTo(ox + cur.x, oy + cur.y);
      }
      if (b.pathClosed !== false) doc.closePath();
      if (b.shapeFilled) doc.fillAndStroke(); else doc.stroke();
    });
    doc.restore();
    doc.endMarkedContent();
  }

  renderShape(b) {
    const { doc } = this;
    const { ox, oy, cw, ch } = this._coords(b);
    const shapeKind = b.shapeKind || 'circle';
    const renderer = SHAPE_RENDERERS[shapeKind];
    if (!renderer) return;

    const hasBorder = b.shapeBorderEnabled && shapeKind !== 'wave';
    const fillNone = b.shapeFillNone && shapeKind !== 'wave';
    const cmd = fillNone ? 'stroke' : hasBorder ? 'fillAndStroke' : 'fill';
    const rot = b.shapeRotation || 0;

    doc.markContent('Artifact');
    doc.save();
    doc.opacity(b.shapeOpacity ?? 1);
    doc.fillColor(b.shapeColor || '#3b82f6')
      .strokeColor(hasBorder ? (b.shapeBorderColor || '#1d4ed8') : (b.shapeColor || '#3b82f6'))
      .lineWidth(hasBorder ? (b.shapeBorderWidth || 2) : 0)
      .lineJoin('round');

    if (rot) doc.translate(ox + cw / 2, oy + ch / 2).rotate(rot, { origin: [0, 0] }).translate(-cw / 2, -ch / 2);
    else doc.translate(ox, oy);

    renderer.pdf(doc, cw, ch, cmd);
    doc.restore();
    doc.endMarkedContent();
  }

  renderChart(b) {
    const { doc, docStruct } = this;
    const { ox, oy, cw, ch } = this._coords(b);
    const data = (b.chartData || []).filter(d => d.value > 0);
    if (!data.length) return;

    const altText = b.alt ||
      (b.chartTitle ? b.chartTitle + ' : ' : '') +
      data.map(d => d.label + ' ' + d.value).join(', ');

    // Le dessin entier (y compris légende) est dans la structure Figure
    // pour éviter le warning PAC "marked content tagged as Artifact contains text".
    const figS = doc.struct('Figure');
    figS.dictionary.data.Alt = new String(altText);
    figS.dictionary.data.Pg = doc.page.dictionary;
    figS.dictionary.data.A = [{
      O: 'Layout', BBox: [ox, PH - (oy + ch), ox + cw, PH - oy], Placement: 'Block',
    }];
    figS.add(() => {
      doc.save();
      this._drawChart(b.chartKind || 'pie', data, ox, oy, cw, ch, b.chartTitle || '');
      doc.restore();
    });
    figS.end();
    docStruct.add(figS);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Dessin vectoriel des graphiques
  // ─────────────────────────────────────────────────────────────────────

  _drawChart(kind, data, ox, oy, cw, ch, title) {
    const { doc } = this;
    const titleH = title ? 14 : 0;
    const legItemH = Math.max(9, Math.min(cw / 18, 16));
    const legSq = Math.max(7, legItemH - 2);
    const legFs = Math.max(6, legItemH * 0.62);
    const legGap = Math.max(10, legSq + 3);
    const legendH = Math.ceil(data.length / 2) * legItemH + 4;
    const drawH = Math.max(10, ch - titleH - legendH - 8);
    const drawY = oy + titleH + 4;

    if (title) {
      doc.fontSize(9).font('Bold').fillColor('#111111')
        .text(title, ox, oy, { width: cw, height: titleH, lineBreak: false, ellipsis: true, align: 'center' });
    }

    const draw = {
      pie: () => draw.donut(),
      donut: () => this._drawChartDonut(kind, data, ox, cw, drawH, drawY),
      bar: () => this._drawChartBar(data, ox, cw, drawH, drawY),
      line: () => this._drawChartLine(data, ox, cw, drawH, drawY),
    };
    (draw[kind] || draw.pie)();

    // ── Légende commune à tous les types ──
    const legY = drawY + drawH + 5;
    const colW = cw / 2;
    data.forEach((d, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const lx = ox + col * colW, ly = legY + row * legItemH;
      this._fillWithPattern(d, d.color || '#000091',
        { x: lx, y: ly, w: legSq, h: legSq }, () => doc.rect(lx, ly, legSq, legSq));
      doc.fontSize(legFs).font('Regular').fillColor('#374151')
        .text(d.label + ' (' + d.value + ')', lx + legGap, ly + 1,
          { width: colW - legGap - 2, lineBreak: false, ellipsis: true });
    });
  }

  _drawChartDonut(kind, data, ox, cw, drawH, drawY) {
    const { doc } = this;
    const cx = ox + cw / 2, cy = drawY + drawH / 2;
    const r = Math.min(cw / 2, drawH / 2) * 0.85;
    const innerR = kind === 'donut' ? r * 0.5 : 0;
    const total = data.reduce((s, d) => s + d.value, 0);
    let angle = -Math.PI / 2;

    data.forEach(d => {
      const sweep = (d.value / total) * Math.PI * 2;
      const a1 = angle, a2 = angle + sweep;
      const color = d.color || '#000091';

      const drawSector = () => {
        if (innerR > 0) {
          doc.moveTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
          _pdfArc(doc, cx, cy, r, a1, a2);
          doc.lineTo(cx + innerR * Math.cos(a2), cy + innerR * Math.sin(a2));
          _pdfArc(doc, cx, cy, innerR, a2, a1);
        } else {
          doc.moveTo(cx, cy)
            .lineTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
          _pdfArc(doc, cx, cy, r, a1, a2);
        }
        doc.closePath();
      };

      this._fillWithPattern(d, color, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, drawSector);

      // Séparateur blanc entre secteurs
      doc.save().lineWidth(0.75).strokeColor('#ffffff');
      drawSector();
      doc.stroke().restore();

      angle += sweep;
    });
  }

  _drawChartBar(data, ox, cw, drawH, drawY) {
    const { doc } = this;
    const maxVal = Math.max(...data.map(d => d.value));
    const n = data.length;
    const gap = 3;
    const barW = Math.max(4, (cw - gap * (n + 1)) / n);

    // Grille horizontale légère
    doc.save().lineWidth(0.4).strokeColor('#e5e7eb');
    [0.25, 0.5, 0.75, 1].forEach(frac => {
      const gy = drawY + drawH - frac * (drawH - 4);
      doc.moveTo(ox, gy).lineTo(ox + cw, gy).stroke();
    });
    doc.restore();

    // Barres
    data.forEach((d, i) => {
      const barH = (d.value / (maxVal || 1)) * (drawH - 4);
      const bx = ox + gap + i * (barW + gap);
      const by = drawY + drawH - barH;
      this._fillWithPattern(d, d.color || '#000091',
        { x: bx, y: by, w: barW, h: barH }, () => doc.rect(bx, by, barW, barH));
    });

    // Axe X
    doc.save().lineWidth(0.75).strokeColor('#9ca3af')
      .moveTo(ox, drawY + drawH).lineTo(ox + cw, drawY + drawH).stroke().restore();
  }

  _drawChartLine(data, ox, cw, drawH, drawY) {
    const { doc } = this;
    const vals = data.map(d => d.value);
    const maxVal = Math.max(...vals);
    const minVal = Math.min(0, ...vals);
    const range = (maxVal - minVal) || 1;
    const n = data.length;
    const mL = 22, mB = 14, mR = 4, mT = 2;
    const plotW = cw - mL - mR;
    const plotH = drawH - mB - mT;
    const toX = i => ox + mL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const toY = v => drawY + mT + plotH - ((v - minVal) / range) * plotH;

    // Grille horizontale + étiquettes Y
    doc.save().lineWidth(0.4);
    [0, 0.25, 0.5, 0.75, 1].forEach(frac => {
      const yVal = minVal + frac * range;
      const gy = toY(yVal);
      doc.strokeColor(frac === 0 ? '#9ca3af' : '#e5e7eb').lineWidth(frac === 0 ? 0.75 : 0.4);
      doc.moveTo(ox + mL, gy).lineTo(ox + mL + plotW, gy).stroke();
      doc.fontSize(5.5).font('Regular').fillColor('#9ca3af')
        .text(Math.round(yVal), ox, gy - 3, { width: mL - 3, align: 'right', lineBreak: false });
    });
    doc.restore();

    // Étiquettes X
    const step = Math.max(1, Math.ceil(n / Math.min(n, Math.floor(plotW / 18))));
    doc.save().fontSize(5.5).font('Regular').fillColor('#9ca3af');
    data.forEach((d, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      const lbl = d.label.length > 8 ? d.label.slice(0, 7) + '…' : d.label;
      doc.text(lbl, toX(i) - 12, drawY + mT + plotH + 3, { width: 24, align: 'center', lineBreak: false });
    });
    doc.restore();

    if (n >= 2) {
      const mainColor = data[0].color || '#000091';

      // Aire sous la courbe (semi-transparente)
      doc.save().fillColor(mainColor).opacity(0.08);
      doc.moveTo(toX(0), drawY + mT + plotH);
      data.forEach((d, i) => doc.lineTo(toX(i), toY(d.value)));
      doc.lineTo(toX(n - 1), drawY + mT + plotH).closePath().fill();
      doc.restore();

      // Ligne principale
      doc.save().lineWidth(1.5).strokeColor(mainColor).lineJoin('round').lineCap('round');
      doc.moveTo(toX(0), toY(data[0].value));
      data.slice(1).forEach((d, i) => doc.lineTo(toX(i + 1), toY(d.value)));
      doc.stroke().restore();
    }

    // Points avec halo blanc
    data.forEach((d, i) => {
      const ptColor = d.color || '#000091';
      doc.circle(toX(i), toY(d.value), 2.5).fillColor('#ffffff').fill();
      doc.circle(toX(i), toY(d.value), 1.8).fillColor(ptColor).fill();
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Remplissage avec motif de hachure
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Remplit la forme dessinée par pathFn() avec une couleur pleine,
   * puis superpose un motif blanc semi-transparent si d.pattern !== 'solid'.
   * Le clipping sur la forme garantit que le motif ne déborde pas.
   */
  _fillWithPattern(d, color, bbox, pathFn) {
    const { doc } = this;
    const pat = d.pattern || 'solid';

    // 1. Fond coloré plein
    doc.save();
    doc.fillColor(color);
    pathFn();
    doc.fill();
    doc.restore();

    if (pat === 'solid') return;

    // 2. Motif blanc discret, clippé sur la forme
    doc.save();
    pathFn();
    doc.clip();

    const { x, y, w, h } = bbox;
    const step = Math.max(4, Math.min(Math.min(w, h) / 6, 12));
    const dotR = Math.max(0.6, step * 0.22);
    const lw = Math.max(0.5, (Math.min(w, h) / 6) * 0.18);
    doc.strokeColor('#ffffff').fillColor('#ffffff').lineWidth(lw).opacity(0.30);

    const patterns = {
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
    patterns[pat]?.();
    doc.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers partagés (utilisés par BlockRenderer et pdf-forms.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Arc de Bézier cubique approximant un arc de cercle.
 * Précision < 0.5% — facteur k = (4/3)·tan(θ/4).
 */
function _pdfArc(doc, cx, cy, r, a1, a2) {
  const segments = Math.ceil(Math.abs(a2 - a1) / (Math.PI / 2));
  const stepA = (a2 - a1) / segments;
  for (let i = 0; i < segments; i++) {
    const s = a1 + i * stepA, e = s + stepA;
    const k = (4 / 3) * Math.tan((e - s) / 4);
    doc.bezierCurveTo(
      cx + r * (Math.cos(s) - k * Math.sin(s)), cy + r * (Math.sin(s) + k * Math.cos(s)),
      cx + r * (Math.cos(e) + k * Math.sin(e)), cy + r * (Math.sin(e) - k * Math.cos(e)),
      cx + r * Math.cos(e), cy + r * Math.sin(e)
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compatibilité : BLOCK_RENDERERS conservé pour PDFBuilder et export-code.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Table de dispatch globale : chaque entrée (doc, docStruct, b) instancie
 * un BlockRenderer éphémère et appelle render().
 * PDFBuilder._renderCanvasPage() et export-code.js s'appuient sur cette table.
 */
const BLOCK_RENDERERS = Object.fromEntries([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'img', 'link', 'quote', 'note', 'hr', 'aside', 'code',
  'table', 'freeform', 'shape', 'chart',
  'form-text', 'form-textarea', 'form-checkbox', 'form-radio', 'form-select',
].map(type => [type, (doc, docStruct, b) => new BlockRenderer(doc, docStruct).render(b)]));

// ─────────────────────────────────────────────────────────────────────────────
// Compatibilité : ctCoords exposée comme fonction globale pour pdf-forms.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcule les coordonnées de la zone de contenu d'un bloc.
 * Exposée globalement car pdf-forms.js l'appelle directement.
 * Délègue à BlockRenderer._coords() sans instancier doc/docStruct
 * (la méthode n'utilise que PH, CT_PAD et BAR_H).
 */
function ctCoords(b) {
  return new BlockRenderer(null, null)._coords(b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Compatibilité : emitRichRuns conservée comme fonction globale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrapper global conservé pour la compatibilité avec pdf-builder.js
 * (_linkNoteAnchors lit emitRichRuns._noteLinks) et export-code.js.
 */
function emitRichRuns(doc, parentStruct, runs, x, y, w, h, fontSize, color, extraOpts) {
  new BlockRenderer(doc, { add() { } }).emitRichRuns(
    parentStruct, runs, x, y, w, h, fontSize, color, extraOpts
  );
}
// Tableau de liaison ancres → notes, peuplé par PDFBuilder et lu par _linkNoteAnchors
emitRichRuns._noteLinks = [];
