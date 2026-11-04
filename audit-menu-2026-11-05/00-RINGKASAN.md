# Ringkasan Indeks — Audit UI/UX per Menu (1 laporan = 1 menu)

**Tanggal:** 2026-11-05
**Basis:** HEAD `6e0b480` + working tree (belum dikomit) — Windows-only.
**Cakupan:** audit antarmuka (bukan ulang audit keamanan/kode backend) untuk setiap halaman yang bisa dibuka dari sidebar, dievaluasi sebagai *operator desktop*, bukan pembaca kode.
**Pendahulu:** `AUDIT-UIUX-2026-11-05.md` dan `AUDIT-UIUX-RE-2026-11-05.md` sudah memilah-milah perbaikan yang sudah masuk. Dokumen ini **tidak mengulang** temuan yang sudah beres (export berpagar lingkup, debounce, modal ARIA + trap fokus, `:focus-visible`, dark mode, print CSS, avatar lokal `sa-avatar:`, restore DB, ETA Proses, banner auth kedaluwarsa, menu lengkap + `Ctrl+1..6`, status bar, scope=col, tema toggle). Fokus: **apa yang masih terasa di tangan pada setiap menu, satu per satu.**

## Daftar laporan

| # | Menu (file) | Laporan | Skor |
|---|---|---|---|
| 01 | Dashboard (`#tab-dashboard`) | `01-menu-dashboard.md` | **C+** |
| 02 | Target (`#tab-targets`) | `02-menu-target.md` | **C+** |
| 03 | Akun (`#tab-accounts`) | `03-menu-akun.md` | **C+** |
| 04 | Proses (`#tab-proses`) | `04-menu-proses.md` | **C+** |
| 05 | Browser (`#tab-browser`) | `05-menu-browser.md` | **C−** |
| 06 | Pengaturan (`#tab-settings`) | `06-menu-pengaturan.md` | **B−** |
| 07 | *(Lampiran)* Shell global: titlebar, sidebar, statusbar, modal, toast — pembungkus keenam menu | `07-shell-global.md` | **C+** |

## Legenda severity

- **P0** — rusak / menyesatkan / berbahaya *sekarang*, harus dihentikan dulu.
- **P1** — merusak kepercayaan atau efisiensi harian operator.
- **P2** — pemolesan berdampak, sebaiknya masuk iterasi berikut.
- **P3** — nitpick, catat saja.

## Pola lintas-menu (ringkasan sebelum baca per file)

1. **Baris tabel yang bisa diklik tidak bisa difokus/dioperasikan keyboard-only** (Dashboard `#risk-accounts`, Target `#targets-table`, Akun `#accounts-table`) — `tr`/`div` + `click` listener tanpa `tabindex`/`role`/handler Enter/Space. (Kontras dengan checkbox di Target, yang sudah punya `aria-label`.)
2. **Gagal baca = diam.** `loadTargets`, `loadAccounts`, `loadProcess`, `loadRiskAccounts`, `refreshDashboard` semuanya `catch {}` atau tanpa `catch` sama sekali → rejection tak tertangani, tabel membeku/basi tanpa satu pun tanda.
3. **Empty state tanpa CTA.** "Belum ada data." / "Tidak ada target." berhenti di teks; tidak ada tombol ke aksi yang jelas (Import data / Mulai worker).
4. **Primary aksi tiap halaman tidak konsisten.** Import ada di Dashboard saja; Export hidup di halaman Target dengan membaca filter Target; Retry mewajibkan audit terpilih padahal "Semua audit" adalah state yang valid di dropdown global.
5. **Umpan balik aksi async tidak punya busy-state.** Export, Backup, Restore, Rerun, Retry — semua bisa diklik 2× (dialog file/aksi dobel).
6. **Terminologi & label tidak seragam.** Filter Akun menyebut "Terindikasi kuat", badge menampilkan "pola kembar"; kata Inggris telantar ("total", "Export") di UI berbahasa Indonesia.
7. **Chrome jendela tidak sadar tema.** `titleBarOverlay` putih keras (`main.js:214`) sementara app punya dark mode.
8. **Status `running` tidak dibedakan dari `pending`** — abu-abu sama persis (`styles.css:215`).

## Verdict keseluruhan

Fondasi per-menu kini cukup rapi secara visual; yang kurang bukan estetika melainkan **rangkaian umpan balik**: siapa pun yang hanya mengandalkan keyboard, siapa pun yang mengalami kegagalan baca, dan siapa pun yang salah klik aksi mahal — semuanya masih dibiarkan mencari tahu sendiri. Naik ke **B** memerlukan empat hal murah: tombol CTA pada empty state, keyboard-aktivasi baris, `catch` yang bicara, dan busy-state pada semua tombol async. Tidak satu pun memerlukan penulisan ulang arsitektur.

> Catatan: laporan ini **tidak mengubah file sumber**. Semua referensi `file:baris` mengacu pada working tree saat penulisan.
