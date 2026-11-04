'use strict';
/**
 * sunscraping — e2e
 * Jalankan aplikasi Electron sungguhan dan kendarai UI-nya seperti pengguna:
 * buka dashboard → buka modal → tutup (Esc) → import link → lihat target/akun/setting.
 * Tidak menyentuh file dialog native; import lewat jalur "tempel link".
 * Run: node scripts/e2e.js
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const LINKS = [
  'https://www.instagram.com/aku/p/ABC123/',
  'https://www.tiktok.com/@dia/video/7123456789',
  'https://www.instagram.com/budi/reel/DXwbx0QRMRz/',
].join('\n');

function log(...a) { console.log('[e2e]', ...a); }

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-e2e-'));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: ['.'],
    env: { ...process.env, SA_USER_DATA: userData, CSC_IDENTITY_AUTO_DISCOVERY: 'false', SA_AUTOSTART_WORKER: '' },
  });

  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#kpi-strip', { timeout: 10000 });
  await page.waitForTimeout(1200); // biarkan load awal selesai

  // 1. Dashboard render
  const kpi0 = (await page.$eval('#kpi-strip', (el) => el.textContent)).replace(/\s+/g, ' ').trim();
  log('KPI awal:', kpi0);

  // 2. Buka modal import
  await page.click('#btn-new-audit');
  await page.waitForSelector('.modal', { timeout: 5000 });
  log('modal import terbuka OK');

  // 3. Tutup via Escape (regresi F-01)
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
  log('tutup modal via Esc OK');

  // 4. Buka lagi + import link
  await page.click('#btn-new-audit');
  await page.fill('#new-name', 'Uji E2E');
  await page.fill('#new-links', LINKS);
  await page.click('#confirm-links');
  await page.waitForTimeout(1500);

  const audits = await page.$$eval('#global-audit option', (els) => els.map((e) => e.textContent));
  log('audits setelah import:', JSON.stringify(audits));

  const kpi1 = (await page.$eval('#kpi-strip', (el) => el.textContent)).replace(/\s+/g, ' ').trim();
  log('KPI setelah import:', kpi1);

  // 5. Tab Target
  await page.click('.nav-link[data-tab="targets"]');
  await page.waitForTimeout(900);
  const targetRows = await page.$$eval('#targets-table tbody tr', (els) => els.length);
  const targetTotal = await page.$eval('#targets-total', (el) => el.textContent);
  log('tab Target: baris =', targetRows, '|', targetTotal);

  // 6. Tab Akun (belum ada data akun — hanya pastikan tidak error)
  await page.click('.nav-link[data-tab="accounts"]');
  await page.waitForTimeout(700);
  await page.waitForSelector('#accounts-table', { timeout: 5000 });
  log('tab Akun dimuat OK');

  // 7. Tab Pengaturan
  await page.click('.nav-link[data-tab="settings"]');
  await page.waitForTimeout(700);
  const settingsHasAudit = await page.$eval('#audits-table', (el) => el.textContent.includes('Uji E2E'));
  log('tab Pengaturan berisi "Uji E2E":', settingsHasAudit);

  await app.close();

  // Bersihkan data tes
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}

  const realErrors = errors.filter((e) => !/net::ERR_|Failed to load resource|SQLite is an experimental/i.test(e));
  log('console/page errors relevan:', realErrors.length ? JSON.stringify(realErrors) : 'tidak ada');

  if (!settingsHasAudit || targetRows < 3) {
    log('FAIL: hasil tidak sesuai');
    process.exit(1);
  }
  if (realErrors.length) {
    log('FAIL: ada error console');
    process.exit(2);
  }
  log('E2E OK - semua langkah seperti pengguna berhasil');
  process.exit(0);
}

main().catch((e) => { console.error('[e2e] FAIL', e && e.stack ? e.stack : e); process.exit(1); });