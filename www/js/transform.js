// 选区、复制粘贴、翻转旋转、整图镜像、对称差异检查、等比缩放
// 原则：地面一律按“地形”处理再自动重铺图块（海岸、悬崖图块有方向，直接复制会接错）
import { objProp, setObjProp } from './tmx.js';
import { NONE } from './terrain.js';
import { Grow } from './util.js';

const TW = 20;

// 不记撤销、直接写入的操作对象（整体操作已经由 beginWhole 记录了整张图）
function directOp(ed) {
  return {
    tile(L, i, o, of, n, nf) {
      if (n > 0xffff && L.data instanceof Uint16Array) ed.map.widenLayer(L);
      L.data[i] = n; if (nf) L.flips.set(i, nf); else if (L.flips.size) L.flips.delete(i); L.dirty = true; L.ver = (L.ver || 0) + 1;
    },
    vert() {}, snapV() {}, snapLayer() {}, snapshotGroup() {},
  };
}

function objCenter(o) {
  const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0), w = +(o.attrs.width || 0), h = +(o.attrs.height || 0);
  return o.attrs.gid ? [x + w / 2, y - h / 2] : [x + w / 2, y + h / 2];
}
function placeObjAtCenter(o, cx, cy) {
  const w = +(o.attrs.width || 0), h = +(o.attrs.height || 0);
  o.attrs.x = (cx - w / 2).toFixed(1);
  o.attrs.y = (o.attrs.gid ? cy + h / 2 : cy - h / 2).toFixed(1);
}
function cloneObj(o) { return { attrs: { ...o.attrs }, props: o.props.map((p) => ({ ...p })), extra: o.extra }; }
function isMapInfo(o) { return (o.attrs.name || '').toLowerCase() === 'map_info'; }

// ---------------- 选区 ----------------
export function rectSelection(x0, y0, x1, y1, m) {
  const a = Math.max(0, Math.min(x0, x1)), b = Math.max(0, Math.min(y0, y1));
  const c = Math.min(m.width - 1, Math.max(x0, x1)), d = Math.min(m.height - 1, Math.max(y0, y1));
  if (c < a || d < b) return null;
  return { x0: a, y0: b, x1: c, y1: d, mask: null };
}
// 魔棒：与起点同一种地形、连在一起的格子（最多 400 万格）
export function wandSelection(ed, tx, ty, global = false) {
  const m = ed.map, W = m.width, H = m.height;
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
  const eng = ed.engine;
  const cls = (i) => eng ? eng.tileTerrain(i) : m.ground.data[i];
  const start = cls(ty * W + tx);
  const sel = new Uint8Array(W * H);
  let x0 = tx, y0 = ty, x1 = tx, y1 = ty, n = 0;
  const mark = (i) => { sel[i] = 1; n++; const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  if (global) {
    for (let i = 0; i < W * H; i++) if (cls(i) === start) mark(i);
  } else {
    const st = new Grow(4096); st.push(ty * W + tx); sel[ty * W + tx] = 2;
    while (st.n && n < 4e6) {
      const i = st.a[--st.n]; mark(i);
      const x = i % W, y = (i - x) / W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const u of nb) if (u >= 0 && !sel[u] && cls(u) === start) { sel[u] = 2; st.push(u); }
    }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = sel[(y0 + y) * W + x0 + x] === 1 ? 1 : 0;
  return { x0, y0, x1, y1, mask, count: n };
}
export function selInside(sel, x, y) {
  if (!sel || x < sel.x0 || y < sel.y0 || x > sel.x1 || y > sel.y1) return false;
  if (!sel.mask) return true;
  return !!sel.mask[(y - sel.y0) * (sel.x1 - sel.x0 + 1) + (x - sel.x0)];
}

// ---------------- 复制 ----------------
export function copySelection(ed, sel) {
  const m = ed.map, eng = ed.engine, W = m.width;
  const w = sel.x1 - sel.x0 + 1, h = sel.y1 - sel.y0 + 1;
  const clip = { w, h, names: eng ? eng.names.slice() : [], V: null, ground: new Uint32Array(w * h), items: new Uint32Array(w * h), mask: sel.mask ? sel.mask.slice() : null, objects: [] };
  if (eng) {
    clip.V = new Uint8Array((w + 1) * (h + 1)).fill(NONE);
    for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
      if (clip.mask) {
        // 只有与选中格子相邻的角点才算
        let any = false;
        for (let dy = -1; dy <= 0 && !any; dy++) for (let dx = -1; dx <= 0; dx++) {
          const X = x + dx, Y = y + dy;
          if (X >= 0 && Y >= 0 && X < w && Y < h && clip.mask[Y * w + X]) { any = true; break; }
        }
        if (!any) continue;
      }
      clip.V[y * (w + 1) + x] = eng.V[(sel.y0 + y) * eng.W1 + sel.x0 + x];
    }
  }
  const G = m.ground, I = m.items;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (clip.mask && !clip.mask[y * w + x]) continue;
    const i = (sel.y0 + y) * W + sel.x0 + x;
    if (G && (!eng || eng.localOf(G.data[i]) < 0 || G.flips.has(i))) clip.ground[y * w + x] = G.rawAt(i);
    if (I) clip.items[y * w + x] = I.rawAt(i);
  }
  const px0 = sel.x0 * TW, py0 = sel.y0 * TW;
  for (const { o, G: grp } of ed.allObjects()) {
    if (isMapInfo(o)) continue;
    const [cx, cy] = objCenter(o);
    const tx = Math.floor(cx / TW), ty = Math.floor(cy / TW);
    if (!selInside(sel, tx, ty)) continue;
    clip.objects.push({ o: cloneObj(o), group: grp.name, dx: cx - px0, dy: cy - py0 });
  }
  return clip;
}

// ---------------- 变换剪贴内容 ----------------
export function transformClip(ed, clip, kind) {
  const { w, h } = clip;
  const rot = kind === 'cw' || kind === 'ccw';
  const nw = rot ? h : w, nh = rot ? w : h;
  const srcV = (X, Y, W, H) => {
    // 返回旧坐标
    if (kind === 'h') return [W - X, Y];
    if (kind === 'v') return [X, H - Y];
    if (kind === 'r180') return [W - X, H - Y];
    if (kind === 'cw') return [Y, H - X];
    if (kind === 'ccw') return [W - Y, X];
    return [X, Y];
  };
  const out = { ...clip, w: nw, h: nh, objects: [] };
  if (clip.V) {
    out.V = new Uint8Array((nw + 1) * (nh + 1));
    for (let Y = 0; Y <= nh; Y++) for (let X = 0; X <= nw; X++) {
      const [x, y] = srcV(X, Y, w, h);
      out.V[Y * (nw + 1) + X] = clip.V[y * (w + 1) + x];
    }
  }
  out.ground = new Uint32Array(nw * nh); out.items = new Uint32Array(nw * nh);
  out.mask = clip.mask ? new Uint8Array(nw * nh) : null;
  for (let Y = 0; Y < nh; Y++) for (let X = 0; X < nw; X++) {
    const [x, y] = srcV(X, Y, w - 1, h - 1);
    const k = y * w + x, K = Y * nw + X;
    out.ground[K] = clip.ground[k];
    const it = clip.items[k];
    out.items[K] = it ? ed.itemTupleTransform(it & 0x1fffffff, kind) : 0;
    if (out.mask) out.mask[K] = clip.mask[k];
  }
  const Wp = w * TW, Hp = h * TW;
  for (const e of clip.objects) {
    let dx = e.dx, dy = e.dy;
    if (kind === 'h') dx = Wp - dx;
    else if (kind === 'v') dy = Hp - dy;
    else if (kind === 'r180') { dx = Wp - dx; dy = Hp - dy; }
    else if (kind === 'cw') [dx, dy] = [Hp - e.dy, e.dx];
    else if (kind === 'ccw') [dx, dy] = [e.dy, Wp - e.dx];
    out.objects.push({ ...e, o: cloneObj(e.o), dx, dy });
  }
  return out;
}

// ---------------- 粘贴 ----------------
// opts.skipEmpty：空格不覆盖已有物品；opts.newTeams：出生点换成新的队伍号
export function pasteClip(ed, clip, tx, ty, opts = {}) {
  const m = ed.map, eng = ed.engine, op = ed.op;
  const { w, h } = clip;
  const big = w * h > 150000;
  if (big && eng) { op.snapV(); op.snapLayer(eng.layer); }
  if (big && m.items) op.snapLayer(m.items);
  let box = null;
  // 地形
  if (eng && clip.V) {
    const nameMap = clip.names.map((n) => eng.index(n));
    const verts = [], vals = [];
    for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
      const v = clip.V[y * (w + 1) + x];
      if (v === NONE) continue;
      const X = tx + x, Y = ty + y;
      if (X < 0 || Y < 0 || X > m.width || Y > m.height) continue;
      const t = nameMap[v];
      if (t === undefined || t < 0) continue;
      verts.push(Y * eng.W1 + X); vals.push(t);
    }
    if (verts.length) box = eng.paint(op, verts, vals);
  }
  const G = m.ground, I = clip.items.some((v) => v) || !opts.skipEmpty ? m.ensureLayer('Items') : m.items;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (clip.mask && !clip.mask[k]) continue;
    const X = tx + x, Y = ty + y;
    if (X < 0 || Y < 0 || X >= m.width || Y >= m.height) continue;
    const i = Y * m.width + X;
    const g = clip.ground[k];
    if (g && G) { op.tile(G, i, G.data[i], G.flips.get(i) || 0, g & 0x1fffffff, g >>> 29); if (eng) eng.syncRect(op, X, Y, X, Y); }
    const it = clip.items[k];
    if (I && (it || !opts.skipEmpty)) op.tile(I, i, I.data[i], I.flips.get(i) || 0, it & 0x1fffffff, it >>> 29);
  }
  // 对象
  if (clip.objects.length) {
    const teamMap = new Map();
    if (opts.newTeams !== false) {
      const ccTeams = [...new Set(clip.objects.filter((e) => objProp(e.o, 'unit') === 'commandCenter').map((e) => +objProp(e.o, 'team')).filter((t) => t >= 0))];
      const taken = [];
      for (const t of ccTeams) { const nt = ed.nextTeamWith(taken); taken.push(nt); teamMap.set(t, nt); }
    }
    const touched = new Set();
    for (const e of clip.objects) {
      const grp = m.group(e.group) || ed.unitsGroup();
      if (!touched.has(grp)) { op.snapshotGroup(grp); touched.add(grp); }
      const o = cloneObj(e.o);
      placeObjAtCenter(o, tx * TW + e.dx, ty * TW + e.dy);
      const t = objProp(o, 'team');
      if (t !== undefined && teamMap.has(+t)) {
        const nt = teamMap.get(+t); setObjProp(o, 'team', nt);
        const u = objProp(o, 'unit');
        if (u) { o.attrs.name = `${u} (t:${nt})`; if (o.attrs.gid) o.attrs.gid = String(ed.unitGid(u, nt)); }
      }
      if (o.attrs.id) delete o.attrs.id;
      grp.objects.push(o);
    }
  }
  op.grow(Math.max(0, tx), Math.max(0, ty)); op.grow(Math.min(m.width - 1, tx + w), Math.min(m.height - 1, ty + h));
  return box;
}

// 粘贴时按当前对称方式，同时把翻转后的副本放到对称位置
export function pasteWithSymmetry(ed, clip, tx, ty, opts) {
  pasteClip(ed, clip, tx, ty, opts);
  const m = ed.map, s = ed.sym;
  const W = m.width, H = m.height;
  const copies = [];
  if (s === 'lr' || s === 'quad') copies.push(['h', W - tx - clip.w, ty]);
  if (s === 'tb' || s === 'quad') copies.push(['v', tx, H - ty - clip.h]);
  if (s === 'rot' || s === 'quad') copies.push(['r180', W - tx - clip.w, H - ty - clip.h]);
  for (const [k, x, y] of copies) {
    if (x === tx && y === ty) continue;
    pasteClip(ed, transformClip(ed, clip, k), x, y, opts);
  }
}

// 清空选区：地面换成指定地形，物品清除，单位删除
export function clearSelection(ed, sel, fillTerrain) {
  const m = ed.map, eng = ed.engine, op = ed.op;
  const w = sel.x1 - sel.x0 + 1, h = sel.y1 - sel.y0 + 1;
  if (w * h > 150000) { if (eng) { op.snapV(); op.snapLayer(eng.layer); } if (m.items) op.snapLayer(m.items); }
  if (eng && fillTerrain !== undefined && fillTerrain !== null) {
    const verts = [];
    for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
      if (sel.mask) {
        let any = false;
        for (let dy = -1; dy <= 0 && !any; dy++) for (let dx = -1; dx <= 0; dx++) {
          const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && sel.mask[Y * w + X]) { any = true; break; }
        }
        if (!any) continue;
      }
      verts.push((sel.y0 + y) * eng.W1 + sel.x0 + x);
    }
    eng.paint(op, verts, fillTerrain);
  }
  const I = m.items;
  if (I) for (let y = sel.y0; y <= sel.y1; y++) for (let x = sel.x0; x <= sel.x1; x++) {
    if (!selInside(sel, x, y)) continue;
    const i = y * m.width + x;
    if (I.data[i]) op.tile(I, i, I.data[i], I.flips.get(i) || 0, 0, 0);
  }
  for (const G of m.groups) {
    const keep = G.objects.filter((o) => {
      if (isMapInfo(o)) return true;
      const [cx, cy] = objCenter(o);
      return !selInside(sel, Math.floor(cx / TW), Math.floor(cy / TW));
    });
    if (keep.length !== G.objects.length) { op.snapshotGroup(G); G.objects = keep; }
  }
  op.grow(sel.x0, sel.y0); op.grow(sel.x1, sel.y1);
}

// ---------------- 图块形式的单位 ----------------
// 有些地图把单位画在图块图层里（每格一个单位图块）。整图操作前先转成对象，
// 这样缩放、镜像时单位是“搬家”而不是按格子被复制。
export function unitTileLayers(ed) {
  const m = ed.map, ts = ed.unitsTs;
  if (!ts) return [];
  const lo = ts.firstgid, hi = ts.firstgid + ts.tilecount;
  return m.layers.filter((L) => L !== m.ground && L !== m.items && L.data.some((g) => g >= lo && g < hi));
}
export function unitTilesToObjects(ed) {
  const m = ed.map, ts = ed.unitsTs;
  const layers = unitTileLayers(ed);
  if (!layers.length) return 0;
  const G = ed.unitsGroup();
  const lo = ts.firstgid, hi = ts.firstgid + ts.tilecount, W = m.width;
  let n = 0;
  for (const L of layers) {
    const d = L.data;
    for (let i = 0; i < d.length; i++) {
      const g = d[i];
      if (g < lo || g >= hi) continue;
      const info = ts.tiles.get(g - lo);
      const unit = info && info.props.unit;
      if (!unit) continue;
      const team = info.props.team ?? '-1';
      const x = i % W, y = (i - x) / W;
      G.objects.push({ attrs: { name: `${unit} (t:${team})`, x: String(x * TW), y: String((y + 1) * TW), width: String(TW), height: String(TW), gid: String(g), 'data-rw-tile': L.name },
        props: [{ name: 'unit', value: unit }, { name: 'team', value: String(team) }], extra: [] });
      d[i] = 0; L.flips.delete(i); n++;
    }
    L.dirty = true; L.ver = (L.ver || 0) + 1;
  }
  return n;
}

// 保存时把“原来画在图块层里的单位”写回图块层，保持地图原来的存法。返回还原函数。
export function unitsBackToTiles(ed) {
  const m = ed.map;
  const restores = [];
  const W = m.width, H = m.height;
  for (const G of m.groups) {
    const keep = [], moved = [];
    for (const o of G.objects) {
      const lname = o.attrs['data-rw-tile'];
      const L = lname && m.layer(lname);
      if (!L || !o.attrs.gid) { keep.push(o); continue; }
      const [cx, cy] = objCenter(o);
      const tx = Math.floor(cx / TW), ty = Math.floor(cy / TW);
      if (tx < 0 || ty < 0 || tx >= W || ty >= H || L.data[ty * W + tx]) { keep.push(o); continue; }
      const unit = objProp(o, 'unit'), team = objProp(o, 'team');
      const g = (unit && ed.unitIndex.get(unit + '|' + team)) || +o.attrs.gid;
      const i = ty * W + tx;
      if (g > 0xffff && L.data instanceof Uint16Array) m.widenLayer(L);
      L.data[i] = g; L.dirty = true;
      moved.push([L, i]);
    }
    if (moved.length) { restores.push([G, G.objects, moved]); G.objects = keep; }
  }
  return () => { for (const [G, objs, moved] of restores) { G.objects = objs; for (const [L, i] of moved) L.data[i] = 0; } };
}

// ---------------- 整图镜像 ----------------
// kind: 'lr' 左半→右半, 'rl' 右→左, 'tb' 上→下, 'bt' 下→上, 'rot' 左半旋转 180° 到右半, 'quad' 左上四分之一→其余三块
export function mirrorMap(ed, kind) {
  const m = ed.map, eng = ed.engine, W = m.width, H = m.height;
  ed.unitsGroup(); // 先建好对象层，撤销时才能还原
  ed.beginWhole('整图镜像');
  const converted = unitTilesToObjects(ed);
  const op = directOp(ed);
  // 每个目标格/角点 -> 源坐标（null 表示保持）
  const srcT = (x, y) => {
    switch (kind) {
      case 'lr': return x >= W / 2 ? [W - 1 - x, y, 'h'] : null;
      case 'rl': return x < W / 2 ? [W - 1 - x, y, 'h'] : null;
      case 'tb': return y >= H / 2 ? [x, H - 1 - y, 'v'] : null;
      case 'bt': return y < H / 2 ? [x, H - 1 - y, 'v'] : null;
      case 'rot': return x >= W / 2 ? [W - 1 - x, H - 1 - y, 'r180'] : null;
      case 'quad': {
        const r = x >= W / 2, b = y >= H / 2;
        if (!r && !b) return null;
        return [r ? W - 1 - x : x, b ? H - 1 - y : y, r && b ? 'r180' : r ? 'h' : 'v'];
      }
    }
    return null;
  };
  const srcV = (x, y) => {
    switch (kind) {
      case 'lr': return x > W / 2 ? [W - x, y] : null;
      case 'rl': return x < W / 2 ? [W - x, y] : null;
      case 'tb': return y > H / 2 ? [x, H - y] : null;
      case 'bt': return y < H / 2 ? [x, H - y] : null;
      // rot 是中心对称：中轴角点 x=W/2 也要翻（它对应 y 方向镜像的那一半），
      // 否则 (W/2, y>H/2) 这一列角点不翻，中轴两侧地形差一排
      case 'rot': return x >= W / 2 ? [W - x, H - y] : null;
      case 'quad': { const r = x > W / 2, b = y > H / 2; if (!r && !b) return null; return [r ? W - x : x, b ? H - y : y]; }
    }
    return null;
  };
  if (eng) {
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
      const s = srcV(x, y); if (!s) continue;
      eng.V[y * eng.W1 + x] = eng.V[s[1] * eng.W1 + s[0]];
    }
  }
  const G = m.ground, I = m.items;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = srcT(x, y); if (!s) continue;
    const i = y * W + x, j = s[1] * W + s[0];
    if (G && (!eng || eng.localOf(G.data[j]) < 0)) op.tile(G, i, 0, 0, G.data[j], G.flips.get(j) || 0);
    if (I) { const it = I.data[j]; op.tile(I, i, 0, 0, it ? ed.itemTupleTransform(it, s[2]) : 0, 0); }
  }
  if (eng) { eng.repairRect(op, 0, 0, W, H); eng.retileRect(op, 0, 0, W - 1, H - 1); }
  // 对象：删掉目标区域的，复制源区域的并换新队伍号
  const Wp = W * TW, Hp = H * TW;
  const inTarget = (cx, cy) => !!srcT(Math.floor(cx / TW), Math.floor(cy / TW));
  const copies = [];
  for (const grp of m.groups) {
    if (grp.name.toLowerCase() === 'triggers') continue;
    const src = [];
    grp.objects = grp.objects.filter((o) => { const [cx, cy] = objCenter(o); if (inTarget(cx, cy)) return false; src.push(o); return true; });
    for (const o of src) {
      const [cx, cy] = objCenter(o);
      const targets = [];
      if (kind === 'lr' || kind === 'rl') targets.push([Wp - cx, cy]);
      else if (kind === 'tb' || kind === 'bt') targets.push([cx, Hp - cy]);
      else if (kind === 'rot') targets.push([Wp - cx, Hp - cy]);
      else if (kind === 'quad') targets.push([Wp - cx, cy], [cx, Hp - cy], [Wp - cx, Hp - cy]);
      targets.forEach((t, k) => copies.push({ grp, o, t, k }));
    }
  }
  // 队伍号：每份副本整体分配新号
  const teamMaps = [];
  const used = ed.usedTeams();
  const srcTeams = [...new Set(copies.filter((c) => objProp(c.o, 'unit') === 'commandCenter').map((c) => +objProp(c.o, 'team')).filter((t) => t >= 0))].sort((a, b) => a - b);
  let next = 0;
  const alloc = () => { while (used.has(next)) next++; used.add(next); return next; };
  for (const c of copies) {
    if (!teamMaps[c.k]) { teamMaps[c.k] = new Map(); for (const t of srcTeams) teamMaps[c.k].set(t, alloc()); }
    const o = cloneObj(c.o);
    placeObjAtCenter(o, c.t[0], c.t[1]);
    const t = objProp(o, 'team');
    if (t !== undefined && teamMaps[c.k].has(+t)) {
      const nt = teamMaps[c.k].get(+t); setObjProp(o, 'team', nt);
      const u = objProp(o, 'unit'); if (u) { o.attrs.name = `${u} (t:${nt})`; if (o.attrs.gid) o.attrs.gid = String(ed.unitGid(u, nt)); }
    }
    delete o.attrs.id;
    c.grp.objects.push(o);
  }
  ed.op.markAll();
  ed.commit();
  return { converted };
}

// ---------------- 对称差异检查 ----------------
// 返回 {diff: Uint8Array(W*H) 1=不对称, count, spawns: 不对称的出生点数}
// 地形按“角点”比较（左右镜像时四个角要交叉对应）：这样不会因为一个格子里两种地形各占两角、
// 谁先谁后（tileTerrain 的平局规则）而误报，修完对称之后能真正归零。
export function symmetryDiff(ed, kind) {
  const m = ed.map, eng = ed.engine, W = m.width, H = m.height;
  const mirror = (x, y) => kind === 'lr' ? [W - 1 - x, y] : kind === 'tb' ? [x, H - 1 - y] : [W - 1 - x, H - 1 - y];
  const diff = new Uint8Array(W * H);
  let count = 0;
  const I = m.items;
  // 镜像后的四个角点在原格里的顺序
  // 角点镜像：lr 左右翻（tl↔tr、bl↔br）、tb 上下翻（tl↔bl、tr↔br）、rot 中心对称（tl↔br、tr↔bl）
  const swap = kind === 'lr' ? [1, 0, 3, 2] : kind === 'tb' ? [2, 3, 0, 1] : [3, 2, 1, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [mx, my] = mirror(x, y);
    const i = y * W + x, j = my * W + mx;
    if (i === j) continue;   // 镜像轴上的格子：左右/上下对折时它和自己对称，不用比
    let bad = false;
    // 只看角点会漏报：两块地的主地形不同、交界却正好落在同一组角点上时角点完全相同。
    // 也不能只比 gid：同一地形的不同朝向变体 gid 不同、角点相同，镜像后会误报一大片。
    // 所以比「两个角点中较小的那个地形」——每个格子里必然同时存在这两种地形（或只有一种），
    // 它不随朝向变体和解析顺序变化；同为 NONE 的变体一视同仁。
    // （不直接用 tileTerrain：一个格里两种地形各占两角时它按平局规则挑一个，镜像前后可能挑到不同的那个。）
    if (eng) {
      // 按镜像关系一一对应比较四个角（不是排序后比集合：一个格里两种地形各占两角时，
      // 集合相同但左右镜像过来是反的，必须看位置）
      const W1 = eng.W1, V = eng.V, a = y * W1 + x, b = my * W1 + mx;
      const off = [0, 1, W1, W1 + 1];   // tl, tr, bl, br 在角点数组里的偏移
      const ca = off.map((o) => V[a + o]);
      const cb = off.map((o, k) => V[b + off[swap[k]]]);
      bad = ca[0] !== cb[0] || ca[1] !== cb[1] || ca[2] !== cb[2] || ca[3] !== cb[3];
      // 角点一样时还要看“主地形”：一个格里两种地形各占两角（对角）时，
      // 主地形取哪个由平局规则决定，左右镜像过去可能挑到不同的那个——这种也算不对称
      if (!bad) bad = eng.tileTerrain(i) !== eng.tileTerrain(j);
    } else bad = (m.ground ? m.ground.data[i] : 0) !== (m.ground ? m.ground.data[j] : 0);
    if (!bad && I) bad = !!I.data[i] !== !!I.data[j];
    if (bad) { diff[i] = 1; count++; }
  }
  const sp = ed.spawns();
  const Wp = W * TW, Hp = H * TW;
  let lonely = 0;
  for (const s of sp) {
    const tx = kind === 'tb' ? s.cx : Wp - s.cx, ty = kind === 'lr' ? s.cy : Hp - s.cy;
    if (!sp.some((q) => Math.hypot(q.cx - tx, q.cy - ty) < 40)) lonely++;
  }
  return { diff, count, spawns: lonely, total: W * H };
}

// ---------------- 等比缩放 ----------------
// k：倍数（0.25~4）
// opts.units: 'move' 单位挪到对应位置（默认，绝不复制）| 'keep' 原地不动
// opts.pools: 'keep' 资源池数量不变（默认）| 'area' 按面积增加
// opts.triggers: 触发器区域是否跟着缩放（默认是）
export function scaleMap(ed, k, opts = {}) {
  const m = ed.map, eng = ed.engine;
  const W = m.width, H = m.height;
  const W2 = Math.max(10, Math.round(W * k)), H2 = Math.max(10, Math.round(H * k));
  const kx = W2 / W, ky = H2 / H;
  const unitsMode = opts.units || 'move', poolsMode = opts.pools || 'keep', scaleTrig = opts.triggers !== false;
  ed.unitsGroup();
  ed.beginWhole(`等比缩放 ×${k}`);
  const op = directOp(ed);
  // 0. 图块形式的单位先转成对象，避免按格子放大时被复制
  const converted = unitTilesToObjects(ed);
  // 1. 收集要“整体搬家”而不是拉伸的东西：3×3 物品（资源池、大岩石）和贴图
  const stamps = [];
  const I = m.items;
  const stampCenters = new Map();
  for (const it of ed.items) if (it.stamp) stampCenters.set(it.stamp[1][1], it);
  const picBlocks = [];
  if (I) {
    const d = I.data;
    const pictureTs = (g) => { const ts = m.tilesetOf(g); return ts && ts !== ed.itemsTs ? ts : null; };
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < d.length; i++) {
      const g = d[i]; if (!g) continue;
      if (stampCenters.has(g)) {
        const it = stampCenters.get(g), x = i % W, y = (i / W) | 0;
        // 每个资源池保留原来的样式（1 格或 3×3）
        const bordered = x > 0 && y > 0 && d[i - W - 1] === it.stamp[0][0];
        stamps.push({ it, x, y, style: it.pool ? (bordered ? '3x3' : '1x1') : '3x3' });
      }
      if (!seen[i] && pictureTs(g)) {
        const ts = pictureTs(g);
        let x0 = W, y0 = H;
        const st = [i]; seen[i] = 1;
        const cells = [];
        while (st.length) {
          const c = st.pop(); cells.push(c);
          const x = c % W, y = (c - x) / W;
          if (x < x0) x0 = x; if (y < y0) y0 = y;
          for (const u of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
            if (u >= 0 && !seen[u] && d[u] && m.tilesetOf(d[u]) === ts) { seen[u] = 1; st.push(u); }
          }
        }
        picBlocks.push({ x0, y0, cells: cells.map((c) => [c % W - x0, ((c / W) | 0) - y0, d[c]]) });
      }
    }
  }
  const isStampTile = new Set();
  for (const it of ed.items) if (it.stamp) for (const r of it.stamp) for (const g of r) isStampTile.add(g);
  // 2. 角点按最近邻放大
  let V2 = null;
  if (eng) {
    V2 = new Uint8Array((W2 + 1) * (H2 + 1));
    for (let y = 0; y <= H2; y++) {
      const sy = Math.min(H, Math.round(y / ky));
      for (let x = 0; x <= W2; x++) V2[y * (W2 + 1) + x] = eng.V[sy * eng.W1 + Math.min(W, Math.round(x / kx))];
    }
  }
  // 3. 各图层按最近邻采样（地形图块之后会重铺；3×3 物品和贴图另外处理；树、草等装饰跟着放大）
  for (const L of m.layers) {
    const old = L.data, oflips = L.flips;
    const data = (old instanceof Uint32Array) ? new Uint32Array(W2 * H2) : new Uint16Array(W2 * H2);
    const flips = new Map();
    for (let y = 0; y < H2; y++) {
      const sy = Math.min(H - 1, Math.floor((y + 0.5) / ky));
      for (let x = 0; x < W2; x++) {
        const sx = Math.min(W - 1, Math.floor((x + 0.5) / kx));
        const j = sy * W + sx;
        let g = old[j];
        if (L === I && g && (isStampTile.has(g) || (m.tilesetOf(g) && m.tilesetOf(g) !== ed.itemsTs))) g = 0;
        data[y * W2 + x] = g;
        const f = oflips.get(j); if (f && g) flips.set(y * W2 + x, f);
      }
    }
    L.data = data; L.flips = flips; L.w = W2; L.h = H2; L.dirty = true; L.ver = (L.ver || 0) + 1;
  }
  m.width = W2; m.height = H2;
  // 4. 地形：写入角点，修正过渡，重铺全图
  if (eng) {
    eng.alloc();
    eng.V.set(V2);
    eng.repairRect(op, 0, 0, W2, H2);
    eng.retileRect(op, 0, 0, W2 - 1, H2 - 1);
  }
  // 5. 3×3 物品和资源池放回新位置（数量不变）；勾选“按面积增加”时才加资源池
  let poolsOut = 0, poolsAdded = 0;
  if (I) {
    const put = (it, cx, cy, style) => {
      const cells = ed.stampCells(it, style);
      const r = cells.length > 1 ? 1 : 0;
      cx = Math.max(r, Math.min(W2 - 1 - r, cx)); cy = Math.max(r, Math.min(H2 - 1 - r, cy));
      for (const [dx, dy, g] of cells) I.data[(cy + dy) * W2 + cx + dx] = g;
    };
    const landOK = (x, y) => {
      if (!eng) return true;
      const t = eng.tileTerrain(y * W2 + x);
      return t !== NONE && !/water|lake|lava|cliff/i.test(eng.name(t));
    };
    for (const s of stamps) {
      const cx = Math.round((s.x + 0.5) * kx - 0.5), cy = Math.round((s.y + 0.5) * ky - 0.5);
      put(s.it, cx, cy, s.style);
      if (s.it.pool) poolsOut++;
      if (s.it.pool && poolsMode === 'area' && kx * ky > 1.5) {
        const extra = Math.round(kx * ky) - 1;
        const R = Math.max(5, Math.round(3 * Math.sqrt(kx * ky)));
        for (let e = 0; e < extra; e++) {
          const ang = (e / extra) * Math.PI * 2 + 0.6;
          let ok = false;
          for (let r = R; r <= R + 6 && !ok; r += 2) {
            const x = Math.round(cx + r * Math.cos(ang)), y = Math.round(cy + r * Math.sin(ang));
            if (x < 2 || y < 2 || x > W2 - 3 || y > H2 - 3 || !landOK(x, y) || I.data[y * W2 + x]) continue;
            put(s.it, x, y, s.style); ok = true; poolsAdded++;
          }
        }
      }
    }
    for (const b of picBlocks) {
      const nx = Math.round(b.x0 * kx), ny = Math.round(b.y0 * ky);
      for (const [dx, dy, g] of b.cells) { const X = nx + dx, Y = ny + dy; if (X >= 0 && Y >= 0 && X < W2 && Y < H2) I.data[Y * W2 + X] = g; }
    }
  }
  // 6. 对象：单位挪到对应位置（建造者跟着指挥中心，不复制）；触发区域按比例缩放
  const Wp2 = W2 * TW, Hp2 = H2 * TW;
  for (const grp of m.groups) {
    const trig = grp.name.toLowerCase() === 'triggers';
    const ccs = grp.objects.filter((o) => objProp(o, 'unit') === 'commandCenter');
    const follow = new Map();
    for (const cc of ccs) for (const b of ed.buildersOf(grp, cc)) follow.set(b, cc);
    const oldCenter = new Map(grp.objects.map((o) => [o, objCenter(o)]));
    for (const o of grp.objects) {
      if (isMapInfo(o)) continue;
      if (follow.has(o)) continue;
      const [cx, cy] = oldCenter.get(o);
      if (!o.attrs.gid) {
        if (!scaleTrig) continue;
        o.attrs.x = (+(o.attrs.x || 0) * kx).toFixed(1); o.attrs.y = (+(o.attrs.y || 0) * ky).toFixed(1);
        if (o.attrs.width) o.attrs.width = (+o.attrs.width * kx).toFixed(1);
        if (o.attrs.height) o.attrs.height = (+o.attrs.height * ky).toFixed(1);
      } else if (unitsMode === 'move') placeObjAtCenter(o, cx * kx, cy * ky);
      else placeObjAtCenter(o, Math.min(cx, Wp2 - 15), Math.min(cy, Hp2 - 15)); // 原地不动（缩小时拉回图内）
    }
    for (const [b, cc] of follow) {
      const [bx, by] = oldCenter.get(b), [ox, oy] = oldCenter.get(cc), [nx, ny] = objCenter(cc);
      placeObjAtCenter(b, nx + (bx - ox), ny + (by - oy));
    }
  }
  ed.rebuildEngineAfterResize();
  ed.op.markAll();
  ed.commit();
  return { W2, H2, pools: poolsOut, poolsAdded, converted };
}
