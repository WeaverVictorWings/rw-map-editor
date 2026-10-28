// 导出发帖 / 工坊文案：把地图信息、检查结果、触发器列表整理成一段能直接粘贴的文字
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { icon } from './icons.js';
import { copyCode } from './share.js';
import { saveFile } from './files.js';
import { runChecks } from './check.js';
import { balanceReport } from './pathing.js';

const ed = A.ed;

function terrainSummary() {
  const eng = ed.engine;
  if (!eng || !eng.names) return '';
  const counts = new Map();
  const V = eng.V, W1 = eng.W1, W = ed.map.width, H = ed.map.height;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = V[y * W1 + x];
    if (t === 255 || t === undefined) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const total = W * H;
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([t, n]) => `${eng.cn(t) || eng.names[t] || t} ${Math.round(n / total * 100)}%`).join('、');
}

export async function buildPublishText() {
  const m = ed.map;
  if (!m) return '';
  const teams = [...new Set(ed.spawns().map((s) => s.team).filter((t) => t >= 0))].sort((a, b) => a - b);
  const pools = ed.poolTiles().length;
  const units = m.groups.reduce((s, g) => s + g.objects.filter((o) => o.props.some((p) => p.name === 'unit')).length, 0);
  const checks = runChecks(ed, { triggerIssues: A.hooks.triggerIssues ? A.hooks.triggerIssues() : [] });
  const errs = checks.filter((c) => c.level === 'error').length, warns = checks.filter((c) => c.level === 'warn').length;
  let fair = null;
  try { fair = balanceReport(ed, 30).fair; } catch { /* 没出生点等情况忽略 */ }
  // 触发器白话列表
  let trigLines = [];
  try {
    const T = await import('./triggers.js');
    const objs = T.trigGroup() ? T.trigGroup().objects : [];
    trigLines = objs.filter((o) => T.defOf(o) && T.defOf(o).cat !== 'special')
      .slice(0, 40).map((o) => `- **${T.label(o)}**：${String(T.describe(o)).replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')}`);
  } catch { /* 触发器模块读不到就算了 */ }
  const lines = [];
  lines.push(`# ${A.mapName || '未命名地图'}`);
  lines.push('');
  lines.push(`> 用[铁锈地图编辑器](https://github.com/WeaverVictorWings/rw-map-editor)做的图，尺寸 ${m.width}×${m.height} 格，${teams.length} 支队伍，${pools} 个资源池${units ? `，${units} 个单位` : ''}。`);
  lines.push('');
  const tsum = terrainSummary();
  if (tsum) lines.push(`**地形**：${tsum}`);
  lines.push(`**队伍**：${teams.length ? teams.map((t) => t + 1).join(' / ') + ' 队' : '（还没放出生点）'}`);
  lines.push(`**资源**：${pools} 个资源池`);
  if (fair) lines.push(`**平衡**：最近资源池距离差 ${fair.nearestSpread} 格、30 格内数量差 ${fair.nearSpread} 个${fair.areaRatio ? `、地盘比 ${fair.areaRatio.toFixed(2)}` : ''}`);
  lines.push(`**检查**：${errs ? `${errs} 个问题` : '没有严重问题'}${warns ? `、${warns} 个提醒` : ''}`);
  lines.push('');
  if (trigLines.length) {
    lines.push('## 玩法 / 触发器');
    lines.push(...trigLines);
    lines.push('');
  }
  lines.push('## 怎么玩');
  lines.push('- （在这里写一句玩法说明，比如：1v1，中央有 5 个资源池，先抢中央的赢面大）');
  lines.push('');
  lines.push('## 下载');
  lines.push('- 地图文件：（保存后把 .tmx 一起发出去）');
  lines.push('- 预览图：（保存时会自动生成同名 .png 封面）');
  return lines.join('\n');
}

export async function publishDialog() {
  if (!ed.map) { toast('先新建或打开一张地图'); return; }
  const ta = h('textarea', { rows: 18, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px' });
  ta.value = await buildPublishText();
  const body = h('div', {},
    h('p', { style: 'margin:0 0 8px' }, '把这张图的尺寸、队伍、资源、检查结果和触发器整理成一段文字，可以直接发到群里 / 工坊介绍 / 论坛。生成后还能自己改。'),
    ta,
    h('div', { class: 'hint', style: 'margin-top:6px' }, '提示：触发器描述是编辑器翻译过的白话；保存地图后别忘了把 .tmx 和同名 .png 封面一起发出去。'));
  await modal('导出发帖 / 工坊文案', body, [
    { label: '关闭', value: null },
    { label: '下载 .md', value: async () => { saveFile((A.mapName || '地图') + '-介绍.md', ta.value, 'text/markdown'); toast('已下载介绍文案'); } },
    { label: '复制', primary: true, value: async () => { toast(await copyCode(ta.value) ? '文案已复制，去粘贴吧' : '复制失败，请手动选中复制'); } },
  ]);
}
