'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../backend/core/db');

function makeDb() {
  return createDatabase(':memory:');
}

const t1 = { url: 'https://www.instagram.com/aku/p/ABC123/', platform: 'instagram', username: 'aku', tema: 'a' };
const t2 = { url: 'https://www.tiktok.com/@dia/video/7123456789', platform: 'tiktok', username: 'dia', tema: 'b' };

test('createAuditWithTasks + getAudits + getNextTask + hasil', () => {
  const db = makeDb();
  const r = db.createAuditWithTasks([t1, t2], { name: 'Tes', repeatDays: 0 });
  assert.equal(r.inserted, 2);

  const audits = db.getAudits();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].target_count, 2);

  const task = db.getNextTask();
  assert.ok(task);
  assert.ok(task.id && task.url);

  const ok = db.updateTaskResult(task.id, {
    platform: 'instagram', username: 'aku', likes: 100, comments: 5, views: null, shares: null, followerCount: 9000,
    status: 'OK',
  });
  assert.equal(ok, true);

  const stats = db.getDashboardStats();
  assert.equal(stats.OK, 1);
  assert.equal(stats.PENDING + stats.RUNNING, 1);

  const summary = db.getSummary(null);
  assert.equal(summary.kpi.targets, 2);
  assert.equal(summary.kpi.ok, 1);

  const rows = db.getExportRows(null, null);
  assert.equal(rows.length, 1);
  db.close();
});

test('retryTargets membatalkan memo summary (pending ikut naik, bukan basi)', () => {
  const db = makeDb();
  const r = db.createAuditWithTasks([t1], { name: 'retry-memo' });
  const targetId = db.getTargets({ auditId: r.audit_id }).items[0].target_id;

  let task = db.getNextTask();
  db.updateTaskResult(task.id, { platform: 'instagram', username: 'aku', likes: 100, comments: 5, views: null, shares: null, followerCount: 9000, status: 'OK' });
  let s = db.getSummary(null);
  assert.equal(s.kpi.pending + s.kpi.running, 0, 'setelah selesai: tidak ada pending');

  const rr = db.retryTargets(r.audit_id, [targetId]);
  assert.equal(rr.created, 1, 'satu task baru diantrekan');

  s = db.getSummary(null); // memo harus dibatalkan
  assert.equal(s.kpi.pending + s.kpi.running, 1, 'retry menambah pending');
  db.close();
});

test('getTimeseries: delta = pertumbuhan (bukan Σ dobel) vs views mentah', () => {
  const db = makeDb();
  const r = db.createAuditWithTasks([t1], { name: 'ts-delta' });
  const targetId = db.getTargets({ auditId: r.audit_id }).items[0].target_id;

  let task = db.getNextTask();
  db.updateTaskResult(task.id, { platform: 'instagram', username: 'aku', likes: 40, comments: 3, views: 1000, shares: null, followerCount: 9000, status: 'OK' });
  // audit ulang: scrape lagi dengan views naik
  db.retryTargets(r.audit_id, [targetId]);
  task = db.getNextTask();
  db.updateTaskResult(task.id, { platform: 'instagram', username: 'aku', likes: 60, comments: 4, views: 1500, shares: null, followerCount: 9000, status: 'OK' });

  const ts = db.getTimeseries(null, 30);
  const today = ts.days[ts.days.length - 1];
  assert.equal(today.d_views, 1500, 'delta = 1000 baseline + 500 pertumbuhan');
  assert.equal(today.d_likes, 60, 'delta likes = 40 baseline + 20 pertumbuhan');
  assert.equal(today.views, 2500, 'Σ mentah = dobel hitung (1000+1500); sengaja dibedakan dari delta');
  db.close();
});

test('loop siklus berulang: summary konsisten & tanpa pending bocor', () => {
  const db = makeDb();
  const r = db.createAuditWithTasks([t1, t2], { name: 'loop' });
  const targets = db.getTargets({ auditId: r.audit_id }).items.map((t) => t.target_id);
  for (let cycle = 0; cycle < 3; cycle++) {
    db.retryTargets(r.audit_id, targets);
    let task;
    while ((task = db.getNextTask())) {
      db.updateTaskResult(task.id, { platform: task.platform, username: task.username, likes: 10 + cycle, comments: 1, views: null, shares: null, followerCount: 9000, status: 'OK' });
    }
    const s = db.getSummary(null);
    assert.equal(s.kpi.pending + s.kpi.running, 0, `siklus ${cycle}: tidak boleh ada pending tersisa`);
    assert.ok(s.kpi.scraped >= 1, `siklus ${cycle}: ada yang terproses`);
  }
  db.close();
});

test('hasil tanpa metrik tidak berstatus OK', () => {
  const db = makeDb();
  db.createAuditWithTasks([t1], { name: 'x' });
  const task = db.getNextTask();
  db.updateTaskResult(task.id, { status: 'OK', likes: null, comments: null, views: null });
  const stats = db.getDashboardStats();
  assert.equal(stats.OK, 0);
  assert.ok(stats.PARTIAL >= 1);
  db.close();
});

test('duplikat dalam satu file dilewati', () => {
  const db = makeDb();
  const r = db.createAuditWithTasks([t1, t1], { name: 'dupe' });
  assert.equal(r.inserted, 1);
  assert.equal(r.duplicates, 1);
  db.close();
});

test('getTargets memfilter status ok & partial (F-02)', () => {
  const db = makeDb();
  db.createAuditWithTasks([t1, t2], { name: 'f' });
  const task1 = db.getNextTask();
  db.updateTaskResult(task1.id, { status: 'OK', likes: 10, comments: 1, followerCount: 1000 });
  const task2 = db.getNextTask();
  db.updateTaskResult(task2.id, { status: 'PARTIAL', error: 'views missing' });
  const auditId = db.getAudits()[0].id;

  const ok = db.getTargets({ auditId, status: 'ok' });
  assert.equal(ok.total, 1);
  assert.equal(ok.items[0].status, 'OK');

  const partial = db.getTargets({ auditId, status: 'partial' });
  assert.equal(partial.total, 1);
  assert.equal(partial.items[0].status, 'PARTIAL');
  db.close();
});

test('recordAccountProfile menyimpan akun + post + seri bulanan', () => {
  const db = makeDb();
  const res = db.recordAccountProfile({
    platform: 'instagram', username: 'aku', followerCount: 9000, followingCount: 100, postCount: 20,
    isVerified: false, bio: 'halo', displayName: 'Aku',
    posts: [
      { id: 'P1', url: 'https://www.instagram.com/aku/p/P1/', postedAt: '2026-10-01T08:00:00Z', likes: 100, comments: 5, views: null, caption: 'hai' },
      { id: 'P2', url: 'https://www.instagram.com/aku/p/P2/', postedAt: '2026-10-02T08:00:00Z', likes: 120, comments: 6, views: null, caption: 'hai2' },
    ],
  });
  assert.equal(res.posts_stored, 2);

  const cache = db.getAccountCache('aku', 'instagram');
  assert.equal(cache, 9000);

  const intelRes = db.getAccountIntel({});
  assert.ok(intelRes.items.length >= 1);
  const acct = intelRes.items.find((a) => a.username === 'aku');
  assert.ok(acct);
  assert.equal(acct.followers, 9000);
  db.close();
});

test('getTimeseries berisi 30 hari berurutan dengan hari kosong diisi', () => {
  const db = makeDb();
  db.createAuditWithTasks([t1, t2], { name: 'ts' });
  let task;
  while ((task = db.getNextTask())) {
    db.updateTaskResult(task.id, { status: 'OK', likes: 10, comments: 1, views: 100, followerCount: 1000 });
  }
  const res = db.getTimeseries(null, 30);
  assert.equal(res.range_days, 30);
  assert.equal(res.days.length, 30);
  assert.equal(sumOfDays(res.days, 'scraped'), 2);
  assert.equal(sumOfDays(res.days, 'views'), 200);
  const dates = res.days.map((d) => d.date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted);
  db.close();
});

test('getTargets berisi delta_likes & delta_views terhadap snapshot sebelumnya', () => {
  const db = makeDb();
  db.createAuditWithTasks([t1], { name: 'delta' });
  const task1 = db.getNextTask();
  db.updateTaskResult(task1.id, { status: 'OK', likes: 100, comments: 5, views: 1000, followerCount: 9000 });
  const auditId = db.getAudits()[0].id;
  db.enqueueRun(auditId, 'manual', true);
  const task2 = db.getNextTask();
  assert.ok(task2);
  db.updateTaskResult(task2.id, { status: 'OK', likes: 150, comments: 7, views: 1400, followerCount: 9000 });
  const target = db.getTargets({ auditId }).items[0];
  assert.equal(target.delta_likes, 50);
  assert.equal(target.delta_views, 400);
  db.close();
});

test('getAccountIntel mengembalikan distribusi level', () => {
  const db = makeDb();
  db.recordAccountProfile({ platform: 'instagram', username: 'aku', followerCount: 9000, posts: [{ id: 'P1', url: 'https://www.instagram.com/aku/p/P1/', postedAt: '2026-10-01T08:00:00Z', likes: 100 }] });
  const res = db.getAccountIntel({});
  assert.ok(res.summary, 'summary wajib ada');
  assert.equal(typeof res.summary.levels, 'object');
  const total = Object.values(res.summary.levels || {}).reduce((a, b) => a + b, 0);
  assert.equal(total, res.summary.accounts);
  db.close();
});

const sumOfDays = (days, field) => days.reduce((a, d) => a + (Number(d[field]) || 0), 0);

test('getCompare is_new hanya untuk akun yang baru di periode terbaru', () => {
  const db = makeDb();
  db.createAuditWithTasks([t1], { name: 'Sep', period: '2026-09' });        // t1 = aku (IG)
  db.createAuditWithTasks([t1, t2], { name: 'Okt', period: '2026-10' });     // t1 = aku, t2 = dia (TT)
  let task;
  while ((task = db.getNextTask())) {
    db.updateTaskResult(task.id, { status: 'OK', likes: 10, comments: 1, views: 100, followerCount: 1000 });
  }
  const cmp = db.getCompare(6);
  const aku = cmp.accounts.find((a) => a.username === 'aku');
  const dia = cmp.accounts.find((a) => a.username === 'dia');
  assert.ok(aku && dia);
  assert.equal(aku.is_new, false); // muncul di 2 periode
  assert.equal(dia.is_new, true);  // hanya periode terbaru
  assert.equal(cmp.summary.new_accounts, 1);
  db.close();
});

test('retryFailedTargets melewatkan PERMANENT', () => {
  const db = makeDb();
  db.createAuditWithTasks([t1, t2], { name: 'r' });
  const task1 = db.getNextTask();
  db.updateTaskResult(task1.id, { status: 'FAILED', error: 'private account', errorCode: 'PERMANENT' });
  const task2 = db.getNextTask();
  db.updateTaskResult(task2.id, { status: 'FAILED', error: 'terlalu banyak permintaan', errorCode: 'THROTTLED' });
  const auditId = db.getAudits()[0].id;
  const r = db.retryFailedTargets(auditId);
  assert.equal(r.created, 1);
  assert.equal(r.skipped_permanent, 1);
  db.close();
});

test('deleteAccount menghapus data akun + post + history', () => {
  const db = makeDb();
  db.recordAccountProfile({ platform: 'instagram', username: 'aku', followerCount: 100, posts: [{ id: 'P1', url: 'https://www.instagram.com/aku/p/P1/', postedAt: '2026-10-01T08:00:00Z', likes: 5 }] });
  assert.ok(db.getAccountCache('aku', 'instagram') !== null);
  assert.equal(db.deleteAccount('instagram', 'aku'), true);
  assert.equal(db.getAccountCache('aku', 'instagram'), null);
  db.close();
});

test('restoreDatabase menolak sumber yang sama dengan database aktif (K-1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadb-self-'));
  const p = path.join(dir, 'a.db');
  const db = createDatabase(p);
  db.createAuditWithTasks([t1], { name: 'x' });
  assert.throws(() => db.restoreDatabase(p), /sama dengan database aktif/i);
  assert.equal(db.getAudits().length, 1); // data aktif tidak tersentuh
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restoreDatabase menolak cadangan skema lebih lama (K-5)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadb-old-'));
  const backup = path.join(dir, 'old-schema.db');
  const sqlite = require('node:sqlite');
  const RawDb = sqlite.Database || sqlite.DatabaseSync;
  const src = new RawDb(backup);
  src.exec(`CREATE TABLE audits(id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE targets(id INTEGER PRIMARY KEY);
            CREATE TABLE tasks(id INTEGER PRIMARY KEY, status TEXT);
            CREATE TABLE snapshots(id INTEGER PRIMARY KEY);
            PRAGMA user_version = 3;`);
  src.close();
  const db = createDatabase(path.join(dir, 'main.db'));
  db.createAuditWithTasks([t1], { name: 'x' });
  assert.throws(() => db.restoreDatabase(backup), /skema/i);
  assert.equal(db.getAudits().length, 1); // data aktif tidak tersentuh
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backupDatabase + restoreDatabase mengembalikan data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadb-'));
  const db = createDatabase(path.join(dir, 'main.db'));
  db.createAuditWithTasks([t1], { name: 'x' });
  const bak = path.join(dir, 'bak.db');
  db.backupDatabase(bak);
  db.createAuditWithTasks([t2], { name: 'y' });
  assert.equal(db.getAudits().length, 2);
  db.restoreDatabase(bak);
  assert.equal(db.getAudits().length, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});