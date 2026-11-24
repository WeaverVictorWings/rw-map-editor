// RWKit 3.5 · 地理/地形检查与生成（C51–C70）
// 约定：分析函数只读 model;改图函数返回新的 ground 数据（Uint32Array）,用 applyLayer 写回文本。
// 重要:RW 的陆军能走「陆地 + 浅水（water-bridge）」，所以"两块陆地是否相连"必须用 LAND 标志（陆+浅水）判断，
//      只靠浅水相连的两块陆地对陆军来说就是连着的（亚洲图日韩连在一起的根因）。
import { parseTmx, passability, terrainClasses, unitsOf, triggersOf, tileProps, LAND, NAVAL, HOVER, BUILD, FLIP } from './tmx.js';
import { findGids, setLayer } from './mapops.js';

const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const D4 = D8.slice(0, 4);
const cellOf = (model, o) => [Math.floor((o.x + (o.w || 0) / 2) / model.tw), Math.floor((o.y + (o.h || 0) / 2) / model.tw)];

// ---------- 通用：连通块标号 ----------
// mask: Uint8Array(0/1);返回 {lab:Int32Array(-1=不在块内）， comps:[{id,area,cx,cy,bbox}]}
export function labelComps(mask, W, H, { conn = 4, min = 1 } = {}) {
  const lab = new Int32Array(W * H).fill(-1), comps = [], D = conn === 8 ? D8 : D4, q = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    let h = 0, t = 0; q[t++] = s; const id = comps.length; lab[s] = id;
    let sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (h < t) {
      const k = q[h++], x = k % W, y = (k / W) | 0; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const [dx, dy] of D) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (mask[j] && lab[j] < 0) { lab[j] = id; q[t++] = j; } }
    }
    comps.push({ id, area: t, cx: Math.round(sx / t), cy: Math.round(sy / t), bbox: [x0, y0, x1, y1] });
  }
  if (min > 1) { const keep = new Set(comps.filter((c) => c.area >= min).map((c) => c.id)); for (let i = 0; i < lab.length; i++) if (lab[i] >= 0 && !keep.has(lab[i])) lab[i] = -1; return { lab, comps: comps.filter((c) => keep.has(c.id)), all: comps }; }
  return { lab, comps, all: comps };
}
const flagMask = (P, flag, not = 0) => { const m = new Uint8Array(P.length); for (let i = 0; i < P.length; i++) m[i] = (P[i] & flag) && !(P[i] & not) ? 1 : 0; return m; };
export const groundData = (model) => Uint32Array.from(model.layers.ground.data);

// 写回:Node 里保持原编码；浏览器里没有 zlib,改写成 csv（标准 TMX,游戏可读）
export function applyLayer(text, name, data) {
  try { return setLayer(text, name, data); } catch (e) {
    const re = new RegExp(`(<layer\\s+[^>]*name="${name}"[^>]*>\\s*<data)\\s+[^>]*(>)[\\s\\S]*?(</data>)`, 'i');
    if (!re.test(text)) throw e;
    const rows = []; const W = +(text.match(/<map\s+[^>]*?\bwidth="(\d+)"/) || [])[1] || 0;
    if (W) for (let i = 0; i < data.length; i += W) rows.push(Array.from(data.subarray(i, i + W)).join(',')); else rows.push(Array.from(data).join(','));
    return text.replace(re, (_, a, b, c) => `${a} encoding="csv"${b}\n${rows.join(',\n')}\n${c}`);
  }
}

// ---------- C51 仅靠浅水相连的陆块 ----------
// 干地(LAND 且不是浅水）的块，若在"可走（LAND）"意义下属于同一块 → 它们是靠浅水连起来的
export function shallowOnlyLinks(model, { minArea = 200, maxLinks = 40 } = {}) {
  const { width: W, height: H } = model, P = passability(model);
  const dry = flagMask(P, LAND, NAVAL), walk = flagMask(P, LAND);
  const D = labelComps(dry, W, H, { conn: 8, min: minArea }), K = labelComps(walk, W, H, { conn: 8 });
  const byWalk = new Map();
  for (const c of D.comps) { const w = K.lab[c.cy * W + c.cx] >= 0 ? K.lab[c.cy * W + c.cx] : K.lab[findCell(D.lab, c.id, W, H, c.bbox)]; if (!byWalk.has(w)) byWalk.set(w, []); byWalk.get(w).push(c); }
  // 在同一可走块里，对干地块做多源 BFS（只穿过浅水），记录接触点
  const links = [];
  for (const [w, comps] of byWalk) {
    if (comps.length < 2) continue;
    const lab = new Int32Array(W * H).fill(-1), dist = new Int32Array(W * H), q = [];
    for (let i = 0; i < W * H; i++) if (D.lab[i] >= 0 && byWalk.get(w).some((c) => c.id === D.lab[i])) { lab[i] = D.lab[i]; q.push(i); }
    const seen = new Map();
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of D4) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X;
        if (lab[j] < 0) { if (!(P[j] & LAND)) continue; lab[j] = lab[k]; dist[j] = dist[k] + 1; q.push(j); }
        else if (lab[j] !== lab[k]) { const a = Math.min(lab[j], lab[k]), b = Math.max(lab[j], lab[k]), key = a + ',' + b, len = dist[j] + dist[k] + 1; if (!seen.has(key) || len < seen.get(key).len) seen.set(key, { a, b, len, at: [x, y] }); }
      }
    }
    for (const s of seen.values()) { const A = D.comps.find((c) => c.id === s.a), B = D.comps.find((c) => c.id === s.b); links.push({ a: { cx: A.cx, cy: A.cy, area: A.area }, b: { cx: B.cx, cy: B.cy, area: B.area }, shallowLen: s.len, at: s.at }); }
  }
  links.sort((p, q) => q.a.area + q.b.area - (p.a.area + p.b.area));
  return links.slice(0, maxLinks);
}
function findCell(lab, id, W, H, bb) { for (let y = bb[1]; y <= bb[3]; y++) for (let x = bb[0]; x <= bb[2]; x++) if (lab[y * W + x] === id) return y * W + x; return 0; }

// 把"只靠浅水相连"的通道里的浅水格改成深水(只动浅水格,干地不动);一轮不够就扩大半径再来,最多 4 轮
export function cutShallowLinks(model, { minArea = 200, radius = 3, maxRounds = 4 } = {}) {
  const gid = findGids(model).water; if (!gid) throw new Error('找不到深水图块');
  const { width: W, height: H } = model; const d = groundData(model), it = model.layers.items ? Uint32Array.from(model.layers.items.data) : null;
  let cut = 0, rounds = 0, links = shallowOnlyLinks(model, { minArea });
  const view = () => ({ ...model, layers: { ...model.layers, ground: { ...model.layers.ground, data: d }, ...(it ? { items: { ...model.layers.items, data: it } } : {}) } });
  for (; rounds < maxRounds && links.length; rounds++) {
    const P = passability(view());
    for (const l of links) { const [ax, ay] = l.at, r = radius + rounds; for (let y = ay - r; y <= ay + r; y++) for (let x = ax - r; x <= ax + r; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; const k = y * W + x; if ((P[k] & LAND) && (P[k] & NAVAL)) { d[k] = gid; if (it) it[k] = 0; cut++; } } }
    links = shallowOnlyLinks(view(), { minArea });
  }
  return { data: d, items: it, cut, rounds, left: links };
}

// ---------- C52 海峡/分隔带宽度 ----------
// 对"可走（陆+浅水）块"两两求最近距离；返回每对相邻块的最窄处、深水带宽度
export function gapReport(model, { minGap = 12, minArea = 200, minDeep = 0 } = {}) {
  const { width: W, height: H } = model, P = passability(model);
  const K = labelComps(flagMask(P, LAND), W, H, { conn: 8, min: minArea });
  const lab = new Int32Array(W * H).fill(-1), dist = new Int32Array(W * H), src = new Int32Array(W * H), q = new Int32Array(W * H); let t = 0;
  for (let i = 0; i < W * H; i++) if (K.lab[i] >= 0) { lab[i] = K.lab[i]; src[i] = i; q[t++] = i; }
  const pairs = new Map();
  for (let h = 0; h < t; h++) {
    const k = q[h], x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of D8) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X;
      if (lab[j] < 0) { lab[j] = lab[k]; dist[j] = dist[k] + 1; src[j] = src[k]; q[t++] = j; }
      else if (lab[j] !== lab[k]) { const a = Math.min(lab[j], lab[k]), b = Math.max(lab[j], lab[k]), key = a + ',' + b, len = dist[j] + dist[k] + 1; const cur = pairs.get(key); if (!cur || len < cur.gap) pairs.set(key, { a, b, gap: len, pa: lab[k] === a ? src[k] : src[j], pb: lab[k] === a ? src[j] : src[k] }); }
    }
  }
  const out = [];
  for (const p of pairs.values()) {
    const A = K.comps.find((c) => c.id === p.a), B = K.comps.find((c) => c.id === p.b);
    const ax = p.pa % W, ay = (p.pa / W) | 0, bx = p.pb % W, by = (p.pb / W) | 0, n = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    let run = 0, best = 0; for (let i = 0; i <= n; i++) { const x = Math.round(ax + ((bx - ax) * i) / n), y = Math.round(ay + ((by - ay) * i) / n); if (!(P[y * W + x] & LAND)) { run++; best = Math.max(best, run); } else run = 0; }
    const mx = Math.round((ax + bx) / 2), my = Math.round((ay + by) / 2);
    out.push({ a: { cx: A.cx, cy: A.cy, area: A.area }, b: { cx: B.cx, cy: B.cy, area: B.area }, gap: p.gap, deepRun: best, at: [mx, my], from: [ax, ay], to: [bx, by], tooNarrow: p.gap < minGap || (minDeep && best < minDeep) });
  }
  out.sort((p, q) => p.gap - q.gap);
  return { pairs: out, comps: K.comps.length };
}
// 国家/块之间的分隔带不足时，在两块之间开凿深水带（用于修"日韩连着"）：沿最近点连线挖宽 w 的深水
export function widenGap(model, g, { width = 12 } = {}) {
  const gid = findGids(model).water; if (!gid) throw new Error('找不到深水图块');
  const d = groundData(model), { width: W, height: H } = model, [ax, ay] = g.from, [bx, by] = g.to, n = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1), mx = (ax + bx) / 2, my = (ay + by) / 2;
  const nx = (bx - ax) / n, ny = (by - ay) / n; let cut = 0, r = Math.ceil(width / 2) + 2;
  for (let y = Math.floor(my) - r * 2; y <= my + r * 2; y++) for (let x = Math.floor(mx) - r * 2; x <= mx + r * 2; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; const along = (x - mx) * nx + (y - my) * ny; if (Math.abs(along) <= width / 2) { const perp = Math.abs(-(x - mx) * ny + (y - my) * nx); if (perp <= Math.max(g.gap, 4) + r) { if (d[y * W + x] !== gid) { d[y * W + x] = gid; cut++; } } } }
  return { data: d, cut };
}

// 逐圈削岸线:3.5.0 的 widenGap 只在最窄点挖一个口,两岸别处仍然很窄;这个函数改成"两岸各削掉最近的两圈",
// 一轮后最窄处至少 +2,循环到所有相邻块的间距 ≥ minGap。单位/建筑所在格不削(可能因此达不到,返回 left 里列出)。
export function erodeGaps(model, { minGap = 12, minArea = 200, maxRounds = 16, maxCells = 40000, protect = 1 } = {}) {
  const gid = findGids(model).water; if (!gid) throw new Error('找不到深水图块');
  const { width: W, height: H } = model;
  const d = groundData(model), it = model.layers.items ? Uint32Array.from(model.layers.items.data) : null;
  const keep = new Uint8Array(W * H);
  for (const u of unitsOf(model)) { const [cx, cy] = cellOf(model, u); for (let dy = -protect; dy <= protect; dy++) for (let dx = -protect; dx <= protect; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < W && y < H) keep[y * W + x] = 1; } }
  const view = () => ({ ...model, layers: { ...model.layers, ground: { ...model.layers.ground, data: d }, ...(it ? { items: { ...model.layers.items, data: it } } : {}) } });
  let removed = 0, rounds = 0, left = [];
  const dist = new Int16Array(W * H), q = new Int32Array(W * H), touched = [];
  const bfs = (K, id, bb, lim) => { // 从块 id 的格子向外 8 邻域扩 lim 步,返回访问到的格子列表(dist 里是步数)
    let t = 0; for (let y = bb[1]; y <= bb[3]; y++) for (let x = bb[0]; x <= bb[2]; x++) { const k = y * W + x; if (K.lab[k] === id) { dist[k] = 0; q[t++] = k; } }
    touched.length = 0; for (let h = 0; h < t; h++) { const k = q[h], x = k % W, y = (k / W) | 0; touched.push(k); if (dist[k] >= lim) continue;
      for (const [dx, dy] of D8) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (dist[j] === -1) { dist[j] = dist[k] + 1; q[t++] = j; } } }
  };
  dist.fill(-1);
  for (; rounds < maxRounds; rounds++) {
    const m = view(), rep = gapReport(m, { minGap, minArea }), bad = rep.pairs.filter((p) => p.gap < minGap);
    if (!bad.length) { left = []; break; }
    const K = labelComps(flagMask(passability(m), LAND), W, H, { conn: 8, min: minArea });
    const kill = new Uint8Array(W * H); let any = 0; left = [];
    for (const g of bad) {
      const A = K.lab[g.from[1] * W + g.from[0]], B = K.lab[g.to[1] * W + g.to[0]]; if (A < 0 || B < 0) continue;
      const ca = K.comps.find((c) => c.id === A), cb = K.comps.find((c) => c.id === B), r = g.gap + 2;
      for (const [me, other, cm] of [[A, B, cb], [B, A, ca]]) { // 从对面块出发,标出本块里 dist<r 的格子
        const mine = me === A ? ca : cb, pad = r + 1, bb = [Math.max(0, cm.bbox[0] - 0), Math.max(0, cm.bbox[1] - 0), Math.min(W - 1, cm.bbox[2]), Math.min(H - 1, cm.bbox[3])];
        // 只取对面块里离本块外框 pad 之内的格子当种子,避免对整块大陆做全图 BFS
        const sb = [Math.max(bb[0], mine.bbox[0] - pad), Math.max(bb[1], mine.bbox[1] - pad), Math.min(bb[2], mine.bbox[2] + pad), Math.min(bb[3], mine.bbox[3] + pad)];
        if (sb[0] > sb[2] || sb[1] > sb[3]) continue;
        bfs(K, other, sb, r);
        for (const k of touched) { if (K.lab[k] === me && dist[k] > 0 && dist[k] < r) { if (keep[k]) { if (!left.some((l) => l.at[0] === k % W && l.at[1] === ((k / W) | 0))) left.push({ at: [k % W, (k / W) | 0], why: '有单位/建筑' }); } else { kill[k] = 1; } } }
        for (const k of touched) dist[k] = -1;
      }
    }
    let n = 0; for (let i = 0; i < W * H; i++) if (kill[i]) { d[i] = gid; if (it) it[i] = 0; n++; }
    removed += n; any = n;
    if (!any || removed > maxCells) { rounds++; break; }
  }
  const finalRep = gapReport(view(), { minGap, minArea }).pairs.filter((p) => p.gap < minGap);
  return { data: d, items: it, removed, rounds, remaining: finalRep, left, capped: removed > maxCells };
}

// ---------- C53 零碎小岛 ----------
export function smallIslands(model, { maxArea = 120, ignoreWithUnits = true } = {}) {
  const { width: W, height: H } = model, P = passability(model), M = flagMask(P, LAND);
  const K = labelComps(M, W, H, { conn: 8 }); const units = unitsOf(model).map((u) => cellOf(model, u));
  const hasUnit = new Set(units.map(([x, y]) => K.lab[y * W + x]).filter((v) => v >= 0));
  const big = K.comps.filter((c) => c.area > maxArea);
  const small = K.comps.filter((c) => c.area <= maxArea).map((c) => ({ ...c, hasUnit: hasUnit.has(c.id), near: nearestBig(c, big) }));
  return { small: ignoreWithUnits ? small.filter((c) => !c.hasUnit) : small, kept: small.filter((c) => c.hasUnit), lab: K.lab };
}
const nearestBig = (c, big) => { let b = null, bd = 1e9; for (const o of big) { const dx = Math.max(o.bbox[0] - c.cx, 0, c.cx - o.bbox[2]), dy = Math.max(o.bbox[1] - c.cy, 0, c.cy - o.bbox[3]), d = Math.hypot(dx, dy); if (d < bd) { bd = d; b = o; } } return b ? { cx: b.cx, cy: b.cy, d: Math.round(bd) } : null; };
export function removeSmallIslands(model, opt = {}) {
  const r = smallIslands(model, opt), gid = findGids(model).water; if (!gid) throw new Error('找不到深水图块');
  const d = groundData(model); let cells = 0; const drop = new Set(r.small.map((c) => c.id));
  for (let i = 0; i < d.length; i++) if (drop.has(r.lab[i])) { d[i] = gid; cells++; }
  return { data: d, removed: r.small.length, cells, kept: r.kept.length };
}

// ---------- C54 环绕检查 ----------
// 把"不能走船"的格（陆/悬崖/岩浆…）按 8 连通成块；块碰到地图边缘 → 船绕不过去
export function circumnav(model, at, { clearance = 0 } = {}) {
  const { width: W, height: H } = model, P = passability(model);
  let nav = flagMask(P, NAVAL);
  if (clearance > 0) nav = erode(nav, W, H, clearance);
  const non = new Uint8Array(W * H); for (let i = 0; i < non.length; i++) non[i] = nav[i] ? 0 : 1;
  const K = labelComps(non, W, H, { conn: 8 });
  let id = K.lab[at[1] * W + at[0]]; if (id < 0) return { ok: false, reason: '这个点在水里，请点在陆地上' };
  const c = K.comps[id], b = c.bbox, border = []; const edges = [];
  if (b[0] === 0) edges.push('左'); if (b[1] === 0) edges.push('上'); if (b[2] === W - 1) edges.push('右'); if (b[3] === H - 1) edges.push('下');
  if (edges.length) for (let y = b[1]; y <= b[3] && border.length < 6; y++) for (let x = b[0]; x <= b[2] && border.length < 6; x++) if (K.lab[y * W + x] === id && (x === 0 || y === 0 || x === W - 1 || y === H - 1)) border.push([x, y]);
  return { ok: edges.length === 0, area: c.area, bbox: b, touchEdges: edges, borderCells: border, clearance };
}
export function circumnavAll(model, { minArea = 400, clearance = 0 } = {}) {
  const { width: W, height: H } = model, P = passability(model); let nav = flagMask(P, NAVAL); if (clearance > 0) nav = erode(nav, W, H, clearance);
  const non = new Uint8Array(W * H); for (let i = 0; i < non.length; i++) non[i] = nav[i] ? 0 : 1;
  const K = labelComps(non, W, H, { conn: 8, min: minArea });
  return K.comps.map((c) => { const b = c.bbox, edges = []; if (b[0] === 0) edges.push('左'); if (b[1] === 0) edges.push('上'); if (b[2] === W - 1) edges.push('右'); if (b[3] === H - 1) edges.push('下'); return { cx: c.cx, cy: c.cy, area: c.area, ok: !edges.length, touchEdges: edges }; }).sort((a, b) => b.area - a.area);
}
// 把水面向内收 r 格（为了检查大船需要的宽度）
export function erode(mask, W, H, r) {
  let cur = mask;
  for (let n = 0; n < r; n++) { const nx = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!cur[i]) continue; let ok = 1; for (const [dx, dy] of D4) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || !cur[Y * W + X]) { ok = 0; break; } } nx[i] = ok; } cur = nx; }
  return cur;
}

// ---------- C55 港口/舰船能否通到主海 ----------
const SHIPRE = /^(battleShip|heavyBattleShip|destroyer|cruiser|gunboat|missileShip|builderShip|submarine|subMarine|amphibiousBoat|sonarShip|carrier|hovercraft)/i;
const NAVALFAC = /^(seaFactory|navalFactory)/i;
export function portReach(model) {
  const { width: W, height: H } = model, P = passability(model), K = labelComps(flagMask(P, NAVAL, 0), W, H, { conn: 4 });
  const main = K.comps.slice().sort((a, b) => b.area - a.area)[0]; const out = [];
  if (!main) return { main: null, issues: [{ sev: 'error', code: 'C55', msg: '地图上没有可走船的水' }] };
  const reach = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const l = K.lab[Y * W + X]; if (l >= 0) return l; } return -1; };
  for (const u of unitsOf(model)) {
    const id = u.props.unit || ''; const [x, y] = cellOf(model, u);
    if (SHIPRE.test(id) && !/hover/i.test(id)) { const l = K.lab[y * W + x]; if (l < 0) out.push({ sev: 'error', code: 'C55', msg: `舰船 ${id}（队伍 ${u.props.team}）在 (${x},${y}) 不在水上`, at: [x, y] }); else if (l !== main.id) out.push({ sev: K.comps[l].area >= 20000 ? 'info' : 'warn', code: 'C55', msg: `舰船 ${id}（队伍 ${u.props.team}）在 (${x},${y}) 所在的水域（${K.comps[l].area} 格）与主海不通${K.comps[l].area >= 20000 ? '（另一片大洋，可能是有意的）' : ''}`, at: [x, y] }); }
    else if (NAVALFAC.test(id)) { const l = reach(x, y, 3); if (l < 0) out.push({ sev: 'error', code: 'C55', msg: `海军工厂 (${x},${y}) 周围 3 格内没有水`, at: [x, y] }); else if (l !== main.id) out.push({ sev: 'warn', code: 'C55', msg: `海军工厂 (${x},${y}) 的水域（${K.comps[l].area} 格）与主海不通`, at: [x, y] }); }
  }
  return { main: { area: main.area, cx: main.cx, cy: main.cy }, issues: out };
}

// ---------- C56 河流宽度/断流 ----------
// 河 = 浅水（water-bridge）连通块里"细长"的那些；宽度 = 每格横竖游程的较小值
export function riverReport(model, { maxWidth = 3, minLen = 30, gapNear = 5 } = {}) {
  const { width: W, height: H } = model, T = terrainClasses(model).data, sh = new Uint8Array(W * H); for (let i = 0; i < sh.length; i++) sh[i] = T[i] === 2 ? 1 : 0;
  const K = labelComps(sh, W, H, { conn: 8, min: minLen }); const rows = [];
  const runH = new Uint16Array(W * H), runV = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!sh[y * W + x]) { x++; continue; } let e = x; while (e < W && sh[y * W + e]) e++; for (let k = x; k < e; k++) runH[y * W + k] = e - x; x = e; } }
  for (let x = 0; x < W; x++) { let y = 0; while (y < H) { if (!sh[y * W + x]) { y++; continue; } let e = y; while (e < H && sh[e * W + x]) e++; for (let k = y; k < e; k++) runV[k * W + x] = e - y; y = e; } }
  const byComp = new Map(); for (let i = 0; i < W * H; i++) { const l = K.lab[i]; if (l < 0) continue; if (!byComp.has(l)) byComp.set(l, []); byComp.get(l).push(Math.min(runH[i], runV[i])); }
  const ends = [];
  for (const c of K.comps) {
    const ws = byComp.get(c.id).sort((a, b) => a - b), med = ws[ws.length >> 1], p90 = ws[Math.floor(ws.length * 0.9)], max = ws[ws.length - 1], wide = ws.filter((v) => v > maxWidth).length;
    const b = c.bbox, elong = Math.max(b[2] - b[0], b[3] - b[1]) + 1; const river = c.area / elong <= maxWidth * 2.2;   // 平均宽度不大才算河
    if (!river) { rows.push({ cx: c.cx, cy: c.cy, area: c.area, kind: '浅水湖/滩', median: med, p90, max, wide }); continue; }
    rows.push({ cx: c.cx, cy: c.cy, area: c.area, length: elong, kind: '河', median: med, p90, max, wide, tooWide: p90 > maxWidth });
    // 端点：不管河多宽，取"沿河走到头"的位置——先从任一格BFS找最远点当起点，再从起点BFS,所有支流末梢都是距离的局部极大值
    for (const e of compEnds(K, c, W, H, maxWidth)) ends.push({ comp: c.id, x: e[0], y: e[1] });
  }
  const dangling = [], breaks = [];
  const deepNear = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && T[Y * W + X] === 1) return true; } return false; };
  for (const e of ends) {
    if (deepNear(e.x, e.y, gapNear) || e.x <= 1 || e.y <= 1 || e.x >= W - 2 || e.y >= H - 2) continue;
    let other = null; for (const f of ends) if (f.comp !== e.comp && Math.hypot(f.x - e.x, f.y - e.y) <= gapNear) { other = f; break; }
    if (other) breaks.push({ a: [e.x, e.y], b: [other.x, other.y] }); else dangling.push([e.x, e.y]);
  }
  return { rivers: rows.filter((r) => r.kind === '河'), others: rows.filter((r) => r.kind !== '河'), dangling: dangling.slice(0, 40), breaks: dedupBreaks(breaks).slice(0, 40) };
}
// 一条河（连通块）的端点：返回 [[x,y]…]。8 邻域 BFS 距离的局部极大值 + 起点，相距 ≤ r 的合并成一个
function compEnds(K, c, W, H, r = 3) {
  const b = c.bbox, id = c.id, cells = []; for (let y = b[1]; y <= b[3]; y++) for (let x = b[0]; x <= b[2]; x++) if (K.lab[y * W + x] === id) cells.push(y * W + x);
  if (!cells.length) return [];
  const bfs = (start) => { const dist = new Map([[start, 0]]), q = [start]; for (let h = 0; h < q.length; h++) { const k = q[h], x = k % W, y = (k / W) | 0; for (const [dx, dy] of D8) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (K.lab[j] === id && !dist.has(j)) { dist.set(j, dist.get(k) + 1); q.push(j); } } } return dist; };
  const d1 = bfs(cells[0]); let far = cells[0]; for (const [k, v] of d1) if (v > d1.get(far)) far = k;
  const d2 = bfs(far), cand = [far];
  for (const [k, v] of d2) { const x = k % W, y = (k / W) | 0; let top = true; for (const [dx, dy] of D8) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const w = d2.get(Y * W + X); if (w !== undefined && w > v) { top = false; break; } } if (top && v > 0) cand.push(k); }
  const out = []; for (const k of cand) { const x = k % W, y = (k / W) | 0; if (!out.some((p) => Math.hypot(p[0] - x, p[1] - y) <= r + 1)) out.push([x, y]); }
  return out;
}
const dedupBreaks = (bs) => { const seen = new Set(); return bs.filter((b) => { const k = [b.a, b.b].map((p) => p.join(',')).sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; }); };

// ---------- C57 河流工具 ----------
const lineCells = (pts) => { const out = []; for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1); for (let k = 0; k <= n; k++) out.push([Math.round(ax + ((bx - ax) * k) / n), Math.round(ay + ((by - ay) * k) / n)]); } return out; };
// 宽度恰好为 w 格的画刷（w=1 一格， w=2 两格， w=3 三格…；w>=4 切掉四角更圆）
const stampBrush = (d, W, H, x, y, w, gid, ok) => { const lo = -Math.floor((w - 1) / 2), hi = lo + w - 1; for (let dy = lo; dy <= hi; dy++) for (let dx = lo; dx <= hi; dx++) { if (w >= 4 && (dx === lo || dx === hi) && (dy === lo || dy === hi)) continue; const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const i = Y * W + X; if (!ok || ok(i)) d[i] = gid; } };
const stampDisc = (d, W, H, x, y, r, gid, ok) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r + r * 0.7) continue; const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const i = Y * W + X; if (!ok || ok(i)) d[i] = gid; } };
// 折线 → 固定宽度的连续浅水河；终点离深水不超过 mouthReach 时自动接到最近的深水；不覆盖深水/悬崖
export function drawRiver(model, pts, { width = 2, gid, mouthReach = 8 } = {}) {
  const g = findGids(model), G = gid ?? g.shallow; if (!G) throw new Error('找不到浅水图块（请用 gid 指定）');
  const { width: W, height: H } = model, T = terrainClasses(model).data, d = groundData(model);
  const path = pts.slice(); let mouth = null;
  const last = path[path.length - 1]; let best = null;
  for (let dy = -mouthReach; dy <= mouthReach; dy++) for (let dx = -mouthReach; dx <= mouthReach; dx++) { const X = last[0] + dx, Y = last[1] + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; if (T[Y * W + X] === 1) { const dd = Math.hypot(dx, dy); if (!best || dd < best.d) best = { d: dd, p: [X, Y] }; } }
  if (best && best.d > 0) { path.push(best.p); mouth = best.p; }
  const ok = (i) => T[i] === 0 || T[i] === 2; let n = 0;
  for (const [x, y] of lineCells(path)) { stampBrush(d, W, H, x, y, Math.max(1, width), G, (i) => { const hit = ok(i) && d[i] !== G; if (hit) n++; return ok(i); }); }
  return { data: d, cells: n, mouth, path };
}

// ---------- C58 山脉工具 ----------
// 折线 → 岩石墙（宽 width），每隔 passEvery 格留一个宽 passWidth 的山口（欧陆式细墙+山口）
export function drawRidge(model, pts, { width = 2, passEvery = 40, passWidth = 5, gid, seed = 7 } = {}) {
  const { width: W, height: H } = model; const G = gid ?? cliffGid(model); if (!G) throw new Error('找不到岩石/悬崖图块（请用 gid 指定）');
  const T = terrainClasses(model).data, d0 = groundData(model), d = Uint32Array.from(d0), cells = lineCells(pts); let rnd = seed; const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  // 先在折线上定好山口位置（离两端至少 passWidth 格），再整条画墙，最后把山口处还原成原地形——这样山口一定是通的
  const passes = []; let at = Math.round(passEvery * (0.5 + rand() * 0.5));
  while (at < cells.length - passWidth) { if (at >= passWidth) passes.push(cells[at]); at += Math.max(passWidth + 2, Math.round(passEvery * (0.7 + rand() * 0.6))); }
  stampBrushAll(cells, d, W, H, width, G, T);
  const hr = passWidth / 2 + (width - 1) / 2 + 0.5;   // 圆盘半径要盖住墙的厚度，山口沿山脉方向才有 passWidth 宽
  for (const [px, py] of passes) for (let dy = -Math.ceil(hr); dy <= Math.ceil(hr); dy++) for (let dx = -Math.ceil(hr); dx <= Math.ceil(hr); dx++) { const X = px + dx, Y = py + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || dx * dx + dy * dy > hr * hr) continue; const k = Y * W + X; if (d[k] === G && d0[k] !== G) d[k] = d0[k]; }
  let n = 0; for (let k = 0; k < d.length; k++) if (d[k] !== d0[k]) n++;
  return { data: d, cells: n, passes };
}
const stampBrushAll = (cells, d, W, H, width, G, T) => { for (const [x, y] of cells) stampBrush(d, W, H, x, y, Math.max(1, width), G, (k) => T[k] === 0); };
export function cliffGid(model) { let soft = null, large = null; for (const ts of model.tilesets) for (const [id, p] of ts.tiles) { if ('cliff-soft' in p && soft === null) soft = ts.firstgid + id; if ('large-cliff' in p && large === null) large = ts.firstgid + id; } return soft ?? large; }

// ---------- C59 山口宽度统计 ----------
// 沿线段 a→b（山脉走向）每一步看垂直方向能否让陆军穿过，把连续可通过的位置合并成"山口"并量宽度
export function passWidths(model, a, b, { reach = 6, minWidth = 3 } = {}) {
  const { width: W, height: H } = model, P = passability(model), n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
  const ux = (b[0] - a[0]) / n, uy = (b[1] - a[1]) / n, nx = -uy, ny = ux; const open = [];
  for (let i = 0; i <= n; i++) { const x = a[0] + ux * i, y = a[1] + uy * i; let ok = true; for (let s = -reach; s <= reach; s++) { const X = Math.round(x + nx * s), Y = Math.round(y + ny * s); if (X < 0 || Y < 0 || X >= W || Y >= H || !(P[Y * W + X] & LAND)) { ok = false; break; } } open.push(ok); }
  const passes = []; let s = -1; open.forEach((v, i) => { if (v && s < 0) s = i; if ((!v || i === open.length - 1) && s >= 0) { const e = v ? i : i - 1; passes.push({ at: [Math.round(a[0] + ux * ((s + e) / 2)), Math.round(a[1] + uy * ((s + e) / 2))], width: e - s + 1 }); s = -1; } });
  return { passes, narrow: passes.filter((p) => p.width < minWidth), blockedAll: passes.length === 0 };
}

// ---------- C60 区域放大（径向变形） ----------
// 以 center 为中心、radius 为半径，把内部放大 factor 倍，边缘平滑过渡到 1 倍。只动地形层，不动对象
export function radialZoom(model, center, radius, factor = 1.6, { layer = 'ground' } = {}) {
  const { width: W, height: H } = model, src = model.layers[layer].data, d = Uint32Array.from(src), [cx, cy] = center;
  // 逆映射：输出半径 r 对应源半径 s(r)=r/m(r),m 从中心 factor 平滑降到边缘 1,保证 s(R)=R
  const m = (r) => { const t = Math.min(1, r / radius); const k = t * t * (3 - 2 * t); return factor + (1 - factor) * k; };
  const Rm = Math.ceil(radius); let moved = 0;
  // r_out → r_src 的反函数：对每个输出格，用 sOf 把输出半径换成源半径
  const tab = new Float32Array(Rm + 2); for (let r = 0; r <= Rm + 1; r++) tab[r] = r >= radius ? r : (() => { let lo = 0, hi = radius; for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; const out = mid * m(mid); if (out < r) lo = mid; else hi = mid; } return lo; })();
  for (let y = Math.max(0, cy - Rm); y <= Math.min(H - 1, cy + Rm); y++) for (let x = Math.max(0, cx - Rm); x <= Math.min(W - 1, cx + Rm); x++) {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r >= radius || r === 0) continue;
    const f = Math.floor(r), t = r - f, sr = tab[f] * (1 - t) + tab[f + 1] * t, k = sr / r, sx = Math.round(cx + dx * k), sy = Math.round(cy + dy * k);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue; const v = src[sy * W + sx]; if (d[y * W + x] !== v) { d[y * W + x] = v; moved++; }
  }
  return { data: d, moved };
}

// ---------- C61/C62 地理底图 / 国界 ----------
// 高程栅格(Float32Array / 数组，行优先）→ 图层：低于 sea 深水，sea~shore 浅水，>= mountain 且为陆地 → 悬崖（可选）
export function rasterToLayers(model, grid, gw, gh, { sea = 0, shoreBand = 0, mountain = Infinity, mountainGid, keepExisting = false } = {}) {
  const { width: W, height: H } = model, g = findGids(model); if (!g.water || !g.land) throw new Error('找不到水/陆地图块');
  const d = groundData(model), shallow = g.shallow ?? g.land, M = mountainGid ?? cliffGid(model);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const gx = Math.min(gw - 1, Math.floor((x / W) * gw)), gy = Math.min(gh - 1, Math.floor((y / H) * gh)), v = grid[gy * gw + gx];
    if (v === undefined || Number.isNaN(v)) continue; const i = y * W + x; let t = v < sea ? g.water : v < sea + shoreBand ? shallow : v >= mountain && M ? M : g.land; d[i] = t; }
  return { data: d };
}
export function parseAscGrid(text) {   // ESRI ASCII grid
  const lines = text.split(/\r?\n/); const hdr = {}; let i = 0; for (; i < lines.length; i++) { const m = lines[i].trim().match(/^([A-Za-z_]+)\s+(-?[\d.eE+-]+)$/); if (!m) break; hdr[m[1].toLowerCase()] = +m[2]; }
  const rows = []; for (; i < lines.length; i++) if (lines[i].trim()) rows.push(lines[i].trim().split(/\s+/).map(Number));
  const w = hdr.ncols || rows[0].length, h = hdr.nrows || rows.length, nd = hdr.nodata_value ?? -9999, g = new Float32Array(w * h); rows.forEach((r, y) => r.forEach((v, x) => { g[y * w + x] = v === nd ? NaN : v; }));
  return { grid: g, w, h };
}
// 国界:FeatureCollection → 每格所属国家序号(0 = 无），names[序号-1]
export function rasterizeCountries(rasterize, geo, W, H, { bbox, nameProp = 'name', proj = 'equirect' } = {}) {
  const feats = geo.type === 'FeatureCollection' ? geo.features : [geo]; const idx = new Uint16Array(W * H), names = [];
  let bb = bbox; if (!bb) { const all = rasterize({ type: 'FeatureCollection', features: feats }, 1, 1, { proj }); bb = all.bbox; }
  feats.forEach((f) => { const { mask } = rasterize(f, W, H, { bbox: bb, proj }); names.push(String(f.properties?.[nameProp] ?? names.length + 1)); for (let i = 0; i < mask.length; i++) if (mask[i]) idx[i] = names.length; });
  return { idx, names, bbox: bb };
}
// 城市归属：每座 CC 落在哪个国家，与它的队伍对比；countryTeam: {国家名: 队伍号}
export function cityOwnership(model, zones, countryTeam = {}) {
  const { width: W } = model, out = [];
  for (const u of unitsOf(model)) { if (u.props.unit !== 'commandCenter') continue; const [x, y] = cellOf(model, u), z = zones.idx[y * W + x], name = z ? zones.names[z - 1] : null, want = name !== null && name in countryTeam ? countryTeam[name] : null;
    out.push({ x, y, team: +u.props.team, country: name, want, mismatch: want !== null && want !== +u.props.team }); }
  return out;
}

// ---------- C63 城市自动选址 ----------
// 从"可建造、离水离山有余量"的格里，按权重+最小间距贪心选 n 个点；zones/quota 可限定每区个数
export function siteCities(model, { n = 20, minDist = 40, margin = 3, weight = null, zones = null, quota = null, seed = 11, avoid = [] } = {}) {
  const { width: W, height: H } = model, P = passability(model); let rnd = seed; const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  const ok = (x, y) => { for (let dy = -margin; dy <= margin; dy += 1) for (let dx = -margin; dx <= margin; dx += 1) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || !(P[Y * W + X] & BUILD) || (P[Y * W + X] & NAVAL)) return false; } return true; };
  const cand = []; const step = Math.max(2, Math.floor(margin));
  for (let y = margin; y < H - margin; y += step) for (let x = margin; x < W - margin; x += step) if (ok(x, y)) cand.push([x, y, (weight ? weight(x, y) : 1) * (0.6 + rand() * 0.8)]);
  cand.sort((a, b) => b[2] - a[2]); const picked = [], count = new Map(); const near = (x, y) => picked.some((p) => Math.hypot(p.x - x, p.y - y) < minDist) || avoid.some((p) => Math.hypot(p[0] - x, p[1] - y) < minDist);
  for (const [x, y] of cand) { if (picked.length >= n) break; const z = zones ? zones.idx[y * W + x] : 0; if (quota && z && (count.get(z) || 0) >= (quota[zones.names[z - 1]] ?? Infinity)) continue; if (near(x, y)) continue; picked.push({ x, y, zone: z ? zones.names[z - 1] : null }); count.set(z, (count.get(z) || 0) + 1); }
  return { sites: picked, candidates: cand.length, short: Math.max(0, n - picked.length) };
}

// ---------- C64 城市均匀度 ----------
// 从所有 CC 出发在陆地上做广度优先，距离最远的陆地格 = "没有城市覆盖的空白"（如新疆、西藏）
export function cityUniformity(model, { radius = 90, holes = 6, team = null } = {}) {
  const { width: W, height: H } = model, P = passability(model), dist = new Int32Array(W * H).fill(-1), q = [];
  const ccs = unitsOf(model).filter((u) => u.props.unit === 'commandCenter' && (team === null || +u.props.team === team)); if (!ccs.length) return { cities: 0, holes: [], coverage: 0 };
  for (const u of ccs) { const [x, y] = cellOf(model, u); const i = y * W + x; if (dist[i] < 0) { dist[i] = 0; q.push(i); } }
  for (let h = 0; h < q.length; h++) { const k = q[h], x = k % W, y = (k / W) | 0; for (const [dx, dy] of D4) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (dist[j] < 0 && (P[j] & LAND)) { dist[j] = dist[k] + 1; q.push(j); } } }
  let land = 0, cov = 0, unreach = 0; for (let i = 0; i < W * H; i++) if (P[i] & LAND) { land++; if (dist[i] >= 0 && dist[i] <= radius) cov++; if (dist[i] < 0) unreach++; }
  const pick = []; const cells = []; for (let i = 0; i < W * H; i += 3) if (dist[i] > radius) cells.push(i); cells.sort((a, b) => dist[b] - dist[a]);
  for (const i of cells) { if (pick.length >= holes) break; const x = i % W, y = (i / W) | 0; if (pick.some((p) => Math.hypot(p.x - x, p.y - y) < radius)) continue; pick.push({ x, y, dist: dist[i] }); }
  // 城市最近邻距离
  const pts = ccs.map((u) => cellOf(model, u)), nn = pts.map((p, i) => Math.min(...pts.map((o, j) => (i === j ? 1e9 : Math.hypot(o[0] - p[0], o[1] - p[1]))))).filter((v) => v < 1e9).sort((a, b) => a - b);
  return { cities: ccs.length, coverage: land ? +(cov / land * 100).toFixed(1) : 0, unreachable: unreach, holes: pick, nnMedian: nn.length ? Math.round(nn[nn.length >> 1]) : 0, nnMin: nn[0] ?? 0, nnMax: nn[nn.length - 1] ?? 0, radius };
}

// ---------- C65 经纬度 ↔ 格子 ----------
export function geoConv(bbox, W, H, { proj = 'equirect' } = {}) {
  const [x0, y0, x1, y1] = bbox, my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)), py = proj === 'mercator' ? my : (v) => v, inv = proj === 'mercator' ? (v) => (2 * Math.atan(Math.exp(v)) - Math.PI / 2) * 180 / Math.PI : (v) => v;
  const toCell = (lon, lat) => [Math.round(((lon - x0) / (x1 - x0)) * W), Math.round(((py(y1) - py(lat)) / (py(y1) - py(y0))) * H)];
  const toLonLat = (x, y) => [+(x0 + (x / W) * (x1 - x0)).toFixed(3), +inv(py(y1) - (y / H) * (py(y1) - py(y0))).toFixed(3)];
  const kmPerCell = (y) => { const lat = toLonLat(0, y)[1]; return +(((x1 - x0) / W) * 111.32 * Math.cos((lat * Math.PI) / 180)).toFixed(2); };
  const scaleBar = (y, pxPerCell, wantPx = 120) => { const km = kmPerCell(y); const cells = wantPx / pxPerCell, raw = cells * km, pow = 10 ** Math.floor(Math.log10(raw)), nice = [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= raw).pop() || pow; return { km: nice, px: Math.round((nice / km) * pxPerCell) }; };
  return { toCell, toLonLat, kmPerCell, scaleBar };
}

// ---------- C66 面积预算 ----------
export function areaBudget(model, { max = 1200000 } = {}) {
  const n = model.width * model.height, pct = Math.round((n / max) * 100), lvl = n > max ? 'error' : pct >= 90 ? 'warn' : 'info';
  return { cells: n, max, pct, sev: lvl, msg: `地图 ${model.width}×${model.height} = ${n.toLocaleString()} 格，占预算 ${pct}%${n > max ? '（超过预算，低端手机会卡/崩）' : pct >= 90 ? '（接近预算）' : ''}` };
}

// ---------- C67 地貌贴花 ----------
// 噪声边界的不规则斑块（沙漠/盐湖/荒原）：只改"普通陆地"格，不碰水/悬崖/浅水
export function blobDecal(model, { cx, cy, r, gid, rough = 0.35, seed = 3, only = [0] }) {
  const { width: W, height: H } = model, T = terrainClasses(model).data, d = groundData(model);
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const harm = 6, ph = Array.from({ length: harm }, () => rnd() * Math.PI * 2), amp = Array.from({ length: harm }, (_, k) => (rough * rnd()) / (k + 1)); let n = 0;
  for (let y = Math.max(0, cy - r * 2); y <= Math.min(H - 1, cy + r * 2); y++) for (let x = Math.max(0, cx - r * 2); x <= Math.min(W - 1, cx + r * 2); x++) { const dx = x - cx, dy = y - cy, a = Math.atan2(dy, dx); let R = r; for (let k = 0; k < harm; k++) R += r * amp[k] * Math.sin((k + 2) * a + ph[k]); if (Math.hypot(dx, dy) <= R && only.includes(T[y * W + x]) && d[y * W + x] !== gid) { d[y * W + x] = gid; n++; } }
  return { data: d, cells: n };
}
// 列出图块(gid + 属性），方便挑贴花用的 gid
export function listGids(model) { const out = []; for (const ts of model.tilesets) for (const [id, p] of ts.tiles) out.push({ gid: ts.firstgid + id, tileset: ts.name, props: Object.keys(p) }); return out; }

// ---------- C68 死水/封闭海 ----------
export function deadSeas(model, { maxArea = 4000, minArea = 1 } = {}) {
  const { width: W, height: H } = model, P = passability(model), K = labelComps(flagMask(P, NAVAL, LAND), W, H, { conn: 4 });   // 深水块（不含浅水）
  const ship = new Set(unitsOf(model).filter((u) => SHIPRE.test(u.props.unit || '') || NAVALFAC.test(u.props.unit || '')).map((u) => { const [x, y] = cellOf(model, u); return K.lab[y * W + x]; }));
  const main = K.comps.slice().sort((a, b) => b.area - a.area)[0];
  const list = K.comps.filter((c) => c !== main && c.area >= minArea && c.area <= maxArea && !ship.has(c.id)).map((c) => ({ cx: c.cx, cy: c.cy, area: c.area, bbox: c.bbox, id: c.id }));
  Object.defineProperty(list, 'lab', { value: K.lab, enumerable: false }); return list;
}
export function fillDeadSeas(model, opt = {}) {
  const list = deadSeas(model, opt), g = findGids(model); if (!g.land) throw new Error('找不到陆地图块'); const d = groundData(model); let cells = 0;
  if (list.length) { const lab = list.lab, drop = new Set(list.map((c) => c.id)); for (let i = 0; i < d.length; i++) if (drop.has(lab[i])) { d[i] = g.land; cells++; } }
  return { data: d, filled: list.length, cells };
}

// ---------- C69 岛链 ----------
// 沿折线生成互不相连的岛；每座岛离已有陆地与别的岛至少 gap 格深水
export function islandChain(model, pts, { n = 8, rMin = 6, rMax = 14, gap = 12, gid, seed = 5, jitter = 10 } = {}) {
  const { width: W, height: H } = model, P = passability(model), G = gid ?? findGids(model).land; if (!G) throw new Error('找不到陆地图块');
  const d = groundData(model); let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  // 到最近陆地的距离（Chebyshev BFS）
  const dist = new Int16Array(W * H).fill(-1), q = []; for (let i = 0; i < W * H; i++) if (P[i] & LAND) { dist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) { const k = q[h], x = k % W, y = (k / W) | 0; if (dist[k] > 60) continue; for (const [dx, dy] of D8) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (dist[j] < 0) { dist[j] = dist[k] + 1; q.push(j); } } }
  const line = lineCells(pts), placed = []; let tries = 0;
  while (placed.length < n && tries++ < n * 60) {
    const [bx, by] = line[Math.floor(rnd() * line.length)], x = Math.round(bx + (rnd() - 0.5) * 2 * jitter), y = Math.round(by + (rnd() - 0.5) * 2 * jitter), r = Math.round(rMin + rnd() * (rMax - rMin));
    if (x < r + 2 || y < r + 2 || x >= W - r - 2 || y >= H - r - 2) continue;
    if (dist[y * W + x] >= 0 && dist[y * W + x] < r * 1.4 + gap) continue; if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + gap + 2)) continue;
    const r0 = placed.length; placed.push({ x, y, r }); void r0;
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6]; for (let yy = y - r * 2; yy <= y + r * 2; yy++) for (let xx = x - r * 2; xx <= x + r * 2; xx++) { const dx = xx - x, dy = yy - y, a = Math.atan2(dy, dx), R = r * (1 + 0.25 * Math.sin(2 * a + ph[0]) + 0.15 * Math.sin(3 * a + ph[1]) + 0.1 * Math.sin(5 * a + ph[2])); if (Math.hypot(dx, dy) <= R && xx >= 0 && yy >= 0 && xx < W && yy < H) d[yy * W + xx] = G; }
  }
  return { data: d, islands: placed, short: n - placed.length };
}

// ---------- C70 地形占比 ----------
export function terrainShares(model, ref = null) {
  const cnt = (m) => { const { width: W, height: H } = m, P = passability(m), T = terrainClasses(m).data; let land = 0, shallow = 0, deep = 0, mount = 0, lava = 0; for (let i = 0; i < W * H; i++) { const t = T[i]; if (t === 1) deep++; else if (t === 2) shallow++; else if (t === 3) lava++; else if (t === 4 || t === 5) mount++; else land++; } const n = W * H; void P; return { 陆地: land / n, 浅水: shallow / n, 深水: deep / n, 山岩: mount / n, 岩浆: lava / n }; };
  const a = cnt(model), b = ref ? cnt(ref) : null;
  const rows = Object.keys(a).map((k) => ({ name: k, pct: +(a[k] * 100).toFixed(1), ref: b ? +(b[k] * 100).toFixed(1) : null, diff: b ? +((a[k] - b[k]) * 100).toFixed(1) : null }));
  const bar = (p) => '█'.repeat(Math.round(p / 2.5)) || '·';
  return { rows, text: rows.map((r) => `${r.name.padEnd(3, '　')} ${String(r.pct).padStart(5)}% ${bar(r.pct)}${r.ref !== null ? `  （参考 ${r.ref}%,差 ${r.diff > 0 ? '+' : ''}${r.diff}）` : ''}`).join('\n') };
}

// ---------- 汇总：地图地理检查，返回统一的 [{sev,code,msg,level}] ----------
export function lintGeo(model, { minGap = 12, minArea = 200, smallMax = 120, riverMax = 3, circum = [], clearance = 0 } = {}) {
  const out = [], push = (sev, code, msg, extra = {}) => out.push({ sev, code, msg, level: '模型验证', ...extra });
  const sl = shallowOnlyLinks(model, { minArea });
  for (const l of sl.slice(0, 20)) push('error', 'C51', `两块陆地仅靠浅水相连（陆军能走过去）:(${l.a.cx},${l.a.cy}) 面积 ${l.a.area} ↔ (${l.b.cx},${l.b.cy}) 面积 ${l.b.area},浅水通道长约 ${l.shallowLen} 格，位置 (${l.at})`, { at: l.at });
  if (sl.length > 20) push('info', 'C51', `……另有 ${sl.length - 20} 处`);
  const gr = gapReport(model, { minGap, minArea });
  for (const p of gr.pairs.filter((p) => p.tooNarrow).slice(0, 25)) push(p.gap <= 1 ? 'error' : 'warn', 'C52', `相邻陆块 (${p.a.cx},${p.a.cy}) ↔ (${p.b.cx},${p.b.cy}) 最窄只隔 ${p.gap} 格（深水连续 ${p.deepRun} 格），低于要求 ${minGap};最窄处 (${p.at})`, { at: p.at });
  const si = smallIslands(model, { maxArea: smallMax });
  if (si.small.length) push('warn', 'C53', `有 ${si.small.length} 块面积 ≤${smallMax} 格的零碎小岛（没有单位在上面），例如 (${si.small.slice(0, 5).map((c) => `${c.cx},${c.cy}`).join(') (')})`, { at: [si.small[0].cx, si.small[0].cy] });
  for (const pt of circum) { const r = circumnav(model, pt, { clearance }); if (!r.ok) push('warn', 'C54', r.reason ? `(${pt}) ${r.reason}` : `海军绕不过 (${pt}) 所在的陆地：它连到了地图${r.touchEdges.join('、')}边缘${r.borderCells[0] ? `,例如 (${r.borderCells[0]})` : ''}`, { at: pt }); }
  const pr = portReach(model); for (const i of pr.issues) out.push({ ...i, level: '模型验证' });
  const rv = riverReport(model, { maxWidth: riverMax });
  for (const r of rv.rivers.filter((r) => r.tooWide)) push('warn', 'C56', `河流 (${r.cx},${r.cy}) 太宽:90% 位置宽度 ≤${r.p90} 格，最宽 ${r.max} 格（阈值 ${riverMax}）`);
  if (rv.breaks.length) push('warn', 'C56', `河流有 ${rv.breaks.length} 处疑似断流，例如 ${rv.breaks[0].a} ↔ ${rv.breaks[0].b}`, { at: rv.breaks[0].a });
  if (rv.dangling.length) push('info', 'C56', `有 ${rv.dangling.length} 个河流端点没接到海/别的河，例如 (${rv.dangling[0]})`, { at: rv.dangling[0] });
  const ds = deadSeas(model, { maxArea: 4000 }); if (ds.length) push('info', 'C68', `有 ${ds.length} 处封闭的小水域（没有舰船，别人也进不去），例如 (${ds[0].cx},${ds[0].cy}) ${ds[0].area} 格`, { at: [ds[0].cx, ds[0].cy] });
  const ab = areaBudget(model); push(ab.sev, 'C66', ab.msg);
  return out;
}
