// 一键平衡（2.4 #1）：按步行距离比较各队拿到的资源，自动挪动/新增资源池，让各队接近
//
// 对外 API（lead 接线用，签名固定）：
//   planBalance(ed, opts)  → 纯只读：算出计划 + 改动前后对比，不改地图
//   applyBalance(ed, plan) → 改地图（一个 ed.begin/commit，可一次撤销），返回改动数
//   balanceDialog()        → 对话框：改动前/后对比、列出改动、地图预览、应用
//
// 2.4 约定：
//   · 资源池一律 1×1（ed.stampCells(poolItem, '1x1') 求出要写的格子，不硬编码 3×3）；
//   · 只改 Items 层里的资源池格：不动地形、不动单位、不新增/删除对象
//     → 撤销后 .tmx 序列化逐字节一致（不会改到 nextobjectid）；
//   · 通行/距离复用 pathing.js 的 passability / balanceReport（不自己写 BFS）；
//   · 确定性：不用 Math.random，候选顺序只取决于地图内容。
import { A } from './state.js';
import { balanceReport, passability, LAND, BUILD } from './pathing.js';
import { objProp } from './tmx.js';
import { h, modal, toast, toggle } from './ui.js';
import { icon } from './icons.js';

const POOL_STYLE = '1x1';   // 2.4：资源池统一按 1 格处理
const RING_MIN = 8;         // 新增资源池的环带（离出生点格数）
const RING_MAX = 14;
const TOL_NEAREST = 2;      // 最近资源池差 2 格以内就算公平
const NEAR_WEIGHT = 3;      // “30 格内数量差 1 个”按 3 格算，加权比较
const MAX_WAVES = 3;        // 最多 3 轮：每轮用精确的 balanceReport 重新评估

// ---------------------------------------------------------------- 小工具
function poolItemOf(ed) {
  if (!ed || !ed.items) return null;
  return ed.items.find((i) => i.pool) || null;
}
// 资源池要写的格子：默认 1×1，只有 1 格；返回 [[dx, dy, gid], ...]
function poolCells(ed, it) {
  if (!it) return [];
  if (it.stamp) return ed.stampCells(it, POOL_STYLE);
  return [[0, 0, it.variants[0]]];   // 兜底：没有 3×3 拼图的资源池
}
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function rgba(r, g, b, a) { return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; }

// 每格是否被单位占着：单位周围再留 1 格，避免资源池紧贴单位（2.4 检查会提醒贴单位）
function unitMaskOf(ed) {
  const m = ed.map, W = m.width, H = m.height;
  const mask = new Uint8Array(W * H);
  const objs = ed.allObjects ? ed.allObjects() : [];
  for (const { o } of objs) {
    if (!objProp(o, 'unit')) continue;
    const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0);
    const w = +(o.attrs.width || 0), hh = +(o.attrs.height || 0);
    const x0 = Math.floor((x - w) / 20) - 1, x1 = Math.floor((x + w) / 20) + 1;
    const y0 = Math.floor((y - hh) / 20) - 1, y1 = Math.floor((y + hh) / 20) + 1;
    for (let Y = Math.max(0, y0); Y <= Math.min(H - 1, y1); Y++) {
      for (let X = Math.max(0, x0); X <= Math.min(W - 1, x1); X++) mask[Y * W + X] = 1;
    }
  }
  return mask;
}

// 用假的 ed 包一层，让 balanceReport 计算“假设资源池在这里”时的数值（只读，不改地图）
function reportWith(ed, radius, tiles) {
  return balanceReport({ map: ed.map, spawns: () => ed.spawns(), poolTiles: () => tiles }, radius);
}
// 只算一支队伍：比全量快很多（plan 内部每次改动后用来自检）
function measureTeam(ed, radius, team, tiles) {
  const sp = ed.spawns().filter((s) => s.team === team);
  if (!sp.length) return null;
  const rep = balanceReport({ map: ed.map, spawns: () => sp, poolTiles: () => tiles }, radius);
  return rep.rows[0] || null;
}

// 这支队伍的“欠账”：near 少几个 / nearest 远几格
function teamDeficit(row, target) {
  if (!row || !target) return { nearDef: 0, nearestDef: 0, score: 0 };
  const near = row.near == null ? 0 : row.near;
  const nearDef = Math.max(0, (target.near || 0) - near);
  let nearestDef = 0;
  if (target.nearest != null) {
    if (row.nearest == null) nearestDef = 8;   // 一个资源池都走不到：按还差 8 格算
    else nearestDef = Math.max(0, row.nearest - (target.nearest + TOL_NEAREST));
  }
  return { nearDef, nearestDef, score: nearDef * NEAR_WEIGHT + nearestDef };
}
function unfairness(rows, target) {
  let u = 0;
  for (const r of rows || []) {
    const d = teamDeficit(r, target);
    const near = r.near == null ? 0 : r.near;
    const surplus = Math.max(0, near - (target.near || 0));   // 资源多出来也算不公平（删池子时才用得上）
    u += (d.nearDef + surplus) * NEAR_WEIGHT + d.nearestDef;
  }
  return u;
}
// 改完之后是不是确实变好了：附近的池子多了，或者最近的池子更近了
function betterForTeam(a, b) {
  if (!a || !b) return false;
  if ((b.near ?? 0) > (a.near ?? 0)) return true;
  if (a.nearest == null) return b.nearest != null;
  if (b.nearest == null) return false;
  return b.nearest < a.nearest;
}

// 轴向环带候选：从近到远、先朝地图中心，完全确定的顺序
function ringCells(sx, sy, W, H) {
  const out = [];
  const seen = new Set();
  const centerAng = Math.atan2(H / 2 - sy, W / 2 - sx);
  for (let d = RING_MIN; d <= RING_MAX; d++) {
    const n = Math.max(8, Math.round(d * 1.7));
    for (let i = 0; i < n; i++) {
      const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2);
      const ang = centerAng + off * (Math.PI * 2 / n);
      const x = Math.round(sx + d * Math.cos(ang)), y = Math.round(sy + d * Math.sin(ang));
      const key = x + ',' + y;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([x, y]);
    }
  }
  return out;
}

// 判断地图是不是左右/旋转对称（出生点成对出现）。返回 'lr' | 'tb' | 'rot' | null
function detectSymmetry(ed) {
  const m = ed.map;
  if (!m) return null;
  const W = m.width, H = m.height;
  const sp = ed.spawns().filter((s) => s.team >= 0);
  if (sp.length < 2) return null;
  const tiles = sp.map((s) => [Math.floor(s.cx / 20), Math.floor(s.cy / 20)]);
  const mir = (kind, x, y) => (kind === 'lr' ? [W - 1 - x, y] : kind === 'tb' ? [x, H - 1 - y] : [W - 1 - x, H - 1 - y]);
  for (const kind of ['lr', 'tb', 'rot']) {
    let ok = true;
    for (let i = 0; i < tiles.length && ok; i++) {
      const [mx, my] = mir(kind, tiles[i][0], tiles[i][1]);
      ok = tiles.some(([qx, qy], j) => j !== i && Math.abs(qx - mx) <= 2 && Math.abs(qy - my) <= 2);
    }
    if (ok) return kind;
  }
  return null;
}
function mirrorCell(sym, x, y, W, H) {
  if (sym === 'lr') return [W - 1 - x, y];
  if (sym === 'tb') return [x, H - 1 - y];
  if (sym === 'rot') return [W - 1 - x, H - 1 - y];
  return [x, y];
}

// ---------------------------------------------------------------- 计划
// 返回 { report, target, moves, adds, removes, summary:{teams,before,after}, symmetry, changes, notes }
// 纯计算：不修改地图，不改撤销栈
export function planBalance(ed, opts = {}) {
  const radius = Number.isFinite(opts.radius) ? Math.max(1, Math.floor(opts.radius)) : 30;
  const maxChanges = Number.isFinite(opts.maxChanges) ? Math.max(0, Math.floor(opts.maxChanges)) : 24;
  const allowRemove = !!opts.allowRemove;
  const notes = [];
  const empty = (reason, rep = null) => ({
    report: rep, target: { nearest: null, near: null },
    moves: [], adds: [], removes: [],
    summary: rep
      ? { teams: rep.teams, before: { rows: rep.rows, fair: rep.fair }, after: { rows: rep.rows, fair: rep.fair } }
      : { teams: [], before: null, after: null },
    symmetry: null, changes: 0, notes: [reason],
  });

  if (!ed || !ed.map) return empty('还没有打开地图');
  const poolItem = poolItemOf(ed);
  if (!poolItem) return empty('这张地图没有资源池图块：先打开一张带资源池的地图');
  if (!ed.spawns().some((s) => s.team >= 0)) return empty('地图上还没有出生点');
  const before = balanceReport(ed, radius);
  const rows = before.rows || [];
  if (!rows.length) return empty('地图上还没有出生点');
  if (rows[0].near == null) return empty('队伍超过 24 支：资源数量平衡暂时只支持 24 队以内');

  const nstVals = rows.map((r) => r.nearest).filter((v) => v != null && Number.isFinite(v));
  const nearVals = rows.map((r) => (r.near == null ? 0 : r.near));
  // 目标值：各队中位数；near 至少 1（旁边一个资源池都没有的队肯定算吃亏）
  const target = { nearest: nstVals.length ? median(nstVals) : null, near: Math.max(1, median(nearVals)) };

  const f = before.fair;
  if (f && f.nearestSpread <= TOL_NEAREST + 1 && f.nearSpread <= 1) {
    const plan = empty('已经比较公平：各队最近的资源池相差 3 格以内、30 格内数量相差 1 个以内', before);
    plan.target = target;
    return plan;
  }

  let pools = ed.poolTiles().map(([x, y]) => ({ x, y, kind: 'existing', moved: false }));
  if (!pools.length) {
    const plan = empty('地图上还没有资源池：先用画笔或“随机生成”放一些资源池', before);
    plan.target = target;
    return plan;
  }

  const m = ed.map, W = m.width, H = m.height;
  const I = m.items || null;
  const pass = passability(ed);
  const unitMask = unitMaskOf(ed);
  const sym = opts.symmetry !== undefined ? opts.symmetry : detectSymmetry(ed);
  if (sym) notes.push('地图是对称的：只做“镜像补齐”，保持左右/中心对称');
  const spawnTiles = ed.spawns().filter((s) => s.team >= 0)
    .map((s) => ({ team: s.team, x: Math.floor(s.cx / 20), y: Math.floor(s.cy / 20) }));

  const tilesOf = (list) => list.map((p) => [p.x, p.y]);
  const hasPoolNear = (x, y, r) => pools.some((p) => Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r);
  // 能不能在这里放一个 1×1 资源池：陆地 + 可建造、不贴边、不压单位/物品、和别的池子留空
  const okCell = (x, y, gap = 2, ignore = null) => {
    if (x < 1 || y < 1 || x > W - 2 || y > H - 2) return false;      // 地图边缘
    const i = y * W + x;
    if (!(pass[i] & LAND) || !(pass[i] & BUILD)) return false;       // 水里 / 悬崖 / 不可建造
    if (unitMask[i]) return false;                                   // 单位身上或紧贴单位
    if (I && I.data[i]) return false;                                // 已经有物品（树、别的池子…）
    if (gap > 0) for (const p of pools) {
      if (p === ignore) continue;
      if (Math.abs(p.x - x) <= gap && Math.abs(p.y - y) <= gap) return false;
    }
    return true;
  };
  const ownerAt = (rep, p) => (rep && rep.owner ? rep.owner[p.y * W + p.x] : -1);

  // --- 具体动作：都返回 true 表示真的改了 pools 并记进 out ---

  // 新增：8~14 格环带，挑第一个“确实让这队变好”的位置
  const tryAdd = (team, row, out) => {
    const sx = Math.floor(row.x / 20), sy = Math.floor(row.y / 20);
    const beforeRow = measureTeam(ed, radius, team, tilesOf(pools));
    if (!beforeRow) return false;
    let tried = 0;
    for (const [x, y] of ringCells(sx, sy, W, H)) {
      const gap = okCell(x, y, 2) ? 2 : okCell(x, y, 1) ? 1 : 0;
      if (!gap) continue;
      if (++tried > 6) return false;                                 // 最多试 6 个位置
      const p = { x, y, kind: 'new', moved: false };
      pools.push(p);
      const after = measureTeam(ed, radius, team, tilesOf(pools));
      if (betterForTeam(beforeRow, after)) { out.push({ x, y }); return true; }
      pools.pop();
    }
    return false;
  };

  // 挪动：把“这队地盘的最近的资源池”朝出生点方向挪 1~3 格
  // 只挪这队自己地盘（owner === k）里的池子：挪别人的池子会把别人的资源带走，越改越不公平
  const tryMove = (k, team, row, rep, out) => {
    if (row.nearest == null) return false;
    const sx = Math.floor(row.x / 20), sy = Math.floor(row.y / 20);
    const cand = pools
      .filter((p) => p.kind === 'existing' && !p.moved && ownerAt(rep, p) === k)
      .map((p) => ({ p, d: Math.abs(p.x - sx) + Math.abs(p.y - sy) }))
      .sort((a, b) => a.d - b.d || a.p.x - b.p.x || a.p.y - b.p.y)
      .slice(0, 3);
    for (const { p } of cand) {
      // 确认它确实是这队最近的那个池子（单池量一次距离，和报告里的 nearest 对上）
      const only = measureTeam(ed, radius, team, [[p.x, p.y]]);
      if (!only || only.nearest !== row.nearest) continue;
      const dx = sx - p.x, dy = sy - p.y;
      const len = Math.hypot(dx, dy);
      for (const step of [3, 2, 1]) {
        if (len <= step) continue;
        const tx = Math.round(p.x + (dx / len) * step), ty = Math.round(p.y + (dy / len) * step);
        if (tx === p.x && ty === p.y) continue;
        if (!okCell(tx, ty, 1, p)) continue;
        const ox = p.x, oy = p.y;
        p.x = tx; p.y = ty;
        const after = measureTeam(ed, radius, team, tilesOf(pools));
        if (after && row.nearest != null && after.nearest != null && after.nearest < row.nearest) {
          p.moved = true;
          out.push({ x: ox, y: oy, toX: tx, toY: ty });
          return true;
        }
        p.x = ox; p.y = oy;
      }
    }
    return false;
  };

  // 对称图：把“没镜像的另一半”补上，一次补 1 个（另一边已经存在）
  const tryMirrorRestore = (team, row, out) => {
    const sx = Math.floor(row.x / 20), sy = Math.floor(row.y / 20);
    const cand = [];
    for (const p of pools) {
      if (p.kind !== 'existing' || p.moved) continue;
      const [mx, my] = mirrorCell(sym, p.x, p.y, W, H);
      if (mx < 1 || my < 1 || mx > W - 2 || my > H - 2) continue;
      if (hasPoolNear(mx, my, 0)) continue;                          // 对面已经有镜像了
      const d = Math.hypot(mx - sx, my - sy);
      if (d > radius) continue;                                      // 太远，补了也帮不上这队
      cand.push([mx, my, d]);
    }
    cand.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
    const beforeRow = measureTeam(ed, radius, team, tilesOf(pools));
    if (!beforeRow) return false;
    let tried = 0;
    for (const [x, y] of cand) {
      if (!okCell(x, y, 1)) continue;
      if (++tried > 6) return false;
      pools.push({ x, y, kind: 'new', moved: false });
      const after = measureTeam(ed, radius, team, tilesOf(pools));
      if (betterForTeam(beforeRow, after)) { out.push({ x, y }); return true; }
      pools.pop();
    }
    return false;
  };

  // 删除（可选）：只删“本队附近、离其他出生点都很远”的多余资源池
  const tryRemove = (k, team, row, rep, out) => {
    const sx = Math.floor(row.x / 20), sy = Math.floor(row.y / 20);
    const others = spawnTiles.filter((s) => s.team !== team);
    const cand = pools
      .filter((p) => p.kind === 'existing' && !p.moved)
      .filter((p) => {
        const dc = Math.max(Math.abs(p.x - sx), Math.abs(p.y - sy));
        if (dc > radius) return false;
        return others.every((s) => Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) > radius);
      })
      .map((p) => ({ p, own: ownerAt(rep, p) === k ? 0 : 1, d: Math.abs(p.x - sx) + Math.abs(p.y - sy) }))
      .sort((a, b) => a.own - b.own || b.d - a.d || a.p.x - b.p.x || a.p.y - b.p.y);
    if (!cand.length) return false;
    const p = cand[0].p;
    const idx = pools.indexOf(p);
    pools.splice(idx, 1);
    const after = measureTeam(ed, radius, team, tilesOf(pools));
    if (after && (after.near ?? 0) < (row.near ?? 0)) {
      out.push({ x: p.x, y: p.y });
      return true;
    }
    pools.splice(idx, 0, p);
    return false;
  };

  // --- 按轮推进：每轮用精确报告找最亏的队，改完立刻用精确报告复核 ---
  const planAdds = [], planMoves = [], planRemoves = [];
  let budget = maxChanges;
  let curReport = before;

  for (let wave = 0; wave < MAX_WAVES && budget > 0; wave++) {
    const curRows = curReport.rows;
    const order = curRows
      .map((r, k) => ({ r, k, d: teamDeficit(r, target) }))
      .filter((e) => e.d.score > 0)
      .sort((a, b) => b.d.score - a.d.score || a.r.team - b.r.team);
    // 可选：资源明显多出来的队（对称图不删，删了会破坏对称）
    const surplus = allowRemove && !sym
      ? curRows.map((r, k) => ({ r, k, s: (r.near == null ? 0 : r.near) - target.near }))
        .filter((e) => e.s >= 2)
        .sort((a, b) => b.s - a.s || a.r.team - b.r.team)
      : [];
    if (!order.length && !surplus.length) break;
    const snapshot = pools.map((p) => ({ ...p }));
    const wAdds = [], wMoves = [], wRemoves = [];
    let acted = 0;
    for (const { r, k } of order) {
      if (budget <= 0) break;
      for (let guard = 0; guard < 2 && budget > 0; guard++) {
        const row = measureTeam(ed, radius, r.team, tilesOf(pools));
        const d = teamDeficit(row, target);
        if (d.score <= 0) break;
        let done = false;
        if (sym) done = tryMirrorRestore(r.team, row, wAdds);
        else if (d.nearestDef > 0) done = tryMove(k, r.team, row, curReport, wMoves);
        if (!done && !sym) done = tryAdd(r.team, row, wAdds);
        if (!done && !sym && allowRemove) done = tryRemove(k, r.team, row, curReport, wRemoves);
        if (!done) break;
        acted++; budget--;
      }
    }
    for (const { r, k } of surplus) {
      if (budget <= 0) break;
      const row = measureTeam(ed, radius, r.team, tilesOf(pools));
      if (!row) continue;
      if (tryRemove(k, r.team, row, curReport, wRemoves)) { acted++; budget--; }
    }
    if (!acted) break;
    const after = reportWith(ed, radius, tilesOf(pools));
    if (unfairness(after.rows, target) >= unfairness(curRows, target)) {
      // 这一轮没有实际改善：整轮回滚，别留下半吊子改动
      pools = snapshot;
      budget += acted;
      notes.push('有些队伍在环带里找不到能放资源池的位置（水域/悬崖/没空地），这部分没动');
      break;
    }
    planAdds.push(...wAdds); planMoves.push(...wMoves); planRemoves.push(...wRemoves);
    curReport = after;
  }

  const after = curReport;
  const changes = planAdds.length + planMoves.length + planRemoves.length;
  if (!changes && maxChanges === 0) notes.push('改动上限设成了 0，所以什么都没改');
  else if (!changes && sym) notes.push('对称图上能镜像补齐的位置都补完了：剩下的差距要删掉多的一侧，对称图不会单边删池子');
  else if (!changes && !notes.length) notes.push('找不到能改善公平的位置（水域/悬崖/地图边缘挡住了），可以手动补几个资源池');
  return {
    report: before,
    target,
    moves: planMoves,
    adds: planAdds,
    removes: planRemoves,
    summary: {
      teams: before.teams,
      before: { rows: before.rows, fair: before.fair },
      after: { rows: after.rows, fair: after.fair },
    },
    symmetry: sym,
    changes,
    notes,
  };
}

// ---------------------------------------------------------------- 应用
// 一次性写入（一个 undo 步骤），返回实际改动的资源池个数
export function applyBalance(ed, plan) {
  if (!ed || !ed.map || !plan) return 0;
  const item = poolItemOf(ed);
  if (!item) return 0;
  const cells = poolCells(ed, item);
  if (!cells.length) return 0;
  const m = ed.map, W = m.width, H = m.height;
  const adds = plan.adds || [], moves = plan.moves || [], removes = plan.removes || [];
  if (!adds.length && !moves.length && !removes.length) return 0;
  const L = m.ensureLayer('Items');
  const poolGids = ed.poolGids || new Set();
  const gidAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : L.data[y * W + x]);
  const isPool = (x, y) => { const g = gidAt(x, y); return !!g && poolGids.has(g); };
  const isEmpty = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !L.data[y * W + x];
  const clear = (x, y) => { for (const [dx, dy] of cells) ed.setTile(L, x + dx, y + dy, 0); };
  const put = (x, y) => { for (const [dx, dy, gid] of cells) ed.setTile(L, x + dx, y + dy, gid); };

  ed.begin('一键平衡');
  let n = 0;
  for (const r of removes) {
    if (!isPool(r.x, r.y)) continue;                 // 地图变了：不是资源池就不动
    clear(r.x, r.y); n++;
  }
  for (const mv of moves) {
    if (!isPool(mv.x, mv.y)) continue;
    if (!isEmpty(mv.toX, mv.toY)) continue;          // 目标格被占了：跳过，别覆盖别人的东西
    clear(mv.x, mv.y); put(mv.toX, mv.toY); n++;
  }
  for (const a of adds) {
    if (!isEmpty(a.x, a.y)) continue;
    put(a.x, a.y); n++;
  }
  ed.commit();
  if (!n) return 0;

  // 刷新渲染/小地图/报告（和 detailui.js 的做法一致）
  const rend = A.rend;
  if (rend) {
    rend.invalidateAll();
    rend.pools = ed.poolTiles();
  }
  if (A.mini && A.mini.schedule) A.mini.schedule();
  A.report = null;
  A.symDiff = null;
  A.autoDirty = true;
  if (A.refresh) A.refresh('top', 'dock');
  return n;
}

// ---------------------------------------------------------------- 对话框
function fmt(v, unit = '') { return v == null ? '—' : String(v) + unit; }
function arrow(a, b, unit = '') {
  if (a == null && b == null) return '—';
  if (a == null) return '— → ' + fmt(b, unit);
  if (b == null) return fmt(a, unit) + ' → —';
  if (a === b) return fmt(a, unit);
  return h('span', { class: b < a ? 'good' : '' }, `${a}${unit} → ${b}${unit}`);
}

export async function balanceDialog() {
  const ed = A.ed;
  if (!ed || !ed.map) { toast('先打开一张地图'); return; }
  let allowRemove = false;
  let plan = planBalance(ed, { allowRemove });
  let previewOn = false;
  const rend = A.rend;
  const prevTint = rend ? rend.tint : null;
  const body = h('div');
  const modalEls = () => document.querySelectorAll('.modal');

  // 预览时把对话框挪成右侧的窄条，左边空出来给地图看高亮（手机上保持底部抽屉）
  const styleBox = (on) => {
    const els = modalEls();
    const el = els.length ? els[els.length - 1] : null;
    const box = el ? el.querySelector('.box') : null;
    if (!box) return null;
    if (on && !(A.isMobile && A.isMobile())) {
      box.style.position = 'absolute';
      box.style.right = '14px';
      box.style.top = '56px';
      box.style.bottom = '16px';
      box.style.width = 'min(430px, 44vw)';
      box.style.maxHeight = 'none';
    } else {
      for (const k of ['position', 'right', 'top', 'bottom', 'width', 'maxHeight']) box.style[k] = '';
    }
    return box;
  };

  const paintPreview = () => {
    if (!rend || !plan || !plan.changes) return false;
    const box = styleBox(true);
    const W = ed.map.width;
    const marks = new Map();
    const mark = (x, y, color, soft) => {
      const i = y * W + x;
      marks.set(i, color);
      if (soft) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * W + (x + dx);
        if (x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < ed.map.height && !marks.has(j)) marks.set(j, soft);
      }
    };
    const G = rgba(54, 194, 91, 235), Gs = rgba(54, 194, 91, 60);
    const Y = rgba(245, 197, 24, 235), Ys = rgba(245, 197, 24, 60);
    const R = rgba(229, 72, 77, 220), Rs = rgba(229, 72, 77, 60);
    const P = rgba(179, 108, 240, 220), Ps = rgba(179, 108, 240, 60);
    for (const a of plan.adds) mark(a.x, a.y, G, Gs);
    for (const mv of plan.moves) { mark(mv.x, mv.y, R, Rs); mark(mv.toX, mv.toY, Y, Ys); }
    for (const r of plan.removes) mark(r.x, r.y, P, Ps);
    rend.setTint({ kind: 'balance', fn: (i) => marks.get(i) || 0, opacity: 1 });
    // 把第一处改动带到“对话框左边的空白处”，不然会被对话框挡住
    const first = plan.adds[0] || plan.moves[0] || plan.removes[0];
    if (first) {
      const tx = first.toX != null ? first.toX : first.x, ty = first.toY != null ? first.toY : first.y;
      rend.centerOn(tx, ty, Math.max(rend.view.z, 0.6));
      if (!A.isMobile || !A.isMobile()) {
        const rect = box ? box.getBoundingClientRect() : null;
        const leftSpace = rect && rect.left > 120 ? rect.left : rend.cw;
        const wantX = Math.max(30, Math.min(rend.cw / 2, leftSpace / 2));
        rend.view.ox += (rend.cw / 2 - wantX) / rend.view.z;
        rend.request();
      }
    }
    return true;
  };
  // 底部“应用”按钮上的数字要跟着最新计划变（modal 的按钮是建好就固定的）
  const syncApplyBtn = () => {
    const els = modalEls();
    const foot = els.length ? els[els.length - 1].querySelector('.mfoot') : null;
    const btn = foot ? foot.querySelector('button.primary') : null;
    if (btn) btn.textContent = plan && plan.changes ? `应用（改 ${plan.changes} 个）` : '应用';
  };

  const setPreview = (on) => {
    previewOn = on && !!plan && plan.changes > 0;
    if (previewOn) {
      if (!paintPreview()) previewOn = false;
      const els = modalEls();
      if (els.length) els[els.length - 1].style.background = 'rgba(0,0,0,.12)';
    } else {
      if (rend) rend.setTint(prevTint);
      styleBox(false);
      const els = modalEls();
      if (els.length) els[els.length - 1].style.background = '';
    }
    draw();
  };

  const draw = () => {
    body.innerHTML = '';
    const rep = plan && plan.report;
    if (!rep) {
      body.append(h('div', { class: 'hint warnh' }, (plan && plan.notes[0]) || '无法计算'));
      return;
    }
    const bf = plan.summary.before && plan.summary.before.fair;
    const af = plan.summary.after && plan.summary.after.fair;
    const spread = (o, key) => (o && o[key] != null ? o[key] : null);
    body.append(h('div', { class: 'hint' + (plan.changes ? ' warnh' : ''), style: 'margin-bottom:10px', html: plan.changes
      ? `<b>打算改 ${plan.changes} 个资源池。</b>最近资源池距离差距 <b>${spread(bf, 'nearestSpread') ?? '—'}</b> → <b>${spread(af, 'nearestSpread') ?? '—'}</b> 格，` +
        `30 格内资源池数量差距 <b>${spread(bf, 'nearSpread') ?? '—'}</b> → <b>${spread(af, 'nearSpread') ?? '—'}</b> 个。`
      : `<b>${plan.notes[0] || '不需要调整'}</b>` }));
    if (plan.report.fair) {
      body.append(h('div', { class: 'hint', style: 'margin-bottom:10px', html:
        `地盘最大是最小的 <b>${plan.report.fair.areaRatio ? plan.report.fair.areaRatio.toFixed(1) : '—'}</b> 倍；地盘由地形决定，这里只调资源池，不改地形。` }));
    }
    for (const n of plan.notes.slice(1)) body.append(h('div', { class: 'hint', style: 'margin-bottom:8px' }, n));

    // 改动前 vs 改动后
    const tb = h('table', { class: 'rep' },
      h('tr', {}, h('th', {}, '队伍'), h('th', {}, '最近资源池'), h('th', {}, '30 格内'), h('th', {}, '地盘')));
    const bRows = (plan.summary.before && plan.summary.before.rows) || [];
    const aRows = (plan.summary.after && plan.summary.after.rows) || [];
    bRows.forEach((br, i) => {
      const ar = aRows[i] || br;
      tb.append(h('tr', {},
        h('td', {}, `第 ${br.team + 1} 队`),
        h('td', {}, arrow(br.nearest, ar.nearest, ' 格')),
        h('td', {}, arrow(br.near, ar.near, ' 个')),
        h('td', {}, br.area ? br.area.toLocaleString() : '—')));
    });
    body.append(h('div', { style: 'max-height:260px;overflow:auto;margin-bottom:8px' }, tb));

    // 具体改动
    const list = (title, arr, fmtOne) => {
      if (!arr.length) return;
      body.append(h('div', { style: 'margin:6px 0' },
        h('b', {}, `${title}（${arr.length}）`),
        h('div', { class: 'hint', style: 'margin-top:2px' }, arr.slice(0, 40).map(fmtOne).join('、') + (arr.length > 40 ? ' …' : ''))));
    };
    list('新增资源池', plan.adds, (a) => `(${a.x}, ${a.y})`);
    list('挪动资源池', plan.moves, (mv) => `(${mv.x}, ${mv.y}) → (${mv.toX}, ${mv.toY})`);
    list('删除资源池', plan.removes, (r) => `(${r.x}, ${r.y})`);

    // 高亮图例（预览时地图上的颜色）
    if (previewOn) {
      const dot = (css) => h('span', { style: `display:inline-block;width:10px;height:10px;border-radius:3px;background:${css};margin-right:4px;vertical-align:-1px` });
      body.append(h('div', { class: 'hint', style: 'margin-top:4px;display:flex;gap:14px;flex-wrap:wrap' },
        h('span', {}, dot('#36c25b'), '新增'),
        h('span', {}, dot('#f5c518'), '挪到这里'),
        h('span', {}, dot('#e5484d'), '从这里挪走'),
        h('span', {}, dot('#b36cf0'), '删除')));
    }

    // 操作区
    const row = h('div', { class: 'row', style: 'margin-top:10px;align-items:center' });
    row.append(h('button', {
      onclick: () => setPreview(!previewOn),
      html: icon(previewOn ? 'eyeOff' : 'eye') + (previewOn ? ' 关掉地图高亮' : ' 预览（在地图上高亮）'),
      disabled: !plan.changes,
    }));
    row.append(h('button', {
      onclick: () => { plan = planBalance(ed, { allowRemove }); if (previewOn) setPreview(false); else draw(); },
      html: icon('report') + ' 重新计算',
    }));
    row.append(toggle('也删除多余的资源池', allowRemove, (v) => {
      allowRemove = v;
      plan = planBalance(ed, { allowRemove });
      if (previewOn) setPreview(false); else draw();
    }, '只在“本队附近、离其他出生点都很远”的池子里挑，默认不动'));
    body.append(row);
    body.append(h('div', { class: 'hint', style: 'margin-top:8px;color:var(--dim)' },
      '资源池按 1×1 摆放；只会动资源池，不改地形、不动单位。应用后可以一次撤销（Ctrl+Z）。'));
    syncApplyBtn();
  };

  draw();
  const res = await modal('一键平衡', body, [
    { label: '关闭' },
    { label: plan.changes ? `应用（改 ${plan.changes} 个）` : '应用', primary: true, value: 'apply' },
  ], { wide: true });
  // 对话框关掉后一定收掉高亮
  if (rend) rend.setTint(prevTint);
  const els = modalEls();
  if (els.length) els[els.length - 1].style.background = '';
  if (res !== 'apply') return;
  const n = applyBalance(ed, plan);
  toast(n ? `一键平衡：改了 ${n} 个资源池，可以撤销` : '没有需要改的地方', 3200);
}
