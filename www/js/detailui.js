// 自动丰富细节的界面：修改器堆叠对话框、多版本对比、细节笔刷 / 高度 / 群系 / 道路工具、战术模块
import { A } from './state.js';
import { NONE } from './terrain.js';
import { RWMap } from './tmx.js';
import { Editor } from './editor.js';
import { MODS, STYLE_PRESETS, BIOMES, makeWork, runStack, applyWork, shrinkWork, drawWork, detectSymmetry, userPresets, saveUserPreset, deleteUserPreset, encodePreset, decodePreset, learnFrom } from './detail.js';
import { builtinStamps } from './stamps.js';
import { pasteWithSymmetry } from './transform.js';
import { pickFile } from './files.js';
import { h, modal, closeModal, toast, busy, segmented, slider, toggle, select, promptBox } from './ui.js';
import { icon } from './icons.js';
import { HELP, helpBtn } from './help.js';

const ed = A.ed, rend = A.rend;
const TW = 20;
const clone = (x) => JSON.parse(JSON.stringify(x));

Object.assign(HELP, {
  'detail.stack': { t: '自动丰富细节', s: '一键让地形更丰富，可以调、可以预览', b: '选一个预设，或者自己把几个“修改器”排成一串（比如 边缘自然化 → 加浅滩 → 撒树）。每一步都能单独调强度、关掉或换顺序。<b>先看预览，满意了再应用</b>，应用后也能撤销。<br>出生点和资源池附近默认受保护，做完会自动检查各出生点陆路是否互通，不通就开出浅滩通道。', tips: ['点“生成 4 个版本”可以并排挑一个最喜欢的。', '只想改一块：先框选，再勾“只改选区”。', '满意的组合可以“存为我的预设”或复制分享码发给别人。'] },
  'detail.rules': { t: '自定义规则', s: '在什么地形、离什么多远、放什么', b: '每条规则：在某种地形上，离另一种地形（可不填）一定距离内，按概率放某个物品或改成某种地形。比如“在草地上、离水 3~6 格，放树，概率 30%”。' },
  'detail.learn': { t: '学习参考地图', s: '照着喜欢的地图的风格来', b: '选一张你喜欢的地图，编辑器统计它每种地形上撒了多少装饰、边缘有多弯，生成一组修改器，套用到当前地图。' },
  'terrain.detail': { t: '细节笔刷', s: '刷到哪里，细节加到哪里', b: '选一种效果（边缘自然化、撒装饰、侵蚀、平滑、起伏、清装饰、战损），在地图上刷。比一键改整张图更好控制。' },
  'terrain.height': { t: '高度笔刷', s: '像画山一样抬高、压低', b: '按住刷，地面一层层抬高：深水 → 水 → 浅水 → 沙地 → 草地 → 泥土 → 悬崖高地；切到“压低”就反过来。每刷一笔变一层。' },
  'terrain.biome': { t: '群系笔刷', s: '先画“这片是森林、那片是沙漠”', b: '先用群系笔刷涂出区域（森林、草原、沙漠、雪原、沼泽、火山、荒原），再点“按群系生成”，编辑器自动填好里面的地形组合和装饰，边界自然过渡。' },
  'terrain.road': { t: '道路工具', s: '画一条行军路线', b: '沿着想要的路线拖动：路上的树和碎石会被清掉，过河的地方自动变成浅滩渡口；可选把陆地铺成泥土路。' },
  'detail.modules': { t: '战术模块', s: '自动摆隘口、桥头堡、高地据点', b: '从印章库里选几种模块，编辑器在两队之间的中线附近和地图空地上自动摆好，并保持对称。' },
});

// ---------------- 修改器堆叠对话框 ----------------
export async function detailDialog(init = null) {
  if (!ed.map || !ed.engine) { toast('先打开一张有地形标注的地图'); return; }
  const st = A.detailState || (A.detailState = { stack: clone(STYLE_PRESETS[0].stack), seed: Math.floor(Math.random() * 1e6), sym: 'auto', protect: true, connect: true, onlySel: false, view: 'after', modules: { on: false, count: 2, kinds: ['ford', 'forest', 'plateau'] } });
  if (init) st.stack = clone(init);
  const symAuto = detectSymmetry();
  const pv = h('canvas', { class: 'dpv' }), before = h('canvas', { class: 'dpv' });
  const stackBox = h('div', { class: 'stack' });
  const info = h('div', { class: 'hint', style: 'margin-top:6px' });
  let base = null, small = null, timer = 0, busyRun = false;
  const opts = () => ({ seed: st.seed, sym: st.sym === 'auto' ? symAuto : st.sym, area: st.onlySel && ed.selection ? ed.selection : null, protect: st.protect });
  const rebuildBase = () => { base = makeWork(opts()); small = shrinkWork(base, 420); drawWork(small.w, before); };
  const preview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (busyRun) return; busyRun = true;
      const w = clone2(small.w);
      const t0 = performance.now();
      await runStack(w, st.stack, { ...opts(), k: small.k });
      drawWork(w, pv);
      info.innerHTML = `预览 ${small.w.W}×${small.w.H}${small.k < 1 ? '（缩小显示，应用时按全尺寸生成）' : ''} · 种子 ${st.seed} · 对称：${({ none: '无', lr: '左右', tb: '上下', rot: '中心', quad: '四向' })[opts().sym]} · ${Math.round(performance.now() - t0)} ms`;
      busyRun = false;
    }, 120);
  };
  const drawStack = () => {
    stackBox.innerHTML = '';
    st.stack.forEach((s, i) => {
      const M = MODS[s.id]; if (!M) return;
      const row = h('div', { class: 'mod' + (s.on === false ? ' off' : '') });
      const head = h('div', { class: 'mh' },
        h('input', { type: 'checkbox', checked: s.on !== false, style: 'width:auto', onchange: (e) => { s.on = e.target.checked; drawStack(); preview(); } }),
        h('b', {}, M.cn), h('small', {}, M.desc),
        h('button', { class: 'ib', title: '上移', disabled: i === 0, onclick: () => { [st.stack[i - 1], st.stack[i]] = [st.stack[i], st.stack[i - 1]]; drawStack(); preview(); }, html: '↑' }),
        h('button', { class: 'ib', title: '下移', disabled: i === st.stack.length - 1, onclick: () => { [st.stack[i + 1], st.stack[i]] = [st.stack[i], st.stack[i + 1]]; drawStack(); preview(); }, html: '↓' }),
        h('button', { class: 'ib', title: '去掉', onclick: () => { st.stack.splice(i, 1); drawStack(); preview(); }, html: icon('close') }));
      row.append(head);
      if (s.on !== false) {
        s.p = s.p || {};
        for (const [k, lb, mn, mx, step, d] of M.params) row.append(slider(lb, mn, mx, s.p[k] ?? d, (v) => { s.p[k] = v; preview(); }, { step }));
        if (s.id === 'rules') row.append(rulesEditor(s, preview));
        if (s.id === 'scatter' && s.p.rules) row.append(h('small', { style: 'color:var(--dim)' }, `使用学到的 ${s.p.rules.length} 条撒放规则`));
      }
      stackBox.append(row);
    });
    if (!st.stack.length) stackBox.append(h('div', { class: 'hint' }, '还没有修改器。从上面选一个预设，或者点“加修改器”。'));
  };
  // 预设
  const ups = await userPresets();
  const presetSel = select([['', '— 选一个预设 —'], ...STYLE_PRESETS.map((p) => [p.id, p.cn]), ...ups.map((p) => [p.id, '★ ' + p.cn])], '', (v) => {
    const p = [...STYLE_PRESETS, ...ups].find((x) => x.id === v); if (!p) return;
    st.stack = clone(p.stack); drawStack(); preview();
  });
  const addSel = select([['', '+ 加修改器'], ...Object.entries(MODS).map(([k, m]) => [k, m.cn])], '', (v) => { if (!v) return; st.stack.push({ id: v, on: true, p: v === 'rules' ? { list: [] } : {} }); addSel.value = ''; drawStack(); preview(); });
  const seedI = h('input', { type: 'number', value: st.seed, style: 'width:110px', onchange: (e) => { st.seed = +e.target.value || 1; preview(); } });
  const ctl = h('div', { class: 'ctl' },
    h('div', { class: 'row' }, h('b', { style: 'flex:1' }, '修改器堆叠'), helpBtn('detail.stack')),
    h('div', { class: 'grid2', style: 'margin-top:6px' }, presetSel, addSel),
    h('div', { style: 'margin-top:8px' }, stackBox),
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '随机与范围')),
    h('div', { class: 'row' }, h('span', {}, '种子'), seedI, h('button', { onclick: () => { st.seed = Math.floor(Math.random() * 1e6); seedI.value = st.seed; preview(); }, html: icon('dice') + ' 换一个' }), h('button', { onclick: () => variants(), html: icon('grid') + ' 生成 4 个版本' })),
    h('label', {}, `对称（检测到：${({ none: '不对称', lr: '左右', tb: '上下', rot: '中心' })[symAuto]}）`),
    segmented([['auto', '自动'], ['none', '不对称'], ['lr', '左右'], ['tb', '上下'], ['rot', '中心'], ['quad', '四向']], st.sym, (v) => { st.sym = v; preview(); }),
    toggle('保护出生点和资源池附近', st.protect, (v) => { st.protect = v; rebuildBase(); preview(); }),
    toggle('做完保证各出生点陆路互通（不通就开浅滩通道）', st.connect, (v) => { st.connect = v; }),
    ed.selection ? toggle('只改选区', st.onlySel, (v) => { st.onlySel = v; rebuildBase(); preview(); }) : null,
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '战术模块'), helpBtn('detail.modules')),
    toggle('应用后自动摆几个战术模块', st.modules.on, (v) => { st.modules.on = v; }),
    slider('每种几个', 1, 6, st.modules.count, (v) => { st.modules.count = v; }),
    h('div', { class: 'row', style: 'flex-wrap:wrap' }, ...builtinStamps(ed).filter((s) => !/^base/.test(s.id)).map((s) => toggle(s.cn, st.modules.kinds.includes(s.id), (v) => { st.modules.kinds = v ? [...st.modules.kinds, s.id] : st.modules.kinds.filter((k) => k !== s.id); }))),
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '预设')),
    h('div', { class: 'row', style: 'flex-wrap:wrap' },
      h('button', { onclick: async () => { const n = await promptBox('存为我的预设', '名字', '我的预设'); if (n) { await saveUserPreset(n, st.stack); toast('已保存'); } }, html: icon('save') + ' 存为我的预设' }),
      h('button', { onclick: () => { navigator.clipboard && navigator.clipboard.writeText(encodePreset(st.stack)); toast('分享码已复制'); }, html: icon('share') + ' 复制分享码' }),
      h('button', { onclick: async () => { const c = await promptBox('导入分享码', '分享码', ''); if (!c) return; try { st.stack = decodePreset(c); drawStack(); preview(); } catch (e) { toast('分享码不对'); } }, html: icon('import') + ' 导入分享码' }),
      h('button', { onclick: () => learn(), html: icon('book') + ' 学习参考地图' }), helpBtn('detail.learn'),
      ups.length ? h('button', { onclick: async () => { const p = ups.find((x) => x.id === presetSel.value); if (!p) { toast('先在上面选中要删除的“★”预设'); return; } await deleteUserPreset(p.id); toast('已删除'); }, html: icon('del') + ' 删除选中的我的预设' }) : null),
    info);
  const viewSeg = segmented([['after', '效果'], ['before', '原图']], 'after', (v) => { pv.classList.toggle('hidden', v !== 'after'); before.classList.toggle('hidden', v !== 'before'); });
  before.classList.add('hidden');
  const body = h('div', { class: 'wiz' }, h('div', { class: 'pv' }, pv, before, h('div', { class: 'pvbar' }, viewSeg)), ctl);
  async function variants() {
    const grid = h('div', { class: 'variants' });
    const seeds = [0, 1, 2, 3].map(() => Math.floor(Math.random() * 1e6));
    const mini = shrinkWork(base, 220);
    for (const sd of seeds) {
      const w = clone2(mini.w); await runStack(w, st.stack, { ...opts(), seed: sd, k: mini.k });
      const c = h('canvas'); drawWork(w, c);
      grid.append(h('button', { class: 'variant', onclick: () => closeModal(sd) }, c, h('small', {}, '种子 ' + sd)));
    }
    const pick = await modal('挑一个版本', grid, [{ label: '都不要', value: null }], { wide: true });
    if (pick) { st.seed = pick; seedI.value = pick; preview(); }
  }
  async function learn() {
    const r = await pickFile('.tmx'); if (!r) return;
    try {
      const map = await busy('正在读取参考地图…', async () => RWMap.parse(await r.file.text(), r.file.name));
      const e2 = new Editor(); e2.setMap(map);
      const stk = learnFrom(e2);
      st.stack = [...st.stack.filter((s) => s.id !== 'scatter' && s.id !== 'roughen'), ...stk];
      drawStack(); preview();
      toast(`已学到「${r.file.name}」的风格：${stk[1].p.rules.length} 条撒放规则`);
    } catch (e) { toast('学习失败：' + e.message); }
  }
  rebuildBase(); drawStack(); preview();
  const go = await modal('自动丰富细节', body, [{ label: '取消', value: null }, { label: '应用到地图', value: 'go', primary: true }], { full: true, sticky: true });
  if (go !== 'go') return;
  await (await import('./io.js')).autoSnapshot('丰富细节前');
  const res = await busy('正在生成细节…', async () => {
    const w = makeWork(opts());
    await runStack(w, st.stack, { ...opts(), k: 1, yield: true });
    return applyWork(w, '自动丰富细节', { connect: st.connect });
  });
  if (st.modules.on && st.modules.kinds.length) placeModules(st.modules.kinds, st.modules.count, opts().sym);
  afterBig();
  toast('细节已加上' + (res.carved ? `；为保证互通开了 ${res.carved} 格通道` : '') + '。不满意可以撤销。', 3600);
  A.hooks.coach && A.hooks.coach('detail');
}
function clone2(w) { return { ...w, V: w.V.slice(), I: w.I.slice(), prot: w.prot, area: w.area }; }
function afterBig() { rend.invalidateAll(); rend.pools = ed.poolTiles(); A.mini.rebuild(); A.autoDirty = true; A.refresh(); }

function rulesEditor(s, onChange) {
  const box = h('div', { class: 'rules' });
  const eng = ed.engine;
  const tOpts = [['', '（任意地形）'], ...eng.paintable.map((t) => [eng.name(t), eng.cn(t)])];
  const putOpts = [...ed.items.filter((i) => !i.stamp).map((i) => ['item:' + i.name, '放 ' + i.cn]), ...eng.paintable.map((t) => ['terrain:' + eng.name(t), '改成 ' + eng.cn(t)])];
  const draw = () => {
    box.innerHTML = '';
    (s.p.list = s.p.list || []).forEach((r, i) => box.append(h('div', { class: 'rule' },
      h('div', { class: 'grid2' }, h('div', {}, h('label', {}, '在'), select(tOpts, r.on || '', (v) => { r.on = v; onChange(); })), h('div', {}, h('label', {}, '做什么'), select(putOpts, r.put || '', (v) => { r.put = v; onChange(); }))),
      h('div', { class: 'grid3' },
        h('div', {}, h('label', {}, '离（可不填）'), select(tOpts, r.near || '', (v) => { r.near = v; onChange(); })),
        h('div', {}, h('label', {}, '距离（格）'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('input', { type: 'number', value: r.dmin ?? 0, style: 'width:52px', onchange: (e) => { r.dmin = +e.target.value; onChange(); } }), '~', h('input', { type: 'number', value: r.dmax ?? 6, style: 'width:52px', onchange: (e) => { r.dmax = +e.target.value; onChange(); } }))),
        h('div', {}, h('label', {}, '概率 %'), h('input', { type: 'number', value: r.prob ?? 20, onchange: (e) => { r.prob = +e.target.value; onChange(); } }))),
      slider('成团', 0, 100, r.cluster ?? 40, (v) => { r.cluster = v; onChange(); }, { step: 5 }),
      h('button', { class: 'ib', title: '删除规则', onclick: () => { s.p.list.splice(i, 1); draw(); onChange(); }, html: icon('del') }))));
    box.append(h('div', { class: 'row' }, h('button', { onclick: () => { s.p.list.push({ on: 'Grass', near: '', dmin: 0, dmax: 6, put: putOpts[0] ? putOpts[0][0] : '', prob: 20, cluster: 40 }); draw(); onChange(); }, html: icon('plus') + ' 加一条规则' }), helpBtn('detail.rules')));
  };
  draw();
  return box;
}

// 战术模块：两队之间的中线附近 + 空地，按对称摆放
export function placeModules(kinds, count, sym) {
  const stamps = builtinStamps(ed).filter((s) => kinds.includes(s.id));
  if (!stamps.length) return 0;
  const m = ed.map, W = m.width, H = m.height;
  const sp = ed.spawns().filter((s) => s.team >= 0).map((s) => [s.cx / TW, s.cy / TW]);
  const spots = [];
  for (let a = 0; a < sp.length; a++) for (let b = a + 1; b < sp.length; b++) spots.push([(sp[a][0] + sp[b][0]) / 2, (sp[a][1] + sp[b][1]) / 2]);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  while (spots.length < count * stamps.length * 2) spots.push([rnd() * W, rnd() * H]);
  const save = ed.sym; ed.sym = sym || 'none';
  ed.begin('摆战术模块');
  const used = [];
  let n = 0;
  for (const s of stamps) for (let k = 0; k < count; k++) {
    const spot = spots.find(([x, y]) => !used.some(([u, v]) => Math.hypot(u - x, v - y) < 14) && !sp.some(([u, v]) => Math.hypot(u - x, v - y) < 16) && x > 4 && y > 4 && x < W - 4 && y < H - 4);
    if (!spot) break;
    used.push(spot);
    pasteWithSymmetry(ed, s.clip, Math.round(spot[0] - s.clip.w / 2), Math.round(spot[1] - s.clip.h / 2), { skipEmpty: true, newTeams: true });
    n++;
  }
  ed.commit(); ed.sym = save;
  return n;
}

// ---------------- 地形模式的四个新工具 ----------------
const BRUSH_KINDS = [['roughen', '边缘自然化'], ['scatter', '撒装饰'], ['erode', '侵蚀'], ['smooth', '平滑'], ['noise', '起伏'], ['warzone', '战损'], ['clearDecor', '清装饰']];
// 在笔刷范围的小窗口里跑一个修改器，再把变化写回
export function detailDab(tx, ty, kind, strength = 60) {
  const m = ed.map, eng = ed.engine, W = m.width, H = m.height, r = Math.max(1, Math.floor(ed.size / 2));
  for (const [sx, sy] of ed.symPoints(tx, ty, 't')) {
    const cx = Math.round(sx), cy = Math.round(sy), pad = 3;
    const x0 = Math.max(0, cx - r - pad), y0 = Math.max(0, cy - r - pad), x1 = Math.min(W - 1, cx + r + pad), y1 = Math.min(H - 1, cy + r + pad);
    const w = { W: x1 - x0 + 1, H: y1 - y0 + 1 }; w.W1 = w.W + 1;
    w.V = new Uint8Array(w.W1 * (w.H + 1)); w.I = new Uint32Array(w.W * w.H); w.prot = new Uint8Array(w.W * w.H); w.area = new Uint8Array(w.W * w.H);
    for (let y = 0; y <= w.H; y++) for (let x = 0; x <= w.W; x++) w.V[y * w.W1 + x] = eng.V[(y0 + y) * eng.W1 + x0 + x];
    const I = m.ensureLayer('Items');
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) { w.I[y * w.W + x] = I.data[(y0 + y) * W + x0 + x]; if ((x0 + x - cx) ** 2 + (y0 + y - cy) ** 2 <= r * r) w.area[y * w.W + x] = 1; }
    const M = MODS[kind], p = Object.fromEntries(M.params.map(([k, , , , , d]) => [k, d]));
    if ('strength' in p) p.strength = strength; if ('density' in p) p.density = strength; if ('amount' in p) p.amount = strength;
    const before = w.V.slice();
    M.run.call(M, w, p, { eng, seed: (Date.now() & 0xffff) + cx, k: 1, axis: 'lr' });
    const verts = [], vals = [];
    for (let y = 0; y <= w.H; y++) for (let x = 0; x <= w.W; x++) { const k = y * w.W1 + x; if (w.V[k] !== before[k]) { verts.push((y0 + y) * eng.W1 + x0 + x); vals.push(w.V[k]); } }
    if (verts.length) eng.paint(ed.op, verts, vals);
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) { const g = w.I[y * w.W + x], i = (y0 + y) * W + x0 + x; if (g !== I.data[i]) ed.setTile(I, x0 + x, y0 + y, g); }
  }
}
// 高度：每一笔变一层
export function heightDab(tx, ty, dir, visited) {
  const eng = ed.engine, m = ed.map, r = ed.size / 2;
  const ladder = ['Deep Water', 'Water', 'Shallow Water', 'Sand', 'Grass', 'Dirt', 'Dirt Cliff'].map((n) => eng.index(n)).filter((t, i, a) => t >= 0 && eng.paintable.includes(t) && a.indexOf(t) === i);
  const alias = new Map([['Snow', 'Grass'], ['Dune', 'Sand'], ['Swamp', 'Grass'], ['Stone', 'Dirt'], ['Cliff', 'Dirt Cliff'], ['Lake', 'Water'], ['Ice', 'Sand']].map(([a, b]) => [eng.index(a), eng.index(b)]));
  const verts = [], vals = [];
  for (const [sx, sy] of ed.symPoints(tx + 0.5, ty + 0.5, 'v')) {
    for (let y = Math.max(0, Math.ceil(sy - r)); y <= Math.min(m.height, Math.floor(sy + r)); y++) for (let x = Math.max(0, Math.ceil(sx - r)); x <= Math.min(m.width, Math.floor(sx + r)); x++) {
      if ((x - sx) ** 2 + (y - sy) ** 2 > r * r) continue;
      const v = y * eng.W1 + x; if (visited.has(v)) continue; visited.add(v);
      let t = eng.V[v]; let li = ladder.indexOf(t); if (li < 0 && alias.has(t)) li = ladder.indexOf(alias.get(t));
      if (li < 0) continue;
      const ni = Math.max(0, Math.min(ladder.length - 1, li + dir));
      if (ni !== li) { verts.push(v); vals.push(ladder[ni]); }
    }
  }
  if (verts.length) eng.paint(ed.op, verts, vals);
}
// 群系：画在一张单独的格子图上（不写进地图）
export function biomeDab(tx, ty, b) {
  const m = ed.map, W = m.width, H = m.height;
  if (!A.biomeMask || A.biomeMask.length !== W * H) A.biomeMask = new Uint8Array(W * H);
  const r = Math.floor(ed.size / 2);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const [sx, sy] of ed.symPoints(tx, ty, 't')) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r + 0.5) continue;
    const X = Math.round(sx) + dx, Y = Math.round(sy) + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    A.biomeMask[Y * W + X] = b; x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
  }
  showBiomeTint(); rend.invalidate(x0, y0, x1, y1);
}
export function showBiomeTint() {
  const cols = BIOMES.map(([, , c]) => { const n = parseInt(c.slice(1, 7), 16); const a = c.length > 7 ? parseInt(c.slice(7), 16) : 120; return ((a << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0; });
  if (!rend.tint || rend.tint.kind !== 'biome') rend.setTint({ kind: 'biome', fn: (i) => (A.biomeMask && A.biomeMask[i] ? cols[A.biomeMask[i]] : 0), opacity: 0.55 });
}
// 道路：沿路清装饰，过水变浅滩，可选铺泥土
export function applyRoad(points, width, pave) {
  const m = ed.map, eng = ed.engine, W = m.width, I = m.ensureLayer('Items');
  const ford = ['Water Bridge', 'Shallow Water'].map((n) => eng.index(n)).find((t) => t >= 0 && eng.paintable.includes(t));
  const dirt = eng.index('Dirt');
  const r = Math.max(1, width / 2), set = new Set();
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1], [bx, by] = points[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= n; s++) { const x = ax + (bx - ax) * s / n, y = ay + (by - ay) * s / n; for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r) set.add(Math.round(y + dy) * eng.W1 + Math.round(x + dx)); }
  }
  const verts = [], vals = [];
  for (const v of set) {
    if (v < 0 || v >= eng.V.length) continue;
    const t = eng.V[v], nm = eng.name(t) || '';
    if (/water|lake/i.test(nm) && !/bridge/i.test(nm) && ford !== undefined) { verts.push(v); vals.push(ford); }
    else if (/tree/i.test(nm) || (pave && dirt >= 0 && /grass|sand|snow|dune|swamp/i.test(nm))) { verts.push(v); vals.push(pave && dirt >= 0 ? dirt : eng.index('Grass')); }
    const x = v % eng.W1, y = (v - x) / eng.W1;
    if (x < W && y < m.height && I.data[y * W + x] && !(ed.poolGids && ed.poolGids.has(I.data[y * W + x]))) ed.setTile(I, x, y, 0);
  }
  const vv = [], tt = [];
  verts.forEach((v, i) => { if (vals[i] >= 0) { vv.push(v); tt.push(vals[i]); } });
  if (vv.length) eng.paint(ed.op, vv, tt);
}

// 地形模式下这四个工具的面板
export function toolPanel(body, T, sec, sizeSec) {
  if (T === 'detail') {
    body.append(sec('细节笔刷', 'terrain.detail', segmented(BRUSH_KINDS, A.detailBrush || 'roughen', (v) => { A.detailBrush = v; }),
      slider('强度', 5, 100, A.detailStrength ?? 60, (v) => { A.detailStrength = v; }, { step: 5, fmt: (v) => v + '%' })), sec('笔刷', null, sizeSec(64)));
    body.append(h('button', { class: 'primary', style: 'width:100%', onclick: () => detailDialog(), html: icon('generate') + ' 打开“自动丰富细节”（整张图）' }));
  } else if (T === 'height') {
    body.append(sec('高度笔刷', 'terrain.height', segmented([[1, '抬高'], [-1, '压低']], A.heightDir ?? 1, (v) => { A.heightDir = +v; })), sec('笔刷', null, sizeSec(64)),
      h('div', { class: 'hint' }, '深水 → 水 → 浅水 → 沙地 → 草地 → 泥土 → 悬崖高地。每刷一笔变一层，松手再刷就再变一层。'));
  } else if (T === 'biome') {
    const sw = h('div', { class: 'swatches' });
    for (const [id, cn, c] of BIOMES) sw.append(h('button', { class: 'sw' + ((A.biome ?? 1) === id ? ' on' : ''), onclick: () => { A.biome = id; A.refresh('dock'); } }, h('span', { class: 'cchip', style: `background:${id ? c : 'repeating-linear-gradient(45deg,#333 0 4px,#222 4px 8px)'}` }), id ? cn : '擦除'));
    body.append(sec('群系笔刷', 'terrain.biome', sw), sec('笔刷', null, sizeSec(120)),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => detailDialog([{ id: 'biome', on: true, p: {} }, { id: 'roughen', on: true, p: { strength: 40 } }]), html: icon('generate') + ' 按群系生成…' }),
        h('button', { onclick: () => { A.biomeMask = null; rend.setTint(null); rend.invalidateAll(); A.refresh('dock'); }, html: icon('del') + ' 清空群系' })),
      h('div', { class: 'hint' }, '群系只是“规划图”，不会写进地图文件。画好后点“按群系生成”。'));
    if (A.biomeMask) showBiomeTint();
  } else if (T === 'road') {
    body.append(sec('道路工具', 'terrain.road', toggle('把陆地铺成泥土路', !!A.roadPave, (v) => { A.roadPave = v; })), sec('路宽', null, sizeSec(16)),
      h('div', { class: 'hint' }, '沿着路线拖动。树和装饰会被清掉，过河的地方自动变成浅滩渡口。'));
  }
}
