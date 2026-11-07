// RWKit · 触发器属性格式(依据 research_notes/编辑器对标/triggers_spec.md,来自游戏反编译代码)
export const COLOR_NAMES = new Set('black darkgray darkgrey gray grey lightgray lightgrey white red green blue yellow cyan magenta aqua fuchsia lime maroon navy olive purple silver teal'.split(' '));
const re = {
  time: /^\s*\d+(\.\d+)?\s*(s|ms)?\s*$/i,
  int: /^\s*-?\d+\s*$/,
  float: /^\s*-?\d+(\.\d+)?\s*$/,
  bool: /^\s*(true|false)\s*$/i,
};
export const V = {
  time: (v) => re.time.test(v) ? null : `时间格式错误「${v}」:只能是纯数字(毫秒)、数字+s 或 ms(如 10s、1500ms);不认 m、h`,
  int: (v) => re.int.test(v) ? null : `应为整数,实际「${v}」`,
  float: (v) => re.float.test(v) ? null : `应为数字,实际「${v}」`,
  bool: (v) => re.bool.test(v) ? null : `应为 true/false,实际「${v}」`,
  teamTrig: (v) => re.int.test(v) ? null : `触发器的 team 必须是整数(-2/-1/0..),不能写「${v}」`,
  color: (v) => { v = v.trim(); if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || COLOR_NAMES.has(v.toLowerCase())) return null; return `颜色「${v}」游戏不认(只认 #RRGGBB、#AARRGGBB 和 ${[...COLOR_NAMES].slice(0, 6).join('/')} 等颜色名;hsl() 会让地图加载失败)`; },
  any: () => null,
  list: () => null,
};
const COMMON = { id: 'any', activatedBy: 'list', whenActivatedIds: 'list', alsoActivate: 'list', activateIds: 'list', deactivatedBy: 'list', allToActivate: 'bool', delay: 'time', warmup: 'time', repeatDelay: 'time', resetActivationAfter: 'time', repeatCount: 'int', globalMessage: 'any', globalMessage_delayPerChar: 'any', globalMessage_textColor: 'color', debugMessage: 'any', showOnMap: 'bool', textOffsetX: 'float', textOffsetY: 'float', comment: 'any', team: 'teamTrig' };
const DET = { minUnits: 'int', maxUnits: 'int', unitType: 'any', onlyBuildings: 'bool', onlybuildings: 'bool', onlyMainBuildings: 'bool', onlyOnResourcePool: 'bool', onlyResourcePool: 'bool', onlyBuilders: 'bool', onlyIdle: 'bool', onlyidle: 'bool', onlyEmptyQueue: 'bool', onlyTechLevel: 'int', onlyAttack: 'bool', onlyAttackAir: 'bool', onlyWithTag: 'any', onlyIfEmpty: 'bool', includeIncomplete: 'bool' };
export const TYPES = {
  unitadd: { keys: { spawnUnits: 'any' }, team: true },
  unitdetect: { keys: DET },
  unitremove: { keys: { onlyIfEmpty: 'bool' } },
  maptext: { keys: { text: 'any', textColor: 'color', textSize: 'int', style: 'any' } },
  changecredits: { keys: { add: 'int', set: 'int' }, team: true },
  teamtags: { keys: { addTeamTags: 'any', removeTeamTags: 'any' }, team: true },
  teamtagdetect: { keys: { teamTag: 'any' }, team: true },
  basic: { keys: {} },
  objective: { keys: { text: 'any' }, loose: true },
  movecamera: { keys: {}, loose: true },
  move: { keys: { target: 'any', unload: 'any', onlyIfEmpty: 'bool' }, team: true, loose: true },
};
export const AREA_TYPES = new Set(['unitdetect', 'unitremove', 'move']);
export const SPAWN_OPTS = new Set('neutralteam aggressiveteam settoteamoflastattacker spawnchance maxspawnlimit techlevel gridalign skipifoverlapping falling transportedunitstotransfer alwaysstartdiratzero alwaystartdiratzero offsetx offsety offsetheight offsetdir offsetrandomxy offsetrandomx offsetrandomy offsetrandomdir addresources spawnsource copywaypointsfrom'.split(' '));
// 属性是否属于"多语言后缀"(text_zh 等)
export const localeBase = (k) => { const m = k.match(/^(.+)_([a-zA-Z-]{1,4})$/); return m && ['text', 'globalMessage', 'introText'].includes(m[1]) ? m[1] : null; };
export function parseSpawn(s) {
  const items = []; let depth = 0, cur = '';
  for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch; }
  if (cur.trim()) items.push(cur);
  return items.map((it) => { it = it.trim(); const m = it.match(/^([^*(]+?)\s*(?:\*\s*(\d+))?\s*(?:\(([^)]*)\))?$/); if (!m) return { raw: it, bad: true }; const opts = {}; if (m[3]) for (const kv of m[3].split(',')) { const [k, v] = kv.split('='); if (k && k.trim()) opts[k.trim()] = (v ?? '').trim(); } return { unit: m[1].trim(), n: m[2] ? +m[2] : 1, opts, raw: it }; });
}
export function tms(v) { if (v == null || String(v).trim() === '') return null; const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/i); if (!m) return null; return Math.round(parseFloat(m[1]) * ((m[2] || 'ms').toLowerCase() === 's' ? 1000 : 1)); }
