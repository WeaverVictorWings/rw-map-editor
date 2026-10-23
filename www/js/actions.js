// 功能清单：菜单、功能搜索、快捷键都从这里来
import { A } from './state.js';
import { icon } from './icons.js';
import * as D from './dialogs.js';
import * as IO from './io.js';
import { helpCenter, showHelp } from './help.js';

const ed = A.ed;
const has = () => !!ed.map;
const hasEng = () => !!(ed.map && ed.engine);

// group 决定出现在哪个菜单；help 指向帮助条目
export const ACTIONS = [
  // 文件
  { id: 'new', group: '文件', label: '新建地图', icon: 'newfile', keys: 'Ctrl+N', desc: '选尺寸、人数，自动生成出生点和资源池', run: () => D.newMapDialog() },
  { id: 'open', group: '文件', label: '打开地图…', icon: 'open', keys: 'Ctrl+O', run: () => IO.openMap() },
  { id: 'openGame', group: '文件', label: '从游戏文件夹打开…', icon: 'folder', desc: '直接列出游戏地图文件夹里的地图', run: () => IO.openFromGame() },
  { id: 'recent', group: '文件', label: '最近打开…', icon: 'clock', run: () => A.hooks.showWelcome(true) },
  { sep: true, group: '文件' },
  { id: 'save', group: '文件', label: '保存', icon: 'save', keys: 'Ctrl+S', enabled: has, run: () => IO.saveMap() },
  { id: 'saveAs', group: '文件', label: '另存为…', icon: 'save', keys: 'Ctrl+Shift+S', enabled: has, run: () => IO.saveMap(true) },
  { id: 'saveGame', group: '文件', label: '保存到游戏文件夹', icon: 'saveGame', desc: '地图和预览图一起存进游戏，打开就能玩', enabled: has, help: 'saveGame', run: () => IO.saveToGameFlow() },
  { id: 'export', group: '文件', label: '导出预览图 / 展示图…', icon: 'image', enabled: has, help: 'preview', run: () => D.previewDialog() },
  { sep: true, group: '文件' },
  { id: 'library', group: '文件', label: '地图库…', icon: 'library', desc: '所有做过、打开过的地图，带缩略图和标签', help: 'tool.library', run: () => import('./tools2.js').then((m) => m.libraryDialog()) },
  { id: 'batch', group: '文件', label: '批量处理…', icon: 'batch', desc: '一次检查、修复一堆地图，生成封面', help: 'tool.batch', run: () => import('./tools2.js').then((m) => m.batchDialog()) },
  { id: 'pack', group: '文件', label: '打包地图合集（Mod）…', icon: 'package', desc: '把几张地图打包成 .rwmod', help: 'tool.pack', run: () => import('./tools2.js').then((m) => m.packDialog()) },
  { id: 'mods', group: '文件', label: 'Mod 支持…', icon: 'import', desc: '导入 Mod 的单位和图块集', help: 'tool.mod', run: () => import('./tools2.js').then((m) => m.modDialog()) },
  { sep: true, group: '文件' },
  { id: 'template', group: '文件', label: '图块素材来源…', icon: 'tiles', help: 'template', run: () => D.templateDialog() },
  { id: 'settings', group: '文件', label: '设置…', icon: 'settings', run: () => D.settingsDialog() },
  // 编辑
  { id: 'undo', group: '编辑', label: '撤销', icon: 'undo', keys: 'Ctrl+Z', enabled: () => ed.undoStack.length > 0, run: () => ed.undo() },
  { id: 'redo', group: '编辑', label: '重做', icon: 'redo', keys: 'Ctrl+Y', enabled: () => ed.redoStack.length > 0, run: () => ed.redo() },
  { sep: true, group: '编辑' },
  { id: 'copy', group: '编辑', label: '复制', icon: 'copy', keys: 'Ctrl+C', enabled: () => !!ed.selection, run: () => A.hooks.selCopy() },
  { id: 'cut', group: '编辑', label: '剪切', icon: 'cut', keys: 'Ctrl+X', enabled: () => !!ed.selection, run: () => A.hooks.selCut() },
  { id: 'paste', group: '编辑', label: '粘贴', icon: 'paste', keys: 'Ctrl+V', enabled: () => !!ed.clipboard, help: 'sel.paste', run: () => A.hooks.paste() },
  { id: 'selAll', group: '编辑', label: '全选', icon: 'marquee', keys: 'Ctrl+A', enabled: has, run: () => A.hooks.selectAll() },
  { id: 'deselect', group: '编辑', label: '取消选择', icon: 'close', keys: 'Esc', enabled: () => !!ed.selection, run: () => A.hooks.deselect() },
  { sep: true, group: '编辑' },
  { id: 'flipH', group: '编辑', label: '选区左右翻转', icon: 'flipH', enabled: () => !!ed.selection, help: 'sel.flipH', run: () => A.hooks.selTransform('h') },
  { id: 'flipV', group: '编辑', label: '选区上下翻转', icon: 'flipV', enabled: () => !!ed.selection, run: () => A.hooks.selTransform('v') },
  { id: 'rot', group: '编辑', label: '选区旋转 90°', icon: 'rotate', enabled: () => !!ed.selection, run: () => A.hooks.selTransform('cw') },
  { id: 'toStamp', group: '编辑', label: '选区存为印章…', icon: 'stamp', enabled: () => !!ed.selection, help: 'sel.stamp', run: () => A.hooks.selToStamp() },
  { id: 'history', group: '编辑', label: '历史记录', icon: 'clock', desc: '查看每一步，点一下跳回去；保存快照', help: 'history', run: () => A.hooks.openDock('history') },
  // 地图
  { id: 'checklist', group: '地图', label: '试玩检查清单…', icon: 'batch', desc: '进游戏要测哪几项，记下每次测试的结果', enabled: has, help: 'tool.checklist', kw: '测试 清单', run: () => import('./extras.js').then((m) => m.checklistDialog()) },
  { id: 'score', group: '地图', label: '地图体检评分…', icon: 'report', desc: '给地图打分，告诉你扣分在哪、怎么改', enabled: has, help: 'tool.score', kw: '评分 打分', run: () => import('./extras.js').then((m) => m.scoreDialog()) },
  { id: 'check', group: '地图', label: '能玩吗？检查', icon: 'inspect', desc: '保存前检查地图能不能在游戏里正常玩', enabled: has, help: 'check', run: () => D.openChecks() },
  { id: 'report', group: '地图', label: '平衡报告', icon: 'report', desc: '按步行路线比较各队资源和地盘', enabled: has, help: 'report', run: () => A.hooks.openDock('report') },
  { id: 'symdiff', group: '地图', label: '对称差异检查…', icon: 'sym', enabled: has, help: 'symdiff', run: () => D.symDiffDialog() },
  { sep: true, group: '地图' },
  { id: 'generate', group: '地图', label: '随机生成…', icon: 'dice', desc: '按预设和种子号生成地形、出生点、资源池', enabled: hasEng, help: 'generator', kw: '随机 地形 生成 分享码', run: () => D.generatorDialog() },
  { id: 'image', group: '地图', label: '图片转地图…', icon: 'image', desc: '把图片变成地图，地形比例由你控制', help: 'image2map', kw: '照片 截图 像素', run: () => D.imageToMapDialog() },
  { id: 'scale', group: '地图', label: '等比缩放…', icon: 'scale', desc: '整张地图放大或缩小，资源和出生点智能重排', enabled: hasEng, help: 'scale', kw: '放大 缩小 倍', run: () => D.scaleDialog() },
  { id: 'mirror', group: '地图', label: '整图镜像…', icon: 'mirror', desc: '画好半张图，一键变成对称图', enabled: has, help: 'mirror', kw: '对称', run: () => D.mirrorDialog() },
  { id: 'resize', group: '地图', label: '调整画布大小…', icon: 'resize', enabled: has, help: 'resize', run: () => D.resizeDialog() },
  { sep: true, group: '地图' },
  { id: 'picture', group: '地图', label: '立绘贴图…', icon: 'picture', desc: '把图片贴进地图（切成小块嵌入）', enabled: has, help: 'picture', kw: '图片 头像 logo', run: () => D.pictureDialog() },
  { id: 'trace', group: '地图', label: '描图参考图…', icon: 'trace', desc: '把一张图半透明叠在地图上照着画', enabled: has, help: 'trace', run: () => D.traceDialog() },
  { id: 'stamps', group: '地图', label: '印章库', icon: 'stamp', desc: '标准基地、资源点、湖泊等一键放置', enabled: has, help: 'stamps', run: () => A.hooks.openDock('stamps') },
  { id: 'detail', group: '地图', label: '自动丰富细节…', icon: 'wand2', desc: '预设 + 修改器堆叠，一键让地形更丰富，可预览、可多版本对比', enabled: () => !!(ed.map && ed.engine), help: 'detail.stack', kw: '细节 预设 森林 沙漠 雪地 河流 群岛', run: () => import('./detailui.js').then((m) => m.detailDialog()) },
  { id: 'timing', group: '地图', label: '开局推演…', icon: 'timer', desc: '估算各队多少秒会遇到敌人、多久到中央', enabled: has, help: 'tool.timing', kw: 'rush 速度 时间', run: () => import('./tools2.js').then((m) => m.timingDialog()) },
  { id: 'crosscopy', group: '地图', label: '从别的地图复制…', icon: 'copy', desc: '打开另一张图，框选一块搬过来', enabled: has, help: 'tool.crosscopy', run: () => import('./tools2.js').then((m) => m.crossCopyDialog()) },
  { id: 'stitch', group: '地图', label: '地图拼接…', icon: 'puzzle', desc: '把几张图拼成一张大图', help: 'tool.stitch', run: () => import('./tools2.js').then((m) => m.stitchDialog()) },
  { id: 'diff', group: '地图', label: '版本对比…', icon: 'diff', desc: '和快照对比，标出哪里改了，可以恢复一块', enabled: has, help: 'tool.diff', run: () => import('./tools2.js').then((m) => m.diffDialog()) },
  { id: 'log', group: '地图', label: '作战日志…', icon: 'log', desc: '按时间编辑游戏里滚动显示的消息', enabled: has, help: 'trig.log', run: () => import('./triggers.js').then((m) => m.logDialog()) },
  { id: 'fixtiles', group: '地图', label: '补上缺少的地块图…', icon: 'tiles', enabled: has, run: () => import('./assets.js').then((m) => m.missingDialog()) },
  { id: 'teams', group: '地图', label: '队伍号重新编号', icon: 'flag', desc: '把队伍号整理成 1、2、3…', enabled: has, run: () => ed.renumberTeams() },
  // 视图
  { id: 'fit', group: '视图', label: '显示整张地图', icon: 'fit', keys: '0', enabled: has, run: () => A.rend.fit() },
  { id: 'zoom100', group: '视图', label: '实际大小（100%）', icon: 'zoomIn', keys: '1:1', enabled: has, run: () => A.rend.setZoom(1) },
  { id: 'grid', group: '视图', label: '网格', icon: 'grid', check: () => A.settings.grid, run: () => A.hooks.toggleGrid() },
  { id: 'dim', group: '视图', label: '其他层变暗', icon: 'dim', check: () => A.settings.dim, help: 'dim', run: () => A.hooks.toggleDim() },
  { title: '叠加图', group: '视图' },
  { id: 'ov-none', group: '视图', label: '不叠加', check: () => A.overlayKind === 'none', run: () => A.hooks.setOverlay('none') },
  { id: 'ov-land', group: '视图', label: '陆军通行', icon: 'path', check: () => A.overlayKind === 'land', help: 'overlay', kw: '通行', run: () => A.hooks.setOverlay('land') },
  { id: 'ov-naval', group: '视图', label: '海军通行', icon: 'wave', check: () => A.overlayKind === 'naval', run: () => A.hooks.setOverlay('naval') },
  { id: 'ov-hover', group: '视图', label: '悬浮通行', icon: 'path', check: () => A.overlayKind === 'hover', run: () => A.hooks.setOverlay('hover') },
  { id: 'ov-build', group: '视图', label: '可建造区域', icon: 'units', check: () => A.overlayKind === 'build', run: () => A.hooks.setOverlay('build') },
  { id: 'ov-territory', group: '视图', label: '各队地盘', icon: 'flag', check: () => A.overlayKind === 'territory', run: () => A.hooks.setOverlay('territory') },
  // 帮助
  { id: 'tutorial', group: '帮助', label: '新手教程', icon: 'tutorial', desc: '跟着做，几分钟学会基本操作', run: () => A.hooks.tutorial() },
  { id: 'helpCenter', group: '帮助', label: '帮助中心', icon: 'help', keys: 'F1', run: () => helpCenter() },
  { id: 'gestures', group: '帮助', label: '手势与快捷键', icon: 'book', run: () => showHelp('gestures') },
  { id: 'search', group: '帮助', label: '搜索功能', icon: 'search', keys: 'Ctrl+K', hidden: true, run: () => A.hooks.palette() },
];
for (const a of ACTIONS) if (a.icon) a.iconHtml = icon(a.icon);

export function action(id) { return ACTIONS.find((a) => a.id === id); }
export function runAction(a) {
  if (typeof a === 'string') a = action(a);
  if (!a || (a.enabled && !a.enabled())) return;
  try { const r = a.run(); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); }
}
export function menuItems(group) {
  return ACTIONS.filter((a) => a.group === group).map((a) => a.sep ? { sep: true } : a.title ? { title: a.title } : {
    label: a.label, iconHtml: a.check ? '' : a.iconHtml, keys: a.keys, disabled: a.enabled && !a.enabled(), check: a.check && a.check(), run: () => runAction(a),
  });
}
export const MENU_GROUPS = ['文件', '编辑', '地图', '视图', '帮助'];
