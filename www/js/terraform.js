// 图片转地图 / 随机生成共用的后处理：清理、写入地图、保证可玩
import { NONE } from './terrain.js';
import { Grow } from './util.js';
import { passability, LAND, HOVER } from './pathing.js';

// 多数滤波：每格改成 3x3 邻域里最多的类别
export function majority(cells, W, H, passes = 1, locked = null) {
  let a = cells, b = new Uint8Array(cells.length);
  const cnt = new Uint16Array(256);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (locked && locked[i]) { b[i] = a[i]; continue; }
      const seen = [];
      for (let dy = -1; dy <= 1; dy++) { const Y = y + dy; if (Y < 0 || Y >= H) continue; for (let dx = -1; dx <= 1; dx++) { const X = x + dx; if (X < 0 || X >= W) continue; const c = a[Y * W + X]; if (!cnt[c]) seen.push(c); cnt[c]++; } }
      let best = a[i], bn = cnt[a[i]];
      for (const c of seen) { if (cnt[c] > bn) { bn = cnt[c]; best = c; } }
      for (const c of seen) cnt[c] = 0;
      b[i] = best;
    }
    [a, b] = [b, a];
  }
  if (a !== cells) cells.set(a);
  return cells;
}

// 合并小区域：面积小于 minArea 的连通块并入四周最多的类别
// minFor(c)：可按类别给不同阈值（例如岛和湖分开设）
export function mergeSmall(cells, W, H, minFor, locked = null) {
  const lab = new Int32Array(W * H).fill(-1);
  const st = new Grow(4096);
  let changed = 0;
  for (let s = 0; s < W * H; s++) {
    if (lab[s] >= 0) continue;
    const c = cells[s];
    const comp = new Grow(64);
    lab[s] = s; st.push(s);
    const nbCount = new Map();
    while (st.n) {
      const i = st.a[--st.n]; comp.push(i);
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * H - W ? i + W : -1];
      for (const u of nb) {
        if (u < 0) continue;
        if (cells[u] === c) { if (lab[u] < 0) { lab[u] = s; st.push(u); } }
        else nbCount.set(cells[u], (nbCount.get(cells[u]) || 0) + 1);
      }
    }
    const min = minFor(c);
    if (comp.n >= min || !nbCount.size) continue;
    let anyLocked = false;
    if (locked) for (let k = 0; k < comp.n; k++) if (locked[comp.a[k]]) { anyLocked = true; break; }
    if (anyLocked) continue;
    let best = -1, bn = -1;
    for (const [k, v] of nbCount) if (v > bn) { bn = v; best = k; }
    for (let k = 0; k < comp.n; k++) cells[comp.a[k]] = best;
    changed += comp.n;
  }
  return changed;
}

// 去掉 1 格宽的细条（抗锯齿边缘常见）
export function removeThin(cells, W, H, passes = 2, locked = null) {
  let changed = 0;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (locked && locked[i]) continue;
      const c = cells[i];
      const l = x > 0 ? cells[i - 1] : c, r = x < W - 1 ? cells[i + 1] : c, u = y > 0 ? cells[i - W] : c, d = y < H - 1 ? cells[i + W] : c;
      if ((l !== c && r !== c) || (u !== c && d !== c)) {
        const cand = (l !== c && l === r) ? l : (u !== c && u === d) ? u : (l !== c ? l : u);
        cells[i] = cand; changed++;
      }
    }
  }
  return changed;
}

// 类别占比
export function shares(cells, K) {
  const n = new Float64Array(K);
  for (let i = 0; i < cells.length; i++) if (cells[i] < K) n[cells[i]]++;
  for (let k = 0; k < K; k++) n[k] /= cells.length || 1;
  return n;
}

// 把“每格一种地形”写进地图：先求角点（四格中最“居中”的地形），再修过渡、重铺
export function applyCells(ed, cells, op, x0 = 0, y0 = 0, w = ed.map.width, h = ed.map.height) {
  const eng = ed.engine;
  if (!eng) return;
  const K = eng.K, dist = eng.dist;
  const W1 = eng.W1;
  const at = (x, y) => cells[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    const c = [at(x - 1, y - 1), at(x, y - 1), at(x - 1, y), at(x, y)];
    let best = c[3], bc = 1e9;
    for (let k = 0; k < 4; k++) {
      if (c[k] === NONE) continue;
      let cost = 0;
      for (let j = 0; j < 4; j++) if (j !== k && c[j] !== NONE) cost += Math.min(20, dist[c[k] * K + c[j]]);
      if (cost < bc) { bc = cost; best = c[k]; }
    }
    if (best !== NONE) eng.V[(y0 + y) * W1 + x0 + x] = best;
  }
  eng.repairRect(op, x0, y0, x0 + w, y0 + h);
  eng.retileRect(op, x0 - 1, y0 - 1, x0 + w, y0 + h);
}

// 保证所有出生点陆路互通：不通时沿最短路线铺浅滩（水）或泥土（悬崖），宽度 3 格
export function connectSpawns(ed, op) {
  const m = ed.map, eng = ed.engine, W = m.width, H = m.height;
  if (!eng) return 0;
  const sp = ed.spawns().filter((s) => s.team >= 0);
  if (sp.length < 2) return 0;
  const bridge = ['Water Bridge', 'Shallow Water'].map((n) => eng.index(n)).find((t) => t >= 0 && eng.paintable.includes(t));
  const ground = ['Dirt', 'Sand', 'Grass'].map((n) => eng.index(n)).find((t) => t >= 0 && eng.paintable.includes(t));
  let carved = 0;
  for (let round = 0; round < sp.length; round++) {
    const pass = passability(ed);
    const start = Math.floor(sp[0].cy / 20) * W + Math.floor(sp[0].cx / 20);
    // 从第一个出生点做“代价最短路”：可走格代价 1，不可走格代价 8
    const cost = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1);
    const buckets = [[start]]; cost[start] = 0;
    for (let d = 0; d < buckets.length; d++) {
      const b = buckets[d]; if (!b) continue;
      for (const i of b) {
        if (cost[i] < d) continue;
        const x = i % W;
        for (const u of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * H - W ? i + W : -1]) {
          if (u < 0) continue;
          const c = d + ((pass[u] & LAND) ? 1 : 8);
          if (c < cost[u]) { cost[u] = c; prev[u] = i; (buckets[c] || (buckets[c] = [])).push(u); }
        }
      }
    }
    // 找第一个走不到的出生点
    const landDist = new Int32Array(W * H).fill(-1);
    { const q = [start]; landDist[start] = 0; while (q.length) { const i = q.pop(); const x = i % W; for (const u of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * H - W ? i + W : -1]) if (u >= 0 && landDist[u] < 0 && (pass[u] & LAND)) { landDist[u] = 1; q.push(u); } } }
    const bad = sp.find((s) => { const i = Math.floor(s.cy / 20) * W + Math.floor(s.cx / 20); return landDist[i] < 0; });
    if (!bad) break;
    let i = Math.floor(bad.cy / 20) * W + Math.floor(bad.cx / 20);
    const verts = [], vals = [];
    while (i >= 0 && i !== start) {
      if (!(pass[i] & LAND)) {
        const x = i % W, y = (i - x) / W;
        const t = (pass[i] & HOVER) ? bridge : ground;
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X > W || Y > H) continue;
          verts.push(Y * eng.W1 + X); vals.push(t);
        }
        carved++;
      }
      i = prev[i];
    }
    if (!verts.length) break;
    eng.paint(op, verts, vals);
  }
  return carved;
}

// 在可建造的陆地上选出生点：彼此尽量远、离边缘有余量；sym 给出对称方式
export function chooseSpawns(ed, n, sym = 'none', seed = 1) {
  const m = ed.map, W = m.width, H = m.height;
  const pass = passability(ed);
  const margin = Math.max(6, Math.round(Math.min(W, H) * 0.07));
  // 每格离不可建造区域的距离（切比雪夫），要求周围有一块空地
  const open = new Int16Array(W * H);
  for (let i = 0; i < W * H; i++) open[i] = (pass[i] & 8) ? 1000 : 0;
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) { const i = y * W + x; open[i] = Math.min(open[i], open[i - 1] + 1); }
  for (let y = 0; y < H; y++) for (let x = W - 2; x >= 0; x--) { const i = y * W + x; open[i] = Math.min(open[i], open[i + 1] + 1); }
  for (let x = 0; x < W; x++) for (let y = 1; y < H; y++) { const i = y * W + x; open[i] = Math.min(open[i], open[i - W] + 1); }
  for (let x = 0; x < W; x++) for (let y = H - 2; y >= 0; y--) { const i = y * W + x; open[i] = Math.min(open[i], open[i + W] + 1); }
  const groups = sym === 'quad' ? 4 : sym === 'none' ? 1 : 2;
  const inSource = (x, y) => sym === 'lr' || sym === 'rot' ? x < W / 2 : sym === 'tb' ? y < H / 2 : sym === 'quad' ? (x < W / 2 && y < H / 2) : true;
  const cand = [];
  for (let y = margin; y < H - margin - 4; y += 2) for (let x = margin; x < W - margin; x += 2) {
    const i = y * W + x;
    if (open[i] >= 4 && inSource(x, y)) cand.push([x, y, open[i]]);
  }
  if (!cand.length) return [];
  const per = Math.ceil(n / groups);
  let rnd = seed * 9301 + 49297;
  const rand = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
  const mirrorOf = (x, y) => {
    if (sym === 'lr') return [[W - 1 - x, y]];
    if (sym === 'tb') return [[x, H - 1 - y]];
    if (sym === 'rot') return [[W - 1 - x, H - 1 - y]];
    if (sym === 'quad') return [[W - 1 - x, y], [x, H - 1 - y], [W - 1 - x, H - 1 - y]];
    return [];
  };
  const chosen = [];
  const all = () => chosen.flatMap(([x, y]) => [[x, y], ...mirrorOf(x, y)]);
  for (let k = 0; k < per; k++) {
    let best = null, bs = -1;
    const pts = all();
    for (let t = 0; t < Math.min(cand.length, 4000); t++) {
      const c = cand[Math.floor(rand() * cand.length)];
      const others = [...pts, ...mirrorOf(c[0], c[1])];
      let d = others.length ? Math.min(...others.map(([x, y]) => Math.hypot(x - c[0], y - c[1]))) : Math.min(W, H);
      d = Math.min(d, Math.min(W, H) * 0.7) + Math.min(c[2], 10) * 0.5;
      if (d > bs) { bs = d; best = c; }
    }
    if (!best) break;
    chosen.push([best[0], best[1]]);
  }
  return all().slice(0, n).map(([x, y]) => [x, y]);
}

// 在出生点周围放资源池：沿步行距离 7~11 格、能建造的空地上
export function placePoolsAround(ed, op, spawnTiles, perTeam, centerPools = 0, sym = 'none') {
  const m = ed.map, W = m.width, H = m.height;
  const poolItem = ed.items.find((i) => i.pool);
  if (!poolItem) return 0;
  const L = m.ensureLayer('Items');
  const pass = passability(ed);
  const ok = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1) return false;
      const i = Y * W + X;
      if (!(pass[i] & 8) || L.data[i]) return false;
    }
    return true;
  };
  const put = (x, y) => { for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) ed.setTile(L, x - 1 + dx, y - 1 + dy, poolItem.stamp[dy][dx]); };
  let placed = 0;
  for (const [sx, sy] of spawnTiles) {
    const toC = Math.atan2(H / 2 - sy, W / 2 - sx);
    for (let k = 0; k < perTeam; k++) {
      const base = toC + (k - (perTeam - 1) / 2) * 0.9;
      let done = false;
      for (let tries = 0; tries < 24 && !done; tries++) {
        const ang = base + (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * 0.25;
        for (let d = 8; d <= 12 && !done; d++) {
          const x = Math.round(sx + d * Math.cos(ang)), y = Math.round(sy + d * Math.sin(ang));
          if (ok(x, y)) { put(x, y); placed++; done = true; }
        }
      }
    }
  }
  if (centerPools > 0) {
    const R = centerPools === 1 ? 0 : Math.min(W, H) * 0.08 + 3;
    for (let k = 0; k < centerPools; k++) {
      const ang = k * 2 * Math.PI / centerPools + Math.PI / 4;
      const x = Math.round(W / 2 + R * Math.cos(ang)), y = Math.round(H / 2 + R * Math.sin(ang));
      for (let r = 0; r < 8; r++) { if (ok(x + r, y)) { put(x + r, y); placed++; break; } }
    }
  }
  return placed;
}
