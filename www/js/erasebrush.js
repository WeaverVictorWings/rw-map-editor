// 地形擦除与还原笔刷：把一块区域擦成“没画过”的默认地形，也能把刚擦掉的区域还原
// 做法是直接改地形引擎的角点（eng.V），再让引擎重铺区域内的图块，避免出现过渡碎片和接缝
import { A } from './state.js';
import { NONE } from './terrain.js';
import { h, toast, modal, slider, segmented, select, modalOpen } from './ui.js';
import { HELP } from './help.js';

const TW = 20;

const SHAPES = [
  ['square', '方形'],
  ['circle', '圆形'],
];

const MODES = [
  ['erase', '擦成默认地形'],
  ['restore', '还原上次擦除'],
];

// 最近一次擦除留下的快照（供“还原”用）；只保留一份，避免占内存
let lastErase = null;

// 把各种矩形写法统一成 clamp 过的 {x0,y0,x1,y1}；空区域返回 null
function normRect(ed, rect) {
  if (!ed || !ed.map) return null;
  const W = ed.map.width, H = ed.map.height;
  if (!rect) return { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  let x0 = Math.min(rect.x0 ?? rect.x ?? 0, rect.x1 ?? rect.x ?? 0);
  let x1 = Math.max(rect.x0 ?? rect.x ?? 0, rect.x1 ?? rect.x ?? 0);
  let y0 = Math.min(rect.y0 ?? rect.y ?? 0, rect.y1 ?? rect.y ?? 0);
  let y1 = Math.max(rect.y0 ?? rect.y ?? 0, rect.y1 ?? rect.y ?? 0);
  x0 = Math.max(0, Math.min(W - 1, Math.floor(x0)));
  x1 = Math.max(0, Math.min(W - 1, Math.floor(x1)));
  y0 = Math.max(0, Math.min(H - 1, Math.floor(y0)));
  y1 = Math.max(0, Math.min(H - 1, Math.floor(y1)));
  if (x1 < x0 || y1 < y0) return null;
  return { x0, y0, x1, y1 };
}

// 解析目标地形：可传编号或名字；默认“当前主地形”
function resolveTerrain(ed, t) {
  const eng = ed.engine;
  if (t === undefined || t === null || t === '') return ed.terrain;
  if (typeof t === 'number') return t;
  const i = typeof eng.index === 'function' ? eng.index(t) : -1;
  return i >= 0 ? i : ed.terrain;
}

function cellsFromRect(ed, r) {
  const W = ed.map.width;
  const out = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push(y * W + x);
  return out;
}

function bboxOf(ed, cells) {
  const W = ed.map.width;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const i of cells) {
    const x = i % W, y = (i - x) / W;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1 };
}

// 真正的擦除：cells 里的格子四角全部改成 t，然后只重铺受影响的那一块
function eraseCells(ed, cells, opts = {}) {
  if (!ed || !ed.map || !ed.engine) return { ok: false, why: '先打开一张地图' };
  const eng = ed.engine, m = ed.map, W = m.width, W1 = eng.W1;
  const t = resolveTerrain(ed, opts.terrain);
  if (t === NONE || !eng.paintable.includes(t)) return { ok: false, why: '这个地形不能画' };
  if (!cells || !cells.length) return { ok: false, why: '区域为空' };
  const b = bboxOf(ed, cells);
  if (!b) return { ok: false, why: '区域为空' };
  const t0 = performance.now();
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;

  // 快照：角点 + 物品；供“还原”使用
  const keep = (bw + 1) * (bh + 1) <= 2e6;
  const snapV = keep ? new Uint8Array((bw + 1) * (bh + 1)) : null;
  if (keep) {
    for (let y = 0; y <= bh; y++) {
      for (let x = 0; x <= bw; x++) snapV[y * (bw + 1) + x] = eng.V[(b.y0 + y) * W1 + b.x0 + x];
    }
  }
  const IL = m.items;
  const clearItems = !!opts.items && !!IL;
  const snapI = clearItems ? { gid: new Uint16Array(bw * bh), flip: new Uint8Array(bw * bh) } : null;
  if (clearItems) {
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = (b.y0 + y) * W + b.x0 + x;
        snapI.gid[y * bw + x] = IL.data[i] || 0;
        snapI.flip[y * bw + x] = IL.flips.get(i) || 0;
      }
    }
  }

  const op = ed.begin(opts.label || '擦除地形');
  const seen = new Uint8Array((bw + 1) * (bh + 1));
  let corners = 0, changed = 0;
  for (const ci of cells) {
    const x = ci % W, y = (ci - x) / W;
    // 一格的四个角点
    const vs = [y * W1 + x, y * W1 + x + 1, (y + 1) * W1 + x, (y + 1) * W1 + x + 1];
    const ks = [
      (y - b.y0) * (bw + 1) + (x - b.x0),
      (y - b.y0) * (bw + 1) + (x - b.x0) + 1,
      (y - b.y0 + 1) * (bw + 1) + (x - b.x0),
      (y - b.y0 + 1) * (bw + 1) + (x - b.x0) + 1,
    ];
    for (let q = 0; q < 4; q++) {
      if (seen[ks[q]]) continue;
      seen[ks[q]] = 1;
      corners++;
      const v = vs[q];
      if (eng.V[v] !== t) {
        op.vert(v, eng.V[v], t);
        eng.V[v] = t;
        changed++;
      }
    }
  }

  let itemsCleared = 0;
  if (clearItems) {
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * W + x;
        if (!IL.data[i] && !IL.flips.get(i)) continue;
        op.tile(IL, i, IL.data[i], IL.flips.get(i) || 0, 0, 0);
        itemsCleared++;
      }
    }
  }

  eng.retileRect(op, b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1);
  op.markAll();
  ed.commit();

  if (keep) {
    lastErase = {
      rect: { ...b }, W, W1, bw, bh, V: snapV, items: snapI, terrain: t, at: Date.now(),
    };
  } else {
    lastErase = null;
  }

  return {
    ok: true,
    rect: { ...b },
    cells: cells.length,
    corners,
    changed,
    movedCorners: changed,
    itemsCleared,
    terrain: t,
    terrainName: eng.cn(t),
    ms: +(performance.now() - t0).toFixed(1),
    label: opts.label || '擦除地形',
  };
}

// 擦除矩形区域（含端点），opts: {terrain, items, label}
export function eraseRegion(ed, rect, opts = {}) {
  const r = normRect(ed, rect);
  if (!r) return { ok: false, why: '区域为空' };
  return eraseCells(ed, cellsFromRect(ed, r), opts);
}

// 把误擦的区域还原：只还原最近一次擦除记录里覆盖到的角点/物品
// opts: {snapshot} 可显式传入 old 快照
export function restoreRegion(ed, rect, opts = {}) {
  if (!ed || !ed.map || !ed.engine) return { ok: false, why: '先打开一张地图' };
  const snap = opts.snapshot || lastErase;
  if (!snap) return { ok: false, why: '还没有擦除记录，无法还原（可以用 Ctrl+Z 撤销）' };
  const r = normRect(ed, rect);
  if (!r) return { ok: false, why: '区域为空' };
  const eng = ed.engine, m = ed.map, W = m.width, W1 = eng.W1;
  const t0 = performance.now();
  const sx0 = Math.max(r.x0, snap.rect.x0), sx1 = Math.min(r.x1, snap.rect.x1);
  const sy0 = Math.max(r.y0, snap.rect.y0), sy1 = Math.min(r.y1, snap.rect.y1);
  if (sx1 < sx0 || sy1 < sy0) return { ok: false, why: '这块区域不在上次擦除范围里' };

  const op = ed.begin(opts.label || '还原地形');
  let corners = 0, changed = 0;
  for (let y = sy0; y <= sy1 + 1; y++) {
    for (let x = sx0; x <= sx1 + 1; x++) {
      const dx = x - snap.rect.x0, dy = y - snap.rect.y0;
      if (dx < 0 || dy < 0 || dx > snap.bw || dy > snap.bh) continue;
      const want = snap.V[dy * (snap.bw + 1) + dx];
      const v = y * W1 + x;
      corners++;
      if (eng.V[v] !== want) {
        op.vert(v, eng.V[v], want);
        eng.V[v] = want;
        changed++;
      }
    }
  }

  const IL = m.items;
  let itemsBack = 0;
  if (IL && snap.items) {
    for (let y = sy0; y <= sy1; y++) {
      for (let x = sx0; x <= sx1; x++) {
        const gid = snap.items.gid[(y - snap.rect.y0) * snap.bw + (x - snap.rect.x0)] || 0;
        const flip = snap.items.flip[(y - snap.rect.y0) * snap.bw + (x - snap.rect.x0)] || 0;
        const i = y * W + x;
        if ((IL.data[i] || 0) === gid && (IL.flips.get(i) || 0) === flip) continue;
        op.tile(IL, i, IL.data[i] || 0, IL.flips.get(i) || 0, gid, flip);
        itemsBack++;
      }
    }
  }

  eng.retileRect(op, sx0 - 1, sy0 - 1, sx1 + 1, sy1 + 1);
  op.markAll();
  ed.commit();

  return {
    ok: true,
    rect: { x0: sx0, y0: sy0, x1: sx1, y1: sy1 },
    corners,
    changed,
    movedCorners: changed,
    itemsRestored: itemsBack,
    ms: +(performance.now() - t0).toFixed(1),
    label: opts.label || '还原地形',
  };
}

// 当前是否有可还原的记录
export function hasEraseSnapshot() {
  return !!lastErase;
}
export function eraseSnapshotInfo() {
  if (!lastErase) return null;
  return { rect: { ...lastErase.rect }, bw: lastErase.bw, bh: lastErase.bh, at: lastErase.at };
}

function refresh() {
  A.rend.invalidateAll();
  A.mini.schedule();
  A.autoDirty = true;
  A.ed.dirty = true;
  A.refresh();
}

// ---------------- 笔刷对话框 ----------------

const st = { size: 3, shape: 'square', mode: 'erase', terrain: null, items: false };

let brush = null; // 当前笔刷的监听与界面

function brushCells(ed, tx, ty) {
  const W = ed.map.width, H = ed.map.height;
  const out = [];
  const half = (st.size - 1) / 2;
  const rx = st.size / 2;
  for (let dy = -Math.ceil(half); dy <= Math.ceil(half); dy++) {
    for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
      if (st.shape === 'circle' && Math.hypot(dx, dy) > rx) continue;
      const x = tx + dx, y = ty + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      out.push(y * W + x);
    }
  }
  return out;
}

function applyStroke(cells) {
  if (!cells.length) return;
  const ed = A.ed;
  const res = st.mode === 'restore'
    ? (() => {
      const b = bboxOf(ed, cells);
      return b ? restoreRegion(ed, b, { label: '还原地形（笔刷）' }) : { ok: false, why: '区域为空' };
    })()
    : eraseCells(ed, cells, { terrain: st.terrain, items: st.items, label: '擦除地形（笔刷）' });
  refresh();
  if (!res.ok) {
    toast(res.why || '没改成');
  } else if (st.mode === 'restore') {
    toast(`还原 ${res.rect.x1 - res.rect.x0 + 1}×${res.rect.y1 - res.rect.y0 + 1} · ${res.ms}ms`);
  } else {
    toast(`擦除 ${res.cells} 格 · 改 ${res.changed} 角点 · ${res.ms}ms`);
  }
}

function stopBrush() {
  if (!brush) return;
  const b = brush;
  brush = null;
  b.cv.removeEventListener('pointerdown', b.down, true);
  b.cv.removeEventListener('pointermove', b.move, true);
  window.removeEventListener('pointerup', b.up, true);
  window.removeEventListener('pointercancel', b.up, true);
  window.removeEventListener('keydown', b.key, true);
  b.dot.remove();
  b.bar.remove();
}

function startBrush() {
  stopBrush();
  const cv = A.rend.cv;
  if (!cv) { toast('地图还没准备好'); return; }
  const dot = h('div', {
    style: {
      position: 'fixed', left: '0', top: '0', width: '10px', height: '10px',
      border: '1px dashed #ffd166', borderRadius: st.shape === 'circle' ? '50%' : '2px',
      pointerEvents: 'none', zIndex: '60', display: 'none', transform: 'translate(-50%, -50%)',
      boxShadow: '0 0 0 1px rgba(0,0,0,.45)',
    },
  });
  document.body.append(dot);

  const bar = h('div', {
    class: 'popover',
    style: {
      position: 'fixed', left: '12px', bottom: '52px', top: 'auto', width: '260px',
      padding: '10px', zIndex: '61',
    },
  },
  h('div', { class: 'row', style: { marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' } },
    h('b', {}, st.mode === 'restore' ? '还原笔刷' : '擦除笔刷'),
    h('button', { class: 'btn small', style: { marginLeft: 'auto' }, onclick: () => stopBrush() }, '退出（Esc）')),
  h('div', { class: 'hint' }, '在地图上单击或拖动；一次拖动 = 一步撤销。'),
  h('div', { class: 'hint' }, st.mode === 'restore' ? '只还原上次擦除覆盖到的角点。' : '擦成 uniform 默认地形，不留过渡碎片。')
  );
  document.body.append(bar);

  let painting = false, stroke = [], lastTile = -1;

  const tileAt = (e) => {
    const r = cv.getBoundingClientRect();
    const p = A.rend.toMap(e.clientX - r.left, e.clientY - r.top);
    const tx = Math.floor(p.x / TW), ty = Math.floor(p.y / TW);
    if (tx < 0 || ty < 0 || tx >= A.ed.map.width || ty >= A.ed.map.height) return null;
    return { tx, ty, x: e.clientX, y: e.clientY };
  };

  const placeDot = (p) => {
    if (!p) { dot.style.display = 'none'; return; }
    const z = A.rend.view.z || 1;
    const s = Math.max(6, st.size * TW * z);
    dot.style.display = 'block';
    dot.style.left = p.x + 'px';
    dot.style.top = p.y + 'px';
    dot.style.width = s + 'px';
    dot.style.height = s + 'px';
  };

  const addDab = (p) => {
    if (!p) return;
    const key = p.ty * A.ed.map.width + p.tx;
    if (key === lastTile) return;
    lastTile = key;
    for (const i of brushCells(A.ed, p.tx, p.ty)) stroke.push(i);
  };

  const down = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = tileAt(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    painting = true;
    stroke = [];
    lastTile = -1;
    addDab(p);
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件没有活动指针 */ }
  };
  const move = (e) => {
    const p = tileAt(e);
    placeDot(p);
    if (painting) addDab(p);
  };
  const up = (e) => {
    if (!painting) return;
    painting = false;
    try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* 忽略 */ }
    const cells = stroke;
    stroke = [];
    lastTile = -1;
    if (cells.length) applyStroke(cells);
  };
  const key = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      stopBrush();
    }
  };

  cv.addEventListener('pointerdown', down, true);
  cv.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('keydown', key, true);

  brush = { cv, down, move, up, key, dot, bar };

  // 退出按钮
}

export function eraseDialog() {
  const ed = A.ed;
  if (!ed || !ed.map) { toast('先打开一张地图'); return; }
  if (modalOpen()) { toast('先关掉当前弹窗'); return; }
  st.terrain = resolveTerrain(ed, st.terrain);
  const eng = ed.engine;
  const nameOf = (t) => (t === NONE ? '无' : eng.cn(t));

  const body = h('div', {},
    h('p', { class: 'hint' }, '擦除会把这个区域的地形角点直接改成 uniform 的默认地形，再重铺受影响图块；一次操作一步撤销。'),
    h('div', { class: 'field' }, slider('笔刷大小', 1, 15, st.size, (v) => { st.size = v | 0; }, { step: 1, fmt: (v) => v + ' 格' })),
    h('div', { class: 'field' }, segmented(SHAPES, st.shape, (v) => { st.shape = v; })),
    h('div', { class: 'field' }, segmented(MODES, st.mode, (v) => { st.mode = v; })),
    h('div', { class: 'field' },
      h('label', { class: 'hint' }, '擦成地形'),
      select(eng.paintable.map((t) => [String(t), nameOf(t)]), String(st.terrain), (v) => {
        st.terrain = +v;
      })),
    h('div', { class: 'field' },
      h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('input', {
          type: 'checkbox', checked: st.items,
          style: { width: 'auto', flex: 'none', margin: 0 },
          onchange: (e) => { st.items = e.target.checked; },
        }), h('span', {}, '同时擦掉区域里的物品（装饰/资源池）'))),
    h('p', { class: 'hint' }, '还原：只还原最近一次擦除覆盖到的角点和物品；没有记录时请用 Ctrl+Z。'));

  modal('地形擦除与还原', body, [
    { label: '取消', value: null },
    { label: '开始涂抹', value: 1, primary: true },
  ]).then((v) => {
    if (!v) return;
    if (st.mode === 'restore' && !hasEraseSnapshot()) { toast('还没有擦除记录，先擦一块再还原'); return; }
    startBrush();
  });
}

Object.assign(HELP, {
  'tool.erasebrush': {
    t: '地形擦除与还原',
    s: '把画错的地形擦回“没画过”的默认地形，也能还原刚擦掉的区域',
    b: '“擦成默认地形”会把区域内所有地形角点改成当前主地形（或你选的擦成地形），再让引擎只重铺受影响的图块，所以不会留下过渡碎片或孤立单格。'
      + '笔刷一次拖动只记一步撤销；“还原上次擦除”按最近一次擦除的快照把角点和物品写回去。',
    tips: [
      '笔刷支持方形/圆形、1~15 格，一次拖动或单击都只记一步，可整笔 Ctrl+Z。',
      '擦除区里如果有树木、资源池等物品，勾选“同时擦掉物品”才会一起清掉；默认保留。',
      '还原只认最近一次擦除；更早的请用历史面板或 Ctrl+Z 一步步撤回。',
      '擦成地形默认跟随左侧地形面板的主地形，也可以在下拉里临时指定。',
    ],
  },
});
