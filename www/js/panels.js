// 界面面板：顶栏、菜单栏、模式栏、工具栏、右侧停靠面板、状态栏、欢迎页
import { placeholderRGB } from './tmx.js';
import { A } from './state.js';
import { objProp } from './tmx.js';
import { UNIT_CN, MAX_TEAMS } from './editor.js';
import { teamColor } from './render.js';
import { sizeTier } from './check.js';
import { balanceReport } from './pathing.js';
import { builtinStamps, userStamps, deleteUserStamp, exportStamp, importStampText, saveUserStamp, stampThumb } from './stamps.js';
import { encodeStamp, copyCode, shareCodeDialog } from './share.js';
import { listRecent, removeRecent, gameFolder, gameFolderSupported, saveFile, pickFile } from './files.js';
import { kvGet, kvSet } from './util.js';
import { opStatsText, canDrop, confirmDropOp } from './historyx.js';
import { h, menu, toast, segmented, slider, toggle, select, promptBox, confirmBox, busy } from './ui.js';
import { icon } from './icons.js';
import { helpBtn, HELP, showHelp } from './help.js';
import { ACTIONS, runAction, menuItems, MENU_GROUPS, action } from './actions.js';
import * as IO from './io.js';
import * as D from './dialogs.js';
import * as DU from './detailui.js';

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
  terrain: [['brush', '画笔', 'B', 'terrain.brush'], ['rect', '矩形', 'R', 'terrain.rect'], ['ellipse', '椭圆', 'E', 'terrain.ellipse'], ['fill', '油漆桶', 'F', 'terrain.fill'], ['pick', '吸管', 'I', 'terrain.pick'], ['color', '色块', 'C', 'terrain.color'], '|', ['detail', '细节', 'D', 'terrain.detail'], ['height', '高度', 'U', 'terrain.height'], ['biome', '群系', 'Y', 'terrain.biome'], ['road', '道路', 'O', 'terrain.road'], '|', ['marquee', '框选', 'M', 'select.marquee'], ['wand', '魔棒', 'W', 'select.wand'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  items: [['stamp', '画笔', 'B', 'items.stamp'], ['rect', '矩形', 'R', 'items.shape'], ['ellipse', '椭圆', 'E', 'items.shape'], ['line', '直线', 'L', 'items.shape'], ['fill', '油漆桶', 'F', 'items.shape'], ['random', '随机笔刷', 'N', 'items.random'], ['erase', '橡皮', 'X', 'items.erase'], '|', ['marquee', '框选', 'M', 'select.marquee'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  units: [['spawn', '出生点', 'S', 'units.spawn'], ['unit', '放单位', 'U', 'units.unit'], ['select', '选择', 'V', 'units.select'], ['del', '删除', 'D', 'units.del'], '|', ['marquee', '框选', 'M', 'select.marquee'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  triggers: [['select', '选择', 'V', 'units.select'], ['region', '画区域', 'G', 'mode.triggers'], ['text', '文字', 'T', 'trig.text'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  generate: [['marquee', '框选', 'M', 'select.marquee'], ['wand', '魔棒', 'W', 'select.wand'], '|', ['pan', '拖动', 'H', 'tool.pan']],
  tiles: [['brush', '放图块', 'B', 'tiles.brush'], ['erase', '橡皮', 'X', 'tiles.erase'], ['pick', '吸管', 'I', 'tiles.pick'], '|', ['pan', '拖动', 'H', 'tool.pan']],
};
const TOOL_ICON = { brush: 'brush', rect: 'rect', ellipse: 'ellipse', fill: 'fill', pick: 'pick', pan: 'pan', stamp: 'stamp', random: 'random', erase: 'erase', spawn: 'spawn', unit: 'unit', select: 'select', del: 'del', marquee: 'marquee', wand: 'wand', region: 'region', color: 'palette', line: 'line', text: 'text', detail: 'wand2', height: 'mountain', biome: 'globe', road: 'road' };
const DOCK_TABS = [['tool', '工具', 'settings'], ['layers', '图层', 'layers'], ['stamps', '印章', 'stamp'], ['history', '历史', 'clock'], ['report', '报告', 'report']];

export const tool = () => ed.tool[ed.mode];

const sizeMem = () => (A.settings.toolSizes = A.settings.toolSizes || {});
let sizeSaveT = 0;
function rememberSize() { if (!ed.mode) return; const m = sizeMem(), k = ed.mode + ':' + ed.tool[ed.mode]; if (ed.size && m[k] !== ed.size) { m[k] = ed.size; clearTimeout(sizeSaveT); sizeSaveT = setTimeout(() => import('./util.js').then((u) => u.kvSet('settings', A.settings)), 1500); } }
function recallSize() { const v = sizeMem()[ed.mode + ':' + ed.tool[ed.mode]]; if (v) ed.size = v; }
export function setMode(mode) {
  rememberSize();
  ed.mode = mode;
  ed.showTriggers = mode === 'triggers';
  ed.selected = null;
  const m = MODES.find((x) => x.id === mode);
  rend.activeLayer = m ? m.layer : null;
  if (A.settings.dim) rend.invalidateAll();
  if (!TOOLS[mode].some((t) => Array.isArray(t) && t[0] === ed.tool[mode])) ed.tool[mode] = TOOLS[mode][0][0];
  recallSize();
  A.dockTab = 'tool';
  dropBiomeTint();
  document.getElementById('dock').classList.remove('collapsed');
  A.refresh('modes', 'toolbar', 'dock');
  rend.request();
  A.hooks.coach && A.hooks.coach('mode:' + mode);
}
function dropBiomeTint() { if (rend.tint && rend.tint.kind === 'biome' && !(ed.mode === 'terrain' && ed.tool.terrain === 'biome')) rend.setTint(null); }
export function setTool(t) { rememberSize(); ed.tool[ed.mode] = t; recallSize(); dropBiomeTint(); A.refresh('toolbar', 'dock'); rend.request(); A.hooks.coach && A.hooks.coach('tool:' + t); }

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
  $('btnMod').innerHTML = icon('unit') + '<span>Mod 编辑器</span>';
  $('btnMod').onclick = () => import('./modedit.js').then((m) => m.modEditorDialog());
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
  items.splice(0, 0, { label: '搜索功能…', iconHtml: icon('search'), run: () => A.hooks.palette() }, { label: 'Mod 编辑器', iconHtml: icon('unit'), run: () => import('./modedit.js').then((m) => m.modEditorDialog()) }, { label: '首页（选择工具）', iconHtml: icon('folder'), run: () => showWelcome(true) });
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
  if (T === 'color') { colorPanel(body); return; }
  if (['detail', 'height', 'biome', 'road'].includes(T)) { DU.toolPanel(body, T, sec, sizeSec); return; }
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
    sw.append(h('button', { class: 'sw' + (ed.itemKey === it.key ? ' on' : ''), title: it.name, onclick: () => { ed.itemKey = it.key; if (T === 'erase') ed.tool.items = 'stamp'; A.refresh('dock', 'toolbar'); A.hooks.coach && A.hooks.coach('item:' + it.name); } }, tileThumb(it.stamp ? it.stamp[1][1] : it.rep), it.cn));
  }
  body.append(sec('物品', 'mode.items', sw));
  const it = ed.item();
  if (it && it.pool) body.append(sec('资源池样式', 'items.pool', segmented([['1x1', '1 格（推荐）'], ['3x3', '3×3 带边框']], ed.poolStyle, (v) => { ed.poolStyle = v; A.settings.poolStyle = v; D.saveSettings(); rend.request(); })));
  if (T === 'stamp' || T === 'erase' || T === 'line') body.append(sec(T === 'line' ? '线宽' : '笔刷', null, sizeSec(24)));
  if (T !== 'erase') {
    const dens = slider('密度', 5, 100, Math.round((A.itemDensity ?? 1) * 100), (v) => { A.itemDensity = v / 100; }, { fmt: (v) => v + '%', step: 5 });
    body.append(sec('疏密', 'items.shape', dens,
      it && it.stamp ? slider('最小间距（格，0 = 可以紧挨着）', 0, 30, A.itemSpacing ?? 0, (v) => { A.itemSpacing = v; }, { fmt: (v) => (v ? v + ' 格' : '紧挨着') }) : null,
      T === 'fill' ? toggle('全图同种地面一起放', !!A.fillGlobal, (v) => { A.fillGlobal = v; }) : null));
  }
  const ss = symSec(); if (ss) body.append(ss);
  const how = { stamp: '按住拖动连续放', rect: '拖出一个矩形', ellipse: '拖出一个椭圆', line: '拖出一条线', fill: '点一下，填满同一种地面', erase: '按住拖动擦除' }[T] || '';
  body.append(h('div', { class: 'hint', html: `${how}。` + (it && it.stamp ? `「${it.cn}」按 1 格算：间距 0 就是挨着放，想排密一点直接画。` : '“密度”越低越稀疏，看起来更自然。') + `<br>地图上现在有 <b>${rend.pools.length}</b> 个资源池。资源池可以紧挨着放，只有正上下左右贴着单位时检查才会提醒。` }));
}

// ---- 色块 ----
function colorPanel(body) {
  import('./assets.js').then((AS) => {
    const list = AS.colorList();
    const grid = h('div', { class: 'swatches' });
    for (const e of list) {
      const kind = AS.KINDS.find((k) => k[0] === e.kind) || AS.KINDS[0];
      const b = h('button', { class: 'sw' + (ed.colorGid === e.gid ? ' on' : ''), title: `${e.hex} · ${kind[1]}\n右键或长按：修改 / 删除`, onclick: () => { ed.colorGid = e.gid; A.refresh('dock'); } },
        h('span', { class: 'cchip', style: `background:${e.hex}` }, h('i', { class: 'kmark k-' + e.kind })), kind[1].replace(/（.*）/, ''));
      const edit = async () => {
        const r = await AS.colorPicker({ hex: e.hex, kind: e.kind }, '修改色块');
        if (r) { await AS.addColor(r.hex, r.kind, e.id); A.refresh('dock'); }
      };
      b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); colorMenu(b, e, edit, AS); });
      let tm = 0; b.addEventListener('pointerdown', () => { tm = setTimeout(() => colorMenu(b, e, edit, AS), 550); });
      b.addEventListener('pointerup', () => clearTimeout(tm)); b.addEventListener('pointerleave', () => clearTimeout(tm));
      grid.append(b);
    }
    const add = h('button', { class: 'primary', onclick: async () => { const r = await AS.colorPicker(); if (!r) return; const g = await AS.addColor(r.hex, r.kind); if (g) { ed.colorGid = g; A.refresh('dock'); } }, html: icon('plus') + ' 新建色块' });
    body.append(sec('色块（自己调颜色，选好性质）', 'terrain.color', list.length ? grid : h('div', { class: 'hint' }, '还没有色块。点下面“新建色块”，调好颜色、选好它在游戏里是什么（陆地、水、悬崖……）。'), h('div', { class: 'row', style: 'margin-top:8px' }, add)));
    body.append(sec('形状', 'items.shape', segmented([['brush', '画笔'], ['rect', '矩形'], ['ellipse', '椭圆'], ['line', '直线'], ['fill', '油漆桶']], A.colorShape || 'brush', (v) => { A.colorShape = v; A.refresh('dock'); })));
    if (!A.colorShape || A.colorShape === 'brush' || A.colorShape === 'line') body.append(sec('笔刷', null, sizeSec(64)));
    const ss = symSec(); if (ss) body.append(ss);
    body.append(h('div', { class: 'hint', html: '色块直接替换地面，和旁边的地形之间<b>不会自动过渡</b>。想换回普通地形，用地形画笔画回去就行。' }));
  });
}
function colorMenu(anchor, e, edit, AS) {
  menu(anchor, [
    { label: '修改颜色和性质', iconHtml: icon('palette'), run: edit },
    { label: '删除（地图上没用到时）', iconHtml: icon('del'), run: async () => { if (AS.colorUsed(e.gid)) { toast('地图上还在用这个色块，先把它画掉'); return; } await AS.removeColor(e.id); if (ed.colorGid === e.gid) ed.colorGid = null; A.refresh('dock'); } },
  ]);
}

export function teamSelect(cur, on, withNeutral = true) {
  const opts = [];
  if (withNeutral) opts.push([-1, '中立'], [-2, '敌对（-2）']);
  for (let t = 0; t < MAX_TEAMS; t++) opts.push([t, `第 ${t + 1} 队`]);
  return select(opts, cur, (v) => on(+v));
}

function toolUnits(body, T) {
  if (T === 'unit') unitPalette(body);
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
  body.append(sec('批量编辑单位属性', 'unitprops', h('button', { onclick: () => import('./unitprops.js').then((m) => m.unitPropsDialog()) }, '批量编辑单位属性…')));
}

// ---- 单位面板：图标 + 中文名 + 分类 + 搜索；可以一次放一排 ----
const UNIT_CATS = [['all', '全部'], ['land', '陆军'], ['air', '空军'], ['naval', '海军'], ['build', '建筑'], ['exp', '实验'], ['mod', 'Mod']];
export function unitCat(n) {
  if (/experiment|modularSpider/i.test(n)) return 'exp';
  if (/factory|turret|extractor|fabricator|laboratory|commandCenter|defen[cs]e|launcher|bunker|depot|antiAir|nuke|repair|radar|wall|outpost|crates/i.test(n)) return 'build';
  if (/gunship|helicopter|interceptor|bomber|dropship|airship|jet|fireBee|plane|aircraft/i.test(n)) return 'air';
  if (/boat|ship|sub(marine)?\b|submarine|battleship|lightSub|heavySub/i.test(n) && !/hover/i.test(n)) return 'naval';
  return 'land';
}
function unitPalette(body) {
  const st = A.unitPal || (A.unitPal = { cat: 'all', q: '', n: 1, gap: 2, layout: 'row' });
  const mods = (A.modUnits || []).map((u) => ({ name: u.name, mod: u }));
  const all = [...(ed.unitNames.length ? ed.unitNames : ['commandCenter', 'builder']).map((n) => ({ name: n })), ...mods];
  const grid = h('div', { class: 'unitgrid' });
  const fill = () => {
    grid.innerHTML = '';
    const q = st.q.trim().toLowerCase();
    let n = 0;
    for (const u of all) {
      const cat = u.mod ? 'mod' : unitCat(u.name);
      if (st.cat !== 'all' && st.cat !== cat) continue;
      if (q && !(u.name.toLowerCase().includes(q) || (UNIT_CN[u.name] || '').includes(q))) continue;
      if (++n > 400) break;
      let ic;
      if (u.mod && u.mod.icon) { ic = document.createElement('canvas'); ic.width = ic.height = 36; const x = ic.getContext('2d'); x.imageSmoothingEnabled = false; const im = u.mod.icon, s = Math.min(36 / im.width, 36 / im.height); x.drawImage(im, (36 - im.width * s) / 2, (36 - im.height * s) / 2, im.width * s, im.height * s); }
      else ic = tileThumb(ed.unitGid(u.name, ed.team >= 0 ? ed.team : 0), 36);
      grid.append(h('button', { class: 'ucell' + (ed.unitName === u.name ? ' on' : ''), title: u.name, onclick: () => { ed.unitName = u.name; ed.tool.units = 'unit'; fill(); } }, ic, h('span', {}, UNIT_CN[u.name] || u.name)));
    }
    if (!n) grid.append(h('div', { class: 'hint' }, '没有找到。试试别的关键字，或者换个分类。'));
  };
  const search = h('input', { placeholder: '搜索单位（中文或英文名）', value: st.q, oninput: (e) => { st.q = e.target.value; fill(); } });
  body.append(sec('选单位', 'units.unit', search, h('div', { style: 'margin:6px 0' }, segmented(UNIT_CATS.filter(([k]) => k !== 'mod' || mods.length), st.cat, (v) => { st.cat = v; fill(); })), grid));
  body.append(sec('属于哪个队', 'teams', teamSelect(ed.team, (v) => { ed.team = v; fill(); })));
  body.append(sec('一次放几个', 'units.row', h('div', { class: 'grid3' },
    h('div', {}, h('label', {}, '数量'), h('input', { type: 'number', min: 1, max: 100, value: st.n, onchange: (e) => { st.n = Math.max(1, Math.min(100, +e.target.value || 1)); } })),
    h('div', {}, h('label', {}, '间距（格）'), h('input', { type: 'number', min: 1, max: 20, value: st.gap, onchange: (e) => { st.gap = Math.max(1, Math.min(20, +e.target.value || 1)); } })),
    h('div', {}, h('label', {}, '排法'), select([['row', '横排'], ['col', '竖排'], ['grid', '方阵']], st.layout, (v) => { st.layout = v; })))));
  if (mods.length) body.append(h('div', { class: 'hint warnh' }, 'Mod 单位需要游戏里装了同一个 Mod 才会出现。'));
  fill();
}
export function unitRowPositions(tx, ty) {
  const st = A.unitPal || { n: 1, gap: 2, layout: 'row' };
  const out = [];
  const cols = st.layout === 'grid' ? Math.ceil(Math.sqrt(st.n)) : st.layout === 'row' ? st.n : 1;
  for (let k = 0; k < st.n; k++) {
    const c = k % cols, r = Math.floor(k / cols);
    out.push([tx + c * st.gap - Math.floor((cols - 1) * st.gap / 2), ty + r * st.gap]);
  }
  return out;
}

function toolTriggers(body, T) {
  if (A.hooks.triggerPanel) { A.hooks.triggerPanel(body, T); return; }
  body.append(h('div', { class: 'hint' }, '触发器编辑器加载中…'));
}

function toolGenerate(body) {
  const card = (id) => { const a = action(id); return h('button', { class: 'acard', disabled: a.enabled && !a.enabled(), onclick: () => runAction(a), html: a.iconHtml + `<div><b>${a.label.replace('…', '')}</b><small>${a.desc || (HELP[a.help] || {}).s || ''}</small></div>` }); };
  body.append(sec('整张地图', 'mode.generate', h('div', { class: 'cards' }, ['detail', 'generate', 'image', 'scale', 'mirror', 'symdiff', 'resize'].map(card))),
    sec('多张地图', null, h('div', { class: 'cards' }, ['crosscopy', 'stitch', 'diff', 'library', 'batch', 'pack', 'mods'].map(card))),
    sec('图片', null, h('div', { class: 'cards' }, ['picture', 'trace'].map(card))));
}

function toolTiles(body) {
  const m = ed.map;
  if (!m.layer(ed.rawLayer) && m.layers[0]) ed.rawLayer = m.layers[0].name;
  // 没有图片的地块集（游戏自带的、外部引用的）也能选：图块用同色色块代替
  const sets = m.tilesets.filter((t) => t.image || t.tilecount);
  if (!ed.rawTs || !sets.includes(ed.rawTs)) {
    // 默认选当前图层里用得最多的地块集，比如地面层默认就是地面图块，不是第一个地块集
    const Lr = m.layer(ed.rawLayer), use = new Map();
    if (Lr) { const d = Lr.data, step = Math.max(1, Math.floor(d.length / 20000)); for (let i = 0; i < d.length; i += step) if (d[i]) { const t0 = m.tilesetOf(d[i]); if (t0) use.set(t0, (use.get(t0) || 0) + 1); } }
    const best = [...use].filter(([t0]) => sets.includes(t0)).sort((a, b) => b[1] - a[1])[0];
    ed.rawTs = (best && best[0]) || sets[0] || null;
  }
  body.append(sec('图块', 'mode.tiles', h('div', { class: 'grid2' },
    h('div', {}, h('label', {}, '画到图层'), select(m.layers.map((L) => [L.name, L.name]), ed.rawLayer, (v) => { ed.rawLayer = v; ed.rawTs = null; A.refresh('dock'); })),
    h('div', {}, h('label', {}, '图块集'), select(sets.map((t, i) => [i, `${t.name}（${t.tilecount}）`]), sets.indexOf(ed.rawTs), (v) => { ed.rawTs = sets[+v]; A.refresh('dock'); })))));
  if (ed.rawTs) {
    const ts = ed.rawTs;
    const cols = ts.columns || 8, iw = ts.image ? ts.image.width : cols * ts.tw, ih = ts.image ? ts.image.height : Math.ceil(ts.tilecount / cols) * ts.th;
    const scale = Math.max(1, Math.min(2, Math.floor(280 / iw) || 1));
    const c = h('canvas', { class: 'tilegrid' });
    c.width = iw * scale; c.height = Math.min(ih, 4000) * scale;
    const x = c.getContext('2d');
    const mark = () => {
      x.imageSmoothingEnabled = false; x.clearRect(0, 0, c.width, c.height);
      if (ts.image) x.drawImage(ts.image, 0, 0, c.width, c.height);
      else for (let k = 0; k < ts.tilecount; k++) {   // 没有图片：同色色块 + 图块编号
        const [pr, pg, pb] = placeholderRGB(ts.name || ts.imageSource || ts.source, k);
        const px = (k % cols) * ts.tw * scale, py = Math.floor(k / cols) * ts.th * scale;
        if (py > c.height) break;
        x.fillStyle = `rgb(${pr},${pg},${pb})`; x.fillRect(px, py, ts.tw * scale, ts.th * scale);
        x.fillStyle = 'rgba(0,0,0,.45)'; x.font = `${6 * scale}px sans-serif`; x.fillText(String(k), px + 2, py + 8 * scale);
      }
      const id = ed.rawGid - ts.firstgid;
      if (id >= 0 && id < ts.tilecount) { x.strokeStyle = '#ffb27a'; x.lineWidth = 2; x.strokeRect((id % cols) * ts.tw * scale + 1, Math.floor(id / cols) * ts.th * scale + 1, ts.tw * scale - 2, ts.th * scale - 2); }
    };
    mark();
    c.onclick = (e) => {
      const r = c.getBoundingClientRect();
      const px = (e.clientX - r.left) * c.width / r.width / scale, py = (e.clientY - r.top) * c.height / r.height / scale;
      const id = Math.floor(py / ts.th) * cols + Math.floor(px / ts.tw);
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
    const b = h('button', { class: 'stamp', title: s.desc, onclick: () => A.hooks.startFloating(s.clip, { label: '放置印章：' + s.cn }) }, stampThumb(ed, rend, s.clip), s.builtin === false ? h('span', { translate: 'no' }, s.cn) : s.cn);
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
    h('button', { onclick: importStamp, html: icon('import') + ' 导入' }),
    h('button', { onclick: () => shareCodeDialog('stamp'), html: icon('share') + ' 分享码…' }))));
  userStamps().then((list) => {
    if (!list.length) { ugrid.replaceWith(h('div', { class: 'hint' }, '用“框选”选中一块区域，再点“存为印章”，以后就能一键放出同样的内容。')); return; }
    for (const s of list) {
      const b = h('button', { class: 'stamp', title: s.desc, onclick: () => A.hooks.startFloating(s.clip, { label: '放置印章：' + s.cn }) }, stampThumb(ed, rend, s.clip), s.builtin === false ? h('span', { translate: 'no' }, s.cn) : s.cn);
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); stampMenu(b, s); });
      let tm = 0; b.addEventListener('pointerdown', () => { tm = setTimeout(() => stampMenu(b, s), 550); });
      b.addEventListener('pointerup', () => clearTimeout(tm)); b.addEventListener('pointerleave', () => clearTimeout(tm));
      ugrid.append(b);
    }
  });
}
function stampMenu(anchor, s) {
  menu(anchor, [
    { label: '复制分享码', iconHtml: icon('share'), run: async () => {
      try {
        const code = await encodeStamp(s);
        const ok = await copyCode(code);
        toast(ok ? `分享码已复制（${code.length} 个字符），发到群里就能导入` : `分享码（手动复制）：${code.slice(0, 120)}…`, ok ? 3000 : 6000);
      } catch (e) { toast('生成分享码失败：' + e.message); }
    } },
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
  const q = h('input', { placeholder: '搜索操作（比如“画地形”“填满空格”）…' });
  const n = ed.undoStack.length;
  const total = ed.undoStack.length;
  const draw = () => {
    const kw = q.value.trim().toLowerCase();
    list.innerHTML = '';
    const rows = [];
    if (!kw) rows.push(h('button', { class: 'hitem' + (n === 0 ? ' cur' : ''), onclick: () => ed.jumpTo(0) }, '（打开时的样子）'));
    ed.undoStack.forEach((op, i) => {
      if (kw && !op.label.toLowerCase().includes(kw)) return;
      rows.push(h('div', { class: 'hrow' },
        h('button', { class: 'hitem' + (i === n - 1 ? ' cur' : ''), style: 'flex:1;text-align:left', onclick: () => ed.jumpTo(i + 1) },
          h('span', {}, op.label),
          h('small', {}, ' ' + new Date(op.time).toLocaleTimeString().slice(0, 5)),
          h('small', { class: 'hstat' }, opStatsText(i))),
        h('button', { class: 'ib hdrop', title: '只撤销这一步（保留后面的步骤）', 'aria-label': '单独撤销', disabled: !canDrop(i), onclick: async (e) => { e.stopPropagation(); if (await confirmDropOp(i)) { q.value = ''; A.refresh('dock'); } }, html: icon('del') })));
    });
    [...ed.redoStack].reverse().forEach((op, i) => {
      if (kw && !op.label.toLowerCase().includes(kw)) return;
      rows.push(h('button', { class: 'hitem future', onclick: () => ed.jumpTo(n + i + 1) }, op.label, h('small', {}, '已撤销')));
    });
    if (!rows.length) rows.push(h('div', { class: 'hint' }, kw ? '没有匹配的操作' : '还没有操作。画一笔、挪一个东西，这里就会出现记录。'));
    list.append(...rows);
  };
  draw();
  q.addEventListener('input', draw);
  body.append(sec(`操作记录（${total} 步 · 点一下回到那一步 · ✕ 只撤销这一步）`, 'history', q, list));
  const snapBox = h('div', { class: 'hist' });
  body.append(sec('快照', null, h('button', { onclick: () => IO.takeSnapshot(), html: icon('save') + ' 存一个快照' }), snapBox));
  IO.snapshots().then((ss) => {
    if (!ss.length) { snapBox.append(h('div', { class: 'hint', style: 'margin-top:8px' }, '快照会保存整张地图，任何时候都能恢复。适合做大改动之前存一下。')); return; }
    for (const s of ss) snapBox.append(h('div', { class: 'layerrow' }, h('span', { class: 'nm' }, h('span', { translate: 'no' }, s.name), ' ', h('small', {}, new Date(s.time).toLocaleString())),
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
      `<b>有不平衡的地方：</b>最近资源池距离相差 ${f.nearestSpread} 格，30 格内资源池数量相差 ${f.nearSpread} 个${f.areaRatio ? `，地盘最大是最小的 ${f.areaRatio.toFixed(1)} 倍` : ''}。可以点下面的“一键平衡”。` }));
    if (!ok) body.append(h('button', { class: 'primary', style: 'margin-bottom:10px', onclick: () => import('./balance.js').then((m) => m.balanceDialog()).catch((e) => toast('一键平衡不可用：' + e.message)), html: icon('report') + ' 一键平衡…' }));
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
  body.append(h('div', { class: 'row' }, h('button', { onclick: () => A.hooks.setOverlay('territory'), html: icon('flag') + ' 在地图上显示各队地盘' }), h('button', { onclick: () => import('./tools2.js').then((m) => m.timingDialog()), html: icon('timer') + ' 开局推演' })));
}

// ---------------- 欢迎页 ----------------
export async function showWelcome(force = false) {
  const w = $('welcome');
  const tpl = await kvGet('template');
  const pins = (await kvGet('pins')) || [];
  const recent = (await listRecent()).sort((a, b) => (pins.includes(b.id) - pins.includes(a.id)));
  const canGame = gameFolderSupported();
  const gf = canGame ? await gameFolder() : null;
  w.innerHTML = '';
  const big = (ic, label, sub, fn, dis) => h('button', { class: 'big', disabled: dis, onclick: fn, html: icon(ic) + `<div><b>${label}</b><br><small>${sub}</small></div>` });
  let tool = 'map'; try { tool = localStorage.getItem('rwTool') || 'map'; } catch { /* 记不住就用默认 */ }
  const modAuto = await kvGet('modAuto'), modRec = (await kvGet('modRecents')) || [];
  const openMod = (o) => import('./modedit.js').then((m) => m.modEditorDialog(o));
  const pick = (id, ic, title, sub, tag) => h('button', { class: 'pick' + (tool === id ? ' on' : ''), 'aria-pressed': String(tool === id), onclick: () => { try { localStorage.setItem('rwTool', id); } catch { /* 忽略 */ } showWelcome(force); }, html: icon(ic) + `<b>${title}</b><small>${sub}</small>` + (tag ? `<span class="tag">${tag}</span>` : '') });
  const intro = tpl ? '打开一张地图继续编辑，或者新建一张。不知道从哪开始？试试新手教程。' : '第一次使用：先打开一张你已有的铁锈战争地图（.tmx）。编辑器会从里面取出图块素材，之后新建地图就用这套素材。';
  const box = h('div', { class: 'w' },
    h('h1', {}, h('img', { class: 'logo', src: 'icon.svg', alt: '' }), '铁锈战争工具箱'),
    h('div', { class: 'picks' },
      pick('map', 'mountain', '地图编辑器', '画地形、放资源池和出生点、检查、保存 .tmx', '推荐新手'),
      pick('mod', 'unit', 'Mod 编辑器', '改单位数值、检查问题、打包 .rwmod')));
  const mapActs = h('div', { class: 'acts' },
      big('open', '打开地图', '选择一个 .tmx 文件', () => IO.openMap()),
      big('newfile', '新建地图', tpl ? '选尺寸和人数，自动布点' : '需要先打开一张地图', () => D.newMapDialog(), !tpl),
      big('wand2', '设计向导', tpl ? '回答几个问题，自动做一张能玩的图' : '需要先打开一张地图', () => import('./wizard.js').then((m) => m.wizardDialog()), !tpl),
      canGame ? big('folder', '从游戏文件夹打开', gf ? gf.name : '授权一次游戏地图文件夹', () => IO.openFromGame()) : big('image', '图片转地图', '把一张图变成地图', () => D.imageToMapDialog(), !tpl),
      canGame ? big('image', '图片转地图', '把一张图变成地图', () => D.imageToMapDialog(), !tpl) : null,
      big('tutorial', '新手教程', '跟着做，几分钟学会', () => A.hooks.tutorial()),
      big('help', '帮助中心', '每个功能怎么用', () => import('./help.js').then((m) => m.helpCenter())));
  const mapRecent = [];
  if (recent.length) {
    const grid = h('div', { class: 'recents' });
    for (const r of recent) {
      const card = h('button', { class: 'rcard', title: `${r.w}×${r.h}，${r.teams} 支队伍`, onclick: () => IO.openRecent(r) }, h('img', { src: r.thumb, alt: '' }), h('b', { translate: 'no' }, (pins.includes(r.id) ? '★ ' : '') + r.name), h('small', {}, `${r.w}×${r.h} · ${new Date(r.time).toLocaleDateString()}`));
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(card, [{ label: pins.includes(r.id) ? '取消固定' : '固定在最前', run: async () => { await kvSet('pins', pins.includes(r.id) ? pins.filter((x) => x !== r.id) : [...pins, r.id]); showWelcome(force); } }, { label: '从列表移除', run: async () => { await removeRecent(r.id); showWelcome(force); } }]); });
      grid.append(card);
    }
    mapRecent.push(h('div', { class: 'recent' }, h('h3', {}, '最近打开'), grid));
  }
  const modActs = h('div', { class: 'acts' },
    big('open', '打开 Mod', '.rwmod / zip / 项目文件', () => openMod({ action: 'open' })),
    big('folder', '打开文件夹', '解压后的 Mod 文件夹', () => openMod({ action: 'folder' })),
    big('newfile', '新建 Mod', '从一个示例单位开始', () => openMod({ action: 'new' })),
    big('tutorial', 'Mod 新手教程', '改一个单位并打包', () => A.hooks.tutorial('mod')),
    big('help', '帮助中心', '每个功能怎么用', () => import('./help.js').then((m) => m.helpCenter())));
  const modExtra = [];
  if (modAuto) modExtra.push(h('div', { class: 'mrec' }, h('b', {}, '发现未保存的 Mod：' + modAuto.name), h('button', { class: 'primary', onclick: () => openMod({ action: 'recover' }) }, '恢复')));
  if (modRec.length) modExtra.push(h('div', { class: 'recent' }, h('h3', {}, '最近打开'), ...modRec.map((x) => h('div', { class: 'mrec' }, h('span', { translate: 'no' }, x.name), h('small', {}, new Date(x.time).toLocaleDateString()), h('button', { onclick: () => openMod({ load: x }) }, '打开')))));
  box.append(tool === 'mod' ? h('div', { class: 'sec' }, h('p', {}, '打开一个 Mod，就能浏览里面的单位、改数值、检查问题并重新打包。操作和地图编辑器差不多：Ctrl+S 保存（打包）、Ctrl+Z 撤销。'), modActs, ...modExtra)
    : h('div', { class: 'sec' }, h('p', {}, intro), mapActs, ...mapRecent));
  box.append(h('div', { class: 'note' }, '非官方工具。图块素材来自你自己的地图文件，编辑器本身不附带游戏素材。'));
  if (force && ed.map) box.append(h('div', { style: 'text-align:center;margin-top:10px' }, h('button', { onclick: () => w.classList.add('hidden') }, '返回当前地图')));
  w.append(box);
  w.classList.remove('hidden');
}
