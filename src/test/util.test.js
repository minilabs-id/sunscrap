'use strict';
const test = require('node:test');
const assert = require('node:assert');
const util = require('../backend/core/util');

test('normalizeTargetUrl menerima post Instagram & TikTok', () => {
  assert.deepEqual(util.normalizeTargetUrl('https://www.instagram.com/user/p/ABC123/'), { platform: 'instagram', url: 'https://www.instagram.com/user/p/ABC123/' });
  assert.deepEqual(util.normalizeTargetUrl('https://www.tiktok.com/@user/video/7123456789'), { platform: 'tiktok', url: 'https://www.tiktok.com/@user/video/7123456789' });
});

test('normalizeTargetUrl menolak profil & host lain', () => {
  assert.equal(util.normalizeTargetUrl('https://www.instagram.com/user/'), null);
  assert.equal(util.normalizeTargetUrl('https://www.instagram.com/user'), null);
  assert.equal(util.normalizeTargetUrl('https://evil.com/p/x'), null);
  assert.equal(util.normalizeTargetUrl('https://notinstagram.com/p/abc'), null);
});

test('normalizeTargetUrl membuang query pelacak & menyamakan /reels/ → /reel/', () => {
  const a = util.normalizeTargetUrl('https://www.instagram.com/reel/CODE/?igsh=AAA');
  const b = util.normalizeTargetUrl('https://www.instagram.com/reel/CODE/?igsh=BBB&lang=id');
  assert.equal(a.url, b.url);
  assert.equal(a.url.includes('igsh'), false);
  assert.equal(util.normalizeTargetUrl('https://www.instagram.com/reels/CODE/').url, 'https://www.instagram.com/reel/CODE/');
  assert.equal(util.normalizeTargetUrl('https://www.tiktok.com/@u/video/7123456789?lang=id-ID').url, 'https://www.tiktok.com/@u/video/7123456789');
});

test('cleanUsername & cleanInt', () => {
  assert.equal(util.cleanUsername('@Salsa_Abc (Tiktok)'), 'salsa_abc');
  assert.equal(util.cleanUsername(null), null);
  assert.equal(util.cleanInt('12'), 12);
  assert.equal(util.cleanInt(12.6), 13);
  assert.equal(util.cleanInt(-5), null);
  assert.equal(util.cleanInt(null), null);
});

test('postRefFromUrl', () => {
  assert.equal(util.postRefFromUrl('https://www.instagram.com/u/p/ABC123/'), 'abc123');
  assert.equal(util.postRefFromUrl('https://www.tiktok.com/@u/video/7123456789'), '7123456789');
});

test('usernameFromPostUrl', () => {
  assert.equal(util.usernameFromPostUrl('tiktok', 'https://www.tiktok.com/@handle/video/1'), 'handle');
  assert.equal(util.usernameFromPostUrl('instagram', 'https://www.instagram.com/handle/p/ABC/'), 'handle');
});

test('parseRepeatDays & clampLimit & cleanPeriod', () => {
  assert.equal(util.parseRepeatDays('7'), 7);
  assert.equal(util.parseRepeatDays('9999'), 365);
  assert.equal(util.parseRepeatDays('x'), null);
  assert.equal(util.clampLimit(500, 1, 200, 50), 200);
  assert.equal(util.clampLimit(undefined, 1, 200, 50), 50);
  assert.equal(util.cleanPeriod('2026-11-01'), '2026-11');
  assert.equal(util.cleanPeriod('garbage'), null);
});

test('sqlNow adalah format SQLite UTC', () => {
  const now = util.sqlNow();
  assert.match(now, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('parseUtc membaca "YYYY-MM-DD HH:MM:SS" sebagai UTC (bukan lokal)', () => {
  const d = util.parseUtc('2026-11-04 12:00:00');
  assert.equal(d.toISOString(), '2026-11-04T12:00:00.000Z');
  const iso = util.parseUtc('2026-11-04T12:00:00Z');
  assert.equal(iso.toISOString(), '2026-11-04T12:00:00.000Z');
});