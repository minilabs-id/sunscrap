'use strict';
/**
 * sunscraping — renderer
 * Logika dashboard. Memakai API contextBridge `window.sunscraping`.
 */
const api = window.sunscraping;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  tab: 'dashboard',
  audits: [],
  worker: null,
  auditId: null,
  targets: { items: [], total: 0, limit: 50, offset: 0, selected: new Set() },
  accounts: { items: [], total: 0, limit: 100, offset: 0 },
};

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('id-ID');
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}
function relTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
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

// ---------------- browser ----------------
function isSocialHost(url) {
  try {
    const h = new URL(String(url)).hostname.toLowerCase();
    return h === 'instagram.com' || h.endsWith('.instagram.com')
      || h === 'tiktok.com' || h.endsWith('.tiktok.com');
  } catch { return false; }
}
let browserInited = false;
function ensureBrowser() {
  const wv = $('#browser-webview');
  if (!wv || browserInited) return;
  browserInited = true;
  wv.src = 'https://www.instagram.com/';
}
function browserNavigate(url) {
  const wv = $('#browser-webview');
  if (!wv) return;
  let target = String(url || '').trim();
  if (!target) return;
  if (!/^https?:\/\//i.test(target)) {
    target = target.includes('.') ? 'https://' + target : 'https://www.instagram.com/' + encodeURIComponent(target);
  }
  if (!isSocialHost(target)) {
    window.sunscraping.openExternal(target);
    toast('Dibuka di browser luar (bukan sesi login).', 'warning');
    return;
  }
  wv.loadURL(target);
}
function bindBrowser() {
  const wv = $('#browser-webview');
  if (!wv) return;
  wv.addEventListener('will-navigate', (e) => {
    if (!isSocialHost(e.url)) { e.preventDefault(); window.sunscraping.openExternal(e.url); }
  });
  wv.addEventListener('did-navigate', () => { $('#browser-url').value = wv.getURL(); });
  wv.addEventListener('did-navigate-in-page', () => { $('#browser-url').value = wv.getURL(); });
  wv.addEventListener('new-window', (e) => {
    if (/^https?:/i.test(String(e.url))) window.sunscraping.openExternal(e.url);
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
  });
  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3 && e.isMainFrame) toast('Gagal memuat: ' + (e.errorDescription || e.errorCode), 'error');
  });

  $('#browser-go').addEventListener('click', () => browserNavigate($('#browser-url').value));
  $('#browser-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') browserNavigate($('#browser-url').value); });
  $('#browser-back').addEventListener('click', () => { const w = $('#browser-webview'); if (w.canGoBack()) w.goBack(); });
  $('#browser-fwd').addEventListener('click', () => { const w = $('#browser-webview'); if (w.canGoForward()) w.goForward(); });
  $('#browser-reload').addEventListener('click', () => $('#browser-webview').reload());
  $('#browser-ig').addEventListener('click', () => { ensureBrowser(); $('#browser-webview').loadURL('https://www.instagram.com/'); });
  $('#browser-tk').addEventListener('click', () => { ensureBrowser(); $('#browser-webview').loadURL('https://www.tiktok.com/'); });
}

function toast(message, kind = '') {
  const root = $('#toast-root');
  const node = document.createElement('div');
  node.className = 'toast ' + kind;
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  node.textContent = message;
  root.appendChild(node);
  while (root.children.length > 3) root.removeChild(root.firstChild);
  setTimeout(() => node.remove(), kind === 'error' ? 8000 : 4000);
}

let lastFocusElement = null;

function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.classList.add('open');
  $('.modal-backdrop', root).addEventListener('click', closeModal);
  lastFocusElement = document.activeElement;
  const first = $('.modal [data-close], .modal input, .modal select, .modal textarea, .modal button', root);
  if (first) first.focus();
  document.body.classList.add('modal-open');
}
function closeModal() {
  $('#modal-root').classList.remove('open');
  $('#modal-root').innerHTML = '';
  document.body.classList.remove('modal-open');
  if (lastFocusElement && typeof lastFocusElement.focus === 'function') lastFocusElement.focus();
  lastFocusElement = null;
}
// Delegasi: tombol [data-close] & tombol Escape selalu bisa menutup modal,
// tanpa inline handler (yang diblokir CSP script-src 'self').
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); return; }
  // Fokus-trap dalam modal.
  const modal = document.querySelector('#modal-root.open .modal');
  if (!modal) return;
  if (e.key === 'Tab') {
    const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

// ---------------- navigation ----------------
const TAB_LABELS = { dashboard: 'Dashboard', targets: 'Target', accounts: 'Akun', browser: 'Browser', proses: 'Proses', settings: 'Pengaturan' };
function handleMenuAction(action) {
  if (action === 'import') openNewAudit();
  else if (action === 'export') openExport();
  else if (action === 'backup') {
    api.dbBackup().then((r) => { if (r.error) toast(r.error, 'error'); else if (!r.canceled) toast('Cadangan tersimpan.', 'ok'); });
  } else if (action && action.startsWith('tab:')) {
    const tab = action.slice(4);
    const link = $$('.nav-link').find((l) => l.dataset.tab === tab);
    if (link) link.click();
  }
}
function updateTitlebarContext() {
  const tab = TAB_LABELS[state.tab] || 'Dashboard';
  const audit = (state.audits || []).find((a) => a.id === state.auditId);
  const context = audit && state.tab !== 'browser' && state.tab !== 'settings' ? `${tab} · ${audit.name}` : tab;
  const el = $('#titlebar-context');
  if (el) el.textContent = context;
  document.title = `${context} — sunscraping`;
}
$$('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    $$('.nav-link').forEach((l) => { l.classList.remove('active'); l.removeAttribute('aria-current'); });
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
    state.tab = link.dataset.tab;
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $('#tab-' + state.tab).classList.add('active');
    updateTitlebarContext();
    if (state.tab === 'targets') loadTargets();
    if (state.tab === 'accounts') loadAccounts();
    if (state.tab === 'browser') ensureBrowser();
    if (state.tab === 'proses') loadProcess();
    if (state.tab === 'settings') loadSettings();
  });
});

// ---------------- worker ----------------
function renderWorker() {
  const w = state.worker;
  const dot = $('#worker-dot');
  const label = $('#worker-label');
  const toggle = $('#worker-toggle');
  const sub = $('#worker-sub');
  if (!w) return;
  dot.className = 'dot ' + (w.active ? 'active' : (w.lastError ? 'error' : ''));
  label.textContent = w.active ? 'Aktif' : (w.lastError ? 'Terhenti' : 'Siaga');
  toggle.textContent = w.active ? 'Hentikan worker' : 'Mulai worker';
  toggle.classList.toggle('btn-primary', !w.active);
  toggle.classList.toggle('btn-danger', w.active);
  const r = w.rate || {};
  sub.textContent = w.lastError
    ? w.lastError
    : (r.cycleRemaining !== undefined ? `Siklus ${r.cycleRemaining}/${r.visitBudget} · ${r.modeLabel || ''}` : '');
  // detail panel
  const d = $('#worker-detail');
  if (d) {
    d.innerHTML = `
      <div class="kpi"><div class="lbl">Kunjungan siklus</div><div class="num">${fmt(r.cycleVisits)} / ${fmt(r.visitBudget)}</div></div>
      <div class="kpi"><div class="lbl">Hari ini</div><div class="num">${fmt(r.dailyVisits)} / ${fmt(r.dailyRail)}</div></div>
      <div class="kpi"><div class="lbl">Pace</div><div class="num">${esc(r.paceLabel || '—')}</div></div>
      <div class="kpi"><div class="lbl">Sesi</div><div class="num">${fmt(r.sessionTasks)} / ${fmt(r.sessionBreakAt)}</div></div>`;
  }

  // Banner login kedaluwarsa bila worker terhenti karena AUTH.
  const banner = $('#auth-banner');
  if (banner) {
    const isAuth = w.lastError && /login|session|auth|kedaluwarsa|masuk|berakhir/i.test(String(w.lastError));
    banner.hidden = !isAuth;
    if (isAuth) $('#auth-banner-text').textContent = w.lastError;
  }
}

async function toggleWorker() {
  if (state.worker && state.worker.active) await api.workerStop();
  else await api.workerStart();
  await refreshWorker();
}

// ---------------- tab: dashboard ----------------
function kpi(num, label, sub = '') {
  return `<div class="kpi"><div class="num">${num}</div><div class="lbl">${label}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function renderDashboard(summary) {
  const k = summary.kpi || {};
  $('#kpi-strip').innerHTML =
    kpi(fmt(k.targets), 'Target') +
    kpi(fmt(k.scraped), 'Diproses') +
    kpi(fmt(k.verified), 'Terverifikasi', `OK ${fmt(k.ok)} · sebagian ${fmt(k.partial)}`) +
    kpi(fmtPct(k.success_rate), 'Keberhasilan') +
    kpi(fmt(k.failed), 'Gagal') +
    kpi(fmt(k.accounts), 'Akun');

  const posts = summary.posts || {};
  $('#top-views').innerHTML = (posts.top_views || []).map((p) =>
    `<div class="row-item"><a href="${esc(p.url)}" title="${esc(p.url)}">${esc(p.handle)}</a> <span class="num">${fmt(p.views)} views</span> <span class="muted">${fmtPct(p.er)}</span></div>`
  ).join('') || '<div class="muted">Belum ada data.</div>';
  $('#top-er').innerHTML = (posts.top_er || []).map((p) =>
    `<div class="row-item"><a href="${esc(p.url)}" title="${esc(p.url)}">${esc(p.handle)}</a> <span class="muted">${fmtPct(p.er)} ER</span></div>`
  ).join('') || '<div class="muted">Belum ada data.</div>';

  $('#platform-table').innerHTML = `
    <thead><tr><th>Platform</th><th class="num">Target</th><th class="num">Views</th><th class="num">Likes</th><th class="num">Median ER</th></tr></thead>
    <tbody>${(summary.platforms || []).map((p) =>
      `<tr><td><span class="badge ${p.platform === 'instagram' ? 'ig' : 'tk'}">${p.platform}</span></td>
      <td class="num">${fmt(p.targets)}</td><td class="num">${fmt(p.views)}</td><td class="num">${fmt(p.likes)}</td><td class="num">${p.median_er !== null && p.median_er !== undefined ? fmtPct(p.median_er) : '—'}</td></tr>`
    ).join('')}</tbody>`;

  const q = summary.quality || {};
  $('#quality').innerHTML = `
    <div class="kpi"><div class="num">${fmt(q.without_followers)}</div><div class="lbl">Tanpa followers</div></div>
    <div class="kpi"><div class="num">${fmt(q.partial)}</div><div class="lbl">Sebagian</div></div>
    <div class="kpi"><div class="num">${fmt(q.missing_views)}</div><div class="lbl">TikTok tanpa views</div></div>
    <div class="kpi"><div class="num">${fmt(q.missing_username)}</div><div class="lbl">Tanpa handle</div></div>
    <div class="kpi"><div class="num">${fmt(q.never_scraped)}</div><div class="lbl">Belum diproses</div></div>`;
}

async function loadRiskAccounts() {
  try {
    const res = await api.getAccounts({ sort: 'risk', limit: 5 });
    const flagged = (res.items || []).filter((a) => a.score > 0);
    $('#risk-accounts').innerHTML = flagged.length
      ? flagged.map((a) =>
          `<div class="row-item clickable" data-account="${esc(a.username)}" data-platform="${esc(a.platform)}">
            <span class="badge lv-${esc(a.level)}">${esc(a.level)}</span>
            @${esc(a.username)} <span class="num">skor ${fmt(a.score)}</span> <span class="muted">${fmt(a.followers)} follower</span>
          </div>`).join('')
      : '<div class="muted">Tidak ada akun dengan skor risiko > 0.</div>';
    $$('#risk-accounts .clickable').forEach((el) => el.addEventListener('click', () => openAccount(el.dataset.account, el.dataset.platform)));
  } catch {}
}

// ---------------- tab: target ----------------
async function loadTargets() {
  const params = {
    auditId: state.auditId || undefined,
    q: $('#target-q').value || undefined,
    status: $('#target-status').value || undefined,
    platform: $('#target-platform').value || undefined,
    sort: $('#target-sort').value,
    limit: state.targets.limit,
    offset: state.targets.offset,
  };
  const res = await api.getTargets(params);
  state.targets.items = res.items || [];
  state.targets.total = res.total || 0;
  $('#targets-total').textContent = `${fmt(res.total)} target`;
  $('#targets-page').textContent = `Hal ${Math.floor(state.targets.offset / state.targets.limit) + 1} / ${Math.max(1, Math.ceil(res.total / state.targets.limit))}`;

  const tbody = state.targets.items.map((r) => {
    const checked = state.targets.selected.has(r.target_id);
    return `<tr data-target="${r.target_id}" class="clickable">
      <td><input type="checkbox" class="sel" data-id="${r.target_id}" aria-label="Pilih target @${esc(r.username || r.target_id)}" ${checked ? 'checked' : ''}></td>
      <td><span class="badge ${r.platform === 'instagram' ? 'ig' : 'tk'}">${r.platform === 'instagram' ? 'IG' : 'TT'}</span></td>
      <td class="wrap">@${esc(r.username || '—')}</td>
      <td class="wrap" title="${esc(r.url)}"><a href="${esc(r.url)}">${esc(r.tema || shortUrl(r.url))}</a></td>
      <td class="num">${fmt(r.follower_count)}</td>
      <td class="num">${fmt(r.likes)}</td>
      <td class="num">${fmt(r.comments)}</td>
      <td class="num">${fmt(r.views)}</td>
      <td class="num">${r.engagement_rate !== null && r.engagement_rate !== undefined ? fmtPct(r.engagement_rate) : '—'}</td>
      <td class="muted" title="${esc(fmtWhen(r.snapshot_at))}">${esc(relTime(r.snapshot_at))}</td>
      <td>${statusBadge(r.status)}</td>
    </tr>`;
  }).join('');

  $('#targets-table').innerHTML = `
    <thead><tr><th></th><th>Pl.</th><th>Akun</th><th>Postingan</th><th class="num">Follower</th><th class="num">Likes</th><th class="num">Komen</th><th class="num">Views</th><th class="num">ER</th><th>Di-scrape</th><th>Status</th></tr></thead>
    <tbody>${tbody || `<tr><td colspan="11" class="muted">Tidak ada target.</td></tr>`}</tbody>`;

  $$('#targets-table tr[data-target]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('sel')) return;
      openTarget(Number(row.dataset.target));
    });
  });
  $$('#targets-table .sel').forEach((cb) => cb.addEventListener('change', (e) => {
    const id = Number(e.target.dataset.id);
    if (e.target.checked) state.targets.selected.add(id); else state.targets.selected.delete(id);
    updateRetrySelected();
  }));
}

function shortUrl(url) {
  try { return new URL(url).pathname.slice(0, 40); } catch { return url; }
}

function statusBadge(status) {
  const s = (status || 'PENDING').toLowerCase();
  const label = { ok: 'OK', partial: 'Sebagian', failed: 'Gagal', pending: 'Menunggu', running: 'Berjalan' }[s] || s;
  return `<span class="status ${s}"><span class="sdot"></span>${label}</span>`;
}

function avatarHtml(url, username, large = false) {
  const cls = large ? 'avatar-lg' : '';
  const src = url && url.match(/^https?:/i) ? esc(url) : `sa-avatar://${esc(url)}`;
  const icon = url
    ? `<img class="avatar ${cls}" src="${src}" alt="" loading="lazy">`
    : `<span class="avatar-fallback ${cls}">${esc((username || '?').slice(0, 1).toUpperCase())}</span>`;
  return `<span class="avatar-wrap">${icon}</span>`;
}

function updateRetrySelected() {
  $('#btn-retry-selected').disabled = state.targets.selected.size === 0;
  $('#btn-retry-selected').textContent = state.targets.selected.size ? `Ulangi terpilih (${state.targets.selected.size})` : 'Ulangi terpilih';
}

function openTarget(targetId) {
  api.getTargetHistory(targetId).then((snapshots) => {
    const rows = (snapshots || []).map((s) =>
      `<tr><td>${esc(fmtWhen(s.scraped_at))}</td><td>${statusBadge(s.status)}</td>
      <td class="num">${fmt(s.follower_count)}</td><td class="num">${fmt(s.likes)}</td><td class="num">${fmt(s.comments)}</td><td class="num">${fmt(s.views)}</td>
      <td class="wrap">${esc(s.error_message || '')}</td></tr>`).join('');
    openModal(`
      <div class="modal-head"><h3>Riwayat target</h3><button class="btn btn-ghost" data-close>✕</button></div>
      <div class="modal-body"><table class="table"><thead><tr><th>Waktu</th><th>Status</th><th class="num">Follower</th><th class="num">Likes</th><th class="num">Komen</th><th class="num">Views</th><th>Error</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Belum ada snapshot.</td></tr>'}</tbody></table></div>`);
  });
}

// ---------------- tab: accounts ----------------
async function loadAccounts() {
  const params = {
    q: $('#account-q').value || undefined,
    level: $('#account-level').value || undefined,
    band: $('#account-band').value || undefined,
    platform: $('#account-platform').value || undefined,
    sort: 'risk',
    limit: state.accounts.limit,
    offset: state.accounts.offset,
  };
  const res = await api.getAccounts(params);
  state.accounts.items = res.items || [];
  state.accounts.total = res.total || 0;
  $('#accounts-total').textContent = `${fmt(res.total)} akun · ${fmt((res.summary || {}).flagged)} terindikasi · ${fmt((res.summary || {}).clusters)} klaster`;
  $('#accounts-page').textContent = `Hal ${Math.floor(state.accounts.offset / state.accounts.limit) + 1} / ${Math.max(1, Math.ceil(res.total / state.accounts.limit))}`;
  const legend = $('#account-legend');
  if (legend) legend.innerHTML = `<button class="btn btn-ghost" id="score-help" style="font-size:12px;padding:4px 8px">Bagaimana skor dihitung?</button>`;

  $('#accounts-table').innerHTML = `
    <thead><tr><th>Akun</th><th>Level</th><th class="num">Skor</th><th class="num">Followers</th><th class="num">Reach</th><th class="num">Post</th><th class="num">Bulan</th><th>Indikasi</th></tr></thead>
    <tbody>${state.accounts.items.map((a) =>
      `<tr class="clickable" data-account="${esc(a.username)}" data-platform="${esc(a.platform)}">
        <td>${avatarHtml(a.avatar_url, a.username)}<b>@${esc(a.username)}</b> <span class="muted">${esc(a.display_name || '')}</span></td>
        <td><span class="badge lv-${esc(a.level)}">${esc(a.level.replace('_', ' '))}</span></td>
        <td class="num">${fmt(a.score)}</td>
        <td class="num">${fmt(a.followers)}</td>
        <td class="num">${a.metrics.view_reach_pct !== null ? fmtPct(a.metrics.view_reach_pct) : (a.metrics.like_reach_pct !== null ? fmtPct(a.metrics.like_reach_pct) : '—')}</td>
        <td class="num">${fmt(a.metrics.posts_seen)}</td>
        <td class="num">${fmt(a.months_seen)}</td>
        <td class="wrap">${esc((a.flags || []).map((f) => f.label).join(', ') || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">Belum ada akun tersimpan. Jalankan worker untuk mengisi data.</td></tr>'}</tbody>`;

  $$('#accounts-table tr[data-account]').forEach((row) => row.addEventListener('click', () => openAccount(row.dataset.account, row.dataset.platform)));
  const helpBtn = $('#score-help');
  if (helpBtn) helpBtn.addEventListener('click', showScoreHelp);
}

function showScoreHelp() {
  openModal(`
    <div class="modal-head"><h3>Bagaimana skor dihitung?</h3><button class="btn btn-ghost" data-close>✕</button></div>
    <div class="modal-body">
      <p>Skor adalah agregasi sinyal lemah dari data <b>publik</b> (bukan identitas):</p>
      <ul style="margin:0 0 10px 18px">
        <li><b>+4</b> Unggahan sama muncul di akun lain</li>
        <li><b>+3</b> Kontak (nomor/email) di bio dipakai akun lain</li>
        <li><b>+2</b> Caption seragam lintas akun · jangkauan sangat rendah · komentar nyaris nol · unggahan bertumpuk · follower datar</li>
        <li><b>+1</b> Unggahan serentak · following &gt; follower</li>
      </ul>
      <p class="muted" style="border-left:3px solid var(--warn);padding-left:10px"><b>Disclaimer:</b> ini indikasi otomatis dari data publik — bukan identifikasi orang, bukan vonis. Wajib verifikasi manual sebelum tindakan apa pun. Data dapat dihapus atas permintaan.</p>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Tutup</button></div>`);
}

function openAccount(username, platform) {
  api.getAccountDetail(platform, username).then((detail) => {
    if (!detail) { toast('Akun belum pernah disimpan.', 'error'); return; }
    const flags = (detail.flags || []).map((f) => `<div class="flag"><b>${esc(f.label)}</b> (+${f.points}) — ${esc(f.detail)}</div>`).join('');
    const siblings = (detail.siblings || []).map((s) => `<div class="flag">@${esc(s.username)} — ${esc(s.level)} (${(s.reasons || []).join(', ')})</div>`).join('');
    const history = (detail.history || []).map((h) => `<tr><td>${esc(h.month)}</td><td class="num">${fmt(h.follower_count)}</td><td class="num">${fmt(h.post_count)}</td></tr>`).join('');
    openModal(`
      <div class="modal-head"><h3>${avatarHtml(detail.avatar_url, detail.username, true)}@${esc(detail.username)} <span class="badge lv-${esc(detail.level)}">${esc(detail.level)}</span></h3><button class="btn btn-ghost" data-close>✕</button></div>
      <div class="modal-body">
        <div class="grid-2">
          <div><div class="muted">Followers</div><div class="num" style="font-size:20px">${fmt(detail.followers)}</div></div>
          <div><div class="muted">Median reach</div><div class="num" style="font-size:20px">${detail.metrics.view_reach_pct !== null ? fmtPct(detail.metrics.view_reach_pct) : (detail.metrics.like_reach_pct !== null ? fmtPct(detail.metrics.like_reach_pct) : '—')}</div></div>
        </div>
        <p class="muted">${esc(detail.bio || '(tanpa bio)')}${detail.region ? ' · ' + esc(detail.region) : ''}</p>
        <div class="panel"><div class="panel-title">Indikasi (${fmt(detail.score)} poin)</div>${flags || '<div class="muted">Tidak ada.</div>'}</div>
        ${siblings ? `<div class="panel"><div class="panel-title">Akun tertaut</div>${siblings}</div>` : ''}
        ${history ? `<div class="panel"><div class="panel-title">Seri bulanan</div><table class="table"><thead><tr><th>Bulan</th><th class="num">Followers</th><th class="num">Post</th></tr></thead><tbody>${history}</tbody></table></div>` : ''}
      </div>
      <div class="modal-foot">
        <button class="btn btn-danger" id="del-account" style="margin-right:auto">Hapus data akun ini…</button>
        <button class="btn btn-ghost" data-close>Tutup</button>
      </div>`);
    $('#del-account').addEventListener('click', () => openDeleteAccount(detail.username, detail.platform));
  });
}

function openDeleteAccount(username, platform) {
  openModal(`
    <div class="modal-head"><h3>Hapus data akun</h3><button class="btn btn-ghost" data-close>✕</button></div>
    <div class="modal-body">
      <p>Data akun <b>@${esc(username)}</b> (profil, riwayat bulanan, dan unggahan tersimpan) akan dihapus. Ketik username untuk melanjutkan.</p>
      <div class="field"><label>Ketik @${esc(username)}</label><input id="del-account-confirm" class="input" placeholder="${esc(username)}"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger" id="confirm-del-account" disabled>Hapus</button></div>`);
  const check = () => { $('#confirm-del-account').disabled = $('#del-account-confirm').value.trim() !== username; };
  $('#del-account-confirm').addEventListener('input', check);
  check();
  $('#confirm-del-account').addEventListener('click', async () => {
    const r = await api.deleteAccount(platform, username);
    closeModal();
    if (r.ok) toast(`Data @${username} dihapus.`, 'ok'); else toast('Gagal menghapus data akun.', 'error');
    if (state.tab === 'accounts') loadAccounts();
  });
}

// ---------------- tab: proses ----------------
async function loadProcess() {
  try {
    const s = await api.getQueueStats();
    const eta = (s.pending || 0) + (s.running || 0);
    const etaMin = eta > 0 ? Math.max(1, Math.round(eta * 6 / 60)) : 0;
    const etaText = eta > 0 ? `<div class="sub">≈ ${etaMin} menit untuk ${fmt(eta)} tersisa</div>` : '<div class="sub">Antrean kosong</div>';
    $('#queue-stats').innerHTML =
      kpi(fmt(s.pending), 'Menunggu') + kpi(fmt(s.running), 'Berjalan') + kpi(fmt(s.ok), 'OK') + kpi(fmt(s.failed), 'Gagal');
    let etaEl = $('#queue-eta');
    if (!etaEl) { etaEl = document.createElement('div'); etaEl.id = 'queue-eta'; etaEl.className = 'muted'; $('#queue-stats').insertAdjacentElement('afterend', etaEl); }
    etaEl.innerHTML = etaText;

    const latest = await api.getLatest({ limit: 20 });
    $('#latest-table').innerHTML = `
      <thead><tr><th>Waktu</th><th>Audit</th><th>Akun</th><th class="num">Follower</th><th class="num">Likes</th><th class="num">Views</th><th>Status</th></tr></thead>
      <tbody>${(latest || []).map((r) =>
        `<tr><td>${esc(fmtWhen(r.scraped_at))}</td>
        <td class="wrap">${esc(r.audit_name || '')}</td><td>@${esc(r.username || '—')}</td>
        <td class="num">${fmt(r.follower_count)}</td><td class="num">${fmt(r.likes)}</td><td class="num">${fmt(r.views)}</td>
        <td>${statusBadge(r.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Belum ada aktivitas.</td></tr>'}</tbody>`;
  } catch {}
}

// ---------------- tab: settings ----------------
async function loadSettings() {
  renderAudits();
  try {
    const info = await api.dbInfo();
    $('#db-info').innerHTML = `
      <div class="kpi"><div class="lbl">File</div><div>${esc(info.filename)}</div></div>
      <div class="kpi"><div class="lbl">Ukuran</div><div>${fmt(Math.round((info.size_bytes || 0) / 1024))} KB</div></div>
      <div class="kpi"><div class="lbl">Audit</div><div>${fmt(info.counts && info.counts.audits)}</div></div>
      <div class="kpi"><div class="lbl">Target</div><div>${fmt(info.counts && info.counts.targets)}</div></div>
      <div class="kpi"><div class="lbl">Snapshot</div><div>${fmt(info.counts && info.counts.snapshots)}</div></div>`;
  } catch {}
}

function renderAudits() {
  $('#audits-table').innerHTML = `
    <thead><tr><th>Nama</th><th>Periode</th><th class="num">Target</th><th class="num">Ulang (hari)</th><th class="num">Menunggu</th><th>Status</th><th></th></tr></thead>
    <tbody>${(state.audits || []).map((a) =>
      `<tr>
        <td><b>${esc(a.name)}</b></td><td>${esc(a.period || '—')}</td>
        <td class="num">${fmt(a.target_count)}</td><td class="num">${fmt(a.repeat_days)}</td><td class="num">${fmt(a.pending_count)}</td>
        <td>${esc(a.latest_run_status || '—')}</td>
        <td class="row-gap" style="justify-content:flex-end">
          <button class="btn btn-ghost" data-act="rerun" data-id="${a.id}">Audit ulang</button>
          <button class="btn btn-ghost" data-act="edit" data-id="${a.id}" data-name="${esc(a.name)}" data-repeat="${a.repeat_days}">Edit</button>
          <button class="btn btn-danger" data-act="delete" data-id="${a.id}">Hapus</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Belum ada audit. Klik <b>＋ Import data</b>.</td></tr>'}</tbody>`;

  $$('#audits-table [data-act]').forEach((btn) => btn.addEventListener('click', (e) => {
    const id = Number(btn.dataset.id);
    const act = btn.dataset.act;
    if (act === 'rerun') { api.rerunAudit(id, true).then((r) => toast(r.message || 'Dijadwalkan ulang.')); }
    else if (act === 'delete') {
      const audit = (state.audits || []).find((a) => a.id === id);
      const targetCount = audit ? audit.target_count : 0;
      openModal(`<div class="modal-head"><h3>Hapus audit?</h3></div><div class="modal-body">
        <p>Audit <b>${esc(audit ? audit.name : id)}</b> beserta <b>${fmt(targetCount)} target</b> dan seluruh riwayat snapshots-nya akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.</p>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger" id="confirm-del">Hapus</button></div>`);
      $('#confirm-del').addEventListener('click', async () => { await api.deleteAudit(id); closeModal(); await loadAudits(); });
    } else if (act === 'edit') {
      openModal(`<div class="modal-head"><h3>Edit audit</h3></div><div class="modal-body">
        <div class="field"><label>Nama</label><input id="edit-name" class="input" value="${esc(btn.dataset.name)}"></div>
        <div class="field"><label>Ulang (hari, 0 = manual)</label><input id="edit-repeat" class="input" type="number" min="0" max="365" value="${btn.dataset.repeat}"></div>
      </div><div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="confirm-edit">Simpan</button></div>`);
      $('#confirm-edit').addEventListener('click', async () => {
        await api.updateAudit(id, { name: $('#edit-name').value, repeat_days: Number($('#edit-repeat').value) });
        closeModal(); loadAudits();
      });
    }
  }));
}

function openNewAudit() {
  const auditOptions = `<option value="">— Audit baru —</option>`
    + (state.audits || []).map((a) => `<option value="${a.id}">Tambah ke: ${esc(a.name)}</option>`).join('');
  openModal(`<div class="modal-head"><h3>Import data</h3></div><div class="modal-body">
    <div class="field"><label>Nama audit (untuk audit baru)</label><input id="new-name" class="input" placeholder="mis. Kampanye November"></div>
    <div class="field"><label>Ulang (hari, 0 = manual)</label><input id="new-repeat" class="input" type="number" min="0" max="365" value="0"></div>
    <div class="field"><label>Tujuan</label><select id="new-audit" class="select">${auditOptions}</select></div>
    <button class="btn btn-primary btn-block" id="confirm-file">📄 Pilih file Excel/CSV (kolom Link/URL)</button>
    <div class="modal-divider"><span>atau tempel link langsung</span></div>
    <div class="field"><label>Tempel link postingan — satu per baris (IG /p/, /reel/, /tv/ · TikTok /video/, /photo/)</label>
      <textarea id="new-links" class="input" placeholder="https://www.instagram.com/p/CODE/&#10;https://www.tiktok.com/@user/video/7123456789"></textarea></div>
    <p class="muted">Maksimal 10.000 baris per import.</p>
  </div><div class="modal-foot">
    <button class="btn btn-ghost" data-close>Batal</button>
    <button class="btn btn-ghost" id="confirm-links">Import link</button>
  </div>`);

  const getOpts = () => ({
    name: $('#new-name').value,
    repeat_days: Number($('#new-repeat').value),
    auditId: $('#new-audit').value ? Number($('#new-audit').value) : null,
  });

  $('#confirm-file').addEventListener('click', async () => {
    const opts = getOpts();
    let res;
    if (opts.auditId) res = await api.appendTargets({ auditId: opts.auditId });
    else res = await api.createAudit({ name: opts.name, repeat_days: opts.repeat_days });
    closeModal();
    if (res.canceled) return;
    if (res.error) toast(res.error, 'error');
    else toast(`Import ${fmt(res.inserted)} target (${fmt(res.duplicates)} duplikat, ${fmt(res.skipped)} dilewati).`, 'ok');
    await loadAudits();
    await refreshDashboard();
  });

  $('#confirm-links').addEventListener('click', async () => {
    const text = $('#new-links').value || '';
    if (!text.trim()) { toast('Tempel link dulu, atau pakai "Import file…".', 'error'); return; }
    const opts = getOpts();
    const res = await api.importLinks({ text, name: opts.name, repeat_days: opts.repeat_days, auditId: opts.auditId });
    closeModal();
    if (res.error) toast(res.error, 'error');
    else toast(`Import ${fmt(res.inserted)} target (${fmt(res.duplicates)} duplikat, ${fmt(res.skipped)} dilewati).`, 'ok');
    await loadAudits();
    await refreshDashboard();
  });
}

// ---------------- refresh / init ----------------
function statusToExport(val) {
  return { ok: 'OK', partial: 'PARTIAL', failed: 'FAILED', done: 'DONE' }[val] || null;
}
async function openExport() {
  const val = $('#target-status').value;
  if (val === 'pending' || val === 'running') {
    toast('Belum ada hasil untuk status menunggu/berjalan.', 'warning');
    return;
  }
  const status = statusToExport(val);
  const audit = (state.audits || []).find((a) => a.id === state.auditId);
  const statusLabel = { done: 'Selesai (OK + sebagian)', ok: 'OK', partial: 'Sebagian', failed: 'Gagal' }[val] || 'Semua status';
  const count = await api.exportCount({ auditId: state.auditId || null, status });
  openModal(`
    <div class="modal-head"><h3>Export data</h3><button class="btn btn-ghost" data-close>✕</button></div>
    <div class="modal-body">
      <p>Anda akan mengekspor:</p>
      <ul style="margin:0 0 8px 18px">
        <li><b>Audit:</b> ${esc(audit ? audit.name : 'Semua audit')}</li>
        <li><b>Status:</b> ${esc(statusLabel)}</li>
        <li><b>Baris:</b> ${fmt(count)}</li>
      </ul>
      <p class="muted">File .xlsx berisi kolom metrik + delta + rekap. Simpan di lokasi aman.</p>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>Batal</button>
      <button class="btn btn-primary" id="confirm-export">Unduh .xlsx…</button>
    </div>`);
  $('#confirm-export').addEventListener('click', async () => {
    closeModal();
    const r = await api.exportExcel({ auditId: state.auditId || null, status });
    if (r.error) toast(r.error, 'error'); else if (!r.canceled) toast(`Export selesai: ${fmt(r.rows)} baris.`, 'ok');
  });
}

async function loadAudits() {
  state.audits = await api.getAudits();
  // Reset audit terpilih bila sudah terhapus.
  if (state.auditId && !state.audits.some((a) => a.id === state.auditId)) state.auditId = null;
  const sel = $('#global-audit');
  const current = state.auditId;
  // Jangan bangun ulang dropdown saat poll/fokus (menghindari kedip & fokus hilang).
  const idsKey = state.audits.map((a) => a.id).join(',') + '|' + current;
  if (sel.dataset.key !== idsKey && document.activeElement !== sel) {
    sel.innerHTML = `<option value="">Semua audit</option>` + state.audits.map((a) => `<option value="${a.id}" ${a.id === current ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    sel.dataset.key = idsKey;
  }
  if (state.tab === 'settings') renderAudits();
  updateTitlebarContext();
}

async function refreshWorker() {
  state.worker = await api.workerStatus();
  renderWorker();
  renderStatusBar();
}

let dbInfoCache = null;
function renderStatusBar() {
  const w = state.worker;
  if (w) {
    const label = w.active ? 'Aktif' : (w.lastError ? 'Terhenti' : 'Siaga');
    $('#sb-worker').innerHTML = `<span class="dot ${w.active ? 'active' : (w.lastError ? 'error' : '')}"></span>${label}`;
  }
  const audit = (state.audits || []).find((a) => a.id === state.auditId);
  const sbAudit = $('#sb-audit');
  if (sbAudit) sbAudit.textContent = audit ? `Audit: ${audit.name}` : 'Audit: Semua';
  if (dbInfoCache) {
    $('#sb-db').textContent = `DB ${Math.round(dbInfoCache.size_bytes / 1024)} KB`;
  } else {
    api.dbInfo().then((info) => { dbInfoCache = info; $('#sb-db').textContent = `DB ${Math.round(info.size_bytes / 1024)} KB`; }).catch(() => {});
  }
}

async function refreshDashboard() {
  if (state.tab !== 'dashboard') return;
  try { renderDashboard(await api.getSummary(state.auditId)); await loadRiskAccounts(); } catch {}
}

let pollTimer = null;
async function pollUpdate() {
  await loadAudits();
  await refreshWorker();
  await refreshDashboard();
}
function schedulePoll() {
  if (pollTimer) return;
  pollTimer = setTimeout(() => { pollTimer = null; pollUpdate(); }, 400);
}

// ---------------- bindings ----------------
function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function bindEvents() {
  $('#worker-toggle').addEventListener('click', toggleWorker);
  $('#btn-new-audit').addEventListener('click', openNewAudit);
  $('#global-audit').addEventListener('change', (e) => { state.auditId = e.target.value ? Number(e.target.value) : null; refreshDashboard(); updateTitlebarContext(); renderStatusBar(); });

  // status bar: klik segmen = pindah tab
  $$('#statusbar .sb-item').forEach((el) => {
    el.addEventListener('click', () => {
      const link = $$('.nav-link').find((l) => l.dataset.tab === el.dataset.tab);
      if (link) link.click();
    });
  });

  // targets
  const resetTargets = () => { state.targets.offset = 0; state.targets.selected.clear(); updateRetrySelected(); loadTargets(); };
  ['#target-q', '#target-status', '#target-platform', '#target-sort'].forEach((s) => {
    $(s).addEventListener(s === '#target-q' ? 'input' : 'change', s === '#target-q' ? debounce(resetTargets, 300) : resetTargets);
  });
  $('#targets-prev').addEventListener('click', () => { state.targets.offset = Math.max(0, state.targets.offset - state.targets.limit); loadTargets(); });
  $('#targets-next').addEventListener('click', () => { if ((state.targets.offset + state.targets.limit) < state.targets.total) { state.targets.offset += state.targets.limit; loadTargets(); } });
  $('#btn-retry-failed').addEventListener('click', async () => {
    if (!state.auditId) { toast('Pilih audit dulu.'); return; }
    const r = await api.retryFailed(state.auditId);
    toast(r.message || `Dijadwalkan ulang ${fmt(r.created)} target.`);
    loadTargets();
  });
  $('#btn-retry-selected').addEventListener('click', async () => {
    if (!state.targets.selected.size) return;
    if (!state.auditId) { toast('Pilih audit dulu di dropdown atas.'); return; }
    const r = await api.retryTargets(state.auditId, Array.from(state.targets.selected));
    toast(r.message || `Dijadwalkan ulang ${fmt(r.created)} target.`);
    state.targets.selected.clear(); updateRetrySelected(); loadTargets();
  });
  $('#btn-export').addEventListener('click', openExport);

  // accounts filters
  const resetAccounts = () => { state.accounts.offset = 0; loadAccounts(); };
  ['#account-q', '#account-level', '#account-band', '#account-platform'].forEach((s) => {
    $(s).addEventListener(s === '#account-q' ? 'input' : 'change', s === '#account-q' ? debounce(resetAccounts, 300) : resetAccounts);
  });
  $('#accounts-prev').addEventListener('click', () => { state.accounts.offset = Math.max(0, state.accounts.offset - state.accounts.limit); loadAccounts(); });
  $('#accounts-next').addEventListener('click', () => { if ((state.accounts.offset + state.accounts.limit) < state.accounts.total) { state.accounts.offset += state.accounts.limit; loadAccounts(); } });

  // proses
  $('#btn-login-ig').addEventListener('click', () => api.openLogin('instagram'));
  $('#btn-login-tk').addEventListener('click', () => api.openLogin('tiktok'));
  $('#auth-banner-ig').addEventListener('click', () => api.openLogin('instagram'));
  $('#auth-banner-tk').addEventListener('click', () => api.openLogin('tiktok'));

  // settings
  $('#btn-backup').addEventListener('click', async () => {
    const r = await api.dbBackup();
    if (r.error) toast(r.error, 'error'); else if (!r.canceled) toast('Cadangan tersimpan.', 'ok');
  });
  $('#btn-restore').addEventListener('click', async () => {
    const prev = await api.restorePreview();
    if (prev.canceled) return;
    if (prev.error) { toast(prev.error, 'error'); return; }
    const c = prev.counts || {};
    openModal(`
      <div class="modal-head"><h3>Pulihkan dari cadangan</h3><button class="btn btn-ghost" data-close>✕</button></div>
      <div class="modal-body">
        <p>Anda akan mengganti <b>seluruh data saat ini</b> dengan cadangan:</p>
        <ul style="margin:0 0 8px 18px">
          <li><b>File:</b> ${esc(prev.file)}</li>
          <li>Audit ${fmt(c.audits)} · Target ${fmt(c.targets)} · Snapshot ${fmt(c.snapshots)} · Akun ${fmt(c.accounts)}</li>
        </ul>
        <p class="muted">Data aktif dicadangkan otomatis dulu sebelum diganti. Tindakan ini tidak bisa dibatalkan.</p>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger" id="confirm-restore">Pulihkan</button></div>`);
    $('#confirm-restore').addEventListener('click', async () => {
      const r = await api.restoreCommit(prev.path);
      closeModal();
      if (r.error) toast(r.error, 'error');
      else { toast('Data dipulihkan. Safety backup: ' + r.safety_backup, 'ok'); await pollUpdate(); }
    });
  });
  $('#btn-clear-session').addEventListener('click', () => {
    openModal(`
      <div class="modal-head"><h3>Hapus sesi login?</h3><button class="btn btn-ghost" data-close>✕</button></div>
      <div class="modal-body">
        <p>Sesi login Instagram & TikTok akan dihapus. <b>Worker akan berhenti sampai Anda login ulang.</b> Data audit TIDAK terhapus.</p>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger" id="confirm-clear-session">Hapus sesi</button></div>`);
    $('#confirm-clear-session').addEventListener('click', async () => {
      const r = await api.clearSession();
      closeModal();
      if (r.ok) toast('Sesi login dihapus. Login ulang lewat tray/Browser.', 'ok'); else toast(r.error || 'Gagal hapus sesi.', 'error');
    });
  });
  $('#btn-clear').addEventListener('click', () => {
    openModal(`<div class="modal-head"><h3>Hapus semua data</h3></div><div class="modal-body">
      <p>Semua audit, target, snapshot, dan data akun akan dihapus <b>permanen</b>. Tindakan ini tidak bisa dibatalkan.</p>
      <div class="field"><label>Ketik <b>HAPUS</b> untuk melanjutkan</label><input id="clear-confirm" class="input" placeholder="HAPUS"></div>
      <label class="row-gap" style="margin:6px 0 0"><input type="checkbox" id="clear-backup" checked> Cadangkan database dulu (disarankan)</label>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger" id="confirm-clear" disabled>Hapus semua</button></div>`);
    const checkEnabled = () => { $('#confirm-clear').disabled = $('#clear-confirm').value.trim() !== 'HAPUS'; };
    $('#clear-confirm').addEventListener('input', checkEnabled);
    checkEnabled();
    $('#confirm-clear').addEventListener('click', async () => {
      if ($('#clear-backup').checked) { await api.dbBackup(); }
      await api.clearAll();
      closeModal();
      toast('Data dihapus.', 'ok');
      await pollUpdate();
    });
  });
}

async function init() {
  bindEvents();
  bindBrowser();
  await loadAudits();
  await refreshWorker();
  await refreshDashboard();

  window.sunscraping.onEvent((payload) => {
    if (payload.type === 'worker') { state.worker = payload.payload; renderWorker(); }
    else if (payload.type === 'data') schedulePoll();
    else if (payload.type === 'menu') handleMenuAction(payload.payload && payload.payload.action);
  });

  // polling ringan: worker selalu; tab aktif ikut disegarkan.
  setInterval(() => {
    refreshWorker();
    if (state.tab === 'dashboard') refreshDashboard();
    else if (state.tab === 'proses') loadProcess();
  }, 5000);
}

init();