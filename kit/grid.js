// RWKit · 格子级检查:单位站位/海军工厂/舰船、陆路连通、海路(海峡)连通、孤岛
import { passability, unitsOf, LAND, NAVAL, BUILD, HOVER } from './tmx.js';
export const NAVAL_FACTORY = /^(sea|naval)Factory|seaFactory/i;
export const SHIP = /^(battleship|heavyBattleship|destroyer|cruiser|gunboat|missileShip|builderShip|submarine|subMarine|amphibiousBoat|sonarShip|carrier)/i;
const cellOf = (m, o) => [Math.floor((o.x + 10) / m.tw), Math.floor((o.y + 10) / m.tw)];
export function checkPlacement(model, { navalRadius = 2 } = {}) {
  const out = []; const P = passability(model); const { width: W, height: H } = model; const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : P[y * W + x]);
  for (const u of unitsOf(model)) {
    const n = u.props.unit; const [cx, cy] = cellOf(model, u); const c = at(cx, cy);
    if (NAVAL_FACTORY.test(n)) { let w = 0, t = 0; for (let dy = -navalRadius; dy <= navalRadius; dy++) for (let dx = -navalRadius; dx <= navalRadius; dx++) { t++; if (at(cx + dx, cy + dy) & NAVAL) w++; } if (!(c & NAVAL) && w < 3) out.push({ sev: 'error', code: 'F01', msg: `海军工厂「${n}」(${cx},${cy}) 附近没有水(${navalRadius} 格内水格 ${w}),放在陆地上了`, id: u.id }); else if (w / t < 0.15) out.push({ sev: 'warn', code: 'F01', msg: `海军工厂 (${cx},${cy}) 周围水域很少(${Math.round(100 * w / t)}%),造出的船可能出不去`, id: u.id }); }
    else if (SHIP.test(n)) { if (!(c & NAVAL)) out.push({ sev: 'error', code: 'F02', msg: `舰船「${n}」(${cx},${cy}) 不在水上`, id: u.id }); }
    else if (n === 'commandCenter' || /Factory$/.test(n)) { if (!(c & LAND)) out.push({ sev: 'error', code: 'F03', msg: `「${n}」(${cx},${cy}) 站在陆地不可通行的格子上`, id: u.id }); }
    else if (!(c & (LAND | NAVAL | HOVER))) out.push({ sev: 'warn', code: 'F04', msg: `单位「${n}」(${cx},${cy}) 站在完全不可通行的格子上`, id: u.id });
  }
  return out;
}
function bfs(mask, W, H, flag, sx, sy, clearance = 0) {
  const ok = (x, y) => { for (let dy = -clearance; dy <= clearance; dy++) for (let dx = -clearance; dx <= clearance; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || !(mask[Y * W + X] & flag)) return false; } return true; };
  const seen = new Uint8Array(W * H); if (!ok(sx, sy)) return null; const q = [sy * W + sx]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) { const i = q[h], x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (!seen[j] && ok(X, Y)) { seen[j] = 1; q.push(j); } } }
  return seen;
}
// 海路:from→to 在给定"船宽"(clearance 格半径)下是否可达;用于检查海峡是否真的通
export function routeExists(model, from, to, { flag = NAVAL, clearance = 0 } = {}) { const P = passability(model); const s = bfs(P, model.width, model.height, flag, from[0], from[1], clearance); return !!(s && s[to[1] * model.width + to[0]]); }
export function minChannelWidth(model, from, to, flag = NAVAL, maxC = 6) { let best = -1; for (let c = 0; c <= maxC; c++) if (routeExists(model, from, to, { flag, clearance: c })) best = c; else break; return best < 0 ? 0 : best * 2 + 1; }
// 陆路:各势力指挥中心能否互相走到(含必要的路径);返回不连通的城
export function landConnectivity(model, { min = 1 } = {}) {
  const P = passability(model); const { width: W, height: H } = model; const ccs = unitsOf(model).filter((u) => u.props.unit === 'commandCenter' && +u.props.team >= 0);
  if (!ccs.length) return []; const lab = new Int32Array(W * H).fill(-1); let n = 0; const sizes = [];
  for (let i = 0; i < W * H; i++) if (lab[i] < 0 && (P[i] & LAND)) { const q = [i]; lab[i] = n; for (let h = 0; h < q.length; h++) { const k = q[h], x = k % W, y = (k / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (lab[j] < 0 && (P[j] & LAND)) { lab[j] = n; q.push(j); } } } sizes.push(q.length); n++; }
  const cnt = new Map(); for (const u of ccs) { const [x, y] = cellOf(model, u); const l = lab[y * W + x]; cnt.set(l, (cnt.get(l) || 0) + 1); }
  const main = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0]; const out = [];
  for (const u of ccs) { const [x, y] = cellOf(model, u); const l = lab[y * W + x]; if (l !== main) out.push({ sev: 'warn', code: 'N01', msg: `指挥中心 team${u.props.team} (${x},${y}) 与主大陆陆路不通(孤岛,${l < 0 ? '站位不可通行' : sizes[l] + ' 格'});需要海运或空军`, id: u.id }); }
  return out;
}
// 陆路"泄漏"检查:两个点之间应被山脉隔断(不应陆路连通)时用
export function shouldBeSeparated(model, a, b) { return !routeExists(model, a, b, { flag: LAND }); }
// 孤立小水塘/小岛:连通域 <minCells 的水域或陆块(提示用)
export function tinyRegions(model, minCells = 12) {
  const P = passability(model); const { width: W, height: H } = model; const out = []; const seen = new Uint8Array(W * H);
  for (const [flag, nm] of [[NAVAL, '水域'], [LAND, '陆块']]) { seen.fill(0); for (let i = 0; i < W * H; i++) if (!seen[i] && (P[i] & flag)) { const q = [i]; seen[i] = 1; for (let h = 0; h < q.length; h++) { const k = q[h], x = k % W, y = (k / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (!seen[j] && (P[j] & flag)) { seen[j] = 1; q.push(j); } } } if (q.length < minCells && q.length > 0) out.push({ sev: 'info', code: 'N02', msg: `孤立${nm} ${q.length} 格 (${i % W},${(i / W) | 0})` }); } }
  return out;
}
