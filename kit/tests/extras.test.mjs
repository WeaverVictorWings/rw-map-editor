import fs from 'fs'; import assert from 'node:assert/strict'; import { parseTmx } from '../tmx.js'; import * as X from '../extras.js'; import { lintTriggers } from '../tlint.js';
const src = fs.readFileSync(process.argv[2], 'utf8'); const m = parseTmx(src); let pass = 0; const T = (n, f) => { try { f(); pass++; console.log('ok  ', n); } catch (e) { console.log('FAIL', n, e.message.split('\n')[0]); process.exitCode = 1; } };
T('地形占比和为 100%', () => { const r = X.terrainReport(m); assert.ok(Math.abs(r.reduce((a, b) => a + b.pct, 0) - 100) < 0.1); assert.equal(r.find((x) => x.name === '岩浆').cells, 0); });
T('设施依赖检查可运行', () => assert.ok(Array.isArray(X.lintFacilities(m))));
T('开局单位与检测区冲突检查可运行', () => assert.ok(Array.isArray(X.lintStartInDetect(m))));
T('诊断版去掉一类触发器且无悬空引用', () => { const r = X.diagVariant(src, 'name~^势名'); assert.ok(r.dropped > 50); const l = lintTriggers(parseTmx(r.text)); assert.equal(l.filter((i) => i.code === 'G02' || i.code === 'G01').length, 0); assert.ok(parseTmx(r.text).objects.length < m.objects.length); });
T('诊断版:去掉被引用的触发器时清理引用', () => { const r = X.diagVariant(src, 'name~^检测0$'); const l = lintTriggers(parseTmx(r.text)); assert.equal(l.filter((i) => i.code === 'G02').length, 0); });
T('等级标签', () => assert.ok(X.levelOf('G02').includes('模型')));
console.log(pass, '项通过');
