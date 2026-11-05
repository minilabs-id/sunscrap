'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeCell, calcEr, difference } = require('../main/export');

test('sanitizeCell menetralkan formula injection', () => {
  for (const evil of ['=1+1', '+cmd', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
    const out = sanitizeCell(evil);
    assert.equal(typeof out, 'string');
    assert.equal(out[0], "'", `harus diawali apostrof: ${JSON.stringify(evil)}`);
    assert.equal(out.slice(1), evil);
  }
  assert.equal(sanitizeCell('biasa'), 'biasa');
  assert.equal(sanitizeCell(123), 123);
  assert.equal(sanitizeCell(null), null);
});

test('calcEr: TikTok berbasis views, Instagram berbasis followers', () => {
  assert.equal(calcEr('tiktok', 100, 10, 1000, 5, 100000), 11.5); // (100+10+5)/1000*100
  assert.equal(calcEr('tiktok', 1, 1, 0, 1, 100000), null);        // views 0 → tidak bisa
  assert.equal(calcEr('instagram', 100, 10, 9999, 5, 1000), 11);   // (100+10)/1000*100
  assert.equal(calcEr('instagram', 100, 10, 9999, 5, 0), null);    // followers 0 → tidak bisa
});

test('difference null bila salah satu sisi kosong', () => {
  assert.equal(difference(120, 100), 20);
  assert.equal(difference(100, 100), 0);
  assert.equal(difference(null, 100), null);
  assert.equal(difference(100, undefined), null);
});
