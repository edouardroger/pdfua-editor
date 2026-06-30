/* ═══════════════════════════════════════════════════════════════════════
   fontLoader.js — Chargement dynamique des polices
   ═══════════════════════════════════════════════════════════════════════ */

window.FONT_LIST = [
  {
    id: 'marianne', label: 'Marianne', cssFamily: "'Marianne', sans-serif",
    urls: {
      regular: 'https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.14.4/dist/fonts/Marianne-Regular.woff2',
      bold: 'https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.14.4/dist/fonts/Marianne-Bold.woff2',
      italic: 'https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.14.4/dist/fonts/Marianne-Regular_Italic.woff2',
      bolditalic: 'https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.14.4/dist/fonts/Marianne-Bold_Italic.woff2'
    }
  },
  {
    id: 'open-sans', label: 'Open Sans', cssFamily: "'Open Sans', sans-serif",
    urls: {
      regular: 'https://cdn.jsdelivr.net/fontsource/fonts/open-sans@latest/latin-400-normal.woff',
      bold: 'https://cdn.jsdelivr.net/fontsource/fonts/open-sans@latest/latin-700-normal.woff',
      italic: 'https://cdn.jsdelivr.net/fontsource/fonts/open-sans@latest/latin-400-italic.woff',
      bolditalic: 'https://cdn.jsdelivr.net/fontsource/fonts/open-sans@latest/latin-700-italic.woff',
    }
  },
  {
    id: 'roboto', label: 'Roboto', cssFamily: "'Roboto', sans-serif",
    urls: {
      regular: 'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/latin-400-normal.woff',
      bold: 'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/latin-700-normal.woff',
      italic: 'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/latin-400-italic.woff',
      bolditalic: 'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/latin-700-italic.woff',
    }
  },
  {
    id: 'lato', label: 'Lato', cssFamily: "'Lato', sans-serif",
    urls: {
      regular: 'https://cdn.jsdelivr.net/fontsource/fonts/lato@latest/latin-400-normal.woff',
      bold: 'https://cdn.jsdelivr.net/fontsource/fonts/lato@latest/latin-700-normal.woff',
      italic: 'https://cdn.jsdelivr.net/fontsource/fonts/lato@latest/latin-400-italic.woff',
      bolditalic: 'https://cdn.jsdelivr.net/fontsource/fonts/lato@latest/latin-700-italic.woff',
    }
  },
  {
    id: 'montserrat', label: 'Montserrat', cssFamily: "'Montserrat', sans-serif",
    urls: {
      regular: 'https://cdn.jsdelivr.net/fontsource/fonts/montserrat@latest/latin-400-normal.woff',
      bold: 'https://cdn.jsdelivr.net/fontsource/fonts/montserrat@latest/latin-700-normal.woff',
      italic: 'https://cdn.jsdelivr.net/fontsource/fonts/montserrat@latest/latin-400-italic.woff',
      bolditalic: 'https://cdn.jsdelivr.net/fontsource/fonts/montserrat@latest/latin-700-italic.woff',
    }
  },
  {
    id: 'source-sans-3', label: 'Source Sans 3', cssFamily: "'Source Sans 3', sans-serif",
    urls: {
      regular: 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-3@latest/latin-400-normal.woff',
      bold: 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-3@latest/latin-700-normal.woff',
      italic: 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-3@latest/latin-400-italic.woff',
      bolditalic: 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-3@latest/latin-700-italic.woff',
    }
  },
  {
    id: 'noto-sans', label: 'Noto Sans', cssFamily: "'Noto Sans', sans-serif",
    urls: {
      regular: 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans@latest/latin-400-normal.woff',
      bold: 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans@latest/latin-700-normal.woff',
      italic: 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans@latest/latin-400-italic.woff',
      bolditalic: 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans@latest/latin-700-italic.woff',
    }
  }
].sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }));

const _fontCache = new Map();

const _font = {
  async fetch(url) {
    if (_fontCache.has(url)) return _fontCache.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Chargement police échoué : ${url} (${res.status})`);
    const buf = await res.arrayBuffer();
    _fontCache.set(url, buf);
    return buf;
  },

  async load(def) {
    const [regular, bold, italic, bolditalic] = await Promise.all([
      this.fetch(def.urls.regular),
      this.fetch(def.urls.bold),
      this.fetch(def.urls.italic),
      this.fetch(def.urls.bolditalic)
    ]);

    const format = def.urls.regular.includes('.woff2') ? 'woff2' : 'woff';
    return { regular, bold, italic, bolditalic, format };
  },

  injectStyles(id, label, buffers, format) {
    if (document.getElementById(`ff-${id}`)) return;
    const mime = `font/${format}`;
    const style = document.createElement('style');
    style.id = `ff-${id}`;
    style.textContent = `
      @font-face { font-family: '${label}'; font-weight: 400; font-style: normal;  src: url('data:${mime};base64,${_bufToBase64(buffers.regular)}')    format('${format}'); }
      @font-face { font-family: '${label}'; font-weight: 700; font-style: normal;  src: url('data:${mime};base64,${_bufToBase64(buffers.bold)}')       format('${format}'); }
      @font-face { font-family: '${label}'; font-weight: 400; font-style: italic;  src: url('data:${mime};base64,${_bufToBase64(buffers.italic)}')     format('${format}'); }
      @font-face { font-family: '${label}'; font-weight: 700; font-style: italic;  src: url('data:${mime};base64,${_bufToBase64(buffers.bolditalic)}') format('${format}'); }
    `;
    document.head.appendChild(style);
  }
};

window.loadFont = async function (id) {
  const def = window.FONT_LIST.find(f => f.id === id);
  if (!def) throw new Error('Police inconnue : ' + id);

  try {
    const { format, ...rawBuffers } = await _font.load(def);

    _font.injectStyles(id, def.label, rawBuffers, format);

    window.FONTS = { id: def.id, label: def.label, cssFamily: def.cssFamily, ...rawBuffers };
    if (typeof window.refreshBlockFonts === 'function') window.refreshBlockFonts();

    const sel = document.getElementById('m-font');
    if (sel && sel.value !== id) sel.value = id;

    return window.FONTS;
  } catch (err) {
    if (typeof announce === 'function') announce('⚠ Impossible de charger la police « ' + def.label + ' »');
    throw err;
  }
};

(async () => {
  const sel = document.getElementById('m-font');
  if (sel) {
    window.FONT_LIST.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id; opt.textContent = f.label;
      sel.appendChild(opt);
    });
  }
  try {
    await window.loadFont('marianne');
  } catch (err) {
    console.error('[fontLoader] Erreur initiale :', err);
  }
})();
