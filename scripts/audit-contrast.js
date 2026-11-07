'use strict';
/**
 * sunscrap — audit kontras WCAG
 * Baca token warna dari styles.css, hitung rasio kontras pasangan teks/latar.
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
// Gabung token: :root (global) lalu :root.dark menimpa.
const merged = {};
for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)) merged[m[1]] = m[2];

const pairs = [
  ['ink', 'surface'], ['ink', 'surface-2'], ['ink-2', 'surface'], ['ink-2', 'surface-2'],
  ['ink-3', 'surface'], ['ink-3', 'surface-2'], ['accent', 'surface'],
  ['ok', 'surface'], ['err', 'surface'], ['warn', 'surface'],
  ['accent-on', 'accent-strong'], ['on-viz-light', 'viz-ok'], ['on-viz-light', 'viz-err'],
  ['on-viz-dark', 'viz-warn'], ['on-viz-dark', 'viz-idle'], ['amati-strong', 'surface'],
];

const bad = [];
for (const [f, b] of pairs) {
  if (!merged[f] || !merged[b]) { bad.push(`${f}/${b} token hilang`); continue; }
  const r = ratio(merged[f], merged[b]);
  if (r < 4.5) bad.push(`${f} pada ${b} = ${r.toFixed(2)}:1`);
}
if (bad.length) {
  console.log('PELANGGARAN KONTRAS (< 4.5:1):');
  bad.forEach((b) => console.log('  ' + b));
  process.exit(1);
} else {
  console.log('Semua pasangan teks/latar >= 4.5:1 (AA).');
  process.exit(0);
}