# Laporan Audit UI/UX — Menu **Akun**

**Tanggal:** 2026-11-05 · **Halaman:** `#tab-accounts` (`index.html:135-170`) · **Skor: C+**
**Basis:** HEAD `6e0b480` + working tree. Logic: `app.js:395-491, 766-772` · gaya: `styles.css:134-135, 218-233, 276-281`.

---

## Ringkasan

Halaman paling "pintar" (skor risiko terindikasi kuat/kembar) sekaligus halaman dengan **terminologi paling tidak konsisten**: filter menyebut "Terindikasi kuat", badge menampilkan "pola kembar", modal menampilkan "Indikasi (N poin)". Ditambah satu asumsi struktural rapuh — `a.metrics.view_reach_pct` dibaca langsung tanpa jaga-jaga — halaman ini bisa gagal render total hanya karena satu baris data tidak lengkap.

## Yang sudah baik — jangan diutak-atik

- Filter level/band/platform + pencarian bio/nama (`index.html:141-161`); paginasi offset/limit benar (`app.js:405-409`).
- Helper "Bagaimana skor dihitung?" dengan disclaimer kuat: *indikasi otomatis, wajib verifikasi manual* (`app.js:432-446`) — ini **teladan copy etis**; pertahankan apa adanya.
- Modal detail akun: avatar besar, metrik dua kolom besar, flags (+poin) transparan, akun tertaut, seri bulanan, tombol hapus dengan ketik-konfirmasi username (`app.js:448-491`).
- Avatar lokal `sa-avatar:` — tidak bocor ke CDN (sudah beres dari audit sebelumnya).
- Summary header informatif: `N akun · M terindikasi · K klaster` (`app.js:408`).
- Badge level berwarna semantik (bersih = hijau, amati = kuning, ternak = oranye-tua, kembar = merah) (`styles.css:221-224`).

## Kritik & temuan

### [P0] A-01 — Satu baris data buruk = seluruh tabel gagal render
- **Bukti:** di dalam `state.accounts.items.map(...)`, akses `a.metrics.view_reach_pct`, `a.metrics.like_reach_pct`, `a.metrics.posts_seen`, `a.flags` langsung (`app.js:421-424`); `loadAccounts` tanpa try/catch sama sekali (`app.js:395-430`); pemanggil (nav/filter) tidak menangani rejection (`app.js:204, 768-772`).
- **Kritik:** `metrics` `null`/kurang lengkap pada satu akun idealitas robot → `TypeError` → innerHTML tidak pernah ditulis, tabel membeku di konten lama, nol umpan balik.
- **Dampak:** halaman paling sensitif (menyentuh "tuduhan" akun) mati senyap.
- **Arah:** (a) default aman `const m = a.metrics || {}`; (b) try/catch di `loadAccounts` + skeleton fail state ("Gagal memuat — Coba lagi") + tombol; (c) validasi ringan di preload/IPC bila memungkinkan. Jangan pernah render crash diam-diam.

### [P1] A-02 — Terminologi tiga wajah untuk satu konsep
- **Bukti:** filter option: "Terindikasi kuat" / "Terindikasi" (`index.html:144-145`); badge: `a.level.replace('_', ' ')` → "pola kembar" / "pola ternak" (`app.js:418`); modal head: badge level mentah (`app.js:455`); bantuan skor memakai istilah "Unggahan sama muncul di akun lain" dsb. (`app.js:438-442`).
- **Kritik:** satu pengguna, tiga kosakata. `.replace('_',' ')` juga hanya mengganti underscore **pertama** — `pola_kembar` kebetulan aman, tapi ini jebakan untuk level baru (`pola_x_y`). Operator baru mengira "pola kembar" adalah nama ilmiah; filter mengonfirmasi "Terindikasi kuat" — dua hal terdengar seperti data berbeda.
- **Arah:** satu mapping tunggal `LEVEL_LABEL = { pola_kembar: 'Terindikasi kuat', pola_ternak: 'Terindikasi', amati: 'Amati', bersih: 'Bersih' }` dipakai filter, badge, modal; tooltip pada badge tetap menampilkan poin/skor.

### [P1] A-03 — Baris tabel tak keyboard-accessible (pola sama dengan Target)
- **Bukti:** `row.addEventListener('click', () => openAccount(...))` pada `<tr class="clickable">` (`app.js:427`); tanpa `tabindex`/keydown.
- **Arah:** `tabindex="0"` + Enter/Space → buka detail; fokus-ring terlihat di `.table tr:focus-visible`.

### [P1] A-04 — Tidak ada pengurutan di UI
- **Bukti:** `sort: 'risk'` di-hardcode di params (`app.js:401`).
- **Kritik:** Target punya 7 opsi sort; Akun hanya bisa by-risk. Untuk review harian, "sort by followers / reach / skor terbaru" masuk akal — tapi backend `getAccounts` mendukung sort risk saja? Bila tidak, tawarkan minimal: Risiko / Followers / Reach / Baru disimpan — atau sembunyikan ilusi pilihan.
- **Arah:** cek dukungan IPC `data:accounts`; jika ada `sort` param, expose; jika tidak, tambahkan `sort` di handler (DB-side) atau dokumentasikan keterbatasan di halaman ("Diurutkan otomatis berdasarkan risiko").

### [P2] A-05 — Reach preference tersembunyi: `view_reach → like_reach` fallback tanpa label
- **Bukti:** `${a.metrics.view_reach_pct !== null ? fmtPct(...) : (a.metrics.like_reach_pct !== null ? fmtPct(...) : '—')}` (`app.js:421, 459`) — diam-diam menukar metrik tanpa memberi tahu.
- **Kritik:** dua angka jangkauan yang beda definisi ditampilkan di kolom yang sama berjudul `Reach`. Operator platform-berbeda tidak tahu angka mana yang sedang dibaca (views-based vs likes-based).
- **Arah:** sub-teks kecil per sel atau legenda: `Reach (views)` / `Reach (likes)*` dengan footnote "*dipakai bila data views tak tersedia"; unggulan: satu kolom, dua sub-metrik di modal.

### [P2] A-06 — Avatar tanpa fallback saat file cache hilang/korup
- **Bukti:** `<img src="sa-avatar://...">` tanpa penanganan error (`app.js:372-374`); handler protokol mengembalikan 404 (`main.js:336-343`).
- **Kritik:** ikon "gambar rusak" muncul alih-alih inisial fallback — kosmetik, tapi di halaman yang menilai manusia, persepsi "data rusak" memperburuk kepercayaan. Catatan: atribut `onerror` inline diblokir CSP `script-src 'self'` — harus event delegation di `app.js`.
- **Arah:** delegasi `error` pada `#accounts-table img.avatar` → ganti dengan `.avatar-fallback` berisi inisial (set data-username di img).

### [P2] A-07 — `#account-legend` diisi ulang tiap render
- **Bukti:** `legend.innerHTML = '<button … id="score-help">'` + re-attach listener setiap `loadAccounts()` (`app.js:410-411, 429`).
- **Kritik:** bukan bug fungsional, tapi pola "inject + rebind" yang rapuh — jika suatu saat dua tombol bantuan dibutuhkan, ID duplikat terjadi.
- **Arah:** render button sekali di `index.html` (static), bind di `bindEvents()`. `legend` hanya menampung chip jumlah.

### [P2] A-08 — Empty state bagus teksnya, tapi tanpa tombol aksi
- **Bukti:** `Belum ada akun tersimpan. Jalankan worker untuk mengisi data.` (`app.js:425`).
- **Kritik:** satu-satunya empty state dengan petunjuk, tapi berhenti di kata — tidak ada tombol "Mulai worker" di sebelahnya.
- **Arah:** tambahkan `[Mulai worker]` ghost kecil → memicu `api.workerStart()` (reuse `toggleWorker`).

### [P2] A-09 — Badge `lv-*` dark mode setengah-matang
- **Bukti:** dark overrides hanya untuk `lv-bersih`, `lv-amati` (`styles.css:314-315`); `lv-pola_kembar` / `lv-pola_ternak` tetap latar pastel terang dengan teks gelap di tema gelap.
- **Kritik:** chip menyala menyilaukan di atas `--surface` gelap; inkonsisten dengan saudara-saudaranya.
- **Arah:** 2 aturan dark lagi: `bg #3b1d1d / #3a2410` + teks `#fca5a5 / #fdba74`.

### [P3] A-10 — Modal detail: hierarki "panel dalam modal" tidak konsisten dengan modal lain
- **Bukti:** tabel `history` di dalam `<div class="panel">` di dalam modal (`app.js:464`).
- **Kritik:** panel-dalam-modal menumpuk border/radius ganda; di modal lain (audit hapus) body polos.
- **Arah:** gunakan `.modal-section` (judul kecil + divider), bukan `.panel`, di dalam modal.

## Prioritas perbaikan

1. **A-01** defensive render + error path bicara.
2. **A-02** satu mapping level → label manusia.
3. **A-03, A-04** keyboard baris + sort (atau dokumentasi non-pilihan).
4. **A-05, A-06, A-08** transparansi metrik, fallback avatar, empty-state aksi.
5. **A-07, A-09, A-10** polesan.

## Verdict satu kalimat

Halaman Akun sudah lebih jujur daripada mayoritas dashboard analytics — tapi satu baris rapuh bisa mematikannya, dan tiga kosakata membuatnya menghakimi sebelum menjelaskan.
