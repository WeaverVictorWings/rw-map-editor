// 三种地形成角点笔刷：平滑（磨圆边界）/ 侵蚀（啃掉边缘）/ 噪声（撒碎斑）
// 都在 ed.engine 的角点数组上做，改完统一走 eng.paint(op, verts, vals)，一步撤销
import { A } from './state.js';
import { h, toast } from './ui.js';
import { icon } from './icons.js';
import { HELP } from './help.js';

const ed = A.ed;
const TW = 20;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// 确定性 hash（同样的坐标永远给同样的 0~1，避免 Math.random 让撤销重做对不上）
function hash2(x, y, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

// rect 支持 {x,y,w,h}（格）或 {x0,y0,x1,y1}（角点），统一成角点范围
export function normRect(rect, eng) {
  let x0, y0, x1, y1;
  if (rect && 'x0' in rect) { x0 = rect.x0; y0 = rect.y0; x1 = rect.x1; y1 = rect.y1; }
  else if (rect) { x0 = rect.x; y0 = rect.y; x1 = rect.x + (rect.w || 1) - 1; y1 = rect.y + (rect.h || 1) - 1; }
  else return null;
  x0 = clamp(Math.round(x0), 0, eng.W1 - 1); x1 = clamp(Math.round(x1), 0, eng.W1 - 1);
  y0 = clamp(Math.round(y0), 0, eng.H1 - 1); y1 = clamp(Math.round(y1), 0, eng.H1 - 1);
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  return { x0, y0, x1, y1 };
}

// 取一块（含四周 1 格边）的角点副本，避免边算边改产生方向性
function snapshot(eng, r) {
  const w = r.x1 - r.x0 + 3, hh = r.y1 - r.y0 + 3;
  const buf = new Uint8Array(w * hh).fill(255);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const X = r.x0 - 1 + x, Y = r.y0 - 1 + y;
    if (X < 0 || Y < 0 || X >= eng.W1 || Y >= eng.H1) continue;
    buf[y * w + x] = eng.V[Y * eng.W1 + X];
  }
  return { buf, w, hh };
}
const at = (s, x, y) => s.buf[y * s.w + x];
const NB8 = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 0.6], [1, -1, 0.6], [-1, 1, 0.6], [1, 1, 0.6]];   // x,y 是相对坐标（0,0 = 左上角外一格）

// 有 op 就复用（拖动中），没有就自己开一步
function withStep(ed2, label, fn) {
  const own = !ed2.op;
  if (own) ed2.begin(label);
  try { return fn(); } finally {
    if (own) {
      ed2.commit();
      const r = A.rend;
      if (r) { r.invalidateAll(); r.request(); }
    }
  }
}

function applyVerts(ed2, verts, vals, restore) {
  const eng = ed2.engine;
  const vv = [], tt = [];
  verts.forEach((v, i) => { if (v >= 0 && vals[i] >= 0) { vv.push(v); tt.push(vals[i]); } });
  restore.push({ vv: vv.slice(), tt: tt.slice() });
  if (vv.length) eng.paint(ed2.op, vv, tt);
}

// ---------------- 平滑 ----------------
// 把边界上“突出来的角”按邻域多数抹平：只看 8 邻域（不看自己），
// 邻域出现 ≥3 次的另一种地形才有资格吞掉当前角点，strength 决定通过率，
// 边缘一圈按距离衰减 → 边界柔和，不会出现一圈硬台阶
export function smoothBrush(ed2 = ed, rect = null, strength = 0.5) {
  const eng = ed2 && ed2.engine;
  if (!eng) return { ok: false, reason: 'no-engine' };
  const r = normRect(rect, eng);
  if (!r) return { ok: false, reason: 'no-rect' };
  const s = clamp(+strength || 0, 0, 1);
  const snap = snapshot(eng, r);
  const W = r.x1 - r.x0 + 1, H = r.y1 - r.y0 + 1;
  const verts = [], vals = [];
  let changed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x + 1, sy = y + 1;
    const cur = at(snap, sx, sy);
    if (cur >= 255) continue;
    const tally = new Map();
    for (const [dx, dy, w] of NB8) {
      const t = at(snap, sx + dx, sy + dy);
      if (t < 255 && t !== cur) tally.set(t, (tally.get(t) || 0) + w);
    }
    let best = -1, bw = 0;
    for (const [t, w] of tally) if (w > bw + 1e-9) { bw = w; best = t; }
    if (best < 0 || bw < 2.5) continue;                // 只有零星一格不算，别把细节抹掉
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    const k = Math.min(1, (edge + 1) / 3);             // 外圈少动
    if (hash2(r.x0 + x, r.y0 + y, 5) > s * k) continue;
    verts.push((r.y0 + y) * eng.W1 + (r.x0 + x)); vals.push(best); changed++;
  }
  const restore = [];
  withStep(ed2, '平滑笔刷', () => applyVerts(ed2, verts, vals, restore));
  return { ok: true, changed, verts: verts.length, rect: r };
}

// ---------------- 侵蚀 ----------------
// 把边缘“啃”进去：4 邻域里出现次数多的那种地形会吞掉当前角点
// dir: 'all' | 'n' | 's' | 'e' | 'w'（只朝那一侧侵蚀，做风蚀效果）
export function erodeBrush(ed2 = ed, rect = null, strength = 0.5, dir = 'all') {
  const eng = ed2 && ed2.engine;
  if (!eng) return { ok: false, reason: 'no-engine' };
  const r = normRect(rect, eng);
  if (!r) return { ok: false, reason: 'no-rect' };
  const s = clamp(+strength || 0, 0, 1);
  const snap = snapshot(eng, r);
  const W = r.x1 - r.x0 + 1, H = r.y1 - r.y0 + 1;
  const dirs = dir === 'n' ? [[0, -1]] : dir === 's' ? [[0, 1]] : dir === 'e' ? [[1, 0]] : dir === 'w' ? [[-1, 0]]
    : [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const verts = [], vals = [];
  let changed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x + 1, sy = y + 1;
    const cur = at(snap, sx, sy);
    if (cur >= 255) continue;
    const tally = new Map();
    for (const [dx, dy] of dirs) { const t = at(snap, sx + dx, sy + dy); if (t < 255 && t !== cur) tally.set(t, (tally.get(t) || 0) + 1); }
    if (!tally.size) continue;
    let best = -1, bc = 0;
    for (const [t, c] of tally) if (c > bc) { bc = c; best = t; }
    // 多数邻居都换了个地形才动，避免把细碎毛边放大；strength 决定“抽签后的通过率”
    if (bc < 2 && dirs.length > 1) continue;
    if (hash2(r.x0 + x, r.y0 + y, 7) > s) continue;
    verts.push((r.y0 + y) * eng.W1 + (r.x0 + x)); vals.push(best); changed++;
  }
  const restore = [];
  withStep(ed2, '侵蚀笔刷', () => applyVerts(ed2, verts, vals, restore));
  return { ok: true, changed, verts: verts.length, rect: r };
}

// ---------------- 噪声 ----------------
// 按 scale 格一块的确定性哈希，从“这一块里出现过的地形”里挑一个撒进去
export function noiseBrush(ed2 = ed, rect = null, strength = 0.5, scale = 3) {
  const eng = ed2 && ed2.engine;
  if (!eng) return { ok: false, reason: 'no-engine' };
  const r = normRect(rect, eng);
  if (!r) return { ok: false, reason: 'no-rect' };
  const s = clamp(+strength || 0, 0, 1);
  const sc = Math.max(1, scale | 0);
  const snap = snapshot(eng, r);
  const W = r.x1 - r.x0 + 1, H = r.y1 - r.y0 + 1;
  const verts = [], vals = [];
  let changed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x + 1, sy = y + 1;
    const cur = at(snap, sx, sy);
    if (cur >= 255) continue;
    const bx = Math.floor((r.x0 + x) / sc), by = Math.floor((r.y0 + y) / sc);
    if (hash2(bx, by, 3) > s) continue;              // 这块不撒
    // 这一块邻居里出现过的地形做候选
    const cand = [];
    for (let dy = -sc; dy <= sc; dy += Math.max(1, sc >> 1)) for (let dx = -sc; dx <= sc; dx += Math.max(1, sc >> 1)) {
      const t = at(snap, clamp(sx + dx, 0, snap.w - 1), clamp(sy + dy, 0, snap.hh - 1));
      if (t < 255 && t !== cur && !cand.includes(t)) cand.push(t);
    }
    if (!cand.length) continue;
    const t = cand[Math.floor(hash2(r.x0 + x, r.y0 + y, 11) * cand.length) % cand.length];
    verts.push((r.y0 + y) * eng.W1 + (r.x0 + x)); vals.push(t); changed++;
  }
  const restore = [];
  withStep(ed2, '噪声笔刷', () => applyVerts(ed2, verts, vals, restore));
  return { ok: true, changed, verts: verts.length, rect: r };
}

// ---------------- 面板 ----------------
const KINDS = [['smooth', '平滑'], ['erode', '侵蚀'], ['noise', '噪声']];

export function brushDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (!ed.engine) { toast('这张图没有地形图层，笔刷用不了'); return; }
  document.querySelector('.brush-panel')?.remove();
  const st = { kind: 'smooth', radius: 4, strength: 0.5, shape: 'circle', dir: 'all', scale: 3 };
  let painting = false, last = null;

  const stat = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:6px' }, '还没涂过');
  let rTxt, sTxt;
  const panel = h('div', { class: 'brush-panel' },
    h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' },
      h('b', { style: 'flex:1' }, '地形笔刷'), h('button', { onclick: () => close() }, '关闭')),
    h('div', { style: 'display:flex;gap:6px;margin-bottom:8px' },
      ...KINDS.map(([k, cn]) => h('button', {
        class: k === st.kind ? 'primary' : '',
        'data-k': k,
        onclick: (e) => {
          st.kind = k;
          for (const b of panel.querySelectorAll('[data-k]')) b.className = b.dataset.k === k ? 'primary' : '';
        },
      }, cn))),
    row('半径', h('input', {
      type: 'range', min: '1', max: '16', step: '1', value: '4', style: 'flex:1',
      oninput: (e) => { st.radius = +e.target.value; rTxt.textContent = st.radius + ' 格'; },
    }), (rTxt = h('span', { style: 'font-size:12px;width:44px;text-align:right' }, '4 格'))),
    row('强度', h('input', {
      type: 'range', min: '0', max: '100', step: '5', value: '50', style: 'flex:1',
      oninput: (e) => { st.strength = +e.target.value / 100; sTxt.textContent = e.target.value + '%'; },
    }), (sTxt = h('span', { style: 'font-size:12px;width:44px;text-align:right' }, '50%'))),
    row('形状', h('div', { style: 'display:flex;gap:6px' },
      h('button', { class: 'primary', 'data-sh': 'circle', onclick: () => setShape('circle') }, '圆'),
      h('button', { 'data-sh': 'square', onclick: () => setShape('square') }, '方')), h('span')),
    h('div', { style: 'font-size:12px;color:var(--muted);margin:6px 0;line-height:1.6' },
      '在地图上按住左键涂抹；一次拖动算一步，松手后再涂是新的一步。'),
    stat);

  function row(label, inp, tail) {
    return h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' },
      h('span', { style: 'width:48px;font-size:12px' }, label), inp, tail);
  }
  function setShape(sh) {
    st.shape = sh;
    for (const b of panel.querySelectorAll('[data-sh]')) b.className = b.dataset.sh === sh ? 'primary' : '';
  }

  panel.style.cssText = 'position:fixed;left:60px;bottom:56px;width:290px;z-index:60;background:var(--panel,#171b22);'
    + 'border:1px solid var(--line,#2a2f3a);border-radius:10px;padding:12px;box-shadow:0 12px 32px rgba(0,0,0,.5);font-size:13px';
  document.body.append(panel);

  // 一次涂抹 = 一步：按下时开 op，松手 commit
  function dab(tx, ty) {
    const eng = ed.engine, W = ed.map.width, H = ed.map.height;
    const r = st.radius;
    const x0 = Math.max(0, tx - r), x1 = Math.min(eng.W1 - 1, tx + r + 1);
    const y0 = Math.max(0, ty - r), y1 = Math.min(eng.H1 - 1, ty + r + 1);
    if (x1 < x0 || y1 < y0) return;
    const rect = { x0, y0, x1, y1 };
    const out = st.kind === 'smooth' ? smoothBrush(ed, rect, st.strength)
      : st.kind === 'erode' ? erodeBrush(ed, rect, st.strength, st.dir)
        : noiseBrush(ed, rect, st.strength, st.scale);
    if (out && out.changed) stat.textContent = `最近一笔：改了 ${out.changed} 个角点`;
  }

  function tileOf(e) {
    const cv = document.getElementById('cv');
    if (!cv) return null;
    const rc = cv.getBoundingClientRect();
    const p = A.rend.toMap(e.clientX - rc.left, e.clientY - rc.top);
    const tx = Math.floor(p.x / TW), ty = Math.floor(p.y / TW);
    if (tx < 0 || ty < 0 || tx >= ed.map.width || ty >= ed.map.height) return null;
    return { tx, ty };
  }

  function onDown(e) {
    if (e.button !== 0) return;
    if (e.target !== document.getElementById('cv')) return;
    const t = tileOf(e);
    if (!t) return;
    e.stopPropagation(); e.preventDefault();
    painting = true; last = t;
    ed.begin(st.kind === 'smooth' ? '平滑笔刷' : st.kind === 'erode' ? '侵蚀笔刷' : '噪声笔刷');
    dab(t.tx, t.ty);
    A.rend.invalidateAll(); A.rend.request();
  }
  function onMove(e) {
    if (!painting) return;
    const t = tileOf(e);
    if (!t) return;
    if (last && (t.tx !== last.tx || t.ty !== last.ty)) {
      // 中间补点，快速拖动也不断线
      const n = Math.max(Math.abs(t.tx - last.tx), Math.abs(t.ty - last.ty));
      for (let k = 1; k <= n; k++) dab(Math.round(last.tx + (t.tx - last.tx) * k / n), Math.round(last.ty + (t.ty - last.ty) * k / n));
    } else dab(t.tx, t.ty);
    last = t;
    A.rend.invalidateAll(); A.rend.request();
  }
  function onUp() {
    if (!painting) return;
    painting = false; last = null;
    ed.commit();
    A.rend.invalidateAll(); A.rend.request();
    if (A.mini && A.mini.schedule) A.mini.schedule();
  }
  // 捕获阶段拦：input.js 的指针事件挂在 #cv 上，这里先吃掉才能自己涂
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  addEventListener('keydown', onKey);

  function close() {
    onUp();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    removeEventListener('keydown', onKey);
    panel.remove();
  }
}

Object.assign(HELP, {
  'tool.brushtools': {
    t: '地形笔刷（平滑 / 侵蚀 / 噪声）',
    s: '在地图上涂抹，把地形边界磨圆、啃出侵蚀感或撒上碎斑',
    b: '菜单「生成」→「地形笔刷…」。面板里选笔刷类型、半径和强度，然后在地图上按住左键涂。'
      + '「平滑」把参差的边界化开，边界按距离渐变，不会出现硬台阶；「侵蚀」让四邻域一致的地形吞掉当前角点，可以做出被水/沙啃过的边缘；'
      + '「噪声」按格子块撒入附近出现过的地形，做碎石、苔藓那种碎斑。一次拖动是**一步撤销**，松手后再涂是新的一步。',
    tips: ['半径 4~6、强度 40~60 最常用。', '涂抹只在启动面板时生效，关掉面板就恢复原来的工具。', '笔刷只改地形角点，不动物品和单位。'],
  },
});
