// 界面面板：顶栏、菜单栏、模式栏、工具栏、右侧停靠面板、状态栏、欢迎页
import { A } from './state.js';
import { objProp } from './tmx.js';
import { UNIT_CN, MAX_TEAMS } from './editor.js';
import { teamColor } from './render.js';
import { sizeTier } from './check.js';
import { balanceReport } from './pathing.js';
import { builtinStamps, userStamps, deleteUserStamp, exportStamp, importStampText, saveUserStamp, stampThumb } from './stamps.js';
import { listRecent, removeRecent, gameFolder, gameFolderSupported, saveFile, pickFile } from './files.js';
import { kvGet } from './util.js';
import { h, menu, toast, segmented, slider, toggle, select, promptBox, confirmBox, busy } from './ui.js';
import { icon } from './icons.js';
import { helpBtn, HELP, showHelp } from './help.js';
import { ACTIONS, runAction, menuItems, MENU_GROUPS, action } from './actions.js';
import * as IO from './io.js';
import * as D from './dialogs.js';

const ed = A.ed, rend = A.rend;
const $ = (id) => document.getElementById(id);

export const MODES = [
  { id: 'terrain', label: '地形', icon: 'terrain', help: 'mode.terrain', layer: 'ground' },
  { id: 'items', label: '物品', icon: 'items', help: 'mode.items', layer: 'items' },
  { id: 'units', label: '单位', icon: 'units', help: 'mode.units', layer: 'units' },
  { id: 'triggers', label: '触发器', icon: 'rules', help: 'mode.triggers', layer: 'units' },
  { id: 'generate', label: '生成', icon: 'generate', help: 'mode.generate', layer: null },
  { id: 'tiles', label: '图块', icon: 'tiles', help: 'mode.tiles', layer: null, expert: true },
];
export const TOOLS = {
  terrain: [['brush', '画笔', 'B', 'terrain.brush'], ['rect', '矩形', 'R', 'terrain.rect'], ['ellipse', '椭圆', 'E', 'terrain.ellipse'], ['fill', '油漆桶', 'F', 'terrain.fill'], ['pick', '吸管', 'I', 'terrain.pick'], '|', ['marquee', '框选', 'M', 'select.marquee'], ['wand', '魔棒', 'W', 'select.wand'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  items: [['stamp', '放置', 'B', 'items.stamp'], ['random', '随机笔刷', 'N', 'items.random'], ['erase', '橡皮', 'X', 'items.erase'], '|', ['marquee', '框选', 'M', 'select.marquee'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  units: [['spawn', '出生点', 'S', 'units.spawn'], ['unit', '放单位', 'U', 'units.unit'], ['select', '选择', 'V', 'units.select'], ['del', '删除', 'D', 'units.del'], '|', ['marquee', '框选', 'M', 'select.marquee'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  triggers: [['select', '选择', 'V', 'units.select'], ['region', '画区域', 'G', 'mode.triggers'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  generate: [['marquee', '框选', 'M', 'select.marquee'], ['wand', '魔棒', 'W', 'select.wand'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  tiles: [['brush', '放图块', 'B', 'tiles.brush'], ['erase', '橡皮', 'X', 'tiles.erase'], ['pick', '吸管', 'I', 'tiles.pick'], '|', ['pan', '拖动', 'H', 'tool.pan']],
};
const TOOL_ICON = { brush: 'brush', rect: 'rect', ellipse: 'ellipse', fill: 'fill', pick: 'pick', pan: 'pan', stamp: 'stamp', random: 'random', erase: 'erase', spawn: 'spawn', unit: 'unit', select: 'select', del: 'del', marquee: 'marquee', wand: 'wand', region: 'region' };
const DOCK_TABS = [['tool', '工具', 'settings'], ['layers', '图层', 'layers'], ['stamps', '印章', 'stamp'], ['history', '历史', 'clock'], ['report', '报告', 'report']];

export const tool = () => ed.tool[ed.mode];

export function setMode(mode) {
  ed.mode = mode;
  ed.showTriggers = mode === 'triggers';
  ed.selected = null;
  const m = MODES.find((x) => x.id === mode);
  rend.activeLayer = m ? m.layer : null;
  if (A.settings.dim) rend.invalidateAll();
  if (!TOOLS[mode].some((t) => Array.isArray(t) && t[0] === ed.tool[mode])) ed.tool[mode] = TOOLS[mode][0][0];
  A.dockTab = 'tool';
  document.getElementById('dock').classList.remove('collapsed');
  A.refresh('modes', 'toolbar', 'dock');
  rend.request();
  A.hooks.coach && A.hooks.coach('mode:' + mode);
}
export function setTool(t) { ed.tool[ed.mode] = t; A.refresh('toolbar', 'dock'); rend.request(); A.hooks.coach && A.hooks.coach('tool:' + t); }

// ---------------- 顶栏 ----------------
export function renderTop() {
  const m = ed.map;
  $('mapName').textContent = m ? (A.mapName || '未命名') + (ed.dirty ? ' •' : '') : '';
  if (m) {
    const t = sizeTier(m.width, m.height);
    const c = t.level === 'ok' ? 'var(--ok)' : t.level === 'warn' ? 'var(--warn)' : 'var(--err)';
    $('mapSize').innerHTML = `<span class="tier" style="background:${c}" title="${t.text}"></span>${m.width}×${m.height}`;
    $('saveState').textContent = ed.dirty ? (A.lastAuto ? '已自动备份 ' + new Date(A.lastAuto).toLocaleTimeString().slice(0, 5) : '未保存') : '已保存';
  } else { $('mapSize').textContent = ''; $('saveState').textContent = ''; }
  $('btnUndo').disabled = !ed.undoStack.length;
  $('btnRedo').disabled = !ed.redoStack.length;
  $('btnUndo').title = ed.undoStack.length ? `撤销：${ed.undoStack[ed.undoStack.length - 1].label} (Ctrl+Z)` : '撤销 (Ctrl+Z)';
  $('btnRedo').title = ed.redoStack.length ? `重做：${ed.redoStack[ed.redoStack.length - 1].label} (Ctrl+Y)` : '重做 (Ctrl+Y)';
  for (const id of ['btnSave', 'btnSaveMore', 'btnCheck']) $(id).disabled = !m;
}

export function initChrome() {
  $('btnMenu').innerHTML = icon('menu');
  $('btnUndo').innerHTML = icon('undo');
  $('btnRedo').innerHTML = icon('redo');
  $('btnSearch').innerHTML = icon('search') + '<span>搜索功能…</span><kbd>Ctrl K</kbd>';
  $('btnSearch').onclick = () => A.hooks.palette();
  $('btnUndo').onclick = () => ed.undo();
  $('btnRedo').onclick = () => ed.redo();
  $('btnSave').onclick = () => IO.saveMap();
  $('btnCheck').onclick = () => D.openChecks();
  $('mapName').onclick = renameMap;
  $('btnSaveMore').onclick = (e) => menu(e.currentTarget, [
    { label: '保存', iconHtml: icon('save'), keys: 'Ctrl+S', run: () => IO.saveMap() },
    { label: '另存为…', iconHtml: icon('save'), run: () => IO.saveMap(true) },
    { label: '保存到游戏文件夹', iconHtml: icon('saveGame'), run: () => IO.saveToGameFlow() },
    { sep: true },
    { label: '导出预览图 / 展示图…', iconHtml: icon('image'), run: () => D.previewDialog() },
  ], { alignRight: true });
  $('btnMenu').onclick = (e) => mobileMenu(e.currentTarget);
  // 菜单栏
  const mb = $('menubar');
  for (const g of MENU_GROUPS) {
    const b = h('button', {}, g);
    b.onclick = () => { b.classList.add('open'); const p = menu(b, menuItems(g)); const obs = new MutationObserver(() => { if (!p.isConnected) { b.classList.remove('open'); obs.disconnect(); } }); obs.observe(document.body, { childList: true }); };
    mb.append(b);
  }
  // 缩放按钮
  const z = $('zoomctl');
  z.append(h('button', { title: '放大', onclick: () => rend.zoomAt(rend.cw / 2, rend.ch / 2, 1.4), html: icon('zoomIn') }),
    h('button', { title: '缩小', onclick: () => rend.zoomAt(rend.cw / 2, rend.ch / 2, 1 / 1.4), html: icon('zoomOut') }),
    h('button', { title: '显示整张地图', onclick: () => rend.fit(), html: icon('fit') }));
}

function mobileMenu(anchor) {
  const items = [];
  for (const g of MENU_GROUPS) { items.push({ title: g }); for (const it of menuItems(g)) if (!it.sep && !it.title) items.push(it); }
  items.splice(0, 0, { label: '搜索功能…', iconHtml: icon('search'), run: () => A.hooks.palette() });
  menu(anchor, items);
}

async function renameMap() {
  if (!ed.map) return;
  const r = await promptBox('地图名称', '保存时的文件名（不含 .tmx）', A.mapName, '常见写法：名字前加 [p人数]，例如 [p4]群岛。预览图自动命名为“名称_map.png”。改名后保存会另存为新文件。');
  if (r) { A.mapName = r.replace(/[\\/:*?"<>|]/g, '_'); renderTop(); }
}

// ---------------- 模式栏 ----------------
export function renderModes() {
  const nav = $('modebar');
  nav.innerHTML = '';
  for (const m of MODES) {
    nav.append(h('button', { class: 'mode' + (ed.mode === m.id ? ' on' : '') + (m.expert ? ' expert' : ''), 'data-mode': m.id, title: (HELP[m.help] || {}).s || m.label, onclick: () => setMode(m.id), html: icon(m.icon) + `<span>${m.label}</span>` }));
  }
  if (!A.isMobile()) {
    nav.append(h('div', { class: 'mbspacer' }));
    const quick = h('div', { class: 'quick' },
      h('span', { class: 'qlabel' }, '对称'), segmented([['none', '无'], ['lr', '左右'], ['tb', '上下'], ['rot', '中心'], ['quad', '四向']], ed.sym, (v) => { ed.sym = v; rend.request(); A.refresh('dock'); A.hooks.coach && A.hooks.coach('sym'); }), helpBtn('sym'),
      h('span', { class: 'qlabel', style: 'margin-left:8px' }, '叠加'), select([['none', '无'], ['land', '陆军通行'], ['naval', '海军通行'], ['hover', '悬浮通行'], ['build', '可建造'], ['territory', '各队地盘'], ['symdiff', '对称差异']], A.overlayKind, (v) => A.hooks.setOverlay(v)), helpBtn('overlay'),
      h('button', { class: 'ib', title: '其他层变暗', style: A.settings.dim ? 'color:var(--accent2)' : '', onclick: () => A.hooks.toggleDim(), html: icon('dim') }),
      h('button', { class: 'ib', title: '网格', style: A.settings.grid ? 'color:var(--accent2)' : '', onclick: () => A.hooks.toggleGrid(), html: icon('grid') }));
    nav.append(quick);
  }
}

// ---------------- 工具栏 ----------------
export function renderToolbar() {
  const tb = $('toolbar');
  tb.innerHTML = '';
  for (const t of TOOLS[ed.mode]) {
    if (t === '|') { tb.append(h('div', { class: 'tsep' })); continue; }
    const [id, label, key, help] = t;
    const hs = HELP[help] || {};
    const b = h('button', { class: 'tool' + (tool() === id ? ' on' : ''), 'data-tool': id, title: `${label}（${key}）— ${hs.s || ''}\n长按或右键查看说明`, onclick: () => setTool(id), html: icon(TOOL_ICON[id]) + `<span class="tl">${label}</span><span class="key">${key}</span>` });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); showHelp(help); });
    let timer = 0;
    b.addEventListener('pointerdown', () => { timer = setTimeout(() => { timer = -1; showHelp(help); }, 600); });
    b.addEventListener('pointerup', () => clearTimeout(timer));
    b.addEventListener('pointerleave', () => clearTimeout(timer));
    tb.append(b);
  }
}

// ---------------- 状态栏 ----------------
export function renderStatus(mp) {
  const m = ed.map;
  const sb = $('statusbar');
  let pos = '';
  if (m && mp) {
    const tx = Math.floor(mp.x / m.tw), ty = Math.floor(mp.y / m.th);
    if (tx >= 0 && ty >= 0 && tx < m.width && ty < m.height) {
      pos = `格 ${tx}, ${ty}`;
      if (ed.engine) { const t = ed.engine.terrainAtVertex(Math.round(mp.x / m.tw), Math.round(mp.y / m.th)); if (t !== 255) pos += ' · ' + ed.engine.cn(t); }
    }
  }
  const sel = ed.selection ? `选区 ${ed.selection.x1 - ed.selection.x0 + 1}×${ed.selection.y1 - ed.selection.y0 + 1}` : '';
  const zoom = Math.round(rend.view.z * 100);
  $('mstatus').textContent = [pos, `${zoom}%`].filter(Boolean).join(' · ');
  if (A.isMobile()) return;
  if (!sb.firstChild) {
    sb.append(h('span', { id: 'sbPos' }), h('span', { id: 'sbSel' }), h('span', { class: 'sp' }),
      h('span', { id: 'sbTeams' }), h('span', {}, '缩放'), h('input', { id: 'sbZoom', type: 'range', min: -60, max: 30, value: 0, oninput: (e) => rend.setZoom(Math.pow(2, +e.target.value / 10)) }), h('span', { id: 'sbZoomTxt', style: 'min-width:44px' }));
  }
  $('sbPos').textContent = pos;
  $('sbSel').textContent = sel;
  $('sbTeams').textContent = m ? `${ed.usedTeams().size} 支队伍 · ${rend.pools.length} 个资源池` : '';
  $('sbZoom').value = Math.round(Math.log2(rend.view.z) * 10);
  $('sbZoomTxt').textContent = zoom + '%';
}

// ---------------- 停靠面板 ----------------
export function renderDock() {
  const tabs = $('dockTabs');
  tabs.querySelectorAll('.dtab').forEach((e) => e.remove());
  for (const [id, label, ic] of DOCK_TABS) {
    tabs.append(h('button', { class: 'dtab' + (A.dockTab === id ? ' on' : ''), onclick: () => { A.dockTab = id; $('dock').classList.remove('collapsed'); renderDock(); }, html: icon(ic) + `<span>${label}</span>` }));
  }
  const body = $('dockBody');
  body.innerHTML = '';
  if (!ed.map) { body.append(h('div', { class: 'hint' }, '还没有打开地图。用左上角菜单新建或打开一张。')); return; }
  ({ tool: dockTool, layers: dockLayers, stamps: dockStamps, history: dockHistory, report: dockReport })[A.dockTab](body);
}
const sec = (title, help, ...kids) => h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, title), help ? helpBtn(help) : null), ...kids);

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
function symSec() {
  if (!A.isMobile()) return null;
  return sec('对称绘制', 'sym', segmented([['none', '无'], ['lr', '左右'], ['tb', '上下'], ['rot', '中心'], ['quad', '四向']], ed.sym, (v) => { ed.sym = v; rend.request(); A.hooks.coach && A.hooks.coach('sym'); }));
}
function sizeSec(max = 64) {
  return h('div', {}, slider('笔刷大小', 1, max, ed.size, (v) => { ed.size = v; rend.request(); }),
    segmented([['circle', '圆形'], ['square', '方形']], ed.shape, (v) => { ed.shape = v; rend.request(); }));
}

function dockTool(body) {
  const T = tool();
  if (ed.mode === 'generate') { toolGenerate(body); body.append(h('div', { class: 'hint' }, '用左边的框选、魔棒选中一块后，可以只复制、翻转那一块；整图操作在上面。')); return; }
  if (T === 'marquee' || T === 'wand') {
    body.append(sec(T === 'wand' ? '魔棒' : '框选', T === 'wand' ? 'select.wand' : 'select.marquee',
      h('div', { class: 'hint' }, T === 'wand' ? '点一下选中连成一片的同种地形。选中后，地图下方会出现操作条：复制、剪切、翻转、旋转、存为印章。' : '按住拖动框出一块区域。选中后，地图下方会出现操作条：复制、剪切、翻转、旋转、存为印章。'),
      T === 'wand' ? toggle('全图同种地形', !!A.wandGlobal, (v) => { A.wandGlobal = v; }) : null,
      toggle('粘贴时空格不覆盖已有物品', A.skipEmpty !== false, (v) => { A.skipEmpty = v; })));
    if (ed.clipboard) body.append(h('button', { class: 'primary', onclick: () => A.hooks.paste(), html: icon('paste') + ' 粘贴剪贴板内容' }));
    return;
  }
  if (T === 'pan') { body.append(sec('拖动', 'tool.pan', h('div', { class: 'hint' }, '按住拖动移动地图。任何工具下都可以双指拖动、缩放；电脑上用鼠标中键或按住空格拖动（地形模式外也可以用右键），滚轮缩放。'))); return; }
  ({ terrain: toolTerrain, items: toolItems, units: toolUnits, triggers: toolTriggers, generate: toolGenerate, tiles: toolTiles })[ed.mode](body, T);
}

function toolTerrain(body, T) {
  const eng = ed.engine;
  if (!eng) { body.append(h('div', { class: 'hint warnh' }, '这张地图的地面图块集没有地形标注，无法自动过渡。请用“图块”模式直接放图块。')); return; }
  const sw = h('div', { class: 'swatches' });
  for (const t of eng.paintable) {
    const b = h('button', { class: 'sw' + (ed.terrain === t ? ' on' : ed.terrain2 === t ? ' on2' : ''), title: `${eng.name(t)}\n点击设为主笔，右键或长按设为副笔`, onclick: () => { ed.terrain = t; if (T === 'pick') ed.tool.terrain = 'brush'; A.refresh('dock', 'toolbar'); A.hooks.coach && A.hooks.coach('terrain:' + eng.name(t)); } }, tileThumb(eng.solidGid(t)), eng.cn(t));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); ed.terrain2 = t; A.refresh('dock'); });
    let tm = 0; b.addEventListener('pointerdown', () => { tm = setTimeout(() => { ed.terrain2 = t; A.refresh('dock'); toast('副笔：' + eng.cn(t)); }, 550); });
    b.addEventListener('pointerup', () => clearTimeout(tm)); b.addEventListener('pointerleave', () => clearTimeout(tm));
    sw.append(b);
  }
  body.append(sec('地形（主笔 / 副笔）', 'secondary', sw,
    h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { onclick: () => { [ed.terrain, ed.terrain2] = [ed.terrain2, ed.terrain]; A.refresh('dock'); }, title: '交换主笔和副笔（X）' }, '⇄ 交换主副笔'),
      A.isMobile() ? toggle('用副笔画', !!A.useSecondary, (v) => { A.useSecondary = v; }) : h('small', { style: 'color:var(--dim)' }, '右键画副笔'))));
  if (T === 'brush') body.append(sec('笔刷', 'terrain.brush', sizeSec(64)));
  if (T === 'fill') body.append(sec('油漆桶', 'terrain.fill', toggle('全图同种地形一起换', !!A.fillGlobal, (v) => { A.fillGlobal = v; })));
  if (T === 'brush' || T === 'rect' || T === 'ellipse') {
    body.append(sec('只覆盖', 'onlyOver', select([['', '不限（所有地形）'], ...eng.paintable.map((t) => [t, '只改' + eng.cn(t)])], ed.onlyOver ?? '', (v) => { ed.onlyOver = v === '' ? null : +v; })));
  }
  const ss = symSec(); if (ss) body.append(ss);
  const t = ed.terrain;
  const neigh = eng.paintable.filter((u) => u !== t && eng.adj[t][u]).map((u) => eng.cn(u));
  if (/cliff/i.test(eng.name(t))) body.append(h('div', { class: 'hint warnh', style: 'margin-bottom:10px', html: `「${eng.cn(t)}」画出来的<b>内部和普通地面一样</b>，只有边缘才显示成悬崖，单位过不去的是边缘。` }));
  body.append(h('div', { class: 'hint', html: `画的时候会<b>自动加过渡</b>。「${eng.cn(t)}」能直接挨着：${neigh.join('、') || '（无）'}。挨着别的地形时会自动垫一圈中间地形。` }));
}

function toolItems(body, T) {
  if (!ed.itemsTs) { body.append(h('div', { class: 'hint warnh' }, '这张地图没有物品图块集（export_items），无法放置资源池等物品。')); return; }
  if (T === 'random') {
    if (!ed.randomMix) ed.randomMix = ed.items.filter((i) => !i.stamp).slice(0, 3).map((i) => ({ key: i.key, w: 1 }));
    const box = h('div', { class: 'swatches' });
    for (const it of ed.items.filter((i) => !i.stamp)) {
      const e = ed.randomMix.find((x) => x.key === it.key);
      const b = h('button', { class: 'sw' + (e ? ' on' : ''), onclick: () => { if (e) ed.randomMix = ed.randomMix.filter((x) => x !== e); else ed.randomMix.push({ key: it.key, w: 1 }); A.refresh('dock'); } }, tileThumb(it.rep), it.cn,
        e ? h('input', { type: 'range', class: 'wt', min: 1, max: 5, value: e.w, onclick: (ev) => ev.stopPropagation(), oninput: (ev) => { e.w = +ev.target.value; } }) : null);
      box.append(b);
    }
    body.append(sec('随机笔刷：选几种物品，滑杆是比例', 'items.random', box, slider('留空比例', 0, 10, ed.randomGap ?? 2, (v) => { ed.randomGap = v; })), sec('笔刷', null, sizeSec(24)));
    const ss = symSec(); if (ss) body.append(ss);
    return;
  }
  const sw = h('div', { class: 'swatches' });
  for (const it of ed.items) {
    sw.append(h('button', { class: 'sw' + (ed.itemKey === it.key ? ' on' : ''), title: it.name, onclick: () => { ed.itemKey = it.key; ed.tool.items = 'stamp'; A.refresh('dock', 'toolbar'); A.hooks.coach && A.hooks.coach('item:' + it.name); } }, tileThumb(it.stamp ? it.stamp[1][1] : it.rep), it.cn));
  }
  body.append(sec('物品', 'mode.items', sw));
  const it = ed.item();
  if (T === 'erase' || (it && !it.stamp)) body.append(sec('笔刷', null, sizeSec(24)));
  const ss = symSec(); if (ss) body.append(ss);
  body.append(h('div', { class: 'hint', html: (it && it.stamp ? `「${it.cn}」占 3×3 格，点一下放一个。` : '按住拖动可以连续画。') + `<br>地图上现在有 <b>${rend.pools.length}</b> 个资源池。资源池和单位之间最好留 1 格空隙。` }));
}

export function teamSelect(cur, on, withNeutral = true) {
  const opts = [];
  if (withNeutral) opts.push([-1, '中立'], [-2, '敌对（-2）']);
  for (let t = 0; t < MAX_TEAMS; t++) opts.push([t, `第 ${t + 1} 队`]);
  return select(opts, cur, (v) => on(+v));
}

function toolUnits(body, T) {
  if (T === 'unit') {
    const names = ed.unitNames.length ? ed.unitNames : ['commandCenter', 'builder'];
    body.append(sec('放单位', 'units.unit', h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '单位'), select(names.map((u) => [u, (UNIT_CN[u] ? UNIT_CN[u] + ' · ' : '') + u]), ed.unitName, (v) => { ed.unitName = v; })),
      h('div', {}, h('label', {}, '队伍'), teamSelect(ed.team, (v) => { ed.team = v; })))));
  }
  if (T === 'spawn') body.append(sec('出生点', 'units.spawn', h('div', { class: 'hint', html: `点一下地图放一个<b>出生点</b>：1 个指挥中心 + 2 个建造者，队伍号自动往后排。最多 ${MAX_TEAMS} 支队伍。开了对称时会同时放好对称的出生点。` })));
  const ss = symSec(); if (ss) body.append(ss);
  const o = ed.selected;
  if (o && o.attrs.gid) {
    const unit = objProp(o, 'unit') || o.attrs.name || '对象';
    body.append(sec('选中的单位', null, h('div', { class: 'card' },
      h('div', { style: 'font-weight:600' }, (UNIT_CN[unit] ? UNIT_CN[unit] + ' · ' : '') + unit),
      h('div', { style: 'color:var(--muted);font-size:12px;margin:4px 0' }, `位置：格 (${Math.floor(+o.attrs.x / 20)}, ${Math.floor((+o.attrs.y - 1) / 20)})`),
      h('label', {}, '队伍'), teamSelect(objProp(o, 'team') ?? -1, (v) => { ed.setTeam(o, v); A.refresh('dock'); }),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'danger', onclick: () => { ed.begin('删除单位'); ed.deleteObject(o); ed.commit(); ed.selected = null; rend.request(); A.refresh('dock'); } }, '删除')))));
  }
  const sp = ed.spawns().sort((a, b) => a.team - b.team);
  const list = h('div', { class: 'list' });
  for (const s of sp.slice(0, 300)) {
    list.append(h('button', { class: 'hitem', onclick: () => { rend.centerOn(s.cx / 20, s.cy / 20, Math.max(rend.view.z, 0.6)); ed.selected = s.o; ed.tool.units = 'select'; A.refresh('toolbar', 'dock'); }, html: `<span class="teamdot" style="background:${teamColor(s.team)}"></span>${s.team >= 0 ? '第 ' + (s.team + 1) + ' 队' : '中立'}<small>格 ${Math.floor(s.cx / 20)}, ${Math.floor(s.cy / 20)}</small>` }));
  }
  body.append(sec(`出生点（${sp.length} 个，点一下跳过去）`, 'teams', sp.length ? list : h('div', { class: 'hint' }, '还没有出生点。'),
    sp.length ? h('button', { style: 'margin-top:8px', onclick: () => ed.renumberTeams() }, '队伍号重新编号为 1、2、3…') : null));
}

function toolTriggers(body, T) {
  if (A.hooks.triggerPanel) { A.hooks.triggerPanel(body, T); return; }
  body.append(h('div', { class: 'hint' }, '触发器编辑器加载中…'));
}

function toolGenerate(body) {
  const card = (id) => { const a = action(id); return h('button', { class: 'acard', disabled: a.enabled && !a.enabled(), onclick: () => runAction(a), html: a.iconHtml + `<div><b>${a.label.replace('…', '')}</b><small>${a.desc || (HELP[a.help] || {}).s || ''}</small></div>` }); };
  body.append(sec('整张地图', 'mode.generate', h('div', { class: 'cards' }, ['generate', 'image', 'scale', 'mirror', 'symdiff', 'resize'].map(card))),
    sec('图片', null, h('div', { class: 'cards' }, ['picture', 'trace'].map(card))));
}

function toolTiles(body) {
  const m = ed.map;
  if (!m.layer(ed.rawLayer) && m.layers[0]) ed.rawLayer = m.layers[0].name;
  const sets = m.tilesets.filter((t) => t.image);
  if (!ed.rawTs || !sets.includes(ed.rawTs)) ed.rawTs = sets[0] || null;
  body.append(sec('图块', 'mode.tiles', h('div', { class: 'grid2' },
    h('div', {}, h('label', {}, '画到图层'), select(m.layers.map((L) => [L.name, L.name]), ed.rawLayer, (v) => { ed.rawLayer = v; })),
    h('div', {}, h('label', {}, '图块集'), select(sets.map((t, i) => [i, `${t.name}（${t.tilecount}）`]), sets.indexOf(ed.rawTs), (v) => { ed.rawTs = sets[+v]; A.refresh('dock'); })))));
  if (ed.rawTs) {
    const ts = ed.rawTs;
    const scale = Math.max(1, Math.min(2, Math.floor(280 / ts.image.width) || 1));
    const c = h('canvas', { class: 'tilegrid' });
    c.width = ts.image.width * scale; c.height = Math.min(ts.image.height, 4000) * scale;
    const x = c.getContext('2d');
    const mark = () => {
      x.imageSmoothingEnabled = false; x.clearRect(0, 0, c.width, c.height); x.drawImage(ts.image, 0, 0, c.width, c.height);
      const id = ed.rawGid - ts.firstgid;
      if (id >= 0 && id < ts.tilecount) { x.strokeStyle = '#ffb27a'; x.lineWidth = 2; x.strokeRect((id % ts.columns) * ts.tw * scale + 1, Math.floor(id / ts.columns) * ts.th * scale + 1, ts.tw * scale - 2, ts.th * scale - 2); }
    };
    mark();
    c.onclick = (e) => {
      const r = c.getBoundingClientRect();
      const px = (e.clientX - r.left) * c.width / r.width / scale, py = (e.clientY - r.top) * c.height / r.height / scale;
      const id = Math.floor(py / ts.th) * ts.columns + Math.floor(px / ts.tw);
      if (id >= 0 && id < ts.tilecount) { ed.rawGid = ts.firstgid + id; ed.tool.tiles = 'brush'; mark(); A.refresh('toolbar'); }
    };
    body.append(sec('点选一个图块', null, c));
  }
  body.append(sec('笔刷', null, sizeSec(16)));
  body.append(h('div', { class: 'hint' }, '专家模式：直接放图块，不会自动加过渡。地面不能留空格，所以地面层没有橡皮。'));
}

// ---- 图层 ----
function dockLayers(body) {
  const m = ed.map;
  const rows = h('div');
  for (const L of m.layers) {
    rows.append(h('div', { class: 'layerrow' },
      h('button', { class: 'ib', title: L.visible ? '隐藏' : '显示', onclick: () => { L.visible = !L.visible; rend.invalidateAll(); rend.buildOverview(); A.refresh('dock'); }, html: icon(L.visible ? 'eye' : 'eyeOff') }),
      h('span', { class: 'nm' }, L.name, ' ', h('small', {}, L === m.ground ? '地面' : L === m.items ? '物品' : '图块层'))));
  }
  for (const G of m.groups) {
    rows.append(h('div', { class: 'layerrow' },
      h('button', { class: 'ib', onclick: () => { G.visible = !G.visible; rend.request(); A.refresh('dock'); }, html: icon(G.visible ? 'eye' : 'eyeOff') }),
      h('span', { class: 'nm' }, G.name, ' ', h('small', {}, `对象层 · ${G.objects.length} 个`))));
  }
  body.append(sec('图层', null, rows,
    toggle('其他层变暗（突出当前模式在改的东西）', A.settings.dim, () => A.hooks.toggleDim()),
    toggle('显示网格', A.settings.grid, () => A.hooks.toggleGrid())));
  body.append(sec('叠加图', 'overlay', select([['none', '不叠加'], ['land', '陆军通行'], ['naval', '海军通行'], ['hover', '悬浮通行'], ['build', '可建造区域'], ['territory', '各队地盘'], ['symdiff', '对称差异']], A.overlayKind, (v) => A.hooks.setOverlay(v))));
  body.append(sec('描图参考图', 'trace', rend.reference
    ? h('div', { class: 'row' }, toggle('显示', rend.reference.visible !== false, (v) => { rend.reference.visible = v; rend.request(); }), h('button', { onclick: () => D.traceDialog() }, '调整…'))
    : h('button', { onclick: () => D.traceDialog(), html: icon('trace') + ' 选一张参考图…' })));
  const used = m.usedTilesets();
  const tsRows = h('div');
  for (const ts of m.tilesets) {
    const kb = ts.embeddedPng ? Math.round(ts.embeddedPng.length / 1024) : 0;
    tsRows.append(h('div', { class: 'layerrow' }, h('span', { class: 'nm' }, ts.name || ts.source, ' ', h('small', {}, `${ts.tilecount} 块 · ${kb} KB`)), used.has(ts) ? h('span', { class: 'badge' }, '在用') : h('span', { class: 'badge', style: 'color:var(--warn)' }, '没用到')));
  }
  body.append(sec('图块集', null, tsRows, toggle('保存时去掉没用到的图块集', A.settings.prune, (v) => { A.settings.prune = v; D.saveSettings(); })));
}

// ---- 印章 ----
let stampCache = null;
function dockStamps(body) {
  const grid = h('div', { class: 'stamps' });
  const add = (s) => {
    const b = h('button', { class: 'stamp', title: s.desc, onclick: () => A.hooks.startFloating(s.clip, { label: '放置印章：' + s.cn }) }, stampThumb(ed, rend, s.clip), s.cn);
    if (!s.builtin) b.addEventListener('contextmenu', (e) => { e.preventDefault(); stampMenu(b, s); });
    let tm = 0; b.addEventListener('pointerdown', () => { tm = setTimeout(() => { tm = -1; s.builtin ? toast(s.desc, 4000) : stampMenu(b, s); }, 550); });
    b.addEventListener('pointerup', () => clearTimeout(tm)); b.addEventListener('pointerleave', () => clearTimeout(tm));
    grid.append(b);
  };
  for (const s of builtinStamps(ed)) add(s);
  body.append(sec('内置印章（点一下放置，长按看说明）', 'stamps', grid));
  const ugrid = h('div', { class: 'stamps' });
  body.append(sec('我的印章', null, ugrid, h('div', { class: 'row', style: 'margin-top:8px' },
    h('button', { disabled: !ed.selection, onclick: () => A.hooks.selToStamp(), html: icon('stamp') + ' 选区存为印章' }),
    h('button', { onclick: importStamp, html: icon('import') + ' 导入' }))));
  userStamps().then((list) => {
    if (!list.length) { ugrid.replaceWith(h('div', { class: 'hint' }, '用“框选”选中一块区域，再点“存为印章”，以后就能一键放出同样的内容。')); return; }
    for (const s of list) {
      const b = h('button', { class: 'stamp', title: s.desc, onclick: () => A.hooks.startFloating(s.clip, { label: '放置印章：' + s.cn }) }, stampThumb(ed, rend, s.clip), s.cn);
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); stampMenu(b, s); });
      let tm = 0; b.addEventListener('pointerdown', () => { tm = setTimeout(() => stampMenu(b, s), 550); });
      b.addEventListener('pointerup', () => clearTimeout(tm)); b.addEventListener('pointerleave', () => clearTimeout(tm));
      ugrid.append(b);
    }
  });
}
function stampMenu(anchor, s) {
  menu(anchor, [
    { label: '导出成文件', iconHtml: icon('export'), run: () => saveFile(s.cn + '.rwstamp.json', exportStamp(s), 'application/json') },
    { label: '删除', iconHtml: icon('del'), run: async () => { if (await confirmBox('删除印章？', `删除「${s.cn}」？`, '删除', '取消', true)) { await deleteUserStamp(s.id); A.refresh('dock'); } } },
  ]);
}
async function importStamp() {
  const r = await pickFile('.json,application/json');
  if (!r) return;
  try { const s = importStampText(await r.file.text()); await saveUserStamp(s.name, s.clip); toast('已导入印章：' + s.name); A.refresh('dock'); }
  catch (e) { toast('导入失败：' + e.message); }
}

// ---- 历史 ----
function dockHistory(body) {
  const list = h('div', { class: 'hist' });
  const n = ed.undoStack.length;
  list.append(h('button', { class: 'hitem' + (n === 0 ? ' cur' : ''), onclick: () => { ed.jumpTo(0); } }, '（打开时的样子）'));
  ed.undoStack.forEach((op, i) => list.append(h('button', { class: 'hitem' + (i === n - 1 ? ' cur' : ''), onclick: () => ed.jumpTo(i + 1) }, op.label, h('small', {}, new Date(op.time).toLocaleTimeString().slice(0, 5)))));
  [...ed.redoStack].reverse().forEach((op, i) => list.append(h('button', { class: 'hitem future', onclick: () => ed.jumpTo(n + i + 1) }, op.label, h('small', {}, '已撤销'))));
  body.append(sec(`操作记录（${n} 步，点一下回到那一步）`, 'history', list));
  const snapBox = h('div', { class: 'hist' });
  body.append(sec('快照', null, h('button', { onclick: () => IO.takeSnapshot(), html: icon('save') + ' 存一个快照' }), snapBox));
  IO.snapshots().then((ss) => {
    if (!ss.length) { snapBox.append(h('div', { class: 'hint', style: 'margin-top:8px' }, '快照会保存整张地图，任何时候都能恢复。适合做大改动之前存一下。')); return; }
    for (const s of ss) snapBox.append(h('div', { class: 'layerrow' }, h('span', { class: 'nm' }, s.name, ' ', h('small', {}, new Date(s.time).toLocaleString())),
      h('button', { onclick: () => IO.restoreSnapshot(s) }, '恢复'), h('button', { class: 'ib', title: '删除', onclick: () => IO.deleteSnapshot(s), html: icon('del') })));
  });
}

// ---- 平衡报告 ----
function dockReport(body) {
  const res = A.report;
  body.append(sec('平衡报告', 'report',
    h('p', { style: 'margin:0 0 8px;color:var(--muted);font-size:12.5px' }, '按陆军实际能走的路线（绕开水和悬崖）比较各队。改完地图后重新计算。'),
    h('button', { class: 'primary', onclick: async () => { A.report = await busy('正在计算步行距离…', async () => balanceReport(ed, 30)); if (A.overlayKind === 'territory') A.hooks.setOverlay('territory'); A.refresh('dock'); }, html: icon('report') + (res ? ' 重新计算' : ' 开始计算') })));
  if (!res) return;
  const rows = res.rows;
  if (!rows.length) { body.append(h('div', { class: 'hint' }, '没有出生点，无法计算。')); return; }
  const f = res.fair;
  if (f) {
    const ok = f.nearestSpread <= 3 && f.nearSpread <= 1 && (!f.areaRatio || f.areaRatio < 1.3);
    body.append(h('div', { class: 'hint' + (ok ? '' : ' warnh'), style: 'margin-bottom:10px', html: ok ? '<b>看起来比较公平。</b>各队最近资源池的距离和附近资源数量接近。' :
      `<b>有不平衡的地方：</b>最近资源池距离相差 ${f.nearestSpread} 格，30 格内资源池数量相差 ${f.nearSpread} 个${f.areaRatio ? `，地盘最大是最小的 ${f.areaRatio.toFixed(1)} 倍` : ''}。` }));
  }
  const near = rows.map((r) => r.near).filter((v) => v !== null), nst = rows.map((r) => r.nearest).filter((v) => v !== null);
  const minNear = Math.min(...near), maxNst = Math.max(...nst);
  const tb = h('table', { class: 'rep' }, h('tr', {}, h('th', {}, '队伍'), h('th', {}, '30 格内资源池'), h('th', {}, '最近资源池'), h('th', {}, '地盘'), h('th', {}, '')));
  for (const r of rows.slice(0, 200)) {
    tb.append(h('tr', { style: 'cursor:pointer', onclick: () => rend.centerOn(r.x / 20, r.y / 20, Math.max(rend.view.z, 0.5)) },
      h('td', { html: `<span class="teamdot" style="background:${teamColor(r.team)}"></span>${r.team + 1}` }),
      h('td', { class: r.near !== null && r.near === minNear && near.length > 1 && Math.max(...near) !== minNear ? 'bad' : '' }, r.near ?? '—'),
      h('td', { class: r.nearest !== null && r.nearest === maxNst && nst.length > 1 && Math.min(...nst) !== maxNst ? 'bad' : '' }, r.nearest === null ? '—' : r.nearest + ' 格'),
      h('td', {}, r.area ? r.area.toLocaleString() : '—'),
      h('td', {}, r.island ? h('span', { class: 'badge', style: 'color:var(--warn)', title: '陆军走不到任何敌人' }, '孤岛') : '')));
  }
  body.append(sec('各队对比（点一行跳到出生点）', null, h('div', { style: 'max-height:340px;overflow:auto' }, tb), h('div', { style: 'font-size:11.5px;color:var(--dim);margin-top:4px' }, '“地盘”是按步行距离归到各队的可建造格子数；超过 24 队时只算地盘。')));
  if (res.contested.length) body.append(sec(`公共资源池（${res.contested.length} 个，到最近两队距离接近）`, null, h('div', { class: 'hint' }, '这些资源池会成为争夺点。')));
  if (res.matrix) {
    const mt = h('table', { class: 'rep' }, h('tr', {}, h('th', {}, ''), ...res.teams.map((t) => h('th', {}, t + 1))));
    res.matrix.forEach((row, a) => mt.append(h('tr', {}, h('th', {}, res.teams[a] + 1), ...row.map((d, b) => h('td', {}, a === b ? '·' : d < 0 ? '×' : d)))));
    body.append(sec('出生点之间的步行距离（格，× 表示陆路不通）', null, h('div', { style: 'overflow:auto' }, mt)));
  }
  body.append(h('button', { onclick: () => A.hooks.setOverlay('territory'), html: icon('flag') + ' 在地图上显示各队地盘' }));
}

// ---------------- 欢迎页 ----------------
export async function showWelcome(force = false) {
  const w = $('welcome');
  const tpl = await kvGet('template');
  const recent = await listRecent();
  const canGame = gameFolderSupported();
  const gf = canGame ? await gameFolder() : null;
  w.innerHTML = '';
  const big = (ic, label, sub, fn, dis) => h('button', { class: 'big', disabled: dis, onclick: fn, html: icon(ic) + `<div><b>${label}</b><br><small>${sub}</small></div>` });
  const box = h('div', { class: 'w' },
    h('h1', {}, h('img', { class: 'logo', src: 'icon.svg', alt: '' }), '铁锈地图编辑器'),
    h('p', {}, tpl ? '打开一张地图继续编辑，或者新建一张。不知道从哪开始？试试新手教程。' : '第一次使用：先打开一张你已有的铁锈战争地图（.tmx）。编辑器会从里面取出图块素材，之后新建地图就用这套素材。'),
    h('div', { class: 'acts' },
      big('open', '打开地图', '选择一个 .tmx 文件', () => IO.openMap()),
      big('newfile', '新建地图', tpl ? '选尺寸和人数，自动布点' : '需要先打开一张地图', () => D.newMapDialog(), !tpl),
      canGame ? big('folder', '从游戏文件夹打开', gf ? gf.name : '授权一次游戏地图文件夹', () => IO.openFromGame()) : big('image', '图片转地图', '把一张图变成地图', () => D.imageToMapDialog(), !tpl),
      canGame ? big('image', '图片转地图', '把一张图变成地图', () => D.imageToMapDialog(), !tpl) : null,
      big('tutorial', '新手教程', '跟着做，几分钟学会', () => A.hooks.tutorial()),
      big('help', '帮助中心', '每个功能怎么用', () => import('./help.js').then((m) => m.helpCenter()))));
  if (recent.length) {
    const grid = h('div', { class: 'recents' });
    for (const r of recent) {
      const card = h('button', { class: 'rcard', title: `${r.w}×${r.h}，${r.teams} 支队伍`, onclick: () => IO.openRecent(r) }, h('img', { src: r.thumb, alt: '' }), h('b', {}, r.name), h('small', {}, `${r.w}×${r.h} · ${new Date(r.time).toLocaleDateString()}`));
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(card, [{ label: '从列表移除', run: async () => { await removeRecent(r.id); showWelcome(force); } }]); });
      grid.append(card);
    }
    box.append(h('div', { class: 'recent' }, h('h3', {}, '最近打开'), grid));
  }
  box.append(h('div', { class: 'note' }, '非官方工具。图块素材来自你自己的地图文件，编辑器本身不附带游戏素材。'));
  if (force && ed.map) box.append(h('div', { style: 'text-align:center;margin-top:10px' }, h('button', { onclick: () => w.classList.add('hidden') }, '返回当前地图')));
  w.append(box);
  w.classList.remove('hidden');
}
