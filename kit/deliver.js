// RWKit 3.5 · 交付流程（F94–F100 + 交付包/老图体检/加载压力）
import { parseTmx, triggersOf, unitsOf, trigKey } from './tmx.js';
import { allChecks, applyIgnore } from './analysis.js';
import { allChecks35 } from './lint35.js';
import { lintGeo, areaBudget, terrainShares } from './geo35.js';
import { lintPunct, textPanel, lintPlaceholders } from './text35.js';
import { unitBudget, lintCityForces, compareForces, lintUnitNames, forceTable } from './units35.js';
import { teamColorConflicts, checkConfigOf, lintCityTable, cityTable, lintFactionTable, factionTable } from './author.js';
import { openingCheck, captureScenario, Sim } from './tsim.js';
import { levelOf } from './extras.js';
import { diffTriggers } from './refactor.js';
import { perfByFamily } from './more.js';
import { colorAssign } from './mapops.js';

const rank = { error: 3, warn: 2, info: 1 };
const statusOf = (items) => (items.some((i) => i.sev === 'error') ? 'red' : items.some((i) => i.sev === 'warn') ? 'yellow' : 'green');
const lvl = (i) => i.level || levelOf(i.code);

// ---------- F94 一键交付前检查 ----------
// 返回 {sections:[{id,title,status,items,counts}], overall, counts, config};每一段都标了证据强度（模型验证/规格推断/经验）
export function deliveryCheck(model, { rules = {}, ref = null, units = [], vars = null, cities = 3, win = null, geo = true, secs = 30 } = {}) {
  const cfg = checkConfigOf(rules), sections = [], add = (id, title, items, extra = {}) => { items = items.map((i) => ({ ...i, level: lvl(i) })); sections.push({ id, title, status: statusOf(items), items, counts: { error: items.filter((i) => i.sev === 'error').length, warn: items.filter((i) => i.sev === 'warn').length, info: items.filter((i) => i.sev === 'info').length }, ...extra }); };
  const R = { ...rules, text: { lineMax: cfg.lineMax, linesMax: cfg.linesMax, ...(rules.text || {}) } }; const ignore = R.ignore || [];
  const run = (fn) => { try { return fn(); } catch (e) { return [{ sev: 'warn', code: 'F94', msg: `这一项检查本身出错了:${e.message}`, level: '经验' }]; } };
  const k1 = applyIgnore(run(() => allChecks(model, R)), ignore); add('trig', '触发器与规则（既有 80+ 条检查）', k1.kept, { suppressed: k1.suppressed });
  add('new', '3.5 新增检查（map_info/队伍/断句/开局/刷兵区/逻辑/孤城/站位）', run(() => allChecks35(model, { teamCount: R.teams, text: { lineMax: cfg.lineMax, linesMax: cfg.linesMax }, opening: { maxSecs: cfg.openingSecs } })));
  if (geo) add('geo', '地形连通（陆军按陆地+浅水算）', run(() => lintGeo(model, { minGap: cfg.minGap, smallMax: cfg.smallIsland, riverMax: cfg.riverMax, clearance: cfg.clearance, circum: (rules.circumnav || []) })));
  add('text', '文本', [...run(() => lintPunct(model)), ...(vars ? run(() => lintPlaceholders(model, vars)) : [])]);
  const o = run(() => { const r = openingCheck(model, secs); const items = []; if (r.messages > 12) items.push({ sev: 'warn', code: 'F94', msg: `开局 ${secs} 秒内弹出 ${r.messages} 条消息（刷屏）`, level: '模型验证' }); if (r.firedActions.length) items.push({ sev: 'warn', code: 'F94', msg: `开局无人操作就触发了 ${r.firedActions.length} 个动作触发器:${r.firedActions.slice(0, 5).join('、')}`, level: '模型验证' }); return items; }); add('open', `开局模拟（${secs} 秒）`, o);
  const ccs = unitsOf(model).filter((u) => u.props.unit === 'commandCenter'), sample = pickSpread(ccs, cities), caps = [];
  for (const c of sample) { const x = Math.round(c.x), y = Math.round(c.y); try { const s = captureScenario(model, { x: x + 10, y: y + 10, team: ((+c.props.team + 1) % Math.max(2, +(R.teams || 2))) || 0, killAt: 5, capAt: 30, until: 80 }); const early = s.log.filter((l) => !l.msg.startsWith('<<') && l.t < 30); if (early.length > 3) caps.push({ sev: 'warn', code: 'F94', msg: `夺城场景「${c.name || `(${x / 20},${y / 20})`}」：占领前就出了 ${early.length} 条消息`, level: '模型验证' }); } catch (e) { caps.push({ sev: 'info', code: 'F94', msg: `夺城场景「${c.name}」模拟跳过:${e.message}`, level: '经验' }); } }
  add('capture', `夺城场景（抽 ${sample.length} 座城）`, caps);
  if (win) add('win', '胜利条件模拟', run(() => winSim(model, win)));
  const fo = [...run(() => unitBudget(model).issues), ...run(() => lintCityForces(model)), ...run(() => lintUnitNames(model, units)), ...run(() => teamColorConflicts(model)), ...run(() => lintCityTable(cityTable(model))), ...run(() => lintFactionTable(factionTable(model)))];
  if (ref) { const cmp = compareForces(model, ref); for (const r of cmp.rows) if (r.note === '远多于' || r.note === '远少于') fo.push({ sev: 'info', code: 'E86', msg: `兵力「${r.cat}」平均 ${r.mine} 对 参考图 ${r.ref}(${r.note},${r.ratio} 倍）`, level: '模型验证' }); }
  add('force', '兵力/势力', fo);
  const ab = areaBudget(model, { max: cfg.mapBudget }), lp = loadPressure(model); add('perf', '面积与加载压力', [{ sev: ab.sev, code: 'C66', msg: ab.msg, level: '规格推断' }, ...lp.issues]);
  const counts = { error: 0, warn: 0, info: 0 }; for (const s of sections) for (const k of Object.keys(counts)) counts[k] += s.counts[k];
  return { sections, overall: sections.some((s) => s.status === 'red') ? 'red' : sections.some((s) => s.status === 'yellow') ? 'yellow' : 'green', counts, config: cfg };
}
function pickSpread(arr, n) { if (arr.length <= n) return arr; const out = []; for (let i = 0; i < n; i++) out.push(arr[Math.floor((i + 0.5) * arr.length / n)]); return out; }
export const lightText = { green: '🟢 通过', yellow: '🟡 有警告', red: '🔴 有错误' };
export function deliveryText(res) { return [`交付前检查:${lightText[res.overall]}(${res.counts.error} 错误 / ${res.counts.warn} 警告 / ${res.counts.info} 提示）`, ...res.sections.map((s) => `${lightText[s.status]}  ${s.title}  ${s.counts.error}/${s.counts.warn}/${s.counts.info}`)].join('\n'); }

// ---------- 胜利条件模拟（原 hold.mjs 的通用版） ----------
// win = {team, at:[[px,py],...] (要占的城，像素坐标）， pattern:'正则（通报触发器名）', secs:260, label}
export function winSim(model, win) {
  const items = [], secs = win.secs || 260, re = new RegExp(win.pattern || '胜|终|守报');
  const run = (label, pts) => { const s = new Sim(model); for (const [x, y] of pts) s.capture(x, y, win.team); s.run(secs, []); const hit = s.log.filter((l) => re.test(l.name)).map((l) => `${l.t}s ${l.name}`); return hit; };
  const full = run('全占', win.at), less = win.at.length > 1 ? run('少一城', win.at.slice(1)) : null;
  items.push({ sev: full.length ? 'info' : 'error', code: 'B40', msg: full.length ? `${win.label || '全占'}：在 ${secs} 秒内触发 ${full[0]}` : `${win.label || '全占'}：占满所有城后 ${secs} 秒内没有触发任何匹配「${win.pattern}」的触发器`, level: '模型验证' });
  if (less) items.push({ sev: less.length ? 'error' : 'info', code: 'B40', msg: less.length ? `少占一座城也触发了「${less[0]}」，胜利条件太松` : '少占一座城不会触发（符合预期）', level: '模型验证' });
  return items;
}

// ---------- 加载压力估计（粗） ----------
export function loadPressure(model) {
  const trs = triggersOf(model), det = trs.filter((o) => o.type.toLowerCase() === 'unitdetect'); let scan = 0; const tw = model.tw || 20;
  for (const o of det) { const a = (o.w / tw) * (o.h / tw); const ms = parseMs(o.props.resetActivationAfter) ?? parseMs(o.props.repeatDelay) ?? 1000; scan += a / Math.max(0.2, ms / 1000); }
  const objs = model.objects.length, cells = model.width * model.height, fam = perfByFamily(model).slice?.(0, 3) ?? [];
  const score = Math.round((cells / 1e6) * 30 + (trs.length / 1000) * 25 + (unitsOf(model).length / 1000) * 20 + Math.min(40, scan / 20000));
  const issues = []; if (score >= 90) issues.push({ sev: 'warn', code: 'X14', msg: `加载压力估计 ${score}/100(偏高）：地图 ${(cells / 1e6).toFixed(2)}M 格、触发器 ${trs.length}、单位 ${unitsOf(model).length};低端手机可能卡顿（粗略经验公式，非实测）`, level: '经验' }); else if (score >= 70) issues.push({ sev: 'info', code: 'X14', msg: `加载压力估计 ${score}/100(中等，粗略经验公式）`, level: '经验' });
  return { score, scanPerSec: Math.round(scan), triggers: trs.length, detect: det.length, objects: objs, cells, families: fam, issues };
}
const parseMs = (v) => { if (v === undefined || v === '') return null; const m = String(v).match(/^(-?[\d.]+)\s*(ms|s|m)?$/i); if (!m) return null; const n = +m[1]; return m[2] ? (/^s$/i.test(m[2]) ? n * 1000 : /^m$/i.test(m[2]) ? n * 60000 : n) : n; };
export function perfAdvice(model) { const n = model.width * model.height; const mb = Math.round((n * 4 * 2) / 1048576); return { cells: n, approxMB: mb, heavy: n >= 1e6, advice: n >= 1e6 ? '≥100 万格：编辑器里改图建议用「分块」工具；手机上导出前先关闭网格/小地图预览' : '正常' }; }

// ---------- F96 如实声明 / F97 交付说明 ----------
export function honestyStatement(res, { gameTested = false } = {}) {
  const by = { 模型验证: 0, 规格推断: 0, 经验: 0 }; for (const s of res.sections) for (const i of s.items) by[i.level] = (by[i.level] || 0) + 1;
  return ['## 验证情况（如实说明）', '', '- **模型验证**：用本工具里的触发器模拟器、连通性/几何计算得出的结论，可复现，但模拟器不是游戏本体。', '- **规格推断**：依据《铁锈战争触发器教程》PDF 与已知属性表推出的规则检查，没有逐条在游戏里试过。', '- **经验**：来自之前做图踩过的坑与粗略估算（如加载压力），仅供参考。', `- 本次共 ${res.counts.error + res.counts.warn + res.counts.info} 条结果：模型验证 ${by['模型验证'] || 0}、规格推断 ${by['规格推断'] || 0}、经验 ${by['经验'] || 0}。`, gameTested ? '- 已在游戏内实测过上述地图。' : '- **没有在真实游戏里实测**：能否加载、手感、AI 行为、平衡性，都需要你在游戏里确认。', ''].join('\n');
}
export function deliveryNotes(model, res, { title = '地图', ref = null, version = '', extra = '' } = {}) {
  const tp = textPanel(model, ref), ft = forceTable(model), ts = terrainShares(model, ref), cmp = ref ? compareForces(model, ref) : null;
  let md = `# ${title}${version ? ' ' + version : ''} 交付说明\n\n- 地图 ${model.width}×${model.height} 格 · 触发器 ${triggersOf(model).length} · 预置对象 ${unitsOf(model).length} · 队伍 ${ft.teams}\n- 检查结论:${lightText[res.overall]}(${res.counts.error} 错误 / ${res.counts.warn} 警告 / ${res.counts.info} 提示）\n\n## 各项检查\n${res.sections.map((s) => `- ${lightText[s.status]} ${s.title}:${s.counts.error}/${s.counts.warn}/${s.counts.info}`).join('\n')}\n\n## 文本\n- 共 ${tp.count} 条，${tp.chars} 字，中位数 ${tp.median} 字，最长一行 ${tp.maxLine} 字${tp.ratio ? `;对参考图：条数 ${tp.ratio.count} 倍，字数 ${tp.ratio.chars} 倍` : ''}\n\n## 地形占比\n\`\`\`\n${ts.text}\n\`\`\`\n`;
  if (cmp) md += `\n## 兵力对照（每队平均）\n| 类别 | 本图 | 参考图 | 倍数 | 判断 |\n|---|---|---|---|---|\n${cmp.rows.map((r) => `| ${r.cat} | ${r.mine} | ${r.ref} | ${r.ratio ?? '-'} | ${r.note} |`).join('\n')}\n`;
  const bad = res.sections.flatMap((s) => s.items.filter((i) => i.sev !== 'info').map((i) => ({ ...i, sec: s.title })));
  if (bad.length) md += `\n## 仍存在的问题（${bad.length}）\n${bad.slice(0, 30).map((i) => `- [${i.sev === 'error' ? '错误' : '警告'} ${i.code}·${i.level}] ${i.msg}`).join('\n')}${bad.length > 30 ? `\n- ……另有 ${bad.length - 30} 条` : ''}\n`;
  return md + '\n' + honestyStatement(res) + (extra ? '\n' + extra + '\n' : '');
}

// ---------- F98 项目文件：记录输入哈希，避免交旧文件 ----------
export const fnv1a = (s) => { let h = 0x811c9dc5; const str = typeof s === 'string' ? s : String.fromCharCode(...s); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
export function makeProj({ name, version = '', inputs = {}, outputs = {}, scripts = {}, toolVersion = '3.5' }) { return { rwproj: 1, name, version, toolVersion, created: new Date().toISOString(), inputs, outputs, scripts }; }
// 对比：输出文件当前哈希 vs 记录；输入变了但输出没重新生成 → 提示
export function checkProj(proj, current) { const out = []; for (const [f, h] of Object.entries(proj.inputs || {})) if (current[f] === undefined) out.push({ sev: 'warn', code: 'F98', msg: `输入文件 ${f} 找不到`, level: '模型验证' }); else if (current[f] !== h) out.push({ sev: 'warn', code: 'F98', msg: `输入 ${f} 在生成之后改过了（记录 ${h},现在 ${current[f]}），输出可能是旧的，需要重新生成`, level: '模型验证' }); for (const [f, h] of Object.entries(proj.outputs || {})) if (current[f] !== undefined && current[f] !== h) out.push({ sev: 'warn', code: 'F98', msg: `输出 ${f} 被改动过（记录 ${h},现在 ${current[f]}），不是脚本生成的原样`, level: '模型验证' }); return out; }

// ---------- F99 队伍颜色建议 ----------
export function colorAdvice(model) { const teams = [...new Set(unitsOf(model).map((u) => +u.props.team).filter((t) => t >= 0))].sort((a, b) => a - b); const high = teams.filter((t) => t >= 10); const items = []; if (high.length) items.push({ sev: 'info', code: 'F99', msg: `${high.length} 个队伍编号 ≥10(${high.slice(0, 8).join('、')}${high.length > 8 ? '…' : ''})：它们的颜色在游戏内未核对，请进游戏确认是否好区分`, level: '经验' }); let plan = null; try { plan = colorAssign(model); } catch { /* 无建议 */ } return { items, plan, teams: teams.length }; }

// ---------- F100 变更日志：两次导出之间的差异摘要 ----------
export function changeSummary(textBefore, textAfter) {
  const A = parseTmx(textBefore), B = parseTmx(textAfter), d = diffTriggers(textBefore, textAfter), ua = unitsOf(A), ub = unitsOf(B);
  const cnt = (us) => { const m = {}; for (const u of us) { const k = u.props.team + '|' + u.props.unit; m[k] = (m[k] || 0) + 1; } return m; }; const ca = cnt(ua), cb = cnt(ub); const unitDiff = []; for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) if ((ca[k] || 0) !== (cb[k] || 0)) { const [t, u] = k.split('|'); unitDiff.push({ team: +t, unit: u, from: ca[k] || 0, to: cb[k] || 0 }); }
  let ground = 0; if (A.width === B.width && A.height === B.height && A.layers.ground && B.layers.ground) for (let i = 0; i < A.layers.ground.data.length; i++) if (A.layers.ground.data[i] !== B.layers.ground.data[i]) ground++;
  const tpA = textPanel(A), tpB = textPanel(B);
  return { triggers: { added: d.added.length, removed: d.removed.length, changed: d.changed.length, sample: { added: d.added.slice(0, 8), removed: d.removed.slice(0, 8), changed: d.changed.slice(0, 5) } }, units: { before: ua.length, after: ub.length, diff: unitDiff.sort((p, q) => Math.abs(q.to - q.from) - Math.abs(p.to - p.from)).slice(0, 15) }, groundCells: ground, sizeChanged: A.width !== B.width || A.height !== B.height, text: { count: [tpA.count, tpB.count], chars: [tpA.chars, tpB.chars] } };
}
export function changeText(s) { return [`触发器：新增 ${s.triggers.added} / 删除 ${s.triggers.removed} / 修改 ${s.triggers.changed}`, `单位:${s.units.before} → ${s.units.after}${s.units.diff.length ? '(主要:' + s.units.diff.slice(0, 5).map((d) => `${d.team}号${d.unit} ${d.from}→${d.to}`).join('、') + ')' : ''}`, `地形改动:${s.sizeChanged ? '尺寸变了' : s.groundCells + ' 格'}`, `文本:${s.text.count[0]}→${s.text.count[1]} 条，${s.text.chars[0]}→${s.text.chars[1]} 字`].join('\n'); }

// ---------- 老图体检：打开一张旧图，给红黄绿概览 ----------
export function healthSummary(model, opt = {}) { const r = deliveryCheck(model, { ...opt, cities: 2, secs: 20 }); const top = r.sections.flatMap((s) => s.items.filter((i) => i.sev === 'error').map((i) => ({ ...i, sec: s.title }))).slice(0, 8); return { overall: r.overall, counts: r.counts, sections: r.sections.map((s) => ({ id: s.id, title: s.title, status: s.status, counts: s.counts })), top, text: deliveryText(r) }; }

// ---------- 交付包：一个 zip(无压缩 STORE),浏览器/Node 通用 ----------
const crcTab = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcTab[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zipStore(files) {   // files: [{name, data: string|Uint8Array}] → Uint8Array
  const enc = new TextEncoder(), chunks = [], central = []; let off = 0; const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const f of files) { const nm = enc.encode(f.name), d = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(d); const h = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(d.length), ...u32(d.length), ...u16(nm.length), 0, 0]); chunks.push(h, nm, d); central.push({ nm, crc, size: d.length, off }); off += h.length + nm.length + d.length; }
  const cstart = off; for (const c of central) { const h = new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.nm.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(c.off)]); chunks.push(h, c.nm); off += h.length + c.nm.length; }
  const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(central.length), ...u16(central.length), ...u32(off - cstart), ...u32(cstart), 0, 0]); chunks.push(end);
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; } return out;
}
export function buildPackage(tmxText, model, res, { title = '地图', version = '', ref = null, cover = null, notesExtra = '' } = {}) {
  const base = `${title}${version ? '_' + version : ''}`, files = [{ name: `${base}.tmx`, data: tmxText }, { name: `${base}_说明.md`, data: deliveryNotes(model, res, { title, ref, version, extra: notesExtra }) }, { name: `${base}_检查报告.txt`, data: deliveryText(res) + '\n\n' + res.sections.flatMap((s) => [`## ${s.title}`, ...s.items.map((i) => `[${i.sev}] ${i.code}·${i.level} ${i.msg}`)]).join('\n') + '\n' }];
  if (cover) files.push({ name: `${base}_封面.png`, data: cover });
  return { files, zip: zipStore(files), name: `${base}_交付包.zip` };
}
