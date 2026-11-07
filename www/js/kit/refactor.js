// RWKit · 对 TMX 文本做"安全改动":重命名(同步引用)、批量改属性、克隆子树、搜索、触发器对比、文本导出/导入、依赖图
import { parseTmx, TRIGGER_TYPES, trigKey, esc, unesc } from './tmx.js';
const REFK = ['activatedBy', 'deactivatedBy', 'alsoActivate', 'whenActivatedIds', 'activateIds'];
const OBJ = /<object\s+([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g;
const attrsOf = (s) => { const o = {}; for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = unesc(m[2]); return o; };
const propsOf = (b) => { const p = {}; for (const m of (b || '').matchAll(/<property\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/property>)/g)) { const a = attrsOf(m[1]); p[a.name] = a.value !== undefined ? a.value : unesc(m[2] || ''); } return p; };
const isTrig = (a) => TRIGGER_TYPES.has((a.type || a.class || '').toLowerCase());
const keyOf = (a, p) => ((p.id || '').trim() || (a.name || '').trim() || 'NULL');
const buildProps = (p) => `<properties>${Object.entries(p).map(([k, v]) => `<property name="${esc(k)}" value="${esc(v)}"/>`).join('')}</properties>`;
const rebuild = (a, p, selfClose) => { const at = Object.entries(a).map(([k, v]) => `${k}="${esc(v)}"`).join(' '); return Object.keys(p).length ? `<object ${at}>${buildProps(p)}</object>` : `<object ${at}/>`; };
// fn(attrs, props, key) → 返回 null 不改;返回 {attrs?, props?} 则整块重写(属性重排为 name,value 形式)
export function mapTriggers(text, fn) {
  let n = 0; const out = text.replace(OBJ, (all, as, tail, body) => { const a = attrsOf(as); if (!isTrig(a)) return all; const p = propsOf(body); const r = fn(a, p, keyOf(a, p)); if (!r) return all; n++; return rebuild(r.attrs || a, r.props || p); });
  return { text: out, changed: n };
}
export function renameTrigger(text, oldKey, newKey) {
  const model = parseTmx(text); if (model.objects.some((o) => TRIGGER_TYPES.has(o.type.toLowerCase()) && trigKey(o) === newKey)) throw new Error(`新名字「${newKey}」已存在`);
  let hit = 0; const r = mapTriggers(text, (a, p, key) => {
    let ch = false; const na = { ...a }, np = { ...p };
    if (key === oldKey) { if ((p.id || '').trim()) np.id = newKey; else na.name = newKey; ch = true; hit++; }
    for (const k of REFK) if (np[k]) { const l = np[k].split(',').map((s) => s.trim()); if (l.includes(oldKey)) { np[k] = l.map((s) => (s === oldKey ? newKey : s)).join(','); ch = true; } }
    return ch ? { attrs: na, props: np } : null;
  });
  if (!hit) throw new Error(`找不到触发器「${oldKey}」`); return r.text;
}
export function findRefs(model, key) { const out = []; for (const o of model.objects) if (TRIGGER_TYPES.has(o.type.toLowerCase())) for (const k of REFK) if (o.props[k] && o.props[k].split(',').map((s) => s.trim()).includes(key)) out.push({ by: trigKey(o), via: k }); return out; }
// 过滤表达式:"type=unitDetect reset=200 name~^占 team!=-1 has:activatedBy"(reset=resetActivationAfter 简写)
export function parseFilter(expr) {
  const toks = String(expr || '').trim().split(/\s+/).filter(Boolean); const alias = { reset: 'resetActivationAfter', by: 'activatedBy' };
  const conds = toks.map((t) => { let m; if ((m = t.match(/^has:(\w+)$/))) return (a, p) => (alias[m[1]] || m[1]) in p; if ((m = t.match(/^(\w+)(!=|~|=)(.*)$/))) { const k = alias[m[1]] || m[1], op = m[2], v = m[3]; const get = (a, p) => (k === 'type' ? a.type : k === 'name' ? a.name : k === 'group' ? a.group : p[k]); return (a, p) => { const x = get(a, p); if (op === '=') return x !== undefined && String(x).toLowerCase() === v.toLowerCase(); if (op === '!=') return x === undefined || String(x).toLowerCase() !== v.toLowerCase(); return x !== undefined && new RegExp(v).test(String(x)); }; } throw new Error('过滤条件看不懂: ' + t); });
  return (a, p) => conds.every((c) => c(a, p));
}
export function query(text, expr) { const f = parseFilter(expr); const res = []; mapTriggers(text, (a, p, k) => { if (f(a, p)) res.push({ key: k, type: a.type, props: p }); return null; }); return res; }
export function batchSet(text, expr, set = {}, del = []) { const f = parseFilter(expr); return mapTriggers(text, (a, p) => { if (!f(a, p)) return null; const np = { ...p, ...set }; for (const d of del) delete np[d]; return { props: np }; }); }
// 克隆:把 keys 指定的一批触发器复制一份,名字加后缀,它们之间的引用同步改;对外部的引用保持不变
export function cloneTriggers(text, keys, suffix) {
  const set = new Set(keys); let maxId = 0; for (const m of text.matchAll(/<object\s+[^>]*?\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  const copies = []; const out = text.replace(OBJ, (all, as, tail, body) => { const a = attrsOf(as); if (!isTrig(a)) return all; const p = propsOf(body); const k = keyOf(a, p); if (!set.has(k)) return all; const na = { ...a, id: String(++maxId) }, np = { ...p }; if ((p.id || '').trim()) np.id = k + suffix; else na.name = a.name + suffix; for (const rk of REFK) if (np[rk]) np[rk] = np[rk].split(',').map((s) => s.trim()).map((s) => (set.has(s) ? s + suffix : s)).join(','); copies.push(k); return all + '\n  ' + rebuild(na, np); });
  const miss = keys.filter((k) => !copies.includes(k)); if (miss.length) throw new Error('找不到: ' + miss.join('、')); return out;
}
// 下游子树:从某触发器出发,所有直接/间接以它为 activatedBy 的触发器
export function subtree(model, key) { const trs = model.objects.filter((o) => TRIGGER_TYPES.has(o.type.toLowerCase())); const res = new Set([key]); let grew = true; while (grew) { grew = false; for (const o of trs) { const k = trigKey(o); if (res.has(k)) continue; if ((o.props.activatedBy || '').split(',').map((s) => s.trim()).some((s) => res.has(s))) { res.add(k); grew = true; } } } return [...res]; }
export function diffTriggers(textA, textB) {
  const m = (t) => { const r = new Map(); for (const o of parseTmx(t).objects) if (TRIGGER_TYPES.has(o.type.toLowerCase())) r.set(trigKey(o), o); return r; }; const A = m(textA), B = m(textB); const out = { added: [], removed: [], changed: [] };
  for (const [k, o] of B) { if (!A.has(k)) out.added.push(k); else { const a = A.get(k); const d = []; for (const f of ['type', 'x', 'y', 'w', 'h']) if (a[f] !== o[f]) d.push(`${f}: ${a[f]}→${o[f]}`); for (const pk of new Set([...Object.keys(a.props), ...Object.keys(o.props)])) if (a.props[pk] !== o.props[pk]) d.push(`${pk}: ${a.props[pk] ?? '(无)'}→${o.props[pk] ?? '(无)'}`); if (d.length) out.changed.push({ key: k, diff: d }); } }
  for (const k of A.keys()) if (!B.has(k)) out.removed.push(k); return out;
}
// 文本表:所有 globalMessage / maptext 的 text,导出成 CSV(key,prop,text),改完再导入
const TEXTK = (k) => k === 'globalMessage' || k === 'text' || /^(globalMessage|text|introText)_[a-zA-Z-]{1,4}$/.test(k);
const csvq = (s) => '"' + String(s).replace(/"/g, '""').replace(/\n/g, '\\n') + '"';
export function exportTexts(text) { const rows = ['key,prop,text']; mapTriggers(text, (a, p, k) => { for (const [pk, v] of Object.entries(p)) if (TEXTK(pk)) rows.push([csvq(k), pk, csvq(v)].join(',')); return null; }); return rows.join('\n') + '\n'; }
function parseCsv(s) { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; }
export function expandVars(s, vars) { return String(s).replace(/\{([^{}]+)\}/g, (m, k) => (k in vars ? vars[k] : m)); }
export function importTexts(text, csv, vars = {}) { const rows = parseCsv(csv).slice(1).filter((r) => r.length >= 3); const map = new Map(); for (const [k, pk, t] of rows) map.set(k + '\u0000' + pk, expandVars(t.replace(/\\n/g, '\n'), vars)); return mapTriggers(text, (a, p, k) => { let ch = false; const np = { ...p }; for (const pk of Object.keys(p)) { const v = map.get(k + '\u0000' + pk); if (v !== undefined && v !== p[pk]) { np[pk] = v; ch = true; } } return ch ? { props: np } : null; }); }
export function depGraph(model, { root, fmt = 'mermaid', max = 300 } = {}) { const keys = root ? subtree(model, root) : null; const edges = []; for (const o of model.objects) if (TRIGGER_TYPES.has(o.type.toLowerCase())) { const k = trigKey(o); if (keys && !keys.includes(k)) continue; for (const s of (o.props.activatedBy || '').split(',').map((x) => x.trim()).filter(Boolean)) edges.push([s, k, o.props.allToActivate === 'true' ? '且' : '']); } const e = edges.slice(0, max); const id = (s) => 'n' + [...new Set(edges.flat())].indexOf(s);
  return fmt === 'dot' ? `digraph G {\n${e.map(([a, b, l]) => `  "${a}" -> "${b}"${l ? ` [label="${l}"]` : ''};`).join('\n')}\n}\n` : `flowchart LR\n${e.map(([a, b, l]) => `  ${id(a)}["${a}"] -->${l ? `|${l}|` : ''} ${id(b)}["${b}"]`).join('\n')}\n`; }
