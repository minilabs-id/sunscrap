/**
 * sunscrap v2 — helpers (ESM)
 * Jembatan tipis ke helper murni dual-mode (format.js / store.js) yang dimuat
 * <script> klasik sebelum modul ini. Semua fungsi murni — tanpa DOM.
 */
const w = window;
const wrap = (name) => (...args) => w[name](...args);

// format.js
export const fmt = wrap('fmt');
export const fmtPct = wrap('fmtPct');
export const idID = wrap('idID');
export const fmtCompact = wrap('fmtCompact');
export const fmtJuta = wrap('fmtJuta');
export const parseWhen = wrap('parseWhen');
export const fmtWhen = wrap('fmtWhen');
export const relTime = wrap('relTime');
export const esc = wrap('esc');
export const shortUrl = wrap('shortUrl');
export const fmtDayShort = wrap('fmtDayShort');
export const fmtDateFull = wrap('fmtDateFull');
export const sum = wrap('sum');
export const delta7 = wrap('delta7');
export const signedPct = wrap('signedPct');
export const deltaClass = wrap('deltaClass');
export const deltaBadge = wrap('deltaBadge');
export const sparklinePoints = wrap('sparklinePoints');
export const emptyState = wrap('emptyState');
export const idOf = wrap('idOf');

// store.js
export const createState = wrap('createState');
export const densityForWidth = wrap('densityForWidth');
export const pageLabel = wrap('pageLabel');
export const nextOffset = wrap('nextOffset');
export const prevOffset = wrap('prevOffset');
export const toggleSort = wrap('toggleSort');
export const summarySignature = wrap('summarySignature');
export const reviewKey = wrap('reviewKey');
export const reviewMeta = wrap('reviewMeta');
export const reviewedDecisionCounts = wrap('reviewedDecisionCounts');
export const isNeedsReview = wrap('isNeedsReview');
export const riskScorePct = wrap('riskScorePct');

/** Bridge preload (window.sunscrap). */
export const api = w.sunscrap;
