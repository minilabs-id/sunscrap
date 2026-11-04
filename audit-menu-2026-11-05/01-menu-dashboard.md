# Laporan Audit UI/UX — Menu **Dashboard**

**Tanggal:** 2026-11-05 · **Halaman:** `#tab-dashboard` (`index.html:47-84`) · **Skor: C+**
**Basis:** HEAD `6e0b480` + working tree. Render logic: `app.js:258-305, 695-712` · gaya: `styles.css:170-187`.

---

## Ringkasan

Dashboard adalah etalase utama, namun hari ini ia adalah **etalase angka bisu**: 6 KPI besar, tanpa delta, tanpa tren, tanpa perbandingan yang bisa ditindaklanjuti. Satu-satunya bukti data snapshot-to-snapshot (`getCompare`) diringkas menjadi satu kalimat polos (`app.js:700-712`) — padahal seluruh infrastruktur (6 periode, akun baru, akun hilang) sudah tersedia. Halaman terasa seperti "screenshot Excel yang dipermak", bukan kompas kampanye.

## Yang sudah baik — jangan diutak-atik

- KPI strip bergaris vertikal, `tabular-nums`, locale `id-ID`; sub-baris `OK n · sebagian m` di KPI Terverifikasi (`app.js:262-266`).
- Tabel platform dengan badge IG/TT dan kolom numerik rata kanan (`app.js:276-281`).
- Empty state manusiawi ("Belum ada data.") di panel Top views/ER (`app.js:271, 274`).
- Refresh otomatis hanya saat tab aktif + debounce 400 ms berbasis event `data` (`app.js:715-723, 862-864`).
- Grid `.kpi-strip` responsif 6→3 kolom di ≤1200px (`styles.css:295-298`).
- Print CSS menyembunyikan chrome dan memecah panel dengan benar (`styles.css:317-330`).

## Kritik & temuan

### [P0] D-01 — Gagal baca = layar beku tanpa penjelasan
- **Bukti:** `refreshDashboard` `catch {}` (`app.js:697`); `loadRiskAccounts` `catch {}` (`app.js:304`); `loadComparePanel` `catch` → `'—'` (`app.js:711`).
- **Kritik:** Tiga panel berbeda, tiga selubung kegagalan yang berbeda, **nol** toast/teks "gagal memuat". Operator tidak bisa membedakan "belum ada data" vs "DB terkunci / IPC error".
- **Dampak:** Keputusan kampanye diambil di atas layar yang tampak normal padahal basi.
- **Arah:** satu penangan terpusat `handleReadError(err, panel)` → toast error sticky + placeholder "Gagal memuat — coba lagi" + tombol ulangi per panel.

### [P1] D-02 — KPI tidak menjawab "lalu apa"
- **Bukti:** `renderDashboard` hanya mencetak nilai (`app.js:260-266`); `loadComparePanel` memanggil `getCompare({months:6})` tapi hasilnya satu baris teks tanpa visual (`app.js:700-712`).
- **Kritik:** 6 angka tanpa satu pun delta ("↑ 12% vs bulan lalu"), tanpa tren, tanpa highlight anomali. Untuk alat **audit berkala**, pertanyaan pertama pengguna adalah *"memburuk atau membaik?"* — tidak dijawab.
- **Dampak:** Dashboard dibuka lalu ditutup; navigasi pindah ke Target/Akun untuk "melihat sendiri".
- **Arah:** (a) KPI Terverifikasi/Keberhasilan + delta vs periode sebelumnya (warna + arah, ikon ▲▼), (b) panel compare → bar list ringkas (akun baru / hilang / naik-turun ER) atau sparkline 6-bulan, (c) empty-state compare diperjelas dengan CTA "Butuh ≥ 2 periode — jalankan audit ulang".

### [P1] D-03 — Badge platform menampilkan string mentah
- **Bukti:** `<span class="badge ...">${p.platform}</span>` mencetak `instagram` / `tiktok` huruf kecil (`app.js:279`).
- **Kritik:** Label mentah dari DB lolos ke UI; inkonsisten dengan badge di mana pun yang memakai `IG`/`TT` atau nama tampilan.
- **Arah:** satu `PLATFORM_LABEL = { instagram: 'Instagram', tiktok: 'TikTok' }` dipakai di semua badge.

### [P1] D-04 — Tautan postingan tanpa konteks & tanpa peringatan eksternal
- **Bukti:** `<a href="${esc(p.url)}" …>@handle</a>` di panel Top views/ER (`app.js:270, 273`). Teks tautan = handle saja; `will-navigate` membuka browser luar (`main.js:235-244`).
- **Kritik:** (a) tidak ada affordance "buka di browser luar" di hover/tooltip selain `title=url` mentah; (b) handle tanpa platform badge — dua handle identik di IG & TikTok tak terbedakan; (c) klik tunggal langsung melempar Anda keluar dari konsol — tidak ada opsi "buka di tab Browser in-app (sesi terlogin)".
- **Arah:** tambahkan badge IG/TT di samping handle; tooltip "Buka di browser luar (tanpa sesi login)"; alternatif klik-kanan/tombol kecil "↗ app" untuk membuka di tab Browser in-app (dengan peringatan sesi — lihat laporan 05).

### [P1] D-05 — Baris "Perlu tinjauan" tidak bisa dioperasikan keyboard
- **Bukti:** `<div class="row-item clickable" data-account …>` + `addEventListener('click')` (`app.js:297-303`). Bukan `<button>`, tanpa `tabindex`, tanpa handler Enter/Space.
- **Kritik:** satu-satunya jalur dari Dashboard ke detail akun berisiko tidak bisa dijangkau tanpa mouse.
- **Arah:** render sebagai `<button class="row-item">` (gaya reset) atau `role="button" tabindex="0"` + keydown Enter/Space → `openAccount(...)`.

### [P1] D-06 — "Semua audit" vs aksi yang butuh audit terpilih tidak dijelaskan
- **Bukti:** `#global-audit` default `Semua audit` (`app.js:665`); Dashboard menampilkan agregat lintas audit tanpa memberi label tegas "Agregasi N audit" di mana pun; toast retry di Target berbunyi "Pilih audit dulu" padahal state ini sengaja valid untuk Export.
- **Kritik:** agregat diam-diam mencampur kampanye berbeda; angka KPI tanpa label lingkup dapat disalahartikan.
- **Arah:** di atas KPI strip, tampilkan chip konteks: `Lingkup: Semua audit (3)` atau `Lingkup: Kampanye November` — sama dengan isi `#titlebar-context`, tapi terlihat di area konten.

### [P2] D-07 — Empty state tanpa CTA
- **Bukti:** `'<div class="muted">Belum ada data.</div>'` (`app.js:271, 274`); KPI nol semua saat DB kosong.
- **Kritik:** operator baru menatap nol-nol tanpa satu pun petunjuk ke langkah berikutnya (Import data / Mulai worker).
- **Arah:** gabung empty state panel Top views: "Belum ada data — **Import data** atau **Mulai worker** dulu" dengan 2 tombol ghost kecil.

### [P2] D-08 — Aksi primer halaman tidak konsisten bobotnya
- **Bukti:** hanya satu aksi primer: `＋ Import data` (`index.html:52`); Export, backup, dll. tersebar di halaman lain.
- **Kritik:** Dashboard tidak menawarkan "Export" padahal ekspor adalah keluaran utama kampanye; simbol `＋` (fullwidth) juga tidak konsisten dengan font/ikon lain.
- **Arah:** jadikan `[Import data]` primer + `[Export…]` ghost di page-actions; ganti `＋` dengan ikon/glyph standar (`+` atau SVG).

### [P2] D-09 — Loading state tidak ada; panel "pop in"
- **Bukti:** `#kpi-strip` kosong sampai `renderDashboard` jalan; `#compare-panel` satu-satunya yang punya "Memuat…" (`index.html:82`).
- **Kritik:** pada DB besar (1.500+ akun), panel berkedip kosong lalu terisi — layout shift dan persepsi "sementara rusak".
- **Arah:** skeleton shimmer sederhana untuk KPI strip & panel list; atau `aria-busy="true"` + placeholder bar.

### [P2] D-10 — Definisi metrik tidak dijelaskan di halaman
- **Bukti:** label KPI `Keberhasilan` (`app.js:264`), `Terverifikasi`, panel `Perlu tinjauan`, `Kualitas data` — tanpa tooltip/info icon.
- **Kritik:** operator baru tidak tahu apakah "Keberhasilan" = scrape sukses atau verifikasi manusia; "Tanpa followers" artinya profil menyembunyikan hitungan, dsb.
- **Arah:** ikon `?` kecil per KPI/panel → tooltip 1 baris definisi + rujukan ke Skor/Batasan. Jangan buka halaman bantuan baru.

### [P2] D-11 — KPI strip pecah di breakpoint 1200px
- **Bukti:** `.kpi-strip > .kpi { border-right: … }` + `:last-child` (`styles.css:180-181, 295-297`) → pada 3 kolom × 2 baris, border kanan terakhir di baris pertama masih tampil.
- **Kritik:** artefak garis di tengah kartu saat window sempit.
- **Arah:** ganti border-right dengan `gap` + `border-right` hanya pada item non-kelipatan-N kolom, atau gunakan `grid` dengan `divide` utility.

### [P3] D-12 — Label `.lbl` & chip tidak punya format global
- `Keberhasilan` menampilkan `fmtPct` tanpa arti basis; `Kualitas data` mencampur hitungan dan persentase tak jelas.
- **Arah:** konsisten: angka = hitungan, blok persen selalu dengan `%` + basis di sub-teks.

## Prioritas perbaikan

1. **D-01** (P0) `catch` yang bicara + placeholder gagal-muat per panel.
2. **D-02, D-06** — delta KPI vs periode lalu + chip lingkup audit.
3. **D-03, D-04, D-05** — label platform benar, tautan ber-affordance, baris keyboard-accessible.
4. **D-07, D-08** — empty state ber-CTA; aksi primer dashkonsisten.
5. **D-09 … D-12** — polesan.

## Verdict satu kalimat

Dashboard tahu segalanya tentang data, tapi belum tahu apa yang harus **dilakukan** operatornya — beri ia delta, lingkup yang jujur, dan tombol yang menuntun, ia akan berhenti jadi poster dan mulai jadi kompas.
