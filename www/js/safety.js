// 兜底功能：保存摘要、错误捕获、自检面板（诊断信息）
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { kvGet, kvSet } from './util.js';
import { VERSION } from './version.js';

const ed = A.ed;

// ---- 保存摘要：和上次保存/打开时比，改了什么 ----
let saved = null;
export function captureSaved() {
  const m = ed.map;
  if (!m) { saved = null; return; }
  let cells = 0; for (const L of m.layers) cells += L.data.length;
  saved = { w: m.width, h: m.height, layers: cells <= 6e6 ? m.layers.map((L) => [L.name, L.data.slice()]) : null, groups: m.groups.map((G) => [G.name, G.objects.length]) };
}
const GN = { unitobjects: '单位', units: '单位', triggers: '触发器', objects: '对象' };
export function saveSummary() {
  const m = ed.map; if (!m || !saved) return '';
  const parts = [];
  if (saved.w !== m.width || saved.h !== m.height) parts.push(`尺寸 ${saved.w}×${saved.h} → ${m.width}×${m.height}`);
  else if (saved.layers) {
    let n = 0;
    for (let k = 0; k < saved.layers.length; k++) { const old = saved.layers[k][1], L = m.layers[k]; if (!L || L.name !== saved.layers[k][0] || L.data.length !== old.length) continue; for (let i = 0; i < old.length; i++) if (L.data[i] !== old[i]) n++; }
    if (n) parts.push(`改了 ${n} 格`);
  }
  m.groups.forEach((G, gi) => { const o = saved.groups[gi]; const d = G.objects.length - (o && o[0] === G.name ? o[1] : 0); if (d) parts.push(`${GN[G.name.toLowerCase()] || G.name} ${d > 0 ? '+' : '−'}${Math.abs(d)}`); });
  return parts.length ? '相比上次：' + parts.join('，') : '';
}

// ---- 错误捕获：最近 30 条，最多每分钟提示一次 ----
const errs = []; let lastToast = 0;
function push(msg) {
  errs.push({ t: Date.now(), msg: String(msg).slice(0, 300) }); if (errs.length > 30) errs.shift();
  if (Date.now() - lastToast > 60e3) { lastToast = Date.now(); toast('出了点问题（已记下）。可在“帮助 → 自检面板”复制诊断信息发给作者', 6000); }
}
export function installErrorCapture() {
  addEventListener('error', (e) => { if (e.message && !/ResizeObserver|Script error/.test(e.message)) push(`${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`); });
  addEventListener('unhandledrejection', (e) => { const r = e.reason; push('Promise: ' + ((r && (r.message || r.name)) || r)); });
}
export const recentErrors = () => errs.slice();

// ---- 自检面板 ----
export async function diagText() {
  const L = [];
  L.push(`铁锈地图编辑器 ${VERSION}`);
  L.push(`浏览器：${navigator.userAgent}`);
  L.push(`屏幕：${innerWidth}×${innerHeight} @${devicePixelRatio}，语言 ${navigator.language}`);
  try { const e = await navigator.storage.estimate(); L.push(`存储：已用 ${(e.usage / 1e6).toFixed(1)}MB / 配额 ${(e.quota / 1e6).toFixed(0)}MB`); } catch { L.push('存储：未知'); }
  const bk = await import('./backup.js').then((m) => m.backupStats()).catch(() => null);
  if (bk) L.push(`备份：${bk.n} 份，共 ${(bk.bytes / 1e6).toFixed(1)}MB`);
  const tpl = await kvGet('template'); L.push(`图块素材模板：${tpl ? '有（来自 ' + (tpl.from || '?') + '）' : '没有'}`);
  L.push(`游戏文件夹：${(await kvGet('gameTree')) || (await kvGet('gameDir')) ? '已设置' : '未设置'}`);
  const m = ed.map;
  L.push(m ? `当前地图：${A.mapName} ${m.width}×${m.height}，图层 ${m.layers.length}，对象组 ${m.groups.length}，图块集 ${m.tilesets.length}，${ed.engine ? '有地形引擎' : '无地形引擎'}，${ed.dirty ? '有未保存改动' : '已保存'}` : '当前没有打开地图');
  L.push(`往返检查：${rtState}`);
  L.push(`设置：${JSON.stringify(A.settings)}`);
  L.push(errs.length ? '最近错误：\n' + errs.map((e) => `  ${new Date(e.t).toLocaleTimeString()} ${e.msg}`).join('\n') : '最近错误：无');
  return L.join('\n');
}
export async function diagDialog() {
  const txt = await diagText();
  const ta = h('textarea', { readonly: true, translate: 'no', style: 'width:100%;min-height:45vh;font-family:monospace;font-size:12px;box-sizing:border-box' }); ta.value = txt;
  await modal('自检面板', h('div', {}, h('p', { class: 'hint' }, '这里只有版本、设备、存储和最近的错误，不含地图内容。出问题时点“复制”发给作者。'), ta), [
    { label: '打开备份', check: async () => { (await import('./backup.js')).backupDialog(); return false; } },
    { label: '复制', check: async () => { try { await navigator.clipboard.writeText(txt); toast('已复制'); } catch { ta.select(); toast('请手动复制选中的文字'); } return false; } },
    { label: '关闭', value: 1, primary: true }], { wide: true });
}

// ---- 载入后的往返检查：把读进来的地图再写出一遍，看有没有丢内容（只比结构，不比图块数据） ----
let rtState = '未检查';
function histo(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml'), c = new Map();
  const bump = (k) => c.set(k, (c.get(k) || 0) + 1);
  for (const el of doc.getElementsByTagName('*')) { bump(el.tagName); for (const a of el.attributes) bump(el.tagName + '@' + a.name); }
  return c;
}
export async function roundtripCheck(text) {
  rtState = '未检查';
  const m = ed.map;
  if (!m || !text || text.length > 6e6 || !m.serialize) return;
  try {
    const out = await m.serialize();
    const a = histo(text), b = histo(typeof out === 'string' ? out : new TextDecoder().decode(out));
    const lost = [];
    for (const [k, n] of a) if ((b.get(k) || 0) < n && !/^(data|tile)(@|$)/.test(k)) lost.push(`${k}（原 ${n}，写出 ${b.get(k) || 0}）`);
    rtState = lost.length ? '有 ' + lost.length + ' 项写出后变少：' + lost.slice(0, 8).join('、') : '通过';
    if (lost.length) toast(`这张图里有 ${lost.length} 种内容可能没法原样保留，保存前建议另存一份对照。详情在“帮助 → 自检面板”`, 6000);
  } catch (e) { rtState = '检查出错：' + (e.message || e); }
}

// ---- 版本升级保险：换了版本就把旧设置留一份 ----
export async function versionGuard() {
  try {
    const last = await kvGet('lastVersion');
    if (last && last !== VERSION) await kvSet('settingsBak', { from: last, time: Date.now(), settings: A.settings });
    if (last !== VERSION) await kvSet('lastVersion', VERSION);
  } catch (e) { console.warn(e); }
}

// ---- 我的数据在哪 ----
export async function dataDialog() {
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `现在一共占用约 ${(e.usage / 1e6).toFixed(1)}MB。`; } catch { /* 不支持就不显示 */ }
  const bk = await import('./backup.js').then((m) => m.backupStats()).catch(() => null);
  const li = (t) => h('li', { style: 'margin:5px 0' }, t);
  const body = h('div', {},
    h('p', {}, '这个工具没有服务器，你的地图和 Mod 不会上传到任何地方。下面这些只保存在这台设备的浏览器（或 App）里：'),
    h('ul', {}, li('最近打开的地图（缩略图和内容，方便下次继续）'), li('自动备份' + (bk ? `（现有 ${bk.n} 份）` : '')), li('Mod 编辑器的自动保存和最近打开的 Mod'), li('你的设置、书签、教程进度'), li('从你的地图里取出的图块素材')),
    h('p', {}, usage),
    h('p', { style: 'color:var(--warn)' }, '清除浏览器数据、卸载 App 或换设备，这些都会消失。重要的地图请保存成文件，也可以定期用“设置 → 导出个人数据”备份设置。'));
  await modal('我的数据在哪', body, [
    { label: '打开自动备份', check: async () => { (await import('./backup.js')).backupDialog(); return false; } },
    { label: '关闭', value: 1, primary: true }]);
}

// ---- 报告问题 ----
export async function reportProblem() {
  const txt = await diagText();
  try { await navigator.clipboard.writeText(txt); toast('诊断信息已复制，请粘贴到打开的页面里，再写一句遇到了什么', 5000); } catch { toast('打开页面后，请到“帮助 → 自检面板”复制诊断信息贴上', 5000); }
  window.open('https://github.com/WeaverVictorWings/rw-map-editor/issues/new/choose', '_blank', 'noopener');
}
