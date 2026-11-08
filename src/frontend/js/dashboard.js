/**
 * sunscrap v2 — Ringkasan (dashboard action-first)
 * Urutan: perlu tindakan → KPI → tren + kualitas → top konten IG/TikTok → per platform.
 */
import { $, $$, toast } from './dom.js';
import {
  api, esc, fmt, fmtPct, fmtCompact, fmtDayShort, fmtDateFull, relTime,
  delta7, signedPct, sparklinePoints, emptyState, sum, summarySignature, idID,
} from './helpers.js';
import { state } from './state.js';
import { setNavTargetCount } from './chrome.js';
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
  const successPct = scraped && k.success_rate != null ? fmtPct(k.success_rate) : '—';

  const cards = [
    { label: 'Total views', value: fmtCompact(totals.views || 0), sub: `${fmtCompact(totals.likes || 0)} likes · ${fmtCompact(totals.comments || 0)} komentar`, series: sViews, delta: delta7(sViews), action: 'targets' },
    { label: 'Terverifikasi', value: fmt((k.ok || 0) + (k.partial || 0)), sub: `OK ${fmt(k.ok)} · sebagian ${fmt(k.partial)}`, series: sVerified, delta: delta7(sVerified), action: 'targets' },
    { label: 'Tingkat berhasil', value: successPct, sub: `${fmt(scraped)} dari ${fmt(targets)} postingan terproses`, series: null, delta: null, action: 'targets' },
    { label: 'Jumlah akun', value: fmt(k.accounts || 0), sub: `${fmt(k.audits || 0)} audit · ${fmt(targets)} postingan`, series: null, delta: null, action: 'accounts' },
  ];
  $('#kpi-grid').innerHTML = cards.map((c) => `
    <article class="kpi kpi-action" role="button" tabindex="0" data-kpi-action="${c.action}" aria-label="Buka ${esc(c.label)}" title="Buka ${esc(c.label)}">
      <div class="kpi-top">
        <span class="kpi-lbl">${esc(c.label)}</span>
        ${c.series
          ? `<svg class="spark" viewBox="0 0 78 24" role="presentation" aria-hidden="true"><polyline fill="none" stroke="var(--accent-strong)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${sparklinePoints(c.series)}"/></svg>`
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
  const bars = $('#trend-bars');
  const grid = $('#trend-grid');
  const todayEl = $('#trend-today');
  const empty = !days.length || (state.timeseries && days.every((d) => (d.scraped || 0) === 0));
  if (empty) {
    if (line) line.setAttribute('d', '');
    if (area) area.setAttribute('d', 'M36,190 L650,190 Z');
    if (bars) bars.innerHTML = '';
    if (grid) grid.innerHTML = '';
    if (todayEl) todayEl.innerHTML = '';
    $('#trend-y').innerHTML = '';
    $('#trend-cells').innerHTML = '';
    $('#trend-axis-x').innerHTML = '';
    $('#trend-sub').textContent = 'Belum ada aktivitas dalam 30 hari terakhir.';
    return;
  }
  const metric = state.metric;
  const isBars = metric === 'scraped';
  const vals = days.map((d) => Number(d[metric]) || 0);
  const max = niceCeil(Math.max(...vals, 1));
  const x0 = 36, x1 = 650, yTop = 24, yBase = 190;
  const step = (x1 - x0) / (days.length - 1);
  const pts = vals.map((v, i) => [Math.round(x0 + i * step), Math.round(yBase - (v / max) * (yBase - yTop))]);

  if (isBars) {
    if (line) line.setAttribute('d', '');
    if (area) area.setAttribute('d', 'M36,190 L650,190 Z');
    if (bars) bars.innerHTML = pts.map(([x, y]) => `<rect class="trend-bar" x="${x - 6}" y="${y}" width="12" height="${Math.max(1, yBase - y)}" rx="2"></rect>`).join('');
  } else {
    if (bars) bars.innerHTML = '';
    const lineD = 'M' + pts.map(([x, y]) => `${x},${y}`).join(' L');
    if (line) line.setAttribute('d', lineD);
    if (area) area.setAttribute('d', `${lineD} L${x1},${yBase} L${x0},${yBase} Z`);
  }

  // Sel hover + dot; titik terakhir selalu tampil sebagai jangkar "hari ini".
  $('#trend-cells').innerHTML = pts.map(([x, y], i) => {
    const last = i === days.length - 1;
    return `<g class="day-cell${last ? ' is-last' : ''}" data-idx="${i}">
      <rect class="day-cap" x="${x - 12}" y="16" width="24" height="176"></rect>
      <circle class="trend-dot${last ? ' keep' : ''}" cx="${x}" cy="${y}" r="4.2" fill="var(--accent-strong)" stroke="var(--surface)" stroke-width="2" opacity="${last ? '1' : '0'}"></circle>
    </g>`;
  }).join('');

  // Sumbu X: awal / tengah / akhir.
  const mid = Math.floor((days.length - 1) / 2);
  const midDate = days[mid] && days[mid].date ? days[mid].date : days[0].date;
  $('#trend-axis-x').innerHTML = [
    `<text class="axis-label" x="36" y="212" text-anchor="start">${esc(fmtDayShort(days[0].date))}</text>`,
    `<text class="axis-label" x="${pts[mid][0]}" y="212" text-anchor="middle">${esc(fmtDayShort(midDate))}</text>`,
    `<text class="axis-label" x="650" y="212" text-anchor="end">${esc(fmtDayShort(days[days.length - 1].date))}</text>`,
  ].join('');

  // Grid + sumbu Y dari SATU sumber (selaras), termasuk label 0.
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  const ticks = fractions.map((f) => ({ y: Math.round(yBase - f * (yBase - yTop)), v: max * f, f }));
  const tickLabel = (v) => (v >= 10 ? fmtCompact(Math.round(v)) : idID(v, 1));
  if (grid) grid.innerHTML = ticks.filter((t) => t.f > 0).map((t) => `<line class="grid-line" x1="36" y1="${t.y}" x2="650" y2="${t.y}"></line>`).join('');
  $('#trend-y').innerHTML = ticks.map((t) => `<text class="axis-label" x="30" y="${t.y + 3}" text-anchor="end">${esc(tickLabel(t.v))}</text>`).join('');

  // Nilai titik terakhir.
  const lastVal = vals[vals.length - 1];
  const [lx, ly] = pts[pts.length - 1];
  if (todayEl) todayEl.innerHTML = `<text class="axis-label trend-last" x="${Math.min(lx, 636)}" y="${Math.max(16, ly - 10)}" text-anchor="middle">${isBars ? fmt(lastVal) : fmtCompact(lastVal)}</text>`;

  const metricLabel = { d_views: 'Δ Views', d_likes: 'Δ Likes', d_comments: 'Δ Komen', scraped: 'Diproses' }[metric] || metric;
  const totalV = sum(vals);
  const activeDays = days.filter((d) => (d.scraped || 0) > 0).length;
  $('#trend-sub').textContent = isBars
    ? `Diproses — ${fmt(totalV)} scrape · ${activeDays} hari aktif`
    : `${metricLabel} — Σ ${fmtCompact(totalV)} pertumbuhan · ${activeDays} hari diproses`;
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
  tip.innerHTML = `<b>${esc(fmtDateFull(d.date))}</b><br>Δ ${fmtCompact(d.d_views || 0)} views · Δ ${fmtCompact(d.d_likes || 0)} likes · Δ ${fmtCompact(d.d_comments || 0)} komentar<br>${fmt(d.scraped)} diproses · ${fmt(d.targets)} postingan<br><span class="muted">OK ${fmt(d.ok_count)} · sebagian ${fmt(d.partial_count)} · gagal ${fmt(d.failed_count)}</span>`;
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
  $$('#trend-chart .trend-dot:not(.keep)').forEach((d) => d.setAttribute('opacity', '0'));
}

// ── Top konten (per platform) ──────────────────────────────────
function renderTopPosts(summary) {
  const ig = (summary && summary.posts && summary.posts.top_instagram) || [];
  const tk = (summary && summary.posts && summary.posts.top_tiktok) || [];
  const row = (p, i) => {
    // IG: postingan foto tak punya "views", jadi pakai likes; reels/video & TikTok pakai views.
    const showViews = p.platform !== 'instagram' || (p.views !== null && p.views !== undefined);
    const value = showViews ? (p.views ?? 0) : (p.likes ?? 0);
    const unit = showViews ? 'views' : 'likes';
    return `
    <div class="leader-row${i < 3 ? ' is-top' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="leader-main"><b>${esc(p.handle || '—')}</b>${p.scraped_at ? `<span class="muted"> · ${esc(relTime(p.scraped_at))}</span>` : ''}</span>
      <span class="leader-num"><b>${esc(fmtCompact(value))}</b><span class="muted">${unit}</span></span>
      <span class="leader-num"><b>${p.er !== null && p.er !== undefined ? fmtPct(p.er) : '—'}</b><span class="muted">ER</span></span>
    </div>`;
  };
  $('#top-ig').innerHTML = ig.length ? ig.map(row).join('') : emptyState('Belum ada data Instagram', 'Import data, lalu jalankan worker.');
  $('#top-tk').innerHTML = tk.length ? tk.map(row).join('') : emptyState('Belum ada data TikTok', 'Import data, lalu jalankan worker.');
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
  const rows = [
    { n: q.without_followers || 0, label: 'akun tanpa data followers', hint: 'Kunjungi profil untuk mengisi profil & follower', issue: 'no_followers', btn: 'Kunjungi & kumpulkan', primary: true },
    { n: q.partial || 0, label: 'akun sebagian terbaca', hint: 'Metrik tidak lengkap — kemungkinan privat / age-gated', issue: 'partial', btn: 'Scrape ulang' },
    { n: q.missing_views || 0, label: 'TikTok tanpa views', hint: 'Video privat / age-gated, atau post foto', issue: 'no_views', btn: 'Scrape ulang' },
    { n: q.missing_username || 0, label: 'postingan tanpa handle', hint: 'Username tidak ter-parse dari URL', issue: 'no_username', btn: 'Scrape ulang' },
    { n: q.never_scraped || 0, label: 'akun belum pernah di-scrape', hint: 'Belum ada snapshot sama sekali', issue: 'never_scraped', btn: 'Scrape sekarang' },
  ];
  const visible = rows.filter((r) => r.n > 0);
  if (!visible.length) {
    $('#quality-list').innerHTML = emptyState('Semua sehat', 'Tidak ada masalah kualitas data yang terdeteksi.');
    return;
  }
  $('#quality-list').innerHTML = visible.map((r) => `
    <div class="check-row"><div class="min-0"><strong>${fmt(r.n)} ${esc(r.label)}</strong><div class="muted text-micro">${esc(r.hint)}</div></div><button class="btn ${r.primary ? 'btn-primary' : 'btn-ghost'} btn-sm" data-quality-action="fix" data-quality-issue="${r.issue}">${esc(r.btn)}</button></div>`).join('');
}

// ── Perbandingan periode (hanya tampil bila ≥ 2 periode) ───────
function renderCompare(summary, compare) {
  const card = $('#compare-card');
  const el = $('#compare-panel');
  if (!card || !el) return;
  if (!compare || !compare.periods || compare.periods.length < 2) { card.hidden = true; return; }
  card.hidden = false;
  const s = compare.summary || {};
  el.innerHTML = `<p class="mb-3">${compare.periods.length} periode · terbaru <b>${esc(compare.latest_period)}</b> · ${fmt(s.accounts)} akun · <b>${fmt(s.new_accounts)} baru</b> · ${fmt(s.missing_latest)} hilang di periode terbaru</p>
    <blockquote class="compare-quote">Impor periode ini: <b>${fmt((summary?.kpi || {}).targets)}</b> postingan · views <b>${fmtCompact((summary?.kpi?.totals || {}).views)}</b></blockquote>
    <p class="muted">Tip: buka tab <b>Akun</b> untuk melihat klaster dan skor risiko per akun.</p>`;
}

// ── Kartu "Perlu tindakan" ─────────────────────────────────────
function renderAttention(summary) {
  const k = (summary && summary.kpi) || {};
  const failed = k.failed || 0;
  const partial = k.partial || 0;
  const pending = (k.pending || 0) + (k.running || 0);
  const set = (id, num, enabled) => {
    const n = $(id + '-num');
    const btn = $(id);
    if (n) n.textContent = fmt(num);
    if (btn) btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  };
  set('#att-failed', failed, failed > 0);
  set('#att-partial', partial, partial > 0);
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
    <div class="card mb-4">
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
    setNavTargetCount((summary.kpi || {}).targets);
    const ts = await loadTimeseries();
    const sig = summarySignature(summary, ts);
    if (sig === state.dashSig) {
      $('#dash-sub').textContent = `Diperbarui ${relTime(summary.generated_at)}`;
      return;
    }
    state.dashSig = sig;
    state.summary = summary;

    renderAttention(summary);
    renderKpis(summary, ts);
    renderTrend();
    renderTopPosts(summary);
    renderPlatformCompare(summary);
    renderQuality(summary);
    try { renderCompare(summary, await api.getCompare({ months: 6 })); } catch { const el = $('#compare-panel'); if (el) el.textContent = '—'; }
    await refreshAccountIntel(); // badge + kartu "Perlu tinjauan"
    $('#dash-sub').textContent = `Diperbarui ${relTime(summary.generated_at)}`;
  } catch (e) {
    console.error('refreshDashboard gagal:', e);
  }
}

export function bindDashboardEvents() {
  // Kartu KPI (deep-link ke tab relevan)
  document.addEventListener('click', (e) => {
    const kpi = e.target.closest('[data-kpi-action]');
    if (kpi) document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: kpi.dataset.kpiAction }));
  });
  document.addEventListener('keydown', (e) => {
    const kpi = e.target.closest ? e.target.closest('[data-kpi-action]') : null;
    if (kpi && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: kpi.dataset.kpiAction }));
    }
  });

  $('#trend-chart').addEventListener('mousemove', onTrendMove);
  $('#trend-chart').addEventListener('mouseenter', onTrendMove);
  $('#trend-chart').addEventListener('mouseleave', hideTrendTooltip);
  $$('.mini-tabs [data-metric]').forEach((btn) => btn.addEventListener('click', () => {
    state.metric = btn.dataset.metric;
    $$('.mini-tabs [data-metric]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    renderTrend();
  }));
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
    state.statusFilterActive = 'failed';
    document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'targets' }));
  });
  $('#att-partial').addEventListener('click', () => {
    const k = (state.summary && state.summary.kpi) || {};
    if (!(k.partial > 0)) return;
    state.targets.status = 'partial';
    state.targets.issue = '';
    state.targets.offset = 0;
    state.statusFilterActive = 'partial';
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
    if (act === 'fix') {
      const issue = btn.dataset.qualityIssue;
      (async () => {
        try {
          const r = await api.fixQuality(state.auditId || null, issue);
          if (!r) return toast('Gagal menjadwalkan perbaikan.', 'error');
          if (r.error) return toast(r.error, 'error');
          const created = r.created || 0;
          if (!created) return toast('Tidak ada tugas baru — mungkin sudah dalam antrean.', 'ok');
          toast(`Menjadwalkan ${fmt(created)} perbaikan…`, 'ok');
          if (!(state.worker && state.worker.active)) {
            document.dispatchEvent(new CustomEvent('sunscrap:toggle-worker'));
            toast('Worker dimulai — sedang mengumpulkan data.', 'ok');
          }
        } catch {
          toast('Gagal menjadwalkan perbaikan.', 'error');
        }
      })();
    }
  });
}
