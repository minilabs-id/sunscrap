/**
 * sunscrap v2 — Akun (tabel profil + mode "Perlu tinjauan")
 */
import { $, $$, debounce, toast } from './dom.js';
import {
  api, esc, fmt, fmtPct,
  pageLabel, nextOffset, prevOffset,
  reviewKey, reviewMeta, isNeedsReview, riskScorePct, emptyState,
} from './helpers.js';
import { state } from './state.js';
import { refreshAccountIntel, renderRiskPanels } from './intel.js';
import { avatarHtml, wireAvatarErrors, openAccount, showScoreHelp } from './account-detail.js';

export function reviewBadgeHtml(platform, username) {
  const rec = state.reviews[reviewKey(platform, username)];
  if (!rec) return '';
  const m = reviewMeta(rec.decision);
  return m ? `<span class="pill ${m.tone}" title="${esc(rec.note || m.label)}">${esc(m.label)}</span>` : '';
}

function renderAccountsTable(items) {
  $('#accounts-table').innerHTML = `
    <thead><tr>
      <th scope="col">Akun</th>
      <th scope="col">Level</th>
      <th scope="col" class="num">Skor</th>
      <th scope="col" class="num">Followers</th>
      <th scope="col">Reach</th>
      <th scope="col" class="num">Post</th>
      <th scope="col" class="num">Bln</th>
      <th scope="col">Indikasi</th>
    </tr></thead>
    <tbody>${items.map((a) => `
      <tr class="clickable" data-account="${esc(a.username)}" data-platform="${esc(a.platform)}" tabindex="0" role="button" aria-label="Buka detail ${esc(a.username)}">
        <td><div class="acct-cell">${avatarHtml(a.avatar_url, a.username)}<span style="min-width:0"><b>@${esc(a.username)}</b> ${reviewBadgeHtml(a.platform, a.username)}<br><span class="muted">${esc((a.display_name || '').slice(0, 42))}</span></span></div></td>
        <td><span class="lv-${esc(a.level)}">${esc(a.level.replace(/_/g, ' '))}</span></td>
        <td class="num"><span class="score-track" style="width:72px;display:inline-block;vertical-align:middle;margin-right:8px"><i style="width:${riskScorePct(a.score)}%"></i></span><b>${fmt(a.score)}</b></td>
        <td class="num">${fmt(a.followers)}</td>
        <td><span class="score-track" style="width:72px;display:inline-block" title="${a.metrics && a.metrics.view_reach_pct !== null ? fmtPct(a.metrics.view_reach_pct) : '—'}"><i style="width:${Math.min(100, a.metrics && a.metrics.view_reach_pct !== null ? a.metrics.view_reach_pct : (a.metrics && a.metrics.like_reach_pct !== null ? a.metrics.like_reach_pct : 0))}%;background:var(--accent)"></i></span></td>
        <td class="num">${fmt(a.metrics?.posts_seen)}</td>
        <td class="num">${fmt(a.months_seen)}</td>
        <td class="cell-clip">${esc((a.flags || []).map((f) => f.label).join(' · ') || '—')}</td>
      </tr>`).join('') || `<tr><td colspan="8">${emptyState('Belum ada akun', 'Jalankan worker untuk mengisi data akun.')}</td></tr>`}</tbody>`;
  $$('#accounts-table tr[data-account]').forEach((row) => {
    row.addEventListener('click', () => openAccount(row.dataset.account, row.dataset.platform));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccount(row.dataset.account, row.dataset.platform); } });
  });
  wireAvatarErrors($('#accounts-table'));
}

export async function loadReviews() {
  try { state.reviews = await api.reviewList() || {}; }
  catch (e) { console.error('loadReviews gagal:', e); state.reviews = {}; }
}

export async function loadAccounts() {
  const reviewOnly = state.accounts.reviewOnly;
  const prevBtn = $('#accounts-prev');
  const nextBtn = $('#accounts-next');

  if (reviewOnly) {
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

/** Muat tabel + panel risiko + intel badge (dipanggil saat tab Akun aktif / data berubah). */
export async function refreshAccountsView() {
  await loadAccounts();
  await refreshAccountIntel(true);
  renderRiskPanels();
}

/** Mode triase: hanya akun terindikasi yang belum dijawab. */
export function setReviewOnly(on) {
  state.accounts.reviewOnly = !!on;
  const chip = $('#account-review-only');
  if (chip) chip.setAttribute('aria-pressed', String(state.accounts.reviewOnly));
  ['#account-q', '#account-level', '#account-band', '#account-platform'].forEach((s) => {
    const el = $(s); if (el) el.disabled = state.accounts.reviewOnly;
  });
  state.accounts.offset = 0;
  loadAccounts();
}

export function bindAccountEvents() {
  const resetAccounts = () => { state.accounts.offset = 0; loadAccounts(); };
  $('#account-q').addEventListener('input', debounce(resetAccounts, 300));
  ['#account-level', '#account-band', '#account-platform'].forEach((s) => $(s).addEventListener('change', resetAccounts));
  $('#account-review-only').addEventListener('click', () => setReviewOnly(!state.accounts.reviewOnly));
  $('#accounts-prev').addEventListener('click', () => { if (state.accounts.reviewOnly) return; state.accounts.offset = prevOffset(state.accounts.offset, state.accounts.limit); loadAccounts(); });
  $('#accounts-next').addEventListener('click', () => { if (state.accounts.reviewOnly) return; state.accounts.offset = nextOffset(state.accounts.offset, state.accounts.limit, state.accounts.total); loadAccounts(); });
  $('#score-help-btn').addEventListener('click', showScoreHelp);
}

// Re-render saat data global berubah (event dari main.js)
document.addEventListener('sunscrap:data-changed', () => {
  if (state.tab === 'accounts') refreshAccountsView();
});
