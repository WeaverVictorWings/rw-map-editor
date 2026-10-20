// 界面小工具：图标、提示、弹窗、忙碌遮罩
export const ICON = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  terrain: '<path d="m3 20 6-10 4 6 3-4 5 8z"/><circle cx="17" cy="6" r="2"/>',
  items: '<circle cx="12" cy="12" r="5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  units: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/>',
  rules: '<path d="M7 3h10v18l-5-3-5 3z"/><path d="M10 8h4M10 12h4"/>',
  tiles: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  brush: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="m12 6 6 6"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  pick: '<path d="m14 4 6 6"/><path d="M17 7 7 17l-3 3-1-1 3-3L16 6"/><path d="M15 3l6 6"/>',
  pan: '<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  stamp: '<path d="M9 3h6v6l3 3H6l3-3z"/><path d="M5 15h14v3H5zM5 21h14"/>',
  erase: '<path d="m7 21-4-4 10-10 7 7-7 7z"/><path d="M7 21h13"/>',
  spawn: '<path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/>',
  unit: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  select: '<path d="m5 3 14 8-6 2-2 6z"/>',
  del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
export function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`; }

let toastTimer = 0;
export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export async function busy(msg, fn) {
  const b = document.getElementById('busy');
  b.querySelector('.msg').textContent = msg;
  b.classList.remove('hidden');
  await new Promise((r) => setTimeout(r, 30));
  try { return await fn(); } finally { b.classList.add('hidden'); }
}

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

let modalResolve = null;
export function closeModal(val) {
  document.getElementById('modal').classList.add('hidden');
  const r = modalResolve; modalResolve = null;
  if (r) r(val);
}
// buttons: [{label, value, primary}]
export function modal(title, body, buttons = [], opts = {}) {
  if (modalResolve) closeModal(undefined);
  const m = document.getElementById('modal');
  m.querySelector('h2').textContent = title;
  const mb = m.querySelector('.mbody');
  mb.innerHTML = '';
  if (typeof body === 'string') mb.innerHTML = body; else if (body) mb.append(body);
  const mf = m.querySelector('.mfoot');
  mf.innerHTML = '';
  for (const b of buttons) {
    mf.append(h('button', { class: b.primary ? 'primary' : '', onclick: async () => {
      if (b.check && !(await b.check())) return;
      closeModal(typeof b.value === 'function' ? b.value() : b.value);
    } }, b.label));
  }
  m.querySelector('.close').onclick = () => closeModal(undefined);
  m.onclick = (e) => { if (e.target === m && !opts.sticky) closeModal(undefined); };
  m.classList.remove('hidden');
  return new Promise((res) => { modalResolve = res; });
}

export function confirmBox(title, text, okLabel = '确定', cancelLabel = '取消') {
  return modal(title, h('p', {}, text), [{ label: cancelLabel, value: false }, { label: okLabel, value: true, primary: true }]);
}
