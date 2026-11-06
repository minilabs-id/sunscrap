'use strict';
/**
 * sunscrap — updater
 * Cek pembaruan otomatis dari GitHub Releases (electron-updater).
 * - Hanya aktif saat packaged (tidak di `npm start`).
 * - Gagal cek/unduh → dicatat di log; aplikasi tetap berjalan normal.
 * - Tidak ada telemetri; pengguna melihat proses di tab Pengaturan.
 */

const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam
const FIRST_CHECK_DELAY_MS = 5000;

function initUpdater({ log, broadcast, isPackaged }) {
  const say = typeof log === 'function' ? log : () => {};
  const push = typeof broadcast === 'function' ? broadcast : () => {};
  const enabled = Boolean(isPackaged);

  // Status yang dibagikan ke renderer (Pengaturan → Pembaruan).
  const state = {
    enabled,
    version: require('../../../package.json').version,
    status: enabled ? 'idle' : 'dev', // dev | idle | checking | available | downloading | downloaded | error | uptodate
    availableVersion: null,
    percent: null,
    lastCheckedAt: null,
    error: null,
    releaseUrl: 'https://github.com/startupmini/sunscrap/releases',
  };

  function setStatus(status, patch = {}) {
    state.status = status;
    Object.assign(state, patch);
    push('update', { ...state });
  }

  function init() {
    if (!enabled) { say('Updater nonaktif (bukan build terpasang).'); return { enabled, state }; }

    autoUpdater.autoDownload = true;          // unduh di background; pengguna tidak perlu klik apa pun
    autoUpdater.autoInstallEvent = 'onNextLaunch'; // install saat peluncuran berikutnya (hindari kill saat shutdown)
    autoUpdater.logger = {
      info: (m) => say(`updater: ${m}`),
      warn: (m) => say(`updater: ${m}`),
      error: (m) => say(`updater: ${m}`),
      debug: () => {},
    };

    autoUpdater.on('checking-for-update', () => { state.lastCheckedAt = new Date().toISOString(); setStatus('checking', { error: null }); });
    autoUpdater.on('update-available', (info) => {
      say(`Pembaruan tersedia: ${info.version}`);
      setStatus('available', { availableVersion: info.version || null, percent: 0 });
    });
    autoUpdater.on('update-not-available', () => setStatus('uptodate', { availableVersion: null, percent: null, error: null }));
    autoUpdater.on('download-progress', (p) => setStatus('downloading', { percent: Math.round((p && p.percent) || 0) }));
    autoUpdater.on('update-downloaded', (info) => {
      say(`Pembaruan ${info && info.version ? info.version : ''} terunduh — akan dipasang saat aplikasi dibuka berikutnya.`);
      setStatus('downloaded', { availableVersion: (info && info.version) || state.availableVersion, percent: 100 });
    });
    autoUpdater.on('error', (e) => {
      const message = e && e.message ? e.message : String(e);
      say(`updater error (diabaikan, aplikasi tetap jalan): ${message}`);
      setStatus('error', { error: message });
    });

    const check = () => autoUpdater.checkForUpdates().catch((e) => say(`updater check gagal: ${e.message}`));
    setTimeout(check, FIRST_CHECK_DELAY_MS);
    setInterval(check, CHECK_INTERVAL_MS).unref();

    return { enabled, state };
  }

  function checkNow() {
    if (!enabled) return Promise.resolve({ ...state, status: 'dev' });
    return autoUpdater.checkForUpdates()
      .then(() => state)
      .catch((e) => { setStatus('error', { error: e && e.message ? e.message : String(e) }); return state; });
  }

  function installNow() {
    if (!enabled) return false;
    // Pasang sekarang + buka lagi otomatis (tidak menunggu peluncuran berikutnya).
    autoUpdater.quitAndInstall({ isSilent: true, isForceRunAfter: true });
    return true;
  }

  function getState() { return { ...state }; }

  return { init, checkNow, installNow, getState };
}

module.exports = { initUpdater };
