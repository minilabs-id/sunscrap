# Audit Mendalam — sunscraping Desktop

**Tanggal:** 4 Nov 2026 · **Fokus:** fungsi, kode, dan desain (bukan legal/proses rilis) · **Versi diaudit:** `package.json` v1.0.0 @ `ebbd424` + working tree (WIP "tempel link")
**Cara audit:** baca penuh ~5.000 baris (`src/main`, `src/preload`, `src/renderer`, `src/scraper-content`, `src/test`), jalankan `npm test` (34 pass / **1 fail**), uji perilaku fungsi murni via `node -e`, telusuri semua call-graph (IPC → db → intel), dan verifikasi klaim dengan referensi baris.

> Catatan status repo saat diaudit: 6 file termodifikasi + 1 file baru (`src/test/import.test.js`) belum di-commit; tes merah (`parseLinksText` menghitung trailing newline sebagai baris kosong).

---

## 1. Ringkasan eksekutif

Fundament-nya kuat: SQL parameterized di mana-mana, transaksi `BEGIN IMMEDIATE`, escaping HTML konsisten, allowlist host, claim/lock/reclaim yang benar, dan desain modul yang rapi (main/renderer/scraper-content terpisah, fungsi murni dipisah dari Electron agar bisa diuji). **Namun ada bug fungsional nyata, satu logika deteksi yang mati, satu false-positive deteksi "akun kembar" yang bisa menyalakan ribuan akun dalam satu kampanye, dan beban komputasi tak terkendali di jalur panas (per-task & per refresh dashboard).** Tidak ada satu pun yang membutuhkan tulis ulang — semuanya bisa diperbaiki inkremental.

**Skor kasar (per area):**

| Area | Nilai | Catatan |
|---|---|---|
| Kebenaran query & transaksi DB | B+ | hampir semua benar; beberapa path mutasi di read |
| Bug fungsional UI | C+ | tombol modal mati, filter target menipu |
| Logika mesin intel (deteksi ternak) | C | dead logic + false positive besar |
| Arsitektur & batas modul | B | bersih, tapi db.js terlalu monolitik |
| Performa jalur panas | C | full recompute per panggilan |
| Keamanan kode | B− | beberapa celah nyata, semuanya bisa ditutup |
| Keandalan (crash/restart) | B | lock/reclaim baik; backup & state file rapuh |
| Test | C | 1 merah; banyak fungsi murni belum diuji |

---

## 2. Bug fungsional (harus diperbaiki)

### F-01. Semua tombol `onclick="closeModal()"` mati karena CSP
`index.html:6` memasang `script-src 'self'`. CSP **memblokir seluruh inline event handler** tanpa pandang bulu — termasuk `onclick="closeModal()"` di semua modal (tutup ✕, "Batal", "Hapus?", dll.). Eksposur `window.closeModal = closeModal` (`app.js:541`) tidak berguna karena handler-nya sendiri tidak pernah dijalankan.
**Dampak:** modal tidak bisa ditutup via tombol; pengguna terjebak klik backdrop (yang memang terpasang listener) atau Esc (tidak ada handler Esc).
**Perbaikan:** delegasi global satu kali di `bindEvents()`:
```js
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeModal();
});
```
dan ganti semua `onclick="closeModal()"` → `data-close`. Tambahkan juga handler `keydown Escape → closeModal()`.

### F-02. Filter status "OK" dan "Sebagian" di tab Target tidak memfilter
`db.js:943-947` — `getTargets` hanya mengenali `done`, `failed`, `pending`, `running`. Nilai `ok` dan `partial` dari `<select id="target-status">` **jatuh tanpa kondisi** → mengembalikan seluruh target.
```js
if (s === 'done') ...
else if (['failed','pending','running'].includes(s)) ...   // 'ok' & 'partial' lolos diam-diam
```
**Perbaikan:** tambahkan cabang `ok → = 'OK'` dan `partial → = 'PARTIAL'`, plus tes regresi.

### F-03. Klik link postingan = jendela utama pindah situs
Anchor postingan (`app.js:160,166,220`, dll.) tidak punya `target="_blank"`, dan `mainWindow` tidak memasang `will-navigate`. Klik → dashboard digantikan situs IG/TikTok (di sesi *default*, logged-out) — aplikasi "hilang" tanpa navigasi balik. Handler `setWindowOpenHandler` hanya menangani window baru, bukan navigasi sesi ini.
**Perbaikan:** `mainWindow.webContents.on('will-navigate', ...)` → `preventDefault()` + `shell.openExternal(url)` (whitelist http/https), atau `target="_blank" rel="noopener"` pada semua anchor eksternal.

### F-04. Tes merah: `parseLinksText` menganggap baris terakhir `""` sebagai baris kosong
`import.js:187-197` — `'a\nb\n'.split(/\r?\n/)` → `['a','b','']` → `empty_rows = 2`, tes mengharapkan 1. Parser file (`parseCsv`) punya masalah berbeda (tidak memfilter baris kosong trailing dengan cara yang sama — lihat F-18), jadi konsisten-kan perilaku keduanya.
**Perbaikan (1 baris):** `String(text || '').replace(/\r?\n$/, '').split(/\r?\n/)`.
Juga: README mengklaim "32 tes" — setelah WIP ini ada 35 (34 pass / 1 fail).

### F-05. `SCRAPE_TIMEOUT_MS` didefinisikan, tidak pernah dipakai
`scraper.js:17` mendeklarasikan 45 000 ms — tidak ada `Promise.race` di `load()`/`call()`/`scrapePost()`. Halaman yang menggantung (jaringan, challenge IG) membuat worker berhenti progres tanpa batas; hanya error `loadURL` yang memecah loop.
**Perbaikan:** timeout menyeluruh per task (45 dtk) → `{status:'FAILED', errorCode:'TRANSIENT'}`; sekaligus log durasi scrape (ms) untuk telemetri.

### F-06. Backup database bisa menghasilkan file korup tanpa peringatan
`db.js:1495-1508` — jika `VACUUM INTO` gagal, fallback-nya **menyalin file `.db` mentah tanpa `-wal`**. Dalam WAL mode, data terbaru hidup di `-wal`; hasil salin basi/korup — dan pengguna mengira punya backup.
**Perbaikan:** hapus fallback file-copy; selalu `VACUUM INTO` (tersedia di SQLite ≥ 3.27, sudah pasti ada di Electron 35 / Node 22). Jika `VACUUM INTO` tidak tersedia, lakukan `PRAGMA wal_checkpoint(TRUNCATE)` dulu, baru salin. Gagal → lemparkan error (sudah ditangani IPC → toast).

### F-07. State worker (`worker-state.json`) ditulis non-atomik
`main.js:49` — `writeFileSync` langsung; crash di tengah tulis → JSON rusak → `init()` senyap fallback ke `{}` (budget harian/siklus hilang → platform bisa kena burst tak terkendali tepat setelah crash).
**Perbaikan:** tulis `worker-state.json.tmp` lalu `fs.renameSync` (atomik dalam satu volume, termasuk Windows).

### F-08. "Hapus semua data" tidak menghapus sesi login
`db.js:561` hanya me-`DELETE` tabel; cookie/token IG & TikTok di partisi `persist:sunscraping` tetap di disk (juga setelah uninstall). Ini bug fungsional terhadap janji "sepenuhnya lokal / hapus data".
**Perbaikan:** tombol/menu "Hapus sesi login (IG & TikTok)" → `session.fromPartition('persist:sunscraping').clearStorageData()` + konfirmasi.

### F-09. Injection HTML terbatas lewat `value="${btn.dataset.name}"`
`app.js:385` — `btn.dataset.name` mengembalikan string **ter-decode** (dari `&quot;` kembali ke `"`) yang lalu disuntikkan **tanpa `esc()`** ke atribut. Nama audit berisi `"><div ...>` merusak markup modal (dibatasi peran CSP dari eksekusi JS — bukan XSS penuh, tapi HTML injection / content spoofing).
**Perbaikan:** `value="${esc(btn.dataset.name)}"` (dan audit semua interpolasi yang membaca `dataset.*`).

### F-10. `parseLinksText` tanpa batas jumlah link
Jalur file membatasi 10 000 baris (`maxRows`); jalur tempel-link (`import.js:183`) **tanpa cap** — paste 200 000 baris masuk semua; `appendTargetsToAudit` tetap insert satu per satu. Ini self-DoS + bengkak DB.
**Perbaikan:** terapkan `maxRows` yang sama + laporkan `truncated`.

---

## 3. Bug logika mesin intel (deteksi akun ternak/kembar)

### L-01. Dead logic: band followers 20K–100K tidak pernah mem-flag
`intel.js:20-22` mendefinisikan `FLAT_FOLLOWER_BANDS = [[5K,20K],[20000,100000]]`, tetapi gate-nya (`intel.js:342`):
```js
if (monthValues.length >= 2 && followerDeltaPct !== null && inBand)   // inBand = TERNAK_BAND 5.000–20.000 SAJA
```
Untuk followers 25K–100K, `inBand === false` → seluruh cabang `followers_datar` tidak pernah jalan → entri kedua `FLAT_FOLLOWER_BANDS` adalah **kode mati**.
**Perbaikan:** hapus `&& inBand` dari gate (band sudah di-cek lagi di dalam via `bandFlat`), atau samakan definisi band. Tambahkan tes untuk kasus 50K datar.

### L-02. False positive besar: tanggal di bio ditokenisasi sebagai nomor telepon
`intel.js:35,72-91` — `PHONE_RUN_RE` + `_normalizePhone` mengubah bio `"Est. 2026.10.01, promo saban hari"` menjadi token `phone:20261001` (diverifikasi:
```
"Est. 2026.10.01" => ["phone:20261001"]
"Est 2026/10/01"  => ["phone:20261001"]
"since 20261001"  => ["phone:20261001"]
```). Dua akun yang meluncur di tanggal yang sama (mis. seluruh akun seeding satu kampanye pada hari yang sama) berbagi token → tertaut `kontak` (+3 poin) → cluster `strong` → auto `pola_ternak`.
**Perbaikan:** naikkan `BIO_CONTACT_MIN_DIGITS` ke ≥ 10–12 (nomor HP Indonesia ≥ 10 digit), **atau** wajibkan prefiks Indonesia (`08…` / `62…` setelah strip pemisah), **atau** buang kandidat yang lolos pola tanggal `YYYY{sep}MM{sep}DD` / `DD{sep}MM{sep}YYYY`. Tambahkan tes dengan bio berisi tanggal.
(Catatan: `01.10.1990` lolos karena setelah strip `0…` menyisakan 7 digit → ditolak — keberuntungan, bukan desain.)

### L-03. Skor risiko bisa negatif
`intel.js:357-363` — `score = flags.reduce(...)` lalu `is_verified` mengurangkan 1; akun tanpa flag + verified → **score = −1**. Level tetap `bersih` (floor 0), tetapi UI menampilkan "skor −1" dan sorting `risk` menaruh −1 di bawah 0 (berperilaku OK, hanya jelek/ambigu).
**Perbaikan:** `score = Math.max(0, score - 1)`.

### L-04. `audits_seen` menghitung `null` sebagai satu audit
`intel.js:427-430` — `appearance[key].audits.add(row.audit_id)` tanpa membuang `null` → target tanpa audit (seharusnya tidak ada, tapi defensif) menambah 1 hantu.
**Perbaikan:** `if (row.audit_id) entry.audits.add(row.audit_id)`.

### L-05. Komputasi template caption diduplikasi penuh
`intel.js:114-123` (`sharedCaptionTemplates`) dan `intel.js:175-182` (`findAccountLinks`) men-loop struktur yang sama dan membangun `byTemplate` **dua kali**. Untuk puluhan ribu post, ini kerja ganda yang signifikan di jalur yang dipanggil *setiap* refresh.
**Perbaikan:** hitung sekali, oper hasilnya; gabungkan fungsi.

### L-06. `siblings.sort` benar tapi tulisannya menipu
`db.js:1431` — `-(a.score || 0) + (b.score || 0)` ≡ `b.score - a.score` (descending — benar), tetapi terlihat seperti bug dan rawan "diperbaiki" menjadi salah.
**Perbaikan:** tulis eksplisit `(b.score || 0) - (a.score || 0)`.

### L-07. Level "curiga" di UI tumpang tindih dan berlebihan
`app.js:125` opsi `curiga` memanggil `getAccountIntel` dengan `level='curiga'` yang berarti `score ≥ RISK_FLOORS.pola_ternak` — **superset** dari opsi `pola_ternak` (level persis `pola_ternak`). Dua opsi yang saling tumpang tindih; `pola_kembar` juga selalu ikut terpilih di `curiga`.
**Perbaikan:** pilih salah satu: (a) hapus opsi `curiga`, atau (b) definisikan `curiga` sebagai `amati ≤ score < pola_ternak` (window, bukan floor).

---

## 4. Desain & arsitektur

### D-01. `getDashboardStats()` di jalur panas worker — dan ia *menulis*
`worker.js:253` memanggil `db.getDashboardStats()` **setiap tick** hanya untuk dapat `PENDING + RUNNING`. Biaya aktual:
1. `reclaimExpired()` → UPDATE + `recordSnapshot` (INSERT) **saat "membaca" stats** — read path yang memutasi DB;
2. CTE `latest_tasks` dengan `ROW_NUMBER()` di-`PARTITION BY` dan sort seluruh `tasks` join `targets` — O(N log N) per panggilan, N = seluruh riwayat task.
Dengan 20 000 task historis, setiap iterasi loop worker membayar sort penuh + potensi write. Pada `pendingCount` yang cuma butuh dua angka.
**Perbaikan:** ganti dengan `SELECT COUNT(*) FROM tasks WHERE status IN ('PENDING','RUNNING')` (pola yang sama sudah dipakai `enqueueRun`, `db.js:383`); pindahkan `reclaimExpired()` ke pemanggil write-path saja (`getNextTask` sudah memanggilnya — hapus dari stats, atau pertahankan di stats tapi jangan dipanggil worker).

### D-02. "Read" yang memutasi: pola menyebar
Selain D-01: `getNextTask()` memanggil `autoEnqueueDue()` (membuat run terjadwal baru) dan `finalizeStaleRuns()` saat antrean kosong — operasi write tersembunyi di klaim. `getDashboardStats` memanggil `reclaimExpired`. Secara desain, pemisahan command/query bocor: pemanggil tidak bisa tahu bahwa "baca" menulis.
**Perbaikan:** ekstrak eksplisit — `db.reclaimExpired()`, `db.autoEnqueueDue()`, `db.finalizeStaleRuns()` dipanggil worker/boot secara sadar; query getters bersih (pure). Sekalian: getters jadi aman di-memoize (D-03).

### D-03. `getAccountIntel()` full-recompute per panggilan (O(seluruh DB))
`db.js:1312-1394` memuat **semua** `accounts`, `account_posts`, `account_history`, `targets` ke memori lalu menjalankan `findAccountLinks` (pairing konten/kontak/template/serentak) + `buildClusters` (union-find) + `analyseAccount` per akun — **setiap kali**, termasuk untuk `limit: 5` di `loadRiskAccounts()` yang dipanggil setiap refresh dashboard.
**Perbaikan (bertahap):**
1. **Memoisasi dengan invalidasi generasi**: counter `dbGeneration` dinaikkan setiap write; intel snapshot di-cache per generasi (hilang valid karena worker berjalan terus — tapi berlaku untuk burst refresh UI).
2. **Filter sebelum komputasi**: untuk `limit=5, sort='risk'` tetap harus hitung semua (skor global) — jadi (1) adalah yang tepat; alternatif: tabel `account_intel_cache` termaterialisasi, di-refresh incremental per profile-visit.
3. `getAccountDetail` idem — butuh snapshot global untuk siblings; gunakan cache yang sama.

### D-04. `getAudit()` = O(seluruh audit) per panggilan
`db.js:893-895` — `getAudits().find(...)` menghitung ulang semua audit **beserta `cachedTargetCounts()`** (query `EXISTS` korelasi berat, `db.js:864-877`). Dipanggil dari `updateAudit` (return), pengaturan, dsb.
**Perbaikan:** `SELECT a.*, ... FROM audits a WHERE a.id = ?` + `cachedTargetCounts(auditIds=[id])` (parameterize).

### D-05. `db.js` monolitik (1.533 baris, satu closure)
Satu fungsi `createDatabase` berisi skema, migrasi, klaim task, agregasi, intel-glue, export-glue, backup. Konsekuensi: review sulit, konflik merge, batas tanggung jawab kabur (mis. `enqueueProfileVisits` di baris 489 memutasi state **global** `accounts` lintas audit — lihat D-06).
**Perbaikan:** pecah per domain menjadi modul internal (`db/schema.js`, `db/audits.js`, `db/targets.js`, `db/accounts.js`, `db/snapshots.js`, `db/admin.js`) yang menerima `conn` + helper — `createDatabase` tinggal merangkai. Tanpa mengubah API publik `db.*` yang dipakai IPC/worker.

### D-06. Efek samping lintas-audit di operasi per-audit
`db.js:489` — `enqueueProfileVisits(auditId)` menjalankan `UPDATE accounts SET needs_visit = 1 WHERE follower_count IS NULL AND post_count IS NULL` **untuk seluruh dunia**, bukan hanya username milik `auditId`. Menekan tombol "kunjungi profil" di satu audit mengubah kandidat kunjungan audit lain.
**Perbaikan:** batasi `UPDATE` ke username yang muncul di `targets` audit tersebut (`WHERE username IN (SELECT DISTINCT username FROM targets WHERE audit_id = ? ...)`).

### D-07. Tidak ada migrasi skema nyata
`SCHEMA_VERSION = 5` (`db.js:25`) hanya ditulis ke `PRAGMA user_version` (`db.js:153`) — tidak pernah dibaca. Semua evolusi skema mengandalkan `CREATE TABLE IF NOT EXISTS`. Saat kolom/tabel berubah di v1.1, pengguna v1.0.0 tidak punya jalur naik (mis. tambah `tasks.error_code` ke DB lama → query baru gagal).
**Perbaikan:** runner migrasi minimal: `const MIGRATIONS = {5: [...], 6: [...]}; for (v = userVersion+1; v <= SCHEMA_VERSION; v++) run(v)`; simpan `user_version` sebagai gerbang; tes "upgrade dari v5 fixture".

### D-08. Dua format waktu bercampur tanpa guard
`scraped_at` ISO (`...Z`), `created_at`/`claimed_at`/`locked_until` SQL UTC (`YYYY-MM-DD HH:MM:SS`). `parseUtc` (`util.js:27-45`) menjembatani, tapi perbandingan string langsung (`ORDER BY scraped_at`, `locked_until < CURRENT_TIMESTAMP`) hanya aman karena kebetulan konsisten internal. Kolom baru gampang salah zona/format.
**Perbaikan:** standar tunggal ISO UTC untuk semua kolom waktu baru; kolom legacy dipertahankan tapi dibungkus view/normalisasi; tambahkan tes lintas-format di `util.test.js` (sebagian sudah ada).

### D-09. Kode mati & ekspor tak terpakai
- `getTargetWithAudit` (`db.js:1056`), `getAccountProfile` (`db.js:1438`) — tidak dipanggil dari mana pun (tidak diekspos preload; tidak dipakai internal).
- `module.exports._constants` (`db.js:1533`) dan `db.constants` (`db.js:1528`) — tidak dipakai.
- Parameter `cursorless = null` di `cachedTargetCounts` (`db.js:864`) — sisa refactor.
- `utcNow` (`util.js:9`) — diekspor, tidak dipakai.
- `sharedCaptionTemplates` diekspor (`intel.js:463`) — dipakai tes, tetapi komputasinya **diduplikasi** di `findAccountLinks` (lihat L-05/M-04).
**Perbaikan:** hapus, atau tandai `@internal` dan pakai tes. Dead code membebani review & reviewer berikutnya.

### D-10. Tidak ada batas atas sekaligus tidak ada retensi
Tidak ada kebijakan retensi snapshot (DB tumbuh selamanya), tidak ada batas ukuran backup, tidak ada arsip per periode. Untuk pemakaian bulanan (~500 target × 12 bulan ≈ 6 000 snapshot) tidak masalah; untuk pemantauan harian 5 000 target, DB membengkak dan `getSummary` makin lambat (lihat P-03).
**Perbaikan:** (v1.1+) `PRAGMA incremental_vacuum`, retensi snapshot > N bulan opsional di Pengaturan, dan `VACUUM` setelah `clearAll`.

### D-11. "State" worker tidak disatukan
Status worker tersebar: memori `state` (worker.js), `limiter` (memori + json), DB (`tasks`). `getStatus()` merakit `{...limiter.getStatus()}` — sehat, tapi `label` ('memproses' vs 'menunggu antrean') ditentukan dengan heuristik (`busy`), bukan fakta antrean; UI bisa menampilkan "menunggu antrean" padahal idle karena budget habis (stop dipanggil, tapi `label` tetap 'berhenti' via `lastError` — masih OK). Minor; dokumentasikan invariant atau gabungkan `phase: 'idle'|'claiming'|'scraping'|'paused'|'stopped'`.

### D-12. Konfigurasi tersembunyi & tidak bisa diatur pengguna
Budget 500/siklus, rel harian 2 000, jeda 3–10 dtk, recycle 120 halaman (`scraper.js:18`) — semua hardcoded. Untuk alat internal itu **fitur keselamatan yang benar** (jangan diekspos sembarangan). Tapi tidak ada `config.json` untuk hal yang wajar diatur: bahasa UI (semua string Indonesia di-hardcode termasuk `error_message` yang disimpan ke DB), folder backup default, nama tray.
**Perbaikan:** biarkan budget dikunci; eksternalisasi sisanya ke `userData/config.json` bila butuh.

### D-13. Tidak ada logging terstruktur / jejak crash
`log()` → `console.log` saja; crash worker/scraper hilang permanen setelah restart. Saat pengguna melapor "worker berhenti, tidak tahu kenapa", tidak ada bukti.
**Perbaikan:** logger file rotasi sederhana (`userData/logs/sunscraping-YYYYMMDD.log`, maks 5 × 2 MB), level info/warn/error, include `taskId`, `runId`, `durationMs`, `errorCode`. Jangan log konten PII.

---

## 5. Performa & skalabilitas (kuanti)

### P-01. Biaya per task — yang sebenarnya
Satu POST task menempuh: 1 navigasi post (wajib) + **hingga 2 navigasi profil** (`ensureHarvested` bila cache follower kosong + `enrichFollower` bila masih kosong). Dengan cache dingin, tugas pertama per akun = 3 halaman; hangat = 1 halaman + cache hit. Desain cache-nya benar (TTL 7 hari akun, 12 jam post); yang perlu dipantau adalah **cache hit rate** — tidak ada metriknya. Tambahkan counter `cacheHit`/`profileVisit` per siklus ke `getStatus()`.

### P-02. `getTargets` / `getSummary` — scan + window functions per panggilan
Keduanya memakai `ROW_NUMBER() OVER (PARTITION BY target_id ...)` di atas **seluruh** `tasks`/`snapshots` tanpa filter `target_id` — SQLite harus sort semua. Index `idx_tasks_run (run_id, status)` tidak membantu `PARTITION BY target_id`; **tidak ada index `tasks(target_id, id)` maupun `snapshots(target_id, id)`** — tunggu, ada: `idx_snapshots_target (target_id, id)` dan implicit? Untuk tasks: `idx_tasks_audit (audit_id, status)`, `idx_tasks_run`, `idx_tasks_status` — **tidak ada `idx_tasks_target`**. Query `ROW_NUMBER PARTITION BY target_id` di `latest_tasks` akan temp-b-tree sort.
**Perbaikan:** `CREATE INDEX idx_tasks_target ON tasks(target_id, id)` — mempercepat semua `getTargets`, `getSummary`, `getDashboardStats`, `retryFailedTargets`. Ukuran DB sedikit naik; layak.

### P-03. `cachedTargetCounts()` — correlated EXISTS berat
`db.js:866-875` — untuk setiap `targets`, jalankan EXISTS subquery dengan tiga perbandingan string (`post_url = url`, `rtrim`, `substr/instr`). Tanpa index pada ekspresi, ini full/lookup-per-row pada `account_posts(fetched_at)`. Index `idx_account_posts_url` membantu hanya untuk cabang pertama; dua sisanya tidak.
**Perbaikan:** hitung sekali saat import/record (kolom `targets.cached_at`), atau batasi scope ke audit yang aktif dilihat (`WHERE t.audit_id = ?`), atau drop estimasi ini (tampilkan estimasi kasar tanpa cache-hit) — ukur dulu dengan `EXPLAIN QUERY PLAN`.

### P-04. `getSummary(null)` penuh untuk tab Proses
`loadProcess()` (`app.js:329`) memanggil `getSummary(state.auditId)` — tanpa audit dipilih = **agregasi seluruh DB** — hanya untuk mengisi 4 KPI antrean. Seharusnya: query khusus `COUNT` (lihat D-01).
**Perbaikan:** `db.getQueueStats()` ringan: `{pending, running, ok, failed}` via satu `COUNT(*) ... GROUP BY`.

### P-05. Refresh Renderer berganda
Dua kanal memicu refresh: event `data` (debounce 400 ms, `app.js:469-472`) + `setInterval` 5 s (`app.js:538`). Keduanya memanggil `getSummary` penuh. Saat worker menulis tiap 3–10 s, user membayar full-scan hampir setiap beberapa detik, sekalipun di tab "Pengaturan" (refreshDashboard ter-guard `state.tab==='dashboard'` — bagus — tapi `refreshWorker()` jalan terus; itu ringan).
**Perbaikan:** satu kanal saja (event-driven, naikkan debounce ke 1,5–2 s); untuk angka antrean di Proses pakai P-04; `getTargets` hanya saat tab aktif (sudah).

### P-06. `accounts` tab: limit 200 tanpa pager
`app.js:281` `limit: 200`, tanpa paginasi; 500+ akun → sisanya tak terlihat dan `sorted by risk` memotong yang paling penting. Server-side sort/paginate sudah didukung DB (`offset`) — UI yang belum.
**Perbaikan:** pager seperti Target, atau infinite scroll; tampilkan `total`.

---

## 6. Keandalan & konkurensi

### R-01. Klaim task vs crash — benar, dengan satu lubang
Pola klaim (`db.js:577-611`): `BEGIN IMMEDIATE` → baca PENDING → `UPDATE status='RUNNING' locked_until=+5m` → COMMIT. Crash setelah klaim → task menggantung maks 5 menit → `reclaimExpired` memulihkan (→ PENDING, retry≤3 → FAILED + snapshot). **Baik.** Lubang: task yang dilaporkan `FAILED/TRANSIENT` kembali PENDING tanpa `retry_count` naik di *reclaim* path — sebenarnya `reclaimExpired` menaikkan `retry_count` (`db.js:229-241`) — OK. Lubang sesungguhnya: `updateTaskResult` hanya menerima `status='RUNNING'` — hasil terlambat (melewati reclaim) ditolak diam-diam (`return false`) dan **tidak ada snapshot ditulis**. Data target hilang satu kunjungan, tanpa jejak.
**Perbaikan:** log + counter `lateResults`; bila task sudah di-reclaim, tetap `recordSnapshot` dengan flag `late:true` atau minimal `say()` — sekarang benar-benar senyap.

### R-02. `processTask` exception → FAILED TRANSIENT — tapi snapshot tercatat ganda?
`worker.js:157-159` → result `FAILED/TRANSIENT` → `db.updateTaskResult` → TRANSIENT + retry_count<3 → status **PENDING**, namun `recordSnapshot` **tetap** dipanggil dan menulis snapshot FAILED dengan metrik null. Artinya satu task yang gagal lalu sukses punya 2 snapshot (FAILED lalu OK) — benar untuk riwayat; tapi `getExportRows`/`attempt_rn=1` sudah menangani (mengambil attempt terakhir per (target,run)) — OK. Catat: metrik `failed` di KPI menghitung target yang **akhirnya sukses** sebagai pernah gagal — benar historis, jangan "diperbaiki".

### R-03. `blockedInARow` di-reset hanya saat `start()` & sukses
`worker.js:206,228` — benar (3 BLOK beruntun → stop). Cache-hit (`charge==='none'`) **tidak** me-reset maupun menambah `blockedInARow` — benar. Tapi `limiter.reportSuccess()` untuk hasil `PARTIAL` (charge success) mereset backoff & `consecutiveErrors` — PARTIAL berarti "halaman terbaca tapi metrik nol" — boleh dianggap sukses untuk purposes backoff; dokumentasikan.

### R-04. Jendela worker: kematian render process
`scraper.js:70-74` — `render-process-gone` → destroy + null → berikutnya recreate. Pending `executeJavaScript` (di `call()`) kemungkinan besar reject — ditangkap `processTask` catch → FAILED TRANSIENT. **Namun** `load()` yang sedang `await win.loadURL` saat process mati: promise `loadURL` reject dengan `ERR_…` — ditangani (`ERR_ABORTED` di-swalow; yang lain di-throw) → OK. Tidak ada leak window (closed → null). Bagus.
Satu celah: jika `render-process-gone` terjadi *di antara* `loadURL` resolve dan `executeJavaScript`, objek `win` dipegang `call()` bisa destroyed mid-flight → exception → ditangkap → FAILED. Aman, tapi tambahkan cek `workerWindow.isDestroyed()` sebelum inject agar error lebih jelas.

### R-05. Atomisitas tulis ganda "snapshot + target" & "accounts + history"
`recordSnapshot` (UPDATE targets) dipanggil dalam transaksi task (`updateTaskResult` BEGIN…COMMIT) — konsisten. `recordAccountProfile` sama. Bagus. Tapi `reclaimExpired` memanggil `recordSnapshot` **di dalam iterasi** tanpa transaksi pembungkus — kalau crash di tengah loop reclaim, sebagian task di-update, sebagian belum — sebenarnya **idempotent** (rerun reclaim), jadi aman; tetap bungkus `BEGIN IMMEDIATE` agar rapi & cepat (satu fsync).

### R-06. `worker-state.json` hilang saat ganti mesin / restore DB
Backup `.db` tidak membawa state throttle → restore di PC lain = budget harian "segar". Tidak masalah (itu justru aman), dokumentasikan: restore DB ≠ restore sesi/batas.

### R-07. `window-all-closed` no-op + tray — sengaja, tapi jebakan
App tetap hidup di tray tanpa jendela; `before-quit` mencegah keluar lalu shutdown lalu `app.exit(0)`. Jika shutdown menggantung (db.close exception ditelan), tetap exit — baik. Kritik: **tidak ada indikasi saat updateTray gagal** (semua `catch {}`); pengguna bisa melihat status basi. Log warn minimal.

---

## 7. Keamanan kode (fokus implementasi, bukan kebijakan)

### S-01. `http:` diizinkan di allowlist scraper & import
`policy.js:34-41` dan `normalizeTargetUrl` (`util.js:173`) menerima `http:` — navigasi polos ke `http://www.instagram.com/...` → sesi & cookie lewat plaintext (jika MITM).
**Perbaikan:** syaratkan `https:` di keduanya (import sudah memaksa `https:` pada canonical — selisih ini hanya untuk worker/redirect).

### S-02. `will-attach-webview` tidak mengunci partisi / destinasi
`main.js:202-207` memaksa `nodeIntegration:false`, `contextIsolation:true`, hapus preload — bagus. Tapi webview Browser (`index.html:157`) bebas `src` ke situs mana pun **dalam partisi login yang sama**; cookie IG/TikTok adalah domain-scoped (tidak bocor ke situs lain), tetapi aplikasi secara efektif adalah browser umum dengan sesi tertanam — bertentangan dengan allowlist yang diklaim.
**Perbaikan (nilai tambah, murah):** di `will-attach-webview`, paksa `webPreferences.partition = 'persist:sunscraping'` (cegah partisi lain) dan di renderer batasi `loadURL` ke allowlist host (regex sama dengan `policy.js` — duplikasikan sebagai konstanta di preload-safe module atau validasi di IPC `app:openExternal`). Tampilkan tombol Browser hanya untuk host IG/TikTok; sisanya buka eksternal.

### S-03. Popup login OAuth pihak-3 dilempar ke browser luar
`scraper.js:147-151` — popup hanya diizinkan bila `allowedTarget(url)`; popup `facebook.com` / `accounts.google.com` (umum untuk "Masuk dengan Facebook") → dibuka via `shell.openExternal` → pengguna login **di browser eksternal**, sesi app tidak pernah terbentuk → "Login berhasil" di luar app, worker tetap AUTH.
**Perbaikan:** daftar putih popup OAuth (`facebook.com`, `accounts.google.com`, `appleid.apple.com`, `login.microsoftonline.com`) yang diizinkan **dibuka di dalam jendela login** (bukan eksternal).

### S-04. `openExternal` tanpa pembatasan host
`ipc.js:19-24` dan `main.js:93-96` menerima semua `http(s)`. Risiko rendah, tapi percuma — persempit ke host IG/TikTok + OAuth; tolak sisanya dengan log.

### S-05. Export CSV/Excel — formula injection sudah ditangani, satu celah tersisa
`export.js:37-42` — semua sel Data dan `Nilai` Rekap di-sanitize (prefix `'`). Sel yang **tidak** disentuh: `Bagian`, `Label`, `Keterangan` — semuanya konstanta internal, aman. Caption dari scrape yang diawali `=`/`+`/`-`/`@` → aman. **Aman secara keseluruhan**; tambahkan tes untuk `sanitizeCell` (ada? cek `src/test` — tidak ada test export). Tambahkan `export.test.js` minimal: formula prefix, delta, ER.

### S-06. Path backup via dialog — tidak overwrite-check
`db:backup` menulis ke path pilihan user tanpa cek eksistensi → file lama tertimpa diam-diam (dialog save biasanya konfirmasi — OK di Windows). Biarkan, tapi jangan auto-overwrite dari fitur "backup otomatis" nanti.

### S-07. `VACUUM INTO` dengan escape manual
`db.js:1501` — `'` digandakan — benar. Tetap rawan bila `destination` mengandung karakter aneh yang lolos escape? Escape `''` adalah satu-satunya kebutuhan di string literal SQLite — aman. Sederhanakan dengan menghapus fallback (F-06) sehingga satu jalur saja.

### S-08. Data PII publik tersimpan lokal — tanpa enkripsi at-rest
DB berisi bio (sering memuat nomor/email — memang dipakai deteksi L-02), caption, display name. Penyimpanan lokal tanpa enkripsi = standar untuk app sejenis, tapi dokumentasikan dan pastikan `.gitignore` menutup `*.db*` (sudah). **Jangan** tambah fitur "sync cloud" tanpa enkripsi.

---

## 8. Kualitas kode & maintainability (temuan detail)

| # | Temuan | Lokasi | Saran |
|---|--------|--------|-------|
| M-01 | `siblings.sort` dengan negation membingungkan | `db.js:1431` | tulis `(b.score||0)-(a.score||0)` |
| M-02 | Fungsi `getDashboardStats` 75 baris, banyak tanggung jawab | `db.js:897-922` | pisahkan agregasi status vs target/snapshot counts |
| M-03 | `getSummary` ~145 baris, 15+ akumulator manual | `db.js:1080-1224` | pecah per-seksi (kpi/platforms/accounts/temas/quality) jadi helper kecil yang menerima `rows` |
| M-04 | Duplikasi `sharedCaptionTemplates` vs `findAccountLinks` | `intel.js:114-123,175-182` | hitung `byTemplate` sekali |
| M-05 | Magic strings status ('OK','PARTIAL','FAILED','PENDING','RUNNING') tersebar | db.js, worker.js, policy.js | `const STATUS = {...}` freeze, ekspor |
| M-06 | `norm(undefined→null)` tapi tidak `NaN→null` | `db.js:37-39` | bind `NaN` → SQLite error; normalisasi `Number.isNaN → null` |
| M-07 | Error `catch {}` senyap (±20 titik) | main.js, scraper.js, renderer | minimal `say()`/counter; jangan telan tanpa jejak |
| M-08 | `rowsFromXlsx` — sel hyperlink dengan teks tampilan (`{text, hyperlink}`) memakai **teks**, bukan URL | `import.js:20-29` | jika `cell.hyperlink` ada dan `text` bukan URL, pakai `hyperlink` (banyak CSV/XLS "klik di sini") |
| M-09 | `pickColumn` — header "User ID" cocok hint `user` (bukan "USER_HEADER_EXCLUDE")? "user id".includes('user') → ya; dan tidak dikecualikan (exclude hanya agent/email/bio) → kolom `user_id` bisa dipilih sebagai username → isi angka → `cleanUsername` lolos (huruf/angka) → username "12345" | `import.js:12-47` | tambah excl `id`, `uuid`, `uid` — atau prioritaskan exact `username` |
| M-10 | `cleanUsername` membuang `(TikTok)` via `USERNAME_JUNK` — tapi tidak men-strip zero-width/format chars | `util.js:60-68` | strip `[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]` |
| M-11 | `postRefFromUrl` — fallback `tail` cocok segmen terakhir path apa pun (mis. `/photo/` → `photo`?) — untuk URL tanpa match, tail = kata terakhir path | `util.js:210-220` | untuk IG/TikTok post path selalu match; non-match seharusnya `null` (jangan menebak "photo") |
| M-12 | `cachedTargetCounts(cursorless=null,…)` parameter mati | `db.js:864` | hapus |
| M-13 | Renderer: `fmt()` tanpa pembulatan eksplisit — float tampil `1.234,567` | `app.js:20-23` | `Math.round` untuk entitas hitungan |
| M-14 | Renderer: `loadAccounts` hardcoded `sort:'risk'`, tanpa kontrol UI | `app.js:280` | dropdown sort (risk/followers/reach/posts) + pager |
| M-15 | Renderer: filter global audit tidak meng-refresh tab Target/Akun | `app.js:478` | panggil `loadTargets()`/`loadAccounts()` saat `#global-audit` berubah |
| M-16 | Toast "Dicek export …" kalimat rusak | `app.js:501` | "Export selesai: N baris." |
| M-17 | "Ulangi terpilih" aktif tanpa audit terpilih → klik diam | `app.js:492-497` | toast "Pilih audit dulu" bila `!state.auditId` |
| M-18 | Duplikat dashboard via tray "Buka dashboard" & `activate` | `main.js:106,198` | reuse/focus `mainWindow` bila ada |
| M-19 | `getCompare` — memilih periode lama diam-diam menggeser periode terbaru keluar (`slice`) | `db.js:1230-1232` | pertahankan `selected` + terbaru sejumlah `months`, jangan geser diam-diam |
| M-20 | `searchData` — wildcard `LIKE` tidak di-escape | `db.js:1295-1308` | `ESCAPE '\'` + escape input |
| M-21 | `createAuditWithTasks` tidak mengembalikan jumlah baris invalid (hanya lewat parser) | `db.js:310-343` | return `invalid` juga; IPC tinggal meneruskan |
| M-22 | `clearAll` tidak reset `sqlite_sequence` | `db.js:561-572` | `DELETE FROM sqlite_sequence` |
| M-23 | `importLinks` error message menyertakan `invalid_urls` mentah — baik — tapi tidak ada cap (F-10) | `ipc.js:89-110` | cap + `truncated` flag |
| M-24 | `worker:login` tidak memvalidasi `platform` | `ipc.js:30-33` | whitelist `['instagram','tiktok']` |
| M-25 | `data:accountDetail` — `payload` tanpa guard tipe | `ipc.js:40` | cek objek & string |

---

## 9. Robustness scraper & strategi terhadap platform yang berubah

### Q-01. Fragilitas selector = risiko utama, belum ada deteksi dini
IG/TikTok mengganti markup/endpoint tanpa pemberitahuan; app akan terus jalan dan menghasilkan `PARTIAL`/`FAILED` massal atau **(lebih berbahaya)** `OK` dengan angka `null` yang difilter jadi `PARTIAL` — setidaknya berhenti jadi OK kosong (bagus: `updateTaskResult` menurunkan OK tanpa metrik → PARTIAL). Tetap tidak ada sinyal "scraper rusak".
**Perbaikan:** metrik kesehatan per 50 kunjungan terakhir: `ok_rate`, `partial_rate`, `auth_rate`, `throttled_rate` per platform; tampilkan di Proses; jika `partial_rate > 50%` dalam 20 task terakhir → notifikasi "Selector kemungkinan usang". Data sudah ada — tinggal agregasi.

### Q-02. Tidak ada ablasi fitur / kill-switch per platform
Jika TikTok memblokir total, worker terus mencoba; `blockedInARow` menghentikan setelah 3 — bagus — tapi `PARTIAL` beruntun (bukan THROTTLED/AUTH) **tidak** menghentikan apa pun.
**Perbaikan:** hitung `partialStreak`; hentikan sementara dengan alasan eksplisit setelah N (mis. 15) PARTIAL beruntun, beri tahu pengguna.

### Q-03. `fetchItemListPosts` memanggil endpoint internal TikTok
`tk-scraper.js:308-343` — `fetch('https://www.tiktok.com/api/post/item_list/...', credentials:'include')` — bergantung pada sesi & endpoint privat yang bisa hilang sewaktu-waktu. Fallback `gridPosts()` ada — bagus. Tambahkan logging sumber post (`postSource: 'item-list' | 'grid'`) ke DB (`account_posts` tidak menyimpan `postSource` — hilang).
**Perbaikan:** simpan `post_source` di `account_posts` (migrasi v6 — lihat D-07) atau minimal log.

### Q-04. Recycle window 120 halaman — lalu?
`scraper.js:17-18,87-93` — setelah 120 load, window di-recycle (mitigasi memory leak Chromium). Bagus. Tidak ada batas umur untuk **jendela login** (dibiarkan terbuka selamanya) — tidak masalah, tapi tambahkan "tutup semua jendela login saat quit" (sekarang `dispose()` hanya menghancurkan worker window; jendela login yang terbuka **tetap hidup** setelah app quit? `before-quit` → `app.exit(0)` mematikan proses → semua jendela mati. OK.)

### Q-05. Isolated world ID 999 + dua langkah injeksi
Desain bagus (tidak polusi main world). `inject()` memeriksa `__saScrapePost` sebelum menyuntik ulang — benar untuk navigasi berulang dalam satu window. Catatan: setelah `render-process-gone` + recreate, isolated world baru → inject ulang — benar karena `inject()` selalu dipanggil di `call()`.

### Q-06. Timeout `waitForSelector` 7–8 dtk + `setTimeout` fixed 250–500 ms — heuristik
OK untuk pacing, tapi jika DOM tidak pernah muncul, total tambahan ~8–9 dtk/post — wajar. Tidak ada paralelisasi (sengaja, demi anti-bot) — jangan ditambah paralel tanpa analisis ToS.

---

## 10. Testing — celah

Saat diaudit: **34 pass, 1 fail** (F-04). Fungsi murni teruji: db (happy path), policy, rateLimiter, taskCache, intel, util, import (WIP). Belum ada tes untuk:

1. **`intel.js` — kasus batas**: `analyseAccount` dengan followers=0 (division guard), verified score floor, `FLAT_FOLLOWER band 50K` (akan menangkap L-01), token tanggal (menangkap L-02), `buildClusters` multi-cluster + alasan union, `findAccountLinks` sync-bucket lintas 2 akun.
2. **`db.js` — jalur gagal**: `updateTaskResult` pada task non-RUNNING (harus false), `reclaimExpired` setelah lock basi (FAILED + snapshot TRANSIENT), `retryTargets` dengan id sampah/duplikat/>200, `enqueueRun` saat pending>0 (`pending:true`), transaksi rollback saat exception (injeksi error), `deleteAudit` cascade.
3. **`export.js`**: formula-prefix sanitize, delta math, ER per platform.
4. **`import.js`**: CSV multiline-quoted (mendokumentasikan limitasi M-08), XLSX hyperlink cells, header duplikat, BOM+cp1252 (ada), kolom username "user id" (M-09).
5. **`policy.js`**: `outcomeOf` untuk `source==='profile-visit'` (charge none), `stop` tepat pada blok ketiga (ada? `rateLimiter.test` tidak mencakup policy — cek `policy.test.js` — ada sebagian; tambahkan kasus cache-hit).
6. **Integrasi**: import → enqueue → klaim → hasil → export — satu tes end-to-end dengan DB `:memory:`.

**Perbaikan:** target ≥ 60 tes; semua jalur `catch` di db.js tersentuh; tes regresi untuk setiap bug di laporan ini.

---

## 11. Temuan yang sudah BAIK (jangan diubah)

- **Parameterized everywhere** — tidak ada string concatenation untuk nilai; ORDER BY di-whitelist.
- **Transaksi `BEGIN IMMEDIATE`** di semua multi-write; rollback bersih; idempoten di beberapa titik.
- **Claim/lock/reclaim** task — benar, termasuk `MAX_RETRIES` dan snapshot saat abandon.
- **Escaping UI** via `esc()` — tidak ditemukan injeksi HTML dari data DB (selain F-09).
- **CSP** ada dan ketat (`default-src 'self'`; script tanpa unsafe-inline).
- **Sandbox**: jendela worker & login `sandbox:true, contextIsolation:true, nodeIntegration:false`; `webviewTag` hanya di jendela utama; `will-attach-webview` mengunci preferensi guest.
- **Allowlist host persis** + `will-navigate` pada worker window.
- **Formula injection** di export dimitigasi.
- **Deteksi metrik** berlapis (meta → JSON-LD → hidden JSON → DOM) — resilien.
- **Rate limiter** berlapis & persist — desain dewasa.
- **Cache** akun (7 h) & post (12 jam) mengurangi navigasi — hemat budget.
- **Pengujian fungsi murni** dengan node:test tanpa Electron — pilihan tepat.

---

## 12. Prioritas perbaikan (fokus fungsi/kode/desain)

| Prio | Item | Dampak | Usaha |
|------|------|--------|-------|
| P0 | F-01 tombol modal mati (delegasi + Esc) | UI inti | 0,5 jam |
| P0 | F-04 tes merah `parseLinksText` | Build hijau | 5 menit |
| P0 | F-02 filter OK/PARTIAL di `getTargets` (+tes) | Filter menipu user | 15 menit |
| P0 | F-03 anchor `target=_blank` / `will-navigate` di mainWindow | App tidak "hilang" | 15 menit |
| P0 | L-01 dead logic band 20K–100K (+tes) | Deteksi ternak benar | 15 menit |
| P0 | L-02 token tanggal → telepon (+tes) | Ratusan akun kampanye tidak kena vonis salah | 30 menit |
| P1 | D-01 query antrean ringan di worker | Hapus O(N log N) + write dari tiap tick | 30 menit |
| P1 | F-05 timeout menyeluruh per task | Worker tidak menggantung | 1 jam |
| P1 | F-06/F-07 backup & state atomik | Tidak ada backup/state korup | 1 jam |
| P1 | D-03 memoize intel snapshot (generasi) | Dashboard/Akun terasa instan | 2–3 jam |
| P1 | P-02 index `tasks(target_id, id)` | Semua query agregasi lebih cepat | 5 menit |
| P1 | F-09 `esc()` dataset.name | Tutup HTML injection | 5 menit |
| P1 | F-10 cap `parseLinksText` 10 000 + `truncated` | Cegah self-DoS | 10 menit |
| P2 | S-01 https-only; S-02 kunci partisi webview; S-03 OAuth popup in-app; S-04 persempit openExternal | Keamanan sesi | 1–2 jam |
| P2 | D-06 UPDATE needs_visit dibatasi per audit | Tidak ada efek lintas audit | 15 menit |
| P2 | F-08 tombol "Hapus sesi login" | Janji data lokal terpenuhi | 30 menit |
| P2 | D-02 pemisahan read/write + `db` getters pure | Testability & kebenaran | 3–4 jam |
| P2 | D-07 runner migrasi `user_version` | Upgrade v1.1 tidak merusak | 2 jam |
| P2 | Q-01 metrik kesehatan scraper + peringatan | Tidak buta saat markup berubah | 2–3 jam |
| P2 | P-04 getQueueStats; P-05 satu kanal refresh; P-06 pager Akun | Responsif di DB besar | 1–2 jam |
| P3 | D-05 pecah `db.js` per domain; M-01..M-25; L-03..L-07 | Maintainability | bertahap |
| P3 | D-09 hapus kode mati | Kesederhanaan | 30 menit |
| P3 | D-13 logger file + rotasi | Diagnosability | 2 jam |
| P3 | D-10 retensi/archival (opsional) | DB terkendali jangka panjang | 1 hari |

**Urutan disarankan:** P0 semua (setengah hari) → P1 (1 hari) → P2 (2 hari) → P3 mencicil.

---

## 13. Rekomendasi desain (arah, bukan mandat)

1. **Pisahkan jalur tulis/baca (CQRS-lite internal):** worker tidak pernah memanggil getter agregat; IPC read memakai cache generasi; write menaikkan generasi. Hilangkan seluruh kelas bug "baca yang menulis".
2. **Materialisasi intel:** tabel `account_intel` (key, score, level, flags_json, updated_at), di-refresh saat `recordAccountProfile` — deteksi jadi O(1) per baca, dan UI bisa sort server-side.
3. **Satu sumber kebenaran waktu & status:** `STATUS` enum + `nowIso()`; hapus format campuran; semua perbandingan waktu lewat `parseUtc`.
4. **Migrasi sebagai warga negara kelas satu** sebelum v1.1 menyentuh skema.
5. **Konfigurasi keselamatan dikunci, kenyamanan diekspos:** budget/pacing dikunci; path backup, bahasa, nama tray di `config.json`.
6. **Telemetri minimal lokal:** counter cache-hit, ok/partial/failed per platform, durasi p50/p95 scrape — tanpa kirim ke mana pun.
7. **Pertahankan**: node:sqlite, tanpa framework renderer, tanpa HTTP server, tray-first — arsitekturnya pas untuk alat internal; jangan "diupgrade" tanpa kebutuhan.

---

## 14. Bukti verifikasi

```
npm test        → pass 34, fail 1 (import.test.js — F-04)
node -e "…bioContactTokens('Est. 2026.10.01')…"  → ["phone:20261001"]   (L-02 terbukti)
grep SCRAPE_TIMEOUT_MS   → hanya didefinisikan, tak dipakai               (F-05)
grep getTargetWithAudit|getAccountProfile → hanya definisi & ekspor       (D-09)
grep getDashboardStats   → worker.js:253 (jalur panas) + tests             (D-01)
```
Semua referensi baris sesuai file pada tanggal audit; working tree berisi WIP belum commit — perbaiki tes sebelum commit apa pun.

*Disusun sebagai bahan perbaikan; tidak ada file sumber yang diubah.*
