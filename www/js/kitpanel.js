// 质检套件面板:导出当前地图 → 用 kit/ 里和命令行相同的代码跑一遍全套检查和夺城模拟
import { h, modal, toast } from './ui.js';
export async function kitDialog() {
  const { rwApi } = await import('./api.js');
  const text = await rwApi.exportText('full'); const K = (f) => import('./kit/' + f);
  const { parseTmx, normalizeTmx } = await K('tmx.js'); const model = parseTmx(await normalizeTmx(text));
  const [{ lintTriggers }, g, { checkTeams }, { openingCheck }] = await Promise.all([K('tlint.js'), K('grid.js'), K('teams.js'), K('tsim.js')]);
  const items = [...lintTriggers(model), ...g.checkPlacement(model), ...g.landConnectivity(model), ...checkTeams(model)];
  const o = openingCheck(model, 30); if (o.messages > 6) items.push({ sev: 'warn', code: 'O01', msg: `开局 30 秒内有 ${o.messages} 条消息(可能刷屏)` });
  const by = new Map(); for (const i of items) { const k = i.sev + '|' + i.code; if (!by.has(k)) by.set(k, []); by.get(k).push(i); }
  const col = { error: '#e5484d', warn: '#d9a400', info: '#888' };
  const rows = [...by].sort((a, b) => ['error', 'warn', 'info'].indexOf(a[0].split('|')[0]) - ['error', 'warn', 'info'].indexOf(b[0].split('|')[0])).map(([k, v]) => h('div', { style: 'margin:6px 0' }, h('b', { style: 'color:' + col[v[0].sev] }, `${v[0].sev === 'error' ? '错误' : v[0].sev === 'warn' ? '警告' : '提示'} ${v[0].code} ×${v.length}`), ...v.slice(0, 5).map((i) => h('div', { style: 'font-size:12px;margin-left:10px' }, (i.key ? `「${i.key}」` : '') + i.msg))));
  const c = { error: 0, warn: 0 }; items.forEach((i) => c[i.sev] !== undefined && c[i.sev]++);
  return modal('质检套件', h('div', {}, h('div', {}, `触发器 ${items.stats?.total ?? lintTriggers(model).stats.total} 个 · ${c.error} 个错误 · ${c.warn} 个警告 · 开局 30 秒消息 ${o.messages} 条`), ...(rows.length ? rows : [h('div', {}, '没有发现问题。')])), [{ label: '关闭', value: 0, primary: true }], { wide: true });
}
