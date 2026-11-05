'use strict';
const test = require('node:test');
const assert = require('node:assert');
const f = require('../renderer/format');

test('fmt: null → em dash, angka dikelompokkan id-ID', () => {
  assert.equal(f.fmt(null), '—');
  assert.equal(f.fmt(undefined), '—');
  assert.equal(f.fmt(0), '0');
  assert.equal(f.fmt(1234), '1.234');
});

test('fmtPct: null → em dash, desimal id-ID', () => {
  assert.equal(f.fmtPct(null), '—');
  assert.equal(f.fmtPct(12.34), '12,3%');
  assert.equal(f.fmtPct(12.34, 2), '12,34%');
});

test('idID membulatkan sesuai presisi', () => {
  assert.equal(f.idID(1234.56, 2), '1.234,56');
  assert.equal(f.idID(8.99, 2), '8,99');
});

test('fmtCompact memilih satuan M/jt/rb', () => {
  assert.equal(f.fmtCompact(null), '—');
  assert.equal(f.fmtCompact(1000000000), '1 M');
  assert.equal(f.fmtCompact(2500000), '2,5 jt');
  assert.equal(f.fmtCompact(1500), '1,5 rb');
  assert.equal(f.fmtCompact(42), '42');
});

test('fmtJuta mengembalikan value + unit', () => {
  assert.deepEqual(f.fmtJuta(null), { value: '—', unit: '' });
  assert.deepEqual(f.fmtJuta(8990000), { value: '8,99', unit: ' juta' });
  assert.deepEqual(f.fmtJuta(1200), { value: '1', unit: ' ribu' });
});

test('sum menoleransi non-angka & array kosong', () => {
  assert.equal(f.sum([]), 0);
  assert.equal(f.sum([1, 2, 'x', 4]), 7);
});

test('delta7: tanpa cukup data → null, delta 40 ketika 70→98', () => {
  assert.equal(f.delta7([]), null);
  const series = [10, 10, 10, 10, 10, 10, 10, 14, 14, 14, 14, 14, 14, 14];
  assert.equal(f.delta7(series), 40);
});

test('signedPct & deltaClass membedakan arah', () => {
  assert.equal(f.signedPct(null), '—');
  assert.equal(f.signedPct(10), '▲10,0%');
  assert.equal(f.signedPct(-5), '▼5,0%');
  assert.equal(f.signedPct(0), '0,0%');
  assert.equal(f.deltaClass(10), 'good');
  assert.equal(f.deltaClass(-5), 'bad');
  assert.equal(f.deltaClass(0), 'flat');
  assert.equal(f.deltaClass(null), 'flat');
});

test('esc menetralkan karakter HTML', () => {
  assert.equal(f.esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(f.esc(null), '');
});

test('deltaBadge & emptyState menghasilkan markup aman', () => {
  assert.equal(f.deltaBadge(null), '<span class="muted">—</span>');
  assert.equal(f.deltaBadge(5), '<span class="delta good">▲5</span>');
  assert.ok(f.emptyState('A<b>', 'sub').includes('A&lt;b&gt;'));
});

test('parseWhen: format SQLite dianggap UTC, input buruk → null', () => {
  assert.equal(f.parseWhen('2026-11-05 10:20:30').getTime(), Date.UTC(2026, 10, 5, 10, 20, 30));
  assert.equal(f.parseWhen('garbage'), null);
  assert.equal(f.parseWhen(null), null);
});

test('sparklinePoints: string poligon dua titik', () => {
  assert.equal(f.sparklinePoints([0, 100], 78, 24), '0.0,22.0 78.0,4.0');
  assert.equal(f.sparklinePoints([]), '');
});

test('idOf menormalkan teks menjadi slug', () => {
  assert.equal(f.idOf('Foo Bar!'), 'Foo-Bar-');
});