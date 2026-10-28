// 对称画图辅助：镜像预览 + 对称差异热图（只读，不改地图）
// 导出：mirrorPreviewCells(ed, kind, layer) / diffHeat(ed, kind) / parityDialog()
import { A } from './state.js';
import { h, modal, toast, segmented, toggle } from './ui.js';
import { HELP } from './help.js';
import { symmetryDiff } from './transform.js';
import { renderFlat } from './shot.js';

const ed = A.ed;
const TW = 20;
const KINDS = [['lr', '左右镜像'], ['tb', '上下镜像'], ['rot', '中心对称']];
const KIND_CN = { lr: '左右镜像', tb: '上下镜像', rot: '中心对称', rl: '右→左', bt: '下→上', quad: '四向' };

// 和 transform.js 里 mirrorMap 的 srcT 是同一套坐标映射：目标格 → 源格（+ 需要的翻转）
// 镜像只往「目标半区」写，源半区保持不动，所以这里遍历的是目标格
function srcCell(kind, W, H, x, y) {
  switch (kind) {
    case 'lr': return x >= W / 2 ? [W - 1 - x, y, 'h'] : null;
    case 'rl': return x < W / 2 ? [W - 1 - x, y, 'h'] : null;
    case 'tb': return y >= H / 2 ? [x, H - 1 - y, 'v'] : null;
    case 'bt': return y < H / 2 ? [x, H - 1 - y, 'v'] : null;
    case 'rot': return x >= W / 2 ? [W - 1 - x, H - 1 - y, 'r180'] : null;
    case 'quad': {
      const r = x >= W / 2, b = y >= H / 2;
      if (!r && !b) return null;
      return [r ? W - 1 - x : x, b ? H - 1 - y : y, r && b ? 'r180' : r ? 'h' : 'v'];
    }
  }
  return null;
}

// 镜像会把哪些格写成什么：[[目标x, 目标y, 写进去的 gid], ...]
// layer: 'ground'（默认，地面）| 'items'（物品层，gid 已经按翻转关系换成了镜像后的变体）
export function mirrorPreviewCells(ed2 = ed, kind = 'lr', layer = 'ground') {
  const m = ed2.map;
  if (!m) return [];
  const W = m.width, H = m.height;
  const L = layer === 'items' ? m.items : m.ground;
  if (!L) return [];
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = srcCell(kind, W, H, x, y);
    if (!s) continue;
    const gid = L.data[s[1] * W + s[0]];
    if (!gid) continue;
    out.push([x, y, layer === 'items' ? ed2.itemTupleTransform(gid, s[2]) : gid]);
  }
  return out;
}

// 对称差异：直接复用 transform.js 的 symmetryDiff（它比的是主地形，不是 gid，别改它）
export function diffHeat(ed2 = ed, kind = 'lr') {
  const m = ed2.map;
  if (!m) return { count: 0, cells: [], total: 0, spawns: 0, kind };
  const r = symmetryDiff(ed2, kind);
  const W = m.width;
  const cells = [];
  for (let i = 0; i < r.diff.length; i++) if (r.diff[i]) cells.push([i % W, (i / W) | 0]);
  return { count: r.count, cells, total: r.total, spawns: r.spawns, kind };
}

// ---------------- 地图上的红框高亮层 ----------------
let heatLayer = null;
let heatCells = [];
let heatAxis = 'lr';
let heatRaf = 0;
let heatKey = '';

function ensureLayer() {
  const cv = document.getElementById('cv');
  if (!cv) return null;
  if (!heatLayer || !heatLayer.isConnected) {
    heatLayer = document.createElement('canvas');
    heatLayer.className = 'parity-layer';
    heatLayer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:4';
    (cv.parentElement || document.getElementById('stage')).append(heatLayer);
  }
  return heatLayer;
}

function drawHeat() {
  if (!heatLayer || !ed.map) return;
  const cv = document.getElementById('cv');
  const dpr = window.devicePixelRatio || 1;
  const c = heatLayer;
  c.width = cv.width; c.height = cv.height;
  c.style.width = cv.clientWidth + 'px'; c.style.height = cv.clientHeight + 'px';
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  const v = A.rend.view;
  g.setTransform(v.z * dpr, 0, 0, v.z * dpr, -v.ox * v.z * dpr, -v.oy * v.z * dpr);
  const W = ed.map.width, H = ed.map.height;
  // 只画视野里的格子，300×300 的大图也不卡
  const x0 = Math.max(0, Math.floor(v.ox / TW) - 1), x1 = Math.min(W - 1, Math.ceil((v.ox + A.rend.cw / v.z) / TW) + 1);
  const y0 = Math.max(0, Math.floor(v.oy / TW) - 1), y1 = Math.min(H - 1, Math.ceil((v.oy + A.rend.ch / v.z) / TW) + 1);
  g.fillStyle = 'rgba(229,72,77,0.34)';
  g.strokeStyle = 'rgba(255,120,120,0.9)';
  g.lineWidth = 1 / v.z;
  for (const [x, y] of heatCells) {
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    g.fillRect(x * TW, y * TW, TW, TW);
    g.strokeRect(x * TW + 0.5 / v.z, y * TW + 0.5 / v.z, TW - 1 / v.z, TW - 1 / v.z);
  }
  // 对称轴
  g.setLineDash([6 / v.z, 6 / v.z]);
  g.lineWidth = 1.6 / v.z;
  g.strokeStyle = 'rgba(120,200,255,0.95)';
  g.beginPath();
  if (heatAxis === 'lr' || heatAxis === 'rot') { const X = (W / 2) * TW; g.moveTo(X, 0); g.lineTo(X, H * TW); }
  if (heatAxis === 'tb' || heatAxis === 'rot') { const Y = (H / 2) * TW; g.moveTo(0, Y); g.lineTo(W * TW, Y); }
  g.stroke();
  g.setLineDash([]);
}

function startLoop() {
  stopLoop();
  heatKey = '';
  const tick = () => {
    const v = A.rend.view;
    const cv = document.getElementById('cv');
    const key = `${v.ox},${v.oy},${v.z},${cv ? cv.width : 0},${heatCells.length}`;
    if (key !== heatKey) { heatKey = key; drawHeat(); }
    heatRaf = requestAnimationFrame(tick);
  };
  heatRaf = requestAnimationFrame(tick);
}

function stopLoop() {
  if (heatRaf) cancelAnimationFrame(heatRaf);
  heatRaf = 0;
}

function clearHeat() {
  stopLoop();
  if (heatLayer) { heatLayer.remove(); heatLayer = null; }
  heatCells = [];
}

// ---------------- 镜像预览小图 ----------------
// 左边原图，右边“按这个方向镜像之后”的样子：目标半区被镜像后的源半区盖住
function makePreview(kind, diffCells) {
  const m = ed.map;
  const out = { cv: null, scale: 1, blank: false };
  let base = null;
  try {
    const r = renderFlat(ed, A.rend, { scale: 1, marks: false, maxSide: 560 });
    base = r && (r.cv || r);
    out.scale = r && r.scale ? r.scale : 1;
  } catch (e) { base = null; }
  if (!base || !base.width) { out.blank = true; return out; }
  const W = m.width, H = m.height;
  const ppT = base.width / W;          // 每格多少像素
  const cv = new OffscreenCanvas(base.width, base.height);
  const g = cv.getContext('2d');
  g.drawImage(base, 0, 0);
  // 目标半区（和 srcCell 的判断一致：x >= ceil(W/2) / y >= ceil(H/2)）
  const tx0 = Math.ceil(W / 2) * ppT, ty0 = Math.ceil(H / 2) * ppT;
  g.save();
  g.beginPath();
  if (kind === 'lr') g.rect(tx0, 0, base.width - tx0, base.height);
  else if (kind === 'tb') g.rect(0, ty0, base.width, base.height - ty0);
  else g.rect(tx0, ty0, base.width - tx0, base.height - ty0);
  g.clip();
  g.imageSmoothingEnabled = true;
  if (kind === 'lr') { g.translate(base.width, 0); g.scale(-1, 1); }
  else if (kind === 'tb') { g.translate(0, base.height); g.scale(1, -1); }
  else { g.translate(base.width, base.height); g.scale(-1, -1); }
  g.drawImage(base, 0, 0);
  g.restore();
  // 差异格用小红点标出来（两张图都标，方便对照）；点小一点，别把地形糊掉
  if (diffCells && diffCells.length) {
    const s = Math.max(1.5, ppT * 0.42);
    g.fillStyle = 'rgba(229,72,77,0.72)';
    for (const [x, y] of diffCells) g.fillRect(x * ppT + (ppT - s) / 2, y * ppT + (ppT - s) / 2, s, s);
  }
  out.cv = cv;
  return out;
}

// 按钮按下态：.on 样式只对 .seg / .presets 里的按钮生效，这里自己描个边
function paintBtn(btn, on) {
  btn.style.borderColor = on ? 'var(--accent)' : '';
  btn.style.color = on ? 'var(--text)' : '';
}

// ---------------- 对话框 ----------------
// 弹窗默认居中会挡住地图；这两个工具的看点全在地图上，所以宽屏时把面板靠右停靠，左边留出地图
function dockRight(width) {
  if (!(window.innerWidth > 980)) return;
  const el = [...document.querySelectorAll('.modal')].pop();
  if (!el) return;
  el.style.placeItems = 'center end';
  el.style.paddingRight = '12px';
  // 亮点全在地图上，所以左边不压黑，只在面板一侧留一层薄暗
  el.style.background = 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 42%, rgba(0,0,0,.52) 62%, rgba(0,0,0,.62) 100%)';
  const box = el.querySelector('.box');
  if (box) box.style.width = `min(${width}px, 46vw)`;
}

export function parityDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (!ed.map.ground && !ed.map.items) { toast('这张地图没有图块层，没法做对称检查'); return; }
  let kind = 'lr';
  let heatOn = false;
  let previewOn = false;
  let heat = diffHeat(ed, kind);

  const sum = h('div', { style: 'font-size:12.5px;line-height:1.7;margin-top:4px' });
  const pvBox = h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:10px' });
  const prevBtn = h('button', { onclick: () => { previewOn = !previewOn; paintBtn(prevBtn, previewOn); prevBtn.textContent = previewOn ? '收起预览' : '镜像预览'; renderPreview(); } }, '镜像预览');
  const heatBtn = h('button', { onclick: () => { setHeat(!heatOn); } }, '在地图上高亮这些格');

  const countText = () => {
    const g = mirrorPreviewCells(ed, kind, 'ground').length;
    const it = mirrorPreviewCells(ed, kind, 'items').length;
    return { g, it };
  };

  const setHeat = (on) => {
    heatOn = on;
    paintBtn(heatBtn, on);
    heatBtn.textContent = on ? '清除地图上的高亮' : '在地图上高亮这些格';
    if (on) {
      heatCells = heat.cells;
      heatAxis = kind;
      ensureLayer();
      startLoop();
      A.rend.request && A.rend.request();
    } else clearHeat();
  };

  const renderPreview = () => {
    if (!previewOn) { pvBox.replaceChildren(); return; }
    const r = makePreview(kind, heat.cells);
    if (r.blank) {
      pvBox.replaceChildren(h('div', { style: 'font-size:12px;color:var(--muted)' }, '图块还没加载完，先在地图上拖一下再回来看预览。'));
      return;
    }
    const mk = (cv, cap) => {
      const c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      c.style.cssText = 'max-width:100%;max-height:26vh;display:block;margin:0 auto;border:1px solid #2a2f3a;border-radius:6px';
      c.getContext('2d').drawImage(cv, 0, 0);
      return h('div', { style: 'text-align:center;min-width:0' },
        c, h('div', { style: 'font-size:11.5px;color:var(--muted);margin-top:3px' }, cap));
    };
    const base = makeBase();
    pvBox.replaceChildren(
      mk(base, `现在这样（${ed.map.width}×${ed.map.height}）`),
      mk(r.cv, `按${KIND_CN[kind]}之后（左边这半不动，右半镜像过去）`),
    );
  };

  const makeBase = () => {
    const m = ed.map;
    try {
      const rr = renderFlat(ed, A.rend, { scale: 1, marks: false, maxSide: 560 });
      const cv = rr && (rr.cv || rr);
      if (cv && cv.width) {
        const c2 = new OffscreenCanvas(cv.width, cv.height);
        const g = c2.getContext('2d');
        g.drawImage(cv, 0, 0);
        const ppT = cv.width / m.width;
        const s = Math.max(1.5, ppT * 0.42);
        g.fillStyle = 'rgba(229,72,77,0.72)';
        for (const [x, y] of heat.cells) g.fillRect(x * ppT + (ppT - s) / 2, y * ppT + (ppT - s) / 2, s, s);
        return c2;
      }
    } catch (e) { /* 忽略：下面给个空图 */ }
    return new OffscreenCanvas(1, 1);
  };

  const upd = () => {
    heat = diffHeat(ed, kind);
    const n = countText();
    const pct = heat.total ? (heat.count / heat.total * 100) : 0;
    sum.replaceChildren();
    if (!heat.count && !heat.spawns) {
      sum.append(h('div', { style: 'color:#3fb950' }, `✓ 这张地图已经是${KIND_CN[kind]}对称的：${heat.total} 格里没有一处不一样。`));
    } else {
      sum.append(h('div', {}, `当前不对称 `, h('b', {}, String(heat.count)), ` 格 / 共 ${heat.total} 格（${pct.toFixed(1)}%）`,
        heat.spawns ? `，另外有 ${heat.spawns} 个出生点在镜像位置上没有对应的出生点` : ''));
      sum.append(h('div', { style: 'color:var(--muted);font-size:12px' },
        `如果现在做一次${KIND_CN[kind]}，会往图上写 ${n.g + n.it} 个非空格（地面 ${n.g} 格 + 物品 ${n.it} 格）。`,
        '这里只预览、不改图；真要改去「生成 → 整图镜像」。'));
    }
    if (heatOn) { heatCells = heat.cells; heatAxis = kind; heatKey = ''; drawHeat(); }
    if (previewOn) renderPreview();
  };

  const seg = segmented(KINDS, kind, (v) => { kind = v; upd(); });
  const body = h('div', {},
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:6px' }, '选一个对称方向，看两边差在哪里。红色格就是不一样的地方，蓝色虚线是对称轴。'),
    seg,
    sum,
    h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px' }, heatBtn, prevBtn),
    pvBox,
    h('div', { style: 'font-size:12px;color:var(--muted);margin-top:10px;line-height:1.7' },
      '提示：差异是按“主地形”比的，所以同一块地换了朝向、换了接图的图块不算不一样（那些在游戏里看起来一样）。'),
  );
  upd();

  const p = modal('对称画图辅助（镜像预览 + 差异热图）', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
  dockRight(560);
  return p.then((v) => { clearHeat(); return v; });
}

Object.assign(HELP, {
  'tool.parity': {
    t: '对称画图辅助',
    s: '镜像会变成什么样、现在两边差在哪，一眼看到',
    b: '选左右 / 上下 / 中心对称，下面会告诉你<b>现在有多少格两边不一样</b>，还能把不一样的格子在地图上用红框标出来（蓝色虚线是对称轴）。点「镜像预览」会并排画两个小图：左边是现在的地图，右边是按这个方向镜像之后的样子——<b>源半区不动、目标半区被镜像盖住</b>，和「生成 → 整图镜像」的结果一致。',
    tips: ['这里只是预览和测量，不会改地图；要真改去「生成」里的整图镜像。', '差异按“主地形”比：同一块地换了朝向图块不算不一样。', '出生点不对称会单独提示——对战图最容易被忽略的就是这个。'],
  },
});
