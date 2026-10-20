// 应用入口：界面、手势、菜单
import { RWMap, newMapFromTemplate, extractTemplate, objProp } from './tmx.js';
import { Editor, ITEM_CN, UNIT_CN } from './editor.js';
import { Renderer, Minimap, teamColor } from './render.js';
import { runChecks, poolReport, renderPreview, sizeTier, MAP_TYPES } from './check.js';
import { pickFile, saveFile, nativePlugin, isNative } from './files.js';
import { kvGet, kvSet, kvDel, clamp } from './util.js';
import { icon, toast, busy, h, modal, closeModal, confirmBox } from './ui.js';
import { NONE, TERRAIN_CN } from './terrain.js';

const $ = (id) => document.getElementById(id);
const ed = new Editor();
const cv = $('cv');
const rend = new Renderer(cv, ed);
const mini = new Minimap($('mini'), rend);
let fileHandle = null;
let mapName = '';
let autoDirty = false;
let saving = false;
let hover = null; // {mx, my}
let shapePreview = null;
let coachStep = 0;

const MODES = [
  { id: 'terrain', label: '地形', icon: 'terrain' },
  { id: 'items', label: '物品', icon: 'items' },
  { id: 'units', label: '单位', icon: 'units' },
  { id: 'triggers', label: '规则', icon: 'rules' },
  { id: 'tiles', label: '图块', icon: 'tiles', expert: true },
];
const TOOLS = {
  terrain: [['brush', '画笔'], ['rect', '矩形'], ['ellipse', '椭圆'], ['pick', '吸管'], ['pan', '拖动']],
  items: [['stamp', '放置'], ['erase', '橡皮'], ['pan', '拖动']],
  units: [['spawn', '出生点'], ['unit', '放单位'], ['select', '选择'], ['del', '删除'], ['pan', '拖动']],
  triggers: [['select', '选择'], ['pan', '拖动']],
  tiles: [['brush', '画图块'], ['erase', '橡皮'], ['pick', '吸管'], ['pan', '拖动']],
};
const TOOL_ICON = { brush: 'brush', rect: 'rect', ellipse: 'ellipse', pick: 'pick', pan: 'pan', stamp: 'stamp', erase: 'erase', spawn: 'spawn', unit: 'unit', select: 'select', del: 'del' };
const SYM = [['none', '无'], ['lr', '左右'], ['tb', '上下'], ['rot', '中心'], ['quad', '四向']];

// ---------------- 启动 ----------------
function init() {
  $('btnMenu').innerHTML = icon('menu');
  $('btnUndo').innerHTML = icon('undo');
  $('btnRedo').innerHTML = icon('redo');
  const nav = $('modes');
  for (const m of MODES) {
    nav.append(h('button', { class: 'mode' + (m.expert ? ' expert' : ''), 'data-mode': m.id, title: m.expert ? '专家：直接放任意图块' : '', onclick: () => setMode(m.id), html: icon(m.icon) + `<span>${m.label}</span>` }));
  }
  $('btnMenu').onclick = openMenu;
  $('btnUndo').onclick = () => { ed.undo(); };
  $('btnRedo').onclick = () => { ed.redo(); };
  $('btnSave').onclick = () => saveMap();
  $('btnCheck').onclick = () => openChecks();
  $('mapName').onclick = renameMap;
  $('panelHandle').onclick = () => $('panel').classList.toggle('collapsed');

  ed.on(onEditorEvent);
  rend.overlay = drawOverlay;
  rend.onDraw = () => mini.draw();
  new ResizeObserver(() => { rend.resize(); }).observe($('stage'));
  setupPointer();
  setupMinimap();
  setupKeys();
  setupBack();
  setInterval(autosave, 30000);
  window.addEventListener('beforeunload', (e) => { if (ed.dirty && !isNative()) { e.preventDefault(); e.returnValue = ''; } });
  updateTop();
  setMode('terrain');
  startup();
  window.__rw = { ed, rend, loadMapFromText, newMap: generateMap, runChecks: () => runChecks(ed), serialize: () => ed.map.serialize(), poolReport: () => poolReport(ed) };
}

async function startup() {
  const auto = await kvGet('autosave');
  if (auto && auto.text) {
    const when = new Date(auto.time).toLocaleString();
    const ok = await confirmBox('恢复上次的地图？', `发现一份自动保存的「${auto.name || '未命名'}」（${when}）。上次可能没来得及保存。`, '恢复', '不用了');
    if (ok) {
      await busy('正在恢复…', () => loadMapFromText(auto.text, auto.name));
      ed.dirty = true;
      updateTop();
      return;
    }
    await kvDel('autosave');
  }
  showWelcome();
}

async function showWelcome() {
  const w = $('welcome');
  const tpl = await kvGet('template');
  w.innerHTML = '';
  w.append(h('div', { class: 'w' },
    h('h1', {}, '铁锈地图编辑器'),
    h('p', {}, tpl ? '打开一张地图继续编辑，或者新建一张。' : '第一次使用：先打开一张你已有的铁锈战争地图（.tmx）。编辑器会从里面取出图块素材，之后新建地图就用这套素材。'),
    h('div', { class: 'acts' },
      h('button', { class: 'primary', onclick: openMap }, '打开地图'),
      h('button', { onclick: newMapDialog, disabled: !tpl }, tpl ? '新建地图' : '新建地图（需先打开一张地图）'),
      h('button', { onclick: showHelp }, '怎么用？')),
    h('div', { class: 'note' }, '非官方工具。图块素材来自你自己的地图文件，编辑器本身不附带游戏素材。')));
  w.classList.remove('hidden');
}

// ---------------- 地图载入 ----------------
async function loadMapFromText(text, name, handle = null) {
  const map = await RWMap.parse(text, name);
  ed.setMap(map);
  rend.setMap(map);
  mini.rebuild();
  mapName = (name || '未命名').replace(/\.tmx$/i, '');
  fileHandle = handle;
  $('welcome').classList.add('hidden');
  const tpl = extractTemplate(map);
  if (tpl && !(await kvGet('template'))) {
    await kvSet('template', { ...tpl, from: mapName, time: Date.now() });
    toast('已从这张地图取出图块素材，以后新建地图会用它');
  }
  if (!ed.engine) toast('这张地图的地面图块没有地形标注，自动过渡不可用，可以用“图块”模式直接画', 4000);
  updateTop();
  renderPanel();
  return map;
}

async function openMap() {
  if (ed.dirty && !(await confirmBox('打开别的地图？', '当前地图还没保存，打开新地图会丢掉未保存的修改。', '仍然打开'))) return;
  const r = await pickFile('.tmx');
  if (!r) return;
  try {
    await busy('正在读取地图…', async () => {
      const text = await r.file.text();
      await loadMapFromText(text, r.file.name, r.handle);
    });
    await kvDel('autosave');
  } catch (e) {
    console.error(e);
    modal('打不开这个文件', h('p', {}, e.message || String(e)), [{ label: '知道了', value: true, primary: true }]);
  }
}

// ---------------- 顶栏与模式 ----------------
function updateTop() {
  const m = ed.map;
  $('mapName').textContent = m ? (mapName || '未命名') + (ed.dirty ? ' •' : '') : '铁锈地图编辑器';
  if (m) {
    const t = sizeTier(m.width, m.height);
    const c = t.level === 'ok' ? 'var(--ok)' : t.level === 'warn' ? 'var(--warn)' : 'var(--err)';
    $('mapSize').innerHTML = `<span class="tier" style="background:${c}" title="${t.text}"></span>${m.width}×${m.height} 格`;
  } else $('mapSize').textContent = '';
  $('btnUndo').disabled = !ed.undoStack.length;
  $('btnRedo').disabled = !ed.redoStack.length;
  for (const id of ['btnSave', 'btnCheck']) $(id).disabled = !m;
}

function setMode(mode) {
  ed.mode = mode;
  ed.showTriggers = mode === 'triggers';
  ed.selected = null;
  for (const b of document.querySelectorAll('.mode')) b.classList.toggle('on', b.dataset.mode === mode);
  renderPanel();
  rend.request();
}
const tool = () => ed.tool[ed.mode];
function setTool(t) { ed.tool[ed.mode] = t; renderPanel(); rend.request(); }

function onEditorEvent(ev) {
  if (ev === 'edit') { autoDirty = true; updateTop(); mini.schedule(); coachEdit(); return; }
  if (ev === 'palette') { renderPanel(); return; }
  if (ev && ev.type === 'changed') {
    if (ev.box) rend.invalidate(ev.box.x0 - 1, ev.box.y0 - 1, ev.box.x1 + 1, ev.box.y1 + 1); else rend.request();
    autoDirty = true; updateTop(); mini.schedule(); renderPanel();
  }
}

// ---------------- 面板 ----------------
function tileThumb(gid, size = 40) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ts = ed.map && ed.map.tilesetOf(gid);
  if (ts && ts.image) {
    const id = gid - ts.firstgid, x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.fillStyle = '#0c0d10'; x.fillRect(0, 0, size, size);
    x.drawImage(ts.image, (id % ts.columns) * ts.tw, Math.floor(id / ts.columns) * ts.th, ts.tw, ts.th, 0, 0, size, size);
  }
  return c;
}

function toolRow() {
  const list = TOOLS[ed.mode];
  return h('div', { class: 'tools' }, list.map(([id, label]) =>
    h('button', { class: 'tool' + (tool() === id ? ' on' : ''), onclick: () => setTool(id), title: label, html: icon(TOOL_ICON[id]) + `<span>${label}</span>` })));
}
function sizeRow(max = 64) {
  const out = h('output', {}, ed.size);
  const inp = h('input', { type: 'range', min: 1, max, value: ed.size, oninput: (e) => { ed.size = +e.target.value; out.textContent = ed.size; rend.request(); } });
  return h('div', { class: 'sec' }, h('h3', {}, '笔刷大小'), h('div', { class: 'range' }, inp, out),
    h('div', { class: 'row', style: 'margin-top:6px' }, segmented([['circle', '圆形'], ['square', '方形']], ed.shape, (v) => { ed.shape = v; rend.request(); })));
}
function segmented(opts, cur, on) {
  const s = h('div', { class: 'seg' });
  for (const [v, l] of opts) {
    s.append(h('button', { class: v === cur ? 'on' : '', onclick: (e) => { on(v); for (const b of s.children) b.classList.toggle('on', b === e.currentTarget); } }, l));
  }
  return s;
}
function symRow() {
  return h('div', { class: 'sec' }, h('h3', {}, '对称绘制'),
    segmented(SYM, ed.sym, (v) => { ed.sym = v; rend.request(); }));
}

function renderPanel() {
  const body = $('panelBody');
  body.innerHTML = '';
  if (!ed.map) { body.append(h('div', { class: 'hint' }, '还没有打开地图。点左上角菜单「打开地图」或「新建地图」。')); return; }
  body.append(h('div', { class: 'sec' }, toolRow()));
  const f = { terrain: panelTerrain, items: panelItems, units: panelUnits, triggers: panelRules, tiles: panelTiles }[ed.mode];
  f(body);
}

function panelTerrain(body) {
  const eng = ed.engine;
  if (!eng) { body.append(h('div', { class: 'hint' }, '这张地图的地面图块集没有地形标注，无法自动过渡。请用左下角的「图块」模式直接放图块。')); return; }
  const sw = h('div', { class: 'swatches' });
  for (const t of eng.paintable) {
    const gid = eng.ts.firstgid + eng.lut[eng.key(t, t, t, t)];
    sw.append(h('button', { class: 'sw' + (ed.terrain === t ? ' on' : ''), title: eng.name(t), onclick: () => { ed.terrain = t; if (tool() === 'pick') ed.tool.terrain = 'brush'; renderPanel(); } },
      tileThumb(gid), eng.cn(t)));
  }
  body.append(h('div', { class: 'sec' }, h('h3', {}, '选择地形'), sw));
  if (tool() === 'brush') body.append(sizeRow(64));
  body.append(symRow());
  const t = ed.terrain;
  const neigh = eng.paintable.filter((u) => u !== t && eng.adj[t][u]).map((u) => eng.cn(u));
  if (/cliff/i.test(eng.name(t))) body.append(h('div', { class: 'hint', style: 'margin-bottom:10px;border-color:#6b4321', html: `「${eng.cn(t)}」画出来的<b>内部和普通地面一样</b>，只有边缘才显示成悬崖，单位过不去的是边缘。` }));
  body.append(h('div', { class: 'hint', html:
    `画的时候会<b>自动加过渡</b>。「${eng.cn(t)}」能直接挨着：${neigh.join('、') || '（无）'}。挨着别的地形时，会自动垫一圈中间地形，比如草地和水之间会出现泥土、沙地和浅滩。<br>双指捏合缩放、双指拖动平移；电脑上用滚轮缩放、右键拖动平移。` }));
}

function panelItems(body) {
  if (!ed.itemsTs) { body.append(h('div', { class: 'hint' }, '这张地图没有物品图块集（export_items），无法放置资源池等物品。')); return; }
  const sw = h('div', { class: 'swatches' });
  for (const it of ed.items) {
    const gid = it.stamp ? it.stamp[1][1] : it.rep;
    sw.append(h('button', { class: 'sw' + (ed.itemKey === it.key ? ' on' : ''), title: it.name, onclick: () => { ed.itemKey = it.key; ed.tool.items = 'stamp'; renderPanel(); } },
      tileThumb(gid), it.cn));
  }
  body.append(h('div', { class: 'sec' }, h('h3', {}, '选择物品'), sw));
  const it = ed.item();
  if (tool() === 'erase' || (it && !it.stamp)) body.append(sizeRow(16));
  body.append(symRow());
  const pools = ed.poolTiles().length;
  body.append(h('div', { class: 'hint', html: (it && it.stamp ? `「${it.cn}」占 3×3 格，点一下放一个。` : '按住拖动可以连续画。') +
    `<br>地图上现在有 <b>${pools}</b> 个资源池。资源池和单位之间最好留 1 格空隙。` }));
}

function teamSelect(cur, on, withNeutral = true) {
  const s = h('select', { onchange: (e) => on(+e.target.value) });
  if (withNeutral) s.append(h('option', { value: -1 }, '中立'));
  for (let t = 0; t < 20; t++) s.append(h('option', { value: t, selected: +cur === t }, `第 ${t + 1} 队`));
  if (+cur === -1) s.value = '-1';
  return s;
}

function panelUnits(body) {
  const T = tool();
  if (T === 'unit') {
    const us = h('select', { onchange: (e) => { ed.unitName = e.target.value; } });
    for (const u of ed.unitNames) us.append(h('option', { value: u, selected: u === ed.unitName }, (UNIT_CN[u] ? UNIT_CN[u] + ' · ' : '') + u));
    body.append(h('div', { class: 'sec grid2' },
      h('div', {}, h('label', {}, '单位'), us),
      h('div', {}, h('label', {}, '队伍'), teamSelect(ed.team, (v) => { ed.team = v; }))));
  }
  if (T === 'spawn') body.append(h('div', { class: 'hint', html: '点一下地图放一个<b>出生点</b>：1 个指挥中心 + 2 个建造者，队伍号自动往后排。开了对称时会同时放好对称的出生点。' }));
  body.append(symRow());
  const o = ed.selected;
  if (o) {
    const unit = objProp(o, 'unit') || o.attrs.name || '对象';
    body.append(h('div', { class: 'sec card' },
      h('h3', {}, '选中的单位'),
      h('div', {}, (UNIT_CN[unit] ? UNIT_CN[unit] + ' · ' : '') + unit),
      h('div', { style: 'color:var(--muted);font-size:12px;margin:4px 0' }, `格子坐标 (${Math.floor(+o.attrs.x / 20)}, ${Math.floor((+o.attrs.y - 1) / 20)})`),
      h('label', {}, '队伍'), teamSelect(objProp(o, 'team') ?? -1, (v) => { ed.setTeam(o, v); renderPanel(); }),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { onclick: () => { ed.begin('删除单位'); ed.deleteObject(o); ed.commit(); ed.selected = null; rend.request(); renderPanel(); } }, '删除'))));
  }
  // 队伍一览
  const rows = poolReport(ed, 25);
  const tb = h('table', { class: 'rep' }, h('tr', {}, h('th', {}, '队伍'), h('th', {}, '25 格内资源池'), h('th', {}, '最近资源池')));
  for (const r of rows) tb.append(h('tr', {}, h('td', { html: `<span class="teamdot" style="background:${teamColor(r.team)}"></span>${r.team >= 0 ? '第 ' + (r.team + 1) + ' 队' : '中立'}` }), h('td', {}, r.near), h('td', {}, r.nearest === null ? '—' : r.nearest + ' 格')));
  body.append(h('div', { class: 'sec' }, h('h3', {}, `出生点（${rows.length} 个）`), rows.length ? tb : h('div', { class: 'hint' }, '还没有出生点。'),
    h('div', { style: 'font-size:11.5px;color:var(--muted);margin-top:4px' }, '距离按直线估算，不考虑绕路。')));
}

function panelRules(body) {
  const mi = ed.mapInfo();
  const card = h('div', { class: 'sec card' }, h('h3', {}, '地图规则（map_info）'));
  if (!mi) {
    card.append(h('div', { class: 'hint' }, '这张地图还没有 map_info。游戏需要它来识别遭遇战地图并在结束时结算。'),
      h('button', { class: 'primary', style: 'margin-top:8px', onclick: () => { ed.ensureMapInfo(); renderPanel(); rend.request(); } }, '添加 map_info'));
    body.append(card);
    return;
  }
  const typeSel = h('select', { onchange: (e) => ed.setMapInfoProp('type', e.target.value) });
  const cur = objProp(mi, 'type') || '';
  const names = { skirmish: '遭遇战 skirmish', mission: '任务 mission', challenge: '挑战 challenge', survival: '生存 survival', endless: '无尽 endless' };
  for (const t of MAP_TYPES) typeSel.append(h('option', { value: t, selected: t === cur }, names[t]));
  if (cur && !MAP_TYPES.includes(cur)) typeSel.append(h('option', { value: cur, selected: true }, cur));
  const intro = h('textarea', { placeholder: '开局时显示给玩家的说明（可不填）', onchange: (e) => ed.setMapInfoProp('introText', e.target.value) });
  intro.value = objProp(mi, 'introText') || '';
  card.append(h('label', {}, '地图类型'), typeSel, h('label', {}, '开局提示 introText'), intro);
  // 其他属性
  const others = mi.props.filter((p) => !['type', 'introText'].includes(p.name));
  card.append(h('label', {}, '其他属性（社区整理，不保证游戏都支持）'));
  for (const p of others) {
    const v = h('input', { value: p.value, onchange: (e) => ed.setMapInfoProp(p.name, e.target.value) });
    card.append(h('div', { class: 'kv' }, h('input', { value: p.name, disabled: true }), v, h('button', { title: '删除', onclick: () => { ed.setMapInfoProp(p.name, ''); renderPanel(); } }, '✕')));
  }
  const kn = h('input', { placeholder: '属性名，如 fog', list: 'mikeys' });
  const kvv = h('input', { placeholder: '值' });
  card.append(h('datalist', { id: 'mikeys' }, ['fog', 'winCondition', 'credits', 'nukes'].map((k) => h('option', { value: k }))));
  card.append(h('div', { class: 'kv' }, kn, kvv, h('button', { onclick: () => { if (kn.value.trim()) { ed.setMapInfoProp(kn.value.trim(), kvv.value); renderPanel(); } } }, '添加')));
  body.append(card);
  const T = ed.map.group('Triggers');
  const n = T ? T.objects.length : 0;
  body.append(h('div', { class: 'hint' }, `Triggers 层共有 ${n} 个对象（包括 map_info），在这个模式下会显示在地图上，可以选中、拖动或删除。普通遭遇战一般只需要 map_info。`));
  if (ed.selected) body.append(h('div', { class: 'sec card' }, h('div', {}, '选中：' + (ed.selected.attrs.name || ed.selected.attrs.type || '对象')),
    h('button', { style: 'margin-top:6px', onclick: () => { ed.begin('删除对象'); ed.deleteObject(ed.selected); ed.commit(); ed.selected = null; renderPanel(); rend.request(); } }, '删除')));
}

function panelTiles(body) {
  const m = ed.map;
  const lsel = h('select', { onchange: (e) => { ed.rawLayer = e.target.value; } });
  for (const L of m.layers) lsel.append(h('option', { value: L.name, selected: L.name === ed.rawLayer }, L.name));
  if (!m.layer(ed.rawLayer) && m.layers[0]) ed.rawLayer = m.layers[0].name;
  const sets = m.tilesets.filter((t) => t.image);
  if (!ed.rawTs || !sets.includes(ed.rawTs)) ed.rawTs = sets[0] || null;
  const tsel = h('select', { onchange: (e) => { ed.rawTs = sets[+e.target.value]; renderPanel(); } });
  sets.forEach((t, i) => tsel.append(h('option', { value: i, selected: t === ed.rawTs }, `${t.name}（${t.tilecount} 块）`)));
  body.append(h('div', { class: 'sec grid2' }, h('div', {}, h('label', {}, '画到图层'), lsel), h('div', {}, h('label', {}, '图块集'), tsel)));
  if (ed.rawTs) {
    const ts = ed.rawTs;
    const scale = Math.max(1, Math.min(2, Math.floor(272 / ts.image.width) || 1));
    const c = h('canvas', { class: 'tilegrid' });
    c.width = ts.image.width * scale; c.height = Math.min(ts.image.height, 4000) * scale;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    x.drawImage(ts.image, 0, 0, c.width, c.height);
    const mark = () => {
      x.imageSmoothingEnabled = false; x.drawImage(ts.image, 0, 0, c.width, c.height);
      const id = ed.rawGid - ts.firstgid;
      if (id >= 0 && id < ts.tilecount) { x.strokeStyle = '#ffb27a'; x.lineWidth = 2; x.strokeRect((id % ts.columns) * ts.tw * scale + 1, Math.floor(id / ts.columns) * ts.th * scale + 1, ts.tw * scale - 2, ts.th * scale - 2); }
    };
    mark();
    c.onclick = (e) => {
      const r = c.getBoundingClientRect();
      const px = (e.clientX - r.left) * c.width / r.width / scale, py = (e.clientY - r.top) * c.height / r.height / scale;
      const id = Math.floor(py / ts.th) * ts.columns + Math.floor(px / ts.tw);
      if (id >= 0 && id < ts.tilecount) { ed.rawGid = ts.firstgid + id; ed.tool.tiles = 'brush'; mark(); }
    };
    body.append(h('div', { class: 'sec' }, h('h3', {}, '点选一个图块'), c));
  }
  body.append(sizeRow(16));
  body.append(h('div', { class: 'hint' }, '专家模式：直接放图块，不会自动加过渡。用来放装饰、修补个别格子，或者编辑没有地形标注的地图。'));
}

// ---------------- 手势 ----------------
function canvasPos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
const ptrs = new Map();
let g = null; // 当前手势
let spaceDown = false;

function setupPointer() {
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    if (!ed.map) return;
    cv.setPointerCapture(e.pointerId);
    const p = canvasPos(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 2) { startPinch(); return; }
    if (ptrs.size > 2) return;
    if (e.button === 1 || e.button === 2 || spaceDown || tool() === 'pan') { g = { kind: 'pan', sx: p.x, sy: p.y, ox: rend.view.ox, oy: rend.view.oy }; return; }
    if (e.pointerType === 'touch') { g = { kind: 'pending', p, t0: performance.now(), timer: setTimeout(() => { if (g && g.kind === 'pending') startTool(g.p); }, 90) }; return; }
    startTool(p);
  });
  cv.addEventListener('pointermove', (e) => {
    const p = canvasPos(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    if (!ed.map) return;
    const mp = rend.toMap(p.x, p.y);
    hover = e.pointerType === 'touch' ? null : mp;
    updateStatus(mp);
    if (!g) { if (e.pointerType !== 'touch') rend.request(); return; }
    if (g.kind === 'pinch') { movePinch(); return; }
    if (g.kind === 'pan') { rend.view.ox = g.ox - (p.x - g.sx) / rend.view.z; rend.view.oy = g.oy - (p.y - g.sy) / rend.view.z; rend.request(); return; }
    if (g.kind === 'pending') { if (Math.hypot(p.x - g.p.x, p.y - g.p.y) > 6) { clearTimeout(g.timer); const s = g.p; startTool(s); moveTool(p); } return; }
    moveTool(p);
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (!g) return;
    if (g.kind === 'pinch') { if (ptrs.size === 0) g = null; return; }
    if (g.kind === 'pending') { clearTimeout(g.timer); const s = g.p; startTool(s); endTool(s); g = null; return; }
    if (g.kind === 'pan') { g = null; return; }
    endTool(canvasPos(e));
    g = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); if (g && g.kind !== 'pinch') { cancelTool(); } if (!ptrs.size) g = null; });
  cv.addEventListener('pointerleave', () => { hover = null; rend.request(); });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!ed.map) return;
    const p = canvasPos(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) rend.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    else { rend.view.ox += e.deltaX / rend.view.z; rend.request(); }
  }, { passive: false });
}

function startPinch() {
  if (g && g.kind === 'pending') clearTimeout(g.timer);
  if (g && g.kind === 'tool') {
    if (performance.now() - g.t0 < 300) cancelTool(); else endTool(null);
  }
  const [a, b] = [...ptrs.values()];
  g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: rend.view.z, c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, m0: rend.toMap((a.x + b.x) / 2, (a.y + b.y) / 2) };
}
function movePinch() {
  const pts = [...ptrs.values()];
  if (pts.length < 2) return;
  const [a, b] = pts;
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const v = rend.view;
  v.z = clamp(g.z0 * d / g.d0, 0.002, 8);
  v.ox = g.m0.x - c.x / v.z; v.oy = g.m0.y - c.y / v.z;
  rend.request();
}

const vpos = (mp) => ({ x: mp.x / ed.map.tw, y: mp.y / ed.map.th });
const tpos = (mp) => ({ x: Math.floor(mp.x / ed.map.tw), y: Math.floor(mp.y / ed.map.th) });

function flush() {
  const op = ed.op;
  if (op && op.recent) { const r = op.recent; rend.invalidate(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1); op.recent = null; }
  else rend.request();
}

function startTool(p) {
  const mp = rend.toMap(p.x, p.y);
  const T = tool(), mode = ed.mode;
  g = { kind: 'tool', t0: performance.now(), start: mp, last: mp };
  if (mode === 'terrain') {
    if (!ed.engine) { toast('这张地图不支持地形画笔，请用“图块”模式'); g = null; return; }
    if (T === 'brush') { ed.begin('画地形'); const v = vpos(mp); ed.paintTerrainAt(v.x, v.y); g.lastV = v; flush(); }
    else if (T === 'rect' || T === 'ellipse') { g.shape = T; shapePreview = { kind: T, a: vpos(mp), b: vpos(mp) }; rend.request(); }
    else if (T === 'pick') { const v = vpos(mp); ed.pickTerrain(v.x, v.y); g = null; toast('已选中：' + ed.engine.cn(ed.terrain)); }
  } else if (mode === 'items') {
    if (T === 'stamp') { ed.begin('放物品'); const t = tpos(mp); ed.placeItemAt(t.x, t.y); g.lastT = t; flush(); }
    else if (T === 'erase') { ed.begin('擦除物品'); const t = tpos(mp); ed.eraseAt(ed.map.ensureLayer('Items'), t.x, t.y); g.lastT = t; flush(); }
  } else if (mode === 'units' || mode === 'triggers') {
    if (T === 'select') {
      const hit = ed.hitObject(mp.x, mp.y);
      ed.selected = hit ? hit.o : null;
      if (hit) { ed.begin('移动单位'); ed.op.snapshotGroup(hit.G); g.drag = { o: hit.o, x0: +hit.o.attrs.x, y0: +hit.o.attrs.y }; }
      renderPanel(); rend.request();
    }
  } else if (mode === 'tiles') {
    const L = ed.map.layer(ed.rawLayer) || ed.map.ground;
    const t = tpos(mp);
    if (T === 'brush') { if (!ed.rawGid) { toast('先在右边点选一个图块'); g = null; return; } ed.begin('放图块'); ed.rawPaintAt(t.x, t.y); g.lastT = t; flush(); }
    else if (T === 'erase') { ed.begin('擦除图块'); ed.eraseAt(L, t.x, t.y); g.lastT = t; flush(); }
    else if (T === 'pick') { if (t.x >= 0 && t.y >= 0 && t.x < ed.map.width && t.y < ed.map.height) { ed.rawGid = L.data[t.y * ed.map.width + t.x]; ed.rawTs = ed.map.tilesetOf(ed.rawGid) || ed.rawTs; ed.tool.tiles = 'brush'; renderPanel(); } g = null; }
  }
}

function moveTool(p) {
  if (!g || g.kind !== 'tool') return;
  const mp = rend.toMap(p.x, p.y);
  const T = tool(), mode = ed.mode;
  if (mode === 'terrain' && T === 'brush' && ed.op) {
    const v = vpos(mp), l = g.lastV;
    const dist = Math.hypot(v.x - l.x, v.y - l.y);
    const step = Math.max(0.5, ed.size / 3);
    if (dist < step) return;
    const n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) ed.paintTerrainAt(l.x + (v.x - l.x) * i / n, l.y + (v.y - l.y) * i / n);
    g.lastV = v; flush();
  } else if (mode === 'terrain' && g.shape) {
    shapePreview.b = vpos(mp); rend.request();
  } else if ((mode === 'items' || mode === 'tiles') && ed.op && g.lastT) {
    const t = tpos(mp), l = g.lastT;
    const it = ed.item();
    const minStep = mode === 'items' && T === 'stamp' && it && it.stamp ? 3 : 1;
    const d = Math.max(Math.abs(t.x - l.x), Math.abs(t.y - l.y));
    if (d < minStep) return;
    const n = Math.ceil(d / minStep);
    for (let i = 1; i <= n; i++) {
      const x = Math.round(l.x + (t.x - l.x) * i / n), y = Math.round(l.y + (t.y - l.y) * i / n);
      if (mode === 'items') { if (T === 'stamp') ed.placeItemAt(x, y); else ed.eraseAt(ed.map.ensureLayer('Items'), x, y); }
      else if (T === 'brush') ed.rawPaintAt(x, y);
      else ed.eraseAt(ed.map.layer(ed.rawLayer) || ed.map.ground, x, y);
    }
    g.lastT = t; flush();
  } else if (g.drag) {
    const o = g.drag.o;
    const dx = Math.round(mp.x - g.start.x), dy = Math.round(mp.y - g.start.y);
    o.attrs.x = (g.drag.x0 + dx).toFixed(1); o.attrs.y = (g.drag.y0 + dy).toFixed(1);
    g.moved = true;
    rend.request();
  }
}

function endTool(p) {
  if (!g || g.kind !== 'tool') return;
  const T = tool(), mode = ed.mode;
  if (mode === 'terrain' && g.shape && p) {
    const b = vpos(rend.toMap(p.x, p.y));
    ed.begin(g.shape === 'rect' ? '画矩形' : '画椭圆');
    busyIfLarge(() => { ed.paintTerrainShape(g.shape, [shapePreview.a.x, shapePreview.a.y], [b.x, b.y]); });
    shapePreview = null;
    flush();
  } else if ((mode === 'units') && (T === 'spawn' || T === 'unit' || T === 'del') && p) {
    const mp = rend.toMap(p.x, p.y);
    const t = tpos(mp);
    if (T === 'spawn') { ed.begin('放出生点'); const teams = ed.addSpawnAt(t.x, t.y); toast('已放置：' + teams.map((x) => `第 ${x + 1} 队`).join('、')); }
    else if (T === 'unit') { ed.begin('放单位'); ed.addUnitAt(t.x, t.y); }
    else { const hit = ed.hitObject(mp.x, mp.y); if (hit) { ed.begin('删除单位'); ed.deleteObject(hit.o); } }
    rend.request();
  }
  if (g.drag && !g.moved) { ed.op = null; } // 只是点选，没有移动
  if (ed.op) ed.commit();
  g = null;
  renderPanelSoon();
}

function cancelTool() {
  if (ed.op) {
    const op = ed.op; ed.op = null;
    op.apply(true);
    if (op.box) rend.invalidate(op.box.x0 - 1, op.box.y0 - 1, op.box.x1 + 1, op.box.y1 + 1);
  }
  shapePreview = null;
  if (g && g.kind === 'pending') clearTimeout(g.timer);
  g = null;
  rend.request();
}

function busyIfLarge(fn) { fn(); }
let panelTimer = 0;
function renderPanelSoon() { if (ed.mode === 'units' || ed.mode === 'items' || ed.mode === 'triggers') { clearTimeout(panelTimer); panelTimer = setTimeout(renderPanel, 60); } }

function updateStatus(mp) {
  const m = ed.map; if (!m) return;
  const t = tpos(mp);
  let s = '';
  if (t.x >= 0 && t.y >= 0 && t.x < m.width && t.y < m.height) {
    s = `格 (${t.x}, ${t.y})`;
    if (ed.engine) {
      const v = vpos(mp);
      const tv = ed.engine.terrainAtVertex(Math.round(v.x), Math.round(v.y));
      if (tv !== NONE) s += ' · ' + ed.engine.cn(tv);
    }
  }
  s += (s ? ' · ' : '') + `缩放 ${Math.round(rend.view.z * 100)}%`;
  $('status').textContent = s;
}

// ---------------- 覆盖层 ----------------
function drawOverlay(ctx) {
  const m = ed.map; if (!m) return;
  const v = rend.view, tw = m.tw;
  // 对称轴
  if (ed.sym !== 'none') {
    ctx.save(); ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(255,178,122,0.7)'; ctx.lineWidth = 1.5;
    const W = m.width * tw, H = m.height * m.th;
    const a = rend.toScreen(W / 2, 0), b = rend.toScreen(W / 2, H), c = rend.toScreen(0, H / 2), d = rend.toScreen(W, H / 2);
    ctx.beginPath();
    if (ed.sym === 'lr' || ed.sym === 'quad' || ed.sym === 'rot') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    if (ed.sym === 'tb' || ed.sym === 'quad' || ed.sym === 'rot') { ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); }
    ctx.stroke(); ctx.restore();
  }
  // 形状预览
  if (shapePreview) {
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    for (const [[ax, ay], [bx, by]] of ed.symPairs([shapePreview.a.x, shapePreview.a.y], [shapePreview.b.x, shapePreview.b.y])) {
      const p = rend.toScreen(Math.min(ax, bx) * tw, Math.min(ay, by) * tw), q = rend.toScreen(Math.max(ax, bx) * tw, Math.max(ay, by) * tw);
      ctx.beginPath();
      if (shapePreview.kind === 'rect') ctx.rect(p.x, p.y, q.x - p.x, q.y - p.y);
      else ctx.ellipse((p.x + q.x) / 2, (p.y + q.y) / 2, Math.max(1, (q.x - p.x) / 2), Math.max(1, (q.y - p.y) / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 笔刷光标
  const pos = hover || (g && g.kind === 'tool' && g.last) || null;
  if (!pos) return;
  const T = tool();
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
  if (ed.mode === 'terrain' && T === 'brush' && ed.engine) {
    const vp = vpos(pos);
    const cx = ed.size % 2 ? Math.round(vp.x) : Math.round(vp.x - 0.5) + 0.5;
    const cy = ed.size % 2 ? Math.round(vp.y) : Math.round(vp.y - 0.5) + 0.5;
    for (const [x, y] of ed.symPoints(cx, cy, 'v')) {
      const s = rend.toScreen(x * tw, y * tw), r = Math.max(3, ed.size / 2 * tw * v.z);
      ctx.beginPath();
      if (ed.shape === 'circle') ctx.arc(s.x, s.y, r, 0, Math.PI * 2); else ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r);
      ctx.stroke();
    }
  } else if (ed.mode === 'items' || ed.mode === 'tiles' || (ed.mode === 'units' && (T === 'spawn' || T === 'unit'))) {
    const t = tpos(pos);
    const it = ed.mode === 'items' && T === 'stamp' ? ed.item() : null;
    const r = it && it.stamp ? 1 : (ed.mode === 'units' ? 0 : Math.floor(ed.size / 2));
    for (const [x, y] of ed.symPoints(t.x, t.y, 't')) {
      const s = rend.toScreen((x - r) * tw, (y - r) * tw), w = (2 * r + 1) * tw * v.z;
      ctx.strokeRect(s.x, s.y, w, w);
    }
  }
  ctx.restore();
}

// ---------------- 小地图 ----------------
function setupMinimap() {
  const mc = $('mini');
  let dragging = false;
  const go = (e) => {
    const m = ed.map; if (!m) return;
    const r = mc.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    rend.centerOn(fx * m.width, fy * m.height);
  };
  mc.addEventListener('pointerdown', (e) => { dragging = true; mc.setPointerCapture(e.pointerId); go(e); e.stopPropagation(); });
  mc.addEventListener('pointermove', (e) => { if (dragging) go(e); });
  mc.addEventListener('pointerup', () => { dragging = false; });
}

// ---------------- 键盘、返回键 ----------------
function setupKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); ed.redo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveMap(); }
    else if (k === ' ') { spaceDown = true; e.preventDefault(); }
    else if (k === '[') { ed.size = Math.max(1, ed.size - 1); renderPanel(); rend.request(); }
    else if (k === ']') { ed.size = Math.min(64, ed.size + 1); renderPanel(); rend.request(); }
    else if (k >= '1' && k <= '5' && !e.ctrlKey) setMode(MODES[+k - 1].id);
    else if (k === 'escape') { closeModal(undefined); cancelTool(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
}
function setupBack() {
  const App = nativePlugin('App');
  if (!App || !App.addListener) return;
  App.addListener('backButton', async () => {
    if (!$('modal').classList.contains('hidden')) { closeModal(undefined); return; }
    if (ed.dirty) {
      const ok = await confirmBox('退出编辑器？', '地图还没保存。自动保存的副本下次打开时可以恢复。', '退出');
      if (!ok) return;
      await autosave(true);
    }
    App.exitApp();
  });
}

// ---------------- 保存与导出 ----------------
async function autosave(force = false) {
  if (!ed.map || saving || (!autoDirty && !force)) return;
  saving = true;
  try {
    const text = await ed.map.serialize();
    await kvSet('autosave', { name: mapName, text, time: Date.now() });
    autoDirty = false;
  } catch (e) { console.warn('自动保存失败', e); }
  saving = false;
}

async function saveMap() {
  if (!ed.map) return;
  const issues = runChecks(ed).filter((c) => c.level === 'error');
  if (issues.length) {
    const ok = await modal('地图还有问题', h('div', {}, h('p', {}, `检查发现 ${issues.length} 个会影响游戏的问题：`),
      h('ul', {}, issues.slice(0, 6).map((i) => h('li', {}, i.title)))), [
      { label: '先去看看', value: 'check' }, { label: '仍然保存', value: 'save', primary: true }]);
    if (ok === 'check') { openChecks(); return; }
    if (ok !== 'save') return;
  }
  try {
    saving = true;
    const text = await busy('正在生成地图文件…', () => ed.map.serialize());
    const r = await saveFile(mapName + '.tmx', text, 'application/xml', fileHandle);
    if (r.ok) {
      if (r.handle) fileHandle = r.handle;
      ed.dirty = false; autoDirty = false;
      await kvDel('autosave');
      updateTop();
      toast(r.where + `：${mapName}.tmx`);
      coachSaved();
    }
  } catch (e) {
    modal('保存失败', h('p', {}, e.message || String(e)), [{ label: '知道了', value: 1, primary: true }]);
  } finally { saving = false; }
}

async function exportPreview(size = 200) {
  if (!ed.map) return;
  const cvp = renderPreview(ed, rend, size);
  const blob = await cvp.convertToBlob({ type: 'image/png' });
  const r = await saveFile(mapName + '_map.png', new Uint8Array(await blob.arrayBuffer()), 'image/png');
  if (r.ok) toast(`预览图${r.where}：${mapName}_map.png`);
}

async function renameMap() {
  if (!ed.map) return;
  const inp = h('input', { value: mapName });
  const r = await modal('地图名称', h('div', {}, h('label', {}, '保存时的文件名（不含 .tmx）'), inp,
    h('div', { class: 'hint', style: 'margin-top:8px' }, '常见写法：在名字前加 [p人数]，例如 [p4]群岛。预览图会自动命名为「名称_map.png」。')),
  [{ label: '取消', value: null }, { label: '确定', value: () => inp.value.trim(), primary: true }]);
  if (r) { mapName = r.replace(/[\\/:*?"<>|]/g, '_'); updateTop(); }
}

// ---------------- 菜单 ----------------
function openMenu() {
  const m = !!ed.map;
  const item = (label, sub, fn, dis = false) => h('button', { disabled: dis, onclick: () => { closeModal(); fn(); } }, label, sub ? h('small', {}, sub) : null);
  modal('菜单', h('div', { class: 'menu' },
    item('新建地图', '', newMapDialog),
    item('打开地图', '.tmx', openMap),
    item('保存地图', 'Ctrl+S', saveMap, !m),
    item('导出预览图', '名称_map.png', () => previewDialog(), !m),
    item('地图名称', mapName || '', renameMap, !m),
    item('调整画布大小', m ? `${ed.map.width}×${ed.map.height}` : '', resizeDialog, !m),
    item('图块素材来源', '', templateDialog),
    item('新手教程', '3 步', startCoach, !m),
    item('怎么用？', '', showHelp)));
}

async function previewDialog() {
  const r = await modal('导出预览图', h('div', {},
    h('p', {}, '游戏在选地图时显示的缩略图。和地图放在同一个文件夹，文件名必须是「地图名_map.png」（小写 png）。'),
    h('p', { style: 'color:var(--muted);font-size:12.5px' }, '游戏要求不超过 500×500 像素，推荐 100–200 像素。')),
  [{ label: '200 像素（推荐）', value: 200, primary: true }, { label: '500 像素', value: 500 }]);
  if (r) await exportPreview(r);
}

async function templateDialog() {
  const tpl = await kvGet('template');
  const body = h('div', {},
    h('p', {}, tpl ? `当前素材来自地图「${tpl.from}」，包含：${tpl.names.join('、')}。` : '还没有图块素材。打开任意一张游戏导出的地图（地面图块集内嵌图片的那种）就会自动取出。'),
    h('p', { style: 'color:var(--muted);font-size:12.5px' }, '新建地图时会用这套素材。素材属于游戏开发商，编辑器只在你的设备上使用，不会上传或分发。'));
  const btns = [{ label: '关闭', value: null }];
  if (ed.map && extractTemplate(ed.map)) btns.push({ label: '改用当前地图的素材', value: 'use', primary: true });
  const r = await modal('图块素材来源', body, btns);
  if (r === 'use') {
    const t = extractTemplate(ed.map);
    await kvSet('template', { ...t, from: mapName, time: Date.now() });
    toast('已更新图块素材');
  }
}

function showHelp() {
  modal('怎么用？', h('div', { html: `
    <p><b>1. 地形</b>：选一种地形直接在地图上画。不同地形之间会自动加过渡，不用再点“自动铺图”。</p>
    <p><b>2. 物品</b>：放资源池、树、石头等。资源池占 3×3 格。</p>
    <p><b>3. 单位</b>：点“出生点”在地图上点一下，就放好 1 个指挥中心和 2 个建造者，队伍号自动排。</p>
    <p><b>4. 规则</b>：设置 map_info（遭遇战地图要 type=skirmish）。</p>
    <p><b>5. 图块</b>（专家）：直接放任意图块，不自动过渡。</p>
    <p><b>对称</b>：每个模式都能开“左右 / 上下 / 中心 / 四向”对称，做公平的对战图。</p>
    <p><b>操作</b>：手机上单指画、双指缩放和拖动；电脑上滚轮缩放、右键或空格+拖动平移，Ctrl+Z 撤销，[ ] 调笔刷大小。</p>
    <p><b>保存前</b>点右上角「能玩吗？」检查。保存后把 .tmx 和 _map.png 放进游戏的地图文件夹（手机一般是 rustedWarfare/maps）。</p>
    <p style="color:var(--muted);font-size:12.5px">每 30 秒自动保存一份副本到本机，闪退后下次打开可以恢复。</p>` }), [{ label: '知道了', value: 1, primary: true }]);
}

// ---------------- 检查 ----------------
async function openChecks() {
  if (!ed.map) return;
  const render = () => {
    const list = runChecks(ed);
    const order = { error: 0, warn: 1, info: 2, ok: 3 };
    list.sort((a, b) => order[a.level] - order[b.level]);
    const errs = list.filter((c) => c.level === 'error').length, warns = list.filter((c) => c.level === 'warn').length;
    const body = h('div', {},
      h('p', { style: 'margin-top:0' }, errs ? `有 ${errs} 个问题会影响游戏，${warns} 个提醒。` : warns ? `没有严重问题，有 ${warns} 个提醒。` : '没发现问题，可以保存后去游戏里试玩了。'),
      h('div', {}, list.map((c) => h('div', { class: 'chk ' + c.level },
        h('div', { class: 'ic' }, { error: '!', warn: '!', ok: '✓', info: 'i' }[c.level]),
        h('div', { style: 'flex:1' }, h('div', { class: 't' }, c.title), c.detail ? h('div', { class: 'd' }, c.detail) : null,
          (c.goto || c.fix) ? h('div', { class: 'acts' },
            c.goto ? h('button', { onclick: () => { closeModal(); rend.centerOn(c.goto.x, c.goto.y, Math.max(rend.view.z, 1)); } }, '去看看') : null,
            c.fix ? h('button', { class: 'primary', onclick: () => { c.fix.run(); rend.invalidateAll(); mini.schedule(); renderPanel(); updateTop(); render(); } }, c.fix.label) : null) : null)))),
      h('p', { style: 'color:var(--muted);font-size:12px' }, '检查项来自社区整理的游戏规则，最终以游戏里实际打开为准。'));
    const mb = document.querySelector('#modal .mbody');
    if (!document.getElementById('modal').classList.contains('hidden') && document.querySelector('#modal h2').textContent === '能玩吗？') { mb.innerHTML = ''; mb.append(body); return null; }
    return body;
  };
  const b = render();
  if (b) modal('能玩吗？', b, [{ label: '关闭', value: 1, primary: true }]);
  coachChecked();
}

// ---------------- 新建地图 ----------------
async function newMapDialog() {
  const tpl = await kvGet('template');
  if (!tpl) { modal('需要图块素材', h('p', {}, '新建地图前，先打开一张你已有的铁锈战争地图，编辑器会从里面取出图块素材。'), [{ label: '去打开地图', value: 1, primary: true }]).then((v) => v && openMap()); return; }
  if (ed.dirty && !(await confirmBox('新建地图？', '当前地图还没保存，新建会丢掉未保存的修改。', '仍然新建'))) return;
  const doc = new DOMParser().parseFromString('<map>' + tpl.xml + '</map>', 'application/xml');
  const gts = [...doc.querySelectorAll('tileset')].find((t) => (t.getAttribute('name') || '') === 'export_ground' || t.querySelector('property[name="layer"][value="ground"]'));
  const tnames = gts ? [...gts.querySelectorAll('terraintypes > terrain')].map((t) => t.getAttribute('name')) : [];
  const st = { name: '新地图', w: 160, h: 160, players: 2, layout: 'ring', base: Math.max(0, tnames.indexOf('Grass')), pools: 2, center: 2 };
  const presets = [[80, 80], [120, 120], [160, 160], [250, 250], [400, 400], [500, 500], [1000, 1000]];
  const nameI = h('input', { value: st.name, oninput: (e) => { st.name = e.target.value; } });
  const wI = h('input', { type: 'number', min: 20, max: 5000, value: st.w });
  const hI = h('input', { type: 'number', min: 20, max: 5000, value: st.h });
  const tierEl = h('div', { class: 'hint', style: 'margin-top:6px' });
  const pre = h('div', { class: 'presets' });
  const refresh = () => {
    st.w = clamp(+wI.value || 20, 20, 5000); st.h = clamp(+hI.value || 20, 20, 5000);
    const t = sizeTier(st.w, st.h);
    tierEl.innerHTML = `<span class="tier" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${t.level === 'ok' ? 'var(--ok)' : t.level === 'warn' ? 'var(--warn)' : 'var(--err)'}"></span>${t.text}`;
    for (const b of pre.children) b.classList.toggle('on', b.dataset.v === `${st.w}x${st.h}`);
  };
  for (const [w, hh] of presets) pre.append(h('button', { 'data-v': `${w}x${hh}`, onclick: () => { wI.value = w; hI.value = hh; refresh(); } }, `${w}×${hh}`));
  wI.oninput = refresh; hI.oninput = refresh;
  const pl = h('select', { onchange: (e) => { st.players = +e.target.value; } });
  for (let i = 2; i <= 10; i++) pl.append(h('option', { value: i, selected: i === st.players }, i + ' 人'));
  const lay = h('select', { onchange: (e) => { st.layout = e.target.value; } },
    h('option', { value: 'ring' }, '围成一圈（适合任意人数）'), h('option', { value: 'lr' }, '左右两边对阵'), h('option', { value: 'tb' }, '上下两边对阵'));
  const base = h('select', { onchange: (e) => { st.base = +e.target.value; } });
  tnames.forEach((n, i) => base.append(h('option', { value: i, selected: i === st.base }, TERRAIN_CN[n] || n)));
  const pools = h('select', { onchange: (e) => { st.pools = +e.target.value; } });
  for (let i = 0; i <= 4; i++) pools.append(h('option', { value: i, selected: i === st.pools }, i + ' 个'));
  const center = h('select', { onchange: (e) => { st.center = +e.target.value; } });
  for (const i of [0, 1, 2, 4, 6, 8]) center.append(h('option', { value: i, selected: i === st.center }, i + ' 个'));
  refresh();
  const r = await modal('新建地图', h('div', {},
    h('label', {}, '地图名称'), nameI,
    h('label', {}, '尺寸（格，每格 20 像素）'), pre,
    h('div', { class: 'grid2', style: 'margin-top:6px' }, h('div', {}, h('label', {}, '宽'), wI), h('div', {}, h('label', {}, '高'), hI)), tierEl,
    h('div', { class: 'grid2' }, h('div', {}, h('label', {}, '玩家人数'), pl), h('div', {}, h('label', {}, '出生点布局'), lay)),
    h('div', { class: 'grid2' }, h('div', {}, h('label', {}, '底色地形'), base), h('div', {}, h('label', {}, '每队身边的资源池'), pools)),
    h('div', { class: 'grid2' }, h('div', {}, h('label', {}, '地图中央的公共资源池'), center), h('div', {})),
    h('p', { style: 'color:var(--muted);font-size:12.5px' }, '会自动生成：地面、出生点（指挥中心 + 2 个建造者）、资源池和 map_info（type=skirmish）。生成后可以继续画。')),
  [{ label: '取消', value: null }, { label: '生成', value: () => ({ ...st }), primary: true }], { sticky: true });
  if (!r) return;
  await busy('正在生成地图…', () => generateMap(r));
}

async function generateMap(st) {
  const tpl = await kvGet('template');
  const map = await newMapFromTemplate(tpl.xml, st.w, st.h, { name: st.name });
  ed.setMap(map);
  if (ed.engine) ed.engine.fillAll(st.base ?? ed.terrain);
  const oldSym = ed.sym; ed.sym = 'none';
  ed.begin('生成');
  const W = st.w, H = st.h, n = st.players || 2;
  const spots = [];
  const margin = Math.min(10, Math.floor(Math.min(W, H) / 6));
  if (st.layout === 'lr' || st.layout === 'tb') {
    const a = Math.ceil(n / 2), b = n - a;
    for (let i = 0; i < a; i++) spots.push(st.layout === 'lr' ? [margin + 2, (i + 1) * H / (a + 1)] : [(i + 1) * W / (a + 1), margin + 2]);
    for (let i = 0; i < b; i++) spots.push(st.layout === 'lr' ? [W - margin - 3, (i + 1) * H / (b + 1)] : [(i + 1) * W / (b + 1), H - margin - 5]);
  } else {
    const R = Math.min(W, H) / 2 - margin - 3;
    for (let i = 0; i < n; i++) { const ang = Math.PI + i * 2 * Math.PI / n; spots.push([W / 2 + R * Math.cos(ang), H / 2 + R * Math.sin(ang)]); }
  }
  const poolItem = ed.items.find((i) => i.pool);
  const keepKey = ed.itemKey;
  if (poolItem) ed.itemKey = poolItem.key;
  for (const [x, y] of spots) {
    const tx = Math.round(clamp(x, 2, W - 3)), ty = Math.round(clamp(y, 2, H - 6));
    ed.addSpawnAt(tx, ty);
    if (poolItem && st.pools) {
      // 以指挥中心为圆心、朝地图中央摆放，保证每队距离一致
      const cx = tx + 0.5, cy = ty;
      const toC = Math.atan2(H / 2 - cy, W / 2 - cx);
      for (let k = 0; k < st.pools; k++) {
        const ang = toC + (k - (st.pools - 1) / 2) * 0.9;
        const d = 9;
        ed.placeItemAt(Math.floor(clamp(cx + d * Math.cos(ang), 2, W - 3)), Math.floor(clamp(cy + d * Math.sin(ang), 2, H - 3)));
      }
    }
  }
  if (poolItem && st.center) {
    const R = st.center === 1 ? 0 : Math.min(W, H) * 0.08 + 3;
    for (let k = 0; k < st.center; k++) {
      const ang = k * 2 * Math.PI / st.center + Math.PI / 4;
      ed.placeItemAt(Math.round(W / 2 + R * Math.cos(ang)), Math.round(H / 2 + R * Math.sin(ang)));
    }
  }
  ed.itemKey = keepKey || ed.itemKey;
  ed.op = null; // 新地图不需要撤销这一步
  ed.sym = oldSym;
  rend.setMap(map);
  mini.rebuild();
  mapName = (st.name || '新地图').replace(/[\\/:*?"<>|]/g, '_');
  fileHandle = null;
  ed.dirty = true; autoDirty = true;
  $('welcome').classList.add('hidden');
  updateTop(); renderPanel();
  return map;
}

// ---------------- 调整画布 ----------------
async function resizeDialog() {
  const m = ed.map; if (!m) return;
  const st = { w: m.width, h: m.height, ax: 1, ay: 1 };
  const wI = h('input', { type: 'number', min: 20, max: 5000, value: st.w });
  const hI = h('input', { type: 'number', min: 20, max: 5000, value: st.h });
  const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(3,36px);gap:4px' });
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    grid.append(h('button', { class: x === 1 && y === 1 ? 'primary' : '', onclick: (e) => { st.ax = x; st.ay = y; for (const b of grid.children) b.className = ''; e.currentTarget.className = 'primary'; } }, ''));
  }
  const r = await modal('调整画布大小', h('div', {},
    h('div', { class: 'grid2' }, h('div', {}, h('label', {}, '新宽度'), wI), h('div', {}, h('label', {}, '新高度'), hI)),
    h('label', {}, '原地图放在哪里'), grid,
    h('p', { style: 'color:var(--muted);font-size:12.5px' }, ed.engine ? `新增的区域用当前选中的地形「${ed.engine.cn(ed.terrain)}」填充。调整后之前的操作不能再撤销。` : '调整后之前的操作不能再撤销。')),
  [{ label: '取消', value: null }, { label: '调整', value: () => ({ w: clamp(+wI.value || 20, 20, 5000), h: clamp(+hI.value || 20, 20, 5000) }), primary: true }]);
  if (!r) return;
  await busy('正在调整画布…', async () => {
    const ox = Math.round((r.w - m.width) * st.ax / 2), oy = Math.round((r.h - m.height) * st.ay / 2);
    const eng = ed.engine;
    const fill = eng ? eng.ts.firstgid + eng.lut[eng.key(ed.terrain, ed.terrain, ed.terrain, ed.terrain)] : 0;
    m.resize(r.w, r.h, ox, oy, fill);
    const keep = ed.terrain;
    ed.setMap(m); ed.terrain = keep;
    rend.setMap(m); mini.rebuild();
    ed.dirty = true; autoDirty = true; updateTop(); renderPanel();
  });
}

// ---------------- 新手教程 ----------------
const COACH = [
  '在下面选「地形」，点一种地形（比如「水」），然后在地图上按住拖一笔。',
  '选「物品」→「资源池」，在地图上点一下放一个资源池。',
  '点右上角「能玩吗？」检查一下，然后点「保存」。',
];
function startCoach() { coachStep = 1; setMode('terrain'); showCoach(); }
function showCoach() {
  const c = $('coach');
  if (!coachStep || coachStep > COACH.length) { c.classList.add('hidden'); return; }
  c.innerHTML = '';
  c.append(h('div', { class: 'step' }, `第 ${coachStep}/${COACH.length} 步`), h('div', { class: 'txt' }, COACH[coachStep - 1]),
    h('button', { onclick: () => { coachStep = 0; showCoach(); } }, '跳过'));
  c.classList.remove('hidden');
}
function coachEdit() {
  const last = ed.undoStack[ed.undoStack.length - 1];
  if (!last) return;
  if (coachStep === 1 && /地形|矩形|椭圆/.test(last.label)) { coachStep = 2; showCoach(); }
  else if (coachStep === 2 && last.label === '放物品') { coachStep = 3; showCoach(); }
}
function coachChecked() { if (coachStep === 3) { const c = $('coach'); if (!c.classList.contains('hidden')) c.querySelector('.txt').textContent = '检查完了，最后点「保存」。'; } }
function coachSaved() { if (coachStep === 3) { coachStep = 0; showCoach(); toast('教程完成！把保存的 .tmx 放进游戏的地图文件夹就能玩了。', 3500); } }

init();
