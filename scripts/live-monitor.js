'use strict';
/**
 * sunscrap — live monitor
 * Impor data nyata (SA_IMPORT_FILE) lalu nyalakan worker dan pantau state
 * aplikasi secara live (worker, antrean, ringkasan, aktivitas) + screenshot.
 * Jalankan: node scripts/live-monitor.js <durasiDetik>
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(__dirname, '..', '.screens');
const DURATION = Number(process.argv[3]) || 90;
const IMPORT_FILE = process.argv[2] || process.env.SA_LIVE_FILE;

if (!IMPORT_FILE) {
  console.error('Gunakan: node scripts/live-monitor.js <file.xlsx|csv> [durasiDetik]');
  console.error('  atau set env SA_LIVE_FILE=<file>');
  process.exit(2);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-live-'));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: ['.'],
    env: { ...process.env, SA_USER_DATA: userData, SA_IMPORT_FILE: IMPORT_FILE, SA_AUTOSTART_WORKER: '' },
  });
  let page = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !page) {
    const hit = app.windows().find((w) => { try { return (w.webContents().getURL() || '').endsWith('index.html'); } catch { return false; } });
    if (hit) page = hit; else await new Promise((r) => setTimeout(r, 150));
  }
  if (!page) page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/SQLite|net::ERR_/.test(m.text())) errors.push(m.text()); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#kpi-grid', { timeout: 10000 });
  await page.waitForTimeout(800);

  console.log('== import', IMPORT_FILE);
  await page.click('#btn-new-audit');
  await page.waitForSelector('.modal');
  await page.fill('#new-name', 'mei-live');
  await page.click('#confirm-file'); // pakai SA_IMPORT_FILE (tanpa dialog)
  await page.waitForTimeout(5000);

  const audits = await page.$$eval('#global-audit option', (els) => els.map((e) => e.textContent));
  console.log('audits:', JSON.stringify(audits));
  await page.click('.nav-link[data-tab="targets"]');
  await page.waitForTimeout(800);
  const total = await page.$eval('#targets-total', (el) => el.textContent).catch(() => '?');
  console.log('targets:', total);
  await page.screenshot({ path: path.join(OUT, 'live-0-import.png') });

  // nyalakan worker
  console.log('== mulai worker');
  await page.click('#worker-toggle');
  await page.waitForTimeout(1500);
  const w0 = await page.evaluate(() => window.sunscrap.workerStatus());
  console.log('worker awal:', JSON.stringify({ active: w0.active, modeLabel: w0.rate?.modeLabel, paceLabel: w0.rate?.paceLabel, lastError: w0.lastError }));

  const sampleState = () => page.evaluate(async () => {
    const q = await window.sunscrap.getQueueStats();
    const s = await window.sunscrap.getSummary(null);
    const k = (s && s.kpi) || {};
    const latest = await window.sunscrap.getLatest({ limit: 5 });
    const w = await window.sunscrap.workerStatus();
    return {
      t: new Date().toISOString().slice(17, 23),
      active: w.active,
      pace: w.rate?.paceLabel || '-',
      cycle: `${w.rate?.cycleVisits || 0}/${w.rate?.visitBudget || 0}`,
      eta: w.eta || '-',
      q: { p: q.pending, r: q.running, ok: q.ok, part: q.partial, fail: q.failed },
      kpi: { scraped: k.scraped, ok: k.ok, partial: k.partial, failed: k.failed, pending: k.pending, views: (k.totals && k.totals.views) || 0 },
      latest: (latest || []).slice(0, 3).map((r) => `${r.platform === 'instagram' ? 'IG' : 'TK'}:${r.username || '?'} ${String(r.status).toLowerCase()}${r.error_code ? '(' + r.error_code + ')' : ''}`),
      lastError: w.lastError || '-',
    };
  });

  const header = ['time', 'act', 'pace', 'cycle', 'q(p/r/ok/part/fail)', 'scraped/ok/fail/pend', 'views', 'latest', 'err'];
  console.log(header.join(' | '));
  console.log('-'.repeat(150));

  const t0 = Date.now();
  let shot = 0;
  while (Date.now() - t0 < DURATION * 1000) {
    await page.waitForTimeout(7000);
    const s = await sampleState();
    console.log([s.t, s.active ? 'on' : 'off', s.pace, s.cycle,
      `${s.q.p}/${s.q.r}/${s.q.ok}/${s.q.part}/${s.q.fail}`,
      `${s.kpi.scraped}/${s.kpi.ok}/${s.kpi.failed}/${s.kpi.pending}`,
      s.kpi.views > 0 ? s.kpi.views : '0',
      s.latest.join(', ') || '-',
      s.lastError].join(' | '));
    if (shot++ % 2 === 0) {
      await page.click('.nav-link[data-tab="proses"]');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `live-${shot}-proses.png`) });
      await page.click('.nav-link[data-tab="dashboard"]');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `live-${shot}-dashboard.png`) });
    }
  }

  // berhenti worker + ringkasan akhir
  await page.evaluate(() => window.sunscrap.workerStop()).catch(() => {});
  await page.waitForTimeout(800);
  await page.click('.nav-link[data-tab="targets"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'live-final-targets.png') });
  const fin = await page.evaluate(async () => {
    const s = await window.sunscrap.getSummary(null);
    const q = await window.sunscrap.getQueueStats();
    return { kpi: s.kpi, queue: q };
  });
  console.log('\n== FINAL ==');
  console.log(JSON.stringify(fin, null, 2));
  console.log('errors:', errors.length ? errors : 'tidak ada');

  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e && e.stack ? e.stack : e); process.exit(1); });