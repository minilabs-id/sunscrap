/** sunscrap v2 — Proses (pace worker, antrean, aktivitas terbaru). */
import { $ } from './dom.js';
import { api, esc, fmt, fmtWhen, relTime, deltaBadge } from './helpers.js';
import { state } from './state.js';
import { statusBadge } from './targets.js';

export async function loadProcess() {
  try {
    await renderHealth();
    const s = await api.getQueueStats();
    const pending = s.pending || 0, running = s.running || 0, ok = s.ok || 0, partial = s.partial || 0, failed = s.failed || 0;
    const total = Math.max(pending + running + ok + partial + failed, 1);
    const W = (v) => (v / total * 100).toFixed(2) + '%';

    const bar = $('#queue-bar');
    if (bar) {
      bar.innerHTML = `
        <span class="q-seg ok" style="width:${W(ok)}" title="OK ${fmt(ok)}">${ok ? `OK ${fmt(ok)}` : ''}</span>
        <span class="q-seg part" style="width:${W(partial)}" title="Sebagian ${fmt(partial)}">${partial ? fmt(partial) : ''}</span>
        <span class="q-seg fail" style="width:${W(failed)}" title="Gagal ${fmt(failed)}">${failed ? fmt(failed) : ''}</span>
        <span class="q-seg wait" style="width:${W(pending)}" title="Menunggu ${fmt(pending)}">${pending ? fmt(pending) : ''}</span>`;
      bar.setAttribute('aria-label', `Antrean: OK ${ok} · sebagian ${partial} · gagal ${failed} · menunggu ${pending}`);
    }
    const legend = $('#queue-legend');
    if (legend) {
      legend.innerHTML =
        `<span><i class="seg-ok"></i>OK — ${fmt(ok)}</span>` +
        `<span><i class="seg-warn"></i>Sebagian — ${fmt(partial)}</span>` +
        `<span><i class="seg-err"></i>Gagal — ${fmt(failed)}</span>` +
        `<span><i class="seg-idle"></i>Menunggu — ${fmt(pending)}</span>`;
    }
    const stats = $('#queue-stats');
    if (stats) {
      stats.innerHTML = [
        { label: 'Menunggu', v: pending },
        { label: 'Berjalan', v: running },
        { label: 'OK', v: ok + partial },
        { label: 'Gagal', v: failed },
      ].map((x) => `<div class="queue-stat"><b>${fmt(x.v)}</b><span>${esc(x.label)}</span></div>`).join('');
    }

    // ETA + pace dari worker
    let pace = null, etaStr = null, w = null;
    try { w = await api.workerStatus(); pace = w && w.rate && w.rate.paceLabel; etaStr = w && w.eta; } catch { /* opsional */ }
    const etaEl = $('#queue-eta');
    if (etaEl) {
      const eta = pending + running;
      etaEl.textContent = eta > 0 ? `${fmt(eta)} task tersisa${pace ? ` · pace ${pace}` : ''}${etaStr ? ` · sisa ±${etaStr}` : ''}` : 'Antrean kosong';
    }

    // Pace & budget
    renderPace(w);
    renderProsesStatus(w);

    // Aktivitas terbaru
    const latest = await api.getLatest({ limit: 20 });
    $('#latest-table').innerHTML = `
      <thead><tr><th scope="col">Waktu</th><th scope="col">Akun</th><th scope="col" class="num">Follower</th><th scope="col" class="num">Likes</th><th scope="col" class="num">Δ Likes</th><th scope="col" class="num">Views</th><th scope="col" class="num">Δ Views</th><th scope="col">Status</th></tr></thead>
      <tbody>${(latest || []).map((r) => {
        const dLikes = (r.likes != null && r.prev_likes != null) ? r.likes - r.prev_likes : null;
        const dViews = (r.views != null && r.prev_views != null) ? r.views - r.prev_views : null;
        const failedRow = String(r.status || '').toLowerCase() === 'failed';
        return `<tr><td class="muted">${esc(fmtWhen(r.scraped_at))}</td>
          <td>@${esc(r.username || '—')} <span class="badge ${r.platform === 'instagram' ? 'ig' : 'tk'}">${r.platform === 'instagram' ? 'IG' : 'TK'}</span></td>
          <td class="num">${fmt(r.follower_count)}</td><td class="num">${fmt(r.likes)}</td><td class="num">${deltaBadge(dLikes)}</td><td class="num">${fmt(r.views)}</td><td class="num">${deltaBadge(dViews)}</td>
          <td>${statusBadge(r.status)}${failedRow && r.error_message ? `<div class="err-note" title="${esc(r.error_message)}">${esc(r.error_message)}</div>` : ''}</td></tr>`;
      }).join('') || `<tr><td colspan="8" class="muted">Belum ada aktivitas. Jalankan worker untuk mengisi tabel ini.</td></tr>`}</tbody>`;
  } catch (e) {
    console.error('loadProcess gagal:', e);
    const eta = $('#queue-eta'); if (eta) eta.textContent = 'Gagal memuat antrean.';
  }
}

/** Panel kesehatan siklus: sukses-rate, histogram error, kejadian terbaru. */
async function renderHealth() {
  const host = $('#worker-health');
  if (!host) return;
  let activity = [];
  try { activity = await api.workerActivity(50) || []; } catch { /* abaikan */ }
  const tasks = activity.filter((e) => e.type === 'task');
  const ok = tasks.filter((e) => e.status === 'OK').length;
  const failed = tasks.filter((e) => e.status === 'FAILED');
  const partial = tasks.filter((e) => e.status === 'PARTIAL').length;
  const rate = tasks.length ? Math.round((ok / tasks.length) * 100) : null;
  const codes = {};
  failed.forEach((e) => { const c = e.errorCode || 'UNKNOWN'; codes[c] = (codes[c] || 0) + 1; });
  const top = Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const ERR_LABEL = { AUTH: 'Login', THROTTLED: 'Dibatasi', PERMANENT: 'Permanen', TRANSIENT: 'Sementara' };

  host.innerHTML = `
    <div class="queue-stats" style="grid-template-columns:repeat(4,1fr);margin-top:0">
      <div class="queue-stat"><b>${rate === null ? '—' : rate + '%'}</b><span>sukses</span></div>
      <div class="queue-stat"><b>${fmt(tasks.length)}</b><span>task</span></div>
      <div class="queue-stat"><b>${fmt(partial)}</b><span>sebagian</span></div>
      <div class="queue-stat"><b>${fmt(failed.length)}</b><span>gagal</span></div>
    </div>
    ${top.length ? `<div class="queue-legend" style="margin-top:10px">${top.map(([c, n]) => `<span><i style="background:var(--err)"></i>${esc(ERR_LABEL[c] || c)} — ${fmt(n)}</span>`).join('')}</div>` : ''}
    <div style="margin-top:12px;display:flex;flex-direction:column">
      ${activity.slice(0, 6).map((ev) => {
        if (ev.type !== 'task') {
          return `<div class="check-row"><div><strong>${ev.type === 'start' ? 'Worker dimulai' : 'Worker dihentikan'}${ev.reason ? ' — ' + esc(ev.reason) : ''}</strong><div class="muted text-micro">${esc(relTime(ev.t))}</div></div></div>`;
        }
        const pl = ev.platform === 'instagram' ? 'IG' : 'TK';
        return `<div class="check-row"><div><strong>${pl}:${esc(ev.username || '?')}</strong> ${statusBadge(ev.status)} ${ev.errorCode ? `<span class="muted">· ${esc(ERR_LABEL[ev.errorCode] || ev.errorCode)}</span>` : ''}<div class="muted text-micro">${ev.ms ? fmt(ev.ms) + ' ms · ' : ''}${esc(relTime(ev.t))}</div></div></div>`;
      }).join('') || '<div class="muted">Belum ada aktivitas worker.</div>'}
    </div>`;
}

/** Banner status worker eksplisit (aktif/siaga/terhenti + tombol kontrol). */
export function renderProsesStatus(w) {
  if (!w) return;
  const active = !!w.active;
  const errored = !active && !!w.lastError;
  const dot = $('#proses-dot');
  const label = $('#proses-status-label');
  const sub = $('#proses-status-sub');
  const toggle = $('#proses-worker-toggle');
  if (dot) dot.className = 'dot' + (active ? ' active' : errored ? ' error' : '');
  if (label) label.textContent = active ? 'Worker aktif' : (errored ? 'Worker terhenti' : 'Worker siaga');
  if (toggle) {
    toggle.textContent = active ? 'Hentikan worker' : 'Mulai worker';
    toggle.classList.toggle('btn-primary', !active);
    toggle.classList.toggle('btn-danger', active);
  }
  if (!sub) return;
  const r = w.rate || {};
  if (active) {
    const eta = w.eta || null;
    sub.textContent = `${w.busy ? 'Sedang memproses' : 'Menunggu antrean'} · jeda ${r.paceLabel || '—'} · siklus ${fmt(r.cycleVisits)}/${fmt(r.visitBudget)}${eta ? ` · sisa ±${eta}` : ''}`;
  } else if (errored) {
    sub.textContent = w.lastError;
  } else {
    sub.textContent = 'Belum berjalan — klik "Mulai worker" untuk memulai scraping.';
  }
}

/** Meter pace + rincian budget (dipanggil dari loadProcess & saat worker berubah). */
export function renderPace(w) {
  if (!w) return;
  const r = w.rate || {};
  const cyclePct = r.visitBudget ? Math.min(100, Math.round((r.cycleVisits || 0) / r.visitBudget * 100)) : 0;
  const num = $('#pace-num'); if (num) num.textContent = r.paceLabel || '—';
  const meter = $('#pace-meter'); if (meter) meter.style.width = cyclePct + '%';
  const paceBar = $('#pace-bar'); if (paceBar) paceBar.setAttribute('aria-valuenow', String(cyclePct));
  const cycle = $('#pb-cycle'); if (cycle) cycle.textContent = r.visitBudget ? `${fmt(r.cycleVisits)} / ${fmt(r.visitBudget)}` : '—';
  const daily = $('#pb-daily'); if (daily) daily.textContent = (r.dailyVisits != null && r.dailyRail) ? `${fmt(r.dailyVisits)} / ${fmt(r.dailyRail)}` : '—';
  const session = $('#pb-session'); if (session) session.textContent = (r.sessionTasks != null && r.sessionBreakAt) ? `${fmt(r.sessionTasks)} / ${fmt(r.sessionBreakAt)}` : '—';
  const mode = $('#pb-mode'); if (mode) mode.textContent = r.modeLabel || '—';
  const d = $('#worker-detail');
  if (d) {
    d.textContent = w.lastError
      ? w.lastError
      : `Pace ${r.paceLabel || '—'} · mode ${r.modeLabel || '—'} · siklus ${fmt(r.cycleVisits)}/${fmt(r.visitBudget)} kunjungan`;
  }
  const sbPace = $('#sb-pace');
  if (sbPace) sbPace.textContent = `Pace ${r.paceLabel || '—'}`;
}
