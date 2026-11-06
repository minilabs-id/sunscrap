'use strict';
/**
 * sunscrap — renderer
 * UI v2: Analyst Command Center. Memakai window.sunscrap (preload bridge).
 */
const api = window.sunscrap;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = createState();

const TAB_LABELS = { dashboard: 'Dashboard', targets: 'Target', accounts: 'Akun', browser: 'Sesi', proses: 'Proses', settings: 'Pengaturan' };
const STATE_STATUS_MAP = { ok: 'ok', partial: 'partial', failed: 'failed', pending: 'pending', done: 'done', '': '' };

// ---------- helpers ----------
// Fungsi pemformat & helper murni diekstrak ke `format.js` (dimuat sebelum app.js).
// Tersedia sebagai global (window.fmt, window.esc, dst.) dan diuji lewat `node --test`.

// ---------- toast ----------
function toast(message, kind = '') {
  const root = $('#toast-root');
  const node = document.createElement('div');
  node.className = 'toast' + (kind ? ' ' + kind : '');
  node.setAttribute('role', 'status');
  node.textContent = message;
  root.appendChild(node);
  while (root.children.length > 3) root.removeChild(root.firstChild);
  setTimeout(() => { node.remove(); }, kind === 'error' ? 8000 : 4200);
}

// ---------- modal ----------
let lastFocusElement = null;
function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.classList.add('open');
  const backdrop = $('.modal-backdrop', root);
  if (backdrop) backdrop.addEventListener('click', closeModal);
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
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    const si = $('#global-search');
    if (si) si.focus();
    return;
  }
  if (e.key === 'Escape') { closeModal(); return; }
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

// ---------- browser ----------
function isSocialHost(url) {
  try {
    const h = new URL(String(url)).hostname.toLowerCase();
    return h === 'instagram.com' || h.endsWith('.instagram.com') || h === 'tiktok.com' || h.endsWith('.tiktok.com');
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
  if (!/^https?:\/\//i.test(target)) target = target.includes('.') ? 'https://' + target : 'https://www.instagram.com/' + encodeURIComponent(target);
  if (!isSocialHost(target)) {
    window.sunscrap.openExternal(target);
    toast('Dibuka di browser luar (bukan sesi login).', 'warning');
    return;
  }
  wv.loadURL(target);
}
function bindBrowser() {
  const wv = $('#browser-webview');
  if (!wv) return;
  wv.addEventListener('will-navigate', (e) => { if (!isSocialHost(e.url)) { e.preventDefault(); window.sunscrap.openExternal(e.url); } });
  const sync = () => { const el = $('#browser-url'); if (el) el.value = wv.getURL(); };
  wv.addEventListener('did-navigate', sync);
  wv.addEventListener('did-navigate-in-page', sync);
  wv.addEventListener('new-window', (e) => {
    if (/^https?:/i.test(String(e.url))) window.sunscrap.openExternal(e.url);
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
  });
  wv.addEventListener('did-fail-load', (e) => { if (e.errorCode !== -3 && e.isMainFrame) toast('Gagal memuat: ' + (e.errorDescription || e.errorCode), 'error'); });

  $('#browser-go').addEventListener('click', () => browserNavigate($('#browser-url').value));
  $('#browser-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') browserNavigate($('#browser-url').value); });
  $('#browser-back').addEventListener('click', () => { if (wv.canGoBack()) wv.goBack(); });
  $('#browser-fwd').addEventListener('click', () => { if (wv.canGoForward()) wv.goForward(); });
  $('#browser-reload').addEventListener('click', () => wv.reload());
  $('#browser-ig').addEventListener('click', () => { ensureBrowser(); wv.loadURL('https://www.instagram.com/'); });
  $('#browser-tk').addEventListener('click', () => { ensureBrowser(); wv.loadURL('https://www.tiktok.com/'); });
}

// ---------- tema / density / menu ----------
function applyTheme(theme) {
  if (theme !== 'dark' && theme !== 'light' && theme !== 'system') theme = 'system';
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('sa_theme', theme); } catch { /* non-kritis: abaikan */ }
  try { if (window.sunscrap && window.sunscrap.setTheme) window.sunscrap.setTheme(dark ? 'dark' : 'light'); } catch { /* non-kritis: abaikan */ }
  const radio = document.querySelector(`.theme-radio[data-theme="${theme}"]`);
  if (radio) radio.checked = true;
}
function applyDensity(density) {
  const mode = density === 'auto' ? 'auto' : (['padat', 'normal', 'lapang'].includes(density) ? density : 'auto');
  const resolved = mode === 'auto' ? densityForWidth(window.innerWidth) : mode;
  document.documentElement.dataset.density = resolved;
  try { localStorage.setItem('sa_density', mode); } catch { /* non-kritis: abaikan */ }
  const sel = $('#density-select');
  if (sel) sel.value = mode;
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const t = document.documentElement.dataset.theme || 'system';
  if (t === 'system') applyTheme('system');
});
function handleMenuAction(action) {
  if (action === 'import') openNewAudit();
  else if (action === 'export') openExport();
  else if (action === 'backup') {
    api.dbBackup().then((r) => {
      if (r && r.error) toast(r.error, 'error');
      else if (r && !r.canceled) toast('Cadangan tersimpan.', 'ok');
    }).catch(() => toast('Gagal membuat cadangan.', 'error'));
  } else if (action && action.startsWith('tab:')) activateTab(action.slice(4));
  else if (action && action.startsWith('theme:')) applyTheme(action.slice(6));
}
function updateTitlebarContext() {
  const tab = TAB_LABELS[state.tab] || 'Dashboard';
  const audit = (state.audits || []).find((a) => a.id === state.auditId);
  const context = audit && state.tab !== 'browser' && state.tab !== 'settings' ? `${tab} · ${audit.name}` : tab;
  const el = $('#titlebar-context');
  if (el) el.textContent = context;
  document.title = `${context} — sunscrap`;
}
function activateTab(name) {
  state.tab = name;
  $$('.nav-link').forEach((l) => {
    const active = l.dataset.tab === name;
    l.classList.toggle('active', active);
    if (active) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current');
  });
  $$('.tab').forEach((t) => t.classList.remove('active'));
  const tab = $('#tab-' + name);
  if (tab) tab.classList.add('active');
  updateTitlebarContext();
  if (name === 'targets') loadTargets();
  if (name === 'accounts') loadAccounts();
  if (name === 'browser') { ensureBrowser(); renderLoginStatus(); }
  if (name === 'proses') loadProcess();
  if (name === 'settings') loadSettings();
}
$$('.nav-link').forEach((link) => link.addEventListener('click', () => activateTab(link.dataset.tab)));

// ---------- worker ----------
const ARC_LEN = 251; // arc length untuk gauge 0-100%
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
  const cyclePct = r.visitBudget ? Math.min(100, Math.round((r.cycleVisits || 0) / r.visitBudget * 100)) : 0;
  const fill = $('#worker-rail-fill');
  if (fill) fill.style.width = cyclePct + '%';
  const track = fill ? fill.closest('.worker-rail-track') : null;
  if (track) track.setAttribute('aria-valuenow', String(cyclePct));
  sub.textContent = w.lastError
    ? w.lastError
    : (r.cycleRemaining !== undefined ? `Siklus ${fmt(r.cycleVisits)}/${fmt(r.visitBudget)} · pace ${r.paceLabel || '—'}` : '');

  // gauge pace (arc = progres budget siklus)
  const gauge = $('#pace-gauge-fill');
  if (gauge) {
    const target = r.visitBudget ? Math.min(ARC_LEN, Math.max(0, ARC_LEN * cyclePct / 100)) : 0;
    gauge.style.strokeDasharray = `${target} ${ARC_LEN}`;
  }
  const paceNum = $('#pace-num');
  if (paceNum) paceNum.textContent = r.paceLabel || '—';

  const d = $('#worker-detail');
  if (d) {
    d.textContent = w.lastError
      ? w.lastError
      : `Siklus ${fmt(r.cycleVisits)}/${fmt(r.visitBudget)} · Hari ini ${fmt(r.dailyVisits)}/${fmt(r.dailyRail)} · Sesi ${fmt(r.sessionTasks)}/${fmt(r.sessionBreakAt)} · Mode ${r.modeLabel || '—'}`;
  }
  const sbPace = $('#sb-pace');
  if (sbPace) sbPace.textContent = `Pace ${r.paceLabel || '—'}`;

  // banner auth
  const banner = $('#auth-banner');
  if (banner) {
    const isAuth = w.lastError && /login|session|auth|kedaluwarsa|masuk|berakhir/i.test(String(w.lastError));
    banner.hidden = !isAuth;
    if (isAuth) $('#auth-banner-text').textContent = w.lastError;
  }
  renderCommandStrip();
}

async function toggleWorker() {
  try {
    if (state.worker && state.worker.active) await api.workerStop();
    else await api.workerStart();
    await refreshWorker();
  } catch (e) {
    toast('Gagal mengubah status worker.', 'error');
  }
}
async function refreshWorker() {
  try { state.worker = await api.workerStatus(); renderWorker(); renderStatusBar(); } catch (e) { console.error('refreshWorker gagal:', e); }
}

// ---------- timeseries / hero / dashboard ----------
async function loadTimeseries() {
  const key = String(state.auditId || 'all');
  if (state.timeseriesKey === key && state.timeseries) return state.timeseries;
  try {
    state.timeseries = await api.getTimeseries({ auditId: state.auditId || undefined, days: 30 });
    state.timeseriesKey = key;
    return state.timeseries;
  } catch {
    state.timeseries = null;
    return null;
  }
}
function niceCeil(n) { if (n <= 1) return 1; const p = Math.pow(10, Math.floor(Math.log10(n))); return Math.ceil(n / p) * p; }
function renderHero(summary, ts) {
  const k = (summary && summary.kpi) || {};
  const totals = k.totals || {};
  const views = totals.views || 0;
  const likes = totals.likes || 0;
  const comments = totals.comments || 0;
  const shares = totals.shares || 0;
  const big = fmtJuta(views);
  $('#hero-views-num').textContent = big.value;
  $('#hero-views-unit').textContent = big.unit;
  const ok = k.ok || 0, partial = k.partial || 0, scraped = k.scraped || 0;
  const successPct = scraped ? fmtPct(k.success_rate ?? ((ok + partial) / scraped * 100)) : '—';
  $('#hero-success').textContent = successPct;
  $('#hero-sub').textContent = `${fmtCompact(likes)} suka · ${fmtCompact(comments)} komentar · ${fmtCompact(shares)} shares · ${successPct} target terverifikasi`;
  // platform share
  const platforms = summary?.platforms || [];
  const byP = Object.fromEntries(platforms.map((p) => [p.platform, p]));
  const igViews = byP.instagram?.views ?? 0;
  const tkViews = byP.tiktok?.views ?? 0;
  const total = (igViews + tkViews) || 1;
  $('#hero-ig-pct').textContent = fmtPct(igViews / total * 100, 1);
  $('#hero-ig-sub').textContent = `${fmtCompact(igViews)} views · ${fmtCompact(byP.instagram?.likes ?? 0)} likes`;
  $('#hero-tk-pct').textContent = fmtPct(tkViews / total * 100, 1);
  $('#hero-tk-sub').textContent = `${fmtCompact(tkViews)} views · ${fmtCompact(byP.tiktok?.likes ?? 0)} likes`;

  // chips
  const chips = [];
  if (ts && ts.days && ts.days.length) {
    const dViews = delta7(ts.days.map((d) => d.views));
    chips.push(`<span>${dViews === null ? '▲ 0' : signedPct(dViews)} vs 7 hari</span>`);
    const dLikes = delta7(ts.days.map((d) => d.likes));
    chips.push(`<span>${dLikes === null ? '▲ 0' : signedPct(dLikes)} likes /7 hr</span>`);
  }
  chips.push(`<span>${fmt(k.accounts ?? 0)} akun terpantau</span>`);
  const temas = summary?.temas || [];
  if (temas.length) chips.push(`<span>Tema teratas: ${esc(temas[0].tema || '(tanpa tema)')}</span>`);
  $('#hero-chips').innerHTML = chips.join('');

  // bars
  const trendVals = ts?.days?.map((d) => d.views || 0) || [0];
  const barMax = Math.max(...trendVals, 1);
  $('#hero-bars').innerHTML = trendVals.slice(-14).map((v) => `<i style="height:${Math.max(6, Math.round((v / barMax) * 100))}%" title="${idID(v)} views"></i>`).join('');

  // warning line
  const failed = k.failed || 0;
  const warn = $('#hero-warn');
  if (failed > 0) { warn.hidden = false; warn.textContent = `⚠ ${fmt(failed)} target gagal — ulangi setelah jeda`; }
  else { warn.hidden = true; }
}
function renderKpiStrip(summary, ts) {
  const k = (summary && summary.kpi) || {};
  const ok = k.ok || 0, partial = k.partial || 0;
  const scraped = k.scraped || 0, targets = k.targets || 0;
  const shareScraped = targets ? Math.round(scraped / targets * 100) : 0;
  const series = ts?.days || [];
  const sViews = series.map((d) => d.views);
  const sScraped = series.map((d) => d.scraped);
  const sTargets = series.map((d) => d.targets);
  const sFailed = series.map((d) => d.failed_count);
  const cards = [
    { label: 'Target impor', value: fmt(k.targets), sub: `${shareScraped}% terproses`, series: sTargets, delta: delta7(sTargets) },
    { label: 'Terproses', value: fmt(scraped), sub: `${fmt(ok + partial)} terverifikasi`, series: sScraped, delta: delta7(sScraped), good: true },
    { label: 'Terverifikasi', value: fmt(ok + partial), sub: `OK ${fmt(ok)} · sebagian ${fmt(partial)}`, series: series.map((d) => (d.ok_count || 0) + (d.partial_count || 0)), delta: delta7(series.map((d) => (d.ok_count || 0) + (d.partial_count || 0))), good: true },
    { label: 'Perlu tinjauan', value: '—', sub: 'memuat…', series: sFailed, delta: null, danger: true, id: 'kpi-flagged', action: 'akun' },
  ];
  $('#kpi-strip').innerHTML = cards.map((c) => `
    <article class="kpi ${c.danger ? 'kpi-danger' : ''}"${c.action ? ' role="button" tabindex="0" data-kpi-action="' + c.action + '" aria-label="Buka tab Akun — lihat akun yang perlu ditinjau"' : ''}>
      <div class="kpi-top">
        <span class="kpi-lbl">${esc(c.label)}</span>
        <svg class="spark" viewBox="0 0 78 24" role="presentation" aria-hidden="true"><polyline fill="none" stroke="${c.danger ? 'var(--err)' : 'var(--brand)'}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${sparklinePoints(c.series)}"/></svg>
      </div>
      <div class="num"${c.id ? ` id="${c.id}"` : ''}>${esc(c.value)}</div>
      <div class="kpi-foot"><span class="delta ${c.danger ? '' : 'good'} ${c.danger ? (Number(c.series.at(-1) ?? 0) > 0 ? 'bad' : 'flat') : ''}">${c.delta === null ? '–' : signedPct(c.delta)}</span><span class="kpi-sub">${c.sub}</span></div>
    </article>`).join('');
}
function renderTrend() {
  const box = $('#trend-chart');
  if (!box) return;
  const ts = state.timeseries;
  const days = ts?.days || [];
  const line = $('#trend-line');
  const area = $('#trend-area');
  if (!days.length) {
    if (line) line.setAttribute('d', '');
    if (area) area.setAttribute('d', 'M36,190 L650,190 Z');
    $('#trend-sub').textContent = 'Belum ada aktivitas dalam 30 hari terakhir.';
    return;
  }
  const metric = state.metric;
  const vals = days.map((d) => Number(d[metric]) || 0);
  const maxRaw = Math.max(...vals, 1);
  const max = niceCeil(maxRaw);
  const x0 = 36, x1 = 650, yTop = 24, yBase = 190;
  const step = (x1 - x0) / (days.length - 1);
  const pts = vals.map((v, i) => [Math.round(x0 + i * step), Math.round(yBase - (v / max) * (yBase - yTop))]);
  const lineD = 'M' + pts.map(([x, y]) => `${x},${y}`).join(' L');
  if (line) line.setAttribute('d', lineD);
  if (area) area.setAttribute('d', `${lineD} L${x1},${yBase} L${x0},${yBase} Z`);

  $('#trend-cells').innerHTML = pts.map(([x, y], i) => `
    <g class="day-cell" data-idx="${i}">
      <rect class="day-cap" x="${x - 12}" y="16" width="24" height="176"></rect>
      <circle class="trend-dot" cx="${x}" cy="${y}" r="4.2" fill="var(--brand)" stroke="var(--surface)" stroke-width="2" opacity="0"></circle>
    </g>`).join('');
  const mid = Math.floor((days.length - 1) / 2);
  const midDate = days[mid] && days[mid].date ? days[mid].date : days[0].date;
  $('#trend-axis-x').innerHTML = [
    `<text class="axis-label" x="36" y="212" text-anchor="start">${esc(fmtDayShort(days[0].date))}</text>`,
    `<text class="axis-label" x="${pts[mid][0]}" y="212" text-anchor="middle">${esc(fmtDayShort(midDate))}</text>`,
    `<text class="axis-label" x="650" y="212" text-anchor="end">${esc(fmtDayShort(days[days.length - 1].date))}</text>`,
  ].join('');
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => ({ y: 190 - f * 166, v: Math.round(max * f) }));
  $('#trend-y').innerHTML = ticks.map((t) => `<text class="axis-label" x="30" y="${(t.y + 3).toFixed(1)}" text-anchor="end">${esc(fmtCompact(t.v))}</text>`).join('');

  // ringkasan bar bawah (Views | Likes | Post) mengikuti metrik terpilih
  const metricLabel = { views: 'Views', likes: 'Likes', scraped: 'Post' }[metric] || metric;
  const peak = Math.max(...vals);
  const totalV = sum(vals);
  $('#trend-sub').textContent = `${metricLabel} — ${fmt(totalV)} dalam 30 hari · puncak ${fmtCompact(peak)} (${fmtDayShort(days[vals.indexOf(peak)].date)})`;
}
function onTrendMove(e) {
  const box = $('#trend-chart');
  const days = state.timeseries?.days || [];
  const tip = $('#chart-tooltip');
  if (!box || !days.length || !tip) return;
  const rect = box.getBoundingClientRect();
  const vbWidth = 660;
  const innerX = (e.clientX - rect.left) * (vbWidth / rect.width) - 36;
  const step = (650 - 36) / (days.length - 1);
  let idx = Math.round(innerX / step);
  idx = Math.max(0, Math.min(days.length - 1, idx));
  const d = days[idx];
  tip.innerHTML = `<b>${esc(fmtDateFull(d.date))}</b><br>${fmtCompact(d.views)} views · ${fmtCompact(d.likes)} likes<br>${fmt(d.scraped)} post · ${fmt(d.targets)} akun<em>OK ${fmt(d.ok_count)} · sebagian ${fmt(d.partial_count)} · gagal ${fmt(d.failed_count)}</em>`;
  tip.hidden = false;
  tip.style.opacity = '1';
  const maxX = rect.width - 18 - 190;
  tip.style.left = Math.min(
    maxX,
    Math.max(8, Math.min(rect.width - 190, e.clientX - rect.left - 12))
  ) + 'px';
  tip.style.top = Math.max(0, e.clientY - rect.top - (190 * rect.height / 220) - 12) + 'px';
  const dot = box.querySelector(`.day-cell[data-idx="${idx}"] .trend-dot`);
  if (dot) dot.setAttribute('opacity', '1');
}
function hideTrendTooltip() {
  const tip = $('#chart-tooltip');
  if (tip) { tip.hidden = true; tip.style.opacity = '0'; }
  $$('#trend-chart .trend-dot').forEach((d) => d.setAttribute('opacity', '0'));
}
function bindTrend() {
  const box = $('#trend-chart');
  if (!box) return;
  box.addEventListener('mousemove', onTrendMove);
  box.addEventListener('mouseenter', onTrendMove);
  box.addEventListener('mouseleave', hideTrendTooltip);
  $$('.mini-tabs [data-metric]').forEach((btn) => btn.addEventListener('click', () => {
    state.metric = btn.dataset.metric;
    $$('.mini-tabs [data-metric]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    renderTrend();
  }));
}

// ---------- status donut ----------
const CIRC = 2 * Math.PI * 62;
const DONUT_SEGS = [
  { key: 'done', label: 'Selesai', color: 'var(--ok)' },
  { key: 'pending', label: 'Menunggu', color: '#9aa3b2' },
  { key: 'failed', label: 'Gagal', color: 'var(--err)' },
];
const DONUT_TARGETS_MAP = { done: 'done', pending: 'pending', failed: 'failed' };
function donutCounts(k) {
  k = k || {};
  return {
    done: (k.ok || 0) + (k.partial || 0),
    pending: (k.pending || 0) + (k.running || 0),
    failed: k.failed || 0,
  };
}
function renderDonut(summary) {
  const k = (summary && summary.kpi) || {};
  const counts = donutCounts(k);
  const segSum = counts.done + counts.pending + counts.failed;
  let acc = 0;
  const svg = $('#status-donut');
  if (!svg) return;
  svg.innerHTML =
    `<circle cx="80" cy="80" r="62" fill="none" stroke="var(--sunken)" stroke-width="18"/>` +
    DONUT_SEGS.map((s) => {
      const len = segSum ? (counts[s.key] / segSum) * CIRC : 0;
      const seg = `<circle class="seg" data-key="${s.key}" cx="80" cy="80" r="62" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${CIRC.toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" stroke-linecap="butt" opacity="1"></circle>`;
      acc += len;
      return seg;
    }).join('') +
    `<circle class="donut-hole" cx="80" cy="80" r="41"/><text id="donut-center-val" x="80" y="76" text-anchor="middle" font-size="23" font-weight="800" fill="var(--ink)">${fmt(segSum)}</text><text id="donut-center-lbl" x="80" y="95" text-anchor="middle" font-size="9" letter-spacing="0.08em" fill="var(--ink-3)">TARGET</text>`;

  const legend = $('#donut-legend');
  if (legend) {
    legend.innerHTML = DONUT_SEGS.map((s) => {
      const pct = segSum ? (counts[s.key] / segSum * 100) : 0;
      return `<li><button class="legend-item" data-key="${s.key}" aria-pressed="false"><span class="legend-dot" style="background:${s.color}"></span><span><b>${fmt(counts[s.key])} ${esc(s.label)}</b><small>${idID(pct, 1)}% dari ${fmt(segSum)} target</small></span></button></li>`;
    }).join('');
  }

  // kosongkan filter sebelumnya
  state.statusFilterActive = null;
  svg.querySelectorAll('.seg').forEach((el) => el.addEventListener('click', () => applyStatusFilter(el.dataset.key)));
  if (legend) legend.querySelectorAll('.legend-item').forEach((btn) => btn.addEventListener('click', () => applyStatusFilter(btn.dataset.key)));
}
function applyStatusFilter(key) {
  const next = key === null ? null : (state.statusFilterActive === key ? null : key);
  state.statusFilterActive = next;
  // update segmen
  $$('#status-donut .seg').forEach((el) => {
    const on = !next || el.dataset.key === next;
    el.setAttribute('opacity', on ? '1' : '0.2');
    el.setAttribute('stroke-width', next && el.dataset.key === next ? '23' : '18');
  });
  $$('#donut-legend .legend-item').forEach((btn) => btn.setAttribute('aria-pressed', String(!!next && btn.dataset.key === next)));
  // update center
  const counts = donutCounts(state.summary && state.summary.kpi);
  const sumSeg = counts.done + counts.pending + counts.failed;
  const target = next ? DONUT_SEGS.find((s) => s.key === next) : null;
  const targetVal = target ? counts[target.key] : sumSeg;
  const centerVal = $('#donut-center-val');
  const centerLbl = $('#donut-center-lbl');
  if (centerVal) centerVal.textContent = fmt(targetVal);
  if (centerLbl) centerLbl.textContent = target ? target.label.toUpperCase() : 'TARGET';
  // filter tabel target
  state.targets.status = next ? DONUT_TARGETS_MAP[next] : '';
  state.targets.issue = '';
  state.targets.offset = 0;
  state.targets.selected.clear();
  updateRetrySelected();
  syncTargetChips();
  if (state.tab !== 'targets') activateTab('targets');
  else loadTargets();
  if (next) toast('Filter Target: ' + target.label, 'ok');
}
function syncTargetChips() {
  $$('.filter-chip[data-status]').forEach((c) => c.setAttribute('aria-pressed', String((c.dataset.status || '') === (state.targets.status || ''))));
  $$('.filter-chip[data-issue]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.issue === state.targets.issue)));
}

// ---------- funnel & platform & tema & posts ----------
function funnelPct(v, total) { return total ? Math.max(4, Math.round((v / total) * 100)) : 0; }
function renderFunnel(summary) {
  const k = (summary && summary.kpi) || {};
  const t = k.targets || 0;
  const scraped = k.scraped || 0, verified = k.verified || 0, ok = k.ok || 0;
  const rows = [
    { label: 'Diimpor', v: t, w: 100, cls: 'dim' },
    { label: 'Diproses', v: scraped, w: funnelPct(scraped, t), cls: '' },
    { label: 'Terverifikasi', v: verified, w: funnelPct(verified, t), cls: 'sun' },
    { label: 'OK (data lengkap)', v: ok, w: funnelPct(ok, t), cls: 'good' },
  ];
  $('#funnel-list').innerHTML = rows.map((r) => `
    <div class="funnel-row"><span>${esc(r.label)}</span>
      <div class="funnel-track"><div class="funnel-fill ${r.cls}" style="width:${r.w}%"></div></div>
      <div class="funnel-val">${fmt(r.v)}<small>${t ? Math.round(r.v / t * 100) : 0}%</small></div>
    </div>`).join('');
  const conv = scraped && verified ? ((verified / scraped) * 100) : null;
  $('#funnel-sub').innerHTML = `Konversi impor → OK: <b>${t ? idID(ok / t * 100, 1) : '0'}%</b> · <b>${conv === null ? '—' : idID(conv, 1) + '%'}</b> dari yang diproses terverifikasi · ${fmt(k.failed || 0)} gagal.`;
}
function renderPlatformCompare(summary) {
  const platforms = summary?.platforms || [];
  const ig = platforms.find((p) => p.platform === 'instagram');
  const tk = platforms.find((p) => p.platform === 'tiktok');
  const host = $('#platform-compare');
  if (!ig && !tk) { host.innerHTML = emptyState('Belum ada data platform', 'Import data, lalu jalankan worker untuk mengisi metrik.'); return; }
  const row = (label, getter, unit = '') => {
    const a = ig ? (getter(ig) ?? 0) : 0;
    const b = tk ? (getter(tk) ?? 0) : 0;
    const max = Math.max(a, b, 1);
    const fmtVal = (v) => unit === '%' ? fmtPct(v) : fmtCompact(v);
    return `
      <div class="bc-row">
        <div class="bc-head"><span>${esc(label)}</span></div>
        <div class="bc-line"><span class="bc-tag">IG</span><div class="bc-track"><i style="width:${Math.round(a / max * 100)}%;background:var(--ig)"></i></div><span class="bc-val">${esc(fmtVal(a))}</span></div>
        <div class="bc-line"><span class="bc-tag">TK</span><div class="bc-track"><i style="width:${Math.round(b / max * 100)}%;background:var(--tk)"></i></div><span class="bc-val">${esc(fmtVal(b))}</span></div>
      </div>`;
  };
  host.innerHTML =
    row('Views', (p) => p.views) +
    row('Likes', (p) => p.likes) +
    row('Komentar', (p) => p.comments) +
    row('Median ER', (p) => p.median_er ?? null, '%');
}
function barER(er, max) { return Math.round((er ?? 0) / (max || 1) * 100); }
function renderTemaTable(summary) {
  const host = $('#tema-table-copy') || $('#tema-table');
  if (!host) return;
  const temas = summary?.temas || [];
  if (!temas.length) { host.innerHTML = emptyState('Belum ada tema', 'Kolom "tema" kosong di data Anda.'); return; }
  const list = [...temas].sort((a, b) => state.temaSort === 'er' ? ((b.median_er ?? -1) - (a.median_er ?? -1)) : ((b.views ?? 0) - (a.views ?? 0))).slice(0, 6);
  const maxER = Math.max(...list.map((t) => t.median_er ?? 0), 1);
  const maxViews = Math.max(...list.map((t) => t.views ?? 0), 1);
  host.innerHTML = `<thead><tr><th scope="col">Tema</th><th scope="col" class="r">Target</th><th scope="col" class="r">Views</th><th scope="col" class="r">Median ER</th></tr></thead><tbody>${list.map((t) => `
    <tr tabindex="0" data-tema="${esc(t.tema || '')}" role="button" aria-label="Filter target tema ${esc(t.tema || '')}">
      <td><strong>${esc(t.tema || '(tanpa tema)')}</strong></td>
      <td class="r">${fmt(t.targets)}</td>
      <td class="r">${esc(fmtCompact(t.views))}</td>
      <td class="r"><span class="er-track" title="${t.median_er !== null && t.median_er !== undefined ? fmtPct(t.median_er) : '—'}"><span class="er-fill" style="width:${barER(t.median_er, maxER)}%"></span></span> <b>${t.median_er !== null && t.median_er !== undefined ? fmtPct(t.median_er) : '—'}</b></td>
    </tr>`).join('')}</tbody>`;
  host.querySelectorAll('tr[data-tema]').forEach((row) => {
    row.addEventListener('click', () => filterTargetsByTema(row.dataset.tema));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filterTargetsByTema(row.dataset.tema); } });
  });
}
function filterTargetsByTema(tema) {
  $('#target-q').value = tema === '(tanpa tema)' ? '' : tema;
  state.targets.offset = 0;
  activateTab('targets');
  loadTargets();
}
function renderTopPosts(summary) {
  const views = summary?.posts?.top_views || [];
  const er = summary?.posts?.top_er || [];
  const row = (p, i, mode) => `
    <div class="leader-row${i < 3 ? ' is-top' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="leader-main"><b>${esc(p.handle || '—')}</b><span class="muted"> · ${p.platform === 'instagram' ? 'Instagram' : 'TikTok'}${p.scraped_at ? ' · ' + esc(relTime(p.scraped_at)) : ''}</span><div class="er-bar"><i style="width:${Math.min(100, i === 0 ? 100 : Math.round(70 - i * 12))}%"></i></div></span>
      <span class="leader-num"><b>${esc(fmtCompact(p.views ?? 0))}</b><span class="muted">views</span></span>
      <span class="leader-num"><b>${p.er !== null && p.er !== undefined ? fmtPct(p.er) : '—'}</b><span class="muted">ER</span></span>
    </div>`;
  $('#top-views').innerHTML = views.length ? views.map((p, i) => row(p, i, 'views')).join('') : emptyState('Belum ada data', 'Import data, lalu jalankan worker.');
  $('#top-er').innerHTML = er.length ? er.map((p, i) => row(p, i, 'er')).join('') : emptyState('Belum ada data', 'Import data, lalu jalankan worker.');
}

// ---------- quality / bandingkan / risk / clusters ----------
function renderQuality(summary) {
  const q = (summary && summary.quality) || {};
  const k = (summary && summary.kpi) || {};
  const auditId = state.auditId;
  const rows = [
    { n: q.without_followers || 0, label: 'target tanpa data followers', hint: 'Kunjungi profil untuk mengisi profil & follower', action: auditId ? { label: 'Kunjungi profil', act: 'profile', cls: 'btn btn-primary btn-sm' } : null },
    { n: q.missing_views || 0, label: 'video TikTok tanpa views', hint: 'Kemungkinan privat / age-gated', action: { label: 'Lihat', act: 'views', cls: 'btn btn-ghost btn-sm' } },
    { n: k.failed || 0, label: 'target gagal', hint: 'Didominasi throttle — coba ulang setelah jeda', action: auditId ? { label: 'Ulangi gagal', act: 'retry', cls: 'btn btn-primary btn-sm' } : null },
    { n: q.missing_username || 0, label: 'target tanpa handle', hint: 'Username tidak ter-parse dari URL', action: null },
    { n: q.never_scraped || 0, label: 'target belum diproses', hint: 'Menunggu giliran worker', action: { label: 'Buka Proses', act: 'proses', cls: 'btn btn-ghost btn-sm' } },
  ];
  $('#quality-list').innerHTML = rows.map((r) => `
    <div class="check-row"><div><strong>${fmt(r.n)} ${esc(r.label)}</strong><div class="muted">${esc(r.hint)}</div></div>${r.action ? `<button class="${r.action.cls}" data-quality-action="${r.action.act}">${esc(r.action.label)}</button>` : '<span class="muted">—</span>'}</div>`).join('');
}
function renderCompare(summary, compare) {
  const el = $('#compare-panel');
  if (!el) return;
  if (!compare || !compare.periods || compare.periods.length < 2) { el.innerHTML = 'Butuh minimal 2 periode untuk perbandingan.'; return; }
  const s = compare.summary || {};
  el.innerHTML = `<p style="margin:0 0 12px">${compare.periods.length} periode · terbaru <b>${esc(compare.latest_period)}</b> · ${fmt(s.accounts)} akun · <b>${fmt(s.new_accounts)} baru</b> · ${fmt(s.missing_latest)} hilang di periode terbaru</p>
    <blockquote class="compare-quote">Impor periode ini: <b>${fmt((summary?.kpi || {}).targets)}</b> target · views <b>${fmtCompact((summary?.kpi?.totals || {}).views)}</b></blockquote>
    <p class="muted" style="margin-bottom:0">Tip: buka tab Akun untuk melihat klaster dan skor risiko per akun.</p>`;
}

// ---------- intel / risk / clusters ----------
const REASON_LABELS = { konten: 'Konten sama', kontak: 'Kontak bio sama', template: 'Caption seragam', serentak: 'Unggah serentak' };
function clusterMember(m) {
  const s = String(m);
  const i = s.indexOf(':');
  if (i < 0) return { platform: 'instagram', username: s };
  return { platform: s.slice(0, i), username: s.slice(i + 1) };
}
function renderClusterCards(clusters) {
  return (clusters || []).map((c, ci) => {
    const members = (c.members || []).map((m) => {
      const mm = clusterMember(m);
      return `<button class="cluster-chip" data-platform="${esc(mm.platform)}" data-username="${esc(mm.username)}">@${esc(mm.username)}</button>`;
    }).join(' ');
    const reasons = (c.reasons || []).map((r) => REASON_LABELS[r] || r).join(' · ');
    return `<div class="cluster-card"><strong>Klaster ${ci + 1} · ${c.size} akun<span class="strength">${c.strong ? 'bukti kuat' : 'perlu perhatian'}</span></strong><div class="cluster-meta">${esc(reasons)}</div><div class="cluster-members">${members}</div></div>`;
  }).join('');
}
async function loadAccountsIntel() {
  try {
    const res = await api.getAccounts({ sort: 'risk', limit: 200 });
    const items = res.items || [];
    const summaryIntel = res.summary || {};
    const clusters = res.clusters || [];
    const byLevel = summaryIntel.levels || {};
    // "Perlu tinjauan" = terindikasi − yang sudah dijawab manual (clear/flag)
    const badge = $('#nav-accounts-count');
    const flagged = summaryIntel.flagged || 0;
    const rCounts = reviewedDecisionCounts(state.reviews);
    const needsReview = Math.max(0, flagged - (rCounts.clear + rCounts.flag));
    state.needsReview = needsReview;
    if (badge) { badge.hidden = needsReview <= 0; badge.textContent = fmt(needsReview); }
    const kpiFlag = $('#kpi-flagged');
    if (kpiFlag) { kpiFlag.textContent = fmt(needsReview); kpiFlag.title = `${fmt(flagged)} terindikasi · ${fmt(rCounts.clear + rCounts.flag)} sudah ditanggapi`; }
    const review = $('#hero-review');
    if (review) review.textContent = fmt(needsReview);
    // risk bars (tab Akun)
    const barsHost = $('#risk-bars');
    if (barsHost) {
      const levels = [
        { key: 'pola_kembar', label: 'Pola kembar', color: 'var(--err)' },
        { key: 'pola_ternak', label: 'Pola ternak', color: 'var(--warn)' },
        { key: 'amati', label: 'Amati', color: '#eab308' },
        { key: 'bersih', label: 'Bersih', color: 'var(--ok)' },
      ];
      const max = Math.max(...levels.map((l) => byLevel[l.key] || 0), 1);
      barsHost.innerHTML = levels.map((l) => `
        <div class="intel-row"><span class="intel-lbl">${esc(l.label)}</span>
          <div class="intel-track"><i style="width:${Math.round(((byLevel[l.key] || 0) / max) * 100)}%;background:${l.color}"></i></div>
          <span class="num" style="width:44px;text-align:right">${fmt(byLevel[l.key] || 0)}</span>
        </div>`).join('');
    }
    // clusters list (anggota bisa diklik untuk membuka akun)
    const clustersHost = $('#clusters-list');
    const strong = clusters.filter((c) => c.strong).slice(0, 4);
    if (clustersHost) {
      clustersHost.innerHTML = strong.length
        ? renderClusterCards(strong)
        : emptyState('Belum ada klaster kuat', 'Klaster muncul setelah cukup banyak kunjungan profil.');
      clustersHost.querySelectorAll('.cluster-chip').forEach((chip) => {
        chip.addEventListener('click', () => openAccount(chip.dataset.username, chip.dataset.platform));
      });
    }
    // cluster preview (dashboard)
    const preview = $('#cluster-preview');
    if (preview) {
      const best = strong[0] || clusters[0] || null;
      preview.innerHTML = best
        ? `<strong>Klaster terkuat · ${best.size} akun<span class="strength">${best.strong ? 'bukti kuat' : 'perlu perhatian'}</span></strong><div class="cluster-meta">${esc((best.members || []).map((m) => '@' + String(m).split(':').pop()).join(', '))}</div><div class="cluster-meta">Alasan: ${esc((best.reasons || []).join(' · '))}</div><div class="cluster-meta" style="margin-top:6px"><b>Wajib verifikasi manual</b> sebelum tindakan apa pun.</div>`
        : `<strong>Belum ada klaster</strong><div class="cluster-meta">Klaster terbentuk dari sinyal kontak/konten/caption antar akun.</div>`;
    }
    // badge sidebar dashboard? badge banyak
    return { items, summaryIntel, clusters };
  } catch (e) {
    console.error('loadAccountsIntel gagal:', e);
    return null;
  }
}
async function loadRiskAccounts() {
  try {
    const res = await api.getAccounts({ sort: 'risk', limit: 5 });
    const flagged = (res.items || []).filter((a) => a.score > 0);
    const host = $('#risk-accounts');
    if (!host) return;
    host.innerHTML = flagged.length
      ? flagged.map((a) => `<div class="leader-row" data-account="${esc(a.username)}" data-platform="${esc(a.platform)}" tabindex="0" role="button" aria-label="Buka detail ${esc(a.username)}">
          <span class="rank">${a.level === 'pola_kembar' ? '!!' : a.level === 'pola_ternak' ? '!' : '?'}</span>
          <span class="leader-main"><b>@${esc(a.username)}</b><span class="muted"> · ${esc(a.level.replace(/_/g, ' '))} · ${fmtCompact(a.followers ?? 0)} followers</span><div class="er-bar"><i style="width:${riskScorePct(a.score)}%"></i></div></span>
          <span class="leader-num"><b>${fmt(a.score)}</b><span class="muted">skor</span></span>
        </div>`).join('')
      : '<div class="muted" style="padding:14px 2px">Tidak ada akun dengan skor risiko &gt; 0.</div>';
    $$('#risk-accounts .leader-row').forEach((el) => {
      el.addEventListener('click', () => openAccount(el.dataset.account, el.dataset.platform));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccount(el.dataset.account, el.dataset.platform); } });
    });
  } catch (e) {
    console.error('loadRiskAccounts gagal:', e);
    const host = $('#risk-accounts');
    if (host) host.innerHTML = '<div class="muted" style="padding:14px 2px">Gagal memuat akun risiko.</div>';
  }
}

// ---------- targets table ----------
function statusBadge(status) {
  const s = (status || 'PENDING').toLowerCase();
  const label = { ok: 'OK', partial: 'Sebagian', failed: 'Gagal', pending: 'Menunggu', running: 'Berjalan' }[s] || s;
  return `<span class="status ${s}"><span class="sdot"></span>${esc(label)}</span>`;
}
function renderTargetsTable(items) {
  const rows = items.map((r) => {
    const checked = state.targets.selected.has(r.target_id);
    const tema = r.tema || shortUrl(r.url);
    return `<tr data-target="${r.target_id}" class="clickable" tabindex="0" role="button" aria-label="Buka riwayat ${esc(tema)}">
      <td><input type="checkbox" class="sel" data-id="${r.target_id}" aria-label="Pilih target ${esc(tema)}" ${checked ? 'checked' : ''}></td>
      <td><span class="badge ${r.platform === 'instagram' ? 'ig' : 'tk'}">${r.platform === 'instagram' ? 'IG' : 'TK'}</span></td>
      <td class="wrap" title="${esc(r.url)}">@${esc(r.username || '—')}</td>
      <td class="wrap cell-clip" title="${esc(tema)}">${esc(tema)}</td>
      <td class="num">${fmt(r.follower_count)}</td>
      <td class="num"><b>${fmt(r.likes)}</b></td>
      <td class="num">${deltaBadge(r.delta_likes)}</td>
      <td class="num">${fmt(r.views)}</td>
      <td class="num">${deltaBadge(r.delta_views)}</td>
      <td class="num">${r.engagement_rate !== null && r.engagement_rate !== undefined ? fmtPct(r.engagement_rate) : '—'}</td>
      <td class="muted" title="${esc(fmtWhen(r.snapshot_at))}">${esc(relTime(r.snapshot_at))}</td>
      <td>${statusBadge(r.status)}</td>
    </tr>`;
  }).join('');
  $('#targets-table').innerHTML = `
    <thead><tr>
      <th scope="col" style="width:36px"><input type="checkbox" id="targets-checkall" aria-label="Pilih semua"></th>
      <th scope="col">Pl.</th>
      <th scope="col">Akun</th>
      <th scope="col">Tema</th>
      <th scope="col" class="num th-sort" data-sort="followers">Fol.</th>
      <th scope="col" class="num th-sort" data-sort="likes">Likes</th>
      <th scope="col" class="num th-sort" data-sort="delta_likes">Δ L</th>
      <th scope="col" class="num th-sort" data-sort="views">Views</th>
      <th scope="col" class="num th-sort" data-sort="delta_views">Δ V</th>
      <th scope="col" class="num th-sort" data-sort="er">ER</th>
      <th scope="col" class="th-sort" data-sort="recent">Di-scrape</th>
      <th scope="col">Status</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="12" class="muted">Tidak ada target untuk filter ini.</td></tr>`}</tbody>`;

  // sort header classes
  $$('#targets-table .th-sort').forEach((th) => {
    th.classList.toggle('desc', th.dataset.sort === state.targets.sort && state.targets.dir === 'desc');
    th.classList.toggle('asc', th.dataset.sort === state.targets.sort && state.targets.dir === 'asc');
    th.removeAttribute('aria-sort');
    if (th.dataset.sort === state.targets.sort) th.setAttribute('aria-sort', state.targets.dir === 'asc' ? 'ascending' : 'descending');
  });
  $$('#targets-table tr[data-target]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('sel')) return;
      openTarget(Number(row.dataset.target));
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTarget(Number(row.dataset.target)); } });
  });
  $$('#targets-table .sel').forEach((cb) => cb.addEventListener('change', (e) => {
    const id = Number(e.target.dataset.id);
    if (e.target.checked) state.targets.selected.add(id); else state.targets.selected.delete(id);
    updateRetrySelected();
  }));
  const checkAll = $('#targets-checkall');
  if (checkAll) checkAll.addEventListener('change', (e) => {
    const ids = $$('#targets-table .sel').map((cb) => Number(cb.dataset.id));
    if (e.target.checked) ids.forEach((id) => state.targets.selected.add(id));
    else ids.forEach((id) => state.targets.selected.delete(id));
    renderTargetsTable(state.targets.items);
    updateRetrySelected();
  });
}
async function loadTargets() {
  const params = {
    auditId: state.auditId || undefined,
    q: $('#target-q').value || undefined,
    status: state.targets.status || undefined,
    platform: $('#target-platform').value || undefined,
    issue: state.targets.issue || undefined,
    sort: state.targets.sort,
    dir: state.targets.dir,
    limit: state.targets.limit,
    offset: state.targets.offset,
  };
  let res = { items: [], total: 0 };
  try {
    res = await api.getTargets(params);
  } catch (e) {
    toast('Gagal memuat target.', 'error');
  }
  state.targets.items = res.items || [];
  state.targets.total = res.total || 0;
  $('#targets-total').textContent = `${fmt(res.total)} target`;
  $('#nav-targets-count').hidden = res.total === 0;
  if (res.total) $('#nav-targets-count').textContent = fmt(res.total > 999 ? '999+' : res.total);
  $('#targets-page').textContent = pageLabel(state.targets.offset, state.targets.limit, res.total);
  renderTargetsTable(state.targets.items);
}

// ---------- accounts table ----------
async function loadReviews() {
  try { state.reviews = await api.reviewList() || {}; }
  catch (e) { console.error('loadReviews gagal:', e); state.reviews = {}; }
}
function reviewBadgeHtml(platform, username) {
  const rec = state.reviews[reviewKey(platform, username)];
  if (!rec) return '';
  const m = reviewMeta(rec.decision);
  return m ? `<span class="pill ${m.tone}" title="${esc(rec.note || m.label)}">${m.icon} ${esc(m.label)}</span>` : '';
}
function renderAccountsTable(items) {
  $('#accounts-table').innerHTML = `
    <thead><tr>
      <th scope="col">Akun</th>
      <th scope="col">Level</th>
      <th scope="col" class="num th-sort desc" data-sort="risk">Skor</th>
      <th scope="col" class="num">Followers</th>
      <th scope="col">Reach</th>
      <th scope="col" class="num">Post</th>
      <th scope="col" class="num">Bln</th>
      <th scope="col">Indikasi</th>
    </tr></thead>
    <tbody>${items.map((a) => `
      <tr class="clickable" data-account="${esc(a.username)}" data-platform="${esc(a.platform)}" tabindex="0" role="button" aria-label="Buka detail ${esc(a.username)}">
        <td><div class="acct-cell">${avatarHtml(a.avatar_url, a.username)}<span><b>@${esc(a.username)}</b> ${reviewBadgeHtml(a.platform, a.username)}<br><span class="muted">${esc((a.display_name || '').slice(0, 42))}</span></span></div></td>
        <td><span class="badge lv-${esc(a.level)}">${esc(a.level.replace(/_/g, ' '))}</span></td>
        <td class="num"><div class="score-track" style="width:88px;display:inline-block"><i style="width:${riskScorePct(a.score)}%"></i></div> <b>${fmt(a.score)}</b></td>
        <td class="num">${fmt(a.followers)}</td>
        <td><div class="score-track" style="width:72px" title="${a.metrics && a.metrics.view_reach_pct !== null ? fmtPct(a.metrics.view_reach_pct) : '—'}"><i style="width:${Math.min(100, a.metrics && a.metrics.view_reach_pct !== null ? a.metrics.view_reach_pct : (a.metrics && a.metrics.like_reach_pct !== null ? a.metrics.like_reach_pct : 0))}%;background:var(--brand-400)"></i></div></td>
        <td class="num">${fmt(a.metrics?.posts_seen)}</td>
        <td class="num">${fmt(a.months_seen)}</td>
        <td class="cell-clip">${esc((a.flags || []).map((f) => f.label).join(' · ') || '—')}</td>
      </tr>`).join('') || `<tr><td colspan="8" class="muted">Belum ada akun tersimpan. Jalankan worker untuk mengisi data.</td></tr>`}</tbody>`;
  $$('#accounts-table tr[data-account]').forEach((row) => {
    row.addEventListener('click', () => openAccount(row.dataset.account, row.dataset.platform));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccount(row.dataset.account, row.dataset.platform); } });
  });
  wireAvatarErrors($('#accounts-table'));
}
async function loadAccounts() {
  const reviewOnly = state.accounts.reviewOnly;
  const prevBtn = $('#accounts-prev');
  const nextBtn = $('#accounts-next');

  if (reviewOnly) {
    // Mode triase: akun terindikasi yang belum dijawab (clear/flag).
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    let raw = { items: [], summary: {} };
    try { raw = await api.getAccounts({ sort: 'risk', limit: 1000, offset: 0 }); } catch { toast('Gagal memuat daftar akun.', 'error'); }
    const items = (raw.items || []).filter((a) => isNeedsReview(a, state.reviews));
    state.accounts.items = items;
    state.accounts.total = items.length;
    state.accountsSummary = raw.summary || {};
    $('#accounts-total').textContent = `${fmt(items.length)} akun perlu tinjauan`;
    $('#accounts-page').textContent = 'tampil semua';
    renderAccountsTable(items);
    return;
  }

  if (prevBtn) prevBtn.disabled = false;
  if (nextBtn) nextBtn.disabled = false;
  const params = {
    q: $('#account-q').value || undefined,
    level: $('#account-level').value || undefined,
    band: $('#account-band').value || undefined,
    platform: $('#account-platform').value || undefined,
    sort: 'risk',
    limit: state.accounts.limit,
    offset: state.accounts.offset,
  };
  let res = { items: [], total: 0, summary: {} };
  try { res = await api.getAccounts(params); } catch { toast('Gagal memuat daftar akun.', 'error'); }
  state.accounts.items = res.items || [];
  state.accounts.total = res.total || 0;
  state.accountsSummary = res.summary || {};
  $('#accounts-total').textContent = `${fmt(res.total)} akun · ${fmt((res.summary || {}).flagged)} terindikasi · ${fmt((res.summary || {}).clusters)} klaster`;
  $('#accounts-page').textContent = pageLabel(state.accounts.offset, state.accounts.limit, res.total);
  renderAccountsTable(state.accounts.items);
}

// avatar helpers
function avatarHtml(url, username, large = false) {
  const cls = large ? 'avatar-lg' : '';
  const local = url && !/^https?:\/\//i.test(url) ? String(url) : null;
  const initial = esc((username || '?').slice(0, 1).toUpperCase());
  if (!local) return `<span class="avatar-fallback ${cls}">${initial}</span>`;
  return `<span class="avatar-wrap"><img class="avatar ${cls}" src="sa-avatar:///${encodeURIComponent(local)}" alt="" loading="lazy" data-fallback="${initial}"></span>`;
}
function swapBrokenAvatar(img) {
  const span = document.createElement('span');
  span.className = 'avatar-fallback' + (img.classList.contains('avatar-lg') ? ' avatar-lg' : '');
  span.textContent = img.dataset.fallback || '?';
  img.replaceWith(span);
}
function wireAvatarErrors(root = document) {
  root.querySelectorAll('img.avatar').forEach((img) => {
    if (img.complete && img.naturalWidth === 0) { swapBrokenAvatar(img); return; }
    img.addEventListener('error', () => swapBrokenAvatar(img));
  });
}
function openAccount(username, platform) {
  api.getAccountDetail(platform, username).then((detail) => {
    if (!detail) { toast('Akun belum pernah disimpan.', 'error'); return; }
    const flags = (detail.flags || []).map((f) => `<div class="flag"><b>${esc(f.label)}</b> (+${f.points}) — ${esc(f.detail)}</div>`).join('');
    const siblings = (detail.siblings || []).map((s) => `<div class="flag"><b>@${esc(s.username)}</b> — ${esc(s.level)} (${(s.reasons || []).join(', ')})</div>`).join('');
    const history = (detail.history || []).map((h) => `<tr><td>${esc(h.month)}</td><td class="num">${fmt(h.follower_count)}</td><td class="num">${fmt(h.post_count)}</td></tr>`).join('');
    const cur = state.reviews[reviewKey(detail.platform, detail.username)];
    const curMeta = cur ? reviewMeta(cur.decision) : null;
    openModal(`
      <div class="modal-head"><h3>${avatarHtml(detail.avatar_url, detail.username, true)}@${esc(detail.username)} <span class="badge lv-${esc(detail.level)}">${esc(detail.level)}</span></h3><button class="btn btn-ghost" data-close>✕</button></div>
      <div class="modal-body">
        <div class="grid-equal" style="margin-bottom:12px">
          <div><div class="muted">Followers</div><div class="num" style="font-size:22px;font-weight:800">${fmt(detail.followers)}</div></div>
          <div><div class="muted">Median reach</div><div class="num" style="font-size:22px;font-weight:800">${detail.metrics && detail.metrics.view_reach_pct !== null ? fmtPct(detail.metrics.view_reach_pct) : (detail.metrics && detail.metrics.like_reach_pct !== null ? fmtPct(detail.metrics.like_reach_pct) : '—')}</div></div>
        </div>
        <p class="muted">${esc(detail.bio || '(tanpa bio)')}${detail.region ? ' · ' + esc(detail.region) : ''}</p>
        <div class="panel"><div class="panel-title">Indikasi (${fmt(detail.score)} poin)</div>${flags || '<div class="muted">Tidak ada.</div>'}</div>
        <div class="panel"><div class="panel-title">Tinjauan manual</div>
          <div class="muted" style="margin-bottom:10px" id="review-current">${cur ? `Status: <b>${esc(curMeta ? curMeta.label : cur.decision)}</b>${cur.note ? ' — ' + esc(cur.note) : ''}${cur.at ? ' · ' + esc(relTime(cur.at)) : ''}` : 'Belum ada keputusan.'}</div>
          <div class="row-gap" style="margin-bottom:8px">
            <button class="btn btn-ghost btn-sm" data-rv="bookmark">🔖 Ditandai</button>
            <button class="btn btn-ghost btn-sm" data-rv="clear">✔ Bersih</button>
            <button class="btn btn-ghost btn-sm" data-rv="flag">✖ Konfirmasi</button>
          </div>
          <div class="field" style="margin:0"><label>Catatan (opsional)</label><textarea id="rv-note" class="input" rows="2" placeholder="Alasan keputusan…">${esc(cur ? cur.note || '' : '')}</textarea></div>
        </div>
        ${siblings ? `<div class="panel"><div class="panel-title">Akun tertaut</div>${siblings}</div>` : ''}
        ${history ? `<div class="panel"><div class="panel-title">Seri bulanan</div><table class="table"><thead><tr><th scope="col">Bulan</th><th scope="col" class="num">Followers</th><th scope="col" class="num">Post</th></tr></thead><tbody>${history}</tbody></table></div>` : ''}
      </div>
      <div class="modal-foot"><button class="btn btn-danger" id="del-account" style="margin-right:auto">Hapus data akun ini…</button><button class="btn btn-ghost" data-close>Tutup</button></div>`);
    $('#del-account').addEventListener('click', () => openDeleteAccount(detail.username, detail.platform));
    $$('#modal-root [data-rv]').forEach((btn) => btn.addEventListener('click', async () => {
      const decision = btn.dataset.rv;
      const note = ($('#rv-note') ? $('#rv-note').value : '').trim();
      const r = await api.reviewSet({ platform: detail.platform, username: detail.username, decision, note });
      if (r && r.ok) {
        await loadReviews();
        toast('Tinjauan tersimpan.', 'ok');
        closeModal();
        if (state.tab === 'accounts') loadAccounts();
        loadAccountsIntel().then(() => renderCommandStrip());
      } else {
        toast((r && r.error) || 'Gagal menyimpan tinjauan.', 'error');
      }
    }));
    wireAvatarErrors($('#modal-root'));
  }).catch(() => toast('Gagal memuat detail akun.', 'error'));
}
function openDeleteAccount(username, platform) {
  openModal(`<div class="modal-head"><h3>Hapus data akun</h3><button class="btn btn-ghost" data-close>✕</button></div>
    <div class="modal-body"><p>Data akun <b>@${esc(username)}</b> (profil, riwayat bulanan, unggahan) akan dihapus. Ketik username untuk melanjutkan.</p>
      <div class="field"><label>Ketik @${esc(username)}</label><input id="del-account-confirm" class="input" placeholder="${esc(username)}"></div></div>
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

// ---------- proses ----------
async function renderLoginStatus() {
  const el = $('#session-login-status');
  if (!el) return;
  try {
    const status = await api.getLoginStatus();
    const okDot = (on) => on ? '<span class="okdot">●</span>' : '<span class="offdot">○</span>';
    el.innerHTML =
      `<span><b>IG</b> ${okDot(!!(status && status.instagram))} ${status && status.instagram ? 'masuk' : 'belum login'}</span>`
      + `<span><b>TikTok</b> ${okDot(!!(status && status.tiktok))} ${status && status.tiktok ? 'masuk' : 'belum login'}</span>`;
  } catch {
    el.textContent = 'Status login: tidak tersedia';
  }
}
async function loadProcess() {
  try {
    const s = await api.getQueueStats();
    const pending = s.pending || 0, running = s.running || 0, ok = s.ok || 0, partial = s.partial || 0, failed = s.failed || 0;
    const total = Math.max(pending + running + ok + partial + failed, 1);
    const W = (v) => (v / total * 100).toFixed(2) + '%';
    const bar = $('#queue-bar');
    if (bar) {
      bar.innerHTML = `
        <span class="q-seg ok" style="width:${W(ok)}%" title="OK ${fmt(ok)}">OK ${fmt(ok)}</span>
        <span class="q-seg part" style="width:${W(partial)}%" title="Sebagian ${fmt(partial)}" aria-hidden="${partial ? 'false' : 'true'}">${fmt(partial)}</span>
        <span class="q-seg fail" style="width:${W(failed)}%" title="Gagal ${fmt(failed)}">${fmt(failed)}</span>
        <span class="q-seg wait" style="width:${W(pending)}%" title="Menunggu ${fmt(pending)}"></span>`;
      bar.setAttribute('aria-label', `Antrean: OK ${ok} · sebagian ${partial} · gagal ${failed} · menunggu ${pending}`);
      const legend = $('#queue-legend');
      if (legend) legend.innerHTML = `<span><i style="background:#047857"></i> OK — ${fmt(ok)}</span><span><i style="background:#d97706"></i> Sebagian — ${fmt(partial)}</span><span><i style="background:#b91c1c"></i> Gagal — ${fmt(failed)}</span><span><i style="background:#9aa3b2"></i> Menunggu — ${fmt(pending)}</span>`;
    }
    const etaEl = $('#queue-eta');
    if (etaEl) {
      let pace = null; let etaStr = null;
      try { const w = await api.workerStatus(); pace = w && w.rate && w.rate.paceLabel; etaStr = w && w.eta; } catch { /* non-kritis: abaikan */ }
      const eta = pending + running;
      etaEl.textContent = eta > 0 ? `${fmt(eta)} task tersisa${pace ? ` · pace ${pace}` : ''}${etaStr ? ` · sisa ±${etaStr}` : ''}` : 'Antrean kosong';
    }
    const stats = $('#queue-stats');
    if (stats) {
      stats.innerHTML = [
        { label: 'Menunggu', v: pending },
        { label: 'Berjalan', v: running },
        { label: 'OK', v: ok + partial },
        { label: 'Gagal', v: failed },
      ].map((x) => `<div class="kpi"><div class="kpi-lbl">${esc(x.label)}</div><div class="num">${fmt(x.v)}</div></div>`).join('');
    }
    const latest = await api.getLatest({ limit: 20 });
    $('#latest-table').innerHTML = `
      <thead><tr><th scope="col">Waktu</th><th scope="col">Akun</th><th scope="col" class="num">Follower</th><th scope="col" class="num">Likes</th><th scope="col" class="num">Δ Likes</th><th scope="col" class="num">Views</th><th scope="col" class="num">Δ Views</th><th scope="col">Status</th></tr></thead>
      <tbody>${(latest || []).map((r) => {
        const dLikes = (r.likes != null && r.prev_likes != null) ? r.likes - r.prev_likes : null;
        const dViews = (r.views != null && r.prev_views != null) ? r.views - r.prev_views : null;
        return `<tr><td class="muted">${esc(fmtWhen(r.scraped_at))}</td><td>@${esc(r.username || '—')} <span class="badge ${r.platform === 'instagram' ? 'ig' : 'tk'}">${r.platform === 'instagram' ? 'IG' : 'TK'}</span></td>
        <td class="num">${fmt(r.follower_count)}</td><td class="num">${fmt(r.likes)}</td><td class="num">${deltaBadge(dLikes)}</td><td class="num">${fmt(r.views)}</td><td class="num">${deltaBadge(dViews)}</td><td>${statusBadge(r.status)}${String(r.status).toLowerCase() === 'failed' && r.error_message ? '<div class="muted" style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r.error_message) + '">' + esc(r.error_message) + '</div>' : ''}</td></tr>`;
      }).join('') || `<tr><td colspan="8" class="muted">Belum ada aktivitas.</td></tr>`}</tbody>`;
  } catch (e) {
    console.error('loadProcess gagal:', e);
    const eta = $('#queue-eta'); if (eta) eta.textContent = 'Gagal memuat antrean.';
  }
}

// ---------- settings ----------
async function loadSettings() {
  renderAudits();
  refreshUpdatePanel();
  try {
    const info = await api.dbInfo();
    $('#db-info').innerHTML = `
      <div class="kpi"><div class="kpi-lbl">File</div><div class="num" style="font-size:14px">${esc(info.filename)}</div></div>
      <div class="kpi"><div class="kpi-lbl">Ukuran</div><div class="num" style="font-size:14px">${fmt(Math.round((info.size_bytes || 0) / 1024))} KB</div></div>
      <div class="kpi"><div class="kpi-lbl">Audit</div><div class="num">${fmt(info.counts && info.counts.audits)}</div></div>
      <div class="kpi"><div class="kpi-lbl">Target</div><div class="num">${fmt(info.counts && info.counts.targets)}</div></div>
      <div class="kpi"><div class="kpi-lbl">Snapshot</div><div class="num">${fmt(info.counts && info.counts.snapshots)}</div></div>`;
  } catch (e) {
    console.error('dbInfo gagal:', e);
    const db = $('#db-info'); if (db) db.innerHTML = '<div class="muted">Gagal memuat info database.</div>';
  }
}
function renderAudits() {
  $('#audits-table').innerHTML = `
    <thead><tr><th scope="col">Nama</th><th scope="col">Periode</th><th scope="col" class="num">Target</th><th scope="col" class="num">Terverifikasi</th><th scope="col" class="num">Ulang (hari)</th><th scope="col"></th></tr></thead>
    <tbody>${(state.audits || []).map((a) => `
      <tr>
        <td><b>${esc(a.name)}</b></td><td>${esc(a.period || '—')}</td>
        <td class="num">${fmt(a.target_count)}</td>
        <td class="num">${fmt((a.ok_count||0) + (a.partial_count||0))}</td>
        <td class="num">${fmt(a.repeat_days)}</td>
        <td class="row-gap" style="justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" data-act="rerun" data-id="${a.id}">Audit ulang</button>
          <button class="btn btn-ghost btn-sm" data-act="profile" data-id="${a.id}" title="Kunjungi profil akun yang datanya belum ada">Kunjungi profil</button>
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${a.id}" data-name="${esc(a.name)}" data-repeat="${a.repeat_days}">Edit</button>
          <button class="btn btn-danger btn-sm" data-act="delete" data-id="${a.id}">Hapus</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="6" class="muted">Belum ada audit. Klik <b>＋ Import data</b>.</td></tr>`}</tbody>`;

  $$('#audits-table [data-act]').forEach((btn) => btn.addEventListener('click', () => {
    const id = Number(btn.dataset.id);
    const act = btn.dataset.act;
    if (act === 'rerun') {
      api.rerunAudit(id, true).then((r) => toast((r && r.error) || 'Dijadwalkan ulang.')).catch(() => toast('Gagal menjadwalkan ulang.', 'error'));
    } else if (act === 'profile') {
      api.enqueueProfileVisits(id).then((r) => {
        if (!r) return toast('Gagal menjadwalkan kunjungan profil.', 'error');
        toast(r.error || (r.pending ? 'Kunjungan profil sudah antre.' : `Menjadwalkan ${fmt(r.created)} kunjungan profil.`), r.error ? 'error' : 'ok');
      }).catch(() => toast('Gagal menjadwalkan kunjungan profil.', 'error'));
    } else if (act === 'delete') {
      const audit = (state.audits || []).find((a) => a.id === id);
      const targetCount = audit ? audit.target_count : 0;
      openModal(`<div class="modal-head"><h3>Hapus audit?</h3><button class="btn btn-ghost" data-close>✕</button></div>
        <div class="modal-body"><p>Audit <b>${esc(audit ? audit.name : id)}</b> dan seluruh target & riwayatnya akan dihapus <b>permanen</b>.</p></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger" id="confirm-del">Hapus</button></div>`);
      $('#confirm-del').addEventListener('click', async () => {
        try { await api.deleteAudit(id); } catch { toast('Gagal menghapus audit.', 'error'); }
        closeModal();
        await loadAudits();
      });
    } else if (act === 'edit') {
      openModal(`<div class="modal-head"><h3>Edit audit</h3><button class="btn btn-ghost" data-close>✕</button></div>
        <div class="modal-body"><div class="field"><label>Nama</label><input id="edit-name" class="input" value="${esc(btn.dataset.name)}"></div>
        <div class="field"><label>Ulang (hari, 0 = manual)</label><input id="edit-repeat" class="input" type="number" min="0" max="365" value="${btn.dataset.repeat}"></div></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="confirm-edit">Simpan</button></div>`);
      $('#confirm-edit').addEventListener('click', async () => {
        try {
          await api.updateAudit(id, { name: $('#edit-name').value, repeat_days: Number($('#edit-repeat').value) });
          closeModal(); loadAudits();
        } catch { toast('Gagal menyimpan perubahan.', 'error'); }
      });
    }
  }));
}

// ---------- export / import ----------
function statusToExport(val) {
  return { ok: 'OK', partial: 'PARTIAL', failed: 'FAILED', done: 'DONE' }[val] || null;
}
async function openExport() {
  const status = statusToExport(state.targets.status);
  const audit = (state.audits || []).find((a) => a.id === state.auditId);
  const statusLabel = { done: 'Selesai (OK + sebagian)', ok: 'OK', partial: 'Sebagian', failed: 'Gagal' }[state.targets.status] || 'Semua status';
  let count = null;
  try { count = await api.exportCount({ auditId: state.auditId || null, status }); } catch { count = null; }
  openModal(`<div class="modal-head"><h3>Export data</h3><button class="btn btn-ghost" data-close>✕</button></div>
    <div class="modal-body"><p>Anda akan mengekspor:</p><ul style="margin:0 0 8px 18px">
      <li><b>Audit:</b> ${esc(audit ? audit.name : 'Semua audit')}</li>
      <li><b>Status:</b> ${esc(statusLabel)}</li>
      <li><b>Baris:</b> ${fmt(count)}</li></ul>
      <p class="muted">File .xlsx berisi kolom metrik + delta + keputusan tinjauan + rekap. Simpan di lokasi aman.</p></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="confirm-export">Unduh .xlsx…</button></div>`);
  $('#confirm-export').addEventListener('click', async () => {
    closeModal();
    try {
      const r = await api.exportExcel({ auditId: state.auditId || null, status });
      if (r && r.error) toast(r.error, 'error');
      else if (r && !r.canceled) toast(`Export selesai: ${fmt(r.rows)} baris.`, 'ok');
    } catch { toast('Export gagal.', 'error'); }
  });
}
function openNewAudit() {
  const auditOptions = `<option value="">— Audit baru —</option>` + (state.audits || []).map((a) => `<option value="${a.id}">Tambah ke: ${esc(a.name)}</option>`).join('');
  openModal(`<div class="modal-head"><h3>Import data</h3><button class="btn btn-ghost" data-close>✕</button></div><div class="modal-body">
    <div class="field"><label>Nama audit (untuk audit baru)</label><input id="new-name" class="input" placeholder="mis. Kampanye November"></div>
    <div class="field"><label>Ulang (hari, 0 = manual)</label><input id="new-repeat" class="input" type="number" min="0" max="365" value="0"></div>
    <div class="field"><label>Tujuan</label><select id="new-audit" class="select">${auditOptions}</select></div>
    <button class="btn btn-primary btn-block" id="confirm-file">📄 Pilih file Excel/CSV (kolom Link/URL)</button>
    <div class="modal-divider"><span>atau tempel link langsung</span></div>
    <div class="field"><label>Tempel link postingan — satu per baris</label>
      <textarea id="new-links" class="input" placeholder="https://www.instagram.com/p/CODE/&#10;https://www.tiktok.com/@user/video/7123456789"></textarea></div>
    <p class="muted">Maksimal 10.000 baris per import.</p>
  </div><div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-ghost" id="confirm-links">Import link</button></div>`);

  const getOpts = () => ({ name: $('#new-name').value, repeat_days: Number($('#new-repeat').value), auditId: $('#new-audit').value ? Number($('#new-audit').value) : null });
  $('#confirm-file').addEventListener('click', async () => {
    const opts = getOpts();
    let res;
    try {
      if (opts.auditId) res = await api.appendTargets({ auditId: opts.auditId });
      else res = await api.createAudit({ name: opts.name, repeat_days: opts.repeat_days });
    } catch { toast('Import gagal.', 'error'); return; }
    closeModal();
    if (res.canceled) return;
    if (res.error) toast(res.error, 'error');
    else toast(`Import ${fmt(res.inserted)} target (${fmt(res.duplicates)} duplikat, ${fmt(res.skipped)} dilewati).`, 'ok');
    await loadAudits(); await refreshDashboard();
  });
  $('#confirm-links').addEventListener('click', async () => {
    const text = $('#new-links').value || '';
    if (!text.trim()) { toast('Tempel link dulu, atau pakai "Import file…".', 'error'); return; }
    const opts = getOpts();
    let res;
    try { res = await api.importLinks({ text, name: opts.name, repeat_days: opts.repeat_days, auditId: opts.auditId }); } catch { toast('Import gagal.', 'error'); return; }
    closeModal();
    if (res.error) toast(res.error, 'error');
    else toast(`Import ${fmt(res.inserted)} target (${fmt(res.duplicates)} duplikat, ${fmt(res.skipped)} dilewati).`, 'ok');
    await loadAudits(); await refreshDashboard();
  });
}

// ---------- audits / refresh ----------
async function loadAudits() {
  let audits = null;
  try { audits = await api.getAudits(); } catch (e) { console.error('getAudits gagal:', e); return; }
  state.audits = audits;
  if (state.auditId && !state.audits.some((a) => a.id === state.auditId)) state.auditId = null;
  const sel = $('#global-audit');
  const current = state.auditId;
  const idsKey = state.audits.map((a) => a.id).join(',') + '|' + current;
  if (sel.dataset.key !== idsKey && document.activeElement !== sel) {
    sel.innerHTML = `<option value="">Semua audit</option>` + state.audits.map((a) => `<option value="${a.id}" ${a.id === current ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    sel.dataset.key = idsKey;
  }
  const retryFailedBtn = $('#btn-retry-failed');
  if (retryFailedBtn) retryFailedBtn.disabled = !state.auditId;
  if (state.tab === 'settings') renderAudits();
  updateTitlebarContext();
}
async function renderOnboarding() {
  const host = $('#onboarding-host');
  if (!host) return;
  const hasAudits = (state.audits || []).length > 0;
  if (hasAudits) { host.hidden = true; host.innerHTML = ''; return; }

  let login = { instagram: false, tiktok: false };
  try { login = await api.getLoginStatus() || login; } catch { /* loginStatus gagal — anggap belum login */ }
  const workerActive = !!(state.worker && state.worker.active);
  const k = (state.summary && state.summary.kpi) || {};
  const processed = (k.scraped || 0) > 0;

  const steps = [
    { done: login.instagram || login.tiktok, title: 'Login Instagram / TikTok', sub: login.instagram || login.tiktok ? 'Sesi aktif' : 'Buka jendela login (atau lewat tray)', actions: `<button class="btn btn-ghost btn-sm" id="ob-ig">Login IG</button><button class="btn btn-ghost btn-sm" id="ob-tk">Login TikTok</button>` },
    { done: hasAudits, title: 'Import data', sub: 'CSV/XLSX dengan kolom Link, atau tempel langsung', actions: `<button class="btn btn-primary btn-sm" id="ob-import">＋ Import data</button>` },
    { done: workerActive, title: 'Mulai worker', sub: 'Worker mengunjungi akun & mengumpulkan metrik secara berkala', actions: `<button class="btn btn-ghost btn-sm" id="ob-worker">${workerActive ? 'Hentikan' : 'Mulai worker'}</button>` },
    { done: processed, title: 'Lihat hasil', sub: 'Pantau delta & skor risiko akun, lalu export', actions: `<button class="btn btn-ghost btn-sm" id="ob-proses">Buka Proses</button>` },
  ];

  host.hidden = false;
  host.innerHTML = `
    <div class="card onboarding-card">
      <div class="card-head"><div><div class="card-title">Mulai di sini</div><div class="card-sub">Empat langkah singkat untuk audit pertama Anda</div></div></div>
      <div class="ob-steps">${steps.map((s, i) => `
        <div class="ob-step ${s.done ? 'done' : ''}">
          <span class="ob-num">${s.done ? '✔' : (i + 1)}</span>
          <div class="ob-body"><b>${esc(s.title)}</b><span class="muted">${esc(s.sub)}</span></div>
          <div class="ob-actions">${s.actions}</div>
        </div>`).join('')}
      </div>
    </div>`;

  const ig = $('#ob-ig'); if (ig) ig.addEventListener('click', () => api.openLogin('instagram').catch(() => toast('Gagal membuka login.', 'error')));
  const tk = $('#ob-tk'); if (tk) tk.addEventListener('click', () => api.openLogin('tiktok').catch(() => toast('Gagal membuka login.', 'error')));
  const imp = $('#ob-import'); if (imp) imp.addEventListener('click', openNewAudit);
  const wk = $('#ob-worker'); if (wk) wk.addEventListener('click', toggleWorker);
  const pr = $('#ob-proses'); if (pr) pr.addEventListener('click', () => activateTab('proses'));
}

function renderCommandStrip() {
  const host = $('#command-strip');
  if (!host) return;
  const w = state.worker;
  const workerActive = w && w.active;
  const workerLabel = w ? (workerActive ? 'Aktif' : (w.lastError ? 'Terhenti' : 'Siaga')) : '—';
  const needsReview = state.needsReview || 0;
  const failed = ((state.summary && state.summary.kpi) || {}).failed || 0;
  host.innerHTML = `
    <div class="cs-item" ${w && w.lastError ? `title="${esc(w.lastError)}"` : ''}>
      <span class="dot ${workerActive ? 'active' : (w && w.lastError ? 'error' : '')}"></span>
      <span>Worker <b>${esc(workerLabel)}</b></span>
      <button class="btn btn-ghost btn-sm" id="cs-worker">${workerActive ? 'Hentikan' : 'Mulai'}</button>
    </div>
    <button class="cs-item cs-action" id="cs-review" ${needsReview ? '' : 'disabled'}>Perlu tinjauan <b>${fmt(needsReview)}</b></button>
    <button class="cs-item cs-action" id="cs-failed" ${failed ? '' : 'disabled'}>Gagal <b>${fmt(failed)}</b></button>`;
  const wk = $('#cs-worker'); if (wk) wk.addEventListener('click', toggleWorker);
  const rv = $('#cs-review'); if (rv) rv.addEventListener('click', openTriage);
  const fl = $('#cs-failed'); if (fl) fl.addEventListener('click', () => {
    state.targets.status = 'failed';
    state.targets.offset = 0;
    syncTargetChips();
    activateTab('targets');
  });
}

async function refreshDashboard() {
  if (state.tab !== 'dashboard') return;
  renderOnboarding();
  try {
    const summary = await api.getSummary(state.auditId);
    if (summary) {
      const ts = await loadTimeseries();
      const sig = summarySignature(summary, ts);
      if (sig === state.dashSig) {
        // Data tak berubah — jangan re-render penuh (biar tooltip grafik tak terputus
        // tiap 5 detik); cukup segarkan keterangan waktu relatif.
        $('#dash-sub').textContent = `Diperbarui ${relTime(summary.generated_at)} · ${fmt(summary.kpi?.targets || 0)} target`;
        return;
      }
      state.dashSig = sig;
      state.summary = summary;
      renderHero(summary, ts);
      renderKpiStrip(summary, ts);
      renderTrend();
      renderDonut(summary);
      renderFunnel(summary);
      renderPlatformCompare(summary);
      renderTemaTable(summary);
      renderTopPosts(summary);
      renderQuality(summary);
      try { renderCompare(summary, await api.getCompare({ months: 6 })); } catch { const el = $('#compare-panel'); if (el) el.textContent = '—'; }
      await Promise.all([loadRiskAccounts(), loadAccountsIntel()]);
      renderCommandStrip();
      $('#dash-sub').textContent = `Diperbarui ${relTime(summary.generated_at)} · ${fmt(summary.kpi?.targets || 0)} target`;
    }
  } catch (e) { console.error('refreshDashboard gagal:', e); }
}

// ---------- retry helpers ----------
function updateRetrySelected() {
  const btn = $('#btn-retry-selected');
  if (!btn) return;
  btn.disabled = state.targets.selected.size === 0;
  btn.textContent = state.targets.selected.size ? `Ulangi terpilih (${state.targets.selected.size})` : 'Ulangi terpilih';
}
function openTarget(targetId) {
  api.getTargetHistory(targetId).then((snapshots) => {
    const rows = (snapshots || []).map((s) => `<tr><td>${esc(fmtWhen(s.scraped_at))}</td><td>${statusBadge(s.status)}</td><td class="num">${fmt(s.follower_count)}</td><td class="num">${fmt(s.likes)}</td><td class="num">${fmt(s.comments)}</td><td class="num">${fmt(s.views)}</td><td class="wrap">${esc(s.error_message || '')}</td></tr>`).join('');
    openModal(`<div class="modal-head"><h3>Riwayat target</h3><button class="btn btn-ghost" data-close>✕</button></div>
      <div class="modal-body"><table class="table"><thead><tr><th scope="col">Waktu</th><th scope="col">Status</th><th scope="col" class="num">Fol.</th><th scope="col" class="num">Likes</th><th scope="col" class="num">Komen</th><th scope="col" class="num">Views</th><th scope="col">Error</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Belum ada snapshot.</td></tr>'}</tbody></table></div>`);
  }).catch(() => toast('Gagal memuat riwayat target.', 'error'));
}
function showScoreHelp() {
  openModal(`<div class="modal-head"><h3>Bagaimana skor dihitung?</h3><button class="btn btn-ghost" data-close>✕</button></div>
    <div class="modal-body"><p>Skor adalah agregasi sinyal lemah dari data <b>publik</b> (bukan identitas):</p>
      <ul style="margin:0 0 10px 18px">
        <li><b>+4</b> Unggahan sama muncul di akun lain</li>
        <li><b>+3</b> Kontak (nomor/email) di bio dipakai akun lain</li>
        <li><b>+2</b> Caption seragam lintas akun · jangkauan sangat rendah · komentar nyaris nol · unggahan bertumpuk · follower datar</li>
        <li><b>+1</b> Unggahan serentak · following &gt; followers</li>
      </ul>
      <p class="muted" style="border-left:3px solid var(--warn);padding-left:10px"><b>Disclaimer:</b> ini indikasi otomatis dari data publik — bukan identifikasi orang dan bukan vonis. Wajib verifikasi manual sebelum tindakan apa pun. Data dapat dihapus atas permintaan.</p></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Tutup</button></div>`);
}

// ---------- keyboard shortcuts ----------
function openTriage() {
  state.accounts.reviewOnly = true;
  const chip = $('#account-review-only');
  if (chip) chip.setAttribute('aria-pressed', 'true');
  ['#account-q', '#account-level', '#account-band', '#account-platform'].forEach((s) => { const el = $(s); if (el) el.disabled = true; });
  activateTab('accounts');
}
function showShortcuts() {
  openModal(`<div class="modal-head"><h3>Pintasan keyboard</h3><button class="btn btn-ghost" data-close>✕</button></div>
    <div class="modal-body">
      <div class="flag"><b>Ctrl K</b> — command palette (aksi + pencarian)</div>
      <div class="flag"><b>Ctrl 1…6</b> — pindah tab</div>
      <div class="flag"><b>G lalu 1…6</b> — pindah tab (gaya Linear)</div>
      <div class="flag"><b>G lalu T</b> — buka triage (perlu tinjauan)</div>
      <div class="flag"><b>Ctrl I</b> — import data · <b>Ctrl E</b> — export · <b>Ctrl Shift B</b> — cadangkan database</div>
      <div class="flag"><b>?</b> — tampilkan pintasan ini · <b>Esc</b> — tutup dialog</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Tutup</button></div>`);
}
function enableTablistKeyboard(tablist) {
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  tablist.addEventListener('keydown', (e) => {
    const idx = tabs.indexOf(document.activeElement);
    if (idx < 0) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(idx + 1) % tabs.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(idx - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.click();
  });
}
let goPrefix = null;
let goPrefixTimer = null;
function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) { goPrefix = null; return; }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) { goPrefix = null; return; }
    const k = e.key.toLowerCase();
    if (k === 'g') {
      goPrefix = 'g';
      clearTimeout(goPrefixTimer);
      goPrefixTimer = setTimeout(() => { goPrefix = null; }, 1200);
      return;
    }
    if (goPrefix === 'g') {
      goPrefix = null; clearTimeout(goPrefixTimer);
      if (k === 't') { e.preventDefault(); openTriage(); return; }
      if (k >= '1' && k <= '6') { e.preventDefault(); activateTab(['dashboard', 'targets', 'accounts', 'proses', 'browser', 'settings'][Number(k) - 1]); return; }
      return;
    }
    if (k === '?') { e.preventDefault(); showShortcuts(); }
  });
}

// ---------- search ----------
let searchTimer = null;
function hideSearchPop() { const pop = $('#search-pop'); if (pop) { pop.hidden = true; pop.innerHTML = ''; } }
// ----- command palette: aksi cepat (Ctrl+K) -----
function commandActions() {
  const w = state.worker;
  return [
    { id: 'import', label: 'Import data', hint: 'Ctrl+I', run: () => openNewAudit() },
    { id: 'export', label: 'Export data', hint: 'Ctrl+E', run: () => openExport() },
    { id: 'worker', label: (w && w.active) ? 'Hentikan worker' : 'Mulai worker', hint: '', run: () => toggleWorker() },
    { id: 'tab:dashboard', label: 'Buka Dashboard', hint: 'Ctrl+1', run: () => activateTab('dashboard') },
    { id: 'tab:targets', label: 'Buka Target', hint: 'Ctrl+2', run: () => activateTab('targets') },
    { id: 'tab:accounts', label: 'Buka Akun', hint: 'Ctrl+3', run: () => activateTab('accounts') },
    { id: 'tab:proses', label: 'Buka Proses', hint: 'Ctrl+4', run: () => activateTab('proses') },
    { id: 'tab:settings', label: 'Buka Pengaturan', hint: 'Ctrl+6', run: () => activateTab('settings') },
    { id: 'backup', label: 'Cadangkan database', hint: 'Ctrl+Shift+B', run: () => handleMenuAction('backup') },
    { id: 'theme', label: 'Ubah tema (terang/gelap)', hint: '', run: () => applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark') },
  ];
}
function renderCommandActions(needle) {
  const need = String(needle || '').toLowerCase().trim();
  let list = commandActions();
  if (need.length >= 2) list = list.filter((a) => a.label.toLowerCase().includes(need));
  return list.slice(0, 7);
}
function commandActionHtml(needle) {
  return renderCommandActions(needle).map((a) =>
    `<div class="search-item" data-action="${esc(a.id)}"><span class="search-main">${esc(a.label)}</span><span class="end">${esc(a.hint || '')}</span></div>`).join('');
}

async function runSearch(query) {
  const pop = $('#search-pop');
  if (!pop) return;
  pop.hidden = false;
  const needle = String(query || '').trim();
  const actionsHtml = commandActionHtml(needle);

  if (needle.length < 2) {
    pop.innerHTML = (actionsHtml ? `<div class="search-group">Aksi</div>${actionsHtml}` : '') +
      `<div class="muted search-pad">Ketik 2+ karakter untuk mencari akun / link / tema…</div>`;
    return;
  }

  const seq = ++state.searchSeq;
  let res = null;
  try { res = await api.search(needle); } catch { res = null; }
  if (seq !== state.searchSeq) return;
  if (!res) { pop.innerHTML = '<div class="muted search-pad">Pencarian gagal.</div>'; return; }
  const group = (title, items) => (items && items.length ? `<div class="search-group">${title}</div>` + items : '');
  const targets = (res.targets || []).slice(0, 6).map((t) =>
    `<div class="search-item" data-kind="target" data-id="${t.target_id}"><span class="badge ${t.platform === 'instagram' ? 'ig' : 'tk'}">${t.platform === 'instagram' ? 'IG' : 'TT'}</span><span class="search-main">@${esc(t.username || '—')}</span><span class="end">${esc(t.audit_name || '')}</span></div>`).join('');
  const accounts = (res.accounts || []).slice(0, 6).map((a) =>
    `<div class="search-item" data-kind="account" data-platform="${esc(a.platform)}" data-username="${esc(a.username)}"><span class="badge ${a.platform === 'instagram' ? 'ig' : 'tk'}">${a.platform === 'instagram' ? 'IG' : 'TT'}</span><span class="search-main">@${esc(a.username)}</span><span class="end">${fmt(a.follower_count)} fol.</span></div>`).join('');
  const posts = (res.posts || []).slice(0, 6).map((p) =>
    `<div class="search-item" data-kind="post" data-url="${esc(p.post_url || '')}"><span class="badge ${p.platform === 'instagram' ? 'ig' : 'tk'}">${p.platform === 'instagram' ? 'IG' : 'TT'}</span><span class="search-main">${esc((p.caption || p.post_url || '(tanpa caption)').slice(0, 56))}</span><span class="end">${fmtCompact(p.views)} views</span></div>`).join('');
  const dataHtml = group('Target', targets) + group('Akun', accounts) + group('Post', posts);
  const actionsGroup = actionsHtml ? group('Aksi', actionsHtml) : '';
  pop.innerHTML = actionsGroup + dataHtml || `<div class="muted search-pad">Tidak ada hasil untuk “${esc(needle)}”.</div>`;
}
function bindGlobalSearch() {
  const input = $('#global-search');
  const pop = $('#search-pop');
  if (!input || !pop) return;
  input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(input.value), 250); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; hideSearchPop(); input.blur(); return; }
    if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(input.value); }
  });
  pop.addEventListener('click', (e) => {
    const actionItem = e.target.closest('[data-action]');
    if (actionItem) {
      hideSearchPop(); input.blur();
      const act = commandActions().find((a) => a.id === actionItem.dataset.action);
      if (act) act.run();
      return;
    }
    const item = e.target.closest('[data-kind]');
    if (!item) return;
    hideSearchPop(); input.blur();
    if (item.dataset.kind === 'target') openTarget(Number(item.dataset.id));
    else if (item.dataset.kind === 'account') openAccount(item.dataset.username, item.dataset.platform);
    else if (item.dataset.kind === 'post' && item.dataset.url) window.sunscrap.openExternal(item.dataset.url);
  });
  document.addEventListener('click', (e) => {
    if (e.target === input) return;
    if (!e.target.closest('#search-pop')) hideSearchPop();
  });
}

// ---------- statusbar / polling ----------
function renderStatusBar() {
  const w = state.worker;
  const sb = $('#sb-worker');
  if (w && sb) {
    const label = w.active ? 'Aktif' : (w.lastError ? 'Terhenti' : 'Siaga');
    sb.innerHTML = `<span class="sb-dot ${w.active ? 'ok' : (w.lastError ? 'err' : '')}"></span>${esc(label)}`;
  }
  const audit = (state.audits || []).find((a) => a.id === state.auditId);
  const sbAudit = $('#sb-audit');
  if (sbAudit) sbAudit.textContent = audit ? `Audit: ${audit.name}` : 'Audit: Semua';
  const sbDb = $('#sb-db');
  if (sbDb) {
    if (state.dbInfoCache) sbDb.textContent = `DB ${Math.round(state.dbInfoCache.size_bytes / 1024)} KB`;
    else api.dbInfo().then((info) => { state.dbInfoCache = info; sbDb.textContent = `DB ${Math.round(info.size_bytes / 1024)} KB`; }).catch(() => { /* info DB di statusbar bersifat opsional — abaikan */ });
  }
}
const UPDATE_STATUS_TEXT = (s) => ({
  dev: 'Mode pengembangan — pembaruan nonaktif.',
  idle: 'Belum ada informasi pembaruan.',
  checking: 'Memeriksa pembaruan…',
  uptodate: 'Anda memakai versi terbaru.',
  available: `Versi ${s.availableVersion || ''} tersedia — mengunduh…`,
  downloading: `Mengunduh… ${Math.round(s.percent || 0)}%`,
  downloaded: `Versi ${s.availableVersion || ''} terunduh — klik "Muat ulang & perbarui".`,
  error: `Gagal memeriksa pembaruan${s.error ? `: ${s.error}` : ''} — coba lagi nanti.`,
}[s.status] || s.status);
function renderUpdate(s) {
  if (!s) return;
  const v = $('#update-version'); if (v) v.textContent = s.version || '—';
  const st = $('#update-status'); if (st) st.textContent = UPDATE_STATUS_TEXT(s);
  const prog = $('#update-progress');
  if (prog) {
    const show = s.status === 'downloading' || s.status === 'available';
    prog.hidden = !show;
    const bar = prog.querySelector('span');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, s.percent || 0))}%`;
  }
  const install = $('#btn-install-update');
  if (install) install.hidden = s.status !== 'downloaded';
}
async function refreshUpdatePanel() { try { renderUpdate(await api.updateState()); } catch { /* non-kritis: abaikan */ } }
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

// ---------- bindings ----------
function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function bindEvents() {
  $('#worker-toggle').addEventListener('click', toggleWorker);
  $('#btn-new-audit').addEventListener('click', openNewAudit);
  $('#btn-theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'));
  $('#global-audit').addEventListener('change', (e) => {
    state.auditId = e.target.value ? Number(e.target.value) : null;
    refreshDashboard();
    updateTitlebarContext();
    renderStatusBar();
  });
  $$('#statusbar .sb-item').forEach((el) => el.addEventListener('click', () => { if (el.dataset.tab) activateTab(el.dataset.tab); }));

  // actions pada kartu KPI (dirender ulang, pakai delegasi)
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-kpi-action="akun"]')) activateTab('accounts');
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-kpi-action="akun"]')) {
      e.preventDefault();
      activateTab('accounts');
    }
  });

  // targets: chips + search + platform + table events
  const resetTargets = () => { state.targets.offset = 0; state.targets.selected.clear(); updateRetrySelected(); loadTargets(); };
  $('#target-q').addEventListener('input', debounce(resetTargets, 300));
  $('#target-platform').addEventListener('change', resetTargets);
  $$('.filter-chip[data-status]').forEach((chip) => chip.addEventListener('click', () => {
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    state.targets.status = (pressed && chip.dataset.status === '') ? '' : (chip.dataset.status || '');
    // toggle identik: klik chip aktif → clear
    if (pressed) state.targets.status = '';
    state.targets.issue = '';
    state.targets.offset = 0; state.targets.selected.clear();
    syncTargetChips();
    updateRetrySelected();
    loadTargets();
  }));
  $$('.filter-chip[data-issue]').forEach((chip) => chip.addEventListener('click', () => {
    const active = chip.getAttribute('aria-pressed') === 'true';
    state.targets.issue = active ? '' : chip.dataset.issue;
    state.targets.status = '';
    state.targets.offset = 0; state.targets.selected.clear();
    syncTargetChips();
    updateRetrySelected();
    loadTargets();
  }));
  $('#targets-table').addEventListener('click', (e) => {
    const th = e.target.closest('.th-sort');
    if (!th) return;
    const key = th.dataset.sort;
    const s = toggleSort(state.targets.sort, state.targets.dir, key);
    state.targets.sort = s.sort;
    state.targets.dir = s.dir;
    loadTargets();
  });
  $('#targets-prev').addEventListener('click', () => { state.targets.offset = prevOffset(state.targets.offset, state.targets.limit); loadTargets(); });
  $('#targets-next').addEventListener('click', () => { state.targets.offset = nextOffset(state.targets.offset, state.targets.limit, state.targets.total); loadTargets(); });
  $('#btn-retry-failed').addEventListener('click', async () => {
    if (!state.auditId) { toast('Pilih audit dulu.'); return; }
    try {
      const r = await api.retryFailed(state.auditId);
      toast((r && r.error) || (r && r.message) || `Dijadwalkan ulang ${fmt(r && r.created)} target.`, r && r.error ? 'error' : 'ok');
      loadTargets();
    } catch { toast('Gagal menjadwalkan ulang.', 'error'); }
  });
  $('#btn-retry-selected').addEventListener('click', async () => {
    if (!state.targets.selected.size) return;
    if (!state.auditId) { toast('Pilih audit dulu di dropdown atas.'); return; }
    try {
      const r = await api.retryTargets(state.auditId, Array.from(state.targets.selected));
      toast((r && r.error) || (r && r.message) || `Dijadwalkan ulang ${fmt(r && r.created)} target.`, r && r.error ? 'error' : 'ok');
      state.targets.selected.clear(); updateRetrySelected(); loadTargets();
    } catch { toast('Gagal menjadwalkan ulang target terpilih.', 'error'); }
  });
  $('#btn-export').addEventListener('click', openExport);

  // quality actions (dashboard)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quality-action]');
    if (!btn) return;
    const act = btn.dataset.qualityAction;
    if (act === 'profile') {
      if (!state.auditId) return;
      api.enqueueProfileVisits(state.auditId).then((r) => {
        if (!r) return toast('Gagal menjadwalkan kunjungan profil.', 'error');
        toast(r.error || (r.pending ? 'Kunjungan profil sudah antre.' : `Menjadwalkan ${fmt(r.created)} kunjungan profil.`), r.error ? 'error' : 'ok');
      }).catch(() => toast('Gagal menjadwalkan kunjungan profil.', 'error'));
    } else if (act === 'views') {
      state.targets.issue = 'no_views'; state.targets.status = ''; state.targets.offset = 0; state.targets.selected.clear();
      syncTargetChips(); activateTab('targets');
    } else if (act === 'retry') {
      if (!state.auditId) return;
      api.retryFailed(state.auditId).then((r) => toast((r && r.error) || `Dijadwalkan ulang ${fmt(r && r.created)} gagal.`, r && r.error ? 'error' : 'ok')).catch(() => toast('Gagal menjadwalkan ulang.', 'error'));
    } else if (act === 'proses') {
      activateTab('proses');
    }
  });

  // temas sort + posts tabs
  $$('.mini-tabs [data-tema-sort]').forEach((btn) => btn.addEventListener('click', () => {
    state.temaSort = btn.dataset.temaSort;
    $$('.mini-tabs [data-tema-sort]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    renderTemaTable(state.summary);
  }));
  $$('.mini-tabs [data-posts-tab]').forEach((btn) => btn.addEventListener('click', () => {
    state.postsTab = btn.dataset.postsTab;
    $$('.mini-tabs [data-posts-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    $('#top-views').hidden = btn.dataset.postsTab !== 'views';
    $('#top-er').hidden = btn.dataset.postsTab !== 'er';
  }));
  $('#btn-clear-status-filter').addEventListener('click', () => applyStatusFilter(null));
  const openAccountsBtn = $('#btn-open-accounts');
  if (openAccountsBtn) openAccountsBtn.addEventListener('click', () => activateTab('accounts'));

  // accounts: filters & pager & score help & mode "perlu tinjauan"
  const resetAccounts = () => { state.accounts.offset = 0; loadAccounts(); };
  ['#account-q', '#account-level', '#account-band', '#account-platform'].forEach((s) => {
    $(s).addEventListener(s === '#account-q' ? 'input' : 'change', s === '#account-q' ? debounce(resetAccounts, 300) : resetAccounts);
  });
  $('#account-review-only').addEventListener('click', () => {
    state.accounts.reviewOnly = !state.accounts.reviewOnly;
    const chip = $('#account-review-only');
    if (chip) chip.setAttribute('aria-pressed', String(state.accounts.reviewOnly));
    ['#account-q', '#account-level', '#account-band', '#account-platform'].forEach((s) => {
      const el = $(s); if (el) el.disabled = state.accounts.reviewOnly;
    });
    state.accounts.offset = 0;
    loadAccounts();
  });
  $('#accounts-prev').addEventListener('click', () => { if (state.accounts.reviewOnly) return; state.accounts.offset = prevOffset(state.accounts.offset, state.accounts.limit); loadAccounts(); });
  $('#accounts-next').addEventListener('click', () => { if (state.accounts.reviewOnly) return; state.accounts.offset = nextOffset(state.accounts.offset, state.accounts.limit, state.accounts.total); loadAccounts(); });
  const scoreHelp = $('#score-help-btn'); if (scoreHelp) scoreHelp.addEventListener('click', showScoreHelp);

  // proses buttons
  $('#btn-session-ig').addEventListener('click', () => api.openLogin('instagram').catch(() => toast('Gagal membuka jendela login.', 'error')));
  $('#btn-session-tk').addEventListener('click', () => api.openLogin('tiktok').catch(() => toast('Gagal membuka jendela login.', 'error')));
  $('#auth-banner-ig').addEventListener('click', () => api.openLogin('instagram').catch(() => toast('Gagal membuka jendela login.', 'error')));
  $('#auth-banner-tk').addEventListener('click', () => api.openLogin('tiktok').catch(() => toast('Gagal membuka jendela login.', 'error')));

  // settings: updates
  $('#btn-check-update').addEventListener('click', async () => {
    const btn = $('#btn-check-update');
    btn.disabled = true;
    try { renderUpdate(await api.checkForUpdates()); } catch { toast('Gagal memeriksa pembaruan.', 'error'); } finally { btn.disabled = false; }
  });
  $('#btn-install-update').addEventListener('click', () => { api.installUpdate(); });
  $('#btn-open-releases').addEventListener('click', () => api.openExternal('https://github.com/startupmini/sunscrap/releases'));

  // settings: database & privasi
  $('#btn-backup').addEventListener('click', async () => {
    try {
      const r = await api.dbBackup();
      if (r && r.error) toast(r.error, 'error'); else if (r && !r.canceled) toast('Cadangan tersimpan.', 'ok');
    } catch { toast('Gagal membuat cadangan.', 'error'); }
  });
  $('#btn-restore').addEventListener('click', async () => {
    let prev = null;
    try { prev = await api.restorePreview(); } catch { toast('Gagal membaca cadangan.', 'error'); return; }
    if (prev.canceled) return;
    if (prev.error) { toast(prev.error, 'error'); return; }
    const c = prev.counts || {};
    const schemaMismatch = prev.schema_version !== undefined && prev.schema_version !== null && Number(prev.schema_version) !== 5;
    openModal(`<div class="modal-head"><h3>Pulihkan dari cadangan</h3><button class="btn btn-ghost" data-close>✕</button></div><div class="modal-body">
      <p>Anda akan mengganti <b>seluruh data saat ini</b> dengan cadangan:</p>
      <ul style="margin:0 0 8px 18px"><li><b>File:</b> ${esc(prev.file)}</li><li>Audit ${fmt(c.audits)} · Target ${fmt(c.targets)} · Snapshot ${fmt(c.snapshots)} · Akun ${fmt(c.accounts)}</li><li>Skema: v${esc(prev.schema_version ?? '?')} (aplikasi ini: v5)</li></ul>
      ${schemaMismatch ? `<p class="muted" style="border-left:3px solid var(--err);padding-left:10px;color:var(--err)"><b>Tidak kompatibel:</b> cadangan dibuat dengan skema v${esc(prev.schema_version)}. Pemulihan ditolak.</p>` : '<p class="muted">Data aktif dicadangkan otomatis dulu sebelum diganti. Tidak bisa dibatalkan.</p>'}</div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger" id="confirm-restore" ${schemaMismatch ? 'disabled' : ''}>Pulihkan</button></div>`);
    $('#confirm-restore').addEventListener('click', async () => {
      let r = null;
      try { r = await api.restoreCommit(prev.path); } catch { toast('Gagal memulihkan data.', 'error'); return; }
      closeModal();
      if (r && r.error) toast(r.error, 'error');
      else if (r) { toast('Data dipulihkan. Safety backup: ' + (r.safety_path || r.safety_backup), 'ok'); await pollUpdate(); }
    });
  });
  $('#btn-clear-session').addEventListener('click', () => {
    openModal(`<div class="modal-head"><h3>Hapus sesi login?</h3><button class="btn btn-ghost" data-close>✕</button></div><div class="modal-body">
      <p>Sesi login Instagram &amp; TikTok akan dihapus. <b>Worker akan berhenti sampai Anda login ulang.</b> Data audit TIDAK terhapus.</p></div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger" id="confirm-clear-session">Hapus sesi</button></div>`);
    $('#confirm-clear-session').addEventListener('click', async () => {
      let r = null;
      try { r = await api.clearSession(); } catch { r = { ok: false, error: 'Gagal menghapus sesi.' }; }
      closeModal();
      if (r && r.ok) toast('Sesi login dihapus. Login ulang lewat tray/Browser.', 'ok'); else toast((r && r.error) || 'Gagal hapus sesi.', 'error');
    });
  });

  // tampilan & privasi
  $$('#theme-picker .theme-radio').forEach((r) => r.addEventListener('change', () => { if (r.checked) applyTheme(r.dataset.theme); }));
  const density = $('#density-select');
  if (density) density.addEventListener('change', () => applyDensity(density.value));
  $('#btn-diag').addEventListener('click', async () => { try { await api.copyDiagnostics(); toast('Info diagnostik disalin ke clipboard.', 'ok'); } catch { toast('Gagal menyalin info diagnostik.', 'error'); } });
  $('#btn-open-data').addEventListener('click', () => api.openDataFolder().catch(() => { /* gagal buka folder data — abaikan */ }));
  $('#btn-clear').addEventListener('click', () => {
    openModal(`<div class="modal-head"><h3>Hapus semua data</h3><button class="btn btn-ghost" data-close>✕</button></div><div class="modal-body">
      <p>Semua audit, target, snapshot, dan data akun akan dihapus <b>permanen</b>.</p>
      <div class="field"><label>Ketik <b>HAPUS</b> untuk melanjutkan</label><input id="clear-confirm" class="input" placeholder="HAPUS"></div>
      <label class="row-gap" style="margin-top:6px"><input type="checkbox" id="clear-backup" checked> Cadangkan database dulu (disarankan)</label></div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger" id="confirm-clear" disabled>Hapus semua</button></div>`);
    const checkEnabled = () => { $('#confirm-clear').disabled = $('#clear-confirm').value.trim() !== 'HAPUS'; };
    $('#clear-confirm').addEventListener('input', checkEnabled);
    checkEnabled();
    $('#confirm-clear').addEventListener('click', async () => {
      if ($('#clear-backup').checked) {
        try { await api.dbBackup(); } catch { toast('Cadangan gagal — penghapusan dibatalkan demi keamanan.', 'error'); return; }
      }
      try { await api.clearAll(); } catch { toast('Gagal menghapus data.', 'error'); return; }
      closeModal();
      toast('Data dihapus.', 'ok');
      await pollUpdate();
    });
  });
}

// ---------- init ----------
async function init() {
  applyTheme((typeof localStorage !== 'undefined' && localStorage.getItem('sa_theme')) || 'system');
  applyDensity((typeof localStorage !== 'undefined' && localStorage.getItem('sa_density')) || 'auto');
  window.addEventListener('resize', () => {
    const sel = $('#density-select');
    if (sel && sel.value === 'auto') applyDensity('auto');
  });
  bindEvents();
  bindBrowser();
  bindGlobalSearch();
  bindTrend();
  bindKeyboardShortcuts();
  $$('.mini-tabs[role="tablist"]').forEach(enableTablistKeyboard);
  await loadAudits();
  await loadReviews();
  await refreshWorker();
  await refreshUpdatePanel();
  await refreshDashboard();

  window.sunscrap.onEvent((payload) => {
    if (payload.type === 'worker') { state.worker = payload.payload; renderWorker(); }
    else if (payload.type === 'data') schedulePoll();
    else if (payload.type === 'menu') handleMenuAction(payload.payload && payload.payload.action);
    else if (payload.type === 'update') renderUpdate(payload.payload);
  });

  // polling ringan: worker selalu; tab aktif ikut disegarkan
  setInterval(() => {
    if (document.hidden) return;
    refreshWorker();
    if (state.tab === 'dashboard') refreshDashboard();
    else if (state.tab === 'proses') loadProcess();
    else if (state.tab === 'browser') renderLoginStatus();
    else if (state.tab === 'settings') loadSettings();
  }, 5000);
}

init();
