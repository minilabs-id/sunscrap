'use strict';
/**
 * sunscrap — renderer/format
 * Helper pemformat & pure function yang di-ekstrak dari app.js agar bisa
 * diuji terpisah lewat `node --test` tanpa DOM.
 *
 * Pola pemuatan ganda (tanpa bundler, tetap CSP `script-src 'self'`):
 *   - Di renderer: dimuat sebagai <script> sebelum app.js → fungsi menempel
 *     di global (window.fmt, window.esc, dst.) dan dipakai app.js apa adanya.
 *   - Di node --test: diekspor sebagai CommonJS (module.exports).
 */
(function (root) {
  // ---------- helpers ----------
  function fmt(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('id-ID');
  }
  function fmtPct(n, decimals = 1) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%';
  }
  function idID(v, d = 1) {
    return Number(v).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: d });
  }
  function fmtCompact(n) {
    if (n === null || n === undefined) return '—';
    const abs = Math.abs(Number(n));
    if (!Number.isFinite(abs)) return '—';
    if (abs >= 1e9) return idID(n / 1e9, 2) + ' M';
    if (abs >= 1e6) return idID(n / 1e6, 2) + ' jt';
    if (abs >= 1e3) return idID(n / 1e3, 1) + ' rb';
    return idID(n, 0);
  }
  function fmtJuta(n) {
    if (n === null || n === undefined) return { value: '—', unit: '' };
    const abs = Math.abs(Number(n));
    if (abs >= 1e9) return { value: idID(n / 1e9, 2), unit: ' miliar' };
    if (abs >= 1e6) return { value: idID(n / 1e6, 2), unit: ' juta' };
    if (abs >= 1e3) return { value: idID(n / 1e3, 0), unit: ' ribu' };
    return { value: idID(n, 0), unit: '' };
  }
  function parseWhen(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function fmtWhen(iso) {
    const d = parseWhen(iso);
    if (!d) return '—';
    return d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
  }
  function relTime(iso) {
    const d = parseWhen(iso);
    if (!d) return '—';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    return Math.floor(s / 86400) + ' hari lalu';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function shortUrl(url) { try { return new URL(url).pathname.slice(0, 40); } catch { return url; } }
  function fmtDayShort(isoDate) {
    const d = new Date(isoDate + 'T00:00:00Z');
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }
  function fmtDateFull(isoDate) {
    const d = new Date(isoDate + 'T00:00:00Z');
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function sum(arr) { return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0); }
  function delta7(series) {
    const v = series || [];
    if (v.length < 14) return null;
    const a = sum(v.slice(-14, -7));
    const b = sum(v.slice(-7));
    if (!a) return b ? 100 : null;
    return Math.round(((b - a) / a) * 1000) / 10;
  }
  function signedPct(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    if (Math.abs(n) < 0.05) return '0,0%';
    const sign = n > 0 ? '▲' : '▼';
    return `${sign}${Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }
  function deltaClass(n) {
    if (n === null || n === undefined || !Number.isFinite(n) || Math.abs(n) < 0.05) return 'flat';
    return n > 0 ? 'good' : 'bad';
  }
  function deltaBadge(n) {
    if (n === null || n === undefined) return '<span class="muted">—</span>';
    const sign = n > 0 ? '▲' : n < 0 ? '▼' : '–';
    const cls = n > 0 ? 'good' : n < 0 ? 'bad' : 'flat';
    return `<span class="delta ${cls}">${sign}${fmt(Math.abs(n))}</span>`;
  }
  function sparklinePoints(values, width = 78, height = 24) {
    const vals = (values || []).map((v) => Number(v) || 0);
    if (vals.length < 2) return '';
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const step = width / (vals.length - 1);
    return vals.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 6)).toFixed(1)}`).join(' ');
  }
  function emptyState(title, sub, ctaHtml = '') {
    return `<div class="empty"><b>${esc(title)}</b><span class="muted">${esc(sub)}</span>${ctaHtml ? `<div style="margin-top:12px">${ctaHtml}</div>` : ''}</div>`;
  }
  function idOf(text, fallback = 'x') { return String(text || fallback).replace(/[^a-z0-9_-]/gi, '-'); }

  const api = {
    fmt, fmtPct, idID, fmtCompact, fmtJuta, parseWhen, fmtWhen, relTime, esc,
    shortUrl, fmtDayShort, fmtDateFull, sum, delta7, signedPct, deltaClass,
    deltaBadge, sparklinePoints, emptyState, idOf,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);