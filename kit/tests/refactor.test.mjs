import fs from 'fs'; import assert from 'node:assert/strict';
import * as R from '../refactor.js'; import * as TP from '../templates.js'; import { captureScenario } from '../tsim.js'; import { parseTmx } from '../tmx.js'; import { lintTriggers } from '../tlint.js'; import { Sim } from '../tsim.js';

const src = fs.readFileSync(process.argv[2], 'utf8'); let pass = 0; const T = (n, f) => { try { f(); pass++; console.log('ok  ', n); } catch (e) { console.log('FAIL', n, '\n   ', e.message.split('\n')[0]); process.exitCode = 1; } };
const errs = (t) => lintTriggers(parseTmx(t)).filter((i) => i.sev === 'error').length;
T('重命名后引用同步、无新错误', () => { const t = R.renameTrigger(src, '检测0', '检测甲'); assert.equal(errs(t), 0); const m = parseTmx(t); assert.ok(m.objects.some((o) => o.name === '检测甲')); assert.equal(R.findRefs(m, '检测0').length, 0); assert.ok(R.findRefs(m, '检测甲').length >= 1); });
T('重命名前后模拟结果一致', () => { const t = R.renameTrigger(src, '检测0', '检测甲'); const a = new Sim(parseTmx(src)).run(60).log.length, b = new Sim(parseTmx(t)).run(60).log.length; assert.equal(a, b); });
T('重名拒绝', () => assert.throws(() => R.renameTrigger(src, '检测0', '检测1')));
T('搜索', () => assert.ok(R.query(src, 'type=unitDetect name~^检测').length > 100));
T('批量改属性只影响命中项', () => { const r = R.batchSet(src, 'type=unitDetect name~^检测', { resetActivationAfter: '900' }); assert.ok(r.changed > 100); assert.equal(errs(r.text), 0); const q = R.query(r.text, 'name~^检测 reset=900'); assert.equal(q.length, r.changed); });
T('克隆子树', () => { const m = parseTmx(src); const keys = R.subtree(m, '检测0'); const t = R.cloneTriggers(src, keys, '_b'); assert.equal(errs(t), 0); assert.equal(parseTmx(t).objects.length, m.objects.length + keys.length); });
T('文本导出再导入无变化', () => { const csv = R.exportTexts(src); const r = R.importTexts(src, csv); assert.equal(r.changed, 0); });
T('文本导入改一条', () => { const csv = R.exportTexts(src).replace('收复了', '光复了'); const r = R.importTexts(src, csv); assert.ok(r.changed > 0); assert.ok(r.text.includes('光复了')); });
T('对比', () => { const t = R.renameTrigger(src, '检测0', '检测甲'); const d = R.diffTriggers(src, t); assert.ok(d.added.includes('检测甲') && d.removed.includes('检测0')); });
T('依赖图', () => assert.ok(R.depGraph(parseTmx(src), { root: '检测0' }).startsWith('flowchart')));

T('模板:夺城链插入后 lint 无错、模拟出战报', () => {
  const lst = TP.captureChain({ k: 9001, cx: 40, cy: 40, teams: [0, 1], texts: { 0: '【战报】甲军攻占了测试城。' } });
  const t = TP.insertTriggers(src, lst); assert.equal(errs(t), 0);
  const s = captureScenario(parseTmx(t), { x: 40 * 20 + 10, y: 40 * 20 + 10, team: 0, killAt: 5, capAt: 40, until: 70 });
  assert.ok(s.log.some((l) => l.name === '占9001_0讯'), '应有战报');
});
T('模板:没占领就不出战报', () => { const t = TP.insertTriggers(src, TP.captureChain({ k: 9002, cx: 41, cy: 41, teams: [0, 1] })); const s = captureScenario(parseTmx(t), { x: 41 * 20 + 10, y: 41 * 20 + 10, team: 0, killAt: 5, capAt: 999, until: 60 }); assert.ok(!s.log.some((l) => l.name.startsWith('占9002'))); });
T('模板:覆灭开局不误触发', () => { const t = TP.insertTriggers(src, TP.eliminated({ id: '灭X', team: 3, W: 1090, H: 670, text: '某国覆灭' })); const m = parseTmx(t); assert.ok(!new Sim(m).run(20).log.some((l) => l.name === '灭X讯')); });
T('模板:名字已存在时拒绝', () => assert.throws(() => TP.insertTriggers(src, TP.captureChain({ k: 0, cx: 5, cy: 5 }))));
console.log(pass, '项通过');
