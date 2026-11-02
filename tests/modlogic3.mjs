// 3.1 逻辑：源码诊断/补全/整理、翻译表、图鉴、体检、对比
import { Mod, checkMod } from '../www/js/modedit.js';
import * as T from '../www/js/modlogic3.js';
import { getVal } from '../www/js/ini.js';
import { writeZip, readZip } from '../www/js/zip.js';
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const mk = async (files) => Mod.fromEntries(readZip(writeZip(files)), 'x.rwmod');
const U = '[core]\nname: tank\nprice: 200\nmaxHp: 300\ndisplayText: 坦克\ndisplayDescription: 结实, "好用"\n\n[movement]\nmovementType: LAND\nmoveSpeed: 1\n\n[turret_a]\nprojectile: b\n\n[projectile_b]\ndirectDamage: 10\nlife: 60\n';
const M = await mk([{ name: 'mod-info.txt', data: '[mod]\ntitle: T\n' }, { name: 'tank.ini', data: U }]);

let d = T.lintText('[core]\nname: a\nmaxHp: abc\nmaxHp: 5\nprice 5\n[movement]\nmovementType: SWIM\nmoveSped: 1\n[oops\n');
ok(d.some((x) => x.line === 3 && x.lv === 'error'), '诊断：数字写成字母');
ok(d.some((x) => x.line === 4 && /两次/.test(x.msg)), '诊断：键重复');
ok(d.some((x) => x.line === 5 && /冒号/.test(x.msg)), '诊断：没有冒号');
ok(d.some((x) => x.line === 7 && /SWIM/.test(x.msg)), '诊断：枚举值不对');
ok(d.some((x) => x.line === 8 && /moveSpeed/.test(x.msg)), '诊断：键名拼错给建议');
ok(d.some((x) => x.line === 9 && /右括号/.test(x.msg)), '诊断：段名没闭合');
ok(T.lintText(U).length === 0, '诊断：正常单位零误报');
ok(T.lintText('[core]\nprice: 3000,人力=5\nmaxHp: ${hp}\n[x_1]\nfoo: bar\n').length === 0, '诊断：自定义资源/模板变量/未知段不误报');

let src = '[movement]\nmovementType: L', c = T.completions(src, src.length);
ok(c.items.length === 1 && c.items[0].insert === 'LAND' && src.slice(c.from) === 'L', '补全：枚举值');
src = '[core]\nmaxH'; c = T.completions(src, src.length);
ok(c.items.some((i) => i.insert === 'maxHp: ') && src.slice(c.from) === 'maxH', '补全：键名');
src = '[tur'; c = T.completions(src, src.length); ok(c.items.some((i) => i.insert === 'turret_'), '补全：段名');
src = '[core]\nisBio: '; c = T.completions(src, src.length); ok(c.items.length === 2, '补全：布尔');

const f = T.formatIni('[core]\r\nname:tank  \r\n\r\n\r\n\r\nprice:   200\r\n[movement]\r\n# c\r\nmoveSpeed :1');
ok(f === '[core]\r\nname: tank\r\n\r\nprice: 200\r\n\r\n[movement]\r\n# c\r\nmoveSpeed: 1\r\n', '整理：冒号空格、空行、保留注释和换行风格 ' + JSON.stringify(f));
ok(T.formatIni(T.formatIni('[a]\nx:1')) === T.formatIni('[a]\nx:1'), '整理：幂等');

const csv = T.translationCsv(M);
ok(/^﻿file,section,key,text/.test(csv) && /"displayDescription"/.test(csv) && /结实, ""好用""/.test(csv), '翻译表：导出并转义');
const csv2 = csv.replace('"坦克"', '"Tank"') + '"tank.ini","core","displayText_en","Tank EN"\r\n';
const r = T.applyTranslationCsv(M, csv2);
ok(r.changed === 1 && r.added === 1 && getVal(M.units.find((u) => u.file === 'tank.ini').ini, 'core', 'displayText') === 'Tank', '翻译表：导回修改和新增 ' + JSON.stringify(r));
ok(T.parseCsv('a,"b,\nc",d\r\n1,2,3').length === 2 && T.parseCsv('a,"b,\nc",d\r\n1,2,3')[0][1] === 'b,\nc', 'CSV 解析：引号内换行');

const docs = T.docsMd(M); ok(/\| tank \|/.test(docs) && /图鉴/.test(docs), '图鉴');
const h = T.healthMd(M, checkMod(M)); ok(/综合分/.test(h) && /体积/.test(h), '体检报告');
const O = await mk([{ name: 'mod-info.txt', data: '[mod]\ntitle: T\n' }, { name: 'tank.ini', data: U.replace('maxHp: 300', 'maxHp: 250') }]);
const dm = T.diffMods(O, await mk([{ name: 'mod-info.txt', data: '[mod]\ntitle: T\n' }, { name: 'tank.ini', data: U }]));
ok(dm.length === 1 && dm[0].changes.some((x) => x.from === '250' && x.to === '300'), '对比两个版本');
ok(T.formatIni('[core] # hi\nname:a') === '[core] # hi\nname: a\n', '整理：段名后的注释不重复');
{ const X = await mk([{ name: 'mod-info.txt', data: '[mod]\n' }, { name: 'a.ini', data: '[core]\nname:a\ndisplayText:甲\n' }, { name: 'b.ini', data: '[core]\nname: b\ndisplayText: 乙\n' }]);
  const ua = X.units.find((u) => u.file === 'a.ini'), ub = X.units.find((u) => u.file === 'b.ini');
  const { setVal } = await import('../www/js/ini.js'); setVal(ua.ini, 'core', 'price', '77'); ub.text = '[core]\nname: b\ndisplayText: 乙\nmaxHp:5'; ub.srcDirty = true;
  const n = T.formatAllUnits(X); const out = Object.fromEntries(X.collect().map((f) => [f.name, new TextDecoder().decode(f.data)]));
  ok(n === 2 && /price: 77/.test(out['a.ini']) && /name: a/.test(out['a.ini']), '整理全部：保留表单里的改动');
  ok(/maxHp: 5/.test(out['b.ini']), '整理全部：保留源码里的改动');
  const Y = await mk([{ name: 'mod-info.txt', data: '[mod]\n' }, { name: 'a.ini', data: '[core]\nname: a\ndisplayText: 甲\n' }]);
  const yu = Y.units[0]; yu.text = '[core]\nname: a\ndisplayText: 甲\nmaxHp: 9\n'; yu.srcDirty = true;
  T.applyTranslationCsv(Y, 'file,section,key,text\r\na.ini,core,displayText,A\r\n');
  const o2 = new TextDecoder().decode(Y.collect().find((f) => f.name === 'a.ini').data);
  ok(/displayText: A/.test(o2) && /maxHp: 9/.test(o2), '翻译导回：不丢源码模式里的改动'); }
{ const s = '[core]\nmaxH: 3'; const c = T.completions(s, 8); ok(c.items.some((i) => i.insert === 'maxHp'), '补全：行里已有冒号时不再多加冒号'); }
process.exit(fail ? 1 : 0);
