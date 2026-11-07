// RWKit · 项目硬规则(JSON)。规则文件写一次,每次交付前自动检查。
// 例:{ "teams":21, "forbidClasses":["lava"], "forbidGids":[], "regions":[{"name":"墨西哥","box":[x0,y0,x1,y1],"forbidClasses":["cliff","lava"]}], "factions":[{"team":3,"box":[...]}] , "mapSize":[1090,670], "noUnits":["seaFactory"] }
import { terrainClasses } from './tmx.js';
import { checkTeams } from './teams.js';
import { sizeGuard } from './sizeguard.js';
const CLS = { 普通: 0, normal: 0, water: 1, 水: 1, shallow: 2, 浅滩: 2, lava: 3, 岩浆: 3, cliff: 4, 悬崖: 4, bigcliff: 5, 大悬崖: 5 };
export function checkRules(model, R) {
  const out = []; const { width: W, height: H } = model; const tc = terrainClasses(model).data; const G = model.layers.ground;
  out.push(...sizeGuard(model, R.mapSize && { w: R.mapSize[0], h: R.mapSize[1] }));
  out.push(...checkTeams(model, { expect: R.teams }));
  const count = (box, cls, gids) => { let n = 0; const [x0, y0, x1, y1] = box || [0, 0, W, H]; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; if (cls.has(tc[i]) || (G && gids.has(G.data[i] & 0x1fffffff))) n++; } return n; };
  const mk = (a) => new Set((a || []).map((c) => CLS[c] ?? c));
  const g = count(null, mk(R.forbidClasses), new Set(R.forbidGids || [])); if (g) out.push({ sev: 'error', code: 'R01', msg: `全图存在被禁止的地形 ${g} 格(${(R.forbidClasses || []).join('/')})` });
  for (const r of R.regions || []) { const n = count(r.box, mk(r.forbidClasses), new Set(r.forbidGids || [])); if (n) out.push({ sev: 'error', code: 'R02', msg: `区域「${r.name}」含禁用地形 ${n} 格(${(r.forbidClasses || []).join('/')})` }); }
  for (const f of R.factions || []) { const [x0, y0, x1, y1] = f.box; const cs = model.objects.filter((o) => o.props.unit === 'commandCenter' && +o.props.team === f.team); const bad = cs.filter((o) => { const cx = o.x / model.tw, cy = o.y / model.tw; return !(cx >= x0 && cx < x1 && cy >= y0 && cy < y1); }); if (!cs.length) out.push({ sev: 'error', code: 'R03', msg: `${f.team} 号队没有指挥中心` }); else if (f.mustAllInside && bad.length) out.push({ sev: 'error', code: 'R03', msg: `${f.team} 号队有 ${bad.length} 个指挥中心在规定位置框外` }); }
  for (const u of R.noUnits || []) { const n = model.objects.filter((o) => o.props.unit === u).length; if (n) out.push({ sev: 'error', code: 'R04', msg: `地图中不应出现单位 ${u}(现有 ${n} 个)` }); }
  return out;
}
