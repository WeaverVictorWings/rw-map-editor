// 3.3.1：检查结果的“有意忽略”、导出、与上次对比、跳转到专项工具
import { A } from './state.js';
import { objProp } from './tmx.js';
import { saveFile } from './files.js';
import { kvGet, kvSet } from './util.js';

const key = (c) => c.cat + '|' + c.title;
function blobObj(ed, name, create) {
  let G = ed.map.group('EditorRules');
  if (!G && !create) return null;
  G = G || ed.map.ensureGroup('EditorRules');
  let o = G.objects.find((q) => (q.attrs.name || '') === name);
  if (!o && create) { o = { attrs: { name, x: '0', y: '0', width: '20', height: '20' }, props: [], extra: [] }; G.objects.push(o); }
  return o;
}
export function getIgnored(ed) {
  try { const o = blobObj(ed, 'rwIgnore', false); return o ? JSON.parse(objProp(o, 'json') || '[]') : []; } catch { return []; }
}
export function setIgnored(ed, list) {
  const G = ed.map.ensureGroup('EditorRules');
  ed.begin('检查：标记为有意'); ed.op.snapshotGroup(G);
  const o = blobObj(ed, 'rwIgnore', true); const v = JSON.stringify(list);
  const p = o.props.find((q) => q.name === 'json'); if (p) p.value = v; else o.props.push({ name: 'json', value: v });
  ed.commit();
}
export function toggleIgnore(ed, c) {
  const l = getIgnored(ed), k = key(c), i = l.indexOf(k);
  if (i >= 0) l.splice(i, 1); else l.push(k);
  setIgnored(ed, l); return i < 0;
}
export const isIgnored = (ed, c) => c.level !== 'ok' && getIgnored(ed).includes(key(c));

// 只有 error / warn 可以标记为有意；error 也允许，但在对话框里会提醒
export const canIgnore = (c) => c.level === 'warn' || c.level === 'error' || c.level === 'info';

// 跳转到专项工具
const TOOLS = { '连通': ['bottleneck', '看通行瓶颈'], '海峡': ['naval', '海战检查'], '触发器': ['sim', '触发器模拟器'], '空投': ['sim', '触发器模拟器'], '规则': ['geo', '地图规则/量测'], '资源': ['bottleneck', '看通行瓶颈'], '道路': ['bottleneck', '看通行瓶颈'] };
export const toolFor = (c) => TOOLS[c.cat] || null;

function lineOf(c) { return `[${c.level}] ${c.cat}｜${c.title}${c.detail ? '｜' + c.detail.replace(/\s+/g, ' ') : ''}${c.goto ? `｜(${c.goto.x},${c.goto.y})` : ''}`; }
export async function lastRun(name) { try { return (await kvGet('lastCheck:' + name)) || null; } catch { return null; } }
export async function rememberRun(name, list) { try { await kvSet('lastCheck:' + name, { time: Date.now(), keys: list.filter((c) => c.level !== 'ok').map(key) }); } catch { /* */ } }
export function diffRun(prev, list) {
  if (!prev) return null;
  const now = new Set(list.filter((c) => c.level !== 'ok').map(key)), old = new Set(prev.keys);
  return { fixed: [...old].filter((k) => !now.has(k)), added: [...now].filter((k) => !old.has(k)), time: prev.time };
}
export async function exportReport(list, mapName, d) {
  const L = [`# ${mapName} 检查报告 ${new Date().toLocaleString()}`, ''];
  for (const c of list) L.push(lineOf(c));
  if (d) { L.push('', `## 与上次（${new Date(d.time).toLocaleString()}）相比`, `已解决 ${d.fixed.length} 项：`, ...d.fixed.map((k) => '  - ' + k), `新出现 ${d.added.length} 项：`, ...d.added.map((k) => '  + ' + k)); }
  await saveFile((mapName || 'map').replace(/\.tmx$/i, '') + '-检查报告.txt', L.join('\n'), 'text/plain');
}
