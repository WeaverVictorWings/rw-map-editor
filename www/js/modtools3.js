// Mod 编辑器工具集（三，3.1）：翻译表、单位图鉴、体检报告、整理全部格式
import { h, toast, modal } from './ui.js';
import { pickFile, saveFile } from './files.js';
import { checkMod, markDirty } from './modedit.js';
import { translationCsv, applyTranslationCsv, translationRows, docsMd, healthMd, formatAllUnits } from './modlogic3.js';
import { getVal } from './ini.js';

const CLOSE = [{ label: '关闭', value: true }];
const title = (m) => (getVal(m.info, 'mod', 'title') || m.name).replace(/[\\/:*?"<>|]/g, '_');

export const TOOLS3 = [
  ['翻译表（CSV）', '把所有单位的名称和描述导成表格，找人翻译后再导回来', translate],
  ['单位图鉴', '生成一张所有单位数值的 Markdown 表，贴到介绍页', docs],
  ['体检报告', '检查结果、评分、体积、没用到的素材，一份 Markdown', health],
  ['整理全部格式', '统一所有单位 ini 的 “键: 值” 写法和空行，不改内容', formatAll],
];

async function translate(ctx) {
  const n = translationRows(ctx.mod).length;
  const box = h('div', {}, h('p', {}, `共 ${n} 条文字。导出后用表格软件打开，改“text”列；要加新语言就新增一行，key 写成 displayText_en 这样。`),
    h('div', {}, h('button', { class: 'primary', onclick: async () => { await saveFile(title(ctx.mod) + '-翻译.csv', new TextEncoder().encode(translationCsv(ctx.mod)), 'text/csv'); } }, '导出 CSV'), ' ',
      h('button', { onclick: async () => {
        const r = await pickFile('.csv,.txt'); if (!r) return;
        const res = applyTranslationCsv(ctx.mod, await r.file.text());
        if (res.changed + res.added) { markDirty(); ctx.refresh && ctx.refresh(); }
        toast(`改了 ${res.changed} 条，新增 ${res.added} 条，跳过 ${res.skipped} 条`, 4000);
      } }, '导入 CSV')));
  modal('翻译表', box, CLOSE);
}
async function docs(ctx) {
  const md = docsMd(ctx.mod, title(ctx.mod));
  const ta = h('textarea', { class: 'me-src', style: 'min-height:40vh', readonly: true, value: md });
  const r = await modal('单位图鉴', h('div', {}, ta), [{ label: '关闭', value: false }, { label: '保存 .md', value: true, primary: true }], { wide: true });
  if (r) await saveFile(title(ctx.mod) + '-图鉴.md', new TextEncoder().encode(md), 'text/markdown');
}
async function health(ctx) {
  const md = healthMd(ctx.mod, checkMod(ctx.mod));
  const ta = h('textarea', { class: 'me-src', style: 'min-height:40vh', readonly: true, value: md });
  const r = await modal('体检报告', h('div', {}, ta), [{ label: '关闭', value: false }, { label: '保存 .md', value: true, primary: true }], { wide: true });
  if (r) await saveFile(title(ctx.mod) + '-体检.md', new TextEncoder().encode(md), 'text/markdown');
}
async function formatAll(ctx) {
  const n = formatAllUnits(ctx.mod);
  if (n) { markDirty(); ctx.refresh && ctx.refresh(); }
  toast(n ? `整理了 ${n} 个文件（改的只有空格和空行，可用“对比”确认）` : '已经很整齐了', 4000);
}
