/**
 * sunscrap v2 — chrome (jendela aplikasi)
 * Titlebar context, navigasi sidebar, statusbar audit, daftar audit global.
 */
import { $, $$ } from './dom.js';
import { api, esc } from './helpers.js';
import { state } from './state.js';
import { renderAudits } from './settings.js';
import { renderStatusBarAudit } from './worker.js';

const TAB_LABELS = { dashboard: 'Ringkasan', targets: 'Postingan', accounts: 'Akun', proses: 'Proses', browser: 'Sesi', settings: 'Pengaturan' };

/** Satu-satunya penulis badge jumlah Target di sidebar. */
export function setNavTargetCount(total) {
  const badge = $('#nav-targets-count');
  if (!badge) return;
  const n = Number(total) || 0;
  badge.hidden = n <= 0;
  badge.textContent = n > 999 ? '999+' : String(n);
}

let tabListener = null;
/** Daftarkan satu listener tunggal untuk muat ulang data per-tab. */
export function onTabActivated(fn) { tabListener = fn; }

export function updateTitlebarContext() {
  const tab = TAB_LABELS[state.tab] || 'Ringkasan';
  const audit = (state.audits || []).find((a) => a.id === state.auditId);
  const context = audit && state.tab !== 'browser' && state.tab !== 'settings' ? `${tab} · ${audit.name}` : tab;
  document.title = `${context} — sunscrap`;
}

export function activateTab(name) {
  if (!TAB_LABELS[name]) name = 'dashboard';
  state.tab = name;
  $$('.nav-link').forEach((l) => {
    const active = l.dataset.tab === name;
    l.classList.toggle('active', active);
    if (active) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current');
  });
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  updateTitlebarContext();
  if (tabListener) tabListener(name);
}

export function bindNav() {
  $$('.nav-link').forEach((link) => link.addEventListener('click', () => activateTab(link.dataset.tab)));
  $$('.sb-item[data-tab]').forEach((el) => el.addEventListener('click', () => activateTab(el.dataset.tab)));
}

/** Muat daftar audit → sinkronkan picker global + judul + tabel pengaturan. */
export async function loadAudits() {
  let audits = null;
  try { audits = await api.getAudits(); } catch (e) { console.error('getAudits gagal:', e); return; }
  state.audits = audits || [];
  if (state.auditId && !state.audits.some((a) => a.id === state.auditId)) state.auditId = null;
  syncAuditPicker();
  const retryFailedBtn = $('#btn-retry-failed');
  if (retryFailedBtn) retryFailedBtn.disabled = !state.auditId;
  if (state.tab === 'settings') renderAudits();
  updateTitlebarContext();
  renderStatusBarAudit();
}

function syncAuditPicker() {
  const sel = $('#global-audit');
  if (!sel) return;
  const current = state.auditId;
  const idsKey = state.audits.map((a) => a.id).join(',') + '|' + current;
  if (sel.dataset.key !== idsKey && document.activeElement !== sel) {
    sel.innerHTML = `<option value="">Semua audit</option>` +
      state.audits.map((a) => `<option value="${a.id}" ${a.id === current ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    sel.dataset.key = idsKey;
  }
}
