# Blueprint UI/UX Ideal — sunscrap

> Arah desain kelas-dunia untuk alat audit keterlibatan influencer (IG/TikTok): metrik
> time-series, delta antar-snapshot, skor risiko akun ternak/kembar, dan triage manual.
> Disusun dari riset pola produk nyata (HypeAuditor/SocialBlade — domain persis; Linear/Vercel —
> kualitas visual; Grafana/Datadog — monitoring; prinsip chart selection 2025).

---

## 1. Apa sebenarnya data ini

Bukan "analytics biasa". Kombinasi tiga jenis data yang berbeda kebutuhan visualnya:

| Jenis data | Contoh | Sifat |
|---|---|---|
| **Deret waktu (time-series)** | views/likes per hari, follower per bulan | tren, delta |
| **Tabel entitas (records)** | target post, akun profil | baris, filter, drill-down |
| **Keputusan (decisions)** | skor risiko, keputusan manual | triage, aksi |

Maka desainnya = **monitoring + triage + reporting**, bukan galeri chart.

## 2. Pertanyaan yang dijawab (Jobs-to-be-done)

1. **"Apa yang harus saya kerjakan SEKARANG?"** → butuh tinjauan + gagal + perubahan mencurigakan.
2. **"Bagaimana kondisi kampanye?"** → ringkasan health.
3. **"Siapa yang mencurigakan?"** → daftar akun berisiko + bukti.
4. **"Mana yang perform?"** → ranking/leaderboard.
5. **"Apa yang berubah sejak kemarin?"** → delta.

Prioritasnya: **#1 (aksi) di atas #2 (metrik)** — inilah bedanya produk "alat kerja" vs "dashboard pameran".

## 3. Prinsip desain (berbasis riset)

1. **Action-first, metric-second.** Aplikasi membuka ke *inbox* aksi, bukan ke angka.
2. **Monokrom + satu aksen.** Neutral berhue halus; satu warna aksen fungsional (indigo); warna dipakai semantik, bukan dekoratif.
3. **Satu jawaban per layar.** Tiap layar menjawab tepat satu pertanyaan dominan.
4. **Hirarki atas-bawah.** Jawaban → tren → rincian; ukuran & posisi menurun.
5. **Data padat, bukan data hias.** Tabel adalah visualisasi utama; chart hanya bila benar-benar lebih cepat dipahami daripada angka.
6. **Kontras AA + keyboard lengkap.** Alat ini dipakai lama; aksesibilitas = kenyamanan.
7. **Semua angka bisa ditelusuri.** Klik → detail → bukti.

## 4. Information Architecture ideal

```
┌ Sidebar (icon + label, collapsible) ──────────────┐
│  KERJA                                          │
│  ▪ Inbox          (badge jumlah perlu tinjauan)  │  ← titik masuk
│  ▪ Ringkasan      (dashboard health)             │
│  ▪ Target         (tabel post)                   │
│  ▪ Akun           (tabel profil + kuadran)       │
│  ANALISIS                                        │
│  ▪ Kampanye       (audit/periode)                │
│  SISTEM                                          │
│  ▪ Sesi           (login)                        │
│  ▪ Pengaturan                                    │
└───────────────────────────────────────────────────┘
```

Perbedaan vs sekarang: **Inbox jadi layar pertama** (bukan Dashboard), dan "Proses" (worker) dilipat ke status global, bukan tab penuh.

## 5. Pemetaan data → visual (yang benar)

| Ingin menunjukkan | Visual | Catatan |
|---|---|---|
| Tren engagement 30 hari | **area chart** (1) atau **small-multiples** (per platform) | satu metrik per kartu; sumbu-Y berlabel jelas |
| Delta per akun/post | **tabel + sparkline inline + badge Δ** | paling presisi; chart tidak menggantikan tabel |
| Komposisi status (OK/sebagian/gagal/menunggu) | **stacked bar horizontal** | **bukan donut** — donut gagal >3 segmen bernilai dekat |
| Distribusi level risiko | **bar horizontal** terurut | teks label di samping batang |
| IG vs TikTok | **grouped bar horizontal** per metrik | atau tabel komparasi |
| Kualitas audiens (followers × ER/authenticity) | **kuadran 2×2** (scatter) | kartu paling bernilai untuk domain ini |
| Funnel impor→verifikasi | **funnel** (batang mengecil) | satu sumber angka |

## 6. Layar inti (wireframe tekstual)

### 6.1 Inbox — jawaban #1 "apa yang harus saya kerjakan"
- Header: `Perlu tinjauan (N) · Gagal (M) · Perubahan mencurigakan (K)` sebagai **tab sekunder**.
- List item: avatar · @username · alasan singkat · skor · **aksi cepat** (`J` bersih · `K` konfirmasi · `L` bookmark).
- Keyboard-first (ala Linear): panah ↑↓ pilih, `X`/`Enter` buka detail, shortcut triage.
- Kosong = "Semua beres" (state sukses, bukan halaman mati).

### 6.2 Ringkasan — jawaban #2 "kondisi kampanye"
- Satu baris KPI besar: `Total reach · ER median · target terverifikasi · perlu tinjauan`.
- Satu area chart tren (bisa ganti metrik).
- Pemilih kampanye/periode yang jelas di atas.
- **Tanpa** tumpukan 10 kartu — sisanya dipindah ke layar spesifik (Akun/Target/Kampanye).

### 6.3 Target — jawaban #5 "apa yang berubah"
- Tabel **dua-baris per entri**: baris utama (akun + tema + status), baris kedua (metrik + Δ + sparkline).
- Filter bar: status · platform · tema · pencarian · sort.
- Kolom wajib: `Δ views`, `Δ likes`, `ER` (tiga angka yang paling menentukan keputusan).

### 6.4 Akun — jawaban #3 "siapa mencurigakan"
- Tabel profiler + **kuadran followers × kualitas** di samping (scatter, klaster berwarna).
- Badge level (pola_kembar/pola_ternak/amati/bersih) jelas & konsisten.
- Detail modal = **bukti** (flags, akun tertaut, seri bulanan) + **keputusan** (triage).

### 6.5 Kampanye — jawaban manajemen
- Daftar audit/periode; bandingkan dua periode (views/likes/ER + akun baru/hilang).

## 7. Design language (token)

- **Warna**: neutral berhue dingin (`#f6f7f8`…`#131416`), aksen indigo `#4f46e5`, status emerald/amber/red, platform IG pink · TT teal. (Sudah diterapkan di styles.css.)
- **Tipografi**: skala 11→44px; angka `tabular-nums`; hirarki jelas (label kecil uppercase ↔ angka besar bold).
- **Spacing**: grid 8px (`4/8/12/16/24/32/48/64`); whitespace luas antar kartu.
- **Radius/bayangan**: radius 8→18px konsisten; bayangan sangat halus.
- **Motion**: transisi cepat & lembut; press-effect pada tombol; `prefers-reduced-motion` dihormati.

## 8. Komponen & data-state (wajib)

Setiap komponen punya 4 state: **empty · loading · error · data**.

| Komponen | Data-state |
|---|---|
| KPI card | delta + sparkline |
| Area chart | tooltip + "hari ini" + axis berlabel |
| Tabel target | density toggle + kolom pilihan + sort |
| Stacked bar status | klik segmen → filter tabel |
| Scatter kuadran | hover bubble + drill ke akun |
| Triage list | keyboard shortcut + empty="beres" |

## 9. Pola interaksi

- **Drill-down**: ringkasan → tabel → modal detail (bukti) → keputusan.
- **Filter = navigasi**: chip status/level ↔ segmen chart saling sinkron.
- **Deep-link**: setiap angka bisa jadi pintu ke daftar ter-filter (sudah sebagian ada).
- **Triage**: keyboard-first, satu tindakan satu tombol, konfirmasi hanya untuk yang destruktif.

## 10. Aksesibilitas & kepadatan

- Kontras semua teks ≥ 4.5:1; status tak hanya warna (label teks selalu ada).
- Keyboard penuh (termasuk grafik & triage).
- Density mode (padat/normal/lapang) — untuk layar lebar vs laptop.
- Responsif: di < 1240px grid 2 kolom → 1 kolom.

## 11. Peta implementasi (dari kondisi sekarang)

| Prioritas | Aksi | Nilai |
|---|---|---|
| P0 | **Inbox/triage layar pertama** (konsolidasi "perlu tinjauan" + "gagal" + keyboard) | inti nilai alat |
| P0 | **Ganti donut → stacked bar**; tambah **kuadran followers×ER** di Akun | data-viz benar |
| P1 | Ringkasan dirampingkan (hapus kartu sekunder, deep-link ke Target/Akun) | hirarki |
| P1 | Tabel target **dua-baris + sparkline + Δ** | keterbacaan |
| P2 | Komparasi periode di Kampanye | manajemen |
| P2 | Density toggle + kolom pilihan tabel | kenyamanan |

---

**Kesimpulan blueprint**: produk ini paling pas dirancang sebagai **"monitoring + triage + report"** yang *action-first* — membuka ke inbox aksi (bukan metrik), memakai **tabel sebagai visualisasi utama** dengan chart hanya untuk tren & distribusi, dan satu sistem warna **monokrom + satu aksen + status semantik**. Fondasi token-nya sudah saya tanam; langkah berikutnya adalah menyusun ulang IA ke pola di atas, dimulai dari **Inbox**.

---

# Revisi v2 (setelah riset lebih dalam)

## Evaluasi critical terhadap v1

| # | Klaim v1 | Verdict |
|---|---|---|
| 1 | Action-first | ✅ Benar arahnya, tapi bentuknya salah untuk pengguna periodik |
| 2 | "Inbox jadi layar pertama" | ⚠️ Salah bentuk — dicek berkala, inbox sering kosong → janggal |
| 3 | Table = visualisasi utama | ✅ Benar |
| 4 | Donut selalu salah | ⚠️ Terlalu keras — donut OK untuk 2–3 segmen terpisah jelas |
| 5 | Quadrant followers×ER = pembeda | ⚠️ Bukan pembeda; pembeda = klaster/kembar (similarity) |
| 6 | Triage keyboard-first | ✅ Benar (Linear menegaskan) |
| 7 | Proses→status global | ❌ Job panjang wajib punya surface Runtime penuh |
| 8 | Export = by-product | ❌ Report adalah deliverable utama |
| 9 | (hilang) authenticity + evidence/transparency | ❌ Ini inti nilai alat |

## Koreksi v2

- **A. Entry = "Command Center"** (bukan inbox kosong): status strip + panel "perlu tindakan" + health.
- **B. Skor Kualitas/Autentisitas** jadi kelas satu: angka agregat (1–100 à la HypeAuditor) + panel bukti + "indikasi, bukan vonis". **Cluster view** (akun tertaut + bukti) jadi pembeda utama.
- **C. "Runtime" surface penuh** (progress, budget, queue, retry/cancel, log error) — bukan indikator global.
- **D. "Report" sebagai deliverable** terstruktur (ringkasan → autentisitas → engagement → rekomendasi).
- **E. Keyboard navigasi ala Linear** (`G+1…6`, `G+T`, `Ctrl+K` palette) + density mode.
- **F. Donut presisi**: 3 segmen bermakna **atau** stacked bar; "success rate" gauge valid.