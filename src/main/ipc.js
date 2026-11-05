'use strict';
/**
 * sunscrap — ipc
 * Mendaftarkan handler ipcMain untuk seluruh permukaan renderer. Operasi tulis
 * memicu broadcast 'data' agar dashboard menyegarkan diri.
 */

const { ipcMain, dialog, shell, BrowserWindow, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function registerIpc({ db, worker, scraper, broadcast, limiter, avatarDir }) {
  const push = (type, payload) => {
    try { broadcast(type, payload); } catch {}
  };
  const dataChanged = () => push('data', { ts: Date.now() });
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const SAFE = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const { cleanUsername } = require('./util');

  function purgeAvatarFiles(platform, username) {
    if (!avatarDir || !platform || !username) return;
    const prefix = `${platform}_${SAFE(cleanUsername(username) || username)}.`;
    try {
      for (const f of fs.readdirSync(avatarDir)) {
        if (f.startsWith(prefix)) { try { fs.unlinkSync(path.join(avatarDir, f)); } catch {} }
      }
    } catch {}
  }
  function purgeAllAvatars() {
    if (!avatarDir) return;
    try {
      for (const f of fs.readdirSync(avatarDir)) { try { fs.unlinkSync(path.join(avatarDir, f)); } catch {} }
    } catch {}
  }

  const parentOf = (event) => BrowserWindow.fromWebContents(event.sender) || undefined;

  // ---- aplikasi ----
  ipcMain.handle('app:openExternal', (event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      try { shell.openExternal(url); } catch {}
    }
    return { ok: true };
  });

  ipcMain.handle('app:clearSession', async () => {
    const { session } = require('electron');
    try {
      await session.fromPartition('persist:sunscrap').clearStorageData();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---- worker ----
  ipcMain.handle('worker:start', async () => { const s = await worker.start(); push('worker', s); return s; });
  ipcMain.handle('worker:stop', () => { const s = worker.stop(null); push('worker', s); return s; });
  ipcMain.handle('worker:status', () => worker.getStatus());
  ipcMain.handle('worker:login', (event, platform) => {
    if (platform !== 'instagram' && platform !== 'tiktok') return { error: 'platform tidak valid' };
    scraper.openLogin(platform);
    return { ok: true };
  });

  // ---- data baca ----
  ipcMain.handle('data:queueStats', () => db.getQueueStats());
  ipcMain.handle('data:summary', (event, auditId) => {
    if (auditId === null || auditId === undefined) return db.getSummary(null);
    const id = num(auditId);
    return id === null ? null : db.getSummary(id);
  });
  ipcMain.handle('data:audits', () => db.getAudits());
  ipcMain.handle('data:targets', (event, params) => db.getTargets(typeof params === 'object' && params !== null ? params : {}));
  ipcMain.handle('data:accounts', (event, params) => db.getAccountIntel(typeof params === 'object' && params !== null ? params : {}));
  ipcMain.handle('data:accountDetail', (event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const username = typeof p.username === 'string' ? p.username : '';
    const platform = p.platform === 'instagram' || p.platform === 'tiktok' ? p.platform : undefined;
    if (!username.trim()) return null;
    try { return db.getAccountDetail(username, platform); } catch { return null; }
  });
  ipcMain.handle('data:targetHistory', (event, targetId) => { const id = num(targetId); return id === null ? [] : db.getTargetHistory(id); });
  ipcMain.handle('data:latest', (event, params) => {
    const limit = num(params && params.limit) || 20;
    const aid = params && params.auditId != null ? num(params.auditId) : null;
    return db.getLatest(limit, aid);
  });
  ipcMain.handle('data:compare', (event, params) => db.getCompare(num(params && params.months) || 6, params && params.period));
  ipcMain.handle('data:search', (event, q) => db.searchData(q, 20));

  ipcMain.handle('account:delete', (event, payload) => {
    const { platform, username } = (payload && typeof payload === 'object') ? payload : {};
    const ok = db.deleteAccount(platform, username);
    if (ok) { purgeAvatarFiles(platform, username); dataChanged(); }
    return { ok };
  });

  // ---- impor (membuka dialog native) ----
  function dlg(win, fn, options) {
    return win ? fn(win, options) : fn(options);
  }
  async function pickImportFile(event) {
    // Kait uji: jalur file tanpa dialog native (hanya saat dev, bukan packaged).
    if (!app.isPackaged && process.env.SA_IMPORT_FILE) {
      const hooked = path.resolve(process.env.SA_IMPORT_FILE);
      if (fs.existsSync(hooked)) return hooked;
    }
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
    const auditId = num(opts.auditId);
    if (auditId === null) return { error: 'auditId wajib diisi (angka).' };
    const filePath = await pickImportFile(event);
    if (!filePath) return { canceled: true };
    const parsed = await require('./import').parseImportFile(filePath);
    if (!parsed) return { error: "Kolom 'Link'/'URL' tidak ditemukan." };
    try {
      const result = db.appendTargetsToAudit(auditId, parsed.tasks, { sourceFilename: path.basename(filePath) });
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
    const auditId = opts.auditId ? num(opts.auditId) : null;
    if (opts.auditId && auditId === null) return { error: 'auditId tidak valid.' };
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
    return { ...result, invalid_urls: parsed.invalid_urls, empty_rows: parsed.empty_rows, truncated: parsed.truncated, skipped: parsed.invalid_urls };
  });

  // ---- data tulis ----
  ipcMain.handle('data:rerun', (event, { auditId, full } = {}) => {
    const id = num(auditId);
    if (id === null) return { error: 'auditId tidak valid.' };
    const r = db.enqueueRun(id, 'manual', Boolean(full));
    if (!r) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return r;
  });
  ipcMain.handle('data:retryFailed', (event, auditId) => {
    const id = num(auditId);
    if (id === null) return { error: 'auditId tidak valid.' };
    const r = db.retryFailedTargets(id);
    if (!r) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return r;
  });
  ipcMain.handle('data:retryTargets', (event, { auditId, ids } = {}) => {
    const id = num(auditId);
    if (id === null) return { error: 'auditId tidak valid.' };
    const r = db.retryTargets(id, ids);
    if (!r) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return r;
  });
  ipcMain.handle('data:profileVisits', (event, auditId) => {
    const id = num(auditId);
    if (id === null) return { error: 'auditId tidak valid.' };
    const r = db.enqueueProfileVisits(id);
    if (!r) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return r;
  });
  ipcMain.handle('data:updateAudit', (event, { auditId, patch } = {}) => {
    const id = num(auditId);
    if (id === null) return { error: 'auditId tidak valid.' };
    const a = db.updateAudit(id, patch || {});
    if (!a) return { error: 'Audit tidak ditemukan.' };
    dataChanged();
    return { audit: a };
  });
  ipcMain.handle('data:deleteAudit', (event, auditId) => {
    const id = num(auditId);
    if (id === null) return { error: 'auditId tidak valid.' };
    const ok = db.deleteAudit(id);
    dataChanged();
    return { ok };
  });
  ipcMain.handle('data:clearAll', () => {
    db.clearAll();
    // Reset budget throttle & hapus seluruh avatar lokal — "Hapus semua data" harus benar-benar semua.
    try { if (limiter && typeof limiter.resetCounters === 'function') limiter.resetCounters(); } catch {}
    purgeAllAvatars();
    dataChanged();
    return { ok: true };
  });

  // ---- export ----
  ipcMain.handle('data:exportCount', (event, { auditId, status } = {}) => {
    const aid = auditId == null ? null : num(auditId);
    return db.getExportCount(aid, status || null);
  });
  ipcMain.handle('data:export', async (event, { auditId, status } = {}) => {
    const aid = auditId == null ? null : num(auditId);
    const rows = db.getExportRows(aid, status || null);
    if (!rows.length) {
      return { error: status === 'FAILED' ? 'Belum ada snapshot gagal untuk diexport.'
        : status ? `Belum ada snapshot berstatus ${status} untuk diexport.`
        : 'Belum ada hasil untuk diexport.' };
    }
    const defaultName = `sunscrap_export_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-').replace(/-/g, '')}.xlsx`;
    const result = await dlg(parentOf(event), dialog.showSaveDialog, { title: 'Simpan export', defaultPath: defaultName, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      const out = await require('./export').writeExport(db, { auditId: aid, status: status || null, filePath: result.filePath });
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
      defaultPath: `sunscrap_db_${new Date().toISOString().slice(0, 10)}.db`,
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

  ipcMain.handle('db:restorePreview', async (event) => {
    const result = await dlg(parentOf(event), dialog.showOpenDialog, {
      title: 'Pilih cadangan database',
      properties: ['openFile'],
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'backup'] }],
    });
    if (!result || result.canceled || !result.filePaths.length) return { canceled: true };
    try {
      const info = db.inspectBackup(result.filePaths[0]);
      return { ok: true, ...info, path: result.filePaths[0] };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:restoreCommit', (event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { error: 'path tidak valid' };
    try {
      worker.stop('Memulihkan cadangan database…');
      const r = db.restoreDatabase(filePath);
      dataChanged();
      return { ok: true, safety_backup: r.safety, safety_path: r.safety_path };
    } catch (e) {
      return { error: e.message };
    }
  });

  return { dataChanged };
}

module.exports = { registerIpc };