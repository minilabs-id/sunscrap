/** sunscrap v2 — Proses (antrean + aktivitas + detail teknis). */
import { $ } from './dom.js';
import { api, esc, fmt, fmtWhen, deltaBadge } from './helpers.js';
import { statusBadge } from './targets.js';

export async function loadProcess() {
  try {
    const [queue, w, latest] = await Promise.all([
      api.getQueueStats().catch(() => ({ pending: 0, running: 0, ok: 0, partial: 0, failed: 0 })),
      api.workerStatus().catch(() => null),
      api.getLatest({ limit: 20 }).catch(() => []),
    ]);
    renderQueue(queue, w);
    renderLatest(latest);
    renderPace(w);
  } catch (e) {
    console.error('loadProcess gagal:', e);
    const eta = $('#queue-eta'); if (eta) eta.textContent = 'Gagal memuat antrean.';
  }
}

function renderQueue(queue, w) {
  const pending = queue.pending || 0, running = queue.running || 0, ok = queue.ok || 0, partial = queue.partial || 0, failed = queue.failed || 0;
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
      { label: 'Selesai', v: ok + partial },
      { label: 'Gagal', v: failed },
    ].map((x) => `<div class="queue-stat"><b>${fmt(x.v)}</b><span>${esc(x.label)}</span></div>`).join('');
  }
  const etaEl = $('#queue-eta');
  if (etaEl) {
    const eta = pending + running;
    const r = w && w.rate;
    etaEl.textContent = eta > 0 ? `${fmt(eta)} task tersisa · pace ${(r && r.paceLabel) || '—'}${w && w.eta ? ` · sisa ±${w.eta}` : ''}` : 'Antrean kosong';
  }
}

function renderLatest(latest) {
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
}

/** Detail teknis (collapsible): pace / mode / siklus / harian / sesi. */
function renderPace(w) {
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
  const summary = $('#tech-summary');
  if (summary) summary.textContent = `${r.modeLabel || '—'} · jeda ${r.paceLabel || '—'} · siklus ${fmt(r.cycleVisits)}/${fmt(r.visitBudget || 0)}`;
  const sbPace = $('#sb-pace');
  if (sbPace) sbPace.textContent = `Pace ${r.paceLabel || '—'}`;
}