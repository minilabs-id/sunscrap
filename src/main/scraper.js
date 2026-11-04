'use strict';
/**
 * sunscraping — scraper
 * Permukaan scraping untuk aplikasi desktop: BrowserWindow tersembunyi yang
 * menyuntikkan scraper IG/TikTok ke isolated world dan membaca hasilnya.
 * Login disimpan di partisi persist agar tidak hilang saat aplikasi ditutup.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, session } = require('electron');
const { allowedTarget, platformForHost } = require('./policy');

const CONTENT_DIR = path.join(__dirname, '..', 'scraper-content');
const PARTITION = 'persist:sunscraping';
const WORLD_ID = 999;
const SCRAPE_TIMEOUT_MS = 45000;
const LOAD_TIMEOUT_MS = 30000;
const LOADS_PER_WINDOW = 120;

const LOGIN_URLS = {
  instagram: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/',
};

function readContent(name) {
  return fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8');
}

function desktopUserAgent() {
  const chrome = process.versions.chrome || '126.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

/** Batas waktu per panggilan scrape; halaman yang menggantung tidak menahan worker. */
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function createScraper({ onLog, resolvePage, partition } = {}) {
  const say = typeof onLog === 'function' ? onLog : () => {};
  const resolve = typeof resolvePage === 'function' ? resolvePage : (url) => url;
  const partitionName = partition || PARTITION;

  const code = {
    common: readContent('common.js'),
    instagram: readContent('ig-scraper.js'),
    tiktok: readContent('tk-scraper.js'),
  };

  const partitionSession = session.fromPartition(partitionName);
  partitionSession.setUserAgent(desktopUserAgent());
  partitionSession.setPermissionRequestHandler((contents, permission, callback) => callback(false));

  let workerWindow = null;
  let loads = 0;

  function createWorkerWindow() {
    workerWindow = new BrowserWindow({
      show: false,
      width: 1280, height: 900,
      title: 'sunscraping worker',
      webPreferences: {
        partition: partitionName,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    loads = 0;
    workerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    workerWindow.webContents.on('will-navigate', (event, url) => {
      if (!allowedTarget(url)) { say(`Navigasi keluar diblokir: ${url}`); event.preventDefault(); }
    });
    workerWindow.webContents.on('render-process-gone', (event, details) => {
      say(`Renderer worker berhenti (${details.reason}); jendela akan dibuat ulang.`);
      if (workerWindow && !workerWindow.isDestroyed()) workerWindow.destroy();
      workerWindow = null;
    });
    workerWindow.on('closed', () => { workerWindow = null; });
    return workerWindow;
  }

  function ensureWorkerWindow() {
    if (workerWindow && !workerWindow.isDestroyed()) return workerWindow;
    return createWorkerWindow();
  }

  async function load(url) {
    if (!allowedTarget(url)) throw new Error(`Navigasi ditolak: hanya host Instagram/TikTok (${url})`);
    let win = ensureWorkerWindow();
    if (loads >= LOADS_PER_WINDOW) {
      say(`Mendaur ulang jendela worker setelah ${loads} halaman.`);
      if (!win.isDestroyed()) win.destroy();
      workerWindow = null;
      win = ensureWorkerWindow();
    }
    loads += 1;
    try {
      await withTimeout(
        win.loadURL(resolve(url)).catch((e) => {
          // Redirect membatalkan load pertama; itu bukan kegagalan.
          if (!/ERR_ABORTED/i.test(String((e && e.message) || e))) throw e;
        }),
        LOAD_TIMEOUT_MS,
        'Timeout - halaman tidak termuat',
      );
    } catch (error) {
      if (/Timeout/.test(String((error && error.message) || error))) {
        say(`Navigasi timeout (${url}); jendela worker dibuang.`);
        if (win && !win.isDestroyed()) win.destroy();
        workerWindow = null;
      }
      throw error;
    }
    return win;
  }

  async function inject(platform) {
    const win = ensureWorkerWindow();
    const ready = await win.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: 'Boolean(globalThis.__saScrapePost)' }]);
    if (ready) return;
    await win.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [
      { code: code.common, url: 'common.js' },
      { code: code[platform], url: `${platform}-scraper.js` },
    ]);
    const ok = await win.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: 'Boolean(globalThis.__saScrapePost && globalThis.__saScrapeProfile)' }]);
    if (!ok) throw new Error('Content script tidak terpasang');
  }

  async function call(platform, expr) {
    const win = ensureWorkerWindow();
    await inject(platform);
    return withTimeout(
      win.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: expr }]),
      SCRAPE_TIMEOUT_MS,
      'Timeout - halaman terlalu lambat',
    );
  }

  return {
    async scrapePost(task) {
      const platform = platformForHost(task.url);
      if (!platform) throw new Error('URL tidak diizinkan (hanya host Instagram/TikTok)');
      await load(task.url);
      const arg = JSON.stringify({ url: task.url, username: task.username || null, tema: task.tema || null });
      const result = await call(platform, `globalThis.__saScrapePost(${arg}).catch((e) => globalThis.__saErrorResult(e))`);
      return result;
    },

    async scrapeProfile(username, platform) {
      if (!username || !code[platform]) return null;
      const handle = encodeURIComponent(username);
      const url = platform === 'instagram' ? `https://www.instagram.com/${handle}/` : `https://www.tiktok.com/@${handle}`;
      await load(url);
      const result = await call(platform, `globalThis.__saScrapeProfile(${JSON.stringify(username)}).catch((e) => globalThis.__saErrorResult(e))`);
      return result && result.status !== 'FAILED' ? result : null;
    },

    openLogin(platform) {
      const target = LOGIN_URLS[platform];
      if (!target) return null;
      const win = new BrowserWindow({
        width: 1100, height: 820,
        title: `Login ${platform}`,
        webPreferences: { partition: partitionName, nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (allowedTarget(url)) require('electron').shell.openExternal(url);
        else say(`Popup diblokir: ${url}`);
        return { action: 'deny' };
      });
      win.loadURL(target);
      return win;
    },

    dispose() {
      if (workerWindow && !workerWindow.isDestroyed()) workerWindow.destroy();
      workerWindow = null;
    },
  };
}

module.exports = { createScraper };