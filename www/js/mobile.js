// 手机体验增强：大按钮、左手模式、长按菜单（复制/粘贴/撤销/居中）
// 只导出要注入的 CSS 字符串，style.css 由宿主统一改；这里用 <style> 注入 body.rw-bigbtn / body.rw-lefthand
import { A } from './state.js';
import { h, modal, toast, toggle } from './ui.js';
import { kvGet, kvSet } from './util.js';
import { HELP, helpBtn } from './help.js';

const KEY = 'mobilePrefs';
const STYLE_ID = 'rw-mobile-css';

export const mobilePrefs = { bigButtons: false, leftHand: false, longPressMenu: true };

export const BIGBTN_CSS = `
body.rw-bigbtn #toolbar{width:56px}
body.rw-bigbtn #toolbar .tool{width:48px;height:48px}
body.rw-bigbtn #toolbar .tool .ic{width:24px;height:24px}
body.rw-bigbtn #modebar button{padding:0 14px;height:40px;font-size:14px}
body.rw-bigbtn #top .ib{width:42px;height:42px}
body.rw-bigbtn #top .ib .ic{width:18px;height:18px}
body.rw-bigbtn #statusbar{font-size:13px;min-height:30px}
body.rw-bigbtn #dockTabs button{padding:0 12px;height:38px;font-size:13px}
body.rw-bigbtn #selbar button{height:36px;padding:0 12px;font-size:13px}
`;

export const LEFTHAND_CSS = `
body.rw-lefthand #main{grid-template-columns:var(--dock) 1fr var(--rail)}
body.rw-lefthand #toolbar{grid-column:3;border-right:0;border-left:1px solid var(--line)}
body.rw-lefthand #stage{grid-column:2}
body.rw-lefthand #dock{grid-column:1;border-left:0;border-right:1px solid var(--line)}
body.rw-lefthand #dockHandle{order:-1}
@media (max-width:760px){
  body.rw-lefthand #main{grid-template-columns:1fr}
  body.rw-lefthand #stage{grid-column:1;grid-row:1}
  body.rw-lefthand #dock{grid-column:1;grid-row:2;border-right:0;border-top:1px solid var(--line)}
  body.rw-lefthand #toolbar{grid-column:1;grid-row:3;flex-direction:row;width:auto;border-left:0;border-top:1px solid var(--line)}
}
`;

function injectCss() {
  let st = document.getElementById(STYLE_ID);
  if (!st) { st = document.createElement('style'); st.id = STYLE_ID; document.head.append(st); }
  st.textContent = BIGBTN_CSS + '\n' + LEFTHAND_CSS;
}

async function loadPrefs() {
  try {
    const v = await kvGet(KEY);
    if (v && typeof v === 'object') Object.assign(mobilePrefs, {
      bigButtons: !!v.bigButtons, leftHand: !!v.leftHand, longPressMenu: v.longPressMenu !== false,
    });
  } catch (e) { /* 用默认值 */ }
  return mobilePrefs;
}

export async function setMobilePref(patch) {
  Object.assign(mobilePrefs, patch || {});
  await kvSet(KEY, { ...mobilePrefs });
  applyMobilePrefs();
  return { ...mobilePrefs };
}

// ---------------- 长按菜单 ----------------
let menuEl = null;
let timer = null;
let start = null;
let moved = false;
let pointers = new Set();
let installed = false;

function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

function menuItems() {
  return [
    { label: '复制', icon: 'copy', run: () => A.hooks.selCopy && A.hooks.selCopy() },
    { label: '粘贴', icon: 'paste', run: () => A.hooks.paste && A.hooks.paste() },
    { label: '撤销', icon: 'undo', run: () => A.ed.undo() },
    { label: '居中', icon: 'fit', run: () => A.rend.fit() },
  ];
}

function showMenu(x, y) {
  closeMenu();
  const stage = document.getElementById('stage');
  if (!stage) return;
  const r = stage.getBoundingClientRect();
  menuEl = h('div', {
    class: 'rw-mobile-menu',
    style: `position:absolute;z-index:30;left:${Math.max(4, x - r.left)}px;top:${Math.max(4, y - r.top)}px;` +
      'background:var(--bg2);border:1px solid var(--line2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);padding:4px;min-width:132px',
  });
  for (const it of menuItems()) {
    menuEl.append(h('button', {
      class: 'rw-mobile-menu-item',
      style: 'display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;border:0;background:transparent;color:var(--text);border-radius:7px;font-size:14px;text-align:left',
      onclick: () => { closeMenu(); try { it.run(); } catch (e) { console.error(e); } },
    }, it.label));
  }
  stage.append(menuEl);
}

function installLongPress() {
  if (installed) return;
  installed = true;
  // 捕获阶段只看，不抢事件：正常平移/双指手势不受影响
  document.addEventListener('pointerdown', (e) => {
    if (menuEl && !(e.target && menuEl.contains(e.target))) { closeMenu(); return; }
    if (!mobilePrefs.longPressMenu) return;
    if (e.pointerType === 'mouse') return;              // 桌面鼠标不做长按
    const stage = e.target && e.target.closest && e.target.closest('#stage');
    if (!stage) return;
    pointers.add(e.pointerId);
    if (pointers.size > 1) { clearTimeout(timer); return; }   // 双指手势
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    moved = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (moved || pointers.size !== 1) return;
      showMenu(start.x, start.y);
    }, 500);
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) { moved = true; clearTimeout(timer); }
  }, true);
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { clearTimeout(timer); start = null; }
  };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', (e) => { up(e); closeMenu(); }, true);
}

export function applyMobilePrefs() {
  injectCss();
  const b = document.body;
  b.classList.toggle('rw-bigbtn', !!mobilePrefs.bigButtons);
  b.classList.toggle('rw-lefthand', !!mobilePrefs.leftHand);
  if (mobilePrefs.longPressMenu) installLongPress();
  closeMenu();
}

export async function mobileDialog() {
  await loadPrefs();
  applyMobilePrefs();
  const body = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '手机上把按钮放大、把工具栏换到另一边、长按地图出快捷菜单。改完立即生效，下次打开也记得。'), helpBtn('tool.mobile')),
    toggle('大按钮（手指好点）', mobilePrefs.bigButtons, (v) => { setMobilePref(v); toast(v ? '已切到大按钮' : '已切回紧凑按钮'); }),
    toggle('左手模式（工具栏和面板左右对调）', mobilePrefs.leftHand, (v) => { setMobilePref(v); toast(v ? '已切到左手模式' : '已切回右手模式'); }),
    toggle('长按地图弹快捷菜单', mobilePrefs.longPressMenu, (v) => { setMobilePref(v); toast(v ? '长按可用' : '长按已关闭'); }),
    h('div', { class: 'hint', style: 'margin-top:8px' }, '长按 0.5 秒且手指没移动才会弹菜单；单指平移、双指缩放都不受影响。')
  );
  await modal('手机体验', body, [{ label: '关闭', primary: true, value: 'ok' }], { wide: true });
  return { ...mobilePrefs };
}

Object.assign(HELP, {
  'tool.mobile': {
    t: '手机体验',
    s: '大按钮 / 左手模式 / 长按菜单',
    b: '在地图上长按 0.5 秒，弹出复制、粘贴、撤销、居中四个快捷操作。大按钮让工具栏和底栏更好点；左手模式把工具栏换到右边、右侧面板换到左边。设置存在本机，导入导出设置时会一起走。',
    tips: ['长按前别移动手指，移动就当作平移地图。', '双指缩放时不会触发长按菜单。'],
  },
});
