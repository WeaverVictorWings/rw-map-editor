// 图层面板：显示/隐藏/锁定各图层，调整叠放顺序
// 注意：隐藏只影响“看得见”，保存时所有图层照样完整写出（这一条不能破）
import { A } from './state.js';
import { h, modal, toast, confirmBox, toggle } from './ui.js';
import { HELP } from './help.js';

const ed = A.ed;

// 中文标签。图层名来自 TMX，可能是 Ground / Items / UnitObjects / Triggers 等
const LAYER_CN = {
  ground: '地面（主地形）',
  ground2: '地面副层',
  items: '物品（资源池、树、碎石）',
  overlay: '覆盖层（装饰）',
  units: '单位',
  unitobjects: '单位',
  triggers: '触发器与区域',
  triggerareas: '触发器区域',
  water: '水面装饰',
  decals: '痕迹',
};

export function layerLabel(name) {
  const k = String(name || '').toLowerCase();
  if (LAYER_CN[k]) return LAYER_CN[k];
  for (const key of Object.keys(LAYER_CN)) if (k.includes(key)) return LAYER_CN[key];
  return name || '（无名）';
}

// 地图里所有能单独开关的东西：瓦片图层 + 对象组
export function layerList(ed2 = ed) {
  const m = ed2.map;
  if (!m) return [];
  const out = [];
  for (const L of m.layers) out.push({ kind: 'layer', ref: L, name: L.name, label: layerLabel(L.name), visible: L.visible !== false, locked: !!L.locked });
  for (const G of m.groups) out.push({ kind: 'group', ref: G, name: G.name, label: layerLabel(G.name), visible: G.visible !== false, locked: !!G.locked });
  return out;
}

// 切换显示。只改内存里的标记，立刻重绘；不记撤销（看地图不该占撤销步）
export function setLayerVisible(item, on) {
  item.ref.visible = !!on;
  A.rend && A.rend.request && A.rend.request();
}

// 锁定：锁住的图层不吃画笔。input.js 在 startAction 里通过 A.layerLocked 询问
export function setLayerLocked(item, on) {
  item.ref.locked = !!on;
  toast(on ? `已锁定「${item.label}」` : `已解锁「${item.label}」`);
}

// 各模式画在哪里：terrain/items/tiles 各自对应一个主图层
const MODE_TARGET = {
  terrain: ['ground', 'ground2'],
  items: ['items', 'items2', 'overlay'],
  tiles: ['items', 'items2', 'overlay'],
};
// 只有这些工具会改数据；平移、取色、框选、滴管不挡
const WRITE_TOOLS = ['brush', 'rect', 'ellipse', 'fill', 'detail', 'height', 'biome', 'road',
  'stamp', 'random', 'erase', 'color', 'line'];

// input.js 每次按下鼠标前问一句：当前模式和工具会不会改到被锁住的层？
export function layerLocked(mode, tool) {
  const m = ed.map;
  if (!m) return false;
  if (!WRITE_TOOLS.includes(tool)) return false;
  const targets = MODE_TARGET[mode];
  if (!targets) return false;
  if (mode === 'terrain') {
    const g = m.layers.find((L) => L === m.ground || String(L.name).toLowerCase() === 'ground');
    return !!(g && g.locked);
  }
  return targets.some((n) => m.layers.some((L) => String(L.name).toLowerCase() === n && L.locked))
    || m.groups.some((G) => String(G.name).toLowerCase() === 'unitobjects' && G.locked && mode === 'units');
}

// 把 hook 挂到 A 上（input.js 读的是 A.layerLocked）
export function installLayerHooks() {
  A.layerLocked = layerLocked;
  A.layerLockedText = '这一层在图层面板里锁住了，先解锁再画';
}

// 全部显示（迷路时一键恢复）
export function showAllLayers() {
  for (const it of layerList()) setLayerVisible(it, true);
  A.rend && A.rend.request && A.rend.request();
}

export function resetLayerState() {
  showAllLayers();
  for (const it of layerList()) it.ref.locked = false;
}

function moveLayer(item, dir) {
  const m = ed.map;
  const arr = item.kind === 'layer' ? m.layers : m.groups;
  const i = arr.indexOf(item.ref);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  A.rend && A.rend.request && A.rend.request();
  return true;
}

export function layersDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (document.querySelector('.modal[data-layers]')) return;
  const body = h('div', {});
  const list = h('div', {});
  const tip = h('div', { style: 'color:var(--muted);font-size:12px;margin-top:8px;line-height:1.6' },
    '隐藏只影响「看得见」，保存时所有图层照样完整写出，不会被删掉。锁住的图层画笔不会改到它。');
  body.append(
    h('div', { style: 'color:var(--muted);font-size:12px;margin-bottom:8px' }, '从上到下的顺序就是显示顺序（越靠下越先画）。'),
    list,
    tip,
    h('div', { class: 'row', style: 'margin-top:10px;gap:8px' },
      h('button', { onclick: () => { showAllLayers(); paint(); toast('已全部显示'); } }, '全部显示'),
      h('button', { onclick: () => { resetLayerState(); paint(); toast('已恢复默认（全部显示、不锁定）'); } }, '恢复默认')),
  );

  const paint = () => {
    list.textContent = '';
    const items = layerList();
    if (!items.length) { list.append(h('div', { style: 'color:var(--muted)' }, '这张图没有图层')); return; }
    for (const it of items) {
      const eye = h('button', {
        title: it.visible ? '点击隐藏' : '点击显示',
        style: 'min-width:56px;padding:4px 8px;font-size:12px',
        onclick: () => { setLayerVisible(it, !it.visible); paint(); },
      }, it.visible ? '👁 显示' : '🚫 隐藏');
      const lock = h('button', {
        title: it.locked ? '点击解锁' : '点击锁定',
        style: 'min-width:56px;padding:4px 8px;font-size:12px',
        onclick: () => { setLayerLocked(it, !it.locked); paint(); },
      }, it.locked ? '🔒 锁住' : '🔓 可改');
      list.append(h('div', {
        class: 'hrow',
        style: `display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--line, #2a2f3a)${it.visible ? '' : ';opacity:.5'}`,
      },
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { style: 'font-size:13px' }, it.label),
        h('div', { style: 'font-size:11px;color:var(--muted)' }, `${it.kind === 'group' ? '对象组' : '瓦片层'} · ${it.name || '无名'}`)),
      eye, lock,
      h('button', { title: '往上移一层', style: 'padding:4px 6px;font-size:12px', onclick: () => { if (moveLayer(it, -1)) paint(); } }, '↑'),
      h('button', { title: '往下移一层', style: 'padding:4px 6px;font-size:12px', onclick: () => { if (moveLayer(it, 1)) paint(); } }, '↓')));
    }
  };
  paint();

  return modal('图层面板（哪些看得见、哪些不许改）', body, [
    { label: '关闭', value: 0, primary: true },
  ], { wide: true, attrs: { 'data-layers': '1' } });
}

Object.assign(HELP, {
  'tool.layers': {
    t: '图层面板',
    s: '分别显示/隐藏地面、物品、单位、触发器，还能锁住不想被画到的层',
    b: '菜单「视图」→「图层面板」。每一行是一个图层：点「显示/隐藏」只改看得见看不见，保存时数据仍然完整；点「锁住」之后画笔和橡皮都改不动它，适合在地面画完之后专门摆单位。上下箭头调整叠放顺序——越靠下越先画，所以单位那层要在地面之上。',
    tips: ['隐藏只是省眼睛，导出和保存的内容不受影响。', '画完地形后把地面锁住，就不会手滑擦到山和水。'],
  },
});
