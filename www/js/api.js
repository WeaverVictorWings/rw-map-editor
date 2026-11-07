// 稳定的脚本接口（3.3）：window.rwApi。自动化脚本只依赖这里，不再去翻 window.__rw.A.ed 之类的内部对象。
// 所有函数在没载入地图时抛出明确的错误（不会静默无事发生）。文档见 docs/API.md。
import { A } from './state.js';
import * as IO from './io.js';
import { runChecks } from './check.js';
import { triggerIssues } from './triggers.js';
import * as G from './geo.js';
import * as C from './capture.js';
import * as X from './checks2.js';
import { passability } from './pathing.js';
import { hslToHex } from './triggers.js';

const need = () => { if (!A.ed.map) throw new Error('rwApi：还没有载入地图，请先 loadText(tmxText)'); return A.ed; };
export const rwApi = {
  version: '3.4.0',
  loadText: async (text, name = 'map.tmx') => { await IO.loadMapFromText(text, name); need(); return { width: A.ed.map.width, height: A.ed.map.height }; },
  exportText: async (kind = 'full', opts = {}) => { need(); const t = await C.exportVariant(kind, opts); return typeof t === 'string' ? t.replace(/value="(hsl\([^"]*\))"/g, (m, c) => `value="${hslToHex(c)}"`) : t; },
  check: () => runChecks(need(), { triggerIssues: triggerIssues() }),
  components: () => { const c = X.components(need()); return { land: c.land.map(({ id, area, cx, cy, x0, y0, x1, y1, spawns }) => ({ id, area, cx, cy, bbox: [x0, y0, x1, y1], spawns })), water: c.water.filter((w) => w.area >= 10).map(({ id, area, cx, cy }) => ({ id, area, cx, cy })), mainLandId: c.mainLand && c.mainLand.id, oceanId: c.ocean && c.ocean.id }; },
  calibrate: (pts) => { need(); const cal = G.fitCalibration(pts); G.saveCal(cal, pts); return { rmse: cal.rmse, deg: cal.deg }; },
  ll2tile: (lon, lat) => { need(); return G.ll2tile(G.getCal(), lon, lat); },
  tile2ll: (x, y) => { need(); return G.tile2ll(G.getCal(), x, y); },
  paintIsland: (opt) => { need(); return G.paintIsland(opt); },
  parsePolygons: G.parsePolygons,
  placeCities: (csv, opt) => { need(); return G.placeCities(csv, opt); },
  measureAt: (x, y) => { need(); return G.measureAt(x, y); },
  strait: (x1, y1, x2, y2) => { need(); return G.strait(x1, y1, x2, y2); },
  removeFragments: (n) => { need(); return G.removeFragments(n); },
  edgeWall: (...a) => { need(); return G.edgeWall(...a); },
  blendBand: (...a) => { need(); return G.blendBand(...a); },
  isolateAt: (...a) => { need(); return G.isolateAt(...a); },
  rules: { get: () => X.getRules(need()), set: (r) => X.setRules(need(), r), check: () => { const ed = need(); const pass = passability(ed); return X.checkRules(ed, pass, X.components(ed, pass)); } },
  markAsCities: (d) => { need(); return C.markAsCities(d); },
  generateCapture: (o) => { need(); return C.generateCapture(o); },
  removeCapture: () => { need(); return C.removeCapture(); },
  passTable: () => { need(); return X.passTable(); },
  loadEstimate: () => X.loadEstimate(need()),
  resolveTerrain: async (t) => { need(); return (await import('./tools331.js')).resolveTerrain(t); },
  coastSmooth: async (r, o) => { need(); return (await import('./tools331.js')).coastSmooth(r, o); },
  replaceKeep: async (f, t, o) => { need(); return (await import('./tools331.js')).replaceKeep(f, t, o); },
  importTerrain: async (text, o) => { need(); return (await import('./tools331.js')).importTerrain(text, o); },
  widthHint: async (x, y) => { need(); return (await import('./tools331.js')).widthHint(x, y); },
  addCityPools: async (n, o) => { need(); return (await import('./tools331.js')).addCityPools(n, o); },
  shotRegions: async (o) => { need(); return (await import('./tools331.js')).shotRegions(o); },
};
window.rwApi = rwApi;
window.rwApiReady = true;
