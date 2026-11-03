// Mod 编辑器逻辑（四，3.2）：派生向导、逐条修复、精灵图切帧、批量改、段复制粘贴、关系图、实时对比、全局搜索、字段搜索、图鉴网页、版本对比网页。纯逻辑。
import { serializeIni, getVal, setVal, getSec, addSection } from './ini.js';
import { SCHEMA, SECTION_LABEL } from './modschema.js';
import { copyUnit, uniqueName, scaleUnit, unitStats, compareRows, outliers, num, resolveFile, pngSize } from './modlogic.js';
import { autoDescription } from './modlogic2.js';

const dec = new TextDecoder();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 1. 派生向导 ----------
export const DERIVE = {
  faster: ['更快', '跑得快一点，血少一点，贵一点', { speed: 1.4, hp: 0.85, price: 1.1 }],
  tougher: ['更肉', '血厚、慢一点、贵一点', { hp: 1.6, speed: 0.85, price: 1.3 }],
  stronger: ['更能打', '伤害高、贵一点', { dmg: 1.5, price: 1.4 }],
  cheaper: ['更便宜', '便宜、略弱，适合量产', { price: 0.6, hp: 0.75, dmg: 0.8 }],
  ranged: ['射程更远', '打得远，但更脆、更贵', { range: 1.4, dmg: 0.9, hp: 0.85, price: 1.2 }],
};
// 返回 { unit, before, after, name }；自定义倍率 mult 可覆盖预设
export function deriveUnit(mod, u, kind, mult = null) {
  const [label, , preset] = DERIVE[kind]; const m = mult || preset;
  const before = unitStats(u.ini);
  const c = copyUnit(mod, u, uniqueName(mod, mod.unitName(u) + '_' + kind), ' ' + label);
  scaleUnit(c.ini, m);
  const d = autoDescription(c.ini); if (d) setVal(c.ini, 'core', 'displayDescription', d);
  mod.files.set(c.file, { bytes: new TextEncoder().encode(serializeIni(c.ini)) });
  return { unit: c, before, after: unitStats(c.ini), name: mod.unitName(c) };
}

// ---------- 2. 逐条修复 ----------
const unitOf = (mod, file) => mod.units.find((x) => x.file === file);
// 返回这条检查结果能怎么修（给按钮用）：{ label } 或 null
export function fixOf(mod, r) {
  if (!r || !r.file) return null;
  const u = unitOf(mod, r.file); if (!u || u.notUnit) return null;
  if (/引用了不存在的弹道 projectile_/.test(r.msg) && !getVal(u.ini, 'core', 'copyFrom')) return { label: '新建这个弹道' };
  if (/没写 \[core\] 的 name/.test(r.msg)) return { label: '用文件名当代号' };
  if (/total_frames \d+ 超过图片能放下的 \d+ 帧/.test(r.msg)) return { label: '改成图片能放下的帧数' };
  return null;
}
export function applyFix(mod, r) {
  const u = r && unitOf(mod, r.file); if (!u) return null;
  let m = /引用了不存在的弹道 projectile_(.+)$/.exec(r.msg);
  if (m && !getVal(u.ini, 'core', 'copyFrom')) {
    const n = 'projectile_' + m[1].trim();
    if (getSec(u.ini, n)) return null;
    addSection(u.ini, n); setVal(u.ini, n, 'life', '60'); setVal(u.ini, n, 'speed', '8'); setVal(u.ini, n, 'directDamage', '10');
    return u.file + '：新建了 [' + n + ']（伤害 10，请按需要改）';
  }
  if (/没写 \[core\] 的 name/.test(r.msg)) { const n = u.file.replace(/^.*\//, '').replace(/\.ini$/i, '').replace(/\s+/g, '_'); setVal(u.ini, 'core', 'name', uniqueName(mod, n)); return u.file + '：name = ' + n; }
  m = /total_frames \d+ 超过图片能放下的 (\d+) 帧/.exec(r.msg);
  if (m) { setVal(u.ini, 'graphics', 'total_frames', m[1]); return u.file + '：total_frames = ' + m[1]; }
  return null;
}

// ---------- 3. 精灵图切帧 ----------
// 从图片尺寸猜帧大小，返回候选 [{fw, fh, total, label}]
export function guessFrames(w, h) {
  const out = [], seen = new Set();
  const add = (fw, fh, label) => { if (fw < 4 || fh < 4 || w % fw || h % fh) return; const total = (w / fw) * (h / fh); if (total < 1 || total > 256) return; const k = fw + 'x' + fh; if (seen.has(k)) return; seen.add(k); out.push({ fw, fh, total, label: `${fw}×${fh}，${total} 帧（${label}）` }); };
  add(w, h, '整张就是一帧');
  if (w > h) add(h, h, '横排的正方形帧');
  if (h > w) add(w, w, '竖排的正方形帧');
  for (const s of [16, 24, 32, 48, 64, 96, 128, 192, 256]) if (s < Math.max(w, h)) add(s, s, '正方形格子');
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 16]) { if (w % n === 0 && w / n >= 8) add(w / n, h, `横向 ${n} 等分`); if (h % n === 0 && h / n >= 8) add(w, h / n, `纵向 ${n} 等分`); }
  return out.sort((a, b) => (a.total === 1) - (b.total === 1) || Math.abs(a.fw - a.fh) - Math.abs(b.fw - b.fh)).slice(0, 8);
}
// 把一张 png 放进 Mod 并（可选）挂到单位上；返回文件路径
export function importSprite(mod, name, bytes, cand, unit = null) {
  const dir = unit ? unit.file.replace(/[^/]*$/, '') : '';
  let path = dir + name.replace(/[\\/:*?"<>|]/g, '_'), i = 2;
  while (mod.lower.has(path.toLowerCase())) path = dir + name.replace(/\.png$/i, '') + '_' + i++ + '.png';
  mod.files.set(path, { bytes }); mod.lower.set(path.toLowerCase(), path);
  if (unit) {
    setVal(unit.ini, 'graphics', 'image', path.slice(dir.length));
    if (cand) { setVal(unit.ini, 'graphics', 'frame_width', String(cand.fw)); setVal(unit.ini, 'graphics', 'frame_height', String(cand.fh)); setVal(unit.ini, 'graphics', 'total_frames', String(cand.total)); }
  }
  return path;
}

// ---------- 4. 批量改 ----------
// spec: { sec: 'core' | 'turret_*', key, op: 'mul'|'add'|'set', value }
const secMatch = (pat, name) => (pat.endsWith('*') ? name.startsWith(pat.slice(0, -1)) : name === pat);
export function batchPreview(units, spec) {
  const rows = [], v = parseFloat(spec.value);
  for (const u of units) for (const s of u.ini.sections) {
    if (!s.name || !secMatch(spec.sec, s.name)) continue;
    const l = s.lines.slice().reverse().find((x) => x.key === spec.key);
    if (!l) { if (spec.op === 'set' && spec.value !== '' && s.name === spec.sec) rows.push({ u, sec: s.name, from: undefined, to: String(spec.value) }); continue; }
    if (spec.op === 'set') { if (l.val !== String(spec.value)) rows.push({ u, sec: s.name, from: l.val, to: String(spec.value) }); continue; }
    const cur = num(l.val); if (!Number.isFinite(cur) || !Number.isFinite(v)) continue;
    const nv = spec.op === 'mul' ? cur * v : cur + v;
    const to = (/\./.test(l.val) || Math.abs(nv - Math.round(nv)) > 1e-9) ? String(Math.round(nv * 1000) / 1000) : String(Math.round(nv));
    if (to !== l.val.trim()) rows.push({ u, sec: s.name, from: l.val, to });
  }
  return rows;
}
export function batchApply(rows, key) { for (const r of rows) setVal(r.u.ini, r.sec, key, r.to); return rows.length; }

// ---------- 5. 复制粘贴一段 ----------
export function copySection(u, secName) {
  const s = getSec(u.ini, secName); if (!s) return null;
  const secs = [{ name: s.name, lines: s.lines.map((l) => ({ ...l })) }];
  const p = /^turret_/.test(s.name) ? (s.lines.find((l) => l.key === 'projectile') || {}).val : null;
  if (p) { const ps = getSec(u.ini, 'projectile_' + p.trim()); if (ps) secs.push({ name: ps.name, lines: ps.lines.map((l) => ({ ...l })) }); }
  return { sections: secs };
}
// 粘贴到目标单位；同名段自动改名（弹道改名时炮塔的引用同步）。返回新增的段名
export function pasteSection(u, clip) {
  const added = [], rename = new Map();
  const free = (n) => { let x = n, i = 2; while (getSec(u.ini, x)) x = n + '_' + i++; return x; };
  for (const s of clip.sections) {
    const nn = free(s.name); if (nn !== s.name) rename.set(s.name, nn);
    u.ini.sections.push({ name: nn, lines: s.lines.map((l) => ({ ...l })) }); added.push(nn);
  }
  for (const [o, n] of rename) if (o.startsWith('projectile_')) for (const nm of added) if (nm.startsWith('turret_')) setVal(u.ini, nm, 'projectile', n.slice(11));
  return added;
}

// ---------- 6. 关系图 ----------
const toks = (v) => String(v || '').split(',').map((t) => t.trim().replace(/^.*[\\/]/, '').replace(/\*.*$/, '').trim()).filter(Boolean);
export function relationGraph(mod) {
  const units = mod.realUnits(), by = new Map(units.map((u) => [mod.unitName(u).toLowerCase(), u])), edges = [];
  for (const u of units) for (const s of u.ini.sections) for (const l of s.lines) {
    if (!l.key) continue; let kind = null;
    if (l.key === 'copyFrom' && s.name === 'core') kind = 'copy';
    else if (l.key === 'name' && s.name.startsWith('canBuild_')) kind = 'build';
    else if (/^(convertTo|spawnUnits)$/.test(l.key) && /^(hidden)?[aA]ction_/.test(s.name)) kind = 'make';
    if (!kind) continue;
    for (const t of toks(l.val)) { const to = by.get(t.toLowerCase()); if (to && to !== u) edges.push({ from: u, to, kind }); }
  }
  return { units, edges };
}
// 分层摆放：沿“造/继承”方向，根在左边。返回 [{u, x, y, layer}]
export function layoutGraph(g) {
  const out = new Map(); for (const u of g.units) out.set(u, []);
  const indeg = new Map(g.units.map((u) => [u, 0]));
  for (const e of g.edges) { out.get(e.from).push(e.to); indeg.set(e.to, indeg.get(e.to) + 1); }
  const layer = new Map(); const q = g.units.filter((u) => indeg.get(u) === 0);
  for (const u of q) layer.set(u, 0);
  for (let i = 0; i < q.length; i++) for (const t of out.get(q[i])) { if (!layer.has(t)) { layer.set(t, layer.get(q[i]) + 1); q.push(t); } }
  for (const u of g.units) if (!layer.has(u)) layer.set(u, 0); // 环
  const cols = new Map(); for (const u of g.units) { const l = layer.get(u); if (!cols.has(l)) cols.set(l, []); cols.get(l).push(u); }
  const res = [];
  for (const [l, us] of cols) us.forEach((u, i) => res.push({ u, layer: l, x: l, y: i }));
  return res;
}

// ---------- 7. 实时对比：这个单位在整个 Mod 里处于什么位置 ----------
export function standing(mod, u) {
  const rows = compareRows(mod), me = rows.find((r) => r.u === u); if (!me) return null;
  const out = outliers(rows), withEff = rows.filter((r) => Number.isFinite(r.eff) && r.dps > 0).sort((a, b) => b.eff - a.eff);
  const rank = withEff.indexOf(me) + 1;
  return { power: me.power, dps: me.dps, hp: me.hp, price: me.price, rank: rank || null, total: withEff.length, verdict: out.get(u) || (rank ? '正常' : '没有武器，不参与比较') };
}
export function deltaText(a, b) {
  const f = (x, y, n) => (x > 0 && y > 0 && Math.abs(y / x - 1) >= 0.005 ? `${n} ${y > x ? '+' : ''}${Math.round((y / x - 1) * 100)}%` : null);
  return [f(a.hp, b.hp, '生命'), f(a.dps, b.dps, 'DPS'), f(a.price, b.price, '造价'), f(a.speed, b.speed, '速度'), f(a.range, b.range, '射程')].filter(Boolean).join('，') || '数值没变';
}

// ---------- 9. 全局搜索 ----------
const BIN = /\.(png|jpe?g|gif|bmp|ogg|wav|mp3|zip|ttf|otf|rwmod)$/i;
// 在 Mod 的所有文本文件里找；返回 [{file, line, text, unit}]，最多 limit 条
export function searchMod(mod, q, { regex = false, caseSens = false, limit = 500 } = {}) {
  if (!q) return [];
  let re; try { re = regex ? new RegExp(q, caseSens ? '' : 'i') : null; } catch { return []; }
  const needle = caseSens ? q : q.toLowerCase(), out = [];
  const byFile = new Map(mod.units.map((u) => [u.file, u]));
  for (const [k, v] of mod.files) {
    if (BIN.test(k) || v.bytes.length > 2e6) continue;
    const u = byFile.get(k), text = u ? (u.srcDirty && u.text !== undefined ? u.text : serializeIni(u.ini)) : dec.decode(v.bytes);
    const ls = text.split(/\r?\n/);
    for (let i = 0; i < ls.length; i++) {
      const hit = re ? re.test(ls[i]) : (caseSens ? ls[i] : ls[i].toLowerCase()).includes(needle);
      if (hit) { out.push({ file: k, line: i + 1, text: ls[i].trim().slice(0, 200), unit: u && !u.notUnit ? u : null }); if (out.length >= limit) return out; }
    }
  }
  return out;
}

// ---------- 16. 字段帮助搜索 ----------
export function searchFields(q) {
  const s = String(q || '').trim().toLowerCase(); if (!s) return [];
  const out = [];
  for (const [sec, defs] of Object.entries(SCHEMA)) for (const d of defs) {
    const hay = (d.key + ' ' + d.label + ' ' + (d.help || '')).toLowerCase();
    if (hay.includes(s)) out.push({ sec, secLabel: SECTION_LABEL[sec] || sec, key: d.key, label: d.label, help: d.help || '', type: d.type, score: d.key.toLowerCase() === s ? 0 : d.key.toLowerCase().startsWith(s) || d.label.includes(s) ? 1 : 2 });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 30);
}

// ---------- 18. 图鉴网页（单文件，图片直接内嵌）----------
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
export function galleryHtml(mod, title) {
  const rows = compareRows(mod), imgs = new Map(); let css = '';
  const cls = (u) => {
    const img = getVal(u.ini, 'graphics', 'image'); if (!img) return null;
    const k = resolveFile(mod, img, u.file); if (!k || !/\.png$/i.test(k)) return null;
    const bytes = mod.files.get(k).bytes; if (bytes.length > 400000) return null;
    const sz = pngSize(bytes); if (!sz) return null;
    const fw = Math.min(sz.w, num(getVal(u.ini, 'graphics', 'frame_width')) || sz.w), fh = Math.min(sz.h, num(getVal(u.ini, 'graphics', 'frame_height')) || sz.h);
    const key = k + '|' + fw + 'x' + fh;
    if (!imgs.has(key)) { const c = 'i' + imgs.size; imgs.set(key, c); const sc = Math.min(1, 64 / Math.max(fw, fh)); css += `.${c}{width:${fw}px;height:${fh}px;background:url(data:image/png;base64,${b64(bytes)}) 0 0 no-repeat;transform:scale(${sc});transform-origin:0 0}`; return { c, w: Math.round(fw * sc), h: Math.round(fh * sc) }; }
    const sc = Math.min(1, 64 / Math.max(fw, fh)); return { c: imgs.get(key), w: Math.round(fw * sc), h: Math.round(fh * sc) };
  };
  const f = (n) => (Number.isFinite(n) && n ? String(Math.round(n * 10) / 10) : '-');
  const body = rows.map((r) => { const i = cls(r.u), nm = getVal(r.u.ini, 'core', 'displayText') || ''; return `<tr><td>${i ? `<div style="width:${i.w}px;height:${i.h}px;overflow:hidden"><div class="${i.c}"></div></div>` : ''}</td><td><b>${esc(mod.unitName(r.u))}</b><br><small>${esc(nm)}</small></td><td>${f(r.price)}</td><td>${f(r.hp)}</td><td>${f(r.speed)}</td><td>${f(r.range)}</td><td>${f(r.dps)}</td><td>${f(r.power)}</td></tr>`; }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:14px system-ui,sans-serif;margin:16px;background:#fff;color:#222}@media(prefers-color-scheme:dark){body{background:#181a1f;color:#ddd}}table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #8884;text-align:right}td:nth-child(-n+2),th:nth-child(-n+2){text-align:left}th{cursor:pointer;position:sticky;top:0;background:inherit}small{opacity:.7}${css}</style></head><body><h1>${esc(title)}</h1><p>共 ${rows.length} 个单位。数值是按配置算的估算，点表头可排序。</p><table id="t"><thead><tr><th></th><th>单位</th><th>造价</th><th>生命</th><th>速度</th><th>射程</th><th>DPS</th><th>战力</th></tr></thead><tbody>${body}</tbody></table><script>document.querySelectorAll('th').forEach(function(h,i){if(i<2)return;h.onclick=function(){var b=document.querySelector('tbody'),r=[].slice.call(b.rows);var d=h.d=!h.d;r.sort(function(a,c){var x=parseFloat(a.cells[i].textContent)||0,y=parseFloat(c.cells[i].textContent)||0;return d?y-x:x-y});r.forEach(function(x){b.appendChild(x)})}})</script></body></html>`;
}

// ---------- 19. 版本对比网页 + 公告稿 ----------
export function diffHtml(d, title) {
  const row = (c) => `<li><code>${esc(c.k)}</code> ${c.t === 'mod' ? `${esc(c.from)} → <b>${esc(c.to)}</b>` : c.t === 'add' ? `新增 <b>${esc(c.to)}</b>` : '删除'}</li>`;
  const s = d.map((x) => x.kind === 'add' ? `<h3>新增：${esc(x.name)}</h3>` : x.kind === 'del' ? `<h3>移除：${esc(x.name)}</h3>` : `<h3>${esc(x.name)}</h3><ul>${x.changes.map(row).join('')}</ul>`).join('') || '<p>没有改动。</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} 更新内容</title><style>body{font:15px system-ui,sans-serif;margin:16px;max-width:720px}code{opacity:.75}</style></head><body><h1>${esc(title)} 更新内容</h1>${s}</body></html>`;
}
// 给玩家群发的短公告：只挑最值得说的
export function announcement(d, title, version = '') {
  const L = [`【${title}${version ? ' ' + version : ''} 更新】`]; const add = d.filter((x) => x.kind === 'add').map((x) => x.name), del = d.filter((x) => x.kind === 'del').map((x) => x.name);
  if (add.length) L.push('新增：' + add.join('、'));
  if (del.length) L.push('移除：' + del.join('、'));
  const keyOf = /\] (price|maxHp|moveSpeed|directDamage|areaDamage|maxAttackRange)$/;
  for (const x of d.filter((y) => y.kind === 'mod').slice(0, 15)) { const cs = x.changes.filter((c) => c.t === 'mod' && keyOf.test(c.k)).map((c) => `${c.k.replace(/^.*\] /, '')} ${c.from}→${c.to}`); if (cs.length) L.push(x.name + '：' + cs.join('，')); }
  if (L.length === 1) L.push('小改动和修复。');
  return L.join('\n');
}
