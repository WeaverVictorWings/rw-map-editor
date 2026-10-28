// 数据统计面板：地形占比、物品数量、各队资源和单位价值
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { passability, LAND } from './pathing.js';

const ed = A.ed;

// 把地图上的数据算成一组统计
export function collectStats() {
  const m = ed.map;
  if (!m) return null;
  const W = m.width, H = m.height, n = W * H;
  const G = m.ground;
  const pass = passability(ed);
  // 地形：按图块集里的地形名统计
  const terr = new Map();
  const gidName = new Map();
  for (const ts of m.tilesets) {
    if (!ts.terrainNames) continue;
    for (const [id, info] of ts.tiles) {
      if (info.terrain && info.terrain.length === 4 && info.terrain.every((t) => t === info.terrain[0])) {
        gidName.set(ts.firstgid + id, ts.terrainNames[info.terrain[0]] || ('#' + id));
      }
    }
  }
  let land = 0, water = 0, build = 0;
  for (let i = 0; i < n; i++) {
    if (pass[i] & LAND) land++;
    if (pass[i] & 8) build++;
    if (!(pass[i] & LAND) && (pass[i] & 2)) water++;
    const g = G ? G.data[i] : 0;
    const name = gidName.get(g) || ('#' + g);
    terr.set(name, (terr.get(name) || 0) + 1);
  }
  const terrList = [...terr.entries()].sort((a, b) => b[1] - a[1]);
  // 物品
  const items = {};
  const IL = m.layer('items');
  if (IL) {
    const per = new Map();
    for (let i = 0; i < IL.data.length; i++) { const g = IL.data[i]; if (g) per.set(g, (per.get(g) || 0) + 1); }
    for (const [g, c] of per) {
      const ts = m.tilesetOf(g);
      const set = ts ? (ts.terrainNames ? '地形物品' : '物品') : '物品';
      items[set] = (items[set] || 0) + c;
    }
  }
  // 资源池
  const pools = ed.poolTiles();
  // 每队统计
  const teams = new Map();
  const touch = (t) => { if (!teams.has(t)) teams.set(t, { team: t, spawns: 0, units: 0, value: 0 }); return teams.get(t); };
  for (const s of ed.spawns()) touch(s.team).spawns++;
  for (const { o } of ed.allObjects()) {
    const p = (o.props || []).find((x) => x.name === 'unit');
    if (!p) continue;
    const t = +(((o.props || []).find((x) => x.name === 'team') || {}).value ?? 0);
    const e = touch(t);
    e.units++;
    // 单位价值：属性里有 cost 就用，否则按大小估算
    const c = (o.props || []).find((x) => x.name === 'cost');
    e.value += c && !isNaN(+c.value) ? +c.value : Math.round((+(o.attrs.width || 30) * +(o.attrs.height || 30)) / 100);
  }
  // 触发器数量
  const TG = m.group('Triggers');
  const trigN = TG ? TG.objects.length : 0;
  return {
    w: W, h: H, cells: n, land, water, build,
    landPct: n ? (land / n * 100) : 0,
    waterPct: n ? (water / n * 100) : 0,
    buildPct: n ? (build / n * 100) : 0,
    terr: terrList, pools: pools.length, items,
    teams: [...teams.values()].sort((a, b) => a.team - b.team),
    trigN,
    spawnsN: ed.spawns().length,
  };
}

export function statsDialog() {
  const st = collectStats();
  if (!st) return;
  const bar = (pct, color) => h('div', { style: `height:10px;border-radius:5px;background:${color};width:${Math.max(2, pct).toFixed(1)}%` });
  const row = (label, val, pct, color) => h('div', { style: 'margin:4px 0' },
    h('div', { style: 'display:flex;justify-content:space-between;font-size:13px' },
      h('span', {}, label), h('span', { class: 'hint' }, val)),
    h('div', { style: 'background:var(--line);border-radius:5px;overflow:hidden;margin-top:2px' }, bar(pct, color)));
  const body = h('div', {},
    h('div', { class: 'hint' }, `${st.w} × ${st.h} = ${st.cells.toLocaleString()} 格`),
    h('h3', { style: 'font-size:14px;margin:12px 0 6px' }, '能不能走'),
    row('陆地', `${st.land.toLocaleString()} 格 · ${st.landPct.toFixed(1)}%`, st.landPct, '#3f7a32'),
    row('水面', `${st.water.toLocaleString()} 格 · ${st.waterPct.toFixed(1)}%`, st.waterPct, '#1d5fa8'),
    row('能建造', `${st.build.toLocaleString()} 格 · ${st.buildPct.toFixed(1)}%`, st.buildPct, '#c19181'),
    h('h3', { style: 'font-size:14px;margin:12px 0 6px' }, '地形占比'),
    h('div', { style: 'max-height:28vh;overflow:auto' },
      ...st.terr.slice(0, 12).map(([name, c]) => row(name, `${c.toLocaleString()} 格 · ${(c / st.cells * 100).toFixed(1)}%`, c / st.cells * 100, '#8a7f6a'))),
    h('h3', { style: 'font-size:14px;margin:12px 0 6px' }, '队伍'),
    h('table', { style: 'width:100%;border-collapse:collapse;font-size:13px' },
      h('thead', {}, h('tr', {},
        ...['队伍', '出生点', '单位', '估算价值'].map((t) => h('th', { style: 'text-align:left;padding:4px;border-bottom:1px solid var(--line)' }, t)))),
      h('tbody', {}, ...st.teams.map((t) => h('tr', {},
        ...['第 ' + t.team + ' 队', t.spawns, t.units, t.value].map((v) => h('td', { style: 'padding:4px;border-bottom:1px solid var(--line)' }, String(v))))))),
    h('div', { class: 'hint', style: 'margin-top:12px' },
      `资源池 ${st.pools} 个 · 触发器/区域 ${st.trigN} 个 · 出生点 ${st.spawnsN} 个`));
  return modal('数据统计面板', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
}
