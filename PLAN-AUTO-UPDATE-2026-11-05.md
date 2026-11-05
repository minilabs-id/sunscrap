# Plan — Auto-update sunscrap dari rilis GitHub (untuk semua pengguna)

**Tanggal:** 5 Nov 2026 · **Oleh:** audit-otomatis · **Basis:** repo `startupmini/sunscrap` (public, MIT, 0 rilis, branch `master`) · **Target:** Windows (NSIS) · **Status:** PLAN — belum ada kode yang diubah

Rekomendasi utama dalam satu kalimat: **tangani sebagai "rilis bertahap + tanda tangan digital", bukan sekadar "pasang autoUpdater"** — tanpa code signing Windows, auto-update untuk publik akan gagal di mesin pengguna (Smart App Control memblokir installer unsigned; SmartScreen memajang "unknown publisher").

---

## 1. Keputusan utama (ringkas)

| # | Keputusan | Rekomendasi | Alasan singkat |
|---|---|---|---|
| K-1 | Mekanisme update | `electron-updater` (dari ekosistem electron-builder), bukan Squirrel / update manual | Satu-satunya jalur resmi Windows+NSIS+GitHub Releases; differential update (blockmap); butuh code |
| K-2 | Konten distribusi | GitHub Releases di repo ini (sudah **public** ✓) | Updater butuh akses anonymous; repo public memenuhi ini tanpa infrastruktur tambahan |
| K-3 | Tanda tangan | **Azure Trusted Signing** (~$9,99/bln ≈ $120/thn) atau **OV certificate** ($108–400+/thn) | Smart App Control & SmartScreen; **tanpa signing, "untuk siapa saja yang pasang" tidak akan jalan** |
| K-4 | Pipeline rilis | GitHub Actions: tag `v*` → windows-latest → build+sign+publish otomatis | Konsisten, repeatable, secret tidak pernah di mesin pribadi |
| K-5 | Metadata update | `latest.yml` + `.blockmap` (differential) + (opsional/v27) manifest Ed25519 | Update kecil (KB untuk perubahan 1 baris), integritas diverifikasi |
| K-6 | UX update | Auto-check saat boot + tiap 6 jam; banner/tombol "Muat ulang & perbarui" di UI; tray menu | Tidak memaksa, tidak menyembunyikan, pengguna memegang kendali restart |
| K-7 | Instalasi awal | Rilis pertama (v1.1.0) harus dipasang **manual**; sejak v1.1.1 updater aktif penuh | Installer lama (1.0.0) tidak punya updater bawaan |

**Estimasi biaya tetap:** $0 (GitHub Actions, public repo) + **$9,99/bln** Azure Trusted Signing (atau OV $108–400+/thn). **Tenaga:** ~1–1,5 hari kerja (Fase 1–4) + waktu verifikasi identitas Microsoft (bisa beberapa hari kerja) + QA rilis pertama ~1 jam.

---

## 2. Kondisi saat ini — gap

| Aspek | Sekarang | Butuh |
|---|---|---|
| Installer | NSIS (`oneClick:false`, `perMachine:false` — **bagus, per-user, tanpa UAC**) | Pertahankan NSIS; tanpa UAC saat update |
| Signing | `signAndEditExecutable: false` → **unsigned** | Tandatangani (K-3); Smart App Control memblokir unsigned |
| Updater | Tidak ada; tidak ada `electron-updater` | Tambahkan modul + wiring main/preload/UI |
| Publish config | Tidak ada `publish` di `package.json` | `provider: github, owner: startupmini, repo: sunscrap` (eksplisit) |
| Rilis GitHub | **0 rilis** | Rilis v1.1.0 pertama (manual), lalu tag otomatis |
| `repository` field | Tidak ada di `package.json` | Tambahkan (membantu electron-builder menyimpulkan feed; tetap set eksplisit) |
| Versi | `package.json` 1.0.0; `APP_VERSION='1.0.0'` terduplikasi di `main.js` | Naikkan ke 1.1.0; single-source ke `package.json` |
| Workflow CI | Tidak ada `.github/` | `release.yml` (lihat §6) |
| Test signing | Tidak relevan | `forceCodeSigning: true` agar gagal bila secret salah |

Smart App Control (SAC) adalah alasan `START_sunscrap.bat` ada — itu hanya mengakali untuk **mesin pribadi**, tidak untuk distribusi publik. Plan ini mengganti pendekatan itu untuk pengguna.

---

## 3. Riset (dirangkum + sumber, Nov 2026)

Sumber utama: dokumentasi electron-builder v26 (stabil, dipakai repo ini) & v27 (next), dokumentasi Azure Trusted Signing, GitHub REST API (repo ini).

**3.1 Mekanisme auto-update di Windows**
- Auto-update Windows hanya didukung untuk target **NSIS** (Squirrel.Windows **tidak** didukung). [electron-builder Auto Update](https://www.electron.build/docs/features/auto-update)
- Alur: build menghasilkan `latest.yml` + `<installer>.blockmap`; `electron-builder --publish always` mengunggahnya ke GitHub Release bersama installer; aplikasi (via `electron-updater` di main process) membaca `latest.yml`, membandingkan versi dengan `app.getVersion()`, mengunduh delta (blockmap, hanya byte yang berubah) bila ada rilis lebih baru, memverifikasi checksum SHA-512 (dan tanda tangan Authenticode), lalu menginstal saat quit / lewat `quitAndInstall()`. [workflow & v26](https://www.electron.build/v26/docs/features/auto-update)
- `app-update.yml` (dibundel ke installer) menyimpan feed; `owner`/`repo` di `publish` **harus eksplisit** — kalau mengandalkan inferensi dari `.git/config`, siapa pun bisa "mengklaim ulang" namespace Anda bila Anda me-rename/menghapus repo. [Update feed ownership](https://www.electron.build/docs/features/security#update-feed-ownership)
- Differential update (blockmap v3 di v26+): perubahan 1 baris JS ≈ beberapa KB diunduh. Aktifkan `nsis.differentialPackage: "store-asar"` + `asar.contentAlignment: 512` agar 1 baris di asar tidak menggeser semua offset.
- Rate limit: provider GitHub publik memanggil API GitHub tanpa autentikasi (~60 req/jam/IP). Cukup untuk pemakaian normal; bila banyak pengguna di NAT yang sama kena 429, fallback = provider `generic` di GitHub Pages / Cloudflare R2 (lihat §9.4).
- Staged rollouts didukung: edit `stagingPercentage: 10` di `latest.yml` untuk canary 10% populasi.

**3.2 Tanda tangan — kebenaran yang tidak nyaman**
- electron-builder memverifikasi **Authenticode pada update Windows** (bukan hanya macOS): updater menolak installer yang tidak ditandatangani atau yang penerbitnya tidak cocok dengan `publisherName` di `app-update.yml`.
- **v27 (next)**: manifest update (`latest.yml`) **wajib** ditandatangani Ed25519 (`ELECTRON_BUILDER_UPDATE_SIGN_KEY`); publishing gagal tanpa kunci; installer tanpa `publisherName` menulis `app-update.yml` **gagal build**; `verifyUpdateCodeSignature` default `true`. (Repo ini masih di v25/26 → perilaku v27 mulai berlaku saat upgrade — upgrade itu bagian dari plan, §5.2.) [Signed Update Manifests](https://www.electron.build/docs/features/signed-update-manifests) · [Security & Hardening](https://www.electron.build/docs/features/security) · [v26 Windows Signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win)
- Smart App Control (Windows 11) **memblokir aplikasi yang tidak dikenal/unsigned secara diam-diam** — installer hasil update akan ikut diblokir bila unsigned. SmartScreen memajang "Windows protected your PC" untuk publisher baru; reputasi tumbuh per sertifikat+per unduhan (sejak 2024, EV tidak lagi memberi trust instan).
- Konsekuensinya: untuk "semua yang pakai", signing adalah **prasyarat wajib**, bukan opsi.
- Opsi paling murah & wajar: **Azure Trusted Signing** — $9,99/bln (5.000 tanda tangan/bln, cukup untuk rilis publik), tanpa HSM/dongle, dukung `signtool /dlib`; di electron-builder v25/26 via `win.azureSignOptions: {endpoint, codeSigningAccountName, certificateProfileName, publisherName}` + env `AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET`; di v27 via `win.sign: { type: "azure", … }`. [Azure Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/overview) · [pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/) · [GitHub Actions](https://www.electron.build/docs/features/github-actions#using-azure-trusted-signing)
- Verifikasi identitas (Individual/Org) bisa makan beberapa hari — mulai dari sini (§7, Fase 0).
- Alternatif: **OV certificate** dari CA (DigiCert/Sectigo/SSL.com) $108–400+/tahun — lebih lambat membangun reputasi, key bisa di-export (.pfx) jadi mudah untuk CI signtool klasik. EV tidak sebanding dengan biayanya pasca-2024.
- Gratis (`verifyUpdateCodeSignature: false`): bisa jalan, **tapi** update terpasang tanpa verifikasi tanda tangan dan SAC/SmartScreen tetap memblokir/mengganggu pengguna. **Tidak direkomendasikan untuk publik.**

**3.3 Rilis otomatis via GitHub Actions**
- Tag `v*` → `windows-latest` → `npm ci` → `npm test` (wajib) → `npx electron-builder --win --publish always` (eksplisit; v27 menghapus publish implisit) → release (draft atau langsung publish) dengan aset installer + `.blockmap` + `latest.yml`. [GitHub Actions](https://www.electron.build/docs/features/github-actions) · [Publish](https://www.electron.build/docs/publish)
- `permissions: contents: write` + `GITHUB_TOKEN` bawaan (tanpa PAT untuk public repo).
- Rilis pertama sebaiknya **manual via `workflow_dispatch`** (terkendali), rilis berikutnya tag otomatis.
- `latest.yml` penting: file-nya harus ikut di assets release (otomatis oleh `--publish always`).

**3.4 Keamanan pembaruan (yang plan ini pertahankan)**
- `verifyUpdateCodeSignature: true` + `publisherName` = pin penerbit (update dari penerbit lain ditolak meski checksum cocok).
- Checksum SHA-512 dari `latest.yml` selalu diverifikasi.
- (v27/upgrade) manifest Ed25519: mencegah "manifest jahat + artefak jahat" meski HTTPS/repo-compromise; kunci privat disimpan sebagai GitHub Secret; rotasi lewat bridge release.
- `forceCodeSigning: true`: build gagal (bukan "silently unsigned") bila secret signing hilang/salah.
- Tidak ada telemetri/pemantauan dalam app (keputusan privasi sadar): sinyal adhesi = jumlah download di halaman rilis GitHub.

**3.5 Tidak ada auto-update tanpa batas revisi**
- Update hanya maju (semver naik). Menarik rilis jelek = rilis versi lebih baru (mis. 1.1.3 "hotfix"), bukan edit rilis yang sama — beberapa installer 1.1.2 akan tetap pada 1.1.2 bila Anda menghapus/mengganti asetnya.
- Incompatible update: JANGAN menaikkan `user_version` skema DB tanpa migrasi — app lama crash membuka DB yang lebih baru. (Kita sudah menambah guard di K-5 audit: restore ditolak untuk skema ≠ v5; pertimbangkan migrasi bertingkat bila skema naik.)

---

## 4. Arsitektur terusul

```
Developer (push tag v1.1.1)
   └─ GitHub Actions (windows-latest)
        ├─ npm ci && npm test                    ← kalau merah, tidak rilis
        ├─ electron-builder --win --publish always
        │     ├─ NSIS per-user installer (download & run tanpa UAC untuk update)
        │     ├─ sign (Azure Trusted Signing; publisherName tertulis ke app-update.yml)
        │     ├─ differential blockmap (store-asar + contentAlignment 512)
        │     └─ latest.yml + installer.blockmap + installer → GitHub Release v1.1.1
        └─ release: artifacts attach otomatis

Aplikasi pengguna (v1.1.0, membawa updater)
   ├─ boot: 5 detik setelah ready → autoUpdater.checkForUpdates()
   ├─ tiap 6 jam (timer main process) → check ulang
   ├─ tray: "Periksa pembaruan…" (manual)
   ├─ Pengaturan → panel "Pembaruan": versi, cek sekarang, progres, "Muat ulang & perbarui"
   ├─ event → broadcast('update') → renderer (badge/toast) — CSP aman, tanpa remote fetch UI
   └─ setelah unduh: quitAndInstall() (default onQuit v27/v26) atau onNextLaunch — lihat K-6/Fase 2
```

Komponen baru di repo:
- `src/main/updater.js` — semua logika updater (init, event, interval, IPC-facing API).
- `src/main/main.js` — panggil `initUpdater()` setelah boot; tambah tray item; `APP_VERSION` dari `require('../../package.json').version`.
- `src/preload/preload.js` — `checkForUpdates()`, `installUpdate()`, `onUpdateEvent(cb)`.
- `src/renderer/index.html` + `app.js` — panel "Pembaruan" di tab Pengaturan (versi, tombol cek, progres, link "lihat catatan rilis" → `openExternal` ke halaman rilis).
- `.github/workflows/release.yml` — pipeline rilis.
- `package.json` — bump 1.1.0, `repository`, `build.publish`, `win.azureSignOptions`, `nsis.differentialPackage`, `electronUpdaterCompatibility: ">=2.16"` (atau biarkan default), `asar.contentAlignment`, `forceCodeSigning: true`, script `release`/`dist:full`.
- (Sisanya tidak ada yang berubah: schema DB, IPC lain, scraper — updater hanya sentuh permukaan rilis.)

---

## 5. Implementasi berfase

### Fase 0 — Prasyarat di luar kode (dikerjakan Anda, ±beberapa hari)
1. **Azure subscription + Trusted Signing Account + Certificate Profile** (Individual atau Organization — Individual cukup untuk OSS kecil; siapkan KTP/telepon; verifikasi bisa beberapa hari kerja). [quickstart](https://learn.microsoft.com/en-us/azure/trusted-signing/quickstart)
2. **Entra ID App registration** → buat client secret → assign role **Trusted Signing Certificate Profile Signer** ke service principal.
3. Catat: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (simpan nilai; hanya tampil sekali). Catat juga `publisherName` (CN persis dari profil sertifikat Azure, mis. `CN=startupmini, O=startupmini, L=Jakarta, C=ID`).
4. (Opsional tapi disarankan) Generate Ed25519 update-manifest key: `npx electron-builder create-update-key` → simpan output `ELECTRON_BUILDER_UPDATE_SIGN_KEY` (base64 PEM satu baris) sebagai secret.
5. Di GitHub: pastikan repo tetap **public**; buat file `RELEASES.md`/draft kebijakan rilis; tambahkan secrets Actions: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `ELECTRON_BUILDER_UPDATE_SIGN_KEY`.
6. Keputusan hosting cadangan: bila Anda ingin lepas dari rate limit GitHub atau repo jadi private — siapkan R2/Pages + provider `generic` (§9.4). Default: **tetap GitHub Releases**.

### Fase 1 — Konfigurasi build & package.json (±1 jam)
```jsonc
// package.json (perubahan inti)
{
  "version": "1.1.0",
  "repository": { "type": "git", "url": "https://github.com/startupmini/sunscrap.git" },
  "scripts": {
    "release": "electron-builder --win --publish always"
  },
  "build": {
    "publish": { "provider": "github", "owner": "startupmini", "repo": "sunscrap", "releaseType": "release" },
    "asar": { "contentAlignment": 512 },
    "win": {
      // hapus: "signAndEditExecutable": false
      "sign": { "type": "azure", "endpoint": "https://<region>.codesigning.azure.net/",
                "codeSigningAccountName": "<account>", "certificateProfileName": "<profile>",
                "publisherName": "CN=<CN dari profil sertifikat Azure>" },
      "verifyUpdateCodeSignature": true,
      "target": ["nsis"]
    },
    "nsis": { "differentialPackage": "store-asar", "oneClick": false, "perMachine": false,
              "allowToChangeInstallationDirectory": true, "artifactName": "sunscrap-setup-${version}.${ext}" },
    "forceCodeSigning": true
  }
}
```
- `electron-builder` minimal **^26** (saat ini 25.1.8 — upgrade eksplisit, cek breaking changes v26→v27; rekomendasi upgrade dua lompatan ke **v27** sekalian bila sudah stabil, karena v27 mengunci keamanan manifest Ed25519 + verify signature default `true`).
- `electron-updater` ^7/^6 ikut versi builder yang dipilih.
- `electronUpdaterCompatibility: ">=2.16"` (default aman).

### Fase 2 — Kode updater di aplikasi (±2–3 jam)
`src/main/updater.js` (inti):
```js
const { autoUpdater } = require('electron-updater');
function initUpdater({ log, notify, onUpdate }) {
  autoUpdater.autoDownload = true;            // unduh di background; pengguna tidak disuguhi unduhan 80MB di muka
  autoUpdater.autoInstallEvent = 'onNextLaunch'; // hindari race quit/shutdown (v27 default di v28)
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  autoUpdater.on('update-available', (info) => onUpdate({ state: 'available', version: info.version, notes: info.releaseNotes }));
  autoUpdater.on('download-progress', (p) => onUpdate({ state: 'downloading', percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => onUpdate({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (e) => log(`updater: ${e && e.message ? e.message : e}`)); // gagal → log saja; app tetap jalan normal
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 6 * 60 * 60 * 1000).unref();
  return { checkNow: check, installNow: () => autoUpdater.quitAndInstall({ isSilent: true, isForceRunAfter: true, waitUntilNextLaunch: true }) };
}
module.exports = { initUpdater };
```
- `main.js`: `initUpdater({ log, notify, onUpdate: broadcastUpdate })` setelah boot; tray: `{ label: 'Periksa pembaruan…', click: updater.checkNow }`.
- IPC: `update:check` → `checkNow`; `update:install` → `installNow`; event push `broadcast('update', …)`.
- Preload: `checkForUpdates`, `installUpdate`, `onUpdateEvent`.
- Renderer (tab Pengaturan): panel **Pembaruan** — `Versi saat ini`, tombol `Cek pembaruan`, bar progres unduhan, tombol **Muat ulang & perbarui** (tampil hanya saat `downloaded`), link `Lihat catatan rilis` (→ halaman `/releases` via `openExternal`), `Terakhir diperiksa`.
- Versi tampil dari satu sumber: `APP_VERSION = require('../../package.json').version` (hapus duplikasi).
- Non-packaged (`!app.isPackaged`): updater dimatikan otomatis (`if (!app.isPackaged) skip`) — `npm start` tetap jalan tanpa feed.
- Backup sebelum update: installer NSIS per-user tidak menyentuh `userData` (DB) ✓; tetap dokumentasikan.

### Fase 3 — Pipeline rilis (`.github/workflows/release.yml`, ±1 jam)
```yaml
name: Release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions: { contents: write }
jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test                          # gagal → tidak rilis
      - run: npx electron-builder --win --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
          ELECTRON_BUILDER_UPDATE_SIGN_KEY: ${{ secrets.ELECTRON_BUILDER_UPDATE_SIGN_KEY }}
```
- Rilis pertama manual: jalankan via `workflow_dispatch`, tinjau draft, lalu `Publish release`. Setelah terbukti, rilis berikutnya cukup `git tag v1.1.1 && git push --tags`.
- Catatan rilis: tulis ringkas (id-ID) — pengguna melihatnya via link "lihat catatan rilis".

### Fase 4 — Rollout & adopsi (1–2 minggu setelah kode merge)
1. Build v1.1.0 → publikasikan (manual). Ini **rilis pertama yang bisa meng-update dirinya**.
2. Pengguna 1.0.0: pasang v1.1.0 manual **sekali** (link unduhan di README + rilis). Sejak v1.1.1, semuanya otomatis.
3. v1.1.1 canary: `stagingPercentage: 10` (edit `latest.yml` di rilis draft) → pantau 48 jam (buka issue "update gagal?") → hapus/isi 100 (edit ulang atau biarkan kenaikan rilis berikutnya). Boleh dilewati untuk rilis awal (populasi kecil).
4. Komunikasikan di README: "sunscrap mulai v1.1.0 memeriksa pembaruan otomatis; update terpasang saat aplikasi ditutup/dibuka berikutnya."

### Fase 5 — Operasional
- Bulanan: cek halaman rilis (jumlah download per versi = sinyal adopsi); diskon tagihan Azure ($9,99/bln; ratusan rilis/tahun aman di bawah 5.000 sign/bln).
- Perpanjangan sertifikat/profil: Trusted Signing memutar sertifikat otomatis; perpanjangan pembayaran $9,99/bln; secret rotasi tahunan (`AZURE_CLIENT_SECRET` kedaluwarsa 1–2 thn — kalenderkan).
- Rilis jelek: terbitkan hotfix (v1.1.3). Jangan edit/mengganti aset rilis yang sudah terinstal.
- Perubahan skema DB: **selalu** migrasi tertata di aplikasi + catatan rilis; jangan pernah naikkan `SCHEMA_VERSION` tanpa migrasi.

---

## 6. Keamanan & privasi

- Tidak ada data pengguna yang dikirim ke GitHub oleh updater kecuali metadata request standar (versi, platform); tidak ada akun/telemetri ditambahkan oleh design.
- Kredensial (`AZURE_CLIENT_SECRET`, `ELECTRON_BUILDER_UPDATE_SIGN_KEY`) hanya di GitHub Secrets; tidak pernah di repo.
- `latest.yml` publik (bagian dari rilis) — bukan rahasia.
- Update diverifikasi: checksum SHA-512 dari manifest + (Android-style pin) tanda tangan Authenticode penerbit yang sama (`publisherName`). Tanpa ini, siapa pun yang menguasai repo bisa mengunggah installer jahat dan pengguna wajib menerimanya — inilah alasan K-3 bukan opsi.
- Preload/renderer tidak pernah menyentuh node; panel pembaruan hanya memuat teks lokal + `openExternal` untuk link rilis (http/https, host GitHub divalidasi main-side).

---

## 7–8. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| SmartScreen/SAC peringatan/blok saat rilis baru | Pengguna baru tidak bisa install | Tanda tangan Azure + distribusi cukup besar → reputasi tumbuh; dokumentasikan "klik Run anyway" (jelas, jujur) |
| Identitas Azure ditolak/lama diverifikasi | Tertunda berminggu-minggu | Fase 0 mulai hari pertama; siapkan OV cert sebagai plan B ($108–400/thn) |
| Rilis jelek terlanjur tersebar | Pengguna terlanjur update | Canary `stagingPercentage`; hotfix; never patch a published release |
| Rate limit GitHub (429) untuk banyak pengguna di NAT | Update gagal senyap (log saja) | Log jelas; fallback `generic` provider di R2/Pages; pengguna tetap pakai versi lama tanpa crash |
| Pengguna offline/terjebak di versi lama | Tidak pernah dapat update | Auto-check tiap 6 jam + saat online kembali; banner lembut (bukan paksa) |
| Update macet di tengah (ENOSPC/quota) | Installer korup? | NSIS installer menolak instalasi bila hash tidak cocok; update berikutnya akan mencoba lagi |
| Regresi setelah update (bug baru) | Pengguna di versi baru kena bug | QA manual `npm run dist` lokal + e2e satu kali sebelum tag pertama |
| Kunci tanda tangan bocor | Penyerang bisa mem-publish update jahat | Rotasi: bridge release dual-sign (v27) / ganti secret + cert rotation plan (OV) |
| DB skema naik tanpa migrasi | App lama crash | Aturan keras: naikkan `SCHEMA_VERSION` hanya dengan migrasi + test restore |
| Pengguna menolak restart | Update menumpuk (downloaded, belum dipasang) | UX sopan, notifikasi tray, tombol install selalu tersedia |
| `latest.yml` hilang dari assets rilis | Updater: "update tidak bisa diunduh" | CI gate: rilis hanya dari tag; jangan hapus aset release |
| Kebocoran `AZURE_CLIENT_SECRET` | Penyalahgunaan signing | Secret hanya di Actions; rotasi tiap 1–2 thn; pantau audit log Azure |

Keputusan yang perlu Anda buat (pilih satu per baris):
- **S-1.** Signing: [ ] Azure Trusted Signing ($9,99/bln) — *direkomendasikan* · [ ] OV certificate ($108–400+/thn, kerja sendiri untuk HSM/.pfx) · [ ] Tanpa signing (gratis, update tidak verifikasi tanda tangan; **SAC/SmartScreen memblokir untuk publik — tidak disarankan**)
- **S-2.** Rilis otomatis penuh (tag → langsung publish) atau [ ] draft review dulu (releaseType: `draft`, terbitkan manual)?
- **S-3.** Canary `stagingPercentage` untuk rilis publik pertama, atau langsung 100%?
- **S-4.** Hosting update cadangan (R2/Pages + generic provider) penting sekarang, atau nanti bila perlu?
- **S-5.** Kenaikan versi pertama: v1.1.0 (disarankan) — informasi bahwa 1.0.0 harus install manual dijelaskan di README/rilis?

---

## 9. Biaya, estimasi & verifikasi akhir

**Biaya:** GitHub gratis · Actions windows runner: public repo = gratis · Azure Trusted Signing $9,99/bln · opsional OV $108–400+/thn · nilai waktu: Fase 0 (setup Azure ±2–3 jam + tunggu verifikasi) + Fase 1–3 (±5–6 jam kerja) + Fase 4 QA ±1 jam.

**Checklist verifikasi sebelum mengumumkan:**
- [ ] `npx electron-builder --win` menghasilkan installer + `.blockmap` + `latest.yml`; semua file ikut di GitHub Release
- [ ] Installer terverifikasi `Get-AuthenticodeSignature` = Signer dipasangkan dengan `publisherName`
- [ ] v1.1.0 terpasang di mesin bersih → update ke v1.1.1 berhasil otomatis (akhir pekan uji: install 1.1.1 manual, ubah satu baris teks, rilis 1.1.2, buka app, tunggu ≤ 6 jam atau klik "Cek pembaruan", lihat unduhan berjalan & restart-install sukses)
- [ ] Dengan internet dimatikan: app boot normal, error tercatat di log, tidak crash; setelah online, check berikutnya berjalan
- [ ] Manifest diubah manual (tamper) → update **ditolak** (v27) / checksum mismatch ditolak (v26)
- [ ] Tray + Pengaturan: versi tampil benar; tombol cek bekerja; tombol install memanggil restart

**Catatan jujur:** rencana ini belum menyentuh kode — belum ada perubahan pada repo Anda. Begitu Anda menjawab S-1…S-5, implementasi Fase 1–4 (kode + workflow + rilis v1.1.0) bisa saya kerjakan langsung.
