# Rencana Penerapan Blueprint v2 — sunscrap

> Peta eksekusi untuk mewujudkan [`UIUX-BLUEPRINT.md`](UIUX-BLUEPRINT.md) (v2) ke kode nyata.
> Disusun terurut nilai/risiko; tiap fase independen, bisa di-revert, dan diakhiri verifikasi.

## Kondisi sekarang (sudah ada)

- ✅ Token warna netral + aksen indigo + status semantik, spacing/motion/shadow (styles.css).
- ✅ Triage queue (review-state.json, pill, panel, filter, hitungan, export).
- ✅ Command palette Ctrl+K (aksi + search), onboarding, render gate (summarySignature).
- ✅ Logika murni terpisah & teruji: `format.js`, `store.js` (79 test + e2e hijau).
- ✅ Backend sudah menyedia data: `clusters`, `flags`, `score`, `queueStats`, `worker.status.rate`.

---

## Fase 0 — Quick wins (benar-dan-jelas dulu)

**F0.1 — Donut → 3 segmen bermakna** `renderDonut` (app.js)
- Gabung "partial" ke "berhasil"; segmen jadi: **berhasil · menunggu · gagal** (hijau/abu/merah) → pembagian jelas.
- Acceptance: donut terbaca tanpa belepotan; center tetap total.
- Verifikasi: manual screenshot; `npm test`; `npm run e2e`. — Risiko: **Rendah**.

**F0.2 — Normalisasi Skor Kualitas 0–100** `intel.js` + `app.js`
- Petakan `score` (bit/poin) → skala 0–100 stabil; tampil menonjol di kartu akun + modal + pill.
- Acceptance: satu angka "Skor kualitas", konsisten di semua tempat; label "indikasi, bukan vonis".
- Verifikasi: unit test pemetaan skor (pure). — Risiko: **Rendah**.

---

## Fase 1 — Evidence & Cluster (pembeda utama)

**F1.1 — Panel Bukti yang kuat** `openAccount` + `showScoreHelp` (app.js)
- Modal detail jadi "bukti dulu": daftar flag (label + poin + detail), akun tertaut, seri bulanan; disclaimer menonjol.
- Acceptance: user mengerti *kenapa* skor tinggi tanpa baca kode.
- Verifikasi: e2e buka modal akun (bila data ada). — Risiko: **Rendah**.

**F1.2 — Cluster view** (baru, pakai `clusters` yang sudah ada)
- Layar/panel "Klaster": daftar akun tertaut + bukti bersama, navigasi antar-anggota.
- Acceptance: operator bisa lihat kelompok akun kembar & alasannya; klik anggota → buka akun.
- Verifikasi: unit test render clusters (murni); e2e bila feasible. — Risiko: **Sedang**.

---

## Fase 2 — Runtime observability (job panjang)

**F2.1 — Surface error yang tak sunyi** `loadProcess` + `worker.js`/`ipc.js`
- Tampilkan error terbaru + taksonomi (throttle/login/privat) sebagai baris, bukan konsol.
- Acceptance: operator tahu kenapa worker berhenti/lambat dalam <5 detik.
- Verifikasi: `grep catch{}` = 0; e2e. — Risiko: **Sedang**.

**F2.2 — Progress & kontrol** `rateLimiter` + panel Proses
- Proyeksi sisa waktu, budget siklus, tombol pause/resume/cancel yang jelas.
- Acceptance: status "berapa lama lagi" terlihat; aksi tak merusak state.
- Verifikasi: e2e toggle worker. — Risiko: **Sedang**.

---

## Fase 3 — Command Center (entry-point)

**F3.1 — Layar masuk "Command Center"** (restruktur `tab-dashboard`)
- Tiga zona: **status strip** (worker/login/terakhir), **"Perlu tindakan"** (triage kompak + gagal + mencurigakan), **health** (KPI + satu tren).
- Kartu sekunder yang sudah di "Insights" dipindah/deep-link ke Target/Akun (bukan disingkirkan diam-diam).
- Acceptance: dalam 5 detik terjawab "sehat? ada yang perlu dikerjakan? rusak?".
- Verifikasi: e2e + screenshot baseline. — Risiko: **Tinggi** (lakukan setelah Fase 0–2).

---

## Fase 4 — Report (deliverable)

**F4.1 — View laporan terstruktur** `export.js` + modal Export
- Narasi: ringkasan → temuan autentisitas → engagement → rekomendasi (bukan dump Excel).
- Acceptance: satu laporan terbaca sebagai "hasil audit", siap dibagi.
- Verifikasi: unit test rekap (pure) + e2e export path. — Risiko: **Sedang**.

---

## Fase 5 — Keyboard navigation

**F5.1 — Navigasi `G` ala Linear** `bindEvents` + menu
- `G+1…6` pindah tab, `G+T` ke triage, `Ctrl+K` aksi utama; tampilkan di tooltip/hint.
- Acceptance: flow utama 100% keyboard.
- Verifikasi: e2e key shortcut. — Risiko: **Rendah**.

---

## Fase 6 — Polish & aksesibilitas

- Density mode diperkuat; empty/loading/error state konsisten di semua panel.
- Audit kontras + `aria`; test fokus keyboard pada grafik & tabel.
- Verifikasi: pass WCAG manual checklist. — Risiko: **Rendah**.

---

## Kriteria selesai global (per fase)

- `npm test` hijau (bertambah test murni baru), `node --check` bersih, `npm run e2e` hijau.
- 0 `catch {}` tanpa penanganan; `console/page errors: tidak ada`.
- Screenshot terang+gelap tersimpan di `.screens/` untuk review visual (manual).
- Commit atomik per item, di-push ke `origin/master`.

## Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Fase 3 (restrutur entry) regresi banyak | Kerjakan setelah modul Fase 0–2 ada; feature-flag; e2e sebagai jaring |
| Data klaster/score berubah skala | Pemetaan skor jadi fungsi murni teruji; UI baca satu sumber |
| Job panjang state racing | Pertahankan render-gate; patch DOM (bukan rebuild) |

## Urutan eksekusi yang saya sarankan

`F0 → F1 → F2 → F3 → F4 → F5 → F6` — mulai dari **F0.1 (donut)** karena murah dan langsung terlihat benar.