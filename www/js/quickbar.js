// 快捷工具栏：一行可自定义的常用按钮，悬在 #stage 顶部，不挡左侧工具栏
// 每项可以是 ACTIONS 的 id（字符串），或 { id, label?, icon? } 覆盖文案图标，或 { label, icon, run } 自定义动作
import { A } from './state.js';
import { h, modal, toast, toggle, closeModal } from './ui.js';
import { icon } from './icons.js';
import { ACTIONS, action, runAction } from './actions.js';
import { kvGet, kvSet } from './util.js';
import { HELP, helpBtn } from './help.js';

const KEY = 'quickbar';
const STYLE_ID = 'rw-quickbar-css';
const CSS = `
#quickbar{position:absolute;left:10px;top:10px;z-index:4;display:flex;gap:4px;align-items:center;
  max-width:calc(100% - 190px);overflow-x:auto;overflow-y:hidden;padding:3px;border-radius:10px;
  background:rgba(23,26,32,.86);border:1px solid var(--line2);box-shadow:0 6px 20px rgba(0,0,0,.35);
  scrollbar-width:none;overscroll-behavior-x:contain}
#quickbar::-webkit-scrollbar{display:none}
#quickbar:empty{display:none}
.rwq-btn{flex:none;display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 8px;
  background:transparent;border:1px solid transparent;border-radius:7px;color:var(--muted);font-size:12px;
  white-space:nowrap;cursor:pointer}
.rwq-btn:hover{background:var(--bg3);color:var(--text)}
.rwq-btn:disabled{opacity:.38;cursor:default}
.rwq-btn .ic{width:16px;height:16px;flex:none}
.rwq-btn .rwq-label{max-width:96px;overflow:hidden;text-overflow:ellipsis}
@media (max-width:760px){
  #quickbar{left:6px;right:6px;max-width:none;top:6px}
  .rwq-btn{height:38px;padding:0 10px;font-size:13px}
  .rwq-btn .ic{width:18px;height:18px}
}
body.rw-bigbtn .rwq-btn{height:44px;padding:0 12px;font-size:14px}
body.rw-bigbtn .rwq-btn .ic{width:20px;height:20px}
body.rw-bigbtn .rwq-btn .rwq-label{max-width:130px}
`;

function injectCss() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.append(st);
}

export function defaultQuickbar() {
  return ['save', 'undo', 'redo', 'check', 'fit', 'grid'];
}

function normItem(it) {
  if (typeof it === 'string') return { id: it };
  if (it && it.custom && !it.id && typeof it.run !== 'function') return null;
  if (!it || typeof it !== 'object') return null;
  if (typeof it.run === 'function') return { label: it.label || '自定义', icon: it.icon || 'info', run: it.run, custom: true };
  if (it.id) return { id: it.id, label: it.label || '', icon: it.icon || '' };
  return null;
}

// 用户没配过就返回空数组：默认不显示悬浮工具栏，否则会压在画布左上角挡住点击
// （想恢复默认那 6 个按钮：在「视图 → 快捷工具栏设置」里点「恢复默认」）
export async function loadQuickbar() {
  let raw = null;
  try { raw = await kvGet(KEY); } catch (e) { raw = null; }
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) return [];
  return list.map(normItem).filter(Boolean);
}

export async function saveQuickbar(list) {
  const clean = (Array.isArray(list) ? list : []).map(normItem).filter(Boolean).map((it) => (
    it.custom && !it.id ? { id: '', label: it.label, icon: it.icon, custom: true } : it
  ));
  await kvSet(KEY, clean);
  return clean;
}

function describe(it) {
  if (typeof it.run === 'function' && !it.id) return { label: it.label || '自定义', icon: it.icon || 'info', enabled: () => true, run: it.run };
  const a = action(it.id);
  if (!a) return null;
  return {
    label: it.label || a.label.replace(/…$/, ''),
    icon: it.icon || a.icon || 'info',
    enabled: a.enabled || (() => true),
    run: () => a.run(),
    title: a.label + (a.desc ? '：' + a.desc : ''),
  };
}

function makeButton(it) {
  const d = describe(it);
  if (!d) return null;
  const enabled = () => { try { return !!d.enabled(); } catch (e) { return true; } };
  const b = h('button', {
    class: 'rwq-btn', title: d.title || d.label, 'aria-label': d.label,
    onclick: () => { if (!enabled()) return; try { const r = d.run(); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); } },
  }, h('span', { html: icon(d.icon) }), h('span', { class: 'rwq-label' }, d.label));
  if (!enabled()) b.disabled = true;
  return b;
}

function placeBar() {
  const stage = document.getElementById('stage');
  if (!stage) return null;
  let bar = document.getElementById('quickbar');
  if (!bar) { bar = h('div', { id: 'quickbar', role: 'toolbar', 'aria-label': '快捷工具栏' }); stage.append(bar); }
  return bar;
}

export async function mountQuickbar() {
  injectCss();
  const bar = placeBar();
  if (!bar) return null;
  const list = await loadQuickbar();
  bar.replaceChildren(...list.map(makeButton).filter(Boolean));
  return bar;
}

export function refreshQuickbar() { return mountQuickbar(); }

// ---------------- 设置对话框 ----------------
export async function quickbarDialog() {
  let list = (await loadQuickbar()).map((x) => ({ ...x }));
  const rows = h('div', {});
  const total = h('span', { class: 'hint' });
  const options = ACTIONS.filter((a) => a.id && !a.hidden && !a.sep && !a.title)
    .map((a) => [a.id, `${a.group} · ${a.label.replace(/…$/, '')}`]);
  const addSel = h('select', { style: 'flex:1;min-width:0' },
    ...options.map(([v, l]) => h('option', { value: v }, l)));
  const iconName = h('input', { placeholder: '图标名，可留空', style: 'width:120px' });
  const labelI = h('input', { placeholder: '显示名，可留空', style: 'width:150px' });

  const render = () => {
    rows.replaceChildren();
    total.textContent = `${list.length} 个按钮${list.filter((x) => x.custom).length ? `（${list.filter((x) => x.custom).length} 个自定义）` : ''}`;
    if (!list.length) { rows.append(h('div', { class: 'hint' }, '还没有按钮，从下面选一个加进来。')); return; }
    list.forEach((it, i) => {
      const d = describe(it);
      rows.append(h('div', { class: 'row', style: 'align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--line)' },
        h('span', { html: icon(d ? d.icon : 'info'), style: 'width:20px;flex:none;display:flex;align-items:center' }),
        h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
          (d ? d.label : '（已失效：' + (it.id || '?') + '）') + (it.custom ? '' : '')),
        h('button', { class: 'ib', title: '上移', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; render(); } }, '↑'),
        h('button', { class: 'ib', title: '下移', disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; render(); } }, '↓'),
        h('button', { class: 'ib', title: '删除', onclick: () => { list.splice(i, 1); render(); } }, '✕')));
    });
  };

  const addAction = () => {
    const id = addSel.value;
    if (!id) return;
    const base = action(id);
    const it = { id };
    if (labelI.value.trim()) it.label = labelI.value.trim();
    if (iconName.value.trim()) it.icon = iconName.value.trim();
    if (list.some((x) => x.id === it.id && !it.label)) { toast('这个按钮已经在快捷栏里了'); return; }
    if (!base) { toast('找不到这个功能'); return; }
    list.push(it);
    labelI.value = ''; iconName.value = '';
    render();
  };

  render();
  const body = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '挑几个最常用的放在地图上方，点一下就执行；也可以改名换图标。'), helpBtn('tool.quickbar')),
    h('div', { class: 'row', style: 'margin:8px 0 4px' }, h('b', { style: 'flex:1' }, '当前按钮'), total),
    rows,
    h('div', { style: 'margin-top:10px' }, h('label', {}, '加一个功能')),
    h('div', { class: 'row', style: 'margin-top:4px;gap:6px;flex-wrap:wrap' }, addSel, labelI, iconName,
      h('button', { class: 'primary', onclick: addAction }, '添加')),
    h('div', { class: 'hint', style: 'margin-top:6px' }, '自定义 run 按钮只对当前这次打开的页面有效；存进本机会按 id 记成普通按钮。存的是 IndexedDB 的 quickbar 键，导入导出时会跟着走。')
  );

  const r = await modal('快捷工具栏', body, [
    { label: '恢复默认', value: 'reset' },
    { label: '取消', value: null },
    { label: '保存', primary: true, value: 'save' },
  ], { wide: true });
  if (r === 'reset') { await saveQuickbar(defaultQuickbar()); await mountQuickbar(); toast('已恢复默认快捷栏'); }
  else if (r === 'save') { await saveQuickbar(list); await mountQuickbar(); toast(`快捷栏已保存（${list.length} 个按钮）`); }
  return r;
}

Object.assign(HELP, {
  'tool.quickbar': {
    t: '快捷工具栏',
    s: '一行自定义按钮，放在地图上方',
    b: '把保存、撤销、检查这些每天要按很多次的功能放到地图上方，点一下就执行。按钮可以排序、改名、换图标，也可以删掉。配置存在本机 IndexedDB 的 <code>quickbar</code> 键里，导入导出设置时会一起带走。',
    tips: ['手机上按钮更大，可以左右滑。', '同一功能只能出现一次（不填显示名时）。'],
  },
});
