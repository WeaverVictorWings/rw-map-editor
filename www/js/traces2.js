// 参考图增强：同时铺 N 张参考图，各自透明度 / 可见 / 锁定 / 校准（比例+偏移+旋转）
// 不改 render.js：把多图绘制链到 rend.onDraw 上（先执行原有绘制，再画参考图）
// 单张描图仍用原来的「参考图」（rend.reference），这里是一组独立的参考图层
import { A } from './state.js';
import { h, modal, toast, slider, toggle, confirmBox, closeModal, promptBox } from './ui.js';
import { icon } from './icons.js';
import { kvGet, kvSet } from './util.js';
import { HELP, helpBtn } from './help.js';

const KEY = 'references';
const STYLE_ID = 'rw-traces2-css';
const CSS = `
#stage .rw2-btns{position:absolute;right:10px;top:10px;z-index:5;display:flex;gap:6px}
@media (max-width:760px){#stage .rw2-btns{right:6px;top:auto;bottom:8px}}
.rw2-row{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)}
.rw2-thumb{width:64px;height:40px;border-radius:6px;object-fit:cover;background:var(--bg2);border:1px solid var(--line2);flex:none}
.rw2-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px}
.rw2-grid label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.rw2-grid input{width:84px}
`;

// 读成 dataURL（不引额外依赖）
function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ''));
    fr.onerror = () => rej(fr.error || new Error('读取图片失败'));
    fr.readAsDataURL(file);
  });
}

function injectCss() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.append(st);
}

// ---------------- 存储 ----------------
function normalize(r, i) {
  return {
    id: r.id || `r${i}${Date.now().toString(36)}`,
    name: r.name || `参考图 ${i + 1}`,
    dataURL: r.dataURL || '',
    x: Number(r.x) || 0, y: Number(r.y) || 0,
    w: Number(r.w) || 100, h: Number(r.h) || 100,
    rot: Number(r.rot) || 0,
    opacity: r.opacity == null ? 0.5 : Math.min(1, Math.max(0.05, Number(r.opacity))),
    visible: r.visible !== false,
    locked: !!r.locked,
  };
}

let refCache = null;      // 每帧绘制用，避免每帧读 IndexedDB
export async function listReferences(useCache = false) {
  if (useCache && refCache) return refCache;
  try { refCache = (await kvGet(KEY)) || []; } catch (e) { refCache = []; }
  return refCache;
}

export async function saveReferences(list) {
  const clean = (list || []).map(normalize);
  await kvSet(KEY, clean);
  refCache = clean;
  return clean;
}

// ---------------- 图片位图缓存 ----------------
const bmCache = new Map(); // id -> Promise<ImageBitmap|null>
function bitmapOf(ref) {
  if (!ref.dataURL) return Promise.resolve(null);
  const key = ref.id + ':' + ref.dataURL.length;
  if (bmCache.has(key)) return bmCache.get(key);
  const p = (async () => {
    try {
      const res = await fetch(ref.dataURL);
      return await createImageBitmap(await res.blob());
    } catch (e) { return null; }
  })();
  bmCache.set(key, p);
  return p;
}

function dropCache(id) {
  for (const k of [...bmCache.keys()]) if (k.startsWith(id + ':')) bmCache.delete(k);
}

// ---------------- 画到地图上 ----------------
let hooked = false;
function ensureDrawHook() {
  const rend = A.rend;
  if (!rend || hooked) return;
  hooked = true;
  const prev = rend.onDraw;
  rend.onDraw = () => {
    try { if (prev) prev(); } catch (e) { /* 别人的回调失败不影响参考图 */ }
    try { drawAll(); } catch (e) { /* 参考图绘制失败不拖垮渲染 */ }
  };
}

export async function drawAll() {
  const rend = A.rend;
  if (!rend || !rend.ctx || !A.ed || !A.ed.map) return;
  const list = await listReferences(true);
  const ctx = rend.ctx, z = rend.view.z;
  for (const r of list) {
    if (r.visible === false) continue;
    const bm = await bitmapOf(r);
    if (!bm) continue;
    const p = rend.toScreen(r.x, r.y);
    ctx.save();
    ctx.globalAlpha = r.opacity == null ? 0.5 : r.opacity;
    ctx.translate(p.x, p.y);
    if (r.rot) ctx.rotate((r.rot * Math.PI) / 180);
    ctx.drawImage(bm, 0, 0, r.w * z, r.h * z);
    ctx.restore();
  }
}

// ---------------- 增删改 ----------------
async function fitToMap(imgW, imgH) {
  const m = A.ed && A.ed.map;
  const mapW = m ? m.width * 20 : 160 * 20, mapH = m ? m.height * 20 : 160 * 20;
  const k = Math.min((mapW * 0.9) / Math.max(1, imgW), (mapH * 0.9) / Math.max(1, imgH));
  return { x: (mapW - imgW * k) / 2, y: (mapH - imgH * k) / 2, w: imgW * k, h: imgH * k };
}

export async function addReference(file, opts = {}) {
  if (!file) throw new Error('没有选文件');
  const dataURL = await readAsDataURL(file);
  const bm = await createImageBitmap(file);
  const fit = fitToMap(bm.width, bm.height);
  bm.close();
  const list = await listReferences();
  const ref = normalize({
    name: opts.name || (file.name || '参考图').replace(/\.[^.]+$/, ''),
    dataURL,
    ...fit,
    ...(opts.x != null ? { x: opts.x } : {}),
    ...(opts.y != null ? { y: opts.y } : {}),
    ...(opts.w != null ? { w: opts.w } : {}),
    ...(opts.h != null ? { h: opts.h } : {}),
    ...(opts.opacity != null ? { opacity: opts.opacity } : {}),
  }, list.length);
  list.push(ref);
  await saveReferences(list);
  renderRequest();
  return ref;
}

export async function removeReference(id) {
  const list = await listReferences();
  const it = list.find((r) => r.id === id);
  if (!it) return false;
  await saveReferences(list.filter((r) => r.id !== id));
  dropCache(id);
  renderRequest();
  return true;
}

export async function updateReference(id, patch) {
  const list = await listReferences();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  list[i] = normalize({ ...list[i], ...patch }, i);
  await saveReferences(list);
  renderRequest();
  return list[i];
}

export async function setActiveReference(id) {
  await kvSet('referenceActive', id || '');
  renderRequest();
  return id;
}
export async function activeReference() {
  const id = await kvGet('referenceActive').catch(() => '');
  const list = await listReferences();
  return list.find((r) => r.id === id) || null;
}

function renderRequest() { if (A.rend) A.rend.request(); }

// 校准：两点（相似变换：比例+旋转+平移）或三点最小二乘
export async function calibrateReference(id, mapPoints, imgPoints) {
  if (!Array.isArray(mapPoints) || !Array.isArray(imgPoints) || mapPoints.length !== imgPoints.length || mapPoints.length < 2) {
    throw new Error('至少给两组点：地图点 [x,y] 与参考图点 [u,v]');
  }
  const n = mapPoints.length;
  const mu = imgPoints.reduce((s, p) => s + p[0], 0) / n;
  const mv = imgPoints.reduce((s, p) => s + p[1], 0) / n;
  const mx = mapPoints.reduce((s, p) => s + p[0], 0) / n;
  const my = mapPoints.reduce((s, p) => s + p[1], 0) / n;
  let a = 0, b = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const du = imgPoints[i][0] - mu, dv = imgPoints[i][1] - mv;
    const dx = mapPoints[i][0] - mx, dy = mapPoints[i][1] - my;
    a += du * dx + dv * dy;   // 比例
    b += du * dy - dv * dx;   // 旋转
    den += du * du + dv * dv;
  }
  if (!den) throw new Error('参考图上的点不能重合');
  const sx = a / den, sy = b / den;
  const scale = Math.hypot(sx, sy);
  const rot = (Math.atan2(sy, sx) * 180) / Math.PI;
  const out = { x: mx - (sx * mu - sy * mv), y: my - (sy * mu + sx * mv), w: scale, h: scale, rot };
  const list = await listReferences();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) throw new Error('参考图不在了');
  const it = list[i];
  // 用参考图的原始像素尺寸（现在图片铺满 w×h）换算出缩放
  const bm = await bitmapOf(it);
  const iw = bm ? bm.width : it.w, ih = bm ? bm.height : it.h;
  list[i] = normalize({ ...it, x: out.x, y: out.y, w: iw * out.w, h: ih * out.h, rot: out.rot }, i);
  await saveReferences(list);
  renderRequest();
  return { ...list[i], transform: out };
}

// ---------------- 对话框 ----------------
export async function traces2Dialog() {
  injectCss();
  ensureDrawHook();
  let list = (await listReferences()).map((r) => ({ ...r }));
  await setActiveReference((await activeReference())?.id || list[0]?.id || '');
  const rows = h('div', {});
  const count = h('span', { class: 'hint' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
  fileIn.onchange = async () => {
    const files = [...fileIn.files];
    for (const f of files) await addReference(f);
    fileIn.value = '';
    list = (await listReferences()).map((r) => ({ ...r }));
    await drawAll();
    rebuild();
    toast(`已添加 ${files.length} 张参考图`);
  };

  const calibrate = async (ref) => {
    const bm = await bitmapOf(ref);
    if (!bm) { toast('图片还没加载好'); return; }
    const i1 = h('input', { type: 'number', step: '1', placeholder: 'u', value: '0' }), i2 = h('input', { type: 'number', step: '1', placeholder: 'v', value: '0' });
    const i3 = h('input', { type: 'number', step: '1', placeholder: 'u', value: String(bm.width) }), i4 = h('input', { type: 'number', step: '1', placeholder: 'v', value: String(bm.height) });
    const m1 = h('input', { type: 'number', step: '1', placeholder: 'x', value: String(Math.round(ref.x)) }), m2 = h('input', { type: 'number', step: '1', placeholder: 'y', value: String(Math.round(ref.y)) });
    const m3 = h('input', { type: 'number', step: '1', placeholder: 'x', value: String(Math.round(ref.x + ref.w)) }), m4 = h('input', { type: 'number', step: '1', placeholder: 'y', value: String(Math.round(ref.y)) });
    const body = h('div', {},
      h('p', { class: 'hint', style: 'margin:0 0 6px' }, '把参考图上的两个已知点，对到地图上的两个位置。至少两点；单位都是像素，按图片原始像素填。'),
      h('div', { class: 'rw2-grid' },
        h('span', { class: 'hint' }, '参考图点 1'), h('span', {}), i1, i2,
        h('span', { class: 'hint' }, '地图点 1'), h('span', {}), m1, m2,
        h('span', { class: 'hint' }, '参考图点 2'), h('span', {}), i3, i4,
        h('span', { class: 'hint' }, '地图点 2'), h('span', {}), m3, m4)
    );
    const r = await modal(`校准「${ref.name}」`, body, [
      { label: '取消', value: null }, { label: '应用校准', primary: true, value: 'ok' },
    ], { wide: true });
    if (r !== 'ok') return;
    try {
      const mp = [[+m1.value, +m2.value], [+m3.value, +m4.value]];
      const ip = [[+i1.value, +i2.value], [+i3.value, +i4.value]];
      await calibrateReference(ref.id, mp, ip);
      list = (await listReferences()).map((x) => ({ ...x }));
      await drawAll();
      rebuild();
      toast('已按两组点校准（比例+旋转+偏移）');
    } catch (e) { toast('校准失败：' + (e.message || e)); }
  };

  const rebuild = () => {
    rows.replaceChildren();
    count.textContent = `共 ${list.length} 张`;
    if (!list.length) { rows.append(h('div', { class: 'hint' }, '还没有参考图。可以一次选多张。')); return; }
    for (const r of list) {
      const thumb = h('img', { class: 'rw2-thumb', src: r.dataURL, alt: r.name });
      const op = slider('透明度', 5, 100, Math.round(r.opacity * 100), (v) => { r.opacity = v / 100; updateReference(r.id, { opacity: r.opacity }); }, {});
      rows.append(h('div', { class: 'rw2-row', style: 'flex-wrap:wrap' },
        thumb,
        h('div', { style: 'flex:1;min-width:240px' },
          h('div', { class: 'row', style: 'align-items:center;gap:6px' },
            h('b', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.name),
            h('span', { class: 'hint' }, `${Math.round(r.w)}×${Math.round(r.h)} · ${r.rot || 0}°`),
            h('button', { class: 'ib', title: '校准', onclick: () => calibrate(r) }, '校准'),
            h('button', { class: 'ib', title: '锁定（防手滑拖动）', onclick: () => { r.locked = !r.locked; updateReference(r.id, { locked: r.locked }); rebuild(); } }, r.locked ? '🔒' : '🔓'),
            h('button', { class: 'ib', title: '删除', onclick: async () => {
              if (r.locked) { toast('先解锁再删'); return; }
              if (await confirmBox('删除参考图', `删除「${r.name}」？`, '删除', '取消', true)) {
                await removeReference(r.id); list = (await listReferences()).map((x) => ({ ...x })); rebuild();
              }
            } }, '✕')),
          h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px' }, op,
            toggle('显示', r.visible !== false, (v) => { r.visible = v; updateReference(r.id, { visible: v }); }),
            h('span', { class: 'hint' }, `左上 (${Math.round(r.x)}, ${Math.round(r.y)})`))
        )));
    }
  };

  rebuild();
  const body = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '同时铺多张参考图：每张单独调透明度、显示和锁定，点位对不上时用两点校准。'), helpBtn('tool.traces2')),
    h('div', { class: 'row', style: 'margin:8px 0' },
      h('button', { class: 'primary', onclick: () => fileIn.click() }, '选图片加进来…'), fileIn,
      count,
      h('button', { class: 'ib', onclick: () => { drawAll(); toast('已重绘参考图'); } }, '重绘')),
    rows,
    h('div', { class: 'hint', style: 'margin-top:8px' }, '存在本机 IndexedDB 的 references 键里（图片按 dataURL 存）。参考图只是描图底图，不进 TMX、也不影响玩不玩。')
  );

  await modal('参考图（多张）', body, [{ label: '关闭', primary: true, value: 'ok' }], { wide: true });
  return true;
}

Object.assign(HELP, {
  'tool.traces2': {
    t: '参考图（多张）',
    s: '同时铺 N 张参考图，可校准比例和旋转',
    b: '把设计稿、别人地图的截图、卫星图铺在地图下面描着画。每张图可以单独调透明度、隐藏或锁定。用「校准」把参考图上的两个已知点对到地图的两点，会自动算比例、旋转和偏移。',
    tips: ['参考图存在浏览器里，不进地图文件，导出地图不会带。', '锁定后不会误删，也不会被拖动。'],
  },
});
