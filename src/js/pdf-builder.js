// pdf-builder.js — Orchestration PDF/UA : PDFBuilder, genPDF, prevPDF

/* ══════════════════════════════════════════════════════════════════════
   PDFBuilder
   ──────────────────────────────────────────────────────────────────────
   Encapsule toute la logique d'orchestration de la génération PDF/UA.
   Usage :
     const builder = new PDFBuilder();
     const doc = await builder.build();
   ══════════════════════════════════════════════════════════════════════ */
class PDFBuilder {
  constructor() {
    // Paramètres lus depuis l'IHM au moment du build
    this.lang = null;
    this.doc = null;
    this.docStruct = null;

    // Blocs triés par ordre de lecture (page puis Y)
    this.sortedBlocks = [];
    // Map<pageIndex, Block[]> : blocs groupés par page canvas
    this.blocksByPage = new Map();

    // Options table des matières
    this.toc = {
      enabled: false,
      depth: 3,
      afterFirst: true,
      titleText: 'Table des matières',
      headingBlocks: [],         // blocs titres éligibles
      destinations: {},          // id bloc → { destName, physPage }
    };

    // Options pagination
    this.pagination = {
      enabled: false,
      skipFirst: true,
      position: 'bottom-center',
      format: 'n/t',
      totalPages: 0,
    };

    // État interne de rendu
    this._physPage = 0;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Point d'entrée public
  // ─────────────────────────────────────────────────────────────────────

  async build() {
    this._readSettings();
    this._prepareBlocks();
    this._prepareTOC();
    this._preparePagination();
    this._createDocument();
    this._registerFonts();
    this._initAcroFormIfNeeded();
    await this._renderAllPages();
    this._linkNoteAnchors();
    this._buildBookmarks();
    this._finalizeDocument();
    return this.doc;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 1 : lecture des réglages IHM
  // ─────────────────────────────────────────────────────────────────────

  _readSettings() {
    this.lang = document.getElementById('m-lang').value || 'fr-FR';

    this.toc.enabled = document.getElementById('toc-enabled')?.checked || false;
    this.toc.depth = parseInt(document.getElementById('toc-depth')?.value || '3');
    this.toc.afterFirst = document.getElementById('toc-after-first')?.checked !== false;
    this.toc.titleText = document.getElementById('toc-title')?.value.trim() || 'Table des matières';

    this.pagination.enabled = document.getElementById('pg-enabled')?.checked || false;
    this.pagination.skipFirst = document.getElementById('pg-skip-first')?.checked !== false;
    this.pagination.position = document.getElementById('pg-position')?.value || 'bottom-center';
    this.pagination.format = document.getElementById('pg-format')?.value || 'n/t';
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 2 : tri et groupement des blocs
  // ─────────────────────────────────────────────────────────────────────

  _prepareBlocks() {
    this.sortedBlocks = ordB().slice();

    this.blocksByPage = new Map();
    for (const b of this.sortedBlocks) {
      const pi = Math.floor(b.y / PH);
      if (!this.blocksByPage.has(pi)) this.blocksByPage.set(pi, []);
      this.blocksByPage.get(pi).push(b);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 3 : préparation de la table des matières
  // ─────────────────────────────────────────────────────────────────────

  _prepareTOC() {
    if (!this.toc.enabled) return;

    const RE_HEADING = /^h[1-6]$/;
    this.toc.headingBlocks = this.sortedBlocks.filter(
      b => RE_HEADING.test(b.type) && parseInt(b.type[1]) <= this.toc.depth
    );

    this.toc.destinations = {};
    for (const b of this.toc.headingBlocks) {
      const canvasPage = Math.floor(b.y / PH);
      let physPage;
      if (this.toc.afterFirst) {
        physPage = canvasPage === 0 ? 0 : canvasPage + 1;
      } else {
        physPage = canvasPage + 1; // TdM en page 0, contenu décalé de 1
      }
      this.toc.destinations[b.id] = {
        destName: 'toc-dest-' + b.id,
        physPage,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 4 : préparation de la pagination
  // ─────────────────────────────────────────────────────────────────────

  _preparePagination() {
    const extraTocPage = this.toc.enabled ? 1 : 0;
    this.pagination.totalPages = numPages + extraTocPage;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 5 : création du document PDFKit
  // ─────────────────────────────────────────────────────────────────────

  _createDocument() {
    // Réinitialiser l'état partagé utilisé par emitRichRuns / les renderers
    emitRichRuns._noteLinks = [];
    buildPDF._noteStructs = {};

    this.doc = new PDFDocument({
      pdfVersion: '1.7',
      subset: 'PDF/UA',
      tagged: true,
      lang: this.lang,
      info: this._collectDocInfo(),
      displayTitle: true,
      autoFirstPage: false,
      size: [pageW(0), pageH(0)],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    // Ajouter la première page manuellement avec la bonne taille
    this.doc.addPage({
      size: [pageW(0), pageH(0)],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    this.docStruct = this.doc.struct('Document');
    this.doc.addStructure(this.docStruct);
  }

  _collectDocInfo() {
    const g = id => document.getElementById(id).value.trim();
    const info = { Creator: CREATOR, Producer: PRODUCER };
    const t = g('m-title'), a = g('m-author'), s = g('m-subject');
    if (t) info.Title = t;
    if (a) info.Author = a;
    if (s) info.Subject = s;
    return info;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 6 : enregistrement des polices
  // ─────────────────────────────────────────────────────────────────────

  _registerFonts() {
    this.doc.registerFont('Regular', window.FONTS.regular);
    this.doc.registerFont('Bold', window.FONTS.bold);
    this.doc.registerFont('Italic', window.FONTS.italic);
    this.doc.registerFont('BoldItalic', window.FONTS.bolditalic);
    this.doc.font('Regular');
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 7 : initialisation AcroForm (formulaires PDF interactifs)
  // ─────────────────────────────────────────────────────────────────────

  _initAcroFormIfNeeded() {
    const hasFormBlocks = blocks.some(b => b.type.startsWith('form-'));
    if (!hasFormBlocks) return;

    this.doc.initForm();
    // NeedAppearances:true (défaut PDFKit) écrase nos AP streams DSFR.
    // On le désactive pour que nos Form XObjects soient utilisés tels quels.
    this.doc._root.data.AcroForm.data.NeedAppearances = false;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 8 : rendu de toutes les pages
  // ─────────────────────────────────────────────────────────────────────

  async _renderAllPages() {
    this._physPage = 0;

    // Page canvas 0
    this._drawPageNumber(this._physPage);
    this._renderCanvasPage(0);

    // Page TdM (insérée après la page 0 si afterFirst, avant sinon)
    if (this.toc.enabled) {
      this._physPage++;
      this.doc.addPage({
        size: [pageW(0), pageH(0)],
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      this._drawPageNumber(this._physPage);
      this._renderTOCPage();
    }

    // Pages canvas suivantes
    for (let canvasPage = 1; canvasPage < numPages; canvasPage++) {
      this._physPage++;
      this.doc.addPage({
        size: [pageW(canvasPage), pageH(canvasPage)],
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      this._drawPageNumber(this._physPage);
      this._renderCanvasPage(canvasPage);
    }
  }

  /** Rend tous les blocs d'une page canvas donnée. */
  _renderCanvasPage(canvasPage) {
    const { doc, docStruct, toc } = this;
    for (const b of (this.blocksByPage.get(canvasPage) || [])) {
      doc.fillColor('#111111').font('Regular');
      if (toc.enabled && toc.destinations[b.id]) {
        // La destination nommée est un objet indirect PDF (hors flux de contenu)
        doc.addNamedDestination(toc.destinations[b.id].destName);
      }
      const renderer = BLOCK_RENDERERS[b.type];
      if (renderer) renderer(doc, docStruct, b);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Rendu de la page Table des matières
  // ─────────────────────────────────────────────────────────────────────

  _renderTOCPage() {
    const { doc, docStruct, toc } = this;
    const pw = doc.page.width;
    const marginX = MAR;
    const tocTitleFs = 20;
    const entryFs = 11;
    const lineH = 22;
    let curY = MAR;

    // ── Titre de la TdM (H2) ──
    const tocTitleS = doc.struct('H2');
    docStruct.add(tocTitleS);
    tocTitleS.add(() => {
      doc.fontSize(tocTitleFs).font('Bold').fillColor('#111111')
        .text(toc.titleText, marginX, curY, { width: pw - marginX * 2, lineBreak: false });
    });
    tocTitleS.end();
    curY += tocTitleFs + 16;

    // Ligne décorative (Artifact)
    doc.markContent('Artifact');
    doc.save().lineWidth(0.75).strokeColor('#e5e7eb')
      .moveTo(marginX, curY).lineTo(pw - marginX, curY).stroke().restore();
    doc.endMarkedContent();
    curY += 12;

    // ── Structure TOC (ISO 32000-1 Table 340) ──
    const tocS = doc.struct('TOC');
    docStruct.add(tocS);

    for (const b of toc.headingBlocks) {
      curY = this._renderTOCEntry(tocS, b, curY, { pw, marginX, entryFs, lineH });
      if (curY > doc.page.height - MAR * 2) break;
    }

    tocS.end();
  }

  /** Rend une entrée (TOCI) dans la TdM et retourne la nouvelle position Y. */
  _renderTOCEntry(tocS, b, curY, { pw, marginX, entryFs, lineH }) {
    const { doc, toc } = this;
    const level = parseInt(b.type[1]);
    const indent = (level - 1) * 18;
    const destInfo = toc.destinations[b.id];
    const pageNum = destInfo ? (destInfo.physPage + 1) : '?';
    const entryText = (b.content || ('Titre ' + level)).trim();
    const destName = destInfo?.destName ?? null;
    const pageNumStr = String(pageNum);

    const isBold = level === 1;
    const textColor = level === 1 ? '#111111' : level === 2 ? '#374151' : '#505869';
    const fs = level === 1 ? entryFs + 1 : level === 2 ? entryFs : entryFs - 1;
    const pageNumW = 36;
    const titleZoneW = pw - marginX * 2 - indent - pageNumW - 16;

    doc.fontSize(fs).font(isBold ? 'Bold' : 'Regular');
    const titleActualW = Math.min(doc.widthOfString(entryText), titleZoneW);
    const dotGap = 5;
    const dotStartX = marginX + indent + titleActualW + dotGap;
    const pageNumX = pw - marginX - pageNumW;
    const dotEndX = pageNumX - dotGap;
    const dotY = curY + fs * 0.72;

    const tociS = doc.struct('TOCI');
    tocS.add(tociS);

    // Lbl avec lien interne PDF/UA-conforme
    const lblS = doc.struct('Lbl');
    tociS.add(lblS);

    if (destName) {
      const lnkS = doc.struct('Link', { alt: entryText + ', page ' + pageNumStr });
      lblS.add(lnkS);
      lnkS.add(() => {
        doc.fontSize(fs).font(isBold ? 'Bold' : 'Regular').fillColor(LINK_COLOR)
          .text(entryText, marginX + indent, curY, { width: titleZoneW, lineBreak: false, ellipsis: true });
        const tw = Math.min(doc.widthOfString(entryText), titleZoneW);
        const lh = doc.currentLineHeight();
        doc.goTo(marginX + indent, curY, tw, lh, destName, { structParent: lnkS });
      });
      lnkS.end();
    } else {
      lblS.add(() => {
        doc.fontSize(fs).font(isBold ? 'Bold' : 'Regular').fillColor(textColor)
          .text(entryText, marginX + indent, curY, { width: titleZoneW, lineBreak: false, ellipsis: true });
      });
    }
    lblS.end();

    // Points de conduite (Artifact)
    if (dotEndX > dotStartX + 4) {
      doc.markContent('Artifact');
      doc.save().lineWidth(0.5).strokeColor('#b0b8c4')
        .dash(1.5, { space: 3.5 })
        .moveTo(dotStartX, dotY).lineTo(dotEndX, dotY)
        .stroke().undash().restore();
      doc.endMarkedContent();
    }

    // Numéro de page (Reference)
    const refS = doc.struct('Reference');
    tociS.add(refS);
    refS.add(() => {
      doc.fontSize(fs).font('Regular').fillColor(textColor)
        .text(pageNumStr, pageNumX, curY, { width: pageNumW, align: 'right', lineBreak: false });
    });
    refS.end();

    tociS.end();
    return curY + lineH;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Numérotation des pages
  // ─────────────────────────────────────────────────────────────────────

  _drawPageNumber(pagePhysIdx) {
    const { doc, pagination } = this;
    if (!pagination.enabled) return;
    if (pagination.skipFirst && pagePhysIdx === 0) return;

    const pw = doc.page.width;
    const ph = doc.page.height;
    const margin = MAR;
    const fs = 9;
    const num = pagePhysIdx + 1;
    const total = pagination.totalPages;

    const label = this._formatPageLabel(num, total, pagination.format);

    const isBottom = pagination.position.startsWith('bottom');
    const ty = isBottom ? ph - margin + 6 : margin - fs - 6;
    const side = pagination.position.split('-')[1];
    let tx, align;
    if (side === 'center') { tx = margin; align = 'center'; }
    else if (side === 'right') { tx = pw - margin - 80; align = 'right'; }
    else { tx = margin; align = 'left'; }

    doc.markContent('Artifact');
    doc.save()
      .fontSize(fs).font('Regular').fillColor('#595f6b')
      .text(label, tx, ty, { width: pw - margin * 2, align, lineBreak: false });
    doc.restore();
    doc.endMarkedContent();
  }

  _formatPageLabel(num, total, format) {
    switch (format) {
      case 'n': return String(num);
      case 'n/t': return num + ' / ' + total;
      case 'page-n': return 'Page ' + num;
      case 'page-n/t': return 'Page ' + num + ' / ' + total;
      default: return String(num);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 9 : liaison des ancres de notes (PDF/UA)
  // ─────────────────────────────────────────────────────────────────────

  _linkNoteAnchors() {
    const noteLinks = emitRichRuns._noteLinks || [];
    const noteStructs = buildPDF._noteStructs || {};

    for (const { struct: anchorLink, noteId } of noteLinks) {
      const entry = noteStructs[noteId];
      if (!entry) continue;
      const { noteStruct, backLink } = entry;
      try { anchorLink.dictionary.data.Obj = noteStruct.dictionary; } catch (_) { }
      try { noteStruct.dictionary.data.Obj = anchorLink.dictionary; } catch (_) { }
      if (backLink) {
        try { backLink.dictionary.data.Obj = anchorLink.dictionary; } catch (_) { }
        try { backLink.end(); } catch (_) { }
      }
      try { anchorLink.end(); } catch (_) { }
      try { noteStruct.end(); } catch (_) { }
    }

    emitRichRuns._noteLinks = [];
    buildPDF._noteStructs = {};
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 10 : construction des signets (outline PDF)
  // ─────────────────────────────────────────────────────────────────────

  _buildBookmarks() {
    const { doc, toc } = this;
    const RE_HEADING = /^h[1-6]$/;
    const lastAtLevel = { 0: doc.outline };

    const headings = this.sortedBlocks.filter(b => b.type.match(/^h[1-6]$/));

    for (const b of headings) {
      const lv = parseInt(b.type[1]);

      // Trouver le parent le plus proche dans la hiérarchie des niveaux
      let parent = null;
      for (let l = lv - 1; l >= 0; l--) {
        if (lastAtLevel[l]) { parent = lastAtLevel[l]; break; }
      }
      if (!parent) continue;

      const canvasPage = Math.floor(b.y / PH);
      const physPage = this._canvasPageToPhysPage(canvasPage);

      // PDFKit attend `top` comme une distance depuis le HAUT de la page
      // (espace CSS/canvas), et se charge lui-même de la conversion vers
      // l'espace PDF (XYZ dest = [page, XYZ, left, destHeight - top, zoom]).
      // Passer ph - y serait une double conversion et inverserait le résultat.
      // On ajoute CT_PAD pour pointer sur le contenu visible (sous la barre flottante).
      const yOnPageCSS = b.y - canvasPage * PH;
      const top = yOnPageCSS + CT_PAD;

      lastAtLevel[lv] = parent.addItem(b.content || '', { pageNumber: physPage, top });
    }
  }

  /** Convertit un index de page canvas en index de page physique PDF. */
  _canvasPageToPhysPage(canvasPage) {
    if (!this.toc.enabled) return canvasPage;
    if (this.toc.afterFirst) return canvasPage === 0 ? 0 : canvasPage + 1;
    return canvasPage + 1; // TdM en page 0
  }

  // ─────────────────────────────────────────────────────────────────────
  // Étape 11 : finalisations PDF/UA
  // ─────────────────────────────────────────────────────────────────────

  _finalizeDocument() {
    const { doc } = this;

    this.docStruct.end();

    // Supprimer CIDSet (cause des erreurs PDF/UA dans certains validateurs)
    Object.values(doc._fontFamilies || {}).forEach(f => {
      if (f?.descriptor?.data) delete f.descriptor.data.CIDSet;
    });

    // S'assurer que NeedAppearances reste à false après la création des champs
    if (doc._root?.data?.AcroForm?.data) {
      doc._root.data.AcroForm.data.NeedAppearances = false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonctions utilitaires (conservées pour compatibilité avec genPDF / prevPDF)
// ─────────────────────────────────────────────────────────────────────────────

/** Construit le document PDF/UA et retourne l'instance PDFDocument. */
async function buildPDF() {
  return new PDFBuilder().build();
}
// Espace de noms partagé avec les renderers de notes
buildPDF._noteStructs = {};

/** Vérifie que le titre est défini, lance le build et retourne { doc, stream, title }. */
async function _requireTitleAndBuild(actionLabel) {
  const tf = document.getElementById('m-title');
  /* Nettoyer un message d'erreur précédent s'il existe encore */
  const prevErr = document.getElementById('m-title-error');
  if (prevErr) prevErr.remove();
  const existingDesc = tf.getAttribute('aria-describedby') || '';
  if (existingDesc.includes('m-title-error')) {
    tf.setAttribute('aria-describedby', existingDesc.replace(/\s*m-title-error\s*/g, ' ').trim());
  }

  if (!tf.value.trim()) {
    announce('⚠ Veuillez définir un titre avant de ' + actionLabel + '.', 'assertive');
    switchTab('meta');
    tf.focus();
    tf.classList.add('input-error');
    tf.setAttribute('aria-invalid', 'true');

    /* Message d'erreur persistant visible ET lisible par les AT via aria-describedby */
    const errMsg = document.createElement('p');
    errMsg.id = 'm-title-error';
    errMsg.className = 'field-error';
    errMsg.setAttribute('role', 'alert');
    errMsg.textContent = 'Le titre est obligatoire pour ' + actionLabel + '.';
    tf.insertAdjacentElement('afterend', errMsg);
    const baseDesc = (tf.getAttribute('aria-describedby') || 'm-title-hint').trim();
    tf.setAttribute('aria-describedby', baseDesc + ' m-title-error');

    const clearErr = () => {
      tf.classList.remove('input-error');
      tf.removeAttribute('aria-invalid');
      const e = document.getElementById('m-title-error');
      if (e) e.remove();
      const desc = (tf.getAttribute('aria-describedby') || '')
        .replace(/\s*m-title-error\s*/g, ' ').trim();
      if (desc) tf.setAttribute('aria-describedby', desc);
      else tf.removeAttribute('aria-describedby');
    };
    tf.addEventListener('input', clearErr, { once: true });
    setTimeout(clearErr, 8000);
    return;
  }
  const doc = await buildPDF();
  const stream = doc.pipe(blobStream());
  doc.end();
  return { doc, stream, title: tf.value.trim() };
}

async function genPDF() {
  const btn = document.getElementById('btn-gen');
  const reset = () => {
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.innerHTML = '<span aria-hidden="true">⬇</span> Générer le PDF/UA';
  };
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  btn.textContent = 'Génération en cours…';
  try {
    const result = await _requireTitleAndBuild('générer le PDF');
    if (!result) { reset(); return; }
    const { stream, title } = result;
    stream.on('finish', () => {
      const a = document.createElement('a');
      a.href = stream.toBlobURL('application/pdf');
      a.download = (title || 'document') + '.pdf';
      a.click();
      reset();
      announce('PDF téléchargé avec succès.');
    });
    stream.on('error', err => { reset(); announce('Erreur lors de la génération : ' + err.message); });
  } catch (err) {
    reset();
    announce('Erreur : ' + err.message);
  }
}

async function prevPDF() {
  announce('Génération de la prévisualisation…');
  try {
    const result = await _requireTitleAndBuild('prévisualiser le PDF');
    if (!result) return;
    result.stream.on('finish', () => {
      document.getElementById('pif').src = result.stream.toBlobURL('application/pdf');
      openModal('prev-modal');
    });
    result.stream.on('error', err => announce('Erreur : ' + err.message));
  } catch (err) {
    announce('Erreur : ' + err.message);
  }
}
