// 立绘贴图：把图片切成 20×20 小块，作为内嵌图块集放进地图（Items 层）
// 相同的小块只存一份；完全透明的块跳过
import { Tileset } from './tmx.js';
import { bytesToB64, escapeXml } from './util.js';

// 预处理：缩放、切块、去重，返回预估体积（还没写进地图）
export async function preparePicture(bitmap, widthTiles, opts = {}) {
  const tw = 20;
  const W = Math.max(1, Math.round(widthTiles)) * tw;
  const scale = W / bitmap.width;
  const Hraw = Math.round(bitmap.height * scale);
  const heightTiles = Math.max(1, Math.ceil(Hraw / tw));
  const H = heightTiles * tw;
  const c = new OffscreenCanvas(W, H);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(bitmap, 0, 0, W, Hraw);
  const img = x.getImageData(0, 0, W, H).data;
  const keyOf = (tx, ty) => {
    let h1 = 2166136261, h2 = 0, opaque = 0;
    for (let y = 0; y < tw; y++) for (let xx = 0; xx < tw; xx++) {
      const p = ((ty * tw + y) * W + tx * tw + xx) * 4;
      const a = img[p + 3];
      if (a > 8) opaque++;
      const v = a < 8 ? 0 : (img[p] << 16 | img[p + 1] << 8 | img[p + 2]) ^ (a << 24);
      h1 = Math.imul(h1 ^ v, 16777619); h2 = (h2 + v * 31 + y) | 0;
    }
    return opaque ? `${h1 >>> 0}:${h2}` : null;
  };
  const uniq = new Map(); // key -> local id
  const grid = new Int32Array(widthTiles * heightTiles).fill(-1);
  const order = [];
  for (let ty = 0; ty < heightTiles; ty++) for (let tx = 0; tx < widthTiles; tx++) {
    const k = keyOf(tx, ty);
    if (k === null) continue;
    if (!uniq.has(k)) { uniq.set(k, order.length); order.push([tx, ty]); }
    grid[ty * widthTiles + tx] = uniq.get(k);
  }
  const n = order.length;
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const atlas = new OffscreenCanvas(cols * tw, rows * tw);
  const ax = atlas.getContext('2d');
  order.forEach(([tx, ty], i) => ax.drawImage(c, tx * tw, ty * tw, tw, tw, (i % cols) * tw, Math.floor(i / cols) * tw, tw, tw));
  const blob = await atlas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { widthTiles, heightTiles, grid, count: n, cols, rows, atlas, png: bytes, kb: Math.round(bytes.length * 4 / 3 / 1024), preview: c, name: opts.name || 'picture' };
}

// 写进地图：新增一个图块集，返回可以“粘贴”的内容（由用户拖到想放的位置）
export async function addPictureTileset(ed, prep) {
  const m = ed.map;
  const firstgid = m.maxGid + 1;
  const name = uniqueName(m, prep.name);
  const doc = m.doc;
  const el = doc.createElement('tileset');
  el.setAttribute('firstgid', firstgid);
  el.setAttribute('name', name);
  el.setAttribute('tilewidth', 20); el.setAttribute('tileheight', 20);
  el.setAttribute('tilecount', prep.count); el.setAttribute('columns', prep.cols);
  const ps = doc.createElement('properties');
  const p = doc.createElement('property'); p.setAttribute('name', 'embedded_png');
  p.appendChild(doc.createTextNode('\n' + bytesToB64(prep.png) + '\n'));
  ps.appendChild(p); el.appendChild(ps);
  const im = doc.createElement('image');
  im.setAttribute('source', escapeXml(name) + '.png');
  im.setAttribute('width', prep.cols * 20); im.setAttribute('height', prep.rows * 20);
  el.appendChild(im);
  const last = [...m.root.querySelectorAll(':scope > tileset')].pop();
  m.root.insertBefore(el, last ? last.nextSibling : m.root.firstChild);
  const ts = new Tileset(el);
  ts.editorPicture = true;
  await ts.loadImage();
  m.tilesets.push(ts);
  m.tilesets.sort((a, b) => a.firstgid - b.firstgid);
  m.buildGidIndex();
  const w = prep.widthTiles, h = prep.heightTiles;
  const clip = { w, h, names: [], V: null, ground: new Uint32Array(w * h), items: new Uint32Array(w * h), mask: new Uint8Array(w * h), objects: [] };
  for (let i = 0; i < w * h; i++) { const id = prep.grid[i]; if (id >= 0) { clip.items[i] = firstgid + id; clip.mask[i] = 1; } }
  return { ts, clip };
}
export function removeTileset(ed, ts) {
  const m = ed.map;
  if (ts.el.parentNode) ts.el.parentNode.removeChild(ts.el);
  m.tilesets = m.tilesets.filter((t) => t !== ts);
  m.buildGidIndex();
}

function uniqueName(m, base) {
  base = (base || 'picture').replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 24) || 'picture';
  let n = base, k = 2;
  while (m.tilesets.some((t) => t.name === n)) n = base + '_' + k++;
  return n;
}
