// 编辑器核心：状态、撤销、笔刷、对称、物品、单位、出生点、map_info
import { objProp, setObjProp } from './tmx.js';
import { TerrainEngine, NONE } from './terrain.js';
import { Op } from './history.js';

export const MAX_TEAMS = 100; // 游戏引擎上限（setMaxTeamId 超过 100 会报错）
export const ITEM_CN = {
  'Res Pool': '资源池', 'Trees': '树', 'Grass': '草丛', 'Stone': '碎石',
  'Holes': '弹坑', 'Mud': '泥坑', 'Cacti': '仙人掌', 'LargeRock': '大岩石',
};
export const UNIT_CN = {
  commandCenter: '指挥中心', builder: '建造者', extractorT1: '资源提取器', landFactory: '陆军工厂',
  airFactory: '空军工厂', seaFactory: '海军工厂', mechFactory: '机甲工厂', laboratory: '实验室',
  fabricatorT1: '制造厂', c_turret_t1: '炮塔', c_antiAirTurret: '防空炮塔', tree: '树',
  creditsCrates: '资金箱', combatEngineer: '战斗工程师', mechEngineer: '机甲工程师', tank: '坦克',
  c_tank: '坦克', hoverTank: '悬浮坦克', c_artillery: '火炮', gunShip: '武装直升机', c_helicopter: '直升机',
  builderShip: '建造船', gunBoat: '炮艇', heavyTank: '重型坦克', c_mammothTank: '猛犸坦克', bomber: '轰炸机',
  c_interceptor: '截击机', missileTank: '导弹坦克', experimentalSpider: '实验蜘蛛', dropship: '运输机',
  heavyArtillery: '重型火炮', laserDefence: '激光防御', antiAirTurretFlak: '高射炮', nukeLauncherC: '核弹发射井',
  antiNukeLauncherC: '反核发射井', mechGun: '机甲（机枪）', mechMissile: '机甲（导弹）', amphibiousJet: '两栖飞机',
};

export const SYM_MODES = ['none', 'lr', 'tb', 'rot', 'quad', 'diag'];

export class Editor {
  constructor() {
    this.map = null;
    this.engine = null;
    this.undoStack = []; this.redoStack = [];
    this.mode = 'terrain';
    this.tool = { terrain: 'brush', items: 'stamp', units: 'spawn', triggers: 'select', tiles: 'brush', select: 'rect' };
    this.terrain = 0; this.terrain2 = 0;
    this.size = 3; this.shape = 'circle';
    this.onlyOver = null;        // 只覆盖这种地形（null 不限）
    this.itemKey = null;
    this.randomMix = null;       // 随机笔刷：[{key, w}]
    this.unitName = 'commandCenter';
    this.team = 0;
    this.sym = 'none';
    this.selected = null;
    this.rawGid = 0; this.rawLayer = 'Ground';
    this.showTriggers = false;
    this.dirty = false;
    this.listeners = new Set();
    this.op = null;
    this.selection = null;       // {x0,y0,x1,y1} 或 {mask, box}
    this.clipboard = null;
    this.floating = null;        // 正在摆放的粘贴内容
    this.poolStyle = '1x1';      // 资源池：'1x1' 只放真正的资源池格（默认），'3x3' 带边框样式
  }

  on(fn) { this.listeners.add(fn); }
  emit(what) { for (const f of this.listeners) f(what); }

  setMap(map, keepHistory = false) {
    this.map = map;
    if (!keepHistory) { this.undoStack = []; this.redoStack = []; this.dirty = false; }
    this.selected = null; this.selection = null; this.floating = null;
    this.groundTs = this.findTs('ground');
    this.itemsTs = this.findTs('items');
    this.unitsTs = this.findTs('units');
    const g = map.ground;
    this.engine = (this.groundTs && g && this.groundTs.terrainNames.length) ? new TerrainEngine(map, this.groundTs, g) : null;
    if (this.engine && (!keepHistory || !this.engine.paintable.includes(this.terrain))) {
      const pick = (n) => { const i = this.engine.index(n); return this.engine.paintable.includes(i) ? i : -1; };
      this.terrain = [pick('Grass'), this.engine.paintable[0]].find((v) => v >= 0);
      this.terrain2 = [pick('Sand'), pick('Dirt'), this.terrain].find((v) => v >= 0);
    }
    this.items = this.buildItems();
    if (!this.items.find((i) => i.key === this.itemKey)) this.itemKey = this.items[0] && this.items[0].key;
    this.unitIndex = this.buildUnitIndex();
    this.emit('map');
  }
  // 地图尺寸变化后重建引擎（保留撤销历史）
  rebuildEngine() {
    if (this.engine) this.engine.rebuild();
    this.emit('map');
  }

  // 等比缩放已经直接写好了角点，只需要通知界面
  rebuildEngineAfterResize() { this.emit('map'); }

  findTs(tag) {
    const m = this.map;
    return m.tilesets.find((t) => t.layerTag === tag) || m.tilesets.find((t) => t.name === 'export_' + tag) || null;
  }

  // ---- 物品：根据物品图块集的地形标注自动生成 ----
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
    this.itemTuple = new Map(); // gid -> tuple
    for (const [k, ids] of byTuple) for (const id of ids) this.itemTuple.set(ts.firstgid + id, k.split(',').map(Number));
    this.itemByTuple = new Map([...byTuple].map(([k, ids]) => [k, ts.firstgid + ids[0]]));
    ts.terrainNames.forEach((name, t) => {
      const T = (a, b, c, d) => byTuple.get([a, b, c, d].join(','));
      const full = T(t, t, t, t);
      if (!full) return;
      const grid = [[T(-1, -1, -1, t), T(-1, -1, t, t), T(-1, -1, t, -1)],
        [T(-1, t, -1, t), full, T(t, -1, t, -1)],
        [T(-1, t, -1, -1), T(t, t, -1, -1), T(t, -1, -1, -1)]];
      const blob = grid.every((r) => r.every((c) => c && c.length));
      const isPool = [...ts.tiles].some(([id, inf]) => full.includes(id) && 'res_pool' in inf.props);
      const blocks = [...ts.tiles].some(([id, inf]) => full.includes(id) && ('large-rock' in inf.props));
      out.push({
        key: 'i' + t, name, cn: ITEM_CN[name] || name, terrain: t, pool: isPool, blocks,
        stamp: blob ? grid.map((r) => r.map((c) => ts.firstgid + c[0])) : null,
        variants: full.map((id) => ts.firstgid + id),
        rep: ts.firstgid + (ts.terrainRep[t] >= 0 ? ts.terrainRep[t] : full[0]),
      });
    });
    out.sort((a, b) => (b.pool - a.pool));
    this.poolGids = new Set();
    for (const [id, inf] of ts.tiles) if ('res_pool' in inf.props) this.poolGids.add(ts.firstgid + id);
    return out;
  }
  itemTupleTransform(gid, kind) {
    const t = this.itemTuple && this.itemTuple.get(gid);
    if (!t) return gid;
    const nt = transformTuple(t, kind);
    return this.itemByTuple.get(nt.join(',')) || gid;
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
  begin(label) { if (this.op) this.commit(); this.op = new Op(this, label); return this.op; }
  // 整体操作（改尺寸、缩放、镜像整图）：记录整张图的状态
  beginWhole(label) {
    const op = this.begin(label);
    const before = this.map.snapshotState();
    let after = null;
    op.meta = {
      undo: () => { if (!after) after = this.map.snapshotState(); this.map.restoreState(before); this.rebuildEngine(); },
      redo: () => { this.map.restoreState(after); this.rebuildEngine(); },
      bytes: before.layers.reduce((s, l) => s + l.data.byteLength, 0),
    };
    return op;
  }
  commit() {
    const op = this.op; this.op = null;
    if (!op) return;
    op.finish();
    if (op.empty) return;
    this.undoStack.push(op); this.redoStack = [];
    let total = this.undoStack.reduce((s, o) => s + o.size + (o.meta ? o.meta.bytes / 2 : 0), 0);
    while ((this.undoStack.length > 300 || total > 40e6) && this.undoStack.length > 1) {
      const o = this.undoStack.shift(); total -= o.size + (o.meta ? o.meta.bytes / 2 : 0);
    }
    this.dirty = true;
    this.emit('edit');
  }
  discard() {
    const op = this.op; this.op = null;
    if (op && !op.empty) { op.apply(true); this.emit({ type: 'changed', box: op.box, full: !!op.meta }); }
  }
  undo() { this.step(this.undoStack, this.redoStack, true); }
  redo() { this.step(this.redoStack, this.undoStack, false); }
  step(from, to, undo) {
    if (this.op) this.commit();
    const op = from.pop(); if (!op) return null;
    op.apply(undo); to.push(op);
    this.dirty = true;
    this.selected = null;
    this.emit({ type: 'changed', box: op.box, objs: !!op.objs, full: !!op.meta || op.snaps.size > 0 });
    return op;
  }
  // 历史面板：跳到第 n 步（0 = 最早之前）
  jumpTo(n) {
    while (this.undoStack.length > n) this.undo();
    while (this.undoStack.length < n && this.redoStack.length) this.redo();
  }

  // ---- 对称 ----
  // kind: 'v' 角点坐标, 't' 格子坐标, 'p' 像素坐标
  symPoints(fx, fy, kind) {
    const m = this.map;
    const W = kind === 'v' ? m.width : kind === 't' ? m.width - 1 : m.width * m.tw;
    const H = kind === 'v' ? m.height : kind === 't' ? m.height - 1 : m.height * m.th;
    const pts = [[fx, fy]];
    const s = this.sym;
    if (s === 'lr' || s === 'quad') pts.push([W - fx, fy]);
    if (s === 'tb' || s === 'quad') pts.push([fx, H - fy]);
    if (s === 'rot' || s === 'quad') pts.push([W - fx, H - fy]);
    if (s === 'diag') pts.push([fy * W / Math.max(1, H), fx * H / Math.max(1, W)]);
    const eps = kind === 'p' ? 10 : 0.5;
    return pts.filter((p, i) => pts.findIndex((q) => Math.abs(q[0] - p[0]) < eps && Math.abs(q[1] - p[1]) < eps) === i);
  }
  symPairs(a, b) {
    const pa = this.symPoints(a[0], a[1], 'v'), pb = this.symPoints(b[0], b[1], 'v');
    return pa.map((p, i) => [p, pb[i] || p]);
  }

  // ---- 地形 ----
  brushVerts(cx, cy, size, shape, out) {
    const r = size / 2;
    const W1 = this.map.width + 1, H1 = this.map.height + 1;
    const x0 = Math.max(0, Math.ceil(cx - r)), x1 = Math.min(W1 - 1, Math.floor(cx + r));
    const y0 = Math.max(0, Math.ceil(cy - r)), y1 = Math.min(H1 - 1, Math.floor(cy + r));
    const V = this.engine.V, only = this.onlyOver;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (shape === 'circle' && (x - cx) ** 2 + (y - cy) ** 2 > r * r + 0.01) continue;
      const v = y * W1 + x;
      if (only !== null && V[v] !== only) continue;
      out.push(v);
    }
  }
  brushCenter(v) { return this.size % 2 ? Math.round(v) : Math.round(v - 0.5) + 0.5; }
  paintTerrainAt(vx, vy, t = this.terrain) {
    if (!this.engine) return null;
    const verts = [];
    const cx = this.brushCenter(vx), cy = this.brushCenter(vy);
    for (const [x, y] of this.symPoints(cx, cy, 'v')) this.brushVerts(x, y, this.size, this.shape, verts);
    if (!verts.length) return null;
    return this.engine.paint(this.op, verts, t);
  }
  shapeVerts(kind, a, b) {
    const verts = [];
    const W1 = this.map.width + 1, H1 = this.map.height + 1;
    const V = this.engine.V, only = this.onlyOver;
    for (const [[ax, ay], [bx, by]] of this.symPairs(a, b)) {
      const x0 = Math.max(0, Math.round(Math.min(ax, bx))), x1 = Math.min(W1 - 1, Math.round(Math.max(ax, bx)));
      const y0 = Math.max(0, Math.round(Math.min(ay, by))), y1 = Math.min(H1 - 1, Math.round(Math.max(ay, by)));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.max(0.5, (x1 - x0) / 2), ry = Math.max(0.5, (y1 - y0) / 2);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (kind === 'ellipse' && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1.0001) continue;
        const v = y * W1 + x;
        if (only !== null && V[v] !== only) continue;
        verts.push(v);
      }
    }
    return verts;
  }
  paintTerrainShape(kind, a, b, t = this.terrain) {
    if (!this.engine) return null;
    const verts = this.shapeVerts(kind, a, b);
    if (verts.length > 200000) { this.op.snapV(); this.op.snapLayer(this.engine.layer); }
    return this.engine.paint(this.op, verts, t);
  }
  fillTerrainAt(vx, vy, t = this.terrain, global = false) {
    if (!this.engine) return null;
    let box = null;
    for (const [x, y] of this.symPoints(Math.round(vx), Math.round(vy), 'v')) {
      const b = this.engine.fill(this.op, Math.round(x), Math.round(y), t, global);
      if (b) box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
      if (global) break;
    }
    return box;
  }
  pickTerrain(vx, vy) {
    if (!this.engine) return;
    const t = this.engine.terrainAtVertex(Math.round(vx), Math.round(vy));
    if (t !== NONE && this.engine.paintable.includes(t)) { this.terrain = t; this.emit('palette'); }
  }

  // ---- 物品 ----
  // 3×3 物品要放的格子 [dx, dy, gid]；资源池默认只放中间那 1 格（游戏只认带 res_pool 的那格）
  stampCells(it, style = this.poolStyle) {
    if (it.pool && style !== '3x3') return [[0, 0, it.stamp[1][1]]];
    const out = [];
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) out.push([dx - 1, dy - 1, it.stamp[dy][dx]]);
    return out;
  }
  item(key = this.itemKey) { return this.items.find((i) => i.key === key) || null; }
  placeItemAt(tx, ty, key = this.itemKey) {
    const it = this.item(key); if (!it) return;
    const L = this.map.ensureLayer('Items');
    for (const [x, y] of this.symPoints(tx, ty, 't')) this.placeItemOne(L, it, Math.round(x), Math.round(y));
  }
  placeItemOne(L, it, x, y) {
    if (it.stamp) {
      for (const [dx, dy, g] of this.stampCells(it)) this.setTile(L, x + dx, y + dy, g);
      return;
    }
    const r = Math.floor(this.size / 2);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (this.shape === 'circle' && dx * dx + dy * dy > r * r + 0.5) continue;
      const X = x + dx, Y = y + dy;
      if (this.randomMix && this.randomMix.length) {
        // 随机笔刷：按权重抽一种，留一部分空着显得自然
        const h = hash(X, Y, this.op ? this.op.time : 0);
        const tot = this.randomMix.reduce((s, e) => s + e.w, 0) + (this.randomGap || 0);
        let pick = h * tot, chosen = null;
        for (const e of this.randomMix) { if (pick < e.w) { chosen = e; break; } pick -= e.w; }
        if (!chosen) continue;
        const ci = this.item(chosen.key); if (!ci || ci.stamp) continue;
        this.setTile(L, X, Y, ci.variants[Math.floor(hash(Y, X, 7) * ci.variants.length)]);
      } else {
        this.setTile(L, X, Y, it.variants[Math.floor(hash(X, Y, 3) * it.variants.length)]);
      }
    }
  }
  eraseAt(L, tx, ty) {
    if (this.engine && L === this.engine.layer) return; // 地面不能留空格
    const r = Math.floor(this.size / 2);
    for (const [x, y] of this.symPoints(tx, ty, 't')) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (this.shape === 'circle' && dx * dx + dy * dy > r * r + 0.5) continue;
        this.setTile(L, Math.round(x) + dx, Math.round(y) + dy, 0);
      }
    }
  }
  setTile(L, x, y, gid, flip = 0) {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return;
    const i = y * m.width + x;
    this.op.tile(L, i, L.data[i], L.flips.get(i) || 0, gid, flip);
  }
  rawPaintAt(tx, ty) {
    const L = this.map.layer(this.rawLayer) || this.map.ground;
    if (!L) return;
    const r = Math.floor(this.size / 2);
    for (const [x, y] of this.symPoints(tx, ty, 't')) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const X = Math.round(x) + dx, Y = Math.round(y) + dy;
        if (X < 0 || Y < 0 || X >= this.map.width || Y >= this.map.height) continue;
        this.setTile(L, X, Y, this.rawGid);
        if (this.engine && L === this.engine.layer) this.engine.syncRect(this.op, X, Y, X, Y);
      }
    }
  }

  // ---- 单位与出生点 ----
  unitsGroup() { return this.map.group('UnitObjects') || this.map.group('Units') || this.map.ensureGroup('UnitObjects'); }
  allObjects() { const out = []; for (const G of this.map.groups) for (const o of G.objects) out.push({ o, G }); return out; }
  spawns() {
    const out = [];
    for (const { o, G } of this.allObjects()) if (objProp(o, 'unit') === 'commandCenter') {
      const w = +(o.attrs.width || 30), h = +(o.attrs.height || 30);
      out.push({ o, G, team: +objProp(o, 'team'), cx: +o.attrs.x + w / 2, cy: +o.attrs.y - h / 2 });
    }
    return out;
  }
  usedTeams() { return new Set(this.spawns().map((s) => s.team)); }
  nextTeamWith(extra = []) { const s = this.usedTeams(); for (const t of extra) s.add(t); let t = 0; while (s.has(t)) t++; return t; }
  makeUnit(unit, team, px, py, w, h, rot) {
    return {
      attrs: { name: `${unit} (t:${team})`, x: px.toFixed(1), y: py.toFixed(1), width: String(w), height: String(h), rotation: rot, gid: String(this.unitGid(unit, team) || this.unitGid('builder', team) || 2303) },
      props: [{ name: 'unit', value: unit }, { name: 'team', value: String(team) }],
      extra: [],
    };
  }
  // 以像素中心放一个出生点：指挥中心 + 2 个建造者（建造者在下方）
  spawnAtCenter(G, cx, cy, team) {
    G.objects.push(this.makeUnit('commandCenter', team, cx - 15, cy + 15, 30, 30, '-90.0'));
    G.objects.push(this.makeUnit('builder', team, cx - 20, cy + 70, 20, 20, '90.0'));
    G.objects.push(this.makeUnit('builder', team, cx, cy + 70, 20, 20, '90.0'));
  }
  clampSpawn(cx, cy) {
    const m = this.map, Wp = m.width * m.tw, Hp = m.height * m.th;
    return [Math.max(30, Math.min(Wp - 30, cx)), Math.max(30, Math.min(Hp - 80, cy))];
  }
  addSpawnAt(tx, ty) {
    if (this.usedTeams().size >= MAX_TEAMS) return [];
    const G = this.unitsGroup();
    this.op.snapshotGroup(G);
    const added = [];
    for (const [px, py] of this.symPoints(tx * 20 + 10, ty * 20 + 10, 'p')) {
      const [cx, cy] = this.clampSpawn(px, py);
      const team = this.nextTeamWith(added);
      if (team >= MAX_TEAMS) break;
      added.push(team);
      this.spawnAtCenter(G, cx, cy, team);
    }
    return added;
  }
  addUnitAt(tx, ty) {
    const G = this.unitsGroup();
    this.op.snapshotGroup(G);
    for (const [px, py] of this.symPoints(tx * 20 + 10, ty * 20 + 10, 'p')) {
      G.objects.push(this.makeUnit(this.unitName, this.team, Math.round(px - 10), Math.round(py + 10), 20, 20, '0'));
    }
  }
  hitObject(mx, my) {
    let best = null;
    for (const G of this.map.groups) {
      if (!G.visible) continue;
      const trig = G.name.toLowerCase() === 'triggers';
      if (trig && !this.showTriggers) continue;
      if (!trig && this.mode === 'triggers') continue;
      for (const o of G.objects) {
        const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0), w = Math.max(+(o.attrs.width || 0), 20), h = Math.max(+(o.attrs.height || 0), 20);
        const top = o.attrs.gid ? y - h : y;
        if (mx >= x - 6 && mx <= x + w + 6 && my >= top - 6 && my <= top + h + 6) best = { o, G };
      }
    }
    return best;
  }
  buildersOf(G, cc) {
    const team = objProp(cc, 'team'), x = +cc.attrs.x, y = +cc.attrs.y;
    return G.objects.filter((b) => objProp(b, 'unit') === 'builder' && objProp(b, 'team') === team &&
      Math.abs(+b.attrs.x - x) < 120 && Math.abs(+b.attrs.y - y) < 160);
  }
  deleteObject(o) {
    for (const G of this.map.groups) {
      const i = G.objects.indexOf(o);
      if (i < 0) continue;
      this.op.snapshotGroup(G);
      const extra = objProp(o, 'unit') === 'commandCenter' ? this.buildersOf(G, o) : [];
      G.objects = G.objects.filter((b) => b !== o && !extra.includes(b));
      return true;
    }
    return false;
  }
  groupOf(o) { return this.map.groups.find((G) => G.objects.includes(o)) || null; }
  setTeam(o, team) {
    const G = this.groupOf(o); if (!G) return;
    this.begin('改队伍');
    this.op.snapshotGroup(G);
    const touch = [o, ...(objProp(o, 'unit') === 'commandCenter' ? this.buildersOf(G, o) : [])];
    for (const t of touch) {
      setObjProp(t, 'team', team);
      const u = objProp(t, 'unit');
      t.attrs.name = `${u} (t:${team})`;
      const g = this.unitGid(u, team); if (g) t.attrs.gid = String(g);
    }
    this.commit();
  }
  // 把队伍号重新排成 0,1,2…（保留中立）
  renumberTeams() {
    const sp = this.spawns().filter((s) => s.team >= 0).sort((a, b) => a.team - b.team);
    const map = new Map(); sp.forEach((s, i) => { if (!map.has(s.team)) map.set(s.team, map.size); });
    this.begin('队伍号重排');
    for (const G of this.map.groups) {
      this.op.snapshotGroup(G);
      for (const o of G.objects) {
        const t = objProp(o, 'team');
        if (t === undefined || !map.has(+t)) continue;
        const nt = map.get(+t);
        setObjProp(o, 'team', nt);
        const u = objProp(o, 'unit');
        if (u) { o.attrs.name = `${u} (t:${nt})`; const g = this.unitGid(u, nt); if (g && o.attrs.gid) o.attrs.gid = String(g); }
      }
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
    this.ensureMapInfo();
    const T = this.map.group('Triggers');
    this.begin('修改 map_info');
    this.op.snapshotGroup(T);
    const live = T.objects.find((o) => (o.attrs.name || '').toLowerCase() === 'map_info');
    setObjProp(live, name, value === '' ? undefined : value);
    this.commit();
  }

  // ---- 资源池位置（中心格） ----
  poolTiles() {
    const L = this.map.items; if (!L || !this.poolGids || !this.poolGids.size) return [];
    const out = [], d = L.data, W = this.map.width, pools = this.poolGids;
    for (let i = 0; i < d.length; i++) if (d[i] && pools.has(d[i])) out.push([i % W, (i / W) | 0]);
    return out;
  }
}

export function transformTuple(t, kind) {
  const [a, b, c, d] = t; // 左上 右上 左下 右下
  if (kind === 'h') return [b, a, d, c];
  if (kind === 'v') return [c, d, a, b];
  if (kind === 'r180') return [d, c, b, a];
  if (kind === 'cw') return [c, a, d, b];
  if (kind === 'ccw') return [b, d, a, c];
  if (kind === 'diag') return [a, c, b, d];
  return t;
}

export function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
