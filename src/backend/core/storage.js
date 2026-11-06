'use strict';
/**
 * sunscrap — backend/core/storage
 * Penyimpanan JSON kecil berbasis file (sinkron, proses utama).
 * Dipakai untuk window-state, worker-state, review-state.
 */

const fs = require('node:fs');
const path = require('node:path');

function createStorage(filePath) {
  let data = {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch {}
  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, filePath);
    } catch {}
  };
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
      persist();
    },
    remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
      persist();
    },
  };
}

module.exports = { createStorage };
