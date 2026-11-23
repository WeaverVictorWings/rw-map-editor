// RWKit 3.5 · 单位/兵力工具（E86–E93 + 批量放置/替换/行军时间/模组单位名）
import { parseTmx, unitsOf, passability, LAND, NAVAL, BUILD, triggersOf } from './tmx.js';
import { UNIT_BY_ID, unitLabel, isShip, isAir, suggestUnit } from './schema35.js';
import { findPath } from './mapops.js';
import { placeCluster, rng } from './layout.js';

const cellOf = (model, u) => [Math.round(u.x / model.tw), Math.round(u.y / model.tw)];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 单位分类（用于对照表） ----------
export const CATS = ['指挥中心', '工厂', '资源/科技', '陆军', '防御', '空军', '海军', '建造者', '其他'];
export function categoryOf(id) {
  id = String(id);
  if (id === 'commandCenter') return '指挥中心';
  if (/Factory$/i.test(id) || /^(landFactory|airFactory|seaFactory|experimentalLandFactory)/i.test(id)) return '工厂';
  if (/^(extractor|fabricator|laboratory|techLab|resource|pool|outpost)/i.test(id)) return '资源/科技';
  if (/^(builder|engineer|experimentalBuilder|builderShip)/i.test(id)) return '建造者';
  if (/(turret|Defence|defense|bunker|tower|antiAir|aaTurret|flameTurret|nuke|gunTurret|laserDefence|artilleryTurret)/i.test(id)) return '防御';
  if (isShip(id)) return '海军';
  if (isAir(id)) return '空军';
  if (/(tank|mech|bug|crab|hover|jeep|apc|artillery|infantry|trooper|spider|bee|ant|beetle|scorp|centipede)/i.test(id)) return '陆军';
  return '其他';
}
const tally = (model) => { const by = new Map(); for (const u of unitsOf(model)) { const t = +u.props.team; if (!(t >= 0)) continue; const id = u.props.unit; if (!by.has(t)) by.set(t, new Map()); const m = by.get(t); m.set(id, (m.get(id) || 0) + 1); } return by; };

// E86 兵力对照表：每队按类别统计，并与参考图（如欧陆）的"每队平均"逐类比较
export function forceTable(model) {
  const by = tally(model), rows = [];
  for (const [t, m] of [...by.entries()].sort((a, b) => a[0] - b[0])) { const c = Object.fromEntries(CATS.map((k) => [k, 0])); let n = 0; for (const [id, k] of m) { c[categoryOf(id)] += k; n += k; } rows.push({ team: t, total: n, ...c }); }
  const sum = Object.fromEntries(CATS.map((k) => [k, rows.reduce((a, r) => a + r[k], 0)])); sum.total = rows.reduce((a, r) => a + r.total, 0);
  return { rows, sum, teams: rows.length, avg: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, rows.length ? +(v / rows.length).toFixed(1) : 0])) };
}
export function compareForces(model, ref, { more = 1.15, far = 1.8 } = {}) {
  const a = forceTable(model), b = forceTable(ref), out = [];
  for (const k of [...CATS, 'total']) { const x = a.avg[k], y = b.avg[k]; const r = y ? +(x / y).toFixed(2) : null; let note = '相当'; if (r === null) note = x ? '参考图没有' : '都没有'; else if (r >= far) note = '远多于'; else if (r >= more) note = '略多于'; else if (r <= 1 / far) note = '远少于'; else if (r <= 1 / more) note = '略少于'; out.push({ cat: k === 'total' ? '合计' : k, mine: x, ref: y, ratio: r, note }); }
  return { rows: out, mine: a, ref: b };
}
export function forceTableText(t) { const head = ['队伍', '合计', ...CATS]; const lines = [head.join('\t'), ...t.rows.map((r) => [r.team, r.total, ...CATS.map((k) => r[k])].join('\t')), ['平均', t.avg.total, ...CATS.map((k) => t.avg[k])].join('\t')]; return lines.join('\n'); }

// ---------- 放置：往 UnitObjects 里追加单位 ----------
export function insertUnits(text, list, group = 'UnitObjects') {
  let maxId = 0; for (const m of text.matchAll(/<object\s+[^>]*?\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  const tw = +(text.match(/<map\s+[^>]*?\btilewidth="(\d+)"/) || [])[1] || 20;
  const xml = list.map((u) => `<object id="${++maxId}" x="${u.x * tw}" y="${u.y * tw}" width="${tw}" height="${tw}"><properties><property name="unit" value="${esc(u.unit)}" /><property name="team" value="${u.team}" />${u.extra ? Object.entries(u.extra).map(([k, v]) => `<property name="${esc(k)}" value="${esc(v)}" />`).join('') : ''}</properties></object>`).join('');
  const re = new RegExp(`(<objectgroup\\s+[^>]*name="${group}"[^>]*>[\\s\\S]*?)(</objectgroup>)`); if (!re.test(text)) throw new Error(`找不到对象组 ${group}`);
  return text.replace(re, (_, a, b) => a + xml + b);
}
const acceptFor = (model, P, id, taken) => (x, y) => {
  if (x < 1 || y < 1 || x >= model.width - 1 || y >= model.height - 1) return false; const f = P[y * model.width + x];
  if (isShip(id)) return !!(f & NAVAL) && !(f & LAND); if (isAir(id)) return true; return !!(f & BUILD) || !!(f & LAND);
};

// E87 按势力强弱档批量放兵:tiers {队伍：档名};perCity {档名:{单位：数量}};围绕该队每座指挥中心放
export function planForces(model, tiers, perCity, { minD = 3, maxD = 9, seed = 11, onlyTeams = null } = {}) {
  const P = passability(model), rand = rng(seed), taken = unitsOf(model).map((u) => cellOf(model, u)), list = [], miss = [];
  const cc = unitsOf(model).filter((u) => u.props.unit === 'commandCenter');
  for (const [t, tier] of Object.entries(tiers)) {
    if (onlyTeams && !onlyTeams.includes(+t)) continue; const quota = perCity[tier]; if (!quota) { miss.push(`${t} 号的档 ${tier} 没有定义`); continue; }
    const cs = cc.filter((u) => +u.props.team === +t); if (!cs.length) { miss.push(`${t} 号没有指挥中心`); continue; }
    for (const c of cs) { const [cx, cy] = cellOf(model, c); for (const [id, n] of Object.entries(quota)) { const pts = placeCluster({ cx, cy, n, minD, maxD: isShip(id) ? maxD * 3 : maxD, accept: acceptFor(model, P, id, taken), taken, rand, tries: 3000 }); taken.push(...pts); for (const [x, y] of pts) list.push({ x, y, unit: id, team: +t }); if (pts.length < n && !isShip(id)) miss.push(`${t} 号 (${cx},${cy}) 的 ${id} 只放下 ${pts.length}/${n}`); } }
  }
  return { list, miss, count: list.length };
}

// E88 工厂成组放置：在 (cx,cy) 一侧并排 n 座，间隔 gap 格；orient 'h'|'v'
export function factoryRow(model, { cx, cy, n = 3, unit = 'landFactory', team, orient = 'h', gap = 4 }) {
  const P = passability(model), pts = [], half = ((n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) { const x = Math.round(orient === 'h' ? cx - half + i * gap : cx), y = Math.round(orient === 'v' ? cy - half + i * gap : cy); const f = P[y * model.width + x]; if (!(f & BUILD)) return { ok: false, reason: `(${x},${y}) 不可建造`, list: [] }; pts.push({ x, y, unit, team }); }
  return { ok: true, list: pts };
}

// E89 舰队编制模板（只放水上；锚点附近找水）
export const FLEETS = {
  航母编队: { carrier: 1, cruiser: 2, destroyer: 3 },
  驱逐舰队: { destroyer: 5, gunboat: 2 },
  战列舰队: { heavyBattleship: 1, battleShip: 2, destroyer: 2 },
  巡逻艇队: { gunboat: 4, missileShip: 2 },
};
export function planFleet(model, name, at, team, { spread = 14, seed = 5 } = {}) {
  const comp = FLEETS[name]; if (!comp) throw new Error('没有这个编制:' + name + '(可选:' + Object.keys(FLEETS).join('、') + ')');
  const P = passability(model), rand = rng(seed), taken = unitsOf(model).map((u) => cellOf(model, u)), list = [], miss = [];
  for (const [id, n] of Object.entries(comp)) { const pts = placeCluster({ cx: at[0], cy: at[1], n, minD: 3, maxD: spread, accept: (x, y) => { if (x < 2 || y < 2 || x >= model.width - 2 || y >= model.height - 2) return false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const f = P[(y + dy) * model.width + x + dx]; if (!(f & NAVAL) || (f & LAND)) return false; } return true; }, taken, rand }); taken.push(...pts); pts.forEach(([x, y]) => list.push({ x, y, unit: id, team })); if (pts.length < n) miss.push(`${id} 只放下 ${pts.length}/${n}`); }
  return { list, miss };
}

// E90 预算与性能提示
export function unitBudget(model, { maxUnits = 6000, maxFactories = 400, maxPerTeam = 600 } = {}) {
  const us = unitsOf(model), by = new Map(); let fac = 0, mobile = 0;
  for (const u of us) { const t = +u.props.team; const c = categoryOf(u.props.unit); if (c === '工厂') fac++; if (['陆军', '空军', '海军', '建造者'].includes(c)) mobile++; if (t >= 0) by.set(t, (by.get(t) || 0) + 1); }
  const out = [], add = (sev, msg) => out.push({ sev, code: 'E90', msg, level: '经验' });
  if (us.length > maxUnits) add('warn', `地图预置对象共 ${us.length} 个，超过 ${maxUnits}(低端手机开局会卡）`); if (fac > maxFactories) add('warn', `工厂共 ${fac} 座，超过 ${maxFactories}(开局 AI 同时生产，会拖慢）`);
  for (const [t, n] of by) if (n > maxPerTeam) add('warn', `${t} 号队伍预置 ${n} 个对象，超过 ${maxPerTeam}`);
  return { total: us.length, factories: fac, mobile, perTeam: Object.fromEntries(by), issues: out };
}

// E91 每城附近兵力规则预览：半径 r 内的己方单位
export function cityForces(model, { radius = 12 } = {}) {
  const us = unitsOf(model), rows = [];
  for (const c of us.filter((u) => u.props.unit === 'commandCenter')) { const [cx, cy] = cellOf(model, c), near = us.filter((u) => u !== c && Math.hypot(cellOf(model, u)[0] - cx, cellOf(model, u)[1] - cy) <= radius && +u.props.team === +c.props.team); const cnt = {}; for (const u of near) { const k = categoryOf(u.props.unit); cnt[k] = (cnt[k] || 0) + 1; } rows.push({ name: c.name || '', x: cx, y: cy, team: +c.props.team, factories: cnt['工厂'] || 0, army: (cnt['陆军'] || 0) + (cnt['空军'] || 0) + (cnt['海军'] || 0), total: near.length, cnt }); }
  return rows;
}
export function lintCityForces(model, opt = {}) { const rows = cityForces(model, opt), out = []; const bare = rows.filter((r) => r.team >= 0 && r.total === 0); if (bare.length) out.push({ sev: 'info', code: 'E91', msg: `${bare.length} 座己方城市周围完全没有单位（开局很容易被偷）:${bare.slice(0, 5).map((r) => r.name || `(${r.x},${r.y})`).join('、')}`, level: '经验' }); return out; }

// E93 / 模组：限制/禁用单位（配置驱动；游戏规则以 rules.noUnits 为准）
export function lintNoUnits(model, patterns = []) {
  const out = []; const res = patterns.map((p) => (p instanceof RegExp ? p : new RegExp(p)));
  for (const u of unitsOf(model)) { const id = u.props.unit || ''; const hit = res.find((r) => r.test(id)); if (hit) out.push({ sev: 'error', code: 'E93', msg: `地图里放了 ${id}(队伍 ${u.props.team}),位置 (${cellOf(model, u)}),与禁放规则 ${hit} 冲突`, level: '规格推断' }); }
  return out;
}

// ---------- 批量放置/替换/显隐 ----------
// 在矩形区域 box=[x0,y0,x1,y1](格）里随机放 count 个单位，保持最小间距
export function placeInRegion(model, { box, unit, team, count, minD = 2, seed = 3 }) {
  const P = passability(model), rand = rng(seed), taken = unitsOf(model).map((u) => cellOf(model, u)), acc = acceptFor(model, P, unit, taken), pts = [];
  for (let t = 0; t < count * 80 && pts.length < count; t++) { const x = Math.round(box[0] + rand() * (box[2] - box[0])), y = Math.round(box[1] + rand() * (box[3] - box[1])); if (!acc(x, y)) continue; if ([...taken, ...pts].some(([a, b]) => Math.hypot(a - x, b - y) < minD)) continue; pts.push([x, y]); }
  return { list: pts.map(([x, y]) => ({ x, y, unit, team })), short: count - pts.length };
}
// 某队的 from 单位全部换成 to
export function replaceUnits(text, { team = null, from, to, onlyBox = null }) {
  const tw = +(text.match(/<map\s+[^>]*?\btilewidth="(\d+)"/) || [])[1] || 20; let n = 0;
  const out = text.replace(/<object\s+([^>]*?)(?:\/>|>(?:(?!<\/object>)[\s\S])*?<\/object>)/g, (all, as) => {
    const u = all.match(/name="unit"\s+value="([^"]*)"/); if (!u || u[1] !== from) return all; const t = all.match(/name="team"\s+value="([^"]*)"/); if (team !== null && (!t || +t[1] !== +team)) return all;
    if (onlyBox) { const x = +(as.match(/\bx="([^"]*)"/) || [])[1] / tw, y = +(as.match(/\by="([^"]*)"/) || [])[1] / tw; if (x < onlyBox[0] || y < onlyBox[1] || x > onlyBox[2] || y > onlyBox[3]) return all; }
    n++; return all.replace(/(name="unit"\s+value=")[^"]*(")/, `$1${esc(to)}$2`);
  });
  return { text: out, changed: n };
}
export const unitsByTeam = (model) => { const m = new Map(); for (const u of unitsOf(model)) { const t = +u.props.team; if (!m.has(t)) m.set(t, []); m.get(t).push(u); } return m; };

// ---------- 行军时间估算 ----------
// 速度是"格/秒"的粗估，不同模组/版本不一样，仅用来比较"哪个更快",请用 speeds 覆盖成你实测的
export const SPEEDS = { heavyTank: 0.55, lightTank: 0.9, mechGun: 0.75, builder: 0.7, fireBee: 2.4, helicopter: 1.6, battleShip: 0.7, destroyer: 1.1, hovercraft: 1.2 };
export function travelTime(model, a, b, unit = 'heavyTank', speeds = {}) {
  const sp = { ...SPEEDS, ...speeds }[unit]; if (!sp) return { ok: false, reason: `没有 ${unit} 的速度数据，请用 speeds 指定（格/秒）` };
  if (isAir(unit)) { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return { ok: true, dist: Math.round(d), secs: Math.round(d / sp), air: true }; }
  const path = findPath(model, a, b, { flag: isShip(unit) ? NAVAL : LAND }); if (!path || !path.length) return { ok: false, reason: '走不通' };
  return { ok: true, dist: path.length, secs: Math.round(path.length / sp), path };
}

// ---------- 模组单位名校验 ----------
// known: 额外认识的单位 id(模组单位表）；认不出的给"你是不是想写 xxx"
export function lintUnitNames(model, known = []) {
  const ok = new Set(known), out = [], seen = new Map();
  for (const u of unitsOf(model)) { const id = u.props.unit; if (!id || UNIT_BY_ID.has(id) || ok.has(id) || /^custom_/.test(id)) continue; seen.set(id, (seen.get(id) || 0) + 1); }
  for (const [id, n] of seen) { const s0 = suggestUnit(id), s = s0 && s0 !== id ? s0 : (known.find((k) => k.toLowerCase() === id.toLowerCase()) || null); out.push({ sev: 'warn', code: 'E19', msg: `单位 ${id}(${n} 个）不在原版单位表里${known.length ? '也不在你给的模组单位表里' : '(如果是模组单位，请用 --units 给出模组单位表）'}${s ? `,你是不是想写 ${s}?` : ''}`, level: '规格推断' }); }
  return out;
}
export function parseUnitList(text) { return [...new Set(String(text).split(/\r?\n/).map((l) => l.replace(/\.(ini|txt)$/i, '').split(/[\s,;|]/)[0].trim()).filter((s) => /^[A-Za-z_][\w-]*$/.test(s)))]; }

// ---------- 热力图（叠加用）：按队伍/类别统计的格子密度 ----------
export function heatGrid(model, { step = 10, team = null, cat = null } = {}) {
  const w = Math.ceil(model.width / step), h = Math.ceil(model.height / step), g = new Float32Array(w * h); let max = 0;
  for (const u of unitsOf(model)) { if (team !== null && +u.props.team !== team) continue; if (cat && categoryOf(u.props.unit) !== cat) continue; const [x, y] = cellOf(model, u); const i = Math.min(h - 1, Math.floor(y / step)) * w + Math.min(w - 1, Math.floor(x / step)); g[i]++; if (g[i] > max) max = g[i]; }
  return { w, h, step, g, max };
}
export function heatUneven(hm, { landCells = null } = {}) { const v = [...hm.g].filter((x) => x > 0); if (!v.length) return { cv: 0, filled: 0 }; const mean = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length); return { cv: +(sd / mean).toFixed(2), filled: v.length, total: hm.w * hm.h, mean: +mean.toFixed(1), max: hm.max, landCells }; }
export { unitLabel };
