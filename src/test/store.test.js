'use strict';
const test = require('node:test');
const assert = require('node:assert');
const store = require('../frontend/store');

test('createState menghasilkan instance independen', () => {
  const a = store.createState();
  const b = store.createState();
  assert.notEqual(a, b);
  assert.ok(a.targets.selected instanceof Set);
  assert.equal(a.targets.selected.size, 0);
  assert.equal(a.temaSort, 'views');
  assert.equal(a.targets.limit, 25);
  assert.equal(a.accounts.limit, 50);
  a.targets.selected.add(123);
  assert.equal(b.targets.selected.size, 0);
});

test('densityForWidth memilih kepadatan berdasarkan lebar', () => {
  assert.equal(store.densityForWidth(1279), 'padat');
  assert.equal(store.densityForWidth(1280), 'normal');
  assert.equal(store.densityForWidth(1679), 'normal');
  assert.equal(store.densityForWidth(1680), 'lapang');
});

test('pageLabel menghitung halaman & total', () => {
  assert.equal(store.pageLabel(0, 25, 100), 'Hal 1 / 4');
  assert.equal(store.pageLabel(50, 25, 100), 'Hal 3 / 4');
  assert.equal(store.pageLabel(0, 25, 0), 'Hal 1 / 1');
});

test('nextOffset & prevOffset dijepit pada batasnya', () => {
  assert.equal(store.nextOffset(0, 25, 100), 25);
  assert.equal(store.nextOffset(75, 25, 100), 75); // 75+25 = 100, tak < total
  assert.equal(store.prevOffset(50, 25), 25);
  assert.equal(store.prevOffset(10, 25), 0);
  assert.equal(store.prevOffset(0, 25), 0);
});

test('toggleSort membalik arah pada kolom sama, dan menetapkan arah default pada kolom baru', () => {
  assert.deepEqual(store.toggleSort('views', 'desc', 'views'), { sort: 'views', dir: 'asc' });
  assert.deepEqual(store.toggleSort('views', 'asc', 'views'), { sort: 'views', dir: 'desc' });
  // kolom numerik baru → menurun
  assert.deepEqual(store.toggleSort('recent', 'desc', 'followers'), { sort: 'followers', dir: 'desc' });
  // kolom username → alfabetis (asc)
  assert.deepEqual(store.toggleSort('recent', 'desc', 'username'), { sort: 'username', dir: 'asc' });
});

test('summarySignature deterministik & berubah saat data berubah', () => {
  const base = { generated_at: '2026-11-05 10:00:00', kpi: { targets: 10, totals: { views: 100, likes: 5 } } };
  const changed = { generated_at: '2026-11-05 10:00:00', kpi: { targets: 11, totals: { views: 100, likes: 5 } } };
  // deterministik untuk input sama
  assert.equal(store.summarySignature(base, null), store.summarySignature(base, null));
  // berubah bila angka berubah
  assert.notEqual(store.summarySignature(base, null), store.summarySignature(changed, null));
  // null-safe
  assert.equal(store.summarySignature(null, null), store.summarySignature(null, null));
  // timeseries diperhitungkan
  const tsA = { days: [{ date: '2026-11-05', views: 1 }] };
  const tsB = { days: [{ date: '2026-11-05', views: 2 }] };
  assert.notEqual(store.summarySignature(base, tsA), store.summarySignature(base, tsB));
});

test('reviewKey & reviewMeta memetakan keputusan tinjauan', () => {
  assert.equal(store.reviewKey('instagram', 'foo'), 'instagram:foo');
  assert.equal(store.reviewKey('', ''), ':');
  assert.deepEqual(store.reviewMeta('bookmark'), { label: 'Ditandai', tone: 'warn', icon: '🔖' });
  assert.deepEqual(store.reviewMeta('clear'), { label: 'Bersih', tone: 'ok', icon: '✔' });
  assert.deepEqual(store.reviewMeta('flag'), { label: 'Dikonfirmasi', tone: 'err', icon: '✖' });
  assert.equal(store.reviewMeta('unknown'), null);
});

test('reviewedDecisionCounts menghitung keputusan per jenis', () => {
  assert.deepEqual(store.reviewedDecisionCounts({}), { clear: 0, flag: 0, bookmark: 0 });
  const map = {
    'instagram:a': { decision: 'clear' },
    'instagram:b': { decision: 'flag' },
    'instagram:c': { decision: 'bookmark' },
    'instagram:d': { decision: 'bookmark' },
    'instagram:e': { decision: 'unknown' },
  };
  assert.deepEqual(store.reviewedDecisionCounts(map), { clear: 1, flag: 1, bookmark: 2 });
});

test('isNeedsReview: hanya akun terindikasi yang belum clear/flag', () => {
  const reviews = { 'instagram:a': { decision: 'clear' }, 'instagram:b': { decision: 'flag' }, 'instagram:c': { decision: 'bookmark' } };
  assert.equal(store.isNeedsReview({ platform: 'instagram', username: 'a', score: 5 }, reviews), false); // clear
  assert.equal(store.isNeedsReview({ platform: 'instagram', username: 'b', score: 5 }, reviews), false); // flag
  assert.equal(store.isNeedsReview({ platform: 'instagram', username: 'c', score: 5 }, reviews), true);  // bookmark → masih perlu
  assert.equal(store.isNeedsReview({ platform: 'instagram', username: 'd', score: 5 }, reviews), true);  // belum ada keputusan
  assert.equal(store.isNeedsReview({ platform: 'instagram', username: 'e', score: 0 }, reviews), false); // tidak terindikasi
  assert.equal(store.isNeedsReview(null, reviews), false);
});

test('riskScorePct memetakan skor mentah ke 0-100', () => {
  assert.equal(store.riskScorePct(0), 0);
  assert.equal(store.riskScorePct(2), 20);
  assert.equal(store.riskScorePct(6), 60);
  assert.equal(store.riskScorePct(10), 100);
  assert.equal(store.riskScorePct(15), 100); // capped
  assert.equal(store.riskScorePct(-3), 0);
  assert.equal(store.riskScorePct(null), 0);
});