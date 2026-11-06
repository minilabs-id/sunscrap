'use strict';
/**
 * sunscrap — backend/ipc/helpers
 * Utilitas bersama untuk seluruh handler IPC: penomoran aman, push event,
 * dialog native, dan pembersihan avatar lokal.
 */

const { BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { cleanUsername } = require('../core/util');

function createHelpers({ broadcast, avatarDir }) {
  const push = (type, payload) => {
    try { broadcast(type, payload); } catch {}
  };
  const dataChanged = () => push('data', { ts: Date.now() });
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const SAFE = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_');

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
  /** Panggil dialog native dengan/tanpa window induk. */
  function dlg(win, fn, options) {
    return win ? fn(win, options) : fn(options);
  }

  return { push, dataChanged, num, SAFE, purgeAvatarFiles, purgeAllAvatars, parentOf, dlg };
}

module.exports = { createHelpers };
