# Arsitektur

Aplikasi desktop Electron **satu proses utama** + satu proses renderer dashboard + satu `BrowserWindow`
tersembunyi untuk scraping. Semua data tersimpan lokal; tidak ada server HTTP, Python, atau extension.

## Prinsip

1. **Lokal penuh** — data & sesi login hanya di `userData` mesin pengguna.
2. **Tanpa API berbayar** — data dibaca dari halaman publik Instagram/TikTok lewat jendela tersembunyi yang sudah login.
3. **Logika murni diuji** — `policy`, `intel`, `taskCache`, `rateLimiter`, `util`, dan `db` dapat dijalankan tanpa Electron lewat `node --test`.
4. **Windows-only** — `package.json` `os: ["win32"]`; tidak ada jalur macOS/Linux yang didukung.
5. **Inkremental** — perbaikan dipandu audit; hindari penulisan ulang.

## Komponen

| Modul | Tanggung jawab | Uji |
|---|---|---|
| `src/main/main.js` | Bootstrap: DB, scraper, worker, tray, jendela, menu, protokol `sa-avatar`, updater | manual |
| `src/main/db.js` | SQLite via `node:sqlite` (satu koneksi sinkron), skema, query, backup/restore | `db.test.js` |
| `src/main/worker.js` | Loop klaim → kunjungi → scrape → lapor, dengan pacing | manual |
| `src/main/scraper.js` | `BrowserWindow` tersembunyi + injeksi isolated world; jendela login | manual |
| `src/main/rateLimiter.js` | Budget/sesi/warm-up/fatigue, dipersist ke berkas | `rateLimiter.test.js` |
| `src/main/intel.js` | Skor akun ternak/kembar (murni) | `intel.test.js` |
| `src/main/taskCache.js` | Pakai ulang metrik dari kunjungan profil (murni) | `taskCache.test.js` |
| `src/main/policy.js` | Allowlist host + taksonomi error + makna hasil (murni) | `policy.test.js` |
| `src/main/avatar.js` | Unduh avatar ke disk (allowlist host, cap, magic bytes) | manual |
| `src/main/import.js` | Parse CSV/XLSX (state machine CSV sadar-kutip) | `import.test.js` |
| `src/main/export.js` | Export `.xlsx` (Data + Rekap), sanitasi formula | `export.test.js` |
| `src/main/ipc.js` | Handler IPC untuk seluruh permukaan renderer | manual |
| `src/main/util.js` | Helper murni (waktu, teks, angka, URL) | `util.test.js` |
| `src/main/updater.js` | Cek pembaruan GitHub Releases (`electron-updater`); aktif hanya di build terpasang | — |
| `src/preload/preload.js` | Jembatan `contextBridge` → `window.sunscrap` | — |
| `src/renderer/*` | Dashboard v2 "Analyst Command Center" (HTML/CSS/JS tanpa framework) | e2e |
| `src/scraper-content/*` | Scraper IG/TikTok yang disuntik ke isolated world | — |

## Alur data

```
Import (CSV/XLSX/tempel)  →  normalizeTargetUrl  →  tabel targets + tasks
                                                          │
                                        ┌─────────────────┘
                                        ▼
worker.tick()  ──►  db.getNextTask()  (klaim + kunci 5 menit, prioritas PROFILE)
     │                     │
     │                     ├─ reclaimExpired(): task RUNNING kedaluwarsa → PENDING/FAILED
     │                     └─ autoEnqueueDue(): audit repeat_days jatuh tempo → run baru
     ▼
scraper.scrapePost/Profile()  ──►  BrowserWindow tersembunyi (isolated world, sandbox)
     │                              memuat URL → inject ig/tk-scraper → baca metrik
     ▼
db.updateTaskResult()  ──►  tasks, snapshots, targets, accounts, account_history
     │
     └─► rateLimiter: jadwalkan tick berikutnya (mode otomatis + warm-up + fatigue + istirahat sesi)
                                        │
                                        ▼
intel.snapshotFromRows()  ──►  skor & klaster akun  ──►  UI (Akun / Dashboard)
```

## Loop worker (`worker.js`)

1. `if (!limiter.hasVisitBudget()) stop(...)` — budget siklus 500 / rail harian 2000.
2. `if (limiter.needsSessionBreak())` — jeda 3–5 menit tiap 30–50 task; jadwalkan lanjut.
3. `pendingCount()` → `limiter.autoSelectMode(pending)`: ≤50 cepat, ≤300 normal, else aman.
4. `db.getNextTask(prefer)` — prioritaskan `kind='PROFILE'`, lalu platform bergantian (IG/TT).
5. `taskWithCache` — lengkapi `cachedFollowerCount` & `cachedPost` dari DB.
6. `beginCycle` — reset set `harvested`/`followerAttempts` bila `run_id` berganti.
7. `processTask`:
   - `allowedTarget` gagal → FAILED PERMANENT.
   - PROFILE → `scrapeProfile` → `recordAccountProfile`.
   - POST: jawab dari cache (`TaskCache.resultFromTask`) bila segar (<12 jam); jika tidak, harvest profil sekali/siklus (`ensureHarvested`), lalu `scrapePost`.
8. `outcomeOf(result, blockedInARow)` → charge success/error/none; blok THROTTLED/AUTH 3× berturut → berhenti.
9. `db.updateTaskResult` lalu `schedule(delay)` dari `limiter.getDelay()`.

## Rate limiter (6 lapis)

1. **Istirahat sesi** 3–5 menit tiap 30–50 task.
2. **Budget** kunjungan 500/siklus + rail 2000/hari.
3. **Pemilihan mode** otomatis dari panjang antrean.
4. **Dwell** acak 1–4 dtk (dipakai saat kunjungan profil).
5. **Warm-up** 5 task pertama (×3,0 → ×1,0).
6. **Fatigue** naik perlahan (maks +0,5) + backoff error eksponensial (maks ×10).

Semua state dipersist ke `worker-state.json` (tmp + rename atomik).

## Scraper (isolated world)

- Partisi sesi `persist:sunscrap` (dipakai juga oleh tab Browser & jendela login).
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, UA desktop.
- Konten `common.js` + `ig-scraper.js`/`tk-scraper.js` disuntik ke **isolated world 999**; komunikasi lewat `executeJavaScriptInIsolatedWorld`.
- `will-navigate` memblokir host di luar Instagram/TikTok; `setWindowOpenHandler` menolak popup.
- Jendela didaur ulang setelah 120 kali muat; timeout muat 30 dtk, scrape 45 dtk.
- Sumber data: meta tag, JSON LD, state halaman (rehydration/SIGI/GraphQL), DOM; TikTok juga memanggil endpoint `item_list` internal untuk posting terbaru.

## IPC (diringkas)

- **Baca**: `data:queueStats`, `data:summary`, `data:timeseries`, `data:audits`, `data:targets`, `data:accounts`, `data:accountDetail`, `data:targetHistory`, `data:latest`, `data:compare`, `data:search`, `db:info`.
- **Tulis**: `data:createAudit`, `data:appendTargets`, `data:importLinks`, `data:rerun`, `data:retryFailed`, `data:retryTargets`, `data:profileVisits`, `data:updateAudit`, `data:deleteAudit`, `data:clearAll`, `account:delete`.
- **Worker**: `worker:start`, `worker:stop`, `worker:status`, `worker:login`.
- **Export/DB**: `data:export`, `data:exportCount`, `db:backup`, `db:restorePreview`, `db:restoreCommit`.
- **Pembaruan**: `update:state`, `update:check`, `update:install`.
- **Aplikasi**: `app:theme`, `app:openExternal`, `app:clearSession`, `app:loginStatus`, `app:copyDiagnostics`, `app:openDataFolder`.
- **Push**: `evt` dengan tipe `worker`, `data`, `menu`, `update`.

Semua operasi tulis memanggil `markIntelDirty()` sehingga memo intel/summary/compare diperbarui dan renderer menyegarkan via broadcast `data`.

## Pembaruan (updater)

`src/main/updater.js` memakai `electron-updater`:

- Aktif **hanya** bila `app.isPackaged`; di `npm start` status `dev` (tidak menyentuh feed).
- Cek 5 detik setelah boot, lalu setiap 6 jam (`setInterval(...).unref()`), plus manual dari tray/Pengaturan.
- `autoDownload = true`; install saat peluncuran berikutnya (`autoInstallEvent = 'onNextLaunch'`) atau langsung via
  `quitAndInstall` dari tombol "Muat ulang & perbarui".
- Status dialirkan ke renderer lewat broadcast `update` dan dibaca via IPC `update:state`.
- Kegagalan cek/unduh hanya dicatat di log — aplikasi tetap berjalan normal (tanpa telemetri).

Konfigurasi feed ada di `package.json` (`build.publish`: provider github, owner/repo `startupmini/sunscrap`).
Installer `nsis.differentialPackage: true` untuk update kecil. Saat ini `verifyUpdateCodeSignature: false`
karena installer belum ditandatangani — aktifkan `true` bersamaan dengan signing (lihat `PLAN-AUTO-UPDATE-2026-11-05.md`).

## Konkurensi

- Proses utama Node **single-threaded**; semua transaksi DB sinkron & pendek (`BEGIN IMMEDIATE`), sehingga tidak ada interleaving di tengah transaksi.
- Worker async hanya menunggu jaringan/scrape; penulisan DB tetap sinkron.
- Satu instance aplikasi (single-instance lock); jendela boleh ditutup tanpa mematikan app (tray-first).
