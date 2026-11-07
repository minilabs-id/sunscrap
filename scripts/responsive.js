'use strict';
/**
 * sunscrap — responsive matrix
 * Impor 4 target sekali, lalu capture semua tab pada beberapa lebar jendela.
 * Output: .screens/resp-<width>-<tab>.png
 * Jalankan: node scripts/responsive.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(__dirname, '..', '.screens');
const WIDTHS = [1024, 1120, 1280, 1440, 1680, 1920];
const TABS = ['dashboard', 'targets', 'accounts', 'proses', 'browser', 'settings'];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-resp-'));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: ['.'],
    env: { ...process.env, SA_USER_DATA: userData, SA_AUTOSTART_WORKER: '' },
  });

  let page = null;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && !page) {
    const hit = app.windows().find((w) => { try { return (w.webContents().getURL() || '').endsWith('index.html'); } catch { return false; } });
    if (hit) page = hit; else await new Promise((r) => setTimeout(r, 150));
  }
  if (!page) page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#kpi-grid', { timeout: 10000 });

  // Isi data contoh
  try {
    await page.click('#btn-new-audit');
    await page.waitForSelector('.modal');
    await page.fill('#new-name', 'Responsive Uji');
    await page.fill('#new-links', [
      'https://www.instagram.com/aku/p/ABC123/',
      'https://www.instagram.com/budi/reel/DXwbx0QRMRz/',
      'https://www.tiktok.com/@dia/video/7123456789',
      'https://www.tiktok.com/@bibi/video/7123456790',
    ].join('\n'));
    await page.click('#confirm-links');
    await page.waitForTimeout(1600);
  } catch (e) { console.warn('import contoh dilewati:', e.message); }

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 860 });
    await page.waitForTimeout(350);
    for (const t of TABS) {
      await page.click(`.nav-link[data-tab="${t}"]`);
      await page.waitForTimeout(650);
      await page.screenshot({ path: path.join(OUT, `resp-${w}-${t}.png`) });
    }
    console.log('saved width', w);
  }

  const relevant = errors.filter((e) => !/net::ERR_/.test(e));
  console.log('errors:', relevant.length ? relevant : 'tidak ada');

  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
