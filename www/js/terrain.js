// 地形自动过渡引擎
// 思路：地图有 (W+1)x(H+1) 个“角点”，每个角点属于一种地形；
// 每个格子的图块由它四个角(左上,右上,左下,右下)的地形决定。
// 图块集里只有“相邻地形”之间有过渡图块，所以画地形时要自动插入中间地形。

export const NONE = 255;

export const TERRAIN_CN = {
  'Deep Water': '深水', 'Water': '水', 'Shallow Water': '浅水', 'Water Bridge': '浅滩',
  'Sand': '沙地', 'Grass': '草地', 'Dirt': '泥土', 'Snow': '雪地', 'Tree': '树林',
  'Cliff': '悬崖', 'Ice': '冰面', 'Swamp': '沼泽', 'Dirt Cliff': '泥土悬崖', 'Dune': '沙丘',
  'Frozen Trees': '冰冻树林', 'Lake': '湖泊', 'Ice Lake': '冰湖', 'Lava': '岩浆', 'Stone': '石地',
};

export class TerrainEngine {
  constructor(map, ts, layer) {
    this.map = map;
    this.ts = ts;
    this.layer = layer;
    this.K = ts.terrainNames.length;
    const K = this.K;
    this.names = ts.terrainNames;
    this.lut = new Int16Array(K * K * K * K).fill(-1);
    this.tuples = []; // [{key, t:[4], id}]
    this.tupleOf = new Int16Array(ts.tilecount * 4).fill(-1);
    const byKey = new Map();
    for (const [id, info] of ts.tiles) {
      const t = info.terrain;
      if (!t || t.some((v) => v < 0 || v >= K)) continue;
      if (id >= ts.tilecount) continue;
      for (let c = 0; c < 4; c++) this.tupleOf[id * 4 + c] = t[c];
      const key = this.key(t[0], t[1], t[2], t[3]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(id);
    }
    for (const [key, ids] of byKey) {
      ids.sort((a, b) => a - b);
      let pick = ids[0];
      const first = this.tupleOf[ids[0] * 4];
      const uniform = [1, 2, 3].every((c) => this.tupleOf[ids[0] * 4 + c] === first);
      if (uniform && ids.includes(ts.terrainRep[first])) pick = ts.terrainRep[first];
      this.lut[key] = pick;
      this.tuples.push({ key, t: [0, 1, 2, 3].map((c) => this.tupleOf[ids[0] * 4 + c]), id: pick });
    }
    // 地形邻接图 -> 距离与下一跳
    const adj = Array.from({ length: K }, () => new Array(K).fill(false));
    for (const { t } of this.tuples) {
      const s = [...new Set(t)];
      if (s.length === 2) { adj[s[0]][s[1]] = adj[s[1]][s[0]] = true; }
    }
    this.adj = adj;
    this.dist = new Uint8Array(K * K).fill(99);
    this.nxt = new Uint8Array(K * K);
    for (let a = 0; a < K; a++) {
      this.dist[a * K + a] = 0; this.nxt[a * K + a] = a;
      const hop = new Int16Array(K).fill(-1); hop[a] = a;
      const q = [a];
      while (q.length) {
        const u = q.shift();
        for (let v = 0; v < K; v++) {
          if (adj[u][v] && this.dist[a * K + v] === 99) {
            this.dist[a * K + v] = this.dist[a * K + u] + 1;
            hop[v] = u === a ? v : hop[u];
            q.push(v);
          }
        }
      }
      for (let v = 0; v < K; v++) if (hop[v] >= 0) this.nxt[a * K + v] = hop[v];
    }
    // 可直接使用（有纯色图块）的地形
    this.paintable = [];
    for (let a = 0; a < K; a++) if (this.lut[this.key(a, a, a, a)] >= 0) this.paintable.push(a);

    this.W1 = map.width + 1;
    this.H1 = map.height + 1;
    this.V = new Uint8Array(this.W1 * this.H1).fill(NONE);
    this.pin = new Uint32Array(this.V.length);
    this.tstamp = new Uint32Array(map.width * map.height);
    this.epoch = 0;
    this.initFromLayer();
  }

  key(a, b, c, d) { const K = this.K; return ((a * K + b) * K + c) * K + d; }
  name(t) { return this.names[t]; }
  cn(t) { return TERRAIN_CN[this.names[t]] || this.names[t]; }
  pathBetween(a, b) {
    const K = this.K; const p = [a];
    let cur = a, guard = 0;
    while (cur !== b && guard++ < K) { cur = this.nxt[cur * K + b]; p.push(cur); }
    return p;
  }

  localOf(gid) {
    const l = gid - this.ts.firstgid;
    return (l >= 0 && l < this.ts.tilecount && this.tupleOf[l * 4] >= 0) ? l : -1;
  }

  initFromLayer() {
    const { map, layer, V, W1 } = this;
    const W = map.width, H = map.height, d = layer.data, T = this.tupleOf;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const l = this.localOf(d[y * W + x]);
        if (l < 0 || layer.flips.has(y * W + x)) continue;
        const v = y * W1 + x;
        if (V[v] === NONE) V[v] = T[l * 4];
        if (V[v + 1] === NONE) V[v + 1] = T[l * 4 + 1];
        if (V[v + W1] === NONE) V[v + W1] = T[l * 4 + 2];
        if (V[v + W1 + 1] === NONE) V[v + W1 + 1] = T[l * 4 + 3];
      }
    }
  }

  // 整张图重新从图层建立角点（尺寸改变后用）
  rebuild() {
    this.W1 = this.map.width + 1; this.H1 = this.map.height + 1;
    this.V = new Uint8Array(this.W1 * this.H1).fill(NONE);
    this.pin = new Uint32Array(this.V.length);
    this.tstamp = new Uint32Array(this.map.width * this.map.height);
    this.initFromLayer();
  }

  terrainAtVertex(vx, vy) {
    if (vx < 0 || vy < 0 || vx >= this.W1 || vy >= this.H1) return NONE;
    return this.V[vy * this.W1 + vx];
  }

  // 把一组角点设为地形 t，自动插入过渡并重铺受影响的格子
  // op：撤销记录（见 editor.js 的 Op）
  paint(op, verts, t) {
    const { V, W1, H1, K, dist, nxt } = this;
    const ep = ++this.epoch;
    const pin = this.pin;
    const queue = [];
    const chg = [];
    for (let k = 0; k < verts.length; k++) {
      const v = verts[k];
      if (pin[v] === ep) continue;
      pin[v] = ep;
      if (V[v] !== t) { op.vert(v, V[v], t); V[v] = t; chg.push(v); }
      queue.push(v);
    }
    let guard = 0;
    const limit = 40 * (queue.length + 1000);
    const propagate = () => {
      while (queue.length) {
        if (++guard > limit) { queue.length = 0; break; }
        const v = queue.pop();
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
            if (dist[tv * K + tu] > 1) {
              const nt = nxt[tu * K + tv];
              op.vert(u, tu, nt); V[u] = nt; chg.push(u); queue.push(u);
            }
          }
        }
      }
    };
    propagate();
    // 处理“对角棋盘”这类图块集里没有的组合
    let start = 0;
    for (let round = 0; round < 12; round++) {
      let fixed = 0;
      const end = chg.length;
      for (let k = start; k < end; k++) {
        const v = chg[k];
        const vx = v % W1, vy = (v - vx) / W1;
        for (let ty = vy - 1; ty <= vy; ty++) {
          for (let tx = vx - 1; tx <= vx; tx++) {
            if (tx < 0 || ty < 0 || tx >= W1 - 1 || ty >= H1 - 1) continue;
            const a = ty * W1 + tx, b = a + 1, c = a + W1, d = c + 1;
            const ta = V[a], tb = V[b], tc = V[c], td = V[d];
            if (ta === NONE || tb === NONE || tc === NONE || td === NONE) continue;
            if (this.lut[this.key(ta, tb, tc, td)] >= 0) continue;
            if (dist[ta * K + tb] > 1 || dist[ta * K + tc] > 1 || dist[ta * K + td] > 1 ||
                dist[tb * K + tc] > 1 || dist[tb * K + td] > 1 || dist[tc * K + td] > 1) continue;
            // 依次尝试改一个未被固定的角
            const tries = [[b, ta], [c, ta], [a, tb], [d, tc]];
            for (const [u, nt] of tries) {
              if (pin[u] === ep || V[u] === nt) continue;
              op.vert(u, V[u], nt); V[u] = nt; chg.push(u); queue.push(u); fixed++;
              break;
            }
          }
        }
      }
      start = end;
      if (!fixed) break;
      propagate();
    }
    return this.retileAround(op, chg);
  }

  // 重铺这些角点周围的格子；返回受影响的格子范围
  retileAround(op, verts) {
    const { V, W1, map, layer } = this;
    const W = map.width, H = map.height;
    const ep = ++this.epoch;
    const ts = this.tstamp;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let k = 0; k < verts.length; k++) {
      const v = verts[k];
      const vx = v % W1, vy = (v - vx) / W1;
      for (let ty = vy - 1; ty <= vy; ty++) {
        if (ty < 0 || ty >= H) continue;
        for (let tx = vx - 1; tx <= vx; tx++) {
          if (tx < 0 || tx >= W) continue;
          const i = ty * W + tx;
          if (ts[i] === ep) continue;
          ts[i] = ep;
          const a = ty * W1 + tx;
          const ta = V[a], tb = V[a + 1], tc = V[a + W1], td = V[a + W1 + 1];
          if (ta === NONE || tb === NONE || tc === NONE || td === NONE) continue;
          const cur = layer.data[i];
          const cl = this.localOf(cur);
          if (cl >= 0 && !layer.flips.has(i)) {
            const T = this.tupleOf;
            if (T[cl * 4] === ta && T[cl * 4 + 1] === tb && T[cl * 4 + 2] === tc && T[cl * 4 + 3] === td) continue;
          }
          let l = this.lut[this.key(ta, tb, tc, td)];
          if (l < 0) l = this.nearest(ta, tb, tc, td);
          op.tile(layer, i, cur, layer.flips.get(i) || 0, this.ts.firstgid + l, 0);
          if (tx < x0) x0 = tx; if (ty < y0) y0 = ty; if (tx > x1) x1 = tx; if (ty > y1) y1 = ty;
        }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
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

  // 用整个地形填满（新建地图用），不记撤销
  fillAll(t) {
    this.V.fill(t);
    const gid = this.ts.firstgid + this.lut[this.key(t, t, t, t)];
    this.layer.data.fill(gid);
    this.layer.flips.clear();
    this.layer.dirty = true;
  }

  // 直接放置一个图块后同步角点（不传播）
  syncTile(op, x, y) {
    const W = this.map.width, W1 = this.W1;
    const i = y * W + x;
    const l = this.localOf(this.layer.data[i]);
    const vs = [y * W1 + x, y * W1 + x + 1, (y + 1) * W1 + x, (y + 1) * W1 + x + 1];
    for (let c = 0; c < 4; c++) {
      const nt = l >= 0 ? this.tupleOf[l * 4 + c] : NONE;
      if (this.V[vs[c]] !== nt) { op.vert(vs[c], this.V[vs[c]], nt); this.V[vs[c]] = nt; }
    }
  }
}
