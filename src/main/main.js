'use strict';
/**
 * sunscraping — main
 * Titik masuk aplikasi: bootstrap DB, scraper, worker, tray, dan jendela dashboard.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  app, BrowserWindow, Menu, Notification, Tray, nativeImage, shell,
} = require('electron');

const { createDatabase } = require('./db');
const { createScraper } = require('./scraper');
const { createWorker } = require('./worker');
const { createRateLimiter } = require('./rateLimiter');
const { registerIpc } = require('./ipc');

const ICON_FILE = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const LIMITER_STATE = 'worker-state.json';

let mainWindow = null;
let tray = null;
let db = null;
let worker = null;
let scraper = null;
let shuttingDown = false;

// ---- file-backed storage untuk rate limiter (sinkron, proses utama) ----
function createStorage(filePath) {
  let data = {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch {}
  return {
    get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      const wanted = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of wanted) if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
      return result;
    },
    set(values) {
      Object.assign(data, values || {});
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data));
      } catch {}
    },
    remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
      try { fs.writeFileSync(filePath, JSON.stringify(data)); } catch {}
    },
  };
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  try { new Notification({ title, body }).show(); } catch {}
}

function broadcast(type, payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    try { win.webContents.send('evt', { type, payload }); } catch {}
  }
}

function log(message) {
  if (!message) return;
  console.log(`[sunscraping] ${message}`);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: 'sunscraping',
    icon: ICON_FILE,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return mainWindow;
}

function trayMenu() {
  const status = worker ? worker.getStatus() : { active: false, label: 'belum siap' };
  const items = [
    { label: 'Buka dashboard', click: () => createMainWindow() },
    { type: 'separator' },
    { label: status.active ? 'Hentikan worker' : 'Mulai worker', enabled: Boolean(worker), click: () => toggleWorker() },
    { label: `Status: ${status.label}`, enabled: false },
  ];
  if (status.active && status.lastTaskId) items.push({ label: `Task terakhir: #${status.lastTaskId}`, enabled: false });
  if (status.lastError) items.push({ label: `Terakhir: ${String(status.lastError).slice(0, 60)}`, enabled: false });
  items.push(
    { type: 'separator' },
    { label: 'Login Instagram', click: () => scraper.openLogin('instagram') },
    { label: 'Login TikTok', click: () => scraper.openLogin('tiktok') },
    { type: 'separator' },
    { label: 'Keluar', click: () => app.quit() },
  );
  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;
  try {
    tray.setContextMenu(trayMenu());
    const status = worker ? worker.getStatus() : null;
    const tooltip = status ? `sunscraping — ${status.label}${status.lastError ? ` (${status.lastError})` : ''}` : 'sunscraping';
    tray.setToolTip(tooltip.slice(0, 120));
  } catch {}
}

let trayTimer = null;
function refreshTraySoon() {
  if (trayTimer) return;
  trayTimer = setTimeout(() => { trayTimer = null; refreshTray(); }, 250);
}

async function toggleWorker() {
  if (!worker) return;
  if (worker.getStatus().active) {
    worker.stop(null);
    log('Worker dihentikan dari tray.');
  } else {
    await worker.start();
    log('Worker dimulai dari tray.');
  }
  refreshTray();
}

async function boot() {
  app.setAppUserModelId('com.sunscraping.desktop');
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });

  db = createDatabase(path.join(userData, 'sunscraping.db'));
  log(`Database: ${db.dbPath}`);

  scraper = createScraper({ onLog: log });

  const storage = createStorage(path.join(userData, LIMITER_STATE));
  const limiter = createRateLimiter(storage).init();

  worker = createWorker({
    db, scraper, limiter, notify, log,
    onChange: (status) => { refreshTraySoon(); broadcast('worker', status); },
  });

  registerIpc({ db, worker, scraper, broadcast });

  createMainWindow();

  const icon = nativeImage.createFromPath(ICON_FILE);
  tray = new Tray(icon);
  tray.on('double-click', () => createMainWindow());
  tray.setToolTip('sunscraping');
  refreshTray();

  if (process.env.SA_AUTOSTART_WORKER === '1') {
    worker.start().then(() => log('Worker dimulai otomatis.')).catch((e) => log(`Worker gagal: ${e.message}`));
  }

  log(`Siap. Data di ${userData}`);
}

async function shutdown() {
  try { if (worker) worker.stop(null); } catch {}
  try { if (scraper) scraper.dispose(); } catch {}
  try { if (db) db.close(); } catch {}
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => createMainWindow());
  app.on('window-all-closed', () => {});
  app.on('activate', () => createMainWindow());

  app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (webviewEvent, webPreferences) => {
      // Izinkan <webview> di tab Browser, tapi kunci preferensi guest.
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
    });
  });

  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    shutdown().finally(() => app.exit(0));
  });

  app.whenReady().then(boot).catch((error) => {
    console.error('[sunscraping] gagal mulai:', error);
    try { if (db) db.close(); } catch {}
    app.exit(1);
  });
}