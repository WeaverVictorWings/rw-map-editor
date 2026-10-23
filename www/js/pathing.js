// 通行与平衡分析（近似：根据图块属性推算，最终以游戏为准）
import { Grow } from './util.js';

export const LAND = 1, NAVAL = 2, HOVER = 4, BUILD = 8;

// 每格的通行类别（位标志）
export function passability(ed) {
  const m = ed.map, W = m.width, H = m.height;
  const out = new Uint8Array(W * H);
  const cache = new Map();
  const classOf = (gid) => {
    if (cache.has(gid)) return cache.get(gid);
    const info = m.tileInfo(gid);
    const p = info ? info.props : {};
    let c = LAND | HOVER | BUILD;
    if ('water' in p) c = NAVAL | HOVER;
    if ('water-bridge' in p) c = LAND | NAVAL | HOVER;
    if ('lava' in p) c = 0;
    if ('large-cliff' in p || 'cliff-soft' in p || 'lava-cliff' in p || 'cliff' in p || 'block-land' in p) c = c & ~(LAND | BUILD);
    if ('large-cliff' in p || 'lava-cliff' in p) c = 0;
    cache.set(gid, c);
    return c;
  };
  const itemCache = new Map();
  const itemMask = (gid) => {
    if (itemCache.has(gid)) return itemCache.get(gid);
    const info = m.tileInfo(gid);
    const p = info ? info.props : {};
    let mask = 0xff;
    if ('large-rock' in p) mask = ~(LAND | HOVER | BUILD);
    else if (p.unit) mask = ~(LAND | BUILD);        // 树之类的障碍
    else if ('res_pool' in p) mask = ~BUILD;
    itemCache.set(gid, mask);
    return mask;
  };
  const G = m.ground, I = m.items;
  for (let i = 0; i < W * H; i++) {
    let c = G ? classOf(G.data[i]) : (LAND | HOVER | BUILD);
    if (I && I.data[i]) c &= itemMask(I.data[i]);
    out[i] = c;
  }
  return out;
}

// 从若干起点出发的步行距离（4 邻接，按格计）
function bfs(pass, W, H, mask, sources, maxD = 1e9) {
  const dist = new Int32Array(W * H).fill(-1);
  let cur = new Grow(1024), nxt = new Grow(1024);
  for (const s of sources) if (s >= 0 && s < W * H) { dist[s] = 0; cur.push(s); }
  let d = 0;
  while (cur.n && d < maxD) {
    d++;
    nxt.n = 0;
    for (let k = 0; k < cur.n; k++) {
      const i = cur.a[k], x = i % W;
      if (x > 0) { const u = i - 1; if (dist[u] < 0 && (pass[u] & mask)) { dist[u] = d; nxt.push(u); } }
      if (x < W - 1) { const u = i + 1; if (dist[u] < 0 && (pass[u] & mask)) { dist[u] = d; nxt.push(u); } }
      if (i >= W) { const u = i - W; if (dist[u] < 0 && (pass[u] & mask)) { dist[u] = d; nxt.push(u); } }
      if (i < W * H - W) { const u = i + W; if (dist[u] < 0 && (pass[u] & mask)) { dist[u] = d; nxt.push(u); } }
    }
    [cur, nxt] = [nxt, cur];
  }
  return dist;
}

// 起点附近找一个能走的格子（指挥中心本身可能压在不可通行格上）
function nearestPassable(pass, W, H, x, y, mask) {
  for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const X = x + dx, Y = y + dy;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    if (pass[Y * W + X] & mask) return Y * W + X;
  }
  return -1;
}

// 平衡报告：每队步行范围内的资源池、最近资源池、地盘大小、能否走到敌人
export function balanceReport(ed, radius = 30) {
  const m = ed.map, W = m.width, H = m.height;
  const pass = passability(ed);
  const spawns = ed.spawns().filter((s) => s.team >= 0).sort((a, b) => a.team - b.team);
  const pools = ed.poolTiles();
  const starts = spawns.map((s) => nearestPassable(pass, W, H, Math.floor(s.cx / 20), Math.floor(s.cy / 20), LAND | HOVER));
  const rows = [];
  const perTeam = spawns.length <= 24;
  const poolIdx = pools.map(([x, y]) => nearestPassable(pass, W, H, x, y, LAND | HOVER));
  const poolDist = [];   // 每队到每个资源池的距离（只保留需要的数，不留整张距离图）
  const spawnDist = [];
  if (perTeam) {
    spawns.forEach((s, k) => {
      const d = bfs(pass, W, H, LAND, [starts[k]]);
      poolDist.push(poolIdx.map((p) => (p >= 0 ? d[p] : -1)));
      spawnDist.push(starts.map((q) => (q >= 0 ? d[q] : -1)));
      const pd = poolDist[k].filter((v) => v >= 0).sort((a, b) => a - b);
      const reach = spawns.filter((q, j) => j !== k && starts[j] >= 0 && d[starts[j]] >= 0).length;
      rows.push({ team: s.team, near: pd.filter((v) => v <= radius).length, nearest: pd.length ? pd[0] : null, second: pd.length > 1 ? pd[1] : null, reachEnemies: reach, island: reach === 0 && spawns.length > 1, x: s.cx, y: s.cy });
    });
  }
  // 地盘：所有出生点同时出发，每格归最近的队伍
  const owner = new Int16Array(W * H).fill(-1);
  {
    const dist = new Int32Array(W * H).fill(-1);
    let cur = new Grow(1024), nxt = new Grow(1024);
    starts.forEach((s, k) => { if (s >= 0 && dist[s] < 0) { dist[s] = 0; owner[s] = k; cur.push(s); } });
    while (cur.n) {
      nxt.n = 0;
      for (let q = 0; q < cur.n; q++) {
        const i = cur.a[q], x = i % W, o = owner[i];
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * H - W ? i + W : -1];
        for (const u of nb) if (u >= 0 && dist[u] < 0 && (pass[u] & (LAND | HOVER))) { dist[u] = dist[i] + 1; owner[u] = o; nxt.push(u); }
      }
      [cur, nxt] = [nxt, cur];
    }
  }
  const area = new Array(spawns.length).fill(0);
  for (let i = 0; i < W * H; i++) if (owner[i] >= 0 && (pass[i] & BUILD)) area[owner[i]]++;
  const poolOwner = new Array(spawns.length).fill(0);
  for (const p of poolIdx) if (p >= 0 && owner[p] >= 0) poolOwner[owner[p]]++;
  if (!perTeam) spawns.forEach((s, k) => rows.push({ team: s.team, near: null, nearest: null, x: s.cx, y: s.cy }));
  rows.forEach((r, k) => { r.area = area[k]; r.poolsOwned = poolOwner[k]; });
  // 公共资源池：到最近两队的距离差
  const contested = [];
  if (perTeam && spawns.length >= 2) {
    pools.forEach(([x, y], j) => {
      const p = poolIdx[j]; if (p < 0) return;
      const ds = poolDist.map((row) => row[j]).filter((v) => v >= 0).sort((a, b) => a - b);
      if (ds.length >= 2 && ds[1] - ds[0] <= Math.max(3, ds[0] * 0.15)) contested.push({ x, y, d1: ds[0], d2: ds[1] });
    });
  }
  // 出生点两两距离（最多 12 队）
  let matrix = null;
  if (perTeam && spawns.length <= 12) matrix = spawns.map((s, a) => spawns.map((q, b) => (a === b ? 0 : spawnDist[a][b])));
  // 评价：资源最多和最少的差距
  const fair = rows.length ? summarize(rows) : null;
  return { rows, contested, matrix, owner, pass, fair, teams: spawns.map((s) => s.team) };
}

function summarize(rows) {
  const vals = rows.filter((r) => r.nearest !== null && r.nearest !== undefined);
  if (!vals.length) return null;
  const nearest = vals.map((r) => r.nearest), near = vals.map((r) => r.near), area = rows.map((r) => r.area);
  const spread = (a) => (Math.max(...a) - Math.min(...a));
  return {
    nearestSpread: spread(nearest), nearSpread: spread(near),
    areaRatio: Math.min(...area) > 0 ? Math.max(...area) / Math.min(...area) : null,
  };
}

// 通行图叠加颜色（RGBA 打包成 uint32，小端 ABGR）
export function overlayColor(kind, c, cb = false) {
  // cb：色盲友好配色（红→橙、绿→蓝、黄→天蓝）
  const rgba0 = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const rgba = cb ? (r, g, b, a) => (r > 200 && g < 80 ? rgba0(230, 159, 0, a) : g > 150 && r < 120 ? rgba0(0, 114, 178, a) : r > 200 && g > 180 ? rgba0(86, 180, 233, a) : rgba0(r, g, b, a)) : rgba0;
  if (kind === 'land') return c & LAND ? (c & BUILD ? 0 : rgba(255, 210, 0, 90)) : rgba(230, 40, 40, 150);
  if (kind === 'naval') return c & NAVAL ? rgba(40, 140, 255, 130) : rgba(0, 0, 0, 110);
  if (kind === 'hover') return c & HOVER ? 0 : rgba(230, 40, 40, 150);
  if (kind === 'build') return c & BUILD ? rgba(60, 200, 90, 90) : rgba(230, 40, 40, 120);
  return 0;
}
