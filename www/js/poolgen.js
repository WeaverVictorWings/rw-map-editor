// 资源池布局生成器：按队、按形状批量排布资源池，一步撤销
import { A } from './state.js';
import { h, modal, toast, segmented, slider, select } from './ui.js';
import { passability, LAND } from './pathing.js';

const ed = A.ed;
const TW = 20;

// 生成一套布局坐标（格坐标的池中心）。返回 [{team,tx,ty}]
export function planPoolLayout(opts) {
  const m = ed.map;
  const { shape = 'ring', teams = 2, perTeam = 3, radius = 0.32, spacing = 0, centerX = null, centerY = null } = opts;
  const W = m.width, H = m.height;
  const cx = centerX == null ? W / 2 : centerX;
  const cy = centerY == null ? H / 2 : centerY;
  const R = Math.max(4, Math.min(W, H) * radius);
  const spawns = ed.spawns();  // spawns() 返回的已经全是指挥中心
  const out = [];
  // 每个队的参考点：有出生点就用出生点，没有就按角度均分
  const anchors = [];
  for (let t = 0; t < teams; t++) {
    const sp = spawns.find((s) => s.team === t);
    if (sp) anchors.push({ team: t, x: sp.cx / TW, y: sp.cy / TW });
    else {
      const a = -Math.PI / 2 + (Math.PI * 2 * t) / teams;
      anchors.push({ team: t, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R });
    }
  }
  const free = (team, x, y) => {
    if (x < 1 || y < 1 || x > W - 2 || y > H - 2) return false;
    // 间距：跟同队已有池按切比雪夫距离判断
    for (const p of out) {
      if (p.team !== team) continue;
      if (Math.max(Math.abs(p.tx - x), Math.abs(p.ty - y)) < spacing + 1) return false;
    }
    return true;
  };
  // 想要的位置被占了就往外螺旋找最近的空位，保证每队都能放够
  const take = (team, x, y) => {
    if (free(team, x, y)) { out.push({ team, tx: x, ty: y }); return true; }
    for (let r = 1; r <= 12; r++) {
      const cand = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        cand.push([x + dx, y + dy]);
      }
      cand.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y));
      for (const [nx, ny] of cand) {
        if (free(team, nx, ny)) { out.push({ team, tx: nx, ty: ny }); return true; }
      }
    }
    return false;
  };
  for (const a of anchors) {
    const n = Math.max(1, perTeam);
    if (shape === 'line') {
      // 从出生点朝地图中心方向排一条线
      const dx = cx - a.x, dy = cy - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      for (let i = 0; i < n; i++) {
        const d = Math.min(len * 0.75, 4 + i * (spacing + 2));
        take(a.team, Math.round(a.x + ux * d), Math.round(a.y + uy * d));
      }
    } else if (shape === 'grid') {
      // 出生点旁边排一个小网格
      const cols = Math.ceil(Math.sqrt(n));
      for (let i = 0; i < n; i++) {
        const gx = a.x < cx ? -1 : 1, gy = a.y < cy ? -1 : 1;
        const r = Math.floor(i / cols), c = i % cols;
        take(a.team, Math.round(a.x + gx * (3 + c * (spacing + 1))), Math.round(a.y + gy * (3 + r * (spacing + 1))));
      }
    } else if (shape === 'cross') {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let i = 0; i < n; i++) {
        const [dx, dy] = dirs[i % 4];
        const d = 3 + Math.floor(i / 4) * (spacing + 2);
        take(a.team, Math.round(a.x + dx * d), Math.round(a.y + dy * d));
      }
    } else {
      // ring：围绕出生点画一圈
      const base = Math.atan2(a.y - cy, a.x - cx) || 0;
      const arc = Math.min(Math.PI * 1.6, (Math.PI * 2) / teams);
      for (let i = 0; i < n; i++) {
        const ang = base + arc * (n === 1 ? 0 : (i / (n - 1) - 0.5));
        const rr = 3 + Math.floor(i / 6) * (spacing + 2);
        take(a.team, Math.round(a.x + Math.cos(ang) * rr), Math.round(a.y + Math.sin(ang) * rr));
      }
    }
  }
  // 过滤掉不可建造的格子
  const pass = passability(ed);
  const ok = [];
  for (const p of out) {
    const i = p.ty * W + p.tx;
    if ((pass[i] & LAND) !== 0) ok.push(p);
  }
  return ok;
}

export function poolGenDialog() {
  if (!ed.map) return;
  let shape = 'ring', teams = Math.max(2, ed.spawns().length), perTeam = 3, radius = 0.32, spacing = 0;
  const count = h('div', { class: 'hint' });
  const prev = h('canvas', { width: 260, height: 200, style: 'border:1px solid var(--line);border-radius:8px;background:#111' });
  const redraw = () => {
    const c = prev.getContext('2d');
    const m = ed.map;
    c.fillStyle = '#1b2418'; c.fillRect(0, 0, prev.width, prev.height);
    const sx = prev.width / m.width, sy = prev.height / m.height;
    // 出生点
    c.fillStyle = '#4aa3ff';
    for (const s of ed.spawns()) c.fillRect(s.cx / 20 * sx - 2, s.cy / 20 * sy - 2, 5, 5);
    const plan = planPoolLayout({ shape, teams, perTeam, radius, spacing });
    const cols = ['#ffcc55', '#ff7a7a', '#7affc0', '#c07aff', '#f6f', '#7ad4ff', '#fff'];
    for (const p of plan) {
      c.fillStyle = cols[p.team % cols.length];
      c.fillRect(p.tx * sx - 2, p.ty * sy - 2, 5, 5);
    }
    const byTeam = {};
    for (const p of plan) byTeam[p.team] = (byTeam[p.team] || 0) + 1;
    count.textContent = plan.length
      ? `将放 ${plan.length} 个资源池：` + Object.entries(byTeam).map(([t, n]) => `第${t}队 ${n}`).join('、')
      : '当前设置放不下任何资源池，试着调小间距或换形状。';
  };
  const body = h('div', {},
    h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' },
      prev,
      h('div', { style: 'flex:1;min-width:240px' },
        segmented([['ring', '围绕出生点']], shape, () => {}),
        slider('每队数量', 1, 12, perTeam, (v) => { perTeam = v; redraw(); }),
        slider('最小间距（格）', 0, 8, spacing, (v) => { spacing = v; redraw(); }, { fmt: (v) => v === 0 ? '紧挨着' : v }),
        radius !== null ? null : null)),
    count);
  const sh = h('div', { class: 'seg', style: 'margin:8px 0' });
  for (const [v, l] of [['ring', '围一圈'], ['line', '朝中心一条线'], ['grid', '小方阵'], ['cross', '十字四个']]) {
    sh.append(h('button', { class: v === shape ? 'on' : '', onclick: (e) => { shape = v; for (const b of sh.children) b.classList.toggle('on', b === e.currentTarget); redraw(); } }, l));
  }
  body.insertBefore(sh, body.firstChild);
  body.insertBefore(h('div', { class: 'field' }, h('label', {}, '队伍数（要在出生点朝向上铺开）'),
    select([1, 2, 3, 4].map((n) => [n, `${n} 队`]), teams, (v) => { teams = +v; redraw(); })), body.children[1]);
  redraw();
  return modal('资源池布局生成器', body, [
    { label: '取消', value: 0 },
    { label: '放进去', value: 1, primary: true },
  ], { wide: true }).then((v) => {
    if (!v) return;
    const plan = planPoolLayout({ shape, teams, perTeam, radius, spacing });
    if (!plan.length) { toast('没有可放置的位置'); return; }
    const pool = (ed.items || []).find((it) => it.pool);
    if (!pool) { toast('没找到资源池物品，先打开一张有资源池的地图'); return; }
    ed.begin && ed.begin('批量放资源池');
    let n = 0;
    for (const p of plan) if (ed.placeItemOne && ed.placeItemOne(ed.map.items, pool, p.tx, p.ty)) n++;
    ed.commit && ed.commit();
    A.rend.request && A.rend.request();
    A.refresh();
    toast(`放了 ${n} 个资源池（可以一步撤销）`);
  });
}
