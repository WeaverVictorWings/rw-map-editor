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

// 放物品：density 0~1（每格出现的概率），spacing = 两个物品之间至少空出的格数（0 = 可以紧挨着）
// 占地按实际放下的格子算：资源池默认只占 1 格（半径 0）；3×3 样式和 3×3 大岩石按 3×3 算（半径 1），
// 只是为了别让两个 3×3 边框互相覆盖（检查、自动细节、随机布点另按 1 格算）。
export function placeItems(tiles, it, opts = {}) {
  const m = ed.map, W = m.width, L = m.ensureLayer('Items');
  const density = opts.density ?? (A.itemDensity ?? 1);
  const seed = ed.op ? ed.op.time & 0xffff : 1;
  if (!it) return 0;
  let n = 0;
  if (it.stamp) {
    const gap = Math.max(0, opts.spacing ?? (A.itemSpacing ?? 0));
    const cells = ed.stampCells(it);
    const r = cells.some(([dx, dy]) => dx || dy) ? 1 : 0;   // 占地半径：1×1 → 0，3×3 → 1
    // gap = 两个物品之间空出的格数（界面上“最小间距”；0 = 可以紧挨着）。
    // 两物品中心距必须 > 2r + gap：1×1 时 r=0，gap=0 可紧挨（中心距 1）、gap=1 要隔 1 格（中心距 2）；
    // 3×3 时 r=1，两个印章边缘贴住就是“紧挨着”（中心距 3），再留 gap 就从 3+gap 起。
    const block = 2 * r + gap;                              // 判定用的切比雪夫扫描半径
    const minC = 2 * r + gap + 1;                           // 允许的最小中心距（含端点）
    // 已有的同类物品所占的全部格子（3×3 印章要把 9 格都算进来，否则看不出“这一印章会盖到已有物品”）
    const occ = new Set(it.pool ? [...tilesWith(L, (g) => g && isPoolGid(g))] : [...tilesWith(L, (g) => g === it.stamp[1][1])]);
    const stampCells = cells;
    const hitsExisting = (x, y) => stampCells.some(([dx, dy]) => occ.has((y + dy) * W + (x + dx)));
    const near = (x, y) => {
      if (hitsExisting(x, y)) return true;   // 3×3 印章别盖掉已有物品
      // 资源池按 1 格算，但它自己的 stampCells 只有 1 格；中心格已被占用时也要跳过
      // （density/间距扫描救不了这一点：两个池中心重合时 minC 判的是“距离 0 < minC”，要单独挡）
      if (it.pool && occ.has(y * W + x)) return true;
      if (minC <= 0) return false;
      for (let dy = -block; dy <= block; dy++) for (let dx = -block; dx <= block; dx++) {
        if (!dx && !dy) continue;
        // 3×3 印章：占的是 “中心 -1..+1” 这块，两个印章中心距 d 时
        // 一个格子的重叠条件是 |d| <= 2；要留 gap 就 |d| <= 2+gap
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (d >= minC) continue;
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < W && occ.has(Y * W + X)) return true;
      }
      return false;
    };
    const order = tiles.slice().sort((p, q) => hash(p % W, (p / W) | 0, seed) - hash(q % W, (q / W) | 0, seed));
    for (const k of order) {
      const x = k % W, y = (k - x) / W;
      if (density < 1 && hash(y, x, seed + 9) > density) continue;
      if (r && (x < r || y < r || x >= W - r || y >= m.height - r)) continue;
      if (near(x, y)) continue;
      ed.placeItemOne(L, it, x, y);
      for (const [dx, dy] of stampCells) occ.add((y + dy) * W + (x + dx));
      n++;
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

// 这一格算不算“已经是资源池”：按图块的 res_pool 属性认，不依赖 ed.poolGids 是否已经算好，
// 也不依赖 1×1 / 3×3 样式的中心图块具体是哪一个
function isPoolGid(gid) {
  const info = ed.map.tileInfo(gid);
  return !!(info && info.props && 'res_pool' in info.props);
}
