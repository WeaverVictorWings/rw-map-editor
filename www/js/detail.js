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

// 地形名字 → 引擎编号（找不到就 -1）
function T(ctx, ...names) { for (const n of names) { const t = ctx.eng.index(n); if (t >= 0 && ctx.eng.paintable.includes(t)) return t; } return -1; }
function itemByName(name) { return ed.items.find((i) => i.name === name) || null; }

// 工作副本
export function makeWork(opts = {}) {
  const m = ed.map, eng = ed.engine, W = m.width, H = m.height;
  const w = { W, H, W1: W + 1, V: eng.V.slice(), I: m.items ? Uint32Array.from(m.items.data) : new Uint32Array(W * H), prot: new Uint8Array(W * H), area: null };
  // 保护：出生点周围、资源池周围（可关）
  if (opts.protect !== false) {
    const mark = (cx, cy, r) => { for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) w.prot[y * W + x] = 1; };
    for (const s of ed.spawns()) mark(Math.floor(s.cx / 20), Math.floor(s.cy / 20), 7);
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
  const N = w.W * w.H, d = new Int16Array(N).fill(-1), q = new Grow(4096);
  for (let i = 0; i < N; i++) if (pred(terrainOfTile(w, i))) { d[i] = 0; q.push(i); }
  let h = 0;
  while (h < q.n) {
    const i = q.a[h++]; if (d[i] >= maxD) continue;
    const x = i % w.W;
    for (const j of [x > 0 ? i - 1 : -1, x < w.W - 1 ? i + 1 : -1, i - w.W, i + w.W]) if (j >= 0 && j < N && d[j] < 0) { d[j] = d[i] + 1; q.push(j); }
  }
  return d;
}

// ---------------- 修改器 ----------------
// 每个：{cn, desc, params:[[key, 中文, min, max, step, 默认]], run(w, p, ctx)}
const isWater = (ctx, t) => t !== NONE && /water|lake/i.test(ctx.eng.name(t)) && !/bridge/i.test(ctx.eng.name(t));
const isLand = (ctx, t) => t !== NONE && !isWater(ctx, t) && !/lava|cliff|tree/i.test(ctx.eng.name(t));

export const MODS = {
  roughen: { cn: '边缘自然化', desc: '把笔直的地形边缘变得弯弯曲曲，像自然形成的一样', params: [['strength', '强度', 0, 100, 5, 50], ['scale', '弯曲大小', 2, 40, 1, 10]],
    run(w, p, ctx) {
      const { W1, H } = w, Wv = w.W, V = w.V, out = V.slice(), s = ctx.seed, sc = p.scale * ctx.k;
      const thr = 1 - p.strength / 100 * 0.9;
      for (let y = 1; y < H; y++) for (let x = 1; x < Wv; x++) {
        const v = y * W1 + x, t = V[v];
        const nb = [V[v - 1], V[v + 1], V[v - W1], V[v + W1]];
        if (nb.every((u) => u === t) || !vEditable(w, x, y)) continue;
        const n = fbm(x / sc, y / sc, s);
        if (n < thr) continue;
        const ang = fbm(x / sc + 31, y / sc + 17, s + 7) * Math.PI * 4;
        const dx = Math.round(Math.cos(ang) * 2), dy = Math.round(Math.sin(ang) * 2);
        const X = Math.min(Wv, Math.max(0, x + dx)), Y = Math.min(H, Math.max(0, y + dy));
        out[v] = V[Y * W1 + X];
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
  scatter: { cn: '自然点缀', desc: '按地形撒树、草丛、碎石、仙人掌，成团分布更自然', params: [['density', '密度', 0, 100, 5, 40], ['cluster', '成团程度', 0, 100, 5, 60]],
    rules: [['Grass', 'Trees', 7], ['Grass', 'Grass', 5], ['Dirt', 'Stone', 4], ['Dirt', 'Holes', 1], ['Sand', 'Cacti', 3], ['Sand', 'Stone', 2], ['Dune', 'Cacti', 2], ['Snow', 'Stone', 2], ['Swamp', 'Mud', 6], ['Stone', 'Stone', 5]],
    run(w, p, ctx) { scatterRules(w, (p.rules || this.rules), p.density / 40, p.cluster / 100, ctx); } },
  water: { cn: '水域细节', desc: '岸边加浅水带，深海里点缀小岛，远离岸边的水变深', params: [['shore', '浅水带宽（格）', 0, 8, 1, 3], ['islands', '小岛数量', 0, 40, 1, 6]],
    run(w, p, ctx) {
      const sh = T(ctx, 'Shallow Water'), deep = T(ctx, 'Deep Water', 'Water'), sand = T(ctx, 'Sand'), grass = T(ctx, 'Grass');
      if (sh < 0) return;
      const dl = distTo(w, (t) => !isWater(ctx, t), 24);
      const { W1, H } = w, Wv = w.W;
      for (let y = 0; y < H; y++) for (let x = 0; x < Wv; x++) {
        const i = y * Wv + x; if (!isWater(ctx, terrainOfTile(w, i)) || !editable(w, x, y)) continue;
        const d = dl[i];
        const t = d >= 0 && d <= p.shore * ctx.k ? sh : deep >= 0 && (d < 0 || d > p.shore * ctx.k + 3) ? deep : -1;
        if (t >= 0) w.V[y * W1 + x] = t;
      }
      const r = rng(ctx.seed + 5);
      for (let n = 0; n < p.islands; n++) {
        for (let tries = 0; tries < 30; tries++) {
          const x = Math.floor(r() * Wv), y = Math.floor(r() * H), i = y * Wv + x;
          if (dl[i] < 8 * ctx.k || !editable(w, x, y)) continue;
          const R = (2 + r() * 4) * ctx.k;
          blob(w, x, y, R * 1.6, sh, ctx.seed + n); blob(w, x, y, R, sand, ctx.seed + n); blob(w, x, y, R * 0.55, grass, ctx.seed + n);
          break;
        }
      }
    } },
  erode: { cn: '海岸侵蚀', desc: '海岸被水冲出小海湾和沙嘴', params: [['strength', '强度', 0, 100, 5, 40]],
    run(w, p, ctx) {
      const sh = T(ctx, 'Shallow Water', 'Water'); if (sh < 0) return;
      const { W1, H } = w, Wv = w.W, V = w.V, out = V.slice();
      for (let y = 1; y < H; y++) for (let x = 1; x < Wv; x++) {
        const v = y * W1 + x; if (!isLand(ctx, V[v]) || !vEditable(w, x, y)) continue;
        const nearW = [V[v - 1], V[v + 1], V[v - W1], V[v + W1]].some((u) => isWater(ctx, u));
        if (nearW && fbm(x / (6 * ctx.k), y / (6 * ctx.k), ctx.seed + 3) > 1 - p.strength / 160) out[v] = sh;
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
  swamp: { cn: '沼泽化', desc: '水边低地变成沼泽，夹着小水洼', params: [['amount', '范围', 0, 100, 5, 40]],
    run(w, p, ctx) {
      const sw = T(ctx, 'Swamp'), sh = T(ctx, 'Shallow Water'); if (sw < 0) return;
      const dw = distTo(w, (t) => isWater(ctx, t), 20);
      const { W1, H } = w, Wv = w.W;
      for (let y = 0; y < H; y++) for (let x = 0; x < Wv; x++) {
        const i = y * Wv + x; if (!isLand(ctx, terrainOfTile(w, i)) || !editable(w, x, y)) continue;
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
    run(w, p) { const keep = ed.poolGids || new Set(); for (let i = 0; i < w.I.length; i++) if (w.I[i] && !keep.has(w.I[i]) && (!w.area || w.area[i]) && hash(i, 7, 3) < p.amount / 100) w.I[i] = 0; } },
  rules: { cn: '自定义规则', desc: '自己写“在什么地形、离什么多远、放什么、概率多少”', params: [['density', '整体密度', 0, 200, 5, 100]], custom: true,
    run(w, p, ctx) { runRules(w, p.list || [], p.density / 100, ctx); } },
  biome: { cn: '按群系填充', desc: '把用群系笔刷画好的区域，换成对应的地形组合和装饰', params: [['detail', '细节程度', 0, 100, 5, 60]],
    run(w, p, ctx) { applyBiomes(w, p.detail / 100, ctx); } },
};

function heightLadder(ctx) {
  return ['Deep Water', 'Water', 'Shallow Water', 'Sand', 'Grass', 'Dirt', 'Dirt Cliff'].map((n) => T(ctx, n)).filter((t, i, a) => t >= 0 && a.indexOf(t) === i);
}
function blob(w, cx, cy, R, t, seed, noise = 0.45) {
  if (t < 0) return;
  const { W1, H } = w, Wv = w.W, r = Math.ceil(R * 1.4);
  for (let y = Math.max(0, cy - r); y <= Math.min(H, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(Wv, cx + r); x++) {
    const d = Math.hypot(x - cx, y - cy) / R + (vnoise(x / 3, y / 3, seed) - 0.5) * noise;
    if (d <= 1 && vEditable(w, x, y)) w.V[y * W1 + x] = t;
  }
}
// 在离出生点远、地形合适的地方放 n 个团块
function placeBlobs(w, ctx, n, make, r, okTerrain) {
  const sp = ed.spawns().map((s) => [s.cx / 20 * ctx.k, s.cy / 20 * ctx.k]);
  const placed = [];
  for (let k = 0; k < n; k++) {
    const [R, draw] = make();
    for (let tries = 0; tries < 60; tries++) {
      const x = Math.floor(r() * w.W), y = Math.floor(r() * w.H);
      if (!okTerrain(tileT(w, x, y)) || !editable(w, x, y)) continue;
      if (sp.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < R + 12 * ctx.k)) continue;
      if (placed.some(([px, py, pr]) => Math.hypot(px - x, py - y) < pr + R + 4)) continue;
      draw(x, y); placed.push([x, y, R]); break;
    }
  }
}
// 撒物品：rules [[地形名, 物品名, 百分比]]
function scatterRules(w, rules, mul, cluster, ctx) {
  const comp = rules.map(([tn, iname, pct]) => [ctx.eng.index(tn), itemByName(iname), pct / 100 * mul]).filter(([t, it]) => t >= 0 && it && !it.stamp);
  if (!comp.length) return;
  const { W, H } = w;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (w.I[i] || !editable(w, x, y)) continue;
    const t = tileT(w, x, y);
    // 四个角都是同一种地形才放，避免放在过渡边上
    if (w.V[(y + 1) * w.W1 + x + 1] !== t) continue;
    const cl = cluster ? Math.pow(fbm(x / (5 * ctx.k), y / (5 * ctx.k), ctx.seed + 41), 1 + cluster * 3) * (1 + cluster * 3) : 1;
    let acc = hash(x, y, ctx.seed + 43);
    for (const [tt, it, pr] of comp) {
      if (tt !== t) continue;
      const pp = pr * cl;
      if (acc < pp) { w.I[i] = it.variants[Math.floor(hash(y, x, ctx.seed) * it.variants.length)]; break; }
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
      else { w.V[y * w.W1 + x] = tt; w.V[y * w.W1 + x + 1] = tt; w.V[(y + 1) * w.W1 + x] = tt; w.V[(y + 1) * w.W1 + x + 1] = tt; }
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
  for (let y = 0; y <= H; y++) for (let x = 0; x <= Wv; x++) { const s = src(x, y, true); if (s) w.V[y * W1 + x] = w.V[s[1] * W1 + s[0]]; }
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
  return w;
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
  for (let i = 0; i < W * H; i++) if (I.data[i] !== w.I[i]) op.tile(I, i, I.data[i], I.flips.get(i) || 0, w.I[i], 0);
  // 装饰不能压在悬崖、水上
  for (let i = 0; i < W * H; i++) {
    const g = I.data[i]; if (!g || (ed.poolGids && ed.poolGids.has(g))) continue;
    const t = eng.tileTerrain(i);
    if (t === NONE || !/water|lake|lava|cliff|tree/i.test(eng.name(t)) || /bridge/i.test(eng.name(t))) continue;
    if (w.I[i] !== g) continue; // 只清理这次新放的
    const nm = (ed.items.find((it) => it.variants.includes(g)) || {}).name || '';
    if (/stone/i.test(nm) && /shallow/i.test(eng.name(t))) continue; // 浅水里的礁石保留
    op.tile(I, i, g, 0, 0, 0);
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
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) s.V[y * (W + 1) + x] = w.V[Math.min(w.H, Math.round(y / k)) * w.W1 + Math.min(w.W, Math.round(x / k))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = Math.min(w.H - 1, (y / k) | 0) * w.W + Math.min(w.W - 1, (x / k) | 0); s.I[y * W + x] = w.I[j]; s.prot[y * W + x] = w.prot[j]; if (s.area) s.area[y * W + x] = w.area[j]; }
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
  { id: 'grassland', cn: '自然草原', stack: [S('roughen', { strength: 45 }), S('noise', { amount: 25 }), S('scatter', { density: 35 })] },
  { id: 'forest', cn: '茂密森林', stack: [S('roughen'), S('forestPatch', { count: 10, size: 8 }), S('scatter', { density: 80, cluster: 75 })] },
  { id: 'desert', cn: '沙漠戈壁', stack: [S('theme', { theme: 2 }), S('roughen', { strength: 55 }), S('noise', { amount: 35 }), S('scatter', { density: 30 })] },
  { id: 'snow', cn: '雪原冰湖', stack: [S('theme', { theme: 1 }), S('roughen'), S('scatter', { density: 25 })] },
  { id: 'volcano', cn: '火山熔岩', stack: [S('theme', { theme: 3 }), S('lavaPools', { count: 4 }), S('highland', { count: 3 }), S('scatter', { density: 25 })] },
  { id: 'swamp', cn: '沼泽湿地', stack: [S('swamp', { amount: 55 }), S('roughen'), S('scatter', { density: 45 })] },
  { id: 'islands', cn: '热带群岛海岸', stack: [S('erode', { strength: 45 }), S('water', { shore: 3, islands: 10 }), S('reef'), S('scatter', { density: 40 })] },
  { id: 'warzone', cn: '战损焦土', stack: [S('warzone', { amount: 55 }), S('scatter', { density: 20 })] },
  { id: 'canyon', cn: '高原峡谷', stack: [S('highland', { count: 8, size: 14 }), S('roughen', { strength: 60 }), S('scatter', { density: 30 })] },
  { id: 'delta', cn: '河流三角洲', stack: [S('river', { width: 5, fords: 4, count: 2 }), S('swamp', { amount: 30 }), S('water', { shore: 2, islands: 4 }), S('scatter', { density: 35 })] },
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
