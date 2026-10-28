// 粘贴边缘融合：粘上去的地块边缘按羽化半径和原地图渐变过渡，不留一道硬边
// 只新增带融合的版本，原「粘贴」不动（actions.js 里仍然走 input.js 的 paste）
import { A } from './state.js';
import { h, modal, toast, slider } from './ui.js';
import { HELP } from './help.js';
import { pasteClip } from './transform.js';
import { NONE } from './terrain.js';

const ed = A.ed;
const TW = 20;

// 4×4 有序抖动：确定性，不依赖 Math.random，撤销重做结果一致
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

// 把剪贴板裁成“羽化过的”副本：边缘一圈按到边界的距离概率性丢掉
// feather = 0 时等价于原样粘贴；= 3 时边上 3 圈慢慢过渡
export function featherClip(clip, feather = 3, seed = null) {
  const w = clip.w, h = clip.h;
  const fMax = Math.max(0, Math.min(12, Math.floor((Math.min(w, h) - 1) / 2)));
  const f = Math.max(0, Math.min(fMax, Math.round(feather) || 0));
  const mask = clip.mask ? Uint8Array.from(clip.mask) : new Uint8Array(w * h).fill(1);
  let dropped = 0;
  if (f > 0) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (d >= f) continue;
      const p = (d + 0.5) / f;                        // 越靠边越接近 0
      const sx = seed ? seed.x : 0, sy = seed ? seed.y : 0;
      const thr = (BAYER[(y + sy) & 3][(x + sx) & 3] + 0.5) / 16;  // 有序抖动阈值（按粘贴位置错开）
      // 最外一圈一律不贴：这样无论怎么抖，边都不会出现一条直边
      if (d === 0 || p <= thr) { mask[y * w + x] = 0; dropped++; }
    }
  }
  // 地形角点：四个相邻格里一个都没保留的角点也别贴，否则地面会露出硬边
  let V = clip.V;
  if (V && f > 0) {
    V = V.slice();
    for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
      const k = y * (w + 1) + x;
      if (V[k] === NONE) continue;
      const keep = (x > 0 && y > 0 && mask[(y - 1) * w + (x - 1)])
        || (x < w && y > 0 && mask[(y - 1) * w + x])
        || (x > 0 && y < h && mask[y * w + (x - 1)])
        || (x < w && y < h && mask[y * w + x]);
      if (!keep) V[k] = NONE;
    }
  }
  // 对象：中心落在被丢掉的格子里的，别复制过去
  const objects = (clip.objects || []).filter((e) => {
    const cx = Math.floor(e.dx / TW), cy = Math.floor(e.dy / TW);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return true;
    return !!mask[cy * w + cx];
  });
  let kept = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) kept++;
  return { ...clip, mask, V, objects, feather: f, dropped, kept };
}

// 带融合的粘贴：at 可以是 {tx,ty} 或 [tx,ty]（左上角格）
export function pasteWithBlend(ed2 = ed, clip = null, at = null, opts = {}) {
  if (!ed2 || !ed2.map) return { ok: false, reason: 'no-map' };
  const c0 = clip || ed2.clipboard;
  if (!c0) return { ok: false, reason: 'no-clip' };
  if (!at) return { ok: false, reason: 'no-at' };
  const tx = Math.round(Array.isArray(at) ? at[0] : at.tx !== undefined ? at.tx : at.x);
  const ty = Math.round(Array.isArray(at) ? at[1] : at.ty !== undefined ? at.ty : at.y);
  const c = featherClip(c0, opts.feather ?? 3, { x: tx, y: ty });
  if (!c.kept) return { ok: false, reason: 'all-feathered', feather: c.feather };
  ed2.begin(opts.label || '融合粘贴');
  let box = null;
  try {
    box = pasteClip(ed2, c, tx, ty, { skipEmpty: !!opts.skipEmpty, newTeams: opts.newTeams });
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
  return { ok: true, tx, ty, feather: c.feather, kept: c.kept, dropped: c.dropped, objects: c.objects.length, box };
}

// ---------------- 对话框 ----------------
export function pasteBlendDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const clip = ed.clipboard;
  if (!clip) { toast('剪贴板是空的：先框选一块再复制（Ctrl+C）'); return; }
  const cw = clip.w, ch = clip.h;
  let feather = 3;
  const pv = h('canvas', { style: 'max-width:100%;display:block;border:1px solid var(--line,#2a2f3a);margin-top:8px;image-rendering:pixelated' });
  const info = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6' });
  const tip = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6' });

  const draw = () => {
    const c = featherClip(clip, feather);
    const s = Math.max(2, Math.min(16, Math.floor(360 / Math.max(cw, ch))));
    pv.width = cw * s; pv.height = ch * s;
    const g = pv.getContext('2d');
    g.clearRect(0, 0, pv.width, pv.height);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      g.fillStyle = c.mask[y * cw + x] ? 'rgba(110,200,140,0.85)' : 'rgba(229,90,90,0.25)';
      g.fillRect(x * s, y * s, s, s);
    }
    info.textContent = `剪贴板 ${cw}×${ch} 格，羽化 ${c.feather} 圈：保留 ${c.kept} 格、边缘化掉 ${c.dropped} 格`
      + `（${c.objects.length} 个单位随块带走）。`;
    tip.textContent = c.feather === 0 ? '羽化 0 = 硬边，和普通粘贴一样。'
      : `绿格粘上去，红格保留原地图 —— 粘完边上这几圈会自然过渡，不会有一条直边。`;
  };

  const body = h('div', {},
    h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
      h('span', { style: 'font-size:13px' }, '羽化圈数'),
      slider('', 0, 8, 3, (v) => { feather = v; draw(); }, { step: 1, fmt: (v) => v + ' 圈' })),
    pv, info, tip,
    h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6' },
      '点「选位置粘贴」后在地图上点一下左上角，就会按当前羽化把它粘上去；这一步算一步撤销。'));
  draw();

  const doPaste = async () => {
    const bar = h('div', { class: 'floatbar pickbar' }, h('span', { class: 'info' }, '点地图选择粘贴的左上角'), h('button', { onclick: () => done(null) }, '取消'));
    document.getElementById('stage').append(bar);
    const modals = [...document.querySelectorAll('.modal')];
    modals.forEach((m) => { m.style.visibility = 'hidden'; });
    const done = (v) => { bar.remove(); A.pickPoint = null; modals.forEach((m) => { m.style.visibility = ''; }); resolve_(v); };
    let resolve_;
    const p = new Promise((res) => { resolve_ = res; });
    A.pickPoint = (tx, ty) => done({ tx, ty });
    const pt = await p;
    if (!pt) return;
    const r = pasteWithBlend(ed, clip, pt, { feather });
    if (!r.ok) { toast(r.reason === 'all-feathered' ? '羽化太大，整块都被吃掉了' : '粘贴失败'); return; }
    tip.textContent = `已粘到 (${r.tx}, ${r.ty})：保留 ${r.kept} 格、边缘 ${r.dropped} 格。可以接着再点别处粘。`;
    toast(`融合粘贴完成：${r.kept} 格（羽化 ${r.feather} 圈）`);
  };

  return modal('融合粘贴（羽化边缘）', body, [
    { label: '关闭', value: 0 },
    { label: '选位置粘贴', value: 1, primary: true, check: async () => { await doPaste(); return false; } },
  ], { wide: false });
}

Object.assign(HELP, {
  'tool.pasteblend': {
    t: '融合粘贴（羽化边缘）',
    s: '粘贴一块地形时让边缘渐变过渡，不会出现一条直直的接缝',
    b: '先在图上框选、复制（Ctrl+C），再走菜单「编辑」→「融合粘贴…」。对话框里画出了剪贴板的样子：绿格会粘上去，红格保留原地图。'
      + '「羽化圈数」越大边缘越柔（0 = 和普通粘贴一样硬边）。点「选位置粘贴」，在地图上点一下要放的左上角就完成了，一次算一步撤销。',
    tips: ['羽化用有序抖动 + 坐标哈希，结果确定，撤销重做不会变样。',
      '单位也按中心格判断：中心落在边缘化掉的格子里的单位不会跟着复制。',
      '需要精确对位就先用普通粘贴。'],
  },
});
