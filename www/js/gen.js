// 随机地形生成：预设 + 种子 + 对称；与图片转地图共用清理和布点
import { majority, mergeSmall, removeThin, applyCells, chooseSpawns, connectSpawns, placePoolsAround } from './terraform.js';
import { NONE } from './terrain.js';

export const PRESETS = {
  continent: { cn: '大陆对战', water: 0.25, mount: 0.08, forest: 0.12, desc: '一整块大陆，四周是海，适合陆军为主的对战' },
  islands: { cn: '群岛海战', water: 0.6, mount: 0.04, forest: 0.1, desc: '许多岛屿，海军和空军更重要' },
  sea: { cn: '内海', water: 0.35, mount: 0.06, forest: 0.12, desc: '中央一片内海，陆地环绕四周' },
  river: { cn: '河谷', water: 0.18, mount: 0.1, forest: 0.14, desc: '一条大河穿过地图，几处浅滩是争夺点' },
  plateau: { cn: '高原要塞', water: 0.1, mount: 0.2, forest: 0.08, desc: '悬崖围出的高地，有缺口可以进出' },
};
export const STYLES = {
  temperate: { cn: '温带', land: ['Grass'], dry: ['Dirt'], beach: ['Sand'], forest: ['Tree'], mount: ['Dirt Cliff', 'Cliff'], water: ['Shallow Water', 'Water'], deep: ['Water', 'Deep Water'], ford: ['Water Bridge'] },
  snow: { cn: '雪原', land: ['Snow'], dry: ['Ice', 'Dirt'], beach: ['Dirt', 'Snow'], forest: ['Frozen Trees', 'Tree'], mount: ['Dirt Cliff', 'Cliff'], water: ['Shallow Water', 'Water'], deep: ['Water', 'Deep Water'], ford: ['Water Bridge'] },
  desert: { cn: '沙漠', land: ['Sand'], dry: ['Dune', 'Dirt'], beach: ['Sand'], forest: ['Stone', 'Dirt'], mount: ['Dirt Cliff', 'Cliff'], water: ['Shallow Water', 'Water'], deep: ['Water', 'Deep Water'], ford: ['Water Bridge'] },
  volcanic: { cn: '火山', land: ['Dirt'], dry: ['Stone', 'Sand'], beach: ['Dirt'], forest: ['Stone', 'Dirt'], mount: ['Dirt Cliff', 'Cliff'], water: ['Lava', 'Shallow Water'], deep: ['Lava'], ford: ['Dirt'] },
};

// ---- 分享码 ----
export function encodeShare(p) {
  const json = JSON.stringify(p);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'RWG1-' + b64;
}
export function decodeShare(code) {
  const m = /^RWG1-([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) throw new Error('分享码格式不对（应以 RWG1- 开头）');
  let s = m[1].replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---- 噪声 ----
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, oct = 5) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { s += amp * vnoise(x * f, y * f, seed + o * 101); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}

function pickTerrain(eng, list) {
  for (const n of list) { const t = eng.index(n); if (t >= 0 && eng.paintable.includes(t)) return t; }
  return -1;
}

// 生成每格地形（还没写进地图）
export function generateCells(ed, p) {
  const eng = ed.engine;
  const W = ed.map.width, H = ed.map.height;
  const pre = PRESETS[p.preset] || PRESETS.continent;
  const st = STYLES[p.style] || STYLES.temperate;
  const T = {};
  for (const k of ['land', 'dry', 'beach', 'forest', 'mount', 'water', 'deep', 'ford']) T[k] = pickTerrain(eng, st[k]);
  if (T.land < 0) T.land = eng.paintable[0];
  for (const k of Object.keys(T)) if (T[k] < 0) T[k] = T.land;
  const waterShare = p.water ?? pre.water, mountShare = p.mount ?? pre.mount, forestShare = p.forest ?? pre.forest;
  const seed = (p.seed >>> 0) || 1;
  const scale = 4 / Math.max(64, Math.min(W, H)) * (p.preset === 'islands' ? 2.2 : 1);
  const fold = (x, y) => {
    const s = p.sym;
    if (s === 'lr') return [Math.min(x, W - 1 - x), y];
    if (s === 'tb') return [x, Math.min(y, H - 1 - y)];
    if (s === 'rot') return x >= W / 2 ? [W - 1 - x, H - 1 - y] : [x, y];
    if (s === 'quad') return [Math.min(x, W - 1 - x), Math.min(y, H - 1 - y)];
    return [x, y];
  };
  const n = W * H;
  const hgt = new Float32Array(n), moist = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [fx, fy] = fold(x, y);
    const wx = fx + 18 * (fbm(fx * scale * 0.7, fy * scale * 0.7, seed + 7, 3) - 0.5) / scale * 0.05;
    const wy = fy + 18 * (fbm(fx * scale * 0.7 + 50, fy * scale * 0.7, seed + 9, 3) - 0.5) / scale * 0.05;
    let h = fbm(wx * scale, wy * scale, seed);
    const nx = (x + 0.5) / W * 2 - 1, ny = (y + 0.5) / H * 2 - 1;
    const r = Math.sqrt(nx * nx + ny * ny);
    if (p.preset === 'continent') h += 0.35 * (1 - Math.min(1, r * 1.05)) - 0.12;
    else if (p.preset === 'sea') h += 0.45 * Math.min(1, r) - 0.15;
    else if (p.preset === 'plateau') h = Math.pow(h, 0.8);
    else if (p.preset === 'river') {
      const t = (p.sym === 'tb' || p.sym === 'quad') ? nx : ny;
      const along = (p.sym === 'tb' || p.sym === 'quad') ? ny : nx;
      const curve = 0.25 * Math.sin(along * 2.4 + seed % 7) * (p.sym === 'none' ? 1 : 0);
      const dr = Math.abs(t - curve);
      h = h * 0.7 + 0.3 + (dr < 0.07 ? -0.6 * (1 - dr / 0.07) : 0);
    }
    hgt[y * W + x] = h;
    moist[y * W + x] = fbm(fx * scale * 1.7 + 300, fy * scale * 1.7, seed + 33, 4);
  }
  const q = (arr, share) => { const s = Float32Array.from(arr).sort(); return s[Math.min(n - 1, Math.max(0, Math.floor(share * n)))]; };
  const wTh = q(hgt, waterShare), mTh = q(hgt, 1 - mountShare);
  const cells = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const h = hgt[i], mo = moist[i];
    if (h < wTh) cells[i] = T.water;
    else if (h > mTh) cells[i] = T.mount;
    else if (h < wTh + 0.015) cells[i] = T.beach;
    else cells[i] = T.land;
  }
  // 森林和干地按湿度挑
  const landIdx = [];
  for (let i = 0; i < n; i++) if (cells[i] === T.land) landIdx.push(i);
  const mvals = Float32Array.from(landIdx, (i) => moist[i]).sort();
  const fTh = mvals[Math.floor(Math.max(0, 1 - forestShare / Math.max(0.01, landIdx.length / n)) * (mvals.length - 1))] ?? 2;
  const dTh = mvals[Math.floor(0.12 * (mvals.length - 1))] ?? -1;
  for (const i of landIdx) { if (moist[i] > fTh) cells[i] = T.forest; else if (moist[i] < dTh) cells[i] = T.dry; }
  // 深水
  if (T.deep !== T.water) {
    const dist = new Int32Array(n).fill(-1), qq = [];
    for (let i = 0; i < n; i++) if (cells[i] !== T.water) { dist[i] = 0; qq.push(i); }
    for (let k = 0; k < qq.length; k++) { const i = qq[k], x = i % W; for (const u of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < n - W ? i + W : -1]) if (u >= 0 && dist[u] < 0) { dist[u] = dist[i] + 1; qq.push(u); } }
    for (let i = 0; i < n; i++) if (cells[i] === T.water && dist[i] > 8) cells[i] = T.deep;
  }
  // 河谷：每隔一段放一处浅滩
  if (p.preset === 'river' && T.ford !== T.water) {
    const fords = 3;
    for (let f = 0; f < fords; f++) {
      const cx = Math.floor((f + 0.5) / fords * W);
      for (let y = 0; y < H; y++) for (let x = cx - 2; x <= cx + 2; x++) {
        if (x < 0 || x >= W) continue;
        const i = y * W + x;
        if (cells[i] === T.water || cells[i] === T.deep) cells[i] = T.ford;
      }
    }
  }
  // 清理
  const minArea = Math.max(6, Math.round(n / 4000));
  majority(cells, W, H, 1);
  mergeSmall(cells, W, H, () => minArea);
  removeThin(cells, W, H, 2);
  // 对称修正：清理可能打破对称，按折叠重新取值
  if (p.sym && p.sym !== 'none') {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [fx, fy] = fold(x, y);
      if (fx !== x || fy !== y) cells[y * W + x] = cells[fy * W + fx];
    }
  }
  return { cells, T };
}

// 完整生成：地形 + 出生点 + 资源池 + 保证互通
export function generateMap(ed, p) {
  const { cells, T } = generateCells(ed, p);
  const op = ed.begin('随机生成');
  op.snapV(); op.snapLayer(ed.engine.layer);
  if (ed.map.items) op.snapLayer(ed.map.items);
  applyCells(ed, cells, op);
  const spawns = chooseSpawns(ed, p.players || 2, p.sym || 'none', p.seed || 1);
  const G = ed.unitsGroup();
  op.snapshotGroup(G);
  G.objects = G.objects.filter((o) => !o.props.some((q) => q.name === 'unit' && (q.value === 'commandCenter' || q.value === 'builder')));
  spawns.forEach(([x, y], k) => ed.spawnAtCenter(G, x * 20 + 10, y * 20 + 10, k));
  let carved = 0;
  if (p.preset !== 'islands') carved = connectSpawns(ed, op);
  // 生成前先把旧资源池清掉：它们在新地形上可能已经在悬崖/水里，留着会让“能不能玩吗”立刻报红
  clearOldPools(ed, op);
  const pools = placePoolsAround(ed, op, spawns, p.pools ?? 2, p.center ?? 2, p.sym);
  op.markAll();
  ed.commit();
  return { spawns: spawns.length, pools, carved, T };
}

// 清掉地图上所有已有资源池（随机生成是“整张图重来”，旧池不该留）
function clearOldPools(ed, op) {
  const m = ed.map, L = m.layer('Items');
  if (!L) return 0;
  const gids = ed.poolGids instanceof Set ? ed.poolGids : new Set(Array.isArray(ed.poolGids) ? ed.poolGids : []);
  const W = m.width, H = m.height;
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    const g = L.data[i];
    if (!g) continue;
    const info = m.tileInfo(g);
    if ((info && info.props && 'res_pool' in info.props) || gids.has(g)) {
      ed.setTile(L, i % W, (i / W) | 0, 0);
      n++;
    }
  }
  return n;
}
