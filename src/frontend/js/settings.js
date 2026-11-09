/**
 * sunscrap v2 — Pengaturan (audit, database, pembaruan, tampilan, privasi, zona berbahaya)
 */
import { $, $$, toast, openModal, closeModal, modalShell } from './dom.js';
import { api, esc, fmt } from './helpers.js';
import { state } from './state.js';

// ── audits ─────────────────────────────────────────────────────
let currentAudit = null;

function closeAuditMenu() {
  const pop = $('#audit-menu');
  if (pop) pop.hidden = true;
}

function openAuditMenu(btn) {
  const id = Number(btn.dataset.more);
  const audit = (state.audits || []).find((a) => a.id === id);
  const pop = $('#audit-menu');
  if (!audit || !pop) return;
  currentAudit = audit;
  pop.innerHTML = `
    <div class="menu-head">${esc(audit.name)}</div>
    <button class="menu-item" data-act2="profile">Kunjungi profil</button>
    <button class="menu-item" data-act2="edit">Edit</button>
    <button class="menu-item danger" data-act2="delete">Hapus</button>`;
  pop.hidden = false;
  const rect = btn.getBoundingClientRect();
  let left = rect.right - 208; if (left < 8) left = rect.left;
  let top = rect.bottom + 6;
  const popH = pop.scrollHeight;
  if (top + popH > window.innerHeight - 8) top = Math.max(8, rect.top - popH - 6);
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  pop.querySelectorAll('[data-act2]').forEach((b) => b.addEventListener('click', () => {
    closeAuditMenu();
    handleAuditAction(b.dataset.act2, currentAudit);
  }));
}

function handleAuditAction(act, audit) {
  if (!audit) return;
  const id = audit.id;
  if (act === 'rerun') {
    api.rerunAudit(id, true).then((r) => toast((r && r.error) || 'Dijadwalkan ulang.')).catch(() => toast('Gagal menjadwalkan ulang.', 'error'));
  } else if (act === 'profile') {
    api.enqueueProfileVisits(id).then((r) => {
      if (!r) return toast('Gagal menjadwalkan kunjungan profil.', 'error');
      toast(r.error || (r.pending ? 'Kunjungan profil sudah antre.' : `Menjadwalkan ${fmt(r.created)} kunjungan profil.`), r.error ? 'error' : 'ok');
    }).catch(() => toast('Gagal menjadwalkan kunjungan profil.', 'error'));
  } else if (act === 'delete') {
    openModal(modalShell({
      title: 'Hapus audit?',
      body: `<p>Audit <b>${esc(audit.name)}</b> dan seluruh postingan &amp; riwayatnya akan dihapus <b>permanen</b>.</p>`,
      foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger-solid" id="confirm-del">Hapus</button>`,
    }));
    $('#confirm-del').addEventListener('click', async () => {
      try { await api.deleteAudit(id); } catch { toast('Gagal menghapus audit.', 'error'); }
      closeModal();
      document.dispatchEvent(new CustomEvent('sunscrap:data-changed'));
    });
  } else if (act === 'edit') {
    openModal(modalShell({
      title: 'Edit audit',
      body: `<div class="field"><label for="edit-name">Nama</label><input id="edit-name" class="input" value="${esc(audit.name)}"></div>
            <div class="field field--flush"><label for="edit-repeat">Ulang (hari, 0 = manual)</label><input id="edit-repeat" class="input" type="number" min="0" max="365" value="${audit.repeat_days}"></div>`,
      foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary" id="confirm-edit">Simpan</button>`,
    }));
    $('#confirm-edit').addEventListener('click', async () => {
      try {
        await api.updateAudit(id, { name: $('#edit-name').value, repeat_days: Number($('#edit-repeat').value) });
        closeModal();
        document.dispatchEvent(new CustomEvent('sunscrap:data-changed'));
      } catch { toast('Gagal menyimpan perubahan.', 'error'); }
    });
  }
}

export function renderAudits() {
  $('#audits-table').innerHTML = `
    <thead><tr><th scope="col">Nama</th><th scope="col">Periode</th><th scope="col" class="num">Postingan</th><th scope="col" class="num">Terverifikasi</th><th scope="col" class="num">Ulang (hari)</th><th scope="col"><span class="sr-only">Aksi</span></th></tr></thead>
    <tbody>${(state.audits || []).map((a) => `
      <tr>
        <td><b>${esc(a.name)}</b></td><td>${esc(a.period || '—')}</td>
        <td class="num">${fmt(a.target_count)}</td>
        <td class="num">${fmt((a.ok_count || 0) + (a.partial_count || 0))}</td>
        <td class="num">${fmt(a.repeat_days)}</td>
        <td><div class="row-gap end">
          <button class="btn btn-ghost btn-sm" data-act="rerun" data-id="${a.id}">Audit ulang</button>
          <button class="btn btn-ghost btn-sm btn-more" data-more="${a.id}" aria-label="Aksi lain untuk ${esc(a.name)}" title="Aksi lain">⋯</button>
        </div></td>
      </tr>`).join('') || `<tr><td colspan="6" class="muted">Belum ada audit. Klik <b>Import data</b> di Ringkasan.</td></tr>`}</tbody>`;

  $$('#audits-table [data-act="rerun"]').forEach((btn) => btn.addEventListener('click', () => {
    handleAuditAction('rerun', (state.audits || []).find((a) => a.id === Number(btn.dataset.id)));
  }));
  $$('#audits-table [data-more]').forEach((btn) => btn.addEventListener('click', (e) => { e.stopPropagation(); openAuditMenu(btn); }));
}

// ── pembaruan (GitHub Releases) ────────────────────────────────
const UPDATE_STATUS_TEXT = (s) => ({
  dev: 'Mode pengembangan — pembaruan otomatis nonaktif. Gunakan "Unduh installer".',
  idle: 'Belum ada informasi pembaruan.',
  checking: 'Memeriksa pembaruan…',
  uptodate: 'Anda memakai versi terbaru.',
  available: `Versi ${s.availableVersion || ''} tersedia — mengunduh…`,
  downloading: `Mengunduh… ${Math.round(s.percent || 0)}%`,
  downloaded: `Versi ${s.availableVersion || ''} terunduh — memasang otomatis… Jika diblokir Windows, gunakan "Unduh installer".`,
  error: `Gagal memeriksa pembaruan${s.error ? `: ${s.error}` : ''} — coba lagi nanti.`,
}[s.status] || s.status);

let updateDownloadUrl = 'https://github.com/startupmini/sunscrap/releases/latest';

export function renderUpdate(s) {
  if (!s) return;
  if (s.downloadUrl || s.releaseUrl) updateDownloadUrl = s.downloadUrl || s.releaseUrl;
  const v = $('#update-version'); if (v) v.textContent = s.version || '—';
  const st = $('#update-status'); if (st) st.textContent = UPDATE_STATUS_TEXT(s);
  const prog = $('#update-progress');
  if (prog) {
    const show = s.status === 'downloading' || s.status === 'available';
    prog.hidden = !show;
    const pctVal = Math.max(0, Math.min(100, s.percent || 0));
    const bar = prog.querySelector('span');
    if (bar) bar.style.width = `${pctVal}%`;
    prog.setAttribute('aria-valuenow', String(Math.round(pctVal)));
  }
  const install = $('#btn-install-update');
  if (install) install.hidden = s.status !== 'downloaded';
}

export async function refreshUpdatePanel() { try { renderUpdate(await api.updateState()); } catch { /* opsional */ } }

// ── database info ──────────────────────────────────────────────
export async function loadDbInfo() {
  try {
    const info = await api.dbInfo();
    const counts = info.counts || {};
    const chip = (label, value) => `<div class="db-chip"><span>${esc(label)}</span><b>${esc(String(value))}</b></div>`;
    $('#db-info').innerHTML = [
      chip('Ukuran', `${fmt(Math.round((info.size_bytes || 0) / 1024))} KB`),
      chip('Audit', fmt(counts.audits)),
      chip('Postingan', fmt(counts.targets)),
      chip('Akun', fmt(counts.accounts)),
      chip('Snapshot', fmt(counts.snapshots)),
    ].join('');
    if (!state.dbInfoCache) { state.dbInfoCache = info; const sb = $('#sb-db'); if (sb) sb.textContent = `DB ${Math.round((info.size_bytes || 0) / 1024)} KB`; }
  } catch (e) {
    console.error('dbInfo gagal:', e);
    const el = $('#db-info'); if (el) el.innerHTML = '<div class="muted">Gagal memuat info database.</div>';
  }
}

// ── restore (pratinjau → konfirmasi) ───────────────────────────
async function handleRestore() {
  let prev = null;
  try { prev = await api.restorePreview(); } catch { toast('Gagal membaca cadangan.', 'error'); return; }
  if (!prev || prev.canceled) return;
  if (prev.error) { toast(prev.error, 'error'); return; }
  const c = prev.counts || {};
  const schemaMismatch = prev.schema_version !== undefined && prev.schema_version !== null && Number(prev.schema_version) !== 5;
  openModal(modalShell({
    title: 'Pulihkan dari cadangan',
    body: `<p>Anda akan mengganti <b>seluruh data saat ini</b> dengan cadangan:</p>
      <ul><li><b>File:</b> ${esc(prev.file)}</li><li>Audit ${fmt(c.audits)} · Postingan ${fmt(c.targets)} · Snapshot ${fmt(c.snapshots)} · Akun ${fmt(c.accounts)}</li><li>Skema: v${esc(prev.schema_version ?? '?')} (aplikasi ini: v5)</li></ul>
      ${schemaMismatch ? `<p class="muted err-notebox"><b>Tidak kompatibel:</b> cadangan dibuat dengan skema v${esc(prev.schema_version)}. Pemulihan ditolak.</p>` : '<p class="muted">Data aktif dicadangkan otomatis dulu sebelum diganti. Tidak bisa dibatalkan.</p>'}`,
    foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger-solid" id="confirm-restore" ${schemaMismatch ? 'disabled' : ''}>Pulihkan</button>`,
  }));
  $('#confirm-restore').addEventListener('click', async () => {
    let r = null;
    try { r = await api.restoreCommit(prev.path); } catch { toast('Gagal memulihkan data.', 'error'); return; }
    closeModal();
    if (r && r.error) toast(r.error, 'error');
    else if (r) {
      toast('Data dipulihkan. Safety backup: ' + (r.safety_path || r.safety_backup), 'ok');
      document.dispatchEvent(new CustomEvent('sunscrap:data-changed'));
    }
  });
}

// ── hapus semua data ───────────────────────────────────────────
function handleClearAll() {
  openModal(modalShell({
    title: 'Hapus semua data',
    body: `<p>Semua audit, postingan, snapshot, dan data akun akan dihapus <b>permanen</b>.</p>
      <div class="field"><label for="clear-confirm">Ketik <b>HAPUS</b> untuk melanjutkan</label><input id="clear-confirm" class="input" placeholder="HAPUS" autocomplete="off"></div>
      <label class="row-gap mt-2 clickable"><input type="checkbox" id="clear-backup" checked> Cadangkan database dulu (disarankan)</label>`,
    foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger-solid" id="confirm-clear" disabled>Hapus semua</button>`,
  }));
  const checkEnabled = () => { $('#confirm-clear').disabled = $('#clear-confirm').value.trim() !== 'HAPUS'; };
  $('#clear-confirm').addEventListener('input', checkEnabled);
  checkEnabled();
  $('#confirm-clear').addEventListener('click', async () => {
    if ($('#clear-backup').checked) {
      try { await api.dbBackup(); } catch { toast('Cadangan gagal — penghapusan dibatalkan demi keamanan.', 'error'); return; }
    }
    try { await api.clearAll(); } catch { toast('Gagal menghapus data.', 'error'); return; }
    closeModal();
    toast('Data dihapus.', 'ok');
    document.dispatchEvent(new CustomEvent('sunscrap:data-changed'));
  });
}

function handleClearSession() {
  openModal(modalShell({
    title: 'Hapus sesi login?',
    body: `<p>Sesi login Instagram &amp; TikTok akan dihapus. <b>Worker akan berhenti sampai Anda login ulang.</b> Data audit TIDAK terhapus.</p>`,
    foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger-solid" id="confirm-clear-session">Hapus sesi</button>`,
  }));
  $('#confirm-clear-session').addEventListener('click', async () => {
    let r = null;
    try { r = await api.clearSession(); } catch { r = { ok: false, error: 'Gagal menghapus sesi.' }; }
    closeModal();
    if (r && r.ok) toast('Sesi login dihapus. Login ulang lewat tray/Sesi.', 'ok'); else toast((r && r.error) || 'Gagal hapus sesi.', 'error');
  });
}

// ── boot loader untuk tab ini ──────────────────────────────────
export async function loadSettings() {
  renderAudits();
  refreshUpdatePanel();
  loadDbInfo();
}

/** Cadangkan database (dipakai tombol Pengaturan & menu aplikasi). */
export async function runBackup() {
  try {
    const r = await api.dbBackup();
    if (r && r.error) toast(r.error, 'error'); else if (r && !r.canceled) toast('Cadangan tersimpan.', 'ok');
  } catch { toast('Gagal membuat cadangan.', 'error'); }
}

export function bindSettingsEvents() {
  $('#btn-backup').addEventListener('click', runBackup);
  $('#btn-restore').addEventListener('click', handleRestore);
  $('#btn-clear-session').addEventListener('click', handleClearSession);
  $('#btn-clear').addEventListener('click', handleClearAll);
  // Tutup menu audit saat klik di luar / Escape.
  document.addEventListener('click', (e) => {
    if (e.target.closest('#audit-menu') || e.target.closest('[data-more]')) return;
    closeAuditMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAuditMenu(); });
  $('#btn-check-update').addEventListener('click', async () => {
    const btn = $('#btn-check-update');
    btn.disabled = true;
    try { renderUpdate(await api.checkForUpdates()); } catch { toast('Gagal memeriksa pembaruan.', 'error'); } finally { btn.disabled = false; }
  });
  $('#btn-install-update').addEventListener('click', () => { api.installUpdate(); });
  $('#btn-download').addEventListener('click', () => api.openExternal(updateDownloadUrl));
  $('#btn-open-releases').addEventListener('click', () => api.openExternal('https://github.com/startupmini/sunscrap/releases'));
  $('#btn-diag').addEventListener('click', async () => { try { await api.copyDiagnostics(); toast('Info diagnostik disalin ke clipboard.', 'ok'); } catch { toast('Gagal menyalin info diagnostik.', 'error'); } });
  $('#btn-open-data').addEventListener('click', () => api.openDataFolder().catch(() => { /* abaikan */ }));
}
