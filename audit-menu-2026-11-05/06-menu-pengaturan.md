# Laporan Audit UI/UX — Menu **Pengaturan**

**Tanggal:** 2026-11-05 · **Halaman:** `#tab-settings` (`index.html:212-251`) · **Skor: B−**
**Basis:** HEAD `6e0b480` + working tree. Logic: `app.js:518-569, 780-843` · gaya: `styles.css:164, 220-234, 300-316` · menu native: `main.js:130-199`.

---

## Ringkasan

Halaman paling matang di aplikasi: restore sungguhan (pratinjau + safety backup), tema eksplisit, diagnostik satu klik, dan gerbang `HAPUS` untuk clear-all. Sisa masalahnya: (a) **hierarki visual tombol berbahaya vs setara**, (b) tabel audit dengan tombol mini tanpa petunjuk "apa yang sebenarnya terjadi", (c) tidak ada bagian **Tentang** di dalam halaman ini padahal menu Bantuan sudah punya isinya, (d) satu ketidakkonsistenan destruktif (hapus sesi tanpa gesekan, hapus semua dengan gesekan).

## Yang sudah baik — jangan diutak-atik

- Restore: `restorePreview` menampilkan file + hitungan sebelum commit; data aktif dicadangkan otomatis dulu (`app.js:785-807`; label "Tindakan ini tidak bisa dibatalkan" jujur).
- Clear-all: ketik `HAPUS` + checkbox "Cadangkan database dulu (disarankan)" **default-on** (`app.js:826-843`).
- Hapus audit menyebut jumlah target yang ikut musnah (`app.js:551-557`).
- Panel Tampilan: 3 radio tema — **ini yang hilang di audit sebelumnya, sekarang ada dan benar** (`index.html:229-235`); sinkron dengan menu `Tampilan → Tema` (`main.js:158-165`).
- Panel Privasi menjelaskan "sepenuhnya lokal" + 2 aksi berguna (Salin diagnostik, Buka folder data) (`index.html:237-243`, `main.js:108-127`).
- Panel Database memberi transparansi (file/ukuran/hitungan audit-target-snapshot) (`app.js:520-528`).
- Tabel audit: aksi `Audit ulang` / `Edit` / `Hapus` dengan konfirmasi destruktif (`app.js:540-569`).

## Kritik & temuan

### [P1] S-01 — Dua tombol `.btn-danger` bersebelahan tanpa hierarki di Zona berbahaya
- **Bukti:** `Hapus sesi login (IG & TikTok)` + `Hapus semua data` keduanya `btn-danger` solid merah (`index.html:247-248`).
- **Kritik:** (a) warna merah solid dipakai untuk dua aksi dengan **bobot kerugian yang berbeda 1000×** (hapus sesi = login ulang; hapus data = semua hilang); (b) mata operator memindai dua balok merah yang sama tanpa gradasi — tidak ada urutan baca, tidak ada pemisah sub-bagian.
- **Arah:** (a) `Hapus sesi` → `.btn-ghost` dengan teks merah (`.btn-danger-ghost`), `Hapus semua data` tetap solid; (b) judul zona dengan ikon peringatan + satu kalimat: "Aksi di area ini tidak bisa dibatalkan."; (c) jarak antar-grup lebih besar.

### [P1] S-02 — "Hapus sesi login" tanpa gesekan, bertentangan dengan filosofi halaman ini sendiri
- **Bukti:** modal hanya teks + `[Hapus sesi]` (`app.js:808-820`) — tanpa ketik-konfirmasi padahal *efeknya* menghentikan worker (menulis terhenti terpaksa).
- **Kritik:** satu-satunya aksi "disruptif operasional" di halaman ini tidak tunduk pada pola gesekan yang dengan bangga diterapkan pada aksi lain. Konsistensi bukan produk lux, tapi bahasa.
- **Arah:** samakan ringan: checkbox "Saya paham worker akan berhenti sampai login ulang" (bukan wajib ketik — proporsional), atau minimal tombol berlabel penuh "Hapus sesi & hentikan worker".

### [P1] S-03 — Tabel audit: aksi "Audit ulang" tanpa menjelaskan konsekuensi
- **Bukti:** `api.rerunAudit(id, true).then(r => toast(r.message || 'Dijadwalkan ulang.'))` (`app.js:549`) — parameter `true` (full?) tidak terlihat, pesan hasil generik.
- **Kritik:** operator mengklik tombol, mendapat toast generik — tidak tahu apakah target akan di-scrape ulang sekarang, atau antrean baru dibuat, atau jadwal berikutnya dimajukan. Ketidakpastian pasca-klik = kecemasan.
- **Arah:** modal ringkas sebelum commit: "Audit **X** — N target akan dijadwalkan ulang penuh. Lanjutkan?" + tombol primer "Jadwalkan ulang". (Opsional: tampilkan jumlah pending dari `a.pending_count`.)

### [P1] S-04 — Tidak ada bagian **Tentang** di dalam halaman
- **Bukti:** About hanya lewat `Alt → Bantuan → Tentang sunscrap…` (`main.js:192`) — yaitu fungsinya ada tapi bersembunyi di menu yang justru auto-hidden default (`autoHideMenuBar: true`, `main.js:212`). Halaman Pengaturan sendiri tidak menyebut versi sama sekali (versi hanya di statusbar bawah-kanan, `index.html:260`).
- **Kritik:** pengguna awam tidak pernah menekan Alt; mereka membuka Pengaturan saat mencari "tentang" — tidak menemukannya. Diagnostik ada, About tidak.
- **Arah:** panel **Tentang** di atas Panel Privasi: `sunscrap v1.0.0 · Windows · DB N KB · [Salin info diagnostik] [Buka folder data] [Tentang (jendela asli)]` — atau tautkan isi About native ke sini. Jangan duplikasi semua; duplikasi 3 fakta + 2 tombol cukup.

### [P1] S-05 — Gagal baca DB-info senyap
- **Bukti:** `try { ...dbInfo... } catch {}` (`app.js:520-528`); `renderAudits()` tidak menangani kegagalan `api.getAudits()` — state.audits bisa basi/undefined (`app.js:657`) tapi hanya merender "Belum ada audit" bila array kosong — gagal IPC → tabel kosong tanpa keterangan.
- **Arah:** placeholder gagal-muat dengan tombol coba lagi di panel Database & tabel audit; log ke toast error.

### [P2] S-06 — Panel Database: informatif tapi tanpa jalur aksi
- **Bukti:** menampilkan File/Ukuran/Audit/Target/Snapshot (`app.js:522-527`) — tidak ada tombol "Buka folder DB" / "Salin path file" di dekatnya (Buka folder data ada di Panel Privasi, terpisah).
- **Arah:** satu baris: `Lokasi: %APPDATA%\…\sunscrap.db` + tombol ikon salin + tombol buka folder (reuse handler). Jangan menyuruh operator menyimpulkan dari teks.

### [P2] S-07 — Audit: tidak ada kolom "terakhir jalan" / status berwarna
- **Bukti:** kolom `Status` menampilkan `a.latest_run_status` mentah (`app.js:538`) — mis. `OK`, `FAILED`, `PARTIAL`, `—` dari DB, bukan `.status badge` (`statusBadge()`) yang dipakai di mana-mana.
- **Kritik:** inkonsistensi status di halaman ini vs Target/Proses — paragraf status yang sama tampil dua gaya.
- **Arah:** pakai `statusBadge()` (atau varian pasif) di kolom Status; tambah kolom `Terakhir: relTime(...)` bila data tersedia.

### [P2] S-08 — Panel audit terpotong di lebar < ~1100px: sel `row-gap` sebagai sel aksi
- **Bukti:** `<td class="row-gap" style="justify-content:flex-end">` (`app.js:539`) — memakai utility flex baris pada `<td>`; pada window sempit tiga tombol wrap bertumpuk aneh.
- **Arah:** `<td>` berisi wrapper `<div class="row-gap end">`; beri breakpoint: ≤1100px tombol jadi ikon+teks singkat (`Ulang`, `Edit`, `Hapus`).

### [P2] S-09 — Modal Edit Audit: hanya Nama + Ulang; `Periode` tidak ada padahal ditampilkan
- **Bukti:** tabel menampilkan kolom `Periode` (`app.js:536`) tapi modal edit hanya mengedit `name` & `repeat_days` (`app.js:559-566`); kolom periode tampil "—" bila kosong, dan tidak ada field di mana pun untuk mengisinya.
- **Kritik:** kolom yang tidak bisa diisi adalah janji palsu di UI.
- **Arah:** (a) tambah field `Periode` bila DB mendukung (`data:updateAudit patch` — cek `ipc.js data:updateAudit`), atau (b) sembunyikan kolom Periode dari tabel bila memang read-only dari import (lalu beri title `Diambil otomatis dari file import`).

### [P2] S-10 — Tema radio tanpa deskripsi & tanpa "System (terbawa)" state
- **Bukti:** 3 radio polos (`index.html:230-234`).
- **Kritik:** tidak memberi tahu bahwa "Ikuti sistem" benar-benar dihormati app saat runtime (memang dihormati via `matchMedia` listener, `app.js:169-172`).
- **Arah:** tambah sub-teks kecil di bawah grup: "Berubah seketika — tersimpan di mesin ini."; centang default `system` saat pertama kali (sudah benar).

### [P3] S-11 — Agregasi tiga tombol diagnostik tersebar
- `Salin info diagnostik` (Privasi), `Buka folder data` (Privasi), `Cadangkan` (Database) — semua masuk akal tempatnya; tapi `Tentang` (S-04) akan melengkapi kuartet: jadikan section "Dukungan" ramping di bawah Panel Privasi? — **keputusan:** cukup panel Tentang (S-04); jangan menambah section baru.

## Prioritas perbaikan

1. **S-01, S-02** hierarki Zona berbahaya + gesekan proporsional.
2. **S-03** konfirmasi Audit ulang.
3. **S-04, S-05** panel Tentang + error bicara.
4. **S-06 … S-10** konsistensi status, kolom periode, salin path.

## Verdict satu kalimat

Pengaturan adalah satu-satunya halaman yang sudah bicara dengan suara dewasa — selebihnya hanya kurang **menepati janji yang sama** di setiap aksinya (konfirmasi, transparansi, hirarki bahaya).
