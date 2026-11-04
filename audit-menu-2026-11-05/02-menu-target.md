# Laporan Audit UI/UX — Menu **Target**

**Tanggal:** 2026-11-05 · **Halaman:** `#tab-targets` (`index.html:87-132`) · **Skor: C+**
**Basis:** HEAD `6e0b480` + working tree. Logic: `app.js:308-392, 744-764` · gaya: `styles.css:189-233`.

---

## Ringkasan

Halaman kerja utama operator — tabel 11 kolom, filter, bulk-select, retry, export. Fungsionalitasnya nyaris lengkap, namun ia masih bersikap **tabel admin generik**: tidak ada select-all, tidak ada ringkasan seleksi, aksi penting ("Ulangi gagal", "Export") diam-diam bergantung pada dropdown audit di Dashboard tanpa konteks, dan **tidak satu pun baris tabel bisa difokus keyboard**.

## Yang sudah baik — jangan diutak-atik

- Export **berpagar lingkup**: modal pratinjau berisi audit + status + jumlah baris sebelum commit (`app.js:624-654`); status `pending/running` ditolak dengan toast warning.
- Pencarian `#target-q` sudah di-debounce 300 ms (`app.js:730-748`).
- Filter status/platform/sort + pager `‹ Prev | Hal x / y | Next ›` dengan angka tabular (`app.js:309-322, 749-750`).
- Sticky header tabel + `max-height` + scroll horizontal (`styles.css:190-198`).
- Kolom `Di-scrape` relatif + tooltip absolut (`relTime`/`fmtWhen`, `app.js:336`) — bahasa manusia, bukan ISO.
- Checkbox per baris dengan `aria-label` menyebut handle (`app.js:327`); tombol bulk berubah teks `Ulangi terpilih (N)` + disabled saat kosong (`app.js:377-380`).
- Modal riwayat per target (`app.js:382-392`) — detail yang tepat untuk audit trail.

## Kritik & temuan

### [P0] T-01 — Gagal baca Target tanpa satu kata pun
- **Bukti:** `loadTargets()` dipanggil tanpa `catch` dari klik nav & filter (`app.js:203, 747-749`); isi fungsi tanpa try/catch (`app.js:308-356`).
- **Kritik:** IPC error → unhandled promise rejection; tabel tetap menampilkan halaman lama/kosong; operator mengira data memang kosong.
- **Dampak:** klasik "layar bisu" — persis kelas bug yang sudah diperbaiki di jalur tulis, dibiarkan hidup di jalur baca.
- **Arah:** bungkus `loadTargets` dengan try/catch → toast error + baris placeholder "Gagal memuat — Coba lagi" di `#targets-table tbody`.

### [P1] T-02 — "Ulangi gagal" & "Ulangi terpilih" menghukum state "Semua audit"
- **Bukti:** `if (!state.auditId) { toast('Pilih audit dulu.'); return; }` (`app.js:752-753, 759`) sementara dropdown global sengaja mengizinkan `Semua audit` (`app.js:665`) dan Export justru jalan tanpa audit terpilih (`app.js:631-632`).
- **Kritik:** aturan lingkup tidak konsisten di dalam satu halaman: Export boleh agregat, Retry dilarang — tanpa alasan yang pernah ditunjukkan ke pengguna. Toast berbunyi seolah kesalahan pengguna, bukan desain.
- **Arah:** (a) bila `auditId == null` → modal "Aksi ini butuh satu audit. Pilih: [dropdown]"; (b) atau izinkan retry agregat untuk target-target gagal lintas audit dengan teks eksplisit di modal konfirmasi ("Ulangi N gagal dari Semua audit"). Jangan toast menghakimi.

### [P1] T-03 — Baris tabel tidak keyboard-accessible
- **Bukti:** `row.addEventListener('click', …); openTarget(...)` (`app.js:345-350`) — `<tr class="clickable">` bukan fokusable; checkbox-nya satu-satunya elemen interaktif yang bisa di-Tab.
- **Kritik:** mouse wajib untuk membuka riwayat. Pelanggaran setara T-05 UIUX lama yang "sudah beres" ternyata belum benar-benar beres untuk baris.
- **Arah:** `tr` diberi `tabindex="0" role="row"` + keydown Enter → `openTarget`; atau tambahkan tombol kecil "Riwayat" di kolom terakhir. Fokus-visible pada tr harus terlihat jelas.

### [P1] T-04 — Tidak ada select-all & ringkasan seleksi
- **Bukti:** header checkbox kosong (`<th></th>`, `index.html` → `app.js:342`); tidak ada "Pilih semua (50 di halaman ini)".
- **Kritik:** untuk retry massal 200 target gagal, operator mencentang satu per satu. Bulk pattern setengah jadi.
- **Arah:** header checkbox (halaman ini) + state indeterminate; teks helper saat seleksi > 0: "N terpilih — [Hapus pilihan] [Ulangi terpilih]" — sticky bulk-bar di atas tabel.

### [P1] T-05 — "Pl." header + abbr tidak terbaca
- **Bukti:** kolom kedua berjudul `Pl.` (`app.js:342`).
- **Kritik:** singkatan tak standar; screen reader membacakan "pe-el". Badge IG/TT di bawah cukup jelas — header tidak perlu singkatan misterius.
- **Arah:** header `Platform` (lebar kolom cukup), atau `<abbr title="Platform">Pl.</abbr>` bila tetap sempit.

### [P2] T-06 — Empty state tanpa CTA & tanpa bedakan "belum ada" vs "filter mentok"
- **Bukti:** `Tidak ada target.` colspan=11 (`app.js:343`).
- **Kritik:** ketika filter terlalu ketat, teks yang sama menyesatkan seolah DB kosong; dan kapan pun kosong, tidak ada jalan pintas ke Import.
- **Arah:** dua cabang: (a) tanpa filter → "Belum ada target — **Import data** dulu" + tombol; (b) dengan filter → "Tidak ada yang cocok dengan filter — **Bersihkan filter**" (reset 4 kontrol).

### [P2] T-07 — Tidak ada page-size selector; halaman bisu soal kapasitas
- **Bukti:** `limit: 50` hardcoded di state (`app.js:16`); pager hanya Prev/Next; `#targets-page` teks `Hal x / y`.
- **Kritik:** operator dengan DB besar tidak bisa menaikkan ke 100/halaman; total ribuan target = klik Next tanpa akhir.
- **Arah:** dropdown `50 / 100 / 200` di pager kanan; pertahankan `state.targets.limit` reaktif; tampilkan `50–100 dari 1.234`.

### [P2] T-08 — Kolom URL/postingan tanpa truncation cerdas & copy affordance
- **Bukti:** `<td class="wrap" title="${esc(r.url)}"><a …>${tema || shortUrl(url)}</a></td>` (`app.js:330`); `shortUrl` memotong path di 40 char tanpa elipsis.
- **Kritik:** (a) potongan keras `slice(0,40)` tanpa `…`; (b) tidak ada tombol salin-link; (c) klik langsung membuka browser luar (will-navigate) — tidak ada tooltip "Buka di browser luar".
- **Arah:** `shortUrl` + `'…'`; ikon salin kecil per baris; `title="Buka di browser luar — {url}"`.

### [P2] T-09 — ER "—" ambigu & kolom numerik campuran vs `.num`
- **Bukti:** ER kosong → `—` (`app.js:335`); kolom `Di-scrape` bukan `.num` (benar) tapi header `Status` tanpa `scope` sampai MutationObserver berjalan (`app.js:869-874`).
- **Kritik:** `—` dipakai untuk "belum dihitung" dan "memang nol"; operator tak bisa bedakan. ER 0,0% valid vs ER null harus dibedakan (`fmtPct(null)` sudah membedakan, tapi tidak ada penanda visual untuk nol sejati).
- **Arah:** nol sejati → `0,0%`; belum ada → `<span class="muted">—</span>` dengan title "Belum ada data ER".

### [P2] T-10 — Toolbar bisa wrap tanpa hierarki di lebar sempit
- **Bukti:** `.toolbar` flex-wrap (`styles.css:229-231`); `.toolbar-actions { margin-left:auto }` (`styles.css:231`).
- **Kritik:** pada ≤1100px tombol aksi turun ke baris berikutnya tanpa pengelompokan visual — "Ulangi terpilih" (primary) terlihat sama pentingnya dengan filter.
- **Arah:** breakpoint <1100px: toolbar-actions full-width row, tombol primary paling kanan tetap.

### [P3] T-11 — Label "Di-scrape" berjargon Inggris verb
- **Arah:** `Terakhir diperbarui` (relatif) — konsisten dengan bahasa Indonesia di halaman lain; atau pertahankan `Di-scrape` + title.

## Prioritas perbaikan

1. **T-01** error baca yang bicara (pola sama dengan laporan 01/03).
2. **T-02** samakan aturan lingkup atau jelaskan via modal.
3. **T-03, T-04, T-05** keyboard baris + select-all + header manusiawi.
4. **T-06, T-07** empty state bercabang + page-size.
5. **T-08 … T-11** polesan.

## Verdict satu kalimat

Target adalah tempat kerja harian, dan ia sudah 80% jadi — kurang 20% yang membuatnya **memaafkan kesalahan** (error bicara, lingkup jelas) dan **menghormati tangan tanpa mouse** (keyboard + select-all).
