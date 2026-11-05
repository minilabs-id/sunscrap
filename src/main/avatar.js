'use strict';
/**
 * sunscrap — avatar
 * Unduh avatar profil sekali ke disk lokal agar renderer tidak pernah memanggil
 * CDN IG/TikTok (privasi) dan tidak bergantung URL bertanda tangan yang kedaluwarsa.
 *
 * Pengerasan (T-1): https saja, allowlist host avatar CDN, batas ukuran 3 MB,
 * cek magic bytes, dan validasi host setelah redirect.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const AVATAR_HOST_SUFFIXES = [
  'cdninstagram.com', 'fbcdn.net', 'fbsbx.com', 'instagram.com',
  'tiktokcdn.com', 'tiktok.com', 'byteoversea.com', 'bytepcdn.com', 'byteimg.com',
];

function safeName(key) {
  return String(key || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'anon';
}

function hostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase();
  return AVATAR_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith('.' + suffix));
}

function magicExt(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  return null;
}

/** Unduh avatar ke avatarDir; return nama file lokal atau null. */
async function cacheAvatar(url, dir, key) {
  if (!url || !/^https:\/\//i.test(url) || !dir) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.username || parsed.password) return null;
  if (!hostAllowed(parsed.hostname)) return null; // URL apa pun dari halaman tidak diunduh
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (!res.ok) return null;
    // Setelah redirect, validasi ulang host tujuan akhir.
    if (res.url && !hostAllowed(new URL(res.url).hostname)) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_AVATAR_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > MAX_AVATAR_BYTES) return null;
    const ext = magicExt(buf);
    if (!ext) return null; // bukan JPEG/PNG sungguhan
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

module.exports = { cacheAvatar, resolveAvatar, safeName, hostAllowed, MAX_AVATAR_BYTES };
