// RWKit · 触发器模板库(都是用过且在模型里验证过的写法)。每个函数返回触发器描述数组 [{name,type,x,y,w,h,props}],
// 用 insertTriggers(text, list) 写进 TMX 的 Triggers 组。
import { esc, parseTmx } from './tmx.js';
import { wrap } from './textlint.js';
const P20 = 20;
// 城市夺城链:检测(CC 没了) → 刷新中立 CC(+8s 补刷) → [锁 → 各候选队占领检测 → 战报]
export function captureChain({ k, cx, cy, teams = [], texts = {}, colors = {}, report = true, lockSecs = 600, size = 3 }) {
  const az = [(cx - 1) * P20, (cy - 1) * P20, size * P20, size * P20]; const o = [];
  const T = (name, type, x, y, w, h, props) => o.push({ name, type, x, y, w, h, props });
  T(`检测${k}`, 'unitDetect', ...az, { unitType: 'commandCenter', maxUnits: 0, resetActivationAfter: 600 });
  T(`刷新${k}`, 'unitAdd', cx * P20, cy * P20, 20, 20, { spawnUnits: 'commandCenter', team: -1, resetActivationAfter: '10s', activatedBy: `检测${k}` });
  T(`补刷${k}`, 'unitAdd', cx * P20, cy * P20, 20, 20, { spawnUnits: 'commandCenter', team: -1, resetActivationAfter: '10s', activatedBy: `检测${k}`, warmup: '8s' });
  if (report && teams.length) {
    const rids = teams.map((t) => `占${k}_${t}`);
    T(`锁${k}`, 'basic', cx * P20, cy * P20, 20, 20, { activatedBy: `检测${k}`, deactivatedBy: rids.join(','), resetActivationAfter: `${lockSecs}s` });
    teams.forEach((t, i) => {   // 注意:allToActivate=true 才是「且」(检测自身条件 且 锁成立);省略则变成「或」,一占城战报就乱刷
      T(rids[i], 'unitDetect', ...az, { unitType: 'commandCenter', minUnits: 1, team: t, activatedBy: `锁${k}`, allToActivate: 'true', resetActivationAfter: '3s' });
      T(rids[i] + '讯', 'unitAdd', -60, 20 * (i + 1), 20, 20, { team: -1, globalMessage: wrap(texts[t] || `${t}号队占领了第${k}号城`), globalMessage_textColor: colors[t] || '#FFFFFF', activatedBy: rids[i], warmup: '1s', resetActivationAfter: '10s' });
    });
  }
  return o;
}
// 一次性新闻:条件成立(如某队城数≥N)→ 发一条消息;resetActivationAfter 防止重复刷屏
export function newsWhenTeamHas({ id, team, minCities, text, color = '#FFFFFF', box }) {
  return [{ name: id, type: 'unitDetect', x: box[0], y: box[1], w: box[2], h: box[3], props: { unitType: 'commandCenter', minUnits: minCities, team, resetActivationAfter: 200 } },
    { name: id + '讯', type: 'unitAdd', x: -60, y: 20, w: 20, h: 20, props: { team: -1, globalMessage: wrap(text), globalMessage_textColor: color, activatedBy: id, warmup: '2s' } }];
}
// 阶段奖励:条件成立 → 3s 后发兵+加钱(只触发一次;想反复奖励请自行加 reset)
export function rewardWhen({ id, detect, team, cx, cy, units, credits }) {
  return [{ name: id + '兵', type: 'unitAdd', x: cx * P20, y: cy * P20, w: 20, h: 20, props: { spawnUnits: units, team, activatedBy: detect, warmup: '3s' } },
    { name: id + '钱', type: 'changeCredits', x: -60, y: 40, w: 20, h: 20, props: { team, add: credits, activatedBy: detect, warmup: '3s' } }];
}
// 覆灭:某队指挥中心数为 0 且开局 30s 后(delay + allToActivate 当「且」,开局不会误触发)
export function eliminated({ id, team, W, H, text }) {
  return [{ name: id, type: 'unitDetect', x: 0, y: 0, w: W * P20, h: H * P20, props: { unitType: 'commandCenter', maxUnits: 0, team, delay: '30s', allToActivate: 'true', resetActivationAfter: 200 } },
    { name: id + '讯', type: 'unitAdd', x: -60, y: 60, w: 20, h: 20, props: { team: -1, globalMessage: wrap(text), globalMessage_textColor: '#FF6666', activatedBy: id, warmup: '3s' } }];
}
export const PATTERNS = { captureChain: '城市夺城链(检测→刷新→锁→占领战报)', newsWhenTeamHas: '某队城数达标时发新闻', rewardWhen: '条件成立后发兵+加钱', eliminated: '覆灭播报(开局不误触发)' };
export function insertTriggers(text, list, group = 'Triggers') {
  const have = new Set(parseTmx(text).objects.map((o) => ((o.props.id || '').trim() || o.name))); const dup = list.filter((t) => have.has(t.name)).map((t) => t.name); if (dup.length) throw new Error('名字已存在,会造成重复引用: ' + dup.slice(0, 5).join('、'));
  let maxId = 0; for (const m of text.matchAll(/<object\s+[^>]*?\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  const xml = list.map((t) => `  <object id="${++maxId}" name="${esc(t.name)}" type="${t.type}" x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}"><properties>${Object.entries(t.props).map(([k, v]) => `<property name="${esc(k)}" value="${esc(v)}"/>`).join('')}</properties></object>`).join('\n');
  const re = new RegExp(`(<objectgroup\\s+[^>]*name="${group}"[^>]*>[\\s\\S]*?)(</objectgroup>)`); if (!re.test(text)) throw new Error(`找不到对象组 ${group}`);
  return text.replace(re, (_, a, b) => a + xml + '\n ' + b);
}
