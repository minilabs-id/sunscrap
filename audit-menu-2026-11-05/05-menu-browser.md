# Laporan Audit UI/UX — Menu **Browser**

**Tanggal:** 2026-11-05 · **Halaman:** `#tab-browser` (`index.html:173-186`) · **Skor: C−**
**Basis:** HEAD `6e0b480` + working tree. Logic: `app.js:50-102, 205, 798` · webview: `main.js:392-400, 233-244` · scraper partition: `scraper.js:15, 54-70, 170`.

---

## Ringkasan

Halaman paling **berisiko** di seluruh aplikasi dan sekaligus yang paling minim pengaman pengalaman: ia adalah *jendela langsung ke akun Instagram/TikTok operator yang sedang login* — penulisannya nyata (like, follow, komentar dari jari Anda sendiri) — namun tidak ada satu pun rambu visual yang mengatakannya. Secara chrome, halaman ini terasa seperti "webview ditempel apa adanya": tanpa progress, tanpa status sesi, tanpa cara balik ke app selain tombol ←/→.

## Yang sudah baik — jangan diutak-atik

- URL non-sosial **tidak pernah dimuat** di webview — dilempar ke browser luar (`app.js:72-77, 82-84`); allowlist host tepat sama dengan layer utama (`isSocialHost` vs `policy.js`).
- `new-window` ditolak & dibuka eksternal; `will-navigate` non-sosial pun dicegat (`app.js:82-90`) — tidak ada jalan membocorkan sesi ke domain lain.
- Webview `sandbox` + `contextIsolation` + tanpa `preload` (`main.js:394-399`); partisi `persist:sunscrap` dibagikan dengan scraper — tepat, itu intinya login sekali.
- Tombol pintas `Instagram` / `TikTok`; `⟳` muat ulang; Enter di URL menavigasi (`app.js:95-101`).
- Tombol `☰`-setara (IG/TT) selalu memuat halaman utama — recovery sederhana saat tersesat.

## Kritik & temuan

### [P0] B-01 — Tidak ada rambu "Anda sedang login sebagai @akun"
- **Bukti:** webview `persist:sunscrap` (`index.html:184`) = partisi **yang sama** dengan scraper tersembunyi (`scraper.js:15, 167`); halaman menampilkan IG/TT tanpa badge/banner siapapun.
- **Kritik:** operator membuka tab Browser, mengira ini "sekadar viewer", lalu mengklik like/follow/komentar/report di UI asli — **aksi itu dilakukan akun asli yang dipakai scraping**, terlihat oleh platform, dan bisa berujung pembatasan akun. UI tidak pernah mengatakannya; `title` tombol pun tidak.
- **Dampak:** kerugian nyata (akun operator) — bukan kosmetik.
- **Arah:** (a) strip permanen tipis di atas webview: `● Sesi @nama_akun — setiap aksi di halaman ini dilakukan akun ini. [Detail sesi]` — sumber: baca cookie/session partition atau `data:profileVisits`? minimalis: teks tetap + timestamp login terakhir; (b) sekali per sesi app/hari, toast info pertama kali mengunjungi tab Browser: "Tab ini tersambung ke sesi login operator."

### [P1] B-02 — Tanpa progress/loading/stop; blank putih saat memuat
- **Bukti:** `.browser-wrap { background: #fff }` statis (`styles.css:292`); tidak ada indikator loading; `did-fail-load` hanya toast 4 detik (`app.js:91-93`) dengan pesan teknis (`e.errorDescription`).
- **Kritik:** IG lambat = halaman "kosong putih" tanpa tanda kehidupan; error tampil sekilas lalu hilang — operator bingung apakah offline, sesi mati, atau TikTok memblokir.
- **Arah:** progress bar tipis (3px, brand) di tepi atas `.browser-wrap` via `did-start-loading`/`did-stop-loading`; tombol `×` (stop) di `browser-bar`; pada `did-fail-load`: overlay di area webview (bukan toast!) berisi error ramah + `[Muat ulang] [Buka di browser luar]` + detail kode.

### [P1] B-03 — Tombol back/forward tidak pernah tampil nonaktif; no-op membingungkan
- **Bukti:** `#browser-back`/`#browser-fwd` selalu enabled; klik memanggil `canGoBack()/canGoForward()` (no-op saat false) (`app.js:97-98`) — padahal `btn-ghost:disabled` sudah di-styling global (`styles.css:136`).
- **Arah:** binding `did-navigate`/`did-navigate-in-page` + sekali saat init: set `disabled` sesuai `canGoBack()/canGoForward()`; refresh tombol reload juga nonaktif saat `isLoading()`.

### [P1] B-04 — Tidak ada jalan "buka laman ini di browser luar (tanpa sesi)"
- **Bukti:** tidak ada tombol di `browser-bar` untuk itu; hanya navigasi arbitrer yang tercegat otomatis (`app.js:82-84`) — pengguna harus tahu mekanisme internal untuk memaksa versi non-login.
- **Kritik:** kadang justru diinginkan melihat versi publik (tanpa sesi) untuk verifikasi konten — saat ini tidak mungkin tanpa mengetik ulang di Chrome sendiri.
- **Arah:** tombol `↗ Browser luar` di `browser-bar`: buka URL webview saat ini via `openExternal`; tooltip menjelaskan "tanpa sesi login".

### [P1] B-05 — Tidak ada tombol "kembali ke aplikasi" selain sidebar; dan halaman tanpa judul
- **Bukti:** satu-satunya `.page-head` hilang — `#tab-browser` langsung `.browser-bar` (`index.html:174`); tanpa `<h1>`, tanpa breadcrumb, tanpa `aria-label` konteks.
- **Kritik:** inkonsisten dengan semua tab lain (yang punya `page-head`); juga accessibility: `#browser-url` adalah input URL tanpa label ter-asosiasi (placeholder saja) — screen reader membaca placeholder sebagai nama, tidak ideal.
- **Arah:** page-head tipis: `<h1>Browser</h1>` + subteks "Sesi login operator — IG & TikTok" (double klik fungsi P0 sebagai penanda lokasi); label tersembunyi `<label class="sr-only" for="browser-url">URL</label>`.

### [P2] B-06 — `https://…` placeholder tanpa contoh IG/TT persis & tanpa history URL
- **Bukti:** placeholder `https://www.instagram.com/…` (`index.html:178`); baseline `ensureBrowser` memuat IG (`app.js:62`) — first-visit selalu IG walau pengguna TikTok-only.
- **Arah:** (a) remember platform terakhir di `localStorage` (`sa_browser_last`) → `ensureBrowser` pakai itu; (b) datalist/history 10 URL terakhir (opsional; jangan kebocoran lintas audit).

### [P2] B-07 — Dark mode: `.browser-wrap` tetap `#fff` keras
- **Bukti:** `background: #fff` hardcoded (`styles.css:292`) — sengaja (konten remote), tapi frame-nya menyilaukan di tema gelap.
- **Arah:** biarkan isi putih (webview) tapi beri padding/surface gelap mengelilingi (sudah gelap via border, tapi tambahkan `background: var(--surface-sunken)` di `.browser-wrap` sekitar 8px inset — atau minimal `color-scheme` jelas). Ini bug persepsi, bukan bug.

### [P2] B-08 — Tidak ada pintasan ke "Hapus sesi di sini"
- **Bukti:** hapus sesi hanya di Pengaturan → Zona berbahaya (`index.html:247`) — jauh dari tempat operator menyadari perlu logout.
- **Arah:** tombol kecil `Keluar sesi…` di `browser-bar` kanan → modal konfirmasi clear session (reuse alur settings) — satu jalan pintas, bukan duplikasi logika.

### [P3] B-09 — Nama tombol `Buka` terlalu generik
- **Arah:** `Kunjungi` / `Buka URL`; `⟳` beri `title` "Muat ulang (Ctrl+R)" yang valid — saat ini Ctrl+R tidak di-bind apa pun di tab ini.

## Prioritas perbaikan

1. **B-01** rambu sesi (P0) — satu strip, satu tooltip, satu toast sekali.
2. **B-02, B-03** progress + state tombol — pola standar embeded browser.
3. **B-04, B-05** jalur keluar & konsistensi chrome/a11y.
4. **B-06 … B-09** polesan.

## Verdict satu kalimat

Tab Browser adalah pintu masuk ke akun asli yang disembunyikan di balik tampilan "webview polos" — ia tidak perlu dihapus, hanya **diberi plang**: siapa, pakai sesi apa, dan bagaimana keluar.
