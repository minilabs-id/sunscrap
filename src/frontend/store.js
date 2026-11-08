'use strict';
/**
 * sunscrap — renderer/store
 * State awal + helper turunan-keadaan (pagination, sort, density) yang murni
 * dan bisa diuji tanpa DOM. Dimuat sebelum app.js (CSP 'self', tanpa bundler).
 */
(function (root) {
  function createState() {
    return {
      tab: 'dashboard',
      audits: [],
      auditId: null,
      worker: null,
      summary: null,
      timeseries: null,
      timeseriesKey: null,
      targets: { items: [], total: 0, limit: 25, offset: 0, selected: new Set(), status: '', issue: '', sort: 'recent', dir: 'desc' },
      accounts: { items: [], total: 0, limit: 50, offset: 0, reviewOnly: false, incompleteOnly: false, staleOnly: false },
      accountsSummary: null,
      temaSort: 'views', // konsisten: dibaca/ditulis sebagai `temaSort` di seluruh app.js
      postsTab: 'views',
      metric: 'd_views',
      trendSeq: 0,
      dbInfoCache: null,
      searchSeq: 0,
      searchTimer: null,
      statusFilterActive: null,
      dashSig: null, // signature data dashboard terakhir dirender
      reviews: {}, // peta keputusan tinjauan manual: `${platform}:${username}` → {decision, note, at}
    };
  }

  function densityForWidth(w) {
    if (w >= 1680) return 'lapang';
    if (w >= 1280) return 'normal';
    return 'padat';
  }

  function pageLabel(offset, limit, total) {
    return `Hal ${Math.floor(offset / limit) + 1} / ${Math.max(1, Math.ceil(total / limit))}`;
  }

  function nextOffset(offset, limit, total) {
    return (offset + limit) < total ? offset + limit : offset;
  }

  function prevOffset(offset, limit) {
    return Math.max(0, offset - limit);
  }

  function toggleSort(currentSort, currentDir, key) {
    if (currentSort === key) {
      return { sort: key, dir: currentDir === 'desc' ? 'asc' : 'desc' };
    }
    // username diurutkan alfabetis (asc); kolom lain (numerik & "recent") menurun (desc).
    return { sort: key, dir: key === 'username' ? 'asc' : 'desc' };
  }

  // Fingerprint ringkas dari data yang mempengaruhi render Dashboard.
  // Dipakai untuk melewatkan re-render penuh saat polling dan data tak berubah.
  function summarySignature(summary, timeseries) {
    const s = summary || {};
    const k = s.kpi || {};
    const days = (timeseries && timeseries.days) || [];
    return JSON.stringify([
      s.generated_at == null ? null : s.generated_at,
      k.targets == null ? null : k.targets,
      k.scraped == null ? null : k.scraped,
      k.ok == null ? null : k.ok,
      k.partial == null ? null : k.partial,
      k.failed == null ? null : k.failed,
      k.pending == null ? null : k.pending,
      k.running == null ? null : k.running,
      k.verified == null ? null : k.verified,
      (k.totals && k.totals.views) == null ? null : k.totals.views,
      (k.totals && k.totals.likes) == null ? null : k.totals.likes,
      s.platforms == null ? null : s.platforms,
      s.temas == null ? null : s.temas,
      s.posts == null ? null : s.posts,
      s.quality == null ? null : s.quality,
      days.length,
      days.length ? days[days.length - 1] : null,
    ]);
  }

  function reviewKey(platform, username) {
    return `${platform || ''}:${username || ''}`;
  }

  // Meta tampilan untuk keputusan tinjauan manual (null bila belum ada keputusan).
  function reviewMeta(decision) {
    if (decision === 'bookmark') return { label: 'Ditandai', tone: 'warn', icon: '🔖' };
    if (decision === 'clear') return { label: 'Bersih', tone: 'ok', icon: '✔' };
    if (decision === 'flag') return { label: 'Dikonfirmasi', tone: 'err', icon: '✖' };
    return null;
  }

  // Hitung keputusan tinjauan per jenis; dipakai untuk mengurangi "perlu tinjauan"
  // dari akun yang sudah dibereskan (clear/flag).
  function reviewedDecisionCounts(reviews) {
    const counts = { clear: 0, flag: 0, bookmark: 0 };
    const map = reviews || {};
    for (const key in map) {
      const d = map[key] && map[key].decision;
      if (d === 'clear' || d === 'flag' || d === 'bookmark') counts[d]++;
    }
    return counts;
  }

  // Akun dikategorikan "perlu tinjauan" bila terindikasi (score>0) dan belum dijawab (clear/flag).
  function isNeedsReview(account, reviews) {
    if (!account || !(account.score > 0)) return false;
    const rec = (reviews || {})[reviewKey(account.platform, account.username)];
    return !(rec && (rec.decision === 'clear' || rec.decision === 'flag'));
  }

  // Skor risiko dinormalisasi ke 0..100: ambang "pola_kembar" (10 poin) = 100%.
  function riskScorePct(raw) {
    const n = Number(raw) || 0;
    return Math.round(Math.min(100, Math.max(0, n * 10)));
  }

  const api = { createState, densityForWidth, pageLabel, nextOffset, prevOffset, toggleSort, summarySignature, reviewKey, reviewMeta, reviewedDecisionCounts, isNeedsReview, riskScorePct };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);