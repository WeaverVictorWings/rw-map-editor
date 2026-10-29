// 批量操作：给资源池周围加一圈、重新排布各队出生点。都先预览再应用，整次一步撤销。
import { A } from './state.js';
import { h, modal, toast, slider, select, segmented } from './ui.js';
import { passability, LAND } from './pathing.js';

const ed = A.ed, TW = 20;

// ---------- 资源池周围加一圈 ----------
export function planRing(opts) {
  const m = ed.map, W = m.width, H = m.height;
  const { count = 6, radius = 3, mode = 'all' } = opts;
  const pools = ed.poolTiles();
  const pass = passability(ed);
  const taken = new Set(pools.map(([x, y]) => y * W + x));
  const out = []; let skipped = 0;
  const near = (x, y) => { for (const [px, py] of pools) if (Math.max(Math.abs(px - x), Math.abs(py - y)) < 1) return true; return false; };
  const targets = mode === 'all' ? pools : pools.filter(([x, y]) => {
    const s = ed.sel; if (!s) return false; return x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h;
  });
  for (const [px, py] of targets) {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count;
      const x = Math.round(px + Math.cos(a) * radius), y = Math.round(py + Math.sin(a) * radius);
      const key = y * W + x;
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2 || taken.has(key) || near(x, y) || !(pass[key] & LAND)) { skipped++; continue; }
      taken.add(key); out.push({ tx: x, ty: y });
    }
  }
  return { plan: out, skipped, sources: targets.length };
}

export function ringPoolsDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  if (!ed.poolTiles().length) { toast('这张图上还没有资源池'); return; }
  let count = 6, radius = 3, mode = 'all';
  const info = h('div', { class: 'hint' });
  const hasSel = !!ed.sel;
  const upd = () => {
    const r = planRing({ count, radius, mode });
    info.textContent = r.sources ? `围绕 ${r.sources} 个资源池，新增 ${r.plan.length} 个` + (r.skipped ? `，跳过 ${r.skipped} 个（水里、出界或重叠）` : '') : '选区里没有资源池，先框选一块区域，或改选“全部资源池”。';
  };
  const body = h('div', {},
    h('div', { class: 'field' }, h('label', {}, '对象'), segmented([['all', '全部资源池'], ['sel', hasSel ? '选区内的资源池' : '选区内的资源池（先框选）']], mode, (v) => { mode = v; upd(); })),
    slider('每个资源池周围加几个', 2, 12, count, (v) => { count = v; upd(); }),
    slider('离中心多远（格）', 2, 10, radius, (v) => { radius = v; upd(); }),
    info);
  upd();
  return modal('资源池周围加一圈', body, [{ label: '取消', value: 0 }, { label: '放进去', value: 1, primary: true }], { wide: true }).then((v) => {
    if (!v) return;
    const { plan } = planRing({ count, radius, mode });
    if (!plan.length) { toast('没有可放的位置'); return; }
    const pool = (ed.items || []).find((it) => it.pool);
    if (!pool) { toast('没找到资源池物品'); return; }
    const L = ed.map.ensureLayer('Items');
    ed.begin('资源池加一圈');
    for (const p of plan) ed.placeItemOne(L, pool, p.tx, p.ty);
    ed.commit(); A.rend.request(); A.refresh();
    toast(`加了 ${plan.length} 个资源池（可以一步撤销）`);
  });
}

// ---------- 重新排布出生点 ----------
function targets(layout, n, W, H, gap) {
  const out = [], cx = W / 2, cy = H / 2;
  if (layout === 'ring') { const R = Math.min(W, H) * (0.5 - gap); for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (Math.PI * 2 * i) / n; out.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); } }
  else if (layout === 'lr' || layout === 'tb') {
    const half = Math.ceil(n / 2), side = (k, tot, len) => (len * (k + 1)) / (tot + 1);
    for (let i = 0; i < n; i++) { const left = i < half, k = left ? i : i - half, tot = left ? half : n - half; const along = side(k, tot, layout === 'lr' ? H : W), across = (left ? gap : 1 - gap) * (layout === 'lr' ? W : H); out.push(layout === 'lr' ? [across, along] : [along, across]); }
  } else { const c = Math.ceil(Math.sqrt(n)), r = Math.ceil(n / c); for (let i = 0; i < n; i++) out.push([((i % c) + 0.5) * (W / c), (Math.floor(i / c) + 0.5) * (H / r)]); }
  return out;
}
function snapLand(pass, W, H, x, y) {
  x = Math.max(2, Math.min(W - 3, Math.round(x))); y = Math.max(2, Math.min(H - 3, Math.round(y)));
  for (let r = 0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const X = x + dx, Y = y + dy; if (X < 2 || Y < 2 || X > W - 3 || Y > H - 3) continue;
    if ((pass[Y * W + X] & LAND) && (pass[Y * W + X + 1] & LAND) && (pass[(Y + 1) * W + X] & LAND)) return [X, Y];
  }
  return [x, y];
}
function nearestPool(pools, x, y) { let b = Infinity; for (const [px, py] of pools) b = Math.min(b, Math.hypot(px - x, py - y)); return b; }

export function planRelayout(layout, gap) {
  const m = ed.map, W = m.width, H = m.height;
  const sp = ed.spawns().filter((s) => s.team >= 0).sort((a, b) => a.team - b.team);
  const pass = passability(ed), pools = ed.poolTiles();
  const ts = targets(layout, sp.length, W, H, gap);
  return sp.map((s, i) => {
    const [tx, ty] = snapLand(pass, W, H, ts[i][0], ts[i][1]);
    const fx = s.cx / TW, fy = s.cy / TW;
    return { s, from: [fx, fy], to: [tx + 0.5, ty + 0.5], dPool: pools.length ? nearestPool(pools, tx, ty) : null, dPoolOld: pools.length ? nearestPool(pools, fx, fy) : null };
  });
}

export function relayoutDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const n = ed.spawns().filter((s) => s.team >= 0).length;
  if (n < 2) { toast('至少要有 2 个出生点才能重新排布'); return; }
  let layout = 'ring', gap = 0.12;
  const info = h('div', { class: 'hint', style: 'white-space:pre-line' });
  const prev = h('canvas', { width: 260, height: 200, style: 'border:1px solid var(--line);border-radius:8px;background:#111' });
  const redraw = () => {
    const plan = planRelayout(layout, gap), c = prev.getContext('2d'), sx = prev.width / ed.map.width, sy = prev.height / ed.map.height;
    c.fillStyle = '#1b2418'; c.fillRect(0, 0, prev.width, prev.height);
    c.fillStyle = '#ffcc55'; for (const [x, y] of ed.poolTiles()) c.fillRect(x * sx - 1, y * sy - 1, 3, 3);
    plan.forEach((p, i) => { c.strokeStyle = '#555'; c.beginPath(); c.moveTo(p.from[0] * sx, p.from[1] * sy); c.lineTo(p.to[0] * sx, p.to[1] * sy); c.stroke(); c.fillStyle = '#4aa3ff'; c.fillRect(p.to[0] * sx - 3, p.to[1] * sy - 3, 7, 7); c.fillStyle = '#fff'; c.fillText(String(p.s.team + 1), p.to[0] * sx + 5, p.to[1] * sy - 4); });
    const d = plan.map((p) => p.dPool).filter((x) => x != null);
    info.textContent = d.length ? `各队离最近资源池：${plan.map((p) => `第${p.s.team + 1}队 ${p.dPool.toFixed(0)} 格`).join('、')}\\n` + (Math.max(...d) - Math.min(...d) > 6 ? '提示：差距比较大，放完后可以用“资源池布局生成器”或“一键平衡”补一补。' : '各队离资源池的距离比较接近。') : '这张图上没有资源池，放完后记得补上。';
    info.textContent = info.textContent.replace(/\\n/g, '\n');
  };
  const body = h('div', {},
    h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, prev, h('div', { style: 'flex:1;min-width:240px' },
      h('div', { class: 'field' }, h('label', {}, '排法'), select([['ring', '围成一圈'], ['lr', '左右对阵'], ['tb', '上下对阵'], ['grid', '均匀网格']], layout, (v) => { layout = v; redraw(); })),
      slider('离边缘多远', 5, 30, Math.round(gap * 100), (v) => { gap = v / 100; redraw(); }, { fmt: (v) => v + '%' }))),
    info, h('div', { class: 'hint' }, '每队的指挥中心和身边的建造者一起搬走，会自动躲开水面。资源池、触发器和区域不会动，搬完请检查一下。'));
  redraw();
  return modal('重新排布出生点', body, [{ label: '取消', value: 0 }, { label: '搬过去', value: 1, primary: true }], { wide: true }).then((v) => {
    if (!v) return;
    const plan = planRelayout(layout, gap);
    ed.begin('重新排布出生点');
    const done = new Set();
    for (const { s, from, to } of plan) {
      const dx = Math.round((to[0] - from[0])) * TW, dy = Math.round((to[1] - from[1])) * TW;
      for (const G of ed.map.groups) {
        if (!done.has(G)) { ed.op.snapshotGroup(G); done.add(G); }
        for (const o of G.objects) {
          const t = o.props && o.props.find ? o.props.find((q) => q.name === 'team') : null;
          if (!t || +t.value !== s.team || o.attrs.x === undefined) continue;
          const ox = +o.attrs.x + (+o.attrs.width || 0) / 2, oy = +o.attrs.y - (+o.attrs.height || 0) / 2;
          if (Math.hypot(ox - s.cx, oy - s.cy) > 8 * TW) continue;
          o.attrs.x = String(+o.attrs.x + dx); o.attrs.y = String(+o.attrs.y + dy);
        }
      }
    }
    ed.commit(); A.rend.request(); A.refresh();
    toast('已重新排布，可以一步撤销。记得再点“能玩吗？”检查一下');
  });
}
