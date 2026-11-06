'use strict';
// sunscrap — dev helper: tangkap screenshot tiap tab (light + dark) untuk review UI.
// Jalankan: node scripts/screenshot.js
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(__dirname, '..', '.screens');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-shot-'));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: ['.'],
    env: { ...process.env, SA_USER_DATA: userData, SA_AUTOSTART_WORKER: '' },
  });

  let page = null;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !page) {
    const wins = app.windows();
    const hit = wins.find((w) => { try { return (w.webContents().getURL() || '').endsWith('index.html'); } catch { return false; } });
    if (hit) page = hit;
    else await new Promise((r) => setTimeout(r, 150));
  }
  if (!page) page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#kpi-grid', { timeout: 10000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1400);

  // Isi data contoh agar dashboard/tabel tidak kosong total.
  try {
    await page.click('#btn-new-audit');
    await page.waitForSelector('.modal');
    await page.fill('#new-name', 'Contoh 01');
    await page.fill('#new-links', [
      'https://www.instagram.com/aku/p/ABC123/',
      'https://www.instagram.com/budi/reel/DXwbx0QRMRz/',
      'https://www.tiktok.com/@dia/video/7123456789',
      'https://www.instagram.com/citra/p/DEF456/',
    ].join('\n'));
    await page.click('#confirm-links');
    await page.waitForTimeout(1600);
  } catch (e) { console.warn('import contoh dilewati:', e.message); }

  const tabs = ['dashboard', 'targets', 'accounts', 'proses', 'browser', 'settings'];
  for (const t of tabs) {
    await page.click(`.nav-link[data-tab="${t}"]`);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, `light-${t}.png`) });
    console.log('saved light-' + t);
  }

  // dark (paksa kelas dark murni untuk rendering, tanpa persist)
  await page.click('.nav-link[data-tab="dashboard"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'dark-dashboard.png') });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.click('.nav-link[data-tab="targets"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'dark-targets.png') });
  console.log('saved dark-dashboard + dark-targets');

  // app.close() bisa menggantung karena jendela di-hide-ke-tray (minimize-to-tray);
  // batasi dengan time-out lalu paksa keluar.
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  console.log('DONE ->', OUT);
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e && e.stack ? e.stack : e); process.exit(1); });