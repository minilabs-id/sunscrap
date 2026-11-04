# OPSI TERBAIK v2 — sunscraping: Riset Luas, Audit Ulang & Rekomendasi Terbaik

**Tanggal:** 4 Nov 2026 · **Basis:** 5 analis independen (DB/SQL, mesin intel, scraper, worker/scheduler, frontend/IPC) + verifikasi ulang langsung + riset eksternal (dokumentasi resmi Meta/TikTok, situs GRIN/HypeAuditor/Upfluence, registry npm, Node.js docs).
**Tujuan aplikasi (tetap):** verifikasi posting iklan agensi di IG/TikTok — jujur, tepat brief, akun riil — ribuan link/bulan, budget nol, sepenuhnya lokal.

**Konteks repo saat ini (penting):**
- Commit `c1cc161` sudah memperbaiki batch P0/P1 (Esc/CSP modal, filter OK/PARTIAL, `will-navigate`, gerbang `followers_datar` 20K–100K, cap import, backup/state atomik, queue stats ringan) — diverifikasi ulang.
- WIP belum commit: `playwright-core` + `scripts/e2e.js` (E2E UI) + target portable. **Bagus — pertahankan dan masukkan ke CI.**
- Masih terbuka (terverifikasi di tree sekarang): `parseUtc` salah zona (§B.1.3), `1 << 40 === 256` (§B.1.4), `verifiedFilter` tanpa scope audit (§B.1.2), claim tanpa fencing token (§B.1.1).
- `AUDIT.md` (v1) sebagian usang; temuan terbaru & keputusan gabungan ada di sini.

---

## A. Riset eksternal — bagaimana sistem sekelas ini sebenarnya dibangun

### A.1 Tiga produk sejenis & pelajaran arsitekturnya

**GRIN** (grin.co, diverifikasi 4 Nov 2026) — model *pemberi kerja yang memverifikasi*, bukan scraper yang mengejar:
- Influencer **opt-in** ke program; brief, kontrak, draft approval, komunikasi, dan **pembayaran dalam satu CRM**; dana influencer **ditahan escrow** sampai pekerjaan terverifikasi.
- **Pelacakan post terikat ke program creator** (bukan link kiriman manual): post "dilacak dengan impressions dan engagement" langsung dari akun/post terdaftar.
- **Atribusi penjualan** via affiliate links/codes (plan gratis tersedia + fee pengelolaan); laporan jadi, ter-link ke payout.
- Pelajaran: **verifikasi terkuat lahir dari alur kerja + pembayaran, bukan dari scraping liat-liat**. Teknologi hanyalah penegak; klausul + proses adalah fondasinya. GRIN gratis untuk mulai (Free plan) — tapi butuh creator kooperatif, bukan untuk audit kompetitor.

**HypeAuditor** (hypeauditor.com, diverifikasi 4 Nov 2026) — model *kecerdasan fraud*:
- **Fraud detection = 53 pola perilaku** (bukan satu metrik); **Audience Quality Score (AQS) 0–100**; 35+ metrik; >950% aktivitas fraud terdeteksi (klaim vendor); database 226M+ profil.
- **Pelacakan kampanye berbasis kata kunci**: setelah post live, mereka **menemukan post kampanye dari hashtag/mention/keyword yang Anda set** — termasuk post yang **tidak dilaporkan creator**, hingga 90 hari ke belakang.
- Whitelabel report untuk agensi; payment tracking; kontrak via link personal; attribution Shopify.
- Pelajaran: (1) **ensemble, bukan sinyal tunggal**; (2) **benchmark kohort/niche**, bukan ambang mentah; (3) **penemuan post via hashtag** menutup kecurangan "lupa lapor" — bisa ditiru **secara terbatas** (lihat A.4); (4) report klien yang rapi = nilai jual agensi.

**Upfluence** (upfluence.com, diverifikasi 4 Nov 2026) — model *atribusi & operasional*: CRM, **kode promo unik auto-generated**, integrasi Amazon/Shopify/WooCommerce, pembayaran + KYC, ROI per creator. Pelajaran: **kode promo unik per creator** = bukti penjualan nyata (dan filter creator "post tapi tidak jualan"); gratis ditiru dengan spreadsheet + 1 landing page/link-tree.

### A.2 Jalur resmi (untuk kelengkapan, bukan rekomendasi)
- **Instagram Business Discovery** (terverifikasi): followers/media count + like/comment/view (paid+organic) akun **profesional** lain; butuh app + App Review; pemanggil harus akun profesional.
- **IG Insights**: reach/impressions akun **sendiri** yang memberi izin.
- **TikTok**: Research API (non-profit/akademik saja), Display API (hanya akun yang authorize), Commercial Content API (data iklan, EU-first) → **tidak ada API gratis untuk audit komersial publik**.
- **TikTok One / Creator Marketplace API**: hanya untuk partner yang disetujui (halaman mengembalikan 401 tanpa akses) — bukan jalur untuk Anda sekarang.
- **Partnership Ads (Meta, berbayar)**: metrik hanya untuk iklan yang di-boost — bukan audit organik.
→ Semua jalur resmi menuntut **izin/kooperasi**. Itu justru **gaya GRIN** — dan itu kabar baik (lihat A.3), karena Anda punya posisi pemberi kerja.

### A.3 Pola yang bisa (dan harus) ditiru secara gratis

| # | Pola industri | Cara kerjanya di sana | Versi gratis untuk Anda | Prioritas |
|---|---|---|---|---|
| 1 | **Escrow / pay-after-verify** (GRIN) | Dana ditahan sampai post diverifikasi | **Klausul kontrak**: bayar setelah lolos verifikasi (post ada + brief cocok + tetap tayang N hari). Teknologi menegakkan, bukan menggantikan. | ★★★ Wajib |
| 2 | **Creator portal / opt-in + link personal** (GRIN/HypeAuditor) | Brief, draft, kontrak, invoice di satu tempat; creator submit sendiri | **Google Form/Tally gratis** → CSV → parser kecil di app (sama seperti import.js): creator wajib input link + angka Insights + screenshot; deadline; pengingat otomatis (kolom "belum lapor"). | ★★★ Wajib |
| 3 | **Pelacakan post berbasis keyword** (HypeAuditor) | Post ditemukan dari hashtag/mention kampanye | **Eksperimental**: gabungkan ke dalam ekspor/laporan — cek halaman tag publik sesekali untuk kampanye dgn volume kecil & hashtag unik; jangan jadikan fondasi (rapuh, mudah kena limit). | ★ Opsional |
| 4 | **Ensemble 53 pola + AQS** (HypeAuditor) | Banyak sinyal lemah dikalibrasi jadi satu skor | **Adopsi prinsipnya**: skor = agregasi sinyal lemah (reach rendah, komentar minim, datar followers, template caption, serentak, dsb.) **+ cohort baseline** dari data Anda sendiri (median/percentile per niche & ukuran akun) — bukan ambang global. | ★★★ Wajib |
| 5 | **Benchmark kohort/niche** (semua) | Posisi akun dibandingkan peer-nya | Hitung median ER per (platform × band followers × niche) dari DB sendiri; flag = **< persentil 10** atau **< 0.5× median kohort**, bukan angka mati. "ER 0,4% vs median audit 2,1% (n=34)" — bisa dipertanggungjawabkan ke klien. | ★★★ Wajib |
| 6 | **Evidence retention** (semua) | Screenshot + log = bukti | **`capturePage()`** setelah halaman render (bukan di cache-hit!) → PNG + manifest JSONL (`{file, sha256, url, targetId, capturedAt, metrik}`); simpan semua FAILED + sampel OK; retensi 90 hari (FAILED tahan sampai sengketa tutup). | ★★★ Wajib |
| 7 | **Kode promo unik + atribusi** (Upfluence) | 1 kode → 1 creator → penjualan teratribusi | Buat kode `KAMPANYE-NAMA-00X`; spreadsheet/link-tree/Shopify gratis; laporan penjualan per creator; creator tanpa penjualan setelah N post → otomatis "perlu ditinjau". | ★★ Disarankan |
| 8 | **Whitelabel report** (HypeAuditor) | PDF/branded untuk klien | **Print CSS + "Cetak/Simpan PDF"** di app (tanpa dependency); lampirkan evidence pack (ZIP: PNG + manifest + CSV metrik). | ★★ Disarankan |
| 9 | **Payment tracking & reminder** | Status bayar per creator | Tabel `creator_reports(status, selisih_pct, deadline)`; daftar merah "belum lapor / selisih / post hilang"; reminder manual (email/WA template). | ★★ Disarankan |

### A.4 Yang **tidak** bisa ditiru (dan jangan coba)
Database 226M profil, AI matching, SLA, analisis audiens demografi (butuh data platform yang tidak publik). → Fokus pada **verifikasi & kepatuhan bukti**, bukan discovery.

### A.5 Jawaban untuk "kenapa tidak API resmi saja?"
Karena tujuan Anda adalah **membuktikan posting terjadi & akun riil, untuk ribuan link dengan budget nol** — API resmi: (a) tidak memberi metrik publik orang lain secara bebas (IG: profesional + App Review; TikTok: tidak untuk komersial), (b) justru menuntut kooperasi sama seperti kontrak Anda sekarang, (c) maintenance + review. **API bukan solusi "gratis tanpa usaha"; ia hanya memindahkan usaha ke App Review.** Yang Anda butuhkan: **bukti + trigger pembayaran + deteksi pola** — semuanya bisa tanpa API. (Kecuali satu: akun klien besar yang **setuju** konek API — jadikan fitur opsional nanti, bukan fondasi.)

---

## B. Audit ulang (sesi ini) — temuan pokok, terurut area & severity

> Semua baris mengacu pada tree **setelah** commit `c1cc161` (beberapa bug v1 sudah ditutup). `AUDIT.md` tetap menjadi referensi terperinci; di sini hanya yang **materi** & yang diverifikasi ulang.

### B.1 Database & SQL (`db.js`, `util.js`, `taskCache.js`)

**P1 — wajib sebelum rilis berikutnya**
1. **[Baru] Claim task tanpa fencing token → double-processing & hasil terbuang diam-diam.** `getNextTask` klaim tanpa `claim_id`; `reclaimExpired` menukar status ke PENDING; worker B klaim ulang; hasil A (terlambat) tetap diterima karena guard hanya `status==='RUNNING'` (`db.js:578-612`, `db.js:624-640`, `db.js:226-243`). *Fix:* kolom `tasks.claim_token TEXT` (UUID saat klaim); `updateTaskResult` commit hanya bila `claim_token` cocok (atau `locked_until > now`); bila tidak cocok → tulis ke **staging** `scrape_results`, jangan buang; panggil `notify()`. Bonus: perpanjang lock lewat heartbeat (mis. 10–15 menit) agar reclaim jarang terjadi.
2. **[Baru] `verifiedFilter` rusak: `MAX(v2.id)` tanpa scope audit & kind → skip-verified gagal massal.** Setelah satu task PROFILE dibuat, `MAX(v2.id)` menunjuk PROFILE → target yang sudah OK di-enqueue dan **di-scrape ulang semua** (`db.js:264-277`). *Fix:* `AND v2.audit_id = v.audit_id AND v2.kind = 'POST'` atau `ROW_NUMBER()` seperti pola `retryFailedTargets`.
3. **[Audit-1, BELUM diperbaiki] `parseUtc()` memperlakukan `"YYYY-MM-DD HH:MM:SS"` sebagai waktu LOKAL.** `new Date('2026-11-04 12:00:00')` → `05:00Z` di WIB (diverifikasi, Node v26/TZ+7). Offset ± offset zona → `autoEnqueueDue`, `next_due_at`, TTL cache **bergeser 7 jam** (`util.js:27-45`; pepakai `db.js:251`, `db.js:810`, `db.js:828`, `db.js:851`). *Fix:* utamakan regex → `Date.UTC(...)`; jatuhkan `new Date()` sebagai terakhir. (Commit "intel date/band" tidak mencakup ini — diverifikasi.)
4. **[Regresi c1cc161] Backup menghapus target lama SEBELUM `VACUUM INTO`.** Kode sekarang (`db.js:1513-1523`) unlink `destination(+wal/shm)` lalu vacuum; bila vacuum gagal → **cadangan lama hilang**; dan tidak ada guard `destination === dbPath` (di POSIX unlink file DB live berhasil → DB bisa hilang). *Fix:* (a) tolak `resolve(destination) === resolve(dbPath)`; (b) `VACUUM INTO dest.tmp-pid` + `renameSync` (atomic); (c) jangan pernah unlink — SQLite gagal bila target ada (itu fitur); (d) utamakan **`sqlite.backup()`** (Node ≥ 22.13 — stabilitas RC; diverifikasi di Node docs) menggantikan vacuum+tmp.

**P2**
5. **Read-path memutasi & tanpa transaksi:** `getDashboardStats()` → `reclaimExpired()` → UPDATE/INSERT saat "baca"; loop reclaim tidak atomic → crash = setengah task di-reclaim (retry naik) tanpa snapshot. *Fix:* jangan mutasi di read; reclaim hanya di worker; bungkus transaksi; dashboard baca kolom `overdue` saja.
6. **Missing indexes:** `tasks(target_id, id)` (dipakai semua window `PARTITION BY target_id`; tidak ada!) → `CREATE INDEX idx_tasks_target ON tasks(target_id, id);` + `account_posts(fetched_at)` + `tasks(audit_id, status, target_id)`.
7. **`getTargets` menghitung CTE berat DUA kali** (COUNT + page) → satu query dengan `COUNT(*) OVER () AS total_count`.
8. **`getAudit()` = `getAudits()` penuh lalu `.find()`** (5 subquery correlated + `cachedTargetCounts()` non-sargable `rtrim/substr`) → tulis query khusus 1 audit; hapus parameter mati; tambah index fetched_at.
9. **Intel snapshot full-load per request** (`SELECT *` 4 tabel + union-find di JS; dipanggil dari halaman Akun & Risk; `getAccountDetail` mengulangi) → **materialized `intel_snapshot`** + refresh on write (atau TTL 5 menit + invalidation flag).
10. **`1 << 40 === 256`** (32-bit shift) — sentinel umur-data salah → `Number.MAX_SAFE_INTEGER` (`db.js:1367`; diverifikasi di REPL).
11. **`getCompare`:** `is_new` selalu true untuk akun dengan data di periode terbaru (loop DESC menginisialisasi first_period=latest) → `new_accounts` inflasi; dan `LEFT JOIN latest` menghitung target tanpa snapshot sebagai "posts". *Fix:* `minPeriod===latest && slice(1) semua null`; skip rows tanpa ≥1 metrik.
12. **Username target tidak dinormalisasi** (`cleanText`, bukan `cleanUsername`) → mixed-case upload memutus join `account_history`/`accounts`; dedup bocor → `cleanUsername()` di `insertTarget` (atau kolom `username_norm`).
13. **Platform `unknown` menembus cache & intel** (`result.platform` hanya cleanText) → baris platform sampah; `getAccountCache(x)` tanpa platform ambil IG untuk akun TT. *Fix:* whitelist `['instagram','tiktok']`, fallback `row.platform`; hapus `'unknown'` di write-path.
14. **Tidak ada migrator** (`user_version=5` ditulis, tak pernah dibaca) → implementasikan runner `MIGRATIONS[6..]` + shadow test upgrade v5→v6.
15. **Statement prepare berulang** di setiap helper → `stmtCache` Map.
16. **`enqueueProfileVisits` mereset `needs_visit=1` untuk SEMUA akun** (tanpa scope audit) + **PROFILE dihitung 2× budget** (`recordAuxiliaryVisit` + `reportSuccess`) → hapus/batasi global update; PROFILE = 1 kunjungan saja (pakai satu konter), `estimateTime` hitung PROFILE=2 biaya, cache-hit=0; pacing berbasis EMA (simpan `avgTaskMs` di storage).
17. **`searchData` LIKE `%..%` tanpa escape** & tanpa index → escape `\ % _` + `ESCAPE '\'`; FTS5 opsional nanti.
18. **`getLatest`/`getExportRows` CTE `attempts` scan seluruh snapshots** → pushdown `WHERE target_id IN (...)`; `WHERE` di dalam CTE.
19. **PROFILE starvation + status basi:** `pick()` mendahulukan PROFILE tanpa aging; hasil claim dikembalikan sebelum update (status `PENDING` padahal RUNNING) → aging/weight; kembalikan row hasil update.
20. **Key history `a|b|2026-11` di-`split('|')`** → username mengandung `|` (boleh lolos cleanText) merusak join → nested Map atau tolak charset di `cleanUsername`.

**P3:** dua format waktu campur (`"YYYY-MM-DD HH:MM:SS"` vs ISO `Z`) → bandingkan string salah → standardisasi ISO-Z semua kolom baru (+ `DEFAULT` ISO); `BACKUP_TABLES` tanpa `runs`; `sqlite_sequence` tidak direset di `clearAll`; FK `PRAGMA foreign_keys=ON` tapi **nol REFERENCES** di DDL → tambah `REFERENCES ... ON DELETE` (instalasi baru) / dokumen urutan delete; `orderMap` aman tapi `params.status` tak dikenal di-skip diam-diam → whitelist + warning; **snapshot dari reclaim berstatus TRANSIENT palsu** (nol kunjungan) → `ABANDONED`.

**Recheck (disarankan, v1.1):** tambah `kind='RECHECK'` + `due_at`; klaim hanya `due_at <= now`; enqueue follow-up (D+7 → D+30) dalam transaksi yang sama + guard `NOT EXISTS`; berhenti saat PERMANENT. Memotong "audit ulang semua" → "hanya yang due". CAPTURE **bukan** kind terpisah — jadikan flag task POST (`--capture`) agar 1 kunjungan.

### B.2 Mesin intel (`intel.js`) — belum laik sebagai "alat bukti"; cukup sebagai *filter prioritas*
1. **[P1] Cluster transitif tanpa bobot → 1 hotline/template publik meng-eskalasi ratusan akun jadi `pola_ternak`.** Union-find mempersatukan A–B–C; bila satu edge "strong", **semua** anggota dianggap strong (`intel.js:100-236`). *Fix:* (a) cluster strong = subgraf berisi **hanya edge strong** (pisah weak/strong components); (b) **fan-out cutoff**: token/hotline yang dipakai >50 akun (atau >1% korpus) = `common_token` — dicatat, tidak dijadikan bukti; (c) strong butuh ≥2 sinyal independen, atau 1 strong + ≥1 sinyal lain.
2. **[P1] Komentar hilang dianggap 0.** `medianComments || 0` (`intel.js:312-318`) → akun sehat dengan komentar tak terbaca selalu dikunci. *Fix:* simpan `comments_missing`; butuh ≥60% post punya data sebelum flag; null ⇒ flag dibatalkan.
3. **[P1] Nomor telepon di bio tanpa validasi prefix** — `2026.10.01` → `phone:20261001` (diverifikasi); invoice/order ID/hotline publik ikut ter-link. *Fix:* `^8\d{7,12}$` pasca-strip (`08/62/0062`), tolak pola berulang, blacklist email generik (`info@|cs@|admin@`) dari sinyal strong; email generik = weak.
4. **[P1] Angka laporan menyesatkan:** `is_new` nyaris selalu true (loop DESC) → `new_accounts` inflasi (`getCompare`); `curiga` (score≥6) vs `flagged` (score≥2) beda ambang di dua layar; `monthValues≥2` saja; `followerDeltaPct` = range/min bukan first→last; string bukti ≠ angka; `postGrowth===null` dianggap "tetap upload". *Fix:* cohort/series yang benar; satu `FLAGGED_SCORE`; ≥3–4 titik; first→last signed; null=netral.
5. **[P2] Uji kalibrasi wajib sebelum ke klien:** golden dataset 50–100 akun (25 sehat / 25 farm tervalidasi oleh Anda sendiri) → precision ≥ 0.9 untuk label "kuat"; CI menolak bila turun; test **negatif** (akun sehat tidak ditandai), boundary (5.000/20.000), timezone, duplikat post (`dedup by post_ref` sebelum burst), determinism snapshot 2× identik; `data_tidak_cukup` bila `posts_seen<3`.
6. **[P2] Sinyal terbaik (gratis):** **CoV like** (stddev/mean, n≥5, mean≥10, foto/video dipisah) — `like_terlalu_stabil` (+2); **avatar URL identik** lintas akun (hash pathname, strip query — IG signature dirotasi); **bio link identik** (normalisasi); **hashtag set identik** — **ekstrak hashtag SEBELUM** `truncateText(500)` (`common.js:118`) dan whitelist hashtag brief klien (by design sama); **sync window** `|Δt|≤5 menit` (bukan bucket 5m) + min 2 pasangan; **following/followers ≥ 1** + band 20–50K datar (setelah perbaikan v1); cadence meledak setelah bulan kosong (`account_history`).
7. **[P2] Skor & label:** ganti `pola_ternak/pola_kembar` → **"terindikasi keterkaitan (keyakinan rendah/sedang/kuat)"**; `insufficient_data` eksplisit; `recommended_action` (monitor/verifikasi/lapor klien); **cohort-relative**: flag hanya bila < persentil 10 atau < 0.5× median kohort audit; ≥2 audit berturut; `INTEL_CONFIG` terdokumentasi & versioned; output selalu `reasons[]` + `evidence_strength`; kumpulkan **`intel_feedback`** (Benar/Salah/Ragu) → re-tuning dari data Anda sendiri.
8. **[P3] Wording:** buang klaim kausal ("satu perangkat") → deskriptif ("3 unggahan dalam 10 menit — bisa berjadwal"); sertakan `possible_legitimate_causes`; link post asli di setiap temuan.

**Verdict modul:** sebagai **prioritas tinjauan manual** — layak dipakai (setelah perbaikan P1). Sebagai **bukti dituduhkan ke klien** — tidak; label wajib netral + human review + disclaimer.

### B.3 Scraper (`scraper.js`, `scraper-content/*`)
1. **[P0] `loadURL` tanpa timeout** → worker bisa menggantung selamanya (yang punya timeout hanya `executeJavaScript` 45s). *Fix:* `withTimeout(load, 30s, 'LOAD_TIMEOUT')` → timeout ⇒ `destroy()` window + gagal task; probe injeksi juga diberi timeout 10s; `webContents.on('unresponsive')` → log + destroy; **jangan pakai ulang window setelah timeout/crash**; 2 crash/jam ⇒ hentikan worker.
2. **[P1] Login-wall/checkpoint tidak terdeteksi** (hanya keyword/path; IG/TikTok sering menampilkan modal tanpa navigasi) → metrik null + `errorCode` kosong ⇒ **tidak memicu jeda/stop AUTH** → sesi mati terus ditembak → risiko flag/ban. *Fix:* deteksi **struktural**: `input[type=password]` / `form[action*="login"]` / `iframe[src*="captcha"]` / `document.title` mengandung login/checkpoint/masuk; assert `webContents.getURL()` masih path target (mismatch ⇒ AUTH/PERMANENT). Jika terdeteksi ⇒ `AUTH` (jeda 20′ + stop 3×); log snippet (tanpa PII).
3. **[P1] `ERR_ABORTED` ditelan tanpa verifikasi URL akhir** (`scraper.js:104-107`) → assert `allowedTarget(finalURL)` + host/path sesuai platform; mismatch ⇒ klasifikasi, bukan scrape "dalam gelap".
4. **[P1] `JSON.parse` script raksasa** → OOM renderer → crash; *Fix:* `if (text.length > 3_000_000) continue`; prefilter `text.includes(shortcode)`; maks ~20 script; ukur durasi parse (>2s ⇒ log).
5. **[P1] Deteksi blok berbasis substring 4 KB** — dua arah rapuh (keywords pemicu salah → THROTTLED palsu; login wall tanpa keyword → lolos) → struktural dulu, keyword tie-breaker + log potongan teks untuk tuning; `errorCode || 'TRANSIENT'` di semua exit FAILED; satukan `classifyError` (2 salinan duplikat di `policy.js` & `db.js` — drift).
6. **[P1] Login window tanpa `will-navigate`** → phishing di **dalam partisi sesi** (kredensial diketik ke situs tiruan) → allowlist navigasi login (IG/FB/Google OAuth paths); sisanya `preventDefault` + `openExternal`; tombol **"Uji sesi"** + **"Hapus sesi & login ulang"** (`clearStorageData`) di Pengaturan.
7. **[P1] `render-process-gone` tidak menolak promise pending** → panggilan menggantung 45s lalu hilang → simpan `currentCallReject`; handler memanggilnya (`RENDER_GONE`) + destroy; klasifikasi TRANSIENT, retry maks 1×.
8. **[P2] Evidence via `capturePage()` FEASIBLE** — terbaik di akhir `scrapePost` (setelah metrik ter-render); **bukan** di cache-hit (screenshot halaman sebelumnya = bukti palsu); cek `img.isEmpty()` + retry 800ms; bila tetap kosong ⇒ log & evidence kosong (jangan gagalkan task); simpan PNG + **manifest JSONL berisi SHA-256**; rotasi (FAILED disimpan; OK disampel 10% / 90 hari); ekspor "paket bukti" (ZIP PNG+manifest+CSV) untuk sengketa; tombol **"Lihat bukti"** di UI (IPC `evidence:open`, path allowlist di dalam `userData/evidence`).
9. **[P2] Telemetri drift selector:** distribusi `source/postSource` (`rehydration|sigi|dom|item-list|grid`), null-rate per field, `blockRate`, durasi; alert bila `source='dom'` >20% atau fill-rate likes <80%; `postsSource='grid'` ⇒ jangan hitung CoV (tanpa likes); simpan `post_source` & `extraction_layer` ke kolom baru (migrasi v6).
10. **[P2] Ekstraksi hashtag SEBELUM truncate** (`common.js:118` memotong 500 char — hashtag kampanye di akhir caption terpotong!) → simpan `hashtags[]` terpisah; `recentPosts` **sort by postedAt** (urutan deterministik untuk CoV); `numberFromDigits` edge cases (`12,34,567`); `openLogin` beri `.catch`; guard `WORLD_LOST` via satu expression; `LOGIN_URLS` langsung ke halaman login.
11. **[P3] http→https only** di allowlist (`policy.js`, `util.js`); kosong 45s di TikTok `item_list` log `response.status` (tanpa cookie) — endpoint privat; jangan retry agresif.

**Kesimpulan scraper:** kerangka sudah benar (isolasi world, allowlist, partition, rotasi window, fallback berlapis). Yang hilang: **timeout menyeluruh, deteksi login-wall struktural, dan bukti visual** — tiga-tiganya wajib sebelum dipakai sebagai "alat bukti" ke klien.

### B.4 Worker & scheduler (`worker.js`, `rateLimiter.js`, `policy.js`, `main.js`)
1. **[P1] Kegagalan tulis DB = hasil scrape (dan budget anti-bot yang sudah dipakai) hangus tanpa jejak.** Worker tidak cek `updateTaskResult()` return `false` (`worker.js:212`). *Fix:* cek return; `false` ⇒ log + `notify()` + **staging** `scrape_results(task_id, payload, created_at)` yang di-replay; idempotent upsert by `task_id`.
2. **[P1] Reclaim dihitung sebagai "percobaan"** → 3 crash/hang ⇒ task FAILED tanpa satu pun kunjungan + snapshot FAILED palsu. *Fix:* reclaim tidak menaikkan `retry_count`; beri kode `ABANDONED`; batas reclaim terpisah (3× → FAILED `ABANDONED`); snapshot dari reclaim diberi penanda.
3. **[P1] `start()` menghapus rem keamanan** (`blockedInARow`, `consecutiveErrors`, `backoffMultiplier`, warm-up) → saat platform membatasi, toggle tray justru **menaikkan** risiko blok. *Fix:* pisahkan *workspace session* (boleh reset) vs *risk posture* (hanya reset setelah N sukses berturut / logout eksplisit).
4. **[P2] Rail harian direset pakai waktu LOKAL** (`toDateString`) — bukan UTC → tengah malam WIB bisa memberi ±2.000 kunjungan ekstra & inkonsisten dengan snapshot. *Fix:* `toISOString().slice(0,10)`.
5. **[P2] Jeda blok bersifat global lintas platform** → TikTok 429 ⇒ IG sehat pun berhenti. *Fix:* `blockedInARow`/`blockedUntil` **per platform**; TikTok diblok ⇒ skip task TikTok (claim khusus IG via `preferPlatform`); berhenti total hanya bila keduanya gagal.
6. **[P2] Cache-hit mereset `blockedInARow`** → proteksi 3× blok bisa tidak tercapai; *Fix:* cache tidak menambah **dan tidak mereset** streak blok.
7. **[P2] Requeue FAILED/TRANSIENT tanpa cooldown per-task** → 3× bombardir dalam ~30 detik; *Fix:* `not_before = now + 5·2^retry_count` menit; klaim `AND (not_before IS NULL OR <= now)`; FETCH backoff indeks.
8. **[P2] `pendingCount()` memanggil `getDashboardStats()` full scan + mutasi** setiap tick → ganti query ringan `COUNT(*) WHERE status IN (...)` (sebagian sudah di c1cc161 — verifikasi konsisten di worker); **PROFILE = 2 kunjungan dihitung 1×**; ETA salah; *Fix:* hitung PROFILE=2, cache-hit=0; simpan `avgTaskMs` (EMA) di storage untuk pacing & ETA.
9. **[P2] `worker-state.json`: `remove()` menulis non-atomik & error ditelan** → rail harian bisa "reset" pasca-crash → 2.000 ekstra. *Fix:* atomic tmp+rename; log error persist; mode konservatif (`safe`) sampai tulis berhasil.
10. **[P2] `shutdown()` tidak menunggu tick in-flight** → hasil terakhir hilang saat keluar; *Fix:* tunggu `!busy` maks 8s (tray tampilkan "Menyelesaikan…"); baru dispose/close.
11. **[P3] Task FAILED/TRANSIENT di-requeue tanpa cooldown**; **`getStatus()` "siaga" setelah stop manual** (label menyesatkan) → `!active ? 'berhenti'`; **`cacheKey` platform tidak lowercase**; **`util.postRefFromUrl` vs `taskCache.refFromUrl` tidak setara** → cache salah-match → satukan satu fungsi + prefix `ig:`/`tt:` + index; **`estimateTime` hardcode +4s & break-position** → EMA.

**RECHECK (desain, v1.1):** `NOT EXISTS` guard dalam transaksi yang sama; berhenti saat PERMANENT; klaim hanya `due_at <= now` (index `(status, due_at)`); idempoten terhadap retry/reclaim; estimasi budget 2N per siklus → **stagger** (mis. bagi rata per hari) atau jawab dari cache.

### B.5 Frontend & IPC (`renderer/*`, `preload.js`, `ipc.js`, `main.js`)
1. **[P1] `will-navigate` mengizinkan semua `file://`** — dokumen lokal mana pun mewarisi preload yang sama → `window.sunscraping` penuh (deleteAudit, clearAll…) tanpa exploit. *Fix:* izinkan **hanya** path persis `renderer/index.html`; selain itu `preventDefault`.
2. **[P1] Jendela utama tanpa `sandbox: true`**; **guest `<webview>` masih bisa `target=_blank` tapi diblokir senyap** (handler `new-window` renderer deprecated/diabaikan; windowOpenHandler global `deny` tanpa openExternal untuk webview) → tambah `sandbox:true` (utama + will-attach-webview); di `web-contents-created`, tipe `webview` ⇒ `https?:` → `shell.openExternal` + deny; hapus handler deprecated.
3. **[P1] `<webview>` bebas navigasi & pakai partisi sesi login** → phishing di dalam app terpercaya → allowlist `instagram.com|tiktok.com` di `browserNavigate` + `will-attach-webview`; luar itu ditolak + toast; atau partisi `persist:browser` terpisah (disarankan bila berbagi sesi tak wajib).
4. **[P2] `href` dari DB tidak divalidasi skema** (`javascript:` hanya ditahan CSP) → helper `safeHttpUrl()` (hanya http/https); klik lewat `api.openExternal`; **`esc()` tidak escape `'`**; `kpi()`/`statusBadge`/`p.platform`/`data-repeat` → escape/whitelist/number; `a.level.replace` → guard (`(a.level||'bersih')`); `loadAccounts` crash satu baris ⇒ tab kosong total → toast error; **state basi**: `auditId` menunjuk audit terhapus setelah delete/clearAll → reset saat `loadAudits()`; **polling hanya refresh Dashboard** → refresh tab aktif juga (Target/Akun/Proses) atau badge "data berubah"; **filter `done`/`pending` di-export sebagai SEMUA** → mapping eksplisit; modal konfirmasi scope ("Export N baris · audit X · status Y") + tombol export nonaktif saat tak terpetakan; **seleksi lintas halaman tidak transparan** → kosongkan saat ganti halaman atau tampilkan rincian; pager disable di ujung.
5. **[P2] UX destruktif tanpa rem:** hapus audit tanpa hitungan; "Hapus semua data" → **ketik `HAPUS`** + **"Cadangkan dulu lalu hapus"** (auto-call `dbBackup`); "Hapus sesi login" satu klik → modal konfirmasi; `before-quit` tanpa timeout (bisa tidak keluar) → `Promise.race(5s)`.
6. **[P2] A11y & kontrol:** nav `<a>` tanpa `href/tabindex` → `<button>` + `aria-current`; baris tabel → `tabindex=0 role=button` + Enter/Space; checkbox `aria-label`; modal `role=dialog aria-modal` + fokus awal/trap/restore; toast `role=status aria-live`; `.lv-curiga` **tidak ada di CSS** (prioritas tertinggi tak terlihat) → tambah; `--warn` kontras < AA; `:focus-visible`; `prefers-reduced-motion`; select dibangun ulang tiap poll → skip saat fokus / diff dulu.
7. **[P3] Global leak** `window.closeModal/openAccount` (hapus — delegasi `[data-close]` cukup); copy mengacu tombol lama ("+ Audit baru" vs "Import data"); **log file + rotasi** (`userData/logs/`), tanpa PII; `<link rel=icon>`; **tray "Buka dashboard" bikin jendela kembar** → focus existing; **CSP**: turunkan `style-src 'unsafe-inline'` (pindahkan inline style ke kelas), tambah `object-src 'none'; base-uri 'none'` — **tanpa menyentuh `script-src`**.
8. **[P2] Export:** exceljs stagnan (4.4.0, rilis ±Okt 2023) → **adapter ekspor** + migrasi bertahap ke **write-excel-file@4.1.1** (MIT, aktif, Node≥18, write-only memadai); tombol **"Export berisi data klien — simpan terenkripsi"**; password-protect opsional.

**Yang sudah benar (pertahankan):** isolasi scraper (sandbox/contextIsolation/allowlist/permission deny-all/single-instance), preload minimal terkurasi, **CSP ketat** + tanpa inline handler, `orderMap` whitelist, `retryTargets` Number+cap 200, import tervalidasi ketat (host, halaman post only, 10k baris), state atomik (tmp+rename), transaksi di semua write-path, cache tanpa navigasi & tanpa budget.

---

## C. Keputusan terbaik per komponen kode (ringkas tapi menentukan)

| Komponen | Masalah | Keputusan & alasan |
|---|---|---|
| **Akses data** | Full reload per query; intel berat | **Materialized `intel_snapshot` + refresh on write / TTL-invalidate**; getter ringan (`COUNT(*)`); caching generasi di memory DB-layer |
| **DB engine** | node:sqlite RC (OK) | **Tetap node:sqlite** — RC sejak 22.13; gunakan **`sqlite.backup()`** (bukan VACUUM-manual + unlink); migrator `user_version`; `DatabaseSync`→`Database` (DEP0210) bila upgrade Node; **bukan** better-sqlite3 (native ABI) |
| **Skema** | user_version palsu; FK tanpa REFERENCES | **Migrator + tes upgrade v5→v6**; REFERENCES + indeks `tasks(target_id,id)`, `account_posts(fetched_at)`; ISO-Z tunggal; `ABANDONED` code |
| **Intel** | FP massal; skor tanpa kalibrasi; label menuduh | **Ensemble + kohort baseline + golden set + label netral + human review**; `data_tidak_cukup`; CoV/avatar-URL/bio-link/hashtag signals; `intel_feedback` loop |
| **Scraper** | Hang tanpa timeout; login-wall buta; tanpa bukti | **Timeout menyeluruh + login-wall struktural + evidence (`capturePage`+SHA-256 manifest)**; allowlist ketat; telemetri drift |
| **Worker** | Hasil hilang diam; reclaim menghukum; budget bocor | **Staging `scrape_results` + cek return + heartbeat claim_token**; RECHECK D+7/D+30; **monitor mode** (incremental); risk posture vs workspace |
| **UX** | Operator salah klik; data tidak segar; ekspor salah scope | **Pagar destruktif (HAPUS/backup-dulu), export preview + mapping, refresh tab aktif, a11y dasar, triase 🟢🟡🔴** |
| **Distribusi** | Unsigned + 35 vs 45 | **NSIS + signing (Azure Trusted Signing ±$10/bln) + electron-updater + CI (test + e2e playwright + build)**; naik **Electron 45.x** bertahap |
| **Export** | exceljs stagnan | **`export.js` adapter → write-excel-file**; golden-file tests |
| **Testing** | Tes merah D-04 (diperbaiki); tanpa negatif | **Golden fixtures (50–100 akun) + negative/boundary tests + precision gate di CI**; e2e playwright masuk CI |

---

## D. Arsitektur target (yang harus dibangun, bukan diimpikan)

**Pipeline verifikasi 4 tahap** (semua Rp 0):

```
Tahap 1 IMPORT → normalisasi + laporan baris invalid (baris-N, alasan) + dedupe lintas audit
Tahap 2 KONFORMITAS → post ada? akun benar? caption/mention/#hashtag/URL cocok brief? tanggal cocok?
                      → skor 0–100 + daftar elemen hilang (simpan `conformance_json`)
Tahap 3 METRIK + BUKTI → likes/comments/views/ER + screenshot (manifest JSONL + SHA-256)
Tahap 4 TRIASE → 🟢 lolos | 🟡 spot-check 10–20% | 🔴 wajib manual; keputusan = manusia
```

**Fitur yang wajib (berurutan):**
1. **Evidence** — `capturePage()` → `userData/evidence/YYYYMM/<id>_<ts>.png` + `manifest.jsonl` (`sha256`); UI "Lihat bukti"; rotasi 90 hari (FAILED tahan); ekspor paket bukti (ZIP).
2. **RECHECK D+7/D+30** — menangkap "hapus setelah dibayar"; `kind='RECHECK'` + `due_at` + transaksi enqueue follow-up + `NOT EXISTS`; klaim `due_at<=now`; retensi budget via stagger.
3. **MONITOR MODE** (audit ulang cerdas) — skip `PERMANENT`, skip yang < TTL, jawab dari cache bila segar → kunjungan berulang turun drastis; `verifiedFilter` diperbaiki (B.1.2).
4. **Triase + feedback** — ambang **per jaringan/klien** (simpan DB); tombol Benar/Salah/Ragu; "dari 40 tanda, 34 benar".
5. **Creator portal** — Google Form/Tally → CSV → parser; **selisih klaim vs publik > 20% ⇒ merah**; deadline + daftar merah; klausul bayar-setelah-lolos (proses, bukan kode — paling kuat).
6. **Hapus akun & semua datanya** (komplain/koreksi) + export per akun (portabilitas).
7. **Laporan agensi** — Print CSS → PDF; kolom: target, link, tanggal post, konformitas, ER vs kohort, status verifikasi, link bukti; disclaimer "indikasi otomatis — verifikasi manual".
8. **(Eksperimental)** Hashtag/mention crawler untuk kampanye kecil — temukan post yang tidak dilaporkan; gunakan hanya bila volume rendah & hashtag unik; jangan fondasikan.

**Migrasi v6 (pertama):** `claim_token`, `due_at`, `extraction_layer`, `post_source`, `evidence_path`, `conformance_json`, `intel_feedback`, `creator_reports`, `INDEX (status,due_at)`, `INDEX tasks(target_id,id)`, `INDEX account_posts(fetched_at)` + `ABANDONED` handling + REFERENCES + upgrade-test.

---

## E. Roadmap (disesuaikan c1cc161; usaha ≈ hari kerja)

**0–2 minggu — "Tidak ada yang lolos tanpa bukti"**
1. Fix B.1 P1 (claim_token, verifiedFilter, parseUtc, backup unlink → `sqlite.backup()`); migrasi v6 + tes.
2. Evidence (capturePage + manifest + retensi + tombol Lihat bukti).
3. RECHECK D+30 (paling menusuk untuk sengketa) lalu D+7.
4. Perbaiki scrape hang (P0) + login-wall struktural + AUTH honored (jeda/stop) — verifikasi sesi mati tidak dibayar berkali-kali.
5. Export preview + mapping done/pending; hapus-sesi-login confirm; clearAll ketik `HAPUS` + backup-dulu.
6. Golden set 50–100 akun (validasi Anda sendiri) + negative tests + precision gate.

**2–6 minggu — "Deteksi bisa dipertanggungjawabkan"**
7. Intel overhaul (B.2): kohort baseline, CoV/avatar/bio-link/hashtag, label netral, feedback loop; `intel_snapshot`.
8. Triase UI 🟢🟡🔴 + filter + default sort merah; refresh tab aktif.
9. Creator portal (Google Form → CSV parser) + daftar merah + reminder.
10. Telemetri drift selector + alert; LOG file rotasi.
11. Migrasi exporter ke write-excel-file + golden-file tests.

**1–3 bulan — "Skala tanpa nambah orang"**
12. Incremental/monitor audit (hanya due / berubah) — 28 jam → menit; UX "Audit ulang cerdas".
13. Upgrade Electron 35→45 bertahap (changelog per mayor, UAT penuh: login IG/TikTok, 1 siklus scrape, E2E).
14. Signing (Azure Trusted Signing) + electron-updater + rilis 1.1.0; CI: test + e2e + build pada tag.
15. Laporan agensi PDF + evidence pack; template klausul creator + SOP; review bulanan selector (pemilik + jadwal tetap).
16. (Opsional) mode API untuk akun kooperatif — hanya jika klien meminta.

**KPI sukses (definisikan di awal):** ≥95% post terverifikasi otomatis; manual ≤15% antrean; 0 post hilang tanpa terdeteksi (re-check); precision "kuat" ≥0.9 (terukur golden set); waktu verifikasi per 1.000 link < 4 jam kerja; 0 backup korup (restore-test bulanan).

---

## F. Risiko & pertanyaan terbuka (wajib dijawab sebelum scale-up)
1. Apakah **semua klien menyetujui** metode ini (audit otomatis + arsip screenshot halaman publik)? Jika tidak → flag `consent` per kampanye.
2. **Siapa yang memutakhirkan selector** saat IG/TikTok berubah? (Tanpa pemilik + jadwal review → tool pasti mati diam-diam.)
3. Akun operator: **khusus kerja + 2FA**, jangan dipakai untuk aktivitas lain; jangan pernah simpan kredensial di app (sesi manual — pertahankan).
4. **Distribusi ke pihak ketiga?** Jika ya → signing wajib + review PDP + SLA selector; jika internal → cukup dokumentasi risiko + retensi kebijakan.
5. **Region klien?** Di luar Indonesia → GDPR/UK-GDPR; konsultasi hukum sebelum sebar luas.
6. **Hasil "ternak" dipakai untuk apa?** Hanya prioritas tinjauan/peninjauan komersial — **bukan** penolakan otomatis; keputusan selalu manusia + bukti.
7. **Retensi bukti**: berapa lama PNG disimpan (90 hari? sampai sengketa tutup?) — satu paragraf kebijakan di README + Pengaturan.

---

## G. Lampiran — sumber & status verifikasi

| Sumber | Klaim yang dipakai | Verifikasi |
|---|---|---|
| developers.facebook.com (Instagram API with Facebook Login; Business Discovery; IG Insights) | Hanya akun **profesional**; view = paid+organic; App Review; media orang lain tidak bisa di-GET | fetch langsung, 4 Nov 2026 |
| developers.tiktok.com (Research API; Commercial Content API) | Research = **non-profit/akademik**, wilayah terbatas, non-komersial; Commercial = **data iklan** EU | fetch langsung, 4 Nov 2026 |
| grin.co (diakses 4 Nov 2026) | Opt-in creator, CRM, **payout dikaitkan verifikasi**, affiliate codes, Free plan + fee | WebFetch langsung |
| hypeauditor.com (diakses 4 Nov 2026) | 53 pola fraud; AQS 0–100; **post discovery via hashtag/mention hingga 90 hari**; 35+ metrik; whitelabel | WebFetch langsung |
| upfluence.com (diakses 4 Nov 2026) | Kode promo auto-generated; atribusi sales Shopify/Amazon; payments+KYC | WebFetch langsung |
| registry.npmjs.org | `electron@45.2.2` (engines Node ≥22.12); `electron-builder@26.18.0`; `exceljs@4.4.0` (stagnan, ±Okt 2023); `write-excel-file@4.1.1` (aktif, MIT); `xlsx@0.18.5` (usang) | fetch langsung, 4 Nov 2026 |
| nodejs.org/api/sqlite.html (v26.13.0) | `node:sqlite` RC sejak v22.13; **`sqlite.backup()`**; `DatabaseSync`→`Database` (DEP0210); `serialize()` v26 | fetch langsung, 4 Nov 2026 |
| Kodebase `ebbd424..c1cc161` + WIP | Semua temuan B.* dengan baris; fix c1cc161 dikreditkan; `parseUtc` & `1 << 40` **terverifikasi masih ada** di tree | baca file + REPL (`1<<40===256`; `new Date('2026-11-04 12:00:00')` → 05:00Z) |

**Keterbatasan riset:** web search publik tidak mengembalikan hasil; verifikasi via `webfetch` langsung ke sumber resmi — cukup untuk keputusan teknis; **bukan** nasihat hukum untuk distribusi komersial luas. Rate limit IG/TikTok tidak dipublikasikan; kebijakan berubah sewaktu-waktu.

**Cara pakai dokumen ini:** (1) eksekusi §E top-down; (2) setiap item punya "selesai jika" yang terukur — jangan kumpulkan "90% jadi"; (3) pertahankan `AUDIT.md` sebagai lampiran detail — sinkronkan status setelah tiap rilis.
