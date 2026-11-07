'use strict';
/**
 * sunscrap — audit kontras WCAG (per-tema)
 * Baca token dari styles.css, gabungkan :root (global) + :root.dark (override),
 * resolve var(), lalu hitung rasio kontras pasangan teks/latar.
 * Jalankan: node scripts/audit-contrast.js
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'frontend', 'styles.css'), 'utf8');

function lum(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function decls(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function resolve(map) {
  for (let i = 0; i < 6; i++) {
    let changed = false;
    for (const k of Object.keys(map)) {
      const m = String(map[k]).match(/^var\(--([a-z0-9-]+)\)$/i);
      if (m && map[m[1]]) { map[k] = map[m[1]]; changed = true; }
    }
    if (!changed) break;
  }
  return map;
}

const parts = css.split(':root.dark {');
const light = resolve(decls(parts[0]));
const darkRaw = decls(parts[1] ? parts[1].split(/\n\}\s*\n/)[0] : '');
const dark = resolve(Object.assign({}, light, darkRaw));

const pairs = [
  ['ink', 'surface'], ['ink', 'surface-2'], ['ink-2', 'surface'], ['ink-2', 'surface-2'],
  ['ink-3', 'surface'], ['ink-3', 'surface-2'], ['accent', 'surface'],
  ['accent-on', 'accent-strong'], ['ok', 'surface'], ['err', 'surface'], ['warn', 'surface'],
  ['on-viz-light', 'viz-ok'], ['on-viz-light', 'viz-err'],
  ['on-viz-dark', 'viz-warn'], ['on-viz-dark', 'viz-idle'], ['amati-strong', 'surface'],
];

let bad = 0;
for (const [theme, tok] of [['light', light], ['dark', dark]]) {
  const fails = [];
  for (const [f, b] of pairs) {
    if (!/^#[0-9a-f]{3,8}$/i.test(tok[f] || '') || !/^#[0-9a-f]{3,8}$/i.test(tok[b] || '')) { fails.push(`${f}/${b} non-hex (${tok[f]}|${tok[b]})`); continue; }
    const r = ratio(tok[f], tok[b]);
    if (r < 4.5) fails.push(`${f} pada ${b} = ${r.toFixed(2)}:1`);
  }
  console.log(`  ${theme}: ${fails.length ? '\n    ' + fails.join('\n    ') : 'semua >= 4.5:1'}`);
  if (fails.length) bad++;
}
process.exit(bad ? 1 : 0);