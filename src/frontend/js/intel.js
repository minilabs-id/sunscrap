/**
 * sunscrap v2 — intel akun (singleton cache)
 * Satu fetch `getAccounts({sort:'risk'})` per siklus; dipakai sidebar badge,
 * kartu "Perlu tinjauan", dan panel risiko di tab Akun.
 */
import { $ } from './dom.js';
import { api, fmt, reviewedDecisionCounts } from './helpers.js';
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

/** Render panel "Distribusi risiko" + "Klaster utama" di tab Akun. */
export function renderRiskPanels() {
  const intel = state.intel;
  if (!intel) return;
  const byLevel = intel.levels || {};

  const levels = [
    { key: 'pola_kembar', label: 'Pola kembar', color: 'var(--err)' },
    { key: 'pola_ternak', label: 'Pola ternak', color: 'var(--warn)' },
    { key: 'amati', label: 'Amati', color: '#eab308' },
    { key: 'bersih', label: 'Bersih', color: 'var(--ok-dot)' },
  ];
  const max = Math.max(...levels.map((l) => byLevel[l.key] || 0), 1);
  const barsHost = $('#risk-bars');
  if (barsHost) {
    barsHost.innerHTML = levels.map((l) => `
      <div class="intel-row"><span class="intel-lbl">${l.label}</span>
        <div class="intel-track"><i style="width:${Math.round(((byLevel[l.key] || 0) / max) * 100)}%;background:${l.color}"></i></div>
        <span class="num" style="width:44px;text-align:right">${fmt(byLevel[l.key] || 0)}</span>
      </div>`).join('');
  }

  const clustersHost = $('#clusters-list');
  if (clustersHost) {
    const strong = (intel.clusters || []).filter((c) => c.strong).slice(0, 4);
    const REASON_LABELS = { konten: 'Konten sama', kontak: 'Kontak bio sama', template: 'Caption seragam', serentak: 'Unggah serentak' };
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
