// 2.4.1：兼容“被别的工具存过的地图”：node tests/v24b.mjs <样例地图.tmx>
// ① export_ground 的地形定义被丢掉的地图 → 用本机保存的图块素材补全；② 游戏自带、没有图片的地块集 → 同色色块；③ 误报检查
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const fail = []; const expect = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fail.push(m); };
const sample = fs.readFileSync(process.argv[2], 'utf8');
// 造一张“只剩图片和属性、没有地形定义”的 export_ground
let stripped = sample.replace(/(<tileset firstgid="1" name="export_ground"[\s\S]*?)(<\/tileset>)/, (m0, a, b) => a.replace(/<terraintypes>[\s\S]*?<\/terraintypes>/, '').replace(/ terrain="[^"]*"/g, '') + b);
expect(stripped !== sample && !/export_ground[\s\S]{0,400000}?<terraintypes>/.test(stripped.slice(0, stripped.indexOf('name="export_items"'))), '造出了没有地形定义的地图');
// 再造一个游戏自带的、没有图片的地块集 + 只发通告的刷兵 / 地图文字触发器
const extra = '<tileset firstgid="9000" name="Long Grass" tilewidth="20" tileheight="20" tilecount="50" columns="5"><image source="terrain/bitmaps/longgrass.png" width="100" height="200"/></tileset>';
stripped = stripped.replace(/<layer /, extra + '<layer ');
const trig = '<object id="9001" name="通告" type="unitAdd" x="100" y="100" width="40" height="40"><properties><property name="globalMessage" value="hi"/><property name="team" value="-1"/></properties></object><object id="9002" name="字幕" type="mapText" x="200" y="100" width="20" height="20"><properties><property name="globalMessage" value="hello"/><property name="deactivatedBy" value="不存在的触发器"/></properties></object>';
stripped = stripped.replace(/(<objectgroup[^>]*name="Triggers"[^>]*>)/, '$1' + trig);
const browser = await chromium.launch();
const page = await (await browser.newContext({ locale: 'zh-CN', viewport: { width: 1100, height: 760 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('rwNoUpdate', '1'); } catch {} });
await page.goto(process.env.URL || 'http://localhost:8765/index.html'); await page.waitForFunction(() => window.__rwReady);
await page.evaluate(async (t) => { await window.__rw.loadMapFromText(t, 'sample.tmx'); }, sample);   // 先存下完整素材
let r = await page.evaluate(async (t) => {
  await window.__rw.loadMapFromText(t, 'stripped.tmx'); const { ed } = window.__rw;
  const ck = window.__rw.runChecks();
  const s = await window.__rw.serialize();
  const gts = ed.groundTs;
  return { engine: !!ed.engine, names: ed.engine ? ed.engine.names.length : 0, items: ed.items.length, builtin: ed.map.tilesets.filter((x) => x.builtin).length,
    checks: ck.map((c) => c.level + ':' + c.title), terrInSaved: /<terraintypes>/.test(s.slice(s.indexOf('name="export_ground"'), s.indexOf('name="export_items"'))) };
}, stripped);
console.log(JSON.stringify(r).slice(0, 700));
expect(r.engine && r.names > 5, '地形定义被补全，地形画笔可用');
expect(r.terrInSaved, '保存时把补全的地形定义写进地图');
expect(r.items > 0, '物品列表可用');
expect(r.builtin >= 1 && r.checks.some((c) => /游戏自带/.test(c)), '游戏自带的地块集只提示、不报警告');
expect(!r.checks.some((c) => /缺少“生成哪些单位”|缺少“文字”/.test(c)), '只发通告的刷兵 / 地图文字不报缺少');
expect(!r.checks.some((c) => /^error:.*不存在的「/.test(c)), '引用不存在的触发器名不再算错误');
// 色块：没有图片的地块集在画面和图块面板里不是紫色
const px = await page.evaluate(async () => { const T = await import('./js/tmx.js'); return [T.placeholderRGB('Long Grass', 0), T.placeholderRGB('Shallow Water', 0), T.placeholderRGB('自定义地块', 0)]; });
expect(px.every((c) => c.every((v) => v >= 0 && v <= 255)) && px[0][1] > px[0][0], '同色色块：草地偏绿');
expect(errs.length === 0, '没有页面错误 ' + errs.join('|').slice(0, 200));
await browser.close();
console.log(fail.length ? '失败 ' + fail.length + ' 项' : '全部通过'); process.exit(fail.length ? 1 : 0);
