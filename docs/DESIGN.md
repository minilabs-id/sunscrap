# Desain Antarmuka — sunscrap · v2 "Analyst Command Center"

Direvisi sepenuhnya setelah kritik terhadap v1. Gaya: **Clean SaaS terang** — hero terang modern dengan
aksen matahari (tanpa blok gelap di dashboard); mode gelap opsional tetap tersedia lewat toggle.
identitas brand matahari dipertegas, interaksi nyata, satu sumber data.

Artifact: [`mockup/sunscrap-redesign.html`](mockup/sunscrap-redesign.html) — mockup statis mandiri
(buka langsung di browser), tanpa dependensi, memakai data dummy terstruktur sama dengan API nyata.

---

## 0. Ringkasan kritik v1 → perbaikan v2

| # | Kritik v1 | Perbaikan v2 |
|---|---|---|
| 1 | Identitas brand hilang (generik biru-abu) | Hero "Total Views" terang dengan gradasi krem + aksen matahari; logo matahari SVG; aksen sun-deep konsisten |
| 2 | Hierarki datar, tak ada fokus | **Hero** = titik masuk; panel diurut riilbarak: hero → KPI → tren → funnel → detail; ukuran elemen menurun |
| 3 | Grafik cacat skala/label | Axis-Y mencerminkan skala sebenarnya (0/100/200/300/400 rb); barCompare diganti tabel+ER bar bergradasi; funnel dihitung dari 1 sumber |
| 4 | Angka saling bertentangan (79,2% vs 86%) | Satu konstanta `DATA` di JS (total 1.284 / diproses 1.180 / terverifikasi 1.017 / gagal 154 / menunggu 106) → **semua tampilan sinkron** |
| 5 | Kontras gagal WCAG (`#94a3b8`≈2,5:1) | `--ink-3` dinaikkan ke `#5b6478` (≳4,5:1); focus-visible 2px brand; baris keyboard-focusable; `role`/`aria-label`/`scope` untuk chart & tabel |
| 6 | Interaksi nyaris nol | Tab switching ARIA-compliant (`role="tab"`/`aria-selected`), donut+legend klik-untuk-filter, urutan tema, hover/focus tooltip, Ctrl+K, toggle dark mode, deep-link filter munteen |
| 7 | Tak ada state/error | Dyasembung loaders/toast, empty state CTA, sesi kedaluwarsa (auth banner), error page implisit via status pills |
| 8 | Chart tanpa label/tooltip | Tooltip mengikuti mouse/tap (`chart-tooltip`), hari ini-highlighted (garis vertikal `.today-cap`), axis labels tetap, teks ringkasan di bawah chart |

---

## 1. Prinsip

1. **Satu sumber data.** Semua tampilan derivable dari konstanta/agregat backend yang sama; tidak ada
   angka hard-code yang bertabrakan.
2. **Lead with the answer.** Hero menampilkan "apa yang terjadi" sebelum detail — totalReach, pulse,
   peringatan aksi.
3. **Setiap angka bisa ditelusuri.** Klik segmen/bar/tema menge-filter panel atau membuka modal/deep-link.
4. **Kontras & aksesibilitas.** Semua teks ≥ 4,5:1, ikon berlabel, navigasi keyboard penuh,
   `prefers-reduced-motion` menghilangkan animasi.
5. **Bersih, bukan generik.** Palet hangat (parchment + krem + indigo + matahari), tipografi besar, whitespace
   berfungsi sebagai hierarki, bukan sekadar dekorasi.

**Batasan teknis yang mengikat**
- CSP `script-src 'self'` → **tanpa CDN/chart library**. Semua grafik = **SVG** buatan sendiri.
- Tanpa framework; render lewat `innerHTML`/template + delegasi event.
- Font sistem (`Segoe UI`), `font-variant-numeric: tabular-nums` untuk metrik.

---

## 2. Design tokens (v2)

| Grup | Token / nilai |
|---|---|
| Background | `--bg:#eceff5` (parchment), `--surface:#ffffff`, `--surface-2:#f7f9fc`, `--surface-3:#eef1f7`, `--sunken:#e3e7ee` |
| Ink | `--ink:#0b1220`, `--ink-2:#39415a`, **`--ink-3:#5b6478`** (AA contrast) |
| Brand | `--brand:#4338ca` (indigo), `--brand-ink:#3730a3`, `--brand-soft:#eef0ff`, `--brand-line:#c7c5f5` |
| Sun | `--sun:#f59e0b`, `--sun-deep:#d97706`, `--sun-ink:#b45309`, `--sun-soft:#fff4d6` |
| Status | `--ok:#047857` (+`--ok-soft`), `--err:#b91c1c` (+`--err-soft`); peringatan pakai sun-soft/ink |
| Elevation | `--sh-sm/md/lg` → `0 1px 2px …`, `0 4px 14px …`, `0 16px 40px …` |
| Radius | `8 / 12 / 16 / 20px` (`--r-sm/md/lg/xl`) |
| Type | Metric hero `46/800`, judul halaman `24/800`, kartu `26/800`, body `14`, label `11/700 uppercase` |
| Dark | `color-scheme: dark` + token full set (`#0b0f1a` bg, `#131a29` surface, teks `#f2f5fd`); hero Dashboard tetap terang dengan teks gelap |

---

## 3. Shell aplikasi

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  Dashboard · Kampanye November 2026     [ Ctrl K ]      ☾ dark toggle   │
├────────────┬─────────────────────────────────────────────────────────────────┤
│ ☀ SCRAP    │  ┌ HERO ↴  Total Reach 8,99 jt ↗ 18,0%   pulse card IG/TK/verified⎥
│            │  │  gradasi krem + aksen matahari radial                     │         │
│ UTAMA      │  │  chips: +18% vs Okt · 6 periode · tema Kuliner      │         │
│ ▪ Dashbr   │  └──────────────────────────────────────────────────────┘         │
│ ▪ Target   │  [ KPI 1.284 | 1.180 | 1.017 | 53 ]  sparklines                  │
│ ▪ Akun 53  │  ┌── Tren 30 hari (Views/Likes/Post switch) ─┐┌── Donut status ──┐  │
│ ▪ Proses   │  └──────────────────────────────────────────┘└─────────────────┘  │
│ ALAT       │  ┌ Funnel · 1 sumber ─┐┌ Performa tema (Views/ER/Post) ─┐         │
│ ▪ Browser  │  └─────────────────────┘└────────────────────────────────┘       │
│ SISTEM     │  ┌ Kualitas data · setiap baris = aksi ─────────────────┐        │
│ ▪ Pengatur.│  └──────────────────────────────────────────────────────┘        │
│            │                                                                    │
│ ┌ worker ┐ │                                                                    │
│ │●Aktif  │ │                                                                    │
│ │▓▓▓░░   │ │                                                                    │
│ └────────┘ │                                                                    │
└────────────┴─────────────────────────────────────────────────────────────────┘
```

- **Sidebar 248px** (boleh di-collapse): ikon SVG, label, grup, **badge** (Akun 27, Target 1.2k),
  *worker rail* dengan progress bar aksen sun.
- **Titlebar 46px**: window-dots (fokus drag), breadcrumb `sunscrap › Dashboard · Kampanye November`,
  tombol **Ctrl K command palette**, toggle tema.
- **Statusbar 30px**: status worker, audit aktif, ukuran DB, pace, versi, "local only".
- **Hero** adalah elemen identitas & fokus — monospaced numerics, gradien matahari, pulse live.

---

## 4. Komponen inti (v2)

| Komponen | Deskripsi |
|---|---|
| `hero` | Total reach + tren 12 minggu + pulse kampanye (IG/TK/terverifikasi/butuh keputusan). |
| `kpiCard` | Angka 26/800 + delta ▲▼ + **sparkline** 70×24px SVG. |
| `areaChart` | SVG 660×220, axis 0/100/200/300/400 rb, **baseline** garis putus, hover/focus pointer, vertical highlight "today", tooltip mengikuti kursor, pilihan metrik via tabs (Views/Likes/Post). |
| `statusDonut` | Stroke-dasharray, 4 kategori, klik toggle isolate; legenda interaktif; center teks berubah ke segmen terpilih. |
| `funnelList` | Dihitung dari satu konstanta — semua persen konsisten. |
| `temaTable` | Urut Views/ER/Post, ER bar gradasi sundee, tombol **+18% vs Okt** membuka tooltip sel. |
| `themeTabs` | `role="tablist"` + `aria-selected`, keyboard operable. |
| `filterChip` | `aria-pressed`, dark = pill gelap, clear = pill outline. |
| `tooltip` | `chart-tooltip` fixed guidance + `cell-tooltip` untuk sel tabel; Esc menutup. |
| `toast` | `aria-live=polite`, auto-remove 3,4 detik. |
| `clusterCard` | Intel cluster: size, alasan, "bukti kuat" badge. |
| `checklistRow` | Kualitas data: tiap baris = aksi (Kunjungi profil / Ulangi gagal / Lihat). |

---

## 5. Aksesibilitas (WCAG 2.1 AA, target)

- Kontras teks ≥ 4,5:1; ikon dekoratif `aria-hidden`, chart `role="img"` + `aria-label`.
- Baris/kartu yang beraksi: `tabindex=0` + `Enter`/`Space`; baris tema terfokus terlihat jelas
  (`aria-pressed` + `sunken` bg).
- `:focus-visible` 2px brand dengan offset; `Esc` menutup tooltip; `prefers-reduced-motion`
  dinonaktifkan transisi/animasi.
- Tabel: `th scope="col"` (implicit row scope), kolom numerik rata kanan.
- Warna bukan satu-satunya sinyal: status selalu punya label teks (`status-ok|part|fail|run|wait`).

---

## 6. Pemetaan data → UI (traceability)

| Sumber backend | Dipakai untuk |
|---|---|
| `getSummary` (kpi, totals, platforms, temas, audits, posts, quality) | Hero reach, KPI, funnel, tema, statusbar, kualitas checklist, top konten |
| `getQueueStats` | Proses (antrean, ETA, berkas legend) |
| `getLatest` (+`prev_*`) | Feed aktivitas delta ▲▼ (Proses), tren Delta Target |
| `getTargets` (+sort/dir, ER) | Tabel Target v2 |
| `getTargetHistory` | Sparkline baris (Target), modal riwayat |
| `getAccountIntel` (items, clusters, thresholds, summary) | Akun, panel snapshot intel Dashboard |
| `getAccountDetail` | Modal akun (posts, history, siblings) |
| `getCompare` (periods, months[]) | Small multiples / delta di hero & tema |
| `worker.getStatus().rate` | Worker rail + Proses gauge |
| `searchData` | Ctrl+K palet |
| `db.getDatabaseInfo` | Statusbar + Pengaturan |

---

## 7. Perubahan backend/IPC (secukupnya; tanpa ubah skema)

1. **Time series** — `data:timeseries`: `date(scraped_at)` → `{date, scraped, targets_unique}` opsional `auditId`, rentang hari.
2. **Target series** — perluas `getTargetHistory` / `data:targetSeries` yang mengembalikan `likes|views|scraped_at`.
3. Delta pemakaian `getLatest.prev_*` (tanpa query baru).
4. Perluas `getSummary` bila perlu: distribusi level dari `getAccountIntel` untuk panel "Snapshot intel";
   `first/last_scraped_at` sudah ada untuk label periode.

Limit rentang + read-only; tidak menyentuh `SCHEMA_VERSION`.

---

## 8. Rencana implementasi bertahap

1. **Tokens + shell** — `styles.css`, `index.html` (sidebar, statusbar, hero, cluster theme).
2. **Dashboard v2** — hero, KPI+sparkline, area chart (+`data:timeseries`), donut interaktif, funnel,
   tema, kualitas checklist.
3. **Target v2** — delta, sparkline, sort header, filter chips, keyboard.
4. **Akun v2** — score bar, reach gauge, cluster chips, modal kaya a la quote.
5. **Proses v2** — gauge pace, antrean live, feed delta.
6. **Polish** — Ctrl+K palet, busy-state, empty state, preferensi density, print CSS, mode gelap penuh.

Setiap fase: `npm test` + `npm run e2e`, tanpa dependensi baru, CSP `self` saja.

---

## 9. Catatan

- Mockup memakai **data dummy** yang konsisten; bukan angka nyata.
- v2 menggantikan v1; seluruh kritik §0 dianggap tertutup di mockup.
- Implementasi baru akan mengganti `src/renderer/styles.css` secara progresif, bukan big-bang.
