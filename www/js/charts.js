// 地图统计图表：地形占比、资源分布、单位构成
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { HELP } from './help.js';

const ed = A.ed;
const TW = 20;

Object.assign(HELP, {
  'tool.charts': { t: '地图统计图表', s: '地形占比、资源分布、单位构成', b: '用图把这张地图的构成画出来：<b>地形占比</b>（每种地形占多少格、百分之几）、<b>资源分布</b>（每个队伍门口有几个资源池、离出生点最近/最远多少格）、<b>单位构成</b>（每种单位多少个）。用来快速判断“这张图是不是太水了/资源是不是一边多一边少”。' },
});

// 统计各地形：取每套图块集里"内部四角地形都一样"的图块当代表
export function terrainStats(ed2 = ed) {
  const m = ed2.map;
  if (!m) return [];
  const gidName = new Map();
  for (const ts of m.tilesets) {
    if (!ts.terrainNames || !ts.tiles) continue;
    for (const [id, info] of ts.tiles) {
      if (info.terrain && info.terrain.length === 4 && info.terrain.every((t) => t === info.terrain[0])) {
        gidName.set(ts.firstgid + id, ts.terrainNames[info.terrain[0]] || ('#' + id));
      }
    }
  }
  const layer = m.layers.find((l) => l.name === 'Ground') || m.layers[0];
  if (!layer || !layer.data) return [];
  const cnt = new Map();
  let total = 0;
  for (let i = 0; i < layer.data.length; i++) {
    const g = layer.data[i];
    if (!g) continue;
    const key = gidName.get(g) || '未标注';
    cnt.set(key, (cnt.get(key) || 0) + 1);
    total++;
  }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, n: v, pct: v / total * 100 }));
}

// 每队资源分布
export function resourceStats(ed2 = ed) {
  const m = ed2.map;
  if (!m) return [];
  const spawns = ed2.spawns();
  const pools = ed2.poolTiles();
  const teams = new Map();
  for (const s of spawns) {
    if (!teams.has(s.team)) teams.set(s.team, { team: s.team, sx: s.cx / TW, sy: s.cy / TW, pools: 0, near: Infinity, far: 0, list: [] });
  }
  for (const [px, py] of pools) {
    // 找最近的出生点（按曼哈顿距离·只算本队）
    let best = null, bd = Infinity;
    for (const t of teams.values()) {
      const d = Math.abs(px - t.sx) + Math.abs(py - t.sy);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) {
      best.pools++;
      best.list.push([px, py]);
      best.near = Math.min(best.near, bd);
      best.far = Math.max(best.far, bd);
    }
  }
  return [...teams.values()].sort((a, b) => a.team - b.team);
}

// 单位构成
export function unitStats(ed2 = ed) {
  const m = new Map();
  for (const { o } of ed2.allObjects()) {
    const p = (o.props || []).find((x) => x.name === 'unit');
    if (!p) continue;
    m.set(p.value, (m.get(p.value) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// 画一个横向条形图
function bar(label, value, max, color, extra) {
  const w = max > 0 ? Math.max(2, Math.round(value / max * 100)) : 0;
  return h('div', { class: 'hrow', style: 'gap:8px' },
    h('span', { style: 'width:90px;flex:none;font-size:12px' }, label),
    h('span', { style: 'flex:1;background:rgba(128,128,128,.18);border-radius:3px;height:14px;position:relative' },
      h('span', { style: `position:absolute;left:0;top:0;bottom:0;width:${w}%;background:${color};border-radius:3px` })),
    h('span', { class: 'hint', style: 'width:110px;text-align:right;font-size:12px' }, extra));
}

export function chartsDialog() {
  if (!ed.map) return;
  const terr = terrainStats();
  const res = resourceStats();
  const units = unitStats();
  const maxT = terr.length ? terr[0].n : 1;
  const maxP = res.length ? Math.max(...res.map((r) => r.pools)) : 1;
  const maxU = units.length ? units[0][1] : 1;
  const colors = ['#4a90e2', '#36c25b', '#f5c518', '#a855f7', '#fb923c', '#22d3ee', '#f472b6'];
  const body = h('div', {},
    h('h3', { style: 'font-size:14px;margin:0 0 6px' }, '地形占比'),
    ...terr.slice(0, 12).map((t, i) => bar(t.name, t.n, maxT, colors[i % colors.length], `${t.n.toLocaleString()} 格 · ${t.pct.toFixed(1)}%`)),
    h('h3', { style: 'font-size:14px;margin:14px 0 6px' }, '各队资源分布'),
    res.length ? h('div', {}, ...res.map((r, i) => bar(`第 ${r.team} 队`, r.pools, maxP, colors[i % colors.length],
      `${r.pools} 个 · ${r.near === Infinity ? '—' : r.near.toFixed(0) + '~' + r.far.toFixed(0) + ' 格'}`)))
      : h('div', { class: 'hint' }, '还没有资源池'),
    h('h3', { style: 'font-size:14px;margin:14px 0 6px' }, `单位构成（${units.reduce((a, b) => a + b[1], 0)} 个）`),
    ...units.slice(0, 12).map(([u, c], i) => bar(u, c, maxU, colors[i % colors.length], `${c} 个`)));
  return modal('地图统计图表', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
}
