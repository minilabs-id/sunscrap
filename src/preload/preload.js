'use strict';
/**
 * sunscrap — preload
 * Jembatan aman renderer ↔ proses utama via contextBridge. Renderer tidak pernah
 * menyentuh Node/ipcRenderer langsung.
 */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('sunscrap', {
  // worker
  workerStart: () => invoke('worker:start'),
  workerStop: () => invoke('worker:stop'),
  workerStatus: () => invoke('worker:status'),
  openLogin: (platform) => invoke('worker:login', platform),

  // data (baca)
  getSummary: (auditId) => invoke('data:summary', auditId),
  getQueueStats: () => invoke('data:queueStats'),
  getAudits: () => invoke('data:audits'),
  getTargets: (params) => invoke('data:targets', params),
  getAccounts: (params) => invoke('data:accounts', params),
  getAccountDetail: (platform, username) => invoke('data:accountDetail', { platform, username }),
  deleteAccount: (platform, username) => invoke('account:delete', { platform, username }),
  getTargetHistory: (targetId) => invoke('data:targetHistory', targetId),
  getLatest: (params) => invoke('data:latest', params),
  getCompare: (params) => invoke('data:compare', params),
  search: (q) => invoke('data:search', q),

  // data (tulis)
  createAudit: (opts) => invoke('data:createAudit', opts),
  appendTargets: (opts) => invoke('data:appendTargets', opts),
  importLinks: (opts) => invoke('data:importLinks', opts),
  rerunAudit: (auditId, full) => invoke('data:rerun', { auditId, full }),
  retryFailed: (auditId) => invoke('data:retryFailed', auditId),
  retryTargets: (auditId, ids) => invoke('data:retryTargets', { auditId, ids }),
  enqueueProfileVisits: (auditId) => invoke('data:profileVisits', auditId),
  updateAudit: (auditId, patch) => invoke('data:updateAudit', { auditId, patch }),
  deleteAudit: (auditId) => invoke('data:deleteAudit', auditId),
  clearAll: () => invoke('data:clearAll'),
  exportExcel: (opts) => invoke('data:export', opts),
  exportCount: (opts) => invoke('data:exportCount', opts),

  // database
  dbInfo: () => invoke('db:info'),
  dbBackup: () => invoke('db:backup'),
  restorePreview: () => invoke('db:restorePreview'),
  restoreCommit: (path) => invoke('db:restoreCommit', path),

  // events push
  onEvent: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('evt', handler);
    return () => ipcRenderer.removeListener('evt', handler);
  },

  // aplikasi
  setTheme: (theme) => invoke('app:theme', theme),
  openExternal: (url) => invoke('app:openExternal', url),
  clearSession: () => invoke('app:clearSession'),
  copyDiagnostics: () => invoke('app:copyDiagnostics'),
  openDataFolder: () => invoke('app:openDataFolder'),
});