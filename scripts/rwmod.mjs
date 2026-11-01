#!/usr/bin/env node
// 命令行：对 Mod（.rwmod 文件或解开的文件夹）做检查、出图鉴、对比、打包。和网页版用同一套逻辑。
//   node scripts/rwmod.mjs lint   <mod> [--github] [--fail-on=error|warn|none]
//   node scripts/rwmod.mjs health <mod> [-o 体检.md]
//   node scripts/rwmod.mjs docs   <mod> [-o 图鉴.md]
//   node scripts/rwmod.mjs diff   <旧mod> <新mod> [-o 更新日志.md]
//   node scripts/rwmod.mjs pack   <文件夹> [-o out.rwmod]
//   node scripts/rwmod.mjs translate-export <mod> [-o 翻译.csv]
//   node scripts/rwmod.mjs translate-import <mod> <csv> [-o out.rwmod]
import fs from 'fs';
import path from 'path';
import { Mod, checkMod } from '../www/js/modedit.js';
import { readZip, writeZip } from '../www/js/zip.js';
import { changelogMd } from '../www/js/modlogic.js';
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
    const a = await load(rest[0]), b = await load(rest[1]); const md = changelogMd(diffMods(a, b), b.name); out ? write(out, md) : console.log(md);
  } else if (cmd === 'pack') {
    const m = await load(rest[0]); write(out || (m.name + '.rwmod'), pack(m));
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
