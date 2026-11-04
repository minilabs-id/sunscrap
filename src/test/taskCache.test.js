'use strict';
const test = require('node:test');
const assert = require('node:assert');
const TaskCache = require('../main/taskCache');

test('baris penuh menjawab task tanpa navigasi', () => {
  const task = { platform: 'tiktok', username: 'u', url: 'https://www.tiktok.com/@u/video/1', cachedPost: {
    likes: 10, comments: 2, views: 100, shares: 1, fetchedAt: new Date().toISOString(),
  }};
  const result = TaskCache.resultFromTask(task);
  assert.equal(result.status, 'OK');
  assert.equal(result.source, 'profile-visit');
  assert.equal(result.likes, 10);
});

test('baris tanpa satu angka pun bukan bukti', () => {
  const task = { cachedPost: { likes: null, comments: null, views: null, shares: null, fetchedAt: new Date().toISOString() }};
  assert.equal(TaskCache.resultFromTask(task), null);
});

test('baris kadaluarsa ditolak', () => {
  const task = { cachedPost: { likes: 1, fetchedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() }};
  assert.equal(TaskCache.resultFromTask(task), null);
});

test('foto tanpa views tidak menurunkan baris penuh ke PARTIAL', () => {
  const task = { cachedPost: { likes: 10, comments: 2, views: null, fetchedAt: new Date().toISOString() }};
  const result = TaskCache.resultFromTask(task);
  assert.equal(result.status, 'OK');
  assert.equal(result.views, null);
});

test('shouldHarvestAccount hanya sekali per siklus & bila backend tidak segar', () => {
  const harvested = new Set(['instagram:u']);
  assert.equal(TaskCache.shouldHarvestAccount({ platform: 'instagram', username: 'u', cachedFollowerCount: null }, harvested), false);
  assert.equal(TaskCache.shouldHarvestAccount({ platform: 'instagram', username: 'v', cachedFollowerCount: null }, harvested), true);
  assert.equal(TaskCache.shouldHarvestAccount({ platform: 'instagram', username: 'v', cachedFollowerCount: 1234 }, harvested), false);
});