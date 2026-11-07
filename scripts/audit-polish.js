'use strict';
/**
 * sunscrap — audit kerapian (polish) runtime
 * Cek: nama aksesibel kontrol, teks terpotong tanpa ellipsis, alignment tombol
 * (tinggi seragam per baris), chrome overflow, dan kartu kosong.
 * Jalankan: node scripts/audit-polish.js [width]
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');

async function main() {
  const targetW = Number(process.argv[2]) || 1440;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-polish-'));
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

  // seed
  try {
    await page.click('#btn-new-audit');
    await page.waitForSelector('.modal');
    await page.fill('#new-name', 'Polish Uji');
    await page.fill('#new-links', 'https://www.instagram.com/aku/p/ABC123/\nhttps://www.tiktok.com/@dia/video/7123456789');
    await page.click('#confirm-links');
    await page.waitForTimeout(1200);
  } catch {}

  const findings = [];
  const add = (cat, detail) => findings.push({ cat, detail });

  const scan = () => page.evaluate(() => {
    const out = { noName: [], clipped: [], misalign: [], overflow: [], emptyCard: [] };
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; };
    const name = (el) => {
      const a = el.getAttribute('aria-label');
      if (a && a.trim()) return a;
      const t = el.getAttribute('title');
      if (t && t.trim()) return t;
      const lab = document.querySelector(`label[for="${el.id}"]`);
      if (lab && lab.textContent.trim()) return lab.textContent.trim();
      const txt = (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
      return txt;
    };
    const sel = (s) => { const e = document.querySelector(s); return e; };
    document.querySelectorAll('button, input, select, textarea, [role="button"], [tabindex="0"]').forEach((el) => {
      if (el.type === 'hidden' || !visible(el)) return;
      if (el.closest('svg')) return;
      const cls = (el.className && typeof el.className === 'string') ? el.className : '';
      if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return; // punya label/aria-label di tempat lain
      const nm = name(el);
      if (!nm || !nm.replace(/[^A-Za-z0-9]/g, '')) {
        const id = el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + cls.split(' ')[0];
        out.noName.push(id);
      }
    });
    // teks terpotong tanpa ellipsis
    document.querySelectorAll('.btn, .card-title, .page-sub, .card-sub, .field > label, .nav-link, th, td').forEach((el) => {
      if (!visible(el) || !el.textContent.trim()) return;
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') return; // disengaja
      if (el.scrollWidth > el.clientWidth + 2 && cs.whiteSpace !== 'normal' && cs.whiteSpace !== 'pre-wrap') {
        out.clipped.push(el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
      }
    });
    // alignment tombol per baris
    document.querySelectorAll('.page-actions, .toolbar-actions, .card-hd, .row-gap, .browser-bar').forEach((group) => {
      const btns = Array.from(group.querySelectorAll('button.btn, button.attention-item, button.iconbtn')).filter(visible);
      const hs = Array.from(new Set(btns.map((b) => b.offsetHeight)));
      if (hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 2) {
        out.misalign.push(`[${group.className}] tinggi ${hs.join('px / ')}px`);
      }
    });
    // chrome overflow
    ['.titlebar', '.statusbar', '.sidebar', '.toolbar', '.page-head', '.card-hd', '.browser-bar'].forEach((s) => {
      const e = document.querySelector(s);
      if (e && e.scrollWidth > e.clientWidth + 1) out.overflow.push(s + ' (' + e.scrollWidth + '>' + e.clientWidth + ')');
    });
    // kartu kosong
    document.querySelectorAll('.card').forEach((card) => {
      const body = card.querySelector('.card-hd') ? card : null;
      if (card.textContent.trim() === '') out.emptyCard.push(card.className);
    });
    return out;
  });

  for (const t of ['dashboard', 'targets', 'accounts', 'proses', 'settings', 'browser']) {
    await page.click(`.nav-link[data-tab="${t}"]`);
    await page.waitForTimeout(500);
    const r = await scan();
    for (const x of r.noName) add(`nama-aksesibel@${t}`, x);
    for (const x of r.clipped) add(`teks-terpotong@${t}`, x);
    for (const x of r.misalign) add(`alignment@${t}`, x);
    for (const x of r.overflow) add(`overflow@${t}`, x);
    for (const x of r.emptyCard) add(`kartu-kosong@${t}`, x);
  }

  if (findings.length) {
    console.log('Temuan kerapian (' + targetW + 'px):');
    for (const f of findings) console.log(`  [${f.cat}] ${f.detail}`);
  } else {
    console.log('TIDAK ADA temuan kerapian @' + targetW + 'px.');
  }

  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  process.exit(findings.length ? 1 : 0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(2); });