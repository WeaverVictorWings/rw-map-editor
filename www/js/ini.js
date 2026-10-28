// 铁锈战争单位 ini：解析与写回。保留注释、顺序和不认识的行，只改动被编辑过的行。
// 模型：{ sections: [{ name, lines: [{ raw, key, val }] }] }，name 为空的是文件开头的注释区。
export function parseIni(text) {
  const sections = [{ name: '', lines: [] }];
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const t = raw.trim();
    const m = /^\[([^\]]*)\]/.exec(t);
    if (m) { sections.push({ name: m[1].trim(), lines: [], raw }); continue; }
    const cur = sections[sections.length - 1];
    if (!t || t.startsWith('#')) { cur.lines.push({ raw }); continue; }
    const i = raw.indexOf(':');
    if (i < 0) { cur.lines.push({ raw }); continue; }
    cur.lines.push({ raw, key: raw.slice(0, i).trim(), val: raw.slice(i + 1).trim() });
  }
  return { sections };
}
export function serializeIni(ini) {
  const out = [];
  for (const s of ini.sections) {
    if (s.name) out.push(s.raw && /^\[/.test(s.raw.trim()) && !s.dirtyName ? s.raw : '[' + s.name + ']');
    for (const l of s.lines) out.push(l.dirty ? l.key + ': ' + l.val : l.raw);
  }
  return out.join('\n');
}
export const getSec = (ini, name) => ini.sections.find((s) => s.name === name);
export function getVal(ini, sec, key) {
  const s = getSec(ini, sec); if (!s) return undefined;
  for (let i = s.lines.length - 1; i >= 0; i--) if (s.lines[i].key === key) return s.lines[i].val;
  return undefined;
}
// 设置值；空字符串或 undefined 表示删除该行
export function setVal(ini, sec, key, val) {
  let s = getSec(ini, sec);
  if (val === undefined || val === null || val === '') {
    if (!s) return;
    s.lines = s.lines.filter((l) => l.key !== key);
    return;
  }
  if (!s) { s = { name: sec, lines: [] }; ini.sections.push(s); }
  const l = s.lines.find((x) => x.key === key);
  if (l) { l.val = String(val); l.dirty = true; return; }
  // 插在本段最后一个有内容的行之后，别压在段尾的空行/注释后面
  let at = s.lines.length;
  while (at > 0 && !s.lines[at - 1].key) at--;
  s.lines.splice(at, 0, { raw: '', key, val: String(val), dirty: true });
}
export const sectionNames = (ini) => ini.sections.filter((s) => s.name).map((s) => s.name);
export function addSection(ini, name) { if (!getSec(ini, name)) { const s = { name, lines: [] }; ini.sections.push(s); return s; } return getSec(ini, name); }
export function removeSection(ini, name) { ini.sections = ini.sections.filter((s) => s.name !== name); }
export function cloneIni(ini) { return parseIni(serializeIni(ini)); }
