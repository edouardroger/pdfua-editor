// pdf-forms.js — AcroForm DSFR : AP streams, champs interactifs (texte, select, checkbox, radio)

  /* ════════════════════════════════════════════════════════════════════
     RENDU FORMULAIRE PDF/UA + DSFR
     Chaque champ combine :
       1. Label Lbl en texte PDF (structure logique)
       2. AP stream (Form XObject) imposant l'apparence DSFR
       3. Widget AcroForm interactif avec AP:{N:ref}
       4. Élément Form dans l'arbre de structure (PDF/UA §7.18)
     Radio : structure parent/Kids (ISO 32000-2 §12.7.4.2)
  ════════════════════════════════════════════════════════════════════ */

  function _makeAPStream(doc, w, h, ops, resources) {
    const res = resources || {};
    const ref = doc.ref({ Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: res });
    ref.write(ops); ref.end();
    return ref;
  }

  /* ── Tokens en RGB [0-1] ─────────────────────────────
     --grey-950-100           #eeeeee  → fond input/select (background-contrast-grey)
     --grey-200-850           #3a3a3a  → texte + bordure bas (border-plain-grey)
     --blue-france-sun-113-625 #000091 → bordure active + fond checkbox/radio cochés
     Coche checkbox            #f5f5fe  → blanc cassé (svg path fill)
  ─────────────────────────────────────────────────────────────────── */
  const _D = {
    inputBg: '0.933 0.933 0.933', /* #eeeeee  background-contrast-grey */
    inputBgRO: '0.871 0.871 0.871', /* #dedede  fond lecture seule (assombri) */
    border: '0.227 0.227 0.227', /* #3a3a3a  border-plain-grey */
    blue: '0 0 0.569',         /* #000091  blue-france-sun-113-625 */
    white: '1 1 1',             /* #ffffff  fond checkbox décochée */
    checkMark: '0.961 0.961 0.996', /* #f5f5fe  couleur coche */
  };

  /* ── Input / Textarea / Select ─────────────────────────────────────
     Fond gris #eeeeee, coins arrondis haut (4pt), 
     bordure BAS uniquement 2px #3a3a3a (box-shadow inset 0 -2px)
     En PDF : on trace seulement le trait bas en 2pt.
  ─────────────────────────────────────────────────────────────────── */
  function _apText(doc, w, h, readonly) {
    const bg = readonly ? _D.inputBgRO : _D.inputBg;
    const r = 4;
    return _makeAPStream(doc, w, h, [
      'q',
      bg + ' rg',
      r + ' 0 m',
      (w - r) + ' 0 l',
      (w - r) + ' 0 ' + w + ' 0 ' + w + ' ' + r + ' c',
      w + ' ' + (h - r) + ' l',
      w + ' ' + (h - r) + ' ' + w + ' ' + h + ' ' + (w - r) + ' ' + h + ' c',
      r + ' ' + h + ' l',
      r + ' ' + h + ' 0 ' + h + ' 0 ' + (h - r) + ' c',
      '0 ' + r + ' l',
      '0 ' + r + ' 0 0 ' + r + ' 0 c f',
      _D.border + ' RG 2 w 0 0 m ' + w + ' 0 l S',
      'Q',
    ].join(' '));
  }

  /* AP stream select : fond gris + zone chevron distincte + chevron (#161616)
     Chevron SVG : M12 13.1l5-4.9 1.4 1.4L12 15.9l-6.4-6.4L7 8.1z
     Icône 16×16pt, positionnée à droite dans une zone séparée (w-28 à w). */
  function _apSelect(doc, w, h, readonly) {
    const bg = readonly ? _D.inputBgRO : _D.inputBg;
    const r = 4;
    const zoneW = 28; /* largeur de la zone chevron */
    /* Zone principale (fond gris) avec coins arrondis haut */
    const mainPath = [
      r + ' 0 m',
      (w - r) + ' 0 l',
      (w - r) + ' 0 ' + w + ' 0 ' + w + ' ' + r + ' c',
      w + ' ' + (h - r) + ' l',
      w + ' ' + (h - r) + ' ' + w + ' ' + h + ' ' + (w - r) + ' ' + h + ' c',
      r + ' ' + h + ' l',
      r + ' ' + h + ' 0 ' + h + ' 0 ' + (h - r) + ' c',
      '0 ' + r + ' l',
      '0 ' + r + ' 0 0 ' + r + ' 0 c f',
    ].join(' ');
    /* Zone chevron : rectangle droit (fond légèrement plus foncé) */
    const chevX = w - zoneW;
    const chevZone = [
      chevX + ' 0 m',
      w + ' 0 l',
      w + ' ' + h + ' l',
      chevX + ' ' + h + ' l f',
    ].join(' ');
    /* Séparateur vertical entre texte et chevron */
    const sep = chevX + ' 2 m ' + chevX + ' ' + (h - 2) + ' l S';
    /* Chevron #161616 — centré dans la zone chevron
       Points SVG absolus (viewBox 24×24) : (12,13.1),(17,8.2),(18.4,9.6),(12,15.9),(5.6,9.5),(7,8.1)
       Conversion : sc=14/24, origine icône centrée dans zone chevron */
    const sc = 14 / 24;
    const ix = chevX + (zoneW - 14) / 2;
    const iy = (h - 14) / 2;
    const svgPts = [[12, 13.1], [17, 8.2], [18.4, 9.6], [12, 15.9], [5.6, 9.5], [7, 8.1]];
    const pts = svgPts.map(([x, y]) => [
      (ix + x * sc).toFixed(1),
      (iy + 14 - y * sc).toFixed(1),
    ]);
    const chevPath = pts[0][0] + ' ' + pts[0][1] + ' m ' +
      pts.slice(1).map(p => p[0] + ' ' + p[1] + ' l').join(' ') + ' h f';
    return _makeAPStream(doc, w, h, [
      'q',
      /* Fond principal */
      bg + ' rg', mainPath,
      /* Zone chevron légèrement plus sombre */
      '0.863 0.863 0.863 rg', chevZone,
      /* Séparateur */
      _D.border + ' RG 0.5 w', sep,
      /* Bordure basse 2pt */
      _D.border + ' RG 2 w 0 0 m ' + w + ' 0 l S',
      /* Chevron #161616 */
      '0.086 0.086 0.086 rg 0 w',
      chevPath,
      'Q',
    ].join(' '));
  }

  /* ── Checkbox ──────────────────────────────────────────────────────
     24×24pt, border-radius 4pt, fond blanc décochée / #000091 cochée.
     Coche : 2 segments en STROKE (pas fill) — trait #f5f5fe 2.5pt, linecap round.
     Coordonnées dans repère PDF (Y=0 bas, BBox [0,0,24,24]) :
       (3.64, 12.36) → (10, 6) → (20.6, 16.58)
     Correspond à SVG : (3.64,11.64)→(10,18)→(20.6,7.42) après inversion Y.
  ─────────────────────────────────────────────────────────────────── */
  function _apCheckbox(doc, sz) {
    const r = Math.round(sz * 0.167); /* border-radius 4pt */
    const s = sz / 24;               /* facteur d'échelle depuis base 24pt */

    const roundedFill = (fill, stroke) => [
      fill + ' rg',
      r + ' 0 m',
      (sz - r) + ' 0 l ' + (sz - r) + ' 0 ' + sz + ' 0 ' + sz + ' ' + r + ' c',
      sz + ' ' + (sz - r) + ' l ' + sz + ' ' + (sz - r) + ' ' + sz + ' ' + sz + ' ' + (sz - r) + ' ' + sz + ' c',
      r + ' ' + sz + ' l ' + r + ' ' + sz + ' 0 ' + sz + ' 0 ' + (sz - r) + ' c',
      '0 ' + r + ' l 0 ' + r + ' 0 0 ' + r + ' 0 c f',
      stroke + ' RG 1 w',
      r + ' 0 m',
      (sz - r) + ' 0 l ' + (sz - r) + ' 0 ' + sz + ' 0 ' + sz + ' ' + r + ' c',
      sz + ' ' + (sz - r) + ' l ' + sz + ' ' + (sz - r) + ' ' + sz + ' ' + sz + ' ' + (sz - r) + ' ' + sz + ' c',
      r + ' ' + sz + ' l ' + r + ' ' + sz + ' 0 ' + sz + ' 0 ' + (sz - r) + ' c',
      '0 ' + r + ' l 0 ' + r + ' 0 0 ' + r + ' 0 c S',
    ].join(' ');

    /* Coche en deux segments stroke (plus fiable que fill sur polygone croisé) */
    const p = (x, y) => (x * s).toFixed(2) + ' ' + (sz - y * s).toFixed(2);
    const checkStroke = [
      _D.checkMark + ' RG',
      (2.5 * s).toFixed(1) + ' w 1 J 1 j', /* round linecap + linejoin */
      p(3.64, 11.64) + ' m',
      p(10, 18) + ' l',      /* pointe basse de la coche */
      p(20.6, 7.42) + ' l',  /* extrémité haute droite */
      'S',
    ].join(' ');

    const on = _makeAPStream(doc, sz, sz, ['q', roundedFill(_D.blue, _D.blue), checkStroke, 'Q'].join(' '));
    const off = _makeAPStream(doc, sz, sz, ['q', roundedFill(_D.white, _D.border), 'Q'].join(' '));

    return { on, off };
  }

  /* ── Radio button ──────────────────────────────────────────────────
     Cercle 24×24pt, fond blanc, bordure 1px #3a3a3a
     Sélectionné : cercle intérieur #000091 rayon ≈ 6pt (sur base 24)
  ─────────────────────────────────────────────────────────────────── */
  function _apRadio(doc, sz) {
    const r = sz / 2;       /* rayon externe */
    const ri = r - 1;       /* rayon interne (bordure 1pt) */
    const rd = r * 0.417;   /* rayon du point intérieur ≈ 10/24 */
    const k = 0.5523;

    /* Tracé cercle en courbes de Bézier */
    const circle = (cx, cy, cr) => {
      const kk = cr * k;
      return [
        (cx + cr) + ' ' + cy + ' m',
        (cx + cr) + ' ' + (cy + kk) + ' ' + (cx + kk) + ' ' + (cy + cr) + ' ' + cx + ' ' + (cy + cr) + ' c',
        (cx - kk) + ' ' + (cy + cr) + ' ' + (cx - cr) + ' ' + (cy + kk) + ' ' + (cx - cr) + ' ' + cy + ' c',
        (cx - cr) + ' ' + (cy - kk) + ' ' + (cx - kk) + ' ' + (cy - cr) + ' ' + cx + ' ' + (cy - cr) + ' c',
        (cx + kk) + ' ' + (cy - cr) + ' ' + (cx + cr) + ' ' + (cy - kk) + ' ' + (cx + cr) + ' ' + cy + ' c',
      ].join(' ');
    };

    const on = _makeAPStream(doc, sz, sz, [
      'q',
      /* Fond blanc, cercle plein */
      _D.white + ' rg', circle(r, r, ri), 'f',
      /* Bordure bleue */
      _D.blue + ' RG 1 w', circle(r, r, ri), 'S',
      /* Point central bleu */
      _D.blue + ' rg', circle(r, r, rd), 'f',
      'Q',
    ].join(' '));

    const off = _makeAPStream(doc, sz, sz, [
      'q',
      _D.white + ' rg', circle(r, r, ri), 'f',
      _D.border + ' RG 1 w', circle(r, r, ri), 'S',
      'Q',
    ].join(' '));

    return { on, off };
  }

  function _renderFormField(doc, ds, b, kind) {
    const { ox, oy, cw, ch } = ctCoords(b);
    const lbl = (b.formLabel || '').trim();
    const req = !!b.formRequired;
    const ro = !!b.formReadonly;
    const defVal = b.formDefaultValue || '';
    const fName = (lbl || kind).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 50) + '-' + b.id;
    const tip = lbl + (req ? ' (obligatoire)' : '');
    const tu = new String(tip);
    const lblFs = 10;
    const hasTopLabel = kind !== 'checkbox' && lbl;
    const lblH = hasTopLabel ? lblFs + 6 : 0;
    const wY = oy + lblH;
    const wH = ch - lblH;
    const wrapS = doc.struct('P');
    ds.add(wrapS);

    if (hasTopLabel) {
      const lblS = doc.struct('Lbl'); wrapS.add(lblS);
      lblS.add(() => { doc.fontSize(lblFs).font('Bold').fillColor('#3a3a3a').text(lbl + (req ? ' *' : ''), ox, oy, { width: cw, lineBreak: false, ellipsis: true }); });
      lblS.end();
    }

    /* ── PDF/UA : structure Form avec OBJR correct ─────────────────────────
       La seule façon dont PDFKit génère un OBJR valide dans un StructElem est via
       doc.annotate() appelé avec { structParent: fS }. PDFKit crée alors un
       PDFAnnotationReference dans fS._children, que _flushChild() sérialise en
       OBJR inline dans K — avec /StructParent sur l'annotation.

       formText/formCheckbox/formCombo/formAnnotation appellent annotate() en interne
       mais sans structParent. Solution propre et sans risque : monkey-patch temporaire
       d'annotate() le temps d'un appel, pour y injecter structParent. Toute la
       logique _fieldDict / _resolveFont / _resolveFlags reste intacte.

       Testé : cf. test-pdfkit.js — monkey-patch produit exactement le même Widget
       que formText normal + /StructParent + OBJR inline dans Form.K.
    ────────────────────────────────────────────────────────────────────── */
    function _makeFormStruct(doc, wrapS, tip, renderFn) {
      const fS = doc.struct('Form', { alt: tip });
      wrapS.add(fS);

      fS.add(() => {
        /* Patch temporaire d'annotate pour injecter structParent: fS.
           Restauré immédiatement après le premier appel → aucun effet de bord. */
        const _orig = doc.annotate.bind(doc);
        doc.annotate = function (x, y, w, h, opts) {
          doc.annotate = _orig;
          return _orig(x, y, w, h, Object.assign(opts, { structParent: fS }));
        };
        renderFn();
        /* Garde-fou : restaurer si renderFn n'a pas appelé annotate */
        if (doc.annotate !== _orig) doc.annotate = _orig;
      });

      fS.end();
      return fS;
    }

    switch (kind) {
      case 'text': {
        const tH = 36;
        const ap = _apText(doc, cw, tH, ro);
        _makeFormStruct(doc, wrapS, tip, () => {
          doc.formText(fName, ox, wY, cw, tH, { value: defVal, defaultValue: defVal, align: 'left', fontSize: 10, readOnly: ro, required: req, TU: tu, AP: { N: ap } });
        });
        break;
      }
      case 'textarea': {
        const ap = _apText(doc, cw, wH, ro);
        _makeFormStruct(doc, wrapS, tip, () => {
          doc.formText(fName, ox, wY, cw, wH, { value: defVal, defaultValue: defVal, align: 'left', fontSize: 10, multiline: true, readOnly: ro, required: req, TU: tu, AP: { N: ap } });
        });
        break;
      }
      case 'checkbox': {
        const SZ = 24;
        const bY = oy + (ch - SZ) / 2;
        const isChecked = !!b.formChecked;
        const { on, off } = _apCheckbox(doc, SZ);
        _makeFormStruct(doc, wrapS, tip, () => {
          doc.formCheckbox(fName, ox, bY, SZ, SZ, { V: isChecked ? 'Yes' : 'Off', AS: isChecked ? 'Yes' : 'Off', readOnly: ro, required: req, TU: tu, AP: { N: { Yes: on, Off: off } } });
        });
        if (lbl) {
          const spS = doc.struct('Span'); wrapS.add(spS);
          spS.add(() => { doc.fontSize(10).font('Regular').fillColor('#3a3a3a').text(lbl + (req ? ' *' : ''), ox + SZ + 8, oy + (ch - 10) / 2, { width: cw - SZ - 10, lineBreak: false, ellipsis: true }); });
          spS.end();
        }
        break;
      }
      case 'radio': {
        const opts = (b.formOptions || '').split('\n').filter(o => o.trim());
        const SZ = 24;
        const optH = Math.max(28, wH / Math.max(opts.length, 1));

        /* Protection des clés PDFKit (évite les bugs avec espaces) */
        const exportValues = opts.map((_, i) => 'Choice' + i);
        const parentRef = doc.formField(fName, {
          FT: 'Btn', Ff: 32768, TU: tu,
          Opt: opts.map(o => new String(o.trim())),
          ...(req ? { required: true } : {})
        });

        opts.forEach((opt, i) => {
          const rY = wY + i * optH + (optH - SZ) / 2;
          const optTxt = opt.trim();
          const expVal = exportValues[i];
          const { on, off } = _apRadio(doc, SZ);
          _makeFormStruct(doc, wrapS, tip + ' — ' + optTxt, () => {
            doc.formAnnotation(fName, 'radioButton', ox, rY, SZ, SZ, {
              Parent: parentRef, AS: 'Off', AP: { N: { [expVal]: on, Off: off } }, TU: new String(tip + ' — ' + optTxt)
            });
          });

          const spS = doc.struct('Span'); wrapS.add(spS);
          const lY = wY + i * optH;
          spS.add(() => { doc.fontSize(10).font('Regular').fillColor('#3a3a3a').text(optTxt, ox + SZ + 8, lY + (optH - 10) / 2, { width: cw - SZ - 10, lineBreak: false, ellipsis: true }); });
          spS.end();
        });
        break;
      }
      case 'select': {
        const opts = (b.formOptions || '').split('\n').filter(o => o.trim()).map(o => o.trim());
        const displayTxt = defVal && opts.includes(defVal) ? defVal : (opts[0] || '');

        const selH = 36;
        const chevW = 28;
        const textW = cw - chevW;
        const r = 4;
        const bg = ro ? _D.inputBgRO : _D.inputBg;
        const chevBg = '0.863 0.863 0.863'; /* #dcdcdc */

        /* AP stream complet : fond + zone chevron + séparateur + bordure + chevron ▼ + texte
           BBox [0,0,cw,selH], repère PDF local : Y=0 en bas, Y=selH en haut.
           Le texte est inclus directement dans l'AP stream (BT/ET) avec la font
           injectée dans les Resources du XObject — ainsi le lecteur n'a pas besoin
           de régénérer l'AP via NeedAppearances, même après sélection. */
        const apN = (() => {
          const ops = ['q'];

          /* Fond principal — coins arrondis haut-gauche et haut-droit uniquement */
          ops.push(bg + ' rg');
          ops.push(
            '0 0 m', cw + ' 0 l',
            cw + ' ' + (selH - r) + ' l',
            cw + ' ' + selH + ' ' + (cw - r) + ' ' + selH + ' ' + (cw - r) + ' ' + selH + ' c',
            r + ' ' + selH + ' l',
            '0 ' + selH + ' 0 ' + selH + ' 0 ' + (selH - r) + ' 0 ' + (selH - r) + ' c',
            '0 0 l f'
          );

          /* Zone chevron #dcdcdc — coin arrondi haut-droit uniquement */
          ops.push(chevBg + ' rg');
          ops.push(
            textW + ' 0 m', cw + ' 0 l',
            cw + ' ' + (selH - r) + ' l',
            cw + ' ' + selH + ' ' + (cw - r) + ' ' + selH + ' ' + (cw - r) + ' ' + selH + ' c',
            textW + ' ' + selH + ' l f'
          );

          /* Séparateur vertical */
          ops.push(_D.border + ' RG 0.5 w');
          ops.push(textW + ' 2 m ' + textW + ' ' + (selH - 2) + ' l S');

          /* Bordure basse 2pt */
          ops.push(_D.border + ' RG 2 w 0 0 m ' + cw + ' 0 l S');

          /* Texte de la valeur — inclus dans l'AP stream via BT/ET
             Baseline centrée verticalement dans le repère AP (Y=0 bas) */
          if (displayTxt) {
            const fontSize = 10;
            const baselineY = (selH - fontSize) / 2 - 1;
            ops.push(_D.border + ' rg'); /* couleur texte */
            ops.push('BT /F1 ' + fontSize + ' Tf 8 ' + baselineY.toFixed(1) + ' Td');
            const encoded = '(' + displayTxt.replace(/[\\()]/g, c => '\\' + c) + ')';
            ops.push(encoded + ' Tj ET');
          }

          /* Chevron ▼ : base en haut (Y grand), pointe en bas (Y petit) */
          const cxAP = textW + chevW / 2;
          const tWAP = 7;
          ops.push('0.086 0.086 0.086 rg 0 w');
          ops.push(
            (cxAP - tWAP / 2).toFixed(1) + ' ' + (selH * 0.62).toFixed(1) + ' m',
            (cxAP + tWAP / 2).toFixed(1) + ' ' + (selH * 0.62).toFixed(1) + ' l',
            cxAP.toFixed(1) + ' ' + (selH * 0.38).toFixed(1) + ' l f'
          );

          ops.push('Q');

          /* Injecter la font dans les Resources du XObject */
          doc.font('Regular');
          const fontRes = displayTxt ? { Font: { F1: doc._font.ref() } } : {};
          return _makeAPStream(doc, cw, selH, ops.join(' '), fontRes);
        })();

        _makeFormStruct(doc, wrapS, tip, () => {
          doc.formCombo(fName, ox, wY, cw, selH, {
            value: displayTxt, defaultValue: displayTxt,
            select: opts, fontSize: 10, readOnly: ro, required: req, TU: tu,
            AP: { N: apN, D: apN, R: apN },
            BS: { W: 0 },
            MK: { BG: ro ? [0.871, 0.871, 0.871] : [0.933, 0.933, 0.933], BC: [] }
          });
          /* Couleur du texteaprès sélection */
          const lastAnnot = doc.page.annotations[doc.page.annotations.length - 1];
          if (lastAnnot?.data) lastAnnot.data.DA = '/Regular 10 Tf 0.227 0.227 0.227 rg';
        });
        break;
      }
    }
    wrapS.end();
  }
