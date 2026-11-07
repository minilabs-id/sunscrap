/**
 * sunscrap v2 — intel akun (singleton cache)
 * Satu fetch `getAccounts({sort:'risk'})` per siklus; dipakai sidebar badge,
 * kartu "Perlu tinjauan", dan panel risiko di tab Akun.
 */
import { $ } from './dom.js';
import { api, fmt, fmtCompact, fmtPct, esc, reviewedDecisionCounts, emptyState } from './helpers.js';
import { state } from './state.js';
import { openAccount } from './account-detail.js';

const CACHE_MS = 4000;

export async function refreshAccountIntel(force = false) {
  const cached = state.intel;
  if (!force && cached && (Date.now() - cached.at) < CACHE_MS) return cached;
  let res = { items: [], summary: {}, clusters: [] };
  try {
    res = await api.getAccounts({ sort: 'risk', limit: 200 });
  } catch (e) {
    console.error('refreshAccountIntel gagal:', e);
    return cached || null;
  }
  const summaryIntel = res.summary || {};
  const flagged = summaryIntel.flagged || 0;
  const rCounts = reviewedDecisionCounts(state.reviews);
  const needsReview = Math.max(0, flagged - (rCounts.clear + rCounts.flag));
  state.needsReview = needsReview;

  const badge = $('#nav-accounts-count');
  if (badge) { badge.hidden = needsReview <= 0; badge.textContent = fmt(needsReview); }

  const attNum = $('#att-review-num');
  const attBtn = $('#att-review');
  if (attNum) attNum.textContent = fmt(needsReview);
  if (attBtn) attBtn.setAttribute('aria-disabled', needsReview > 0 ? 'false' : 'true');

  state.intel = {
    items: res.items || [],
    levels: summaryIntel.levels || {},
    clusters: res.clusters || [],
    clusterCount: summaryIntel.clusters || 0,
    flagged,
    needsReview,
    at: Date.now(),
  };
  return state.intel;
}

export function renderRiskPanels() {
  const intel = state.intel;
  if (!intel) return;
  const byLevel = intel.levels || {};

  const levels = [
    { key: 'pola_kembar', label: 'Pola kembar', color: 'var(--err)' },
    { key: 'pola_ternak', label: 'Pola ternak', color: 'var(--warn)' },
    { key: 'amati', label: 'Amati', color: 'var(--amati)' },
    { key: 'bersih', label: 'Bersih', color: 'var(--ok-dot)' },
  ];
  const max = Math.max(...levels.map((l) => byLevel[l.key] || 0), 1);
  const barsHost = $('#risk-bars');
  if (barsHost) {
    barsHost.innerHTML = levels.map((l) => `
      <div class="intel-row"><span class="intel-lbl">${l.label}</span>
        <div class="intel-track"><i style="width:${Math.round(((byLevel[l.key] || 0) / max) * 100)}%;background:${l.color}"></i></div>
        <span class="num intel-num">${fmt(byLevel[l.key] || 0)}</span>
      </div>`).join('');
  }

  const clustersHost = $('#clusters-list');
  if (clustersHost) {
    const strong = (intel.clusters || []).filter((c) => c.strong).slice(0, 4);
    const REASON_LABELS = { konten: 'Konten sama', kontak: 'Kontak bio sama', template: 'Caption seragam', serentak: 'Unggah serentak', nama: 'Nama berpola' };
    const member = (m) => {
      const s = String(m);
      const i = s.indexOf(':');
      return i < 0 ? { platform: 'instagram', username: s } : { platform: s.slice(0, i), username: s.slice(i + 1) };
    };
    clustersHost.innerHTML = strong.length
      ? strong.map((c, ci) => `
        <div class="cluster-card"><strong>Klaster ${ci + 1} · ${c.size} akun<span class="strength">bukti kuat</span></strong>
          <div class="cluster-meta">${(c.reasons || []).map((r) => REASON_LABELS[r] || r).join(' · ')}</div>
          <div class="cluster-members">${(c.members || []).map((m) => { const mm = member(m); return `<button class="cluster-chip" data-platform="${mm.platform}" data-username="${mm.username}">@${mm.username}</button>`; }).join('')}</div>
        </div>`).join('')
      : '<div class="empty"><b>Belum ada klaster kuat</b><span>Klaster muncul setelah cukup banyak kunjungan profil.</span></div>';
    clustersHost.querySelectorAll('.cluster-chip').forEach((chip) => {
      chip.addEventListener('click', () => openAccount(chip.dataset.username, chip.dataset.platform));
    });
  }
}

// ── Kuadran Followers × Reach (scatter) ─────────────────────────
const LEVEL_SCATTER_COLOR = {
  pola_kembar: 'var(--err)',
  pola_ternak: 'var(--warn)',
  amati: 'var(--amati)',
  bersih: 'var(--ok-dot)',
};
const LEVEL_SCATTER_LABEL = {
  pola_kembar: 'Pola kembar',
  pola_ternak: 'Pola ternak',
  amati: 'Amati',
  bersih: 'Bersih',
};

function reachOf(a) {
  if (a.metrics && a.metrics.view_reach_pct !== null && a.metrics.view_reach_pct !== undefined) return a.metrics.view_reach_pct;
  if (a.metrics && a.metrics.like_reach_pct !== null && a.metrics.like_reach_pct !== undefined) return a.metrics.like_reach_pct;
  return null;
}

function niceReachMax(v) {
  if (v <= 10) return 10;
  if (v <= 20) return 20;
  if (v <= 30) return 30;
  if (v <= 50) return 50;
  return 100;
}

/**
 * Titik = akun dengan followers & reach diketahui. Sumbu X = followers (log),
 * sumbu Y = reach %. Garis putus-putus = median (empat kuadran berlabel).
 */
export function renderScatter() {
  const host = $('#scatter-host');
  const sub = $('#scatter-sub');
  if (!host) return;
  const items = (state.intel?.items || []).filter((a) => a.followers > 0 && reachOf(a) !== null);

  if (!items.length) {
    host.innerHTML = emptyState('Belum ada titik', 'Kuadran muncul setelah worker mengunjungi profil dan mengisi followers + reach.');
    if (sub) sub.textContent = 'Belum ada data untuk dipetakan';
    return;
  }
  if (sub) sub.textContent = `${fmt(items.length)} akun terpetakan · sumbu X = followers (skala log) · Y = reach %`;

  const W = 720, H = 380, L = 54, R = 20, T = 18, B = 44;
  const plotW = W - L - R, plotH = H - T - B;
  const yBottom = H - B, yTop = T;

  const followers = items.map((a) => a.followers);
  const fmin = Math.min(...followers), fmax = Math.max(...followers);
  const lmin = Math.log10(fmin), lmax = Math.log10(fmax);
  const lspan = (lmax - lmin) || 0.6;
  const reaches = items.map(reachOf);
  const reachMax = niceReachMax(Math.max(...reaches, 4));

  const x = (f) => L + ((Math.log10(f) - lmin) / lspan) * plotW;
  const y = (r) => yBottom - (Math.min(r, reachMax) / reachMax) * plotH;

  // median (garis kuadran)
  const sortedF = [...followers].sort((a, b) => a - b);
  const sortedR = [...reaches].sort((a, b) => a - b);
  const med = (arr) => arr[Math.floor(arr.length / 2)];
  const medF = med(sortedF), medR = med(sortedR);
  const medianX = Math.min(W - R, Math.max(L, (Math.log10(medF) - lmin) / lspan * plotW + L));
  const medianY = y(medR);

  // — titik —
  const dots = items.map((a) => {
    const cx = Math.min(W - R, Math.max(L, x(a.followers)));
    const cy = Math.min(yBottom, Math.max(yTop, y(reachOf(a))));
    const color = LEVEL_SCATTER_COLOR[a.level] || 'var(--ink-3)';
    return `<g class="scatter-dot" data-platform="${esc(a.platform)}" data-username="${esc(a.username)}" tabindex="0" role="button" aria-label="Buka detail @${esc(a.username)}">
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.6" fill="${color}" stroke="var(--surface)" stroke-width="1.6" fill-opacity="0.88"/>
    </g>`;
  }).join('');

  // — ticks x (skala log, label ramah) —
  const xSteps = [1e2, 3e2, 1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6, 3e6, 1e7].filter((v) => v >= fmin * 0.8 && v <= fmax * 1.2);
  const xTicks = xSteps.map((v) => {
    const cx = Math.min(W - R, Math.max(L, x(v)));
    return `<line class="scatter-grid" x1="${cx}" y1="${yTop}" x2="${cx}" y2="${yBottom}"/>` +
      `<text class="scatter-label" x="${cx}" y="${H - 26}" text-anchor="middle">${esc(fmtCompact(v))}</text>`;
  }).join('');
  const yTicks = [0, reachMax / 2, reachMax].map((v) => {
    const cy = y(v);
    return `<line class="scatter-grid" x1="${L}" y1="${cy}" x2="${W - R}" y2="${cy}"/>` +
      `<text class="scatter-label" x="${L - 8}" y="${cy + 3}" text-anchor="end">${esc(fmtPct(v, 0))}</text>`;
  }).join('');

  // — garis kuadran (median) —
  const guides = `<line class="scatter-qline" x1="${medianX}" y1="${yTop}" x2="${medianX}" y2="${yBottom}"/>` +
    `<line class="scatter-qline" x1="${L}" y1="${medianY}" x2="${W - R}" y2="${medianY}"/>`;

  // — label kuadran —
  const corners = [
    { x: L + 8, y: yTop + 14, anchor: 'start', text: 'Efisien' },
    { x: W - R - 8, y: yTop + 14, anchor: 'end', text: 'Berpengaruh' },
    { x: L + 8, y: yBottom - 8, anchor: 'start', text: 'Kecil' },
    { x: W - R - 8, y: yBottom - 8, anchor: 'end', text: 'Jangkauan rendah' },
  ].map((c) => `<text class="scatter-qlabel" x="${c.x}" y="${c.y}" text-anchor="${c.anchor}">${esc(c.text)}</text>`).join('');

  host.innerHTML = `
    <div class="scatter-wrap" id="scatter-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kuadran followers terhadap reach">
        <line class="scatter-axis" x1="${L}" y1="${yBottom}" x2="${W - R}" y2="${yBottom}"/>
        <line class="scatter-axis" x1="${L}" y1="${yBottom}" x2="${L}" y2="${yTop}"/>
        ${xTicks}${yTicks}${guides}${corners}${dots}
      </svg>
      <div class="scatter-tip" id="scatter-tip" hidden role="tooltip"></div>
    </div>
    <div class="scatter-legend" id="scatter-legend">${Object.keys(LEVEL_SCATTER_COLOR).map((k) =>
      `<span><i style="background:${LEVEL_SCATTER_COLOR[k]}"></i>${esc(LEVEL_SCATTER_LABEL[k])}</span>`).join('')}</div>`;

  wireScatter(host, items);
}

function wireScatter(host, items) {
  const wrap = $('#scatter-wrap');
  const tip = $('#scatter-tip');
  if (!wrap || !tip) return;
  const byKey = {};
  items.forEach((a) => { byKey[`${a.platform}:${a.username}`] = a; });

  const showTip = (g, cx, cy, account) => {
    tip.hidden = false;
    tip.innerHTML = `<b>@${esc(account.username)}</b><br>${esc(LEVEL_SCATTER_LABEL[account.level] || account.level)} · skor ${fmt(account.score)}<br>${fmtCompact(account.followers)} followers · reach ${fmtPct(reachOf(account))}`;
    const rect = wrap.getBoundingClientRect();
    const px = rect.left + (cx / 720) * rect.width;
    const py = rect.top + (cy / 380) * rect.height;
    const left = Math.min(rect.width - 240, Math.max(8, px - rect.left + 14));
    const top = Math.max(8, py - rect.top + 14);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };
  const hide = () => { tip.hidden = true; };

  host.querySelectorAll('.scatter-dot').forEach((g) => {
    const account = byKey[`${g.dataset.platform}:${g.dataset.username}`];
    const circle = g.querySelector('circle');
    const cx = Number(circle.getAttribute('cx'));
    const cy = Number(circle.getAttribute('cy'));
    g.addEventListener('mouseenter', () => showTip(g, cx, cy, account));
    g.addEventListener('mousemove', () => showTip(g, cx, cy, account));
    g.addEventListener('mouseleave', hide);
    g.addEventListener('click', () => openAccount(g.dataset.username, g.dataset.platform));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccount(g.dataset.username, g.dataset.platform); } });
  });
}
