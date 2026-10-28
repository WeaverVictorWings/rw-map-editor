// Mod 编辑器（第一阶段）：浏览单位、表单编辑、源码、mod-info、检查、打包
import { h, toast, busy, modal, closeModal, confirmBox, select } from './ui.js';
import { pickFile, saveFile } from './files.js';
import { readZip, writeZip } from './zip.js';
import { parseIni, serializeIni, getVal, setVal, getSec, sectionNames, addSection, removeSection } from './ini.js';
import { SCHEMA, SECTION_LABEL, schemaKey, KNOWN_SECTIONS } from './modschema.js';
import { assetIssues } from './modlogic.js';
import { extraChecks, splitProject } from './modlogic2.js';

const dec = new TextDecoder();
const norm = (p) => String(p || '').trim().replace(/^ROOT:[\\/]*/i, '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
const isText = (n) => /\.(ini|txt|template)$/i.test(n);

// ---- 数据模型 ----
export class Mod {
  constructor() { this.files = new Map(); this.units = []; this.info = null; this.infoText = ''; this.root = ''; this.name = 'mod'; }
  static async fromEntries(entries, name) {
    const m = new Mod(); m.name = name.replace(/\.[^.]+$/, '');
    // 去掉共同的顶层目录
    const first = entries.map((e) => e.name.replace(/\\/g, '/').split('/'));
    let prefix = '';
    if (first.length && first.every((p) => p.length > 1 && p[0] === first[0][0]) && !entries.some((e) => /(^|\/)mod-info\.txt$/i.test(e.name) && e.name.split('/').length === 1)) {
      // 只有 mod-info.txt 在子目录里时才剥掉
      const mi = entries.find((e) => /\/mod-info\.txt$/i.test(e.name));
      if (mi) prefix = mi.name.replace(/mod-info\.txt$/i, '');
    }
    for (const e of entries) {
      const nm = e.name.replace(/\\/g, '/');
      if (prefix && !nm.startsWith(prefix)) continue;
      m.files.set(prefix ? nm.slice(prefix.length) : nm, { bytes: await e.bytes() });
    }
    m.index();
    return m;
  }
  index() {
    this.lower = new Map([...this.files.keys()].map((k) => [k.toLowerCase(), k]));
    const mi = this.files.get(this.lower.get('mod-info.txt') || '');
    this.infoText = mi ? dec.decode(mi.bytes) : '';
    this.info = parseIni(this.infoText || '[mod]\ntitle: ' + this.name + '\n');
    this.infoOrig = this.infoText ? serializeIni(this.info) : null;
    this.units = [];
    for (const [k, v] of this.files) {
      if (!/\.ini$/i.test(k) || /(^|\/)mod-info\.txt$/i.test(k)) continue;
      const text = dec.decode(v.bytes);
      const ini = parseIni(text);
      if (!this.orig) this.orig = new Map();
      if (!this.orig.has(k)) this.orig.set(k, serializeIni(ini));
      if (!getSec(ini, 'core') && !getSec(ini, 'graphics') && !getSec(ini, 'movement')) { this.units.push({ file: k, ini, text, notUnit: true }); continue; }
      this.units.push({ file: k, ini, text });
    }
  }
  has(p, base = '') {
    const n = norm(p); if (!n) return true;
    if (this.lower.has(n)) return true;
    const rel = (base ? base.replace(/[^/]*$/, '') : '') + n;
    return this.lower.has(rel.toLowerCase());
  }
  unitName(u) { return getVal(u.ini, 'core', 'name') || u.file.replace(/^.*\//, '').replace(/\.ini$/i, ''); }
  realUnits() { return this.units.filter((u) => !u.notUnit); }
  async iconOf(u) {
    const img = getVal(u.ini, 'graphics', 'image') || getVal(u.ini, 'graphics', 'image_turret');
    if (!img) return null;
    const n = norm(img);
    const key = this.lower.get(n) || this.lower.get(((u.file.replace(/[^/]*$/, '')) + n).toLowerCase());
    if (!key) return null;
    const f = this.files.get(key);
    if (!f._url) f._url = URL.createObjectURL(new Blob([f.bytes]));
    return { url: f._url, fw: +getVal(u.ini, 'graphics', 'frame_width') || 0, fh: +getVal(u.ini, 'graphics', 'frame_height') || 0 };
  }
  // 把编辑结果写回文件表，返回要打包的文件
  collect() {
    const out = [];
    const written = new Set();
    // 没改过的文件原样保留字节（换行、BOM 都不动），只写回改过的
    const infoNow = serializeIni(this.info);
    if (infoNow !== this.infoOrig) this.files.set(this.lower.get('mod-info.txt') || 'mod-info.txt', { bytes: new TextEncoder().encode(infoNow) });
    for (const u of this.units) {
      if (u.notUnit && !u.edited) continue;
      const now = u.srcDirty && u.text !== undefined ? u.text : serializeIni(u.ini);
      const was = this.orig && this.orig.get(u.file);
      if (was === now && this.files.has(u.file)) continue;
      this.files.set(u.file, { bytes: new TextEncoder().encode(now) });
    }
    for (const [k, v] of this.files) { if (!written.has(k)) out.push({ name: k, data: v.bytes }); written.add(k); }
    return out;
  }
}

// ---- 检查 ----
export function checkMod(mod) {
  const R = []; const add = (lv, msg, file) => R.push({ lv, msg, file });
  if (!mod.lower.has('mod-info.txt')) add('error', '缺少 mod-info.txt，游戏不会把它当作 Mod');
  const title = getVal(mod.info, 'mod', 'title');
  if (!title) add('warn', 'mod-info.txt 没写 title');
  const th = getVal(mod.info, 'mod', 'thumbnail');
  if (th && !mod.has(th)) add('warn', '缩略图文件不存在：' + th);
  if (!th) add('info', '没有设置缩略图（thumbnail）');
  const names = new Map();
  const unitNames = new Set(mod.realUnits().map((u) => mod.unitName(u).toLowerCase()));
  for (const u of mod.realUnits()) {
    const nm = getVal(u.ini, 'core', 'name');
    if (!nm) add('error', '缺少 [core] 的 name', u.file);
    else {
      if (names.has(nm.toLowerCase())) add('error', '单位代号重复：' + nm + '（与 ' + names.get(nm.toLowerCase()) + '）', u.file);
      names.set(nm.toLowerCase(), u.file);
      if (/\s/.test(nm)) add('warn', '单位代号里有空格：' + nm, u.file);
    }
    const secs = u.ini.sections.filter((s) => s.name);
    const seen = new Set();
    for (const s of secs) {
      if (seen.has(s.name)) add('warn', '重复的段：[' + s.name + ']', u.file);
      seen.add(s.name);
      const k = schemaKey(s.name);
      if (!k) add('warn', '不认识的段：[' + s.name + ']（拼写错了吗？）', u.file);
      else if (['core', 'graphics', 'movement', 'attack', 'ai'].includes(s.name) === false && !/_/.test(s.name) && ['turret', 'projectile', 'canBuild', 'action'].includes(k)) add('warn', '[' + s.name + '] 缺少 _名字 后缀', u.file);
    }
    if (!getSec(u.ini, 'core')) add('warn', '没有 [core] 段', u.file);
    // 图片、声音
    const chk = (sec, key, val, kind) => {
      for (const v of String(val || '').split(',')) {
        const t = v.trim(); if (!t || /^(none|null)$/i.test(t)) continue;
        if (kind === 'sound' && !/\.(ogg|wav|mp3)$/i.test(t)) continue; // 无扩展名的是原版音效
        if (kind === 'img' && /^(none|null|auto)$/i.test(t)) continue;
        if (!mod.has(t, u.file)) add('error', '[' + sec + '] ' + key + ' 指向不存在的文件：' + t, u.file);
      }
    };
    for (const s of secs) {
      for (const l of s.lines) {
        if (!l.key) continue;
        if (/^(image|image_wreak|image_shadow|image_turret|image_back|image_end|teamImage|teamImageLarge)$/i.test(l.key)) chk(s.name, l.key, l.val, 'img');
        else if (/sound$/i.test(l.key) || /^(shoot_sound|shoot_sound_vol)$/i.test(l.key)) { if (!/vol$/i.test(l.key)) chk(s.name, l.key, l.val, 'sound'); }
        const sk = schemaKey(s.name);
        if (sk && SCHEMA[sk].length && !SCHEMA[sk].some((f) => f.key === l.key) && !/_/.test(l.key) && !/^(image|sound)/i.test(l.key) && false) add('info', '[' + s.name + '] 里有未收录的键：' + l.key, u.file);
        if (/^(price|maxHp|moveSpeed|directDamage|areaDamage)$/.test(l.key) && l.val !== '' && isNaN(+l.val)) add('error', '[' + s.name + '] ' + l.key + ' 应为数字：' + l.val, u.file);
      }
    }
    // 炮塔引用的弹道
    const projs = new Set(secs.filter((s) => s.name.startsWith('projectile_')).map((s) => s.name.slice(11)));
    for (const s of secs.filter((x) => x.name.startsWith('turret_'))) {
      const p = (s.lines.find((l) => l.key === 'projectile') || {}).val;
      if (!p) add('warn', '[' + s.name + '] 没有设置 projectile', u.file);
      else if (!projs.has(p.trim()) && !/^[0-9]+$/.test(p.trim())) add('error', '[' + s.name + '] 引用了不存在的弹道 projectile_' + p, u.file);
    }
    // 引用别的单位
    const cf = getVal(u.ini, 'core', 'copyFrom');
    for (const nm2 of String(cf || '').split(',').map((x) => x.trim()).filter(Boolean)) if (!unitNames.has(nm2.toLowerCase()) && !mod.has(nm2) && !mod.has(nm2 + '.ini', u.file)) add('info', 'copyFrom 引用了本 Mod 外的 ' + nm2 + '（可能是原版单位）', u.file);
    for (const s of secs.filter((x) => x.name.startsWith('canBuild_'))) {
      const bn = ((s.lines.find((l) => l.key === 'name') || {}).val || '').trim();
      if (bn && !unitNames.has(bn.toLowerCase()) && !/^(c_|)/.test('')) add('info', '[' + s.name + '] 建造 ' + bn + ' 不在本 Mod 内（原版单位可忽略）', u.file);
    }
  }
  const A = assetIssues(mod);
  for (const x of A.issues) R.push(x);
  for (const x of extraChecks(mod)) R.push(x);
  if (A.unused.length) add('info', `有 ${A.unused.length} 个图片/音效没被任何地方引用（可在“工具 → 素材检查”里清理）`);
  return R;
}

// ---- 界面 ----
let mod = null, cur = null, ui = {};
// 撤销：每个单位存最近 60 份文本快照
export function snap(u) { (u.undo = u.undo || []).push(serializeIni(u.ini)); if (u.undo.length > 60) u.undo.shift(); u.redo = []; }
function undo(u, back) {
  const from = back ? u.undo : u.redo, to = back ? (u.redo = u.redo || []) : (u.undo = u.undo || []);
  if (!from || !from.length) { toast(back ? '没有可撤销的' : '没有可重做的'); return; }
  to.push(serializeIni(u.ini)); u.ini = parseIni(from.pop()); u.srcDirty = false; u.text = undefined; fillForm(); fillList();
}
async function delUnit() {
  if (!cur || !(await confirmBox('删除单位', '从 Mod 里删除 ' + mod.unitName(cur) + '？（打包时不再包含）', '删除', '取消', true))) return;
  mod.units = mod.units.filter((x) => x !== cur); mod.files.delete(cur.file); mod.lower.delete(cur.file.toLowerCase());
  cur = mod.realUnits()[0] || null; render();
}
const ctx = { get mod() { return mod; }, get cur() { return cur; }, set cur(u) { cur = u; }, refresh: () => render(), snap, visible: () => { const q = (ui.q || '').toLowerCase(); return mod.realUnits().filter((u) => !q || (mod.unitName(u) + ' ' + (getVal(u.ini, 'core', 'displayText') || '') + ' ' + u.file).toLowerCase().includes(q)); } };
export async function modEditorDialog() {
  const body = h('div', { class: 'modedit' });
  ui = { body };
  const style = h('style', {}, `.modedit{display:flex;flex-direction:column;gap:8px;min-height:60vh}.me-bar{display:flex;flex-wrap:wrap;gap:6px}.me-main{display:flex;gap:10px;min-height:50vh}.me-list{flex:0 0 38%;max-height:62vh;overflow:auto;border:1px solid var(--line,#8884);border-radius:8px}.me-row{display:flex;gap:8px;align-items:center;padding:6px;cursor:pointer;border-bottom:1px solid #8882}.me-row.on{background:#4a8cff33}.me-row canvas{width:36px;height:36px;image-rendering:pixelated;flex:none}.me-row small{opacity:.7;display:block}.me-form{flex:1;max-height:62vh;overflow:auto}.me-sec{border:1px solid #8884;border-radius:8px;margin:0 0 8px;padding:6px 8px}.me-sec h4{margin:0 0 6px;display:flex;justify-content:space-between;align-items:center}.me-f{display:grid;grid-template-columns:9em 1fr;gap:4px 8px;align-items:center;margin:3px 0}.me-f label{font-size:12px;opacity:.85}.me-f input,.me-f select{width:100%;box-sizing:border-box}.me-src{width:100%;min-height:50vh;font-family:monospace;font-size:12px;box-sizing:border-box}.me-chk div{padding:4px 0;border-bottom:1px solid #8882;font-size:13px}.me-chk .error{color:#e55}.me-chk .warn{color:#d90}.me-chk .info{opacity:.75}@media(max-width:700px){.me-main{flex-direction:column}.me-list{flex:none;max-height:26vh}.me-f{grid-template-columns:7em 1fr}}`);
  body.append(style);
  render();
  modal('Mod 编辑器', body, [{ label: '关闭', value: true }], { wide: true, full: true });
}

function render() {
  const body = ui.body; [...body.children].forEach((c) => { if (c.tagName !== 'STYLE') c.remove(); });
  const bar = h('div', { class: 'me-bar' },
    h('button', { onclick: openMod }, '打开 .rwmod / zip / 项目'),
    h('button', { onclick: openFolder }, '打开文件夹'),
    h('button', { onclick: newMod }, '新建 Mod'),
    mod ? h('button', { onclick: () => import('./modtools.js').then((m) => m.toolsDialog(ctx)) }, '工具') : null,
    mod ? h('button', { onclick: infoDialog }, 'Mod 信息') : null,
    mod ? h('button', { onclick: showCheck }, '检查') : null,
    mod ? h('button', { class: 'primary', onclick: pack }, '打包 .rwmod') : null);
  body.append(bar);
  if (!mod) { body.append(h('p', { class: 'hint' }, '打开一个 Mod（.rwmod 或 zip，或解压后的文件夹），就能浏览里面的单位、改数值、检查问题并重新打包。')); return; }
  const q = h('input', { type: 'search', placeholder: '搜索单位…', value: ui.q || '', oninput: (e) => { ui.q = e.target.value; fillList(); } });
  const list = h('div', { class: 'me-list' });
  const form = h('div', { class: 'me-form' });
  ui.list = list; ui.form = form;
  body.append(h('div', { class: 'hint' }, mod.name + ' · ' + mod.realUnits().length + ' 个单位 · ' + mod.files.size + ' 个文件'), q, h('div', { class: 'me-main' }, list, form));
  fillList(); fillForm();
}

async function drawIcon(cv, u) {
  const ic = await mod.iconOf(u); if (!ic) return;
  const im = new Image(); im.src = ic.url;
  try { await im.decode(); } catch { return; }
  const s = ic.fw && ic.fw <= im.width ? ic.fw : Math.min(im.width, im.height);
  const sh = ic.fh && ic.fh <= im.height ? ic.fh : Math.min(im.height, s);
  cv.width = 36; cv.height = 36;
  const k = Math.min(36 / s, 36 / sh), c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(im, 0, 0, s, sh, (36 - s * k) / 2, (36 - sh * k) / 2, s * k, sh * k);
}
function fillList() {
  const l = ui.list; l.replaceChildren();
  const q = (ui.q || '').toLowerCase();
  for (const u of mod.realUnits()) {
    const nm = mod.unitName(u);
    const disp = getVal(u.ini, 'core', 'displayText') || '';
    if (q && !(nm + ' ' + disp + ' ' + u.file + ' ' + (getVal(u.ini, 'core', 'tags') || '')).toLowerCase().includes(q)) continue;
    const cv = h('canvas', { width: 36, height: 36 });
    const stat = ['price', 'maxHp'].map((k) => { const v = getVal(u.ini, 'core', k); return v ? ({ price: '$', maxHp: '♥' })[k] + v : ''; }).concat(getVal(u.ini, 'movement', 'moveSpeed') ? '»' + getVal(u.ini, 'movement', 'moveSpeed') : '').filter(Boolean).join('  ');
    l.append(h('div', { class: 'me-row' + (cur === u ? ' on' : ''), onclick: () => { cur = u; ui.sec = null; fillList(); fillForm(); } }, cv, h('div', {}, h('b', { translate: 'no' }, nm), h('small', { translate: 'no' }, disp ? disp + ' · ' + stat : stat))));
    drawIcon(cv, u);
  }
  if (!l.children.length) l.append(h('p', { class: 'hint', style: 'padding:8px' }, '没有单位'));
}
function fillForm() {
  const f = ui.form; f.replaceChildren();
  if (!cur) { f.append(h('p', { class: 'hint' }, '从左边选一个单位。')); return; }
  const u = cur;
  const mode = ui.mode || 'form';
  f.append(h('div', { class: 'me-bar' },
    h('b', { translate: 'no' }, u.file),
    h('button', { onclick: () => undo(u, true), title: '撤销' }, '↶'), h('button', { onclick: () => undo(u, false), title: '重做' }, '↷'),
    h('button', { onclick: delUnit }, '删除单位'),
    h('button', { onclick: () => { if (mode === 'form') { u.text = serializeIni(u.ini); } else { applySource(u); } ui.mode = mode === 'form' ? 'src' : 'form'; fillForm(); } }, mode === 'form' ? '源码' : '回到表单'),
    mode === 'form' ? h('button', { onclick: addSecDialog }, '+ 添加段') : null));
  if (mode === 'src') {
    const ta = h('textarea', { class: 'me-src', spellcheck: 'false', translate: 'no', value: u.text, oninput: (e) => { u.text = e.target.value; u.srcDirty = true; } });
    f.append(ta); return;
  }
  for (const s of u.ini.sections.filter((x) => x.name)) f.append(secBox(u, s));
}
function applySource(u) {
  if (u.srcDirty) { u.ini = parseIni(u.text); u.srcDirty = false; }
}
function secBox(u, s) {
  const k = schemaKey(s.name);
  const defs = k ? SCHEMA[k] : [];
  const box = h('div', { class: 'me-sec' });
  box.append(h('h4', {}, h('span', {}, (SECTION_LABEL[k] || '未知') + ' [' + s.name + ']'), h('button', { class: 'ib', title: '删除这一段', onclick: async () => { if (await confirmBox('删除段', '删除 [' + s.name + '] ？', '删除', '取消', true)) { snap(u); removeSection(u.ini, s.name); fillForm(); fillList(); } } }, '×')));
  const known = new Set(defs.map((d) => d.key));
  const row = (key, label, type, help, val) => {
    let inp;
    const set = (v) => { snap(u); setVal(u.ini, s.name, key, v); if (key === 'name' || key === 'displayText' || key === 'price' || key === 'maxHp' || key === 'moveSpeed') fillListSoft(); };
    if (type === 'b') inp = select([['', '—'], ['true', '是'], ['false', '否']], val || '', set);
    else if (type.startsWith('e:')) inp = select([['', '—']].concat(type.slice(2).split('|')), val || '', set);
    else inp = h('input', { type: 'text', inputmode: type === 'n' ? 'decimal' : 'text', value: val || '', translate: 'no', title: help, onchange: (e) => set(e.target.value.trim()) });
    return [h('label', { title: help }, label + (help ? ' ⓘ' : '')), inp];
  };
  const grid = h('div', {});
  for (const d of defs) {
    const v = (s.lines.slice().reverse().find((l) => l.key === d.key) || {}).val;
    if (v === undefined && !ui.showAll) continue;
    const r = row(d.key, d.label, d.type, d.help, v);
    grid.append(h('div', { class: 'me-f' }, ...r));
  }
  for (const l of s.lines) if (l.key && !known.has(l.key)) {
    const r = row(l.key, l.key, 's', '未收录的键，原样保留', l.val);
    grid.append(h('div', { class: 'me-f' }, ...r));
  }
  // 添加字段
  const missing = defs.filter((d) => !s.lines.some((l) => l.key === d.key));
  if (missing.length) {
    const sel = select([['', '+ 添加字段…']].concat(missing.map((d) => [d.key, d.label + ' (' + d.key + ')'])), '', (v) => { if (!v) return; const d = defs.find((x) => x.key === v); snap(u); setVal(u.ini, s.name, v, d.type === 'b' ? 'true' : d.type === 'n' ? '0' : ' '); const ln = s.lines.find((l) => l.key === v); if (ln && ln.val === ' ') ln.val = ''; fillForm(); });
    box.append(grid, sel);
  } else box.append(grid);
  return box;
}
let softT = 0;
function fillListSoft() { clearTimeout(softT); softT = setTimeout(fillList, 400); }

async function addSecDialog() {
  const kinds = [['turret', '炮塔 turret_'], ['projectile', '弹道 projectile_'], ['canBuild', '可建造 canBuild_'], ['action', '动作 action_'], ['graphics', '图像'], ['movement', '移动'], ['attack', '攻击'], ['ai', 'AI']];
  let kind = 'turret', nm = 'main';
  const sel = select(kinds, kind, (v) => { kind = v; });
  const inp = h('input', { value: nm, oninput: (e) => { nm = e.target.value.trim(); } });
  const r = await modal('添加段', h('div', {}, h('label', {}, '类型'), sel, h('label', {}, '名字（需要后缀的类型才用）'), inp), [{ label: '取消', value: false }, { label: '添加', value: true, primary: true }]);
  if (!r) return;
  const sname = ['turret', 'projectile', 'canBuild', 'action'].includes(kind) ? kind + '_' + (nm || 'new') : kind;
  snap(cur); addSection(cur.ini, sname);
  fillForm();
}

// ---- 打开 ----
async function openMod() {
  const r = await pickFile('.rwmod,.zip,.rwproj'); if (!r) return;
  try {
    await busy('读取 Mod…', async () => { const buf = new Uint8Array(await r.file.arrayBuffer()); const ent = readZip(buf), pr = splitProject(ent); mod = await Mod.fromEntries(pr.rest, r.file.name); if (pr.meta) { try { const o = JSON.parse(await pr.meta.text()); mod.notes = o.notes; mod.todos = o.todos; mod.snaps = o.snaps; mod.unitNotes = o.unitNotes; toast('已载入项目（笔记、待办、快照）'); } catch {} } });
    cur = mod.realUnits()[0] || null; render();
  } catch (e) { toast(e.message || String(e), 5000); }
}
async function openFolder() {
  const el = document.createElement('input'); el.type = 'file'; el.multiple = true; el.setAttribute('webkitdirectory', '');
  el.onchange = async () => {
    const fs = [...el.files]; if (!fs.length) return;
    const entries = fs.map((f) => ({ name: f.webkitRelativePath || f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) }));
    // 去掉最外层目录名
    const top = entries[0].name.split('/')[0];
    for (const e of entries) e.name = e.name.split('/').slice(1).join('/') || e.name;
    await busy('读取文件夹…', async () => { mod = await Mod.fromEntries(entries, top); });
    cur = mod.realUnits()[0] || null; render();
  };
  el.click();
}
async function newMod() {
  mod = new Mod(); mod.name = 'my-mod';
  const unit = '[core]\nname: my_unit\nclass: CustomUnitMetadata\nprice: 200\nmaxHp: 300\nradius: 15\nbuildSpeed: 5\ntechLevel: 1\n\n[graphics]\ntotal_frames: 1\n\n[movement]\nmovementType: LAND\nmoveSpeed: 1.0\n\n[attack]\nmaxAttackRange: 150\n\n[turret_main]\nprojectile: bullet\nbarrelX: 0\nbarrelY: 10\nturnSpeed: 4\ndelay: 40\n\n[projectile_bullet]\nlife: 60\ndirectDamage: 10\nspeed: 8\n';
  mod.files.set('mod-info.txt', { bytes: new TextEncoder().encode('[mod]\ntitle: 我的 Mod\ndescription: \n') });
  mod.files.set('my_unit.ini', { bytes: new TextEncoder().encode(unit) });
  mod.index(); cur = mod.realUnits()[0]; render();
}

// ---- Mod 信息 / 检查 / 打包 ----
async function infoDialog() {
  const fields = [['title', '标题'], ['description', '简介'], ['thumbnail', '缩略图文件'], ['minVersion', '最低游戏版本'], ['tags', '标签']];
  const inputs = fields.map(([k, l]) => [k, l, k === 'description' ? h('textarea', { rows: 4, value: getVal(mod.info, 'mod', k) || '' }) : h('input', { value: getVal(mod.info, 'mod', k) || '' })]);
  const body = h('div', {}, inputs.map(([k, l, i]) => h('div', {}, h('label', {}, l), i)));
  const r = await modal('Mod 信息 (mod-info.txt)', body, [{ label: '取消', value: false }, { label: '保存', value: true, primary: true }]);
  if (!r) return;
  for (const [k, , i] of inputs) setVal(mod.info, 'mod', k, i.value.trim().replace(/\n/g, ' '));
  render();
}
function showCheck() {
  for (const u of mod.units) if (u.srcDirty) applySource(u);
  const R = checkMod(mod);
  const body = h('div', { class: 'me-chk' });
  const cnt = { error: 0, warn: 0, info: 0 }; R.forEach((r) => cnt[r.lv]++);
  body.append(h('p', {}, R.length ? `错误 ${cnt.error} · 警告 ${cnt.warn} · 提示 ${cnt.info}` : '没有发现问题 ✓'));
  const order = { error: 0, warn: 1, info: 2 };
  for (const r of R.sort((a, b) => order[a.lv] - order[b.lv])) body.append(h('div', { class: r.lv }, (r.lv === 'error' ? '✗ ' : r.lv === 'warn' ? '! ' : 'i ') + r.msg + (r.file ? '  — ' + r.file : '')));
  modal('检查结果', body, [{ label: '关闭', value: true }]);
  return R;
}
async function pack() {
  for (const u of mod.units) if (u.srcDirty) applySource(u);
  const R = checkMod(mod);
  const errs = R.filter((r) => r.lv === 'error');
  if (errs.length && !(await confirmBox('还有 ' + errs.length + ' 个错误', '仍然打包？建议先点“检查”看看。', '仍然打包', '取消'))) return;
  const files = mod.collect();
  const bytes = writeZip(files);
  const title = (getVal(mod.info, 'mod', 'title') || mod.name).replace(/[\\/:*?"<>|]/g, '_');
  const res = await saveFile(title + '.rwmod', bytes, 'application/octet-stream');
  if (res && res.ok !== false) toast('已打包 ' + files.length + ' 个文件');
}
