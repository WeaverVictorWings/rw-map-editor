// 单位重叠与占位冲突检查：找出互相压住的单位、摆错格子的单位（水上 / 悬崖 / 桥 / 船上岸）
// 只读：不改地图，不产生撤销步。
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast, closeModal } from './ui.js';
import { passability, LAND, NAVAL, HOVER, BUILD } from './pathing.js';
import { teamColor } from './render.js';
import { objProp } from './tmx.js';
import { UNIT_CN } from './editor.js';

const TW = 20;          // 一格 20px
const LIMIT = 200;      // 列表最多显示多少条
let flashTimer = 0;

Object.assign(HELP, {
  'tool.collision': {
    t: '重叠与占位检查',
    s: '找出压在一起、摆错格子的单位',
    b: '扫描所有单位：① 找出互相重叠的单位，按重叠面积区分“轻微贴着”和“真的压在一起”；② 找出摆在不可通行 / 不可建造格子上的单位，以及船只摆在地上的情况。点列表里的一条会跳到地图上并高亮，还可以一键把重叠的单位全部选中，方便手动挪开。只读检查，不会改地图。',
    tips: ['TMX 里单位的 y 是下边缘，这里按 [x, x+w] × [y−h, y] 算占位。', '重叠面积不超过 1 格算轻微贴着，超过 1 格才算真的压住。', '把叠加图关掉（叠加=无）时，跳转会顺带高亮 4 秒；叠加图开着就不抢颜色。'],
  },
});

// 和 panels.js 的 unitCat 保持一致（build / air / naval / land；exp 按 land 处理）
function catOf(n) {
  if (/factory|turret|extractor|fabricator|laboratory|commandCenter|defen[cs]e|launcher|bunker|depot|antiAir|nuke|repair|radar|wall|outpost|crates/i.test(n)) return 'build';
  if (/gunship|helicopter|interceptor|bomber|dropship|airship|jet|fireBee|plane|aircraft/i.test(n)) return 'air';
  if (/boat|ship|sub(marine)?\b|battleship|lightSub|heavySub/i.test(n) && !/hover/i.test(n)) return 'naval';
  return 'land';
}

function unitsOf(ed2) {
  const out = [];
  for (const { o, G } of ed2.allObjects()) {
    const unit = objProp(o, 'unit');
    if (!unit) continue;
    out.push({ o, G, unit: String(unit), team: +(objProp(o, 'team') ?? 0), name: String(o.attrs.name || unit) });
  }
  return out;
}

// 对象占位矩形（像素）：gid 对象的 y 是下边缘
function rectOf(u) {
  const a = u.o.attrs;
  const x = +a.x || 0, y = +a.y || 0;
  const w = +a.width || TW, h = +a.height || TW;
  const bottom = !!+a.gid;
  return { x0: x, x1: x + w, y0: bottom ? y - h : y, y1: bottom ? y : y + h, w, h };
}

const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

// 单位覆盖的格子（夹到地图内）
function cellsOf(u, W, H) {
  const r = rectOf(u);
  const x0 = Math.max(0, Math.floor(r.x0 / TW)), x1 = Math.min(W - 1, Math.floor((r.x1 - 0.001) / TW));
  const y0 = Math.max(0, Math.floor(r.y0 / TW)), y1 = Math.min(H - 1, Math.floor((r.y1 - 0.001) / TW));
  const cells = [];
  if (x1 >= x0 && y1 >= y0) for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) cells.push(ty * W + tx);
  return { cells, x0, y0, x1, y1 };
}

function centerCell(r, W, H) {
  const tx = Math.floor(((r.x0 + r.x1) / 2) / TW), ty = Math.floor(((r.y0 + r.y1) / 2) / TW);
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return -1;
  return ty * W + tx;
}

// 互相重叠的单位。pairs: [[i,j,重叠面积(px²)]]，cells: 被两个以上单位占住的格子 → 单位序号数组
export function scanOverlaps(ed2 = A.ed) {
  const res = { count: 0, pairs: [], cells: new Map(), units: [], severe: [], slight: [], touching: 0 };
  const m = ed2.map;
  if (!m) return res;
  const W = m.width, H = m.height;
  const units = unitsOf(ed2);
  const rects = units.map(rectOf);
  const occ = new Map();
  units.forEach((u, i) => {
    for (const k of cellsOf(u, W, H).cells) {
      const a = occ.get(k);
      if (a) a.push(i); else occ.set(k, [i]);
    }
  });
  const seen = new Set();
  for (const [k, idxs] of occ) {
    if (idxs.length < 2) continue;
    res.cells.set(k, idxs.slice());
    for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
      const a = idxs[i], b = idxs[j];
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      const area = overlapArea(rects[a], rects[b]);
      res.pairs.push([a, b, area]);
      const rec = { pair: [a, b, area], a: units[a], b: units[b], rectA: rects[a], rectB: rects[b], area };
      if (area > TW * TW) res.severe.push(rec);
      else if (area > 0) res.slight.push(rec);
      else res.touching++;
    }
  }
  res.pairs.sort((p, q) => q[2] - p[2]);
  res.units = units;
  res.count = res.pairs.length;                     // 含“只是格子相邻”（面积 0）
  res.countReal = res.severe.length + res.slight.length; // 真的有面积的重叠
  return res;
}

// 摆在错误格子上的单位。kind: outside / water / blocked / no-build / ship-land / air-blocked
export function scanBlocked(ed2 = A.ed) {
  const res = { count: 0, items: [], byKind: {} };
  const m = ed2.map;
  if (!m) return res;
  const W = m.width, H = m.height;
  const pass = passability(ed2);
  const units = unitsOf(ed2);
  units.forEach((u, i) => {
    const r = rectOf(u);
    const cat = catOf(u.unit);
    const at = cellsOf(u, W, H);
    const base = {
      index: i, obj: u.o, G: u.G, unit: u.unit, name: u.name, team: u.team, cat,
      rect: r, tx: -1, ty: -1, cells: at.cells, cellsBad: 0, cellsTotal: at.cells.length,
    };
    const ci = centerCell(r, W, H);
    if (ci < 0) {
      res.items.push({ ...base, kind: 'outside', reason: '单位超出了地图范围' });
      return;
    }
    const c = pass[ci];
    const tx = ci % W, ty = (ci / W) | 0;
    let need = LAND, kind = null, reason = '';
    if (cat === 'naval') {
      need = NAVAL;
      if (!(c & NAVAL)) { kind = 'ship-land'; reason = '船只摆在了地上（这里不是水面）'; }
    } else if (cat === 'air') {
      need = HOVER;
      if (!(c & HOVER)) { kind = 'air-blocked'; reason = '飞行单位摆在了不能飞的地形上'; }
    } else if (cat === 'build') {
      need = BUILD;
      if (!(c & BUILD)) {
        if (c & LAND) { kind = 'no-build'; reason = '建筑摆在了不能建造的格子（比如桥面 / 障碍旁）'; }
        else { kind = 'blocked'; reason = '建筑摆在了不可通行、不可建造的格子'; }
      }
    } else {
      need = LAND;
      if (!(c & LAND)) {
        if (c & NAVAL) { kind = 'water'; reason = '陆地单位摆在水上'; }
        else { kind = 'blocked'; reason = '陆地单位摆在了悬崖 / 熔岩 / 障碍上'; }
      }
    }
    if (!kind) return;
    const bad = at.cells.reduce((n, k) => n + ((pass[k] & need) ? 0 : 1), 0);
    res.items.push({ ...base, tx, ty, cellsBad: bad, kind, reason, cell: ci });
  });
  const order = { outside: 0, 'ship-land': 1, water: 1, blocked: 2, 'no-build': 3, 'air-blocked': 4 };
  res.items.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.index - b.index);
  for (const it of res.items) res.byKind[it.kind] = (res.byKind[it.kind] || 0) + 1;
  res.count = res.items.length;
  return res;
}

// ---------- 高亮 / 跳转 ----------
const rgba = (r, g, b, a) => (((a & 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
const C_OVER = rgba(229, 121, 58, 150);  // 橙：重叠
const C_BAD = rgba(242, 84, 91, 150);    // 红：占位错误

// 临时染色 4 秒；叠加图开着时不抢 tint
function flash(kind, cells) {
  if (A.overlayKind !== 'none' || !A.rend) return false;
  const color = kind === 'overlap' ? C_OVER : C_BAD;
  A.rend.setTint({ kind: 'collision', fn: (i) => (cells.has(i) ? color : 0), opacity: 0.9 });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (A.rend.tint && A.rend.tint.kind === 'collision') A.rend.setTint(null);
  }, 4000);
  return true;
}

function goTo(u, cells, kind) {
  if (!A.ed.map) return;
  const r = rectOf(u);
  A.rend.centerOn((r.x0 + r.x1) / 2 / TW, (r.y0 + r.y1) / 2 / TW, 2.2);
  A.ed.selected = u.o;
  flash(kind, new Set(cells));
  A.rend.request();
  A.refresh('dock');
}

function selectAllOverlaps(ov) {
  const m = A.ed.map;
  const pairs = [...ov.severe, ...ov.slight].map((r) => r.pair);
  if (!m || !pairs.length) return null;
  const W = m.width, H = m.height;
  const idx = new Set();
  for (const [a, b] of pairs) { idx.add(a); idx.add(b); }
  let x0 = W - 1, y0 = H - 1, x1 = 0, y1 = 0;
  const on = new Set();
  for (const i of idx) {
    const at = cellsOf(ov.units[i], W, H);
    if (!at.cells.length) continue;
    x0 = Math.min(x0, at.x0); y0 = Math.min(y0, at.y0);
    x1 = Math.max(x1, at.x1); y1 = Math.max(y1, at.y1);
    for (const k of at.cells) on.add(k);
  }
  if (!on.size) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (const k of on) mask[((k / W | 0) - y0) * w + (k % W - x0)] = 1;
  A.ed.selection = { x0, y0, x1, y1, mask };
  A.ed.selected = null;
  A.hooks.renderSelbar && A.hooks.renderSelbar();
  A.refresh('dock', 'modes');
  A.rend.centerOn((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, Math.min(2.2, Math.max(0.8, 24 / Math.max(w, h))));
  toast(`已选中 ${idx.size} 个重叠单位，可以剪切、清空或拖动`);
  return A.ed.selection;
}

// ---------- 界面 ----------
const label = (u) => UNIT_CN[u.unit] || u.unit;
const unitLine = (u) => {
  const dot = h('span', { style: `display:inline-block;width:8px;height:8px;border-radius:50%;background:${teamColor(u.team)};margin-right:5px;flex:none` });
  return [dot, `${label(u)}`, h('span', { class: 'badge', style: 'margin-left:6px' }, `第 ${u.team + 1} 队`)];
};

function overlapRow(ov, i, j, area) {
  const ua = ov.units[i], ub = ov.units[j];
  const t = (u) => {
    const r = rectOf(u);
    return `${Math.floor((r.x0 + r.x1) / 2 / TW)},${Math.floor((r.y0 + r.y1) / 2 / TW)}`;
  };
  const tag = area > TW * TW ? `压在一起 ${Math.round(area)}px²`
    : (area > 0 ? `轻微贴着 ${Math.round(area)}px²` : '格子相邻 0px²');
  const el = h('div', { class: 'collision-row', style: 'display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid var(--line);cursor:pointer;font-size:12.5px' },
    ...unitLine(ua),
    h('span', { style: 'color:var(--muted)' }, '×'),
    ...unitLine(ub),
    h('span', { class: 'badge', style: `margin-left:auto;${area > TW * TW ? 'background:#4a1d1f;color:var(--err)' : ''}` }, tag),
    h('span', { class: 'hint', style: 'background:none;border:0;padding:0;margin-left:6px;font-size:11.5px' }, `${t(ua)} / ${t(ub)}`));
  el.onclick = () => {
    const m = A.ed.map;
    if (!m) return;
    const cells = [];
    for (const u of [ua, ub]) for (const k of cellsOf(u, m.width, m.height).cells) cells.push(k);
    closeModal();
    goTo(ua, cells, 'overlap');
  };
  return el;
}

function blockedRow(it) {
  const cells = it.cells.length ? it.cells : (it.cell != null ? [it.cell] : []);
  const el = h('div', { class: 'collision-row', style: 'display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid var(--line);cursor:pointer;font-size:12.5px' },
    ...unitLine(it),
    h('span', { class: 'badge', style: 'background:#4a1d1f;color:var(--err)' }, it.reason),
    h('span', { class: 'hint', style: 'background:none;border:0;padding:0;margin-left:auto;font-size:11.5px' },
      it.kind === 'outside' ? '地图外' : `格 ${it.tx},${it.ty}${it.cellsBad ? ` · ${it.cellsBad}/${it.cellsTotal} 格不可用` : ''}`));
  el.onclick = () => { if (!A.ed.map) return; closeModal(); goTo(it, cells, 'bad'); };
  return el;
}

function summaryCard(title, n, sub) {
  return h('div', { class: 'card', style: 'flex:1;min-width:200px' },
    h('div', { style: 'font-size:22px;font-weight:600;line-height:1.2' }, String(n)),
    h('div', { style: 'font-size:12.5px;color:var(--muted)' }, title),
    h('div', { class: 'hint', style: 'margin-top:6px;padding:4px 6px;font-size:11.5px' }, sub));
}

function section(title, count, rows, emptyText) {
  const box = h('div', { style: 'margin-bottom:14px' });
  box.append(h('div', { style: 'display:flex;align-items:baseline;gap:8px;margin-bottom:4px' },
    h('b', { style: 'font-size:13px' }, title),
    h('span', { class: 'badge' }, `${count} 条`)));
  if (!rows.length) box.append(h('div', { class: 'hint' }, emptyText));
  else {
    const list = h('div', { style: 'max-height:230px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--bg2)' }, ...rows);
    box.append(list);
    if (count > rows.length) box.append(h('div', { class: 'hint', style: 'margin-top:4px' }, `只显示前 ${rows.length} 条，共 ${count} 条。`));
  }
  return box;
}

export function collisionDialog() {
  if (!A.ed.map) { toast('先新建或打开一张地图'); return; }
  const ov = scanOverlaps(A.ed);
  const bl = scanBlocked(A.ed);
  const ovRows = ov.pairs.slice(0, LIMIT).map(([a, b, area]) => overlapRow(ov, a, b, area));
  const blRows = bl.items.slice(0, LIMIT).map(blockedRow);
  const real = ov.severe.length + ov.slight.length;
  const ovSub = real
    ? `真的压在一起 ${ov.severe.length} 对 · 轻微贴着 ${ov.slight.length} 对${ov.touching ? ` · 另有 ${ov.touching} 处只是格子相邻` : ''}`
    : (ov.touching ? `没有实际重叠，${ov.touching} 处只是格子相邻` : '任意两个单位都不重叠');
  const blSub = bl.count
    ? Object.entries(bl.byKind).map(([k, v]) => `${({ outside: '地图外', water: '水上', 'ship-land': '船上岸', blocked: '不可通行', 'no-build': '不能建造', 'air-blocked': '不能飞' })[k] || k} ${v}`).join(' · ')
    : '所有单位都摆在能站 / 能建造的格子上';
  const body = h('div', {},
    h('div', { style: 'display:flex;gap:10px;margin-bottom:12px' },
      summaryCard('对重叠的单位', real, ovSub),
      summaryCard('个占位问题', bl.count, blSub)),
    section('重叠的单位', ov.count, ovRows, '没有单位互相压住，摆得挺整齐。'),
    section('占位 / 摆错格子', bl.count, blRows, '没有单位摆在不可通行或不可建造的格子上。'),
    h('div', { class: 'hint' }, '只读检查，不会改地图。点一条会跳到地图上并高亮；「选中全部重叠单位」会生成一个覆盖这些单位的选区，之后可以用选区工具剪切 / 清空。'));
  const buttons = [{ label: '关闭', value: 0 }];
  if (real) buttons.push({ label: `选中全部重叠单位（${real} 对）`, primary: true, value: () => selectAllOverlaps(ov) });
  return modal('重叠与占位检查', body, buttons, { wide: true });
}
