// 重新生成 www/sw.js 里的缓存名和资源清单：改过 www 下任何文件后都要运行一次（node scripts/build-sw.mjs）
// 缓存名 = 版本号 + 所有资源内容的哈希，内容变了缓存名就变，旧缓存会在激活时自动清掉。
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const root = new URL('..', import.meta.url).pathname;
const www = path.join(root, 'www');
const ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const skip = new Set(['sw.js', 'capacitor.js', 'cordova.js', 'cordova_plugins.js']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!skip.has(e.name)) files.push(path.relative(www, p).split(path.sep).join('/'));
  }
})(www);
files.sort();
const h = crypto.createHash('sha1');
for (const f of files) { h.update(f); h.update(fs.readFileSync(path.join(www, f))); }
const cache = `rw-map-editor-${ver}-${h.digest('hex').slice(0, 8)}`;
const swp = path.join(www, 'sw.js');
let s = fs.readFileSync(swp, 'utf8');
s = s.replace(/const CACHE = '[^']*';/, `const CACHE = '${cache}';`);
s = s.replace(/const ASSETS = \[[\s\S]*?\n\];/, `const ASSETS = [\n${files.map((f) => `  './${f}'`).join(',\n')}\n];`);
fs.writeFileSync(swp, s);
console.log('sw.js', cache, files.length, 'files');
