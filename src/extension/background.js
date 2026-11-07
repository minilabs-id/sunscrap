// sunscrap bridge — service worker (Manifest V3)
// Mengirim cookie sesi Instagram/TikTok ke aplikasi sunscrap lewat loopback
// secara periodik (continuous sync). Cookie tidak pernah menyentuh internet.
const PORT = 43110;
const ENDPOINT = `http://127.0.0.1:${PORT}/cookies`;

const IG_NAMES = ['sessionid', 'ds_user_id', 'csrftoken', 'rur', 'mid'];
const TK_NAMES = ['sid_tt', 'sid_guard', 'sessionid', 'ttwid'];

async function cookiesFor(domain, names) {
  try {
    const all = await chrome.cookies.getAll({ domain });
    return all
      .filter((c) => names.includes(c.name))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
      }));
  } catch {
    return [];
  }
}

async function push() {
  const [instagram, tiktok] = await Promise.all([
    cookiesFor('instagram.com', IG_NAMES),
    cookiesFor('tiktok.com', TK_NAMES),
  ]);
  if (!instagram.length) return; // IG wajib ada; TikTok opsional
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instagram, tiktok }),
    });
  } catch {
    // aplikasi tidak berjalan — abaikan
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('sunscrap-sync', { periodInMinutes: 0.5 });
  push();
});

chrome.runtime.onStartup.addListener(() => push());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sunscrap-sync') push();
});