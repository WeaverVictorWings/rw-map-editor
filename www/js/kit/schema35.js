// RWKit 3.5 · 触发器/单位/队伍的元数据（来自社区教程《铁锈战争超级详细的触发器教程》与引擎反编译）
// 纯数据 + 小工具，命令行和浏览器共用。造价没有收录：教程截图里的数字 OCR 后不可靠，宁缺勿错。

// ---- 属性说明(A3 气泡；A27 拼写建议也用这张表的键） ----
export const PROP_DOC = {
  delay: ['延迟', '开局后过多久，这个触发器才"醒来"（只算一次）。注意：数字不带单位时按毫秒，13000 = 13 秒。'],
  warmup: ['预热', '被触发之后，再等多久才产生效果。和 delay 不同:delay 管"何时开始可触发",warmup 管"触发后何时生效"。'],
  repeatDelay: ['重复间隔', '触发后每隔多久再执行一次（不重新检查条件）。不写则只执行一次。'],
  resetActivationAfter: ['复位时间', '触发后过多久重置，之后可被重新触发（需要条件再次成立）。和 repeatDelay 的区别：它要重新满足条件。'],
  activatedBy: ['被谁激活', '任意一个来源被触发就会触发本触发器（"或"）。要"且"请同时写 allToActivate=true。'],
  allToActivate: ['全部满足', '写 true 时，必须所有激活来源都已触发（或处于触发状态）才会触发。'],
  deactivatedBy: ['被谁关闭', '任意一个来源触发后，本触发器被禁止触发。'],
  alsoActivate: ['同时激活', '本触发器触发时，同时激活 id 等于这里的所有触发器。需要对方有 id 属性。'],
  id: ['编号', '触发器的标识，别的触发器用它来引用(activatedBy/alsoActivate 都写这个值）。'],
  team: ['队伍', '队伍号从 0 开始:0 = 1 号玩家；-1 中立；-2 敌对中立。'],
  spawnUnits: ['生成单位', '格式：单位名*数量，多个用逗号，如 tank*2,heavyTank*3。在触发器覆盖区域内生成。'],
  globalMessage: ['全局消息', '在屏幕左上角聊天区显示的文字。每行不宜太长，否则超出屏幕。'],
  globalMessage_textColor: ['消息颜色', '#RRGGBB 或颜色名；不能写 hsl()。'],
  globalMessage_delayPerChar: ['打字速度', '每个字出现的间隔，如 0.2s。'],
  minUnits: ['至少几个', '区域内满足条件的单位数达到这个数才触发，默认 1。'],
  maxUnits: ['最多几个', '填 0 表示"区域里一个也没有"才触发。'],
  unitType: ['单位类型', '只检测这一种单位（写单位英文名），只能写一种。'],
  onlyIdle: ['只数空闲', '只统计没有指令的单位。'],
  onlyBuildings: ['只数建筑', '只统计建筑物。'],
  onlyMainBuildings: ['只数生产建筑', '只统计能生产单位的建筑（工厂等）。'],
  onlyEmptyQueue: ['只数空队列', '只统计没有在生产东西的工厂。'],
  onlyBuilders: ['只数建造者', '只统计有建造能力的单位。'],
  onlyOnResourcePool: ['只数资源池上的', '只统计在资源池上的资源采集器。'],
  onlyAttack: ['只数能攻击的', '只统计有攻击能力的单位。'],
  onlyAttackAir: ['只数能对空的', '只统计只攻击空军/能对空的单位。'],
  onlyTechLevel: ['只数某科技等级', '写数字，只统计该科技等级的单位。'],
  includeIncomplete: ['含未建完', '连还没建完的建筑也算。'],
  target: ['目的地', 'move 的目的地：写一个 point 类型触发器的名字。'],
  unload: ['到达后卸载', '运输载具到达目标点后卸下所载单位（值不用填）。'],
  dir: ['旋转角度', 'rotate 用：向右旋转，360.0 为一圈。'],
  showOnMap: ['小地图事件', 'true 时在小地图上提示玩家此处发生了事件。'],
  credits: ['开局资金', 'team_info：玩家开局资金（联机时房间设置也能改）。'],
  lockAiDifficulty: ['锁定 AI 难度', '-2 很简单、-1 简单、0 中等、1 困难、2 很困难、3 不可能。数值过大会让游戏崩溃。'],
  ai: ['AI 行为', '写 survival 让 AI 更主动送兵，适合生存图。'],
  allyGroup: ['同盟组', '相同数字的玩家互为盟友。'],
  disabledAI: ['禁用 AI', '阻止 AI 索敌、建造、行动（值不用填）。'],
  fog: ['战争迷雾', 'NONE / map / los 三种。'],
  introText: ['开局介绍', '开局弹出的对话框文字。'],
  winCondition: ['胜利条件', 'mainBuildings / allUnitsAndBuildings / allBuildings / commandCenter / requiredObjectives / none。'],
  zoomTo: ['开局缩放', 'camera_start 的属性，改变开局视野大小。'],
  addTeamTags: ['加标签', '给队伍添加标签（模组用 self.globalTeamTags 检测）。'],
  removeTeamTags: ['去标签', '去掉队伍标签。'],
  teamTag: ['标签检测', 'teamTagDetect 检测的标签名。'],
  text: ['文字', 'mapText / objective 显示的文字。'],
  textColor: ['文字颜色', '#RRGGBB。'],
  textSize: ['字号', '默认 20。'],
  style: ['样式', '空=普通；arrow=带向下箭头。'],
  add: ['增加', 'changeCredits：增加（负数为扣）。'],
  set: ['设为', 'changeCredits：直接设为这个数。'],
};

// ---- unitDetect 的 11 个限定（A2） ----
export const DETECT_LIMITS = [
  ['unitType', '单位类型', 'text'], ['onlyIdle', '只数空闲单位', 'bool'], ['onlyBuildings', '只数建筑物', 'bool'],
  ['onlyMainBuildings', '只数生产建筑', 'bool'], ['onlyEmptyQueue', '只数空队列的工厂', 'bool'], ['onlyBuilders', '只数建造者', 'bool'],
  ['onlyOnResourcePool', '只数资源池上的', 'bool'], ['onlyAttack', '只数能攻击的', 'bool'], ['onlyAttackAir', '只数能对空的', 'bool'],
  ['onlyTechLevel', '只数某科技等级', 'int'], ['includeIncomplete', '含没建完的', 'bool'],
];
// 互相矛盾的限定组合（B35）
export const LIMIT_CONFLICTS = [['onlyBuilders', 'onlyAttack'], ['onlyBuildings', 'onlyBuilders'], ['onlyBuildings', 'onlyAttack'], ['onlyBuildings', 'onlyIdle'], ['onlyBuildings', 'onlyAttackAir'], ['onlyEmptyQueue', 'onlyBuilders']];

export const AI_LEVELS = [[-2, '很简单'], [-1, '简单'], [0, '中等'], [1, '困难'], [2, '很困难'], [3, '不可能']];
export const WIN_CONDITIONS = [['mainBuildings', '摧毁所有生产建筑'], ['allUnitsAndBuildings', '消灭所有单位和建筑'], ['allBuildings', '摧毁所有建筑'], ['commandCenter', '摧毁指挥中心'], ['requiredObjectives', '完成所有任务目标'], ['none', '没有（不会自动结束）']];
export const FOG_MODES = [['NONE', '无迷雾'], ['map', '地图迷雾'], ['los', '视野']];
export const MAP_TYPES = [['skirmish', '遭遇战'], ['challenge', '挑战'], ['survival', '生存'], ['mission', '任务']];

// ---- 触发器类型补全（A1）。fields: [属性， 中文， 种类， 是否必填， 说明] ----
export const EXTRA_TYPES = {
  rotate: { cn: '旋转单位', cat: 'act', area: 'rect', desc: '改变区域里单位的朝向。dir 向右旋转，360.0 为一圈。', fields: [['dir', '旋转角度', 'float', true, '0~360']] },
  fall: { cn: '空降单位', cat: 'act', area: 'rect', desc: '开局在区域里"从天而降"出现单位（不如刷兵好用，留作兼容）。', fields: [['spawnUnits', '生成哪些单位', 'units', true], ['team', '属于哪个队', 'team', true]] },
};
// 引擎不接受的类型提示（教程:camera_pan 不可用于自定义地图）
export const UNSUPPORTED_TYPES = { camera_pan: '教程注明:camera_pan 不可用于自定义地图，放了也不会生效' };
// 只有名字起作用的特殊对象
export const SPECIAL_NAMES = {
  map_info: '地图信息：一张图只能有一个，没有它触发器不会被启动',
  camera_start: '开局镜头位置，可选 zoomTo',
  attack_point: '生存模式的敌军出生点。多了会出现"最后一个不出兵"的 bug,解决办法是多放一个',
};

// ---- 单位库（A6/A7）。id=英文名，zh=中文名，g=分组。造价未收录 ----
const G = { land: '陆军', mech: '机甲', air: '空军', sea: '海军', exp: '实验', bld: '建筑', bug: '虫族', hid: '隐藏/其他' };
const rows = `
land|landFactory 陆军工厂|scout 侦察者|builder 建造者|tank 小坦克|c_tank 小坦克（新）|hoverTank 悬浮坦克|c_artillery 自行火炮|heavyTank 重型坦克|heavyHoverTank 重型气垫坦克|plasmaTank 等离子坦克|heavyArtillery 重型火炮|mammothTank 猛犸坦克|laserTank 激光坦克|missileTank 防空坦克|combatEngineer 战斗工程师
mech|mechFactory 机械工厂|mechGun 小机甲|mechMissile 防空机甲|mechArtillery 火炮机甲|mechBunker 移动炮台|mechBunkerDeployed 移动炮台（部署）|mechFactoryT2 机械工厂T2|mechMinigun 机枪机甲|mechEngineer 机械师|mechLaser 等离子机甲|mechLightning 特斯拉机甲|mechHeavyMissile 重型防空机甲|mechFlame 喷火机甲
air|airFactory 空军基地|lightGunship 轻型武装直升机|c_interceptor 截击机|helicopter 直升机|gunShip 武装直升机|heavyInterceptor 重型拦截机|dropship 运输机|amphibiousJet 两栖战机|bomber 轰炸机|missileAirshipAA 导弹飞艇|aaBeamGunship 激光战机
sea|seaFactory 海军工厂|gunBoat 机枪艇|builderShip 建造船|hovercraft 运输艇|missileShip 导弹舰|attackSubmarine 潜水艇|battleShip 战列舰|heavyBattleship 重型战列舰|heavySub 重型潜艇|heavyMissileShip 重型导弹舰|nautilusSubmarineSurface 鹦鹉螺号（水面）|nautilusSubmarine 鹦鹉螺号（潜水）|experiementalCarrier 航空母舰
exp|experimentalLandFactory 实验工厂|fireBee 火蜂战机|experimentalTank 概念坦克|experimentalHoverTank 概念悬浮坦克|experimentalDropship 飞行堡垒|experimentalSpider 实验蜘蛛|modularSpider 模块蜘蛛
bld|commandCenter 指挥中心|extractorT1 资源提取器|extractorT2 资源提取器T2|extractorT3 资源提取器T3|fabricatorT1 资源建造仪|fabricatorT2 资源建造仪T2|fabricatorT3 资源建造仪T3|turret 机枪塔|turretT2 二级机枪塔|turretT3 三级机枪塔|turret_flamethrower 喷火塔|turret_artillery 火炮塔|c_turret_t2_artillery 二级火炮塔|c_turret_t1_lightning 电塔|c_turret_t2_lightning 二级电塔|antiAirTurret 防空塔|c_antiAirTurretT2 二级防空塔|c_antiAirTurretT3 三级防空塔|antiAirTurretFlak 高射炮|repairbay 修复湾|laserDefence 激光防御塔|outpostT1 视野塔|outpostT2 视野塔T2|laboratory 实验室|nukeLauncherC 核弹发射井|antiNukeLauncherC 反核发射井|crystalResource 水晶|crystal_mid 宝箱|supplyDepot 补给站|wall_v 城墙
bug|bugNest 虫巢|bugSpore 建造虫|bugFly 飞行建造虫|bugMelee 啃噬虫|bugWasp 飞行虫|bugPickup 运输虫|bugBee 爆炸虫|bugRanged 远程虫|bugRangedT2 二级远程虫|bugTurret 虫族炮台|bugExtractor 虫族一级矿|bugExtractorT2 虫族二级矿|bugGenerator 虫族资源建造茧|bugGeneratorT2 虫族资源建造茧T2
hid|ladybug 瓢虫|bugMeleeSmall 幼小啃噬虫|bugMeleeLarge 巨型啃噬虫|bugMeleeT3 近战虫王|bugGeneratorN 资源建造虫幼体|bugGeneratorN2 资源建造虫成体|robotCrab 机械螃蟹|robotCrabWater 机械螃蟹（水）|megaTank 超级坦克|tankDestroyer 坦克杀手|experimentalGunship 悬浮基地|experimentalGunshipLanded 悬浮基地（固定）|mechFlyingTakeoff 飞机甲|mechFlyingLanded 飞机甲（着陆）|spreadingFire 永恒之火`.trim().split('\n');
export const UNIT_LIB = [];
for (const r of rows) { const [g, ...items] = r.split('|'); for (const it of items) { const i = it.indexOf(' '); UNIT_LIB.push({ id: it.slice(0, i), zh: it.slice(i + 1), g, gn: G[g] }); } }
export const UNIT_BY_ID = new Map(UNIT_LIB.map((u) => [u.id, u]));
export const UNIT_GROUPS = G;
export const isShip = (id) => UNIT_BY_ID.get(id)?.g === 'sea' && !/Factory$/.test(id);
export const isAir = (id) => UNIT_BY_ID.get(id)?.g === 'air' && !/Factory$/.test(id) || id === 'fireBee' || id === 'experimentalDropship';
export function searchUnits(q, limit = 30) {
  q = String(q || '').trim().toLowerCase(); if (!q) return UNIT_LIB.slice(0, limit);
  const sc = (u) => { const id = u.id.toLowerCase(); return id === q || u.zh === q ? 0 : id.startsWith(q) || u.zh.startsWith(q) ? 1 : id.includes(q) || u.zh.includes(q) ? 2 : 9; };
  return UNIT_LIB.map((u) => [sc(u), u]).filter((x) => x[0] < 9).sort((a, b) => a[0] - b[0]).slice(0, limit).map((x) => x[1]);
}
export const unitLabel = (id) => { const u = UNIT_BY_ID.get(id); return u ? `${u.zh}（${id}）` : id; };

// ---- 属性名拼写建议（B27）：编辑距离 ----
export function editDist(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let p = Array.from({ length: n + 1 }, (_, i) => i); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; }
export function suggestProp(name, extra = []) {
  const known = [...Object.keys(PROP_DOC), ...extra]; const low = String(name).toLowerCase(); let best = null, bd = 99;
  for (const k of known) { if (k === name) return null; const d = k.toLowerCase() === low ? 0 : editDist(low, k.toLowerCase()); if (d < bd) { bd = d; best = k; } }
  return best && bd <= Math.max(1, Math.floor(best.length / 4)) ? best : null;
}
export function suggestUnit(name) { let best = null, bd = 99; const low = String(name).toLowerCase(); for (const u of UNIT_LIB) { const d = editDist(low, u.id.toLowerCase()); if (d < bd) { bd = d; best = u.id; } } return best && bd <= 2 && bd < low.length / 2 ? best : null; }

// ---- 时间（A4）:13000 / 13s / 1m30s / 90s 互转 ----
export function parseTimeFlex(v) {
  if (v == null || String(v).trim() === '') return null; const s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return { ms: Math.round(+s), bare: true };
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*m(?!s))?\s*(?:(\d+(?:\.\d+)?)\s*s)?\s*(?:(\d+(?:\.\d+)?)\s*ms)?$/); if (!m || (m[1] == null && m[2] == null && m[3] == null)) return NaN;
  return { ms: Math.round((+(m[1] || 0)) * 60000 + (+(m[2] || 0)) * 1000 + (+(m[3] || 0))), bare: false };
}
export function fmtTimeZh(ms) { if (ms < 1000) return ms + ' 毫秒'; const t = ms / 1000; if (t < 60) return (Math.round(t * 10) / 10) + ' 秒'; const mm = Math.floor(t / 60), ss = Math.round((t - mm * 60) * 10) / 10; return mm + ' 分' + (ss ? ' ' + ss + ' 秒' : ''); }
export function timeHint(v) {
  const p = parseTimeFlex(v); if (p === null) return ''; if (Number.isNaN(p)) return '读不懂这个时间（可写 13s / 500ms / 1m30s）';
  return (p.bare ? `纯数字按毫秒:${fmtTimeZh(p.ms)}` : `= ${fmtTimeZh(p.ms)}`) + (p.ms > 600000 ? '（超过 10 分钟，是不是多敲了 0?）' : '');
}
// 规范成引擎可靠读取的写法：整秒写 Ns,其余写毫秒
export function normTime(v) { const p = parseTimeFlex(v); if (!p || Number.isNaN(p)) return String(v); return p.ms % 1000 === 0 ? p.ms / 1000 + 's' : p.ms + 'ms'; }

// ---- 属性顺序（A21）：保存/导出时用的规范顺序 ----
export const PROP_ORDER = ['id', 'team', 'unitType', 'minUnits', 'maxUnits', 'spawnUnits', 'target', 'unload', 'dir', 'delay', 'warmup', 'activatedBy', 'allToActivate', 'deactivatedBy', 'alsoActivate', 'repeatDelay', 'resetActivationAfter', 'globalMessage', 'globalMessage_textColor', 'globalMessage_delayPerChar', 'showOnMap', 'comment'];
export function sortProps(props) { const idx = (k) => { const i = PROP_ORDER.indexOf(k); return i < 0 ? 500 + (k.charCodeAt(0) || 0) / 1000 : i; }; return Object.fromEntries(Object.entries(props).sort((a, b) => idx(a[0]) - idx(b[0]) || a[0].localeCompare(b[0]))); }

// ---- rotate 的 dir 换算（A10） ----
export const dirFromCompass = (name) => ({ 东: 0, 东南: 45, 南: 90, 西南: 135, 西: 180, 西北: 225, 北: 270, 东北: 315 }[name] ?? null);
export const dirToCompass = (deg) => ['东', '东南', '南', '西南', '西', '西北', '北', '东北'][Math.round((((+deg % 360) + 360) % 360) / 45) % 8];
export const dirFromVector = (dx, dy) => Math.round(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360 * 10) / 10;
