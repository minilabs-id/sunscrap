'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCookiePayload, DEFAULT_PORT } = require('../backend/services/bridge');

test('parseCookiePayload memetakan payload instagram/tiktok ke cookies.set yang benar', () => {
  const [ig] = parseCookiePayload({
    instagram: [{ name: 'sessionid', value: 'IGv', domain: '.instagram.com', path: '/', httpOnly: true }],
    tiktok: [{ name: 'sid_tt', value: 'tkv', domain: '.tiktok.com', path: '/' }],
  });
  assert.equal(ig.url, 'https://www.instagram.com/');
  assert.equal(ig.name, 'sessionid');
  assert.equal(ig.value, 'IGv');
  assert.equal(ig.httpOnly, true);
  assert.equal(ig.sameSite, 'no_restriction');
});

test('parseCookiePayload menolak cookie tanpa name/value', () => {
  const out = parseCookiePayload({ instagram: [{ value: 'x' }, { name: 'a' }, {}, 'bukancookie'] });
  assert.equal(out.length, 0);
});

test('parseCookiePayload mendukung bentuk array datar (Instagram)', () => {
  const out = parseCookiePayload([{ name: 'sessionid', value: 'flat' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://www.instagram.com/');
});

test('DEFAULT_PORT adalah angka (dipakai ekstensi)', () => {
  assert.equal(typeof DEFAULT_PORT, 'number');
  assert.ok(DEFAULT_PORT > 0 && DEFAULT_PORT < 65536);
});