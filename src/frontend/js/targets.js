/**
 * sunscrap v2 — Target (tabel post/task)
 * Filter status/masalah/platform/tema + sorting + seleksi + pager.
 */
import { $, $$, debounce, toast, openModal, modalShell } from './dom.js';
import {
  api, esc, fmt, fmtPct, fmtWhen, relTime, shortUrl,
  deltaBadge, toggleSort, pageLabel, nextOffset, prevOffset, emptyState,
} from './helpers.js';
import { state } from './state.js';
import { setNavTargetCount } from './chrome.js';

export function statusBadge(status) {
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
      <th scope="col" class="w-36"><input type="checkbox" id="targets-checkall" aria-label="Pilih semua"></th>
      <th scope="col">Pl.</th>
      <th scope="col">Akun</th>
      <th scope="col">Tema</th>
      <th scope="col" class="num th-sort" data-sort="followers">Fol.</th>
      <th scope="col" class="num th-sort" data-sort="likes">Likes</th>
      <th scope="col" class="num th-sort" data-sort="delta_likes" title="Delta likes vs snapshot sebelumnya">Δ L</th>
      <th scope="col" class="num th-sort" data-sort="views">Views</th>
      <th scope="col" class="num th-sort" data-sort="delta_views" title="Delta views vs snapshot sebelumnya">Δ V</th>
      <th scope="col" class="num th-sort" data-sort="er" title="Engagement rate">ER</th>
      <th scope="col" class="th-sort" data-sort="recent">Di-scrape</th>
      <th scope="col">Status</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="12">${emptyState('Tidak ada target', 'Tidak ada target yang cocok dengan filter ini.')}</td></tr>`}</tbody>`;

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
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTarget(Number(row.dataset.target)); }
    });
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

export async function loadTargets() {
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
  } catch {
    toast('Gagal memuat target.', 'error');
  }
  state.targets.items = res.items || [];
  state.targets.total = res.total || 0;
  $('#targets-total').textContent = `${fmt(res.total)} target`;
  setNavTargetCount(res.total);
  $('#targets-page').textContent = pageLabel(state.targets.offset, state.targets.limit, res.total);
  renderTargetsTable(state.targets.items);
}

export function syncTargetChips() {
  $$('.filter-chip[data-status]').forEach((c) => c.setAttribute('aria-pressed', String((c.dataset.status || '') === (state.targets.status || ''))));
  $$('.filter-chip[data-issue]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.issue === state.targets.issue)));
}

/** Deterministik: null → semua; string → status tersebut. Toggle ditangani pemanggil. */
export function applyStatusFilter(key, { activate = true } = {}) {
  state.targets.status = key || '';
  state.targets.issue = '';
  state.targets.offset = 0;
  state.targets.selected.clear();
  updateRetrySelected();
  syncTargetChips();
  if (state.tab === 'targets') { loadTargets(); return; }
  if (activate) activateTabSafe('targets');
}

// activateTab disuntik oleh main.js untuk menghindari dependensi melingkar.
let activateTabSafe = (name) => { state.tab = name; loadTargets(); };
export function registerActivateTab(fn) { activateTabSafe = fn; }

export function updateRetrySelected() {
  const btn = $('#btn-retry-selected');
  if (!btn) return;
  btn.disabled = state.targets.selected.size === 0;
  btn.textContent = state.targets.selected.size ? `Ulangi terpilih (${state.targets.selected.size})` : 'Ulangi terpilih';
}

export function openTarget(targetId) {
  api.getTargetHistory(targetId).then((snapshots) => {
    const rows = (snapshots || []).map((s) => `<tr><td>${esc(fmtWhen(s.scraped_at))}</td><td>${statusBadge(s.status)}</td><td class="num">${fmt(s.follower_count)}</td><td class="num">${fmt(s.likes)}</td><td class="num">${fmt(s.comments)}</td><td class="num">${fmt(s.views)}</td><td class="wrap">${esc(s.error_message || '')}</td></tr>`).join('');
    openModal(modalShell({
      title: 'Riwayat target',
      body: `<div class="table-wrap flush tall"><table class="table"><thead><tr><th scope="col">Waktu</th><th scope="col">Status</th><th scope="col" class="num">Fol.</th><th scope="col" class="num">Likes</th><th scope="col" class="num">Komen</th><th scope="col" class="num">Views</th><th scope="col">Error</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Belum ada snapshot.</td></tr>'}</tbody></table></div>`,
      foot: `<button class="btn btn-ghost" data-close>Tutup</button>`,
    }));
  }).catch(() => toast('Gagal memuat riwayat target.', 'error'));
}

/** Ikat event toolbar + pager + sort header. Dipanggil sekali saat init. */
export function bindTargetEvents() {
  const resetTargets = () => { state.targets.offset = 0; state.targets.selected.clear(); updateRetrySelected(); loadTargets(); };
  $('#target-q').addEventListener('input', debounce(resetTargets, 300));
  $('#target-platform').addEventListener('change', resetTargets);
  $$('.filter-chip[data-status]').forEach((chip) => chip.addEventListener('click', () => {
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    state.targets.status = pressed ? '' : (chip.dataset.status || '');
    state.targets.issue = '';
    state.targets.offset = 0;
    state.targets.selected.clear();
    syncTargetChips();
    updateRetrySelected();
    loadTargets();
  }));
  $$('.filter-chip[data-issue]').forEach((chip) => chip.addEventListener('click', () => {
    const active = chip.getAttribute('aria-pressed') === 'true';
    state.targets.issue = active ? '' : chip.dataset.issue;
    state.targets.status = '';
    state.targets.offset = 0;
    state.targets.selected.clear();
    syncTargetChips();
    updateRetrySelected();
    loadTargets();
  }));
  $('#targets-table').addEventListener('click', (e) => {
    const th = e.target.closest('.th-sort');
    if (!th) return;
    const s = toggleSort(state.targets.sort, state.targets.dir, th.dataset.sort);
    state.targets.sort = s.sort;
    state.targets.dir = s.dir;
    loadTargets();
  });
  $('#targets-prev').addEventListener('click', () => { state.targets.offset = prevOffset(state.targets.offset, state.targets.limit); loadTargets(); });
  $('#targets-next').addEventListener('click', () => { state.targets.offset = nextOffset(state.targets.offset, state.targets.limit, state.targets.total); loadTargets(); });

  $('#btn-retry-failed').addEventListener('click', async () => {
    if (!state.auditId) { toast('Pilih audit dulu (di atas).'); return; }
    try {
      const r = await api.retryFailed(state.auditId);
      toast((r && r.error) || (r && r.message) || `Dijadwalkan ulang ${fmt(r && r.created)} target.`, r && r.error ? 'error' : 'ok');
      loadTargets();
    } catch { toast('Gagal menjadwalkan ulang.', 'error'); }
  });
  $('#btn-retry-selected').addEventListener('click', async () => {
    if (!state.targets.selected.size) return;
    if (!state.auditId) { toast('Pilih audit dulu (di atas).'); return; }
    try {
      const r = await api.retryTargets(state.auditId, Array.from(state.targets.selected));
      toast((r && r.error) || (r && r.message) || `Dijadwalkan ulang ${fmt(r && r.created)} target.`, r && r.error ? 'error' : 'ok');
      state.targets.selected.clear();
      updateRetrySelected();
      loadTargets();
    } catch { toast('Gagal menjadwalkan ulang target terpilih.', 'error'); }
  });
}
