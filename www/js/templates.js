// 触发器模板库：选模板 → 填参数 → 预览 → 一步加进地图
// 导出：TEMPLATES / buildTemplate(tpl, params, anchor) / insertTemplate(tpl, params, anchor) / templateDialog()
import { A } from './state.js';
import { h, modal, toast, select } from './ui.js';
import { HELP } from './help.js';
import { makeTrigger, trigGroup, selectTrigger, pickOnMap, describe } from './triggers.js';
import { teamColor } from './render.js';

const ed = A.ed;
const TW = 20;

// ---------------- 小工具 ----------------
const lc = (s) => String(s || '').trim().toLowerCase();
const idOf = (o) => {
  const p = (o.props || []).find((x) => x.name === 'id');
  return (p && p.value) || o.attrs.name || '';
};
function takenIds(T) {
  const s = new Set();
  for (const o of (T ? T.objects : [])) s.add(lc(idOf(o)));
  return s;
}
function nTeams() { try { return Math.max(1, Math.max(-1, ...ed.usedTeams()) + 1); } catch (e) { return 2; } }
function teamOptions(withNeutral = true) {
  const out = [];
  if (withNeutral) out.push(['-2', '敌对中立（野怪 / 敌人）'], ['-1', '中立（谁都不属于）']);
  for (let k = 0; k < nTeams(); k++) out.push([String(k), `第 ${k + 1} 队`]);
  return out;
}

// 单位下拉（游戏里认的就是这些英文名）
const UNITS = [['tank', '坦克 tank'], ['heavyTank', '重型坦克 heavyTank'], ['mechGun', '机甲 mechGun'], ['builder', '建造者 builder'],
  ['turret', '炮塔 turret'], ['supplyDepot', '补给站 supplyDepot'], ['commandCenter', '指挥中心 commandCenter'], ['c_tank', '虫族坦克 c_tank']];

// 参数声明的小助手
const P_TEAM = (key, cn, def = -2, hint) => ({ key, cn, type: 'team', def, hint });
const P_NUM = (key, cn, def, min = 0, max = 3600, hint) => ({ key, cn, type: 'number', def, min, max, hint });
const P_TXT = (key, cn, def = '', hint) => ({ key, cn, type: 'text', def, hint });
const P_SEL = (key, cn, options, def, hint) => ({ key, cn, type: 'select', options, def, hint });
const P_MSG = (cn = '作战日志里说一句', def = '') => P_TXT('msg', cn, def, '留空就不播报');

// ---------------- 模板清单 ----------------
export const TEMPLATES = [
  {
    id: 'wave', cn: '定时刷兵', area: { w: 3, h: 3 },
    desc: '开局第 N 秒在这里刷一批兵，之后每隔 M 秒再刷一批（间隔填 0 就只刷一次）。最常用的“敌人来袭”。',
    params: [P_TEAM('team', '给哪个队刷', -2), P_SEL('unit', '刷什么单位', UNITS, 'tank'), P_NUM('count', '一次刷几个', 3, 1, 50),
      P_NUM('first', '开局后第几秒刷第一批', 60, 0, 3600), P_NUM('interval', '之后每隔几秒再刷一批', 90, 0, 3600), P_MSG('作战日志里说一句', '敌人来袭！')],
    build(P) {
      return [{ type: 'unitAdd', idBase: `刷兵${P.team >= 0 ? P.team + 1 : ''}`, props: {
        team: P.team, delay: `${P.first}s`, repeatDelay: P.interval > 0 ? `${P.interval}s` : undefined,
        spawnUnits: `${P.unit}*${P.count}`, globalMessage: P.msg,
        globalMessage_textColor: P.team < 0 ? 'yellow' : teamColor(P.team),
      } }];
    },
  },
  {
    id: 'killReward', cn: '击杀奖励（清场给钱）', area: { w: 6, h: 6 },
    desc: '区域里先出现敌人、后来被清空时，给指定队伍加钱。一开始就是空的不会触发（先用“单位检测”把门打开）。',
    params: [P_TEAM('team', '钱给哪个队', 0), P_TEAM('foe', '清谁的单位', -2), P_NUM('credits', '给多少钱', 300, 1, 99999), P_NUM('again', '之后每隔几秒还能再领一次（0=只领一次）', 0, 0, 3600)],
    build(P) {
      const again = P.again > 0 ? `${P.again}s` : undefined;
      return [
        { type: 'unitDetect', idBase: '这里有敌人', ref: 'have', props: { team: P.foe, minUnits: 1, comment: '区域里出现了敌方单位' } },
        { type: 'unitDetect', idBase: '已经清空', ref: 'clear', props: { team: P.foe, maxUnits: 0, activatedBy: '@have', resetActivationAfter: again, comment: '敌人被打光了' } },
        { type: 'changeCredits', idBase: '清场奖励', props: { team: P.team, add: P.credits, activatedBy: '@clear' } },
      ];
    },
  },
  {
    id: 'captureWin', cn: '占点胜利', area: { w: 4, h: 4 },
    desc: '指定队伍在这个区域里放建筑、连续守住 N 秒就算完成一个任务目标。需要地图胜利条件 =「完成所有任务目标」。',
    params: [P_TEAM('team', '哪一队占', 0), P_NUM('hold', '守满几秒算占领', 10, 0, 600), P_TXT('text', '目标文字', '占领据点'),
      P_SEL('win', '顺便把地图胜利条件设成', [['1', '完成所有任务目标'], ['0', '不动（我自己设）']], '1')],
    build(P) {
      const out = [
        { type: 'unitDetect', idBase: '占点条件', ref: 'd', props: { team: P.team, onlyBuildings: 'true', minUnits: 1, warmup: `${P.hold}s` } },
        { type: 'objective', idBase: '目标', props: { text: P.text, activatedBy: '@d', globalMessage: `完成：${P.text}` } },
      ];
      if (P.win === '1') out.push({ mi: true, props: { type: 'mission', winCondition: 'requiredObjectives' } });
      return out;
    },
  },
  {
    id: 'survive', cn: '存活 N 分钟胜利', area: { w: 2, h: 2 },
    desc: '开局起算，撑到第 N 分钟就完成目标（生存图 / 限时防守）。需要地图胜利条件 =「完成所有任务目标」。',
    params: [P_NUM('minutes', '撑几分钟', 5, 1, 120), P_TXT('text', '目标文字', '坚守 5 分钟'),
      P_SEL('win', '顺便把地图胜利条件设成', [['1', '完成所有任务目标'], ['0', '不动（我自己设）']], '1')],
    build(P) {
      const out = [
        { type: 'basic', idBase: '计时', ref: 'd', props: { delay: `${Math.round(P.minutes * 60)}s`, comment: `开局后 ${P.minutes} 分钟` } },
        { type: 'objective', idBase: '目标', props: { text: P.text, activatedBy: '@d', globalMessage: `完成：${P.text}` } },
      ];
      if (P.win === '1') out.push({ mi: true, props: { type: 'survival', winCondition: 'requiredObjectives' } });
      return out;
    },
  },
  {
    id: 'startCredits', cn: '开局送资源', area: { w: 2, h: 2 },
    desc: '开局给某队一笔钱（team_info 只在开局生效一次，中途改钱请用“改资金”触发器）。',
    params: [P_TEAM('team', '哪一队', 0), P_NUM('credits', '开局资金', 4000, 0, 99999)],
    build(P) { return [{ type: 'team_info', idBase: `队伍设置${P.team + 1}`, props: { team: P.team, credits: P.credits } }]; },
  },
  {
    id: 'zoneHint', cn: '到达区域提示', area: { w: 6, h: 6 },
    desc: '某队的单位走进这片区域时，弹一句话（作战日志 + 可选地图文字）。',
    params: [P_TEAM('team', '哪一队的单位', 0), P_TXT('msg', '提示内容', '你发现了一个秘密地点！'),
      P_SEL('once', '触发次数', [['1', '只提示一次'], ['0', '每次进入都提示']], '1'), P_NUM('gap', '重复提示的间隔（秒）', 15, 1, 600)],
    build(P) {
      return [{ type: 'unitDetect', idBase: '进入区域', props: { team: P.team, minUnits: 1, globalMessage: P.msg, resetActivationAfter: P.once === '1' ? undefined : `${P.gap}s` } }];
    },
  },
  {
    id: 'loseCC', cn: '指挥中心被毁（提示）', area: { w: 3, h: 3 },
    desc: '某队的指挥中心没了就播报 + 在地图上打一行字。注意：引擎没有“直接判负”的动作，真正的胜负靠地图胜利条件，这里只负责提示。',
    params: [P_TEAM('team', '谁的指挥中心', 0), P_TXT('msg', '提示内容', '指挥中心被摧毁了！'), P_TXT('text', '地图上的字（留空不显示）', '')],
    build(P) {
      const out = [{ type: 'unitDetect', idBase: '指挥中心', ref: 'd', props: { team: P.team, unitType: 'commandCenter', maxUnits: 0, globalMessage: P.msg } }];
      if (P.text) out.push({ type: 'mapText', idBase: '失败文字', props: { text: P.text, textColor: '#e5484d', textSize: 24, activatedBy: '@d' } });
      return out;
    },
  },
  {
    id: 'portal', cn: '传送门', area: { w: 2, h: 2 },
    desc: '单位走进上面这片小区域，就被送到下面另一片区域，并刷出指定数量。间隔后可以再用。',
    params: [P_TEAM('team', '哪一队的单位', 0), P_SEL('unit', '刷出来的单位', UNITS, 'tank'), P_NUM('count', '送过去几个', 2, 1, 30),
      P_NUM('dist', '出口在入口下方几格', 8, 3, 60), P_NUM('gap', '冷却（秒）', 3, 1, 120)],
    build(P) {
      const d = P.dist;
      return [
        { type: 'unitDetect', idBase: '走进传送门', ref: 'd', props: { team: P.team, minUnits: 1, resetActivationAfter: `${P.gap}s`, comment: '有单位进来了就触发' } },
        { type: 'unitRemove', idBase: '传送门收回', props: { team: P.team, activatedBy: '@d', comment: '把入口区域里的单位收掉' } },
        { type: 'unitAdd', idBase: '传送门放出', props: { team: P.team, spawnUnits: `${P.unit}*${P.count}`, activatedBy: '@d', comment: '在出口刷出来' }, rect: { dx: 0, dy: d, w: 2, h: 2 } },
      ];
    },
  },
  {
    id: 'captureReward', cn: '占点奖励（钱 + 播报）', area: { w: 4, h: 4 },
    desc: '某队用建筑占住这里，就给钱、加一句地图文字、并完成一个任务目标。',
    params: [P_TEAM('team', '哪一队占', 0), P_NUM('credits', '给多少钱', 500, 1, 99999), P_NUM('interval', '每隔几秒再给一次（0=只给一次）', 20, 0, 600),
      P_TXT('text', '地图上的字', '据点'), P_TXT('msg', '作战日志', '')],
    build(P) {
      const out = [{ type: 'unitDetect', idBase: '占领判定', ref: 'd', props: { team: P.team, onlyBuildings: 'true', minUnits: 1, resetActivationAfter: P.interval > 0 ? `${P.interval}s` : '1s', globalMessage: P.msg } }];
      out.push({ type: 'changeCredits', idBase: '占点奖励', props: { team: P.team, add: P.credits, activatedBy: '@d' } });
      if (P.text) out.push({ type: 'mapText', idBase: '据点文字', props: { text: P.text, textSize: 20, style: 'arrow', textColor: '#ffd34d', activatedBy: '@d', resetActivationAfter: '1s' } });
      return out;
    },
  },
  {
    id: 'income', cn: '占点收入（持续给钱）', area: { w: 4, h: 4 },
    desc: '谁用建筑占住这里，就按间隔一直给谁加钱（每个队一条触发器）。',
    params: [P_NUM('amount', '每次给多少钱', 5, 1, 9999), P_NUM('interval', '每隔几秒给一次', 2, 1, 120),
      P_SEL('all', '给哪些队都建一条', [['1', '所有队伍都建'], ['0', '只建一条（我之后改队伍）']], '1')],
    build(P) {
      const out = [];
      const list = P.all === '1' ? Array.from({ length: nTeams() }, (_, k) => k) : [0];
      for (const k of list) {
        const ref = `own${k}`;
        out.push({ type: 'unitDetect', idBase: `占点${k + 1}`, ref, props: { team: k, onlyBuildings: 'true', minUnits: 1, resetActivationAfter: '1s' } });
        out.push({ type: 'changeCredits', idBase: `收入${k + 1}`, props: { team: k, add: P.amount, activatedBy: `@${ref}`, resetActivationAfter: `${P.interval}s` } });
      }
      return out;
    },
  },
  {
    id: 'countdown', cn: '倒计时播报', area: { w: 2, h: 2 },
    desc: '开局后每隔一段时间在作战日志里报一次“还剩 N 分钟”，最后再报一次时间到。',
    params: [P_NUM('minutes', '总共几分钟', 5, 1, 60), P_NUM('step', '每隔几分钟报一次', 1, 1, 30)],
    build(P) {
      const out = [];
      const total = Math.max(1, P.minutes), step = Math.max(1, P.step);
      const marks = [];
      for (let m = total; m >= step && marks.length < 6; m -= step) marks.push(m);
      for (const m of marks) out.push({ type: 'basic', idBase: `倒计时${m}分`, props: { delay: `${(total - m) * 60}s`, globalMessage: m === total ? `还剩 ${m} 分钟` : `还剩 ${m} 分钟！`, globalMessage_textColor: 'yellow' } });
      out.push({ type: 'basic', idBase: '时间到', props: { delay: `${total * 60}s`, globalMessage: '时间到！', globalMessage_textColor: 'green' } });
      return out.slice(0, 7);
    },
  },
  {
    id: 'campRespawn', cn: '野怪营地重刷', area: { w: 5, h: 5 },
    desc: '这片区域被清空后，过几秒把守军重新刷出来（中立野怪营地）。',
    params: [P_SEL('unit', '守军单位', UNITS, 'tank'), P_NUM('count', '一次刷几个', 2, 1, 20), P_NUM('gap', '清空后几秒重刷', 30, 1, 600), P_NUM('delay', '开局后几秒才开始算', 5, 0, 600)],
    build(P) {
      return [
        { type: 'unitDetect', idBase: '营地清空', ref: 'd', props: { team: -2, maxUnits: 0, warmup: `${P.delay}s`, resetActivationAfter: `${P.gap}s` } },
        { type: 'unitAdd', idBase: '营地守军', props: { team: -2, spawnUnits: `${P.unit}*${P.count}`, activatedBy: '@d', resetActivationAfter: `${P.gap}s` } },
      ];
    },
  },
];

const byId = (t) => (typeof t === 'string' ? TEMPLATES.find((x) => x.id === t) : t);

// ---------------- 生成对象（不落地，允许拿来预览） ----------------
function rectOf(it, anchor, tpl) {
  const a = it.rect || {};
  const w = a.w || (tpl.area && tpl.area.w) || 3, hh = a.h || (tpl.area && tpl.area.h) || 3;
  const x = (anchor.tx + (a.dx || 0)) * TW, y = (anchor.ty + (a.dy || 0)) * TW;
  return { x, y, w: w * TW, h: hh * TW };
}

// 传 [x, y] 或 {tx, ty} 都行；返回 { objs:[触发器], mi:map_info 属性|null }
export function buildTemplate(tpl, params = {}, anchor = { tx: 10, ty: 10 }) {
  const t = byId(tpl);
  if (!t) return { objs: [], mi: null };
  const P = {};
  for (const p of t.params) {
    let v = params[p.key];
    if (v === undefined || v === '') v = p.def;
    P[p.key] = p.type === 'number' || p.type === 'team' ? Math.round(Number(v) || 0) : String(v);
  }
  const T = trigGroup(true);
  const taken = takenIds(T);
  const items = t.build(P);
  const made = [];
  const refs = new Map();
  let mi = null;
  for (const it of items) {
    if (it.mi) { mi = Object.assign(mi || {}, it.props); continue; }
    const o = makeTrigger(it.type, rectOf(it, anchor, t), {}, it.idBase || t.cn, taken);
    o.props = o.props.filter((p) => p.name === 'id');   // 只留 id，其余属性下面统一填
    if (it.ref) refs.set(it.ref, idOf(o));
    made.push({ it, o });
  }
  for (const { it, o } of made) {
    for (const [k, v] of Object.entries(it.props || {})) {
      if (v === undefined || v === null || v === '') continue;
      const val = typeof v === 'string' ? v.replace(/@([A-Za-z0-9_]+)/g, (m, r) => refs.get(r) || m) : v;
      o.props.push({ name: k, value: String(val) });
    }
  }
  return { objs: made.map((m) => m.o), mi };
}

// ---------------- 加进地图（一步撤销） ----------------
export function insertTemplate(tpl, params = {}, anchor = { tx: 10, ty: 10 }) {
  const t = byId(tpl);
  const T = trigGroup(true);
  if (!t || !T) { toast('先打开地图'); return []; }
  const { objs, mi } = buildTemplate(t, params, anchor);
  if (!objs.length && !mi) return [];
  ed.beginWhole(`加入触发器模板：${t.cn}`);
  if (mi) {
    // 不能用 ed.setMapInfoProp：它内部还会 begin/commit 一次，会把这一步撤销劈成两半
    let m = T.objects.find((o) => lc(o.attrs.name) === 'map_info');
    if (!m) {
      m = { attrs: { name: 'map_info', x: '0', y: '0', width: '20', height: '20' }, props: [{ name: 'type', value: 'skirmish' }], extra: [] };
      T.objects.push(m);
    }
    for (const [k, v] of Object.entries(mi)) {
      const p = m.props.find((x) => x.name === k);
      if (p) p.value = String(v); else m.props.push({ name: k, value: String(v) });
    }
  }
  for (const o of objs) T.objects.push(o);
  ed.commit();
  A.autoDirty = true;
  A.rend.request();
  A.refresh('top', 'dock');
  if (objs[0]) selectTrigger(objs[0], false);
  return objs;
}

// ---------------- 对话框 ----------------
// pickOnMap 要在真实地图上点，但 .modal 铺满屏幕会挡住点击 —— 选位置时先把弹窗藏起来，选完（或取消）再放回去
async function pickHidingModal(msg) {
  const el = document.querySelector('.modal');
  if (el) el.style.visibility = 'hidden';
  try {
    return await pickOnMap(msg);
  } finally {
    if (el) el.style.visibility = '';
  }
}

export function templateDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  let cur = TEMPLATES[0];
  const vals = {};                 // 模板 id → 参数表
  const paramsOf = (t) => {
    if (!vals[t.id]) { vals[t.id] = {}; for (const p of t.params) vals[t.id][p.key] = p.def; }
    return vals[t.id];
  };

  const list = h('div', { style: 'display:flex;flex-direction:column;gap:4px;min-width:150px;max-height:56vh;overflow:auto' });
  const head = h('div', { style: 'font-size:15px;font-weight:600;margin-bottom:2px' });
  const desc = h('div', { style: 'font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:8px' });
  const form = h('div', { class: 'grid2', style: 'gap:8px 12px' });
  const pv = h('div', { style: 'margin-top:10px;border-top:1px solid var(--line,#2a2f3a);padding-top:8px' });
  const tipRow = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.7' });

  const drawList = () => {
    list.replaceChildren();
    for (const t of TEMPLATES) {
      const on = t === cur;
      list.append(h('button', {
        style: `text-align:left;padding:6px 9px;border-radius:7px;${on ? 'border-color:var(--accent);background:var(--bg4)' : ''}`,
        onclick: () => { cur = t; drawList(); drawForm(); },
      }, t.cn));
    }
  };

  const drawPreview = () => {
    const anchor = { tx: Math.max(0, Math.floor(ed.map.width / 2)), ty: Math.max(0, Math.floor(ed.map.height / 2)) };
    const r = buildTemplate(cur, paramsOf(cur), anchor);
    const where = cur.area ? '点「加入地图」后在地图上点一下，区域就放在那里' : '点「加入地图」后在地图上点一下，触发器图标就放在那里';
    pv.replaceChildren(h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:4px' }, `会生成 ${r.objs.length + (r.mi ? 1 : 0)} 项（${where}）：`));
    for (const o of r.objs) pv.append(h('div', { class: 'tsentence', style: 'margin:3px 0;font-size:12.5px', html: describe(o) }));
    if (r.mi) pv.append(h('div', { style: 'font-size:12px;color:#d29922;margin-top:4px' }, `顺带改 map_info：${Object.entries(r.mi).map(([k, v]) => `${k}=${v}`).join('，')}`));
  };

  const drawForm = () => {
    head.textContent = cur.cn;
    desc.textContent = cur.desc;
    form.replaceChildren();
    const P = paramsOf(cur);
    for (const p of cur.params) {
      const cell = h('div', {});
      cell.append(h('label', { style: 'font-size:12px;color:var(--muted);display:block;margin-bottom:2px' }, p.cn));
      let inp;
      if (p.type === 'number') {
        inp = h('input', { type: 'number', min: p.min, max: p.max, value: P[p.key], oninput: (e) => { P[p.key] = e.target.value; drawPreview(); } });
      } else if (p.type === 'team') {
        inp = select(teamOptions(), String(P[p.key]), (v) => { P[p.key] = +v; drawPreview(); });
      } else if (p.type === 'select') {
        inp = select(p.options, String(P[p.key]), (v) => { P[p.key] = v; drawPreview(); });
      } else {
        inp = h('input', { value: P[p.key], oninput: (e) => { P[p.key] = e.target.value; drawPreview(); } });
      }
      cell.append(inp);
      if (p.hint) cell.append(h('div', { style: 'font-size:11.5px;color:var(--muted);margin-top:2px' }, p.hint));
      form.append(cell);
    }
    tipRow.textContent = '「加入地图」之后按 Esc / 右键取消选位置，不会改地图。';
    drawPreview();
  };

  drawList(); drawForm();

  const body = h('div', { style: 'display:flex;gap:14px;align-items:flex-start' },
    h('div', { style: 'flex:0 0 auto;display:flex;flex-direction:column;gap:3px' },
      h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:2px' }, '模板'), list),
    h('div', { style: 'flex:1;min-width:0' }, head, desc, form, tipRow, pv));

  return modal('触发器模板库', body, [
    { label: '关闭', value: 0 },
    { label: '加入地图', value: 1, primary: true, check: async () => {
      const pt = await pickHidingModal('点地图，放置「' + cur.cn + '」的区域');
      if (!pt) { toast('没选位置，什么都没改'); return false; }
      const made = insertTemplate(cur, paramsOf(cur), pt);
      toast(`已加入「${cur.cn}」：${made.length} 个触发器（Ctrl+Z 一步撤销）`, 3600);
      A.hooks.coach && A.hooks.coach('trig:template');
      tipRow.textContent = `已加入「${cur.cn}」${made.length} 个触发器。可以接着换模板再加，点「关闭」结束。`;
      return false;   // 不关窗：方便一口气放好几个
    } },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.templates': {
    t: '触发器模板库',
    s: '刷兵、占点、传送门这些常用玩法，填几个数就有',
    b: '左边选模板，右边填参数，下面会实时显示<b>会生成哪些触发器</b>（和触发器面板里的白话描述一样）。点「加入地图」再在地图上点一下，就会把这片区域放上去；<b>整批触发器算一步撤销</b>，Ctrl+Z 一次全撤掉。',
    tips: ['模板只是起点，加进去之后每个触发器都能照常手改。', '「占点胜利」「存活 N 分钟」会顺带把 map_info 的胜利条件改成“完成所有任务目标”，不想要就在参数里选“不动”。', '传送门会收走<b>该队</b>进入区域的单位（引擎没有“只传送某兵种”的写法），所以别把别的兵种放在入口。'],
  },
});
