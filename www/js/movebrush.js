// 滑块式批量移动地形：把一块矩形区域里的地形/物品整体平移，空出来的边按选定的方式处理
// 用途：整块地形错位一格、把画好的区域往旁边挪、整图循环平移做无缝拼接
import { A } from './state.js';
import { NONE } from './terrain.js';
import { h, toast, busy, select, segmented, toggle, modalOpen } from './ui.js';
import { HELP } from './help.js';

const TW = 20;

// 三种边缘处理方式
const EDGES = [
  ['empty', '空出（填成最常见地形）'],
  ['clamp', '边缘复制（拉长边上的内容）'],
  ['wrap', '循环（从另一头卷回来）'],
];

// 作用范围
const SCOPES = [
  ['whole', '整图'],
  ['selection', '当前选区'],
  ['view', '当前可见区域'],
];

function edgeName(edge) {
  const e = EDGES.find(([v]) => v === edge);
  return e ? e[1] : edge;
}
function scopeName(scope) {
  const s = SCOPES.find(([v]) => v === scope);
  return s ? s[1] : scope;
}

// 按范围算矩形（格坐标，含端点）。选区没框选时返回 null
export function scopeRect(ed, scope) {
  const m = ed && ed.map;
  if (!m) return null;
  if (scope === 'selection') {
    const s = ed.selection;
    if (!s) return null;
    return { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
  }
  if (scope === 'view') {
    const r = A.rend, v = r.view;
    const tw = m.tw || TW, th = m.th || TW;
    // 视野在“地图像素”里是一个矩形，换成格子范围
    let x0 = Math.floor(v.ox / tw), y0 = Math.floor(v.oy / th);
    let x1 = Math.floor((v.ox + r.cw / v.z) / tw), y1 = Math.floor((v.oy + r.ch / v.z) / th);
    x0 = Math.max(0, Math.min(m.width - 1, x0)); y0 = Math.max(0, Math.min(m.height - 1, y0));
    x1 = Math.max(0, Math.min(m.width - 1, x1)); y1 = Math.max(0, Math.min(m.height - 1, y1));
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  }
  return { x0: 0, y0: 0, x1: m.width - 1, y1: m.height - 1 };
}

// 把“区域里最多的一种地形”找出来（空出时当填充色）
function commonTerrain(cells) {
  const cnt = new Uint32Array(256);
  let best = NONE, bn = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c === NONE) continue;
    cnt[c]++;
    if (cnt[c] > bn) { bn = cnt[c]; best = c; }
  }
  return best;
}

// 把 fillTerrain 参数（名字或编号）解析成地形编号；不合法返回 -1
function terrainIndex(eng, fill) {
  if (fill === undefined || fill === null || fill === '') return -1;
  if (typeof fill === 'number') return fill >= 0 && fill < eng.K ? fill : -1;
  const i = eng.index(String(fill));
  return i >= 0 ? i : -1;
}

// 核心：把 rect（格坐标，含端点）里的内容整体平移 (dx,dy)
//   dx>0 向右、dy>0 向下；内容“移动”到新位置，露出来的空格按 opts.edge 处理
//   opts.edge: 'empty' | 'clamp' | 'wrap'（默认 empty）
//   opts.fillTerrain: 'empty' 时填的地形（名字或编号，默认取区域内最多的地形）
//   opts.fillItem: 'empty' 时物品位置填什么（默认 0=空）
// 返回统计信息；整个过程是一步可撤销的操作
export function shiftRegion(ed, rect, dx, dy, opts = {}) {
  const m = ed && ed.map, eng = ed && ed.engine;
  if (!m || !eng) return { ok: false, why: '没有打开带地形标注的地图' };
  const dxI = Math.round(dx || 0), dyI = Math.round(dy || 0);
  if (!dxI && !dyI) return { ok: false, why: '位移是 0，什么都没做' };
  const edge = opts.edge === 'clamp' || opts.edge === 'wrap' ? opts.edge : 'empty';

  // 规整矩形并夹到地图内
  if (!rect) return { ok: false, why: '没有指定范围' };
  let x0 = Math.floor(Math.min(rect.x0, rect.x1)), x1 = Math.floor(Math.max(rect.x0, rect.x1));
  let y0 = Math.floor(Math.min(rect.y0, rect.y1)), y1 = Math.floor(Math.max(rect.y0, rect.y1));
  x0 = Math.max(0, Math.min(m.width - 1, x0)); x1 = Math.max(0, Math.min(m.width - 1, x1));
  y0 = Math.max(0, Math.min(m.height - 1, y0)); y1 = Math.max(0, Math.min(m.height - 1, y1));
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < 1 || h < 1) return { ok: false, why: '范围是空的' };

  const t0 = performance.now();
  const W = m.width, V = eng.V, W1 = eng.W1;
  const gw = w, gh = h;             // 区域里的格数
  const cw = gw + 1, ch = gh + 1;   // 区域覆盖的角点数
  const n = gw * gh;

  // 平移“角点”而不是按格重算：applyCells 是按每格重新投票推导角点，来回推会漂移
  // （实测恒等平移都会改掉 ~14% 的格子）；直接搬角点能保证来回推精确还原。
  const tsrc = new Uint8Array(n);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) tsrc[y * gw + x] = eng.tileTerrain((y0 + y) * W + x0 + x);
  const fillOverride = terrainIndex(eng, opts.fillTerrain);
  const fill = fillOverride >= 0 ? fillOverride : commonTerrain(tsrc);
  const Buf = eng.layer.data instanceof Uint32Array ? Uint32Array : Uint16Array;
  const gBefore = new Buf(n);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) gBefore[y * gw + x] = eng.layer.data[(y0 + y) * W + x0 + x];

  const cSrc = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) cSrc[cy * cw + cx] = V[(y0 + cy) * W1 + x0 + cx];

  // 物品先快照（gid 与翻转打包成一个 u32）
  const IL = m.items;
  const doItems = !!IL && opts.items !== false;
  const keepPools = opts.keepPools !== false;
  const iSrc = doItems ? new Uint32Array(n) : null;
  const iBefore = doItems ? new Uint32Array(n) : null;
  // 资源池在游戏里是独立实体：默认留在原地，不跟着地形搬（勾选 opts.keepPools=false 才搬）
  // 先把带 res_pool 属性的图块号收成一个 Set（就是 tileInfo(gid).props 里带 res_pool 的那些）
  let poolGids = null;
  if (keepPools && doItems) {
    poolGids = new Set();
    for (const ts of m.tilesets) for (const [id, inf] of ts.tiles) if (inf.props && 'res_pool' in inf.props) poolGids.add(ts.firstgid + id);
  }
  let itemWrites = 0, poolsKept = 0;
  // 按格记“这一格是不是资源池”，热循环里只读一个 u8，别每格都查 Set
  const poolMask = poolGids ? new Uint8Array(n) : null;
  if (doItems) {
    const d = IL.data;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = (y0 + y) * W + x0 + x;
      const raw = (d[i] | ((IL.flips.get(i) || 0) << 29)) >>> 0;
      const k = y * gw + x;
      iSrc[k] = raw;
      iBefore[k] = raw;
      if (poolGids && (raw & 0x1fffffff) && poolGids.has(raw & 0x1fffffff)) poolMask[k] = 1;
    }
  }

  const mod = (a, b) => ((a % b) + b) % b;
  // 目标角点取哪个源角点；越界按边缘方式处理，-1 表示“空”
  const cornerSrc = (rx, ry) => {
    if (edge === 'wrap') { rx = mod(rx, gw); ry = mod(ry, gh); }
    else if (edge === 'clamp') {
      rx = rx < 0 ? 0 : rx > gw ? gw : rx;
      ry = ry < 0 ? 0 : ry > gh ? gh : ry;
    } else if (rx < 0 || ry < 0 || rx > gw || ry > gh) return -1;
    return ry * cw + rx;
  };

  const cOut = new Uint8Array(cw * ch);
  let movedCorners = 0;
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const k = cornerSrc(cx - dxI, cy - dyI);
    const v = k < 0 ? fill : cSrc[k];
    cOut[cy * cw + cx] = v;
    if (v !== cSrc[cy * cw + cx]) movedCorners++;
  }

  // 一步撤销：只记录真正变化的角点（矩形内），大图不会整层快照
  const op = ed.begin('平移地形');
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const i = (y0 + cy) * W1 + x0 + cx;
    const nv = cOut[cy * cw + cx];
    if (V[i] !== nv) { op.vert(i, V[i], nv); V[i] = nv; }
  }
  if (doItems) {
    const d = IL.data;
    const fillItem = opts.fillItem | 0;
    // 物品按“格”取源格，边缘语义与角点一致
    const itemSrc = (rx, ry) => {
      if (edge === 'wrap') return mod(ry, gh) * gw + mod(rx, gw);
      if (edge === 'clamp') {
        rx = rx < 0 ? 0 : rx > gw - 1 ? gw - 1 : rx;
        ry = ry < 0 ? 0 : ry > gh - 1 ? gh - 1 : ry;
      } else if (rx < 0 || ry < 0 || rx >= gw || ry >= gh) return -1;
      return ry * gw + rx;
    };
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = (y0 + y) * W + x0 + x;
      const oldRaw = iBefore[y * gw + x];
      // 目标格现在是资源池：原地不动（别的物品也不要盖上去）
      if (poolGids && poolMask[y * gw + x]) { poolsKept++; continue; }
      const k = itemSrc(x - dxI, y - dyI);
      let rawi = k < 0 ? (fillItem >>> 0) : iSrc[k];
      // 源格是资源池：池子不跟着搬，这里当作空处理；普通物品照常走
      if (poolGids && k >= 0 && poolMask[k]) rawi = fillItem >>> 0;
      const oldGid = oldRaw & 0x1fffffff, oldFlip = oldRaw >>> 29;
      const newGid = rawi & 0x1fffffff, newFlip = rawi >>> 29;
      if (oldGid !== newGid || oldFlip !== newFlip) { op.tile(IL, i, oldGid, oldFlip, newGid, newFlip); itemWrites++; }
    }
  }
  eng.retileRect(op, x0 - 1, y0 - 1, x1 + 1, y1 + 1);

  let moved = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = (y0 + y) * W + x0 + x;
    if (eng.layer.data[i] !== gBefore[y * gw + x]) moved++;
  }
  ed.commit();

  // 刷界面：地面/物品都变了，直接整张重画
  A.rend.invalidateAll();
  A.rend.pools = ed.poolTiles();
  A.mini.rebuild();
  A.autoDirty = true;
  A.refresh();

  return {
    ok: true, rect: { x0, y0, x1, y1, w, h }, dx: dxI, dy: dyI, edge,
    cells: n, moved, movedItems: itemWrites, poolsKept, keepPools, corners: cw * ch, movedCorners,
    fill, fillName: fill === NONE ? '（无）' : eng.cn(fill),
    ms: Math.round((performance.now() - t0) * 10) / 10,
  };
}

// 对话框里用：按范围推一步，返回统计；选区为空时给提示
export async function shiftInScope(ed, scope, dx, dy, opts = {}) {
  const r = scopeRect(ed, scope);
  if (!r) { toast('先框选一块区域，或者把范围改成“整图”'); return { ok: false, why: '没有选区' }; }
  const area = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  if (area > 400000) {
    return busy('移动地形…', async () => shiftRegion(ed, r, dx, dy, opts));
  }
  return shiftRegion(ed, r, dx, dy, opts);
}

// 小面板（不是大弹窗）：方向键 / 按钮各推 1 格或 10 格，边缘方式和作用范围可改
let panel = null;

function inField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function closePanel() {
  if (!panel) return;
  const p = panel; panel = null;
  p.el.remove();
  document.removeEventListener('pointerdown', p.off, true);
  document.removeEventListener('keydown', p.onkey, true);
  p.onClose && p.onClose();
}
export { closePanel as closeNudgePanel };

export function nudgeDialog() {
  const ed = A.ed;
  if (!ed || !ed.map || !ed.engine) { toast('先打开一张地图'); return; }
  if (panel) { closePanel(); return; }

  const st = { scope: ed.selection ? 'selection' : 'whole', edge: 'clamp', followPools: false, busy: false };
  const info = h('div', { class: 'hint', style: 'margin-top:6px' });
  let dialogEl = null;

  const refreshInfo = () => {
    const r = scopeRect(ed, st.scope);
    const head = `范围：${scopeName(st.scope)}`;
    if (!r) {
      info.replaceChildren(...[
        h('div', {}, head),
        h('div', {}, '当前没有框选区域，先在“框选”里拖出一块。'),
      ]);
      return;
    }
    const w = r.x1 - r.x0 + 1, hh = r.y1 - r.y0 + 1;
    info.replaceChildren(...[
      h('div', {}, head + ` · ${w}×${hh} 格`),
      h('div', {}, `边缘：${edgeName(st.edge)}`),
      h('div', {}, st.edge === 'empty'
        ? '移走后露出来的地方会填成这块区域里最常见的地形。'
        : st.edge === 'clamp' ? '移走后露出来的地方会拉长边上的内容。' : '从另一头卷回来，整块像转盘一样转。'),
      h('div', {}, st.followPools
        ? '资源池也会跟着搬。'
        : '资源池（res_pool）留在原地，不跟着搬。'),
      h('div', {}, '每推一次都可以 Ctrl+Z 撤回；方向键也能推（Shift+方向键推 10 格）。'),
    ]);
  };

  const push = async (dx, dy) => {
    if (st.busy) return;
    const r = scopeRect(ed, st.scope);
    if (!r) { toast('先框选一块区域，或者把范围改成“整图”'); return; }
    st.busy = true;
    const res = await shiftInScope(ed, st.scope, dx, dy, { edge: st.edge, keepPools: !st.followPools });
    st.busy = false;
    if (!res || !res.ok) { if (res && res.why) toast(res.why); return; }
    toast(`已平移 ${dx},${dy} 格 · ${res.cells} 格区域 · ${res.ms}ms`, 1400);
    refreshInfo();
  };

  const dirBtn = (label, dx, dy, title) => h('button', {
    style: { minWidth: '42px' }, title: title || `向${label}平移`, onclick: () => push(dx, dy),
  }, label);

  const pad = (step) => h('div', { class: 'row', style: { gap: '4px' } },
    dirBtn('←', -step, 0), dirBtn('↑', 0, -step), dirBtn('↓', 0, step), dirBtn('→', step, 0));

  const body = h('div', { style: { width: '264px' } },
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('b', {}, '批量移动地形'),
      h('span', { class: 'hint', style: { marginLeft: 'auto', padding: '2px 6px' } }, 'Esc 关闭')),
    h('div', { class: 'field' }, h('label', {}, '作用范围'),
      segmented(SCOPES, st.scope, (v) => { st.scope = v; refreshInfo(); })),
    h('div', { class: 'field' }, h('label', {}, '边缘处理'),
      select(EDGES, st.edge, (v) => { st.edge = v; refreshInfo(); }, { style: 'width:100%' })),
    h('div', { class: 'field' },
      toggle('资源池跟着一起移动', st.followPools, (v) => { st.followPools = !!v; refreshInfo(); })),
    h('div', { class: 'field' }, h('label', {}, '推 1 格'), pad(1)),
    h('div', { class: 'field' }, h('label', {}, '推 10 格'), pad(10)),
    info,
  );

  const el = h('div', {
    class: 'popover',
    style: { left: '12px', bottom: '52px', top: 'auto', width: '280px', padding: '10px', maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' },
  }, body);
  document.body.append(el);

  const off = (e) => { if (!el.contains(e.target)) closePanel(); };
  const onkey = (e) => {
    if (e.key === 'Escape') { closePanel(); return; }
    if (inField(e) || modalOpen()) return;
    const map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    push(d[0] * (e.shiftKey ? 10 : 1), d[1] * (e.shiftKey ? 10 : 1));
  };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  document.addEventListener('keydown', onkey, true);
  panel = { el, off, onkey };
  refreshInfo();
  return el;
}

Object.assign(HELP, {
  'tool.movebrush': {
    t: '批量移动地形',
    s: '把一块区域整体推一格，边缘自动处理',
    b: '把“整图 / 当前选区 / 当前可见区域”里的地形和普通物品整体平移，一次一格或十格。移出范围的部分按“边缘处理”决定：<b>空出</b>接着填成这块区域里最常见的地形，<b>边缘复制</b>把边上的内容拉长，<b>循环</b>从另一头卷回来。<b>资源池默认留在原地不跟着搬</b>（在“批量移动”小面板里勾选“资源池跟着一起移动”才会搬）。',
    tips: ['方向键也能推，Shift+方向键一次 10 格。', '每次推都是一步，Ctrl+Z 就能撤回。', '循环 = 转盘：左/右、上/下边被当成同一处，非无缝的图推出去再推回来，右/下边界会留 1 格接缝（撤销能精确还原）。想要干净平移就用“空出”或“边缘复制”。'],
  },
});
