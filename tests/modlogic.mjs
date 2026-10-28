// Mod 编辑器逻辑：缩放、复制、变体、模板、DPS、模拟、建造树、改名、差异、素材、评分、修复
import { Mod, checkMod } from '../www/js/modedit.js';
import * as L from '../www/js/modlogic.js';
import { getVal, serializeIni } from '../www/js/ini.js';
import { writeZip, readZip } from '../www/js/zip.js';
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const png = (w, h) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); const dv = new DataView(b.buffer); dv.setUint32(16, w); dv.setUint32(20, h); return b; };
const zip = writeZip([
  { name: 'mod-info.txt', data: '[mod]\ntitle: T\nthumbnail: th.png\n' }, { name: 'th.png', data: png(64, 64) },
  { name: 'tank.ini', data: '[core]\nname: tank\nprice: 300\nmaxHp: 400\ndisplayText: Tank\n\n[graphics]\nimage: t.png\nframe_width: 30\ntotal_frames: 9\n\n[movement]\nmoveSpeed: 1.0\n\n[attack]\nmaxAttackRange: 160\n\n[turret_main]\nprojectile: shell\ndelay: 60\n\n[projectile_shell]\ndirectDamage: 30\n' },
  { name: 't.png', data: png(100, 30) }, { name: 'spare.png', data: png(8, 8) },
  { name: 'fac.ini', data: '[core]\nname: fac\nisBuilding: true\n\n[canBuild_1]\nname: tank*2\n' },
]);
const mod = await Mod.fromEntries(readZip(zip), 'm.rwmod');
const tank = mod.realUnits().find((u) => mod.unitName(u) === 'tank');
const s = L.unitStats(tank.ini);
ok(s.dps === 30 && s.hp === 400 && s.range === 160, 'DPS=30、血量、射程');
const c = L.copyUnit(mod, tank, 'tank2', ' II');
ok(mod.unitName(c) === 'tank2' && c.file === 'tank2.ini' && mod.realUnits().length === 3, '复制单位');
const n = L.scaleUnit(c.ini, { hp: 2, dmg: 1.5, price: 0.5 });
ok(n === 3 && getVal(c.ini, 'core', 'maxHp') === '800' && getVal(c.ini, 'projectile_shell', 'directDamage') === '45' && getVal(c.ini, 'core', 'price') === '150', '数值缩放 ×2 ×1.5 ×0.5');
ok(getVal(tank.ini, 'core', 'maxHp') === '400', '原单位不受影响');
const vs = L.makeVariants(mod, tank, ['light', 'heavy']);
ok(vs.length === 2 && L.unitStats(vs[1].ini).hp === 640 && mod.unitName(vs[0]) === 'tank_light', '生成变体');
const nu = L.fromTemplate(mod, 'infantry', 'rifle');
ok(L.unitStats(nu.ini).dps > 0 && mod.unitName(nu) === 'rifle', '模板新建');
L.addWeapon(tank.ini, 'rocket', 'rk');
ok(L.unitStats(tank.ini).weapons.length === 2, '添加武器模板');
const A = { ...s, air: true, ground: true }, B = { ...L.unitStats(c.ini), air: true, ground: true };
const r1 = L.simulate(s, 1, L.unitStats(c.ini), 1);
ok(r1.winner === 'B', '模拟：血量翻倍的赢（' + JSON.stringify(r1) + '）');
const g = L.buildGraph(mod);
ok(g.edges.get(mod.realUnits().find((u) => mod.unitName(u) === 'fac')).some((e) => e.unit === tank) && g.builtBy.get(tank).length === 1, '建造树');
L.renameUnit(mod, tank, 'big tank'.replace(' ', '_'));
const fac = mod.realUnits().find((u) => mod.unitName(u) === 'fac');
ok(/big_tank\*2/.test(getVal(fac.ini, 'canBuild_1', 'name')), '改名同步引用（保留 *2）');
const d = L.diffMod(mod);
ok(d.some((x) => x.kind === 'add' && x.name === 'tank2') && d.some((x) => x.kind === 'mod' && x.name === 'big_tank'), '差异：新增和修改');
ok(/tank2/.test(L.changelogMd(d)), '更新日志');
const a = L.assetIssues(mod);
ok(a.unused.includes('spare.png') && !a.unused.includes('th.png'), '未使用素材（缩略图算已用）');
ok(a.issues.some((x) => /帧宽/.test(x.msg)) && a.issues.some((x) => /total_frames/.test(x.msg)), '帧数检查');
const sc = L.scoreMod(mod, checkMod(mod));
ok(sc.score >= 0 && sc.score <= 100, '评分 ' + sc.score);
const m2 = await Mod.fromEntries(readZip(writeZip([{ name: 'a b.ini', data: '[core]\nprice: 1\n\n[turret_x]\n\n[projectile_y]\ndirectDamage: 1\n' }])), 'z');
const log = L.autoFix(m2);
ok(log.length >= 3 && getVal(m2.realUnits()[0].ini, 'core', 'name') === 'a_b', '一键修复：' + log.join(' / '));
// copyFrom 继承：子单位只写差异，统计、检查要按继承后的结果算
const mi = await Mod.fromEntries(readZip(writeZip([{ name: 'mod-info.txt', data: '[mod]\ntitle: I\n' }, { name: 'base.ini', data: '[core]\nname: base\nprice: 100\nmaxHp: 200\n\n[movement]\nmoveSpeed: 1\n\n[turret_a]\nprojectile: p\ndelay: 60\n\n[projectile_p]\ndirectDamage: 20\n' }, { name: 'kid.ini', data: '[core]\nname: kid\ncopyFrom: base\nprice: 150\n[movement]\nmoveSpeed: 2\n' }])), 'i');
const kid = mi.realUnits().find((u) => mi.unitName(u) === 'kid'), ks = L.unitStats(L.eff(mi, kid));
ok(ks.hp === 200 && ks.price === 150 && ks.speed === 2 && ks.dps === 20, '继承：血量、弹道从父单位来，价格和速度被覆盖');
const kr = checkMod(mi).map((r) => r.msg).join('|');
ok(!/不存在的弹道/.test(kr) && !/生命为 0/.test(kr), '继承：不误报弹道引用和生命为 0');
ok(L.compareRows(mi).find((r) => r.name === 'kid').dps === 20, '继承：对比表按继承后的数值');
process.exit(fail ? 1 : 0);
