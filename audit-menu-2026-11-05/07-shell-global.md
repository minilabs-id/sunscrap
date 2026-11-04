# Laporan Audit UI/UX — Shell Global *(lampiran: pembungkus keenam menu)*

**Tanggal:** 2026-11-05 · **Cakupan:** titlebar custom, sidebar, statusbar, modal & toast global — elemen yang terlihat di semua menu.
**Skor:** C+ · **Bukan halaman menu**, tapi menentukan rasa semua menu; dipisah di sini agar keenam laporan menu tetap murni 1-menu-1-laporan.
**Basis:** HEAD `6e0b480` + working tree. `index.html:10-35, 255-264` · `styles.css:42-116, 181-236, 261-281` · `main.js:201-258, 130-199`.

---

## Yang sudah baik

- Sidebar: grup berlabel (Utama/Pekerjaan/Alat/Sistem), `aria-label` nav, item aktif dengan `aria-current="page"`, indikator inset oranye (`styles.css:92-109`).
- Worker widget sidebar: dot status + tombol utama + subteks siklus (`index.html:27-34`) — titik orientasi terbaik yang dimiliki app.
- Statusbar 28px: worker • audit • DB • versi — orientasi permanen tanpa buka apa pun (`index.html:255-261`).
- Modal: `role="dialog" aria-modal`, backdrop klik, Esc, trap Tab, restore fokus, `body.modal-open` menonaktifkan `.layout` (`app.js:118-153`).
- Toast: `role=status` + `aria-live`, error 8 detik, maksimal 3 antrean (`app.js:104-114`).
- Window state persisten (posisi/ukuran/maksimize) (`main.js:201-258`); single-instance; close → tray.
- Titlebar context ikut tab + nama audit (`updateTitlebarContext`, `app.js:186-193`).

## Kritik & temuan

### [P1] H-01 — `titleBarOverlay` putih keras; dark mode berhenti di batas jendela
- **Bukti:** `titleBarOverlay: { color: '#ffffff', symbolColor: '#101828', height: 40 }` (`main.js:214`) — statis, tidak berubah saat tema gelap; `.titlebar` CSS-nya `var(--surface)` (`styles.css:43-53`) → sisi gelap, tombol min/max/close Windows tetap putih dengan ikon gelap.
- **Kritik:** dua jendela warna berdampingan di tepi atas; kesan "dijahit separuh".
- **Arah:** pilih satu: (a) hapus `titleBarStyle:'hidden' + titleBarOverlay` dan pakai `titleBarStyle:'default'` (Windows native, sadar tema otomatis, kehilangan padding-kanan 150px), atau (b) saat `applyTheme`, panggil IPC `win:titlebarTheme` yang menyetel `mainWindow.setTitleBarOverlay({ color, symbolColor })` dari renderer — dua baris di preload. Pilihan (b) mempertahankan chrome kustom yang sudah rapi.

### [P1] H-02 — `.layout` dikunci saat modal, tapi **titlebar & statusbar tidak**
- **Bukti:** `body.modal-open .layout { pointer-events:none }` (`styles.css:30`) — `.titlebar` dan `.statusbar` berada di luar `.layout` (`index.html:10-12, 37-253, 255`) → tetap bisa diklik di atas modal.
- **Kritik:** klik statusbar `Proses` saat modal Export terbuka → tab berpindah di belakang modal (state berubah, modal tetap di atas — disorienting); titlebar drag/double-click maximize tetap aktif meski konten dikunci.
- **Arah:** perluas selector: `body.modal-open .layout, body.modal-open .statusbar { pointer-events:none }`; untuk titlebar, drag boleh tetap (UX standar Windows), tapi hilangkan fokus keyboard: `tabindex=-1` pada elemen interaktif — cukup pointer-events + `inert` attribute pada keduanya bila diinginkan ketat.

### [P1] H-03 — Statusbar item: `<span>` klik, bukan tombol — keyboard mati total
- **Bukti:** `<span id="sb-worker" class="sb-item" data-tab="proses">` dst. (`index.html:256-258`) + `addEventListener('click')` (`app.js:737-742`).
- **Kritik:** dua dari tiga segmen statusbar tidak bisa difokus; fungsi navigasi krusial (ke Proses / ke Dashboard) hanya mouse.
- **Arah:** jadikan `<button class="sb-item">` dengan reset style; Esc/Enter otomatis jalan; `:focus-visible` sudah ada global.

### [P1] H-04 — Versi `v1.0.0` ditulis 3 kali, bisa menyimpang
- **Bukti:** `index.html:260` "v1.0.0" · `main.js:29` `APP_VERSION='1.0.0'` · `package.json:3` `1.0.0`.
- **Kritik:** tiga sumber kebenaran; saat rilis berikutnya, statusbar pasti tertinggal.
- **Arah:** preload expose `appVersion: () => ipcRenderer.invoke('app:version')` atau lebih simpel: main meng-inject `document.title`/statusbar via event sekali saat boot (`broadcast('version', …)`) — atau baca `package.json` di main dan kirim sekali `window.sunscrap.version` via preload konstan. Hapus literal HTML.

### [P2] H-05 — Indikator aktif sidebar memakai `--warn` (oranye = peringatan)
- **Bukti:** `.nav-link.active { … box-shadow: inset 3px 0 0 var(--warn) }` (`styles.css:107`).
- **Kritik:** oranye/amber semantik "perhatian" dipakai sebagai penanda "Anda di sini" — namun warna brand aplikasi adalah biru (`--brand`); oranye hanya ada di ☀ brand dan aksi destruktif-semu. Bahasa warna app jadi ambigu: oranye = bingung (peringatan? halaman?).
- **Arah:** `box-shadow: inset 3px 0 0 var(--brand)` — konsisten dengan link/focus; atau `--warn` disimpan khusus untuk aksi berbahaya/gagal.

### [P2] H-06 — Worker dot: tiga state, dua makna, satu warna untuk pending & running
- **Bukti:** `.dot` default abu (`styles.css:112`), `.dot.active` hijau + glow hardcoded `rgba(5,150,105,.15)` (`styles.css:113`), `.dot.error` merah (`styles.css:114`); label "Siaga"/"Aktif"/"Terhenti" (`app.js:220`).
- **Kritik:** (a) warna hijau glow hardcoded tidak tersentuh token dark-mode; (b) "Terhenti" (merah) dipakai untuk error **dan** worker yang sengaja dihentikan user — dua makna bertolak belakang; (c) "Siaga" tak dibedakan dari "mati".
- **Arah:** token `--ok-soft` / `--ok-ring` di :root & dark; bedakan `status: idle | running | stopped | error` dari worker (main sudah punya `lastError` — tambahkan flag `stoppedByUser`); "Terhenti" (user) = abu, "Terhenti (error)" = merah.

### [P2] H-07 — `⟳`, `‹`, `›`, `✕`, `☀`, `＋` — glyph campur aduk tanpa set ikon
- **Bukti:** `index.html:14, 125-130, 175-177, 260` · `app.js` banyak; font fallback Windows menampilkan tiap glyph dari font berbeda; bobot visual tidak seragam; fullwidth `＋` di tombol Import (`index.html:52`).
- **Arah:** satu set SVG inline (±20 ikon: sun, dashboard-grid, target, users, queue/list, browser, gear, play/stop, download, upload, trash, refresh, chevron, x) — ~6 KB, menghilangkan semua ketergantungan font glyph; sekaligus membuat `aria-hidden="true"` terkontrol. Ini biaya satu sore, hasil permanen.

### [P2] H-08 — Sidebar tidak bisa dikecilkan; 230px kaku di window 1024px
- **Bukti:** `.sidebar { width:230px; flex: 0 0 230px }` (`styles.css:76-84`); min window `1024` (`main.js:208`).
- **Kritik:** pada 1024px, konten target tabel 11 kolom mendapat ~750px — terjepit; pengguna tak punya pilihan selain maximize (padahal maximize dulu dipaksa, sekarang tidak).
- **Arah:** rail mode 56px (ikon saja + tooltip + worker dot) via toggle chevron di bawah sidebar atau `Ctrl+B`; state simpan di `localStorage`; atau auto-collapse <1200px.

### [P2] H-09 — Titlebar title & `document.title` menggandeng nama audit panjang
- **Bukti:** `${tab} · ${audit.name}` (`app.js:189`) tanpa truncation; nama audit "Kampanye Desember 2026 Batch 4 — klien XYZ" meluber.
- **Arah:** `…` setelah ~48 karakter; `title`/tooltip berisi penuh.

### [P2] H-10 — `#toast-root` di atas segalanya, tanpa batas tinggi
- **Bukti:** `#toast-root { … z-index:100 }` (`styles.css:262`); stack max 3 (`app.js:112`) tapi tanpa `max-width` — toast panjang satu baris bisa 70% lebar window di layar kecil.
- **Arah:** `max-width: min(420px, 90vw)`; border-radius & shadow konsisten; ikon status per jenis (✓ ! ⚠) dari set H-07.

### [P3] H-11 — Brand `☀ sunscrap` — matahari abu? bukan, oranye (`--warn`) — konsisten dgn ☀ tapi…
- **Kritik:** tidak ada link ke mana pun (brand statis — OK), tapi `aria` tidak menandai ini sebagai judul aplikasi; dan varian gelap tak punya tint berbeda.
- **Arah:** `<div class="brand" role="heading" aria-level="1">`? — berlebihan: cukup `title` & letterspacing audit; biarkan.

### [P3] H-12 — `prefers-reduced-motion` ada; `focus-visible` ada — tapi `:focus` global untuk `.input` pakai offset -1px
- **Bukti:** `.input:focus { outline: 2px solid var(--brand); outline-offset: -1px }` (`styles.css:154`) — outline inset, bukan ring eksternal seperti `:focus-visible` global (offset 2px).
- **Arah:** samakan ke offset 2px agar konsisten dengan tombol; inset ring menabrak border input.

## Prioritas perbaikan

1. **H-01, H-02, H-03** — three mudah, dampak langsung pada modal & tema.
2. **H-04, H-05, H-06** — konsistensi semantik (versi, warna aktif, status worker).
3. **H-07, H-08** — set ikon + sidebar rail.
4. **H-09 … H-12** — polesan.
