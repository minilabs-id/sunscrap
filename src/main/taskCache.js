'use strict';
/**
 * sunscraping — task cache
 * Memutuskan apakah sebuah post yang diantrekan bisa dijawab dari angka hasil
 * kunjungan profil, tanpa memuat halaman post lagi. Bebas Electron agar bisa diuji.
 */

const TaskCache = {
  MAX_AGE_MS: 12 * 60 * 60 * 1000,
  METRIC_FIELDS: ['likes', 'comments', 'views', 'shares'],

  _hasNumber(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  },

  shouldHarvestAccount(task, harvestedKeys = []) {
    if (!task || !task.username || !task.platform) return false;
    const key = `${String(task.platform).toLowerCase()}:${String(task.username).toLowerCase()}`;
    const seen = typeof harvestedKeys.has === 'function'
      ? harvestedKeys.has(key)
      : Array.isArray(harvestedKeys) && harvestedKeys.indexOf(key) !== -1;
    if (seen) return false;
    return task.cachedFollowerCount === null || task.cachedFollowerCount === undefined;
  },

  refFromUrl(url) {
    const text = String(url || '');
    const video = text.match(/\/(?:video|photo)\/(\d+)/);
    if (video) return video[1].toLowerCase();
    const shortcode = text.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/);
    return shortcode ? shortcode[1].toLowerCase() : null;
  },

  fromHarvest(profile, task) {
    if (!profile || !task || !Array.isArray(profile.posts)) return null;
    const ref = this.refFromUrl(task.url);
    if (!ref) return null;

    const post = profile.posts.find((entry) => {
      if (!entry) return false;
      const candidate = entry.id ? String(entry.id).toLowerCase() : this.refFromUrl(entry.url);
      return candidate === ref;
    });
    if (!post) return null;

    return this.resultFromTask({
      platform: task.platform,
      url: task.url,
      username: task.username,
      cachedPost: {
        platform: profile.platform || task.platform,
        username: profile.username || task.username,
        url: post.url || task.url,
        likes: post.likes,
        comments: post.comments,
        views: post.views,
        shares: post.shares,
        followerCount: profile.followerCount,
        caption: post.caption,
        postDate: post.postedAt,
        fetchedAt: new Date().toISOString(),
      },
    });
  },

  resultFromTask(task, nowMs = Date.now()) {
    const cached = task && task.cachedPost;
    if (!cached || typeof cached !== 'object') return null;

    const measured = this.METRIC_FIELDS.filter((f) => this._hasNumber(cached[f]));
    if (measured.length === 0) return null;

    const scrapedAt = cached.fetchedAt ? Date.parse(cached.fetchedAt) : NaN;
    if (Number.isNaN(scrapedAt)) return null;
    const age = nowMs - scrapedAt;
    if (age < 0 || age > this.MAX_AGE_MS) return null;

    const complete = this.METRIC_FIELDS.every((f) => this._hasNumber(cached[f]));
    const result = {
      status: complete ? 'OK' : 'PARTIAL',
      platform: cached.platform || task.platform || null,
      username: cached.username || task.username || null,
      url: cached.url || task.url,
      likes: this._hasNumber(cached.likes) ? Number(cached.likes) : null,
      comments: this._hasNumber(cached.comments) ? Number(cached.comments) : null,
      views: this._hasNumber(cached.views) ? Number(cached.views) : null,
      shares: this._hasNumber(cached.shares) ? Number(cached.shares) : null,
      followerCount: this._hasNumber(cached.followerCount) ? Number(cached.followerCount) : null,
      postDate: cached.postDate || null,
      caption: cached.caption || null,
      source: 'profile-visit',
      cachedAt: cached.fetchedAt,
    };

    if (!complete && result.views === null && result.likes !== null && result.comments !== null) {
      result.status = 'OK';
      result.viewsMissingReason = 'photo post has no view counter';
    }
    return result;
  },
};

module.exports = TaskCache;