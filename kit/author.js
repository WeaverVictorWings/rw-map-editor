// RWKit 3.5 · 触发器"写作"工具：速记语法、JSON 往返、命名区域、新模板、城市表、势力表、合并建议、规则表单
import { parseTmx, triggersOf, unitsOf, trigKey, esc, unesc, TRIGGER_TYPES } from './tmx.js';
import { insertTriggers } from './templates.js';
import { mapTriggers } from './refactor.js';
import { sortProps, PROP_ORDER, parseTimeFlex } from './schema35.js';
import { eliminationText, autoDelays, wrapHard } from './text35.js';
import { SLOT_COL, slotColor } from './teams.js';

const TW = 20;
const csvNum = (v) => (v === undefined || v === '' ? undefined : +v);

// ======== 1. 触发器速记语法 ========
// 一行一个触发器:   名字: 类型 @(格x,格y) [宽x高] { 属性=值， 属性="带空格/换行的值" }
// 例：检测A: unitDetect @(120,80) 3x3 { unitType=commandCenter, maxUnits=0, resetActivationAfter=600s }
export function parseDsl(src, { tw = TW } = {}) {
  const list = [], errors = []; const lines = String(src).split(/\r?\n/);
  const re = /^\s*([^:\s][^:]*?)\s*[:：]\s*([A-Za-z_][\w]*)\s*(?:@\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\))?\s*(?:(\d+)\s*[x×]\s*(\d+))?\s*(?:\{([\s\S]*)\})?\s*$/;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+#[^"]*$/, '').trim(); if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const m = line.match(re); if (!m) { errors.push({ line: i + 1, msg: '看不懂这一行（格式：名字: 类型 @(x,y) 宽x高 { 属性=值， … })', text: raw }); return; }
    const [, name, type, x, y, w, h, body] = m; const props = {};
    if (body) { let k = 0; const s = body; while (k < s.length) { while (/[\s,，]/.test(s[k] || '')) k++; if (k >= s.length) break; const eq = s.indexOf('=', k); if (eq < 0) { errors.push({ line: i + 1, msg: `属性缺少 "=":${s.slice(k, k + 20)}` }); break; } const key = s.slice(k, eq).trim(); k = eq + 1; let v; if (s[k] === '"') { let j = k + 1, buf = ''; while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && s[j + 1] === 'n') { buf += '\n'; j += 2; } else if (s[j] === '\\' && s[j + 1] === '"') { buf += '"'; j += 2; } else buf += s[j++]; } v = buf; k = j + 1; } else { let j = k; while (j < s.length && s[j] !== ',' && s[j] !== '，') j++; v = s.slice(k, j).trim(); k = j; } props[key] = v; } }
    list.push({ name: name.trim(), type, x: Math.round((x === undefined ? 0 : +x) * tw), y: Math.round((y === undefined ? 0 : +y) * tw), w: Math.round((w === undefined ? 1 : +w) * tw), h: Math.round((h === undefined ? 1 : +h) * tw), props });
  });
  return { list, errors };
}
export function toDsl(model, { keys = null } = {}) {
  const q = (v) => (/[\s,"{}#\n]/.test(v) || v === '' ? '"' + String(v).replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"' : v); const tw = model.tw || TW;
  return triggersOf(model).filter((o) => !keys || keys.includes(trigKey(o))).map((o) => { const ps = sortProps(o.props); const body = Object.entries(ps).map(([k, v]) => `${k}=${q(v)}`).join(', '); return `${trigKey(o)}: ${o.type} @(${+(o.x / tw).toFixed(2)},${+(o.y / tw).toFixed(2)}) ${+(o.w / tw).toFixed(2)}x${+(o.h / tw).toFixed(2)} { ${body} }`; }).join('\n') + '\n';
}
export function insertDsl(text, src, group = 'Triggers') { const r = parseDsl(src); if (r.errors.length) throw new Error(r.errors.map((e) => `第 ${e.line} 行:${e.msg}`).join('\n')); return { text: insertTriggers(text, r.list, group), count: r.list.length }; }

// ======== 2. 触发器 JSON 往返（稳定排序，减少 diff 噪音） ========
export function exportTriggersJson(model, { sort = 'name' } = {}) {
  const arr = triggersOf(model).map((o) => ({ name: o.name, type: o.type, x: o.x, y: o.y, w: o.w, h: o.h, props: sortProps(o.props) }));
  if (sort === 'name') arr.sort((a, b) => (trigKey({ props: a.props, name: a.name }) < trigKey({ props: b.props, name: b.name }) ? -1 : 1));
  return JSON.stringify({ rwkit: 3.5, triggers: arr }, null, 1) + '\n';
}
// 已存在的（按名字/id）更新，不存在的追加；返回 {text, updated, added}
export function importTriggersJson(text, json, group = 'Triggers') {
  const data = typeof json === 'string' ? JSON.parse(json) : json; const arr = data.triggers || data; const by = new Map(arr.map((t) => [trigKey({ props: t.props || {}, name: t.name }), t]));
  const seen = new Set(); let updated = 0;
  const r = mapTriggers(text, (a, p, k) => { const t = by.get(k); if (!t) return null; seen.add(k); const na = { ...a, x: t.x, y: t.y, width: t.w, height: t.h, type: t.type }; const same = JSON.stringify(sortProps(p)) === JSON.stringify(sortProps(t.props || {})) && +a.x === t.x && +a.y === t.y && +a.width === t.w && +a.height === t.h; if (same) return null; updated++; return { attrs: na, props: sortProps(t.props || {}) }; });
  const add = arr.filter((t) => !seen.has(trigKey({ props: t.props || {}, name: t.name })) && !parseTmx(r.text).objects.some((o) => TRIGGER_TYPES.has(o.type.toLowerCase()) && trigKey(o) === trigKey({ props: t.props || {}, name: t.name })));
  const out = add.length ? insertTriggers(r.text, add.map((t) => ({ name: t.name, type: t.type, x: t.x, y: t.y, w: t.w, h: t.h, props: t.props || {} })), group) : r.text;
  return { text: out, updated, added: add.length };
}
// 属性顺序统一：保存时按 PROP_ORDER 排，减少 diff
export function sortAllProps(text) { return mapTriggers(text, (a, p) => { const s = sortProps(p); return JSON.stringify(Object.keys(s)) === JSON.stringify(Object.keys(p)) ? null : { props: s }; }); }

// ======== 3. 命名区域 ========
export const makeZones = (list = []) => list.map((z) => ({ name: z.name, box: z.box.map(Math.round), note: z.note || '' }));
export const zoneAt = (zones, x, y) => zones.filter((z) => x >= z.box[0] && x <= z.box[2] && y >= z.box[1] && y <= z.box[3]).map((z) => z.name);
export function zoneReport(model, zones) {
  const us = unitsOf(model), ts = triggersOf(model);
  return zones.map((z) => { const inU = us.filter((u) => { const x = Math.round(u.x / model.tw), y = Math.round(u.y / model.tw); return zoneAt([z], x, y).length; }), inT = ts.filter((o) => { const x = Math.round((o.x + o.w / 2) / model.tw), y = Math.round((o.y + o.h / 2) / model.tw); return zoneAt([z], x, y).length; }); const cc = inU.filter((u) => u.props.unit === 'commandCenter'); return { name: z.name, box: z.box, units: inU.length, triggers: inT.length, cities: cc.length, teams: [...new Set(cc.map((u) => +u.props.team))].sort((a, b) => a - b) }; });
}

// ======== 4. 新模板（全部带参数说明，供界面生成表单） ========
const P = (n) => Math.round(n * TW);
const unitAdd = (name, cx, cy, props) => ({ name, type: 'unitAdd', x: P(cx), y: P(cy), w: TW, h: TW, props });
const secs = (n) => (n % 1 === 0 ? `${n}s` : `${Math.round(n * 1000)}ms`);
export const TEMPLATES35 = {
  holdCities: {
    title: '多城守满 N 分钟', desc: '某队同时握有 minCities 座城，持续 holdMin 分钟后发胜利通报；中途丢城会取消计时。最终效果（真正判胜）请按你的玩法在 finalProps 里加。',
    params: [{ k: 'id', label: '触发器前缀', type: 'text', def: '守城' }, { k: 'team', label: '队伍', type: 'int', def: 0 }, { k: 'box', label: '检测区域（格 x0,y0,宽，高）', type: 'box', def: [0, 0, 100, 100] }, { k: 'minCities', label: '至少城数', type: 'int', def: 5 }, { k: 'holdMin', label: '需要守住（分钟）', type: 'num', def: 5 }, { k: 'text', label: '通报文字', type: 'text', def: '守住了！' }, { k: 'color', label: '文字颜色', type: 'color', def: '#FFD24A' }],
    build: ({ id = '守城', team, box, minCities, holdMin = 5, text = '', color = '#FFD24A' }) => [
      { name: `${id}检测`, type: 'unitDetect', x: P(box[0]), y: P(box[1]), w: P(box[2]), h: P(box[3]), props: { unitType: 'commandCenter', minUnits: minCities, team, resetActivationAfter: '5s' } },
      unitAdd(`${id}计时`, box[0], box[1], { team: -1, activatedBy: `${id}检测`, deactivatedBy: `${id}失守`, warmup: secs(holdMin * 60), globalMessage: wrapHard(text, 30), globalMessage_textColor: color }),
      { name: `${id}失守`, type: 'unitDetect', x: P(box[0]), y: P(box[1]), w: P(box[2]), h: P(box[3]), props: { unitType: 'commandCenter', maxUnits: minCities - 1, team, resetActivationAfter: '5s', deactivatedBy: `${id}计时` } }],
  },
  eliminationChain: {
    title: '覆灭连锁（~200 字多条）', desc: '某队所有指挥中心消失 → 按顺序播放约 chars 字的覆灭文字。文字是草稿，建议再润色。',
    params: [{ k: 'team', label: '队伍', type: 'int', def: 1 }, { k: 'name', label: '势力名', type: 'text', def: '某国' }, { k: 'capital', label: '首都', type: 'text', def: '首都' }, { k: 'foe', label: '征服者', type: 'text', def: '敌军' }, { k: 'chars', label: '字数', type: 'int', def: 200 }, { k: 'color', label: '文字颜色', type: 'color', def: '#FFFFFF' }, { k: 'W', label: '地图宽（格）', type: 'int', def: 1000 }, { k: 'H', label: '地图高（格）', type: 'int', def: 1000 }],
    build: ({ team, name, capital, foe, chars = 200, color = '#FFFFFF', W, H, facts = [] }) => { const e = eliminationText({ name, capital, foe, chars, facts, seed: team + 1 }); const id = `覆灭${name}`; const out = [{ name: id, type: 'unitDetect', x: 0, y: 0, w: P(W), h: P(H), props: { unitType: 'commandCenter', maxUnits: 0, team, resetActivationAfter: '3600s' } }]; e.plan.forEach((p, i) => out.push(unitAdd(`${id}${i + 1}`, 0, 1, { team: -1, activatedBy: id, warmup: fmtMsT(p.at + 1500), globalMessage: p.text, globalMessage_textColor: color }))); return out; },
  },
  phaseAnnounce: {
    title: '阶段通报', desc: '按时间表（分：秒 + 文字）发通报。每行一条:`5:00 第一阶段开始`。',
    params: [{ k: 'id', label: '前缀', type: 'text', def: '阶段' }, { k: 'rows', label: '时间表', type: 'multiline', def: '5:00 第一阶段开始\n10:00 第二阶段开始' }, { k: 'color', label: '文字颜色', type: 'color', def: '#FFD24A' }],
    build: ({ id = '阶段', rows, color = '#FFD24A' }) => String(rows).split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => { const m = l.match(/^(\d+):(\d{1,2})\s+(.+)$/); if (!m) throw new Error(`第 ${i + 1} 行格式应为「分：秒 文字」`); return unitAdd(`${id}${i + 1}`, 0, 0, { team: -1, warmup: secs(+m[1] * 60 + +m[2]), globalMessage: wrapHard(m[3], 30), globalMessage_textColor: color }); }),
  },
  reinforceWaves: {
    title: '增援波次', desc: '每隔 every 秒在区域里给某队刷一批兵，共 waves 波（有限波次，不会无限刷）。',
    params: [{ k: 'id', label: '前缀', type: 'text', def: '增援' }, { k: 'team', label: '队伍', type: 'int', def: 0 }, { k: 'at', label: '刷出位置（格 x,y）', type: 'pt', def: [10, 10] }, { k: 'units', label: '单位（如 heavyTank*5）', type: 'text', def: 'heavyTank*5' }, { k: 'start', label: '首波（秒）', type: 'int', def: 120 }, { k: 'every', label: '间隔（秒）', type: 'int', def: 90 }, { k: 'waves', label: '波数', type: 'int', def: 4 }, { k: 'text', label: '每波提示（可空）', type: 'text', def: '' }],
    build: ({ id = '增援', team, at, units, start = 120, every = 90, waves = 4, text = '' }) => Array.from({ length: waves }, (_, i) => unitAdd(`${id}${i + 1}`, at[0], at[1], { team, spawnUnits: units, warmup: secs(start + every * i), ...(text ? { globalMessage: wrapHard(text, 30) } : {}) })),
  },
  airdrop: {
    title: '空投', desc: '在指定时刻、指定位置空降一批单位并发提示。',
    params: [{ k: 'id', label: '名字', type: 'text', def: '空投' }, { k: 'team', label: '队伍', type: 'int', def: 0 }, { k: 'at', label: '位置', type: 'pt', def: [50, 50] }, { k: 'units', label: '单位', type: 'text', def: 'heavyTank*4' }, { k: 'when', label: '时间（秒）', type: 'int', def: 300 }, { k: 'text', label: '提示', type: 'text', def: '空降部队已抵达！' }],
    build: ({ id = '空投', team, at, units, when = 300, text = '' }) => [unitAdd(id, at[0], at[1], { team, spawnUnits: units, warmup: secs(when), ...(text ? { globalMessage: wrapHard(text, 30) } : {}) })],
  },
};
const fmtMsT = (ms) => (ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`);
export function buildTemplate(name, params) { const t = TEMPLATES35[name]; if (!t) throw new Error('没有这个模板:' + name + '(可选:' + Object.keys(TEMPLATES35).join('、') + ')'); return t.build(params); }

// ======== 5. 城市表 ========
export function cityTable(model) { return unitsOf(model).filter((u) => u.props.unit === 'commandCenter').map((u) => ({ id: u.id, name: u.name || '', x: Math.round(u.x / model.tw), y: Math.round(u.y / model.tw), team: +u.props.team })); }
export function lintCityTable(rows) { const out = [], seen = new Map(); for (const r of rows) { if (r.name) { if (seen.has(r.name)) out.push({ sev: 'warn', code: 'X05', msg: `城市名「${r.name}」重复:(${seen.get(r.name)}) 和 (${r.x},${r.y})`, level: '模型验证' }); else seen.set(r.name, `${r.x},${r.y}`); } else out.push({ sev: 'info', code: 'X05', msg: `(${r.x},${r.y}) 的指挥中心没有名字（战报里显示不出来）`, level: '模型验证' }); } return out; }
const patchObjects = (text, pred, fn) => text.replace(/<object\s+([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g, (all, as, tail, body) => { const a = {}; for (const m of as.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = unesc(m[2]); const p = {}; for (const m of (body || '').matchAll(/<property\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/property>)/g)) { const q = {}; for (const k of m[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) q[k[1]] = unesc(k[2]); p[q.name] = q.value !== undefined ? q.value : unesc(m[2] || ''); } if (!pred(a, p)) return all; const r = fn(a, p); if (!r) return all; const na = r.attrs || a, np = r.props || p; const at = Object.entries(na).map(([k, v]) => `${k}="${esc(v)}"`).join(' '); return Object.keys(np).length ? `<object ${at}><properties>${Object.entries(np).map(([k, v]) => `<property name="${esc(k)}" value="${esc(v)}" />`).join('')}</properties></object>` : `<object ${at}/>`; });
export function applyCityTable(text, rows) { const by = new Map(rows.map((r) => [String(r.id), r])); let n = 0; const out = patchObjects(text, (a, p) => p.unit === 'commandCenter' && by.has(a.id), (a, p) => { const r = by.get(a.id), na = { ...a }, np = { ...p }; const tw = +(text.match(/tilewidth="(\d+)"/) || [])[1] || TW; let ch = false; if (r.name !== (a.name || '')) { na.name = r.name; ch = true; } if (String(r.team) !== String(p.team)) { np.team = String(r.team); ch = true; } if (r.x * tw !== +a.x || r.y * tw !== +a.y) { na.x = r.x * tw; na.y = r.y * tw; ch = true; } if (ch) n++; return ch ? { attrs: na, props: np } : null; }); return { text: out, changed: n }; }

// ======== 6. 势力配置表（team_info） ========
export const FACTION_FIELDS = ['credits', 'lockAiDifficulty', 'ai', 'allyGroup', 'disabledAI', 'startingUnits'];
export function factionTable(model) {
  const infos = model.objects.filter((o) => (o.type || '').toLowerCase() === 'team_info'), cc = unitsOf(model).filter((u) => u.props.unit === 'commandCenter'); const teams = new Set([...infos.map((o) => +o.props.team), ...cc.map((u) => +u.props.team)].filter((t) => t >= 0));
  return [...teams].sort((a, b) => a - b).map((t) => { const i = infos.find((o) => +o.props.team === t); const props = i ? i.props : {}; return { team: t, id: i ? i.id : null, hasInfo: !!i, cities: cc.filter((u) => +u.props.team === t).length, color: slotColor(t), ...Object.fromEntries(FACTION_FIELDS.map((f) => [f, props[f] ?? ''])) }; });
}
export function applyFactionTable(text, rows) {
  const by = new Map(rows.filter((r) => r.hasInfo).map((r) => [String(r.id), r])); let n = 0;
  const out = patchObjects(text, (a, p) => (a.type || '').toLowerCase() === 'team_info' && by.has(a.id), (a, p) => { const r = by.get(a.id), np = { ...p }; let ch = false; for (const f of FACTION_FIELDS) { const v = r[f]; if (v === '' || v === undefined) { if (f in np) { delete np[f]; ch = true; } } else if (String(np[f]) !== String(v)) { np[f] = String(v); ch = true; } } if (ch) n++; return ch ? { props: np } : null; });
  return { text: out, changed: n };
}
export function lintFactionTable(rows) { const out = []; for (const r of rows) { const d = r.lockAiDifficulty; if (d !== '' && d !== undefined && (+d < -2 || +d > 3 || Number.isNaN(+d))) out.push({ sev: 'error', code: 'X06', msg: `${r.team} 号 lockAiDifficulty=${d} 超出 -2~3(过大值会崩溃）`, level: '规格推断' }); if (!r.hasInfo && r.cities > 0) out.push({ sev: 'info', code: 'X06', msg: `${r.team} 号有 ${r.cities} 座城但没有 team_info(用默认设置）`, level: '模型验证' }); } return out; }

// ======== 7. 触发器合并建议 ========
// 同一签名（类型+属性，忽略名字/位置/激活关系）的触发器多、且区域相邻 → 可合并成一个更大的检测区，少扫几次
export function mergeSuggestions(model, { minGroup = 4, slack = 1.6 } = {}) {
  const sig = (o) => o.type.toLowerCase() + '|' + Object.entries(o.props).filter(([k]) => !/^(id|activatedBy|deactivatedBy|alsoActivate|whenActivatedIds|globalMessage|text|warmup|delay)/.test(k)).sort().map(([k, v]) => k + '=' + v).join(';');
  const groups = new Map(); for (const o of triggersOf(model)) { if (o.type.toLowerCase() !== 'unitdetect') continue; const s = sig(o); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(o); }
  const out = [];
  for (const [s, arr] of groups) {
    if (arr.length < minGroup) continue; const cells = arr.map((o) => ({ o, x0: o.x / model.tw, y0: o.y / model.tw, x1: (o.x + o.w) / model.tw, y1: (o.y + o.h) / model.tw }));
    // 并查集：框相距 ≤ 8 格就算相邻
    const par = cells.map((_, i) => i), f = (i) => (par[i] === i ? i : (par[i] = f(par[i])));
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) { const A = cells[i], B = cells[j]; if (Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1) <= 8 && Math.max(A.y0, B.y0) - Math.min(A.y1, B.y1) <= 8) par[f(i)] = f(j); }
    const comp = new Map(); cells.forEach((c, i) => { const r = f(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(c); });
    for (const members of comp.values()) { if (members.length < minGroup) continue; const x0 = Math.min(...members.map((c) => c.x0)), y0 = Math.min(...members.map((c) => c.y0)), x1 = Math.max(...members.map((c) => c.x1)), y1 = Math.max(...members.map((c) => c.y1)); const sum = members.reduce((a, c) => a + (c.x1 - c.x0) * (c.y1 - c.y0), 0), bb = (x1 - x0) * (y1 - y0); if (bb <= sum * slack * 3) out.push({ count: members.length, keys: members.slice(0, 6).map((c) => trigKey(c.o)), bbox: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)], sumArea: Math.round(sum), bboxArea: Math.round(bb), note: bb <= sum * slack ? '合并后扫描面积几乎不变' : '合并后面积变大，但触发器数量减少' }); }
  }
  return out.sort((a, b) => b.count - a.count);
}

// ======== 8. 规则文件表单 ========
export const RULES_SCHEMA = [
  { k: 'teams', label: '队伍数', type: 'int', hint: '地图用到的队伍总数（0 起）' }, { k: 'mapSize', label: '地图尺寸 [宽，高]', type: 'pair', hint: '防止脚本覆盖已有底图' },
  { k: 'forbidClasses', label: '禁用地形类', type: 'list', hint: '例：岩浆、森林' }, { k: 'forbidGids', label: '禁用图块 gid', type: 'list', hint: '' },
  { k: 'noUnits', label: '禁放单位', type: 'list', hint: '正则或单位名，如 ^landFactoryT2' }, { k: 'text', label: '文本规则', type: 'object', hint: '{lineMax, linesMax, banned[]}' },
  { k: 'check', label: '检查口径', type: 'object', hint: '{lineMax, minGap, shallowWalkable, smallIsland …}' },
];
export const DEFAULT_CHECK = { lineMax: 30, linesMax: 12, minGap: 12, minDeep: 0, shallowWalkable: true, smallIsland: 120, riverMax: 3, openingSecs: 120, clearance: 0, mapBudget: 1200000 };
export function validateRules(r) { const out = []; if (r === null || typeof r !== 'object' || Array.isArray(r)) return [{ sev: 'error', code: 'R00', msg: '规则必须是一个 JSON 对象' }]; const known = new Set([...RULES_SCHEMA.map((x) => x.k), '_说明', 'ignore', 'power', 'colors']); for (const k of Object.keys(r)) if (!known.has(k)) out.push({ sev: 'warn', code: 'R00', msg: `规则里有不认识的项「${k}」` }); if (r.teams !== undefined && !Number.isInteger(r.teams)) out.push({ sev: 'error', code: 'R00', msg: 'teams 必须是整数' }); if (r.mapSize && !(Array.isArray(r.mapSize) && r.mapSize.length === 2)) out.push({ sev: 'error', code: 'R00', msg: 'mapSize 必须形如 [宽，高]' }); return out; }
export const checkConfigOf = (rules) => ({ ...DEFAULT_CHECK, ...((rules && rules.check) || {}) });

// ======== 9. 队伍颜色冲突 ========
const hex2rgb = (h) => { const m = String(h).match(/^#([0-9a-f]{6})$/i); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
export function teamColorConflicts(model, { minDist = 70, colorOf = slotColor } = {}) {
  const teams = [...new Set(unitsOf(model).map((u) => +u.props.team).filter((t) => t >= 0))].sort((a, b) => a - b), out = [], unk = [];
  const rgb = teams.map((t) => ({ t, c: hex2rgb(colorOf(t)) })); for (const r of rgb) if (!r.c) unk.push(r.t);
  for (let i = 0; i < rgb.length; i++) for (let j = i + 1; j < rgb.length; j++) { const a = rgb[i], b = rgb[j]; if (!a.c || !b.c) continue; const d = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]); if (d < minDist) out.push({ sev: 'warn', code: 'X12', msg: `${a.t} 号与 ${b.t} 号颜色太接近（色距 ${Math.round(d)} < ${minDist}),游戏里容易看混`, level: '经验' }); }
  if (unk.length) out.push({ sev: 'info', code: 'X12', msg: `${unk.slice(0, 10).join('、')}${unk.length > 10 ? ' 等' : ''} 号队伍的颜色编辑器按编号生成、没有在游戏内核对，无法检查冲突`, level: '经验' });
  return out;
}
