'use strict';
/**
 * sunscraping — main
 * Titik masuk aplikasi: bootstrap DB, scraper, worker, tray, dan jendela dashboard.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  app, BrowserWindow, Menu, Notification, Tray, nativeImage, shell, dialog, protocol,
} = require('electron');

const { createDatabase } = require('./db');
const { createScraper } = require('./scraper');
const { createWorker } = require('./worker');
const { createRateLimiter } = require('./rateLimiter');
const { registerIpc } = require('./ipc');
const avatar = require('./avatar');

// Skema kustom untuk menyajikan avatar lokal (tanpa akses CDN dari renderer).
protocol.registerSchemesAsPrivileged([
  { scheme: 'sa-avatar', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const ICON_FILE = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const LIMITER_STATE = 'worker-state.json';
const WINDOW_STATE = 'window-state.json';
const RENDERER_INDEX = 'file://' + path.join(__dirname, '..', 'renderer', 'index.html').replace(/\\/g, '/');
const APP_VERSION = '1.0.0';

let mainWindow = null;
let tray = null;
let db = null;
let worker = null;
let scraper = null;
let userData = null;
let windowStore = null;
let shuttingDown = false;

// ---- file-backed storage (sinkron, proses utama) ----
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
        const tmp = filePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, filePath);
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

function showAbout() {
  const acc = db ? db.getDatabaseInfo() : {};
  const counts = acc.counts || {};
  const lines = [
    `sunscraping v${APP_VERSION}`,
    '',
    `Data tersimpan lokal di:`,
    `${userData || '(belum siap)'}`,
    '',
    `Audit: ${counts.audits ?? '-'} · Target: ${counts.targets ?? '-'} · Snapshot: ${counts.snapshots ?? '-'}`,
    `Ukuran DB: ${acc.size_bytes ? (Math.round(acc.size_bytes / 1024)) + ' KB' : '-'}`,
  ];
  dialog.showMessageBox(mainWindow || undefined, {
    type: 'info', title: 'Tentang sunscraping', message: `sunscraping v${APP_VERSION}`,
    detail: lines.join('\n'), buttons: ['Tutup'],
  }).catch(() => {});
}

/** Menu minimal dengan role edit (copy/paste/select-all) + keluar + tentang. */
function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu', label: 'Berkas' },
    {
      role: 'editMenu',
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      role: 'viewMenu',
      label: 'Tampilan',
      submenu: [
        { role: 'reload', visible: false },
        { role: 'toggleDevTools', visible: false },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu', label: 'Jendela' },
    {
      role: 'help',
      label: 'Bantuan',
      submenu: [{ label: 'Tentang sunscraping…', click: () => showAbout() }],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createMainWindow() {
  const bounds = windowStore ? windowStore.get([WINDOW_STATE]) : {};
  mainWindow = new BrowserWindow({
    width: (bounds.width) || 1280,
    height: (bounds.height) || 860,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1024,
    minHeight: 640,
    title: 'sunscraping',
    icon: ICON_FILE,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#101828', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  // Pertama kali = maximized; setelah itu ikuti posisi/besaran pengguna.
  if (bounds.maximized) {
    mainWindow.maximize();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Halaman utama hanya boleh menavigasi ke dokumen renderer sendiri;
  // navigasi lain dibuka di browser luar.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (String(url).startsWith('file:')) {
      if (decodeURIComponent(url.split('?')[0].split('#')[0]) !== decodeURIComponent(RENDERER_INDEX)) {
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  const saveBounds = () => {
    if (!windowStore || !mainWindow) return;
    const b = mainWindow.getBounds();
    windowStore.set({ width: b.width, height: b.height, x: b.x, y: b.y, maximized: mainWindow.isMaximized() });
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('close', saveBounds);

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return mainWindow;
}

/** Satu jendela: buka ulang/fokus bila sudah ada; jika belum, buat. */
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  return createMainWindow();
}

function trayMenu() {
  const status = worker ? worker.getStatus() : { active: false, label: 'belum siap' };
  const items = [
    { label: 'Buka dashboard', click: () => showMainWindow() },
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
    { label: 'Tentang sunscraping…', click: () => showAbout() },
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
  Menu.setApplicationMenu(buildAppMenu());
  if (process.env.SA_USER_DATA) {
    try { app.setPath('userData', process.env.SA_USER_DATA); } catch {}
  }
  userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });

  db = createDatabase(path.join(userData, 'sunscraping.db'));
  log(`Database: ${db.dbPath}`);

  const avatarDir = path.join(userData, 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });
  protocol.handle('sa-avatar', (request) => {
    try {
      const file = avatar.resolveAvatar(avatarDir, new URL(request.url).pathname.replace(/^\//, ''));
      if (!file) return new Response('', { status: 404 });
      const buf = fs.readFileSync(file);
      const type = path.extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      return new Response(buf, { headers: { 'content-type': type, 'cache-control': 'max-age=604800' } });
    } catch {
      return new Response('', { status: 500 });
    }
  });

  windowStore = createStorage(path.join(userData, WINDOW_STATE));

  scraper = createScraper({ onLog: log });

  const storage = createStorage(path.join(userData, LIMITER_STATE));
  const limiter = createRateLimiter(storage).init();

  worker = createWorker({
    db, scraper, limiter, notify, log, avatarDir,
    onChange: (status) => { refreshTraySoon(); broadcast('worker', status); },
  });

  registerIpc({ db, worker, scraper, broadcast });

  createMainWindow();

  const icon = nativeImage.createFromPath(ICON_FILE);
  tray = new Tray(icon);
  tray.on('double-click', () => showMainWindow());
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
  app.on('second-instance', () => showMainWindow());
  app.on('window-all-closed', () => {});
  app.on('activate', () => showMainWindow());

  app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (webviewEvent, webPreferences) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
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