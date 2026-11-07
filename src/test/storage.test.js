'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('../backend/core/storage');

test('storage menyimpan/membaca/menghapus secara roundtrip', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sastore-')), 's.json');
  const s = createStorage(file);
  s.set({ a: 1, b: [2, 3] });
  assert.deepEqual(s.get(['a', 'b']), { a: 1, b: [2, 3] });
  s.remove(['a']);
  assert.deepEqual(s.get(null), { b: [2, 3] });
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('storage bertahan terhadap file awal yang korup (JSON tidak valid)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sastore-'));
  const file = path.join(dir, 's.json');
  fs.writeFileSync(file, '{bukan json', 'utf8');
  const s = createStorage(file);
  assert.deepEqual(s.get(null), {}); // tidak melempar, mulai kosong
  s.set({ ok: true }); // dan tetap bisa menulis
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: true });
  fs.rmSync(dir, { recursive: true, force: true });
});