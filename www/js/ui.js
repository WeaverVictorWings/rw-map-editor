// 界面小部件：元素构造、提示、弹窗、菜单、忙碌遮罩、功能搜索
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

let toastTimer = 0;
export function toast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export async function busy(msg, fn) {
  const b = document.getElementById('busy');
  b.querySelector('.msg').textContent = msg;
  b.classList.remove('hidden');
  await new Promise((r) => setTimeout(r, 40));
  try { return await fn(); } finally { b.classList.add('hidden'); }
}

// ---- 弹窗（可叠加：帮助可以从别的弹窗里打开） ----
const stack = [];
export function modalOpen() { return stack.length > 0; }
export function closeModal(val) {
  const top = stack.pop();
  if (!top) return;
  top.el.remove();
  top.resolve(val);
}
export function modal(title, body, buttons = [], opts = {}) {
  const el = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') + (opts.full ? ' full' : '') });
  const box = h('div', { class: 'box', role: 'dialog', 'aria-label': title });
  const head = h('div', { class: 'mhead' }, h('h2', {}, title), h('button', { class: 'ib close', 'aria-label': '关闭', html: '<svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6 6 18"/></svg>', onclick: () => closeModal(undefined) }));
  const mb = h('div', { class: 'mbody' });
  if (typeof body === 'string') mb.innerHTML = body; else if (body) mb.append(body);
  const mf = h('div', { class: 'mfoot' });
  for (const b of buttons) {
    mf.append(h('button', { class: (b.primary ? 'primary' : '') + (b.danger ? ' danger' : ''), onclick: async () => {
      if (b.check && !(await b.check())) return;
      closeModal(typeof b.value === 'function' ? b.value() : b.value);
    } }, b.label));
  }
  box.append(head, mb, mf);
  el.append(box);
  el.addEventListener('pointerdown', (e) => { if (e.target === el && !opts.sticky) closeModal(undefined); });
  document.body.append(el);
  return new Promise((resolve) => { stack.push({ el, resolve }); });
}
export function modalBody() { const top = stack[stack.length - 1]; return top ? top.el.querySelector('.mbody') : null; }

export function confirmBox(title, text, okLabel = '确定', cancelLabel = '取消', danger = false) {
  return modal(title, h('p', {}, text), [{ label: cancelLabel, value: false }, { label: okLabel, value: true, primary: !danger, danger }]);
}
export function promptBox(title, label, value = '', hint = '') {
  const inp = h('input', { value });
  const p = modal(title, h('div', {}, h('label', {}, label), inp, hint ? h('div', { class: 'hint', style: 'margin-top:8px' }, hint) : null),
    [{ label: '取消', value: null }, { label: '确定', value: () => inp.value.trim(), primary: true }]);
  setTimeout(() => { inp.focus(); inp.select(); }, 40);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = inp.value.trim(); closeModal(v); } });
  return p;
}

// ---- 下拉菜单 / 弹出层 ----
let openPop = null;
export function closePopover() { if (openPop) { openPop.remove(); openPop = null; } }
export function popover(anchor, content, opts = {}) {
  closePopover();
  const r = anchor.getBoundingClientRect();
  const el = h('div', { class: 'popover' + (opts.cls ? ' ' + opts.cls : '') });
  el.append(content);
  document.body.append(el);
  const pw = el.offsetWidth, ph = el.offsetHeight;
  let x = opts.alignRight ? r.right - pw : r.left, y = r.bottom + 4;
  if (opts.above || y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 4);
  x = Math.max(8, Math.min(innerWidth - pw - 8, x));
  el.style.left = x + 'px'; el.style.top = y + 'px';
  openPop = el;
  setTimeout(() => {
    const off = (e) => { if (!el.contains(e.target) && e.target !== anchor) { closePopover(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
  }, 0);
  return el;
}
// items: [{label, icon, keys, run, disabled, sep, check}]
export function menu(anchor, items, opts = {}) {
  const list = h('div', { class: 'menulist' });
  for (const it of items) {
    if (it.sep) { list.append(h('div', { class: 'msep' })); continue; }
    if (it.title) { list.append(h('div', { class: 'mtitle' }, it.title)); continue; }
    list.append(h('button', { class: 'mitem' + (it.check ? ' checked' : ''), disabled: it.disabled, onclick: () => { closePopover(); it.run(); } },
      h('span', { class: 'mi', html: it.iconHtml || '' }), h('span', { class: 'ml' }, it.label), it.keys ? h('kbd', {}, it.keys) : null));
  }
  return popover(anchor, list, opts);
}

// ---- 功能搜索（Ctrl+K） ----
export function commandPalette(actions, onRun) {
  const input = h('input', { placeholder: '输入功能名称，比如“镜像”“资源池”“保存”…', class: 'cpinput' });
  const list = h('div', { class: 'cplist' });
  let sel = 0, shown = [];
  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = actions.filter((a) => !a.hidden && (!q || (a.label + (a.kw || '') + (a.desc || '')).toLowerCase().includes(q))).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = '';
    shown.forEach((a, i) => list.append(h('button', { class: 'cpitem' + (i === sel ? ' on' : ''), disabled: a.enabled && !a.enabled(), onclick: () => { closeModal(); onRun(a); } },
      h('span', { class: 'mi', html: a.iconHtml || '' }), h('span', { class: 'cpl' }, h('b', {}, a.label), a.desc ? h('small', {}, a.desc) : null), a.keys ? h('kbd', {}, a.keys) : null)));
  };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && shown[sel]) { const a = shown[sel]; closeModal(); onRun(a); }
  });
  render();
  modal('搜索功能', h('div', { class: 'cp' }, input, list), [], {});
  setTimeout(() => input.focus(), 40);
}

// ---- 小控件 ----
export function segmented(opts, cur, on) {
  const s = h('div', { class: 'seg' });
  for (const [v, l, title] of opts) {
    s.append(h('button', { class: v === cur ? 'on' : '', title: title || l, onclick: (e) => { on(v); for (const b of s.children) b.classList.toggle('on', b === e.currentTarget); } }, l));
  }
  return s;
}
export function slider(label, min, max, value, on, opts = {}) {
  const out = h('output', {}, opts.fmt ? opts.fmt(value) : value);
  const inp = h('input', { type: 'range', min, max, step: opts.step || 1, value, oninput: (e) => { const v = +e.target.value; out.textContent = opts.fmt ? opts.fmt(v) : v; on(v); } });
  return h('div', { class: 'field' }, label ? h('label', {}, label) : null, h('div', { class: 'range' }, inp, out));
}
export function toggle(label, value, on, title = '') {
  const inp = h('input', { type: 'checkbox', onchange: (e) => on(e.target.checked) });
  inp.checked = !!value;
  return h('label', { class: 'toggle', title }, inp, h('span', { class: 'tk' }), h('span', {}, label));
}
export function select(options, value, on, attrs = {}) {
  const s = h('select', { ...attrs, onchange: (e) => on(e.target.value) });
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    s.append(h('option', { value: v, selected: String(v) === String(value) }, l));
  }
  return s;
}
