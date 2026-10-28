// 一键生成地图简介：把地形、队伍、资源、检查结果写成一段能直接发群 / 发工坊的中文文案
// 只读：不改地图，不产生撤销步。
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast, segmented } from './ui.js';
import { copyCode } from './share.js';
import { saveFile } from './files.js';
import { runChecks } from './check.js';
import { passability, balanceReport, LAND, NAVAL, BUILD } from './pathing.js';
import { terrainStats } from './charts.js';
import { objProp } from './tmx.js';

const ed = A.ed;
const TW = 20;

Object.assign(HELP, {
  'tool.editorial': {
    t: '一键地图简介',
    s: '生成发群 / 工坊的中文介绍文案',
    b: '读一遍地图（地形占比、队伍、出生点、资源池、检查结果），自动写成一段可以直接粘贴的中文介绍：地图名、尺寸、推荐人数、一句话玩法、每队资源和出生点、开局建议、注意事项。<b>正式 / 活泼 / 极简</b>三种风格，可复制、可导出 .txt。只读，不会改地图。',
    tips: ['文案里的数字都来自当前地图，改完地图再生成一次就更新。', '“注意事项”只挑和玩家有关的检查项，编辑器内部的提醒不会写进去。'],
  },
});

const STYLES = [['formal', '正式'], ['lively', '活泼'], ['minimal', '极简']];
let curStyle = 'formal';

const pct = (n, total) => (total ? n / total * 100 : 0);
function pctText(v) {
  const r = Math.round(v * 10) / 10;
  return (r % 1 ? r.toFixed(1) : String(r)) + '%';
}

// 陆地连通块（4 邻接）：用来判断“岛战”还是“一整块大陆”
function landComponents(pass, W, H) {
  const seen = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  const sizes = [];
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !(pass[s] & LAND)) continue;
    let head = 0, tail = 0, size = 0;
    q[tail++] = s; seen[s] = 1;
    while (head < tail) {
      const i = q[head++]; size++;
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !seen[i - 1] && (pass[i - 1] & LAND)) { seen[i - 1] = 1; q[tail++] = i - 1; }
      if (x < W - 1 && !seen[i + 1] && (pass[i + 1] & LAND)) { seen[i + 1] = 1; q[tail++] = i + 1; }
      if (i >= W && !seen[i - W] && (pass[i - W] & LAND)) { seen[i - W] = 1; q[tail++] = i - W; }
      if (i < W * H - W && !seen[i + W] && (pass[i + W] & LAND)) { seen[i + W] = 1; q[tail++] = i + W; }
    }
    sizes.push(size);
  }
  const total = sizes.reduce((a, b) => a + b, 0);
  sizes.sort((a, b) => b - a);
  return {
    count: sizes.length,
    largest: sizes[0] || 0,
    largestPct: total ? (sizes[0] || 0) / total * 100 : 0,
    bbox: x1 >= 0 ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
  };
}

// 判断玩法类型：水域为主 / 岛战 / 单线推进 / 陆地拉锯
function archetype(s) {
  if (s.teamN >= 2 && s.waterPct >= 45) return 'naval';
  if (s.teamN >= 2 && s.comps.count >= 3 && s.comps.largestPct <= 60) return 'islands';
  const bb = s.comps.bbox;
  if (s.teamN === 2 && bb && (bb.w / bb.h <= 0.45 || bb.h / bb.w <= 0.45)) return 'lane';
  return 'land';
}

const ARCH = {
  naval: { cn: '水域为主', say: (s) => `水面占了 ${pctText(s.waterPct)}，陆地被水道切开，谁控住水路由谁说话。` },
  islands: { cn: '岛战', say: (s) => `陆地分成 ${s.comps.count} 块，出生点各自成岛，跨海要靠船或空军。` },
  lane: { cn: '单线推进', say: () => '地图狭长，双方主要沿一条线正面推进。' },
  land: {
    cn: '陆地拉锯',
    say: (s) => `陆地为主（能建造的格子占 ${pctText(s.buildPct)}），双方从出生点往中间推，正面拉锯。`,
  },
};

const teamLine = (s, t) => {
  const r = s.rows.get(t);
  if (!r) return `第 ${t + 1} 队：还没有出生点`;
  const bits = [`出生点 (${Math.floor(r.x / TW)}, ${Math.floor(r.y / TW)})`];
  if (r.nearest != null) bits.push(`最近资源池 ${r.nearest} 格`);
  if (r.near != null) bits.push(`30 格内 ${r.near} 个资源池`);
  if (r.island) bits.push('和其它队走不通');
  return `第 ${t + 1} 队：${bits.join('，')}`;
};

function advice(s) {
  const parts = [];
  const near = [...s.rows.values()].map((r) => r.nearest).filter((v) => v != null);
  if (near.length) parts.push(`开局先占最近的资源池（${Math.min(...near)} 格内就有一个）`);
  if (s.contested) parts.push(`两队距离接近的公共资源池有 ${s.contested} 个，是争夺重点`);
  if (s.buildPct < 20) parts.push('空地不多，建造者别堵在一起');
  if (!parts.length) parts.push('先稳住门口的资源，再往中间推');
  return parts.join('；') + '。';
}

// 注意事项：先放数据分析出来的，再放 runChecks 的 error / warn（跳过编辑器内部提醒）
function collectNotes(checks, s) {
  const out = [];
  const push = (t) => { if (t && !out.includes(t)) out.push(t); };
  if (!s.teamN) push('还没有放出生点，玩家进去会直接结束。');
  for (const r of s.rows.values()) {
    if (r.island) push(`第 ${r.team + 1} 队的出生点和别的队走不通（可能是孤岛），需要船或空军。`);
  }
  if (s.fair && s.fair.nearestSpread >= 8) push(`各队到最近资源池的距离最多差 ${s.fair.nearestSpread} 格，资源起手不太平衡。`);
  if (s.buildPct < 12) push(`能建造的格子只有 ${pctText(s.buildPct)}，单位容易展不开。`);
  if (s.teamN > 10) push(`共 ${s.teamN} 队，超过 10 队需要能容纳更多玩家的服务器房间。`);
  const skipCat = new Set(['尺寸']);
  const sorted = checks
    .filter((c) => (c.level === 'error' || c.level === 'warn') && !skipCat.has(c.cat))
    .sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
  for (const c of sorted) push(c.title);
  return out;
}

// 把地图读成一份简介需要的数字
export function describeMap(ed2 = ed) {
  const m = ed2.map;
  if (!m) return null;
  const W = m.width, H = m.height, cells = W * H;
  const pass = passability(ed2);
  let land = 0, water = 0, build = 0;
  for (let i = 0; i < cells; i++) {
    const c = pass[i];
    if (c & LAND) land++;
    if (c & BUILD) build++;
    if (!(c & LAND) && (c & NAVAL)) water++;
  }
  const comps = landComponents(pass, W, H);
  let terr = [];
  try { terr = terrainStats(ed2).slice(0, 3); } catch { terr = []; }
  const spawns = ed2.spawns().filter((s) => s.team >= 0);
  const teams = [...new Set(spawns.map((s) => s.team))].sort((a, b) => a - b);
  let report = null;
  try { report = balanceReport(ed2, 30); } catch { report = null; }
  const rows = new Map((report && report.rows ? report.rows : []).map((r) => [r.team, r]));
  let checks = [];
  try { checks = runChecks(ed2) || []; } catch { checks = []; }
  const s = {
    name: A.mapName || '未命名地图',
    w: W, h: H, cells,
    land, water, build,
    landPct: pct(land, cells), waterPct: pct(water, cells), buildPct: pct(build, cells),
    comps,
    terr,
    teams, teamN: teams.length,
    pools: ed2.poolTiles().length,
    units: ed2.allObjects().filter(({ o }) => objProp(o, 'unit')).length,
    rows,
    contested: report && report.contested ? report.contested.length : 0,
    fair: report ? report.fair : null,
    checks,
  };
  s.arch = archetype(s);
  s.players = s.teamN ? `推荐 ${s.teamN} 人（${s.teamN} 队对局）` : '推荐人数待定（还没放出生点）';
  s.notes = collectNotes(s.checks, s);
  return s;
}

function formalText(s) {
  const L = [];
  L.push(`《${s.name}》`);
  L.push(`${s.w}×${s.h} 格 · ${s.players} · ${s.pools} 个资源池${s.units ? ` · ${s.units} 个单位` : ''}`);
  L.push('');
  L.push(`玩法：${ARCH[s.arch].cn} —— ${ARCH[s.arch].say(s)}`);
  if (s.terr.length) L.push(`地形：${s.terr.map((t) => `${t.name} ${pctText(t.pct)}`).join('、')}。`);
  L.push('');
  L.push('队伍：');
  if (s.teams.length) for (const t of s.teams) L.push(`· ${teamLine(s, t)}`);
  else L.push('· 还没放出生点');
  L.push('');
  L.push(`开局建议：${advice(s)}`);
  L.push('');
  L.push('注意事项：');
  if (s.notes.length) for (const n of s.notes.slice(0, 6)) L.push(`· ${n}`);
  else L.push('· 检查没发现明显问题，存好图就能开打。');
  return L.join('\n');
}

function livelyText(s) {
  const L = [];
  L.push(`【${s.name}】开打！`);
  L.push(`${s.w}×${s.h} 的战场，${s.teamN ? `推荐 ${s.teamN} 人（${s.teamN} 队对刚）` : '人数待定（还没放出生点）'}，${s.pools} 个资源池${s.units ? `、${s.units} 个单位` : ''}。`);
  L.push('');
  L.push(`怎么打：${ARCH[s.arch].cn} —— ${ARCH[s.arch].say(s)}`);
  L.push('');
  if (s.teams.length) for (const t of s.teams) L.push(`· ${teamLine(s, t)}`);
  else L.push('· 还没放出生点，先去放一个指挥中心吧');
  L.push('');
  L.push(`开局：${advice(s)}`);
  L.push('');
  if (s.notes.length) {
    L.push('提醒：');
    for (const n of s.notes.slice(0, 4)) L.push(`· ${n}`);
  } else L.push('检查没发现大问题，放心开！');
  return L.join('\n');
}

function minimalText(s) {
  const teams = s.teams.length
    ? s.teams.map((t) => {
      const r = s.rows.get(t);
      return `${t + 1} 队${r ? ` (${Math.floor(r.x / TW)},${Math.floor(r.y / TW)})` : ''}`;
    }).join('、')
    : '还没放出生点';
  const L = [];
  L.push(`《${s.name}》｜${s.w}×${s.h}｜${s.teamN ? `${s.teamN} 人 / ${s.teamN} 队` : '人数待定'}｜${s.pools} 个资源池`);
  L.push(`${ARCH[s.arch].cn}：${ARCH[s.arch].say(s)}`);
  L.push(`各队：${teams}。`);
  L.push(`开局：${advice(s)}`);
  if (s.notes.length) L.push(`注意：${s.notes.slice(0, 2).join('；')}`);
  return L.join('\n');
}

// 生成一段成品文案。style：'formal' | 'lively' | 'minimal'
export function buildDescription(ed2 = ed, style = 'formal') {
  const s = describeMap(ed2);
  if (!s) return '';
  if (style === 'lively') return livelyText(s);
  if (style === 'minimal') return minimalText(s);
  return formalText(s);
}

// 对话框：预览 + 换风格 + 复制 / 导出 .txt
export function descriptionDialog() {
  if (!ed.map) { toast('先新建或打开一张地图'); return; }
  let style = curStyle;
  const ta = h('textarea', { rows: 15, style: 'width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6' });
  const regen = () => { ta.value = buildDescription(ed, style); };
  const seg = segmented(STYLES, style, (v) => { style = v; curStyle = v; regen(); });
  regen();
  const body = h('div', {},
    h('p', { class: 'hint', style: 'margin:0 0 8px' },
      '根据这张图的地形、队伍、出生点、资源池和检查结果自动写的介绍，可以改完再复制。'),
    h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' },
      h('span', { class: 'hint' }, '风格：'), seg),
    ta,
    h('div', { class: 'hint', style: 'margin-top:6px' }, '只读：生成过程不会改地图，也不会产生撤销步。'));
  return modal('一键地图简介', body, [
    { label: '关闭', value: 0 },
    {
      label: '导出 .txt',
      value: async () => {
        try {
          const r = await saveFile((A.mapName || '地图') + '-简介.txt', ta.value, 'text/plain;charset=utf-8');
          if (r && r.ok) toast('简介已导出为 .txt');
        } catch (e) { toast('导出失败：' + ((e && e.message) || e)); }
      },
    },
    {
      label: '复制文案',
      primary: true,
      value: async () => { toast(await copyCode(ta.value) ? '文案已复制，去粘贴吧' : '复制失败，请手动选中复制'); },
    },
  ], { wide: true });
}
