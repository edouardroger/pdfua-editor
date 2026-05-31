/* ═══════════════════════════════════════════════════════════════════════
   fontLoader.js — Chargement dynamique des polices pour l'éditeur PDF/UA
   API publique :
     window.FONT_LIST — catalogue des polices
     window.FONTS — polices actives { regular, bold, cssFamily, id }
     window.loadFont(id) — charge et active une police
   ═══════════════════════════════════════════════════════════════════════ */

window.FONT_LIST = [
  {
    id: 'marianne',
    label: 'Marianne',
    cssFamily: "'Marianne', sans-serif",
    urls: {
      regular: 'fonts/Marianne-Regular.ttf',
      bold: 'fonts/Marianne-Bold.ttf',
      italic: 'fonts/Marianne-RegularItalic.ttf',
      bolditalic: 'fonts/Marianne-BoldItalic.ttf'
    },
  },
];

const _fontCache = {};

/* ── Utilitaires privés ────────────────────────────────────────────────── */
const _font = {
  toBase64: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),

  async fetch(url) {
    if (_fontCache[url]) return _fontCache[url];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Chargement police échoué : ${url} (${res.status})`);
    const buf = await res.arrayBuffer();
    return _fontCache[url] = buf;
  },

  async loadBuffers(def) {
    const [regular, bold, italic, bolditalic] = await Promise.all([
      this.fetch(def.urls.regular),
      this.fetch(def.urls.bold),
      this.fetch(def.urls.italic),
      this.fetch(def.urls.bolditalic),
    ]);
    return { regular, bold, italic, bolditalic };
  },

  injectStyles(id, label, b64Regular, b64Bold, b64Italic, b64BoldItalic) {
    if (document.getElementById('ff-' + id)) return;

    const style = document.createElement('style');
    style.id = 'ff-' + id;
    style.textContent = `
    @font-face {
      font-family: '${label}';
      font-weight: 400;
      font-style: normal;
      src: url('data:font/truetype;base64,${b64Regular}') format('truetype');
    }
    @font-face {
      font-family: '${label}';
      font-weight: 700;
      font-style: normal;
      src: url('data:font/truetype;base64,${b64Bold}') format('truetype');
    }
    @font-face {
      font-family: '${label}';
      font-weight: 400;
      font-style: italic;
      src: url('data:font/truetype;base64,${b64Italic}') format('truetype');
    }
    @font-face {
      font-family: '${label}';
      font-weight: 700;
      font-style: italic;
      src: url('data:font/truetype;base64,${b64BoldItalic}') format('truetype');
    }
    `;
    document.head.appendChild(style);
  }
};

/* ── API Publique ──────────────────────────────────────────────────────── */
window.loadFont = async function (id) {
  const def = window.FONT_LIST.find(f => f.id === id);
  if (!def) throw new Error('Police inconnue : ' + id);

  const { regular, bold, italic, bolditalic } = await _font.loadBuffers(def);

  _font.injectStyles(
    id,
    def.label,
    _font.toBase64(regular),
    _font.toBase64(bold),
    _font.toBase64(italic),
    _font.toBase64(bolditalic)
  );

  window.FONTS = {
    id: def.id,
    label: def.label,
    cssFamily: def.cssFamily,
    regular,
    bold,
    italic,
    bolditalic
  };

  if (typeof window.refreshBlockFonts === 'function') {
    window.refreshBlockFonts();
  }

  const sel = document.getElementById('m-font');
  if (sel && sel.value !== id) sel.value = id;

  return window.FONTS;
};

/* ── Initialisation au démarrage ────────────────────────────────────────── */
(async () => {
  const sel = document.getElementById('m-font');

  if (sel) {
    sel.innerHTML = '';
    window.FONT_LIST.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label;
      sel.appendChild(opt);
    });
  }

  try {
    await window.loadFont('marianne');
    console.info('[fontLoader] Police chargée :', window.FONTS.label);
  } catch (err) {
    console.error('[fontLoader] Erreur chargement police par défaut :', err);
  }
})();