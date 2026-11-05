'use strict';
/**
 * sunscrap — export
 * Ekspor Excel (.xlsx) per audit: sheet Data + sheet Rekap, dengan sanitasi
 * formula injection, kolom delta, dan engagement rate. Port dari app.py export.
 */

const util = require('./util');

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && !Number.isNaN(n) ? n : null;
}

function calcEr(platform, likes, comments, views, shares, followers) {
  likes = toNumber(likes) || 0;
  comments = toNumber(comments) || 0;
  views = toNumber(views) || 0;
  shares = toNumber(shares) || 0;
  followers = toNumber(followers) || 0;
  if (String(platform || '') === 'tiktok') {
    if (views <= 0) return null;
    return Math.round((((likes + comments + shares) / views) * 100) * 100) / 100;
  }
  if (followers <= 0) return null;
  return Math.round((((likes + comments) / followers) * 100) * 100) / 100;
}

function difference(current, previous) {
  const c = toNumber(current);
  const p = toNumber(previous);
  if (c === null || p === null) return null;
  return Math.round((c - p) * 100) / 100;
}

function sanitizeCell(value) {
  if (typeof value === 'string' && value.length && ['=', '+', '-', '@', '\t', '\r'].includes(value[0])) {
    return "'" + value;
  }
  return value;
}

const REVIEW_LABELS = { bookmark: 'Ditandai', clear: 'Bersih', flag: 'Dikonfirmasi' };

// Cari keputusan tinjauan manual untuk sebuah baris export (level akun → baris target).
function reviewFor(row, reviews) {
  if (!reviews || !row) return null;
  const rec = reviews[`${row.platform}:${row.username}`];
  if (!rec) return null;
  return { label: REVIEW_LABELS[rec.decision] || '', note: rec.note || '' };
}

const COLUMNS = [
  ['period', 'period'], ['audit_name', 'audit_name'], ['run_id', 'run_id'], ['platform', 'platform'],
  ['Tema', 'tema'], ['URL', 'url'], ['Username', 'username'],
  ['Followers', 'follower_count'], ['Likes', 'likes'], ['Komentar', 'comments'], ['Views', 'views'], ['Share', 'shares'],
  ['ER %', 'engagement_rate_%'],
  ['Prev Likes', 'prev_likes'], ['Prev Komentar', 'prev_comments'], ['Prev Views', 'prev_views'], ['Prev Followers', 'prev_follower_count'], ['Prev ER %', 'prev_engagement_rate_%'],
  ['Δ Likes', 'delta_likes'], ['Δ Komentar', 'delta_comments'], ['Δ Views', 'delta_views'], ['Δ Followers', 'delta_follower_count'], ['Δ ER %', 'delta_engagement_rate_%'],
  ['Tgl. Unggah', 'post_date'], ['Caption', 'caption'], ['Status', 'status'],
  ['Error', 'error_code'], ['Pesan Error', 'error_message'], ['Retry', 'retry_count'], ['Scraped', 'scraped_at'], ['Prev Scraped', 'prev_scraped_at'],
  ['Tinjauan', 'review_decision'], ['Catatan tinjauan', 'review_note'],
];

function buildDataRows(rows, reviews) {
  return rows.map((row) => {
    const engagementRate = calcEr(row.platform, row.likes, row.comments, row.views, row.shares, row.follower_count);
    const prevEngagementRate = calcEr(row.platform, row.prev_likes, row.prev_comments, row.prev_views, row.prev_shares, row.prev_follower_count);
    const review = reviewFor(row, reviews);
    const out = {
      ...row,
      'engagement_rate_%': engagementRate,
      'prev_engagement_rate_%': prevEngagementRate,
      delta_likes: difference(row.likes, row.prev_likes),
      delta_comments: difference(row.comments, row.prev_comments),
      delta_views: difference(row.views, row.prev_views),
      delta_follower_count: difference(row.follower_count, row.prev_follower_count),
      'delta_engagement_rate_%': difference(engagementRate, prevEngagementRate),
      review_decision: review ? review.label : null,
      review_note: review ? review.note : null,
    };
    return out;
  });
}

function recapRows(db, auditId) {
  const summary = db.getSummary(auditId);
  if (!summary || !summary.kpi) return [];
  const kpi = summary.kpi;
  const rows = [];
  const add = (section, label, value, note = '') => rows.push({ Bagian: section, Label: label, Nilai: value, Keterangan: note });

  const label = auditId && summary.audits.length ? summary.audits[0].name : 'Semua audit';
  add('Ringkasan', 'Audit', label);
  add('Ringkasan', 'Target', kpi.targets);
  add('Ringkasan', 'Sudah diproses', kpi.scraped);
  add('Ringkasan', 'Terverifikasi (OK + sebagian)', kpi.verified);
  add('Ringkasan', 'Tingkat keberhasilan (%)', kpi.success_rate, 'terverifikasi / sudah diproses');
  add('Ringkasan', 'Gagal', kpi.failed);
  add('Ringkasan', 'Menunggu / berjalan', kpi.pending + kpi.running);
  add('Ringkasan', 'Akun unik', kpi.accounts);
  add('Ringkasan', 'Total views', kpi.totals.views);
  add('Ringkasan', 'Total likes', kpi.totals.likes);
  add('Ringkasan', 'Total komentar', kpi.totals.comments);
  add('Ringkasan', 'Total share', kpi.totals.shares);
  add('Ringkasan', 'Data pertama', kpi.first_scraped_at || '—');
  add('Ringkasan', 'Data terakhir', kpi.last_scraped_at || '—');

  for (const p of summary.platforms) {
    add(`Platform ${p.platform}`, 'Target', p.targets);
    add(`Platform ${p.platform}`, 'Sudah diproses', p.scraped);
    add(`Platform ${p.platform}`, 'Terverifikasi', p.ok + p.partial);
    add(`Platform ${p.platform}`, 'Views', p.views);
    add(`Platform ${p.platform}`, 'Likes', p.likes);
    add(`Platform ${p.platform}`, 'Komentar', p.comments);
    add(`Platform ${p.platform}`, 'Share', p.shares);
    add(`Platform ${p.platform}`, 'Median ER (%)', p.median_er, `dari ${p.er_rows} postingan`);
  }

  for (const a of summary.accounts) {
    const handle = a.username || a.handle;
    add('Akun', '@' + handle, a.views, `${a.platform} · ${a.posts} postingan · median ER ${a.median_er !== null && a.median_er !== undefined ? a.median_er : '—'}%`);
  }

  add('Kualitas data', 'Akun tanpa followers', summary.quality.without_followers, 'ER Instagram tidak bisa dihitung untuk akun ini');
  add('Kualitas data', 'Akun sebagian terbaca (PARTIAL)', summary.quality.partial);
  add('Kualitas data', 'Akun TikTok tanpa views', summary.quality.missing_views);
  add('Kualitas data', 'Akun tanpa handle', summary.quality.missing_username);
  add('Kualitas data', 'Akun belum pernah diproses', summary.quality.never_scraped);

  add('Catatan', 'Rumus ER Instagram', '(likes + komentar) / followers × 100');
  add('Catatan', 'Rumus ER TikTok', '(likes + komentar + share) / views × 100');
  add('Catatan', 'Share', 'Hanya tersedia untuk TikTok — Instagram tidak mengekspos angka share');
  add('Catatan', 'Δ vs scrape', 'Dibanding scrape terakhir target yang sama — bisa lintas audit/periode');
  add('Catatan', 'Median, bukan rata-rata', 'Median dipakai agar satu postingan viral tidak menggeser seluruh angka');
  return rows;
}

function styleSheet(sheet, headerCount, { autofilter = false } = {}) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  header.alignment = { vertical: 'middle' };
  if (autofilter) sheet.autoFilter = { from: 1, to: headerCount, fromRow: 1, toRow: 1 };
}

/**
 * Tulis export ke filePath. Return summary {rows, filePath, audit_label}.
 * Throws bila tidak ada data.
 */
async function writeExport(db, { auditId, status, filePath, reviews }) {
  const rows = db.getExportRows(auditId, status);
  if (!rows.length) {
    throw new Error(status === 'FAILED' ? 'Belum ada snapshot gagal untuk diexport.'
      : status ? `Belum ada snapshot berstatus ${status} untuk diexport.`
      : 'Belum ada hasil untuk diexport.');
  }

  const dataRows = buildDataRows(rows, reviews);

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'sunscrap';
  workbook.created = new Date();

  const dataSheet = workbook.addWorksheet('Data');
  const headers = COLUMNS.map(([label]) => label);
  dataSheet.addRow(headers);
  for (const row of dataRows) {
    dataSheet.addRow(COLUMNS.map(([, key]) => sanitizeCell(row[key])));
  }
  styleSheet(dataSheet, COLUMNS.length, { autofilter: true });
  dataSheet.columns.forEach((col, idx) => {
    let max = headers[idx].length;
    dataSheet.getColumn(idx + 1).eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value === null || cell.value === undefined ? 0 : String(cell.value).length;
      if (len > max) max = len;
    });
    col.width = Math.min(48, Math.max(10, max + 2));
  });

  const recap = recapRows(db, auditId);
  if (recap.length) {
    const recapSheet = workbook.addWorksheet('Rekap');
    recapSheet.addRow(['Bagian', 'Label', 'Nilai', 'Keterangan']);
    for (const r of recap) recapSheet.addRow([r.Bagian, r.Label, sanitizeCell(r.Nilai), r.Keterangan]);
    styleSheet(recapSheet, 4);
    recapSheet.columns = [
      { width: 22 }, { width: 30 }, { width: 18 }, { width: 60 },
    ];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  require('node:fs').writeFileSync(filePath, Buffer.from(buffer));
  return { rows: rows.length, filePath };
}

module.exports = { writeExport, calcEr, difference, sanitizeCell, recapRows, reviewFor };