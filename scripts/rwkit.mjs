#!/usr/bin/env node
// RWKit CLI:node scripts/rwkit.mjs <命令> ...   无需浏览器/编辑器服务
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const K = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit');
const L = (f) => import(path.join(K, f));
const [cmd, ...rest] = process.argv.slice(2); const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) { const a = rest[i]; if (a.startsWith('--')) { const k = a.slice(2); flags[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } else pos.push(a); }
const usage = `RWKit 用法:
  lint <map.tmx> [--rules rules.json] [--json]   全套质检(触发器/文本/站位/连通/队伍/规则/陈旧输出)
  scen <map.tmx> --city <编号或检测名> [--team N] [--kill 5] [--cap 40] [--fail 1]   跑一次夺城场景,打印战报
  open <map.tmx> [--secs 30]                     开局模拟:有无刷屏/误触发
  remap <map.tmx> --swap 0,1 [-o out.tmx]        互换两个队伍编号(单位+触发器)
  remap <map.tmx> --perm "[1,0,3,...]" [-o out]  按排列重排队伍
  wrap "文本" [--w 20]                            按标点断行
  teams <map.tmx>                                 队伍使用情况与颜色
  route <map.tmx> --from x,y --to x,y [--naval|--land] [--clear 1]   通道是否连通 / 最大可过船宽
`;
const load = async (f) => { const { parseTmx } = await L('tmx.js'); return parseTmx(fs.readFileSync(f, 'utf8')); };
const say = (items) => { const c = { error: 0, warn: 0, info: 0 }; for (const i of items) c[i.sev]++; return c; };
if (cmd === 'lint') {
  const f = pos[0]; const m = await load(f); const R = flags.rules ? JSON.parse(fs.readFileSync(flags.rules, 'utf8')) : {};
  const [{ lintTriggers }, g, { checkRules }, { checkTeams }, { staleCheck }, { openingCheck }] = await Promise.all([L('tlint.js'), L('grid.js'), L('rules.js'), L('teams.js'), L('guard.js'), L('tsim.js')]);
  let items = [...lintTriggers(m, { teamCount: R.teams, text: R.text }), ...g.checkPlacement(m), ...g.landConnectivity(m), ...checkRules(m, R), ...checkTeams(m, { expect: R.teams })];
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
} else console.log(usage);
