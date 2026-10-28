// 海战专项检查：港口能不能出海、出海口多宽、岸边通不通
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast } from './ui.js';
import { passability, LAND, NAVAL, HOVER, BUILD } from './pathing.js';
import { bfsFrom } from './bottleneck.js';

Object.assign(HELP, {
  'tool.naval': { t: '海战专项检查', s: '港口能不能出海、出海口多宽', b: '检查这几件事：<b>出生点附近有没有水</b>（没有就说明这张图没有海战）、<b>各队的船能不能互通</b>（被陆地围住就出不了海）、<b>能上岸的浅滩够不够</b>（太少海军打不进去）、<b>海面是不是连成一片</b>、<b>资源池有没有落在水里</b>。纯陆地图看到“没有海战”的提醒忽略就行。' },
});

const ed = A.ed;
const TW = 20;

function nearestOf(pass, W, H, x, y, mask) {
  for (let r = 0; r < 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const X = x + dx, Y = y + dy;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    if (pass[Y * W + X] & mask) return Y * W + X;
  }
  return -1;
}

// 检查海战相关的问题
export function navalCheck(ed2 = ed) {
  const m = ed2.map;
  if (!m) return null;
  const W = m.width, H = m.height, n = W * H;
  const pass = passability(ed2);
  const out = [];   // { level:'ok'|'warn'|'error', text, x, y }
  let navN = 0, landN = 0, bothN = 0;
  for (let i = 0; i < n; i++) {
    const c = pass[i];
    if (c & NAVAL) navN++;
    if (c & LAND) landN++;
    // 天然港口：这一格能走船，紧邻有一格能走陆军
    if ((c & NAVAL) && (c & LAND)) bothN++;
  }
  const spawns = ed2.spawns();
  const starts = spawns.map((s) => {
    const sx = Math.floor(s.cx / TW), sy = Math.floor(s.cy / TW);
    return {
      team: s.team, sx, sy,
      land: nearestOf(pass, W, H, sx, sy, LAND),
      naval: nearestOf(pass, W, H, sx, sy, NAVAL),
    };
  });
  out.push({ level: 'ok', text: `水面 ${navN.toLocaleString()} 格（${(navN / n * 100).toFixed(1)}%），陆地 ${landN.toLocaleString()} 格` });
  // 指挥中心周围有没有水
  for (const s of starts) {
    if (s.naval < 0) out.push({ level: 'warn', text: `第 ${s.team} 队出生点附近没有水面，这张图没有海战（如果本来就该是纯陆地图，忽略这条）`, x: s.sx, y: s.sy });
  }
  // 能走船的出生点，检查能不能互通
  const navalStarts = starts.filter((s) => s.naval >= 0);
  if (navalStarts.length >= 2) {
    const d = bfsFrom(pass, W, H, navalStarts.map((s) => s.naval), NAVAL);
    for (const s of navalStarts) {
      let reach = 0;
      for (const q of navalStarts) if (q !== s && d[q.naval] >= 0) reach++;
      if (reach === 0) out.push({ level: 'error', text: `第 ${s.team} 队的船出不了海，跟其它队的海域不通（可能是被陆地围住了）`, x: s.sx, y: s.sy });
    }
    // 出海口宽度：统计每条海岸线上"能同时走船和陆军"的格子，太少就是窄口
    const gates = [];
    for (let i = 0; i < n; i++) {
      if (!(pass[i] & NAVAL)) continue;
      const x = i % W, y = (i / W) | 0;
      let touchesLand = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        if (pass[Y * W + X] & LAND) { touchesLand = true; break; }
      }
      if (touchesLand) gates.push([x, y]);
    }
    out.push({ level: gates.length < 12 ? 'warn' : 'ok', text: `能上岸的浅滩一共 ${gates.length} 格${gates.length < 12 ? '，海军很难登陆，考虑多留几个口子' : ''}` });
    // 大块水面：能走船的区域被分成几块
    const seen = new Uint8Array(n);
    const seas = [];
    for (const s of navalStarts) {
      if (seen[s.naval]) continue;
      const d2 = bfsFrom(pass, W, H, [s.naval], NAVAL);
      let cnt = 0;
      for (let i = 0; i < n; i++) if (d2[i] >= 0) { seen[i] = 1; cnt++; }
      seas.push(cnt);
    }
    if (seas.length > 1) out.push({ level: 'warn', text: `海面被分成 ${seas.length} 块不通的水域（${seas.map((c) => c.toLocaleString()).join(' / ')} 格），检查一下是不是有陆地挡住了` });
    else out.push({ level: 'ok', text: `海面是连成一片的（${seas[0] ? seas[0].toLocaleString() : 0} 格）` });
  } else {
    out.push({ level: 'ok', text: '这张图没有海军出生点，跳过海战检查' });
  }
  // 资源池在海里的情况
  let poolInWater = 0;
  const pools = ed2.poolTiles();
  for (const [x, y] of pools) {
    const i = y * W + x;
    if (!(pass[i] & LAND) && (pass[i] & NAVAL)) poolInWater++;
  }
  if (poolInWater) out.push({ level: 'error', text: `${poolInWater} 个资源池在水里，打不到` });
  else if (pools.length) out.push({ level: 'ok', text: `${pools.length} 个资源池都在陆地上` });
  return { items: out, navN, landN, gates: 0, stats: { navPct: navN / n * 100, pools: pools.length } };
}

export function navalDialog() {
  if (!ed.map) return;
  const t0 = performance.now();
  const res = navalCheck();
  const ms = Math.round(performance.now() - t0);
  const icon = { ok: '✓', warn: '!', error: '✕' };
  const color = { ok: 'var(--ok)', warn: 'var(--warn)', error: 'var(--err)' };
  const body = h('div', {},
    h('div', { class: 'hint' }, `检查完成，用了 ${ms} ms`),
    h('div', { style: 'margin-top:8px' }, ...res.items.map((it) => h('div', {
      class: 'hrow', style: 'cursor:' + (it.x != null ? 'pointer' : 'default'),
      onclick: it.x != null ? () => A.rend.centerOn(it.x, it.y) : null,
    },
    h('span', { style: `color:${color[it.level]};font-weight:700;width:18px` }, icon[it.level]),
    h('span', { style: 'flex:1' }, it.text),
    it.x != null ? h('span', { class: 'hint' }, `${it.x},${it.y}`) : null))));
  return modal('海战专项检查', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
}
