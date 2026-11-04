'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createRateLimiter } = require('../main/rateLimiter');

function memStorage() {
  const data = {};
  return {
    get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
      return out;
    },
    set(values) { Object.assign(data, values || {}); },
    remove() {},
  };
}

function makeLimiter() {
  const limiter = createRateLimiter(memStorage());
  limiter.init();
  return limiter;
}

test('startSession me-reset warm-up & budget sesi, bukan budget kunjungan', () => {
  const l = makeLimiter();
  l.reportSuccess();
  l.reportSuccess();
  assert.equal(l.cycleVisits, 2);
  l.startSession();
  assert.equal(l.totalTasksThisSession, 0);
  assert.equal(l.sessionTaskCount, 0);
  assert.equal(l.cycleVisits, 2);
});

test('beginCycle mengisi ulang budget hanya bila siklus berubah', () => {
  const l = makeLimiter();
  l.beginCycle('1:10');
  l.recordVisit();
  l.recordVisit();
  assert.equal(l.cycleVisits, 2);
  const same = l.beginCycle('1:10');
  assert.equal(same, false);
  assert.equal(l.cycleVisits, 2);
  const fresh = l.beginCycle('1:11');
  assert.equal(fresh, true);
  assert.equal(l.cycleVisits, 0);
});

test('hasVisitBudget memblok di batas siklus', () => {
  const l = makeLimiter();
  l.beginCycle('x');
  l.cycleVisits = l.VISIT_BUDGET;
  assert.equal(l.hasVisitBudget(), false);
  l.cycleVisits = 0;
  assert.equal(l.hasVisitBudget(), true);
});

test('getDelay dijepit setelah multiplier, tidak pernah > MAX_DELAY_MS', () => {
  const l = makeLimiter();
  l.currentMode = 'safe';
  l.backoffMultiplier = 10;
  l.totalTasksThisSession = 0; // warm-up 3x
  const delay = l.getDelay();
  assert.ok(delay <= l.MAX_DELAY_MS);
  assert.ok(delay >= l.MODES.safe.min * 3 || delay === l.MAX_DELAY_MS);
});

test('reportSuccess menaikkan counter & menghapus backoff', () => {
  const l = makeLimiter();
  l.consecutiveErrors = 3;
  l.backoffMultiplier = 3;
  l.reportSuccess();
  assert.equal(l.consecutiveErrors, 0);
  assert.equal(l.backoffMultiplier, 1);
  assert.equal(l.sessionTaskCount, 1);
});

test('recordAuxiliaryVisit membelanjakan budget & sesi', () => {
  const l = makeLimiter();
  l.beginCycle('a');
  l.recordAuxiliaryVisit();
  assert.equal(l.cycleVisits, 1);
  assert.equal(l.sessionTaskCount, 1);
});