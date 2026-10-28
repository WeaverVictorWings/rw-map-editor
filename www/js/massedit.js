// 批量替换单位（2.5）：按「类型 / 队伍 / 血量 / 属性有无」筛出一批单位，整批换成另一种单位或另一个队伍
// 约定：
//   - 队伍号 0 开始存（界面显示第 n+1 队）；-1 中立，-2 敌对中立（和触发器一致）
//   - 换单位 / 换队伍时同步 attrs.name（`unit (t:N)`）和 attrs.gid（ed.unitGid），和 editor.js makeUnit / unitprops.js applyUnitEdits 保持一致
//   - 只改 unit / team / name / gid 四个地方，x / y / width / height / rotation / 其它属性一概不动
//   - 一次「替换命中项」= 一个 ed.begin()…ed.commit()，一步撤销
import { A } from './state.js';
import { setObjProp } from './tmx.js';
import { UNIT_CN, MAX_TEAMS } from './editor.js';
import { allUnits } from './unitprops.js';
import { h, modal, toast, confirmBox, closeModal } from './ui.js';
import { HELP } from './help.js';

let dialogOpen = false; // 防止连点两次打开两个窗口

function teamName(t) {
  if (t === null || t === undefined || t === '') return '未设队伍';
  const n = +t;
  if (n === -1) return '中立';
  if (n === -2) return '敌对中立';
  if (n < 0) return `队伍 ${n}`;
  return `第 ${n + 1} 队`;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

// 筛选命中的单位（返回 unitprops.allUnits 的富信息记录：{ group, obj, unit, team, x, y, tileX, tileY, props }）
function hitUnits(ed, filter = {}) {
  if (!ed || !ed.map) return [];
  const f = filter || {};
  const unit = f.unit && f.unit !== 'all' ? String(f.unit) : null;
  const noneTeam = !!f._noneTeam || f.team === 'none';
  const team = !noneTeam && f.team !== undefined && f.team !== null && f.team !== '' && f.team !== 'all' ? +f.team : null;
  const hpMin = numOrNull(f.hpMin), hpMax = numOrNull(f.hpMax);
  const has = f.hasProp ? String(f.hasProp).trim() : '';
  const missing = f.missingProp ? String(f.missingProp).trim() : '';
  const out = [];
  for (const u of allUnits(ed)) {
    if (unit && u.unit !== unit) continue;
    if (team !== null && u.team !== team) continue;
    if (noneTeam && u.team !== null) continue;
    if (has && u.props[has] === undefined) continue;
    if (missing && u.props[missing] !== undefined) continue;
    if (hpMin !== null || hpMax !== null) {
      const hp = u.props.health === undefined ? NaN : +u.props.health;
      if (!Number.isFinite(hp)) continue;                 // 没写 health 的不参与血量筛选（不猜默认值）
      if (hpMin !== null && hp < hpMin) continue;
      if (hpMax !== null && hp > hpMax) continue;
    }
    out.push(u);
  }
  return out;
}

// 返回命中的单位对象数组（原始 TMX 对象，属性用 objProp 读）
export function findUnits(ed, filter = {}) {
  return hitUnits(ed, filter).map((u) => u.obj);
}

// 把命中的单位换成 to.unit / to.team（field 为空表示该项不改）。返回真正改到的数量。
// 例：replaceUnits(ed, { unit: 'builder', team: 0 }, { unit: 'tank', team: 1 })
export function replaceUnits(ed, filter, to = {}) {
  if (!ed || !ed.map) return 0;
  const wantUnit = to.unit && to.unit !== 'all' ? String(to.unit) : null;
  const wantTeam = to.team !== undefined && to.team !== null && to.team !== '' && to.team !== 'all' ? +to.team : null;
  if (!wantUnit && wantTeam === null) return 0;
  // 先算清楚哪些真的要改（同单位同队伍的不产生撤销步）
  const plan = [];
  for (const u of hitUnits(ed, filter)) {
    const unit = wantUnit || u.unit;
    const team = wantTeam !== null ? wantTeam : u.team;
    if (unit === u.unit && team === u.team) continue;
    plan.push({ u, unit, team });
  }
  if (!plan.length) return 0;
  const groups = new Map();
  for (const { u } of plan) if (!groups.has(u.group)) groups.set(u.group, u.group.objects.slice());
  ed.begin('批量替换单位');
  for (const g of groups.keys()) ed.op.snapshotGroup(g);
  let n = 0;
  for (const { u, unit, team } of plan) {
    const o = u.obj;
    if (!(u.group.objects || []).includes(o)) continue;  // 已经被撤销 / 删掉的对象
    setObjProp(o, 'unit', unit);
    if (team !== null) setObjProp(o, 'team', team);
    else setObjProp(o, 'team', null);
    o.attrs.name = team !== null ? `${unit} (t:${team})` : unit;
    // 图块按队伍分块时换成对应队伍的图块；没有对应图块就保留原图块（游戏里颜色 / 外观以实际为准）
    const gid = typeof ed.unitGid === 'function' ? ed.unitGid(unit, team === null ? '' : team) : 0;
    if (gid) o.attrs.gid = String(gid);
    n++;
  }
  for (const [g, before] of groups) ed.op.noteDiff(before, g.objects);
  ed.commit();
  return n;
}

// ---------------- 界面 ----------------
function optsForUnits(ed) {
  const names = new Set(ed.unitNames || []);
  for (const u of allUnits(ed)) names.add(u.unit);
  const list = [...names].filter(Boolean);
  list.sort((a, b) => (UNIT_CN[a] || a).localeCompare(UNIT_CN[b] || b, 'zh-CN'));
  return list.map((u) => [u, UNIT_CN[u] ? `${UNIT_CN[u]}（${u}）` : u]);
}

function optsForTeams(withKeep) {
  const out = [];
  if (withKeep) out.push(['', '不改变队伍']);
  else out.push(['all', '全部队伍'], ['none', '未设队伍']);
  out.push(['-1', '中立（-1）'], ['-2', '敌对中立（-2）']);
  for (let t = 0; t < MAX_TEAMS; t++) out.push([String(t), `第 ${t + 1} 队（${t}）`]);
  return out;
}

export async function massEditDialog() {
  const ed = A.ed, rend = A.rend;
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (dialogOpen) return;

  const counts = new Map(); // unit -> 命中数量（实时统计用）
  const listEl = h('div', { class: 'hint', style: 'margin-top:8px;min-height:18px' });

  const unitSel = h('select', { title: '按单位类型筛选' });
  const teamSel = h('select', { title: '按队伍筛选' });
  const toUnitSel = h('select', { title: '要换成哪种单位' });
  const toTeamSel = h('select', { title: '要换成哪个队伍' });

  const fill = () => {
    const names = optsForUnits(ed);
    unitSel.innerHTML = '';
    unitSel.append(h('option', { value: 'all' }, '全部类型'));
    for (const [v, l] of names) unitSel.append(h('option', { value: v }, l));
    const present = [...new Set(allUnits(ed).map((u) => (u.team === null ? 'none' : String(u.team))))];
    present.sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : (+a) - (+b)));
    teamSel.innerHTML = '';
    teamSel.append(h('option', { value: 'all' }, '全部队伍'));
    for (const v of present) {
      if (v === 'none') { teamSel.append(h('option', { value: 'none' }, '未设队伍')); continue; }
      teamSel.append(h('option', { value: v }, teamName(+v)));
    }
    toUnitSel.innerHTML = '';
    toUnitSel.append(h('option', { value: '' }, '不改变单位类型'));
    for (const [v, l] of names) toUnitSel.append(h('option', { value: v }, l));
    toTeamSel.innerHTML = '';
    for (const [v, l] of optsForTeams(true)) toTeamSel.append(h('option', { value: v }, l));
  };

  const filter = () => ({
    unit: unitSel.value === 'all' ? null : unitSel.value,
    team: teamSel.value === 'all' ? null : (teamSel.value === 'none' ? null : +teamSel.value),
    hpMin: hpMinInp.value,
    hpMax: hpMaxInp.value,
    hasProp: hasInp.value.trim(),
    missingProp: missingInp.value.trim(),
  });
  // team = null 且界面上选了“未设队伍”时，需要表达 null 而不是“全部”
  const filterTeamNone = () => teamSel.value === 'none';

  function currentFilter() {
    const f = filter();
    if (filterTeamNone()) f._noneTeam = true;
    return f;
  }

  const hitCount = () => hitUnits(ed, currentFilter());

  function update() {
    const list = hitCount();
    counts.clear();
    for (const u of list) counts.set(u.unit, (counts.get(u.unit) || 0) + 1);
    const byUnit = [...counts.entries()].sort((a, b) => b[1] - a[1])
      .map(([u, n]) => `${UNIT_CN[u] || u}×${n}`).join('、');
    if (!list.length) {
      listEl.textContent = allUnits(ed).length
        ? '没有符合条件的单位。换个筛选条件试试。'
        : '这张地图里还没有单位。';
    } else {
      const teams = [...new Set(list.map((u) => teamName(u.team)))].join('、');
      listEl.textContent = `命中 ${list.length} 个单位：${byUnit}${teams ? `（队伍：${teams}）` : ''}`;
    }
    listEl.dataset.count = String(list.length);
  }

  const hpMinInp = h('input', { type: 'number', step: 'any', placeholder: '不限', style: 'width:90px' });
  const hpMaxInp = h('input', { type: 'number', step: 'any', placeholder: '不限', style: 'width:90px' });
  const hasInp = h('input', { placeholder: '有属性，如 health' });
  const missingInp = h('input', { placeholder: '没有属性，如 invulnerable' });

  for (const el of [unitSel, teamSel]) el.addEventListener('change', update);
  for (const el of [hpMinInp, hpMaxInp, hasInp, missingInp]) el.addEventListener('input', update);
  toUnitSel.addEventListener('change', update);
  toTeamSel.addEventListener('change', update);

  const replaceBtn = h('button', {
    class: 'primary',
    onclick: async () => {
      const list = hitCount();
      if (!list.length) { toast('没有命中的单位'); return; }
      const wantUnit = toUnitSel.value || null;
      const wantTeam = toTeamSel.value === '' ? null : +toTeamSel.value;
      if (!wantUnit && wantTeam === null) { toast('先选要换成什么单位或队伍'); return; }
      const what = [];
      if (wantUnit) what.push(`单位类型 → ${UNIT_CN[wantUnit] || wantUnit}`);
      if (wantTeam !== null) what.push(`队伍 → ${teamName(wantTeam)}`);
      const okd = await confirmBox('批量替换单位？',
        `将修改 ${list.length} 个单位：${what.join('；')}。位置、大小、旋转和自定义属性都不动，可以一步撤销。`, '替换命中项');
      if (!okd) return;
      const n = replaceUnits(ed, currentFilter(), { unit: wantUnit, team: wantTeam });
      if (!n) { toast('没有实际改动'); return; }
      update();
      rend.request();
      A.refresh('top', 'dock');
      toast(`已替换 ${n} 个单位（可以一步撤销）`);
    },
  }, '替换命中项');

  const body = h('div', {},
    h('div', { class: 'card' },
      h('div', { style: 'font-weight:600;margin-bottom:8px' }, '① 选出要替换的单位'),
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px' },
        h('div', { class: 'field' }, h('label', {}, '单位类型'), unitSel),
        h('div', { class: 'field' }, h('label', {}, '队伍'), teamSel),
        h('div', { class: 'field' }, h('label', {}, '血量 ≥'), hpMinInp),
        h('div', { class: 'field' }, h('label', {}, '血量 ≤'), hpMaxInp),
        h('div', { class: 'field' }, h('label', {}, '带某个属性（health / rank / invulnerable…）'), hasInp),
        h('div', { class: 'field' }, h('label', {}, '缺某个属性'), missingInp)),
      listEl,
      h('div', { class: 'hint' }, '按单位属性（health / rank / invulnerable 等）筛选；没写 health 的单位不会被“血量”条件命中。')),
    h('div', { class: 'card', style: 'margin-top:10px' },
      h('div', { style: 'font-weight:600;margin-bottom:8px' }, '② 换成什么'),
      h('div', { class: 'row', style: 'align-items:flex-end;flex-wrap:wrap' },
        h('div', { class: 'field', style: 'flex:1 1 220px' }, h('label', {}, '单位类型'), toUnitSel),
        h('div', { class: 'field', style: 'flex:1 1 220px' }, h('label', {}, '队伍'), toTeamSel)),
      h('div', { class: 'row', style: 'margin-top:6px' }, replaceBtn),
      h('div', { class: 'hint' },
        '换单位 / 队伍时会顺便改对象名（', h('b', {}, 'unit (t:N)'), '）和图块；x / y / 宽高 / 旋转不动。',
        h('br'), '如果当前图块集里没有目标队伍对应的图块，会保留原来的图块（游戏里外观以实际为准）。')));

  fill();
  update();

  const onEv = (ev) => {
    if (!ed.map) { closeModal(); return; }
    if (ev === 'map' || (ev && ev.type === 'changed')) { fill(); update(); }
    if (ev === 'edit') update();
  };
  dialogOpen = true;
  ed.on(onEv);
  try {
    await modal('批量替换单位', body, [{ label: '关闭', value: 1, primary: true }], { wide: true });
  } finally {
    dialogOpen = false;
    ed.listeners.delete(onEv);
  }
}

Object.assign(HELP, {
  'tool.massedit': {
    t: '批量替换单位',
    s: '按类型、队伍、血量筛出一批单位，一次性换单位 / 换队伍',
    b: '菜单「单位」→「批量替换单位」。先选筛选条件（单位类型、队伍、血量范围、有没有某个属性），下面会实时显示命中多少个；再选要换成什么单位、哪个队伍，点「替换命中项」并确认。只改单位类型、队伍、对象名和图块，位置、大小、旋转和自定义属性都保持不变。',
    tips: [
      '整个替换算一步操作，Ctrl+Z 可以整体撤销。',
      '没写 health 属性的单位不会被血量条件命中，想按血量筛先给它们写 health。',
      '目标队伍在当前图块集里没有对应图块时，会保留原来的图块，游戏里的外观以实际为准。',
    ],
  },
});
