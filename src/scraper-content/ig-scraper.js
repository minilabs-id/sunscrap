/**
 * sunscrap — content/ig-scraper
 * Membaca postingan/profil Instagram dari halaman yang sudah dirender.
 * Dipanggil lewat globalThis.__saScrapePost / __saScrapeProfile di isolated world.
 */
(function () {
  'use strict';
  const { parseCount, truncateText, errorResult, toIsoTime, recentPosts } = globalThis.SA_CONTENT;

  const COUNT_TOKEN = /[\d.,]+\s*(?:billion|million|thousand|miliar|milyar|juta|ribu|mn|jt|rb|[kKmMbB])?/;

  function waitForSelector(selector, timeout = 8000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el2 = document.querySelector(selector);
        if (el2) { observer.disconnect(); resolve(el2); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  function extractFromMetaTags() {
    const result = { likes: null, comments: null, views: null, username: null, caption: null, postDate: null };
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      const content = metaDesc.getAttribute('content') || '';
      const likesMatch = content.match(/([\d,.]+[KkMmBb]?)\s*Likes?/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Suka/i);
      if (likesMatch) result.likes = parseCount(likesMatch[1]);
      const commentsMatch = content.match(/([\d,.]+[KkMmBb]?)\s*Comments?/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Komentar/i);
      if (commentsMatch) result.comments = parseCount(commentsMatch[1]);
      const viewsMatch = content.match(/([\d,.]+[KkMmBb]?)\s*Views?/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Tayangan/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Plays?/i);
      if (viewsMatch) result.views = parseCount(viewsMatch[1]);
      // Username: bentuk lama "( @handle )" ATAU bentuk meta baru "… - handle on April 30, 2026: …"
      const userMatch = content.match(/\(@([a-zA-Z0-9_.-]+)\)/);
      if (userMatch) result.username = userMatch[1];
      if (!result.username) {
        const dash = content.match(/-\s*([A-Za-z0-9_.]+)\s+on\s+[A-Za-z]+ \d{1,2}, \d{4}/);
        if (dash) result.username = dash[1];
      }
      // Tanggal unggah ada di meta ("… on April 30, 2026: …")
      const dateMatch = content.match(/\bon\s+([A-Za-z]+ \d{1,2}, \d{4})\b/);
      if (dateMatch) result.postDate = toIsoTime(dateMatch[1]);
      // Caption = teks berkutip setelah titik-dua terakhir ("…: "CAPTION"")
      const capMatch = content.match(/:\s*["“”]([\s\S]+)$/);
      if (capMatch) {
        const cap = capMatch[1].replace(/["“”]\s*$/, '').trim();
        if (cap) result.caption = truncateText(cap, 500);
      }
    }
    return result;
  }

  const VIEW_COUNT_KEYS = ['play_count', 'playCount', 'video_play_count', 'videoPlayCount', 'video_view_count', 'videoViewCount',
    'ig_play_count', 'clips_play_count', 'organic_play_count', 'view_count', 'viewCount'];
  const VIEW_COUNT_KEY_SET = new Set(VIEW_COUNT_KEYS.map((k) => k.replace(/[_-]/g, '').toLowerCase()));
  const VIEW_TEXT_PATTERN = /([\d,.]+(?:\s*(?:[KkMmBb]|rb|ribu|jt|juta|miliar))?)\s*(?:views?|plays?|tayangan|pemutaran|ditonton|kali\s+diputar|diputar)\b/i;
  const PLAY_COUNT_HINT = /play_count|playCount|view_count|viewCount/i;
  const FOLLOWER_COUNT_HINT = /follower_count|followerCount|edge_followed_by/i;

  function isViewCountKey(key) { return VIEW_COUNT_KEY_SET.has(String(key).replace(/[_-]/g, '').toLowerCase()); }

  function getShortcodeFromUrl(url) {
    try {
      const pathname = new URL(url, window.location.origin).pathname;
      const m = pathname.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
      return m ? m[1] : null;
    } catch {
      const m = (url || '').match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
      return m ? m[1] : null;
    }
  }

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function shortcodeToMediaId(shortcode) {
    if (!shortcode || typeof BigInt === 'undefined') return null;
    let mediaId = 0n;
    for (const ch of shortcode) {
      const v = ALPHABET.indexOf(ch);
      if (v < 0) return null;
      mediaId = mediaId * 64n + BigInt(v);
    }
    return mediaId.toString();
  }

  function isVideoOrReelUrl(url) {
    try {
      const p = new URL(url, window.location.origin).pathname.toLowerCase();
      return /\/reel\//.test(p) || /\/reels\//.test(p) || /\/tv\//.test(p);
    } catch {
      return /\/reel\//i.test(url) || /\/reels\//i.test(url) || /\/tv\//i.test(url);
    }
  }

  function findMediaNode(obj, mediaId, shortcode, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 14) return null;
    if (Array.isArray(obj)) {
      for (const item of obj) { const found = findMediaNode(item, mediaId, shortcode, depth + 1); if (found) return found; }
      return null;
    }
    const nodeId = obj.pk ?? obj.id ?? obj.media_id;
    const nodeCode = obj.code ?? obj.shortcode;
    const looksLikeMedia = obj.media_type != null || obj.video_versions != null || obj.code != null || obj.caption != null;
    const idMatches = mediaId && nodeId != null && String(nodeId) === String(mediaId);
    const codeMatches = shortcode && nodeCode === shortcode;
    if (looksLikeMedia && (idMatches || codeMatches)) return obj;
    for (const key of Object.keys(obj)) {
      const found = findMediaNode(obj[key], mediaId, shortcode, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function viewsFromMediaNode(node) {
    let best = null;
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 8) return;
      if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
      for (const key of Object.keys(value)) {
        const child = value[key];
        if (isViewCountKey(key) && child != null) {
          const parsed = parseCount(child);
          if (parsed !== null && (best === null || parsed > best)) best = parsed;
        } else if (child && typeof child === 'object') visit(child, depth + 1);
      }
    };
    visit(node);
    return best;
  }

  function fieldsFromMediaNode(node) {
    const user = node.user || node.owner || null;
    const caption = node.caption && typeof node.caption === 'object' ? node.caption.text
      : (node.edge_media_to_caption && node.edge_media_to_caption.edges && node.edge_media_to_caption.edges[0] && node.edge_media_to_caption.edges[0].node && node.edge_media_to_caption.edges[0].node.text) || node.caption;
    return {
      username: (user && (user.username || user.unique_id || user.uniqueId)) || null,
      postDate: toIsoTime(node.taken_at ?? node.taken_at_timestamp ?? node.timestamp ?? node.date ?? null),
      caption: caption ? truncateText(caption, 500) : null,
      likes: parseCount(node.like_count ?? (node.edge_liked_by && node.edge_liked_by.count) ?? (node.edge_media_preview_like && node.edge_media_preview_like.count)),
      comments: parseCount(node.comment_count ?? (node.edge_media_to_comment && node.edge_media_to_comment.count)),
      views: viewsFromMediaNode(node),
      followerCount: parseCount(user && (user.follower_count ?? (user.edge_followed_by && user.edge_followed_by.count))),
    };
  }

  function extractFromEmbeddedJson() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          if (data && (data['@type'] === 'SocialMediaPosting' || data.author)) {
            const stats = data.interactionStatistic || [];
            return {
              likes: parseCount((stats.find((s) => (s.interactionType || '').includes('Like')) || {}).userInteractionCount),
              comments: parseCount((stats.find((s) => (s.interactionType || '').includes('Comment')) || {}).userInteractionCount),
              views: parseCount((stats.find((s) => /WatchAction|ViewAction/.test(s.interactionType || '')) || {}).userInteractionCount),
              username: data.author ? (data.author.alternateName ? data.author.alternateName.replace('@', '') : data.author.identifier) : null,
              caption: data.articleBody || data.description || null,
              postDate: data.dateCreated || data.datePublished || data.uploadDate || null,
            };
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  function extractFromPageScripts(mediaId, shortcode) {
    const result = { views: null, isVideo: false, username: null, postDate: null, caption: null, likes: null, comments: null, followerCount: null };
    let bestViews = null;
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text) continue;
      if (!result.isVideo && /is_video["']?\s*:\s*true|"media_type"\s*:\s*2|GraphVideo|XDTGraphVideo/.test(text)) result.isVideo = true;
      const looksLikeJson = script.type === 'application/json' || /^\s*[[{]/.test(text);
      if (!looksLikeJson || !PLAY_COUNT_HINT.test(text)) continue;
      try {
        const data = JSON.parse(text);
        const node = findMediaNode(data, mediaId, shortcode);
        if (!node) continue;
        const fields = fieldsFromMediaNode(node);
        if (fields.views !== null && (bestViews === null || fields.views > bestViews)) { bestViews = fields.views; result.isVideo = true; }
        result.username = result.username || fields.username;
        result.postDate = result.postDate || fields.postDate;
        result.caption = result.caption || fields.caption;
        result.likes = result.likes ?? fields.likes;
        result.comments = result.comments ?? fields.comments;
        result.followerCount = result.followerCount ?? fields.followerCount;
      } catch {}
    }
    result.views = bestViews;
    return result;
  }

  function extractFromDOM() {
    const result = { likes: null, comments: null, views: null, username: null, caption: null, postDate: null };
    const RESERVED_PATHS = /^(explore|reels?|p|tv|accounts|direct|about|developer|legal|directory|challenge|stories)$/i;
    const handleFromPath = (href) => {
      const m = String(href || '').match(/^\/([A-Za-z0-9_.]+)\/?$/);
      return m && !RESERVED_PATHS.test(m[1]) ? m[1] : null;
    };
    result.username = handleFromPath((document.querySelector('header a[href^="/"]') || {}).getAttribute ? document.querySelector('header a[href^="/"]').getAttribute('href') : null);
    if (!result.username) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const titleText = [document.title, ogTitle ? ogTitle.getAttribute('content') : ''].join(' ');
      const handleMatch = titleText.match(/\(@([a-zA-Z0-9_.-]+)\)/) || titleText.match(/@([a-zA-Z0-9_.]+)\s+on Instagram/i);
      if (handleMatch) result.username = handleMatch[1];
    }

    const allTextElements = Array.from(document.querySelectorAll('span, a, button, div[role="button"]'));
    for (const el of allTextElements) {
      if (el.childElementCount > 0) continue;
      const textContent = el.textContent.trim().replace(/\s+/g, ' ');
      if (!textContent || textContent.length > 200) continue;
      if (result.likes === null) {
        const match = textContent.match(/([\d,.]+[KkMmBb]?)\s*(?:likes?|suka)\b/i);
        if (match) {
          const exact = el.getAttribute('title');
          result.likes = (exact && /^[\d,.]+$/.test(exact)) ? parseCount(exact) : parseCount(match[1]);
        }
      }
      if (result.likes === null) {
        const match = textContent.match(/(?:and|dan)\s+([\d,.]+[KkMmBb]?)\s+(?:others|lainnya)/i);
        if (match) {
          const exact = el.getAttribute('title');
          result.likes = (exact && /^[\d,.]+$/.test(exact)) ? parseCount(exact) + 1 : parseCount(match[1]) + 1;
        }
      }
      if (result.views === null) {
        const match = textContent.match(VIEW_TEXT_PATTERN);
        if (match) {
          const exact = el.getAttribute('title');
          result.views = (exact && /^[\d,.]+$/.test(exact)) ? parseCount(exact) : parseCount(match[1]);
        } else if (/^([\d,.]+[KkMmBb]?)$/.test(textContent)) {
          const aria = el.getAttribute('aria-label') || '';
          const ariaMatch = aria.match(VIEW_TEXT_PATTERN);
          if (ariaMatch) result.views = parseCount(ariaMatch[1]);
        }
      }
      if (result.comments === null) {
        const match = textContent.match(/([\d,.]+[KkMmBb]?)\s*(?:comments?|komentar)\b/i);
        if (match) {
          const exact = el.getAttribute('title');
          result.comments = (exact && /^[\d,.]+$/.test(exact)) ? parseCount(exact) : parseCount(match[1]);
        }
      }
    }

    if (result.views === null) {
      for (const el of document.querySelectorAll('[aria-label]')) {
        const ariaMatch = (el.getAttribute('aria-label') || '').match(VIEW_TEXT_PATTERN);
        if (ariaMatch) { result.views = parseCount(ariaMatch[1]); break; }
      }
    }

    const captionEl = document.querySelector('h1') || document.querySelector('div[role="button"] span');
    if (captionEl) result.caption = truncateText(captionEl.textContent, 500);
    if (!result.caption) {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      const ogText = ogDesc ? (ogDesc.getAttribute('content') || '').trim() : '';
      const quoted = ogText.match(/Instagram:\s*["“]([\s\S]+)["”]\s*$/);
      if (quoted) result.caption = truncateText(quoted[1], 500);
    }

    const timeEl = document.querySelector('time[datetime]') || document.querySelector('a[href*="/p/"] time[datetime]') || document.querySelector('a[href*="/reel/"] time[datetime]');
    if (timeEl) result.postDate = toIsoTime(timeEl.getAttribute('datetime'));
    if (!result.postDate) {
      const published = document.querySelector('meta[property="article:published_time"]');
      if (published) result.postDate = toIsoTime(published.getAttribute('content'));
    }
    return result;
  }

  function findUserNode(obj, username, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    if (Array.isArray(obj)) {
      for (const item of obj) { const found = findUserNode(item, username, depth + 1); if (found) return found; }
      return null;
    }
    const nodeUsername = obj.username || obj.unique_id || obj.uniqueId;
    if (nodeUsername && String(nodeUsername).toLowerCase() === username.toLowerCase()) {
      const count = obj.follower_count ?? obj.followerCount ?? (obj.edge_followed_by && obj.edge_followed_by.count);
      if (count != null) return obj;
    }
    for (const key of Object.keys(obj)) {
      const found = findUserNode(obj[key], username, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function extractFollowerFromPageScripts(username) {
    if (!username) return null;
    for (const script of document.querySelectorAll('script:not([src])')) {
      const text = script.textContent || '';
      if (!text || !FOLLOWER_COUNT_HINT.test(text)) continue;
      try {
        const node = findUserNode(JSON.parse(text), username);
        if (!node) continue;
        const count = parseCount(node.follower_count ?? node.followerCount ?? (node.edge_followed_by && node.edge_followed_by.count));
        if (count !== null) return count;
      } catch {}
    }
    return null;
  }

  function detectBlockState() {
    const path = (window.location.pathname || '').toLowerCase();
    if (path.includes('/accounts/login') || path.includes('/challenge')) return 'AUTH';
    const meta = document.querySelector('meta[name="description"]');
    const metaText = ((meta && meta.getAttribute('content')) || '').toLowerCase();
    if (metaText.startsWith('login') || metaText.includes('log in')) return 'AUTH';
    const bodyText = (document.body ? document.body.innerText : '').slice(0, 4000).toLowerCase();
    if (bodyText.includes("page isn't available") || bodyText.includes('halaman ini tidak tersedia') || bodyText.includes('page not found') || bodyText.includes('private account') || bodyText.includes('akun pribadi')) return 'PERMANENT';
    if (bodyText.includes('try again later') || bodyText.includes('coba lagi nanti')) return 'THROTTLED';
    return null;
  }

  function firstValue(...values) {
    for (const v of values) if (v !== null && v !== undefined && v !== '') return v;
    return null;
  }

  async function scrapePost(linkObj) {
    const quickMeta = extractFromMetaTags();
    if (quickMeta.likes === null && quickMeta.comments === null) {
      await waitForSelector('article, main, meta[name="description"]', 7000);
      await new Promise((r) => setTimeout(r, 350));
    }
    const sourceUrl = (linkObj && linkObj.url) || window.location.href;
    const shortcode = getShortcodeFromUrl(sourceUrl) || getShortcodeFromUrl(window.location.href);
    const mediaId = shortcode ? shortcodeToMediaId(shortcode) : null;

    const metaData = extractFromMetaTags();
    const jsonData = extractFromEmbeddedJson() || {};
    const scriptData = extractFromPageScripts(mediaId, shortcode);
    const domData = extractFromDOM();

    let username = firstValue(metaData.username, jsonData.username, scriptData.username, domData.username);
    let likes = firstValue(metaData.likes, jsonData.likes, scriptData.likes, domData.likes);
    let comments = firstValue(metaData.comments, jsonData.comments, scriptData.comments, domData.comments);
    let views = firstValue(metaData.views, jsonData.views, scriptData.views, domData.views);
    let caption = firstValue(metaData.caption, jsonData.caption, scriptData.caption, domData.caption);
    let postDate = firstValue(metaData.postDate, jsonData.postDate, scriptData.postDate, domData.postDate);
    let followerCount = scriptData.followerCount ?? null;

    const isVideoContent = scriptData.isVideo || isVideoOrReelUrl(window.location.href)
      || (linkObj && linkObj.url && isVideoOrReelUrl(linkObj.url)) || !!document.querySelector('video');

    const result = {
      platform: 'instagram',
      url: window.location.href,
      username, likes, comments, views, shares: null,
      caption: truncateText(caption, 500), postDate, followerCount,
      status: 'OK', error: null, errorCode: null,
      scrapedAt: new Date().toISOString(),
    };

    if (!result.username && linkObj && linkObj.username) result.username = linkObj.username;
    if (result.followerCount === null) result.followerCount = extractFollowerFromPageScripts(result.username);

    const blockState = detectBlockState();
    if (result.likes === null && result.comments === null && result.views === null) {
      if (blockState === 'AUTH') { result.status = 'FAILED'; result.error = 'Login required / Session expired'; result.errorCode = 'AUTH'; }
      else if (blockState === 'THROTTLED') { result.status = 'FAILED'; result.error = 'Instagram meminta coba lagi nanti (throttled)'; result.errorCode = 'THROTTLED'; }
      else if (blockState === 'PERMANENT') { result.status = 'FAILED'; result.error = 'Postingan tidak tersedia atau akun private'; result.errorCode = 'PERMANENT'; }
      else { result.status = 'PARTIAL'; result.error = 'Could not extract all data — page might be private or login required'; result.errorCode = 'TRANSIENT'; }
    } else if (result.views === null && isVideoContent && result.likes !== null && result.comments !== null) {
      result.error = null;
      result.viewsMissingReason = 'video/reel without an exposed view count';
    } else if (result.views === null && isVideoContent && (result.likes !== null || result.comments !== null)) {
      result.status = 'PARTIAL';
      result.error = 'Views not found (video/reel; neither the page nor the API returned a count)';
    }

    return result;
  }

  function countsFromMetaDescription() {
    const meta = document.querySelector('meta[name="description"]');
    const content = meta ? (meta.getAttribute('content') || '') : '';
    const grab = (label) => {
      const m = content.match(new RegExp('(' + COUNT_TOKEN.source + ')\\s*(?:' + label + ')', 'i'));
      return m ? parseCount(m[1]) : null;
    };
    return { followerCount: grab('Followers|Pengikut'), followingCount: grab('Following|Mengikuti'), postCount: grab('Posts|Postingan') };
  }

  function displayNameFromMeta() {
    const metaDesc = document.querySelector('meta[name="description"]');
    const content = metaDesc ? (metaDesc.getAttribute('content') || '') : '';
    let m = content.match(/[-–—]\s+(.+?)\s+on Instagram$/i);
    if (m) {
      const name = m[1].trim();
      if (name && !/^See .+ and videos from /.test(name)) return truncateText(name, 120);
    }
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      m = (ogTitle.getAttribute('content') || '').match(/^(.+?)\s+\(@[\w.]+\)/);
      if (m) return truncateText(m[1].trim(), 120);
    }
    return null;
  }

  function extractFollowerCount() {
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      const content = metaDesc.getAttribute('content') || '';
      const fm = content.match(new RegExp('(' + COUNT_TOKEN.source + ')\\s*Followers', 'i')) || content.match(new RegExp('(' + COUNT_TOKEN.source + ')\\s*Pengikut', 'i'));
      if (fm) return parseCount(fm[1]);
    }
    for (const el of document.querySelectorAll('a[href*="followers"], span, li, a')) {
      const textContent = el.textContent.trim();
      const match = textContent.match(/^([\d,.]+[KkMmBb]?)\s*(followers|pengikut)$/i);
      if (match) {
        const exact = el.getAttribute('title');
        return (exact && /^[\d,.]+$/.test(exact)) ? parseCount(exact) : parseCount(match[1]);
      }
    }
    return null;
  }

  function postsFromTimeline(node) {
    const timeline = node && (node.edge_owner_to_timeline_media || node.timeline);
    const rawEdges = Array.isArray(timeline && timeline.edges) ? timeline.edges
      : (Array.isArray(node && node.items) ? node.items : null);
    if (!rawEdges) return null;
    return recentPosts(rawEdges.map((edge) => {
      const media = edge && edge.node ? edge.node : edge;
      if (!media || typeof media !== 'object') return null;
      const code = media.code || media.shortcode || null;
      const isVideo = Boolean(media.is_video) || media.media_type === 2;
      return {
        id: code,
        url: code ? `https://www.instagram.com/${isVideo ? 'reel' : 'p'}/${code}/` : null,
        postedAt: media.taken_at ?? media.taken_at_timestamp ?? media.timestamp ?? null,
        likes: (media.edge_liked_by && media.edge_liked_by.count) ?? media.like_count ?? null,
        comments: (media.edge_media_to_comment && media.edge_media_to_comment.count) ?? media.comment_count ?? null,
        views: media.video_view_count ?? media.play_count ?? null,
        shares: null,
        caption: (media.edge_media_to_caption && media.edge_media_to_caption.edges && media.edge_media_to_caption.edges[0] && media.edge_media_to_caption.edges[0].node && media.edge_media_to_caption.edges[0].node.text)
          ?? (media.caption && media.caption.text) ?? null,
        isVideo,
      };
    }));
  }

  function findProfileUserNode(username) {
    if (!username) return null;
    for (const script of document.querySelectorAll('script:not([src])')) {
      const text = script.textContent || '';
      if (!text || !FOLLOWER_COUNT_HINT.test(text)) continue;
      try {
        const node = findUserNode(JSON.parse(text), username);
        if (node) return node;
      } catch {}
    }
    return null;
  }

  async function scrapeProfile(requestedUsername) {
    await waitForSelector('meta[name="description"], header', 5000);
    await new Promise((r) => setTimeout(r, 250));

    const pathMatch = window.location.pathname.match(/^\/(@?[^/?#]+)/);
    const pathUsername = pathMatch ? pathMatch[1].replace(/^@/, '') : '';
    const username = requestedUsername || pathUsername;

    const metaCounts = countsFromMetaDescription();
    let followerCount = extractFollowerCount();
    if (followerCount === null) followerCount = extractFollowerFromPageScripts(username);
    if (followerCount === null) followerCount = metaCounts.followerCount;

    let node = findProfileUserNode(username);
    let posts = node ? postsFromTimeline(node) : null;

    if (followerCount === null && node) {
      followerCount = parseCount((node.edge_followed_by && node.edge_followed_by.count) ?? node.follower_count ?? null);
    }

    const blockState = detectBlockState();
    return {
      platform: 'instagram',
      url: window.location.href,
      username: (node && node.username) || username || null,
      accountId: node && (node.pk ?? node.id) !== undefined ? String(node.pk ?? node.id) : null,
      externalId: null,
      avatarUrl: (node && (node.profile_pic_url || node.profile_pic_url_hd))
        || (document.querySelector('meta[property="og:image"]') && document.querySelector('meta[property="og:image"]').getAttribute('content')) || null,
      displayName: (node && node.full_name) || displayNameFromMeta(),
      bio: (node && node.biography) ? truncateText(node.biography, 300) : null,
      region: null,
      isVerified: node && node.is_verified !== undefined ? Boolean(node.is_verified) : null,
      followerCount,
      followingCount: parseCount((node && node.edge_follow && node.edge_follow.count)) ?? metaCounts.followingCount,
      postCount: parseCount((node && node.edge_owner_to_timeline_media && node.edge_owner_to_timeline_media.count)) ?? metaCounts.postCount,
      posts,
      postSource: posts && posts.length ? 'page-json' : null,
      status: followerCount !== null || (posts && posts.length > 0) ? 'OK' : 'FAILED',
      errorCode: followerCount === null && (!posts || posts.length === 0) ? blockState : null,
      scrapedAt: new Date().toISOString(),
    };
  }

  globalThis.__saScrapePost = scrapePost;
  globalThis.__saScrapeProfile = scrapeProfile;
  globalThis.__saErrorResult = (e) => errorResult('instagram', window.location.href, e);
})();