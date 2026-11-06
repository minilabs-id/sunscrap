'use strict';
/**
 * sunscrap — backend/ipc/system
 * Handler IPC untuk pembaruan, aplikasi, dan basis data (info/backup/restore).
 */

const { ipcMain, dialog, shell } = require('electron');

function registerSystemIpc(ctx) {
  const { db, worker, updater, h } = ctx;
  const { parentOf, dlg, dataChanged } = h;

  // ---- pembaruan (GitHub Releases) ----
  ipcMain.handle('update:state', () => (updater && typeof updater.getState === 'function'
    ? updater.getState()
    : { enabled: false, version: '?', status: 'dev' }));
  ipcMain.handle('update:check', async () => (updater && typeof updater.checkNow === 'function' ? updater.checkNow() : null));
  ipcMain.handle('update:install', () => (updater && typeof updater.installNow === 'function' ? { ok: updater.installNow() } : { ok: false }));

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

  /**
   * Cek status login IG/TikTok dari cookie sesi di partisi tersembunyi.
   * Mengembalikan BOOLEAN saja (tidak mengekspos nilai cookie).
   */
  ipcMain.handle('app:loginStatus', async () => {
    const { session } = require('electron');
    try {
      const part = session.fromPartition('persist:sunscrap');
      const cookies = await part.cookies.get({});
      const has = (domainMatch, names) => cookies.some((c) =>
        domainMatch.test(c.domain) && names.includes(c.name));
      return {
        instagram: has(/instagram\.com/i, ['sessionid', 'ds_user_id']),
        tiktok: has(/tiktok\.com/i, ['sid_tt', 'sid_guard', 'sessionid']),
      };
    } catch {
      return { instagram: false, tiktok: false };
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
}

module.exports = registerSystemIpc;
