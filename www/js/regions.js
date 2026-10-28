// 区域管理器：列出地图上所有「区域」，改名、批量平移、查谁在引用
// 区域就是 Triggers 组里 def.area 为 'rect' / 'center' 的对象；触发器的条件里会按名字引用它们
import { A } from './state.js';
import { h, modal, toast, confirmBox } from './ui.js';
import { HELP } from './help.js';
import * as T from './triggers.js';
import { trigGroup, kindOf, defOf, label, tkey, LINKS } from './triggers.js';
import { objProp } from './tmx.js';

const ed = A.ed;
const TW = 20;

// 所有区域对象（带格子范围）
export function regions(ed2 = ed) {
  const G = trigGroup();
  if (!G) return [];
  const out = [];
  for (const o of G.objects) {
    const d = defOf(o);
    if (!d || !d.area) continue;
    const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0);
    const w = Math.max(1, +(o.attrs.width || 0)), hgt = Math.max(1, +(o.attrs.height || 0));
    out.push({
      o,
      name: label(o),
      key: tkey(o),
      kind: kindOf(o),
      cn: d.cn || kindOf(o),
      area: d.area,
      // TMX 对象 y 是下边缘
      x0: Math.floor(x / TW), y0: Math.floor((y - hgt) / TW),
      x1: Math.floor((x + w - 1) / TW), y1: Math.floor((y - 1) / TW),
      w, h: hgt,
    });
  }
  return out;
}

// 谁在引用这个名字：触发器的「被谁激活/同时激活/被谁关闭」，以及「移动单位」的目标点
export function references(name) {
  const G = trigGroup();
  if (!G) return [];
  const want = String(name || '').trim().toLowerCase();
  const out = [];
  for (const o of G.objects) {
    if (want && tkey(o) === want) continue;   // 自己不算
    const hitLink = LINKS.some(([p]) => String(objProp(o, p) || '').split(',').some((r) => r.trim().toLowerCase() === want));
    const hitTarget = String(objProp(o, 'target') || '').trim().toLowerCase() === want;
    if (!hitLink && !hitTarget) continue;
    out.push({ o, name: label(o), cn: (defOf(o) || {}).cn || kindOf(o) });
  }
  return out;
}

// 改名。为了不弄断引用，默认把引用一并改掉
export function renameRegion(reg, newName) {
  const oldName = reg.name;
  const nn = String(newName || '').trim();
  if (!nn) return { ok: false, why: '名字不能为空' };
  if (nn === oldName) return { ok: true, changed: 0 };
  if (/,/.test(nn)) return { ok: false, why: '名字里不能有逗号（游戏用逗号分隔多个名字）' };
  if (regions().some((r) => r.name === nn)) return { ok: false, why: `已经有一个叫「${nn}」的区域了` };
  const before = references(oldName).length;
  // 复用触发器里的改名实现：它会连同「被谁激活」这些引用、以及目标点一起改，并且是一步可撤销的操作
  const r = T.rename(reg.o, nn);
  A.refresh && A.refresh();
  return { ok: true, changed: before, refs: r ? r.refs + r.moves : 0 };
}

// 批量平移（格）
export function moveRegions(list, dx, dy) {
  if (!list.length || (!dx && !dy)) return 0;
  ed.begin('区域平移');
  for (const r of list) {
    r.o.attrs.x = String(+(r.o.attrs.x || 0) + dx * TW);
    r.o.attrs.y = String(+(r.o.attrs.y || 0) + dy * TW);
  }
  ed.commit();
  A.refresh && A.refresh();
  return list.length;
}

export function regionsDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (!trigGroup()) { toast('这张图还没有触发器/区域，先在「触发器」里加一个'); return; }
  const body = h('div', {});
  const listEl = h('div', {});
  const info = h('div', { style: 'color:var(--muted);font-size:12px;margin-bottom:8px' });
  const dxInp = h('input', { type: 'number', value: '0', style: 'width:64px' });
  const dyInp = h('input', { type: 'number', value: '0', style: 'width:64px' });
  const sel = new Set();

  body.append(info, listEl, h('div', { class: 'row', style: 'margin-top:10px;gap:8px;align-items:center' },
    h('span', { style: 'font-size:12px;color:var(--muted)' }, '把勾选的区域平移'),
    dxInp, h('span', { style: 'font-size:12px' }, '格 X'), dyInp, h('span', { style: 'font-size:12px' }, '格 Y'),
    h('button', {
      onclick: () => {
        const dx = Math.round(+dxInp.value || 0), dy = Math.round(+dyInp.value || 0);
        const picked = regions().filter((r) => sel.has(r.key));
        if (!picked.length) { toast('先勾上要移动的区域'); return; }
        if (!dx && !dy) { toast('填一下要移动几格'); return; }
        const n = moveRegions(picked, dx, dy);
        toast(`移动了 ${n} 个区域（可以撤销）`);
        paint();
      },
    }, '平移')),
  );

  const paint = () => {
    listEl.textContent = '';
    sel.clear();
    const rs = regions();
    info.textContent = rs.length
      ? `一共 ${rs.length} 个区域。点一行就在地图上定位；改名字时引用它的触发条件会一起改。`
      : '这张图里没有区域（触发器里的「区域检测」等条件会自带区域）。';
    for (const r of rs) {
      const refs = references(r.name);
      const cb = h('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) sel.add(r.key); else sel.delete(r.key); } });
      const nameInp = h('input', { value: r.name, style: 'width:150px' });
      listEl.append(h('div', {
        class: 'hrow',
        style: 'display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--line, #2a2f3a)',
      },
      cb,
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' },
          h('button', {
            style: 'padding:2px 8px;font-size:12px',
            title: '在地图上定位',
            onclick: () => { A.rend.centerOn((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 4); },
          }, `${r.cn} (${r.x0},${r.y0})–(${r.x1},${r.y1})`),
          nameInp,
          h('button', {
            style: 'padding:2px 8px;font-size:12px',
            onclick: () => {
              const res = renameRegion(r, nameInp.value);
              if (!res.ok) { toast(res.why); return; }
              toast(res.changed ? `已改名，${res.changed} 处引用跟着改了（可以撤销）` : '已改名（可以撤销）');
              paint();
            },
          }, '改名')),
        h('div', { style: 'font-size:11px;color:var(--muted);margin-top:2px' },
          refs.length ? `被 ${refs.length} 个触发器引用：${refs.slice(0, 4).map((x) => x.name).join('、')}${refs.length > 4 ? '…' : ''}` : '没有被任何触发器引用'),
      )));
    }
  };
  paint();

  return modal('区域管理器（改名、批量移动、查引用）', body, [
    { label: '关闭', value: 0, primary: true },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.regions': {
    t: '区域管理器',
    s: '一张表管所有区域：改名、整体挪动、看谁在用它',
    b: '菜单「触发器」→「区域管理器」。每一行是一个区域，点左边的按钮就在地图上跳到它。改名字时，触发条件里引用它的地方会一起改，不会因为改名把逻辑弄断。想整体挪位置，勾上几个、填好平移几格，点「平移」——这是一步操作，可以撤销。',
    tips: ['改名后引用自动同步，不用担心触发器失效。', '平移只动区域框，不动里面放的单位。'],
  },
});
