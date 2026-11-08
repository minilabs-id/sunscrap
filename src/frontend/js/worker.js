/** sunscrap v2 — status & kontrol worker (sidebar + statusbar + banner auth). */
import { $ } from './dom.js';
import { toast } from './dom.js';
import { api } from './helpers.js';
import { state } from './state.js';

export function renderWorker() {
  const w = state.worker;
  if (!w) return;
  const active = !!w.active;
  const errored = !active && !!w.lastError;

  const toggle = $('#worker-toggle');
  if (toggle) {
    const label = toggle.querySelector('.btn-label');
    if (label) label.textContent = active ? 'Hentikan worker' : 'Mulai worker';
    toggle.classList.toggle('btn-primary', !active);
    toggle.classList.toggle('btn-danger', active);
    toggle.classList.toggle('is-active', active);
    toggle.setAttribute('aria-label', active ? 'Hentikan worker' : 'Mulai worker');
    toggle.title = active ? 'Hentikan worker' : 'Mulai worker';
  }
  const r = w.rate || {};

  // Statusbar — ringkas tapi informatif
  const sb = $('#sb-worker');
  if (sb) {
    const plats = w.platforms || {};
    const paused = [
      plats.instagram && plats.instagram.paused ? 'IG' : null,
      plats.tiktok && plats.tiktok.paused ? 'TK' : null,
    ].filter(Boolean);
    const label = active ? (w.busy ? 'Memproses' : 'Menunggu') : (errored ? 'Terhenti' : 'Siaga');
    const progress = active && r.visitBudget ? `${r.cycleVisits || 0}/${r.visitBudget}` : '';
    const pauseNote = paused.length ? ` · ⏸ ${paused.join('')}` : '';
    sb.innerHTML = `<span class="sb-dot ${active ? 'ok' : errored ? 'err' : ''}"></span>${label}${progress ? ' ' + progress : ''}${pauseNote}`;
    if (errored && w.lastError) sb.title = w.lastError;
    else sb.title = '';
  }
  const sbPace = $('#sb-pace');
  if (sbPace) sbPace.textContent = `Pace ${(r && r.paceLabel) || '—'}`;

  // Banner sesi — hanya saat error bernuansa auth/login
  const banner = $('#auth-banner');
  if (banner) {
    const isAuth = w.lastError && /login|session|auth|kedaluwarsa|masuk|berakhir/i.test(String(w.lastError));
    banner.hidden = !isAuth;
    if (isAuth) $('#auth-banner-text').textContent = w.lastError;
  }
}

export async function refreshWorker() {
  try {
    state.worker = await api.workerStatus();
    renderWorker();
    renderStatusBarAudit();
  } catch (e) {
    console.error('refreshWorker gagal:', e);
  }
}

/** Audit aktif di statusbar — dipakai juga oleh modul lain setelah data berubah. */
export function renderStatusBarAudit() {
  const audit = (state.audits || []).find((a) => a.id === state.auditId);
  const sbAudit = $('#sb-audit');
  if (sbAudit) sbAudit.textContent = audit ? `Audit: ${audit.name}` : 'Audit: Semua';
}

export async function toggleWorker() {
  try {
    if (state.worker && state.worker.active) await api.workerStop();
    else await api.workerStart();
    await refreshWorker();
  } catch {
    toast('Gagal mengubah status worker.', 'error');
  }
}
