'use strict';
const test = require('node:test');
const assert = require('node:assert');
const intel = require('../backend/core/intel');

const t0 = '2026-10-01T08:00:00Z';
const t1 = '2026-10-01T08:02:00Z';
const t2 = '2026-10-01T08:04:00Z';

function account(username, followers, extra = {}) {
  return { platform: 'instagram', username, follower_count: followers, following_count: null, post_count: null, is_verified: 0, display_name: null, bio: null, region: null, external_id: null, fetched_at: '2026-10-01T08:00:00Z', ...extra };
}

test('jangkauan rendah terhadap followers memberi flag reach_rendah', () => {
  const a = account('rendah', 10000);
  const posts = [
    { post_ref: 'a', posted_at: t0, likes: 50, comments: 1, shares: 0, views: null, caption: null },
    { post_ref: 'b', posted_at: t1, likes: 50, comments: 1, shares: 0, views: null, caption: null },
    { post_ref: 'c', posted_at: t2, likes: 50, comments: 1, shares: 0, views: null, caption: null },
  ];
  const result = intel.analyseAccount(a, posts, [], {});
  assert.ok(result.flags.some((f) => f.key === 'reach_rendah'));
  assert.ok(result.metrics.like_reach_pct === 0.5);
});

test('post ref sama di dua akun => konten_kembar + level pola_ternak', () => {
  const a1 = account('satu', 10000);
  const a2 = account('dua', 12000);
  const posts1 = [{ post_ref: 'same', posted_at: t0, likes: 500, comments: 10, views: null, caption: null }];
  const posts2 = [{ post_ref: 'same', posted_at: t0, likes: 400, comments: 8, views: null, caption: null }];
  const links = intel.findAccountLinks([a1, a2], { 'instagram:satu': posts1, 'instagram:dua': posts2 });
  const r = intel.analyseAccount(a1, posts1, [], links['instagram:satu']);
  assert.ok(r.flags.some((f) => f.key === 'konten_kembar'));
  assert.equal(r.level, 'pola_ternak');
});

test('unggahan bertumpuk dalam 10 menit memberi flag', () => {
  const a = account('burst', 10000);
  const posts = [
    { post_ref: 'a', posted_at: t0, likes: 500, comments: 10, views: null, caption: null },
    { post_ref: 'b', posted_at: '2026-10-01T08:05:00Z', likes: 500, comments: 10, views: null, caption: null },
    { post_ref: 'c', posted_at: '2026-10-01T08:09:00Z', likes: 500, comments: 10, views: null, caption: null },
  ];
  const r = intel.analyseAccount(a, posts, [], {});
  assert.ok(r.flags.some((f) => f.key === 'unggah_bertumpuk'));
});

test('buildClusters mengelompokkan akun dengan bukti bersama', () => {
  const links = { 'instagram:a': { 'instagram:b': new Set(['konten']) }, 'instagram:b': { 'instagram:a': new Set(['konten']) } };
  const clusters = intel.buildClusters(links);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].size, 2);
  assert.ok(clusters[0].reasons.includes('konten'));
});

test('caption seragam lintas akun terdeteksi sebagai template', () => {
  const tpl = 'Promo diskon besar untuk semua follower setia kami #';
  const a1 = account('x', 10000);
  const a2 = account('y', 10000);
  const posts1 = [{ post_ref: 'a', posted_at: t0, likes: 10, comments: 0, views: null, caption: tpl + '1000' }];
  const posts2 = [{ post_ref: 'b', posted_at: t1, likes: 10, comments: 0, views: null, caption: tpl + '2000' }];
  const shared = intel.sharedCaptionTemplates({ 'instagram:x': posts1, 'instagram:y': posts2 });
  assert.ok(shared.size >= 1);
});

test('tanggal di bio tidak ditokenisasi sebagai nomor telepon (L-02)', () => {
  const tokens = intel.bioContactTokens('Est. 2026.10.01, promo saban hari');
  const phones = Array.from(tokens).filter((t) => t.startsWith('phone:'));
  assert.equal(phones.length, 0);
  // nomor asli tetap terbaca
  assert.ok(Array.from(intel.bioContactTokens('WA 0812-3456-7890')).some((t) => t.startsWith('phone:')));
});

test('followers datar di band 20K-100K memberi flag (L-01)', () => {
  const a = account('flat50k', 50000);
  const history = [
    { month: '2026-09', follower_count: 50000, post_count: 100 },
    { month: '2026-10', follower_count: 50100, post_count: 120 },
  ];
  const r = intel.analyseAccount(a, [], history, {});
  assert.ok(r.flags.some((f) => f.key === 'followers_datar'));
});

test('komentar tak terbaca (null) tidak memicu flag komentar_minim', () => {
  const a = account('nocomments', 10000);
  const posts = [
    { post_ref: 'a', posted_at: '2026-10-01T08:00:00Z', likes: 200, comments: null, views: null, caption: null },
    { post_ref: 'b', posted_at: '2026-10-02T08:00:00Z', likes: 200, comments: null, views: null, caption: null },
    { post_ref: 'c', posted_at: '2026-10-03T08:00:00Z', likes: 200, comments: null, views: null, caption: null },
  ];
  const r = intel.analyseAccount(a, posts, [], {});
  assert.ok(!r.flags.some((f) => f.key === 'komentar_minim'));
});

test('fan-out cutoff: token dipakai >50 akun bukan bukti pasangan (cegah O(n^2))', () => {
  const accounts = [];
  const postsByAccount = {};
  for (let i = 0; i < 60; i++) {
    const u = `farm_${String(i).padStart(2, '0')}`;
    accounts.push({ platform: 'instagram', username: u, bio: 'WA 0812-3456-7890', follower_count: 10000 });
    postsByAccount[`instagram:${u}`] = [];
  }
  const links = intel.findAccountLinks(accounts, postsByAccount);
  assert.equal(Object.keys(links).length, 0); // token umum -> tidak ada edge 'kontak'
});

test('token dipakai <=50 akun tetap menjadi bukti pasangan', () => {
  const accounts = [];
  const postsByAccount = {};
  for (let i = 0; i < 40; i++) {
    const u = `satu_${String(i).padStart(2, '0')}`;
    accounts.push({ platform: 'instagram', username: u, bio: 'WA 0812-3456-7890', follower_count: 10000 });
    postsByAccount[`instagram:${u}`] = [];
  }
  const links = intel.findAccountLinks(accounts, postsByAccount);
  assert.ok(Object.keys(links).length > 0); // 40 akun berbagi kontak -> terhubung
});

test('nama berpola (akhiran angka) menghubungkan akun se-platform', () => {
  const accounts = [account('jualkue', 10000), account('jualkue2', 10000), account('jualkue3', 10000)];
  const postsByAccount = { 'instagram:jualkue': [], 'instagram:jualkue2': [], 'instagram:jualkue3': [] };
  const links = intel.findAccountLinks(accounts, postsByAccount);
  const edges = links['instagram:jualkue'] || {};
  assert.ok(edges['instagram:jualkue2'] && edges['instagram:jualkue2'].has('nama'));
});

test('nama tanpa akhiran angka tidak menghubungkan akun berlainan', () => {
  const accounts = [account('brandx', 1000), account('brandy', 1000)];
  const postsByAccount = { 'instagram:brandx': [], 'instagram:brandy': [] };
  const links = intel.findAccountLinks(accounts, postsByAccount);
  assert.equal(Object.keys(links).length, 0);
});

test('lonjakan followers bulan terakhir yang tak wajar memberi flag', () => {
  const a = account('spike', 10000);
  const history = [
    { month: '2026-07', follower_count: 1000, post_count: 10 },
    { month: '2026-08', follower_count: 1100, post_count: 11 },
    { month: '2026-09', follower_count: 1200, post_count: 12 },
    { month: '2026-10', follower_count: 2000, post_count: 13 },
  ];
  const r = intel.analyseAccount(a, [], history, {});
  assert.ok(r.flags.some((f) => f.key === 'followers_spike'));
});

test('caption mirip (bukan identik) menautkan dua akun lewat kata kunci', () => {
  const a1 = account('miripa', 10000);
  const a2 = account('miripb', 10000);
  const posts1 = [{ post_ref: 'a', posted_at: t0, likes: 100, comments: 5, views: null, caption: 'jual sepatu kulit handmade asli dari bandung' }];
  const posts2 = [{ post_ref: 'b', posted_at: t1, likes: 90, comments: 4, views: null, caption: 'sepatu kulit handmade asli bandung promo terbatas' }];
  const links = intel.findAccountLinks([a1, a2], { 'instagram:miripa': posts1, 'instagram:miripb': posts2 });
  const edges = links['instagram:miripa'] || {};
  assert.ok(edges['instagram:miripb'] && edges['instagram:miripb'].has('caption_mirip'));
});

test('caption yang hanya beda mention & URL dianggap template sama', () => {
  const a = 'Promo besar untuk member setia kami, cek sekarang juga ya semuanya';
  const b = 'Promo besar untuk member setia kami, cek sekarang juga ya semuanya @akun https://t.co/abc';
  assert.equal(intel.captionTemplateKey(a), intel.captionTemplateKey(b));
});

test('akun besar tidak diberi flag reach_rendah (band 5K-20K saja)', () => {
  const a = account('besar', 500000);
  const posts = [
    { post_ref: 'a', posted_at: t0, likes: 4000, comments: 10, views: null, caption: null },
    { post_ref: 'b', posted_at: t1, likes: 4000, comments: 10, views: null, caption: null },
    { post_ref: 'c', posted_at: t2, likes: 4000, comments: 10, views: null, caption: null },
  ];
  const r = intel.analyseAccount(a, posts, [], {});
  assert.ok(!r.flags.some((f) => f.key === 'reach_rendah'));
});

test('median shares TikTok tersimpan ke metrics', () => {
  const a = account('share', 10000, { platform: 'tiktok' });
  const posts = [
    { post_ref: 'a', posted_at: t0, likes: 100, comments: 5, shares: 20, views: 1000, caption: null },
    { post_ref: 'b', posted_at: t1, likes: 100, comments: 5, shares: 30, views: 1000, caption: null },
    { post_ref: 'c', posted_at: t2, likes: 100, comments: 5, shares: 40, views: 1000, caption: null },
  ];
  const r = intel.analyseAccount(a, posts, [], {});
  assert.equal(r.metrics.median_shares, 30);
});

test('akun di band ternak tanpa data unggahan diberi catatan data_tidak_lengkap (skor 0)', () => {
  const a = account('kabur', 10000);
  const r = intel.analyseAccount(a, [], [], {});
  assert.ok(r.flags.some((f) => f.key === 'data_tidak_lengkap'));
  assert.equal(r.score, 0);
  assert.equal(r.level, 'bersih');
  assert.equal(r.data_incomplete, true);
});

test('akun di band ternak yang datanya lengkap tidak dicap data_tidak_lengkap', () => {
  const a = account('lengkap', 10000);
  const posts = [
    { post_ref: 'a', posted_at: '2026-09-01T08:00:00Z', likes: 500, comments: 10, views: null, caption: null },
    { post_ref: 'b', posted_at: '2026-09-08T08:00:00Z', likes: 500, comments: 10, views: null, caption: null },
    { post_ref: 'c', posted_at: '2026-09-15T08:00:00Z', likes: 500, comments: 10, views: null, caption: null },
  ];
  const r = intel.analyseAccount(a, posts, [], {});
  assert.ok(!r.flags.some((f) => f.key === 'data_tidak_lengkap'));
  assert.equal(r.data_incomplete, false);
});