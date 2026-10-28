// 一键体检修复：把 check.js 里能自动修的问题按“安全 / 有风险 / 需人工”分级，
// 再按用户勾选逐项执行；每一项都是独立的历史步骤，可以单独 Ctrl+Z 撤回。
import { A } from './state.js';
import { runChecks } from './check.js';
import { passability, LAND } from './pathing.js';
import { h, toast, busy, modal, modalOpen } from './ui.js';
import { HELP } from './help.js';

const RISK_RENUMBER = '队伍号重排后，触发器或脚本里写死的队伍编号可能对不上，联机时的玩家槽位也可能错位。';
const RISK_POOLS = '会挪动资源池位置，可能改变开局平衡，也会让触发器里记录的资源池坐标对不上。';

// 资源池放在水里 / 悬崖上 / 贴着地图边
function badPools(ed) {
  const m = ed.map, L = m.items;
  if (!L || !ed.poolGids || !ed.poolGids.size) return [];
  const W = m.width, H = m.height;
  const pass = passability(ed);
  const out = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!L.data[i] || !ed.poolGids.has(L.data[i])) continue;
      const border = x === 0 || y === 0 || x >= W - 1 || y >= H - 1;
      if (border || !(pass[i] & LAND)) out.push([x, y]);
    }
  }
  return out;
}

// 从 (x,y) 往外找最近的、可站立的空地
function nearestLand(ed, x, y, pass) {
  const m = ed.map, W = m.width, H = m.height, L = m.items;
  for (let r = 1; r <= 80; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        const ni = ny * W + nx;
        if ((pass[ni] & LAND) && !(L.data[ni] || 0)) return [nx, ny];
      }
    }
  }
  return null;
}

// 把一个资源池整体挪到最近陆地（独立一步撤销）
function movePools(ed, pools) {
  const m = ed.map, L = m.items, W = m.width;
  const pass = passability(ed);
  let moved = 0;
  let op = null;
  for (const [x, y] of pools) {
    const i = y * W + x;
    const gid = L.data[i] || 0;
    if (!gid || !ed.poolGids.has(gid)) continue;
    const to = nearestLand(ed, x, y, pass);
    if (!to) continue;
    if (!op) op = ed.begin('挪资源池');
    const flip = L.flips.get(i) || 0;
    op.tile(L, i, gid, flip, 0, 0);
    const ni = to[1] * W + to[0];
    op.tile(L, ni, L.data[ni] || 0, L.flips.get(ni) || 0, gid, flip);
    // 后面的池子不要占同一个落点
    pass[ni] = pass[ni] & ~LAND;
    moved++;
  }
  if (op) ed.commit();
  return moved;
}

function manualHint(c) {
  const cat = c.cat || '';
  if (cat.includes('出生点')) return '需要你手动把指挥中心挪到平地或地图里侧';
  if (cat.includes('资源')) return '需要你手动把资源池挪到单位够得着的陆地';
  if (cat.includes('空投')) return '需要你手动补一些可建造地面';
  if (cat.includes('触发器')) return '需要到触发器面板里改';
  if (cat.includes('地形')) return '需要你手动换图块或调整地形';
  return '需要手动处理（没有安全的自动修法）';
}

function classify(c) {
  const label = (c.fix && c.fix.label) || '';
  if (/补上地块图/.test(label)) return 'manual-asset';
  if (/重新编号/.test(label)) return 'risky';
  return 'safe';
}

// 体检并分级：safe 默认修，risky 默认不修，manual 只列出来
export function planAutoFix(ed) {
  if (!ed || !ed.map) return { safe: [], risky: [], manual: [], all: [] };
  let issues = [];
  try {
    issues = runChecks(ed, { triggerIssues: A.hooks && A.hooks.triggerIssues ? A.hooks.triggerIssues() : undefined });
  } catch (err) {
    return { safe: [], risky: [], manual: [], all: [], error: String(err.message || err) };
  }
  const safe = [], risky = [], manual = [];
  issues.forEach((c, n) => {
    const id = `chk-${n}`;
    if (c.fix) {
      const kind = classify(c);
      const base = { id, level: c.level, cat: c.cat, title: c.title, detail: c.detail, fix: c.fix, label: c.fix.label };
      if (kind === 'risky') risky.push({ ...base, risk: RISK_RENUMBER });
      else if (kind === 'manual-asset') manual.push({ id, level: c.level, cat: c.cat, title: c.title, detail: c.detail, why: '要在弹出的“缺失地块图”对话框里手动选图片' });
      else safe.push(base);
    } else if (c.level === 'error' || c.level === 'warn') {
      manual.push({ id, level: c.level, cat: c.cat, title: c.title, detail: c.detail, why: manualHint(c) });
    }
  });
  const pools = badPools(ed);
  if (pools.length) {
    const tPool = `${pools.length} 个资源池在水里、悬崖上或地图边缘`;
    // 体检里同一条目没有修法，会落到 manual，这里去重
    for (let i = manual.length - 1; i >= 0; i--) if (manual[i].title === tPool) manual.splice(i, 1);
    risky.push({
      id: 'pool-place',
      level: 'warn',
      cat: '资源',
      title: tPool,
      detail: '单位可能够不着。',
      label: '挪到最近的陆地',
      risk: RISK_POOLS,
      fix: { label: '挪到最近的陆地', run: () => movePools(ed, badPools(ed)) },
    });
  }
  return { safe, risky, manual, all: [...safe, ...risky] };
}

// 清除未定义图块后可能又露出新的空格，补跑一轮填满（独立一步）
function fillEmptyGround(ed) {
  const m = ed.map, G = m.ground, W = m.width, H = m.height;
  const cnt = new Map();
  let empties = 0;
  for (let i = 0; i < G.data.length; i++) {
    const g = G.data[i];
    if (!g) empties++;
    else if (m.tilesetOf(g)) cnt.set(g, (cnt.get(g) || 0) + 1);
  }
  if (!empties) return 0;
  let fill = 0, best = 0;
  for (const [g, n] of cnt) if (n > best) { best = n; fill = g; }
  if (!fill) return 0;
  const op = ed.begin('补上剩下的空格');
  for (let i = 0; i < G.data.length; i++) if (!G.data[i]) op.tile(G, i, 0, 0, fill, 0);
  if (ed.engine) ed.engine.syncRect(op, 0, 0, W - 1, H - 1, true);
  op.markAll();
  ed.commit();
  return empties;
}

function refresh() {
  const ed = A.ed;
  A.rend.invalidateAll();
  A.mini.schedule();
  A.autoDirty = true;
  if (ed) ed.dirty = true;
  A.refresh();
}

// 逐项执行；每一项单独 begin/commit（check.js 的 fix 自己就是一步）
// which: 'safe' | 'risky' | 'all' | 由 planAutoFix 返回的条目数组
export async function applyAutoFix(ed, which = 'safe') {
  if (!ed || !ed.map) return { ok: false, why: '先打开一张地图', applied: [], failed: [] };
  let items;
  if (Array.isArray(which)) items = which;
  else {
    const plan = planAutoFix(ed);
    if (which === 'all') items = [...plan.safe, ...plan.risky];
    else if (which === 'risky') items = plan.risky;
    else items = plan.safe;
  }
  items = items.filter((it) => it && it.fix && typeof it.fix.run === 'function');
  const applied = [], failed = [];
  let steps = 0;
  for (const it of items) {
    const before = ed.undoStack.length;
    const t0 = performance.now();
    try {
      const r = it.fix.run();
      if (r && typeof r.then === 'function') await r;
      const used = ed.undoStack.length - before;
      steps += used;
      applied.push({ id: it.id, title: it.title, label: it.label, steps: used, ms: +(performance.now() - t0).toFixed(1), risk: !!it.risk });
    } catch (err) {
      failed.push({ id: it.id, title: it.title, error: String((err && err.message) || err) });
    }
  }
  // 某些修复（如清除未定义图块）会露出新空格，补一轮填满，仍单独记一步
  if (applied.some((a) => !a.risk) || items.some((it) => !it.risk)) {
    const t0 = performance.now();
    const before = ed.undoStack.length;
    try {
      const n = fillEmptyGround(ed);
      if (n) {
        const used = ed.undoStack.length - before;
        applied.push({ id: 'fill-empty', title: `补上剩下的 ${n} 个空格`, steps: used, ms: +(performance.now() - t0).toFixed(1) });
        steps += used;
      }
    } catch (_) { /* 补空格失败不影响主流程 */ }
  }
  if (applied.length) refresh();
  return { ok: true, applied, failed, skipped: items.length - applied.length - failed.length, steps, plan: planAutoFix(ed) };
}

function rowFor(item, checked, withRisk) {
  const box = h('input', {
    type: 'checkbox', checked,
    style: { width: 'auto', flex: 'none', margin: '2px 0 0' },
    onchange: (e) => { item._checked = e.target.checked; },
  });
  item._checked = checked;
  const row = h('label', { class: 'checkrow', style: { display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '4px 0' } },
    box,
    h('span', {},
      h('b', {}, item.title),
      item.detail ? h('div', { class: 'hint' }, item.detail) : null,
      item.label ? h('div', { class: 'hint' }, '自动修法：' + item.label) : null,
      withRisk && item.risk ? h('div', { class: 'hint', style: { color: '#ff9d6b' } }, '⚠ ' + item.risk) : null));
  return row;
}

function section(title, note, items, checked, withRisk) {
  if (!items.length) return null;
  return h('div', { style: { marginBottom: '10px' } },
    h('div', { class: 'hint', style: { marginBottom: '2px' } }, h('b', {}, `${title}（${items.length}）`), ' ', note),
    ...items.map((it) => rowFor(it, typeof checked === 'function' ? checked(it) : checked, withRisk)));
}

export function autoFixDialog() {
  const ed = A.ed;
  if (!ed || !ed.map) { toast('先打开一张地图'); return; }
  if (modalOpen()) { toast('先关掉当前弹窗'); return; }
  const plan = planAutoFix(ed);
  if (plan.error) { toast('体检出错：' + plan.error); return; }
  const autoCount = plan.safe.length + plan.risky.length;
  if (!autoCount && !plan.manual.length) { toast('没有发现需要修的问题'); return; }

  const body = h('div', { style: { maxHeight: '62vh', overflowY: 'auto' } },
    h('p', { class: 'hint' }, `共 ${autoCount} 项可自动修，${plan.manual.length} 项需要人工。默认只勾选安全的修复；每一项都会单独记一步撤销。`),
    section('安全项', '默认都修，基本不会改变地图玩法。', plan.safe, true, false),
    section('有风险项', '默认不勾；请看清风险再决定。', plan.risky, false, true),
    h('div', {},
      h('div', { class: 'hint', style: { marginBottom: '2px' } }, h('b', {}, `需人工（${plan.manual.length}）`), plan.manual.length ? ' 这些没有安全的自动修法。' : ' 这次没有需要人工的项。'),
      ...plan.manual.map((it) => h('div', { style: { padding: '3px 0' } },
        h('b', {}, it.title),
        h('div', { class: 'hint' }, it.why || manualHint(it))))));

  modal('一键体检修复', body, [
    { label: '取消', value: null },
    { label: `开始修复`, value: 1, primary: true },
  ], { wide: true }).then(async (v) => {
    if (v !== 1) return;
    const chosen = [...plan.safe, ...plan.risky].filter((it) => it._checked && it.fix);
    if (!chosen.length) { toast('没有勾选可自动修的项'); return; }
    let report = null;
    await busy('正在修复…', async () => { report = await applyAutoFix(ed, chosen); });
    showReport(report);
  });
}

function showReport(report) {
  if (!report) return;
  const body = h('div', { style: { maxHeight: '60vh', overflowY: 'auto' } },
    h('p', { class: 'hint' }, report.applied.length
      ? `修好 ${report.applied.length} 项，共 ${report.steps} 步撤销。每一行都可以单独 Ctrl+Z 撤回。`
      : '这次没有改动。'));
  for (const a of report.applied) {
    body.append(h('div', { style: { padding: '3px 0' } },
      h('b', {}, a.title),
      h('span', { class: 'hint' }, ` · ${a.steps > 0 ? `撤销 ${a.steps} 步` : '没有历史记录（如修改图块属性）'} · ${a.ms}ms`)));
  }
  if (report.failed.length) {
    body.append(h('div', { class: 'hint', style: { marginTop: '8px', color: '#ff9d6b' } }, `失败 ${report.failed.length} 项：`));
    for (const f of report.failed) body.append(h('div', { class: 'hint' }, `· ${f.title}：${f.error}`));
  }
  if (report.plan) {
    const left = report.plan.safe.length + report.plan.risky.length + report.plan.manual.length;
    body.append(h('p', { class: 'hint' }, `修完后再体检：还有 ${left} 项需要处理。`));
  }
  modal('修复结果', body, [{ label: '关闭', value: 1, primary: true }]);
}

Object.assign(HELP, {
  'tool.autofixmap': {
    t: '一键体检修复',
    s: '按“安全 / 有风险 / 需人工”分级修复体检问题，每一项独立撤销',
    b: '复用体检（check.js）的结果：带“一键修”标记的按风险分级，安全的默认勾选，有风险的默认不勾并写明后果；还会补上体检没提供修法的“资源池在水里/悬崖上/贴边”的挪位修复。'
      + '执行时逐项运行，每一项单独记一步撤销，可以只撤回其中某一项。',
    tips: [
      '有风险项（挪资源池、队伍号重排）默认不勾，修之前请先看清风险说明。',
      '资源池挪位会找最近的、可站立的空地，落点避开已有物品；仍可能影响开局平衡。',
      '图块属性类修复（water/lava/大小写）改的是图块集 XML，不会生成地图撤销步骤。',
      '修完会再跑一次体检，告诉你还剩多少项需要人工处理。',
    ],
  },
});
