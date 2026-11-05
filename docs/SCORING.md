# Skor Intel Akun

Mesin di `src/main/intel.js` (murni, diuji di `intel.test.js`). Input: data **publik** — profil, posting,
kontak bio, dan seri bulanan yang sudah tersimpan. Output: daftar akun dengan `score`, `level`, `flags`,
`peers`, `peer_reasons`, dan `clusters`.

> **Disclaimer wajib (ditampilkan di UI).** Skor adalah **indikasi otomatis untuk memprioritaskan tinjauan**,
> bukan identifikasi orang, bukan bukti pelanggaran, dan bukan vonis. Wajib verifikasi manual sebelum
> tindakan apa pun. Data dapat dihapus atas permintaan.

## Bobot sinyal

| Kode flag | Label | Poin | Syarat ringkas |
|---|---|---|---|
| `konten_kembar` | Unggahan sama di akun lain | **+4** | `post_ref` postingan yang sama muncul di akun lain |
| `kontak_bio_sama` | Kontak bio sama | **+3** | Nomor HP (≥10 digit setelah normalisasi 62/0) atau email di bio dipakai akun lain |
| `reach_rendah` | Jangkauan rendah | +2 | followers ≥ 5.000 & sampel ≥ 3; TikTok: median views/followers < 3%; IG: median likes/followers < 1% |
| `komentar_minim` | Komentar nyaris nol | +2 | ≥4 unggahan ber-likes, median likes ≥ 50, median komentar ≤ maks(1, 0,5% × median likes) |
| `unggah_bertumpuk` | Unggahan bertumpuk | +2 | ≥3 unggahan dalam 10 menit (pola antrean satu perangkat) |
| `caption_template` | Caption berpola | +2 | Template caption (buang hashtag, digit→`#`, ≥40 char) dipakai ≥2 akun, fan-out ≤10 |
| `unggah_serentak` | Unggahan serentak | +1 | ≥2 unggahan pada bucket 5 menit yang sama dengan akun lain |
| `followers_datar` | Followers tidak bergerak | +2 | Selisih min–maks ≤3% antar bulan, followers di band 5K–20K **atau** 20K–100K, post tetap tumbuh ≥5 |
| `akun_salur` | Following > follower | +1 | followers < 20.000 dan following ≥ followers |
| *(penalti)* | Terverifikasi | **−1** | `is_verified` mengurangi skor (tidak pernah di bawah 0) |

## Level risiko

| Level | Ambang skor | Arti |
|---|---|---|
| `pola_kembar` | ≥ 10 | Bukti kuat (konten/kontak + sinyal lain) — prioritas tinjauan tertinggi |
| `pola_ternak` | ≥ 6 | Beberapa sinyal mengarah ke pola ternak |
| `amati` | ≥ 2 | Perlu dipantau |
| `bersih` | 0–1 | Tidak ada sinyal menonjol |

**Aturan penguat:** bila ada bukti **`konten`** atau **`kontak`** (tautan kuat), level minimal dinaikkan ke
`pola_ternak` meski skor mentah hanya `amati`/`bersih`.

## Tautan antar-akun (`findAccountLinks`)

Empat bukti: `konten` (post_ref sama), `serentak` (bucket waktu), `kontak` (email/HP bio), `template` (caption).
Tautan digabung dengan **union-find** menjadi **klaster** (`buildClusters`); klaster dianggap `strong` bila
punya bukti `konten` atau `kontak`. Urutan klaster: `strong` dulu, lalu ukuran.

### Pengaman anti-ledakan (fan-out)

| Batas | Nilai | Tujuan |
|---|---|---|
| `MAX_FANOUT` | 50 | Token/ref/waktu yang dipakai >50 akun = sinyal umum (hotline publik/konten viral), bukan bukti pasangan → mencegah O(n²) |
| `MAX_TEMPLATE_FANOUT` | 10 | Template yang dipakai >10 akun = generic viral, bukan bukti |
| `SIBLING_SYNC_MIN_HITS` | 2 | Bucket waktu butuh ≥2 kecocokan sebelum dihitung |

> Catatan: `MAX_TEMPLATE_FANOUT` diubah dari 50 → 10 untuk menekan false-positive massal (audit 2026-11-05, M-13).
> Dua akun viral tak berhubungan yang berbagi caption generik sebaiknya tidak saling menautkan.

## Normalisasi & pembersihan

- Username kanonik: buang `@`, potong keterangan `(TikTok)` dsb, lowercase (`util.cleanUsername`).
- Nomor HP: hapus non-digit, buang prefix `0062`/`62`/`0`; simpan bila ≥10 digit (mencegah tanggal `20261001` dikira telepon).
- Angka dari scraper: `parseCount` menangani suffix `K/M/B`, `ribu/juta/miliar`, pemisah ribuan vs desimal.

## Kualitas data (tampil di dashboard)

`quality` menghitung: akun tanpa followers, akun PARTIAL, TikTok tanpa views, akun tanpa handle, akun belum
pernah diproses. Ini **tidak** memengaruhi skor; membantu operator menilai kelengkapan data.
