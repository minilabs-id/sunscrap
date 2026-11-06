/** sunscrap v2 — status & kontrol worker (sidebar + statusbar + banner auth). */
import { $ } from './dom.js';
import { toast } from './dom.js';
import { api, fmt } from './helpers.js';
import { state } from './state.js';

export function renderWorker() {
  const w = state.worker;
  if (!w) return;
  const active = !!w.active;
  const errored = !active && !!w.lastError;

  const dot = $('#worker-dot');
  const label = $('#worker-label');
  const toggle = $('#worker-toggle');
  const sub = $('#worker-sub');
  if (dot) dot.className = 'dot' + (active ? ' active' : errored ? ' error' : '');
  if (label) label.textContent = active ? 'Aktif' : errored ? 'Terhenti' : 'Siaga';
  if (toggle) {
    toggle.innerHTML = `<span>${active ? 'Hentikan worker' : 'Mulai worker'}</span>`;
    toggle.classList.toggle('btn-primary', !active);
    toggle.classList.toggle('btn-danger', active);
  }
  const r = w.rate || {};
  const cyclePct = r.visitBudget ? Math.min(100, Math.round((r.cycleVisits || 0) / r.visitBudget * 100)) : 0;
  const fill = $('#worker-rail-fill');
  if (fill) fill.style.width = cyclePct + '%';
  const meter = $('#worker-meter');
  if (meter) meter.setAttribute('aria-valuenow', String(cyclePct));
  if (sub) {
    sub.textContent = w.lastError
      ? w.lastError
      : (r.cycleRemaining !== undefined ? `Siklus ${fmt(r.cycleVisits)}/${fmt(r.visitBudget)} · pace ${r.paceLabel || '—'}` : 'Worker belum berjalan');
  }

  // Statusbar
  const sb = $('#sb-worker');
  if (sb) sb.innerHTML = `<span class="sb-dot ${active ? 'ok' : errored ? 'err' : ''}"></span>${active ? 'Aktif' : errored ? 'Terhenti' : 'Siaga'}`;
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
