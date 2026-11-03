// Mod 编辑器工具集（四，3.2）：派生向导、导入精灵图、批量改、关系图、全局搜索、字段帮助、图鉴网页、版本对比、单位长按菜单、音效试听
import { h, toast, modal, closeModal, select } from './ui.js';
import { pickFile, saveFile } from './files.js';
import { readZip } from './zip.js';
import { getVal, cloneIni } from './ini.js';
import { Mod } from './modedit.js';
import { resolveFile, unitStats, scaleUnit, pngSize } from './modlogic.js';
import * as F from './modlogic4.js';
import { SCHEMA } from './modschema.js';
import { diffMods, syncSources } from './modlogic3.js';
import { changelogMd } from './modlogic.js';

const fld = (label, el) => h('div', { style: 'margin:6px 0' }, h('label', {}, label), el);
const CLOSE = [{ label: '关闭', value: true }];
const OK = [{ label: '取消', value: false }, { label: '确定', value: true, primary: true }];
const need = (ctx) => { if (!ctx.cur) { toast('先在左边选一个单位'); return false; } return true; };
const title = (m) => (getVal(m.info, 'mod', 'title') || m.name).replace(/[\\/:*?"<>|]/g, '_');
const copyText = (t) => { try { navigator.clipboard.writeText(t); toast('已复制'); } catch { toast('复制失败，请手动选中复制'); } };
const enc = (s) => new TextEncoder().encode(s);

export const TOOLS4 = [
  ['派生向导', '选一个单位，回答“要更快、更肉还是更能打”，自动生成新单位并预览变化', derive],
  ['导入精灵图并切帧', '选一张图，自动猜帧大小，预览动画，写好帧参数', sprite],
  ['批量改多个单位', '勾选一批单位，把某个值统一乘、加或设成一个数，先预览再应用', batch],
  ['关系图', '继承、建造、生成关系画成图，点一下跳到单位', relation],
  ['全局搜索', '在所有文件里找文字（可用正则），点结果跳到单位', searchAll],
  ['字段帮助搜索', '输入“射程”“speed”，找到对应的键和说明', fieldHelp],
  ['导出图鉴网页', '一个 .html 文件，图片内嵌，发给朋友打开就能看所有单位', gallery],
  ['和另一个版本对比', '选旧版 .rwmod，生成变化列表、公告稿和网页', compareVersion],
];

// ---- 音效试听 ----
let audio = null;
export function playAudio(mod, val, base) {
  const k = resolveFile(mod, val, base); if (!k) { toast('找不到这个音频文件'); return; }
  try {
    if (audio) { audio.pause(); URL.revokeObjectURL(audio.src); }
    const ext = /\.wav$/i.test(k) ? 'audio/wav' : /\.mp3$/i.test(k) ? 'audio/mpeg' : 'audio/ogg';
    audio = new Audio(URL.createObjectURL(new Blob([mod.files.get(k).bytes], { type: ext })));
    audio.play().catch(() => toast('这个设备的浏览器放不了这种音频（部分 iPhone 不支持 ogg）', 4000));
  } catch { toast('播放失败'); }
}

// ---- 单位长按 / 右键菜单 ----
export function rowMenu(ctx, u) {
  const run = (fn) => () => { closeModal(); fn(ctx); };
  const box = h('div', {},
    ...[['派生新单位…', derive], ['复制一份', async (c) => { const L = await import('./modlogic.js'); c.snap(u); const n = L.copyUnit(c.mod, u, L.uniqueName(c.mod, c.mod.unitName(u) + '_copy'), ' 副本'); c.cur = n; c.refresh(); }], ['关系图', relation]]
      .map(([t, fn]) => h('button', { style: 'display:block;width:100%;text-align:left;margin:4px 0;padding:10px', onclick: run(fn) }, t)));
  modal(ctx.mod.unitName(u), box, CLOSE);
}

// ---- 派生向导 ----
async function derive(ctx) {
  if (!need(ctx)) return;
  const u = ctx.cur; let kind = 'tougher';
  const info = h('div', { class: 'hint', style: 'margin:8px 0' });
  const show = () => { const c = cloneIni(u.ini); scaleUnit(c, F.DERIVE[kind][2]); info.textContent = F.DERIVE[kind][1] + '。变化：' + F.deltaText(unitStats(u.ini), unitStats(c)); };
  const sel = select(Object.entries(F.DERIVE).map(([k, v]) => [k, v[0]]), kind, (v) => { kind = v; show(); });
  show();
  const r = await modal('派生向导 — ' + ctx.mod.unitName(u), h('div', {}, h('p', {}, '想让新单位怎么变？'), sel, info, h('p', { class: 'hint' }, '会复制出一个新单位（代号自动加后缀），名字和描述也会更新。'), getVal(u.ini, 'core', 'copyFrom') ? h('p', { style: 'color:#d90' }, '这个单位的数值是 copyFrom 继承来的，派生只会改写在它自己文件里的值，可能看不出变化。想改继承来的值，先在表单里把它写进来。') : null), OK);
  if (!r) return;
  ctx.snap(u);
  const d = F.deriveUnit(ctx.mod, u, kind); ctx.cur = d.unit; ctx.refresh(); toast('已生成 ' + d.name + '：' + F.deltaText(d.before, d.after), 4500);
}

// ---- 导入精灵图并切帧 ----
async function sprite(ctx) {
  const r = await pickFile('image/png'); if (!r) return;
  const bytes = new Uint8Array(await r.file.arrayBuffer()), sz = pngSize(bytes);
  if (!sz) { toast('这不是有效的 PNG 图片'); return; }
  const cands = F.guessFrames(sz.w, sz.h); if (!cands.length) cands.push({ fw: sz.w, fh: sz.h, total: 1, label: '整张当一帧' });
  let ci = 0, attach = !!ctx.cur, f = 0, timer = 0;
  const cv = h('canvas', { width: 160, height: 160, style: 'width:160px;height:160px;background:#8882;border-radius:8px;image-rendering:pixelated' });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), im = new Image(); im.src = url; try { await im.decode(); } catch { /* 预览失败不影响导入 */ }
  const draw = () => { const c = cands[ci], g = cv.getContext('2d'); g.clearRect(0, 0, 160, 160); g.imageSmoothingEnabled = false; const per = Math.max(1, Math.floor(sz.w / c.fw)), k = f % c.total, s = Math.min(160 / c.fw, 160 / c.fh); try { g.drawImage(im, (k % per) * c.fw, Math.floor(k / per) * c.fh, c.fw, c.fh, (160 - c.fw * s) / 2, (160 - c.fh * s) / 2, c.fw * s, c.fh * s); } catch { /* 图未就绪 */ } };
  timer = setInterval(() => { f++; draw(); }, 150); draw();
  const sel = select(cands.map((c, i) => [String(i), c.label]), '0', (v) => { ci = +v; f = 0; draw(); });
  const cb = h('input', { type: 'checkbox', checked: attach, disabled: !ctx.cur, onchange: (e) => { attach = e.target.checked; } });
  const ok = await modal('导入精灵图', h('div', {}, h('p', { class: 'hint' }, `图片 ${sz.w}×${sz.h}。选一个看起来动画正常的切法：`), sel, cv, h('label', { style: 'display:block;margin-top:8px' }, cb, ctx.cur ? ' 同时设为当前单位的图片（会写好 frame_width / frame_height / total_frames）' : ' （先选一个单位才能挂上去）')), OK);
  clearInterval(timer); URL.revokeObjectURL(url);
  if (!ok) return;
  const u = attach && ctx.cur ? ctx.cur : null; if (u) ctx.snap(u);
  const path = F.importSprite(ctx.mod, r.file.name || 'sprite.png', bytes, cands[ci], u); ctx.refresh(); toast('已放进 Mod：' + path, 3500);
}

// ---- 批量改 ----
async function batch(ctx) {
  const units = ctx.mod.realUnits(); if (!units.length) return;
  const chosen = new Set(ctx.visible()); const spec = { sec: 'core', key: 'price', op: 'mul', value: '1.1' };
  const list = h('div', { style: 'max-height:22vh;overflow:auto;border:1px solid #8884;border-radius:6px;padding:4px' });
  for (const u of units) list.append(h('label', { style: 'display:block' }, h('input', { type: 'checkbox', checked: chosen.has(u), onchange: (e) => { e.target.checked ? chosen.add(u) : chosen.delete(u); upd(); } }), ' ' + ctx.mod.unitName(u)));
  const prev = h('div', { class: 'hint', style: 'max-height:20vh;overflow:auto;margin-top:6px' });
  const secs = ['core', 'graphics', 'movement', 'attack', 'ai', 'turret_*', 'projectile_*', 'action_*', 'canBuild_*'];
  const keys = h('datalist', { id: 'bk' }, ...[...new Set(Object.values(SCHEMA).flat().map((d) => d.key))].map((k) => h('option', { value: k })));
  const inKey = h('input', { type: 'text', value: spec.key, list: 'bk', oninput: (e) => { spec.key = e.target.value.trim(); upd(); } });
  let rows = [];
  function upd() { rows = F.batchPreview(units.filter((u) => chosen.has(u)), spec); prev.replaceChildren(h('b', {}, rows.length ? `会改 ${rows.length} 处：` : '没有可改的（键不存在？继承来的值不在本文件里）'), ...rows.slice(0, 15).map((r) => h('div', {}, ctx.mod.unitName(r.u) + ' [' + r.sec + '] ' + spec.key + '：' + (r.from ?? '（无）') + ' → ' + r.to))); }
  const body = h('div', {}, h('p', { class: 'hint' }, '勾选单位，选哪一段、哪个键、怎么改。只改写在本文件里的值，不碰继承来的。'), list,
    fld('段', select(secs.map((x) => [x, x]), spec.sec, (v) => { spec.sec = v; upd(); })), fld('键（英文）', h('span', {}, inKey, keys)),
    fld('怎么改', select([['mul', '乘以'], ['add', '加上'], ['set', '设为']], spec.op, (v) => { spec.op = v; upd(); })),
    fld('数值', h('input', { type: 'text', value: spec.value, oninput: (e) => { spec.value = e.target.value.trim(); upd(); } })), prev);
  upd();
  const ok = await modal('批量改', body, [{ label: '取消', value: false }, { label: '应用', value: true, primary: true }], { wide: true }); if (!ok || !rows.length) return;
  for (const u of new Set(rows.map((r) => r.u))) ctx.snap(u);
  const n = F.batchApply(rows, spec.key); ctx.refresh(); toast(`改了 ${n} 处（可用单位上的撤销）`, 3500);
}

// ---- 关系图 ----
function relation(ctx) {
  const g = F.relationGraph(ctx.mod); let units = g.units, edges = g.edges, note = '';
  if (units.length > 120) {
    const start = ctx.cur || units[0], seen = new Set([start]); let grew = true;
    while (grew) { grew = false; for (const e of edges) { if (seen.has(e.from) !== seen.has(e.to)) { seen.add(e.from); seen.add(e.to); grew = true; } } }
    units = units.filter((u) => seen.has(u)); edges = edges.filter((e) => seen.has(e.from)); note = `单位太多，只画和“${ctx.mod.unitName(start)}”有关系的 ${units.length} 个。先在左边选好单位再打开。`;
  }
  const lay = F.layoutGraph({ units, edges }), pos = new Map(lay.map((n) => [n.u, n]));
  const W = 150, H = 30, GX = 60, GY = 12, ns = 'http://www.w3.org/2000/svg';
  const mx = Math.max(0, ...lay.map((n) => n.x)), my = Math.max(0, ...lay.map((n) => n.y));
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', (mx + 1) * (W + GX)); svg.setAttribute('height', (my + 1) * (H + GY) + 10); svg.style.maxWidth = 'none';
  const el = (t, a, txt) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); if (txt !== undefined) e.textContent = txt; return e; };
  const COL = { copy: '#a6e', build: '#4a8cff', make: '#e94' };
  for (const e of edges) { const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) continue; svg.append(el('line', { x1: a.x * (W + GX) + W, y1: a.y * (H + GY) + H / 2, x2: b.x * (W + GX), y2: b.y * (H + GY) + H / 2, stroke: COL[e.kind], 'stroke-width': 1.5, opacity: 0.8 })); }
  for (const n of lay) { const gx = el('g', { style: 'cursor:pointer' }); gx.append(el('rect', { x: n.x * (W + GX), y: n.y * (H + GY), width: W, height: H, rx: 6, fill: n.u === ctx.cur ? '#4a8cff55' : '#8883', stroke: '#8886' }), el('text', { x: n.x * (W + GX) + 8, y: n.y * (H + GY) + 19, 'font-size': 12, fill: 'currentColor' }, ctx.mod.unitName(n.u).slice(0, 18))); gx.addEventListener('click', () => { ctx.cur = n.u; closeModal(); ctx.refresh(); }); svg.append(gx); }
  const legend = h('p', { class: 'hint' }, h('span', { style: 'color:' + COL.copy }, '━ 继承 '), h('span', { style: 'color:' + COL.build }, '━ 能建造 '), h('span', { style: 'color:' + COL.make }, '━ 按钮生成/转换 '), note);
  modal('关系图（点单位跳过去）', h('div', {}, legend, h('div', { style: 'overflow:auto;max-height:60vh;border:1px solid #8884;border-radius:8px' }, svg)), CLOSE, { wide: true });
}

// ---- 全局搜索 ----
function searchAll(ctx) {
  for (const u of ctx.mod.units) if (u.srcDirty) syncSources(ctx.mod);
  let q = '', rx = false;
  const out = h('div', { style: 'max-height:45vh;overflow:auto;font-size:13px', translate: 'no' });
  const run = () => {
    const hits = F.searchMod(ctx.mod, q, { regex: rx, limit: 200 }); out.replaceChildren(h('div', { class: 'hint' }, q ? `${hits.length}${hits.length >= 200 ? '+' : ''} 处` : '输入要找的文字'));
    for (const x of hits) out.append(h('div', { style: 'padding:3px 0;border-bottom:1px solid #8882;cursor:' + (x.unit ? 'pointer' : 'default'), onclick: () => { if (!x.unit) return; ctx.cur = x.unit; closeModal(); ctx.refresh(); toast('第 ' + x.line + ' 行：' + x.text.slice(0, 40), 4000); } }, h('b', {}, x.file.replace(/^.*\//, '') + ':' + x.line + ' '), x.text));
  };
  const inp = h('input', { type: 'search', placeholder: '例如 projectile_ 或某个单位代号', style: 'width:100%', oninput: (e) => { q = e.target.value; run(); } });
  modal('全局搜索', h('div', {}, inp, h('label', {}, h('input', { type: 'checkbox', onchange: (e) => { rx = e.target.checked; run(); } }), ' 正则表达式'), out), CLOSE, { wide: true }); run(); setTimeout(() => inp.focus(), 50);
}

// ---- 字段帮助 ----
function fieldHelp() {
  const out = h('div', { style: 'max-height:50vh;overflow:auto;font-size:13px' });
  const run = (q) => { const rs = F.searchFields(q); out.replaceChildren(h('div', { class: 'hint' }, q ? (rs.length ? '' : '没找到。键名没收录不代表游戏不认，只是我没有这个键的说明。') : '输入中文或英文，如“射程”“speed”“护盾”')); for (const r of rs) out.append(h('div', { style: 'padding:4px 0;border-bottom:1px solid #8882' }, h('b', { translate: 'no' }, r.key), '  ' + r.label + '  ', h('small', {}, '写在 [' + r.sec + '] 段（' + r.secLabel + '）· ' + ({ n: '数字', b: 'true/false', s: '文字' }[r.type] || '选项 ' + r.type.slice(2))), r.help ? h('div', { class: 'hint' }, r.help) : null)); };
  const inp = h('input', { type: 'search', placeholder: '想改什么？', style: 'width:100%', oninput: (e) => run(e.target.value) });
  modal('字段帮助搜索', h('div', {}, inp, out), CLOSE, { wide: true }); run(''); setTimeout(() => inp.focus(), 50);
}

// ---- 图鉴网页 ----
async function gallery(ctx) {
  syncSources(ctx.mod);
  const html = F.galleryHtml(ctx.mod, title(ctx.mod));
  await saveFile(title(ctx.mod) + '-图鉴.html', enc(html), 'text/html'); toast(`图鉴网页 ${(html.length / 1048576).toFixed(1)} MB，发给别人用浏览器打开即可`, 4000);
}

// ---- 版本对比 ----
async function compareVersion(ctx) {
  const r = await pickFile('.rwmod,.zip'); if (!r) return;
  let old; try { old = await Mod.fromEntries(readZip(new Uint8Array(await r.file.arrayBuffer())), r.file.name); } catch (e) { toast(e.message, 4000); return; }
  syncSources(ctx.mod);
  const d = diffMods(old, ctx.mod), t = title(ctx.mod), ann = F.announcement(d, t), md = changelogMd(d, t);
  const ta = h('textarea', { class: 'me-src', style: 'min-height:22vh', readonly: true, translate: 'no', value: ann });
  const body = h('div', {}, h('p', {}, d.length ? `和 ${r.file.name} 相比，${d.length} 个单位有变化。` : '两个版本没有差别。'), h('b', {}, '公告稿（发玩家群）'), ta,
    h('div', { style: 'margin-top:8px' }, h('button', { onclick: () => copyText(ann) }, '复制公告'), ' ', h('button', { onclick: () => saveFile(t + '-更新日志.md', enc(md), 'text/markdown') }, '保存 .md'), ' ', h('button', { onclick: () => saveFile(t + '-更新内容.html', enc(F.diffHtml(d, t)), 'text/html') }, '保存网页')));
  modal('版本对比', body, CLOSE, { wide: true });
}
