// 触发器模拟器（2.4 #2）：不进游戏就能看到每个触发器在第几秒、因为什么触发，以及为什么会永远不触发
// 只读：不调用 ed.begin / ed.commit，不修改任何对象的 attrs / props，也不碰 localStorage
// 导出：simulateTriggers(ed, opts) 纯计算；simDialog() 界面
// 规则依据：triggers.js 里 TYPES / SPECIAL 的属性表 + research_notes/triggers_spec.md
import { A } from './state.js';
import { UNIT_CN } from './editor.js';
import { CATS, WIN_CONDITIONS, kindOf, defOf, label, parseTime, parseUnits, selectTrigger } from './triggers.js';
import { setMode } from './panels.js';
import { h, modal, closeModal, slider, toggle, segmented, toast } from './ui.js';
import { icon } from './icons.js';

const TW = 20;
const lc = (s) => String(s === undefined || s === null ? '' : s).trim().toLowerCase();
const nv = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const prop = (o, name) => { const n = name.toLowerCase(); const p = o.props.find((q) => q.name.toLowerCase() === n); return p ? p.value : undefined; };
const isTrue = (o, name) => lc(prop(o, name)) === 'true';
const listOf = (v) => String(v === undefined || v === null ? '' : v).split(',').map((s) => s.trim()).filter(Boolean);
const linksOf = (o, name, alias) => { const out = listOf(prop(o, name)); if (alias) out.push(...listOf(prop(o, alias))); return out; };
const uniqLinks = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = lc(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
const rectOf = (o) => ({ x: nv(o.attrs.x), y: nv(o.attrs.y), w: nv(o.attrs.width), h: nv(o.attrs.height) });
const centerTile = (o) => { const r = rectOf(o); return { x: Math.floor((r.x + r.w / 2) / TW), y: Math.floor((r.y + r.h / 2) / TW) }; };
const unitCn = (u) => UNIT_CN[u] || u;
function teamCn(t) {
  if (t === null || t === undefined || t === '') return '所有队伍';
  const n = +t;
  if (n === -1) return '中立';
  if (n === -2) return '敌对中立';
  return Number.isNaN(n) ? `队伍“${t}”` : `第 ${n + 1} 队`;
}
function fmtT(ms) {
  if (ms === null || ms === undefined) return '?';
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s * 100) / 100} 秒`;
  const m = Math.floor(s / 60), r = Math.round((s - m * 60) * 10) / 10;
  return `${m} 分${r ? ' ' + r + ' 秒' : ''}`;
}
function secLabel(sec) {
  const s = Math.round(sec * 10) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = Math.round((s - m * 60) * 10) / 10;
  return `${m}m${r ? r + 's' : ''}`;
}
function winCn(v) { const f = WIN_CONDITIONS.find(([k]) => k && k.toLowerCase() === lc(v)); return f ? f[1] : (v || '默认'); }

// 时间属性：不填 = null；写错 = { bad:true }（靠 parseTime 判断，NaN 表示读不懂）
function timeOf(o, name) {
  const raw = prop(o, name);
  if (raw === undefined || String(raw).trim() === '') return { raw, ms: null, bad: false };
  const ms = parseTime(raw);
  if (Number.isNaN(ms)) return { raw, ms: null, bad: true };
  return { raw, ms, bad: false };
}

// ---------------- 单位分类（游戏里没有“这是不是建筑”的属性，只能按名字猜） ----------------
const TIME_CN = { delay: '延迟', warmup: '持续', resetActivationAfter: '可以再次触发', repeatDelay: '重复间隔' };
const BUILDING_RE = /turret|factory|laboratory|extractor|fabricator|depot|commandcenter|launcher|defence|wall|generator|mine/i;
const BUILDERS = new Set(['builder', 'combateengineer', 'mechengineer', 'buildership']);
const MAIN_BUILDINGS = new Set(['commandcenter', 'landfactory', 'airfactory', 'seafactory', 'mechfactory', 'laboratory']);
const isBuilding = (name) => BUILDING_RE.test(String(name || ''));
const isBuilder = (name) => BUILDERS.has(lc(name)) || /engineer|fabricat/i.test(String(name || ''));

function rectText(r) { return `左 ${Math.round(r.x / TW)}、上 ${Math.round(r.y / TW)}、${Math.round(r.w / TW)}×${Math.round(r.h / TW)} 格`; }

// ---------------- 读取地图里的触发器模型 ----------------
function buildSim(ed, opts) {
  const sim = {
    mi: null, mapType: '', winCond: '', trigs: [], byKey: new Map(), multi: new Map(), deps: new Map(), issues: [],
    units: [], tags: new Map(), credits: new Map(), spawned: 0, removed: 0, unitCap: 8000, unitOverflow: false,
    unitTypes: new Set(), tagAdders: new Set(), initialUnits: 0, points: [], teamInfos: [], unknownTypes: [],
    objectiveCount: 0, mapTriggerCount: 0,
  };
  const map = ed && ed.map;
  if (!map) return sim;
  sim.mi = ed.mapInfo ? ed.mapInfo() : null;
  sim.mapType = sim.mi ? (prop(sim.mi, 'type') || '') : '';
  sim.winCond = sim.mi ? (prop(sim.mi, 'winCondition') || '') : '';
  // 地图上现有的单位（Triggers 层之外的任何对象，只要有 unit 属性）
  if (opts.includeExisting !== false) {
    for (const G of map.groups) {
      if (lc(G.name) === 'triggers') continue;
      for (const o of G.objects) {
        const nm = prop(o, 'unit');
        if (!nm) continue;
        const w = nv(o.attrs.width, 20), hh = nv(o.attrs.height, 20);
        sim.units.push({ name: nm, team: nv(prop(o, 'team'), -1), x: nv(o.attrs.x) + w / 2, y: nv(o.attrs.y) - hh / 2 });
      }
    }
  }
  sim.initialUnits = sim.units.length;
  for (const u of sim.units) sim.unitTypes.add(lc(u.name));
  // Triggers 层
  const G = map.group('Triggers');
  const objs = G ? G.objects : [];
  for (const o of objs) {
    const k = kindOf(o);
    if (k === 'map_info') { if (!sim.mi) sim.mi = o; continue; }
    const def = defOf(o);
    if (!def) { if (!k || k.startsWith('?')) sim.unknownTypes.push({ o, k }); continue; }
    if (def.cat === 'special') {
      if (k === 'team_info') sim.teamInfos.push({ team: prop(o, 'team'), credits: prop(o, 'credits'), o });
      if (k === 'point') sim.points.push(label(o));
      continue;
    }
    sim.trigs.push(makeTrig(o, k, def, sim));
  }
  for (const t of sim.trigs) {
    // 同名触发器（手改 TMX 才会出现）：按时间先后决定谁算“被引用”，byKey 仍留第一条给别的逻辑用
    if (!sim.byKey.has(t.key)) sim.byKey.set(t.key, t);
    if (!sim.multi.has(t.key)) sim.multi.set(t.key, []);
    sim.multi.get(t.key).push(t);
    if (t.type === 'objective') sim.objectiveCount++;
    if (t.type === 'unitAdd') for (const u of parseUnits(prop(t.o, 'spawnUnits'))) if (u.name) sim.unitTypes.add(lc(u.name));
    if (t.type === 'teamTags') for (const tag of listOf(prop(t.o, 'addTeamTags'))) sim.tagAdders.add(lc(tag));
    for (const nm of t.ab) { const key = lc(nm); if (!sim.deps.has(key)) sim.deps.set(key, []); sim.deps.get(key).push(t); }
  }
  // 开局资金（team_info）
  for (const ti of sim.teamInfos) { const t = nv(ti.team, 0); if (!sim.credits.has(t)) sim.credits.set(t, nv(ti.credits, 0)); }
  sim.mapTriggerCount = sim.trigs.length;
  rebuildCounts(sim);
  staticIssues(sim);
  return sim;
}

function makeTrig(o, type, def, sim) {
  const t = {
    o, type, cn: def.cn, cat: def.cat, id: label(o), label: label(o), key: lc(label(o)), idx: sim.trigs.length,
    delayMs: null, warmupMs: 0, resetMs: null, repeatMs: null, badTime: null,
    ab: uniqLinks(linksOf(o, 'activatedBy', 'whenActivatedIds')),
    al: uniqLinks(linksOf(o, 'alsoActivate', 'activateIds')),
    db: uniqLinks(linksOf(o, 'deactivatedBy')),
    allTo: isTrue(o, 'allToActivate'),
    fireCount: 0, firstAt: null, lastAt: 0, condSince: null, condNow: false,
    active: false, abHit: new Set(), fires: [], blockedBy: null, spent: false, capped: false, never: null,
    _cnt: 0, _raw: 0, _cntMax: 0, _rawMax: 0,
  };
  for (const [name, field] of [['delay', 'delayMs'], ['warmup', 'warmupMs'], ['resetActivationAfter', 'resetMs'], ['repeatDelay', 'repeatMs']]) {
    const r = timeOf(o, name);
    if (r.bad) {
      if (!t.badTime) t.badTime = { name, raw: r.raw };
      // 读不懂的时间别当 0 用：那会让“延迟 99 个 9”变成“开局立刻触发”，是错的提示
      t.spent = true;
      continue;
    }
    if (field === 'warmupMs') t.warmupMs = r.ms || 0; else t[field] = r.ms;
  }
  const teamRaw = prop(o, 'team');
  const team = (teamRaw === undefined || String(teamRaw).trim() === '') ? null : nv(teamRaw, 0);
  if (type === 'unitDetect') {
    const minRaw = prop(o, 'minUnits'), maxRaw = prop(o, 'maxUnits');
    const c = {
      kind: 'unit', area: rectOf(o), team, unitType: String(prop(o, 'unitType') || '').trim(),
      min: (minRaw === undefined || String(minRaw).trim() === '') ? 1 : nv(minRaw, 1),
      max: (maxRaw === undefined || String(maxRaw).trim() === '') ? Infinity : nv(maxRaw, Infinity),
      f: {
        onlyBuildings: isTrue(o, 'onlyBuildings'), onlyMainBuildings: isTrue(o, 'onlyMainBuildings'),
        onlyBuilders: isTrue(o, 'onlyBuilders'), onlyIdle: isTrue(o, 'onlyIdle'),
        onlyAttack: isTrue(o, 'onlyAttack'), onlyAttackAir: isTrue(o, 'onlyAttackAir'),
        onlyOnResourcePool: isTrue(o, 'onlyOnResourcePool'), onlyWithTag: String(prop(o, 'onlyWithTag') || '').trim(),
        onlyTechLevel: String(prop(o, 'onlyTechLevel') || '').trim(), includeIncomplete: isTrue(o, 'includeIncomplete'),
      },
    };
    c.match = (u) => {
      if (c.team !== null && u.team !== c.team) return false;
      if (c.unitType && lc(u.name) !== lc(c.unitType)) return false;
      if (c.f.onlyBuildings && !isBuilding(u.name)) return false;
      if (c.f.onlyMainBuildings && !MAIN_BUILDINGS.has(lc(u.name))) return false;
      if (c.f.onlyBuilders && !isBuilder(u.name)) return false;
      return true;
    };
    t.cond = c;
  } else if (type === 'teamTagDetect') {
    t.cond = { kind: 'tag', team: team === null ? 0 : team, tag: String(prop(o, 'teamTag') || '').trim() };
  } else t.cond = { kind: 'none' };
  t.active = t.ab.length === 0;
  return t;
}

// ---------------- 单位计数（增量维护，避免每步扫全图） ----------------
// Tiled 允许从右下往左上拖（宽高为负），这里统一成左上角 + 正宽高
export function normRect(r) {
  const x1 = Math.min(r.x, r.x + r.w), x2 = Math.max(r.x, r.x + r.w);
  const y1 = Math.min(r.y, r.y + r.h), y2 = Math.max(r.y, r.y + r.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
function inRect(r0, u) { const r = normRect(r0); return r.w > 0 && r.h > 0 && u.x >= r.x && u.x <= r.x + r.w && u.y >= r.y && u.y <= r.y + r.h; }
function rebuildCounts(sim) {
  for (const t of sim.trigs) {
    if (t.cond.kind !== 'unit') continue;
    let c = 0, raw = 0;
    for (const u of sim.units) { if (!inRect(t.cond.area, u)) continue; raw++; if (t.cond.match(u)) c++; }
    t._cnt = c; t._raw = raw;
  }
}
function addUnits(sim, x, y, team, names) {
  const added = [];
  for (const nm of names) {
    if (sim.units.length >= sim.unitCap) { sim.unitOverflow = true; break; }
    const u = { name: nm, team, x, y };
    sim.units.push(u); added.push(u); sim.spawned++;
  }
  for (const u of added) for (const t of sim.trigs) {
    if (t.cond.kind !== 'unit' || !inRect(t.cond.area, u)) continue;
    t._raw++;
    if (t.cond.match(u)) t._cnt++;
  }
  return added;
}
function removeUnits(sim, r, team) {
  const keep = [];
  let n = 0;
  for (const u of sim.units) {
    const hit = inRect(r, u) && (team === null || u.team === team);
    if (hit) { n++; continue; }
    keep.push(u);
  }
  if (n) { sim.units = keep; sim.removed += n; rebuildCounts(sim); }
  return n;
}

// ---------------- 条件 ----------------
function condNow(sim, t, tMs) {
  const c = t.cond;
  if (c.kind === 'none') return true;
  if (c.kind === 'unit') return t._cnt >= c.min && t._cnt <= c.max;
  if (c.kind === 'tag') { const s = sim.tags.get(c.team); return !!(s && c.tag && s.has(lc(c.tag))); }
  return false;
}
function condText(t) {
  const c = t.cond;
  if (c.kind === 'unit') {
    const who = c.team === null ? '' : teamCn(c.team) + '的';
    const what = c.unitType ? unitCn(c.unitType) : c.f.onlyBuildings ? '建筑' : c.f.onlyBuilders ? '建造者' : '单位';
    if (c.max === 0) return `区域里没有${who}${what}`;
    if (c.max === Infinity) return `区域里有${c.min > 1 ? '至少 ' + c.min + ' 个' : ''}${who}${what}`;
    return `区域里有 ${c.min}~${c.max} 个${who}${what}`;
  }
  if (c.kind === 'tag') return `${teamCn(c.team)}带有标签「${c.tag || '?'}」`;
  return '';
}
function condDetail(t) {
  const c = t.cond;
  if (c.kind === 'unit') return `${condText(t)}（当时实测 ${t._cnt} 个）`;
  if (c.kind === 'tag') return `${condText(t)}`;
  return '';
}

// ---------------- 静态问题（不用模拟就能看出来的错） ----------------
function staticIssues(sim) {
  const out = sim.issues;
  const seen = new Map();
  for (const t of sim.trigs) seen.set(t.key, (seen.get(t.key) || 0) + 1);
  for (const t of sim.trigs) {
    const t0 = { triggerId: t.id, key: t.key };
    if (t.badTime) out.push({ level: 'error', title: `「${t.label}」的时间「${t.badTime.raw}」游戏读不懂`, detail: `${TIME_CN[t.badTime.name] || t.badTime.name} 要写成 30、30s 或 1.5s（纯数字是毫秒）；超过 10 分钟的多半是多敲了 0。这一条在模拟里按“不会触发”处理。`, ...t0 });
    for (const [arr, cn] of [[t.ab, '被谁激活'], [t.al, '同时激活'], [t.db, '被谁关闭']]) {
      for (const ref of arr) if (!sim.byKey.has(lc(ref))) out.push({ level: 'error', title: `「${t.label}」的“${cn}”里有不存在的「${ref}」`, detail: '名字打错了，或者那个触发器被删了；游戏会忽略这条连接。', ...t0 });
    }
    if (t.cond.kind === 'unit' && (t.cond.area.w <= 0 || t.cond.area.h <= 0)) out.push({ level: 'error', title: `「${t.label}」的检测区域是 0`, detail: `现在是 ${rectText(t.cond.area)}，里面什么都检测不到。`, ...t0 });
    if (t.cond.kind === 'unit' && t.cond.min > t.cond.max) out.push({ level: 'error', title: `「${t.label}」的“至少 ${t.cond.min} 个”比“最多 ${t.cond.max} 个”还大`, detail: '这个条件永远不可能成立。', ...t0 });
    if (t.cond.kind === 'unit' && t.cond.unitType && !sim.unitTypes.has(lc(t.cond.unitType))) out.push({ level: 'error', title: `「${t.label}」的单位类型「${t.cond.unitType}」在地图和刷兵里都找不到`, detail: '这个区域永远数不到这种单位——名字是不是写错了？（大小写不敏感，但要和游戏里的单位名一致）', ...t0 });
    if (t.allTo && !t.ab.length && t.delayMs === null && t.cond.kind === 'none' && !t.badTime) out.push({ level: 'warn', title: `「${t.label}」勾了“全部满足”，但没有任何条件`, detail: '游戏里这种触发器永远不会触发。要么加一个条件，要么去掉这个勾。', ...t0 });
    if (t.cond.kind === 'none' && !t.ab.length && t.delayMs === null && t.repeatMs === null && !t.badTime) out.push({ level: 'info', title: `「${t.label}」开局立刻触发一次`, detail: '没有延迟、没有前置、没有条件，所以第 0 秒就触发。如果不是故意的，给它加个延迟或前置。', ...t0 });
    if (t.repeatMs !== null && t.repeatMs < 100) out.push({ level: 'warn', title: `「${t.label}」的重复间隔只有 ${fmtT(t.repeatMs)}`, detail: '游戏里会变成每帧都做一次，容易卡顿、刷屏。一般至少 1 秒。', ...t0 });
  }
  // 重名
  for (const [k, n] of seen) {
    if (n < 2) continue;
    const t = sim.byKey.get(k);
    out.push({ level: 'info', title: `有 ${n} 个触发器都叫「${t ? t.label : k}」`, detail: '别的触发器按名字引用时，游戏只认第一个。', triggerId: t ? t.id : undefined, key: k });
  }
  for (const u of sim.unknownTypes) out.push({ level: 'warn', title: `「${label(u.o)}」的类型「${u.k}」游戏不认识`, detail: '游戏会跳过它，所以它不会触发也不会出现在时间轴上。' });
  // 地图设置
  if (lc(sim.winCond) === 'requiredobjectives' && !sim.objectiveCount) out.push({ level: 'error', title: '胜利条件是“完成所有任务目标”，但没有任何任务目标触发器', detail: '这局永远不会结束。放一个“任务目标”（objective）触发器，或者把胜利条件改成别的。' });
  if (!sim.mi) out.push({ level: 'info', title: '这张地图没有 map_info', detail: '游戏可能不能正常结算。' });
  // 这次模拟没考虑的筛选
  const ignored = new Set();
  for (const t of sim.trigs) if (t.cond.kind === 'unit') for (const [k, cn] of [['onlyIdle', '只数空闲单位'], ['onlyAttack', '只数能攻击的'], ['onlyAttackAir', '只数能对空的'], ['onlyOnResourcePool', '只数资源池上的建筑'], ['onlyWithTag', '只数带某标签的'], ['onlyTechLevel', '只数某科技等级'], ['includeIncomplete', '算上没建完的建筑']]) if (t.cond.f[k] && t.cond.f[k] !== '' && t.cond.f[k] !== false) ignored.add(cn);
  if (ignored.size) out.push({ level: 'info', title: '有几个筛选条件这次模拟算不了', detail: `这些按“全部通过”处理：${[...ignored].join('、')}。模拟里不知道单位空不空闲、能不能对空、科技等级。` });
  if (!sim.trigs.length) out.push({ level: 'info', title: '这张地图没有触发器', detail: '普通对战图不需要触发器，只要地图设置对就行。' });
}

// ---------------- 循环检测（Tarjan，找互相激活成环） ----------------
function detectCycles(sim) {
  const idx = new Map(); sim.trigs.forEach((t, i) => idx.set(t.key, i));
  const N = sim.trigs.length;
  const adj = new Array(N).fill(0).map(() => []);
  for (let i = 0; i < N; i++) for (const nm of sim.trigs[i].ab) { const k = idx.get(lc(nm)); if (k !== undefined) adj[i].push(k); }
  // 被谁关闭（deactivatedBy / 被停用）也会成环：A 关 B、B 关 A，两边都会卡在“一直被关”里
  for (let i = 0; i < N; i++) for (const nm of (sim.trigs[i].db || [])) { const k = idx.get(lc(nm)); if (k !== undefined) adj[i].push(k); }
  const index = new Int32Array(N).fill(-1), low = new Int32Array(N), onst = new Uint8Array(N), comp = new Int32Array(N).fill(-1);
  const stack = []; let counter = 0, ncomp = 0;
  const strong = (v) => {
    const work = [[v, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const x = top[0];
      if (top[1] === 0) { index[x] = low[x] = counter++; stack.push(x); onst[x] = 1; }
      let advanced = false;
      while (top[1] < adj[x].length) {
        const y = adj[x][top[1]++];
        if (index[y] < 0) { work.push([y, 0]); advanced = true; break; }
        if (onst[y]) low[x] = Math.min(low[x], index[y]);
      }
      if (advanced) continue;
      if (low[x] === index[x]) {
        let y;
        do { y = stack.pop(); onst[y] = 0; comp[y] = ncomp; } while (y !== x);
        ncomp++;
      }
      work.pop();
      if (work.length) { const p = work[work.length - 1][0]; low[p] = Math.min(low[p], low[x]); }
    }
  };
  for (let i = 0; i < N; i++) if (index[i] < 0) strong(i);
  const groups = new Map();
  for (let i = 0; i < N; i++) { if (!groups.has(comp[i])) groups.set(comp[i], []); groups.get(comp[i]).push(i); }
  const out = [];
  for (const list of groups.values()) {
    const self = list.length === 1 && adj[list[0]].includes(list[0]);
    if (list.length > 1 || self) out.push(list.map((i) => sim.trigs[i]));
  }
  return out;
}

// ---------------- 模拟主循环 ----------------
export function simulateTriggers(ed, opts = {}) {
  const horizon = clamp(nv(opts.horizon, 180), 1, 3600);
  const step = clamp(nv(opts.step, 0.25), 0.02, 5);
  const maxEvents = nv(opts.maxEvents, 5000);
  const maxFires = nv(opts.maxFiresPerTrigger, 240);
  const sim = buildSim(ed, opts);
  sim.stepMs = Math.max(10, Math.round(step * 1000));
  const horizonMs = horizon * 1000;
  const events = [];
  let truncated = false;
  const order = sim.trigs.map((t) => ({ t, depth: 0, at: t.delayMs || 0 }));
  // 前置深度：用于同一时刻的稳定排序（前置先算）
  for (let it = 0; it < 24; it++) {
    let ch = false;
    for (const e of order) {
      let d = 0;
      for (const nm of e.t.ab) { const p = sim.byKey.get(lc(nm)); if (p && p !== e.t) d = Math.max(d, (p._depth || 0) + 1); }
      if (d > e.depth && d < 30) { e.depth = d; ch = true; }
    }
    for (const e of order) e.t._depth = e.depth;
    if (!ch) break;
  }
  order.sort((a, b) => a.depth - b.depth || a.at - b.at || (a.t.key < b.t.key ? -1 : a.t.key > b.t.key ? 1 : 0));

  const steps = Math.floor(horizonMs / sim.stepMs) + 1;
  for (let i = 0; i < steps; i++) {
    const tMs = i * sim.stepMs;
    if (tMs > horizonMs) break;
    // 步首：条件快照
    for (const t of sim.trigs) {
      const now = condNow(sim, t, tMs);
      if (now) { if (t.condSince === null) t.condSince = tMs; } else t.condSince = null;
      t.condNow = now;
      if (t._cnt > t._cntMax) t._cntMax = t._cnt;
      if (t._raw > t._rawMax) t._rawMax = t._raw;
    }
    // 同一步里允许链式触发（按深度排序，最多两轮兜底）
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (const e of order) if (tryFire(sim, e.t, tMs, events, maxFires)) any = true;
      if (!any) break;
    }
    if (events.length >= maxEvents) { truncated = true; break; }
  }

  // ---- 事后分析 ----
  const issues = sim.issues;
  if (truncated) issues.push({ level: 'warn', title: `事件太多，模拟在第 ${secLabel(events.length ? events[events.length - 1].t : 0)} 提前结束`, detail: `已经记录 ${events.length} 条事件（上限 ${maxEvents}）。大概率有触发器在无限刷屏，先把循环那几条修掉再看。` });
  if (sim.unitOverflow) issues.push({ level: 'warn', title: `模拟里的单位数量超过了 ${sim.unitCap}`, detail: '后面的刷兵没有算进区域数量，这会让“区域里有几个单位”的条件失真。' });
  const loops = sim.trigs.filter((t) => t.fireCount > 20);
  for (const t of sim.trigs) {
    if (!t.fireCount) { t.never = neverReason(sim, t, horizonMs); if (t.never) issues.push({ level: t.never.level || 'warn', title: `「${t.label}」在 ${horizon} 秒里一次都没触发`, detail: t.never.detail, triggerId: t.id, key: t.key }); }
  }
  // 到了次数上限、但没到“刷屏”标准的（比如 maxFiresPerTrigger 被调小）：也要说清楚是“被截断”，不是自己停的
  for (const t of sim.trigs) {
    if (t.capped && t.fireCount <= 20 && t.fireCount >= maxFires) {
      issues.push({
        level: 'info',
        title: `「${t.label}」还没停，是模拟到 ${maxFires} 次上限就被截断了`,
        detail: '它还会继续触发。想看得更久，把“每个触发器最多触发几次”调大。',
        triggerId: t.id, key: t.key,
      });
    }
  }
  for (const t of loops) {
    const gap = t.repeatMs !== null ? t.repeatMs : t.resetMs;
    const tiny = gap !== null && gap <= sim.stepMs * 2;
    issues.push({
      level: tiny ? 'error' : 'warn',
      title: `「${t.label}」在 ${horizon} 秒里触发了 ${t.fireCount} 次${t.fireCount >= maxFires ? '（已到上限）' : ''}`,
      detail: `${gap !== null ? `间隔 ${fmtT(gap)}；` : '没有间隔设置；'}同一秒内还会连锁触发下游。做“持续加钱 / 持续刷兵”时要确认这是不是你要的密度。`,
      triggerId: t.id, key: t.key,
    });
  }
  for (const cyc of detectCycles(sim)) {
    const names = cyc.map((t) => `「${t.label}」`).join(' → ');
    const maxN = Math.max(...cyc.map((t) => t.fireCount));
    // 全都没触发过：多半是“关闭”连成了环（A 关 B、B 关 A），两边都被卡死
    const allZero = maxN === 0;
    const onlyOff = cyc.every((t) => t.fireCount === 0);
    const kind = onlyOff ? '互相关闭成环' : '互相激活成环';
    issues.push({
      level: maxN > 20 || allZero ? 'error' : 'warn',
      title: `${kind}：${names} → 回到起点`,
      detail: onlyOff
        ? '环上的触发器一次都没触发——它们互相把对方关掉了，游戏里会一直卡在关闭状态。检查“被谁关闭”是不是写反了。'
        : maxN > 20
          ? `环里最多的一条触发了 ${maxN} 次，这会是无限循环 / 刷屏。`
          : '环上的触发器会互相点火。如果只是“条件合并”写法（同名 + 同时激活自己）可以忽略。',
      triggerId: cyc[0].id, key: cyc[0].key,
    });
  }
  // 给问题补上地图坐标，检查对话框可以直接“去看看”
  for (const it of issues) {
    if (it.goto || !it.key) continue;
    const t = sim.byKey.get(it.key);
    if (t) { const c = centerTile(t.o); it.goto = { x: c.x, y: c.y }; }
  }
  const orderLevel = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => (orderLevel[a.level] || 0) - (orderLevel[b.level] || 0));

  const fired = sim.trigs.filter((t) => t.fireCount > 0).length;
  const perTrigger = sim.trigs.map((t) => ({
    id: t.id, label: t.label, cn: t.cn, type: t.type, cat: t.cat, key: t.key,
    firstAt: t.firstAt === null ? null : +(t.firstAt / 1000).toFixed(3),
    count: t.fireCount,
    never: t.never ? t.never.detail : null,
    fires: t.fires,
  }));
  const summary = {
    total: sim.trigs.length, fired, never: sim.trigs.length - fired, loops: loops.length,
    firstFireAt: events.length ? events[0].t : null,
    virtualUnits: sim.spawned,
    unitsEnd: sim.units.length, unitsInitial: sim.initialUnits, unitsRemoved: sim.removed,
    eventTotal: events.length, truncated,
  };
  return {
    horizon, step, events, perTrigger, issues, summary,
    map: {
      type: sim.mapType, winCondition: sim.winCond,
      teams: sim.teamInfos.map((ti) => ({ team: nv(ti.team, 0), credits: nv(ti.credits, 0) })),
      points: sim.points, objectives: sim.objectiveCount,
    },
    assumptions: [
      '不打架、单位不会死：区域里的单位数 = 地图上原有的 + 模拟里刷出来的 − 被删掉的',
      '“被谁关闭”按“那条触发器当前成立”处理：成立期间关着，不成立时自动放开',
      '资金 / 队伍标签 / 文字 / 目标 / 镜头只记事件；“标签检测”看的是本模拟里加过的标签',
      '同一个时间步内的条件按步首快照算，所以刷出来的兵要到下一步才能被检测到',
    ],
  };
}

function tryFire(sim, t, tMs, events, maxFires) {
  if (t.spent) return false;
  if (t.fireCount >= maxFires) { t.capped = true; return false; }
  if (t.fireCount > 0 && t.repeatMs === null && t.resetMs === null) { t.spent = true; return false; }
  const readyAt = t.fireCount === 0 ? (t.delayMs || 0) : t.lastAt + (t.repeatMs !== null ? t.repeatMs : t.resetMs);
  if (tMs < readyAt) return false;
  if (!t.active) return false;
  const blocked = blockReason(sim, t);
  if (blocked) { t.blockedBy = blocked.key; return false; }
  const pureRepeat = t.repeatMs !== null && t.fireCount > 0;
  if (!pureRepeat) {
    if (!t.condNow) return false;
    if (t.warmupMs && tMs - t.condSince < t.warmupMs) return false;
  }
  fire(sim, t, tMs, events);
  return true;
}

function blockReason(sim, t) {
  for (const nm of t.db) {
    const d = sim.byKey.get(lc(nm));
    if (!d || !d.fireCount) continue;
    if (d.repeatMs === null && d.resetMs === null) return d;   // 一次性关闭，之后一直关着
    if (d.condNow) return d;                                    // 现在仍然成立，所以一直被关
  }
  return null;
}

function fire(sim, t, tMs, events) {
  t.fireCount++;
  t.lastAt = tMs;
  if (t.firstAt === null) t.firstAt = tMs;
  if (t.fires.length < 400) t.fires.push(+(tMs / 1000).toFixed(3));
  // 激活下游（被谁激活 / 同时激活）
  for (const dep of sim.deps.get(t.key) || []) {
    if (sim.multi.get(t.key) && sim.multi.get(t.key).length > 1) {
      // 同名多条：只有真正命中的那一条算数（避免“引用一律串到第一条”）
      if (!dep.abHitNames) dep.abHitNames = new Map();
      let set = dep.abHitNames.get(t.key);
      if (!set) { set = new Set(); dep.abHitNames.set(t.key, set); }
      set.add(t);
      dep.abHit = new Set([...set].map((x) => x.key + '#' + (x.idx ?? 0)));
    } else {
      dep.abHit.add(t.key);
    }
    if (!dep.allTo || dep.abHit.size >= dep.ab.length) dep.active = true;
  }
  for (const nm of t.al) { const T = sim.byKey.get(lc(nm)); if (T) T.active = true; }
  const acts = applyActions(sim, t, tMs);
  events.push({
    t: +(tMs / 1000).toFixed(3), time: fmtT(tMs), id: t.id, label: t.label,
    type: t.type, cn: t.cn, why: whyText(t), actions: acts, instance: t.fireCount, key: t.key,
  });
}

function whyText(t) {
  const parts = [];
  parts.push(t.delayMs ? `开局 ${fmtT(t.delayMs)} 后` : '开局');
  if (t.fireCount > 1 && t.repeatMs !== null) parts.push(`重复间隔 ${fmtT(t.repeatMs)}`);
  else if (t.fireCount > 1 && t.resetMs !== null) parts.push(`${fmtT(t.resetMs)} 后复位`);
  if (t.ab.length) parts.push(`「${t.ab.join('」「')}」已触发`);
  if (t.warmupMs) parts.push(`条件持续了 ${fmtT(t.warmupMs)}`);
  const c = condDetail(t);
  if (c) parts.push(c);
  if (!t.ab.length && t.cond.kind === 'none' && !t.delayMs) parts.push('没有条件，到点就做');
  return parts.join(' · ');
}

// 动作：只有刷兵 / 删兵 / 标签会改变模拟状态，其余只记录（和游戏里一样不影响别的触发条件）
function applyActions(sim, t, tMs) {
  const o = t.o, out = [];
  const teamRaw = prop(o, 'team');
  const team = (teamRaw === undefined || String(teamRaw).trim() === '') ? null : nv(teamRaw, 0);
  switch (t.type) {
    case 'unitAdd': {
      const names = [];
      for (const u of parseUnits(prop(o, 'spawnUnits'))) {
        const nm = String(u.name || '').trim(); if (!nm) continue;
        const n = clamp(nv(u.n, 1), 1, 200);
        for (let i = 0; i < n; i++) names.push(nm);
      }
      const c = centerTile(o);
      const added = addUnits(sim, c.x * TW + TW / 2, c.y * TW + TW / 2, team === null ? -1 : team, names);
      const cnt = new Map();
      for (const u of added) cnt.set(lc(u.name), (cnt.get(lc(u.name)) || 0) + 1);
      const txt = [...cnt].map(([n, k]) => unitCn(n) + (k > 1 ? '×' + k : '')).join('、');
      out.push({ type: 'unitAdd', text: `在 (${c.x}, ${c.y}) 给${teamCn(team === null ? -1 : team)}刷出 ${txt || '（没填单位）'}` });
      break;
    }
    case 'unitRemove': {
      const n = removeUnits(sim, rectOf(o), team);
      out.push({ type: 'unitRemove', text: `删掉区域里${team === null ? '所有' : teamCn(team) + '的'}单位 ${n} 个` });
      break;
    }
    case 'changeCredits': {
      if (team === null) { out.push({ type: 'changeCredits', text: '改资金（没填队伍）' }); break; }
      let v = sim.credits.has(team) ? sim.credits.get(team) : 0;
      const setV = prop(o, 'set'), addV = prop(o, 'add');
      if (setV !== undefined && String(setV).trim() !== '') v = nv(setV, v);
      if (addV !== undefined && String(addV).trim() !== '') v += nv(addV, 0);
      sim.credits.set(team, v);
      out.push({ type: 'changeCredits', text: `${teamCn(team)}资金${setV !== undefined ? ' 设为 ' + setV : ''}${addV !== undefined ? ' ' + (nv(addV, 0) >= 0 ? '+' : '') + addV : ''}（本模拟记账：${v}）` });
      break;
    }
    case 'teamTags': {
      const add = listOf(prop(o, 'addTeamTags')), del = listOf(prop(o, 'removeTeamTags'));
      if (team === null) { out.push({ type: 'teamTags', text: '改队伍标签（没填队伍）' }); break; }
      if (!sim.tags.has(team)) sim.tags.set(team, new Set());
      const s = sim.tags.get(team);
      for (const tag of add) s.add(lc(tag));
      for (const tag of del) s.delete(lc(tag));
      out.push({ type: 'teamTags', text: `${teamCn(team)}${add.length ? `加标签「${add.join('、')}」` : ''}${del.length ? `去标签「${del.join('、')}」` : ''}` });
      break;
    }
    case 'mapText': out.push({ type: 'mapText', text: `显示文字「${prop(o, 'text') || ''}」` }); break;
    case 'objective': out.push({ type: 'objective', text: `目标「${prop(o, 'text') || ''}」完成` }); break;
    case 'moveCamera': out.push({ type: 'moveCamera', text: '镜头移到这里' }); break;
    case 'move': out.push({ type: 'move', text: `把单位派往「${prop(o, 'target') || '?'}」` }); break;
    default: out.push({ type: t.type, text: '标记为成立' }); break;
  }
  const gm = prop(o, 'globalMessage');
  if (gm) out.push({ type: 'message', text: `作战日志「${gm}」` });
  return out;
}

// ---------------- 为什么一次都没触发 ----------------
function neverReason(sim, t, horizonMs) {
  if (t.badTime) return { level: 'error', detail: `时间属性 ${t.badTime.name}＝「${t.badTime.raw}」读不懂（要写成 20s 或 500ms），游戏不会触发它` };
  if (t.delayMs !== null && t.delayMs > horizonMs) return { detail: `延迟 ${fmtT(t.delayMs)} 比模拟时长（${fmtT(horizonMs)}）还长；把模拟时长调大就能看到` };
  if (t.ab.length) {
    const missing = t.ab.filter((nm) => !sim.byKey.has(lc(nm)));
    if (missing.length) return { level: 'error', detail: `“被谁激活”里的「${missing.join('」「')}」根本不存在，所以它一直在等` };
    const dead = t.ab.filter((nm) => { const p = sim.byKey.get(lc(nm)); return p && !p.fireCount; });
    if (dead.length) return { detail: `前置触发器「${dead.join('」「')}」自己就没触发，所以它一直在等${t.allTo ? '（勾了“全部满足”，要全部触发才行）' : ''}` };
  }
  if (t.blockedBy) { const d = sim.byKey.get(t.blockedBy); return { detail: `一直被「${d ? d.label : t.blockedBy}」关闭：那条触发器一直成立 / 一直没复位` }; }
  const c = t.cond;
  if (c.kind === 'unit') {
    if (c.area.w <= 0 || c.area.h <= 0) return { level: 'error', detail: '检测区域大小是 0，里面什么都检测不到' };
    if (c.min > c.max) return { level: 'error', detail: `“至少 ${c.min} 个”比“最多 ${c.max} 个”还大，条件不可能成立` };
    if (c.unitType && !sim.unitTypes.has(lc(c.unitType))) return { level: 'error', detail: `单位类型「${c.unitType}」在地图上没有，也没有任何触发器刷这种单位——名字写错了？` };
    if (!t._rawMax) return { detail: '这个区域从头到尾没有单位（包括本次模拟刷出来的）' };
    if (!t._cntMax) return { detail: `区域里最多有过 ${t._rawMax} 个单位，但没有一个符合条件（${[c.team !== null ? '队伍 ' + teamCn(c.team) : '队伍不限', c.unitType ? '类型 ' + unitCn(c.unitType) : '类型不限', `数量 ${c.min}~${c.max === Infinity ? '∞' : c.max}`].join('，')}）` };
    return { detail: `区域里符合条件的最多 ${t._cntMax} 个，要求 ${c.min}~${c.max === Infinity ? '∞' : c.max} 个，一直没到` };
  }
  if (c.kind === 'tag') {
    if (!c.tag) return { level: 'error', detail: '“标签检测”没有填标签名字' };
    if (!sim.tagAdders.has(lc(c.tag))) return { level: 'error', detail: `没有任何触发器给队伍加标签「${c.tag}」，所以这个条件永远不成立` };
    return { detail: `标签「${c.tag}」在 ${fmtT(horizonMs)} 里一直没被加上（可能是加标签的触发器自己没触发）` };
  }
  if (t.cond.kind === 'none' && t.ab.length === 0 && t.delayMs === null) return { detail: '没有任何条件，但也没触发（检查一下时间 / 连接的写法）' };
  return { detail: '条件在模拟时长内一直没有成立' };
}

// ---------------- 界面 ----------------
const S = { horizon: 180, step: 0.25, include: true, filter: 'all', shown: 200, tlMax: 240, cap: true };
let simTimer = 0;

const CSS = `
.simw{display:flex;flex-direction:column;gap:10px}
.simsum{font-size:13px}
.simsum b{color:var(--accent2)}
.simtl{border:1px solid var(--line);border-radius:10px;background:var(--bg2);padding:8px 10px;max-height:300px;overflow:auto}
.simhd{position:relative;height:15px;margin:0 0 4px 148px;font-size:10.5px;color:var(--dim)}
.simhd span{position:absolute;transform:translateX(-50%)}
.simrow{display:flex;align-items:center;gap:8px;height:18px;border-radius:5px}
.simrow:hover{background:var(--bg3)}
.simrow.off{opacity:.5}
.simlab{width:140px;flex:none;font-size:11.5px;color:var(--muted);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.simtr{position:relative;flex:1;height:11px;background:rgba(128,140,160,.14);border-radius:6px;cursor:pointer;overflow:hidden}
.simtr i{position:absolute;top:1.5px;width:6px;height:8px;border-radius:2px;transform:translateX(-3px)}
.simtr b{position:absolute;top:1.5px;height:8px;border-radius:3px;opacity:.8}
.simev{border:1px solid var(--line);border-radius:10px;max-height:300px;overflow:auto;background:var(--bg)}
.simev table.rep td{padding:4px 6px;vertical-align:top}
.simev tr.simrow2{cursor:pointer}
.simev tr.simrow2:hover td{background:var(--bg3)}
.simchk .chk{padding:7px 0}
`;
function ensureCss() {
  if (document.getElementById('simcss')) return;
  const s = document.createElement('style');
  s.id = 'simcss'; s.textContent = CSS;
  document.head.append(s);
}

function catColor(cat) { const c = CATS[cat]; return c ? c.color : '170,176,190'; }

// 跳回编辑器并选中这个触发器（参考 triggers.js 的 selectTrigger）
function jumpTo(key) {
  const T = A.ed.map && A.ed.map.group('Triggers');
  const o = T ? T.objects.find((x) => lc(label(x)) === key) : null;
  closeModal();
  if (!o) { toast('这个触发器已经不在了，重算一下'); return; }
  // 切到“触发器”模式，右边 dock 才会显示这条触发器的设置卡片
  if (A.ed.mode !== 'triggers') setMode('triggers');
  A.ed.showTriggers = true;
  selectTrigger(o, true);
  A.refresh('toolbar', 'dock');
  A.rend.request();
}

export async function simDialog() {
  if (!A.ed.map) { toast('先打开一张地图'); return; }
  ensureCss();
  const res = h('div', { class: 'simw' });
  let last = null;

  const paint = (R) => {
    res.innerHTML = '';
    const sum = R.summary;
    res.append(h('p', { class: 'simsum', style: 'margin:0', html:
      `${R.horizon} 秒 / 步长 ${R.step} 秒：<b>${sum.total}</b> 个触发器里 <b>${sum.fired}</b> 个会触发，共 <b>${sum.eventTotal}</b> 条事件` +
      `${sum.firstFireAt !== null ? `，最早在第 <b>${secLabel(sum.firstFireAt)}</b>` : '，一次都没触发'}` +
      `${sum.never ? `；<b>${sum.never}</b> 个永远不会触发` : ''}${sum.loops ? `；<b>${sum.loops}</b> 个可能刷屏` : ''}` +
      `。发现 <b>${R.issues.filter((i) => i.level !== 'info').length}</b> 个问题${R.ms ? `，模拟耗时 ${R.ms} ms` : ''}。` }));
    const mi = R.map;
    const tinfo = [`地图类型：${({ skirmish: '遭遇战', survival: '生存', mission: '任务', challenge: '挑战' })[mi.type] || mi.type || '没设'}`,
      `胜利条件：${winCn(mi.winCondition)}`, `任务目标：${mi.objectives} 个`, `地图上原有单位：${sum.unitsInitial} 个（${S.include ? '已计入' : '未计入'}）`];
    if (mi.teams.length) tinfo.push('开局资金：' + mi.teams.map((t) => `${teamCn(t.team)} ${t.credits}`).join('、'));
    res.append(h('div', { class: 'hint' }, h('div', {}, tinfo.join(' · ')), h('div', { style: 'margin-top:4px;color:var(--dim)' }, R.assumptions.join('；'))));

    // 时间轴
    const firedCount = R.perTrigger.filter((p) => p.count > 0).length;
    const withIssue = new Set(R.issues.filter((i) => i.key).map((i) => i.key));
    const seg = segmented([['all', `全部 ${R.perTrigger.length}`], ['fired', `会触发 ${firedCount}`], ['bad', `有问题 ${withIssue.size}`]], S.filter, (v) => { S.filter = v; paint(R); });
    res.append(h('div', { class: 'sech', style: 'margin-top:2px' }, h('h3', {}, '时间轴（点一行跳到那个触发器）'), seg));
    let rows = R.perTrigger.slice();
    if (S.filter === 'fired') rows = rows.filter((p) => p.count > 0);
    else if (S.filter === 'bad') rows = rows.filter((p) => withIssue.has(p.key));
    rows.sort((a, b) => (a.firstAt === null ? 1e9 : a.firstAt) - (b.firstAt === null ? 1e9 : b.firstAt) || (a.key < b.key ? -1 : 1));
    const H = R.horizon;
    const pos = (sec) => clamp((sec / H) * 100, 0, 99.6).toFixed(2);
    const tl = h('div', { class: 'simtl' });
    const hd = h('div', { class: 'simhd' });
    for (let i = 0; i <= 6; i++) hd.append(h('span', { style: `left:${(i / 6 * 100).toFixed(2)}%` }, secLabel(H * i / 6)));
    tl.append(hd);
    if (!rows.length) tl.append(h('div', { class: 'hint' }, '这个筛选下没有触发器。'));
    for (const p of rows.slice(0, S.tlMax)) {
      const col = catColor(p.cat);
      const tr = h('div', { class: 'simtr', title: p.never ? `不会触发：${p.never}` : `${p.count} 次，第一次在第 ${p.firstAt} 秒` });
      if (p.fires && p.fires.length) {
        if (p.fires.length > 40) tr.append(h('b', { style: `left:${pos(p.fires[0])}%;width:${Math.max(0.7, pos(p.fires[p.fires.length - 1]) - pos(p.fires[0]))}%;background:rgb(${col})` }));
        else for (const f of p.fires) tr.append(h('i', { style: `left:${pos(f)}%;background:rgb(${col})` }));
      }
      const row = h('div', { class: 'simrow' + (p.count ? '' : ' off'), onclick: () => jumpTo(p.key) },
        h('span', { class: 'simlab', title: `${p.label} · ${p.cn}${p.never ? '（不会触发：' + p.never + '）' : ''}` }, `${p.count ? '●' : '○'} ${p.label}`), tr);
      tl.append(row);
    }
    if (rows.length > S.tlMax) tl.append(h('button', { style: 'margin-top:6px', onclick: () => { S.tlMax += 300; paint(R); } }, `再显示 ${Math.min(300, rows.length - S.tlMax)} 行（共 ${rows.length} 个）`));
    res.append(tl);

    // 事件表
    const perKey = new Map();
    for (const e of R.events) perKey.set(e.key, (perKey.get(e.key) || 0) + 1);
    const spam = new Set([...perKey].filter(([, n]) => n > 20).map(([k]) => k));
    const rowsEv = [];
    const seenEv = new Map();
    for (const e of R.events) {
      const n = seenEv.get(e.key) || 0;
      if (S.cap && spam.has(e.key) && n >= 20) continue;
      seenEv.set(e.key, n + 1);
      rowsEv.push(e);
    }
    res.append(h('div', { class: 'sech', style: 'margin-top:4px' }, h('h3', {}, `事件表（${R.events.length}）`),
      h('span', { style: 'font-size:11.5px;color:var(--dim)' }, `显示 ${rowsEv.length} 条 · 点一行跳到那个触发器`),
      toggle('刷屏的只显示前 20 条', S.cap, (v) => { S.cap = v; paint(R); })));
    if (S.cap && spam.size) res.append(h('div', { class: 'hint', style: 'margin-bottom:6px' }, `刷屏的触发器（${[...spam].map((k) => `「${(R.perTrigger.find((p) => p.key === k) || {}).label || k}」`).join('、')}）每条只显示前 20 条，共 ${[...spam].reduce((a, k) => a + perKey.get(k), 0)} 条；去掉右边的勾可以看全部。`));
    const evBox = h('div', { class: 'simev' });
    if (!R.events.length) evBox.append(h('div', { class: 'hint' }, `这 ${R.horizon} 秒里没有任何触发器触发。把模拟时长调大，或者先看下面的问题列表。`));
    else {
      const tb = h('table', { class: 'rep' }, h('tr', {}, h('th', {}, '时间'), h('th', {}, '触发器'), h('th', {}, '为什么'), h('th', {}, '做了什么')));
      for (const e of rowsEv.slice(0, S.shown)) {
        tb.append(h('tr', { class: 'simrow2', onclick: () => jumpTo(e.key) },
          h('td', { style: 'white-space:nowrap' }, e.time, h('small', { style: 'display:block;color:var(--dim)' }, `#${e.instance}`)),
          h('td', {}, h('b', {}, e.label), h('small', { style: 'display:block;color:var(--dim)' }, e.cn)),
          h('td', { style: 'color:var(--muted)' }, e.why),
          h('td', {}, e.actions.length ? e.actions.map((a) => a.text).join('；') : '—')));
      }
      evBox.append(tb);
      if (rowsEv.length > S.shown) evBox.append(h('button', { style: 'margin:6px 0 8px 6px', onclick: () => { S.shown += 300; paint(R); } }, `再显示 ${Math.min(300, rowsEv.length - S.shown)} 条（共 ${rowsEv.length} 条）`));
    }
    res.append(evBox);

    // 问题列表
    const bad = R.issues.filter((i) => i.level !== 'info');
    res.append(h('div', { class: 'sech', style: 'margin-top:4px' }, h('h3', {}, `问题（${bad.length} 个要紧的，${R.issues.length - bad.length} 条参考）`)));
    const list = h('div', { class: 'simchk' });
    for (const it of R.issues) {
      list.append(h('div', { class: 'chk ' + it.level },
        h('div', { class: 'icn' }, { error: '!', warn: '!', ok: '✓', info: 'i' }[it.level] || 'i'),
        h('div', { style: 'flex:1' }, h('div', { class: 't' }, it.title), it.detail ? h('div', { class: 'd' }, it.detail) : null,
          it.key ? h('div', { class: 'acts' }, h('button', { onclick: () => jumpTo(it.key) }, '去看看')) : null)));
    }
    if (!R.issues.length) list.append(h('div', { class: 'hint' }, '没发现问题。'));
    res.append(list);
    last = R;
  };

  const run = () => {
    const t0 = (window.performance || Date).now();
    const R = simulateTriggers(A.ed, { horizon: S.horizon, step: S.step, includeExisting: S.include });
    R.ms = Math.round(((window.performance || Date).now() - t0) * 10) / 10;
    S.shown = 200;
    paint(R);
  };
  const schedule = () => { clearTimeout(simTimer); simTimer = setTimeout(run, 130); };

  const body = h('div', { class: 'simw' },
    h('div', { class: 'grid2' },
      slider('模拟时长（秒）', 30, 600, S.horizon, (v) => { S.horizon = v; schedule(); }, { step: 30, fmt: (v) => v + ' 秒' }),
      slider('步长（秒）', 0.05, 2, S.step, (v) => { S.step = v; schedule(); }, { step: 0.05, fmt: (v) => (+v).toFixed(2) + ' 秒' })),
    h('div', { class: 'row' },
      toggle('把地图上现有单位算进去', S.include, (v) => { S.include = v; schedule(); }),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'primary', onclick: () => run(), html: icon('timer') + ' 重算' })),
    res);

  run();
  await modal('触发器模拟器（不进游戏看逻辑）', body, [{ label: '关闭', value: 1, primary: true }], { full: true });
  return last;
}
