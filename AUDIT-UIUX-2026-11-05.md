# Audit UI/UX & Interface Mendalam — sunscraping Desktop

**Tanggal:** 5 Nov 2026 · **Peran:** frontend desktop senior · **Basis:** working tree `D:\sunscraping-desktop` (termasuk WIP belum di-commit: avatar akun IG/TikTok, `titlebar` kustom + `titleBarOverlay`, `Menu.setApplicationMenu(null)`, `mainWindow.maximize()`, CSP `img-src https:`, `scripts/monitor.js`). Referensi baris sesuai file pada saat ditulis.
**Verifikasi:** membaca penuh `index.html`, `styles.css`, `app.js`, `preload.js`, `main.js`, `ipc.js`, `README.md`; grep terarah; perhitungan kontras WCAG 2.1 (luminance relatif, diverifikasi ulang); pengecekan jalur IPC → preload → renderer.
**Sifat dokumen:** kritik + arah perbaikan. **Tidak ada file sumber yang diubah.** Temuan kode/perf/keamanan yang sudah tercatat di `AUDIT-2026-11-04.md` & `AUDIT-v3-2026-11-04.md` hanya diringkas di sini bila relevan dengan pengalaman pengguna.

> Konteks penting: ada **WIP besar yang belum di-commit** (fitur avatar + window chrome). Audit ini menilai hasil gabungan HEAD + WIP, dan menandai temuan yang lahir dari WIP dengan tag **[WIP]**.

---

## 1. Ringkasan eksekutif

Aplikasi ini **bukan "CRUD yang rapi" — ini alat operasi**: menentukan nasib sebuah kampanye, menyimpan bukti untuk klien, dan menyentuh sesi login yang sensitif. Ukur dengannya, dan UI-nya masih berperilaku seperti **prototipe data internal**, bukan alat produksi:

1. **Angka tanpa keputusan.** Dashboard menampilkan 6 KPI besar, nol perbandingan, nol tren, nol rekomendasi tindakan. Pengguna dijawab "apa", tidak pernah "lalu apa".
2. **Aksi destruktif & mahal terlalu mudah, umpan baliknya terlalu sunyi.** Hapus semua data = 1 klik + modal polos; export "Selesai (done)" diam-diam mengekspor **seluruh database** (`app.js:515`); error hilang 4 detik; hampir semua path gagal berakhir `catch {}`.
3. **Kecepatan yang tidak dihormati.** Ketik 1 huruf = 1 full-recompute DB (diukur v3: hingga ~74 dtk pada 1.500 akun) tanpa debounce dan tanpa penahan respons usang.
4. **Kehilangan fitur yang sudah dibayar.** Backend punya `data:search`, `data:compare`, `data:profileVisits` — **tidak pernah dipanggil** renderer (terverifikasi grep). Dashboard tidak punya satu pun grafik/tren padahal data snapshot ada.
5. **Chrome jendela tertinggal dari standar desktop 2026.** Tanpa dark mode, tanpa jendela About/versi/diagnostik, tanpa menu (shortcut edit hilang, macOS rusak), ukuran jendela tidak diingat, force-maximize, titlebar ganda "sunscraping".
6. **Kepercayaan & privasi bocor di tepi.** [WIP] avatar dimuat dari CDN IG/TikTok (IP + waktu akses bocor, bertentangan dengan klaim "sepenuhnya lokal") tanpa `referrerpolicy`, tanpa fallback `onerror`, CSP `img-src` dilonggarkan ke `https:` global.

**Verdict satu kalimat:** fondasi visualnya bersih dan rapi, tetapi produknya belum berani bicara — belum menuntun, belum melindungi, belum mengakui ketidakpastian. Yang dibutuhkan bukan restyle, melainkan **naik kelas dari "dashboard angka" menjadi "konsol operator yang dipercaya"**.

### Skor per area (A terbaik)

| Area | Nilai | Inti |
|---|---|---|
| Bahasa visual & konsistensi token | B+ | Radius/spacing/shadow konsisten; tabular-nums; sticky header |
| Hirarki informasi & layout | C+ | Semua panel bobot sama; tidak ada "perlu tindakan" |
| Alur inti (import → worker → review) | C+ | Bisa diselesaikan, tapi tanpa preview/guard/aktivasi berantai |
| Umpan balik & error | **D** | Silent failure; toast menghilang; tanpa aksi pemulihan |
| Aksesibilitas (keyboard/SR/kontras) | **D** | Nav tak fokus; nol `:focus-visible`; modal tanpa role; 3 warna gagal AA |
| Kecepatan persepsi | **D−** | 1 keystroke = 1 recompute O(n²) tanpa debounce |
| Chrome desktop (jendela/menu/tray) | **D** | Maximize paksa; menu null; bounds tidak diingat; titlebar [WIP] rapuh |
| Privasi & kepercayaan UI | D | Avatar CDN [WIP]; tanpa notice privasi; sesi bersama tidak dijelaskan |
| Copy & i18n | C− | Campur aduk; tanggal mentah; label basi; emoji tombol |
| **Rata-rata UI/UX** | **D+ / C−** | "Rapi tapi bisu, cepat tapi ceroboh" |

Target realistis setelah perbaikan P0+P1: **B** (lihat §9).

---

## 2. Yang sudah baik — jangan diutak-atik

- **Tabular-nums** untuk semua kolom angka; **sticky table header** + `max-height`; **locale id-ID** untuk angka; **escaping** disiplin (`esc()`) di seluruh render string.
- **Token CSS** rapi (`--line`, `--surface-sunken`, radius 8/10/12, satu shadow-pop); grid 8px implisit konsisten; **breakpoint 1200px** untuk KPI/grid-2 sudah ada.
- **Empty state manusiawi** ("Belum ada data.") — nada kalimat tepat, tinggal diberi CTA.
- **Sidebar worker-widget** (dot status + tombol utama + subteks siklus) adalah ide yang **benar**: status kerja selalu terlihat. Pertahankan, promosikan jadi status bar penuh.
- **Modal terstruktur** (head/body/foot) + Esc menutup + backdrop klik — kerangka bagus, tinggal ARIA + fokus.
- **Danger = merah solid**, primary = biru — semantik warna benar; **checkbox bulk + "Ulangi terpilih (N)"** — pola yang tepat.
- **Preload minimal & CSP ketat** — arsitektur aman, jangan dilemaskan demi kenyamanan (lihat §4-K soal CSP `img-src`).
- **Tray-first + single instance** — benar untuk alat latar; reuse window yang ada, jangan `createMainWindow()` baru (lihat U-10 v2, masih relevan).
- **Export anti formula-injection** di `export.js` — bagus; kurang: scope-nya bisa salah (lihat T-04).

---

## 3. Peta temuan (ringkas)

| ID | Temuan | Severity |
|---|---|---|
| T-01 | Export scope bocor: filter "Selesai (done)" → ekspor **semua** diam-diam | **P0** |
| T-02 | Ketik = full-recompute tanpa debounce/stale-guard (hingga ~74 dtk @1.500 akun) | **P0** |
| T-03 | Import tanpa pratinjau; tombol tanpa busy-state → double-submit/duplikat | **P0** |
| T-04 | Umpan balik gagal: `catch {}` merata; toast 4 dtk tanpa aksi/riwayat | **P0** |
| T-05 | A11y nihil: nav `<a>` tak fokus; nol `:focus-visible`; modal tanpa role/trap | **P0** |
| T-06 | Chrome: `Menu null` (shortcut edit hilang; macOS rusak); force-maximize; bounds tidak diingat | P1 |
| T-07 | [WIP] Avatar dari CDN: bocor privasi; tanpa `referrerpolicy`/`onerror`; CSP `img-src https:` | P1 |
| T-08 | Tidak ada delta/tren/ETA; `data:compare` tidak dipakai; Dashboard "angka bisu" | P1 |
| T-09 | Proses basi: polling tidak me-refresh tab Proses; KPI seumur hidup, bukan "sekarang" | P1 |
| T-10 | Aksi destruktif tanpa gesekan (clear-all tanpa ketik/opsi backup; hapus audit tanpa dampak) | P1 |
| T-11 | Backup tanpa restore; tidak ada About/versi/diagnostik/log; tidak ada "Salin info diagnostik" | P1 |
| T-12 | Tab Browser: URL arbitrer di sesi login; tanpa progress/stop; tanpa "buka di browser luar" | P1 |
| T-13 | Kolom waktu scrape hilang di tabel Target; tidak ada select-all/sticky bulk-bar/page-size | P2 |
| T-14 | Kontras gagal AA: `--warn` 3.19 · `--ok` 3.77 · `--ig` 4.23; toast hijau juga gagal | P2 |
| T-15 | Tanpa dark mode; tanpa print/PDF; tanpa `prefers-reduced-motion`; tanpa forced-colors | P2 |
| T-16 | Copy basi & campur: "+ Audit baru" (basi) vs "＋ Import data"; 📄; tanggal ISO mentah; jargon skor | P2 |
| T-17 | Ctrl+K command palette + `data:search` (sudah ada di backend, nol di UI) | P2 (berdampak besar) |
| T-18 | Global search/history/log aktivitas tidak ada; `data:search` & `data:profileVisits` jadi kode mati | P2 |
| T-19 | `#global-audit` dibangun ulang tiap poll; dropdown kehilangan fokus | P3 |
| T-20 | Window bounds tidak persisten; titlebar [WIP] duplikat brand + tidak portabel macOS | P3 |
| T-21 | Avatar & identitas visual lemah: tanpa ikon, tanpa warna aksen; ☀ dipakai 2× (titlebar+sidebar) | P3 |
| T-22 | Settings mencampur 3 konteks (Audit CRUD / Bernilai tinggi / Danger) tanpa pemisahan; tidak ada Tentang | P2 |

---

## 4. Temuan mendalam per area

### A. Chrome jendela, menu, tray, taskbar

**A-1. [WIP] Titlebar kustom setengah matang.** `main.js` (WIP): `titleBarStyle:'hidden'` + `titleBarOverlay {color:'#ffffff', height:40}`; `index.html:11` menambah `.titlebar` drag-region; `styles.css:37-53` memberi `padding: 0 150px 0 16px` (ruang tombol min/max/close Windows).
- `titleBarOverlay` **hanya Windows/Linux**; di macOS traffic-lights tampil di **kiri** dan akan menutupi teks (padding kiri hanya 16px). Cross-platform kacau.
- **Brand diduplikasi**: titlebar ("☀ sunscraping") dan sidebar (`.brand`, `index.html:14`) — dua label identik menumpuk vertikal; tinggi 40px terbuang.
- Teks titlebar statis; tidak menampilkan konteks (tab aktif / nama audit) — kesempatan menampilkan status yang hilang.
- **Arah:** di Windows pakai `titleBarOverlay` + CSS var resmi (`env(titlebar-area-x/width)`) bila tersedia, atau set `padding-right` dari tinggi overlay yang sama (40) dan **hilangkan brand di titlebar** — jadikan titlebar murni drag + judul konteks (mis. "sunscraping — Target · Audit Nov") + tombol aksi global slot kanan (mis. Ctrl+K hint). Di macOS: `hiddenInset` + `trafficLightPosition`. Atau **kembalikan bingkai native** — lebih jujur daripada chrome palsu yang rapuh.

**A-2. `Menu.setApplicationMenu(null)` menghilangkan kontrak desktop.** (`main.js` boot, WIP)
- Semua accelerator peran hilang: **Undo/Cut/Copy/Paste/Select All** (fatal di macOS; di Windows/Linux Chromium masih menangani sebagian di input, tapi menu konteks & shortcut eksplisit hilang), tidak ada **Reload/DevTools**, tidak ada **Quit (Ctrl+Q)** terstandar, tidak ada **Help → About**.
- **Arah:** pasang menu minimal dengan `role`: `file` (Keluar), `edit` (undo/redo/cut/copy/paste/selectall — wajib), `view` (reload tersembunyi di prod: `enabled:false` atau hanya DevTools di dev), `window` (min/zoom?), `help` (**Tentang sunscraping…** → modal versi + "Salin info diagnostik"). Biaya ~30 baris, mengembalikan 90% affordance desktop.

**A-3. `mainWindow.maximize()` paksa saat boot.** (WIP) — mencuri keputusan pengguna; layar kecil/portrait jadi sempit. **Arah:** simpan `getBounds()` + `isMaximized()` ke `userData/window-state.json` (atomik, pola sudah ada di `createStorage`), pulihkan saat boot dengan validasi display masih ada; default pertama kali = maximized boleh, setelah itu **ikuti pengguna**.

**A-4. Ukuran minimum vs konten.** `minWidth:1024`, grid KPI 6 kolom hanya muat longgar di ≥1280; `@media 1200` mereduksi ke 3 kolom — bagus. Tapi **tidak ada penanganan < 1024** (mis. stack sidebar jadi rail ikon) dan **tidak ada `will-resize` reflow test**. Untuk "desktop terbaik", tetapkan breakpoint resmi: ≥1280 normal, 1024–1280 compact (KPI 3×2), <1024 = minimal didukung (bukan target).

**A-5. Tray "Buka dashboard" selalu membuat jendela baru** (`main.js:121`), padahal `second-instance` & `activate` juga memanggil `createMainWindow()`. **Setiap klik = BrowserWindow baru** → tumpukan jendela, state duplikat, memori boros. **Arah:** `showMainWindow()` tunggal: bila `mainWindow` ada → `restore()` + `focus()`; selain itu buat satu. Idempoten untuk tray, taskbar, second-instance, activate.

### B. Navigasi & arsitektur informasi (IA)

**B-1. Nav bukan nav.** `.nav-link` = `<a>` **tanpa href/tabindex/role** (`index.html:16-21`): tak bisa difokus, tak bisa dioperasikan keyboard, SR hanya membaca teks. **Arah:** `<button class="nav-link" data-tab=… aria-current="page">` dalam `<nav aria-label="Navigasi utama">`, aktif = `aria-current="page"`, fokus-visible jelas, **Ctrl+1..6** untuk pindah tab (via menu accelerators atau `before-input-event`).

**B-2. Pengelompokan palsu dengan prefiks.** "Data · Target", "Data · Akun" — bukan grup, hanya string. Sementara urutan tab: Dashboard → Target → Akun → **Browser** → Proses → Pengaturan: dua permukaan "alat" (Browser) menyelip di tengah data. **Arah IA (usulan):**
```
UTAMA      Dashboard
PEKERJAAN  Target · Akun · Proses
ALAT       Browser (jendela terpisah / tab sekunder)
SISTEM     Pengaturan
```
Dengan label grup kecil (11px, `--faint`, letter-spacing) di sidebar; atau pindahkan Browser jadi **jendela utilitas terpisah** (⌘/Ctrl+B) sehingga tidak bersaing dengan alur review. Hilangkan prefiks "Data ·"; judul halaman sudah bilang itu.

**B-3. Dashboard ≠ "beranda", Proses ≠ "pengaturan worker" — keduanya menjawab pertanyaan berbeda tapi disandingkan tanpa rambu.** Dashboard harus = *ikhtisar & keputusan*; Proses = *operasi berjalan*. Sekarang keduanya sama-sama menampilkan angka nol-konteks. **Arah:** Dashboard diisi "apa yang berubah & apa yang harus saya lakukan" (lihat §6-B); Proses diisi "apa yang sedang berjalan & tersumbat apa" (lihat §6-F).

**B-4. Tidak ada "tempat pulang" saat tersesat.** Tidak ada breadcrumb, tidak ada judul jendela dinamis, tidak ada tombol back global. Modal adalah satu-satunya konteks detail. **Arah:** titlebar = konteks (tab + audit terpilih); `document.title` ikut; tombol "← Dashboard" tidak perlu, tapi **status bar** (lihat §6-A) menutup orientasi.

**B-5. Dua jalur menuju pekerjaan yang sama (login).** Proses punya "Login Instagram/TikTok" (`index.html:175-176`), tray punya item yang sama (`main.js:130-131`), Browser tab juga bisa login. Tiga pintu, nol indikator status. **Arah:** satu sumber status sesi (chip di Proses + tray tooltip), aksi login tetap di ketiganya tapi semuanya memanggil jalur yang sama dan **memantulkan status**: "IG: sesi aktif · TikTok: belum masuk".

### C. Dashboard — "angka bisu"

**C-1. KPI tanpa delta, tanpa pembanding, tanpa arah.** `kpi-strip` (`index.html:43`) menampilkan Target/Diproses/Terverifikasi/Keberhasilan/Gagal/Akun — 6 angka 28px, statis. `data:compare` (IPC `data:compare` → `db.getCompare`) **sudah ada dan tidak pernah dipanggil**. **Arah:** tiap KPI dapat sub-baris "▲ 12 vs audit lalu" (hijau/merah netral — untuk metrik "Gagal", naik = merah), atau minimal "vs periode sebelumnya" saat `getCompare` tersedia; tanpa data pembanding, tampilkan "—" bukan mengarang.

**C-2. Tidak ada tren sama sekali.** Data snapshot berlimpah (per target per run), tapi visualisasi = 2 daftar top-5 + 1 tabel platform. **Arah:** satu grafik garis sederhana (SVG murni, tanpa library): *snapshot OK/PARTIAL/FAILED per run/hari* di atas `snapshots`; atau sparkline di KPI "Keberhasilan". Ini mengubah Dashboard dari buku besar menjadi kokpit. Biaya: ~150 baris + 1 query agregat (sudah ada pola `getCompare`).

**C-3. "Post teratas (views)" dan "(ER)" tanpa konteks.** ER tanpa basis (views) menyesatkan post kecil; views tanpa ER juga setengah buta. **Arah:** tampilkan berpasangan `views · ER` + lencana platform + tanggal scrape; sort toggle (views/ER) per panel; tampilkan "n post" pada judul panel; klik → modal detail target (bukan lempar ke browser — lihat C-5).

**C-4. "Perlu tinjauan" — jargon domain tanpa bantuan.** Label `skor`, `pola_ternak`, `kembar` tampil mentah (`app.js:196-199`); pengguna awam tidak tahu arti 6 vs 10. **Arah:** ganti judul "Akun terindikasi (tinjau manual)"; baris menampilkan alasan utama (`flags[0].label`), bukan hanya angka; klik → modal detail dengan **disclaimer human-review** ("Indikasi otomatis dari data publik — bukan vonis; verifikasi manual sebelum tindakan").

**C-5. Link post = lempar ke browser, hilang konteks.** Semua `<a href>` render eksternal lewat `will-navigate` → `openExternal` (benar secara teknis), tapi **tidak ada affordance** (ikon ↗ / `title="Buka di browser (eksternal)"`) dan tidak ada alternatif "lihat bukti di dalam app". **Arah:** ikon ↗ + title; untuk sengketa klien, tambah aksi **"Salin link bukti"** (clipboard) di modal target — menjawab kebutuhan "alat bukti" tanpa membuka browser.

**C-6. `#global-audit` telanjang.** `<select>` tanpa label (visual & SR), lebar mengikuti konten panjang. **Arah:** label kecil "Audit:" atau prefix di dalam select; `aria-label="Pilih audit"`; lebar tetap (max-width + ellipsis); **jangan dibangun ulang saat poll** bila `document.activeElement` adalah select itu (lihat N-1).

**C-7. First-run kosong tanpa panduan.** Semua nol + "Belum ada data." — pengguna baru menatap layar kapur. **Arah:** komponen **Setup checklist** 3 langkah (1 Masuk IG/TikTok → 2 Import data → 3 Mulai worker) dengan progres nyata (status sesi via probe cookie / jumlah target > 0 / worker pernah jalan), CTA per langkah, lalu lenyap (simpan flag `onboarded` di config). Ini menaikkan aktivasi lebih dari fitur apa pun.

**C-8. CTA primer "＋ Import data" memakai plus full-width & label tidak paralel.** (`index.html:40`) **Arah:** ikon SVG plus 16px, label "Import data…" (elipsis = membuka dialog), dan — bila sudah ada audit aktif — dropdown-button "Import ke {nama audit} ▾" untuk jalur umum.

### D. Tab Target

**D-1. [P0, masih ada] Export bocor lingkup.** `app.js:515` memetakan hanya `partial|failed|ok`; filter **"Selesai (done)"** dan semua nilai lain → `status: undefined` → `getExportRows(null)` = **seluruh snapshot diekspor** — tanpa konfirmasi, tanpa lingkup. Untuk alat yang datanya dipakai ke klien, ini kegagalan kepercayaan tertinggi. **Arah:**
1. Peta eksplisit: `done → status IN ('OK','PARTIAL')` (query mendukung `IN` atau dua panggilan digabung), `ok/partial/failed` → masing-masing, `pending/running` → tombol export **nonaktif** dengan tooltip "Belum ada hasil".
2. **Modal konfirmasi lingkup**: "Export **N** baris · audit **{nama|semua}** · status **{label}** · target **{platform|semua}**" + tombol "Salin ke clipboard" alternatif + checkbox "Sertakan rekap". N dihitung dulu (COUNT ringan).
3. Baris terpilih > 0 → tawarkan **"Export terpilih saja"**.

**D-2. Kolom waktu scrape tidak ada.** Header: Pl · Akun · Postingan · Follower · Likes · Komen · Views · ER · Status — **kapan** datanya diambil tidak tampil; untuk monitoring berulang ini fatal (angka 3 minggu lalu terlihat segar). **Arah:** tambah kolom "Di-scrape" (relatif: "2 jam lalu", absolut via `title`, format `Intl.DateTimeFormat('id-ID',{dateStyle:'medium', timeStyle:'short'})`) — kolom bisa di-toggle.

**D-3. Sortir hanya via dropdown; header tabel bisu.** **Arah:** klik header untuk sort (▲▼), sinkron dengan dropdown (satu sumber state); header `Follower/Likes/…` `role="columnheader"` + `aria-sort`. Ini harapan universal pengguna spreadsheet.

**D-4. Tanpa select-all & bulk bar.** Checkbox per baris, tidak ada "pilih semua di halaman ini" (`<th>` kosong), dan saat terpilih N, aksi tersebar di toolbar kanan. **Arah:** `<th>` berisi checkbox "pilih halaman ini" (dengan indeterminate); **sticky selection bar** muncul di atas tabel saat N>0: "3 dipilih — [Ulangi] [Export] [Batal]"; membersihkan saat filter berubah (sudah) + tombol Esc.

**D-5. Pager minim.** Prev/Next + "Hal x/y" saja. **Arah:** page-size selector (25/50/100), input "ke hal…", info "1–50 dari 3.000". Target ribuan — wajib.

**D-6. Filter mengandung jebakan kecil.** "Semua status" vs "Selesai (OK + sebagian)" dsb. — label cukup jelas; tapi **tidak ada chip filter aktif** (Anda sedang memfilter apa?) dan **tidak ada reset satu klik** ("Bersihkan filter"). **Arah:** chip bar di bawah toolbar saat filter aktif + reset; jumlah hasil di judul (`3.000 target`) sudah ada — pertahankan.

**D-7. Link post tidak menampilkan tuan rumah.** `tema || shortUrl(url)` — `pathname.slice(0,40)` bisa menyesatkan (`/p/ABC/`). **Arah:** tampilkan `@handle` (sudah di kolom Akun) + **shortcode** (`ABC123`) + ikon platform + ↗; `title` = URL penuh. Kolom "Postingan" ganti jadi "Post" dengan isi `shortcode` mono.

**D-8. Riwayat (modal) baik — kurang satu aksi.** Modal riwayat menampilkan snapshot; tambah **"Salin link bukti"** + **"Buka di browser"** eksplisit + tandai snapshot terakhir ("terbaru").

### E. Tab Akun — etika, skala, dan privasi

**E-1. Skala: 200 baris tanpa pager, sort hardcode `risk`.** (`app.js` `loadAccounts`: `limit:200, sort:'risk'`) — akun ke-201+ tidak pernah terlihat, padahal "yang paling penting" (risiko tertinggi) kepotong diam-diam. **Arah:** pager identik tab Target (offset sudah didukung backend), sort dropdown (Skor / Followers / Reach / Bulan teramati), tampilkan `total`.

**E-2. Tidak ada filter platform.** Target bisa filter IG/TikTok; Akun tidak — tabel mencampur dua populasi dengan distribusi skor beda. **Arah:** select platform (Semua/IG/TT) + chip aktif; query backend sudah menerima `platform`? (`getAccountIntel(params)` — cek dukungannya; bila belum, tambahkan — kecil.)

**E-3. Legend = rumus, bukan penjelasan.** `Skor: 0 bersih · 2 amati · 6 ternak · 10 kembar` (`app.js:302`) — angka tanpa makna + label menghakimi. **Arah:** ganti jadi tombol "**Bagaimana skor dihitung?**" → modal: faktor (kontak bio sama, template caption, burst posting, follower datar…), **disclaimer**: "Indikasi otomatis berbasis data publik; bukan identifikasi orang; wajib verifikasi manual; dapat dihapus atas permintaan." + tautan kebijakan privasi internal. Ini **wajib** untuk alat yang dipakai ke klien (lihat juga §8).

**E-4. Filter "Curiga" menyesatkan.** (`index.html:129`, option `lv-curiga` tidak punya style & definisinya superset `pola_ternak`.) **Arah:** hapus opsi "Curiga"; sisakan 4 level nyata + "Semua".

**E-5. Kolom "Bulan" ambigu.** Artinya "berapa bulan teramati" — tapi bisa dibaca "bulan ke-". **Arah:** rename "Bln teramati" + `title="Jumlah bulan dengan snapshot"`.

**E-6. Flags terpotong tanpa jalan keluar.** `.wrap` ellipsis; tak ada `title`. **Arah:** `title` = daftar lengkap; klik baris → modal detail (sudah) — cukup, asal affordance terlihat (cursor + hover).

**E-7. [WIP] Avatar dari CDN — tiga pelanggaran sekaligus.** (`app.js:268` img `src=url avatar`; CSP `img-src https:` `index.html:6`)
1. **Privasi:** setiap render tabel memanggil CDN IG/TikTok dengan IP + waktu — kontradiksi langsung dengan klaim README "sepenuhnya lokal".
2. **Keandalan:** URL avatar kedaluwarsa (signed URL IG) → gambar rusak massal; tidak ada `onerror` → inisial tidak muncul.
3. **Keamanan:** `img-src` dilonggarkan ke **seluruh** `https:` — sembarang host bisa memuat gambar (tracking pixel) di konteks sesi login.
**Arah (dipilih berurutan):**
- (a) **Cache lokal**: worker/main mengunduh avatar sekali → `userData/avatars/<sha1>.jpg`; renderer membaca via `file://` (tambah `img-src file:`) atau **data URI** dari IPC (`avatar:data` batch) — sepenuhnya lokal, offline-ready, tanpa bocor.
- (b) Bila (a) belum sempat: `referrerpolicy="no-referrer"` + `onerror` → fallback inisial + CSP tetap `https:` tapi **dibatasi host** (`*.cdninstagram.com *.tiktokcdn.com …`) — rapuh, hanya stopgap.
- (c) Selalu: `alt=""` (dekoratif, sudah), `width/height=28` (hindari layout shift).

**E-8. Avatar hanya di tab Akun.** Target table (tempat review harian) tidak menampilkan avatar; konsistensi visual membantu pemindaian cepat. **Arah:** setelah (a), tambahkan avatar 24px di kolom Akun (toggleable bila mengganggu performa).

### F. Tab Browser — "pintu ganda ke sesi login"

**F-1. URL arbitrer di partisi sesi.** Browser tab memuat **situs apa pun** di `persist:sunscraping` yang berisi sesi IG/TikTok (`index.html:153-160`, `app.js:bindBrowser`). Aplikasi = browser umum dengan chrome tepercaya; phishing di dalam jendela "resmi". **Arah:** allowlist host (instagram.com/tiktok.com + subdomain, konsisten `policy.js`) saat navigasi; situs lain → `shell.openExternal` + toast "Dibuka di browser eksternal". Bila pengguna memang butuh riset luas: partisi terpisah `persist:browser-anon` **tanpa** sesi, dengan banner "Mode anonim — tidak memakai sesi login".

**F-2. Tidak ada indikator muat / stop.** Operator tidak tahu halaman sedang loading, gagal, atau selesai; tombol ⟳ bisa diklik berkali-kali. **Arah:** progress bar tipis 2–3px di atas webview (`did-start-loading`/`did-stop-loading`/`did-fail-load`), tombol ⟳ berubah jadi **■ Stop** saat loading; status teks kanan ("Memuat…"/"Siap").

**F-3. Tidak ada jalan "buka di browser luar".** **Arah:** tombol ↗ "Buka di browser" (semua URL) — menutup 80% kasus "saya tidak percaya tampilan ini".

**F-4. Berbagi sesi tidak dijelaskan.** Logout di sini = worker kehilangan sesi; operator tidak diberitahu. **Arah:** banner info kecil di bawah URL bar: "Browser ini memakai sesi yang sama dengan worker. Logout di sini akan menghentikan scraping." + tombol "Kelola sesi…" → Pengaturan.

**F-5. `will-navigate` meloloskan `file://`.** (`main.js:106-111`: hanya non-`file://` yang dicegah) — dokumen lokal (HTM email, lampiran) yang berhasil dimuat akan berjalan dengan preload penuh (`clearAll`, `deleteAudit`) bila suatu saat webview menunjuk ke `file:///…/index.html` palsu atau file lokal lain. **Arah:** izinkan navigasi utama hanya `file://…/renderer/index.html` persis; semua `file://` lain → preventDefault + log. (Sudah P1 di v2/v3 — tetap terbuka.)

**F-6. Tab "Browser" sebagai warga utama.** Menyematkan browser penuh di nav utama mengaburkan tujuan alat (audit). **Arah:** jadikan jendela utilitas (Ctrl+B) atau tab bersarang di dalam "Proses" ("Sesi & login"); minimal pindahkan posisinya setelah Proses.

### G. Tab Proses — pusat komando yang belum memerintah

**G-1. Layar ini basi selama dibuka.** `setInterval` hanya memanggil `refreshWorker()` + `refreshDashboard()`; `pollUpdate()` juga hanya Dashboard. **Esc refresh Proses tidak pernah terjadi** kecuali buka tab ulang — "Aktivitas terbaru" membeku; operator mengira worker macet. **Arah:** polling terarah per tab aktif (Proses: `getLatest` + `getQueueStats` tiap 2–5 dtk, debounced), atau badge "Ada data baru — klik untuk muat" (lebih hemat & jujur daripada diam-diam mengganti isi tabel).

**G-2. KPI antrean = total seumur hidup.** `getQueueStats()` menghitung OK/FAILED **akumulatif** (v2-I) — label "OK"/"Gagal" di Proses dibaca sebagai "sekarang", padahal historis. **Arah:** dua grup: **"Sekarang"** (Menunggu / Berjalan / Retry-antre) dan **"Sesi ini vs total"** (kecil, muted); atau hapus OK/Gagal dari kartu, pindahkan ke Dashboard.

**G-3. Tidak ada ETA.** Operator tidak tahu pukul berapa selesai; satu-satunya estimasi hidup di log. **Arah:** "Sisa antrean ≈ **N menit** (perkiraan, berbasis p50 pacing)" di panel Antrean; bila budget habis → "Dijeda budget harian — lanjut besok / reset di Pengaturan" (state eksplisit!).

**G-4. Blind spot login.** Gagal AUTH beruntun = alasan macet paling umum; UI tidak pernah menampilkannya. **Arah:** banner merah/kuning di atas panel Worker saat ≥N error AUTH: "**Sesi Instagram kedaluwarsa.** [Masuk ulang]"; status chip permanen: "IG: aktif / tidak diketahui / kedaluwarsa", "TikTok: …" (sumber: probe `session.cookies` + `lastError`). Ini satu-satunya perubahan yang menyelamatkan hari kerja operator.

**G-5. Tidak ada kesehatan scraper.** Markup berubah → PARTIAL massal → operator tidak sadar sampai laporan kosong. **Arah:** strip kecil "50 kunjungan terakhir per platform: OK x% · PARTIAL y% · AUTH z%" + peringatan bila PARTIAL > 50% (v3-Q-01) — data sudah ada, tinggal agregasi + tempat menampilkannya = di sini.

**G-6. Tombol login tanpa status & tanpa umpan balik.** Setelah klik "Login Instagram", renderer tidak tahu apa yang terjadi; jendela login muncul terpisah. **Arah:** setelah klik, tampilkan di panel Worker: "Menunggu login… (jendela Instagram terbuka)" dengan polling status sesi tiap 2 dtk hingga sukses/timeout 5 mnt; sukses → toast + chip hijau.

**G-7. "Aktivitas terbaru" tanpa filter & tanpa aksi.** **Arah:** filter platform (Semua/IG/TT) + kolom "Audit" bisa diklik (set `state.auditId` + lompat Dashboard?) — minimal filter platform; baris klik → modal riwayat target (pola D-8).

### H. Pengaturan — campur tiga dunia, tanpa "Tentang"

Isi sekarang: tabel Audit (CRUD) + panel Database (info, backup, hapus sesi, hapus semua). **Yang hilang:**

**H-1. Restore tidak ada.** Backup `.db` bisa dibuat, **tidak pernah bisa dipulihkan dari UI**. Untuk alat yang datanya = aset klien, ini cacat fatal. **Arah:** tombol "**Pulihkan dari cadangan…**": pilih file → validasi (`integrity_check` + hitungan baris vs DB aktif ditampilkan) → **backup otomatis DB aktif dulu** (timestamp) → swap + restart app (konfirmasi). Tanpa ini, fitur backup hanya plasebo.

**H-2. Tidak ada "Tentang / Diagnostik".** Tidak ada versi di seluruh UI (grep `version` di renderer = nol), tidak ada path DB, tidak ada tombol "Salin info diagnostik" (versi, path, ukuran DB, jumlah tabel, OS, Electron) — setiap laporan bug menjadi tanya-jawab manual. **Arah:** section **Tentang**: logo + versi + "Data tersimpan lokal di {path}" + tombol "Salin info diagnostik" + "Buka folder data" + "Buka log" (IPC baru `app:openPath`) + lisensi + kredit. Lima belas menit, membayar tenaga dukung seumur hidup produk.

**H-3. "Hapus semua data" tanpa gesekan & tanpa jaring.** Modal polos, satu klik "Hapus semua". **Arah:** (1) wajib **ketik `HAPUS`** (atau nama audit), (2) checkbox **"Cadangkan dulu (direkomendasikan)"** tercentang default — dicentang → backup otomatis lalu hapus, (3) tombol danger disabled sampai syarat terpenuhi, (4) menyebut dampak: "N audit · M target · K snapshot · data akun".

**H-4. "Hapus audit" tanpa dampak.** **Arah:** modal menampilkan "beserta **N target** dan **M snapshot**; backup TIDAK dihapus" + tombol danger dengan jumlah.

**H-5. Tiga konteks tanpa pemisah.** Audit CRUD (kerja harian) vs Database/Backup (infra) vs Danger zone (sekali seumur hidup) — satu halaman panjang, scroll jauh, hierarki rata. **Arah:** sub-nav atau section dengan heading jelas: **Audit** · **Data & cadangan** (backup, restore, retensi, hapus sesi) · **Tentang**. Danger zone selalu paling bawah dengan border merah tipis.

**H-6. Tidak ada preferensi.** Minimal: **Tema (Terang/Gelap/Ikuti sistem)** — lihat T-15. Bahasa bisa menyusul; lokalisasi id-ID sekarang konsisten, pertahankan.

**H-7. Copy basi.** Empty state audit: "Belum ada audit. Klik \"+ Audit baru\"." (`app.js:387`) — tombol bernama "＋ Import data". **Arah:** samakan kalimat dengan label tombol sebenarnya; lint copy manual setahun sekali.

**H-8. Info DB hanya ukuran.** `db-info` menampilkan file/KB/counts — tambahkan: **mode WAL, `user_version` skema, hasil `integrity_check` terakhir** (dijalankan saat backup), dan **waktu backup terakhir**. "Cadangan terakhir: 3 hari lalu — [Cadangkan sekarang]" menutup loop kepercayaan.

### I. Modal & formulir

**I-1. A11y modal nihil.** `openModal()` (`app.js:82`) — tanpa `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, **tanpa fokus awal**, **tanpa jebakan Tab**, **tanpa restore fokus** ke pemicu; konten belakang tidak `inert`. Esc & backdrop-klik berfungsi (bagus) — tapi keyboard trap tidak ada: Tab dari ✕ bisa "kabur" ke halaman belakang. **Arah:** standar dialog: focus pertama ke elemen aman (Batal/field pertama), Tab/Shift+Tab siklis di dalam, Esc batal, restore fokus, `inert` pada `.layout` saat terbuka.

**I-2. Import form membohongi pengguna.** Saat "Tujuan" = "Tambah ke: {audit}", field **Nama audit** tetap aktif padahal **diabaikan** (`getOpts` mengirim name; backend `appendTargets` tidak memakainya). **Arah:** nonaktifkan + pudarkan field Nama & Ulang saat audit dipilih (`disabled` + keterangan "berlaku untuk audit baru"), atau sembunyikan. Kebenaran kecil yang membangun kepercayaan besar.

**I-3. Tidak ada pratinjau untuk 10.000 baris.** Import = lompat langsung; hasil diketahui setelah selesai ("Import N target…"). Satu kolom salah → 10.000 baris sampah terlanjur masuk (bisa dihapus, tapi menyakitkan). **Arah:** **preview dua langkah**: pilih file → parse (sudah ada) → tampilkan 5 baris contoh + ringkasan ("terdeteksi kolom `Link` · 9.812 valid · 140 duplikat · 48 invalid — [lihat]") → tombol "Import 9.812 target". Untuk tempel-link: hitung dulu, tampilkan, baru commit. Ini standar alat import profesional (TablePlus, Notion, Linear semuanya begini).

**I-4. Tidak ada busy-state; double-click = double import.** Semua handler async (`confirm-file`, `confirm-links`, `btn-backup`, `btn-clear`, `confirm-del`…) tidak menonaktifkan tombol selama proses; klik ganda → dua impor / dua backup / dua delete. **Arah:** helper `withBusy(btn, fn)`: disable + spinner CSS + label "Memproses…"; semua aksi async wajib lewat situ.

**I-5. Notifikasi hasil import minim.** Toast sukses tidak menawarkan langkah berikutnya. **Arah:** toast aksi: "Import selesai — 9.812 target. [Lihat Target] [Mulai worker]" (aksi = pindah tab / start worker). Rantai aktivasi.

**I-6. Konsistensi tombol footer.** Campur: kadang "Batal" ghost + aksi primer; kadang tombol danger di kanan. **Arah:** aturan tunggal: kiri = Batal (ghost), kanan = aksi utama; aksi destruktif = danger solid paling kanan; **Enter = aksi aman** (Batal) untuk dialog destruktif, **Enter = konfirmasi** hanya untuk non-destruktif; fokus awal selalu elemen aman.

**I-7. Input angka tanpa clamp.** `type=number min=0 max=365` tapi mengetik 9999 tetap lolos (`Number()` polos). **Arah:** clamp di handler (`Math.min(365, Math.max(0, …))`) + pesan inline bila dikoreksi.

**I-8. Emoji tombol.** "📄 Pilih file…" (`app.js:417`), "＋" full-width — tidak konsisten dengan estetika sisanya; render bervariasi per OS. **Arah:** satu set **ikon SVG** (mis. Lucide: file-spreadsheet, upload, link, x, trash, download, copy, external-link, search, settings, sun/moon). 1 spritesheet, stroke 1.5–2, ukuran 16/20. Ini upgrade visual paling murah dengan dampak terbesar.

### J. Toast & umpan balik — "bisikan 4 detik"

**J-1. Toast menghilang, operator tidak pernah tahu.** `setTimeout(…,4000)` (`app.js:73-80`); error kritis (export gagal, import gagal, worker berhenti) lenyap. **Arah:**
- `role="status"`/`aria-live="polite"` (error: `assertive`);
- **error sticky**: bertahan sampai ditutup (tombol ✕) atau punya aksi;
- **aksi di toast**: [Coba lagi] [Salin error] [Lihat log];
- **riwayat notifikasi**: ikon lonceng di status bar dengan badge; panel kecil 50 kejadian terakhir (persist di main, ring buffer file — selaras D-13 v1).
- maks 3 toast tampil; sisanya masuk riwayat.

**J-2. Kontras toast hijau gagal AA.** `.toast.ok { background: var(--ok) }` = `#059669` → putih = **3.77** (gagal 4.5); `.toast.error` `#dc2626` = 4.83 (lulus tipis). **Arah:** `--ok` → `#047857` (5.48) — sekalian memperbaiki `.status.ok` & badge `.lv-bersih`; `--warn` → `#b45309` (5.02); `--ig` → `#be185d` (6.04). (Sudah dihitung ulang hari ini — angka cocok dengan audit v2/v3.)

**J-3. Tidak ada level "info".** Hanya netral/error/ok; "Pilih audit dulu" tampil sebagai toast gelap biasa — tidak bisa dibedakan peringatan vs info. **Arah:** 4 varian: info (netral), success (hijau tua), warning (amber tua + ikon), error (merah + ikon).

### K. Warna, kontras, dark mode, gerak, cetak

**K-1. Tabel kontras terukur (WCAG 2.1, AA normal ≥ 4.5; besar ≥ 3.0):**

| Kombinasi | Rasio | Vonis |
|---|---|---|
| `--warn` #d97706 / putih (status Sebagian, 12–13px) | **3.19** | ❌ |
| `--ok` #059669 / putih (status OK) | **3.77** | ❌ |
| `--ig` #d6336c / #fdf2f8 (badge IG) | **4.23** | ❌ tipis |
| `--faint` #667085 / putih · / sunken | 4.97 · 4.72 | ✅ (nyaris di sunken) |
| `--muted` #475467 / putih | 7.69 | ✅ |
| putih / `#2563eb` (primer) · putih / `#dc2626` (danger) | 5.17 · 4.83 | ✅ |
| teks tinted badges (amati/ternak/kembar/bersih) | 4.52–5.30 | ✅ |
| **usulan** `--warn→#b45309` · `--ok→#047857` · `--ig→#be185d` | 5.02 · 5.48 · 6.04 | ✅ |

**K-2. Dark mode tidak ada.** 2026, alat yang dibuka berjam-jam oleh operator — tidak punya tema gelap = diskualifikasi "desktop terbaik". **Arah:** dua lapis: (1) `color-scheme: light dark` + override token di `@media (prefers-color-scheme: dark)`; (2) toggle eksplisit Terang/Gelap/Sistem di Pengaturan → Tampilan, persist `userData/config.json` (atau localStorage — renderer lokal, cukup). Token sudah terpusat — biaya rendah, dampak besar. Sidebar gelap + aksen amber = identitas "sun".

**K-3. Tidak ada `:focus-visible`.** Hanya `.input:focus` yang bergaya; tombol/nav/baris/checkbox fokus = outline default browser (hilang di beberapa konteks) atau tidak terlihat. **Arah:** global `:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: inherit }` + varian di atas permukaan gelap.

**K-4. `prefers-reduced-motion` diabaikan** (`transition: background 120ms`). **Arah:** media query netralkan transisi/animasi.

**K-5. Tidak ada gaya cetak.** "Alat bukti" justru tidak bisa dicetak/PDF layak: Ctrl+P mencetak sidebar+toolbar+webview. **Arah:** `@media print`: sembunyikan sidebar/toolbar/titlebar/toast/modal; tampilkan hanya isi tab aktif; tabel font 10pt; header halaman: judul + audit + tanggal cetak; footer: "sunscraping — data publik, untuk peninjauan internal" + nomor halaman (`@page`). Ini membuka jalur **laporan PDF klien** tanpa fitur baru.

**K-6. `forced-colors` (Windows High Contrast) tidak didukung.** **Arah:** `forced-color-adjust: none` selektif atau verifikasi border/focus tetap terlihat; minimal jangan sembunyikan outline.

**K-7. Identitas visual datar.** Palet biru Tailwind generik; ☀ muncul 2× tanpa makna; tidak ada ilustrasi/empty-state art; kesan "admin template". **Arah (ringan, tanpa rebrand besar):** satu aksen "matahari" (amber `#d97706`→`#b45309`) dipakai konsisten untuk CTA sekunder/highlight; logo mark SVG sederhana (lingkaran + sinar) di titlebar/sidebar/Tentang; empty-state pakai mark yang sama (watermark 64px, opacity .08). Cukup untuk "punya wajah".

### L. Copy, penamaan, i18n

- **Campur id/en** secara acak: "Export", "Backup/Cadangkan", "Mulai worker", "Ulangi terpilih", "Audit ulang" — boleh, asal konsisten per konteks; tetapkan glosarium: *audit* = himpunan pemantauan; *target* = post yang dipantau; *snapshot* = hasil sekali scrape; *worker* = proses pengunjung; jangan campur "cadangkan"/"backup" dalam satu layar (pilih "Cadangkan" + path).
- **Tanggal mentah**: `scraped_at.slice(0,16).replace('T',' ')` (`app.js:281,354`) → "2026-11-04T21:16" kaku; pakai `Intl.DateTimeFormat('id-ID', …)` + relatif ("2 jam lalu") + absolut di `title`.
- **Angka**: `fmt()` pakai toLocaleString id-ID ✅; tapi tanpa satuan/ikon untuk konteks (mis. "3.200 views" vs "3,2 rb views" — pilih satu gaya; disarankan penuh untuk akurasi bukti, ringkas hanya untuk KPI dengan `title` lengkap).
- **Label menilai**: "pol" ok, tapi "Pola ternak/Pola kembar" ke klien = vonis; UI harus selalu berpasangan dengan "Indikasi — verifikasi manual". Ganti nama kolom "Indikasi" tetap, tapi header tooltip wajib.
- **Elipsis vs tiga titik**: pakai "…" tipografis; tombol yang membuka dialog selalu berekor "…" ("Import data…") — konvensi desktop yang dipahami semua orang.
- **Satuan tidak konsisten**: "Ulang (hari, 0 = manual)" vs "Ulang (hari)" — seragamkan "Ulang tiap (hari), 0 = manual".
- **Tidak ada string yang menyebut "tidak bisa dibatalkan"** untuk aksi destruktif — tambahkan di modal H-3/H-4.

### M. Kecepatan persepsi (bukan hanya kecepatan)

**M-1. [P0] Keystroke = recompute.** `#target-q`/`#account-q` → `loadTargets()/loadAccounts()` langsung (`app.js:496-498, 521-523`) tanpa debounce; `loadAccounts` memicu `getAccountIntel()` = muat + pairing O(n²) seluruh DB — diukur v3: **~74–82 dtk di 1.500 akun**, dipanggil **setiap huruf**, dan respons usang bisa menimpa yang baru (tidak ada sequence guard). UI freeze total; operator mengira hang. **Arah:** debounce 250–300 ms + **request-sequence guard** (`const id = ++reqSeq; if (id !== reqSeq) return;`) + tampilkan hasil hanya bila masih relevan; untuk Akun, tambahkan **skeleton rows** saat loading > 150 ms.

**M-2. Dua kanal refresh bertumpuk.** Event `data` (debounce 400 ms) + `setInterval` 5 dtk — keduanya memanggil full refresh (v2-P-05). **Arah:** satu kanal (event-driven, debounce 1,5 s) + interval hanya sebagai jaring pengaman 15–30 s dan hanya untuk tab aktif.

**M-3. `#global-audit` dibangun ulang tiap poll.** (`loadAudits()` menulis `sel.innerHTML` setiap event `data`.) Dropdown terbuka kehilangan fokus/pilihan; berkedip. **Arah:** tulis ulang hanya bila daftar id berubah (diff), atau lewati bila `document.activeElement === sel`.

**M-4. Tidak ada indikator sedang-memuat di mana pun.** Tabel kosong 200–500 ms terasa "rusak". **Arah:** shimmer/skeleton untuk tbody (5 baris abu) + `aria-busy="true"` pada container; untuk operasi > 1 dtk (import, export, backup) — progress determinate bila backend melapor, indeterminate bila tidak (CSS).

**M-5. Avatar [WIP] memperburuk persepsi.** Gambar remote besar (IG `profile_pic_url_hd` bisa >100 KB) tanpa dimensi eksplisit → layout shift + blank putih; CDN lambat = tabel "berkedip". **Arah:** cache lokal (E-7a) + `width/height` + `loading=lazy` (sudah) + decode async.

### N. Aksesibilitas (peta WCAG 2.1 — status terukur)

| Kriteria | Status | Bukti / tindakan |
|---|---|---|
| 1.4.3 Kontras (Minimum) | ❌ | §K-1: warn/ok/ig gagal; perbaiki token |
| 1.4.11 Non-text | ⚠️ | dot status 7–9px; ikon 14–16px di tombol — set min 3:1 (ikon pakai `currentColor` dengan label, aman bila teks ada; dot tambah border tipis) |
| 2.1.1 Keyboard | ❌ | nav `<a>` tak fokus; baris `.clickable` tanpa tabindex/Enter; checkbox tanpa label |
| 2.4.7 Focus Visible | ❌ | tidak ada `:focus-visible` (hanya `.input:focus`) |
| 2.4.3 Focus Order (modal) | ❌ | tidak ada trap/restore (§I-1) |
| 3.2.x Predictable | ⚠️ | poll mengganti `#global-audit` & tabel tanpa aba-aba (M-3) — jangan pindahkan fokus; jangan ganti konten di bawah fokus pengguna |
| 3.3.1 Error Identification | ❌ | `catch {}` — error tidak pernah diberitahukan (J-1, T-04) |
| 4.1.2 Name/Role/Value | ❌ | checkbox `.sel` tanpa `aria-label`; modal tanpa role; nav tanpa role |
| 4.1.3 Status Messages | ❌ | toast tanpa `role="status"`/`aria-live` |
| 1.3.1 Info & Relationships | ⚠️ | tabel pakai `<table>` ✅; tapi `th` tanpa `scope="col"`; header checkbox kosong tanpa label |
| 2.3.3 Animation | ✅ | transisi minimal — pertahankan + hormati reduced-motion (K-4) |
| 1.4.10 Reflow @400% | ⚠️ | belum diuji; fixed `min-width:1024` memecah zoom — dokumentasikan dukungan zoom 200% |

**Prioritas a11y (urutan):** (1) nav→button + focus-visible global + aria-current; (2) modal dialog lengkap (role/trap/restore/inert); (3) toast aria-live + sticky error; (4) checkbox aria-label + select-all label; (5) token kontras; (6) baris tabel `tabindex=0` + Enter/Space + `role="row"` wajar; (7) `scope="col"`.

### O. Privasi & kepercayaan (yang dirasakan pengguna)

1. **"Sepenuhnya lokal" vs avatar CDN** — kontradiksi paling nyata [WIP]; perbaiki dengan cache lokal (E-7).
2. **Tidak ada satu kata pun di UI tentang ke mana data pergi / apa yang tersimpan.** Pengguna menaruh sesi login + data publik orang lain di sini; Pengaturan harus punya panel **"Privasi & data"**: apa tersimpan (DB path, sesi partisi), apa tidak (tidak ada pengiriman keluar), cara hapus (hapus sesi / hapus semua / hapus akun tunggal — belum ada!), retensi (belum ada), kontak/kebijakan.
3. **Tidak ada "Hapus data akun ini"** — hak hapus per-permintaan (UU PDP 27/2022) hanya bisa lewat "Hapus SEMUA". **Arah:** di modal detail akun: "Hapus data akun ini…" (menghapus `accounts` + `account_posts` + `account_history` terkait) + konfirmasi ketik username. 3 query + 1 IPC + 1 tombol.
4. **Webview bebas situs** (F-1) — kepercayaan visual disalahgunakan untuk phishing potensial; perbaiki allowlist.
5. **Backup `.db` plaintext berisi bio (bisa memuat HP/email)** — beri opsi "Cadangkan terenkripsi (AES, passphrase)" atau minimal peringatan "cadangan tidak terenkripsi — simpan di lokasi aman" di dialog backup/restore.
6. **Ikon ☀ + klaim "kesehatan/harvest"?** — tidak ada; tapi kalau dipakai, jangan sampai terkesan "panen data orang" — netral-profesional lebih aman untuk alat klien.

### P. Lintas platform & distribusi (dampak UI)

- **Windows-first hardcoded**: titlebar overlay, `%APPDATA%` path di docs, exe build — macOS/Linux tidak diuji; `Menu null` paling melukai macOS. **Arah:** minimal build & uji manual di macOS (traffic-lights), atau nyatakan resmi "Windows-only" di README + `os` di package.json.
- **Tidak ada auto-update** — patch keamanan Electron (35 **EOL Sep 2025**, dipakai hari ini) tidak pernah terkirim; UI tidak bisa memberi tahu "versi baru tersedia". **Arah:** minimal "cek pembaruan" manual di Tentang (fetch GitHub releases / file versi) atau `electron-updater` bila repo publik; jika tidak — halaman rilis + notifikasi tray.
- **SmartScreen unsigned** — first-run menakutkan; dalam UI tambahkan layar "Windows melindungi PC Anda…" bukan ranah UI, tapi **Tentang** bisa menenangkan ("Aplikasi tidak ditandatangani — verifikasi hash…" bila publik).
- **Versi tidak pernah tampil** (H-2) — rilis 1.1.0 wajib dengan changelog di Tentang.

---

## 5. Kritik kualitatif (yang tidak bisa diselesaikan dengan CSS)

1. **"Dashboard" ini buku besar, bukan kemudi.** Ia melaporkan, tidak menuntun. Setiap layar harus lolos uji satu pertanyaan: **"apa yang harus saya lakukan setelah ini?"** — hari ini tidak ada satu pun yang menjawabnya. Itu bukan kekurangan halaman, itu kekurangan *point of view* produk.
2. **Kegagalan diperlakukan sebagai gangguan, bukan sebagai warga.** Sistem yang sehat menampilkan yang rusak secara proporsional; di sini yang rusak ditelan (`catch {}`), diringkas ("0"), atau diucapkan lalu dilupakan (toast 4 dtk). Operator yang tidak bisa percaya umpan baliknya, tidak bisa percaya alatnya — titik.
3. **Destruktif terlalu murah, konstruktif terlalu mahal.** Menghapus semua data = 1 klik; mengimpor dengan benar = 5 langkah tanpa preview; memulihkan backup = mustahil. **Kurva gesekan terbalik** — semua alat dewasa justru sebaliknya.
4. **"Alat bukti" tanpa bisa memperlihatkan bukti.** Tidak ada print/PDF, tidak ada "salin link bukti", tidak ada stempel waktu manusiawi, tidak ada disclaimer metodologi. Bukti yang tidak bisa ditunjukkan = opini mahal.
5. **Kecepatan disulap, bukan dihormati.** UI bertindak seolah data selalu kecil; query O(n²) di balik keystroke, dua kanal polling, dropdown dibangun ulang — semua gejala satu penyakit: **tidak ada anggaran performa untuk UI**. Tetapkan: ketik→hasil < 150 ms (debounced), buka tab < 300 ms, aksi < 1 s dengan feedback.
6. **Nol kepribadian, nol empati.** Tidak ada empty-state ilustrasi, tidak ada nada bicara konsisten, tidak ada momen "selesai!" (🎉 dilarang — cukup kalimat tenang + aksi berikutnya). Alat yang dipakai harian harus *menenangkan*, bukan hanya informatif.
7. **Privasi sebagai catatan kaki.** Avatar CDN, sesi bersama, bio HP/email — alat ini memegang data orang nyata, tapi UI tidak pernah mengakuinya. Kepercayaan dibangun dari pengakuan, bukan dari klaim "sepenuhnya lokal" di README.

**Pertahankan mati-matian:** arsitektur tanpa framework, CSP ketat, preload minimal, tabular-nums, tray-first, transaksi DB, escaping — jangan "dimodernisasi" dengan React/Next; penyakitnya bukan di sana.

---

## 6. Arah yang benar (usulan konkret)

**North star:** dari *"dashboard monitoring"* → **"konsol operator yang dipercaya"** — setara genre *TablePlus / Linear / Raycast / VS Code*, bukan *admin template*. Empat prinsip:

1. **Veracity before velocity** — pratinjau sebelum commit (import), lingkup eksplisit sebelum ekspor, verifikasi sebelum "tersimpan" (backup), label jujur di atas angka ("seumur hidup" vs "sekarang").
2. **Calm & quiet** — satu aksi utama per layar; sisanya tenang; error persisten sampai diakui; tidak ada kedipan/rebuild yang tidak diminta; reduced-motion dihormati.
3. **Keyboard-first, mouse-friendly** — semua yang bisa diklik bisa diketik: Ctrl+K (cari/perintah), Ctrl+1..6 (tab), Ctrl+E (export scope), `/` fokus pencarian, Enter/Space aktivasi baris, Esc selalu mundur satu langkah.
4. **Honest feedback loop** — setiap aksi punya hasil yang terlihat (toast aksi / status bar / riwayat), setiap gagal punya jalan keluar (retry/log/salin), setiap selesai punya langkah berikutnya.

### A. Status bar (baru, tipis 28px, bawah) — orientasi permanen
```
● Worker: aktif · siklus 3/8  |  Audit: Kampanye Nov  |  Sesi: IG ✓ TT ✗  |  DB 42 MB  |  Backup: 2 h lalu  |  v1.1.0
```
Klik segmen: Worker → Proses; Audit → ganti cepat (popup); Sesi → Pengaturan/login; Backup → cadangkan sekarang; versi → Tentang. Menutup "ke mana saya / apa yang terjadi / apa yang harus dikhawatirkan" tanpa membuka apa pun.

### B. Dashboard — dari buku besar menjadi kokpit
Urutan blok (atas→bawah): **(1)** *Action strip* — satu baris: "⚠ 3 error AUTH beruntun — [Masuk IG lagi] · antrean 128 (≈45 mnt) — [Lihat Proses] · backup terakhir 4 hari lalu — [Cadangkan]" (hanya tampil bila ada yang butuh; kosong = "Semua aman ✓" tenang). **(2)** KPI row 6 dengan **delta vs run sebelumnya** (dari `getCompare` — backend sudah ada) + sparkline SVG. **(3)** *Tren 30 run terakhir* (garis OK/PARTIAL/FAILED, SVG murni). **(4)** Dua panel top post (views/ER) dengan platform badge + tanggal + ↗. **(5)** "Perlu tinjauan" (5 akun, alasan utama, disclaimer). **(6)** Kualitas data — ringkas 3 angka + "detail →" (jangan 5 KPI sejajar). Pertama kali: **empty-state checklist** (C-7).

### C. Target — grid yang respek spreadsheet
Header sortable + `aria-sort`; kolom **"Di-scrape"**; select-all (halaman) + **sticky bulk bar** ("3 dipilih — Ulangi · Export · Hapus pilihan"); page-size 25/50/100 + "1–50 dari 3.000"; chips filter aktif + reset; export lewat **modal lingkup** (D-1); link = `shortcode` mono + ↗ + "Salin" di modal riwayat.

### D. Akun — meja review dengan rem etis
Pager + sort (Skor/Followers/Reach/Bulan) + filter platform; **tombol "Bagaimana skor dihitung?"** (modal metodologi + disclaimer + "Hapus data akun ini" per-akun); kolom "Bln teramati"; flags via `title`; avatar **cache lokal**; label netral default ("Indikasi · tingkat rendah/sedang/tinggi") dengan opsi tampilan teknis; **setiap export menyertakan disclaimer** "Indikasi otomatis — verifikasi manual" (baris terakhir/watermark).

### E. Browser — jendela utilitas, bukan warga utama
Pindah jadi window terpisah (Ctrl+B) atau nested di Proses; allowlist host; progress bar + Stop; tombol **"Buka di browser luar"**; banner sesi bersama; `will-navigate` hanya `index.html` + allowlist; **partisi anonim** opsional tanpa sesi.

### F. Proses — pusat komando
Dua kolom: *Sekarang* (Menunggu/Berjalan + **ETA** + fase worker eksplisit: idle/claiming/scraping/paused-budget/stopped) · *Sesi ini* (OK/gagal sesi + total kecil muted) — **bukan** angka seumur hidup sebagai KPI utama. Banner **"Login diperlukan"** (≥N AUTH) dengan tombol langsung. **Strip kesehatan 50 kunjungan terakhir** per platform (OK/PARTIAL/AUTH %) + peringatan PARTIAL>50%. Aktivitas: filter platform + klik baris → riwayat. Semua refresh saat tab aktif (debounced) atau tombol "Muat ulang" + badge "baru".

### G. Pengaturan — tiga ruangan + Tentang
**Audit** (tabel + aksi, dampak eksplisit saat hapus) · **Data & cadangan** (Cadangkan [dengan verifikasi] · **Pulihkan dari cadangan…** [validasi + auto-backup dulu] · Retensi snapshot opsional · Hapus sesi login) · **Tampilan** (Tema terang/gelap/sistem) · **Privasi & data** (apa disimpan/di mana/cara hapus/disclaimer) · **Tentang** (versi, path DB, "Salin info diagnostik", "Buka folder data", lisensi, changelog). Danger zone paling bawah, terpisah garis, ketik-untuk-konfirmasi + opsi backup dulu.

### H. Import — pratinjau sebelum komitmen
Pilih file/tempel → **parse & pratinjau** (5 baris + hitungan valid/duplikat/invalid + kolom terdeteksi) → konfirmasi dengan jumlah eksplisit → **progress** (bila backend menyanggupi; selain itu indeterminate + tombol nonaktif) → hasil sebagai **toast aksi** ("Lihat Target" · "Mulai worker"). Field Nama/Ulang nonaktif saat "Tambah ke…" dipilih. Guard double-submit global.

### I. Sistem umpan balik & notifikasi
Toast 4 varian + `aria-live` (error sticky) + **aksi** (Coba lagi / Salin error / Lihat log) · **lonceng di status bar** dengan badge → panel 50 kejadian (import selesai, worker start/stop, AUTH gagal, backup sukses/gagal) persist ke file log — satu sumber untuk dukungan & untuk operator.

### J. Ctrl+K Command Palette (kerja 1–2 hari, dampak terbesar per rupiah)
Backend **sudah punya** `data:search` (targets/accounts/audits?) — verifikasi cakupan `searchData`. UI: overlay fuzzy (palette) — hasil diketik → lompat ("Target @budi" → tab Target terfilter) · aksi ("Mulai worker", "Cadangkan DB", "Export…", "Tema gelap") · shortcut hint di kanan. Referensi: VS Code / Linear / Raycast. Ini yang membuat pengguna bilang "desktop terbaik", bukan spasi yang cantik.

### K. Komponen & token (rencana teknis)
- **Ikon:** satu set SVG (Lucide), `stroke:1.75`, 16/20px; hapus semua emoji dari chrome; platform logo sebagai SVG.
- **Token:** tambah `--ok:#047857`, `--warn:#b45309`, `--ig:#be185d`, `--focus`, `--surface-2`, `--danger-ink`; skema **dark** via `[data-theme=dark]` + `prefers-color-scheme`; `color-scheme: light dark`.
- **Fokus:** `:focus-visible` global; hilangkan outline default hanya bila diganti.
- **Tipografi:** pertahankan Segoe UI (Windows-native) + `system-ui` fallback; opsional Inter untuk cross-platform (gratis); **ukuran tidak turun** di bawah 12px; KPI `clamp()` responsif.
- **Print:** `@page A4; margin:16mm` + header/footer + sembunyikan chrome (K-5).
- **Reduced motion & forced-colors** media queries.
- **Grid & density:** satu skala spacing (4/8/12/16/24); baris tabel 40px (comfortable) / 32px (compact, toggle di Pengaturan → Tampilan).

### L. Copy & glosarium (satu halaman, ditempel di repo)
Glosarium istilah; aturan elipsis pada tombol-dialog; larangan klaim absolut ("pasti", "100%"); format tanggal `id-ID`; angka penuh vs ringkas; kalimat error = **apa yang terjadi + kenapa + apa yang bisa dilakukan** ("Import gagal: kolom URL tidak ditemukan. Tambahkan kolom `Link` atau `URL`, atau pilih pemetaan kolom manual." — bukan "Gagal.").

---

## 7. Roadmap yang disarankan (effort kasar, 1 dev)

**P0 — minggu ini (±2–3 hari)**
1. D-1 Export: peta `done→IN (OK,PARTIAL)`, modal lingkup + COUNT, tombol disabled bila tak terpetakan. *(2–3 jam)*
2. M-1 Debounce 250 ms + sequence guard di `#target-q`/`#account-q`; skeleton ringan. *(2–3 jam)*
3. T-04/J-1: `catch{}` → toast error + log; toast `aria-live` + error sticky + aksi [Coba lagi/Salin error]; helper `withBusy` anti-double-submit di semua aksi async. *(4–6 jam)*
4. T-05: nav→`<button>` + `aria-current`; `:focus-visible` global; modal `role=dialog aria-modal` + trap + restore + `inert` belakang; checkbox `aria-label`; `scope="col"`. *(3–4 jam)*
5. A-2/A-3/A-5: menu minimal ber-role (edit/help→Tentang), window-state persisten (bounds+maximized), `showMainWindow()` tunggal untuk tray/activate/second-instance. *(2–3 jam)*
6. E-7/A-1 [WIP]: avatar → cache lokal (atau `no-referrer`+`onerror` sebagai stopgap); titlebar: hilangkan duplikasi brand, perbaiki padding macOS atau kembalikan native frame. *(3–6 jam)*
7. H-3/H-4: ketik `HAPUS` + opsi "Cadangkan dulu" (default on) di clear-all; dampak (N/M/K) di modal hapus audit. *(1–2 jam)*

**P1 — 2 minggu (±4–6 hari)**
8. Dashboard revamp: action strip + delta KPI (pakai `getCompare`) + sparkline/tren SVG + empty-state checklist onboarding. *(1–1,5 hari)*
9. Proses revamp: kelompok "Sekarang" vs "Sesi ini", ETA, banner AUTH + chip sesi, strip kesehatan 50 terakhir, refresh on-active. *(1 hari)*
10. Target grid: header sortable, kolom "Di-scrape", select-all + sticky bulk bar, page-size, chips filter, modal export lingkup final. *(1 hari)*
11. Akun: pager + sort + filter platform; modal "Cara skor dihitung" + disclaimer + **hapus data akun ini**; legend diganti tombol. *(1 hari)*
12. Pengaturan: Restore dari cadangan (validasi + auto-backup), Tentang (versi + diagnostik + buka folder/log), panel Privasi & data, sectioning + Tampilan (tema). *(1–1,5 hari)*
13. K-1/K-4: token kontras; `@media print`; reduced-motion; (dark mode boleh P1 atau P2 — lihat 14). *(0,5 hari)*
14. **Dark mode** penuh + toggle + persist. *(1 hari)*
15. Ctrl+K palette (search + actions) di atas `data:search`. *(1–1,5 hari)*

**P2 — backlog (±3–5 hari)**
16. Notifikasi/riwayat (lonceng status bar + log file); status bar global (§6-A). *(1 hari)*
17. Browser jadi jendela utilitas + allowlist + progress + "buka eksternal" + banner sesi; atau nested di Proses. *(1 hari)*
18. Import dua langkah dengan pratinjau + progress; field nama nonaktif saat "Tambah ke…"; clamp angka. *(1 hari)*
19. Print/PDF laporan (header audit + tanggal + disclaimer + nomor halaman); "Salin ke clipboard" di export; **export menyertakan baris disclaimer**. *(0,5–1 hari)*
20. Copy pass menyeluruh (glosarium, elipsis, format tanggal `Intl`, "…" konvensional); hapus emoji chrome; ikon Lucide. *(0,5–1 hari)*
21. Akun: tampilan "indikasi netral" default + mode teknis; retensi UI; retensi snapshot otomatis (opsional). *(1 hari)*

**Tata kelola:** 1 temuan = 1 commit + 1 bukti (screenshot/tes); versi naik **1.1.0** setelah P0+P1; changelog di Tentang; rilis disertai catatan jujur (Electron EOL! upgrade terpisah).

---

## 8. Garis merah etika & kejujuran produk (mengikat UI)

1. **Tidak ada vonis otomatis ke manusia.** Semua label "ternak/kembar/curiga" = **indikasi**; UI wajib menampilkannya berdampingan dengan "verifikasi manual"; report/export selalu membawa disclaimer.
2. **Label netral tersedia** ("Indikasi · rendah/…/tinggi") — minimal sebagai opsi tampilan default untuk output ke klien.
3. **Hak hapus per-akun** (E/H) — bukan hanya "hapus semua".
4. **Transparansi lokalitas**: panel Privasi di Pengaturan; klaim "sepenuhnya lokal" hanya boleh setelah avatar/CDN beres; backup = tidak terenkripsi kecuali opsi ditambahkan.
5. **Tidak ada dark pattern**: tidak ada checkbox tercentang yang menyetujui hal memalukan; tidak ada "yakin?" kosong; setiap konfirmasi menyebut **konsekuensi**, bukan rasa takut.
6. **README & UI harus sepakat** (tombol, langkah, klaim) — satu sumber kebenaran; saat ini berbeda ("+ Audit baru" vs "＋ Import data", "32 tes" vs 42, "Node 20+" vs butuh ≥ 22.13).

---

## 9. Skor akhir & target

| Area | Sekarang | Setelah P0 | Setelah P1 |
|---|---|---|---|
| Visual & konsistensi | B+ | B+ | **A−** |
| IA & navigasi | C+ | B− | **B+** |
| Umpan balik & error | D | B− | **A−** |
| Aksesibilitas | D | B− | **A−** |
| Kecepatan persepsi | D− | B | **A−** |
| Chrome desktop | D | B | **A−** |
| Kepercayaan & privasi | D | C+ | **B+** |
| **UI/UX keseluruhan** | **D+/C−** | **B−** | **A−/B+** |

**Definisi selesai untuk "desktop terbaik di kelasnya":** operator baru selesai onboarding < 10 menit tanpa membaca README; export tidak pernah mengejutkan; setiap gagal menjelaskan diri; app ini bisa dipakai demo ke klien tanpa malu — dan tidak pernah mengklaim lebih dari yang bisa dibuktikannya.

---

## 10. Lampiran — bukti & referensi

```
Working tree (belum commit): avatar_url (ALTER TABLE + migration), avatar di tabel Akun,
  titleBarStyle hidden + titleBarOverlay 40px, Menu.setApplicationMenu(null), maximize() on boot,
  CSP img-src 'self' data: https:, scripts/monitor.js
Grep renderer:  tidak ada 'debounce', ':focus-visible', 'role=', 'aria-', 'api.search', 'getCompare',
  'enqueueProfileVisits', 'target="_blank"', 'referrerpolicy', 'version', 'Tentang/About', ikon SVG apa pun
Export scope:   app.js:515  partial|failed|ok → lainnya undefined → seluruh DB diekspor
Keystroke:      app.js:496-498, 521-523  → loadTargets/loadAccounts langsung, tanpa debounce/guard
Polling:        app.js:479-487 (pollUpdate), 552-559 (onEvent + setInterval 5s: worker+dashboard saja)
#global-audit:  app.js:460-466  (innerHTML ditulis tiap event data)
Accounts:       app.js:~297  limit:200, sort:'risk', tanpa pager/filter platform
Toast:          app.js:73-80  (4s, tanpa aria-live/aksi); styles.css:218-221
Nav:            index.html:16-21  (<a> tanpa href), styles.css:56-66
Modal:          app.js:82-99  (tanpa role/aria-modal/trap/restore)
Target table:   app.js:239 (thead: <th> checkbox kosong tanpa label; tanpa kolom waktu scrape)
Browser:        index.html:148-161; app.js:34-71; main.js:106-111 (file:// diloloskan); will-attach-webview tanpa sandbox (main.js:222-227)
Pengaturan:     index.html:186-204  (tanpa restore/Tentang/privasi); app.js:387 (copy basi "+ Audit baru")
Kontras (dihitung ulang 2026-11-05): warn 3.19 · ok 3.77 · ig 4.23 · brand 5.17 · danger 4.83 ·
  faint 4.97/4.72 · lv-* 4.52–5.30 · usulan: #b45309 5.02 · #047857 5.48 · #be185d 6.04
IPC tak terpakai UI: data:search · data:compare · data:profileVisits  (preload.js:28,29,38)
README ≠ UI:    "+ Audit baru" (README:36) vs "＋ Import data" (index.html:40); "32 tes" (README:66) vs 42;
  "Node 20+" (README:17) vs butuh node:sqlite ≥ 22.13
```

**Tidak diverifikasi ulang (diwariskan dari audit v2/v3, masih berlaku kecuali ditulis lain):** `loadURL` tanpa timeout (P0 kode), index `tasks(target_id,id)`, intel O(n²) ~74 dtk @1.500 akun, kontras tabel di atas (dihitung ulang ✅), Electron 35 EOL, exceljs 31 vuln, `will-navigate` file:// (masih diloloskan — dicek ulang ✅), `Menu null` baru (WIP).

**Pertanyaan terbuka untuk pemilik produk:** (1) Windows-only resmi, atau macOS ikut? (2) Repo publik? (menentukan signing/updater/README) (3) Siapa PIC copy & siapa PIC etika (label indikasi)? (4) Apakah "Salin info diagnostik" boleh menyertakan path absolut (PII path)? (5) Dark mode default mengikuti sistem atau terang dulu?

*Disusun sebagai bahan perbaikan; tidak ada file sumber yang diubah oleh penulis dokumen ini. WIP pengguna dibiarkan utuh.*
