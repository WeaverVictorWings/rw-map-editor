// 铁锈地图编辑器 2.0 —— 启动与各模块的连接
import { A } from './state.js';
import * as P from './panels.js';
import { initInput } from './input.js';
import { initTriggers, triggerIssues } from './triggers.js';
import { initTutorial } from './tutorial.js';
import * as IO from './io.js';
import * as D from './dialogs.js';
import { ACTIONS, runAction } from './actions.js';
import { commandPalette, toast, confirmBox, busy, modalOpen, closeModal } from './ui.js';
import { passability, overlayColor } from './pathing.js';
import { runChecks } from './check.js';
import { teamColor } from './render.js';
import { kvGet, kvDel } from './util.js';
import { isNative, nativePlugin } from './files.js';
import { scaleMap, mirrorMap, symmetryDiff, copySelection, pasteClip, rectSelection } from './transform.js';
import { generateMap } from './gen.js';
import { balanceReport } from './pathing.js';

const ed = A.ed, rend = A.rend, mini = A.mini;
const $ = (id) => document.getElementById(id);

// ---------------- 叠加图 ----------------
function rgbaOf(css, a) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = css; const s = c.fillStyle; // 统一成 #rrggbb
  const n = parseInt(s.slice(1), 16);
  return ((a << 24) | (((n) & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0;
}
let ovTimer = 0;
async function setOverlay(kind) {
  A.overlayKind = kind;
  if (!ed.map || kind === 'none') { rend.setTint(null); A.refresh('modes', 'dock'); return; }
  if (kind === 'symdiff') {
    if (!A.symDiff) A.symDiff = symmetryDiff(ed, A.settings.symDiffKind);
    const d = A.symDiff.diff, red = rgbaOf(A.settings.colorblind ? '#e69f00' : '#f2545b', 170);
    rend.setTint({ kind, fn: (i) => (d[i] ? red : 0), opacity: 1 });
  } else if (kind === 'territory') {
    if (!A.report) A.report = await busy('正在计算各队地盘…', async () => balanceReport(ed, 30));
    const own = A.report.owner, cols = A.report.teams.map((t) => rgbaOf(teamColor(t), 105));
    rend.setTint({ kind, fn: (i) => (own[i] >= 0 ? cols[own[i]] : 0), opacity: 1 });
  } else {
    const pass = passability(ed);
    const cb = !!A.settings.colorblind;
    rend.setTint({ kind, fn: (i) => overlayColor(kind, pass[i], cb), opacity: 1 });
  }
  A.refresh('modes', 'dock');
  A.hooks.coach && A.hooks.coach('overlay:' + kind);
}
function refreshOverlaySoon() {
  if (A.overlayKind === 'none') return;
  clearTimeout(ovTimer);
  ovTimer = setTimeout(() => {
    if (A.overlayKind === 'territory') A.report = null;
    if (A.overlayKind === 'symdiff') A.symDiff = null;
    setOverlay(A.overlayKind);
  }, 700);
}

// ---------------- 编辑器事件 ----------------
function onEditorEvent(ev) {
  if (ev === 'map') {
    // 尺寸可能变了（撤销整图操作、缩放）
    if (rend.map === ed.map) { rend.clearCaches(); rend.buildColors(); rend.buildOverview(); rend.pools = ed.poolTiles(); mini.rebuild(); }
    A.report = null; A.symDiff = null;
    if (ed.selection || ed.floating) { ed.selection = null; if (ed.floating) A.hooks.cancelFloat(); A.hooks.renderSelbar && A.hooks.renderSelbar(); }
    A.refresh();
    return;
  }
  if (ev === 'edit') { import('./feel.js').then((m) => m.buzz(8)); A.autoDirty = true; A.lastEditTime = Date.now(); A.report = null; A.refresh('top'); refreshOverlaySoon(); if (A.dockTab === 'history' || ed.mode === 'triggers' || ed.mode === 'units') A.refresh('dock'); return; }
  if (ev === 'palette') { A.refresh('dock'); return; }
  if (ev && ev.type === 'changed') {
    A.autoDirty = true;
    if (ev.full || !ev.box) rend.invalidateAll(); else rend.invalidate(ev.box.x0 - 1, ev.box.y0 - 1, ev.box.x1 + 1, ev.box.y1 + 1);
    rend.pools = ed.poolTiles();
    mini.schedule();
    A.report = null;
    refreshOverlaySoon();
    A.refresh('top', 'dock');
    rend.request();
  }
}

let stPending = false;
function scheduleStatus() { if (stPending) return; stPending = true; setTimeout(() => { stPending = false; P.renderStatus(A.mouse); }, 120); }

// ---------------- 自动保存 ----------------
let autoTimer = 0;
function resetAutosave() { clearInterval(autoTimer); autoTimer = setInterval(() => IO.autosave(), Math.max(10, A.settings.autosaveSec || 30) * 1000); }

// ---------------- 启动 ----------------
async function startup() {
  const auto = await kvGet('autosave');
  if (auto && auto.text) {
    const when = new Date(auto.time).toLocaleString();
    const ok = await confirmBox('恢复上次的地图？', `发现一份自动保存的「${auto.name || '未命名'}」（${when}）。上次可能没来得及保存。`, '恢复', '不用了');
    if (ok) {
      try {
        await busy('正在恢复…', () => IO.loadMapFromText(auto.text, (auto.name || '未命名') + '.tmx', null, { noRecent: true }));
        ed.dirty = true; A.autoDirty = false; A.refresh('top');
        return;
      } catch (e) { console.error(e); toast('恢复失败：' + e.message); }
    }
    await kvDel('autosave');
  }
  P.showWelcome();
}

function setupBack() {
  const App = nativePlugin('App');
  if (!App || !App.addListener) return;
  App.addListener('backButton', async () => {
    if (modalOpen()) { closeModal(); return; }
    if (ed.floating) { A.hooks.cancelFloat(); return; }
    if (ed.selection) { A.hooks.deselect(); return; }
    if (!$('welcome').classList.contains('hidden') && ed.map) { $('welcome').classList.add('hidden'); return; }
    if (ed.dirty) {
      const ok = await confirmBox('退出编辑器？', '地图还没保存。自动保存的副本下次打开时可以恢复。', '退出');
      if (!ok) return;
      await IO.autosave(true);
    }
    App.exitApp();
  });
}

async function init() {
  const I18N = await import('./i18n.js');
  // 地图里玩家自己写的名字和文字不参与界面翻译
  I18N.setUserStrings(() => {
    const out = [A.mapName];
    const m = ed.map;
    if (m) for (const G of m.groups) for (const o of G.objects) { out.push(o.attrs.name); for (const p of o.props) if (typeof p.value === 'string') out.push(p.value); }
    return out;
  });
  await I18N.initI18n();
  const firstRun = !(await kvGet('settings'));
  await D.loadSettings();
  if (A.settings.simple === undefined) A.settings.simple = firstRun;
  import('./feel.js').then((m) => m.applyLook());
  import('./safety.js').then((m) => m.installErrorCapture());
  import('./backup.js').then((m) => m.startAutoBackup(A.settings.backupMin ?? 5));
  rend.showGrid = A.settings.grid;
  rend.dimOthers = A.settings.dim;
  ed.poolStyle = A.settings.poolStyle || '1x1';
  Object.assign(A.hooks, {
    top: P.renderTop, toolbar: P.renderToolbar, dock: P.renderDock, modes: P.renderModes,
    showWelcome: P.showWelcome, openMap: IO.openMap, openChecks: D.openChecks, resetAutosave,
    openDock(tab) { A.dockTab = tab; $('dock').classList.remove('collapsed'); P.renderDock(); },
    toggleGrid() { A.settings.grid = !A.settings.grid; rend.showGrid = A.settings.grid; D.saveSettings(); A.refresh('modes', 'dock'); rend.request(); },
    toggleDim() { A.settings.dim = !A.settings.dim; rend.dimOthers = A.settings.dim; rend.invalidateAll(); D.saveSettings(); A.refresh('modes', 'dock'); },
    setOverlay,
    setReference(ref) { rend.reference = ref; rend.request(); A.refresh('dock'); },
    palette() { commandPalette(ACTIONS, runAction); },
  });
  P.initChrome();
  // 帮助条目静态化：懒加载模块里的 HELP 要等用户点开才注册，这里预先补上
  import('./helpstatic.js').catch(() => {});
  // 快捷工具栏：用户配过才显示（mountQuickbar 自己判断列表是否为空）
  import('./quickbar.js').then((m) => m.mountQuickbar()).catch(() => {});
  // 图层面板锁定的判断挂到 A 上（input.js 按下鼠标时会问一句）
  import('./layers.js').then((m) => m.installLayerHooks()).catch(() => {});
  // ---- 离线网页版（PWA）与“安装到桌面” ----
  let deferredInstall = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; A.hooks.canInstall = true; });
  addEventListener('appinstalled', () => { A.hooks.canInstall = false; toast('已安装到桌面 / 主屏幕，以后可以离线打开'); });
  addEventListener('online', () => toast('网络恢复了'));
  addEventListener('offline', () => toast('已离线：网页版会继续用本地缓存，功能不受影响', 4000));
  A.hooks.installApp = async () => {
    if (deferredInstall) {
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch { /* 用户取消也没关系 */ }
      deferredInstall = null; A.hooks.canInstall = false;
      toast('已请求安装；没反应的话用浏览器菜单里的“安装应用 / 添加到主屏幕”', 4200);
    } else if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      toast('已经在独立窗口里运行了，可以离线用');
    } else {
      toast('用浏览器菜单 →“安装应用 / 添加到主屏幕”。安卓 App 版已经装好就不用管这条', 5200);
    }
  };
  initInput();
  initTriggers();
  initTutorial();
  // 撤销 / 重做也算教程事件
  const u = ed.undo.bind(ed), r = ed.redo.bind(ed);
  ed.undo = () => { u(); A.hooks.coach && A.hooks.coach('undo'); };
  ed.redo = () => { r(); A.hooks.coach && A.hooks.coach('redo'); };
  ed.on(onEditorEvent);
  rend.onDraw = () => { mini.draw(); scheduleStatus(); };
  new ResizeObserver(() => { rend.resize(); mini.draw(); }).observe($('stage'));
  addEventListener('resize', () => A.refresh('modes', 'dock'));
  $('dockTabs').addEventListener('click', (e) => { if (A.isMobile() && e.target === $('dockTabs')) $('dock').classList.toggle('collapsed'); });
  $('dockHandle').parentElement.addEventListener('dblclick', () => $('dock').classList.toggle('collapsed'));
  setupBack();
  resetAutosave();
  addEventListener('beforeunload', (e) => { if ((ed.dirty || window.__modDirty) && !isNative()) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && A.autoDirty) IO.autosave(true); });
  P.setMode('terrain');
  A.refresh();
  P.renderStatus(null);
  import('./tools2.js').then((m) => m.loadModUnits()).catch(() => {});
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { if (e.quota && e.usage / e.quota > 0.85) toast('本机存储快满了：可以在“历史”里删掉旧快照，或清理最近打开的大地图', 6000); }).catch(() => {});
  await startup();
  setTimeout(() => import('./feel.js').then((m) => m.whatsNew(false)), 1500);
  // 给自动测试用
  window.__rw = {
    A, ed, rend, loadMapFromText: IO.loadMapFromText, serialize: () => IO.serializeOnce(), runChecks: () => runChecks(ed, { triggerIssues: triggerIssues() }),
    newMap: (st) => D.createNewMap({ start: 'blank', ...st }), poolReport: () => balanceReport(ed, 30).rows,
    triggerIssues, setMode: P.setMode, setTool: P.setTool, scaleMap, mirrorMap, symmetryDiff, copySelection, pasteClip, rectSelection, generateMap, balanceReport, createNewMap: D.createNewMap, setOverlay,
  };
  window.__rwReady = true;
  setTimeout(() => import('./version.js').then((m) => m.checkUpdate(false)), 4000);
}

init().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;right:0;background:#400;color:#fff;padding:8px;z-index:99;white-space:pre-wrap">启动失败：${e && e.stack || e}</pre>`); });
