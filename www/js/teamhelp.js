// 队伍与阵营助手：颜色表、队伍号检查、一键整理
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast, confirmBox } from './ui.js';

Object.assign(HELP, {
  'tool.teamhelp': { t: '队伍与阵营助手', s: '队伍颜色、队伍号检查、一键整理', b: '列出每个队伍有几个指挥中心、几个单位，并给队伍配色（跟游戏里接近，仅供参考）。检查：队伍号有没有空缺、有没有两队抢同一个号、有没有队伍只有单位没有指挥中心、是不是只有一个队。<b>一键整理</b>会把队伍号按顺序改成 0、1、2…，单位和触发器里的引用一起改，可以撤销。' },
});

const ed = A.ed;

// 铁锈战争里队伍号的常见配色（跟游戏内接近，仅供参考）
export const TEAM_COLORS = [
  ['#4a90e2', '蓝'], ['#e5484d', '红'], ['#36c25b', '绿'], ['#f5c518', '黄'],
  ['#a855f7', '紫'], ['#22d3ee', '青'], ['#fb923c', '橙'], ['#f472b6', '粉'],
  ['#94a3b8', '灰'], ['#a3e635', '青柠'],
];

export function teamInfo() {
  const spawns = ed.spawns();
  const byTeam = new Map();
  for (const s of spawns) {
    if (!byTeam.has(s.team)) byTeam.set(s.team, { team: s.team, spawns: 0, units: 0, x: 0, y: 0 });
    const e = byTeam.get(s.team);
    e.spawns++; e.x += s.cx; e.y += s.cy;
  }
  for (const { o } of ed.allObjects()) {
    const p = (o.props || []).find((x) => x.name === 'unit');
    if (!p) continue;
    const t = +(((o.props || []).find((x) => x.name === 'team') || {}).value ?? 0);
    if (!byTeam.has(t)) byTeam.set(t, { team: t, spawns: 0, units: 0, x: 0, y: 0 });
    byTeam.get(t).units++;
  }
  const list = [...byTeam.values()].sort((a, b) => a.team - b.team);
  for (const t of list) { t.color = TEAM_COLORS[t.team % TEAM_COLORS.length]; }
  return list;
}

// 找出队伍号的问题
export function teamIssues() {
  const list = teamInfo();
  const out = [];
  const nums = list.map((t) => t.team);
  if (!list.length) { out.push({ level: 'warn', text: '地图上还没有出生点' }); return out; }
  // 重复出生点
  const seen = new Map();
  for (const s of ed.spawns()) {
    const k = s.team;
    if (!seen.has(k)) seen.set(k, 1);
    else seen.set(k, seen.get(k) + 1);
  }
  const noSpawn = list.filter((t) => t.spawns === 0);
  if (noSpawn.length) out.push({ level: 'error', text: `第 ${noSpawn.map((t) => t.team).join('、')} 队有单位但没有出生点（指挥中心），游戏里可能不出现` });
  const dup = [...seen.entries()].filter(([, c]) => c > 1);
  if (dup.length) out.push({ level: 'error', text: `第 ${dup.map(([t, c]) => `${t} 队有 ${c} 个`).join('、')} 指挥中心，同一队应该有且只有一个` });
  const neg = list.filter((t) => t.team < 0);
  if (neg.length) out.push({ level: 'warn', text: `有负数队伍号（${neg.map((t) => t.team).join('、')}），负数通常代表中立或特殊阵营` });
  // 队伍号不连续
  const pos = nums.filter((n) => n >= 0);
  const max = pos.length ? Math.max(...pos) : -1;
  const missing = [];
  for (let i = 0; i <= max; i++) if (!pos.includes(i)) missing.push(i);
  if (missing.length) out.push({ level: 'warn', text: `队伍号不连续，缺 ${missing.join('、')}。建议整理成 0、1、2…`, fix: 'renumber' });
  else out.push({ level: 'ok', text: `队伍号是连续的：${pos.join('、')}` });
  // 没有敌人
  if (list.filter((t) => t.team >= 0).length < 2) out.push({ level: 'error', text: '只有一个队，没有对手，进游戏会立刻结束' });
  return out;
}

export function teamDialog() {
  if (!ed.map) return;
  const list = teamInfo();
  const issues = teamIssues();
  const color = { ok: 'var(--ok)', warn: 'var(--warn)', error: 'var(--err)' };
  const icon = { ok: '✓', warn: '!', error: '✕' };
  const body = h('div', {},
    h('h3', { style: 'font-size:14px;margin:0 0 8px' }, '队伍一览'),
    h('div', {}, ...list.map((t) => h('div', { class: 'hrow' },
      h('span', { style: `width:14px;height:14px;border-radius:3px;background:${t.color[0]};display:inline-block` }),
      h('span', {}, `第 ${t.team} 队（${t.color[1]}）`),
      h('span', { class: 'hint' }, `${t.spawns} 出生点 · ${t.units} 单位`),
      t.spawns ? h('button', {
        class: 'ib', title: '跳到出生点',
        onclick: () => A.rend.centerOn(t.x / 20 - 0.5, t.y / 20 - 0.5),
      }, '定位') : null))),
    h('h3', { style: 'font-size:14px;margin:14px 0 8px' }, '检查'),
    h('div', {}, ...issues.map((it) => h('div', { class: 'hrow' },
      h('span', { style: `color:${color[it.level]};font-weight:700;width:18px` }, icon[it.level]),
      h('span', {}, it.text)))));
  const buttons = [{ label: '关闭', value: 0, primary: true }];
  if (issues.some((i) => i.fix === 'renumber')) buttons.unshift({ label: '整理成 0、1、2…', value: 1 });
  return modal('队伍与阵营助手', body, buttons, { wide: true }).then(async (v) => {
    if (v === 1) {
      if (await confirmBox('整理队伍号？', '会把队伍号按顺序改成 0、1、2…，单位、出生点、触发器里的队伍引用一起改。', '整理', '取消')) {
        ed.beginWhole('整理队伍号');
        ed.renumberTeams();
        ed.commit();
        A.refresh();
        toast('队伍号已整理，可以撤销');
      }
    }
  });
}
