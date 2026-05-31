// pdf-builder.js — Orchestration PDF/UA : buildPDF, TdM, numéros de page, signets, genPDF, prevPDF

function mkInfo() {
  const info = { Creator: CREATOR, Producer: PRODUCER };
  const g = id => document.getElementById(id).value.trim();
  const t = g('m-title'), a = g('m-author'), s = g('m-subject');
  if (t) info.Title = t;
  if (a) info.Author = a;
  if (s) info.Subject = s;
  return info;
}

async function buildPDF() {
  const lang = document.getElementById('m-lang').value || 'fr-FR';
  /* Table de liaison ancres→notes : remplie par emitRichRuns pendant le rendu */
  emitRichRuns._noteLinks = [];
  /* Table note id → structure PDFKit Note : remplie par le renderer note */
  buildPDF._noteStructs = {};

  const fontRegular = window.FONTS.regular;
  const fontBold = window.FONTS.bold;
  const fontItalic = window.FONTS.italic;

  const doc = new PDFDocument({
    pdfVersion: '1.7',
    subset: 'PDF/UA',
    tagged: true,
    lang: lang,
    info: mkInfo(),
    displayTitle: true,
    autoFirstPage: false,
    size: [pageW(0), pageH(0)],
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });
  /* Ajouter la première page manuellement avec la bonne orientation */
  doc.addPage({ size: [pageW(0), pageH(0)], margins: { top: 0, bottom: 0, left: 0, right: 0 } });

  doc.registerFont('Regular', fontRegular);
  doc.registerFont('Bold', fontBold);
  doc.registerFont('Italic', fontItalic);
  doc.font('Regular');

  /* Initialiser AcroForm — obligatoire avant tout appel formText/formCheckbox/etc.
     Doit être appelé après doc.font() car PDFKit enregistre la police par défaut du formulaire. */
  const hasFormBlocks = blocks.some(b => b.type.startsWith('form-'));
  if (hasFormBlocks) {
    doc.initForm();
    /* NeedAppearances:true (défaut PDFKit) ordonne au lecteur PDF de
       recalculer les apparences des champs, écrasant nos AP streams DSFR.
       On le désactive ici pour que nos Form XObjects soient utilisés tels quels. */
    doc._root.data.AcroForm.data.NeedAppearances = false;
  }

  /* Trier par page puis par position y (ordre de lecture) */
  const sorted = ordB().slice().sort((a, b) => {
    const pa = Math.floor(a.y / PH), pb = Math.floor(b.y / PH);
    return pa !== pb ? pa - pb : a.y - b.y;
  });

  /* Pré-grouper les blocs par index de page — O(n) au lieu de O(n×numPages) */
  const RE_HEADING = /^h[1-6]$/;
  const blocksByPage = new Map();
  for (const b of sorted) {
    const pi = Math.floor(b.y / PH);
    if (!blocksByPage.has(pi)) blocksByPage.set(pi, []);
    blocksByPage.get(pi).push(b);
  }

  const docStruct = doc.struct('Document');
  doc.addStructure(docStruct);



  /* ── Collecte des titres pour la TdM (avant rendu) ── */
  const tocEnabled = document.getElementById('toc-enabled')?.checked || false;
  const tocDepth = parseInt(document.getElementById('toc-depth')?.value || '3');
  const tocAfterFirst = document.getElementById('toc-after-first')?.checked !== false;
  const tocTitleText = document.getElementById('toc-title')?.value.trim() || 'Table des matières';

  /* Titres éligibles triés par position */
  const headingEntries = tocEnabled
    ? sorted.filter(b => RE_HEADING.test(b.type) && parseInt(b.type[1]) <= tocDepth)
    : [];

  /* ── Paramètres de pagination ── */
  const pgEnabled = document.getElementById('pg-enabled')?.checked || false;
  const pgSkipFirst = document.getElementById('pg-skip-first')?.checked !== false;
  const pgPosition = document.getElementById('pg-position')?.value || 'bottom-center';
  const pgFormat = document.getElementById('pg-format')?.value || 'n/t';

  /* La TdM ajoute une page physique supplémentaire */
  const extraTocPage = tocEnabled ? 1 : 0;
  const totalPDFPages = numPages + extraTocPage;

  /* ── Pré-calcul des numéros de page physique pour chaque titre ──
     On sait que :
       - page canvas 0  → page physique 0
       - TdM (si tocAfterFirst) → page physique 1
       - page canvas k  → page physique k + extraTocPage (si tocAfterFirst)
  */
  const _tocDestinations = {}; /* b.id → { destName, physPage } */
  if (tocEnabled) {
    headingEntries.forEach(b => {
      const canvasPage = Math.floor(b.y / PH);
      let physP;
      if (tocAfterFirst) {
        physP = canvasPage === 0 ? 0 : canvasPage + 1;
      } else {
        physP = canvasPage + 1; /* TdM en page 0, contenu décalé de 1 */
      }
      _tocDestinations[b.id] = { destName: 'toc-dest-' + b.id, physPage: physP };
    });
  }

  /* Helper : dessiner le numéro de page sur la page courante (Artifact, hors structure) */
  function _drawPageNumber(pagePhysIdx) {
    if (!pgEnabled) return;
    if (pgSkipFirst && pagePhysIdx === 0) return;

    const pw = doc.page.width;
    const ph = doc.page.height;
    const margin = MAR;
    const fs = 9;

    const displayNum = pagePhysIdx + 1;
    let label = '';
    switch (pgFormat) {
      case 'n': label = String(displayNum); break;
      case 'n/t': label = displayNum + ' / ' + totalPDFPages; break;
      case 'page-n': label = 'Page ' + displayNum; break;
      case 'page-n/t': label = 'Page ' + displayNum + ' / ' + totalPDFPages; break;
      default: label = String(displayNum);
    }

    let tx, ty, align;
    const isBottom = pgPosition.startsWith('bottom');
    ty = isBottom ? ph - margin + 6 : margin - fs - 6;
    const side = pgPosition.split('-')[1];
    if (side === 'center') { tx = margin; align = 'center'; }
    else if (side === 'right') { tx = pw - margin - 80; align = 'right'; }
    else { tx = margin; align = 'left'; }

    doc.markContent('Artifact');
    doc.save()
      .fontSize(fs).font('Regular').fillColor('#595f6b') /* #595f6b → ratio 7,0:1 sur blanc — WCAG AA ✓ */
      .text(label, tx, ty, { width: pw - margin * 2, align, lineBreak: false });
    doc.restore();
    doc.endMarkedContent();
  }

  /* ── Fonction de rendu de la page TdM ── */
  function _renderTOCPage(ds) {
    const pw = doc.page.width;
    const tocTitleFs = 20;
    const entryFs = 11;
    const lineH = 22;
    const marginX = MAR;
    let curY = MAR;

    /* ── Titre de la TdM — H2 ── */
    const tocTitleStr = tocTitleText || 'Table des matières';
    const tocTitleS = doc.struct('H2');
    ds.add(tocTitleS);
    tocTitleS.add(() => {
      doc.fontSize(tocTitleFs).font('Bold').fillColor('#111111')
        .text(tocTitleStr, marginX, curY, { width: pw - marginX * 2, lineBreak: false });
    });
    tocTitleS.end();
    curY += tocTitleFs + 16;

    /* Ligne décorative — Artifact */
    doc.markContent('Artifact');
    doc.save().lineWidth(0.75).strokeColor('#e5e7eb')
      .moveTo(marginX, curY).lineTo(pw - marginX, curY).stroke().restore();
    doc.endMarkedContent();
    curY += 12;

    /* ── Structure TOC (tag PDF 1.7 standard — ISO 32000-1 Table 340) ── */
    const tocS = doc.struct('TOC');
    ds.add(tocS);

    for (const b of headingEntries) {
      const level = parseInt(b.type[1]);
      const indent = (level - 1) * 18;
      const destInfo = _tocDestinations[b.id];
      const pageNum = destInfo ? (destInfo.physPage + 1) : '?';
      const entryText = (b.content || ('Titre ' + level)).trim();
      const destName = destInfo ? destInfo.destName : null;
      const pageNumStr = String(pageNum);

      const isBold = level === 1;
      const textColor = level === 1 ? '#111111' : level === 2 ? '#374151' : '#505869';
      const fs = level === 1 ? entryFs + 1 : level === 2 ? entryFs : entryFs - 1;
      const pageNumW = 36;
      const titleZoneW = pw - marginX * 2 - indent - pageNumW - 16;

      /* Mesure réelle pour les pointillés */
      doc.fontSize(fs).font(isBold ? 'Bold' : 'Regular');
      const titleActualW = Math.min(doc.widthOfString(entryText), titleZoneW);
      const dotGap = 5;
      const dotStartX = marginX + indent + titleActualW + dotGap;
      const pageNumX = pw - marginX - pageNumW;
      const dotEndX = pageNumX - dotGap;
      const dotY = curY + fs * 0.72;

      /* ── TOCI ── */
      const tociS = doc.struct('TOCI');
      tocS.add(tociS);

      /* ── Lbl avec lien interne PDF/UA-conforme ──
         PDF/UA exige que l'élément Link contienne un OBJR (Object Reference)
         vers l'annotation Link sous-jacente.
         Technique : dessiner le texte d'abord (dans un Span), puis appeler
         doc.goTo() avec { structParent: lnkS } pour créer l'annotation et
         l'OBJR en une seule opération. ── */
      const lblS = doc.struct('Lbl');
      tociS.add(lblS);

      if (destName) {
        const lnkS = doc.struct('Link', { alt: entryText + ', page ' + pageNumStr });
        lblS.add(lnkS);
        lnkS.add(() => {
          /* 1. Dessiner le texte en couleur lien */
          doc.fontSize(fs).font(isBold ? 'Bold' : 'Regular').fillColor(LINK_COLOR)
            .text(entryText, marginX + indent, curY, {
              width: titleZoneW, lineBreak: false, ellipsis: true,
            });
          /* 2. Poser l'annotation Link GoTo + OBJR via structParent
                goTo() appelle annotate() qui détecte structParent
                et crée automatiquement l'OBJR dans lnkS.dictionary.data.K */
          const tw = Math.min(doc.widthOfString(entryText), titleZoneW);
          const lh = doc.currentLineHeight();
          doc.goTo(marginX + indent, curY, tw, lh, destName, { structParent: lnkS });
        });
        lnkS.end();
      } else {
        lblS.add(() => {
          doc.fontSize(fs).font(isBold ? 'Bold' : 'Regular').fillColor(textColor)
            .text(entryText, marginX + indent, curY, {
              width: titleZoneW, lineBreak: false, ellipsis: true,
            });
        });
      }
      lblS.end();

      /* ── Points de conduite — Artifact ── */
      if (dotEndX > dotStartX + 4) {
        doc.markContent('Artifact');
        doc.save()
          .lineWidth(0.5).strokeColor('#b0b8c4')
          .dash(1.5, { space: 3.5 })
          .moveTo(dotStartX, dotY).lineTo(dotEndX, dotY)
          .stroke().undash().restore();
        doc.endMarkedContent();
      }

      /* ── Reference : numéro de page ── */
      const refS = doc.struct('Reference');
      tociS.add(refS);
      refS.add(() => {
        doc.fontSize(fs).font('Regular').fillColor(textColor)
          .text(pageNumStr, pageNumX, curY, {
            width: pageNumW, align: 'right', lineBreak: false,
          });
      });
      refS.end();

      tociS.end();
      curY += lineH;
      if (curY > doc.page.height - MAR * 2) break;
    }

    tocS.end();
  }

  /* ── Rendu page 0 ── */
  let physPage = 0;
  _drawPageNumber(physPage);

  for (const b of (blocksByPage.get(0) || [])) {
    doc.fillColor('#111111').font('Regular');
    if (tocEnabled && _tocDestinations[b.id]) {
      /* Destination nommée : objet indirect PDF, pas de contenu de flux → pas de markContent */
      doc.addNamedDestination(_tocDestinations[b.id].destName);
    }
    const renderer = BLOCK_RENDERERS[b.type];
    if (renderer) renderer(doc, docStruct, b);
  }

  /* ── Insertion de la page TdM ── */
  if (tocEnabled) {
    physPage++;
    doc.addPage({ size: [pageW(0), pageH(0)], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    _drawPageNumber(physPage);
    _renderTOCPage(docStruct);
  }

  /* ── Rendu des pages canvas suivantes ── */
  for (let canvasPage = 1; canvasPage < numPages; canvasPage++) {
    const pw = pageW(canvasPage), ph = pageH(canvasPage);
    physPage++;
    doc.addPage({ size: [pw, ph], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    _drawPageNumber(physPage);

    for (const b of (blocksByPage.get(canvasPage) || [])) {
      doc.fillColor('#111111').font('Regular');
      if (tocEnabled && _tocDestinations[b.id]) {
        /* Destination nommée : objet indirect PDF, pas de contenu de flux → pas de markContent */
        doc.addNamedDestination(_tocDestinations[b.id].destName);
      }
      const renderer = BLOCK_RENDERERS[b.type];
      if (renderer) renderer(doc, docStruct, b);
    }
  }

  /* ── Liaison PDF/UA : ancres de notes ↔ structures Note ── */
  (function linkNoteAnchors() {
    const noteLinks = emitRichRuns._noteLinks || [], noteStructs = buildPDF._noteStructs || {};
    noteLinks.forEach(({ struct: anchorLink, noteId }) => {
      const entry = noteStructs[noteId]; if (!entry) return;
      const { noteStruct, backLink } = entry;
      try { anchorLink.dictionary.data.Obj = noteStruct.dictionary; } catch (_) { }
      try { noteStruct.dictionary.data.Obj = anchorLink.dictionary; } catch (_) { }
      if (backLink) { try { backLink.dictionary.data.Obj = anchorLink.dictionary; } catch (_) { } try { backLink.end(); } catch (_) { } }
      try { anchorLink.end(); } catch (_) { }
      try { noteStruct.end(); } catch (_) { }
    });
    emitRichRuns._noteLinks = []; buildPDF._noteStructs = {};
  })();

  /* ── Signets PDF — pageNumber + top calculés depuis b.y ── */
  (function buildBookmarks() {
    const lastAtLevel = { 0: doc.outline };
    blocks.filter(b => RE_HEADING.test(b.type)).sort((a, b) => a.y - b.y).forEach(b => {
      const lv = parseInt(b.type[1]);
      let parent = null;
      for (let l = lv - 1; l >= 0; l--) { if (lastAtLevel[l]) { parent = lastAtLevel[l]; break; } }
      if (!parent) return;
      const canvasPage = Math.floor(b.y / PH);
      /* physPage = canvasPage + décalage TdM éventuel */
      const physP = tocEnabled && tocAfterFirst
        ? (canvasPage === 0 ? 0 : canvasPage + 1)
        : tocEnabled ? canvasPage + 1 : canvasPage;
      const pageH_val = pageH(canvasPage);
      /* top = distance depuis le bas de la page (convention PDFKit) */
      const yOnPage = b.y - canvasPage * PH + BAR_H;
      const top = pageH_val - yOnPage;
      lastAtLevel[lv] = parent.addItem(b.content || '', { pageNumber: physP, top });
    });
  })();

  docStruct.end();

  /* Supprimer CIDSet qui cause des erreurs PDF/UA */
  Object.values(doc._fontFamilies || {}).forEach(f => { if (f?.descriptor?.data) delete f.descriptor.data.CIDSet; });

  /* Forcer NeedAppearances=false en dernier, après tous les formCombo/formText
     car PDFKit peut le remettre à true lors de la création des champs */
  if (doc._root?.data?.AcroForm?.data) {
    doc._root.data.AcroForm.data.NeedAppearances = false;
  }

  return doc;
}

/* ── Helper partagé : vérifie le titre et construit le flux PDF ── */
async function _requireTitleAndBuild(actionLabel) {
  const tf = document.getElementById('m-title');
  if (!tf.value.trim()) {
    announce('⚠ Veuillez définir un titre avant de ' + actionLabel + '.');
    switchTab('meta');
    tf.focus();
    tf.classList.add('input-error');
    setTimeout(() => tf.classList.remove('input-error'), 2500);
    return null;
  }
  const doc = await buildPDF();
  const stream = doc.pipe(blobStream());
  doc.end();
  return { doc, stream, title: tf.value.trim() };
}

async function genPDF() {
  const btn = document.getElementById('btn-gen');
  const reset = () => { btn.removeAttribute('aria-busy'); btn.disabled = false; btn.innerHTML = '<span aria-hidden="true">⬇</span> Générer le PDF/UA'; };
  btn.setAttribute('aria-busy', 'true'); btn.disabled = true; btn.textContent = 'Génération en cours…';
  try {
    const result = await _requireTitleAndBuild('générer le PDF');
    if (!result) { reset(); return; }
    const { stream, title } = result;
    stream.on('finish', () => {
      const a = document.createElement('a'); a.href = stream.toBlobURL('application/pdf'); a.download = (title || 'document') + '.pdf'; a.click();
      reset(); announce('PDF téléchargé avec succès.');
    });
    stream.on('error', err => { reset(); announce('Erreur lors de la génération : ' + err.message); });
  } catch (err) { reset(); announce('Erreur : ' + err.message); }
}

async function prevPDF() {
  announce('Génération de la prévisualisation…');
  try {
    const result = await _requireTitleAndBuild('prévisualiser le PDF');
    if (!result) return;
    result.stream.on('finish', () => {
      document.getElementById('pif').src = result.stream.toBlobURL('application/pdf');
      openPv();
    });
    result.stream.on('error', err => announce('Erreur : ' + err.message));
  } catch (err) { announce('Erreur : ' + err.message); }
}