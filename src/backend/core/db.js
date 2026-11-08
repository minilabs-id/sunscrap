'use strict';
/**
 * sunscrap — db
 * Lapisan data SQLite via node:sqlite bawaan Electron (tanpa modul native).
 * Port dari backend/database.py. Satu koneksi sinkron per instance; proses utama
 * adalah single-threaded sehingga aman.
 *
 * Konvensi waktu (sama dengan backend lama):
 *  - scraped_at / fetched_at : ISO 8601 + Z
 *  - created_at / last_run_at / claimed_at / locked_until : "YYYY-MM-DD HH:MM:SS" UTC
 */

const path = require('node:path');
const fs = require('node:fs');
const sqliteModule = require('node:sqlite');
// Node 24 merename DatabaseSync -> Database; pakai nama baru bila tersedia.
const DatabaseSync = sqliteModule.Database || sqliteModule.DatabaseSync;
const util = require('./util');
const intel = require('./intel');

const TASK_LOCK_MINUTES = 5;
const CACHE_TTL_MINUTES = 7 * 24 * 60;
const POST_CACHE_TTL_MINUTES = 12 * 60;
const MAX_RETRIES = 3;
const MAX_PROFILE_POSTS = 10;
const VISIT_BUDGET_PER_CYCLE = 500;
const SCHEMA_VERSION = 5;
const ERROR_CODES = ['PERMANENT', 'TRANSIENT', 'THROTTLED', 'AUTH'];

const { cleanText, cleanUsername, cleanInt, isoNow, sqlNow, parseUtc, parseRepeatDays, clampLimit, cleanPeriod } = util;

function createDatabase(dbPath) {
  let conn = new DatabaseSync(dbPath);
  conn.exec('PRAGMA journal_mode=WAL');
  conn.exec('PRAGMA busy_timeout=30000');
  conn.exec('PRAGMA foreign_keys=ON');

  // ---- helper ----
  function norm(...args) {
    return args.map((a) => (a === undefined ? null : a));
  }
  function escapeLike(value) {
    // Escape wildcard LIKE (SQLite ESCAPE '\') — input user tidak boleh jadi wildcard tak terduga.
    return String(value).replace(/[\\%_]/g, (m) => '\\' + m);
  }
  function all(sql, ...args) {
    return conn.prepare(sql).all(...norm(...args));
  }
  function one(sql, ...args) {
    return conn.prepare(sql).get(...norm(...args));
  }
  function run(sql, ...args) {
    return conn.prepare(sql).run(...norm(...args));
  }
  function exec(sql) {
    conn.exec(sql);
  }
  function plain(row) {
    return row ? { ...row } : row;
  }

  // ---- schema ----
  function initSchema() {
    exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        platform TEXT,
        username TEXT,
        tema TEXT,
        status TEXT DEFAULT 'PENDING',
        kind TEXT DEFAULT 'POST',
        likes INTEGER, comments INTEGER, views INTEGER, shares INTEGER, follower_count INTEGER,
        post_date TEXT, caption TEXT,
        error_message TEXT, error_code TEXT, scraped_at TEXT,
        claimed_at TEXT, locked_until TEXT, retry_count INTEGER DEFAULT 0,
        audit_id INTEGER, run_id INTEGER, target_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source_filename TEXT,
        repeat_days INTEGER DEFAULT 0,
        period TEXT, received_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_run_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id INTEGER NOT NULL,
        trigger TEXT DEFAULT 'upload',
        status TEXT DEFAULT 'RUNNING',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id INTEGER NOT NULL,
        platform TEXT NOT NULL,
        url TEXT NOT NULL,
        username TEXT, tema TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_scraped_at TEXT, last_status TEXT, last_error TEXT,
        UNIQUE(audit_id, url)
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_id INTEGER NOT NULL,
        run_id INTEGER NOT NULL,
        task_id INTEGER,
        scraped_at TEXT, status TEXT, error_code TEXT, error_message TEXT,
        likes INTEGER, comments INTEGER, views INTEGER, shares INTEGER, follower_count INTEGER,
        post_date TEXT, caption TEXT
      );
      CREATE TABLE IF NOT EXISTS accounts (
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        follower_count INTEGER, fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
        account_id TEXT, external_id TEXT, display_name TEXT, bio TEXT, region TEXT,
        following_count INTEGER, post_count INTEGER, is_verified INTEGER,
        last_visit_at TEXT, needs_visit INTEGER DEFAULT 1, avatar_url TEXT,
        PRIMARY KEY (platform, username)
      );
      CREATE TABLE IF NOT EXISTS account_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        post_ref TEXT NOT NULL,
        post_url TEXT, posted_at TEXT,
        likes INTEGER, comments INTEGER, shares INTEGER, views INTEGER,
        caption TEXT, is_video INTEGER, fetched_at TEXT,
        UNIQUE(platform, username, post_ref)
      );
      CREATE TABLE IF NOT EXISTS account_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        month TEXT NOT NULL,
        follower_count INTEGER, following_count INTEGER, post_count INTEGER,
        first_seen_at TEXT, last_seen_at TEXT, visits INTEGER DEFAULT 0,
        UNIQUE (platform, username, month)
      );
    `);

    exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
    exec('CREATE INDEX IF NOT EXISTS idx_tasks_status_platform ON tasks(status, platform)');
    exec('CREATE INDEX IF NOT EXISTS idx_tasks_target ON tasks(target_id, id)');
    exec('CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks(run_id, status)');
    exec('CREATE INDEX IF NOT EXISTS idx_tasks_audit ON tasks(audit_id, status)');
    exec('CREATE INDEX IF NOT EXISTS idx_targets_audit ON targets(audit_id)');
    exec('CREATE INDEX IF NOT EXISTS idx_runs_audit ON runs(audit_id, id)');
    exec('CREATE INDEX IF NOT EXISTS idx_snapshots_target ON snapshots(target_id, id)');
    exec('CREATE INDEX IF NOT EXISTS idx_snapshots_run ON snapshots(run_id)');
    exec('CREATE INDEX IF NOT EXISTS idx_account_posts_account ON account_posts(platform, username, posted_at)');
    exec('CREATE INDEX IF NOT EXISTS idx_account_posts_ref ON account_posts(post_ref)');
    exec('CREATE INDEX IF NOT EXISTS idx_account_posts_url ON account_posts(post_url)');
    exec('CREATE INDEX IF NOT EXISTS idx_account_history_account ON account_history(platform, username, month)');
    exec('CREATE INDEX IF NOT EXISTS idx_account_history_month ON account_history(month)');
    exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    // Migrasi inkremental untuk DB yang sudah ada (CREATE TABLE IF NOT EXISTS tidak menambah kolom).
    const acctCols = new Set(conn.prepare('PRAGMA table_info(accounts)').all().map((r) => r.name));
    if (!acctCols.has('avatar_url')) {
      exec('ALTER TABLE accounts ADD COLUMN avatar_url TEXT');
    }
  }

  // ---- infer error code ----
  function inferErrorCode(status, message, explicit) {
    let code = cleanText(explicit, 24);
    if (code) {
      code = code.toUpperCase();
      if (ERROR_CODES.includes(code)) return code;
    }
    if (status !== 'FAILED') return null;
    const text = (message || '').toLowerCase();
    if (/(login|session|auth|kedaluwarsa)/.test(text)) return 'AUTH';
    if (/(too many requests|rate limit|throttl|429|try again later|coba lagi nanti|temporarily blocked)/.test(text)) return 'THROTTLED';
    if (/(private|tidak tersedia|not available|deleted|tidak ditemukan)/.test(text)) return 'PERMANENT';
    return 'TRANSIENT';
  }

  // ---- internal run/target/snapshot helpers ----
  function insertRun(auditId, trigger, status = 'RUNNING') {
    const info = run('INSERT INTO runs (audit_id, trigger, status, created_at) VALUES (?, ?, ?, ?)',
      auditId, trigger, status, sqlNow());
    return info.lastInsertRowid;
  }

  function insertTask(auditId, runId, target, kind = 'POST') {
    run('INSERT INTO tasks (url, platform, username, tema, audit_id, run_id, target_id, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      target.url, target.platform, target.username, target.tema, auditId, runId, target.id, kind);
  }

  function insertTarget(auditId, task, seen) {
    const url = cleanText(task.url, 2048);
    const platform = cleanText(task.platform, 32);
    if (!url || !['instagram', 'tiktok'].includes(platform)) return { outcome: 'invalid', row: null };
    if (seen.has(url)) return { outcome: 'duplicate', row: null };
    seen.add(url);
    const row = {
      url, platform,
      username: cleanText(task.username, 100),
      tema: cleanText(task.tema, 150),
    };
    const info = run(
      'INSERT OR IGNORE INTO targets (audit_id, platform, url, username, tema, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      auditId, row.platform, row.url, row.username, row.tema, sqlNow(),
    );
    if (info.changes === 0) return { outcome: 'duplicate', row: null };
    row.id = info.lastInsertRowid;
    return { outcome: 'inserted', row };
  }

  function recordSnapshot(targetId, runId, taskId, status, errorCode, errorMessage,
    likes, comments, views, shares, followerCount, postDate, caption, scrapedAt) {
    if (!targetId || !runId) return;
    run(
      `INSERT INTO snapshots (target_id, run_id, task_id, scraped_at, status, error_code, error_message,
        likes, comments, views, shares, follower_count, post_date, caption)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      targetId, runId, taskId, scrapedAt, status, errorCode, errorMessage,
      likes, comments, views, shares, followerCount, postDate, caption,
    );
    run('UPDATE targets SET last_scraped_at = ?, last_status = ?, last_error = ? WHERE id = ?',
      scrapedAt, status, errorMessage, targetId);
  }

  function finalizeRun(runId) {
    if (!runId) return;
    const row = one(`SELECT COUNT(*) AS n FROM tasks WHERE run_id = ? AND status IN ('PENDING','RUNNING')`, runId);
    if (row && row.n === 0) {
      run("UPDATE runs SET status = 'DONE', finished_at = COALESCE(finished_at, ?) WHERE id = ? AND status <> 'DONE'",
        sqlNow(), runId);
    }
  }

  function reclaimExpired() {
    const expired = all(`SELECT * FROM tasks WHERE status = 'RUNNING' AND locked_until IS NOT NULL AND locked_until < CURRENT_TIMESTAMP`);
    for (const task of expired) {
      const nextRetry = (task.retry_count || 0) + 1;
      if (nextRetry >= MAX_RETRIES) {
        run(`UPDATE tasks SET retry_count = ?, status = 'FAILED', error_code = 'TRANSIENT',
          error_message = ?, claimed_at = NULL, locked_until = NULL WHERE id = ?`,
        nextRetry, 'Worker tidak melapor 3x; task dihentikan', task.id);
        recordSnapshot(task.target_id, task.run_id, task.id, 'FAILED', 'TRANSIENT',
          'Worker tidak melapor 3x; task dihentikan', null, null, null, null, null, null, null, isoNow());
      } else {
        run(`UPDATE tasks SET retry_count = ?, status = 'PENDING', error_code = 'TRANSIENT',
          error_message = 'Worker tidak melapor; task dikembalikan ke antrean',
          claimed_at = NULL, locked_until = NULL WHERE id = ?`, nextRetry, task.id);
      }
    }
    for (const runId of new Set(expired.map((t) => t.run_id).filter(Boolean))) finalizeRun(runId);
  }

  function autoEnqueueDue(limit = 5) {
    const due = all('SELECT id, repeat_days, last_run_at, created_at FROM audits WHERE repeat_days > 0');
    const now = new Date();
    let createdTotal = 0;
    for (const audit of due) {
      if (createdTotal >= limit) break;
      const base = parseUtc(audit.last_run_at || audit.created_at);
      if (!base) continue;
      if (base.getTime() + audit.repeat_days * 86400000 > now.getTime()) continue;
      const pending = one(`SELECT COUNT(*) AS n FROM tasks WHERE audit_id = ? AND status IN ('PENDING','RUNNING')`, audit.id);
      if (pending && pending.n > 0) continue;
      const [, created] = createRun(audit.id, 'schedule', true);
      createdTotal += created;
    }
    return createdTotal;
  }

  function createRun(auditId, trigger, full = false) {
    const runId = insertRun(auditId, trigger);
    const verifiedFilter = full ? '' : `
      AND NOT EXISTS (
        SELECT 1 FROM tasks v
        WHERE v.target_id = t.id AND v.audit_id = t.audit_id
          AND v.status IN ('OK','PARTIAL')
          AND (v.likes IS NOT NULL OR v.views IS NOT NULL OR v.comments IS NOT NULL)
          AND v.id = (SELECT MAX(v2.id) FROM tasks v2 WHERE v2.target_id = v.target_id)
      )`;
    const targets = all(
      `SELECT id, platform, url, username, tema FROM targets t WHERE audit_id = ?${verifiedFilter} ORDER BY id ASC`,
      auditId,
    );
    for (const target of targets) insertTask(auditId, runId, target);
    run('UPDATE audits SET last_run_at = ? WHERE id = ?', sqlNow(), auditId);
    if (!targets.length) {
      run("UPDATE runs SET status = 'DONE', finished_at = ? WHERE id = ?", sqlNow(), runId);
    }
    return [runId, targets.length];
  }

  function countTargets(auditId) {
    const row = one('SELECT COUNT(*) AS n FROM targets WHERE audit_id = ?', auditId);
    return row ? row.n : 0;
  }

  function recordAccountMonth(platform, username, capturedAt, followerCount, followingCount, postCount) {
    const month = capturedAt ? capturedAt.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const stamp = capturedAt || isoNow();
    run(`
      INSERT INTO account_history (platform, username, month, follower_count, following_count, post_count, first_seen_at, last_seen_at, visits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(platform, username, month) DO UPDATE SET
        follower_count = COALESCE(excluded.follower_count, account_history.follower_count),
        following_count = COALESCE(excluded.following_count, account_history.following_count),
        post_count = COALESCE(excluded.post_count, account_history.post_count),
        first_seen_at = COALESCE(account_history.first_seen_at, excluded.first_seen_at),
        last_seen_at = MAX(account_history.last_seen_at, excluded.last_seen_at),
        visits = account_history.visits + 1
    `, platform, username, month, followerCount, followingCount, postCount, stamp, stamp);
  }

  initSchema();

  // =====================================================================
  // AUDIT / TARGET / TASK (write)
  // =====================================================================
  function createAuditWithTasks(tasksList, opts = {}) {
    if (!tasksList || !tasksList.length) {
      return { audit_id: null, run_id: null, inserted: 0, duplicates: 0 };
    }
    let name = cleanText(opts.name, 120) || `Audit ${new Date().toLocaleString('id-ID')}`;
    const repeatDays = parseRepeatDays(opts.repeatDays) || 0;
    const period = cleanPeriod(opts.period) || new Date().toISOString().slice(0, 7);

    exec('BEGIN IMMEDIATE');
    try {
      const info = run(
        'INSERT INTO audits (name, source_filename, repeat_days, created_at, last_run_at, period, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        name, cleanText(opts.sourceFilename, 200), repeatDays, sqlNow(), sqlNow(), period, sqlNow(),
      );
      const auditId = info.lastInsertRowid;
      const runId = insertRun(auditId, 'upload');

      let inserted = 0;
      let duplicates = 0;
      const seen = new Set();
      for (const task of tasksList) {
        const { outcome, row } = insertTarget(auditId, task, seen);
        if (outcome === 'invalid') continue;
        if (outcome === 'duplicate') { duplicates++; continue; }
        insertTask(auditId, runId, row);
        inserted++;
      }
      exec('COMMIT');
      markIntelDirty();
      return { audit_id: auditId, run_id: runId, inserted, duplicates };
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  function appendTargetsToAudit(auditId, tasksList, opts = {}) {
    if (!tasksList || !tasksList.length) throw new Error('no rows');
    exec('BEGIN IMMEDIATE');
    try {
      const audit = one('SELECT id, name FROM audits WHERE id = ?', auditId);
      if (!audit) { exec('ROLLBACK'); return null; }

      let inserted = 0;
      let duplicates = 0;
      const seen = new Set();
      const pending = [];
      for (const task of tasksList) {
        const { outcome, row } = insertTarget(auditId, task, seen);
        if (outcome === 'invalid') continue;
        if (outcome === 'duplicate') { duplicates++; continue; }
        pending.push(row);
        inserted++;
      }

      let runId = null;
      if (pending.length) {
        runId = insertRun(auditId, 'append');
        for (const row of pending) insertTask(auditId, runId, row);
        run('UPDATE audits SET last_run_at = ?, source_filename = COALESCE(?, source_filename) WHERE id = ?',
          sqlNow(), cleanText(opts.sourceFilename, 200), auditId);
      }
      exec('COMMIT');
      markIntelDirty();
      return { audit_id: auditId, audit_name: audit.name, run_id: runId, inserted, duplicates };
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  function enqueueRun(auditId, trigger = 'manual', full = false) {
    exec('BEGIN IMMEDIATE');
    try {
      if (!one('SELECT id FROM audits WHERE id = ?', auditId)) { exec('ROLLBACK'); return null; }
      const pending = one(`SELECT COUNT(*) AS n FROM tasks WHERE audit_id = ? AND status IN ('PENDING','RUNNING')`, auditId);
      if (pending.n > 0) { exec('COMMIT'); return { run_id: null, created: 0, pending: true }; }
      if (countTargets(auditId) === 0) { exec('COMMIT'); return { run_id: null, created: 0, empty: true }; }

      const [runId, created] = createRun(auditId, trigger, full);
      exec('COMMIT');
      return {
        run_id: runId, created,
        skipped_verified: full ? 0 : Math.max(0, countTargets(auditId) - created),
        full: Boolean(full), pending: false, empty: false,
      };
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  function retryTargets(auditId, targetIds) {
    const ids = [];
    for (const v of (targetIds || [])) {
      const n = Number(v);
      if (Number.isFinite(n) && !ids.includes(n)) ids.push(n);
    }
    const capped = ids.slice(0, 200);
    if (!capped.length) {
      return { audit_id: auditId, created: 0, run_id: null, skipped_running: 0, missing: 0 };
    }

    exec('BEGIN IMMEDIATE');
    try {
      const audit = one('SELECT id, name FROM audits WHERE id = ?', auditId);
      if (!audit) { exec('ROLLBACK'); return null; }

      const ph = capped.map(() => '?').join(',');
      const rows = all(
        `SELECT t.id, t.url, t.platform, t.username, t.tema FROM targets t WHERE t.audit_id = ? AND t.id IN (${ph}) ORDER BY t.id ASC`,
        auditId, ...capped,
      );
      const found = new Set(rows.map((r) => r.id));
      const runningRows = all(
        `SELECT DISTINCT target_id FROM tasks WHERE audit_id = ? AND status IN ('PENDING','RUNNING') AND target_id IN (${ph})`,
        auditId, ...capped,
      );
      const running = new Set(runningRows.map((r) => r.target_id));

      const targets = rows.filter((r) => !running.has(r.id));
      let runId = null;
      if (targets.length) {
        runId = insertRun(auditId, 'retry-selected');
        for (const t of targets) insertTask(auditId, runId, t);
        run('UPDATE audits SET last_run_at = ? WHERE id = ?', sqlNow(), auditId);
      }
      exec('COMMIT');
      return {
        audit_id: auditId, audit_name: audit.name, run_id: runId,
        created: targets.length, skipped_running: running.size, missing: capped.length - found.size,
      };
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  function retryFailedTargets(auditId) {
    exec('BEGIN IMMEDIATE');
    try {
      const audit = one('SELECT id, name FROM audits WHERE id = ?', auditId);
      if (!audit) { exec('ROLLBACK'); return null; }

      const failed = all(`
        WITH latest AS (
          SELECT tk.target_id, tk.status, tk.error_code,
                 ROW_NUMBER() OVER (PARTITION BY tk.target_id ORDER BY tk.id DESC) AS rn
          FROM tasks tk WHERE tk.audit_id = ?
        )
        SELECT t.id, t.url, t.platform, t.username, t.tema, l.error_code AS last_error_code
        FROM targets t JOIN latest l ON l.target_id = t.id AND l.rn = 1
        WHERE t.audit_id = ? AND l.status = 'FAILED'
          AND NOT EXISTS (
            SELECT 1 FROM tasks x WHERE x.target_id = t.id AND x.status IN ('PENDING','RUNNING')
          )
        ORDER BY t.id ASC`, auditId, auditId);
      const targets = failed.filter((r) => r.last_error_code !== 'PERMANENT');
      const skippedPermanent = failed.length - targets.length;

      let runId = null;
      if (targets.length) {
        runId = insertRun(auditId, 'retry');
        for (const t of targets) insertTask(auditId, runId, t);
        run('UPDATE audits SET last_run_at = ? WHERE id = ?', sqlNow(), auditId);
      }
      exec('COMMIT');
      return {
        audit_id: auditId, audit_name: audit.name, run_id: runId,
        created: targets.length, skipped_permanent: skippedPermanent,
      };
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  function enqueueProfileVisits(auditId, onlyMissing = true) {
    exec('BEGIN IMMEDIATE');
    try {
      if (!one('SELECT id FROM audits WHERE id = ?', auditId)) { exec('ROLLBACK'); return null; }
      run('UPDATE accounts SET needs_visit = 1 WHERE follower_count IS NULL AND post_count IS NULL');

      const waiting = one(`SELECT COUNT(*) AS n FROM tasks WHERE audit_id = ? AND status IN ('PENDING','RUNNING') AND kind = 'PROFILE'`, auditId);
      if (waiting.n) { exec('COMMIT'); return { audit_id: auditId, run_id: null, created: 0, pending: true }; }

      const condition = onlyMissing ? `AND (a.username IS NULL OR a.needs_visit = 1 OR a.follower_count IS NULL)` : '';
      const candidates = all(`
        SELECT DISTINCT t.platform, t.username
        FROM targets t LEFT JOIN accounts a ON a.platform = t.platform AND a.username = t.username
        WHERE t.audit_id = ? AND t.username IS NOT NULL AND t.username <> '' ${condition}
        ORDER BY t.id ASC`, auditId);
      if (!candidates.length) { exec('COMMIT'); return { audit_id: auditId, run_id: null, created: 0, empty: true }; }

      const runId = insertRun(auditId, 'profile');
      for (const row of candidates) {
        const url = row.platform === 'instagram'
          ? `https://www.instagram.com/${row.username}/`
          : `https://www.tiktok.com/@${row.username}`;
        run("INSERT INTO tasks (url, platform, username, tema, audit_id, run_id, kind) VALUES (?, ?, ?, NULL, ?, ?, 'PROFILE')",
          url, row.platform, row.username, auditId, runId);
      }
      run('UPDATE audits SET last_run_at = ? WHERE id = ?', sqlNow(), auditId);
      finalizeRun(runId);
      exec('COMMIT');
      return { audit_id: auditId, run_id: runId, created: candidates.length };
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  function updateAudit(auditId, patch = {}) {
    if (!one('SELECT id FROM audits WHERE id = ?', auditId)) return null;
    exec('BEGIN IMMEDIATE');
    try {
      if (patch.name !== undefined) {
        const nm = cleanText(patch.name, 120);
        if (nm) run('UPDATE audits SET name = ? WHERE id = ?', nm, auditId);
      }
      if (patch.repeat_days !== undefined) {
        const c = parseRepeatDays(patch.repeat_days);
        run('UPDATE audits SET repeat_days = ? WHERE id = ?', c === null ? 0 : c, auditId);
      }
      if (patch.period !== undefined) {
        const p = cleanPeriod(patch.period);
        if (p) run('UPDATE audits SET period = ? WHERE id = ?', p, auditId);
      }
      exec('COMMIT');
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
    return getAudit(auditId);
  }

  function deleteAudit(auditId) {
    exec('BEGIN IMMEDIATE');
    try {
      if (!one('SELECT id FROM audits WHERE id = ?', auditId)) { exec('ROLLBACK'); return false; }
      run('DELETE FROM snapshots WHERE target_id IN (SELECT id FROM targets WHERE audit_id = ?)', auditId);
      run('DELETE FROM tasks WHERE audit_id = ?', auditId);
      run('DELETE FROM targets WHERE audit_id = ?', auditId);
      run('DELETE FROM runs WHERE audit_id = ?', auditId);
      run('DELETE FROM audits WHERE id = ?', auditId);
      exec('COMMIT');
      markIntelDirty();
      return true;
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  // Hapus data satu akun (privasi / hak hapus): accounts + posts + history.
  function deleteAccount(platform, username) {
    const handle = cleanUsername(username);
    if (!handle || !['instagram', 'tiktok'].includes(platform)) return false;
    exec('BEGIN IMMEDIATE');
    try {
      run('DELETE FROM account_posts WHERE platform = ? AND username = ?', platform, handle);
      run('DELETE FROM account_history WHERE platform = ? AND username = ?', platform, handle);
      run('DELETE FROM accounts WHERE platform = ? AND username = ?', platform, handle);
      exec('COMMIT');
      markIntelDirty();
      return true;
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  function clearAll() {
    exec('BEGIN IMMEDIATE');
    try {
      for (const t of ['snapshots', 'tasks', 'targets', 'runs', 'audits', 'accounts', 'account_posts', 'account_history']) {
        run(`DELETE FROM ${t}`);
      }
      try { run('DELETE FROM sqlite_sequence'); } catch {}
      exec('COMMIT');
      markIntelDirty();
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  // =====================================================================
  // TASK CLAIM / RESULT
  // =====================================================================
  function getNextTask(preferPlatform) {
    exec('BEGIN IMMEDIATE');
    try {
      reclaimExpired();

      const pick = () => {
        const profile = one(`SELECT * FROM tasks WHERE status = 'PENDING' AND kind = 'PROFILE' ORDER BY id ASC LIMIT 1`);
        if (profile) return profile;
        if (preferPlatform === 'instagram' || preferPlatform === 'tiktok') {
          const found = one(`SELECT * FROM tasks WHERE status = 'PENDING' AND platform = ? ORDER BY id ASC LIMIT 1`, preferPlatform);
          if (found) return found;
        }
        return one(`SELECT * FROM tasks WHERE status = 'PENDING' ORDER BY id ASC LIMIT 1`);
      };

      let task = pick();
      if (!task) {
        finalizeStaleRuns();
        autoEnqueueDue();
        task = pick();
      }
      if (task) {
        run(`UPDATE tasks SET status = 'RUNNING', claimed_at = CURRENT_TIMESTAMP,
             locked_until = datetime('now', ?) WHERE id = ?`,
          `+${TASK_LOCK_MINUTES} minutes`, task.id);
        exec('COMMIT');
        return plain(task);
      }
      exec('COMMIT');
      return null;
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  function finalizeStaleRuns() {
    const rows = all("SELECT id FROM runs WHERE status <> 'DONE' AND finished_at IS NULL");
    for (const row of rows) finalizeRun(row.id);
  }

  function updateTaskResult(taskId, result) {
    if (!Number.isFinite(Number(taskId))) return false;
    taskId = Number(taskId);
    if (!result || typeof result !== 'object') return false;

    exec('BEGIN IMMEDIATE');
    try {
      const row = one(`SELECT id, status, retry_count, audit_id, run_id, target_id, platform, url, kind FROM tasks WHERE id = ?`, taskId);
      if (!row) { exec('ROLLBACK'); return false; }
      if (row.status !== 'RUNNING') { exec('ROLLBACK'); return false; }

      const kind = (row.kind || 'POST').toUpperCase();

      if (kind === 'PROFILE') {
        const profileStatus = String(result.status || 'OK').toUpperCase() === 'FAILED' ? 'FAILED' : 'OK';
        const profileError = cleanText(result.error, 500);
        const settledAt = isoNow();
        run(`UPDATE tasks SET status = ?, error_message = ?, error_code = ?, scraped_at = ?, claimed_at = NULL, locked_until = NULL WHERE id = ?`,
          profileStatus, profileError, inferErrorCode(profileStatus, profileError, result.errorCode), settledAt, taskId);
        finalizeRun(row.run_id);
        exec('COMMIT');
        return true;
      }

      let status = String(result.status || 'OK').toUpperCase();
      if (!['OK', 'PARTIAL', 'FAILED'].includes(status)) status = 'FAILED';

      const platform = cleanText(result.platform, 32) || row.platform;
      let errorMessage = cleanText(result.error, 500);
      let errorCode = inferErrorCode(status, errorMessage, result.errorCode);

      let retryCount = row.retry_count || 0;
      if (status === 'FAILED' && errorCode === 'TRANSIENT') {
        retryCount++;
        if (retryCount < MAX_RETRIES) status = 'PENDING';
      }

      const username = cleanUsername(result.username);
      const likes = cleanInt(result.likes);
      const comments = cleanInt(result.comments);
      const views = cleanInt(result.views);
      const shares = cleanInt(result.shares);
      const followerCount = cleanInt(result.followerCount);
      const postDate = cleanText(result.postDate, 32);
      const caption = cleanText(result.caption, 500);
      const scrapedAt = isoNow();

      // Halaman tanpa metrik apa pun bukan post selesai.
      if (status === 'OK' && [likes, comments, views, shares].every((v) => v === null)) {
        status = 'PARTIAL';
        errorCode = null;
        if (!errorMessage) errorMessage = 'Tidak ada metrik yang terbaca dari halaman; pastikan link mengarah ke postingan.';
      }

      run(`UPDATE tasks SET
        status = ?, platform = COALESCE(?, platform), username = COALESCE(?, username),
        likes = COALESCE(?, likes), comments = COALESCE(?, comments), views = COALESCE(?, views),
        shares = COALESCE(?, shares), follower_count = COALESCE(?, follower_count),
        post_date = COALESCE(?, post_date), caption = COALESCE(?, caption),
        error_message = ?, error_code = ?, scraped_at = ?, claimed_at = NULL, locked_until = NULL, retry_count = ?
        WHERE id = ?`,
        status, platform, username, likes, comments, views, shares, followerCount, postDate, caption,
        errorMessage, errorCode, scrapedAt, retryCount, taskId);

      if (['OK', 'PARTIAL', 'FAILED'].includes(status)) {
        recordSnapshot(row.target_id, row.run_id, taskId, status, errorCode, errorMessage,
          likes, comments, views, shares, followerCount, postDate, caption, scrapedAt);
      }

      if (username && row.target_id) {
        run('UPDATE targets SET username = ? WHERE id = ?', username, row.target_id);
      }

      if (username && followerCount !== null) {
        const cachePlatform = platform || 'unknown';
        run(`INSERT INTO accounts (platform, username, follower_count, fetched_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(platform, username) DO UPDATE SET follower_count = excluded.follower_count, fetched_at = excluded.fetched_at`,
          cachePlatform, username, followerCount, scrapedAt);
        recordAccountMonth(cachePlatform, username, scrapedAt, followerCount);
      }

      finalizeRun(row.run_id);
      exec('COMMIT');
      markIntelDirty();
      return true;
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  // =====================================================================
  // ACCOUNT PROFILE
  // =====================================================================
  const PROFILE_ACCOUNT_FIELDS = [
    ['account_id', 'accountId', 64],
    ['external_id', 'externalId', 128],
    ['display_name', 'displayName', 120],
    ['bio', 'bio', 300],
    ['region', 'region', 16],
  ];

  function recordAccountProfile(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const platform = cleanText(payload.platform, 32);
    if (!['instagram', 'tiktok'].includes(platform)) return null;
    const username = cleanUsername(payload.username);
    if (!username) return null;

    const verified = payload.isVerified;
    const account = {
      follower_count: cleanInt(payload.followerCount),
      following_count: cleanInt(payload.followingCount),
      post_count: cleanInt(payload.postCount),
      avatar_url: cleanText(payload.avatarUrl, 500),
      is_verified: verified === null || verified === undefined ? null : (verified ? 1 : 0),
    };
    for (const [column, key, size] of PROFILE_ACCOUNT_FIELDS) {
      account[column] = cleanText(payload[key], size);
    }

    const fetchedAt = isoNow();
    let posts = Array.isArray(payload.posts) ? payload.posts : [];
    const measured = posts.length > 0 || account.bio !== null;
    const needsVisit = measured ? 0 : 1;

    exec('BEGIN IMMEDIATE');
    try {
      run(`INSERT INTO accounts (platform, username, follower_count, fetched_at, account_id, external_id,
            display_name, bio, region, following_count, post_count, is_verified, needs_visit, last_visit_at, avatar_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, username) DO UPDATE SET
          follower_count = COALESCE(excluded.follower_count, accounts.follower_count),
          following_count = COALESCE(excluded.following_count, accounts.following_count),
          post_count = COALESCE(excluded.post_count, accounts.post_count),
          account_id = COALESCE(excluded.account_id, accounts.account_id),
          external_id = COALESCE(excluded.external_id, accounts.external_id),
          display_name = COALESCE(excluded.display_name, accounts.display_name),
          bio = COALESCE(excluded.bio, accounts.bio),
          region = COALESCE(excluded.region, accounts.region),
          avatar_url = COALESCE(excluded.avatar_url, accounts.avatar_url),
          is_verified = COALESCE(excluded.is_verified, accounts.is_verified),
          fetched_at = excluded.fetched_at,
          needs_visit = MIN(accounts.needs_visit, excluded.needs_visit),
          last_visit_at = excluded.last_visit_at`,
        platform, username, account.follower_count, fetchedAt, account.account_id, account.external_id,
        account.display_name, account.bio, account.region, account.following_count, account.post_count,
        account.is_verified, needsVisit, fetchedAt, account.avatar_url);

      recordAccountMonth(platform, username, fetchedAt, account.follower_count, account.following_count, account.post_count);

      let stored = 0;
      for (const post of posts.slice(0, MAX_PROFILE_POSTS)) {
        if (!post || typeof post !== 'object') continue;
        const url = cleanText(post.url, 300);
        const ref = cleanText(post.id, 64) || cleanText(post.ref, 64) || util.postRefFromUrl(url);
        if (!ref) continue;
        const isVideo = post.isVideo;
        run(`INSERT INTO account_posts (platform, username, post_ref, post_url, posted_at, likes, comments, shares, views, caption, is_video, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(platform, username, post_ref) DO UPDATE SET
            post_url = COALESCE(excluded.post_url, account_posts.post_url),
            posted_at = COALESCE(excluded.posted_at, account_posts.posted_at),
            likes = COALESCE(excluded.likes, account_posts.likes),
            comments = COALESCE(excluded.comments, account_posts.comments),
            shares = COALESCE(excluded.shares, account_posts.shares),
            views = COALESCE(excluded.views, account_posts.views),
            caption = COALESCE(excluded.caption, account_posts.caption),
            is_video = COALESCE(excluded.is_video, account_posts.is_video),
            fetched_at = excluded.fetched_at`,
          platform, username, ref, url, cleanText(post.postedAt || post.timestamp, 40),
          cleanInt(post.likes), cleanInt(post.comments), cleanInt(post.shares), cleanInt(post.views),
          cleanText(post.caption, 500), isVideo === null || isVideo === undefined ? null : (isVideo ? 1 : 0), fetchedAt);
        stored++;
      }
      exec('COMMIT');
      markIntelDirty();
      return {
        platform, username, posts_seen: posts.length, posts_stored: stored,
        truncated: posts.length > MAX_PROFILE_POSTS, fetched_at: fetchedAt,
      };
    } catch (e) {
      exec('ROLLBACK');
      throw e;
    }
  }

  function getAccountCache(username, platform, maxAgeMinutes = CACHE_TTL_MINUTES) {
    const handle = cleanUsername(username);
    if (!handle) return null;
    const row = platform
      ? one('SELECT follower_count, fetched_at FROM accounts WHERE username = ? AND platform = ?', handle, platform)
      : one('SELECT follower_count, fetched_at FROM accounts WHERE username = ? ORDER BY fetched_at DESC LIMIT 1', handle);
    if (!row) return null;
    if (row.fetched_at && maxAgeMinutes !== null) {
      const parsed = parseUtc(row.fetched_at);
      if (parsed && (Date.now() - parsed.getTime()) > maxAgeMinutes * 60000) return null;
    }
    return row.follower_count;
  }

  function getCachedPostMetrics(url, platform, maxAgeMinutes = POST_CACHE_TTL_MINUTES) {
    const ref = util.postRefFromUrl(url);
    if (!ref) return null;
    const row = platform
      ? one(`SELECT p.*, a.follower_count FROM account_posts p
             LEFT JOIN accounts a ON a.platform = p.platform AND a.username = p.username
             WHERE p.post_ref = ? AND p.platform = ? ORDER BY p.fetched_at DESC LIMIT 1`, ref, platform)
      : one(`SELECT p.*, a.follower_count FROM account_posts p
             LEFT JOIN accounts a ON a.platform = p.platform AND a.username = p.username
             WHERE p.post_ref = ? ORDER BY p.fetched_at DESC LIMIT 1`, ref);
    if (!row) return null;
    if (row.fetched_at && maxAgeMinutes !== null) {
      const parsed = parseUtc(row.fetched_at);
      if (parsed && (Date.now() - parsed.getTime()) > maxAgeMinutes * 60000) return null;
    }
    const metrics = { likes: row.likes, comments: row.comments, views: row.views, shares: row.shares };
    if (Object.values(metrics).every((v) => v === null)) return null;
    return {
      url: row.post_url || url,
      username: row.username,
      platform: row.platform,
      fetchedAt: row.fetched_at,
      followerCount: row.follower_count,
      ...metrics,
      caption: row.caption,
      postDate: row.posted_at,
    };
  }

  // =====================================================================
  // QUERIES (read)
  // =====================================================================
  function auditRowToDict(row, cachedTargets = 0) {
    const data = { ...row };
    const repeatDays = Number(data.repeat_days || 0);
    const base = parseUtc(data.last_run_at || data.created_at);
    data.next_due_at = (repeatDays > 0 && base)
      ? new Date(base.getTime() + repeatDays * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z')
      : null;
    const targets = Number(data.target_count || 0);
    const accounts = Number(data.account_count || 0);
    const cached = Number(cachedTargets || 0);
    data.cached_targets = cached;
    data.visit_estimate = accounts + Math.max(0, targets - cached);
    data.visit_budget = VISIT_BUDGET_PER_CYCLE;
    data.over_budget = data.visit_estimate > VISIT_BUDGET_PER_CYCLE;
    return plain(data);
  }

  let cachedCountsMemo = { gen: -1, maxAge: POST_CACHE_TTL_MINUTES, value: {} };
  function cachedTargetCounts(maxAgeMinutes = POST_CACHE_TTL_MINUTES) {
    if (cachedCountsMemo.gen === intelGen && cachedCountsMemo.maxAge === maxAgeMinutes && cachedCountsMemo.value) {
      return cachedCountsMemo.value;
    }
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rows = all(`
      SELECT t.audit_id AS audit_id, COUNT(*) AS cached_count
      FROM targets t
      WHERE EXISTS (
        SELECT 1 FROM account_posts p
        WHERE p.fetched_at > ?
          AND (p.post_url = t.url OR p.post_url = rtrim(t.url, '/')
               OR substr(t.url, 1, instr(t.url || '?', '?') - 1) = p.post_url)
      )
      GROUP BY t.audit_id`, cutoff);
    const value = Object.fromEntries(rows.map((r) => [r.audit_id, r.cached_count]));
    cachedCountsMemo = { gen: intelGen, maxAge: maxAgeMinutes, value };
    return value;
  }

  function getAudits() {
    const rows = all(`
      SELECT a.*,
        (SELECT COUNT(*) FROM targets t WHERE t.audit_id = a.id) AS target_count,
        (SELECT COUNT(DISTINCT t.username) FROM targets t WHERE t.audit_id = a.id AND t.username IS NOT NULL AND t.username <> '') AS account_count,
        (SELECT COUNT(*) FROM tasks tk WHERE tk.audit_id = a.id AND tk.status = 'PENDING') AS pending_count,
        (SELECT COUNT(*) FROM tasks tk WHERE tk.audit_id = a.id AND tk.status = 'RUNNING') AS running_count,
        (SELECT status FROM runs r WHERE r.audit_id = a.id ORDER BY r.id DESC LIMIT 1) AS latest_run_status
      FROM audits a
      ORDER BY COALESCE(a.period, '') DESC, a.created_at DESC, a.id DESC`);
    const cached = cachedTargetCounts();
    return rows.map((r) => auditRowToDict(r, cached[r.id] || 0));
  }

  function getAudit(auditId) {
    const id = Number(auditId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const row = one(`
      SELECT a.*,
        (SELECT COUNT(*) FROM targets t WHERE t.audit_id = a.id) AS target_count,
        (SELECT COUNT(DISTINCT t.username) FROM targets t WHERE t.audit_id = a.id AND t.username IS NOT NULL AND t.username <> '') AS account_count,
        (SELECT COUNT(*) FROM tasks tk WHERE tk.audit_id = a.id AND tk.status = 'PENDING') AS pending_count,
        (SELECT COUNT(*) FROM tasks tk WHERE tk.audit_id = a.id AND tk.status = 'RUNNING') AS running_count,
        (SELECT status FROM runs r WHERE r.audit_id = a.id ORDER BY r.id DESC LIMIT 1) AS latest_run_status
      FROM audits a WHERE a.id = ?`, id);
    if (!row) return null;
    const cached = cachedTargetCounts();
    return auditRowToDict(row, cached[id] || 0);
  }

  function getQueueStats() {
    // Hitung ringan untuk loop worker & tab Proses; tanpa reclaim, tanpa window function.
    const row = one(`SELECT
      SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='RUNNING' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status='OK' THEN 1 ELSE 0 END) AS ok,
      SUM(CASE WHEN status='PARTIAL' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed
    FROM tasks`);
    return {
      pending: row.pending || 0, running: row.running || 0,
      ok: row.ok || 0, partial: row.partial || 0, failed: row.failed || 0,
    };
  }

  function getDashboardStats(auditId) {
    reclaimExpired();
    const where = auditId ? 'WHERE t.audit_id = ?' : '';
    const params = auditId ? [Number(auditId)] : [];
    const rows = all(`
      WITH latest_tasks AS (
        SELECT tk.target_id, tk.status,
               ROW_NUMBER() OVER (PARTITION BY tk.target_id ORDER BY tk.id DESC) AS rn
        FROM tasks tk JOIN targets t ON t.id = tk.target_id ${where}
      )
      SELECT status, COUNT(*) AS n FROM latest_tasks WHERE rn = 1 GROUP BY status`, ...params);

    const targetWhere = auditId ? 'WHERE audit_id = ?' : '';
    const targetCount = one(`SELECT COUNT(*) AS n FROM targets ${targetWhere}`, ...params).n;
    const snapshotCount = one(`
      SELECT COUNT(*) AS n FROM snapshots s JOIN targets t ON t.id = s.target_id
      ${auditId ? 'WHERE t.audit_id = ?' : ''}`, ...params).n;

    const stats = { TOTAL: 0, PENDING: 0, RUNNING: 0, OK: 0, PARTIAL: 0, FAILED: 0, TARGETS: targetCount, SNAPSHOTS: snapshotCount };
    for (const row of rows) {
      const status = row.status || 'PENDING';
      stats[status] = (stats[status] || 0) + row.n;
      stats.TOTAL += row.n;
    }
    return stats;
  }

  function getTargets(params = {}) {
    const limit = clampLimit(params.limit, 1, 200, 50);
    const offRaw = Number(params.offset);
    const offset = Number.isFinite(offRaw) && offRaw > 0 ? Math.floor(offRaw) : 0;
    const base = `
      WITH latest_tasks AS (
        SELECT tk.id, tk.target_id, tk.status, tk.error_code, tk.error_message, tk.retry_count, tk.claimed_at, tk.scraped_at,
               ROW_NUMBER() OVER (PARTITION BY tk.target_id ORDER BY tk.id DESC) AS rn
        FROM tasks tk WHERE tk.target_id IS NOT NULL
      ),
      latest_snapshots AS (
        SELECT s.id, s.target_id, s.likes, s.comments, s.views, s.shares, s.follower_count, s.scraped_at, s.post_date, s.caption,
               ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY s.id DESC) AS rn
        FROM snapshots s
      ),
      prev_snapshots AS (
        SELECT s.target_id, s.likes, s.comments, s.views, s.shares, s.follower_count, s.scraped_at,
               ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY s.id DESC) AS rn
        FROM snapshots s
      )`;

    const conditions = ['1 = 1'];
    const cparams = [];
    if (params.auditId !== undefined && params.auditId !== null && params.auditId !== '') {
      const aid = Number(params.auditId);
      if (!Number.isFinite(aid)) return { items: [], total: 0, limit, offset };
      conditions.push('t.audit_id = ?'); cparams.push(aid);
    }
    if (params.platform === 'instagram' || params.platform === 'tiktok') { conditions.push('t.platform = ?'); cparams.push(params.platform); }
    if (params.status) {
      const s = String(params.status).toLowerCase();
      if (s === 'done') conditions.push("COALESCE(lt.status, 'PENDING') IN ('OK','PARTIAL')");
      else if (s === 'ok') { conditions.push("COALESCE(lt.status, 'PENDING') = 'OK'"); }
      else if (s === 'partial') { conditions.push("COALESCE(lt.status, 'PENDING') = 'PARTIAL'"); }
      else if (['failed', 'pending', 'running'].includes(s)) { conditions.push("COALESCE(lt.status, 'PENDING') = ?"); cparams.push(s.toUpperCase()); }
    }
    if (params.q) {
      const needle = String(params.q).trim();
      if (needle) {
        const like = '%' + escapeLike(needle) + '%';
        conditions.push("(t.username LIKE ? ESCAPE '\\' OR t.url LIKE ? ESCAPE '\\' OR COALESCE(t.tema, '') LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\')");
        cparams.push(like, like, like, like);
      }
    }
    const issue = params.issue;
    if (issue === 'no_followers') conditions.push('ls.id IS NOT NULL AND ls.follower_count IS NULL');
    else if (issue === 'no_views') conditions.push('ls.id IS NOT NULL AND ls.views IS NULL');
    else if (issue === 'partial') conditions.push("COALESCE(lt.status, 'PENDING') = 'PARTIAL'");
    else if (issue === 'failed') conditions.push("COALESCE(lt.status, 'PENDING') = 'FAILED'");
    const where = 'WHERE ' + conditions.join(' AND ');

    const orderMap = {
      followers: 'COALESCE(ls.follower_count, acct.follower_count, -1)',
      likes: 'COALESCE(ls.likes, -1)',
      comments: 'COALESCE(ls.comments, -1)',
      views: 'COALESCE(ls.views, -1)',
      delta_likes: 'COALESCE(ls.likes - ps.likes, -999999999)',
      delta_views: 'COALESCE(ls.views - ps.views, -999999999)',
      recent: 'COALESCE(lt.id, 0)',
    };
    const dir = String(params.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let order;
    if (params.sort === 'er') {
      order = `CASE WHEN engagement_rate IS NULL THEN 1 ELSE 0 END ASC, engagement_rate ${dir}, t.id DESC`;
    } else if (params.sort === 'username') {
      order = `LOWER(COALESCE(t.username, '')) ${dir}, t.id ASC`;
    } else {
      order = `${orderMap[params.sort] || orderMap.recent} ${dir}, t.id DESC`;
    }

    const totalRow = one(`${base}
      SELECT COUNT(*) AS n FROM targets t
      JOIN audits a ON a.id = t.audit_id
      LEFT JOIN latest_tasks lt ON lt.target_id = t.id AND lt.rn = 1
      LEFT JOIN latest_snapshots ls ON ls.target_id = t.id AND ls.rn = 1
      ${where}`, ...cparams);

    const rows = all(`${base}
      SELECT t.id AS target_id, t.audit_id, a.name AS audit_name, t.platform, t.url, t.username, t.tema, t.created_at,
        lt.id AS task_id, COALESCE(lt.status, 'PENDING') AS status, lt.error_code, lt.error_message,
        COALESCE(lt.retry_count, 0) AS retry_count, lt.claimed_at, lt.scraped_at AS task_scraped_at,
        ls.likes, ls.comments, ls.views, ls.shares, COALESCE(ls.follower_count, acct.follower_count) AS follower_count, ls.scraped_at AS snapshot_at, ls.post_date, ls.caption,
        ps.likes AS prev_likes, ps.comments AS prev_comments, ps.views AS prev_views, ps.scraped_at AS prev_scraped_at,
        CASE WHEN ps.likes IS NOT NULL AND ls.likes IS NOT NULL THEN ls.likes - ps.likes ELSE NULL END AS delta_likes,
        CASE WHEN ps.views IS NOT NULL AND ls.views IS NOT NULL THEN ls.views - ps.views ELSE NULL END AS delta_views,
        CASE
          WHEN t.platform = 'tiktok' AND COALESCE(ls.views, 0) > 0
            THEN (COALESCE(ls.likes,0)+COALESCE(ls.comments,0)+COALESCE(ls.shares,0)) * 100.0 / ls.views
          WHEN t.platform = 'instagram' AND COALESCE(ls.follower_count, acct.follower_count, 0) > 0
            THEN (COALESCE(ls.likes,0)+COALESCE(ls.comments,0)) * 100.0 / COALESCE(ls.follower_count, acct.follower_count)
          ELSE NULL
        END AS engagement_rate
      FROM targets t
      JOIN audits a ON a.id = t.audit_id
      LEFT JOIN latest_tasks lt ON lt.target_id = t.id AND lt.rn = 1
      LEFT JOIN latest_snapshots ls ON ls.target_id = t.id AND ls.rn = 1
      LEFT JOIN prev_snapshots ps ON ps.target_id = t.id AND ps.rn = 2
      LEFT JOIN accounts acct ON acct.platform = t.platform AND acct.username = t.username
      ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...cparams, limit, offset);

    const items = rows.map((r) => {
      const item = { ...r };
      if (item.engagement_rate !== null && item.engagement_rate !== undefined) {
        item.engagement_rate = Math.round(item.engagement_rate * 100) / 100;
      }
      return item;
    });
    return { items, total: totalRow.n, limit, offset };
  }

  function getLatest(limit = 10, auditId) {
    const l = clampLimit(limit, 1, 50, 10);
    const conditions = ['s.attempt_rn = 1'];
    const params = [];
    if (auditId !== undefined && auditId !== null && auditId !== '') {
      const aid = Number(auditId);
      if (!Number.isFinite(aid)) return [];
      conditions.push('t.audit_id = ?'); params.push(aid);
    }
    const where = 'WHERE ' + conditions.join(' AND ');
    const rows = all(`
      WITH attempts AS (
        SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.target_id, s.run_id ORDER BY s.id DESC) AS attempt_rn
        FROM snapshots s
      ),
      ordered AS (
        SELECT s.id, s.target_id, s.run_id, s.scraped_at, s.status, s.error_code, s.error_message,
               s.likes, s.comments, s.views, s.shares, s.follower_count, s.post_date, s.caption,
               t.platform, t.username, t.tema, t.url, t.audit_id, a.name AS audit_name,
               LAG(s.likes) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_likes,
               LAG(s.comments) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_comments,
               LAG(s.views) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_views,
               LAG(s.shares) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_shares,
               LAG(s.follower_count) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_follower_count,
               LAG(s.scraped_at) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_scraped_at
        FROM attempts s
        JOIN targets t ON t.id = s.target_id
        JOIN audits a ON a.id = t.audit_id
        ${where}
      ),
      ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY id DESC) AS rn FROM ordered)
      SELECT * FROM ranked WHERE rn = 1 ORDER BY id DESC LIMIT ?`, ...params, l);
    return rows.map((r) => { const o = { ...r }; delete o.rn; return o; });
  }

  function getTargetHistory(targetId, limit = 50) {
    const tid = Number(targetId);
    if (!Number.isFinite(tid)) return [];
    const l = clampLimit(limit, 1, 200, 50);
    const rows = all(`
      WITH attempts AS (
        SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.target_id, s.run_id ORDER BY s.id DESC) AS attempt_rn
        FROM snapshots s WHERE s.target_id = ?
      )
      SELECT id, target_id, run_id, task_id, scraped_at, status, error_code, error_message,
             likes, comments, views, shares, follower_count, post_date, caption
      FROM attempts WHERE attempt_rn = 1 ORDER BY id DESC LIMIT ?`, tid, l);
    return rows.map(plain);
  }

  function getTargetWithAudit(targetId) {
    const row = one('SELECT t.*, a.name AS audit_name FROM targets t JOIN audits a ON a.id = t.audit_id WHERE t.id = ?', Number(targetId));
    return plain(row);
  }

  // ---- ER ----
  function summaryEr(platform, likes, comments, views, shares, followers) {
    likes = likes || 0; comments = comments || 0; views = views || 0; shares = shares || 0; followers = followers || 0;
    if (platform === 'tiktok') {
      if (views <= 0) return null;
      return Math.round((((likes + comments + shares) / views) * 100) * 100) / 100;
    }
    if (followers <= 0) return null;
    return Math.round((((likes + comments) / followers) * 100) * 100) / 100;
  }

  function recapMedian(values) {
    const nums = (values || []).filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    const result = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    return Math.round(result * 100) / 100;
  }

  let summaryMemo = { gen: -1, key: null, value: null };
  function getSummary(auditId) {
    const idNum = auditId === null || auditId === undefined ? null : Number(auditId);
    if (auditId !== null && auditId !== undefined && !Number.isFinite(idNum)) return null;
    const memoKey = String(idNum === null ? 'all' : idNum);
    if (summaryMemo.gen === intelGen && summaryMemo.key === memoKey) return summaryMemo.value;
    const where = idNum !== null ? 'WHERE t.audit_id = ?' : '';
    const params = idNum !== null ? [idNum] : [];
    const rows = all(`
      WITH latest_snapshots AS (
        SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY s.id DESC) AS rn FROM snapshots s
      ),
      latest_tasks AS (
        SELECT tk.*, ROW_NUMBER() OVER (PARTITION BY tk.target_id ORDER BY tk.id DESC) AS rn FROM tasks tk WHERE tk.target_id IS NOT NULL
      )
      SELECT t.id AS target_id, t.audit_id, a.name AS audit_name, t.platform, t.username, t.tema, t.url,
        COALESCE(lt.status, 'PENDING') AS status, lt.error_code,
        ls.likes, ls.comments, ls.views, ls.shares,
        COALESCE(ls.follower_count, acct.follower_count) AS follower_count, ls.scraped_at
      FROM targets t
      JOIN audits a ON a.id = t.audit_id
      LEFT JOIN latest_tasks lt ON lt.target_id = t.id AND lt.rn = 1
      LEFT JOIN latest_snapshots ls ON ls.target_id = t.id AND ls.rn = 1
      LEFT JOIN accounts acct ON acct.platform = t.platform AND acct.username = t.username
      ${where}`, ...params);

    const statusCounts = { PENDING: 0, RUNNING: 0, OK: 0, PARTIAL: 0, FAILED: 0 };
    const accountKeys = new Set();
    const platformRows = {};
    const accountRows = {};
    const temaRows = {};
    const auditRows = {};
    const posts = [];
    const scrapedTimes = [];
    const totals = { views: 0, likes: 0, comments: 0, shares: 0 };
    const quality = { without_followers: 0, partial: 0, missing_views: 0, missing_username: 0, never_scraped: 0 };
    const accountQuality = {};

    for (const row of rows) {
      const status = String(row.status || 'PENDING').toUpperCase();
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      const platform = row.platform || 'unknown';

      const stats = (platformRows[platform] ||= { platform, targets: 0, scraped: 0, ok: 0, partial: 0, failed: 0, views: 0, likes: 0, comments: 0, shares: 0, followers_known: 0, er: [] });
      stats.targets++;
      if (status === 'OK') stats.ok++;
      else if (status === 'PARTIAL') stats.partial++;
      else if (status === 'FAILED') stats.failed++;

      const audit = (auditRows[row.audit_id] ||= { audit_id: row.audit_id, name: row.audit_name || 'Audit', targets: 0, ok: 0, partial: 0, failed: 0, pending: 0, views: 0, er: [] });
      audit.targets++;
      if (status === 'OK') audit.ok++;
      else if (status === 'PARTIAL') audit.partial++;
      else if (status === 'FAILED') audit.failed++;
      else if (status === 'PENDING' || status === 'RUNNING') audit.pending++;

      const tema = (row.tema || '').trim();
      const temaStats = (temaRows[tema || '(tanpa tema)'] ||= { tema: tema || '(tanpa tema)', targets: 0, views: 0, er: [] });
      temaStats.targets++;

      let username = (row.username || '').trim();
      if (username) accountKeys.add(`${platform}:${username.toLowerCase()}`);
      const handle = username || row.url || '—';
      const accountKey = `${platform}:${(username || handle).toLowerCase()}`;
      const qflags = (accountQuality[accountKey] ||= { username: Boolean(username), scraped: false, followers: false, views_missing: false, partial: false });
      if (username) qflags.username = true;
      const account = (accountRows[accountKey] ||= { platform, username, handle, posts: 0, views: 0, likes: 0, comments: 0, followers: null, er: [], last_scraped_at: null });
      account.posts++;

      if (row.scraped_at === null) continue;
      qflags.scraped = true;
      stats.scraped++;
      scrapedTimes.push(row.scraped_at);
      account.last_scraped_at = account.last_scraped_at ? (row.scraped_at > account.last_scraped_at ? row.scraped_at : account.last_scraped_at) : row.scraped_at;
      if (row.follower_count !== null) {
        stats.followers_known++;
        qflags.followers = true;
        account.followers = Math.max(account.followers || 0, row.follower_count);
      }
      if (status === 'PARTIAL') qflags.partial = true;
      if (row.views === null) qflags.views_missing = true;

      const views = row.views || 0;
      const likes = row.likes || 0;
      const comments = row.comments || 0;
      const shares = row.shares || 0;
      const er = summaryEr(platform, likes, comments, views, shares, row.follower_count);

      stats.views += views; stats.likes += likes; stats.comments += comments; stats.shares += shares;
      totals.views += views; totals.likes += likes; totals.comments += comments; totals.shares += shares;
      audit.views += views; temaStats.views += views;
      account.views += views; account.likes += likes; account.comments += comments;
      if (er !== null) { stats.er.push(er); audit.er.push(er); temaStats.er.push(er); account.er.push(er); }

      posts.push({ platform, handle, username, url: row.url, views: row.views, likes: row.likes, comments: row.comments, shares: row.shares, followers: row.follower_count, er, scraped_at: row.scraped_at });
    }

    for (const [key, flags] of Object.entries(accountQuality)) {
      const platform = key.split(':')[0];
      if (!flags.username) quality.missing_username++;
      if (!flags.scraped) { quality.never_scraped++; continue; }
      if (!flags.followers) quality.without_followers++;
      if (flags.partial) quality.partial++;
      if (platform === 'tiktok' && flags.views_missing) quality.missing_views++;
    }

    const platforms = Object.values(platformRows).map((s) => {
      const er = s.er; delete s.er;
      return { ...s, er_rows: er.length, median_er: recapMedian(er) };
    }).sort((a, b) => b.targets - a.targets || a.platform.localeCompare(b.platform));

    const accounts = Object.values(accountRows).map((a) => {
      const er = a.er; delete a.er;
      return { ...a, er_rows: er.length, median_er: recapMedian(er) };
    }).sort((a, b) => b.views - a.views || a.handle.localeCompare(b.handle));

    const temas = Object.values(temaRows).map((t) => {
      const er = t.er; delete t.er;
      return { ...t, er_rows: er.length, median_er: recapMedian(er) };
    }).sort((a, b) => b.views - a.views || a.tema.localeCompare(b.tema));

    const auditList = Object.values(auditRows).map((a) => {
      const er = a.er; delete a.er;
      return { ...a, er_rows: er.length, median_er: recapMedian(er) };
    }).sort((a, b) => b.targets - a.targets || a.audit_id - b.audit_id);

    const igScore = (p) => (p.views ?? p.likes ?? 0);
    const rankedIg = posts.filter((p) => p.platform === 'instagram' && (p.views !== null || p.likes !== null))
      .sort((a, b) => igScore(b) - igScore(a)).slice(0, 6);
    const rankedTk = posts.filter((p) => p.platform === 'tiktok' && p.views !== null)
      .sort((a, b) => b.views - a.views).slice(0, 6);
    const scraped = platforms.reduce((s, p) => s + p.scraped, 0);
    const verified = statusCounts.OK + statusCounts.PARTIAL;

    const result = {
      audit_id: idNum,
      generated_at: isoNow(),
      kpi: {
        targets: rows.length, scraped, verified,
        ok: statusCounts.OK, partial: statusCounts.PARTIAL, failed: statusCounts.FAILED,
        pending: statusCounts.PENDING, running: statusCounts.RUNNING,
        success_rate: scraped ? Math.round((verified / scraped) * 1000) / 10 : null,
        accounts: accountKeys.size, audits: auditList.length,
        first_scraped_at: scrapedTimes.length ? scrapedTimes.reduce((a, b) => (a < b ? a : b)) : null,
        last_scraped_at: scrapedTimes.length ? scrapedTimes.reduce((a, b) => (a > b ? a : b)) : null,
        totals,
      },
      status: statusCounts,
      platforms, accounts: accounts.slice(0, 20), accounts_total: accounts.length,
      temas: temas.slice(0, 12), temas_total: temas.length,
      audits: auditList,
      posts: { top_instagram: rankedIg, top_tiktok: rankedTk },
      quality,
    };
    summaryMemo = { gen: intelGen, key: memoKey, value: result };
    return result;
  }

  let compareMemo = { gen: -1, key: null, value: null };
  function getCompare(months = 6, period) {
    months = Math.max(2, Math.min(Number(months || 6) || 6, 24));
    const selected = cleanPeriod(period);
    const memoKey = `${months}|${selected || ''}`;
    if (compareMemo.gen === intelGen && compareMemo.key === memoKey && compareMemo.value) return compareMemo.value;
    const periodRows = all("SELECT DISTINCT period FROM audits WHERE period IS NOT NULL AND period <> '' ORDER BY period DESC");
    let periods = periodRows.map((r) => r.period).slice(0, months);
    if (selected && !periods.includes(selected)) periods = ([selected, ...periods]).slice(0, months);
    if (!periods.length) {
      const empty = { periods: [], latest_period: null, accounts: [], summary: { accounts: 0, new_accounts: 0, missing_latest: 0 } };
      compareMemo = { gen: intelGen, key: memoKey, value: empty };
      return empty;
    }
    const ph = periods.map(() => '?').join(',');
    const rows = all(`
      WITH latest AS (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY s.id DESC) AS rn FROM snapshots s)
      SELECT a.period AS period, t.platform, t.username, t.url, ls.likes, ls.comments, ls.views, ls.shares,
        COALESCE(ls.follower_count, acct.follower_count) AS follower_count
      FROM targets t JOIN audits a ON a.id = t.audit_id
      LEFT JOIN latest ls ON ls.target_id = t.id AND ls.rn = 1
      LEFT JOIN accounts acct ON acct.platform = t.platform AND acct.username = t.username
      WHERE a.period IN (${ph})`, ...periods);
    const history = Object.fromEntries(all(`
      SELECT platform, username, month, follower_count, post_count FROM account_history WHERE month IN (${ph})`, ...periods)
      .map((r) => [`${r.platform}|${r.username}|${r.month}`, r]));

    const accounts = {};
    for (const row of rows) {
      let username = (row.username || '').trim();
      const key = `${row.platform}|${username || row.url || '—'}`;
      const entry = (accounts[key] ||= { platform: row.platform, username, months: {} });
      const bucket = (entry.months[row.period] ||= { posts: 0, views: 0, likes: 0, comments: 0, shares: 0, er: [], followers: null });
      bucket.posts++;
      for (const f of ['views', 'likes', 'comments', 'shares']) bucket[f] += row[f] || 0;
      if (row.follower_count !== null) bucket.followers = Math.max(bucket.followers || 0, row.follower_count);
      const er = summaryEr(row.platform, row.likes, row.comments, row.views, row.shares, row.follower_count);
      if (er !== null) bucket.er.push(er);
    }
    for (const [k, r] of Object.entries(history)) {
      const [platform, username, month] = k.split('|');
      const entry = accounts[`${platform}|${username}`];
      if (!entry) continue;
      const bucket = entry.months[month];
      if (!bucket) continue;
      if (bucket.followers === null && r.follower_count !== null) bucket.followers = r.follower_count;
    }

    const latestPeriod = periods[0];
    const items = [];
    for (const [handleKey, entry] of Object.entries(accounts)) {
      const row = { platform: entry.platform, username: entry.username, handle: entry.username || handleKey.split('|')[1], months: {}, first_period: null, last_period: null, posts_total: 0, views_total: 0 };
      for (const pk of periods) {
        const bucket = entry.months[pk];
        if (!bucket) { row.months[pk] = null; continue; }
        const er = bucket.er; delete bucket.er;
        bucket.er_rows = er.length; bucket.median_er = recapMedian(er);
        row.months[pk] = bucket;
        row.posts_total += bucket.posts; row.views_total += bucket.views;
      }
      // periods diurut DESC (terbaru dulu). first_period = periode paling LAMA yang berisi data.
      const withData = periods.filter((pk) => row.months[pk] !== null);
      row.first_period = withData.length ? withData[withData.length - 1] : null;
      row.last_period = withData.length ? withData[0] : null;
      // "baru" hanya bila ada data di periode terbaru TANPA data di periode mana pun yang lebih lama.
      row.is_new = periods.length > 1
        && row.months[latestPeriod] !== null
        && periods.slice(1).every((pk) => row.months[pk] === null);
      row.missing_latest = row.months[latestPeriod] === null;
      items.push(row);
    }
    items.sort((a, b) => (a.missing_latest - b.missing_latest) || (b.views_total - a.views_total) || a.handle.localeCompare(b.handle));
    const result = {
      periods, latest_period: latestPeriod, accounts: items,
      summary: { accounts: items.length, new_accounts: items.filter((i) => i.is_new).length, missing_latest: items.filter((i) => i.missing_latest).length },
    };
    compareMemo = { gen: intelGen, key: memoKey, value: result };
    return result;
  }

  function searchData(query, limit = 20) {
    const needle = String(query || '').trim();
    const l = clampLimit(limit, 1, 50, 20);
    if (needle.length < 2) return { query: needle, targets: [], accounts: [], posts: [] };
    const like = '%' + escapeLike(needle) + '%';
    const handle = '%' + escapeLike(needle.replace(/^@/, '')) + '%';
    const targets = all(`
      SELECT t.id AS target_id, t.audit_id, a.name AS audit_name, a.period, t.platform, t.username, t.url, t.tema, t.last_status AS status, t.last_scraped_at
      FROM targets t JOIN audits a ON a.id = t.audit_id
      WHERE t.username LIKE ? ESCAPE '\\' OR t.url LIKE ? ESCAPE '\\' OR COALESCE(t.tema, '') LIKE ? ESCAPE '\\' ORDER BY t.id DESC LIMIT ?`, handle, like, like, l).map(plain);
    const accounts = all(`
      SELECT platform, username, follower_count, display_name, bio, region, post_count, following_count, fetched_at
      FROM accounts WHERE username LIKE ? ESCAPE '\\' OR COALESCE(display_name, '') LIKE ? ESCAPE '\\' OR COALESCE(bio, '') LIKE ? ESCAPE '\\'
      ORDER BY fetched_at DESC LIMIT ?`, handle, like, like, l).map(plain);
    const posts = all(`
      SELECT platform, username, post_url, posted_at, likes, comments, views, shares, caption
      FROM account_posts WHERE post_url LIKE ? ESCAPE '\\' OR COALESCE(caption, '') LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\'
      ORDER BY posted_at DESC LIMIT ?`, like, like, handle, l).map(plain);
    return { query: needle, targets, accounts, posts };
  }

  let intelGen = 0;
  let intelCache = { gen: -1, snapshot: null };

  function markIntelDirty() { intelGen++; }

  function intelSnapshotCached() {
    if (intelCache.gen === intelGen && intelCache.snapshot) return intelCache.snapshot;
    const accountRows = all('SELECT * FROM accounts ORDER BY LOWER(username) ASC').map(plain);
    const postRows = all('SELECT platform, username, post_ref, posted_at, likes, comments, shares, views, caption FROM account_posts').map(plain);
    const historyRows = all('SELECT platform, username, month, follower_count, post_count FROM account_history').map(plain);
    const targetRows = all('SELECT platform, username, audit_id, last_scraped_at FROM targets').map(plain);
    const snapshot = intel.snapshotFromRows(accountRows, postRows, historyRows, targetRows);
    intelCache = { gen: intelGen, snapshot };
    return snapshot;
  }

  function getAccountIntel(params = {}) {
    const limit = clampLimit(params.limit, 1, 200, 50);
    const offset = Math.max(0, Number(params.offset || 0));

    const snapshot = intelSnapshotCached();
    const items = snapshot.items;
    const clusters = snapshot.clusters;

    const matches = (item) => {
      if (params.platform && item.platform !== params.platform) return false;
      if (params.band === 'ternak' && !item.in_ternak_band) return false;
      if (params.band === 'kecil' && !(item.followers !== null && item.followers < intel.TERNAK_BAND_MIN)) return false;
      if (params.band === 'besar' && !(item.followers !== null && item.followers > intel.TERNAK_BAND_MAX)) return false;
      if (params.level && item.level !== params.level) return false;
      if (params.incomplete && !item.unassessable) return false;
      if (params.stale && !item.needs_refresh) return false;
      if (params.q) {
        const needle = String(params.q).trim().toLowerCase();
        if (!needle) return true;
        const hay = [item.username, item.display_name, item.bio, item.region].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    };

    const filtered = items.filter(matches);
    const sortKeys = {
      risk: (i) => [i.score, i.followers || 0],
      followers: (i) => i.followers || 0,
      reach: (i) => i.metrics.view_reach_pct !== null ? i.metrics.view_reach_pct : (i.metrics.like_reach_pct || -1),
      posts: (i) => i.metrics.posts_seen || 0,
      audits: (i) => i.audits_seen || 0,
      age: (i) => i.data_age_minutes !== null ? i.data_age_minutes : Number.MAX_SAFE_INTEGER,
      username: (i) => String(i.username || '').toLowerCase(),
    };
    const keyFn = sortKeys[params.sort] || sortKeys.risk;
    const reverse = (params.sort === 'username') ? String(params.direction) !== 'asc' : String(params.direction) !== 'desc';
    const cmp = (a, b) => {
      const ka = keyFn(a); const kb = keyFn(b);
      const va = Array.isArray(ka) ? ka : [ka]; const vb = Array.isArray(kb) ? kb : [kb];
      for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        const x = va[i] === undefined ? null : va[i];
        const y = vb[i] === undefined ? null : vb[i];
        if (x === y) continue;
        if (x === null || y === null) return x === null ? 1 : -1;
        return x < y ? -1 : 1;
      }
      return 0;
    };
    filtered.sort((a, b) => reverse ? -cmp(a, b) : cmp(a, b));

    const total = filtered.length;
    const shownItems = filtered.slice(offset, offset + limit);
    const shownKeys = new Set(shownItems.map((i) => i.key));
    const levels = { pola_kembar: 0, pola_ternak: 0, amati: 0, bersih: 0 };
    for (const item of items) { if (levels[item.level] !== undefined) levels[item.level]++; }

    return {
      items: shownItems,
      total, limit, offset,
      clusters: clusters.filter((c) => c.members.some((m) => shownKeys.has(m))),
      thresholds: {
        band: [intel.TERNAK_BAND_MIN, intel.TERNAK_BAND_MAX],
        view_reach_floor: intel.VIEW_REACH_FLOOR,
        like_reach_floor: intel.IG_LIKE_REACH_FLOOR,
        upload_burst: [intel.UPLOAD_BURST_MIN_COUNT, intel.UPLOAD_BURST_WINDOW_MINUTES],
        flat_follower_tolerance: intel.FLAT_FOLLOWER_TOLERANCE * 100,
        levels: intel.RISK_FLOORS,
      },
      summary: {
        accounts: items.length,
        shown: total,
        flagged: items.filter((i) => i.score >= intel.RISK_FLOORS.amati).length,
        in_band: items.filter((i) => i.in_ternak_band).length,
        incomplete: items.filter((i) => i.unassessable).length,
        needs_refresh: items.filter((i) => i.needs_refresh).length,
        clusters: clusters.length,
        levels,
        visit_budget: VISIT_BUDGET_PER_CYCLE,
      },
    };
  }

  function getAccountDetail(username, platform) {
    const handle = cleanUsername(username);
    if (!handle) return null;
    const snapshot = intelSnapshotCached();
    const byKey = Object.fromEntries(snapshot.items.map((i) => [i.key, i]));

    const wanted = platform ? `${platform}:${handle}` : null;
    let match = wanted ? byKey[wanted] || null : null;
    if (!match && !wanted) {
      const candidates = snapshot.items.filter((i) => i.username === handle);
      match = candidates.sort((a, b) => b.score - a.score)[0] || null;
    }
    if (!match) return null;

    const posts = all(`SELECT post_ref, post_url, posted_at, likes, comments, shares, views, caption, is_video, fetched_at FROM account_posts WHERE platform = ? AND username = ? ORDER BY posted_at DESC`, match.platform, handle).map(plain);
    const history = all(`SELECT month, follower_count, following_count, post_count, first_seen_at, last_seen_at, visits FROM account_history WHERE platform = ? AND username = ? ORDER BY month ASC`, match.platform, handle).map(plain);

    const sharedTemplates = snapshot.shared_templates || new Set();
    for (const post of posts) {
      post.caption_templated = Boolean(post.caption && intel.captionTemplateKey(post.caption) && sharedTemplates.has(intel.captionTemplateKey(post.caption)));
    }

    const siblings = [];
    for (const peer of match.peers) {
      const other = byKey[peer] || {};
      siblings.push({
        key: peer, platform: other.platform, username: other.username, followers: other.followers,
        score: other.score, level: other.level,
        reasons: (other.peer_reasons || {})[match.key] || [],
      });
    }
    siblings.sort((a, b) => -(a.score || 0) + (b.score || 0));

    const detail = { ...match, siblings, posts, history };
    detail.clusters = snapshot.clusters.filter((c) => c.members.includes(match.key));
    return detail;
  }

  function getAccountProfile(username, platform) {
    const handle = cleanUsername(username);
    if (!handle) return null;
    const account = platform
      ? one('SELECT * FROM accounts WHERE platform = ? AND username = ?', platform, handle)
      : one('SELECT * FROM accounts WHERE username = ? ORDER BY fetched_at DESC LIMIT 1', handle);
    if (!account) return null;
    const posts = all('SELECT post_ref, post_url, posted_at, likes, comments, shares, views, caption, is_video, fetched_at FROM account_posts WHERE platform = ? AND username = ? ORDER BY posted_at DESC', account.platform, handle).map(plain);
    return { account: plain(account), posts };
  }

  function getExportRows(auditId, status) {
    const aid = auditId === null || auditId === undefined ? null : Number(auditId);
    if (auditId !== null && auditId !== undefined && !Number.isFinite(aid)) return [];
    const conditions = [];
    const params = [];
    if (aid !== null) { conditions.push('t.audit_id = ?'); params.push(aid); }
    if (status === 'DONE') { conditions.push("s.status IN ('OK','PARTIAL')"); }
    else if (status) { conditions.push('s.status = ?'); params.push(status); }
    const where = 'WHERE s.attempt_rn = 1' + (conditions.length ? ' AND ' + conditions.join(' AND ') : '');
    return all(`
      WITH attempts AS (
        SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.target_id, s.run_id ORDER BY s.id DESC) AS attempt_rn FROM snapshots s
      ),
      ordered AS (
        SELECT s.id, s.target_id, s.run_id, s.task_id, s.scraped_at, s.status, s.error_code, s.error_message,
               s.likes, s.comments, s.views, s.shares, COALESCE(s.follower_count, acct.follower_count) AS follower_count, s.post_date, s.caption,
               t.platform, t.username, t.tema, t.url, t.audit_id, a.name AS audit_name, a.period,
               COALESCE(tk.retry_count, 0) AS retry_count,
               LAG(s.likes) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_likes,
               LAG(s.comments) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_comments,
               LAG(s.views) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_views,
               LAG(s.shares) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_shares,
               LAG(s.follower_count) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_follower_count,
               LAG(s.scraped_at) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_scraped_at
        FROM attempts s
        JOIN targets t ON t.id = s.target_id
        JOIN audits a ON a.id = t.audit_id
        LEFT JOIN tasks tk ON tk.id = s.task_id
        LEFT JOIN accounts acct ON acct.platform = t.platform AND acct.username = t.username ${where}
      )
      SELECT * FROM ordered ORDER BY audit_id ASC, target_id ASC, id ASC`, ...params).map(plain);
  }

  function getExportCount(auditId, status) {
    // Hitung langsung dengan COUNT(*) — jangan memuat seluruh baris ke memori (T-6).
    const aid = auditId === null || auditId === undefined ? null : Number(auditId);
    if (auditId !== null && auditId !== undefined && !Number.isFinite(aid)) return 0;
    const conditions = [];
    const params = [];
    if (aid !== null) { conditions.push('t.audit_id = ?'); params.push(aid); }
    if (status === 'DONE') { conditions.push("s.status IN ('OK','PARTIAL')"); }
    else if (status) { conditions.push('s.status = ?'); params.push(status); }
    const where = 'WHERE s.attempt_rn = 1' + (conditions.length ? ' AND ' + conditions.join(' AND ') : '');
    const row = one(`
      WITH attempts AS (
        SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.target_id, s.run_id ORDER BY s.id DESC) AS attempt_rn FROM snapshots s
      )
      SELECT COUNT(*) AS n FROM attempts s JOIN targets t ON t.id = s.target_id ${where}`, ...params);
    return row ? row.n : 0;
  }

  // ---- database info / backup ----
  const BACKUP_TABLES = ['audits', 'targets', 'tasks', 'snapshots', 'accounts', 'account_posts', 'account_history'];

  function getDatabaseInfo() {
    let size = 0;
    if (fs.existsSync(dbPath)) size = fs.statSync(dbPath).size;
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) size += fs.statSync(dbPath + suffix).size;
    }
    const counts = {};
    for (const table of BACKUP_TABLES) {
      try { counts[table] = one(`SELECT COUNT(*) AS n FROM ${table}`).n; } catch { counts[table] = null; }
    }
    const version = one('PRAGMA user_version').user_version || 0;
    return { filename: path.basename(dbPath), size_bytes: size, schema_version: version, counts };
  }

  function backupDatabase(destination) {
    const finalDest = path.resolve(destination);
    if (finalDest === path.resolve(dbPath)) {
      throw new Error('Cadangan tidak boleh menimpa database aktif.');
    }
    const dir = path.dirname(finalDest);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    // Tulis ke temp lalu rename atomik: cadangan lama tetap utuh bila VACUUM gagal.
    const tmp = `${finalDest}.tmp-${Date.now()}`;
    try {
      conn.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      for (const stale of [finalDest, finalDest + '-wal', finalDest + '-shm']) {
        try { if (fs.existsSync(stale)) fs.unlinkSync(stale); } catch {}
      }
      fs.renameSync(tmp, finalDest);
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      throw e;
    }
    return finalDest;
  }

  function close() {
    if (conn) { try { conn.close(); } catch {} }
  }

  const RESTORE_REQUIRED_TABLES = ['audits', 'targets', 'tasks', 'snapshots'];

  /** Validasi file cadangan: integrity + tabel wajib + hitungan baris. Throws bila gagal. */
  function inspectBackup(sourcePath) {
    if (!fs.existsSync(sourcePath)) throw new Error('File cadangan tidak ditemukan.');
    const size = fs.statSync(sourcePath).size;
    if (size < 512) throw new Error('File terlalu kecil untuk menjadi database SQLite.');
    let src = null;
    try {
      src = new DatabaseSync(sourcePath, { readOnly: true });
      const check = src.prepare('PRAGMA integrity_check').get();
      const ok = Object.values(check)[0];
      if (ok !== 'ok') throw new Error('File cadangan rusak (integrity check gagal).');
      const tables = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => Object.values(r)[0]));
      const missing = RESTORE_REQUIRED_TABLES.filter((t) => !tables.has(t));
      if (missing.length) throw new Error('File bukan cadangan sunscrap (tabel ' + missing.join(', ') + ' tidak ada).');
      const counts = {};
      for (const t of [...RESTORE_REQUIRED_TABLES, 'accounts', 'account_posts', 'account_history']) {
        try { counts[t] = src.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { counts[t] = null; }
      }
      return { file: path.basename(sourcePath), size_bytes: size, counts, schema_version: src.prepare('PRAGMA user_version').get().user_version || 0 };
    } finally {
      if (src) { try { src.close(); } catch {} } 
    }
  }

  /** Ganti seluruh data dengan cadangan.
   *  - Menolak bila sumber = database aktif (K-1) — sebelumnya menghapus DB aktif lalu gagal copy.
   *  - Menolak bila skema cadangan ≠ SCHEMA_VERSION aplikasi (K-5) — mencegah DB berhenti diam-diam.
   *  - Menyalin ke temp + verifikasi integrity dulu, baru swap rename; DB aktif tidak pernah hilang (K-2). */
  function restoreDatabase(sourcePath) {
    const meta = inspectBackup(sourcePath);
    if (path.resolve(sourcePath) === path.resolve(dbPath)) {
      throw new Error('Cadangan tidak boleh sama dengan database aktif — pilih file cadangan lain.');
    }
    const backupSchema = Number(meta.schema_version) || 0;
    if (backupSchema > SCHEMA_VERSION) {
      throw new Error(`Cadangan dibuat dengan skema v${backupSchema} (lebih baru dari aplikasi ini v${SCHEMA_VERSION}). Perbarui aplikasi sebelum memulihkan.`);
    }
    if (backupSchema < SCHEMA_VERSION) {
      throw new Error(`Cadangan dibuat dengan skema v${backupSchema} (lebih lama dari v${SCHEMA_VERSION}). Pulihkan dengan versi aplikasi yang cocok.`);
    }
    const safety = path.join(path.dirname(dbPath), `pre_restore_${Date.now()}.db`);
    backupDatabase(safety); // VACUUM INTO safety — konsisten, termasuk isi -wal

    const tmpDest = `${dbPath}.restore-tmp-${Date.now()}`;
    const liveOld = `${dbPath}.live-old-${Date.now()}`;
    let verifyConn = null;
    try {
      fs.copyFileSync(sourcePath, tmpDest);
      // Verifikasi hasil salinan sebelum menyentuh DB aktif.
      verifyConn = new DatabaseSync(tmpDest, { readOnly: true });
      const check = verifyConn.prepare('PRAGMA integrity_check').get();
      const ok = Object.values(check)[0];
      if (ok !== 'ok') throw new Error('Salinan cadangan rusak (integrity check gagal).');
      const backupTables = new Set(verifyConn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => Object.values(r)[0]));
      const missingTmp = RESTORE_REQUIRED_TABLES.filter((t) => !backupTables.has(t));
      if (missingTmp.length) throw new Error('Salinan cadangan tidak lengkap (tabel ' + missingTmp.join(', ') + ' hilang).');
    } catch (e) {
      if (verifyConn) { try { verifyConn.close(); } catch {} }
      try { if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest); } catch {}
      throw new Error(`Pemulihan dibatalkan; data aktif TIDAK diubah. Safety backup: ${safety}`);
    }
    if (verifyConn) { try { verifyConn.close(); } catch {} }

    conn.close();
    // Buang -wal/-shm milik DB lama sebelum membuka DB baru (data pending ada di safety).
    for (const stale of [dbPath + '-wal', dbPath + '-shm']) {
      try { if (fs.existsSync(stale)) fs.unlinkSync(stale); } catch {}
    }
    let swapError = null;
    try {
      fs.renameSync(dbPath, liveOld); // 1. geser yang lama ke samping
      try {
        fs.renameSync(tmpDest, dbPath); // 2. tukar dengan cadangan
      } catch (e) {
        try { fs.renameSync(liveOld, dbPath); } catch {} // rollback bila rename gagal
        swapError = e;
      }
      if (!swapError) { try { fs.unlinkSync(liveOld); } catch {} }
    } finally {
      // Selalu buka ulang koneksi (lama sudah di-close); bila rollback, ini DB lama.
      conn = new DatabaseSync(dbPath);
      conn.exec('PRAGMA journal_mode=WAL');
      conn.exec('PRAGMA busy_timeout=30000');
      conn.exec('PRAGMA foreign_keys=ON');
    }
    if (swapError) throw new Error(`Pemulihan gagal; data aktif dikembalikan. Safety backup: ${safety}`);
    if (fs.existsSync(dbPath)) initSchema(); // stamp user_version = SCHEMA_VERSION (cadangan sudah divalidasi)
    markIntelDirty();
    return { safety: path.basename(safety), safety_path: safety };
  }

  // Seri waktu observasi per hari untuk grafik Dashboard. Mengisi hari kosong agar grafik mulus.
  function getTimeseries(auditId, days = 30) {
    const hasAudit = auditId !== null && auditId !== undefined && auditId !== '';
    const aid = hasAudit ? Number(auditId) : null;
    if (hasAudit && !Number.isFinite(aid)) return { range_days: 0, days: [] };
    const span = Math.max(7, Math.min(Number(days) || 30, 120));
    const conditions = ["s.scraped_at >= datetime('now', '-' || ? || ' days')"];
    const params = [span];
    if (aid !== null) { conditions.push('t.audit_id = ?'); params.push(aid); }
    const rows = all(`
      SELECT date(s.scraped_at) AS d,
             COUNT(*) AS scraped,
             COUNT(DISTINCT s.target_id) AS targets,
             COALESCE(SUM(s.views), 0) AS views,
             COALESCE(SUM(s.likes), 0) AS likes,
             COALESCE(SUM(s.comments), 0) AS comments,
             SUM(CASE WHEN s.status = 'OK' THEN 1 ELSE 0 END) AS ok_count,
             SUM(CASE WHEN s.status = 'PARTIAL' THEN 1 ELSE 0 END) AS partial_count,
             SUM(CASE WHEN s.status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count
      FROM snapshots s JOIN targets t ON t.id = s.target_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY date(s.scraped_at)
      ORDER BY d ASC`, ...params);
    const byDate = new Map(rows.map((r) => [r.d, r]));
    const now = new Date();
    const out = [];
    for (let i = span - 1; i >= 0; i--) {
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      const key = day.toISOString().slice(0, 10);
      const r = byDate.get(key);
      out.push(r
        ? { date: key, scraped: r.scraped, targets: r.targets, views: r.views, likes: r.likes, comments: r.comments, ok_count: r.ok_count, partial_count: r.partial_count, failed_count: r.failed_count }
        : { date: key, scraped: 0, targets: 0, views: 0, likes: 0, comments: 0, ok_count: 0, partial_count: 0, failed_count: 0 });
    }
    return { range_days: span, days: out };
  }

  return {
    dbPath,
    initSchema,
    inferErrorCode,
    // write
    createAuditWithTasks, appendTargetsToAudit, enqueueRun, retryTargets, retryFailedTargets,
    enqueueProfileVisits, updateAudit, deleteAudit, clearAll, deleteAccount,
    getNextTask, updateTaskResult, recordAccountProfile,
    // read
    getAudits, getAudit, getQueueStats, getDashboardStats, getTargets, getLatest, getTargetHistory, getTargetWithAudit,
    getSummary, getCompare, searchData, getAccountIntel, getAccountDetail, getAccountProfile, getTimeseries,
    getAccountCache, getCachedPostMetrics, getExportRows, getExportCount,
    getDatabaseInfo, backupDatabase, inspectBackup, restoreDatabase,
    close,
    constants: { TASK_LOCK_MINUTES, CACHE_TTL_MINUTES, POST_CACHE_TTL_MINUTES, MAX_RETRIES, MAX_PROFILE_POSTS, VISIT_BUDGET_PER_CYCLE },
  };
}

module.exports = { createDatabase };
module.exports._constants = { POST_CACHE_TTL_MINUTES, CACHE_TTL_MINUTES, MAX_PROFILE_POSTS, MAX_RETRIES, TASK_LOCK_MINUTES, VISIT_BUDGET_PER_CYCLE, SCHEMA_VERSION };