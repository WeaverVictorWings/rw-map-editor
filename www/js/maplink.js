// 地图与 Mod 对照：列出地图用到的单位，标出哪些在已打开的 Mod 里，并显示价格和血量
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { parseUnits } from './triggers.js';
import { unitTiles } from './modunits.js';
import { currentMod } from './modedit.js';
import { getVal } from './ini.js';

const ed = A.ed;

export function usedUnits(map = ed.map) {
  const used = new Map(); // 小写名 -> {name, from:Set}
  const add = (n, from) => { if (!n) return; const k = n.toLowerCase(); if (!used.has(k)) used.set(k, { name: n, from: new Set() }); used.get(k).from.add(from); };
  const g = map && map.group && map.group('Triggers');
  for (const o of g ? g.objects : []) {
    if ((o.attrs.type || '') !== 'unitAdd') continue;
    const p = (o.props || []).find((q) => q.name === 'spawnUnits');
    if (p && p.value) for (const u of parseUnits(p.value)) add(u.name, '触发器');
  }
  for (const t of unitTiles(map)) add(t.unit, '图块集');
  return [...used.values()];
}

export function mapModDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const mod = currentMod();
  const list = usedUnits();
  const byName = new Map();
  if (mod) for (const u of mod.realUnits()) byName.set(mod.unitName(u).toLowerCase(), u);
  const rows = list.map((u) => {
    const mu = byName.get(u.name.toLowerCase());
    const info = mu ? `价格 ${getVal(mu.ini, 'core', 'price') || '—'} · 血量 ${getVal(mu.ini, 'core', 'maxHp') || '—'}` : (mod ? '不在这个 Mod 里（可能是原版单位）' : '');
    return h('tr', {}, h('td', {}, u.name), h('td', {}, [...u.from].join('、')), h('td', { style: mu || !mod ? '' : 'color:#e8a33d' }, mu ? '在 Mod 里 · ' + info : info));
  });
  const body = h('div', {},
    h('div', { class: 'hint' }, mod ? `对照的 Mod：${mod.name}（${mod.realUnits().length} 个单位）` : '还没有在 Mod 编辑器里打开 Mod。打开后再来这里，就能看出地图用到的单位哪些在 Mod 里。'),
    list.length ? h('table', { style: 'width:100%;margin-top:8px;font-size:13px;border-collapse:collapse' }, ...rows) : h('div', { class: 'hint' }, '这张地图的触发器和图块集里没有找到指定的单位。'));
  modal('地图用到的单位', body, [{ label: '关闭' }], {});
}
