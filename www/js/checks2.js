// 检查增强（3.3）：出生点角色、盟友感知、连通块/海峡/河宽/手机负担/规则 + 通行表
// 全部只读：不调用 ed.begin / ed.commit。runChecks 末尾调用 extraChecks(ed, add, ctx)。
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast } from './ui.js';
import { objProp } from './tmx.js';
import { passability, LAND, NAVAL, HOVER, BUILD } from './pathing.js';

Object.assign(HELP, {
  'tool.passtable': { t: '地形通行表', s: '每种地形能不能走、能不能建、能不能走船', b: '按图块集里的 <b>图块属性</b>（water / water-bridge / cliff 等）逐种地形统计。<b>依据</b>一列写明每条结论是游戏规则（图块带属性）还是编辑器的默认假设（没有属性就当可走可建造，这是推测，没有官方出处）。' },
  'tool.rules': { t: '地图必须满足的规则', s: '保存地图时自动检查', b: '把“这块陆地必须是孤岛”“这条河最窄处至少 6 格”“这座城必须靠海”这类条件存进地图（作为地图属性 rwRules，游戏会忽略）。每次点“能玩吗？”都会逐条检查。' },
});

// ---- 出生点角色：城市指挥中心（rwRole=city）、装饰（deco）不算开局点 ----
export const roleOf = (s) => String((s.o && objProp(s.o, 'rwRole')) || 'start');
export const startSpawns = (spawns) => {
  const st = spawns.filter((s) => roleOf(s) === 'start');
  return st.length ? st : spawns;
};

// team -> allyGroup（读 team_info）
export function allyMap(ed) {
  const g = ed.map && ed.map.group('Triggers'), mp = new Map();
  for (const o of (g ? g.objects : [])) {
    if ((o.attrs.type || '') !== 'team_info') continue;
    const t = objProp(o, 'team'), a = objProp(o, 'allyGroup');
    if (t !== undefined && a !== undefined) mp.set(+t, +a);
  }
  return mp;
}

// ---- 连通块分析 ----
// 返回 { land:[{id,area,cx,cy,x0,y0,x1,y1,spawns}], water:[{id,area,cx,cy}], lblLand, lblWater, W, H, mainLand }
export function components(ed, pass = passability(ed)) {
  const m = ed.map, W = m.width, H = m.height, n = W * H;
  const lab = (mask) => {
    const L = new Int32Array(n).fill(-1), comps = [], st = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (L[s] >= 0 || !(pass[s] & mask)) continue;
      const id = comps.length; let head = 0, tail = 0, area = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      st[tail++] = s; L[s] = id;
      while (head < tail) {
        const i = st[head++], x = i % W, y = (i / W) | 0; area++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && L[i - 1] < 0 && (pass[i - 1] & mask)) { L[i - 1] = id; st[tail++] = i - 1; }
        if (x < W - 1 && L[i + 1] < 0 && (pass[i + 1] & mask)) { L[i + 1] = id; st[tail++] = i + 1; }
        if (y > 0 && L[i - W] < 0 && (pass[i - W] & mask)) { L[i - W] = id; st[tail++] = i - W; }
        if (y < H - 1 && L[i + W] < 0 && (pass[i + W] & mask)) { L[i + W] = id; st[tail++] = i + W; }
      }
      comps.push({ id, area, cx: Math.round(sx / area), cy: Math.round(sy / area), x0, y0, x1, y1 });
    }
    return { L, comps };
  };
  const ln = lab(LAND), wt = lab(NAVAL);
  const sp = ed.spawns();
  for (const c of ln.comps) c.spawns = 0;
  for (const s of sp) { const i = Math.floor(s.cy / 20) * W + Math.floor(s.cx / 20); const id = ln.L[i]; if (id >= 0) ln.comps[id].spawns++; }
  const mainLand = ln.comps.reduce((b, c) => (!b || c.area > b.area ? c : b), null);
  const ocean = wt.comps.reduce((b, c) => (!b || c.area > b.area ? c : b), null);
  return { land: ln.comps, water: wt.comps, lblLand: ln.L, lblWater: wt.L, W, H, mainLand, ocean };
}

// 两块陆地之间最近距离（格），多源 BFS 的欧氏近似：用 8 邻域曼哈顿上界太粗，这里用逐块距离变换（只在小范围内）
export function gapBetween(comp, a, b, limit = 40) {
  const { W, H, lblLand } = comp;
  const A_ = comp.land[a], B_ = comp.land[b];
  const x0 = Math.max(0, Math.min(A_.x0, B_.x0) - 1), x1 = Math.min(W - 1, Math.max(A_.x1, B_.x1) + 1);
  const y0 = Math.max(0, Math.min(A_.y0, B_.y0) - 1), y1 = Math.min(H - 1, Math.max(A_.y1, B_.y1) + 1);
  // 取 b 的边界点
  const pts = [];
  for (let y = Math.max(y0, B_.y0); y <= Math.min(y1, B_.y1); y++) for (let x = Math.max(x0, B_.x0); x <= Math.min(x1, B_.x1); x++) {
    if (lblLand[y * W + x] !== b) continue;
    const e = (x > 0 && lblLand[y * W + x - 1] !== b) || (x < W - 1 && lblLand[y * W + x + 1] !== b) || (y > 0 && lblLand[(y - 1) * W + x] !== b) || (y < H - 1 && lblLand[(y + 1) * W + x] !== b);
    if (e) pts.push(x, y);
  }
  let best = Infinity, bx = 0, by = 0, ax = 0, ay = 0;
  for (let y = Math.max(y0, A_.y0); y <= Math.min(y1, A_.y1); y++) for (let x = Math.max(x0, A_.x0); x <= Math.min(x1, A_.x1); x++) {
    if (lblLand[y * W + x] !== a) continue;
    const e = (x > 0 && lblLand[y * W + x - 1] !== a) || (x < W - 1 && lblLand[y * W + x + 1] !== a) || (y > 0 && lblLand[(y - 1) * W + x] !== a) || (y < H - 1 && lblLand[(y + 1) * W + x] !== a);
    if (!e) continue;
    for (let k = 0; k < pts.length; k += 2) {
      const dx = pts[k] - x, dy = pts[k + 1] - y; if (Math.abs(dx) > limit || Math.abs(dy) > limit) continue;
      const d = dx * dx + dy * dy; if (d < best) { best = d; ax = x; ay = y; bx = pts[k]; by = pts[k + 1]; }
    }
  }
  return best === Infinity ? null : { d: Math.sqrt(best), a: [ax, ay], b: [bx, by] };
}

// ---- 规则存储（地图属性 rwRules：JSON 数组）----
// 规则：{ t:'island', x,y, name }  该位置所在陆地必须不与最大陆地相连
//       { t:'width', x,y, min, name }  该点附近水道（能走船）最窄不小于 min
//       { t:'coast', x,y, name }  该点 6 格内必须有水
//       { t:'minarea', x,y, min, name }  该点所在陆地面积不小于 min
export function getRules(ed) {
  try { const g = ed.map.group('EditorRules'); const o = g && g.objects.find((q) => (q.attrs.name || '') === 'rwRules'); return o ? JSON.parse(objProp(o, 'json') || '[]') : []; } catch { return []; }
}
export function setRules(ed, rules) {
  const G = ed.map.ensureGroup('EditorRules');
  ed.begin('保存地图规则'); ed.op.snapshotGroup(G);
  let o = G.objects.find((q) => (q.attrs.name || '') === 'rwRules');
  if (!o) { o = { attrs: { name: 'rwRules', x: '0', y: '0', width: '20', height: '20' }, props: [], extra: [] }; G.objects.push(o); }
  const p = o.props.find((q) => q.name === 'json'); const val = JSON.stringify(rules);
  if (p) p.value = val; else o.props.push({ name: 'json', value: val });
  ed.commit();
}
// 水道宽度：以 (x,y) 为中心 R 格内，水格到最近非水格距离的最大值 ×2
export function waterWidthAt(pass, W, H, x, y, R = 7) {
  let best = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || !(pass[Y * W + X] & NAVAL)) continue;
    let r = 1; for (; r <= 12; r++) {
      let hit = false;
      for (let a = 0; a < 16 && !hit; a++) { const ax = Math.round(X + Math.cos(a * Math.PI / 8) * r), ay = Math.round(Y + Math.sin(a * Math.PI / 8) * r); if (ax < 0 || ay < 0 || ax >= W || ay >= H || !(pass[ay * W + ax] & NAVAL)) hit = true; }
      if (hit) break;
    }
    if (r - 1 > best) best = r - 1;
  }
  return best * 2 + 1;
}
export function checkRules(ed, pass, comp) {
  const W = ed.map.width, H = ed.map.height, out = [];
  for (const r of getRules(ed)) {
    const x = r.x | 0, y = r.y | 0, i = y * W + x, nm = r.name || `(${x},${y})`;
    if (r.t === 'island') {
      const id = comp.lblLand[i];
      const ok = id >= 0 && id !== comp.mainLand.id;
      out.push({ ok, text: `规则：${nm} 必须是孤岛`, detail: ok ? '' : (id < 0 ? '该点不是陆地' : '与最大陆地相连了'), x, y });
    } else if (r.t === 'width') {
      const w = waterWidthAt(pass, W, H, x, y);
      out.push({ ok: w >= r.min, text: `规则：${nm} 水道不窄于 ${r.min} 格`, detail: `实测约 ${w} 格`, x, y });
    } else if (r.t === 'coast') {
      let near = false; for (let dy = -6; dy <= 6 && !near; dy++) for (let dx = -6; dx <= 6; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && (pass[Y * W + X] & NAVAL) && !(pass[Y * W + X] & LAND)) { near = true; break; } }
      out.push({ ok: near, text: `规则：${nm} 必须靠海`, detail: near ? '' : '6 格内没有水', x, y });
    } else if (r.t === 'minarea') {
      const id = comp.lblLand[i], a = id >= 0 ? comp.land[id].area : 0;
      out.push({ ok: a >= r.min, text: `规则：${nm} 面积不小于 ${r.min}`, detail: `实测 ${a} 格`, x, y });
    }
  }
  return out;
}

// ---- 手机负担估算 ----
export function loadEstimate(ed) {
  const m = ed.map, W = m.width, H = m.height;
  const T = m.group('Triggers'), objs = T ? T.objects : [];
  let detect = 0, add = 0, msg = 0, text = 0;
  for (const o of objs) {
    const ty = o.attrs.type || '';
    if (ty === 'unitDetect') detect++; else if (ty === 'unitAdd') add++; else if (ty === 'mapText') text++;
    if ((o.props || []).some((p) => p.name === 'globalMessage' && p.value)) msg++;
  }
  const units = (m.group('UnitObjects') || m.group('Units') || { objects: [] }).objects.length;
  const tiles = W * H;
  // 粗略打分：1 分 ≈ 一个小图（200×200）的基础负担；没有官方数据，只用来相对比较
  const score = tiles / 40000 + detect / 400 + units / 1500 + text / 300;
  const level = score < 1.5 ? 'ok' : score < 4 ? 'warn' : 'error';
  return { tiles, detect, add, msg, text, units, score, level };
}

// ---- 附加检查入口 ----
export function extraChecks(ed, add, ctx = {}) {
  const m = ed.map, W = m.width, H = m.height;
  const pass = ctx.pass || passability(ed);
  let comp;
  try { comp = components(ed, pass); } catch (e) { return; }
  const sp = ed.spawns();
  // 1 孤立陆地块（带面积、定位；区分“有出生点”“没有出生点”）
  const big = comp.land.filter((c) => c.area >= 40 && c !== comp.mainLand);
  const dead = big.filter((c) => !c.spawns);
  if (comp.land.length) add('info', '连通', `陆地 ${comp.land.filter((c) => c.area >= 40).length} 块（≥40 格），最大一块 ${comp.mainLand.area.toLocaleString()} 格`, `其中 ${big.length - dead.length} 块孤岛有出生点，${dead.length} 块没有出生点。`);
  if (dead.length) {
    const list = dead.sort((a, b) => b.area - a.area).slice(0, 6);
    add('info', '连通', `${dead.length} 块没有出生点的孤立陆地`, list.map((c) => `(${c.cx},${c.cy}) ${c.area} 格`).join('；') + (dead.length > 6 ? '…' : ''), { goto: { x: list[0].cx, y: list[0].cy } });
  }
  // 2 没连上大海的水域
  const pockets = comp.water.filter((c) => c.area >= 10 && c.area < 400 && c !== comp.ocean);
  if (pockets.length) add('info', '连通', `${pockets.length} 处没连上大海的小水域`, pockets.slice(0, 5).map((c) => `(${c.cx},${c.cy}) ${c.area} 格`).join('；'), { goto: { x: pockets[0].cx, y: pockets[0].cy } });
  // 3 本该是岛却只隔窄海峡：相邻（<12 格）的两块较大陆地，给出最窄处
  const cand = comp.land.filter((c) => c.area >= 80).sort((a, b) => b.area - a.area).slice(0, 40);
  const narrow = [];
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
    const a = cand[i], b = cand[j];
    if (a.x1 + 14 < b.x0 || b.x1 + 14 < a.x0 || a.y1 + 14 < b.y0 || b.y1 + 14 < a.y0) continue;
    const g = gapBetween(comp, a.id, b.id, 14);
    if (g && g.d < 12) narrow.push({ a, b, g });
  }
  if (narrow.length) {
    narrow.sort((p, q) => p.g.d - q.g.d);
    add('info', '海峡', `${narrow.length} 对陆地之间的海峡窄于 12 格`, narrow.slice(0, 5).map((p) => `(${p.g.a[0]},${p.g.a[1]})↔(${p.g.b[0]},${p.g.b[1]}) 约 ${p.g.d.toFixed(0)} 格`).join('；'), { goto: { x: narrow[0].g.a[0], y: narrow[0].g.a[1] } });
  }
  // 4 规则
  const rr = checkRules(ed, pass, comp);
  if (rr.length) {
    const bad = rr.filter((r) => !r.ok);
    if (bad.length) for (const r of bad) add('warn', '规则', r.text + ' ✗', r.detail, { goto: { x: r.x, y: r.y } });
    else add('ok', '规则', `${rr.length} 条地图规则全部满足`);
  }
  // 5 手机负担
  const le = loadEstimate(ed);
  if (le.detect + le.units > 0) add(le.level, '性能', `负担估算 ${le.score.toFixed(1)}（${le.level === 'ok' ? '低' : le.level === 'warn' ? '中' : '高'}）`, `格子 ${le.tiles.toLocaleString()}、持续检测 ${le.detect}、单位 ${le.units}、地名文字 ${le.text}、全局消息 ${le.msg}。手机闪退优先怀疑检测区域和地名文字，可先导出“轻量版”对比。`);
  // 6 全局消息扎堆：同样的 warmup/delay 下消息条数
  {
    const T = m.group('Triggers'), buckets = new Map();
    for (const o of (T ? T.objects : [])) {
      if (!(o.props || []).some((p) => p.name === 'globalMessage' && p.value)) continue;
      const k = (objProp(o, 'delay') || objProp(o, 'warmup') || '0');
      buckets.set(k, (buckets.get(k) || 0) + 1);
    }
    const crowd = [...buckets].filter(([, n]) => n >= 12);
    if (crowd.length) add('info', '触发器', `${crowd.length} 组全局消息同一时刻触发（每组 ≥12 条）`, crowd.slice(0, 3).map(([k, n]) => `${k}：${n} 条`).join('；') + '。同一秒夺下多座城时可能刷屏。');
  }
  // 7 奖励刷兵点落在水/悬崖
  {
    const T = m.group('Triggers'); let bad = 0, first = null;
    for (const o of (T ? T.objects : [])) {
      if ((o.attrs.type || '') !== 'unitAdd' || !(o.props || []).some((p) => p.name === 'spawnUnits' && /\*/.test(p.value || ''))) continue;
      const tx = Math.floor(+o.attrs.x / 20), ty = Math.floor(+o.attrs.y / 20);
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      if (!(pass[ty * W + tx] & (LAND | HOVER | NAVAL))) { bad++; if (!first) first = [tx, ty]; }
    }
    if (bad) add('warn', '触发器', `${bad} 个刷兵点落在悬崖或障碍上`, '刷出的单位可能卡住。', { goto: { x: first[0], y: first[1] } });
  }
  // 8 太细的陆地/水道（1–2 格宽）：自动过渡图块会让它变形
  {
    let thinLand = 0, firstT = null;
    for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const L = (j) => !!(pass[j] & LAND);
      if (!L(i)) continue;
      const hz = !L(i - 1) && !L(i + 1), vt = !L(i - W) && !L(i + W);
      if (hz || vt) { thinLand++; if (!firstT) firstT = [x, y]; }
    }
    if (thinLand > 30) add('info', '地形', `${thinLand} 处 1 格宽的陆地细条`, '自动过渡图块会让 1–2 格宽的细节变形，建议加宽或删掉。', { goto: { x: firstT[0], y: firstT[1] } });
  }
  ctx.comp = comp;
}

// ---- 通行表对话框 ----
export function passTable(ed = A.ed) {
  const eng = ed.engine, m = ed.map;
  const rows = [];
  if (eng) {
    const ts = eng.ts;
    const byT = new Map();
    for (const [id, inf] of ts.tiles) {
      if (!inf.terrain || inf.terrain.length !== 4 || !inf.terrain.every((t) => t === inf.terrain[0])) continue;
      const t = inf.terrain[0]; if (byT.has(t)) continue;
      const p = inf.props || {};
      let c = LAND | HOVER | BUILD, src = '默认（图块没有任何属性：编辑器按“可走可建”处理，属推测）';
      const keys = Object.keys(p);
      if ('water' in p) { c = NAVAL | HOVER; src = '图块属性 water（游戏规则）'; }
      if ('water-bridge' in p) { c = LAND | NAVAL | HOVER; src = '图块属性 water-bridge（游戏规则）'; }
      if ('lava' in p) { c = 0; src = '图块属性 lava（游戏规则）'; }
      if ('large-cliff' in p || 'cliff-soft' in p || 'lava-cliff' in p || 'cliff' in p || 'block-land' in p) { c = c & ~(LAND | BUILD); src = '图块属性 ' + keys.filter((k) => /cliff|block-land/.test(k)).join('/') + '（游戏规则）'; }
      byT.set(t, { name: ts.terrainNames[t], c, src });
    }
    for (const [, r] of byT) rows.push(r);
  }
  const yn = (v) => (v ? '✓' : '—');
  const ALIAS = { 'Water Bridge': '浅滩 / Ford / water-bridge / 脚本里的 Bridge（同一种）' };
  const body = h('div', {}, h('p', { class: 'hint' }, '“依据”一列说明结论来自哪里。名字对照：', Object.values(ALIAS).join('；')),
    h('table', { class: 'tbl', style: 'width:100%;font-size:12px' },
      h('tr', {}, ...['地形', '陆军', '建造', '船', '悬浮', '依据'].map((x) => h('th', { style: 'text-align:left' }, x))),
      ...rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, yn(r.c & LAND)), h('td', {}, yn(r.c & BUILD)), h('td', {}, yn(r.c & NAVAL)), h('td', {}, yn(r.c & HOVER)), h('td', {}, r.src)))));
  modal('地形通行表', body, [{ label: '关闭' }]);
  return rows;
}
