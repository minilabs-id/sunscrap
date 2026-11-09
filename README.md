# sunscrap

Audit engagement **Instagram & TikTok** berulang — aplikasi desktop lokal (Windows), tanpa API
berbayar. Mengimpor tautan postingan, mengunjungi profil/post secara berkala, menyimpan snapshot
metrik, lalu menyajikannya sebagai **alat kerja**: apa yang harus dikerjakan sekarang, siapa yang
mencurigakan, dan apa yang berubah sejak kunjungan terakhir.

**v2.0.0 — interface baru total** (“Matahari di atas Mica”) dengan arsitektur **backend/frontend
terpisah** secara bersih. Lihat [CHANGELOG.md](CHANGELOG.md) dan [docs/DESIGN.md](docs/DESIGN.md).

## Fitur utama

- **Ringkasan (action-first)** — membuka aplikasi langsung menjawab: ada yang perlu ditindak?
  - Kartu *Perlu tinjauan / Postingan gagal / Sebagian / Belum diproses* (klik → langsung ke tempatnya)
  - KPI strip (Total views · Terverifikasi · Tingkat berhasil · Jumlah akun), semua bisa diklik (deep-link)
  - **Performa terburuk** Instagram & TikTok — akun dengan *median ER terendah* (≥ 2 post terukur)
  - **Top konten** Instagram & TikTok — postingan dengan views/likes tertinggi
  - **Per platform** (Instagram vs TikTok) + **Perbandingan antar periode**
  - **Kualitas data** — daftar masalah (tanpa followers / sebagian / tanpa views / tanpa handle /
    belum di-scrape) masing-masing dengan **tombol eksekusi** (kunjungi profil / scrape ulang)
- **Postingan** — tabel padat: sort per kolom, filter status/masalah/platform, seleksi massal,
  `Δ views` / `Δ likes` vs snapshot sebelumnya, ER, **pemilih kolom** (persisten), **buka di browser
  sesi**, export `.xlsx` (mengikuti filter aktif), dan jumlah baris per halaman (50/100/300).
- **Akun** — tabel + skor **indikasi** (bukan vonis) dengan bukti: flag, akun tertaut, seri bulanan;
  keputusan tinjauan manual (*ditandai / bersih / konfirmasi*) dan mode triase **Perlu tinjauan**;
  **kuadran Followers × Reach** (scatter); penanda **data basi** & **belum bisa dinilai**.
- **Proses** — indikator **live collect** (nama akun yang sedang diproses + estimasi % + bar progres),
  ringkasan antrean, aktivitas terbaru (Δ vs kunjungan sebelumnya), dan *detail teknis* (rate limiter).
- **Sesi & Login** — status sesi IG/TikTok + browser webview persisten (`persist:sunscrap`) yang
  memenuhi seluruh jendela; **Hubungkan browser** (ekstensi pendamping) untuk sinkronisasi sesi —
  lihat [docs/SESSION-BRIDGE.md](docs/SESSION-BRIDGE.md).
- **Pengaturan** — audit (audit ulang / kunjungi profil / edit / hapus via menu), backup & restore
  database (dengan safety backup otomatis), pembaruan dari GitHub Releases, tema (sistem/terang/gelap),
  kepadatan tabel.
- **Mesin intel (anti akun ternak/kembar)** — skor risiko dari sinyal publik: jangkauan rendah,
  komentar nyaris nol, unggahan bertumpuk/serentak, **caption sama & mirip** lintas akun, kontak bio
  sama, followers datar/lonjakan — dengan **klaster** akun tertaut dan catatan *"belum bisa dinilai"*
  saat data tak lengkap.
- **Privasi** — semua data tersimpan lokal (`userData` OS); tidak ada telemetri; hanya IG/TikTok yang
  dihubungi, sesuai klik Anda.

## Menjalankan (pengembangan)

```bash
npm install
npm start            # atau klik dua kali START_sunscrap.bat
```

Prasyarat: Node.js 22+, Windows (target utama; `node:sqlite` bawaan runtime Electron).

> Catatan: di mesin dengan *Smart App Control*, pakai `node_modules\electron\dist\electron.exe .`
> (executable unsigned `release\win-unpacked\sunscrap.exe` bisa keblokir).

## Verifikasi

```bash
npm test             # 106 unit test (node --test)
npx electron scripts/smoke.js   # smoke require-graph + DB + worker (di runtime Electron)
node scripts/e2e.js  # e2e Playwright (import file & tempel link, tanpa error console)
node scripts/interact.js     # uji interaksi menyeluruh (profil sekali pakai)
node scripts/audit-responsive.js   # audit overflow/kesesuaian modal-popover (8 lebar x 4 tinggi)
node scripts/audit-polish.js       # audit kerapian: nama aksesibel, kliping teks, alignment tombol
node scripts/audit-contrast.js     # audit kontras WCAG (semua pasangan >= 4.5:1)
node scripts/bridge-smoke.js       # smoke bridge sesi (ekstensi pendamping)
npx electron scripts/bench.js      # benchmark latensi mesin (1k/5k/10k target)
```

## Struktur proyek (v2)

```
src/
  backend/            # proses utama Electron — "backend"
    core/             #   domain murni: db, intel, import, export, policy, rateLimiter,
                      #   taskCache, storage, util
    services/         #   orchestration/IO: worker, scraper, updater, avatar, bridge
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
  docs/               #   ARCHITECTURE.md · DESIGN.md · AUDIT.md · SESSION-BRIDGE.md
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

Rilis resmi dibangun lewat GitHub Actions (tag `v*`).

## Lisensi

MIT — lihat [LICENSE](LICENSE).