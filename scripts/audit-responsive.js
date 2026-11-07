'use strict';
/**
 * sunscrap — audit responsif menyeluruh
 * Di tiap lebar: cek overflow horizontal dokumen, titlebar, dan kesesuaian
 * modal/popover terhadap viewport. Setiap fitur (tab + modal + popover) diuji.
 * Keluaran: daftar pelanggaran terstruktur (proses.exit != 0 bila ada).
 * Jalankan: node scripts/audit-responsive.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');

async function main() {
  const heightArg = Number(process.argv[2]) || 720;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-audit-'));
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

  // Seed data
  try {
    await page.click('#btn-new-audit');
    await page.waitForSelector('.modal');
    await page.fill('#new-name', 'Audit Uji');
    await page.fill('#new-links', [
      'https://www.instagram.com/aku/p/ABC123/',
      'https://www.instagram.com/budi/reel/DXwbx0QRMRz/',
      'https://www.tiktok.com/@dia/video/7123456789',
      'https://www.tiktok.com/@bibi/video/7123456790',
    ].join('\n'));
    await page.click('#confirm-links');
    await page.waitForTimeout(1500);
  } catch (e) { console.warn('seed dilewati:', e.message); }

  const violations = [];

  const add = (w, area, detail) => violations.push({ width: w, area, detail });

  // Ukur overflow dokumen + titlebar + tinggi reflow
  async function measure(w) {
    return page.evaluate(() => {
      const lim = window.innerWidth;
      const tb = document.querySelector('.titlebar');
      const app = document.querySelector('.app');
      const sb = document.querySelector('.statusbar');
      return {
        innerWidth: lim,
        innerHeight: window.innerHeight,
        docScrollW: document.documentElement.scrollWidth,
        docScrollH: document.documentElement.scrollHeight,
        bodyScrollH: document.body.scrollHeight,
        titlebar: tb ? { client: tb.clientWidth, scroll: tb.scrollWidth } : null,
        layoutBottom: sb ? Math.round(sb.getBoundingClientRect().bottom) : null,
      };
    });
  }

  async function resize(w, h) {
    await app.evaluate(({ BrowserWindow }, s) => { BrowserWindow.getAllWindows()[0].setSize(s.w, s.h); }, { w, h });
    for (let i = 0; i < 30; i++) {
      const r = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      if (r.w === w && r.h === h) break;
      await new Promise((r2) => setTimeout(r2, 100));
    }
    await page.waitForTimeout(200);
  }

  // Buka modal lewat tombol, ukur kesesuaian, lalu tutup via Esc
  async function probeModal(w, label, openSel, expectVisible) {
    await page.click(openSel);
    await page.waitForTimeout(350);
    if (expectVisible && !(await page.isVisible('.modal'))) { add(w, label, 'modal tidak terbuka'); return; }
    const r = await page.evaluate(() => {
      const m = document.querySelector('#modal-root.open .modal');
      if (!m) return null;
      const body = m.querySelector('.modal-body');
      const r = m.getBoundingClientRect();
      return {
        left: Math.round(r.left), top: Math.round(r.top),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
        fitsH: r.bottom <= window.innerHeight + 1 && r.top >= -1,
        fitsW: r.right <= window.innerWidth + 1 && r.left >= -1,
        bodyScrollable: body ? body.scrollHeight > body.clientHeight + 1 : false,
        bodyOverflow: body ? getComputedStyle(body).overflowY : null,
      };
    });
    if (!r) { add(w, label, 'modal lenyap?'); return; }
    if (!r.fitsW) add(w, label, `modal melebihi lebar viewport (right=${r.right})`);
    if (!r.fitsH) add(w, label, `modal melebihi tinggi viewport (bottom=${r.bottom})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }

  for (const w of [860, 920, 1000, 1120, 1280, 1440, 1680, 1920]) {
    for (const h of [520, 640, 720, 900]) {
    await resize(w, h);
    await page.waitForTimeout(150);

    // 1) overflow global + titlebar + reflow vertikal
    const m = await measure(w);
    if (m.docScrollW > m.innerWidth + 1) add(w, `dokumen@${h}`, `scrollW=${m.docScrollW} > innerW=${m.innerWidth}`);
    if (m.docScrollH > m.innerHeight + 1) add(w, `dokumen@${h}`, `scrollH=${m.docScrollH} > innerH=${m.innerHeight} (reflow gagal)`);
    if (m.titlebar && m.titlebar.scroll > m.titlebar.client + 1) add(w, `titlebar@${h}`, `scroll=${m.titlebar.scroll} > client=${m.titlebar.client}`);

    // 2) tiap tab bebas overflow
    for (const t of ['dashboard', 'targets', 'accounts', 'proses', 'browser', 'settings']) {
      await page.click(`.nav-link[data-tab="${t}"]`);
      await page.waitForTimeout(400);
      const t2 = await measure(w);
      if (t2.docScrollW > t2.innerWidth + 1) add(w, `tab:${t}`, `scrollW=${t2.docScrollW} > innerW=${t2.innerWidth}`);
    }

    // 3) modals + popovers
    await page.click('.nav-link[data-tab="dashboard"]');
    await page.waitForTimeout(300);
    await probeModal(w, 'modal:Import', '#btn-new-audit', true);
    await page.click('.nav-link[data-tab="targets"]');
    await page.waitForTimeout(300);
    await page.click('#btn-export');
    await page.waitForTimeout(300);
    if (!(await page.isVisible('.modal'))) add(w, 'modal:Export(target)', 'tidak terbuka');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // riwayat target
    await page.click('#targets-table tbody tr[data-target]');
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const m = document.querySelector('#modal-root.open .modal');
      if (m) { const r = m.getBoundingClientRect(); if (r.bottom > window.innerHeight + 1) window.__mh = r.bottom; }
    });
    const mh = await page.evaluate(() => window.__mh || 0);
    if (mh) add(w, 'modal:Riwayat target', `tinggi melebihi viewport (bottom=${mh})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // cara skor
    await page.click('.nav-link[data-tab="accounts"]');
    await page.waitForTimeout(300);
    await probeModal(w, 'modal:Cara skor', '#score-help-btn', true);

    // edit audit + hapus semua + hapus sesi (pengaturan)
    await page.click('.nav-link[data-tab="settings"]');
    await page.waitForTimeout(400);
    await page.click('#audits-table [data-act="edit"]');
    await page.waitForTimeout(300);
    if (!(await page.isVisible('.modal'))) add(w, 'modal:Edit audit', 'tidak terbuka');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await probeModal(w, 'modal:Hapus semua', '#btn-clear', true);
    await probeModal(w, 'modal:Hapus sesi', '#btn-clear-session', true);

    // popovers
    await page.click('.nav-link[data-tab="targets"]');
    await page.waitForTimeout(300);
    await page.click('#btn-columns');
    await page.waitForTimeout(250);
    const pop = await page.evaluate(() => {
      const p = document.querySelector('#columns-pop');
      if (!p || p.hidden) return null;
      const r = p.getBoundingClientRect();
      return { right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), fits: r.right <= window.innerWidth + 1 && r.left >= -1 && r.bottom <= window.innerHeight + 1 };
    });
    if (!pop) add(w, 'popover:Kolom', 'tidak terbuka');
    else if (!pop.fits) add(w, 'popover:Kolom', `melampaui viewport (right=${pop.right})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // command palette
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(200);
    const sp = await page.evaluate(() => {
      const p = document.querySelector('#search-pop');
      if (!p || p.hidden) return null;
      const r = p.getBoundingClientRect();
      return { right: Math.round(r.right), left: Math.round(r.left), w: Math.round(r.width), fits: r.right <= window.innerWidth + 1 && r.left >= -1 };
    });
    if (!sp) add(w, 'popover:Palette', 'tidak terbuka');
    else if (!sp.fits) add(w, 'popover:Palette', `melampaui viewport (left=${sp.left}, right=${sp.right})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  }

  if (violations.length) {
    console.log('PELANGGARAN:');
    for (const v of violations) console.log(`  ${v.width}px · ${v.area} — ${v.detail}`);
  } else {
    console.log('TIDAK ADA PELANGGARAN responsif.');
  }

  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  process.exit(violations.length ? 1 : 0);
}
main().catch((e) => { console.error('FAIL', e && e.stack ? e.stack : e); process.exit(2); });