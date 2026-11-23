// RWKit 3.5 · 新增检查规则（来自教程里的坑 + 做欧陆/美国/亚洲图踩过的坑）
// 全部返回 [{sev:'error'|'warn'|'info', code, msg, key?, id?, level}],level 标明证据强度：模型验证/规格推断/经验。
import { triggersOf, unitsOf, trigKey, passability, terrainClasses, LAND, NAVAL, BUILD } from './tmx.js';
import { poolGaps, pools } from './units.js';
import { PROP_DOC, LIMIT_CONFLICTS, suggestProp, suggestUnit, UNIT_BY_ID, UNSUPPORTED_TYPES, parseTimeFlex, isAir, isShip } from './schema35.js';

const T = (o) => (o.type || '').toLowerCase();
const mk = (out) => (sev, code, msg, o, level = '规格推断') => out.push({ sev, code, msg, key: o ? trigKey(o) : undefined, id: o?.id, level });
const msgOf = (o) => o.props.globalMessage ?? '';
const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const teamsFromUnits = (model) => new Set(unitsOf(model).map((u) => +u.props.team).filter((t) => Number.isInteger(t) && t >= 0));

// B26 map_info：教程第五章第一条 bug —— 没写 map_info,触发器不会被启动，而且不报错
export function lintMapInfo(model) {
  const out = [], add = mk(out);
  const mi = model.objects.filter((o) => o.name === 'map_info' || T(o) === 'map_info');
  const hasTrig = triggersOf(model).length > 0;
  if (!mi.length) add(hasTrig ? 'error' : 'warn', 'M01', hasTrig ? '没有 map_info 对象：有触发器但游戏不会启动它们，而且不报错（教程第五章）' : '没有 map_info 对象（没有触发器时可以不写，但游戏结算可能异常）', null, '规格推断');
  if (mi.length > 1) add('error', 'M02', `map_info 有 ${mi.length} 个，一张地图只能有一个`, mi[1], '规格推断');
  for (const o of mi) {
    const p = o.props; const wc = p.winCondition;
    if (p.loseCondition !== undefined) add('warn', 'M03', 'loseCondition 在游戏 1.15 起已删除，写了也没用（教程注）', o);
    if (wc && !['mainBuildings', 'allUnitsAndBuildings', 'allBuildings', 'commandCenter', 'requiredObjectives', 'none'].includes(wc)) add('error', 'M04', `winCondition=${wc} 不是合法值`, o);
    if (p.fog && !['NONE', 'map', 'los', 'none'].includes(p.fog)) add('error', 'M05', `fog=${p.fog} 只能是 NONE / map / los`, o);
    if (p.type && !['skirmish', 'challenge', 'survival', 'mission'].includes(p.type)) add('warn', 'M06', `type=${p.type} 不是 skirmish/challenge/survival/mission`, o);
    if (wc === 'requiredObjectives' && !triggersOf(model).some((t) => T(t) === 'objective')) add('error', 'M07', 'winCondition=requiredObjectives 但地图里没有 objective 触发器', o);
  }
  const sv = mi.some((o) => o.props.type === 'survival');
  const ap = model.objects.filter((o) => o.name === 'attack_point').length;
  if (sv && ap === 0) add('error', 'M08', '生存地图没有 attack_point（敌军出生点）', null);
  if (ap >= 5) add('info', 'M09', `attack_point 有 ${ap} 个：出生点较多时最后一个可能不出兵（教程：多加一个试试）`, null, '经验');
  return out;
}

// B28/B29 队伍数一致性 —— 美国图曾因"只有前哨的队伍 21"打不开（Could not find team with id: 21）
export function lintTeamConsistency(model, { teamCount } = {}) {
  const out = [], add = mk(out);
  const us = unitsOf(model); const hasStart = new Map(); const hasAny = new Map();
  for (const u of us) { const t = +u.props.team; if (!(t >= 0)) continue; hasAny.set(t, (hasAny.get(t) || 0) + 1); if (['commandCenter', 'builder'].includes(u.props.unit)) hasStart.set(t, (hasStart.get(t) || 0) + 1); }
  const infos = model.objects.filter((o) => T(o) === 'team_info'); const infoTeams = new Set(infos.map((o) => +o.props.team));
  const trigTeams = new Map(); for (const o of triggersOf(model)) { const t = o.props.team; if (t !== undefined && /^\d+$/.test(t)) { const n = +t; if (!trigTeams.has(n)) trigTeams.set(n, o); } }
  for (const [t, n] of hasAny) if (!hasStart.has(t)) add('error', 'N10', `队伍 ${t} 有 ${n} 个单位/建筑，但没有指挥中心也没有建造者：游戏曾因此报 "Could not find team with id: ${t}" 而打不开（队伍数以有出生单位的队伍为准）`, null, '经验（欧陆 21 队全有指挥中心可开，美国图多一支只有前哨的队伍打不开）');
  const maxStart = Math.max(-1, ...hasStart.keys());
  for (const [t, o] of trigTeams) if (t > maxStart) add('error', 'N11', `触发器用到队伍 ${t},但地图只有 0~${maxStart} 号队伍有出生单位：引用不存在的队伍会让游戏出错`, o, '规格推断');
  for (const t of infoTeams) if (t > maxStart && t >= 0) add('warn', 'N12', `team_info 设置了队伍 ${t},超出有出生单位的最大队伍号 ${maxStart}（加载器会跳过未知队伍的设置）`, null, '经验');
  if (teamCount != null && maxStart + 1 !== teamCount) add('warn', 'N13', `有出生单位的队伍数是 ${maxStart + 1},与规则里写的 ${teamCount} 不一致`, null, '经验');
  const gaps = []; for (let t = 0; t <= maxStart; t++) if (!hasStart.has(t)) gaps.push(t); if (gaps.length) add('warn', 'N14', `队伍号不连续：缺 ${gaps.join(',')}`, null, '经验');
  if (maxStart + 1 > 10) add('info', 'N15', `共 ${maxStart + 1} 队；10 号以后的队伍颜色未在游戏内核对`, null, '经验');
  return out;
}

// B30 行宽（可配置，默认 30 字）+ B31 断句
const CLOSERS = '。！？…”」』））";';
export function lintLineBreaks(model, { lineMax = 30, linesMax = 14, keys = ['globalMessage', 'text', 'introText'] } = {}) {
  const out = [], add = mk(out); let l04 = 0;
  for (const o of triggersOf(model)) for (const k of keys) {
    const t = o.props[k]; if (!t) continue; const lines = String(t).split('\n'); const w = Math.max(...lines.map((l) => [...l].length));
    if (w > lineMax) add('error', 'L01', `${k} 有一行 ${w} 字，超过 ${lineMax} 字（超出屏幕显示范围）`, o, '经验');
    if (lines.length > linesMax) add('warn', 'L02', `${k} 共 ${lines.length} 行，超过 ${linesMax} 行`, o, '经验');
    const flat = lines.join('');
    const pairs = [['「', '」'], ['『', '』'], ['“', '”'], ['(', ')'], ['(', ')']];
    for (const [a, b] of pairs) { const na = flat.split(a).length - 1, nb = flat.split(b).length - 1; if (na !== nb) add('warn', 'L03', `${k} 里 ${a}${b} 不成对（引号被拆到别的消息里了？）`, o, '经验'); }
    const last = flat.trimEnd().slice(-1); const next = o.props.activatedBy; if (k === 'globalMessage' && flat.length > 12 && !CLOSERS.includes(last) && last !== '' && !/[:,、，:]/.test(last)) { l04++; if (l04 <= 5) add('info', 'L04', `这条消息没有以句末标点结尾「…${flat.slice(-6)}」`, o, '经验'); }
    if (/[,、，:;;]$/.test(flat.trimEnd()) && !next && o.props.delay === undefined && o.props.warmup === undefined) add('warn', 'L05', `这条消息以逗号/顿号结尾，像是句子被截断了「…${flat.slice(-8)}」`, o, '经验');
    for (let i = 0; i < lines.length - 1; i++) if (/^[,。！？:;、」』”）]/.test(lines[i + 1])) add('warn', 'L06', `第 ${i + 2} 行以标点开头（断句位置不对）`, o, '经验');
  }
  if (l04 > 5) add('info', 'L04', `另有 ${l04 - 5} 条消息没有以句末标点结尾（标题类短句可忽略）`, null, '经验');
  return out;
}

// B32 开局消息时间轴：有 delay、无 activatedBy 的消息 = 绝对时间
export function openingTimeline(model, { until = 600 } = {}) {
  const rows = []; for (const o of triggersOf(model)) { if (!msgOf(o) || o.props.activatedBy) continue; const d = parseTimeFlex(o.props.delay), w = parseTimeFlex(o.props.warmup); const ms = (d && !Number.isNaN(d) ? d.ms : 0) + (w && !Number.isNaN(w) ? w.ms : 0); rows.push({ key: trigKey(o), at: ms / 1000, text: msgOf(o).replace(/\n/g, ' ') }); }
  rows.sort((a, b) => a.at - b.at); const intro = rows.filter((r) => /^(开场|intro)/i.test(r.key));
  return { rows: rows.filter((r) => r.at <= until), introLast: intro.length ? intro[intro.length - 1].at : null, introCount: intro.length };
}
export function lintOpening(model, { maxSecs = 120 } = {}) {
  const out = [], add = mk(out); const t = openingTimeline(model);
  if (t.introLast != null && t.introLast > maxSecs) add('warn', 'O02', `开场介绍共 ${t.introCount} 条，最后一条在 ${Math.round(t.introLast)} 秒才出现（建议 ${maxSecs} 秒内放完）`, null, '模型验证');
  return out;
}

// B33/B34 刷兵区检查：区域压到建筑（刷出失败被挡住）、陆军刷在水里、海军刷在陆地
export function lintSpawnAreas(model) {
  const out = [], add = mk(out); let s12 = 0; const P = passability(model); const W = model.width, tw = model.tw;
  const bld = unitsOf(model).filter((u) => /Factory|Center|turret|fabricator|extractor|Defence|outpost|laboratory|nuke/i.test(u.props.unit));
  for (const o of triggersOf(model)) {
    if (T(o) !== 'unitadd' || !o.props.spawnUnits) continue;
    const x0 = Math.floor(o.x / tw), y0 = Math.floor(o.y / tw), x1 = Math.max(x0, Math.ceil((o.x + o.w) / tw) - 1), y1 = Math.max(y0, Math.ceil((o.y + o.h) / tw) - 1);
    const names = o.props.spawnUnits.split(',').map((s) => s.trim().split(/[*(]/)[0]).filter(Boolean);
    const land = names.filter((n) => UNIT_BY_ID.has(n) && !isAir(n) && !isShip(n) && !/Factory|Center|turret|extractor/i.test(n) && UNIT_BY_ID.get(n).g !== 'bld'), ships = names.filter(isShip);
    let nLand = 0, nWater = 0, cells = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x < 0 || y < 0 || x >= W || y >= model.height) continue; cells++; const p = P[y * W + x]; if (p & LAND) nLand++; if (p & NAVAL) nWater++; }
    if (land.length && cells && nLand === 0) add('error', 'S10', `刷兵区(${cells} 格）里没有一格陆军能站的地方，刷出的 ${land.join('/')} 会失败`, o, '模型验证');
    if (ships.length && cells && nWater === 0) add('error', 'S11', `刷兵区里没有水，刷出的舰船 ${ships.join('/')} 会失败`, o, '模型验证');
    const blocked = bld.filter((b) => b.x < o.x + o.w && b.x + (b.w || tw) > o.x && b.y < o.y + o.h && b.y + (b.h || tw) > o.y);
    if (blocked.length && cells <= 9) { s12++; if (s12 <= 5) add('info', 'S12', `刷兵区很小（${cells} 格）且压着 ${blocked.length} 座建筑，容易"刷出失败（被挡住）"`, o, '模型验证'); }
  }
  if (s12 > 5) add('info', 'S12', `另有 ${s12 - 5} 个小刷兵区压着建筑（中立守军常见，若战报里出现"刷出失败"再处理）`, null, '模型验证');
  return out;
}

// B35 限定冲突 / B36 来源过多 / B37 reset+repeat 混用 / B39 孤立 / B41 覆灭检测 / 拼写建议（教程：漏写 s）
export function lintTriggerLogic35(model, { knownUnits = [] } = {}) {
  const out = [], add = mk(out); const trs = triggersOf(model); const byKey = new Map(trs.map((o) => [trigKey(o), o]));
  const refd = new Set(); for (const o of trs) for (const k of ['activatedBy', 'alsoActivate', 'deactivatedBy']) for (const r of splitList(o.props[k])) refd.add(r);
  const known = new Set(knownUnits);
  for (const o of trs) {
    const P = o.props, ty = T(o);
    if (UNSUPPORTED_TYPES[ty]) add('warn', 'X01', UNSUPPORTED_TYPES[ty], o, '规格推断');
    if (ty === 'unitdetect') for (const [a, b] of LIMIT_CONFLICTS) if (P[a] === 'true' && P[b] === 'true') add('warn', 'D10', `${a} 与 ${b} 同时为 true,通常没有单位能同时满足`, o, '规格推断');
    const src = splitList(P.activatedBy);
    if (src.length > 20) add('warn', 'P10', `activatedBy 有 ${src.length} 个来源，逐个检查会拖慢加载`, o, '经验');
    if (src.length > 1 && P.allToActivate === undefined && ty !== 'basic' && /^占|^胜|^守|^满/.test(trigKey(o)) === false) { /* 默认"或",不报 */ }
    if (P.repeatDelay !== undefined && P.resetActivationAfter !== undefined) add('info', 'R10', 'repeatDelay 与 resetActivationAfter 同时设置：前者是"每隔多久再做一次",后者是"复位后重新检查条件",两个一起用很容易搞混', o, '经验');
    if (P.repeatDelay === undefined && P.resetActivationAfter === undefined && ['unitadd', 'changecredits'].includes(ty) && P.delay === undefined && !src.length) add('info', 'R11', '没有任何激活来源/延迟，开局触发一次后不再重复', o, '经验');
    if (ty === 'basic' && !src.length && !refd.has(trigKey(o)) && P.delay === undefined) add('warn', 'I10', '孤立的 basic 触发器：没有来源也没有人引用', o, '模型验证');
    if (/覆灭|灭\d|eliminated/i.test(trigKey(o)) && ty === 'unitdetect') { if (P.unitType !== 'commandCenter') add('warn', 'E10', '覆灭检测没有限定 unitType=commandCenter（别的建筑/单位也会让它不成立）', o, '经验'); if (!['0'].includes(String(P.maxUnits))) add('warn', 'E11', '覆灭检测应写 maxUnits=0（区域/队伍里一个指挥中心都没有）', o, '经验'); }
    for (const k of Object.keys(P)) { if (PROP_DOC[k] || /^(text|globalMessage|introText)(_[a-zA-Z-]{1,4})?$/.test(k) || k === 'comment' || /^globalMessage_/.test(k)) continue; const s = suggestProp(k); if (s) add('warn', 'G12', `属性「${k}」像是拼错了，是不是「${s}」？（教程：常见错误是漏写 s）`, o, '规格推断'); }
    if (P.spawnUnits) for (const part of P.spawnUnits.split(',')) { const n = part.trim().split(/[*(]/)[0].trim(); if (!n || UNIT_BY_ID.has(n) || known.has(n)) continue; const s = suggestUnit(n); if (s) add('warn', 'U10', `单位名「${n}」不在已知单位表里，是不是「${s}」？`, o, '规格推断'); }
    if (P.warmup !== undefined && P.delay === undefined && ty === 'basic') add('info', 'R12', 'basic 用 warmup 计时：触发后才开始等；如果想"开局后等多久"用 delay', o, '经验');
  }
  // B38 触发器环：全部成员都没有 delay/warmup/reset 时，会在同一帧内互相激活
  const adj = new Map(); for (const o of trs) adj.set(trigKey(o), splitList(o.props.activatedBy).filter((r) => byKey.has(r)));
  const state = new Map(); const stack = []; const cyc = [];
  const dfs = (k) => { state.set(k, 1); stack.push(k); for (const r of adj.get(k) || []) { if (state.get(r) === 1) { cyc.push(stack.slice(stack.indexOf(r))); } else if (!state.get(r)) dfs(r); } stack.pop(); state.set(k, 2); };
  for (const k of adj.keys()) if (!state.get(k)) dfs(k);
  for (const c of cyc.slice(0, 20)) { const timed = c.some((k) => { const p = byKey.get(k).props; return p.delay !== undefined || p.warmup !== undefined || p.resetActivationAfter !== undefined || p.repeatDelay !== undefined; }); add(timed ? 'info' : 'warn', 'C10', `触发器成环:${c.join(' ← ')}${timed ? '（环里有延迟，可能是故意的循环）' : '（没有任何延迟，可能同帧死循环）'}`, byKey.get(c[0]), '模型验证'); }
  return out;
}

// B44 阵营文字颜色一致:rules=[{match:/正则/, color:'#6FB4FF', label}],匹配触发器名
export function lintCampColor(model, rules = []) {
  const out = [], add = mk(out); if (!rules.length) return out;
  const norm = (c) => String(c || '').trim().toLowerCase();
  for (const o of triggersOf(model)) { if (!msgOf(o)) continue; for (const r of rules) { const re = r.match instanceof RegExp ? r.match : new RegExp(r.match); if (re.test(trigKey(o))) { const c = norm(o.props.globalMessage_textColor); if (c !== norm(r.color)) add('warn', 'K10', `「${trigKey(o)}」属于${r.label || '该阵营'},文字色应为 ${r.color},现在是 ${c || '（默认白色）'}`, o, '经验'); break; } } }
  return out;
}

// B47 单位站位：陆军压在水/岩上、建筑压在不可建造格
export function lintUnitStand(model) {
  const out = [], add = mk(out); const P = passability(model); const W = model.width, tw = model.tw; let bad = 0;
  for (const u of unitsOf(model)) {
    const id = u.props.unit; const x = Math.floor((u.x + 1) / tw), y = Math.floor((u.y + 1) / tw); if (x < 0 || y < 0 || x >= W || y >= model.height) { add('error', 'P10', `${id} 在地图外 (${x},${y})`, null); continue; }
    const p = P[y * W + x]; const meta = UNIT_BY_ID.get(id); if (!meta || isAir(id)) continue;
    if (isShip(id)) continue; // 舰船由 lintShipWater 管
    if (meta.g === 'bld') { if (!(p & BUILD) && !/crystal|[eE]xtractor/.test(id)) { bad++; if (bad <= 30) add('warn', 'P11', `建筑 ${id} (${x},${y}) 压在不可建造的格子上`, null, '模型验证'); } }
    else if (!(p & LAND) && !/Spider|hover|Hover/.test(id)) { bad++; if (bad <= 30) add('warn', 'P12', `${id} (${x},${y}) 站在陆军过不去的格子上（水/岩石/悬崖）`, null, '模型验证'); }
  }
  if (bad > 30) add('info', 'P13', `另有 ${bad - 30} 个站位问题未逐条列出`, null);
  return out;
}

// B48 工厂并列分组：同队同类工厂距离 ≤ gap 视为一组，统计组大小
export function factoryGroups(model, { gap = 7 } = {}) {
  const res = new Map(); const fac = unitsOf(model).filter((u) => /Factory$/.test(u.props.unit) && !/^sea/.test(u.props.unit));
  const by = new Map(); for (const u of fac) { const k = u.props.team + '|' + u.props.unit; if (!by.has(k)) by.set(k, []); by.get(k).push(u); }
  for (const [k, arr] of by) { const seen = new Set(); for (let i = 0; i < arr.length; i++) { if (seen.has(i)) continue; let n = 0; const q = [i]; seen.add(i); while (q.length) { const a = arr[q.pop()]; n++; for (let j = 0; j < arr.length; j++) if (!seen.has(j) && Math.hypot(arr[j].x - a.x, arr[j].y - a.y) <= gap * model.tw) { seen.add(j); q.push(j); } } const [t, unit] = k.split('|'); const key = unit; if (!res.has(key)) res.set(key, new Map()); res.get(key).set(n, (res.get(key).get(n) || 0) + 1); } }
  return Object.fromEntries([...res].map(([u, m]) => [u, Object.fromEntries([...m].sort((a, b) => a[0] - b[0]))]));
}

// B49 指挥中心陆路不通：分"真孤岛（只隔着水）"与"被山/悬崖封死"
export function classifyIsolatedCC(model) {
  const { width: W, height: H } = model; const P = passability(model); const tc = terrainClasses(model);
  const label = (ok) => { const lab = new Int32Array(W * H).fill(-1); const size = []; for (let i = 0; i < W * H; i++) if (lab[i] < 0 && ok(i)) { const id = size.length; let n = 0; const st = [i]; lab[i] = id; while (st.length) { const c = st.pop(); n++; const x = c % W, y = (c / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (lab[j] < 0 && ok(j)) { lab[j] = id; st.push(j); } } } size.push(n); } return { lab, size }; };
  const A = label((i) => P[i] & LAND); const B = label((i) => tc.data[i] !== 1 && tc.data[i] !== 3);
  const ccs = unitsOf(model).filter((u) => u.props.unit === 'commandCenter' && +u.props.team >= 0).map((u) => ({ team: +u.props.team, x: Math.floor(u.x / model.tw), y: Math.floor(u.y / model.tw) }));
  if (!ccs.length) return [];
  const cnt = new Map(); for (const c of ccs) { const k = A.lab[c.y * W + c.x]; if (k >= 0) cnt.set(k, (cnt.get(k) || 0) + 1); } let main = -1, mn = -1; for (const [k, n] of cnt) if (n > mn) { mn = n; main = k; }
  const mainB = B.lab[ccs.find((c) => A.lab[c.y * W + c.x] === main)?.y * W + ccs.find((c) => A.lab[c.y * W + c.x] === main)?.x];
  const out = []; for (const c of ccs) { const k = A.lab[c.y * W + c.x]; if (k === main) continue; const kb = B.lab[c.y * W + c.x]; out.push({ ...c, area: k >= 0 ? A.size[k] : 0, kind: kb === mainB ? '被山/悬崖封死（把岩石拿掉就连通）' : '真孤岛（只隔着水）' }); }
  return out;
}
export function lintIsolatedCC(model) { return classifyIsolatedCC(model).map((c) => ({ sev: c.kind.startsWith('被山') ? 'warn' : 'info', code: 'N20', msg: `指挥中心 team${c.team} (${c.x},${c.y}) 陆路不通:${c.kind},所在陆块 ${c.area} 格`, level: '模型验证' })); }

// B42/B43/78 文本统计
export function textStats(model, { keys = ['globalMessage', 'introText', 'text'] } = {}) {
  const msgs = []; for (const o of triggersOf(model)) for (const k of keys) if (o.props[k]) msgs.push(String(o.props[k]));
  const lens = msgs.map((m) => m.replace(/\n/g, '').length).sort((a, b) => a - b); const lines = msgs.flatMap((m) => m.split('\n').map((l) => [...l].length));
  const sentences = new Map(); for (const m of msgs) for (const s of m.replace(/\n/g, '').split(/[。！？]/).map((x) => x.trim()).filter((x) => x.length >= 6)) sentences.set(s, (sentences.get(s) || 0) + 1);
  const total = [...sentences.values()].reduce((a, b) => a + b, 0); const dup = [...sentences.values()].reduce((a, b) => a + (b > 1 ? b - 1 : 0), 0);
  return { count: msgs.length, chars: lens.reduce((a, b) => a + b, 0), median: lens[lens.length >> 1] || 0, max: lens[lens.length - 1] || 0, maxLine: Math.max(0, ...lines), over30: lines.filter((l) => l > 30).length, over40: lines.filter((l) => l > 40).length, dupRate: total ? +(dup / total).toFixed(3) : 0, topDup: [...sentences].filter((e) => e[1] > 3).sort((a, b) => b[1] - a[1]).slice(0, 5) };
}
export function compareTextStats(a, ref, { name = '参考图' } = {}) { const r = (x, y) => (y ? +(x / y).toFixed(2) : null); return { count: [a.count, ref.count, r(a.count, ref.count)], chars: [a.chars, ref.chars, r(a.chars, ref.chars)], median: [a.median, ref.median, r(a.median, ref.median)], note: `相对${name}` }; }

// 汇总
// B45 触发器总数预算 + 最大家族排行（名字里第一个"_"之前算一族）：触发器多了加载会变慢，先看哪一族最占地方
export function triggerBudget(model, { max = 3000, top = 5 } = {}) {
  const ts = triggersOf(model).filter((o) => !['map_info', 'team_info', 'point', 'attack_point', 'camera_start'].includes(T(o))), out = [], fam = new Map();
  for (const o of ts) { const k = (trigKey(o) || '').split('_')[0] || '(无名)'; fam.set(k, (fam.get(k) || 0) + 1); }
  const rank = [...fam].sort((a, b) => b[1] - a[1]).slice(0, top);
  const lvl = ts.length > max ? 'warn' : 'info';
  out.push({ sev: lvl, code: 'B45', msg: `触发器共 ${ts.length} 个${ts.length > max ? `，超过预算 ${max}，大图加载和开局会变慢` : ''}。最大的几族：${rank.map(([k, n]) => `${k}×${n}`).join('、') || '无'}`, level: '经验' });
  return out;
}
// B50 资源池和抽取仪配对：池上没抽取仪（缺口）、抽取仪不在任何池上（多半放错了地方）
export function lintPools(model, { maxList = 5 } = {}) {
  const out = [], gaps = poolGaps(model), allPools = pools(model);
  if (!allPools.length) return out;
  const poolSet = new Set(allPools.map(([x, y]) => x + ',' + y));
  const loose = unitsOf(model).filter((u) => /^extractor/.test(u.props.unit || '')).filter((u) => !poolSet.has(Math.floor(u.x / model.tw) + ',' + Math.floor(u.y / model.tw)));
  if (gaps.length) out.push({ sev: 'info', code: 'B50', msg: `${gaps.length} 个资源池格上没有抽取仪（共 ${allPools.length} 格池）。例如 ${gaps.slice(0, maxList).map(([x, y]) => `(${x},${y})`).join(' ')}。有意留空的话可忽略`, at: [gaps[0][0], gaps[0][1]], level: '模型验证' });
  if (loose.length) out.push({ sev: 'warn', code: 'B50', msg: `${loose.length} 个抽取仪不在任何资源池上（采不到钱）。例如 ${loose.slice(0, maxList).map((u) => `(${Math.floor(u.x / model.tw)},${Math.floor(u.y / model.tw)})`).join(' ')}`, at: [Math.floor(loose[0].x / model.tw), Math.floor(loose[0].y / model.tw)], level: '模型验证' });
  return out;
}

export function allChecks35(model, opt = {}) {
  return [...lintMapInfo(model), ...lintTeamConsistency(model, opt), ...lintLineBreaks(model, opt.text || {}), ...lintOpening(model, opt.opening || {}), ...lintSpawnAreas(model), ...lintTriggerLogic35(model, opt), ...lintCampColor(model, opt.campColors || []), ...lintUnitStand(model), ...lintIsolatedCC(model), ...triggerBudget(model, opt.budget || {}), ...lintPools(model)];
}
