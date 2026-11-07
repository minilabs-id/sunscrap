'use strict';
/**
 * sunscrap — main
 * Titik masuk aplikasi: bootstrap DB, scraper, worker, tray, dan jendela dashboard.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  app, BrowserWindow, Menu, Notification, Tray, nativeImage, shell, dialog, protocol, ipcMain, nativeTheme, screen,
} = require('electron');
const { fileURLToPath } = require('node:url');

const { createDatabase } = require('./core/db');
const { createScraper } = require('./services/scraper');
const { createWorker } = require('./services/worker');
const { createRateLimiter } = require('./core/rateLimiter');
const { registerIpc } = require('./ipc');
const { initUpdater } = require('./services/updater');
const { createStorage } = require('./core/storage');
const avatar = require('./services/avatar');

// Anti-deteksi (ringan): sembunyikan penanda otomasi Chromium agar jendela
// worker tak langsung dikenali sebagai bot oleh anti-scraping IG/TikTok.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Skema kustom untuk menyajikan avatar lokal (tanpa akses CDN dari renderer).
// Sengaja TIDAK `standard`: skema standard dinormalkan Chromium menjadi
// sa-avatar://nama/ (host=nama, path='/') sehingga handler selalu 404 (K-3).
protocol.registerSchemesAsPrivileged([
  { scheme: 'sa-avatar', privileges: { secure: true, supportFetchAPI: true } },
]);

const ICON_FILE = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const LIMITER_STATE = 'worker-state.json';
const WINDOW_STATE = 'window-state.json';
const RENDERER_INDEX_PATH = path.join(__dirname, '..', 'frontend', 'index.html');
const APP_VERSION = require('../../package.json').version;

// Overlay tombol min/max/close harus sama warna dengan permukaan titlebar
// (solid) agar menyatu. Warna simbol mengikuti mode terang/gelap.
function titleBarOverlayFor(dark) {
  return dark
    ? { color: '#28272a', symbolColor: '#d6d1cc', height: 46 }
    : { color: '#ffffff', symbolColor: '#1c1b1a', height: 46 };
}
function systemPrefersDark() {
  try { return nativeTheme.shouldUseDarkColors; } catch { return false; }
}

/** Bila layar eksternal dicabut, posisi tersimpan bisa berada di luar semua workArea → hilangkan x/y agar jendela muncul di layar utama. */
function clampWindowBounds(bounds) {
  const b = { ...(bounds || {}) };
  const needsClamp = typeof b.x === 'number' || typeof b.y === 'number';
  const visible = !needsClamp || screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    const xOk = typeof b.x !== 'number' || (b.x >= wa.x - 200 && b.x < wa.x + wa.width - 100);
    const yOk = typeof b.y !== 'number' || (b.y >= wa.y - 100 && b.y < wa.y + wa.height - 100);
    return xOk && yOk;
  });
  if (!visible) { delete b.x; delete b.y; }
  return b;
}

let mainWindow = null;
let tray = null;
let db = null;
let worker = null;
let scraper = null;
let updater = null;
let userData = null;
let windowStore = null;
let shuttingDown = false;
let warnedTray = false; // beri tahu sekali saat jendela pertama kali diminimalkan ke tray

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
  console.log(`[sunscrap] ${message}`);
}

// Jangan biarkan exception tak tertangani mematikan proses utama secara senyap;
// catat dengan jelas agar tetap bisa didiagnosis & aplikasi tetap hidup.
process.on('uncaughtException', (error) => {
  console.error('[sunscrap] uncaughtException:', error && error.stack ? error.stack : error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[sunscrap] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});

function showAbout() {
  const acc = db ? db.getDatabaseInfo() : {};
  const counts = acc.counts || {};
  const lines = [
    `sunscrap v${APP_VERSION}`,
    '',
    `Data tersimpan lokal di:`,
    `${userData || '(belum siap)'}`,
    '',
    `Audit: ${counts.audits ?? '-'} · Target: ${counts.targets ?? '-'} · Snapshot: ${counts.snapshots ?? '-'}`,
    `Ukuran DB: ${acc.size_bytes ? (Math.round(acc.size_bytes / 1024)) + ' KB' : '-'}`,
  ];
  dialog.showMessageBox(mainWindow || undefined, {
    type: 'info', title: 'Tentang sunscrap', message: `sunscrap v${APP_VERSION}`,
    detail: lines.join('\n'), buttons: ['Tutup'],
  }).catch(() => {});
}

function copyDiagnostics() {
  const info = db ? db.getDatabaseInfo() : {};
  const counts = info.counts || {};
  const lines = [
    `sunscrap v${APP_VERSION}`,
    `Electron ${process.versions.electron} · Node ${process.versions.node} · Chromium ${process.versions.chrome}`,
    `OS: ${process.platform} ${process.arch}`,
    `Data: ${userData || '?'}`,
    `Ukuran DB: ${info.size_bytes ? Math.round(info.size_bytes / 1024) + ' KB' : '-'}`,
    `Schema: ${info.schema_version ?? '?'} · Audit ${counts.audits ?? '-'} · Target ${counts.targets ?? '-'} · Snapshot ${counts.snapshots ?? '-'}`,
  ];
  const text = lines.join('\n');
  const { clipboard } = require('electron');
  clipboard.writeText(text);
  notify('Info diagnostik disalin', `sunscrap v${APP_VERSION} — sudah di clipboard.`);
}

function openDataFolder() {
  try { shell.openPath(userData || app.getPath('userData')); } catch {}
}

/** Menu dengan role edit + aksi aplikasi (Import/Export/Cadangkan/Buka/Help). */
function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const send = (action) => broadcast('menu', { action });
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Berkas',
      submenu: [
        { label: 'Import data…', accelerator: 'CmdOrCtrl+I', click: () => send('import') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
        { type: 'separator' },
        { label: 'Cadangkan database…', accelerator: 'CmdOrCtrl+Shift+B', click: () => send('backup') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
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
        {
          label: 'Tema',
          submenu: [
            { label: 'Terang', click: () => send('theme:light') },
            { label: 'Gelap', click: () => send('theme:dark') },
            { label: 'Ikuti sistem', click: () => send('theme:system') },
          ],
        },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Buka',
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: () => send('tab:dashboard') },
        { label: 'Target', accelerator: 'CmdOrCtrl+2', click: () => send('tab:targets') },
        { label: 'Akun', accelerator: 'CmdOrCtrl+3', click: () => send('tab:accounts') },
        { label: 'Proses', accelerator: 'CmdOrCtrl+4', click: () => send('tab:proses') },
        { label: 'Sesi', accelerator: 'CmdOrCtrl+5', click: () => send('tab:browser') },
        { label: 'Pengaturan', accelerator: 'CmdOrCtrl+6', click: () => send('tab:settings') },
      ],
    },
    {
      role: 'windowMenu',
      label: 'Jendela',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      role: 'help',
      label: 'Bantuan',
      submenu: [
        { label: 'Tentang sunscrap…', click: () => showAbout() },
        { label: 'Salin info diagnostik…', click: () => copyDiagnostics() },
        { label: 'Buka folder data…', click: () => openDataFolder() },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createMainWindow() {
  const bounds = clampWindowBounds(windowStore ? windowStore.get() : {});
  mainWindow = new BrowserWindow({
    width: (bounds.width) || 1280,
    height: (bounds.height) || 860,
    x: bounds.x,
    y: bounds.y,
    minWidth: 860,
    minHeight: 520,
    title: 'sunscrap',
    icon: ICON_FILE,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayFor(systemPrefersDark()),
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
      let target = null;
      try { target = path.normalize(fileURLToPath(url)).toLowerCase(); } catch {}
      if (target !== path.normalize(RENDERER_INDEX_PATH).toLowerCase()) event.preventDefault();
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

  // Tombol close (X) menyembunyikan ke tray supaya worker tetap jalan di latar;
  // keluar permanen hanya lewat "Keluar" (tray) atau menu Berkas → Keluar.
  mainWindow.on('close', (event) => {
    saveBounds();
    if (shuttingDown) return; // izinkan menutup saat aplikasi memang akan keluar
    event.preventDefault();
    mainWindow.hide();
    if (!warnedTray) {
      warnedTray = true;
      const status = worker ? worker.getStatus() : null;
      notify('sunscrap tetap berjalan di latar',
        'Worker ' + (status && status.active ? 'masih AKTIF — hentikan lewat tray' : 'siaga') + '. Buka lagi lewat ikon tray.');
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(RENDERER_INDEX_PATH);
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
    { label: 'Periksa pembaruan…', click: () => updater && updater.checkNow() },
    { type: 'separator' },
    { label: 'Tentang sunscrap…', click: () => showAbout() },
    { label: 'Keluar', click: () => app.quit() },
  );
  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;
  try {
    tray.setContextMenu(trayMenu());
    const status = worker ? worker.getStatus() : null;
    const tooltip = status ? `sunscrap — ${status.label}${status.lastError ? ` (${status.lastError})` : ''}` : 'sunscrap';
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
  app.setAppUserModelId('com.sunscrap.app');
  Menu.setApplicationMenu(buildAppMenu());
  if (process.env.SA_USER_DATA) {
    try { app.setPath('userData', process.env.SA_USER_DATA); } catch {}
  }
  userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });

  db = createDatabase(path.join(userData, 'sunscrap.db'));
  log(`Database: ${db.dbPath}`);

  const avatarDir = path.join(userData, 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });
  protocol.handle('sa-avatar', (request) => {
    try {
      const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
      const file = avatar.resolveAvatar(avatarDir, name);
      if (!file) return new Response('', { status: 404 });
      const buf = fs.readFileSync(file);
      const type = path.extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      return new Response(buf, { headers: { 'content-type': type, 'cache-control': 'max-age=604800' } });
    } catch {
      return new Response('', { status: 500 });
    }
  });

  windowStore = createStorage(path.join(userData, WINDOW_STATE));
  const reviewStore = createStorage(path.join(userData, 'review-state.json'));

  scraper = createScraper({ onLog: log });

  const storage = createStorage(path.join(userData, LIMITER_STATE));
  const limiter = createRateLimiter(storage).init();

  worker = createWorker({
    db, scraper, limiter, notify, log, avatarDir, activityLogPath: path.join(userData, 'activity.jsonl'),
    onChange: (status) => { refreshTraySoon(); broadcast('worker', status); },
  });

  updater = initUpdater({ log, broadcast, isPackaged: app.isPackaged });
  updater.init();

  registerIpc({ db, worker, scraper, broadcast, limiter, avatarDir, updater, reviewStore });

  ipcMain.handle('app:copyDiagnostics', () => { copyDiagnostics(); return { ok: true }; });
  ipcMain.handle('app:openDataFolder', () => { openDataFolder(); return { ok: true }; });
  // Renderer memberi tahu tema aktif agar overlay tombol window menyesuaikan.
  ipcMain.handle('app:theme', (event, theme) => {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitleBarOverlay(titleBarOverlayFor(theme === 'dark')); } catch {}
    return { ok: true };
  });
  // Ikut perubahan tema sistem meski renderer tidak memicu (jaring pengaman).
  nativeTheme.on('updated', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitleBarOverlay(titleBarOverlayFor(systemPrefersDark()));
    } catch {}
  });

  createMainWindow();

  const icon = nativeImage.createFromPath(ICON_FILE);
  tray = new Tray(icon);
  tray.on('double-click', () => showMainWindow());
  tray.setToolTip('sunscrap');
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
    console.error('[sunscrap] gagal mulai:', error);
    try { if (db) db.close(); } catch {}
    app.exit(1);
  });
}