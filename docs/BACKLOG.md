# Backlog & Roadmap

Pekerjaan terbuka, diurutkan prioritas. Sumber: [AUDIT-2026-11-05.md](AUDIT-2026-11-05.md).

## P1 — Umpan balik UI/UX

- [x] **Keyboard-aktivasi baris tabel & kartu klik.** `tabindex=0` + `role="button"` + `Enter`/`Space` + `:focus-visible` — Target, Akun, baris Tema & konten, dan kartu "Perlu tinjauan" di Dashboard (langsung ke tab Akun).
- [ ] **`catch` yang bicara di panel sisa.** `loadRiskAccounts`, `loadProcess`, `loadSettings` → toast error (Target/Akun sudah).
- [ ] **Busy-state pada aksi async mahal.** Disable tombol + spinner saat Export/Backup/Restore/Rerun/Retry/Hapus berjalan.
- [x] **Bedakan status `running` vs `pending`.** Warna/ikon berbeda (`.status.running` berdenyut brand, `.status.pending` netral) di Target & feed Proses; antrean menampilkan keduanya terpisah.
- [ ] **Empty state ber-CTA.** Tombol Import data / Mulai worker pada tabel kosong.
- [ ] **Seragamkan label.** Hilangkan sisa istilah Inggris telantar ("total", "Export") sesuai konvensi UI.

## P2 — Arsitektur / kebenaran

- [ ] **Hapus dead code**: `db.getDashboardStats`, `db.getTargetWithAudit`, `db.getAccountProfile` (sesuaikan tes bila perlu).
- [ ] **Filter audit pada `getTargets`** untuk CTE `latest_tasks`/`latest_snapshots` (performa DB besar).
- [ ] **Reclaim di `getQueueStats`** agar angka Menunggu/Berjalan tak termasuk task `RUNNING` basi.
- [ ] **Hindari double-load export** (hitung/ambil baris sekali, lalu tulis).
- [ ] **Batalkan promise yang kalah di `withTimeout`** (lepas referensi setelah timeout).
- [ ] **Prioritas task**: pertimbangkan agar PROFILE tidak selamanya mendahului POST.
- [ ] **Beritahu bila retry dipotong** (>200 id) di UI.
- [ ] **Satukan sumber versi**: `SCHEMA_VERSION` dan versi aplikasi diekspos ke renderer via IPC (jangan hardcode `5`/`v1.0.0`).
- [ ] **Jalur audit inkremental**: beri UI untuk rerun non-full, atau hapus jalur `full=false` bila memang tak dipakai.

## P2 — Produk (butuh keputusan)

- [ ] **Retensi snapshot** (M-10): tool "hapus snapshot lebih lama dari N bulan" + mode export `latest|all`.
- [ ] **`npm audit` uuid via exceljs** (M-14): pantau rilis exceljs; jangan `--force`.

## Roadmap — Auto-update & signing

Lihat [../PLAN-AUTO-UPDATE-2026-11-05.md](../PLAN-AUTO-UPDATE-2026-11-05.md). Status kode: `updater.js` + IPC +
preload + tray + panel Pengaturan + workflow CI **sudah ada** (belum dikomit saat dokumen ini ditulis).
Terbuka: **signing** (SignPath Foundation masih approval) → lalu aktifkan `verifyUpdateCodeSignature: true` &
`signAndEditExecutable`. Keputusan produk lain: kenaikan versi pertama & rilis pertama manual.

## Catatan

- `build/icon.png` sengaja duplikat `assets/icon.png` (electron-builder memakai `build/` sebagai buildResources).
- Installer belum ditandatangani (F-14) — keputusan rilis, bukan bug kode.
