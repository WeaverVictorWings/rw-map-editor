// RWKit 3.5 命令行扩展（由 rwkit.mjs 转发调用）
import fs from 'node:fs'; import path from 'node:path';
export const CMDS35 = {};
export const USAGE35 = `
—— 3.5 新增 ——
  check <map.tmx> [--rules r.json] [--ref 参考图.tmx] [--units 模组单位表.txt] [--md 报告.md] [--json] [--no-geo] [--win "队伍:x,y;x,y：正则"]   交付前一键检查（红黄绿）
  health <map.tmx>                               老图体检（只看红黄绿概览与最严重 8 条）
  package <map.tmx> --title 名字 [--version v1] [--ref 参考图] [--cover 封面.png] [-o 目录]   交付包（地图+说明+检查报告+zip）
  changes <旧.tmx> <新.tmx>                       两次导出之间的变更摘要
  proj-new <map.tmx> --name N [--inputs a,b] -o x.rwproj   写项目文件（记录输入/输出哈希）    proj-check <x.rwproj>   检查有没有交旧文件
  geo-check <map.tmx> [--min-gap 12] [--small 120] [--river 3] [--circum "x,y;x,y"]   地形连通检查（浅水相连/海峡/小岛/环绕/港口/河宽/死水）
  gaps <map.tmx> [--min-area 200] [--min-gap 12]  相邻陆块之间的最窄距离与深水连续宽度
  shallow-links <map.tmx> [-o out --cut]          仅靠浅水相连的陆块对（陆军能走过去）；--cut 把通道里的浅水改成深水
  widen-gaps <map.tmx> --min-gap 12 -o out        两岸逐圈削掉最近的陆地,直到相邻陆块间距不低于阈值（单位/建筑所在格不削）
  small-islands <map.tmx> [--max 120] [--remove -o out]   零碎小岛清单/清理（有单位的不动）
  circum <map.tmx> --at x,y [--clear 1] | --all   海军能否绕某块陆地一圈
  ports <map.tmx>                                 舰船/海军工厂能否通到主海
  rivers <map.tmx> [--max 3]                      河宽分布/断流/悬空端点
  dead-seas <map.tmx> [--max 4000] [--fill -o out]   封闭小水域检测/填平
  river-draw <map.tmx> --pts "x,y;x,y;…" [--width 2] [--gid N] -o out     折线 → 连续浅水河（河口自动接海）
  ridge <map.tmx> --pts "x,y;…" [--width 2] [--pass-every 40] [--pass-width 5] [--gid N] -o out   折线 → 岩石墙并留山口
  zoom <map.tmx> --at x,y --r 40 [--factor 1.6] -o out    径向放大局部地形
  island-chain <map.tmx> --pts "x,y;…" [--n 8] [--gap 12] -o out   沿折线生成互不相连的岛链
  geo-import <map.tmx> --asc 高程.asc [--sea 0] [--shore 0] [--mountain 1500] -o out   高程栅格 → 陆/浅水/深水/山
  sites <map.tmx> --n 20 [--min-dist 40] [--margin 3]   城市自动选址（输出候选坐标）    uniform <map.tmx> [--radius 90] [--team N]   城市均匀度/空白区
  shares <map.tmx> [--ref 参考图]                 地形占比（带参考图对照）    latlon <map.tmx> --bbox lon0,lat0,lon1,lat1 [--cell x,y | --ll lon,lat]   经纬度↔格子
  decal <map.tmx> --at x,y --r 30 --gid N [--rough 0.35] -o out    不规则地貌斑块（沙漠/盐湖）    gids <map.tmx>   列出图块 gid 与属性
  elim --name 日本 --capital 东京 --foe 东协 [--chars 200] [--facts "句1|句2"]   覆灭文本草稿（分条+延迟）
  intro <map.tmx> [--budget 60] [-o out]          开场介绍压缩到 N 秒内（重排触发时间）
  camp-colors <map.tmx> --rules "太约:#4fa3ff,东协:#ff5a5a" [--neutral #ffd24a] -o out   按文字里出现的势力名着色
  reports --event neutral|enemy|recapture|ally|lost --cities A,B --who 某国   战报模板
  rename-text <map.tmx> --map "旧：新，旧2：新2" -o out   批量替换消息里的名称（如战区→国家）
  text-panel <map.tmx> [--ref 参考图]             文本条数/字数/中位数/最长行    screen "文本" [--cols 30]   屏幕宽度预览
  fix-punct <map.tmx> -o out                      消息里的半角标点改全角    punct <map.tmx>   标点/引号配对检查
  phases <map.tmx>                                阶段通报/提示时间表（含间隔过大提示）
  locale-out <map.tmx> -o 模板.csv | locale-in <map.tmx> <译文.csv> --lang en -o out   多语言文本包
  placeholders <map.tmx> [--vars A=1,B=2]         {占位符} 缺值检查
  forces <map.tmx> [--ref 参考图]                 兵力对照表（按类别/队伍）    city-forces <map.tmx> [--radius 12]   每座城附近兵力
  plan-forces <map.tmx> --tiers "0：强，1：弱" --per '{"强":{"heavyTank":3}}' -o out   按强弱档批量放兵
  factory-row <map.tmx> --at x,y --n 3 --unit landFactory --team 0 [--v] -o out   工厂成组并排放置
  fleet <map.tmx> --name 航母编队 --at x,y --team 3 -o out   舰队编制（只放水上）    fleets   列出编制
  place-region <map.tmx> --box x0,y0,x1,y1 --unit U --team T --count N -o out    replace-units <map.tmx> --team T --from A --to B -o out
  travel <map.tmx> --from x,y --to x,y [--unit heavyTank]   行军时间估算（速度为粗估）    unit-names <map.tmx> [--units 模组单位表.txt]   单位名校验
  dsl-in <map.tmx> <文件.dsl> -o out | dsl-out <map.tmx> [--keys a,b]   触发器速记语法    tjson-out <map.tmx> | tjson-in <map.tmx> <文件.json> -o out
  sort-props <map.tmx> -o out                     触发器属性按固定顺序重排（减少 diff）
  tpl35 <名字> --params '{…}' [--map x.tmx -o out]   新模板（holdCities/eliminationChain/phaseAnnounce/reinforceWaves/airdrop）    tpl35-list
  cities <map.tmx> [-o 城市表.csv] | cities-in <map.tmx> <csv> -o out    factions <map.tmx>   势力配置表    merge-hints <map.tmx>   触发器合并建议
  team-colors <map.tmx>                           队伍颜色冲突/10 号以后未核对提示    fw-punct 请见 fix-punct
`;
const L = (K, f) => import(path.join(K, f));
const pt = (s) => String(s).split(',').map(Number);
const pts = (s) => String(s).split(';').map(pt);
const readTxt = (f) => fs.readFileSync(f, 'utf8');
const SEVN = { error: '错误', warn: '警告', info: '提示' };
function show(items, { max = 10 } = {}) { const by = new Map(); for (const i of items) { const k = `${i.sev}|${i.code}`; if (!by.has(k)) by.set(k, []); by.get(k).push(i); } for (const sev of ['error', 'warn', 'info']) for (const [k, v] of by) if (k.startsWith(sev)) { console.log(`[${SEVN[sev]}] ${k.split('|')[1]} ×${v.length}`); v.slice(0, max).forEach((i) => console.log('   ' + (i.key ? `「${i.key}」` : '') + i.msg)); } const c = { error: 0, warn: 0, info: 0 }; items.forEach((i) => c[i.sev]++); console.log(`\n结果: ${c.error} 错误， ${c.warn} 警告， ${c.info} 提示`); return c; }

export async function run(cmd, pos, flags, K) {
  const G = await L(K, 'geo35.js'), T = await L(K, 'text35.js'), U = await L(K, 'units35.js'), A = await L(K, 'author.js'), D = await L(K, 'deliver.js'), { parseTmx } = await L(K, 'tmx.js'), guard = await L(K, 'guard.js');
  const load = (f) => parseTmx(readTxt(f)); const out = (f, text, def) => { const o = flags.o || def || f.replace(/\.tmx$/, '.out.tmx'); guard.safeWrite(o, text, { overwrite: !!flags.force }); console.log('已写入', o); };
  const rules = () => (flags.rules ? JSON.parse(readTxt(flags.rules)) : {});
  const ref = () => (flags.ref ? load(flags.ref) : null);
  const f0 = pos[0];
  switch (cmd) {
    case 'check': case 'health': {
      const m = load(f0); const R = rules(); const units = flags.units ? U.parseUnitList(readTxt(flags.units)) : [];
      let win = null; if (flags.win) { const [team, at, pattern] = String(flags.win).split(':'); win = { team: +team, at: pts(at).map(([x, y]) => [x * 20 + 10, y * 20 + 10]), pattern }; }
      if (cmd === 'health') { const h = D.healthSummary(m, { rules: R }); console.log(h.text); h.top.forEach((i) => console.log(`  [${i.sec}] ${i.code} ${i.msg}`)); break; }
      const t0 = Date.now(); const res = D.deliveryCheck(m, { rules: R, ref: ref(), units, win, geo: !flags['no-geo'] });
      if (flags.json) { console.log(JSON.stringify(res, null, 1)); process.exit(res.counts.error ? 1 : 0); }
      console.log(D.deliveryText(res)); console.log(`(用时 ${Date.now() - t0} ms)\n`);
      for (const s of res.sections) { if (!s.items.length) continue; console.log(`── ${s.title}`); show(s.items.filter((i) => i.sev !== 'info'), { max: 4 }); }
      if (flags.md) { fs.writeFileSync(flags.md, D.deliveryNotes(m, res, { title: path.basename(f0, '.tmx'), ref: ref() })); console.log('已写入', flags.md); }
      process.exit(res.counts.error ? 1 : 0);
    }
    case 'package': {
      const text = readTxt(f0), m = parseTmx(text), R = rules(), res = D.deliveryCheck(m, { rules: R, ref: ref(), geo: true });
      const cover = flags.cover ? fs.readFileSync(flags.cover) : null; const pk = D.buildPackage(text, m, res, { title: flags.title || path.basename(f0, '.tmx'), version: flags.version || '', ref: ref(), cover });
      const dir = flags.o || path.join(path.dirname(f0), pk.name.replace(/\.zip$/, '')); fs.mkdirSync(dir, { recursive: true }); for (const f of pk.files) fs.writeFileSync(path.join(dir, f.name), f.data); fs.writeFileSync(path.join(dir, pk.name), pk.zip);
      console.log(D.deliveryText(res)); console.log('交付包:', dir, '\n  ' + pk.files.map((f) => f.name).join('\n  ') + '\n  ' + pk.name); break;
    }
    case 'changes': console.log(D.changeText(D.changeSummary(readTxt(pos[0]), readTxt(pos[1])))); break;
    case 'proj-new': { const ins = {}; for (const f of String(flags.inputs || '').split(',').filter(Boolean)) ins[f] = D.fnv1a(fs.readFileSync(f).toString('latin1')); const outs = { [f0]: D.fnv1a(fs.readFileSync(f0).toString('latin1')) }; fs.writeFileSync(flags.o || 'map.rwproj', JSON.stringify(D.makeProj({ name: flags.name || path.basename(f0), inputs: ins, outputs: outs }), null, 1)); console.log('已写入', flags.o || 'map.rwproj'); break; }
    case 'proj-check': { const p = JSON.parse(readTxt(f0)), cur = {}; for (const f of [...Object.keys(p.inputs), ...Object.keys(p.outputs)]) if (fs.existsSync(f)) cur[f] = D.fnv1a(fs.readFileSync(f).toString('latin1')); const r = D.checkProj(p, cur); show(r); process.exit(r.length ? 1 : 0); }
    case 'geo-check': { const m = load(f0); const circ = flags.circum ? pts(flags.circum) : []; show(G.lintGeo(m, { minGap: +(flags['min-gap'] ?? 12), smallMax: +(flags.small ?? 120), riverMax: +(flags.river ?? 3), circum: circ, clearance: +(flags.clear ?? 0) }), { max: 12 }); break; }
    case 'gaps': { const m = load(f0), r = G.gapReport(m, { minArea: +(flags['min-area'] ?? 200), minGap: +(flags['min-gap'] ?? 12) }); r.pairs.slice(0, +(flags.n ?? 40)).forEach((p) => console.log(`${p.tooNarrow ? '✗' : ' '} (${p.a.cx},${p.a.cy})[${p.a.area}] ↔ (${p.b.cx},${p.b.cy})[${p.b.area}]  最窄 ${p.gap} 格，深水连续 ${p.deepRun} 格，位置 (${p.at})`)); console.log(`共 ${r.comps} 块陆地，${r.pairs.length} 对相邻`); break; }
    case 'shallow-links': { if (flags.cut) { const m0 = load(f0), c = G.cutShallowLinks(m0, { minArea: +(flags['min-area'] ?? 200) }); let tx = G.applyLayer(readTxt(f0), 'ground', c.data); if (c.items) tx = G.applyLayer(tx, 'items', c.items); console.log(`把 ${c.cut} 格浅水改成深水,${c.rounds} 轮;仍相连的 ${c.left.length} 处`); out(f0, tx); break; } const m = load(f0), r = G.shallowOnlyLinks(m, { minArea: +(flags['min-area'] ?? 200) }); r.forEach((l) => console.log(`(${l.a.cx},${l.a.cy})[${l.a.area}] ↔ (${l.b.cx},${l.b.cy})[${l.b.area}] 浅水通道 ${l.shallowLen} 格，位置 (${l.at})`)); console.log(r.length ? `共 ${r.length} 处：陆军能从一块走到另一块` : '没有仅靠浅水相连的陆块'); process.exit(r.length ? 1 : 0); }
    case 'widen-gaps': { const m = load(f0); const min = +(flags['min-gap'] ?? 12); const r = G.erodeGaps(m, { minGap: min, minArea: 200, maxRounds: +(flags.rounds ?? 16), protect: +(flags.protect ?? 1) }); let text = G.applyLayer(readTxt(f0), 'ground', r.data); if (r.items) text = G.applyLayer(text, 'items', r.items); console.log(`逐圈削岸线 ${r.rounds} 轮,共削掉 ${r.removed} 格陆地;仍低于 ${min} 的 ${r.remaining.length} 处${r.capped ? '(超过上限,已停止)' : ''}`); r.remaining.slice(0, 12).forEach((p) => console.log(`  (${p.a.cx},${p.a.cy}) ↔ (${p.b.cx},${p.b.cy}) 最窄 ${p.gap} 格,位置 (${p.at[0]},${p.at[1]})`)); if (r.left.length) console.log(`  有 ${r.left.length} 处因为单位/建筑在岸边没有削(${r.left.slice(0, 5).map((l) => l.at.join(',')).join(' ')}…)`); out(f0, text); break; }
    case 'small-islands': { const m = load(f0); if (flags.remove) { const r = G.removeSmallIslands(m, { maxArea: +(flags.max ?? 120) }); console.log(`清掉 ${r.removed} 块（${r.cells} 格），保留 ${r.kept} 块有单位的`); out(f0, G.applyLayer(readTxt(f0), 'ground', r.data)); } else { const r = G.smallIslands(m, { maxArea: +(flags.max ?? 120) }); r.small.forEach((c) => console.log(`(${c.cx},${c.cy}) ${c.area} 格${c.near ? `,离最近大陆块 (${c.near.cx},${c.near.cy}) ${c.near.d} 格` : ''}`)); console.log(`共 ${r.small.length} 块；另有 ${r.kept.length} 块上面有单位（不动）`); } break; }
    case 'circum': { const m = load(f0); if (flags.all) G.circumnavAll(m, { clearance: +(flags.clear ?? 0) }).forEach((c) => console.log(`${c.ok ? '✓' : '✗'} (${c.cx},${c.cy}) ${c.area} 格${c.ok ? '' : ',连到边缘:' + c.touchEdges.join('')}`)); else { const r = G.circumnav(m, pt(flags.at), { clearance: +(flags.clear ?? 0) }); console.log(r.ok ? '能绕一圈' : r.reason || `绕不过：连到地图${r.touchEdges.join('、')}边缘，例如 (${r.borderCells[0]})`); } break; }
    case 'ports': { const r = G.portReach(load(f0)); console.log('主海面积', r.main?.area); show(r.issues); break; }
    case 'rivers': { const r = G.riverReport(load(f0), { maxWidth: +(flags.max ?? 3) }); r.rivers.forEach((x) => console.log(`河 (${x.cx},${x.cy}) 长≈${x.length} 宽 中位${x.median}/p90 ${x.p90}/最宽 ${x.max}${x.tooWide ? '  ← 太宽' : ''}`)); console.log(`断流 ${r.breaks.length} 处；悬空端点 ${r.dangling.length} 个`); r.breaks.slice(0, 8).forEach((b) => console.log('  断口', b.a, '↔', b.b)); break; }
    case 'dead-seas': { const m = load(f0); if (flags.fill) { const r = G.fillDeadSeas(m, { maxArea: +(flags.max ?? 4000) }); console.log(`填平 ${r.filled} 处（${r.cells} 格）`); out(f0, G.applyLayer(readTxt(f0), 'ground', r.data)); } else { const r = G.deadSeas(m, { maxArea: +(flags.max ?? 4000) }); r.forEach((c) => console.log(`(${c.cx},${c.cy}) ${c.area} 格`)); console.log(`共 ${r.length} 处`); } break; }
    case 'river-draw': { const m = load(f0), r = G.drawRiver(m, pts(flags.pts), { width: +(flags.width ?? 2), gid: flags.gid ? +flags.gid : undefined }); console.log(`改 ${r.cells} 格${r.mouth ? `,河口接到 (${r.mouth})` : ',终点附近没有深水，河没有入海'}`); out(f0, G.applyLayer(readTxt(f0), 'ground', r.data)); break; }
    case 'ridge': { const m = load(f0), r = G.drawRidge(m, pts(flags.pts), { width: +(flags.width ?? 2), passEvery: +(flags['pass-every'] ?? 40), passWidth: +(flags['pass-width'] ?? 5), gid: flags.gid ? +flags.gid : undefined }); console.log(`改 ${r.cells} 格，山口 ${r.passes.length} 个:${r.passes.map((p) => p.join(',')).join(' ')}`); out(f0, G.applyLayer(readTxt(f0), 'ground', r.data)); break; }
    case 'zoom': { const m = load(f0), r = G.radialZoom(m, pt(flags.at), +flags.r, +(flags.factor ?? 1.6)); console.log(`改 ${r.moved} 格（只动地形层；单位/触发器位置未动，请自行核对）`); out(f0, G.applyLayer(readTxt(f0), 'ground', r.data)); break; }
    case 'island-chain': { const m = load(f0), r = G.islandChain(m, pts(flags.pts), { n: +(flags.n ?? 8), gap: +(flags.gap ?? 12), rMin: +(flags.rmin ?? 6), rMax: +(flags.rmax ?? 14) }); console.log(`生成 ${r.islands.length} 座岛${r.short ? `(还差 ${r.short} 座，放不下）` : ''}`); out(f0, G.applyLayer(readTxt(f0), 'ground', r.data)); break; }
    case 'geo-import': { const m = load(f0), { grid, w, h } = G.parseAscGrid(readTxt(flags.asc)), r = G.rasterToLayers(m, grid, w, h, { sea: +(flags.sea ?? 0), shoreBand: +(flags.shore ?? 0), mountain: flags.mountain ? +flags.mountain : Infinity }); out(f0, G.applyLayer(readTxt(f0), 'ground', r.data)); break; }
    case 'sites': { const r = G.siteCities(load(f0), { n: +(flags.n ?? 20), minDist: +(flags['min-dist'] ?? 40), margin: +(flags.margin ?? 3) }); r.sites.forEach((s, i) => console.log(i + 1, s.x, s.y)); console.log(`选出 ${r.sites.length} 个${r.short ? `,还差 ${r.short}` : ''}(候选点 ${r.candidates})`); break; }
    case 'uniform': { const r = G.cityUniformity(load(f0), { radius: +(flags.radius ?? 90), team: flags.team !== undefined ? +flags.team : null }); console.log(`城市 ${r.cities} 座；${r.radius} 格内覆盖陆地 ${r.coverage}%;城间最近邻 中位${r.nnMedian}/最小${Math.round(r.nnMin)}/最大${Math.round(r.nnMax)}`); r.holes.forEach((h) => console.log(`  空白区 (${h.x},${h.y}) 离最近城市 ${h.dist} 格`)); break; }
    case 'pass-widths': { const r = G.passWidths(load(f0), pt(flags.from), pt(flags.to), { reach: +(flags.reach ?? 6), minWidth: +(flags.min ?? 3) }); if (r.blockedAll) console.log('这条线上没有任何一处能让陆军穿过（没有山口，或山脉整段封死）'); r.passes.forEach((q) => console.log(`山口 (${q.at}) 宽 ${q.width} 格${q.width < +(flags.min ?? 3) ? '  ← 太窄，大部队过不去' : ''}`)); console.log(`共 ${r.passes.length} 个山口，${r.narrow.length} 个偏窄`); break; }
    case 'shares': console.log(G.terrainShares(load(f0), ref()).text); break;
    case 'latlon': { const m = load(f0), c = G.geoConv(flags.bbox.split(',').map(Number), m.width, m.height, { proj: flags.proj || 'equirect' }); if (flags.cell) console.log(c.toLonLat(...pt(flags.cell)), '每格≈', c.kmPerCell(pt(flags.cell)[1]), 'km'); else if (flags.ll) console.log(c.toCell(...pt(flags.ll))); else console.log('每格≈', c.kmPerCell(m.height >> 1), 'km(图中部）'); break; }
    case 'decal': { const m = load(f0), r = G.blobDecal(m, { cx: pt(flags.at)[0], cy: pt(flags.at)[1], r: +flags.r, gid: +flags.gid, rough: +(flags.rough ?? 0.35), seed: +(flags.seed ?? 3) }); console.log(`改 ${r.cells} 格`); out(f0, G.applyLayer(readTxt(f0), 'ground', r.data)); break; }
    case 'gids': G.listGids(load(f0)).filter((g) => g.props.length).slice(0, +(flags.n ?? 80)).forEach((g) => console.log(g.gid, g.props.join(','))); break;
    case 'elim': { const r = T.eliminationText({ name: flags.name, capital: flags.capital, foe: flags.foe, chars: +(flags.chars ?? 200), facts: flags.facts ? String(flags.facts).split('|') : [], seed: +(flags.seed ?? 1) }); r.plan.forEach((p) => console.log(`[+${(p.at / 1000).toFixed(1)}s]\n${p.text}\n`)); console.log(`共 ${r.chars} 字，${r.messages.length} 条`); break; }
    case 'intro': { const m = load(f0), r = T.compressIntro(m, { budgetSec: +(flags.budget ?? 60) }); r.plan.forEach((p) => console.log(`${p.key}  ${(p.oldMs / 1000).toFixed(0)}s → ${(p.newMs / 1000).toFixed(1)}s${p.longest > 30 ? `  (有一行 ${p.longest} 字）` : ''}`)); console.log(`介绍共 ${r.plan.length} 条，最后一条 ${(r.before / 1000).toFixed(0)}s → ${(r.total / 1000).toFixed(1)}s(目标 ${flags.budget ?? 60}s)`); if (flags.o) { const a = T.applyTimes(readTxt(f0), r.plan); out(f0, a.text); } break; }
    case 'camp-colors': { const rs = String(flags.rules).split(',').map((s) => { const i = s.lastIndexOf(':'); return { test: s.slice(0, i), color: s.slice(i + 1) }; }); const r = T.applyCampColors(readTxt(f0), rs, { neutral: flags.neutral || null }); console.log(`改 ${r.hits} 处颜色`); out(f0, r.text); break; }
    case 'reports': { for (const c of String(flags.cities).split(',')) console.log(T.reportLines(flags.event, { city: c, who: flags.who || '某国' }, { all: !!flags.all, seed: 1 }).join('\n---\n') + '\n'); break; }
    case 'rename-text': { const mp = Object.fromEntries(String(flags.map).split(',').map((s) => s.split(':'))); const r = T.renameInTexts(readTxt(f0), mp); console.log(`替换 ${r.hits} 处，涉及 ${r.changed} 个触发器`); out(f0, r.text); break; }
    case 'text-panel': { const s = T.textPanel(load(f0), ref()); console.log(`${s.count} 条 / ${s.chars} 字；中位 ${s.median};最长一条 ${s.max};最长一行 ${s.maxLine};超 30 字的行 ${s.over30}${s.ratio ? `\n对参考图：条数 ${s.ratio.count} 倍，字数 ${s.ratio.chars} 倍` : ''}`); s.longest.forEach((l) => console.log(`  ${l.maxLine} 字  ${l.key}`)); break; }
    case 'screen': { const r = T.screenPreview(pos.join(' ').replace(/\\n/g, '\n'), { cols: +(flags.cols ?? 30) }); console.log(r.box); console.log(r.ok ? '没有超出' : `超出的行:${r.over.map((o) => `第${o.i}行 ${o.w}`).join(',')}`); break; }
    case 'fix-punct': { const r = T.fixPunct(readTxt(f0)); console.log(`改 ${r.changed} 条消息，${r.chars} 个标点`); out(f0, r.text); break; }
    case 'punct': show(T.lintPunct(load(f0))); break;
    case 'phases': { const rows = T.phaseTable(load(f0)); rows.slice(0, +(flags.n ?? 60)).forEach((r) => console.log(`${String(Math.round(r.at / 1000)).padStart(5)}s  ${r.key}  ${r.text.slice(0, 40)}`)); T.phaseGaps(rows).forEach((g) => console.log(`间隔过大:${g.from} → ${g.to} 隔 ${Math.round(g.gapMs / 1000)}s`)); break; }
    case 'locale-out': fs.writeFileSync(flags.o || 'locale.csv', T.exportLocaleTemplate(readTxt(f0))); console.log('已写入', flags.o || 'locale.csv'); break;
    case 'locale-in': { const r = T.importLocale(readTxt(f0), readTxt(pos[1]), flags.lang); console.log(`写入 ${r.written} 条 ${flags.lang}`); out(f0, r.text); break; }
    case 'placeholders': { const vars = Object.fromEntries(String(flags.vars || '').split(',').filter(Boolean).map((s) => s.split('='))); T.placeholderTable(load(f0)).forEach((r) => console.log(`{${r.name}} ×${r.count} 例:${r.keys[0]}`)); show(T.lintPlaceholders(load(f0), vars)); break; }
    case 'forces': { const m = load(f0); console.log(U.forceTableText(U.forceTable(m))); const r = ref(); if (r) { console.log('\n与参考图（每队平均）对照:'); U.compareForces(m, r).rows.forEach((x) => console.log(`${x.cat.padEnd(6, '　')} 本图 ${String(x.mine).padStart(6)}  参考 ${String(x.ref).padStart(6)}  ${x.ratio ?? '-'}倍  ${x.note}`)); } break; }
    case 'city-forces': U.cityForces(load(f0), { radius: +(flags.radius ?? 12) }).forEach((r) => console.log(`${r.name || `(${r.x},${r.y})`}  ${r.team}号  工厂 ${r.factories}  兵 ${r.army}  合计 ${r.total}`)); break;
    case 'plan-forces': { const m = load(f0), tiers = Object.fromEntries(String(flags.tiers).split(',').map((s) => s.split(':'))), r = U.planForces(m, tiers, JSON.parse(flags.per)); r.miss.slice(0, 10).forEach((x) => console.log('! ' + x)); console.log(`放置 ${r.count} 个`); out(f0, U.insertUnits(readTxt(f0), r.list)); break; }
    case 'factory-row': { const m = load(f0), [cx, cy] = pt(flags.at), r = U.factoryRow(m, { cx, cy, n: +(flags.n ?? 3), unit: flags.unit || 'landFactory', team: +flags.team, orient: flags.v ? 'v' : 'h' }); if (!r.ok) { console.error(r.reason); process.exit(1); } out(f0, U.insertUnits(readTxt(f0), r.list)); break; }
    case 'fleets': Object.entries(U.FLEETS).forEach(([k, v]) => console.log(k, JSON.stringify(v))); break;
    case 'fleet': { const m = load(f0), r = U.planFleet(m, flags.name, pt(flags.at), +flags.team); r.miss.forEach((x) => console.log('! ' + x)); console.log(`放置 ${r.list.length} 艘`); out(f0, U.insertUnits(readTxt(f0), r.list)); break; }
    case 'place-region': { const m = load(f0), r = U.placeInRegion(m, { box: flags.box.split(',').map(Number), unit: flags.unit, team: +flags.team, count: +flags.count }); console.log(`放置 ${r.list.length} 个${r.short ? `,还差 ${r.short}` : ''}`); out(f0, U.insertUnits(readTxt(f0), r.list)); break; }
    case 'replace-units': { const r = U.replaceUnits(readTxt(f0), { team: flags.team !== undefined ? +flags.team : null, from: flags.from, to: flags.to }); console.log(`替换 ${r.changed} 个`); out(f0, r.text); break; }
    case 'travel': { const r = U.travelTime(load(f0), pt(flags.from), pt(flags.to), flags.unit || 'heavyTank'); console.log(r.ok ? `${r.dist} 格，约 ${r.secs} 秒（速度是粗估，仅供比较）` : r.reason); break; }
    case 'unit-names': show(U.lintUnitNames(load(f0), flags.units ? U.parseUnitList(readTxt(flags.units)) : [])); break;
    case 'dsl-in': { const r = A.insertDsl(readTxt(f0), readTxt(pos[1])); console.log(`插入 ${r.count} 个触发器`); out(f0, r.text); break; }
    case 'dsl-out': process.stdout.write(A.toDsl(load(f0), { keys: flags.keys ? String(flags.keys).split(',') : null })); break;
    case 'tjson-out': process.stdout.write(A.exportTriggersJson(load(f0))); break;
    case 'tjson-in': { const r = A.importTriggersJson(readTxt(f0), readTxt(pos[1])); console.log(`更新 ${r.updated} / 新增 ${r.added}`); out(f0, r.text); break; }
    case 'sort-props': { const r = A.sortAllProps(readTxt(f0)); console.log(`重排 ${r.changed} 个触发器的属性顺序`); out(f0, r.text); break; }
    case 'tpl35-list': Object.entries(A.TEMPLATES35).forEach(([k, t]) => console.log(`${k}  ${t.title}\n    ${t.desc}\n    参数:${t.params.map((p) => p.k).join(', ')}`)); break;
    case 'tpl35': { const list = A.buildTemplate(pos[0], JSON.parse(flags.params || '{}')); if (flags.map) { const { insertTriggers } = await L(K, 'templates.js'); out(flags.map, insertTriggers(readTxt(flags.map), list)); } else console.log(JSON.stringify(list, null, 1)); break; }
    case 'cities': { const rows = A.cityTable(load(f0)); const csv = ['id,name,x,y,team', ...rows.map((r) => `${r.id},${r.name},${r.x},${r.y},${r.team}`)].join('\n') + '\n'; if (flags.o) { fs.writeFileSync(flags.o, csv); console.log('已写入', flags.o); } else process.stdout.write(csv); show(A.lintCityTable(rows)); break; }
    case 'cities-in': { const rows = readTxt(pos[1]).trim().split(/\r?\n/).slice(1).map((l) => { const [id, name, x, y, team] = l.split(','); return { id, name, x: +x, y: +y, team: +team }; }); const r = A.applyCityTable(readTxt(f0), rows); console.log(`改 ${r.changed} 座`); out(f0, r.text); break; }
    case 'factions': { const rows = A.factionTable(load(f0)); rows.forEach((r) => console.log(`${String(r.team).padStart(2)}号 ${r.color}  城 ${r.cities}  钱 ${r.credits || '-'}  AI难度 ${r.lockAiDifficulty || '-'}  同盟 ${r.allyGroup || '-'}  ${r.hasInfo ? '' : '(无 team_info)'}`)); show(A.lintFactionTable(rows)); break; }
    case 'merge-hints': { const r = A.mergeSuggestions(load(f0)); r.slice(0, 20).forEach((s) => console.log(`${s.count} 个相邻检测区可合并:${s.keys.join('、')}… → 框 ${s.bbox}(${s.note})`)); console.log(r.length ? `共 ${r.length} 组建议` : '没有明显可合并的'); break; }
    case 'team-colors': show(A.teamColorConflicts(load(f0))); break;
    default: console.log(USAGE35);
  }
}
export const NAMES35 = ['check', 'health', 'package', 'changes', 'proj-new', 'proj-check', 'geo-check', 'gaps', 'shallow-links', 'widen-gaps', 'small-islands', 'circum', 'ports', 'rivers', 'dead-seas', 'river-draw', 'ridge', 'zoom', 'island-chain', 'geo-import', 'sites', 'uniform', 'shares', 'pass-widths', 'latlon', 'decal', 'gids', 'elim', 'intro', 'camp-colors', 'reports', 'rename-text', 'text-panel', 'screen', 'fix-punct', 'punct', 'phases', 'locale-out', 'locale-in', 'placeholders', 'forces', 'city-forces', 'plan-forces', 'factory-row', 'fleets', 'fleet', 'place-region', 'replace-units', 'travel', 'unit-names', 'dsl-in', 'dsl-out', 'tjson-out', 'tjson-in', 'sort-props', 'tpl35-list', 'tpl35', 'cities', 'cities-in', 'factions', 'merge-hints', 'team-colors'];
