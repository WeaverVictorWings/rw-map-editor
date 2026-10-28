// 地形自动过渡引擎
// 地图有 (W+1)x(H+1) 个“角点”，每个角点属于一种地形；每个格子的图块由四个角决定。
// 图块集里只有“相邻地形”之间有过渡图块，所以改地形时要自动插入中间地形。
// 所有改地面的操作都经过这里：画笔、油漆桶、粘贴、镜像、缩放、图片导入。
import { Grow } from './util.js';

export const NONE = 255;
const FAR = 99;

export const TERRAIN_CN = {
  'Deep Water': '深水', 'Water': '水', 'Shallow Water': '浅水', 'Water Bridge': '浅滩',
  'Sand': '沙地', 'Grass': '草地', 'Dirt': '泥土', 'Snow': '雪地', 'Tree': '树林',
  'Cliff': '草地悬崖', 'Ice': '冰面', 'Swamp': '沼泽', 'Dirt Cliff': '泥土悬崖', 'Dune': '沙丘',
  'Frozen Trees': '冰冻树林', 'Lake': '湖泊', 'Ice Lake': '冰湖', 'Lava': '岩浆', 'Stone': '石地',
};

export class TerrainEngine {
  constructor(map, ts, layer) {
    this.map = map; this.ts = ts; this.layer = layer;
    this.K = ts.terrainNames.length;
    const K = this.K;
    this.names = ts.terrainNames;
    this.lut = new Int16Array(K * K * K * K).fill(-1);
    this.tuples = [];
    this.tupleOf = new Int16Array(ts.tilecount * 4).fill(-1);
    const byKey = new Map();
    for (const [id, info] of ts.tiles) {
      const t = info.terrain;
      if (!t || id >= ts.tilecount || t.some((v) => v < 0 || v >= K)) continue;
      for (let c = 0; c < 4; c++) this.tupleOf[id * 4 + c] = t[c];
      const key = this.key(t[0], t[1], t[2], t[3]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(id);
    }
    this.variants = new Map();
    for (const [key, ids] of byKey) {
      ids.sort((a, b) => a - b);
      let pick = ids[0];
      const t0 = this.tupleOf[ids[0] * 4];
      const uniform = [1, 2, 3].every((c) => this.tupleOf[ids[0] * 4 + c] === t0);
      if (uniform && ids.includes(ts.terrainRep[t0])) pick = ts.terrainRep[t0];
      this.lut[key] = pick;
      this.variants.set(key, ids);
      this.tuples.push({ key, t: [0, 1, 2, 3].map((c) => this.tupleOf[ids[0] * 4 + c]), id: pick });
    }
    const adj = Array.from({ length: K }, () => new Array(K).fill(false));
    for (const { t } of this.tuples) {
      const s = [...new Set(t)];
      if (s.length === 2) adj[s[0]][s[1]] = adj[s[1]][s[0]] = true;
    }
    this.adj = adj;
    this.dist = new Uint8Array(K * K).fill(FAR);
    this.nxt = new Uint8Array(K * K);
    for (let a = 0; a < K; a++) {
      this.dist[a * K + a] = 0; this.nxt[a * K + a] = a;
      const hop = new Int16Array(K).fill(-1); hop[a] = a;
      const q = [a];
      while (q.length) {
        const u = q.shift();
        for (let v = 0; v < K; v++) if (adj[u][v] && this.dist[a * K + v] === FAR) {
          this.dist[a * K + v] = this.dist[a * K + u] + 1;
          hop[v] = u === a ? v : hop[u];
          q.push(v);
        }
      }
      for (let v = 0; v < K; v++) if (hop[v] >= 0) this.nxt[a * K + v] = hop[v];
    }
    this.paintable = [];
    for (let a = 0; a < K; a++) if (this.lut[this.key(a, a, a, a)] >= 0) this.paintable.push(a);
    this.alloc();
    this.initFromLayer();
  }

  alloc() {
    this.W1 = this.map.width + 1; this.H1 = this.map.height + 1;
    this.V = new Uint8Array(this.W1 * this.H1).fill(NONE);
    this.pin = new Uint32Array(this.V.length);
    this.tstamp = new Uint32Array(this.map.width * this.map.height);
    this.epoch = 0;
  }
  rebuild() { this.alloc(); this.initFromLayer(); }

  key(a, b, c, d) { const K = this.K; return ((a * K + b) * K + c) * K + d; }
  name(t) { return this.names[t]; }
  cn(t) { return TERRAIN_CN[this.names[t]] || this.names[t]; }
  index(name) { return this.names.indexOf(name); }
  solidGid(t) { const l = this.lut[this.key(t, t, t, t)]; return l >= 0 ? this.ts.firstgid + l : 0; }
  canTouch(a, b) { return this.dist[a * this.K + b] <= 1; }
  reachable(a, b) { return this.dist[a * this.K + b] < FAR; }
  pathBetween(a, b) {
    if (!this.reachable(a, b)) return [a, b];
    const p = [a]; let cur = a, guard = 0;
    while (cur !== b && guard++ < this.K) { cur = this.nxt[cur * this.K + b]; p.push(cur); }
    return p;
  }
  localOf(gid) {
    const l = gid - this.ts.firstgid;
    return (l >= 0 && l < this.ts.tilecount && this.tupleOf[l * 4] >= 0) ? l : -1;
  }
  // 某格的主地形（四个角里出现最多的那种），没有地形信息返回 NONE
  tileTerrain(i) {
    const W = this.map.width, x = i % W, y = (i - x) / W;
    const a = y * this.W1 + x, V = this.V;
    const c = [V[a], V[a + 1], V[a + this.W1], V[a + this.W1 + 1]];
    if (c[0] === c[1] && c[1] === c[2]) return c[0];
    let best = c[0], bn = 0;
    // 平局时（两种地形各占两角）按地形编号取小的那个：和角点的排列顺序无关，
    // 镜像/旋转之后仍然是同一个答案（早先取“第一个非 NONE 的角”，镜像过去会换人，
    // 导致对称检查误报一整片）
    for (const v of c) {
      if (v === NONE) continue;
      let n = 0; for (const w of c) if (w === v) n++;
      if (n > bn || (n === bn && v < best)) { bn = n; best = v; }
    }
    return best;
  }

  initFromLayer() { this.syncRect(null, 0, 0, this.map.width - 1, this.map.height - 1, true); }

  // 从图块反推角点（onlyEmpty：只填还没有值的角点）
  syncRect(op, x0, y0, x1, y1, onlyEmpty = false) {
    const { map, layer, V, W1 } = this;
    const W = map.width, d = layer.data, T = this.tupleOf;
    for (let y = Math.max(0, y0); y <= Math.min(map.height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
        const i = y * W + x;
        const l = this.localOf(d[i]);
        if (l < 0 || layer.flips.has(i)) continue;
        const v = y * W1 + x;
        const vs = [v, v + 1, v + W1, v + W1 + 1];
        for (let c = 0; c < 4; c++) {
          const nv = T[l * 4 + c];
          if (onlyEmpty && V[vs[c]] !== NONE) continue;
          if (V[vs[c]] !== nv) { if (op) op.vert(vs[c], V[vs[c]], nv); V[vs[c]] = nv; }
        }
      }
    }
  }

  terrainAtVertex(vx, vy) {
    if (vx < 0 || vy < 0 || vx >= this.W1 || vy >= this.H1) return NONE;
    return this.V[vy * this.W1 + vx];
  }

  // 把一组角点设成地形 t（t 可以是数组，与 verts 一一对应），自动插入过渡并重铺
  paint(op, verts, t) {
    const { V } = this;
    const ep = ++this.epoch;
    const pin = this.pin;
    const queue = new Grow(1024), chg = new Grow(1024);
    const multi = Array.isArray(t) || ArrayBuffer.isView(t);
    for (let k = 0; k < verts.length; k++) {
      const v = verts[k];
      if (pin[v] === ep) continue;
      pin[v] = ep;
      const tv = multi ? t[k] : t;
      if (tv === NONE) continue;
      if (V[v] !== tv) { op.vert(v, V[v], tv); V[v] = tv; chg.push(v); }
      queue.push(v);
    }
    this.propagate(op, queue, chg, ep);
    this.fixSaddles(op, queue, chg, ep, 0);
    return this.retileAround(op, chg);
  }

  propagate(op, queue, chg, ep) {
    const { V, W1, H1, K, dist, nxt, pin } = this;
    let guard = 0;
    const limit = 40 * (queue.length + 2000);
    while (queue.n) {
      if (++guard > limit) { queue.n = 0; break; }
      const v = queue.a[--queue.n];
      const tv = V[v];
      if (tv === NONE) continue;
      const vx = v % W1, vy = (v - vx) / W1;
      for (let dy = -1; dy <= 1; dy++) {
        const uy = vy + dy; if (uy < 0 || uy >= H1) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const ux = vx + dx; if (ux < 0 || ux >= W1) continue;
          const u = uy * W1 + ux;
          const tu = V[u];
          if (tu === NONE || pin[u] === ep) continue;
          const dd = dist[tv * K + tu];
          if (dd > 1 && dd < FAR) {
            const nt = nxt[tu * K + tv];
            op.vert(u, tu, nt); V[u] = nt; chg.push(u); queue.push(u);
          }
        }
      }
    }
  }

  // 图块集里没有“对角棋盘”这类组合，改一个未固定的角
  fixSaddles(op, queue, chg, ep, start) {
    const { V, W1, H1, K, dist, pin } = this;
    for (let round = 0; round < 12; round++) {
      let fixed = 0;
      const end = chg.n;
      for (let k = start; k < end; k++) {
        const v = chg.a[k];
        const vx = v % W1, vy = (v - vx) / W1;
        for (let ty = vy - 1; ty <= vy; ty++) for (let tx = vx - 1; tx <= vx; tx++) {
          if (tx < 0 || ty < 0 || tx >= W1 - 1 || ty >= H1 - 1) continue;
          const a = ty * W1 + tx, b = a + 1, c = a + W1, d = c + 1;
          const ta = V[a], tb = V[b], tc = V[c], td = V[d];
          if (ta === NONE || tb === NONE || tc === NONE || td === NONE) continue;
          if (this.lut[this.key(ta, tb, tc, td)] >= 0) continue;
          if (dist[ta * K + tb] > 1 || dist[ta * K + tc] > 1 || dist[ta * K + td] > 1 ||
              dist[tb * K + tc] > 1 || dist[tb * K + td] > 1 || dist[tc * K + td] > 1) continue;
          for (const [u, nt] of [[b, ta], [c, ta], [a, tb], [d, tc]]) {
            if (pin[u] === ep || V[u] === nt) continue;
            op.vert(u, V[u], nt); V[u] = nt; chg.push(u); queue.push(u); fixed++;
            break;
          }
        }
      }
      start = end;
      if (!fixed) break;
      this.propagate(op, queue, chg, ep);
    }
  }

  // 重铺这些角点周围的格子；返回受影响的格子范围
  retileAround(op, verts) {
    const { W1 } = this;
    const W = this.map.width, H = this.map.height;
    const ep = ++this.epoch;
    const ts = this.tstamp;
    let box = null;
    const n = verts.n !== undefined ? verts.n : verts.length;
    const arr = verts.a || verts;
    for (let k = 0; k < n; k++) {
      const v = arr[k];
      const vx = v % W1, vy = (v - vx) / W1;
      for (let ty = vy - 1; ty <= vy; ty++) {
        if (ty < 0 || ty >= H) continue;
        for (let tx = vx - 1; tx <= vx; tx++) {
          if (tx < 0 || tx >= W) continue;
          const i = ty * W + tx;
          if (ts[i] === ep) continue;
          ts[i] = ep;
          if (this.retileOne(op, tx, ty)) {
            if (!box) box = { x0: tx, y0: ty, x1: tx, y1: ty };
            else { if (tx < box.x0) box.x0 = tx; if (ty < box.y0) box.y0 = ty; if (tx > box.x1) box.x1 = tx; if (ty > box.y1) box.y1 = ty; }
          }
        }
      }
    }
    return box;
  }

  retileOne(op, tx, ty) {
    const { V, W1, layer } = this;
    const i = ty * this.map.width + tx;
    const a = ty * W1 + tx;
    const ta = V[a], tb = V[a + 1], tc = V[a + W1], td = V[a + W1 + 1];
    if (ta === NONE || tb === NONE || tc === NONE || td === NONE) return false;
    const cur = layer.data[i];
    const cl = this.localOf(cur);
    if (cl >= 0 && !layer.flips.has(i)) {
      const T = this.tupleOf;
      if (T[cl * 4] === ta && T[cl * 4 + 1] === tb && T[cl * 4 + 2] === tc && T[cl * 4 + 3] === td) return false;
    }
    let l = this.lut[this.key(ta, tb, tc, td)];
    if (l < 0) l = this.nearest(ta, tb, tc, td);
    op.tile(layer, i, cur, layer.flips.get(i) || 0, this.ts.firstgid + l, 0);
    return true;
  }

  retileRect(op, x0, y0, x1, y1) {
    const W = this.map.width, H = this.map.height;
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) this.retileOne(op, x, y);
  }

  nearest(a, b, c, d) {
    let best = null, bc = 9;
    for (const tp of this.tuples) {
      const t = tp.t;
      const cost = (t[0] !== a) + (t[1] !== b) + (t[2] !== c) + (t[3] !== d);
      if (cost < bc) { bc = cost; best = tp; if (!cost) break; }
    }
    return best ? best.id : 0;
  }

  // 大面积直接改角点之后用：在矩形范围内整体修正过渡（两边同时向中间让步），再重铺
  repairRect(op, x0, y0, x1, y1) {
    const { W1, H1, K, dist, nxt } = this;
    const V = this.V;
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W1 - 1, x1 + 1); y1 = Math.min(H1 - 1, y1 + 1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const best = new Uint8Array(w * h), tgt = new Uint8Array(w * h);
    for (let pass = 0; pass < 80; pass++) {
      let viol = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = (y0 + y) * W1 + x0 + x, tv = V[v];
        let b = 0, t = tv;
        if (tv !== NONE) {
          for (let dy = -1; dy <= 1; dy++) {
            const uy = y0 + y + dy; if (uy < 0 || uy >= H1) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const ux = x0 + x + dx; if (ux < 0 || ux >= W1) continue;
              const tu = V[uy * W1 + ux]; if (tu === NONE) continue;
              const d = dist[tv * K + tu];
              if (d > b && d < FAR) { b = d; t = tu; }
            }
          }
        }
        best[y * w + x] = b; tgt[y * w + x] = t;
        if (b > 1) viol++;
      }
      if (!viol) break;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (best[k] > 1) { const v = (y0 + y) * W1 + x0 + x; const nt = nxt[V[v] * K + tgt[k]]; op.vert(v, V[v], nt); V[v] = nt; }
      }
    }
    // 棋盘组合
    const ep = ++this.epoch;
    const queue = new Grow(), chg = new Grow();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) chg.push(y * W1 + x);
    this.fixSaddles(op, queue, chg, ep, 0);
    this.retileRect(op, x0 - 1, y0 - 1, x1, y1);
  }

  // 油漆桶：把与 (vx,vy) 相连的同种地形角点全部换成 t；global=true 时换掉整张图上这种地形
  fill(op, vx, vy, t, global = false, limitBox = null) {
    const { V, W1, H1 } = this;
    const start = this.terrainAtVertex(vx, vy);
    if (start === NONE || start === t) return null;
    const out = new Grow(4096);
    if (global) {
      for (let v = 0; v < V.length; v++) if (V[v] === start) out.push(v);
    } else {
      const seen = new Uint8Array(V.length);
      const st = new Grow(4096);
      const s0 = vy * W1 + vx; st.push(s0); seen[s0] = 1;
      while (st.n) {
        const v = st.a[--st.n];
        out.push(v);
        const x = v % W1, y = (v - x) / W1;
        if (limitBox && (x < limitBox.x0 || x > limitBox.x1 || y < limitBox.y0 || y > limitBox.y1)) continue;
        const nb = [x > 0 ? v - 1 : -1, x < W1 - 1 ? v + 1 : -1, y > 0 ? v - W1 : -1, y < H1 - 1 ? v + W1 : -1];
        for (const u of nb) if (u >= 0 && !seen[u] && V[u] === start) { seen[u] = 1; st.push(u); }
      }
    }
    if (out.n > 200000) { op.snapV(); op.snapLayer(this.layer); }
    return this.paint(op, out.view(), t);
  }

  // 新建地图时整图填满（不记撤销）
  fillAll(t) {
    this.V.fill(t);
    this.layer.data.fill(this.solidGid(t));
    this.layer.flips.clear();
    this.layer.dirty = true;
  }
}
