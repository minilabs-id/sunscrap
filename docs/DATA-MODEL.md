# Model Data

SQLite lewat modul bawaan Electron `node:sqlite` (tanpa modul native). Satu koneksi sinkron per instance.
Pragma: `journal_mode=WAL`, `busy_timeout=30000`, `foreign_keys=ON`.

- `SCHEMA_VERSION = 5` — **satu-satunya sumber** ada di `src/main/db.js`. Kenaikan versi wajib disertai langkah migrasi + uji round-trip.
- File DB: `userData/sunscrap.db` (mis. `%APPDATA%\sunscrap\sunscrap.db`).

## Konvensi waktu

| Kolom | Format | Zona |
|---|---|---|
| `scraped_at`, `fetched_at`, `first_seen_at`, `last_seen_at`, `last_visit_at`, `last_scraped_at` | ISO 8601 + `Z` (presisi detik) | UTC |
| `created_at`, `last_run_at`, `claimed_at`, `locked_until` | `YYYY-MM-DD HH:MM:SS` | UTC |

Semua string waktu diurai sebagai UTC (`util.parseUtc`, `renderer.parseWhen`) — **jangan** pakai `new Date(str)` mentah untuk format `YYYY-MM-DD HH:MM:SS` (akan terbaca sebagai waktu lokal).

## Tabel

### `audits`
`id, name, source_filename, repeat_days, period (YYYY-MM), received_at, created_at, last_run_at`

### `runs`
`id, audit_id, trigger, status (RUNNING|DONE), created_at, finished_at`
Satu "run" = satu batch pengambilan. `trigger`: `upload|append|manual|retry|retry-selected|schedule|profile`.

### `targets`
`id, audit_id, platform (instagram|tiktok), url, username, tema, created_at, last_scraped_at, last_status, last_error`
`UNIQUE(audit_id, url)`.

### `tasks`
`id, url, platform, username, tema, status (PENDING|RUNNING|OK|PARTIAL|FAILED), kind (POST|PROFILE), likes, comments, views, shares, follower_count, post_date, caption, error_message, error_code, scraped_at, claimed_at, locked_until, retry_count, audit_id, run_id, target_id, created_at`
- Klaim: `getNextTask` menetapkan `status='RUNNING'`, `locked_until = now + 5 menit`.
- `reclaimExpired` mengembalikan task RUNNING kedaluwarsa ke PENDING (naik `retry_count`) atau FAILED setelah `MAX_RETRIES=3`.
- `error_code`: `PERMANENT|TRANSIENT|THROTTLED|AUTH`.

### `snapshots`
`id, target_id, run_id, task_id, scraped_at, status, error_code, error_message, likes, comments, views, shares, follower_count, post_date, caption`
Riwayat per (target, run). **Tanpa retensi otomatis** — lihat BACKLOG.

### `accounts`
`platform, username, follower_count, fetched_at, account_id, external_id, display_name, bio, region, following_count, post_count, is_verified, last_visit_at, needs_visit, avatar_url`
`PRIMARY KEY(platform, username)`. `avatar_url` = **nama file lokal** (`<platform>_<username>.<ext>`), bukan URL remote.

### `account_posts`
`id, platform, username, post_ref, post_url, posted_at, likes, comments, shares, views, caption, is_video, fetched_at`
`UNIQUE(platform, username, post_ref)`. Maksimum `MAX_PROFILE_POSTS=10` per kunjungan.

### `account_history`
`id, platform, username, month (YYYY-MM), follower_count, following_count, post_count, first_seen_at, last_seen_at, visits`
`UNIQUE(platform, username, month)` — seri bulanan untuk deteksi follower datar.

## Indeks

`tasks(status)`, `tasks(status, platform)`, `tasks(target_id, id)`, `tasks(run_id, status)`, `tasks(audit_id, status)`,
`targets(audit_id)`, `runs(audit_id, id)`, `snapshots(target_id, id)`, `snapshots(run_id)`,
`account_posts(platform, username, posted_at)`, `account_posts(post_ref)`, `account_posts(post_url)`,
`account_history(platform, username, month)`, `account_history(month)`.

## Konstanta penting (`db.js`)

| Nama | Nilai | Arti |
|---|---|---|
| `SCHEMA_VERSION` | 5 | Versi skema |
| `TASK_LOCK_MINUTES` | 5 | Kunci klaim task |
| `MAX_RETRIES` | 3 | Batas percobaan transient |
| `MAX_PROFILE_POSTS` | 10 | Post disimpan per kunjungan profil |
| `CACHE_TTL_MINUTES` | 7×24×60 | Umur cache follower |
| `POST_CACHE_TTL_MINUTES` | 12×60 | Umur cache metrik post |
| `VISIT_BUDGET_PER_CYCLE` | 500 | Budget kunjungan per siklus |

## IPC & API baca untuk UI v2

- `data:summary` / `getSummary` — agregat KPI, platform, tema, kualitas, dan totals; mengisi Hero, funnel, donut, perbandingan platform.
- `data:targets` / `getTargets` — kini mengembalikan `prev_likes`, `prev_comments`, `prev_views`, `prev_scraped_at`, serta `delta_likes` dan `delta_views` (selisih terhadap snapshot sebelumnya); kolom Δ di tabel Target dan feed aktivitas.
- `data:timeseries` / `getTimeseries` — seri 7–120 hari per `date(scraped_at)`: `scraped`, `targets`, `views`, `likes`, `comments`, `ok_count`, `partial_count`, `failed_count`, dengan hari kosong diisi — untuk area chart Dashboard.
- `data:queueStats` — tetap jumlah tugas per status; dipakai bar antrean.
- `data:latest` — tetap memakai `LAG(...)` dan kini juga dipakai untuk delta di feed aktivitas.
- `data:accounts` / `getAccountIntel` — `summary.levels` ditambahkan untuk grafik distribusi risiko di tab Akun.
- `data:compare` — tetap matriks antar-periode; dipakai di panel Perbandingan periode.

## Backup & restore

- **Backup** (`backupDatabase`): `VACUUM INTO` ke file temp, lalu rename atomik. Menolak menimpa DB aktif. Konsisten termasuk isi `-wal`.
- **Inspeksi** (`inspectBackup`): `PRAGMA integrity_check`, wajib punya tabel `audits, targets, tasks, snapshots`, serta hitungan baris & `user_version`.
- **Restore** (`restoreDatabase`):
  1. Menolak bila sumber = DB aktif.
  2. Menolak bila `schema_version` cadangan ≠ `SCHEMA_VERSION` (lebih lama/lebih baru).
  3. `VACUUM INTO` safety backup (`pre_restore_<ts>.db`).
  4. Copy sumber → temp, verifikasi integrity + tabel, lalu swap rename (dengan rollback).
  5. Buka ulang koneksi + `initSchema`.
- **Hapus semua data** (`clearAll`): kosongkan 8 tabel + `sqlite_sequence`; IPC juga menghapus seluruh `avatars/` dan mereset budget rate limiter.
- **Hapus akun** (`deleteAccount`): hapus `accounts` + `account_posts` + `account_history`; IPC juga menghapus file avatar akun itu.

## Aturan migrasi

`CREATE TABLE IF NOT EXISTS` **tidak menambah kolom** ke DB lama. Setiap perubahan skema wajib:
1. Naikkan `SCHEMA_VERSION`.
2. Tambah langkah migrasi idempoten (`PRAGMA table_info` → `ALTER TABLE ... ADD COLUMN`).
3. Tambah uji round-trip `v(n-1) → v(n)` dan uji restore cadangan skema lama.
