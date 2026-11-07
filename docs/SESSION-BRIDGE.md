# Sesi eksternal — sunscrap bridge

Fitur "Hubungkan browser" memakai **sesi** (cookie) dari browser yang sudah login
ke Instagram/TikTok, lalu menyinkronkannya **terus-menerus** — tanpa perlu login
ulang di dalam aplikasi. Opsi login manual di dalam aplikasi tetap tersedia.

## Cara kerja

```
┌ Browser hidup (Chrome/Edge/Brave) ──┐        ┌ aplikasi sunscrap ───────────┐
│  ekstensi "sunscrap bridge"         │  HTTP  │  bridge server (loopback)     │
│  • chrome.cookies.getAll (IG/TikTok)┼───────►│  • 127.0.0.1:43110/cookies    │
│  • push tiap 30 detik (alarm)       │        │  • cookies.set -> persist     │
└─────────────────────────────────────┘        │  • broadcast -> UI refresh    │
                                               └──────────────────────────────┘
```

- Semua aliran hanya lewat **`127.0.0.1`** (localhost) — cookie tidak diunggah
  ke internet. Dekripsi/pembacaan dilakukan oleh ekstensi di dalam browser yang
  dipercaya, bukan oleh aplikasi (menghindari blokir App-Bound Encryption Chrome/Edge).
- Cookie yang disinkron: Instagram (`sessionid`, `ds_user_id`, `csrftoken`, `rur`, `mid`) dan
  TikTok (`sid_tt`, `sid_guard`, `sessionid`, `ttwid`). Penamaan mengikuti pengecekan `app:loginStatus`.

## Kenapa bukan "baca langsung cookie browser"?

Chrome & Edge sejak 2024–2025 memakai **App-Bound Encryption** — cookie dienkripsi
dan kuncinya dilindungi layanan Chrome, sehingga program luar tidak bisa membacanya.
Ekstensi (yang berjalan *di dalam* browser dan berhak atas API `chrome.cookies`)
adalah jalur yang andal dan legal terhadap arsitektur tersebut. Firefox menyimpan
cookie tanpa enkripsi, tetapi saat ini jembatan memakai jalur ekstensi yang seragam
(akan tetap bekerja bila ekstensi dipasang di browser berbasis Chromium).

## Memasang ekstensi (sekali saja)

1. Buka Chrome/Edge → `chrome://extensions` (Edge: `edge://extensions`).
2. Aktifkan **Developer mode** (kanan atas).
3. **Load unpacked** → pilih folder **`src/extension/`**.
4. Pastikan browser yang sama sudah **login** ke Instagram (dan TikTok bila perlu).
5. Buka aplikasi sunscrap → tab **Sesi & Login** → kartu **"Hubungkan browser"**.
   Begitu ekstensi mengirim sesi pertama, status berubah menjadi *masuk*, dan
   sesi terus disinkron tiap ~30 detik.

## Keamanan

- Port tetap **43110**, hanya di-loopback. Bila port bentrok, aplikasi menampilkan
  notifikasi "jembatan tidak aktif" (port dinamis tidak dipakai agar ekstensi statis).
- Cookie yang diterima hanya ditulis ke partisi `persist:sunscrap` milik aplikasi.
- Matikan ekstensi (atau hapus) bila tidak diperlukan.