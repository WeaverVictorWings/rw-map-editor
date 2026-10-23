// 可视化触发器编辑器：积木卡片（当…就…）、逻辑图、区域、模板（城夺 / 生存 / 任务）、检查
// 规则依据：游戏 1.15 的触发器解析（见 research_notes/triggers_spec.md）
//   - 触发器放在 Triggers 对象层，类型写在 <object type="...">（大小写不敏感）
//   - 触发器的“名字”= id 属性，没有就用对象 name；重复时只认第一个
//   - activatedBy / alsoActivate / deactivatedBy 都是逗号分隔的名字
//   - 时间：20s、500ms，纯数字表示毫秒
import { A } from './state.js';
import { objProp, setObjProp } from './tmx.js';
import { UNIT_CN, MAX_TEAMS } from './editor.js';
import { teamColor } from './render.js';
import { h, toast, modal, closeModal, select, toggle, confirmBox, segmented } from './ui.js';
import { icon } from './icons.js';
import { HELP, helpBtn } from './help.js';

const ed = A.ed, rend = A.rend;
const TW = 20;

// ---------------- 类型定义 ----------------
// 字段：[属性名, 中文, 种类, 是否必填, 说明]
const COMMON_TEAM = ['team', '队伍', 'teamOpt', false, '不选表示所有队伍'];
export const CATS = {
  cond: { cn: '条件', color: '88,166,255' },
  logic: { cn: '逻辑', color: '170,176,190' },
  act: { cn: '动作', color: '229,121,58' },
  text: { cn: '文字', color: '63,185,80' },
  special: { cn: '设置', color: '200,140,255' },
};
export const TYPES = {
  unitDetect: { cn: '单位检测', cat: 'cond', icon: 'eye', area: 'rect', desc: '区域里有（或没有）某些单位时成立。最常用的条件。',
    fields: [COMMON_TEAM, ['unitType', '单位类型', 'unit', false, '只能写一种；不填表示任何单位'], ['minUnits', '至少几个', 'int', false, '默认 1'], ['maxUnits', '最多几个', 'int', false, '填 0 表示“区域里没有”'],
      ['onlyBuildings', '只数建筑', 'bool'], ['onlyMainBuildings', '只数生产建筑', 'bool'], ['onlyBuilders', '只数建造者', 'bool'], ['onlyOnResourcePool', '只数资源池上的建筑', 'bool'],
      ['onlyIdle', '只数空闲单位', 'bool'], ['onlyAttack', '只数能攻击的', 'bool'], ['onlyAttackAir', '只数能对空的', 'bool'], ['onlyTechLevel', '只数某科技等级', 'int'],
      ['onlyWithTag', '只数带某标签的', 'text'], ['includeIncomplete', '算上没建完的建筑', 'bool']] },
  teamTagDetect: { cn: '标签检测', cat: 'cond', icon: 'flag', desc: '某队带有某个标签时成立（标签用“队伍标签”添加）。',
    fields: [['team', '队伍', 'team', true], ['teamTag', '标签', 'text', true]] },
  basic: { cn: '中继 / 计时', cat: 'logic', icon: 'clock', desc: '本身不做事。用来当计时器（配合“延迟”）或者把几个条件合成一个（与 / 或）。', fields: [] },
  unitAdd: { cn: '刷兵', cat: 'act', icon: 'plus', area: 'center', desc: '在区域中心生成单位。',
    fields: [['spawnUnits', '生成哪些单位', 'units', true], ['team', '属于哪个队', 'team', true]] },
  unitRemove: { cn: '删除单位', cat: 'act', icon: 'del', area: 'rect', desc: '删除区域里的单位。',
    fields: [COMMON_TEAM, ['onlyIfEmpty', '只删空的运输单位', 'bool']] },
  changeCredits: { cn: '改资金', cat: 'act', icon: 'coin', desc: '给某队加钱、扣钱或直接设成某个数。',
    fields: [['team', '队伍', 'team', true], ['add', '增加（负数为扣）', 'int'], ['set', '直接设为', 'int', false, '同时填时先“设为”再“增加”']] },
  teamTags: { cn: '队伍标签', cat: 'act', icon: 'flag', desc: '给某队加上或去掉标签，配合“标签检测”做开关。',
    fields: [['team', '队伍', 'team', true], ['addTeamTags', '加标签（逗号分隔）', 'text'], ['removeTeamTags', '去标签（逗号分隔）', 'text']] },
  mapText: { cn: '地图文字', cat: 'text', icon: 'text', area: 'center', desc: '在区域中心显示文字。只在“激活”时显示。',
    fields: [['text', '文字', 'text', true], ['textColor', '颜色', 'color'], ['textSize', '字号', 'int', false, '默认 20'], ['style', '样式', 'style']] },
  objective: { cn: '任务目标', cat: 'text', icon: 'check', desc: '任务图的目标。激活后算“完成”。配合 map_info 的胜利条件“完成所有目标”。',
    fields: [['text', '目标文字', 'text', true]] },
  moveCamera: { cn: '移动镜头', cat: 'act', icon: 'fit', area: 'center', desc: '把镜头移到区域中心（剧情用）。', fields: [] },
  move: { cn: '移动单位', cat: 'act', icon: 'path', area: 'rect', desc: '把区域里的单位派往一个“目标点”。',
    fields: [COMMON_TEAM, ['target', '目标点', 'point', true], ['unload', '到达后卸载', 'bool']] },
};
export const SPECIAL = {
  point: { cn: '目标点', cat: 'special', icon: 'spawn', desc: '给“移动单位”当目的地。名字就是它的标识。', fields: [] },
  team_info: { cn: '队伍设置', cat: 'special', icon: 'units', desc: '某队的开局资金、AI 难度等（只在开局生效一次）。',
    fields: [['team', '队伍', 'team', true], ['credits', '开局资金', 'int'], ['allyGroup', '同盟组（单机）', 'int'], ['lockAiDifficulty', '锁定 AI 难度（-2~3）', 'int'], ['disabledAI', '关闭 AI（单机）', 'bool'], ['basicAI', '简单 AI（单机）', 'bool']] },
};
const BY_NAME = { attack_point: { cn: '敌军出生点', cat: 'special', icon: 'wave', desc: '生存模式里敌人从这里出来，可以放好几个。', fields: [] },
  camera_start: { cn: '开局镜头', cat: 'special', icon: 'fit', desc: '开局时镜头的位置。', fields: [['zoomTo', '缩放', 'text']] } };
const TIMING = [['delay', '延迟', 'time', '开局后多久才可以触发（只算一次）'], ['warmup', '持续', 'time', '条件要连续成立这么久才算'],
  ['resetActivationAfter', '可以再次触发', 'time', '触发后过多久复位，能再次触发；不填就只触发一次'], ['repeatDelay', '重复间隔', 'time', '触发后每隔多久再做一次（不重新检查条件）']];
const MSG = [['globalMessage', '作战日志消息', 'text'], ['globalMessage_textColor', '消息颜色', 'color'], ['globalMessage_delayPerChar', '打字速度（如 0.05s）', 'text'], ['showOnMap', '在小地图上标出', 'bool'], ['comment', '备注（游戏不读）', 'text']];
const BOOL_PROPS = new Set(['allToActivate', 'showOnMap', 'onlyBuildings', 'onlyMainBuildings', 'onlyBuilders', 'onlyOnResourcePool', 'onlyIdle', 'onlyEmptyQueue', 'onlyAttack', 'onlyAttackAir', 'includeIncomplete', 'onlyIfEmpty', 'unload', 'disabledAI', 'basicAI', 'shareFogWithAllies', 'survivalWavesClassic', 'startWithMusic']);
const TIME_PROPS = ['delay', 'warmup', 'resetActivationAfter', 'repeatDelay'];
const LINKS = [['activatedBy', '被谁激活', '这些触发器成立时，这个才会触发'], ['alsoActivate', '同时激活', '这个成立时，也算作激活下面这些'], ['deactivatedBy', '被谁关闭', '这些触发器成立时，这个被关闭、不能触发']];
export const WIN_CONDITIONS = [['', '默认'], ['commandCenter', '摧毁指挥中心'], ['mainBuildings', '摧毁主要建筑'], ['allBuildings', '摧毁所有建筑'], ['allUnitsAndBuildings', '消灭所有单位和建筑'], ['requiredObjectives', '完成所有任务目标'], ['none', '没有（不会自动结束）']];
const MAP_TYPE_CN = [['skirmish', '遭遇战（普通对战）'], ['survival', '生存（打波次）'], ['mission', '任务（剧情关卡）'], ['challenge', '挑战']];
const KNOWN_UNITS = ['tank', 'heavyTank', 'builder', 'turret', 'supplyDepot', 'commandCenter', 'mechGun', 'c_tank', 'turret_flamethrower', 'bugTurret', 'antiAirTurretFlak', 'ladybug', 'fireBee'];

// ---------------- 基础工具 ----------------
export function trigGroup(create = false) { return ed.map ? (create ? ed.map.ensureGroup('Triggers') : ed.map.group('Triggers')) : null; }
const lc = (s) => String(s || '').trim().toLowerCase();
export function kindOf(o) {
  const raw = lc(o.attrs.type || o.attrs.class);
  if (raw) {
    for (const k of Object.keys(TYPES)) if (k.toLowerCase() === raw) return k;
    for (const k of Object.keys(SPECIAL)) if (k === raw) return k;
    return '?' + (o.attrs.type || o.attrs.class);
  }
  const nm = lc(o.attrs.name);
  if (nm === 'map_info') return 'map_info';
  if (BY_NAME[nm]) return nm;
  return '';
}
export function defOf(o) { const k = kindOf(o); return TYPES[k] || SPECIAL[k] || BY_NAME[k] || null; }
export function tkey(o) { return lc(objProp(o, 'id') || o.attrs.name || 'NULL'); }
export function label(o) { return (objProp(o, 'id') || o.attrs.name || '（未命名）').trim(); }
const isTrigger = (o) => !!TYPES[kindOf(o)];
const listOf = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
function links(o, prop) {
  const alias = { activatedBy: 'whenActivatedIds', alsoActivate: 'activateIds' }[prop];
  return [...listOf(objProp(o, prop)), ...(alias ? listOf(objProp(o, alias)) : [])];
}
function rectOf(o) { return { x: +(o.attrs.x || 0), y: +(o.attrs.y || 0), w: +(o.attrs.width || 0), h: +(o.attrs.height || 0) }; }
function centerTile(o) { const r = rectOf(o); return { x: Math.floor((r.x + r.w / 2) / TW), y: Math.floor((r.y + r.h / 2) / TW) }; }

export function parseTime(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/i);
  if (!m) return NaN;
  return m[2] && m[2].toLowerCase() === 's' ? +m[1] * 1000 : +m[1];
}
export function fmtTime(ms) {
  if (ms === null || Number.isNaN(ms)) return '?';
  if (ms < 1000) return `${ms} 毫秒`;
  const s = Math.round(ms / 100) / 10;
  if (s >= 60) { const mm = Math.floor(s / 60), ss = Math.round((s - mm * 60) * 10) / 10; return `${mm} 分${ss ? ' ' + ss + ' 秒' : ''}`; }
  return `${s} 秒`;
}
function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of String(s || '')) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
export function parseUnits(s) {
  return splitTop(s).map((it) => {
    const m = it.match(/^([^*()]+?)\s*(?:\*\s*(\d+))?\s*(?:\((.*)\))?$/);
    return m ? { name: m[1].trim(), n: m[2] ? +m[2] : 1, opts: m[3] ? m[3].trim() : '', ok: true } : { name: it, n: 1, opts: '', ok: false };
  });
}
export function formatUnits(list) { return list.filter((u) => u.name).map((u) => u.name + (u.n > 1 ? '*' + u.n : '') + (u.opts ? `(${u.opts})` : '')).join(', '); }
const unitCn = (u) => UNIT_CN[u] ? `${UNIT_CN[u]}` : u;
function teamCn(t) {
  if (t === undefined || t === null || t === '') return '所有队伍';
  const n = +t;
  if (n === -1) return '中立';
  if (n === -2) return '敌对中立';
  return Number.isNaN(n) ? `队伍“${t}”` : `第 ${n + 1} 队`;
}
function hslToHex(s) {
  const m = s.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/); if (!m) return s;
  const H = +m[1] / 360, S = +m[2] / 100, L = +m[3] / 100;
  const f = (n) => { const k = (n + H * 12) % 12, a = S * Math.min(L, 1 - L); const c = L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}
export const teamHex = (t) => { const c = teamColor(t); return c.startsWith('#') ? c : hslToHex(c); };

function allKeys() { const T = trigGroup(); return new Set(T ? T.objects.map(tkey) : []); }
function uniqueId(base, taken = allKeys()) {
  base = String(base).replace(/[,\s]+/g, '_') || '触发器';
  let id = base, n = 2;
  while (taken.has(lc(id))) id = base + n++;
  taken.add(lc(id));
  return id;
}
function findByKey(k) { const T = trigGroup(); return T ? T.objects.find((o) => tkey(o) === lc(k)) || null : null; }

// 一次可撤销的修改
function edit(label2, fn) {
  const T = trigGroup(true);
  ed.begin(label2);
  ed.op.snapshotGroup(T);
  const r = fn(T);
  ed.commit();
  A.autoDirty = true;
  rend.request();
  A.refresh('top', 'dock');
  return r;
}
function setP(o, name, v) { setObjProp(o, name, v === '' || v === null || v === undefined || v === false ? undefined : v === true ? 'true' : v); }

export function makeTrigger(type, rect, props = {}, idBase, taken) {
  const def = TYPES[type] || SPECIAL[type];
  const id = uniqueId(idBase || (def ? def.cn.replace(/\s*\/\s*/g, '') : type), taken);
  const o = { attrs: { name: id, x: String(Math.round(rect.x)), y: String(Math.round(rect.y)), width: String(Math.round(rect.w || TW)), height: String(Math.round(rect.h || TW)) }, props: [], extra: [] };
  if (TYPES[type] || SPECIAL[type]) o.attrs.type = type;
  if (type !== 'point') o.props.push({ name: 'id', value: id });
  for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== null && v !== '') o.props.push({ name: k, value: String(v) });
  if (!o.props.length) o.props.push({ name: 'comment', value: def ? def.cn : type });
  return o;
}

// ---------------- 白话描述 ----------------
function chipKeys(arr) { return arr.map((k) => `「${esc(k)}」`).join(''); }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function condText(o) {
  const k = kindOf(o);
  if (k === 'unitDetect') {
    const team = objProp(o, 'team'), ut = objProp(o, 'unitType');
    const min = objProp(o, 'minUnits'), max = objProp(o, 'maxUnits');
    const what = ut ? unitCn(ut) : objProp(o, 'onlyBuildings') === 'true' ? '建筑' : objProp(o, 'onlyBuilders') === 'true' ? '建造者' : '单位';
    const who = team === undefined ? '' : teamCn(team) + '的';
    if (max !== undefined && +max === 0) return `区域里<b>没有</b>${who}${what}`;
    const lo = min !== undefined ? +min : 1;
    return `区域里有${max !== undefined ? ` ${lo}~${max} 个` : lo > 1 ? `至少 ${lo} 个` : ''}${who}${what}`;
  }
  if (k === 'teamTagDetect') return `${teamCn(objProp(o, 'team'))}带有标签「${esc(objProp(o, 'teamTag') || '?')}」`;
  return '';
}
function actText(o) {
  const k = kindOf(o);
  const t = objProp(o, 'team');
  switch (k) {
    case 'unitAdd': { const u = parseUnits(objProp(o, 'spawnUnits')); return `给${teamCn(t)}刷出 ${u.length ? u.map((x) => unitCn(x.name) + (x.n > 1 ? '×' + x.n : '')).join('、') : '<i>（还没选单位）</i>'}`; }
    case 'unitRemove': return `删除区域里${t === undefined ? '所有' : teamCn(t) + '的'}单位`;
    case 'changeCredits': { const s = objProp(o, 'set'), a = objProp(o, 'add'); return `${teamCn(t)}资金` + (s !== undefined ? `设为 ${s}` : '') + (a !== undefined ? (+a >= 0 ? ` +${a}` : ` ${a}`) : '') + (s === undefined && a === undefined ? '<i>（还没填数）</i>' : ''); }
    case 'teamTags': return `${teamCn(t)}` + (objProp(o, 'addTeamTags') ? `加标签「${esc(objProp(o, 'addTeamTags'))}」` : '') + (objProp(o, 'removeTeamTags') ? `去标签「${esc(objProp(o, 'removeTeamTags'))}」` : '');
    case 'mapText': return `显示文字「${esc(objProp(o, 'text') || '')}」`;
    case 'objective': return `目标「${esc(objProp(o, 'text') || '')}」算完成`;
    case 'moveCamera': return '镜头移到这里';
    case 'move': return `把${t === undefined ? '' : teamCn(t) + '的'}单位派往「${esc(objProp(o, 'target') || '?')}」`;
    case 'basic': return '标记为成立';
    default: return isTrigger(o) ? '标记为成立' : '';
  }
}
export function describe(o) {
  const k = kindOf(o), def = defOf(o);
  if (!def) return '';
  if (def.cat === 'special') return esc(def.desc);
  const when = [];
  const all = objProp(o, 'allToActivate') === 'true';
  const d = parseTime(objProp(o, 'delay'));
  if (d !== null) when.push(`开局 ${fmtTime(d)} 后`);
  const ab = links(o, 'activatedBy');
  if (ab.length) when.push(`${chipKeys(ab)}${ab.length > 1 ? (all ? '都' : '任一') : ''}成立`);
  const c = condText(o); if (c) when.push(c);
  const wu = parseTime(objProp(o, 'warmup'));
  let s = when.length ? '当' + when.join(all ? '，并且' : '，或') + (wu !== null ? `（持续 ${fmtTime(wu)}）` : '') : wu !== null ? `开局 ${fmtTime(wu)} 后` : '开局就';
  s += ' → ' + actText(o);
  const al = links(o, 'alsoActivate');
  if (al.length) s += `，并激活${chipKeys(al)}`;
  const gm = objProp(o, 'globalMessage'); if (gm) s += `，提示「${esc(gm)}」`;
  const r = parseTime(objProp(o, 'resetActivationAfter')), rp = parseTime(objProp(o, 'repeatDelay'));
  const db = links(o, 'deactivatedBy');
  if (rp !== null) s += `；之后每 ${fmtTime(rp)} 再做一次`;
  if (r !== null) s += `；${fmtTime(r)}后可再次触发`;
  if (r === null && rp === null && !db.length) s += '；只触发一次';
  if (db.length) s += `。${chipKeys(db)}成立时暂停`;
  if (all && !ab.length && d === null && !c) s += '<br><b style="color:var(--warn)">“全部满足”但没有任何条件，永远不会触发</b>';
  return s;
}
export function triggerColor(o) {
  const def = defOf(o);
  return def ? CATS[def.cat].color : '120,200,255';
}

// ---------------- 检查 ----------------
const TIME_RE = /^\d+(\.\d+)?\s*(ms|s)?$/i;
let issCache = { key: '', val: null };
export function triggerIssues() {
  if (!ed.map) return [];
  const last = ed.undoStack[ed.undoStack.length - 1];
  const T0 = trigGroup();
  const key = `${ed.map.width}|${ed.undoStack.length}|${ed.redoStack.length}|${last ? last.time + last.label : ''}|${T0 ? T0.objects.length : 0}`;
  if (issCache.key === key && issCache.map === ed.map) return issCache.val;
  const val = computeIssues();
  issCache = { key, val, map: ed.map };
  return val;
}
function computeIssues() {
  const out = [];
  const T = trigGroup();
  const objs = T ? T.objects : [];
  const first = new Map();
  for (const o of objs) { const k = tkey(o); if (!first.has(k)) first.set(k, o); }
  const pointNames = new Set(objs.filter((o) => kindOf(o) === 'point').map((o) => lc(o.attrs.name)));
  const add = (level, o, title, detail = '', fix = null) => out.push({ level, title, detail, goto: o ? centerTile(o) : undefined, fix, obj: o });
  const fixEdit = (lb, o, fn) => ({ label: lb, run: () => edit(lb, () => fn(o)) });
  let highTeam = 0, nTrig = 0;
  const dupSeen = new Map();
  for (const o of objs) {
    const k = kindOf(o);
    if (k === 'map_info') continue;
    if (!o.attrs.type && o.attrs.class) add('warn', o, `「${label(o)}」的类型写在 class 里`, 'Tiled 1.9 会把类型存成 class，游戏只认 type。', fixEdit('改成 type', o, (x) => { x.attrs.type = x.attrs.class; delete x.attrs.class; }));
    if (k.startsWith('?')) { add('warn', o, `「${label(o)}」的类型「${k.slice(1)}」游戏不认识`, '游戏会跳过它。可用的类型：' + Object.keys(TYPES).join('、')); continue; }
    if (!k) { if ((o.attrs.name || '') && !o.attrs.gid) add('info', o, `对象「${label(o)}」没有类型`, '游戏会忽略它（可以当注释用）。'); continue; }
    const def = defOf(o);
    if (!o.props.length && (TYPES[k] || SPECIAL[k])) add('warn', o, `「${label(o)}」一个属性都没有`, '游戏会跳过没有任何属性的触发器。', fixEdit('补上 id', o, (x) => setP(x, 'id', label(x))));
    for (const [p, cn, kind, req] of def.fields || []) {
      const v = objProp(o, p);
      if (req && (v === undefined || v === '')) add('error', o, `「${label(o)}」（${def.cn}）缺少“${cn}”`, `属性 ${p} 必须填写。`);
      if (kind === 'int' && v !== undefined && v !== '' && !/^-?\d+$/.test(v.trim())) add('error', o, `「${label(o)}」的“${cn}”不是整数`, `现在是「${v}」。`);
    }
    if (SPECIAL[k] || BY_NAME[k]) {
      if (k === 'team_info') { const t = objProp(o, 'team'); if (t !== undefined && +t >= 10) highTeam = Math.max(highTeam, +t); }
      continue;
    }
    nTrig++;
    const key = tkey(o);
    if (first.get(key) !== o) dupSeen.set(key, (dupSeen.get(key) || 1) + 1);
    if ((def.area === 'rect') && (+(o.attrs.width || 0) <= 0 || +(o.attrs.height || 0) <= 0)) add('error', o, `「${label(o)}」的区域大小是 0`, '宽或高为 0 的区域里什么都检测不到。', fixEdit('设为 1×1 格', o, (x) => { x.attrs.width = String(TW); x.attrs.height = String(TW); }));
    for (const [p, cn] of LINKS) for (const ref of links(o, p)) {
      if (!first.has(lc(ref))) add('error', o, `「${label(o)}」的“${cn}”里有不存在的「${ref}」`, '游戏会忽略这条连接。可能是名字打错了，或者那个触发器被删了。', fixEdit('去掉这条连接', o, (x) => setP(x, p, listOf(objProp(x, p)).filter((r) => lc(r) !== lc(ref)).join(','))));
    }
    const t = objProp(o, 'team');
    if (t !== undefined && t !== '') {
      if (!/^-?\d+$/.test(t.trim())) add('error', o, `「${label(o)}」的队伍「${t}」不是数字`, '触发器的队伍只能填 -2、-1 或 0~99（不能写 none）。游戏会丢掉这个触发器。');
      else if (+t >= MAX_TEAMS || +t < -2) add('error', o, `「${label(o)}」的队伍 ${t} 超出范围`, '只能是 -2、-1 或 0~99。');
      else if (+t >= 10) highTeam = Math.max(highTeam, +t);
    }
    for (const p of TIME_PROPS) {
      const v = objProp(o, p); if (v === undefined || v === '') continue;
      if (!TIME_RE.test(v.trim())) add('error', o, `「${label(o)}」的时间「${v}」游戏读不懂`, '时间要写成 20s（秒）或 500ms（毫秒）。');
      else if (/^\d+(\.\d+)?$/.test(v.trim()) && +v < 1000 && +v > 0) add('warn', o, `「${label(o)}」的时间「${v}」只有 ${v} 毫秒`, '纯数字表示毫秒。是不是想写成秒？', fixEdit(`改成 ${v}s`, o, (x) => setP(x, p, v.trim() + 's')));
    }
    for (const pr of o.props) if (BOOL_PROPS.has(pr.name) && pr.value !== 'true' && pr.value !== 'false') add('error', o, `「${label(o)}」的 ${pr.name} 是「${pr.value}」`, '开关属性只能填 true 或 false。', fixEdit('改成 true', o, (x) => setP(x, pr.name, true)));
    if (k === 'unitAdd') for (const u of parseUnits(objProp(o, 'spawnUnits'))) if (!u.ok || !/^[A-Za-z_][\w-]*$/.test(u.name)) add('warn', o, `「${label(o)}」的单位「${u.name}」写法可能不对`, '格式：单位名*数量，多个用逗号隔开，例如 tank*5, builder。');
    if (k === 'move') { const tg = objProp(o, 'target'); if (tg && !pointNames.has(lc(tg))) add('error', o, `「${label(o)}」的目标点「${tg}」不存在`, '先用“新建 → 目标点”放一个，名字要一样。'); }
    if (k === 'changeCredits' && objProp(o, 'add') === undefined && objProp(o, 'set') === undefined) add('warn', o, `「${label(o)}」没填加多少钱`, '“增加”或“直接设为”至少填一个。');
    if (objProp(o, 'allToActivate') === 'true' && !links(o, 'activatedBy').length && objProp(o, 'delay') === undefined && TYPES[k].cat !== 'cond') add('warn', o, `「${label(o)}」永远不会触发`, '勾了“全部满足”，但没有任何条件。');
    if (objProp(o, 'repeatCount') !== undefined) add('info', o, `「${label(o)}」的 repeatCount 不起作用`, '1.15 版本会读取但没有使用这个属性。');
  }
  for (const [k, n] of dupSeen) {
    const o = first.get(k);
    const merge = objs.filter((x) => tkey(x) === k).every((x) => links(x, 'alsoActivate').some((r) => lc(r) === k));
    if (!merge) add('warn', o, `有 ${n} 个触发器都叫「${label(o)}」`, '别处引用这个名字时，游戏只认第一个。如果是有意用“同名 + 同时激活自己”合并条件，可以忽略。');
  }
  const mi = ed.mapInfo();
  if (mi) {
    const type = lc(objProp(mi, 'type')), wc = objProp(mi, 'winCondition');
    if (wc !== undefined && !WIN_CONDITIONS.some(([v]) => v && v.toLowerCase() === lc(wc)) && lc(wc) !== 'mainbuilings') add('error', mi, `胜利条件「${wc}」游戏不认识`, '游戏会报错。可选：' + WIN_CONDITIONS.filter(([v]) => v).map(([v, c]) => `${v}（${c}）`).join('、'));
    if ((type === 'mission' || type === 'challenge') && !wc) add('warn', mi, `${type === 'mission' ? '任务' : '挑战'}地图没有设胜利条件`, '任务和挑战地图需要 winCondition，常用“完成所有任务目标”。', { label: '设为完成所有目标', run: () => ed.setMapInfoProp('winCondition', 'requiredObjectives') });
    if (type === 'survival' && !objs.some((o) => lc(o.attrs.name) === 'attack_point')) add('warn', mi, '生存地图没有敌军出生点', '需要放至少一个名为 attack_point 的对象，敌人从那里出来。');
    if (type === 'survival' && !objProp(mi, 'survivalWaves')) add('info', mi, '生存地图没有自定义波次', '会使用游戏默认波次。可以在 map_info 里编辑波次。');
    if (lc(wc) === 'requiredobjectives' && !objs.some((o) => kindOf(o) === 'objective')) add('warn', mi, '胜利条件是“完成所有目标”，但没有任务目标', '用“新建 → 任务目标”添加。');
  }
  if (highTeam >= 10) out.push({ level: 'info', title: `触发器用到了第 ${highTeam + 1} 队`, detail: '普通房间只有 10 队，第 11 队以后的触发器会被游戏丢掉；需要支持更多玩家的服务器房间。' });
  if (nTrig && !out.some((x) => x.level === 'error' || x.level === 'warn')) out.push({ level: 'ok', title: `${nTrig} 个触发器，没发现问题` });
  return out;
}

// ---------------- 帮助条目 ----------------
Object.assign(HELP, {
  'trig.what': { t: '触发器是什么', s: '“当……就……”的规则', b: '每个触发器就是一条规则：<b>当</b>某件事发生（区域里有某队的单位、过了多少秒、另一个触发器成立）<b>就</b>做某件事（刷兵、加钱、显示文字）。<br>条件类（蓝色）负责“当”，动作类（橙色）负责“就”，用“被谁激活”把它们连起来。',
    tips: ['先用模板（城市争夺 / 生存 / 任务）生成一套，再改细节，最快。', '每张卡片顶上的一句话就是这条规则的意思，改完看一眼对不对。', '“逻辑图”能看到所有触发器怎么连在一起。'] },
  'trig.links': { t: '连接', s: '触发器之间怎么配合', b: '<b>被谁激活</b>：填的那些触发器成立时，这个才触发（多个时任一成立即可，勾“全部满足”则要都成立）。<br><b>同时激活</b>：这个成立时，下面那些也当作被激活。<br><b>被谁关闭</b>：那些成立时，这个暂停、不能触发。',
    tips: ['“被谁关闭”常用来做“没人占领时才刷守军”。', '名字区分不了大小写。'] },
  'trig.timing': { t: '时间', s: '延迟、持续、复位、重复', b: '<b>延迟</b>：开局后多久才可以触发（只算一次）。<br><b>持续</b>：条件要连续成立多久才算。<br><b>可以再次触发</b>：触发后多久复位。<b>不填就只触发一次</b>，之后一直保持“成立”。<br><b>重复间隔</b>：触发后每隔多久再做一次。',
    tips: ['时间写 20s 表示 20 秒；纯数字表示毫秒。', '想要“到时间以后、而且某条件成立”才触发，要勾“全部满足”。默认是“或”。'] },
  'trig.region': { t: '区域', s: '触发器在地图上的位置', b: '检测、删除、移动单位只看区域里面；刷兵、文字、镜头用区域的中心。选“画区域”工具在地图上拖一下就能新建；选中后拖动可以移动，拖右下角可以改大小。' },
  'trig.city': { t: '城市争夺模板', s: '城夺图的一座城', b: '在你点的位置生成一座“城市”需要的全部触发器：<ul><li>没人占领时自动刷中立守军；</li><li>检测每个队是否占领（区域里有该队建筑）；</li><li>占领期间按间隔给该队加钱；</li><li>城市名字随占领方变色。</li></ul>每座城都可以单独改。', tips: ['城市区域要盖住城里的建筑。', '队伍越多触发器越多（每队 3 个）。'] },
  'trig.survival': { t: '生存模板', s: '打一波一波的敌人', b: '把地图设成生存模式，编辑敌人波次，并放好敌军出生点（attack_point）。玩家的指挥中心全没了就输。' },
  'trig.mission': { t: '任务模板', s: '一步一步完成目标', b: '把地图设成任务模式（胜利条件：完成所有目标），按顺序生成目标：到达某地、消灭某地的敌人、坚守到某个时间。每一步完成后才会出现下一步的箭头提示。' },
  'trig.graph': { t: '逻辑图', s: '看所有触发器怎么连', b: '每个方块是一个触发器，颜色表示种类。<span style="color:#58a6ff">蓝</span>=条件，<span style="color:#e5793a">橙</span>=动作，<span style="color:#3fb950">绿</span>=文字，灰=中继/计时。绿线：激活；红色虚线：关闭。点方块跳到它的设置。' },
});

// ---------------- 状态 ----------------
const S = { view: 'list', filter: '', limit: 150, cat: 'all' };
export function selectTrigger(o, center = true) {
  ed.selected = o;
  if (o && center) { const c = centerTile(o); const v = rend.view; const s = rend.toScreen(c.x * TW, c.y * TW); if (s.x < 40 || s.y < 40 || s.x > rend.cw - 40 || s.y > rend.ch - 40) rend.centerOn(c.x, c.y, Math.max(v.z, 0.4)); }
  if (o && A.isMobile()) document.getElementById('dock').classList.remove('collapsed');
  rend.request();
  A.refresh('dock');
  document.getElementById('dockBody').scrollTop = 0;
}

// 选择触发器类型（新建时）
export function chooseType(title = '新建触发器') {
  const body = h('div', {});
  const groups = [['cond', '条件：“当……”'], ['logic', '逻辑'], ['act', '动作：“就……”'], ['text', '文字和目标'], ['special', '设置和标记']];
  const defs = { ...TYPES, ...SPECIAL, attack_point: BY_NAME.attack_point, camera_start: BY_NAME.camera_start };
  for (const [cat, title2] of groups) {
    body.append(h('div', { class: 'chkcat' }, title2));
    const g = h('div', { class: 'grid2' });
    for (const [k, d] of Object.entries(defs)) if (d.cat === cat) g.append(h('button', { class: 'acard tcard', style: `--tc:${CATS[cat].color}`, onclick: () => closeModal(k), html: icon(d.icon) + `<div><b>${d.cn}</b><small>${d.desc}</small></div>` }));
    body.append(g);
  }
  return modal(title, body, [{ label: '取消', value: null }], { wide: true });
}

export function createAt(type, rect) {
  return edit('新建' + (TYPES[type] || SPECIAL[type] || BY_NAME[type] || { cn: type }).cn, (T) => {
    let o;
    if (BY_NAME[type]) o = { attrs: { name: type, x: String(Math.round(rect.x)), y: String(Math.round(rect.y)), width: String(Math.round(rect.w || TW)), height: String(Math.round(rect.h || TW)) }, props: [{ name: 'comment', value: BY_NAME[type].cn }], extra: [] };
    else {
      const defaults = { unitAdd: { team: -1, spawnUnits: 'tank*1' }, unitDetect: { minUnits: 1 }, mapText: { text: '文字', textSize: 20 }, changeCredits: { team: 0, add: 100 }, objective: { text: '新目标' }, teamTagDetect: { team: 0 }, teamTags: { team: 0 }, team_info: { team: 0, credits: 4000 } }[type] || {};
      o = makeTrigger(type, rect, defaults);
    }
    T.objects.push(o);
    ed.selected = o;
    return o;
  });
}

// ---------------- 面板 ----------------
export function triggerPanel(body, T) {
  if (!ed.map) return;
  const sel = ed.selected && trigGroup() && trigGroup().objects.includes(ed.selected) ? ed.selected : null;
  if (sel && kindOf(sel) === 'map_info') {
    body.append(h('button', { style: 'margin-bottom:8px', onclick: () => { ed.selected = null; rend.request(); A.refresh('dock'); }, html: '‹ 返回列表' }), mapInfoCard());
    return;
  }
  if (sel) { body.append(editor(sel)); return; }
  body.append(h('div', { class: 'sech' }, h('h3', {}, '触发器（地图规则）'), helpBtn('trig.what')));
  body.append(mapInfoCard());
  body.append(h('div', { class: 'tplrow' },
    tplBtn('城市争夺', 'flag', () => cityTemplate()), tplBtn('生存模式', 'wave', () => survivalTemplate()),
    tplBtn('任务关卡', 'check', () => missionTemplate()), tplBtn('常用积木', 'trigger', () => blocksTemplate())));
  body.append(h('div', { class: 'row', style: 'margin:10px 0 8px' },
    h('button', { class: 'primary', onclick: async () => { const t = await chooseType(); if (t) { const c = viewCenterRect(); createAt(t, c); } }, html: icon('plus') + ' 新建' }),
    h('button', { onclick: () => graphView(), html: icon('rules') + ' 逻辑图' }), helpBtn('trig.graph'),
    h('button', { onclick: () => logDialog(), html: icon('log') + ' 作战日志' }),
    h('button', { class: 'ib', title: '在地图上画区域来新建', style: T === 'region' ? 'color:var(--accent2)' : '', onclick: () => { ed.tool.triggers = 'region'; A.refresh('toolbar', 'dock'); toast('在地图上拖出一个区域，然后选择触发器类型'); }, html: icon('region') })));
  const TG = trigGroup();
  const objs = TG ? TG.objects.filter((o) => kindOf(o) !== 'map_info') : [];
  if (!objs.length) {
    body.append(h('div', { class: 'hint', html: '还没有触发器。<b>普通对战图不需要触发器</b>，只要上面的“地图设置”。<br>想做城夺、生存、任务图，点上面的模板开始；或者选“画区域”工具在地图上拖一个区域。' }));
    return;
  }
  const issues = new Map();
  for (const it of triggerIssues()) if (it.obj && (it.level === 'error' || it.level === 'warn')) issues.set(it.obj, (issues.get(it.obj) || []).concat(it));
  const list = h('div', { class: 'tlist' });
  const inp = h('input', { placeholder: `搜索 ${objs.length} 个触发器（名字、文字、单位）`, value: S.filter, oninput: (e) => { S.filter = e.target.value; S.limit = 150; fill(); } });
  const cats = segmented([['all', '全部'], ['cond', '条件'], ['act', '动作'], ['text', '文字'], ['bad', '有问题']], S.cat, (v) => { S.cat = v; fill(); });
  const fill = () => {
    list.innerHTML = '';
    const q = lc(S.filter);
    let shown = 0, total = 0;
    for (const o of objs) {
      const def = defOf(o);
      if (S.cat === 'bad' ? !issues.has(o) : S.cat !== 'all' && (!def || (def.cat !== S.cat && !(S.cat === 'act' && def.cat === 'logic')))) continue;
      if (q && !(lc(label(o)) + lc(kindOf(o)) + o.props.map((p) => lc(p.value)).join(' ')).includes(q)) continue;
      total++;
      if (shown >= S.limit) continue;
      shown++;
      list.append(card(o, issues.get(o)));
    }
    if (total > shown) list.append(h('button', { onclick: () => { S.limit += 300; fill(); } }, `再显示 ${Math.min(300, total - shown)} 个（共 ${total} 个）`));
    if (!total) list.append(h('div', { class: 'hint' }, '没有符合条件的触发器。'));
  };
  body.append(inp, h('div', { style: 'margin:6px 0 8px' }, cats), list);
  fill();
}
const tplBtn = (lb, ic, fn) => h('button', { class: 'tpl', onclick: fn, html: icon(ic) + `<span>${lb}</span>` });
function viewCenterRect() {
  const c = rend.toMap(rend.cw / 2, rend.ch / 2);
  const x = Math.round(c.x / TW) * TW - TW, y = Math.round(c.y / TW) * TW - TW;
  return { x: Math.max(0, x), y: Math.max(0, y), w: TW * 3, h: TW * 3 };
}

function card(o, iss) {
  const def = defOf(o) || { cn: kindOf(o) || '对象', cat: 'logic', icon: 'info' };
  const col = CATS[def.cat] ? CATS[def.cat].color : '170,176,190';
  return h('button', { class: 'tcard2', style: `--tc:${col}`, onclick: () => selectTrigger(o) },
    h('div', { class: 'th', html: icon(def.icon) + `<b>${esc(label(o))}</b><span class="ty">${def.cn}</span>` + (iss ? `<span class="tw" title="${esc(iss.map((i) => i.title).join('\n'))}">${icon('warn')}</span>` : '') }),
    h('div', { class: 'td', html: describe(o) }));
}

// ---- map_info ----
function mapInfoCard() {
  const mi = ed.mapInfo();
  const box = h('div', { class: 'card micard' });
  if (!mi) {
    box.append(h('div', { class: 'hint warnh' }, '这张地图没有 map_info，游戏可能不能正常结算。'), h('button', { class: 'primary', style: 'margin-top:8px', onclick: () => { ed.ensureMapInfo(); A.refresh('dock'); } }, '一键补上'));
    return box;
  }
  const type = objProp(mi, 'type') || 'skirmish';
  const set = (k, v) => { ed.setMapInfoProp(k, v); A.autoDirty = true; A.refresh('dock', 'top'); };
  box.append(h('div', { class: 'sech' }, h('h3', {}, '地图设置（map_info）'), helpBtn('mapinfo')),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '地图类型'), select(MAP_TYPE_CN, type, (v) => set('type', v))),
      h('div', {}, h('label', {}, '胜利条件'), select(WIN_CONDITIONS, objProp(mi, 'winCondition') || '', (v) => set('winCondition', v)))),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '战争迷雾'), select([['', '按房间设置'], ['los', '视野'], ['map', '地图迷雾'], ['none', '无']], objProp(mi, 'fog') || '', (v) => set('fog', v))),
      h('div', {}, h('label', {}, ' '), toggle('盟友共享视野', objProp(mi, 'shareFogWithAllies') === 'true', (v) => set('shareFogWithAllies', v ? 'true' : '')))),
    h('label', {}, '开局介绍（introText）'),
    h('textarea', { rows: 2, placeholder: '开局时显示的说明文字', onchange: (e) => set('introText', e.target.value) }, objProp(mi, 'introText') || ''));
  if (type === 'survival') box.append(h('button', { style: 'margin-top:8px', onclick: () => wavesDialog(), html: icon('wave') + ' 编辑敌人波次…' }));
  return box;
}

// ---- 单个触发器编辑 ----
function editor(o) {
  const k = kindOf(o), def = defOf(o) || { cn: k || '对象', cat: 'logic', fields: [], icon: 'info' };
  const col = CATS[def.cat] ? CATS[def.cat].color : '170,176,190';
  const wrap = h('div', { class: 'teditor', style: `--tc:${col}` });
  const commit = (lb, fn) => edit(lb, () => fn(o));
  const r = rectOf(o);
  wrap.append(h('div', { class: 'row', style: 'margin-bottom:8px' },
    h('button', { onclick: () => { ed.selected = null; rend.request(); A.refresh('dock'); }, html: '‹ 返回列表' }), h('span', { style: 'flex:1' }),
    h('button', { class: 'ib', title: '复制一份', onclick: () => duplicate(o), html: icon('copy') }),
    h('button', { class: 'ib', title: '删除', onclick: () => remove(o), html: icon('del') })));
  wrap.append(h('div', { class: 'thead', html: icon(def.icon) + `<div><b>${def.cn}</b><small>${esc(def.desc || '')}</small></div>` }));
  if (isTrigger(o)) wrap.append(h('div', { class: 'tsentence', html: describe(o) }));
  const iss = triggerIssues().filter((i) => i.obj === o && i.level !== 'ok' && i.level !== 'info');
  for (const i of iss) wrap.append(h('div', { class: 'hint warnh', style: 'margin-bottom:8px' }, h('b', {}, i.title), h('div', {}, i.detail), i.fix ? h('button', { style: 'margin-top:6px', onclick: () => i.fix.run() }, i.fix.label) : null));
  // 名字
  const nameInp = h('input', { value: label(o), onchange: (e) => rename(o, e.target.value.trim()) });
  wrap.append(h('label', {}, k === 'point' ? '名字（“移动单位”的目标点填这个）' : '名字（别的触发器用它来引用）'), nameInp);
  if (TYPES[k]) wrap.append(h('div', { class: 'row', style: 'margin-top:6px' }, h('small', { style: 'color:var(--dim)' }, '类型'), select(Object.entries(TYPES).map(([t, d]) => [t, d.cn + ' · ' + t]), k, (v) => commit('改类型', (x) => { x.attrs.type = v; delete x.attrs.class; }))));
  // 字段
  if (def.fields && def.fields.length) {
    const f = h('div', { class: 'tfields' });
    for (const fd of def.fields) f.append(field(o, fd));
    wrap.append(section(def.cat === 'cond' ? '条件' : '设置', null, f));
  }
  if (isTrigger(o)) {
    // 连接
    const lk = h('div', {});
    for (const [p, cn, tip] of LINKS) lk.append(linkRow(o, p, cn, tip));
    lk.append(toggle('全部满足（被谁激活里的都成立、而且到了延迟时间、而且条件成立）', objProp(o, 'allToActivate') === 'true', (v) => commit('改全部满足', (x) => setP(x, 'allToActivate', v))));
    wrap.append(section('连接', 'trig.links', lk));
    const tm = h('div', { class: 'tfields' });
    for (const [p, cn, , tip] of TIMING) tm.append(timeField(o, p, cn, tip));
    wrap.append(section('时间', 'trig.timing', tm));
    const ms = h('div', { class: 'tfields' });
    for (const fd of MSG) ms.append(field(o, fd));
    wrap.append(section('消息和备注', null, ms));
  }
  // 区域
  wrap.append(section('区域', 'trig.region', h('div', { class: 'grid2' },
    numIn('左（格）', r.x / TW, (v) => commit('改区域', (x) => { x.attrs.x = String(Math.round(v * TW)); })),
    numIn('上（格）', r.y / TW, (v) => commit('改区域', (x) => { x.attrs.y = String(Math.round(v * TW)); })),
    numIn('宽（格）', r.w / TW, (v) => commit('改区域', (x) => { x.attrs.width = String(Math.max(0, Math.round(v * TW))); })),
    numIn('高（格）', r.h / TW, (v) => commit('改区域', (x) => { x.attrs.height = String(Math.max(0, Math.round(v * TW))); }))),
    h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { onclick: () => { A.regionFor = o; ed.tool.triggers = 'region'; A.refresh('toolbar'); toast('在地图上拖出新的区域'); }, html: icon('region') + ' 在地图上重画' }),
      h('button', { onclick: () => { const c = centerTile(o); rend.centerOn(c.x, c.y, Math.max(rend.view.z, 0.5)); }, html: icon('fit') + ' 跳过去' }))));
  // 其他属性（模板里没有列出的）
  const known = new Set(['id', ...(def.fields || []).map((f) => f[0]), ...LINKS.map((l) => l[0]), 'whenActivatedIds', 'activateIds', 'allToActivate', ...TIMING.map((t) => t[0]), ...MSG.map((m) => m[0])]);
  const extra = o.props.filter((p) => !known.has(p.name));
  const ex = h('div', {});
  for (const p of extra) ex.append(h('div', { class: 'kv' }, h('input', { value: p.name, disabled: true }), h('input', { value: p.value, onchange: (e) => commit('改属性', (x) => setP(x, p.name, e.target.value)) }), h('button', { class: 'ib', title: '删除', onclick: () => commit('删属性', (x) => setP(x, p.name, '')), html: icon('close') })));
  const nk = h('input', { placeholder: '属性名' }), nv = h('input', { placeholder: '值' });
  ex.append(h('div', { class: 'kv' }, nk, nv, h('button', { class: 'ib', title: '添加', onclick: () => { if (nk.value.trim()) commit('加属性', (x) => setP(x, nk.value.trim(), nv.value)); }, html: icon('plus') })));
  wrap.append(section('其他属性（高级）', null, ex));
  return wrap;
}
function section(title, help, ...kids) { return h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, title), help ? helpBtn(help) : null), ...kids); }
function numIn(lb, v, on) { return h('div', {}, h('label', {}, lb), h('input', { type: 'number', step: 0.5, value: Math.round(v * 10) / 10, onchange: (e) => on(+e.target.value || 0) })); }

function teamOptions(optional, unset = false) {
  const opts = [];
  if (optional) opts.push(['', '所有队伍']);
  else if (unset) opts.push(['', '（请选择）']);
  opts.push(['-1', '中立'], ['-2', '敌对中立（会主动攻击）']);
  for (let t = 0; t < MAX_TEAMS; t++) opts.push([String(t), `第 ${t + 1} 队${t >= 10 ? '（需大房间）' : ''}`]);
  return opts;
}
let dlId = 0;
function unitDatalist() {
  const id = 'units' + ++dlId;
  const names = [...new Set([...(ed.unitNames || []), ...KNOWN_UNITS])];
  return [id, h('datalist', { id }, names.map((n) => h('option', { value: n }, UNIT_CN[n] || '')))];
}
function field(o, [p, cn, kind, req, tip]) {
  const v = objProp(o, p);
  const commit = (val) => edit('修改' + cn, () => setP(o, p, val));
  const lb = h('label', {}, cn + (req ? ' *' : ''), tip ? h('small', { style: 'color:var(--dim);margin-left:6px' }, tip) : null);
  switch (kind) {
    case 'bool': return toggle(cn, v === 'true', (x) => commit(x));
    case 'int': return h('div', {}, lb, h('input', { type: 'number', value: v ?? '', onchange: (e) => commit(e.target.value.trim()) }));
    case 'team': case 'teamOpt': return h('div', {}, lb, select(teamOptions(kind === 'teamOpt', v === undefined), v ?? '', (x) => commit(x)));
    case 'color': {
      const c = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#ffffff', onchange: (e) => commit(e.target.value) });
      return h('div', {}, lb, h('div', { class: 'row' }, c, h('input', { value: v || '', placeholder: '#RRGGBB 或 red', style: 'flex:1;width:auto', onchange: (e) => commit(e.target.value.trim()) }), v ? h('button', { class: 'ib', title: '清除', onclick: () => commit(''), html: icon('close') }) : null));
    }
    case 'style': return h('div', {}, lb, select([['', '普通'], ['arrow', '带向下箭头']], v || '', (x) => commit(x)));
    case 'unit': { const [id, dl] = unitDatalist(); return h('div', {}, lb, h('input', { list: id, value: v || '', placeholder: '例如 supplyDepot', onchange: (e) => commit(e.target.value.trim()) }), dl); }
    case 'units': return h('div', {}, lb, unitsEditor(o, p));
    case 'point': {
      const pts = trigGroup().objects.filter((x) => kindOf(x) === 'point').map((x) => x.attrs.name);
      return h('div', {}, lb, h('div', { class: 'row' }, select([['', '（选一个目标点）'], ...pts.map((n) => [n, n])], v || '', (x) => commit(x)),
        h('button', { onclick: async () => { const pt = await pickOnMap('点地图放目标点'); if (!pt) return; const np = createAt('point', { x: pt.tx * TW, y: pt.ty * TW, w: TW, h: TW }); edit('设目标点', () => setP(o, p, np.attrs.name)); ed.selected = o; A.refresh('dock'); }, html: icon('plus') + ' 新目标点' })));
    }
    default: {
      const big = p === 'text' || p === 'globalMessage';
      const inp = h(big ? 'textarea' : 'input', { rows: 2, value: v || '', onchange: (e) => commit(e.target.value) });
      return h('div', {}, lb, inp, big ? langFields(o, p) : null);
    }
  }
}
// 其他语言版本：游戏读 text_zh、globalMessage_en 这样的属性，玩家看到自己语言的那一份
export const MAP_LANGS = [['zh', '中文'], ['en', 'English'], ['ru', 'Русский'], ['pt', 'Português'], ['es', 'Español'], ['in', 'Bahasa Indonesia'], ['tr', 'Türkçe'], ['uk', 'Українська'], ['fr', 'Français'], ['ja', '日本語']];
function langFields(o, p) {
  const have = MAP_LANGS.filter(([c]) => objProp(o, `${p}_${c}`) !== undefined).length;
  const box = h('details', { class: 'langs', open: have > 0 }, h('summary', {}, `其他语言版本${have ? `（已填 ${have} 种）` : ''}`));
  for (const [c, n] of MAP_LANGS) {
    const k = `${p}_${c}`;
    box.append(h('div', { class: 'langrow' }, h('span', {}, n), h('input', { value: objProp(o, k) || '', placeholder: '不填就用上面的', onchange: (e) => edit('修改' + n, () => setP(o, k, e.target.value)) })));
  }
  return box;
}
function timeField(o, p, cn, tip) {
  const v = objProp(o, p);
  const ms = parseTime(v);
  const unitIsS = v === undefined || /s$/i.test(String(v).trim()) && !/ms$/i.test(String(v).trim());
  const num = h('input', { type: 'number', min: 0, step: 'any', value: ms === null || Number.isNaN(ms) ? '' : unitIsS ? ms / 1000 : ms, placeholder: '不填', style: 'flex:1;width:auto' });
  const unit = select([['s', '秒'], ['ms', '毫秒']], unitIsS ? 's' : 'ms', () => save());
  const save = () => edit('修改' + cn, () => setP(o, p, num.value === '' ? '' : num.value + unit.value));
  num.addEventListener('change', save);
  unit.style.width = 'auto';
  return h('div', {}, h('label', {}, cn, h('small', { style: 'color:var(--dim);margin-left:6px' }, tip)), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, num, unit, Number.isNaN(ms) ? h('span', { style: 'color:var(--err)', title: v }, '格式错') : null));
}
function unitsEditor(o, p) {
  const list = parseUnits(objProp(o, p));
  if (!list.length) list.push({ name: '', n: 1, opts: '' });
  const box = h('div', { class: 'uedit' });
  const save = () => edit('修改刷兵单位', () => setP(o, p, formatUnits(list)));
  const [id, dl] = unitDatalist();
  list.forEach((u, i) => {
    box.append(h('div', { class: 'urow' },
      h('input', { list: id, value: u.name, placeholder: '单位名，如 tank', onchange: (e) => { u.name = e.target.value.trim(); save(); } }),
      h('span', {}, '×'), h('input', { type: 'number', min: 1, value: u.n, style: 'width:64px', onchange: (e) => { u.n = Math.max(1, +e.target.value || 1); save(); } }),
      h('button', { class: 'ib', title: '去掉', onclick: () => { list.splice(i, 1); save(); }, html: icon('close') })));
    if (u.opts) box.append(h('small', { style: 'color:var(--dim);display:block;margin:-2px 0 6px' }, `选项：${u.opts}`));
  });
  box.append(h('button', { onclick: () => { list.push({ name: 'tank', n: 1, opts: '' }); save(); }, html: icon('plus') + ' 再加一种' }), dl);
  return box;
}
function linkRow(o, p, cn, tip) {
  const arr = links(o, p);
  const chips = h('div', { class: 'chips' });
  for (const k of arr) {
    const target = findByKey(k);
    chips.append(h('span', { class: 'chip' + (target ? '' : ' bad'), title: target ? describe(target).replace(/<[^>]+>/g, '') : '找不到这个触发器' },
      h('button', { class: 'cl', onclick: () => target && selectTrigger(target) }, k),
      h('button', { class: 'cx', title: '去掉', onclick: () => edit('改连接', () => setP(o, p, listOf(objProp(o, p)).filter((r) => lc(r) !== lc(k)).join(','))), html: '×' })));
  }
  chips.append(h('button', { class: 'chip add', onclick: async () => {
    const pick = await pickTrigger(`选择“${cn}”的触发器`, o);
    if (pick) edit('改连接', () => setP(o, p, [...listOf(objProp(o, p)), label(pick)].join(',')));
  } }, '+ 添加'));
  return h('div', { class: 'linkrow' }, h('label', {}, cn, h('small', { style: 'color:var(--dim);margin-left:6px' }, tip)), chips);
}
function pickTrigger(title, self) {
  const objs = trigGroup().objects.filter((x) => x !== self && isTrigger(x));
  const list = h('div', { class: 'menulist', style: 'max-height:55vh;overflow:auto' });
  const inp = h('input', { placeholder: '搜索名字', oninput: () => fill() });
  const fill = () => {
    list.innerHTML = '';
    const q = lc(inp.value);
    for (const x of objs.filter((x) => !q || lc(label(x)).includes(q)).slice(0, 300)) {
      const d = defOf(x);
      list.append(h('button', { class: 'mitem', onclick: () => closeModal(x) }, h('span', { class: 'mi', style: `color:rgb(${CATS[d.cat].color})`, html: icon(d.icon) }), h('span', { class: 'ml' }, label(x), h('small', { style: 'display:block;color:var(--dim)', html: describe(x) }))));
    }
    if (!objs.length) list.append(h('div', { class: 'hint' }, '还没有别的触发器。先新建一个条件（比如“单位检测”）。'));
  };
  fill();
  setTimeout(() => inp.focus(), 40);
  return modal(title, h('div', {}, inp, list), [{ label: '取消', value: null }]);
}

function rename(o, nv) {
  if (!nv || nv === label(o)) return;
  if (/,/.test(nv)) { toast('名字里不能有逗号'); A.refresh('dock'); return; }
  const old = lc(label(o));
  const T = trigGroup();
  const refs = T.objects.filter((x) => x !== o && LINKS.some(([p]) => listOf(objProp(x, p)).some((r) => lc(r) === old)));
  const moves = T.objects.filter((x) => kindOf(o) === 'point' && lc(objProp(x, 'target')) === lc(o.attrs.name));
  edit('改名', () => {
    if (kindOf(o) !== 'point' || objProp(o, 'id') !== undefined) setP(o, 'id', nv);
    o.attrs.name = nv;
    for (const x of refs) for (const [p] of LINKS) { const l = listOf(objProp(x, p)); if (l.some((r) => lc(r) === old)) setP(x, p, l.map((r) => (lc(r) === old ? nv : r)).join(',')); }
    for (const x of moves) setP(x, 'target', nv);
  });
  if (refs.length + moves.length) toast(`已同时更新 ${refs.length + moves.length} 处引用`);
}
function duplicate(o) {
  edit('复制触发器', (T) => {
    const c = { attrs: { ...o.attrs }, props: o.props.map((p) => ({ ...p })), extra: o.extra };
    delete c.attrs.id;
    const nid = uniqueId(label(o).replace(/\d+$/, '') || '触发器');
    c.attrs.name = nid; if (objProp(c, 'id') !== undefined) setP(c, 'id', nid);
    c.attrs.x = String(+(o.attrs.x || 0) + TW); c.attrs.y = String(+(o.attrs.y || 0) + TW);
    T.objects.push(c); ed.selected = c;
  });
}
async function remove(o) {
  const old = lc(label(o));
  const refs = trigGroup().objects.filter((x) => x !== o && LINKS.some(([p]) => listOf(objProp(x, p)).some((r) => lc(r) === old)));
  if (refs.length && !(await confirmBox('删除触发器？', `有 ${refs.length} 个触发器连着「${label(o)}」。删除后这些连接也会去掉。`, '删除', '取消', true))) return;
  edit('删除触发器', (T) => {
    T.objects = T.objects.filter((x) => x !== o);
    for (const x of refs) for (const [p] of LINKS) { const l = listOf(objProp(x, p)); if (l.some((r) => lc(r) === old)) setP(x, p, l.filter((r) => lc(r) !== old).join(',')); }
    ed.selected = null;
  });
}

// ---------------- 在地图上点位置 ----------------
export function pickOnMap(msg) {
  return new Promise((resolve) => {
    const bar = h('div', { class: 'floatbar pickbar' }, h('span', { class: 'info', html: icon('region') + ' ' + msg }), h('button', { onclick: () => done(null) }, '取消'));
    document.getElementById('stage').append(bar);
    const done = (v) => { bar.remove(); A.pickPoint = null; if (A.isMobile()) document.getElementById('dock').classList.remove('collapsed'); resolve(v); };
    A.pickPoint = (tx, ty) => done({ tx, ty });
    if (A.isMobile()) document.getElementById('dock').classList.add('collapsed');
  });
}

// ---------------- 模板：城市争夺 ----------------
async function cityTemplate() {
  const teams = [...ed.usedTeams()].filter((t) => t >= 0).sort((a, b) => a - b);
  const st = { name: '城市' + ((trigGroup() ? trigGroup().objects.filter((o) => /_有建筑$/.test(label(o))).length : 0) + 1), teams: Math.max(2, teams.length ? teams[teams.length - 1] + 1 : 2), guard: 'turret*1', respawn: 20, income: 5, interval: 2, color: true, size: 3, textSize: 14 };
  const body = h('div', {},
    h('div', { class: 'hint', html: '生成一座城需要的触发器：没人占领时刷中立守军、检测各队占领、占领期间加钱、城市名随占领方变色。<b>点“下一步”后在地图上点城市的位置。</b>' }),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '城市名字'), h('input', { value: st.name, oninput: (e) => { st.name = e.target.value.trim() || '城市'; } })),
      h('div', {}, h('label', {}, '参与的队伍数'), h('input', { type: 'number', min: 1, max: MAX_TEAMS, value: st.teams, oninput: (e) => { st.teams = Math.max(1, Math.min(MAX_TEAMS, +e.target.value || 2)); } }))),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '中立守军（没人占领时刷）'), h('input', { value: st.guard, placeholder: '留空 = 不刷', oninput: (e) => { st.guard = e.target.value.trim(); } })),
      h('div', {}, h('label', {}, '守军多久刷一次（秒）'), h('input', { type: 'number', min: 1, value: st.respawn, oninput: (e) => { st.respawn = Math.max(1, +e.target.value || 20); } }))),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '占领收入（每次加多少，0 = 不加）'), h('input', { type: 'number', value: st.income, oninput: (e) => { st.income = +e.target.value || 0; } })),
      h('div', {}, h('label', {}, '每隔几秒加一次'), h('input', { type: 'number', min: 1, value: st.interval, oninput: (e) => { st.interval = Math.max(1, +e.target.value || 2); } }))),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '城市区域大小（格）'), h('input', { type: 'number', min: 1, max: 30, value: st.size, oninput: (e) => { st.size = Math.max(1, Math.min(30, +e.target.value || 3)); } })),
      h('div', {}, h('label', {}, ' '), toggle('城市名随占领方变色', st.color, (v) => { st.color = v; }))),
    h('div', { class: 'hint', style: 'margin-top:8px', html: '城市里的建筑要你自己放（单位模式），区域要盖住它。占领 = 区域里有该队的建筑。<br>每个队伍 3 个触发器。<b>普通房间只认前 10 队</b>，在大房间（服务器）玩才需要更多。' }));
  const ok = await modal('城市争夺模板', body, [{ label: '取消', value: false }, { label: '下一步：点地图放城市', value: true, primary: true }]);
  if (!ok) return;
  const pt = await pickOnMap(`点地图放「${st.name}」`);
  if (!pt) return;
  const n = st.teams;
  const half = Math.floor(st.size / 2);
  const rect = { x: (pt.tx - half) * TW, y: (pt.ty - half) * TW, w: st.size * TW, h: st.size * TW };
  const p = st.name.replace(/[,\s]+/g, '_');
  const made = edit(`城市模板：${st.name}`, (T) => {
    const taken = allKeys();
    const out = [];
    const id = (s) => uniqueId(s, taken);
    const has = id(`${p}_有建筑`);
    out.push(makeTrigger('unitDetect', rect, { onlyBuildings: 'true', minUnits: 1, resetActivationAfter: st.respawn + 's', comment: '区域里有任何建筑' }, has, new Set()));
    if (st.guard) out.push(makeTrigger('unitAdd', rect, { team: -1, spawnUnits: st.guard, deactivatedBy: has, warmup: st.respawn + 's', resetActivationAfter: st.respawn + 's', comment: '没人占领时刷中立守军' }, id(`${p}_守军`), new Set()));
    const owners = [];
    for (let k = 0; k < n; k++) {
      const ow = id(`${p}_归属${k + 1}`); owners.push(ow);
      out.push(makeTrigger('unitDetect', rect, { team: k, onlyBuildings: 'true', minUnits: 1, resetActivationAfter: '1s', comment: `第 ${k + 1} 队占领` }, ow, new Set()));
      if (st.income) out.push(makeTrigger('changeCredits', rect, { team: k, add: st.income, activatedBy: ow, resetActivationAfter: st.interval + 's' }, id(`${p}_收入${k + 1}`), new Set()));
      if (st.color) out.push(makeTrigger('mapText', rect, { text: st.name, textColor: teamHex(k), textSize: st.textSize, activatedBy: ow, resetActivationAfter: '1s' }, id(`${p}_名字${k + 1}`), new Set()));
    }
    out.push(makeTrigger('mapText', rect, st.color ? { text: st.name, textSize: st.textSize, deactivatedBy: owners.join(','), resetActivationAfter: '1s' } : { text: st.name, textSize: st.textSize }, id(`${p}_名字`), new Set()));
    for (const o of out) T.objects.push(o);
    return out;
  });
  toast(`已生成「${st.name}」的 ${made.length} 个触发器。在单位模式里给城市放建筑。`, 4200);
  A.hooks.coach && A.hooks.coach('trig:template');
  ed.selected = null; A.refresh('dock');
}

// ---------------- 模板：生存 ----------------
function parseWaves(s) {
  const out = [];
  for (const line of String(s || '').split(/\n/)) {
    const m = line.trim().match(/^\+\s*([\d:]+)\s*([^[\-]*?)\s*(?:\[([^\]]*)\])?\s*(?:-\s*(.*))?$/);
    if (!m) continue;
    out.push({ gap: m[1], title: (m[2] || '').trim(), opts: (m[3] || '').trim(), units: (m[4] || '').trim() });
  }
  return out;
}
function formatWaves(list) { return list.map((w) => `+${w.gap || '1:00'}${w.title ? ' ' + w.title : ''}${w.opts ? ` [${w.opts}]` : ''}${w.units ? ' - ' + w.units : ''}`).join('\n'); }
async function wavesDialog() {
  const mi = ed.ensureMapInfo();
  let list = parseWaves(objProp(ed.mapInfo(), 'survivalWaves'));
  if (!list.length) list = [{ gap: '1:00', title: '第一波', units: '3 tank', opts: '' }, { gap: '1:30', title: '第二波', units: '5 tank, 2 heavyTank', opts: '' }, { gap: '2:00', title: '最终波', units: '8 tank, 4 heavyTank', opts: '' }];
  const box = h('div', {});
  const draw = () => {
    box.innerHTML = '';
    box.append(h('div', { class: 'hint', html: '每一行是一波敌人。<b>间隔</b>是离上一波多久（分:秒）；<b>敌人</b>写“数量 单位名”，多个用逗号隔开，例如 <code>5 tank, 2 heavyTank</code>。' }));
    const tb = h('table', { class: 'rep' }, h('tr', {}, h('th', {}, '#'), h('th', {}, '间隔'), h('th', {}, '标题'), h('th', {}, '敌人'), h('th', {}, '打完算赢'), h('th', {}, '')));
    list.forEach((w, i) => tb.append(h('tr', {}, h('td', {}, i + 1),
      h('td', {}, h('input', { value: w.gap, style: 'width:64px', oninput: (e) => { w.gap = e.target.value.trim(); } })),
      h('td', {}, h('input', { value: w.title, oninput: (e) => { w.title = e.target.value; } })),
      h('td', {}, h('input', { value: w.units, oninput: (e) => { w.units = e.target.value; } })),
      h('td', {}, h('input', { type: 'checkbox', checked: /\bwin\b/.test(w.opts), style: 'width:auto', onchange: (e) => { const o = w.opts.split(',').map((s) => s.trim()).filter((s) => s && s !== 'win'); if (e.target.checked) o.push('win'); w.opts = o.join(', '); } })),
      h('td', {}, h('button', { class: 'ib', onclick: () => { list.splice(i, 1); draw(); }, html: icon('close') })))));
    box.append(h('div', { style: 'overflow:auto;margin:8px 0' }, tb), h('button', { onclick: () => { list.push({ gap: '1:30', title: `第${list.length + 1}波`, units: '5 tank', opts: '' }); draw(); }, html: icon('plus') + ' 加一波' }));
  };
  draw();
  const ok = await modal('敌人波次（survivalWaves）', box, [{ label: '取消', value: false }, { label: '保存', value: true, primary: true }], { wide: true });
  if (ok) { ed.setMapInfoProp('survivalWaves', formatWaves(list)); A.autoDirty = true; A.refresh('dock'); toast('波次已保存'); }
  return mi;
}
async function survivalTemplate() {
  const st = { points: 4 };
  const ok = await modal('生存模式模板', h('div', {},
    h('div', { class: 'hint', html: '把地图设成<b>生存模式</b>：敌人一波一波从“敌军出生点”出来，玩家的指挥中心全没了就输。' }),
    h('label', {}, '敌军出生点数量（自动放在离玩家最远的地图边缘，之后可以拖动）'),
    h('input', { type: 'number', min: 1, max: 16, value: st.points, oninput: (e) => { st.points = Math.max(1, Math.min(16, +e.target.value || 4)); } })),
  [{ label: '取消', value: false }, { label: '生成', value: true, primary: true }]);
  if (!ok) return;
  ed.setMapInfoProp('type', 'survival');
  const m = ed.map, W = m.width, H = m.height, sp = ed.spawns();
  const cands = [];
  const step = Math.max(4, Math.floor((W + H) / 60));
  for (let x = 4; x < W - 4; x += step) cands.push([x, 3], [x, H - 4]);
  for (let y = 4; y < H - 4; y += step) cands.push([3, y], [W - 4, y]);
  const score = ([x, y]) => sp.length ? Math.min(...sp.map((s) => Math.hypot(s.cx / TW - x, s.cy / TW - y))) : Math.hypot(x - W / 2, y - H / 2);
  const chosen = [];
  cands.sort((a, b) => score(b) - score(a));
  for (const c of cands) { if (chosen.length >= st.points) break; if (chosen.every((d) => Math.hypot(d[0] - c[0], d[1] - c[1]) > Math.max(10, (W + H) / 10))) chosen.push(c); }
  edit('生存模板', (T) => { for (const [x, y] of chosen) T.objects.push({ attrs: { name: 'attack_point', x: String((x - 1) * TW), y: String((y - 1) * TW), width: String(3 * TW), height: String(3 * TW) }, props: [{ name: 'comment', value: '敌军出生点' }], extra: [] }); });
  await wavesDialog();
  toast(`已设为生存模式，放了 ${chosen.length} 个敌军出生点`, 3600);
  A.hooks.coach && A.hooks.coach('trig:template');
}

// ---------------- 模板：任务 ----------------
async function missionTemplate() {
  const steps = [{ kind: 'reach', text: '到达指定地点', team: 0, enemy: 1 }, { kind: 'destroyCC', text: '摧毁敌方指挥中心', team: 0, enemy: 1 }];
  const box = h('div', {});
  const kinds = [['reach', '到达某个地方'], ['destroyCC', '摧毁那里的敌方指挥中心'], ['clear', '消灭那里的所有敌人'], ['hold', '坚守到开局后第 N 秒']];
  const draw = () => {
    box.innerHTML = '';
    box.append(h('div', { class: 'hint', html: '把地图设成<b>任务模式</b>（胜利条件：完成所有目标）。目标<b>按顺序</b>出现：完成上一个才会出现下一个的箭头提示。生成后，把每个目标的区域拖到你想要的位置。' }));
    steps.forEach((s, i) => box.append(h('div', { class: 'card', style: 'margin-top:8px' },
      h('div', { class: 'row' }, h('b', {}, `第 ${i + 1} 步`), h('span', { style: 'flex:1' }), h('button', { class: 'ib', onclick: () => { steps.splice(i, 1); draw(); }, html: icon('close') })),
      h('div', { class: 'grid2' },
        h('div', {}, h('label', {}, '要做什么'), select(kinds, s.kind, (v) => { s.kind = v; draw(); })),
        h('div', {}, h('label', {}, '目标文字'), h('input', { value: s.text, oninput: (e) => { s.text = e.target.value; } }))),
      s.kind === 'hold' ? h('div', {}, h('label', {}, '第几秒（开局起算）'), h('input', { type: 'number', min: 1, value: s.sec || 300, oninput: (e) => { s.sec = Math.max(1, +e.target.value || 300); } }))
        : h('div', { class: 'grid2' },
          h('div', {}, h('label', {}, '玩家队伍'), select(teamOptions(false), String(s.team), (v) => { s.team = +v; })),
          s.kind !== 'reach' ? h('div', {}, h('label', {}, '敌方队伍'), select(teamOptions(false), String(s.enemy), (v) => { s.enemy = +v; })) : h('div')))));
    box.append(h('button', { style: 'margin-top:8px', onclick: () => { steps.push({ kind: 'reach', text: '新目标', team: 0, enemy: 1 }); draw(); }, html: icon('plus') + ' 加一步' }));
  };
  draw();
  const ok = await modal('任务关卡模板', box, [{ label: '取消', value: false }, { label: '生成', value: true, primary: true }], { wide: true });
  if (!ok || !steps.length) return;
  ed.setMapInfoProp('type', 'mission');
  ed.setMapInfoProp('winCondition', 'requiredObjectives');
  const c = viewCenterRect();
  const made = edit('任务模板', (T) => {
    const taken = allKeys();
    let prev = null; const out = [];
    steps.forEach((s, i) => {
      const gap = Math.max(6, Math.round(Math.min(ed.map.width, ed.map.height) / (steps.length + 2)));
      const r = { x: Math.max(0, c.x + Math.round((i - (steps.length - 1) / 2) * gap) * TW), y: c.y, w: TW * 4, h: TW * 4 };
      const dId = uniqueId(`目标${i + 1}_条件`, taken), oId = uniqueId(`目标${i + 1}`, taken);
      const chain = prev ? { activatedBy: prev, allToActivate: 'true' } : {};
      let det;
      if (s.kind === 'hold') det = makeTrigger('basic', r, { delay: (s.sec || 300) + 's', ...chain }, dId, new Set());
      else if (s.kind === 'reach') det = makeTrigger('unitDetect', r, { team: s.team, minUnits: 1, ...chain }, dId, new Set());
      else if (s.kind === 'destroyCC') det = makeTrigger('unitDetect', r, { team: s.enemy, unitType: 'commandCenter', maxUnits: 0, ...chain }, dId, new Set());
      else det = makeTrigger('unitDetect', r, { team: s.enemy, maxUnits: 0, ...chain }, dId, new Set());
      const obj = makeTrigger('objective', r, { text: s.text, activatedBy: dId, globalMessage: `完成：${s.text}` }, oId, new Set());
      const arrow = makeTrigger('mapText', r, { text: s.text, style: 'arrow', textColor: '#ffd34d', deactivatedBy: oId, ...(prev ? { activatedBy: prev, resetActivationAfter: '1s' } : {}) }, uniqueId(`目标${i + 1}_箭头`, taken), new Set());
      out.push(det, obj, arrow);
      prev = oId;
    });
    for (const o of out) T.objects.push(o);
    return out;
  });
  toast(`已生成 ${steps.length} 个目标（${made.length} 个触发器）。把各目标的区域拖到想要的位置。`, 4200);
  A.hooks.coach && A.hooks.coach('trig:template');
}

// ---------------- 常用积木 ----------------
async function blocksTemplate() {
  const items = [
    ['money', 'coin', '开局资金', '每个队开局的钱（team_info）'],
    ['wave', 'wave', '定时刷兵', '开局 N 秒后在这里刷敌人，之后每隔 M 秒再刷'],
    ['enter', 'eye', '进入区域提示', '某队的单位走进区域时弹出一句话'],
    ['text', 'text', '地图文字', '在地图上一直显示一行字'],
    ['income', 'coin', '占点加钱', '某个点被谁占着就一直给谁加钱（每队一条）'],
    ['timer', 'clock', '倒计时消息', '开局后第 N 秒在作战日志里提示'],
    ['reinforce', 'units', '定时援军', '每个队的出生点定时来一批援军'],
    ['hold', 'flag', '据点争夺', '守住据点一段时间就给钱并在作战日志里播报'],
    ['camp', 'wave', '中立野怪营地', '一片区域里的敌对中立守军被清空后，过一会儿重新刷出来'],
  ];
  const body = h('div', { class: 'grid2' });
  for (const [id, ic, t, d] of items) body.append(h('button', { class: 'acard', onclick: () => closeModal(id), html: icon(ic) + `<div><b>${t}</b><small>${d}</small></div>` }));
  const pick = await modal('常用积木', body, [{ label: '取消', value: null }], { wide: true });
  if (!pick) return;
  const teams = Math.max(1, Math.max(-1, ...ed.usedTeams()) + 1);
  if (pick === 'reinforce') {
    const sp = ed.spawns().filter((x) => x.team >= 0);
    if (!sp.length) { toast('地图上还没有出生点'); return; }
    edit('定时援军', (TT) => { const tk = allKeys(); for (const x of sp) TT.objects.push(makeTrigger('unitAdd', { x: x.cx - 40, y: x.cy + 40, w: 80, h: 40 }, { team: x.team, spawnUnits: 'tank*3', delay: '120s', repeatDelay: '180s', globalMessage: `第 ${x.team + 1} 队的援军到了`, globalMessage_textColor: teamHex(x.team) }, `援军${x.team + 1}`, tk)); });
    toast(`已给 ${sp.length} 个队加上定时援军（开局 2 分钟后，每 3 分钟一批）`, 3600); return;
  }
  if (pick === 'money') {
    const v = await numberAsk('开局资金', '每个队开局多少钱', 4000); if (v === null) return;
    edit('开局资金', (T) => { const taken = allKeys(); for (let k = 0; k < teams; k++) T.objects.push(makeTrigger('team_info', { x: -60, y: k * TW, w: TW, h: TW }, { team: k, credits: v }, `队伍设置${k + 1}`, taken)); });
    toast(`已给 ${teams} 个队设置开局资金 ${v}`);
    return;
  }
  const pt = await pickOnMap('点地图选位置');
  if (!pt) return;
  const r = { x: (pt.tx - 1) * TW, y: (pt.ty - 1) * TW, w: TW * 3, h: TW * 3 };
  const add = (lb, fn) => { const o = edit(lb, (T) => { const list = fn(allKeys()); for (const x of list) T.objects.push(x); return list[0]; }); selectTrigger(o, false); };
  if (pick === 'wave') add('定时刷兵', (tk) => [makeTrigger('unitAdd', r, { team: -2, spawnUnits: 'tank*3', delay: '60s', repeatDelay: '90s', globalMessage: '敌人来袭！', globalMessage_textColor: 'red' }, '刷兵', tk)]);
  if (pick === 'enter') add('进入区域提示', (tk) => [makeTrigger('unitDetect', r, { team: 0, minUnits: 1, globalMessage: '你发现了一个秘密地点！' }, '进入区域', tk)]);
  if (pick === 'text') add('地图文字', (tk) => [makeTrigger('mapText', r, { text: '这里是…', textSize: 20 }, '文字', tk)]);
  if (pick === 'timer') add('倒计时消息', (tk) => [makeTrigger('basic', { ...r, x: -60 }, { delay: '300s', globalMessage: '还剩 5 分钟！' }, '计时', tk)]);
  if (pick === 'hold') add('据点争夺', (tk) => {
    const out = [];
    for (let k = 0; k < teams; k++) {
      const ow = uniqueId(`据点${k + 1}`, tk);
      out.push(makeTrigger('unitDetect', r, { team: k, minUnits: 1, warmup: '30s', resetActivationAfter: '60s', globalMessage: `第 ${k + 1} 队守住了据点！`, globalMessage_textColor: teamHex(k) }, ow, new Set()));
      out.push(makeTrigger('changeCredits', r, { team: k, add: 500, activatedBy: ow }, `据点奖励${k + 1}`, tk));
    }
    out.push(makeTrigger('mapText', r, { text: '据点', textSize: 18, style: 'arrow', textColor: '#ffd34d' }, '据点名字', tk));
    return out;
  });
  if (pick === 'camp') add('中立野怪营地', (tk) => {
    const id0 = uniqueId('营地清空', tk);
    return [makeTrigger('unitDetect', r, { team: -2, maxUnits: 0, resetActivationAfter: '90s' }, id0, new Set()),
      makeTrigger('unitAdd', r, { team: -2, spawnUnits: 'tank*2, c_turret_t1*1', activatedBy: id0, warmup: '60s', resetActivationAfter: '90s' }, '营地守军', tk)];
  });
  if (pick === 'income') add('占点加钱', (tk) => {
    const out = [];
    for (let k = 0; k < teams; k++) {
      const ow = uniqueId(`占点${k + 1}`, tk);
      out.push(makeTrigger('unitDetect', r, { team: k, onlyBuildings: 'true', minUnits: 1, resetActivationAfter: '1s' }, ow, new Set()));
      out.push(makeTrigger('changeCredits', r, { team: k, add: 5, activatedBy: ow, resetActivationAfter: '2s' }, `加钱${k + 1}`, tk));
    }
    return out;
  });
}
function numberAsk(title, lb, v) {
  const inp = h('input', { type: 'number', value: v });
  return modal(title, h('div', {}, h('label', {}, lb), inp), [{ label: '取消', value: null }, { label: '确定', value: () => +inp.value || 0, primary: true }]);
}

// ---------------- 逻辑图 ----------------
export function graphView() {
  const T = trigGroup();
  const objs = T ? T.objects.filter(isTrigger) : [];
  if (!objs.length) { toast('还没有触发器'); return; }
  const shown = objs.slice(0, 600);
  const idx = new Map(); shown.forEach((o, i) => { const k = tkey(o); if (!idx.has(k)) idx.set(k, i); });
  const edges = [];
  shown.forEach((o, i) => {
    for (const k of links(o, 'activatedBy')) if (idx.has(lc(k))) edges.push([idx.get(lc(k)), i, 'on']);
    for (const k of links(o, 'alsoActivate')) if (idx.has(lc(k)) && idx.get(lc(k)) !== i) edges.push([i, idx.get(lc(k)), 'on']);
    for (const k of links(o, 'deactivatedBy')) if (idx.has(lc(k))) edges.push([idx.get(lc(k)), i, 'off']);
  });
  // 层次：最长路径（有环时限制迭代次数）
  const depth = new Int32Array(shown.length);
  for (let it = 0; it < 24; it++) { let ch = false; for (const [a, b] of edges) if (a !== b && depth[b] < depth[a] + 1 && depth[a] < 20) { depth[b] = depth[a] + 1; ch = true; } if (!ch) break; }
  const cols = new Map();
  shown.forEach((o, i) => { const d = depth[i]; if (!cols.has(d)) cols.set(d, []); cols.get(d).push(i); });
  const NW = 190, NH = 52, GX = 70, GY = 14;
  const pos = new Array(shown.length);
  let maxY = 0;
  for (const [d, list] of [...cols].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => rectOf(shown[a]).y - rectOf(shown[b]).y || rectOf(shown[a]).x - rectOf(shown[b]).x);
    list.forEach((i, r) => { pos[i] = [20 + d * (NW + GX), 20 + r * (NH + GY)]; maxY = Math.max(maxY, pos[i][1] + NH); });
  }
  const Wd = 20 + (Math.max(...cols.keys()) + 1) * (NW + GX), Hd = maxY + 20;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', Wd); svg.setAttribute('height', Hd); svg.setAttribute('class', 'tgraph');
  let s = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#3fb950"/></marker><marker id="ahr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#f2545b"/></marker></defs>`;
  for (const [a, b, kind] of edges) {
    const [ax, ay] = pos[a], [bx, by] = pos[b];
    const x1 = ax + NW, y1 = ay + NH / 2, x2 = bx, y2 = by + NH / 2;
    const back = x2 <= x1;
    const d = back ? `M${x1} ${y1} C${x1 + 60} ${y1 - 40}, ${x2 - 60} ${y2 - 40}, ${x2} ${y2}` : `M${x1} ${y1} C${x1 + 35} ${y1}, ${x2 - 35} ${y2}, ${x2} ${y2}`;
    s += `<path d="${d}" fill="none" stroke="${kind === 'off' ? '#f2545b' : '#3fb950'}" stroke-width="1.6" ${kind === 'off' ? 'stroke-dasharray="5 4"' : ''} marker-end="url(#${kind === 'off' ? 'ahr' : 'ah'})" opacity=".85"/>`;
  }
  shown.forEach((o, i) => {
    const [x, y] = pos[i], def = defOf(o), col = CATS[def.cat].color;
    const sub = describe(o).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '');
    s += `<g class="gn" data-i="${i}" transform="translate(${x},${y})"><rect width="${NW}" height="${NH}" rx="8" fill="rgba(${col},.16)" stroke="rgb(${col})" stroke-width="1.4"/>` +
      `<rect width="5" height="${NH}" rx="2" fill="rgb(${col})"/>` +
      `<text x="12" y="19" font-size="12.5" font-weight="600" fill="#e6e8ec">${esc(label(o).slice(0, 13))}</text>` +
      `<text x="12" y="37" font-size="11" fill="#9aa1ad">${esc(def.cn)} · ${esc(sub.slice(0, 11))}${sub.length > 11 ? '…' : ''}</text></g>`;
  });
  svg.innerHTML = s;
  svg.addEventListener('click', (e) => { const g = e.target.closest('.gn'); if (!g) return; closeModal(); selectTrigger(shown[+g.dataset.i]); });
  const legend = h('div', { class: 'row', style: 'margin-bottom:8px;font-size:12px;color:var(--muted)', html: Object.values(CATS).map((c) => `<span><span class="teamdot" style="background:rgb(${c.color})"></span>${c.cn}</span>`).join(' ') + ' <span style="color:#3fb950">━ 激活</span> <span style="color:#f2545b">┅ 关闭</span>' + (objs.length > shown.length ? ` <span>（只显示前 ${shown.length} 个）</span>` : '') });
  modal(`逻辑图（${objs.length} 个触发器，点方块编辑）`, h('div', {}, legend, h('div', { class: 'gwrap' }, svg)), [{ label: '关闭', value: 1 }], { full: true });
}

// ---------------- 文字工具 ----------------
export async function textAt(px, py) {
  const st = { text: '', color: '#ffffff', size: 20, arrow: false };
  const inp = h('textarea', { rows: 2, placeholder: '要显示的文字' });
  const r = await modal('在这里写字', h('div', {},
    h('label', {}, '文字'), inp,
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '颜色'), h('input', { type: 'color', value: st.color, oninput: (e) => { st.color = e.target.value; } })),
      h('div', {}, h('label', {}, '字号'), h('input', { type: 'number', min: 5, max: 80, value: st.size, oninput: (e) => { st.size = Math.max(5, Math.min(80, +e.target.value || 20)); } }))),
    toggle('下面带一个箭头（指示目标）', false, (v) => { st.arrow = v; }),
    h('div', { class: 'hint', style: 'margin-top:8px' }, '写好后可以在触发器列表里改，或者填其他语言的版本、设置“什么时候显示”。')),
  [{ label: '取消', value: null }, { label: '放上去', value: () => inp.value.trim(), primary: true }]);
  setTimeout(() => inp.focus(), 30);
  if (!r) return;
  const w = Math.max(2, Math.min(12, Math.ceil(r.length * st.size / 2 / TW)));
  const rect = { x: Math.max(0, Math.round(px / TW - w / 2) * TW), y: Math.max(0, Math.floor(py / TW) * TW), w: w * TW, h: TW };
  const o = edit('放文字', (T) => { const t = makeTrigger('mapText', rect, { text: r, textColor: st.color, textSize: st.size, style: st.arrow ? 'arrow' : '' }, '文字'); T.objects.push(t); return t; });
  selectTrigger(o, false);
  A.hooks.coach && A.hooks.coach('text');
}

// ---------------- 作战日志编辑器 ----------------
function whenOf(o) {
  const d = parseTime(objProp(o, 'delay'));
  const ab = links(o, 'activatedBy');
  const c = condText(o).replace(/<[^>]+>/g, '');
  const parts = [];
  if (d !== null) parts.push(`开局 ${fmtTime(d)}`);
  if (ab.length) parts.push(`「${ab.join('」「')}」成立时`);
  if (c) parts.push(c);
  return { text: parts.join('，') || '开局时', sort: d !== null ? d : ab.length || c ? 1e12 : 0 };
}
export async function logDialog() {
  const T = trigGroup(true);
  const box = h('div', {});
  const draw = () => {
    box.innerHTML = '';
    const rows = T.objects.filter((o) => isTrigger(o) && objProp(o, 'globalMessage')).map((o) => ({ o, w: whenOf(o) })).sort((a, b) => a.w.sort - b.w.sort);
    box.append(h('div', { class: 'hint', html: '游戏里滚动显示的那些消息。按时间排好，<b>开局第几秒</b>的在前，<b>满足条件时</b>的在后。每条可以直接改文字和颜色。' }));
    const tb = h('table', { class: 'rep logtb' }, h('tr', {}, h('th', {}, '什么时候'), h('th', {}, '消息'), h('th', {}, '颜色'), h('th', {}, '打字速度'), h('th', {}, '')));
    for (const { o, w } of rows) {
      tb.append(h('tr', {},
        h('td', { style: 'min-width:120px' }, w.text, h('small', { style: 'display:block;color:var(--dim)' }, label(o))),
        h('td', {}, h('input', { value: objProp(o, 'globalMessage'), onchange: (e) => { edit('改作战日志', () => setP(o, 'globalMessage', e.target.value)); } })),
        h('td', {}, h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(objProp(o, 'globalMessage_textColor') || '') ? objProp(o, 'globalMessage_textColor') : '#ffffff', style: 'width:44px;padding:0', onchange: (e) => edit('改颜色', () => setP(o, 'globalMessage_textColor', e.target.value)) })),
        h('td', {}, select([['', '一下子显示'], ['0.03s', '快'], ['0.06s', '中'], ['slow', '慢']], objProp(o, 'globalMessage_delayPerChar') || '', (v) => edit('改打字速度', () => setP(o, 'globalMessage_delayPerChar', v)))),
        h('td', {}, h('button', { class: 'ib', title: '去掉这条消息', onclick: () => { edit('删作战日志', () => setP(o, 'globalMessage', '')); draw(); }, html: icon('close') }),
          h('button', { class: 'ib', title: '编辑这个触发器', onclick: () => { closeModal(); selectTrigger(o); }, html: icon('settings') }))));
    }
    if (!rows.length) tb.append(h('tr', {}, h('td', { colspan: 5, style: 'color:var(--dim)' }, '还没有消息。用下面的按钮加一条。')));
    box.append(h('div', { style: 'overflow:auto;margin:8px 0' }, tb));
    box.append(h('div', { class: 'row' },
      h('button', { onclick: async () => {
        const sec2 = await numberAsk('开局第几秒', '秒数', 60); if (sec2 === null) return;
        edit('加作战日志', (TT) => TT.objects.push(makeTrigger('basic', { x: -60, y: 0, w: TW, h: TW }, { delay: sec2 + 's', globalMessage: `第 ${sec2} 秒` }, '日志'))); draw();
      }, html: icon('timer') + ' 开局第 N 秒' }),
      h('button', { onclick: async () => {
        closeModal(); const pt = await pickOnMap('点地图选区域'); if (!pt) return;
        const r = { x: (pt.tx - 2) * TW, y: (pt.ty - 2) * TW, w: 5 * TW, h: 5 * TW };
        edit('加作战日志', (TT) => TT.objects.push(makeTrigger('unitDetect', r, { team: 0, minUnits: 1, globalMessage: '发现了新地点！' }, '进入区域'))); logDialog();
      }, html: icon('region') + ' 有人进入区域时' }),
      h('button', { onclick: async () => {
        const pick = await pickTrigger('哪个触发器成立时说话？', null); if (!pick) return;
        edit('加作战日志', () => setP(pick, 'globalMessage', objProp(pick, 'globalMessage') || '……')); draw();
      }, html: icon('link') + ' 某个触发器成立时' })));
  };
  draw();
  await modal('作战日志', box, [{ label: '关闭', value: 1, primary: true }], { wide: true });
}

// ---------------- 注册 ----------------
export function initTriggers() {
  A.hooks.triggerPanel = triggerPanel;
  A.hooks.triggerIssues = triggerIssues;
  A.hooks.removeTrigger = remove;
  A.hooks.textAt = textAt;
  A.hooks.regionDrawn = async (r) => {
    if (r.w < TW / 2 || r.h < TW / 2) { r.w = Math.max(r.w, TW); r.h = Math.max(r.h, TW); }
    if (A.regionFor && trigGroup() && trigGroup().objects.includes(A.regionFor)) {
      const o = A.regionFor; A.regionFor = null;
      edit('重画区域', () => { o.attrs.x = String(r.x); o.attrs.y = String(r.y); o.attrs.width = String(r.w); o.attrs.height = String(r.h); });
      ed.tool.triggers = 'select'; selectTrigger(o, false); A.refresh('toolbar');
      return;
    }
    A.pendingRect = r; rend.request();
    const t = await chooseType('这个区域做什么？');
    A.pendingRect = null;
    if (t) { createAt(t, r); ed.tool.triggers = 'select'; A.refresh('toolbar', 'dock'); }
    rend.request();
  };
  ed.triggerColor = triggerColor;
}
export { cityTemplate, survivalTemplate, missionTemplate, blocksTemplate };
