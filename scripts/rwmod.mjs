#!/usr/bin/env node
// 命令行：对 Mod（.rwmod 文件或解开的文件夹）做检查、出图鉴、对比、打包。和网页版用同一套逻辑。
//   node scripts/rwmod.mjs lint   <mod> [--github] [--fail-on=error|warn|none]
//   node scripts/rwmod.mjs health <mod> [-o 体检.md]
//   node scripts/rwmod.mjs docs   <mod> [-o 图鉴.md]
//   node scripts/rwmod.mjs diff   <旧mod> <新mod> [-o 更新日志.md]
//   node scripts/rwmod.mjs gallery <mod> [-o 图鉴.html]     单文件图鉴网页，图片内嵌
//   (diff 的 -o 以 .html 结尾会生成网页)
//   node scripts/rwmod.mjs pack   <文件夹> [-o out.rwmod]
//   node scripts/rwmod.mjs clone-unit <mod> <源单位名> <新单位名> [-o out.rwmod]   克隆单位(复制 ini,改 [core] name 和文件名;弹药/引用的其它单位不会自动改)
//   node scripts/rwmod.mjs map-units <mod> <地图.tmx>   地图用到了本 mod 的哪些单位、本 mod 的哪些单位地图没用到、地图里有哪些不在 mod 里的单位名
//   node scripts/rwmod.mjs translate-export <mod> [-o 翻译.csv]
//   node scripts/rwmod.mjs translate-import <mod> <csv> [-o out.rwmod]
import fs from 'fs';
import path from 'path';
import { Mod, checkMod } from '../www/js/modedit.js';
import { readZip, writeZip } from '../www/js/zip.js';
import { changelogMd } from '../www/js/modlogic.js';
import { galleryHtml, diffHtml, announcement } from '../www/js/modlogic4.js';
import { docsMd, healthMd, diffMods, translationCsv, applyTranslationCsv, lintText } from '../www/js/modlogic3.js';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const out = flag('-o'); const github = has('--github');
const fi = args.findIndex((a) => a.startsWith('--fail-on='));
const failOn = fi >= 0 ? args.splice(fi, 1)[0].split('=')[1] : 'error';
const [cmd, ...rest] = args;

function walk(dir, base = '') {
  const r = [];
  for (const n of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? base + '/' + n.name : n.name;
    if (n.name.startsWith('.git') || n.name === 'node_modules') continue;
    if (n.isDirectory()) r.push(...walk(dir, rel)); else r.push(rel);
  }
  return r;
}
async function load(p) {
  if (!p || !fs.existsSync(p)) throw new Error('找不到：' + p);
  if (fs.statSync(p).isDirectory()) {
    const ents = walk(p).map((rel) => ({ name: rel, bytes: async () => new Uint8Array(fs.readFileSync(path.join(p, rel))) }));
    return Mod.fromEntries(ents, path.basename(path.resolve(p)));
  }
  return Mod.fromEntries(readZip(new Uint8Array(fs.readFileSync(p))), path.basename(p));
}
const write = (file, data) => { fs.writeFileSync(file, data); console.log('已写入 ' + file); };
const pack = (m) => writeZip(m.collect());

try {
  if (cmd === 'lint') {
    const m = await load(rest[0]); const R = checkMod(m);
    const lines = [];
    for (const u of m.units) for (const d of lintText(u.text)) lines.push({ lv: u.notUnit ? 'info' : d.lv, msg: d.msg, file: u.file, line: d.line });
    const gh = (r) => `::${r.lv === 'error' ? 'error' : 'warning'}${r.file ? ' file=' + r.file : ''}${r.line ? ',line=' + r.line : ''}::${r.msg}`;
    const txt = (r) => `${r.lv === 'error' ? '错误' : '警告'} ${r.file ? r.file + (r.line ? ':' + r.line : '') + ' ' : ''}${r.msg}`;
    const all = R.filter((r) => !(/应为数字/.test(r.msg) && lines.some((d) => d.file === r.file && /应为数字/.test(d.msg)))).concat(lines);
    for (const r of all.filter((x) => x.lv !== 'info')) console.log(github ? gh(r) : txt(r));
    const e = all.filter((x) => x.lv === 'error').length, w = all.filter((x) => x.lv === 'warn').length;
    console.log(`\n${m.realUnits().length} 个单位：${e} 个错误，${w} 个警告，${all.length - e - w} 条提示`);
    process.exit(failOn === 'none' ? 0 : (e || (failOn === 'warn' && w)) ? 1 : 0);
  } else if (cmd === 'health') {
    const m = await load(rest[0]); const md = healthMd(m, checkMod(m)); out ? write(out, md) : console.log(md);
  } else if (cmd === 'docs') {
    const m = await load(rest[0]); const md = docsMd(m); out ? write(out, md) : console.log(md);
  } else if (cmd === 'diff') {
    const a = await load(rest[0]), b = await load(rest[1]); const d = diffMods(a, b); const md = /\.html?$/i.test(out || '') ? diffHtml(d, b.name) : /announce/.test(String(out)) ? announcement(d, b.name) : changelogMd(d, b.name); out ? write(out, md) : console.log(md);
  } else if (cmd === 'gallery') {
    const m = await load(rest[0]); write(out || (m.name + '-图鉴.html'), galleryHtml(m, m.name));
  } else if (cmd === 'pack') {
    const m = await load(rest[0]); write(out || (m.name + '.rwmod'), pack(m));
  } else if (cmd === 'clone-unit') {
    const m = await load(rest[0]); const src = m.realUnits().find((u) => m.unitName(u) === rest[1]); if (!src) throw new Error('找不到单位 ' + rest[1]); if (m.realUnits().some((u) => m.unitName(u) === rest[2])) throw new Error('新名字已被占用: ' + rest[2]);
    const text = src.text.replace(/(\[core\][\s\S]*?^\s*name\s*:\s*)[^\r\n]*/m, `$1${rest[2]}`); if (text === src.text) throw new Error('源单位的 [core] 里没有 name 字段,无法改名');
    const dir = src.file.replace(/[^/]*$/, ''); const nf = dir + rest[2] + '.ini'; if (m.files.has(nf)) throw new Error('文件已存在: ' + nf); m.files.set(nf, { bytes: new TextEncoder().encode(text) }); m.index();
    console.log(`已克隆 ${rest[1]} → ${rest[2]}(${nf})`); write(out || (m.name + '.cloned.rwmod'), pack(m));
  } else if (cmd === 'map-units') {
    const m = await load(rest[0]); const { parseTmx, unitsOf } = await import('../kit/tmx.js'); const model = parseTmx(fs.readFileSync(rest[1], 'utf8')); const used = new Map(); for (const u of unitsOf(model)) used.set(u.props.unit, (used.get(u.props.unit) || 0) + 1);
    const mine = new Set(m.realUnits().map((u) => m.unitName(u))); const inMod = [...used].filter(([k]) => mine.has(k)); const notInMod = [...used].filter(([k]) => !mine.has(k)); const unused = [...mine].filter((k) => !used.has(k));
    console.log(`地图用到本 mod 的单位 ${inMod.length} 种:` + inMod.map(([k, n]) => `${k}×${n}`).join('、')); console.log(`本 mod 里地图没用到的单位 ${unused.length} 种:` + unused.slice(0, 40).join('、'));
    console.log(`地图里不在本 mod 中的单位名 ${notInMod.length} 种(可能是原版单位,也可能是缺失的 mod 单位,脚本分不出来):` + notInMod.map(([k, n]) => `${k}×${n}`).join('、'));
  } else if (cmd === 'translate-export') {
    const m = await load(rest[0]); const csv = translationCsv(m); out ? write(out, csv) : console.log(csv);
  } else if (cmd === 'translate-import') {
    const m = await load(rest[0]); const r = applyTranslationCsv(m, fs.readFileSync(rest[1], 'utf8'));
    console.log(`改了 ${r.changed} 条，新增 ${r.added} 条，跳过 ${r.skipped} 条`); write(out || (m.name + '.translated.rwmod'), pack(m));
  } else {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(cmd ? 2 : 0);
  }
} catch (e) { console.error('出错：' + e.message); process.exit(2); }
