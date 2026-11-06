# Design System v2 — "Matahari di atas Mica"

> Arah desain sunscrap v2: **Windows 11 / Fluent-modern** — mica berlapis, sentuhan acrylic,
> netral hangat, satu aksen (matahari). Bersih, kokoh, profesional; padat data tapi tenang.
> Bukan glass penuh — transparansi dipakai hemat, di tempat yang memang "chrome" (titlebar,
> sidebar, statusbar, palette).

## 1. Prinsip

1. **Action-first.** Layar utama (Ringkasan) dibuka dengan *pekerjaan yang menunggu*,
   bukan pameran angka. Metrik menyusul di bawahnya.
2. **Satu jawaban per layar.** Ringkasan → "apa yang perlu dikerjakan?"; Target → "apa yang
   berubah?"; Akun → "siapa yang mencurigakan?"; Proses → "apakah worker sehat?".
3. **Tabel adalah visualisasi utama.** Chart hanya bila lebih cepat dipahami daripada angka
   (tren 30 hari, komposisi status, distribusi risiko).
4. **Redundansi dilarang.** Satu fakta = satu tempat utama + (opsional) satu jalan pintas.
   Tidak ada dua kontrol yang mengatur hal yang sama di layar yang sama.
5. **Kokoh & jujur.** Border 1px, sudut 6/8/10/14px, bayangan sangat halus, angka tabular;
   warna hanya semantik atau aksen tunggal. Tidak ada gradasi hiasan.
6. **Kontras AA & keyboard penuh.** Semua teks ≥ 4.5:1; status selalu disertai label teks;
   semua aksi dapat dicapai tanpa mouse; `prefers-reduced-motion` dihormati.

## 2. Token warna

| Token | Terang | Gelap | Pakai |
|---|---|---|---|
| `--mica` | `#f3f1ee` (+glow matahari `.13` / indigo `.07`) | `#1f1e1c` (+glow `.08`/`.06`) | alas jendela |
| `--surface` | `#ffffff` | `#28272a` | kartu |
| `--surface-2` / `-3` | `#faf9f7` / `#f0efed` | `#302f33` / `#3a393e` | sunken halus / hover |
| `--line` / `--line-strong` | `rgba(28,26,24,.10/.18)` | `rgba(255,255,255,.09/.18)` | garis 1px |
| `--ink` / `-2` / `-3` | `#1c1b1a` / `#4d4946` / `#6f6a66` | `#f4f2f0` / `#cdc9c5` / `#a09b96` | hierarki teks |
| `--accent` (teks/ikon) | `#d97706` | `#fbbf24` | aksen (AA) |
| `--accent-strong` (isi tombol) | `#f59e0b` (teks `#241300`) | `#f5a623` | tombol primer |
| `--ok` / `--warn` / `--err` | `#177245` / `#b45309` / `#c92a2a` | `#4ade80` / `#fbbf24` / `#ff9a9a` | semantik saja |
| `--ig` / `--tk` | `#c2185b` / `#0e7490` | `#f0669d` / `#38bdf8` | badge platform |

**Chrome (acrylic):** titlebar, sidebar, statusbar, command palette memakai
`color-mix(surface 58–92%, transparent)` + `backdrop-filter: blur(24px) saturate(1.3)`.
Tanpa dukungan backdrop-filter, permukaan tetap terbaca (≥ 82% opak di palette).

## 3. Tipografi

- Keluarga: `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` —
  native ke Windows 11, turun ke sistem lain dengan anggun.
- Skala: 10.5 (label caps) · 11 (micro) · 12 (meta) · 13 (tabel) · 14 (body) · 15 (title kartu) ·
  **26 (judul halaman)** · 24 (KPI) · 20 (stat) · 40 (pace).
- `tabular-nums` global; label section: 10.5px, huruf besar, letter-spacing .1–.12em.

## 4. Grid & spacing

Grid 4px (`4/8/12/16/24/32/48/64`). Konten: padding 24px; gap kartu 16px;
sidebar 248px (kompak 76px < 1120px, ikon saja). Breakpoint grid: 1240px (2→1 kolom area
hero/3-kolom), 1100px. Kepadatan tabel: `data-density=padat|normal|lapang`
(+ `auto` mengikuti lebar jendela), tersimpan di `localStorage('sa_density')`.

## 5. IA & redundansi (yang dihapus)

| Dihapus / digabung | Alasan |
|---|---|
| Donut komposisi + funnel + 7 KPI + hero raksasa | Tiga cara memvisualkan hal yang sama → diganti **stacked bar** + 4 KPI murni + 3 kartu aksi. |
| `command-strip` di Ringkasan (duplikat sidebar + Proses) | Kontrol worker hanya di sidebar (global) + detail di Proses. |
| Seksi "Insights" yang dilipat (6 kartu sekunder) | Informasi penting dipromosikan ke layout utama; sisanya deep-link. |
| Chip filter "Selesai" (duplikat OK+Sebagian) | Status chip kini: Semua · OK · Sebagian · Gagal · Menunggu. |
| Banner error ganda (sidebar + kartu) | Satu sumber: sidebar card + banner global hanya saat error bernuansa auth. |
| `hero-views` / angka juta | KPI strip memakai `fmtCompact` id-ID (`… rb/jt/M`). |

Navigasi: **Kerja** (Ringkasan, Target, Akun) · **Operasi** (Proses, Sesi & Login) ·
**Sistem** (Pengaturan). Badge sidebar: Target (jumlah) & Akun (perlu tinjauan).
Audit aktif: picker global di titlebar (berlaku Ringkasan/Target/Akun) + indikator di statusbar.

## 6. Komponen inti

- **Titlebar** — draggable; kiri: mark + wordmark + konteks (`Ringkasan · <audit>`);
  tengah: command bar pill (Ctrl+K, ↑↓/Enter); kanan: audit picker + toggle tema.
  Window controls via `titleBarOverlay` (warna ikut tema lewat `app:theme`).
- **Kartu aksi ("Perlu tindakan")** — ikon/angka besar, aksen kiri semantik, chevron;
  zero = non-interaktif (`aria-disabled`), bukan disembunyikan (konsisten secara visual).
- **KPI** — label uppercase micro, angka tabular, delta `7 hari` (▲/▼ + warna semantik),
  sparkline SVG tipis (aksen).
- **Stacked bar** — segmen Berhasil/Menunggu/Gagal; klik segmen atau legend →
  filter Target; `aria-pressed` sinkron; angka selalu teks.
- **Tabel** — header sticky, uppercase micro, sortable (`aria-sort`), hover row
  `--accent-wash`, kolom numerik kanan, `Δ` berwarna, status dot + label.
- **Modal** — mica elevasi, fokus terjebak (Tab), Esc menutup, klik backdrop menutup,
  fokus kembali ke pemicu; aksi destruktif pakai ketikan konfirmasi (`HAPUS`, `username`).
- **Command palette** — Ctrl+K; grup Aksi / Target / Akun / Post; keyboard penuh;
  hasil data memanggil modal/akun terkait.
- **Toast** — maks 3, border-left semantik, auto-hilang (error 8 detik).

## 7. Aksesibilitas

- Fokus `:focus-visible`: outline 2px aksen + offset 2px (semua elemen interaktif).
- Kontras teks ≥ 4.5:1 (diuji untuk pasangan token di atas); status tidak pernah
  *hanya* warna (dot + label).
- Chart SVG ber-`role="img"` + `aria-label`; stackbar `role=group`; meter `role=progressbar`
  dengan `aria-valuenow`.
- Tabel sortable: `aria-sort` pada `<th>`; baris klik-able: `role=button` + `tabindex=0`
  + aktivasi Enter/Spasi.
- Empty state selalu memuat **aksi berikutnya** bila ada (bukan halaman mati).

## 8. Motion

`.15s/.25s/.4s` dengan `cubic-bezier(.2,.7,.2,1)`; tab fade+translateY 6px; press scale .97;
tidak ada animasi dekoratif; `prefers-reduced-motion: reduce` mematikan semuanya.

## 9. Aset

Ikon: SVG inline stroke 1.7 (konsisten). Logo jendela & titlebar: matahari pipih
(`#FFCC66` jingga, `#FFE966` kuning) — sumber: `assets/icon.png` (512px, juga dipakai
`build/icon.png` untuk NSIS). Tidak ada aset raster di UI selain avatar pengguna.
