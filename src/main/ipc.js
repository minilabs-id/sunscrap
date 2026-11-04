'use strict';
/**
 * sunscraping — ipc
 * Mendaftarkan handler ipcMain untuk seluruh permukaan renderer. Operasi tulis
 * memicu broadcast 'data' agar dashboard menyegarkan diri.
 */

const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function registerIpc({ db, worker, scraper, broadcast }) {
  const push = (type, payload) => {
    try { broadcast(type, payload); } catch {}
  };
  const dataChanged = () => push('data', { ts: Date.now() });

  const parentOf = (event) => BrowserWindow.fromWebContents(event.sender) || undefined;

  // ---- aplikasi ----
  ipcMain.handle('app:openExternal', (event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      try { shell.openExternal(url); } catch {}
    }
    return { ok: true };
  });

  // ---- worker ----
  ipcMain.handle('worker:start', async () => { const s = await worker.start(); push('worker', s); return s; });
  ipcMain.handle('worker:stop', () => { const s = worker.stop(null); push('worker', s); return s; });
  ipcMain.handle('worker:status', () => worker.getStatus());
  ipcMain.handle('worker:login', (event, platform) => {
    scraper.openLogin(platform);
    return { ok: true };
  });

  // ---- data baca ----
  ipcMain.handle('data:summary', (event, auditId) => db.getSummary(auditId));
  ipcMain.handle('data:audits', () => db.getAudits());
  ipcMain.handle('data:targets', (event, params) => db.getTargets(params || {}));
  ipcMain.handle('data:accounts', (event, params) => db.getAccountIntel(params || {}));
  ipcMain.handle('data:accountDetail', (event, payload) => db.getAccountDetail(payload.username, payload.platform));
  ipcMain.handle('data:targetHistory', (event, targetId) => db.getTargetHistory(targetId));
  ipcMain.handle('data:latest', (event, params) => db.getLatest((params && params.limit) || 20, params && params.auditId));
  ipcMain.handle('data:compare', (event, params) => db.getCompare((params && params.months) || 6, params && params.period));
  ipcMain.handle('data:search', (event, q) => db.searchData(q, 20));

  // ---- impor (membuka dialog native) ----
  function dlg(win, fn, options) {
    return win ? fn(win, options) : fn(options);
  }
  async function pickImportFile(event) {
    const result = await dlg(parentOf(event), dialog.showOpenDialog, {
      title: 'Pilih file target',
      properties: ['openFile'],
      filters: [
        { name: 'Spreadsheet', extensions: ['csv', 'xlsx'] },
        { name: 'CSV', extensions: ['csv'] },
        { name: 'Excel', extensions: ['xlsx'] },
      ],
    });
    if (!result || result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  }

  ipcMain.handle('data:createAudit', async (event, opts = {}) => {
    const filePath = await pickImportFile(event);
    if (!filePath) return { canceled: true };
    const parsed = await require('./import').parseImportFile(filePath);
    if (!parsed) return { error: "Kolom 'Link'/'URL' tidak ditemukan." };
    const name = (opts.name || '').trim() || path.basename(filePath, path.extname(filePath)).replace(/_/g, ' ').trim() || 'Audit baru';
    const result = db.createAuditWithTasks(parsed.tasks, {
      name, repeatDays: opts.repeat_days, period: opts.period, sourceFilename: path.basename(filePath),
    });
    dataChanged();
    return { ...result, skipped: parsed.empty_rows + parsed.invalid_urls, invalid_urls: parsed.invalid_urls, empty_rows: parsed.empty_rows, truncated: parsed.truncated };
  });

  ipcMain.handle('data:appendTargets', async (event, opts = {}) => {
    if (!opts.auditId) return { error: 'auditId wajib diisi.' };
    const filePath = await pickImportFile(event);
    if (!filePath) return { canceled: true };
    const parsed = await require('./import').parseImportFile(filePath);
    if (!parsed) return { error: "Kolom 'Link'/'URL' tidak ditemukan." };
    try {
      const result = db.appendTargetsToAudit(Number(opts.auditId), parsed.tasks, { sourceFilename: path.basename(filePath) });
      dataChanged();
      return { ...result, skipped: parsed.empty_rows + parsed.invalid_urls, invalid_urls: parsed.invalid_urls, empty_rows: parsed.empty_rows };
    } catch (e) {
      return { error: 'Audit yang dipilih tidak ditemukan.' };
    }
  });

  ipcMain.handle('data:importLinks', (event, opts = {}) => {
    const parsed = require('./import').parseLinksText(opts.text);
    if (!parsed.tasks.length) {
      return { error: `Tidak ada link valid. ${parsed.invalid_urls || 0} baris tidak dikenali sebagai postingan IG/TikTok.` };
    }
    const auditId = opts.auditId ? Number(opts.auditId) : null;
    let result;
    if (auditId) {
      try {
        result = db.appendTargetsToAudit(auditId, parsed.tasks, { sourceFilename: 'tempel-link' });
      } catch (e) {
        return { error: 'Audit tujuan tidak ditemukan.' };
      }
      if (!result) return { error: 'Audit tujuan tidak ditemukan.' };
    } else {
      const name = (opts.name || '').trim() || 'Audit tempel link';
      const repeatDays = opts.repeat_days;
      result = db.createAuditWithTasks(parsed.tasks, { name, repeatDays, period: opts.period, sourceFilename: 'tempel-link' });
    }
    dataChanged();
    return { ...result, invalid_urls: parsed.invalid_urls, empty_rows: parsed.empty_rows, skipped: parsed.invalid_urls };
  });

  // ---- data tulis ----
  ipcMain.handle('data:rerun', (event, { auditId, full }) => {
    const r = db.enqueueRun(Number(auditId), 'manual', Boolean(full));
    if (!r) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return r;
  });
  ipcMain.handle('data:retryFailed', (event, auditId) => {
    const r = db.retryFailedTargets(Number(auditId));
    if (!r) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return r;
  });
  ipcMain.handle('data:retryTargets', (event, { auditId, ids }) => {
    const r = db.retryTargets(Number(auditId), ids);
    if (!r) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return r;
  });
  ipcMain.handle('data:profileVisits', (event, auditId) => {
    const r = db.enqueueProfileVisits(Number(auditId));
    if (!r) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return r;
  });
  ipcMain.handle('data:updateAudit', (event, { auditId, patch }) => {
    const a = db.updateAudit(Number(auditId), patch || {});
    if (!a) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return { audit: a };
  });
  ipcMain.handle('data:deleteAudit', (event, auditId) => {
    const ok = db.deleteAudit(Number(auditId));
    dataChanged();
    return { ok };
  });
  ipcMain.handle('data:clearAll', () => {
    db.clearAll();
    dataChanged();
    return { ok: true };
  });

  // ---- export ----
  ipcMain.handle('data:export', async (event, { auditId, status } = {}) => {
    const rows = db.getExportRows(auditId || null, status || null);
    if (!rows.length) {
      return { error: status === 'FAILED' ? 'Belum ada snapshot gagal untuk diexport.'
        : status ? `Belum ada snapshot berstatus ${status} untuk diexport.`
        : 'Belum ada hasil untuk diexport.' };
    }
    const defaultName = `sunscraping_export_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-').replace(/-/g, '')}.xlsx`;
    const result = await dlg(parentOf(event), dialog.showSaveDialog, { title: 'Simpan export', defaultPath: defaultName, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      const out = await require('./export').writeExport(db, { auditId: auditId || null, status: status || null, filePath: result.filePath });
      return { ok: true, rows: out.rows, filePath: out.filePath };
    } catch (e) {
      return { error: e.message };
    }
  });

  // ---- database ----
  ipcMain.handle('db:info', () => db.getDatabaseInfo());
  ipcMain.handle('db:backup', async (event) => {
    const result = await dlg(parentOf(event), dialog.showSaveDialog, {
      title: 'Simpan cadangan database',
      defaultPath: `sunscraping_db_${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      db.backupDatabase(result.filePath);
      return { ok: true, filePath: result.filePath };
    } catch (e) {
      return { error: e.message };
    }
  });

  return { dataChanged };
}

module.exports = { registerIpc };