# Audit Ulang Interface & Usulan Penataan — sunscraping Desktop

**Tanggal:** 5 Nov 2026 · **Basis:** working tree `D:\sunscraping-desktop` HEAD `feb048b` **+ WIP belum di-commit** (restore DB dari backup: `db.js`/`ipc.js`/`preload.js`/`app.js`; platform filter + pager Akun di `index.html`). **Baseline resmi: Windows-only** (keputusan pemilik produk 2026-11-05 → `titleBarOverlay` sah sebagai solusi permanen; macOS/Linux tidak lagi jadi target).

**Peran & niat:** mengaudit ulang interface apa adanya (bukan menambal dokumen lama), lalu memberikan **saran penataan yang lebih baik, mulai dari menu aplikasi hingga tata letak**. Dokumen ini tidak mengubah file sumber. Temuan keamanan/kode yang sudah ditangani di `AUDIT-2026-11-04.md`, `AUDIT-v3-2026-11-04.md`, `AUDIT-UIUX-2026-11-05.md` tidak diulang — yang dinilai: **apa yang terasa di tangan operator** setelah semua perbaikan itu masuk.

**Cara membaca:** §2 = verifikasi kondisi sekarang (jujur: banyak yang sudah beres). §3 = temuan segar, difokuskan ke **menu → judul jendela → sidebar → tata letak → urutan konten**. §4 = **usulan penataan baru** (inti dokumen). §5 = WIP yang harus tuntas. §6 = urutan pengerjaan. §7 = pertanyaan terbuka.

---

## 1. Ringkasan eksekutif

Perbaikan pasca-audit-UIUX sudah masuk jauh: menu aplikasi hidup lagi, jendela diingat ukurannya, export berpagar lingkup, clear-*all* mengetik `HAPUS`, toast punya `aria-live`, modal punya `role="dialog"` + jebakan fokus, avatar tidak lagi bocor ke CDN, dark mode & print CSS ada. Ini **bukan lagi prototipe yang ceroboh**.

Tapi secara **penataan**, aplikasinya masih berbentuk *"tumpukan panel mulai dari atas"*, dan menunya masih *"menu bawaan Electron yang dikembalikan role-nya"* — bukan menu yang didesain. Tidak ada satu pun jawaban visual untuk tiga pertanyaan yang selalu ditanyakan operator: **di mana saya · apa yang sedang berjalan · apa yang harus saya lakukan**. Tiga perbaikan struktural menutup 80% dari itu:

1. **Judul jendela berhenti menduplikasi brand; sidebar dapat grup & ikon; dokumen `.title` ikut konteks.** (murah, satu sore)
2. **Settings dipecah jadi ruangan yang jelas + Tentang in-app** (restore sudah ada di backend — tinggal diexpose dengan rapi).
3. **Status bar persisten di bawah** (28px): worker · audit · sesi IG/TT · DB · backup terakhir · versi — orientasi permanen tanpa membuka apa pun.

Skor kasar sekarang vs sesudah usulan §4: Chrome **B− → A−**, IA & navigasi **C+ → B+**, tata letak **C → B+**, keseluruhan **B−/C+ → A−/B+**.

---

## 2. Verifikasi — apa yang SUDAH beres sejak audit UIUX (jangan dikerjakan dua kali)

| Temuan audit 2026-11-05 | Status di HEAD+WIP | Bukti |
|---|---|---|
| T-01 Export bocor lingkup `done` | ✅ **Beres** | `app.js` `statusToExport()` → `DONE`; `db.js:1515` `DONE → s.status IN ('OK','PARTIAL')`; preview `exportCount` + modal lingkup + baris "Baris: N"; status `pending/running` ditolak dengan toast |
| T-02 Keystroke = recompute | ✅ **Beres** (dgn catatan) | `debounce(...,300)` di `#target-q`/`#account-q`; intel O(n²) dimaterialisasi (`5c6e5aa`). **Catatan:** tetap tanpa *request-sequence guard* — lihat F-4 |
| T-03/I-4 Busy-state & double-submit | ⚠️ **Sebagian** | Modal konfirmasi ada; tombol async **belum** lewat `withBusy` (Export/Backup/Restore/Clear masih bisa diklik ganda) |
| T-04 `catch {}` merata | ⚠️ **Sebagian** | Jalur tulis sudah toast; jalur baca masih menelan: `loadRiskAccounts` (`app.js:265`), `loadProcess` (`app.js:428`), `refreshDashboard` (`app.js:587`), `db-info` (`app.js:442`) |
| T-05 A11y inti | ✅ **Beres** (inti) | Nav `<button>` + `aria-current="page"` + `aria-label` nav; global `:focus-visible` (`styles.css:26`); modal `role="dialog" aria-modal` + trap Tab + restore fokus + `modal-open` (`pointer-events:none`); toast `role=status aria-live`, error 8 dtk; checkbox `aria-label`; `scope="col"` **belum** (lihat F-11); baris tabel **belum** keyboard-activatable |
| T-06 Menu & window chrome | ✅ **Beres** | `buildAppMenu()` (Berkas/Edit/Tampilan/Jendela/Bantuan → Tentang); `autoHideMenuBar`; window-state `window-state.json` (bounds+maximized) dipulihkan; tray/`second-instance`/`activate` → `showMainWindow()` tunggal; `will-navigate` hanya dokumen sendiri; webview `sandbox` + allowlist `isSocialHost`; close→minimize ke tray |
| T-07 Avatar CDN | ✅ **Beres** | `sa-avatar:` protocol + cache lokal (`userData/avatars`), CSP `img-src 'self' data: sa-avatar:` |
| T-09 Proses basi / ETA | ✅ **Beres** | `setInterval` 5 dtk me-refresh Proses saat aktif; ETA tampil (≈ menit); banner login kedaluwarsa (`#auth-banner`) berbasis `lastError` AUTH |
| T-10 Destruktif tanpa gesekan | ✅ **Beres** | Clear-all: ketik `HAPUS` + checkbox "Cadangkan dulu" (default on) + impact copy; hapus audit menyebut N target + tidak-bisa-dibatalkan |
| T-11 Restore | ✅ **Backend beres, UI WIP** | `inspectBackup` (integrity + tabel wajib + hitungan) + `restoreDatabase` (safety copy dulu) + IPC `db:restorePreview/Commit` + tombol `#btn-restore` di Settings — **[WIP] di working tree** |
| K-1 Kontras token | ✅ **Beres** | `--ok #047857`, `--warn #b45309`, `--ig #be185d` |
| K-3/K-4/K-5 Fokus · reduced-motion · print | ✅ **Beres** | Global `:focus-visible`; `prefers-reduced-motion`; `@media print` lengkap (sembunyikan chrome, `@page` implisit, font tabel 10pt) |
| K-2/T-15 Dark mode | ✅ **Ada** (limitasi) | Via `prefers-color-scheme: dark` saja; **tidak ada toggle eksplisit** di Settings |
| D-2 Kolom "Di-scrape" | ✅ **Beres** | Kolom `Di-scrape` = `relTime()` (tooltip absolut via `fmtWhen`) |
| T-04 toast "error sticky + aksi" | ⚠️ **Sebagian** | Error 8 dtk max-3-di-layar; belum ada tombol aksi (Coba lagi/Salin error) |
| T-08/C-1/C-2 Dashboard bisu (delta/tren/sparkline) | ❌ **Belum** | `getCompare` di preload (`api.getCompare`) **masih tak pernah dipanggil**; tidak ada delta/sparkline/tren |

---

## 3. Temuan segar (difokuskan menu → penataan)

> Severity: **P0** = rusak/menyesatkan sekarang · **P1** = merusak kepercayaan/efisiensi harian · **P2** = pemolesan berdampak. Semua mengacu file:baris di HEAD+WIP.

### 3.1 Menu aplikasi (native) — hidup tapi belum didesain

- **M-1 [P1] `Berkas` kosong fungsional.** Isinya hanya `fileMenu` (Keluar). Padahal menu adalah tempat paling wajar untuk 2 aksi yang paling sering dicari: **Import data…** dan **Export…**. Klik menu = jangkauan keyboard penuh tanpa UI baru; biayanya 2 item + IPC broadcast ke renderer (atau reuse `openNewAudit`/`openExport` via channel baru `menu:action`).
- **M-2 [P2] Tidak ada tindakan menu untuk perpindahan tab.** Ctrl+1..6 belum ada — tidak di menu, tidak di `before-input-event`. Sidebar button saja = mouse-only navigation untuk alat yang dipakai berjam-jam.
- **M-3 [P2] Menu Tampilan tidak menampung tema.** Dark mode ada tapi hanya mengikuti sistem; menu Tampilan berisi zoom + fullscreen saja. Tambah **Tema: Terang / Gelap / Ikuti sistem** (`type: 'radio'`) — satu tempat yang dicari semua pengguna desktop. Persist ke `userData/config.json` (atau localStorage renderer — cukup).
- **M-4 [P2] `autoHideMenuBar: true` tanpa rambu.** Menu baru muncul saat Alt — pengguna yang tidak tahu tidak akan pernah menemukannya; pengguna yang tahu tetap tidak tahu isinya. Pilihan sadar, tapi harus disertai **hint satu baris** di suatu tempat (status bar: "Alt = menu", atau di Tentang). Alternatif: `autoHideMenuBar: false` di layar ≥1440px. Keputusan produk, bukan teknis.
- **M-5 [P2] Tentang ada 2 pintu (menu + tray) dengan isi berbeda kualitas.** Tray memunculkan `showMessageBox` (teks), menu sama. Keduanya tidak menampilkan **versi, path DB, ukuran, tombol "Salin info diagnostik"** — H-2 audit masih berlaku. Native dialog tetap OK, tapi isi harus = Tentang in-app (lihat §4.6), atau jadikan native dialog sebagai "ringkas" dan menu Bantuan juga punya "Salin info diagnostik…" langsung.
- **M-6 [P3] Tidak ada akselerator `Ctrl+Q` eksplisit.** `fileMenu` role memberi Keluar, tapi tanpa `accelerator` — di Windows Ctrl+Q bukan kebiasaan universal; biarkan role mengurus (Ctrl+W/Alt+F4 tetap jalan), jangan dipaksakan. Hanya dicatat agar tidak diklaim di README sebagai shortcut.

### 3.2 Titlebar kustom — brand ganda, konteks nol

- **T-1 [P1] Judul jendela dan sidebar menampilkan `☀ sunscraping` berdampingan vertikal** (`index.html:11` vs `index.html:14`). 40px chrome terbuang untuk informasi yang sama, dan ☀ dipakai dua kali tanpa makna. Windows-only sekarang → `titleBarOverlay` sah; yang **tidak sah** adalah isinya.
- **T-2 [P1] Titlebar statis; `document.title` juga statis `sunscraping`.** Padahal titlebar adalah *satu-satunya* tempat yang selalu terlihat di taskbar/snap-preview. Harus membawa konteks: `sunscraping — Target · {nama audit}` / `— Proses`. Biaya: 3 baris di handler ganti-tab + `document.title` sync.
- **T-3 [P2] Padding kanan hardcoded `0 150px`** (`styles.css:51`) menyesuaikan overlay Windows 40px @100% DPI — tepat di skala 125/150% DPI perlu cek; `env(titlebar-area-*)` tidak didukung di Overlay Windows, jadi konsisten 150px OK, tapi dokumentasikan alasan di komentar (sudah ada) dan verifikasi di 150% scale.

### 3.3 Sidebar & informasi arsitektur (IA) — flat, tanpa grup, tanpa ikon

- **N-1 [P1] Enam item sejajar tanpa hierarki.** Urutan sekarang: Dashboard · Data·Target · Data·Akun · **Browser** · Proses · Pengaturan — dua permukaan "alat" (Browser) menyelip di tengah alur kerja utama; "Data ·" hanya prefiks string, bukan pengelompokan. Operator baru harus membaca keenamnya untuk tahu mana "kerja" dan mana "setelan".
- **N-2 [P2] Nol ikon di nav.** Semua teks 13px/`--muted`; pemindaian visual bergantung pada membaca, bukan mengenali. Dengan rail 230px, ikon 16px + label adalah pola universal (VS Code/Linear/Raycast) — juga membuka jalan ke rail 64px kelak.
- **N-3 [P2] Worker-widget: ide benar, satu kaki masih timpang.** Indikator kerja terbaik di aplikasi ini justru menampilkan **satu hal**; ia kehilangan: (a) sesi per platform (IG/TT) — padahal `lastError` AUTH sudah ada untuk banner, seharusnya juga berupa chip kecil; (b) antrean ("128 menunggu") — `getQueueStats` sudah ada di memori; (c) klik-segmen tidak ada.
- **N-4 [P2] Tidak ada identitas visual selain warna teks aktif.** `.nav-link.active` = background `line-soft` + teks biru; tanpa ikon, tanpa aksen kiri, aktif vs hover sulit dibedakan sekilas di layar terang. Aksen "sun" (amber) belum dipakai di nav sama sekali — satu tempat yang tepat untuknya.
- **N-5 [P3] 230px tetap; tanpa rail.** Di 1024px (min-width), sidebar memakan 22% lebar; tabel 11 kolom sisanya harus scroll horizontal. Minimal: collapse ke 64px (ikon saja) di ≤1200px, atau toggle manual.

### 3.4 Tata letak & density

- **L-1 [P1] Tidak ada `max-width` konten.** `.main` melebar penuh; di ≥1600px, panel Top-posts dan KPI 6 kolom menjulur, baris tabel jadi "lautan kolom", mata kehilangan jangkar. Konsol operator terbaik membatasi kolom kerja (~1200–1440px) atau memakai grid dua zona (konten + rail aksi). Sekarang keduanya tidak.
- **L-2 [P2] Skala padding `24px 28px` + gap 16px baik, tapi tidak ada ritme vertikal antar-halaman yang sama** — halaman Proses (`<header>+grid+panel`) dan Pengaturan (panel-panel rata) terasa seperti aplikasi berbeda.
- **L-3 [P2] `.table-wrap { max-height: calc(100vh - 240px) }`** — magic number; di 768px tinggi (layar kecil) sisa viewport untuk pager/toolbar lebih kecil dari yang diperkirakan → pager bisa terdorong keluar layar. Gunakan `flex:1; min-height:0` pada wrapper + layout kolom di `.tab` (`.tab.active { display:flex; flex-direction:column; height:100% }`).
- **L-4 [P2] KPI `.num` 28px statis.** Di 1024–1200px, 6 angka 28px + label uppercase berdesakan (@media 1200 mereduksi grid ke 3 kolom, tapi font tetap 28px). `clamp(20px, 2vw, 28px)` + `sub` tetap 12px.
- **L-5 [P3] Tidak ada pola "empty → CTA" yang konsisten** di lintas tab (Dashboard kosong hanya menampilkan nol; empty state Akun sudah manusiawi, Target `Tidak ada target.` netral tanpa arah aksi). Empty state tanpa CTA = operator bingung pada run pertama (C-7 audit masih berlaku).

### 3.5 Per halaman — penataan urutan konten

**Dashboard**
- **D-A [P1] Angka bisu masih bisu.** `getCompare` tidak dipanggil; KPI tidak punya delta/arah; tidak ada tren sama sekali; urutan blok: KPI → 2 panel top-post → platform|risk → kualitas. Yang hilang dari *atas* fold: **"apa yang perlu saya lakukan"** (action strip: error AUTH · antrean + ETA · backup terakhir). Dashboard harus dibuka oleh status, bukan angka.
- **D-B [P2] "Post teratas (views)" & "(ER)" tanpa pasangan konteks.** ER tanpa views menyesatkan; keduanya tanpa lencana platform & tanggal scrape; tidak ada n post pada judul panel. Tampilkan `handle · platform · views · ER · reltime` per baris, toggle sort views/ER, klik → modal target.
- **D-C [P3] "Perlu tinjauan" masih label mentah** — skor mentah `skor 6` tanpa alasan (`flags[0].label`) dan tanpa disclaimer "indikasi, bukan vonis".

**Target**
- **T-A [P1] Header tabel tidak bisa diklik untuk sort** — hanya dropdown; tidak ada `aria-sort`. Harapan universal pengguna spreadsheet.
- **T-B [P2] Tidak ada select-all per halaman** (`<th>` kosong) dan tidak ada **sticky bulk-action bar**; aksi terpilih tersebar di toolbar kanan ("Ulangi terpilih" saja; Export terpilih belum).
- **T-C [P2] Pagination minim** — hanya ‹ Prev / Next › + "Hal x/y"; belum ada page-size (25/50/100), "1–50 dari N", input lompat. Untuk ribuan baris wajib.
- **T-D [P2] Tidak ada chip filter aktif + reset satu klik** — operator lupa bahwa filter status masih aktif lalu mempertanyakan datanya. Header sudah menampilkan `N target` (bagus, pertahankan).

**Akun** — lihat juga WIP §5
- **A-A [P1] WIP setengah jadi: platform filter + pager tampil tapi tidak melakukan apa-apa.** `index.html` punya `#account-platform` dan `#accounts-prev/next`; `loadAccounts()` tidak membacanya, tidak ada listener; backend **sudah mendukung** (`getAccountIntel` menerima `platform`/`offset`). Kontrol mati > kontrol tidak ada — harus tuntas atau dicopot sebelum commit.
- **A-B [P2] `limit: 200, sort: 'risk'` masih hardcode** — akun ke-201 tersembunyi; sort dropdown (Skor/Followers/Reach/Bulan teramati) belum ada.
- **A-C [P2] Legend rumus (`Skor: 0 bersih · 2 amati…`) masih tampil mentah**; belum ada modal "Bagaimana skor dihitung?" + disclaimer + aksi **hapus data akun ini** (UU PDP).
- **A-D [P3] Kolom "Bulan" ambigu** (bukan "bulan ke-") → rename "Bln teramati" + `title`.

**Browser**
- **B-A [P1] Tombol reload ⟳ tidak menjadi ■ Stop saat loading**, dan tidak ada progress bar 2–3px di atas webview — operator tidak tahu halaman sedang memuat/gagal. `did-start-loading`/`did-stop-loading` tersedia di webview.
- **B-B [P2] Tidak ada "Buka di browser luar ↗" eksplisit** — jalan keluar untuk "saya tidak percaya tampilan ini" (sudah ada secara implisit via `openExternal` untuk host non-sosial, tapi tidak ada tombol untuk URL yang sedang dibuka).
- **B-C [P2] Banner sesi bersama belum ada** — logout di sini mematikan worker; tidak satu kata pun mengatakannya. Satu baris info + "Kelola sesi →" (pindah ke Pengaturan).
- **B-D [P3] Posisi "Browser" di nav utama** — lihat usulan §4.3; browser adalah *alat*, bukan langkah alur.

**Proses**
- **P-A [P1] "OK"/"Gagal" di kartu Antrean adalah total seumur hidup** padahal dibaca sebagai "sekarang". Pisahkan grup: **Sekarang** (Menunggu · Berjalan + ETA) vs **Total (kecil, muted)**; atau pindahkan OK/Gagal ke Dashboard. (`getQueueStats` akumulatif — v2-I.)
- **P-B [P2] Banner AUTH hanya muncul saat `lastError` cocok regex** — itu heuristik rapuh; minimal tambahkan teks instruksi ("Buka Login Instagram / TikTok untuk menyegarkan sesi"), dan tampilkan sebagai status chip permanen "IG: aktif/tidak diketahui" bila memungkinkan (probe cookie — fase 2).
- **P-C [P3] Tabel "Aktivitas terbaru" tanpa filter platform** dan tanpa aksi (klik baris → modal riwayat target, pola sudah ada di Target).

**Pengaturan**
- **S-A [P1] Tiga konteks tanpa pemisahan** — Audit CRUD (kerja harian) · Database/backup/restore (infra) · Danger (seumur hidup) ditumpuk rata; tidak ada Tentang; tidak ada Privasi & data; tidak ada Tampilan. Ini halaman tempat pengguna membangun (atau kehilangan) kepercayaan.
- **S-B [P1] "Hapus sesi login" dinaikkan ke `btn-danger` (WIP) tapi tetap tanpa konfirmasi** — satu klik = IG & TT logout = worker mati. Danger tanpa modal adalah kontradiksi. Wajib dialog konfirmasi (boleh non-ketik; sebutkan konsekuensinya + tombol danger).
- **S-C [P2] Tidak ada "Salin info diagnostik"** (versi, path DB, ukuran, jumlah baris, OS, Electron) — setiap laporan bug = tanya-jawab manual.
- **S-D [P3] Empty state audit masih basi:** `"Belum ada audit. Klik \"+ Audit baru\"."` (`app.js` `renderAudits`) padahal tombolnya bernama "＋ Import data".

### 3.6 Modal, toast, umpan balik

- **O-1 [P2] `.th scope="col"` hilang di semua tabel**; baris `.clickable` tidak `tabindex=0` + Enter/Space — hanya mouse. (a11y sisa, kecil tapi mengikat standar "desktop terbaik".)
- **O-2 [P2] Toast belum punya aksi/sticky/riwayat** — error 8 detik lalu hilang; tidak ada "Coba lagi"/"Salin error"; tidak ada lonceng + panel kejadian. Untuk operator, satu error export yang hilang = kerja sia-sia.
- **O-3 [P3] Mikro-copy campur** — "Ulangi terpilih" vs "Ulang (hari)" vs "Audit ulang"; `📄`/`⟳`/`＋`/`‹ ›` emoji & glyph arbitrer; elipsis tidak konsisten; raw ISO di modal **Riwayat target** (`(s.scraped_at||'').slice(0,16)` — `app.js` `openTarget`) padahal kolom lain sudah `relTime`/`fmtWhen`.
- **O-4 [P3] Ikon tidak ada satu pun sebagai SVG** — seluruh aksara simbol (✕/‹/›/⟳/＋) bergantung font sistem; saat font fallback, bentuk berubah. Satu spritesheet Lucide menghilangkan seluruh kelas masalah ini.

### 3.7 Chrome desktop & distribusi (dampak UI)

- **C-A [P2] `package.json` belum deklarasi `"os": ["win32"]`** padahal Windows-only diputuskan; README juga belum menyatakannya — pengguna macOS yang mengunduh akan kecewa pada layar pertama. Satu baris + satu paragraf.
- **C-B [P2] `APP_VERSION = '1.0.0'` di `main.js`** — versi tidak pernah tampil di UI (belum ada Tentang in-app); rilis berikutnya tanpa changelog = tidak ada yang tahu apa berubah.
- **C-C [P3] Tidak ada auto-update / cek versi manual** — masih berlaku dari audit; minimal "Cek pembaruan" manual di Tentang yang membuka halaman rilis.

---

## 4. Usulan penataan yang lebih baik (menu → tata letak)

Prinsip: **satu aksi utama per layar · hierarki terlihat · keyboard = mouse · chrome jujur (tidak palsu, tidak bisu) · ruang kosong dihormati.**

### 4.1 Menu aplikasi (native, Windows) — desain ulang isi, pertahankan `autoHideMenuBar`

```
Berkas     Import data…            Ctrl+I
           Export…                 Ctrl+E
           ─────────────────────────
           Cadangkan database…     Ctrl+Shift+B
           ─────────────────────────
           Keluar
Edit       (tetap: Undo/Redo/Cut/Copy/Paste/Select All)
Tampilan   Tema ▸  Terang / Gelap / Ikuti sistem   (radio, default: Ikuti sistem)
           ─────────────────────────
           Perbesar / Perkecil / Zoom normal
           Layar penuh
Buka       Dashboard  Ctrl+1 · Target  Ctrl+2 · Akun  Ctrl+3
           Proses     Ctrl+4 · Browser Ctrl+5 · Pengaturan Ctrl+6
Bantuan    Tentang sunscraping…
           Salin info diagnostik…
           ─────────────────────────
           Dokumentasi (buka README di folder app / GitHub)
```

- Item **Import/Export/Cadangkan** mengirim `menu:action` ke renderer (IPC broadcast) → `openNewAudit()` / `openExport()` / `btn-backup` handler. Tanpa UI baru = murah.
- **Buka ▸** alternatif: akselerator diregistrasi di renderer via `before-input-event` (lebih sedikit IPC). Pilih salah satu, jangan dua-duanya.
- Bantuan memuat **Salin info diagnostik…** langsung (H-2) — laporan bug jadi satu klik.
- Menu tetap `autoHideMenuBar` (F10/Alt memunculkan), **tapi** Tentang & status bar memberi rambu; alternatif dievaluasi setelah §4.5 (status bar) ada.

### 4.2 Titlebar — konteks, bukan brand

```
┌─ (ikon app 16px)  sunscraping — Target · Kampanye Nov ─────[ _ ▢ ✕ ]
```
- Brand di titlebar **dihilangkan**; teks = `sunscraping — {Tab}{audit? · nama audit}`; urutan tab di sidebar (4.3).
- `document.title` ikut (untuk Alt+Tab & snap): `Target — sunscraping`.
- Kanan (sebelum overlay native): opsional **pill `Ctrl+K`** (non-drag, klik = palette) — fase 2.
- Sidebar tetap memegang satu-satunya brand (`.brand`): logo mark + wordmark kecil; ☀ hanya di logo, bukan teks ganda.
- `padding-right:150px` dipertahankan + komentar alasan (sudah ada).

### 4.3 Sidebar — grup, ikon, badge; Browser turun kelas

```
┌─────────────────────────────┐
│ ☀ sunscraping               │   ← satu-satunya brand (17px, wght 700)
├─────────────────────────────┤
│ UTAMA                       │   ← 11px, faint, letterspaced
│  ◫ Dashboard                │
│ PEKERJAAN                   │
│  ≣ Target                   │   ← ikon SVG 16px (Lucide), aktif = aksen kiri amber + teks gelap
│  ◉ Akun        [3]          │   ← badge = jumlah terindikasi (opsional)
│  ⚙ Proses      ●            │   ← dot hijau saat worker aktif / merah saat AUTH error
│ ALAT                        │
│  🌐 Browser                 │   ← posisi setelah Proses; TOOLS tidak bersaing dgn alur
│ SISTEM                      │
│  ⚙ Pengaturan               │   (ikon beda: sliders)
├─────────────────────────────┤
│ WORKER                      │   ← kartu kecil, border-top
│ ● Aktif · siklus 3/8        │
│ [Hentikan worker]           │
│ IG ✓ · TT ✗ · 128 antre     │   ← dua baris kecil, muted
└─────────────────────────────┘
```
- Prefiks "Data ·" dihapus; urutan akhir: Dashboard · Target · Akun · Proses · Browser · Pengaturan.
- Ikon: satu spritesheet **Lucide** (`stroke 1.75`, 16px); ✕/‹/›/⟳/＋/📄 diganti SVG (I-8 audit).
- Badge/dot opsional & tenang; klik segmen worker = buka Proses.
- ≤1200px: sidebar collapse ke 64px (ikon saja, label hilang, tooltip via `title`); ≥1440px: 230px normal. Min 1024 tetap; <1024 di luar dukungan resmi (didokumentasikan).
- Keyboard: Ctrl+1..6 → tab; nav = `<button>` (sudah) + urutan fokus = visual.

### 4.4 Tata letak utama — batasi kolom, rapikan density

- **`.main`**: tambah `max-width: 1440px; margin-inline: auto;` di dalam area scroll (konten tidak menjulur di layar lebar; padding 24px dipertahankan).
- **Tab layout flex-kolom**: `.tab.active { display:flex; flex-direction:column; height:100% }` + `.table-wrap { flex:1; min-height:0; max-height:none }` — pager selalu terlihat, tanpa magic `240px`.
- **KPI**: `font-size: clamp(20px, 2vw, 28px)`; di <1200 tetap 3 kolom.
- **Ritme panel**: `.panel { margin-bottom:16px }` dipertahankan; halaman Settings memakai section heading seragam (§4.6) sehingga scroll-nya terasa satu desain.
- **Breakpoints resmi**: ≥1280 normal · 1024–1280 compact (KPI 3×2, grid-2 → 1 kolom — sudah ada) · <1024 tidak didukung (README).

### 4.5 Status bar (baru — komponen terkecil, orientasi terbesar)

28px, bawah, border-top, `font-size:11px`, `tabular-nums`, klik = aksi:

```
● Worker aktif 3/8  │  Audit: Kampanye Nov ▾  │  IG ✓ TT ✗  │  DB 42 MB  │  Backup: 2 jam lalu  │  v1.0.0
```
- Segment klik: Worker→Proses · Audit→popup ganti cepat · Sesi→Pengaturan · Backup→cadangkan sekarang · Versi→Tentang.
- Sumber data: poll yang sudah ada (5 dtk) + `getQueueStats`/`workerStatus`/`dbInfo` (debounce). Tidak ada query baru di hot path.
- Menjawab "di mana saya / apa yang berjalan / apa yang harus dikhawatirkan" secara permanen — **setelah ini, sidebar tidak perlu lagi memuat status**.

### 4.6 Pengaturan — tiga ruangan + Tentang (+ data & privasi)

Satu halaman, empat section dengan heading 12px caps + divider, urutan tetap:

1. **Audit** — tabel CRUD (sekarang), copy empty state diperbaiki ("Belum ada audit. Klik **Import data…**."), delete menampilkan dampak (sudah) + **ketik nama audit** bila audit punya >100 target? (opsional; cukup `HAPUS`-style untuk clear-all).
2. **Data & Cadangan** — `Cadangkan database…` (existing) · **`Pulihkan dari cadangan…`** (WIP — tampilkan file, hitungan, peringatan safety-copy, tombol danger) · `Hapus sesi login (IG & TikTok)` **dengan modal konfirmasi** (S-B) · info DB diperkaya: ukuran, WAL mode, `user_version`, jumlah audit/target/snapshot, **waktu backup terakhir**.
3. **Tampilan & Privasi** — Tema: Terang/Gelap/Ikuti sistem (radio; sync menu Tampilan) · "Aplikasi ini sepenuhnya lokal. Data login & data publik tersimpan di `{path}`. Tidak ada data yang dikirim ke luar." · tombol **Buka folder data** · **Salin info diagnostik** (versi, path DB, ukuran, hitungan, Electron, OS, `user_version`).
4. **Tentang** — logo mark, `sunscraping v{APP_VERSION}`, satu baris deskripsi, lisensi (MIT), **changelog ringkas** (rilis ini: daftar singkat), tautan README/LICENSE.

**Danger zone** dipindah paling bawah, border merah tipis (1px) terpisah, hanya "Hapus semua data" (sudah mengetik `HAPUS`) — tidak bercampur dengan Backup.

### 4.7 Dashboard — urutan yang menuntun (bukan menampilkan)

Atas→bawah:

1. **Action strip** (hanya muncul bila ada yang butuh; kosong → "Semua aman"): `⚠ 3 error AUTH beruntun — [Masuk IG lagi]` · `Antrean 128 (≈45 mnt) — [Lihat Proses]` · `Backup terakhir 5 hari lalu — [Cadangkan]`.
2. **KPI 6** dengan **delta vs run sebelumnya** (dari `api.getCompare`) — sub-baris `▲ 12 vs audit lalu` (netral; untuk "Gagal", naik = merah) + sparkline SVG 30 run untuk "Keberhasilan".
3. Grid 2: **Tren 30 run** (SVG garis OK/PARTIAL/FAILED) — atau jika mau minimal, sparkline di KPI saja di rilis pertama.
4. Grid 2: **Post teratas (views | ER)** — tampilkan `views · ER` berpasangan + lencana platform + reltime + `n post` di judul panel; klik → modal target.
5. Grid 2: **Per platform | Perlu tinjauan** (dengan alasan `flags[0].label` + disclaimer kecil "indikasi, verifikasi manual").
6. **Kualitas data** 3–5 angka (sekarang, bagus) + tautan "Detail →" (buka tab Target terfilter? fase 2).

### 4.8 Konsistensi lintas halaman (tabel ringkas)

| Pola | Aturan |
|---|---|
| Heading halaman | `h1` 20px 700 + satu `.page-actions` di kanan; tidak ada subheading lain di luar panel |
| Panel | `.panel` (10px radius, 16px pad); `panel-title` 16px 600 — tidak ada panel tanpa judul |
| Tabel | header sticky + `scope="col"`, kolom angka `.num` right + tabular-nums, baris `.clickable` `tabindex=0`+Enter, checkbox selalu `aria-label`, `<th>` pertama = select-all (halaman) |
| Aksi utama | satu `.btn-primary` per layar; destructive = `.btn-danger`; selalu `withBusy` + disabled saat jalan |
| Toast | 4 varian (info/ok/warning/error); error sticky + [Coba lagi]/[Salin error]; maks 3 |
| Tanggal | relatif `relTime()` + `title` absolut `fmtWhen()`; **nol** raw ISO (perbaiki modal Riwayat target) |
| Ikon | SVG Lucide 16/20px, `currentColor`; nol emoji/glyph di chrome |
| Copy | id-ID konsisten; elipsis `…` membuka dialog; kalimat = apa + kenapa + apa selanjutnya |

### 4.9 Yang sengaja TIDAK diubah

Arsitektur tanpa framework · preload minimal · CSP `img-src 'self' data: sa-avatar:` · tray-first + single instance · transaksi DB · `esc()` escaping · token warna hasil audit · `prefers-reduced-motion` · tabular-nums · sticky header. **Layout baru di atas, bukan penggantian.**

---

## 5. WIP yang harus tuntas (atau dicopot) sebelum commit berikutnya

1. **Akun: platform filter + pager mati** (`index.html`: `#account-platform`, `#accounts-prev/next`) — `loadAccounts()` tidak membacanya; backend sudah dukung `platform`/`offset`. **Tuntaskan**: state `accounts.limit/offset`, wiring listener, tampilkan `total`/`Hal x/y`, reset page saat filter berubah; atau dicopot bila belum sempat.
2. **Restore UI** (`#btn-restore` — sudah wired) — tinggal review manual end-to-end (pilih file gagal / sukses / safety backup muncul / setelah restore UI reload). Tambahkan `withBusy`.
3. **`#btn-clear-session` sekarang `btn-danger` tanpa modal** — tambahkan modal konfirmasi ("Sesi IG & TikTok dihapus; worker berhenti sampai login ulang.") + tombol danger.
4. **`#btn-restore` belum `btn-danger`** padahal mengganti seluruh data — samakan semantik (danger solid) + pertahankan copy "Safety backup otomatis".
5. **`APP_VERSION`/`package.json` vs Tentang** — bila §4.6 masuk, versi harus dibaca dari `package.json` (satu sumber), bukan konstanta ganda.
6. **`#global-audit` dibangun ulang tiap poll** (`loadAudits()` → `sel.innerHTML`) — lewati render bila `document.activeElement === sel`, atau diff daftar id.
7. **`loadAccounts` sort `risk` hardcode + `limit 200`** — sertakan dropdown sort atau setidaknya `offset` dari pager.

---

## 6. Urutan pengerjaan yang disarankan

**Sekarang (setengah–satu hari):** WIP §5.5.1–4 → titlebar §4.2 (brand dihilangkan, judul dinamis) → sidebar grup+ikon §4.3 → menu isi §4.1 (Import/Export/Tema/Buka/diagnostik) → `document.title` sync.
**Selanjutnya (1–2 hari):** status bar §4.5 → Settings 4 ruangan + Tentang + diagnostik §4.6 → clear-session modal → toast aksi/sticky §3.6 → `scope="col"` + baris keyboard §3.6.
**Sesudahnya (2–4 hari):** Dashboard revamp §4.7 (action strip + delta via `getCompare`) → Target header-sortable/select-all/page-size/chips §3.5 → Akun pager+sort+modal skor+hapus-akun §3.5 → Proses pemisahan Sekarang vs Total §3.5 → Browser progress/stop/↗/banner sesi §3.5.
**Kapan pun:** dark mode toggle (menu+settings) · `"os":["win32"]` di package.json + README · ganti sisa emoji → SVG · glosarium copy (satu halaman `COPY.md`) · empty-state checklist onboarding.

**Definisi selesai (interface):** operator baru menyebut tab & aksinya tanpa membaca README; tidak ada kontrol mati; tidak ada aksi destruktif tanpa konsekuensi yang tertulis; tidak ada angka layar yang tidak bisa dijelaskan ("sekarang" vs "sepanjang waktu"); Alt memunculkan menu yang berguna; dan aplikasi layak didemo ke klien pada layar 13"—27" tanpa meminta maaf.

---

## 7. Pertanyaan terbuka (keputusan produk, bukan teknis)

1. **Status bar §4.5** — masuk rilis berikutnya atau fase terpisah? (Rekomendasi: masuk — daemon orientasi ini murah.)
2. **Tema default** — Ikuti sistem (rekomendasi) atau Terang dulu?
3. **Browser** — tetap tab di nav utama (digolongkan ALAT §4.3, rekomendasi), atau dijadikan window utilitas terpisah (Ctrl+B) di rilis berikutnya?
4. **Aplikasi sepenuhnya lokal — klaim sekarang jujur?** Ya, setelah `sa-avatar:` (tidak ada request keluar dari renderer). Satu-satunya jalur keluar: `openExternal` & login IG/TT. Perlu satu baris di Tentang/Privasi menyatakan ini.
5. **Versi rilis berikutnya** — usulan **1.1.0** (P0+P1 audit lama + §4 di atas), changelog di Tentang & git tag; Electron sudah 45 (EOL Electron <35 teratasi; ikuti siklus LTS Electron).
6. **README/README_EN** — selaraskan klaim ("Windows-only", jalan pintas Ctrl+1..6/I/E/Shift+B, `os` field) saat rilis 1.1.0.

---

*Disusun sebagai bahan perbaikan; penulis dokumen tidak mengubah file sumber. WIP pengguna dibiarkan utuh. Semua file:baris mengacu working tree 2026-11-05 (HEAD feb048b + WIP).*
