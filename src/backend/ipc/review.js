'use strict';
/**
 * sunscrap — backend/ipc/review
 * Handler IPC untuk tinjauan manual (keputusan pada akun terindikasi)
 * dan penghapusan data akun.
 */

const { ipcMain } = require('electron');

const reviewKey = (platform, username) => `${platform}:${username}`;

function registerReviewIpc(ctx) {
  const { db, reviewStore, h } = ctx;
  const { dataChanged, purgeAvatarFiles } = h;

  ipcMain.handle('review:list', () => (reviewStore ? reviewStore.get(null) : {}));
  ipcMain.handle('review:set', (event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const platform = p.platform === 'instagram' || p.platform === 'tiktok' ? p.platform : null;
    const username = typeof p.username === 'string' ? p.username : '';
    const decision = ['bookmark', 'clear', 'flag'].includes(p.decision) ? p.decision : null;
    if (!platform || !username || !decision) return { ok: false, error: 'data tinjauan tidak valid' };
    if (!reviewStore) return { ok: false, error: 'penyimpanan tinjauan tidak tersedia' };
    reviewStore.set({ [reviewKey(platform, username)]: { decision, note: typeof p.note === 'string' ? p.note.slice(0, 500) : '', at: new Date().toISOString() } });
    return { ok: true };
  });
  ipcMain.handle('review:delete', (event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const platform = p.platform === 'instagram' || p.platform === 'tiktok' ? p.platform : null;
    const username = typeof p.username === 'string' ? p.username : '';
    if (!platform || !username) return { ok: false, error: 'data tinjauan tidak valid' };
    if (reviewStore) reviewStore.remove([reviewKey(platform, username)]);
    return { ok: true };
  });

  ipcMain.handle('account:delete', (event, payload) => {
    const { platform, username } = (payload && typeof payload === 'object') ? payload : {};
    const ok = db.deleteAccount(platform, username);
    if (ok) { purgeAvatarFiles(platform, username); dataChanged(); }
    return { ok };
  });
}

module.exports = registerReviewIpc;
