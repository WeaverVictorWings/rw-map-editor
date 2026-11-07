// 地理工具（3.3）：经纬度校准、经纬网、按海岸线画岛、按表格放城市、量测、连通图叠加、地形整形
// 校准：给几个已知点（经度、纬度 → 格坐标），拟合 2 次多项式（≥6 点）或仿射（≥3 点），之后所有经纬度功能共用。
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast, busy, select } from './ui.js';
import { objProp } from './tmx.js';
import { passability, LAND, NAVAL, BUILD } from './pathing.js';
import { applyCells, mergeSmall } from './terraform.js';
import { NONE } from './terrain.js';
import { components, gapBetween, getRules, setRules, waterWidthAt } from './checks2.js';

Object.assign(HELP, {
  'tool.geo': { t: '地理工具', s: '经纬度校准、按海岸线画岛、按表格放城市、量测、地形整形', b: '先在“校准”里填几个已知点（比如城市的经纬度和它在图上的格坐标），点“拟合”。之后：<b>经纬网</b>叠在图上；<b>画岛</b>粘贴经纬度多边形（或 GeoJSON）一键生成带沙滩的岛；<b>放城市</b>粘贴“名称,经度,纬度,队伍”表格，每座城显示偏离了多少格；<b>量测</b>量陆地面积、海峡最窄处；<b>整形</b>清碎片、画边缘墙、做过渡带、把岛和大陆隔开。全部可一步撤销。' },
});

const ed = A.ed;

// ---------------- 校准 ----------------
const basis = (deg, x, y) => (deg >= 2 ? [1, x, y, x * y, x * x, y * y] : [1, x, y]);
function solveLS(rows, ys) { // 正规方程 + 高斯消元（点很少，数值够用）
  const n = rows[0].length, M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let k = 0; k < rows.length; k++) for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) M[i][j] += rows[k][i] * rows[k][j]; M[i][n] += rows[k][i] * ys[k]; }
  for (let i = 0; i < n; i++) M[i][i] += 1e-9;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i] || 1e-12;
    for (let j = i; j <= n; j++) M[i][j] /= d;
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i]; if (f) for (let j = i; j <= n; j++) M[r][j] -= f * M[i][j]; }
  }
  return M.map((r) => r[n]);
}
// pts: [{lon,lat,tx,ty}] → { deg, cx, cy, ox, oy, sx, sy, rmse } ；输入先归一化
export function fitCalibration(pts) {
  if (pts.length < 3) throw new Error('至少需要 3 个校准点');
  const deg = pts.length >= 8 ? 2 : 1;
  const lo = pts.map((p) => p.lon), la = pts.map((p) => p.lat);
  const mx = lo.reduce((a, b) => a + b, 0) / lo.length, my = la.reduce((a, b) => a + b, 0) / la.length;
  const sx = Math.max(1e-6, Math.max(...lo) - Math.min(...lo)), sy = Math.max(1e-6, Math.max(...la) - Math.min(...la));
  const rows = pts.map((p) => basis(deg, (p.lon - mx) / sx, (p.lat - my) / sy));
  const cx = solveLS(rows, pts.map((p) => p.tx)), cy = solveLS(rows, pts.map((p) => p.ty));
  const cal = { deg, mx, my, sx, sy, cx, cy };
  let e = 0; for (const p of pts) { const [tx, ty] = ll2tile(cal, p.lon, p.lat); e += (tx - p.tx) ** 2 + (ty - p.ty) ** 2; }
  cal.rmse = Math.sqrt(e / pts.length);
  return cal;
}
export function ll2tile(cal, lon, lat) {
  const b = basis(cal.deg, (lon - cal.mx) / cal.sx, (lat - cal.my) / cal.sy);
  let x = 0, y = 0; for (let i = 0; i < b.length; i++) { x += b[i] * cal.cx[i]; y += b[i] * cal.cy[i]; }
  return [x, y];
}
// 反算：牛顿迭代
export function tile2ll(cal, tx, ty) {
  let lon = cal.mx, lat = cal.my;
  for (let k = 0; k < 30; k++) {
    const [x, y] = ll2tile(cal, lon, lat), e = 1e-4;
    const [x1, y1] = ll2tile(cal, lon + e, lat), [x2, y2] = ll2tile(cal, lon, lat + e);
    const a = (x1 - x) / e, b = (x2 - x) / e, c = (y1 - y) / e, d = (y2 - y) / e, det = a * d - b * c || 1e-9;
    const dx = tx - x, dy = ty - y;
    lon += (d * dx - b * dy) / det; lat += (-c * dx + a * dy) / det;
  }
  return [lon, lat];
}
export function getCal() {
  if (A.geoCal) return A.geoCal;
  try { const g = ed.map.group('EditorRules'); const o = g && g.objects.find((q) => (q.attrs.name || '') === 'rwGeo'); if (o) A.geoCal = JSON.parse(objProp(o, 'json')); } catch { /* 没有就算了 */ }
  return A.geoCal || null;
}
export function saveCal(cal, pts) {
  A.geoCal = cal; A.geoPts = pts;
  const G = ed.map.ensureGroup('EditorRules');
  ed.begin('保存经纬度校准'); ed.op.snapshotGroup(G);
  let o = G.objects.find((q) => (q.attrs.name || '') === 'rwGeo');
  if (!o) { o = { attrs: { name: 'rwGeo', x: '0', y: '0', width: '20', height: '20' }, props: [], extra: [] }; G.objects.push(o); }
  const p = o.props.find((q) => q.name === 'json'), v = JSON.stringify({ ...cal, pts });
  if (p) p.value = v; else o.props.push({ name: 'json', value: v });
  ed.commit();
}

// ---------------- 经纬网叠加 ----------------
let gridOn = false, gridStep = 1;
export function setGrid(on, step = 1) { gridOn = on; gridStep = step; installDraw(); A.rend.request(); }
let drawInstalled = false;
function installDraw() {
  if (drawInstalled) return; drawInstalled = true;
  const rend = A.rend, prev = rend.onDraw;
  rend.onDraw = () => { try { if (prev) prev(); } catch (e) { /* 不拖垮别人 */ } try { drawGrid(); } catch (e) { /* 不拖垮渲染 */ } };
}
function drawGrid() {
  const cal = getCal(); if (!gridOn || !cal || !ed.map) return;
  const rend = A.rend, ctx = rend.ctx, m = ed.map, tw = m.tw;
  ctx.save(); ctx.lineWidth = 1; ctx.font = '11px sans-serif'; ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = 'rgba(255,211,77,.45)';
  // 视野范围对应的经纬度范围：取四角反算
  const corners = [[0, 0], [m.width, 0], [0, m.height], [m.width, m.height]].map(([x, y]) => tile2ll(cal, x, y));
  const lo0 = Math.floor(Math.min(...corners.map((c) => c[0])) / gridStep) * gridStep, lo1 = Math.ceil(Math.max(...corners.map((c) => c[0])) / gridStep) * gridStep;
  const la0 = Math.floor(Math.min(...corners.map((c) => c[1])) / gridStep) * gridStep, la1 = Math.ceil(Math.max(...corners.map((c) => c[1])) / gridStep) * gridStep;
  const S = (lon, lat) => { const [x, y] = ll2tile(cal, lon, lat); return rend.toScreen(x * tw, y * tw); };
  for (let lo = lo0; lo <= lo1; lo += gridStep) { ctx.beginPath(); for (let la = la0; la <= la1; la += gridStep / 8) { const p = S(lo, la); if (la === la0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } ctx.stroke(); const p = S(lo, (la0 + la1) / 2); ctx.fillText(lo + '°E', p.x + 3, p.y); }
  for (let la = la0; la <= la1; la += gridStep) { ctx.beginPath(); for (let lo = lo0; lo <= lo1; lo += gridStep / 8) { const p = S(lo, la); if (lo === lo0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } ctx.stroke(); const p = S((lo0 + lo1) / 2, la); ctx.fillText(la + '°N', p.x + 3, p.y - 3); }
  ctx.restore();
}

// ---------------- 地形单元读写 ----------------
// 每格取四角中出现最多的地形；写回走 applyCells（自动过渡、可撤销）
export function cellsOf(ed2 = ed) {
  const eng = ed2.engine, W = ed2.map.width, H = ed2.map.height, W1 = eng.W1, V = eng.V, out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = V[y * W1 + x], b = V[y * W1 + x + 1], c = V[(y + 1) * W1 + x], d = V[(y + 1) * W1 + x + 1];
    out[y * W + x] = (a === b || a === c || a === d) ? a : (b === c || b === d ? b : (c === d ? c : a));
  }
  return out;
}
const T = (name) => ed.engine.index(name);
const WATER_NAMES = ['Deep Water', 'Water', 'Shallow Water', 'Lake', 'Ice Lake'];
export const isWaterCell = (c) => WATER_NAMES.includes(ed.engine.names[c]);
function dilate(mask, W, H, r) { // 方形 r 次 4 邻域膨胀
  let a = mask;
  for (let k = 0; k < r; k++) {
    const b = new Uint8Array(a);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (a[i]) continue; if ((x > 0 && a[i - 1]) || (x < W - 1 && a[i + 1]) || (y > 0 && a[i - W]) || (y < H - 1 && a[i + W])) b[i] = 1; }
    a = b;
  }
  return a;
}
const erode = (mask, W, H, r) => { const inv = new Uint8Array(mask.length); for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1; const d = dilate(inv, W, H, r); for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1; return d; };
function blur(mask, W, H, r) { // 方框模糊后 >0.5
  if (r <= 0) return mask;
  const f = new Float32Array(mask.length); for (let i = 0; i < f.length; i++) f[i] = mask[i];
  const g = new Float32Array(f.length), N = 2 * r + 1;
  for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += f[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { g[y * W + x] = s / N; s += f[y * W + Math.min(W - 1, x + r + 1)] - f[y * W + Math.max(0, x - r)]; } }
  const o = new Uint8Array(f.length);
  for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += g[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = s / N > 0.5 ? 1 : 0; s += g[Math.min(H - 1, y + r + 1) * W + x] - g[Math.max(0, y - r) * W + x]; } }
  return o;
}

// ---------------- 多边形 ----------------
// 解析：每行 "经度,纬度"（空行分隔多个环），或 GeoJSON（Polygon / MultiPolygon / Feature / FeatureCollection）
export function parsePolygons(text) {
  const t = String(text || '').trim(); if (!t) return [];
  if (t[0] === '{' || t[0] === '[') {
    const rings = [];
    const walk = (g) => {
      if (!g) return;
      if (g.type === 'FeatureCollection') g.features.forEach(walk);
      else if (g.type === 'Feature') walk(g.geometry);
      else if (g.type === 'Polygon') rings.push(g.coordinates[0].map((c) => ({ lon: c[0], lat: c[1] })));
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => rings.push(p[0].map((c) => ({ lon: c[0], lat: c[1] }))));
    };
    walk(JSON.parse(t)); return rings;
  }
  return t.split(/\n\s*\n/).map((blk) => blk.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [a, b] = l.split(/[,\s;]+/).map(Number); return { lon: a, lat: b }; }).filter((p) => isFinite(p.lon) && isFinite(p.lat))).filter((r) => r.length >= 3);
}
export function rasterRings(rings, cal, W, H, scale = 1) {
  const cv = new OffscreenCanvas(W, H), c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.imageSmoothingEnabled = false;
  const pts = rings.map((r) => r.map((p) => ll2tile(cal, p.lon, p.lat)));
  let sx = 0, sy = 0, n = 0; for (const r of pts) for (const p of r) { sx += p[0]; sy += p[1]; n++; }
  const mx = sx / n, my = sy / n;
  for (const r of pts) { c.beginPath(); r.forEach((p, i) => { const x = mx + (p[0] - mx) * scale, y = my + (p[1] - my) * scale; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath(); c.fill(); }
  const d = c.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}
// 画岛：mask 内填 fill，最外 beach 圈填 beachT；gap>0 时在岛周围挖 gap 格海峡并加浅水边
export function paintIsland(opt) {
  const { rings, scale = 1, fill = 'Grass', beach = 'Sand', beachW = 1, smooth = 1, gap = 0, erase = null } = opt;
  const m = ed.map, W = m.width, H = m.height, cal = getCal(); if (!cal) throw new Error('请先在“校准”里拟合经纬度');
  let mask = blur(rasterRings(rings, cal, W, H, scale), W, H, smooth);
  const cnt = mask.reduce((a, b) => a + b, 0); if (!cnt) throw new Error('多边形不在地图范围内');
  const cells = cellsOf(), water = T('Water'), shallow = T('Shallow Water');
  const fillT = T(fill), beachT = beach ? T(beach) : -1;
  if (fillT < 0) throw new Error('图块集里没有地形：' + fill);
  if (erase) for (let i = 0; i < cells.length; i++) if (erase[i] && !isWaterCell(cells[i])) cells[i] = water;
  const inner = erode(mask, W, H, beachW);
  let carved = 0;
  if (gap > 0) {
    const core = dilate(mask, W, H, 1), band = dilate(core, W, H, gap);
    for (let i = 0; i < cells.length; i++) if (band[i] && !core[i] && !isWaterCell(cells[i])) { cells[i] = water; carved++; }
    const near = dilate(core, W, H, 2);
    for (let i = 0; i < cells.length; i++) if (!mask[i] && near[i] && cells[i] === water && shallow >= 0) cells[i] = shallow;
  }
  for (let i = 0; i < cells.length; i++) if (mask[i]) cells[i] = (beachT >= 0 && !inner[i]) ? beachT : fillT;
  ed.beginWhole('按海岸线画岛'); applyCells(ed, cells, ed.op); ed.commit();
  return { cells: cnt, carved };
}

// ---------------- 按表格放城市 ----------------
// 行：名称,经度,纬度,队伍(从 1 开始),角色(city|start，默认 city)
export function placeCities(text, opt = {}) {
  const cal = getCal(); if (!cal) throw new Error('请先校准经纬度');
  const m = ed.map, W = m.width, H = m.height, pass = passability(ed), G = ed.unitsGroup();
  const rows = String(text).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s*[,，\t]\s*/));
  const res = [], taken = [];
  ed.begin('按表格放城市'); ed.op.snapshotGroup(G);
  for (const r of rows) {
    const [name, lo, la, tm, role] = r; const lon = +lo, lat = +la; if (!isFinite(lon) || !isFinite(lat)) { res.push({ name, err: '经纬度不是数字' }); continue; }
    const [fx, fy] = ll2tile(cal, lon, lat);
    let best = null; const R = opt.snap ?? 4;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const X = Math.round(fx) + dx, Y = Math.round(fy) + dy; if (X < 3 || Y < 3 || X >= W - 3 || Y >= H - 3 || !(pass[Y * W + X] & BUILD)) continue;
      if (taken.some((t) => Math.abs(t[0] - X) < (opt.minGap ?? 3) && Math.abs(t[1] - Y) < (opt.minGap ?? 3))) continue;
      const d = Math.hypot(X - fx, Y - fy); if (!best || d < best.d) best = { X, Y, d };
    }
    if (!best) { res.push({ name, err: '附近没有可建造的格子', fx, fy }); continue; }
    taken.push([best.X, best.Y]);
    const team = Math.max(0, (+tm || 1) - 1), px = best.X * 20 + 10, py = best.Y * 20 + 10;
    const u = ed.makeUnit('commandCenter', team, px - 15, py + 15, 30, 30, '-90.0');
    u.props.push({ name: 'rwRole', value: role || 'city' }, { name: 'rwName', value: name });
    G.objects.push(u);
    res.push({ name, tx: best.X, ty: best.Y, off: best.d, fx, fy });
  }
  ed.commit();
  return res;
}

// ---------------- 量测 ----------------
export function measureAt(tx, ty) {
  const pass = passability(ed), comp = components(ed, pass), W = ed.map.width, i = ty * W + tx;
  const lid = comp.lblLand[i], wid = comp.lblWater[i];
  const out = { tx, ty };
  if (lid >= 0) { const c = comp.land[lid]; out.land = { area: c.area, bbox: [c.x0, c.y0, c.x1, c.y1], main: c === comp.mainLand }; }
  if (wid >= 0) out.waterWidth = waterWidthAt(pass, W, ed.map.height, tx, ty);
  const cal = getCal(); if (cal) out.ll = tile2ll(cal, tx, ty);
  return out;
}
export function strait(txA, tyA, txB, tyB) {
  const comp = components(ed), W = ed.map.width, a = comp.lblLand[tyA * W + txA], b = comp.lblLand[tyB * W + txB];
  if (a < 0 || b < 0) return { err: '两个点都要落在陆地上' };
  if (a === b) return { err: '两点在同一块陆地上' };
  return gapBetween(comp, a, b, 80) || { err: '相距超过 80 格' };
}

// ---------------- 连通图叠加 ----------------
export function connectTint() {
  const comp = components(ed), n = comp.W * comp.H, col = new Uint32Array(n), rgba = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const pal = []; for (let i = 0; i < comp.land.length; i++) { const k = (i * 137) % 360; const c = document.createElement('canvas').getContext('2d'); c.fillStyle = `hsl(${k} 80% 60%)`; const s = c.fillStyle; const v = parseInt(s.slice(1), 16); pal.push(rgba((v >> 16) & 255, (v >> 8) & 255, v & 255, 150)); }
  for (let i = 0; i < n; i++) {
    const l = comp.lblLand[i]; if (l >= 0) { col[i] = l === comp.mainLand.id ? rgba(80, 200, 80, 70) : (comp.land[l].area >= 40 ? pal[l] : rgba(255, 255, 255, 60)); continue; }
    const w = comp.lblWater[i]; if (w >= 0 && w !== comp.ocean.id && comp.water[w].area < 400) col[i] = rgba(255, 0, 0, 170);
  }
  return (i) => col[i];
}

// ---------------- 地形整形 ----------------
export function removeFragments(minArea = 12) {
  const W = ed.map.width, H = ed.map.height, cells = cellsOf();
  const ch = mergeSmall(cells, W, H, () => minArea);
  if (!ch) return 0;
  ed.beginWhole('清除碎片'); applyCells(ed, cells, ed.op); ed.commit(); return ch;
}
export function edgeWall(width = 5, fade = 4, wallT = 'Cliff', fadeT = 'Dirt', edges = 'lt') {
  const W = ed.map.width, H = ed.map.height, cells = cellsOf(), wall = T(wallT), fd = T(fadeT);
  if (wall < 0 || fd < 0) throw new Error('图块集里没有对应地形');
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.min(edges.includes('l') ? x : 1e9, edges.includes('t') ? y : 1e9, edges.includes('r') ? W - 1 - x : 1e9, edges.includes('b') ? H - 1 - y : 1e9);
    const i = y * W + x; if (isWaterCell(cells[i])) continue;
    if (d < width) { cells[i] = wall; n++; } else if (d < width + fade && !['Cliff', 'Dirt Cliff'].includes(ed.engine.names[cells[i]])) { cells[i] = fd; n++; }
  }
  ed.beginWhole('边缘墙'); applyCells(ed, cells, ed.op); ed.commit(); return n;
}
// A 与 B 交界处：A 一侧 depth 格内按渐变概率换成 mix
export function blendBand(aName, bName, mixName, depth = 3) {
  const W = ed.map.width, H = ed.map.height, cells = cellsOf(), a = T(aName), b = T(bName), mx = T(mixName);
  if (a < 0 || b < 0 || mx < 0) throw new Error('图块集里没有对应地形');
  const isB = new Uint8Array(W * H); for (let i = 0; i < isB.length; i++) isB[i] = cells[i] === b ? 1 : 0;
  let cur = isB, n = 0;
  const h2 = (x, y) => { let v = (x * 374761393 + y * 668265263) | 0; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  for (let k = 1; k <= depth; k++) {
    const nxt = dilate(cur, W, H, 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (nxt[i] && !cur[i] && cells[i] === a && h2(x, y) < 1 - (k - 1) / depth) { cells[i] = mx; n++; } }
    cur = nxt;
  }
  if (!n) return 0;
  ed.beginWhole('过渡带'); applyCells(ed, cells, ed.op); ed.commit(); return n;
}
export function isolateAt(tx, ty, gap = 12) {
  const W = ed.map.width, H = ed.map.height, comp = components(ed), id = comp.lblLand[ty * W + tx];
  if (id < 0) throw new Error('请点在陆地上');
  const mask = new Uint8Array(W * H); for (let i = 0; i < mask.length; i++) if (comp.lblLand[i] === id) mask[i] = 1;
  // 取包围盒内与该块“粘连”的陆地：按腐蚀后的核心判断不了，这里直接以该连通块为岛，挖掉周围 gap 格内别的陆地
  const cells = cellsOf(), water = T('Water'), shallow = T('Shallow Water');
  const core = dilate(mask, W, H, 1), band = dilate(core, W, H, gap); let carved = 0;
  for (let i = 0; i < cells.length; i++) if (band[i] && !core[i] && !isWaterCell(cells[i])) { cells[i] = water; carved++; }
  const near = dilate(core, W, H, 2); for (let i = 0; i < cells.length; i++) if (!mask[i] && near[i] && cells[i] === water && shallow >= 0) cells[i] = shallow;
  ed.beginWhole('隔开岛屿'); applyCells(ed, cells, ed.op); ed.commit(); return carved;
}

// ---------------- 对话框 ----------------
export function geoDialog() {
  const m = ed.map; if (!m) return;
  const cal0 = getCal();
  const inp = (v, w = 70) => h('input', { value: v ?? '', style: { width: w + 'px' } });
  const ta = (v, rows = 5, ph = '') => h('textarea', { rows, style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' }, placeholder: ph }, v || '');
  let secN = 0;
  const sec = (title, ...kids) => h('details', { open: secN++ === 0 || undefined, style: { borderTop: '1px solid var(--line)', padding: '6px 0' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600, padding: '4px 0' } }, title), h('div', { style: { paddingTop: '4px', lineHeight: 2 } }, ...kids));
  const out = h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', margin: '6px 0 0', maxHeight: '160px', overflow: 'auto' } }, cal0 ? `已有校准：${cal0.deg === 2 ? '2 次' : '仿射'}，误差 ${cal0.rmse.toFixed(2)} 格` : '尚未校准');
  const say = (t) => { out.textContent = t; };
  // 校准
  const pts = ta((A.geoPts || (cal0 && cal0.pts) || []).map((p) => `${p.lon},${p.lat},${p.tx},${p.ty}`).join('\n'), 5, '经度,纬度,格x,格y  每行一个点（≥3 个，≥8 个用 2 次拟合）');
  const bFit = h('button', { class: 'primary', onclick: () => { try { const ps = pts.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [lon, lat, tx, ty] = l.split(/[,\s]+/).map(Number); return { lon, lat, tx, ty }; }); const cal = fitCalibration(ps); saveCal(cal, ps); say(`拟合成功：${cal.deg === 2 ? '2 次多项式' : '仿射'}，${ps.length} 点，均方根误差 ${cal.rmse.toFixed(2)} 格`); } catch (e) { say('失败：' + e.message); } } }, '拟合并保存');
  const gStep = inp(1, 40), bGrid = h('button', { onclick: () => { setGrid(!gridOn, +gStep.value || 1); say(gridOn ? '经纬网已开启' : '经纬网已关闭'); } }, '开/关经纬网');
  // 画岛
  const poly = ta('', 5, '粘贴 GeoJSON，或每行“经度,纬度”（多个岛之间空一行）');
  const fillSel = select([['Grass', '草地'], ['Dirt', '泥土'], ['Sand', '沙地'], ['Snow', '雪地']], 'Grass', () => {}, { style: 'width:auto' }), beachSel = select([['Sand', '沙地'], ['Dirt', '泥土'], ['', '不要']], 'Sand', () => {}, { style: 'width:auto' });
  const scaleI = inp(1, 50), gapI = inp(0, 50), beachI = inp(1, 50), smoothI = inp(1, 50);
  const bIsl = h('button', { class: 'primary', onclick: async () => { try { const r = await busy('正在画岛…', async () => paintIsland({ rings: parsePolygons(poly.value), scale: +scaleI.value || 1, fill: fillSel.value, beach: beachSel.value, beachW: +beachI.value || 1, smooth: +smoothI.value || 0, gap: +gapI.value || 0 })); say(`完成：${r.cells} 格${r.carved ? `，挖开海峡 ${r.carved} 格` : ''}（Ctrl+Z 可撤销）`); } catch (e) { say('失败：' + e.message); } } }, '画岛');
  // 城市
  const csv = ta('', 5, '名称,经度,纬度,队伍(从1开始),角色(city|start)\n台北,121.5,25.05,19,city');
  const bCity = h('button', { class: 'primary', onclick: () => { try { const r = placeCities(csv.value); say(r.map((x) => x.err ? `✗ ${x.name}：${x.err}` : `${x.name} → (${x.tx},${x.ty})，偏离 ${x.off.toFixed(1)} 格`).join('\n')); } catch (e) { say('失败：' + e.message); } } }, '放城市');
  // 量测
  const qx = inp('', 50), qy = inp('', 50), qx2 = inp('', 50), qy2 = inp('', 50);
  const bMeas = h('button', { onclick: () => { try { const r = measureAt(+qx.value | 0, +qy.value | 0); say(JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v), 1)); } catch (e) { say('失败：' + e.message); } } }, '量面积/水道宽');
  const bStr = h('button', { onclick: () => { try { say(JSON.stringify(strait(+qx.value | 0, +qy.value | 0, +qx2.value | 0, +qy2.value | 0), null, 1)); } catch (e) { say('失败：' + e.message); } } }, '量海峡最窄处');
  const bCtr = h('button', { onclick: () => { const v = A.rend.view, c = A.rend; const mx = v.ox + c.cw / 2 / v.z, my = v.oy + c.ch / 2 / v.z; qx.value = Math.floor(mx / 20); qy.value = Math.floor(my / 20); } }, '取视图中心为点 1');
  const bConn = h('button', { onclick: () => { A.hooks.setOverlay && A.hooks.setOverlay('connect'); } }, '显示连通图');
  // 规则
  const bRule = (t) => h('button', { onclick: () => { const x = +qx.value | 0, y = +qy.value | 0, rules = getRules(ed); const r = { t, x, y, name: `(${x},${y})` }; if (t === 'width') r.min = 6; if (t === 'minarea') r.min = 400; rules.push(r); setRules(ed, rules); say(`已加入规则 ${t}：(${x},${y})，共 ${rules.length} 条`); } }, { island: '点 1 必须是孤岛', width: '点 1 水道≥6格', coast: '点 1 必须靠海', minarea: '点 1 面积≥400' }[t]);
  // 整形
  const fragI = inp(12, 50), bFrag = h('button', { onclick: async () => { const n = await busy('清理中…', async () => removeFragments(+fragI.value || 12)); say(`合并了 ${n} 格碎片`); } }, '清除碎片');
  const ewI = inp(5, 40), efI = inp(4, 40), bEdge = h('button', { onclick: async () => { const n = await busy('处理中…', async () => edgeWall(+ewI.value || 5, +efI.value || 4)); say(`边缘墙改了 ${n} 格`); } }, '左/上边缘墙');
  const gapR = inp(12, 40), bIso = h('button', { onclick: async () => { try { const n = await busy('隔开中…', async () => isolateAt(+qx.value | 0, +qy.value | 0, +gapR.value || 12)); say(`挖开 ${n} 格（以点 1 所在陆地为岛）`); } catch (e) { say('失败：' + e.message); } } }, '隔开点 1 所在的岛');
  const bBlend = h('button', { onclick: async () => { try { const n = await busy('处理中…', async () => blendBand('Dirt', 'Snow', 'Snow', 4)); say(`过渡带改了 ${n} 格`); } catch (e) { say('失败：' + e.message); } } }, '泥土→雪地 过渡 4 格');
  // 3.3.1 补充整形
  const csR = inp(1, 40), keepC = h('input', { type: 'checkbox' }); keepC.checked = true; keepC.style.width = 'auto';
  const bCoast = h('button', { onclick: async () => { try { const m = await import('./tools331.js'); const n = await busy('平滑中…', async () => m.coastSmooth(+csR.value || 1, { keepCliff: keepC.checked })); say(n ? `海岸平滑改了 ${n} 格（可撤销）` : '没有需要平滑的地方'); } catch (e) { say('失败：' + e.message); } } }, '海岸平滑');
  const rfrom = inp('草地,泥土', 110), rto = inp('沙地', 60), bRep = h('button', { onclick: async () => { try { const m = await import('./tools331.js'); const sel = A.ed.selection; const n = await busy('替换中…', async () => m.replaceKeep(rfrom.value.split(/[,，]/), rto.value, { keepCliff: keepC.checked, rect: sel ? { x0: sel.x0, y0: sel.y0, x1: sel.x1, y1: sel.y1 } : null })); say(`替换了 ${n} 格${sel ? '（仅选区内）' : '（整张图）'}，悬崖${keepC.checked ? '保留' : '也被替换'}`); } catch (e) { say('失败：' + e.message); } } }, '替换');
  const arr = ta('', 4, '地形数组：每行一行格子，逗号分隔，可写英文名/中文名/序号；JSON 二维数组也行。空格子保持原样'), ax = inp(0, 40), ay = inp(0, 40);
  const bImp = h('button', { onclick: async () => { try { const m = await import('./tools331.js'); const r = await busy('导入中…', async () => m.importTerrain(arr.value, { x0: +ax.value | 0, y0: +ay.value | 0 })); say(`导入 ${r.size[0]}×${r.size[1]}，改了 ${r.changed} 格`); } catch (e) { say('失败：' + e.message); } } }, '导入');
  const body = h('div', { style: { minWidth: '520px' } },
    sec('1 校准', pts, h('div', {}, bFit, ' 网格间隔(度)：', gStep, ' ', bGrid)),
    sec('2 按海岸线画岛', poly, h('div', {}, '填充 ', fillSel, ' 沙滩 ', beachSel, ' 宽 ', beachI, ' 平滑 ', smoothI, ' 缩放 ', scaleI, ' 隔开海峡 ', gapI, ' 格 ', bIsl)),
    sec('3 按表格放城市', csv, h('div', {}, bCity)),
    sec('4 量测 / 规则（点 1、点 2 为格坐标）', h('div', {}, 'x1 ', qx, ' y1 ', qy, ' x2 ', qx2, ' y2 ', qy2, ' ', bCtr), h('div', {}, bMeas, ' ', bStr, ' ', bConn), h('div', {}, bRule('island'), ' ', bRule('width'), ' ', bRule('coast'), ' ', bRule('minarea'))),
    sec('5 整形', h('div', {}, '碎片小于 ', fragI, ' 格 ', bFrag), h('div', {}, '墙宽 ', ewI, ' 渐变 ', efI, ' ', bEdge), h('div', {}, '海峡宽 ', gapR, ' ', bIso, ' ', bBlend)),
    sec('6 海岸 / 替换 / 导入', h('div', {}, '平滑圈数 ', csR, ' ', bCoast, ' ', h('span', { style: 'display:inline-flex;gap:4px;align-items:center' }, keepC, '保留悬崖')), h('div', {}, '把 ', rfrom, ' 换成 ', rto, ' ', bRep, '（有选区只换选区）'), arr, h('div', {}, '放在 x ', ax, ' y ', ay, ' ', bImp)),
    out);
  modal('地理工具', body, [{ label: '关闭' }], { wide: true });
}
