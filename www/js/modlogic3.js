// Mod 编辑器逻辑（三，3.1）：源码诊断/补全/整理、翻译表、单位图鉴、体检报告、对比。纯逻辑，可在 Node 里测试。
import { parseIni, getVal } from './ini.js';
import { SCHEMA, schemaKey } from './modschema.js';
import { compareRows, outliers, scoreMod, assetIssues, diffMod } from './modlogic.js';

const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const keysOf = (sec) => { const k = schemaKey(sec); return k ? SCHEMA[k].map((f) => f.key) : []; };
const fieldOf = (sec, key) => { const k = schemaKey(sec); return k ? SCHEMA[k].find((f) => f.key === key) : null; };
const NUMERIC = /^\s*-?\d+(\.\d+)?\s*[a-zA-Z%]?\s*$/;
const DYN = /[${}@]|\bif\b/;

// ---- 逐行诊断：给源码编辑器画波浪线用 ----
// 返回 [{line(从1开始), lv:'error'|'warn'|'info', msg}]
export function lintText(text) {
  const out = [], lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let sec = null, seen = null;
  lines.forEach((raw, i) => {
    const ln = i + 1, t = raw.trim();
    if (!t || t.startsWith('#')) return;
    if (t.startsWith('[')) {
      const m = /^\[([^\]]*)\]/.exec(t);
      if (!m) { out.push({ line: ln, lv: 'error', msg: '段名缺少右括号 ]' }); sec = null; return; }
      sec = m[1].trim(); seen = new Set();
      if (!sec) out.push({ line: ln, lv: 'error', msg: '段名是空的' });
      return;
    }
    if (t.startsWith('@define') || t.startsWith('@')) return; // 模板变量
    const c = raw.indexOf(':');
    if (c < 0) { out.push({ line: ln, lv: 'warn', msg: '这一行没有冒号，游戏会忽略它（注释请用 # 开头）' }); return; }
    const key = raw.slice(0, c).trim(), val = raw.slice(c + 1).trim();
    if (sec === null) { out.push({ line: ln, lv: 'warn', msg: '这行在任何 [段] 之前，游戏不会读到它' }); return; }
    if (!key) { out.push({ line: ln, lv: 'error', msg: '冒号前面没有键名' }); return; }
    if (seen.has(key)) out.push({ line: ln, lv: 'warn', msg: '本段里 ' + key + ' 写了两次，通常只有一个生效' }); seen.add(key);
    const f = fieldOf(sec, key);
    if (!f) {
      const ks = keysOf(sec);
      if (ks.length && !ks.includes(key) && !/^(displayText|displayDescription|text|description)_/.test(key) && !/^(copyFrom|price|name)$/.test(key) && !/^[a-z]+_/.test(key)) {
        let best = '', bd = 3; for (const k of ks) { const d = lev(key.toLowerCase(), k.toLowerCase()); if (d < bd) { bd = d; best = k; } }
        if (best) out.push({ line: ln, lv: 'warn', msg: '键名 ' + key + ' 不在常见列表里，是不是想写 ' + best + '？' });
      }
      return;
    }
    if (val && !DYN.test(val)) {
      if (f.type === 'n' && !(key === 'price' && /,|=/.test(val)) && !NUMERIC.test(val)) out.push({ line: ln, lv: 'error', msg: f.label + ' 应为数字：' + val });
      if (f.type === 'b' && !/^(true|false)$/i.test(val)) out.push({ line: ln, lv: 'warn', msg: f.label + ' 应为 true 或 false：' + val });
      if (f.type.startsWith('e:') && !f.type.slice(2).split('|').includes(val)) out.push({ line: ln, lv: 'warn', msg: f.label + ' 只能是 ' + f.type.slice(2).split('|').join(' / ') + '，现在是 ' + val });
    }
  });
  return out;
}

// ---- 补全：caret 前面是什么就补什么 ----
// 返回 {from, to, items:[{label, insert, hint}]}，from/to 是要被替换的范围
export function completions(text, caret) {
  const before = text.slice(0, caret), ls = before.lastIndexOf('\n') + 1, linePre = before.slice(ls);
  const secs = [...before.matchAll(/^\s*\[([^\]\n]*)\]/gm)];
  const sec = secs.length ? secs[secs.length - 1][1].trim() : '';
  const lineEnd = text.indexOf('\n', caret), lineRest = text.slice(caret, lineEnd < 0 ? text.length : lineEnd);
  if (/^\s*\[[^\]]*$/.test(linePre)) {
    const p = linePre.replace(/^\s*\[/, '');
    const names = ['core', 'graphics', 'movement', 'attack', 'ai', 'turret_', 'projectile_', 'action_', 'canBuild_', 'effect_', 'leg_', 'arm_', 'decal_', 'animation_', 'attachment_', 'template_', 'placementRule_', 'resource_'];
    return { from: caret - p.length, to: caret, items: names.filter((n) => n.toLowerCase().startsWith(p.toLowerCase()) && n !== p).map((n) => ({ label: '[' + n + (n.endsWith('_') ? '…' : '') + ']', insert: n.endsWith('_') ? n : n + ']', hint: '段' })) };
  }
  const c = linePre.indexOf(':');
  if (c < 0) {
    const p = linePre.trim(), start = caret - linePre.trimStart().length;
    const k = schemaKey(sec); if (!k) return { from: caret, to: caret, items: [] };
    return { from: start, to: caret, items: SCHEMA[k].filter((f) => f.key.toLowerCase().startsWith(p.toLowerCase()) && f.key !== p).map((f) => ({ label: f.key, insert: lineRest.includes(':') ? f.key : f.key + ': ', hint: f.label })) };
  }
  const key = linePre.slice(0, c).trim(), f = fieldOf(sec, key), p = linePre.slice(c + 1).trimStart();
  const from = caret - p.length;
  if (f && f.type.startsWith('e:')) return { from, to: caret + (lineRest.trim() ? 0 : 0), items: f.type.slice(2).split('|').filter((v) => v.toLowerCase().startsWith(p.toLowerCase()) && v !== p).map((v) => ({ label: v, insert: v, hint: f.label })) };
  if (f && f.type === 'b') return { from, to: caret, items: ['true', 'false'].filter((v) => v.startsWith(p.toLowerCase()) && v !== p).map((v) => ({ label: v, insert: v, hint: f.label })) };
  return { from: caret, to: caret, items: [] };
}
// 弹道名补全要知道本 Mod 里有哪些弹道：给 completions 的结果追加
export function projectileNames(mod) {
  const s = new Set();
  for (const u of mod.units) for (const x of u.ini.sections) { const m = /^projectile_(.+)$/.exec(x.name); if (m) s.add(m[1]); }
  return [...s];
}

// ---- 整理格式：统一 "键: 值"，去行尾空格，段之间空一行；注释和顺序不动 ----
export function formatIni(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const out = []; let prevBlank = true;
  for (const raw of String(text).split(/\r?\n/)) {
    let l = raw.replace(/\s+$/, '');
    const t = l.trim();
    if (t.startsWith('[')) { if (out.length && !prevBlank) out.push(''); out.push(t.replace(/^\[\s*([^\]]*?)\s*\]/, '[$1]')); prevBlank = false; continue; }
    if (!t) { if (!prevBlank) out.push(''); prevBlank = true; continue; }
    if (!t.startsWith('#') && !t.startsWith('@')) { const c = l.indexOf(':'); if (c > 0) { const k = l.slice(0, c).trim(), v = l.slice(c + 1).trim(); l = v ? k + ': ' + v : k + ':'; } }
    out.push(l); prevBlank = false;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join(nl) + nl;
}

// ---- 翻译表：导出成 CSV，改完导回 ----
const TR_KEY = /^(displayText|displayDescription|displayName|text|description|showInEditor_displayName)(_[A-Za-z_]+)?$/;
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
export function translationRows(mod) {
  const rows = [];
  for (const u of mod.realUnits()) for (const s of u.ini.sections) {
    if (!s.name || !/^(core|action_|hiddenAction_|canBuild_)/.test(s.name)) continue;
    for (const l of s.lines) if (l.key && TR_KEY.test(l.key) && l.val) rows.push({ file: u.file, sec: s.name, key: l.key, val: l.val });
  }
  return rows;
}
export function translationCsv(mod) {
  return '﻿file,section,key,text\r\n' + translationRows(mod).map((r) => [r.file, r.sec, r.key, r.val].map(q).join(',')).join('\r\n') + '\r\n';
}
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', inq = false; const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inq) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += ch; }
    else if (ch === '"') inq = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}
// 导回：已有的键改值；新键（比如加了 displayText_ja 一行）加到该段末尾。返回 {changed, added, skipped}
export function applyTranslationCsv(mod, csv) {
  syncSources(mod);
  const rows = parseCsv(csv); const res = { changed: 0, added: 0, skipped: 0 };
  for (const r of rows.slice(rows[0] && rows[0][0] === 'file' ? 1 : 0)) {
    const [file, sec, key, val] = r; if (!file || !sec || !key) { res.skipped++; continue; }
    const u = mod.units.find((x) => x.file === file); const s = u && u.ini.sections.find((x) => x.name === sec);
    if (!s || !TR_KEY.test(key)) { res.skipped++; continue; }
    const l = s.lines.find((x) => x.key === key);
    if (l) { if (l.val !== val) { l.val = val; l.raw = key + ': ' + val; res.changed++; } }
    else if (val) { let at = s.lines.length; while (at > 0 && !s.lines[at - 1].raw.trim()) at--; s.lines.splice(at, 0, { raw: key + ': ' + val, key, val }); res.added++; }
  }
  return res;
}

// 源码模式里改过但还没解析回表单的单位，先解析（不然后面的改动会被源码文本盖掉）
export function syncSources(mod) { for (const u of mod.units) if (u.srcDirty && u.text !== undefined) { u.ini = parseIni(u.text); u.srcDirty = false; } }
// 整理所有单位文件的格式，返回改了几个
export function formatAllUnits(mod) {
  syncSources(mod); let n = 0;
  for (const u of mod.units) { const base = serializeIni(u.ini), f = formatIni(base); if (f !== base) { u.text = f; u.ini = parseIni(f); u.edited = true; n++; } }
  return n;
}

// ---- 单位图鉴（Markdown）----
export function docsMd(mod, title) {
  const rows = compareRows(mod);
  const L = ['# ' + (title || getVal(mod.info, 'mod', 'title') || mod.name) + ' 单位图鉴', '', '共 ' + rows.length + ' 个单位。数值是按配置算的估算，仅供对比。', '',
    '| 单位 | 造价 | 生命 | 速度 | 射程 | 每秒伤害 | 战力 |', '|---|---:|---:|---:|---:|---:|---:|'];
  const f = (n) => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '-');
  for (const r of rows) L.push(`| ${mod.unitName(r.u)} | ${f(r.price)} | ${f(r.hp)} | ${f(r.speed)} | ${f(r.range)} | ${f(r.dps)} | ${f(r.power)} |`);
  return L.join('\n') + '\n';
}

// ---- 体检报告（Markdown）----
export function healthMd(mod, results) {
  const sc = scoreMod(mod, results), rows = compareRows(mod), out = outliers(rows), as = assetIssues(mod);
  const L = ['# ' + (getVal(mod.info, 'mod', 'title') || mod.name) + ' 体检报告', '', '综合分：**' + sc.score + ' / 100**', ''];
  for (const x of sc.items) L.push('- ' + x);
  const cnt = (lv) => results.filter((r) => r.lv === lv).length;
  L.push('', '## 检查结果', '', `错误 ${cnt('error')} / 警告 ${cnt('warn')} / 提示 ${cnt('info')}`, '');
  for (const lv of ['error', 'warn']) for (const r of results.filter((x) => x.lv === lv).slice(0, 60)) L.push(`- ${lv === 'error' ? '错误' : '警告'}：${r.msg}${r.file ? '（' + r.file + '）' : ''}`);
  if (out.size) { L.push('', '## 性价比偏离的单位', ''); for (const r of rows) if (out.has(r.u)) L.push(`- ${mod.unitName(r.u)}（${out.get(r.u)}）：战力 ${Math.round(r.power)}，造价 ${Math.round(r.price)}`); }
  const un = as.unused;
  if (un.length) L.push('', '## 没被引用的素材（' + un.length + ' 个）', '', ...un.slice(0, 40).map((f) => '- ' + f));
  let total = 0; for (const v of mod.files.values()) total += v.bytes.length;
  L.push('', '## 体积', '', '共 ' + mod.files.size + ' 个文件，' + (total / 1048576).toFixed(1) + ' MB。');
  const big = [...mod.files].sort((a, b) => b[1].bytes.length - a[1].bytes.length).slice(0, 8);
  for (const [k, v] of big) L.push(`- ${k}：${(v.bytes.length / 1048576).toFixed(2)} MB`);
  return L.join('\n') + '\n';
}

// ---- 两个版本对比（给命令行用）：把 old 当作 orig ----
export function diffMods(oldMod, newMod) {
  const orig = new Map(); for (const u of oldMod.units) orig.set(u.file, u.text !== undefined ? parseIniText(u.text) : '');
  return diffMod(newMod, orig);
}
import { serializeIni } from './ini.js';
function parseIniText(t) { return serializeIni(parseIni(t)); }
