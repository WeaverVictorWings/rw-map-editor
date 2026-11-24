// 3.5:工具箱与触发器编辑器新功能的界面测试:node tests/v35.mjs <样例地图.tmx>(需要 python3 -m http.server 8765 --directory www)
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const fail = []; const expect = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fail.push(m); };
const sample = fs.readFileSync(process.argv[2] || '/tmp/crop_euro.tmx', 'utf8');
const b = await chromium.launch(); const ctx = await b.newContext({ locale: 'zh-CN', viewport: { width: 1200, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('rwNoUpdate', '1'); localStorage.setItem('rwSeen', '3.5.0'); } catch { /* 忽略 */ } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:8765/index.html'); await p.waitForFunction(() => window.__rwReady);
await p.evaluate(async (t) => { await window.rwApi.loadText(t, 'sample.tmx'); }, sample);
const footer = (l) => p.evaluate((x) => { const b = [...document.querySelectorAll('.modal .mfoot button')].filter((e) => e.textContent === x).pop(); if (b) b.click(); return !!b; }, l);
const body = () => p.locator('.modal .mbody').last().innerText();
const btn = (t) => p.locator('.modal button', { hasText: t }).first();
await p.evaluate(async () => { (await import('./js/kit35ui.js')).toolbox(); });
await p.waitForSelector('.modal .mbody');
expect(/交付前检查/.test(await body()), '工具箱打开,首页是交付检查');
await btn('运行交付前检查').click(); await p.waitForFunction(() => /错误|警告/.test(document.querySelector('.modal:last-of-type .mbody')?.innerText || ''), null, { timeout: 120000 });
expect(/(通过|有警告|有错误)/.test(await body()), '交付检查给出红黄绿结论');
expect(await p.locator('.modal details').count() >= 6, '交付检查按分段列出');
for (const [tab, act, re] of [['地形', '地形连通检查', /C66|没有发现问题|C5\d/], ['地形', '地形占比', /陆地/], ['文本', '文本统计 + 标点检查', /条 \/ \d+ 字/], ['文本', '阶段通报时间表', /时间/], ['兵力', '兵力对照表', /队伍/], ['兵力', '单位预算与热力', /预置对象/], ['触发器写作', '合并建议', /合并|没有明显/], ['城市/势力表', '读取', /城市/]]) {
  await p.locator('.modal button', { hasText: new RegExp('^' + tab.replace('/', '\\/') + '$') }).first().click(); await p.waitForTimeout(150);
  await btn(act).click(); await p.waitForFunction((r) => new RegExp(r).test(document.querySelector('.modal:last-of-type .mbody')?.innerText || ''), re.source, { timeout: 60000 }).catch(() => {});
  expect(re.test(await body()), `${tab} → ${act}`);
}
// 覆灭文本草稿
await p.locator('.modal button', { hasText: /^文本$/ }).first().click(); await p.waitForTimeout(150);
await p.locator('.modal .sec button', { hasText: '生成' }).first().click(); await p.waitForTimeout(200);
expect(/共 \d+ 字/.test(await body()), '覆灭文本草稿能生成');
// 速记语法:插入一个触发器并确认地图里多了它
await p.locator('.modal button', { hasText: /^触发器写作$/ }).first().click(); await p.waitForTimeout(150);
await p.locator('.modal textarea').first().fill('测试速记A: unitDetect @(10,10) 2x2 { unitType=commandCenter, maxUnits=0 }');
const before = await p.evaluate(() => window.rwApi.exportText('full').then((t) => (t.match(/<object /g) || []).length));
await btn('插入速记语法').click(); await p.waitForTimeout(300); await footer('应用'); await p.waitForTimeout(2500);
const after = await p.evaluate(() => window.rwApi.exportText('full').then((t) => ({ n: (t.match(/<object /g) || []).length, has: /测试速记A/.test(t) })));
expect(after.has && after.n === before + 1, '速记语法插入 1 个触发器');
// 撤销
await p.evaluate(async () => { const b = [...document.querySelectorAll('.modal .mfoot button')].filter((e) => e.textContent === '撤销上一次').pop(); b.click(); });
await p.waitForTimeout(2500);
const undone = await p.evaluate(() => window.rwApi.exportText('full').then((t) => !/测试速记A/.test(t)));
expect(undone, '撤销上一次恢复原样');
await footer('关闭');
// 触发器面板:搜索语法 + 属性提示
await p.evaluate(() => { document.querySelector('[data-tab="triggers"], #tab-triggers')?.click(); });
expect(errs.filter((e) => !/favicon|ResizeObserver|404/.test(e)).length === 0, '没有页面错误' + (errs.length ? ':' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
console.log(fail.length ? `\n${fail.length} 项失败` : '\n全部通过'); process.exit(fail.length ? 1 : 0);
