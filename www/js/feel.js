// 外观与手感：主题、文字大小、专注/全屏、标尺、粗网格线、笔输入、震动、视角书签、新功能弹窗
import { A } from './state.js';
import { h, modal, toast, promptBox, toggle, segmented, slider, closeModal } from './ui.js';
import { kvGet, kvSet } from './util.js';
import { VERSION } from './version.js';

const ed = A.ed, rend = A.rend;
const save = () => kvSet('settings', A.settings);

const css = document.createElement('style');
css.textContent = `:root[data-theme=light]{--bg0:#eceff3;--bg:#f6f7f9;--bg2:#fff;--bg3:#e8ebf0;--bg4:#dce0e6;--line:#d3d8df;--line2:#c0c7d1;--text:#1b2027;--muted:#556070;--dim:#7b8594;--accentBg:rgba(229,121,58,.16)}
body.rw-focus #top,body.rw-focus #modebar,body.rw-focus #toolbar,body.rw-focus #dock,body.rw-focus #statusbar{display:none!important}
body.rw-focus{--top:0px;--modes:0px;--status:0px;--rail:0px;--dock:0px;--modebar-h:0px;--safe-t:0px}
#focusExit{position:fixed;right:10px;top:10px;z-index:30;opacity:.55;padding:4px 10px;border-radius:14px}#focusExit:hover{opacity:1}`;
document.head.append(css);

export function applyLook() {
  const s = A.settings;
  let t = s.theme || 'dark';
  if (t === 'auto') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = t === 'light' ? '#f6f7f9' : '#15171c';
  document.documentElement.style.fontSize = (s.uiFont || 13) + 'px';
  rend.showRuler = !!s.ruler; rend.gridMajor = s.gridMajor || 0;
  rend.request && rend.request();
}
export function setFocus(on) {
  document.body.classList.toggle('rw-focus', on);
  let b = document.getElementById('focusExit');
  if (on && !b) { b = h('button', { id: 'focusExit', onclick: () => setFocus(false) }, '退出专注模式'); document.body.append(b); }
  if (!on && b) b.remove();
  setTimeout(() => { rend.resize && rend.resize(); rend.request(); A.mini.draw && A.mini.draw(); }, 50);
}
export function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement) { d.exitFullscreen(); return; }
  const el = d.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('这里不允许进入全屏，可以试试“专注模式”'));
  else toast('这个环境不支持全屏，可以试试“专注模式”');
}
let lastBuzz = 0;
export function buzz(ms = 8) {
  if (!A.settings.haptic || !navigator.vibrate) return;
  const n = Date.now(); if (n - lastBuzz < 80) return; lastBuzz = n;
  try { navigator.vibrate(ms); } catch { /* 不支持就算了 */ }
}

export async function feelDialog() {
  const s = A.settings;
  const body = h('div', {},
    h('label', {}, '主题'), segmented([['dark', '深色'], ['light', '浅色'], ['auto', '跟随系统']], s.theme || 'dark', (v) => { s.theme = v; applyLook(); save(); }),
    slider('文字大小', 11, 18, s.uiFont || 13, (v) => { s.uiFont = v; applyLook(); save(); }, { fmt: (v) => v + ' px' }),
    toggle('画布边上显示坐标标尺', !!s.ruler, (v) => { s.ruler = v; applyLook(); save(); }),
    h('label', {}, '每隔几格画一条粗网格线（放大后才看得到）'), segmented([[0, '不画'], [4, '4'], [8, '8'], [10, '10'], [16, '16']], s.gridMajor || 0, (v) => { s.gridMajor = +v; applyLook(); save(); }),
    toggle('只用手写笔 / 鼠标绘制，手指只拖动和缩放（防手掌误触）', !!s.penOnly, (v) => { s.penOnly = v; save(); }),
    toggle('触感反馈（落笔和撤销时轻轻震动，手机上有效）', !!s.haptic, (v) => { s.haptic = v; save(); if (v) buzz(20); }),
    h('div', { class: 'row', style: 'margin-top:10px;display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { onclick: () => { closeModal(); setFocus(true); } }, '专注模式（隐藏所有面板）'),
      h('button', { onclick: toggleFullscreen }, '全屏 / 退出全屏')),
    h('p', { class: 'hint' }, '全屏在电脑浏览器里可用；手机 App 里系统栏的隐藏取决于系统，专注模式隐藏的是编辑器自己的面板。'));
  await modal('外观与手感', body, [{ label: '完成', value: 1, primary: true }]);
}

// ---- 视角书签（每张地图各自保存） ----
export async function bookmarksDialog() {
  if (!ed.map) return;
  const key = 'bm:' + A.mapName;
  let list = (await kvGet(key)) || [];
  const body = h('div', {}), draw = () => {
    body.replaceChildren(h('p', { class: 'hint' }, '把当前看到的位置和缩放存下来，之后一键跳回。'));
    list.forEach((b, i) => body.append(h('div', { class: 'hrow', style: 'display:flex;gap:8px;align-items:center;margin:4px 0' }, h('b', { translate: 'no' }, b.name), h('span', { class: 'hint' }, Math.round(b.z * 100) + '%'),
      h('button', { onclick: () => { rend.setZoom(b.z); rend.view.ox = b.ox; rend.view.oy = b.oy; rend.request(); A.mini.draw(); } }, '跳到'),
      h('button', { onclick: async () => { list.splice(i, 1); await kvSet(key, list); draw(); } }, '删除'))));
    if (!list.length) body.append(h('div', { class: 'hint' }, '还没有书签。'));
  };
  draw();
  await modal('视角书签', body, [{ label: '存下当前视角', check: async () => { const n = await promptBox('书签名', '名字', '视角 ' + (list.length + 1)); if (n) { list.push({ name: n, ox: rend.view.ox, oy: rend.view.oy, z: rend.view.z }); await kvSet(key, list); draw(); } return false; } }, { label: '关闭', value: 1, primary: true }]);
}

// ---- 去出生点 ----
export function spawnJump() {
  if (!ed.map) return;
  const sp = ed.spawns().filter((s) => s.team >= 0).sort((a, b) => a.team - b.team);
  if (!sp.length) { toast('这张图还没有出生点'); return; }
  const body = h('div', {}, sp.map((s) => h('button', { style: 'margin:3px', onclick: () => { closeModal(); rend.centerOn(s.cx / ed.map.tw - 0.5, s.cy / ed.map.th - 0.5, Math.max(rend.view.z, 1)); } }, `第 ${s.team + 1} 队`)));
  modal('跳到出生点', body, [{ label: '关闭', value: 1 }]);
}
export function zoomSelection() {
  const sel = ed.selection; if (!sel) { toast('先框选一块区域'); return; }
  const w = sel.x1 - sel.x0 + 1, hh = sel.y1 - sel.y0 + 1, tw = ed.map.tw;
  rend.centerOn((sel.x0 + sel.x1) / 2, (sel.y0 + sel.y1) / 2, Math.min(8, Math.min(rend.cw / (w * tw), rend.ch / (hh * tw)) * 0.9));
}

// ---- 新功能弹窗：升级后只弹一次 ----
export const WHATS_NEW = {
  '3.0.0': ['新增“资源池周围加一圈”和“重新排布出生点”：先预览，再一步放好，可以一步撤销。', '新手有了精简界面（菜单只留常用功能，“视图 → 界面：精简 / 完整”可切换）；第一次使用时有三步引导告诉你怎么找到地图文件。', '新增“我的数据在哪”和一键“反馈问题”（自动复制诊断信息）；载入地图后会检查有没有内容无法原样保留；首页可以直接“继续编辑”上次的地图。', '界面质感调整：金属边、铆钉、做旧纹理、首页小提示。'],
  '2.9.0': ['首页改成“地图编辑器 / Mod 编辑器”并列选择，顶栏也有 Mod 编辑器入口。', 'Mod 编辑器有了新手教程，支持 Ctrl+S 打包、Ctrl+Z 撤销，手机上顶栏可以左右滑动。', '新增繁体中文、日语、俄语、西班牙语的 README。'],
  '2.8.0': ['自动备份改存 IndexedDB，大地图也能备份；保存时留下上一版，并校验写入。', 'Mod 编辑器自动保存，刷新后能恢复；有最近打开和回收站。', '新增：保存摘要、版本备注、自检面板、外观与手感（浅色主题、文字大小、专注模式、标尺、粗网格线、防误触、震动）。', '视角书签、跳到出生点、缩放到选区；“地图用到的单位”可对照已打开的 Mod。', '首页可以置顶地图；功能搜索支持拼音首字母。'],
};
export async function whatsNew(force = false) {
  let seen = ''; try { seen = localStorage.getItem('rwSeen') || ''; } catch { /* 无痕模式 */ }
  const lines = WHATS_NEW[VERSION] || WHATS_NEW[Object.keys(WHATS_NEW).pop()];
  if (!force) { try { localStorage.setItem('rwSeen', VERSION); } catch { /* 无所谓 */ } if (!seen || seen === VERSION || !WHATS_NEW[VERSION]) return; }
  await modal('这一版新增了什么 · ' + VERSION, h('ul', {}, lines.map((l) => h('li', { style: 'margin:6px 0' }, l))), [{ label: '知道了', value: 1, primary: true }]);
}
