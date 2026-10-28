// 吸附与精密绘图：把落笔的坐标吸到格中心 / 格交点 / 11 等分点，按住 Shift 只吸水平或垂直
// 只改“落笔坐标”，平移、缩放、取色、撤销、多指手势都不受影响（见 installSnapHooks 的说明）
import { A } from './state.js';
import { h, modal, toast, segmented, slider, toggle, modalOpen } from './ui.js';
import { HELP } from './help.js';

export const SNAP_MODES = [
  ['off', '关闭'],
  ['center', '格中心'],
  ['corner', '格交点'],
  ['tenth', '11 等分'],
];

// 当前吸附状态（对话框直接改这里；测试也可以直接改）
export const snapFlags = {
  mode: 'off',        // 'off' | 'center' | 'corner' | 'tenth'
  shiftLock: true,    // 按住 Shift 时只沿水平 / 垂直吸
  tol: 8,             // 吸附容差（屏幕像素）；换算到地图像素要除以缩放
  dot: true,          // 在地图上显示吸附点
};

// 把一个“地图像素坐标”吸到规则点上
//   ed: 编辑器；px/py: 地图像素坐标
//   flags: { mode, shiftLock, shift, prev, tol, zoom }
//     shift: 当前是否按住 Shift；prev: 上一个吸附结果 {x,y}（用于轴锁定）
//     tol: 屏幕像素容差；zoom: 当前缩放（用于把屏幕容差换成地图容差）
// 返回 { x, y, snapped, mode, axis }；关闭吸附时原样返回
export function snapPoint(ed, px, py, flags = {}) {
  const f = { ...snapFlags, ...flags };
  const m = ed && ed.map;
  const tw = (m && m.tw) || 20, th = (m && m.th) || 20;
  const zoom = f.zoom > 0 ? f.zoom : 1;
  const mode = f.mode || 'off';
  let x = px, y = py, axis = null;
  if (mode === 'off') return { x, y, snapped: false, mode, axis: null };

  // Shift 轴锁定：只沿水平或垂直推。横竖方向看这次相对上一个落点哪边偏得多
  let lockX = null, lockY = null;
  if (f.shiftLock !== false && f.shift && f.prev) {
    const ddx = Math.abs(px - f.prev.x), ddy = Math.abs(py - f.prev.y);
    if (ddx >= ddy) lockY = f.prev.y; else lockX = f.prev.x;
    if (lockY != null) axis = 'h'; else axis = 'v';
  }

  const tol = Math.max(0, (f.tol == null ? 8 : f.tol) / zoom);
  if (mode === 'center') {
    const cx = (Math.floor(px / tw) + 0.5) * tw, cy = (Math.floor(py / th) + 0.5) * th;
    if (Math.abs(px - cx) <= tol) x = cx;
    if (Math.abs(py - cy) <= tol) y = cy;
  } else if (mode === 'corner') {
    const cx = Math.round(px / tw) * tw, cy = Math.round(py / th) * th;
    if (Math.abs(px - cx) <= tol) x = cx;
    if (Math.abs(py - cy) <= tol) y = cy;
  } else if (mode === 'tenth') {
    // 每格等分 10 份（11 个点），用来画对称中线、半格偏移这类精确位置
    const sx = tw / 10, sy = th / 10;
    x = Math.round(px / sx) * sx;
    y = Math.round(py / sy) * sy;
  } else {
    return { x: px, y: py, snapped: false, mode, axis: null };
  }

  if (lockX != null) x = lockX;
  if (lockY != null) y = lockY;
  return { x, y, snapped: x !== px || y !== py, mode, axis };
}

// ---------------- 接到输入层 ----------------
// input.js 的坐标链路是：pointer 事件 → rend.toMap(sx, sy) → 格/角点。
// 所以这里包住 rend.toMap 这个实例方法：只有“参数正好等于最近一次指针位置”时才吸附，
// 画布中心换算视野、粘贴居中、小地图跳转这些调用都拿不到指针坐标，自然不会被吸。
// 平移/缩放/多指手势走的是屏幕坐标，也不经过 toMap，所以不会受影响。
let installed = null;
let dotEl = null;

function localOf(cv, e) {
  const r = cv.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
}

function ensureDot() {
  if (dotEl) return dotEl;
  dotEl = document.createElement('div');
  dotEl.id = 'snapdot';
  dotEl.setAttribute('aria-hidden', 'true');
  Object.assign(dotEl.style, {
    position: 'fixed', width: '9px', height: '9px', border: '1px solid #ffd166',
    borderRadius: '50%', pointerEvents: 'none', zIndex: '6', display: 'none',
    transform: 'translate(-50%,-50%)', boxShadow: '0 0 0 1px rgba(0,0,0,.45)',
  });
  document.body.append(dotEl);
  return dotEl;
}

function hideDot() { if (dotEl) dotEl.style.display = 'none'; }

function showDot(rend, res) {
  if (!dotEl || !res.snapped) { hideDot(); return; }
  const cvr = rend.cv.getBoundingClientRect();
  const sc = rend.toScreen(res.x, res.y);
  if (sc.x < -2 || sc.y < -2 || sc.x > cvr.width + 2 || sc.y > cvr.height + 2) { hideDot(); return; }
  dotEl.style.left = (cvr.left + sc.x) + 'px';
  dotEl.style.top = (cvr.top + sc.y) + 'px';
  dotEl.style.display = 'block';
}

// 幂等安装；返回卸载函数
export function installSnapHooks() {
  if (installed) return installed;
  const rend = A.rend, cv = rend.cv;
  const orig = rend.toMap;
  const ptrs = new Set();
  const p = { sx: 0, sy: 0, has: false, shift: false, at: 0 };
  let last = null;

  const update = (e) => {
    const { sx, sy } = localOf(cv, e);
    p.sx = sx; p.sy = sy; p.has = true; p.shift = e.shiftKey; p.at = performance.now();
  };
  const onDown = (e) => { ptrs.add(e.pointerId); if (ptrs.size > 1) last = null; update(e); };
  const onMove = (e) => { update(e); };
  const onUp = (e) => {
    ptrs.delete(e.pointerId);
    if (!ptrs.size) { hideDot(); last = null; }
  };
  const onBlur = () => { ptrs.clear(); hideDot(); last = null; };

  rend.toMap = function (sx, sy) {
    const raw = orig.call(this, sx, sy);
    if (!p.has || ptrs.size > 1) return raw;
    if (performance.now() - p.at > 250) return raw;
    if (Math.abs(sx - p.sx) > 1 || Math.abs(sy - p.sy) > 1) return raw;
    if (snapFlags.mode === 'off') { hideDot(); return raw; }
    const res = snapPoint(A.ed, raw.x, raw.y, { zoom: this.view.z, shift: p.shift, prev: last });
    if (res.mode !== 'off') last = { x: res.x, y: res.y };
    if (res.snapped && snapFlags.dot) { ensureDot(); showDot(this, res); } else hideDot();
    return { x: res.x, y: res.y };
  };

  cv.addEventListener('pointerdown', onDown, true);
  cv.addEventListener('pointermove', onMove, true);
  cv.addEventListener('pointerup', onUp, true);
  cv.addEventListener('pointercancel', onUp, true);
  addEventListener('blur', onBlur);

  const un = () => {
    rend.toMap = orig;
    cv.removeEventListener('pointerdown', onDown, true);
    cv.removeEventListener('pointermove', onMove, true);
    cv.removeEventListener('pointerup', onUp, true);
    cv.removeEventListener('pointercancel', onUp, true);
    removeEventListener('blur', onBlur);
    hideDot();
    installed = null;
    return true;
  };
  installed = un;
  return un;
}

export function uninstallSnapHooks() {
  return installed ? installed() : false;
}
export function snapHooksInstalled() { return !!installed; }

// ---------------- 对话框 ----------------
export function snapDialog() {
  if (!A.ed || !A.ed.map) { toast('先打开一张地图'); return; }
  if (modalOpen()) { toast('先关掉当前弹窗'); return; }
  // 打开展示面板时顺手装上钩子，用户不用再找开关
  installSnapHooks();

  const body = h('div', {});
  const info = h('div', { class: 'hint', style: { marginTop: '8px' } });

  const refresh = () => {
    const m = A.ed.map, tw = m.tw || 20;
    const lines = [];
    if (snapFlags.mode === 'off') lines.push('吸附已关闭，落笔就是鼠标的原始位置。');
    else if (snapFlags.mode === 'center') lines.push(`落笔会吸到格子中心（每 ${tw} 像素一格的中心），命不中时按原始位置。`);
    else if (snapFlags.mode === 'corner') lines.push(`落笔会吸到格子四角（${tw} 像素的整数倍），适合画直角和对称线。`);
    else lines.push(`落笔会吸到每格 10 等分的位置（每 ${tw / 10} 像素一个点），适合精确的半格、中线。`);
    if (snapFlags.shiftLock) lines.push('按住 Shift：只沿水平或垂直方向吸（从上一个落点推直线）。');
    lines.push('吸附只改变「落笔坐标」：平移、缩放、取色、撤销和多指手势都不受影响。');
    info.replaceChildren(...lines.map((t) => h('div', {}, t)));
  };

  body.append(
    h('div', { class: 'field' }, h('label', {}, '吸附方式'),
      segmented(SNAP_MODES, snapFlags.mode, (v) => { snapFlags.mode = v; refresh(); })),
    h('div', { class: 'field' },
      toggle('按住 Shift 只吸水平 / 垂直', snapFlags.shiftLock, (v) => { snapFlags.shiftLock = v; refresh(); }),
      h('div', { style: { height: '6px' } }),
      toggle('显示吸附点', snapFlags.dot, (v) => { snapFlags.dot = v; if (!v) hideDot(); })),
    slider('吸附容差', 2, 20, snapFlags.tol, (v) => { snapFlags.tol = v; refresh(); }, { fmt: (v) => v + ' 像素' }),
    info,
    h('div', { class: 'hint', style: { marginTop: '8px' } },
      '小提示：把吸附设成', h('b', {}, '格交点'), '，再按住 Shift 横向拖，就能画出很直的边；',
      h('b', {}, '11 等分'), ' 适合画对称中线（一格 20 像素时每 2 像素一个点）。'),
  );
  refresh();
  modal('吸附与精密绘图', body, [{ label: '完成', value: true, primary: true }], {});
}

Object.assign(HELP, {
  'tool.snapgrid': {
    t: '吸附与精密绘图',
    s: '落笔吸到格中心、格交点或 11 等分点',
    b: '打开吸附后，画笔、矩形、选区这些工具的落笔位置会对齐到规则点：<b>格中心</b>画圆/湖更圆，<b>格交点</b>画直角和对称线更准，<b>11 等分</b>每格 10 个小格，适合画对称中线。按住 Shift 时只沿水平或垂直方向推，配合吸附画出笔直的边缘。',
    tips: ['吸附只影响落笔坐标，平移、缩放、取色、撤销和多指手势都不受影响。', '“吸附容差”是屏幕上多少像素以内才吸；放小一点更自由，放大更容易吸住。', '地图上出现的黄色小圆圈就是吸附点。'],
  },
});
