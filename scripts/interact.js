'use strict';
/**
 * sunscrap — interact
 * Uji interaksi mendalam pada profil userData SEMENTARA (sekali pakai):
 * import → tab → modal → alur destruktif (clear all, delete audit) → shortcut.
 * Setiap langkah gagal = FAIL. Error console/page dikumpulkan dan dilaporkan.
 * Jalankan: node scripts/interact.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const SHOTS = path.join(__dirname, '..', '.screens');

let step = 0;
const log = (...a) => console.log('[interact]', ...a);
const pass = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => { console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); process.exitCode = 1; };

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-interact-'));
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

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#kpi-grid', { timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 1440, height: 900 });

  const click = async (sel, name) => { await page.click(sel); pass(name); };
  const expect = async (cond, name) => { if (cond) pass(name); else fail(name); };

  // ── 1. State awal: onboarding tampil, empty state ──
  expect(await page.isVisible('#onboarding-host'), 'onboarding tampil saat kosong');

  // ── 2. Import via tempel link ──
  await page.click('#btn-new-audit');
  await page.waitForSelector('.modal');
  await page.fill('#new-name', 'Interact Uji');
  await page.fill('#new-links', [
    'https://www.instagram.com/aku/p/ABC123/',
    'https://www.instagram.com/budi/reel/DXwbx0QRMRz/',
    'https://www.tiktok.com/@dia/video/7123456789',
    'https://www.tiktok.com/@bibi/video/7123456790',
  ].join('\n'));
  await page.click('#confirm-links');
  await page.waitForTimeout(1600);
  expect((await page.$$eval('#global-audit option', (els) => els.map((e) => e.textContent))).some((t) => t.includes('Interact Uji')), 'audit "Interact Uji" muncul di picker');

  // ── 3. Command palette: buka, cari, keyboard nav, Esc ──
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(200);
  await page.fill('#global-search', 'inter');
  await page.waitForTimeout(500);
  expect(await page.isVisible('#search-pop'), 'palette terbuka saat Ctrl+K');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(!(await page.isVisible('#search-pop')), 'palette tertutup dengan Esc');

  // ── 4. Ringkasan: stackbar menampilkan total; klik "Belum diproses" → Proses ──
  const pendingNum = (await page.textContent('#att-pending-num')).trim();
  expect(pendingNum === '4', `kartu Belum diproses = 4 (dapat: ${pendingNum})`);
  await page.click('#att-pending');
  await page.waitForTimeout(600);
  expect(await page.$eval('#tab-proses', (el) => el.classList.contains('active')), 'kartu Belum diproses → pindah ke Proses');
  const queueHtml = await page.innerHTML('#queue-bar');
  expect(queueHtml.includes('q-seg'), 'Antrean di Proses terisi');

  // ── 5. Target: chip filter + sort + seleksi + pager ──
  await page.click('.nav-link[data-tab="targets"]');
  await page.waitForTimeout(800);
  await page.click('.filter-chip[data-status="pending"]');
  await page.waitForTimeout(700);
  const rowsPending = await page.$$eval('#targets-table tbody tr', (els) => els.length);
  expect(rowsPending === 4, `chip Menunggu → 4 baris (dapat: ${rowsPending})`);
  await page.click('.filter-chip[data-status=""]');
  await page.waitForTimeout(700);
  await page.click('#targets-table th.th-sort[data-sort="views"]');
  await page.waitForTimeout(700);
  pass('sort Views di-klik');
  // seleksi semua + tombol retry terpilih aktif
  await page.click('#targets-checkall');
  await page.waitForTimeout(300);
  expect(!(await page.$eval('#btn-retry-selected', (el) => el.disabled)), 'Ulangi terpilih aktif setelah centang semua');
  await page.click('#targets-checkall');
  await page.waitForTimeout(300);
  // buka riwayat target
  await page.click('#targets-table tbody tr[data-target]');
  await page.waitForTimeout(600);
  expect(await page.isVisible('.modal'), 'modal Riwayat target terbuka');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(!(await page.isVisible('.modal')), 'modal riwayat tertutup dengan Esc');

  // ── 6. Akun: mode triase + modal detail & tinjauan ──
  await page.click('.nav-link[data-tab="accounts"]');
  await page.waitForTimeout(800);
  await page.click('#score-help-btn');
  await page.waitForTimeout(400);
  expect(await page.isVisible('.modal'), 'modal Cara skor dihitung terbuka');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('#account-review-only');
  await page.waitForTimeout(600);
  expect(await page.$eval('#accounts-total', (el) => el.textContent).then((t) => t.includes('perlu tinjauan')), 'mode triase Perlu tinjauan aktif');
  await page.click('#account-review-only');
  await page.waitForTimeout(400);

  // ── 7. Pengaturan: edit audit (rename) lalu verifikasi ──
  await page.click('.nav-link[data-tab="settings"]');
  await page.waitForTimeout(800);
  await page.click('#audits-table [data-act="edit"]');
  await page.waitForTimeout(400);
  await page.fill('#edit-name', 'Interact Uji 2');
  await page.click('#confirm-edit');
  await page.waitForTimeout(1200);
  const settingsText = await page.$eval('#audits-table', (el) => el.textContent);
  expect(settingsText.includes('Interact Uji 2'), 'edit audit tersimpan (rename → Interact Uji 2)');

  // ── 8. Hapus audit via modal konfirmasi ──
  await page.click('#audits-table [data-act="delete"]');
  await page.waitForTimeout(400);
  await page.click('#confirm-del');
  await page.waitForTimeout(1200);
  const afterDelete = await page.$eval('#audits-table', (el) => el.textContent);
  expect(!afterDelete.includes('Interact Uji 2'), 'audit terhapus setelah konfirmasi');

  // ── 9. Alur destruktif: Hapus semua data (ketikan HAPUS, tanpa cadangan) ──
  await page.click('#btn-clear');
  await page.waitForTimeout(400);
  await page.click('#clear-backup'); // jangan cadangkan (dialog native) — profil sekali pakai
  await page.fill('#clear-confirm', 'HAPUS');
  await page.click('#confirm-clear');
  await page.waitForTimeout(1500);
  const dashSub = await page.textContent('#dash-sub');
  await page.click('.nav-link[data-tab="dashboard"]');
  await page.waitForTimeout(800);
  const dashSubAfter = await page.textContent('#dash-sub');
  expect(/0 target/.test(dashSubAfter), `setelah hapus semua → 0 target (dapat: ${dashSubAfter.trim()})`);
  expect(await page.$eval('#nav-targets-count', (el) => el.hidden), 'badge Target tersembunyi setelah hapus semua');
  void dashSub;

  // ── 10. Tema toggle ──
  const wasDark = await page.$eval('html', (el) => el.classList.contains('dark'));
  await page.click('#btn-theme-toggle');
  await page.waitForTimeout(200);
  const isDark = await page.$eval('html', (el) => el.classList.contains('dark'));
  expect(wasDark !== isDark, 'toggle tema bekerja');

  // ── 11. Pintasan G+5 (Sesi) ──
  await page.keyboard.press('g');
  await page.keyboard.press('5');
  await page.waitForTimeout(400);
  expect(await page.$eval('#tab-browser', (el) => el.classList.contains('active')), 'G 5 → Sesi & Login');

  // ── 12. Screenshot penutup ──
  await page.click('.nav-link[data-tab="dashboard"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'interact-final.png') });
  pass('screenshot interact-final.png');

  // ── Ringkasan error ──
  const relevant = errors.filter((e) => !/net::ERR_|Failed to load resource|SQLite is an experimental|GCM|gpu/i.test(e));
  if (relevant.length) { console.error('[interact] error relevan:', relevant); process.exitCode = 2; }
  else log('tidak ada error console/page');

  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  log(process.exitCode ? 'SELESAI DENGAN KEGAGALAN' : 'SEMUA INTERAKSI OK');
  process.exit(process.exitCode || 0);
}
main().catch((e) => { console.error('[interact] FAIL', e && e.stack ? e.stack : e); process.exit(1); });
