/**
 * sunscrap v2 — detail akun (modal)
 * Modal bukti-dulu: skor, flag, akun tertaut, seri bulanan,
 * plus keputusan tinjauan manual (bookmark / clear / flag).
 */
import { $, $$, openModal, closeModal, toast, modalShell } from './dom.js';
import {
  api, esc, fmt, fmtPct, relTime,
  reviewKey, reviewMeta, riskScorePct,
} from './helpers.js';
import { state } from './state.js';
import { refreshAccountIntel } from './intel.js';

// ── avatar helpers ─────────────────────────────────────────────
export function avatarHtml(url, username, large = false) {
  const cls = large ? 'avatar-lg' : '';
  const local = url && !/^https?:\/\//i.test(url) ? String(url) : null;
  const initial = esc((username || '?').slice(0, 1).toUpperCase());
  if (!local) return `<span class="avatar-fallback ${cls}">${initial}</span>`;
  return `<span class="avatar-wrap"><img class="avatar ${cls}" src="sa-avatar:///${encodeURIComponent(local)}" alt="" loading="lazy" data-fallback="${initial}"></span>`;
}

export function swapBrokenAvatar(img) {
  const span = document.createElement('span');
  span.className = 'avatar-fallback' + (img.classList.contains('avatar-lg') ? ' avatar-lg' : '');
  span.textContent = img.dataset.fallback || '?';
  img.replaceWith(span);
}

export function wireAvatarErrors(root = document) {
  root.querySelectorAll('img.avatar').forEach((img) => {
    if (img.complete && img.naturalWidth === 0) { swapBrokenAvatar(img); return; }
    img.addEventListener('error', () => swapBrokenAvatar(img));
  });
}

// ── modal detail ───────────────────────────────────────────────
export function openAccount(username, platform) {
  api.getAccountDetail(platform, username).then((detail) => {
    if (!detail) { toast('Akun belum pernah disimpan.', 'error'); return; }
    const flags = (detail.flags || []).map((f) => `<div class="flag"><b>${esc(f.label)}</b> (+${f.points}) — ${esc(f.detail)}</div>`).join('');
    const siblings = (detail.siblings || []).map((s) => {
      const reasonLabels = { konten: 'Konten sama', kontak: 'Kontak bio sama', template: 'Caption seragam', serentak: 'Unggah serentak', nama: 'Nama berpola' };
      const reasons = (s.reasons || []).map((r) => reasonLabels[r] || r).join(', ');
      return `<div class="flag"><b>@${esc(s.username)}</b> — ${esc(s.level)} (${esc(reasons)})</div>`;
    }).join('');
    const history = (detail.history || []).map((h) => `<tr><td>${esc(h.month)}</td><td class="num">${fmt(h.follower_count)}</td><td class="num">${fmt(h.post_count)}</td></tr>`).join('');
    const cur = state.reviews[reviewKey(detail.platform, detail.username)];
    const curMeta = cur ? reviewMeta(cur.decision) : null;
    const reach = detail.metrics && detail.metrics.view_reach_pct !== null && detail.metrics.view_reach_pct !== undefined
      ? fmtPct(detail.metrics.view_reach_pct)
      : (detail.metrics && detail.metrics.like_reach_pct !== null && detail.metrics.like_reach_pct !== undefined ? fmtPct(detail.metrics.like_reach_pct) : '—');

    const body = `
      <div class="grid-2 mb-3">
        <div><div class="micro-label">Followers</div><div class="num stat-num">${fmt(detail.followers)}</div></div>
        <div><div class="micro-label">Median reach</div><div class="num stat-num">${reach}</div></div>
      </div>
      <p class="muted">${esc(detail.bio || '(tanpa bio)')}${detail.region ? ' · ' + esc(detail.region) : ''}</p>
      <div class="panel"><div class="panel-title">Indikasi (${fmt(detail.score)} poin)</div>${flags || '<div class="muted">Tidak ada indikasi.</div>'}</div>
      <div class="panel"><div class="panel-title">Tinjauan manual</div>
        <div class="muted mb-3" id="review-current">${cur ? `Status: <b>${esc(curMeta ? curMeta.label : cur.decision)}</b>${cur.note ? ' — ' + esc(cur.note) : ''}${cur.at ? ' · ' + esc(relTime(cur.at)) : ''}` : 'Belum ada keputusan.'}</div>
        <div class="row-gap mb-2">
          <button class="btn btn-ghost btn-sm" data-rv="bookmark">Ditandai</button>
          <button class="btn btn-ghost btn-sm" data-rv="clear">Bersih</button>
          <button class="btn btn-ghost btn-sm" data-rv="flag">Konfirmasi</button>
        </div>
        <div class="field field--flush"><label for="rv-note">Catatan (opsional)</label><textarea id="rv-note" class="input" rows="2" placeholder="Alasan keputusan…">${esc(cur ? cur.note || '' : '')}</textarea></div>
      </div>
      ${siblings ? `<div class="panel"><div class="panel-title">Akun tertaut</div>${siblings}</div>` : ''}
      ${history ? `<div class="panel"><div class="panel-title">Seri bulanan</div><table class="table"><thead><tr><th scope="col">Bulan</th><th scope="col" class="num">Followers</th><th scope="col" class="num">Post</th></tr></thead><tbody>${history}</tbody></table></div>` : ''}`;

    const title = `<span class="h3-flex">${avatarHtml(detail.avatar_url, detail.username, true)}<span class="truncate">@${esc(detail.username)}</span> <span class="badge lv-${esc(detail.level)}">${esc(detail.level.replace(/_/g, ' '))}</span></span>`;
    const foot = `<button class="btn btn-danger mr-auto" id="del-account">Hapus data akun…</button><button class="btn btn-ghost" data-close>Tutup</button>`;

    openModal(modalShell({ title, body, foot }));
    $('#del-account').addEventListener('click', () => openDeleteAccount(detail.username, detail.platform));
    $$('#modal-root [data-rv]').forEach((btn) => btn.addEventListener('click', async () => {
      const decision = btn.dataset.rv;
      const note = ($('#rv-note') ? $('#rv-note').value : '').trim();
      const r = await api.reviewSet({ platform: detail.platform, username: detail.username, decision, note });
      if (r && r.ok) {
        await reloadReviews();
        toast('Tinjauan tersimpan.', 'ok');
        closeModal();
        document.dispatchEvent(new CustomEvent('sunscrap:data-changed'));
      } else {
        toast((r && r.error) || 'Gagal menyimpan tinjauan.', 'error');
      }
    }));
    wireAvatarErrors($('#modal-root'));
  }).catch(() => toast('Gagal memuat detail akun.', 'error'));
}

async function reloadReviews() {
  try { state.reviews = await api.reviewList() || {}; } catch { state.reviews = {}; }
  await refreshAccountIntel(true);
}

export function openDeleteAccount(username, platform) {
  openModal(modalShell({
    title: 'Hapus data akun',
    body: `<p>Data akun <b>@${esc(username)}</b> (profil, riwayat bulanan, unggahan) akan dihapus. Ketik username untuk melanjutkan.</p>
      <div class="field field--flush"><label for="del-account-confirm">Ketik @${esc(username)}</label><input id="del-account-confirm" class="input" placeholder="${esc(username)}" autocomplete="off"></div>`,
    foot: `<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-danger-solid" id="confirm-del-account" disabled>Hapus</button>`,
  }));
  const check = () => { $('#confirm-del-account').disabled = $('#del-account-confirm').value.trim() !== username; };
  $('#del-account-confirm').addEventListener('input', check);
  check();
  $('#confirm-del-account').addEventListener('click', async () => {
    const r = await api.deleteAccount(platform, username);
    closeModal();
    if (r && r.ok) toast(`Data @${username} dihapus.`, 'ok'); else toast('Gagal menghapus data akun.', 'error');
    await refreshAccountIntel(true);
    document.dispatchEvent(new CustomEvent('sunscrap:data-changed'));
  });
}

/** Modal "Bagaimana skor dihitung?" */
export function showScoreHelp() {
  openModal(modalShell({
    title: 'Bagaimana skor dihitung?',
    body: `<p>Skor adalah agregasi sinyal lemah dari data <b>publik</b> (bukan identitas):</p>
      <ul>
        <li><b>+4</b> Unggahan sama muncul di akun lain</li>
        <li><b>+3</b> Kontak (nomor/email) di bio dipakai akun lain</li>
        <li><b>+2</b> Caption seragam lintas akun · jangkauan sangat rendah · komentar nyaris nol · unggahan bertumpuk · follower datar</li>
        <li><b>+1</b> Unggahan serentak · following &gt; followers</li>
      </ul>
      <p class="muted warn-notebox"><b>Disclaimer:</b> ini indikasi otomatis dari data publik — bukan identifikasi orang dan bukan vonis. Wajib verifikasi manual sebelum tindakan apa pun. Data dapat dihapus atas permintaan.</p>`,
    foot: `<button class="btn btn-ghost" data-close>Tutup</button>`,
  }));
}
