# Riwayat Audit & Status Perbaikan

Arsip hasil audit lama yang telah dikonsolidasikan. Berguna sebagai jejak keputusan; **bukan daftar tugas aktif**
(lihat [BACKLOG.md](BACKLOG.md)). Format: temuan → status.

## Garis waktu

1. **`AUDIT.md`** — audit awal (fondasi, keamanan, ToS). Sudah tidak relevan; intinya terwakili di bawah.
2. **`AUDIT-v3-2026-11-04.md` / `AUDIT-2026-11-04.md`** — audit ronde kedua; sebagian besar temuan masuk ke sesi perbaikan.
3. **`AUDIT-FULL-2026-11-05.md`** — audit penuh (K/T/M/F) + tabel status perbaikan. **Sumber utama ringkasan ini.**
4. **`AUDIT-UIUX-2026-11-05.md` / `AUDIT-UIUX-RE-2026-11-05.md`** — audit UI/UX.
5. **`audit-menu-2026-11-05/`** — audit UI/UX per menu (7 laporan). Temuan yang masih terbuka dipindahkan ke [AUDIT-2026-11-05.md](AUDIT-2026-11-05.md) & [BACKLOG.md](BACKLOG.md).
6. **`OPSI-TERBAIK.md`** — kumpulan opsi rekomendasi.

## Temuan KRITIS (K) — semua selesai

| Kode | Temuan | Status |
|---|---|---|
| K-1 | `restoreDatabase` dengan sumber = DB aktif menghapus seluruh data (terbukti empiris) | **Selesai** — tolak `source == dbPath`; copy→verifikasi→swap rename |
| K-2 | Gagal di tengah restore = DB kosong tanpa peringatan | **Selesai** — temp-then-swap + pesan memuat path safety |
| K-3 | Protokol `sa-avatar:` selalu 404 (avatar tak pernah tampil) | **Selesai** — skema tanpa `standard`; `sa-avatar:///`; fallback inisial |
| K-4 | "Hapus semua data" meninggalkan file avatar di disk | **Selesai** — `clearAll` & `account:delete` menghapus `avatars/` |
| K-5 | Restore menyetel `user_version=5` tanpa memeriksa versi cadangan | **Selesai** — guard skema; preview menonaktifkan tombol saat mismatch |

## Temuan TINGGI (T) — semua selesai

| Kode | Temuan | Status |
|---|---|---|
| T-1 | Avatar remote bisa tersimpan & diunduh (SSRF-ish) + CSP memblokir | **Selesai** — allowlist host CDN, cap 3 MB, magic bytes, gagal→`null`, renderer hanya `sa-avatar:///` |
| T-2 | Fitur kunjungan profil & pencarian tak punya UI (dead surface) | **Selesai** — tombol "Kunjungi profil" + pencarian global Ctrl+K |
| T-3 | Parser CSV memecah baris di newline dalam sel berkutip | **Selesai** — state machine char-demi-char + uji |
| T-4 | URL post dengan query pelacak jadi target duplikat | **Selesai** — buang query + normalisasi `/reels/` |
| T-5 | Jalur panas dashboard recompute penuh tiap 5 detik | **Selesai** — memo per `intelGen`; poll berhenti saat hidden; `getAudit` query khusus |
| T-6 | `getExportCount` memuat seluruh baris | **Selesai** — `COUNT(*)` dengan `attempt_rn=1` |
| T-7 | `clearAll` tak mereset budget rate limiter | **Selesai** — `limiter.resetCounters()` |
| T-8 | Jendela login tanpa pembatasan navigasi | **Selesai** — allowlist OAuth + `openExternal` |

## Temuan MENENGAH (M)

| Kode | Ringkas | Status |
|---|---|---|
| M-1 | Bind `NaN` ke SQLite + renderer tanpa `.catch` | Selesai (guard `Number.isFinite` + try/catch) |
| M-2 | LIKE-wildcard injection | Selesai (`escapeLike` + `ESCAPE '\'`) |
| M-3 | `getDelay()` bisa `NaN` | Selesai (clamp ke mean) |
| M-4 | Overlay titlebar putih saat dark mode | Selesai (IPC `app:theme` → `setTitleBarOverlay`) |
| M-5 | Jendela bisa muncul di luar layar | Selesai (`clampWindowBounds`) |
| M-6 | Preview backup tanpa info kompatibilitas | Selesai |
| M-7 | Toast restore tanpa path safety | Selesai |
| M-8 | `scripts/monitor.js` usang | Selesai |
| M-9 | `scripts/e2e.js` rapuh memilih jendela | Selesai |
| M-10 | Snapshot tanpa retensi | **Ditunda** (keputusan produk) |
| M-11 | `prev_*` delta lintas waktu | Selesai (dicatat di sheet Rekap) |
| M-12 | `getAudit` O(semua audit) | Selesai |
| M-13 | Caption-template false-positive massal | Selesai (`MAX_TEMPLATE_FANOUT=10`) |
| M-14 | `npm audit`: uuid moderate via exceljs | **Ditunda** (fix menuntut downgrade breaking) |
| M-15 | Migrasi naik versi skema | Selesai sebagian (guard + uji; migrasi bertingkat menyusul) |
| M-16 | IPC tanpa validasi payload | Selesai |
| M-17 | `createStorage.remove` non-atomik | Selesai (tmp+rename) |
| M-18 | `will-navigate` membandingkan string URL | Selesai (`fileURLToPath` + `path.normalize`) |

## Temuan KECIL (F)

Selesai: F-1 (parse waktu UTC di renderer), F-2 (badge dark), F-3 (fallback avatar), F-4 (`scope="col"` statik),
F-5 (ETA dari pace limiter), F-6 (settings auto-refresh), F-7 (`#btn-retry-failed` disabled), F-9 (catatan share),
F-12 (lebar `.select`), F-15 (`.gitignore` `*.tmp-*`).
Ditunda/di luar kode: F-8 (semantik `success_rate`), F-13 (duplikasi icon), F-14 (tanda tangan installer), F-16 (dokumen audit di repo — kini dikonsolidasikan).

## Audit UI/UX per menu (yang masih terbuka)

Pola lintas-menu yang **belum** diperbaiki dan kini dilacak di [BACKLOG.md](BACKLOG.md):

1. Baris tabel/card klik tidak dapat difokus/dioperasikan keyboard.
2. Gagal baca senyap di sebagian panel.
3. Tanpa busy-state pada aksi async mahal.
4. Empty state tanpa CTA.
5. Status `running` tidak dibedakan dari `pending`.
6. Terminologi/label belum seragam (mis. "total", "Export").
