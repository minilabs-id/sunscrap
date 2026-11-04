'use strict';
/**
 * sunscrap — smoke
 * Validasi require-graph + DB + worker + scraper di bawah runtime Electron
 * (node:sqlite bawaan Electron), tanpa membuka jendela/tray. Keluar setelah OK.
 */
const { app } = require('electron');
const path = require('node:path');
const os = require('node:os');

app.whenReady().then(() => {
  try {
    const { createDatabase } = require('../src/main/db');
    const { createScraper } = require('../src/main/scraper');
    const { createWorker } = require('../src/main/worker');
    const { createRateLimiter } = require('../src/main/rateLimiter');
    const { registerIpc } = require('../src/main/ipc');

    const dbPath = path.join(os.tmpdir(), 'sunscrap-smoke-' + Date.now() + '.db');
    const db = createDatabase(dbPath);

    // jalur penuh: buat audit → klaim → hasil → ringkasan → intel → import import-module
    const tasks = [
      { url: 'https://www.instagram.com/aku/p/ABC123/', platform: 'instagram', username: 'aku', tema: 'a' },
      { url: 'https://www.tiktok.com/@dia/video/7123456789', platform: 'tiktok', username: 'dia', tema: 'b' },
    ];
    const created = db.createAuditWithTasks(tasks, { name: 'Smoke', repeatDays: 0 });
    const task = db.getNextTask();
    db.updateTaskResult(task.id, { platform: 'instagram', username: 'aku', likes: 100, comments: 5, followerCount: 9000, status: 'OK' });
    const summary = db.getSummary(null);
    const intel = db.getAccountIntel({});
    const exportRows = db.getExportRows(null, null);
    const info = db.getDatabaseInfo();

    const scraper = createScraper({ onLog: console.log });
    const limiter = createRateLimiter({ get: () => ({}), set() {}, remove() {} }).init();
    const worker = createWorker({ db, scraper, limiter, notify: () => {}, log: console.log });

    require('../src/main/import');
    require('../src/main/export');

    console.log('SMOKE_OK', JSON.stringify({
      inserted: created.inserted,
      kpi: summary.kpi,
      accounts: intel.items.length,
      exportRows: exportRows.length,
      info,
      workerStatus: worker.getStatus().label,
    }));
    scraper.dispose();
    db.close();
    try { require('node:fs').unlinkSync(dbPath); require('node:fs').unlinkSync(dbPath + '-wal'); require('node:fs').unlinkSync(dbPath + '-shm'); } catch {}
    app.exit(0);
  } catch (error) {
    console.error('SMOKE_FAIL', error && error.stack ? error.stack : error);
    app.exit(1);
  }
});