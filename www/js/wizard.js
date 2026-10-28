// 地图设计向导：选类型 → 回答几个问题 → 确认摘要 → 一键生成地形、出生点、资源池和基础触发器
// 全部复用已有能力：dialogs.js 的 createNewMap（地形/出生点/资源池）、detail.js 的自动细节、triggers.js 的触发器
// 入口：wizardDialog()；给测试/菜单用：createFromWizard(st)、WIZARD_KINDS、wizardPlan(st)
import { A } from './state.js';
import { kvGet, clamp } from './util.js';
import { h, modal, closeModal, toast, busy, select, toggle, confirmBox } from './ui.js';
import { icon } from './icons.js';
import { helpBtn } from './help.js';
import { PRESETS, STYLES } from './gen.js';
import { sizeTier, runChecks } from './check.js';
import { createNewMap } from './dialogs.js';
import { STYLE_PRESETS, makeWork, runStack, applyWork } from './detail.js';
import { makeTrigger, trigGroup, triggerIssues, teamHex } from './triggers.js';
import { setObjProp } from './tmx.js';

const ed = A.ed, rend = A.rend;
const TW = 20;

// ---------------- 类型 ----------------
// def 就是这个类型的默认答案（第 2 步可以先改，第 3 步确认）
export const WIZARD_KINDS = [
  { id: '1v1', cn: '1v1 对战', icon: 'flag', desc: '两个人左右对阵，节奏最快，适合先做一张能玩的图',
    def: { size: 160, players: 2, sym: 'lr', preset: 'continent', style: 'temperate', pools: 3, center: 2, detail: 'grassland', credits: 4000, reinforce: false } },
  { id: 'team', cn: '3~4 人团战', icon: 'units', desc: '左右各一队，中间抢资源，2v2 / 3v3 都行',
    def: { size: 200, players: 4, sym: 'lr', preset: 'continent', style: 'temperate', pools: 2, center: 4, detail: 'trueline', credits: 4000, reinforce: true } },
  { id: 'ffa', cn: '8 人混战', icon: 'globe', desc: '8 个出生点散在地图上，没有队友，各打各的',
    def: { size: 240, players: 8, sym: 'none', preset: 'continent', style: 'temperate', pools: 2, center: 8, detail: 'grassland', credits: 3000, reinforce: true } },
  { id: 'survival', cn: '生存模式', icon: 'wave', desc: '守一座基地，敌人一波一波从地图边上刷出来',
    def: { size: 160, players: 1, sym: 'none', preset: 'continent', style: 'temperate', pools: 4, center: 2, detail: 'grassland', credits: 6000, reinforce: false, enemyPoints: 3 } },
  { id: 'city', cn: '城夺', icon: 'region', desc: '中央一座城，谁占住谁一直拿钱，适合多人抢点',
    def: { size: 200, players: 4, sym: 'lr', preset: 'continent', style: 'temperate', pools: 2, center: 0, detail: 'trueline', credits: 4000, reinforce: false, city: true } },
  { id: 'blank', cn: '空白自定义', icon: 'newfile', desc: '只铺底图、放好出生点，地形自己画',
    def: { size: 120, players: 2, sym: 'lr', preset: 'continent', style: 'temperate', pools: 2, center: 0, detail: 'none', credits: 0, reinforce: false } },
];
const KIND_BY_ID = Object.fromEntries(WIZARD_KINDS.map((k) => [k.id, k]));
const SIZES = [['小', 120], ['中', 160], ['大', 220], ['超大', 300]];
const SYMS = [['none', '不对称'], ['lr', '左右'], ['tb', '上下'], ['rot', '中心旋转'], ['quad', '四向']];
const SYM_CN = Object.fromEntries(SYMS);
const SURVIVAL_WAVES = '+1:00 第一波 - 3 tank\n+1:30 第二波 - 5 tank, 2 heavyTank\n+2:00 最终波 [win] - 8 tank, 4 heavyTank';
const randSeed = () => Math.floor(Math.random() * 1e6);
const detailCn = (id) => (id === 'none' ? '不加' : (STYLE_PRESETS.find((p) => p.id === id) || {}).cn || id);

export function wizardKindDefault(id = '1v1') {
  const k = KIND_BY_ID[id] || WIZARD_KINDS[0];
  return { kind: k.id, name: k.cn, seed: randSeed(), ...k.def };
}
function applyKind(st, id) {
  const d = wizardKindDefault(id);
  for (const key of Object.keys(st)) delete st[key];
  Object.assign(st, d);
  return st;
}

// ---------------- 摘要计算（第 3 步 + 测试都用这里） ----------------
export function wizardPlan(st) {
  const players = clamp(+st.players || 2, 1, 100);
  const pools = clamp(+st.pools || 0, 0, 4);
  const center = clamp(+st.center || 0, 0, 8);
  const list = [];
  if (st.credits > 0) list.push({ cn: '开局资金', n: players });
  if (st.reinforce) list.push({ cn: '定时援军', n: players });
  if (st.kind === 'city' && st.city !== false) list.push({ cn: '城夺据点', n: 2 + players * 3 + 1 });
  if (st.kind === 'survival') list.push({ cn: '生存敌军出生点', n: clamp(+st.enemyPoints || 3, 1, 8) });
  return { players, pools, center, poolMax: pools * players + center, list, total: list.reduce((s, x) => s + x.n, 0) };
}

// ---------------- 触发器（第 3 步的等价实现） ----------------
function idOf(o) { return (o.props.find((p) => p.name === 'id') || {}).value; }
function takenKeys(T) {
  return new Set(T.objects.map((o) => String((o.props.find((p) => p.name === 'id') || {}).value || o.attrs.name || '').trim().toLowerCase()));
}
// 在远离玩家的地图边缘挑敌军出生点；保证数量（fallback 补足）
function attackPointTiles(n) {
  const m = ed.map, W = m.width, H = m.height, sp = ed.spawns();
  const cands = [], step = Math.max(4, Math.floor((W + H) / 60));
  for (let x = 4; x < W - 4; x += step) cands.push([x, 3], [x, H - 4]);
  for (let y = 4; y < H - 4; y += step) cands.push([3, y], [W - 4, y]);
  const score = ([x, y]) => (sp.length ? Math.min(...sp.map((s) => Math.hypot(s.cx / TW - x, s.cy / TW - y))) : Math.hypot(x - W / 2, y - H / 2));
  cands.sort((a, b) => score(b) - score(a));
  const chosen = [];
  const far = Math.max(10, (W + H) / 10);
  for (const c of cands) { if (chosen.length >= n) break; if (chosen.every((d) => Math.hypot(d[0] - c[0], d[1] - c[1]) > far)) chosen.push(c); }
  for (const c of cands) { if (chosen.length >= n) break; if (!chosen.includes(c)) chosen.push(c); }
  return chosen.slice(0, n);
}
// 城夺：中央一座城（和触发器模板“城市争夺”同一套逻辑，只是不用点地图）
function cityRect() {
  const m = ed.map;
  const size = Math.min(7, Math.max(3, Math.round(Math.min(m.width, m.height) / 18)));
  const half = Math.floor(size / 2);
  return { x: (Math.round(m.width / 2) - half) * TW, y: (Math.round(m.height / 2) - half) * TW, w: size * TW, h: size * TW };
}
function buildTriggers(st) {
  const T = trigGroup(true);
  if (!T) return [];
  const taken = takenKeys(T);
  const teams = clamp(+st.players || 2, 1, 100);
  const spawns = ed.spawns().filter((s) => s.team >= 0).sort((a, b) => a.team - b.team);
  const nearTeam = (k) => {
    const s = spawns.find((x) => x.team === k) || spawns[spawns.length ? k % spawns.length : 0];
    return s ? { x: s.cx - 40, y: s.cy + 40, w: 80, h: 40 } : { x: -60, y: k * TW, w: TW, h: TW };
  };
  const out = [];
  if (st.credits > 0) {
    for (let k = 0; k < teams; k++) out.push(makeTrigger('team_info', { x: -60, y: k * TW, w: TW, h: TW }, { team: k, credits: st.credits }, `队伍设置${k + 1}`, taken));
  }
  if (st.reinforce) {
    for (let k = 0; k < teams; k++) {
      out.push(makeTrigger('unitAdd', nearTeam(k), { team: k, spawnUnits: 'tank*3', delay: '120s', repeatDelay: '180s', globalMessage: `第 ${k + 1} 队的援军到了`, globalMessage_textColor: teamHex(k) }, `援军${k + 1}`, taken));
    }
  }
  if (st.kind === 'survival') {
    for (const [x, y] of attackPointTiles(clamp(+st.enemyPoints || 3, 1, 8))) {
      out.push({ attrs: { name: 'attack_point', x: String((x - 1) * TW), y: String((y - 1) * TW), width: String(3 * TW), height: String(3 * TW) }, props: [{ name: 'comment', value: '敌军出生点（向导）' }], extra: [] });
    }
  }
  if (st.kind === 'city' && st.city !== false) {
    const rect = cityRect();
    const has = makeTrigger('unitDetect', rect, { onlyBuildings: 'true', minUnits: 1, resetActivationAfter: '20s', comment: '城市区域里有任何建筑' }, '城市_有建筑', taken);
    out.push(has);
    out.push(makeTrigger('unitAdd', rect, { team: -1, spawnUnits: 'turret*1', deactivatedBy: idOf(has), warmup: '20s', resetActivationAfter: '20s', comment: '没人占领时刷中立守军' }, '城市_守军', taken));
    const owners = [];
    for (let k = 0; k < teams; k++) {
      const ow = makeTrigger('unitDetect', rect, { team: k, onlyBuildings: 'true', minUnits: 1, resetActivationAfter: '1s', comment: `第 ${k + 1} 队占领` }, `城市_归属${k + 1}`, taken);
      out.push(ow);
      owners.push(idOf(ow));
      out.push(makeTrigger('changeCredits', rect, { team: k, add: 5, activatedBy: idOf(ow), resetActivationAfter: '2s' }, `城市_收入${k + 1}`, taken));
      out.push(makeTrigger('mapText', rect, { text: '城市', textColor: teamHex(k), textSize: 14, activatedBy: idOf(ow), resetActivationAfter: '1s' }, `城市_名字${k + 1}`, taken));
    }
    out.push(makeTrigger('mapText', rect, { text: '城市', textSize: 14, deactivatedBy: owners.join(','), resetActivationAfter: '1s' }, '城市_名字', taken));
  }
  return out;
}
// 生存模式的地图设置（map_info.type / survivalWaves）
function applySurvival(st) {
  if (st.kind !== 'survival') return;
  const mi = ed.ensureMapInfo();
  const T = ed.map.group('Triggers');
  ed.begin('向导：生存模式');
  ed.op.snapshotGroup(T);
  setObjProp(mi, 'type', 'survival');
  setObjProp(mi, 'survivalWaves', SURVIVAL_WAVES);
  ed.commit();
}
function pushTriggers(objs) {
  if (!objs.length) return;
  const T = trigGroup(true);
  ed.begin('向导：基础触发器');
  ed.op.snapshotGroup(T);
  for (const o of objs) T.objects.push(o);
  ed.commit();
  A.autoDirty = true;
}

// ---------------- 创建（真正的动作，全部用现成 API） ----------------
export async function createFromWizard(st) {
  const tpl = await kvGet('template');
  if (!tpl) throw new Error('还没有图块素材：先打开一张铁锈战争地图（.tmx）再试');
  const t0 = performance.now();
  const size = clamp(+st.size || 160, 60, 300);
  const players = clamp(+st.players || 2, 1, 100);
  const name = String(st.name || '').trim() || (KIND_BY_ID[st.kind] || WIZARD_KINDS[0]).cn;
  const sym = SYM_CN[st.sym] ? st.sym : 'none';
  const poolMax = wizardPlan(st).poolMax;
  // 1) 地形 + 出生点 + 资源池（dialogs.js 的现成实现）
  await createNewMap({
    name, w: size, h: size, players, start: st.kind === 'blank' ? 'blank' : 'gen',
    layout: players > 4 ? 'ring' : 'lr',
    preset: PRESETS[st.preset] ? st.preset : 'continent',
    style: STYLES[st.style] ? st.style : 'temperate',
    sym, seed: +st.seed || 1, pools: clamp(+st.pools || 0, 0, 4), center: clamp(+st.center || 0, 0, 8),
  });
  const map = ed.map;
  // 2) 自动丰富细节（detail.js）：出生点和资源池附近默认受保护
  const detail = STYLE_PRESETS.find((p) => p.id === st.detail);
  let carved = 0;
  if (detail && ed.engine) {
    const work = makeWork({ protect: true });
    await runStack(work, detail.stack, { seed: +st.seed || 1, sym: 'none', yield: size * size > 40000 });
    const res = applyWork(work, '向导：自动细节', {});
    carved = res && res.carved || 0;
  }
  // 3) map_info（生存模式）+ 基础触发器
  applySurvival(st);
  const objs = buildTriggers(st);
  pushTriggers(objs);
  // 4) 收尾：重画、通知各面板
  rend.setMap(map);
  rend.clearCaches && rend.clearCaches();
  rend.buildColors && rend.buildColors();
  rend.pools = ed.poolTiles();
  rend.invalidateAll();
  A.mini.rebuild();
  ed.dirty = true; A.autoDirty = true;
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.classList.add('hidden');
  A.refresh();
  // 5) 立刻跑一遍检查，写进“接下来做什么”清单
  let errors = [], warns = [];
  try {
    const list = runChecks(ed, { triggerIssues: triggerIssues() });
    errors = list.filter((c) => c.level === 'error');
    warns = list.filter((c) => c.level === 'warn');
  } catch (e) { console.warn('向导：检查没跑起来', e); }
  const teams = new Set(ed.spawns().map((s) => s.team)).size;
  const stats = {
    kind: st.kind, name, w: map.width, h: map.height, teams, pools: ed.poolTiles().length, triggers: objs.length,
    poolMax, detail: st.detail, seed: +st.seed || 1, sym, carved,
    errors: errors.map((c) => c.title), warns: warns.map((c) => c.title),
    ms: Math.round(performance.now() - t0),
  };
  if (typeof window !== 'undefined') window.__rwWizardLast = stats;
  return stats;
}

// ---------------- 第 1 步：选类型 ----------------
function stepType(st, onPick) {
  const cards = h('div', { class: 'cards' });
  for (const k of WIZARD_KINDS) {
    cards.append(h('button', {
      class: 'acard', 'data-kind': k.id, style: st.kind === k.id ? 'border-color:var(--accent)' : '',
      onclick: () => onPick(k.id),
    }, h('span', { class: 'ic', html: icon(k.icon) }), h('div', {}, h('b', {}, k.cn), h('small', {}, k.desc))));
  }
  return h('div', {}, h('p', { class: 'hint', style: 'margin-bottom:8px' }, '先选一个玩法。点一下直接进下一步，之后每个答案都能改。'), cards);
}

// ---------------- 第 2 步：回答问题 ----------------
function stepAsk(st) {
  const live = h('div', { class: 'hint', style: 'margin-top:10px' });
  const teamsHint = h('p', { class: 'hint', style: 'margin-top:6px;display:none' }, '普通房间只有 10 队：第 11 队以后的单位和触发器会被游戏跳过，能玩满要在支持更多玩家的房间里测。');
  const upd = () => {
    const size = clamp(+st.size || 160, 60, 300);
    const tier = sizeTier(size, size);
    const plan = wizardPlan(st);
    teamsHint.style.display = plan.players > 10 ? '' : 'none';
    live.innerHTML = `尺寸 <b>${size}×${size}</b> 格 · ${tier.text}<br>` +
      `资源池最多 <b>${plan.poolMax}</b> 个（每队 ${plan.pools} 个 × ${plan.players} 队 + 中央 ${plan.center} 个）<br>` +
      `基础触发器 <b>${plan.total}</b> 个${plan.total ? '：' + plan.list.map((x) => `${x.cn}×${x.n}`).join('、') : '（只保留 map_info）'}`;
  };
  // 尺寸：4 个常用值 + 细调滑杆
  const sizeOut = h('output', {}, String(st.size));
  const presetRow = h('div', { class: 'presets' });
  const mark = () => { for (const b of presetRow.children) b.classList.toggle('on', +b.dataset.size === +st.size); };
  const sizeIn = h('input', {
    type: 'range', min: 100, max: 300, step: 10, value: clamp(+st.size || 160, 100, 300),
    oninput: (e) => { st.size = +e.target.value; sizeOut.textContent = String(st.size); mark(); upd(); },
  });
  for (const [lb, v] of SIZES) {
    presetRow.append(h('button', {
      'data-size': v, onclick: () => { st.size = v; sizeIn.value = v; sizeOut.textContent = String(v); mark(); upd(); },
    }, `${lb} ${v}`));
  }
  mark();
  const nameI = h('input', { value: st.name || '', oninput: (e) => { st.name = e.target.value; } });
  const seedI = h('input', { type: 'number', step: 1, value: st.seed, oninput: (e) => { st.seed = Math.abs(+e.target.value | 0) || 1; } });
  const plI = h('input', { type: 'number', min: 1, max: 100, value: st.players, oninput: (e) => { st.players = clamp(+e.target.value || 1, 1, 100); upd(); } });
  const symSel = select(SYMS, st.sym, (v) => { st.sym = v; upd(); });
  const presetSel = select(Object.entries(PRESETS).map(([k, p]) => [k, p.cn]), st.preset, (v) => { st.preset = v; });
  const styleSel = select(Object.entries(STYLES).map(([k, s]) => [k, s.cn]), st.style, (v) => { st.style = v; });
  const poolsSel = select([0, 1, 2, 3, 4].map((i) => [i, i + ' 个']), st.pools, (v) => { st.pools = +v; upd(); });
  const centerSel = select([0, 1, 2, 4, 6, 8].map((i) => [i, i + ' 个']), st.center, (v) => { st.center = +v; upd(); });
  const detailSel = select([['none', '不加（保持生成的原样）'], ...STYLE_PRESETS.map((p) => [p.id, p.cn])], st.detail, (v) => { st.detail = v; });
  const credI = h('input', { type: 'number', min: 0, max: 99999, step: 500, value: st.credits, disabled: !(st.credits > 0), oninput: (e) => { st.credits = Math.max(0, +e.target.value | 0); upd(); } });
  const credT = toggle('开局资金（每队一条队伍设置）', st.credits > 0, (v) => {
    st.credits = v ? (st.credits > 0 ? st.credits : 4000) : 0;
    credI.value = st.credits; credI.disabled = !v; upd();
  });
  const reinT = toggle('定时援军（开局 2 分钟后每 3 分钟一批坦克）', !!st.reinforce, (v) => { st.reinforce = v; upd(); });
  const cityT = st.kind === 'city' ? toggle('城夺据点触发器（中央城市：守军 + 占领加钱 + 名字变色）', st.city !== false, (v) => { st.city = v; upd(); }) : null;
  upd();
  const box = h('div', {},
    h('div', { class: 'sech', style: 'margin-top:4px' }, h('h3', {}, '地图'), helpBtn('wizard')),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '地图名称'), nameI),
      h('div', {}, h('label', {}, '种子号（同一种子生成同一张图）'), h('div', { class: 'row' }, seedI,
        h('button', { onclick: () => { st.seed = randSeed(); seedI.value = st.seed; }, title: '换一个种子' }, '换一个')))),
    h('label', {}, '尺寸'), presetRow, h('div', { class: 'range', style: 'margin-top:6px' }, sizeIn, sizeOut),
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '队伍与对称')),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '玩家人数（1~100）'), plI),
      h('div', {}, h('label', {}, '对称方式'), symSel)),
    teamsHint,
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '地形与资源')),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '地形预设'), presetSel),
      h('div', {}, h('label', {}, '地形风格'), styleSel)),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '每队身边的资源池'), poolsSel),
      h('div', {}, h('label', {}, '地图中央的公共资源池'), centerSel)),
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '细节与触发器')),
    h('div', {}, h('label', {}, '自动丰富细节'), detailSel),
    h('p', { class: 'hint', style: 'margin-bottom:4px' }, '自动细节会啃边、撒树和草丛；出生点和资源池附近受保护，不会被动到。'),
    credT,
    h('div', { style: 'max-width:180px;margin:2px 0 6px 38px' }, credI),
    reinT,
    cityT,
    st.kind === 'survival' ? h('div', { class: 'hint', style: 'margin-top:6px' }, `生存包固定打开：地图设成生存模式、放 ${clamp(+st.enemyPoints || 3, 1, 8)} 个敌军出生点、写好 3 波敌人（第一波 3 坦克 → 第二波 5 坦克 + 2 重坦 → 最终波 8 坦克 + 4 重坦，打完算赢）。`) : null,
    live);
  return box;
}

// ---------------- 第 3 步：摘要 ----------------
function stepSummary(st) {
  const plan = wizardPlan(st);
  const size = clamp(+st.size || 160, 60, 300);
  const tier = sizeTier(size, size);
  const rows = [
    ['类型', (KIND_BY_ID[st.kind] || WIZARD_KINDS[0]).cn],
    ['尺寸', `${size}×${size} 格 · 每格 20 像素 · ${tier.text}`],
    ['队伍', `${plan.players} 支（第 1~${plan.players} 队）`],
    ['对称', SYM_CN[st.sym] || '不对称'],
    ['地形', `${(PRESETS[st.preset] || PRESETS.continent).cn} · ${(STYLES[st.style] || STYLES.temperate).cn}`],
    ['种子号', String(st.seed)],
    ['资源池', `最多 ${plan.poolMax} 个（每队 ${plan.pools} 个 × ${plan.players} 队 + 中央 ${plan.center} 个，地形不合适时会少放）`],
    ['自动细节', detailCn(st.detail)],
    ['触发器', plan.total ? `${plan.total} 个：${plan.list.map((x) => `${x.cn}×${x.n}`).join('、')}` : '只保留 map_info（不加基础触发器）'],
  ];
  const list = h('div', {});
  for (const [k, v] of rows) list.append(h('div', { class: 'layerrow' }, h('span', { class: 'nm', style: 'color:var(--muted)' }, k), h('span', {}, v)));
  const notes = [];
  if (st.kind === 'city') notes.push('中央城市的建筑要你自己放（单位模式），触发器区域已经盖住中央那块。');
  if (st.kind === 'survival') {
    notes.push('敌军出生点放在离你的基地最远的地图边缘，生成后可以拖动。');
    notes.push('波次写进 map_info.survivalWaves：开局 1:00 / 1:30 / 2:00 三波，最终波打完算赢（[win]），可以在触发器里直接改文字。');
  }
  if (size >= 300 && st.detail !== 'none') notes.push('超大图 + 自动细节会慢一些（这套素材约 0.5 秒，真实全套图块可能到 1~3 秒），进度条出来别以为卡住了。');
  if (plan.players > 10) notes.push('超过 10 队，普通房间玩不到后面几队。');
  return h('div', {
    'data-w': size, 'data-h': size, 'data-teams': plan.players, 'data-pools': plan.poolMax,
    'data-triggers': plan.total, 'data-kind': st.kind, 'data-detail': st.detail, 'data-sym': st.sym,
  },
  h('div', { class: 'card' }, list),
  h('p', { class: 'hint', style: 'margin-top:10px' }, '点“创建地图”后会一次做完：生成地形 → 放出生点和资源池 → 保证各队陆路互通 → 自动丰富细节 → 加基础触发器。生成后可撤销。'),
  notes.map((t) => h('p', { class: 'hint', style: 'margin-top:8px' }, t)));
}

// ---------------- “接下来做什么” ----------------
function nextSteps(st, stats) {
  const kind = KIND_BY_ID[stats.kind] || WIZARD_KINDS[0];
  const items = [
    { ic: 'inspect', t: '检查能不能玩', d: `刚跑过一遍：${stats.errors.length} 个 error、${stats.warns.length} 个提醒${stats.warns.length ? '（' + stats.warns.slice(0, 3).join('；') + '）' : ''}。完整检查里能一键修。`, run: () => A.hooks.openChecks && A.hooks.openChecks() },
    { ic: 'items', t: '放资源池和装饰', d: '物品模式：资源池按 1 格算，树和草丛可以用随机笔刷。', run: () => import('./panels.js').then((m) => m.setMode('items')) },
    { ic: 'units', t: '调出生点和单位', d: '单位模式：拖动出生点、加中立守军，或给城里放建筑。', run: () => import('./panels.js').then((m) => m.setMode('units')) },
    { ic: 'trigger', t: '加更多触发器', d: stats.triggers ? `已经有 ${stats.triggers} 个基础触发器了，可以再加刷兵、文字、胜利条件。` : '触发器模式里有城夺、生存、任务模板和常用积木。', run: () => import('./panels.js').then((m) => m.setMode('triggers')) },
    { ic: 'wand2', t: '再丰富一次细节', d: '自动细节对话框可以换预设、调强度、多版本对比，只改选区也行。', run: () => import('./detailui.js').then((m) => m.detailDialog()) },
  ];
  if (stats.sym !== 'none') items.push({ ic: 'sym', t: '对称检查', d: '对比两边是否一致；不一致可以一键补成对称。', run: () => import('./dialogs.js').then((m) => m.symDiffDialog()) });
  else items.push({ ic: 'terrain', t: '继续画地形', d: '地形模式：画笔、矩形、油漆桶都在左边工具栏。', run: () => import('./panels.js').then((m) => m.setMode('terrain')) });
  items.push({ ic: 'batch', t: '试玩检查清单', d: '进游戏要测哪几项，记下每次结果（推荐先在普通房间测）。', run: () => import('./extras.js').then((m) => m.checklistDialog()) });
  items.push({ ic: 'saveGame', t: '保存到游戏文件夹', d: '地图和封面一起存进游戏，打开就能玩。', run: () => import('./io.js').then((m) => m.saveToGameFlow()) });
  const cards = h('div', { class: 'cards' });
  for (const it of items) {
    cards.append(h('button', { class: 'acard', onclick: () => { closeModal(undefined); setTimeout(() => { try { it.run(); } catch (e) { toast('打不开：' + (e && e.message || e)); } }, 60); } },
      h('span', { class: 'ic', html: icon(it.ic) }), h('div', {}, h('b', {}, it.t), h('small', {}, it.d))));
  }
  return h('div', { 'data-result': JSON.stringify(stats) },
    h('div', { class: 'hint', style: 'margin-bottom:10px', html: `已生成「<b>${stats.name}</b>」：<b>${stats.w}</b>×<b>${stats.h}</b> 格、<b>${stats.teams}</b> 支队伍、<b>${stats.pools}</b> 个资源池、<b>${stats.triggers}</b> 个触发器${stats.detail !== 'none' ? '，自动细节：' + detailCn(stats.detail) : ''}。用时 ${(stats.ms / 1000).toFixed(2)} 秒。` }),
    h('div', { class: 'sech' }, h('h3', {}, `${kind.cn} · 接下来做什么`)),
    cards);
}

// ---------------- 向导对话框 ----------------
export async function wizardDialog() {
  if (!(await kvGet('template'))) {
    const go = await modal('先打开一张地图取素材', h('div', {},
      h('p', {}, '向导会用你已有的铁锈战争地图里的图块素材来生成新地图，所以要先打开一张 .tmx。'),
      h('p', { class: 'hint', style: 'margin-top:8px' }, '编辑器不附带游戏素材。打开任意一张从游戏导出的地图，就会自动取出地面、物品、单位三套图块，之后新建地图都用这套。')),
    [{ label: '知道了', value: 0 }, { label: '去打开地图', value: 1, primary: true }]);
    if (go && A.hooks.openMap) A.hooks.openMap();
    else if (go) toast('从“文件 → 打开地图”选一张 .tmx');
    return;
  }
  const st = wizardKindDefault('1v1');
  let step = 0;
  const body = h('div', {});
  const modalP = modal('地图设计向导', body, [], { wide: true, sticky: true });
  // 底部按钮放进弹窗自带的 .mfoot：内容长的时候不用滚到底也能点“下一步”
  const shell = [...document.querySelectorAll('.modal')].pop();
  const footHost = shell ? shell.querySelector('.mfoot') : null;
  const render = () => {
    body.innerHTML = '';
    body.dataset.wstep = String(step);
    body.dataset.wkind = st.kind;   // 不要叫 data-kind：会和第 1 步的类型卡片撞选择器
    const bar = h('div', { class: 'row', style: 'margin-bottom:10px' });
    ['选类型', '回答问题', '确认并创建'].forEach((t, i) => {
      bar.append(h('span', { class: 'badge', style: i === step ? 'background:var(--accentBg);color:var(--text);border:1px solid var(--accent)' : '' }, `${i + 1}. ${t}`));
    });
    const content = step === 0 ? stepType(st, (id) => { applyKind(st, id); step = 1; render(); })
      : step === 1 ? stepAsk(st) : stepSummary(st);
    const nav = h('div', { class: 'row', style: 'width:100%;justify-content:flex-end' });
    if (step > 0) nav.append(h('button', { 'data-w': 'back', onclick: () => { step--; render(); } }, '上一步'));
    nav.append(h('button', { 'data-w': 'cancel', onclick: () => closeModal(undefined) }, '取消'));
    if (step < 2) nav.append(h('button', { class: 'primary', 'data-w': 'next', onclick: () => { step++; render(); } }, '下一步'));
    else nav.append(h('button', { class: 'primary', 'data-w': 'create', onclick: () => doCreate() }, '创建地图'));
    if (footHost) { footHost.innerHTML = ''; footHost.append(nav); }
    body.append(bar, content);
    if (!footHost) body.append(nav);
  };
  const doCreate = async () => {
    if (ed.dirty && !(await confirmBox('新建地图？', '当前地图还没保存。向导会新建一张地图，未保存的修改会丢（自动保存的副本仍可恢复）。', '仍然创建'))) return;
    closeModal({ ...st });
  };
  render();
  const r = await modalP;
  if (!r) return;
  let stats = null;
  try {
    stats = await busy('正在按向导生成地图…', () => createFromWizard(r));
  } catch (e) {
    console.error(e);
    toast('生成失败：' + (e && e.message || e), 5200);
    return;
  }
  const go = await modal('接下来做什么', nextSteps(r, stats), [{ label: '关闭', value: 0 }, { label: '现在检查一遍', value: 1, primary: true }], { wide: true });
  if (go && A.hooks.openChecks) A.hooks.openChecks();
}

// 给控制台 / 集成测试用的入口（不影响正常使用）
if (typeof window !== 'undefined') window.__rwWizard = { dialog: wizardDialog, create: createFromWizard, kinds: WIZARD_KINDS, plan: wizardPlan };
