'use strict';
/**
 * sunscraping — monitor
 * Baca database aplikasi (read-only ringan) untuk memantau progres: antrean,
 * hasil scrape, akun terdeteksi, dan "sample" target yang sudah selesai.
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

function main() {
  const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'sunscraping', 'sunscraping.db');
  if (!fs.existsSync(dbPath)) {
    console.log('DB belum ada:', dbPath, '(aplikasi belum membuatnya?)');
    return;
  }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA query_only=ON;');

  const one = (sql) => db.prepare(sql).get();
  const cnt = (t) => (one(`SELECT COUNT(*) AS n FROM ${t}`) || {}).n || 0;

  const tasks = one("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status");
  const byStatus = one(`
    SELECT SUM(status='PENDING') p, SUM(status='RUNNING') r, SUM(status='OK') ok,
           SUM(status='PARTIAL') pa, SUM(status='FAILED') f FROM tasks`);

  console.log('=== STATUS DATABASE ===');
  console.log('audits:', cnt('audits'), '| targets:', cnt('targets'), '| tasks:', cnt('tasks'), '| snapshots:', cnt('snapshots'), '| accounts:', cnt('accounts'), '| account_posts:', cnt('account_posts'));
  console.log('tasks by status:', JSON.stringify(byStatus));

  // Sample: target yang sudah punya hasil (snapshot), paling baru
  const samples = db.prepare(`
    SELECT t.username, t.platform, t.url,
           ls.likes, ls.comments, ls.views, ls.follower_count, ls.status, ls.error_code
    FROM targets t
    LEFT JOIN (SELECT s.target_id, s.likes, s.comments, s.views, s.follower_count, s.status, s.error_code,
                      ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY s.id DESC) rn
               FROM snapshots s) ls ON ls.target_id = t.id AND ls.rn = 1
    WHERE ls.status IS NOT NULL
    ORDER BY t.id DESC LIMIT 8`).all();

  console.log('\n=== SAMPLE HASIL (terbaru) ===');
  if (!samples.length) console.log('(belum ada hasil scrape)');
  for (const s of samples) {
    console.log(`- @${s.username || '?'} [${s.platform}] likes=${s.likes} kometar=${s.comments} views=${s.views} follower=${s.follower_count} -> ${s.status}${s.error_code ? ' (' + s.error_code + ')' : ''}`);
  }

  // Akun yang sudah terukur
  const acc = db.prepare('SELECT username, platform, follower_count, fetched_at FROM accounts ORDER BY fetched_at DESC LIMIT 8').all();
  console.log('\n=== AKUN TERUKUR ===');
  if (!acc.length) console.log('(belum ada akun terukur)');
  for (const a of acc) console.log(`- @${a.username} [${a.platform}] follower=${a.follower_count} @ ${a.fetched_at}`);

  // Urutan scrape (untuk cek alternasi platform)
  const seq = db.prepare("SELECT platform FROM tasks WHERE status IN ('OK','PARTIAL','FAILED') ORDER BY scraped_at ASC").all();
  if (seq.length) {
    const s = seq.map((r) => (r.platform === 'tiktok' ? 'TT' : 'IG')).join(' ');
    console.log(`\n=== URUTAN SCRAPE (${seq.length}) ===`);
    console.log(s);
  }
  db.close();
}

try { main(); } catch (e) { console.error('monitor error:', e.message); }