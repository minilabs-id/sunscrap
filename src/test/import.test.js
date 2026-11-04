'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const imp = require('../main/import');

test('parseLinksText menerima link IG/TikTok dan menghitung yang tidak valid', () => {
  const r = imp.parseLinksText(
    'https://www.instagram.com/aku/p/ABC123/\n'
    + 'https://www.tiktok.com/@dia/video/7123456789\n'
    + 'bukan link\n'
    + '\n'
  );
  assert.equal(r.tasks.length, 2);
  assert.equal(r.tasks[0].platform, 'instagram');
  assert.equal(r.tasks[0].username, 'aku');
  assert.equal(r.tasks[1].platform, 'tiktok');
  assert.equal(r.tasks[1].username, 'dia');
  assert.equal(r.invalid_urls, 1);
  assert.equal(r.empty_rows, 1); // trailing newline tak lagi dihitung
});

test('parseImportFile membaca CSV (semicolon + BOM)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saimp-'));
  const filePath = path.join(dir, 'test.csv');
  fs.writeFileSync(filePath, '\uFEFFLink;Akun;Tema\nhttps://www.instagram.com/x/p/A1/;@X (Ig);promo\nhttps://www.tiktok.com/@y/video/9;;\nhttps://profile-only.instagram.com/user;;\n', 'utf8');
  const parsed = await imp.parseImportFile(filePath, 10000);
  assert.ok(parsed);
  assert.equal(parsed.tasks.length, 2);
  assert.equal(parsed.invalid_urls, 1); // link profil ditolak
  assert.equal(parsed.tasks[0].username, 'x'); // URL menang atas kolom @X (Ig)
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseLinksText dibatasi maxRows + flag truncated (F-10)', () => {
  const links = Array.from({ length: 15 }, (_, i) => `https://www.instagram.com/u/p/C${i}/`).join('\n');
  const r = imp.parseLinksText(links, 10);
  assert.equal(r.tasks.length, 10);
  assert.equal(r.truncated, true);
});

test('parseImportFile menolak file tanpa kolom Link', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saimp-'));
  const filePath = path.join(dir, 'nourl.csv');
  fs.writeFileSync(filePath, 'Nama;Alamat\nA;B\n', 'utf8');
  const parsed = await imp.parseImportFile(filePath, 10000);
  assert.equal(parsed, null);
  fs.rmSync(dir, { recursive: true, force: true });
});