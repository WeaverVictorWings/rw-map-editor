#!/usr/bin/env node
// RWKit CLI:node scripts/rwkit.mjs <命令> ...   无需浏览器/编辑器服务
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const K = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit');
const L = (f) => import(path.join(K, f));
const [cmd, ...rest] = process.argv.slice(2);
try { fs.mkdirSync('.rwkit', { recursive: true }); fs.appendFileSync('.rwkit/log.txt', `${new Date().toISOString()} ${process.argv.slice(2).join(' ')}\n`); } catch {} const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) { const a = rest[i]; if (a.startsWith('--') || a === '-o') { const k = a.replace(/^-+/, ''); flags[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } else pos.push(a); }
const usage = `RWKit 用法:
  lint <map.tmx> [--rules rules.json] [--json]   全套质检(触发器/文本/站位/连通/队伍/规则/陈旧输出)
  scen <map.tmx> --city <编号或检测名> [--team N] [--kill 5] [--cap 40] [--fail 1]   跑一次夺城场景,打印战报
  open <map.tmx> [--secs 30]                     开局模拟:有无刷屏/误触发
  remap <map.tmx> --swap 0,1 [-o out.tmx]        互换两个队伍编号(单位+触发器)
  remap <map.tmx> --perm "[1,0,3,...]" [-o out]  按排列重排队伍
  wrap "文本" [--w 20]                            按标点断行
  teams <map.tmx>                                 队伍使用情况与颜色
  report <map.tmx> [--rules r.json] [-o 报告.md]  一页 Markdown 报告(含各队概况;rules.ignore 可屏蔽已确认的警告,如 "T04:^占52")
  timeline <map.tmx> [--secs 120]                开局序幕/新闻时间线(按秒)
  find <map.tmx> "type=unitDetect reset=200 name~^占"   按条件搜索触发器    refs <map.tmx> <名字>   谁引用了它
  rename <map.tmx> <旧> <新> [-o out]            重命名并同步所有引用
  set <map.tmx> "过滤条件" --key reset --val 900 [-o out]   批量改属性(过滤语法同 find)
  clone <map.tmx> <名字> --suffix _b [--tree] [-o out]      克隆触发器(--tree 连同下游子树)
  diff <a.tmx> <b.tmx>                           触发器增/删/改
  texts <map.tmx> [-o texts.csv] | texts-in <map.tmx> <texts.csv> [-o out]   导出/导入全部新闻文本
  graph <map.tmx> [--root 名字] [--dot]          触发器依赖图(mermaid/dot)
  tpl capture <map.tmx> --k 99 --cx 40 --cy 40 --teams 0,1 [-o out]      插入一条夺城链模板
  png <map.tmx> -o 图.png [--mode pass|terrain] [--step 2]   通行性/地形图(蓝=水 青=浅滩/桥 绿=可建造 黄=仅可走 黑=不可通行)
  crop <map.tmx> --box x0,y0,x1,y1 -o 测试图.tmx   截取窗口做小测试图(图层改成 csv)
  pools <map.tmx>                                资源池总数/缺抽取仪的池格(按池格算,本图一格一个抽取仪)
  fill <map.tmx> [--unit extractorT1] [--radius 10] [--teams 0,1] -o out   给缺口补抽取仪(归属=半径内最近的指挥中心;半径内没有的跳过)
  rmunits <map.tmx> --re "^seaFactory$" [--teams 3] -o out   按单位名删除
  passes <map.tmx> --from x,y --to x,y [--naval]  沿线段列出可通行区段(查山口宽度/岩墙漏洞)
  water <map.tmx>                                水域连通域(面积/外接框)
  perf <map.tmx>                                 触发器负担估算(相对指标)
  dump <map.tmx>                                 稳定排序的触发器文本(适合 git diff)
  groups <map.tmx>                               触发器按名字家族分组(数字当通配)    patterns <map.tmx>   各家族共同属性/变化属性
  gates <map.tmx>                                逻辑门(basic)清单:来源、且/或、谁引用    heat <map.tmx> [--team N] [--step 8]  单位热力图(文字)
  strength <map.tmx>                             各队强弱粗估(权重是经验值)    rewards <map.tmx>   各队奖励总额与触发条件
  colors <map.tmx>                               按相邻关系给各队推荐颜色    tcolors <map.tmx>   消息文字色与队伍色是否一致
  geo <map.tmx> --geojson 地区.json -o out [--proj mercator] [--bbox lon0,lat0,lon1,lat1]   GeoJSON 多边形 → 陆/水(覆盖整个 ground 层)
  coast <map.tmx> [--rounds 1] -o out            海岸线平滑(只动水↔普通陆地,不动悬崖/岩浆)
  box <map.tmx> --box x0,y0,x1,y1 --gid N [--only lava|cliff|all] -o out   区域地形覆盖(例:某区域不要悬崖)
  road <map.tmx> --from x,y --to x,y --gid N -o out   A* 在陆地上铺道路(gid 由你指定)
  scale <map.tmx> --km 5                         比例尺换算
  build <项目.rwproj.json> [--run]               按输入/输出新旧决定要重跑哪些步骤(默认只打印计划)
  diag <map.tmx> "过滤条件" -o out               诊断版:去掉某一类触发器(如 "name~^势名"),二分排错用
  init-rules [-o rules.json]                     生成带历史错误检查的规则模板
  terrain-report <map.tmx>                       各类地形占比(岩浆/悬崖/水...)
  route <map.tmx> --from x,y --to x,y [--naval|--land] [--clear 1]   通道是否连通 / 最大可过船宽
`;
const load = async (f) => { const { parseTmx } = await L('tmx.js'); return parseTmx(fs.readFileSync(f, 'utf8')); };
const say = (items) => { const c = { error: 0, warn: 0, info: 0 }; for (const i of items) c[i.sev]++; return c; };
if (cmd === 'lint') {
  const f = pos[0]; const m = await load(f); const R = flags.rules ? JSON.parse(fs.readFileSync(flags.rules, 'utf8')) : {};
  const [{ lintTriggers }, g, { checkRules }, { checkTeams }, { staleCheck }, { openingCheck }] = await Promise.all([L('tlint.js'), L('grid.js'), L('rules.js'), L('teams.js'), L('guard.js'), L('tsim.js')]);
  const AN = await L('analysis.js'); let items = AN.applyIgnore(AN.allChecks(m, R), R.ignore).kept;
  items.push(...staleCheck(f, ...(R.sources || [])));
  const o = openingCheck(m, 30); if (o.messages > (R.openMsgMax ?? 6)) items.push({ sev: 'warn', code: 'O01', msg: `开局 30 秒内有 ${o.messages} 条消息(可能刷屏)` });
  if (flags.json) { console.log(JSON.stringify(items, null, 1)); process.exit(items.some((i) => i.sev === 'error') ? 1 : 0); }
  const by = new Map(); for (const i of items) { const k = `${i.sev}|${i.code}`; if (!by.has(k)) by.set(k, []); by.get(k).push(i); }
  for (const sev of ['error', 'warn', 'info']) for (const [k, v] of by) if (k.startsWith(sev)) { console.log(`[${sev}] ${k.split('|')[1]} ×${v.length}`); v.slice(0, flags.all ? 1e9 : 3).forEach((i) => console.log('   ', i.key ? `「${i.key}」` : '', i.msg)); }
  const c = say(items); console.log(`\n结果: ${c.error} 错误, ${c.warn} 警告, ${c.info} 提示`); process.exit(c.error ? 1 : 0);
} else if (cmd === 'scen') {
  const m = await load(pos[0]); const { captureScenario } = await L('tsim.js'); const k = String(flags.city);
  const c = m.objects.find((q) => q.name === '检测' + k || q.name === k); if (!c) { console.error('找不到城市检测区', k); process.exit(2); }
  const team = flags.team !== undefined ? +flags.team : +(m.objects.find((q) => q.name.startsWith('占' + k.replace(/\D/g, '') + '_'))?.props.team ?? 0);
  const s = captureScenario(m, { x: c.x + c.w / 2, y: c.y + c.h / 2, team, killAt: +(flags.kill ?? 5), capAt: +(flags.cap ?? 40), until: +(flags.until ?? 90), spawnFail: +(flags.fail ?? 0) });
  const skip = new Set((await L('tsim.js')).openingCheck(m, 30).list.map((l) => l.name)); for (const l of s.log) if (!skip.has(l.name) && !l.name.startsWith('开场')) console.log(`${l.t.toFixed(1)}s  ${l.name}  ${l.msg.replace(/\n/g, ' / ')}`);
} else if (cmd === 'open') {
  const m = await load(pos[0]); const o = (await L('tsim.js')).openingCheck(m, +(flags.secs ?? 30)); console.log(`消息 ${o.messages} 条`); o.list.forEach((l) => console.log(`${l.t}s ${l.name}: ${l.msg.replace(/\n/g, ' / ').slice(0, 50)}`));
} else if (cmd === 'remap') {
  const t = fs.readFileSync(pos[0], 'utf8'); const tm = await L('teams.js'); let r;
  if (flags.swap) { const [a, b] = flags.swap.split(',').map(Number); r = tm.swapTeams(t, a, b); } else r = tm.remapTeams(t, JSON.parse(flags.perm));
  const out = flags.o || pos[0].replace(/\.tmx$/, '.remap.tmx'); const { safeWrite } = await L('guard.js'); safeWrite(out, r, { overwrite: !!flags.force }); console.log('已写入', out);
} else if (cmd === 'wrap') { console.log((await L('textlint.js')).wrap(pos.join(' '), +(flags.w ?? 20)));
} else if (cmd === 'teams') {
  const m = await load(pos[0]); const tm = await L('teams.js'); for (const [k, v] of [...tm.teamUsage(m)].sort((a, b) => a[0] - b[0])) console.log(`${String(k).padStart(3)} 号  ${tm.slotColor(k)}  单位${v.units} 触发器${v.triggers}`);
} else if (cmd === 'route') {
  const m = await load(pos[0]); const g = await L('grid.js'); const [a, b] = [flags.from.split(',').map(Number), flags.to.split(',').map(Number)]; const fl = flags.land ? 1 : 2;
  console.log('可达:', g.routeExists(m, a, b, { flag: fl, clearance: +(flags.clear ?? 0) }), ' 最大可过宽度(格):', g.minChannelWidth(m, a, b, fl));
} else if (cmd === 'report') {
  const m = await load(pos[0]); const R = flags.rules ? JSON.parse(fs.readFileSync(flags.rules, 'utf8')) : {}; const r = (await L('analysis.js')).report(m, R, path.basename(pos[0]));
  if (flags.o) { fs.writeFileSync(flags.o, r.md); console.log('已写入', flags.o, r.counts); } else console.log(r.md);
} else if (cmd === 'timeline') { const m = await load(pos[0]); (await L('analysis.js')).timeline(m, +(flags.secs ?? 120)).forEach((l) => console.log(l));
} else if (cmd === 'find') { const R = await L('refactor.js'); const r = R.query(fs.readFileSync(pos[0], 'utf8'), pos[1]); r.slice(0, +(flags.n ?? 40)).forEach((x) => console.log(x.key, x.type)); console.log(`共 ${r.length} 个`);
} else if (cmd === 'refs') { const R = await L('refactor.js'); const r = R.findRefs(await load(pos[0]), pos[1]); r.forEach((x) => console.log(x.by, x.via)); console.log(`共 ${r.length} 处引用`);
} else if (cmd === 'rename' || cmd === 'set' || cmd === 'clone' || cmd === 'texts-in' || cmd === 'tpl') {
  const R = await L('refactor.js'), G = await L('guard.js'); const t = fs.readFileSync(pos[0], 'utf8'); let out, msg = '';
  if (cmd === 'rename') out = R.renameTrigger(t, pos[1], pos[2]);
  else if (cmd === 'set') { const r = R.batchSet(t, pos[1], flags.key ? { [flags.key === 'reset' ? 'resetActivationAfter' : flags.key]: String(flags.val) } : {}, flags.del ? [flags.del] : []); out = r.text; msg = `改了 ${r.changed} 个`; }
  else if (cmd === 'clone') { const keys = flags.tree ? R.subtree(await load(pos[0]), pos[1]) : [pos[1]]; out = R.cloneTriggers(t, keys, flags.suffix || '_copy'); msg = `克隆 ${keys.length} 个`; }
  else if (cmd === 'texts-in') { const r = R.importTexts(t, fs.readFileSync(pos[1], 'utf8')); out = r.text; msg = `更新 ${r.changed} 个触发器的文本`; }
  else { const TP = await L('templates.js'); const k = flags.k, teams = String(flags.teams || '').split(',').filter(Boolean).map(Number); out = TP.insertTriggers(t, TP.captureChain({ k, cx: +flags.cx, cy: +flags.cy, teams })); msg = `已插入夺城链 ${k}`; }
  const o = flags.o || pos[0].replace(/\.tmx$/, `.${cmd}.tmx`); G.safeWrite(o, out, { overwrite: !!flags.force }); console.log(msg, '→', o);
} else if (cmd === 'diff') { const R = await L('refactor.js'); const d = R.diffTriggers(fs.readFileSync(pos[0], 'utf8'), fs.readFileSync(pos[1], 'utf8')); console.log(`新增 ${d.added.length}  删除 ${d.removed.length}  修改 ${d.changed.length}`); d.added.slice(0, 10).forEach((k) => console.log(' +', k)); d.removed.slice(0, 10).forEach((k) => console.log(' -', k)); d.changed.slice(0, 10).forEach((c) => console.log(' ~', c.key, c.diff.join('; ')));
} else if (cmd === 'texts') { const csv = (await L('refactor.js')).exportTexts(fs.readFileSync(pos[0], 'utf8')); if (flags.o) { fs.writeFileSync(flags.o, csv); console.log('已写入', flags.o); } else process.stdout.write(csv);
} else if (cmd === 'graph') { process.stdout.write((await L('refactor.js')).depGraph(await load(pos[0]), { root: flags.root, fmt: flags.dot ? 'dot' : 'mermaid' }));
} else if (cmd === 'png') { const m = await load(pos[0]); fs.writeFileSync(flags.o, (await L('terrain.js')).renderPng(m, { mode: flags.mode || 'pass', step: +(flags.step ?? 2) })); console.log('已写入', flags.o);
} else if (cmd === 'crop') { const t = fs.readFileSync(pos[0], 'utf8'); const out = (await L('terrain.js')).cropTmx(t, await load(pos[0]), flags.box.split(',').map(Number)); (await L('guard.js')).safeWrite(flags.o, out, { overwrite: !!flags.force }); console.log('已写入', flags.o);
} else if (cmd === 'pools') { const U = await L('units.js'); const m = await load(pos[0]); const g = U.poolGaps(m); console.log(`资源池格 ${U.pools(m).length},缺抽取仪 ${g.length}(其中在势力指挥中心半径 10 格内 ${g.filter((c) => U.ownerOf(m, c) !== null).length})`); g.slice(0, 10).forEach((c) => console.log(' ', c.join(',')));
} else if (cmd === 'fill' || cmd === 'rmunits') { const U = await L('units.js'), G = await L('guard.js'); const t = fs.readFileSync(pos[0], 'utf8'); const o = flags.o || pos[0].replace(/\.tmx$/, `.${cmd}.tmx`); let r;
  if (cmd === 'fill') { r = U.fillPools(t, { unit: flags.unit || 'extractorT1', radius: +(flags.radius ?? 10), onlyTeams: flags.teams ? flags.teams.split(',').map(Number) : null }); console.log(`补了 ${r.added} 个,跳过 ${r.skipped} 个(半径内无指挥中心)`); } else { r = U.removeUnits(t, { unitRe: new RegExp(flags.re), teams: flags.teams ? flags.teams.split(',').map(Number) : null }); console.log(`删了 ${r.removed} 个`); }
  G.safeWrite(o, r.text, { overwrite: !!flags.force }); console.log('→', o);
} else if (cmd === 'passes') { const T = await L('terrain.js'); const m = await load(pos[0]); const [a, b] = [flags.from.split(',').map(Number), flags.to.split(',').map(Number)]; T.scanLine(m, a, b, flags.naval ? 2 : 1).forEach((r) => console.log(r.ok ? '可通行' : '阻断  ', `${r.len} 格`, `(${r.from})→(${r.to})`));
} else if (cmd === 'water') { const w = (await L('terrain.js')).waterComponents(await load(pos[0])); w.comps.slice(0, 15).forEach((c) => console.log(`#${c.id} 面积 ${c.area} 框 ${c.bbox}`)); console.log(`共 ${w.comps.length} 块水域(>=10 格)`);
} else if (cmd === 'perf') { console.log((await L('terrain.js')).perfEstimate(await load(pos[0])));
} else if (cmd === 'dump') { const m = await load(pos[0]); const { TRIGGER_TYPES, trigKey } = await L('tmx.js'); m.objects.filter((o) => TRIGGER_TYPES.has(o.type.toLowerCase())).sort((a, b) => trigKey(a).localeCompare(trigKey(b))).forEach((o) => console.log(`[${trigKey(o)}] ${o.type} @${o.x},${o.y} ${o.w}x${o.h}\n` + Object.keys(o.props).sort().map((k) => `  ${k} = ${JSON.stringify(o.props[k])}`).join('\n')));
} else if (cmd === 'groups') { (await L('insight.js')).groups(await load(pos[0])).slice(0, +(flags.n ?? 40)).forEach((g) => console.log(String(g.count).padStart(5), g.family, `[${g.types}]`));
} else if (cmd === 'patterns') { (await L('insight.js')).patterns(await load(pos[0])).slice(0, 30).forEach((p) => { console.log(`${p.family} ×${p.count} (${p.type})`); console.log('   共同:', JSON.stringify(p.common)); console.log('   变化:', p.vary.join(',') || '无'); });
} else if (cmd === 'gates') { (await L('insight.js')).gates(await load(pos[0])).slice(0, +(flags.n ?? 30)).forEach((g) => console.log(`${g.key} [${g.mode}] 来源${g.sources} 关闭${g.closedBy.length}个 reset=${g.reset} ← ${g.usedBy.join(' ')}`));
} else if (cmd === 'heat') { const I = await L('insight.js'); const hm = I.unitHeat(await load(pos[0]), { step: +(flags.step ?? 8), filter: (u) => flags.team === undefined || +u.props.team === +flags.team }); console.log(I.heatText(hm));
} else if (cmd === 'strength') { const r = (await L('insight.js')).strength(await load(pos[0])); r.rows.forEach((x) => console.log(`${String(x.team).padStart(3)} 号  ${String(x.power).padStart(6)}  ×${x.ratio}`)); if (r.unknownUnits.length) console.log('未配权重的单位(按 1 计):', r.unknownUnits.join(',')); console.log(r.note);
} else if (cmd === 'rewards') { (await L('mapops.js')).rewardCurve(await load(pos[0])).forEach((r) => console.log(`${r.team} 号 总额 ${r.total}  ` + r.rows.map((x) => `${x.needCities ?? '-'}城:${x.add}`).join(' ')));
} else if (cmd === 'colors') { const M = await L('mapops.js'); const r = M.colorAssign(await load(pos[0])); Object.entries(r).sort((a, b) => a[0] - b[0]).forEach(([t, c]) => console.log(`${t} 号 → ${c}`)); console.log('注意:颜色是游戏按队伍编号决定的,这里给的是"哪个编号配哪个颜色最合适",要用 remap --perm 把队伍号换过去');
} else if (cmd === 'tcolors') { const r = (await L('mapops.js')).lintTeamColors(await load(pos[0])); r.slice(0, 20).forEach((i) => console.log(i.key, i.msg)); console.log(`共 ${r.length} 处`);
} else if (cmd === 'geo' || cmd === 'coast' || cmd === 'box' || cmd === 'road') {
  const M = await L('mapops.js'), G = await L('guard.js'); const t = fs.readFileSync(pos[0], 'utf8'); const m = await load(pos[0]); let out, msg = '';
  if (cmd === 'geo') { const { mask, bbox } = M.rasterizePolygons(JSON.parse(fs.readFileSync(flags.geojson, 'utf8')), m.width, m.height, { bbox: flags.bbox && flags.bbox.split(',').map(Number), proj: flags.proj }); out = M.paintMask(t, mask, { land: flags.land && +flags.land, water: flags.water && +flags.water }); msg = `陆地 ${mask.reduce((a, b) => a + b, 0)} 格,范围 ${bbox.map((v) => v.toFixed(2))}`; }
  else if (cmd === 'coast') { const r = M.smoothCoast(t, { rounds: +(flags.rounds ?? 1) }); out = r.text; msg = `改了 ${r.changed} 格`; }
  else if (cmd === 'box') { const r = M.overrideBox(t, flags.box.split(',').map(Number), +flags.gid, { onlyIf: flags.only || 'all' }); out = r.text; msg = `改了 ${r.changed} 格`; }
  else { const p = M.findPath(m, flags.from.split(',').map(Number), flags.to.split(',').map(Number)); if (!p) { console.error('两点之间陆路不通'); process.exit(2); } out = M.paintRoad(t, p, +flags.gid); msg = `路径 ${p.length} 格`; }
  G.safeWrite(flags.o || pos[0].replace(/\.tmx$/, `.${cmd}.tmx`), out, { overwrite: !!flags.force }); console.log(msg, '→', flags.o || '(默认文件名)');
} else if (cmd === 'scale') { console.log((await L('mapops.js')).scale(await load(pos[0]), +flags.km));
} else if (cmd === 'build') { const proj = JSON.parse(fs.readFileSync(pos[0], 'utf8')); const root = path.dirname(path.resolve(pos[0])); const plan = (await L('insight.js')).planBuild(proj, root, { fs, path }); const { execSync } = await import('node:child_process'); for (const s of plan) { console.log(`${s.run ? '▶' : '·'} ${s.name}  (${s.why})`); if (s.run && flags.run) { try { execSync(s.cmd, { cwd: root, stdio: 'inherit' }); } catch (e) { console.error(`步骤「${s.name}」失败:${s.cmd}`); process.exit(1); } } }
} else if (cmd === 'diag') { const X = await L('extras.js'); const r = X.diagVariant(fs.readFileSync(pos[0], 'utf8'), pos[1]); (await L('guard.js')).safeWrite(flags.o || pos[0].replace(/\.tmx$/, '.diag.tmx'), r.text, { overwrite: !!flags.force }); console.log(`去掉了 ${r.dropped} 个触发器 →`, flags.o || '(默认文件名)');
} else if (cmd === 'init-rules') { const X = await L('extras.js'); const o = flags.o || 'rules.json'; (await L('guard.js')).safeWrite(o, JSON.stringify(X.MISTAKE_TEMPLATE, null, 2), { overwrite: !!flags.force }); console.log('已写入', o);
} else if (cmd === 'terrain-report') { (await L('extras.js')).terrainReport(await load(pos[0])).forEach((r) => console.log(r.name.padEnd(6), String(r.cells).padStart(8), r.pct + '%'));
} else console.log(usage);
