# Audit Keseluruhan — sunscrap (HEAD `1da6a22`, working tree bersih)

**Tanggal:** 5 Nov 2026 · **Cakupan:** seluruh source code (`src/`, `scripts/`, `assets/`, `package.json`, CSP, build config) · **Metode:** baca penuh ~7.300 baris + verifikasi empiris (bukan sekadar baca) · **Bukan audit legal/ToS** (sudah dibahas di README & audit sebelumnya).

**Yang dijalankan saat audit ini:**
- `npm test` → **46/46 pass** (db, intel, rateLimiter, taskCache, policy, util, import)
- `npm audit --omit=dev` → 2 moderate (uuid <11.1.1 via exceljs — lihat M-14)
- Uji parser `sa-avatar://` dengan Electron sungguhan (protocol.handle + net.fetch) — **avatar SELALU 404**
- Uji `db.restoreDatabase(dbPathAktif)` (sumber = DB aktif) — **seluruh audit terhapus, DB diganti kosong**
- Working tree bersih (`git status` kosong) — audit menilai kode persis seperti commit.

---

## Ringkasan eksekutif

Fondasi tetap kuat: SQL 100% parameterized, transaksi `BEGIN IMMEDIATE`, WAL + `busy_timeout`, claim/lock/reclaim yang benar dan diuji, allowlist host dua lapis, CSP ketat tanpa remote script, escaping HTML konsisten, sandbox/contextIsolation di semua jendela, dan backup+restore yang *hampir* benar. Sebagian besar temuan audit 2026-11-04 sudah masuk.

**Namun audit ini menemukan satu jalur kehancuran data yang terbukti bisa terpicu dari UI normal (pilih file cadangan = database aktif sendiri), satu fitur privasi utama yang diam-diam tidak berfungsi sama sekali (avatar selalu 404), dan satu aturan bisnis penting yang tidak pernah bisa dijalankan (seluruh pipeline kunjungan profil + pencarian tertulis & ter-IPC tapi tidak punya UI).** Tidak ada yang butuh tulis ulang — semuanya perbaikan inkremental.

| Area | Nilai | Catatan |
|---|---|---|
| Kebenaran DB & transaksi | B+ | migrasi skema pincang, restore rapuh |
| Keamanan | B− | baik di perimeter; lubang di restore & avatar |
| Privasi | B− | avatar 404 (bagus tak sengaja), tapi “Hapus semua data” bocor di disk |
| Keandalan data | C | **data-loss terbukti**; kosongkan DB saat restore gagal |
| Fitur selesai? | C | PROFILE-visit & search = dead surface besar |
| Performa jalur panas | C+ | recompute penuh per refresh 5 detik |
| Kualitas kode | B | rapi, tapi `db.js` 1.518 baris monolitik |
| Test | C+ | 46 pass; worker/scraper/ipc/export belum diuji |

---

## 1. KRITIS (data hilang / hilang diam-diam)

### K-1. Restore dengan sumber = database aktif menghapus seluruh data — terbukti empiris
`db.js:1615-1634` (`restoreDatabase`):

```js
inspectBackup(sourcePath);            // lolos: file .db valid dengan tabel lengkap
backupDatabase(safety);                // VACUUM INTO pre_restore_*.db  ✓ aman
conn.close();
for (const stale of [dbPath, dbPath + '-wal', dbPath + '-shm'])
  try { if (fs.existsSync(stale)) fs.unlinkSync(stale); } catch {}   // ← MENGHAPUS DB AKTIF
fs.copyFileSync(sourcePath, dbPath);   // ENOENT — sourcePath sudah di-unlink barusan!
```

**Bukti (dijalankan di folder temp):**
```
audits sebelum: 1
restore-self error: ENOENT: no such file or directory, copyfile 'active.db' -> 'active.db'
audits sesudah: 0        ← seluruh audit hilang dari aplikasi
db ada? true             ← diganti DatabaseSync kosong + initSchema() di finally
safety: pre_restore_1793834591311.db (satu-satunya penyelamat, tidak disebutkan ke user)
```
**Cara terpicu dari UI normal:** Pengaturan → *Pulihkan dari cadangan…* → user memilih `sunscrap.db` yang sama (dialog tidak men-set defaultPath; `sunscrap.db` adalah file `.db` paling mencolok di folder data yang sama yang bisa dibuka dari “Buka folder data”).
**Perbaikan (wajib, P0):**
1. `if (path.resolve(sourcePath) === path.resolve(dbPath)) throw new Error('Cadangan tidak boleh sama dengan database aktif.')` — sebelum apa pun.
2. Jangan pernah unlink DB aktif sebelum copy diverifikasi: `copyFileSync(source → tmp)` → `fs.renameSync(tmp, dbPath)`; unlink WAL lama **setelah** rename sukses; jika gagal, `conn = open(dbPathLama)` — DB tidak pernah hilang.
3. Bandingkan juga `path.resolve` untuk `sourcePath` di dalam folder yang sama dengan tujuan `-wal`/`-shm` (kasus `finalDest` bertabrakan).

### K-2. Gagal di tengah restore = DB kosong tanpa peringatan ke user
Dua rasio cacat dalam satu fungsi: (a) unlink sebelum copy (K-1), (b) `finally { conn = new DatabaseSync(dbPath); initSchema(); }` — bila `copyFileSync` gagal (disk penuh, file dikunci antivirus), DB **baru yang kosong** dibuat dan aplikasi lanjut seolah normal; user melihat “Audit: 0” tanpa diberi tahu ada safety backup.
**Perbaikan:** struktur temp-then-swap seperti K-2 (a), kembalikan error eksplisit + sertakan path `safety` di pesan error; renderer sudah menampilkan `r.error` toast.

### K-3. Avatar cache t.a.k. pernah tampil — protokol `sa-avatar:` selalu 404 (terbukti empiris)
`main.js:334-344` + `app.js:368-375`:
- Renderer membuat `sa-avatar://<namafile>` — **tanpa** path, tanpa skema tiga-slash.
- Chromium (skema terdaftar `standard: true`) menormalkan jadi `sa-avatar://<namafile>/` — host = namafile (lowercase), pathname = `/`.
- Handler: `new URL(request.url).pathname.replace(/^\//, '')` → `''` → `resolveAvatar(dir, '')` → `path.basename('')` → `''` → **`null` → 404, selalu**.

**Bukti (Electron sungguhan, tiga bentuk URL sekaligus):**
```
HANDLER url = sa-avatar://aaa.jpg/ | extracted = ""
FETCH   sa-avatar://AAA.jpg     -> extracted=
HANDLER url = sa-avatar://bbb.jpg/ | extracted = ""     ← termasuk bentuk 3-slash!
FETCH   sa-avatar:///BBB.jpg    -> extracted=
HANDLER url = sa-avatar://ccc.jpg/ | extracted = ""
```
Karena skema didaftarkan `standard: true`, **seluruh** bentuk URL kehilangan komponen filename. Akibatnya: fitur privasi utama (avatar dilocal cache, tidak bocor ke CDN) tidak pernah bekerja; yang tampil adalah lingkaran abu-abu (`.avatar` punya `background: var(--line-soft)`) tanpa inisial (fallback hanya untuk `avatar_url` falsy — `<img>` dengan `alt=""` tetap ter-render meski 404).
**Alternatif perbaikan (terverifikasi di mesin yang sama):** daftarkan tanpa `standard: true` — `{ scheme: 'sa-avatar', privileges: { secure: true, supportFetchAPI: true } }` — dan renderer memakai `sa-avatar:///${encodeURIComponent(name)}`; handler `decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))` + `path.basename` (anti-traversal tetap). Hasil uji: handler menerima `extracted = "CaSe_Name-01.jpg"` dengan huruf besar utuh. Tambahkan `onerror` pada `<img class="avatar">` → ganti ke `.avatar-fallback` (inisial) supaya file cache yang hilang/korup juga punya fallback (item audit menu Akun A-06).

### K-4. “Hapus semua data” meninggalkan file avatar di disk — janji privasi tidak ditepati
`db.js:590-603` (`clearAll`) menghapus semua tabel, **tidak** menyentuh `userData/avatars/`. `deleteAccount()` (`db.js:573-588`) juga tidak. `deleteAudit()` — sama. File avatar (bisa menyimpan wajah orang nyata) bertahan bahkan setelah “Hapus semua data” dan setelah uninstall.
**Perbaikan:** di handler `data:clearAll` / `account:delete` / `data:deleteAudit`, hapus juga `avatars/<platform>_<username>.*` (pola file sudah deterministik dari `safeName(`${platform}_${username}`)`); untuk clearAll, `fs.rmSync(avatarDir, {recursive:true, force:true})` + buat ulang kosong.

### K-5 (gabungan K-2/restore). `restoreDatabase` menyetel `user_version = 5` tanpa memeriksa versi cadangan
`initSchema()` selalu `PRAGMA user_version = 5` (`db.js:156`) dan satu-satunya migrasi adalah `ALTER TABLE accounts … avatar_url` (`db.js:158-161`). Cadangan dari versi skema lebih lama (mis. v1–v4 dengan kolom lain hilang) atau **lebih baru** dipulihkan seolah skema 5 — query yang mereferensikan kolom yang tidak ada akan meledak di runtime ("no such column"), tanpa pesan yang jelas ke user.
**Perbaikan:** `restoreDatabase` harus menolak (atau memeriksa matriks migrasi) bila `backup_user_version > SCHEMA_VERSION`, dan untuk `< SCHEMA_VERSION` jalankan migrasi penuh per versi — atau tolak dengan pesan jujur (“cadangan dibuat dari versi lebih lama; pulihkan dengan versi vX”). `restorePreview` sekalian tampilkan `schema_version` (sudah dikembalikan `inspectBackup`).

---

## 2. TINGGI

### T-1. Avatar jarak jauh masih bisa tersimpan & diunduh — SSRF-ish + CSP menghalangi gambarnya
- Bila unduh avatar gagal (`avatar.js:15-31`), `worker.recordProfile` tetap menyimpan `profile.avatarUrl` **URL jarak jauh** (mis. `https://*.cdninstagram.com/...`) ke DB. Renderer menge-render `<img src="https://…">` (`app.js:370`) → **diblokir CSP `img-src 'self' data: sa-avatar:`** → gambar rusak; dan kalau CSP pernah longgar, IP+waktu akses user bocor ke CDN (pelanggaran klaim “sepenuhnya lokal” yang sama seperti E-7 audit sebelumnya).
- `cacheAvatar` `fetch(url)` **tanpa allowlist host, tanpa batas ukuran, mengikuti redirect** — `avatarUrl` berasal dari isi halaman (postingan/bio yang dimuat worker). Halaman IG/TikTok yang jahat bisa membuat aplikasi mengambil `http://192.168.x.x/*` atau berkas `http://localhost:port/*` dan menyimpannya ke `avatars/` (hanya disajikan sebagai gambar, `<100-byte` ditolak, content-type tidak dicek magic-bytes).
**Perbaikan:** (a) bila `cacheAvatar` gagal → simpan `avatar_url = NULL` (bukan URL remote); (b) di renderer hapus cabang `https?:` — selalu `sa-avatar:///`; (c) allowlist host avatar (`*.cdninstagram.com`, `*.tiktokcdn.com`, `*.fbcdn.net`, `profile.php` dsb.) + cap `Content-Length`/byte (mis. 2 MB) + cek magic bytes (FF D8 / 89 PNG); (d) `redirect: 'error'` atau validasi host akhir.

### T-2. Dua fitur besar ter-commit tapi tidak pernah bisa dipanggil: kunjungan profil (`PROFILE`) & pencarian
- `data:profileVisits` → `db.enqueueProfileVisits` → infra lengkap: klausul `kind='PROFILE'` di `getNextTask` (prioritas), handler khusus di `updateTaskResult`, `worker.processTask` jalur PROFILE, `recordAccountProfile` di db, `scrapeProfile` IG+TikTok. **Tidak ada satu pun pemanggil di renderer** (`grep` `profileVisits` di `app.js` = 0).
- `api.search` / `data:search` → `db.searchData(...)` lengkap (targets/accounts/posts + LIKE). **UI pencarian tidak ada.**
**Konsekuensi:** ~40% mesin scraping dan satu modul query hidup di produksi tanpa entry point — tidak pernah diuji e2e, membesar biaya review/keamanan, dan "Akun" tidak pernah terisi kalau tidak ada profil visit (follower count hanya masuk dari `updateTaskResult` follower_count — sebagian).
**Perbaikan (pilih satu):** (a) exposed — tombol “Kunjungi profil akun yang kurang data (N)” di Pengaturan atau tab Akun + kolom/menu pencarian global di titlebar; atau (b) hapus permukaan IPC+preload yang tak terpakai. Jangan dibiarkan menggantung.

### T-3. Parser CSV kotok—baris: newline di dalam sel berkutip memecah record
`import.js:70-96`: `parseCsv` memecah per `\r?\n` **sebelum** parsing kutip — nilai seperti `"baris1\nbaris2"` (umum di kolom caption/bio) menghasilkan dua baris rusak; parser juga kehilangan offset kolom `tema` untuk baris-baris itu.
**Perbaikan:** parser karakter-demi-karakter di level buffer/teks penuh (state machine `inQuote` lintas newline), atau minimal dukung `"…\n…"` dengan pre-normalisasi (join baris yang quote-nya belum tertutup) + uji. Sambil di sana: `parseLinksText` sudah benar; `sniffSeparator` hanya melihat baris pertama — cukup.

### T-4. URL post dengan query (`?igsh=`, `?utm_*`) tersimpan sebagai target berbeda → post yang sama di-scrape berkali-kali
`util.js:157-186` (`normalizeTargetUrl`): hanya `#hash` dihapus; `search` dipertahankan. Link share IG `https://www.instagram.com/reel/CODE/?igsh=AbCd…` vs `…?igsh=Xyz…` → dua target unik di DB (UNIQUE(audit_id,url) tidak menolong), dummy ganda, budget habis lebih cepat.
**Kabar baik:** `postRefFromUrl` membuang query → cache metrik (`getCachedPostMetrics`) tetap cocok; masalahnya murni duplikasi target + biaya kunjungan.
**Perbaikan:** untuk URL post IG/TikTok, buang seluruh query string (dan path `/reels/`→`/reel/`), atau minimal buang parameter pelacak yang dikenal (`igsh`, `igshid`, `utm_*`, `share_id`, `lang`). Uji regresi untuk dua URL share yang sama post.

### T-5. Jalur panas dashboard: recompute penuh setiap 5 detik
- Renderer: `setInterval(5s)` → `refreshDashboard()` → `api.getSummary()` (window function `ROW_NUMBER` atas **seluruh** tasks+snapshots, dua CTE), `loadRiskAccounts()` → `api.getAccounts({sort:'risk', limit:5})` (cache `intelGen` membantu — OK), `loadComparePanel()` → `getCompare()` (CTE full-scan snapshots periode × N), dan `loadAudits()` ikut pada tiap event `data`.
- `getAudits()` memanggil `cachedTargetCounts()` yang `EXISTS`-scan `account_posts` per target — tanpa batas; untuk 10k target × 50k posts ini berat dan **dipanggil setiap** refresh audit list.
- `getDashboardStats()` (db.js:947) full recompute + `reclaimExpired()` — dan ternyata **dead code** (tidak diekspos IPC, dipakai hanya oleh tes).
**Perbaikan:** (a) refresh 5s hanya di tab dashboard saat terlihat & dokumen fokus; (b) cache `getSummary`/`getCompare` per `intelGen`/version counter seperti intel; (c) `cachedTargetCounts` pra-komputasi sekali per `markIntelDirty`; (d) hapus `getDashboardStats` atau ekspos dengan sadar. Target awal: <100 ms per refresh untuk 10k target.

### T-6. `getExportCount` = `getExportRows().length` — hitung dengan memuat semua baris
`db.js:1541-1543`: export “konfirmasi sebelum unduh” memuat seluruh snapshot (bisa 100k+ baris × ~25 kolom) ke memori hanya untuk menghitung jumlah; `writeExport` lalu memuat semuanya dua kali lagi.
**Perbaikan:** `SELECT COUNT(*)` terpisah (CTE sama, tanpa SELECT *), atau `COUNT(1) OVER()` di page pertama. Validasi alasan “tidak ada data” di IPC juga bisa pakai ini.

### T-7. `clearAll()` dan `deleteAudit()` tidak menyetel ulang budget rateLimiter — “Hapus semua data” lalu worker berhenti tanpa sebab jelas
`worker-state.json` (`sa_dailyTaskCount`, `sa_cycleVisits`) bertahan setelah clear; bila rail harian (2000) terpakai sebelum hapus, worker langsung menolak jalan (`hasVisitBudget()=false`) walau DB kosong.
**Perbaikan:** `data:clearAll` sekalian `storage.remove(['sa_dailyTaskCount','sa_cycleId','sa_cycleVisits', …])` (method `remove` sudah ada di `createStorage`, tinggal dipanggil) — atau dokumentasikan. Juga pertimbangkan: clearAll tidak menghapus `avatars/` (K-4) dan tidak menyetel `needs_visit` — itu wajar.

### T-8. Login window tanpa pembatasan navigasi
`scraper.js:164-179` (`openLogin`): jendela login boleh navigasi ke host apa pun; `setWindowOpenHandler` hanya mengizinkan `allowedTarget` (host IG/TikTok) yang dibuka `openExternal` — link “Login with Google”/iCloud/Facebook akan terbuka di browser luar dan **tidak** berbagi sesi dengan aplikasi → alur login pihak-ketiga membingungkan/gagal.
**Perbaikan:** allowlist OAuth umum (accounts.google.com, www.facebook.com, appleid.apple.com, akunfoundation) di handler login window + `will-navigate` menahan host lain dengan toast “dibuka di browser luar”. Atau minimal dokumentasikan di tooltip tombol login.

---

## 3. MENENGAH

**M-1. Bind `NaN` ke SQLite → melempar `datatype mismatch`, dan renderer tidak menangkap.** `getTargets`: `Math.max(0, Number(params.offset||0))` → `NaN` (dikonfirmasi: `datatype mismatch`). `getTargetHistory(NaN)`, `updateTaskResult(NaN)` yang lolos `Number.isFinite` — aman; tapi `getTargets` offset NaN, `auditId` NaN (`data:targets`, `data:summary('abc')`, `data:compare` months string) → throw → IPC reject → `loadTargets()` dll. dipanggil tanpa `.catch` → **silent failure, tabel berhenti render, user tidak tahu**. Perbaikan: `const n = Number(v); Number.isFinite(n) ? n : def` di semua boundary DB + `.catch` di renderer dengan toast error.

**M-2. LIKE-wildcard injection (bukan SQL injection).** `getTargets` (`'%' + q + '%'`), `searchData` — `%`/`_` di input dianggap wildcard: cari `100%` → semua yang mengandung “100”; cari `_` → semua cocok. Fungsional/korektness. Perbaikan: `ESCAPE '\'` + escape `%_\\` (atau `instr(lower(col), lower(?)) > 0`).

**M-3. `getDelay()` bisa menghasilkan `NaN`** (`rateLimiter.js:195-207`): `u1 === 0` & `cos(2πu2) === 0` (u2=0.25/0.75) → `Infinity * 0 = NaN` → `Math.max(min, Math.min(max, NaN))` = `NaN` → `schedule(NaN)` (`Math.max(200, NaN)` juga NaN) → `setTimeout(…, NaN)` ≈ 1 ms → satu tick liar. Probabilitas ~0 tapi murah untuk ditutup: `if (!Number.isFinite(delay)) delay = (min + max) / 2`.

**M-4. Titlebar overlay chrome tetap putih saat dark mode.** `main.js:213-214`: `titleBarOverlay: { color: '#ffffff', symbolColor: '#101828', height: 40 }` — di dark mode seluruh titlebar dirender `--surface` (#1f2430) tapi tombol min/max/close tetap putih/abu → kontras aneh. Perbaikan: turunkan warna overlay dari `nativeTheme` / tema renderer (`theme:` broadcast → main menyetel `setTitleBarOverlay`), atau gunakan `titleBarStyle: 'hidden'` tanpa overlay + kontrol sendiri di drag region.

**M-5. Window bisa muncul di luar layar.** `main.js:201-227`: `x/y` dari `window-state.json` dipakai tanpa validasi; monitor eksternal dicabut → jendela muncul di koordinat hantu (tidak bisa diklik). Perbaikan: `screen.getAllDisplays()` → clamp `x/y` ke workArea; fallback center.

**M-6. Backup terlalu percaya diri tanpa indikasi versi/kompatibilitas.** `db:restorePreview` menampilkan hitungan + `schema_version` mentah ("Schema: 5 · …") tanpa menjelaskan apa artinya; tidak ada peringatan bila versi ≠ SCHEMA_VERSION saat ini. Gabungkan dengan K-5: tampilkan “cadangan dibuat dengan skema vX (aplikasi ini v5)” dan tolak bila tidak cocok.

**M-7. `restoreCommit` tidak menolak file yang tidak ada di dalam folder data / dengan nama `…-wal`.** `restoreDatabase` menyalin file apa pun yang lolos `inspectBackup` — itu desain wajar — tapi setelah K-1 diperbaiki, tetap biarkan user tahu safety backup disimpan di mana (tampilkan path penuh di toast/`dialog`).

**M-8. `monitor.js` rusak/usang.** `scripts/monitor.js:24`: `const tasks = one("SELECT … GROUP BY status")` diambil satu baris lalu tidak dipakai (dead var); `const { DatabaseSync } = require('node:sqlite')` — menampar nama lama; konsisten dengan `db.js` (`sqliteModule.Database || sqliteModule.DatabaseSync`); juga `db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000')` — OK. Perbaikan kecil: hapus var, pakai shim nama, tampilkan juga `user_version`.

**M-9. `scripts/e2e.js` Windows-only path**, dan stub `SA_IMPORT_FILE` hanya aktif saat `!app.isPackaged` — baik; tapi `app.firstWindow()` rapuh bila tray “Buka dashboard” membuat window kedua — gunakan `app.windows()` + pilih yang `webContents.getURL().endsWith('index.html')`. Opsional.

**M-10. Snapshot tidak pernah di-retensi.** Tabel `snapshots` tumbuh tanpa batas (satu baris per (target, run)); export = seluruh histori. Tidak ada tool “retensi” / “hapus snapshot lebih lama dari N bulan” / “eksport hanya hasil terakhir per target”. Pertimbangkan flag `export_mode: latest|all` (IPC + UI) + task housekeeping saat startup (`DELETE … WHERE id < …` dengan konfirmasi).

**M-11. `prev_*` delta di export melintasi seluruh waktu**, bukan per-periode/per-audit — `LAG()` dihitung `PARTITION BY target_id ORDER BY s.id` tanpa peduli audit; angka “Δ Views” membandingkan dengan run mana pun sebelumnya — semantik perlu didokumentasikan di `Rekap`/README, atau partisikan per audit.

**M-12. `getAudit` O(semua audit).** `getAudit` = `getAudits().find(id)` → menjalankan 5 subquery correlated + `cachedTargetCounts()` (T-5) untuk satu audit. Dipanggil tiap `updateAudit`. Perbaikan: `SELECT … WHERE a.id = ?` tunggal + cache.

**M-13. Caption-template flag = potensi false-positive massal.** `intel.js:96-101`: caption ≥40 char setelah buang hashtag, digit→`#`; caption generik viral (“korang goyang dikit aja yuk…”) bisa sama persis di puluhan akun lain; `MAX_FANOUT=50` mencegah ledakan edge, tapi dua akun viral yang tidak berhubungan tetap dapat `template`+2 poin dan masuk “Amati”. Perbaikan: naikkan bobot bukti/atau require ≥2 template berbeda, dan tampilkan di UI “template generik — verifikasi manual” (disclaimer sudah ada; perkecil juga q-flagg yang sepenuhnya otomatis).

**M-14. `npm audit`: uuid <11.1.1 (moderate) via exceljs.** `npm audit fix --force` menurunkan exceljs ke 3.4.0 (breaking) — tidak disarankan. Risiko riil rendah (exceljs memanggil `uuid.v4()` tanpa argumen `buf`); uuid diimpor untuk ID workbook. Catat, tunggu exceljs rilis, jangan paksa.

**M-15. Restore/migrasi belum ada strategi naik versi aplikasi.** Skema naik → DB lama di-upgrade hanya `avatar_url`. Audit ini tidak bisa membuktikan kolom lain pernah ditambahkan, tapi pola `PRAGMA user_version` mengharuskan setiap bump punya langkah migrasi + test round-trip (db v(n-1) → v(n)). Tambahkan test `restore dari dump user_version < SCHEMA_VERSION`.

**M-16. IPC tanpa validasi payload.** `data:accountDetail` (`payload.username` — lempar bila payload null/bukan objek), `db:restoreCommit` (`typeof filePath !== 'string'` sudah ada — baik), `data:latest` (`params.limit` dilewatkan langsung). Kecil, tapi setiap handler tulis sebaiknya validasi tipe + rentang (defense in depth; renderer adalah kode sendiri, namun ini juga memblokir bug masa depan).

**M-17. `createStorage.remove` menulis non-atomik** (`writeFileSync` langsung) dan saat ini **tidak dipakai** (dead) — salah satu dari dua: hapus method, atau buat konsisten tmp+rename seperti `set` (saya sarankan konsisten, dipakai `data:clearAll` di T-7).

**M-18. `will-navigate` pada main window mengizinkan file: yang cocok `RENDERER_INDEX`** — namun `RENDERER_INDEX` dihitung `replace(/\\/g,'/')` sedangkan `decodeURIComponent` dipanggil dua sisi; edge: path dengan karakter non-ASCII/URL-encoded (username Windows dengan aksen) bisa tidak pernah cocok → **semua** file: navigasi diblokir (termasuk reload diri sendiri?). Sebenarnya reload tidak memicu will-navigate; tapi `window.location.reload` dari devtools akan diblokir. Edge minor — gunakan `fileURLToPath` untuk membandingkan path, bukan URL string.

---

## 4. KECIL / KOSMETIK

- **F-1.** `fmtWhen`/`relTime` mem-parse string `YYYY-MM-DD HH:MM:SS` (claimed_at) sebagai **waktu lokal browser**, padahal kolom itu UTC (`db.js:630`, `CURRENT_TIMESTAMP`). Hanya dipakai di tooltip "Di-scrape" (`r.snapshot_at` — sebenarnya ISO Z, aman) — perbaiki `parseUtc`-style atau jangan tampilkan claimed_at.
- **F-2.** `.dark .badge.lv-pola_kembar|lv-pola_ternak` tidak didefinisikan → latar terang + teks gelap di dark mode (dapat dibaca, tidak konsisten). Tambahkan dua rules.
- **F-3.** `.avatar-fallback` tidak dipakai dari `avatarHtml()` `onerror` — gabungkan dengan K-3 fix.
- **F-4.** `MutationObserver` penambah `scope="col"` (`app.js:868-874`) — berfungsi, tapi `scope` bisa langsung ditulis di markup tabel; observer permanen menambah noise (minor).
- **F-5.** `loadProcess` ETA “≈ eta × 6 dtk” tidak sinkron dengan mode aktual limiter (1,5–10 dtk + istirahat) — tampilkan `limiter.getPaceLabel()` dari `worker.getStatus().rate` saja.
- **F-6.** `renderAudits` setelah aksi Edit/Hapus memanggil `loadAudits()`, tapi tab Pengaturan tidak auto-refresh 5-detik seperti dashboard — list bisa basi bila worker selesai di background. Tambah `settings` ke interval itu, atau panggil `loadSettings()` setelah event `data`.
- **F-7.** Tombol `#btn-retry-failed` & `#btn-export` menampilkan toast generik “Pilih audit dulu.” — fine, tapi tidak disabled; set `disabled` sampai `state.auditId` ada.
- **F-8.** `summary.success_rate` pembagi `scraped` termasuk FAILED → angka masuk akal; tapi `success_rate` tidak dihitung untuk `scraped=0` → `null` → renderer tampil “—” ✓.
- **F-9.** `share` selalu `null` dari scraper IG (tidak diekspos) — ER Instagram mengabaikan share ✓, tapi export tetap menampilkan kolom Share kosong; tambah catatan kolom di sheet Rekap (“Share: hanya TikTok”).
- **F-10.** `postRefFromUrl` regex pada `"reels/"` vs `"reel/"` — `/reels/CODE/` cocok `shortcode` regex ✓; OK.
- **F-11.** `getTargets` ORDER recent = `lt.id DESC` (id task terakhir) — target yang belum pernah di-run (PENDING, lt.id NULL) muncul terakhir — wajar.
- **F-12.** `index.html` — `<option value="">Semua audit</option>` dropdown `#global-audit` width tidak dibatasi; nama audit panjang menggeser `.page-actions`. `max-width: 260px` di `.select`.
- **F-13.** `build/icon.png` = `assets/icon.png` sama (5046 byte) — duplikat; tidak apa, tapi pertimbangkan satu sumber.
- **F-14.** `START_sunscrap.bat` menjalankan biner Electron unsigned (alasan SAC) — **otomatis berarti artifact di `release/` tidak ditandatangani**; Smart App Control akan memblokir installer untuk user lain. Untuk distribusi: signed build (code-signing cert) atau distribusikan `START` yang sama + dokumentasi — keputusan rilis, bukan kode.
- **F-15.** `.gitignore` — baik (release/, *.db, data/, node_modules). Tidak ada `*.tmp` — tambahkan `*.tmp-*` (sisa `backupDatabase` bila rename gagal).
- **F-16.** `audit-*.md` & `audit-menu-2026-11-05/` di-commit ke repo (~100 KB) — keputusan tim; tidak masalah, tapi pisahkan dari artifact rilis.

---

## 5. YANG BENAR (dan layak dipertahankan)

- **SQL 100% parameterized**; tidak ditemukan satu pun string-interpolasi input user ke SQL (semua `ORDER BY` dari peta statis).
- **Transaksi** `BEGIN IMMEDIATE` untuk semua path tulis multi-tabel; `claim/lock/reclaim/MAX_RETRIES` diuji (`db.test.js`).
- **allowlist host** diimpor dua kali (policy + import) — konsisten `instagram.com/tiktok.com` saja.
- **Worker window** sandbox + contextIsolation + no nodeIntegration; login window sama; `webviewTag` hanya untuk Browser tab & di-harden `will-attach-webview` (`sandbox`, strip preload).
- **CSP** `default-src 'self'; script-src 'self'` — tidak ada remote code; semua handler inline dihapus/didelegasikan (`data-close`).
- **`esc()`** di semua interpolasi innerHTML (termasuk atribut ber-“…”).
- **Export** sanitize formula (`= + - @ \t \r`) ✓.
- **`worker-state.json` & `window-state.json`** lewat tmp+rename (kecuali `remove` — M-17).
- **`node:sqlite`** dipakai langsung (tanpa native module) — menurunkan risiko supply-chain.
- **46 tes murni** jalan tanpa Electron — struktur baik; `db.test.js` menutup claim/reclaim.
- **Backup**: `VACUUM INTO` + temp + atomik rename + `integrity_check` saat restore + safety copy **sebelum** mengganti (urutan inilah yang rusak — K-1/K-2).
- **Single instance lock**, tray-first, jendela bisa ditutup tanpa mematikan app — desain yang benar untuk scraper panjang.
- **Rate limiter** sinkron, digrounding ke storage berkas — keputusan sadar (bukan chrome.*), dengan model mental yang jelas (budget/cycle, daily rail, session break, warm-up, fatigue, gaussian clamp).

---

## 6. Prioritas & estimasi

**P0 — hari ini (data-loss/bug fatal):** K-1 + K-2 (temp-then-swap restore, reject self-restore, pesan error memuat path safety) · K-3 (protokol avatar + `onerror` fallback) · K-4 (hapus avatar di clearAll/account/audit delete) · K-5 (guard `user_version`).

**P1 — minggu ini:** T-1 (avatar remote null + allowlist + magic bytes + CSP ketat) · T-2 (expose atau hapus `PROFILE`/`search`) · T-3 (CSV quoted-newline) · T-4 (query param pelacak) · T-5 (perf refresh) · T-6 (`getExportCount`) · T-7 (clearAll reset limiter) · T-8 (login OAuth allowlist) · M-1 (NaN bind + `.catch` renderer) · M-2 (LIKE escape) · M-3 (NaN delay).

**P2 — iterasi berikutnya:** M-4…M-18; test untuk worker/scraper/ipc/export (mock `scraper` di `worker.test.js`, `getExportRows` snapshot kecil); round-trip migrasi `user_version`; retention snapshot; export `latest|all`.

**Catatan uji:** audit ini menjalankan `npm test` (46/46) dan uji empiris sa-avatar & restore-self; `npm run e2e` (butuh GUI) tidak dijalankan — setelah P0 selesai, jalankan `npm run e2e` + satu uji manual “Pulihkan → pilih sunscrap.db aktif → harus ditolak” sebagai regresi wajib.

---

## 7. Lampiran — temuan per file

| File | Baris | Kode | Ringkas |
|---|---|---|---|
| src/main/db.js | 1615–1634 | K-1, K-2, K-5 | restore: self-destruct + unlink-before-copy + user_version stomp |
| src/main/db.js | 590–603, 573–588, 554–570 | K-4, T-7 | clearAll/deleteAccount/deleteAudit: avatar disk tertinggal; limiter state bertahan |
| src/main/db.js | 947–972, 1541–1543, 928–930 | T-5, T-6, M-12 | dead/heavy paths; getExportCount O(n); getAudit O(all) |
| src/main/db.js | 1590–1612, 1584–1586 | K-5, K-2 | inspectBackup baik tapi restore tak guard versi/swap |
| src/main/main.js | 21–23, 334–344, 204–227 | K-3, M-4, M-5, M-18 | protokol sa-avatar; overlay putih; x/y tak divalidasi; RENDERER_INDEX bandingkan |
| src/main/main.js | 41–71 | M-17 | createStorage.remove non-atomik (dead) — buat tmp+rename |
| src/main/worker.js | 20–28, 135–145 | T-1 | recordProfile menyimpan URL remote saat cache gagal |
| src/main/avatar.js | 15–31 | T-1 | fetch tanpa allowlist/cap/redirect check; tanpa magic bytes |
| src/main/ipc.js | 21–37, 60–64, 159–164, 234–244 | M-16, T-7 | validasi payload; clearAll harus reset limiter |
| src/main/import.js | 70–96 | T-3 | parseCsv memecah per newline sebelum menutup quote |
| src/main/util.js | 157–186 | T-4 | normalizeTargetUrl mempertahankan query pelacak |
| src/main/rateLimiter.js | 195–207 | M-3 | getDelay bisa NaN (u1=0 ∧ cos=0) |
| src/main/intel.js | 96–101, 148–162 | M-13 | caption-template false-positive massal |
| src/main/export.js | 137–143, 55–71 | T-10/M-11 | export seluruh histori; prev_* lintas waktu |
| src/renderer/app.js | 368–375, 846–865, 308–356, 518–529 | K-3, M-1, F-6, F-7 | avatar `<img>` tanpa onerror; promise tak di-catch; settings basi |
| src/renderer/index.html | 6 | — | CSP baik; `img-src https:` **jangan** pernah ditambah — pertahankan |
| src/scraper-content/tk-scraper.js | 309–344 | T-1/M | fetch API TikTok dari isolated world — sengaja, catat di README |
| scripts/monitor.js | 24–27, 12 | M-8 | dead var; nama DatabaseSync usang |

---

*Audit hanya membaca & menjalankan kode yang ada; tidak ada perubahan file yang dilakukan pada `src/`. Laporan ini melengkapi — bukan menggantikan — `AUDIT.md`, `AUDIT-v3-2026-11-04.md`, `AUDIT-UIUX-*.md`, dan `audit-menu-2026-11-05/`.*
