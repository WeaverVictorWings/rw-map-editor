// 补充测试：之前没覆盖到的功能
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const [, , sample, outDir = '.'] = process.argv;
const URL = process.env.URL || 'http://localhost:8765/index.html';
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
await page.goto(URL);
await page.waitForFunction(() => window.__rwReady);
await page.evaluate(() => document.querySelector('.modal .close')?.click());
const text = fs.readFileSync(sample, 'utf8');
await page.evaluate(async (t) => { await window.__rw.loadMapFromText(t, 'sample.tmx'); }, text);

const r = await page.evaluate(async () => {
  const { ed, rend } = window.__rw;
  const out = {};
  const m = ed.map, eng = ed.engine, G = m.ground, W = m.width;
  const names = eng.names;
  // A. 在每种地形的边界附近画一笔，统计笔刷范围外被改动的格子
  const orig = G.data.slice();
  const stats = [];
  const targets = ['Dirt Cliff', 'Shallow Water', 'Sand', 'Grass', 'Lava', 'Tree'];
  for (const tn of targets) {
    const t = names.indexOf(tn);
    // 找一个该地形内部的格子
    let found = -1;
    for (let i = 0; i < G.data.length; i += 37) {
      const l = eng.localOf(G.data[i]);
      if (l >= 0 && eng.tupleOf[l * 4] === t && eng.tupleOf[l * 4 + 3] === t) { found = i; break; }
    }
    if (found < 0) { stats.push({ tn, note: '没找到' }); continue; }
    const x = found % W, y = (found / W) | 0;
    const before = G.data.slice();
    ed.begin('画地形'); ed.size = 5; ed.sym = 'none';
    ed.paintTerrainAt(x + 3, y, names.indexOf('Grass') === t ? names.indexOf('Sand') : names.indexOf('Grass'));
    ed.commit();
    let changed = 0, far = 0, maxd = 0;
    for (let j = 0; j < G.data.length; j++) if (G.data[j] !== before[j]) {
      changed++;
      const d = Math.max(Math.abs((j % W) - (x + 3)), Math.abs(((j / W) | 0) - y));
      if (d > maxd) maxd = d;
      if (d > 8) far++;
    }
    stats.push({ tn, at: [x, y], changed, farOver8: far, maxDist: maxd });
    ed.undo();
  }
  let same = 0; for (let i = 0; i < orig.length; i++) if (orig[i] === G.data[i]) same++;
  out.boundary = stats; out.undoAllRestored = same === orig.length;

  // B. 四向对称椭圆 + 撤销
  ed.sym = 'quad'; ed.begin('画椭圆');
  ed.paintTerrainShape('ellipse', [100, 100], [160, 140], names.indexOf('Lava'));
  ed.commit();
  const tq = (x, y) => G.data[y * W + x];
  out.quadSym = [tq(130, 120), tq(W - 1 - 130, 120), tq(130, m.height - 1 - 120), tq(W - 1 - 130, m.height - 1 - 120)];
  ed.undo(); ed.sym = 'none';

  // C. 出生点对称 + 改队伍 + 撤销对象
  const nTeams0 = ed.usedTeams().size;
  ed.sym = 'lr'; ed.begin('放出生点'); const added = ed.addSpawnAt(50, 50); ed.commit(); ed.sym = 'none';
  const ug = ed.unitsGroup();
  const cc = ug.objects.filter((o) => o.props.some((p) => p.name === 'unit' && p.value === 'commandCenter')).slice(-2);
  out.spawnMirror = cc.map((o) => [+o.attrs.x, +o.attrs.y]);
  out.spawnMirrorExpect = (W * 20 - (+cc[0].attrs.x + 30)) ;
  ed.setTeam(cc[0], 15);
  out.teamChanged = cc[0].props.find((p) => p.name === 'team').value;
  ed.undo(); ed.undo();
  out.teamsAfterUndo = ed.usedTeams().size === nTeams0;

  // D. 预览图
  const { renderPreview } = await import('./js/check.js');
  const pv = renderPreview(ed, rend, 200);
  out.preview = [pv.width, pv.height];

  // E. 调整画布：四周各扩 10 格
  const objs0 = ug.objects[0] ? [+ug.objects[0].attrs.x, +ug.objects[0].attrs.y] : null;
  const g00 = G.data[0];
  m.resize(W + 20, m.height + 20, 10, 10, 0);
  out.resize = { w: m.width, h: m.height, keptCorner: m.ground.data[10 * m.width + 10] === g00, objMoved: ug.objects[0] ? [+ug.objects[0].attrs.x - objs0[0], +ug.objects[0].attrs.y - objs0[1]] : null };
  ed.setMap(m); rend.setMap(m);
  const txt = await m.serialize();
  out.resizeSerializedOK = txt.includes(`width="${m.width}"`);

  // F. 大 gid 写进 Uint16 图层
  out.uint16 = G.data.constructor.name;
  // G. 图块模式：直接放图块后同步角点
  ed.rawGid = eng.ts.firstgid + eng.lut[eng.key(names.indexOf('Snow'), names.indexOf('Snow'), names.indexOf('Snow'), names.indexOf('Snow'))];
  ed.rawLayer = 'Ground'; ed.size = 1;
  ed.begin('放图块'); ed.rawPaintAt(200, 200); ed.commit();
  out.rawCorner = ed.engine.terrainAtVertex(200, 200) === names.indexOf('Snow');
  return out;
});
console.log(JSON.stringify(r, null, 1));

// H. 界面：矩形工具鼠标拖动、规则模式、菜单、预览对话框、调整画布对话框
await page.click('button[data-mode="terrain"]');
await page.click('.tool:has-text("矩形")');
const box = await page.locator('#cv').boundingBox();
const n0 = await page.evaluate(() => window.__rw.ed.undoStack.length);
await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down();
await page.mouse.move(box.x + 360, box.y + 340, { steps: 5 }); await page.mouse.up();
const n1 = await page.evaluate(() => window.__rw.ed.undoStack.length);
console.log('矩形工具产生撤销项', n1 - n0);
await page.click('button[data-mode="triggers"]');
await page.screenshot({ path: outDir + '/x_rules.png' });
await page.click('#menubar button:has-text("地图")'); await page.waitForTimeout(150);
await page.screenshot({ path: outDir + '/x_menu.png' });
await page.click('.menulist button:has-text("调整画布大小")'); await page.waitForTimeout(150);
await page.screenshot({ path: outDir + '/x_resize.png' });
await page.evaluate(() => document.querySelector('.modal .close').click());
await page.click('#menubar button:has-text("文件")'); await page.click('.menulist button:has-text("新建地图")'); await page.waitForTimeout(200);
await page.screenshot({ path: outDir + '/x_newmap.png' });
await page.evaluate(() => document.querySelector('.modal .close').click());
// 撤销 / 重做按钮状态
console.log('errors', errors);
if (errors.length) process.exitCode = 1;
await browser.close();
