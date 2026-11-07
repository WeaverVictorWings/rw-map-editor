// RWKit · 单位批量操作:资源池补抽取仪、按条件删单位、归属判定(最近的指挥中心)
import { parseTmx, unitsOf, tileProps, esc, unesc } from './tmx.js';
const cellOf = (m, o) => `${Math.floor(o.x / m.tw)},${Math.floor(o.y / m.tw)}`;
export function pools(model) { const I = model.layers.items; const out = []; if (!I) return out; const cache = new Map(); for (let i = 0; i < model.width * model.height; i++) { const g = I.data[i]; if (!g) continue; let r = cache.get(g); if (r === undefined) { r = 'res_pool' in (tileProps(model, g) || {}); cache.set(g, r); } if (r) out.push([i % model.width, (i / model.width) | 0]); } return out; }
// 资源池在地图上占多格(如 2×2):按相邻格聚成一个池,锚点取左上角;池里任意一格上有抽取仪就算已填
export function poolSites(model) { const cells = pools(model); const key = (x, y) => y * model.width + x; const set = new Map(cells.map(([x, y]) => [key(x, y), [x, y]])); const seen = new Set(); const sites = []; for (const [x, y] of cells) { if (seen.has(key(x, y))) continue; const q = [[x, y]]; seen.add(key(x, y)); let x0 = x, y0 = y, x1 = x, y1 = y; for (let h = 0; h < q.length; h++) { const [cx, cy] = q[h]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = key(cx + dx, cy + dy); if (set.has(k) && !seen.has(k)) { seen.add(k); q.push([cx + dx, cy + dy]); x0 = Math.min(x0, cx + dx); y0 = Math.min(y0, cy + dy); x1 = Math.max(x1, cx + dx); y1 = Math.max(y1, cy + dy); } } } sites.push({ anchor: [x0, y0], box: [x0, y0, x1, y1], cells: q.length }); } return sites; }
// 注意:本图实测是"一个池格放一个抽取仪"(786 个抽取仪都在池格上,611 个有相邻抽取仪),所以缺口按格算
export function poolGaps(model, { unitRe = /^extractor/ } = {}) { const have = new Set(unitsOf(model).filter((u) => unitRe.test(u.props.unit)).map((u) => cellOf(model, u))); return pools(model).filter(([x, y]) => !have.has(`${x},${y}`)); }
// 每个缺口归属于 radius 格内最近的"有队伍的指挥中心";找不到则归 fallbackTeam(null 则跳过)
export function ownerOf(model, [x, y], { radius = 10 } = {}) { let best = null, bd = radius; for (const u of unitsOf(model)) if (u.props.unit === 'commandCenter') { const d = Math.hypot(u.x / model.tw - x, u.y / model.tw - y); if (d < bd) { bd = d; best = +u.props.team; } } return best; }
export function fillPools(text, { unit = 'extractorT1', radius = 10, fallbackTeam = null, onlyTeams = null } = {}) {
  const model = parseTmx(text); const gaps = poolGaps(model); let maxId = 0; for (const m of text.matchAll(/<object\s+[^>]*?\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  const add = []; let skipped = 0; for (const c of gaps) { const t = ownerOf(model, c, { radius }) ?? fallbackTeam; if (t === null || t === undefined || (onlyTeams && !onlyTeams.includes(t))) { skipped++; continue; } add.push(`<object id="${++maxId}" x="${c[0] * model.tw}" y="${c[1] * model.tw}" width="${model.tw}" height="${model.tw}"><properties><property name="unit" value="${unit}"/><property name="team" value="${t}"/></properties></object>`); }
  const re = /(<objectgroup\s+[^>]*name="UnitObjects"[^>]*>[\s\S]*?)(<\/objectgroup>)/; if (!re.test(text)) throw new Error('找不到 UnitObjects 组'); return { text: text.replace(re, (_, a, b) => a + add.join('') + b), added: add.length, skipped };
}
// 删除单位:unitRe 匹配单位名,可限定队伍;返回删除数。(用于"删某类建筑再按规则重新分配")
export function removeUnits(text, { unitRe, teams = null }) { let n = 0; const out = text.replace(/<object\s+([^>]*?)>(?:(?!<\/object>)[\s\S])*?<\/object>/g, (all) => { const u = all.match(/name="unit" value="([^"]*)"/); if (!u || !unitRe.test(unesc(u[1]))) return all; const t = all.match(/name="team" value="(-?\d+)"/); if (teams && !(t && teams.includes(+t[1]))) return all; n++; return ''; }); return { text: out, removed: n }; }
// 按配额表给各队补建筑:quota {队伍:{unit:数量}} 放在该队指挥中心周围环带内;accept(x,y) 判定格子是否可放
export function placeQuota(text, quota, { accept, rand, minD = 3, maxD = 10, nameOf } = {}) {
  const model = parseTmx(text); let maxId = 0; for (const m of text.matchAll(/<object\s+[^>]*?\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  const cc = unitsOf(model).filter((u) => u.props.unit === 'commandCenter'); const taken = unitsOf(model).map((u) => [u.x / model.tw, u.y / model.tw]); const xml = []; const missing = [];
  return import('./layout.js').then(({ placeCluster, rng }) => { const rr = rand || rng(11);
    for (const [t, units] of Object.entries(quota)) { const cs = cc.filter((u) => +u.props.team === +t); if (!cs.length) { missing.push(`${t}号无指挥中心`); continue; } let i = 0;
      for (const [unit, n] of Object.entries(units)) { const c = cs[i++ % cs.length]; const pts = placeCluster({ cx: c.x / model.tw, cy: c.y / model.tw, n, minD, maxD, accept: (x, y) => accept(x, y, unit), taken, rand: rr }); taken.push(...pts); if (pts.length < n) missing.push(`${t}号 ${unit} 只放下 ${pts.length}/${n}`); for (const [x, y] of pts) xml.push(`<object id="${++maxId}" x="${x * model.tw}" y="${y * model.tw}" width="${model.tw}" height="${model.tw}"><properties><property name="unit" value="${unit}"/><property name="team" value="${t}"/></properties></object>`); } }
    const re = /(<objectgroup\s+[^>]*name="UnitObjects"[^>]*>[\s\S]*?)(<\/objectgroup>)/; return { text: text.replace(re, (_, a, b) => a + xml.join('') + b), added: xml.length, missing }; });
}
