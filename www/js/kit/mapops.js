// RWKit · 改地形/导入/道路/配色等"会写地图"的操作。都返回新的 TMX 文本,不改原文件。
// 图层写回沿用原文件的编码(base64+zlib/gzip 或 csv),不改变游戏读取方式。
const zlib = (typeof process !== 'undefined' && process.versions && process.versions.node) ? (await import('node:zlib')).default : null;   // 浏览器里没有:图层写回功能仅命令行可用
import { parseTmx, tileProps, passability, LAND, NAVAL, BUILD, unitsOf, triggersOf, trigKey, TRIGGER_TYPES } from './tmx.js';
import { SLOT_COL, slotColor } from './teams.js';
export function encodeLayer(data, enc, comp) {
  if (enc === 'csv') return data.join(',');
  if (!zlib) throw new Error('图层写回只在命令行(Node)里可用');
  const buf = Buffer.alloc(data.length * 4); for (let i = 0; i < data.length; i++) buf.writeUInt32LE(data[i] >>> 0, i * 4);
  const z = comp === 'zlib' ? zlib.deflateSync(buf) : comp === 'gzip' ? zlib.gzipSync(buf) : buf; return z.toString('base64');
}
export function setLayer(text, name, data) {
  const re = new RegExp(`(<layer\\s+[^>]*name="${name}"[^>]*>\\s*<data\\s+)([^>]*)(>)([\\s\\S]*?)(</data>)`, 'i'); const m = text.match(re); if (!m) throw new Error(`找不到图层 ${name}`);
  const enc = (m[2].match(/encoding="(\w+)"/) || [])[1], comp = (m[2].match(/compression="(\w+)"/) || [])[1];
  return text.replace(re, (_, a, b, c, d, e) => a + b + c + (enc === 'csv' ? '\n' : '') + encodeLayer(data, enc, comp) + (enc === 'csv' ? '\n' : '') + e);
}
// 找一个"水"和一个"普通陆地"图块 gid(按图块属性)
export function findGids(model) { let water = null, land = null, shallow = null; for (const ts of model.tilesets) for (const [id, p] of ts.tiles) { const g = ts.firstgid + id; if ('water' in p && !('water-bridge' in p) && water === null) water = g; if ('water-bridge' in p && shallow === null) shallow = g; } for (const ts of model.tilesets) { if (land === null && ts.tilecount) { for (let id = 0; id < ts.tilecount; id++) { const p = ts.tiles.get(id) || {}; if (!Object.keys(p).some((k) => /water|lava|cliff|block/.test(k))) { land = ts.firstgid + id; break; } } } } return { water, land, shallow }; }
// ---- GeoJSON 导入:多边形 → 陆地掩码(等距圆柱投影,bbox→整图);holes 支持 ----
export function rasterizePolygons(geo, W, H, { bbox, proj = 'equirect' } = {}) {
  const polys = []; const add = (g) => { if (g.type === 'Polygon') polys.push(g.coordinates); else if (g.type === 'MultiPolygon') g.coordinates.forEach((c) => polys.push(c)); else if (g.type === 'GeometryCollection') g.geometries.forEach(add); else if (g.type === 'Feature') add(g.geometry); else if (g.type === 'FeatureCollection') g.features.forEach(add); }; add(geo);
  let [lx0, ly0, lx1, ly1] = bbox || [Infinity, Infinity, -Infinity, -Infinity]; if (!bbox) for (const p of polys) for (const ring of p) for (const [x, y] of ring) { lx0 = Math.min(lx0, x); lx1 = Math.max(lx1, x); ly0 = Math.min(ly0, y); ly1 = Math.max(ly1, y); }
  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)); const py = proj === 'mercator' ? mercY : (v) => v;
  const X = (lon) => ((lon - lx0) / (lx1 - lx0)) * W, Y = (lat) => ((py(ly1) - py(lat)) / (py(ly1) - py(ly0))) * H; const mask = new Uint8Array(W * H);
  for (const p of polys) { const rings = p.map((r) => r.map(([lon, lat]) => [X(lon), Y(lat)])); for (let y = 0; y < H; y++) { const xs = []; for (const r of rings) for (let i = 0; i < r.length - 1; i++) { const [ax, ay] = r[i], [bx, by] = r[i + 1]; const yy = y + 0.5; if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) xs.push(ax + ((yy - ay) / (by - ay)) * (bx - ax)); } xs.sort((a, b) => a - b); for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.max(0, Math.ceil(xs[i] - 0.5)); x < Math.min(W, Math.ceil(xs[i + 1] - 0.5)); x++) mask[y * W + x] ^= 1; } }
  return { mask, bbox: [lx0, ly0, lx1, ly1] };
}
export function paintMask(text, mask, { land, water } = {}) { const model = parseTmx(text); const g = findGids(model); const L = land ?? g.land, Wt = water ?? g.water; if (!L || !Wt) throw new Error('找不到陆地/水图块,请用 --land/--water 指定 gid'); const d = Uint32Array.from(model.layers.ground.data); for (let i = 0; i < d.length; i++) d[i] = mask[i] ? L : Wt; return setLayer(text, 'ground', d); }
// ---- 海岸线平滑:对"水/陆"二值图做多数滤波,去掉锯齿和单格毛刺;只改 water↔land 的普通格,不动悬崖/岩浆/桥 ----
export function smoothCoast(text, { rounds = 1 } = {}) {
  const model = parseTmx(text); const { width: W, height: H } = model; const gid = findGids(model); const G = Uint32Array.from(model.layers.ground.data); const cls = (g) => { const p = tileProps(model, g) || {}; if ('water' in p && !('water-bridge' in p)) return 1; if (Object.keys(p).some((k) => /lava|cliff|block|water-bridge/.test(k))) return 2; return 0; };
  let changed = 0; for (let r = 0; r < rounds; r++) { const C = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) C[i] = cls(G[i]); const next = Uint32Array.from(G); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (C[i] === 2) continue; let w = 0, l = 0, o = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const c = C[(y + dy) * W + x + dx]; if (c === 1) w++; else if (c === 0) l++; else o++; } if (C[i] === 0 && w >= 6) { next[i] = gid.water; changed++; } else if (C[i] === 1 && l >= 6) { next[i] = gid.land; changed++; } } G.set(next); }
  return { text: setLayer(text, 'ground', G), changed };
}
// ---- 区域覆盖:把 box 内"可建造的普通格"换成指定 gid(例如墨西哥用普通地形)。onlyIf: 'lava'|'cliff'|'all' ----
export function overrideBox(text, [x0, y0, x1, y1], gid, { onlyIf = 'all' } = {}) { const model = parseTmx(text); const d = Uint32Array.from(model.layers.ground.data); let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * model.width + x; const p = tileProps(model, d[i]) || {}; const hit = onlyIf === 'all' || (onlyIf === 'lava' && 'lava' in p) || (onlyIf === 'cliff' && Object.keys(p).some((k) => /cliff/.test(k))); if (hit && d[i] !== gid) { d[i] = gid; n++; } } return { text: setLayer(text, 'ground', d), changed: n }; }
// ---- 道路:在陆地上找 a→b 的最短路(A*,避开不可通行/悬崖),返回路径;paintRoad 把路径铺成指定图块(用户指定 gid) ----
export function findPath(model, a, b, { flag = LAND } = {}) { const P = passability(model); const { width: W, height: H } = model; const idx = (x, y) => y * W + x; const g = new Float32Array(W * H).fill(1e9); const from = new Int32Array(W * H).fill(-1); const open = [[0, a[0], a[1]]]; g[idx(...a)] = 0; const h = (x, y) => Math.abs(x - b[0]) + Math.abs(y - b[1]);
  while (open.length) { open.sort((p, q) => p[0] - q[0]); const [, x, y] = open.shift(); if (x === b[0] && y === b[1]) { const path = []; for (let k = idx(x, y); k >= 0; k = from[k]) path.push([k % W, (k / W) | 0]); return path.reverse(); } for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || !(P[idx(X, Y)] & flag)) continue; const ng = g[idx(x, y)] + 1; if (ng < g[idx(X, Y)]) { g[idx(X, Y)] = ng; from[idx(X, Y)] = idx(x, y); open.push([ng + h(X, Y), X, Y]); } } } return null; }
export function paintRoad(text, path, gid) { const model = parseTmx(text); const d = Uint32Array.from(model.layers.ground.data); for (const [x, y] of path) d[y * model.width + x] = gid; return setLayer(text, 'ground', d); }
// ---- 队伍配色助手:相邻(最近指挥中心距离近)的队伍尽量用差异大的颜色 ----
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); const cd = (a, b) => { const x = hex(a), y = hex(b); return Math.hypot(...x.map((v, i) => v - y[i])); };
export function colorAssign(model, { colors = SLOT_COL.slice(), fixed = {} } = {}) {
  const cc = unitsOf(model).filter((u) => u.props.unit === 'commandCenter' && +u.props.team >= 0); const teams = [...new Set(cc.map((u) => +u.props.team))]; const adj = new Map(teams.map((t) => [t, new Map()]));
  for (const a of cc) for (const b of cc) if (a.props.team !== b.props.team) { const d = Math.hypot(a.x - b.x, a.y - b.y) / model.tw; const A = adj.get(+a.props.team); A.set(+b.props.team, Math.min(A.get(+b.props.team) ?? 1e9, d)); }
  const order = teams.slice().sort((p, q) => adj.get(q).size - adj.get(p).size); const res = { ...fixed }; const free = colors.filter((c) => !Object.values(fixed).includes(c));
  for (const t of order) { if (res[t]) continue; let best = null, bs = -1; for (const c of free) { let s = 1e9; for (const [u, d] of adj.get(t)) if (res[u]) s = Math.min(s, cd(c, res[u]) * (1 + 6 / Math.max(d, 1))); if (s > bs) { bs = s; best = c; } } res[t] = best; free.splice(free.indexOf(best), 1); if (!free.length) free.push(...colors); }
  return res;
}
// ---- 文字颜色与队伍色一致性:消息的来源检测带 team=T 而文字色不是 T 号队颜色 → 提示 ----
export function lintTeamColors(model, colorOf = slotColor) {
  const out = []; const by = new Map(); for (const o of triggersOf(model)) by.set(trigKey(o), o);
  for (const o of triggersOf(model)) { const c = o.props.globalMessage_textColor; if (!c || !o.props.activatedBy) continue; const src = o.props.activatedBy.split(',').map((k) => by.get(k.trim())).find((x) => x && x.props.team !== undefined && +x.props.team >= 0); if (!src) continue; const want = colorOf(+src.props.team); if (typeof want === 'string' && want.startsWith('#') && c.toLowerCase() !== want.toLowerCase()) out.push({ sev: 'info', code: 'T08', msg: `文字色 ${c} 与来源检测的队伍(${src.props.team} 号,${want})不一致`, key: trigKey(o) }); }
  return out;
}
// ---- 奖励曲线:各队所有 changeCredits 的总额与触发条件(按来源检测的 minUnits 排序) ----
export function rewardCurve(model) { const by = new Map(); for (const o of triggersOf(model)) by.set(trigKey(o), o); const res = new Map(); for (const o of triggersOf(model)) if (o.type.toLowerCase() === 'changecredits' && o.props.add) { const t = +o.props.team; const src = (o.props.activatedBy || '').split(',').map((k) => by.get(k.trim())).find(Boolean); const need = src?.props.minUnits ? +src.props.minUnits : null; if (!res.has(t)) res.set(t, []); res.get(t).push({ key: trigKey(o), add: +o.props.add, needCities: need }); } return [...res].map(([team, rows]) => ({ team, total: rows.reduce((s, r) => s + r.add, 0), rows: rows.sort((a, b) => (a.needCities ?? 0) - (b.needCities ?? 0)) })).sort((a, b) => a.team - b.team); }
// ---- 比例尺 ----
export const scale = (model, kmPerCell) => ({ widthKm: Math.round(model.width * kmPerCell), heightKm: Math.round(model.height * kmPerCell), cellsPer100km: +(100 / kmPerCell).toFixed(2) });
