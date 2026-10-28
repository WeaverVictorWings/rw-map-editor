// map_info 表单：把游戏认的每个字段做成带说明的表单，选错直接说清楚
// map_info 是 Triggers 层里名为 map_info 的对象，游戏靠它的属性决定对局规则
import { A } from './state.js';
import { h, modal, toast, select } from './ui.js';
import { HELP } from './help.js';
import { setObjProp } from './tmx.js';
import { MAP_TYPES } from './check.js';

const ed = A.ed;

// 每个字段：name = 写进 TMX 的属性名；kind 决定控件；val = 常见取值
export const FIELDS = [
  {
    name: 'type', cn: '地图类型', kind: 'select', def: 'skirmish',
    val: MAP_TYPES,
    cnOf: { skirmish: '遭遇战', mission: '任务', challenge: '挑战', survival: '生存', endless: '无尽' },
    desc: '决定游戏用哪套对局规则。做普通联机对决选「遭遇战」。',
  },
  {
    name: 'winCondition', cn: '胜利条件', kind: 'select',
    val: ['', 'destroyAll', 'requiredObjectives', 'timeLimit'],
    cnOf: { '': '（不指定，用默认）', destroyAll: '消灭所有敌人', requiredObjectives: '完成所有任务目标', timeLimit: '限时' },
    desc: '选「完成所有任务目标」时，地图里必须真的有任务目标触发器，否则这局永远结束不了。',
  },
  {
    name: 'title', cn: '地图标题', kind: 'text',
    desc: '部分游戏版本会显示在对局界面。中文一般写在地图名里就行，这里可留空。',
  },
  {
    name: 'author', cn: '作者', kind: 'text', desc: '可选，会显示在地图信息里。',
  },
  {
    name: 'credits', cn: '开局资金', kind: 'number', min: 0,
    desc: '所有队伍开局拿到的钱。不填就用游戏默认（通常 4000）。各队想不一样，用「队伍资金」触发器单独设。',
  },
  {
    name: 'startUnits', cn: '开局单位', kind: 'text',
    desc: '形如 tank*2, builder；留空表示用地图上摆好的单位。',
  },
];

export function mapInfoFields(ed2 = ed) {
  const mi = ed2.mapInfo();
  const out = {};
  if (!mi) return out;
  for (const p of mi.props) out[p.name] = p.value;
  return out;
}

// 一次性写多个字段：整体算一步撤销（不要循环调 setMapInfoProp，那样每改一格都是一步）
export function applyMapInfo(ed2, values) {
  const T = ed2.map && ed2.map.group('Triggers');
  const mi = ed2.mapInfo();
  if (!T || !mi) return 0;
  const live = T.objects.find((o) => (o.attrs.name || '').toLowerCase() === 'map_info');
  const before = JSON.stringify(live.props);
  ed2.begin('修改 map_info');
  ed2.op.snapshotGroup(T);
  let n = 0;
  for (const [k, v] of Object.entries(values)) {
    const cur = (live.props.find((p) => p.name === k) || {}).value;
    if (String(cur ?? '') === String(v ?? '')) continue;
    setObjProp(live, k, v === '' || v === null || v === undefined ? undefined : v);
    n++;
  }
  if (JSON.stringify(live.props) === before) {
    // 值没变就别留一步“什么都没有”的撤销——snapshotGroup 会让这步看起来不像空的
    ed2.op = null;
    return 0;
  }
  ed2.commit();
  return n;
  return n;
}

export function mapInfoDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const has = !!ed.mapInfo();
  const cur = mapInfoFields();
  const state = { type: cur.type || 'skirmish', winCondition: cur.winCondition || '' };
  const body = h('div', {});
  const info = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:10px;line-height:1.7' });

  if (!has) {
    body.append(h('div', {
      style: 'font-size:13px;padding:8px 10px;border-left:3px solid #f5c518;background:rgba(245,197,24,.08);margin-bottom:10px',
    }, '这张图还没有 map_info。点下面「保存」会自动补一个，type 默认是遭遇战。'));
  }

  for (const f of FIELDS) {
    const row = h('div', { class: 'row', style: 'gap:10px;align-items:center;margin:7px 0' });
    row.append(h('div', { style: 'width:88px;font-size:13px;flex:none' }, f.cn));
    let ctrl;
    if (f.kind === 'select') {
      ctrl = select(f.val, cur[f.name] ?? f.def ?? '', (v) => { state[f.name] = v; refresh(); },
        { style: 'flex:1' });
      // 给中文选项加标签
      if (f.cnOf) for (const opt of ctrl.options) {
        const l = f.cnOf[opt.value];
        if (l !== undefined) opt.textContent = opt.value === '' ? l : `${l}（${opt.value}）`;
      }
    } else {
      ctrl = h('input', {
        type: f.kind === 'number' ? 'number' : 'text',
        value: cur[f.name] ?? f.def ?? '',
        min: f.min !== undefined ? String(f.min) : undefined,
        style: 'flex:1',
        oninput: (e) => { state[f.name] = e.target.value; refresh(); },
      });
    }
    row.append(ctrl);
    body.append(row);
    body.append(h('div', { style: 'font-size:11px;color:var(--muted);margin:0 0 6px 98px' }, f.desc));
  }
  body.append(info);

  const refresh = () => {
    const msgs = [];
    if (state.type === 'survival') msgs.push('生存模式：Triggers 层里需要有名为 attack_point 的对象，敌人从那里刷出来。');
    if (state.winCondition === 'requiredObjectives') {
      const T = ed.map.group('Triggers');
      const hasObj = T && T.objects.some((o) => (o.attrs.type || '').toLowerCase() === 'objective');
      msgs.push(hasObj ? '已检测到任务目标触发器，没问题。' : '⚠ 选了「完成所有任务目标」但地图里还没有任务目标触发器，这局将永远结束不了。');
    }
    if (state.type && !MAP_TYPES.includes(state.type)) msgs.push(`⚠「${state.type}」不是常见取值，游戏可能不认。`);
    info.textContent = msgs.join('\n');
    info.style.whiteSpace = 'pre-line';
  };
  refresh();

  const save = () => {
    const values = {};
    for (const f of FIELDS) if (state[f.name] !== undefined) values[f.name] = state[f.name];
    const n = applyMapInfo(ed, values);
    toast(n ? `已更新 ${n} 个字段` : '没有改动');
  };

  return modal('map_info 表单（对局规则）', body, [
    { label: '取消', value: 0 },
    { label: '保存', value: 1, primary: true, check: save },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.mapinfo': {
    t: 'map_info 表单',
    s: '用表单改对局规则，不用手写属性',
    b: '菜单「地图」→「map_info 表单…」。map_info 决定这局用哪套规则：遭遇战还是任务、怎么算赢、开局给多少钱。每项下面都写了说明，选「完成所有任务目标」时会自动检查地图里有没有任务目标触发器。',
    tips: ['改完点「保存」自动补 map_info 并一步撤销。', '各队开局资金不同时，用触发器里的「队伍资金」单独设置。'],
  },
});
