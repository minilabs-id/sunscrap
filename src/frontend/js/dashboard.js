/**
 * sunscrap v2 — Ringkasan (dashboard action-first)
 * Urutan: perlu tindakan → KPI → tren + komposisi → tema/top konten → platform/kualitas.
 */
import { $, $$, toast } from './dom.js';
import {
  api, esc, fmt, fmtPct, fmtCompact, fmtDayShort, fmtDateFull, relTime,
  delta7, signedPct, sparklinePoints, emptyState, sum, summarySignature, idID,
} from './helpers.js';
import { state } from './state.js';
import { applyStatusFilter } from './targets.js';
import { refreshAccountIntel } from './intel.js';

// ── timeseries (cache per audit) ───────────────────────────────
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

// ── KPI murni ──────────────────────────────────────────────────
function niceCeil(n) { if (n <= 1) return 1; const p = Math.pow(10, Math.floor(Math.log10(n))); return Math.ceil(n / p) * p; }

function renderKpis(summary, ts) {
  const k = (summary && summary.kpi) || {};
  const totals = k.totals || {};
  const days = (ts && ts.days) || [];
  const sViews = days.map((d) => d.views);
  const sVerified = days.map((d) => (d.ok_count || 0) + (d.partial_count || 0));
  const scraped = k.scraped || 0, targets = k.targets || 0;
  const shareScraped = targets ? Math.round(scraped / targets * 100) : 0;
  const successPct = scraped && k.success_rate != null ? fmtPct(k.success_rate) : '—';

  const cards = [
    { label: 'Total views', value: fmtCompact(totals.views || 0), sub: `${fmtCompact(totals.likes || 0)} likes · ${fmtCompact(totals.comments || 0)} komentar`, series: sViews, delta: delta7(sViews) },
    { label: 'Terverifikasi', value: fmt((k.ok || 0) + (k.partial || 0)), sub: `OK ${fmt(k.ok)} · sebagian ${fmt(k.partial)}`, series: sVerified, delta: delta7(sVerified) },
    { label: 'Tingkat berhasil', value: successPct, sub: `${fmt(scraped)} dari ${fmt(targets)} target terproses (${shareScraped}%)`, series: null, delta: null },
    { label: 'Akun terpantau', value: fmt(k.accounts || 0), sub: `${fmt(k.audits || 0)} audit · ${fmt(targets)} target`, series: null, delta: null },
  ];
  $('#kpi-grid').innerHTML = cards.map((c) => `
    <article class="kpi">
      <div class="kpi-top">
        <span class="kpi-lbl">${esc(c.label)}</span>
        ${c.series
          ? `<svg class="spark" viewBox="0 0 78 24" role="presentation" aria-hidden="true"><polyline fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${sparklinePoints(c.series)}"/></svg>`
          : ''}
      </div>
      <div class="num">${esc(c.value)}</div>
      <div class="kpi-foot"><span class="delta ${c.delta === null || c.delta === undefined ? 'flat' : c.delta >= 0 ? 'good' : 'bad'}">${c.delta === null || c.delta === undefined ? '–' : signedPct(c.delta)}</span><span>${esc(c.sub)}</span></div>
    </article>`).join('');
}

// ── Tren (SVG area chart) ──────────────────────────────────────
function renderTrend() {
  const box = $('#trend-chart');
  if (!box) return;
  const days = (state.timeseries && state.timeseries.days) || [];
  const line = $('#trend-line');
  const area = $('#trend-area');
  if (!days.length) {
    if (line) line.setAttribute('d', '');
    if (area) area.setAttribute('d', 'M36,190 L650,190 Z');
    $('#trend-y').innerHTML = '';
    $('#trend-cells').innerHTML = '';
    $('#trend-axis-x').innerHTML = '';
    $('#trend-sub').textContent = 'Belum ada aktivitas dalam 30 hari terakhir.';
    return;
  }
  const metric = state.metric;
  const vals = days.map((d) => Number(d[metric]) || 0);
  const max = niceCeil(Math.max(...vals, 1));
  const x0 = 36, x1 = 650, yTop = 24, yBase = 190;
  const step = (x1 - x0) / (days.length - 1);
  const pts = vals.map((v, i) => [Math.round(x0 + i * step), Math.round(yBase - (v / max) * (yBase - yTop))]);
  const lineD = 'M' + pts.map(([x, y]) => `${x},${y}`).join(' L');
  if (line) line.setAttribute('d', lineD);
  if (area) area.setAttribute('d', `${lineD} L${x1},${yBase} L${x0},${yBase} Z`);

  $('#trend-cells').innerHTML = pts.map(([x, y], i) => `
    <g class="day-cell" data-idx="${i}">
      <rect class="day-cap" x="${x - 12}" y="16" width="24" height="176"></rect>
      <circle class="trend-dot" cx="${x}" cy="${y}" r="4.2" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" opacity="0"></circle>
    </g>`).join('');
  const mid = Math.floor((days.length - 1) / 2);
  const midDate = days[mid] && days[mid].date ? days[mid].date : days[0].date;
  $('#trend-axis-x').innerHTML = [
    `<text class="axis-label" x="36" y="212" text-anchor="start">${esc(fmtDayShort(days[0].date))}</text>`,
    `<text class="axis-label" x="${pts[mid][0]}" y="212" text-anchor="middle">${esc(fmtDayShort(midDate))}</text>`,
    `<text class="axis-label" x="650" y="212" text-anchor="end">${esc(fmtDayShort(days[days.length - 1].date))}</text>`,
  ].join('');
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => ({ y: 190 - f * 166, v: max * f }));
  const tickLabel = (v) => (v >= 10 ? fmtCompact(Math.round(v)) : idID(v, 1));
  $('#trend-y').innerHTML = ticks.map((t) => `<text class="axis-label" x="30" y="${(t.y + 3).toFixed(1)}" text-anchor="end">${esc(tickLabel(t.v))}</text>`).join('');

  const metricLabel = { views: 'Views', likes: 'Likes', scraped: 'Post' }[metric] || metric;
  const peak = Math.max(...vals);
  const totalV = sum(vals);
  $('#trend-sub').textContent = `${metricLabel} — ${fmt(totalV)} dalam 30 hari · puncak ${fmtCompact(peak)} (${fmtDayShort(days[vals.indexOf(peak)].date)})`;
}

function onTrendMove(e) {
  const box = $('#trend-chart');
  const days = (state.timeseries && state.timeseries.days) || [];
  const tip = $('#chart-tooltip');
  if (!box || !days.length || !tip) return;
  const rect = box.getBoundingClientRect();
  const innerX = (e.clientX - rect.left) * (660 / rect.width) - 36;
  const step = (650 - 36) / (days.length - 1);
  let idx = Math.round(innerX / step);
  idx = Math.max(0, Math.min(days.length - 1, idx));
  const d = days[idx];
  tip.innerHTML = `<b>${esc(fmtDateFull(d.date))}</b><br>${fmtCompact(d.views)} views · ${fmtCompact(d.likes)} likes<br>${fmt(d.scraped)} post · ${fmt(d.targets)} akun<br><span class="muted">OK ${fmt(d.ok_count)} · sebagian ${fmt(d.partial_count)} · gagal ${fmt(d.failed_count)}</span>`;
  tip.hidden = false;
  tip.style.opacity = '1';
  const maxX = Math.max(8, rect.width - 240);
  tip.style.left = Math.min(maxX, Math.max(8, e.clientX - rect.left - 12)) + 'px';
  tip.style.top = Math.max(0, e.clientY - rect.top - 12) + 'px';
  const dot = box.querySelector(`.day-cell[data-idx="${idx}"] .trend-dot`);
  if (dot) dot.setAttribute('opacity', '1');
}

function hideTrendTooltip() {
  const tip = $('#chart-tooltip');
  if (tip) { tip.hidden = true; tip.style.opacity = '0'; }
  $$('#trend-chart .trend-dot').forEach((d) => d.setAttribute('opacity', '0'));
}

// ── Komposisi status (stacked bar) ─────────────────────────────
const STACK_SEGS = [
  { key: 'done', label: 'Berhasil', cls: 'seg-ok' },
  { key: 'pending', label: 'Menunggu', cls: 'seg-idle' },
  { key: 'failed', label: 'Gagal', cls: 'seg-err' },
];

function stackCounts(k) {
  k = k || {};
  return {
    done: (k.ok || 0) + (k.partial || 0),
    pending: (k.pending || 0) + (k.running || 0),
    failed: k.failed || 0,
  };
}

function renderStackbar(summary) {
  const k = (summary && summary.kpi) || {};
  const counts = stackCounts(k);
  const total = counts.done + counts.pending + counts.failed;
  const active = state.statusFilterActive;

  const bar = $('#stackbar');
  if (bar) {
    if (!total) {
      bar.innerHTML = '<span class="stackbar-empty">Belum ada data — import target dulu</span>';
    } else {
      bar.innerHTML = STACK_SEGS.map((s) => {
        const v = counts[s.key];
        const pct = (v / total) * 100;
        const isActive = active === s.key;
        return `<button class="${s.cls}${isActive ? ' is-active' : ''}" data-key="${s.key}" style="width:${Math.max(pct, v ? 4 : 0)}%" aria-pressed="${isActive}" title="${esc(s.label)} — ${fmt(v)} target (${idIDSafe(pct)}%)">${v ? fmt(v) : ''}</button>`;
      }).join('');
      bar.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => toggleStackFilter(btn.dataset.key)));
    }
    bar.classList.toggle('dim', !!active);
  }

  const legend = $('#stack-legend');
  if (legend) {
    legend.innerHTML = STACK_SEGS.map((s) => {
      const v = counts[s.key];
      const pct = total ? (v / total) * 100 : 0;
      const isActive = active === s.key;
      return `<button class="legend-row" data-key="${s.key}" aria-pressed="${isActive}">
        <span class="legend-dot ${s.cls}" style="background:${legendColor(s.key)}"></span>
        <b>${esc(s.label)}</b>
        <small>${fmt(v)} target</small>
        <span class="pct">${idIDSafe(pct)}%</span>
      </button>`;
    }).join('');
    legend.querySelectorAll('.legend-row').forEach((btn) => btn.addEventListener('click', () => toggleStackFilter(btn.dataset.key)));
  }
}
const legendColor = (key) => ({ done: '#1f9d63', pending: '#a8a49e', failed: '#d64545' }[key] || '#a8a49e');
const idIDSafe = (n) => (Number.isFinite(n) ? n.toLocaleString('id-ID', { maximumFractionDigits: 1 }) : '0');

function toggleStackFilter(key) {
  const current = state.statusFilterActive;
  state.statusFilterActive = current === key ? null : key;
  applyStatusFilter(state.statusFilterActive);
  renderStackbar(state.summary);
}

// ── Tema teratas ───────────────────────────────────────────────
const barER = (er, max) => Math.round((er ?? 0) / (max || 1) * 100);

function renderTemaTable(summary) {
  const host = $('#tema-table');
  if (!host) return;
  const temas = (summary && summary.temas) || [];
  if (!temas.length) { host.innerHTML = `<tbody><tr><td>${emptyState('Belum ada tema', 'Kolom "tema" kosong di data Anda.')}</td></tr></tbody>`; return; }
  const list = [...temas].sort((a, b) => state.temaSort === 'er' ? ((b.median_er ?? -1) - (a.median_er ?? -1)) : ((b.views ?? 0) - (a.views ?? 0))).slice(0, 6);
  const maxER = Math.max(...list.map((t) => t.median_er ?? 0), 1);
  host.innerHTML = `<thead><tr><th scope="col">Tema</th><th scope="col" class="r">Target</th><th scope="col" class="r">Views</th><th scope="col" class="r">Median ER</th></tr></thead><tbody>${list.map((t) => `
    <tr tabindex="0" data-tema="${esc(t.tema || '')}" role="button" aria-label="Filter target tema ${esc(t.tema || '')}">
      <td><strong>${esc(t.tema || '(tanpa tema)')}</strong></td>
      <td class="r">${fmt(t.targets)}</td>
      <td class="r">${esc(fmtCompact(t.views))}</td>
      <td class="r"><span class="er-track" title="${t.median_er !== null && t.median_er !== undefined ? fmtPct(t.median_er) : '—'}"><span class="er-fill" style="width:${barER(t.median_er, maxER)}%"></span></span> <b>${t.median_er !== null && t.median_er !== undefined ? fmtPct(t.median_er) : '—'}</b></td>
    </tr>`).join('')}</tbody>`;
  host.querySelectorAll('tr[data-tema]').forEach((row) => {
    const go = () => filterTargetsByTema(row.dataset.tema);
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

function filterTargetsByTema(tema) {
  $('#target-q').value = tema === '(tanpa tema)' ? '' : tema;
  state.targets.offset = 0;
  document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'targets' }));
}

// ── Top konten ─────────────────────────────────────────────────
function renderTopPosts(summary) {
  const views = (summary && summary.posts && summary.posts.top_views) || [];
  const er = (summary && summary.posts && summary.posts.top_er) || [];
  const row = (p, i) => `
    <div class="leader-row${i < 3 ? ' is-top' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="leader-main"><b>${esc(p.handle || '—')}</b><span class="muted"> · ${p.platform === 'instagram' ? 'Instagram' : 'TikTok'}${p.scraped_at ? ' · ' + esc(relTime(p.scraped_at)) : ''}</span></span>
      <span class="leader-num"><b>${esc(fmtCompact(p.views ?? 0))}</b><span class="muted">views</span></span>
      <span class="leader-num"><b>${p.er !== null && p.er !== undefined ? fmtPct(p.er) : '—'}</b><span class="muted">ER</span></span>
    </div>`;
  $('#top-views').innerHTML = views.length ? views.map(row).join('') : emptyState('Belum ada data', 'Import data, lalu jalankan worker.');
  $('#top-er').innerHTML = er.length ? er.map(row).join('') : emptyState('Belum ada data', 'Import data, lalu jalankan worker.');
}

// ── Per platform ───────────────────────────────────────────────
function renderPlatformCompare(summary) {
  const platforms = (summary && summary.platforms) || [];
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
        <div class="bc-head">${esc(label)}</div>
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

// ── Kualitas data (setiap baris = aksi) ────────────────────────
function renderQuality(summary) {
  const q = (summary && summary.quality) || {};
  const k = (summary && summary.kpi) || {};
  const auditId = state.auditId;
  const rows = [
    { n: q.without_followers || 0, label: 'target tanpa data followers', hint: 'Kunjungi profil untuk mengisi profil & follower', action: auditId ? { label: 'Kunjungi profil', act: 'profile', primary: true } : null },
    { n: q.missing_views || 0, label: 'video TikTok tanpa views', hint: 'Kemungkinan privat / age-gated', action: { label: 'Lihat', act: 'views' } },
    { n: k.failed || 0, label: 'target gagal', hint: 'Didominasi throttle — coba ulang setelah jeda', action: auditId ? { label: 'Ulangi gagal', act: 'retry', primary: true } : null },
    { n: q.missing_username || 0, label: 'target tanpa handle', hint: 'Username tidak ter-parse dari URL', action: null },
    { n: q.never_scraped || 0, label: 'target belum diproses', hint: 'Menunggu giliran worker', action: { label: 'Buka Proses', act: 'proses' } },
  ];
  $('#quality-list').innerHTML = rows.map((r) => `
    <div class="check-row"><div><strong>${fmt(r.n)} ${esc(r.label)}</strong><div class="muted" style="font-size:var(--fs-micro)">${esc(r.hint)}</div></div>${r.action ? `<button class="btn ${r.action.primary ? 'btn-primary' : 'btn-ghost'} btn-sm" data-quality-action="${r.action.act}">${esc(r.action.label)}</button>` : '<span class="muted">—</span>'}</div>`).join('');
}

// ── Perbandingan periode (hanya tampil bila ≥ 2 periode) ───────
function renderCompare(summary, compare) {
  const card = $('#compare-card');
  const el = $('#compare-panel');
  if (!card || !el) return;
  if (!compare || !compare.periods || compare.periods.length < 2) { card.hidden = true; return; }
  card.hidden = false;
  const s = compare.summary || {};
  el.innerHTML = `<p style="margin:0 0 10px">${compare.periods.length} periode · terbaru <b>${esc(compare.latest_period)}</b> · ${fmt(s.accounts)} akun · <b>${fmt(s.new_accounts)} baru</b> · ${fmt(s.missing_latest)} hilang di periode terbaru</p>
    <blockquote class="compare-quote">Impor periode ini: <b>${fmt((summary?.kpi || {}).targets)}</b> target · views <b>${fmtCompact((summary?.kpi?.totals || {}).views)}</b></blockquote>
    <p class="muted" style="margin-bottom:0">Tip: buka tab <b>Akun</b> untuk melihat klaster dan skor risiko per akun.</p>`;
}

// ── Kartu "Perlu tindakan" ─────────────────────────────────────
function renderAttention(summary) {
  const k = (summary && summary.kpi) || {};
  const failed = k.failed || 0;
  const pending = (k.pending || 0) + (k.running || 0);
  const set = (id, num, enabled) => {
    const n = $(id + '-num');
    const btn = $(id);
    if (n) n.textContent = fmt(num);
    if (btn) btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  };
  set('#att-failed', failed, failed > 0);
  set('#att-pending', pending, true); // selalu boleh membuka Proses
}

// ── Onboarding (belum ada audit) ───────────────────────────────
async function renderOnboarding() {
  const host = $('#onboarding-host');
  if (!host) return;
  const hasAudits = (state.audits || []).length > 0;
  if (hasAudits) { host.hidden = true; host.innerHTML = ''; return; }

  let login = { instagram: false, tiktok: false };
  try { login = await api.getLoginStatus() || login; } catch { /* dianggap belum login */ }
  const workerActive = !!(state.worker && state.worker.active);
  const k = (state.summary && state.summary.kpi) || {};
  const processed = (k.scraped || 0) > 0;

  const steps = [
    { done: login.instagram || login.tiktok, title: 'Login Instagram / TikTok', sub: login.instagram || login.tiktok ? 'Sesi aktif' : 'Buka jendela login (atau lewat tray)', actions: `<button class="btn btn-ghost btn-sm" id="ob-ig">Login IG</button><button class="btn btn-ghost btn-sm" id="ob-tk">Login TikTok</button>` },
    { done: hasAudits, title: 'Import data', sub: 'CSV/XLSX dengan kolom Link, atau tempel langsung', actions: `<button class="btn btn-primary btn-sm" id="ob-import">Import data</button>` },
    { done: workerActive, title: 'Mulai worker', sub: 'Worker mengunjungi akun & mengumpulkan metrik secara berkala', actions: `<button class="btn btn-ghost btn-sm" id="ob-worker">${workerActive ? 'Hentikan' : 'Mulai worker'}</button>` },
    { done: processed, title: 'Lihat hasil', sub: 'Pantau delta & skor risiko akun, lalu export', actions: `<button class="btn btn-ghost btn-sm" id="ob-proses">Buka Proses</button>` },
  ];

  host.hidden = false;
  host.innerHTML = `
    <div class="card" style="margin-bottom:var(--sp-4)">
      <div class="card-hd"><div><div class="card-title">Mulai di sini</div><div class="card-sub">Empat langkah singkat untuk audit pertama Anda</div></div></div>
      <div class="ob-steps">${steps.map((s, i) => `
        <div class="ob-step${s.done ? ' done' : ''}">
          <span class="ob-num">${s.done ? '✓' : (i + 1)}</span>
          <div class="ob-body"><b>${esc(s.title)}</b><span class="muted">${esc(s.sub)}</span></div>
          <div class="ob-actions">${s.actions}</div>
        </div>`).join('')}
      </div>
    </div>`;

  const ig = $('#ob-ig'); if (ig) ig.addEventListener('click', () => api.openLogin('instagram').catch(() => toast('Gagal membuka login.', 'error')));
  const tk = $('#ob-tk'); if (tk) tk.addEventListener('click', () => api.openLogin('tiktok').catch(() => toast('Gagal membuka login.', 'error')));
  const imp = $('#ob-import'); if (imp) imp.addEventListener('click', () => document.dispatchEvent(new CustomEvent('sunscrap:open-import')));
  const wk = $('#ob-worker'); if (wk) wk.addEventListener('click', () => document.dispatchEvent(new CustomEvent('sunscrap:toggle-worker')));
  const pr = $('#ob-proses'); if (pr) pr.addEventListener('click', () => document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'proses' })));
}

// ── Refresh utama (render-gate via signature) ──────────────────
export async function refreshDashboard() {
  if (state.tab !== 'dashboard') return;
  renderOnboarding();
  try {
    const summary = await api.getSummary(state.auditId);
    if (!summary) return;
    const ts = await loadTimeseries();
    const sig = summarySignature(summary, ts);
    if (sig === state.dashSig) {
      $('#dash-sub').textContent = `Diperbarui ${relTime(summary.generated_at)} · ${fmt(summary.kpi?.targets || 0)} target`;
      return;
    }
    state.dashSig = sig;
    state.summary = summary;

    renderAttention(summary);
    renderKpis(summary, ts);
    renderTrend();
    renderStackbar(summary);
    renderTemaTable(summary);
    renderTopPosts(summary);
    renderPlatformCompare(summary);
    renderQuality(summary);
    try { renderCompare(summary, await api.getCompare({ months: 6 })); } catch { const el = $('#compare-panel'); if (el) el.textContent = '—'; }
    await refreshAccountIntel(); // badge + kartu "Perlu tinjauan"
    $('#dash-sub').textContent = `Diperbarui ${relTime(summary.generated_at)} · ${fmt(summary.kpi?.targets || 0)} target`;
  } catch (e) {
    console.error('refreshDashboard gagal:', e);
  }
}

export function bindDashboardEvents() {
  $('#trend-chart').addEventListener('mousemove', onTrendMove);
  $('#trend-chart').addEventListener('mouseenter', onTrendMove);
  $('#trend-chart').addEventListener('mouseleave', hideTrendTooltip);
  $$('.mini-tabs [data-metric]').forEach((btn) => btn.addEventListener('click', () => {
    state.metric = btn.dataset.metric;
    $$('.mini-tabs [data-metric]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    renderTrend();
  }));
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
  $('#btn-clear-status-filter').addEventListener('click', () => { state.statusFilterActive = null; applyStatusFilter(null); renderStackbar(state.summary); });

  // Kartu "Perlu tindakan"
  $('#att-review').addEventListener('click', () => {
    if (state.needsReview <= 0) return;
    document.dispatchEvent(new CustomEvent('sunscrap:open-triage'));
  });
  $('#att-failed').addEventListener('click', () => {
    const k = (state.summary && state.summary.kpi) || {};
    if (!(k.failed > 0)) return;
    state.targets.status = 'failed';
    state.targets.issue = '';
    state.targets.offset = 0;
    state.statusFilterActive = null;
    document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'targets' }));
  });
  $('#att-pending').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'proses' }));
  });

  // Aksi kualitas data (delegasi, karena tombol dirender ulang)
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
      state.statusFilterActive = null;
      document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'targets' }));
    } else if (act === 'retry') {
      if (!state.auditId) return;
      api.retryFailed(state.auditId).then((r) => toast((r && r.error) || `Dijadwalkan ulang ${fmt(r && r.created)} gagal.`, r && r.error ? 'error' : 'ok')).catch(() => toast('Gagal menjadwalkan ulang.', 'error'));
    } else if (act === 'proses') {
      document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'proses' }));
    }
  });
}
