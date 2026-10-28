// 曲线工具：点几个控制点，画一条带锥度的河 / 路
// 只改地面层（河）或地面 + 物品（路），一次落笔 = 一步撤销
import { A } from './state.js';
import { h, toast } from './ui.js';
import { icon } from './icons.js';
import { HELP } from './help.js';

const ed = A.ed;
const TW = 20;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------- 曲线采样 ----------------
// 控制点用「格」为单位（可以带小数）。返回穿过每个控制点的密集折线（同样是格）。
// 数学上：相邻两点之间用三次贝塞尔，切线取 Catmull-Rom，所以曲线一定经过每个控制点。
export function bezierPath(pts, samples = 16) {
  const p = (pts || []).filter((q) => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]));
  if (!p.length) return [];
  if (p.length === 1) return [[+p[0][0], +p[0][1]]];
  const S = Math.max(1, samples | 0);
  const at = (i) => p[clamp(i, 0, p.length - 1)];
  const out = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    // Catmull-Rom 切线 → 贝塞尔手柄
    const h1x = p1[0] + (p2[0] - p0[0]) / 6, h1y = p1[1] + (p2[1] - p0[1]) / 6;
    const h2x = p2[0] - (p3[0] - p1[0]) / 6, h2y = p2[1] - (p3[1] - p1[1]) / 6;
    for (let k = 0; k < S; k++) {
      const t = k / S, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p1[0] + b * h1x + c * h2x + d * p2[0], a * p1[1] + b * h1y + c * h2y + d * p2[1]]);
    }
  }
  const last = p[p.length - 1];
  out.push([+last[0], +last[1]]);
  return out;
}

// 折线总长（格）
export function pathLength(path) {
  let L = 0;
  for (let k = 1; k < path.length; k++) L += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
  return L;
}

// ---------------- 落笔 ----------------
// kind: 'river' 画河（水 + 浅水边）；'road' 画路（泥土，过水变浅滩）
// taper: 0 = 等宽，1 = 尾端收成一个点
function radiusAt(t, half, taper) {
  return Math.max(0.35, half * (1 - clamp(taper, 0, 1) * clamp(t, 0, 1)));
}

export function strokeCurve(ed2 = ed, opts = {}) {
  const { width = 4, kind = 'river', taper = 0, samples = 24, avoid = true, pts = [] } = opts;
  if (!ed2 || !ed2.map) return { ok: false, reason: 'no-map' };
  if (pts.length < 2) return { ok: false, reason: 'need-points' };
  const eng = ed2.engine;
  if (!eng) return { ok: false, reason: 'no-engine' };
  const m = ed2.map, W = m.width, H = m.height;
  const path = bezierPath(pts, samples);
  if (path.length < 2) return { ok: false, reason: 'need-points' };

  // 逐段按“圆心半径”铺格子：核心 2（水/土），边缘 1（浅水）
  const half = Math.max(0.5, width / 2);
  const rMax = radiusAt(0, half, taper);
  const len = pathLength(path);
  const cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
  const total = Math.max(1e-6, len);

  // 要避开的东西：出生点周围 2 格、资源池格。
  // 注意格子归属由 4 个角点决定，所以保护要落在**角点**上，否则旁边的角点一改，
  // 出生点 / 资源池的图块还是会跟着变（踩过这个坑）。
  const noGo = new Set();
  const guardV = new Set();
  if (avoid) {
    const mark = (tx, ty, rad) => {
      for (let y = ty - rad; y <= ty + rad; y++) for (let x = tx - rad; x <= tx + rad; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) noGo.add(y * W + x);
      }
      // 这圈格子的四个角点全保护起来
      for (let y = ty - rad; y <= ty + rad + 1; y++) for (let x = tx - rad; x <= tx + rad + 1; x++) {
        if (x >= 0 && y >= 0 && x < eng.W1 && y < eng.H1) guardV.add(y * eng.W1 + x);
      }
    };
    for (const sp of ed2.spawns()) mark(Math.floor(sp.cx / TW), Math.floor(sp.cy / TW), 2);
    for (const [x, y] of ed2.poolTiles()) mark(x, y, 1);
  }

  const cells = new Map(); // i -> 2 核心 / 1 边缘
  for (let k = 1; k < path.length; k++) {
    const [ax, ay] = path[k - 1], [bx, by] = path[k];
    const dx = bx - ax, dy = by - ay;
    const segLen2 = dx * dx + dy * dy;
    if (segLen2 < 1e-9) continue;
    const segLen = Math.sqrt(segLen2);
    const r0 = radiusAt(cum[k - 1] / total, half, taper), r1 = radiusAt(cum[k] / total, half, taper);
    const rr = Math.max(r0, r1);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rr - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + rr + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rr - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + rr + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = clamp(((px - ax) * dx + (py - ay) * dy) / segLen2, 0, 1);
      const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
      const r = radiusAt((cum[k - 1] + t * segLen) / total, half, taper);
      if (d > r) continue;
      const i = y * W + x;
      if (noGo.has(i)) continue;
      const cls = d <= r * 0.62 ? 2 : 1;
      if ((cells.get(i) || 0) < cls) cells.set(i, cls);
    }
  }
  if (!cells.size) return { ok: false, reason: 'no-cells' };

  // 地形编号
  const can = (t) => t >= 0 && (!eng.paintable || eng.paintable.includes(t));
  const idxOf = (...names) => { for (const n of names) { const t = eng.index(n); if (can(t)) return t; } return -1; };
  const water = idxOf('Water', 'Shallow Water', 'Deep Water');
  const shallow = idxOf('Shallow Water', 'Water');
  const ford = idxOf('Water Bridge', 'Shallow Water');
  const dirt = idxOf('Dirt', 'Sand');

  // 角点值：核心优先，边缘只填外围
  const vCls = new Map(); // 角点 -> 2/1
  for (const [i, cls] of cells) {
    const x = i % W, y = (i - x) / W;
    for (const [vx, vy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
      const v = vy * eng.W1 + vx;
      if (guardV.has(v)) continue;
      if ((vCls.get(v) || 0) < cls) vCls.set(v, cls);
    }
  }
  const verts = [], vals = [];
  for (const [v, cls] of vCls) {
    const cur = eng.V[v], nm = eng.name(cur) || '';
    let t = -1;
    if (kind === 'river') t = cls === 2 ? water : shallow;
    else {
      // 路：水上架浅滩，其余铺泥土（和「道路工具」的处理一致）
      const isWater = /water|lake/i.test(nm) && !/bridge/i.test(nm);
      t = isWater ? ford : dirt;
    }
    if (t < 0 || t === cur) continue;
    verts.push(v); vals.push(t);
  }

  ed2.begin(kind === 'river' ? '画曲线河' : '画曲线路');
  let box = null;
  try {
    if (verts.length) box = eng.paint(ed2.op, verts, vals);
    // 带子里的树/装饰清掉（资源池不动）
    const I = m.items;
    if (I && I.data) {
      for (const i of cells.keys()) {
        const g = I.data[i];
        if (!g || (ed2.poolGids && ed2.poolGids.has(g))) continue;
        const x = i % W, y = (i - x) / W;
        ed2.setTile(I, x, y, 0);
      }
    }
  } finally {
    ed2.commit();
  }
  const r = A.rend;
  if (r) {
    if (box && typeof box.x0 === 'number') r.invalidate(box.x0 - 1, box.y0 - 1, box.x1 + 2, box.y1 + 2);
    else r.invalidateAll();
    r.pools = ed2.poolTiles();
    r.request();
  }
  if (A.mini && A.mini.schedule) A.mini.schedule();
  return { ok: true, kind, cells: cells.size, verts: verts.length, length: len, width };
}

// ---------------- 地图上的预览层 ----------------
let layer = null, raf = 0, key = '';
let preview = { pts: [], width: 4, taper: 0, kind: 'river' };

function ensureLayer() {
  const cv = document.getElementById('cv');
  if (!cv) return null;
  if (!layer || !layer.isConnected) {
    layer = document.createElement('canvas');
    layer.className = 'curve-layer';
    layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4';
    (cv.parentElement || document.getElementById('stage')).append(layer);
  }
  return layer;
}

function draw() {
  const cv = document.getElementById('cv');
  if (!layer || !cv) return;
  const dpr = window.devicePixelRatio || 1;
  layer.width = cv.width; layer.height = cv.height;
  layer.style.width = cv.clientWidth + 'px'; layer.style.height = cv.clientHeight + 'px';
  const g = layer.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, layer.width, layer.height);
  const v = A.rend.view;
  g.setTransform(v.z * dpr, 0, 0, v.z * dpr, -v.ox * v.z * dpr, -v.oy * v.z * dpr);
  const path = bezierPath(preview.pts, 24);
  if (path.length > 1) {
    // 带子：沿曲线一段段画粗线，宽度按锥度变化
    const total = Math.max(1e-6, pathLength(path));
    let acc = 0;
    for (let k = 1; k < path.length; k++) {
      const [ax, ay] = path[k - 1], [bx, by] = path[k];
      const seg = Math.hypot(bx - ax, by - ay);
      acc += seg;
      const w = preview.width * (1 - preview.taper * (acc / total));
      g.strokeStyle = preview.kind === 'river' ? 'rgba(80,170,255,0.32)' : 'rgba(200,160,110,0.34)';
      g.lineWidth = Math.max(0.1, w) * TW;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(ax * TW, ay * TW); g.lineTo(bx * TW, by * TW); g.stroke();
    }
    // 中线虚线
    g.setLineDash([5 / v.z, 5 / v.z]);
    g.lineWidth = 1.4 / v.z;
    g.strokeStyle = preview.kind === 'river' ? 'rgba(140,210,255,0.95)' : 'rgba(240,200,140,0.95)';
    g.beginPath();
    path.forEach(([x, y], k) => (k ? g.lineTo(x * TW, y * TW) : g.moveTo(x * TW, y * TW)));
    g.stroke();
    g.setLineDash([]);
  }
  // 控制点
  preview.pts.forEach(([x, y], k) => {
    g.fillStyle = k === 0 ? '#7ee787' : '#ffd34d';
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = 1.5 / v.z;
    g.beginPath(); g.arc(x * TW, y * TW, 4.5 / v.z, 0, Math.PI * 2); g.fill(); g.stroke();
  });
}

function loop() {
  const tick = () => {
    const v = A.rend.view, cv = document.getElementById('cv');
    const k = `${v.ox},${v.oy},${v.z},${cv ? cv.width : 0},${preview.pts.length},${preview.width},${preview.taper},${preview.kind}`;
    if (k !== key) { key = k; draw(); }
    raf = requestAnimationFrame(tick);
  };
  if (!raf) raf = requestAnimationFrame(tick);
}

function stopLayer() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0; key = '';
  if (layer) { layer.remove(); layer = null; }
}

// ---------------- 对话框（非模态面板：可以一边看地图一边调） ----------------
export function curvesDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (!ed.engine) { toast('这张图没有地形图层，画不了曲线'); return; }
  document.querySelector('.curve-panel')?.remove();
  const st = { pts: [], width: 4, taper: 0.35, kind: 'river' };
  preview = update();
  function update() { return { pts: st.pts.slice(), width: st.width, taper: st.taper, kind: st.kind }; }

  const cnt = h('b', {}, '0');
  const lenTxt = h('span', {}, '—');
  const hint = h('div', { style: 'font-size:12px;color:var(--muted);line-height:1.6' },
    '在地图上依次点控制点，曲线会穿过每个点；Esc 关掉面板。');

  const refresh = () => {
    preview = update();
    cnt.textContent = String(st.pts.length);
    lenTxt.textContent = st.pts.length < 2 ? '—' : pathLength(bezierPath(st.pts, 24)).toFixed(1) + ' 格';
    ensureLayer(); loop(); draw();
  };

  let wTxt, tpTxt;
  const bar = h('div', { class: 'floatbar', style: 'min-width:280px' },
    h('span', { class: 'info' }, '点地图加控制点'),
    h('button', {
      onclick: () => {
        if (!st.pts.length) return;
        st.pts.pop(); refresh();
      },
    }, '撤销上一点'),
    h('button', { onclick: () => { st.pts.length = 0; refresh(); } }, '清空'));

  const panel = h('div', { class: 'curve-panel' }, h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' },
    h('b', { style: 'flex:1' }, '曲线工具'), h('button', { class: 'ghost', onclick: () => close() }, '关闭')),
    h('div', { style: 'display:flex;gap:6px;margin-bottom:8px' },
      h('button', { class: st.kind === 'river' ? 'primary' : '', onclick: () => { st.kind = 'river'; paintBtns(); refresh(); } }, '画河'),
      h('button', { class: st.kind === 'road' ? 'primary' : '', onclick: () => { st.kind = 'road'; paintBtns(); refresh(); } }, '画路')),
    row('线宽', h('input', {
      type: 'range', min: '1', max: '24', step: '0.5', value: String(st.width), style: 'flex:1',
      oninput: (e) => { st.width = +e.target.value; wTxt.textContent = st.width + ' 格'; refresh(); },
    }), (wTxt = h('span', { style: 'width:52px;text-align:right;font-size:12px' }, st.width + ' 格'))),
    row('起止渐变', h('input', {
      type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(st.taper * 100)), style: 'flex:1',
      oninput: (e) => { st.taper = +e.target.value / 100; tpTxt.textContent = Math.round(st.taper * 100) + '%'; refresh(); },
    }), (tpTxt = h('span', { style: 'width:52px;text-align:right;font-size:12px' }, Math.round(st.taper * 100) + '%'))),
    h('div', { style: 'font-size:12px;color:var(--muted);margin:6px 0;line-height:1.6' },
      '控制点 ', cnt, ' 个，曲线长 ', lenTxt, '。起止渐变 = 尾端收到多细。'),
    hint,
    h('div', { style: 'display:flex;gap:6px;margin-top:10px' },
      h('button', { class: 'primary', style: 'flex:1', onclick: () => apply(st) }, '落笔'),
      h('button', { onclick: () => { st.pts.length = 0; refresh(); } }, '清空')));

  function row(label, inp, tail) {
    return h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' },
      h('span', { style: 'width:64px;font-size:12px' }, label), inp, tail);
  }
  function paintBtns() {
    const btns = panel.querySelectorAll('div button');
    // 前两个是关闭之外的“画河/画路”，由 onclick 重新绑定状态样式
    for (const b of btns) {
      const t = b.textContent;
      if (t === '画河' || t === '画路') b.className = (t === '画河' ? 'river' : 'road') === st.kind ? 'primary' : '';
    }
  }

  panel.style.cssText = 'position:fixed;left:60px;top:56px;width:300px;z-index:60;background:var(--panel,#171b22);'
    + 'border:1px solid var(--line,#2a2f3a);border-radius:10px;padding:12px;box-shadow:0 12px 32px rgba(0,0,0,.5);font-size:13px';
  document.body.append(panel);

  // 取点：交给 input.js 的 pick 模式（A.pickPoint 存在时点击不会被其它工具吃掉）
  const prevPick = A.pickPoint;
  A.pickPoint = (tx, ty) => {
    st.pts.push([tx + 0.5, ty + 0.5]);
    refresh();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && st.pts.length) { e.preventDefault(); st.pts.pop(); refresh(); }
  };
  addEventListener('keydown', onKey);

  function close() {
    A.pickPoint = prevPick || null;
    removeEventListener('keydown', onKey);
    stopLayer();
    bar.remove();
    panel.remove();
  }

  function apply(s) {
    if (s.pts.length < 2) { toast('至少要点 2 个控制点'); return; }
    const r = strokeCurve(ed, { pts: s.pts, width: s.width, taper: s.taper, kind: s.kind });
    if (!r.ok) { toast(r.reason === 'no-engine' ? '这张图没有地形图层' : '这条曲线没铺到任何格子'); return; }
    toast(`已画好${s.kind === 'river' ? '河' : '路'}：${r.cells} 格、曲线长 ${r.length.toFixed(0)} 格`);
  }

  refresh();
}

Object.assign(HELP, {
  'tool.curves': {
    t: '曲线工具（河 / 路）',
    s: '在地图上点几个控制点，自动连成一条平滑、带锥度的河或路',
    b: '菜单「生成」→「曲线工具…」。右侧面板打开后，左键依次点控制点（绿色是起点，黄色是后续点），曲线会穿过每个点并实时虚线预览。'
      + '「线宽」决定多粗，「起止渐变」让尾端越来越细（100% 收到一个点）。选「画河」铺水 + 浅水边，「画路」铺泥土、过河处自动变浅滩。'
      + '点「落笔」按当前设置真正落笔，一次落笔算一步撤销（Ctrl+Z 一下全撤掉）。',
    tips: ['控制点会自动避开出生点周围 2 格和资源池，防止把出生点淹了。',
      '「撤销上一点」只退控制点，不改地图；「清空」把控制点全删掉。',
      '画带子里的树和装饰会被清掉（资源池不动）。'],
  },
});
