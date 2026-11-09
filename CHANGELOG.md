# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/id-ID/) · SemVer.

## [2.1.2] — 2026-11-09

### Diubah
- Matikan `differentialPackage` agar rilis GitHub tidak terpecah jadi entri duplikat (`.exe` + `latest.yml` saja, tanpa `.blockmap`).
- Pembaruan kini **memasang otomatis + membuka ulang** (auto-patch) setelah terunduh, tanpa klik "Muat ulang & perbarui".

## [2.1.1] — 2026-11-09

### Ditambahkan
- Tombol **"Unduh installer"** di Pengaturan → Pembaruan (tautan unduhan langsung ke `.exe` di GitHub Releases).
- Catatan keamanan Windows (Smart App Control / SmartScreen) agar pengguna tahu cara mengizinkan aplikasi unsigned.

## [2.1.0] — 2026-11-09

### Ditambahkan
- **Performa terburuk** Instagram & TikTok di Ringkasan — akun dengan median ER terendah (≥ 2 post terukur).
- **Indikator live collect** di Proses — nama akun yang sedang diproses + estimasi % + bar progres.
- Mesin intel: deteksi **caption mirip** lintas akun (selain caption identik), `median_shares`,
  catatan **"belum bisa dinilai"** (data tak lengkap), stopword dagang/CTA untuk menekan derau.
- Filter "Tanpa handle" & "Belum diproses" serta **jumlah baris per halaman (50/100/300)** di Postingan.
- Retry lintas audit: "Scrape ulang gagal/terpilih" & perbaikan Kualitas data di mode "Semua audit".
- Tombol eksekusi untuk **setiap** kasus Kualitas data (kunjungi profil / scrape ulang).
- "Buka di browser" untuk baris akun & postingan (Ringkasan & Postingan) + modal riwayat.

### Diubah
- **Terminologi:** "Target" → **"Postingan"** di seluruh UI (bukan kode/ID/SQL).
- Ringkasan: hapus "Tema teratas" & "Tren 30 hari"; Top konten dipecah IG/TikTok; Kualitas data
  disandingkan Per platform; KPI jadi klik-able (deep-link); relabel "Akun terpantau" → "Jumlah akun".
- Postingan: kolom default ringkas, filter berlabel + "Hapus filter" + "X dari Y", export ikut filter.
- Proses: dirombak minimal — antrean diringkas, aktivitas utama, detail teknis dilipat.
- Sesi: browser webview memenuhi tinggi & lebar jendela.
- Pengaturan: grid 4 kartu + menu kebab untuk aksi audit.

### Diperbaiki
- ER postingan IG memakai fallback follower akun (getSummary/getTargets/export).
- Invalidasi memo summary/intel saat task diantrekan (retry/repeat/reclaim).
- Kunjungan profil tidak lagi di-charge ganda ke budget kunjungan.
- `enqueueFix(null)` (mode "Semua audit") sebelumnya error "auditId tidak valid".
- `current` worker menunjuk task yang sedang jalan (bukan yang selesai).

## [2.0.0] — 2026-11-06

**Interface baru total** ("Matahari di atas Mica", Fluent-modern/Windows 11) + **pemisahan
arsitektur frontend/backend yang bersih**. Tanpa migrasi data (skema tetap v5); kontrak
preload tidak berubah.

### Berubah — UI/UX (total)

- **Design system baru**: mica berlapis + acrylic di titlebar/sidebar/statusbar; netral
  hangat; satu aksen (matahari) — `#f59e0b` tombol primer, `#d97706`/`#fbbf24` aksen teks;
  radius 6/8/10/14; bayangan halus; angka tabular; kontras AA.
- **App shell**: titlebar draggable dengan command bar terpusat (Ctrl+K, ↑↓/Enter untuk
  memilih), audit picker global; sidebar NavigationView (Kerja/Operasi/Sistem) dengan
  indikator aktif; statusbar minimalis (worker · audit · DB · pace · versi).
- **Ringkasan action-first**: kartu *Perlu tinjauan / Target gagal / Belum diproses*
  menempati posisi utama; KPI strip (views · terverifikasi · tingkat berhasil · akun
  terpantau); tren 30 hari (warna aksen, tooltip); **komposisi status diganti stacked bar**
  (klik segmen/legend → filter Target); tema teratas, top konten, per platform, kualitas data.
- **Anti-redundansi**: funnel & donut dihapus; `command-strip`, strip chip "Selesai",
  seksi Insights lipat dihapus; kontrol worker hanya di sidebar (+ detail di Proses);
  banner auth hanya muncul saat error bernuansa sesi.
- **Akun**: panel distribusi risiko + klaster utama tetap; skor ditampilkan sebagai bar +
  angka; mode triase **Perlu tinjauan** satu klik; modal detail = bukti dulu, lalu keputusan
  (ditandai/bersih/konfirmasi) dengan catatan; avatar dengan fallback inisial.
- **Target**: header sticky, sort per kolom (`aria-sort`), kolom Δ berwarna; empty state
  bermakna; pager lebih ringkas.
- **Proses**: pace sebagai meter linear (bukan arc 2020-an) + budget siklus/harian/sesi;
  antrean sebagai stacked bar + statistik; tabel aktivitas menampilkan pesan error apa
  adanya untuk baris gagal.
- **Sesi & Login**, **Pengaturan**: dipoles total; Pengaturan disusun per seksi (Audit,
  Database, Pembaruan, Tampilan, Privasi, Zona berbahaya). Tampilan memakai segmented
  control; DB info memakai chip; zona berbahaya tetap butuh ketikan konfirmasi.
- Empty state di semua tabel/panel; `[hidden]` benar-benar menyembunyikan; focus-visible
  2px aksen; dukungan `prefers-reduced-motion`.
- Density: Padat / Normal / Lapang (+ otomatis) — persisten (`localStorage`).

### Berubah — Arsitektur

- `src/main/**` → **`src/backend/{core,services,ipc}`**; `ipc.js` (17 kB) dipecah menjadi
  `ipc/data`, `ipc/system`, `ipc/review` + `helpers`; `createStorage` diekstrak ke
  `core/storage.js`.
- `src/renderer/**` → **`src/frontend/**`**; `app.js` (1718 baris) dipecah menjadi
  **17 modul ESM** (composition root `js/main.js`); helper murni `format.js`/`store.js`
  tetap dual-mode (window global ↔ CommonJS) sehingga `node --test` tetap murni.
- Arah dependensi satu arah: `frontend → preload → ipc → services → core`. IPC tanpa
  logika bisnis. `node --test` = 80/80 hijau; e2e Playwright OK; `scripts/smoke.js` OK.
- `package.json`: `main` → `src/backend/main.js`, versi **2.0.0**.

### Dokumentasi

- `README.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md` ditulis ulang untuk v2;
  dokumen v1 (AUDIT/UIUX/PLAN…) dihapus — histori tetap di git.

### Catatan upgrade

- Tidak ada migrasi data. Preferensi tema/kepadatan lama (`sa_theme`, `sa_density`) dipakai lagi.
- Pintasan baru: `G` `T` (Perlu tinjauan), `G` `1…6`, `?` (bantuan pintasan).

## [1.1.0] — 2026-11 (ringkas)

Hardening rilis: shortcut keyboard (G+…), command strip, rekap export autentisitas,
error worker tampil di tabel aktivitas + proyeksi sisa waktu, navigasi panah mini-tabs,
aria-sort.

## [1.x] — sebelumnya

Rilis pertama: audit berulang IG/TikTok, worker tray, intel skor + klaster,
backup/restore database, pembaruan otomatis via GitHub Releases. Lihat histori git.
