// 智能提示：按当前地图状态主动给出建议（不打扰，只在报告面板和启动时）
// 所有判断都是只读的，不改地图
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { HELP } from './help.js';
import { passability, LAND, BUILD } from './pathing.js';

const ed = A.ed;

// 返回 [{level:'info'|'tip'|'warn', title, detail, act?}]，按重要性排序
export function collectHints(ed2 = ed) {
  const m = ed2.map;
  if (!m) return [];
  const out = [];
  const T = m.group('Triggers');
  const trigs = T ? T.objects.filter((o) => o.attrs.type || o.attrs.class) : [];
  const W = m.width, H = m.height;
  const pools = ed2.poolTiles();
  const spawns = ed2.spawns();

  if (!spawns.length) out.push({ level: 'warn', title: '还没有出生点', detail: '这张图没有放出生点，游戏里没法开局。用「单位」工具放指挥中心当出生点。' });
  else if (spawns.length === 1) out.push({ level: 'tip', title: '只有一个出生点', detail: '只有一个队伍的话只能单人玩，想联机至少放两个。' });

  if (!pools.length) out.push({ level: 'warn', title: '还没有资源池', detail: '游戏里造东西要资源，没有资源池这张图很难玩。用「生成 → 资源池布局」或手动放。' });
  else if (pools.length < spawns.length) out.push({ level: 'warn', title: '资源池比队伍还少', detail: `现在 ${pools.length} 个资源池、${spawns.length} 个队伍，有队伍一个池子都分不到。` });

  if (!trigs.length) out.push({ level: 'tip', title: '还没有触发器', detail: '普通遭遇战可以没有触发器。想做任务、生存、占点，用「触发器 → 模板库」快速加。' });

  const mi = ed2.mapInfo();
  if (!mi) out.push({ level: 'tip', title: '没有 map_info', detail: '游戏靠 map_info 决定对局规则。打开「地图 → map_info 表单」补一个，默认是遭遇战。' });

  // 出生点离最近的池子太远
  if (spawns.length && pools.length) {
    const far = [];
    for (const s of spawns) {
      const d = Math.min(...pools.map(([x, y]) => Math.hypot(x - s.cx / 20, y - s.cy / 20)));
      if (d > 30) far.push(`${s.team} 队（最近 ${d.toFixed(0)} 格）`);
    }
    if (far.length) out.push({ level: 'tip', title: '有队伍离资源池很远', detail: `${far.join('、')}。开局要跑很久才能采矿，可以考虑挪近一点。` });
  }

  // 可建造面积太少
  const pass = passability(ed2);
  let build = 0;
  for (let i = 0; i < W * H; i++) if (pass[i] & BUILD) build++;
  const ratio = build / (W * H);
  if (ratio < 0.15) out.push({ level: 'warn', title: '能盖房子的地方很少', detail: `可建造格只占 ${(ratio * 100).toFixed(1)}%，建筑没法展开，考虑加陆地或清掉障碍。` });

  // 图太大但内容很少
  if (W * H > 200 * 200 && !trigs.length && pools.length <= 2) out.push({ level: 'tip', title: '大图但内容少', detail: `${W}×${H} 的图只有 ${pools.length} 个资源池，玩家会跑很久没事做。` });

  // 队伍号不连续
  const teams = [...new Set(spawns.map((s) => s.team))].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < teams.length; i++) if (teams[i] !== teams[i - 1] + 1) gaps.push(teams[i - 1] + 1);
  if (gaps.length) out.push({ level: 'info', title: '队伍号不连续', detail: `用了 ${teams.join('/')} 队，中间缺 ${gaps.join('/')}。不影响玩，但选人界面可能显示空位。` });

  const order = { warn: 0, tip: 1, info: 2 };
  out.sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));
  return out;
}

export function hintsDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const list = collectHints(ed);
  const body = h('div', {});
  if (!list.length) {
    body.append(h('div', { style: 'font-size:13px;padding:12px;color:var(--muted)' },
      '没发现需要提醒的地方。这张图的基本面都齐了——继续做触发器、细节，或者直接试玩。'));
  }
  const COLOR = { warn: '#f5c518', tip: '#7aa2f7', info: '#888' };
  for (const it of list) {
    const row = h('div', { style: `padding:8px 10px;border-left:3px solid ${COLOR[it.level] || '#888'};margin:6px 0;background:rgba(255,255,255,.03)` });
    row.append(h('div', { style: 'font-size:13px;font-weight:600' }, it.title));
    row.append(h('div', { style: 'font-size:12px;color:var(--muted);margin-top:3px;line-height:1.6' }, it.detail));
    body.append(row);
  }
  body.append(h('div', { style: 'font-size:11px;color:var(--muted);margin-top:10px' },
    '这些只是建议，不影响导出。想更全面的检查，点工具栏上的「能玩吗？」。'));
  return modal('这张图还能改进的地方', body, [{ label: '知道了', value: 0, primary: true }], { wide: true });
}

// 启动时只在确实有 warn 级问题时弹一次，用户选过「别再提示」就不再打扰
export function maybeShowHintsAtStartup() {
  try {
    if (localStorage.getItem('rwNoHints') === '1') return;
  } catch (e) { return; }
  if (!ed.map) return;
  const warns = collectHints(ed).filter((x) => x.level === 'warn');
  if (!warns.length) return;
  const body = h('div', {});
  body.append(h('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:8px' },
    '打开地图时顺手看了下，有几件事可能影响能不能玩：'));
  for (const w of warns) {
    const row = h('div', { style: 'padding:7px 10px;border-left:3px solid #f5c518;margin:6px 0;background:rgba(245,197,24,.06)' });
    row.append(h('div', { style: 'font-size:13px;font-weight:600' }, w.title));
    row.append(h('div', { style: 'font-size:12px;color:var(--muted);margin-top:2px' }, w.detail));
    body.append(row);
  }
  return modal('给点提示', body, [
    { label: '以后别再提示', value: 'off', check: () => { try { localStorage.setItem('rwNoHints', '1'); } catch (e) {} } },
    { label: '知道了', value: 0, primary: true },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.hint': {
    t: '智能提示',
    s: '看看这张图还有哪些地方能改进',
    b: '菜单「地图」→「看看还能改进什么…」。会检查出生点、资源池、触发器、map_info、可建造面积、队伍号这些基本面，按「重要 / 建议 / 参考」三级列出来。只是建议，不影响导出。',
    tips: ['打开地图时如果发现真有影响玩的问题，会自动提醒一次，可以选「以后别再提示」。', '更严格的检查用「能玩吗？」。'],
  },
});
