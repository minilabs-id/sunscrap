'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createDatabase } = require('../main/db');

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