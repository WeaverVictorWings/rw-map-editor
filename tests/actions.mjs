// 2.4 回归：node tests/actions.mjs <样例地图.tmx>（需要先启动本地服务器：npm run serve）
import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const [, , sample] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1366, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
let cur = '-'; const errs = [];
page.on('pageerror', (e) => errs.push([cur, 'pageerror', e.message.slice(0, 200)]));
page.on('console', (m) => { if (m.type() === 'error' && !/CORS|ERR_FAILED|404/.test(m.text())) errs.push([cur, 'console', m.text().slice(0, 200)]); });
page.on('dialog', (d) => d.dismiss().catch(() => {}));
page.on('filechooser', (f) => f.setFiles([]).catch(() => {}));
await page.goto((process.env.URL || 'http://localhost:8765/index.html')); await page.waitForFunction(() => window.__rwReady);
await page.evaluate(async (t) => { await window.__rw.loadMapFromText(t, 'sample.tmx'); }, fs.readFileSync(sample, 'utf8'));
await page.evaluate(async () => { await window.__rw.createNewMap({ name: 't', w: 120, h: 90, players: 4, start: 'blank', layout: 'ring', base: -1, pools: 2, center: 2 }); });
const ids = await page.evaluate(async () => { const m = await import('./js/actions.js'); return m.ACTIONS.filter((a) => a.id && a.run).map((a) => [a.id, a.label]); });
console.log('actions', ids.length);
const skip = new Set(['new', 'open', 'openfolder', 'reload', 'clear']);
for (const [id, label] of ids) {
  if (skip.has(id)) continue; cur = id + ' ' + label;
  const r = await page.evaluate(async (id) => {
    const m = await import('./js/actions.js'); const a = m.action(id);
    try { if (a.enabled && !a.enabled()) return 'disabled'; const p = a.run(); if (p && p.then) await Promise.race([p, new Promise((r) => setTimeout(r, 1500))]); return 'ok'; } catch (e) { return 'THROW ' + e.message; }
  }, id);
  if (r.startsWith('THROW')) errs.push([cur, 'throw', r]);
  await page.waitForTimeout(120);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  await page.evaluate(() => { document.querySelectorAll('.modal,.overlay,[id^=modal]').forEach((e) => { const b = e.querySelector('.close,[data-close],button.x'); b && b.click(); }); });
  // 回到画图模式、清空模态
  const alive = await page.evaluate(() => !!window.__rw.ed.map);
  if (!alive) errs.push([cur, 'map-lost', '']);
}
console.log(JSON.stringify(errs, null, 1)); console.log('errors', errs.length);
await browser.close();
