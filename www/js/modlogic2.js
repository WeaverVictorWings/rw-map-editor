// Mod 编辑器逻辑（二）：分享码、项目文件、导入与拆分、发布包、额外检查、平衡建议、灵敏度、科技经济、定位参考
import { parseIni, serializeIni, getVal, setVal, getSec } from './ini.js';
import { writeZip, readZip } from './zip.js';
import * as L from './modlogic.js';
const { num, norm, resolveFile, unitStats, powerOf, compareRows, outliers, scaleUnit } = L;
const enc = new TextEncoder(), dec = new TextDecoder();

// ---------- 分享码 ----------
const b64u = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (t) => { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
export async function unitToCode(mod, u) {
  const body = JSON.stringify({ n: mod.unitName(u), t: serializeIni(u.ini) });
  return 'RWU1-' + b64u(await pipe(enc.encode(body), new CompressionStream('deflate-raw')));
}
export async function codeToIni(code) {
  const m = /RWU1-([A-Za-z0-9_-]+)/.exec(code || ''); if (!m) throw new Error('不是单位分享码（应以 RWU1- 开头）');
  const o = JSON.parse(dec.decode(await pipe(unb64u(m[1]), new DecompressionStream('deflate-raw'))));
  return { name: o.n, ini: parseIni(o.t) };
}
export async function importCode(mod, code) {
  const { name, ini } = await codeToIni(code);
  const nn = L.uniqueName(mod, name || 'imported'); setVal(ini, 'core', 'name', nn);
  return L.addUnit(mod, ini, nn);
}

// ---------- 项目文件（.rwproj = zip：Mod 文件 + _rwproj.json） ----------
export function snapshot(mod, name) {
  const files = {}; for (const u of mod.realUnits()) files[u.file] = serializeIni(u.ini);
  return { name, time: Date.now(), files };
}
export function snapshotMap(s) { return new Map(Object.entries(s.files)); }
export function projectFiles(mod) {
  const list = mod.collect();
  list.push({ name: '_rwproj.json', data: JSON.stringify({ v: 1, name: mod.name, notes: mod.notes || '', todos: mod.todos || [], unitNotes: mod.unitNotes || {}, snaps: mod.snaps || [] }) });
  return writeZip(list);
}
export function splitProject(entries) {
  const meta = entries.find((e) => e.name === '_rwproj.json');
  return { meta, rest: entries.filter((e) => e !== meta) };
}

// ---------- 导入与拆分 ----------
const MEDIA = /\.(png|jpg|jpeg|ogg|wav|mp3)\b/i;
export function referencedAssets(mod, units) {
  const keys = new Set();
  for (const u of units) for (const s of u.ini.sections) for (const l of s.lines) if (l.key && MEDIA.test(l.val || '')) for (const t of l.val.split(',')) { const k = resolveFile(mod, t, u.file); if (k) keys.add(k); }
  return keys;
}
// 拆分：把选中的单位和它们用到的素材打成新包
export function extractUnits(mod, units) {
  const out = [];
  const info = parseIni('[mod]\ntitle: ' + (getVal(mod.info, 'mod', 'title') || mod.name) + ' (部分)\n'); out.push({ name: 'mod-info.txt', data: serializeIni(info) });
  for (const u of units) out.push({ name: u.file, data: serializeIni(u.ini) });
  for (const k of referencedAssets(mod, units)) out.push({ name: k, data: mod.files.get(k).bytes });
  return out;
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// 导入：把 src 里的单位连同素材复制进 target。素材同路径同内容就复用，内容不同就改名并改写引用
export function importUnits(target, src, units) {
  const added = [], notes = [];
  const taken = new Set(target.realUnits().map((u) => target.unitName(u).toLowerCase()));
  for (const u of units) {
    const ini = parseIni(serializeIni(u.ini));
    let nm = target.unitName(u);
    if (taken.has(nm.toLowerCase())) { const n2 = L.uniqueName(target, nm); setVal(ini, 'core', 'name', n2); notes.push(`${nm} 重名，改为 ${n2}`); nm = n2; }
    taken.add(nm.toLowerCase());
    for (const k of referencedAssets(src, [u])) {
      const bytes = src.files.get(k).bytes, ex = target.lower.get(k.toLowerCase());
      let dest = k;
      if (ex && !same(target.files.get(ex).bytes, bytes)) {
        dest = k.replace(/(\.[^.\/]+)$/, '_imp$1'); let i = 2; while (target.lower.has(dest.toLowerCase())) dest = k.replace(/(\.[^.\/]+)$/, '_imp' + i++ + '$1');
        for (const s of ini.sections) for (const l of s.lines) if (l.key && MEDIA.test(l.val || '')) {
          const nv = l.val.split(',').map((t) => (resolveFile(src, t, u.file) === k ? t.trim().replace(/[^\\\/]+$/, dest.split('/').pop()) : t.trim())).join(', ');
          if (nv !== l.val) { l.val = nv; l.dirty = true; }
        }
        notes.push(`素材 ${k} 与已有文件不同，另存为 ${dest}`);
      }
      if (!target.lower.has(dest.toLowerCase())) { target.files.set(dest, { bytes }); target.lower.set(dest.toLowerCase(), dest); }
    }
    let file = u.file; if (target.lower.has(file.toLowerCase())) file = (u.file.replace(/[^/]*$/, '')) + nm + '.ini';
    while (target.lower.has(file.toLowerCase())) file = file.replace(/\.ini$/i, '_2.ini');
    const nu = { file, ini }; target.units.push(nu); target.files.set(file, { bytes: enc.encode(serializeIni(ini)) }); target.lower.set(file.toLowerCase(), file);
    added.push(nu);
  }
  return { added, notes };
}

// ---------- 发布包 ----------
export function publishFiles(mod, { version = '1.0', changelog = '', desc = '' } = {}) {
  const title = (getVal(mod.info, 'mod', 'title') || mod.name).replace(/[\\/:*?"<>|]/g, '_');
  const files = [{ name: title + '.rwmod', data: writeZip(mod.collect()) }];
  files.push({ name: 'description.txt', data: `${getVal(mod.info, 'mod', 'title') || mod.name}  v${version}\n\n${desc || getVal(mod.info, 'mod', 'description') || ''}\n` });
  if (changelog) files.push({ name: 'CHANGELOG.md', data: changelog });
  const th = getVal(mod.info, 'mod', 'thumbnail'), k = th && resolveFile(mod, th);
  if (k) files.push({ name: 'thumbnail' + (k.match(/\.[^.]+$/) || ['.png'])[0], data: mod.files.get(k).bytes });
  return { title, bytes: writeZip(files) };
}

// ---------- 额外检查 ----------
export function extraChecks(mod) {
  const R = [], add = (lv, msg, file) => R.push({ lv, msg, file });
  const units = mod.realUnits();
  if (units.length > 300) add('info', `单位多达 ${units.length} 个，低配手机加载会慢`);
  const byName = new Map(units.map((u) => [mod.unitName(u).toLowerCase(), u]));
  for (const u of units) {
    const nm = mod.unitName(u);
    if (nm && !/^[A-Za-z0-9_\-]+$/.test(nm)) add('warn', `单位代号“${nm}”含有字母数字以外的字符，建议只用英文、数字、下划线`, u.file);
    const hp = num(getVal(u.ini, 'core', 'maxHp')), pr = num(getVal(u.ini, 'core', 'price')), sp = num(getVal(u.ini, 'movement', 'moveSpeed'));
    if (pr < 0) add('error', '造价是负数', u.file);
    if (hp <= 0 && !/true/i.test(getVal(u.ini, 'core', 'isBuilding') || '')) add('warn', '生命为 0 或负数', u.file);
    if (hp > 100000) add('info', `生命 ${hp} 非常大，确认没多写个零`, u.file);
    if (sp > 20) add('warn', `移动速度 ${sp} 很大，常见单位在 0.3~4 左右`, u.file);
    const projUsed = new Set();
    for (const s of u.ini.sections) {
      if (s.name.startsWith('turret_')) { const p = (s.lines.find((l) => l.key === 'projectile') || {}).val; if (p) projUsed.add(p.trim()); const d = num((s.lines.find((l) => l.key === 'delay') || {}).val); if (d < 1) add('warn', `[${s.name}] 的 delay 小于 1，会每帧开火`, u.file); }
    }
    for (const s of u.ini.sections) if (s.name.startsWith('projectile_') && !projUsed.has(s.name.slice(11))) add('info', `[${s.name}] 没有炮塔使用（可能被别的单位或 mutator 引用）`, u.file);
    // copyFrom 循环
    const seen = new Set([nm.toLowerCase()]); let cur = u;
    for (let i = 0; i < 20 && cur; i++) {
      const cf = String(getVal(cur.ini, 'core', 'copyFrom') || '').split(',')[0].trim().toLowerCase(); if (!cf) break;
      if (seen.has(cf)) { add('error', 'copyFrom 绕成了圈：' + [...seen, cf].join(' → '), u.file); break; }
      seen.add(cf); cur = byName.get(cf);
    }
    const img = getVal(u.ini, 'graphics', 'image'), k = img && resolveFile(mod, img, u.file);
    if (k && /\.png$/i.test(k)) { const sz = L.pngSize(mod.files.get(k).bytes); if (sz && (sz.w > 2048 || sz.h > 2048)) add('warn', `图片 ${sz.w}×${sz.h} 过大，手机上可能加载不了`, u.file); if (mod.files.get(k).bytes.length > 2e6) add('info', `图片 ${k} 超过 2MB`, u.file); }
  }
  return R;
}

// ---------- 平衡建议、灵敏度、科技经济、定位参考 ----------
export function balanceSuggest(mod) {
  const rows = compareRows(mod), out = outliers(rows);
  const e = rows.filter((r) => Number.isFinite(r.eff) && r.dps > 0).map((r) => r.eff).sort((a, b) => a - b), med = e[Math.floor(e.length / 2)];
  const res = [];
  for (const [u, tag] of out) { const r = rows.find((x) => x.u === u); const mult = Math.min(2, Math.max(0.5, r.eff / med)); res.push({ u, tag, name: r.name, price: r.price, newPrice: Math.round(r.price * mult), mult }); }
  return res;
}
export function applyBalance(list) { for (const s of list) scaleUnit(s.u.ini, { price: s.mult }); }
export function sensitivity(ini) {
  const base = unitStats(ini), bp = powerOf(base), be = base.price ? bp / base.price : NaN, out = [];
  for (const g of ['hp', 'dmg', 'price', 'speed', 'range']) for (const f of [0.9, 1.1]) {
    const c = parseIni(serializeIni(ini)); scaleUnit(c, { [g]: f }); const s = unitStats(c), p = powerOf(s), e = s.price ? p / s.price : NaN;
    out.push({ g, f, power: (p / bp - 1) * 100, eff: Number.isFinite(be) ? (e / be - 1) * 100 : NaN });
  }
  return out;
}
export function techRows(mod) {
  const rows = compareRows(mod), m = new Map();
  for (const r of rows) { const t = num(getVal(r.u.ini, 'core', 'techLevel')) || 0, b = num(getVal(r.u.ini, 'core', 'buildSpeed')) || 0; const a = m.get(t) || { tech: t, n: 0, price: 0, power: 0, build: 0 }; a.n++; a.price += r.price; a.power += r.power; a.build += b; m.set(t, a); }
  return [...m.values()].sort((a, b) => a.tech - b.tech).map((a) => ({ tech: a.tech, n: a.n, price: a.price / a.n, power: a.power / a.n, build: a.build / a.n, burn: a.build ? a.price / a.build : NaN }));
}
const med = (a) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
export const ROLES = {
  scout: ['侦察：快、脆、便宜', (s, m) => [['速度 ≥ 中位数的 1.3 倍', s.speed >= m.speed * 1.3], ['生命 ≤ 中位数', s.hp <= m.hp], ['造价 ≤ 中位数', s.price <= m.price]]],
  assault: ['突击：厚、有火力', (s, m) => [['生命 ≥ 中位数的 1.2 倍', s.hp >= m.hp * 1.2], ['DPS ≥ 中位数', s.dps >= m.dps]]],
  artillery: ['炮兵：射程远、脆', (s, m) => [['射程 ≥ 中位数的 1.5 倍', s.range >= m.range * 1.5], ['生命 ≤ 中位数', s.hp <= m.hp]]],
  antiair: ['防空：能打空中', (s) => [['能攻击空中', s.air], ['有 DPS', s.dps > 0]]],
};
export function roleAdvice(mod, u, role) {
  const rows = compareRows(mod), m = { speed: med(rows.map((r) => r.speed)), hp: med(rows.map((r) => r.hp)), price: med(rows.map((r) => r.price)), dps: med(rows.map((r) => r.dps)), range: med(rows.map((r) => r.range)) };
  return ROLES[role][1](unitStats(u.ini), m).map(([t, ok]) => ({ t, ok }));
}
export function autoDescription(ini) {
  const s = unitStats(ini), p = [];
  if (s.hp) p.push('生命 ' + Math.round(s.hp)); if (s.price) p.push('造价 ' + Math.round(s.price)); if (s.speed) p.push('速度 ' + s.speed);
  if (s.range) p.push('射程 ' + Math.round(s.range)); if (s.dps) p.push('DPS ' + Math.round(s.dps));
  return p.join('，');
}
export function projectileInfo(ini, name) {
  const g = (k) => getVal(ini, 'projectile_' + name, k);
  const life = num(g('life')) || 0, speed = num(g('speed')) || 0;
  return { life, speed, travel: life * speed, dd: num(g('directDamage')) || 0, ad: num(g('areaDamage')) || 0, radius: num(g('areaRadius')) || 0, ballistic: /true/i.test(g('ballistic') || ''), instant: /true/i.test(g('instant') || '') };
}
