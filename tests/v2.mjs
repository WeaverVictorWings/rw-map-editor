// 2.0 端到端测试：node tests/v2.mjs <样例地图.tmx> <截图目录>
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const [, , sample, out = '.'] = process.argv;
const URL = process.env.URL || 'http://localhost:8765/index.html';
const fail = []; const errors = [];
const expect = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fail.push(m); };
const browser = await chromium.launch();
async function newPage(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__rwReady, null, { timeout: 15000 });
  return page;
}
const text = fs.readFileSync(sample, 'utf8');
const page = await newPage(1366, 820);
await page.screenshot({ path: out + '/01-welcome.png' });
console.log('载入地图');
const t0 = Date.now();
await page.evaluate(async (t) => { await window.__rw.loadMapFromText(t, 'sample.tmx'); }, text);
console.log('  载入耗时', Date.now() - t0, 'ms');
await page.waitForTimeout(800);
await page.screenshot({ path: out + '/02-terrain.png' });
const info = await page.evaluate(() => { const { ed } = window.__rw; return { w: ed.map.width, h: ed.map.height, eng: !!ed.engine, spawns: ed.spawns().length, teams: ed.usedTeams().size }; });
console.log('  ', JSON.stringify(info));
expect(info.eng, '地形引擎可用');
// 每个模式截图
for (const m of ['items', 'units', 'triggers', 'generate', 'tiles']) {
  await page.click(`[data-mode=${m}]`); await page.waitForTimeout(300);
  await page.screenshot({ path: out + `/03-mode-${m}.png` });
}
// 画一笔
await page.click('[data-mode=terrain]');
await page.evaluate(() => { const { ed, rend } = window.__rw; rend.centerOn(100, 100, 1); });
await page.waitForTimeout(200);
const box = await page.locator('#cv').boundingBox();
await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 500, box.y + 340, { steps: 8 }); await page.mouse.up();
const undoN = await page.evaluate(() => window.__rw.ed.undoStack.length);
expect(undoN === 1, '画一笔产生 1 步撤销');
await page.waitForTimeout(300);
await page.screenshot({ path: out + '/04-painted.png' });
// 框选 + 复制 + 粘贴
await page.keyboard.press('m');
await page.mouse.move(box.x + 280, box.y + 280); await page.mouse.down(); await page.mouse.move(box.x + 520, box.y + 400, { steps: 5 }); await page.mouse.up();
const hasSel = await page.evaluate(() => !!window.__rw.ed.selection);
expect(hasSel, '框选得到选区');
await page.screenshot({ path: out + '/05-selection.png' });
await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
await page.mouse.move(box.x + 700, box.y + 500, { steps: 3 });
await page.waitForTimeout(150);
await page.screenshot({ path: out + '/06-floating.png' });
await page.mouse.click(box.x + 700, box.y + 500);
expect(await page.evaluate(() => !window.__rw.ed.floating && window.__rw.ed.undoStack.length === 2), '粘贴放下');
// 触发器：城市模板（直接调用）
await page.click('[data-mode=triggers]'); await page.waitForTimeout(200);
await page.click('.tpl >> nth=0'); await page.waitForTimeout(200);
await page.screenshot({ path: out + '/07-city-dialog.png' });
await page.click('.mfoot button.primary');
await page.waitForTimeout(150);
await page.mouse.click(box.x + 600, box.y + 300);
await page.waitForTimeout(400);
const trig = await page.evaluate(() => { const T = window.__rw.ed.map.group('Triggers'); return T.objects.length; });
console.log('  Triggers 对象数', trig);
expect(trig > 20, '城市模板生成了触发器');
await page.screenshot({ path: out + '/08-triggers-list.png' });
await page.click('.tcard2 >> nth=1'); await page.waitForTimeout(300);
await page.screenshot({ path: out + '/09-trigger-editor.png' });
const issues = await page.evaluate(() => window.__rw.triggerIssues().filter((i) => i.level === 'error').map((i) => i.title));
expect(issues.length === 0, '模板触发器没有错误 ' + issues.join(' | '));
// 逻辑图
await page.evaluate(() => { document.querySelector('.teditor button').click(); });
await page.waitForTimeout(200);
await page.locator('button', { hasText: '逻辑图' }).first().click(); await page.waitForTimeout(400);
await page.screenshot({ path: out + '/10-graph.png' });
await page.keyboard.press('Escape');
// 检查
await page.click('#btnCheck'); await page.waitForTimeout(500);
await page.screenshot({ path: out + '/11-checks.png' });
await page.keyboard.press('Escape');
// 等比缩放 ×2（小图）
const sc = await page.evaluate(async () => {
  const { ed, scaleMap, rend, A } = window.__rw;
  const t = performance.now();
  const p0 = ed.poolTiles().length;
  const r = scaleMap(ed, 2, {});
  rend.setMap(ed.map); A.mini.rebuild();
  return { ...r, ms: Math.round(performance.now() - t), spawns: ed.spawns().length, p0, p1: ed.poolTiles().length };
});
console.log('  缩放', JSON.stringify(sc));
expect(sc.W2 === info.w * 2, '缩放后宽度翻倍');
expect(sc.spawns === info.spawns, `缩放后出生点数量不变 ${info.spawns} → ${sc.spawns}`);
expect(sc.p0 === sc.p1, `缩放后资源池数量不变 ${sc.p0} → ${sc.p1}`);
await page.waitForTimeout(500);
await page.screenshot({ path: out + '/12-scaled.png' });
const ser = await page.evaluate(async () => { const s = await window.__rw.serialize(); return s.length; });
expect(ser > 1000, '缩放后可以保存 ' + ser);
// 撤销缩放
await page.evaluate(() => window.__rw.ed.undo());
expect(await page.evaluate(() => window.__rw.ed.map.width) === info.w, '撤销缩放');
// 图块形式的单位：缩放时转成对象，不被复制
const ut = await page.evaluate(() => {
  const { ed, scaleMap } = window.__rw;
  ed.undo();
  const L = ed.map.ensureLayer('Units');
  const g = ed.unitGid('commandCenter', 0), W = ed.map.width;
  for (const [x, y] of [[10, 10], [50, 40], [200, 300]]) L.data[y * W + x] = g;
  const before = ed.spawns().length;
  scaleMap(ed, 2, {});
  const after = ed.spawns().length, left = [...ed.map.layer('Units').data].filter((v) => v).length;
  ed.undo();
  const back = [...ed.map.layer('Units').data].filter((v) => v).length;
  return { before, after, left, back };
});
console.log('  ', JSON.stringify(ut));
expect(ut.after === ut.before + 3 && ut.left === 0 && ut.back === 3, '图块单位转成 3 个对象（不复制），撤销后还原');
// 资源池默认 1 格
const pool1 = await page.evaluate(() => { const { ed } = window.__rw; const it = ed.items.find((i) => i.pool); ed.begin('t'); ed.placeItemOne(ed.map.ensureLayer('Items'), it, 30, 30); const n = ed.op.tI.length; ed.commit(); ed.undo(); ed.poolStyle = '3x3'; ed.begin('t'); ed.placeItemOne(ed.map.items, it, 30, 30); const n3 = ed.op.tI.length; ed.commit(); ed.undo(); ed.poolStyle = '1x1'; return [n, n3]; });
expect(pool1[0] <= 1 && pool1[1] >= 8, '资源池默认 1 格，3×3 样式可选 ' + pool1);
// 手机
const ph = await newPage(400, 860, true);
await ph.evaluate(async (t) => { await window.__rw.loadMapFromText(t, 'sample.tmx'); }, text);
await ph.waitForTimeout(700);
await ph.screenshot({ path: out + '/20-phone.png' });
await ph.click('[data-mode=triggers]'); await ph.waitForTimeout(300);
await ph.screenshot({ path: out + '/21-phone-triggers.png' });
await ph.click('[data-mode=items]'); await ph.waitForTimeout(300);
await ph.screenshot({ path: out + '/22-phone-items.png' });
const real = errors.filter((e) => !/404/.test(e));
console.log('错误：', real.length ? real.join('\n') : '无');
console.log(fail.length ? `失败 ${fail.length} 项` : '全部通过');
await browser.close();
process.exit(fail.length || real.length ? 1 : 0);
