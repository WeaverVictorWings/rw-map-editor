// 火力覆盖分析：炮塔射程 × 各队进攻路线，找出“完全没火力的偷袭路”
// 只读：只用 passability / rangedUnits / annotatePaths 的只读结果，不改地图
import { A } from './state.js';
import { h, modal, toast, toggle } from './ui.js';
import { HELP } from './help.js';
import { rangedUnits } from './measure.js';
import { annotatePaths } from './pathannot.js';
import { passability, LAND } from './pathing.js';
import { teamColor } from './render.js';

const ed = A.ed;
const TW = 20;
const MAX_DEAD = 40;      // 死角最多列这么多块
const MAX_CHOKE = 40;     // 卡点最多列这么多

// 4 邻接里能走的邻居数（判断“窄”不窄）
function openNeighbors(pass, W, H, x, y) {
  let n = 0;
  if (x > 0 && (pass[y * W + x - 1] & LAND)) n++;
  if (x < W - 1 && (pass[y * W + x + 1] & LAND)) n++;
  if (y > 0 && (pass[(y - 1) * W + x] & LAND)) n++;
  if (y < H - 1 && (pass[(y + 1) * W + x] & LAND)) n++;
  return n;
}

// 把一堆格子按 4 邻接聚成块：返回 [{x,y,cells,list}]（x,y 是块里最靠左上的一格）
function cluster(cells, W) {
  const seen = new Set(cells.map((c) => c.i));
  const out = [];
  for (const c of cells) {
    if (!seen.has(c.i)) continue;
    const stack = [c.i], block = [];
    seen.delete(c.i);
    while (stack.length) {
      const i = stack.pop();
      block.push(i);
      const x = i % W;
      for (const u of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (u >= 0 && seen.has(u)) { seen.delete(u); stack.push(u); }
      }
    }
    block.sort((a, b) => a - b);
    const first = block[0];
    out.push({ x: first % W, y: (first / W) | 0, cells: block.length, list: block });
  }
  return out.sort((a, b) => b.cells - a.cells);
}

// 主分析：返回
//   { turrets:[{x,y,range,team,unit}], covered:Uint8Array(0/1), coveragePct,
//     chokepoints:[{x,y,covered,teams}], deadZones:[{x,y,cells,teams}],
//     routes:[{team,toTeam,len,coveredLen,coverPct,path}], pass, W, H }
export function killzoneAnalysis(ed2 = ed, opts = {}) {
  const m = ed2 && ed2.map;
  if (!m) return null;
  const W = m.width, H = m.height, n = W * H;
  const pass = passability(ed2);

  // 1) 有射程的东西（炮塔、防空、指挥中心…），射程单位是格
  const turrets = rangedUnits()
    .filter((u) => u.r > 0)
    .map((u) => ({ x: Math.round(u.cx), y: Math.round(u.cy), range: u.r, team: u.team, unit: u.unit }));
  if (opts.minRange) {
    for (let k = turrets.length - 1; k >= 0; k--) if (turrets[k].range < opts.minRange) turrets.splice(k, 1);
  }

  // 2) 铺射程：每门炮把自己周围 range 格内的格子标上
  const count = new Int16Array(n);          // 被几门炮罩着
  const teamMask = new Uint32Array(n);      // 被哪些队伍罩着（位图）
  const bits = new Map();
  let bitN = 0;
  for (const t of turrets) if (!bits.has(t.team) && bitN < 31) bits.set(t.team, 1 << bitN++);
  const byTeam = new Map();                 // 每队一张覆盖图（算路线用）
  for (const t of turrets) {
    if (!byTeam.has(t.team)) byTeam.set(t.team, new Uint8Array(n));
    const own = byTeam.get(t.team);
    const r2 = t.range * t.range;
    const bit = bits.get(t.team) || 0;
    for (let y = Math.max(0, t.y - t.range); y <= Math.min(H - 1, t.y + t.range); y++) {
      const dy = y - t.y;
      for (let x = Math.max(0, t.x - t.range); x <= Math.min(W - 1, t.x + t.range); x++) {
        const dx = x - t.x;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * W + x;
        count[i]++; own[i] = 1; teamMask[i] |= bit;
      }
    }
  }
  const covered = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (count[i] > 0) covered[i] = 1;

  // 3) 各队的进攻路线：到每个敌方出生点
  const paths = annotatePaths(ed2, { mask: opts.mask || LAND });
  const allRoutes = paths ? paths.routes.filter((r) => r.kind === 'enemy') : [];
  const routes = allRoutes.map((r) => {
    const enemy = byTeam.get(r.toTeam) || null;   // 防守方的火力
    let coveredLen = 0;
    for (const [x, y] of r.path) if (enemy && enemy[y * W + x]) coveredLen++;
    const len = Math.max(1, r.len);
    return { team: r.team, toTeam: r.toTeam, len: r.len, coveredLen, coverPct: coveredLen / len, path: r.path };
  });

  // 4) 覆盖率（按陆地格算）
  let land = 0, landCovered = 0;
  for (let i = 0; i < n; i++) {
    if (!(pass[i] & LAND)) continue;
    land++;
    if (covered[i]) landCovered++;
  }
  const coveragePct = land ? (landCovered / land) * 100 : 0;

  // 5) 死角：落在路线上的格子、但一门炮都罩不到 → 偷袭路
  const onRoute = new Uint8Array(n);
  for (const r of allRoutes) for (const [x, y] of r.path) onRoute[y * W + x] = 1;
  const deadCells = [];
  for (let i = 0; i < n; i++) if (onRoute[i] && !covered[i] && (pass[i] & LAND)) deadCells.push({ i });
  const deadZones = cluster(deadCells, W).slice(0, MAX_DEAD).map((z) => {
    const teams = new Set();
    for (const r of allRoutes) for (const [x, y] of r.path) if (z.list.includes(y * W + x)) teams.add(r.team);
    return { x: z.x, y: z.y, cells: z.cells, teams: [...teams].sort((a, b) => a - b) };
  });

  // 6) 卡点：被 ≥2 门炮同时罩住的窄道（同队集火也算，那是能守住的点）
  const chokeCells = [];
  for (let i = 0; i < n; i++) {
    if (!count[i] || !(pass[i] & LAND)) continue;
    if (count[i] < 2) continue;
    const x = i % W, y = (i / W) | 0;
    if (openNeighbors(pass, W, H, x, y) > 2) continue;
    chokeCells.push({ i });
  }
  const chokepoints = cluster(chokeCells.map((c) => ({ i: c.i })), W)
    .slice(0, MAX_CHOKE)
    .map((z) => {
      const i = z.list[0];
      const mask = teamMask[i];
      const teams = [];
      for (const [t, bit] of bits) if (mask & bit) teams.push(t);
      return { x: z.x, y: z.y, covered: count[i], teams: teams.sort((a, b) => a - b), cells: z.cells };
    });

  return { W, H, turrets, covered, coveragePct, chokepoints, deadZones, routes, deadLen: deadCells.length, openLen: onRoute.reduce((a, b) => a + b, 0), pass };
}

// ---------------------------------------------------------------- 地图叠加层
let layer = null;
let raf = 0;
let lastKey = '';

export function hideKillzone() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (layer) { layer.remove(); layer = null; }
  lastKey = '';
}

// conf: { heat: true, dead: true, choke: true }
export function showKillzone(res, conf = {}) {
  hideKillzone();
  if (!res) return;
  const cv = document.getElementById('cv');
  if (!cv) return;
  const c = document.createElement('canvas');
  c.className = 'killzone-layer';
  c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3';
  cv.parentElement.append(c);
  layer = c;
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const v = A.rend.view;
    const key = `${cv.width},${cv.height},${v.z.toFixed(3)},${v.ox.toFixed(1)},${v.oy.toFixed(1)}`;
    if (key !== lastKey) {
      lastKey = key;
      c.width = cv.width; c.height = cv.height;
      c.style.width = cv.clientWidth + 'px'; c.style.height = cv.clientHeight + 'px';
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.setTransform(v.z * dpr, 0, 0, v.z * dpr, -v.ox * v.z * dpr, -v.oy * v.z * dpr);
      const { W, H, covered } = res;
      const x0 = Math.max(0, Math.floor(v.ox / TW) - 1), x1 = Math.min(W - 1, Math.ceil((v.ox + A.rend.cw / v.z) / TW));
      const y0 = Math.max(0, Math.floor(v.oy / TW) - 1), y1 = Math.min(H - 1, Math.ceil((v.oy + A.rend.ch / v.z) / TW));
      if (conf.heat !== false) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if (!covered[y * W + x]) continue;
          g.fillStyle = 'rgba(229,72,77,0.22)';
          g.fillRect(x * TW, y * TW, TW, TW);
        }
      }
      if (conf.dead !== false) {
        g.fillStyle = 'rgba(255,214,64,0.30)';
        g.strokeStyle = 'rgba(255,214,64,0.95)';
        g.lineWidth = 1.5 / v.z;
        for (const z of res.deadZones) {
          if (z.x < x0 - 4 || z.x > x1 || z.y < y0 - 4 || z.y > y1) continue;
          g.fillRect(z.x * TW, z.y * TW, TW, TW);
          g.strokeRect(z.x * TW + 1, z.y * TW + 1, TW - 2, TW - 2);
        }
      }
      if (conf.choke !== false) {
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 2 / v.z;
        for (const k of res.chokepoints) {
          if (k.x < x0 - 4 || k.x > x1 || k.y < y0 - 4 || k.y > y1) continue;
          g.beginPath();
          g.arc(k.x * TW + TW / 2, k.y * TW + TW / 2, TW * 0.38, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }
    raf = requestAnimationFrame(draw);
  };
  draw();
}

// ---------------------------------------------------------------- 对话框
Object.assign(HELP, {
  'tool.killzones': {
    t: '火力覆盖分析',
    s: '炮塔射程圈盖住了多少进攻路，哪里有偷袭死角',
    b: '把地图上班带射程的单位（炮塔、防空、指挥中心…）的射程圆铺开，再和每支队伍去敌方出生点的最短路线叠在一起：一眼看出哪段路完全在火力之外（<b>偷袭路</b>），哪些窄道被两边火力同时罩住（<b>卡点</b>）。只算静态射程，不管单位会不会移动、血量多少。',
    tips: ['黄框 = 一条火力都罩不到的路线格子；白圈 = 被 2 门以上炮火同时覆盖的窄道（卡点）。', '射程取单位属性里的 range（像素）÷20，没有就按常见值估。'],
  },
});

const fmt = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1));

// 宽屏时把弹窗停到右边，左边露出地图看热区/死角
function dockRight(width) {
  if (!(window.innerWidth > 980)) return;
  const el = [...document.querySelectorAll('.modal')].pop();
  if (!el) return;
  el.style.placeItems = 'center end';
  el.style.paddingRight = '12px';
  el.style.background = 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,.52) 60%, rgba(0,0,0,.62) 100%)';
  const box = el.querySelector('.box');
  if (box) box.style.width = `min(${width}px, 46vw)`;
}

export async function killzoneDialog() {
  if (!A.ed.map) { toast('先打开一张地图'); return; }
  const res = killzoneAnalysis(A.ed);
  if (!res) { toast('算不出来：地图读不出通行数据'); return; }
  let conf = { heat: true, dead: true, choke: true };
  const note = h('div', { style: 'font-size:12px;color:var(--muted);line-height:1.6;margin-top:6px' });
  const list = h('div', { style: 'margin-top:8px;max-height:46vh;overflow:auto' });

  const refreshNote = () => {
    note.textContent = `覆盖率 ${fmt(res.coveragePct)}%（陆地格）· 炮塔 ${res.turrets.length} 个 · 路线 ${res.routes.length} 条 · `
      + `死角 ${res.deadZones.length} 块（${res.deadLen} 格没有火力）· 卡点 ${res.chokepoints.length} 个`;
  };

  const goto = (x, y) => { A.rend.centerOn(x, y, Math.max(A.rend.view.z, 0.55)); };

  const render = () => {
    refreshNote();
    const rows = [];
    // 每条路线一行
    for (const r of res.routes.slice().sort((a, b) => a.coverPct - b.coverPct)) {
      const pct = Math.round(r.coverPct * 100);
      const col = pct < 20 ? '#e5484d' : pct < 60 ? '#e0a020' : '#3f9a55';
      rows.push(h('div', { class: 'kz-row', style: 'display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)' },
        h('span', { style: `width:8px;height:8px;border-radius:4px;background:${teamColor(r.team)}` }),
        h('span', { style: 'font-size:13px;min-width:180px' }, `第 ${r.team + 1} 队 → 第 ${r.toTeam + 1} 队出生点`),
        h('span', { class: 'hint', style: 'min-width:150px' }, `${r.len} 格，火力内 ${r.coveredLen} 格`),
        h('span', { style: `font-size:13px;font-weight:600;color:${col}` }, `${pct}%`),
        h('button', { style: 'margin-left:auto;padding:2px 8px;font-size:12px', onclick: () => { const p = r.path[Math.floor(r.path.length / 2)]; if (p) goto(p[0], p[1]); } }, '看中段')));
    }
    if (!res.routes.length) rows.push(h('div', { class: 'hint' }, '这张图里没有“一队到另一队出生点”的路线（可能只有一队，或者走不通）。'));

    if (res.deadZones.length) {
      rows.push(h('div', { style: 'font-size:13px;font-weight:600;margin:12px 0 4px' }, '⚠ 火力死角（偷袭路）'));
      for (const z of res.deadZones.slice(0, 12)) {
        rows.push(h('div', { class: 'kz-dead', style: 'display:flex;gap:8px;align-items:center;padding:3px 0' },
          h('span', { style: 'font-size:12px;min-width:96px' }, `${z.x}, ${z.y}`),
          h('span', { class: 'hint' }, `${z.cells} 格 · ${z.teams.length ? z.teams.map((t) => '第' + (t + 1) + '队').join('、') + ' 的路线' : '路线'}`),
          h('button', { style: 'margin-left:auto;padding:2px 8px;font-size:12px', onclick: () => goto(z.x, z.y) }, '去看看')));
      }
    }
    if (res.chokepoints.length) {
      rows.push(h('div', { style: 'font-size:13px;font-weight:600;margin:12px 0 4px' }, '◎ 火力卡点（窄道被多门炮罩住）'));
      for (const k of res.chokepoints.slice(0, 12)) {
        rows.push(h('div', { class: 'kz-choke', style: 'display:flex;gap:8px;align-items:center;padding:3px 0' },
          h('span', { style: 'font-size:12px;min-width:96px' }, `${k.x}, ${k.y}`),
          h('span', { class: 'hint' }, `${k.covered} 门炮同时覆盖 · ${k.teams.map((t) => '第' + (t + 1) + '队').join(' + ')}`),
          h('button', { style: 'margin-left:auto;padding:2px 8px;font-size:12px', onclick: () => goto(k.x, k.y) }, '去看看')));
      }
    }
    list.replaceChildren(...rows);
  };

  const body = h('div', {},
    h('div', { style: 'display:flex;gap:14px;align-items:center;flex-wrap:wrap' },
      h('span', { style: 'font-size:13px' }, '在地图上显示：'),
      toggle('火力热区', conf.heat, (v) => { conf.heat = v; showKillzone(res, conf); }),
      toggle('死角', conf.dead, (v) => { conf.dead = v; showKillzone(res, conf); }),
      toggle('卡点', conf.choke, (v) => { conf.choke = v; showKillzone(res, conf); })),
    note, list,
    h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6' },
      '只算静态射程：不管炮塔会不会被先打掉、单位有没有移动、地形有没有遮挡。射程从单位属性里的 range 读（像素 ÷ 20），读不到就按常见值估。'));

  showKillzone(res, conf);
  render();
  const p = modal('火力覆盖分析（炮塔射程 × 进攻路线）', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
  dockRight(560);
  await p;
  hideKillzone();
}
