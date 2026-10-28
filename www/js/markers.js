// 地图标记 / 便签（2.5）：在图上钉一条只给编辑器看的备注
// 存储：对象组 `EditorMarks`，每个标记是一个普通 TMX 对象（无 gid）：
//   attrs: id / name / x / y / width / height / type="editorMark"
//   props: text（正文）/ color（颜色）
// tmx.js serialize 会把未知对象组原样写回，所以标记跟地图一起保存；
// 游戏只读 Triggers / 带 gid 的对象，EditorMarks 里的对象游戏不读，不会被当成单位或触发器。
// 注意：x / y 是标记方块的左上角（render.js drawObjects 对无 gid 对象按 x,y 向下画），
// 其它编辑器对象（触发器）用 y 表示底边，这里刻意不同，不要再混用两种坐标算法。
import { A } from './state.js';
import { setObjProp, objProp } from './tmx.js';
import { h, modal, toast, confirmBox, closeModal } from './ui.js';
import { HELP } from './help.js';

const GROUP = 'EditorMarks';
const TYPE = 'editorMark';
export const MARK_COLORS = [
  { color: '#f5c518', label: '黄色：重要 / 要点' },
  { color: '#e5484d', label: '红色：坑点 / 别动' },
  { color: '#36c25b', label: '绿色：可用 / 已完成' },
  { color: '#3e8ef7', label: '蓝色：待定 / 想法' },
  { color: '#b57bff', label: '紫色：美术 / 细节' },
];
let openFlag = false;

function mapOf(ed) { return ed && ed.map ? ed.map : null; }
function groupOf(ed, create = false) {
  const m = mapOf(ed);
  if (!m) return null;
  return create ? m.ensureGroup(GROUP) : m.group(GROUP);
}
function maxObjId(ed) {
  let n = 0;
  for (const { o } of ed.allObjects()) {
    const id = +o.attrs.id;
    if (Number.isFinite(id) && id > n) n = id;
  }
  return n;
}
function oneLine(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > 18 ? s.slice(0, 18) + '…' : s;
}
function labelOf(text) { const s = oneLine(text); return s ? `标记：${s}` : '标记'; }

function recOf(o, G, tw = 20) {
  return {
    id: +o.attrs.id,
    obj: o,
    group: G,
    name: o.attrs.name || '',
    x: +o.attrs.x || 0,
    y: +o.attrs.y || 0,
    get tileX() { return Math.floor(this.x / tw); },
    get tileY() { return Math.floor(this.y / tw); },
    text: objProp(o, 'text') || '',
    color: objProp(o, 'color') || MARK_COLORS[0].color,
  };
}

// 所有标记，按 id 排序
export function listMarkers(ed) {
  const G = groupOf(ed);
  if (!G) return [];
  const tw = ed.map.tw || 20;
  return G.objects.map((o) => recOf(o, G, tw)).sort((a, b) => (a.id || 0) - (b.id || 0));
}

// 加一个标记。x / y 像素（左上角），text 正文，color 颜色。
export function addMarker(ed, { x = 0, y = 0, text = '', color = MARK_COLORS[0].color } = {}) {
  const m = mapOf(ed);
  if (!m) return null;
  const tw = m.tw || 20, th = m.th || 20;
  const px = Math.max(0, Math.min(m.width * tw - tw, Math.round(x)));
  const py = Math.max(0, Math.min(m.height * th - th, Math.round(y)));
  const body = String(text || '').trim();
  const G = groupOf(ed, true);
  const id = maxObjId(ed) + 1;
  const o = {
    attrs: {
      id: String(id),
      name: labelOf(body),
      x: String(px),
      y: String(py),
      width: String(tw),
      height: String(th),
      type: TYPE,
    },
    props: [
      { name: 'text', value: body },
      { name: 'color', value: color || MARK_COLORS[0].color },
    ],
    extra: [],
  };
  ed.begin('添加地图标记');
  ed.op.snapshotGroup(G);
  const before = G.objects.slice();
  G.objects.push(o);
  ed.op.noteDiff(before, G.objects);
  ed.commit();
  return recOf(o, G, m.tw || 20);
}

// 改一个标记（text / color / x / y 像素，或 tileX / tileY）。没变化返回 null。
export function editMarker(ed, id, patch = {}) {
  const G = groupOf(ed);
  if (!G) return null;
  const o = G.objects.find((q) => String(q.attrs.id) === String(id));
  if (!o) return null;
  const m = mapOf(ed);
  const tw = m ? m.tw || 20 : 20, th = m ? m.th || 20 : 20;
  const next = {};
  if (patch.text !== undefined) next.text = String(patch.text);
  if (patch.color !== undefined) next.color = String(patch.color);
  let nx = null, ny = null;
  if (patch.tileX !== undefined || patch.tileY !== undefined) {
    nx = patch.tileX !== undefined ? Math.round(+patch.tileX) * tw : (+o.attrs.x || 0);
    ny = patch.tileY !== undefined ? Math.round(+patch.tileY) * th : (+o.attrs.y || 0);
  }
  if (patch.x !== undefined) nx = Math.round(+patch.x);
  if (patch.y !== undefined) ny = Math.round(+patch.y);
  if (nx !== null || ny !== null) {
    if (nx === null) nx = +o.attrs.x || 0;
    if (ny === null) ny = +o.attrs.y || 0;
    if (m) {
      nx = Math.max(0, Math.min(m.width * tw - tw, nx));
      ny = Math.max(0, Math.min(m.height * th - th, ny));
    }
    next.x = nx; next.y = ny;
  }
  const changes = [];
  if (next.text !== undefined && next.text !== (objProp(o, 'text') || '')) changes.push('text');
  if (next.color !== undefined && next.color !== (objProp(o, 'color') || MARK_COLORS[0].color)) changes.push('color');
  if (next.x !== undefined && next.x !== (+o.attrs.x || 0)) changes.push('x');
  if (next.y !== undefined && next.y !== (+o.attrs.y || 0)) changes.push('y');
  if (!changes.length) return null;
  ed.begin('编辑地图标记');
  ed.op.snapshotGroup(G);
  if (next.text !== undefined) { setObjProp(o, 'text', next.text); o.attrs.name = labelOf(next.text); }
  if (next.color !== undefined) setObjProp(o, 'color', next.color);
  if (next.x !== undefined) o.attrs.x = String(next.x);
  if (next.y !== undefined) o.attrs.y = String(next.y);
  ed.commit();
  return recOf(o, G, m ? m.tw || 20 : 20);
}

// 删一个标记。返回是否真的删掉。
export function removeMarker(ed, id) {
  const G = groupOf(ed);
  if (!G) return false;
  const hit = G.objects.find((q) => String(q.attrs.id) === String(id));
  if (!hit) return false;
  ed.begin('删除地图标记');
  ed.op.snapshotGroup(G);
  const before = G.objects.slice();
  G.objects = G.objects.filter((o) => o !== hit);
  ed.op.noteDiff(before, G.objects);
  ed.commit();
  return true;
}

// 清空所有标记（组留着，是空的，没有影响）。返回删掉的数量。
export function clearMarkers(ed) {
  const G = groupOf(ed);
  if (!G || !G.objects.length) return 0;
  ed.begin('清理地图标记');
  ed.op.snapshotGroup(G);
  const before = G.objects.slice();
  const n = before.length;
  G.objects = [];
  ed.op.noteDiff(before, G.objects);
  ed.commit();
  return n;
}

// ---------------- 界面 ----------------
export async function markersDialog() {
  const ed = A.ed, rend = A.rend;
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (openFlag) return;
  openFlag = true;
  const m = ed.map;
  const tw = m.tw || 20, th = m.th || 20;
  const v = rend.view || { ox: 0, oy: 0, z: 1 };
  const cw = rend.cw || 800, chh = rend.ch || 600;
  const cx = Math.round(v.ox + cw / v.z / 2), cy = Math.round(v.oy + chh / v.z / 2);

  const listEl = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  const textInp = h('textarea', { rows: 2, placeholder: '写点什么，比如：这里放基地 / 这个池子别动 / 美术待补', style: 'width:100%;resize:vertical' });
  const colorSel = h('select', {});
  for (const c of MARK_COLORS) colorSel.append(h('option', { value: c.color }, c.label));
  const xInp = h('input', { type: 'number', value: Math.round(cx / tw), title: '格坐标 X', style: 'width:80px' });
  const yInp = h('input', { type: 'number', value: Math.round(cy / th), title: '格坐标 Y', style: 'width:80px' });
  const countEl = h('div', { class: 'hint' });

  function rebuild() {
    const list = listMarkers(ed);
    countEl.textContent = list.length
      ? `共 ${list.length} 个标记（跟着地图一起保存；游戏不会读，也不显示）`
      : '还没有标记。点一行可以跳过去，改文字会立即保存。';
    listEl.innerHTML = '';
    if (!list.length) {
      listEl.append(h('div', { class: 'hint' }, '比如给“这里要放基地”“这个资源池别让人动”钉个便签。'));
      return;
    }
    for (const mk of list) {
      const dot = h('span', { style: `display:inline-block;width:12px;height:12px;border-radius:50%;background:${mk.color};flex:none` });
      const text = h('input', { value: mk.text, style: 'flex:1 1 220px;min-width:160px' });
      text.addEventListener('change', () => {
        const r = editMarker(ed, mk.id, { text: text.value });
        if (r) { toast('标记已更新'); rebuild(); A.refresh('top', 'dock'); rend.request(); }
      });
      const color = h('select', { title: '颜色', style: 'flex:none;width:92px' });
      for (const c of MARK_COLORS) color.append(h('option', { value: c.color, selected: c.color === mk.color }, c.label.slice(0, 2)));
      color.addEventListener('change', () => {
        const r = editMarker(ed, mk.id, { color: color.value });
        if (r) { rebuild(); rend.request(); }
      });
      const loc = h('button', { title: '在地图上居中', onclick: () => { closeModal(); rend.centerOn(mk.tileX, mk.tileY, Math.max(1, rend.view.z)); toast(`已定位到标记（格 ${mk.tileX}, ${mk.tileY}）`); } }, '定位');
      const del = h('button', { class: 'danger', title: '删除这个标记', onclick: async () => {
        if (!(await confirmBox('删除标记？', `删除「${oneLine(mk.text) || '空标记'}」？可以撤销。`, '删除', '取消', true))) return;
        if (removeMarker(ed, mk.id)) { rebuild(); A.refresh('top', 'dock'); rend.request(); toast('标记已删除'); }
      } }, '删除');
      listEl.append(h('div', { class: 'row', style: 'align-items:center;gap:6px;flex-wrap:wrap' },
        dot, text, color, h('span', { class: 'hint', style: 'flex:none' }, `格 ${mk.tileX},${mk.tileY}`), loc, del));
    }
  }

  const addBtn = h('button', { class: 'primary', onclick: () => {
    const r = addMarker(ed, {
      x: (+xInp.value || 0) * tw,
      y: (+yInp.value || 0) * th,
      text: textInp.value,
      color: colorSel.value,
    });
    if (!r) { toast('先打开一张地图'); return; }
    textInp.value = '';
    rebuild();
    A.refresh('top', 'dock');
    rend.request();
    toast('标记已添加（可以撤销）');
  } }, '添加标记');

  const clearBtn = h('button', { class: 'danger', onclick: async () => {
    const n = listMarkers(ed).length;
    if (!n) { toast('没有标记可清理'); return; }
    if (!(await confirmBox('清理全部标记？', `删除这张地图上全部 ${n} 个标记（不影响地形、单位和触发器，可以撤销）。`, '全部清理', '取消', true))) return;
    const k = clearMarkers(ed);
    rebuild();
    A.refresh('top', 'dock');
    rend.request();
    toast(`已清理 ${k} 个标记`);
  } }, '清理标记');

  const body = h('div', {},
    h('div', { class: 'card' },
      h('div', { style: 'font-weight:600;margin-bottom:8px' }, '加一个标记'),
      textInp,
      h('div', { class: 'row', style: 'align-items:flex-end;gap:8px;flex-wrap:wrap;margin-top:8px' },
        h('div', { class: 'field' }, h('label', {}, '颜色'), colorSel),
        h('div', { class: 'field' }, h('label', {}, '格 X'), xInp),
        h('div', { class: 'field' }, h('label', {}, '格 Y'), yInp),
        addBtn),
      h('div', { class: 'hint' }, '存进地图文件的 EditorMarks 对象组，和地图一起保存；游戏不读这个组，不影响能不能玩。清理标记只删标记，不动地形 / 单位 / 触发器。')),
    h('div', { class: 'card', style: 'margin-top:10px' },
      h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' },
        h('div', { style: 'font-weight:600;flex:1' }, '这张图上的标记'), clearBtn),
      countEl,
      h('div', { style: 'margin-top:6px' }, listEl)));

  rebuild();
  const onEv = (ev) => {
    if (!ed.map) { closeModal(); return; }
    if (ev === 'map' || ev === 'edit') rebuild();
  };
  ed.on(onEv);
  try {
    await modal('地图标记 / 便签', body, [{ label: '关闭', value: 1, primary: true }], { wide: true });
  } finally {
    openFlag = false;
    ed.listeners.delete(onEv);
    A.refresh('top');
  }
}

Object.assign(HELP, {
  'tool.markers': {
    t: '地图标记 / 便签',
    s: '在图上钉备注：这里放基地、这池子别动、美术待补',
    b: '菜单「地图」→「地图标记」。先写文字、选颜色、填格坐标（默认当前视野中心），点「添加标记」。列表里每一行可以直接改文字、换颜色；点「定位」地图会跳过去。标记存在地图文件的 EditorMarks 对象组里，和地图一起保存；它不会被游戏读取，也不影响检查结果。「清理标记」会一次删光所有标记，可以撤销。',
    tips: [
      '标记只给编辑器看：发给别人时对方用这个编辑器打开就能看到，游戏里不显示。',
      '改文字后按回车或点一下别处才会保存。',
      '标记和地形、单位一样占一步撤销，「清理标记」也能整步撤销。',
    ],
  },
});
