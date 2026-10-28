// 共享图层：把地图拆成「地面 / 物品 / 单位」几张透明 PNG 单独导出，
// 也可以把别人给的 PNG 当图层叠回来（画地形时垫着描、或者接别人的地面图）
// 走的是普通图片下载，不依赖 .tmx，方便在群里直接传
import { A } from './state.js';
import { h, modal, toast, toggle, busy } from './ui.js';
import { HELP } from './help.js';
import { saveFile } from './files.js';

const ed = A.ed;
const TW = 20;

// 需要导出哪几层。ground / items 是瓦片层，units 是对象组
export const SHARE_LAYERS = [
  { id: 'ground', cn: '地面（地形）', kind: 'layer', layers: ['ground', 'ground2'] },
  { id: 'items', cn: '物品（资源池/树/碎石）', kind: 'layer', layers: ['items', 'items2', 'overlay'] },
  { id: 'units', cn: '单位与出生点', kind: 'group', groups: ['unitobjects'] },
];

// 只渲染指定瓦片层，得到一张透明 PNG（单位层另外画点）
export function renderLayer(ed2, rend, spec, scale = 1) {
  const m = ed2.map;
  const W = m.width, H = m.height;
  if (spec.kind === 'group') {
    const cv = new OffscreenCanvas(Math.max(1, Math.round(W * TW * scale)), Math.max(1, Math.round(H * TW * scale)));
    const c = cv.getContext('2d');
    const names = new Set(spec.groups);
    for (const G of m.groups) {
      if (!names.has(String(G.name || '').toLowerCase())) continue;
      for (const o of G.objects) {
        const unit = (o.props || []).find((p) => p.name === 'unit');
        if (!unit) continue;
        const team = +(((o.props || []).find((p) => p.name === 'team') || {}).value ?? 0);
        const x = +(o.attrs.x || 0) * scale, y = +(o.attrs.y || 0) * scale;
        const w = Math.max(2, +(o.attrs.width || 20) * scale), hh = Math.max(2, +(o.attrs.height || 20) * scale);
        c.fillStyle = ['#3fa7ff', '#ff5f5f', '#ffd34d', '#8bd450', '#c07bff'][((team % 5) + 5) % 5];
        c.globalAlpha = 0.85;
        c.fillRect(x, y - hh, w, hh);            // TMX 的 y 是下边缘
        c.globalAlpha = 1;
        c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1;
        c.strokeRect(x + .5, y - hh + .5, w - 1, hh - 1);
      }
    }
    return cv;
  }
  const cv = new OffscreenCanvas(Math.max(1, Math.round(W * TW * scale)), Math.max(1, Math.round(H * TW * scale)));
  const c = cv.getContext('2d');
  const names = new Set(spec.layers);
  const Ls = m.layers.filter((L) => names.has(String(L.name || '').toLowerCase()));
  if (!Ls.length) return cv;
  const chunk = 64;   // 与 render.js 的 C 常量一致
  for (let cy = 0; cy * chunk < H; cy++) for (let cx = 0; cx * chunk < W; cx++) {
    const nx = Math.min(chunk, W - cx * chunk), ny = Math.min(chunk, H - cy * chunk);
    const piece = new OffscreenCanvas(nx, ny);
    const pc = piece.getContext('2d');
    const img = pc.createImageData(nx, ny);
    const u32 = new Uint32Array(img.data.buffer);
    const col = rend.colors;
    for (const L of Ls) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (cy * chunk + y) * W + cx * chunk + x;
      const gid = L.data[i]; if (!gid) continue;
      const k = gid * 4;
      // 只保留这一层的图块，其余像素保持透明
      u32[y * nx + x] = (col[k + 3] << 24) | (col[k + 2] << 16) | (col[k + 1] << 8) | col[k];
    }
    pc.putImageData(img, 0, 0);
    c.drawImage(piece, Math.round(cx * chunk * TW * scale), Math.round(cy * chunk * TW * scale),
      Math.round(nx * TW * scale), Math.round(ny * TW * scale));
  }
  return cv;
}

export function shareLayersDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const body = h('div', {});
  const picked = new Set(SHARE_LAYERS.map((s) => s.id));
  const rows = h('div', {});
  const zInp = h('input', { type: 'number', step: '1', min: '1', max: '4', value: '1', style: 'width:64px' });
  const info = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6' });

  for (const spec of SHARE_LAYERS) {
    rows.append(h('label', { style: 'display:flex;gap:8px;align-items:center;padding:5px 2px;font-size:13px' },
      h('input', {
        type: 'checkbox', checked: 'checked',
        onchange: (e) => { if (e.target.checked) picked.add(spec.id); else picked.delete(spec.id); },
      }), spec.cn));
  }

  const refresh = () => {
    info.textContent = `会导出 ${picked.size} 张透明 PNG，尺寸 ${Math.round(ed.map.width * TW * (+zInp.value || 1))}×${Math.round(ed.map.height * TW * (+zInp.value || 1))} 像素。`
      + '这些 PNG 可以直接发到群里，别人拖进来当图层垫着描。';
  };
  zInp.addEventListener('change', refresh);
  refresh();

  const run = async () => {
    const z = Math.max(1, Math.min(4, +zInp.value || 1));
    const list = SHARE_LAYERS.filter((s) => picked.has(s.id));
    if (!list.length) { toast('至少选一层'); return; }
    await busy('正在导出图层…', async () => {
      for (const spec of list) {
        const cv = renderLayer(ed, A.rend, spec, z);
        const blob = await cv.convertToBlob({ type: 'image/png' });
        const nm = `${A.mapName}_${spec.id}.png`;
        const r = await saveFile(nm, new Uint8Array(await blob.arrayBuffer()), 'image/png');
        if (r.ok) toast(`已导出 ${nm}`);
      }
    });
    toast(`导出完成：${list.length} 张`);
  };

  body.append(
    h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:6px' }, '选择要单独导出的层'),
    rows,
    h('div', { class: 'row', style: 'gap:8px;align-items:center;margin-top:8px' },
      h('span', { style: 'font-size:12px' }, '放大倍数'), zInp),
    info,
  );

  return modal('共享图层（把地面/物品/单位拆成透明 PNG）', body, [
    { label: '取消', value: 0 },
    { label: '导出选中的层', value: 1, primary: true, check: run },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.sharelayer': {
    t: '共享图层',
    s: '把地面、物品、单位拆成几张透明 PNG，方便在群里传和垫着描',
    b: '菜单「文件」→「共享图层…」。勾选要导出的层，点「导出选中的层」，每层得到一张透明背景的 PNG。这些图可以直接发群里；别人把它拖进编辑器当「参考图」垫着描，就能在别人的地形上摆单位。',
    tips: ['导出的 PNG 不改地图本身，纯只读操作。', '单位层是用色块画的位置示意，不是游戏原画。'],
  },
});
