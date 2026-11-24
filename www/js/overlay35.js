// 3.5 新增的地图叠加层（都走原来的 rend.setTint,每格一个 RGBA）和"按队伍显示/隐藏单位"
//   k35-gap     海峡过窄（红）与达标（绿）的最窄处连线
//   k35-shallow 仅靠浅水连在一起的陆块接点（橙色圆）
//   k35-heat    兵力热力（每 10×10 格一块）
//   k35-zones   命名区域（来自工具箱「区域」）
//   k35-diff    与"变更与项目"里记录的基准相比，地形不同的格
import { A } from './state.js';
import { teamColor } from './render.js';
import { objProp } from './tmx.js';

const K = (f) => import('./kit/' + f);
const rgba = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const hexRgba = (css, a) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = css; const n = parseInt(c.fillStyle.slice(1), 16); return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a); };

export const KINDS35 = [['k35-gap', '海峡宽度（红=过窄）'], ['k35-shallow', '仅浅水连通处'], ['k35-heat', '兵力热力'], ['k35-zones', '命名区域'], ['k35-diff', '与基准的地形差异']];

async function snapModel() {
  const { rwApi } = await import('./api.js'); const { parseTmx, normalizeTmx } = await K('tmx.js');
  return parseTmx(await normalizeTmx(await rwApi.exportText('full')));
}
function line(set, W, H, a, b, col, thick = 1) {
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
  for (let i = 0; i <= n; i++) { const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n), y = Math.round(a[1] + ((b[1] - a[1]) * i) / n); for (let dy = 0; dy < thick; dy++) for (let dx = 0; dx < thick; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) set.set((y + dy) * W + x + dx, col); }
}
function disc(set, W, H, c, r, col, ring = false) { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const d = dx * dx + dy * dy; if (d > r * r || (ring && d < (r - 1.5) * (r - 1.5))) continue; const x = c[0] + dx, y = c[1] + dy; if (x >= 0 && y >= 0 && x < W && y < H) set.set(y * W + x, col); } }

export const zonesKey = () => 'rwkit35.zones.' + (A.mapName || '');
export function getZones() { try { return JSON.parse(localStorage.getItem(zonesKey()) || '[]'); } catch { return []; } }
export const BASE_DB = { name: 'rwkit35', store: 'base' };
export async function getBaseText() {
  try { const d = await new Promise((ok, no) => { const r = indexedDB.open(BASE_DB.name, 1); r.onupgradeneeded = () => r.result.createObjectStore(BASE_DB.store); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    return await new Promise((ok, no) => { const q = d.transaction(BASE_DB.store).objectStore(BASE_DB.store).get('base:' + (A.mapName || '')); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); } catch { return null; }
}

// 返回 {fn, note}:fn(i)->RGBA;note 是给用户看的一句话
export async function tintFor(kind, opt = {}) {
  const { parseTmx } = await K('tmx.js'); const m = await snapModel(), W = m.width, H = m.height, set = new Map();
  if (kind === 'k35-gap') {
    const G = await K('geo35.js'), r = G.gapReport(m, { minGap: opt.minGap || 12 }); let bad = 0;
    for (const p of r.pairs) { const col = p.tooNarrow ? rgba(240, 40, 50, 230) : rgba(60, 200, 90, 170); if (p.tooNarrow) bad++; line(set, W, H, p.from, p.to, col, p.tooNarrow ? 3 : 2); }
    return { fn: (i) => set.get(i) || 0, note: `相邻陆块 ${r.pairs.length} 对，其中 ${bad} 处最窄处不到 ${opt.minGap || 12} 格（红线）。线的长度 = 两块之间的最近距离。` };
  }
  if (kind === 'k35-shallow') {
    const G = await K('geo35.js'), ls = G.shallowOnlyLinks(m, { minArea: 100 });
    for (const l of ls) disc(set, W, H, l.at, 7, rgba(255, 150, 0, 210), true);
    return { fn: (i) => set.get(i) || 0, note: ls.length ? `${ls.length} 处两块陆地只靠浅水相连（陆军能走过去）。橙圈就是接点。` : '没有"只靠浅水连着"的陆块。' };
  }
  if (kind === 'k35-heat') {
    const U = await K('units35.js'), hm = U.heatGrid(m, { step: 10, team: opt.team ?? null });
    return { fn: (i) => { const x = i % W, y = (i / W) | 0, v = hm.g[Math.floor(y / 10) * hm.w + Math.floor(x / 10)]; if (!v) return 0; const t = Math.min(1, v / Math.max(1, hm.max)); return rgba(255, Math.round(220 - 190 * t), 30, Math.round(60 + 150 * t)); }, note: `每 10×10 格一块，最密一块 ${hm.max} 个单位（越红越密）。` };
  }
  if (kind === 'k35-zones') {
    const zs = getZones(); const pal = ['#4da3ff', '#ff7ab6', '#7bd88f', '#ffd166', '#b28dff', '#ff8c5a'];
    zs.forEach((z, k) => { const col = hexRgba(pal[k % pal.length], 90), edge = hexRgba(pal[k % pal.length], 230); for (let y = Math.max(0, z.box[1]); y < Math.min(H, z.box[3]); y++) for (let x = Math.max(0, z.box[0]); x < Math.min(W, z.box[2]); x++) set.set(y * W + x, x === z.box[0] || y === z.box[1] || x === z.box[2] - 1 || y === z.box[3] - 1 ? edge : col); });
    return { fn: (i) => set.get(i) || 0, note: zs.length ? `${zs.length} 个命名区域:${zs.map((z) => z.name).join('、')}` : '还没有命名区域（工具箱 → 区域与经纬度 → 画区域）。' };
  }
  if (kind === 'k35-diff') {
    const base = await getBaseText(); if (!base) throw new Error('还没有基准，先在工具箱「变更与项目」里点「记录当前为基准」');
    const b = parseTmx(base); if (b.width !== W || b.height !== H) throw new Error(`基准是 ${b.width}×${b.height},当前是 ${W}×${H},尺寸不同没法逐格比`);
    const a = m.layers.ground.data, c = b.layers.ground.data; let n = 0, d = new Uint8Array(W * H); for (let i = 0; i < d.length; i++) if (a[i] !== c[i]) { d[i] = 1; n++; }
    return { fn: (i) => (d[i] ? rgba(255, 160, 0, 190) : 0), note: n ? `和基准相比有 ${n} 格地形不同（橙色）。` : '地形和基准完全一致。' };
  }
  throw new Error('未知叠加层 ' + kind);
}

// ---- 按队伍显示/隐藏单位 ----
export function setHiddenTeams(set) { A.rend.hideTeams = set && set.size ? set : null; A.rend.request(); }
export const hiddenTeams = () => A.rend.hideTeams || new Set();
export function teamsInMap() { const out = new Map(); const m = A.ed.map; if (!m) return []; for (const G of m.groups) for (const o of G.objects) { if (objProp(o, 'unit') === undefined) continue; const t = objProp(o, 'team'); const v = t === undefined || t === '' ? NaN : +t; if (!Number.isInteger(v)) continue; out.set(v, (out.get(v) || 0) + 1); } return [...out].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ team: t, n, color: teamColor(t) })); }
