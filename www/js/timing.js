// 经济与开局节奏分析：每队什么时候能出第一辆兵、什么时候能到对面、基地大概多久建完
// 全部是“粗估”——按资源池数量和步行距离套一个简单模型，不是游戏里的真实公式
import { A } from './state.js';
import { h, modal } from './ui.js';
import { HELP } from './help.js';
import { balanceReport, LAND, HOVER } from './pathing.js';
import { teamColor } from './render.js';
import { mapInfoFields } from './mapinfo.js';
import { annotatePaths } from './pathannot.js';

const ed = A.ed;

// 建筑/单位的钱（和 unitsbrowse.js 的单位目录对齐，改那边记得同步）
export const COST = {
  builder: 300, tank: 600, supplyDepot: 500, turret: 700,
  heavyTank: 1200, artillery: 1000, commandCenter: 0,
};

// 粗估用的模型参数：每一条都能在弹窗里看到，用户知道钱是怎么算出来的
export const MODEL = {
  baseIncome: 5,        // 指挥中心自己的收入，元/秒
  perPoolIncome: 3,     // 30 格内每个资源池带来的额外收入，元/秒
  prepTime: 12,         // 开局到“能开始造兵”的固定准备时间，秒
  baseBuild: 35,        // 从开局到基地成型（补给站 + 炮塔）的额外时间，秒
  speed: 3,             // 兵的走路速度，格/秒（只用来算到达时间）
  fullBaseCost: 1900,   // 满编基地要花的钱：补给站 500 + 两座炮塔 1400
  defaultCredits: 4000, // map_info 没写开局资金时的游戏默认值
  tolerance: 20,        // 两队第一波差多少秒算失衡
};

const fmt = (v) => (v == null || !isFinite(v) ? '—' : `${Math.round(v)}s`);

// 每队一条时间线：开局 → 第一辆战斗单位 → 第一波打到家门口 → 满编基地
export function timingReport(ed2 = ed, opts = {}) {
  const radius = opts.radius ?? 30;
  const model = { ...MODEL, ...(opts.model || {}) };
  const m = ed2.map;
  const info = mapInfoFields(ed2);
  // 注意：credits 写了 "0" 也是合法值（0 元的开局），不能用 || 兜底
  const rawCredits = info.credits;
  const credits = rawCredits == null || rawCredits === '' ? model.defaultCredits : Math.max(0, Number(rawCredits) || 0);
  const bal = balanceReport(ed2, radius);

  // 进攻路线长度（用“到敌方出生点”的最短路），顺带拿到各队出生点坐标
  let paths = null;
  try { paths = annotatePaths(ed2, { mask: opts.mask ?? (LAND | HOVER) }); } catch { paths = null; }
  const routeByTeam = new Map();
  if (paths) for (const r of paths.routes) if (r.kind === 'enemy') {
    const cur = routeByTeam.get(r.team);
    if (!cur || r.len < cur.len) routeByTeam.set(r.team, r);
  }

  const teams = bal.rows.map((row) => {
    const inRange = row.near == null ? 0 : row.near;
    const income = model.baseIncome + model.perPoolIncome * inRange;
    const poolDist = row.nearest == null ? null : row.nearest;
    // 第一辆坦克：钱不够就攒，攒够再上 12 秒准备时间
    const need = Math.max(0, COST.tank - credits);
    const firstUnitAt = Math.round(model.prepTime + need / income);
    const route = routeByTeam.get(row.team);
    const routeLen = route ? route.len : null;
    const firstWaveAt = routeLen == null ? null : Math.round(firstUnitAt + routeLen / model.speed);
    const fullNeed = Math.max(0, model.fullBaseCost - credits);
    const fullBaseAt = Math.round(model.baseBuild + fullNeed / income);
    return {
      team: row.team, cx: row.x, cy: row.y,
      startCredits: credits, income: Math.round(income * 10) / 10,
      nearestPoolDist: poolDist, poolsIn30: inRange, poolsOwned: row.poolsOwned == null ? null : row.poolsOwned,
      area: row.area == null ? null : row.area,
      buildRateEstimate: Math.round(income * 10) / 10,
      firstUnitAt, firstWaveAt, fullBaseAt, routeLen,
      reachEnemies: row.reachEnemies == null ? null : row.reachEnemies,
      island: !!row.island,
    };
  });

  // 第一波时间差：谁先到谁占便宜
  const waves = teams.map((t) => t.firstWaveAt).filter((v) => v != null);
  const lo = waves.length ? Math.min(...waves) : null;
  const hi = waves.length ? Math.max(...waves) : null;
  const spread = lo == null ? null : hi - lo;
  const balanced = spread == null ? true : spread <= model.tolerance;
  const slowest = balanced || spread == null ? [] : teams.filter((t) => t.firstWaveAt === hi).map((t) => t.team);

  return {
    credits, teams, spread, balanced, slowest,
    tolerance: model.tolerance, model, radius,
    basis: {
      pools: ed2.poolTiles ? ed2.poolTiles().length : null,
      nearestPoolDist: teams.map((t) => [t.team, t.nearestPoolDist]),
      balance: bal.rows.map((r) => ({ team: r.team, near: r.near, nearest: r.nearest, area: r.area, poolsOwned: r.poolsOwned })),
    },
  };
}

// ---------------- 弹窗 ----------------
let layer = null;   // 时间线用 DOM，不用画布，缩放/滚动都简单

function clearLayer() { if (layer && layer.parentElement) layer.remove(); layer = null; }

function teamColorSafe(t) {
  try { return teamColor(t); } catch { return ['#58b368', '#e5484d', '#4f8ff7', '#e5a83f'][t % 4]; }
}

function bar(color, fromT, toT, total, label) {
  const left = (fromT / total) * 100;
  const width = Math.max(0.8, ((toT - fromT) / total) * 100);
  return h('div', {
    class: 'tm-seg', title: label,
    style: `position:absolute;left:${left}%;width:${width}%;top:0;bottom:0;background:${color};opacity:.85;border-radius:3px`,
  });
}

// 画一条时间线：0 → 第一个兵 → 第一波到达 → 满编
function timeline(res) {
  const total = Math.max(60, ...res.teams.flatMap((t) => [t.firstWaveAt || 0, t.fullBaseAt || 0, t.firstUnitAt || 0]));
  const wrap = h('div', { class: 'tm-wrap' });
  const axis = h('div', { style: 'position:relative;height:18px;margin:2px 0 6px 92px;font-size:11px;color:var(--muted)' });
  for (let k = 0; k <= 4; k++) {
    const t = Math.round((total * k) / 4);
    axis.append(h('div', { style: `position:absolute;left:${(t / total) * 100}%;transform:translateX(-50%);top:0` }, fmt(t)));
  }
  wrap.append(axis);
  for (const t of res.teams) {
    const color = teamColorSafe(t.team);
    const row = h('div', { style: 'display:flex;align-items:center;gap:8px;margin:5px 0' },
      h('div', { style: 'width:84px;font-size:12px;color:var(--muted);text-align:right;flex:none' }, `第 ${t.team + 1} 队`),
      h('div', { class: 'tm-track', style: 'position:relative;flex:1;height:16px;background:rgba(255,255,255,.06);border-radius:4px' },
        bar(color, 0, t.firstUnitAt, total, `第一辆坦克 ${fmt(t.firstUnitAt)}`),
        t.firstWaveAt != null ? bar('rgba(255,255,255,.85)', t.firstUnitAt, t.firstWaveAt, total, `第一波到达 ${fmt(t.firstWaveAt)}`) : null,
        bar('rgba(229,168,63,.9)', t.fullBaseAt, Math.min(total, t.fullBaseAt + total * 0.06), total, `满编基地 ${fmt(t.fullBaseAt)}`),
      ),
    );
    wrap.append(row);
  }
  wrap.append(h('div', { style: 'display:flex;gap:14px;font-size:11px;color:var(--muted);margin:6px 0 0 92px' },
    h('span', {}, '▬ 队伍色：攒钱出第一辆坦克'),
    h('span', {}, '▬ 白：从出第一辆到打到对面出生点'),
    h('span', {}, '▬ 黄：满编基地（补给站 + 两座炮塔）'),
  ));
  layer = wrap;
  return wrap;
}

function table(res) {
  const head = ['', '开局资金', '30 格内资源池', '最近资源池', '估收入', '第一辆单位', '第一波到达', '满编基地'];
  const tb = h('table', { class: 'tm-table', style: 'width:100%;border-collapse:collapse;font-size:12px;margin-top:10px' },
    h('tr', {}, ...head.map((s) => h('th', { style: 'text-align:left;font-weight:600;color:var(--muted);padding:5px 6px;border-bottom:1px solid rgba(255,255,255,.1)' }, s))),
    ...res.teams.map((t) => {
      const tr = h('tr', { class: 'tm-row', style: 'cursor:pointer', title: '点一下跳到这队的出生点' },
        h('td', { style: 'padding:5px 6px' }, h('span', { style: `display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${teamColorSafe(t.team)}` }), `第 ${t.team + 1} 队`),
        h('td', { style: 'padding:5px 6px' }, String(t.startCredits)),
        h('td', { style: 'padding:5px 6px' }, `${t.poolsIn30} 个${t.poolsOwned != null ? `（地盘内 ${t.poolsOwned}）` : ''}`),
        h('td', { style: 'padding:5px 6px' }, t.nearestPoolDist == null ? '走不到' : `${t.nearestPoolDist} 格`),
        h('td', { style: 'padding:5px 6px' }, `${t.income} 元/秒`),
        h('td', { style: 'padding:5px 6px' }, fmt(t.firstUnitAt)),
        h('td', { style: 'padding:5px 6px' }, t.firstWaveAt == null ? '走不到' : fmt(t.firstWaveAt)),
        h('td', { style: 'padding:5px 6px' }, fmt(t.fullBaseAt)),
      );
      tr.addEventListener('click', () => {
        try { A.rend.centerOn(Math.floor(t.cx / 20), Math.floor(t.cy / 20), A.rend.view.z); A.rend.request(); } catch { /* ignore */ }
      });
      return tr;
    }),
  );
  return tb;
}

export function timingDialog() {
  clearLayer();
  let res = timingReport(ed);

  const body = h('div', { class: 'tm-body' });
  const summary = h('div', { class: 'tm-summary', style: 'font-size:13px;margin:2px 0 8px' });
  const caution = h('div', { class: 'tm-caution', style: 'font-size:12px;color:var(--muted);margin:6px 0 10px' });
  const holder = h('div');

  const redraw = () => {
    res = timingReport(ed);
    const first = res.teams.reduce((a, b) => (a == null || b.firstUnitAt < a.firstUnitAt ? b : a), null);
    const late = res.teams.reduce((a, b) => (a == null || b.firstUnitAt > a.firstUnitAt ? b : a), null);
    summary.textContent = res.teams.length === 0
      ? '地图里没有队伍出生点，先放几个带 team 的单位。'
      : `开局资金 ${res.credits}。最先出兵的${first ? `是第 ${first.team + 1} 队（${fmt(first.firstUnitAt)}）` : '—'}`
        + `${late && late !== first ? `，最慢是第 ${late.team + 1} 队（${fmt(late.firstUnitAt)}）` : ''}。`
        + (res.spread == null ? ' 没有可比的进攻路线。' : ` 第一波到达时间差 ${res.spread}s（超过 ${res.tolerance}s 就算失衡）。`);
    caution.innerHTML = res.balanced
      ? '时间差在容忍范围内，看起来是平衡的。'
      : `⚠ 第 ${res.slowest.map((t) => t + 1).join('、')} 队明显慢，先动手的那队会白拿一波资源。`;
    holder.innerHTML = '';
    holder.append(timeline(res), table(res));
  };

  const note = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)' },
    `模型（粗估）：指挥中心 ${MODEL.baseIncome} 元/秒 + 30 格内每个资源池 ${MODEL.perPoolIncome} 元/秒；`
    + `坦克 ${COST.tank} 元、准备时间 ${MODEL.prepTime}s、兵速 ${MODEL.speed} 格/秒；满编基地 ${MODEL.fullBaseCost} 元。`
    + '这只是按地图布局算出来的量级，不是游戏里的真实数值，别拿它当标准答案。',
  );
  body.append(summary, caution, holder, note);
  redraw();

  const p = modal('经济与开局节奏（粗估）', body, [{ label: '关闭', value: 1, primary: true }], { wide: true });
  // 停靠右侧，左边露地图看队伍位置
  if (window.innerWidth > 980) {
    const el = [...document.querySelectorAll('.modal')].pop();
    if (el) {
      el.style.placeItems = 'center end';
      el.style.paddingRight = '12px';
      el.style.background = 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,.55) 58%, rgba(0,0,0,.65) 100%)';
      const box = el.querySelector('.box');
      if (box) box.style.width = 'min(660px, 54vw)';
    }
  }
  return p.then((v) => { clearLayer(); return v; });
}

Object.assign(HELP, {
  'tool.timing': {
    t: '经济与开局节奏（粗估）',
    s: '按资源池数量和步行距离，估各队多久出第一辆兵、多久打到对面、基地多久成型。',
    b: '只看地图布局：每队 30 格内有多少资源池、最近资源池多少格、出生点到敌方出生点的最短路线多长，'
      + '再套一个简单的收入模型（指挥中心 + 每个资源池给一点钱），算出「第一辆坦克」「第一波到达」「满编基地」三个时间点。'
      + '两条队伍的第一波到达时间差超过 20 秒就会标出来——先动手的队伍能白拿一波资源。'
      + '所有数字都是量级估计，不是游戏真实公式；要精确对比队伍实力用「平衡报告」，要精确算路用「瓶颈分析」。',
    tips: [
      '点表格里的一行会跳到那队的出生点。',
      '开局资金取 map_info 的 credits，没填就按游戏默认 4000 算。',
      '资源池数量只算 30 格以内能走到的那些（绕不过去的算不到）。',
    ],
  },
});
