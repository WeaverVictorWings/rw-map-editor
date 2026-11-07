// 3.3.1：地形整形补充 —— 统一地形名解析、海岸平滑、保留悬崖的替换、地形数组导入、
// 鼠标处宽度提示（河宽 / 过细陆地）、给城市补资源池、按区域批量截图
import { A } from './state.js';
import { TERRAIN_CN } from './terrain.js';
import { applyCells } from './terraform.js';
import { cellsOf, isWaterCell } from './geo.js';
import { renderFlat } from './shot.js';
import { regions } from './regions.js';
import { cities } from './capture.js';
import { passability, BUILD } from './pathing.js';
import { saveFile } from './files.js';
import { writeZip } from './zip.js';

const ed = A.ed;

// ---- 统一地形名：英文原名 / 中文名 / 大小写 / 空格下划线 / 别名 / 数字序号 都认 ----
const ALIAS = { 草: 'Grass', 草地: 'Grass', 泥: 'Dirt', 土: 'Dirt', 泥土: 'Dirt', 沙: 'Sand', 沙地: 'Sand', 雪: 'Snow', 雪地: 'Snow', 水: 'Water', 浅水: 'Shallow Water', 深水: 'Deep Water', 悬崖: 'Cliff', 山: 'Cliff', 湖: 'Lake', 冰: 'Ice', 沼泽: 'Swamp', 岩浆: 'Lava', 树: 'Tree', 树林: 'Tree', 森林: 'Tree', 'shallow': 'Shallow Water', 'deep': 'Deep Water', 'dirtcliff': 'Dirt Cliff', 'icelake': 'Ice Lake', 'frozentrees': 'Frozen Trees', 'waterbridge': 'Water Bridge' };
export function resolveTerrain(token, eng = ed.engine) {
  const t = String(token).trim(); if (t === '') return -1;
  if (/^\d+$/.test(t)) { const i = +t; return i < eng.names.length ? i : -1; }
  const norm = (s) => s.toLowerCase().replace(/[\s_\-]/g, '');
  const want = ALIAS[t] || ALIAS[norm(t)] || t;
  let i = eng.names.indexOf(want); if (i >= 0) return i;
  i = eng.names.findIndex((n) => norm(n) === norm(want)); if (i >= 0) return i;
  i = eng.names.findIndex((n) => TERRAIN_CN[n] === t); return i;
}
export function terrainList(eng = ed.engine) { return eng.names.map((n, i) => ({ i, name: n, cn: TERRAIN_CN[n] || n })); }

// ---- 海岸平滑：把陆/水掩码做 r 圈多数表决。返回改动格数 ----
export function coastSmooth(r = 1, { keepCliff = true } = {}) {
  const W = ed.map.width, H = ed.map.height, cells = cellsOf(), names = ed.engine.names, n = W * H;
  const land = new Uint8Array(n); for (let i = 0; i < n; i++) land[i] = isWaterCell(cells[i]) ? 0 : 1;
  const cur = new Uint8Array(land), sm = new Uint8Array(n);
  for (let pass = 0; pass < r; pass++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; s += cur[Y * W + X]; c++; }
      sm[y * W + x] = s * 2 > c ? 1 : (s * 2 < c ? 0 : cur[y * W + x]);
    }
    cur.set(sm);
  }
  const sand = resolveTerrain('Sand'), grass = resolveTerrain('Grass'), shallow = resolveTerrain('Shallow Water'), water = resolveTerrain('Water');
  let ch = 0; const out = new Uint8Array(cells);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (cur[i] === land[i]) continue;
    if (keepCliff && !isWaterCell(cells[i]) && /Cliff/.test(names[cells[i]])) continue;
    if (cur[i]) { // 水→陆：取邻居里最常见的陆地地形，没有就用沙
      const cnt = new Map(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const c = cells[Y * W + X]; if (!isWaterCell(c)) cnt.set(c, (cnt.get(c) || 0) + 1); }
      let best = -1, bn = 0; for (const [c, k] of cnt) if (k > bn) { bn = k; best = c; }
      out[i] = best >= 0 ? best : (sand >= 0 ? sand : grass);
    } else { // 陆→水：贴岸浅水，否则水
      out[i] = shallow >= 0 ? shallow : water;
    }
    ch++;
  }
  if (!ch) return 0;
  ed.beginWhole('海岸平滑'); applyCells(ed, out, ed.op); ed.commit(); return ch;
}

// ---- 保留悬崖的替换：把 from 里的地形换成 to，rect 可选 {x0,y0,x1,y1}（格）。悬崖默认不动 ----
export function replaceKeep(from, to, { keepCliff = true, keep = [], rect = null } = {}) {
  const W = ed.map.width, H = ed.map.height, cells = cellsOf(), names = ed.engine.names;
  const F = new Set((Array.isArray(from) ? from : [from]).map((f) => resolveTerrain(f))), K = new Set(keep.map((k) => resolveTerrain(k))), T = resolveTerrain(to);
  if (T < 0) throw new Error('不认识目标地形：' + to);
  if (F.has(-1)) throw new Error('有不认识的源地形：' + from);
  const x0 = rect ? rect.x0 : 0, y0 = rect ? rect.y0 : 0, x1 = rect ? rect.x1 : W - 1, y1 = rect ? rect.y1 : H - 1; let ch = 0;
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
    const i = y * W + x, c = cells[i];
    if (!F.has(c) || c === T || K.has(c)) continue;
    if (keepCliff && /Cliff/.test(names[c])) continue;
    cells[i] = T; ch++;
  }
  if (!ch) return 0;
  ed.beginWhole('替换地形（保留悬崖）'); applyCells(ed, cells, ed.op); ed.commit(); return ch;
}

// ---- 地形数组导入：JSON 二维数组，或每行逗号/空格/制表符分隔；元素可是地形英文名、中文名、序号 ----
export function importTerrain(text, { x0 = 0, y0 = 0 } = {}) {
  let rows;
  const t = String(text).trim(); if (!t) throw new Error('没有内容');
  if (t[0] === '[') { try { rows = JSON.parse(t); } catch (e) { throw new Error('JSON 格式错误：' + e.message); } }
  else rows = t.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(/[,\t;]+|\s{2,}/).map((s) => s.trim()));
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) throw new Error('需要二维数组：每行一行格子');
  const W = ed.map.width, H = ed.map.height, cells = cellsOf(); let ch = 0; const bad = new Map();
  const w = Math.max(...rows.map((r) => r.length));
  if (x0 + w > W || y0 + rows.length > H) throw new Error(`导入 ${w}×${rows.length} 格，放在 (${x0},${y0}) 会超出地图 ${W}×${H}，请先调整画布大小或偏移`);
  rows.forEach((r, j) => r.forEach((tok, i) => {
    if (tok === null || tok === '' || tok === undefined) return; // 空格子 = 保持原样
    const id = resolveTerrain(tok); if (id < 0) { bad.set(String(tok), (bad.get(String(tok)) || 0) + 1); return; }
    const k = (y0 + j) * W + x0 + i; if (cells[k] !== id) { cells[k] = id; ch++; }
  }));
  if (bad.size) throw new Error('有不认识的地形：' + [...bad].slice(0, 6).map(([k, v]) => `${k}×${v}`).join('、') + '（可用：' + ed.engine.names.map((n) => (TERRAIN_CN[n] ? n + '/' + TERRAIN_CN[n] : n)).join('、') + '）');
  if (ch) { ed.beginWhole('导入地形数组'); applyCells(ed, cells, ed.op); ed.commit(); }
  return { changed: ch, size: [w, rows.length] };
}

// ---- 鼠标处宽度提示（状态栏用）：水 = 水道宽；陆 = 只在很窄时提示 ----
export function widthHint(tx, ty) {
  const m = ed.map, eng = ed.engine; if (!m || !eng) return '';
  const W = m.width, H = m.height, W1 = eng.W1, V = eng.V;
  const cellAt = (x, y) => { const a = V[y * W1 + x], b = V[y * W1 + x + 1], c = V[(y + 1) * W1 + x], d = V[(y + 1) * W1 + x + 1]; return (a === b || a === c || a === d) ? a : (b === c || b === d ? b : (c === d ? c : a)); };
  if (tx < 2 || ty < 2 || tx >= W - 2 || ty >= H - 2) return '';
  const w0 = isWaterCell(cellAt(tx, ty)), CAP = 16;
  const run = (dx, dy) => { let n = 1; for (const s of [1, -1]) for (let k = 1; k <= CAP; k++) { const X = tx + dx * k * s, Y = ty + dy * k * s; if (X < 0 || Y < 0 || X >= W || Y >= H || isWaterCell(cellAt(X, Y)) !== w0) break; n++; } return n; };
  const wd = Math.min(run(1, 0), run(0, 1), run(1, 1) / 1.4142, run(1, -1) / 1.4142);
  const n = Math.round(wd);
  if (w0) return n <= 14 ? `水道宽约 ${n} 格${n < 12 ? '（<12 大型舰船可能过不去）' : ''}` : '';
  return n <= 2 ? `⚠ 这里陆地只有约 ${n} 格宽，容易被判成碎地或走不通` : '';
}

// ---- 给每个城市补资源池：绕城市 3~7 格找可建造的空格，隔开已有的池 ----
export function addCityPools(perCity = 1, { gap = 2 } = {}) {
  const pool = ed.items.find((i) => i.pool); if (!pool) throw new Error('这张地图没有资源池图块可用');
  const W = ed.map.width, H = ed.map.height, L = ed.map.ensureLayer('Items'), pass = passability(ed), cs = cities();
  if (!cs.length) throw new Error('没有标成“城市”的指挥中心');
  const cellsP = ed.stampCells(pool), gids = ed.poolGids || new Set();
  const free = (x, y) => { for (const [dx, dy] of cellsP) { const X = x + dx, Y = y + dy; if (X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1) return false; const i = Y * W + X; if (!(pass[i] & BUILD) || L.data[i]) return false; } for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && gids.has(L.data[Y * W + X])) return false; } return true; };
  let placed = 0, missed = [];
  ed.begin('给城市补资源池');
  for (const c of cs) {
    const tx = Math.floor(c.cx / 20), ty = Math.floor(c.cy / 20); let got = 0;
    for (let r = 3; r <= 7 && got < perCity; r++) for (let k = 0; k < 32 && got < perCity; k++) {
      const a = (k / 32) * Math.PI * 2 + c.team, x = Math.round(tx + Math.cos(a) * r), y = Math.round(ty + Math.sin(a) * r);
      if (free(x, y)) { for (const [dx, dy, g] of ed.stampCells(pool)) ed.setTile(L, x + dx, y + dy, g); got++; placed++; }
    }
    if (got < perCity) missed.push(`(${tx},${ty})`);
  }
  ed.commit(); return { placed, missed };
}

// ---- 按区域批量截图：区域来自触发器里的“区域”对象，或手工给的矩形 ----
export async function shotRegions({ scale = 2, names = null, marks = true, grid = false, rects = null, asZip = true } = {}) {
  const m = ed.map, TW = m.tw || 20, TH = m.th || 20;
  const list = rects || regions().filter((r) => !names || names.includes(r.name)).map((r) => ({ name: r.name, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }));
  if (!list.length) throw new Error('没有可截的区域（先在触发器里画区域，或手工给矩形）');
  const { cv, scale: s } = renderFlat(ed, A.rend, { scale, grid, marks });
  const files = [];
  for (const r of list) {
    const x = Math.max(0, r.x0) * TW * s, y = Math.max(0, r.y0) * TH * s, w = (Math.min(m.width - 1, r.x1) - Math.max(0, r.x0) + 1) * TW * s, hh = (Math.min(m.height - 1, r.y1) - Math.max(0, r.y0) + 1) * TH * s;
    if (w < 1 || hh < 1) continue;
    const c = new OffscreenCanvas(Math.round(w), Math.round(hh)); c.getContext('2d').drawImage(cv, x, y, w, hh, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: 'image/png' });
    files.push({ name: `${A.mapName}_${String(r.name).replace(/[\\/:*?"<>|]/g, '_')}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  if (!files.length) throw new Error('区域都在地图外');
  if (asZip && files.length > 1) { await saveFile(`${A.mapName}_区域截图.zip`, writeZip(files), 'application/zip'); }
  else for (const f of files) await saveFile(f.name, f.data, 'image/png');
  return files.length;
}
