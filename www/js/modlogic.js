// Mod 编辑器的纯逻辑（不碰界面，可在 Node 里测试）：数值、缩放、复制、变体、模板、
// DPS、对比、战斗模拟、建造树、引用与改名、差异与日志、素材检查、评分与一键修复
import { parseIni, serializeIni, getVal, setVal, getSec, addSection, cloneIni } from './ini.js';
const enc = new TextEncoder();
export const norm = (p) => String(p || '').trim().replace(/^ROOT:[\\/]*/i, '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
export function num(v) { const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(String(v ?? '')); return m ? parseFloat(m[1]) : NaN; }
const lineVal = (s, k) => { for (let i = s.lines.length - 1; i >= 0; i--) if (s.lines[i].key === k) return s.lines[i].val; return undefined; };
const isFalse = (v) => String(v).trim().toLowerCase() === 'false';

// ---------- 单位数值 ----------
export function unitStats(ini) {
  const g = (s, k) => getVal(ini, s, k);
  const weapons = [];
  for (const s of ini.sections) if (s.name.startsWith('turret_')) {
    if (isFalse(lineVal(s, 'canShoot'))) continue;
    const pn = (lineVal(s, 'projectile') || '').trim();
    const ps = getSec(ini, 'projectile_' + pn);
    const dd = ps ? num(lineVal(ps, 'directDamage')) || 0 : 0, ad = ps ? num(lineVal(ps, 'areaDamage')) || 0 : 0;
    const d = num(lineVal(s, 'delay')), frames = d > 0 ? d : 60;
    const shot = dd + ad;
    weapons.push({ turret: s.name.slice(7), projectile: pn, shot, frames, dps: shot * 60 / frames, range: num(lineVal(s, 'limitingRange')) });
  }
  let range = num(g('attack', 'maxAttackRange'));
  if (!(range > 0)) range = Math.max(0, ...weapons.map((w) => w.range || 0));
  const dps = weapons.reduce((a, w) => a + w.dps, 0), shots = weapons.reduce((a, w) => a + w.shot, 0);
  const mt = String(g('movement', 'movementType') || 'LAND').toUpperCase();
  return {
    name: g('core', 'name') || '', hp: num(g('core', 'maxHp')) || 0, shield: num(g('core', 'maxShield')) || 0, armour: num(g('core', 'armour')) || 0,
    price: num(g('core', 'price')) || 0, speed: num(g('movement', 'moveSpeed')) || 0, move: mt, range, dps, shot: weapons.length ? shots / weapons.length : 0, weapons,
    air: !isFalse(g('attack', 'canAttackFlyingUnits')), ground: !isFalse(g('attack', 'canAttackLandUnits')), isAir: mt === 'AIR',
  };
}

// ---------- 缩放 ----------
export const SCALE_GROUPS = {
  hp: ['生命 / 护盾', ['maxHp', 'maxShield', 'selfRegenRate', 'shieldRegen']],
  dmg: ['伤害', ['directDamage', 'areaDamage']],
  price: ['造价', ['price']],
  speed: ['速度', ['moveSpeed', 'moveAccelerationSpeed', 'moveDecelerationSpeed']],
  range: ['射程 / 爆炸范围', ['maxAttackRange', 'limitingRange', 'areaRadius']],
  size: ['体型', ['radius']],
};
function fmtNum(orig, v) {
  const dec = /\./.test(orig) || Math.abs(v - Math.round(v)) > 1e-9;
  return dec ? String(Math.round(v * 1000) / 1000) : String(Math.round(v));
}
// mult：{ hp: 1.5, dmg: 2 ... }；返回改了几行
export function scaleUnit(ini, mult) {
  const keyMul = {};
  for (const g of Object.keys(mult)) if (SCALE_GROUPS[g] && mult[g] && mult[g] !== 1) for (const k of SCALE_GROUPS[g][1]) keyMul[k] = mult[g];
  let n = 0;
  for (const s of ini.sections) for (const l of s.lines) {
    if (!l.key || !(l.key in keyMul)) continue;
    const v = num(l.val); if (!Number.isFinite(v)) continue;
    const nv = fmtNum(l.val, v * keyMul[l.key]);
    l.val = l.val.replace(/^(\s*)-?\d+(?:\.\d+)?/, (m, sp) => sp + nv); l.dirty = true; n++;
  }
  return n;
}
export const VARIANTS = {
  light: ['轻型', { hp: 0.6, price: 0.7, speed: 1.25, dmg: 0.8 }],
  heavy: ['重型', { hp: 1.6, price: 1.5, speed: 0.8, dmg: 1.4 }],
  fast: ['快速', { speed: 1.5, hp: 0.8, price: 1.1 }],
  elite: ['精英', { hp: 1.3, dmg: 1.3, price: 1.5, range: 1.1 }],
  cheap: ['廉价', { price: 0.6, hp: 0.7, dmg: 0.7 }],
};

// ---------- 新建 / 复制 ----------
export function addUnit(mod, ini, name) {
  let file = name + '.ini', i = 2;
  while (mod.lower.has(file.toLowerCase())) file = name + '_' + i++ + '.ini';
  const u = { file, ini };
  mod.units.push(u);
  mod.files.set(file, { bytes: enc.encode(serializeIni(ini)) });
  mod.lower.set(file.toLowerCase(), file);
  return u;
}
export function uniqueName(mod, base) {
  const have = new Set(mod.realUnits().map((u) => mod.unitName(u).toLowerCase()));
  let n = base, i = 2; while (have.has(n.toLowerCase())) n = base + '_' + i++;
  return n;
}
export function copyUnit(mod, u, newName, suffix = '') {
  const ini = cloneIni(u.ini);
  setVal(ini, 'core', 'name', newName);
  const dt = getVal(ini, 'core', 'displayText');
  if (dt && suffix) setVal(ini, 'core', 'displayText', dt + suffix);
  return addUnit(mod, ini, newName);
}
export function makeVariants(mod, u, keys) {
  const base = mod.unitName(u), out = [];
  for (const k of keys) {
    const [label, mult] = VARIANTS[k];
    const c = copyUnit(mod, u, uniqueName(mod, base + '_' + k), ' ' + label);
    scaleUnit(c.ini, mult); c.file && mod.files.set(c.file, { bytes: enc.encode(serializeIni(c.ini)) });
    out.push(c);
  }
  return out;
}
const T = (s) => parseIni(s.trim() + '\n');
export const TEMPLATES = {
  tank: ['坦克（陆地）', 'land', `[core]\nname: NAME\nclass: CustomUnitMetadata\nprice: 300\nmaxHp: 400\nradius: 16\nbuildSpeed: 8\ntechLevel: 1\n\n[graphics]\ntotal_frames: 1\n\n[movement]\nmovementType: LAND\nmoveSpeed: 1.0\nmaxTurnSpeed: 3\n\n[attack]\nmaxAttackRange: 160\ncanAttackFlyingUnits: false\n\n[turret_main]\nprojectile: shell\nbarrelY: 12\nturnSpeed: 4\ndelay: 70\n\n[projectile_shell]\nlife: 60\ndirectDamage: 30\nspeed: 8\n`],
  infantry: ['步兵', 'land', `[core]\nname: NAME\nclass: CustomUnitMetadata\nprice: 60\nmaxHp: 70\nradius: 6\nisBio: true\nbuildSpeed: 3\ntechLevel: 1\n\n[graphics]\ntotal_frames: 1\n\n[movement]\nmovementType: LAND\nmoveSpeed: 0.9\n\n[attack]\nmaxAttackRange: 110\n\n[turret_main]\nprojectile: bullet\nturnSpeed: 8\ndelay: 40\n\n[projectile_bullet]\nlife: 40\ndirectDamage: 6\nspeed: 10\n`],
  air: ['飞机（空中）', 'air', `[core]\nname: NAME\nclass: CustomUnitMetadata\nprice: 400\nmaxHp: 250\nradius: 14\nbuildSpeed: 10\ntechLevel: 2\n\n[graphics]\ntotal_frames: 1\n\n[movement]\nmovementType: AIR\nmoveSpeed: 2.5\ntargetHeight: 50\n\n[attack]\nmaxAttackRange: 130\n\n[turret_main]\nprojectile: bomb\nturnSpeed: 6\ndelay: 80\n\n[projectile_bomb]\nlife: 50\ndirectDamage: 25\nspeed: 6\n`],
  naval: ['舰船（水面）', 'naval', `[core]\nname: NAME\nclass: CustomUnitMetadata\nprice: 500\nmaxHp: 700\nradius: 22\nbuildSpeed: 14\ntechLevel: 2\n\n[graphics]\ntotal_frames: 1\n\n[movement]\nmovementType: WATER\nmoveSpeed: 0.8\n\n[attack]\nmaxAttackRange: 260\n\n[turret_main]\nprojectile: shell\nturnSpeed: 3\ndelay: 100\n\n[projectile_shell]\nlife: 90\ndirectDamage: 60\nspeed: 7\n`],
  building: ['工厂（建筑）', 'building', `[core]\nname: NAME\nclass: CustomUnitMetadata\nprice: 600\nmaxHp: 1200\nisBuilding: true\nradius: 30\nbuildSpeed: 20\ntechLevel: 1\n\n[graphics]\ntotal_frames: 1\n\n[canBuild_1]\nname: \npos: 1\n`],
  builder: ['建造者', 'land', `[core]\nname: NAME\nclass: CustomUnitMetadata\nprice: 200\nmaxHp: 150\nradius: 10\nisBuilder: true\nbuildSpeed: 6\nnanoRange: 100\ntechLevel: 1\n\n[graphics]\ntotal_frames: 1\n\n[movement]\nmovementType: LAND\nmoveSpeed: 0.9\n\n[canBuild_1]\nname: \npos: 1\n`],
  turret: ['防御炮塔（建筑）', 'building', `[core]\nname: NAME\nclass: CustomUnitMetadata\nprice: 250\nmaxHp: 500\nisBuilding: true\nradius: 14\nbuildSpeed: 10\ntechLevel: 1\n\n[graphics]\ntotal_frames: 1\n\n[attack]\nmaxAttackRange: 200\n\n[turret_main]\nprojectile: shell\nturnSpeed: 5\ndelay: 60\n\n[projectile_shell]\nlife: 70\ndirectDamage: 20\nspeed: 9\n`],
};
export function fromTemplate(mod, kind, name) {
  const ini = T(TEMPLATES[kind][2].replace('NAME', name));
  return addUnit(mod, ini, name);
}
export const WEAPONS = {
  mg: ['机枪', 'delay: 8\nturnSpeed: 7', 'life: 40\ndirectDamage: 4\nspeed: 12', 130],
  cannon: ['加农炮', 'delay: 70\nturnSpeed: 4', 'life: 70\ndirectDamage: 30\nspeed: 8', 180],
  rocket: ['火箭', 'delay: 110\nturnSpeed: 4', 'life: 90\ndirectDamage: 15\nareaDamage: 25\nareaRadius: 30\nspeed: 5', 220],
  artillery: ['榴弹炮（抛物线）', 'delay: 150\nturnSpeed: 2', 'life: 120\nareaDamage: 60\nareaRadius: 45\nballistic: true\nspeed: 5', 380],
  laser: ['激光（瞬发）', 'delay: 50\nturnSpeed: 6', 'life: 5\ndirectDamage: 14\ninstant: true\nspeed: 30', 160],
};
export function addWeapon(ini, key, name) {
  const [, tur, proj, range] = WEAPONS[key];
  const t = addSection(ini, 'turret_' + name), p = addSection(ini, 'projectile_' + name);
  t.lines.push({ raw: '', key: 'projectile', val: name, dirty: true });
  for (const ln of tur.split('\n')) { const i = ln.indexOf(':'); t.lines.push({ raw: '', key: ln.slice(0, i), val: ln.slice(i + 1).trim(), dirty: true }); }
  for (const ln of proj.split('\n')) { const i = ln.indexOf(':'); p.lines.push({ raw: '', key: ln.slice(0, i), val: ln.slice(i + 1).trim(), dirty: true }); }
  if (!(num(getVal(ini, 'attack', 'maxAttackRange')) >= range)) setVal(ini, 'attack', 'maxAttackRange', String(range));
}

// ---------- 对比、评分、散点 ----------
export function powerOf(s) { return Math.sqrt(Math.max(1, s.hp + s.shield) * Math.max(s.dps, 1)); }
export function compareRows(mod) {
  return mod.realUnits().map((u) => {
    const s = unitStats(u.ini), power = powerOf(s);
    return { u, ...s, power, eff: s.price > 0 ? power / s.price : NaN, hpPerCost: s.price > 0 ? s.hp / s.price : NaN, dpsPerCost: s.price > 0 ? s.dps / s.price : NaN };
  });
}
export function outliers(rows) {
  const e = rows.filter((r) => Number.isFinite(r.eff) && r.dps > 0).map((r) => r.eff).sort((a, b) => a - b);
  if (e.length < 3) return new Map();
  const med = e[Math.floor(e.length / 2)], out = new Map();
  for (const r of rows) if (Number.isFinite(r.eff) && r.dps > 0) { if (r.eff > med * 1.6) out.set(r.u, '偏强'); else if (r.eff < med / 1.6) out.set(r.u, '偏弱'); }
  return out;
}

// ---------- 战斗模拟（粗略估算） ----------
export function simulate(A, nA, B, nB, { dist = 400, maxT = 300 } = {}) {
  const dt = 0.1;
  const mk = (s, n, x0) => Array.from({ length: n }, (_, i) => ({ s, hp: s.hp + s.shield, x: x0 + (i % 5) * 8 * (x0 ? 1 : -1), y: Math.floor(i / 5) * 14 }));
  let a = mk(A, nA, 0), b = mk(B, nB, dist), t = 0;
  const eff = (att, def) => { const sh = att.shot; if (!sh) return 1; return Math.max(sh * 0.1, sh - def.armour) / sh; };
  const can = (att, def) => att.dps > 0 && (def.isAir ? att.air : att.ground);
  const step = (mine, foes, sm) => {
    for (const u of mine) {
      if (!foes.length) return;
      let best = null, bd = 1e9;
      for (const f of foes) if (can(u.s, f.s)) { const d = Math.hypot(f.x - u.x, f.y - u.y); if (d < bd) { bd = d; best = f; } }
      if (!best) continue;
      if (bd <= (u.s.range || 100)) sm.push([best, u.s.dps * dt * eff(u.s, best.s)]);
      else if (u.s.speed > 0) { const k = Math.min(bd, u.s.speed * 60 * dt) / bd; u.x += (best.x - u.x) * k; u.y += (best.y - u.y) * k; }
    }
  };
  while (t < maxT && a.length && b.length) {
    const hits = []; step(a, b, hits); step(b, a, hits);
    for (const [f, d] of hits) f.hp -= d;
    a = a.filter((u) => u.hp > 0); b = b.filter((u) => u.hp > 0); t += dt;
    if (hits.length === 0 && !a.some((u) => u.s.speed > 0) && !b.some((u) => u.s.speed > 0)) break;
  }
  const winner = a.length && !b.length ? 'A' : b.length && !a.length ? 'B' : 'draw';
  return { winner, time: Math.round(t * 10) / 10, leftA: a.length, leftB: b.length, hpA: Math.round(a.reduce((x, u) => x + u.hp, 0)), hpB: Math.round(b.reduce((x, u) => x + u.hp, 0)) };
}

// ---------- 建造树、引用、改名 ----------
const splitTokens = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const tokName = (t) => t.replace(/\*.*$/, '').trim();
export function buildGraph(mod) {
  const units = mod.realUnits(), byName = new Map(units.map((u) => [mod.unitName(u).toLowerCase(), u]));
  const edges = new Map(), builtBy = new Map();
  for (const u of units) {
    const out = [];
    for (const s of u.ini.sections) if (s.name.startsWith('canBuild_')) {
      for (const t of splitTokens(lineVal(s, 'name'))) { out.push(tokName(t)); }
    }
    edges.set(u, out.map((n) => ({ name: n, unit: byName.get(n.toLowerCase()) || null })));
    for (const n of out) { const tu = byName.get(n.toLowerCase()); if (tu) { if (!builtBy.has(tu)) builtBy.set(tu, []); builtBy.get(tu).push(u); } }
  }
  return { units, edges, builtBy };
}
export function refsOf(mod, name) {
  const ln = name.toLowerCase(), out = [];
  for (const u of mod.realUnits()) for (const s of u.ini.sections) for (const l of s.lines) {
    if (!l.key) continue;
    const isRef = (l.key === 'copyFrom' && s.name === 'core') || (l.key === 'name' && s.name.startsWith('canBuild_')) || (/^(convertTo|spawnUnits)$/.test(l.key) && /^(hidden)?[aA]ction_/.test(s.name));
    if (isRef && splitTokens(l.val).some((t) => tokName(t).toLowerCase() === ln)) out.push({ u, sec: s.name, key: l.key });
  }
  return out;
}
export function renameUnit(mod, u, newName) {
  const old = mod.unitName(u);
  for (const r of refsOf(mod, old)) {
    const s = getSec(r.u.ini, r.sec), l = s.lines.find((x) => x.key === r.key);
    l.val = splitTokens(l.val).map((t) => tokName(t).toLowerCase() === old.toLowerCase() ? newName + (t.includes('*') ? t.slice(t.indexOf('*')) : '') : t).join(', '); l.dirty = true;
  }
  setVal(u.ini, 'core', 'name', newName);
}

// ---------- 差异与更新日志 ----------
export function diffMod(mod, orig0 = mod.orig) {
  const res = []; const seen = new Set();
  for (const u of mod.realUnits()) {
    seen.add(u.file);
    const cur = serializeIni(u.ini), orig = orig0 && orig0.get(u.file);
    if (orig === undefined) { res.push({ kind: 'add', name: mod.unitName(u), file: u.file }); continue; }
    if (orig === cur) continue;
    const a = parseIni(orig), changes = [];
    const flat = (ini) => { const m = new Map(); for (const s of ini.sections) { if (s.name) m.set('[' + s.name + ']', ''); for (const l of s.lines) if (l.key) m.set('[' + s.name + '] ' + l.key, l.val); } return m; };
    const fa = flat(a), fb = flat(u.ini);
    for (const [k, v] of fb) { if (!fa.has(k)) changes.push({ k, to: v, t: 'add' }); else if (fa.get(k) !== v) changes.push({ k, from: fa.get(k), to: v, t: 'mod' }); }
    for (const [k, v] of fa) if (!fb.has(k)) changes.push({ k, from: v, t: 'del' });
    if (changes.length) res.push({ kind: 'mod', name: mod.unitName(u), file: u.file, changes });
  }
  if (orig0) for (const [f, t] of orig0) if (!seen.has(f) && /\.ini$/i.test(f) && /\[core\]/i.test(t) ) res.push({ kind: 'del', name: f.replace(/\.ini$/i, ''), file: f });
  return res;
}
export function changelogMd(d, title = 'Mod') {
  const L = ['# ' + title + ' 更新日志', ''];
  for (const x of d) {
    if (x.kind === 'add') L.push('- 新增单位：' + x.name);
    else if (x.kind === 'del') L.push('- 移除单位：' + x.name);
    else { L.push('## ' + x.name); for (const c of x.changes) L.push('- ' + c.k + (c.t === 'mod' ? '：' + c.from + ' → ' + c.to : c.t === 'add' ? ' 新增 ' + c.to : ' 删除')); L.push(''); }
  }
  if (d.length === 0) L.push('没有改动。');
  return L.join('\n');
}

// ---------- 素材检查 ----------
export function pngSize(b) {
  if (!b || b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}
export function resolveFile(mod, p, base = '') {
  const n = norm(p); if (!n) return null;
  return mod.lower.get(n) || mod.lower.get(((base || '').replace(/[^/]*$/, '') + n).toLowerCase()) || null;
}
export function assetIssues(mod) {
  const used = new Set(), out = [];
  const mark = (p, base) => { const k = resolveFile(mod, p, base); if (k) used.add(k.toLowerCase()); };
  const th = getVal(mod.info, 'mod', 'thumbnail'); if (th) mark(th);
  for (const s of mod.info.sections) for (const l of s.lines) if (l.key && /\.(png|jpg|jpeg|ogg|wav|mp3)\b/i.test(l.val || '')) for (const t of l.val.split(',')) mark(t);
  for (const u of mod.units) for (const s of u.ini.sections) for (const l of s.lines) if (l.key && /\.(png|jpg|jpeg|ogg|wav|mp3)\b/i.test(l.val || '')) for (const t of l.val.split(',')) mark(t, u.file);
  const unused = [];
  for (const k of mod.files.keys()) if (/\.(png|jpg|jpeg|ogg|wav|mp3)$/i.test(k) && !used.has(k.toLowerCase())) unused.push(k);
  for (const u of mod.realUnits()) {
    const img = getVal(u.ini, 'graphics', 'image'); if (!img) continue;
    const k = resolveFile(mod, img, u.file); if (!k || !/\.png$/i.test(k)) continue;
    const sz = pngSize(mod.files.get(k).bytes); if (!sz) { out.push({ lv: 'warn', msg: '图片不是有效的 PNG：' + k, file: u.file }); continue; }
    const fw = num(getVal(u.ini, 'graphics', 'frame_width')), fh = num(getVal(u.ini, 'graphics', 'frame_height')), tf = num(getVal(u.ini, 'graphics', 'total_frames'));
    if (fw > 0 && sz.w % fw) out.push({ lv: 'warn', msg: `图片宽 ${sz.w} 不是帧宽 ${fw} 的整数倍`, file: u.file });
    if (fh > 0 && sz.h % fh) out.push({ lv: 'warn', msg: `图片高 ${sz.h} 不是帧高 ${fh} 的整数倍`, file: u.file });
    if (fw > 0 && tf > 0) { const cap = Math.floor(sz.w / fw) * (fh > 0 ? Math.floor(sz.h / fh) : 1); if (tf > cap) out.push({ lv: 'warn', msg: `total_frames ${tf} 超过图片能放下的 ${cap} 帧`, file: u.file }); }
  }
  return { unused, issues: out };
}

// ---------- 评分与一键修复 ----------
export function scoreMod(mod, results) {
  const e = results.filter((r) => r.lv === 'error').length, w = results.filter((r) => r.lv === 'warn').length;
  const rows = compareRows(mod), out = outliers(rows);
  const items = [];
  let s = 100 - Math.min(60, e * 8) - Math.min(20, w * 2);
  if (e) items.push(`错误 ${e} 个（每个 -8，最多 -60）`);
  if (w) items.push(`警告 ${w} 个（每个 -2，最多 -20）`);
  const nd = rows.filter((r) => !getVal(r.u.ini, 'core', 'displayText') && !getVal(r.u.ini, 'core', 'displayDescription')).length;
  if (nd) { const p = Math.min(10, nd * 2); s -= p; items.push(`${nd} 个单位没有显示名称或描述（-${p}）`); }
  if (out.size) { const p = Math.min(10, out.size * 2); s -= p; items.push(`${out.size} 个单位性价比偏离中位数过多（-${p}）`); }
  if (!getVal(mod.info, 'mod', 'thumbnail')) { s -= 3; items.push('没有缩略图（-3）'); }
  return { score: Math.max(0, Math.round(s)), items };
}
export function autoFix(mod) {
  const log = [];
  if (!mod.lower.has('mod-info.txt')) { if (!getSec(mod.info, 'mod')) addSection(mod.info, 'mod'); setVal(mod.info, 'mod', 'title', mod.name); mod.files.set('mod-info.txt', { bytes: new Uint8Array() }); mod.lower.set('mod-info.txt', 'mod-info.txt'); log.push('补上 mod-info.txt'); }
  else if (!getVal(mod.info, 'mod', 'title')) { setVal(mod.info, 'mod', 'title', mod.name); log.push('mod-info 补上标题'); }
  const seen = new Set();
  for (const u of mod.realUnits()) {
    let nm = getVal(u.ini, 'core', 'name');
    if (!nm) { nm = u.file.replace(/^.*\//, '').replace(/\.ini$/i, '').replace(/\s+/g, '_'); setVal(u.ini, 'core', 'name', nm); log.push(`${u.file}：补上 name = ${nm}`); }
    else if (/\s/.test(nm)) { const n2 = nm.replace(/\s+/g, '_'); renameUnit(mod, u, n2); log.push(`${u.file}：名字去掉空格 ${nm} → ${n2}`); nm = n2; }
    if (seen.has(nm.toLowerCase())) { const n2 = uniqueName(mod, nm); renameUnit(mod, u, n2); log.push(`${u.file}：重名改为 ${n2}`); nm = n2; }
    seen.add(nm.toLowerCase());
    const projs = u.ini.sections.filter((s) => s.name.startsWith('projectile_')).map((s) => s.name.slice(11));
    for (const s of u.ini.sections.filter((x) => x.name.startsWith('turret_'))) {
      const p = (lineVal(s, 'projectile') || '').trim();
      if (!p && projs.length === 1) { setVal(u.ini, s.name, 'projectile', projs[0]); log.push(`${u.file}：[${s.name}] 指向唯一的弹道 ${projs[0]}`); }
      else if (p && !projs.includes(p)) { const near = projs.find((x) => x.toLowerCase() === p.toLowerCase()); if (near) { setVal(u.ini, s.name, 'projectile', near); log.push(`${u.file}：[${s.name}] 弹道大小写改为 ${near}`); } }
    }
  }
  return log;
}
