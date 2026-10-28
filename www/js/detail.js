// 自动丰富细节：修改器堆叠（可预览、可调、可多版本）、预设、规则、学习参考图、群系、高度、道路、战术模块、主题转换
// 所有修改器都在一份“工作副本”上运行：V = 角点地形，I = 物品图块，prot = 保护格（出生点、资源池附近）
import { A } from './state.js';
import { NONE } from './terrain.js';
import { hash } from './editor.js';
import { connectSpawns } from './terraform.js';
import { kvGet, kvSet } from './util.js';
import { Grow } from './util.js';

const ed = A.ed, rend = A.rend;

// ---------------- 工具 ----------------
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  const u = s(fx), v = s(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, oct = 4) { let v = 0, amp = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { v += vnoise(x * f, y * f, seed + o * 101) * amp; n += amp; amp /= 2; f *= 2; } return v / n; }
const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
// 两段噪声混合：一大一小，用来做“成团 + 碎边”的形状
function mix2(x, y, k, seed, big = 9, fine = 2.6) { return fbm(x / (big * k), y / (big * k), seed) * 0.72 + fbm(x / (fine * k), y / (fine * k), seed + 59) * 0.28; }
// 每格到最近“地形分界”的距离（格）；分界格本身为 0，找不到 -1
function edgeDist(w) {
  const W = w.W, H = w.H, d = new Int16Array(W * H).fill(-1), q = new Grow(4096);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = terrainOfTile(w, i);
    if ((x > 0 && terrainOfTile(w, i - 1) !== t) || (x < W - 1 && terrainOfTile(w, i + 1) !== t) ||
      (y > 0 && terrainOfTile(w, i - W) !== t) || (y < H - 1 && terrainOfTile(w, i + W) !== t)) { d[i] = 0; q.push(i); }
  }
  for (let h = 0; h < q.n; h++) {
    const i = q.a[h], x = i % W, y = (i - x) / W;
    if (x > 0 && d[i - 1] < 0) { d[i - 1] = d[i] + 1; q.push(i - 1); }
    if (x < W - 1 && d[i + 1] < 0) { d[i + 1] = d[i] + 1; q.push(i + 1); }
    if (y > 0 && d[i - W] < 0) { d[i - W] = d[i] + 1; q.push(i - W); }
    if (y < H - 1 && d[i + W] < 0) { d[i + W] = d[i] + 1; q.push(i + W); }
  }
  return d;
}

// 地形名字 → 引擎编号（找不到就 -1）
function T(ctx, ...names) { for (const n of names) { const t = ctx.eng.index(n); if (t >= 0 && ctx.eng.paintable.includes(t)) return t; } return -1; }
function itemByName(name) { return ed.items.find((i) => i.name === name) || null; }

// 工作副本
export function makeWork(opts = {}) {
  const m = ed.map, eng = ed.engine, W = m.width, H = m.height;
  const w = { W, H, W1: W + 1, V: eng.V.slice(), I: m.items ? Uint32Array.from(m.items.data) : new Uint32Array(W * H), prot: new Uint8Array(W * H), area: null };
  w.V0 = w.V.slice(); w.I0 = w.I.slice();   // 改动前的样子：收尾时只清这次动过的地方，不误伤玩家原有装饰
  // 保护：出生点周围、资源池周围（可关）
  if (opts.protect !== false) {
    const mark = (cx, cy, r) => { for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) w.prot[y * W + x] = 1; };
    for (const s of ed.spawns()) mark(Math.floor(s.cx / 20), Math.floor(s.cy / 20), 7);
    // 资源池本身就是 1 格（2.1 起 1×1），但要保护它周围 2 圈：地形交界常被 smooth/erode 切边，
    // 范围收太小会把资源池脚下的地切掉（2.4 回归：这里一度是 1，保护格 208→80）
    for (const [x, y] of ed.poolTiles()) mark(x, y, 2);
  }
  if (opts.area) { // 只改选区
    const s = opts.area; w.area = new Uint8Array(W * H);
    for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) if (!s.mask || s.mask[(y - s.y0) * (s.x1 - s.x0 + 1) + (x - s.x0)]) w.area[y * W + x] = 1;
  }
  return w;
}
const editable = (w, x, y) => { const i = y * w.W + x; return !w.prot[i] && (!w.area || w.area[i]); };
const vEditable = (w, x, y) => {
  // 角点：四周格子都允许改才改
  for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w.W && Y < w.H && !editable(w, X, Y)) return false; }
  return true;
};
const tileT = (w, x, y) => w.V[y * w.W1 + x]; // 格子的左上角点地形，当作这一格的地形
function terrainOfTile(w, i) { const x = i % w.W, y = (i - x) / w.W; return w.V[y * w.W1 + x]; }

// 到某类地形的距离（格），BFS
function distTo(w, pred, maxD = 64) {
  const W = w.W, H = w.H, d = new Int16Array(W * H).fill(-1), q = new Grow(4096);
  for (let i = 0; i < W * H; i++) if (pred(terrainOfTile(w, i))) { d[i] = 0; q.push(i); }
  for (let h = 0; h < q.n; h++) {
    const i = q.a[h]; if (d[i] >= maxD) continue;
    const x = i % W, y = (i - x) / W, nd = d[i] + 1;
    if (x > 0 && d[i - 1] < 0) { d[i - 1] = nd; q.push(i - 1); }
    if (x < W - 1 && d[i + 1] < 0) { d[i + 1] = nd; q.push(i + 1); }
    if (y > 0 && d[i - W] < 0) { d[i - W] = nd; q.push(i - W); }
    if (y < H - 1 && d[i + W] < 0) { d[i + W] = nd; q.push(i + W); }
  }
  return d;
}

// ---------------- 修改器 ----------------
// 每个：{cn, desc, params:[[key, 中文, min, max, step, 默认]], run(w, p, ctx)}
const isWater = (ctx, t) => t !== NONE && /water|lake/i.test(ctx.eng.name(t)) && !/bridge/i.test(ctx.eng.name(t));
const isLand = (ctx, t) => t !== NONE && !isWater(ctx, t) && !/lava|cliff|tree/i.test(ctx.eng.name(t));

export const MODS = {
  roughen: { cn: '边缘自然化', desc: '把笔直的地形边缘啃出小海湾和小半岛，像自然形成的一样', params: [['strength', '强度', 0, 100, 5, 50], ['scale', '弯曲大小', 2, 40, 1, 10]],
    run(w, p, ctx) {
      const { W1, H } = w, Wv = w.W, V = w.V, out = V.slice(), s = ctx.seed, sc = p.scale * ctx.k;
      const thr = 1 - (p.strength / 100) * 0.85;
      for (let y = 1; y < H; y++) for (let x = 1; x < Wv; x++) {
        const v = y * W1 + x, t = V[v];
        // 只处理“边界角点”，并且只朝相邻角点的地形“啃”，保证不会啃出孤立怪块
        const nb = [V[v - 1], V[v + 1], V[v - W1], V[v + W1]];
        const dif = []; for (const u of nb) if (u !== t && dif.indexOf(u) < 0) dif.push(u);
        if (!dif.length || !vEditable(w, x, y)) continue;
        // 大尺度决定哪里弯，小尺度决定弯的毛边
        const n = mix2(x, y, ctx.k, s, sc, Math.max(1.6, sc * 0.38));
        if (n < thr) continue;
        out[v] = dif[(hash(x, y, s + 7) * dif.length) | 0];
      }
      w.V = out;
    } },
  smooth: { cn: '平滑', desc: '去掉零碎的小点，让地形成片', params: [['passes', '次数', 1, 4, 1, 1]],
    run(w, p) {
      const { W1, H } = w, Wv = w.W;
      for (let it = 0; it < p.passes; it++) {
        const V = w.V, out = V.slice();
        for (let y = 1; y < H; y++) for (let x = 1; x < Wv; x++) {
          if (!vEditable(w, x, y)) continue;
          const v = y * W1 + x, cnt = new Map();
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const u = V[v + dy * W1 + dx]; cnt.set(u, (cnt.get(u) || 0) + 1); }
          let best = V[v], bn = 0; for (const [u, n] of cnt) if (n > bn) { bn = n; best = u; }
          if (bn >= 6) out[v] = best;
        }
        w.V = out;
      }
    } },
  scatter: { cn: '自然点缀', desc: '按地形撒树、草丛、碎石、仙人掌：成团分布，林缘更密、空地稀疏', params: [['density', '密度', 0, 100, 5, 40], ['cluster', '成团程度', 0, 100, 5, 60], ['edge', '林缘加密', 0, 100, 5, 45]],
    rules: [['Grass', 'Trees', 7], ['Grass', 'Grass', 5], ['Dirt', 'Stone', 4], ['Dirt', 'Holes', 1], ['Sand', 'Cacti', 3], ['Sand', 'Stone', 2], ['Dune', 'Cacti', 2], ['Snow', 'Stone', 2], ['Swamp', 'Mud', 6], ['Stone', 'Stone', 5]],
    run(w, p, ctx) { scatterRules(w, (p.rules || this.rules), p.density / 40, p.cluster / 100, ctx, (p.edge ?? 45) / 100); } },
  water: { cn: '水域细节', desc: '岸边加宽窄不一的浅水带，深海里点缀小岛，远离岸边的水变深', params: [['shore', '浅水带最宽（格）', 0, 8, 1, 3], ['vary', '宽窄变化', 0, 100, 5, 60], ['islands', '小岛数量', 0, 40, 1, 6]],
    run(w, p, ctx) {
      const sh = T(ctx, 'Shallow Water'), deep = T(ctx, 'Deep Water', 'Water'), sand = T(ctx, 'Sand'), grass = T(ctx, 'Grass');
      if (sh < 0) return;
      const dl = distTo(w, (t) => !isWater(ctx, t), 24);
      const { H } = w, Wv = w.W, vary = p.vary / 100, k = ctx.k, s = ctx.seed;
      const maxShore = p.shore * k;
      const tgt = new Uint8Array(Wv * H).fill(255);
      for (let y = 0; y < H; y++) for (let x = 0; x < Wv; x++) {
        const i = y * Wv + x; if (!isWater(ctx, terrainOfTile(w, i))) continue;
        const d = dl[i];
        // 浅水带宽度 = 基础宽度 × 噪声：同一片海，有的地方一大片浅滩，有的地方直接落深
        const nv = smooth01((mix2(x, y, k, s + 71, 9, 2.6) - 0.28) / 0.44);
        const wd = Math.max(0, maxShore * (1 - vary * 0.65 + vary * 1.7 * nv));
        tgt[i] = d >= 0 && d <= wd ? sh : deep >= 0 && (d < 0 || d > wd + 2.5) ? deep : 255;
      }
      applyTargets(w, tgt);
      if (p.islands <= 0 || sand < 0 || grass < 0) return;
      const r = rng(s + 5), m = Math.max(3, 4 * k);
      for (let n = 0; n < p.islands; n++) {
        for (let tries = 0; tries < 30; tries++) {
          const x = Math.floor(r() * Wv), y = Math.floor(r() * H), i = y * Wv + x;
          // 太靠边、离岸太近都不放，免得岛被地图边缘切掉
          if (x < m || y < m || x > Wv - m || y > H - m || dl[i] < 8 * k || !editable(w, x, y)) continue;
          const R = (2 + r() * 4) * k;
          if (blob(w, x, y, R * 1.6, sh, s + n) === 0) continue;
          blob(w, x, y, R, sand, s + n); blob(w, x, y, R * 0.55, grass, s + n);
          break;
        }
      }
    } },
  // 自然沙滩带：陆地一侧的沙、水一侧的浅水，宽度随噪声和岸线形状变化（不是等宽的一条）
  beach: { cn: '自然沙滩带', desc: '岸边生成宽窄不一、跟着海岸线弯曲的沙滩和浅水，不再是等宽的一条', params: [['width', '沙滩最宽（格）', 0, 8, 1, 4], ['shallow', '浅水最宽（格）', 0, 8, 1, 3], ['vary', '宽窄变化', 0, 100, 5, 70]],
    run(w, p, ctx) {
      const sand = T(ctx, 'Sand'), sh = T(ctx, 'Shallow Water'), deep = T(ctx, 'Deep Water', 'Water');
      if (sand < 0) return;
      const dw = distTo(w, (t) => isWater(ctx, t), 24);   // 陆地：到水的距离
      const dl = sh >= 0 ? distTo(w, (t) => isLand(ctx, t), 24) : null; // 水：到陆地的距离
      const { H } = w, Wv = w.W, vary = p.vary / 100, k = ctx.k, s = ctx.seed;
      const tgt = new Uint8Array(Wv * H).fill(255);
      for (let y = 0; y < H; y++) for (let x = 0; x < Wv; x++) {
        const i = y * Wv + x;
        const t = terrainOfTile(w, i);
        const nv = smooth01((mix2(x, y, k, s + 81, 11, 3) - 0.28) / 0.44);
        if (isLand(ctx, t)) {
          const d = dw[i]; if (d < 0) continue;
          const wd = Math.max(0, p.width * k * (1 - vary * 0.65 + vary * 1.7 * nv));
          if (d <= wd) tgt[i] = sand;
        } else if (dl && sh >= 0 && isWater(ctx, t)) {
          const d = dl[i]; if (d < 0) continue;
          const ws = Math.max(0, p.shallow * k * (1 - vary * 0.65 + vary * 1.7 * nv));
          if (d <= ws) tgt[i] = sh;
          else if (deep >= 0 && d > ws + 5 * k) tgt[i] = deep;
        }
      }
      applyTargets(w, tgt);
    } },
  erode: { cn: '海岸侵蚀', desc: '海岸被水冲出小海湾和沙嘴', params: [['strength', '强度', 0, 100, 5, 40]],
    run(w, p, ctx) {
      const sh = T(ctx, 'Shallow Water', 'Water'); if (sh < 0) return;
      const { W1, H } = w, Wv = w.W, V = w.V, out = V.slice();
      // 上限：最多啃掉一小片海岸，避免把陆地整块吃掉或切断道路
      let land = 0; for (let i = 0; i < Wv * H; i++) if (isLand(ctx, terrainOfTile(w, i))) land++;
      const cap = Math.max(24, Math.floor(land * 0.06 * (0.4 + p.strength / 100)));
      let cut = 0;
      for (let y = 1; y < H && cut < cap; y++) for (let x = 1; x < Wv && cut < cap; x++) {
        const v = y * W1 + x; if (!isLand(ctx, V[v]) || !vEditable(w, x, y)) continue;
        const nb = [V[v - 1], V[v + 1], V[v - W1], V[v + W1]];
        const nearW = nb.some((u) => isWater(ctx, u));
        if (!nearW || nb.filter((u) => isLand(ctx, u)).length < 2) continue;   // 至少还剩 2 个陆地邻居
        if (fbm(x / (6 * ctx.k), y / (6 * ctx.k), ctx.seed + 3) > 1 - p.strength / 160) { out[v] = sh; cut++; }
      }
      w.V = out;
    } },
  highland: { cn: '高地与悬崖', desc: '在离出生点远的地方加几块悬崖围起来的高地', params: [['count', '数量', 0, 20, 1, 4], ['size', '大小（格）', 4, 40, 1, 10]],
    run(w, p, ctx) {
      const cl = T(ctx, 'Dirt Cliff', 'Cliff'); if (cl < 0) return;
      const r = rng(ctx.seed + 11);
      placeBlobs(w, ctx, p.count, () => { const R = p.size * ctx.k * (0.6 + r() * 0.6); return [R, (x, y) => blob(w, x, y, R, cl, ctx.seed + x)]; }, r, (t) => isLand(ctx, t));
    } },
  forestPatch: { cn: '树林块', desc: '成片的树林地形，挡视线、挡通行', params: [['count', '数量', 0, 30, 1, 6], ['size', '大小（格）', 3, 30, 1, 7]],
    run(w, p, ctx) {
      const tr = T(ctx, 'Tree', 'Frozen Trees'); if (tr < 0) return;
      const r = rng(ctx.seed + 13);
      placeBlobs(w, ctx, p.count, () => { const R = p.size * ctx.k * (0.6 + r() * 0.7); return [R, (x, y) => blob(w, x, y, R, tr, ctx.seed + y, 0.7)]; }, r, (t) => /grass|dirt/i.test(ctx.eng.name(t) || ''));
    } },
  river: { cn: '河流', desc: '一条横穿地图的河，每隔一段有浅滩可以过', params: [['width', '宽度（格）', 2, 16, 1, 4], ['fords', '浅滩数量', 0, 12, 1, 3], ['count', '条数', 1, 3, 1, 1]],
    run(w, p, ctx) {
      const wt = T(ctx, 'Shallow Water', 'Water'), fd = T(ctx, 'Water Bridge', 'Shallow Water'); if (wt < 0) return;
      const r = rng(ctx.seed + 17), { W1, H } = w, Wv = w.W;
      const vertical = ctx.axis === 'lr'; // 左右对阵 → 河竖着流
      for (let c = 0; c < p.count; c++) {
        const L = vertical ? H : Wv, off = (c + 1) / (p.count + 1);
        const pts = [];
        for (let s = 0; s <= L; s++) {
          const wob = (fbm(s / (30 * ctx.k), c * 7.3, ctx.seed + 19) - 0.5) * 0.35;
          const q = Math.round(((vertical ? Wv : H) * (off + wob)));
          pts.push(vertical ? [q, s] : [s, q]);
        }
        const fordAt = new Set(); for (let f = 0; f < p.fords; f++) fordAt.add(Math.floor((f + 0.5) / p.fords * pts.length));
        const rad = p.width * ctx.k / 2;
        pts.forEach(([px, py], k) => {
          const isF = [...fordAt].some((fk) => Math.abs(fk - k) < Math.max(2, rad * 1.5));
          for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
            if (dx * dx + dy * dy > rad * rad) continue;
            const X = px + dx, Y = py + dy;
            if (X < 0 || Y < 0 || X > Wv || Y > H || !vEditable(w, X, Y)) continue;
            w.V[Y * W1 + X] = isF && fd >= 0 ? fd : wt;
          }
        });
      }
    } },
  // 蜿蜒河流：中心线反复拐弯、宽度沿河道变化，两岸有浅水，隔一段留浅滩
  riverBend: { cn: '蜿蜒河流', desc: '一条会拐弯、宽窄变化的河，两岸有水浅的河滩，隔一段能趟过去', params: [['width', '平均宽度（格）', 2, 14, 1, 5], ['meander', '弯曲程度', 0, 100, 5, 55], ['vary', '宽窄变化', 0, 100, 5, 55], ['fords', '浅滩数量', 0, 10, 1, 3], ['count', '条数', 1, 2, 1, 1]],
    run(w, p, ctx) {
      const wt = T(ctx, 'Water', 'Shallow Water'), sh = T(ctx, 'Shallow Water'), fd = T(ctx, 'Water Bridge', 'Shallow Water');
      if (wt < 0) return;
      const { W1, H } = w, Wv = w.W, k = ctx.k, s0 = ctx.seed;
      const vertical = ctx.axis === 'lr';        // 左右对阵 → 河竖着流
      const L = vertical ? H : Wv, span = vertical ? Wv : H;
      const sp = ed.spawns().map((s) => [s.cx / 20 * k, s.cy / 20 * k]);
      const wobAt = (u, ph) => (Math.sin(u * Math.PI * 2 * 1.25 + ph) * 0.55 + Math.sin(u * Math.PI * 2 * 0.65 + ph * 1.9) * 0.45) * (p.meander / 100) * 0.22;
      for (let c = 0; c < p.count; c++) {
        // 挑一条离出生点最远的中心线，尽量不从基地中间穿过去
        let best = null;
        for (let tries = 0; tries < 6; tries++) {
          const ph = tries * 1.7 + c * 2.9, off = 0.5 + (hash(tries, c, s0 + 89) - 0.5) * 0.14;
          let score = 1e9;
          for (let s = 0; s <= L; s += 3) {
            const q = (off + wobAt(s / L, ph) + (fbm(s / (60 * k), c * 7.7, s0 + 91) - 0.5) * 0.07) * span;
            for (const [sx, sy] of sp) score = Math.min(score, vertical ? Math.hypot(q - sx, s - sy) : Math.hypot(s - sx, q - sy));
          }
          if (!best || score > best.score) best = { ph, off, score };
          if (score > 20 * k) break;
        }
        const ph = best ? best.ph : 0, off = best ? best.off : 0.5;
        // 沿河的宽窄变化
        const wAt = (s) => { const t = smooth01((fbm(s / (34 * k), c * 5.3, s0 + 97) - 0.28) / 0.44); return Math.max(0.7, p.width * k / 2 * (1 - p.vary / 100 * 0.65 + p.vary / 100 * 1.8 * t)); };
        const fords = []; for (let f = 0; f < p.fords; f++) fords.push(Math.floor((f + 0.5) / Math.max(1, p.fords) * L));
        for (let s = 0; s <= L; s++) {
          const u = s / L;
          const q = (off + wobAt(u, ph) + (fbm(s / (60 * k), c * 7.7, s0 + 91) - 0.5) * 0.07) * span;
          const r = wAt(s), ri = Math.ceil(r + 1.5);
          const isF = fords.some((fk) => Math.abs(fk - s) < Math.max(2.5, r * 1.5));
          for (let d = -ri; d <= ri; d++) {
            const ad = Math.abs(d), X = vertical ? Math.round(q) + d : s, Y = vertical ? s : Math.round(q) + d;
            if (X < 0 || Y < 0 || X > Wv || Y > H || !vEditable(w, X, Y)) continue;
            if (isF) { if (fd >= 0) w.V[Y * W1 + X] = fd; }
            else if (ad <= r) w.V[Y * W1 + X] = wt;
            else if (sh >= 0 && hash(X, Y, s0 + 101) < 0.65) w.V[Y * W1 + X] = sh;   // 河滩：水浅，但别整条镶边
          }
        }
      }
    } },
  // 林缘加密：树林外 1~N 格加密放树、灌木、碎石，让林缘不生硬（只放装饰，不改地形/通行）
  forestEdge: { cn: '林缘加密', desc: '树林边上加一圈更密的树和灌木，让树林和草地的过渡更自然', params: [['density', '密度', 0, 100, 5, 55], ['width', '林缘宽（格）', 1, 10, 1, 4], ['bushes', '灌木比例', 0, 100, 5, 40]],
    run(w, p, ctx) {
      const trT = ['Tree', 'Frozen Trees'].map((n) => ctx.eng.index(n)).find((t) => t >= 0 && ctx.eng.paintable.includes(t));
      const trees = itemByName('Trees');
      if (trT < 0 || !trees || p.width < 1) return;
      const bush = itemByName('Grass'), stone = itemByName('Stone');
      const d = distTo(w, (t) => t === trT, p.width + 1);
      const { W, H } = w, s = ctx.seed, pr = p.density / 100 * 0.5, bk = p.bushes / 100;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (w.I[i] || !editable(w, x, y)) continue;
        const dd = d[i]; if (dd < 1 || dd > p.width) continue;
        const t = terrainOfTile(w, i);
        if (!isLand(ctx, t) || /tree|cliff|lava/i.test(ctx.eng.name(t) || '')) continue;
        if (w.V[(y + 1) * w.W1 + x + 1] !== t) continue;
        const f = 1 - (dd - 1) / Math.max(1, p.width) * 0.6;          // 越靠林缘越密
        const cl = 0.45 + mix2(x, y, ctx.k, s + 101, 6, 2.2) * 1.1;     // 成丛
        if (hash(x, y, s + 103) < pr * f * cl * 1.9) w.I[i] = trees.variants[(hash(y, x, s) * trees.variants.length) | 0];
        else if (bush && hash(y, x, s + 107) < pr * bk * f * 0.9) w.I[i] = bush.variants[(hash(x, y, s) * bush.variants.length) | 0];
        else if (stone && hash(x, y, s + 109) < pr * 0.12) w.I[i] = stone.variants[(hash(y, x, s) * stone.variants.length) | 0];
      }
    } },
  // 草地纹理：用现有的泥土/沙地地形把大片草地切成大小不一的碎块，再点草丛碎石
  meadow: { cn: '草地纹理', desc: '把大片草地切成大小不一的深色草块，再点一些草丛和碎石，远看不单调', params: [['scale', '色块大小', 3, 30, 1, 10], ['amount', '变化程度', 0, 100, 5, 38], ['tufts', '草丛密度', 0, 100, 5, 50]],
    run(w, p, ctx) {
      const grass = T(ctx, 'Grass'), dirt = T(ctx, 'Dirt'), sand = T(ctx, 'Sand');
      if (grass < 0 || (dirt < 0 && sand < 0)) return;
      const dt = dirt >= 0 ? dirt : sand, tuft = itemByName('Grass'), stone = itemByName('Stone');
      const { W, H } = w, s = ctx.seed, amt = p.amount / 100, k = ctx.k;
      const cut = 0.70 - amt * 0.22, sc = p.scale * k;
      const tgt = new Uint8Array(W * H).fill(255);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (terrainOfTile(w, i) !== grass) continue;
        // 大块 + 碎边：避免出现方正的一坨
        const m = mix2(x, y, k, s + 113, sc, Math.max(1.8, sc * 0.32));
        if (m > cut) { tgt[i] = dt; continue; }
        if (w.I[i] || !editable(w, x, y) || w.V[(y + 1) * w.W1 + x + 1] !== grass) continue;
        if (tuft && hash(x, y, s + 127) < amt * p.tufts / 100 * 0.10 * (0.5 + m)) w.I[i] = tuft.variants[(hash(y, x, s) * tuft.variants.length) | 0];
        else if (stone && hash(y, x, s + 131) < amt * 0.02) w.I[i] = stone.variants[(hash(x, y, s) * stone.variants.length) | 0];
      }
      applyTargets(w, tgt);
    } },
  swamp: { cn: '沼泽化', desc: '水边低地变成沼泽，夹着小水洼', params: [['amount', '范围', 0, 100, 5, 40]],
    run(w, p, ctx) {
      const sw = T(ctx, 'Swamp'), sh = T(ctx, 'Shallow Water'); if (sw < 0) return;
      const dw = distTo(w, (t) => isWater(ctx, t), 20);
      const { W1, H } = w, Wv = w.W;
      for (let y = 0; y < H; y++) for (let x = 0; x < Wv; x++) {
        const i = y * Wv + x; if (!isLand(ctx, terrainOfTile(w, i)) || !vEditable(w, x, y)) continue;
        const d = dw[i]; if (d < 0) continue;
        const n = fbm(x / (12 * ctx.k), y / (12 * ctx.k), ctx.seed + 23);
        if (n + (1 - d / (12 * ctx.k)) * 0.5 > 1.25 - p.amount / 100 * 0.6) w.V[y * W1 + x] = n > 0.78 && sh >= 0 ? sh : sw;
      }
    } },
  reef: { cn: '礁石海岸', desc: '岸边浅水里点缀礁石，海岸更有层次', params: [['density', '密度', 0, 100, 5, 30]],
    run(w, p, ctx) { scatterRules(w, [['Shallow Water', 'Stone', 5], ['Sand', 'Stone', 3]], p.density / 30, 0.7, ctx); } },
  warzone: { cn: '战损焦土', desc: '草地上出现焦土和弹坑，像打过仗', params: [['amount', '程度', 0, 100, 5, 40]],
    run(w, p, ctx) {
      const dirt = T(ctx, 'Dirt'); const { W1, H } = w, Wv = w.W;
      if (dirt >= 0) for (let y = 1; y < H; y++) for (let x = 1; x < Wv; x++) {
        const v = y * W1 + x; if (!/grass/i.test(ctx.eng.name(w.V[v]) || '') || !vEditable(w, x, y)) continue;
        if (fbm(x / (9 * ctx.k), y / (9 * ctx.k), ctx.seed + 29) > 1 - p.amount / 100 * 0.45) w.V[v] = dirt;
      }
      scatterRules(w, [['Dirt', 'Holes', 6], ['Grass', 'Holes', 1.5]], p.amount / 40, 0.6, ctx);
    } },
  lavaPools: { cn: '岩浆池', desc: '在远离出生点的地方加几片岩浆（四周自动加悬崖边）', params: [['count', '数量', 0, 20, 1, 3], ['size', '大小（格）', 2, 20, 1, 5]],
    run(w, p, ctx) {
      const lv = T(ctx, 'Lava'), cl = T(ctx, 'Dirt Cliff', 'Cliff'); if (lv < 0) return;
      const r = rng(ctx.seed + 31);
      placeBlobs(w, ctx, p.count, () => { const R = p.size * ctx.k * (0.6 + r() * 0.6); return [R + 2, (x, y) => { if (cl >= 0) blob(w, x, y, R + 1.5, cl, ctx.seed + x); blob(w, x, y, R, lv, ctx.seed + y); }]; }, r, (t) => isLand(ctx, t));
    } },
  noise: { cn: '随机起伏', desc: '按“高低”给平地加一点起伏：低处变沙地或浅滩，高处变泥土', params: [['amount', '幅度', 0, 100, 5, 30], ['scale', '起伏大小', 4, 60, 1, 18]],
    run(w, p, ctx) {
      const ladder = heightLadder(ctx); const { W1, H } = w, Wv = w.W;
      for (let y = 1; y < H; y++) for (let x = 1; x < Wv; x++) {
        const v = y * W1 + x, lv = ladder.indexOf(w.V[v]); if (lv < 0 || !vEditable(w, x, y)) continue;
        const n = (fbm(x / (p.scale * ctx.k), y / (p.scale * ctx.k), ctx.seed + 37) - 0.5) * 2 * p.amount / 100 * 2.2;
        const nl = Math.max(0, Math.min(ladder.length - 2, Math.round(lv + n)));
        if (isWater(ctx, ladder[lv]) !== isWater(ctx, ladder[nl])) continue; // 不把陆地变成水，避免切断道路
        w.V[v] = ladder[nl];
      }
    } },
  theme: { cn: '换主题', desc: '把整张图换成雪地、沙漠、火山或荒原风格，布局不变', params: [['theme', '主题（0温带 1雪地 2沙漠 3火山 4荒原）', 0, 4, 1, 1]],
    run(w, p, ctx) {
      const maps = [
        {},
        { Grass: 'Snow', Dirt: 'Ice', Sand: 'Snow', Tree: 'Frozen Trees', Water: 'Ice Lake', 'Shallow Water': 'Ice Lake', Lake: 'Ice Lake', Swamp: 'Ice' },
        { Grass: 'Sand', Dirt: 'Dune', Tree: 'Stone', Swamp: 'Dune', Snow: 'Sand' },
        { Grass: 'Dirt', Sand: 'Stone', Tree: 'Stone', Swamp: 'Lava', Snow: 'Stone', Lake: 'Lava' },
        { Grass: 'Dirt', Tree: 'Dirt Cliff', Swamp: 'Dirt', Snow: 'Dirt', Sand: 'Dirt' },
      ];
      const itemMaps = [{}, { Trees: 'Stone', Grass: 'Stone', Cacti: 'Stone' }, { Trees: 'Cacti', Grass: 'Cacti', Mud: 'Stone' }, { Trees: 'Stone', Grass: 'Holes', Cacti: 'Stone' }, { Trees: 'Holes', Grass: 'Stone' }];
      const mp = maps[p.theme | 0] || {}, lut = new Map();
      for (const [a, b] of Object.entries(mp)) { const ta = ctx.eng.index(a), tb = T(ctx, b); if (ta >= 0 && tb >= 0) lut.set(ta, tb); }
      const { W1, H } = w, Wv = w.W;
      for (let y = 0; y <= H; y++) for (let x = 0; x <= Wv; x++) { const v = y * W1 + x; const n = lut.get(w.V[v]); if (n !== undefined && vEditable(w, Math.min(x, Wv - 1), Math.min(y, H - 1))) w.V[v] = n; }
      const im = itemMaps[p.theme | 0] || {}, ilut = new Map();
      for (const [a, b] of Object.entries(im)) { const ia = itemByName(a), ib = itemByName(b); if (ia && ib && !ia.stamp && !ib.stamp) for (const g of ia.variants) ilut.set(g, ib.variants[0]); }
      for (let i = 0; i < w.I.length; i++) { const n = ilut.get(w.I[i]); if (n && !w.prot[i] && (!w.area || w.area[i])) w.I[i] = n; }
    } },
  clearDecor: { cn: '清掉装饰', desc: '去掉树、草丛、碎石等（资源池不动）', params: [['amount', '去掉比例', 0, 100, 5, 100]],
    run(w, p) { const keep = ed.poolGids || new Set(); for (let i = 0; i < w.I.length; i++) if (w.I[i] && !keep.has(w.I[i]) && !w.prot[i] && (!w.area || w.area[i]) && hash(i, 7, 3) < p.amount / 100) w.I[i] = 0; } },
  rules: { cn: '自定义规则', desc: '自己写“在什么地形、离什么多远、放什么、概率多少”', params: [['density', '整体密度', 0, 200, 5, 100]], custom: true,
    run(w, p, ctx) { runRules(w, p.list || [], p.density / 100, ctx); } },
  biome: { cn: '按群系填充', desc: '把用群系笔刷画好的区域，换成对应的地形组合和装饰', params: [['detail', '细节程度', 0, 100, 5, 60]],
    run(w, p, ctx) { applyBiomes(w, p.detail / 100, ctx); } },
};

function heightLadder(ctx) {
  return ['Deep Water', 'Water', 'Shallow Water', 'Sand', 'Grass', 'Dirt', 'Dirt Cliff'].map((n) => T(ctx, n)).filter((t, i, a) => t >= 0 && a.indexOf(t) === i);
}
// 离地图边缘至少 m 格（避免半截图形贴着边，看着像“边缘空洞”）
const inset = (w, x, y, m) => x >= m && y >= m && x < w.W - m && y < w.H - m;
// 一格的四个角都允许改（写一格四角之前用；比 vEditable 严，不会碰到邻格的保护）
const tileEditable = (w, x, y) => vEditable(w, x, y) && vEditable(w, x + 1, y) && vEditable(w, x, y + 1) && vEditable(w, x + 1, y + 1);
// 把一格的四角都改成 t；四角周围有保护/选区外的就不动手
function paintTile(w, x, y, t) {
  if (t < 0 || x < 0 || y < 0 || x >= w.W || y >= w.H) return false;
  if (!tileEditable(w, x, y)) return false;
  const v = y * w.W1 + x;
  w.V[v] = t; w.V[v + 1] = t; w.V[v + w.W1] = t; w.V[v + w.W1 + 1] = t;
  return true;
}
// 先按“格”算好目标地形（255 = 不变），再按角点周围 4 格的多数写角点。
// 直接逐格写左上角会造成沙滩/浅水带椒盐边，这样写出来是一圈连续的过渡。
function applyTargets(w, tgt) {
  const { W, H, W1, V } = w, out = V.slice();
  const vs = new Int16Array(4), ns = new Int16Array(4);
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
    let n = 0, total = 0;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      total++;
      const t = tgt[Y * W + X]; if (t === 255) continue;
      let k = 0; for (; k < n; k++) if (vs[k] === t) break;
      if (k === n) { vs[n] = t; ns[n] = 1; n++; } else ns[k]++;
    }
    if (!n) continue;
    let bi = 0; for (let k = 1; k < n; k++) if (ns[k] > ns[bi]) bi = k;
    if (ns[bi] * 2 > total && vEditable(w, x, y)) out[y * W1 + x] = vs[bi];
  }
  w.V = out;
}
function blob(w, cx, cy, R, t, seed, noise = 0.45) {
  if (t < 0) return 0;
  const { W1, H } = w, Wv = w.W, r = Math.ceil(R * 1.4);
  let n = 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(H, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(Wv, cx + r); x++) {
    const d = Math.hypot(x - cx, y - cy) / R + (vnoise(x / 3, y / 3, seed) - 0.5) * noise;
    if (d <= 1 && vEditable(w, x, y)) { w.V[y * W1 + x] = t; n++; }
  }
  return n;
}
// 在离出生点远、地形合适的地方放 n 个团块（不贴地图边缘）
function placeBlobs(w, ctx, n, make, r, okTerrain) {
  const sp = ed.spawns().map((s) => [s.cx / 20 * ctx.k, s.cy / 20 * ctx.k]);
  const placed = [];
  for (let k = 0; k < n; k++) {
    const [R, draw] = make();
    for (let tries = 0; tries < 60; tries++) {
      const x = Math.floor(r() * w.W), y = Math.floor(r() * w.H);
      if (!inset(w, x, y, Math.ceil(R) + 2)) continue;
      if (sp.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < R + 12 * ctx.k)) continue;
      if (placed.some(([px, py, pr]) => Math.hypot(px - x, py - y) < pr + R + 4)) continue;
      draw(x, y); placed.push([x, y, R]); break;
    }
  }
}
// 撒物品：rules [[地形名, 物品名, 百分比]]
// edge > 0 时：树靠近树林更密（林缘），草丛/碎石/泥坑沿地形分界更密
function scatterRules(w, rules, mul, cluster, ctx, edge = 0) {
  const comp = rules.map(([tn, iname, pct]) => {
    const t = ctx.eng.index(tn), it = itemByName(iname);
    if (t < 0 || !it || it.stamp) return null;
    return { t, it, pr: pct / 100 * mul, tree: /tree/i.test(it.name), buff: /grass|stone|mud|cacti|hole/i.test(it.name) };
  }).filter(Boolean);
  if (!comp.length) return;
  const { W, H } = w, k = ctx.k, s = ctx.seed, cl = cluster;
  // 边界距离 / 树林距离都只算一次（BFS），避免在循环里重复
  const bd = edge > 0 ? edgeDist(w) : null;
  const trT = edge > 0 ? ['Tree', 'Frozen Trees'].map((n) => ctx.eng.index(n)).find((t) => t >= 0 && ctx.eng.paintable.includes(t)) : -1;
  const td = trT >= 0 && comp.some((c) => c.tree) ? distTo(w, (t) => t === trT, 8) : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (w.I[i] || !editable(w, x, y)) continue;
    const t = tileT(w, x, y);
    // 四个角都是同一种地形才放，避免放在过渡边上
    if (w.V[(y + 1) * w.W1 + x + 1] !== t) continue;
    // 大团 + 小碎团：团中心密、团外接近 0（开阔草地稀疏）；cluster 越大对比越强
    const m = mix2(x, y, k, s + 41, 7, 2.6);
    const clump = 1 - cl + cl * 2.9 * Math.pow(smooth01((m - (0.52 - cl * 0.2)) / 0.26), 1.3);
    let acc = hash(x, y, s + 43);
    for (const c of comp) {
      if (c.t !== t) continue;
      let f = clump;
      if (edge > 0) {
        if (c.tree && td) { const d = td[i]; if (d >= 0 && d <= 7) f *= 1 + edge * 2.4 * (1 - d / 8); }
        else if (c.buff && bd) { const d = bd[i]; if (d >= 0 && d <= 4) f *= 1 + edge * 1.1 * (1 - d / 5); }
      }
      const pp = c.pr * f;
      if (acc < pp) { w.I[i] = c.it.variants[(hash(y, x, s) * c.it.variants.length) | 0]; break; }
      acc -= pp;
    }
  }
}
// 自定义规则：{on: 地形名, near: 地形名|'', dmin, dmax, put: 'item:名字' | 'terrain:名字', prob(%), cluster(%)}
function runRules(w, list, mul, ctx) {
  for (const r of list) {
    const on = ctx.eng.index(r.on);
    const dist = r.near ? distTo(w, (t) => ctx.eng.name(t) === r.near, Math.max(1, r.dmax || 1) + 1) : null;
    const [kind, nm] = String(r.put || '').split(':');
    const it = kind === 'item' ? itemByName(nm) : null, tt = kind === 'terrain' ? T(ctx, nm) : -1;
    if (!it && tt < 0) continue;
    const { W, H } = w, pr = (r.prob || 0) / 100 * mul, cl = (r.cluster || 0) / 100;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!editable(w, x, y)) continue;
      if (on >= 0 && tileT(w, x, y) !== on) continue;
      if (dist) { const d = dist[i]; if (d < 0 || d < (r.dmin || 0) || d > (r.dmax ?? 1)) continue; }
      const c = cl ? Math.pow(fbm(x / (5 * ctx.k), y / (5 * ctx.k), ctx.seed + 47), 1 + cl * 3) * (1 + cl * 3) : 1;
      if (hash(x, y, ctx.seed + 53 + (r.seed || 0)) >= pr * c) continue;
      if (it) { if (!it.stamp && !w.I[i]) w.I[i] = it.variants[Math.floor(hash(y, x, 5) * it.variants.length)]; }
      else paintTile(w, x, y, tt);
    }
  }
}

// ---------------- 群系 ----------------
export const BIOMES = [
  [0, '无', '#00000000'], [1, '森林', '#2f7d32'], [2, '草原', '#9ccc65'], [3, '沙漠', '#e6c36a'], [4, '雪原', '#e3f2fd'], [5, '沼泽', '#6d7f3a'], [6, '火山', '#d84315'], [7, '荒原', '#8d6e63'],
];
function applyBiomes(w, detail, ctx) {
  const bm = A.biomeMask; if (!bm || bm.length !== w.W * w.H) return;
  const recipe = {
    1: { base: ['Grass'], spots: [['Tree', 0.55], ['Dirt', 0.12]], items: [['Grass', 'Trees', 14], ['Grass', 'Grass', 6]] },
    2: { base: ['Grass'], spots: [['Dirt', 0.12]], items: [['Grass', 'Grass', 8], ['Grass', 'Trees', 2]] },
    3: { base: ['Sand'], spots: [['Dune', 0.35], ['Stone', 0.08]], items: [['Sand', 'Cacti', 4], ['Dune', 'Cacti', 2], ['Sand', 'Stone', 2]] },
    4: { base: ['Snow'], spots: [['Ice', 0.22], ['Frozen Trees', 0.25]], items: [['Snow', 'Stone', 2]] },
    5: { base: ['Swamp'], spots: [['Shallow Water', 0.25], ['Grass', 0.15]], items: [['Swamp', 'Mud', 8], ['Grass', 'Grass', 5]] },
    6: { base: ['Dirt'], spots: [['Stone', 0.3], ['Lava', 0.08]], items: [['Dirt', 'Holes', 3], ['Stone', 'Stone', 4]] },
    7: { base: ['Dirt'], spots: [['Stone', 0.15], ['Sand', 0.12]], items: [['Dirt', 'Stone', 4], ['Dirt', 'Holes', 2]] },
  };
  const { W1, H } = w, Wv = w.W;
  const sc = 7 * ctx.k;
  for (let y = 0; y <= H; y++) for (let x = 0; x <= Wv; x++) {
    const bi = bm[Math.min(H - 1, y) * Wv + Math.min(Wv - 1, x)]; if (!bi || !recipe[bi]) continue;
    if (!vEditable(w, Math.min(x, Wv - 1), Math.min(y, H - 1))) continue;
    const r = recipe[bi], v = y * W1 + x;
    if (isWater(ctx, w.V[v]) && bi !== 5) continue; // 群系不填水面
    let t = T(ctx, ...r.base);
    let acc = fbm(x / sc, y / sc, ctx.seed + bi * 13);
    for (const [nm, share] of r.spots) { if (acc > 1 - share * detail * 1.4) { const tt = T(ctx, nm); if (tt >= 0) t = tt; break; } acc += share * 0.6; }
    if (t >= 0) w.V[v] = t;
  }
  const items = [];
  for (const [bi, r] of Object.entries(recipe)) for (const it of r.items) items.push([+bi, ...it]);
  const save = w.area; w.area = new Uint8Array(w.W * w.H);
  for (const [bi, tn, iname, pct] of items) {
    for (let i = 0; i < bm.length; i++) w.area[i] = bm[i] === bi && (!save || save[i]) ? 1 : 0;
    scatterRules(w, [[tn, iname, pct]], detail * 1.2, 0.6, ctx);
  }
  w.area = save;
}

// ---------------- 对称 ----------------
export function detectSymmetry() {
  const m = ed.map, eng = ed.engine, W = m.width, H = m.height;
  const kinds = [['lr', (x, y) => [W - 1 - x, y]], ['tb', (x, y) => [x, H - 1 - y]], ['rot', (x, y) => [W - 1 - x, H - 1 - y]]];
  let best = null;
  for (const [k, f] of kinds) {
    let bad = 0, n = 0;
    for (let y = 0; y < H; y += Math.max(1, (H / 120) | 0)) for (let x = 0; x < W; x += Math.max(1, (W / 120) | 0)) { const [a, b] = f(x, y); n++; if (eng.tileTerrain(y * W + x) !== eng.tileTerrain(b * W + a)) bad++; }
    const r = bad / n;
    if (r < 0.04 && (!best || r < best[1])) best = [k, r];
  }
  return best ? best[0] : 'none';
}
function symmetrize(w, kind) {
  if (kind === 'none') return;
  const { W1, H } = w, Wv = w.W;
  const src = (x, y, vert) => {
    const mx = vert ? Wv : Wv - 1, my = vert ? H : H - 1;
    if (kind === 'lr') return x > mx / 2 ? [mx - x, y, 'h'] : null;
    if (kind === 'tb') return y > my / 2 ? [x, my - y, 'v'] : null;
    if (kind === 'rot') return x > mx / 2 ? [mx - x, my - y, 'r180'] : null;
    if (kind === 'quad') { const r = x > mx / 2, b = y > my / 2; if (!r && !b) return null; return [r ? mx - x : x, b ? my - y : y, r && b ? 'r180' : r ? 'h' : 'v']; }
    return null;
  };
  for (let y = 0; y <= H; y++) for (let x = 0; x <= Wv; x++) { const s = src(x, y, true); if (s && vEditable(w, x, y)) w.V[y * W1 + x] = w.V[s[1] * W1 + s[0]]; }
  for (let y = 0; y < H; y++) for (let x = 0; x < Wv; x++) {
    const s = src(x, y, false); if (!s) continue;
    const i = y * Wv + x; if (w.prot[i]) continue;
    const g = w.I[s[1] * Wv + s[0]];
    w.I[i] = g && !(ed.poolGids && ed.poolGids.has(g)) ? ed.itemTupleTransform(g, s[2]) : (ed.poolGids && ed.poolGids.has(w.I[i]) ? w.I[i] : 0);
  }
}

// ---------------- 运行一组修改器 ----------------
// stack: [{id, on, p:{...}}]；opts: {seed, area, protect, sym:'auto'|'none'|..., k(缩放比例，预览用)}
export async function runStack(w, stack, opts = {}) {
  const ctx = { eng: ed.engine, seed: (opts.seed || 1) | 0, k: opts.k || 1, axis: axisOf() };
  for (const s of stack) {
    if (s.on === false) continue;
    const M = MODS[s.id]; if (!M) continue;
    const p = { ...Object.fromEntries(M.params.map(([k, , , , , d]) => [k, d])), ...(s.p || {}) };
    M.run.call(M, w, p, ctx);
    if (opts.yield) await new Promise((r) => setTimeout(r, 0));
  }
  const sym = opts.sym === 'auto' || opts.sym === undefined ? A.detailSym || 'none' : opts.sym;
  symmetrize(w, sym);
  if (opts.clean !== false) cleanupWork(w, ctx);
  return w;
}
// 收尾：补掉 1 格小洞（贴着地图边缘的也算），清掉压在水/岩浆/悬崖上的装饰。不动保护和选区外。
function cleanupWork(w, ctx) {
  const W = w.W, H = w.H, W1 = w.W1, I = w.I, eng = ctx.eng;
  // 1. 1 格洞：上下左右地形一致、和自己不同 → 补成邻居的地形（地图边缘缺邻居时至少 2 个邻居一致）
  const out = w.V.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!tileEditable(w, x, y)) continue;
    const i = y * W + x, t = terrainOfTile(w, i);
    let same = -1, ok = true, cnt = 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 1 ? 1 : k === 0 ? -1 : 0), ny = y + (k === 3 ? 1 : k === 2 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const u = terrainOfTile(w, ny * W + nx); cnt++;
      if (same < 0) same = u; else if (u !== same) { ok = false; break; }
    }
    if (!ok || cnt < 2 || same < 0 || same === t) continue;
    const v = y * W1 + x; out[v] = same; out[v + 1] = same; out[v + W1] = same; out[v + W1 + 1] = same;
  }
  w.V = out;
  // 2. 装饰不能压在水/岩浆/悬崖/树林地形上（浅水里的礁石保留）
  const pool = ed.poolGids || new Set(), nmCache = new Map();
  for (let i = 0; i < W * H; i++) {
    const g = I[i]; if (!g || pool.has(g)) continue;
    const t = terrainOfTile(w, i);
    const tn = t === NONE ? '' : eng.name(t) || '';
    if (!/water|lake|lava|cliff|tree/i.test(tn) || /bridge/i.test(tn)) continue;
    // 原本就有、这块地形又没变 → 是玩家自己放的，别删
    if (w.I0 && I[i] === w.I0[i] && (!w.V0 || w.V0[(i % W + ((i / W) | 0) * W1)] === t)) continue;
    let nm = nmCache.get(g);
    if (nm === undefined) { nm = (ed.items.find((it) => it.variants.includes(g)) || {}).name || ''; nmCache.set(g, nm); }
    if (/stone/i.test(nm) && /shallow/i.test(tn)) continue;
    I[i] = 0;
  }
}
function axisOf() {
  const sp = ed.spawns(); if (sp.length < 2) return 'lr';
  const xs = sp.map((s) => s.cx), ys = sp.map((s) => s.cy);
  return Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 'lr' : 'tb';
}

// 把工作副本写回地图（一次可撤销的操作）
export function applyWork(w, label, opts = {}) {
  const m = ed.map, eng = ed.engine, W = m.width, H = m.height;
  const op = ed.begin(label);
  op.snapV(); op.snapLayer(eng.layer);
  const I = m.ensureLayer('Items'); op.snapLayer(I);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
    const v = y * eng.W1 + x;
    if (eng.V[v] !== w.V[v]) { eng.V[v] = w.V[v]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  if (x1 >= 0) { eng.repairRect(op, Math.max(0, x0 - 2), Math.max(0, y0 - 2), Math.min(W, x1 + 2), Math.min(H, y1 + 2)); eng.retileRect(op, Math.max(0, x0 - 3), Math.max(0, y0 - 3), Math.min(W - 1, x1 + 2), Math.min(H - 1, y1 + 2)); }
  // 物品改动顺带记一个范围：下面清理装饰只扫这一块，大图省时间
  let ix0 = W, iy0 = H, ix1 = -1, iy1 = -1;
  for (let i = 0; i < W * H; i++) if (I.data[i] !== w.I[i]) {
    op.tile(I, i, I.data[i], I.flips.get(i) || 0, w.I[i], 0);
    const x = i % W, y = (i - x) / W;
    if (x < ix0) ix0 = x; if (y < iy0) iy0 = y; if (x > ix1) ix1 = x; if (y > iy1) iy1 = y;
  }
  // 装饰不能压在悬崖、水上（只清理这次新放的）
  if (ix1 >= 0) {
    const nmCache = new Map();
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
      const i = y * W + x, g = I.data[i];
      if (!g || (ed.poolGids && ed.poolGids.has(g))) continue;
      if (w.I[i] !== g) continue;
      const t = eng.tileTerrain(i);
      if (t === NONE || !/water|lake|lava|cliff|tree/i.test(eng.name(t)) || /bridge/i.test(eng.name(t))) continue;
      let nm = nmCache.get(g);
      if (nm === undefined) { nm = (ed.items.find((it) => it.variants.includes(g)) || {}).name || ''; nmCache.set(g, nm); }
      if (/stone/i.test(nm) && /shallow/i.test(eng.name(t))) continue; // 浅水里的礁石保留
      op.tile(I, i, g, 0, 0, 0);
    }
  }
  let carved = 0;
  if (opts.connect !== false) carved = connectSpawns(ed, op);
  op.markAll();
  ed.commit();
  return { carved };
}

// 缩小版工作副本（大图预览、多版本对比用）
export function shrinkWork(w, maxSide = 360) {
  const k = Math.min(1, maxSide / Math.max(w.W, w.H));
  if (k >= 1) return { w, k: 1 };
  const W = Math.max(8, Math.round(w.W * k)), H = Math.max(8, Math.round(w.H * k));
  const s = { W, H, W1: W + 1, V: new Uint8Array((W + 1) * (H + 1)), I: new Uint32Array(W * H), prot: new Uint8Array(W * H), area: w.area ? new Uint8Array(W * H) : null };
  s.V0 = w.V0 ? new Uint8Array((W + 1) * (H + 1)) : null; s.I0 = w.I0 ? new Uint32Array(W * H) : null;
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) s.V[y * (W + 1) + x] = w.V[Math.min(w.H, Math.round(y / k)) * w.W1 + Math.min(w.W, Math.round(x / k))];
  if (s.V0) for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) s.V0[y * (W + 1) + x] = w.V0[Math.min(w.H, Math.round(y / k)) * w.W1 + Math.min(w.W, Math.round(x / k))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = Math.min(w.H - 1, (y / k) | 0) * w.W + Math.min(w.W - 1, (x / k) | 0); s.I[y * W + x] = w.I[j]; s.prot[y * W + x] = w.prot[j]; if (s.area) s.area[y * W + x] = w.area[j]; if (s.I0) s.I0[y * W + x] = w.I0[j]; }
  return { w: s, k };
}
// 画预览
export function drawWork(w, cv) {
  const eng = ed.engine, col = rend.colors;
  cv.width = w.W; cv.height = w.H;
  const x = cv.getContext('2d'), img = x.createImageData(w.W, w.H), p = img.data;
  const tc = new Map();
  for (let i = 0; i < w.W * w.H; i++) {
    const t = terrainOfTile(w, i);
    let c = tc.get(t);
    if (!c) { const g = t !== NONE ? eng.solidGid(t) : 0; c = g ? [col[g * 4], col[g * 4 + 1], col[g * 4 + 2]] : [255, 0, 255]; tc.set(t, c); }
    let [r, gg, b] = c;
    const it = w.I[i];
    if (it) { if (ed.poolGids && ed.poolGids.has(it)) { r = 255; gg = 211; b = 77; } else { const k = it * 4; if (col[k + 3]) { r = (r + col[k]) / 2; gg = (gg + col[k + 1]) / 2; b = (b + col[k + 2]) / 2; } } }
    p[i * 4] = r; p[i * 4 + 1] = gg; p[i * 4 + 2] = b; p[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  // 出生点
  const kx = w.W / ed.map.width;
  for (const s of ed.spawns()) { x.fillStyle = '#fff'; x.fillRect(s.cx / 20 * kx - 1.5, s.cy / 20 * kx - 1.5, 3, 3); }
}

// ---------------- 预设 ----------------
const S = (id, p = {}) => ({ id, on: true, p });
export const STYLE_PRESETS = [
  { id: 'grassland', cn: '自然草原', stack: [S('roughen', { strength: 45 }), S('meadow', { scale: 12, amount: 24 }), S('scatter', { density: 45, cluster: 70, edge: 55 })] },
  { id: 'forest', cn: '茂密森林', stack: [S('roughen'), S('forestPatch', { count: 10, size: 8 }), S('forestEdge', { density: 70, width: 5 }), S('scatter', { density: 80, cluster: 75, edge: 60 })] },
  { id: 'desert', cn: '沙漠戈壁', stack: [S('theme', { theme: 2 }), S('roughen', { strength: 55 }), S('noise', { amount: 35 }), S('scatter', { density: 30 })] },
  { id: 'snow', cn: '雪原冰湖', stack: [S('theme', { theme: 1 }), S('roughen'), S('scatter', { density: 25 })] },
  { id: 'volcano', cn: '火山熔岩', stack: [S('theme', { theme: 3 }), S('lavaPools', { count: 4 }), S('highland', { count: 3 }), S('scatter', { density: 25 })] },
  { id: 'swamp', cn: '沼泽湿地', stack: [S('swamp', { amount: 55 }), S('roughen'), S('scatter', { density: 45 })] },
  { id: 'islands', cn: '热带群岛海岸', stack: [S('erode', { strength: 45 }), S('beach', { width: 3, shallow: 3, vary: 80 }), S('water', { shore: 3, vary: 55, islands: 10 }), S('reef'), S('scatter', { density: 40 })] },
  { id: 'warzone', cn: '战损焦土', stack: [S('warzone', { amount: 55 }), S('scatter', { density: 20 })] },
  { id: 'canyon', cn: '高原峡谷', stack: [S('highland', { count: 8, size: 14 }), S('roughen', { strength: 60 }), S('scatter', { density: 30 })] },
  { id: 'delta', cn: '河流三角洲', stack: [S('riverBend', { width: 5, meander: 60, fords: 4 }), S('swamp', { amount: 30 }), S('beach', { width: 2, shallow: 2 }), S('water', { shore: 2, islands: 4 }), S('scatter', { density: 35 })] },
  { id: 'lakeside', cn: '湖畔草原', stack: [S('beach', { width: 4, shallow: 3, vary: 80 }), S('meadow', { scale: 10, amount: 30, tufts: 60 }), S('roughen', { strength: 40 }), S('scatter', { density: 45, cluster: 65, edge: 60 })] },
  { id: 'trueline', cn: '密林山脊', stack: [S('highland', { count: 5, size: 12 }), S('forestPatch', { count: 9, size: 9 }), S('roughen', { strength: 35 }), S('forestEdge', { density: 65, width: 5, bushes: 45 }), S('scatter', { density: 35, cluster: 70, edge: 50 })] },
];
export async function userPresets() { return (await kvGet('detailPresets')) || []; }
export async function saveUserPreset(name, stack) { const l = await userPresets(); l.unshift({ id: 'u' + Date.now(), cn: name, stack: JSON.parse(JSON.stringify(stack)), user: true }); await kvSet('detailPresets', l.slice(0, 60)); }
export async function deleteUserPreset(id) { await kvSet('detailPresets', (await userPresets()).filter((p) => p.id !== id)); }
export function encodePreset(stack) { return 'RWD1-' + btoa(unescape(encodeURIComponent(JSON.stringify(stack)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function decodePreset(code) {
  const s = String(code).trim().replace(/^RWD1-/, '').replace(/-/g, '+').replace(/_/g, '/');
  const j = JSON.parse(decodeURIComponent(escape(atob(s + '==='.slice((s.length + 3) % 4)))));
  if (!Array.isArray(j)) throw new Error('不是细节预设');
  return j.filter((x) => MODS[x.id]);
}

// ---------------- 学习参考地图 ----------------
// 统计参考图：每种地形上各物品的密度、边缘弯曲程度 → 生成一组修改器
export function learnFrom(refEd) {
  const m = refEd.map, eng = refEd.engine; if (!eng) throw new Error('参考地图没有地形标注，学不了');
  const W = m.width, H = m.height, I = m.items;
  const cnt = new Map(), tot = new Map();
  let edges = 0, cells = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = eng.tileTerrain(i); if (t === NONE) continue;
    const tn = eng.name(t); tot.set(tn, (tot.get(tn) || 0) + 1); cells++;
    if (x > 0 && eng.tileTerrain(i - 1) !== t) edges++;
    const g = I ? I.data[i] : 0;
    if (g && !(refEd.poolGids && refEd.poolGids.has(g))) {
      const it = refEd.items.find((q) => q.variants.includes(g));
      if (it && !it.stamp) { const k = tn + '|' + it.name; cnt.set(k, (cnt.get(k) || 0) + 1); }
    }
  }
  const rules = [];
  for (const [k, n] of cnt) { const [tn, iname] = k.split('|'); const pct = n / tot.get(tn) * 100; if (pct > 0.3) rules.push([tn, iname, +pct.toFixed(1)]); }
  const rough = Math.max(10, Math.min(90, Math.round(edges / Math.max(1, cells) * 900)));
  return [S('roughen', { strength: rough }), { id: 'scatter', on: true, p: { density: 40, cluster: 60, rules } }];
}
