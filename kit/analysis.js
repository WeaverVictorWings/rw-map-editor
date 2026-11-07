// RWKit · 进阶分析:覆盖率/开局即触发/矛盾条件/一次性触发器/刷出点可通行/颜色对比/重复站位/最小距离/公平性/一页报告
import { triggersOf, trigKey, unitsOf, passability, LAND, NAVAL } from './tmx.js';
import { Sim, openingCheck } from './tsim.js';
import { lintTriggers } from './tlint.js';
import { checkPlacement, landConnectivity } from './grid.js';
import { checkRules } from './rules.js';
import { checkTeams } from './teams.js';
import { lintFacilities, lintStartInDetect, levelOf } from './extras.js';
import { lintLocale, lintShipWater, checkAllies, locate } from './more.js';
export function lintLogic(model, { coverSecs = 300, openSecs = 5 } = {}) {
  const out = []; const add = (sev, code, msg, key) => out.push({ sev, code, msg, key });
  const trs = triggersOf(model);
  for (const o of trs) { const P = o.props; if (o.type.toLowerCase() === 'unitdetect' && P.minUnits !== undefined && P.maxUnits !== undefined && +P.minUnits > +P.maxUnits) add('warn', 'L01', `minUnits(${P.minUnits}) > maxUnits(${P.maxUnits}),这个检测永远不成立`, trigKey(o)); }
  const s = new Sim(model); const first = new Map();
  for (let t = 0; t <= coverSecs * 1000; t += 250) { s.step(); for (const x of s.ts) if (x.fires > 0 && !first.has(x.name)) first.set(x.name, t); }
  const early = [...first].filter(([n, t]) => t <= openSecs * 1000 && s.by.get(n)?.some((x) => ['unitadd', 'changecredits'].includes(x.type) && !x.delay && !x.warm)).map(([n]) => n);
  if (early.length) add('warn', 'L02', `开局 ${openSecs} 秒内就触发了 ${early.length} 个动作类触发器(刷兵/加钱),确认是不是想要的:${early.slice(0, 5).join('、')}`);
  const never = s.ts.filter((x) => !first.has(x.name) && x.type !== 'maptext');
  out.stats = { coverSecs, simulated: s.ts.length, firedInIdle: first.size, neverFiredInIdle: never.length };
  const oneShot = trs.filter((o) => ['unitadd', 'changecredits'].includes(o.type.toLowerCase()) && o.props.resetActivationAfter === undefined && o.props.repeatDelay === undefined && o.props.activatedBy);
  if (oneShot.length) add('info', 'L03', `${oneShot.length} 个动作类触发器没有 reset/repeat,触发一次后保持成立不再重复(若是有意的一次性奖励则正常)`);
  return out;
}
export function lintSpawnCells(model) {
  const out = []; const P = passability(model); const { width: W, height: H, tw } = model;
  for (const o of triggersOf(model)) if (o.type.toLowerCase() === 'unitadd' && o.props.spawnUnits && o.props.spawnUnits !== 'NONE') {
    if (o.x < 0 || o.y < 0) continue; const cx = Math.floor((o.x + o.w / 2) / tw), cy = Math.floor((o.y + o.h / 2) / tw);
    if (cx >= W || cy >= H) { out.push({ sev: 'error', code: 'L04', msg: `刷兵点 (${cx},${cy}) 在地图外`, key: trigKey(o) }); continue; }
    if (!(P[cy * W + cx] & (LAND | NAVAL))) out.push({ sev: 'warn', code: 'L04', msg: `刷兵点 (${cx},${cy}) 在不可通行的格子上,可能刷出失败`, key: trigKey(o) });
  }
  return out;
}
const lum = (hex) => { const m = String(hex).trim().match(/^#(?:[0-9a-f]{2})?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); if (!m) return null; const f = (h) => { const c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[1]) + 0.7152 * f(m[2]) + 0.0722 * f(m[3]); };
export function lintContrast(model, { min = 1.8 } = {}) {
  const out = []; for (const o of triggersOf(model)) { const c = o.props.globalMessage_textColor || o.props.textColor; if (!c) continue; const l = lum(c); if (l === null) continue; const ratio = (l + 0.05) / 0.06; if (ratio < min) out.push({ sev: 'warn', code: 'T07', msg: `文字颜色 ${c} 在深色背景上几乎看不清(对比度 ${ratio.toFixed(1)})`, key: trigKey(o) }); } return out;
}
export function lintLayout(model, { minDist = 0, footprints = {} } = {}) {
  const out = []; const us = unitsOf(model); const cell = new Map();
  for (const u of us) { const k = Math.floor((u.x + 10) / model.tw) + ',' + Math.floor((u.y + 10) / model.tw); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(u); }
  for (const [k, v] of cell) { const b = v.filter((u) => /Factory|commandCenter|extractor|fabricator/i.test(u.props.unit)); if (b.length > 1) out.push({ sev: 'error', code: 'F05', msg: `格子 (${k}) 上叠了 ${b.length} 个建筑:${b.map((u) => u.props.unit).join('、')}` }); }
  if (Object.keys(footprints).length) { const bs = us.filter((u) => footprints[u.props.unit]).map((u) => ({ u, s: footprints[u.props.unit], cx: (u.x + 10) / model.tw, cy: (u.y + 10) / model.tw })); for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], b = bs[j], need = (a.s + b.s) / 2; if (Math.abs(a.cx - b.cx) < need && Math.abs(a.cy - b.cy) < need) out.push({ sev: 'error', code: 'F06', msg: `建筑占地重叠:${a.u.props.unit}(${a.cx | 0},${a.cy | 0}) 与 ${b.u.props.unit}(${b.cx | 0},${b.cy | 0})` }); } }
  if (minDist > 0) { const bl = us.filter((u) => /Factory|commandCenter/.test(u.props.unit) && +u.props.team >= 0); let n = 0; for (let i = 0; i < bl.length; i++) for (let j = i + 1; j < bl.length; j++) if (bl[i].props.team !== bl[j].props.team && Math.hypot(bl[i].x - bl[j].x, bl[i].y - bl[j].y) / model.tw < minDist) { if (n++ < 5) out.push({ sev: 'warn', code: 'F07', msg: `不同队建筑过近(<${minDist}格):team${bl[i].props.team} ${bl[i].props.unit} 与 team${bl[j].props.team} ${bl[j].props.unit}` }); } if (n > 5) out.push({ sev: 'warn', code: 'F07', msg: `……共 ${n} 对过近` }); }
  return out;
}
export function fairness(model) {
  const us = unitsOf(model); const teams = [...new Set(us.filter((u) => +u.props.team >= 0).map((u) => +u.props.team))].sort((a, b) => a - b); const rows = [];
  for (const t of teams) { const mine = us.filter((u) => +u.props.team === t); const cc = mine.filter((u) => u.props.unit === 'commandCenter'); const others = us.filter((u) => u.props.unit === 'commandCenter' && +u.props.team !== t && +u.props.team >= 0); let near = Infinity; for (const a of cc) for (const b of others) near = Math.min(near, Math.hypot(a.x - b.x, a.y - b.y) / model.tw); rows.push({ team: t, cc: cc.length, extractors: mine.filter((u) => /extractor/i.test(u.props.unit)).length, factories: mine.filter((u) => /Factory$/.test(u.props.unit)).length, units: mine.length, nearestEnemyCC: near === Infinity ? null : +near.toFixed(1) }); }
  return rows;
}
export function timeline(model, secs = 120, { quiet = true } = {}) { const s = new Sim(model).run(secs); return s.log.filter((l) => !quiet || !l.msg.startsWith('<<')).map((l) => `${l.t.toFixed(1).padStart(6)}s  ${l.name}  ${l.msg.replace(/\n/g, ' / ').slice(0, 60)}`); }
export function applyIgnore(items, ignore = []) { const ig = ignore.map((s) => { if (typeof s === 'object') return { c: s.code, k: s.key && new RegExp(s.key), why: s.why }; const [c, k] = s.split(':'); return { c, k: k && new RegExp(k) }; }); const kept = items.filter((i) => !ig.some((g) => g.c === i.code && (!g.k || g.k.test(i.key || '')))); return { kept, suppressed: items.length - kept.length }; }
export function allChecks(model, R = {}) { return [...lintTriggers(model, { teamCount: R.teams, text: R.text }), ...lintLogic(model), ...lintSpawnCells(model), ...lintContrast(model), ...lintLayout(model, R), ...checkPlacement(model), ...landConnectivity(model), ...checkRules(model, R), ...checkTeams(model, { expect: R.teams }), ...lintFacilities(model), ...lintStartInDetect(model), ...lintLocale(model), ...lintShipWater(model), ...checkAllies(model)]; }
export function report(model, R = {}, title = '地图质检报告') {
  const { kept, suppressed } = applyIgnore(allChecks(model, R), R.ignore);
  const by = new Map(); for (const i of kept) { const k = `${i.sev}|${i.code}`; if (!by.has(k)) by.set(k, []); by.get(k).push(i); }
  const c = { error: 0, warn: 0, info: 0 }; kept.forEach((i) => c[i.sev]++);
  const o = openingCheck(model, 30); const st = lintLogic(model).stats;
  let md = `# ${title}\n\n- 地图 ${model.width}×${model.height}  ·  触发器 ${triggersOf(model).length}  ·  单位 ${unitsOf(model).length}\n- **${c.error} 错误 / ${c.warn} 警告 / ${c.info} 提示**${suppressed ? `(另有 ${suppressed} 条被规则文件的 ignore 屏蔽)` : ''}\n- 开局 30 秒消息 ${o.messages} 条;空闲模拟 ${st.coverSecs}s 内触发过 ${st.firedInIdle}/${st.simulated} 条\n\n`;
  for (const sev of ['error', 'warn', 'info']) for (const [k, v] of by) if (k.startsWith(sev)) md += `## ${sev === 'error' ? '错误' : sev === 'warn' ? '警告' : '提示'} ${k.split('|')[1]} ×${v.length}(验证等级:${levelOf(k.split('|')[1])})\n${v.slice(0, 5).map((i) => `- ${i.key ? `「${i.key}」` : ''}${i.msg}`).join('\n')}\n\n`;
  if ((R.requirements || []).length) md += `## 项目要求与对应检查\n${R.requirements.map((q) => `- ${q.text}(来源:${q.source || '未注明'};检查:${(q.codes || []).join('/')};当前${(q.codes || []).some((c) => kept.some((i) => i.code === c && i.sev !== 'info')) ? '**未满足**' : '满足'})`).join('\n')}\n\n`;
  md += `## 各队概况\n| 队 | 指挥中心 | 抽取仪 | 工厂 | 单位 | 最近敌方指挥中心(格) |\n|---|---|---|---|---|---|\n${fairness(model).map((r) => `| ${r.team} | ${r.cc} | ${r.extractors} | ${r.factories} | ${r.units} | ${r.nearestEnemyCC ?? '-'} |`).join('\n')}\n`;
  return { md, counts: c, items: kept };
}
