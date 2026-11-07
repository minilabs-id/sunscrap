'use strict';
// Uji integrasi bridge secara terisolasi: set userData temp, jalankan server
// loopback, kirim cookie, cek tersimpan di partisi. Tidak menyentuh app yang
// sedang berjalan (tanpa lock, tanpa partisi sungguhan).
// Jalankan: npx electron scripts/bridge-smoke.js
const { app, session } = require('electron');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-bridge-smoke-'));
app.setPath('userData', tmp);

function post() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      instagram: [
        { name: 'sessionid', value: 'test-sess', domain: '.instagram.com', path: '/', httpOnly: true },
        { name: 'ds_user_id', value: '12345', domain: '.instagram.com', path: '/' },
      ],
      tiktok: [{ name: 'sid_tt', value: 'test-sid', domain: '.tiktok.com', path: '/' }],
    });
    const req = http.request({ host: '127.0.0.1', port: 43110, path: '/cookies', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

app.whenReady().then(async () => {
  try {
    const { createSessionBridge } = require('../src/backend/services/bridge');
    const s = session.fromPartition('persist:sunscrap');
    const bridge = createSessionBridge({ session: s, onChange: (r) => console.log('[onChange]', JSON.stringify(r)) });
    const st = await bridge.start();
    console.log('start:', JSON.stringify(st));

    const res = await post();
    console.log('POST /cookies:', res.status, res.body);

    await new Promise((r) => setTimeout(r, 300));
    const cookies = await s.cookies.get({});
    const igSessionid = cookies.some((c) => c.name === 'sessionid' && /instagram/.test(c.domain));
    const tkSid = cookies.some((c) => c.name === 'sid_tt' && /tiktok/.test(c.domain));
    console.log('ig sessionid masuk:', igSessionid, '| tiktok sid_tt masuk:', tkSid);

    bridge.stop();
    const ok = st.ok === true && res.status === 200 && igSessionid && tkSid;
    console.log(ok ? 'BRIDGE SMOKE OK' : 'BRIDGE SMOKE GAGAL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('FAIL', e);
    app.exit(1);
  }
});