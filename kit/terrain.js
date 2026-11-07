// RWKit · 地形分析与导出:山口扫描、水域连通域、通行性/地形图 PNG、截取测试图、性能估算
import zlib from 'node:zlib';
import { passability, terrainClasses, LAND, NAVAL, HOVER, BUILD, triggersOf, parseTmx, trigKey, TRIGGER_TYPES } from './tmx.js';
import { mapTriggers } from './refactor.js';
// 沿线段扫描:列出连续的"可通行"区段(山口宽度)与"阻断"区段。验证山脉岩墙的山口是否够宽、是否漏洞
export function scanLine(model, [x0, y0], [x1, y1], flag = LAND) { const P = passability(model); const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); const runs = []; let cur = null; for (let i = 0; i <= n; i++) { const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n); const ok = x >= 0 && y >= 0 && x < model.width && y < model.height && !!(P[y * model.width + x] & flag); if (!cur || cur.ok !== ok) { cur = { ok, from: [x, y], len: 0 }; runs.push(cur); } cur.len++; cur.to = [x, y]; } return runs; }
export function passesAlong(model, a, b, flag = LAND) { return scanLine(model, a, b, flag).filter((r) => r.ok); }
// 水域连通域(浅滩/深水都算 NAVAL):返回每块面积与外接框;用于判断海峡、湖、内河是否与大海相通
export function waterComponents(model, minArea = 10) { const P = passability(model); const { width: W, height: H } = model; const lab = new Int32Array(W * H).fill(-1); const comps = []; for (let i = 0; i < W * H; i++) if (lab[i] < 0 && (P[i] & NAVAL)) { const q = [i]; lab[i] = comps.length; let x0 = W, y0 = H, x1 = 0, y1 = 0; for (let h = 0; h < q.length; h++) { const k = q[h], x = k % W, y = (k / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (lab[j] < 0 && (P[j] & NAVAL)) { lab[j] = lab[i]; q.push(j); } } } comps.push({ id: comps.length, area: q.length, bbox: [x0, y0, x1, y1] }); } return { comps: comps.filter((c) => c.area >= minArea).sort((a, b) => b.area - a.area), lab }; }
// —— PNG(无依赖) ——
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgb) { const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); } const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; }; const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
// mode: 'pass' 通行性(陆海气垫建造着色) | 'terrain' 语义地形(水/浅滩/岩浆/悬崖);scale 每格像素(大图自动缩小为 1 像素/格 再按 step 抽样)
export function renderPng(model, { mode = 'pass', step = 1, marks = [] } = {}) {
  const { width: W, height: H } = model; const P = passability(model); const T = terrainClasses(model).data; const w = Math.ceil(W / step), h = Math.ceil(H / step); const rgb = Buffer.alloc(w * h * 3);
  const col = (i) => { if (mode === 'terrain') return [[110, 150, 90], [40, 90, 170], [110, 170, 210], [220, 60, 40], [120, 100, 80], [60, 50, 45]][T[i]]; const p = P[i]; if (p === 0) return [30, 30, 30]; if (p & NAVAL && !(p & LAND)) return [50, 100, 190]; if ((p & LAND) && (p & NAVAL)) return [120, 190, 210]; if (p & BUILD) return [120, 160, 100]; return [190, 180, 120]; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = col(Math.min(H - 1, y * step) * W + Math.min(W - 1, x * step)); rgb.set(c, (y * w + x) * 3); }
  for (const [mx, my, c = [255, 255, 0]] of marks) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = Math.floor(mx / step) + dx, y = Math.floor(my / step) + dy; if (x >= 0 && y >= 0 && x < w && y < h) rgb.set(c, (y * w + x) * 3); }
  return png(w, h, rgb);
}
// 截取测试图:把大图切出 [x0,y0,x1,y1] 窗口(格),对象坐标平移,窗口外的对象丢弃;图层改写成 csv(Tiled 都能读)
export function cropTmx(text, model, [x0, y0, x1, y1]) {
  const W = x1 - x0, H = y1 - y0, tw = model.tw; let out = text.replace(/(<map\s[^>]*?)width="\d+"([^>]*?)height="\d+"/, `$1width="${W}"$2height="${H}"`);
  out = out.replace(/(<layer\s+[^>]*?name="([^"]*)"[^>]*?)width="\d+"([^>]*?)height="\d+"([^>]*>\s*)<data\s+[^>]*>[\s\S]*?<\/data>/g, (all, a, nm, b, c) => { const L = model.layers[nm.toLowerCase()]; if (!L) return all; const rows = []; for (let y = y0; y < y1; y++) { const r = []; for (let x = x0; x < x1; x++) r.push(L.data[y * model.width + x]); rows.push(r.join(',')); } return `${a}width="${W}"${b}height="${H}"${c}<data encoding="csv">\n${rows.join(',\n')}\n</data>`; });
  // 对象:地图内的(x,y>=0)按窗口平移,中心在窗口外的丢弃(单位和触发器同规则);放在地图外的辅助触发器(x<0,消息/奖励等)原样保留
  out = out.replace(/<object\s+([^>]*?)(\/>|>[\s\S]*?<\/object>)/g, (all, as) => { const g = (k) => { const m = as.match(new RegExp(`\\b${k}="(-?[\\d.]+)"`)); return m ? +m[1] : NaN; }; const x = g('x'), y = g('y'), w = g('width') || 0, h = g('height') || 0; if (isNaN(x) || isNaN(y) || x < 0 || y < 0) return all; const cx = x + w / 2, cy = y + h / 2; if (cx < x0 * tw || cx >= x1 * tw || cy < y0 * tw || cy >= y1 * tw) return ''; return all.replace(/\bx="(-?[\d.]+)"/, `x="${x - x0 * tw}"`).replace(/\by="(-?[\d.]+)"/, `y="${y - y0 * tw}"`); });
  return pruneDangling(out);
}
// 截取后清理悬空引用:来源全部丢失的辅助触发器整个删掉(反复直到稳定),其余引用列表里去掉丢失的名字
function pruneDangling(text) {
  for (let round = 0; round < 20; round++) {
    const m = parseTmx(text); const have = new Set(); for (const o of m.objects) if (TRIGGER_TYPES.has(o.type.toLowerCase())) have.add(trigKey(o)); const drop = new Set();
    for (const o of m.objects) if (TRIGGER_TYPES.has(o.type.toLowerCase())) { const ab = (o.props.activatedBy || '').split(',').map((x) => x.trim()).filter(Boolean); if (ab.length && ab.every((k) => !have.has(k))) drop.add(o.id); }
    if (!drop.size) break; text = text.replace(/<object\s+([^>]*?)(\/>|>[\s\S]*?<\/object>)/g, (all, as) => { const id = +(as.match(/\bid="(\d+)"/) || [])[1]; return drop.has(id) ? '' : all; });
  }
  const have = new Set(); for (const o of parseTmx(text).objects) if (TRIGGER_TYPES.has(o.type.toLowerCase())) have.add(trigKey(o));
  return mapTriggers(text, (a, p) => { let ch = false; const np = { ...p }; for (const k of ['activatedBy', 'deactivatedBy', 'alsoActivate', 'whenActivatedIds', 'activateIds']) if (np[k]) { const l = np[k].split(',').map((x) => x.trim()).filter(Boolean); const f = l.filter((x) => have.has(x)); if (f.length !== l.length) { ch = true; if (f.length) np[k] = f.join(','); else delete np[k]; } } return ch ? { props: np } : null; }).text;
}
// 性能估算(粗):每 250ms 需要扫描的检测区面积/个数。不是游戏实测,只用于相对比较
export function perfEstimate(model) { const trs = triggersOf(model); const det = trs.filter((o) => o.type.toLowerCase() === 'unitdetect'); const cells = det.reduce((s, o) => s + (o.w * o.h) / (model.tw * model.tw), 0); const full = det.filter((o) => o.w * o.h >= 0.25 * model.width * model.height * model.tw * model.tw).length; return { triggers: trs.length, detectors: det.length, fullMapDetectors: full, scannedCellsPerTick: Math.round(cells), mapCells: model.width * model.height, note: '相对指标,未用真实游戏数据标定' }; }
