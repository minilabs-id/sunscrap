'use strict';
/**
 * sunscrap — make-icon
 * Menghasilkan ikon PNG (matahari) tanpa dependency: RGBA → PNG (zlib + CRC32).
 * Dipakai untuk assets/icon.png (window/tray) dan build/icon.png (installer).
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function drawSun(size) {
  // Logo sunscrap baru (SVG asli): dua persegi orange (#FF9800, satu diputar -45°)
  // membentuk 8 sinar, lingkaran kuning (#FFEB3B) di tengah, latar transparan.
  // Anti-aliasing via supersampling 4x4 (murni Node, tanpa dependency).
  const S = size / 48;
  const CX = 24 * S, CY = 24 * S;
  const HALF = 13 * S;   // setengah sisi persegi (11..37)
  const R = 11 * S;      // jari-jari lingkaran
  const cos45 = Math.SQRT1_2, sin45 = Math.SQRT1_2;
  const SS = 4, SS2 = SS * SS;
  const rgba = Buffer.alloc(size * size * 4);

  // Kategori warna pada titik kontinu (x,y)
  const category = (x, y) => {
    const dx = x - CX, dy = y - CY;
    if (dx * dx + dy * dy <= R * R) return 2; // kuning
    const inAxis = Math.abs(dx) <= HALF && Math.abs(dy) <= HALF;
    const lx = dx * cos45 + dy * sin45;
    const ly = -dx * sin45 + dy * cos45;
    const inRot = Math.abs(lx) <= HALF && Math.abs(ly) <= HALF;
    if (inAxis || inRot) return 1; // orange
    return 0; // transparan
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let orange = 0, yellow = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const c = category(px, py);
          if (c === 1) orange++;
          else if (c === 2) yellow++;
        }
      }
      const covered = orange + yellow;
      const idx = (y * size + x) * 4;
      if (!covered) { rgba[idx + 3] = 0; continue; }
      // rata-rata warna (kuning 255,235,59 · orange 255,152,0) menurut cakupan
      const r = 255;
      const g = (yellow * 235 + orange * 152) / covered;
      const b = (yellow * 59 + orange * 0) / covered;
      const a = Math.round((covered / SS2) * 255);
      rgba[idx] = r;
      rgba[idx + 1] = Math.round(g);
      rgba[idx + 2] = Math.round(b);
      rgba[idx + 3] = a;
    }
  }
  return rgba;
}

function encodeIco(pngs) {
  // pngs: [{ size, buf }] — masukkan PNG langsung sebagai frame ICO (Vista+).
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const data = [];
  pngs.forEach((p, i) => {
    const e = i * 16;
    const b = p.size >= 256 ? 0 : p.size; // 0 = 256
    entries[e] = b; entries[e + 1] = b;
    entries[e + 2] = 0; entries[e + 3] = 0;
    entries.writeUInt16LE(1, e + 4);      // planes
    entries.writeUInt16LE(32, e + 6);     // bitCount
    entries.writeUInt32LE(p.buf.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += p.buf.length;
    data.push(p.buf);
  });
  return Buffer.concat([header, entries, ...data]);
}

const SIZE = 512;
const png = encodePng(SIZE, SIZE, drawSun(SIZE));
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), png);
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png);

// ICO multi-ukuran untuk ikon taskbar/window (pengganti ikon Electron saat dev).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const ico = encodeIco(sizes.map((s) => ({ size: s, buf: encodePng(s, s, drawSun(s)) })));
fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico);

console.log('icon.png generated at', path.join(root, 'assets', 'icon.png'), `(${png.length} bytes)`);
console.log('icon.ico generated at', path.join(root, 'assets', 'icon.ico'), `(${ico.length} bytes)`);