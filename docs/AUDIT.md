# sunscrap — Audit Keamanan & Keandalan

Komprehensif audit atas kode `src/` (backend Electron, content scripts, frontend). Ditulis setelah membaca seluruh modul inti, handler IPC, scraper content, preload, dan 11 berkas test.

Ringkasan: arsitektur defensif yang relatif matang — contextIsolation + sandbox, allowlist host persis, santisasi formula injection, parameterized DB (diverifikasi lewat test), dan batas rate limiter yang diuji. Sejumlah temuan di bawah ini (mayoritas kebersihan/keandalan, bukan RCE) tetap layak diperbaiki.

---

## 1. Temuan Keamanan

### S1. `app:openExternal` hanya memvalidasi skema, bukan host (LOW)
`src/backend/ipc/system.js:21-26` menerima URL `https?://` apa pun dan meneruskannya ke `shell.openExternal`. Renderer (melalui preload) bisa membuka tautan eksternal sebarang, termasuk `https://malicious.example`. Bukan eskafasi fatal karena pembatasnya hanya skema, tidak ada host allowlist.
- **Rekomendasi**: terapkan allowlist host yang sama (`policy.ALLOWED_HOSTS` + host login OAuth) atau serahkan ke dialog konfirmasi `safeOpenExternal`. Minimal pertimbangkan `!shell.openExternal` pada skema non-http sudah benar (sudah).

### S2. Handler `will-navigate` jendela login: `isLoginHost` mengizinkan suffix `..google.com` yang berbahaya (MEDIUM)
`src/backend/services/scraper.js:181-189` membangun allowlist dengan `host === suffix.slice(1) || host.endsWith(suffix)`. `host.endsWith('.google.com')` menerima `evil.google.com` (masih di-kendalikan Google, dapat ditoleransi) — namun kombinasi `host === suffix.slice(1)` plus `endsWith` juga menerima **`google.com.evil.com`? Tidak** (tidak berakhiran `.google.com` dan tidak sama dengan). Titik yang lebih tajam: suffix `.twitter.com`/`.x.com` ditulis tanpa logika masa transisi — dua-duanya valid. Risiko nyata rendah: popup OAuth di jendela login non-sandbox-free tetapi `contextIsolation: true, sandbox: true` dan `nodeIntegration: false`. Namun navigasi keluar dibuka via `shell.openExternal` di `will-navigate` saat host ditolak (baris 200-206), sehingga penolakan tidak benar-benar memblokir.
- **Rekomendasi**: pastikan daftar OAuth bersifat eksplisit (exact host) untuk `.google.com`, `.facebook.com`, `.apple.com`, `.microsoft.com`; jika suatu host tidak dikenali, cukup blokir tanpa `openExternal`, atau minta konfirmasi.

### S3. Preload mengekspos `onEvent` tanpa validasi tipe callback (INFO)
`src/preload/preload.js:55-59` menerima callback sebarang dan memanggilnya dengan data event dari main. Karena `contextBridge` menjembatani argumen dengan serialisasi, risiko rendah; namun bila renderer tidak memvalidasi, callback non-fungsi akan melempar saat event pertama.
- **Rekomendasi**: validasi `typeof callback === 'function'`, sekaligus batasi payload event ke bidang yang dibutuhkan UI.

### S4. Log aktivitas ditulis tanpa sanitasi akhiran baris (LOW)
`src/backend/services/worker.js:49-58` menulis `JSON.stringify(evt)` ke `activityLogPath` via `appendFileSync`. `evt` memuat `username`, `error`, dll. `JSON.stringify` selalu escape `\n` sehingga injeksi baris log tidak praktis. Aman; hanya dicatat.

### S5. `avatarUrl` remote tidak pernah ditulis ke DB — mitigasi kebocoran/CSP baik (INFO, positif)
`src/backend/services/worker.js:24-37` mengganti `profile.avatarUrl` dengan path lokal setelah `cacheAvatar`; bila unduhan gagal nilai menjadi `null`. Ini mencegah referensi avatar remote masuk DB/UI. Dipertahankan.

### S6. Content script IG/TikTok berjalan di isolated world tanpa `chrome.*` (INFO, positif)
`src/scraper-content/*.js` dipasang via `executeJavaScriptInIsolatedWorld(WORLD_ID=999)`; window pekerja `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Content script tidak bisa menyentuh Node/ipc. `fetch` TikTok memakai `credentials: 'include'` pada origin yang sama (`www.tiktok.com`), relatif wajar.

---

## 2. Temuan Keandalan / Kebenaran

### R1. `numberFromDigits` ambigu untuk satu pemisah ribuan (LOW)
`src/scraper-content/common.js:25-38`. Untuk satu separator, `parseCount('1.234')` diperlakukan ribuan (1234) bila ekor 3 digit dan *tanpa suffix*, sedangkan `'1.234' + "suka"` diperlakukan desimal (1.234). Instagram kerap menampilkan format campur (`1.234 suka` dari locale). Ambigu ini bisa meleset 1000× pada angka kecil.
- **Rekomendasi**: utamakan `title`/aria yang presisi (sudah dilakukan di DOM path), dan konsistenkan aturan desimal-vs-ribuan berdasarkan sufiks serta jumlah digit.

### R2. `extractFromMetaTags` regex caption bisa menangkap teks di luar kutip (LOW)
`src/scraper-content/ig-scraper.js:47-51` memakai `/:\s*["“”]([\s\S]+)$/` — greedy terhadap seluruh sisa; pemangkasan hanya di akhir. Bila meta description berisi dua bagian ber-kutip, caption bisa kelebihan teks.
- **Rekomendasi**: batasi ke satu pasang kutip (`/"([^"]*)"\s*$/`) atau potong di titik-dua terakhir yang jelas.

### R3. IG `scrapePost` menandai `PARTIAL` saat views null walau post foto (INFO)
`src/scraper-content/ig-scraper.js:372-378`. Cabang `isVideoContent` membedakan video/reel; foto tanpa views tidak diberi `PARTIAL` bila likes+comments ada — benar. `viewsMissingReason` ditulis namun `result.error` null. Konsisten dengan test TaskCache.

### R4. `countsFromMetaDescription` merangkai `COUNT_TOKEN.source` ke dalam `new RegExp` dengan label (INFO, aman)
`src/scraper-content/ig-scraper.js:383-391`. Tidak ada input user yang masuk ke pattern (hanya label tetap), jadi tidak ada ReDoS/injeksi regex.

### R5. `fetchItemListPosts` memanggil endpoint TikTok dari dalam content script tanpa fallback bila respons non-200 (LOW)
`src/scraper-content/tk-scraper.js:309-344`. Timed out 8 detik, `response.ok` dicek, lalu `gridPosts()` dipakai sebagai fallback di `scrapeProfile`. Cukup.

### R6. `outcomeOf` menganggap semua `FAILED` berkode THROTTLED/AUTH sebagai "blocked" — termasuk galat jaringan yang salah klasifikasi (INFO)
`src/backend/core/policy.js:69-88` + `classifyError`. `classifyError` memetakan pesan `fetch/network/timeout` ke `TRANSIENT`, tetapi pesan dari platform di content script yang menyebut "try again later" menjadi `THROTTLED`. Ini diinginkan sebagai proteksi circuit-breaker, hanya perlu disadari saat tuning.

---

## 3. Observasi Positif (diverifikasi dari test)

- **Formula injection** dinetralkan: `export.js:sanitizeCell` + `export.test.js` (periksa `=`, `+`, `-`, `@`, tab, CR).
- **Allowlist host persis**: `policy.allowedTarget` menolak suffix (`instagram.com.evil.com`) — `policy.test.js`.
- **Normalisasi URL** membuang query tracker, menyamakan `/reels/` → `/reel/`, menolak profil — `util.test.js`.
- **parseLinksText/parseImportFile** menangani CSV multi-baris ber-kutip, BOM, cp1252 fallback, truncation — `import.test.js`.
- **Database** menjalankan banyak invariant: duplikat, retry-skip-PERMANENT, restore menolak DB aktif & skema lama, timeseries 30 hari — `db.test.js`.
- **Intel** menolak O(n²) dengan fan-out cutoff token >50 akun, deteksi caption template/konten kembar/followers datar — `intel.test.js`.
- **Rate limiter** menjaga budget siklus, jepit MAX_DELAY, reset warm-up — `rateLimiter.test.js`.
- **TaskCache** menolak baris kedaluwarsa & tanpa angka, OK untuk foto tanpa views — `taskCache.test.js`.
- **Storage** tahan file JSON korup — `storage.test.js`.

## 4. Rekomendasi Prioritas

| Prioritas | Item |
|---|---|
| P1 (sebelum rilis luas) | S2 — perketat allowlist OAuth jendela login; S1 — pertimbangkan host allowlist `openExternal` |
| P2 (hardening) | R1 — resolusi ambiguitas parseCount; S3 — validasi callback `onEvent` |
| P3 (polish) | R2 — regex caption meta IG lebih ketat |

## 5. Cakupan yang Membutuhkan Uji Tambahan

- Tidak ada unit test untuk `scraper-content/*` (parseCount/truncateText/errorResult/recentPosts) — murni karena berjalan di DOM; layak diuji terpisah dengan `node:test` + mock `globalThis.SA_CONTENT`.
- Tidak ada test integrasi untuk `createScraper` (navigasi nyata) — wajar untuk environment CI tanpa Electron GUI, dicatat sebagai utang.
- Test tidak mengeksekusi handler IPC secara langsung; penambahan test argumen tak valid pada `data:importLinks`, `data:retryTargets`, `review:set` akan menutup celah regresi.