/**
 * sunscraping — content/common
 * Disuntik ke isolated world BrowserWindow. Helper murni untuk scraper IG & TikTok.
 * Tanpa akses chrome.*; hasil dipasang di globalThis.SA_CONTENT untuk dipakai scraper.
 */
(function () {
  'use strict';

  const COUNTER_SUFFIXES = [
    ['billion', 1e9],
    ['million', 1e6],
    ['thousand', 1e3],
    ['miliar', 1e9], ['milyar', 1e9],
    ['juta', 1e6], ['ribu', 1e3],
    ['mn', 1e6], ['jt', 1e6], ['rb', 1e3],
    ['k', 1e3], ['m', 1e6], ['b', 1e9],
  ];

  function suffixMultiplier(textAfterNumber) {
    const token = textAfterNumber.trim().toLowerCase();
    const hit = COUNTER_SUFFIXES.find(([name]) => token.startsWith(name));
    return hit ? hit[1] : 1;
  }

  function numberFromDigits(raw, hasSuffix) {
    const digits = raw.replace(/^[.,]+/, '').replace(/[.,]+$/, '');
    if (!digits) return null;
    const separators = digits.match(/[.,]/g);
    if (!separators) return parseFloat(digits);
    const parts = digits.split(/[.,]/);
    const tail = parts[parts.length - 1];
    if (separators.length > 1) {
      const groupsThousands = parts.slice(1).every((part) => part.length === 3);
      return parseFloat(groupsThousands ? parts.join('') : parts.join('.'));
    }
    const groupsThousands = tail.length === 3 && !hasSuffix;
    return parseFloat(groupsThousands ? parts.join('') : `${parts[0]}.${tail}`);
  }

  /** Parse counter yang dirender/JSON menjadi integer. */
  function parseCount(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    const text = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
    const match = text.match(/\d[\d.,]*|\.\d[\d.,]*/);
    if (!match) return null;
    const rest = text.slice(match.index + match[0].length);
    const multiplier = suffixMultiplier(rest);
    const number = numberFromDigits(match[0], multiplier !== 1);
    if (number === null || !Number.isFinite(number)) return null;
    return Math.round(number * multiplier);
  }

  /** Pangkas per code point (tidak memecah surrogate pair emoji). */
  function truncateText(text, maxChars) {
    if (text === null || text === undefined) return null;
    const chars = Array.from(String(text));
    return chars.length > maxChars ? chars.slice(0, maxChars).join('') : String(text);
  }

  const COUNTER_LABEL_METRICS = [
    ['comments', /comment|komentar/i],
    ['shares', /share|bagikan|sebarkan|berbagi/i],
    ['likes', /like|suka|heart/i],
  ];
  const NON_COUNTER_LABEL = /favorite|bookmark|duet|stitch|report|qrcode|whatsapp|copy/i;

  function metricFromLabel(text) {
    if (!text || typeof text !== 'string') return null;
    if (NON_COUNTER_LABEL.test(text)) return null;
    const hit = COUNTER_LABEL_METRICS.find(([, pattern]) => pattern.test(text));
    return hit ? hit[0] : null;
  }

  function errorResult(platform, url, error) {
    const detail = error && (error.message || error.name) ? String(error.message || error.name) : String(error);
    return {
      platform, url, username: null,
      likes: null, comments: null, views: null, shares: null,
      caption: null, postDate: null, followerCount: null,
      status: 'FAILED', errorCode: 'TRANSIENT',
      error: truncateText(`Content script error: ${detail}`, 300),
      source: 'error', scrapedAt: new Date().toISOString(),
    };
  }

  const RECENT_POST_LIMIT = 10;

  function toIsoTime(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = typeof value === 'string' ? value.trim() : value;
    let date;
    if (typeof raw === 'number' || /^\d{9,13}$/.test(String(raw))) {
      let seconds = Number(raw);
      if (seconds > 1e11) seconds = Math.floor(seconds / 1000);
      date = new Date(seconds * 1000);
    } else {
      date = new Date(String(raw));
    }
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function recentPosts(list, limit) {
    const cap = Number.isFinite(limit) && limit > 0 ? limit : RECENT_POST_LIMIT;
    const posts = [];
    if (!Array.isArray(list)) return posts;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const id = entry.id === null || entry.id === undefined ? null : String(entry.id).trim();
      const url = entry.url ? String(entry.url).trim() : null;
      if (!id && !url) continue;
      posts.push({
        id: id || null,
        url: url || null,
        postedAt: toIsoTime(entry.postedAt ?? entry.createTime ?? entry.timestamp ?? entry.date ?? entry.taken_at ?? entry.taken_at_timestamp),
        likes: parseCount(entry.likes),
        comments: parseCount(entry.comments),
        shares: parseCount(entry.shares),
        views: parseCount(entry.views),
        caption: truncateText(entry.caption, 500),
        isVideo: entry.isVideo === null || entry.isVideo === undefined ? null : Boolean(entry.isVideo),
      });
      if (posts.length >= cap) break;
    }
    return posts;
  }

  globalThis.SA_CONTENT = {
    parseCount, truncateText, metricFromLabel, errorResult, recentPosts, toIsoTime, RECENT_POST_LIMIT,
  };
})();