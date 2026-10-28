// 2.4 回归：node tests/v24.mjs <样例地图.tmx>（需要先启动本地服务器：npm run serve）
import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const browser = await chromium.launch();
const page = await (await browser.newContext({ locale: 'zh-CN', viewport: { width: 1200, height: 800 }, acceptDownloads: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/CORS|ERR_FAILED|404/.test(m.text())) errs.push('c:' + m.text()); });
await page.goto((process.env.URL || 'http://localhost:8765/index.html')); await page.waitForFunction(() => window.__rwReady);
await page.evaluate(async (t) => { await window.__rw.loadMapFromText(t, 's.tmx'); }, fs.readFileSync(process.argv[2], 'utf8'));
const R = (fn, a) => page.evaluate(fn, a);
const ok = (c, m) => console.log(c ? '  ✓' : '  ✗ FAIL', m);
await R(async () => { await window.__rw.createNewMap({ name: 't', w: 140, h: 100, players: 4, start: 'blank', layout: 'ring', base: -1, pools: 0, center: 0 }); });
// 1. 紧挨着的资源池
let r = await R(async () => {
  const PT = await import('./js/paint.js'); const { ed, runChecks, A } = window.__rw;
  const it = ed.items.find((i) => i.pool); const W = ed.map.width;
  ed.begin('p'); const tiles = []; for (let x = 60; x < 65; x++) tiles.push(40 * W + x);
  const n = PT.placeItems(tiles, it, {}); ed.commit();
  const n2 = (() => { ed.begin('p2'); ed.placeItemAt(60, 41, it.key); ed.placeItemAt(61, 41, it.key); ed.commit(); return ed.poolTiles().length; })();
  return { n, total: n2, spacingDefault: A.itemSpacing ?? 0, warn: runChecks().filter((c) => /紧贴|挨得太近|间距/.test(c.title)).map((c) => c.title) };
});
console.log('1', JSON.stringify(r)); ok(r.n === 5 && r.total === 7 && !r.warn.length, '资源池可以紧挨着放（5 个一排 + 2 个相邻，无间距警告）');
// 2. 一键平衡
r = await R(async () => {
  const B = await import('./js/balance.js'); const { ed, balanceReport } = window.__rw;
  const before = JSON.stringify([...ed.map.items.data]);
  const sp = ed.spawns().filter((s) => s.team >= 0); const it = ed.items.find((i) => i.pool);
  // 给 0 队身边塞 4 个池，别的队没有
  ed.begin('u'); const s0 = sp.find((s) => s.team === 0); const tx = Math.floor(s0.cx / 20), ty = Math.floor(s0.cy / 20);
  for (const [dx, dy] of [[5, 0], [5, 3], [-5, 3], [0, 6]]) ed.placeItemAt(tx + dx, ty + dy, it.key); ed.commit();
  const rep0 = balanceReport(ed, 30); const plan = B.planBalance(ed, {});
  const undoDepth = ed.undoStack ? ed.undoStack.length : -1;
  const n = B.applyBalance(ed, plan); const rep1 = balanceReport(ed, 30);
  const after = JSON.stringify([...ed.map.items.data]); ed.undo(); const undone = JSON.stringify([...ed.map.items.data]);
  return { fair0: rep0.fair, fair1: rep1.fair, n, moves: plan.moves.length, adds: plan.adds.length, notes: plan.notes.slice(0, 3), spread0: rep0.nearSpread, spread1: rep1.nearSpread, changed: after !== undone, restoredToBefore: undone !== after, pools1: ed.poolTiles().length };
});
console.log('2', JSON.stringify(r)); ok(r.n > 0 && r.changed, '一键平衡有改动且可撤销'); ok(r.fair1 || r.spread1 < r.spread0, '平衡后更公平');
// 3. 工程文件往返
r = await R(async () => {
  const P = await import('./js/project.js'); const { serialize } = window.__rw;
  const s0 = await serialize(); const res = await P.saveProject({ download: false, silent: true });
  return { type: typeof res, keys: res && typeof res === 'object' ? Object.keys(res).slice(0, 6) : null, len: s0.length };
});
console.log('3', JSON.stringify(r));
// 4. 所有触发器模板
r = await R(async () => {
  const T = await import('./js/templates.js'); const { ed, runChecks, triggerIssues, serialize } = window.__rw; const out = [];
  for (const t of T.TEMPLATES) {
    try { const n = T.insertTemplate(t.id, {}, { tx: 30 + (out.length % 8) * 8, ty: 30 + Math.floor(out.length / 8) * 8 }); out.push([t.id, n.length]); } catch (e) { out.push([t.id, 'ERR ' + e.message]); }
  }
  let ti; try { ti = triggerIssues(); } catch (e) { ti = 'ERR ' + e.message; }
  const s = await serialize(); await window.__rw.loadMapFromText(s, 'tt.tmx'); const s2 = await serialize();
  return { out, ti: Array.isArray(ti) ? ti.map((x) => (x.level || '') + ':' + (x.title || x.msg || JSON.stringify(x)).slice(0, 80)) : ti, roundtrip: s === s2 };
});
console.log('4', JSON.stringify(r.out)); console.log('  issues', JSON.stringify(r.ti).slice(0, 900)); ok(r.roundtrip && r.out.every((x) => typeof x[1] === 'number' && x[1] > 0), '所有模板可加入、可存可读、往返一致');
// 5. 模拟器
r = await R(async () => { const S = await import('./js/sim.js'); const { ed } = window.__rw; const t = performance.now(); const x = S.simulateTriggers(ed, { duration: 300, step: 1 }); return { keys: Object.keys(x), ms: Math.round(performance.now() - t) }; });
console.log('5', JSON.stringify(r));
console.log('errors:', JSON.stringify(errs.slice(0, 5)));
await browser.close();
