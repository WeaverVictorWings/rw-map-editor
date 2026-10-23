// 素材：补外部地块集、色块调色板（纯色图块，带游戏性质）
import { A } from './state.js';
import { Tileset } from './tmx.js';
import { bytesToB64 } from './util.js';
import { h, modal, toast, busy, closeModal } from './ui.js';
import { icon } from './icons.js';

const ed = A.ed, rend = A.rend;
const TW = 20;

// ---------------- 缺图片的地块集 ----------------
export function missingTilesets(map = ed.map) {
  return map ? map.tilesets.filter((t) => !t.image) : [];
}
const base = (p) => String(p || '').split(/[\\/]/).pop().toLowerCase();

function setEmbedded(doc, el, b64) {
  let ps = el.querySelector(':scope > properties');
  if (!ps) { ps = doc.createElement('properties'); el.insertBefore(ps, el.firstChild); }
  let p = [...ps.querySelectorAll(':scope > property')].find((q) => q.getAttribute('name') === 'embedded_png');
  if (!p) { p = doc.createElement('property'); p.setAttribute('name', 'embedded_png'); ps.appendChild(p); }
  p.removeAttribute('value');
  p.textContent = '\n' + b64 + '\n';
}

// files：用户选的 .tsx / .png。把外部引用换成内嵌，把图片嵌进地图
export async function fixMissing(files) {
  const m = ed.map, doc = m.doc;
  const byName = new Map(files.map((f) => [base(f.name), f]));
  let fixed = 0;
  for (const ts of missingTilesets()) {
    let el = ts.el;
    if (ts.source) {
      const f = byName.get(base(ts.source));
      if (!f) continue;
      const tdoc = new DOMParser().parseFromString(await f.text(), 'application/xml');
      const troot = tdoc.querySelector('tileset');
      if (!troot) continue;
      const nel = doc.importNode(troot, true);
      nel.setAttribute('firstgid', ts.firstgid);
      el.parentNode.replaceChild(nel, el);
      el = nel;
    }
    const img = el.querySelector(':scope > image');
    const png = img && byName.get(base(img.getAttribute('source')));
    if (!png) continue;
    setEmbedded(doc, el, bytesToB64(new Uint8Array(await png.arrayBuffer())));
    const nts = new Tileset(el);
    await nts.loadImage();
    if (!nts.image) continue;
    m.tilesets[m.tilesets.indexOf(ts)] = nts;
    fixed++;
  }
  m.tilesets.sort((a, b) => a.firstgid - b.firstgid);
  m.buildGidIndex();
  return fixed;
}

export async function missingDialog() {
  const miss = missingTilesets();
  if (!miss.length) { toast('所有地块集都有图片'); return; }
  const need = miss.map((t) => t.source ? base(t.source) : base(t.imageSource) || t.name);
  const inp = h('input', { type: 'file', multiple: true, accept: '.tsx,.png,image/png' });
  const ok = await modal('补上缺少的地块图', h('div', {},
    h('p', {}, `这张地图有 ${miss.length} 个地块集找不到图片，相关的格子会显示成紫色。通常是用电脑版 Tiled 做的图，地块集放在游戏目录里没有嵌进地图。`),
    h('div', { class: 'hint', html: '需要的文件：<b>' + need.join('、') + '</b><br>在游戏安装目录的 <b>assets/tilesets</b> 里能找到（.tsx 和对应的 .png 都选上）。补上后图片会嵌进地图，以后不用再找。' }),
    h('label', {}, '选择文件（可以多选）'), inp), [{ label: '取消', value: false }, { label: '补上', value: true, primary: true }]);
  if (!ok || !inp.files.length) return;
  const n = await busy('正在补地块图…', () => fixMissing([...inp.files]));
  rend.buildColors(); rend.invalidateAll(); rend.buildOverview(); A.mini.rebuild();
  ed.dirty = true; A.autoDirty = true; A.refresh();
  toast(n ? `已补上 ${n} 个地块集` : '没有匹配上：文件名要和地图里引用的一致');
}

// ---------------- 色块 ----------------
// 所有颜色放在同一个地块集 rw_colors 里，固定 64 格；每格的属性决定游戏里的性质
export const KINDS = [
  ['land', '陆地（草地，默认）', {}, '能走、能建造，和草地一样'],
  ['ford', '浅滩', { 'water-bridge': '' }, '陆军和船都能通过'],
  ['shallow', '浅水', { water: '' }, '船能走，陆军不能'],
  ['deep', '深水', { water: '' }, '船能走，陆军不能（看起来更深）'],
  ['block', '不可通行', { 'large-cliff': '' }, '像悬崖一样，地面单位过不去'],
  ['lava', '岩浆', { lava: '' }, '地面单位过不去'],
];
const CAP = 64, COLS = 8;
export function colorTileset() { return ed.map ? ed.map.tilesets.find((t) => t.name === 'rw_colors') || null : null; }
export function colorList() {
  const ts = colorTileset(); if (!ts) return [];
  const out = [];
  for (const [id, info] of ts.tiles) if (info.props.rw_color) out.push({ id, gid: ts.firstgid + id, hex: info.props.rw_color, kind: info.props.rw_kind || 'land' });
  return out.sort((a, b) => a.id - b.id);
}
async function drawAtlas(ts) {
  const c = new OffscreenCanvas(COLS * TW, (CAP / COLS) * TW), x = c.getContext('2d');
  for (const e of colorList()) {
    const cx = (e.id % COLS) * TW, cy = Math.floor(e.id / COLS) * TW;
    x.fillStyle = e.hex; x.fillRect(cx, cy, TW, TW);
    // 轻微的纹理，免得看着像界面色块；水类加波纹，不可通行加斜线
    x.globalAlpha = 0.08; x.fillStyle = '#000';
    for (let k = 0; k < 6; k++) x.fillRect(cx + ((k * 7) % TW), cy + ((k * 11) % TW), 2, 2);
    x.globalAlpha = 0.22; x.strokeStyle = '#fff'; x.lineWidth = 1;
    if (e.kind === 'shallow' || e.kind === 'deep' || e.kind === 'ford') { x.beginPath(); x.moveTo(cx + 3, cy + 10); x.quadraticCurveTo(cx + 7, cy + 7, cx + 10, cy + 10); x.quadraticCurveTo(cx + 13, cy + 13, cx + 17, cy + 10); x.stroke(); }
    if (e.kind === 'block' || e.kind === 'lava') { x.beginPath(); x.moveTo(cx, cy + TW); x.lineTo(cx + TW, cy); x.stroke(); }
    x.globalAlpha = 1;
  }
  const png = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  const doc = ed.map.doc;
  setEmbedded(doc, ts.el, bytesToB64(png));
  ts.embeddedPng = bytesToB64(png);
  await ts.loadImage();
}
function ensureColorTileset() {
  let ts = colorTileset();
  if (ts) return ts;
  const m = ed.map, doc = m.doc;
  const el = doc.createElement('tileset');
  el.setAttribute('firstgid', m.maxGid + 1); el.setAttribute('name', 'rw_colors');
  el.setAttribute('tilewidth', TW); el.setAttribute('tileheight', TW); el.setAttribute('tilecount', CAP); el.setAttribute('columns', COLS);
  const im = doc.createElement('image'); im.setAttribute('source', 'rw_colors.png'); im.setAttribute('width', COLS * TW); im.setAttribute('height', CAP / COLS * TW);
  el.appendChild(im);
  const last = [...m.root.querySelectorAll(':scope > tileset')].pop();
  m.root.insertBefore(el, last ? last.nextSibling : m.root.firstChild);
  ts = new Tileset(el);
  m.tilesets.push(ts); m.tilesets.sort((a, b) => a.firstgid - b.firstgid); m.buildGidIndex();
  return ts;
}
function writeTileProps(ts, id, hex, kind) {
  const doc = ed.map.doc;
  let t = [...ts.el.querySelectorAll(':scope > tile')].find((e) => +e.getAttribute('id') === id);
  if (!t) { t = doc.createElement('tile'); t.setAttribute('id', id); ts.el.appendChild(t); }
  t.innerHTML = '';
  const ps = doc.createElement('properties');
  const props = { ...Object.fromEntries(Object.entries((KINDS.find((k) => k[0] === kind) || KINDS[0])[2])), rw_color: hex, rw_kind: kind };
  for (const [k, v] of Object.entries(props)) { const p = doc.createElement('property'); p.setAttribute('name', k); p.setAttribute('value', v); ps.appendChild(p); }
  t.appendChild(ps);
  ts.tiles.set(id, { terrain: null, props });
}
// 新增或修改一种颜色，返回它的 gid
export async function addColor(hex, kind, id = null) {
  const ts = ensureColorTileset();
  const used = new Set(colorList().map((e) => e.id));
  if (id === null) {
    const same = colorList().find((e) => e.hex.toLowerCase() === hex.toLowerCase() && e.kind === kind);
    if (same) return same.gid;
    id = 0; while (used.has(id)) id++;
    if (id >= CAP) { toast(`色块最多 ${CAP} 种，请先删掉不用的`); return null; }
  }
  writeTileProps(ts, id, hex, kind);
  await drawAtlas(ts);
  afterChange();
  return ts.firstgid + id;
}
export async function removeColor(id) {
  const ts = colorTileset(); if (!ts) return;
  const t = [...ts.el.querySelectorAll(':scope > tile')].find((e) => +e.getAttribute('id') === id);
  if (t) t.remove();
  ts.tiles.delete(id);
  await drawAtlas(ts);
  afterChange();
}
function afterChange() { rend.buildColors(); rend.invalidateAll(); A.mini.schedule(); ed.dirty = true; A.autoDirty = true; }
export function colorUsed(gid) {
  const d = ed.map.ground ? ed.map.ground.data : null;
  if (!d) return 0;
  let n = 0; for (let i = 0; i < d.length; i++) if (d[i] === gid) n++;
  return n;
}

// ---------------- 调色板控件 ----------------
const hexOf = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, mx ? d / mx * 100 : 0, mx * 100];
}
function hsv2rgb(hh, s, v) {
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
export const SWATCHES = ['#4f8f3a', '#6aa84f', '#2f5d1e', '#b7a36b', '#d9c38f', '#8a6a4a', '#5b4636', '#9e9e9e', '#d0d4d8', '#f2f5f7',
  '#3d7fbf', '#245a91', '#173f6b', '#6fb7c9', '#c0392b', '#e67e22', '#f1c40f', '#8e44ad', '#2c3e50', '#000000'];

// 返回 Promise<{hex, kind}|null>
export function colorPicker(init = { hex: '#4f8f3a', kind: 'land' }, title = '新建色块') {
  const st = { hex: init.hex, kind: init.kind };
  const prev = h('div', { class: 'cprev' });
  const hexI = h('input', { value: st.hex, style: 'font-family:ui-monospace,monospace', onchange: (e) => { if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) { st.hex = '#' + e.target.value.trim().replace('#', '').toLowerCase(); sync('hex'); } } });
  const sliders = {};
  const mk = (key, label, max, fn) => {
    const out = h('output', {});
    const inp = h('input', { type: 'range', min: 0, max, step: 1, oninput: () => fn(+inp.value) });
    sliders[key] = { inp, out };
    return h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'range' }, inp, out));
  };
  const setRGB = (i, v) => { const c = rgbOf(st.hex); c[i] = v; st.hex = hexOf(...c); sync('rgb'); };
  const setHSV = (i, v) => { const c = rgb2hsv(...rgbOf(st.hex)); c[i] = v; st.hex = hexOf(...hsv2rgb(...c)); sync('hsv'); };
  const rgbBox = h('div', {}, mk('r', '红 R', 255, (v) => setRGB(0, v)), mk('g', '绿 G', 255, (v) => setRGB(1, v)), mk('b', '蓝 B', 255, (v) => setRGB(2, v)));
  const hsvBox = h('div', { class: 'hidden' }, mk('h', '色相', 359, (v) => setHSV(0, v)), mk('s', '饱和度', 100, (v) => setHSV(1, v)), mk('v', '亮度', 100, (v) => setHSV(2, v)));
  const sync = (from) => {
    prev.style.background = st.hex;
    if (from !== 'hex') hexI.value = st.hex;
    const [r, g, b] = rgbOf(st.hex);
    if (from !== 'rgb') { sliders.r.inp.value = r; sliders.g.inp.value = g; sliders.b.inp.value = b; }
    sliders.r.out.textContent = r; sliders.g.out.textContent = g; sliders.b.out.textContent = b;
    const [hh, s, v] = rgb2hsv(r, g, b);
    if (from !== 'hsv') { sliders.h.inp.value = Math.round(hh); sliders.s.inp.value = Math.round(s); sliders.v.inp.value = Math.round(v); }
    sliders.h.out.textContent = Math.round(hh) + '°'; sliders.s.out.textContent = Math.round(s) + '%'; sliders.v.out.textContent = Math.round(v) + '%';
  };
  const modeSeg = h('div', { class: 'seg' }, ...[['rgb', 'RGB'], ['hsv', 'HSV（色相/饱和度/亮度）']].map(([k, l], i) => h('button', { class: i ? '' : 'on', onclick: (e) => { for (const b of e.currentTarget.parentNode.children) b.classList.toggle('on', b === e.currentTarget); rgbBox.classList.toggle('hidden', k !== 'rgb'); hsvBox.classList.toggle('hidden', k !== 'hsv'); } }, l)));
  const sw = h('div', { class: 'swgrid' }, SWATCHES.map((c) => h('button', { class: 'swc', style: `background:${c}`, title: c, onclick: () => { st.hex = c; sync(); } })));
  const recent = h('div', { class: 'swgrid' }, colorList().map((e) => h('button', { class: 'swc', style: `background:${e.hex}`, title: e.hex, onclick: () => { st.hex = e.hex; sync(); } })));
  const kinds = h('div', { class: 'kinds' });
  const drawKinds = () => { kinds.innerHTML = ''; for (const [k, l, , d] of KINDS) kinds.append(h('button', { class: 'kind' + (st.kind === k ? ' on' : ''), onclick: () => { st.kind = k; drawKinds(); } }, h('b', {}, l), h('small', {}, d))); };
  drawKinds();
  const eye = window.EyeDropper ? h('button', { onclick: async () => { try { const r = await new window.EyeDropper().open(); st.hex = r.sRGBHex.length === 7 ? r.sRGBHex : st.hex; sync(); } catch (e) {} }, html: icon('pick') + ' 吸取屏幕颜色' }) : null;
  const body = h('div', { class: 'cpick' },
    h('div', { class: 'row' }, prev, h('div', { style: 'flex:1' }, h('label', {}, '色号'), hexI), eye),
    h('div', { style: 'margin:8px 0' }, modeSeg), rgbBox, hsvBox,
    h('label', {}, '常用颜色'), sw,
    colorList().length ? h('label', {}, '这张地图已有的色块') : null, colorList().length ? recent : null,
    h('label', {}, '在游戏里是什么（必选）'), kinds,
    h('div', { class: 'hint', style: 'margin-top:8px' }, '游戏只看“性质”，不看颜色。色块和别的地形之间没有自动过渡，边缘是方的。'));
  setTimeout(() => sync(), 0);
  return modal(title, body, [{ label: '取消', value: null }, { label: '确定', value: () => ({ ...st }), primary: true }], { wide: true });
}
