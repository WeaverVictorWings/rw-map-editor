// 撤销记录（一次操作 = 一个 Op）
// 小操作逐格记录；改动太多时自动换成“整层快照”，避免超大地图上内存暴涨
import { Grow } from './util.js';

const COMPACT_AT = 1_500_000; // 单个 Op 逐格记录超过这么多条就转成快照

function cloneObjs(arr) {
  return arr.map((o) => ({ attrs: { ...o.attrs }, props: o.props.map((p) => ({ ...p })), extra: o.extra }));
}

export class Op {
  constructor(ed, label) {
    this.ed = ed; this.label = label; this.time = Date.now();
    this.tL = new Grow(); this.tI = new Grow(); this.tO = new Grow(); this.tN = new Grow();
    this.vI = new Grow(); this.vO = new Grow(); this.vN = new Grow();
    this.snaps = new Map(); // layer -> {before:{data,flips}, after}
    this.vSnap = null;      // {before, after}
    this.objs = null;       // [{group, before, after}]
    this.meta = null;       // 其他整体改动（尺寸、图块集等）：{undo(), redo()}
    this.box = null; this.recent = null;
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
  markAll() {
    const m = this.ed.map;
    this.grow(0, 0); this.grow(m.width - 1, m.height - 1);
  }

  // 整层快照（大操作前调用；也会在逐格记录过多时自动调用）
  snapLayer(layer) {
    if (this.snaps.has(layer)) return;
    const data = layer.data.slice();
    const flips = new Map(layer.flips);
    // 已经逐格记录过的改动要先倒回去，得到真正的“操作前”
    const tL = this.tL.view(), tI = this.tI.view(), tO = this.tO.view();
    const li = this.li(layer);
    for (let k = tI.length - 1; k >= 0; k--) {
      if (tL[k] !== li) continue;
      const raw = tO[k] >>> 0, i = tI[k];
      data[i] = raw & 0x1fffffff;
      const f = raw >>> 29;
      if (f) flips.set(i, f); else flips.delete(i);
    }
    this.snaps.set(layer, { before: { data, flips }, after: null });
    this.dropTileRecords(li);
  }
  dropTileRecords(li) {
    const tL = this.tL.view(), tI = this.tI.view(), tO = this.tO.view(), tN = this.tN.view();
    const keep = { L: new Grow(), I: new Grow(), O: new Grow(), N: new Grow() };
    for (let k = 0; k < tI.length; k++) {
      if (tL[k] === li) continue;
      keep.L.push(tL[k]); keep.I.push(tI[k]); keep.O.push(tO[k]); keep.N.push(tN[k]);
    }
    this.tL = keep.L; this.tI = keep.I; this.tO = keep.O; this.tN = keep.N;
  }
  snapV() {
    const eng = this.ed.engine;
    if (!eng || this.vSnap) return;
    const before = eng.V.slice();
    const vI = this.vI.view(), vO = this.vO.view();
    for (let k = vI.length - 1; k >= 0; k--) before[vI[k]] = vO[k];
    this.vSnap = { before, after: null };
    this.vI = new Grow(); this.vO = new Grow(); this.vN = new Grow();
  }

  tile(layer, i, oldGid, oldFlip, newGid, newFlip) {
    if (oldGid === newGid && oldFlip === newFlip) return;
    if (newGid > 0xffff && layer.data instanceof Uint16Array) this.ed.map.widenLayer(layer);
    if (!this.snaps.has(layer)) {
      this.tL.push(this.li(layer)); this.tI.push(i);
      this.tO.push((oldGid | (oldFlip << 29)) | 0); this.tN.push((newGid | (newFlip << 29)) | 0);
      if (this.tI.length > COMPACT_AT) this.snapLayer(layer);
    }
    layer.data[i] = newGid;
    if (newFlip) layer.flips.set(i, newFlip); else if (layer.flips.size) layer.flips.delete(i);
    layer.dirty = true; layer.ver = (layer.ver || 0) + 1;
    const W = this.ed.map.width;
    this.grow(i % W, (i / W) | 0);
  }
  vert(i, o, n) {
    if (this.vSnap) return;
    this.vI.push(i); this.vO.push(o); this.vN.push(n);
    if (this.vI.length > COMPACT_AT) this.snapV();
  }
  snapshotGroup(group) {
    if (!this.objs) this.objs = [];
    if (this.objs.some((e) => e.group === group)) return;
    this.objs.push({ group, before: cloneObjs(group.objects), after: null });
  }
  finish() {
    if (this.objs) for (const e of this.objs) e.after = cloneObjs(e.group.objects);
  }
  get size() {
    let s = this.tI.length + this.vI.length + (this.objs ? 64 : 0);
    for (const [, sn] of this.snaps) s += sn.before.data.length / 2 * (sn.after ? 2 : 1);
    if (this.vSnap) s += this.vSnap.before.length / 4 * (this.vSnap.after ? 2 : 1);
    return s;
  }
  get empty() {
    return !this.tI.length && !this.vI.length && !this.objs && !this.snaps.size && !this.vSnap && !this.meta;
  }

  apply(undo) {
    const m = this.ed.map, eng = this.ed.engine;
    if (this.meta && undo) this.meta.undo();
    for (const [L, sn] of this.snaps) {
      if (undo) {
        if (!sn.after) sn.after = { data: L.data.slice(), flips: new Map(L.flips) };
        L.data = sn.before.data.slice(); L.flips = new Map(sn.before.flips);
      } else {
        L.data = sn.after.data.slice(); L.flips = new Map(sn.after.flips);
      }
      L.dirty = true; L.ver = (L.ver || 0) + 1;
    }
    const tL = this.tL.view(), tI = this.tI.view(), src = undo ? this.tO.view() : this.tN.view();
    const n = tI.length;
    for (let k = undo ? n - 1 : 0; undo ? k >= 0 : k < n; k += undo ? -1 : 1) {
      const L = m.layers[tL[k]], i = tI[k], raw = src[k] >>> 0;
      L.data[i] = raw & 0x1fffffff;
      const f = raw >>> 29;
      if (f) L.flips.set(i, f); else if (L.flips.size) L.flips.delete(i);
      L.dirty = true; L.ver = (L.ver || 0) + 1;
    }
    if (eng) {
      if (this.vSnap) {
        if (undo) { if (!this.vSnap.after) this.vSnap.after = eng.V.slice(); eng.V.set(this.vSnap.before); }
        else eng.V.set(this.vSnap.after);
      }
      const vI = this.vI.view(), vs = undo ? this.vO.view() : this.vN.view();
      const nv = vI.length;
      for (let k = undo ? nv - 1 : 0; undo ? k >= 0 : k < nv; k += undo ? -1 : 1) eng.V[vI[k]] = vs[k];
    }
    if (this.objs) for (const e of this.objs) e.group.objects = cloneObjs(undo ? e.before : e.after);
    if (this.meta && !undo) this.meta.redo();
  }
}
