'use strict';
/**
 * sunscrap — bench (ketangkasan mesin)
 * Ukur latensi lapisan data pada skala 1k/5k/10k target di runtime Electron.
 * Jalankan: npx electron scripts/bench.js
 */
const { app } = require('electron');
const path = require('node:path');
const os = require('node:os');

async function time(label, fn) {
  const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0;
  console.log(`  ${label.padEnd(26)} ${String(ms).padStart(5)} ms`);
  return r;
}

function links(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const p = i % 2 === 0 ? 'instagram' : 'tiktok';
    arr.push(p === 'instagram'
      ? { url: `https://www.instagram.com/u${i}/p/C${i}/`, platform: 'instagram', username: `u${i}`, tema: null }
      : { url: `https://www.tiktok.com/@u${i}/video/${7000000000 + i}`, platform: 'tiktok', username: `u${i}`, tema: null });
  }
  return arr;
}

app.whenReady().then(async () => {
  try {
    const { createDatabase } = require('../src/backend/core/db');
    const dbPath = path.join(os.tmpdir(), 'sunscrap-bench-' + Date.now() + '.db');
    const db = createDatabase(dbPath);

    for (const [label, n] of [['@10 target', 10], ['@1000 target', 1000], ['@5000 target', 5000], ['@10000 target', 10000]]) {
      console.log(`\n== ${label} ==`);
      const tasks = links(n);
      db.clearAll();
      const created = await time('createAuditWithTasks', () => db.createAuditWithTasks(tasks, { name: 'bench', repeatDays: 0 }));
      await time('getSummary(null)', () => db.getSummary(null));
      await time('getTimeseries(30h)', () => db.getTimeseries(null, 30));
      await time('getTargets(limit 200)', () => db.getTargets({ limit: 200, offset: 0 }));
      await time('getAccountIntel()', () => db.getAccountIntel({}));
      await time('getQueueStats', () => db.getQueueStats());
      void created;
    }

    // import parser pada file besar
    const fs = require('node:fs');
    const bigcsv = path.join(os.tmpdir(), 'sunscrap-bench-' + Date.now() + '.csv');
    fs.writeFileSync(bigcsv, 'Link\n' + links(10000).map((t) => t.url).join('\n'));
    const { parseImportFile } = require('../src/backend/core/import');
    console.log('\n== import parse 10k CSV ==');
    await time('parseImportFile(10k)', () => parseImportFile(bigcsv));
    fs.rmSync(bigcsv, { force: true });

    db.close();
    try { require('node:fs').rmSync(dbPath, { force: true }); } catch {}
    console.log('\nBENCH DONE');
    app.exit(0);
  } catch (e) {
    console.error('BENCH FAIL', e);
    app.exit(1);
  }
});