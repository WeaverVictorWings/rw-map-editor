// 单位统计与造价表：按单位类型、按队伍两个维度算这张图的兵力
// 只读，不改地图；血量/造价来自 unitsbrowse.js 的社区整理值（CATALOG），没有的显示「—」。
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast, select } from './ui.js';
import { UNIT_CN } from './editor.js';
import { objProp } from './tmx.js';
import { unitIndex } from './unitsbrowse.js';
import { unitCat } from './panels.js';

const ed = A.ed;

Object.assign(HELP, {
  'tool.unitstats': {
    t: '单位统计与造价',
    s: '这张图摆了多少兵、哪队最富、一场大概要花多少钱',
    b: '菜单「单位」→「单位统计与造价」。上半张表按单位类型汇总：数量、哪几队在造、平均血量和总血量、单个造价和总造价；下半部分是每队的兵力构成（建筑/陆军/海军/空军）、总血量和估算造价。左上角可以只看某一队。',
    tips: [
      '血量、造价是社区整理的参考值（不是从游戏里读的），mod 单位可能没有。',
      '没有参考值的单位显示「—」，不参与总价合计。',
      '2000 个单位也能秒开。',
    ],
  },
});

const CAT_CN = { build: '建筑', land: '陆军', naval: '海军', air: '空军', exp: '实验' };
const CAT_ORDER = ['build', 'land', 'naval', 'air', 'exp'];
const CAT_COLOR = { build: '#e5793a', land: '#3fb950', naval: '#58a6ff', air: '#a855f7', exp: '#e3b341' };

const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('zh-CN'));
const pct = (a, b) => (b > 0 ? Math.max(1, Math.round((a / b) * 100)) : 0);

// CATALOG.cat 是中文分类（建筑/步兵/坦克/火力/空军/防御），归到四个统计桶
function catKeyOfCn(cn) {
  if (cn === '建筑' || cn === '防御') return 'build';
  if (cn === '空军') return 'air';
  if (cn === '海军') return 'naval';
  if (cn === '步兵' || cn === '坦克' || cn === '火力') return 'land';
  return null;
}

function aggregate(ed2) {
  const m = ed2.map;
  if (!m) return null;
  const catalog = new Map();
  for (const u of unitIndex(ed2)) catalog.set(u.name, u.catalog || null);
  const rows = new Map();
  const teams = new Map();
  let count = 0, totalHp = 0, hpKnown = 0, totalCost = 0, costKnown = 0, unknownCostUnits = 0;
  for (const { o } of ed2.allObjects()) {
    const name = objProp(o, 'unit');
    if (!name) continue;
    const team = +(objProp(o, 'team') ?? 0);
    const c = catalog.get(name) || null;
    const hp = c && c.hp !== undefined ? +c.hp : null;
    const cost = c && c.cost !== undefined ? +c.cost : null;
    const key = (c && catKeyOfCn(c.cat)) || unitCat(name);
    count++;
    let r = rows.get(name);
    if (!r) {
      r = {
        unit: name, cn: UNIT_CN[name] || name, count: 0, teams: new Set(),
        totalHp: 0, hpCount: 0, cost, costKnown: cost !== null,
        catKey: key, cat: CAT_CN[key] || '陆军', where: [],
      };
      rows.set(name, r);
    }
    r.count++;
    r.teams.add(team);
    if (hp !== null) { r.totalHp += hp; r.hpCount++; }
    if (r.where.length < 3) r.where.push([Math.floor(+(o.attrs.x || 0) / 20), Math.floor(+(o.attrs.y || 0) / 20)]);
    let t = teams.get(team);
    if (!t) {
      t = { team, count: 0, byCat: { build: 0, land: 0, naval: 0, air: 0, exp: 0 }, totalHp: 0, hpCount: 0, cost: 0, costCount: 0 };
      teams.set(team, t);
    }
    t.count++;
    t.byCat[key] = (t.byCat[key] || 0) + 1;
    if (hp !== null) { t.totalHp += hp; t.hpCount++; }
    if (cost !== null) { totalCost += cost; costKnown++; t.cost += cost; t.costCount++; } else unknownCostUnits++;
    if (hp !== null) { totalHp += hp; hpKnown++; }
  }
  return { rows, teams, count, totalHp, hpKnown, totalCost, costKnown, unknownCostUnits };
}

// 按单位类型汇总
export function unitTable(ed2 = A.ed) {
  const a = aggregate(ed2);
  if (!a) return [];
  return [...a.rows.values()].map((r) => ({
    unit: r.unit,
    cn: r.cn,
    count: r.count,
    teams: [...r.teams].sort((x, y) => x - y),
    totalHp: r.hpCount ? r.totalHp : null,
    avgHp: r.hpCount ? Math.round(r.totalHp / r.hpCount) : null,
    hpKnown: r.hpCount > 0,
    cat: r.cat,
    cost: r.cost,
    costKnown: r.costKnown,
    where: r.where,
  })).sort((x, y) => y.count - x.count || x.cn.localeCompare(y.cn, 'zh'));
}

// 每队：数量、分类构成、总血量、估算造价
export function armySummary(ed2 = A.ed) {
  const a = aggregate(ed2);
  if (!a) return { teams: [], total: { count: 0, totalHp: null, cost: null, teams: 0, kinds: 0, unknownCostUnits: 0 } };
  const teams = [...a.teams.values()].sort((x, y) => x.team - y.team).map((t) => ({
    team: t.team,
    count: t.count,
    byCat: { ...t.byCat },
    totalHp: t.hpCount ? t.totalHp : null,
    avgHp: t.hpCount ? Math.round(t.totalHp / t.count) : null,
    cost: t.costCount ? t.cost : null,
    costKnown: t.costCount,
    unknown: t.count - t.costCount,
  }));
  return {
    teams,
    total: {
      count: a.count,
      kinds: a.rows.size,
      teams: a.teams.size,
      totalHp: a.hpKnown ? a.totalHp : null,
      avgHp: a.hpKnown ? Math.round(a.totalHp / a.hpKnown) : null,
      cost: a.costKnown ? a.totalCost : null,
      costKnown: a.costKnown,
      unknownCostUnits: a.unknownCostUnits,
    },
  };
}

function bar(v, max, color, label) {
  return h('span', { style: 'display:flex;align-items:center;gap:6px;min-width:120px' },
    h('span', { style: 'flex:1;height:10px;border-radius:5px;background:var(--line,#2a2f3a);overflow:hidden' },
      h('span', { style: `display:block;height:100%;width:${pct(v, max)}%;background:${color}` })),
    h('span', { style: 'font-size:11px;color:var(--muted);min-width:34px;text-align:right' }, label));
}

const TH = 'text-align:left;font-size:11px;color:var(--muted);font-weight:600;padding:4px 6px;border-bottom:1px solid var(--line,#2a2f3a)';
const TD = 'font-size:12px;padding:5px 6px;border-bottom:1px solid var(--line,#2a2f3a);vertical-align:middle';

function tableOf(rows, all) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const t = h('table', { style: 'width:100%;border-collapse:collapse' });
  t.append(h('thead', {}, h('tr', {},
    h('th', { style: TH }, '单位'), h('th', { style: TH }, '分类'), h('th', { style: TH + ';width:190px' }, '数量'),
    h('th', { style: TH }, '队伍'), h('th', { style: TH }, '单个血量'), h('th', { style: TH }, '平均血量'),
    h('th', { style: TH }, '总血量'), h('th', { style: TH }, '造价'), h('th', { style: TH }, '总造价'))));
  const tb = h('tbody', {});
  let sum = 0, costSum = 0, hpSum = 0;
  for (const r of rows) {
    sum += r.count;
    if (r.hpKnown) hpSum += r.totalHp;
    if (r.costKnown) costSum += r.cost * r.count;
    tb.append(h('tr', {},
      h('td', { style: TD }, h('div', {}, r.cn), h('div', { class: 'hint', style: 'font-size:10px' }, r.unit)),
      h('td', { style: TD + `;color:${CAT_COLOR[CAT_ORDER.find((k) => CAT_CN[k] === r.cat)] || '#9aa0a6'}` }, r.cat),
      h('td', { style: TD }, bar(r.count, max, 'var(--accent)', String(r.count))),
      h('td', { style: TD }, r.teams.map((t) => t < 0 ? '中立' : `第${t + 1}队`).join(' ') || '—'),
      h('td', { style: TD }, fmt(r.hpKnown ? Math.round(r.totalHp / r.count) : null)),
      h('td', { style: TD }, fmt(r.avgHp)),
      h('td', { style: TD }, fmt(r.totalHp)),
      h('td', { style: TD }, fmt(r.costKnown ? r.cost : null)),
      h('td', { style: TD }, fmt(r.costKnown ? r.cost * r.count : null))));
  }
  t.append(tb);
  t.append(h('tfoot', {}, h('tr', {},
    h('td', { style: TD + ';font-weight:600' }, `合计 ${rows.length} 种`),
    h('td', { style: TD }), h('td', { style: TD + ';font-weight:600' }, `${sum} 个`),
    h('td', { style: TD }), h('td', { style: TD }), h('td', { style: TD }),
    h('td', { style: TD + ';font-weight:600' }, fmt(hpSum || null)),
    h('td', { style: TD }),
    h('td', { style: TD + ';font-weight:600' }, fmt(all.costKnown ? costSum : null)))));
  return t;
}

export function unitStatsDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const table = unitTable();
  const army = armySummary();
  if (!army.total.count) {
    const body = h('div', {},
      h('div', { style: 'font-size:13px;color:var(--muted)' }, '这张图还没有摆单位。'),
      h('div', { class: 'hint', style: 'margin-top:6px' }, '到左边「单位」面板摆几个再来看统计。'));
    return modal('单位统计与造价', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
  }
  const T = army.total;

  const body = h('div', {});
  body.append(h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px' },
    h('div', { class: 'statcard', style: 'flex:1;min-width:120px;border:1px solid var(--line,#2a2f3a);border-radius:8px;padding:9px' },
      h('div', { style: 'font-size:22px;font-weight:700' }, T.count.toLocaleString('zh-CN')),
      h('div', { class: 'hint' }, `单位总数（${T.kinds} 种）`)),
    h('div', { class: 'statcard', style: 'flex:1;min-width:120px;border:1px solid var(--line,#2a2f3a);border-radius:8px;padding:9px' },
      h('div', { style: 'font-size:22px;font-weight:700' }, String(T.teams)),
      h('div', { class: 'hint' }, '有单位的队伍')),
    h('div', { class: 'statcard', style: 'flex:1;min-width:120px;border:1px solid var(--line,#2a2f3a);border-radius:8px;padding:9px' },
      h('div', { style: 'font-size:22px;font-weight:700;color:var(--err)' }, fmt(T.totalHp)),
      h('div', { class: 'hint' }, '已知单位总血量')),
    h('div', { class: 'statcard', style: 'flex:1;min-width:120px;border:1px solid var(--line,#2a2f3a);border-radius:8px;padding:9px' },
      h('div', { style: 'font-size:22px;font-weight:700;color:var(--accent)' }, fmt(T.cost)),
      h('div', { class: 'hint' }, `估算总造价${T.unknownCostUnits ? `（${T.unknownCostUnits} 个没有参考价）` : ''}`))));

  // 队伍筛选
  const teamOpts = [['all', '全部队伍']];
  for (const t of army.teams) teamOpts.push([String(t.team), `${t.team < 0 ? '中立' : '第 ' + (t.team + 1) + ' 队'}（${t.count}）`]);
  const filter = select(teamOpts, 'all', () => paint(), { style: 'min-width:150px;width:auto;max-width:280px;flex:none' });
  const tableWrap = h('div', { style: 'max-height:34vh;overflow:auto' });
  const paint = () => {
    const v = filter.value;
    const rows = v === 'all' ? table : table.filter((r) => r.teams.includes(+v));
    tableWrap.textContent = '';
    if (!rows.length) tableWrap.append(h('div', { class: 'hint' }, '这一队没有单位。'));
    else tableWrap.append(tableOf(rows, T));
  };

  body.append(h('h3', { style: 'font-size:14px;margin:2px 0 6px' }, '按单位类型'),
    h('div', { class: 'row', style: 'gap:8px;align-items:center;margin-bottom:6px' },
      h('span', { class: 'hint' }, '只看：'), filter,
      h('span', { class: 'hint' }, '血量/造价是社区整理值，以游戏/Mod 为准')),
    tableWrap);

  // 每队兵力
  body.append(h('h3', { style: 'font-size:14px;margin:14px 0 6px' }, '每队兵力'));
  const tmax = Math.max(1, ...army.teams.map((t) => t.count));
  const tw = h('div', {});
  for (const t of army.teams) {
    const parts = CAT_ORDER.filter((k) => t.byCat[k]).map((k) => `${CAT_CN[k]} ${t.byCat[k]}`).join(' · ');
    tw.append(h('div', { class: 'hrow', style: 'align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--line,#2a2f3a)' },
      h('span', { style: 'font-size:12px;min-width:64px' }, t.team < 0 ? '中立' : `第 ${t.team + 1} 队`),
      h('span', { style: 'min-width:150px' }, bar(t.count, tmax, t.team < 0 ? '#9aa0a6' : 'var(--accent)', String(t.count))),
      h('span', { class: 'hint', style: 'flex:1;font-size:11px' }, parts || '—'),
      h('span', { class: 'hint', style: 'font-size:11px;text-align:right;min-width:150px' },
        `血 ${fmt(t.totalHp)} · 造价 ${fmt(t.cost)}${t.unknown ? `（${t.unknown} 个未知）` : ''}`)));
  }
  if (!army.teams.length) tw.append(h('div', { class: 'hint' }, '没有队伍信息。'));
  body.append(tw);

  body.append(h('div', { class: 'hint', style: 'margin-top:10px' },
    '只读：统计不会改地图。造价只合计有参考值的单位，没有的显示「—」。'));

  paint(); // 首次渲染表格（原先只在筛选变化时才画，导致打开对话框看不到表格）

  return modal('单位统计与造价', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
}
