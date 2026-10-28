// 「更像游戏」的画面叠加：地面高光、水面光泽/波纹、边缘暗角、单位投影
// 纯画布叠加，不改任何地图数据；可以作用在截图导出、封面生成之后的成品画布上
import { A } from './state.js';
import { h, modal, toast, slider } from './ui.js';
import { HELP } from './help.js';
import { renderFlat } from './shot.js';

const ed = A.ed;
const KEY = 'rwGameLook';

export const DEFAULT_LOOK = { light: 0.5, water: 0.75, vignette: 0.45, shadow: 0.6, grain: 0.15 };

export function loadGameLook() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_LOOK, ...(o && typeof o === 'object' ? o : {}) };
  } catch { return { ...DEFAULT_LOOK }; }
}

export function saveGameLook(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* 私密模式下忽略 */ }
}

// ---------------- 小工具 ----------------
function mkCanvas(w, hh) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, hh | 0));
  const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, hh | 0); return c;
}

// 地图上的水格 → 一张 W×H 的小蒙版（1 像素 = 1 格），再放大用，大图也不卡
function waterMask(map, eng) {
  const W = map.width, H = map.height;
  const cv = mkCanvas(W, H);
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  let n = 0;
  if (eng && eng.V) {
    g.fillStyle = '#fff';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = eng.tileTerrain(y * W + x);
      const nm = eng.name(t) || '';
      if (/water|lake|swamp/i.test(nm) && !/bridge/i.test(nm)) { g.fillRect(x, y, 1, 1); n++; }
    }
  }
  return { cv, count: n, W, H };
}

function tintedLayer(W, H, maskCv, color, fn) {
  const cv = mkCanvas(W, H);
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  if (fn) fn(g, W, H);
  // 只留下水的部分
  g.globalCompositeOperation = 'destination-in';
  g.imageSmoothingEnabled = true;
  g.drawImage(maskCv, 0, 0, W, H);
  return cv;
}

// ---------------- 主函数 ----------------
// opts 里除强度外还可以给 {ed} / {map, engine} / {scale}（每格多少像素，默认按 cv 宽度推算）
export function applyGameLook(ctx, cv, opts = {}) {
  if (!ctx || !cv) return null;
  const o = { ...loadGameLook(), ...opts };
  const W = cv.width, H = cv.height;
  if (!W || !H) return null;
  const ed2 = opts.ed || ed;
  const map = opts.map || (ed2 && ed2.map);
  const eng = opts.engine || (ed2 && ed2.engine);
  const scale = opts.scale || (map ? W / map.width : 0);
  const stats = { water: 0, shadows: 0, scale };

  ctx.save();
  ctx.imageSmoothingEnabled = true;

  // 1) 地面高光：从左上角斜下来的一层暖光，用 overlay 混色，不冲掉细节
  if (o.light > 0) {
    const lg = ctx.createLinearGradient(0, 0, W * 0.75, H * 0.75);
    lg.addColorStop(0, `rgba(255,244,214,${0.22 * o.light})`);
    lg.addColorStop(0.45, `rgba(255,236,190,${0.08 * o.light})`);
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = prev;
  }

  // 2) 水面：蓝色光泽 + 几条波纹线
  if (o.water > 0 && map && eng) {
    const mask = waterMask(map, eng);
    stats.water = mask.count;
    if (mask.count) {
      const tint = tintedLayer(W, H, mask.cv, 'rgba(70,150,235,1)', (g) => {
        // 左下到右上的蓝色渐变光泽
        const wg = g.createLinearGradient(0, 0, W, H);
        wg.addColorStop(0, 'rgba(120,200,255,1)');
        wg.addColorStop(0.5, 'rgba(60,130,220,1)');
        wg.addColorStop(1, 'rgba(30,80,160,1)');
        g.fillStyle = wg; g.fillRect(0, 0, W, H);
        // 波纹：等距的亮线，靠 hash 决定长短，保证确定性
        const step = Math.max(6, Math.round(scale * 2.2));
        g.strokeStyle = 'rgba(220,245,255,0.85)';
        g.lineWidth = Math.max(1, scale * 0.16);
        for (let y = step; y < H; y += step) {
          const k = ((y / step) | 0);
          const len = 0.12 + ((k * 37) % 17) / 60;
          const x0 = ((k * 53) % 100) / 100 * W;
          g.beginPath();
          g.moveTo(x0, y + Math.sin(k) * 2);
          g.quadraticCurveTo(x0 + W * len * 0.5, y - scale * 0.35, x0 + W * len, y);
          g.stroke();
        }
      });
      const prev = ctx.globalCompositeOperation;
      ctx.globalAlpha = Math.min(1, 0.55 * o.water);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.drawImage(tint, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = prev;
      // 再叠一层很淡的蓝色，让水面真的“亮”起来
      ctx.globalAlpha = Math.min(1, 0.18 * o.water);
      ctx.drawImage(tint, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // 3) 单位投影：单位脚下压一个偏移的暗椭圆
  if (o.shadow > 0 && map && scale > 0.2) {
    const units = [];
    try { if (ed2 && ed2.spawns) units.push(...ed2.spawns()); } catch { /* 没有对象层就算了 */ }
    for (const sp of units) {
      const x = sp.cx * scale, y = sp.cy * scale;
      const rx = Math.max(2, scale * 0.55), ry = Math.max(1.2, scale * 0.3);
      const sg = ctx.createRadialGradient(x + rx * 0.4, y + ry * 0.5, 0, x + rx * 0.4, y + ry * 0.5, rx * 1.6);
      sg.addColorStop(0, `rgba(0,0,0,${0.38 * o.shadow})`);
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.ellipse(x + rx * 0.4, y + ry * 0.5, rx * 1.6, ry * 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      stats.shadows++;
    }
  }

  // 4) 边缘暗角：四角压暗，视线更集中
  if (o.vignette > 0) {
    const r = Math.hypot(W, H) / 2;
    const vg = ctx.createRadialGradient(W / 2, H * 0.45, r * 0.45, W / 2, H * 0.45, r * 1.05);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${0.5 * o.vignette})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // 5) 一层很淡的颗粒，避免大片纯色显得“塑料”
  if (o.grain > 0) {
    const step = Math.max(3, Math.round(W / 240));
    ctx.fillStyle = `rgba(255,255,255,${0.05 * o.grain})`;
    for (let y = 0; y < H; y += step) {
      const k = (y * 2654435761) >>> 0;
      const x = (k % Math.max(1, W)) | 0;
      ctx.fillRect(x, y, step, step);
    }
  }

  ctx.restore();
  return stats;
}

// ---------------- 对话框 ----------------
export function gameLookDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const cur = loadGameLook();
  const pv = h('canvas', { style: 'max-width:100%;display:block;border:1px solid var(--line,#2a2f3a);margin-top:8px' });
  const info = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6' });

  const draw = () => {
    const m = ed.map;
    const z = Math.min(1.5, 520 / Math.max(1, m.width * 20));
    let out;
    try { out = renderFlat(ed, A.rend, { scale: Math.max(0.15, z), grid: false, marks: false }); }
    catch { info.textContent = '这张图暂时渲染不出来（图块集可能没加载完）'; return; }
    pv.width = out.cv.width; pv.height = out.cv.height;
    const g = pv.getContext('2d');
    g.clearRect(0, 0, pv.width, pv.height);
    g.drawImage(out.cv, 0, 0);
    const st = applyGameLook(g, pv, { ...cur });
    info.textContent = `预览 ${pv.width}×${pv.height} 像素（×${out.scale.toFixed(2)}）`
      + (st && st.water ? `，认出水格 ${st.water} 个` : '')
      + (st && st.shadows ? `、单位投影 ${st.shadows} 个` : '')
      + '。这些效果只在导出/预览时叠加，地图数据不变。';
  };
  const redo = () => { clearTimeout(redo.t); redo.t = setTimeout(draw, 30); };

  const add = (label, key) => h('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:4px' },
    slider(label, 0, 100, Math.round(cur[key] * 100), (v) => { cur[key] = v / 100; redo(); }, { step: 5, fmt: (v) => v + '%' }));

  const body = h('div', {},
    h('div', { style: 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap' },
      h('div', { style: 'flex:1;min-width:260px' }, pv, info),
      h('div', { style: 'width:260px' },
        h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:6px' }, '强度（0 = 关掉这一项）'),
        add('地面高光', 'light'), add('水面光泽', 'water'), add('单位投影', 'shadow'),
        add('边缘暗角', 'vignette'), add('画面颗粒', 'grain'),
        h('div', { class: 'row', style: 'gap:8px;margin-top:8px' },
          h('button', {
            onclick: () => {
              Object.assign(cur, DEFAULT_LOOK);
              saveGameLook(cur);
              body.querySelectorAll('input[type=range]').forEach((inp, i) => {
                const k = ['light', 'water', 'shadow', 'vignette', 'grain'][i];
                if (k) inp.value = String(Math.round(DEFAULT_LOOK[k] * 100));
              });
              draw();
            },
          }, '恢复默认'),
          h('button', {
            class: 'primary',
            onclick: () => { saveGameLook(cur); toast('已保存：以后预览/截图会按这套效果叠'); },
          }, '保存效果')))),
    h('div', { style: 'font-size:12px;color:var(--muted);margin-top:10px;line-height:1.6' },
      '这一页只做“叠加”，不改地图里的任何格子。效果存在浏览器本地（rwGameLook），下次打开还生效。'));
  draw();
  return modal('游戏感预览（光影 / 水波 / 暗角）', body, [{ label: '关闭', value: 0 }], { wide: true });
}

Object.assign(HELP, {
  'tool.preview2': {
    t: '游戏感预览（光影 / 水波 / 暗角）',
    s: '按真实图块渲染一张带光照、水面光泽和暗角的成品图，效果像游戏里截的',
    b: '菜单「视图」→「游戏感预览…」。左边是按真实图块渲出来的预览，右边五个滑杆分别控制地面高光、水面光泽、单位投影、边缘暗角和颗粒，'
      + '拖到 0 就是关掉。点「保存效果」会记在本地，之后导出用到这套叠加时自动生效；「恢复默认」回到初始强度。',
    tips: ['纯画布叠加，不会改地图数据，也不会进撤销栈。',
      '水格是按地形引擎认的（水/深水/浅水/湖/沼泽，浅滩不算），识别不出来的地形不会加光泽。',
      '这是给成品图看的，编辑时不用开；要出大图配合「文件」→「截图导出」。'],
  },
});
