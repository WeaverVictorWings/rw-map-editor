// 单位属性编辑（2.4 #8）：批量设队伍、旋转角度、血量 / 无敌 / 等级和任意自定义属性
// 约定：
//   - 队伍号从 0 开始存（界面上显示“第 n+1 队”）；-1 中立，-2 敌对中立（和触发器里的 team 一致）
//   - 改队伍时同步 attrs.gid（ed.unitGid）和 attrs.name（`${unit} (t:${team})`），和 transform.js 的整图镜像一致
//   - health / rank / invulnerable 只是社区常见写法，属性名最终以游戏 / Mod 为准（界面里有注明）
//   - 一次“应用修改 / 删除 / 复制” = 一个 ed.begin()…ed.commit()，一步撤销
import { A } from './state.js';
import { objProp, setObjProp } from './tmx.js';
import { UNIT_CN, MAX_TEAMS } from './editor.js';
import { teamColor } from './render.js';
import { h, toast, modal, closeModal, confirmBox } from './ui.js';

const TW = 20;            // 一格 20×20 像素
const LIST_CAP = 500;     // 列表最多渲染这么多行（不做虚拟滚动，用搜索 / 筛选缩小范围）
// 常用属性快捷按钮：[属性名, 按钮文字, 默认值, 悬停说明]
const PROP_PRESETS = [
  ['health', '血量 health', '100', 'health：血量百分比，常见写法 100 / 50'],
  ['rank', '等级 rank', '1', 'rank：等级，常见写法 1、2、3'],
  ['invulnerable', '无敌 invulnerable', 'true', 'invulnerable：无敌，常见写法 true / false'],
];

// 勾选的单位对象：关掉对话框再打开时保留（换地图 / 撤销后对象被替换时自动清理）
const picked = new Set();
let dialogOpen = false; // 防止连点两次打开两个对话框

function teamName(t) { // 只在界面里用，不对外导出
  if (t === null || t === undefined || t === '' || Number.isNaN(+t)) return '未设队伍';
  const n = +t;
  if (n === -1) return '中立';
  if (n === -2) return '敌对中立';
  if (n < 0) return `队伍 ${n}`;
  return `第 ${n + 1} 队`;
}

// 地图里所有带 unit 属性的对象。附件里还可能带 data-rw-tile（画在图块层里、还没转成对象的单位）。
export function allUnits(ed) {
  const out = [];
  if (!ed || !ed.map) return out;
  for (const group of ed.map.groups) {
    for (const obj of group.objects || []) {
      const unit = objProp(obj, 'unit');
      if (!unit) continue;
      const rawTeam = objProp(obj, 'team');
      const team = rawTeam === undefined || rawTeam === '' || Number.isNaN(+rawTeam) ? null : +rawTeam;
      const props = {};
      for (const p of obj.props || []) props[p.name] = p.value;
      const x = +((obj.attrs && obj.attrs.x) || 0);
      const y = +((obj.attrs && obj.attrs.y) || 0);
      // 图块对象的 y 是下边缘（Tiled 口径），普通对象的 y 是左上角 → 统一换算成“脚下那一格”，两种对象混在一张列表里才对得上
      out.push({
        group, obj, unit, team, x, y,
        tileX: Math.max(0, Math.floor(x / TW)),
        tileY: Math.max(0, Math.floor((y - 1) / TW)),
        props,
      });
    }
  }
  return out;
}

// 应用一组修改。edits: [{ group, obj, set: { attrs?: {rotation?}, props?: {name: value|null} }, team? }]
// props 里 value 为 null 表示删除该属性；unit / team 不通过 set.props 改（unit 会换单位类型，team 走 team 字段）。
// 返回真正改到的单位数；没有实际变化时不产生撤销记录。
export function applyUnitEdits(ed, edits) {
  if (!ed || !ed.map || !Array.isArray(edits)) return 0;
  // 先算清楚要改什么：没变化就不 begin（避免留下空撤销步）
  const plan = [];
  const touched = new Set();
  for (const e of edits) {
    if (!e || !e.group || !e.obj) continue;
    if (!(e.group.objects || []).includes(e.obj)) continue; // 已经被删掉 / 撤销换掉的对象
    const o = e.obj;
    const set = e.set || {};
    let team = null, teamChanged = false;
    if (e.team !== undefined && e.team !== null && e.team !== '') {
      const t = +e.team;
      if (Number.isInteger(t) && t >= -2 && t < MAX_TEAMS) {   // 小数队伍号游戏读不懂，直接忽略
        team = t;
        // 队伍没变、name / gid 也已经同步过时不算改动（重复点“应用”不会留下空撤销步）
        const unit = objProp(o, 'unit') || '';
        const wantName = unit ? `${unit} (t:${team})` : '';
        const wantGid = unit && typeof ed.unitGid === 'function' ? ed.unitGid(unit, team) : 0;
        teamChanged = String(objProp(o, 'team')) !== String(team) ||
          (!!wantName && o.attrs.name !== wantName) || (!!wantGid && o.attrs.gid !== String(wantGid));
      }
    }
    // 结构字段（id / name / x / y / gid）不从这里改，name 和 gid 由队伍变化负责同步
    const attrs = {};
    for (const [k, v] of Object.entries(set.attrs || {})) {
      if (k === 'id' || k === 'name' || k === 'x' || k === 'y' || k === 'gid') continue;
      if (v === null || v === undefined) continue;
      attrs[k] = String(v);
    }
    const props = [];
    for (const [k, v] of Object.entries(set.props || {})) {
      const name = String(k || '').trim();
      if (!name || name === 'unit') continue;
      const sv = (v === null || v === undefined) ? '' : String(v).trim();
      if (!sv) props.push([name, null]);   // 留空 = 删掉这个属性（写成空串游戏会当成 0 / 默认值）
      else props.push([name, sv]);
    }
    let changed = teamChanged;
    if (!changed) for (const [k, v] of Object.entries(attrs)) { if (o.attrs[k] !== v) { changed = true; break; } }
    if (!changed) for (const [k, v] of props) {
      const cur = objProp(o, k);
      if (v === null ? cur !== undefined : String(cur) !== v) { changed = true; break; }
    }
    if (!changed) continue;
    plan.push({ o, team, attrs, props });
    touched.add(e.group);
  }
  if (!plan.length) return 0;
  ed.begin('编辑单位属性');
  for (const group of touched) ed.op.snapshotGroup(group);
  for (const { o, team, attrs, props } of plan) {
    if (team !== null) {
      const unit = objProp(o, 'unit') || '';
      setObjProp(o, 'team', team);
      if (unit) {
        o.attrs.name = `${unit} (t:${team})`;
        const gid = typeof ed.unitGid === 'function' ? ed.unitGid(unit, team) : 0;
        if (gid) o.attrs.gid = String(gid);
      }
    }
    for (const [k, v] of Object.entries(attrs)) o.attrs[k] = v;
    for (const [k, v] of props) setObjProp(o, k, v);
  }
  ed.commit();
  return plan.length;
}
// 改属性只改现有对象，不会增删，所以 before / after 的对象集合一致；这里不需要 noteDiff

// ---------------- 界面 ----------------
// 批量改完 / 删完 / 复制完：重画地图、刷新右侧面板（提交本身会触发 app 的 'edit'）
function afterEdit(rend, msg) {
  rend.request();
  A.refresh('top', 'dock');
  toast(msg + '，可以一步撤销');
}

export async function unitPropsDialog() {
  const ed = A.ed, rend = A.rend;
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (dialogOpen) return;
  let data = allUnits(ed);
  // 清理上次留下的、已经不在图里的勾选（换地图 / 撤销后对象会被整体替换）
  const cur = new Set(data.map((u) => u.obj));
  for (const o of [...picked]) if (!cur.has(o)) picked.delete(o);
  const st = { q: '', team: 'all', type: 'all', clip: null };
  let curRows = []; // 当前筛选出的行（全选 / 反选用）

  // ---------- 左：筛选 + 列表 ----------
  const qInp = h('input', {
    placeholder: '搜索单位、属性或坐标，比如“坦克”“health”“12,30”',
    oninput: () => { st.q = qInp.value; renderList(); },
  });
  const teamSel = h('select', {
    title: '按队伍筛选', style: 'flex:1 1 120px;width:auto;min-width:0',
    onchange: () => { st.team = teamSel.value; renderList(); },
  });
  const typeSel = h('select', {
    title: '按单位类型筛选', style: 'flex:1 1 120px;width:auto;min-width:0',
    onchange: () => { st.type = typeSel.value; renderList(); },
  });
  const listEl = h('div', {
    style: 'border:1px solid var(--line);border-radius:8px;max-height:400px;overflow-y:auto;background:var(--bg0);margin-top:6px',
  });
  const countEl = h('div', { class: 'hint', style: 'margin-top:8px' });
  const left = h('div', {},
    h('div', { class: 'field' }, qInp),
    h('div', { class: 'row', style: 'flex-wrap:nowrap;margin-bottom:6px' }, teamSel, typeSel),
    h('div', { class: 'row', style: 'margin:6px 0' },
      h('button', { onclick: selectFiltered }, '全选筛选结果'),
      h('button', { onclick: invertFiltered }, '反选'),
      h('button', { onclick: () => { picked.clear(); renderList(); } }, '清空选择')),
    listEl, countEl,
    h('div', { class: 'hint', style: 'margin-top:6px' }, '勾选左侧方框选中单位；点一行会关闭本窗口并在地图上定位（勾选会保留）。'));

  // ---------- 右：批量修改 ----------
  const teamOpts = [['', '不修改'], ['-1', '中立（-1）'], ['-2', '敌对中立（-2）']];
  for (let t = 0; t < MAX_TEAMS; t++) teamOpts.push([String(t), `第 ${t + 1} 队（${t}）`]);
  const teamInput = h('select', {}, teamOpts.map(([v, l]) => h('option', { value: v }, l)));
  teamInput.value = '';
  const rotInp = h('input', { type: 'number', step: 'any', placeholder: '不修改', style: 'width:100px' });
  const rotQuick = h('div', { class: 'row' }, ['-90', '0', '90', '180', '270'].map((v) =>
    h('button', { style: 'padding:2px 8px;font-size:12px', onclick: () => { rotInp.value = v; } }, v)));

  const propBox = h('div');
  const addPropRow = (name = '', value = '') => {
    const nInp = h('input', { placeholder: '属性名，如 health', value: name });
    const vInp = h('input', { placeholder: '值（留空 = 删除）', value });
    const row = h('div', { class: 'kv' }, nInp, vInp,
      h('button', { title: '删除这一行', style: 'padding:2px 8px', onclick: () => row.remove() }, '×'));
    propBox.append(row);
    if (!name) setTimeout(() => nInp.focus(), 0);
    return row;
  };
  const clearProps = () => { while (propBox.firstChild) propBox.removeChild(propBox.firstChild); };
  const collectProps = () => {
    const out = [];
    for (const row of propBox.children) {
      const name = row.children[0].value.trim();
      if (!name) continue; // 属性名为空的行忽略
      const value = row.children[1].value.trim();
      out.push({ name, value: value === '' ? null : value }); // 值留空 = 删除该属性
    }
    return out;
  };

  const clipEl = h('div', { class: 'hint', style: 'margin:6px 0' },
    '还没复制属性：点列表里单位右边的“复制属性”，再粘贴到勾选的单位上。');
  const pasteBtn = h('button', { disabled: true, onclick: pasteProps }, '粘贴到选中单位');
  const applyBtn = h('button', { class: 'primary', onclick: apply }, '应用修改');
  const copyBtn = h('button', { onclick: copyUnits }, '复制选中（偏移 1 格）');
  const delBtn = h('button', { class: 'danger', onclick: delUnits }, '删除选中');

  const right = h('div', {},
    h('div', { class: 'card' },
      h('div', { style: 'font-weight:600;margin-bottom:6px' }, '批量修改（对勾选的单位生效）'),
      h('div', { class: 'field' }, h('label', {}, '队伍'), teamInput),
      h('div', { class: 'field' }, h('label', {}, '旋转角度'), h('div', { class: 'row' }, rotInp, rotQuick)),
      h('div', { class: 'field' },
        h('label', {}, '属性'),
        propBox,
        h('div', { class: 'row', style: 'margin-top:6px' },
          PROP_PRESETS.map(([n, label, val, title]) => h('button', { title, onclick: () => addPropRow(n, val) }, label)),
          h('button', { onclick: () => addPropRow() }, '＋ 自定义属性'))),
      h('div', { class: 'hint' },
        '属性名按游戏 / Mod 的约定填写。', h('b', {}, 'health'), '（血量百分比）、', h('b', {}, 'rank'),
        '（等级）、', h('b', {}, 'invulnerable'), '（无敌 true / false）只是社区常见写法，最终以游戏里实际生效的为准。',
        h('br'), '值留空 = 删除这个属性；属性名为空的行会被忽略。'),
      h('div', { style: 'margin-top:10px' }, clipEl, h('div', { class: 'row' }, pasteBtn)),
      h('div', { class: 'row', style: 'margin-top:10px' }, applyBtn, copyBtn),
      h('div', { class: 'row', style: 'margin-top:6px' }, delBtn),
      h('div', { class: 'hint', style: 'margin-top:10px' }, '一次操作只算一步撤销；单位类型（unit 属性）不会在这里被改。')));

  const body = h('div', {},
    h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;align-items:start' }, left, right));

  // ---------- 数据 / 筛选 / 列表 ----------
  function fillFilters() {
    const keepT = st.team, keepU = st.type;
    const teams = [...new Set(data.map((u) => (u.team === null ? 'none' : String(u.team))))];
    teams.sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : (+a) - (+b)));
    teamSel.innerHTML = '';
    teamSel.append(h('option', { value: 'all' }, '全部队伍'));
    for (const t of teams) teamSel.append(h('option', { value: t }, t === 'none' ? '未设队伍' : teamName(+t)));
    st.team = teams.includes(keepT) ? keepT : 'all';
    teamSel.value = st.team;

    const units = [...new Set(data.map((u) => u.unit))];
    units.sort((a, b) => (UNIT_CN[a] || a).localeCompare(UNIT_CN[b] || b, 'zh-CN'));
    typeSel.innerHTML = '';
    typeSel.append(h('option', { value: 'all' }, '全部类型'));
    for (const u of units) typeSel.append(h('option', { value: u }, UNIT_CN[u] ? `${UNIT_CN[u]}（${u}）` : u));
    st.type = units.includes(keepU) ? keepU : 'all';
    typeSel.value = st.type;
  }

  const matches = (u, q) => {
    const hay = [u.unit, UNIT_CN[u.unit] || '', (u.obj.attrs && u.obj.attrs.name) || '',
      `${u.tileX},${u.tileY}`, ...Object.entries(u.props).map(([k, v]) => `${k}=${v}`)].join(' ').toLowerCase();
    return hay.includes(q);
  };

  function filtered() {
    const q = st.q.trim().toLowerCase();
    return data.filter((u) => {
      if (st.team !== 'all' && (u.team === null ? 'none' : String(u.team)) !== st.team) return false;
      if (st.type !== 'all' && u.unit !== st.type) return false;
      return !q || matches(u, q);
    });
  }

  function makeRow(u) {
    // 全局样式里 input 是 width:100%，复选框要自己限定大小，否则会把整行撑开
    const cb = h('input', { type: 'checkbox', style: 'flex:none;width:14px;height:14px;margin:0;accent-color:var(--accent)' });
    cb.checked = picked.has(u.obj);
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) picked.add(u.obj); else picked.delete(u.obj);
      updateCount();
    });
    const extra = [];
    for (const [k, v] of Object.entries(u.props)) if (k !== 'unit' && k !== 'team') extra.push(`${k}=${v}`);
    const rot = u.obj.attrs && u.obj.attrs.rotation;
    if (rot !== undefined && rot !== '') extra.push(`rot=${rot}`);
    const copyOne = h('button', {
      title: '复制这个单位的属性（不含 unit / team）',
      style: 'flex:none;padding:1px 6px;font-size:11.5px',
      onclick: (e) => { e.stopPropagation(); copyPropsOf(u); },
    }, '复制属性');
    const row = h('div', {
      class: 'uprow',
      style: 'display:flex;gap:6px;align-items:center;padding:3px 6px;border-bottom:1px solid var(--line);cursor:pointer',
      title: '点一下在地图上定位',
    },
    cb,
    h('span', { class: 'teamdot', style: `background:${teamColor(u.team === null ? -1 : u.team)}` }),
    h('span', { style: 'font-weight:600;white-space:nowrap' }, UNIT_CN[u.unit] || u.unit),
    h('span', { style: 'font-size:12px;white-space:nowrap' }, teamName(u.team)),
    h('span', { style: 'color:var(--dim);font-size:11.5px;white-space:nowrap' }, `格 ${u.tileX},${u.tileY}`),
    h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:11.5px' },
      extra.join(' ') || '—'),
    copyOne);
    row.addEventListener('click', (e) => {
      if (e.target === cb || (e.target.tagName === 'BUTTON')) return;
      jumpTo(u);
    });
    return row;
  }

  function renderList() {
    const live = new Set(data.map((u) => u.obj));
    for (const o of [...picked]) if (!live.has(o)) picked.delete(o);
    const rows = filtered();
    curRows = rows;
    const shown = rows.slice(0, LIST_CAP);
    listEl.innerHTML = '';
    if (!shown.length) {
      listEl.append(h('div', { class: 'hint', style: 'margin:6px' },
        data.length ? '没有符合条件的单位。试试清空搜索或换筛选条件。' : '地图里还没有单位。先用“单位”工具放一些，或者打开一张有单位的地图。'));
    }
    for (const u of shown) listEl.append(makeRow(u));
    updateCount();
  }

  function updateCount() {
    const n = filtered().length;
    let s = `共 ${data.length} 个单位 / 选中 ${picked.size} 个`;
    if (st.q.trim() || st.team !== 'all' || st.type !== 'all') s += `（筛选出 ${n} 个）`;
    if (n > LIST_CAP) s += ` · 列表只显示前 ${LIST_CAP} 个，用搜索或筛选缩小范围`;
    countEl.textContent = s;
  }

  function refreshAll() {
    data = allUnits(ed);
    const live = new Set(data.map((u) => u.obj));
    for (const o of [...picked]) if (!live.has(o)) picked.delete(o);
    fillFilters();
    renderList();
  }

  const pickedUnits = () => {
    const live = new Set(data.map((u) => u.obj));
    return data.filter((u) => picked.has(u.obj) && live.has(u.obj));
  };

  function selectFiltered() { for (const u of curRows) picked.add(u.obj); renderList(); }
  function invertFiltered() {
    for (const u of curRows) { if (picked.has(u.obj)) picked.delete(u.obj); else picked.add(u.obj); }
    renderList();
  }

  function jumpTo(u) {
    const z = Math.max(rend.view.z, 0.7);
    ed.selected = u.obj;
    ed.tool.units = 'select';
    closeModal(); // 和应用里其它“去看看”一致：先关窗口再看地图
    rend.centerOn(u.tileX, u.tileY, z);
    rend.request();
    A.refresh('toolbar', 'dock');
    toast(`已定位：${teamName(u.team)} · ${UNIT_CN[u.unit] || u.unit}（格 ${u.tileX}, ${u.tileY}）`);
  }

  // ---------- 批量操作 ----------
  function copyPropsOf(u) {
    const props = {};
    for (const [k, v] of Object.entries(u.props)) if (k !== 'unit' && k !== 'team') props[k] = v;
    const n = Object.keys(props).length;
    st.clip = { from: `${UNIT_CN[u.unit] || u.unit} · ${teamName(u.team)} · 格 ${u.tileX},${u.tileY}`, props };
    clipEl.textContent = n
      ? `已复制 ${n} 个属性（来自 ${st.clip.from}）：${Object.entries(props).map(([k, v]) => `${k}=${v}`).join('、')}`
      : `「${st.clip.from}」除了 unit / team 没有其它属性可复制。`;
    pasteBtn.disabled = !n;
    toast(n ? `已复制 ${n} 个属性` : '这个单位没有可复制的属性');
  }

  async function pasteProps() {
    if (!st.clip || !Object.keys(st.clip.props).length) { toast('先点单位右边的“复制属性”'); return; }
    const units = pickedUnits();
    if (!units.length) { toast('先勾选要粘贴到的单位'); return; }
    const names = Object.keys(st.clip.props);
    const okd = await confirmBox('粘贴属性？',
      `把 ${names.length} 个属性（${names.join('、')}）写到选中的 ${units.length} 个单位上。可以一步撤销。`, '粘贴');
    if (!okd) return;
    const n = applyUnitEdits(ed, units.map((u) => ({ group: u.group, obj: u.obj, set: { props: { ...st.clip.props } } })));
    if (!n) { toast('这些单位本来就是这个值'); return; }
    refreshAll();
    afterEdit(rend, `已给 ${n} 个单位粘贴属性`);
  }

  async function apply() {
    const units = pickedUnits();
    if (!units.length) { toast('先在列表里勾选要改的单位'); return; }
    const tv = teamInput.value;
    const rot = rotInp.value.trim();
    const props = collectProps();
    if (tv === '' && rot === '' && !props.length) {
      toast('还没有要改的内容：选个队伍、填旋转角度，或加一个属性');
      return;
    }
    if (rot !== '' && !/^-?\d+(\.\d+)?$/.test(rot)) { toast('旋转角度要填数字'); return; }
    const what = [];
    if (tv !== '') what.push(`队伍 → ${teamName(+tv)}`);
    if (rot !== '') what.push(`旋转角度 → ${rot}`);
    if (props.length) what.push(`属性：${props.map((p) => (p.value === null ? `删除 ${p.name}` : `${p.name}=${p.value}`)).join('、')}`);
    const okd = await confirmBox('应用单位属性修改？',
      `将修改选中的 ${units.length} 个单位：${what.join('；')}。可以一步撤销。`, '应用修改');
    if (!okd) return;
    const propObj = {};
    for (const p of props) propObj[p.name] = p.value; // 同名属性后者覆盖前者
    const edits = units.map((u) => {
      const set = {};
      if (rot !== '') set.attrs = { rotation: rot };
      if (props.length) set.props = { ...propObj };
      const e = { group: u.group, obj: u.obj, set };
      if (tv !== '') e.team = +tv;
      return e;
    });
    const n = applyUnitEdits(ed, edits);
    if (!n) { toast('没有实际改动'); return; }
    teamInput.value = ''; rotInp.value = ''; clearProps();
    refreshAll();
    afterEdit(rend, `已修改 ${n} 个单位`);
  }

  async function delUnits() {
    const units = pickedUnits();
    if (!units.length) { toast('先勾选要删除的单位'); return; }
    const okd = await confirmBox('删除选中的单位？',
      `将删除 ${units.length} 个单位（只删勾选的，不会自动带走旁边的建造者）。可以一步撤销。`, '删除', '取消', true);
    if (!okd) return;
    const groups = new Set(units.map((u) => u.group));
    const gone = new Set(units.map((u) => u.obj));
    ed.begin('删除单位');
    for (const g of groups) ed.op.snapshotGroup(g);
    const diffs = [...groups].map((g) => [g, g.objects]);
    let n = 0;
    for (const [g, was] of diffs) {
      const before0 = was.length;
      g.objects = g.objects.filter((o) => !gone.has(o));
      n += before0 - g.objects.length;
      ed.op.noteDiff(was, g.objects);
    }
    ed.commit();
    if (!n) { toast('没有删掉任何单位'); return; }
    picked.clear();
    if (ed.selected && gone.has(ed.selected)) ed.selected = null;   // 别让选中框指着一个不存在的单位
    refreshAll();
    afterEdit(rend, `已删除 ${n} 个单位`);
  }

  function copyUnits() {
    const units = pickedUnits();
    if (!units.length) { toast('先勾选要复制的单位'); return; }
    const groups = new Set(units.map((u) => u.group));
    ed.begin('复制单位');
    for (const g of groups) ed.op.snapshotGroup(g);
    const copies = [];
    const diffs = [...groups].map((g) => [g, g.objects.slice()]);
    for (const u of units) {
      const o = u.obj;
      const c = { attrs: { ...o.attrs }, props: (o.props || []).map((p) => ({ ...p })), extra: o.extra };
      // 贴右下边缘时夹回地图内，免得副本落到图外（游戏里看不到）
      const mw = (ed.map.width || 0) * TW, mh = (ed.map.height || 0) * TW;
      const nx = +(o.attrs.x || 0) + TW, ny = +(o.attrs.y || 0) + TW;
      c.attrs.x = String(mw ? Math.max(0, Math.min(nx, mw - +(c.attrs.width || TW))) : nx);
      c.attrs.y = String(mh ? Math.max(0, Math.min(ny, mh)) : ny);
      delete c.attrs.id; // 不沿用 id，保存时由 nextobjectid 重新编号
      u.group.objects.push(c);
      copies.push(c);
    }
    for (const [g, was] of diffs) ed.op.noteDiff(was, g.objects);
    ed.commit();
    // 复制后勾选新副本，方便接着改
    picked.clear();
    for (const c of copies) picked.add(c);
    refreshAll();
    afterEdit(rend, `已复制 ${copies.length} 个单位（原位置右下方 1 格）`);
  }

  // ---------- 初始渲染 + 监听地图变化 ----------
  fillFilters();
  renderList();

  const onEv = (ev) => {
    if (!ed.map) { closeModal(); return; }
    // 撤销 / 重做会把对象整体换成新实例；换地图则整张重来
    if (ev === 'map' || (ev && ev.type === 'changed')) refreshAll();
  };
  dialogOpen = true;
  ed.on(onEv);
  try {
    await modal('单位属性编辑', body, [{ label: '关闭', value: 1, primary: true }], { wide: true });
  } finally {
    dialogOpen = false;
    ed.listeners.delete(onEv);
  }
}
