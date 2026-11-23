// 3.5 新增界面文字的多语言检查:node tests/v35i18n.mjs <样例地图.tmx>
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const sample = fs.readFileSync(process.argv[2] || '/tmp/crop_euro.tmx', 'utf8');
const fail = []; const expect = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fail.push(m); };
const b = await chromium.launch();
const want = { en: ['Toolbox', /Delivery check/], ja: ['ツールボックス', /納品前チェック/], ru: ['Инструменты', /Проверка перед выпуском/], zht: ['工具箱', /檢視與規則/] };
for (const [lang, [toolboxWord, re]] of Object.entries(want)) {
  const ctx = await b.newContext({ locale: 'en-US', viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('rwNoUpdate', '1'); localStorage.setItem('rwSeen', '3.5.0'); localStorage.setItem('rwLang', l); } catch { /* 忽略 */ } }, lang);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForFunction(() => window.__rwReady);
  await p.evaluate(async (t) => { await window.rwApi.loadText(t, 'sample.tmx'); }, sample);
  await p.evaluate(async () => { (await import('./js/kit35ui.js')).toolbox('deliver'); }); await p.waitForSelector('.modal .mbody'); await p.waitForTimeout(600);
  const txt = await p.locator('.modal').last().innerText();
  expect(txt.includes(toolboxWord) || re.test(txt), `${lang}: 工具箱标题/标签已翻译 (${txt.slice(0, 60).replace(/\n/g, ' ')}…)`);
  expect(!errs.length, `${lang}: 没有页面错误 ${errs[0] || ''}`);
  await ctx.close();
}
await b.close(); console.log(fail.length ? `\n${fail.length} 项失败` : '\n全部通过'); process.exit(fail.length ? 1 : 0);
