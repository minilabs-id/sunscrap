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
  accounts: { items: [], total: 0 },
};

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('id-ID');
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------- browser ----------------
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
  wv.loadURL(target);
}
function bindBrowser() {
  const wv = $('#browser-webview');
  if (!wv) return;
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
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.remove(), 4000);
}

function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"></div><div class="modal">${html}</div>`;
  root.classList.add('open');
  $('.modal-backdrop', root).addEventListener('click', closeModal);
}
function closeModal() {
  $('#modal-root').classList.remove('open');
  $('#modal-root').innerHTML = '';
}

// ---------------- navigation ----------------
$$('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    $$('.nav-link').forEach((l) => l.classList.remove('active'));
    link.classList.add('active');
    state.tab = link.dataset.tab;
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $('#tab-' + state.tab).classList.add('active');
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
      <td><input type="checkbox" class="sel" data-id="${r.target_id}" ${checked ? 'checked' : ''}></td>
      <td><span class="badge ${r.platform === 'instagram' ? 'ig' : 'tk'}">${r.platform === 'instagram' ? 'IG' : 'TT'}</span></td>
      <td class="wrap">@${esc(r.username || '—')}</td>
      <td class="wrap" title="${esc(r.url)}"><a href="${esc(r.url)}">${esc(r.tema || shortUrl(r.url))}</a></td>
      <td class="num">${fmt(r.follower_count)}</td>
      <td class="num">${fmt(r.likes)}</td>
      <td class="num">${fmt(r.comments)}</td>
      <td class="num">${fmt(r.views)}</td>
      <td class="num">${r.engagement_rate !== null && r.engagement_rate !== undefined ? fmtPct(r.engagement_rate) : '—'}</td>
      <td>${statusBadge(r.status)}</td>
    </tr>`;
  }).join('');

  $('#targets-table').innerHTML = `
    <thead><tr><th></th><th>Pl.</th><th>Akun</th><th>Postingan</th><th class="num">Follower</th><th class="num">Likes</th><th class="num">Komen</th><th class="num">Views</th><th class="num">ER</th><th>Status</th></tr></thead>
    <tbody>${tbody || `<tr><td colspan="10" class="muted">Tidak ada target.</td></tr>`}</tbody>`;

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

function updateRetrySelected() {
  $('#btn-retry-selected').disabled = state.targets.selected.size === 0;
  $('#btn-retry-selected').textContent = state.targets.selected.size ? `Ulangi terpilih (${state.targets.selected.size})` : 'Ulangi terpilih';
}

function openTarget(targetId) {
  api.getTargetHistory(targetId).then((snapshots) => {
    const rows = (snapshots || []).map((s) =>
      `<tr><td>${esc((s.scraped_at || '').slice(0, 16).replace('T', ' '))}</td><td>${statusBadge(s.status)}</td>
      <td class="num">${fmt(s.follower_count)}</td><td class="num">${fmt(s.likes)}</td><td class="num">${fmt(s.comments)}</td><td class="num">${fmt(s.views)}</td>
      <td class="wrap">${esc(s.error_message || '')}</td></tr>`).join('');
    openModal(`
      <div class="modal-head"><h3>Riwayat target</h3><button class="btn btn-ghost" onclick="closeModal()">✕</button></div>
      <div class="modal-body"><table class="table"><thead><tr><th>Waktu</th><th>Status</th><th class="num">Follower</th><th class="num">Likes</th><th class="num">Komen</th><th class="num">Views</th><th>Error</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Belum ada snapshot.</td></tr>'}</tbody></table></div>`);
  });
}

// ---------------- tab: accounts ----------------
async function loadAccounts() {
  const params = {
    q: $('#account-q').value || undefined,
    level: $('#account-level').value || undefined,
    band: $('#account-band').value || undefined,
    sort: 'risk',
    limit: 200,
  };
  const res = await api.getAccounts(params);
  state.accounts.items = res.items || [];
  $('#accounts-total').textContent = `${fmt(res.total)} akun · ${fmt((res.summary || {}).flagged)} terindikasi · ${fmt((res.summary || {}).clusters)} klaster`;
  $('#account-legend').innerHTML = `<span>Skor: 0 bersih · 2 amati · 6 ternak · 10 kembar</span>`;

  $('#accounts-table').innerHTML = `
    <thead><tr><th>Akun</th><th>Level</th><th class="num">Skor</th><th class="num">Followers</th><th class="num">Reach</th><th class="num">Post</th><th class="num">Bulan</th><th>Indikasi</th></tr></thead>
    <tbody>${state.accounts.items.map((a) =>
      `<tr class="clickable" data-account="${esc(a.username)}" data-platform="${esc(a.platform)}">
        <td><b>@${esc(a.username)}</b> <span class="muted">${esc(a.display_name || '')}</span></td>
        <td><span class="badge lv-${esc(a.level)}">${esc(a.level.replace('_', ' '))}</span></td>
        <td class="num">${fmt(a.score)}</td>
        <td class="num">${fmt(a.followers)}</td>
        <td class="num">${a.metrics.view_reach_pct !== null ? fmtPct(a.metrics.view_reach_pct) : (a.metrics.like_reach_pct !== null ? fmtPct(a.metrics.like_reach_pct) : '—')}</td>
        <td class="num">${fmt(a.metrics.posts_seen)}</td>
        <td class="num">${fmt(a.months_seen)}</td>
        <td class="wrap">${esc((a.flags || []).map((f) => f.label).join(', ') || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">Belum ada akun tersimpan. Jalankan worker untuk mengisi data.</td></tr>'}</tbody>`;

  $$('#accounts-table tr[data-account]').forEach((row) => row.addEventListener('click', () => openAccount(row.dataset.account, row.dataset.platform)));
}

function openAccount(username, platform) {
  api.getAccountDetail(platform, username).then((detail) => {
    if (!detail) { toast('Akun belum pernah disimpan.', 'error'); return; }
    const flags = (detail.flags || []).map((f) => `<div class="flag"><b>${esc(f.label)}</b> (+${f.points}) — ${esc(f.detail)}</div>`).join('');
    const siblings = (detail.siblings || []).map((s) => `<div class="flag">@${esc(s.username)} — ${esc(s.level)} (${(s.reasons || []).join(', ')})</div>`).join('');
    const history = (detail.history || []).map((h) => `<tr><td>${esc(h.month)}</td><td class="num">${fmt(h.follower_count)}</td><td class="num">${fmt(h.post_count)}</td></tr>`).join('');
    openModal(`
      <div class="modal-head"><h3>@${esc(detail.username)} <span class="badge lv-${esc(detail.level)}">${esc(detail.level)}</span></h3><button class="btn btn-ghost" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div class="grid-2">
          <div><div class="muted">Followers</div><div class="num" style="font-size:20px">${fmt(detail.followers)}</div></div>
          <div><div class="muted">Median reach</div><div class="num" style="font-size:20px">${detail.metrics.view_reach_pct !== null ? fmtPct(detail.metrics.view_reach_pct) : (detail.metrics.like_reach_pct !== null ? fmtPct(detail.metrics.like_reach_pct) : '—')}</div></div>
        </div>
        <p class="muted">${esc(detail.bio || '(tanpa bio)')}${detail.region ? ' · ' + esc(detail.region) : ''}</p>
        <div class="panel"><div class="panel-title">Indikasi (${fmt(detail.score)} poin)</div>${flags || '<div class="muted">Tidak ada.</div>'}</div>
        ${siblings ? `<div class="panel"><div class="panel-title">Akun tertaut</div>${siblings}</div>` : ''}
        ${history ? `<div class="panel"><div class="panel-title">Seri bulanan</div><table class="table"><thead><tr><th>Bulan</th><th class="num">Followers</th><th class="num">Post</th></tr></thead><tbody>${history}</tbody></table></div>` : ''}
      </div>`);
  });
}

// ---------------- tab: proses ----------------
async function loadProcess() {
  try {
    const summary = await api.getSummary(state.auditId);
    const k = summary.kpi || {};
    const s = summary.status || {};
    $('#queue-stats').innerHTML =
      kpi(fmt(k.pending), 'Menunggu') + kpi(fmt(k.running), 'Berjalan') + kpi(fmt(k.ok), 'OK') + kpi(fmt(k.failed), 'Gagal');

    const latest = await api.getLatest({ limit: 20 });
    $('#latest-table').innerHTML = `
      <thead><tr><th>Waktu</th><th>Audit</th><th>Akun</th><th class="num">Follower</th><th class="num">Likes</th><th class="num">Views</th><th>Status</th></tr></thead>
      <tbody>${(latest || []).map((r) =>
        `<tr><td>${esc((r.scraped_at || '').slice(0, 16).replace('T', ' '))}</td>
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
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Belum ada audit. Klik "+ Audit baru".</td></tr>'}</tbody>`;

  $$('#audits-table [data-act]').forEach((btn) => btn.addEventListener('click', (e) => {
    const id = Number(btn.dataset.id);
    const act = btn.dataset.act;
    if (act === 'rerun') { api.rerunAudit(id, true).then((r) => toast(r.message || 'Dijadwalkan ulang.')); }
    else if (act === 'delete') {
      openModal(`<div class="modal-head"><h3>Hapus audit?</h3></div><div class="modal-body">Audit beserta seluruh riwayatnya akan dihapus permanen.</div>
        <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Batal</button><button class="btn btn-danger" id="confirm-del">Hapus</button></div>`);
      $('#confirm-del').addEventListener('click', async () => { await api.deleteAudit(id); closeModal(); loadAudits(); });
    } else if (act === 'edit') {
      openModal(`<div class="modal-head"><h3>Edit audit</h3></div><div class="modal-body">
        <div class="field"><label>Nama</label><input id="edit-name" class="input" value="${btn.dataset.name}"></div>
        <div class="field"><label>Ulang (hari, 0 = manual)</label><input id="edit-repeat" class="input" type="number" min="0" max="365" value="${btn.dataset.repeat}"></div>
      </div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="confirm-edit">Simpan</button></div>`);
      $('#confirm-edit').addEventListener('click', async () => {
        await api.updateAudit(id, { name: $('#edit-name').value, repeat_days: Number($('#edit-repeat').value) });
        closeModal(); loadAudits();
      });
    }
  }));
}

function openNewAudit() {
  openModal(`<div class="modal-head"><h3>Audit baru</h3></div><div class="modal-body">
    <div class="field"><label>Nama audit</label><input id="new-name" class="input" placeholder="mis. Kampanye November"></div>
    <div class="field"><label>Ulang (hari, 0 = manual)</label><input id="new-repeat" class="input" type="number" min="0" max="365" value="0"></div>
    <p class="muted">Pilih file CSV/XLSX (kolom Link/URL). Maksimal 10.000 baris.</p>
  </div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="confirm-new">Pilih file…</button></div>`);
  $('#confirm-new').addEventListener('click', async () => {
    const res = await api.createAudit({ name: $('#new-name').value, repeat_days: Number($('#new-repeat').value) });
    closeModal();
    if (res.canceled) return;
    if (res.error) toast(res.error, 'error');
    else toast(`${fmt(res.inserted)} target ditambahkan (${fmt(res.duplicates)} duplikat, ${fmt(res.skipped)} dilewati).`, 'ok');
    await loadAudits();
  });
}

// ---------------- refresh / init ----------------
async function loadAudits() {
  state.audits = await api.getAudits();
  const sel = $('#global-audit');
  const current = state.auditId;
  sel.innerHTML = `<option value="">Semua audit</option>` + state.audits.map((a) => `<option value="${a.id}" ${a.id === current ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  if (state.tab === 'settings') renderAudits();
}

async function refreshWorker() {
  state.worker = await api.workerStatus();
  renderWorker();
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
function bindEvents() {
  $('#worker-toggle').addEventListener('click', toggleWorker);
  $('#btn-new-audit').addEventListener('click', openNewAudit);
  $('#global-audit').addEventListener('change', (e) => { state.auditId = e.target.value ? Number(e.target.value) : null; refreshDashboard(); });

  // targets
  ['#target-q', '#target-status', '#target-platform', '#target-sort'].forEach((s) => {
    $(s).addEventListener(s === '#target-q' ? 'input' : 'change', () => { state.targets.offset = 0; state.targets.selected.clear(); updateRetrySelected(); loadTargets(); });
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
    if (!state.auditId || !state.targets.selected.size) return;
    const r = await api.retryTargets(state.auditId, Array.from(state.targets.selected));
    toast(r.message || `Dijadwalkan ulang ${fmt(r.created)} target.`);
    state.targets.selected.clear(); updateRetrySelected(); loadTargets();
  });
  $('#btn-export').addEventListener('click', async () => {
    const status = $('#target-status').value === 'partial' ? 'PARTIAL' : $('#target-status').value === 'failed' ? 'FAILED' : $('#target-status').value === 'ok' ? 'OK' : undefined;
    const r = await api.exportExcel({ auditId: state.auditId || null, status });
    if (r.error) toast(r.error, 'error'); else if (!r.canceled) toast(`Dicek export ${fmt(r.rows)} baris.`, 'ok');
  });

  // accounts filters
  ['#account-q', '#account-level', '#account-band'].forEach((s) => {
    $(s).addEventListener(s === '#account-q' ? 'input' : 'change', loadAccounts);
  });

  // proses
  $('#btn-login-ig').addEventListener('click', () => api.openLogin('instagram'));
  $('#btn-login-tk').addEventListener('click', () => api.openLogin('tiktok'));

  // settings
  $('#btn-backup').addEventListener('click', async () => {
    const r = await api.dbBackup();
    if (r.error) toast(r.error, 'error'); else if (!r.canceled) toast('Cadangan tersimpan.', 'ok');
  });
  $('#btn-clear').addEventListener('click', () => {
    openModal(`<div class="modal-head"><h3>Hapus semua data?</h3></div><div class="modal-body">Semua audit, target, snapshot, dan data akun akan dihapus permanen.</div>
      <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Batal</button><button class="btn btn-danger" id="confirm-clear">Hapus semua</button></div>`);
    $('#confirm-clear').addEventListener('click', async () => { await api.clearAll(); closeModal(); toast('Data dihapus.'); await pollUpdate(); });
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
  });

  // polling ringan untuk data yang berubah karena worker
  setInterval(() => { refreshWorker(); refreshDashboard(); }, 5000);
}

window.closeModal = closeModal;
window.openAccount = openAccount;
init();