// 浏览器自动化测试：node tests/smoke.mjs <样例地图.tmx> <输出目录>
// 需要本地服务：python3 -m http.server 8765 --directory www
import { createRequire } from 'module';
import fs from 'fs';
import zlib from 'zlib';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');

const [, , sample, outDir = '.'] = process.argv;
const URL = process.env.URL || 'http://localhost:8765/index.html';
const log = (...a) => console.log(...a);
const fail = [];
const expect = (cond, msg) => { if (!cond) { fail.push(msg); log('  ✗', msg); } else log('  ✓', msg); };

function layers(xml) {
  const out = {};
  const re = /<layer name="([^"]+)"[^>]*>\s*<data encoding="base64" compression="(zlib|gzip)">\s*([A-Za-z0-9+/=\s]*?)\s*<\/data>/g;
  let m;
  while ((m = re.exec(xml))) {
    const buf = Buffer.from(m[3].replace(/\s+/g, ''), 'base64');
    out[m[1]] = m[2] === 'gzip' ? zlib.gunzipSync(buf) : zlib.inflateSync(buf);
  }
  return out;
}

const browser = await chromium.launch();
const errors = [];
async function newPage(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__rw);
  return page;
}

const text = fs.readFileSync(sample, 'utf8');
const page = await newPage(1280, 800);
// 关掉可能出现的“恢复”弹窗
await page.evaluate(() => document.querySelector('#modal .close')?.click());

log('1. 读入真实地图并原样往返');
let t0 = Date.now();
await page.evaluate(async (t) => { await window.__rw.loadMapFromText(t, 'sample.tmx'); }, text);
log('   载入耗时', Date.now() - t0, 'ms');
const out1 = await page.evaluate(() => window.__rw.serialize());
fs.writeFileSync(outDir + '/roundtrip.tmx', out1);
const A = layers(text), B = layers(out1);
for (const k of Object.keys(A)) expect(B[k] && Buffer.compare(A[k], B[k]) === 0, `图层 ${k} 往返后逐字节一致`);
const cnt = (s, re) => (s.match(re) || []).length;
expect(cnt(text, /<tileset /g) === cnt(out1, /<tileset /g), '图块集数量一致');
expect(cnt(text, /<object /g) === cnt(out1, /<object /g), '对象数量一致');
expect(cnt(text, /embedded_png/g) === cnt(out1, /embedded_png/g), '内嵌图片属性一致');
expect(!/<!--/.test(out1), '输出不含 XML 注释');

log('2. 画地形：草地上画水，检查过渡');
const paint = await page.evaluate(() => {
  const { ed } = window.__rw;
  const eng = ed.engine;
  const water = eng.names.indexOf('Shallow Water');
  const t0 = performance.now();
  ed.begin('画地形');
  ed.size = 9;
  for (let i = 0; i < 40; i++) ed.paintTerrainAt(300 + i, 300 + Math.sin(i / 5) * 6, water);
  ed.commit();
  const ms = performance.now() - t0;
  // 检查受影响区域：每个格子的图块四角与角点一致，且都是图块集里存在的组合
  const W = ed.map.width, W1 = W + 1, V = eng.V, L = eng.layer;
  let mismatch = 0, total = 0, fallback = 0;
  for (let y = 280; y < 330; y++) for (let x = 280; x < 360; x++) {
    const i = y * W + x, l = eng.localOf(L.data[i]);
    if (l < 0) continue;
    total++;
    const a = y * W1 + x;
    const c = [V[a], V[a + 1], V[a + W1], V[a + W1 + 1]];
    const tp = [0, 1, 2, 3].map((k) => eng.tupleOf[l * 4 + k]);
    if (c.some((v, k) => v !== tp[k])) mismatch++;
    if (eng.lut[eng.key(c[0], c[1], c[2], c[3])] < 0) fallback++;
  }
  return { ms: Math.round(ms), mismatch, total, fallback, undo: ed.undoStack.length };
});
log('  ', JSON.stringify(paint));
expect(paint.mismatch === 0, '画过的区域图块与角点地形完全一致');
expect(paint.fallback === 0, '没有用到“近似图块”');
await page.evaluate(() => window.__rw.rend.centerOn(320, 300, 0.6));
await page.waitForTimeout(400);
await page.screenshot({ path: outDir + '/desktop_paint.png' });

log('3. 撤销 / 重做');
const ur = await page.evaluate(() => {
  const { ed } = window.__rw;
  const L = ed.engine.layer, before = L.data.slice();
  ed.undo();
  const after = L.data;
  const orig = layersSnapshot();
  function layersSnapshot() { return after.slice(); }
  ed.redo();
  let same = 0; for (let i = 0; i < before.length; i++) if (before[i] === L.data[i]) same++;
  return { same, n: before.length, undoRestored: orig.length };
});
expect(ur.same === ur.n, '重做后与撤销前完全一致');
// 撤销后应和原图一致
const ur2 = await page.evaluate(() => { window.__rw.ed.undo(); return window.__rw.serialize(); });
const C = layers(ur2);
expect(Buffer.compare(A.Ground, C.Ground) === 0, '撤销后地面与原图逐字节一致');
await page.evaluate(() => window.__rw.ed.redo());

log('4. 真实鼠标操作：画笔拖动、放资源池、放出生点');
const box = await page.locator('#cv').boundingBox();
await page.mouse.move(box.x + 300, box.y + 300);
await page.mouse.down();
for (let i = 0; i < 12; i++) await page.mouse.move(box.x + 300 + i * 15, box.y + 300 + i * 4);
await page.mouse.up();
await page.click('button[data-mode="items"]');
await page.mouse.click(box.x + 500, box.y + 450);
await page.click('button[data-mode="units"]');
const before = await page.evaluate(() => window.__rw.ed.usedTeams().size);
await page.mouse.click(box.x + 600, box.y + 500);
const afterT = await page.evaluate(() => window.__rw.ed.usedTeams().size);
expect(afterT === before + 1, `点击放出生点后队伍数 ${before} → ${afterT}`);
const labels = await page.evaluate(() => window.__rw.ed.undoStack.map((o) => o.label));
log('   撤销栈：', labels.join(' / '));
expect(labels.includes('放物品') && labels.includes('放出生点'), '物品和出生点操作都进了撤销栈');
await page.screenshot({ path: outDir + '/desktop_units.png' });

log('5. 检查');
const checks = await page.evaluate(() => window.__rw.runChecks().map((c) => c.level + ' | ' + c.title));
for (const c of checks) log('   ', c);
await page.click('#btnCheck');
await page.waitForTimeout(300);
await page.screenshot({ path: outDir + '/desktop_check.png' });
await page.evaluate(() => document.querySelector('#modal .close').click());

log('6. 新建地图（160×160，4 人）');
const nm = await page.evaluate(async () => {
  const m = await window.__rw.newMap({ name: '测试', w: 160, h: 160, players: 4, layout: 'ring', base: window.__rw.ed.engine.names.indexOf('Grass'), pools: 2, center: 2 });
  const c = window.__rw.runChecks().filter((x) => x.level === 'error').map((x) => x.title);
  const text = await window.__rw.serialize();
  return { w: m.width, teams: window.__rw.ed.usedTeams().size, pools: window.__rw.ed.poolTiles().length, errors: c, len: text.length, rep: window.__rw.poolReport() };
});
log('  ', JSON.stringify(nm));
expect(nm.teams === 4, '生成了 4 个出生点');
expect(nm.pools === 4 * 2 + 2, '生成了 10 个资源池');
expect(nm.errors.length === 0, '新地图没有错误级问题');
const nd = nm.rep.map((r) => r.nearest);
expect(Math.max(...nd) - Math.min(...nd) <= 1, '各队到最近资源池的距离相差不超过 1 格：' + nd.join(','));
await page.waitForTimeout(400);
await page.screenshot({ path: outDir + '/desktop_newmap.png' });
const newText = await page.evaluate(() => window.__rw.serialize());
fs.writeFileSync(outDir + '/new_160.tmx', newText);

log('7. 大图压力测试 5000×5000');
const big = await page.evaluate(async () => {
  const t0 = performance.now();
  await window.__rw.newMap({ name: '大图', w: 5000, h: 5000, players: 8, layout: 'ring', base: window.__rw.ed.engine.names.indexOf('Grass'), pools: 2, center: 4 });
  const tGen = performance.now() - t0;
  const { ed, rend } = window.__rw;
  const water = ed.engine.names.indexOf('Shallow Water');
  let t1 = performance.now();
  ed.begin('画地形'); ed.size = 40;
  for (let i = 0; i < 60; i++) ed.paintTerrainAt(1000 + i * 20, 2500 + Math.sin(i / 6) * 200, water);
  ed.commit();
  const tPaint = performance.now() - t1;
  t1 = performance.now();
  ed.begin('画矩形');
  ed.paintTerrainShape('rect', [2000, 2000], [3000, 3000], water);
  ed.commit();
  const tRect = performance.now() - t1;
  t1 = performance.now();
  const text = await window.__rw.serialize();
  const tSer = performance.now() - t1;
  rend.fit();
  await new Promise((r) => setTimeout(r, 300));
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null;
  return { tGen: Math.round(tGen), tPaint: Math.round(tPaint), tRect: Math.round(tRect), tSer: Math.round(tSer), mb: (text.length / 1e6).toFixed(1), heapMB: mem };
});
log('  ', JSON.stringify(big));
await page.screenshot({ path: outDir + '/desktop_5000.png' });

log('8. 手机竖屏界面');
const ph = await newPage(390, 844, true);
await ph.evaluate(() => document.querySelector('#modal .close')?.click());
await ph.screenshot({ path: outDir + '/phone_welcome.png' });
await ph.evaluate(async (t) => { await window.__rw.loadMapFromText(t, 'sample.tmx'); }, text);
await ph.waitForTimeout(800);
await ph.screenshot({ path: outDir + '/phone_terrain.png' });
await ph.click('button[data-mode="units"]');
await ph.waitForTimeout(200);
await ph.screenshot({ path: outDir + '/phone_units.png' });
// 触屏单指画一笔
const pbox = await ph.locator('#cv').boundingBox();
const cdp = await ph.context().newCDPSession(ph);
await ph.click('button[data-mode="terrain"]');
const n0 = await ph.evaluate(() => window.__rw.ed.undoStack.length);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pbox.x + 150, y: pbox.y + 200 }] });
for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pbox.x + 150 + i * 10, y: pbox.y + 200 + i * 5 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await ph.waitForTimeout(200);
const n1 = await ph.evaluate(() => window.__rw.ed.undoStack.length);
expect(n1 === n0 + 1, '单指拖动画了一笔');
// 双指捏合缩放
const z0 = await ph.evaluate(() => window.__rw.rend.view.z);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pbox.x + 150, y: pbox.y + 300, id: 1 }, { x: pbox.x + 250, y: pbox.y + 300, id: 2 }] });
for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pbox.x + 150 - i * 10, y: pbox.y + 300, id: 1 }, { x: pbox.x + 250 + i * 10, y: pbox.y + 300, id: 2 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await ph.waitForTimeout(200);
const z1 = await ph.evaluate(() => window.__rw.rend.view.z);
const n2 = await ph.evaluate(() => window.__rw.ed.undoStack.length);
expect(z1 > z0 * 1.5, `双指张开放大 ${z0.toFixed(3)} → ${z1.toFixed(3)}`);
expect(n2 === n1, '双指缩放没有误画');
await ph.screenshot({ path: outDir + '/phone_after_touch.png' });

log('\n页面错误：', errors.length ? errors : '无');
log(fail.length ? `\n失败 ${fail.length} 项` : '\n全部通过');
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
