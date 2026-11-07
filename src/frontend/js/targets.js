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

// ── Kolom tabel Target (satu sumber kebenaran header + sel) ──
const TARGET_COLUMNS = [
  { key: 'pl', label: 'Platform', th: 'Pl.', thClass: '', cell: (r) => `<td><span class="badge ${r.platform === 'instagram' ? 'ig' : 'tk'}">${r.platform === 'instagram' ? 'IG' : 'TK'}</span></td>` },
  { key: 'akun', label: 'Akun', th: 'Akun', thClass: '', cell: (r) => `<td class="wrap" title="${esc(r.url)}">@${esc(r.username || '—')}</td>` },
  { key: 'tema', label: 'Tema', th: 'Tema', thClass: '', cell: (r) => { const t = r.tema || shortUrl(r.url); return `<td class="wrap cell-clip" title="${esc(t)}">${esc(t)}</td>`; } },
  { key: 'followers', label: 'Followers', th: 'Fol.', thClass: 'num th-sort', sort: 'followers', cell: (r) => `<td class="num">${fmt(r.follower_count)}</td>` },
  { key: 'likes', label: 'Likes', th: 'Likes', thClass: 'num th-sort', sort: 'likes', cell: (r) => `<td class="num"><b>${fmt(r.likes)}</b></td>` },
  { key: 'delta_likes', label: 'Delta likes', th: 'Δ L', thClass: 'num th-sort', sort: 'delta_likes', title: 'Delta likes vs snapshot sebelumnya', cell: (r) => `<td class="num">${deltaBadge(r.delta_likes)}</td>` },
  { key: 'views', label: 'Views', th: 'Views', thClass: 'num th-sort', sort: 'views', cell: (r) => `<td class="num">${fmt(r.views)}</td>` },
  { key: 'delta_views', label: 'Delta views', th: 'Δ V', thClass: 'num th-sort', sort: 'delta_views', title: 'Delta views vs snapshot sebelumnya', cell: (r) => `<td class="num">${deltaBadge(r.delta_views)}</td>` },
  { key: 'er', label: 'Engagement rate', th: 'ER', thClass: 'num th-sort', sort: 'er', title: 'Engagement rate', cell: (r) => `<td class="num">${r.engagement_rate !== null && r.engagement_rate !== undefined ? fmtPct(r.engagement_rate) : '—'}</td>` },
  { key: 'recent', label: 'Terakhir di-scrape', th: 'Di-scrape', thClass: 'th-sort', sort: 'recent', cell: (r) => `<td class="muted" title="${esc(fmtWhen(r.snapshot_at))}">${esc(relTime(r.snapshot_at))}</td>` },
  { key: 'status', label: 'Status', th: 'Status', thClass: '', cell: (r) => `<td>${statusBadge(r.status)}</td>` },
];
const ALL_COL_KEYS = TARGET_COLUMNS.map((c) => c.key);
const COLS_STORAGE = 'sa_target_cols';
let visibleCols = null;

function loadVisibleCols() {
  if (Array.isArray(visibleCols)) return visibleCols;
  try {
    const raw = localStorage.getItem(COLS_STORAGE);
    if (raw) {
      const keys = JSON.parse(raw).filter((k) => ALL_COL_KEYS.includes(k));
      if (keys.length) { visibleCols = keys; return visibleCols; }
    }
  } catch { /* abaikan */ }
  visibleCols = [...ALL_COL_KEYS];
  return visibleCols;
}
function persistVisibleCols() { try { localStorage.setItem(COLS_STORAGE, JSON.stringify(visibleCols)); } catch { /* abaikan */ } }
function visibleColumns() { const set = new Set(loadVisibleCols()); return TARGET_COLUMNS.filter((c) => set.has(c.key)); }

function renderTargetsTable(items) {
  const cols = visibleColumns();
  const rows = items.map((r) => {
    const checked = state.targets.selected.has(r.target_id);
    const tema = r.tema || shortUrl(r.url);
    return `<tr data-target="${r.target_id}" class="clickable" tabindex="0" role="button" aria-label="Buka riwayat ${esc(tema)}">
      <td><input type="checkbox" class="sel" data-id="${r.target_id}" aria-label="Pilih target ${esc(tema)}" ${checked ? 'checked' : ''}></td>
      ${cols.map((c) => c.cell(r)).join('')}
    </tr>`;
  }).join('');

  $('#targets-table').innerHTML = `
    <thead><tr>
      <th scope="col" class="w-36"><input type="checkbox" id="targets-checkall" aria-label="Pilih semua"></th>
      ${cols.map((c) => `<th scope="col" class="${c.thClass}"${c.sort ? ` data-sort="${c.sort}"` : ''}${c.title ? ` title="${c.title}"` : ''}>${c.th}</th>`).join('')}
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="${cols.length + 1}">${emptyState('Tidak ada target', 'Tidak ada target yang cocok dengan filter ini.')}</td></tr>`}</tbody>`;

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

// ── Pilih kolom (popover) ──────────────────────────────────────
function openColumnsPop() {
  const btn = $('#btn-columns');
  const pop = $('#columns-pop');
  if (!btn || !pop) return;
  if (btn.getAttribute('aria-expanded') === 'true') { closeColumnsPop(); return; }
  btn.setAttribute('aria-expanded', 'true');
  const keys = new Set(loadVisibleCols());
  pop.innerHTML = `
    <div class="menu-head">Pilih kolom</div>
    ${TARGET_COLUMNS.map((c) => `<label><input type="checkbox" data-col="${c.key}" ${keys.has(c.key) ? 'checked' : ''}>${esc(c.label)}</label>`).join('')}
    <div class="menu-foot"><button class="linklike" id="cols-reset" type="button">Reset</button></div>`;
  pop.hidden = false;
  const rect = btn.getBoundingClientRect();
  let left = rect.right - 224;
  if (left < 8) left = rect.left;
  let top = rect.bottom + 6;
  const popH = Math.min(420, pop.scrollHeight);
  if (top + popH > window.innerHeight - 8) top = Math.max(8, rect.top - popH - 6);
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  const reset = $('#cols-reset');
  if (reset) reset.addEventListener('click', () => { visibleCols = [...ALL_COL_KEYS]; persistVisibleCols(); renderTargetsTable(state.targets.items); closeColumnsPop(); });
}

function closeColumnsPop() {
  const pop = $('#columns-pop');
  const btn = $('#btn-columns');
  if (pop) pop.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
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

  // ── pemilih kolom ──
  $('#btn-columns').addEventListener('click', openColumnsPop);
  $('#columns-pop').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-col]');
    if (!cb) return;
    const set = new Set(loadVisibleCols());
    if (cb.checked) set.add(cb.dataset.col); else set.delete(cb.dataset.col);
    if (set.size === 0) { set.add('status'); toast('Minimal satu kolom wajib tampil.', 'warning'); }
    visibleCols = Array.from(set);
    persistVisibleCols();
    renderTargetsTable(state.targets.items);
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#columns-pop') || e.target.closest('#btn-columns')) return;
    closeColumnsPop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeColumnsPop(); });

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
