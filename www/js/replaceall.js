// 批量替换：把某种地形/物品/单位整体换成另一种，可限定在选区内
// 先预览数量，确认后一次落盘，一步撤销
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { HELP } from './help.js';

const ed = A.ed;

// 要替换的图层分组：地形（主+副）、物品（可包含 overlay）、单位对象
export const GROUPS = [
  { id: 'terrain', cn: '地形', layers: ['ground', 'ground2'] },
  { id: 'items', cn: '物品', layers: ['items', 'items2'] },
  { id: 'overlay', cn: '覆盖层', layers: ['overlay'] },
];

// 统计某图层里哪些图块出现了多少次，以及在选区内各多少次
export function tileHistogram(ed2, layerName, rect = null) {
  const L = ed2.map.layer(layerName);
  const out = new Map();
  if (!L) return out;
  const W = ed2.map.width, H = ed2.map.height;
  const x0 = rect ? Math.max(0, rect.x0) : 0, y0 = rect ? Math.max(0, rect.y0) : 0;
  const x1 = rect ? Math.min(W - 1, rect.x1) : W - 1, y1 = rect ? Math.min(H - 1, rect.y1) : H - 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const g = L.data[y * W + x];
    if (!g) continue;
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

// 真正执行替换。pairs = [{from, to}]，layerName 如 'ground'/'items'
export function replaceTiles(ed2, layerName, pairs, rect = null, label = '批量替换') {
  const L = ed2.map.layer(layerName);
  if (!L) return 0;
  const W = ed2.map.width, H = ed2.map.height;
  const x0 = rect ? Math.max(0, rect.x0) : 0, y0 = rect ? Math.max(0, rect.y0) : 0;
  const x1 = rect ? Math.min(W - 1, rect.x1) : W - 1, y1 = rect ? Math.min(H - 1, rect.y1) : H - 1;
  const map = new Map(pairs.map((p) => [p.from, p.to]));
  const op = ed2.begin(label);
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x, g = L.data[i];
    const to = map.get(g);
    if (to === undefined || to === g) continue;
    const before = g | (L.flips.get(i) || 0);
    ed2.setTile(L, x, y, to);
    ed2.op.tile(L, i, before & 0xffff, before >>> 29, to, 0);
    n++;
  }
  // 必须先让地形引擎把角点同步进这一步，再 commit——commit 之后 ed2.op 已经是 null
  if (n && ed2.engine && L === ed2.engine.layer) ed2.engine.syncRect(op, x0, y0, x1, y1);
  ed2.commit();
  return n;
}

// 单位对象按 unit 名统计
export function unitHistogram(ed2, rect = null) {
  const out = new Map();
  for (const group of ed2.map.groups) {
    for (const o of group.objects) {
      const unit = o.attrs.unit;
      if (!unit) continue;
      if (rect) {
        const x = (+o.attrs.x || 0) / 20, y = (+o.attrs.y || 0) / 20;
        if (x < rect.x0 || y < rect.y0 || x > rect.x1 || y > rect.y1) continue;
      }
      out.set(unit, (out.get(unit) || 0) + 1);
    }
  }
  return out;
}

export function replaceUnits(ed2, fromUnit, toUnit, rect = null) {
  if (!fromUnit || !toUnit || fromUnit === toUnit) return 0;
  ed2.begin('批量替换单位');
  let n = 0;
  for (const group of ed2.map.groups) {
    let touched = false;
    for (const o of group.objects) {
      if (o.attrs.unit !== fromUnit) continue;
      if (rect) {
        const x = (+o.attrs.x || 0) / 20, y = (+o.attrs.y || 0) / 20;
        if (x < rect.x0 || y < rect.y0 || x > rect.x1 || y > rect.y1) continue;
      }
      if (!touched) { ed2.op.snapshotGroup(group); touched = true; }
      const team = Number(o.props.find((p) => p.name === 'team')?.value ?? 0);
      o.attrs.unit = toUnit;
      o.attrs.gid = String(ed2.unitGid(toUnit, team));
      o.attrs.name = `${toUnit} (t:${team})`;
      n++;
    }
  }
  ed2.commit();
  return n;
}

export function replaceAllDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const rect = ed.selection && ed.selection.x0 !== undefined
    ? { x0: Math.min(ed.selection.x0, ed.selection.x1), y0: Math.min(ed.selection.y0, ed.selection.y1), x1: Math.max(ed.selection.x0, ed.selection.x1), y1: Math.max(ed.selection.y0, ed.selection.y1) }
    : null;
  const st = { onlySel: !!rect, group: 'items', layer: 'items', from: '', to: '', unitFrom: '', unitTo: '' };
  const body = h('div', {});
  const stat = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:10px;line-height:1.7;white-space:pre-line' });
  const fromSel = h('select', { onchange: (e) => { st.from = Number(e.target.value); refresh(); } });
  const toSel = h('select', { onchange: (e) => { st.to = Number(e.target.value); refresh(); } });
  const unitFrom = h('select', { onchange: (e) => { st.unitFrom = e.target.value; refresh(); } });
  const unitTo = h('input', { placeholder: '换成', style: 'width:150px', oninput: (e) => { st.unitTo = e.target.value.trim(); refresh(); } });

  const grp = h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' });
  for (const g of GROUPS) {
    const btn = h('button', {
      class: st.group === g.id ? 'on' : '',
      onclick: () => {
        st.group = g.id;
        st.layer = g.layers[0];
        for (const b of grp.children) b.className = '';
        btn.className = 'on';
        refresh();
      },
    }, g.cn);
    if (st.group === g.id) btn.className = 'on';
    grp.append(btn);
  }
  body.append(grp);

  const selRow = h('label', { class: 'row', style: 'gap:6px;font-size:13px;align-items:center;margin-bottom:8px' });
  const selChk = h('input', { type: 'checkbox', onchange: (e) => { st.onlySel = e.target.checked; refresh(); } });
  selChk.checked = !!rect;
  selRow.append(selChk, h('span', {}, rect ? '只替换选区内的（当前有选区）' : '还没有选区，只能替换整张图'));

  const tileRows = h('div', {});
  body.append(tileRows, selRow, stat);

  const unitRows = h('div', {});
  body.append(unitRows);

  function refresh() {
    const r = st.onlySel && rect ? rect : null;
    tileRows.innerHTML = '';
    unitRows.innerHTML = '';
    stat.textContent = '';
    if (st.group === 'units') {
      const hist = unitHistogram(ed, r);
      const opts = [...hist.entries()].sort((a, b) => b[1] - a[1]);
      unitFrom.innerHTML = '';
      for (const [u, n] of opts) unitFrom.append(h('option', { value: u }, `${u}（${n} 个）`));
      if (!opts.length) unitFrom.append(h('option', { value: '' }, '（这里没有单位）'));
      st.unitFrom = unitFrom.value;
      const row = h('div', { class: 'row', style: 'gap:8px;align-items:center;margin:6px 0' });
      row.append(h('span', { style: 'font-size:13px' }, '把'), unitFrom, h('span', { style: 'font-size:13px' }, '换成'), unitTo);
      unitRows.append(row);
      const n = st.unitFrom ? (hist.get(st.unitFrom) || 0) : 0;
      stat.textContent = `将替换 ${n} 个单位${r ? '（仅选区）' : '（整张图）'}`;
      return;
    }
    const g = GROUPS.find((x) => x.id === st.group);
    const laySel = h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' });
    for (const ln of g.layers) {
      const b = h('button', {
        class: st.layer === ln ? 'on' : '',
        onclick: () => {
          st.layer = ln;
          for (const x of laySel.children) x.className = '';
          b.className = 'on';
          refresh();
        },
      }, ed.map.layer(ln) ? ln : `${ln}（无）`);
      laySel.append(b);
    }
    tileRows.append(laySel);
    const hist = tileHistogram(ed, st.layer, r);
    const all = tileHistogram(ed, st.layer, null);
    const entries = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    fromSel.innerHTML = ''; toSel.innerHTML = '';
    toSel.append(h('option', { value: '0' }, '（空着）'));
    for (const [gid, n] of entries) {
      fromSel.append(h('option', { value: String(gid) }, `图块 ${gid}（${n} 格）`));
      toSel.append(h('option', { value: String(gid) }, `图块 ${gid}（全图 ${all.get(gid) || 0} 格）`));
    }
    if (!entries.length) fromSel.append(h('option', { value: '' }, '（这里没有图块）'));
    st.from = fromSel.value !== '' ? Number(fromSel.value) : '';
    if (st.to === '') st.to = 0;
    const row = h('div', { class: 'row', style: 'gap:8px;align-items:center;margin:6px 0' });
    row.append(h('span', { style: 'font-size:13px' }, '把'), fromSel, h('span', { style: 'font-size:13px' }, '换成'), toSel);
    tileRows.append(row);
    const cur = fromSel.value !== '' ? (hist.get(Number(fromSel.value)) || 0) : 0;
    stat.textContent = `将替换 ${cur} 格${r ? '（仅选区）' : '（整张图）'}`;
  }
  fromSel.addEventListener('change', () => { });
  refresh();

  const run = () => {
    const r = st.onlySel && rect ? rect : null;
    let n = 0;
    if (st.group === 'units') {
      if (!st.unitFrom || !st.unitTo) { toast('先选要替换的单位和目标单位'); return false; }
      n = replaceUnits(ed, st.unitFrom, st.unitTo, r);
    } else {
      if (st.from === '' || st.from === undefined) { toast('先选要替换的图块'); return false; }
      const pairs = [{ from: Number(st.from), to: Number(st.to) || 0 }];
      for (const ln of GROUPS.find((x) => x.id === st.group).layers) n += replaceTiles(ed, ln, pairs, r, '批量替换');
    }
    toast(n ? `已替换 ${n} 处` : '没有找到要替换的内容');
    return true;
  };

  return modal('批量替换（地形 / 物品 / 单位）', body, [
    { label: '取消', value: 0 },
    { label: '替换', value: 1, primary: true, check: run },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.replaceall': {
    t: '批量替换',
    s: '把一种地形或物品整体换成另一种，可只改选区',
    b: '菜单「编辑」→「批量替换…」。选一个分组（地形 / 物品 / 覆盖层 / 单位），左边挑「把哪个换成哪个」，下面会实时告诉你要改多少格。有选区时会多一个「只替换选区内的」勾选。',
    tips: ['整张图替换前建议先存一次，虽然能撤销，但改动量大时撤销也占内存。', '单位替换会同时换掉图块和名字，队伍保持不变。'],
  },
});
