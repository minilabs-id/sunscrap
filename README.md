# sunscrap — Desktop

Aplikasi desktop (Electron) untuk audit keterlibatan kampanye influencer di **Instagram & TikTok**
secara berkala, tanpa API berbayar dan sepenuhnya **lokal**. Data diambil dari halaman publik lewat
jendela browser tersembunyi yang sudah login.

Ditulis ulang dari nol sebagai satu runtime Node/Electron — tanpa Python, tanpa Chrome extension,
tanpa server HTTP. File lama `social-auditor` tidak diubah dan tidak dipakai.

> **Platform:** Windows saja (resmi — `"os": ["win32"]`). macOS/Linux tidak didukung.

## Jalan pintas

| Aksi | Tombol |
|---|---|
| Import data | `Ctrl+I` |
| Export | `Ctrl+E` |
| Cadangkan database | `Ctrl+Shift+B` |
| Pencarian global | `Ctrl+K` |
| Buka tab (1..6) | `Ctrl+1` … `Ctrl+6` |
| Menu aplikasi | `Alt` |

## Menjalankan

```bash
npm install
npm start
```

Prasyarat: **Node ≥ 22.13** (untuk `node:sqlite`; runtime Electron sudah dibundel — tidak perlu Python).
Untuk *hanya* menjalankan aplikasi (`npm start`), Node hanya dibutuhkan untuk `npm` (Electron membawa runtime-nya).

Saat pertama dibuka, login dulu ke Instagram/TikTok lewat menu tray **Login Instagram** / **Login TikTok**,
lalu **Mulai worker**.

Data tersimpan di folder `userData` OS (mis. `%APPDATA%\sunscrap\`):
- `sunscrap.db` — SQLite (audit, target, snapshot, akun)
- `worker-state.json` — state throttle (budget kunjungan, sesi)
- `avatars/` — cache avatar lokal

## Membuat installer `.exe`

```bash
npm run dist
```

Hasil: `release/sunscrap-setup-<versi>.exe` (NSIS).

## Alur kerja

1. **Dashboard → + Import data** → pilih CSV/XLSX berisi kolom `Link`/`URL` (postingan IG/TikTok), atau tempel link.
2. **Proses / tracer** → **Mulai worker**. Setiap siklus mengunjungi akun sekali lalu post-nya.
3. **Data · Target / Akun** → pantau hasil, delta, dan skor risiko akun ternak/kembar.
4. **Pengaturan** → audit ulang, ulangi gagal, kunjungi profil, export Excel, cadangkan database.

## Arsitektur

```
src/
├── main/
│   ├── main.js          # bootstrap: DB, worker, tray, jendela, updater
│   ├── db.js            # SQLite (node:sqlite) — model data & query
│   ├── intel.js         # mesin skor akun ternak/kembar (murni)
│   ├── worker.js        # loop: klaim → kunjungi → scrape → lapor (pacing)
│   ├── rateLimiter.js   # throttle keselamatan (budget siklus, warm-up, fatigue)
│   ├── taskCache.js     # pakai ulang metrik hasil kunjungan profil
│   ├── scraper.js       # BrowserWindow tersembunyi + injeksi isolated-world
│   ├── avatar.js        # unduh & cache avatar lokal (allowlist + magic bytes)
│   ├── updater.js       # cek pembaruan GitHub Releases (dalam pengembangan)
│   ├── import.js        # parse CSV/XLSX
│   ├── export.js        # export Excel (exceljs) + rekap
│   ├── policy.js        # allowlist host + taksonomi error
│   └── ipc.js           # handler IPC
├── preload/preload.js   # jembatan contextBridge
├── renderer/            # dashboard (HTML/CSS/JS, tanpa framework)
├── scraper-content/     # scraper IG & TikTok (disuntik ke isolated world)
└── test/                # node --test (murni, tanpa Electron)
```

Penjelasan lengkap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Dokumentasi

- [docs/](docs/README.md) — indeks lengkap
- [Arsitektur](docs/ARCHITECTURE.md) · [Model data](docs/DATA-MODEL.md) · [Skor intel](docs/SCORING.md)
- [Keamanan & privasi](docs/SECURITY.md) · [Operasional](docs/OPERATIONS.md) · [Backlog](docs/BACKLOG.md)
- [Audit terbaru](docs/AUDIT-2026-11-05.md) · [Riwayat audit](docs/AUDIT-HISTORY.md) · [CHANGELOG](CHANGELOG.md)

## Pengujian

```bash
npm test          # node --test "src/test/**/*.test.js" (tes murni: db, intel, throttle, policy, cache, util, import, export)
npm run e2e       # kendarai UI nyata (Electron + Playwright): import file & tempel link
npx electron scripts/smoke.js   # smoke runtime tanpa jendela
```

## Keamanan & batasan

- Seluruh akses hanya ke host Instagram/TikTok; allowlist host cocok persis.
- Jendela hidden memakai `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- Pacing adalah upaya pengurangan agresivitas; platform tetap dapat membatasi akses.
- Skor "akun ternak/kembar" adalah **indikasi otomatis untuk prioritas tinjauan**, bukan vonis; keputusan tetap di tangan manusia + bukti.

Rincian: [docs/SECURITY.md](docs/SECURITY.md).

## Pembaruan otomatis

Sejak fitur ini aktif, aplikasi memeriksa pembaruan (GitHub Releases) saat boot + setiap 6 jam; panel
**Pengaturan → Pembaruan** menampilkan versi, progres unduh, tombol "Muat ulang & perbarui", dan link
catatan rilis. Tray juga punya **Periksa pembaruan…**. Fitur nonaktif saat dijalankan lewat `npm start`
(hanya aktif di build terpasang). Detail & keputusan rilis: [PLAN-AUTO-UPDATE-2026-11-05.md](PLAN-AUTO-UPDATE-2026-11-05.md).

## Tanda tangan kode

Installer saat ini **belum ditandatangani** (Smart App Control/SmartScreen dapat memperingatkan atau
memblokir di mesin lain). Pipeline rilis (`​.github/workflows/release.yml`) sudah disiapkan untuk tanda
tangan via **SignPath Foundation** (gratis untuk OSS) — langkah signing masih dikomentari sampai approval
dan secret `SIGNPATH_*` tersedia. Untuk mesin pribadi, `START_sunscrap.bat` bisa dipakai sebagai jalan pintas.

## Status rilis

Versi **1.0.0** (lihat [CHANGELOG.md](CHANGELOG.md)). Rilis publik pertama perlu dipasang manual; sejak
versi ber-updater, pembaruan berikutnya otomatis.

> **Peringatan jujur (ToS):** alat ini mengambil data dari halaman publik Instagram/TikTok *tanpa* API
> resmi, yang dapat melanggar ketentuan layanan platform. Akun operator dapat dibatasi, ditantang login,
> atau diblokir. Data publik bukan berarti bebas diproses. Gunakan untuk kebutuhan sendiri dengan tanggung
> jawab masing-masing.
