// 工程文件（.rwproj）：把地图、编辑器设置、参考图、印章库和当前选区打成一个文件
// 换一台设备导入后，能继续按原来的方式编辑同一张图
import { A } from './state.js';
import { h, modal, busy, toast } from './ui.js';
import { readZip, writeZip } from './zip.js';
import { exportPrefs, importPrefs } from './importexport.js';
import { RWMap } from './tmx.js';
import { loadMapFromText, serializeOnce } from './io.js';
import { saveFile } from './files.js';
import { kvGet, kvSet, bytesToB64, b64ToBytes, clamp } from './util.js';
import { helpBtn, HELP } from './help.js';
import { icon } from './icons.js';

const ed = A.ed, rend = A.rend;
const FORMAT = 'rwproj';
const VERSION = 1;

const cleanName = (s) => String(s || '工程').replace(/[\\/:*?"<>|]/g, '_');

// 参考图取 RGBA：不重新编码 PNG，往返后像素字节完全一致
async function refRGBA(ref) {
  const w = ref.img.width, hh = ref.img.height;
  const cv = new OffscreenCanvas(w, hh);
  const c = cv.getContext('2d');
  c.drawImage(ref.img, 0, 0);
  return { w, h: hh, bytes: new Uint8Array(c.getImageData(0, 0, w, hh).data.buffer) };
}
function refImage(meta, bytes) {
  const data = new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength), meta.w, meta.h);
  const cv = new OffscreenCanvas(meta.w, meta.h);
  cv.getContext('2d').putImageData(data, 0, 0);
  return createImageBitmap(cv);
}
function selToJSON(sel) {
  if (!sel) return null;
  const mask = sel.mask ? bytesToB64(sel.mask instanceof Uint8Array ? sel.mask : new Uint8Array(sel.mask)) : null;
  return { x0: sel.x0, y0: sel.y0, x1: sel.x1, y1: sel.y1, mask };
}
function selFromJSON(s) {
  if (!s) return null;
  return { x0: +s.x0 | 0, y0: +s.y0 | 0, x1: +s.x1 | 0, y1: +s.y1 | 0, mask: s.mask ? b64ToBytes(s.mask) : null };
}

// ---------------- 导出 ----------------
export async function saveProject(opts = {}) {
  if (!ed.map) throw new Error('先打开一张地图再保存工程');
  const t0 = performance.now();
  const stamps = (await kvGet('stamps')) || [];
  let reference = null, refBytes = null;
  const ref = rend.reference;
  if (ref && ref.img) {
    const rg = await refRGBA(ref);
    refBytes = rg.bytes;
    reference = {
      w: rg.w, h: rg.h,
      opacity: ref.opacity == null ? 0.5 : ref.opacity,
      x: ref.x || 0, y: ref.y || 0,
      visible: ref.visible !== false,
      base: ref.base || 1,
    };
  }
  const json = {
    format: FORMAT,
    version: VERSION,
    app: 'rw-map-editor',
    created: Date.now(),
    name: A.mapName || '未命名地图',
    map: { w: ed.map.width, h: ed.map.height },
    settings: { ...A.settings },
    // 界面偏好和素材库：换设备最想带走的其实是这些（印章、细节预设、快捷栏、游戏路径）
    prefs: await exportPrefs(),
    selection: selToJSON(ed.selection),
    reference,
    stamps,
  };
  const files = [
    { name: 'project.json', data: JSON.stringify(json, null, 1) },
    { name: 'map.tmx', data: await serializeOnce() },
  ];
  if (refBytes) files.push({ name: 'reference.rgba', data: refBytes });
  const bytes = writeZip(files);
  return {
    bytes, json, ms: Math.round(performance.now() - t0),
    stats: {
      name: json.name, w: json.map.w, h: json.map.h,
      settings: Object.keys(json.settings).length,
      stamps: stamps.length, selection: !!json.selection,
      refW: reference ? reference.w : 0, refH: reference ? reference.h : 0,
      refBytes: refBytes ? refBytes.length : 0,
      size: bytes.length,
    },
  };
}

// ---------------- 读取 ----------------
async function toBytes(src) {
  if (!src) throw new Error('没有选择工程文件');
  if (src instanceof Blob) return new Uint8Array(await src.arrayBuffer());
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (src instanceof Uint8Array) return src;
  if (typeof src === 'string') {
    const s = src.trim();
    if (s.startsWith('{')) throw new Error('这是工程说明（project.json），不是完整工程包：请选择导出的 .rwproj 文件');
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  }
  throw new Error('不支持的工程数据格式');
}

// 导入：先全部校验，再动当前地图；中途失败会回滚到导入前
export async function loadProject(src) {
  const t0 = performance.now();
  const bytes = await toBytes(src);
  let entries;
  try { entries = readZip(bytes); } catch (e) { throw new Error('打不开工程文件：' + (e.message || e)); }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const pj = byName.get('project.json'), mt = byName.get('map.tmx');
  if (!pj) throw new Error('工程文件里缺少 project.json');
  if (!mt) throw new Error('工程文件里缺少 map.tmx（地图本体）');
  let json;
  try { json = JSON.parse(await pj.text()); } catch (e) { throw new Error('project.json 坏了：' + (e.message || e)); }
  if (json.format !== FORMAT) throw new Error('这个文件不是 .rwproj 工程（格式标记不对）');
  if ((json.version | 0) > VERSION) throw new Error(`工程版本 ${json.version} 比当前编辑器新，请先更新编辑器`);
  const mapText = await mt.text();
  let parsed;
  try { parsed = await RWMap.parse(mapText, '工程地图'); } catch (e) { throw new Error('工程里的地图损坏：' + (e.message || e)); }
  if (!parsed || !parsed.width) throw new Error('工程里的地图是空的');
  if (json.reference) {
    const re = byName.get('reference.rgba');
    if (!re) throw new Error('工程声明了参考图，但包里没有 reference.rgba');
    const rb = await re.bytes();
    const need = (json.reference.w | 0) * (json.reference.h | 0) * 4;
    if (rb.length !== need) throw new Error(`参考图数据不完整（${rb.length} 字节，应该是 ${need}）`);
    json.reference.__bytes = rb;
  }

  const hadMap = !!ed.map;
  const prevName = A.mapName;
  const prevText = hadMap ? await serializeOnce() : null;
  const prevSettings = { ...A.settings };
  const prevStamps = (await kvGet('stamps')) || [];
  const prevRef = rend.reference;
  const prevSel = ed.selection;

  try {
    await loadMapFromText(mapText, cleanName(json.name));
    A.mapName = cleanName(json.name || '导入工程');
    if (json.prefs) { try { await importPrefs(json.prefs); } catch (e) { console.warn('恢复偏好失败', e); } }
    if (json.settings && typeof json.settings === 'object') {
      Object.assign(A.settings, json.settings);
      A.settings.autosaveSec = clamp(+A.settings.autosaveSec || 30, 5, 600);
      await kvSet('settings', A.settings);
      rend.showGrid = !!A.settings.grid;
      rend.dimOthers = !!A.settings.dim;
      ed.poolStyle = A.settings.poolStyle || '1x1';
    }
    if (Array.isArray(json.stamps) && json.stamps.length) {
      const cur = (await kvGet('stamps')) || [];
      const ids = new Set(cur.map((s) => s.id));
      const add = json.stamps.filter((s) => s && s.id && !ids.has(s.id));
      if (add.length) await kvSet('stamps', add.concat(cur).slice(0, 60));
    }
    if (json.reference) {
      const meta = json.reference;
      const img = await refImage(meta, meta.__bytes);
      A.hooks.setReference && A.hooks.setReference({
        img, opacity: meta.opacity, x: meta.x, y: meta.y,
        w: meta.w || img.width, h: meta.h || img.height,
        visible: meta.visible !== false, base: meta.base || 1,
      });
    } else if (A.hooks.setReference) A.hooks.setReference(null);
    ed.selection = selFromJSON(json.selection);
    ed.dirty = true; A.autoDirty = true;
    rend.setMap(ed.map);
    rend.buildColors && rend.buildColors();
    rend.invalidateAll();
    A.mini.rebuild();
    A.refresh();
    const out = {
      ok: true, name: A.mapName, w: ed.map.width, h: ed.map.height,
      settings: Object.keys(json.settings || {}).length,
      stamps: (json.stamps || []).length,
      reference: !!json.reference, refBytes: json.reference ? json.reference.__bytes.length : 0,
      selection: !!json.selection,
      ms: Math.round(performance.now() - t0),
    };
    if (typeof window !== 'undefined') window.__rwProjectLast = out;
    return out;
  } catch (e) {
    // 失败不留半成品：地图、设置、印章、参考图、选区全部还原
    try {
      if (hadMap && prevText) await loadMapFromText(prevText, prevName);
      Object.assign(A.settings, prevSettings);
      await kvSet('settings', prevSettings);
      await kvSet('stamps', prevStamps);
      if (A.hooks.setReference) A.hooks.setReference(prevRef || null);
      ed.selection = prevSel;
      if (ed.map) { rend.setMap(ed.map); rend.invalidateAll(); A.mini.rebuild(); }
      A.refresh();
    } catch (e2) { console.warn('工程回滚失败', e2); }
    throw new Error('导入工程失败：' + (e.message || e) + (hadMap ? '（已恢复导入前的地图）' : ''));
  }
}

// ---------------- 对话框 ----------------
export async function projectDialog() {
  if (!ed.map) { toast('先打开一张地图再存工程'); return; }
  const info = h('div', { class: 'hint' });
  let closeBox = () => {};
  const inp = h('input', { type: 'file', accept: '.rwproj,application/zip', style: 'display:none' });
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    try {
      const r = await busy('正在导入工程…', () => loadProject(f));
      toast(`已导入工程「${r.name}」：${r.w}×${r.h} 格，${r.settings} 项设置，${r.stamps} 个印章${r.reference ? '，参考图已恢复' : ''}`, 4200);
      closeBox();
    } catch (e) { toast(e.message || String(e), 6000); }
  };
  const drawInfo = () => {
    const sp = ed.spawns();
    const teams = new Set(sp.map((s) => s.team)).size;
    const ref = rend.reference;
    info.innerHTML = '';
    info.append(
      h('div', {}, `地图：${A.mapName || '未命名'}（${ed.map.width}×${ed.map.height} 格，${teams} 队）`),
      h('div', {}, `设置：${Object.keys(A.settings).length} 项（网格、叠加、自动保存、封面尺寸…）`),
      h('div', {}, `印章：本机共 ${'? '} 个（导入时按 id 去重合并）`),
      h('div', {}, `参考图：${ref && ref.img ? `${ref.img.width}×${ref.img.height}，会把像素原样打进工程` : '没有'}`),
      h('div', {}, `当前选区：${ed.selection ? `${ed.selection.x1 - ed.selection.x0 + 1}×${ed.selection.y1 - ed.selection.y0 + 1} 格` : '没有'}`),
    );
  };
  drawInfo();
  (async () => {
    const n = ((await kvGet('stamps')) || []).length;
    const line = info.children[2];
    if (line) line.textContent = `印章：本机共 ${n} 个（导入时按 id 去重合并）`;
  })();

  const box = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '把地图、设置、参考图、印章库和当前选区打成一个 .rwproj，换设备能接着编辑。'), helpBtn('tool.project')),
    h('div', { class: 'card', style: 'margin-top:8px' }, info),
    h('div', { class: 'row', style: 'margin-top:10px;gap:8px' },
      h('button', { class: 'primary', html: icon('save') + ' 导出 .rwproj', onclick: async () => {
        try {
          const p = await busy('正在打包工程…', () => saveProject());
          const r = await saveFile(cleanName(A.mapName) + '.rwproj', p.bytes, 'application/zip');
          if (r.ok) toast(`工程已导出（${fmtKB(p.stats.size)}）${r.where ? '：' + r.where : ''}`, 3600);
        } catch (e) { toast(e.message || String(e), 5000); }
      } }),
      h('button', { html: icon('import') + ' 导入 .rwproj', onclick: () => inp.click() })),
    h('div', { class: 'hint', style: 'margin-top:8px' }, '导入会替换当前地图，并恢复包里的设置、参考图和选区；导入失败会自动回到导入前。'),
    inp);
  closeBox = () => closeModal();
  await modal('工程文件', box, [{ label: '关闭', value: 1 }], { wide: true });
}

function fmtKB(n) {
  return n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(0) + ' KB' : (n / 1024 / 1024).toFixed(2) + ' MB';
}

Object.assign(HELP, {
  'tool.project': {
    t: '工程文件',
    s: '把地图、设置、参考图、印章和选区打包带走',
    b: '导出 .rwproj 后，换一台电脑或手机导入，就能按原来的设置继续编辑同一张图。导入会替换当前地图，失败会自动回到导入前。',
    tips: ['工程里不包含游戏本体，只包含编辑器用到的数据。', '分享给别人时，如果只是要地图，用「保存」导出 .tmx 更通用。'],
  },
});
