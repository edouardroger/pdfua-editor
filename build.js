#!/usr/bin/env node
// build.js — Concatène et minifie les modules JS + CSS en un seul bundle
// Usage : node build.js          → bundle + minification JS + CSS
//         node build.js --no-min → bundle seul (debug)
// Produit : editor.js, editor.min.js, style.min.css

const fs = require('fs');
const path = require('path');
const { PurgeCSS } = require('purgecss');

const MODULES = [
  'blob-stream.js',
  'constants.js',
  'fontLoader.js',
  'state.js',
  'blocks.js',
  'editor-ui.js',
  'pdf-renderers.js',
  'pdf-forms.js',
  'pdf-builder.js',
  'export-code.js',
  'init.js',
];

// PDFKit : lu depuis node_modules après npm install pdfkit
const PDFKIT_PATH = path.join(__dirname, 'node_modules', 'pdfkit', 'js', 'pdfkit.standalone.js');

const noMin = process.argv.includes('--no-min');
const ts = new Date().toISOString().slice(0, 19);
const DIST_DIR = path.join(__dirname, 'dist');
const CSS_FILE = path.join(__dirname, 'src', 'css', 'style.css');
fs.mkdirSync(DIST_DIR, { recursive: true });

// ── Main (async) ──────────────────────────────────────────────────────────────
(async () => {

  // ── 0. PDFKit depuis node_modules ────────────────────────────────────────
  console.log('── PDFKit ──────────────────────────────────────');
  if (!fs.existsSync(PDFKIT_PATH)) {
    console.error('✗ pdfkit introuvable — lancez : npm install pdfkit');
    process.exit(1);
  }
  const pdfkitSrc = fs.readFileSync(PDFKIT_PATH, 'utf8');
  console.log(`  ✓ pdfkit.standalone.js         (${(Buffer.byteLength(pdfkitSrc) / 1024).toFixed(0)} Ko)`);

  // ── 1. Modules locaux ────────────────────────────────────────────────────
  console.log('\n── Modules ─────────────────────────────────────');
  const moduleParts = [];
  for (const mod of MODULES) {
    const filePath = path.join(__dirname, 'src', 'js', mod);
    if (!fs.existsSync(filePath)) {
      console.error(`✗ Fichier manquant : ${mod} sous ${filePath}`); process.exit(1);
    }
    const src = fs.readFileSync(filePath, 'utf8');
    moduleParts.push(`/* ═══ ${mod} ═══ */\n${src.replace(/^\/\/[^\n]*\n/, '')}`);
    console.log(`  ✓ ${mod.padEnd(22)} ${src.split('\n').length} lignes`);
  }

  const banner = `// editor.js — ${ts} — NE PAS ÉDITER\n`;
  const bundle = [banner, `/* ═══ pdfkit.standalone.js ═══ */\n${pdfkitSrc}`, ...moduleParts].join('\n\n');

  fs.writeFileSync(path.join(DIST_DIR, 'editor.js'), bundle, 'utf8');
  console.log(`\n→ editor.js     : ${(bundle.match(/\n/g)?.length ?? 0) + 1} lignes (${(Buffer.byteLength(bundle) / 1024).toFixed(0)} Ko)`);

  // ── 2. Minification JS via Terser ─────────────────────────────────────────
  let terser;
  try { terser = require('terser'); } catch {
    console.error('\n✗ Terser introuvable — lancez d\'abord : npm install'); process.exit(1);
  }

  console.log('\nMinification JS…');

  let result;

  try {
    result = await terser.minify(bundle, {
      ecma: 2020,
      compress: {
        drop_console: false,
        passes: 2
      },
      mangle: true,
      format: {
        comments: /^!/
      }
    });
  } catch (err) {
    console.error('✗ Terser :', err);
    process.exit(1);
  }

  const minified = `/*! editor.min.js — ${ts} */\n` + result.code;
  fs.writeFileSync(path.join(DIST_DIR, 'editor.min.js'), minified, 'utf8');

  const origKo = (Buffer.byteLength(bundle) / 1024).toFixed(0);
  const minKo = (Buffer.byteLength(minified) / 1024).toFixed(0);
  const ratio = (
    100 -
    (Buffer.byteLength(minified) / Buffer.byteLength(bundle)) * 100
  ).toFixed(0);
  console.log(`→ editor.min.js : ${minKo} Ko (−${ratio} % vs ${origKo} Ko)`);

  await minifyCSS();

})();

async function cleanCSS(cssSource) {
  const purgeCSSResult = await new PurgeCSS().purge({
    content: [
      path.join(__dirname, 'index.html'),
      path.join(__dirname, 'src', 'js', 'blocks.js'),
      path.join(__dirname, 'src', 'js', 'editor-ui.js'),
      path.join(__dirname, 'src', 'js', 'state.js'),
      path.join(__dirname, 'src', 'js', 'constants.js'),
      path.join(__dirname, 'src', 'js', 'pdf-builder.js'),
      path.join(__dirname, 'src', 'js', 'export-code.js')
    ],
    css: [{ raw: cssSource }],
    safelist: {
      standard: [
        'open', 'modal', 'visible', 'mobile-open', 'active', 'bsrc',
        'canvas-page', 'sel', 'moving', 'drop-target',
        'grid-check-row',
        'sheet-open',
        'input-error', 'muted', 'page-orient-btn', 'page-delete-btn', 'field-error', 'field-error-msg'
      ],
      greedy: [
        /^u-/, /^fb-/, /^chart-/,
        /:focus-visible$/, /:focus-within$/,
        /^grid-check-row/,
        /input\[type="checkbox"\]/,
        /fieldset/, /legend/
      ]
    },
    rejected: true
  });
  if (purgeCSSResult[0].rejected?.length) {
    console.log('\n--- Sélecteurs supprimés par PurgeCSS ---');
    console.log(purgeCSSResult[0].rejected);
    console.log('----------------------------------------\n');
  }

  return purgeCSSResult[0].css;
}

// ── 3. Minification CSS via clean-css + PurgeCSS ──────────────────────────────
async function minifyCSS() {
  console.log('\n── CSS ─────────────────────────────────────────');
  if (!fs.existsSync(CSS_FILE)) { console.log('  (style.css introuvable, ignoré)'); copyFavicon(); printSummary(); return; }
  if (noMin) { console.log('  (ignoré via --no-min)'); copyFavicon(); printSummary(); return; }

  let CleanCSS;
  try { CleanCSS = require('clean-css'); } catch {
    console.error('✗ clean-css introuvable — lancez d\'abord : npm install'); process.exit(1);
  }

  // 1. Lire le CSS source
  let cssSource = fs.readFileSync(CSS_FILE, 'utf8');

  // 2. PURGE : Appel de la fonction de nettoyage
  console.log('PurgeCSS en cours…');
  cssSource = await cleanCSS(cssSource);

  // 3. MINIFICATION : clean-css sur le résultat purgé
  const res = new CleanCSS({ level: 2 }).minify(cssSource);
  if (res.errors.length) { console.error('✗ clean-css :', res.errors); process.exit(1); }

  const minCSS = `/*! style.min.css — ${ts} */\n` + res.styles;
  fs.writeFileSync(path.join(DIST_DIR, 'style.min.css'), minCSS, 'utf8');

  const origKo = (Buffer.byteLength(cssSource) / 1024).toFixed(0);
  const minKo = (Buffer.byteLength(minCSS) / 1024).toFixed(0);
  console.log(
    `  ✓ style.css : ${origKo} Ko → ${minKo} Ko`
  );

  copyFavicon();
  printSummary();
}

// ── 4. Copie du répertoire favicon ────────────────────────────────────────────
function copyFavicon() {
  console.log('\n── Favicon ─────────────────────────────────────');
  const src = path.join(__dirname, 'src', 'favicon');
  const dest = path.join(DIST_DIR, 'favicon');
  if (!fs.existsSync(src)) { console.log('  (src/favicon introuvable, ignoré)'); return; }
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const file of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
    count++;
  }
  console.log(`  ✓ src/favicon → dist/favicon   (${count} fichier${count > 1 ? 's' : ''})`);
}

function printSummary() {
  console.log('\n── En production, mettre à jour index.html ────');
  if (!noMin) {
    console.log('  <link rel="stylesheet" href="dist/style.min.css">');
    console.log('  <script defer src="dist/editor.min.js"></script>');
  } else {
    console.log('  <link rel="stylesheet" href="dist/style.css">');
    console.log('  <script defer src="dist/editor.js"></script>');
  }
}
