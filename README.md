# sunscrap

Audit engagement **Instagram & TikTok** berulang — aplikasi desktop lokal (Windows), tanpa API berbayar.
Mengimpor tautan postingan, mengunjungi profil/post secara berkala, menyimpan snapshot metrik, lalu
menyajikannya sebagai **alat kerja**: apa yang harus dikerjakan sekarang, siapa yang mencurigakan,
dan apa yang berubah sejak kunjungan terakhir.

**v2.0.0 — interface baru total** (“Matahari di atas Mica”) dengan arsitektur **backend/frontend terpisah**
secara bersih. Lihat [CHANGELOG.md](CHANGELOG.md) dan [docs/DESIGN.md](docs/DESIGN.md).

## Fitur utama

- **Ringkasan (action-first)** — membuka aplikasi langsung menjawab: ada yang perlu ditindak?
  - Kartu *Perlu tinjauan / Target gagal / Belum diproses* (klik → langsung ke tempatnya)
  - KPI strip (views, terverifikasi, tingkat berhasil, akun terpantau)
  - Tren 30 hari (SVG, tooltip, ganti metrik) + **komposisi status** (stacked bar, klik → filter Target)
- **Target** — tabel padat: sort per kolom, filter status/masalah/platform/tema, seleksi massal,
  `Δ views` / `Δ likes` vs snapshot sebelumnya, ER, **pemilih kolom** (persisten), export `.xlsx`.
- **Akun** — tabel + skor indikasi (bukan vonis) dengan bukti: flag, akun tertaut, seri bulanan;
  keputusan tinjauan manual (*ditandai / bersih / konfirmasi*) dan mode triase **Perlu tinjauan**;
  **kuadran Followers × Reach** (scatter, log + median, titik berwarna level) membantu memilah
  akun berpengaruh vs jangkauan-rendah.
- **Proses** — pace rate limiter real-time, budget siklus/harian/sesi, komposisi antrean, log aktivitas
  terbaru dengan pesan error apa adanya.
- **Sesi & Login** — status sesi IG/TikTok + browser internal persisten (`persist:sunscrap`).
- **Pengaturan** — audit (ulang/kunjungi profil/edit/hapus), backup & restore database (dengan safety
  backup otomatis), pembaruan dari GitHub Releases, tema (sistem/terang/gelap), kepadatan tabel.
- **Privasi** — semua data tersimpan lokal (`userData` OS); tidak ada telemetri; hanya IG/TikTok yang
  dihubungi, sesuai klik Anda.

## Menjalankan (pengembangan)

```bash
npm install
npm start            # atau klik dua kali START_sunscrap.bat
```

Prasyarat: Node.js 22+, Windows (target utama; `node:sqlite` bawaan runtime Electron).

## Verifikasi

```bash
npm test             # 80 unit test (node --test)
npx electron scripts/smoke.js   # smoke require-graph + DB + worker (di runtime Electron)
node scripts/e2e.js  # e2e Playwright (import file & tempel link, tanpa error console)
node scripts/interact.js     # uji interaksi menyeluruh (profil sekali pakai)
node scripts/responsive.js   # matriks screenshot 1024–1920px (semua tab)
node scripts/audit-responsive.js   # audit overflow/kesesuaian modal-popover (8 lebar x 4 tinggi, semua fitur)
node scripts/audit-polish.js       # audit kerapian: nama aksesibel, kliping teks, alignment tombol
node scripts/audit-contrast.js     # audit kontras WCAG (semua pasangan >= 4.5:1)
node scripts/screenshot.js   # tangkapan layar semua tab (dev helper, .screens/)
```

## Struktur proyek (v2)

```
src/
  backend/            # proses utama Electron — "backend"
    core/             #   domain murni: db, intel, import, export, policy, rateLimiter,
                      #   taskCache, storage, util
    services/         #   orchestration/IO: worker, scraper, updater, avatar
    ipc/              #   adapter tipis renderer ↔ backend (data / system / review)
    main.js           #   bootstrap: DB, worker, tray, jendela (titleBarOverlay)
  frontend/           # "frontend" — tanpa Node integration, murni UI
    index.html
    styles.css        #   design system v2 (mica/acrylic)
    format.js         #   helper murni (dual-mode: window global + CJS untuk test)
    store.js          #   state murni (dual-mode)
    js/               #   modul ESM: composition root (main.js) + per layar
  preload/preload.js  #   jembatan aman (contextBridge); satu-satunya kontrak FE↔BE
  scraper-content/    #   skrip injeksi IG/TikTok
  test/               #   unit test (node --test)
docs/                 #   ARCHITECTURE.md · DESIGN.md
```

Pemisahan frontend/backend bersifat **keras**: renderer tidak pernah menyentuh Node/`ipcRenderer`;
semua lewat `window.sunscrap` (preload) → `ipcMain.handle` → core/services. Lihat
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Pintasan keyboard

| Pintasan | Aksi |
|---|---|
| `Ctrl K` | Command palette (aksi + pencarian global) |
| `Ctrl 1…6` | Pindah tab (juga: `G` lalu `1…6`) |
| `G` `T` | Mode triase **Perlu tinjauan** |
| `Ctrl I` / `Ctrl E` | Import / Export data |
| `Ctrl Shift B` | Cadangkan database |
| `?` | Daftar pintasan |
| `Esc` | Tutup dialog |

## Membangun installer

```bash
npm run dist           # NSIS installer (release/)
npm run dist:portable  # versi portable
```

Rilis resmi dibangun lewat GitHub Actions (tag `v*`), lihat `.github/workflows/release.yml`.

## Lisensi

MIT — lihat [LICENSE](LICENSE).
