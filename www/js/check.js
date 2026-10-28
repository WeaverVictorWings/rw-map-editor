// “能玩吗？”检查、预览图、展示图
import { objProp } from './tmx.js';
import { teamColor } from './render.js';
import { passability, BUILD, LAND, NAVAL, HOVER } from './pathing.js';
import { NONE } from './terrain.js';
import { bfsFrom } from './bottleneck.js';

const lc = (s) => String(s || '').trim().toLowerCase();


export const MAP_TYPES = ['skirmish', 'mission', 'challenge', 'survival', 'endless'];
const WATERISH = /^(deep water|water|shallow water|lake|ice lake)$/i;

export function sizeTier(w, h) {
  const s = Math.max(w, h);
  if (s <= 500) return { level: 'ok', text: '小于等于 500：手机联机也比较安全' };
  if (s <= 1500) return { level: 'warn', text: '500–1500：建议在电脑上玩，手机可能卡顿' };
  if (s <= 4000) return { level: 'warn', text: '1500–4000：只建议 64 位电脑版，需要足够内存' };
  return { level: 'error', text: '超过 4000：仅供实验，没有找到能正常游玩的可靠证据' };
}

// 返回 [{level, cat, title, detail, goto?, fix?:{label, run}}]
export function runChecks(ed, opts = {}) {
  const m = ed.map, out = [];
  const add = (level, cat, title, detail = '', extra = {}) => out.push({ level, cat, title, detail, ...extra });
  const W = m.width, H = m.height;

  // ---- 文件格式 ----
  if (m.tw !== 20 || m.th !== 20) add('error', '格式', '图块尺寸不是 20×20', `当前 ${m.tw}×${m.th}，游戏要求 20×20。`);
  const mi = ed.mapInfo();
  if (!mi) add('error', '格式', '缺少 map_info', '游戏需要 Triggers 层里有一个 map_info 对象（type=skirmish），否则对局结束可能没有结算。', { fix: { label: '一键补上', run: () => ed.ensureMapInfo() } });
  else {
    const t = objProp(mi, 'type');
    if (!t) add('error', '格式', 'map_info 没有 type 属性', '遭遇战地图应设为 skirmish。', { fix: { label: '设为 skirmish', run: () => ed.setMapInfoProp('type', 'skirmish') } });
    else if (!MAP_TYPES.includes(t)) add('warn', '格式', `map_info 的 type 是「${t}」`, '常见取值：' + MAP_TYPES.join(' / ') + '（社区整理）');
    else add('ok', '格式', `map_info 正常（type=${t}）`);
  }
  const G = m.ground;
  if (!G) add('error', '格式', '没有 Ground 地面图层');
  else {
    let empty = 0, first = -1;
    const d = G.data;
    for (let i = 0; i < d.length; i++) if (!d[i]) { empty++; if (first < 0) first = i; }
    if (empty) {
      const counts = new Map();
      for (let i = 0; i < d.length; i += 97) if (d[i]) counts.set(d[i], (counts.get(d[i]) || 0) + 1);
      const fillGid = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      add('error', '格式', `地面有 ${empty.toLocaleString()} 个空格`, '游戏要求 Ground 层不能有空格。', {
        goto: { x: first % W, y: (first / W) | 0 },
        fix: fillGid ? { label: '用最常见的地面填满', run: () => {
          const op = ed.begin('填满空格');
          if (empty > 100000) op.snapLayer(G);
          for (let i = 0; i < d.length; i++) if (!d[i]) op.tile(G, i, 0, 0, fillGid, 0);
          if (ed.engine) ed.engine.syncRect(op, 0, 0, W - 1, H - 1, true);
          ed.commit();
        } } : null,
      });
    } else add('ok', '格式', '地面没有空格');
  }
  for (const L of m.layers) {
    let bad = 0, first = -1;
    const d = L.data;
    for (let i = 0; i < d.length; i++) { const g = d[i]; if (g && !m.tilesetOf(g)) { bad++; if (first < 0) first = i; } }
    if (bad) add('error', '格式', `图层「${L.name}」有 ${bad.toLocaleString()} 个未定义图块`, '旧版本游戏遇到未定义图块会直接崩溃。', {
      goto: { x: first % W, y: (first / W) | 0 },
      fix: { label: '清除这些图块', run: () => {
        const op = ed.begin('清除未定义图块');
        for (let i = 0; i < d.length; i++) if (d[i] && !m.tilesetOf(d[i])) op.tile(L, i, d[i], L.flips.get(i) || 0, 0, 0);
        ed.commit();
      } },
    });
  }
  let badFloat = 0;
  for (const g of m.groups) for (const o of g.objects) for (const p of o.props) if (p.type === 'float' && !Number.isFinite(parseFloat(p.value))) badFloat++;
  if (badFloat) add('error', '格式', `${badFloat} 个浮点属性的值不是数字`, '旧版本游戏遇到无效浮点属性会崩溃。');

  // ---- 图块集 ----
  for (const ts of m.tilesets) {
    const fixMiss = { label: '补上地块图…', run: () => import('./assets.js').then((m2) => m2.missingDialog()) };
    if (ts.source) add('warn', '图块集', `图块集「${ts.name || ts.source}」引用了外部文件`, '编辑器里会显示成紫色，换设备后游戏也可能找不到。选上对应的 .tsx 和 .png 就能嵌进地图。', { fix: fixMiss });
    else if (!ts.embeddedPng) add('warn', '图块集', `图块集「${ts.name}」没有内嵌图片`, '它引用的是外部图片「' + (ts.imageSource || '') + '」，换设备后可能显示不出来。', { fix: fixMiss });
  }
  const gts = ed.groundTs;
  if (gts) {
    const names = gts.terrainNames;
    const waterTiles = [];
    let waterProps = 0;
    const upper = [];
    for (const [id, inf] of gts.tiles) {
      for (const k of Object.keys(inf.props)) { if (k === 'water') waterProps++; if (k !== k.toLowerCase()) upper.push([id, k]); }
      if (inf.terrain && inf.terrain.every((t) => t >= 0 && WATERISH.test(names[t] || '')) && !('water' in inf.props) && !('water-bridge' in inf.props)) waterTiles.push(id);
    }
    if (waterTiles.length && (!waterProps || waterTiles.length > 3)) {
      add(waterProps ? 'warn' : 'error', '图块集', `${waterTiles.length} 个水面图块没有 water 属性`, '没有这个属性，船不能在水上走，陆军反而能走过水面，还能在水上盖房。', {
        fix: { label: '给这些图块补上 water', run: () => { for (const id of waterTiles) m.setTileProp(gts, id, 'water', ''); } },
      });
    }
    // 岩浆：整格都是岩浆地形却没有 lava 属性
    const lavaT = names.findIndex((n) => /^lava$/i.test(n || ''));
    if (lavaT >= 0) {
      const lavaTiles = [];
      for (const [id, inf] of gts.tiles) if (inf.terrain && inf.terrain.every((t) => t === lavaT) && !('lava' in inf.props)) lavaTiles.push(id);
      if (lavaTiles.length) add('warn', '图块集', `${lavaTiles.length} 个岩浆图块没有 lava 属性`, '没有这个属性，单位可以走过岩浆、在上面盖房。', { fix: { label: '补上 lava', run: () => { for (const id of lavaTiles) m.setTileProp(gts, id, 'lava', ''); } } });
    }
    if (upper.length) add('warn', '图块集', `${upper.length} 个图块属性名含大写字母`, '游戏只认小写属性名（例如 water，而不是 Water）。', {
      fix: { label: '全部改成小写', run: () => { for (const [id, k] of upper) { const v = gts.tiles.get(id).props[k]; m.setTileProp(gts, id, k, null); m.setTileProp(gts, id, k.toLowerCase(), v); } } },
    });
  }

  // ---- 队伍与出生点 ----
  const sp = ed.spawns();
  const teams = [...new Set(sp.map((s) => s.team).filter((t) => t >= 0))].sort((a, b) => a - b);
  if (!sp.length) add('error', '出生点', '没有任何出生点', '每支队伍至少需要一个指挥中心。到“单位”里点“出生点”添加。');
  else {
    const gap = teams.some((t, i) => t !== i);
    add(gap ? 'warn' : 'ok', '出生点', `${teams.length} 支队伍有出生点`, gap ? '队伍编号不连续：' + teams.slice(0, 30).map((t) => t + 1).join('、') + (teams.length > 30 ? '…' : '') : '',
      gap ? { fix: { label: '重新编号为 1、2、3…', run: () => ed.renumberTeams() } } : {});
    if (teams.length > 10) add('info', '出生点', `${teams.length} 支队伍`, opts.teamNote || '游戏默认房间只有 10 队（第 1~10 队），第 11 队以后的单位和触发器会被跳过。要玩满需要支持更多玩家的服务器房间（引擎上限 100 队）。');
    if (teams.some((t) => t >= 100)) add('error', '出生点', '有队伍号超过 100', '游戏引擎最多支持 100 支队伍（第 1~100 队），超出的队伍无法使用。', { fix: { label: '重新编号', run: () => ed.renumberTeams() } });
    const dup = sp.length - new Set(sp.map((s) => s.team)).size;
    if (dup > 0) add('warn', '出生点', `${dup} 个指挥中心与别的指挥中心同队`, '同一队有多个指挥中心是允许的，但如果是误放，会让这队开局更强。');
  }
  const pass = opts.pass || passability(ed);
  const ptile = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? pass[y * W + x] : 0;
  // 资源池自己会把所在格的 BUILD 位遮掉（pathing.js 里 'res_pool' → ~BUILD），
  // 所以判断“池子下面的地”必须看地面本身，不能看被池子遮过的那一份
  const gpassFor = (() => {
    const m2 = ed.map, G2 = m2.ground, cache2 = new Map();
    const cls = (gid) => {
      if (cache2.has(gid)) return cache2.get(gid);
      const info = m2.tileInfo(gid), p2 = (info && info.props) || {};
      let c = LAND | HOVER | BUILD;
      if ('water' in p2) c = NAVAL | HOVER;
      if ('water-bridge' in p2) c = LAND | NAVAL | HOVER;
      if ('lava' in p2) c = 0;
      if ('large-cliff' in p2 || 'cliff-soft' in p2 || 'lava-cliff' in p2 || 'cliff' in p2 || 'block-land' in p2) c = c & ~(LAND | BUILD);
      if ('large-cliff' in p2 || 'lava-cliff' in p2) c = 0;
      cache2.set(gid, c);
      return c;
    };
    return (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? cls(G2 ? G2.data[y * W + x] : 0) : 0;
  })();
  for (const s of sp) {
    const tx = Math.floor(s.cx / 20), ty = Math.floor(s.cy / 20);
    if (!(ptile(tx, ty) & BUILD)) add('warn', '出生点', `第 ${s.team + 1} 队的指挥中心压在水面、悬崖或障碍上`, '可能无法正常开局。', { goto: { x: tx, y: ty } });
    if (tx < 2 || ty < 2 || tx > W - 3 || ty > H - 5) add('warn', '出生点', `第 ${s.team + 1} 队的出生点太靠近地图边缘`, '建造者可能被卡住。', { goto: { x: tx, y: ty } });
  }
  const close = [];
  for (let a = 0; a < sp.length; a++) for (let b = a + 1; b < sp.length; b++) {
    if (sp[a].team === sp[b].team) continue;
    const d = Math.hypot(sp[a].cx - sp[b].cx, sp[a].cy - sp[b].cy) / 20;
    if (d < 15) close.push([sp[a], sp[b], d]);
  }
  if (close.length) add('warn', '出生点', `${close.length} 对出生点相距不到 15 格`, close.slice(0, 4).map(([a, b, d]) => `第 ${a.team + 1} 队和第 ${b.team + 1} 队：${d.toFixed(0)} 格`).join('；'), { goto: { x: Math.floor(close[0][0].cx / 20), y: Math.floor(close[0][0].cy / 20) } });
  let outside = 0;
  for (const g of m.groups) for (const o of g.objects) {
    const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0);
    if (o.attrs.gid && (x < 0 || y < 0 || x > W * 20 || y > H * 20)) outside++;
  }
  if (outside) add('warn', '出生点', `${outside} 个单位在地图范围外`);

  // ---- 资源池 ----
  const pools = ed.poolTiles();
  if (!pools.length) add('warn', '资源', '地图上没有资源池', '到“物品”里选“资源池”放置，或用印章库里的“标准基地”。');
  else {
    add('info', '资源', `共有 ${pools.length} 个资源池`);
    const bad = pools.filter(([x, y]) => !(gpassFor(x, y) & LAND) || x < 1 || y < 1 || x > W - 2 || y > H - 2);
    if (bad.length) add('warn', '资源', `${bad.length} 个资源池在水里、悬崖上或地图边缘`, '单位可能够不着。', { goto: { x: bad[0][0], y: bad[0][1] } });
    // 资源池按 1×1 算：只有“正上下左右紧贴单位”（或压在单位上）才提醒
    const units = [];
    for (const g of m.groups) for (const o of g.objects) if (o.attrs.gid) {
      const x = +o.attrs.x, y = +o.attrs.y, w = +(o.attrs.width || 20), h = +(o.attrs.height || 20);
      // 单位位置是「左上角 + 宽高」，坐标可能是小数（toFixed(1) 存的 400.5）。
      // 覆盖哪几格要看它实际压住的像素区间 [x, x+w)：上边界减 1e-6，而不是减整 1 格。
      // 减 1 会把 x=400.5、w=20（真的压满第 20、21 两列）算成只占第 20 列，左边紧贴的池子就漏报了。
      units.push([
        Math.floor(x / 20), Math.floor((y - h) / 20),
        Math.floor((x + w - 1e-6) / 20), Math.floor((y - 1e-6) / 20),
      ]);
    }
    const tight = pools.filter(([px, py]) => units.some(([a, b, c, d]) => {
      const nx = Math.max(a, Math.min(px, c)), ny = Math.max(b, Math.min(py, d));
      return Math.abs(px - nx) + Math.abs(py - ny) <= 1;   // 0 = 压在单位上，1 = 正上下左右紧贴
    }));
    if (tight.length) add('warn', '资源', `${tight.length} 个资源池紧贴单位`, '资源池按 1 格算，可以紧挨着放；只有正上下左右贴着单位（或压在单位上）时才提醒，挪开 1 格就好。', { goto: { x: tight[0][0], y: tight[0][1] } });
  }

  // ---- 尺寸与体积 ----
  const tier = sizeTier(W, H);
  add(tier.level === 'ok' ? 'ok' : tier.level, '尺寸', `地图尺寸 ${W}×${H}`, tier.text);
  const used = m.usedTilesets();
  const unused = m.tilesets.filter((t) => !used.has(t) && !['ground', 'items', 'units'].includes(t.layerTag) && !/^export_(ground|items|units)$/.test(t.name));
  if (unused.length) {
    const kb = Math.round(unused.reduce((s, t) => s + (t.embeddedPng ? t.embeddedPng.length : 0), 0) / 1024);
    add('info', '尺寸', `${unused.length} 个图块集没有用到（约 ${kb} KB）`, '联机时主机要把地图传给所有人，去掉它们可以让地图更小。', { fix: { label: '保存时去掉', run: () => { ed.pruneOnSave = true; } } });
  }
  if (opts.triggerIssues) for (const t of opts.triggerIssues) add(t.level, '触发器', t.title, t.detail || '', { goto: t.goto, fix: t.fix });

  // ---- 道路连通（按地面判据，不看资源池遮罩） ----
  {
    const totalLand = (() => { let n = 0; for (let i = 0; i < W * H; i++) if (gpassFor(i % W, (i / W) | 0) & LAND) n++; return n; })();
    if (totalLand && sp.length) {
      // bfsFrom 的 sources 是格子索引（不是 [x,y] 坐标），传坐标对会让它一格都找不到
      const dm = bfsFrom(pass, W, H, sp.map((s) => Math.floor(s.cy / 20) * W + Math.floor(s.cx / 20)), LAND | BUILD);
      let unreach = 0, firstUn = null;
      for (let i = 0; i < W * H; i++) {
        if (!(gpassFor(i % W, (i / W) | 0) & LAND)) continue;
        if (dm[i] < 0) { unreach++; if (!firstUn) firstUn = [i % W, (i / W) | 0]; }
      }
      if (unreach) {
        const pct = (unreach / totalLand) * 100;
        add(pct > 2 ? 'warn' : 'info', '道路', `${unreach.toLocaleString()} 格陆地走不到出生点（占陆地 ${pct.toFixed(1)}%）`,
          '这些地方单位过不去，放在那的资源池会被浪费，效果区域也踩不到。', { goto: firstUn ? { x: firstUn[0], y: firstUn[1] } : undefined });
      } else add('ok', '道路', '所有陆地都能从出生点走到');
    }
  }

  // ---- 空投点与建造空间 ----
  {
    const builds = [];
    for (let i = 0; i < W * H; i++) if (pass[i] & BUILD) builds.push(i);
    if (sp.length && builds.length) {
      for (const s of sp) {
        let n = 0;
        const R = 9;   // 约 8 格半径内
        const tx0 = Math.max(0, Math.floor(s.cx / 20) - R), ty0 = Math.max(0, Math.floor(s.cy / 20) - R);
        const tx1 = Math.min(W - 1, Math.floor(s.cx / 20) + R), ty1 = Math.min(H - 1, Math.floor(s.cy / 20) + R);
        for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) if (pass[y * W + x] & BUILD) n++;
        if (n < 60) add('warn', '空投', `第 ${s.team + 1} 队出生点附近可建造的空地只有 ${n} 格`, '开局展不开，建议半径 8 格内至少留 60 格空地。', { goto: { x: Math.floor(s.cx / 20), y: Math.floor(s.cy / 20) } });
      }
      const ratio = builds.length / (W * H);
      if (ratio < 0.08) add('warn', '空投', `整张图可建造的格子只占 ${(ratio * 100).toFixed(1)}%`, '单位几乎没地方落脚，检查一下是不是水面/悬崖画太多了。');
      else add('ok', '空投', `可建造面积占 ${(ratio * 100).toFixed(1)}%`);
    }
    const ap = m.group('Triggers');
    const hasAttack = ap ? ap.objects.some((o) => lc(o.attrs.name) === 'attack_point') : false;
    const isSurvival = (() => { const mt = ed.mapInfo(); return mt && lc(objProp(mt, 'type')) === 'survival'; })();
    if (isSurvival && !hasAttack) add('error', '空投', '生存模式没有 attack_point 敌军出生点', '敌人没有地方刷出来。用“新建 → 敌军出生点”放一个。');
  }

  // ---- 传送门配对 ----
  {
    const TG = m.group('Triggers');
    const objs = TG ? TG.objects : [];
    const points = new Set(objs.filter((o) => lc(objProp(o, 'type')) === 'point' || lc(objProp(o, 'kind')) === 'point').map((o) => lc(o.attrs.name)));
    const moves = objs.filter((o) => ['unitmove', 'move'].includes(lc(objProp(o, 'type'))));
    const badTg = moves.filter((o) => { const tg = lc(objProp(o, 'target')); return tg && !points.has(tg); });
    if (badTg.length) add('error', '传送门', `${badTg.length} 个“移动单位”指向了不存在的目标点`, '目标点要先放好、名字要一模一样。', { goto: badTg[0].attrs ? { x: Math.floor(+badTg[0].attrs.x / 20), y: Math.floor(+badTg[0].attrs.y / 20) } : undefined });
    const byPoint = new Map();
    for (const o of moves) { const tg = lc(objProp(o, 'target')); if (tg && points.has(tg)) byPoint.set(tg, (byPoint.get(tg) || 0) + 1); }
    const dup = [...byPoint].filter(([, n]) => n > 2);
    if (dup.length) add('warn', '传送门', `${dup.length} 个目标点被 3 个以上“移动单位”当终点`, '可能是复制触发器时忘了改目的地，单位会被同时往几个方向拽。');
    if (moves.length && !badTg.length) add('ok', '传送门', `${moves.length} 条“移动单位”的目标点都对得上`);
  }

  // ---- 地形可破坏性 ----
  {
    const gts2 = ed.groundTs;
    if (gts2) {
      const hard = [];
      for (const [id, inf] of gts2.tiles) {
        const p2 = inf.props || {};
        if (!('lava' in p2) && !('water' in p2) && !('water-bridge' in p2)
          && (('large-cliff' in p2) || ('lava-cliff' in p2) || ('cliff' in p2))) hard.push(id);
      }
      if (hard.length) add('info', '地形', `${hard.length} 种悬崖图块不能被打掉`, '想让工兵能开山的话，把它们换成带 cliff-soft 属性的图块。');
    }
    const soft = [];
    if (gts2) for (const [id, inf] of gts2.tiles) if ('cliff-soft' in (inf.props || {})) soft.push(id);
    if (soft.length) add('info', '地形', `${soft.length} 种图块可以被工兵打掉（cliff-soft）`, '这些格子是“可破坏地形”，画地图时留意别把必经之路做成这里。');
  }

  return out;
}

// 预览图（每格平均色），最长边不超过 maxSide 像素
export function renderPreview(ed, rend, maxSide = 200, opts = {}) {
  const m = ed.map, col = rend.colors;
  const k = Math.max(m.width, m.height) / maxSide;
  const w = Math.max(1, Math.round(m.width / k)), h = Math.max(1, Math.round(m.height / k));
  const cv = new OffscreenCanvas(w, h);
  const c = cv.getContext('2d');
  const img = new ImageData(w, h), p = img.data;
  const layers = m.layers.filter((l) => l.visible);
  for (let y = 0; y < h; y++) {
    const ty0 = Math.floor(y * m.height / h), ty1 = Math.max(ty0 + 1, Math.floor((y + 1) * m.height / h));
    for (let x = 0; x < w; x++) {
      const tx0 = Math.floor(x * m.width / w), tx1 = Math.max(tx0 + 1, Math.floor((x + 1) * m.width / w));
      let R = 0, G = 0, B = 0, n = 0;
      const sy = Math.max(1, Math.floor((ty1 - ty0) / 4)), sx = Math.max(1, Math.floor((tx1 - tx0) / 4));
      for (let ty = ty0; ty < ty1; ty += sy) for (let tx = tx0; tx < tx1; tx += sx) {
        const i = ty * m.width + tx;
        let r = 20, g = 22, b = 26;
        for (const L of layers) {
          const gid = L.data[i]; if (!gid) continue;
          const kk = gid * 4, a = col[kk + 3] / 255;
          r = r * (1 - a) + col[kk] * a; g = g * (1 - a) + col[kk + 1] * a; b = b * (1 - a) + col[kk + 2] * a;
        }
        R += r; G += g; B += b; n++;
      }
      const o = (y * w + x) * 4; p[o] = R / n; p[o + 1] = G / n; p[o + 2] = B / n; p[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const sx = w / (m.width * m.tw), sy = h / (m.height * m.th);
  if (opts.pools) {
    c.fillStyle = '#ffd34d';
    for (const [x, y] of ed.poolTiles()) { c.beginPath(); c.arc((x + 0.5) * m.tw * sx, (y + 0.5) * m.th * sy, Math.max(1.5, Math.min(w, h) / 120), 0, 7); c.fill(); }
  }
  const sp = ed.spawns();
  const r = Math.max(3, Math.round(Math.min(w, h) / (sp.length > 20 ? 80 : 40)));
  for (const s of sp) {
    const x = s.cx * sx, y = s.cy * sy;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = teamColor(s.team); c.fill(); c.lineWidth = 1; c.strokeStyle = '#000'; c.stroke();
    if (r >= 5) {
      c.fillStyle = '#000'; c.font = `bold ${Math.round(r * 1.2)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(s.team + 1), x, y + 0.5);
    }
  }
  return cv;
}

// 展示图：带标题、尺寸、人数、图例的大图，方便发到群里或工坊
export async function renderPoster(ed, rend, name, size = 1200) {
  const pv = renderPreview(ed, rend, size - 80, { pools: true });
  const pad = 40, head = 96, foot = 56;
  const W = pv.width + pad * 2, H = pv.height + head + foot + pad;
  const cv = new OffscreenCanvas(W, H);
  const c = cv.getContext('2d');
  c.fillStyle = '#16181d'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#e8eaee'; c.font = 'bold 34px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif'; c.textBaseline = 'alphabetic';
  c.fillText(name, pad, 56);
  const m = ed.map, sp = ed.spawns();
  c.fillStyle = '#9aa1ad'; c.font = '18px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  c.fillText((window.__rwT || String)(`${m.width}×${m.height} 格 · ${new Set(sp.map((s) => s.team)).size} 支队伍 · ${ed.poolTiles().length} 个资源池`), pad, 84);
  c.drawImage(pv, pad, head);
  c.strokeStyle = '#323743'; c.strokeRect(pad - 0.5, head - 0.5, pv.width + 1, pv.height + 1);
  c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(pad + 8, H - pad + 2, 7, 0, 7); c.fill();
  c.fillStyle = '#9aa1ad'; c.fillText((window.__rwT || String)('资源池'), pad + 22, H - pad + 8);
  c.fillStyle = '#36c25b'; c.beginPath(); c.arc(pad + 110, H - pad + 2, 8, 0, 7); c.fill();
  c.fillStyle = '#9aa1ad'; c.fillText((window.__rwT || String)('出生点（数字为队伍号）'), pad + 126, H - pad + 8);
  c.textAlign = 'right'; c.fillText((window.__rwT || String)('铁锈地图编辑器'), W - pad, H - pad + 8);
  return cv;
}
