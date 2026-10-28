// 输入：鼠标、触屏手势、各工具的行为、选区与浮动粘贴、叠加绘制、快捷键
import { A } from './state.js';
import { objProp } from './tmx.js';
import { NONE } from './terrain.js';
import { teamColor } from './render.js';
import { rectSelection, wandSelection, copySelection, transformClip, pasteWithSymmetry, clearSelection, selInside } from './transform.js';
import { saveUserStamp } from './stamps.js';
import { toast, h, promptBox, modalOpen, closeModal, closePopover, menu } from './ui.js';
import { icon } from './icons.js';
import { setMode, setTool, tool, MODES, TOOLS, renderStatus, unitRowPositions } from './panels.js';
import * as PT from './paint.js';
import * as DU from './detailui.js';
import { ACTIONS, runAction } from './actions.js';

const ed = A.ed, rend = A.rend;
const cv = document.getElementById('cv');
const TW = 20;

// ---------------- 坐标 ----------------
function local(e) { const r = cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
function mapPt(e) { const { sx, sy } = local(e); return rend.toMap(sx, sy); }
const tileOf = (p) => ({ tx: Math.floor(p.x / TW), ty: Math.floor(p.y / TW) });
const vertOf = (p) => ({ vx: p.x / TW, vy: p.y / TW });

// ---------------- 刷新 ----------------
function flushRecent() {
  const op = ed.op;
  if (!op || !op.recent) return;
  const r = op.recent; op.recent = null;
  rend.invalidate(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1);
}
function afterCommit(lastBox) {
  const op = ed.undoStack[ed.undoStack.length - 1];
  const b = lastBox || (op && op.box);
  if (op && (op.meta || op.snaps.size || op.vSnap)) rend.invalidateAll();
  else if (b) rend.invalidate(b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1);
  rend.request();
}
function commit(coachEvt) {
  if (!ed.op) return;
  flushRecent();
  const box = ed.op.box;
  ed.commit();
  afterCommit(box);
  if (coachEvt && A.hooks.coach) A.hooks.coach(coachEvt);
}

// ---------------- 状态 ----------------
const P = new Map();       // 活动的触点
let act = null;            // 当前动作 {kind, ...}
let gesture = null;        // 双指 {d, cx, cy, n, t0, moved}
let spaceDown = false;
A.mouse = null;            // 鼠标所在地图坐标（画光标用）
let tapInfo = null;        // 多指轻点检测

function primaryTerrain(e) { return (e && e.button === 2) || A.useSecondary ? ed.terrain2 : ed.terrain; }

// ---------------- 工具：按下 ----------------
function startAction(e) {
  const p = mapPt(e);
  const m = ed.map;
  if (!m) return;
  const T = tool();
  const { tx, ty } = tileOf(p), { vx, vy } = vertOf(p);
  // 在地图上点位置（模板等）
  if (A.pickPoint) { act = { kind: 'pick', tx, ty }; return; }
  // 图层面板里锁住的层不吃画笔（只挡会改数据的工具，平移/取色/框选照样能用）
  if (A.layerLocked && A.layerLocked(ed.mode, T)) { toast(A.layerLockedText || '这一层在图层面板里锁住了，先解锁再画'); return; }
  // 浮动内容（粘贴 / 印章 / 贴图）
  if (ed.floating) {
    const f = ed.floating;
    const inside = tx >= f.x && ty >= f.y && tx < f.x + f.clip.w && ty < f.y + f.clip.h;
    act = { kind: 'float', ox: inside ? tx - f.x : Math.floor(f.clip.w / 2), oy: inside ? ty - f.y : Math.floor(f.clip.h / 2), moved: !inside, sx: e.clientX, sy: e.clientY, touch: e.pointerType === 'touch' };
    moveFloat(tx, ty); return;
  }
  const pan = T === 'pan' || e.button === 1 || spaceDown || (e.button === 2 && !(ed.mode === 'terrain' && ['brush', 'rect', 'ellipse', 'fill'].includes(T)));
  if (pan) { act = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: rend.view.ox, oy: rend.view.oy }; cv.style.cursor = 'grabbing'; return; }
  if (T === 'marquee') { act = { kind: 'marquee', a: [tx, ty], b: [tx, ty], moved: false }; return; }
  if (T === 'wand') { ed.selection = wandSelection(ed, tx, ty, !!A.wandGlobal); afterSelect(); return; }
  const mode = ed.mode;
  if (mode === 'terrain') {
    if (!ed.engine) { toast('这张地图不能自动画地形，请用“图块”模式'); return; }
    const t = primaryTerrain(e);
    if (T === 'brush') { ed.begin('画地形'); ed.paintTerrainAt(vx, vy, t); flushRecent(); act = { kind: 'stroke', last: [vx, vy], t, t0: performance.now(), moved: 0 }; rend.request(); return; }
    if (T === 'rect' || T === 'ellipse') { const a = [Math.round(vx), Math.round(vy)]; act = { kind: 'shape', shape: T, a, b: a, t }; return; }
    if (T === 'fill') { ed.begin('油漆桶'); const box = ed.fillTerrainAt(vx, vy, t, !!A.fillGlobal); commit('painted'); if (box) rend.invalidate(box.x0 - 1, box.y0 - 1, box.x1 + 1, box.y1 + 1); A.mini.schedule(); return; }
    if (T === 'color') {
      if (!ed.colorGid || !m.tilesetOf(ed.colorGid)) { toast('先在右边新建或选一个色块'); return; }
      const shp = A.colorShape || 'brush', g = ed.colorGid;
      if (shp === 'brush') { ed.begin('画色块'); PT.paintColorTiles(PT.brushTiles(tx, ty), g); flushRecent(); act = { kind: 'tileStroke', fn: 'color', last: [tx, ty] }; rend.request(); return; }
      if (shp === 'fill') { ed.begin('油漆桶色块'); PT.paintColorTiles(PT.fillTiles(tx, ty, !!A.fillGlobal), g); commit('painted'); A.mini.schedule(); return; }
      act = { kind: 'tshape', shape: shp, a: [tx, ty], b: [tx, ty], apply: (tiles) => PT.paintColorTiles(tiles, g), label: '画色块' }; return;
    }
    if (T === 'detail') { ed.begin('细节笔刷'); DU.detailDab(tx, ty, A.detailBrush || 'roughen', A.detailStrength ?? 60); flushRecent(); act = { kind: 'tileStroke', fn: 'detail', last: [tx, ty] }; rend.request(); return; }
    if (T === 'height') { ed.begin((A.heightDir ?? 1) > 0 ? '抬高地面' : '压低地面'); const vis = new Set(); DU.heightDab(tx, ty, A.heightDir ?? 1, vis); flushRecent(); act = { kind: 'tileStroke', fn: 'height', last: [tx, ty], vis }; rend.request(); return; }
    if (T === 'biome') { DU.biomeDab(tx, ty, A.biome ?? 1); act = { kind: 'tileStroke', fn: 'biome', last: [tx, ty] }; return; }
    if (T === 'road') { act = { kind: 'road', pts: [[vx, vy]] }; return; }
    if (T === 'pick') { ed.pickTerrain(vx, vy); ed.tool.terrain = 'brush'; A.refresh('toolbar', 'dock'); toast('已选：' + ed.engine.cn(ed.terrain)); return; }
  }
  if (mode === 'items') {
    if (!ed.itemsTs) { toast('这张地图没有物品图块集'); return; }
    if (T === 'erase') { ed.begin('擦除物品'); ed.eraseAt(m.ensureLayer('Items'), tx, ty); flushRecent(); act = { kind: 'tileStroke', fn: 'erase', last: [tx, ty] }; rend.request(); return; }
    const it = ed.item();
    if (T === 'random') { if (!ed.randomMix || !ed.randomMix.length) { toast('先在右边选几种物品'); return; } const ri = ed.item(ed.randomMix[0].key); ed.begin('随机笔刷'); PT.placeItems(PT.brushTiles(tx, ty), ri, { random: true }); flushRecent(); act = { kind: 'tileStroke', fn: 'random', last: [tx, ty] }; rend.request(); return; }
    if (!it) return;
    if (T === 'rect' || T === 'ellipse' || T === 'line') { act = { kind: 'tshape', shape: T, a: [tx, ty], b: [tx, ty], apply: (tiles) => PT.placeItems(tiles, it), label: '放' + it.cn }; return; }
    if (T === 'fill') { ed.begin('油漆桶放' + it.cn); PT.placeItems(PT.fillTiles(tx, ty, !!A.fillGlobal), it); commit('item'); rend.pools = ed.poolTiles(); A.mini.schedule(); A.refresh('dock'); return; }
    ed.begin('放' + it.cn);
    if (it.stamp) PT.placeItems(ed.symPoints(tx, ty, 't').map(([x, y]) => Math.round(y) * m.width + Math.round(x)), it, { density: 1 });
    else PT.placeItems(PT.brushTiles(tx, ty), it);
    flushRecent();
    act = { kind: 'tileStroke', fn: 'item', last: [tx, ty] }; rend.request(); return;
  }
  if (mode === 'tiles') {
    if (T === 'pick') { const L = m.layer(ed.rawLayer) || m.ground; const i = ty * m.width + tx; if (L && tx >= 0 && ty >= 0 && tx < m.width && ty < m.height && L.data[i]) { ed.rawGid = L.data[i]; ed.rawTs = m.tilesetOf(ed.rawGid); ed.tool.tiles = 'brush'; A.refresh('toolbar', 'dock'); } return; }
    if (T === 'brush') { if (!ed.rawGid) { toast('先在右边点选一个图块'); return; } ed.begin('放图块'); ed.rawPaintAt(tx, ty); flushRecent(); act = { kind: 'tileStroke', fn: 'raw', last: [tx, ty] }; rend.request(); return; }
    if (T === 'erase') { const L = m.layer(ed.rawLayer); if (!L || L === m.ground) { toast('地面层不能留空，请换个图层或直接画别的图块'); return; } ed.begin('擦除图块'); ed.eraseAt(L, tx, ty); flushRecent(); act = { kind: 'tileStroke', fn: 'rawErase', last: [tx, ty] }; rend.request(); return; }
  }
  if (mode === 'units' || mode === 'triggers') {
    if (T === 'spawn') {
      ed.begin('放出生点');
      const added = ed.addSpawnAt(tx, ty);
      if (!added.length) { ed.op = null; toast('队伍数已经到上限了'); return; }
      commit('spawn'); A.mini.draw(); A.refresh('dock', 'top');
      toast(`已放出生点：${added.map((t) => '第 ' + (t + 1) + ' 队').join('、')}`);
      return;
    }
    if (T === 'unit') {
      const pos = unitRowPositions(tx, ty).filter(([x, y]) => x >= 0 && y >= 0 && x < m.width && y < m.height);
      ed.begin(pos.length > 1 ? `放 ${pos.length} 个单位` : '放单位');
      for (const [x, y] of pos) ed.addUnitAt(x, y);
      commit('unit'); A.mini.draw(); return;
    }
    if (T === 'text') { A.hooks.textAt && A.hooks.textAt(p.x, p.y); return; }
    if (T === 'region') { const a = [Math.round(p.x / TW) * TW, Math.round(p.y / TW) * TW]; act = { kind: 'region', a, b: a }; return; }
    if (T === 'select' || T === 'del') {
      // 先看是不是在拖已选中区域的右下角
      const sel = ed.selected;
      if (T === 'select' && sel && !sel.attrs.gid && mode === 'triggers') {
        const r = { x: +(sel.attrs.x || 0), y: +(sel.attrs.y || 0), w: +(sel.attrs.width || 0), h: +(sel.attrs.height || 0) };
        const s = rend.toScreen(r.x + r.w, r.y + r.h), { sx, sy } = local(e);
        if (Math.abs(sx - s.x) < 14 && Math.abs(sy - s.y) < 14) { act = beginObjDrag(sel, p, 'resize'); return; }
      }
      const hit = ed.hitObject(p.x, p.y);
      if (T === 'del') {
        if (hit) { ed.begin('删除'); ed.deleteObject(hit.o); commit(); ed.selected = null; A.mini.draw(); A.refresh('dock', 'top'); }
        return;
      }
      if (hit) {
        // 同一位置叠着好几个触发器时，记下来，抬手没拖动就弹出列表让你选
        const many = mode === 'triggers' ? hitsAt(p.x, p.y) : [];
        const pick = many.length > 1 && many.includes(ed.selected) ? ed.selected : hit.o;
        ed.selected = pick; A.refresh('dock'); act = beginObjDrag(pick, p, 'move'); act.many = many; act.cx = e.clientX; act.cy = e.clientY; rend.request(); return;
      }
      if (ed.selected) { ed.selected = null; A.refresh('dock'); rend.request(); }
      act = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: rend.view.ox, oy: rend.view.oy };
      return;
    }
  }
}

function hitsAt(mx, my) {
  const out = [];
  for (const G of ed.map.groups) {
    if (!G.visible || G.name.toLowerCase() !== 'triggers') continue;
    for (const o of G.objects) {
      const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0), w = Math.max(+(o.attrs.width || 0), 20), hh = Math.max(+(o.attrs.height || 0), 20);
      if (mx >= x - 6 && mx <= x + w + 6 && my >= y - 6 && my <= y + hh + 6) out.push(o);
    }
  }
  return out;
}
function chooseAmong(list, cx, cy) {
  const anchor = h('div', { style: `position:fixed;left:${cx}px;top:${cy}px;width:1px;height:1px` });
  document.body.append(anchor);
  const items = [{ title: `这里叠着 ${list.length} 个，选一个：` }];
  for (const o of list.slice(0, 80)) {
    const nm = (o.props.find((p) => p.name === 'id') || {}).value || o.attrs.name || '对象';
    items.push({ label: `${nm}  ·  ${o.attrs.type || o.attrs.name || ''}`, check: o === ed.selected, run: () => { ed.selected = o; A.refresh('dock'); rend.request(); } });
  }
  menu(anchor, items);
  setTimeout(() => anchor.remove(), 0);
}
function beginObjDrag(o, p, how) {
  const G = ed.groupOf(o);
  const followers = objProp(o, 'unit') === 'commandCenter' ? ed.buildersOf(G, o) : [];
  const start = [o, ...followers].map((x) => [x, +(x.attrs.x || 0), +(x.attrs.y || 0), +(x.attrs.width || 0), +(x.attrs.height || 0)]);
  return { kind: 'objdrag', how, G, start, p0: p, moved: false };
}

// ---------------- 工具：移动 ----------------
function lineTiles(a, b, step, fn) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / step));
  for (let i = 1; i <= n; i++) fn(a[0] + dx * i / n, a[1] + dy * i / n);
}
function moveAction(e) {
  if (!act) return;
  const p = mapPt(e);
  const { tx, ty } = tileOf(p), { vx, vy } = vertOf(p);
  const m = ed.map;
  switch (act.kind) {
    case 'pan': {
      const z = rend.view.z;
      rend.view.ox = act.ox - (e.clientX - act.sx) / z; rend.view.oy = act.oy - (e.clientY - act.sy) / z;
      rend.request(); A.mini.draw();
      break;
    }
    case 'stroke': {
      const step = Math.max(0.5, ed.size / 3);
      lineTiles(act.last, [vx, vy], step, (x, y) => ed.paintTerrainAt(x, y, act.t));
      act.moved += Math.hypot(vx - act.last[0], vy - act.last[1]);
      act.last = [vx, vy];
      flushRecent(); rend.request();
      break;
    }
    case 'tileStroke': {
      if (tx === act.last[0] && ty === act.last[1]) break;
      const step = act.fn === 'item' && ed.item() && ed.item().stamp ? 1 : Math.max(1, Math.floor(ed.size / 2));
      const L = act.fn === 'rawErase' ? m.layer(ed.rawLayer) : act.fn === 'erase' ? m.ensureLayer('Items') : null;
      lineTiles(act.last, [tx, ty], step, (x, y) => {
        x = Math.round(x); y = Math.round(y);
        if (act.fn === 'item') PT.placeItems(PT.brushTiles(x, y), ed.item());
        else if (act.fn === 'random') PT.placeItems(PT.brushTiles(x, y), ed.item(ed.randomMix[0].key), { random: true });
        else if (act.fn === 'color') PT.paintColorTiles(PT.brushTiles(x, y), ed.colorGid);
        else if (act.fn === 'detail') DU.detailDab(x, y, A.detailBrush || 'roughen', A.detailStrength ?? 60);
        else if (act.fn === 'height') DU.heightDab(x, y, A.heightDir ?? 1, act.vis);
        else if (act.fn === 'biome') DU.biomeDab(x, y, A.biome ?? 1);
        else if (act.fn === 'raw') ed.rawPaintAt(x, y);
        else ed.eraseAt(L, x, y);
      });
      act.last = [tx, ty];
      flushRecent(); rend.request();
      break;
    }
    case 'shape': act.b = [Math.round(vx), Math.round(vy)]; rend.request(); break;
    case 'road': { const l = act.pts[act.pts.length - 1]; if (Math.hypot(vx - l[0], vy - l[1]) >= 1) { act.pts.push([vx, vy]); rend.request(); } break; }
    case 'tshape': if (tx !== act.b[0] || ty !== act.b[1]) { act.b = [tx, ty]; rend.request(); } break;
    case 'marquee': if (tx !== act.b[0] || ty !== act.b[1]) { act.b = [tx, ty]; act.moved = true; rend.request(); } break;
    case 'region': act.b = [Math.round(p.x / TW) * TW, Math.round(p.y / TW) * TW]; rend.request(); break;
    case 'float': {
      if (act.touch && Math.hypot(e.clientX - act.sx, e.clientY - act.sy) > 6) act.moved = true;
      moveFloat(tx, ty);
      break;
    }
    case 'objdrag': {
      const dx = p.x - act.p0.x, dy = p.y - act.p0.y;
      if (!act.moved && Math.hypot(dx, dy) * rend.view.z < 5) break;
      if (!act.moved) { ed.begin(act.how === 'resize' ? '改区域大小' : '移动'); ed.op.snapshotGroup(act.G); act.moved = true; }
      const trig = !act.start[0][0].attrs.gid;
      const snap = (v) => trig ? Math.round(v / TW) * TW : Math.round(v * 10) / 10;
      if (act.how === 'resize') {
        const [o, , , w0, h0] = act.start[0];
        o.attrs.width = String(Math.max(TW, snap(w0 + dx))); o.attrs.height = String(Math.max(TW, snap(h0 + dy)));
      } else {
        const [, x0, y0] = act.start[0];
        const nx = snap(x0 + dx), ny = snap(y0 + dy);
        for (const [o, ox, oy] of act.start) { o.attrs.x = String(+(ox + nx - x0).toFixed(1)); o.attrs.y = String(+(oy + ny - y0).toFixed(1)); }
      }
      rend.request();
      break;
    }
  }
}

// ---------------- 工具：抬起 ----------------
function endAction(e, cancelled = false) {
  if (!act) return;
  const a = act; act = null;
  cv.style.cursor = '';
  const m = ed.map;
  switch (a.kind) {
    case 'pick': if (!cancelled && A.pickPoint) A.pickPoint(a.tx, a.ty); break;
    case 'pan': A.hooks.coach && A.hooks.coach('pan'); break;
    case 'stroke': commit('painted'); A.mini.schedule(); break;
    case 'tileStroke': if (a.fn === 'biome') break; commit(a.fn === 'erase' || a.fn === 'rawErase' ? 'erased' : 'item'); rend.pools = ed.poolTiles(); A.mini.schedule(); break;
    case 'shape': {
      if (cancelled) break;
      ed.begin(a.shape === 'rect' ? '画矩形' : '画椭圆');
      ed.paintTerrainShape(a.shape, a.a, a.b, a.t);
      commit('painted'); A.mini.schedule();
      break;
    }
    case 'road': {
      if (cancelled || a.pts.length < 2) break;
      ed.begin('画道路'); DU.applyRoad(a.pts, ed.size, !!A.roadPave); commit('painted'); A.mini.schedule();
      break;
    }
    case 'tshape': {
      if (cancelled) break;
      ed.begin(a.label);
      a.apply(PT.shapeTilesSym(a.shape, a.a, a.b, ed.size));
      commit('item'); rend.pools = ed.poolTiles(); A.mini.schedule(); A.refresh('dock');
      break;
    }
    case 'marquee':
      if (!a.moved) { ed.selection = null; afterSelect(); break; }
      ed.selection = rectSelection(a.a[0], a.a[1], a.b[0], a.b[1], m); afterSelect(); break;
    case 'region': {
      if (cancelled) break;
      const x0 = Math.min(a.a[0], a.b[0]), y0 = Math.min(a.a[1], a.b[1]);
      const r = { x: x0, y: y0, w: Math.abs(a.b[0] - a.a[0]), h: Math.abs(a.b[1] - a.a[1]) };
      if (r.w < TW) { r.x = Math.floor(a.a[0] / TW) * TW - (r.w ? 0 : TW); r.w = Math.max(r.w, TW * (r.w ? 1 : 2)); }
      if (r.h < TW) { r.y = Math.floor(a.a[1] / TW) * TW - (r.h ? 0 : TW); r.h = Math.max(r.h, TW * (r.h ? 1 : 2)); }
      r.x = Math.max(0, r.x); r.y = Math.max(0, r.y);
      A.hooks.regionDrawn && A.hooks.regionDrawn(r);
      break;
    }
    case 'float':
      // 电脑：点一下放下；手机：拖动定位，点“放下”按钮确认
      if (!a.touch && !cancelled) placeFloat(e && e.shiftKey);
      break;
    case 'objdrag':
      if (a.moved) { commit('moved'); A.mini.draw(); A.refresh('dock'); }
      else if (a.many && a.many.length > 1 && !cancelled) chooseAmong(a.many, a.cx, a.cy);
      break;
  }
  rend.request();
}

// ---------------- 选区 ----------------
function afterSelect() { renderSelbar(); rend.request(); A.refresh('dock'); renderStatus(A.mouse); if (ed.selection) A.hooks.coach && A.hooks.coach('selected'); }
function selCopy() {
  if (!ed.selection) return null;
  ed.clipboard = copySelection(ed, ed.selection);
  toast(`已复制 ${ed.clipboard.w}×${ed.clipboard.h} 格${ed.clipboard.objects.length ? `，含 ${ed.clipboard.objects.length} 个单位` : ''}`);
  renderSelbar();
  return ed.clipboard;
}
function selCut() {
  if (!selCopy()) return;
  ed.begin('剪切');
  clearSelection(ed, ed.selection, ed.engine ? ed.terrain2 : null);
  commit(); A.mini.schedule();
  toast('已剪切。空出来的地方用副笔地形填上了');
}
function selClear() {
  if (!ed.selection) return;
  ed.begin('清空选区');
  clearSelection(ed, ed.selection, ed.engine ? ed.terrain2 : null);
  commit(); A.mini.schedule();
}
function selTransform(kind) {
  if (ed.floating) { ed.floating.clip = transformClip(ed, ed.floating.clip, kind); ed.floating.cv = null; rend.request(); return; }
  const s = ed.selection; if (!s) return;
  // 原地翻转/旋转：复制 → 清空 → 以中心为准贴回
  const clip = copySelection(ed, s);
  const t = transformClip(ed, clip, kind);
  const cx = (s.x0 + s.x1 + 1) / 2, cy = (s.y0 + s.y1 + 1) / 2;
  const nx = Math.round(cx - t.w / 2), ny = Math.round(cy - t.h / 2);
  ed.begin({ h: '左右翻转', v: '上下翻转', cw: '旋转 90°', ccw: '旋转 -90°' }[kind] || '变换');
  clearSelection(ed, s, ed.engine ? ed.terrain2 : null);
  const saveSym = ed.sym; ed.sym = 'none';
  pasteWithSymmetry(ed, t, nx, ny, { skipEmpty: false, newTeams: false });
  ed.sym = saveSym;
  commit(); A.mini.schedule();
  ed.selection = rectSelection(nx, ny, nx + t.w - 1, ny + t.h - 1, ed.map);
  if (ed.selection && t.mask) ed.selection.mask = t.mask.slice();
  afterSelect();
}
async function selToStamp() {
  if (!ed.selection) { toast('先用“框选”选中一块区域'); return; }
  const clip = copySelection(ed, ed.selection);
  const name = await promptBox('存为印章', '印章名字', `印章 ${clip.w}×${clip.h}`, '印章存在这台设备上，在“印章”面板里点一下就能放。也可以导出成文件分享给别人。');
  if (!name) return;
  await saveUserStamp(name, clip);
  toast('已存为印章：' + name);
  A.dockTab = 'stamps'; A.refresh('dock');
}
function selectAll() { if (!ed.map) return; ed.selection = rectSelection(0, 0, ed.map.width - 1, ed.map.height - 1, ed.map); afterSelect(); }
function deselect() { ed.selection = null; afterSelect(); }

// ---------------- 浮动内容 ----------------
function startFloating(clip, opts = {}) {
  if (!ed.map || !clip) return;
  if (ed.floating) cancelFloat();
  const c = rend.toMap(rend.cw / 2, rend.ch / 2);
  ed.floating = { clip, x: Math.round(c.x / TW - clip.w / 2), y: Math.round(c.y / TW - clip.h / 2), label: opts.label || '粘贴', onCancel: opts.onCancel, cv: null };
  if (A.isMobile()) { const d = document.getElementById('dock'); if (!d.classList.contains('collapsed')) { d.classList.add('collapsed'); A.dockAutoCollapsed = true; } }
  renderSelbar(); rend.request();
  toast(A.isMobile() ? '拖动摆好位置，再点下面的“放下”' : '移动鼠标摆好位置，点一下放下（按住 Shift 可以连续放）', 3200);
}
function moveFloat(tx, ty) {
  const f = ed.floating; if (!f) return;
  const ox = act && act.kind === 'float' ? act.ox : Math.floor(f.clip.w / 2), oy = act && act.kind === 'float' ? act.oy : Math.floor(f.clip.h / 2);
  const nx = tx - ox, ny = ty - oy;
  if (nx !== f.x || ny !== f.y) { f.x = nx; f.y = ny; rend.request(); }
}
function placeFloat(keep = false) {
  const f = ed.floating; if (!f) return;
  ed.begin(f.label);
  pasteWithSymmetry(ed, f.clip, f.x, f.y, { skipEmpty: A.skipEmpty !== false, newTeams: true });
  commit('placed');
  rend.pools = ed.poolTiles(); A.mini.schedule(); A.refresh('dock', 'top');
  if (!keep) { ed.floating = null; renderSelbar(); restoreDock(); }
  rend.request();
}
function cancelFloat() {
  const f = ed.floating; if (!f) return;
  ed.floating = null;
  if (f.onCancel) f.onCancel();
  renderSelbar(); restoreDock(); rend.request();
}
function restoreDock() { if (A.dockAutoCollapsed) { document.getElementById('dock').classList.remove('collapsed'); A.dockAutoCollapsed = false; } }
function paste() {
  if (!ed.clipboard) { toast('剪贴板是空的：先框选一块再复制'); return; }
  startFloating(ed.clipboard, { label: '粘贴' });
}

// 浮动内容的预览画布（地面按地形画纯色图块，物品照原样）
function clipCanvas(clip) {
  const m = ed.map, eng = ed.engine;
  const big = clip.w * clip.h > 90000;
  const s = big ? 1 : TW;
  const out = new OffscreenCanvas(Math.max(1, clip.w * s), Math.max(1, clip.h * s));
  const c = out.getContext('2d');
  c.imageSmoothingEnabled = false;
  const nameMap = eng && clip.names ? clip.names.map((n) => eng.index(n)) : [];
  const col = rend.colors;
  const draw = (gid, x, y) => {
    gid &= 0x1fffffff; if (!gid) return;
    if (big) { const k = gid * 4; if (col && col[k + 3]) { c.fillStyle = `rgb(${col[k]},${col[k + 1]},${col[k + 2]})`; c.fillRect(x, y, 1, 1); } return; }
    const ts = m.tilesetOf(gid); if (!ts || !ts.image) return;
    const id = gid - ts.firstgid;
    c.drawImage(ts.image, (id % ts.columns) * ts.tw, Math.floor(id / ts.columns) * ts.th, ts.tw, ts.th, x * 1, y * 1, s, s);
  };
  const W1 = clip.w + 1;
  for (let y = 0; y < clip.h; y++) for (let x = 0; x < clip.w; x++) {
    const k = y * clip.w + x;
    if (clip.mask && !clip.mask[k]) continue;
    let g = clip.ground[k];
    if (!g && clip.V && eng) {
      const vs = [clip.V[y * W1 + x], clip.V[y * W1 + x + 1], clip.V[(y + 1) * W1 + x], clip.V[(y + 1) * W1 + x + 1]].filter((v) => v !== NONE);
      if (vs.length) { const t = nameMap[vs[0]]; if (t >= 0) g = eng.solidGid(t); }
    }
    if (g) draw(g, x * s, y * s);
    if (clip.items[k]) draw(clip.items[k], x * s, y * s);
  }
  return out;
}

// ---------------- 选区操作条 ----------------
function renderSelbar() {
  const bar = document.getElementById('selbar');
  bar.innerHTML = '';
  const b = (ic, label, fn, cls = '') => h('button', { class: cls, onclick: fn, html: icon(ic) + `<span>${label}</span>` });
  if (ed.floating) {
    const f = ed.floating;
    bar.append(h('span', { class: 'info' }, `${f.label} ${f.clip.w}×${f.clip.h}`),
      b('check', '放下', () => placeFloat(false), 'primary'), b('flipH', '左右翻', () => selTransform('h')), b('flipV', '上下翻', () => selTransform('v')),
      b('rotate', '转 90°', () => selTransform('cw')), b('close', '取消', () => cancelFloat()));
  } else if (ed.selection) {
    const s = ed.selection;
    bar.append(h('span', { class: 'info' }, `选区 ${s.x1 - s.x0 + 1}×${s.y1 - s.y0 + 1}`),
      b('copy', '复制', selCopy), b('cut', '剪切', selCut), b('paste', '粘贴', paste), b('flipH', '左右翻', () => selTransform('h')), b('flipV', '上下翻', () => selTransform('v')),
      b('rotate', '转 90°', () => selTransform('cw')), b('stamp', '存印章', selToStamp), b('erase', '清空', selClear), b('close', '取消', deselect));
  }
  bar.classList.toggle('hidden', !bar.firstChild);
}

// ---------------- 叠加绘制 ----------------
let maskCanvas = null, maskFor = null;
function drawOverlay(ctx) {
  const m = ed.map; if (!m) return;
  const v = rend.view, z = v.z;
  const S = (x, y) => rend.toScreen(x, y);
  // 对称轴
  if (ed.sym !== 'none' && ['terrain', 'items', 'units', 'tiles'].includes(ed.mode)) {
    ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,178,122,.55)'; ctx.lineWidth = 1;
    const a = S(0, 0), b = S(m.width * TW, m.height * TW), c = S(m.width * TW / 2, m.height * TW / 2);
    ctx.beginPath();
    if (ed.sym === 'lr' || ed.sym === 'quad') { ctx.moveTo(c.x, a.y); ctx.lineTo(c.x, b.y); }
    if (ed.sym === 'tb' || ed.sym === 'quad') { ctx.moveTo(a.x, c.y); ctx.lineTo(b.x, c.y); }
    if (ed.sym === 'rot') { ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); }
    if (ed.sym === 'diag') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke(); ctx.restore();
  }
  // 选区
  const sel = ed.selection;
  if (sel) {
    const a = S(sel.x0 * TW, sel.y0 * TW), b = S((sel.x1 + 1) * TW, (sel.y1 + 1) * TW);
    if (sel.mask) {
      if (maskFor !== sel) {
        const w = sel.x1 - sel.x0 + 1, hh = sel.y1 - sel.y0 + 1;
        maskCanvas = new OffscreenCanvas(w, hh);
        const img = new ImageData(w, hh); const u = new Uint32Array(img.data.buffer);
        for (let i = 0; i < w * hh; i++) if (sel.mask[i]) u[i] = 0x55ffb27a >>> 0;
        maskCanvas.getContext('2d').putImageData(img, 0, 0); maskFor = sel;
      }
      ctx.imageSmoothingEnabled = false; ctx.drawImage(maskCanvas, a.x, a.y, b.x - a.x, b.y - a.y);
    } else { ctx.fillStyle = 'rgba(255,178,122,.08)'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); }
    ants(ctx, a.x, a.y, b.x - a.x, b.y - a.y);
  }
  // 浮动内容
  const f = ed.floating;
  if (f) {
    if (!f.cv) f.cv = clipCanvas(f.clip);
    const a = S(f.x * TW, f.y * TW), wpx = f.clip.w * TW * z, hpx = f.clip.h * TW * z;
    ctx.globalAlpha = 0.82; ctx.imageSmoothingEnabled = z < 1; ctx.drawImage(f.cv, a.x, a.y, wpx, hpx); ctx.globalAlpha = 1;
    for (const e of f.clip.objects) {
      if (objProp(e.o, 'unit') !== 'commandCenter') continue;
      const p = S(f.x * TW + e.dx, f.y * TW + e.dy);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(5, 12 * Math.min(1, z * 1.5)), 0, 7); ctx.fillStyle = teamColor(objProp(e.o, 'team')); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
    }
    ants(ctx, a.x, a.y, wpx, hpx);
    // 对称副本的位置
    const W = m.width, H = m.height, s = ed.sym, cps = [];
    if (s === 'lr' || s === 'quad') cps.push([W - f.x - f.clip.w, f.y]);
    if (s === 'tb' || s === 'quad') cps.push([f.x, H - f.y - f.clip.h]);
    if (s === 'rot' || s === 'quad') cps.push([W - f.x - f.clip.w, H - f.y - f.clip.h]);
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,178,122,.7)';
    for (const [x, y] of cps) { const q = S(x * TW, y * TW); ctx.strokeRect(q.x, q.y, wpx, hpx); }
    ctx.restore();
  }
  // 拖动中的框
  if (act && act.kind === 'marquee' && act.moved) {
    const [x0, x1] = [Math.min(act.a[0], act.b[0]), Math.max(act.a[0], act.b[0])], [y0, y1] = [Math.min(act.a[1], act.b[1]), Math.max(act.a[1], act.b[1])];
    const a = S(x0 * TW, y0 * TW), b = S((x1 + 1) * TW, (y1 + 1) * TW);
    ctx.fillStyle = 'rgba(255,178,122,.1)'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ants(ctx, a.x, a.y, b.x - a.x, b.y - a.y);
    label(ctx, `${x1 - x0 + 1}×${y1 - y0 + 1}`, b.x + 6, b.y + 4);
  }
  if (act && act.kind === 'shape' && ed.engine) {
    ctx.save(); ctx.strokeStyle = '#ffb27a'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    for (const [[ax, ay], [bx, by]] of ed.symPairs(act.a, act.b)) {
      const a = S(Math.min(ax, bx) * TW, Math.min(ay, by) * TW), b = S(Math.max(ax, bx) * TW, Math.max(ay, by) * TW);
      ctx.beginPath();
      if (act.shape === 'ellipse') ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(1, (b.x - a.x) / 2), Math.max(1, (b.y - a.y) / 2), 0, 0, Math.PI * 2);
      else ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.stroke();
    }
    ctx.restore();
    label(ctx, `${Math.abs(act.b[0] - act.a[0])}×${Math.abs(act.b[1] - act.a[1])}`, S(act.b[0] * TW, act.b[1] * TW).x + 8, S(act.b[0] * TW, act.b[1] * TW).y + 8);
  }
  if (act && act.kind === 'road') {
    ctx.save(); ctx.strokeStyle = '#ffb27a'; ctx.lineWidth = Math.max(2, ed.size * TW * z); ctx.globalAlpha = 0.45; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); act.pts.forEach(([x, y], i) => { const q = S(x * TW, y * TW); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); ctx.restore();
  }
  if (act && act.kind === 'tshape') {
    ctx.save(); ctx.fillStyle = 'rgba(255,178,122,.28)';
    const W = m.width;
    const tiles = PT.shapeTilesSym(act.shape, act.a, act.b, ed.size);
    if (tiles.length < 60000) for (const k of tiles) { const q = S((k % W) * TW, ((k / W) | 0) * TW); ctx.fillRect(q.x, q.y, TW * z + 0.5, TW * z + 0.5); }
    ctx.restore();
    label(ctx, act.shape === 'line' ? `${Math.round(Math.hypot(act.b[0] - act.a[0], act.b[1] - act.a[1]))} 格` : `${Math.abs(act.b[0] - act.a[0]) + 1}×${Math.abs(act.b[1] - act.a[1]) + 1}`, S((act.b[0] + 1) * TW, (act.b[1] + 1) * TW).x + 6, S((act.b[0] + 1) * TW, (act.b[1] + 1) * TW).y + 4);
  }
  const reg = act && act.kind === 'region' ? { x: Math.min(act.a[0], act.b[0]), y: Math.min(act.a[1], act.b[1]), w: Math.abs(act.b[0] - act.a[0]), h: Math.abs(act.b[1] - act.a[1]) } : A.pendingRect;
  if (reg) { const a = S(reg.x, reg.y); ctx.fillStyle = 'rgba(88,166,255,.15)'; ctx.fillRect(a.x, a.y, reg.w * z, reg.h * z); ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 2; ctx.strokeRect(a.x, a.y, reg.w * z, reg.h * z); }
  // 选中的触发器区域：右下角拖柄
  const so = ed.selected;
  if (so && !so.attrs.gid && ed.mode === 'triggers') {
    const b = S(+(so.attrs.x || 0) + +(so.attrs.width || 0), +(so.attrs.y || 0) + +(so.attrs.height || 0));
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.fillRect(b.x - 6, b.y - 6, 12, 12); ctx.strokeRect(b.x - 6, b.y - 6, 12, 12);
  }
  // 笔刷光标
  const mp = A.mouse;
  if (mp && !act?.kind?.match(/pan|marquee|region|objdrag/) && !ed.floating && !A.pickPoint) drawCursor(ctx, mp);
  if (mp && A.pickPoint) { const t = tileOf(mp), a = S(t.tx * TW, t.ty * TW); ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 2; ctx.strokeRect(a.x, a.y, TW * z, TW * z); }
}
function ants(ctx, x, y, w, hh) {
  ctx.save(); ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, w, hh);
  ctx.setLineDash([5, 4]); ctx.strokeStyle = '#ffb27a'; ctx.strokeRect(x, y, w, hh);
  ctx.restore();
}
function label(ctx, t, x, y) {
  t = (window.__rwT || String)(t);
  ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const w = ctx.measureText(t).width + 10;
  ctx.fillStyle = 'rgba(20,22,26,.9)'; ctx.fillRect(x, y, w, 18); ctx.fillStyle = '#ffb27a'; ctx.fillText(t, x + 5, y + 3);
}
function drawCursor(ctx, mp) {
  const m = ed.map, z = rend.view.z, T = tool();
  const S = (x, y) => rend.toScreen(x, y);
  ctx.save(); ctx.lineWidth = 1.5;
  if (ed.mode === 'terrain' && ed.engine && (T === 'brush' || T === 'fill' || T === 'pick' || T === 'detail' || T === 'height' || T === 'biome' || T === 'road')) {
    if (T !== 'fill' && T !== 'pick') {
      const cx = ed.brushCenter(mp.x / TW), cy = ed.brushCenter(mp.y / TW);
      for (const [x, y] of ed.symPoints(cx, cy, 'v')) {
        const c = S(x * TW, y * TW), r = Math.max(3, ed.size / 2 * TW * z);
        ctx.beginPath();
        if (ed.shape === 'square') ctx.rect(c.x - r, c.y - r, r * 2, r * 2); else ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#000'; ctx.stroke(); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([]);
      }
    } else { const c = S(Math.round(mp.x / TW) * TW, Math.round(mp.y / TW) * TW); ctx.beginPath(); ctx.arc(c.x, c.y, 5, 0, 7); ctx.strokeStyle = '#fff'; ctx.stroke(); }
  } else if ((ed.mode === 'items' || ed.mode === 'tiles' || (ed.mode === 'terrain' && T === 'color' && (A.colorShape || 'brush') === 'brush')) && ['stamp', 'random', 'erase', 'brush', 'color'].includes(T)) {
    const it = ed.mode === 'items' ? ed.item() : null;
    const { tx, ty } = tileOf(mp);
    const r = it && it.stamp && T === 'stamp' ? (ed.stampCells(it).length > 1 ? 1 : 0) : Math.floor(ed.size / 2);
    for (const [x, y] of ed.symPoints(tx, ty, 't')) {
      const a = S((Math.round(x) - r) * TW, (Math.round(y) - r) * TW);
      ctx.strokeStyle = T === 'erase' ? '#f2545b' : '#fff';
      ctx.strokeRect(a.x, a.y, (r * 2 + 1) * TW * z, (r * 2 + 1) * TW * z);
    }
  } else if (ed.mode === 'units' && (T === 'spawn' || T === 'unit')) {
    const { tx, ty } = tileOf(mp);
    for (const [x, y] of ed.symPoints(tx * TW + 10, ty * TW + 10, 'p')) {
      const c = S(x, y);
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(6, (T === 'spawn' ? 15 : 10) * z), 0, 7);
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------------- 指针事件 ----------------
function onDown(e) {
  if (!ed.map) return;
  closePopover();
  cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
  P.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
  if (P.size === 1) tapInfo = { n: 1, t: performance.now(), moved: false };
  else if (tapInfo) tapInfo.n = Math.max(tapInfo.n, P.size);
  if (P.size >= 2) {
    // 第二根手指：刚开始的笔画撤掉，其他动作结束
    if (act) {
      if (act.kind === 'stroke' && performance.now() - act.t0 < 180 && act.moved < 1.5) { ed.discard(); flushRecent(); rend.invalidateAll(); act = null; }
      else endAction(null, true);
    }
    beginGesture();
    return;
  }
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
  startAction(e);
}
function beginGesture() {
  const pts = [...P.values()];
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const d = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 1;
  gesture = { cx, cy, d, n: pts.length };
}
function onMove(e) {
  if (!ed.map) return;
  const pt = P.get(e.pointerId);
  if (pt) {
    if (tapInfo && Math.hypot(e.clientX - pt.sx, e.clientY - pt.sy) > 12) tapInfo.moved = true;
    pt.x = e.clientX; pt.y = e.clientY;
  }
  if (gesture && P.size >= 2) {
    const pts = [...P.values()];
    if (pts.length !== gesture.n) { beginGesture(); return; }
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const r = cv.getBoundingClientRect();
    const v = rend.view;
    v.ox -= (cx - gesture.cx) / v.z; v.oy -= (cy - gesture.cy) / v.z;
    if (gesture.d > 20 && d > 20) rend.zoomAt(cx - r.left, cy - r.top, d / gesture.d);
    gesture.cx = cx; gesture.cy = cy; gesture.d = d;
    rend.request(); A.mini.draw();
    return;
  }
  const p = mapPt(e);
  if (e.pointerType === 'mouse' || act) {
    A.mouse = p;
    if (ed.floating && !act && e.pointerType === 'mouse') moveFloat(tileOf(p).tx, tileOf(p).ty);
    scheduleStatus();
  }
  if (act) moveAction(e);
  else if (e.pointerType === 'mouse') rend.request();
}
function onUp(e, cancelled = false) {
  const had = P.has(e.pointerId);
  P.delete(e.pointerId);
  if (!had) return;
  if (gesture) {
    if (P.size === 0) {
      // 多指轻点：两指撤销，三指重做
      if (tapInfo && !tapInfo.moved && performance.now() - tapInfo.t < 300 && !cancelled) {
        if (tapInfo.n === 2) { ed.undo(); toast('撤销'); } else if (tapInfo.n >= 3) { ed.redo(); toast('重做'); }
      }
      gesture = null; tapInfo = null; A.hooks.coach && A.hooks.coach('zoom');
    } else beginGesture();
    return;
  }
  // 触屏抬手后不再画光标
  endAction(e, cancelled && act && act.kind !== 'stroke' && act.kind !== 'tileStroke');
  if (e.pointerType !== 'mouse') { A.mouse = null; rend.request(); }
  tapInfo = null;
}
let statusPending = false;
function scheduleStatus() { if (statusPending) return; statusPending = true; requestAnimationFrame(() => { statusPending = false; renderStatus(A.mouse); }); }

function onWheel(e) {
  if (!ed.map) return;
  e.preventDefault();
  const { sx, sy } = local(e);
  const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
  if (e.ctrlKey || !e.shiftKey) rend.zoomAt(sx, sy, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
  else { rend.view.ox += dy / rend.view.z; rend.request(); }
  A.mini.draw(); scheduleStatus();
}

// ---------------- 小地图 ----------------
function initMinimap() {
  const mini = document.getElementById('mini');
  let drag = false;
  const go = (e) => {
    const m = ed.map; if (!m) return;
    const r = mini.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    rend.centerOn(fx * m.width - 0.5, fy * m.height - 0.5);
    A.mini.draw();
  };
  mini.addEventListener('pointerdown', (e) => { drag = true; mini.setPointerCapture(e.pointerId); go(e); e.stopPropagation(); });
  mini.addEventListener('pointermove', (e) => { if (drag) go(e); });
  const end = () => { drag = false; };
  mini.addEventListener('pointerup', end); mini.addEventListener('pointercancel', end); mini.addEventListener('lostpointercapture', end);
}

// ---------------- 快捷键 ----------------
function inField(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
function onKey(e) {
  if (e.key === 'Escape') {
    if (modalOpen()) { closeModal(); return; }
    closePopover();
    if (A.pickPoint) { document.querySelector('.pickbar button')?.click(); return; }
    if (ed.floating) { cancelFloat(); return; }
    if (A.regionFor) { A.regionFor = null; toast('已取消'); return; }
    if (act) { if (act.kind === 'stroke' || act.kind === 'tileStroke') { ed.discard(); rend.invalidateAll(); } act = null; rend.request(); return; }
    if (ed.selection) { deselect(); return; }
    if (ed.selected) { ed.selected = null; A.refresh('dock'); rend.request(); }
    return;
  }
  if (inField(e) || modalOpen()) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const run = (id) => { e.preventDefault(); runAction(ACTIONS.find((a) => a.id === id)); };
  if (ctrl) {
    if (k === 'z' && !e.shiftKey) return run('undo');
    if ((k === 'z' && e.shiftKey) || k === 'y') return run('redo');
    if (k === 's') return run(e.shiftKey ? 'saveAs' : 'save');
    if (k === 'o') return run('open');
    if (k === 'n') return run('new');
    if (k === 'k') { e.preventDefault(); A.hooks.palette(); return; }
    if (k === 'c') { e.preventDefault(); selCopy(); return; }
    if (k === 'x') { e.preventDefault(); selCut(); return; }
    if (k === 'v') { e.preventDefault(); paste(); return; }
    if (k === 'a') { e.preventDefault(); selectAll(); return; }
    if (k === 'd') { e.preventDefault(); deselect(); return; }
    return;
  }
  if (e.key === 'F1') { e.preventDefault(); runAction(ACTIONS.find((a) => a.id === 'helpCenter')); return; }
  if (!ed.map) return;
  if (e.key === ' ') { if (!spaceDown) { spaceDown = true; cv.style.cursor = 'grab'; } e.preventDefault(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (ed.selected) { if (ed.mode === 'triggers' && A.hooks.removeTrigger) A.hooks.removeTrigger(ed.selected); else { ed.begin('删除'); ed.deleteObject(ed.selected); commit(); ed.selected = null; A.mini.draw(); A.refresh('dock', 'top'); } }
    else if (ed.selection) selClear();
    e.preventDefault(); return;
  }
  if (e.key === '[' || e.key === ']') { ed.size = Math.max(1, Math.min(64, ed.size + (e.key === ']' ? 1 : -1) * (ed.size >= 10 ? 2 : 1))); A.refresh('dock'); rend.request(); toast('笔刷大小 ' + ed.size, 900); return; }
  if (/^[1-6]$/.test(e.key)) { setMode(MODES[+e.key - 1].id); return; }
  if (e.key === '0') { rend.fit(); A.mini.draw(); return; }
  if (e.key === '=' || e.key === '+') { rend.zoomAt(rend.cw / 2, rend.ch / 2, 1.4); return; }
  if (e.key === '-') { rend.zoomAt(rend.cw / 2, rend.ch / 2, 1 / 1.4); return; }
  if (e.key === 'Enter' && ed.floating) { placeFloat(); return; }
  const t = TOOLS[ed.mode].find((x) => Array.isArray(x) && x[2].toLowerCase() === k);
  if (t) { setTool(t[0]); return; }
  if (k === 'x' && ed.mode === 'terrain') { [ed.terrain, ed.terrain2] = [ed.terrain2, ed.terrain]; A.refresh('dock'); toast('交换主副笔', 900); return; }
}
function onKeyUp(e) { if (e.key === ' ') { spaceDown = false; cv.style.cursor = ''; } }

// ---------------- 初始化 ----------------
export function initInput() {
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', (e) => onUp(e));
  cv.addEventListener('pointercancel', (e) => onUp(e, true));
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !act) { A.mouse = null; rend.request(); } });
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', () => { spaceDown = false; });
  initMinimap();
  rend.overlay = drawOverlay;
  Object.assign(A.hooks, { selCopy, selCut, paste, selectAll, deselect, selTransform, selToStamp, startFloating, cancelFloat, placeFloat, renderSelbar });
}
export { renderSelbar, cancelFloat, placeFloat, selCopy, paste };
