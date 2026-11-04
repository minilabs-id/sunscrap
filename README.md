# sunscraping — Desktop

Aplikasi desktop (Electron) untuk audit keterlibatan kampanye influencer di **Instagram & TikTok**
secara berkala, tanpa API berbayar dan sepenuhnya **lokal**. Data diambil dari halaman publik lewat
jendela browser tersembunyi yang sudah login.

Ditulis ulang dari nol sebagai satu runtime Node/Electron — tanpa Python, tanpa Chrome extension,
tanpa server HTTP. File lama `social-auditor` tidak diubah dan tidak dipakai.

## Menjalankan

```bash
npm install
npm start
```

Prasyarat: Node 20+ (runtime Electron sudah dibundel; tidak perlu Python).

Saat pertama dibuka, login dulu ke Instagram/TikTok lewat menu tray **Login Instagram /**
**Login TikTok**, lalu **Mulai worker**.

Data tersimpan di folder `userData` OS (mis. `%APPDATA%\sunscraping\`):
- `sunscraping.db` — SQLite (audit, target, snapshot, akun)
- `worker-state.json` — state throttle (budget kunjungan, sesi)

## Membuat installer `.exe`

```bash
npm run dist
```

Hasil: `release/sunscraping-setup-<versi>.exe` (NSIS).

## Alur kerja

1. **Dashboard → + Audit baru** → pilih CSV/XLSX berisi kolom `Link`/`URL` (postingan IG/TikTok).
2. **Proses / tracer** → **Mulai worker**. Setiap siklus mengunjungi akun sekali lalu post-nya.
3. **Data · Target / Akun** → pantau hasil, delta, dan skor risiko akun ternak/kembar.
4. **Pengaturan** → audit ulang, ulangi gagal, export Excel, cadangkan database.

## Arsitektur

```
src/
├── main/
│   ├── main.js          # bootstrap: DB, worker, tray, jendela
│   ├── db.js            # SQLite (node:sqlite bawaan Electron) — model data & query
│   ├── intel.js         # mesin skor akun ternak/kembar (murni)
│   ├── worker.js        # loop: klaim → kunjungi → scrape → lapori (pacing)
│   ├── rateLimiter.js   # throttle keselamatan (budget siklus, warm-up, fatigue)
│   ├── taskCache.js     # pakai ulang metrik hasil kunjungan profil
│   ├── scraper.js       # BrowserWindow tersembunyi + injeksi isolated-world
│   ├── import.js        # parse CSV/XLSX
│   ├── export.js        # export Excel (exceljs) + rekap
│   ├── policy.js        # allowlist host + taksonomi error
│   └── ipc.js           # handler IPC
├── preload/preload.js   # jembatan contextBridge
├── renderer/            # dashboard (HTML/CSS/JS, tanpa framework)
├── scraper-content/     # scraper IG & TikTok (disuntik ke isolated world)
└── test/                # node --test (murni, tanpa Electron)
```

## Pengujian

```bash
npm test        # node --test src/test/ (32 tes: db, intel, throttle, policy, cache, util)
```

## Keamanan & batasan

- Seluruh akses hanya ke `127.0.0.1`/host Instagram/TikTok; allowlist host cocok persis.
- Jendela hidden memakai `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- Pacing adalah upaya pengurangan agresivitas; platform tetap dapat membatasi akses.
- Hanya scraping data publik; patuhi ToS masing-masing platform.