'use strict';
/**
 * sunscraping — make-icon
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
  const bg = [37, 99, 235]; // brand blue background
  const sunFill = [253, 209, 23];
  const sunEdge = [245, 158, 11];
  const whites = [255, 255, 255];
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const rayInner = size * 0.30;
  const rayOuter = size * 0.46;
  const disc = size * 0.26;
  const rays = 12;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      let color = bg;

      if (dist <= disc) {
        color = sunFill;
      } else if (dist <= rayOuter) {
        const wedge = Math.PI / rays;
        const d = Math.abs((angle % (2 * wedge)) - wedge);
        const halfRay = wedge * 0.32;
        if (d < halfRay && dist >= rayInner) color = sunEdge;
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = 255;
    }
  }
  // garis putih tipis di tengah agar menyerupai sinar pada latar biru
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx; const dy = y - cy; const dist = Math.sqrt(dx * dx + dy * dy);
      if (Math.abs(dist - disc) < 1.0) {
        const idx = (y * size + x) * 4;
        rgba[idx] = whites[0]; rgba[idx + 1] = whites[1]; rgba[idx + 2] = whites[2]; rgba[idx + 3] = 255;
      }
    }
  }
  return rgba;
}

const SIZE = 512;
const png = encodePng(SIZE, SIZE, drawSun(SIZE));
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), png);
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png);
console.log('icon.png generated at', path.join(root, 'assets', 'icon.png'), `(${png.length} bytes)`);