/**
 * sunscrap v2 — aksi global (Import data & Export)
 * Dipicu dari: tombol Ringkasan, menu aplikasi, command palette (Ctrl+K).
 */
import { $, toast, openModal, closeModal, modalShell } from './dom.js';
import { api, esc, fmt } from './helpers.js';
import { state } from './state.js';

// ── export ─────────────────────────────────────────────────────
const statusToExport = (val) => ({ ok: 'OK', partial: 'PARTIAL', failed: 'FAILED', done: 'DONE' }[val] || null);

export async function openExport() {
  const status = statusToExport(state.targets.status);
  const issue = state.targets.issue || null;
  const audit = (state.audits || []).find((a) => a.id === state.auditId);
  const statusLabel = { done: 'Selesai (OK + sebagian)', ok: 'OK', partial: 'Sebagian', failed: 'Gagal' }[state.targets.status] || 'Semua status';
  const issueLabel = { no_followers: 'Tanpa followers', no_views: 'TikTok tanpa views', no_username: 'Tanpa handle', never_scraped: 'Belum diproses', partial: 'Sebagian', failed: 'Gagal' }[issue] || null;
  let count = null;
  try { count = await api.exportCount({ auditId: state.auditId || null, status, issue }); } catch { count = null; }
  openModal(modalShell({
    title: 'Export data',
    body: `<p>Anda akan mengekspor:</p><ul>
      <li><b>Audit:</b> ${esc(audit ? audit.name : 'Semua audit')}</li>
      <li><b>Status:</b> ${esc(statusLabel)}</li>
      ${issueLabel ? `<li><b>Filter isu:</b> ${esc(issueLabel)}</li>` : ''}
      <li><b>Baris:</b> ${fmt(count)}</li></ul>
      <p class="muted">File .xlsx berisi kolom metrik + delta + keputusan tinjauan + rekap. Simpan di lokasi aman.</p>`,
    foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="confirm-export">Unduh .xlsx…</button>`,
  }));
  $('#confirm-export').addEventListener('click', async () => {
    closeModal();
    try {
      const r = await api.exportExcel({ auditId: state.auditId || null, status, issue });
      if (r && r.error) toast(r.error, 'error');
      else if (r && !r.canceled) toast(`Export selesai: ${fmt(r.rows)} baris.`, 'ok');
    } catch { toast('Export gagal.', 'error'); }
  });
}

// ── import (file atau tempel link) ─────────────────────────────
export function openNewAudit() {
  const auditOptions = `<option value="">— Audit baru —</option>` + (state.audits || []).map((a) => `<option value="${a.id}">Tambah ke: ${esc(a.name)}</option>`).join('');
  openModal(modalShell({
    title: 'Import data',
    body: `
      <div class="field"><label for="new-name">Nama audit (untuk audit baru)</label><input id="new-name" class="input" placeholder="mis. Kampanye November" autocomplete="off"></div>
      <div class="field"><label for="new-repeat">Ulang (hari, 0 = manual)</label><input id="new-repeat" class="input" type="number" min="0" max="365" value="0"></div>
      <div class="field"><label for="new-audit">Tujuan</label><select id="new-audit" class="select">${auditOptions}</select></div>
      <button class="btn btn-primary btn-block" id="confirm-file">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v6h6"/></svg>
        Pilih file Excel/CSV (kolom Link/URL)
      </button>
      <div class="modal-divider"><span>atau tempel link</span></div>
      <div class="field field--flush"><label for="new-links">Tempel link postingan — satu per baris</label>
        <textarea id="new-links" class="input" rows="5" placeholder="https://www.instagram.com/p/CODE/&#10;https://www.tiktok.com/@user/video/7123456789"></textarea></div>
      <p class="muted mt-2">Maksimal 10.000 baris per import.</p>`,
    foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-ghost" id="confirm-links">Import link</button>`,
  }));

  const getOpts = () => ({ name: $('#new-name').value, repeat_days: Number($('#new-repeat').value), auditId: $('#new-audit').value ? Number($('#new-audit').value) : null });

  $('#confirm-file').addEventListener('click', async () => {
    const opts = getOpts();
    let res;
    try {
      res = opts.auditId ? await api.appendTargets({ auditId: opts.auditId }) : await api.createAudit({ name: opts.name, repeat_days: opts.repeat_days });
    } catch { toast('Import gagal.', 'error'); return; }
    closeModal();
    if (res.canceled) return;
    if (res.error) toast(res.error, 'error');
    else toast(`Import ${fmt(res.inserted)} postingan baru (${fmt(res.duplicates)} sudah ada, ${fmt(res.skipped)} dilewati) — masuk antrean.`, 'ok');
    document.dispatchEvent(new CustomEvent('sunscrap:data-changed'));
  });

  $('#confirm-links').addEventListener('click', async () => {
    const text = $('#new-links').value || '';
    if (!text.trim()) { toast('Tempel link dulu, atau pakai "Pilih file".', 'error'); return; }
    const opts = getOpts();
    let res;
    try { res = await api.importLinks({ text, name: opts.name, repeat_days: opts.repeat_days, auditId: opts.auditId }); } catch { toast('Import gagal.', 'error'); return; }
    closeModal();
    if (res.error) toast(res.error, 'error');
    else toast(`Import ${fmt(res.inserted)} postingan baru (${fmt(res.duplicates)} sudah ada, ${fmt(res.skipped)} dilewati) — masuk antrean.`, 'ok');
    document.dispatchEvent(new CustomEvent('sunscrap:data-changed'));
  });
}
