// 撤销记录（一次操作 = 一个 Op）
// 小操作逐格记录；改动太多时自动换成“整层快照”，避免超大地图上内存暴涨
import { Grow } from './util.js';

const COMPACT_AT = 1_500_000; // 单个 Op 逐格记录超过这么多条就转成快照

// 深拷贝一个对象。extra 也要换新容器：撤/重做时地图拿到的绝不能和快照共用引用的对象
function cloneObj(o) {
  const extra = Array.isArray(o.extra) ? o.extra.map((x) => (x && typeof x === 'object' ? { ...x } : x))
    : o.extra && typeof o.extra === 'object' ? { ...o.extra } : o.extra;
  return { attrs: { ...o.attrs }, props: (o.props || []).map((p) => ({ ...p })), extra };
}
function cloneObjs(arr) { return arr.map(cloneObj); }
// 对象指纹：用于“重做前后哪几个是新出现的/被删掉的”比对（不依赖对象引用是否同一批）
function objKey(o) {
  if (!o) return '';
  return JSON.stringify([o.attrs || {}, (o.props || []).map((p) => [p.name, p.value]), o.extra || []]);
}
export { cloneObj };

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
  clone(arr) { return cloneObjs(arr); }
  // 单独撤销中途一步后重做本步时用（redoAsNew）：把本步的 after 从“当初的画面”改写成
  // “现在这幅画面的 + 本步自己的改动”。
  //   1) after 里、重做前地图上还找得到的对象 → 原样保留（它们是本步之前就有的东西）
  //   2) after 里、重做前地图上已经没有、但本步 before 里也有的 → 是被单独撤销掉的那步加的，剔除
  //   3) after 里、before 和现在都没有的 → 本步自己新增的，保留
  // 最后再保证“本步新增的”确实在 after 里（按指纹比，不依赖引用）。
  // dropOp 重做后续步骤前用：本步“操作前”的画面里，有些对象已经不在当前地图上了
  // （它们是被单独撤销掉的那一步加进来的）。这些对象要在重做时一并剔除，
  // 否则重做会把它们原样装回去——after 快照再干净也没用，地图已经脏了。
  setLiveObjects(group, live) {
    if (!this.objs || !group) return;
    const cur = new Set((live || []).map(objKey));
    for (const e of this.objs) {
      if (e.group !== group) continue;
      e.liveBefore = e.before ? e.before.filter((o) => cur.has(objKey(o))) : null;
    }
  }
  // 单独撤销中途一步（dropOp）时，在重做本步之前调用：本步记的“操作前”是在被丢弃的那一步还在时拍的，
  // 直接重做、以后再撤销，会把被丢弃的那一步的格子 / 角点重新带回来（复活）。
  // 这里把“操作前”改成现在图上的样子；“改完后”本来就是显式记录的，保持不变。
  rebaseOnLive() {
    const ed = this.ed, m = ed.map, eng = ed.engine;
    // 逐格记录：同一格在本步里写了好几次时，只有第一条的“操作前”才是真正的操作前（撤销是倒着走的）
    const tL = this.tL.view(), tI = this.tI.view(), tO = this.tO.view(), seen = new Set();
    for (let k = 0; k < tI.length; k++) {
      const key = tL[k] * 1e9 + tI[k];
      if (seen.has(key)) continue;
      seen.add(key);
      const L = m.layers[tL[k]]; if (!L) continue;
      const i = tI[k], f = L.flips.get(i) || 0;
      tO[k] = (L.data[i] | (f << 29)) | 0;
    }
    // 整层快照：只把“本步自己改动过的格子”落在现在的图上，其余格子照现在的样子
    for (const [L, sn] of this.snaps) {
      if (!sn.after || !sn.before) continue;
      const bd = sn.before.data, ad = sn.after.data;
      if (bd.length !== L.data.length || ad.length !== L.data.length) continue;
      const nd = L.data.slice(), nf = new Map(L.flips);
      for (let i = 0; i < ad.length; i++) {
        const bf = sn.before.flips.get(i) || 0, af = sn.after.flips.get(i) || 0;
        if (bd[i] === ad[i] && bf === af) continue;
        nd[i] = ad[i];
        if (af) nf.set(i, af); else nf.delete(i);
      }
      sn.before = { data: L.data.slice(), flips: new Map(L.flips) };
      sn.after = { data: nd, flips: nf };
    }
    // 地形角点：同理
    if (eng) {
      const vI = this.vI.view(), vO = this.vO.view(), vs = new Set();
      for (let k = 0; k < vI.length; k++) { if (vs.has(vI[k])) continue; vs.add(vI[k]); vO[k] = eng.V[vI[k]]; }
      const vn = this.vSnap;
      if (vn && vn.after && vn.before && vn.before.length === eng.V.length && vn.after.length === eng.V.length) {
        const na = eng.V.slice();
        for (let i = 0; i < na.length; i++) if (vn.before[i] !== vn.after[i]) na[i] = vn.after[i];
        vn.before = eng.V.slice(); vn.after = na;
      }
    }
  }
  // dropOp 重放完之后调用：把 liveBefore 正式定为新的 before。
  // 否则以后再撤销这一步，apply(true) 仍会按旧的 before 把已被丢弃的对象装回来。
  lockLiveBefore() {
    if (!this.objs) return;
    for (const e of this.objs) {
      if (!e.liveBefore) continue;
      e.before = e.liveBefore.map(cloneObj);
      e.liveBefore = null;
    }
  }
  // 只算“改完”的对象快照（不动地图）
  snapAfterNow() {
    if (!this.objs) return;
    for (const e of this.objs) {
      const liveK = new Set(e.group.objects.map(objKey));
      const beforeK = new Set((e.before || []).map(objKey));
      const out = [], seen = new Set();
      for (const o of e.after || []) {
        const k = objKey(o);
        if (seen.has(k)) continue;
        if (liveK.has(k)) { out.push(o); seen.add(k); continue; }   // 本步之前就有、现在还在
        if (beforeK.has(k)) continue;                               // 后来被单独撤销掉的 → 不要
        out.push(o); seen.add(k);                                   // 本步自己新增的
      }
      e.afterNow = out;
    }
  }
  // redoAsNew 用：先按“重做前的画面”算好 afterNow，再重做，最后把 afterNow 落成 after
  resnap() {
    if (!this.objs) return;
    // afterNow 必须由调用方在“重做之前”用 snapAfterNow() 算好；这里只负责落地。
    // 若没算过（例如旧调用方直接调 resnap），才自己补算——但那时地图已经是重做后的样子，
    // 只会得到“全量”快照，仍然不会把被丢弃的对象带回来（因为被丢弃的仍在 before 里）。
    if (!this.objs.some((e) => e.afterNow)) this.snapAfterNow();
    for (const e of this.objs) if (e.afterNow) { e.after = e.afterNow; e.afterNow = null; }
  }

  // 记下本步对一个组“新增了哪些 / 删掉了哪些”（只留引用，比对 done 时对象还是同一批）
  noteDiff(before, after) {
    if (!this.objs) return;
    const e = this.objs.find((x) => x.group && x.before);
    if (!e) return;
    const bset = new Set(before), aset = new Set(after);
    e.added = after.filter((o) => !bset.has(o));
    e.removed = before.filter((o) => !aset.has(o));
  }
  finish() {
    if (!this.objs) return;
    for (const e of this.objs) {
      // 撤销时才补存 after 会取到被破坏的地图状态：单独撤销中途一步（dropOp）先 undo、再 redo 时，
      // 这里只能看到旧内容，记下来之后重做就落不回去了。所以在提交那一刻就取地图的真实状态。
      if (!e.after) e.after = cloneObjs(e.group.objects);
    }
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
    // 注意：必须拷贝给地图，不能把快照里的对象直接挂回去——否则后面步骤 snapshotGroup 存的 before
    // 会和地图共用同一批对象引用，单独撤销中途一步时被丢弃的修改会被后面的步骤带回来
    // 重做时若有 liveBefore（dropOp 场景），用它当“操作前”，把已被单独撤销掉的对象剔掉
    if (this.objs) for (const e of this.objs) e.group.objects = cloneObjs(undo ? e.before : e.after);
    // 重做时若有 liveBefore（dropOp 场景），用它当“操作前”，把已被单独撤销掉的对象剔掉。
    // 注意“本步新增的”必须看 afterNow（snapAfterNow 在 apply 之前就算好了），
    // 不能用 e.after——那时它还是“当初的画面”，里面还带着被丢弃的对象。
    if (!undo && this.objs) {
      for (const e of this.objs) {
        if (!e.liveBefore) continue;
        const keepK = new Set(e.liveBefore.map(objKey));
        const want = e.afterNow || e.after || [];
        const addK = new Set(want.filter((o) => !keepK.has(objKey(o))).map(objKey));
        e.group.objects = e.group.objects.filter((o) => keepK.has(objKey(o)) || addK.has(objKey(o)));
      }
    }
    if (this.meta && !undo) this.meta.redo();
  }
}
