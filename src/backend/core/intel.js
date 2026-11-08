'use strict';
/**
 * sunscrap — intel akun
 * Mesin deteksi akun ternak / akun kembar, port murni dari backend/database.py.
 * Semua fungsi murni (dict JS, tanpa DB) agar bisa diuji langsung.
 */

const TERNAK_BAND_MIN = 5000;
const TERNAK_BAND_MAX = 20000;
const VIEW_REACH_FLOOR = 3.0;
const IG_LIKE_REACH_FLOOR = 1.0;
const MIN_POSTS_FOR_RATIO = 3;
const MIN_POSTS_FOR_COMMENT_RATIO = 4;
const LIKE_FLOOR_WITHOUT_COMMENTS = 50;
const COMMENT_TO_LIKE_FLOOR = 0.005;
const UPLOAD_BURST_WINDOW_MINUTES = 10;
const UPLOAD_BURST_MIN_COUNT = 3;
const SIBLING_SYNC_WINDOW_MINUTES = 5;
const SIBLING_SYNC_MIN_HITS = 2;
const BIO_CONTACT_MIN_DIGITS = 10; // nomor HP Indonesia ≥ 10 digit; 8 digit tanggal "20261001" tertolak
// Fan-out cutoff: token/ref/template yang dipakai > MAX_FANOUT akun adalah "umum"
// (hotline publik, konten viral), bukan bukti pasangan — mencegah ledakan C(n,2) edge.
const MAX_FANOUT = 50;
// Template caption yang dipakai >10 akun dianggap generik (konten viral), bukan bukti pasangan.
const MAX_TEMPLATE_FANOUT = 10;
const CAPTION_TEMPLATE_PREFIX = 40;
// Caption "mirip" (serupa tapi tak identik): dua akun ditautkan bila caption mereka
// berbagi >= MIN_SHARED_CAPTION_TOKENS token bermakna (panjang >= MIN_CAPTION_TOKEN_LEN,
// bukan stopword/angka). Ambang 3 dipilih agar deskripsi yang benar-benar senada terdeteksi
// tanpa terlalu banyak derau dari kata dagang umum yang sudah masuk daftar stopword.
const MIN_CAPTION_TOKEN_LEN = 3;
const MIN_SHARED_CAPTION_TOKENS = 3;
const CAPTION_STOPWORDS = new Set([
  // kata fungsi id/en agar tidak dianggap "kata kunci bersama"
  'yang', 'dan', 'dengan', 'untuk', 'dari', 'ini', 'itu', 'ada', 'agar', 'atau', 'juga', 'karena',
  'di', 'ke', 'pada', 'akan', 'kamu', 'aku', 'saya', 'kami', 'kita', 'nya', 'aja', 'sih', 'dong',
  'jadi', 'gak', 'ga', 'tak', 'bisa', 'harus', 'sudah', 'lagi', 'lebih', 'sama', 'cuma', 'hanya',
  'the', 'and', 'for', 'with', 'this', 'that', 'you', 'your', 'not', 'but', 'our', 'are', 'was',
  // kata platform/interaksi yang universal
  'follow', 'followers', 'like', 'share', 'comment', 'video', 'photo', 'reels', 'instagram', 'tiktok',
  'fyp', 'foryou', 'viral', 'lihat', 'tonton', 'subscribe', 'subscriber',
]);
const FLAT_FOLLOWER_BANDS = [[TERNAK_BAND_MIN, TERNAK_BAND_MAX], [20000, 100000]];
const FLAT_FOLLOWER_TOLERANCE = 0.03;
const FLAT_FOLLOWER_MIN_POST_GROWTH = 5;

const RISK_LEVELS = [
  ['pola_kembar', 10],
  ['pola_ternak', 6],
  ['amati', 2],
  ['bersih', 0],
];
const RISK_FLOORS = Object.fromEntries(RISK_LEVELS);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RUN_RE = /\d[\d\s\-.,()/]{5,}\d/;
const HASHTAG_RE = /#[a-z0-9_]+/g;
const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /@[\w.]+\b/g;
const DIGITS_RE = /\d+(?:[.,]\d+)?/g;
const NON_WORD_RE = /[^a-z0-9#\s]/g;

const { cleanText, cleanUsername, toNumber, parseUtc, displayInt, displayPct } = require('./util');

function _accountKey(platform, username) {
  const handle = cleanUsername(username);
  if (!handle) return null;
  return `${platform || 'unknown'}:${handle}`;
}

function _number(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function _median(values) {
  const numbers = (values || []).map(_number).filter((v) => v !== null).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const mid = Math.floor(numbers.length / 2);
  if (numbers.length % 2) return numbers[mid];
  return (numbers[mid - 1] + numbers[mid]) / 2.0;
}

function _minuteOf(value) {
  const parsed = parseUtc(value);
  return parsed ? Math.floor(parsed.getTime() / 60000) : null;
}

function _ageMinutes(value, now) {
  const parsed = parseUtc(value);
  if (!parsed) return null;
  const base = now || new Date();
  return Math.floor((base.getTime() - parsed.getTime()) / 60000);
}

function _normalizePhone(digits) {
  let text = String(digits).replace(/\D/g, '');
  if (text.startsWith('0062')) text = text.slice(4);
  else if (text.startsWith('62')) text = text.slice(2);
  else if (text.startsWith('0')) text = text.slice(1);
  return text.length >= BIO_CONTACT_MIN_DIGITS ? text : null;
}

function bioContactTokens(bio) {
  const tokens = new Set();
  const text = cleanText(bio, 300) || '';
  for (const match of text.matchAll(new RegExp(EMAIL_RE.source, 'g'))) {
    tokens.add('email:' + match[0].toLowerCase());
  }
  for (const match of text.matchAll(new RegExp(PHONE_RUN_RE.source, 'g'))) {
    const phone = _normalizePhone(match[0]);
    if (phone) tokens.add('phone:' + phone);
  }
  return tokens;
}

function captionTemplateKey(caption) {
  let text = String(caption || '').toLowerCase();
  text = text.replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(HASHTAG_RE, ' ');
  text = text.replace(DIGITS_RE, '#').replace(NON_WORD_RE, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length < CAPTION_TEMPLATE_PREFIX) return null;
  return text.slice(0, CAPTION_TEMPLATE_PREFIX);
}

/** Token "bermakna" dari caption untuk membandingkan deskripsi antar akun. */
function captionTokens(caption) {
  if (!caption) return [];
  let text = String(caption).toLowerCase();
  text = text.replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(HASHTAG_RE, ' ');
  text = text.replace(DIGITS_RE, ' ').replace(NON_WORD_RE, ' ');
  return text.split(/\s+/).map((t) => t.trim()).filter((t) =>
    t.length >= MIN_CAPTION_TOKEN_LEN && /[a-z]/.test(t) && !CAPTION_STOPWORDS.has(t));
}

function _pairOff(keys, reason, links) {
  const ordered = Array.from(new Set(keys)).sort();
  if (ordered.length > MAX_FANOUT) return; // token/ref umum -> bukan bukti, cegah O(n^2)
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      (links[a] ||= {});
      (links[b] ||= {});
      (links[a][b] ||= new Set()).add(reason);
      (links[b][a] ||= new Set()).add(reason);
    }
  }
}

function sharedCaptionTemplates(postsByAccount) {
  const byTemplate = {};
  for (const [key, posts] of Object.entries(postsByAccount)) {
    for (const post of posts) {
      const template = captionTemplateKey(post.caption);
      if (template) (byTemplate[template] ||= new Set()).add(key);
    }
  }
  return new Set(Object.entries(byTemplate).filter(([, keys]) => keys.size >= 2).map(([t]) => t));
}

function findAccountLinks(accounts, postsByAccount) {
  const links = {};
  const byRef = {};
  const byBucket = {};
  const byBase = {};

  for (const [key, posts] of Object.entries(postsByAccount)) {
    const platform = key.split(':', 1)[0];
    for (const post of posts) {
      const ref = post.post_ref;
      if (ref) {
        const rkey = `${platform}:${String(ref)}`;
        (byRef[rkey] ||= []).push(key);
      }
      const minute = _minuteOf(post.posted_at);
      if (minute !== null) {
        const bucket = `${platform}:${Math.floor(minute / SIBLING_SYNC_WINDOW_MINUTES)}`;
        (byBucket[bucket] ||= new Set()).add(key);
      }
    }
  }

  for (const keys of Object.values(byRef)) _pairOff(keys, 'konten', links);

  const syncHits = {};
  for (const keys of Object.values(byBucket)) {
    if (keys.size < 2 || keys.size > MAX_FANOUT) continue; // bucket raksasa = sinyal umum
    for (const key of keys) {
      for (const other of keys) {
        if (other !== key) {
          syncHits[`${key}|${other}`] = (syncHits[`${key}|${other}`] || 0) + 1;
        }
      }
    }
  }
  for (const [pair, hits] of Object.entries(syncHits)) {
    if (hits < SIBLING_SYNC_MIN_HITS) continue;
    const [first, second] = pair.split('|');
    if (first < second) _pairOff([first, second], 'serentak', links);
  }

  const byToken = {};
  for (const account of accounts) {
    const key = _accountKey(account.platform, account.username);
    if (!key) continue;
    for (const token of bioContactTokens(account.bio)) {
      (byToken[token] ||= []).push(key);
    }
  }
  for (const keys of Object.values(byToken)) _pairOff(keys, 'kontak', links);

  // Nama berpola: akun dengan basis nama sama (digit/akhiran dibuang) dalam platform sama,
  // dan minimal satu di antaranya memang memakai akhiran angka (pola "akun", "akun2", "akun3").
  for (const account of accounts) {
    const key = _accountKey(account.platform, account.username);
    if (!key) continue;
    const raw = key.split(':').slice(1).join(':').toLowerCase().replace(/[^a-z0-9]/g, '');
    const base = raw.replace(/[0-9]+$/, '');
    if (base.length < 4) continue;
    const entry = (byBase[`${account.platform}:${base}`] ||= { keys: [], numeric: false });
    entry.keys.push(key);
    if (raw !== base) entry.numeric = true;
  }
  for (const entry of Object.values(byBase)) {
    if (entry.numeric && entry.keys.length >= 2) _pairOff(entry.keys, 'nama', links);
  }

  const byTemplate = {};
  for (const [key, posts] of Object.entries(postsByAccount)) {
    for (const post of posts) {
      const template = captionTemplateKey(post.caption);
      if (template) (byTemplate[template] ||= new Set()).add(key);
    }
  }
  for (const keys of Object.values(byTemplate)) {
    if (keys.size > MAX_TEMPLATE_FANOUT) continue; // caption generik lintas banyak akun, bukan bukti
    _pairOff(keys, 'template', links);
  }

  // Caption "mirip" (berbagi kata kunci bermakna, bukan identik): indeks token -> akun.
  const bySigToken = {};
  for (const [key, posts] of Object.entries(postsByAccount)) {
    const seen = new Set();
    for (const post of posts) {
      for (const tok of captionTokens(post.caption)) {
        if (seen.has(tok)) continue;
        seen.add(tok);
        (bySigToken[tok] ||= new Set()).add(key);
      }
    }
  }
  const pairHits = {};
  for (const keys of Object.values(bySigToken)) {
    if (keys.size < 2 || keys.size > MAX_FANOUT) continue;
    const arr = Array.from(keys);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const pair = arr[i] < arr[j] ? `${arr[i]}|${arr[j]}` : `${arr[j]}|${arr[i]}`;
        pairHits[pair] = (pairHits[pair] || 0) + 1;
      }
    }
  }
  for (const [pair, hits] of Object.entries(pairHits)) {
    if (hits < MIN_SHARED_CAPTION_TOKENS) continue;
    const [first, second] = pair.split('|');
    ((links[first] ||= {})[second] ||= new Set()).add('caption_mirip');
    ((links[second] ||= {})[first] ||= new Set()).add('caption_mirip');
  }

  return links;
}

function buildClusters(links) {
  const parent = {};
  const find = (node) => {
    (parent[node] ||= node);
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]];
      node = parent[node];
    }
    return node;
  };
  const union = (l, r) => {
    const rl = find(l);
    const rr = find(r);
    if (rl !== rr) {
      // String key dibandingkan leksikografis; Math.min/max menghasilkan NaN untuk string.
      if (rl < rr) parent[rr] = rl;
      else parent[rl] = rr;
    }
  };

  for (const [accountKey, peers] of Object.entries(links)) {
    find(accountKey);
    for (const peer of Object.keys(peers)) union(accountKey, peer);
  }

  const groups = {};
  for (const node of Object.keys(parent)) {
    const root = find(node);
    (groups[root] ||= new Set()).add(node);
  }

  const clusters = [];
  for (const members of Object.values(groups)) {
    if (members.size < 2) continue;
    const reasons = new Set();
    for (const accountKey of members) {
      for (const [peer, kinds] of Object.entries(links[accountKey] || {})) {
        if (members.has(peer)) for (const k of kinds) reasons.add(k);
      }
    }
    clusters.push({
      members: Array.from(members).sort(),
      size: members.size,
      reasons: Array.from(reasons).sort(),
      strong: reasons.has('konten') || reasons.has('kontak'),
    });
  }
  clusters.sort((a, b) => (a.strong === b.strong ? b.size - a.size : (a.strong ? -1 : 1)));
  return clusters;
}

function riskLevel(score) {
  for (const [name, floor] of RISK_LEVELS) {
    if (score >= floor) return name;
  }
  return 'bersih';
}

function analyseAccount(account, posts, historyRows, links, appearance = {}) {
  const key = _accountKey(account.platform, account.username);
  const platform = account.platform;
  const followers = _number(account.follower_count);
  const following = _number(account.following_count);
  posts = posts || [];
  appearance = appearance || {};

  const stamps = posts.map((p) => _minuteOf(p.posted_at)).filter((m) => m !== null).sort((a, b) => a - b);
  const videos = posts.filter((p) => _number(p.views) !== null);
  const liked = posts.filter((p) => _number(p.likes) !== null);
  const medianViews = _median(videos.map((p) => p.views));
  const medianLikes = _median(liked.map((p) => p.likes));
  const medianComments = _median(posts.map((p) => p.comments));
  const medianShares = _median(posts.map((p) => p.shares));

  const viewReach = (followers && medianViews !== null) ? medianViews / followers * 100.0 : null;
  const likeReach = (followers && medianLikes !== null) ? medianLikes / followers * 100.0 : null;

  let postsPerWeek = null;
  if (stamps.length >= 2) {
    const spanMinutes = stamps[stamps.length - 1] - stamps[0];
    if (spanMinutes > 0) postsPerWeek = Math.round((stamps.length / (spanMinutes / (60.0 * 24.0 * 7.0))) * 100) / 100;
  }

  let burst = 0;
  for (let index = 0; index < stamps.length; index++) {
    const start = stamps[index];
    let count = 1;
    for (let other = index + 1; other < stamps.length; other++) {
      if (stamps[other] - start < UPLOAD_BURST_WINDOW_MINUTES) count++;
      else break;
    }
    burst = Math.max(burst, count);
  }

  const months = (historyRows || [])
    .filter((r) => _number(r.follower_count) !== null)
    .sort((a, b) => (a.month || '').localeCompare(b.month || ''));
  const monthValues = months.map((r) => _number(r.follower_count));
  let followerDeltaPct = null;
  let postGrowth = null;
  if (monthValues.length >= 2 && monthValues[0]) {
    const low = Math.min(...monthValues);
    const high = Math.max(...monthValues);
    followerDeltaPct = Math.round((high - low) / low * 10000) / 100;
    const counts = months.map((r) => _number(r.post_count));
    if (counts[0] !== null && counts[counts.length - 1] !== null) postGrowth = counts[counts.length - 1] - counts[0];
  }

  const inBand = Boolean(followers && followers >= TERNAK_BAND_MIN && followers <= TERNAK_BAND_MAX);
  const flags = [];
  const flag = (kindName, label, detail, points) => {
    flags.push({ key: kindName, label, detail, points });
  };

  const isTiktok = platform === 'tiktok';
  const reach = isTiktok ? viewReach : likeReach;
  const floorValue = isTiktok ? VIEW_REACH_FLOOR : IG_LIKE_REACH_FLOOR;
  const unit = isTiktok ? 'views' : 'likes';
  const sample = isTiktok ? videos.length : liked.length;
  if (reach !== null && followers >= TERNAK_BAND_MIN && followers <= TERNAK_BAND_MAX && sample >= MIN_POSTS_FOR_RATIO) {
    if (reach < floorValue) {
      flag('reach_rendah', 'Jangkauan rendah',
        `Rata-rata ${displayInt(isTiktok ? medianViews : medianLikes)} ${unit} dari ${displayInt(followers)} followers (${displayPct(reach)})`, 2);
    }
  }

  // Median komentar null = data komentar tak terbaca; jangan vonis "nyaris nol".
  if (liked.length >= MIN_POSTS_FOR_COMMENT_RATIO && medianLikes && medianLikes >= LIKE_FLOOR_WITHOUT_COMMENTS
      && medianComments !== null) {
    const commentsValue = medianComments;
    if (commentsValue <= Math.max(1.0, medianLikes * COMMENT_TO_LIKE_FLOOR)) {
      flag('komentar_minim', 'Komentar nyaris nol',
        `${liked.length} unggahan rata-rata ${displayInt(medianLikes)} likes tetapi hanya ${displayInt(commentsValue)} komentar`, 2);
    }
  }

  if (burst >= UPLOAD_BURST_MIN_COUNT) {
    flag('unggah_bertumpuk', 'Unggahan bertumpuk',
      `${burst} unggahan dalam ${UPLOAD_BURST_WINDOW_MINUTES} menit, pola antrean upload satu perangkat`, 2);
  }

  const reasonsByPeer = {};
  for (const [peer, kinds] of Object.entries(links || {})) {
    for (const kind of kinds) (reasonsByPeer[kind] ||= new Set()).add(peer);
  }
  const peerList = (kind) =>
    Array.from(reasonsByPeer[kind] || []).sort()
      .map((peer) => '@' + peer.split(':').pop()).join(', ');

  if (reasonsByPeer.konten) flag('konten_kembar', 'Unggahan sama di akun lain',
    `Ref posting yang sama juga muncul di ${peerList('konten')}`, 4);
  if (reasonsByPeer.kontak) flag('kontak_bio_sama', 'Kontak bio sama',
    `Nomor atau email di bio dipakai juga oleh ${peerList('kontak')}`, 3);
  if (reasonsByPeer.template) flag('caption_template', 'Caption berpola',
    `Caption seragam (hanya angka/hashtag yang beda) dengan ${peerList('template')}`, 2);
  if (reasonsByPeer.caption_mirip) flag('caption_mirip', 'Caption mirip akun lain',
    `Deskripsi berbagi kata kunci dengan ${peerList('caption_mirip')}`, 1);
  if (reasonsByPeer.serentak) flag('unggah_serentak', 'Unggahan serentak',
    `Jam upload bergeser beberapa menit saja dengan ${peerList('serentak')}`, 1);

  if (monthValues.length >= 2 && followerDeltaPct !== null) {
    const bandFlat = FLAT_FOLLOWER_BANDS.some(([lo, hi]) => followers >= lo && followers <= hi);
    const steady = followerDeltaPct <= FLAT_FOLLOWER_TOLERANCE * 100.0;
    const keptUploading = postGrowth === null || postGrowth >= FLAT_FOLLOWER_MIN_POST_GROWTH;
    if (bandFlat && steady && keptUploading) {
      flag('followers_datar', 'Followers tidak pernah bergerak',
        `Selisih ${displayPct(followerDeltaPct)} antara ${monthValues.length} bulan (${displayInt(monthValues[0])} → ${displayInt(monthValues[monthValues.length - 1])}) sementara upload jalan terus`, 2);
    }
  }

  // Lonjakan followers tak wajar: pertumbuhan bulan terakhir jauh di atas median pertumbuhan.
  if (monthValues.length >= 3) {
    const growths = [];
    for (let i = 1; i < monthValues.length; i++) {
      if (monthValues[i - 1] > 0) growths.push((monthValues[i] - monthValues[i - 1]) / monthValues[i - 1]);
    }
    if (growths.length >= 2) {
      const last = growths[growths.length - 1];
      const medianGrowth = _median(growths);
      if (medianGrowth !== null && last > 0.10 && last > (medianGrowth * 3) + 0.05) {
        flag('followers_spike', 'Lonjakan followers',
          `Tumbuh ${displayPct(last * 100)} pada bulan terakhir, sementara median bulanan hanya ${displayPct(medianGrowth * 100)}`, 2);
      }
    }
  }

  if (following !== null && followers && followers < TERNAK_BAND_MAX && following >= followers) {
    flag('akun_salur', 'Following lebih banyak dari followers',
      `${displayInt(following)} following berbanding ${displayInt(followers)} followers, ciri akun salur`, 1);
  }

  // Kejujuran data: akun di band ternak yang terlihat "bersih" padahal sinyal kuncinya
  // belum sempat dihitung (data unggahan kurang) diberi catatan — bukan vonis, supaya
  // tidak disalahartikan sebagai "bebas risiko".
  const dataComplete = followers !== null && reach !== null && posts.length >= MIN_POSTS_FOR_RATIO;
  if (flags.length === 0 && inBand && !dataComplete) {
    flag('data_tidak_lengkap', 'Belum bisa dinilai',
      `Baru ${posts.length} unggahan terbaca — sinyal jangkauan/komentar belum dapat dihitung`, 0);
  }

  let score = flags.reduce((sum, f) => sum + f.points, 0);
  if (account.is_verified) score = Math.max(0, score - 1);
  let level = riskLevel(score);
  const strong = Boolean((reasonsByPeer.konten || reasonsByPeer.kontak));
  if (strong && (level === 'bersih' || level === 'amati')) level = 'pola_ternak';

  const age = _ageMinutes(account.fetched_at);

  return {
    key,
    platform,
    username: account.username,
    display_name: account.display_name || null,
    bio: account.bio || null,
    region: account.region || null,
    external_id: account.external_id || null,
    avatar_url: account.avatar_url || null,
    is_verified: Boolean(account.is_verified),
    followers: followers !== null ? Math.round(followers) : null,
    following: following !== null ? Math.round(following) : null,
    post_count: account.post_count !== null && account.post_count !== undefined ? Math.round(account.post_count) : null,
    fetched_at: account.fetched_at || null,
    data_age_minutes: age,
    needs_refresh: age === null || age > (7 * 24 * 60),
    in_ternak_band: inBand,
    data_incomplete: !dataComplete,
    audits_seen: appearance.audits_seen || 0,
    targets_seen: appearance.targets_seen || 0,
    last_verified_at: appearance.last_verified_at || null,
    months_seen: monthValues.length,
    follower_delta_pct: followerDeltaPct,
    metrics: {
      posts_seen: posts.length,
      videos_seen: videos.length,
      median_views: medianViews !== null ? Math.round(medianViews) : null,
      median_likes: medianLikes !== null ? Math.round(medianLikes) : null,
      median_comments: medianComments !== null ? Math.round(medianComments) : null,
      median_shares: medianShares !== null ? Math.round(medianShares) : null,
      view_reach_pct: viewReach !== null ? Math.round(viewReach * 100) / 100 : null,
      like_reach_pct: likeReach !== null ? Math.round(likeReach * 100) / 100 : null,
      posts_per_week: postsPerWeek,
      upload_burst: burst,
    },
    flags,
    score,
    level,
    peers: Object.keys(links || {}).sort(),
    peer_reasons: Object.fromEntries(
      Object.entries(links || {}).map(([peer, kinds]) => [peer, Array.from(kinds).sort()]),
    ),
  };
}

/**
 * Bangun snapshot intel dari himpunan baris mentah (tanpa akses DB).
 * Dipanggil db.js dengan hasil query; return { items, links, clusters, shared_templates }.
 */
function snapshotFromRows(accountRows, postRows, historyRows, targetRows) {
  const postsByAccount = {};
  for (const post of postRows) {
    const key = _accountKey(post.platform, post.username);
    if (key) (postsByAccount[key] ||= []).push(post);
  }
  const historyByAccount = {};
  for (const row of historyRows) {
    const key = _accountKey(row.platform, row.username);
    if (key) (historyByAccount[key] ||= []).push(row);
  }
  const appearance = {};
  for (const row of targetRows) {
    const key = _accountKey(row.platform, row.username);
    if (!key) continue;
    const entry = (appearance[key] ||= { audits: new Set(), targets: 0, last_verified_at: null });
    entry.audits.add(row.audit_id);
    entry.targets += 1;
    const stamp = row.last_scraped_at;
    if (stamp && (entry.last_verified_at === null || stamp > entry.last_verified_at)) entry.last_verified_at = stamp;
  }

  const links = findAccountLinks(accountRows, postsByAccount);
  const clusters = buildClusters(links);
  const sharedTemplates = sharedCaptionTemplates(postsByAccount);

  const items = [];
  for (const account of accountRows) {
    const key = _accountKey(account.platform, account.username);
    if (!key) continue;
    const seen = appearance[key] || {};
    items.push(analyseAccount(
      account,
      postsByAccount[key] || [],
      historyByAccount[key] || [],
      links[key] || {},
      {
        audits_seen: (seen.audits || new Set()).size,
        targets_seen: seen.targets || 0,
        last_verified_at: seen.last_verified_at,
      },
    ));
  }

  return { items, links, clusters, shared_templates: sharedTemplates };
}

module.exports = {
  TERNAK_BAND_MIN, TERNAK_BAND_MAX, VIEW_REACH_FLOOR, IG_LIKE_REACH_FLOOR,
  UPLOAD_BURST_MIN_COUNT, UPLOAD_BURST_WINDOW_MINUTES, FLAT_FOLLOWER_TOLERANCE,
  RISK_LEVELS, RISK_FLOORS, CACHE_TTL_MINUTES: 7 * 24 * 60,
  MAX_FANOUT, MAX_TEMPLATE_FANOUT,
  MIN_CAPTION_TOKEN_LEN, MIN_SHARED_CAPTION_TOKENS, CAPTION_STOPWORDS,
  _accountKey, _number, _median, bioContactTokens, captionTemplateKey, captionTokens,
  sharedCaptionTemplates, findAccountLinks, buildClusters, riskLevel, analyseAccount, snapshotFromRows,
};