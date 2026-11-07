/**
 * sunscrap v2 — main (composition root)
 * Merangkai seluruh modul: tema, navigasi, binding per layar, event global,
 * polling status, dan langganan event dari proses utama.
 */
import { $, debounce, openModal, modalShell } from './dom.js';
import { api } from './helpers.js';
import { state } from './state.js';
import { applyTheme, applyDensity, initThemeWatchers } from './theme.js';
import { activateTab, onTabActivated, bindNav, loadAudits, updateTitlebarContext } from './chrome.js';
import { refreshWorker, toggleWorker, renderWorker } from './worker.js';
import { refreshDashboard, bindDashboardEvents } from './dashboard.js';
import { loadTargets, bindTargetEvents, registerActivateTab, openTarget } from './targets.js';
import { refreshAccountsView, loadReviews, bindAccountEvents, setReviewOnly } from './accounts.js';
import { loadProcess } from './process.js';
import { initSessionTab, bindSessionEvents, renderLoginStatus, renderBridgeStatus } from './session.js';
import { loadSettings, bindSettingsEvents, renderUpdate, runBackup, refreshUpdatePanel } from './settings.js';
import { openNewAudit, openExport } from './actions.js';
import { bindGlobalSearch } from './search.js';
import { openAccount } from './account-detail.js';

// ---------- langganan event global bernama (dipakai lintas modul) ----------
const activate = (name) => activateTab(name);

// ---------- shortcut modal ----------
function showShortcuts() {
  openModal(modalShell({
    title: 'Pintasan keyboard',
    body: `
      <div class="flag"><b>Ctrl K</b> — command palette (aksi + pencarian)</div>
      <div class="flag"><b>Ctrl 1…6</b> — pindah tab</div>
      <div class="flag"><b>G lalu 1…6</b> — pindah tab (gaya Linear)</div>
      <div class="flag"><b>G lalu T</b> — buka mode Perlu tinjauan</div>
      <div class="flag"><b>Ctrl I</b> — import · <b>Ctrl E</b> — export · <b>Ctrl Shift B</b> — cadangkan database</div>
      <div class="flag"><b>?</b> — pintasan ini · <b>Esc</b> — tutup dialog</div>`,
    foot: `<button class="btn btn-ghost" data-close>Tutup</button>`,
  }));
}

// ---------- keyboard shortcuts (Linear-style) ----------
let goPrefix = null;
let goPrefixTimer = null;
function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) { goPrefix = null; return; }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) { goPrefix = null; return; }
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
      if (k >= '1' && k <= '6') { e.preventDefault(); activate(['dashboard', 'targets', 'accounts', 'proses', 'browser', 'settings'][Number(k) - 1]); return; }
      return;
    }
    if (k === '?') { e.preventDefault(); showShortcuts(); }
  });
}

function openTriage() {
  setReviewOnly(true);
  activate('accounts');
}

// ---------- menu aplikasi (main process → renderer) ----------
function handleMenuAction(action) {
  if (action === 'import') openNewAudit();
  else if (action === 'export') openExport();
  else if (action === 'backup') runBackup();
  else if (action && action.startsWith('tab:')) activate(action.slice(4));
  else if (action && action.startsWith('theme:')) applyTheme(action.slice(6));
}

// ---------- refresh lintas tab saat data berubah ----------
const refreshActiveTab = async () => {
  await loadAudits();
  await refreshWorker();
  if (state.tab === 'dashboard') await refreshDashboard();
  else if (state.tab === 'targets') await loadTargets();
  else if (state.tab === 'accounts') await refreshAccountsView();
  else if (state.tab === 'proses') await loadProcess();
  else if (state.tab === 'settings') await loadSettings();
  else if (state.tab === 'browser') await renderLoginStatus();
};
const pollSoon = debounce(refreshActiveTab, 400);

// ---------- init ----------
async function init() {
  applyTheme((typeof localStorage !== 'undefined' && localStorage.getItem('sa_theme')) || 'system');
  applyDensity((typeof localStorage !== 'undefined' && localStorage.getItem('sa_density')) || 'auto');
  initThemeWatchers();

  // Suntik activator ke targets.js (hindari dependensi melingkar)
  registerActivateTab((name) => activate(name));

  // Binding per modul
  bindNav();
  bindDashboardEvents();
  bindTargetEvents();
  bindAccountEvents();
  bindSessionEvents();
  bindSettingsEvents();
  bindGlobalSearch();
  bindKeyboardShortcuts();

  // Tombol global lain
  $('#worker-toggle').addEventListener('click', toggleWorker);
  $('#proses-worker-toggle').addEventListener('click', async () => { await toggleWorker(); if (state.tab === 'proses') loadProcess(); });
  $('#btn-new-audit').addEventListener('click', openNewAudit);
  $('#btn-export').addEventListener('click', openExport);
  $('#btn-theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'));
  $('#global-audit').addEventListener('change', (e) => {
    state.auditId = e.target.value ? Number(e.target.value) : null;
    refreshActiveTab();
    updateTitlebarContext();
  });
  $('#auth-banner-ig').addEventListener('click', () => api.openLogin('instagram').catch(() => {}));
  $('#auth-banner-tk').addEventListener('click', () => api.openLogin('tiktok').catch(() => {}));

  // Event lintas-modul bernama
  document.addEventListener('sunscrap:activate-tab', (e) => activate(e.detail));
  document.addEventListener('sunscrap:open-import', () => openNewAudit());
  document.addEventListener('sunscrap:toggle-worker', () => toggleWorker());
  document.addEventListener('sunscrap:open-triage', () => openTriage());
  document.addEventListener('sunscrap:open-target', (e) => openTarget(e.detail));
  document.addEventListener('sunscrap:open-account', (e) => openAccount(e.detail.username, e.detail.platform));
  document.addEventListener('sunscrap:backup', () => runBackup());
  document.addEventListener('sunscrap:data-changed', () => pollSoon());

  // Listener per-tab (satu-satunya tempat yang tahu pemetaan tab → loader)
  onTabActivated((name) => {
    if (name === 'targets') loadTargets();
    else if (name === 'accounts') refreshAccountsView();
    else if (name === 'browser') initSessionTab();
    else if (name === 'proses') loadProcess();
    else if (name === 'settings') loadSettings();
    else if (name === 'dashboard') refreshDashboard();
  });

  // Langganan event dari proses utama
  window.sunscrap.onEvent((payload) => {
    if (payload.type === 'worker') { state.worker = payload.payload; renderWorker(); if (state.tab === 'proses') loadProcess(); }
    else if (payload.type === 'data') pollSoon();
    else if (payload.type === 'menu') handleMenuAction(payload.payload && payload.payload.action);
    else if (payload.type === 'update') renderUpdate(payload.payload);
    else if (payload.type === 'bridge') {
      const r = payload.payload || {};
      toast(`Sesi browser diperbarui (${r.instagram || 0} IG · ${r.tiktok || 0} TikTok).`, 'ok');
      if (state.tab === 'browser') { renderLoginStatus(); renderBridgeStatus(); }
    }
  });

  // Muat awal
  await loadAudits();
  await loadReviews();
  await refreshWorker();
  await refreshUpdatePanel();
  await refreshDashboard();

  // Polling ringan: refresh tab aktif tiap 5 detik (kecuali saat tersembunyi)
  setInterval(() => {
    if (document.hidden) return;
    refreshWorker();
    if (state.tab === 'dashboard') refreshDashboard();
    else if (state.tab === 'proses') loadProcess();
    else if (state.tab === 'browser') renderLoginStatus();
    else if (state.tab === 'settings') loadSettings();
  }, 5000);
}

// Ctrl+K / Ctrl+1..6 via accelerator menu juga tersedia; ini untuk fokus search & angka
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    const si = $('#global-search');
    if (si) { si.focus(); si.select(); }
  }
});

init();
