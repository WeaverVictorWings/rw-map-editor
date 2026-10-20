// 编辑器核心：状态、撤销、工具、对称、物品、出生点
import { Grow } from './util.js';
import { objProp, setObjProp } from './tmx.js';
import { TerrainEngine, NONE } from './terrain.js';

export const ITEM_CN = {
  'Res Pool': '资源池', 'Trees': '树', 'Grass': '草丛', 'Stone': '碎石',
  'Holes': '弹坑', 'Mud': '泥坑', 'Cacti': '仙人掌', 'LargeRock': '大岩石',
};
export const UNIT_CN = {
  commandCenter: '指挥中心', builder: '建造者', extractorT1: '资源提取器', landFactory: '陆军工厂',
  airFactory: '空军工厂', seaFactory: '海军工厂', mechFactory: '机甲工厂', laboratory: '实验室',
  fabricatorT1: '制造厂', c_turret_t1: '炮塔', c_antiAirTurret: '防空炮塔', tree: '树',
  creditsCrates: '资金箱', combatEngineer: '战斗工程师', mechEngineer: '机甲工程师',
};

// ---- 撤销记录 ----
export class Op {
  constructor(ed, label) {
    this.ed = ed; this.label = label;
    this.tL = new Grow(); this.tI = new Grow(); this.tO = new Grow(); this.tN = new Grow();
    this.vI = new Grow(); this.vO = new Grow(); this.vN = new Grow();
    this.objs = null; // [{group, before, after}]
    this.box = null;
    this.layerIdx = new Map();
  }
  li(layer) {
    let k = this.layerIdx.get(layer);
    if (k === undefined) { k = this.ed.map.layers.indexOf(layer); this.layerIdx.set(layer, k); }
    return k;
  }
  grow(x, y) {
    const r = this.recent;
    if (!r) this.recent = { x0: x, y0: y, x1: x, y1: y };
    else { if (x < r.x0) r.x0 = x; if (y < r.y0) r.y0 = y; if (x > r.x1) r.x1 = x; if (y > r.y1) r.y1 = y; }
    const b = this.box;
    if (!b) this.box = { x0: x, y0: y, x1: x, y1: y };
    else { if (x < b.x0) b.x0 = x; if (y < b.y0) b.y0 = y; if (x > b.x1) b.x1 = x; if (y > b.y1) b.y1 = y; }
  }
  tile(layer, i, oldGid, oldFlip, newGid, newFlip) {
    if (oldGid === newGid && oldFlip === newFlip) return;
    this.tL.push(this.li(layer)); this.tI.push(i);
    this.tO.push((oldGid | (oldFlip << 29)) | 0); this.tN.push((newGid | (newFlip << 29)) | 0);
    layer.data[i] = newGid;
    if (newFlip) layer.flips.set(i, newFlip); else if (layer.flips.size) layer.flips.delete(i);
    layer.dirty = true;
    const W = this.ed.map.width;
    this.grow(i % W, (i / W) | 0);
  }
  vert(i, o, n) { this.vI.push(i); this.vO.push(o); this.vN.push(n); }
  snapshotGroup(group) {
    if (!this.objs) this.objs = [];
    if (this.objs.some((e) => e.group === group)) return;
    this.objs.push({ group, before: cloneObjs(group.objects), after: null });
  }
  finish() { if (this.objs) for (const e of this.objs) e.after = cloneObjs(e.group.objects); }
  get size() { return this.tI.length + this.vI.length + (this.objs ? 1 : 0); }
  apply(undo) {
    const m = this.ed.map, eng = this.ed.engine;
    const tL = this.tL.view(), tI = this.tI.view(), src = undo ? this.tO.view() : this.tN.view();
    const n = tI.length;
    for (let k = undo ? n - 1 : 0; undo ? k >= 0 : k < n; k += undo ? -1 : 1) {
      const L = m.layers[tL[k]], i = tI[k], raw = src[k] >>> 0;
      L.data[i] = raw & 0x1fffffff;
      const f = raw >>> 29;
      if (f) L.flips.set(i, f); else if (L.flips.size) L.flips.delete(i);
      L.dirty = true;
    }
    if (eng) {
      const vI = this.vI.view(), vs = undo ? this.vO.view() : this.vN.view();
      const nv = vI.length;
      for (let k = undo ? nv - 1 : 0; undo ? k >= 0 : k < nv; k += undo ? -1 : 1) eng.V[vI[k]] = vs[k];
    }
    if (this.objs) for (const e of this.objs) e.group.objects = cloneObjs(undo ? e.before : e.after);
  }
}

function cloneObjs(arr) {
  return arr.map((o) => ({ attrs: { ...o.attrs }, props: o.props.map((p) => ({ ...p })), extra: o.extra }));
}

export class Editor {
  constructor() {
    this.map = null;
    this.engine = null;
    this.undoStack = []; this.redoStack = [];
    this.mode = 'terrain';
    this.tool = { terrain: 'brush', items: 'stamp', units: 'spawn', triggers: 'select', tiles: 'brush' };
    this.terrain = 0;
    this.size = 3;
    this.shape = 'circle';
    this.itemKey = null;
    this.unitName = 'commandCenter';
    this.team = 0;
    this.sym = 'none';
    this.selected = null;
    this.rawGid = 0;
    this.rawLayer = 'Ground';
    this.showTriggers = false;
    this.dirty = false;
    this.listeners = new Set();
    this.op = null;
  }

  on(fn) { this.listeners.add(fn); }
  emit(what) { for (const f of this.listeners) f(what); }

  setMap(map) {
    this.map = map;
    this.undoStack = []; this.redoStack = [];
    this.selected = null;
    this.dirty = false;
    this.groundTs = this.findTs('ground');
    this.itemsTs = this.findTs('items');
    this.unitsTs = this.findTs('units');
    const g = map.ground;
    this.engine = (this.groundTs && g && this.groundTs.terrainNames.length) ? new TerrainEngine(map, this.groundTs, g) : null;
    if (this.engine) {
      const grass = this.engine.names.indexOf('Grass');
      this.terrain = grass >= 0 ? grass : this.engine.paintable[0];
    }
    this.items = this.buildItems();
    if (!this.itemKey && this.items.length) this.itemKey = this.items[0].key;
    else if (this.itemKey && !this.items.find((i) => i.key === this.itemKey)) this.itemKey = this.items[0] && this.items[0].key;
    this.unitIndex = this.buildUnitIndex();
    this.emit('map');
  }

  findTs(tag) {
    const m = this.map;
    return m.tilesets.find((t) => t.layerTag === tag) || m.tilesets.find((t) => t.name === 'export_' + tag) || null;
  }

  // 物品面板：根据物品图块集的地形标注自动生成
  buildItems() {
    const ts = this.itemsTs; if (!ts) return [];
    const out = [];
    const byTuple = new Map();
    for (const [id, info] of ts.tiles) {
      if (!info.terrain || id >= ts.tilecount) continue;
      const k = info.terrain.join(',');
      if (!byTuple.has(k)) byTuple.set(k, []);
      byTuple.get(k).push(id);
    }
    ts.terrainNames.forEach((name, t) => {
      const T = (a, b, c, d) => byTuple.get([a, b, c, d].join(','));
      const full = T(t, t, t, t);
      if (!full) return;
      const grid = [[T(-1, -1, -1, t), T(-1, -1, t, t), T(-1, -1, t, -1)],
        [T(-1, t, -1, t), full, T(t, -1, t, -1)],
        [T(-1, t, -1, -1), T(t, t, -1, -1), T(t, -1, -1, -1)]];
      const blob = grid.every((r) => r.every((c) => c && c.length));
      const isPool = [...ts.tiles].some(([id, inf]) => full.includes(id) && 'res_pool' in inf.props);
      out.push({
        key: 'i' + t, name, cn: ITEM_CN[name] || name, terrain: t, pool: isPool,
        stamp: blob ? grid.map((r) => r.map((c) => ts.firstgid + c[0])) : null,
        variants: full.map((id) => ts.firstgid + id),
        rep: ts.firstgid + (ts.terrainRep[t] >= 0 ? ts.terrainRep[t] : full[0]),
      });
    });
    out.sort((a, b) => (b.pool - a.pool));
    return out;
  }

  buildUnitIndex() {
    const ts = this.unitsTs; const idx = new Map(); const names = new Set();
    if (ts) for (const [id, info] of ts.tiles) {
      const u = info.props.unit; if (!u) continue;
      names.add(u);
      const k = u + '|' + (info.props.team ?? '');
      if (!idx.has(k)) idx.set(k, ts.firstgid + id);
      if (!idx.has(u + '|*')) idx.set(u + '|*', ts.firstgid + id);
    }
    this.unitNames = [...names].sort((a, b) => (UNIT_CN[b] ? 1 : 0) - (UNIT_CN[a] ? 1 : 0) || a.localeCompare(b));
    return idx;
  }
  unitGid(unit, team) {
    return this.unitIndex.get(unit + '|' + team) || this.unitIndex.get(unit + '|*') ||
      (unit === 'commandCenter' ? 2175 : unit === 'builder' ? 2303 : 0);
  }

  // ---- 撤销 ----
  begin(label) { this.op = new Op(this, label); return this.op; }
  commit() {
    const op = this.op; this.op = null;
    if (!op) return;
    op.finish();
    if (!op.size) return;
    this.undoStack.push(op); this.redoStack = [];
    let total = this.undoStack.reduce((s, o) => s + o.size, 0);
    while ((this.undoStack.length > 200 || total > 12e6) && this.undoStack.length > 1) total -= this.undoStack.shift().size;
    this.dirty = true;
    this.emit('edit');
  }
  undo() { this.step(this.undoStack, this.redoStack, true); }
  redo() { this.step(this.redoStack, this.undoStack, false); }
  step(from, to, undo) {
    if (this.op) this.commit();
    const op = from.pop(); if (!op) return;
    op.apply(undo); to.push(op);
    this.dirty = true;
    this.selected = null;
    this.emit({ type: 'changed', box: op.box, objs: !!op.objs });
  }

  // ---- 对称 ----
  symPoints(fx, fy, kind) {
    // kind: 'v' 角点坐标, 't' 格子坐标, 'p' 像素坐标
    const m = this.map;
    const W = kind === 'v' ? m.width : kind === 't' ? m.width - 1 : m.width * m.tw;
    const H = kind === 'v' ? m.height : kind === 't' ? m.height - 1 : m.height * m.th;
    const pts = [[fx, fy]];
    const s = this.sym;
    if (s === 'lr' || s === 'quad') pts.push([W - fx, fy]);
    if (s === 'tb' || s === 'quad') pts.push([fx, H - fy]);
    if (s === 'rot' || s === 'quad') pts.push([W - fx, H - fy]);
    return pts;
  }

  // ---- 地形 ----
  brushVerts(cx, cy, size, shape, out) {
    const r = size / 2;
    const W1 = this.map.width + 1, H1 = this.map.height + 1;
    const x0 = Math.max(0, Math.ceil(cx - r)), x1 = Math.min(W1 - 1, Math.floor(cx + r));
    const y0 = Math.max(0, Math.ceil(cy - r)), y1 = Math.min(H1 - 1, Math.floor(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (shape === 'circle' && (x - cx) ** 2 + (y - cy) ** 2 > r * r + 0.01) continue;
      out.push(y * W1 + x);
    }
  }
  // 以角点坐标画一笔（带对称）
  paintTerrainAt(vx, vy, t = this.terrain) {
    if (!this.engine) return null;
    const verts = [];
    const cx = this.size % 2 ? Math.round(vx) : Math.round(vx - 0.5) + 0.5;
    const cy = this.size % 2 ? Math.round(vy) : Math.round(vy - 0.5) + 0.5;
    for (const [x, y] of this.symPoints(cx, cy, 'v')) this.brushVerts(x, y, this.size, this.shape, verts);
    return this.engine.paint(this.op, verts, t);
  }
  paintTerrainShape(kind, a, b, t = this.terrain) {
    if (!this.engine) return null;
    const verts = [];
    const W1 = this.map.width + 1, H1 = this.map.height + 1;
    for (const [[ax, ay], [bx, by]] of this.symPairs(a, b)) {
      const x0 = Math.max(0, Math.round(Math.min(ax, bx))), x1 = Math.min(W1 - 1, Math.round(Math.max(ax, bx)));
      const y0 = Math.max(0, Math.round(Math.min(ay, by))), y1 = Math.min(H1 - 1, Math.round(Math.max(ay, by)));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.max(0.5, (x1 - x0) / 2), ry = Math.max(0.5, (y1 - y0) / 2);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (kind === 'ellipse' && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1.0001) continue;
        verts.push(y * W1 + x);
      }
    }
    return this.engine.paint(this.op, verts, t);
  }
  symPairs(a, b) {
    const pa = this.symPoints(a[0], a[1], 'v'), pb = this.symPoints(b[0], b[1], 'v');
    return pa.map((p, i) => [p, pb[i]]);
  }
  pickTerrain(vx, vy) {
    if (!this.engine) return;
    const t = this.engine.terrainAtVertex(Math.round(vx), Math.round(vy));
    if (t !== NONE) { this.terrain = t; this.emit('palette'); }
  }

  // ---- 物品 ----
  item() { return this.items.find((i) => i.key === this.itemKey) || null; }
  placeItemAt(tx, ty) {
    const it = this.item(); if (!it) return;
    const L = this.map.ensureLayer('Items');
    for (const [x, y] of this.symPoints(tx, ty, 't')) {
      if (it.stamp) {
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) this.setTile(L, x - 1 + dx, y - 1 + dy, it.stamp[dy][dx]);
      } else {
        const r = Math.floor(this.size / 2);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (this.shape === 'circle' && dx * dx + dy * dy > r * r + 0.5) continue;
          const v = it.variants[((x + dx) * 7 + (y + dy) * 13) % it.variants.length];
          this.setTile(L, x + dx, y + dy, v);
        }
      }
    }
  }
  eraseAt(L, tx, ty) {
    const r = Math.floor(this.size / 2);
    for (const [x, y] of this.symPoints(tx, ty, 't')) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (this.shape === 'circle' && dx * dx + dy * dy > r * r + 0.5) continue;
        this.setTile(L, x + dx, y + dy, 0);
      }
    }
  }
  setTile(L, x, y, gid) {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return;
    const i = y * m.width + x;
    this.op.tile(L, i, L.data[i], L.flips.get(i) || 0, gid, 0);
  }
  rawPaintAt(tx, ty) {
    const L = this.map.layer(this.rawLayer) || this.map.ground;
    if (!L) return;
    const r = Math.floor(this.size / 2);
    for (const [x, y] of this.symPoints(tx, ty, 't')) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= this.map.width || Y >= this.map.height) continue;
        this.setTile(L, X, Y, this.rawGid);
        if (this.engine && L === this.engine.layer) this.engine.syncTile(this.op, X, Y);
      }
    }
  }

  // ---- 单位与出生点 ----
  unitsGroup() { return this.map.group('UnitObjects') || this.map.group('Units') || this.map.ensureGroup('UnitObjects'); }
  usedTeams() {
    const s = new Set();
    for (const G of this.map.groups) for (const o of G.objects) {
      if (objProp(o, 'unit') === 'commandCenter') s.add(+objProp(o, 'team'));
    }
    return s;
  }
  nextTeam() { const s = this.usedTeams(); let t = 0; while (s.has(t)) t++; return t; }
  makeUnit(unit, team, px, py, w, h, rot) {
    return {
      attrs: { name: `${unit} (t:${team})`, x: px.toFixed(1), y: py.toFixed(1), width: String(w), height: String(h), rotation: rot, gid: String(this.unitGid(unit, team)) },
      props: [{ name: 'unit', value: unit }, { name: 'team', value: String(team) }],
      extra: [],
    };
  }
  addSpawnAt(tx, ty) {
    const G = this.unitsGroup();
    this.op.snapshotGroup(G);
    const pts = this.symPoints(tx, ty, 't');
    const added = [];
    for (const [x, y] of pts) {
      const X = Math.max(1, Math.min(this.map.width - 2, Math.round(x))), Y = Math.max(1, Math.min(this.map.height - 5, Math.round(y)));
      const team = this.nextTeamWith(added);
      added.push(team);
      G.objects.push(this.makeUnit('commandCenter', team, X * 20 - 5, Y * 20 + 15, 30, 30, '-90.0'));
      G.objects.push(this.makeUnit('builder', team, X * 20, Y * 20 + 80, 20, 20, '90.0'));
      G.objects.push(this.makeUnit('builder', team, X * 20 + 20, Y * 20 + 80, 20, 20, '90.0'));
    }
    return added;
  }
  nextTeamWith(extra) { const s = this.usedTeams(); for (const t of extra) s.add(t); let t = 0; while (s.has(t)) t++; return t; }
  addUnitAt(tx, ty) {
    const G = this.unitsGroup();
    this.op.snapshotGroup(G);
    for (const [x, y] of this.symPoints(tx, ty, 't')) {
      G.objects.push(this.makeUnit(this.unitName, this.team, Math.round(x) * 20, Math.round(y) * 20 + 20, 20, 20, '0'));
    }
  }
  hitObject(mx, my) {
    let best = null;
    for (const G of this.map.groups) {
      if (!G.visible) continue;
      if (G.name.toLowerCase() === 'triggers' && !this.showTriggers) continue;
      for (const o of G.objects) {
        const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0), w = Math.max(+(o.attrs.width || 0), 20), h = Math.max(+(o.attrs.height || 0), 20);
        const top = o.attrs.gid ? y - h : y;
        if (mx >= x - 6 && mx <= x + w + 6 && my >= top - 6 && my <= top + h + 6) best = { o, G };
      }
    }
    return best;
  }
  deleteObject(o) {
    for (const G of this.map.groups) {
      const i = G.objects.indexOf(o);
      if (i < 0) continue;
      this.op.snapshotGroup(G);
      G.objects.splice(i, 1);
      // 删除指挥中心时一并删除同队、附近的建造者
      if (objProp(o, 'unit') === 'commandCenter') {
        const team = objProp(o, 'team'), x = +o.attrs.x, y = +o.attrs.y;
        G.objects = G.objects.filter((b) => !(objProp(b, 'unit') === 'builder' && objProp(b, 'team') === team &&
          Math.abs(+b.attrs.x - x) < 120 && Math.abs(+b.attrs.y - y) < 160));
      }
      return true;
    }
    return false;
  }
  groupOf(o) { return this.map.groups.find((G) => G.objects.includes(o)) || null; }
  setTeam(o, team) {
    const G = this.groupOf(o); if (!G) return;
    this.begin('改队伍');
    this.op.snapshotGroup(G);
    const old = objProp(o, 'team');
    const unit = objProp(o, 'unit');
    const touch = [o];
    if (unit === 'commandCenter') {
      for (const b of G.objects) if (objProp(b, 'unit') === 'builder' && objProp(b, 'team') === old &&
        Math.abs(+b.attrs.x - +o.attrs.x) < 120 && Math.abs(+b.attrs.y - +o.attrs.y) < 160) touch.push(b);
    }
    for (const t of touch) {
      setObjProp(t, 'team', team);
      const u = objProp(t, 'unit');
      t.attrs.name = `${u} (t:${team})`;
      const g = this.unitGid(u, team); if (g) t.attrs.gid = String(g);
    }
    this.commit();
  }

  // ---- map_info ----
  mapInfo() {
    const T = this.map.group('Triggers');
    return T ? T.objects.find((o) => (o.attrs.name || '').toLowerCase() === 'map_info') || null : null;
  }
  ensureMapInfo() {
    let mi = this.mapInfo();
    if (mi) return mi;
    const T = this.map.ensureGroup('Triggers');
    this.begin('添加 map_info');
    this.op.snapshotGroup(T);
    mi = { attrs: { name: 'map_info', x: '0', y: '0', width: '20', height: '20' }, props: [{ name: 'type', value: 'skirmish' }], extra: [] };
    T.objects.push(mi);
    this.commit();
    return mi;
  }
  setMapInfoProp(name, value) {
    const mi = this.ensureMapInfo();
    const T = this.groupOf(mi);
    this.begin('修改 map_info');
    this.op.snapshotGroup(T);
    const live = T.objects.find((o) => (o.attrs.name || '').toLowerCase() === 'map_info');
    setObjProp(live, name, value === '' ? undefined : value);
    this.commit();
  }

  // ---- 资源池位置 ----
  poolTiles() {
    const L = this.map.items; if (!L) return [];
    const pools = new Set();
    for (const ts of this.map.tilesets) for (const [id, inf] of ts.tiles) if ('res_pool' in inf.props) pools.add(ts.firstgid + id);
    if (!pools.size) return [];
    const out = [], d = L.data, W = this.map.width;
    for (let i = 0; i < d.length; i++) if (d[i] && pools.has(d[i])) out.push([i % W, (i / W) | 0]);
    return out;
  }
}
