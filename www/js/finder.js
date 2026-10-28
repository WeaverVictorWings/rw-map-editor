// 查找并跳转：把地图上的对象列出来，点一下就跳过去
import { A } from './state.js';
import { h, modal, segmented } from './ui.js';
import { label as trigLabel, kindOf, defOf } from './triggers.js';

const ed = A.ed;

const unitName = (o) => {
  const p = (o.props || []).find((x) => x.name === 'unit');
  return p && p.value ? p.value : null;
};
const teamOf = (o) => {
  const p = (o.props || []).find((x) => x.name === 'team');
  return p && p.value != null && p.value !== '' ? +p.value : null;
};

// 收集所有可跳转目标。tx/ty 是格坐标
export function collectTargets() {
  const out = [];
  const m = ed.map;
  if (!m) return out;
  // 单位
  for (const { o } of ed.allObjects()) {
    const uid = unitName(o);
    if (!uid) continue;
    const t = teamOf(o);
    out.push({ kind: '单位', name: uid, tx: (+o.attrs.x || 0) / 20, ty: (+o.attrs.y || 0) / 20, extra: t == null ? '' : `第 ${t} 队` });
  }
  // 触发器区域
  const G = m.group('Triggers');
  if (G) for (const o of G.objects) {
    const k = kindOf(o);
    if (!k) continue;
    const d = defOf(o);
    out.push({ kind: '触发器', name: `${trigLabel(o)}（${(d && d.cn) || k}）`, tx: Math.round((+o.attrs.x || 0) / 20), ty: Math.round((+o.attrs.y || 0) / 20), extra: '' });
  }
  // 资源池（用编辑器已解析好的 poolGids）
  const seen = new Set();
  for (const [x, y] of ed.poolTiles()) {
    const key = Math.round(x / 2) + ',' + Math.round(y / 2);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: '资源池', name: '资源池', tx: x + 0.5, ty: y + 0.5, extra: '' });
  }
  // 出生点
  for (const s of ed.spawns()) {
    out.push({ kind: '出生点', name: `第 ${s.team} 队指挥中心`, tx: s.cx / 20, ty: s.cy / 20, extra: '' });
  }
  return out;
}

function matches(t, q) {
  if (!q) return true;
  return (t.kind + ' ' + t.name + ' ' + t.extra).toLowerCase().includes(q);
}

export function finderDialog() {
  const m = ed.map;
  if (!m) return;
  let mode = 'pool';
  let list = [];
  let idx = -1;
  const all = collectTargets();
  const search = h('input', { type: 'search', placeholder: '搜单位名、触发器名、坐标…' });
  const info = h('div', { class: 'hint' });
  const box = h('div', { class: 'hlist', style: 'max-height:44vh;overflow:auto' });
  let items = [];
  const jump = (i) => {
    if (!list.length) return;
    idx = ((i % list.length) + list.length) % list.length;
    const t = list[idx];
    A.rend.centerOn(t.tx - 0.5, t.ty - 0.5);
    info.textContent = `第 ${idx + 1} / ${list.length} · ${t.kind}：${t.name} @ ${Math.round(t.tx)},${Math.round(t.ty)}`;
    items.forEach((el, j) => el.classList.toggle('on', j === idx));
    if (items[idx] && items[idx].scrollIntoView) items[idx].scrollIntoView({ block: 'nearest' });
  };
  const rebuild = () => {
    const q = search.value.trim().toLowerCase();
    list = all.filter((t) => (mode === 'pool' ? t.kind === '资源池' : true)).filter((t) => matches(t, q));
    idx = -1;
    items = [];
    box.replaceChildren();
    if (!list.length) {
      box.append(h('div', { class: 'hint' }, all.length ? '没有匹配的，换个词试试。' : '地图上还没有可查找的对象。'));
    } else {
      for (const [i, t] of list.entries()) {
        const el = h('div', { class: 'hrow', style: 'cursor:pointer', onclick: () => jump(i) },
          h('span', { class: 'hstat' }, `${Math.round(t.tx)},${Math.round(t.ty)}`),
          h('span', {}, `[${t.kind}] ${t.name}`),
          t.extra ? h('span', { class: 'hint' }, t.extra) : null);
        items.push(el); box.append(el);
      }
    }
    const cnt = {};
    for (const t of all) cnt[t.kind] = (cnt[t.kind] || 0) + 1;
    info.textContent = `共 ${all.length} 个对象` + (Object.keys(cnt).length ? '：' + Object.entries(cnt).map(([k, v]) => k + ' ' + v).join(' · ') : '');
  };
  search.addEventListener('input', rebuild);
  const body = h('div', {},
    segmented([['pool', '资源池'], ['all', '全部对象']], mode, (v) => { mode = v; rebuild(); }),
    h('div', { style: 'margin:8px 0' }, search),
    info, box);
  rebuild();
  modal('查找并跳转', body, [
    { label: '上一个', value: -1 }, { label: '下一个', value: 1 },
    { label: '关闭', value: 0, primary: true },
  ], { wide: true }).then((v) => {
    if (v === 1 || v === -1) {
      // 重新打开时沿用同一份列表，先把指针落到刚才那条
      finderDialog();
    }
  });
}
