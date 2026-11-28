// 用浅水把日本列岛、印尼相邻岛屿连起来(只把深水改成浅水,陆地/悬崖/单位不动)
// 用法: node bridge.mjs in.tmx out.tmx [--dry]
import fs from 'fs';
const K = '/home/claude/rw-map-editor/kit/';
const { parseTmx, passability, terrainClasses, LAND, unitsOf } = await import(K + 'tmx.js');
const { setLayer, findGids } = await import(K + 'mapops.js');
const [inp, out] = process.argv.slice(2); const dry = process.argv.includes('--dry');
const text = fs.readFileSync(inp, 'utf8'); const M = parseTmx(text); const W = M.width, H = M.height;
const P = passability(M), T = terrainClasses(M).data; const g = findGids(M);
const C = JSON.parse(fs.readFileSync('/home/claude/wg/out/asia_cities.json', 'utf8'));
// 陆地连通块
const lab = new Int32Array(W * H).fill(-1); const comps = [];
for (let i = 0; i < W * H; i++) if (lab[i] < 0 && (P[i] & LAND)) { const q = [i]; lab[i] = comps.length; for (let h = 0; h < q.length; h++) { const k = q[h], x = k % W, y = (k / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (lab[j] < 0 && (P[j] & LAND)) { lab[j] = lab[i]; q.push(j); } } } comps.push({ id: comps.length, cells: q }); }
const compOf = (x, y) => { for (let r = 0; r < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && lab[Y * W + X] >= 0) return lab[Y * W + X]; } return -1; };
// 岸线格(陆地且四邻有水)
const shore = (c) => c.cells.filter((k) => { const x = k % W, y = (k / W) | 0; return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < W && Y < H && !(P[Y * W + X] & LAND); }); });
function closest(a, b) { const A = shore(comps[a]), B = shore(comps[b]); let best = null; const step = Math.max(1, Math.floor(A.length * B.length / 4e6)); for (let i = 0; i < A.length; i += step) { const ax = A[i] % W, ay = (A[i] / W) | 0; for (const k of B) { const bx = k % W, by = (k / W) | 0; const d = Math.hypot(ax - bx, ay - by); if (!best || d < best.d) best = { d, a: [ax, ay], b: [bx, by] }; } } return best; }
function group(owners, extraBox) {
  const ids = new Set(); for (const q of C) if (owners.includes(q.owner)) { const c = compOf(q.px, q.py); if (c >= 0) ids.add(c); }
  if (extraBox) { const [x0, y0, x1, y1] = extraBox; for (const c of comps) { if (c.cells.length < 150) continue; const k = c.cells[0]; let inb = 0; for (let i = 0; i < c.cells.length; i += 7) { const x = c.cells[i] % W, y = (c.cells[i] / W) | 0; if (x >= x0 && x <= x1 && y >= y0 && y <= y1) inb++; } if (inb > c.cells.length / 14) ids.add(c.id); void k; } }
  return [...ids];
}
// MST(Prim),只接距离 <= maxD 的边
function mst(ids, maxD) { const E = []; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const r = closest(ids[i], ids[j]); if (r) E.push({ i: ids[i], j: ids[j], ...r }); } E.sort((a, b) => a.d - b.d); const par = new Map(ids.map((x) => [x, x])); const f = (x) => (par.get(x) === x ? x : (par.set(x, f(par.get(x))), par.get(x))); const pick = []; for (const e of E) { if (e.d > maxD) continue; if (f(e.i) !== f(e.j)) { par.set(f(e.i), f(e.j)); pick.push(e); } } return { pick, all: E }; }
const d = Uint32Array.from(M.layers.ground.data); let painted = 0;
const units = unitsOf(M).map((o) => [Math.floor((o.x + 10) / 20), Math.floor((o.y + 10) / 20)]); const nearUnit = new Set(); for (const [ux, uy] of units) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nearUnit.add((uy + dy) * W + ux + dx);
function paint(a, b, w) { const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1); const r = w / 2; for (let s = 0; s <= n; s++) { const cx = a[0] + (b[0] - a[0]) * s / n, cy = a[1] + (b[1] - a[1]) * s / n; for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) { if (dx * dx + dy * dy > r * r + 0.5) continue; const X = Math.round(cx + dx), Y = Math.round(cy + dy); if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const i = Y * W + X; if (T[i] === 1 && d[i] !== 56 && !nearUnit.has(i)) { d[i] = 56; painted++; } } } }
const report = [];
const name = (id) => { const hit = C.filter((q) => compOf(q.px, q.py) === id).map((q) => q.zh); return (hit.slice(0, 3).join('/') || '无城小岛') + `(${comps[id].cells.length}格)`; };
for (const [lbl, owners, box, maxD] of [['日本', [1], [740, 0, 990, 200], 40], ['印尼', [13], [370, 480, 720, 700], 22]]) {
  const ids = group(owners, box); const { pick, all } = mst(ids, maxD);
  for (const e of pick) { paint(e.a, e.b, 7); report.push(`${lbl}: ${name(e.i)} ⇄ ${name(e.j)} 间距 ${e.d.toFixed(1)} 格 已连`); }
  const skipped = all.filter((e) => e.d > maxD).sort((a, b) => a.d - b.d).slice(0, 6); for (const e of skipped) report.push(`${lbl}: ${name(e.i)} ⇄ ${name(e.j)} 间距 ${e.d.toFixed(1)} 格 太远,未连`);
}
console.log(report.join('\n')); console.log('改成浅水的格数', painted);
const hitUnit = unitsOf(M).filter((o) => { const x = Math.floor((o.x + 10) / 20), y = Math.floor((o.y + 10) / 20); return x >= 0 && y >= 0 && x < W && y < H && d[y * W + x] !== M.layers.ground.data[y * W + x]; }); console.log('压到单位的格', hitUnit.length, hitUnit.map((o) => (o.props.unit || o.name) + '@' + Math.floor(o.x / 20) + ',' + Math.floor(o.y / 20) + ' t' + o.props.team).join(' '));
if (!dry) fs.writeFileSync(out, setLayer(text, 'Ground', d));
