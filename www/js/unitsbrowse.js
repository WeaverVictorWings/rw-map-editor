// 单位图鉴：把这张图里出现过、以及游戏自带的单位列成表，带属性、价格、谁在用
// 只读，不改地图；点一行就能把那个单位设为当前画笔单位
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { HELP } from './help.js';
import { UNIT_CN } from './editor.js';
import { objProp } from './tmx.js';

const ed = A.ed;

// 常见单位的血量 / 价格 / 说明。价格（credits）按游戏里的大致值，只用来横向比较强弱。
const CATALOG = {
  commandCenter: { hp: 3000, cost: 0, cat: '建筑', note: '开局主基地，被打掉就输（默认胜利条件）' },
  builder: { hp: 450, cost: 300, cat: '步兵', note: '建造/修理，移速最快，打不了架' },
  supplyDepot: { hp: 800, cost: 500, cat: '建筑', note: '提高人口上限' },
  turret: { hp: 900, cost: 700, cat: '防御', note: '基础炮塔，射程 12 格' },
  heavyTank: { hp: 1400, cost: 1200, cat: '坦克', note: '重装甲，正面硬碰硬' },
  tank: { hp: 700, cost: 600, cat: '坦克', note: '通用主力' },
  artillery: { hp: 550, cost: 1000, cat: '火力', note: '超远射程，怕近身' },
  hoverTank: { hp: 800, cost: 1100, cat: '坦克', note: '能过水，绕后专用' },
  amphibious: { hp: 650, cost: 900, cat: '坦克', note: '水陆两用' },
  gunship: { hp: 400, cost: 1300, cat: '空军', note: '对地强，怕防空' },
  helicopter: { hp: 300, cost: 900, cat: '空军', note: '侦察 / 骚扰' },
  antiAir: { hp: 700, cost: 800, cat: '防御', note: '专打飞机' },
  missileTurret: { hp: 1000, cost: 1500, cat: '防御', note: '打得很远，对空对地' },
  mechGun: { hp: 900, cost: 1000, cat: '坦克', note: '机甲类' },
};

// 游戏自带单位表 + 这张图里实际出现的单位
export function unitIndex(ed2 = ed) {
  const out = new Map();
  const ensure = (name) => {
    if (!out.has(name)) out.set(name, { name, cn: UNIT_CN[name] || name, used: 0, teams: new Set(), where: [], catalog: CATALOG[name] || null });
    return out.get(name);
  };
  for (const name of (ed2.unitNames || [])) ensure(name);
  if (ed2.map) {
    const W = 20;
    for (const { o } of ed2.allObjects()) {
      const name = objProp(o, 'unit');
      if (!name) continue;
      const u = ensure(name);
      u.used++;
      const t = objProp(o, 'team');
      if (t !== null && t !== undefined && t !== '') u.teams.add(String(t));
      if (u.where.length < 6) u.where.push([Math.floor(+(o.attrs.x || 0) / W), Math.floor(+(o.attrs.y || 0) / W)]);
    }
  }
  return [...out.values()].sort((a, b) => (b.used - a.used) || ((b.catalog ? b.catalog.hp : 0) - (a.catalog ? a.catalog.hp : 0)) || a.name.localeCompare(b.name));
}

export function unitBrowserDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const body = h('div', {});
  const q = h('input', { placeholder: '搜单位名（中英文都行）', style: 'width:100%;margin-bottom:8px' });
  const onlyUsed = h('input', { type: 'checkbox' });
  const list = h('div', {});
  const info = h('div', { style: 'color:var(--muted);font-size:12px;margin-bottom:6px' });

  body.append(
    h('div', { class: 'row', style: 'gap:10px;align-items:center;margin-bottom:8px' }, q,
      h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:12px;white-space:nowrap' }, onlyUsed, '只看这张图用到的')),
    info, list,
  );

  const paint = () => {
    list.textContent = '';
    const kw = q.value.trim().toLowerCase();
    const rows = unitIndex().filter((u) => (!onlyUsed.checked || u.used > 0)
      && (!kw || u.name.toLowerCase().includes(kw) || u.cn.toLowerCase().includes(kw)));
    info.textContent = `共 ${rows.length} 个${onlyUsed.checked ? '（用到的）' : ''}单位。点一行就把那个单位设为当前画笔。价格是游戏里的大致值，用来横向比较强弱。`;
    for (const u of rows) {
      const c = u.catalog;
      list.append(h('div', {
        class: 'hrow',
        style: 'display:flex;align-items:center;gap:10px;padding:5px 4px;border-bottom:1px solid var(--line, #2a2f3a);cursor:pointer',
        onclick: () => { ed.unitName = u.name; ed.mode = 'units'; ed.tool.units = 'unit'; A.refresh('modes', 'toolbar', 'dock'); toast(`画笔单位：${u.cn}`); },
      },
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { style: 'font-size:13px' }, `${u.cn}${c ? ` · ${c.cat}` : ''}`),
        h('div', { style: 'font-size:11px;color:var(--muted)' }, `${u.name}${c && c.note ? ' · ' + c.note : ''}`)),
      h('div', { style: 'font-size:12px;text-align:right;min-width:150px' },
        h('div', {}, c ? `血量 ${c.hp}${c.cost ? ` · 价格 ${c.cost}` : ''}` : '血量 —'),
        h('div', { style: 'font-size:11px;color:var(--muted)' },
          u.used ? `这张图用了 ${u.used} 个（队伍 ${[...u.teams].sort().join('/') || '无'}）` : '这张图还没用'))));
    }
  };
  q.addEventListener('input', paint);
  onlyUsed.addEventListener('change', paint);
  paint();

  return modal('单位图鉴（这张图用了哪些单位、谁强谁弱）', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
}

Object.assign(HELP, {
  'tool.unitsbrowse': {
    t: '单位图鉴',
    s: '一张表看清这张图用了哪些单位、每个单位的血量和价格',
    b: '菜单「单位」→「单位图鉴」。左上角可以搜名字，勾上「只看用到的」就只剩这张图里摆过的单位。每行显示血量、大致价格、用在哪几支队伍。点一行就把它设成当前画笔单位，然后直接在地图上摆。',
    tips: ['价格只是横向比较用的参考值。', '点一行后不用再去右边翻单位列表。'],
  },
});
