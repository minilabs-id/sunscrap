# Arsitektur — sunscrap v2

> Satu aplikasi Electron, dua lapisan yang dipisah keras: **backend** (proses utama) dan
> **frontend** (renderer). Kontraknya tunggal: `src/preload/preload.js`.

## 1. Gambaran

```
┌─────────────────────────────── Electron ───────────────────────────────┐
│                                                                        │
│  src/frontend (renderer)            src/preload        src/backend     │
│  ┌──────────────────┐          ┌──────────────┐  ┌───────────────────┐ │
│  │ index.html       │          │ contextBridge│  │ main.js (boot)    │ │
│  │ styles.css       │  window  │ expose       │  │   ├─ core/*       │ │
│  │ js/*.js (ESM)    │◄────────►│ window.      │─►│   │  domain murni  │ │
│  │ format.js/store.js          │ sunscrap     │  │   ├─ services/*    │ │
│  │  (dual-mode)     │  ipc     │  (invoke)    │  │   │  IO/orkestrasi │ │
│  └──────────────────┘          └──────────────┘  │   └─ ipc/*         │ │
│        ▲ tanpa Node integration                   │      adapter tipis │ │
│        └─ CSP: script-src 'self'                  └───────────────────┘ │
│                                                          │              │
│                                              SQLite (node:sqlite)       │
│                                              + file JSON (worker-state, │
│                                                review-state, window-…)  │
└──────────────────────────────────────────────────────────────────────────┘
```

Aturan main:

1. **Renderer tidak pernah** menyentuh `require`, `ipcRenderer`, atau filesystem. Satu-satunya
   jalan keluar adalah `window.sunscrap.*`.
2. **IPC tidak berisi logika bisnis.** Handler memvalidasi input lalu mendelegasikan ke
   `core/` (murni, teruji) atau `services/` (IO). Tidak ada query SQL di `ipc/`.
3. **Core tidak tahu Electron.** Semua modul `core/` bekerja murni (diuji `node --test`);
   satu-satunya pengecualian praktis: `db.js` memakai `node:sqlite` (bawaan runtime,
   tetap tanpa dependensi eksternal).
4. **Arah dependensi satu arah:** `frontend → preload → ipc → services → core`.
   Tidak ada impor balik.

## 2. Peta folder

### `src/backend/core/` — domain murni
| Modul | Isi |
|---|---|
| `db.js` | Akses SQLite + seluruh query (summary, timeseries, targets, intel akun, compare, export rows). Memo `summary` per `intelGen`. |
| `intel.js` | Mesin skor risiko (bit/poin) + deteksi klaster (kontrak bio, caption seragam, serentak). |
| `import.js` | Parse CSV/XLSX/tempel-link; deduplikasi; batas 10.000 baris. |
| `export.js` | Rekap autentisitas + tulis `.xlsx` (ExcelJS). |
| `policy.js` | Allowlist host IG/TikTok, klasifikasi error, backoff, budget kunjungan. |
| `rateLimiter.js` | Token bucket persisten (worker-state.json) + proyeksi pace. |
| `taskCache.js` | Cache hasil fetch (TTL) untuk hemat kuota. |
| `storage.js` | Helper JSON file-backed (window/worker/review state). |
| `util.js` | Normalisasi username/URL, parse tanggal UTC, dsb. |

### `src/backend/services/` — IO & orkestrasi
| Modul | Isi |
|---|---|
| `worker.js` | State machine worker: klaim task → scrape → simpan → reschedule; backoff; budget siklus/harian/sesi. |
| `scraper.js` | Jendela tersembunyi IG/TikTok + injeksi `scraper-content/*`; ekstraksi metrik. |
| `updater.js` | electron-updater → GitHub Releases (`com.sunscrap.app`). |
| `avatar.js` | Cache avatar ke disk; diekspos renderer via skema `sa-avatar://`. |

### `src/backend/ipc/` — adapter
Satu pintu `registerIpc()` yang membagi ke tiga domain:
`data.js` (worker/antrean/audit/import/export), `system.js` (pembaruan, info/backup/restore DB),
`review.js` (tinjauan manual + hapus akun). `helpers.js` menyimpan push event, validasi angka,
dialog native, dan pembersihan avatar.

### `src/frontend/` — UI murni
- `format.js` / `store.js` — helper murni **dual-mode** (window global di renderer,
  CommonJS di `node --test`) agar nol dependensi dan 100% teruji.
- `js/` — 17 modul ESM. `main.js` adalah **composition root** (satu-satunya tempat yang tahu
  pemetaan tab → loader). Enkapsulasi: state di `state.js`, bridge di `helpers.js`,
  primitif DOM + modal di `dom.js`.
- Tidak memakai framework/bundler: ES modules native + CSP `script-src 'self'`.

## 3. Kontrak IPC (preload)

Namespace `window.sunscrap` (dipilih agar stabil sejak v1):

- **worker**: `workerStart/workerStop/workerStatus/openLogin`
- **baca**: `getSummary/getQueueStats/getTimeseries/getAudits/getTargets/getAccounts/
  getAccountDetail/getTargetHistory/getLatest/getCompare/search`
- **tulis**: `createAudit/appendTargets/importLinks/rerunAudit/retryFailed/retryTargets/
  enqueueProfileVisits/updateAudit/deleteAudit/clearAll/exportExcel/exportCount`
- **db**: `dbInfo/dbBackup/restorePreview/restoreCommit`
- **pembaruan**: `updateState/checkForUpdates/installUpdate`
- **aplikasi**: `setTheme/openExternal/clearSession/getLoginStatus/copyDiagnostics/openDataFolder`
- **tinjauan**: `reviewList/reviewSet/reviewDelete`
- **event push**: `onEvent(cb)` — `worker` | `data` | `menu` | `update`

Konvensi: `data:*` selalu mengembalikan `{ … }` polos (bukan throw); error dilaporkan sebagai
`{ error: string }`. Renderer menampilkan toast dari `error` bila ada.

## 4. Aliran data (contoh: refresh Ringkasan)

1. `main.js` → `refreshDashboard()` → `getSummary(auditId)` (invoke).
2. `ipc/data.js` memvalidasi `auditId` → `db.getSummary(id)` (memo per intelGen).
3. Renderer menghitung `summarySignature`; bila sama dengan render terakhir, **hanya**
   memperbarui `dash-sub` (mencegah tooltip grafik terputus tiap 5 detik).
4. `renderKpis/renderTrend/renderStackbar/…` menggambar dari state murni;
   panel risiko akun lewat `intel.refreshAccountIntel()` (1 fetch `getAccounts({sort:'risk'})`,
   cache 4 detik, dipakai badge sidebar + kartu Perlu tinjauan + panel Akun).
5. Aksi tulis → `dataChanged()` → broadcast `data` → renderer melakukan poll terdebounce (400 ms).

## 5. Keputusan desain yang disengaja

| Keputusan | Alasan |
|---|---|
| `node:sqlite` bawaan (bukan better-sqlite3) | Nol dependensi native; cukup untuk skala ini; diuji di CI `npm test`. |
| Rawat dual-mode untuk `format.js`/`store.js` | Test murni tanpa jsdom; tidak perlu bundler di renderer. |
| `titleBarOverlay` + `titleBarStyle:'hidden'` | Kontrol jendela native mengikuti tema (set lewat `app:theme`). |
| Worker menyembunyikan ke **tray** saat close | Worker berjalan di latar; keluar permanen via tray/menu. |
| Skema `sa-avatar://` (non-standard) | Cegah Chromium menormalkan host → 404; path divalidasi (`resolveAvatar`). |
| Render-gate `summarySignature` | Polling 5 detik tanpa menggambar ulang grafik bila data tak berubah. |

## 6. Migrasi v1 → v2

- `src/main/**` → `src/backend/{core,services,ipc}` + `ipc.js` (17 kB) dipecah menjadi
  `data/system/review`; `createStorage` diekstrak ke `core/storage.js`.
- `src/renderer/**` → `src/frontend/**`; `app.js` (1718 baris) dipecah menjadi modul ESM;
  `format.js`/`store.js` pindah tanpa perubahan logika (tes tetap hijau: 80/80).
- Kontrak preload **tidak berubah** → tidak ada breaking change untuk fitur v1.
- Versi skema DB tetap **v5** (tidak ada migrasi data).
