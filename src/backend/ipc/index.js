'use strict';
/**
 * sunscrap — backend/ipc
 * Titik registrasi seluruh handler IPC. Membagi permukaan ke tiga domain:
 *   - data.js   : worker, antrean, audit, import/export, database rows
 *   - system.js : pembaruan, aplikasi, info/backup/restore database
 *   - review.js : tinjauan manual + hapus akun
 * Semua handler mendelegasikan ke core/services; tidak ada logika bisnis di sini.
 */

const { createHelpers } = require('./helpers');
const registerDataIpc = require('./data');
const registerSystemIpc = require('./system');
const registerReviewIpc = require('./review');

function registerIpc(deps) {
  const h = createHelpers(deps);
  const ctx = { ...deps, h };
  registerDataIpc(ctx);
  registerSystemIpc(ctx);
  registerReviewIpc(ctx);
  return { dataChanged: h.dataChanged };
}

module.exports = { registerIpc };
