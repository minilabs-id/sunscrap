# Operasional

## Prasyarat

- **Windows 10/11** (satu-satunya platform yang didukung — `os: ["win32"]`).
- **Node ≥ 22.13** (untuk `node:sqlite`). Untuk sekadar menjalankan `npm start`, Node hanya dibutuhkan oleh npm —
  runtime Electron sudah dibundel.
- Tidak perlu Python, Chrome extension, atau server.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm install` | Pasang dependensi |
| `npm start` | Jalankan aplikasi (Electron) |
| `npm test` | Tes murni `node --test "src/test/**/*.test.js"` (tanpa Electron) |
| `npm run e2e` | Kendarai UI nyata (Electron + Playwright): import file & tempel link |
| `npm run dist` | Installer NSIS → `release/sunscrap-setup-<versi>.exe` |
| `npm run dist:portable` | Biner portable |
| `npm run dist:dir` | Build tanpa installer (folder) |

Utilitas: `npx electron scripts/smoke.js` (smoke runtime, tanpa jendela), `node scripts/monitor.js` (baca DB read-only).

## Menjalankan

1. `npm install` lalu `npm start`.
2. Menu tray → **Login Instagram** / **Login TikTok** (login sekali; tersimpan di partisi `persist:sunscrap`).
3. Dashboard → **＋ Import data** → pilih CSV/XLSX berkolom `Link`/`URL`, atau tempel link.
4. **Mulai worker** (dashboard/tray). Pantau di **Proses**.
5. **Pengaturan** → audit ulang, ulangi gagal, kunjungi profil, export Excel, cadangkan DB.

## Lokasi data

Di `userData` OS (mis. `%APPDATA%\sunscrap\`):

| Berkas | Isi |
|---|---|
| `sunscrap.db` (+ `-wal`, `-shm`) | Audit, target, snapshot, akun |
| `worker-state.json` | State throttle (budget, siklus, sesi) |
| `window-state.json` | Posisi/ukuran jendela |
| `avatars/` | Avatar lokal (nama file, bukan URL) |
| `pre_restore_<ts>.db` | Safety backup sebelum restore |

Override folder data untuk pengujian: env `SA_USER_DATA`.

## Env var pengujian

| Env | Efek |
|---|---|
| `SA_USER_DATA` | Timpa folder userData |
| `SA_AUTOSTART_WORKER=1` | Mulai worker otomatis saat boot |
| `SA_IMPORT_FILE` | Stub dialog import ke satu berkas (hanya saat `!app.isPackaged`) |
| `SA_E2E_FILE` | Berkas xlsx untuk `npm run e2e` |

## Penanganan masalah

| Gejala | Sebab / solusi |
|---|---|
| Installer diblokir / "unknown publisher" | Installer belum ditandatangani (Smart App Control/SmartScreen). Gunakan `START_sunscrap.bat` untuk mesin pribadi, atau tanda tangani installer (lihat rencana auto-update). |
| Worker berhenti "Sesi login berakhir 3× berturut" | Login ulang lewat tray, lalu `Mulai worker`. |
| Worker berhenti "Platform membatasi akses 3× berturut" | Tunggu jeda (THROTTLED 10 menit / AUTH 20 menit), lalu lanjut. |
| "Budget kunjungan siklus ini habis" | Batas 500 kunjungan/siklus atau 2000/hari. Tunggu hari berikutnya atau jalankan ulang siklus. |
| Tabel kosong / data tidak muncul | Cek filter & dropdown "Semua audit → audit". Beberapa panel gagal-baca masih diam (lihat BACKLOG). |
| Restore ditolak | Cadangan beda `SCHEMA_VERSION` atau memilih DB aktif. Pulihkan dengan versi aplikasi yang cocok. |
| Avatar tampil inisial | File cache hilang/korup atau host tidak di-allowlist (fallback memang begitu). |
| DB besar/lambat | `snapshots` tak di-retensi; backup lalu pertimbangkan arsip. |
| "Pembaruan" bilang mode pengembangan | Fitur updater hanya aktif di build terpasang, bukan `npm start`. |
| Pembaruan gagal senyap | Cek log (`[sunscrap] updater ...`); bisa jadi rate limit GitHub atau feed/rilis belum ada. |

## Pembaruan & rilis CI

- Cek pembaruan: otomatis saat boot + tiap 6 jam, manual dari tray **Periksa pembaruan…** atau
  **Pengaturan → Pembaruan**.
- Rilis otomatis: `.github/workflows/release.yml` — push tag `v*` → build di `windows-latest` → `npm test`
  → `electron-builder --publish always` ke GitHub Releases. `workflow_dispatch` = build verifikasi (artifacts saja).
- Signing (SignPath Foundation) masih opsional/terkomentari sampai approval; lihat README → "Tanda tangan kode".

## Rilis

1. Naikkan `version` di `package.json` (satu sumber; `APP_VERSION` mengambil dari sana).
2. `npm test` hijau.
3. `npm run dist`.
4. Verifikasi installer di mesin bersih.

> Untuk distribusi publik, signing + auto-update dibahas di `PLAN-AUTO-UPDATE-2026-11-05.md`.
