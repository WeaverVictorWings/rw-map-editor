// RWKit · 消息文本检查与排版:每行字数、行数、重复句、禁用词、整张图文本相似度
export const DEFAULT_TEXT_RULES = { lineMax: 24, linesMax: 12, banned: ['新势力'], bannedPrefix: [], dupMin: 8 };
export function wrap(text, w = 20) {   // 按标点优先断行;已含换行的不重排
  if (String(text).includes('\n')) return text;
  const parts = (text.match(/[^,。!?:;…,!?:;、]*[,。!?:;…,!?:;、]*/g) || []).filter(Boolean); const lines = []; let cur = '';
  for (let p of parts) { while ([...p].length > w + 4) { if (cur) { lines.push(cur); cur = ''; } lines.push([...p].slice(0, w).join('')); p = [...p].slice(w).join(''); } if ([...cur].length + [...p].length > w && cur) { lines.push(cur); cur = ''; } cur += p; }
  if (cur) lines.push(cur); return lines.join('\n');
}
export function lintText(text, rules = DEFAULT_TEXT_RULES) {
  const out = []; const lines = String(text).split('\n'); const R = { ...DEFAULT_TEXT_RULES, ...rules };
  const longest = Math.max(...lines.map((l) => [...l].length));
  if (longest > R.lineMax) out.push({ sev: 'error', code: 'T01', msg: `有一行 ${longest} 字,超过每行上限 ${R.lineMax}(游戏里一行太长会被截掉,先用 wrap 排版)` });
  if (lines.length > R.linesMax) out.push({ sev: 'warn', code: 'T02', msg: `共 ${lines.length} 行,超过 ${R.linesMax} 行,屏幕可能放不下` });
  for (const b of R.banned) if (text.includes(b)) out.push({ sev: 'error', code: 'T03', msg: `含禁用词「${b}」` });
  for (const b of R.bannedPrefix) if (text.startsWith(b)) out.push({ sev: 'error', code: 'T03', msg: `不应以「${b}」开头` });
  const flat = String(text).replace(/\s+/g, ''); const sents = flat.split(/[。!?]/).filter((s) => s.length >= R.dupMin);
  for (let i = 0; i < sents.length; i++) for (let j = i + 1; j < sents.length; j++) { const a = sents[i], b = sents[j]; for (let k = 0; k + R.dupMin <= a.length; k++) if (b.includes(a.slice(k, k + R.dupMin))) { out.push({ sev: 'warn', code: 'T04', msg: `两句话重复:「${a.slice(0, 16)}…」与「${b.slice(0, 16)}…」` }); k = a.length; } }
  if (/\n\s*\n/.test(text)) out.push({ sev: 'info', code: 'T05', msg: '含空行' });
  return out;
}
export function lintTexts(items, rules) {   // items: [{key, text, where}]
  const out = []; const seen = new Map();
  for (const it of items) { for (const i of lintText(it.text, rules)) out.push({ ...i, where: it.where, key: it.key }); const k = it.text.replace(/\s+/g, ''); if (seen.has(k)) out.push({ sev: 'warn', code: 'T06', msg: `与「${seen.get(k)}」文本完全相同`, where: it.where, key: it.key }); else seen.set(k, it.key); }
  return out;
}
