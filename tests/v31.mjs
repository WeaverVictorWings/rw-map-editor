// 3.1：源码编辑器（诊断、补全、整理）与新工具：node tests/v31.mjs  （需要 python3 -m http.server 8765 --directory www）
import { createRequire } from 'module';
import { writeZip } from '../www/js/zip.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const fail = []; const expect = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fail.push(m); };
const U = '[core]\nname: tank\nprice: 200\nmaxHp: 300\ndisplayText: 坦克\n\n[movement]\nmovementType: LAND\nmoveSpeed: 1\n';
const zip = Array.from(writeZip([{ name: 'mod-info.txt', data: '[mod]\ntitle: T\n' }, { name: 'tank.ini', data: U }]));
const b = await chromium.launch(); const ctx = await b.newContext({ locale: 'zh-CN', viewport: { width: 1000, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('rwNoUpdate', '1'); localStorage.setItem('rwSeen', '3.2.0'); } catch { /* 忽略 */ } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:8765/index.html'); await p.waitForFunction(() => window.__rwReady);
p.evaluate(async (z) => { const m = await import('./js/modedit.js'); m.modEditorDialog({ load: { name: 't.rwmod', bytes: new Uint8Array(z) } }); }, zip);
await p.waitForSelector('.me-row', { timeout: 5000 });
await p.click('text=源码'); await p.waitForSelector('textarea.me-src');
expect(await p.locator('.me-diag').innerText().then((t) => /没发现/.test(t)), '正常源码：没有诊断');
const ta = p.locator('textarea.me-src');
await ta.click(); await p.keyboard.press('Control+End'); await p.keyboard.type('\n[attack]\nmaxAttackRange: abc\nisMelee: tru');
await p.waitForTimeout(500);
const dg = await p.locator('.me-diag').innerText();
expect(/第 \d+ 行：.*数字/.test(dg), '输入错误值后出现诊断：' + dg.split('\n')[1]);
expect(await p.locator('.me-s').count() >= 1 && /true/.test(await p.locator('.me-sug').innerText()), '布尔值补全出现 true');
await p.locator('.me-s').first().click();
expect((await ta.inputValue()).endsWith('isMelee: true'), '点补全后写进文本');
await p.keyboard.type('\n[turret_a]\nproj'); await p.waitForTimeout(100);
expect(/projectile/.test(await p.locator('.me-sug').innerText()), '键名补全 projectile');
await p.click('text=整理格式'); await p.waitForTimeout(100);
expect((await ta.inputValue()).includes('[attack]\nmaxAttackRange: abc'), '整理格式不丢内容');
await p.locator('.modedit button', { hasText: '回到表单' }).click(); await p.waitForTimeout(200);
expect(await p.evaluate(async () => { const m = await import('./js/modedit.js'); const f = m.currentMod().collect().find((x) => x.name === 'tank.ini'); return new TextDecoder().decode(f.data).includes('isMelee: true'); }), '回到表单后改动已写入打包结果');
for (const t of ['翻译表（CSV）', '单位图鉴', '体检报告', '整理全部格式']) {
  const ok = await p.evaluate(async (name) => { const m = await import('./js/modtools2.js'); return m.TOOLS2.some((x) => x[0] === name); }, t);
  expect(ok, '工具已注册：' + t);
}
expect(errs.length === 0, '没有页面错误 ' + errs.join('|'));
await b.close(); process.exit(fail.length ? 1 : 0);
