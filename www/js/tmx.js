// 铁锈战争 TMX 读写：只改动我们管理的部分，其余 XML 原样保留
import { b64ToBytes, bytesToB64, inflate, deflate } from './util.js';

export const FLIP_MASK = 0x1fffffff;

function propsOf(el) {
  const out = {};
  const ps = el.querySelector(':scope > properties');
  if (!ps) return out;
  for (const p of ps.querySelectorAll(':scope > property')) {
    const v = p.hasAttribute('value') ? p.getAttribute('value') : (p.textContent || '');
    out[p.getAttribute('name')] = v;
  }
  return out;
}

function propList(el) {
  const out = [];
  const ps = el.querySelector(':scope > properties');
  if (!ps) return out;
  for (const p of ps.querySelectorAll(':scope > property')) {
    const o = { name: p.getAttribute('name'), value: p.hasAttribute('value') ? p.getAttribute('value') : (p.textContent || '') };
    if (p.hasAttribute('type')) o.type = p.getAttribute('type');
    out.push(o);
  }
  return out;
}

export class Tileset {
  constructor(el) {
    this.el = el;
    this.firstgid = +el.getAttribute('firstgid');
    this.name = el.getAttribute('name') || '';
    this.source = el.getAttribute('source');
    this.tw = +(el.getAttribute('tilewidth') || 20);
    this.th = +(el.getAttribute('tileheight') || 20);
    this.columns = +(el.getAttribute('columns') || 0);
    this.tilecount = +(el.getAttribute('tilecount') || 0);
    const img = el.querySelector(':scope > image');
    this.imgW = img ? +img.getAttribute('width') : 0;
    this.imgH = img ? +img.getAttribute('height') : 0;
    this.imageSource = img ? img.getAttribute('source') : null;
    this.props = propsOf(el);
    this.embeddedPng = this.props.embedded_png ? this.props.embedded_png.replace(/\s+/g, '') : null;
    delete this.props.embedded_png;
    if (!this.columns && this.imgW) this.columns = Math.floor(this.imgW / this.tw);
    if (!this.tilecount && this.columns && this.imgH) this.tilecount = this.columns * Math.floor(this.imgH / this.th);
    this.terrainNames = [];
    this.terrainRep = [];
    for (const t of el.querySelectorAll(':scope > terraintypes > terrain')) {
      this.terrainNames.push(t.getAttribute('name'));
      this.terrainRep.push(+t.getAttribute('tile'));
    }
    this.tiles = new Map(); // id -> {terrain:number[4]|null, props:{}}
    for (const t of el.querySelectorAll(':scope > tile')) {
      const id = +t.getAttribute('id');
      const tr = t.getAttribute('terrain');
      let terrain = null;
      if (tr) {
        const parts = tr.split(',').map((s) => (s === '' ? -1 : +s));
        if (parts.length === 4) terrain = parts;
      }
      this.tiles.set(id, { terrain, props: propsOf(t) });
    }
    this.image = null; // ImageBitmap，异步加载
    this.layerTag = (this.props.layer || '').toLowerCase();
  }
  get lastgid() { return this.firstgid + Math.max(this.tilecount, 1) - 1; }
  async loadImage() {
    if (!this.embeddedPng) return null;
    try {
      const blob = new Blob([b64ToBytes(this.embeddedPng)], { type: 'image/png' });
      this.image = await createImageBitmap(blob);
      if (!this.imgW) { this.imgW = this.image.width; this.imgH = this.image.height; }
      if (!this.columns) this.columns = Math.floor(this.imgW / this.tw);
      if (!this.tilecount) this.tilecount = this.columns * Math.floor(this.imgH / this.th);
    } catch (e) {
      console.warn('图块集图片加载失败', this.name, e);
      this.image = null;
    }
    return this.image;
  }
}

export class TileLayer {
  constructor(el, w, h) {
    this.el = el;
    this.name = el.getAttribute('name') || '';
    this.w = +(el.getAttribute('width') || w);
    this.h = +(el.getAttribute('height') || h);
    this.visible = el.getAttribute('visible') !== '0';
    this.data = null; // Uint16Array 或 Uint32Array（去掉翻转位的 gid）
    this.flips = new Map(); // 下标 -> 翻转位(0..7)
    this.encoding = 'base64';
    this.compression = 'zlib';
    this.dirty = false;
  }
  get(i) { return this.data[i]; }
  rawAt(i) { const f = this.flips.get(i); return f ? ((this.data[i] | (f << 29)) >>> 0) : this.data[i]; }
}

export class ObjectGroup {
  constructor(el) {
    this.el = el;
    this.name = el.getAttribute('name') || '';
    this.visible = el.getAttribute('visible') !== '0';
    this.objects = [];
    for (const o of el.querySelectorAll(':scope > object')) {
      const attrs = {};
      for (const a of o.attributes) attrs[a.name] = a.value;
      const extra = [];
      for (const c of o.children) if (c.tagName !== 'properties') extra.push(c.cloneNode(true));
      this.objects.push({ attrs, props: propList(o), extra });
    }
  }
}

export function objProp(o, name) {
  const p = o.props.find((q) => q.name === name);
  return p ? p.value : undefined;
}
export function setObjProp(o, name, value) {
  const p = o.props.find((q) => q.name === name);
  if (value === undefined || value === null) {
    if (p) o.props.splice(o.props.indexOf(p), 1);
  } else if (p) p.value = String(value);
  else o.props.push({ name, value: String(value) });
}

async function decodeLayer(layer, dataEl, w, h) {
  const n = w * h;
  const enc = (dataEl && dataEl.getAttribute('encoding')) || '';
  const comp = (dataEl && dataEl.getAttribute('compression')) || '';
  layer.encoding = enc || 'xml';
  layer.compression = comp || 'none';
  let raw = null;
  if (!dataEl) {
    raw = new Uint32Array(n);
  } else if (enc === 'base64') {
    const txt = (dataEl.textContent || '').trim();
    if (!txt) raw = new Uint32Array(n);
    else {
      let bytes = b64ToBytes(txt);
      if (comp === 'zlib' || comp === 'gzip') bytes = await inflate(bytes, comp);
      else if (comp && comp !== 'none') throw new Error('不支持的压缩格式：' + comp);
      if (bytes.length < n * 4) throw new Error(`图层「${layer.name}」数据长度不对（${bytes.length} 字节，应为 ${n * 4}）`);
      raw = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + n * 4));
    }
  } else if (enc === 'csv') {
    raw = new Uint32Array(n);
    const parts = (dataEl.textContent || '').split(',');
    for (let i = 0; i < n && i < parts.length; i++) raw[i] = +parts[i].trim() >>> 0;
  } else {
    raw = new Uint32Array(n);
    let i = 0;
    for (const t of dataEl.querySelectorAll(':scope > tile')) { raw[i++] = (+(t.getAttribute('gid') || 0)) >>> 0; if (i >= n) break; }
  }
  let maxGid = 0;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (v > FLIP_MASK) { layer.flips.set(i, v >>> 29); }
    const g = v & FLIP_MASK;
    if (g > maxGid) maxGid = g;
  }
  const data = maxGid < 65536 ? new Uint16Array(n) : new Uint32Array(n);
  for (let i = 0; i < n; i++) data[i] = raw[i] & FLIP_MASK;
  layer.data = data;
  if (layer.encoding !== 'base64' || layer.compression === 'none') {
    // 统一用 zlib 保存（与游戏导出的地图一致）
    layer.encoding = 'base64'; layer.compression = 'zlib'; layer.dirty = true;
  }
}

export class RWMap {
  static async parse(text, fileName = '') {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('不是有效的 XML / TMX 文件：' + err.textContent.slice(0, 200));
    const root = doc.documentElement;
    if (root.tagName !== 'map') throw new Error('不是 TMX 地图文件（根节点不是 <map>）');
    const m = new RWMap();
    m.doc = doc;
    m.root = root;
    m.fileName = fileName;
    m.width = +root.getAttribute('width');
    m.height = +root.getAttribute('height');
    m.tw = +root.getAttribute('tilewidth');
    m.th = +root.getAttribute('tileheight');
    if (root.getAttribute('infinite') === '1') throw new Error('不支持无限地图（infinite=1）');
    m.tilesets = [...root.querySelectorAll(':scope > tileset')].map((el) => new Tileset(el));
    m.tilesets.sort((a, b) => a.firstgid - b.firstgid);
    m.layers = [];
    m.groups = [];
    m.order = []; // 按文件中的顺序：{kind:'layer'|'group', ref}
    for (const el of root.children) {
      if (el.tagName === 'layer') {
        const L = new TileLayer(el, m.width, m.height);
        if (L.w !== m.width || L.h !== m.height) throw new Error(`图层「${L.name}」尺寸与地图不一致`);
        await decodeLayer(L, el.querySelector(':scope > data'), L.w, L.h);
        m.layers.push(L); m.order.push({ kind: 'layer', ref: L });
      } else if (el.tagName === 'objectgroup') {
        const G = new ObjectGroup(el);
        m.groups.push(G); m.order.push({ kind: 'group', ref: G });
      }
    }
    await Promise.all(m.tilesets.map((t) => t.loadImage()));
    m.buildGidIndex();
    return m;
  }

  buildGidIndex() {
    // 图块数未知（外部 tsx、图片没加载）时，用下一个图块集的起始编号推算范围
    this.tilesets.forEach((t, i) => {
      if (!t.tilecount) {
        const next = this.tilesets[i + 1];
        t.tilecount = next ? Math.max(1, next.firstgid - t.firstgid) : 1;
        t.countGuessed = true;
      }
    });
    let max = 0;
    for (const t of this.tilesets) max = Math.max(max, t.lastgid);
    this.maxGid = max;
    this.tsOf = new Uint16Array(max + 2); // gid -> 下标+1
    this.tilesets.forEach((t, i) => {
      for (let g = t.firstgid; g <= t.lastgid; g++) this.tsOf[g] = i + 1;
    });
  }
  tilesetOf(gid) {
    if (gid <= 0 || gid > this.maxGid) return null;
    const k = this.tsOf[gid];
    return k ? this.tilesets[k - 1] : null;
  }
  tileInfo(gid) {
    const ts = this.tilesetOf(gid);
    if (!ts) return null;
    return ts.tiles.get(gid - ts.firstgid) || null;
  }
  layer(name) {
    const n = name.toLowerCase();
    return this.layers.find((l) => l.name.toLowerCase() === n) || null;
  }
  group(name) {
    const n = name.toLowerCase();
    return this.groups.find((g) => g.name.toLowerCase() === n) || null;
  }
  get ground() { return this.layer('ground') || this.layers[0] || null; }
  get items() { return this.layer('items'); }
  mapProps() { return propsOf(this.root); }

  widenLayer(L) {
    if (L.data instanceof Uint32Array) return;
    const d = new Uint32Array(L.data.length); d.set(L.data); L.data = d;
  }

  ensureGroup(name) {
    let g = this.group(name);
    if (g) return g;
    const el = this.doc.createElement('objectgroup');
    el.setAttribute('name', name);
    this.root.appendChild(el);
    g = new ObjectGroup(el);
    this.groups.push(g); this.order.push({ kind: 'group', ref: g });
    return g;
  }
  ensureLayer(name) {
    let L = this.layer(name);
    if (L) return L;
    const el = this.doc.createElement('layer');
    el.setAttribute('name', name);
    el.setAttribute('width', this.width);
    el.setAttribute('height', this.height);
    // 放在第一个对象组之前
    const firstGroup = this.root.querySelector(':scope > objectgroup');
    this.root.insertBefore(el, firstGroup);
    L = new TileLayer(el, this.width, this.height);
    L.data = new Uint16Array(this.width * this.height);
    L.dirty = true;
    this.layers.push(L);
    this.order.push({ kind: 'layer', ref: L });
    return L;
  }

  // ---- 写出 ----
  // 生成 TMX 文本。所有数据先同步拍下快照，压缩期间继续编辑也不会写出半新半旧的内容。
  // opts.prune：去掉地图里没用到的图块集（地面/物品/单位三个核心图块集始终保留）
  async serialize(opts = {}) {
    const doc = this.doc;
    const root = this.root;
    const W = this.width, H = this.height;
    const jobs = [];
    for (const L of this.layers) {
      if (!L.dirty) continue;
      const raw = new Uint32Array(W * H);
      raw.set(L.data);
      for (const [i, f] of L.flips) raw[i] = (raw[i] | (f << 29)) >>> 0;
      jobs.push({ L, raw, ver: L.ver || 0 });
    }
    const objSnap = this.groups.map((G) => ({ G, objects: G.objects.map((o) => ({ attrs: { ...o.attrs }, props: o.props.map((p) => ({ ...p })), extra: o.extra })) }));
    const encoded = [];
    for (const j of jobs) {
      const comp = j.L.compression === 'gzip' ? 'gzip' : 'zlib';
      encoded.push({ ...j, comp, b64: bytesToB64(await deflate(new Uint8Array(j.raw.buffer), comp)) });
    }
    // 以下全部同步完成
    root.setAttribute('width', W);
    root.setAttribute('height', H);
    for (const L of this.layers) { L.el.setAttribute('width', W); L.el.setAttribute('height', H); }
    for (const e of encoded) {
      const L = e.L;
      let dataEl = L.el.querySelector(':scope > data');
      if (!dataEl) { dataEl = doc.createElement('data'); L.el.appendChild(dataEl); }
      while (dataEl.firstChild) dataEl.removeChild(dataEl.firstChild);
      dataEl.setAttribute('encoding', 'base64');
      dataEl.setAttribute('compression', e.comp);
      dataEl.appendChild(doc.createTextNode('\n' + e.b64 + '\n'));
      if ((L.ver || 0) === e.ver) L.dirty = false; // 压缩期间又改过的图层，下次还要重新写
    }
    let maxId = 0;
    for (const { G, objects } of objSnap) {
      for (const o of [...G.el.querySelectorAll(':scope > object')]) G.el.removeChild(o);
      for (const o of objects) {
        const el = doc.createElement('object');
        for (const [k, v] of Object.entries(o.attrs)) if (v !== undefined && v !== null && !k.startsWith('data-rw-')) el.setAttribute(k, v);
        if (o.attrs.id) maxId = Math.max(maxId, +o.attrs.id);
        if (o.props.length) {
          const ps = doc.createElement('properties');
          for (const p of o.props) {
            const pe = doc.createElement('property');
            pe.setAttribute('name', p.name);
            if (p.type) pe.setAttribute('type', p.type);
            // 多行文字（如 survivalWaves）按 Tiled 的写法放在元素内容里
            if (String(p.value).includes('\n')) pe.appendChild(doc.createTextNode(String(p.value)));
            else pe.setAttribute('value', p.value);
            ps.appendChild(pe);
          }
          el.appendChild(ps);
        }
        for (const c of o.extra) el.appendChild(c.cloneNode(true));
        G.el.appendChild(el);
      }
    }
    if (root.hasAttribute('nextobjectid')) {
      const cur = +root.getAttribute('nextobjectid');
      if (maxId + 1 > cur) root.setAttribute('nextobjectid', maxId + 1);
    }
    // 游戏不接受 XML 注释
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    for (const c of comments) c.parentNode.removeChild(c);
    let pruned = [];
    if (opts.prune) {
      const used = this.usedTilesets();
      for (const ts of this.tilesets) {
        if (used.has(ts) || ['ground', 'items', 'units'].includes(ts.layerTag) || /^export_(ground|items|units)$/.test(ts.name)) continue;
        if (opts.prune === 'pictures' && !ts.editorPicture) continue;
        if (ts.el.parentNode) { ts.el.parentNode.removeChild(ts.el); pruned.push(ts); }
      }
    }
    let out = new XMLSerializer().serializeToString(doc);
    for (const ts of pruned) root.insertBefore(ts.el, root.querySelector(':scope > layer, :scope > objectgroup'));
    if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
    return out;
  }

  // 整张地图的状态快照（改尺寸、等比缩放这类整体操作的撤销用）
  snapshotState() {
    return {
      width: this.width, height: this.height,
      layers: this.layers.map((L) => ({ L, data: L.data.slice(), flips: new Map(L.flips) })),
      groups: this.groups.map((G) => ({ G, objects: G.objects.map((o) => ({ attrs: { ...o.attrs }, props: o.props.map((p) => ({ ...p })), extra: o.extra })) })),
    };
  }
  restoreState(s) {
    this.width = s.width; this.height = s.height;
    for (const e of s.layers) { e.L.data = e.data.slice(); e.L.flips = new Map(e.flips); e.L.w = s.width; e.L.h = s.height; e.L.dirty = true; e.L.ver = (e.L.ver || 0) + 1; }
    for (const e of s.groups) e.G.objects = e.objects.map((o) => ({ attrs: { ...o.attrs }, props: o.props.map((p) => ({ ...p })), extra: o.extra }));
  }

  usedTilesets() {
    const used = new Set();
    for (const L of this.layers) {
      const seen = new Uint8Array(this.tilesets.length + 1);
      const d = L.data;
      for (let i = 0; i < d.length; i++) { const g = d[i]; if (g && g <= this.maxGid) seen[this.tsOf[g]] = 1; }
      seen.forEach((v, k) => { if (v && k) used.add(this.tilesets[k - 1]); });
    }
    for (const G of this.groups) for (const o of G.objects) if (o.attrs.gid) { const t = this.tilesetOf(+o.attrs.gid & FLIP_MASK); if (t) used.add(t); }
    return used;
  }

  // 修改图块集里某个图块的属性（例如给水面补 water），会写回 XML
  setTileProp(ts, id, name, value) {
    const doc = this.doc;
    let te = [...ts.el.querySelectorAll(':scope > tile')].find((t) => +t.getAttribute('id') === id);
    if (!te) {
      te = doc.createElement('tile'); te.setAttribute('id', id);
      const after = [...ts.el.querySelectorAll(':scope > tile')].find((t) => +t.getAttribute('id') > id);
      ts.el.insertBefore(te, after || null);
    }
    let ps = te.querySelector(':scope > properties');
    if (!ps) { ps = doc.createElement('properties'); te.insertBefore(ps, te.firstChild); }
    let p = [...ps.querySelectorAll(':scope > property')].find((q) => q.getAttribute('name') === name);
    if (value === null) { if (p) ps.removeChild(p); }
    else { if (!p) { p = doc.createElement('property'); p.setAttribute('name', name); ps.appendChild(p); } p.setAttribute('value', value); }
    const info = ts.tiles.get(id) || { terrain: null, props: {} };
    if (value === null) delete info.props[name]; else info.props[name] = value;
    ts.tiles.set(id, info);
  }

  // 改画布大小（ox, oy 为旧地图在新画布中的偏移）
  resize(nw, nh, ox = 0, oy = 0, fillGid = 0) {
    for (const L of this.layers) {
      const old = L.data;
      const data = (old instanceof Uint32Array) ? new Uint32Array(nw * nh) : new Uint16Array(nw * nh);
      const isGround = L === this.ground;
      if (isGround && fillGid) data.fill(fillGid);
      const flips = new Map();
      for (let y = 0; y < this.height; y++) {
        const ny = y + oy; if (ny < 0 || ny >= nh) continue;
        for (let x = 0; x < this.width; x++) {
          const nx = x + ox; if (nx < 0 || nx >= nw) continue;
          const oi = y * this.width + x, ni = ny * nw + nx;
          data[ni] = old[oi];
          const f = L.flips.get(oi); if (f) flips.set(ni, f);
        }
      }
      L.data = data; L.flips = flips; L.w = nw; L.h = nh; L.dirty = true;
    }
    const dx = ox * this.tw, dy = oy * this.th;
    for (const G of this.groups) for (const o of G.objects) {
      if (o.attrs.x !== undefined) o.attrs.x = String(+o.attrs.x + dx);
      if (o.attrs.y !== undefined) o.attrs.y = String(+o.attrs.y + dy);
    }
    this.width = nw; this.height = nh;
  }
}

// 用模板图块集新建地图
export async function newMapFromTemplate(tplTilesetsXml, w, h, opts = {}) {
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.2" orientation="orthogonal" renderorder="right-down" width="${w}" height="${h}" tilewidth="20" tileheight="20" nextobjectid="1">
${tplTilesetsXml}
  <layer name="Ground" width="${w}" height="${h}">
    <data encoding="base64" compression="zlib"></data>
  </layer>
  <layer name="Items" width="${w}" height="${h}">
    <data encoding="base64" compression="zlib"></data>
  </layer>
  <objectgroup name="UnitObjects"/>
  <objectgroup name="Triggers"/>
</map>`;
  const m = await RWMap.parse(text, opts.name || '');
  for (const L of m.layers) L.dirty = true;
  const trig = m.group('Triggers');
  trig.objects.push({
    attrs: { name: 'map_info', x: '0', y: '0', width: '20', height: '20' },
    props: [{ name: 'type', value: 'skirmish' }],
    extra: [],
  });
  return m;
}

// 从地图中取出可做模板的图块集 XML（地面/物品/单位，必须内嵌图片）
export function extractTemplate(map) {
  const keep = map.tilesets.filter((t) => t.embeddedPng && !t.source &&
    (['ground', 'items', 'units'].includes(t.layerTag) || /^export_(ground|items|units)$/.test(t.name)));
  const hasGround = keep.some((t) => t.layerTag === 'ground' || t.name === 'export_ground');
  if (!hasGround) return null;
  const ser = new XMLSerializer();
  return {
    xml: keep.map((t) => '  ' + ser.serializeToString(t.el).replace(/ xmlns="[^"]*"/g, '')).join('\n'),
    names: keep.map((t) => t.name),
  };
}
