# Panduan Pemakaian sunscrap

Panduan lengkap penggunaan sunscrap — dari instalasi, alur kerja, sampai penjelasan cara kerja
tiap fitur. Ditulis untuk pengguna (bukan pemrogram). Bahasa antarmuka: Indonesia.

---

## 1. Mulai cepat

1. **Jalankan** aplikasi (installer `.exe`, atau `npm start` untuk pengembangan).
2. **Login** Instagram/TikTok di tab **Sesi & Login** (atau lewat tray → *Login*). Tanpa login,
   Instagram/TikTok akan membatasi akses scraping.
3. **Import data** — klik **"Import data"** (Ringkasan) lalu pilih file Excel/CSV (kolom `Link`/`URL`)
   atau tempel link postingan satu per baris. Maksimal 10.000 baris.
4. **Jalankan worker** — klik **"Mulai worker"** di sidebar. Worker akan mengunjungi tiap postingan,
   mengambil metriknya, dan mengisi data.
5. **Lihat hasil** di **Ringkasan**, **Postingan**, dan **Akun**.

> Data 100% lokal (`userData` OS). Tidak ada yang dikirim ke server selain Instagram/TikTok sendiri.

---

## 2. Alur kerja khas

```
Import tautan  →  Login  →  Jalankan worker  →  Tinjau (Perlu tindakan)  →  Ekspor / Audit ulang
```

Untuk audit **berulang** (mis. mingguan): atur **"Ulang (hari)"** saat import/edit audit —
worker otomatis mengantre run baru setelah N hari.

---

## 3. Panduan per halaman

### 3.1 Ringkasan (dashboard)
Membuka aplikasi langsung menjawab *"ada yang perlu ditindak?"*.

- **Perlu tindakan** — 4 kartu: **Perlu tinjauan** (akun terindikasi belum dijawab), **Postingan gagal**,
  **Sebagian**, **Belum diproses**. Klik → langsung ke tabel yang ter-filter.
- **KPI** — Total views · Terverifikasi · Tingkat berhasil · Jumlah akun. Semua bisa diklik.
- **Performa terburuk IG/TikTok** — akun dengan *engagement rate (ER)* terendah; urut paling jelek.
  Klik akun → buka profil di browser sesi.
- **Top konten IG/TikTok** — postingan dengan views/likes tertinggi. Klik → buka postingan.
- **Per platform** — perbandingan Instagram vs TikTok.
- **Kualitas data** — daftar masalah (tanpa followers, sebagian terbaca, TikTok tanpa views, tanpa
  handle, belum di-scrape) masing-masing dengan **tombol eksekusi** (kunjungi profil / scrape ulang)
  yang langsung mengantre perbaikan + menyalakan worker.
- **Perbandingan periode** — muncul bila ada ≥ 2 periode import; menampilkan akun baru/hilang.

### 3.2 Postingan
Tabel seluruh postingan yang di-import, satu baris = satu postingan.

- **Filter**: status (Semua/OK/Sebagian/Gagal/Menunggu), masalah data (Tanpa followers/TikTok tanpa
  views/Tanpa handle/Belum diproses), platform, dan pencarian.
- **Sort** dengan klik judul kolom. **Pilih kolom** lewat tombol **"Kolom"**.
- **Pilih baris** (checkbox) untuk **"Scrape ulang terpilih"**.
- **"Scrape ulang gagal"** — mengulang postingan yang gagal.
- **Export** (`.xlsx`) — mengikuti filter & audit aktif.
- **Buka di browser** — ikon `↗` di kolom Akun, atau tombol di modal riwayat.
- **Jumlah baris/halaman** — 50 / 100 / 300.

### 3.3 Akun
Daftar akun yang ditemukan dari postingan.

- **Skor** (0–10+) + **level** (bersih / amati / terindikasi / terindikasi kuat) = indikasi otomatis
  (bukan vonis); wajib verifikasi manual.
- Klik akun → **bukti** (flag + alasan + akun tertaut + seri bulanan) sebelum memutuskan
  **ditandai / bersih / konfirmasi**.
- **Perlu tinjauan** — mode triase: hanya akun terindikasi yang belum dijawab.
- **Distribusi risiko** & **Klaster utama** — gambaran tingkat kecurigaan & kelompok akun tertaut.
- Filter **"Belum bisa dinilai"** (data kurang) dan **"Data basi"** (>7 hari).

### 3.4 Proses
Pemantauan worker.

- **Indikator live** — nama akun yang sedang diproses + estimasi % + bar progres.
- **Antrean** — OK / sebagian / gagal / menunggu, plus perkiraan sisa waktu.
- **Aktivitas terbaru** — feed task yang barusan diproses (+ Δ vs kunjungan sebelumnya).
- **Detail teknis** (bisa dibuka) — pace, siklus, budget harian/sesi, mode.

### 3.5 Sesi & Login
- **Status sesi** IG/TikTok (titik hijau = login).
- **Browser internal** — jelajah & login langsung di sini; sesi dipakai juga oleh worker.

### 3.6 Pengaturan
- **Audit** — audit ulang / kunjungi profil / edit / hapus (menu `⋯`).
- **Database** — cadangkan, pulihkan dari cadangan.
- **Pembaruan** — cek & pasang versi baru dari GitHub Releases.
- **Tampilan** — tema (sistem/terang/gelap) & kepadatan tabel.
- **Privasi & diagnostik** — salin info diagnostik, buka folder data.
- **Zona berbahaya** — hapus sesi login, hapus semua data (butuh konfirmasi ketik `HAPUS`).

---

## 4. Cara kerja (fitur utama)

### 4.1 Worker & scraping
Worker berjalan di **jendela tersembunyi**: membuka halaman postingan/profil, menyuntikkan scraper,
lalu mengekstrak **likes, komentar, views, shares, followers, caption, tanggal unggah**. Hasilnya
disimpan sebagai **snapshot** (riwayat per kunjungan).

Kecepatan dikontrol **rate limiter** agar tidak dicap bot:
- **Mode** otomatis: Cepat (1,5–3 dtk) / Normal (3–8 dtk) / Aman (5–10 dtk) antar kunjungan.
- **Warm-up** (5 task awal lebih lambat) + **fatigue** (makin lama makin melambat).
- **Budget**: maks 500 kunjungan/siklus, 2000/hari + jeda istirahat tiap 30–50 task.
- **Circuit breaker**: 3 kegagalan beruntun → platform dijeda 10 menit; 3× butuh login → berhenti.

### 4.2 Mesin intel (deteksi akun ternak/kembar)
Skor risiko dihitung dari **data publik** (bukan identitas) sebagai *indikasi*, bukan vonis:

| Poin | Sinyal |
|---|---|
| +4 | Unggahan sama muncul di akun lain |
| +3 | Kontak (email/no.HP) di bio dipakai akun lain |
| +2 | Caption seragam lintas akun · jangkauan sangat rendah · komentar nyaris nol · unggahan bertumpuk · followers datar |
| +1 | Caption mirip · unggahan serentak · following > followers |

- Skor **≥ 10** = "terindikasi kuat", **≥ 6** = "terindikasi", **≥ 2** = "amati", **0** = "bersih".
- **Klaster** = kelompok akun yang saling tertaut (konten/kontak/nama/caption sama) — pakai *union-find*.
- Akun dengan data tak lengkap diberi catatan **"belum bisa dinilai"** (bukan dianggap aman).

### 4.3 Engagement rate (ER)
- **Instagram**: `(likes + komentar) / followers × 100`.
- **TikTok**: `(likes + komentar + share) / views × 100`.

Nilai median (bukan rata-rata) dipakai agar satu postingan viral tidak menggeser angka.

### 4.4 Delta (Δ)
Perubahan metrik vs **kunjungan sebelumnya** (snapshot terakhir). Menjawab: *"seberapa cepat
postingan ini bertumbuh?"*.

### 4.5 Audit berulang
Atur **"Ulang (hari)"** — worker otomatis membuat run baru setelah interval, mengunjungi
ulang postingan yang sama dan merekam pertumbuhan antar periode.

### 4.6 Kualitas data
Aplikasi menandai data yang belum lengkap agar tidak menyesatkan:
- **Tanpa followers** → ER IG tidak bisa dihitung.
- **Sebagian terbaca** → ada metrik gagal ter-ekstrak.
- **TikTok tanpa views** → video privat/age-gated, atau post foto.
- **Tanpa handle** → username tidak ter-parse.
- **Belum diproses** → tidak ada snapshot sama sekali.
Masing-masing bisa **dibereskan** lewat tombol eksekusi di kartu Kualitas data.

### 4.7 Sesi & bridge browser
Sesi login disimpan di partisi `persist:sunscrap`. Ekstensi pendamping (browser) bisa **menyinkronkan
sesi** dari browser yang sudah login — lihat `docs/SESSION-BRIDGE.md`.

---

## 5. Ekspor Excel

Export menghasilkan dua sheet:
- **Data** — tiap postingan: platform, URL, username, followers, likes, komentar, views, shares,
  ER, nilai sebelumnya, Δ (delta), tanggal unggah, caption, status, error, keputusan tinjauan.
- **Rekap** — ringkasan per audit/platform/akun + temuan autentisitas (skor & klaster) + rumus & catatan.

---

## 6. Tanya jawab / troubleshooting

**Q: Mengapa worker berhenti sendiri?**
Biasanya karena *login kedaluwarsa* (3× AUTH) atau *throttled* (dibatasi platform). Login ulang,
tunggu sebentar, lalu jalankan lagi.

**Q: Mengapa angka "Performa terburuk" kosong?**
Hanya akun dengan **≥ 2 post terukur & punya followers** yang masuk (agar median ER bermakna).

**Q: Mengapa ER tampil "—"?**
Berarti follower (untuk IG) atau views (untuk TikTok) tidak diketahui. Kunjungi profil / scrape ulang
untuk melengkapi.

**Q: Apakah skor "terindikasi" = akun palsu?**
Tidak. Itu indikasi otomatis dari data publik — verifikasi manual dulu sebelum mengambil tindakan.

**Q: Di mana data tersimpan?**
Di folder `userData` OS (buka lewat **Pengaturan → Buka folder data**). Backup lewat
**Pengaturan → Cadangkan database**.

---

## 7. Pintasan keyboard

| Pintasan | Aksi |
|---|---|
| `Ctrl K` | Command palette (cari + aksi) |
| `Ctrl 1…6` | Pindah tab |
| `Ctrl I` / `Ctrl E` | Import / Export |
| `Ctrl Shift B` | Cadangkan database |
| `Esc` | Tutup dialog |