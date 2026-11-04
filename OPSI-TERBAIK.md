# Opsi Terbaik untuk sunscraping — Verifikasi Iklan & Deteksi Akun Ternak (Budget Nol)

**Tanggal:** 4 Nov 2026 · **Konteks:** agensi penjual jasa posting iklan/promosi di Instagram networks/influencer; menerima **ribuan link per bulan** (≈ ratusan per hari) untuk laporan hasil; mustahil dicek manual; program ini dibuat untuk **memastikan iklan benar-benar diposting secara jujur, dengan akun yang besar dan riil** — termasuk mendeteksi **akun ternak**. Budget menipis → semua solusi di bawah **Rp 0**.
**Menggantikan laporan sebelumnya** (dihapus atas permintaan Anda). Fokus: jalur paling cerdas yang bisa dibangun dari aplikasi yang sudah ada.

---

## 0. Inti masalah (dibaca ulang dengan benar)

Secara volume, beban Anda **tidak besar**: 3.000 link/bulan ≈ 100–150/hari. Dengan jeda wajar (10–20 detik/kunjungan), satu mesin sanggup memverifikasi semuanya — **bottleneck Anda bukan throughput, tapi akurasi verifikasi dan tenaga manual untuk memutuskan "lolos / curiga"**.

Jadi desain yang benar bukan "lebih cepat scraping", melainkan:

1. **Otomatiskan 90%+ keputusan** (post ada? sesuai brief? akun riil? tetap tayang?),
2. **Tinggal 10% yang meragukan → manual**,
3. **Simpan bukti** (screenshot + metrik + tanggal) agar sengketa invoice bisa dijawab tanpa debat,
4. **Pakai posisi Anda sebagai pemberi kerja**: influencer dibayar — syarat wajar = ada bukti & kepatuhan; itu leverage gratis yang lebih kuat daripada teknologi apa pun.

---

## 1. Tiga leverage gratis yang diabaikan aplikasi sekarang

| Leverage | Apa yang diberikan | Biaya |
|---|---|---|
| **Halaman publik** (sudah di-scrape) | Keberadaan post, caption, tanggal, likes/comments/views, status akun — cukup untuk menilai "diposting & jujur?" | Rp 0 |
| **Posisi pemberi kerja** (klausul kontrak) | Persyaratan bukti: screenshot Insights resmi, tetap tayang N hari, izinkan cek ulang | Rp 0 |
| **Perbandingan & konsistensi** | Kecurangan terdeteksi dari **ketidakkonsistenan** (klaim vs publik, post hilang, angka datar, pola kembar), bukan dari satu angka | Rp 0 |

---

## 2. Arsitektur verifikasi cerdas — 4 tahap

```
Tahap 1  IMPORT & NORMALISASI     (sudah ada)
         CSV/tempel link → validasi → duplikat dilewati → antrean per kampanye

Tahap 2  CEK POST & BRIEF         (BARU — nilai tertinggi)
         post ada? dari akun yang benar? caption/mention/#hashtag/link sesuai brief?
         tanggal sesuai jadwal? → skor "konformitas" 0–100 per target

Tahap 3  METRIK + BUKTI           (sudah ada + BARU)
         likes/comments/views/ER + SCREENSHOT otomatis tersimpan per post
         (webContents.capturePage → PNG ke userData/evidence/YYYYMM/id.png)

Tahap 4  SKOR RISIKO & TRIASE     (sudah ada → diupgrade)
         hijau = lolos otomatis | kuning = spot-check 10–20% | merah = wajib manual
```

Ekonomi kerja manual: dari 3.000 → **±150–300 keputusan manual/bulan**. Sisanya mesin.

---

## 3. Verifikasi per jenis "kecurangan" yang umum — semua gratis

| Kecurangan yang mungkin | Cara verifikasi (gratis) | Hasil |
|---|---|---|
| Tidak posting sama sekali, klaim "sudah" | Fetch halaman; 404/challenge/login wall → flag | **Inti app Anda sekarang** |
| Post dari akun lain / akun kecil | Username di link ≠ klien brief → flag | Parser sederhana |
| Caption/mention/hashtag/link tidak sesuai brief | Ekstrak caption → cocokkan token wajib (mention brand, #hashtag, URL); laporkan elemen yang hilang | Skor konformitas + daftar kekurangan |
| Post meleset dari jadwal | `posted_at` vs tanggal kontrak (± toleransi) | Flag terlambat/awal |
| **Hapus post setelah dibayar** | **Re-check terjadwal D+7 & D+30**; hilang → flag + screenshot terakhir | Fitur paling dicari agensi; lihat §6 |
| Angka engagement di-gelembungkan (beli like) | Bandingkan angka publik vs klaim screenshot creator; selisih >15–20% → flag | Lihat §5 |
| ER tidak wajar untuk ukuran akun | Median ER vs band followers (lihat §4.6) | Flag otomatis |
| Akun ternak / dibeli | Klasterisasi (sudah ada) + sinyal baru §4 | Ring persisten per jaringan |
| Komentar bot | Ratio komentar generik vs substantif (regex "nice/ok/mantap/emoji-only") | Flag kualitas |
| "Akun besar" tapi followers palsu | ER median sangat rendah + following/followers ≥ 1 + growth datar | Flag §4.6 |
| Lapor terlambat / tidak lapor | Deadline form + daftar merah "belum kirim bukti" | Proses, bukan scrape |

**Catatan:** tidak ada satu pun di atas yang butuh API atau uang — hanya halaman publik + proses Anda.

---

## 4. Deteksi akun ternak — sinyal gratis, diurutkan dari paling worthwhile

### 4.1 Yang sudah ada — perbaiki dulu (prasyarat kredibilitas)
1. **Bug `FLAT_FOLLOWER` band 20K–100K mati** (`intel.js:342` terhalang `inBand` 5–20K) → buka gate-nya; akun 25K–100K datar selama berbulan-bulan adalah pola ternak klasik.
2. **Token tanggal di bio → dianggap nomor telepon** ("Est. 2026.10.01" → `phone:20261001`): akun satu kampanye lahir di tanggal sama → semua saling tertaut "kontak sama" → vonis salah massal. Wajib beres sebelum skor dipakai untuk keputusan bayar/tolak.
3. **Skor bisa negatif** → clamp 0.

### 4.2 Sinyal baru — biaya ~0, nilai tinggi
4. **Hash URL foto profil** — bandingkan **string URL**-nya (tanpa download): ternak sering memakai avatar default/duplikat. Identik persis pada N≥5 akun → klaster. Implementasi ±30 baris.
5. **Link yang sama di bio** (linktree/wa.me/lynk.id/toko yang sama persis) → klaster "satu operator". Regex ekstrak `https?://\S+` dari bio; cocokkan exact; timbang +2.
6. **Caption template lintas akun** (sudah ada) **+ hashtag set identik** — tambahkan normalisasi hashtag eksak (bukan hanya 40 karakter depan); set ≥8 hashtag identik pada ≥10 akun → sinyal kuat.
7. **Pola username serial** — `nama01, nama02…` atau handle acak 8+ digit pada satu jaringan → regex + jarak edit; flag "naming pattern".
8. **Variasi like 10 post terakhir** — hitung koefisien variasi (stddev/mean): <0.15 → like terlalu "stabil" (ciri farm/beli likes); natural biasanya lebih menyebar. (Catatan: post foto tanpa views jangan ikut hitung views.)
9. **Kualitas komentar** — bila halaman memuat komentar: rasio komentar generik (daftar kata + emoji-only) terhadap total; >70% generik pada akun ≥20K followers → flag; ini indikasi engagement palsu, bukan pembuktian.
10. **Rasio following/followers ≥ 1** pada akun "besar" — sudah ada (`akun_salur`); naikkan bobotnya untuk band 20K–100K.

### 4.3 Sinyal perilaku dari waktu (sudah ada, dimanfaatkan lebih)
11. **Upload serentak** (sudah ada) **+ lintas kampanye**: akun-akun yang upload dalam menit yang sama di **klien berbeda** — klaster waktu lintas klien. Data Anda sudah punya `posted_at`; tinggal query `PARTITION BY bucket 5 menit` lintas `audit_id`.
12. **Cadence abnormal**: akun pasif berbulan-bulan lalu meledak tepat saat job — tanda "baru dibeli/diaktifkan". Dari `account_history` (sudah ada) — deteksi `delta post_count` besar setelah bulan kosong.

### 4.4 Yang TIDAK perlu (dan kenapa)
- **Download & analisis gambar** (perceptual hash foto profil) — mahal & tidak perlu; URL hash (4.2.4) sudah menangkap kasus umum.
- **Follower list scraping** — berat, tidak stabil, dan tidak memberi skor yang sebanding dengan usaha; lewati.
- **ML/embedding caption** — overkill; regex + template sudah cukup untuk pola industri ini.
- **Skor tunggal tanpa alasan** — selalu tampilkan alasan (sudah ada `reasons`); jangan diubah.

### 4.5 Keputusan produk atas deteksi
- Skor = **indikasi**; keputusan (tolak/bayar) tetap manusia — ini yang melindungi Anda secara bisnis saat ada sengketa.
- **Ambang per jaringan** (bukan global): tiap mediagram punya toleransi; simpan `network_baseline` (median ER, variasi, dsb.) dan bandingkan relatif — jauh lebih adil daripada angka mati.
- **Feedback loop**: tombol Benar/Salah/Ragu pada tiap flag → perbaiki ambang dari data Anda sendiri (paling berharga, gratis).

### 4.6 Tabel pembanding ER (kasar, untuk triase — bukan hukum)
Sebagai lintasan kasar IG (median engagement/followers): <0.5% = merah, 0.5–1.5% = kuning, >1.5% = hijau — **selalu disesuaikan per niche**; TikTok gunakan /views (<1% merah, 1–5% kuning, >5% hijau). Simpan sebagai konfigurasi per kampanye; jangan hardcode global.

---

## 5. Buktikan — arsip Evidence otomatis (fitur paling bernilai untuk Anda)

Saat worker membuka halaman post, minta `webContents.capturePage()` dan simpan PNG:

```
userData/evidence/2026-11/
  0042_2026-11-04T09-12-31Z_instagram.png
  0042_2026-11-04T09-12-31Z_meta.json   → { targetId, url, username, fetchedAt, metrics terbaca, status }
```

- **Membuktikan:** post tayang pada waktu X, caption saat itu, metrik saat itu → jawaban final untuk "post sudah dihapus", "metrik palsu", sengketa invoice, klaim klien brand.
- **Biaya:** Rp 0; simpan hanya yang statusnya **FAILED atau beda klaim** untuk menghemat disk (±100–500 KB/file), atau semua dengan rotasi 90 hari (default) / unlimited (opsi).
- **Tanpa mengubah** cara kerja worker — satu baris setelah `loadURL` + satu util simpan; ~1 jam kerja.
- **Nilai jual:** "Setiap posting diverifikasi + bukti terarsip otomatis" — bisa masuk proposal agensi Anda.

---

## 6. Jalur paling kuat & gratis: syarat dari sisi pemberi kerja

Anda membayar → Anda berhak mensyaratkan bukti. Ini sah secara bisnis dan **tanpa teknologi apa pun**:

1. **Screenshot Insights resmi wajib** (IG: profil → Professional Dashboard → insight post; TikTok: Creator Center → analytics): reach, likes, komentar, share, saves — metrik **yang tidak publik** dan tidak bisa dipalsukan dengan mudah (bisa dipalsukan — tapi dibandingkan dengan publik, selisih jadi mencurigakan).
2. **Selisih klaim vs publik > 20%** → flag otomatis; staf hanya membuka itu.
3. **Tetap tayang ≥ 14/30 hari** — klausul + re-check otomatis (Tahap 6.1 di bawah).
4. **Format lapor terstandar** (link + tanggal + angka Insights) — tool Anda mem-parse, atau influencer isi form sederhana (Google Form gratis) → import CSV.
5. **Konsekuensi jelas**: tidak lapor / post hilang / selisih besar → terminasi + tidak dibayar (klausul, bukan teknologi).

**Ini menutup celah metrik tak-publik (reach/saves) tanpa API dan tanpa biaya.** Teknologi hanya menjadi penegaknya: daftar merah "belum lapor / selisih besar / post hilang".

### 6.1 Re-check D+7 / D+30 (scheduler kecil di atas yang sudah ada)
Worker Anda sudah bisa mengantre ulang — tambahkan pemicu: saat target lolos, jadwalkan 2 verifikasi ringan (`kind: 'RECHECK'`) pada D+7 dan D+30; bila post hilang/berubah → flag + screenshot bukti. ±½ hari kerja, nilai sangat tinggi (menangkap "hapus setelah dibayar").

---

## 7. Alur operasional harian (target: 30–60 menit/hari)

```
Impor link kampanye baru
   ↓ (semalam / seketika)
Mesin verifikasi: ada? akun benar? brief cocok? metrik? screenshot?
   ↓
Dashboard triase:  🟢 lolos otomatis (80–90%)
                   🟡 spot-check acak 10–20%
                   🔴 manual wajib (sisanya)
   ↓
Keputusan 1 klik: Lolos / Tandai curiga / Minta bukti creator
   ↓
Export laporan kampanye (Excel/PDF) ke klien brand
```

Staff Anda tidak lagi "memeriksa ribuan", hanya **memutuskan yang meragukan** — dan semuanya punya bukti terarsip.

---

## 8. Yang dipertahankan & yang diperbaiki (dari kode Anda)

**Pertahankan:** Electron + SQLite lokal; tray; budget 500/siklus + rail harian 2.000 (volume Anda jauh di bawahnya — jangan ubah); ekstraksi berlapis; cache akun/post; lock/reclaim; skip API/vendor; tanpa framework frontend.

**Perbaiki (prasyarat, detail di AUDIT.md):** tombol modal mati (F-01); filter Target OK/PARTIAL (F-02); klik link keluar app (F-03); backup korup (F-06) → `sqlite.backup()`; tes merah (F-04); http→https (S-01); hapus sesi login (F-08); timeout task (F-05).

**Tambah (urut nilai/biaya):**
1. Evidence screenshot + metadata (§5) — 1 jam
2. Skor konformitas brief (caption/mention/tanggal) + daftar kekurangan — 1 hari
3. Re-check D+7/D+30 — ½ hari
4. Triase hijau/kuning/merah di UI — 1 hari
5. Sinyal ternak §4.2 no. 4–6 (profil URL, bio link, hashtag set) — 1 hari
6. Feedback Benar/Salah + baseline per jaringan — 1 hari
7. Export laporan kampanye + "bukti terlampir" — ½ hari
8. Migrasi `user_version` + kolom `extraction_layer`, `post_source` — ½ hari
9. Upgrade Electron bertahap 35→45 (keamanan) — 1–2 hari UAT
10. Hapus akun & semua datanya (untuk komplain/koreksi) — ½ hari

---

## 9. Matriks opsi (budget nol) & verdict

| Opsi | Biaya | Mengatasi | Verdict |
|---|---|---|---|
| Scraping publik (sudah ada) | 0 | Post ada? metrik? | ✅ Pertahankan & perbaiki |
| **Screenshot evidence otomatis** | 0 | Sengketa, "post dihapus/palsu" | ✅ **Wajib** |
| **Skor konformitas brief** | 0 | "Tidak sesuai brief" | ✅ **Wajib** |
| **Re-check D+7/D+30** | 0 | "Hapus setelah dibayar" | ✅ **Wajib** |
| **Triase 🟢🟡🔴** | 0 | Kerja manual meledak | ✅ **Wajib** |
| Sinyal ternak §4.2 (avatar URL, bio link, hashtag set, CV likes) | 0 | Akun ternak | ✅ Kerjakan |
| **Klausul bukti creator + form terstandar** | 0 | Metrik tak-publik (reach/saves) | ✅ **Paling kuat** |
| Feedback Benar/Salah + baseline per jaringan | 0 | False positive, adil per klien | ✅ Kerjakan |
| OCR screenshot (tesseract.js) | 0 | Verifikasi screenshot otomatis | △ Opsional; lebih baik input terstruktur |
| API resmi IG/TikTok | 0 uang, **tinggi** waktu (app review) | Data stabil | ✗ Bukan kebutuhan sekarang; tunda |
| Vendor data berlisensi | $$$ | Skala & kepatuhan | ✗ Budget tidak ada |
| Rotasi proxy / captcha / fingerprint | risiko + biaya | "Menembus" blok | ✗ Jangan — berhenti saat diblokir, perkecil frekuensi |

---

## 10. Risiko operasional & mitigasi (tanpa basa-basi)

- **Platform membatasi akses** → jalankan di jam kerja, jeda 10–20 dtk, incremental (hanya yang perlu dicek), batch; kalau tetap ditolak, fallback: screenshot + bukti creator (§6) — tetap jalan tanpa scrape.
- **False positive deteksi ternak** → label + review manusia + ambang per jaringan; jangan pernah putus otomatis tanpa mata manusia.
- **Sengketa klien brand vs influencer** → evidence pack (screenshot + JSON) per kampanye; arsip per periode; ini alat negosiasi Anda.
- **Kerahasiaan data klien** → semua lokal; backup lokal terenkripsi (BitLocker); jangan kirim DB ke mana pun.
- **Standar tidak konsisten antar jaringan** → definisikan "lolos" tertulis; baseline per jaringan; audit sampel acak 10% untuk kalibrasi.
- **Aplikasi mati saat dipakai demo ke klien** → backup otomatis mingguan + restore-test; installer signed (tanpa biaya? tidak ada — terima peringatan SmartScreen atau pakai sertifikat internal; catat di dokumentasi).

---

## 11. Roadmap 30 / 60 / 90 hari (disesuaikan agensi)

**30 hari — "Tidak ada lagi posting yang lolos tanpa bukti"**
1. Perbaikan P0 (AUDIT) + `sqlite.backup()`
2. Evidence screenshot + re-check D+30
3. Skor konformitas brief + daftar elemen hilang (mention/#hashtag/URL)
4. Triase 🟢🟡🔴 + filter & export laporan kampanye
5. Perbaiki 2 bug intel (band 20K–100K, token tanggal) → skor layak dipakai

**60 hari — "Deteksi ternak yang bisa dipertanggungjawabkan"**
6. Sinyal avatar-URL, bio link, hashtag set, CV likes, komentar generik
7. Feedback Benar/Salah + baseline ER per jaringan + ambang per kampanye
8. Daftar merah otomatis "belum lapor / selisih besar / post hilang" + reminder
9. Migrasi v6 (provenance + index) + fixture tests ekstraktor
10. Upgrade Electron 35→45 (bertahap, UAT penuh)

**90 hari — "Skala ke ribuan link tanpa tambah orang"**
11. Incremental audit (hanya due / belum lolos / berubah) — dari 28 jam → menit
12. Evidence pack PDF per kampanye untuk klien brand (print CSS, tanpa dependency baru)
13. Template klausul bukti creator + SOP onboarding influencer (dokumentasi Anda)
14. Laporan bulanan per jaringan: % lolos, % curiga, top pelanggaran — bahan evaluasi kontrak
15. (Opsional, hanya jika diminta klien besar) Mode "API resmi untuk akun yang setuju" — tunda sampai ada demand nyata

---

## 12. Kesimpulan

Versi terbaik untuk kondisi Anda (agensi, ribuan link/bulan, budget nol) **bukan** API dan **bukan** vendor, melainkan:

> **Scraping halaman publik (sudah ada, diperbaiki) + bukti screenshot otomatis + skor kesesuaian brief + re-check berkala + triase hijau/kuning/merah + syarat bukti dari creator + deteksi ternak berbasis klaster & pola — dengan keputusan akhir di tangan manusia.**

Itu memotong ±85–95% pekerjaan manual, menangkap kecurangan paling umum (tidak posting, hapus setelah dibayar, angka digelembungkan, akun ternak), dan menjadikan laporan Anda bisa dipertanggungjawabkan ke klien. Semua bahan sudah ada di aplikasi Anda — yang kurang hanya ~2–3 minggu kerja + disiplin proses.

**Jangan** menambah kompleksitas (API, vendor, ML, framework) sebelum tiga hal ini hidup: **bukti terarsip, re-check otomatis, dan triase**. Itu yang membedakan "tool scrape" dari "sistem verifikasi yang bisa dijual".
