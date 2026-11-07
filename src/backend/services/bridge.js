'use strict';
/**
 * sunscrap — bridge sesi browser eksternal
 * Server loopback (hanya 127.0.0.1) yang menerima cookie sesi IG/TikTok dari
 * ekstensi pendamping di browser live yang sudah login, lalu menyuntikkannya
 * ke partisi persist:sunscrap. Ekstensi mengirim secara periodik sehingga
 * sesi app senantiasa sinkron dengan browser (continuous sync).
 */
const http = require('node:http');

const DEFAULT_PORT = 43110;
const MAX_BODY = 1e6;

/** Cookie yang relevan untuk sesi. Sesuai pengecekan di `app:loginStatus`. */
const IG_HOST = 'https://www.instagram.com/';
const TK_HOST = 'https://www.tiktok.com/';

/** Normalisasi payload ekstensi -> daftar CookiesSetDetails (murni, bisa diuji). */
function parseCookiePayload(payload) {
  const payloadObj = payload && typeof payload === 'object' ? payload : {};
  const out = [];
  const add = (host, list) => {
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || typeof c.name !== 'string' || typeof c.value !== 'string') continue;
      out.push({
        url: host,
        name: c.name,
        value: c.value,
        domain: typeof c.domain === 'string' ? c.domain : undefined,
        path: (typeof c.path === 'string' && c.path) || '/',
        secure: true,
        httpOnly: !!c.httpOnly,
        expirationDate: Number(c.expirationDate) > 0 ? Number(c.expirationDate) : undefined,
        sameSite: 'no_restriction',
      });
    }
  };
  // Dua bentuk yang diterima: {instagram:[], tiktok:[]} atau array datar (IG).
  if (Array.isArray(payloadObj.instagram) || Array.isArray(payloadObj.tiktok)) {
    add(IG_HOST, payloadObj.instagram);
    add(TK_HOST, payloadObj.tiktok);
  } else if (Array.isArray(payloadObj)) {
    add(IG_HOST, payloadObj);
  }
  return out;
}

function createSessionBridge({ session, log, port: wantedPort, onChange } = {}) {
  const say = typeof log === 'function' ? log : () => {};
  const port = Number(wantedPort) || DEFAULT_PORT;
  let server = null;
  let listening = false;

  async function importCookies(payload) {
    const cookies = parseCookiePayload(payload);
    const result = { instagram: 0, tiktok: 0 };
    for (const c of cookies) {
      try {
        await session.cookies.set(c);
        if (c.url === IG_HOST) result.instagram++;
        else if (c.url === TK_HOST) result.tiktok++;
      } catch (e) {
        say(`Gagal memasang cookie ${c.name}: ${e.message}`);
      }
    }
    return result;
  }

  function start() {
    return new Promise((resolve) => {
      if (server) return resolve({ ok: true, port, listening });
      server = http.createServer((req, res) => {
        const send = (code, obj) => {
          res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify(obj));
        };
        if (req.method === 'GET' && req.url === '/ping') {
          return send(200, { ok: true, name: 'sunscrap-bridge', version: 1 });
        }
        if (req.method === 'POST' && req.url === '/cookies') {
          let body = '';
          req.on('data', (d) => { body += d; if (body.length > MAX_BODY) req.destroy(); });
          req.on('end', async () => {
            try {
              const result = await importCookies(JSON.parse(body || '{}'));
              if (typeof onChange === 'function') { try { onChange(result); } catch {} }
              send(200, { ok: true, ...result });
            } catch (e) {
              send(400, { ok: false, error: String(e && e.message || e) });
            }
          });
          return;
        }
        send(404, { ok: false, error: 'not found' });
      });
      server.on('error', (error) => { listening = false; server = null; say(`Bridge gagal (${error.message})`); resolve({ ok: false, error: error.message }); });
      server.listen(port, '127.0.0.1', () => { listening = true; resolve({ ok: true, port, listening }); });
    });
  }

  function stop() {
    if (server) { try { server.close(); } catch {} server = null; }
    listening = false;
    return { ok: true };
  }

  const status = () => ({ port, listening });

  return { start, stop, status, importCookies };
}

module.exports = { createSessionBridge, parseCookiePayload, DEFAULT_PORT };