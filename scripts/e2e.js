'use strict';
/**
 * sunscraping — e2e
 * Jalankan aplikasi Electron sungguhan dan kendarai UI-nya seperti pengguna:
 *  - import via TEMPEL LINK (textarea)
 *  - import via FILE (klik tombol "Pilih file Excel/CSV", dialog native di-stub via SA_IMPORT_FILE)
 *  - cek Target / Akun / Pengaturan.
 * File yang diuji: SA_E2E_FILE, fallback = xlsx temp digenerate sendiri.
 * Run: node scripts/e2e.js   (atau: $env:SA_E2E_FILE="C:\...\mei.xlsx"; node scripts/e2e.js)
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');

function log(...a) { console.log('[e2e]', ...a); }

async function makeTempXlsx() {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['LINK']);
  const links = [
    'https://www.instagram.com/raffi/p/CODE111/',
    'https://www.instagram.com/nagita/reel/CODE222/',
    'https://www.tiktok.com/@abdi/video/7000000001',
    'https://www.tiktok.com/@bibi/video/7000000002',
    'https://www.instagram.com/raffi/tv/CODE333/',
  ];
  for (const l of links) ws.addRow([l]);
  const file = path.join(os.tmpdir(), 'sa-e2e-file-' + Date.now() + '.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-e2e-'));
  const importFile = process.env.SA_E2E_FILE ? path.resolve(process.env.SA_E2E_FILE) : await makeTempXlsx();

  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: ['.'],
    env: {
      ...process.env,
      SA_USER_DATA: userData,
      SA_AUTOSTART_WORKER: '',
      SA_IMPORT_FILE: importFile,       // stub dialog native -> file ini
    },
  });

  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#kpi-strip', { timeout: 10000 });
  await page.waitForTimeout(1200);

  // ---- A. Import via tempel link (3 link) ----
  await page.click('#btn-new-audit');
  await page.waitForSelector('.modal');
  await page.fill('#new-name', 'Tempel E2E');
  await page.fill('#new-links', [
    'https://www.instagram.com/aku/p/ABC123/',
    'https://www.tiktok.com/@dia/video/7123456789',
    'https://www.instagram.com/budi/reel/DXwbx0QRMRz/',
  ].join('\n'));
  await page.click('#confirm-links');
  await page.waitForTimeout(1500);
  const auditsA = await page.$$eval('#global-audit option', (els) => els.map((e) => e.textContent));
  log('A. tempel link ->', JSON.stringify(auditsA));

  // ---- B. Import via FILE (tombol primary "Pilih file Excel/CSV") ----
  await page.click('#btn-new-audit');
  await page.waitForSelector('.modal');
  await page.fill('#new-name', 'File E2E');
  await page.click('#confirm-file');          // <- jalur file (di-stub ke importFile)
  await page.waitForTimeout(2000);

  const audits = await page.$$eval('#global-audit option', (els) => els.map((e) => e.textContent));
  log('B. audits setelah import file:', JSON.stringify(audits));

  // Verifikasi tab Target (jumlah = 3 tempel + N file)
  await page.click('.nav-link[data-tab="targets"]');
  await page.waitForTimeout(1000);
  const targetTotal = await page.$eval('#targets-total', (el) => el.textContent);
  const targetRows = await page.$$eval('#targets-table tbody tr', (els) => els.length);
  log('B. tab Target:', targetTotal, '| baris =', targetRows);

  // ---- C. Tab Pengaturan memuat kedua audit ----
  await page.click('.nav-link[data-tab="settings"]');
  await page.waitForTimeout(800);
  const settingsText = await page.$eval('#audits-table', (el) => el.textContent);
  log('C. settings memuat "Tempel E2E":', settingsText.includes('Tempel E2E'));
  log('C. settings memuat "File E2E":', settingsText.includes('File E2E'));

  await app.close();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  if (importFile.startsWith(os.tmpdir())) { try { fs.rmSync(importFile, { force: true }); } catch {} }

  const realErrors = errors.filter((e) => !/net::ERR_|Failed to load resource|SQLite is an experimental/i.test(e));
  log('console/page errors relevan:', realErrors.length ? JSON.stringify(realErrors) : 'tidak ada');

  const okFile = audits.some((a) => a.includes('File E2E'));
  const okTempel = audits.some((a) => a.includes('Tempel E2E')) || auditsA.some((a) => a.includes('Tempel E2E'));
  if (!okFile || !okTempel) { log('FAIL: audit tidak terbentuk'); process.exit(1); }
  if (targetRows < 5) { log('FAIL: baris target terlalu sedikit:', targetRows); process.exit(1); }
  if (realErrors.length) { log('FAIL: ada error console'); process.exit(2); }
  log('E2E OK — import file & tempel link sama-sama jalan lewat interface');
  process.exit(0);
}

main().catch((e) => { console.error('[e2e] FAIL', e && e.stack ? e.stack : e); process.exit(1); });