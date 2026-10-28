// Mod 编辑器工具集（二）：分享码、项目与快照、导入与拆分、发布包、缩略图、对比图、平衡助手、描述与多语言、动画与弹道预览
import { h, toast, modal, closeModal, select } from './ui.js';
import { pickFile, saveFile } from './files.js';
import { readZip } from './zip.js';
import { getVal, setVal, parseIni } from './ini.js';
import * as L from './modlogic.js';
import * as M from './modlogic2.js';
import { Mod, checkMod } from './modedit.js';

const fld = (label, el) => h('div', { style: 'margin:6px 0' }, h('label', {}, label), el);
const OK = [{ label: '取消', value: false }, { label: '确定', value: true, primary: true }];
const CLOSE = [{ label: '关闭', value: true }];
const need = (ctx) => { if (!ctx.cur) { toast('先在左边选一个单位'); return false; } return true; };
const copyText = (t) => { try { navigator.clipboard.writeText(t); toast('已复制'); } catch { toast('复制失败，请手动选中复制'); } };

export const TOOLS2 = [
  ['单位分享码', '把一个单位压成一串 RWU1- 码，发给别人导入', shareCode],
  ['项目、笔记与快照', '保存 .rwproj；写笔记和待办；做快照，随时对比或还原', project],
  ['导入 / 拆分', '从别的 Mod 挑单位带素材导进来；把几个单位拆成新包', importSplit],
  ['发布包', '预检 + 版本号 + 更新日志，打成 zip', publish],
  ['生成缩略图', '用单位图拼一张 Mod 封面', thumb],
  ['对比图', '体型、射程、速度并排比较', charts],
  ['平衡助手', '平衡建议、科技阶段、灵敏度、定位参考', helper],
  ['描述与多语言名称', '按数值生成描述；填各语言的名字', names],
  ['动画与旋转', '逐帧播放，旋转预览', anim],
  ['弹道预览', '弹道飞行距离、射程、爆炸范围', proj],
];

async function shareCode(ctx) {
  const box = h('div', {});
  let code = '';
  const ta = h('textarea', { class: 'me-src', style: 'min-height:90px', readonly: true });
  if (ctx.cur) { code = await M.unitToCode(ctx.mod, ctx.cur); ta.value = code; box.append(h('p', {}, '当前单位的分享码（只含 ini，不含图片和音效）：'), ta, h('button', { onclick: () => copyText(code) }, '复制')); }
  else box.append(h('p', { class: 'hint' }, '先选一个单位才能生成分享码；下面可以导入别人的码。'));
  const inp = h('textarea', { class: 'me-src', style: 'min-height:90px', placeholder: '粘贴 RWU1- 开头的分享码', translate: 'no' });
  box.append(h('h4', {}, '导入'), inp, h('button', { class: 'primary', onclick: async () => { try { const u = await M.importCode(ctx.mod, inp.value); ctx.cur = u; closeModal(); closeModal(); ctx.refresh(); toast('已导入 ' + ctx.mod.unitName(u)); } catch (e) { toast(e.message, 4000); } } }, '导入为新单位'));
  modal('单位分享码', box, CLOSE);
}

async function project(ctx) {
  const m = ctx.mod; m.notes = m.notes || ''; m.todos = m.todos || []; m.snaps = m.snaps || [];
  const box = h('div', {}), draw = () => {
    box.replaceChildren();
    box.append(h('h4', {}, '笔记'), h('textarea', { class: 'me-src', style: 'min-height:90px', value: m.notes, oninput: (e) => { m.notes = e.target.value; } }));
    box.append(h('h4', {}, '待办'));
    for (const t of m.todos) box.append(h('label', { style: 'display:block' }, h('input', { type: 'checkbox', checked: t.done ? true : null, onchange: (e) => { t.done = e.target.checked; } }), ' ' + t.t, ' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); m.todos.splice(m.todos.indexOf(t), 1); draw(); } }, '删除')));
    const ti = h('input', { placeholder: '新待办，回车添加', onkeydown: (e) => { if (e.key === 'Enter' && ti.value.trim()) { m.todos.push({ t: ti.value.trim(), done: false }); draw(); } } });
    box.append(ti, h('h4', {}, '快照'));
    for (const s of m.snaps) box.append(h('div', { style: 'margin:4px 0' }, h('b', {}, s.name), ' ', h('small', {}, new Date(s.time).toLocaleString()), ' ',
      h('button', { onclick: () => diffWith(ctx, s) }, '和现在比'), h('button', { onclick: () => restore(ctx, s) }, '还原'), h('button', { onclick: () => { m.snaps.splice(m.snaps.indexOf(s), 1); draw(); } }, '删除')));
    const ni = h('input', { placeholder: '快照名，如 平衡前' });
    box.append(ni, h('button', { onclick: () => { m.snaps.push(M.snapshot(m, ni.value.trim() || '快照 ' + (m.snaps.length + 1))); draw(); toast('已记录'); } }, '拍快照'));
    box.append(h('p', { class: 'hint' }, '快照只记录单位 ini 文本（不含图片）。笔记、待办和快照保存在 .rwproj 项目文件里，打包 .rwmod 时不会带进去。'));
    box.append(h('button', { class: 'primary', onclick: async () => { await saveFile((m.name || 'mod') + '.rwproj', M.projectFiles(m), 'application/octet-stream'); } }, '保存项目文件 .rwproj'));
  };
  draw(); modal('项目、笔记与快照', box, CLOSE, { wide: true });
}
function diffWith(ctx, s) {
  const d = L.diffMod(ctx.mod, M.snapshotMap(s)), md = L.changelogMd(d, '相对“' + s.name + '”');
  const ta = h('textarea', { class: 'me-src', style: 'min-height:40vh', readonly: true }); ta.value = md;
  modal('和快照对比', ta, [{ label: '复制', value: true, check: async () => { copyText(md); return false; } }, { label: '关闭', value: true, primary: true }], { wide: true });
}
function restore(ctx, s) {
  let n = 0;
  for (const u of ctx.mod.realUnits()) if (s.files[u.file] !== undefined) { ctx.snap(u); u.ini = parseIni(s.files[u.file]); u.srcDirty = false; n++; }
  ctx.refresh(); toast('已还原 ' + n + ' 个单位（快照里没有的新单位保持不变）');
}

async function importSplit(ctx) {
  const box = h('div', {}, h('p', { class: 'hint' }, '导入：选另一个 Mod，勾选要带过来的单位，素材一起复制，重名自动改名。拆分：勾选当前 Mod 里的单位，导出成新的 .rwmod。'));
  let src = null, pick = new Set();
  const listBox = h('div', { style: 'max-height:40vh;overflow:auto' }), actions = h('div', {});
  const show = (mod, label) => {
    listBox.replaceChildren(); pick = new Set();
    for (const u of mod.realUnits()) { const cb = h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? pick.add(u) : pick.delete(u); } }); listBox.append(h('label', { style: 'display:block' }, cb, ' ', h('span', { translate: 'no' }, mod.unitName(u)))); }
    listBox.prepend(h('b', {}, label));
  };
  box.append(h('button', { onclick: async () => {
    const r = await pickFile('.rwmod,.zip'); if (!r) return;
    try { src = await Mod.fromEntries(readZip(new Uint8Array(await r.file.arrayBuffer())), r.file.name); show(src, '来源：' + r.file.name); } catch (e) { toast(e.message, 4000); }
    actions.replaceChildren(h('button', { class: 'primary', onclick: () => { if (!pick.size) { toast('先勾选单位'); return; } const res = M.importUnits(ctx.mod, src, [...pick]); ctx.cur = res.added[0]; closeModal(); ctx.refresh(); modal('导入完成', h('div', {}, h('p', {}, '已导入 ' + res.added.length + ' 个单位。'), res.notes.map((n) => h('div', {}, '· ' + n))), CLOSE); } }, '导入勾选的单位'));
  } }, '选择要导入的 Mod…'), ' ', h('button', { onclick: () => { src = null; show(ctx.mod, '当前 Mod'); actions.replaceChildren(h('button', { class: 'primary', onclick: async () => { if (!pick.size) { toast('先勾选单位'); return; } const files = M.extractUnits(ctx.mod, [...pick]); const { writeZip } = await import('./zip.js'); await saveFile((ctx.mod.name || 'mod') + '-part.rwmod', writeZip(files), 'application/octet-stream'); } }, '导出勾选的单位为新 Mod')); } }, '拆分当前 Mod'), listBox, actions);
  modal('导入 / 拆分', box, CLOSE, { wide: true });
}

async function publish(ctx) {
  const R = checkMod(ctx.mod), sc = L.scoreMod(ctx.mod, R), d = L.diffMod(ctx.mod);
  const e = R.filter((r) => r.lv === 'error').length, w = R.filter((r) => r.lv === 'warn').length;
  let ver = '1.0', log = L.changelogMd(d, getVal(ctx.mod.info, 'mod', 'title') || ctx.mod.name);
  const ta = h('textarea', { class: 'me-src', style: 'min-height:25vh', value: log, oninput: (x) => { log = x.target.value; } });
  const box = h('div', {}, h('p', {}, `预检：评分 ${sc.score}，错误 ${e}，警告 ${w}，单位 ${ctx.mod.realUnits().length} 个，文件 ${ctx.mod.files.size} 个。`), e ? h('p', { style: 'color:#e55' }, '还有错误，建议先在“检查”里处理。') : null, fld('版本号', h('input', { value: ver, oninput: (x) => { ver = x.target.value.trim() || '1.0'; } })), fld('更新日志（可编辑）', ta));
  const r = await modal('发布包', box, [{ label: '取消', value: false }, { label: '生成 zip', value: true, primary: true }]);
  if (!r) return;
  const p = M.publishFiles(ctx.mod, { version: ver, changelog: log });
  await saveFile(p.title + '-v' + ver + '.zip', p.bytes, 'application/zip');
}

async function thumb(ctx) {
  const us = ctx.mod.realUnits().slice(0, 9), cv = h('canvas', { width: 256, height: 256, style: 'width:256px;height:256px;border-radius:8px' }), c = cv.getContext('2d');
  c.fillStyle = '#2b3440'; c.fillRect(0, 0, 256, 256); c.imageSmoothingEnabled = false;
  for (let i = 0; i < us.length; i++) {
    const ic = await ctx.mod.iconOf(us[i]); if (!ic) continue;
    const im = new Image(); im.src = ic.url; try { await im.decode(); } catch { continue; }
    const fw = ic.fw && ic.fw <= im.width ? ic.fw : Math.min(im.width, im.height), fh = ic.fh && ic.fh <= im.height ? ic.fh : Math.min(im.height, fw), k = Math.min(64 / fw, 64 / fh);
    const x = 16 + (i % 3) * 78 + (64 - fw * k) / 2, y = 36 + Math.floor(i / 3) * 70 + (64 - fh * k) / 2; c.drawImage(im, 0, 0, fw, fh, x, y, fw * k, fh * k);
  }
  c.fillStyle = '#fff'; c.font = 'bold 18px sans-serif'; c.fillText((getVal(ctx.mod.info, 'mod', 'title') || ctx.mod.name).slice(0, 18), 12, 24);
  const r = await modal('生成缩略图', h('div', {}, cv, h('p', { class: 'hint' }, '用前 9 个单位的第一帧拼成。确定后保存为 thumbnail.png 并写进 mod-info。')), OK);
  if (!r) return;
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png')), bytes = new Uint8Array(await blob.arrayBuffer());
  ctx.mod.files.set('thumbnail.png', { bytes }); ctx.mod.lower.set('thumbnail.png', 'thumbnail.png'); setVal(ctx.mod.info, 'mod', 'thumbnail', 'thumbnail.png'); toast('已添加 thumbnail.png');
}

async function charts(ctx) {
  const rows = L.compareRows(ctx.mod); let tab = 'range';
  const body = h('div', {}), draw = async () => {
    body.replaceChildren();
    if (tab === 'size') {
      const wrap = h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end' });
      for (const r of rows) { const ic = await ctx.mod.iconOf(r.u); const cv = h('canvas', { width: 80, height: 80 }); const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
        if (ic) { const im = new Image(); im.src = ic.url; try { await im.decode(); const fw = ic.fw && ic.fw <= im.width ? ic.fw : Math.min(im.width, im.height), fh = ic.fh && ic.fh <= im.height ? ic.fh : Math.min(im.height, fw); c.drawImage(im, 0, 0, fw, fh, 40 - fw / 2, 40 - fh / 2, fw, fh); } catch {} }
        wrap.append(h('div', { style: 'text-align:center' }, cv, h('div', { translate: 'no', style: 'font-size:12px' }, r.name))); }
      body.append(wrap, h('p', { class: 'hint' }, '所有单位按原始像素 1:1 并排，直观比较体型。'));
    } else {
      const key = tab, max = Math.max(1, ...rows.map((r) => r[key] || 0));
      for (const r of rows.slice().sort((a, b) => (b[key] || 0) - (a[key] || 0))) body.append(h('div', { style: 'display:flex;align-items:center;gap:8px;margin:3px 0;font-size:13px' }, h('span', { style: 'width:9em;overflow:hidden;text-overflow:ellipsis', translate: 'no' }, r.name), h('div', { style: `height:12px;border-radius:3px;background:#4a8cff;width:${(r[key] || 0) / max * 60}%` }), h('span', {}, Math.round((r[key] || 0) * 100) / 100)));
    }
  };
  const sel = select([['range', '射程'], ['speed', '速度'], ['size', '体型']], tab, (v) => { tab = v; draw(); });
  draw(); modal('对比图', h('div', {}, sel, body), CLOSE, { wide: true });
}

async function helper(ctx) {
  const box = h('div', {});
  const sug = M.balanceSuggest(ctx.mod);
  box.append(h('h4', {}, '平衡建议（调造价，让性价比靠近中位数）'));
  if (!sug.length) box.append(h('p', { class: 'hint' }, '没有明显偏离的单位（至少要 3 个有 DPS 和造价的单位才会判断）。'));
  for (const s of sug) box.append(h('div', {}, h('span', { translate: 'no' }, s.name), ` ${s.tag}：造价 ${s.price} → ${s.newPrice}`));
  if (sug.length) box.append(h('button', { onclick: () => { for (const u of ctx.mod.realUnits()) ctx.snap(u); M.applyBalance(sug); ctx.refresh(); closeModal(); toast('已调整 ' + sug.length + ' 个单位的造价，可撤销'); } }, '全部应用（可撤销）'));
  box.append(h('h4', {}, '科技阶段'));
  const t = h('table', { style: 'font-size:13px;border-collapse:collapse' }, h('tr', {}, ...['科技', '数量', '平均造价', '平均战力', '平均建造秒', '烧钱 /秒'].map((x) => h('th', { style: 'padding:3px 8px;text-align:left' }, x))));
  for (const r of M.techRows(ctx.mod)) t.append(h('tr', {}, ...[r.tech, r.n, r.price, r.power, r.build, r.burn].map((v) => h('td', { style: 'padding:3px 8px' }, Number.isFinite(v) ? Math.round(v * 10) / 10 : '—'))));
  box.append(t, h('p', { class: 'hint' }, '看每个科技等级的平均战力是否逐级增长，有没有断层。烧钱 = 平均造价 ÷ 建造秒，表示连续生产的花费速度。'));
  if (ctx.cur) {
    box.append(h('h4', {}, '灵敏度：' + ctx.mod.unitName(ctx.cur) + '（各项 ±10% 对战力和性价比的影响）'));
    const tb = h('table', { style: 'font-size:13px;border-collapse:collapse' }, h('tr', {}, ...['项目', '变化', '战力', '性价比'].map((x) => h('th', { style: 'padding:3px 8px;text-align:left' }, x))));
    for (const s of M.sensitivity(L.eff(ctx.mod, ctx.cur))) tb.append(h('tr', {}, h('td', { style: 'padding:3px 8px' }, L.SCALE_GROUPS[s.g][0]), h('td', { style: 'padding:3px 8px' }, (s.f > 1 ? '+' : '-') + '10%'), h('td', { style: 'padding:3px 8px' }, (s.power >= 0 ? '+' : '') + s.power.toFixed(1) + '%'), h('td', { style: 'padding:3px 8px' }, Number.isFinite(s.eff) ? (s.eff >= 0 ? '+' : '') + s.eff.toFixed(1) + '%' : '—')));
    box.append(tb);
    const out = h('div', {}), rs = select(Object.entries(M.ROLES).map(([k, v]) => [k, v[0]]), 'scout', (v) => show(v)), show = (role) => { out.replaceChildren(...M.roleAdvice(ctx.mod, ctx.cur, role).map((a) => h('div', {}, (a.ok ? '符合：' : '不符：') + a.t))); };
    show('scout'); box.append(h('h4', {}, '定位参考'), rs, out, h('p', { class: 'hint' }, '“中位数”指本 Mod 里所有单位的中位数，只是和自己的单位比，不代表游戏标准。'));
  }
  modal('平衡助手', box, CLOSE, { wide: true });
}

async function names(ctx) {
  if (!need(ctx)) return;
  const u = ctx.cur, LANGS = ['en', 'zh', 'ru', 'de', 'fr', 'es', 'pt', 'ja', 'ko', 'tr'];
  const box = h('div', {}, h('p', { class: 'hint' }, '游戏按玩家的语言挑 displayText_语言 / displayDescription_语言；没有就用默认的。'));
  const inputs = [];
  const add = (label, key, area) => { const el = area ? h('textarea', { rows: 2, value: getVal(u.ini, 'core', key) || '' }) : h('input', { value: getVal(u.ini, 'core', key) || '' }); inputs.push([key, el]); box.append(fld(label, el)); };
  add('默认名称', 'displayText'); add('默认描述', 'displayDescription', true);
  box.append(h('button', { onclick: () => { const d = M.autoDescription(u.ini); inputs.find(([k]) => k === 'displayDescription')[1].value = d; } }, '按数值生成描述'));
  for (const l of LANGS) add('名称 · ' + l, 'displayText_' + l);
  const r = await modal('描述与多语言名称 — ' + ctx.mod.unitName(u), box, OK);
  if (!r) return;
  ctx.snap(u); for (const [k, el] of inputs) setVal(u.ini, 'core', k, el.value.trim()); ctx.refresh(); toast('已更新');
}

async function anim(ctx) {
  if (!need(ctx)) return;
  const u = ctx.cur, ic = await ctx.mod.iconOf(u); if (!ic) { toast('这个单位没有可显示的图片'); return; }
  const im = new Image(); im.src = ic.url; try { await im.decode(); } catch { toast('图片读不出来'); return; }
  const fw = ic.fw && ic.fw <= im.width ? ic.fw : Math.min(im.width, im.height), fh = ic.fh && ic.fh <= im.height ? ic.fh : Math.min(im.height, fw);
  const per = Math.max(1, Math.floor(im.width / fw)), cap = per * Math.max(1, Math.floor(im.height / fh)), tf = Math.min(cap, +getVal(u.ini, 'graphics', 'total_frames') || 1);
  let f = 0, rot = 0, play = true, zoom = 4;
  const cv = h('canvas', { width: 300, height: 300, style: 'width:100%;max-width:300px;background:#8882;border-radius:8px' }), info = h('div', { class: 'hint' });
  const draw = () => { const c = cv.getContext('2d'); c.clearRect(0, 0, 300, 300); c.imageSmoothingEnabled = false; c.save(); c.translate(150, 150); c.rotate(rot * Math.PI / 180); c.drawImage(im, (f % per) * fw, Math.floor(f / per) * fh, fw, fh, -fw * zoom / 2, -fh * zoom / 2, fw * zoom, fh * zoom); c.restore(); info.textContent = `第 ${f + 1} / ${tf} 帧 · 帧大小 ${fw}×${fh} · 旋转 ${rot}°`; };
  const timer = setInterval(() => { if (play && tf > 1) { f = (f + 1) % tf; draw(); } }, 120);
  draw();
  const body = h('div', {}, cv, info, fld('旋转', h('input', { type: 'range', min: '0', max: '359', value: '0', oninput: (e) => { rot = +e.target.value; draw(); } })), fld('缩放', h('input', { type: 'range', min: '1', max: '8', value: '4', oninput: (e) => { zoom = +e.target.value; draw(); } })), h('label', {}, h('input', { type: 'checkbox', checked: true, onchange: (e) => { play = e.target.checked; } }), ' 播放'));
  await modal('动画与旋转 — ' + ctx.mod.unitName(u), body, CLOSE); clearInterval(timer);
}

async function proj(ctx) {
  if (!need(ctx)) return;
  const u = ctx.cur, E = L.eff(ctx.mod, u), st = L.unitStats(E), box = h('div', {});
  if (!st.weapons.length) box.append(h('p', { class: 'hint' }, '这个单位没有炮塔。'));
  for (const w of st.weapons) {
    const p = M.projectileInfo(E, w.projectile), range = st.range || w.range || 0, scale = 300 / Math.max(range, p.travel, p.radius * 2, 50);
    const cv = h('canvas', { width: 320, height: 90, style: 'width:100%;max-width:320px' }), c = cv.getContext('2d');
    c.fillStyle = '#8883'; c.fillRect(0, 0, 320, 90); c.fillStyle = '#4a8cff'; c.fillRect(10, 40, 6, 10);
    c.strokeStyle = '#e55'; c.beginPath(); c.moveTo(13 + range * scale, 15); c.lineTo(13 + range * scale, 75); c.stroke();
    c.strokeStyle = '#4c4'; c.beginPath(); c.moveTo(13, 45); c.lineTo(13 + p.travel * scale, 45); c.stroke();
    if (p.radius) { c.strokeStyle = '#fa0'; c.beginPath(); c.arc(13 + Math.min(p.travel, range || p.travel) * scale, 45, p.radius * scale, 0, 7); c.stroke(); }
    const warn = p.travel && range && p.travel < range ? '飞行距离短于射程：打不到最远处（弹速 × 寿命 = ' + Math.round(p.travel) + '）' : '';
    box.append(h('h4', { translate: 'no' }, `[turret_${w.turret}] → projectile_${w.projectile}`), cv, h('div', { class: 'hint' }, `红线=射程 ${Math.round(range)}；绿线=飞行距离 ${Math.round(p.travel)}（寿命 ${p.life} × 速度 ${p.speed}）；橙圈=爆炸半径 ${p.radius}。伤害 ${p.dd}${p.ad ? ' + 范围 ' + p.ad : ''}，间隔 ${w.frames} 帧${p.ballistic ? '，抛物线' : ''}${p.instant ? '，瞬发' : ''}。`), warn ? h('div', { style: 'color:#d90' }, warn) : null);
  }
  modal('弹道预览 — ' + ctx.mod.unitName(u), box, CLOSE);
}
