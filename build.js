#!/usr/bin/env node
// build.js — Concatène et minifie les modules JS + CSS en un seul bundle
// Usage : node build.js          → bundle + minification JS + CSS
//         node build.js --no-min → bundle seul (debug)
// Produit : editor.js, editor.min.js, style.min.css

const fs = require('fs');
const path = require('path');

const MODULES = [
  'blob-stream.js',
  'fontLoader.js',
  'constants.js',
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

  fs.writeFileSync(path.join(__dirname, 'dist', 'editor.js'), bundle, 'utf8');
  console.log(`\n→ editor.js     : ${bundle.split('\n').length} lignes (${(Buffer.byteLength(bundle) / 1024).toFixed(0)} Ko)`);

  if (noMin) {
    console.log('  (minification ignorée via --no-min)');
    minifyCSS(); return;
  }

  // ── 2. Minification JS via Terser ─────────────────────────────────────────
  let terser;
  try { terser = require('terser'); } catch {
    console.error('\n✗ Terser introuvable — lancez d\'abord : npm install'); process.exit(1);
  }

  console.log('\nMinification JS…');
  const result = await terser.minify(bundle, {
    ecma: 2020,
    compress: { drop_console: false, passes: 2 },
    mangle: true,
    format: { comments: /^!/ },
  });
  if (result.error) { console.error('✗ Terser :', result.error); process.exit(1); }

  const minified = `/*! editor.min.js — ${ts} */\n` + result.code;
  fs.writeFileSync(path.join(__dirname, 'dist', 'editor.min.js'), minified, 'utf8');

  const origKo = (Buffer.byteLength(bundle) / 1024).toFixed(0);
  const minKo = (Buffer.byteLength(minified) / 1024).toFixed(0);
  const ratio = (100 - minified.length / bundle.length * 100).toFixed(0);
  console.log(`→ editor.min.js : ${minKo} Ko (−${ratio} % vs ${origKo} Ko)`);

  minifyCSS();

})();

// ── 3. Minification CSS via clean-css ─────────────────────────────────────────
function minifyCSS() {
  console.log('\n── CSS ─────────────────────────────────────────');
  const cssFile = path.join(__dirname, 'src', 'css', 'style.css');
  if (!fs.existsSync(cssFile)) { console.log('  (style.css introuvable, ignoré)'); copyFavicon(); printSummary(); return; }
  if (noMin) { console.log('  (ignoré via --no-min)'); copyFavicon(); printSummary(); return; }

  let CleanCSS;
  try { CleanCSS = require('clean-css'); } catch {
    console.error('✗ clean-css introuvable — lancez d\'abord : npm install'); process.exit(1);
  }

  const cssSource = fs.readFileSync(cssFile, 'utf8');
  const res = new CleanCSS({ level: 2 }).minify(cssSource);
  if (res.errors.length) { console.error('✗ clean-css :', res.errors); process.exit(1); }

  const minCSS = `/*! style.min.css — ${ts} */\n` + res.styles;
  fs.writeFileSync(path.join(__dirname, 'dist', 'style.min.css'), minCSS, 'utf8');

  const origKo = (Buffer.byteLength(cssSource) / 1024).toFixed(0);
  const minKo = (Buffer.byteLength(minCSS) / 1024).toFixed(0);
  const ratio = (100 - minCSS.length / cssSource.length * 100).toFixed(0);
  console.log(`  ✓ style.css → style.min.css : ${minKo} Ko (−${ratio} % vs ${origKo} Ko)`);

  copyFavicon();
  printSummary();
}

// ── 4. Copie du répertoire favicon ────────────────────────────────────────────
function copyFavicon() {
  console.log('\n── Favicon ─────────────────────────────────────');
  const src = path.join(__dirname, 'src', 'favicon');
  const dest = path.join(__dirname, 'dist', 'favicon');
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
    console.log('  Supprimer les <script src="pdfkit..."> et <script src="blob-stream.js">');
    console.log('  <link rel="stylesheet" href="dist/style.min.css">');
    console.log('  <script defer src="dist/editor.bundle.min.js"></script>');
  } else {
    console.log('  <link rel="stylesheet" href="dist/style.css">');
    console.log('  <script defer src="dist/editor.bundle.js"></script>');
  }
}
