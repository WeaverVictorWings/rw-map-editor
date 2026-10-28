// 路径与航线标注：每队到最近资源池、到各敌方出生点的路线 + 交汇点（只读，不改地图）
// 导出：annotatePaths(ed, opts) / pathDialog()
import { A } from './state.js';
import { h, modal, toast, toggle } from './ui.js';
import { HELP } from './help.js';
import { passability, LAND, HOVER } from './pathing.js';
import { bfsFrom } from './bottleneck.js';
import { teamColor } from './render.js';

const ed = A.ed;
const TW = 20;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MASK_CN = { 1: '陆地', 3: '陆地 + 海军', 5: '陆地 + 悬浮', 7: '全地形' };

// 目标格自己不能走时，就近找一格能走的（环形一层层往外找，最多 24 格）
function nearestPassable(pass, W, H, x, y, mask) {
  x = Math.max(0, Math.min(W - 1, x | 0)); y = Math.max(0, Math.min(H - 1, y | 0));
  const i0 = y * W + x;
  if (pass[i0] & mask) return i0;
  for (let r = 1; r <= 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (pass[j] & mask) return j;
      }
    }
  }
  return -1;
}

// 从 bfsFrom 的距离图里一步步倒着走回起点，返回从起点到终点的格子序列
function walkBack(dist, W, start) {
  if (start < 0 || dist[start] < 0) return [];
  const H = (dist.length / W) | 0;
  const out = [start];
  let cur = start, guard = 0;
  while (dist[cur] > 0 && guard++ < 1e6) {
    const x = cur % W, y = (cur / W) | 0, d = dist[cur];
    let nx = -1;
    for (const [dx, dy] of DIRS) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const j = Y * W + X;
      if (dist[j] === d - 1) { nx = j; break; }
    }
    if (nx < 0) break;
    out.push(nx); cur = nx;
  }
  return out.reverse().map((i) => [i % W, (i / W) | 0]);
}

// 出结果：{ W, H, mask, teams:[{team, spawn, pool, poolLen, enemies:[{team,len,path}], maxEnemyLen}], routes, crossings }
// 约定：len 是“要走几格”（BFS 距离），path 含首格，所以 len === path.length - 1。
export function annotatePaths(ed2 = ed, opts = {}) {
  const m = ed2.map;
  if (!m) return null;
  const W = m.width, H = m.height;
  const mask = opts.mask || LAND;
  const snapMask = LAND | HOVER;   // 出生点/资源池本身不能走时，就近吸附到能站的地方（和 balanceReport 一致）
  const pass = passability(ed2);
  // 每队只取第一个出生点当起点
  const first = new Map();
  for (const s of ed2.spawns()) {
    if (s.team < 0) continue;
    if (!first.has(s.team)) first.set(s.team, s);
  }
  const teamList = [...first.keys()].sort((a, b) => a - b);
  const startOf = new Map();
  for (const t of teamList) {
    const s = first.get(t);
    startOf.set(t, nearestPassable(pass, W, H, Math.floor(s.cx / TW), Math.floor(s.cy / TW), snapMask));
  }
  const pools = ed2.poolTiles();
  const poolIdx = [];
  for (const [px, py] of pools) {
    const p = nearestPassable(pass, W, H, px, py, snapMask);
    if (p >= 0) poolIdx.push({ p, x: px, y: py });
  }
  const teams = [], routes = [];
  for (const t of teamList) {
    const st = startOf.get(t);
    const s = first.get(t);
    const rec = { team: t, spawn: [Math.floor(s.cx / TW), Math.floor(s.cy / TW)], reachable: st >= 0, pool: [], poolLen: null, poolTile: null, enemies: [], maxEnemyLen: null };
    if (st >= 0) {
      const dist = bfsFrom(pass, W, H, [st], mask);
      let best = null;
      for (const q of poolIdx) {
        if (dist[q.p] < 0) continue;
        if (!best || dist[q.p] < best.d) best = { d: dist[q.p], p: q.p, x: q.x, y: q.y };
      }
      if (best) {
        rec.poolLen = best.d;
        rec.poolTile = [best.x, best.y];
        rec.pool = walkBack(dist, W, best.p);
        routes.push({ kind: 'pool', team: t, path: rec.pool, len: best.d });
      }
      for (const q of teamList) {
        if (q === t) continue;
        const s2 = startOf.get(q);
        if (s2 < 0 || dist[s2] < 0) continue;
        const path = walkBack(dist, W, s2);
        rec.enemies.push({ team: q, len: dist[s2], path });
        routes.push({ kind: 'enemy', team: t, toTeam: q, path, len: dist[s2] });
      }
      if (rec.enemies.length) rec.maxEnemyLen = Math.max(...rec.enemies.map((e) => e.len));
    }
    teams.push(rec);
  }
  // 交汇点：被两支以上队伍路线共用的格子
  const use = new Map();
  for (const r of routes) {
    for (const [x, y] of r.path) {
      const k = y * W + x;
      let set = use.get(k);
      if (!set) { set = new Set(); use.set(k, set); }
      set.add(r.team);
    }
  }
  const crossings = [];
  for (const [k, set] of use) {
    if (set.size < 2) continue;
    crossings.push({ x: k % W, y: (k / W) | 0, teams: [...set].sort((a, b) => a - b) });
  }
  crossings.sort((a, b) => b.teams.length - a.teams.length || a.x - b.x || a.y - b.y);
  // 相邻的共用格连成一“段”，一段只画一个圈 + 格数，否则一排格子会画成一串糖葫芦
  const zones = cluster(crossings, W, H);
  return { W, H, mask, teams, routes, crossings: crossings.slice(0, 1200), crossTotal: crossings.length, zones: zones.slice(0, 60), zoneTotal: zones.length };
}

// 把相邻（4 邻接）的共用格连成一段，返回 [{x, y, n, teams}]：x/y 是这段的重心格，n 是格数
function cluster(cells, W, H) {
  const at = new Map(cells.map((c) => [c.y * W + c.x, c]));
  const seen = new Set(), out = [];
  for (const c of cells) {
    const k0 = c.y * W + c.x;
    if (seen.has(k0)) continue;
    const q = [k0], group = [];
    seen.add(k0);
    while (q.length) {
      const k = q.pop();
      const g = at.get(k);
      group.push(g);
      const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of DIRS) {
        const X = x + dx, Y = y + dy, j = Y * W + X;
        if (X < 0 || Y < 0 || X >= W || Y >= H || seen.has(j) || !at.has(j)) continue;
        seen.add(j); q.push(j);
      }
    }
    const sx = group.reduce((a, g) => a + g.x, 0) / group.length;
    const sy = group.reduce((a, g) => a + g.y, 0) / group.length;
    const ts = new Set(); group.forEach((g) => g.teams.forEach((t) => ts.add(t)));
    out.push({ x: sx, y: sy, n: group.length, teams: [...ts].sort((a, b) => a - b) });
  }
  out.sort((a, b) => b.n - a.n || a.x - b.x || a.y - b.y);
  return out;
}

// ---------------- 地图上的线 ----------------
let layer = null;
let routesToDraw = [];
let crossToDraw = [];
let raf = 0;
let lastKey = '';

function ensureLayer() {
  const cv = document.getElementById('cv');
  if (!cv) return null;
  if (!layer || !layer.isConnected) {
    layer = document.createElement('canvas');
    layer.className = 'path-layer';
    layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4';
    (cv.parentElement || document.getElementById('stage')).append(layer);
  }
  return layer;
}

function paint() {
  if (!layer || !ed.map) return;
  const cv = document.getElementById('cv');
  const dpr = window.devicePixelRatio || 1;
  layer.width = cv.width; layer.height = cv.height;
  layer.style.width = cv.clientWidth + 'px'; layer.style.height = cv.clientHeight + 'px';
  const g = layer.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, layer.width, layer.height);
  const v = A.rend.view, s = v.z * dpr;
  g.setTransform(s, 0, 0, s, -v.ox * s, -v.oy * s);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const r of routesToDraw) {
    if (!r.path || r.path.length < 2) continue;
    g.strokeStyle = teamColor(r.team);
    g.globalAlpha = 0.9;
    g.lineWidth = (r.kind === 'pool' ? 2.4 : 1.8) / s;
    if (r.kind === 'pool') g.setLineDash([]); else g.setLineDash([7 / s, 5 / s]);
    g.beginPath();
    r.path.forEach(([x, y], i) => { const px = (x + 0.5) * TW, py = (y + 0.5) * TW; if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.stroke();
    g.setLineDash([]);
    // 终点画个小圈，一眼看出路线到哪
    const [ex, ey] = r.path[r.path.length - 1];
    g.beginPath();
    g.arc((ex + 0.5) * TW, (ey + 0.5) * TW, TW * 0.55, 0, Math.PI * 2);
    g.stroke();
  }
  // 交汇段：每段一个亮黄圈，圈里写这段有几格
  g.strokeStyle = '#ffd34d';
  g.lineWidth = 2.2 / s;
  for (const z of crossToDraw) {
    const px = (z.x + 0.5) * TW, py = (z.y + 0.5) * TW;
    g.globalAlpha = 0.16;
    g.fillStyle = '#ffd34d';
    g.beginPath();
    g.arc(px, py, (TW * 0.9) / 1, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(px, py, TW * 0.9, 0, Math.PI * 2);
    g.stroke();
    if (z.n > 1 && s > 1.1) {
      g.fillStyle = '#1a1d23';
      g.font = `${11 / s * 1.6}px system-ui,sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(z.n), px, py);
    }
  }
}

function startLoop() {
  stopLoop();
  lastKey = '';
  const tick = () => {
    const v = A.rend.view;
    const cv = document.getElementById('cv');
    const key = `${v.ox},${v.oy},${v.z},${cv ? cv.width : 0},${routesToDraw.length},${crossToDraw.length}`;
    if (key !== lastKey) { lastKey = key; paint(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function clearLayer() {
  stopLoop();
  if (layer) { layer.remove(); layer = null; }
  routesToDraw = [];
  crossToDraw = [];
}

// ---------------- 对话框 ----------------
// 弹窗默认居中会挡住地图；这两个工具的看点全在地图上，所以宽屏时把面板靠右停靠，左边留出地图
function dockRight(width) {
  if (!(window.innerWidth > 980)) return;
  const el = [...document.querySelectorAll('.modal')].pop();
  if (!el) return;
  el.style.placeItems = 'center end';
  el.style.paddingRight = '12px';
  // 亮点全在地图上，所以左边不压黑，只在面板一侧留一层薄暗
  el.style.background = 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 42%, rgba(0,0,0,.52) 62%, rgba(0,0,0,.62) 100%)';
  const box = el.querySelector('.box');
  if (box) box.style.width = `min(${width}px, 46vw)`;
}

export function pathDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const data = annotatePaths(ed);
  if (!data) { toast('先打开一张地图'); return; }
  if (!data.teams.length) { toast('地图上还没有出生点，先放几个出生点'); return; }
  const picked = new Set(data.teams.map((t) => t.team));
  let showPool = true, showEnemy = true, showCross = true;

  const sumLine = h('div', { style: 'font-size:12.5px;line-height:1.7' });
  const warn = h('div', { style: 'font-size:12px;color:#d29922;line-height:1.7;margin-top:4px' });
  const rows = h('div', { style: 'display:flex;flex-direction:column;gap:2px;margin-top:8px' });

  const fmt = (n) => (n === null || n === undefined ? '走不到' : `${n} 格`);

  const refresh = () => {
    routesToDraw = [];
    for (const r of data.routes) {
      if (!picked.has(r.team)) continue;
      if (r.kind === 'pool' && !showPool) continue;
      if (r.kind === 'enemy' && !showEnemy) continue;
      routesToDraw.push(r);
    }
    const live = new Set(routesToDraw.map((r) => r.team));
    crossToDraw = showCross ? (data.zones || []).filter((z) => z.teams.filter((t) => live.has(t)).length >= 2) : [];
    if (!routesToDraw.length) clearLayer(); else { ensureLayer(); startLoop(); paint(); }
    const zoneCells = crossToDraw.reduce((a, z) => a + z.n, 0);
    sumLine.textContent = `画了 ${routesToDraw.length} 条路线、${crossToDraw.length} 段交汇（黄圈里是格数，共 ${zoneCells} 格）。实线=到资源池，虚线=到敌方出生点，黄圈=多队会撞上的地方。`;
  };

  for (const t of data.teams) {
    const parts = [`到最近资源池 ${fmt(t.poolLen)}`];
    if (t.enemies.length) parts.push(t.enemies.map((e) => `到第 ${e.team + 1} 队 ${fmt(e.len)}`).join('，'));
    else parts.push('到敌方出生点：走不到');
    const sw = toggle(`第 ${t.team + 1} 队 · ${parts.join(' · ')}`, picked.has(t.team), (v) => {
      if (v) picked.add(t.team); else picked.delete(t.team);
      refresh();
    });
    const dot = h('span', { style: `display:inline-block;width:9px;height:9px;border-radius:50%;background:${teamColor(t.team)};margin-right:6px` });
    rows.append(h('div', { class: 'prow', style: 'display:flex;align-items:center' }, dot, sw));
    if (!t.reachable) warn.append(h('div', {}, `第 ${t.team + 1} 队的出生点周围没有能走的地（可能被水或悬崖围住了）。`));
  }

  const body = h('div', {},
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:6px' },
      `按 ${MASK_CN[data.mask] || '陆地'} 算的最短路（4 邻接，绕开不能走的地形）。出生点用每队的第一个，资源池用地图上现有的。`),
    sumLine, warn,
    h('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;margin-top:8px' },
      toggle('画到资源池的', showPool, (v) => { showPool = v; refresh(); }),
      toggle('画到敌方出生点的', showEnemy, (v) => { showEnemy = v; refresh(); }),
      toggle('标出交汇点', showCross, (v) => { showCross = v; refresh(); })),
    rows,
    h('div', { class: 'row', style: 'gap:8px;margin-top:10px' },
      h('button', { onclick: () => { for (const t of data.teams) picked.add(t.team); rows.querySelectorAll('input').forEach((el) => { el.checked = true; }); refresh(); } }, '全选'),
      h('button', { onclick: () => { picked.clear(); rows.querySelectorAll('input').forEach((el) => { el.checked = false; }); refresh(); } }, '全不选')),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-top:10px;line-height:1.7' },
      '这里的距离是“理论最短路”，没算建筑挡路和单位互相挤。要精确算卡点去看「瓶颈分析」。'),
  );

  refresh();
  const p = modal('路径 / 航线标注', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
  dockRight(430);
  return p.then((v) => { clearLayer(); return v; });
}

Object.assign(HELP, {
  'tool.pathannot': {
    t: '路径与航线标注',
    s: '每队去资源池、去打对面的路有多远，画在地图上',
    b: '按地图上能走的地形算最短路：<b>实线</b>是每队到最近资源池的路，<b>虚线</b>是到其他队伍出生点的路，<b>黄圈</b>是几条路线都会经过的格子——这些地方最容易打起来，也最适合放碉堡。队伍前面有小色点，和地图上的队伍颜色一致。',
    tips: ['只算地形，不算建筑挡路和堵车，所以实际走起来会更远。', '出生点用每队的第一个；资源池用地图上已经设好的。', '看到“走不到”说明出生点被水或悬崖围住了，先把地形改通。'],
  },
});
