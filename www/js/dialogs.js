// 对话框：新建、调整画布、等比缩放、整图镜像、对称检查、随机生成、图片转地图、立绘贴图、描图、检查、设置
import { A } from './state.js';
import { newMapFromTemplate } from './tmx.js';
import { TERRAIN_CN, NONE } from './terrain.js';
import { runChecks, sizeTier, MAP_TYPES } from './check.js';
import { mirrorMap, symmetryDiff, scaleMap, unitTileLayers } from './transform.js';
import { balanceReport } from './pathing.js';
import { PRESETS, STYLES, generateMap, encodeShare, decodeShare } from './gen.js';
import { sampleImage, dominantColors, classifyByColor, fitCoverage, classifyByHeight, deepenWater, suggestTerrains, srgbToOklab } from './imagemap.js';
import { majority, mergeSmall, removeThin, applyCells, chooseSpawns, connectSpawns, placePoolsAround, shares } from './terraform.js';
import { preparePicture, addPictureTileset, removeTileset } from './picture.js';
import { pickImage } from './files.js';
import { kvGet, kvSet, clamp } from './util.js';
import { h, modal, closeModal, modalBody, toast, busy, confirmBox, segmented, slider, toggle, select, popover, closePopover } from './ui.js';
import { TerrainEngine } from './terrain.js';
import { Renderer } from './render.js';
import { icon } from './icons.js';
import { helpBtn } from './help.js';
import { loadMapFromText, exportPreview, exportPoster, autoSnapshot, exportCover } from './io.js';

const ed = A.ed, rend = A.rend;
const tierDot = (w, hh) => { const t = sizeTier(w, hh); const c = t.level === 'ok' ? 'var(--ok)' : t.level === 'warn' ? 'var(--warn)' : 'var(--err)'; return `<span class="tier" style="background:${c}"></span>${t.text}`; };
function afterWhole() { rend.setMap(ed.map); A.mini.rebuild(); A.autoDirty = true; A.refresh(); }

// ---------------- 新建地图 ----------------
export async function newMapDialog(preset = {}) {
  const tpl = await kvGet('template');
  if (!tpl) {
    const go = await modal('需要图块素材', h('p', {}, '新建地图前，先打开一张你已有的铁锈战争地图，编辑器会从里面取出图块素材。'), [{ label: '取消', value: 0 }, { label: '去打开地图', value: 1, primary: true }]);
    if (go) A.hooks.openMap();
    return;
  }
  if (ed.dirty && !(await confirmBox('新建地图？', '当前地图还没保存，新建会丢掉未保存的修改（自动保存的副本仍可恢复）。', '仍然新建'))) return;
  const doc = new DOMParser().parseFromString('<map>' + tpl.xml + '</map>', 'application/xml');
  const gts = [...doc.querySelectorAll('tileset')].find((t) => (t.getAttribute('name') || '') === 'export_ground' || t.querySelector('property[name="layer"][value="ground"]'));
  const tnames = gts ? [...gts.querySelectorAll('terraintypes > terrain')].map((t) => t.getAttribute('name')) : [];
  const solid = new Set();
  if (gts) for (const t of gts.querySelectorAll('tile')) { const tr = t.getAttribute('terrain'); if (tr) { const p = tr.split(','); if (p.every((x) => x === p[0])) solid.add(+p[0]); } }
  const st = { name: '新地图', w: 200, h: 200, players: 2, start: 'blank', layout: 'ring', base: Math.max(0, tnames.indexOf('Grass')), pools: 2, center: 2, preset: 'continent', style: 'temperate', sym: 'lr', seed: Math.floor(Math.random() * 1e6), ...preset };
  const presets = [[100, 100], [160, 160], [200, 200], [300, 300], [500, 500], [1000, 1000]];
  const wI = h('input', { type: 'number', min: 20, max: 5000, value: st.w });
  const hI = h('input', { type: 'number', min: 20, max: 5000, value: st.h });
  const tierEl = h('div', { class: 'hint', style: 'margin-top:6px' });
  const pre = h('div', { class: 'presets' });
  const refresh = () => {
    st.w = clamp(+wI.value || 20, 20, 5000); st.h = clamp(+hI.value || 20, 20, 5000);
    tierEl.innerHTML = tierDot(st.w, st.h);
    for (const b of pre.children) b.classList.toggle('on', b.dataset.v === `${st.w}x${st.h}`);
  };
  for (const [w, hh] of presets) pre.append(h('button', { 'data-v': `${w}x${hh}`, onclick: () => { wI.value = w; hI.value = hh; refresh(); } }, `${w}×${hh}`));
  wI.oninput = refresh; hI.oninput = refresh;
  const plI = h('input', { type: 'number', min: 1, max: 100, value: st.players, oninput: (e) => { st.players = clamp(+e.target.value || 2, 1, 100); } });
  const blankBox = h('div', {},
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '出生点布局'), select([['ring', '围成一圈'], ['lr', '左右对阵'], ['tb', '上下对阵'], ['grid', '均匀网格（适合很多人）']], st.layout, (v) => { st.layout = v; })),
      h('div', {}, h('label', {}, '底色地形'), select(tnames.map((n, i) => [i, TERRAIN_CN[n] || n]).filter(([i]) => solid.has(i)), st.base, (v) => { st.base = +v; }))));
  const genBox = h('div', { class: 'hidden' },
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '地形预设'), select(Object.entries(PRESETS).map(([k, p]) => [k, p.cn]), st.preset, (v) => { st.preset = v; })),
      h('div', {}, h('label', {}, '风格'), select(Object.entries(STYLES).map(([k, s]) => [k, s.cn]), st.style, (v) => { st.style = v; }))),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '对称'), select([['none', '不对称'], ['lr', '左右'], ['tb', '上下'], ['rot', '中心旋转'], ['quad', '四向']], st.sym, (v) => { st.sym = v; })),
      h('div', {}, h('label', {}, '种子号'), h('input', { type: 'number', value: st.seed, oninput: (e) => { st.seed = +e.target.value || 1; } }))));
  const startSeg = segmented([['blank', '空白地图'], ['gen', '随机生成地形']], st.start, (v) => { st.start = v; blankBox.classList.toggle('hidden', v !== 'blank'); genBox.classList.toggle('hidden', v !== 'gen'); });
  if (st.start === 'gen') { blankBox.classList.add('hidden'); genBox.classList.remove('hidden'); }
  refresh();
  const LAYOUTS = [
    ['1v1 对称', { name: '1v1', w: 160, h: 160, players: 2, start: 'gen', preset: 'continent', sym: 'lr', pools: 3, center: 2 }],
    ['2v2', { name: '2v2', w: 220, h: 220, players: 4, start: 'gen', preset: 'continent', sym: 'lr', pools: 2, center: 4 }],
    ['4 人四角', { name: '4人四角', w: 240, h: 240, players: 4, start: 'gen', preset: 'continent', sym: 'quad', pools: 2, center: 4 }],
    ['8 人环形', { name: '8人环形', w: 320, h: 320, players: 8, start: 'blank', layout: 'ring', pools: 2, center: 6 }],
    ['10 人大乱斗', { name: '10人大乱斗', w: 400, h: 400, players: 10, start: 'blank', layout: 'ring', pools: 2, center: 8 }],
    ['海战图', { name: '海战', w: 300, h: 300, players: 4, start: 'gen', preset: 'islands', sym: 'lr', pools: 2, center: 4 }],
    ['城夺图', { name: '城夺', w: 300, h: 300, players: 4, start: 'blank', layout: 'grid', pools: 1, center: 0, after: 'cityTemplate' }],
    ['生存防守图', { name: '生存', w: 200, h: 200, players: 2, start: 'blank', layout: 'lr', pools: 3, center: 2, after: 'survivalTemplate' }],
    ['任务关卡', { name: '任务', w: 160, h: 160, players: 1, start: 'blank', layout: 'lr', pools: 2, center: 0, after: 'missionTemplate' }],
  ];
  const tplRow = h('div', { class: 'presets', style: 'margin-bottom:6px' }, LAYOUTS.map(([lb, p]) => h('button', { class: preset.name === p.name ? 'on' : '', onclick: () => { closeModal(null); newMapDialog({ ...p, seed: st.seed }); } }, lb)));
  const r = await modal('新建地图', h('div', {},
    h('label', {}, '从布局模板开始（点一下自动填好下面的设置）'), tplRow,
    h('label', {}, '地图名称'), h('input', { value: st.name, oninput: (e) => { st.name = e.target.value; } }),
    h('label', {}, '尺寸（格，每格 20 像素）'), pre,
    h('div', { class: 'grid2', style: 'margin-top:6px' }, h('div', {}, h('label', {}, '宽'), wI), h('div', {}, h('label', {}, '高'), hI)), tierEl,
    h('div', { class: 'grid2' }, h('div', {}, h('label', {}, '玩家人数（1~100）'), plI), h('div', {}, h('label', {}, '开始方式'), startSeg)),
    blankBox, genBox,
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '每队身边的资源池'), select([0, 1, 2, 3, 4].map((i) => [i, i + ' 个']), st.pools, (v) => { st.pools = +v; })),
      h('div', {}, h('label', {}, '地图中央的公共资源池'), select([0, 1, 2, 4, 6, 8].map((i) => [i, i + ' 个']), st.center, (v) => { st.center = +v; }))),
    h('p', { style: 'color:var(--muted);font-size:12.5px' }, '会自动生成：地面、出生点（指挥中心 + 2 个建造者）、资源池和 map_info（type=skirmish）。生成后可以继续改。')),
  [{ label: '取消', value: null }, { label: '生成', value: () => ({ ...st }), primary: true }], { sticky: true });
  if (!r) return;
  await busy('正在生成地图…', () => createNewMap(r));
  if (r.after) setTimeout(() => import('./triggers.js').then((T) => T[r.after]()), 400);
}

export async function createNewMap(st) {
  const tpl = await kvGet('template');
  // 没有素材模板就没法新建（图块集得从一张现成的铁锈地图里取）
  if (!tpl || !tpl.xml) { toast('先打开一张铁锈战争 .tmx 地图，编辑器要用它的图块素材'); return null; }
  // 尺寸不合法时别一路传下去变成 width="undefined"，会在解析时报“图层尺寸与地图不一致”这种看不懂的错
  const w = Math.round(Number(st.w)), h = Math.round(Number(st.h));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 20 || h < 20) { toast('地图尺寸不对（至少 20×20）'); return null; }
  st = { ...st, w, h };
  const map = await newMapFromTemplate(tpl.xml, w, h, { name: st.name });
  ed.setMap(map);
  A.mapName = (st.name || '新地图').replace(/[\\/:*?"<>|]/g, '_');
  A.fileHandle = null; A.handleName = '';
  const n = clamp(st.players || 2, 1, 100);
  if (ed.engine) ed.engine.fillAll(ed.engine.paintable.includes(st.base) ? st.base : ed.terrain);
  if (st.start === 'gen' && ed.engine) {
    generateMap(ed, { preset: st.preset, style: st.style, sym: st.sym, seed: st.seed, players: n, pools: st.pools, center: st.center });
  } else {
    const W = st.w, H = st.h;
    const spots = [];
    const margin = Math.min(10, Math.floor(Math.min(W, H) / 6));
    if (st.layout === 'grid' || n > 16) {
      const cols = Math.ceil(Math.sqrt(n * W / H)), rows = Math.ceil(n / cols);
      for (let k = 0; k < n; k++) { const c = k % cols, r = Math.floor(k / cols); spots.push([(c + 0.5) * W / cols, (r + 0.5) * H / rows]); }
    } else if (st.layout === 'lr' || st.layout === 'tb') {
      const a = Math.ceil(n / 2), b = n - a;
      for (let i = 0; i < a; i++) spots.push(st.layout === 'lr' ? [margin + 2, (i + 1) * H / (a + 1)] : [(i + 1) * W / (a + 1), margin + 2]);
      for (let i = 0; i < b; i++) spots.push(st.layout === 'lr' ? [W - margin - 3, (i + 1) * H / (b + 1)] : [(i + 1) * W / (b + 1), H - margin - 5]);
    } else {
      const R = Math.min(W, H) / 2 - margin - 3;
      for (let i = 0; i < n; i++) { const a = Math.PI + i * 2 * Math.PI / n; spots.push([W / 2 + R * Math.cos(a), H / 2 + R * Math.sin(a)]); }
    }
    const op = ed.begin('生成');
    const G = ed.unitsGroup();
    // 新建的图里本来不该有单位；但模板/上一次操作可能在 UnitObjects 留下对象，
    // 不清空的话白图会带着别人家的出生点（实测：旧图 2 队指挥中心 + 4 个建造者残留在 60x60 新图上）
    G.objects = G.objects.filter((o) => !o.props.some((q) => q.name === 'unit'));
    const tiles = spots.map(([x, y]) => [Math.round(clamp(x, 2, W - 3)), Math.round(clamp(y, 2, H - 6))]);
    tiles.forEach(([x, y], k) => ed.spawnAtCenter(G, x * 20 + 10, y * 20 + 10, k));
    placePoolsAround(ed, op, tiles, st.pools, st.center);
    ed.op = null; // 新地图不需要撤销这一步
  }
  ed.undoStack = []; ed.redoStack = [];
  rend.setMap(map);
  A.mini.rebuild();
  ed.dirty = true; A.autoDirty = true;
  document.getElementById('welcome').classList.add('hidden');
  A.refresh();
  return map;
}

// ---------------- 调整画布 ----------------
export async function resizeDialog() {
  const m = ed.map; if (!m) return;
  const st = { ax: 1, ay: 1 };
  const wI = h('input', { type: 'number', min: 20, max: 5000, value: m.width });
  const hI = h('input', { type: 'number', min: 20, max: 5000, value: m.height });
  const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(3,34px);gap:4px' });
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    grid.append(h('button', { class: x === 1 && y === 1 ? 'primary' : '', style: 'height:30px', onclick: (e) => { st.ax = x; st.ay = y; for (const b of grid.children) b.className = ''; e.currentTarget.className = 'primary'; } }, ''));
  }
  const r = await modal('调整画布大小', h('div', {},
    h('p', { class: 'hint' }, '改地图大小但内容不缩放：在四周加宽，或裁掉一部分。想让内容一起变大，用“等比缩放”。'),
    h('div', { class: 'grid2' }, h('div', {}, h('label', {}, '新宽度'), wI), h('div', {}, h('label', {}, '新高度'), hI)),
    h('label', {}, '原地图放在哪里'), grid,
    h('p', { style: 'color:var(--muted);font-size:12.5px' }, ed.engine ? `新增的区域用当前地形「${ed.engine.cn(ed.terrain)}」填充。可以撤销。` : '可以撤销。')),
  [{ label: '取消', value: null }, { label: '调整', value: () => ({ w: clamp(+wI.value || 20, 20, 5000), h: clamp(+hI.value || 20, 20, 5000) }), primary: true }]);
  if (!r) return;
  await autoSnapshot('调整画布前');
  await busy('正在调整画布…', async () => {
    const ox = Math.round((r.w - m.width) * st.ax / 2), oy = Math.round((r.h - m.height) * st.ay / 2);
    const fill = ed.engine ? ed.engine.solidGid(ed.terrain) : 0;
    ed.beginWhole('调整画布');
    m.resize(r.w, r.h, ox, oy, fill);
    ed.rebuildEngine();
    ed.op.markAll();
    ed.commit();
    afterWhole();
  });
}

// ---------------- 等比缩放 ----------------
export async function scaleDialog() {
  const m = ed.map; if (!m) return;
  const st = { k: 2, units: 'move', pools: 'keep', triggers: true };
  const nUnits = ed.allObjects().filter(({ o }) => o.attrs.gid).length, nPools = rend.pools.length;
  const nTrig = (m.group('Triggers') || { objects: [] }).objects.filter((o) => !o.attrs.gid && (o.attrs.name || '').toLowerCase() !== 'map_info').length;
  const tileUnits = unitTileLayers(ed).length;
  const info = h('div', { class: 'hint' });
  const upd = () => {
    const w = Math.round(m.width * st.k), hh = Math.round(m.height * st.k);
    const pools = st.pools === 'area' && st.k * st.k > 1.5 ? `约 ${Math.round(nPools * Math.round(st.k * st.k))}` : nPools;
    info.innerHTML = `${m.width}×${m.height} → <b>${w}×${hh}</b> 格（面积 ×${(st.k * st.k).toFixed(2)}）<br>${tierDot(w, hh)}<br>缩放后：资源池 <b>${pools}</b> 个，单位 <b>${nUnits}</b> 个${st.units === 'move' ? '（挪到对应位置）' : '（原地不动）'}，不会多出来。`;
  };
  const presets = h('div', { class: 'presets' });
  for (const k of [0.5, 0.75, 1.5, 2, 3, 4]) presets.append(h('button', { class: k === st.k ? 'on' : '', onclick: (e) => { st.k = k; kI.value = k; for (const b of presets.children) b.classList.toggle('on', b === e.currentTarget); upd(); } }, '×' + k));
  const kI = h('input', { type: 'number', min: 0.25, max: 4, step: 0.05, value: st.k, oninput: (e) => { st.k = clamp(+e.target.value || 1, 0.25, 4); upd(); } });
  upd();
  const r = await modal('等比缩放地图', h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '把整张地图按比例放大或缩小。地形会重新铺好；单位、资源池怎么处理由你决定，任何东西都不会被复制。'), helpBtn('scale')),
    h('label', {}, '倍数（长和宽同时乘以）'), presets, h('div', { style: 'margin-top:6px;max-width:140px' }, kI),
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '细节选项')),
    h('label', {}, `单位（指挥中心、建造者等，共 ${nUnits} 个）`),
    segmented([['move', '挪到对应位置（推荐）'], ['keep', '原地不动']], st.units, (v) => { st.units = v; upd(); }),
    h('label', {}, `资源池（${nPools} 个）`),
    segmented([['keep', '数量不变，挪到对应位置'], ['area', '按面积增加']], st.pools, (v) => { st.pools = v; upd(); }),
    nTrig ? toggle(`触发器区域跟着缩放（${nTrig} 个）`, st.triggers, (v) => { st.triggers = v; }) : null,
    tileUnits ? h('div', { class: 'hint', style: 'margin-top:8px' }, '这张地图的部分单位是画在图块图层里的。缩放时会先把它们转成单位对象（游戏同样能读），这样只会搬位置、不会被复制。') : null,
    h('div', { style: 'margin-top:10px' }, info),
    h('ul', { style: 'color:var(--muted);font-size:12.5px;padding-left:18px' },
      h('li', {}, '树、草丛等装饰跟着地形一起放大。贴图保持原大小，搬到新位置。'),
      h('li', {}, '开始前会自动存一个快照；也可以直接撤销。缩小时细小的地形可能消失。'))),
  [{ label: '取消', value: null }, { label: '开始缩放', value: () => ({ ...st }), primary: true }]);
  if (!r) return;
  await autoSnapshot('缩放前');
  const res = await busy('正在缩放地图…', async () => scaleMap(ed, r.k, { units: r.units, pools: r.pools, triggers: r.triggers }));
  afterWhole();
  toast(`已缩放到 ${res.W2}×${res.H2} 格：资源池 ${res.pools + res.poolsAdded} 个${res.converted ? `，${res.converted} 个图块单位已转成对象` : ''}`, 4000);
}

// ---------------- 整图镜像 ----------------
export async function mirrorDialog() {
  if (!ed.map) return;
  const kinds = [
    ['lr', '左 → 右', '把左半边翻转复制到右半边'], ['rl', '右 → 左', '把右半边翻转复制到左半边'],
    ['tb', '上 → 下', '把上半边翻转复制到下半边'], ['bt', '下 → 上', '把下半边翻转复制到上半边'],
    ['rot', '中心旋转', '把左半边旋转 180° 放到右半边（1v1 常用）'], ['quad', '四向', '把左上四分之一复制到其余三块（4 人图）']];
  let pick = 'lr';
  const cards = h('div', { class: 'grid2' });
  for (const [k, t, d] of kinds) cards.append(h('button', { class: 'acard' + (k === pick ? ' on' : ''), style: k === pick ? 'border-color:var(--accent)' : '', onclick: (e) => { pick = k; for (const b of cards.children) b.style.borderColor = ''; e.currentTarget.style.borderColor = 'var(--accent)'; } },
    h('span', { html: icon(k === 'rot' ? 'rotate' : k === 'quad' ? 'grid' : k === 'lr' || k === 'rl' ? 'flipH' : 'flipV') }), h('div', {}, h('b', {}, t), h('small', {}, d))));
  const r = await modal('整图镜像', h('div', {}, h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '画好半张图，一键变成对称图。另一半原来的内容会被替换。'), helpBtn('mirror')), h('div', { style: 'margin-top:10px' }, cards),
    h('p', { style: 'color:var(--muted);font-size:12.5px' }, '出生点和资源池一起复制，新出生点自动分配队伍号；触发器不复制。可以撤销。')),
  [{ label: '取消', value: null }, { label: '镜像', value: () => pick, primary: true }]);
  if (!r) return;
  await autoSnapshot('镜像前');
  const mr = await busy('正在镜像…', async () => mirrorMap(ed, r));
  afterWhole();
  toast('镜像完成' + (mr && mr.converted ? `；${mr.converted} 个图块单位已转成对象` : ''));
}

export async function symDiffDialog() {
  if (!ed.map) return;
  let fix = false, dir = 'lr';
  const fixBox = h('div', { style: 'display:none;margin-top:6px' },
    h('label', {}, '用哪一边当标准'),
    select([['lr', '用左边覆盖右边'], ['rl', '用右边覆盖左边'], ['tb', '用上边覆盖下边'], ['bt', '用下边覆盖上边'], ['rot', '用左半边旋转 180° 覆盖右半边']], dir, (v) => { dir = v; }),
    h('div', { class: 'hint', style: 'margin-top:6px' }, '修复会连同出生点、资源池一起镜像（和“整图镜像”同一套逻辑），可以撤销。'));
  const tg = toggle('检查完就顺手修好', false, (v) => { fix = v; fixBox.style.display = v ? '' : 'none'; });
  const r = await modal('对称差异检查 / 一键修复', h('div', {},
    h('p', {}, '把地图和它的对称版本对比，用红色标出不一样的地方；也可以直接一键补成对称。'),
    h('label', {}, '对称方式'), select([['lr', '左右'], ['tb', '上下'], ['rot', '中心旋转']], A.settings.symDiffKind, (v) => { A.settings.symDiffKind = v; }),
    tg, fixBox),
  [{ label: '取消', value: null }, { label: '开始', value: 1, primary: true }]);
  if (!r) return;
  const kind = A.settings.symDiffKind;
  if (fix) {
    await autoSnapshot('对称修复前');
    const useDir = kind === 'rot' ? 'rot' : dir;
    const mr = await busy('正在修复…', async () => mirrorMap(ed, useDir));
    afterWhole();
    const res2 = await busy('正在对比…', async () => symmetryDiff(ed, kind));
    A.symDiff = res2; A.hooks.setOverlay('symdiff');
    const pct2 = (res2.count / res2.total * 100).toFixed(1);
    toast(res2.count ? `修复后还有 ${res2.count.toLocaleString()} 格（${pct2}%）不对称（图宽高是奇数时中间那行/列对不上）` : `已修复成对称图${mr && mr.converted ? `；${mr.converted} 个图块单位已转成对象` : ''}`, 5000);
    return;
  }
  const res = await busy('正在对比…', async () => symmetryDiff(ed, kind));
  A.symDiff = res;
  A.hooks.setOverlay('symdiff');
  const pct = (res.count / res.total * 100).toFixed(1);
  toast(res.count ? `有 ${res.count.toLocaleString()} 格（${pct}%）不对称，已用红色标出${res.spawns ? `；${res.spawns} 个出生点没有对称位置` : ''}。想直接修好：再打开一次，勾上“检查完就顺手修好”。` : (res.spawns ? `地形完全对称，但有 ${res.spawns} 个出生点没有对称位置` : '完全对称'), 5200);
}

// ---------------- 随机生成（在当前地图上） ----------------
export async function generatorDialog(code = '') {
  if (!ed.map || !ed.engine) { toast('先新建或打开一张地图'); return; }
  let st = { preset: 'continent', style: 'temperate', sym: 'lr', players: Math.max(2, ed.usedTeams().size || 2), pools: 2, center: 2, seed: Math.floor(Math.random() * 1e6) };
  if (code) { try { st = { ...st, ...decodeShare(code) }; } catch (e) { toast(e.message); } }
  const shareI = h('input', { readonly: true });
  const descEl = h('div', { class: 'hint' });
  const upd = () => { shareI.value = encodeShare({ ...st, w: ed.map.width, h: ed.map.height }); descEl.textContent = PRESETS[st.preset].desc; };
  const seedI = h('input', { type: 'number', value: st.seed, oninput: (e) => { st.seed = +e.target.value || 1; upd(); } });
  const body = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '按预设和种子号生成整张地图的地形、出生点和资源池。当前地图的地形会被替换（可以撤销）。'), helpBtn('generator')),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '地形预设'), select(Object.entries(PRESETS).map(([k, p]) => [k, p.cn]), st.preset, (v) => { st.preset = v; upd(); })),
      h('div', {}, h('label', {}, '风格'), select(Object.entries(STYLES).map(([k, s]) => [k, s.cn]), st.style, (v) => { st.style = v; upd(); }))),
    descEl,
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '对称'), select([['none', '不对称'], ['lr', '左右'], ['tb', '上下'], ['rot', '中心旋转'], ['quad', '四向']], st.sym, (v) => { st.sym = v; upd(); })),
      h('div', {}, h('label', {}, '玩家人数'), h('input', { type: 'number', min: 1, max: 100, value: st.players, oninput: (e) => { st.players = clamp(+e.target.value || 2, 1, 100); upd(); } }))),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '每队资源池'), select([0, 1, 2, 3, 4].map((i) => [i, i + ' 个']), st.pools, (v) => { st.pools = +v; upd(); })),
      h('div', {}, h('label', {}, '中央资源池'), select([0, 1, 2, 4, 6, 8].map((i) => [i, i + ' 个']), st.center, (v) => { st.center = +v; upd(); }))),
    slider('水域占比', 0, 80, Math.round((st.water ?? PRESETS[st.preset].water) * 100), (v) => { st.water = v / 100; upd(); }, { fmt: (v) => v + '%' }),
    slider('悬崖/高地占比', 0, 40, Math.round((st.mount ?? PRESETS[st.preset].mount) * 100), (v) => { st.mount = v / 100; upd(); }, { fmt: (v) => v + '%' }),
    slider('森林占比', 0, 40, Math.round((st.forest ?? PRESETS[st.preset].forest) * 100), (v) => { st.forest = v / 100; upd(); }, { fmt: (v) => v + '%' }),
    h('div', { class: 'grid2' }, h('div', {}, h('label', {}, '种子号'), seedI), h('div', {}, h('label', {}, ' '), h('button', { onclick: () => { st.seed = Math.floor(Math.random() * 1e6); seedI.value = st.seed; upd(); }, html: icon('dice') + ' 换一个' }))),
    h('label', {}, '分享码（发给别人可生成同一张图）'), h('div', { class: 'share' }, shareI, h('button', { onclick: () => { navigator.clipboard && navigator.clipboard.writeText(shareI.value); toast('已复制分享码'); } }, '复制')),
    h('details', { style: 'margin-top:8px' }, h('summary', { style: 'cursor:pointer;color:var(--muted)' }, '使用别人的分享码'),
      (() => { const ci = h('input', { placeholder: 'RWG1-…' }); return h('div', { class: 'share', style: 'margin-top:6px' }, ci, h('button', { onclick: () => { closeModal(); generatorDialog(ci.value); } }, '载入')); })()));
  upd();
  const r = await modal('随机生成', body, [{ label: '取消', value: null }, { label: '生成', value: () => ({ ...st }), primary: true }]);
  if (!r) return;
  await autoSnapshot('随机生成前');
  const res = await busy('正在生成…', async () => generateMap(ed, r));
  afterWhole();
  toast(`生成完成：${res.spawns} 个出生点、${res.pools} 个资源池${res.carved ? `，为保证互通铺了 ${res.carved} 格通道` : ''}`, 4000);
}

// ---------------- 图片转地图 ----------------
export async function imageToMapDialog() {
  if (!ed.map && !(await kvGet('template'))) { toast('先打开一张已有地图（取得图块素材）'); return; }
  const file = await pickImage(); if (!file) return;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (e) { toast('读不了这张图片'); return; }
  const into = !!(ed.map && ed.engine);
  const aspect = bmp.height / bmp.width;
  const st = {
    target: into ? 'current' : 'new', w: Math.min(400, Math.round(bmp.width)), mode: 'color', sample: 'smooth', blur: /jpe?g/i.test(file.type) ? 1 : 0,
    k: 6, clean: 2, useTargets: false, targets: {}, deep: true, players: 2, pools: 2, center: 2, connect: true, invert: false, bands: null, clearItems: true,
  };
  // 地形颜色表
  let eng = ed.engine, tColors = [], col = rend.colors;
  const tplReady = async () => {
    if (!eng) {
      // 还没有打开地图：用图块素材临时建一个小地图，只用来取地形和颜色
      const tpl = await kvGet('template');
      const tmp = await newMapFromTemplate(tpl.xml, 20, 20, {});
      const gts = tmp.tilesets.find((t) => t.layerTag === 'ground' || t.name === 'export_ground');
      eng = new TerrainEngine(tmp, gts, tmp.ground);
      const fake = { map: tmp };
      Renderer.prototype.buildColors.call(fake);
      col = fake.colors;
    }
    tColors = eng.paintable.map((t) => { const g = eng.solidGid(t); return { t, rgb: [col[g * 4], col[g * 4 + 1], col[g * 4 + 2]], lab: srgbToOklab(col[g * 4], col[g * 4 + 1], col[g * 4 + 2]) }; });
  };
  await tplReady();
  const dims = () => (st.target === 'current' && ed.map && into) ? [ed.map.width, ed.map.height] : [st.w, Math.max(10, Math.round(st.w * aspect))];
  let sample = null, colors = [], colorTerrain = [], cells = null, locked = null, lockedVal = null, sampleKey = '';
  const pv = h('canvas'), orig = h('canvas');
  const stats = h('div', { class: 'cards' });
  const colorList = h('div');
  const heightList = h('div');
  const view = { show: 'result' };
  const tName = (t) => eng.cn(t);
  const tRGB = (t) => { const c = tColors.find((x) => x.t === t); return c ? c.rgb : [255, 0, 255]; };
  const defaultBands = () => {
    const pick = (...ns) => ns.map((n) => eng.index(n)).find((t) => t >= 0 && eng.paintable.includes(t));
    return [[pick('Water', 'Shallow Water'), 25], [pick('Shallow Water'), 10], [pick('Sand'), 8], [pick('Grass'), 37], [pick('Dirt'), 10], [pick('Dirt Cliff', 'Cliff'), 10]].filter(([t]) => t !== undefined).map(([t, s]) => ({ t, share: s }));
  };
  st.bands = defaultBands();

  const ensureSample = () => {
    const [W, H] = dims();
    const key = [W, H, st.sample, st.blur].join(',');
    if (key === sampleKey) return;
    sampleKey = key;
    sample = sampleImage(bmp, W, H, st.sample, st.blur);
    colors = dominantColors(sample, st.k);
    colorTerrain = suggestTerrains(colors, tColors);
    locked = new Uint8Array(W * H); lockedVal = new Uint8Array(W * H);
    const oc = orig.getContext('2d'); orig.width = W; orig.height = H;
    oc.putImageData(new ImageData(new Uint8ClampedArray(sample.rgba), W, H), 0, 0);
    renderColorList();
  };
  const recompute = () => {
    ensureSample();
    const [W, H] = dims();
    if (st.mode === 'color') {
      if (st.useTargets && Object.keys(st.targets).length) {
        // 在缩小的样本上拟合偏置，再用到全图
        const small = W * H > 160000 ? sampleImage(bmp, Math.round(W / Math.sqrt(W * H / 160000)), Math.round(H / Math.sqrt(W * H / 160000)), st.sample, st.blur) : sample;
        const { bias } = fitCoverage(small, colors, colorTerrain, st.targets, eng.K);
        cells = classifyByColor(sample, colors, colorTerrain, bias);
      } else cells = classifyByColor(sample, colors, colorTerrain, new Float64Array(eng.K));
    } else if (st.mode === 'height') {
      cells = classifyByHeight(sample, st.bands, st.invert);
    } else {
      cells = new Uint8Array(W * H).fill(ed.terrain);
    }
    if (st.mode !== 'trace') {
      if (st.deep) {
        const shallow = eng.index('Shallow Water');
        const deep = ['Water', 'Deep Water'].map((n) => eng.index(n)).find((t) => t >= 0 && eng.paintable.includes(t));
        if (shallow >= 0 && deep !== undefined && deep !== shallow) deepenWater(cells, W, H, new Set([shallow]), deep, Math.max(6, Math.round(Math.min(W, H) / 40)));
      }
      const lv = st.clean;
      for (let i = 0; i < cells.length; i++) if (locked[i]) cells[i] = lockedVal[i];
      if (lv > 0) majority(cells, W, H, lv >= 3 ? 2 : 1, locked);
      if (lv > 0) mergeSmall(cells, W, H, () => [0, 4, 10, 24, 50, 120][lv] * Math.max(1, (W * H) / 160000), locked);
      if (lv > 1) removeThin(cells, W, H, lv >= 4 ? 3 : 2, locked);
    }
    draw(); renderStats();
  };
  const draw = () => {
    const [W, H] = dims();
    pv.width = W; pv.height = H;
    const x = pv.getContext('2d');
    if (view.show === 'orig' || st.mode === 'trace') { x.drawImage(orig, 0, 0); return; }
    const img = new ImageData(W, H), p = img.data;
    const lut = new Map();
    for (let i = 0; i < W * H; i++) {
      const t = cells[i];
      let c = lut.get(t); if (!c) { c = tRGB(t); lut.set(t, c); }
      p[i * 4] = c[0]; p[i * 4 + 1] = c[1]; p[i * 4 + 2] = c[2]; p[i * 4 + 3] = 255;
      if (locked[i] && ((i % W) + ((i / W) | 0)) % 6 === 0) { p[i * 4] = 255; p[i * 4 + 1] = 255; p[i * 4 + 2] = 255; }
    }
    x.putImageData(img, 0, 0);
    if (view.show === 'mix') { x.globalAlpha = 0.5; x.drawImage(orig, 0, 0); x.globalAlpha = 1; }
  };
  const renderStats = () => {
    stats.innerHTML = '';
    if (!cells || st.mode === 'trace') return;
    const sh = shares(cells, eng.K);
    const rows = [...sh.entries()].filter(([, v]) => v > 0.001).sort((a, b) => b[1] - a[1]);
    for (const [t, v] of rows) {
      const want = st.targets[t];
      stats.append(h('div', { class: 'colorrow' }, h('span', { class: 'chip', style: `background:rgb(${tRGB(t)})` }),
        h('div', {}, tName(t), st.useTargets ? h('input', { type: 'range', min: 0, max: 90, value: Math.round((want ?? v) * 100), style: 'width:100%', onchange: (e) => { st.targets[t] = +e.target.value / 100; recompute(); } }) : null),
        h('small', {}, (v * 100).toFixed(1) + '%' + (want !== undefined ? ` → ${(want * 100).toFixed(0)}%` : ''))));
    }
  };
  const renderColorList = () => {
    colorList.innerHTML = '';
    colors.forEach((c, i) => {
      colorList.append(h('div', { class: 'colorrow' }, h('span', { class: 'chip', style: `background:rgb(${c.rgb})` }),
        select(eng.paintable.map((t) => [t, tName(t)]), colorTerrain[i], (v) => { colorTerrain[i] = +v; recompute(); }),
        h('small', {}, (c.share * 100).toFixed(0) + '%')));
    });
  };
  const renderBands = () => {
    heightList.innerHTML = '';
    st.bands.forEach((b, i) => heightList.append(h('div', { class: 'colorrow' }, h('span', { class: 'chip', style: `background:rgb(${tRGB(b.t)})` }),
      select(eng.paintable.map((t) => [t, tName(t)]), b.t, (v) => { b.t = +v; recompute(); renderBands(); }),
      h('input', { type: 'number', min: 0, max: 100, value: b.share, onchange: (e) => { b.share = Math.max(0, +e.target.value); recompute(); } }))));
    heightList.append(h('div', { class: 'row', style: 'margin-top:4px' },
      h('button', { onclick: () => { st.bands.push({ t: eng.paintable[0], share: 10 }); renderBands(); recompute(); } }, '+ 加一段'),
      st.bands.length > 2 ? h('button', { onclick: () => { st.bands.pop(); renderBands(); recompute(); } }, '− 去掉最后一段') : null,
      toggle('黑白反转', st.invert, (v) => { st.invert = v; recompute(); })));
  };
  renderBands();
  // 点预览图改区域
  pv.addEventListener('click', (e) => {
    if (!cells || st.mode === 'trace') return;
    const [W, H] = dims();
    const r = pv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const start = cells[y * W + x];
    const list = h('div', { class: 'menulist' }, h('div', { class: 'mtitle' }, `这块「${tName(start)}」改成：`));
    for (const t of eng.paintable) list.append(h('button', { class: 'mitem', onclick: () => {
      const st2 = [y * W + x], seen = new Uint8Array(W * H); seen[st2[0]] = 1;
      while (st2.length) { const i = st2.pop(); cells[i] = t; locked[i] = 1; lockedVal[i] = t; const xx = i % W; for (const u of [xx > 0 ? i - 1 : -1, xx < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * H - W ? i + W : -1]) if (u >= 0 && !seen[u] && cells[u] === start) { seen[u] = 1; st2.push(u); } }
      closePopover();
      draw(); renderStats();
    } }, h('span', { class: 'mi', html: `<span class="chip" style="display:inline-block;width:14px;height:14px;border-radius:3px;background:rgb(${tRGB(t)})"></span>` }), h('span', { class: 'ml' }, tName(t))));
    const pop = popover(pv, list, {});
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, e.clientX)) + 'px';
    pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, e.clientY)) + 'px';
  });

  const modeSeg = segmented([['color', '颜色'], ['height', '高度'], ['trace', '只描图']], st.mode, (v) => { st.mode = v; colorBox.classList.toggle('hidden', v !== 'color'); heightBox.classList.toggle('hidden', v !== 'height'); traceBox.classList.toggle('hidden', v !== 'trace'); recompute(); });
  const colorBox = h('div', {},
    slider('主色数量', 2, 12, st.k, (v) => { st.k = v; sampleKey = ''; recompute(); }),
    h('div', { class: 'sech' }, h('h3', {}, '每种主色对应的地形')), colorList,
    toggle('按目标占比调整（拖下面的滑杆设定比例）', st.useTargets, (v) => { st.useTargets = v; if (v && cells) { const sh = shares(cells, eng.K); st.targets = {}; sh.forEach((x, t) => { if (x > 0.01) st.targets[t] = x; }); } recompute(); }));
  const heightBox = h('div', { class: 'hidden' }, h('p', { class: 'hint' }, '按亮度从暗到亮分段：越暗越低。右边的数字是每段占的比例（会自动换算成百分比）。'), heightList);
  const traceBox = h('div', { class: 'hidden' }, h('p', { class: 'hint' }, '不自动转换，只把图片半透明叠在地图上，照着手画。适合需要精确控制的情况。'));
  const sizeBox = h('div', { class: into ? 'hidden' : '' }, slider('新地图宽度（格）', 40, 1500, into ? 200 : st.w, (v) => { st.w = v; sampleKey = ''; recompute(); }, { step: 10, fmt: (v) => `${v}×${Math.round(v * aspect)}` }));
  if (into) st.w = 200;
  const ctl = h('div', { class: 'ctl' },
    h('div', { class: 'row' }, h('b', { style: 'flex:1' }, file.name), helpBtn('image2map')),
    into ? h('div', {}, h('label', {}, '转到哪里'), segmented([['current', `当前地图（${ed.map.width}×${ed.map.height}）`], ['new', '新地图']], st.target, (v) => { st.target = v; sampleKey = ''; sizeBox.classList.toggle('hidden', v === 'current'); recompute(); })) : null,
    sizeBox,
    h('label', {}, '模式'), modeSeg, colorBox, heightBox, traceBox,
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '采样与清理')),
    segmented([['smooth', '平滑（照片、截图）'], ['pixel', '像素（像素画）']], st.sample, (v) => { st.sample = v; sampleKey = ''; recompute(); }),
    slider('模糊去噪（JPG 建议 1）', 0, 3, st.blur, (v) => { st.blur = v; sampleKey = ''; recompute(); }),
    slider('干净度（去掉碎块和细条）', 0, 5, st.clean, (v) => { st.clean = v; recompute(); }),
    toggle('远离岸边的水变成深水', st.deep, (v) => { st.deep = v; recompute(); }),
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '当前结果')), stats,
    h('div', { class: 'sech', style: 'margin-top:12px' }, h('h3', {}, '生成后')),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '自动放出生点'), h('input', { type: 'number', min: 0, max: 100, value: st.players, oninput: (e) => { st.players = clamp(+e.target.value || 0, 0, 100); } })),
      h('div', {}, h('label', {}, '每队资源池'), select([0, 1, 2, 3].map((i) => [i, i + ' 个']), st.pools, (v) => { st.pools = +v; }))),
    toggle('保证各出生点陆路互通（不通时铺浅滩或通道）', st.connect, (v) => { st.connect = v; }),
    into ? toggle('清空当前地图原有的物品（资源池、树等）', st.clearItems, (v) => { st.clearItems = v; }) : null,
    h('p', { style: 'color:var(--muted);font-size:12px' }, '提示：在左边预览里点某一块，可以单独改它的地形，改过的地方会锁定（白点），重新计算时保持不变。'));
  const pvWrap = h('div', { class: 'pv' }, pv, h('div', { class: 'pvbar' }, segmented([['result', '结果'], ['mix', '叠加对比'], ['orig', '原图']], view.show, (v) => { view.show = v; draw(); })));
  const body = h('div', { class: 'wiz' }, pvWrap, ctl);
  const pModal = modal('图片转地图', body, [{ label: '取消', value: null }, { label: '生成地图', value: 'go', primary: true }], { full: true, sticky: true });
  await busy('正在分析图片…', async () => recompute());
  const r = await pModal;
  if (r !== 'go') return;
  if (ed.map && st.target === 'current') await autoSnapshot('图片转地图前');
  await busy('正在生成地图…', async () => {
    const [W, H] = dims();
    if (st.target === 'new' || !into) {
      await createNewMap({ name: file.name.replace(/\.[^.]+$/, ''), w: W, h: H, players: 0, pools: 0, center: 0, start: 'blank', base: ed.terrain });
    }
    if (st.mode === 'trace') {
      A.hooks.setReference({ img: bmp, opacity: 0.5, x: 0, y: 0, w: W * 20, h: H * 20, visible: true });
      return;
    }
    const op = ed.begin('图片转地图');
    op.snapV(); op.snapLayer(ed.engine.layer); if (ed.map.items) op.snapLayer(ed.map.items);
    if (st.clearItems && ed.map.items) { ed.map.items.data.fill(0); ed.map.items.flips.clear(); ed.map.items.ver = (ed.map.items.ver || 0) + 1; ed.map.items.dirty = true; }
    applyCells(ed, cells, op);
    if (st.players > 0) {
      const G = ed.unitsGroup(); op.snapshotGroup(G);
      G.objects = G.objects.filter((o) => !o.props.some((q) => q.name === 'unit' && (q.value === 'commandCenter' || q.value === 'builder')));
      const sp = chooseSpawns(ed, st.players, 'none', 7);
      sp.forEach(([x, y], k) => ed.spawnAtCenter(G, x * 20 + 10, y * 20 + 10, k));
      if (st.connect) connectSpawns(ed, op);
      placePoolsAround(ed, op, sp, st.pools, st.center);
    }
    op.markAll();
    ed.commit();
    if (!ed.mapInfo()) ed.ensureMapInfo();
  });
  afterWhole();
  toast('图片已转成地图。可以继续用画笔修改，或用“叠加图”检查通行');
}

// ---------------- 立绘贴图 ----------------
export async function pictureDialog() {
  if (!ed.map) return;
  const file = await pickImage(); if (!file) return;
  let bmp; try { bmp = await createImageBitmap(file); } catch (e) { toast('读不了这张图片'); return; }
  const st = { w: Math.min(40, Math.max(4, Math.round(bmp.width / 20))) };
  let prep = null;
  const info = h('div', { class: 'hint' }, '计算中…');
  const pvc = h('div', { style: 'display:grid;place-items:center;background:#0b0c0f;border-radius:8px;min-height:160px;margin:8px 0' });
  let timer = 0;
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      prep = await preparePicture(bmp, st.w, { name: file.name.replace(/\.[^.]+$/, '') });
      const warn = prep.kb > 800 ? '<br><b style="color:var(--warn)">文件会明显变大，联机时传图会变慢，建议缩小。</b>' : '';
      info.innerHTML = `占 <b>${prep.widthTiles}×${prep.heightTiles}</b> 格；去重后 <b>${prep.count}</b> 个小块；地图文件约增加 <b>${prep.kb} KB</b>。${warn}`;
      pvc.innerHTML = '';
      const c = document.createElement('canvas'); c.width = prep.preview.width; c.height = prep.preview.height;
      c.getContext('2d').drawImage(prep.preview, 0, 0); c.style.maxWidth = '100%'; c.style.maxHeight = '220px';
      pvc.append(c);
    }, 120);
  };
  update();
  const r = await modal('立绘贴图', h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '图片会切成 20×20 的小块嵌进地图（Items 图层）。点“放置”后拖到想放的位置。'), helpBtn('picture')),
    slider('宽度（格）', 2, 120, st.w, (v) => { st.w = v; info.textContent = '计算中…'; update(); }, { fmt: (v) => `${v} 格 = ${v * 20} 像素` }),
    pvc, info), [{ label: '取消', value: null }, { label: '放置', value: 'go', primary: true }]);
  if (r !== 'go') return;
  while (!prep) await new Promise((res) => setTimeout(res, 50));
  const { ts, clip } = await busy('正在嵌入图片…', () => addPictureTileset(ed, prep));
  rend.buildColors();
  A.hooks.startFloating(clip, { label: '放置贴图', onCancel: () => { removeTileset(ed, ts); rend.buildColors(); } });
}

// ---------------- 描图参考图 ----------------
export async function traceDialog() {
  if (!ed.map) return;
  let ref = rend.reference;
  if (!ref) {
    const file = await pickImage(); if (!file) return;
    const img = await createImageBitmap(file);
    const mw = ed.map.width * 20, mh = ed.map.height * 20;
    const s = Math.min(mw / img.width, mh / img.height);
    ref = { img, opacity: 0.5, x: (mw - img.width * s) / 2, y: (mh - img.height * s) / 2, w: img.width * s, h: img.height * s, visible: true, base: s };
    A.hooks.setReference(ref);
  }
  const mw = ed.map.width * 20, mh = ed.map.height * 20;
  const scale0 = ref.w / ref.img.width;
  const upd = () => { rend.request(); };
  await modal('描图参考图', h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '参考图只在编辑器里显示，不会写进地图。'), helpBtn('trace')),
    toggle('显示参考图', ref.visible !== false, (v) => { ref.visible = v; upd(); }),
    slider('透明度', 5, 100, Math.round(ref.opacity * 100), (v) => { ref.opacity = v / 100; upd(); }, { fmt: (v) => v + '%' }),
    slider('大小', 10, 400, Math.round(ref.w / ref.img.width / scale0 * 100), (v) => { const cx = ref.x + ref.w / 2, cy = ref.y + ref.h / 2; ref.w = ref.img.width * scale0 * v / 100; ref.h = ref.img.height * scale0 * v / 100; ref.x = cx - ref.w / 2; ref.y = cy - ref.h / 2; upd(); }, { fmt: (v) => v + '%' }),
    slider('左右位置', -100, 100, Math.round((ref.x + ref.w / 2 - mw / 2) / mw * 100), (v) => { ref.x = mw / 2 + v / 100 * mw - ref.w / 2; upd(); }),
    slider('上下位置', -100, 100, Math.round((ref.y + ref.h / 2 - mh / 2) / mh * 100), (v) => { ref.y = mh / 2 + v / 100 * mh - ref.h / 2; upd(); }),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { onclick: () => { ref.w = mw; ref.h = mh; ref.x = 0; ref.y = 0; upd(); } }, '拉伸铺满地图'),
      h('button', { class: 'danger', onclick: () => { A.hooks.setReference(null); closeModal(); } }, '移除参考图'))),
  [{ label: '完成', value: 1, primary: true }]);
}

// ---------------- 预览图 ----------------
export async function previewDialog() {
  const r = await modal('导出图片', h('div', {},
    h('div', { class: 'cards' },
      h('button', { class: 'acard', onclick: () => closeModal('cover'), html: icon('image') + `<div><b>地图封面（推荐）</b><small>整张地图拍一张照，文件名和地图一样：「${A.mapName}.png」，和地图放在同一个文件夹。保存地图时默认会一起导出。</small></div>` }),
      h('button', { class: 'acard', onclick: () => closeModal(200), html: icon('image') + '<div><b>小预览图 200 像素</b><small>文件名为“地图名_map.png”。</small></div>' }),
      h('button', { class: 'acard', onclick: () => closeModal(500), html: icon('image') + '<div><b>预览图 500 像素</b><small>游戏允许的最大尺寸。</small></div>' }),
      h('button', { class: 'acard', onclick: () => closeModal('poster'), html: icon('poster') + '<div><b>展示图</b><small>带标题、尺寸、人数、资源池和图例的大图，适合发群、发论坛、工坊介绍。</small></div>' }))), []);
  if (r === 'cover') await exportCover();
  else if (r === 'poster') await exportPoster();
  else if (r) await exportPreview(r);
}

// ---------------- 图块素材 ----------------
export async function templateDialog() {
  const { extractTemplate } = await import('./tmx.js');
  const tpl = await kvGet('template');
  const body = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, tpl ? `当前素材来自地图「${tpl.from}」，包含：${tpl.names.join('、')}。` : '还没有图块素材。打开任意一张游戏导出的地图（地面图块集内嵌图片的那种）就会自动取出。'), helpBtn('template')),
    h('p', { style: 'color:var(--muted);font-size:12.5px' }, '新建地图时会用这套素材。素材属于游戏开发商，编辑器只在你的设备上使用，不会上传或分发。'));
  const btns = [{ label: '关闭', value: null }];
  if (ed.map && extractTemplate(ed.map)) btns.push({ label: '改用当前地图的素材', value: 'use', primary: true });
  const r = await modal('图块素材来源', body, btns);
  if (r === 'use') { await kvSet('template', { ...extractTemplate(ed.map), from: A.mapName, time: Date.now() }); toast('已更新图块素材'); }
}

// ---------------- 检查 ----------------
export async function openChecks() {
  if (!ed.map) return;
  const build = () => {
    const list = runChecks(ed, { triggerIssues: A.hooks.triggerIssues ? A.hooks.triggerIssues() : [] });
    const order = { error: 0, warn: 1, info: 2, ok: 3 };
    list.sort((a, b) => order[a.level] - order[b.level]);
    const errs = list.filter((c) => c.level === 'error').length, warns = list.filter((c) => c.level === 'warn').length;
    const body = h('div', {},
      h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1;font-weight:600' }, errs ? `有 ${errs} 个问题会影响游戏，${warns} 个提醒。` : warns ? `没有严重问题，有 ${warns} 个提醒。` : '没发现问题，可以保存后去游戏里试玩了。'), helpBtn('check')));
    for (const c of list) {
      body.append(h('div', { class: 'chk ' + c.level },
        h('div', { class: 'icn' }, { error: '!', warn: '!', ok: '✓', info: 'i' }[c.level]),
        h('div', { style: 'flex:1' }, h('div', { class: 't' }, h('span', { class: 'badge', style: 'margin-right:6px' }, c.cat), c.title), c.detail ? h('div', { class: 'd' }, c.detail) : null,
          (c.goto || c.fix) ? h('div', { class: 'acts' },
            c.goto ? h('button', { onclick: () => { closeModal(); rend.centerOn(c.goto.x, c.goto.y, Math.max(rend.view.z, 1)); } }, '去看看') : null,
            c.fix ? h('button', { class: 'primary', onclick: () => { c.fix.run(); rend.invalidateAll(); A.mini.schedule(); A.autoDirty = true; ed.dirty = true; A.refresh(); const mb = modalBody(); mb.innerHTML = ''; mb.append(build()); } }, c.fix.label) : null) : null)));
    }
    body.append(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { onclick: () => { closeModal(); import('./extras.js').then((m) => m.checklistDialog()); }, html: icon('batch') + ' 试玩检查清单' }), h('button', { onclick: () => { closeModal(); import('./extras.js').then((m) => m.scoreDialog()); }, html: icon('report') + ' 地图体检评分' })));
    const fixes = list.filter((c) => c.fix);
    if (fixes.length > 1) body.append(h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'primary', onclick: async () => {
        const names = fixes.map((f) => f.title).slice(0, 6).join('、') + (fixes.length > 6 ? '…' : '');
        if (!(await confirmBox('一键修复全部？', `会依次修 ${fixes.length} 项：${names}。\n每个修复单独记一步撤销，可以逐步撤回。`, '全部修复', '取消'))) return;
        let n = 0, failed = 0;
        for (const c of fixes) { try { c.fix.run(); n++; } catch (e) { failed++; console.warn('修复失败', c.title, e); } }
        rend.invalidateAll(); A.mini.schedule(); A.autoDirty = true; ed.dirty = true; A.refresh();
        const mb = modalBody(); if (mb) { mb.innerHTML = ''; mb.append(build()); }
        toast(`已执行 ${n} 个修复${failed ? `，${failed} 个失败（见控制台）` : ''}`, 3200);
      }, html: icon('inspect') + ` 一键修复全部（${fixes.length} 项）` })));
    body.append(h('p', { style: 'color:var(--muted);font-size:12px' }, '检查项来自社区整理的游戏规则，最终以游戏里实际打开为准。'));
    return body;
  };
  await modal('能玩吗？', build(), [{ label: '关闭', value: 1, primary: true }]);
  A.hooks.coach && A.hooks.coach('checked');
}

// ---------------- 设置 ----------------
export async function settingsDialog() {
  const s = A.settings;
  const I = await import('./i18n.js');
  const langSel = h('select', { translate: 'no', onchange: (e) => { I.setLang(e.target.value); location.reload(); } },
    I.LANGS.map(([k, n]) => h('option', { value: k, selected: k === I.getLang() }, n)));
  await modal('设置', h('div', {},
    h('label', { translate: 'no' }, '界面语言 · Language'), langSel,
    toggle('启动时自动检查新版本', (() => { try { return localStorage.getItem('rwNoUpdate') !== '1'; } catch { return true; } })(), (v) => { try { localStorage.setItem('rwNoUpdate', v ? '0' : '1'); } catch { /* */ } }),
    toggle('显示网格（放大时）', s.grid, (v) => { s.grid = v; rend.showGrid = v; rend.request(); saveSettings(); }),
    toggle('保存时去掉没用到的图块集（地图更小）', s.prune, (v) => { s.prune = v; saveSettings(); }),
    toggle('色盲友好配色（叠加图用橙 / 蓝代替红 / 绿）', !!s.colorblind, (v) => { s.colorblind = v; saveSettings(); if (A.overlayKind !== 'none') A.hooks.setOverlay(A.overlayKind); }),
    h('div', { class: 'row', style: 'margin:6px 0' }, h('button', { onclick: () => import('./extras.js').then((m) => m.exportUserData()), html: icon('export') + ' 导出个人数据' }), h('button', { onclick: () => import('./extras.js').then((m) => m.importUserData()), html: icon('import') + ' 导入个人数据' }), helpBtn('tool.userdata')),
    toggle('保存地图时一起导出封面（地图名.png）', s.cover !== false, (v) => { s.cover = v; saveSettings(); }),
    slider('封面大小（长边像素）', 200, 1000, s.coverSize || 400, (v) => { s.coverSize = v; saveSettings(); }, { step: 50 }),
    h('label', {}, '资源池默认样式'), segmented([['1x1', '1 格（推荐）'], ['3x3', '3×3 带边框']], s.poolStyle || '1x1', (v) => { s.poolStyle = v; ed.poolStyle = v; saveSettings(); A.refresh('dock'); }),
    slider('自动保存间隔（秒）', 10, 120, s.autosaveSec, (v) => { s.autosaveSec = v; saveSettings(); A.hooks.resetAutosave && A.hooks.resetAutosave(); }, { step: 5 }),
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { onclick: async () => { const { forgetGameFolder } = await import('./files.js'); await forgetGameFolder(); toast('已忘记游戏文件夹'); } }, '重新选择游戏文件夹'),
      h('button', { onclick: async () => { await kvSet('tutorialDone', false); toast('下次打开会再次提示新手教程'); } }, '重置新手教程')),
    h('p', { style: 'color:var(--muted);font-size:12px;margin-top:14px' }, `铁锈地图编辑器 ${(await import('./version.js')).VERSION} · 非官方工具 · 图块素材来自你自己的地图文件`)),
  [{ label: '完成', value: 1, primary: true }]);
}
export async function loadSettings() { const s = await kvGet('settings'); if (s) Object.assign(A.settings, s); rend.showGrid = A.settings.grid; }
export function saveSettings() { kvSet('settings', A.settings); }

export { balanceReport, MAP_TYPES, NONE, loadMapFromText };
