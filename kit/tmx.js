// RWKit · 无浏览器的 TMX 读取:只读地图的对象、属性、图层、图块属性,够质检用。写回只做"按属性改文本"。
const zlib = (typeof process !== 'undefined' && process.versions && process.versions.node) ? (await import('node:zlib')).default : null;   // 浏览器里为 null,先用 normalizeTmx 把图层转成 csv
export const FLIP = 0x1fffffff;
export const unesc = (s) => String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
const attrs = (s) => { const o = {}; for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = unesc(m[2]); return o; };
function parseProps(body) {
  const p = {};
  if (!body) return p;
  for (const m of body.matchAll(/<property\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/property>)/g)) {
    const a = attrs(m[1]); p[a.name] = a.value !== undefined ? a.value : unesc(m[2] || '');
  }
  return p;
}
function decodeLayer(dataTag, text, n) {
  const enc = dataTag.encoding, comp = dataTag.compression; let buf;
  if (enc === 'base64') { buf = Buffer.from(text.replace(/\s+/g, ''), 'base64'); if (!zlib && comp) throw new Error('浏览器里请先用 normalizeTmx() 解压图层'); if (comp === 'zlib') buf = zlib.inflateSync(buf); else if (comp === 'gzip') buf = zlib.gunzipSync(buf); else if (comp) throw new Error('不支持的压缩 ' + comp); }
  else if (enc === 'csv') { const a = text.split(',').map((v) => +v.trim()); return Uint32Array.from(a); }
  else throw new Error('不支持的图层编码 ' + enc);
  const out = new Uint32Array(n); for (let i = 0; i < n && i * 4 + 3 < buf.length; i++) out[i] = buf.readUInt32LE(i * 4); return out;
}
export function parseTmx(text) {
  const mh = text.match(/<map\s+([^>]*)>/); if (!mh) throw new Error('不是 TMX 文件(找不到 <map>)');
  const ma = attrs(mh[1]); const W = +ma.width, H = +ma.height;
  const model = { width: W, height: H, tw: +ma.tilewidth || 20, mapProps: {}, tilesets: [], layers: {}, groups: {}, objects: [], text };
  const mp = text.match(/<map[^>]*>\s*<properties>([\s\S]*?)<\/properties>/); if (mp) model.mapProps = parseProps(mp[1]);
  for (const m of text.matchAll(/<tileset\s+([^>]*?)(\/>|>([\s\S]*?)<\/tileset>)/g)) {
    const a = attrs(m[1]); const ts = { firstgid: +a.firstgid, name: a.name || '', tilecount: +a.tilecount || 0, source: a.source, tiles: new Map() };
    if (m[3]) for (const t of m[3].matchAll(/<tile\s+id="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/tile>)/g)) { const p = parseProps((t[2] || '').match(/<properties>([\s\S]*?)<\/properties>/)?.[1]); ts.tiles.set(+t[1], p); }
    model.tilesets.push(ts);
  }
  model.tilesets.sort((a, b) => a.firstgid - b.firstgid);
  for (const m of text.matchAll(/<layer\s+([^>]*)>\s*<data\s+([^>]*)>([\s\S]*?)<\/data>/g)) {
    const a = attrs(m[1]); model.layers[(a.name || '').toLowerCase()] = { name: a.name, data: decodeLayer(attrs(m[2]), m[3], W * H) };
  }
  let line = 0;
  for (const g of text.matchAll(/<objectgroup\s+([^>]*?)(\/>|>([\s\S]*?)<\/objectgroup>)/g)) {
    const ga = attrs(g[1]); const gname = ga.name || ''; model.groups[gname] = []; if (!g[3]) continue;
    for (const o of g[3].matchAll(/<object\s+([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g)) {
      const a = attrs(o[1]); const ob = { id: +a.id, name: a.name || '', type: a.type || a.class || '', x: +a.x || 0, y: +a.y || 0, w: +a.width || 0, h: +a.height || 0, group: gname, props: parseProps(o[3]), idx: line++ };
      model.objects.push(ob); model.groups[gname].push(ob);
    }
  }
  return model;
}
// 图块属性
export function tileProps(model, gid) {
  gid &= FLIP; if (!gid) return null;
  let ts = null; for (const t of model.tilesets) { if (t.firstgid <= gid) ts = t; else break; }
  if (!ts) return null; return ts.tiles.get(gid - ts.firstgid) || {};
}
export const isUnit = (o) => o.props.unit !== undefined;
export const TRIGGER_TYPES = new Set(['unitadd', 'unitdetect', 'unitremove', 'maptext', 'changecredits', 'teamtags', 'teamtagdetect', 'basic', 'objective', 'movecamera', 'move']);
export const triggersOf = (model) => model.objects.filter((o) => TRIGGER_TYPES.has((o.type || '').toLowerCase()));
export const unitsOf = (model) => model.objects.filter(isUnit);
export const trigKey = (o) => ((o.props.id || '').trim() || (o.name || '').trim() || 'NULL');
// 通行类别(与编辑器 pathing.js 一致)
export const LAND = 1, NAVAL = 2, HOVER = 4, BUILD = 8;
export function passability(model) {
  const { width: W, height: H } = model; const G = model.layers.ground, I = model.layers.items; const out = new Uint8Array(W * H);
  const cc = new Map(), ic = new Map();
  const cls = (gid) => {
    if (cc.has(gid)) return cc.get(gid); const p = tileProps(model, gid) || {}; let c = LAND | HOVER | BUILD;
    if ('water' in p) c = NAVAL | HOVER; if ('water-bridge' in p) c = LAND | NAVAL | HOVER; if ('lava' in p) c = 0;
    if ('large-cliff' in p || 'cliff-soft' in p || 'lava-cliff' in p || 'cliff' in p || 'block-land' in p) c &= ~(LAND | BUILD);
    if ('large-cliff' in p || 'lava-cliff' in p) c = 0; cc.set(gid, c); return c;
  };
  const msk = (gid) => {
    if (ic.has(gid)) return ic.get(gid); const p = tileProps(model, gid) || {}; let m = 0xff;
    if ('large-rock' in p) m = ~(LAND | HOVER | BUILD); else if (p.unit) m = ~(LAND | BUILD); else if ('res_pool' in p) m = ~BUILD; ic.set(gid, m); return m;
  };
  for (let i = 0; i < W * H; i++) { let c = G ? cls(G.data[i]) : (LAND | HOVER | BUILD); if (I && I.data[i]) c &= msk(I.data[i]); out[i] = c; }
  return out;
}
// 每格的地形种类名(用于"禁用地形""区域地形规则"):按图块属性给出语义类
export function terrainClasses(model) {
  const { width: W, height: H } = model; const G = model.layers.ground; const cls = new Map(); const out = new Uint8Array(W * H);
  const names = ['普通', '水', '浅滩', '岩浆', '悬崖', '大悬崖'];
  const of = (gid) => { if (cls.has(gid)) return cls.get(gid); const p = tileProps(model, gid) || {}; let c = 0;
    if ('water-bridge' in p) c = 2; else if ('water' in p) c = 1; else if ('lava' in p) c = 3; else if ('large-cliff' in p || 'lava-cliff' in p) c = 5; else if ('cliff' in p || 'cliff-soft' in p || 'block-land' in p) c = 4; cls.set(gid, c); return c; };
  if (G) for (let i = 0; i < W * H; i++) out[i] = of(G.data[i]);
  return { data: out, names };
}

// 浏览器用:把 base64+zlib/gzip 的图层异步解压并改写成 csv,再交给 parseTmx
export async function normalizeTmx(text) {
  const re = /(<data\s+)([^>]*encoding="base64"[^>]*)(>)([\s\S]*?)(<\/data>)/g; const parts = []; let last = 0, m;
  while ((m = re.exec(text))) {
    parts.push(text.slice(last, m.index)); last = m.index + m[0].length;
    const comp = (m[2].match(/compression="(\w+)"/) || [])[1]; let bytes = Uint8Array.from(atob(m[4].replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    if (comp) { const ds = new DecompressionStream(comp === 'gzip' ? 'gzip' : 'deflate'); bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer()); }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const a = []; for (let i = 0; i + 3 < bytes.length; i += 4) a.push(dv.getUint32(i, true));
    parts.push(`${m[1]}encoding="csv"${m[3]}${a.join(',')}${m[5]}`);
  }
  parts.push(text.slice(last)); return parts.join('');
}
