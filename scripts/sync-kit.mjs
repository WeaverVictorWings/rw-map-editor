// 把 kit/*.js 复制到 www/js/kit/(浏览器版共用同一份代码);改过 kit 后运行,然后 node scripts/build-sw.mjs
import fs from 'node:fs'; import path from 'node:path';
const src = 'kit', dst = 'www/js/kit'; fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) if (f.endsWith('.js')) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('已同步', fs.readdirSync(dst).length, '个文件到', dst);
