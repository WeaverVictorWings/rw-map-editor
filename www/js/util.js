// 通用工具：base64、压缩、可增长数组、IndexedDB 小封装

export function b64ToBytes(str) {
  const clean = str.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// format: 'zlib' | 'gzip'
export function inflate(bytes, format) {
  return pipe(bytes, new DecompressionStream(format === 'gzip' ? 'gzip' : 'deflate'));
}
export function deflate(bytes, format) {
  return pipe(bytes, new CompressionStream(format === 'gzip' ? 'gzip' : 'deflate'));
}

// 可增长的 Int32 数组（撤销记录用）
export class Grow {
  constructor(n = 1024) { this.a = new Int32Array(n); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) {
      const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b;
    }
    this.a[this.n++] = v;
  }
  get length() { return this.n; }
  view() { return this.a.subarray(0, this.n); }
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- IndexedDB ----
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('rw-map-editor', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
export async function kvGet(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const t = d.transaction('kv', 'readonly').objectStore('kv').get(key);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
  } catch (e) { console.warn('kvGet', e); return undefined; }
}
export async function kvSet(key, val) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    return true;
  } catch (e) { console.warn('kvSet', e); return false; }
}
export async function kvDel(key) {
  try {
    const d = await db();
    await new Promise((res) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch (e) { /* ignore */ }
}
