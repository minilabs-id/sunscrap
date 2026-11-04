'use strict';
const test = require('node:test');
const assert = require('node:assert');
const policy = require('../main/policy');

test('allowlist hanya host persis (bukan suffix)', () => {
  assert.equal(policy.allowedTarget('https://www.instagram.com/p/abc'), true);
  assert.equal(policy.allowedTarget('https://www.tiktok.com/@u/video/1'), true);
  assert.equal(policy.allowedTarget('https://notinstagram.com/p/abc'), false);
  assert.equal(policy.allowedTarget('https://instagram.com.evil.com/p/abc'), false);
});

test('classifyError memetakan taksonomi', () => {
  assert.equal(policy.classifyError(new Error('login required')), 'AUTH');
  assert.equal(policy.classifyError(new Error('too many requests')), 'THROTTLED');
  assert.equal(policy.classifyError(new Error('private account')), 'PERMANENT');
  assert.equal(policy.classifyError(new Error('timeout')), 'TRANSIENT');
});

test('outcomeOf: cache-hit tidak dikenai biaya', () => {
  const o = policy.outcomeOf({ status: 'OK', source: 'profile-visit' });
  assert.equal(o.charge, 'none');
  assert.equal(o.fromCache, true);
  assert.equal(o.blocked, false);
});

test('outcomeOf: blok ketiga beruntun berhenti', () => {
  const fail = { status: 'FAILED', errorCode: 'THROTTLED' };
  const o1 = policy.outcomeOf(fail, 0);
  assert.equal(o1.blocked, true);
  assert.equal(o1.blockedInARow, 1);
  assert.equal(o1.stop, false);
  const o3 = policy.outcomeOf(fail, 2);
  assert.equal(o3.blockedInARow, 3);
  assert.equal(o3.stop, true);
});