/**
 * sunscrap — content/tk-scraper
 * Membaca postingan/profil TikTok dari halaman yang sudah dirender.
 * Dipanggil lewat globalThis.__saScrapePost / __saScrapeProfile di isolated world.
 */
(function () {
  'use strict';
  const { parseCount, truncateText, errorResult, toIsoTime, recentPosts, metricFromLabel } = globalThis.SA_CONTENT;

  function detectBlockState() {
    const path = (window.location.pathname || '').toLowerCase();
    if (path.includes('/login') || path.includes('/verify')) return 'AUTH';
    const body = (document.body ? document.body.innerText : '').slice(0, 4000).toLowerCase();
    if (body.includes('captcha') || body.includes('too many requests') || body.includes('try again later')) return 'THROTTLED';
    if (body.includes('video currently unavailable') || body.includes("couldn't find this video")
      || body.includes('video tidak tersedia') || body.includes('tidak dapat menemukan video')
      || body.includes('this account is private') || body.includes('akun ini privat')) return 'PERMANENT';
    return null;
  }

  function extractFromRehydration() {
    try {
      const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!script) return null;
      const data = JSON.parse(script.textContent);
      const ds = data.__DEFAULT_SCOPE__ || {};

      const videoDetail = ds['webapp.video-detail'];
      if (videoDetail) {
        if (videoDetail.statusCode !== 0) return null;
        const itemStruct = videoDetail.itemInfo && videoDetail.itemInfo.itemStruct;
        const pathVideoId = (window.location.pathname.match(/\/video\/(\d+)/) || [])[1];
        if (itemStruct && itemStruct.id && (!pathVideoId || String(itemStruct.id) === pathVideoId)) {
          const stats = itemStruct.stats || itemStruct.statsV2 || {};
          const author = itemStruct.author || {};
          return {
            kind: 'post', platform: 'tiktok', url: window.location.href,
            username: author.uniqueId || null,
            likes: parseCount(stats.diggCount ?? stats.heartCount ?? null),
            comments: parseCount(stats.commentCount ?? null),
            views: parseCount(stats.playCount ?? null),
            shares: parseCount(stats.shareCount ?? null),
            caption: truncateText(itemStruct.desc || '', 500) || null,
            postDate: itemStruct.createTime ? new Date(itemStruct.createTime * 1000).toISOString() : null,
            followerCount: null, status: 'OK', errorCode: null, source: 'rehydration',
            scrapedAt: new Date().toISOString(),
          };
        }
      }

      const userDetail = ds['webapp.user-detail'];
      if (userDetail && userDetail.statusCode === 0) {
        const userInfo = userDetail.userInfo || {};
        const user = userInfo.user || {};
        const stats = userInfo.stats || {};
        if (user.uniqueId) {
          return {
            kind: 'profile', platform: 'tiktok', url: window.location.href,
            username: user.uniqueId,
            accountId: user.id ? String(user.id) : null,
            externalId: user.secUid ? String(user.secUid) : null,
            avatarUrl: user.avatarLarger || user.avatarMedium || user.avatarThumb || null,
            displayName: user.nickname || null,
            bio: truncateText(user.signature || '', 300) || null,
            region: user.region || null,
            isVerified: user.verified === undefined ? null : Boolean(user.verified),
            followerCount: parseCount(stats.followerCount ?? null),
            followingCount: parseCount(stats.followingCount ?? null),
            videoCount: parseCount(stats.videoCount ?? null),
            posts: null, status: 'OK', errorCode: null, source: 'rehydration',
            scrapedAt: new Date().toISOString(),
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  function extractFromSigiState() {
    try {
      const script = document.getElementById('SIGI_STATE');
      if (!script) return null;
      const data = JSON.parse(script.textContent);
      const itemModule = data.ItemModule;
      if (!itemModule) return null;
      const pathVideoId = (window.location.pathname.match(/\/video\/(\d+)/) || [])[1];
      const videoId = (pathVideoId && itemModule[pathVideoId]) ? pathVideoId : Object.keys(itemModule)[0];
      if (!videoId) return null;
      const item = itemModule[videoId];
      const stats = item.stats || {};
      const authorId = item.author;
      const authorData = (data.UserModule && data.UserModule.users && data.UserModule.users[authorId]) || {};
      const authorStats = (data.UserModule && data.UserModule.stats && data.UserModule.stats[authorId]) || {};
      return {
        kind: 'post', platform: 'tiktok', url: window.location.href,
        username: authorData.uniqueId || authorId || null,
        likes: parseCount(stats.diggCount ?? null),
        comments: parseCount(stats.commentCount ?? null),
        views: parseCount(stats.playCount ?? null),
        shares: parseCount(stats.shareCount ?? null),
        caption: truncateText(item.desc || '', 500) || null,
        postDate: item.createTime ? new Date(item.createTime * 1000).toISOString() : null,
        followerCount: parseCount(authorStats.followerCount ?? null),
        status: 'OK', errorCode: null, source: 'sigi_state',
        scrapedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  function labelOf(node) {
    if (!node) return null;
    return metricFromLabel(node.getAttribute('data-e2e'))
      || metricFromLabel(node.getAttribute('aria-label'))
      || metricFromLabel(node.getAttribute('title'))
      || metricFromLabel(node.getAttribute('class'));
  }

  function metricForCountElement(el) {
    const direct = labelOf(el);
    if (direct) return direct;
    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth++) {
      const own = labelOf(node);
      if (own) return own;
      const metrics = new Set();
      for (const icon of node.querySelectorAll('[data-e2e]')) {
        const metric = metricFromLabel(icon.getAttribute('data-e2e'));
        if (metric) metrics.add(metric);
      }
      if (metrics.size === 1) return metrics.values().next().value;
      node = node.parentElement;
    }
    return null;
  }

  function countFromElement(el) {
    const count = parseCount(el.getAttribute('title'));
    return count === null ? parseCount(el.textContent) : count;
  }

  function extractFromDOM() {
    const result = {
      platform: 'tiktok', url: window.location.href, username: null,
      likes: null, comments: null, views: null, shares: null,
      caption: null, postDate: null, followerCount: null,
      status: 'OK', errorCode: null, source: 'dom', scrapedAt: new Date().toISOString(),
    };

    const urlMatch = window.location.pathname.match(/\/@([^/]+)/);
    if (urlMatch) result.username = urlMatch[1];

    const e2eMap = {
      'like-count': 'likes', 'browse-like-count': 'likes',
      'comment-count': 'comments', 'browse-comment-count': 'comments',
      'share-count': 'shares', 'browse-share-count': 'shares',
    };
    for (const [attr, field] of Object.entries(e2eMap)) {
      if (result[field] !== null) continue;
      const el = document.querySelector(`[data-e2e="${attr}"]`);
      if (el) {
        const count = countFromElement(el);
        if (count !== null) result[field] = count;
      }
    }

    const countCandidates = document.querySelectorAll('button strong, button [data-e2e$="-count"], [class*="DivAction"] strong, [class*="action-bar"] strong, [data-e2e$="-count"]');
    for (const el of countCandidates) {
      const metric = metricForCountElement(el);
      if (!metric || result[metric] !== null) continue;
      const count = countFromElement(el);
      if (count !== null) result[metric] = count;
    }

    const viewSelectors = ['[data-e2e="video-views"]', '[data-e2e="browse-video-views"]', '[class*="video-count"]', '[class*="play-count"]'];
    for (const sel of viewSelectors) {
      if (result.views !== null) break;
      const el = document.querySelector(sel);
      if (el) {
        const count = countFromElement(el);
        if (count !== null) result.views = count;
      }
    }

    const captionSelectors = ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]', '[class*="VideoMetaTitle"]', 'h1[class*="title"]'];
    for (const sel of captionSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { result.caption = truncateText(el.textContent.trim(), 500); break; }
    }

    let followerEl = document.querySelector('[data-e2e="followers-count"]');
    if (!followerEl) {
      followerEl = Array.from(document.querySelectorAll('[class*="CountInfo"], [class*="user-count"], [class*="real-followers"]'))
        .find((el) => /follower|pengikut/i.test(el.textContent || '') && !/following|mengikuti|like|suka/i.test(el.textContent || ''));
    }
    if (followerEl) {
      const count = countFromElement(followerEl.querySelector('strong') || followerEl);
      if (count !== null) result.followerCount = count;
    }
    return result;
  }

  function waitForVideoData(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const check = () => {
        const buttons = document.querySelectorAll('button strong');
        if (buttons.length >= 2) return true;
        return Boolean(document.querySelector('[data-e2e="like-count"], [data-e2e="browse-like-count"]'));
      };
      if (check()) return resolve(true);
      const observer = new MutationObserver(() => {
        if (check()) { observer.disconnect(); resolve(true); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(false); }, timeoutMs);
    });
  }

  function waitForProfileData(timeoutMs = 6000) {
    return new Promise((resolve) => {
      const check = () => Boolean(document.querySelector('[data-e2e="followers-count"]') || document.querySelector('[class*="ShareInfo"], [class*="CountInfo"]'));
      if (check()) return resolve(true);
      const observer = new MutationObserver(() => {
        if (check()) { observer.disconnect(); resolve(true); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(false); }, timeoutMs);
    });
  }

  function hasAnyPostMetric(result) {
    if (!result) return false;
    return ['likes', 'comments', 'views', 'shares'].some((f) => typeof result[f] === 'number' && Number.isFinite(result[f]));
  }

  async function scrapePost(linkObj) {
    let result = extractFromRehydration();
    if (result && result.kind === 'post' && hasAnyPostMetric(result)) return result;
    result = extractFromSigiState();
    if (result && result.kind === 'post' && hasAnyPostMetric(result)) return result;

    await waitForVideoData(8000);
    await new Promise((r) => setTimeout(r, 500));
    result = extractFromDOM();

    if (result && !hasAnyPostMetric(result)) {
      const retry = extractFromRehydration();
      if (retry && retry.kind === 'post' && hasAnyPostMetric(retry)) result = retry;
    }

    if (result && result.source !== 'dom' && result.status === 'OK') {
      const domData = extractFromDOM();
      if (!result.username) result.username = domData.username;
      if (result.likes === null) result.likes = domData.likes;
      if (result.comments === null) result.comments = domData.comments;
      if (result.views === null) result.views = domData.views;
      if (result.shares === null) result.shares = domData.shares;
      if (!result.caption) result.caption = domData.caption;
      if (result.followerCount === null) result.followerCount = domData.followerCount;
    }

    if (!result || (result.likes === null && result.comments === null && result.views === null)) {
      const blockState = detectBlockState();
      result = result || {};
      result.status = 'FAILED';
      result.errorCode = blockState || 'TRANSIENT';
      result.error = blockState === 'AUTH' ? 'Login required / Session expired'
        : blockState === 'THROTTLED' ? 'TikTok membatasi akses (throttled)'
        : blockState === 'PERMANENT' ? 'Video tidak tersedia atau akun private'
        : 'Could not extract data — page may require login or video is unavailable';
      result.platform = 'tiktok';
      result.url = window.location.href;
      result.scrapedAt = new Date().toISOString();
    }
    if (!result.username && linkObj && linkObj.username) result.username = linkObj.username;
    return result;
  }

  function readFollowerCountFromDom() {
    const el = document.querySelector('[data-e2e="followers-count"]');
    if (el) {
      const fromTitle = parseCount(el.getAttribute('title'));
      if (fromTitle !== null) return fromTitle;
      const fromText = parseCount(el.textContent);
      if (fromText !== null) return fromText;
    }
    const strong = document.querySelector('[class*="follower"] strong, [class*="Follower"] strong');
    if (strong) {
      const fromTitle = parseCount(strong.getAttribute('title'));
      if (fromTitle !== null) return fromTitle;
      return parseCount(strong.textContent);
    }
    return null;
  }

  function findSecUid() {
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      if (!text.includes('secUid')) continue;
      const m = text.match(/"secUid"\s*:\s*"([^"]{10,})"/);
      if (m) return m[1];
    }
    return null;
  }

  async function fetchItemListPosts(secUid, uniqueId) {
    if (!secUid) return null;
    const limit = globalThis.SA_CONTENT.RECENT_POST_LIMIT;
    const query = new URLSearchParams({
      aid: '1988', app_name: 'tiktok_web', device_platform: 'webapp',
      browser_language: (navigator.language || 'id-ID'),
      count: String(limit), cursor: '0', coverType: 'jpg', itemType: '0', secUid,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://www.tiktok.com/api/post/item_list/?${query}`, { credentials: 'include', headers: { 'Accept': 'application/json,text/plain,*/*' }, signal: controller.signal });
      if (!response.ok) return null;
      const data = JSON.parse(await response.text());
      const items = Array.isArray(data.itemList) ? data.itemList : (Array.isArray(data.data && data.data.itemList) ? data.data.itemList : null);
      if (!items) return null;
      return recentPosts(items.map((item) => {
        const stats = item.stats || item.statsV2 || {};
        return {
          id: item.id,
          url: uniqueId ? `https://www.tiktok.com/@${uniqueId}/video/${item.id}` : null,
          postedAt: item.createTime,
          likes: stats.diggCount ?? stats.heartCount ?? null,
          comments: stats.commentCount ?? null,
          shares: stats.shareCount ?? null,
          views: stats.playCount ?? null,
          caption: item.desc,
          isVideo: item.imagePost ? false : true,
        };
      }));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function gridPosts() {
    const links = document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]');
    const seen = new Set();
    const posts = [];
    for (const link of links) {
      const href = link.href || '';
      const m = href.match(/\/(?:video|photo)\/(\d+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      posts.push({ id: m[1], url: href.split('?')[0] });
      if (posts.length >= globalThis.SA_CONTENT.RECENT_POST_LIMIT) break;
    }
    return recentPosts(posts);
  }

  async function scrapeProfile(requestedUsername) {
    const urlMatch = window.location.pathname.match(/\/@([^/]+)/);
    const pathUsername = urlMatch ? urlMatch[1] : (requestedUsername || null);

    let profile = extractFromRehydration();
    if (!profile || profile.kind !== 'profile') {
      await waitForProfileData(6000);
      await new Promise((r) => setTimeout(r, 300));
      const identity = profile && profile.username ? profile : {};
      profile = {
        username: identity.username || pathUsername,
        followerCount: readFollowerCountFromDom(),
        followingCount: identity.followingCount ?? null,
        videoCount: identity.videoCount ?? null,
        accountId: identity.accountId || null,
        externalId: identity.externalId || null,
        avatarUrl: identity.avatarUrl || null,
        displayName: identity.displayName || null,
        bio: identity.bio || null,
        region: identity.region || null,
        isVerified: identity.isVerified !== undefined ? identity.isVerified : null,
      };
    }

    const username = profile.username || pathUsername || null;
    const secUid = profile.externalId || findSecUid() || null;
    let posts = await fetchItemListPosts(secUid, username);
    let postSource = posts && posts.length ? 'item-list' : null;
    if (!posts || !posts.length) {
      posts = gridPosts();
      postSource = posts.length ? 'grid' : null;
    }

    const followerCount = profile.followerCount === undefined ? null : profile.followerCount;
    return {
      platform: 'tiktok', url: window.location.href,
      username,
      accountId: profile.accountId || null,
      externalId: secUid,
      avatarUrl: profile.avatarUrl || null,
      displayName: profile.displayName || null,
      bio: profile.bio || null,
      region: profile.region || null,
      isVerified: profile.isVerified,
      followerCount,
      followingCount: profile.followingCount ?? null,
      postCount: profile.videoCount ?? null,
      posts,
      postSource,
      status: followerCount !== null || (posts && posts.length > 0) ? 'OK' : 'FAILED',
      errorCode: followerCount === null && (!posts || !posts.length) ? detectBlockState() : null,
      scrapedAt: new Date().toISOString(),
    };
  }

  globalThis.__saScrapePost = scrapePost;
  globalThis.__saScrapeProfile = scrapeProfile;
  globalThis.__saErrorResult = (e) => errorResult('tiktok', window.location.href, e);
})();