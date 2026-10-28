import fs from 'fs';
// 用法：node scripts/i18n/build.mjs en；其他语言 node scripts/i18n/build.mjs ja 20（20 = 只要求 20 字以内的句子都有译文，长句回落英文）。繁体中文由 OpenCC 词典从简体自动转换。
const D = new URL('.', import.meta.url).pathname;
const lines = fs.readFileSync(D + 'strings.txt','utf8').split('\n').filter(l => l.trim());
const byId = new Map(lines.map(l => { const [id,, js] = l.split('\t'); return [id, JSON.parse(js)]; }));
const lang = process.argv[2], maxLen = +process.argv[3] || 1e9;
const out = {}; const seen = new Set();
for (const f of fs.readdirSync(D).filter(f => f.startsWith(lang) && f.endsWith('.tsv')).sort()) {
  for (const l of fs.readFileSync(D + f,'utf8').split('\n')) {
    if (!l.trim()) continue;
    const i = l.indexOf('\t'); const id = l.slice(0,i), v = l.slice(i+1).replace(/\\n/g,'\n');
    if (!byId.has(id)) { console.log('bad id', f, id); continue; }
    seen.add(id); out[byId.get(id)] = v.trim() === "∅" ? "" : v.trim();
  }
}
const missing = [...byId.keys()].filter(id => !seen.has(id) && byId.get(id).length <= maxLen);
console.log(lang, 'entries', Object.keys(out).length, 'missing', missing.length, missing.slice(0,40).join(' '));
fs.mkdirSync(`${D}../../www/js/i18n`, { recursive: true });
fs.writeFileSync(`${D}../../www/js/i18n/${lang}.js`, '// 自动生成：源文件在 scripts/i18n（node scripts/i18n/build.mjs <lang> 20）\nexport default ' + JSON.stringify(out) + ';\n');
