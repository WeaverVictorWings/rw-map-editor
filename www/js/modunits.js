// Mod 单位库浏览：把当前地图图块集里所有带 unit 属性的图块按图块集分组列出来
// 点一下就把该图块设成“图块”模式的画笔，方便专家用户直接摆 Mod 单位
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { setMode } from './panels.js';
import { helpBtn, HELP } from './help.js';
import { icon } from './icons.js';

const ed = A.ed;

// 收集：遍历所有图块集里显式声明了属性的图块
export function unitTiles(map = ed.map) {
  if (!map) return [];
  const out = [];
  for (const ts of map.tilesets) {
    if (!ts.tiles || !ts.tiles.size) continue;
    for (const [id, info] of ts.tiles) {
      const props = (info && info.props) || {};
      if (!props.unit) continue;
      out.push({ ts, tsName: ts.name, id, gid: ts.firstgid + id, unit: String(props.unit), props });
    }
  }
  return out;
}

// 图标：从图块集大图里裁出这一格（2 倍超采样，小图更清楚）
export function unitIcon(ts, id, size = 30) {
  if (!ts || !ts.image) return null;
  try {
    const scale = 2;
    const c = document.createElement('canvas');
    c.width = size * scale; c.height = size * scale;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    const col = ts.columns || Math.floor(ts.imgW / ts.tw) || 1;
    const sx = (id % col) * ts.tw, sy = Math.floor(id / col) * ts.th;
    x.drawImage(ts.image, sx, sy, ts.tw, ts.th, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } catch (e) { return null; }
}

// 点一下就用这个图块：和“图块”面板里点图块是同一套状态
export function useUnitTile(item) {
  if (!item || !ed.map) return false;
  ed.rawTs = item.ts;
  ed.rawGid = item.gid;
  ed.tool.tiles = 'brush';
  setMode('tiles');
  A.refresh('toolbar', 'dock', 'modes');
  A.rend.request();
  toast(`已把「${item.unit}」设为图块画笔（${item.tsName} #${item.id}）`, 2600);
  return true;
}

const propText = (props) => {
  const parts = [];
  for (const [k, v] of Object.entries(props)) {
    if (k === 'unit') continue;
    parts.push(`${k}=${v}`);
    if (parts.length >= 8) break;
  }
  return parts.join(' · ');
};

// ---------------- 对话框 ----------------
export function modUnitsDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const all = unitTiles();
  const groups = new Map();
  for (const it of all) {
    if (!groups.has(it.tsName)) groups.set(it.tsName, []);
    groups.get(it.tsName).push(it);
  }
  const units = [...new Set(all.map((x) => x.unit))];
  const listEl = h('div', {});
  const countEl = h('div', { class: 'hint' });
  const filterI = h('input', { placeholder: '按单位名或属性过滤，例如 tank、health', style: 'width:100%' });

  const row = (it) => {
    const img = unitIcon(it.ts, it.id, 30);
    const b = h('button', {
      class: 'acard', style: 'align-items:center;gap:10px;padding:8px 10px',
      title: '设为当前图块画笔',
      onclick: () => useUnitTile(it),
    },
    img ? h('img', { src: img, width: 30, height: 30, alt: it.unit, style: 'image-rendering:pixelated;flex:none;border-radius:4px;background:#1a1d24' })
      : h('span', { style: 'flex:none;width:30px;height:30px;border-radius:4px;background:#2a2f3a' }),
    h('div', { style: 'flex:1;min-width:0' },
      h('b', {}, it.unit),
      h('small', {}, ` ${it.tsName} #${it.id}（gid ${it.gid}）${(it.props.frame != null) ? ' · 帧 ' + it.props.frame : ''}`)),
    h('small', { class: 'hint', style: 'flex:none;max-width:46%;text-align:right' }, propText(it.props) || '—'));
    return b;
  };

  const draw = () => {
    listEl.innerHTML = '';
    const q = filterI.value.trim().toLowerCase();
    let shown = 0;
    for (const [name, arr] of groups) {
      const hit = arr.filter((it) => !q || it.unit.toLowerCase().includes(q) || propText(it.props).toLowerCase().includes(q) || name.toLowerCase().includes(q));
      if (!hit.length) continue;
      shown += hit.length;
      listEl.append(h('div', { style: 'margin-top:10px' }, h('b', {}, `${name}（${hit.length} 个）`)));
      for (const it of hit) listEl.append(row(it));
    }
    if (!shown) {
      listEl.append(h('div', { class: 'hint', style: 'margin-top:10px' }, q ? '没有匹配的单位，换个关键词。' : '这张地图的图块集里没有带 unit 属性的图块。'));
    }
    countEl.textContent = `共 ${all.length} 个带 unit 属性的图块，${units.length} 种单位，分布在 ${groups.size} 个图块集里`;
  };
  filterI.addEventListener('input', draw);
  draw();

  const body = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '从这张地图的图块集里读出来的单位图块。点一行就把它设成当前画笔，切到“图块”模式直接画。'), helpBtn('tool.modunits')),
    filterI,
    countEl,
    listEl,
    groups.size ? null : h('div', { class: 'hint' }, 'Mod 单位要先做成图块集（.tsx + .png，图块上带 unit 属性）再加进地图；“Mod 支持”对话框可以导入 .rwmod。'),
  );
  return modal('Mod 单位库', body, [{ label: '关闭', value: 1 }], { wide: true });
}

Object.assign(HELP, {
  'tool.modunits': {
    t: 'Mod 单位库',
    s: '浏览地图图块集里带 unit 属性的图块',
    b: '把当前地图所有图块集里声明了 unit 的图块按图块集分组列出来，显示图标、单位名和已知属性。点一行就设成图块画笔，直接往地图上放。',
    tips: ['只列当前地图已经加载的图块集；Mod 本身要先导入（「Mod 支持」）。', '图块上没写 unit 属性的图块不会出现在这里。'],
  },
});
