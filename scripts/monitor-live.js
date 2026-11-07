'use strict';
/**
 * sunscrap — monitor-live
 * Pantau INSTANSI YANG SUDAH BERJALAN via file log/state di userData
 * (activity.jsonl + worker-state.json). Tidak meluncurkan instance baru.
 * Jalankan: node scripts/monitor-live.js [durasiDetik]
 */
const fs = require('node:fs');
const path = require('node:path');

const userData = process.env.SA_USER_DATA || path.join(process.env.APPDATA, 'sunscrap');
const activity = path.join(userData, 'activity.jsonl');
const stateFile = path.join(userData, 'worker-state.json');
const DURATION = Math.max(5, Number(process.argv[2]) || 40);

function parse(line) { try { return JSON.parse(line); } catch { return null; } }

function summary() {
  const raw = fs.readFileSync(activity, 'utf8').split('\n').filter(Boolean).map(parse).filter(Boolean);
  const tasks = raw.filter((e) => e.type === 'task');
  const byStatus = {};
  const byCode = {};
  const byPlatform = {};
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPlatform[t.platform] = (byPlatform[t.platform] || 0) + 1;
    if (t.errorCode) byCode[t.errorCode] = (byCode[t.errorCode] || 0) + 1;
  }
  const st = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  return { total: tasks.length, byStatus, byCode, byPlatform, state: st };
}

function fmt(s) {
  const { total, byStatus, byCode, byPlatform, state } = s;
  return `task=${total} | OK=${byStatus.OK || 0} PARTIAL=${byStatus.PARTIAL || 0} FAILED=${byStatus.FAILED || 0} | IG=${byPlatform.instagram || 0} TK=${byPlatform.tiktok || 0} | err=${Object.entries(byCode).map(([k, v]) => `${k}:${v}`).join(',') || '-'} | sesi=${state.sa_sessionTaskCount || 0}/${state.sa_sessionBreakThreshold || '?'} sik=${state.sa_cycleVisits || 0} harian=${state.sa_dailyTaskCount || 0} backoff=x${state.sa_backoffMultiplier || 1}`;
}

async function main() {
  if (!fs.existsSync(activity)) { console.log('activity.jsonl belum ada (worker belum pernah jalan).'); return; }
  let raw = fs.readFileSync(activity, 'utf8');
  let count = raw.split('\n').filter(Boolean).length;
  console.log('== SNAPSHOT (sebelum pantau) ==');
  console.log(fmt(summary()));

  console.log('== LIVE (delta tiap 5 detik) ==');
  const t0 = Date.now();
  while (Date.now() - t0 < DURATION * 1000) {
    await new Promise((r) => setTimeout(r, 5000));
    raw = fs.readFileSync(activity, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const newLines = lines.slice(count);
    count = lines.length;
    for (const line of newLines) {
      const e = parse(line);
      if (!e) continue;
      if (e.type === 'start') console.log(`  ⏵ ${e.t.slice(11, 19)} worker MULAI`);
      else if (e.type === 'stop') console.log(`  ⏹ ${e.t.slice(11, 19)} worker BERHENTI${e.reason ? ' — ' + e.reason : ''}`);
      else if (e.type === 'task') console.log(`  ▪ ${e.t.slice(11, 19)} ${e.platform === 'instagram' ? 'IG' : 'TK'}:${e.username || '?'} → ${e.status}${e.errorCode ? '(' + e.errorCode + ')' : ''} ${e.ms}ms`);
    }
    if (!newLines.length) console.log('  … (tidak ada kejadian baru)');
  }

  console.log('== AKHIR (agregat) ==');
  console.log(fmt(summary()));
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });