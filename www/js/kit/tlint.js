// RWKit · 触发器静态检查。返回 [{sev:'error'|'warn'|'info', code, msg, key}]
import { triggersOf, trigKey } from './tmx.js';
import { TYPES, V, AREA_TYPES, SPAWN_OPTS, parseSpawn, localeBase, tms } from './schema.js';
import { lintText } from './textlint.js';
const REFK = ['activatedBy', 'deactivatedBy', 'alsoActivate', 'whenActivatedIds', 'activateIds'];
const splitList = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
export function lintTriggers(model, opt = {}) {
  const out = []; const add = (sev, code, msg, o) => out.push({ sev, code, msg, key: o ? trigKey(o) : undefined, id: o?.id });
  const trs = triggersOf(model); const W = model.width * model.tw, H = model.height * model.tw;
  const keys = new Map();
  for (const o of trs) { const k = trigKey(o); if (keys.has(k)) add('error', 'G01', `触发器名字/id 重复「${k}」(与 #${keys.get(k).id} 冲突,引用会指错)`, o); else keys.set(k, o); }
  const inbound = new Map(); const graph = new Map();
  for (const o of trs) {
    const ty = o.type.toLowerCase(); const sch = TYPES[ty]; const P = o.props;
    for (const [k, v] of Object.entries(P)) {
      let kind = (sch?.keys && sch.keys[k]) || ({ ...TYPES.basic.keys, ...{} }[k]);
      const common = { id: 'any', activatedBy: 1, whenActivatedIds: 1, alsoActivate: 1, activateIds: 1, deactivatedBy: 1, allToActivate: 'bool', delay: 'time', warmup: 'time', repeatDelay: 'time', resetActivationAfter: 'time', repeatCount: 'int', globalMessage: 'any', globalMessage_delayPerChar: 'any', globalMessage_textColor: 'color', debugMessage: 'any', showOnMap: 'bool', textOffsetX: 'float', textOffsetY: 'float', comment: 'any', team: 'teamTrig' };
      kind = common[k] ?? kind;
      if (kind === undefined) { if (!localeBase(k) && !sch?.loose) add('warn', 'G04', `未知属性「${k}」(${o.type}):拼错的属性游戏会直接忽略`, o); continue; }
      if (kind === 1 || kind === 'any' || kind === 'list') continue;
      const e = V[kind]?.(String(v)); if (e) add('error', 'G03', `${k}:${e}`, o);
    }
    if (P.team !== undefined && /^-?\d+$/.test(P.team)) { const t = +P.team; if (t < -2) add('error', 'G06', `team=${t} 非法`, o); if (opt.teamCount && t >= opt.teamCount) add('error', 'G06', `team=${t} 超出地图队伍数 ${opt.teamCount}`, o); }
    if (AREA_TYPES.has(ty) && (o.w <= 0 || o.h <= 0)) add('error', 'G05', `${o.type} 面积为 0,永远检测不到任何东西`, o);
    if (o.x < -200 && AREA_TYPES.has(ty)) add('warn', 'G10', `检测区放在地图外(x=${o.x})`, o);
    if (AREA_TYPES.has(ty) && (o.x + o.w < 0 || o.y + o.h < 0 || o.x > W || o.y > H)) add('warn', 'G10', `检测区完全在地图外`, o);
    if (ty === 'unitadd' && P.spawnUnits !== undefined) {
      if (!P.spawnUnits.trim()) add('error', 'G07', 'spawnUnits 为空', o);
      for (const it of parseSpawn(P.spawnUnits)) {
        if (it.bad) { add('error', 'G07', `spawnUnits 无法解析「${it.raw}」`, o); continue; }
        if (opt.units && !opt.units.has(it.unit)) add('error', 'G07', `未知单位「${it.unit}」`, o);
        for (const k of Object.keys(it.opts)) if (!SPAWN_OPTS.has(k.toLowerCase())) add('warn', 'G07', `未知刷兵选项「${k}」(${it.unit})`, o);
        if (it.n > 200) add('warn', 'G07', `一次刷 ${it.n} 个 ${it.unit},小心卡顿`, o);
      }
      if (P.team === undefined && !/neutralTeam|aggressiveTeam|setToTeamOfLastAttacker/i.test(P.spawnUnits)) add('info', 'G07', '刷兵没写 team,默认 0 号队', o);
    }
    if (ty === 'changecredits' && P.add === undefined && P.set === undefined) add('warn', 'G04', 'changeCredits 没有 add/set,什么也不会发生', o);
    if (P.allToActivate && /true/i.test(P.allToActivate)) { const n = splitList(P.activatedBy || '').length; const det = ty === 'unitdetect' || ty === 'teamtagdetect'; if (n === 0 && !(det && (P.delay || P.warmup))) add('warn', 'G12', 'allToActivate=true 但没有 activatedBy,无意义', o); else if (n < 2 && !det) add('warn', 'G12', 'allToActivate=true 但只有 1 个来源,无意义', o); }
    if (!P.allToActivate && splitList(P.activatedBy || '').length > 1) add('info', 'G08', `activatedBy 有 ${splitList(P.activatedBy).length} 个来源:默认是「或」,任何一个成立就触发;要「且」请加 allToActivate=true`, o);
    for (const rk of REFK) if (P[rk]) for (const r of splitList(P[rk])) { const tgt = keys.get(r); if (!tgt) add('error', 'G02', `${rk} 引用了不存在的触发器「${r}」`, o); else if (rk === 'activatedBy' || rk === 'whenActivatedIds') { if (!inbound.has(trigKey(o))) inbound.set(trigKey(o), []); inbound.get(trigKey(o)).push(r); } }
    const g = [...splitList(P.activatedBy || '')]; graph.set(trigKey(o), g);
    // 文本
    const texts = []; for (const [k, v] of Object.entries(P)) if (k === 'globalMessage' || k === 'text' || localeBase(k)) texts.push([k, v]);
    for (const [k, v] of texts) for (const i of lintText(v, opt.text || {})) add(i.sev, i.code, `${k}: ${i.msg}`, o);
    if (P.globalMessage && (!P.team && P.team !== '0') && ty !== 'unitadd') { /* globalMessage 在非 unitAdd 上也合法 */ }
  }
  // 环(activatedBy 互指且都不带 reset → 可能锁死)
  const state = new Map();
  const dfs = (k, path) => { state.set(k, 1); for (const r of graph.get(k) || []) { if (!graph.has(r)) continue; if (state.get(r) === 1) { const o = keys.get(k); const cyc = [...path.slice(path.indexOf(r)), r]; if (!cyc.every((c) => keys.get(c)?.props.resetActivationAfter)) add('warn', 'G09', `activatedBy 成环且无 reset:${cyc.join('→')}`, o); } else if (!state.get(r)) dfs(r, [...path, r]); } state.set(k, 2); };
  for (const k of graph.keys()) if (!state.get(k)) dfs(k, [k]);
  // 性能统计
  const full = trs.filter((o) => AREA_TYPES.has(o.type.toLowerCase()) && o.w * o.h >= 0.25 * W * H).length;
  const det = trs.filter((o) => o.type.toLowerCase() === 'unitdetect').length;
  if (full > 400) add('warn', 'P01', `全图级检测区 ${full} 个(每 250ms 都要扫一遍,太多会卡)`);
  if (trs.length > 4000) add('warn', 'P02', `触发器总数 ${trs.length},过多可能拖慢加载`);
  out.stats = { total: trs.length, detect: det, fullMapDetect: full };
  return out;
}
