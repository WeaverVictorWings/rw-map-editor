// 地图依赖检查：这张图用了什么图块/单位，缺什么
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast } from './ui.js';
import { kvGet } from './util.js';

Object.assign(HELP, {
  'tool.assetcheck': { t: '地图依赖检查', s: '用了哪些图块和单位，换电脑会不会缺', b: '列出这张图用到哪几套图块集、每套用了多少个图块、图片尺寸，以及统计用到的单位。如果当前打开的图块素材里没有这套图块，会在别的电脑上变成空白。要保证完整，用<b>保存到游戏文件夹</b>或<b>打包地图合集</b>。' },
});

const ed = A.ed;

// 统计地图用到的图块集和单位
export function collectDeps(ed2 = ed) {
  const m = ed2.map;
  if (!m) return null;
  const tilesets = [];
  for (const ts of m.tilesets) {
    const used = new Set();
    for (const L of m.layers) {
      if (!L.data) continue;
      for (const g of L.data) {
        if (g >= ts.firstgid && g < ts.firstgid + ts.tilecount) used.add(g - ts.firstgid);
      }
    }
    // 对象图层里的 gid
    for (const o of m.groups) for (const oo of o.objects) {
      const g = +oo.attrs.gid;
      if (g >= ts.firstgid && g < ts.firstgid + ts.tilecount) used.add(g - ts.firstgid);
    }
    tilesets.push({
      name: ts.name || '(未命名)',
      firstgid: ts.firstgid,
      tilecount: ts.tilecount,
      image: ts.image ? ts.image.width + '×' + ts.image.height : '（没有图片）',
      used: used.size,
    });
  }
  const units = new Map();
  for (const { o } of ed2.allObjects()) {
    const p = (o.props || []).find((x) => x.name === 'unit');
    if (!p) continue;
    units.set(p.value, (units.get(p.value) || 0) + 1);
  }
  return { tilesets, units: [...units.entries()].sort((a, b) => b[1] - a[1]) };
}

// 一个图块集名字在不在模板里
function templateHas(tpl, name) {
  if (!tpl) return null;
  const doc = new DOMParser().parseFromString('<map>' + tpl.xml + '</map>', 'application/xml');
  return [...doc.querySelectorAll('tileset')].some((t) => (t.getAttribute('name') || '') === name);
}

export async function assetCheckDialog() {
  if (!ed.map) return;
  const deps = collectDeps();
  const tpl = await kvGet('template');
  const rows = [];
  for (const ts of deps.tilesets) {
    const has = templateHas(tpl, ts.name);
    rows.push({ ...ts, ok: has, note: has === null ? '没有模板可对照' : has ? '模板里有' : '当前图块素材里没有' });
  }
  const body = h('div', {},
    h('div', { class: 'hint' }, tpl ? '拿"图块素材来源"里存的那套素材对照' : '还没有开过带图块素材的地图，先打开一张再看'),
    h('h3', { style: 'font-size:14px;margin:12px 0 6px' }, `图块集（${deps.tilesets.length} 套）`),
    h('div', {}, ...rows.map((r) => h('div', { class: 'hrow' },
      h('span', { style: `color:${r.ok === false ? 'var(--err)' : r.ok ? 'var(--ok)' : 'var(--warn)'};font-weight:700;width:18px` }, r.ok === false ? '✕' : r.ok ? '✓' : '?'),
      h('span', {}, r.name),
      h('span', { class: 'hint' }, `${r.used} / ${r.tilecount} 个图块在用 · ${r.image}`),
      h('span', { class: 'hint' }, r.note)))),
    h('h3', { style: 'font-size:14px;margin:12px 0 6px' }, `用到的单位（${deps.units.length} 种）`),
    h('div', { style: 'max-height:24vh;overflow:auto' }, ...deps.units.map(([u, c]) => h('div', { class: 'hrow' },
      h('span', {}, u), h('span', { class: 'hint' }, `${c} 个`)))),
    h('div', { class: 'hint', style: 'margin-top:10px' },
      '拿去别的电脑或发给别人时，缺的图块会变成空白。要保证完整，用"保存到游戏文件夹"或"打包地图合集"。'));
  return modal('地图依赖检查', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
}
