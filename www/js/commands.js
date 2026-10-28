// 指令一览：把这张图所有触发器的指令按类型分组列出来，查漏、查重复
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { HELP } from './help.js';
import { trigGroup, TYPES, SPECIAL, kindOf, defOf, label, tkey, CATS } from './triggers.js';

const ed = A.ed;

Object.assign(HELP, {
  'tool.commands': { t: '指令一览', s: '把这张图所有触发器的指令按类型分组列出来', b: '按<b>条件 / 动作 / 文字 / 设置</b>分组，列出每个触发器用了哪些指令、参数填了什么。用来查漏：比如忘了设胜利条件、某个区域没有检测、同一个动作写了两遍。点一条能跳到对应的触发器。' },
});

// 汇总所有触发器里出现的指令
export function commandStats(ed2 = ed) {
  const g = ed2.map && ed2.map.group('Triggers');
  const rows = [];   // { kind, cn, cat, trig, detail }
  const byKind = new Map();
  for (const o of (g ? g.objects : [])) {
    const k = kindOf(o);
    const d = defOf(o) || (k === 'map_info' ? { cn: '地图类型', cat: 'special' } : null);
    if (!k || !d) continue;
    const color = CATS[d.cat] ? CATS[d.cat].cn : '其它';
    const item = { kind: k, cn: d.cn || k, cat: color, trig: label(o), id: tkey(o), obj: o };
    rows.push(item);
    byKind.set(k, (byKind.get(k) || 0) + 1);
  }
  const byCat = new Map();
  for (const r of rows) {
    if (!byCat.has(r.cat)) byCat.set(r.cat, []);
    byCat.get(r.cat).push(r);
  }
  // 找重复：同一个触发器同一种指令出现多次（只对不该重复的类型提示）
  const dupAcross = [];
  const seen = new Map();
  for (const r of rows) {
    const key = r.kind + '|' + r.trig;
    if (seen.has(key)) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return { rows, byKind, byCat, total: rows.length, dupAcross };
}

// 检查触发器里有没有明显缺失的东西
export function commandIssues(ed2 = ed) {
  const g = ed2.map && ed2.map.group('Triggers');
  const objs = g ? g.objects : [];
  const out = [];
  if (!objs.length) { out.push({ level: 'warn', text: '这张图没有任何触发器。普通对战中，至少需要一个 map_info 设置地图类型。' }); return out; }
  const hasInfo = objs.some((o) => kindOf(o) === 'map_info' && /map_info/i.test(o.attrs.name || ''));
  if (!hasInfo) out.push({ level: 'warn', text: '没有 map_info（地图类型）触发器，游戏可能不知道这是对战还是生存图' });
  // 有刷兵但没延迟/间隔的
  const adds = objs.filter((o) => kindOf(o) === 'unitAdd');
  if (adds.length) {
    const noDelay = adds.filter((o) => !(o.props || []).some((p) => p.name === 'delay'));
    if (noDelay.length) out.push({ level: 'warn', text: `${noDelay.length} 个刷兵没设延迟，开局立刻刷` });
  }
  // 有移动单位但没目标点
  const moves = objs.filter((o) => kindOf(o) === 'move');
  const points = objs.filter((o) => kindOf(o) === 'point');
  if (moves.length && !points.length) out.push({ level: 'error', text: `${moves.length} 个“移动单位”没有目标点` });
  // 触发器 id 重复
  // 只有真正的 id 属性重复才算问题；目标点、敌军出生点这类靠名字区分，同名是正常的
  const ids = new Map();
  for (const o of objs) {
    const raw = (o.props || []).find((p) => p.name === 'id');
    if (!raw || !String(raw.value || '').trim()) continue;
    const k = String(raw.value).trim();
    ids.set(k, (ids.get(k) || 0) + 1);
  }
  const dupIds = [...ids.entries()].filter(([, c]) => c > 1);
  if (dupIds.length) out.push({ level: 'error', text: `触发器 id 重复：${dupIds.map(([k, c]) => `${k}（${c} 次）`).join('、')}，游戏里会互相干扰` });
  // 有任务目标但没有对应胜利条件
  const hasObjective = objs.some((o) => kindOf(o) === 'objective');
  if (hasObjective) {
    const info = objs.find((o) => kindOf(o) === 'map_info');
    const win = info && (info.props || []).find((p) => p.name === 'victory');
    if (!win || win.value !== 'requiredObjectives') out.push({ level: 'warn', text: '有任务目标，但 map_info 的胜利条件不是“完成所有目标”，玩家不会因为做完目标就赢' });
  }
  return out;
}

export function commandsDialog() {
  if (!ed.map) return;
  const st = commandStats();
  const issues = commandIssues();
  const color = { ok: 'var(--ok)', warn: 'var(--warn)', error: 'var(--err)' };
  const icon = { ok: '✓', warn: '!', error: '✕' };
  const cats = ['条件', '逻辑', '动作', '文字', '设置', '其它'];
  const body = h('div', {},
    h('div', { class: 'hint' }, `这张图一共有 ${st.total} 条指令`),
    h('div', { style: 'margin:8px 0 12px' }, ...issues.map((it) => h('div', { class: 'hrow' },
      h('span', { style: `color:${color[it.level]};font-weight:700;width:18px` }, icon[it.level]),
      h('span', {}, it.text)))),
    ...cats.filter((c) => st.byCat.has(c)).map((c) => h('div', { style: 'margin-bottom:12px' },
      h('h3', { style: 'font-size:13px;margin:0 0 6px;color:var(--fg2)' }, `${c}（${st.byCat.get(c).length}）`),
      h('div', { style: 'max-height:22vh;overflow:auto' }, ...st.byCat.get(c).map((r) => h('div', { class: 'hrow', style: 'cursor:pointer' },
        h('span', { style: 'font-weight:600;width:90px' }, r.cn),
        h('span', { class: 'hint' }, r.trig)))))));
  return modal('指令一览', body, [{ label: '关闭', value: 0, primary: true }], { wide: true })
    .then((v) => { void v; });
}
