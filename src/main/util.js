'use strict';
/**
 * sunscraping — util
 * Helper murni (tanpa Electron, tanpa DB) yang dipakai lintas modul:
 * pembersihan teks/angka, username kanonik, tanggal UTC, dan normalisasi URL target.
 */

// ---- Waktu ----
function utcNow() {
  return new Date();
}

/** ISO 8601 dengan akhiran Z, presisi detik — dipakai sebagai `scraped_at`. */
function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Bentuk `YYYY-MM-DD HH:MM:SS` untuk kolom SQLite yang dibandingkan SQL date-fn. */
function sqlNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Parse berbagai bentuk waktu menjadi Date (UTC) atau null. */
function parseUtc(value) {
  if (!value) return null;
  let text = String(value).trim();
  if (!text) return null;
  if (text.endsWith('Z')) text = text.slice(0, -1) + '+00:00';
  let d;
  try {
    d = new Date(text);
  } catch {
    return null;
  }
  if (Number.isNaN(d.getTime())) {
    // coba bentuk "YYYY-MM-DD HH:MM:SS" tanpa zona
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- Teks ----
/** Bersihkan lone surrogate (emoji terpotong) dan pangkas; konversi ke null bila kosong. */
function cleanText(value, maxLen) {
  if (value === null || value === undefined) return null;
  let text = typeof value === 'string' ? value : String(value);
  // Hapus lone surrogate dengan mengganti pasangan yang rusak.
  text = text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  text = text.trim();
  if (!text) return null;
  if (maxLen) text = Array.from(text).slice(0, maxLen).join('');
  return text || null;
}

const USERNAME_JUNK = /\s*[\(\[\{].*$/;

/** Kanonik handle akun: buang @ dan keterangan "(TikTok)" dll, lowercase. */
function cleanUsername(value) {
  const text = cleanText(value, 100);
  if (!text) return null;
  const stripped = text.replace(/^@+/, '').replace(USERNAME_JUNK, '').trim();
  return stripped.toLowerCase() || null;
}

/** Angka bulat non-negatif dari nilai longgar, atau null. */
function cleanInt(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 0 ? r : null;
}

// ---- Angka / format ----
function toNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && !Number.isNaN(n) ? n : null;
}

function parseRepeatDays(value) {
  try {
    const n = parseInt(String(value), 10);
    if (Number.isNaN(n)) return null;
    return Math.max(0, Math.min(365, n));
  } catch {
    return null;
  }
}

function clampLimit(value, lo, hi, def) {
  const n = parseInt(value || def, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

/** Format integer gaya Indonesia: 1.234.567. */
function displayInt(value) {
  const n = toNumber(value);
  if (n === null) return '—';
  return Math.round(n).toLocaleString('id-ID');
}

/** Format persen desimal koma: 12,5%. */
function displayPct(value, digits = 1) {
  const n = toNumber(value);
  if (n === null) return '—';
  return n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%';
}

/** Bulan key YYYY-MM, atau null. */
function cleanPeriod(value) {
  let text = String(value || '').trim();
  if (text.length === 10 && text[4] === '-' && text[7] === '-') text = text.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(text)) return null;
  const month = parseInt(text.slice(5, 7), 10);
  if (month < 1 || month > 12) return null;
  return text;
}

// ---- URL target ----
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const TIKTOK_HOSTS = new Set([
  'tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
]);
const TIKTOK_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
const INSTAGRAM_POST_SEGMENTS = new Set(['p', 'reel', 'reels', 'tv']);

function looksLikePost(platform, parsed) {
  const segments = (parsed.pathname || '').split('/').filter(Boolean);
  if (!segments.length) return false;
  if (platform === 'instagram') {
    // Terima /p/CODE, /reel/CODE (shared link) dan juga /user/p/CODE (dengan username).
    return segments.length >= 2 && (
      INSTAGRAM_POST_SEGMENTS.has(segments[0].toLowerCase())
      || (segments.length >= 3 && INSTAGRAM_POST_SEGMENTS.has(segments[1].toLowerCase()))
    );
  }
  const host = (parsed.hostname || '').toLowerCase();
  if (TIKTOK_SHORT_HOSTS.has(host)) return true;
  const head = segments[0].toLowerCase();
  if (head === 't' || head === 'v') return segments.length >= 2;
  return (
    segments.length >= 3
    && head.startsWith('@')
    && ['video', 'photo'].includes(segments[1].toLowerCase())
  );
}

/**
 * Normalisasi URL target menjadi { platform, url } atau null.
 * Hanya halaman postingan yang diterima (bukan link profil).
 */
function normalizeTargetUrl(raw) {
  if (raw === null || raw === undefined) return null;
  let value = String(raw).trim();
  if (!value || ['nan', 'none'].includes(value.toLowerCase())) return null;
  if (!/^https?:\/\//i.test(value)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(value)) value = 'https://' + value;
    else return null;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;

  const host = (parsed.hostname || '').toLowerCase();
  let platform;
  if (INSTAGRAM_HOSTS.has(host)) platform = 'instagram';
  else if (TIKTOK_HOSTS.has(host)) platform = 'tiktok';
  else return null;

  if (!looksLikePost(platform, parsed)) return null;
  parsed.hash = '';
  parsed.protocol = 'https:';
  const canonical = parsed.href;
  if (canonical.length > 2048) return null;
  return { platform, url: canonical };
}

/** Handle dari URL post (TikTok selalu, Instagram kadang). */
function usernameFromPostUrl(platform, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (platform === 'instagram' && segments.length >= 3) {
    if (INSTAGRAM_POST_SEGMENTS.has(segments[1].toLowerCase())) return cleanUsername(segments[0]);
    return null;
  }
  if (platform === 'tiktok') {
    if (segments.length && segments[0].startsWith('@')) return cleanUsername(segments[0].slice(1));
  }
  return null;
}

/** ID postingan stabil dari URL (shortcode/video id/path tail). */
function postRefFromUrl(url) {
  const text = cleanText(url, 300);
  if (!text) return null;
  const noQuery = text.split(/[?#]/)[0].replace(/\/+$/, '');
  const video = noQuery.match(/\/(?:video|photo)\/(\d+)/i);
  if (video) return video[1].toLowerCase();
  const shortcode = noQuery.match(/\/(?:p|reel|reels|tv)\/([^/]+)/i);
  if (shortcode) return shortcode[1].toLowerCase();
  const tail = noQuery.includes('/') ? noQuery.split('/').pop() : noQuery;
  return tail ? tail.toLowerCase() : null;
}

module.exports = {
  utcNow, isoNow, sqlNow, parseUtc,
  cleanText, cleanUsername, cleanInt, toNumber,
  parseRepeatDays, clampLimit, displayInt, displayPct, cleanPeriod,
  normalizeTargetUrl, usernameFromPostUrl, postRefFromUrl,
  INSTAGRAM_POST_SEGMENTS,
};