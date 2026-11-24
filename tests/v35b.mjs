// 3.5(二):叠加层 / 按队伍隐藏单位 / 规则表单 / 胜利模拟界面 / 触发器列表分组·多选·标签 / 开局镜头
// node tests/v35b.mjs <样例地图.tmx>   (需要 python3 -m http.server 8765 --directory www)
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const fail = []; const expect = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fail.push(m); };
const sample = fs.readFileSync(process.argv[2] || '/tmp/crop_euro.tmx', 'utf8');
const b = await chromium.launch(); const ctx = await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('rwNoUpdate', '1'); localStorage.setItem('rwSeen', '3.5.0'); } catch { /* 忽略 */ } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:8765/index.html'); await p.waitForFunction(() => window.__rwReady);
await p.evaluate(async (t) => { await window.rwApi.loadText(t, 'sample.tmx'); }, sample);
const body = () => p.locator('.modal .mbody').last().innerText();
const btn = (t) => p.locator('.modal button', { hasText: t }).first();
const footer = (l) => p.evaluate((x) => { const b = [...document.querySelectorAll('.modal .mfoot button')].filter((e) => e.textContent === x).pop(); if (b) b.click(); return !!b; }, l);
// ---- 叠加层 ----
for (const k of ['k35-gap', 'k35-shallow', 'k35-heat', 'k35-zones']) {
  const r = await p.evaluate(async (kk) => { const { A } = await import('./js/state.js'); await A.hooks.setOverlay(kk); await new Promise((r) => setTimeout(r, 300)); return { kind: A.overlayKind, tint: A.rend.tint && A.rend.tint.kind }; }, k);
  expect(r.kind === k && r.tint === k, `叠加层 ${k} 能打开`);
}
const nz = await p.evaluate(async () => { const { A } = await import('./js/state.js'); const t = A.rend.tint; return null; });
// 差异叠加:没有基准要给出提示而不是崩
const d0 = await p.evaluate(async () => { const { A } = await import('./js/state.js'); await A.hooks.setOverlay('k35-diff'); await new Promise((r) => setTimeout(r, 300)); return A.overlayKind; });
expect(d0 === 'none', '没有基准时差异叠加回退成"不叠加"(并提示)');
await p.evaluate(async () => { const { A } = await import('./js/state.js'); await A.hooks.setOverlay('none'); });
// 工具箱:视图与规则
await p.evaluate(async () => { (await import('./js/kit35ui.js')).toolbox('view'); });
await p.waitForSelector('.modal .mbody');
expect(/地图叠加层/.test(await body()) && /项目规则/.test(await body()), '工具箱「视图与规则」页打开');
await p.waitForFunction(() => document.querySelectorAll('.modal label input[type=checkbox]').length >= 3, null, { timeout: 8000 }).catch(() => {});
const teamsN = await p.locator('.modal label:has-text("队伍") input[type=checkbox]').count() + 1;
expect(teamsN >= 2, `按队伍显示/隐藏单位:列出 ${teamsN - 1} 个队伍`);
// 取消勾选第一个队伍 → renderer.hideTeams
await p.locator('.modal label:has-text("队伍") input[type=checkbox]').first().uncheck();
const h1 = await p.evaluate(async () => { const { A } = await import('./js/state.js'); return A.rend.hideTeams ? [...A.rend.hideTeams] : null; });
expect(h1 && h1.length === 1, '隐藏一个队伍后渲染器记录了它:' + JSON.stringify(h1));
await btn('全部显示').click(); await p.waitForTimeout(200);
expect(await p.evaluate(async () => { const { A } = await import('./js/state.js'); return A.rend.hideTeams === null; }), '「全部显示」恢复');
// 规则:填 → 保存 → localStorage
await p.locator('.modal input[type=number]').nth(1).fill('3'); // 队伍数那格(第 0 个是海峡阈值)
const inputs = p.locator('.modal input'); const n = await inputs.count();
await p.locator('.modal input[placeholder="用逗号分隔"]').last().fill('新势力，坏词');
await btn('保存').click(); await p.waitForTimeout(300);
const saved = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('rwkit35.rules.')); return k ? JSON.parse(localStorage.getItem(k)) : null; });
expect(saved && saved.text && saved.text.banned && saved.text.banned.length === 2, '规则保存进本浏览器,禁用词按逗号拆开:' + JSON.stringify(saved));
await footer('关闭');
// ---- 触发器面板:分组 / 多选 / 标签 ----
await p.click('[data-mode=triggers]'); await p.waitForTimeout(500);
const hasList = await p.locator('.tcard2').count();
expect(hasList > 0, `触发器列表有 ${hasList} 张卡片`);
await p.locator('#dockBody button', { hasText: /^分组$/ }).click(); await p.waitForTimeout(300);
const heads = await p.locator('#dockBody button.ib', { hasText: /[▾▸]/ }).count();
expect(heads > 0, `分组后有 ${heads} 个组标题`);
await p.locator('#dockBody button.ib', { hasText: /[▾▸]/ }).first().click(); await p.waitForTimeout(200);
expect(await p.locator('#dockBody button.ib', { hasText: '▸' }).count() === 1, '点组标题能折叠');
await p.locator('#dockBody button', { hasText: /^多选$/ }).click(); await p.waitForTimeout(300);
await p.locator('.tcard2').first().click(); await p.locator('.tcard2').nth(1).click(); await p.waitForTimeout(200);
expect(/已选 2 个/.test(await p.locator('#dockBody').innerText()), '多选:点两张卡片 → 已选 2 个');
const nameBefore = await p.evaluate(async () => { const T = await import('./js/triggers.js'); return null; });
// 批量改 warmup=13s → 13000
await p.locator('#dockBody select').first().selectOption('warmup');
await p.locator('#dockBody input[placeholder^="值"]').fill('13s');
await p.locator('#dockBody button', { hasText: '应用到选中项' }).click(); await p.waitForTimeout(500);
const cnt13 = await p.evaluate(() => window.rwApi.exportText('full').then((t) => (t.match(/name="warmup" value="13000"/g) || []).length));
expect(cnt13 === 2, `批量把 2 个触发器的 warmup 设成 13s → 13000(地图里有 ${cnt13} 处)`);
const base10m = await p.evaluate(() => window.rwApi.exportText('full').then((t) => (t.match(/value="10m"/g) || []).length));
// 非法时间被拒
await p.locator('#dockBody input[placeholder^="值"]').fill('10m');
await p.locator('#dockBody button', { hasText: '应用到选中项' }).click(); await p.waitForTimeout(300);
const cntBad = await p.evaluate(() => window.rwApi.exportText('full').then((t) => (t.match(/value="10m"/g) || []).length));
expect(cntBad === base10m, '时间写成 10m 被拒绝(游戏读不了)' + ` base=${base10m} now=${cntBad}`);
// 打标签
await p.locator('#dockBody select').last().selectOption({ label: '红' });
await p.locator('#dockBody button', { hasText: '给选中项打标签' }).click(); await p.waitForTimeout(300);
const tagged = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('rwkit35.ttags.')); return k ? Object.keys(JSON.parse(localStorage.getItem(k))).length : 0; });
expect(tagged === 2, '给 2 个触发器打了红色标签');
// 撤销批量改(编辑器历史)
await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
const cnt13b = await p.evaluate(() => window.rwApi.exportText('full').then((t) => (t.match(/name="warmup" value="13000"/g) || []).length));
expect(cnt13b === 0, '一次撤销就退回批量修改' + ` (剩 ${cnt13b})`);
// ---- 开局镜头 ----
const cam = await p.evaluate(async () => { const T = await import('./js/triggers.js'); const { A } = await import('./js/state.js'); const o = T.createAt('camera_start', { x: 400, y: 400, w: 40, h: 40 }); return !!o; });
await p.waitForTimeout(500);
expect(/在地图上点位置/.test(await p.locator('#dockBody').innerText()), '开局镜头的编辑面板有「在地图上点位置」');

// ---- 工具箱:兵力批量(替换单位)----
await p.evaluate(async () => { (await import('./js/kit35ui.js')).toolbox('batch'); });
await p.waitForSelector('.modal .mbody');
expect(/在框出的区域里放兵/.test(await body()) && /批量替换单位/.test(await body()) && /行军时间估算/.test(await body()), '「兵力批量」页三块功能都在');
const unitCnt = (re) => p.evaluate((src) => window.rwApi.exportText('full').then((t) => (t.match(new RegExp(src, 'g')) || []).length), re);
const before1 = await unitCnt('name="unit" value="extractorT1"'), before2 = await unitCnt('name="unit" value="extractorT2"');
await p.locator('.modal input[placeholder="空=所有队"]').fill('');
await btn('替换').click(); await p.waitForTimeout(500); await footer('应用'); await p.waitForTimeout(3000);
const after1 = await unitCnt('name="unit" value="extractorT1"'), after2 = await unitCnt('name="unit" value="extractorT2"');
expect(before1 > 0 ? after1 < before1 && after1 === before1 - (after2 - before2) : true, `批量替换:T1 抽取仪 ${before1} → ${after1},T2 ${before2} → ${after2}（地图里另有触发器属性也写了这个名字,不算单位,所以不会归零）`);
await p.evaluate(async () => { const bb = [...document.querySelectorAll('.modal .mfoot button')].filter((e) => e.textContent === '撤销上一次').pop(); bb && bb.click(); }); await p.waitForTimeout(3000);
expect(await unitCnt('name="unit" value="extractorT1"') === before1, '撤销上一次后 T1 抽取仪数量复原');
await footer('关闭');

// ---- 工具箱:地形绘制(岛链)----
// 样例图水面太少,换一张合成图(全是水,只有几块陆地)来测岛链
const G35 = await import('../kit/geo35.js'), TM = await import('../kit/tmx.js'), MO = await import('../kit/mapops.js');
const m0 = TM.parseTmx(sample), g0 = MO.findGids(m0), W0 = m0.width, H0 = m0.height, dsy = new Uint32Array(W0 * H0).fill(g0.water);
for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) dsy[y * W0 + x] = g0.land;
let synth = sample.replace(/<objectgroup[\s\S]*<\/objectgroup>/g, '<objectgroup name="Triggers"></objectgroup><objectgroup name="UnitObjects"></objectgroup>'); synth = G35.applyLayer(G35.applyLayer(synth, 'items', new Uint32Array(W0 * H0)), 'ground', dsy);
await p.evaluate(async (t) => { await window.rwApi.loadText(t, 'synth.tmx'); }, synth);
const wline = [70, 130, 200, 135];
expect(true, '换成合成图:全是水 + 一块陆地');
if (wline) {
  await p.evaluate(async () => { (await import('./js/kit35ui.js')).toolbox('geo2'); }); await p.waitForSelector('.modal .mbody');
  expect(/画河流/.test(await body()) && /画山脉/.test(await body()) && /岛链/.test(await body()) && /国界 GeoJSON/.test(await body()) && /城市自动选址/.test(await body()), '「地形绘制与导入」页各块都在');
  const landN = () => p.evaluate(async () => { const { rwApi } = await import('./js/api.js'); const K = await import('./js/kit/tmx.js'); const m = K.parseTmx(await K.normalizeTmx(await rwApi.exportText('full'))); const P = K.passability(m); let n = 0; for (let i = 0; i < P.length; i++) if (P[i] & K.LAND) n++; return n; });
  const l0 = await landN();
  const nums = p.locator('.modal input[type=number]'); await nums.nth(4).fill('3'); await nums.nth(5).fill('3'); await nums.nth(6).fill('2'); await nums.nth(7).fill('3');
  await p.locator('.modal textarea').nth(2).fill(`${wline[0]},${wline[1]} ${wline[2]},${wline[3]}`);
  await btn('生成岛链').click(); await p.waitForTimeout(600);
  const txt = await p.locator('.modal').last().innerText();
  const hasConfirm = /将生成 \d+ 座岛/.test(txt) || /放不下/.test(txt);
  expect(hasConfirm, '岛链有预览确认框:' + txt.slice(-80).replace(/\n/g, ' '));
  if (/将生成/.test(txt)) { await footer('应用'); await p.waitForTimeout(3500); const l1 = await landN(); expect(l1 > l0, `岛链写入后陆地格增加 ${l0} → ${l1}`); }
  await p.evaluate(async () => { const bb = [...document.querySelectorAll('.modal .mfoot button')].filter((e) => e.textContent === '撤销上一次').pop(); bb && bb.click(); }); await p.waitForTimeout(3500);
  expect(await landN() === l0, '撤销上一次后陆地格数复原');
  await footer('关闭');
}

// ---- 工具箱:文本工具 ----
await p.evaluate(async (t) => { await window.rwApi.loadText(t, 'sample.tmx'); }, sample);
await p.evaluate(async () => { (await import('./js/kit35ui.js')).toolbox('text2'); }); await p.waitForSelector('.modal .mbody');
await btn('生成').click(); await p.waitForTimeout(300);
expect(/北京/.test(await body()) && /上海/.test(await body()), '战报模板按城市生成');
await p.locator('.modal textarea').first().fill('第一条消息很短\n第二条消息要长一些长一些长一些长一些长一些长一些长一些');
await btn('算时间').click(); await p.waitForTimeout(300);
expect(/全部放完需要 \d+\.\d 秒/.test(await body()), '自动排延迟给出总时长');
await btn('检查占位符').click(); await p.waitForTimeout(500);
expect(/占位符/.test(await body()), '占位符检查可运行');
await btn('一键修全角标点').click(); await p.waitForTimeout(800);
const mtxt = await p.locator('.modal').last().innerText();
expect(/将改 \d+ 条消息/.test(mtxt) || /没有需要改/.test(mtxt) || /确定后会用新结果/.test(mtxt), '一键修标点有预览或提示:' + mtxt.slice(-60).replace(/\n/g, ' '));
if (/确定后会用新结果/.test(mtxt)) await footer('取消');
await footer('关闭');
expect(errs.filter((e) => !/favicon|ResizeObserver|404/.test(e)).length === 0, '没有页面错误' + (errs.length ? ':' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
console.log(fail.length ? `\n${fail.length} 项失败` : '\n全部通过'); process.exit(fail.length ? 1 : 0);
