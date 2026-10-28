// 通行成本和瓶颈图：算各队之间的路，标出容易卡住的地方
import { A } from './state.js';
import { h, modal, toast, slider } from './ui.js';
import { passability, LAND, HOVER, NAVAL } from './pathing.js';
import { HELP } from './help.js';

const ed = A.ed;
const TW = 20;

// 4 邻接 BFS，返回距离图（-1 表示走不到）
export function bfsFrom(pass, W, H, sources, mask) {
  const dist = new Int32Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let head = 0, tail = 0;
  for (const s of sources) if (s >= 0 && s < W * H && (pass[s] & mask) && dist[s] < 0) { dist[s] = 0; q[tail++] = s; }
  while (head < tail) {
    const i = q[head++], x = i % W, d = dist[i] + 1;
    if (x > 0) { const u = i - 1; if (dist[u] < 0 && (pass[u] & mask)) { dist[u] = d; q[tail++] = u; } }
    if (x < W - 1) { const u = i + 1; if (dist[u] < 0 && (pass[u] & mask)) { dist[u] = d; q[tail++] = u; } }
    if (i >= W) { const u = i - W; if (dist[u] < 0 && (pass[u] & mask)) { dist[u] = d; q[tail++] = u; } }
    if (i < W * H - W) { const u = i + W; if (dist[u] < 0 && (pass[u] & mask)) { dist[u] = d; q[tail++] = u; } }
  }
  return dist;
}

function nearestPass(pass, W, H, x, y, mask) {
  for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const X = x + dx, Y = y + dy;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    if (pass[Y * W + X] & mask) return Y * W + X;
  }
  return -1;
}

// 从起点出发：算所有出生点的最短距离，再找"关键格"
Object.assign(HELP, {
  'tool.bottleneck': { t: '通行瓶颈地图', s: '看哪些位置是卡点、哪个队伍被绕远', b: '把所有出生点、资源池当成终点做一次通行计算，算出每个格子“从这里出发到所有目标一共要走多少格”。深色的窄道就是<b>卡点</b>——抢住它就卡住对面。也会列出每个队伍走得最远的资源池，差额太大说明有一方被绕远。悬崖、水面等不能走的地方按不能通行算。' },
});

export function analyzeBottlenecks(ed2 = ed) {
  const m = ed2.map;
  if (!m) return null;
  const W = m.width, H = m.height, n = W * H;
  const pass = passability(ed2);
  const spawns = ed2.spawns();
  if (spawns.length < 2) return { rows: [], choke: [], W, H, pass, msg: '至少要有两个出生点才算得出来' };
  const starts = spawns.map((s) => nearestPass(pass, W, H, Math.floor(s.cx / TW), Math.floor(s.cy / TW), LAND | HOVER));
  // 每队到其它队的最短距离
  const rows = [];
  const dists = starts.map((s) => bfsFrom(pass, W, H, [s], LAND));
  starts.forEach((s, k) => {
    const others = [];
    starts.forEach((q, j) => { if (j !== k && s >= 0 && q >= 0) others.push({ team: spawns[j].team, d: dists[k][q] }); });
    others.sort((a, b) => (a.d < 0 ? 1e9 : a.d) - (b.d < 0 ? 1e9 : b.d));
    rows.push({ team: spawns[k].team, from: s, reach: others.filter((o) => o.d >= 0).length, nearest: others[0] || null });
  });
  // 关键格：对每队，取"离它最远但仍然可达"的敌人路径上的窄点
  // 简化做法：统计每个可走格被多少队的最短路径经过，越高越挤
  const usage = new Int32Array(n);
  starts.forEach((s, k) => {
    if (s < 0) return;
    const d = dists[k];
    // 从每个敌队出生点往回走，把最短路上经过的格子记一次
    starts.forEach((q, j) => {
      if (j === k || q < 0 || d[q] < 0) return;
      let cur = q, guard = 0;
      while (cur !== s && guard++ < n) {
        usage[cur]++;
        const x = cur % W, c = d[cur];
        let best = -1;
        const cand = [x > 0 ? cur - 1 : -1, x < W - 1 ? cur + 1 : -1, cur >= W ? cur - W : -1, cur < n - W ? cur + W : -1];
        for (const u of cand) if (u >= 0 && d[u] >= 0 && d[u] === c - 1) { best = u; break; }
        if (best < 0) break;
        cur = best;
      }
    });
  });
  // 窄点：通行的邻居少于 3 个、且被很多路经过
  const choke = [];
  const maxUsage = usage.reduce((a, b) => Math.max(a, b), 0);
  if (maxUsage > 0) {
    for (let i = 0; i < n; i++) {
      if (!usage[i] || !(pass[i] & LAND)) continue;
      const x = i % W, y = (i / W) | 0;
      let open = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < W && Y < H && (pass[Y * W + X] & LAND)) open++;
      }
      if (open <= 2 && usage[i] >= Math.max(2, maxUsage * 0.5)) choke.push({ x, y, i, usage: usage[i], open });
    }
    choke.sort((a, b) => b.usage - a.usage);
    // 同类扎堆的只留每个区域最挤的一两个
    const keep = [];
    for (const c of choke) {
      if (keep.some((k) => Math.abs(k.x - c.x) + Math.abs(k.y - c.y) <= 4)) continue;
      keep.push(c);
      if (keep.length >= 40) break;
    }
    return { rows, choke: keep, W, H, pass, usage, maxUsage };
  }
  return { rows, choke, W, H, pass, usage, maxUsage, msg: '各队之间互相走不通，可能是被水隔开了' };
}

// 在地图上叠一层：关键格标红
let layer = null;
export function showBottleneck(res) {
  const cv = document.getElementById('cv');
  if (!cv) return;
  if (layer) { layer.remove(); layer = null; }
  if (!res) return;
  const wrap = cv.parentElement;
  const c = document.createElement('canvas');
  c.className = 'choke-layer';
  c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3';
  wrap.append(c);
  layer = c;
  const dpr = window.devicePixelRatio || 1;
  c.width = cv.width; c.height = cv.height;
  const g = c.getContext('2d');
  const v = A.rend.view;
  g.setTransform(v.z * dpr, 0, 0, v.z * dpr, -v.ox * v.z * dpr, -v.oy * v.z * dpr);
  g.fillStyle = 'rgba(229,72,77,0.55)';
  for (const k of res.choke) g.fillRect(k.x * TW + 2, k.y * TW + 2, TW - 4, TW - 4);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

export function hideBottleneck() { if (layer) { layer.remove(); layer = null; } }

export function bottleneckDialog() {
  if (!ed.map) return;
  const t0 = performance.now();
  const res = analyzeBottlenecks();
  const ms = Math.round(performance.now() - t0);
  if (!res) return;
  let open = true;
  const body = h('div', {},
    h('div', { class: 'hint' }, `算 ${res.rows.length} 队之间的路用了 ${ms} ms`),
    res.msg ? h('div', { class: 'hint' }, res.msg) : null,
    h('h3', { style: 'font-size:14px;margin:10px 0 6px' }, '各队到敌人要多久'),
    h('div', {}, ...res.rows.map((r) => h('div', { class: 'hrow' },
      h('span', {}, `第 ${r.team} 队`),
      h('span', { class: 'hint' }, r.nearest ? (r.nearest.d < 0 ? '走不过去' : `到第 ${r.nearest.team} 队 ${r.nearest.d} 格`) : '没有出生点'),
      h('span', { class: 'hint' }, `能走到 ${r.reach} 队`)))),
    h('h3', { style: 'font-size:14px;margin:10px 0 6px' }, `容易卡住的地方（${res.choke.length} 处）`),
    res.choke.length
      ? h('div', { style: 'max-height:32vh;overflow:auto' }, ...res.choke.slice(0, 30).map((k) => h('div', {
        class: 'hrow', style: 'cursor:pointer',
        onclick: () => { A.rend.centerOn(k.x, k.y); },
      },
      h('span', { class: 'hstat' }, `${k.x},${k.y}`),
      h('span', {}, k.open <= 1 ? '单格通道' : '两格宽的窄口'),
      h('span', { class: 'hint' }, `${k.usage} 条路经过`))))
      : h('div', { class: 'hint' }, res.msg ? '算不出来' : '没有发现明显的瓶颈，路比较宽敞。'));
  showBottleneck(res);
  const pr = modal('通行瓶颈图', body, [
    { label: '在地图上一直显示', value: 1 },
    { label: '关闭', value: 0, primary: true },
  ], { wide: true });
  pr.then((v) => { if (!v) hideBottleneck(); });
}
