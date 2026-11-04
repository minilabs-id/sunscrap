'use strict';
/**
 * sunscraping — import
 * Parse CSV/XLSX menjadi deret target {url, platform, username, tema}.
 * Deteksi pemisah & encoding CSV (BOM / cp1252), dan sniffing header longgar.
 */

const fs = require('node:fs');
const path = require('node:path');
const util = require('./util');

const URL_HEADER_HINTS = ['link', 'url', 'tautan', 'postingan'];
const USER_HEADER_HINTS = ['username', 'user name', 'akun', 'account', 'user'];
const USER_HEADER_EXCLUDE = ['agent', 'email', 'bio'];
const TEMA_HEADER_HINTS = ['tema', 'title', 'judul', 'kategori', 'campaign'];

function cellText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    // exceljs rich text / hyperlink / date
    if (value.text !== undefined) value = value.text;
    else if (value.result !== undefined) value = value.result;
    else if (value instanceof Date) value = value.toISOString();
    else value = String(value);
  }
  const text = String(value).trim();
  if (!text || ['nan', 'none', 'null'].includes(text.toLowerCase())) return null;
  return text;
}

function pickColumn(columns, hints, exclude = []) {
  const scored = [];
  columns.forEach((column, index) => {
    const name = String(column || '').trim().toLowerCase();
    if (!name) return;
    if (exclude.some((token) => name.includes(token))) return;
    for (let rank = 0; rank < hints.length; rank++) {
      if (name.includes(hints[rank])) {
        scored.push([rank, name === hints[rank] ? 0 : 1, index]);
        break;
      }
    }
  });
  if (!scored.length) return -1;
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored[0][2];
}

function decodeBuffer(buffer) {
  // Coba UTF-8 (fatal); bila gagal, anggap windows-1252 (ekspor Excel umum).
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function sniffSeparator(text) {
  const firstLine = (text.split(/\r?\n/)[0] || '');
  let best = ',';
  let bestCount = 0;
  for (const sep of [',', ';', '\t', '|']) {
    const count = firstLine.split(sep).length - 1;
    if (count > bestCount) { best = sep; bestCount = count; }
  }
  return best;
}

/** Parser CSV sederhana yang sadar kutipan. */
function parseCsv(text, separator) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === '') continue;
    const cells = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuote = false; }
        } else cur += ch;
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === separator) {
        cells.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

function rowsFromCsv(buffer, maxRows) {
  const text = decodeBuffer(buffer);
  const separator = sniffSeparator(text);
  const raw = parseCsv(text, separator);
  if (!raw.length) return { header: [], rows: [] };
  const header = raw[0];
  let rows = raw.slice(1);
  if (rows.length > maxRows) rows = rows.slice(0, maxRows);
  return { header, rows, truncated: raw.length - 1 > maxRows };
}

async function rowsFromXlsx(filePath, maxRows) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.worksheets[0];
  if (!ws) return { header: [], rows: [] };
  const matrix = [];
  ws.eachRow((row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      values.push(cellText(cell.value));
    });
    matrix.push(values);
  });
  if (!matrix.length) return { header: [], rows: [] };
  const header = matrix[0];
  let rows = matrix.slice(1);
  const truncated = rows.length > maxRows;
  if (truncated) rows = rows.slice(0, maxRows);
  return { header, rows, truncated };
}

/**
 * Parse file menjadi { tasks, empty_rows, invalid_urls, truncated, columns, header }.
 * Tasks = [{url, platform, username, tema}]. columns = {url, username, tema} index/name.
 */
async function parseImportFile(filePath, maxRows = 10000) {
  const extension = path.extname(filePath).toLowerCase();
  let header;
  let rows;
  let truncated = false;

  if (extension === '.xlsx') {
    ({ header, rows, truncated } = await rowsFromXlsx(filePath, maxRows));
  } else {
    const buffer = fs.readFileSync(filePath);
    ({ header, rows, truncated } = rowsFromCsv(buffer, maxRows));
  }

  const urlIdx = pickColumn(header, URL_HEADER_HINTS);
  if (urlIdx < 0) return null;

  const usernameIdx = pickColumn(header, USER_HEADER_HINTS, USER_HEADER_EXCLUDE);
  const temaIdx = pickColumn(header, TEMA_HEADER_HINTS);

  const tasks = [];
  let emptyRows = 0;
  let invalidUrls = 0;

  for (const row of rows) {
    const rawUrl = row[urlIdx] !== undefined ? cellText(row[urlIdx]) : null;
    if (!rawUrl) { emptyRows++; continue; }
    const target = util.normalizeTargetUrl(rawUrl);
    if (!target) { invalidUrls++; continue; }

    let username = usernameIdx >= 0 && row[usernameIdx] !== undefined ? util.cleanUsername(cellText(row[usernameIdx])) : null;
    const urlUsername = util.usernameFromPostUrl(target.platform, target.url);
    if (urlUsername) username = urlUsername;
    let tema = temaIdx >= 0 && row[temaIdx] !== undefined ? util.cleanText(cellText(row[temaIdx]), 150) : null;

    tasks.push({ url: target.url, platform: target.platform, username, tema });
  }

  return {
    tasks, empty_rows: emptyRows, invalid_urls: invalidUrls, truncated,
    columns: {
      url: header[urlIdx] || 'Link',
      username: usernameIdx >= 0 ? (header[usernameIdx] || null) : null,
      tema: temaIdx >= 0 ? (header[temaIdx] || null) : null,
    },
  };
}

/** Parse raw text (satu link per baris) menjadi tasks + hitungan. */
function parseLinksText(text) {
  const tasks = [];
  let emptyRows = 0;
  let invalidUrls = 0;
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) { emptyRows++; continue; }
    const target = util.normalizeTargetUrl(raw);
    if (!target) { invalidUrls++; continue; }
    const username = util.usernameFromPostUrl(target.platform, target.url);
    tasks.push({ url: target.url, platform: target.platform, username, tema: null });
  }
  return { tasks, empty_rows: emptyRows, invalid_urls: invalidUrls };
}

module.exports = { parseImportFile, parseLinksText, cellText, sniffSeparator, decodeBuffer };
module.exports._hints = { URL_HEADER_HINTS, USER_HEADER_HINTS, USER_HEADER_EXCLUDE, TEMA_HEADER_HINTS };