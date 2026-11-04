'use strict';
/**
 * sunscrap — avatar
 * Unduh avatar profil sekali ke disk lokal agar renderer tidak pernah memanggil
 * CDN IG/TikTok (privasi) dan tidak bergantung URL bertanda tangan yang kedaluwarsa.
 */
const fs = require('node:fs');
const path = require('node:path');

function safeName(key) {
  return String(key || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'anon';
}

/** Unduh avatar ke avatarDir; return nama file lokal atau null. */
async function cacheAvatar(url, dir, key) {
  if (!url || !/^https?:\/\//i.test(url) || !dir) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const ext = ct.includes('png') ? '.png' : '.jpg';
    const name = safeName(key) + ext;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    return name;
  } catch {
    return null;
  }
}

/** Resolusi key → path lokal yang aman (anti path-traversal). */
function resolveAvatar(dir, name) {
  const base = path.basename(String(name || ''));
  if (!base || !dir) return null;
  const file = path.join(dir, base);
  return fs.existsSync(file) ? file : null;
}

module.exports = { cacheAvatar, resolveAvatar, safeName };