#!/usr/bin/env node
// 用法：node scripts/rw-cli.mjs check|export <lite|none|full>|shot  <map.tmx> [输出文件]
// 需要先在 www 目录运行 `python3 -m http.server 8765`，并安装 playwright。服务不可达或地图载入失败时会明确报错并以非零码退出。
import fs from 'node:fs';
const [cmd, kind0, file0, out0] = process.argv.slice(2);
const isExp = cmd === 'export'; const kind = isExp ? kind0 : null; const file = isExp ? file0 : kind0; const out = isExp ? out0 : file0;
const URL = process.env.RW_URL || 'http://localhost:8765/index.html';
const die = (m) => { console.error('错误：' + m); process.exit(2); };
if (!cmd || !file) die('用法：rw-cli.mjs check|export <lite|none|full>|shot <map.tmx> [输出]');
if (!fs.existsSync(file)) die('找不到文件 ' + file);
let chromium; try { ({ chromium } = await import('playwright')); } catch { die('没有安装 playwright'); }
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
try { await pg.goto(URL, { timeout: 8000 }); } catch { await b.close(); die('无法连接 ' + URL + '，请先启动编辑器的本地服务'); }
await pg.waitForFunction(() => window.rwApiReady, null, { timeout: 20000 }).catch(() => die('rwApi 没有就绪（编辑器加载失败）'));
const text = fs.readFileSync(file, 'utf8');
try {
  await pg.evaluate((t) => rwApi.loadText(t), text);
  if (cmd === 'check') { const r = await pg.evaluate(() => rwApi.check()); const l = r.issues || r; console.log(JSON.stringify(l, null, 1)); if (out) fs.writeFileSync(out, JSON.stringify(l, null, 1)); }
  else if (cmd === 'export') { const t = await pg.evaluate((k) => rwApi.exportText(k), kind); fs.writeFileSync(out || file.replace(/\.tmx$/, `-${kind}.tmx`), t); console.log('已写出'); }
  else if (cmd === 'shot') { await pg.screenshot({ path: out || 'shot.png' }); console.log('已截图'); }
  else die('未知命令 ' + cmd);
} catch (e) { console.error('失败：' + e.message); await b.close(); process.exit(1); }
await b.close();
