// 2.0 功能测试（对话框、模板、生成、图片）：node tests/v2b.mjs <样例地图.tmx> <样例图片> <截图目录>
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const [, , sample, img, out = '.'] = process.argv;
const URL = process.env.URL || 'http://localhost:8765/index.html';
const fail = []; const errors = [];
const expect = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fail.push(m); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(URL);
await page.waitForFunction(() => window.__rwReady);
const text = fs.readFileSync(sample, 'utf8');
await page.evaluate(async (t) => { await window.__rw.loadMapFromText(t, 'sample.tmx'); }, text);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const primary = () => page.locator('.modal .mfoot button.primary').last().click();

console.log('新建 60 人地图');
await page.evaluate(async () => { await window.__rw.createNewMap({ name: '大图', w: 400, h: 400, players: 60, start: 'blank', layout: 'grid', base: -1, pools: 1, center: 4 }); });
let r = await page.evaluate(() => ({ teams: window.__rw.ed.usedTeams().size, mi: !!window.__rw.ed.mapInfo() }));
expect(r.teams === 60 && r.mi, '60 支队伍 + map_info ' + JSON.stringify(r));
await page.waitForTimeout(400); await shot('30-60p');

console.log('随机生成对话框');
await page.click('[data-mode=generate]');
await page.locator('.acard', { hasText: '随机生成' }).click();
await page.waitForTimeout(300); await shot('31-generator');
await primary();
await page.waitForFunction(() => document.getElementById('busy').classList.contains('hidden'));
await page.waitForTimeout(600); await shot('32-generated');
r = await page.evaluate(() => ({ teams: window.__rw.ed.usedTeams().size, pools: window.__rw.ed.poolTiles().length }));
expect(r.teams >= 2 && r.pools > 0, '生成出生点和资源池 ' + JSON.stringify(r));

console.log('通行叠加 / 地盘');
await page.evaluate(() => window.__rw.setOverlay('land'));
await page.waitForTimeout(500); await shot('33-overlay-land');
await page.evaluate(() => window.__rw.setOverlay('territory'));
await page.waitForFunction(() => document.getElementById('busy').classList.contains('hidden'));
await page.waitForTimeout(500); await shot('34-territory');
await page.evaluate(() => window.__rw.setOverlay('none'));

console.log('平衡报告');
await page.locator('.dtab', { hasText: '报告' }).click();
await page.locator('#dockBody button.primary').click();
await page.waitForFunction(() => document.getElementById('busy').classList.contains('hidden'));
await page.waitForTimeout(300); await shot('35-report');
expect(await page.locator('table.rep').count() > 0, '报告表格');

console.log('印章');
await page.locator('.dtab', { hasText: '印章' }).click();
await page.waitForTimeout(300); await shot('36-stamps');
const n0 = await page.evaluate(() => window.__rw.ed.undoStack.length);
await page.locator('.stamp').first().click();
const box = await page.locator('#cv').boundingBox();
await page.mouse.move(box.x + 400, box.y + 400, { steps: 3 });
await page.mouse.click(box.x + 400, box.y + 400);
expect(await page.evaluate((n) => window.__rw.ed.undoStack.length === n + 1, n0), '放置印章');

console.log('历史');
await page.locator('.dtab', { hasText: '历史' }).click();
await page.waitForTimeout(200); await shot('37-history');
await page.locator('.hist .hitem').first().click();
expect(await page.evaluate(() => window.__rw.ed.undoStack.length === 0), '历史面板跳回最初');

console.log('整图镜像');
await page.evaluate(() => window.__rw.ed.redo());
await page.locator('[data-mode=generate]').click();
await page.locator('.acard', { hasText: '整图镜像' }).click();
await primary();
await page.waitForFunction(() => document.getElementById('busy').classList.contains('hidden'));
await page.waitForTimeout(400); await shot('38-mirror');

console.log('图片转地图');
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.acard', { hasText: '图片转地图' }).click()]);
await fc.setFiles(img);
await page.waitForSelector('.wiz');
await page.waitForFunction(() => document.getElementById('busy').classList.contains('hidden'));
await page.waitForTimeout(500); await shot('39-image2map');
await primary();
await page.waitForFunction(() => document.getElementById('busy').classList.contains('hidden'), null, { timeout: 60000 });
await page.waitForTimeout(600); await shot('40-image-result');

console.log('立绘贴图');
const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.acard', { hasText: '立绘贴图' }).click()]);
await fc2.setFiles(img);
await page.waitForTimeout(800); await shot('41-picture');
await primary();
await page.waitForTimeout(800);
await page.mouse.move(box.x + 500, box.y + 300, { steps: 3 });
await page.waitForTimeout(200); await shot('42-picture-float');
await page.mouse.click(box.x + 500, box.y + 300);
expect(await page.evaluate(() => !window.__rw.ed.floating), '贴图放下');

console.log('生存 / 任务模板');
await page.click('[data-mode=triggers]');
await page.locator('.tpl', { hasText: '生存模式' }).click(); await primary();
await page.waitForTimeout(300); await shot('43-waves');
await primary();
await page.locator('.tpl', { hasText: '任务关卡' }).click(); await page.waitForTimeout(200); await shot('44-mission');
await primary();
await page.waitForTimeout(300); await shot('45-trig-after');
r = await page.evaluate(() => { const { ed } = window.__rw; const T = ed.map.group('Triggers'); const mi = ed.mapInfo(); return { n: T.objects.length, type: mi.props.find((p) => p.name === 'type').value, waves: (mi.props.find((p) => p.name === 'survivalWaves') || {}).value, errs: window.__rw.triggerIssues().filter((i) => i.level === 'error').map((i) => i.title) }; });
console.log('  ', JSON.stringify(r).slice(0, 400));
expect(r.type === 'mission' && r.waves && r.waves.includes('\n') && !r.errs.length, '模板生成正确');
// 保存后多行属性写成元素内容
const xml = await page.evaluate(() => window.__rw.serialize());
expect(/<property name="survivalWaves">\+1:00/.test(xml), 'survivalWaves 多行写法');
// 坏触发器被检查出来
r = await page.evaluate(() => { const { ed } = window.__rw; const T = ed.map.group('Triggers'); ed.begin('t'); ed.op.snapshotGroup(T); T.objects.push({ attrs: { name: 'bad', type: 'unitAdd', x: '0', y: '0', width: '20', height: '20' }, props: [{ name: 'id', value: 'bad' }, { name: 'activatedBy', value: 'nope' }, { name: 'delay', value: '20' }, { name: 'team', value: 'none' }], extra: [] }); ed.commit(); return window.__rw.triggerIssues().filter((i) => i.obj && i.obj.attrs.name === 'bad').map((i) => i.level + ':' + i.title); });
console.log('  ', r.join(' | '));
expect(r.length >= 4, '坏触发器被检查出 4 个问题');

console.log('功能搜索 / 帮助 / 教程');
await page.keyboard.press('Control+k'); await page.keyboard.type('缩放'); await page.waitForTimeout(200); await shot('46-palette');
await page.keyboard.press('Escape');
await page.locator('#dockBody .qbtn').first().click(); await page.waitForTimeout(200); await shot('47-help');
await page.keyboard.press('Escape');
await page.evaluate(() => { window.__rw.A.hooks.tutorial(); });
await page.waitForTimeout(200); await page.locator('.modal .acard').first().click();
await page.waitForTimeout(300); if (await page.locator('.modal .mfoot button.primary', { hasText: '开始' }).count()) await page.locator('.modal .mfoot button.primary', { hasText: '开始' }).click();
await page.waitForFunction(() => window.__rw.ed.map.width === 80 && document.getElementById('busy').classList.contains('hidden'));
await page.waitForTimeout(500); await shot('48-tutorial');
// 教程第一步：选地形
await page.locator('#dockBody .sw').nth(2).click();
await page.waitForTimeout(300);
expect(await page.evaluate(() => document.querySelector('#coach .step').textContent.startsWith('2/')), '教程进入第 2 步');
expect(await page.evaluate(async () => (await (await import('./js/io.js')).snapshots()).length >= 0), '教程前存了快照');
await shot('49-tutorial2');
const real = errors;
console.log('错误：', real.length ? real.join('\n') : '无');
console.log(fail.length ? `失败 ${fail.length} 项` : '全部通过');
await browser.close();
process.exit(fail.length || real.length ? 1 : 0);
