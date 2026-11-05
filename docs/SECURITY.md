# Keamanan & Privasi

Dokumen ini merangkum model ancaman, kontrol yang sudah ada, dan batasannya. Untuk kebijakan rilis &
tanda tangan installer, lihat [../PLAN-AUTO-UPDATE-2026-11-05.md](../PLAN-AUTO-UPDATE-2026-11-05.md).

## Prinsip

1. **Lokal penuh.** Tidak ada server, telemetri, atau pengiriman data pengguna ke pihak ketiga.
2. **Permukaan minimal.** Semua akses jaringan hanya ke host Instagram/TikTok (dan CDN avatar yang di-allowlist).
3. **Renderer tidak dipercaya penuh.** `contextIsolation`, `nodeIntegration:false`, `sandbox`, CSP ketat, IPC berbatas.
4. **Defense in depth.** Validasi di titik masuk (IPC), lapisan data (SQL parameterized), dan penyajian (escaping).

## Perimeter jaringan

- **Allowlist host persis** (`policy.ALLOWED_HOSTS`, juga `util`): `instagram.com`, `www./m.instagram.com`,
  `tiktok.com`, `www./m./vm./vt.tiktok.com`. Bukan pencocokan suffix — `evil-instagram.com` ditolak.
- **Navigasi jendela worker** menolak URL di luar allowlist; `setWindowOpenHandler` selalu `deny`.
- **Jendela login** hanya boleh navigasi ke host IG/TikTok + penyedia OAuth umum (Google/Facebook/Apple/Microsoft/Twitter);
  host lain dibuka di browser luar.
- **Jendela utama** hanya boleh memuat dokumen renderer sendiri (`fileURLToPath` dibandingkan dengan `index.html`).
- **Tab Browser (webview)** di-harden di `will-attach-webview`: hapus `preload`, paksa `sandbox`, `contextIsolation`,
  `nodeIntegration:false`. Navigasi ke luar host sosial dibuka di browser luar.

## Renderer

- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: sa-avatar:; object-src 'none'; base-uri 'none';`
  — **tidak boleh** ditambah `https:` pada `img-src` (akan membocorkan IP/waktu ke CDN).
- Tidak ada handler inline di HTML; semua interaksi lewat listener JS (delegasi `data-close`).
- Semua interpolasi `innerHTML` melewati `esc()` (termasuk nilai atribut ber-tanda-kutip ganda).

## Avatar (privasi)

`avatar.js` mengunduh avatar sekali ke `userData/avatars/` lalu disajikan lewat skema lokal `sa-avatar:///`:

- Hanya `https://`, tanpa kredensial di URL.
- **Allowlist host CDN**: `*.cdninstagram.com`, `*.fbcdn.net`, `*.fbsbx.com`, `instagram.com`, `*.tiktokcdn.com`, `*.byteoversea.com`, `*.bytepcdn.com`, `*.byteimg.com`, dll.
- Validasi ulang host **setelah redirect**.
- Batas ukuran 3 MB (`Content-Length` + panjang byte); tolak <100 byte.
- Cek **magic bytes** (JPEG `FF D8 FF` / PNG `89 50 4E 47`).
- Bila unduhan gagal → `avatar_url = NULL` (URL remote **tidak pernah** disimpan).
- `resolveAvatar` memakai `path.basename` (anti path-traversal).
- Renderer hanya menerima nama file lokal; `sa-avatar:///${encodeURIComponent(name)}`.

## Data & SQL

- **100% parameterized**; tidak ada interpolasi input pengguna ke SQL. Nilai `ORDER BY` berasal dari peta statis.
- Pencarian `LIKE` meng-escape `\ % _` + `ESCAPE '\'` (mencegah wildcard tak terduga; bukan SQL injection).
- Transaksi `BEGIN IMMEDIATE` untuk setiap operasi tulis multi-tabel.
- Simpanan JSON (`worker-state.json`, `window-state.json`) ditulis via file temp + rename atomik.

## Backup / restore

- `VACUUM INTO` (bukan copy file mentah) untuk konsistensi WAL.
- Restore menolak sumber = DB aktif, dan menolak skema ≠ `SCHEMA_VERSION`.
- Safety backup dibuat **sebelum** swap; kegagalan tidak pernah menghapus data aktif.
- Export Excel menyanitasi formula injection (`= + - @ \t \r` → prefiks `'`).

## Batasan & risiko yang diketahui

- **ToS platform.** Pengambilan data publik tanpa API resmi dapat melanggar ketentuan Instagram/TikTok; akun operator bisa dibatasi/diblokir. Sudah dinyatakan jujur di README.
- **Perangkat ini menyimpan sesi login** di partisi Electron `persist:sunscrap`. Siapa pun dengan akses filesystem ke `userData` dapat memakainya. Lindungi akun OS.
- **Installer belum ditandatangani** saat ini (`signAndEditExecutable: false`) → Smart App Control/SmartScreen bisa memblokir di mesin lain. Untuk publik, signing adalah prasyarat; pipeline menyiapkan tanda tangan **SignPath Foundation** (langkah masih dikomentari sampai approval). Selama belum ditandatangani, `verifyUpdateCodeSignature: false` (update tidak memverifikasi Authenticode) — **aktifkan `true` bersamaan dengan signing.** Lihat [../PLAN-AUTO-UPDATE-2026-11-05.md](../PLAN-AUTO-UPDATE-2026-11-05.md).
- **Endpoint internal TikTok** (`item_list`) dipanggil dari isolated world dengan kredensial sesi; ini disengaja untuk melengkapi daftar posting terbaru.
- `snapshots` tidak di-retensi; pertumbuhan DB tanpa batas pada pemakaian panjang.

## Pelaporan masalah keamanan

Saat ini tidak ada alamat keamanan khusus. Untuk penggunaan pribadi, catat temuan di issue repo.
