// 图层对比（2.5）：打开另一张 .tmx，和当前地图逐格、逐对象比较差在哪
// 只读：只读当前地图的图层数据，不调用任何改地图的 API。
// 注意：tmx.js 序列化只重编 dirty 图层，未 dirty 的图层沿用原始压缩字节，
// 所以这里只比解压后的 L.data（以及对象组），绝不比序列化字符串。
import { A } from './state.js';
import { RWMap } from './tmx.js';
import { h, modal, toast, closeModal } from './ui.js';
import { HELP } from './help.js';

let openFlag = false;
const MAX_CELLS = 200000; // 差异格列表上限，防止大地图整张不同时爆内存

const wrapMap = (x) => (x && x.map ? x.map : x);

// 从 #rrggbb 生成 render.setTint 用的 uint32（RGBA 小端：A<<24|B<<16|G<<8|R）
function rgba(css, a = 255) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = css;
  const s = c.fillStyle; // 统一成 #rrggbb
  const n = parseInt(s.slice(1), 16);
  return ((a << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0;
}

function objSignature(o) {
  const attrs = Object.keys(o.attrs || {}).sort().map((k) => [k, o.attrs[k]]);
  const props = (o.props || []).map((p) => [p.name, p.value, p.type || '']).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([attrs, props]);
}
function objKey(o) {
  const a = o.attrs || {};
  if (a.id !== undefined && a.id !== '') return 'id:' + a.id;
  return ['name', 'x', 'y', 'width', 'height', 'gid'].map((k) => (a[k] === undefined ? '' : a[k])).join('|');
}

// 对比两张地图。a / b 可以是 editor（有 .map）或 RWMap。
// 返回：{ ok, size, layers[], groupsChanged[], added, removed, changed, addedCells, removedCells, objects, truncated }
export function compareMaps(a, b) {
  const mA = wrapMap(a), mB = wrapMap(b);
  if (!mA || !mB) return { ok: false, why: '需要两张地图' };
  const w = Math.min(mA.width, mB.width), h = Math.min(mA.height, mB.height);
  const layersA = new Map(mA.layers.map((l) => [String(l.name).toLowerCase(), l]));
  const layersB = new Map(mB.layers.map((l) => [String(l.name).toLowerCase(), l]));
  const order = [...mA.layers.map((l) => String(l.name).toLowerCase())];
  for (const l of mB.layers) { const k = String(l.name).toLowerCase(); if (!order.includes(k)) order.push(k); }

  const layers = [];
  const addedCells = [], removedCells = [], changedCells = [];
  let added = 0, removed = 0, changed = 0, truncated = false;

  for (const key of order) {
    const LA = layersA.get(key), LB = layersB.get(key);
    const out = {
      name: LA ? LA.name : LB.name,
      onlyA: !LB,
      onlyB: !LA,
      added: 0, removed: 0, changed: 0,
      changedCells: [],
      truncated: false,
    };
    if (LA && LB) {
      const lw = Math.min(LA.w || mA.width, LB.w || mB.width);
      const lh = Math.min(LA.h || mA.height, LB.h || mB.height);
      const cells = [];
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const va = (LA.data[y * (LA.w || mA.width) + x] | 0);
          const vb = (LB.data[y * (LB.w || mB.width) + x] | 0);
          if (va === vb) continue;
          if (va === 0) { out.added++; added++; if (addedCells.length < MAX_CELLS) addedCells.push([x, y, vb]); else truncated = true; }
          else if (vb === 0) { out.removed++; removed++; if (removedCells.length < MAX_CELLS) removedCells.push([x, y, va]); else truncated = true; }
          else {
            out.changed++; changed++;
            if (cells.length < MAX_CELLS) cells.push([x, y, va, vb]); else out.truncated = true;
          }
        }
      }
      out.changedCells = cells;
      for (const c of cells) { if (changedCells.length < MAX_CELLS) changedCells.push(c); else truncated = true; }
    } else if (LA) {
      // 只在当前地图里有：整层算“本图有、对方没有”
      for (let y = 0; y < (LA.h || mA.height); y++) {
        for (let x = 0; x < (LA.w || mA.width); x++) {
          const v = LA.data[y * (LA.w || mA.width) + x] | 0;
          if (!v) continue;
          out.removed++; removed++;
          if (removedCells.length < MAX_CELLS) removedCells.push([x, y, v]); else truncated = true;
        }
      }
    } else {
      for (let y = 0; y < (LB.h || mB.height); y++) {
        for (let x = 0; x < (LB.w || mB.width); x++) {
          const v = LB.data[y * (LB.w || mB.width) + x] | 0;
          if (!v) continue;
          out.added++; added++;
          if (addedCells.length < MAX_CELLS) addedCells.push([x, y, v]); else truncated = true;
        }
      }
    }
    if (out.added || out.removed || out.changed || out.onlyA || out.onlyB) layers.push(out);
  }

  // 对象组：按组名配对，对象按 id（没有 id 时按 name|x|y|gid）配对
  const gA = new Map(mA.groups.map((g) => [String(g.name).toLowerCase(), g]));
  const gB = new Map(mB.groups.map((g) => [String(g.name).toLowerCase(), g]));
  const gOrder = mA.groups.map((g) => String(g.name).toLowerCase());
  for (const g of mB.groups) { const k = String(g.name).toLowerCase(); if (!gOrder.includes(k)) gOrder.push(k); }
  const groupsChanged = [];
  let objAdded = 0, objRemoved = 0, objChanged = 0;
  for (const key of gOrder) {
    const GA = gA.get(key), GB = gB.get(key);
    const o = { name: GA ? GA.name : GB.name, onlyA: !GB, onlyB: !GA, added: 0, removed: 0, changed: 0, changedKeys: [] };
    if (GA && GB) {
      const mapA = new Map(GA.objects.map((x) => [objKey(x), objSignature(x)]));
      const mapB = new Map(GB.objects.map((x) => [objKey(x), objSignature(x)]));
      for (const [k, sigB] of mapB) {
        if (!mapA.has(k)) { o.added++; objAdded++; }
        else if (mapA.get(k) !== sigB) { o.changed++; objChanged++; if (o.changedKeys.length < 500) o.changedKeys.push(k); }
      }
      for (const k of mapA.keys()) if (!mapB.has(k)) { o.removed++; objRemoved++; }
    } else if (GA) { o.removed = GA.objects.length; objRemoved += o.removed; }
    else { o.added = GB.objects.length; objAdded += o.added; }
    if (o.added || o.removed || o.changed || o.onlyA || o.onlyB) groupsChanged.push(o);
  }

  return {
    ok: true,
    size: { a: [mA.width, mA.height], b: [mB.width, mB.height], same: mA.width === mB.width && mA.height === mB.height },
    layers,
    groupsChanged,
    added, removed, // 计数
    changed: changedCells, // [[x,y,oldGid,newGid]]（按约定）
    changedCount: changed,
    addedCells, removedCells,
    objects: { added: objAdded, removed: objRemoved, changed: objChanged },
    truncated,
  };
}

// ---------------- 界面 ----------------
function statsBody(cmp, fileName) {
  const rows = [];
  const line = (label, a, b, c) => h('div', { class: 'row', style: 'gap:12px;width:100%;font-variant-numeric:tabular-nums' },
    h('span', { style: 'flex:1;min-width:120px' }, label),
    h('span', { style: 'flex:none;width:86px;text-align:right' }, String(a)),
    h('span', { style: 'flex:none;width:86px;text-align:right' }, String(b)),
    h('span', { style: 'flex:none;width:86px;text-align:right' }, String(c)));
  const head = () => h('div', { class: 'row', style: 'gap:12px;width:100%;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:2px' },
    h('span', { style: 'flex:1;min-width:120px' }, ''),
    h('span', { style: 'flex:none;width:86px;text-align:right' }, '新增'),
    h('span', { style: 'flex:none;width:86px;text-align:right' }, '消失'),
    h('span', { style: 'flex:none;width:86px;text-align:right' }, '改动'));
  for (const l of cmp.layers) {
    rows.push(line(`${l.name}${l.onlyA ? '（只有本图有）' : l.onlyB ? '（只有对方有）' : ''}`, l.added, l.removed, l.changed));
  }
  if (!cmp.layers.length) rows.push(h('div', { class: 'hint' }, '所有图层逐格一致。'));
  const gr = [];
  for (const g of cmp.groupsChanged) {
    gr.push(line(`${g.name}${g.onlyA ? '（只有本图有）' : g.onlyB ? '（只有对方有）' : ''}`, g.added, g.removed, g.changed));
  }
  return h('div', {},
    h('div', { class: 'hint', style: 'margin-bottom:6px' },
      `「当前地图」↔「${fileName || '对方文件'}」：${cmp.size.a[0]}×${cmp.size.a[1]} 对 ${cmp.size.b[0]}×${cmp.size.b[1]}`,
      cmp.size.same ? '' : h('b', { style: 'color:#e5484d' }, '（尺寸不同，只比左上角重叠区域）'),
      cmp.truncated ? h('b', { style: 'color:#e5484d' }, '（差异太多，只保留前 20 万个坐标）') : null),
    h('div', { style: 'font-weight:600;margin:8px 0 4px' }, '图层（逐格）'),
    head(),
    ...rows,
    h('div', { style: 'font-weight:600;margin:10px 0 4px' }, '对象组'),
    gr.length ? h('div', {}, head(), ...gr) : h('div', { class: 'hint' }, '对象组一致。'),
    h('div', { class: 'hint', style: 'margin-top:8px' },
      `合计：${cmp.added + cmp.removed + cmp.changedCount} 格不同（对方新增 ${cmp.added} / 本图独有 ${cmp.removed} / 两边不同 ${cmp.changedCount}），对象增删改 ${cmp.objects.added}/${cmp.objects.removed}/${cmp.objects.changed}。`));
}

export async function layerCmpDialog() {
  const ed = A.ed, rend = A.rend;
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (openFlag) return;
  openFlag = true;
  const prevTint = rend.tint || null;
  let cmp = null;
  let fileName = '';

  const fileInp = h('input', { type: 'file', accept: '.tmx,text/xml', style: 'display:none' });
  const pickBtn = h('button', { class: 'primary', onclick: () => fileInp.click() }, '选择另一张 .tmx 文件…');
  const statusEl = h('div', { class: 'hint' }, '选另一张 .tmx 打开，只读对比，不会改当前地图。');
  const outEl = h('div', { style: 'margin-top:8px' });
  const highlightBtn = h('button', { class: 'primary', disabled: true, onclick: () => highlight() }, '在地图上高亮差异');
  const clearBtn = h('button', { disabled: true, onclick: () => { rend.setTint(prevTint); clearBtn.disabled = true; toast('已清除高亮'); } }, '清除高亮');

  function highlight() {
    if (!cmp) return;
    const W = ed.map.width, H = ed.map.height;
    const cols = new Uint32Array(W * H);
    const cAdd = rgba('#36c25b', 190), cRem = rgba('#e5484d', 190), cChg = rgba('#f5c518', 200);
    for (const [x, y] of cmp.addedCells) if (x < W && y < H) cols[y * W + x] = cAdd;
    for (const [x, y] of cmp.removedCells) if (x < W && y < H) cols[y * W + x] = cRem;
    for (const [x, y] of cmp.changed) if (x < W && y < H) cols[y * W + x] = cChg;
    rend.setTint({ kind: 'layercmp', fn: (i) => cols[i] || 0, opacity: 1 });
    clearBtn.disabled = false;
    A.refresh('dock');
    toast('绿 = 对方新增，红 = 本图独有，黄 = 两边不同');
  }

  fileInp.addEventListener('change', async () => {
    const f = fileInp.files && fileInp.files[0];
    if (!f) return;
    fileName = f.name;
    statusEl.textContent = `正在读取 ${f.name} …`;
    try {
      const text = await f.text();
      const bm = await RWMap.parse(text, f.name);
      cmp = compareMaps(ed, bm);
      outEl.innerHTML = '';
      outEl.append(statsBody(cmp, f.name));
      statusEl.textContent = `已读取 ${f.name}（${(text.length / 1024).toFixed(1)} KB）`;
      highlightBtn.disabled = false;
      clearBtn.disabled = true;
      if (cmp.added + cmp.removed + cmp.changedCount === 0 && !cmp.objects.added && !cmp.objects.removed && !cmp.objects.changed && cmp.size.same) {
        statusEl.textContent += '；两张地图完全一样';
      }
    } catch (e) {
      console.error(e);
      cmp = null;
      statusEl.textContent = `打不开 ${f.name}：` + (e && e.message || e);
      highlightBtn.disabled = true;
      toast('这个文件不是有效的地图');
    }
  });

  const body = h('div', {},
    h('div', { class: 'card' },
      h('div', { style: 'font-weight:600;margin-bottom:8px' }, '选另一张地图'),
      h('div', { class: 'row', style: 'align-items:center;gap:8px;flex-wrap:wrap' }, fileInp, pickBtn, highlightBtn, clearBtn),
      statusEl),
    h('div', { class: 'card', style: 'margin-top:10px' }, outEl),
    h('div', { class: 'hint', style: 'margin-top:8px' },
      '只读对比：不改当前地图。高亮画在编辑器叠加层上，关窗后自动恢复原来的叠加图。'));

  // 地图换了就让对话框自己关掉（避免拿旧图的数据对比）
  const onMap = (ev) => { if (ev === 'map') closeModal(); };
  ed.on(onMap);
  try {
    await modal('图层对比', body, [{ label: '关闭', value: 1, primary: true }], { wide: true });
  } finally {
    openFlag = false;
    ed.listeners.delete(onMap);
    rend.setTint(prevTint);
    A.refresh('dock');
  }
}

Object.assign(HELP, {
  'tool.layercmp': {
    t: '图层对比',
    s: '选另一张 .tmx，逐格看两张图差在哪',
    b: '菜单「地图」→「图层对比」。选另一张 .tmx 文件，编辑器会把两张图的每个图层逐格比较，列出：对方新增、本图独有、两边不同的格子数；对象组（单位、触发器）也会列出增删改数量。点「在地图上高亮差异」，差异格会叠在地图上：绿 = 对方新增，红 = 本图独有，黄 = 两边不同。全过程只读，不会改当前地图；关窗后自动恢复原来的叠加图。',
    tips: [
      '两张图尺寸不同时只比较左上角重叠的部分，对话框会标出来。',
      '比较的是解压后的图层数据，和保存时是否压缩过无关。',
      '适合合图、找回改丢的细节、检查对称图两边是否真的一样。',
    ],
  },
});
