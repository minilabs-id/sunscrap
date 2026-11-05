# Changelog

Semua perubahan penting proyek ini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/),
versi mengikuti [SemVer](https://semver.org/lang/id/).

## [Unreleased]

## [1.1.0] - 2026-11

### Ditambahkan
- **Dashboard v2 "Analyst Command Center"**: Hero "Total Views", KPI cards dengan sparkline & delta 7 hari,
  area chart tren 30 hari (Views/Likes/Post), donut status interaktif (klik isolate), funnel audit,
  perbandingan platform IG vs TikTok, performa tema, snapshot intel (distribusi risiko + klaster terkuat),
  kualitas data ber-CTA, dan perbandingan periode.
- **UI v2 ke seluruh tab**: Target (filter chips, delta Δ Likes/Δ Views, sparkline, sort header, keyboard
  rows), Akun (full-width table, skor bar, reach bar, klaster & distribusi risk bars), Proses
  (pace gauge, antrean progress bar, latest table dengan delta), Pengaturan (tabel Audit rich, Pembaruan,
  Tampilan tema, Database, Privasi & diagnostik).
- **API baca baru**: IPC `data:timeseries` / `db.getTimeseries()` (seri 7–120 hari, zero-fill) untuk area chart dashboard.
- **Indikator status login** (P3): IPC `app:loginStatus` + preload `getLoginStatus()` — boolean
  (IG/TikTok) dari cookie partisi tersembunyi, ditampilkan di tab Proses (`#login-status`).
  Perbaikan atas hilangnya indikator saat UI ditulis ulang.
- **Data delta target**: `getTargets` kini mengembalikan `prev_likes/views/comments`, `delta_likes`, `delta_views`.
- **Tangkapan intel di ringkasan**: `summary.levels` untuk distribusi level risiko (tab Akun).
- **Dokumen desain**: `docs/DESIGN.md` spesifikasi v2 + mockup statis `docs/mockup/sunscrap-redesign.html`.
- **Aksesibilitas**: baris tabel & kartu KPI keyboard-focusable (`tabindex`/`role="button"`/`Enter`/`Space`),
  `:focus-visible`, kontras teks AA, `prefers-reduced-motion` dihormati, status `running` berdenyut vs `pending`.
- **Tema gelap**: toggle token-based, ikon matahari/bulan, `color-scheme: dark`.
- **Tema Dashboard terang & modern**: hero terang (krem + aksen matahari), panel sisi transparan, teks gelap — tanpa blok gelap.
- **Kepadatan tabel**: Normal/Padat/Lapang + mode **Otomatis** yang mengikuti lebar jendela (padat < 1280, normal 1280–1679, lapang ≥ 1680).
- **Pemilih tema tersegmen**: radio tema di Pengaturan dirender sebagai kontrol tersegmen (Sistem/Terang/Gelap).
- **Auto-update dari GitHub Releases** (`electron-updater`): modul `src/main/updater.js`, handler IPC
  `update:state`/`update:check`/`update:install`, metode preload, item tray "Periksa pembaruan…", dan panel
  **Pengaturan → Pembaruan** (versi, cek, progres unduh, "Muat ulang & perbarui", link catatan rilis).
  Feed `build.publish` (provider github) + `nsis.differentialPackage`.
- Workflow rilis `.github/workflows/release.yml` (tag `v*` → build+test+publish; `workflow_dispatch` → artifacts).

### Diubah
- Gaya visual: palet parchment + navy + aksen matahari (dari biru generik), tipografi lebih tegas, layout
  command-center dengan hierarki jelas (hero → KPI → tren → detail).
- Footer statusbar: aksen live dot, versi tetap sinkron dengan `package.json` (v1.1.0).
- `APP_VERSION` kini bersumber tunggal dari `package.json` (`repository` ditambahkan; `release` script).
- **Responsif & elastis**: `.main` dibatasi lebar + di-center (monitor lebar), sidebar & search box fluid (`clamp`),
  tipografi/padding hero berskala (`clamp`), grid KPI 2×2 di <1360px.

### Diperbaiki
- Angka tidak konsisten antarpanel (sekarang satu sumber data).
- Delta 0% tampil `0,0%` dengan format benar (`▲`/`▼` tidak muncul di sekitar nol).
- Tabel terpotong horizontal di jendela <1200px; layout akun kini full-width.
- Grafik area: sumbu, baseline, tooltip interaktif; antrean: bar berbasis flex tidak terpotong.
- Jendela tidak mengingat ukuran/posisi (`window-state.json` tidak pernah dimuat) — kini pembacaan storage diperbaiki.
- Label ujung sumbu-X terpotong di chart — kini berjangkar start/middle/end.

### Catatan
- Installer belum ditandatangani (SignPath Foundation masih approval) → `verifyUpdateCodeSignature: false`
  sementara; aktifkan `true` bersamaan dengan signing.

### Dokumentasi
- `docs/DATA-MODEL.md` — API baca v2 & delta target.
- `docs/ARCHITECTURE.md` — `data:timeseries`, renderer v2 command center.
- `docs/BACKLOG.md` — 2 item P1 ditutup (keyboard-aktivasi, status running/pending).
- `docs/README.md` menautkan `docs/DESIGN.md`.
- Dokumentasi dikonsolidasikan ke folder `docs/` (`ARCHITECTURE`, `DATA-MODEL`, `SCORING`, `SECURITY`,
  `OPERATIONS`, `AUDIT-*`, `BACKLOG`). Laporan audit lama dihapus dari root (isinya diarsipkan).

## [1.0.0] — 2026-11

### Ditambahkan
- Aplikasi desktop Electron (Windows) untuk audit engagement Instagram & TikTok berulang, sepenuhnya lokal.
- Import CSV/XLSX (kolom `Link`/`URL`) & tempel link; worker dengan pacing (budget siklus, rail harian,
  istirahat sesi, warm-up, fatigue); scraping via `BrowserWindow` tersembunyi (isolated world).
- Mesin intel "akun ternak/kembar" (skor, klaster, seri bulanan) + detail akun.
- Dashboard KPI, tabel Target & Akun (filter/sort/pager), Proses (antrean/ETA/aktivitas), tab Browser,
  Pengaturan (audit, DB, tema, privasi), pencarian global (Ctrl+K).
- Export Excel (Data + Rekap dengan ER & delta), backup/restore DB dengan safety backup.
- Cache avatar lokal (protokol `sa-avatar:///`), taksonomi error, allowlist host, CSP ketat.
- 53 tes murni (`node --test`) + smoke + e2e.

### Diperbaiki
- Seluruh temuan audit 2026-11-05 K-1…K-5, T-1…T-8, M-1…M-18, F-1…F-15 (kecuali yang ditunda) —
  rincian di `docs/AUDIT-HISTORY.md`.

### Keamanan
- Restore menolak sumber = DB aktif & skema tidak cocok; avatar hanya host CDN ter-allowlist dengan
  magic-byte + cap ukuran; `LIKE` di-escape; SQL 100% parameterized.

[Unreleased]: https://github.com/startupmini/sunscrap/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/startupmini/sunscrap/releases/tag/v1.1.0
[1.0.0]: https://github.com/startupmini/sunscrap/releases/tag/v1.0.0
