// 3.2 逻辑：派生、逐条修复、切帧、批量改、段复制、关系图、搜索、图鉴网页等
import { Mod, checkMod } from '../www/js/modedit.js';
import * as F from '../www/js/modlogic4.js';
import { getVal, serializeIni } from '../www/js/ini.js';
import { diffMods } from '../www/js/modlogic3.js';
import { writeZip, readZip } from '../www/js/zip.js';
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const mk = async (files) => Mod.fromEntries(readZip(writeZip(files)), 'x.rwmod');
const png = (w, h) => { const b = new Uint8Array(40); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const unit = (n, extra = '') => `[core]\nname: ${n}\nprice: 100\nmaxHp: 200\ndisplayText: ${n}\n\n[graphics]\nimage: ${n}.png\nframe_width: 32\nframe_height: 32\ntotal_frames: 9\n\n[movement]\nmoveSpeed: 1\n\n[attack]\nmaxAttackRange: 150\n\n[turret_a]\nprojectile: p\n\n[projectile_p]\ndirectDamage: 20\nlife: 60\nspeed: 8\n${extra}`;
const M = await mk([{ name: 'mod-info.txt', data: '[mod]\ntitle: T\n' }, { name: 'a.png', data: png(64, 32) }, { name: 'a.ini', data: unit('a') },
  { name: 'b.ini', data: unit('b').replace('projectile: p', 'projectile: ghost') + '[canBuild_x]\nname: a\n' }, { name: 'c.ini', data: '[core]\ncopyFrom: a\nname: c\n' }]);
const A = M.units.find((u) => u.file === 'a.ini'), B = M.units.find((u) => u.file === 'b.ini');

const d = F.deriveUnit(M, A, 'tougher');
ok(d.name === 'a_tougher' && d.after.hp > d.before.hp && d.after.price > d.before.price && /更肉/.test(getVal(d.unit.ini, 'core', 'displayText')) && M.units.includes(d.unit), '派生：更肉');
ok(F.deltaText(d.before, d.after).includes('生命 +60%'), '变化文字 ' + F.deltaText(d.before, d.after));

const R = checkMod(M).find((r) => /ghost/.test(r.msg)); const fx = F.fixOf(M, R);
ok(fx && /弹道/.test(fx.label), '逐条修复：识别缺弹道');
ok(/新建了/.test(F.applyFix(M, R)) && getVal(B.ini, 'projectile_ghost', 'life') === '60' && !checkMod(M).some((r) => /ghost/.test(r.msg)), '逐条修复：新建后检查通过');
ok(F.fixOf(M, { file: 'c.ini', msg: '[turret_z] 引用了不存在的弹道 projectile_q' }) === null, '继承来的单位不乱修');
const fr = F.guessFrames(256, 64); ok(fr[0].total >= 2 && fr.some((c) => c.fw === 64 && c.fh === 64 && c.total === 4), '切帧候选 ' + fr.slice(0, 3).map((c) => c.label).join('|'));
ok(F.guessFrames(3, 3).length === 0, '切帧：小图不崩');
const path = F.importSprite(M, 'new.png', png(128, 32), F.guessFrames(128, 32).find((c) => c.fw === 32), A);
ok(M.files.has(path) && getVal(A.ini, 'graphics', 'image') === 'new.png' && getVal(A.ini, 'graphics', 'total_frames') === '4', '导入精灵图并写好帧参数');

const pv = F.batchPreview(M.realUnits(), { sec: 'core', key: 'price', op: 'mul', value: '1.1' });
ok(pv.length >= 3 && pv.every((r) => r.to === String(Math.round(+r.from * 1.1))), '批量改：预览 ×1.1 ' + pv.length);
const pv2 = F.batchPreview(M.realUnits(), { sec: 'turret_*', key: 'projectile', op: 'set', value: 'p' }); ok(pv2.every((r) => /^turret_/.test(r.sec)), '批量改：通配段名');
F.batchApply(pv, 'price'); ok(getVal(A.ini, 'core', 'price') === '110', '批量改：应用');

const clip = F.copySection(A, 'turret_a'); ok(clip.sections.length === 2 && clip.sections[1].name === 'projectile_p', '复制炮塔时带上弹道');
const added = F.pasteSection(A, clip); ok(added.join() === 'turret_a_2,projectile_p_2' && getVal(A.ini, 'turret_a_2', 'projectile') === 'p_2', '粘贴：改名并同步引用 ' + added);
const added2 = F.pasteSection(B, F.copySection(A, 'turret_a')); ok(getVal(B.ini, added2[0], 'projectile') !== undefined, '粘贴到别的单位');

const g = F.relationGraph(M); ok(g.edges.some((e) => e.kind === 'copy' && e.to === A) && g.edges.some((e) => e.kind === 'build'), '关系图：继承和建造');
const lay = F.layoutGraph(g); ok(lay.length === g.units.length && lay.find((x) => x.u === A).layer >= 1, '关系图：分层');

const st = F.standing(M, A); ok(st && st.total >= 2 && st.verdict, '实时对比：位置 ' + JSON.stringify(st));
const sr = F.searchMod(M, 'ghost'); ok(sr.length >= 2 && sr.some((x) => x.unit), '全局搜索 ' + sr.length);
ok(F.searchMod(M, 'price: \\d+', { regex: true }).length >= 3 && F.searchMod(M, '(', { regex: true }).length === 0, '全局搜索：正则，坏正则不崩');
ok(F.searchFields('射程').some((x) => x.key === 'maxAttackRange') && F.searchFields('hp').some((x) => x.key === 'maxHp'), '字段搜索');
const html = F.galleryHtml(M, 'T'); ok(/<table/.test(html) && /data:image\/png;base64/.test(html) && !/<script>[^<]*fetch/.test(html), '图鉴网页');

const O = await mk([{ name: 'mod-info.txt', data: '[mod]\n' }, { name: 'a.ini', data: unit('a') }]);
const N = await mk([{ name: 'mod-info.txt', data: '[mod]\n' }, { name: 'a.ini', data: unit('a').replace('price: 100', 'price: 120') }, { name: 'z.ini', data: unit('z') }]);
const dd = diffMods(O, N); ok(/120/.test(F.diffHtml(dd, 'T')) && /新增：z/.test(F.announcement(dd, 'T', '1.1')) && /price 100→120/.test(F.announcement(dd, 'T')), '版本对比网页和公告');
process.exit(fail ? 1 : 0);
