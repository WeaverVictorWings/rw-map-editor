// 八个大功能：开局推演、地图拼接、跨地图复制、地图库、批量处理、打包合集、版本对比、Mod 支持
import { A } from './state.js';
import { RWMap, Tileset, objProp, setObjProp } from './tmx.js';
import { Editor } from './editor.js';
import { Renderer, teamColor } from './render.js';
import { NONE } from './terrain.js';
import { passability, LAND, NAVAL, HOVER } from './pathing.js';
import { copySelection, unitTilesToObjects } from './transform.js';
import { runChecks, renderPreview } from './check.js';
import { readZip, writeZip } from './zip.js';
import { bytesToB64, kvGet, kvSet, Grow } from './util.js';
import { pickFile, saveFile, gameFolder, gameFolderSupported, listGameMaps, readGameMap, saveToGame, listRecent, recentText } from './files.js';
import { h, modal, closeModal, toast, busy, select, toggle, segmented, slider, promptBox } from './ui.js';
import { icon } from './icons.js';
import { HELP, helpBtn } from './help.js';

const ed = A.ed, rend = A.rend;
const TW = 20;

Object.assign(HELP, {
  'tool.timing': { t: '开局推演', s: '各队多少秒会遇到敌人', b: '按陆军、悬浮、海军的大致移动速度和实际要走的路线，估算“第几秒碰到最近的敌人”“多久走到地图中央”。可以看出 rush 打法是不是太快、某一队是不是太远。<br><b>数字是估算</b>：单位速度会因为单位种类、升级、地形而不同，误差约几秒到十几秒。' },
  'tool.stitch': { t: '地图拼接', s: '把几张图拼成一张大图', b: '选好几张地图，排成几列，拼成一张。接缝处的地形自动接好；单位的队伍号自动错开，触发器名字自动加前缀避免重名。拼完是一张新地图，不改动原图。', tips: ['几张图最好用同一套图块素材。', '适合把大图分区做好再拼起来。'] },
  'tool.crosscopy': { t: '从别的地图复制', s: '把另一张图里的一块搬过来', b: '打开另一张地图作参考，在它的缩略图上框选一块，就能像粘贴一样放进当前地图。地形会重新接好过渡。' },
  'tool.library': { t: '地图库', s: '所有做过、打开过的地图', b: '带缩略图、尺寸、人数、类型标签，可以搜索、收藏。也可以扫描游戏地图文件夹，把里面的地图都收进来。' },
  'tool.batch': { t: '批量处理', s: '一次检查、修复一堆地图', b: '选一个文件夹（或一批文件），一次性检查所有地图；可以顺手自动补 map_info、补水面和岩浆属性、补地面空格、生成封面。做地图合集时很省事。', tips: ['会直接覆盖原文件，建议先备份；不确定时只勾“检查”。'] },
  'tool.pack': { t: '打包地图合集', s: '做成可以直接放进游戏的 Mod', b: '选几张地图，填好名字和说明，打包成一个 .rwmod 文件。别人把它放进游戏的 mods 文件夹就能玩到整个合集。', tips: ['打包格式按社区常见写法，发布前请在游戏里试一次。'] },
  'tool.diff': { t: '版本对比', s: '看两个版本哪里不一样', b: '选一个快照和当前地图对比，不一样的地方用红色标出来。在对比图上框选一块，可以把那一块恢复成快照里的样子。' },
  'tool.mod': { t: 'Mod 支持', s: '用 Mod 里的单位和图块', b: '导入 .rwmod 或 .zip 格式的 Mod，编辑器会读出里面的单位（名字和图标）和图块集。单位会出现在单位面板的“Mod”分类里；图块集可以加进当前地图。', tips: ['RAR 格式的 Mod 请先解压，再打包成 zip。', '玩这张图的人也需要装同一个 Mod，否则 Mod 单位不会出现。'] },
});

// ---------------- 公共：临时读一张地图 ----------------
export async function loadTemp(text, name = '') {
  const map = await RWMap.parse(text, name);
  const e = new Editor(); e.setMap(map);
  if (e.unitsTs) unitTilesToObjects(e);
  const fake = { map }; Renderer.prototype.buildColors.call(fake);
  return { e, colors: fake.colors, map };
}
function canvasOf(e, colors, max = 600) {
  const oc = renderPreview(e, { colors, pools: e.poolTiles() }, max);
  const c = document.createElement('canvas'); c.width = oc.width; c.height = oc.height;
  c.getContext('2d').drawImage(oc, 0, 0);
  return c;
}
// 在缩略图上框选：返回 {el, get()}，get() 得到格子坐标的选区
function rectPicker(e, colors, max = 640, overlay = null) {
  const base = canvasOf(e, colors, max);
  const c = document.createElement('canvas'); c.width = base.width; c.height = base.height; c.className = 'pick';
  const x = c.getContext('2d');
  const k = base.width / e.map.width;
  let a = null, b = null, sel = null;
  const draw = () => {
    x.drawImage(base, 0, 0);
    if (overlay) x.drawImage(overlay, 0, 0, c.width, c.height);
    if (a && b) { x.strokeStyle = '#ffb27a'; x.lineWidth = 2; x.setLineDash([5, 4]); x.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); x.setLineDash([]); }
  };
  const pt = (ev) => { const r = c.getBoundingClientRect(); return [(ev.clientX - r.left) * c.width / r.width, (ev.clientY - r.top) * c.height / r.height]; };
  c.addEventListener('pointerdown', (ev) => { c.setPointerCapture(ev.pointerId); a = pt(ev); b = a; draw(); });
  c.addEventListener('pointermove', (ev) => { if (a && ev.buttons) { b = pt(ev); draw(); } });
  c.addEventListener('pointerup', () => {
    if (!a || !b) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) / k)), y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) / k));
    const x1 = Math.min(e.map.width - 1, Math.floor(Math.max(a[0], b[0]) / k)), y1 = Math.min(e.map.height - 1, Math.floor(Math.max(a[1], b[1]) / k));
    sel = x1 > x0 && y1 > y0 ? { x0, y0, x1, y1, mask: null } : null;
  });
  draw();
  return { el: c, get: () => sel };
}
// 把另一张图的图块编号换成当前地图里同名图块集的编号
function remapClip(e, clip) {
  const cache = new Map(); let dropped = 0;
  const map1 = ed.map;
  const conv = (g) => {
    if (!g) return 0;
    const f = g & 0xe0000000, id = g & 0x1fffffff;
    if (cache.has(id)) { const v = cache.get(id); return v ? (v | f) >>> 0 : 0; }
    const ts2 = e.map.tilesetOf(id); let v = 0;
    if (ts2) { const ts1 = map1.tilesets.find((t) => t.name === ts2.name); if (ts1) v = ts1.firstgid + (id - ts2.firstgid); }
    cache.set(id, v); if (!v) dropped++;
    return v ? (v | f) >>> 0 : 0;
  };
  clip.ground = clip.ground.map(conv); clip.items = clip.items.map(conv);
  for (const o of clip.objects) if (o.o.attrs.gid) { const v = conv(+o.o.attrs.gid); if (v) o.o.attrs.gid = String(v); }
  return dropped;
}

// ---------------- 1. 开局推演 ----------------
const SPEEDS = [['陆军（坦克）', LAND, 1.0], ['悬浮单位', HOVER, 1.6], ['海军', NAVAL, 1.1]];
function bfs(pass, W, H, mask, starts) {
  const d = new Int32Array(W * H).fill(-1), q = new Grow(4096);
  for (const s of starts) if (s >= 0 && (pass[s] & mask)) { d[s] = 0; q.push(s); }
  let i0 = 0;
  while (i0 < q.n) {
    const i = q.a[i0++], x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * H - W ? i + W : -1]) if (j >= 0 && d[j] < 0 && (pass[j] & mask)) { d[j] = d[i] + 1; q.push(j); }
  }
  return d;
}
function nearestPass(pass, W, H, x, y, mask) {
  for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && (pass[Y * W + X] & mask)) return Y * W + X; }
  return -1;
}
export function timingReport() {
  const m = ed.map, W = m.width, H = m.height, pass = passability(ed);
  const sp = ed.spawns().filter((s) => s.team >= 0).slice(0, 16);
  const center = [Math.floor(W / 2), Math.floor(H / 2)];
  const rows = sp.map((s) => ({ team: s.team, x: s.cx, y: s.cy, enemy: [], center: [] }));
  for (const [cn, mask, spd] of SPEEDS) {
    const starts = sp.map((s) => nearestPass(pass, W, H, Math.floor(s.cx / TW), Math.floor(s.cy / TW), mask));
    const c = nearestPass(pass, W, H, center[0], center[1], mask);
    sp.forEach((s, k) => {
      const d = bfs(pass, W, H, mask, [starts[k]]);
      let best = -1;
      sp.forEach((q, j) => { if (j !== k && starts[j] >= 0 && d[starts[j]] >= 0 && (best < 0 || d[starts[j]] < best)) best = d[starts[j]]; });
      rows[k].enemy.push(best < 0 ? null : Math.round(best / spd));
      rows[k].center.push(c >= 0 && d[c] >= 0 ? Math.round(d[c] / spd) : null);
    });
  }
  return { rows, kinds: SPEEDS.map((s) => s[0]) };
}
// 接战线：各队陆军同时出发，两队几乎同时到达的格子
export function frontline() {
  const m = ed.map, W = m.width, H = m.height, pass = passability(ed);
  const sp = ed.spawns().filter((s) => s.team >= 0);
  const owner = new Int16Array(W * H).fill(-1), dist = new Int32Array(W * H).fill(-1), q = new Grow(4096);
  sp.forEach((s, k) => { const i = nearestPass(pass, W, H, Math.floor(s.cx / TW), Math.floor(s.cy / TW), LAND); if (i >= 0 && dist[i] < 0) { dist[i] = 0; owner[i] = k; q.push(i); } });
  const front = new Uint8Array(W * H);
  let i0 = 0;
  while (i0 < q.n) {
    const i = q.a[i0++], x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * H - W ? i + W : -1]) {
      if (j < 0 || !(pass[j] & LAND)) continue;
      if (dist[j] < 0) { dist[j] = dist[i] + 1; owner[j] = owner[i]; q.push(j); }
      else if (owner[j] !== owner[i] && Math.abs(dist[j] - dist[i]) <= 1) { front[i] = 1; front[j] = 1; }
    }
  }
  return front;
}
export async function timingDialog() {
  const res = await busy('正在推演…', async () => timingReport());
  if (!res.rows.length) { toast('地图上还没有出生点'); return; }
  const fmt = (v) => v === null ? '—' : v >= 60 ? `${Math.floor(v / 60)} 分 ${v % 60} 秒` : `${v} 秒`;
  const tb = h('table', { class: 'rep' }, h('tr', {}, h('th', {}, '队伍'), ...res.kinds.map((k) => h('th', {}, k + ' 遇敌')), h('th', {}, '陆军到中央')));
  const en = res.rows.map((r) => r.enemy[0]).filter((v) => v !== null);
  for (const r of res.rows) tb.append(h('tr', {}, h('td', { html: `<span class="teamdot" style="background:${teamColor(r.team)}"></span>${r.team + 1}` }),
    ...r.enemy.map((v, i) => h('td', { class: i === 0 && v !== null && en.length > 1 && v === Math.min(...en) && Math.min(...en) < Math.max(...en) * 0.75 ? 'bad' : '' }, fmt(v))), h('td', {}, fmt(r.center[0]))));
  const spread = en.length > 1 ? Math.max(...en) - Math.min(...en) : 0;
  const body = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '按实际路线估算各队第一次碰到敌人的时间（数字是估算）。'), helpBtn('tool.timing')),
    h('div', { class: 'hint' + (spread > 20 ? ' warnh' : ''), style: 'margin:8px 0', html: en.length > 1 ? (spread > 20 ? `<b>各队遇敌时间相差 ${fmt(spread)}</b>，最早遇敌的一队（红字）开局压力明显更大。` : `各队遇敌时间接近（相差 ${fmt(spread)}），开局比较公平。`) + (Math.min(...en) < 45 ? '<br>最快不到 45 秒就会碰面，适合快节奏；想让大家多发育可以拉开距离或加障碍。' : '') : '' }),
    h('div', { style: 'overflow:auto' }, tb),
    h('button', { style: 'margin-top:10px', onclick: () => { closeModal(); showFront(); }, html: icon('flag') + ' 在地图上显示接战线' }));
  modal('开局推演', body, [{ label: '关闭', value: 1, primary: true }], { wide: true });
}
async function showFront() {
  const f = await busy('正在计算接战线…', async () => frontline());
  const red = ((200 << 24) | (60 << 16) | (80 << 8) | 255) >>> 0;
  rend.setTint({ kind: 'front', fn: (i) => (f[i] ? red : 0), opacity: 1 });
  A.overlayKind = 'front'; A.refresh('modes');
  toast('红色是两队几乎同时到达的地方——最可能交战的位置。在“叠加”里选“无”可以关掉。', 4200);
}

// ---------------- 2. 地图拼接 ----------------
export async function stitchDialog() {
  const inp = h('input', { type: 'file', multiple: true, accept: '.tmx' });
  const st = { cols: 2, includeCurrent: !!ed.map };
  const ok = await modal('地图拼接', h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '把几张地图按顺序排成几列，拼成一张新地图。'), helpBtn('tool.stitch')),
    ed.map ? toggle(`把当前地图「${A.mapName}」放在第一块`, st.includeCurrent, (v) => { st.includeCurrent = v; }) : null,
    h('label', {}, '选要拼的地图（按选择的顺序，从左到右、从上到下）'), inp,
    h('label', {}, '每行几张'), h('input', { type: 'number', min: 1, max: 8, value: st.cols, oninput: (e) => { st.cols = Math.max(1, Math.min(8, +e.target.value || 2)); } })),
  [{ label: '取消', value: false }, { label: '开始拼接', value: true, primary: true }]);
  if (!ok) return;
  const texts = [];
  if (st.includeCurrent && ed.map) texts.push([await (await import('./io.js')).serializeOnce(), A.mapName]);
  for (const f of inp.files) texts.push([await f.text(), f.name.replace(/\.tmx$/i, '')]);
  if (texts.length < 2) { toast('至少要两张地图'); return; }
  const text = await busy('正在拼接…', async () => stitch(texts, st.cols));
  const IO = await import('./io.js');
  await busy('正在打开拼好的地图…', () => IO.loadMapFromText(text, '拼接-' + texts.map((t) => t[1]).join('+').slice(0, 40) + '.tmx'));
  // 修缝：沿接缝重新铺过渡
  if (ed.engine && A.stitchSeams) {
    const op = ed.begin('拼接修缝'); op.snapV(); op.snapLayer(ed.engine.layer);
    for (const [x0, y0, x1, y1] of A.stitchSeams) ed.engine.repairRect(op, Math.max(0, x0), Math.max(0, y0), Math.min(ed.map.width, x1), Math.min(ed.map.height, y1));
    ed.engine.retileRect(op, 0, 0, ed.map.width - 1, ed.map.height - 1);
    op.markAll(); ed.commit(); ed.undoStack = [];
    rend.invalidateAll(); A.mini.rebuild();
  }
  ed.dirty = true; A.autoDirty = true; A.refresh();
  toast(`已拼成 ${ed.map.width}×${ed.map.height} 的新地图`, 3600);
}
async function stitch(texts, cols) {
  const maps = [];
  for (const [t, n] of texts) maps.push({ ...(await loadTemp(t, n)), name: n });
  const rows = Math.ceil(maps.length / cols);
  const colW = Array(cols).fill(0), rowH = Array(rows).fill(0);
  maps.forEach((mm, i) => { colW[i % cols] = Math.max(colW[i % cols], mm.map.width); rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], mm.map.height); });
  const offX = colW.map((_, c) => colW.slice(0, c).reduce((s, v) => s + v, 0)), offY = rowH.map((_, r) => rowH.slice(0, r).reduce((s, v) => s + v, 0));
  const W = colW.reduce((s, v) => s + v, 0), H = rowH.reduce((s, v) => s + v, 0);
  const base = maps[0].map, doc = base.doc;
  // 图块集合并：按名字对上；没有的追加到末尾
  for (const mm of maps.slice(1)) {
    mm.remap = new Map();
    for (const ts of mm.map.tilesets) {
      let t1 = base.tilesets.find((t) => t.name === ts.name && t.tilecount === ts.tilecount);
      if (!t1) {
        const el = doc.importNode(ts.el, true); el.setAttribute('firstgid', base.maxGid + 1);
        const last = [...base.root.querySelectorAll(':scope > tileset')].pop(); base.root.insertBefore(el, last ? last.nextSibling : base.root.firstChild);
        t1 = new Tileset(el); await t1.loadImage(); base.tilesets.push(t1); base.buildGidIndex();
      }
      mm.remap.set(ts, t1);
    }
  }
  const fillG = mostCommon(base.ground ? base.ground.data : []);
  const seams = [];
  for (const L of base.layers) {
    const data = new Uint32Array(W * H), flips = new Map();
    if (L === base.ground) data.fill(fillG);
    maps.forEach((mm, k) => {
      const ox = offX[k % cols], oy = offY[Math.floor(k / cols)];
      const L2 = k === 0 ? L : mm.map.layer(L.name); if (!L2) return;
      const mw = mm.map.width;
      for (let y = 0; y < mm.map.height; y++) for (let x = 0; x < mw; x++) {
        let g = L2.data[y * mw + x]; if (!g) continue;
        if (k) { const ts = mm.map.tilesetOf(g); const t1 = ts && mm.remap.get(ts); g = t1 ? t1.firstgid + (g - ts.firstgid) : 0; }
        const i = (oy + y) * W + ox + x; data[i] = g;
        const f = L2.flips.get(y * mw + x); if (f) flips.set(i, f);
      }
    });
    L.data = data; L.flips = flips; L.w = W; L.h = H; L.dirty = true; L.ver = (L.ver || 0) + 1;
  }
  // 其他地图独有的图层：跳过（常见地图只有 Ground / Items / Units）
  maps.forEach((mm, k) => { const ox = offX[k % cols], oy = offY[Math.floor(k / cols)]; if (k) seams.push([ox - 3, oy - 3, ox + 3, oy + mm.map.height + 3], [ox - 3, oy - 3, ox + mm.map.width + 3, oy + 3]); });
  base.width = W; base.height = H;
  // 对象：位置平移；队伍号错开；触发器名字加前缀
  let teamOff = 0;
  maps.forEach((mm, k) => {
    const teams = [...new Set(mm.e.spawns().map((s) => s.team).filter((t) => t >= 0))];
    const tmap = new Map(teams.sort((a, b) => a - b).map((t, i) => [t, teamOff + i]));
    teamOff += teams.length;
    if (!k) { for (const G of base.groups) for (const o of G.objects) retime(o, tmap); return; }
    const ox = offX[k % cols] * TW, oy = offY[Math.floor(k / cols)] * TW, pre = `m${k + 1}_`;
    for (const G2 of mm.map.groups) {
      const G = base.ensureGroup(G2.name);
      const trig = G2.name.toLowerCase() === 'triggers';
      for (const o0 of G2.objects) {
        if ((o0.attrs.name || '').toLowerCase() === 'map_info') continue;
        const o = { attrs: { ...o0.attrs }, props: o0.props.map((p) => ({ ...p })), extra: o0.extra };
        delete o.attrs.id;
        o.attrs.x = String(+(o.attrs.x || 0) + ox); o.attrs.y = String(+(o.attrs.y || 0) + oy);
        if (o.attrs.gid) { const g = +o.attrs.gid & 0x1fffffff, ts = mm.map.tilesetOf(g), t1 = ts && mm.remap.get(ts); if (t1) o.attrs.gid = String(t1.firstgid + (g - ts.firstgid)); }
        retime(o, tmap);
        if (trig) {
          if (o.attrs.name) o.attrs.name = pre + o.attrs.name;
          for (const p of o.props) if (p.name === 'id' || /^(activatedBy|alsoActivate|deactivatedBy|whenActivatedIds|activateIds)$/.test(p.name)) p.value = p.value.split(',').map((s) => s.trim() ? pre + s.trim() : s).join(',');
        }
        G.objects.push(o);
      }
    }
  });
  A.stitchSeams = seams;
  return base.serialize({});
}
function retime(o, tmap) {
  const t = objProp(o, 'team'); if (t === undefined || !tmap.has(+t)) return;
  const nt = tmap.get(+t); setObjProp(o, 'team', nt);
  const u = objProp(o, 'unit'); if (u) o.attrs.name = `${u} (t:${nt})`;
}
function mostCommon(d) { const c = new Map(); for (let i = 0; i < d.length; i += 97) c.set(d[i], (c.get(d[i]) || 0) + 1); let b = 0, bn = -1; for (const [g, n] of c) if (g && n > bn) { bn = n; b = g; } return b; }

// ---------------- 3. 跨地图复制 ----------------
export async function crossCopyDialog(text = null, name = '') {
  if (!ed.map) return;
  if (!text) { const r = await pickFile('.tmx'); if (!r) return; text = await r.file.text(); name = r.file.name; }
  const t = await busy('正在读取参考地图…', () => loadTemp(text, name));
  const pk = rectPicker(t.e, t.colors, 720);
  const ok = await modal(`从「${name}」复制`, h('div', {}, h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '在下面的缩略图上拖出一个框，选中要复制的一块。'), helpBtn('tool.crosscopy')), h('div', { class: 'pickwrap' }, pk.el)),
    [{ label: '取消', value: false }, { label: '复制并放到当前地图', value: true, primary: true }], { wide: true });
  const sel = pk.get();
  if (!ok || !sel) { if (ok) toast('先在缩略图上框选一块'); return; }
  const clip = copySelection(t.e, sel);
  const dropped = remapClip(t.e, clip);
  A.hooks.startFloating(clip, { label: '从别的地图复制' });
  if (dropped) toast(`有 ${dropped} 种图块当前地图里没有，已经略过（地形不受影响）`, 3600);
}

// ---------------- 4. 地图库 ----------------
export async function libraryDialog() {
  const lib = (await kvGet('library')) || {};
  const recent = await listRecent();
  for (const r of recent) if (!lib[r.name]) lib[r.name] = { name: r.name, w: r.w, h: r.h, teams: r.teams, thumb: r.thumb, time: r.time, recentId: r.id, tags: [] };
  const st = { q: '', fav: false, tag: '' };
  const grid = h('div', { class: 'recents lib' });
  const autoTags = (e) => [e.teams ? `${e.teams} 人` : null, e.w * e.h > 1e6 ? '超大' : e.w * e.h > 250000 ? '大' : '中小', e.type && e.type !== 'skirmish' ? ({ survival: '生存', mission: '任务', challenge: '挑战' })[e.type] || e.type : null, ...(e.tags || [])].filter(Boolean);
  const draw = () => {
    grid.innerHTML = '';
    const list = Object.values(lib).sort((a, b) => (b.fav - a.fav) || (b.time || 0) - (a.time || 0));
    for (const e of list) {
      const tags = autoTags(e);
      if (st.fav && !e.fav) continue;
      if (st.tag && !tags.includes(st.tag)) continue;
      if (st.q && !(e.name + tags.join(' ')).toLowerCase().includes(st.q.toLowerCase())) continue;
      grid.append(h('div', { class: 'rcard' },
        h('button', { class: 'fav' + (e.fav ? ' on' : ''), title: '收藏', onclick: async () => { e.fav = !e.fav; await kvSet('library', lib); draw(); } }, '★'),
        h('button', { class: 'thumbbtn', onclick: () => openEntry(e) }, h('img', { src: e.thumb || '', alt: '' })),
        h('b', {}, e.name), h('small', {}, `${e.w}×${e.h} · ${e.time ? new Date(e.time).toLocaleDateString() : ''}`),
        h('div', { class: 'tags' }, tags.map((t) => h('span', { class: 'badge', onclick: () => { st.tag = st.tag === t ? '' : t; draw(); } }, t))),
        h('button', { class: 'ib', title: '加标签', onclick: async () => { const t = await promptBox('加标签', '标签（逗号分隔）', (e.tags || []).join(',')); if (t !== null) { e.tags = t.split(/[,，]/).map((s) => s.trim()).filter(Boolean); await kvSet('library', lib); draw(); } }, html: icon('flag') })));
    }
    if (!grid.firstChild) grid.append(h('div', { class: 'hint' }, '没有找到地图。打开或保存过的地图会自动收进来，也可以扫描游戏文件夹。'));
  };
  const openEntry = async (e) => {
    closeModal();
    const IO = await import('./io.js');
    if (e.recentId) { const t = await recentText(e.recentId); if (t) return busy('正在打开…', () => IO.loadMapFromText(t, e.name + '.tmx', null, { noRecent: true })); }
    if (e.game && gameFolderSupported()) { try { const t = await busy('正在打开…', () => readGameMap(e.game)); return busy('正在读取地图…', () => IO.loadMapFromText(t, e.game)); } catch (err) { /* 下面改用选文件 */ } }
    toast('这张图没有在本机存全文（大图只记信息），请选一下文件');
    IO.openMap();
  };
  const scan = async () => {
    if (!gameFolderSupported() || !(await gameFolder())) { toast('先在“文件 → 从游戏文件夹打开”授权一次游戏地图文件夹'); return; }
    const files = (await listGameMaps()).slice(0, 150);
    let n = 0;
    await busy(`正在扫描 ${files.length} 张地图…`, async () => {
      for (const f of files) {
        try {
          const t = await loadTemp(await readGameMap(f.name), f.name);
          const c = canvasOf(t.e, t.colors, 128);
          const mi = t.e.mapInfo();
          lib[f.name.replace(/\.tmx$/i, '')] = { ...(lib[f.name.replace(/\.tmx$/i, '')] || {}), name: f.name.replace(/\.tmx$/i, ''), w: t.map.width, h: t.map.height, teams: t.e.usedTeams().size, thumb: c.toDataURL(), time: f.modified || Date.now(), game: f.name, type: mi ? objProp(mi, 'type') : '' };
          n++;
        } catch (e) { console.warn('扫描失败', f.name, e); }
      }
    });
    await kvSet('library', lib); draw(); toast(`已收进 ${n} 张地图`);
  };
  draw();
  modal('地图库', h('div', {},
    h('div', { class: 'row' }, h('input', { placeholder: '搜索名字或标签', style: 'flex:1;width:auto', oninput: (e) => { st.q = e.target.value; draw(); } }), toggle('只看收藏', false, (v) => { st.fav = v; draw(); }), helpBtn('tool.library')),
    h('div', { class: 'row', style: 'margin:8px 0' }, h('button', { onclick: scan, html: icon('folder') + ' 扫描游戏文件夹' })),
    grid), [{ label: '关闭', value: 1 }], { full: true });
}
// 保存或打开地图时记进地图库
export async function libraryRemember(meta) {
  const lib = (await kvGet('library')) || {};
  lib[meta.name] = { ...(lib[meta.name] || { tags: [] }), ...meta, time: Date.now() };
  const keys = Object.keys(lib);
  if (keys.length > 300) { keys.sort((a, b) => (lib[a].time || 0) - (lib[b].time || 0)); for (const k of keys.slice(0, keys.length - 300)) if (!lib[k].fav) delete lib[k]; }
  await kvSet('library', lib);
}

// ---------------- 5. 批量处理 ----------------
export async function batchDialog() {
  const st = { fixInfo: true, fixProps: true, fixGround: true, cover: true, write: false };
  const canFolder = gameFolderSupported();
  const inp = h('input', { type: 'file', multiple: true, accept: '.tmx' });
  const src = { v: canFolder ? 'game' : 'files' };
  const ok = await modal('批量处理', h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '一次检查、修复一批地图。'), helpBtn('tool.batch')),
    h('label', {}, '处理哪些地图'),
    canFolder ? segmented([['game', '游戏文件夹里的全部地图'], ['files', '我选的文件']], src.v, (v) => { src.v = v; }) : null, inp,
    h('label', {}, '要做什么'),
    toggle('补上缺少的 map_info', st.fixInfo, (v) => { st.fixInfo = v; }),
    toggle('补上水面、岩浆属性', st.fixProps, (v) => { st.fixProps = v; }),
    toggle('补上地面空格', st.fixGround, (v) => { st.fixGround = v; }),
    toggle('生成封面（地图名.png）', st.cover, (v) => { st.cover = v; }),
    toggle('改完写回（游戏文件夹：直接覆盖；选的文件：打包成 zip 下载）', st.write, (v) => { st.write = v; }),
    h('div', { class: 'hint warnh', style: 'margin-top:8px' }, '“写回”会覆盖原文件，建议先备份。不勾“写回”时只出检查报告。')),
  [{ label: '取消', value: false }, { label: '开始', value: true, primary: true }]);
  if (!ok) return;
  let jobs = [];
  if (src.v === 'game' && canFolder) {
    if (!(await gameFolder())) { toast('先授权一次游戏地图文件夹'); return; }
    jobs = (await listGameMaps()).map((f) => ({ name: f.name, read: () => readGameMap(f.name) }));
  } else jobs = [...inp.files].map((f) => ({ name: f.name, read: () => f.text() }));
  if (!jobs.length) { toast('没有要处理的地图'); return; }
  const report = [], outFiles = [];
  await busy(`正在处理 ${jobs.length} 张地图…`, async () => {
    for (const j of jobs) {
      try {
        const t = await loadTemp(await j.read(), j.name);
        const before = runChecks(t.e).filter((c) => c.level === 'error' || c.level === 'warn');
        let fixed = 0;
        for (const c of before) {
          if (!c.fix) continue;
          const want = (st.fixInfo && /map_info/.test(c.title)) || (st.fixProps && /water|lava|属性/.test(c.title + c.fix.label)) || (st.fixGround && /空格/.test(c.title));
          if (want) { try { c.fix.run(); fixed++; } catch (e) { /* 单个修复失败不影响其他 */ } }
        }
        const after = runChecks(t.e).filter((c) => c.level === 'error');
        report.push({ name: j.name, w: t.map.width, h: t.map.height, problems: before.length, fixed, left: after.map((c) => c.title) });
        if (st.write) {
          const base = j.name.replace(/\.tmx$/i, '');
          if (fixed) outFiles.push({ name: j.name, data: await t.map.serialize({}), mime: 'application/octet-stream' });
          if (st.cover) { const oc = renderPreview(t.e, { colors: t.colors }, A.settings.coverSize || 400); outFiles.push({ name: base + '.png', data: new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer()), mime: 'image/png' }); }
        }
      } catch (e) { report.push({ name: j.name, error: e.message }); }
    }
    if (st.write && outFiles.length) {
      if (src.v === 'game') await saveToGame(outFiles);
      else await saveFile('批量处理结果.zip', writeZip(outFiles.map((f) => ({ name: f.name, data: typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data }))), 'application/zip');
    }
  });
  const tb = h('table', { class: 'rep' }, h('tr', {}, h('th', {}, '地图'), h('th', {}, '尺寸'), h('th', {}, '问题'), h('th', {}, '已修'), h('th', {}, '还剩的严重问题')));
  for (const r of report) tb.append(h('tr', {}, h('td', {}, r.name), h('td', {}, r.error ? '—' : `${r.w}×${r.h}`), h('td', {}, r.error ? '读取失败' : r.problems), h('td', {}, r.fixed ?? '—'), h('td', { class: r.left && r.left.length ? 'bad' : '' }, r.error || (r.left.length ? r.left.join('；') : '无'))));
  modal('批量处理结果', h('div', { style: 'overflow:auto' }, tb, st.write ? h('p', { class: 'hint' }, `已写回 ${outFiles.length} 个文件。`) : h('p', { class: 'hint' }, '只做了检查，没有改动文件。')), [{ label: '关闭', value: 1, primary: true }], { wide: true });
}

// ---------------- 6. 打包地图合集 ----------------
export async function packDialog() {
  const inp = h('input', { type: 'file', multiple: true, accept: '.tmx' });
  const st = { title: '我的地图合集', desc: '', cur: !!ed.map };
  const ok = await modal('打包地图合集', h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '把几张地图打包成一个 .rwmod，别人放进游戏的 mods 文件夹就能玩到整个合集。'), helpBtn('tool.pack')),
    h('label', {}, '合集名字'), h('input', { value: st.title, oninput: (e) => { st.title = e.target.value; } }),
    h('label', {}, '说明'), h('textarea', { rows: 2, oninput: (e) => { st.desc = e.target.value; } }),
    ed.map ? toggle(`包含当前地图「${A.mapName}」`, st.cur, (v) => { st.cur = v; }) : null,
    h('label', {}, '再选几张地图（可以多选）'), inp,
    h('div', { class: 'hint', style: 'margin-top:8px' }, '每张地图会自动带上封面。打包格式按社区常见写法（mod-info.txt + maps 文件夹），发布前请在游戏里试一次。')),
  [{ label: '取消', value: false }, { label: '打包', value: true, primary: true }]);
  if (!ok) return;
  const files = [];
  const safe = (st.title || 'maps').replace(/[\\/:*?"<>|]/g, '_');
  await busy('正在打包…', async () => {
    const add = async (text, name) => {
      const t = await loadTemp(text, name);
      const base = name.replace(/\.tmx$/i, '');
      files.push({ name: `${safe}/maps/${base}.tmx`, data: text });
      const oc = renderPreview(t.e, { colors: t.colors }, A.settings.coverSize || 400);
      files.push({ name: `${safe}/maps/${base}.png`, data: new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer()) });
    };
    if (st.cur && ed.map) await add(await (await import('./io.js')).serializeOnce(), A.mapName + '.tmx');
    for (const f of inp.files) await add(await f.text(), f.name);
    files.unshift({ name: `${safe}/mod-info.txt`, data: `[mod]\ntitle: ${st.title}\ndescription: ${st.desc.replace(/\n/g, ' ')}\n` });
  });
  if (files.length < 3) { toast('至少要一张地图'); return; }
  const r = await saveFile(safe + '.rwmod', writeZip(files), 'application/zip');
  if (r.ok) toast(`已打包 ${(files.length - 1) / 2} 张地图：${safe}.rwmod`, 3600);
}

// ---------------- 7. 版本对比 ----------------
export async function diffDialog() {
  if (!ed.map) return;
  const IO = await import('./io.js');
  const snaps = await IO.snapshots();
  if (!snaps.length) { toast('这张地图还没有快照。先在“历史”里存一个快照，或者做一次缩放、镜像（会自动存）。'); return; }
  const pick = await modal('选一个快照来对比', h('div', { class: 'menulist' }, snaps.map((s, i) => h('button', { class: 'mitem', onclick: () => closeModal(i) }, h('span', { class: 'ml' }, s.name), h('kbd', {}, new Date(s.time).toLocaleString())))), [{ label: '取消', value: null }]);
  if (pick === null || pick === undefined) return;
  const t = await busy('正在对比…', () => loadTemp(snaps[pick].text, 'snapshot.tmx'));
  const m = ed.map, m2 = t.map;
  if (m2.width !== m.width || m2.height !== m.height) { toast(`快照尺寸是 ${m2.width}×${m2.height}，和现在不一样，只能并排看，不能逐格对比`); }
  const W = Math.min(m.width, m2.width), H = Math.min(m.height, m2.height);
  let n = 0;
  const k = Math.min(1, 640 / Math.max(m2.width, m2.height));
  const ov = document.createElement('canvas'); ov.width = Math.max(1, Math.round(m2.width * k)); ov.height = Math.max(1, Math.round(m2.height * k));
  const ox = ov.getContext('2d'); ox.fillStyle = 'rgba(242,84,91,.75)';
  const G1 = m.ground, G2 = m2.ground, I1 = m.items, I2 = m2.items;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = y * m.width + x, b = y * m2.width + x;
    const gid1 = G1 ? G1.data[a] : 0, gid2 = G2 ? G2.data[b] : 0;
    const ts1 = m.tilesetOf(gid1), ts2 = m2.tilesetOf(gid2);
    const same = (ts1 && ts2 ? ts1.name === ts2.name && gid1 - ts1.firstgid === gid2 - ts2.firstgid : gid1 === gid2) && (!!(I1 && I1.data[a]) === !!(I2 && I2.data[b]));
    if (!same) { n++; ox.fillRect(Math.floor(x * k), Math.floor(y * k), Math.max(1, Math.ceil(k)), Math.max(1, Math.ceil(k))); }
  }
  const cur = canvasOf(ed, rend.colors, 640);
  const pk = rectPicker(t.e, t.colors, 640, ov);
  const go = await modal(`版本对比：现在 ↔「${snaps[pick].name}」`, h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1', html: `有 <b>${n.toLocaleString()}</b> 格不一样（红色）。在右边的快照上框选一块，可以把它恢复成快照里的样子。` }), helpBtn('tool.diff')),
    h('div', { class: 'diffwrap' }, h('div', {}, h('b', {}, '现在'), cur), h('div', {}, h('b', {}, '快照（红色 = 不一样）'), pk.el))),
  [{ label: '关闭', value: null }, { label: '把框选的一块恢复成快照', value: 'restore', primary: true }], { full: true });
  if (go !== 'restore') return;
  const sel = pk.get(); if (!sel) { toast('先在快照上框选一块'); return; }
  const clip = copySelection(t.e, sel); remapClip(t.e, clip);
  const { pasteClip } = await import('./transform.js');
  ed.begin('从快照恢复一块');
  pasteClip(ed, clip, sel.x0, sel.y0, { skipEmpty: false, newTeams: false });
  ed.commit(); rend.invalidateAll(); A.mini.rebuild(); A.refresh();
  toast('已恢复。不满意可以撤销。');
}

// ---------------- 8. Mod 支持 ----------------
export async function modDialog() {
  const saved = (await kvGet('mods')) || [];
  const box = h('div', {});
  const draw = () => {
    box.innerHTML = '';
    box.append(h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '导入 .rwmod 或 .zip 格式的 Mod，读出里面的单位和图块集。'), helpBtn('tool.mod')));
    for (const md of saved) box.append(h('div', { class: 'card', style: 'margin-top:8px' },
      h('div', { class: 'row' }, h('b', { style: 'flex:1' }, md.title), h('small', {}, `${md.units.length} 个单位 · ${md.tilesets.length} 个图块集`),
        h('button', { class: 'ib', title: '移除', onclick: async () => { saved.splice(saved.indexOf(md), 1); await kvSet('mods', saved); await loadModUnits(); draw(); }, html: icon('del') })),
      md.tilesets.length && ed.map ? h('div', { class: 'row', style: 'margin-top:6px' }, md.tilesets.map((ts) => h('button', { onclick: async () => { await addModTileset(ts); toast('已加进当前地图，可以在“图块”模式里使用'); }, html: icon('tiles') + ' 加入 ' + ts.name }))) : null));
    box.append(h('button', { class: 'primary', style: 'margin-top:10px', onclick: async () => {
      const r = await pickFile('.rwmod,.zip,application/zip'); if (!r) return;
      try { const md = await busy('正在读取 Mod…', async () => parseMod(new Uint8Array(await r.file.arrayBuffer()), r.file.name)); saved.push(md); await kvSet('mods', saved); await loadModUnits(); draw(); toast(`读到 ${md.units.length} 个单位、${md.tilesets.length} 个图块集`); }
      catch (e) { toast(e.message, 5000); }
    }, html: icon('import') + ' 导入 Mod' }));
    box.append(h('div', { class: 'hint', style: 'margin-top:8px' }, 'Mod 单位会出现在单位面板的“Mod”分类里。玩这张图的人也需要装同一个 Mod。'));
  };
  draw();
  modal('Mod 支持', box, [{ label: '关闭', value: 1 }]);
}
async function parseMod(bytes, fname) {
  const entries = readZip(bytes);
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  const units = [], tilesets = [];
  let title = fname.replace(/\.(rwmod|zip)$/i, '');
  const info = entries.find((e) => /mod-info\.txt$/i.test(e.name));
  if (info) { const m = (await info.text()).match(/^\s*title\s*:\s*(.+)$/mi); if (m) title = m[1].trim(); }
  for (const e of entries) {
    if (!/\.ini$/i.test(e.name) || /all-units\.template|mod-info/i.test(e.name)) continue;
    const txt = await e.text();
    const core = txt.split(/^\s*\[/m).find((s) => /^core\]/i.test(s)) || '';
    const nm = (core.match(/^\s*name\s*:\s*(\S+)/mi) || [])[1];
    if (!nm) continue;
    const gfx = txt.split(/^\s*\[/m).find((s) => /^graphics\]/i.test(s)) || '';
    let img = (gfx.match(/^\s*image\s*:\s*(\S+)/mi) || [])[1];
    let icon64 = null;
    if (img && !/^(ROOT|CORE|SHARED):/i.test(img)) {
      const dir = e.name.split('/').slice(0, -1).join('/');
      const pe = byName.get((dir ? dir + '/' : '') + img.toLowerCase()) || entries.find((x) => x.name.toLowerCase().endsWith('/' + img.toLowerCase()));
      if (pe) icon64 = await thumbData(await pe.bytes());
    }
    units.push({ name: nm, icon: icon64 });
  }
  for (const e of entries) {
    if (!/\.tsx$/i.test(e.name)) continue;
    const txt = await e.text(); const doc = new DOMParser().parseFromString(txt, 'application/xml');
    const tsEl = doc.querySelector('tileset'); const im = doc.querySelector('tileset > image'); if (!tsEl || !im) continue;
    const dir = e.name.split('/').slice(0, -1).join('/');
    const pe = byName.get(((dir ? dir + '/' : '') + im.getAttribute('source')).toLowerCase()) || entries.find((x) => x.name.toLowerCase().endsWith('/' + (im.getAttribute('source') || '').toLowerCase().split('/').pop()));
    if (!pe) continue;
    tilesets.push({ name: tsEl.getAttribute('name') || e.name, tsx: txt, png: bytesToB64(await pe.bytes()) });
  }
  if (!units.length && !tilesets.length) throw new Error('这个 Mod 里没找到单位（.ini）或图块集（.tsx）');
  return { title, units, tilesets };
}
async function thumbData(bytes) {
  try {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const s = Math.min(1, 48 / Math.max(bmp.width, bmp.height)), c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const b = await c.convertToBlob({ type: 'image/png' });
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  } catch (e) { return null; }
}
export async function loadModUnits() {
  const saved = (await kvGet('mods')) || [];
  const list = [];
  for (const md of saved) for (const u of md.units) {
    let ic = null;
    if (u.icon) { try { ic = await createImageBitmap(await (await fetch(u.icon)).blob()); } catch (e) { ic = null; } }
    list.push({ name: u.name, icon: ic, mod: md.title });
  }
  A.modUnits = list;
}
async function addModTileset(ts) {
  const m = ed.map, doc = m.doc;
  const t2 = new DOMParser().parseFromString(ts.tsx, 'application/xml').querySelector('tileset');
  const el = doc.importNode(t2, true); el.setAttribute('firstgid', m.maxGid + 1);
  let ps = el.querySelector(':scope > properties'); if (!ps) { ps = doc.createElement('properties'); el.insertBefore(ps, el.firstChild); }
  const p = doc.createElement('property'); p.setAttribute('name', 'embedded_png'); p.textContent = '\n' + ts.png + '\n'; ps.appendChild(p);
  const last = [...m.root.querySelectorAll(':scope > tileset')].pop(); m.root.insertBefore(el, last ? last.nextSibling : m.root.firstChild);
  const nt = new Tileset(el); await nt.loadImage(); m.tilesets.push(nt); m.tilesets.sort((a, b) => a.firstgid - b.firstgid); m.buildGidIndex();
  rend.buildColors(); ed.dirty = true; A.autoDirty = true; A.refresh('dock');
}
