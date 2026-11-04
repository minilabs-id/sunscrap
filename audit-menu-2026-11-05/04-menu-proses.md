# Laporan Audit UI/UX — Menu **Proses**

**Tanggal:** 2026-11-05 · **Halaman:** `#tab-proses` (`index.html:189-209`) · **Skor: C+**
**Basis:** HEAD `6e0b480` + working tree. Logic: `app.js:212-252, 494-515, 774-779, 861-865` · gaya: `styles.css:182-187, 292-294`.

---

## Ringkasan

Satu-satunya halaman "misi berjalan" — tapi ia masih menampilkan **penghitung seumur hidup**, bukan denyut pekerjaan *sekarang*: berapa sedang berjalan untuk audit mana, apa yang sedang dikunjungi detik ini, kapan perkiraan selesai dengan dasar apa. ETA ada (bagus!) tapi tanpa ikon, tanpa basis, dan kosong sama sekali saat `pending == 0`.

## Yang sudah baik — jangan diutak-atik

- ETA progresif (`≈ N menit untuk M tersisa`) dihitung dari antrean (`app.js:497-504`) — langka, pertahankan.
- Auto-refresh 5 detik saat tab aktif (`app.js:861-865`); `getQueueStats` ringan by-design (v3).
- Worker-detail 4 KPI: kunjungan siklus / hari ini / pace / sesi+break (`app.js:229-236`).
- Banner auth kedaluwarsa lintas-halaman dengan aksi langsung (`#auth-banner`, `index.html:38-44`) — pola global yang tepat; tinggal ditambahkan sumber selain `lastError` (lihat P-05).
- Tombol login IG/TT tersedia langsung di halaman (`index.html:200-201`).
- Tabel Aktivitas terbaru 20 baris dengan waktu & status (`app.js:506-514`).

## Kritik & temuan

### [P1] P-01 — KPI "OK"/"Gagal" berlabel `total` — kata Inggris telantar, dan tidak bermakna "sekarang"
- **Bukti:** `kpi(fmt(s.ok), 'OK', 'total')` + `kpi(fmt(s.failed), 'Gagal', 'total')` (`app.js:501`).
- **Kritik:** (a) string `'total'` adalah label mentah berbahasa Inggris; (b) angka kumulatif sejak awal waktu, bukan 24 jam terakhir / siklus berjalan — operator tidak bisa membaca "seberapa sehat antrean HARI INI".
- **Arah:** sub-label → `'akumulasi'` atau mejor: dua pasang angka `OK hari ini / gagal hari ini` bila tersedia; kalau tidak, ubah caption jadi `sejak awal` dan gunakan kata Indonesia konsisten.

### [P1] P-02 — Tidak ada indikator "sedang mengerjakan apa, detik ini"
- **Bukti:** worker-widget sidebar hanya dot + label (`index.html:27-34`); tidak ada nama task/target aktif di halaman Proses maupun statusbar.
- **Kritik:** operator tidak bisa membedakan worker yang sehat-lama (pace lambat) dengan worker yang *tersangkut* (rate-limited 40 menit di halaman yang sama) — keduanya tampil "Aktif".
- **Arah:** baris live di atas Aktivitas: `● Mengunjungi @contoh_akun… (task #412, antrean 37) — [Hentikan]`; sumber: event worker yang sudah dibroadcast (`broadcast('worker', status)` di `worker.js` onChange — perlu field `currentTarget` bila belum ada).

### [P1] P-03 — ETA tampil tanpa basis & hilang di state kosong
- **Bukti:** `etaMin = Math.round(eta * 6 / 60)` — asumsi 6 detik/task keras (`app.js:498-499`); saat `eta == 0` ETA diganti "Antrean kosong" dan `queue-eta` div tetap ada (baik), tapi tetap tanpa penjelasan bahwa `6 dtk/target` adalah estimasi.
- **Kritik:** angka "≈ 12 menit" terdengar otoritatif; kalau worker dijeda/rate-limit, ETA tidak menyesuaikan — tidak jujur.
- **Arah:** teks `≈ N menit (estimasi ~6 dtk/target)`; saat worker tidak aktif tapi antrean ada, tampilkan peringatan amber: "Antrean berisi M tapi worker tidak berjalan — [Mulai worker]" (ini skenario paling umum dan paling sering terlewat!).

### [P1] P-04 — Gagal baca Proses senyap total
- **Bukti:** `loadProcess()` try/catch kosong (`app.js:495-515`); `worker-detail` kosong jika `state.worker` null (`app.js:213, 229-236`); pemanggil tanpa catch (`app.js:206, 864`).
- **Arah:** sama dengan temuan lintas-menu: toast error + placeholder "Gagal memuat antrean — Coba lagi"; tombol refresh manual kecil di panel Antrean.

### [P2] P-05 — Login IG/TT di Proses & banner redundan; banner hanya berbasis `lastError`
- **Bukti:** tombol login ada di Proses (`index.html:200-201`) **dan** di banner (`index.html:42-43`); banner tampil bila `lastError` cocok regex login (`app.js:241-244`) — jika sesi mati tapi worker belum gagal, banner tidak pernah muncul, dan tidak ada indikator sesi di tempat lain.
- **Kritik:** hierarki aksi ambigu (dua tempat, aksi sama), dan deteksi "sesi mati" reaktif, bukan proaktif.
- **Arah:** (a) satu sumber kebenaran: status sesi dari main (mis. `session: status` query ke partition) → badge `Sesi IG ✓ / TT ✗` di statusbar; (b) banner tetap sebagai jalur darurat; (c) tombol "Login" di Proses dipertahankan — jadikan primer bila sesi tidak valid, ghost bila valid.

### [P2] P-06 — Panel Worker: angka tanpa satuan/konteks
- **Bukti:** `Kunjungan siklus 12 / 30`, `Hari ini 145 / 400`, `Sesi 7 / 10` (`app.js:231-236`).
- **Kritik:** operator baru tidak tahu apa itu "siklus", "rail", "break at". Tidak ada tooltip, tidak ada tautan ke penjelasan pacing.
- **Arah:** tooltip per KPI (`title` atau `?` kecil): "Siklus = satu putaran warm-up; Rail = budget harian; Sesi = jeda setelah N task".

### [P2] P-07 — Aktivitas terbaru: tabel polos, tanpa aksi, tanpa auto-highlight
- **Bukti:** `#latest-table` tanpa `.table-wrap`, tanpa klik baris ke detail target history, tanpa penanda status `running` terpisah (sama abu dengan pending, lihat styles `.status.pending,.status.running` `styles.css:215-216`).
- **Arah:** (a) bungkus `.table-wrap` + `max-height`; (b) baris **baru** flash subtle (class + animation) saat event `data` masuk; (c) klik baris → buka modal riwayat target (reuse `openTarget`); (d) `running` = biru + pulse.

### [P2] P-08 — Tidak ada tombol "Muat ulang" manual
- **Bukti:** refresh hanya via interval 5 dtk dan event `data`.
- **Kritik:** saat operator baru saja mengklik login/retry dan kembali ke tab Proses, data bisa 5 detik basi — kesan lambat padahal hanya jeda polling.
- **Arah:** ikon refresh kecil di header panel Antrean & Aktivitas (`aria-label="Muat ulang"`), memanggil `loadProcess()`.

### [P3] P-09 — Judul halaman "Proses" generik
- **Arah:** "Proses & Antrean" atau "Eksekusi" — lebih jelas sebagai status center; samakan dengan terminologi menu (bisa dipertahankan bila keputusan produk).

## Prioritas perbaikan

1. **P-03** (skenario paling sering: antrean ada, worker mati) — peringatan + CTA.
2. **P-02** live "sedang mengerjakan apa".
3. **P-01, P-04** label manusia + error bicara.
4. **P-05, P-06, P-07, P-08** konsistensi & akses keyboard.

## Verdict satu kalimat

Proses adalah cockpit — tapi cockpitnya belum menunjukkan jarum yang sedang bergerak, hanya penghitung parkir; berikan ia satu baris "live" dan satu peringatan saat mesin mati dengan tangki terisi, dan ia langsung layak disebut pusat kendali.
