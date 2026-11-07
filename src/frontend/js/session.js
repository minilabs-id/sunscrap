/** sunscrap v2 — Sesi & Login (status sesi + webview persisten). */
import { $, toast } from './dom.js';
import { api } from './helpers.js';

function isSocialHost(url) {
  try {
    const h = new URL(String(url)).hostname.toLowerCase();
    return h === 'instagram.com' || h.endsWith('.instagram.com') || h === 'tiktok.com' || h.endsWith('.tiktok.com');
  } catch { return false; }
}

let browserInited = false;
function ensureBrowser() {
  const wv = $('#browser-webview');
  if (!wv || browserInited) return;
  browserInited = true;
  wv.src = 'https://www.instagram.com/';
}

function browserNavigate(url) {
  const wv = $('#browser-webview');
  if (!wv) return;
  let target = String(url || '').trim();
  if (!target) return;
  if (!/^https?:\/\//i.test(target)) target = target.includes('.') ? 'https://' + target : 'https://www.instagram.com/' + encodeURIComponent(target);
  if (!isSocialHost(target)) {
    window.sunscrap.openExternal(target);
    toast('Dibuka di browser luar (bukan sesi login).', 'warning');
    return;
  }
  wv.loadURL(target);
}

export async function renderLoginStatus() {
  const set = (id, platform, on) => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('on', !!on);
    el.title = `${platform} — ${on ? 'masuk' : 'belum login (klik untuk login)'}`;
  };
  try {
    const status = await api.getLoginStatus();
    set('#browser-ig', 'Instagram', status && status.instagram);
    set('#browser-tk', 'TikTok', status && status.tiktok);
  } catch {
    set('#browser-ig', 'Instagram', false);
    set('#browser-tk', 'TikTok', false);
  }
}

export async function initSessionTab() {
  ensureBrowser();
  renderLoginStatus();
}

export function bindSessionEvents() {
  const wv = $('#browser-webview');
  if (wv) {
    wv.addEventListener('will-navigate', (e) => {
      if (!isSocialHost(e.url)) { e.preventDefault(); window.sunscrap.openExternal(e.url); }
    });
    const sync = () => { const el = $('#browser-url'); if (el) el.value = wv.getURL(); };
    wv.addEventListener('did-navigate', sync);
    wv.addEventListener('did-navigate-in-page', sync);
    wv.addEventListener('new-window', (e) => {
      if (/^https?:/i.test(String(e.url))) window.sunscrap.openExternal(e.url);
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
    });
    wv.addEventListener('did-fail-load', (e) => { if (e.errorCode !== -3 && e.isMainFrame) toast('Gagal memuat: ' + (e.errorDescription || e.errorCode), 'error'); });
  }
  $('#browser-go').addEventListener('click', () => browserNavigate($('#browser-url').value));
  $('#browser-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') browserNavigate($('#browser-url').value); });
  $('#browser-back').addEventListener('click', () => { if (wv.canGoBack()) wv.goBack(); });
  $('#browser-fwd').addEventListener('click', () => { if (wv.canGoForward()) wv.goForward(); });
  $('#browser-reload').addEventListener('click', () => wv.reload());
  $('#browser-ig').addEventListener('click', () => { ensureBrowser(); wv.loadURL('https://www.instagram.com/'); });
  $('#browser-tk').addEventListener('click', () => { ensureBrowser(); wv.loadURL('https://www.tiktok.com/'); });
}
