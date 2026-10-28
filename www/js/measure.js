// 测距与射程圈：量两点距离、估算行军时间、在地图上画单位射程
import { A } from './state.js';
import { h, modal, toast, slider, toggle, segmented } from './ui.js';
import { TERRAIN_CN } from './terrain.js';

const ed = A.ed;
const TW = 20;

// 常见单位的速度（格/秒），只用来估算，不保证跟游戏里完全一致
const SPEED = {
  builder: 2.2, tank: 2.4, heavyTank: 3.0, hoverTank: 3.4, artillery: 1.6,
  gunship: 5.5, helicopter: 6.0, amphibious: 2.6, infantry: 0,
};
// 射程（格）：从单位属性 range 里读，读不到用这个兜底
const RANGE = {
  turret: 12, heavyTurret: 15, artillery: 14, hoverTank: 0, tank: 0,
  gunship: 0, commandCenter: 8, antiAir: 13, missileTurret: 18,
};

export function unitRange(o) {
  const props = o.props || [];
  const get = (n) => { const p = props.find((x) => x.name === n); return p ? p.value : null; };
  const unit = get('unit') || '';
  const r = get('range');
  if (r != null && r !== '' && !isNaN(+r)) return +r / TW;
  return RANGE[unit] || 0;
}

export function unitSpeed(o) {
  const props = o.props || [];
  const get = (n) => { const p = props.find((x) => x.name === n); return p ? p.value : null; };
  const sp = get('speed');
  if (sp != null && sp !== '' && !isNaN(+sp)) return +sp / TW;
  return SPEED[get('unit') || ''] || 2.5;
}

// 地图上所有带射程的东西
export function rangedUnits() {
  const out = [];
  if (!ed.map) return out;
  for (const { o } of ed.allObjects()) {
    const props = o.props || [];
    const unit = (props.find((p) => p.name === 'unit') || {}).value;
    if (!unit) continue;
    const r = unitRange(o);
    if (r <= 0) continue;
    const team = +((props.find((p) => p.name === 'team') || {}).value ?? 0);
    const w = +(o.attrs.width || 30), hh = +(o.attrs.height || 30);
    out.push({ o, unit, team, r, cx: (+o.attrs.x + w / 2) / TW, cy: (+o.attrs.y - hh / 2) / TW });
  }
  return out;
}

// 把射程圈交给渲染器画（叠加层）
let rangeLayer = null;
export function showRanges(on) {
  const cv = document.getElementById('cv');
  if (!cv) return;
  if (!on) { if (rangeLayer) { rangeLayer.remove(); rangeLayer = null; } A.rend.request && A.rend.request(); return; }
  if (!rangeLayer) {
    const wrap = cv.parentElement;
    const c = document.createElement('canvas');
    c.className = 'range-layer';
    c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3';
    wrap.append(c);
    rangeLayer = c;
  }
  drawRanges();
}

export function drawRanges() {
  if (!rangeLayer || !ed.map) return;
  const cv = document.getElementById('cv');
  const dpr = window.devicePixelRatio || 1;
  const c = rangeLayer;
  c.width = cv.width; c.height = cv.height;
  c.style.width = cv.clientWidth + 'px'; c.style.height = cv.clientHeight + 'px';
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  const v = A.rend.view;
  g.setTransform(v.z * dpr, 0, 0, v.z * dpr, -v.ox * v.z * dpr, -v.oy * v.z * dpr);
  const cols = ['#4aa3ff', '#ff7a7a', '#7affc0', '#f0a0ff'];
  for (const u of rangedUnits()) {
    const px = u.cx * TW, py = u.cy * TW, rr = u.r * TW;
    // 只画视野附近的，大图不至于卡
    if (u.cx * TW < v.ox - rr - 200 || u.cx * TW > v.ox + A.rend.cw + rr + 200) continue;
    if (u.cy * TW < v.oy - rr - 200 || u.cy * TW > v.oy + A.rend.ch + rr + 200) continue;
    g.strokeStyle = cols[u.team % cols.length];
    g.globalAlpha = 0.75;
    g.lineWidth = 1.5 / v.z;
    g.beginPath(); g.arc(px, py, rr, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.10;
    g.fillStyle = cols[u.team % cols.length];
    g.fill();
  }
  g.globalAlpha = 1;
}

export function measureDialog() {
  if (!ed.map) return;
  let mode = 'line';
  let pxPerSec = 2.5;
  let showCircle = false;
  const out = h('div', { class: 'hint' });
  const body = h('div', {},
    segmented([['line', '量距离'], ['circle', '看射程圈']], mode, (v) => { mode = v; render(); }),
    h('div', { style: 'margin-top:8px' }, out));
  const calc = h('div', {});
  const render = () => {
    if (mode === 'line') {
      body.replaceChildren(
        segmented([['line', '量距离'], ['circle', '看射程圈']], mode, (v) => { mode = v; render(); }),
        h('div', { class: 'field', style: 'margin-top:10px' },
          h('label', {}, '陆军速度（格/秒）'),
          slider('', 1, 8, pxPerSec, (v) => { pxPerSec = v; upd(); }, { step: 0.1, fmt: (v) => v.toFixed(1) + ' 格/秒' })),
        calc, out);
      upd();
    } else {
      const list = rangedUnits();
      body.replaceChildren(
        segmented([['line', '量距离'], ['circle', '看射程圈']], mode, (v) => { mode = v; render(); }),
        h('div', { class: 'hint', style: 'margin-top:10px' },
          list.length ? `地图上有 ${list.length} 个带射程的单位，已经画在地图上了。` : '这张图上没有找到带射程的单位（炮塔、防空等）。'),
        toggle('一直显示射程圈', showCircle, (v) => { showCircle = v; showRanges(v); }),
        list.length ? h('div', { style: 'max-height:34vh;overflow:auto' },
          ...list.map((u) => h('div', { class: 'hrow' },
            h('span', { class: 'hstat' }, `${Math.round(u.cx)},${Math.round(u.cy)}`),
            h('span', {}, `${u.unit} · 第 ${u.team} 队`),
            h('span', { class: 'hint' }, `射程 ${u.r.toFixed(1)} 格`)))) : null);
    }
  };
  const upd = () => {
    // 用当前选区当量尺：如果有选区就量它的对角线
    const s = A.ed.selection;
    if (!s) { calc.textContent = '先在地图上框一块区域，或者用"量距离"工具拖一条线。'; return; }
    const w = s.x2 - s.x1 + 1, hh = s.y2 - s.y1 + 1;
    const d = Math.hypot(w, hh);
    calc.replaceChildren(
      h('div', {}, `选区 ${w} × ${hh} 格`),
      h('div', {}, `对角线 ${d.toFixed(1)} 格`),
      h('div', {}, `陆军走过去约 ${(d / pxPerSec).toFixed(1)} 秒（${pxPerSec.toFixed(1)} 格/秒）`));
  };
  render();
  const close = () => { if (!showCircle) showRanges(false); };
  return modal('测距与射程圈', body, [
    { label: '关闭', value: 0, primary: true },
  ], { wide: true }).then(() => close());
}

// 在地图上拖一条线量距离（供工具栏调用）
export function startMeasureLine() {
  toast('在地图上从起点拖到终点');
}
