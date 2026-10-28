// Mod 编辑器的工具集界面（逻辑在 modlogic.js）
import { h, toast, modal, closeModal, confirmBox, select } from './ui.js';
import { saveFile } from './files.js';
import { getVal, setVal } from './ini.js';
import * as L from './modlogic.js';
import { checkMod } from './modedit.js';
import { TOOLS2 } from './modtools2.js';

const need = (ctx) => { if (!ctx.cur) { toast('先在左边选一个单位'); return false; } return true; };
const fld = (label, el) => h('div', { style: 'margin:6px 0' }, h('label', {}, label), el);
const done = (ctx, msg) => { ctx.refresh(); if (msg) toast(msg); };
const OK = [{ label: '取消', value: false }, { label: '确定', value: true, primary: true }];

export function toolsDialog(ctx) {
  const T = [
    ['新建单位（向导）', '坦克、步兵、飞机、舰船、工厂、建造者、炮塔模板', wizard],
    ['复制当前单位', '生成一份副本，自动改代号', copy],
    ['生成变体', '轻型、重型、快速、精英、廉价', variants],
    ['数值缩放', '生命、伤害、造价、速度、射程按倍数改（×2 之类）', scale],
    ['添加武器模板', '机枪、加农炮、火箭、榴弹炮、激光', weapon],
    ['炮塔位置', '在单位图上拖动炮口，查看射程圈', turret],
    ['对比表', '所有单位的造价、生命、DPS、速度并排排序', compare],
    ['性价比散点图', '造价 × 战力，找出偏强或偏弱的单位', scatter],
    ['战斗模拟', '两个单位对战（粗略估算）', battle],
    ['建造树', '谁能造谁，找出造不出来的单位', tree],
    ['引用与改名', '谁引用了当前单位；改名时同步更新引用', refs],
    ['改动与更新日志', '和打开时对比，导出 Markdown', diff],
    ['查找替换', '在所有单位的数值里查找并替换', findRep],
    ['评分与一键修复', '给 Mod 打分，并自动修复常见问题', score],
    ['素材检查', '未使用的图片音效、帧数是否对得上', assets],
  ].concat(TOOLS2);
  const box = h('div', { class: 'me-tools' });
  for (const [t, d, fn] of T) box.append(h('button', { style: 'display:block;width:100%;text-align:left;margin:4px 0', onclick: () => fn(ctx) }, h('b', {}, t), h('div', { class: 'hint' }, d)));
  modal('工具', box, [{ label: '关闭', value: true }]);
}

async function wizard(ctx) {
  let kind = 'tank', name = L.uniqueName(ctx.mod, 'new_unit');
  const inp = h('input', { value: name, oninput: (e) => { name = e.target.value.trim().replace(/\s+/g, '_'); } });
  const r = await modal('新建单位', h('div', {}, fld('类型', select(Object.entries(L.TEMPLATES).map(([k, v]) => [k, v[0]]), kind, (v) => { kind = v; })), fld('单位代号', inp)), OK);
  if (!r || !name) return;
  ctx.cur = L.fromTemplate(ctx.mod, kind, L.uniqueName(ctx.mod, name)); closeModal(); done(ctx, '已新建，贴图请自己在 [graphics] 里填');
}
async function copy(ctx) {
  if (!need(ctx)) return;
  let name = L.uniqueName(ctx.mod, ctx.mod.unitName(ctx.cur) + '_copy');
  const r = await modal('复制单位', fld('新代号', h('input', { value: name, oninput: (e) => { name = e.target.value.trim().replace(/\s+/g, '_'); } })), OK);
  if (!r || !name) return;
  ctx.cur = L.copyUnit(ctx.mod, ctx.cur, L.uniqueName(ctx.mod, name), ' (副本)'); closeModal(); done(ctx, '已复制');
}
async function variants(ctx) {
  if (!need(ctx)) return;
  const pick = new Set(['light', 'heavy']);
  const box = h('div', {}, h('p', { class: 'hint' }, '每个变体是当前单位的副本，数值按预设倍数缩放。生成后可以再手改。'));
  for (const [k, [lab, m]] of Object.entries(L.VARIANTS)) {
    const cb = h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? pick.add(k) : pick.delete(k); } }); cb.checked = pick.has(k);
    box.append(h('label', { style: 'display:block;margin:4px 0' }, cb, ' ' + lab + '  ', h('small', {}, Object.entries(m).map(([g, v]) => L.SCALE_GROUPS[g][0] + '×' + v).join('  '))));
  }
  const r = await modal('生成变体', box, OK);
  if (!r || !pick.size) return;
  const v = L.makeVariants(ctx.mod, ctx.cur, [...pick]); ctx.cur = v[0]; closeModal(); done(ctx, '已生成 ' + v.length + ' 个变体');
}
async function scale(ctx) {
  const mult = {}; let target = 'cur';
  const box = h('div', {}, fld('作用于', select([['cur', '当前单位'], ['all', '列表里的全部单位（受搜索过滤）']], target, (v) => { target = v; })));
  for (const [g, [lab]] of Object.entries(L.SCALE_GROUPS)) { mult[g] = 1; box.append(fld(lab + ' ×', h('input', { type: 'number', step: '0.1', min: '0', value: '1', oninput: (e) => { mult[g] = +e.target.value || 1; } }))); }
  box.append(h('p', { class: 'hint' }, '例：生命 ×2、伤害 ×1.5。只改数字，保留单位后缀。可用“撤销”回退。'));
  const r = await modal('数值缩放', box, OK);
  if (!r) return;
  const us = target === 'cur' ? (ctx.cur ? [ctx.cur] : []) : ctx.visible();
  let n = 0; for (const u of us) { ctx.snap(u); n += L.scaleUnit(u.ini, mult); }
  closeModal(); done(ctx, `改了 ${n} 个数值（${us.length} 个单位）`);
}
async function weapon(ctx) {
  if (!need(ctx)) return;
  let k = 'cannon', nm = 'w2';
  const r = await modal('添加武器', h('div', {}, fld('模板', select(Object.entries(L.WEAPONS).map(([a, v]) => [a, v[0]]), k, (v) => { k = v; })), fld('名字（炮塔和弹道共用）', h('input', { value: nm, oninput: (e) => { nm = e.target.value.trim() || 'w2'; } }))), OK);
  if (!r) return;
  ctx.snap(ctx.cur); L.addWeapon(ctx.cur.ini, k, nm); closeModal(); done(ctx, '已添加炮塔和弹道');
}

async function turret(ctx) {
  if (!need(ctx)) return;
  const u = ctx.cur, ic = await ctx.mod.iconOf(u);
  let zoom = 3, flip = false, circle = false, drag = null;
  const cv = h('canvas', { width: 340, height: 340, style: 'width:100%;max-width:340px;background:#8882;border-radius:8px;touch-action:none' });
  let img = null;
  if (ic) { img = new Image(); img.src = ic.url; try { await img.decode(); } catch { img = null; } }
  const tur = () => u.ini.sections.filter((s) => s.name.startsWith('turret_'));
  const pos = (s) => [+(s.lines.find((l) => l.key === 'barrelX') || {}).val || 0, +(s.lines.find((l) => l.key === 'barrelY') || {}).val || 0];
  const toScr = (bx, by) => flip ? [170 + by * zoom, 170 - bx * zoom] : [170 + bx * zoom, 170 - by * zoom];
  const fromScr = (x, y) => flip ? [(170 - y) / zoom, (x - 170) / zoom] : [(x - 170) / zoom, (170 - y) / zoom];
  const draw = () => {
    const c = cv.getContext('2d'); c.clearRect(0, 0, 340, 340); c.imageSmoothingEnabled = false;
    c.strokeStyle = '#8886'; c.beginPath(); c.moveTo(170, 0); c.lineTo(170, 340); c.moveTo(0, 170); c.lineTo(340, 170); c.stroke();
    if (img) { const fw = ic.fw && ic.fw <= img.width ? ic.fw : Math.min(img.width, img.height), fh = ic.fh && ic.fh <= img.height ? ic.fh : Math.min(img.height, fw); c.drawImage(img, 0, 0, fw, fh, 170 - fw * zoom / 2, 170 - fh * zoom / 2, fw * zoom, fh * zoom); }
    if (circle) { const rg = L.unitStats(L.eff(ctx.mod, u)).range; if (rg > 0) { c.strokeStyle = '#e55'; c.beginPath(); c.arc(170, 170, rg * zoom, 0, 7); c.stroke(); } }
    tur().forEach((s, i) => { const [x, y] = toScr(...pos(s)); c.fillStyle = ['#4a8cff', '#e8a', '#4c4', '#fa0'][i % 4]; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); c.fillStyle = '#000'; c.fillText(s.name.slice(7), x + 8, y - 6); });
  };
  const xy = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * 340 / r.width, (e.clientY - r.top) * 340 / r.height]; };
  cv.onpointerdown = (e) => { const [x, y] = xy(e); let best = null, bd = 18; for (const s of tur()) { const [sx, sy] = toScr(...pos(s)); const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = s; } } if (best) { drag = best; ctx.snap(u); cv.setPointerCapture(e.pointerId); } };
  cv.onpointermove = (e) => { if (!drag) return; const [bx, by] = fromScr(...xy(e)); setVal(u.ini, drag.name, 'barrelX', String(Math.round(bx * 2) / 2)); setVal(u.ini, drag.name, 'barrelY', String(Math.round(by * 2) / 2)); draw(); info.textContent = drag.name + '：barrelX ' + Math.round(bx * 2) / 2 + '，barrelY ' + Math.round(by * 2) / 2; };
  cv.onpointerup = () => { drag = null; };
  const info = h('div', { class: 'hint' }, tur().length ? '拖动彩色圆点改炮口位置。' : '这个单位没有炮塔，先“添加武器模板”。');
  const zs = h('input', { type: 'range', min: '1', max: '8', value: '3', oninput: (e) => { zoom = +e.target.value; draw(); } });
  const f = h('input', { type: 'checkbox', onchange: (e) => { flip = e.target.checked; draw(); } });
  const cc = h('input', { type: 'checkbox', onchange: (e) => { circle = e.target.checked; draw(); } });
  draw();
  await modal('炮塔位置 — ' + ctx.mod.unitName(u), h('div', {}, cv, info, fld('缩放', zs), h('label', {}, cc, ' 显示射程圈（与图同比例）'), h('br'), h('label', {}, f, ' 单位图朝右（默认按朝上，Y 为正=向前）；我没在游戏里验证朝向，请以实际为准')), [{ label: '完成', value: true, primary: true }]);
  ctx.refresh();
}

const f1 = (v) => Number.isFinite(v) ? (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100) : '—';
function compare(ctx) {
  const rows = L.compareRows(ctx.mod), out = L.outliers(rows);
  let key = 'power', dir = -1, formula = 'sqrt((hp+shield)*max(dps,1))';
  const recalc = () => { try { const fn = new Function('hp', 'shield', 'dps', 'price', 'speed', 'range', 'sqrt', 'max', 'min', 'pow', 'return (' + formula + ')'); for (const r of rows) { const v = fn(r.hp, r.shield, r.dps, r.price, r.speed, r.range, Math.sqrt, Math.max, Math.min, Math.pow); r.power = Number.isFinite(v) ? v : NaN; r.eff = r.price > 0 ? r.power / r.price : NaN; } return true; } catch { return false; } };
  const cols = [['name', '单位'], ['price', '造价'], ['hp', '生命'], ['speed', '速度'], ['range', '射程'], ['dps', 'DPS*'], ['hpPerCost', '生命/造价'], ['dpsPerCost', 'DPS/造价'], ['power', '战力*'], ['eff', '性价比']];
  const body = h('div', { style: 'overflow:auto;max-height:60vh' });
  const draw = () => {
    rows.sort((a, b) => key === 'name' ? dir * String(a.name).localeCompare(b.name) : dir * ((a[key] || 0) - (b[key] || 0)));
    const t = h('table', { style: 'border-collapse:collapse;font-size:13px;width:100%' }, h('tr', {}, ...cols.map(([k, l]) => h('th', { style: 'cursor:pointer;text-align:left;padding:4px;position:sticky;top:0;background:var(--bg,#fff)', onclick: () => { dir = key === k ? -dir : -1; key = k; draw(); } }, l + (key === k ? (dir < 0 ? ' ↓' : ' ↑') : '')))));
    for (const r of rows) t.append(h('tr', { style: 'cursor:pointer;border-top:1px solid #8883', onclick: () => { ctx.cur = r.u; closeModal(); ctx.refresh(); } }, ...cols.map(([k]) => h('td', { style: 'padding:4px' }, k === 'name' ? h('span', { translate: 'no' }, r.name || r.u.file) : k === 'eff' ? f1(r.eff * 100) + (out.get(r.u) ? ' ' + out.get(r.u) : '') : f1(r[k])))));
    body.replaceChildren(t);
  };
  draw();
  const fi = h('input', { value: formula, translate: 'no', style: 'width:100%', onchange: (e) => { if (!/^[\w\s+\-*/().,<>=?:%]*$/.test(e.target.value)) { toast('公式里只能用数字、变量和 + - * / ( ) , sqrt max min pow'); return; } const old = formula; formula = e.target.value; if (!recalc()) { formula = old; toast('公式写错了'); } draw(); } });
  modal('对比表', h('div', {}, h('label', {}, '战力公式（可改；变量 hp shield dps price speed range）'), fi, body, h('p', { class: 'hint' }, '* DPS 按“伤害 × 60 ÷ 炮塔间隔(默认 60)”估算；战力 = √(生命 × DPS)；性价比 = 战力 ÷ 造价 ×100。点表头排序，点行跳到该单位。')), [{ label: '关闭', value: true }], { wide: true });
}
function scatter(ctx) {
  const rows = L.compareRows(ctx.mod).filter((r) => r.price > 0), out = L.outliers(rows);
  if (rows.length < 2) { toast('至少要有 2 个有造价的单位'); return; }
  const W = 520, H = 340, mx = Math.max(...rows.map((r) => r.price)) * 1.1, my = Math.max(...rows.map((r) => r.power)) * 1.1;
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.style.cssText = 'width:100%;background:#8881;border-radius:8px';
  const el = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt) e.textContent = txt; svg.append(e); return e; };
  el('line', { x1: 40, y1: H - 30, x2: W - 10, y2: H - 30, stroke: '#888' }); el('line', { x1: 40, y1: 10, x2: 40, y2: H - 30, stroke: '#888' });
  el('text', { x: W - 60, y: H - 10, fill: '#888', 'font-size': 11 }, '造价 →'); el('text', { x: 4, y: 20, fill: '#888', 'font-size': 11 }, '战力 ↑');
  const e = rows.filter((r) => r.dps > 0 && r.eff).map((r) => r.eff).sort((a, b) => a - b), med = e[Math.floor(e.length / 2)] || 0;
  if (med) el('line', { x1: 40, y1: H - 30, x2: W - 10, y2: H - 30 - (mx * med / my) * (H - 40) * (W - 50) / (W - 50), stroke: '#8888', 'stroke-dasharray': '4' });
  for (const r of rows) {
    const x = 40 + r.price / mx * (W - 50), y = H - 30 - r.power / my * (H - 40), o = out.get(r.u);
    const c = el('circle', { cx: x, cy: y, r: 6, fill: o === '偏强' ? '#e55' : o === '偏弱' ? '#48f' : '#4a4', style: 'cursor:pointer' }); c.addEventListener('click', () => { ctx.cur = r.u; closeModal(); ctx.refresh(); });
    el('text', { x: x + 8, y: y + 4, 'font-size': 11, fill: '#888' }, r.name);
  }
  modal('性价比散点图', h('div', {}, svg, h('p', { class: 'hint' }, '虚线是中位数性价比。红点偏强、蓝点偏弱（偏离中位数 1.6 倍以上）。点圆点跳到该单位。')), [{ label: '关闭', value: true }], { wide: true });
}
async function battle(ctx) {
  const us = ctx.mod.realUnits(); if (us.length < 1) return;
  const opts = us.map((u, i) => [i, ctx.mod.unitName(u)]);
  let a = Math.max(0, us.indexOf(ctx.cur)), b = Math.min(us.length - 1, a + 1), na = 1, nb = 1, dist = 400, eq = false;
  const res = h('div', { style: 'margin-top:8px;white-space:pre-wrap' });
  const run = () => {
    const A = L.unitStats(L.eff(ctx.mod, us[a])), B = L.unitStats(L.eff(ctx.mod, us[b]));
    let x = na, y = nb; if (eq && A.price > 0 && B.price > 0) { y = Math.max(1, Math.round(A.price * na / B.price)); }
    const r = L.simulate(A, x, B, y, { dist });
    const nm = (u) => ctx.mod.unitName(u);
    res.textContent = `${nm(us[a])} ×${x}  对  ${nm(us[b])} ×${y}\n` + (r.winner === 'draw' ? '结果：平局或打不动（时间到）' : '胜者：' + (r.winner === 'A' ? nm(us[a]) : nm(us[b])) + `，用时约 ${r.time} 秒，剩余 ${r.winner === 'A' ? r.leftA : r.leftB} 个（总生命 ${r.winner === 'A' ? r.hpA : r.hpB}）`);
  };
  const num2 = (v, f) => h('input', { type: 'number', min: '1', value: String(v), oninput: (e) => { f(Math.max(1, +e.target.value || 1)); } });
  const box = h('div', {}, fld('单位 A', select(opts, a, (v) => { a = +v; })), fld('A 数量', num2(na, (v) => { na = v; })), fld('单位 B', select(opts, b, (v) => { b = +v; })), fld('B 数量', num2(nb, (v) => { nb = v; })), fld('起始距离', num2(dist, (v) => { dist = v; })),
    h('label', {}, h('input', { type: 'checkbox', onchange: (e) => { eq = e.target.checked; } }), ' 按造价配平 B 的数量（A 的总造价 ÷ B 的单价）'), h('div', {}, h('button', { class: 'primary', onclick: run }, '开始模拟')), res,
    h('p', { class: 'hint' }, '这是粗略估算：直线冲向最近的敌人，护甲按“每发伤害减去护甲（至少保留 10%）”算，不考虑射界、弹速、地形和溢出伤害。用来比较，不要当结论。'));
  modal('战斗模拟', box, [{ label: '关闭', value: true }]);
}
function tree(ctx) {
  const g = L.buildGraph(ctx.mod), roots = g.units.filter((u) => !g.builtBy.has(u));
  const root = h('div', { style: 'font-size:13px' });
  const add = (parent, u, depth, seen) => {
    const kids = g.edges.get(u) || [];
    const row = h('div', { style: `margin-left:${depth * 16}px;padding:2px 0` }, h('b', { translate: 'no' }, ctx.mod.unitName(u)), ' ', h('small', {}, '$' + (getVal(u.ini, 'core', 'price') || '?')));
    parent.append(row);
    if (seen.has(u)) { row.append(h('small', { style: 'color:#d90' }, '  ↻ 循环')); return; }
    const s2 = new Set(seen).add(u);
    for (const k of kids) { if (k.unit) add(parent, k.unit, depth + 1, s2); else parent.append(h('div', { style: `margin-left:${(depth + 1) * 16}px;color:#e55` }, '✗ ' + k.name + '（不在本 Mod，原版单位可忽略）')); }
  };
  const builders = g.units.filter((u) => (g.edges.get(u) || []).length);
  const orphans = g.units.filter((u) => !g.builtBy.has(u) && !(g.edges.get(u) || []).length);
  for (const r of roots.filter((u) => (g.edges.get(u) || []).length)) add(root, r, 0, new Set());
  const cyc = g.units.filter((u) => g.builtBy.has(u) && !roots.length);
  if (!builders.length) root.append(h('p', { class: 'hint' }, '没有任何 canBuild 段，建造关系为空。'));
  if (orphans.length) root.append(h('h4', {}, '没人能造、也不造别的（孤立）'), h('div', {}, orphans.map((u) => ctx.mod.unitName(u)).join('、')));
  if (cyc.length && !roots.length) root.append(h('p', { style: 'color:#d90' }, '所有单位都在被别人建造，没有起点（可能是循环）。'));
  modal('建造树', h('div', {}, root, h('p', { class: 'hint' }, '“孤立”不一定有问题：开局单位、触发器生成的单位本来就没人造。')), [{ label: '关闭', value: true }], { wide: true });
}
async function refs(ctx) {
  if (!need(ctx)) return;
  const u = ctx.cur, old = ctx.mod.unitName(u);
  let nn = old;
  const rs = L.refsOf(ctx.mod, old);
  const box = h('div', {}, h('p', {}, rs.length ? `被 ${rs.length} 处引用：` : '没有别的单位引用它。'), h('div', { class: 'hint' }, rs.map((r) => ctx.mod.unitName(r.u) + ' [' + r.sec + '] ' + r.key).join('；')), fld('改成新代号（引用会同步）', h('input', { value: old, oninput: (e) => { nn = e.target.value.trim().replace(/\s+/g, '_'); } })));
  const r = await modal('引用与改名', box, OK);
  if (!r || !nn || nn === old) return;
  if (ctx.mod.realUnits().some((x) => x !== u && ctx.mod.unitName(x).toLowerCase() === nn.toLowerCase())) { toast('已有同名单位'); return; }
  for (const x of ctx.mod.realUnits()) ctx.snap(x);
  L.renameUnit(ctx.mod, u, nn); closeModal(); done(ctx, '已改名，更新了 ' + rs.length + ' 处引用');
}
function diff(ctx) {
  const d = L.diffMod(ctx.mod), md = L.changelogMd(d, getVal(ctx.mod.info, 'mod', 'title') || ctx.mod.name);
  const ta = h('textarea', { class: 'me-src', style: 'min-height:40vh', readonly: true, translate: 'no' }); ta.value = md;
  modal('改动与更新日志', h('div', {}, h('p', {}, d.length ? `与打开时相比，有 ${d.length} 个单位变化：` : '和打开时相比没有变化。'), ta),
    [{ label: '复制', value: () => { navigator.clipboard && navigator.clipboard.writeText(md); toast('已复制'); return undefined; }, check: async () => { navigator.clipboard && navigator.clipboard.writeText(md); toast('已复制'); return false; } }, { label: '保存 .md', check: async () => { await saveFile('changelog.md', md, 'text/markdown'); return false; } }, { label: '关闭', value: true, primary: true }], { wide: true });
}
async function findRep(ctx) {
  let key = '', f = '', rep = '';
  const box = h('div', {}, fld('只改这个键（留空=所有键）', h('input', { placeholder: '如 image 或 price', oninput: (e) => { key = e.target.value.trim(); } })), fld('查找', h('input', { oninput: (e) => { f = e.target.value; } })), fld('替换为', h('input', { oninput: (e) => { rep = e.target.value; } })), h('p', { class: 'hint' }, '作用于列表里的全部单位（受搜索过滤）。只替换值的部分，不动键名。可撤销。'));
  const r = await modal('查找替换', box, OK);
  if (!r || !f) return;
  let n = 0;
  for (const u of ctx.visible()) { let touched = false; for (const s of u.ini.sections) for (const l of s.lines) if (l.key && (!key || l.key === key) && l.val.includes(f)) { if (!touched) { ctx.snap(u); touched = true; } l.val = l.val.split(f).join(rep); l.dirty = true; n++; } }
  closeModal(); done(ctx, `替换了 ${n} 处`);
}
async function score(ctx) {
  const R = checkMod(ctx.mod), sc = L.scoreMod(ctx.mod, R);
  const box = h('div', {}, h('div', { style: 'font-size:42px;font-weight:700' }, sc.score + ' 分'), h('div', {}, sc.items.map((t) => h('div', {}, '· ' + t))), h('p', { class: 'hint' }, '一键修复只做安全的事：补 mod-info/标题/代号、名字里的空格、重名、唯一弹道的引用、弹道大小写。其余请看“检查”。'));
  const r = await modal('评分与一键修复', box, [{ label: '关闭', value: false }, { label: '一键修复', value: true, primary: true }]);
  if (!r) return;
  for (const u of ctx.mod.realUnits()) ctx.snap(u);
  const log = L.autoFix(ctx.mod);
  done(ctx); modal('修复结果', h('div', {}, log.length ? log.map((t) => h('div', {}, '· ' + t)) : '没有可自动修复的问题。'), [{ label: '好', value: true, primary: true }]);
}
async function assets(ctx) {
  const A = L.assetIssues(ctx.mod);
  const box = h('div', {}, h('h4', {}, `未使用的图片 / 音效（${A.unused.length}）`), h('div', { class: 'hint', translate: 'no' }, A.unused.join('、') || '无'), h('h4', {}, `帧数问题（${A.issues.length}）`), h('div', {}, A.issues.map((x) => h('div', {}, '· ' + x.msg + ' — ' + x.file))));
  const btns = [{ label: '关闭', value: false }];
  if (A.unused.length) btns.push({ label: '从包里删掉未使用文件', value: true, danger: true });
  const r = await modal('素材检查', box, btns);
  if (!r) return;
  if (!(await confirmBox('删除未使用素材', `从打包内容里去掉 ${A.unused.length} 个文件？（不会改你的原文件）`, '删除', '取消', true))) return;
  for (const k of A.unused) { ctx.mod.files.delete(k); ctx.mod.lower.delete(k.toLowerCase()); }
  done(ctx, '已去掉 ' + A.unused.length + ' 个文件');
}
