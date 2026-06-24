// export-code.js — Génération du script PDFKit autonome (.js)

/* ══════════════════════════════════════════════════════════════
   EXPORT CODE — Génère un script JS autonome pour navigateur
   Produit un fichier .js intégrable dans une page HTML avec
   PDFKit (browser build) + blob-stream.
   ══════════════════════════════════════════════════════════════ */
function exportCode() {
  const tf = document.getElementById('m-title');
  const title = tf?.value || '';
  if (!title.trim()) {
    announce("⚠ Veuillez définir un titre avant d'exporter le code.", 'assertive');
    switchTab('meta');
    tf.focus();
    tf.classList.add('input-error');
    tf.setAttribute('aria-invalid', 'true');
    const prevErr = document.getElementById('m-title-error');
    if (prevErr) prevErr.remove();
    const errMsg = document.createElement('p');
    errMsg.id = 'm-title-error';
    errMsg.className = 'field-error';
    errMsg.setAttribute('role', 'alert');
    errMsg.textContent = 'Le titre est obligatoire pour exporter le code.';
    tf.insertAdjacentElement('afterend', errMsg);
    const baseDesc = (tf.getAttribute('aria-describedby') || 'm-title-hint').trim();
    tf.setAttribute('aria-describedby', baseDesc + ' m-title-error');
    const clearErr = () => {
      tf.classList.remove('input-error');
      tf.removeAttribute('aria-invalid');
      const e = document.getElementById('m-title-error');
      if (e) e.remove();
    };
    tf.addEventListener('input', clearErr, { once: true });
    setTimeout(clearErr, 8000);
    return;
  }
  const g = id => document.getElementById(id)?.value || '';
  const lang = g('m-lang') || 'fr-FR';
  const author = g('m-author');
  const subject = g('m-subject');

  /* Trier les blocs comme buildPDF le fait */
  const sorted = _cleanBlocks().sort((a, b) => {
    const pa = Math.floor(a.y / PH), pb = Math.floor(b.y / PH);
    return pa !== pb ? pa - pb : a.y - b.y;
  });

  /* extractRuns — alias de htmlToRuns (même logique, pas de duplication) */
  function extractRuns(richContent, plainContent) {
    if (!richContent) return [{ text: plainContent || '', bold: false, italic: false, linkUrl: null, linkText: null }];
    return htmlToRuns(richContent);
  }

  /* ── Génère le code d'émission de runs rich (paragraphes, citations…) ── */
  function runsCode(varParent, runs, x, y, w, h, fontSize, color, extraOpts, indent) {
    const pad = ' '.repeat(indent);
    const lines = [];
    const extra = Object.entries(extraOpts).map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`).join('');
    if (!runs.length) return lines;

    /* Même découpage que emitRichRuns */
    const segments = _parseSegments(runs);
    if (!segments.length) return lines;

    const lineH = fontSize * 1.6;
    let curY = y;
    let isVeryFirst = true;

    segments.forEach(seg => {
      if (!seg.length) { curY += lineH; return; }

      seg.forEach((run, idx) => {
        const isFirst = isVeryFirst;
        const isLastRun = idx === seg.length - 1;
        isVeryFirst = false;

        const font = run.bold === false ? 'Regular' : (run.bold ? 'Bold' : run.italic ? 'Italic' : 'Regular');
        const clr = run.linkUrl ? LINK_COLOR : color;
        const safeText = run.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        const continued = isLastRun ? '' : ', continued: true';
        const underline = (run.linkUrl || run.underline) ? ', underline: true' : '';
        const link = run.linkUrl ? `, link: '${run.linkUrl.replace(/'/g, "\\'")}'` : '';

        const posArgs = isFirst ? `${x}, ${curY}, ` : '';
        const heightArg = isFirst ? `, height: ${h}` : '';
        const opts = `{ width: ${w}${heightArg}, lineBreak: true, ellipsis: true${continued}${underline}${link}${extra} }`;

        lines.push(`${pad}doc.fontSize(${fontSize}).font('${font}').fillColor('${clr}')`);
        lines.push(`${pad}  .text('${safeText}', ${posArgs}${opts});`);
      });

      curY += lineH;
      lines.push(`${pad}try { doc.text('', { continued: false }); } catch(_) {}`);
    });

    return lines;
  }

  /* ── Sérialise un bloc en code PDFKit browser ── */
  function blockLines(b) {
    const lines = [];
    const bx = b.x + CT_PAD;
    const bw = Math.max(10, b.w - CT_PAD * 2);
    const bh = Math.max(4, b.h - BAR_H - 8);
    const pageTop = Math.floor(b.y / PH) * PH;
    const by = b.y - pageTop + BAR_H;
    const id = b.id;
    const s = t => t.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const sn = t => s(t).replace(/\n/g, '\\n');

    const EXPORT_RENDERERS = {

      _heading(b) {
        const tag = b.type.toUpperCase(), fs = b.fontSize || FS[b.type];
        lines.push(`  // ${tag}`);
        lines.push(`  const ${b.type}_${id} = doc.struct('${tag}');`);
        lines.push(`  docStruct.add(${b.type}_${id});`);
        if (b.richContent) {
          const runs = extractRuns(b.richContent, b.content);
          lines.push(`  ${b.type}_${id}.add(() => {`);
          runsCode(b.type + '_' + id, runs, bx, by, bw, bh, fs, '#111111', { bold: true }, 4).forEach(l => lines.push(l));
          lines.push(`  });`);
        } else {
          const txt = s((b.content || 'Titre') + ' ');
          lines.push(`  ${b.type}_${id}.add(() => {`);
          lines.push(`    doc.fontSize(${fs}).font('Bold').fillColor('#111111')`);
          lines.push(`      .text('${txt}', ${bx}, ${by}, { width:${bw}, height:${bh}, lineBreak:true, ellipsis:true });`);
          lines.push(`  });`);
        }
        lines.push(`  ${b.type}_${id}.end();`);
      },

      p(b) {
        const runs = extractRuns(b.richContent, b.content);
        const indent = b.textIndent || 0;
        lines.push(`  // Paragraphe`);
        lines.push(`  const p_${id} = doc.struct('P');`);
        lines.push(`  docStruct.add(p_${id});`);
        lines.push(`  p_${id}.add(() => {`);
        runsCode('p_' + id, runs, bx + indent, by, bw - indent, bh, FS.p, '#111111', { lineGap: 2 }, 4).forEach(l => lines.push(l));
        lines.push(`  });`);
        lines.push(`  p_${id}.end();`);
      },

      _list(b) {
        const items = _parseListItems(b);
        const INDENT = 18;
        const lineH = Math.max(14, bh / Math.max(items.length, 1));

        const _toRoman = n => {
          const vals = [10,'x',9,'ix',5,'v',4,'iv',1,'i'];
          let r = '';
          for (let i = 0; i < vals.length; i += 2) while (n >= vals[i]) { r += vals[i+1]; n -= vals[i]; }
          return r;
        };
        const _label = (type, depth, counter) => {
          if (b.listNoBullet) return '';
          if (type === 'ul') return ['\u2022 ', '\u2013 ', '\u00B7 '][Math.min(depth, 2)];
          const sfx = ['. ',') ','. '][Math.min(depth, 2)];
          const pfx = depth === 0 ? String(counter) : depth === 1 ? String.fromCharCode(96 + counter) : _toRoman(counter);
          return pfx + sfx;
        };

        lines.push(`  // Liste ${b.type}`);
        lines.push(`  const list_${id} = doc.struct('L');`);
        lines.push(`  docStruct.add(list_${id});`);

        const counters = [];
        let prevDepth = 0;
        const stackVars = [`list_${id}`];

        items.forEach((item, i) => {
          const { runs, depth, type } = item;

          /* Gérer les changements de niveau */
          if (depth > prevDepth) {
            const subVar = `subL_${id}_${i}`;
            lines.push(`  const ${subVar} = doc.struct('L');`);
            lines.push(`  ${stackVars[stackVars.length-1]}.add(${subVar});`);
            stackVars.push(subVar);
          } else if (depth < prevDepth) {
            for (let d = prevDepth; d > depth; d--) {
              if (counters[d] !== undefined) counters[d] = 0;
              const closingVar = stackVars.pop();
              lines.push(`  ${closingVar}.end();`);
            }
          }
          prevDepth = depth;

          while (counters.length <= depth) counters.push(0);
          const counter = ++counters[depth];
          const label = _label(type, depth, counter);
          const indentX = bx + depth * INDENT;
          const lblW = b.listNoBullet ? 0 : 20;
          const bodyX = indentX + lblW;
          const bodyW = bw - depth * INDENT - lblW;
          const iy = by + i * lineH;

          const currentL = stackVars[stackVars.length - 1];
          lines.push(`  const li_${id}_${i} = doc.struct('LI');`);
          lines.push(`  ${currentL}.add(li_${id}_${i});`);
          if (!b.listNoBullet && label) {
            const safeLbl = label.replace(/'/g, "\\'");
            lines.push(`  li_${id}_${i}.add(doc.struct('Lbl', () => { doc.fontSize(${FS.list}).font('Regular').fillColor('#111111').text('${safeLbl}', ${indentX}, ${iy}, { width:${lblW + 4}, lineBreak:false }); }));`);
          }
          lines.push(`  const lbody_${id}_${i} = doc.struct('LBody');`);
          lines.push(`  li_${id}_${i}.add(lbody_${id}_${i});`);

          const hasNotes = runs.some(r => r.noteId);
          if (!hasNotes) {
            lines.push(`  lbody_${id}_${i}.add(() => {`);
            let isFirst = true;
            runs.forEach((run, ri) => {
              const isLast = ri === runs.length - 1;
              const font = run.bold ? 'Bold' : run.italic ? 'Italic' : 'Regular';
              const safeText = (run.text || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '');
              if (!safeText) return;
              const continued = isLast ? '' : ', continued: true';
              const underline = run.linkUrl ? ', underline: true' : '';
              const link = run.linkUrl ? `, link: '${run.linkUrl.replace(/'/g, "\\'")}'` : '';
              const posArgs = isFirst ? `${bodyX}, ${iy}, ` : '';
              const heightArg = isFirst ? `, height: ${lineH}` : '';
              lines.push(`    doc.fontSize(${FS.list}).font('${font}').fillColor('${run.linkUrl ? '#1d4ed8' : '#111111'}')`);
              lines.push(`      .text('${safeText}', ${posArgs}{ width: ${bodyW}${heightArg}, lineBreak: false${continued}${underline}${link} });`);
              isFirst = false;
            });
            lines.push(`  });`);
          } else {
            const supFs = Math.round(FS.list * 0.58);
            const supRise = Math.round(FS.list * 0.38);
            let isVeryFirst = true;
            runs.forEach((run, ri) => {
              const safeText = (run.text || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '');
              if (!safeText) return;
              const isLast = ri === runs.length - 1;
              const font = run.bold ? 'Bold' : run.italic ? 'Italic' : 'Regular';
              if (run.noteId) {
                const captNoteId = run.noteId;
                lines.push(`  const ref_${id}_${ri} = doc.struct('Reference');`);
                lines.push(`  lbody_${id}_${i}.add(ref_${id}_${ri});`);
                lines.push(`  const lnk_${id}_${ri} = doc.struct('Link', { alt: 'Note ${safeText}' });`);
                lines.push(`  ref_${id}_${ri}.add(lnk_${id}_${ri});`);
                lines.push(`  lnk_${id}_${ri}.add(() => {`);
                lines.push(`    const _cx = doc.x, _cy = doc.y;`);
                lines.push(`    doc.fontSize(${supFs}).font('${font}').fillColor('${LINK_COLOR}');`);
                lines.push(`    const _sw = doc.widthOfString('${safeText}') + 1;`);
                lines.push(`    const _sh = ${supFs * 1.5};`);
                lines.push(`    doc.text('${safeText}', _cx, _cy - ${supRise}, { lineBreak: false, continued: true, width: _sw + 4, height: _sh });`);
                lines.push(`    doc.goTo(_cx, _cy - ${supRise}, _sw + 2, _sh, 'note-${captNoteId}', { structParent: lnk_${id}_${ri} });`);
                lines.push(`  });`);
                lines.push(`  lnk_${id}_${ri}.end(); ref_${id}_${ri}.end();`);
                lines.push(`  lbody_${id}_${i}.add(() => { doc.fontSize(${FS.list}).font('Regular').fillColor('#111111'); ${isLast ? "try { doc.text('', { continued: false }); } catch(e){}" : ''} });`);
              } else {
                const continued = isLast ? '' : ', continued: true';
                const underline = run.linkUrl ? ', underline: true' : '';
                const link = run.linkUrl ? `, link: '${run.linkUrl.replace(/'/g, "\\'")}'` : '';
                const clr = run.linkUrl ? '#1d4ed8' : '#111111';
                const posArgs = isVeryFirst ? `${bodyX}, ${iy}, ` : '';
                const heightArg = isVeryFirst ? `, height: ${lineH}` : '';
                lines.push(`  lbody_${id}_${i}.add(() => { doc.fontSize(${FS.list}).font('${font}').fillColor('${clr}').text('${safeText}', ${posArgs}{ width:${bodyW}${heightArg}, lineBreak:false${continued}${underline}${link} }); });`);
              }
              isVeryFirst = false;
            });
          }
          lines.push(`  lbody_${id}_${i}.end(); li_${id}_${i}.end();`);
        });

        /* Fermer les L encore ouverts */
        while (stackVars.length > 1) {
          lines.push(`  ${stackVars.pop()}.end();`);
        }
        lines.push(`  list_${id}.end();`);
      },

      img(b) {
        if (!b.imgData) return;
        const ix = b.x, iy = b.y - pageTop, iw = b.w, ih = b.h;
        const x1 = ix, y1 = PH - (iy + ih), x2 = ix + iw, y2 = PH - iy;
        const alt = s(b.alt || 'Image');
        lines.push(`  // Image`);
        lines.push(`  const fig_${id} = doc.struct('Figure');`);
        lines.push(`  fig_${id}.dictionary.data.Alt = new String('${alt}');`);
        lines.push(`  fig_${id}.dictionary.data.Pg  = doc.page.dictionary;`);
        lines.push(`  fig_${id}.dictionary.data.A   = [{ O:'Layout', BBox:[${x1},${y1},${x2},${y2}], Placement:'Block' }];`);
        lines.push(`  docStruct.add(fig_${id});`);
        lines.push(`  const IMG_DATA_${id} = ${JSON.stringify(b.imgData)};`);
        lines.push(`  fig_${id}.add(() => { doc.image(IMG_DATA_${id}, ${ix}, ${iy}, { fit:[${iw},${ih}] }); });`);
        lines.push(`  fig_${id}.end();`);
      },

      link(b) {
        const url = s(b.linkUrl || 'https://');
        const txt = s((b.linkText || 'Lien') + ' ');
        lines.push(`  // Lien`);
        lines.push(`  const pLnk_${id} = doc.struct('P');`);
        lines.push(`  const lnk_${id} = doc.struct('Link', { alt:'${txt}' }, () => {`);
        lines.push(`    doc.fontSize(${FS.link}).font('Regular').fillColor('#1d4ed8')`);
        lines.push(`      .text('${txt}', ${bx}, ${by}, { width:${bw}, height:${bh}, lineBreak:true, ellipsis:true, link:'${url}' });`);
        lines.push(`  });`);
        lines.push(`  pLnk_${id}.add(lnk_${id}); docStruct.add(pLnk_${id}); pLnk_${id}.end();`);
      },

      quote(b) {
        const runs = extractRuns(b.richContent, b.content);
        const src = s(b.quoteSource || '');
        lines.push(`  // Citation`);
        lines.push(`  const q_${id} = doc.struct('BlockQuote');`);
        lines.push(`  docStruct.add(q_${id});`);
        lines.push(`  doc.markContent('Artifact');`);
        lines.push(`  doc.save().lineWidth(3).strokeColor('#6366f1').moveTo(${bx},${by}).lineTo(${bx},${by + bh}).stroke().restore();`);
        lines.push(`  doc.endMarkedContent();`);
        lines.push(`  q_${id}.add(() => {`);
        runsCode('q_' + id, runs, bx + 8, by, bw - 8, bh * 0.8, FS.quote, '#1e1b4b', {}, 4).forEach(l => lines.push(l));
        lines.push(`  });`);
        if (src) {
          lines.push(`  q_${id}.add(doc.struct('P', () => {`);
          lines.push(`    doc.fontSize(9).font('Regular').fillColor('#6b7280').text('${src}', ${bx + 8}, ${by + bh * 0.8}, { width:${bw - 8}, lineBreak:false });`);
          lines.push(`  }));`);
        }
        lines.push(`  q_${id}.end();`);
      },

      note(b) {
        const runs = extractRuns(b.richContent, b.content);
        const ref = '[' + (b.noteRef || '1') + '] ';
        lines.push(`  // Note (PAC-safe P)`);
        lines.push(`  const p_${id} = doc.struct('P');`);
        lines.push(`  p_${id}.dictionary.data.ID = new String('note-${id}');`);
        lines.push(`  docStruct.add(p_${id});`);
        lines.push(`  p_${id}.add(doc.struct('Span', () => {`);
        lines.push(`    doc.fontSize(${FS.note}).font('Regular').fillColor('#374151').text('${ref}', ${bx}, ${by}, { width:22, lineBreak:false, destination:'note-${id}' });`);
        lines.push(`  }));`);
        lines.push(`  p_${id}.add(() => {`);
        runsCode('p_' + id, runs, bx + 22, by, bw - 22, bh, FS.note, '#374151', { lineGap: 1 }, 4).forEach(l => lines.push(l));
        lines.push(`  });`);
        lines.push(`  p_${id}.end();`);
      },

      hr(b) {
        const lineY = by + bh / 2;
        lines.push(`  // Séparateur`);
        lines.push(`  doc.markContent('Artifact');`);
        lines.push(`  doc.save().lineWidth(0.75).strokeColor('#d1d5db').moveTo(${bx},${lineY}).lineTo(${bx + bw},${lineY}).stroke().restore();`);
        lines.push(`  doc.endMarkedContent();`);
      },

      aside(b) {
        const st = ASIDE_STYLES[b.asideStyle || 'info'];
        const runs = extractRuns(b.richContent, b.content);
        const textX = bx + 24, textW = bw - 26;
        lines.push(`  // Encadré`);
        lines.push(`  doc.markContent('Artifact');`);
        lines.push(`  doc.save().fillColor('${st.bg}').rect(${bx},${by},${bw},${bh}).fill();`);
        lines.push(`  doc.fillColor('${st.border}').rect(${bx},${by},3,${bh}).fill().restore();`);
        lines.push(`  doc.endMarkedContent();`);
        lines.push(`  const aside_${id} = doc.struct('Sect');`);
        lines.push(`  docStruct.add(aside_${id});`);
        lines.push(`  aside_${id}.add(() => {`);
        runsCode('aside_' + id, runs, textX, by + 4, textW, bh - 8, FS.p, '#1a1a1a', { lineGap: 1 }, 4).forEach(l => lines.push(l));
        lines.push(`  });`);
        lines.push(`  aside_${id}.end();`);
      },

      code(b) {
        const txt = sn((b.content || '') + ' ');
        lines.push(`  // Code`);
        lines.push(`  doc.markContent('Artifact');`);
        lines.push(`  doc.save().fillColor('#1e293b').rect(${bx},${by},${bw},${bh}).fill().restore();`);
        lines.push(`  doc.endMarkedContent();`);
        lines.push(`  const code_${id} = doc.struct('Code');`);
        lines.push(`  docStruct.add(code_${id});`);
        lines.push(`  const codeSpan_${id} = doc.struct('Span');`);
        lines.push(`  codeSpan_${id}.add(() => {`);
        lines.push(`    doc.fontSize(${FS.code}).font('Regular').fillColor('#e2e8f0')`);
        lines.push(`      .text('${txt}', ${bx + 6}, ${by + 5}, { width:${bw - 12}, height:${bh - 10}, lineBreak:true, ellipsis:true, lineGap:1 });`);
        lines.push(`  });`);
        lines.push(`  codeSpan_${id}.end();`);
        lines.push(`  code_${id}.add(codeSpan_${id});`);
        lines.push(`  code_${id}.end();`);
      },

      table(b) {
        const rows = b.tableData || [];
        if (!rows.length) return;
        const colCount = Math.max(...rows.map(r => r.length));
        const colW = bw / colCount, rowH = 16, tableH = rows.length * rowH;
        const padX = 4, padY = 3;
        lines.push(`  // Tableau`);
        lines.push(`  doc.markContent('Artifact');`);
        lines.push(`  doc.save().lineWidth(0.5).strokeColor('#e5e7eb');`);
        lines.push(`  doc.fillColor('#f9fafb').rect(${bx},${by},${bw},${rowH}).fill();`);
        for (let ri = 0; ri <= rows.length; ri++)
          lines.push(`  doc.moveTo(${bx},${by + ri * rowH}).lineTo(${bx + bw},${by + ri * rowH}).stroke();`);
        for (let ci = 0; ci <= colCount; ci++)
          lines.push(`  doc.moveTo(${bx + ci * colW},${by}).lineTo(${bx + ci * colW},${by + tableH}).stroke();`);
        lines.push(`  doc.restore();`);
        lines.push(`  doc.endMarkedContent();`);
        lines.push(`  const tbl_${id} = doc.struct('Table');`);
        lines.push(`  docStruct.add(tbl_${id});`);
        rows.forEach((row, ri) => {
          const rowY = by + ri * rowH;
          const isHdr = ri === 0;
          const trVar = `tr_${id}_${ri}`;
          lines.push(`  const ${trVar} = doc.struct('TR');`);
          lines.push(`  tbl_${id}.add(${trVar});`);
          row.forEach((cell, ci) => {
            const safe = s(String(cell || ''));
            const cellX = bx + ci * colW;
            const cellTag = isHdr ? 'TH' : 'TD';
            const cellVar = `cell_${id}_${ri}_${ci}`;
            lines.push(`  const ${cellVar} = doc.struct('${cellTag}');`);
            if (isHdr) lines.push(`  ${cellVar}.dictionary.data.Scope = 'Column';`);
            lines.push(`  ${trVar}.add(${cellVar});`);
            lines.push(`  ${cellVar}.add(() => { doc.fontSize(${FS.table}).font('${isHdr ? 'Bold' : 'Regular'}').fillColor('#111111').text('${safe}', ${cellX + padX}, ${rowY + padY}, { width:${colW - padX * 2}, height:${rowH - padY}, lineBreak:false, ellipsis:true }); });`);
            lines.push(`  ${cellVar}.end();`);
          });
          lines.push(`  ${trVar}.end();`);
        });
        lines.push(`  tbl_${id}.end();`);
      },
    };

    /* Aliaser heading et list */
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(t => { EXPORT_RENDERERS[t] = EXPORT_RENDERERS._heading; });
    ['ul', 'ol'].forEach(t => { EXPORT_RENDERERS[t] = EXPORT_RENDERERS._list; });

    const fn = EXPORT_RENDERERS[b.type];
    if (fn) fn(b);
    return lines;
  }

  /* ── Construit le script complet ── */
  const safeTitle = title.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeAuthor = author.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeSubject = subject.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const scriptLines = [
    `/**`,
    ` * Script généré par l'éditeur PDF/UA`,
    ` * Intégration dans une page HTML :`,
    ` *   <script src="https://cdn.jsdelivr.net/npm/pdfkit@0.18.0/js/pdfkit.standalone.js"><\/script>`,
    ` *   <script src="https://cdn.jsdelivr.net/npm/blob-stream@0.1.3/index.js"><\/script>`,
    ` *   <script src="ce-fichier.js"><\/script>`,
    ` *`,
    ` * Appelez generatePDF() pour déclencher le téléchargement.`,
    ` */`,
    `async function generatePDF() {`,
    `  const doc = new PDFDocument({`,
    `    pdfVersion: '1.7',`,
    `    subset: 'PDF/UA',`,
    `    tagged: true,`,
    `    lang: '${lang}',`,
    `    info: {`,
    `      Title:   '${safeTitle}',`,
    `      Author:  '${safeAuthor}',`,
    `      Subject: '${safeSubject}',`,
    `      Creator: 'Générateur de PDF',`,
    `      Producer: ''`,
    `    },`,
    `    displayTitle: true,`,
    `    autoFirstPage: false,`,
    `    size: [${PW}, ${PH}],`,
    `    margins: { top: 0, bottom: 0, left: 0, right: 0 }`,
    `  });`,
    ``,
    `  // Enregistrez vos polices — remplacez les chemins ou data-URLs selon votre projet`,
    `  // doc.registerFont('Regular', regularFontDataUrl);`,
    `  // doc.registerFont('Bold',    boldFontDataUrl);`,
    `  // doc.registerFont('Italic',  italicFontDataUrl);`,
    `  // doc.font('Regular');`,
    ``,
    `  const stream = doc.pipe(blobStream());`,
    ``,
    `  const docStruct = doc.struct('Document');`,
    `  doc.addStructure(docStruct);`,
    ``,
    `  let currentPage = -1;`,
    ``
  ];

  let prevPage = -1;
  sorted.forEach(b => {
    const blockPage = Math.floor(b.y / PH);
    while (prevPage < blockPage) {
      prevPage++;
      scriptLines.push(`  // ── Page ${prevPage + 1} ──`);
      scriptLines.push(`  doc.addPage({ size: [${PW}, ${PH}], margins: { top: 0, bottom: 0, left: 0, right: 0 } });`);
      scriptLines.push(`  currentPage++;`);
      scriptLines.push(``);
    }
    blockLines(b).forEach(l => scriptLines.push(l));
    scriptLines.push(``);
  });

  scriptLines.push(
    `  docStruct.end();`,
    ``,
    `  // Supprimer CIDSet (erreurs PDF/UA)`,
    `  Object.values(doc._fontFamilies || {}).forEach(font => {`,
    `    if (font && font.descriptor && font.descriptor.data)`,
    `      delete font.descriptor.data.CIDSet;`,
    `  });`,
    ``,
    `  doc.end();`,
    ``,
    `  stream.on('finish', () => {`,
    `    const a = document.createElement('a');`,
    `    a.href = stream.toBlobURL('application/pdf');`,
    `    a.download = '${safeTitle || 'document'}.pdf';`,
    `    a.click();`,
    `  });`,
    `}`
  );

  const code = scriptLines.join('\n');

  /* ── Télécharger le fichier .js ── */
  const blob = new Blob([code], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (title.trim() || 'document') + '-pdfkit.js';
  a.click();
  URL.revokeObjectURL(url);

  announce('Code JS exporté avec succès.');
}