/**
 * sunscrap v2 — command palette (Ctrl+K)
 * Aksi cepat + pencarian global (akun / link / tema). Keyboard penuh:
 * ↑↓ pilih · Enter jalankan · Esc tutup.
 */
import { $, toast } from './dom.js';
import { api, esc, fmt, fmtCompact } from './helpers.js';
import { state } from './state.js';
import { openNewAudit, openExport } from './actions.js';
import { applyTheme } from './theme.js';

let searchTimer = null;

export function hideSearchPop() {
  const pop = $('#search-pop');
  if (pop) { pop.hidden = true; pop.innerHTML = ''; }
}

function commandActions() {
  const w = state.worker;
  return [
    { id: 'import', label: 'Import data', hint: 'Ctrl+I', run: () => openNewAudit() },
    { id: 'export', label: 'Export data', hint: 'Ctrl+E', run: () => openExport() },
    { id: 'worker', label: (w && w.active) ? 'Hentikan worker' : 'Mulai worker', hint: '', run: () => document.dispatchEvent(new CustomEvent('sunscrap:toggle-worker')) },
    { id: 'tab:dashboard', label: 'Buka Ringkasan', hint: 'Ctrl+1', run: () => document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'dashboard' })) },
    { id: 'tab:targets', label: 'Buka Postingan', hint: 'Ctrl+2', run: () => document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'targets' })) },
    { id: 'tab:accounts', label: 'Buka Akun', hint: 'Ctrl+3', run: () => document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'accounts' })) },
    { id: 'tab:proses', label: 'Buka Proses', hint: 'Ctrl+4', run: () => document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'proses' })) },
    { id: 'tab:settings', label: 'Buka Pengaturan', hint: 'Ctrl+6', run: () => document.dispatchEvent(new CustomEvent('sunscrap:activate-tab', { detail: 'settings' })) },
    { id: 'backup', label: 'Cadangkan database', hint: 'Ctrl+Shift+B', run: () => document.dispatchEvent(new CustomEvent('sunscrap:backup')) },
    { id: 'theme', label: 'Ganti tema (terang/gelap)', hint: '', run: () => applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark') },
  ];
}

function commandItemsHtml(needle) {
  const need = String(needle || '').toLowerCase().trim();
  let list = commandActions();
  if (need.length >= 2) list = list.filter((a) => a.label.toLowerCase().includes(need));
  return list.slice(0, 7).map((a) =>
    `<div class="search-item" data-action="${esc(a.id)}" role="option"><span class="search-main">${esc(a.label)}</span><span class="end">${esc(a.hint || '')}</span></div>`).join('');
}

/** Tandai satu .search-item aktif; kelola indeks keyboard. */
function setActiveItem(pop, index) {
  const items = Array.from(pop.querySelectorAll('.search-item'));
  if (!items.length) return -1;
  const clamped = ((index % items.length) + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle('is-active', i === clamped));
  items[clamped].scrollIntoView({ block: 'nearest' });
  return clamped;
}

export function bindGlobalSearch() {
  const input = $('#global-search');
  const pop = $('#search-pop');
  if (!input || !pop) return;

  let activeIndex = -1;

  const render = async (query) => {
    pop.hidden = false;
    const needle = String(query || '').trim();
    const actionsHtml = commandItemsHtml(needle);

    if (needle.length < 2) {
      pop.innerHTML = (actionsHtml ? `<div class="search-group">Aksi</div>${actionsHtml}` : '') +
        `<div class="muted search-pad">Ketik 2+ karakter untuk mencari akun / link / tema…</div>`;
      activeIndex = -1;
      return;
    }

    const seq = ++state.searchSeq;
    let res = null;
    try { res = await api.search(needle); } catch { res = null; }
    if (seq !== state.searchSeq) return;
    if (!res) { pop.innerHTML = '<div class="muted search-pad">Pencarian gagal.</div>'; activeIndex = -1; return; }
    const group = (title, items) => (items && items.length ? `<div class="search-group">${title}</div>` + items : '');
    const targets = (res.targets || []).slice(0, 6).map((t) =>
      `<div class="search-item" data-kind="target" data-id="${t.target_id}" role="option"><span class="badge ${t.platform === 'instagram' ? 'ig' : 'tk'}">${t.platform === 'instagram' ? 'IG' : 'TK'}</span><span class="search-main">@${esc(t.username || '—')}</span><span class="end">${esc(t.audit_name || '')}</span></div>`).join('');
    const accounts = (res.accounts || []).slice(0, 6).map((a) =>
      `<div class="search-item" data-kind="account" data-platform="${esc(a.platform)}" data-username="${esc(a.username)}" role="option"><span class="badge ${a.platform === 'instagram' ? 'ig' : 'tk'}">${a.platform === 'instagram' ? 'IG' : 'TK'}</span><span class="search-main">@${esc(a.username)}</span><span class="end">${fmt(a.follower_count)} fol.</span></div>`).join('');
    const posts = (res.posts || []).slice(0, 6).map((p) =>
      `<div class="search-item" data-kind="post" data-url="${esc(p.post_url || '')}" role="option"><span class="badge ${p.platform === 'instagram' ? 'ig' : 'tk'}">${p.platform === 'instagram' ? 'IG' : 'TK'}</span><span class="search-main">${esc((p.caption || p.post_url || '(tanpa caption)').slice(0, 56))}</span><span class="end">${fmtCompact(p.views)} views</span></div>`).join('');
    const dataHtml = group('Postingan', targets) + group('Akun', accounts) + group('Post', posts);
    const actionsGroup = actionsHtml ? group('Aksi', actionsHtml) : '';
    pop.innerHTML = actionsGroup + dataHtml || `<div class="muted search-pad">Tidak ada hasil untuk “${esc(needle)}”.</div>`;
    activeIndex = -1;
  };

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => render(input.value), 200);
  });
  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; hideSearchPop(); input.blur(); return; }
    if (e.key === 'Enter') {
      const items = Array.from(pop.querySelectorAll('.search-item'));
      if (activeIndex >= 0 && items[activeIndex]) { e.preventDefault(); items[activeIndex].click(); return; }
      clearTimeout(searchTimer);
      render(input.value);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      activeIndex = setActiveItem(pop, activeIndex + delta);
    }
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
    if (item.dataset.kind === 'target') {
      // Riwayat target via modal — reuse dari targets.js lewat event
      document.dispatchEvent(new CustomEvent('sunscrap:open-target', { detail: Number(item.dataset.id) }));
    } else if (item.dataset.kind === 'account') {
      document.dispatchEvent(new CustomEvent('sunscrap:open-account', { detail: { username: item.dataset.username, platform: item.dataset.platform } }));
    } else if (item.dataset.kind === 'post' && item.dataset.url) {
      window.sunscrap.openExternal(item.dataset.url);
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target === input) return;
    if (!e.target.closest('#search-pop')) hideSearchPop();
  });
}
