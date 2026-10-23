// 按格子的形状绘制：物品、色块共用（画笔、矩形、椭圆、直线、油漆桶），支持密度和最小间距
import { A } from './state.js';
import { hash } from './editor.js';
import { wandSelection, selInside } from './transform.js';

const ed = A.ed;

// 一个形状覆盖的格子（不含对称）
export function shapeTiles(kind, a, b, size = 1) {
  const m = ed.map, out = [];
  const W = m.width, H = m.height;
  const push = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x); };
  if (kind === 'line') {
    const r = Math.max(0, Math.floor(size / 2));
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    const seen = new Set();
    for (let i = 0; i <= n; i++) {
      const cx = Math.round(a[0] + (b[0] - a[0]) * i / n), cy = Math.round(a[1] + (b[1] - a[1]) * i / n);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 0.5) continue;
        const X = cx + dx, Y = cy + dy, k = Y * W + X;
        if (X >= 0 && Y >= 0 && X < W && Y < H && !seen.has(k)) { seen.add(k); out.push(k); }
      }
    }
    return out;
  }
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.max(0.5, (x1 - x0 + 1) / 2), ry = Math.max(0.5, (y1 - y0 + 1) / 2);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (kind === 'ellipse' && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1.0001) continue;
    push(x, y);
  }
  return out;
}
// 加上对称副本
export function shapeTilesSym(kind, a, b, size) {
  const pa = ed.symPoints(a[0], a[1], 't'), pb = ed.symPoints(b[0], b[1], 't');
  const set = new Set();
  pa.forEach((p, i) => { const q = pb[i] || p; for (const k of shapeTiles(kind, p.map(Math.round), q.map(Math.round), size)) set.add(k); });
  return [...set];
}
// 笔刷覆盖的格子（含对称）
export function brushTiles(tx, ty, size = ed.size, shape = ed.shape) {
  const m = ed.map, W = m.width, H = m.height, r = Math.floor(size / 2), set = new Set();
  for (const [x, y] of ed.symPoints(tx, ty, 't')) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (shape === 'circle' && dx * dx + dy * dy > r * r + 0.5) continue;
      const X = Math.round(x) + dx, Y = Math.round(y) + dy;
      if (X >= 0 && Y >= 0 && X < W && Y < H) set.add(Y * W + X);
    }
  }
  return [...set];
}
// 油漆桶：和起点同一种地面（或同一种色块）连在一起的格子
export function fillTiles(tx, ty, global = false) {
  const sel = wandSelection(ed, tx, ty, global);
  if (!sel) return [];
  const W = ed.map.width, out = [];
  for (let y = sel.y0; y <= sel.y1; y++) for (let x = sel.x0; x <= sel.x1; x++) if (selInside(sel, x, y)) out.push(y * W + x);
  return out;
}

// 放物品：density 0~1（每格出现的概率），spacing 资源池等 3×3 物品之间的最小间距（格）
export function placeItems(tiles, it, opts = {}) {
  const m = ed.map, W = m.width, L = m.ensureLayer('Items');
  const density = opts.density ?? (A.itemDensity ?? 1);
  const seed = ed.op ? ed.op.time & 0xffff : 1;
  if (!it) return 0;
  let n = 0;
  if (it.stamp) {
    const spacing = Math.max(1, opts.spacing ?? (A.itemSpacing ?? 4));
    const big = ed.stampCells(it).length > 1;
    // 已有的同类物品中心
    const centers = new Set(it.pool ? (ed.poolGids ? [...tilesWith(L, (g) => ed.poolGids.has(g))] : []) : [...tilesWith(L, (g) => g === it.stamp[1][1])]);
    const near = (x, y) => {
      for (let dy = -spacing + 1; dy < spacing; dy++) for (let dx = -spacing + 1; dx < spacing; dx++) {
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < W && centers.has(Y * W + X)) return true;
      }
      return false;
    };
    const order = tiles.slice().sort((p, q) => hash(p % W, (p / W) | 0, seed) - hash(q % W, (q / W) | 0, seed));
    for (const k of order) {
      const x = k % W, y = (k - x) / W;
      if (density < 1 && hash(y, x, seed + 9) > density) continue;
      if (big && (x < 1 || y < 1 || x >= W - 1 || y >= m.height - 1)) continue;
      if (near(x, y)) continue;
      ed.placeItemOne(L, it, x, y);
      centers.add(k); n++;
    }
    return n;
  }
  const mix = ed.randomMix && ed.randomMix.length && opts.random ? ed.randomMix : null;
  const tot = mix ? mix.reduce((s, e) => s + e.w, 0) + (ed.randomGap || 0) : 0;
  for (const k of tiles) {
    const x = k % W, y = (k - x) / W;
    if (density < 1 && hash(x, y, seed + 3) > density) continue;
    let ci = it;
    if (mix) {
      let pick = hash(x, y, seed) * tot, ch = null;
      for (const e of mix) { if (pick < e.w) { ch = e; break; } pick -= e.w; }
      if (!ch) continue;
      ci = ed.item(ch.key); if (!ci || ci.stamp) continue;
    }
    ed.setTile(L, x, y, ci.variants[Math.floor(hash(x, y, 3) * ci.variants.length)]);
    n++;
  }
  return n;
}
function* tilesWith(L, pred) { const d = L.data; for (let i = 0; i < d.length; i++) if (d[i] && pred(d[i])) yield i; }

export function eraseTiles(L, tiles) { const W = ed.map.width; for (const k of tiles) ed.setTile(L, k % W, (k / W) | 0, 0); }

// 色块：直接换地面图块，并让地形引擎知道这里不是自动过渡的地形
export function paintColorTiles(tiles, gid) {
  const m = ed.map, W = m.width, G = m.ground;
  if (!G || !gid) return;
  if (tiles.length > 150000) ed.op.snapLayer(G);
  for (const k of tiles) {
    const x = k % W, y = (k - x) / W;
    ed.setTile(G, x, y, gid);
    if (ed.engine) ed.engine.syncRect(ed.op, x, y, x, y);
  }
}
