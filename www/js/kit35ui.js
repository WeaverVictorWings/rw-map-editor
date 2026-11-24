// RWKit 3.5 工具箱：把 kit/ 里 3.5 新增的检查与工具做成一个多标签弹窗（与命令行同一套代码）
// 改地图的操作：先导出当前地图 → kit 算出新文本 → 重新载入；载入前的文本会留着，可「撤销上一次」。
import { A } from './state.js';
import { h, toast, modal, select, busy, confirmBox } from './ui.js';

const K = (f) => import('./kit/' + f);
let undoText = null;
const tick = () => new Promise((r) => setTimeout(r, 30));
const lc = { green: '#2da44e', yellow: '#d9a400', red: '#e5484d' };
const SEV = { error: '错误', warn: '警告', info: '提示' };
const sevCol = { error: '#e5484d', warn: '#d9a400', info: '#8b949e' };

async function snap() {
  const { rwApi } = await import('./api.js'); const { parseTmx, normalizeTmx } = await K('tmx.js');
  const text = await normalizeTmx(await rwApi.exportText('full')); return { text, model: parseTmx(text), rwApi };
}
async function applyText(rwApi, before, next, what) {
  undoText = before; await rwApi.loadText(next, (A.mapName || 'map') + '.tmx'); toast(`${what}已应用。可在工具箱底部点「撤销上一次」恢复`);
}
function download(name, data, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([data], { type: mime })); const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const readFile = (file) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(file); });
function fileBtn(label, on, accept = '') {
  const inp = h('input', { type: 'file', accept, style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (f) await on(await readFile(f), f); e.target.value = ''; } });
  return h('span', {}, h('button', { onclick: () => inp.click() }, label), inp);
}
const act = (label, fn, attrs = {}) => h('button', { ...attrs, onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { toast('出错:' + err.message, 5000); console.error(err); } finally { b.disabled = false; } } }, label);
const note = (t) => h('div', { class: 'hint', style: 'margin:6px 0;font-size:12px' }, t);
const pre = (t) => h('pre', { style: 'white-space:pre-wrap;font-size:12px;background:var(--panel2,#0001);padding:8px;border-radius:6px;margin:6px 0;max-height:240px;overflow:auto' }, t);
const table = (head, rows) => h('table', { style: 'font-size:12px;border-collapse:collapse;margin:4px 0' }, h('tr', {}, ...head.map((x) => h('th', { style: 'text-align:left;padding:2px 8px' }, x))), ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', { style: 'padding:2px 8px' }, c instanceof Node ? c : String(c))))));
const jump = (x, y) => { try { A.rend.centerOn(Math.round(x), Math.round(y), Math.max(A.rend.view.z, 0.5)); } catch { /* 没有地图 */ } };
function itemList(items, model, { max = 6 } = {}) {
  const by = new Map(); for (const i of items) { const k = i.sev + '|' + i.code; if (!by.has(k)) by.set(k, []); by.get(k).push(i); }
  const order = ['error', 'warn', 'info']; const out = h('div', {});
  for (const [k, v] of [...by].sort((a, b) => order.indexOf(a[0].split('|')[0]) - order.indexOf(b[0].split('|')[0]))) {
    out.append(h('div', { style: 'margin:6px 0' }, h('b', { style: 'color:' + sevCol[v[0].sev] }, `${SEV[v[0].sev]} ${v[0].code} ×${v.length}`, h('small', { style: 'color:var(--dim);margin-left:6px;font-weight:400' }, v[0].level || '')),
      ...v.slice(0, max).map((i) => { const pos = i.at || locate(model, i); return h('div', { style: 'font-size:12px;margin:2px 0 2px 10px' }, (i.key ? `「${i.key}」` : '') + i.msg + ' ', pos ? h('button', { style: 'padding:0 6px;font-size:11px', onclick: () => jump(pos[0], pos[1]) }, '定位') : null); }),
      v.length > max ? h('div', { style: 'font-size:12px;color:var(--dim);margin-left:10px' }, `……另有 ${v.length - max} 条`) : null));
  }
  if (!items.length) out.append(h('div', { style: 'color:' + lc.green }, '没有发现问题。'));
  return out;
}
function locate(model, i) { if (!i.key || !model) return null; const o = model.objects.find((q) => ((q.props.id || '').trim() || q.name) === i.key); return o ? [(o.x + (o.w || 0) / 2) / model.tw, (o.y + (o.h || 0) / 2) / model.tw] : null; }
const pickPt = async (msg) => { const { pickOnMap } = await import('./triggers.js'); const p = await pickOnMap(msg); return p ? [p.tx, p.ty] : null; };
const inputRow = (label, el) => h('div', { style: 'display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap' }, h('label', { style: 'min-width:92px;margin:0' }, label), el);
const num = (v, w = 70) => h('input', { type: 'number', value: v, style: `width:${w}px` });
const txt = (v, w = 160, ph = '') => h('input', { value: v, placeholder: ph, style: `width:${w}px` });

// ============ 各标签 ============
const TABS = [];
const tab = (id, label, render) => TABS.push({ id, label, render });

tab('deliver', '交付检查', (box) => {
  let refText = null, unitsText = null, winCfg = null;
  const out = h('div', {}); let last = null;
  const run = async () => {
    await busy('正在检查（大图需要几秒）…', async () => {
      const { text, model } = await snap(); const [D, U] = await Promise.all([K('deliver.js'), K('units35.js')]); const { parseTmx } = await K('tmx.js');
      const res = D.deliveryCheck(model, { rules: getRules(), ref: refText ? parseTmx(refText) : null, units: unitsText ? U.parseUnitList(unitsText) : [], win: winCfg }); last = { res, model, text, ref: refText ? parseTmx(refText) : null, D };
      out.innerHTML = ''; out.append(h('div', { style: `font-size:16px;font-weight:600;color:${lc[res.overall]};margin:8px 0` }, D.lightText[res.overall] + `(${res.counts.error} 错误 / ${res.counts.warn} 警告 / ${res.counts.info} 提示）`),
        ...res.sections.map((s) => h('details', { open: s.status === 'red' }, h('summary', { style: 'cursor:pointer' }, h('span', { style: `color:${lc[s.status]}` }, '● '), s.title, h('small', { style: 'color:var(--dim);margin-left:8px' }, `${s.counts.error}/${s.counts.warn}/${s.counts.info}`)), itemList(s.items.filter((i) => i.sev !== 'info' || s.status === 'green'), model))));
    });
  };
  box.append(note('一页红黄绿：触发器规则、3.5 新增检查、地形连通、文本、开局与夺城模拟、兵力、面积与加载压力。每条结果标了证据强度（模型验证/规格推断/经验）。没有在真实游戏里实测过。'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, act('运行交付前检查', run, { class: 'primary' }),
      fileBtn('选参考图（可选，如欧陆）', (t, f) => { refText = t; toast('参考图:' + f.name); }, '.tmx'), fileBtn('选模组单位表（可选）', (t, f) => { unitsText = t; toast('单位表:' + f.name); }, '.txt,.csv,.ini'),
      act('下载说明（.md）', async () => { if (!last) await run(); download((A.mapName || 'map') + '_说明.md', last.D.deliveryNotes(last.model, last.res, { title: A.mapName || '地图', ref: last.ref })); }),
      act('下载交付包（.zip）', async () => { if (!last) await run(); const pk = last.D.buildPackage(last.text, last.model, last.res, { title: A.mapName || '地图', ref: last.ref }); download(pk.name, pk.zip, 'application/zip'); })),
    (() => { // 胜利条件模拟（可选）：点要占的城 → 交付检查里会模拟"占满后 N 秒内是否触发胜利通报"
      const tm = num(0, 46), pat = txt('胜|终|守报', 110), secs = num(260, 56), shown = h('span', { style: 'font-size:12px;color:var(--dim)' }, '未设置');
      const pts = []; const upd = () => { winCfg = pts.length ? { team: +tm.value, at: pts.map(([x, y]) => [x * 20 + 10, y * 20 + 10]), pattern: pat.value, secs: +secs.value, label: '胜利条件' } : null; shown.textContent = pts.length ? `要占 ${pts.length} 座城：${pts.map((p) => `(${p[0]},${p[1]})`).join(' ')}` : '未设置'; };
      [tm, pat, secs].forEach((el) => { el.onchange = upd; });
      return h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '胜利条件模拟（可选）')), note('点出要占的城，交付检查会模拟「这个队占满后，通报触发器名字匹配下面的关键字的，会不会在 N 秒内触发」，再模拟少占一座城。'),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('占城的队伍', tm), inputRow('通报触发器名匹配', pat), inputRow('观察秒数', secs),
          act('点一座城', async () => { const p = await pickPt('点一座要占的城'); if (p) { pts.push(p); upd(); } }), act('清除', async () => { pts.length = 0; upd(); }), shown));
    })(), out);
});

tab('geo', '地形', (box) => {
  const gap = num(12, 54), small = num(120, 60), res = h('div', {});
  const show = async (fn) => busy('正在计算…', async () => { const { model } = await snap(); res.innerHTML = ''; res.append(await fn(model)); });
  const edit = (what, fn) => act(what, async () => { const { text, model, rwApi } = await snap(); const G = await K('geo35.js'); const r = await fn(G, model, text); if (!r) return; if (!(await confirmBox(what, r.msg + '\n确定后会用新结果重新载入地图。', '应用'))) return; await busy('正在写入…', async () => { await applyText(rwApi, text, r.text, what); }); });
  box.append(note('陆军能走「陆地 + 浅水」，所以两块陆地只靠浅水连着也算连着（日韩连在一起的根因）。这里全部按这个口径算。'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('海峡至少（格）', gap), inputRow('小岛≤(格）', small)),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      act('地形连通检查', () => show(async (m) => { const G = await K('geo35.js'); return itemList(G.lintGeo(m, { minGap: +gap.value, smallMax: +small.value }), m); }), { class: 'primary' }),
      act('相邻陆块距离表', () => show(async (m) => { const G = await K('geo35.js'); const r = G.gapReport(m, { minGap: +gap.value }); return table(['陆块 A', '陆块 B', '最窄', '深水连续', ''], r.pairs.slice(0, 40).map((p) => [`(${p.a.cx},${p.a.cy})`, `(${p.b.cx},${p.b.cy})`, p.gap, p.deepRun, h('button', { style: 'font-size:11px', onclick: () => jump(p.at[0], p.at[1]) }, p.tooNarrow ? '✗ 定位' : '定位')])); })),
      act('地形占比', () => show(async (m) => { const G = await K('geo35.js'); const sh = G.terrainShares(m), col = ['#8a9a5b', '#7fc4e8', '#2a5d9f', '#8b6b4a', '#d9534f']; return h('div', {}, h('div', { style: 'display:flex;height:18px;border-radius:4px;overflow:hidden;margin:6px 0' }, ...sh.rows.map((r, i) => h('div', { title: `${r.name} ${r.pct}%`, style: `width:${r.pct}%;background:${col[i % col.length]}` }))), h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;font-size:12px' }, ...sh.rows.map((r, i) => h('span', {}, h('span', { style: `display:inline-block;width:10px;height:10px;background:${col[i % col.length]};margin-right:4px` }), `${r.name} ${r.pct}%`))), pre(sh.text + '\n' + G.areaBudget(m).msg)); })),
      act('城市均匀度', () => show(async (m) => { const G = await K('geo35.js'); const r = G.cityUniformity(m, { radius: 90 }); return h('div', {}, pre(`城市 ${r.cities} 座;${r.radius} 格内覆盖陆地 ${r.coverage}%;城间最近邻 中位 ${r.nnMedian} / 最小 ${Math.round(r.nnMin)} / 最大 ${Math.round(r.nnMax)}${r.unreachable ? `;${r.unreachable} 格陆地走不到任何城市` : ''}`), r.holes.length ? table(['空白区', '离最近城市', ''], r.holes.map((q) => [`(${q.x},${q.y})`, `${q.dist} 格`, h('button', { style: 'font-size:11px', onclick: () => jump(q.x, q.y) }, '定位')])) : note('没有大片空白区。')); })),
      act('海军绕行（点陆地）', async () => { const p = await pickPt('点要检查"能否绕一圈"的陆地'); if (p) await show(async (m) => { const G = await K('geo35.js'); const r = G.circumnav(m, p); return pre(r.ok ? '能绕一圈。' : r.reason || `绕不过：连到地图${r.touchEdges.join('、')}边缘。例如 (${r.borderCells[0]})`); }); })),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:6px' },
      edit('清理零碎小岛', async (G, m, t) => { const r = G.removeSmallIslands(m, { maxArea: +small.value }); return r.removed ? { text: G.applyLayer(t, 'ground', r.data), msg: `将清掉 ${r.removed} 块小岛（${r.cells} 格），保留 ${r.kept} 块有单位的。` } : (toast('没有可清理的小岛'), null); }),
      edit('开凿过窄的海峡', async (G, m, t) => { let text = t, n = 0; for (let k = 0; k < 3; k++) { const { parseTmx } = await K('tmx.js'); const mm = parseTmx(text), bad = G.gapReport(mm, { minGap: +gap.value }).pairs.filter((p) => p.tooNarrow); if (!bad.length) break; let d = Uint32Array.from(mm.layers.ground.data); for (const g of bad) { d = G.widenGap({ ...mm, layers: { ...mm.layers, ground: { data: d } } }, g, { width: +gap.value + 2 }).data; n++; } text = G.applyLayer(text, 'ground', d); } return n ? { text, msg: `将沿最近点连线开凿 ${n} 处，使相邻陆块之间至少 ${gap.value} 格深水。` } : (toast('没有过窄的海峡'), null); }),
      edit('填平封闭死水', async (G, m, t) => { const r = G.fillDeadSeas(m, {}); return r.filled ? { text: G.applyLayer(t, 'ground', r.data), msg: `将填平 ${r.filled} 处封闭水域（${r.cells} 格）。` } : (toast('没有死水'), null); })),
    res);
});


tab('geo2', '地形绘制与导入', (box) => {
  const res = h('div', {});
  const edit2 = (what, fn) => act(what, async () => { const { text, model, rwApi } = await snap(); const G = await K('geo35.js'); const r = await fn(G, model, text); if (!r) return; if (!(await confirmBox(what, r.msg + '\n确定后会用新结果重新载入地图。', '应用'))) return; await busy('正在写入…', async () => { await applyText(rwApi, text, r.text, what); }); });
  const lineInput = () => { const ta = h('textarea', { rows: 2, style: 'width:100%;font-family:monospace;font-size:12px', placeholder: '点「点图加一点」连点几次，或手写：x,y x,y x,y（格）' }); return { el: h('div', {}, ta, h('div', { class: 'row', style: 'gap:6px;margin-top:4px' }, act('点图加一点', async () => { const p = await pickPt('点折线上的一个点（可以连着加好几个）'); if (p) ta.value = (ta.value.trim() + ' ' + p.join(',')).trim(); }), act('清空', async () => { ta.value = ''; }))), get: () => ta.value.trim().split(/\s+/).filter(Boolean).map((q) => q.split(',').map(Number)).filter((q) => q.length === 2 && q.every(Number.isFinite)) }; };
  const need = (pts, n = 2) => { if (pts.length < n) { toast(`至少要 ${n} 个点`); return false; } return true; };
  // 河
  const rv = lineInput(), rvW = num(2, 50);
  // 山脉
  const rg = lineInput(), rgW = num(2, 50), rgE = num(40, 56), rgP = num(5, 50);
  // 山口统计
  let pw0 = null, pw1 = null; const pwT = h('span', { style: 'font-size:12px;color:var(--dim)' }, '还没点两端'), pwMin = num(3, 44);
  // 岛链
  const ic = lineInput(), icN = num(8, 50), icGap = num(12, 50), icR0 = num(6, 46), icR1 = num(14, 46);
  // 放大
  let zc = null; const zcT = h('span', { style: 'font-size:12px;color:var(--dim)' }, '还没点中心'), zr = num(40, 50), zf = num(1.6, 54); zf.step = '0.1';
  // 贴花
  let dc = null; const dcT = h('span', { style: 'font-size:12px;color:var(--dim)' }, '还没点中心'), dr = num(20, 50), dg = num('', 60), dgList = h('div', {});
  // 高程
  let asc = null; const sea = num(0, 56), shore = num(0, 56), mnt = num('', 60);
  // 国界/选址
  let geo = null, zones = null; const ct = txt('', 260, '国家：队伍，如 中国:0,印度:1'), bbox = txt('', 180, '可空：lon0,lat0,lon1,lat1'), nameP = txt('name', 70);
  const sn = num(20, 50), sd = num(40, 50), sm = num(3, 44);
  box.append(note('画图工具：先点出折线（格坐标），确认预览后才改地图，可「撤销上一次」。河流/岛链只在合适的格子上画；山脉会按间距留山口。'),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '画河流（折线 → 连续浅水河）')), rv.el, h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:4px' }, inputRow('宽度（格）', rvW),
      edit2('画河', async (G, m, t) => { const pts = rv.get(); if (!need(pts)) return null; const r = G.drawRiver(m, pts, { width: +rvW.value }); if (!r.cells) { toast('这条线上没有可以画河的陆地格'); return null; } return { text: G.applyLayer(t, 'ground', r.data), msg: `将画 ${r.cells} 格河${r.mouth ? `，河口接到 (${r.mouth})` : '，终点附近没有海，河口悬空'}。` }; }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '画山脉（折线 → 岩石墙 + 山口）')), rg.el, h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:4px' }, inputRow('墙宽', rgW), inputRow('山口间距', rgE), inputRow('山口宽', rgP),
      edit2('画山脉', async (G, m, t) => { const pts = rg.get(); if (!need(pts)) return null; const r = G.drawRidge(m, pts, { width: +rgW.value, passEvery: +rgE.value, passWidth: +rgP.value }); if (!r.cells) { toast('这条线上没有可以画山的陆地格'); return null; } return { text: G.applyLayer(t, 'ground', r.data), msg: `将画 ${r.cells} 格岩石墙，留 ${r.passes.length} 个山口（宽约 ${rgP.value} 格）。` }; }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '山口宽度统计')), note('沿一条线（山脉走向）逐点看垂直方向能不能让陆军穿过，把连续能过的位置合并成山口并量宽度；偏窄的会标出来。'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, act('点山脉起点', async () => { pw0 = await pickPt('点山脉的一端'); pwT.textContent = `起点 ${pw0 ? pw0.join(',') : '?'} → 终点 ${pw1 ? pw1.join(',') : '?'}`; }), act('点山脉终点', async () => { pw1 = await pickPt('点山脉的另一端'); pwT.textContent = `起点 ${pw0 ? pw0.join(',') : '?'} → 终点 ${pw1 ? pw1.join(',') : '?'}`; }), pwT, inputRow('偏窄＜', pwMin),
        act('统计', async () => { if (!pw0 || !pw1) return toast('先点山脉两端'); const { model } = await snap(); const G = await K('geo35.js'); const r = G.passWidths(model, pw0, pw1, { minWidth: +pwMin.value }); res.innerHTML = ''; res.append(pre(r.blockedAll ? '这条线上没有任何一处能让陆军穿过。' : `共 ${r.passes.length} 个山口，${r.narrow.length} 个偏窄（＜${pwMin.value} 格）`), r.passes.length ? table(['位置', '宽（格）', ''], r.passes.map((q) => [`(${q.at})`, q.width + (q.width < +pwMin.value ? ' ← 偏窄' : ''), h('button', { style: 'font-size:11px', onclick: () => jump(q.at[0], q.at[1]) }, '定位')])) : null); }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '岛链（沿折线生成互不相连的岛）')), ic.el, h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:4px' }, inputRow('个数', icN), inputRow('岛间深水≥', icGap), inputRow('半径', h('span', {}, icR0, ' ~ ', icR1)),
      edit2('生成岛链', async (G, m, t) => { const pts = ic.get(); if (!need(pts)) return null; const r = G.islandChain(m, pts, { n: +icN.value, gap: +icGap.value, rMin: +icR0.value, rMax: +icR1.value }); if (!r.islands.length) { toast('放不下：折线附近太挤或不在水上'); return null; } return { text: G.applyLayer(t, 'ground', r.data), msg: `将生成 ${r.islands.length} 座岛${r.short ? `（想要 ${icN.value} 座，${r.short} 座放不下）` : ''}，彼此和陆地之间的深水带至少 ${icGap.value} 格。` }; }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '区域放大（径向变形，边缘平滑过渡）')), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, act('点中心', async () => { zc = await pickPt('点要放大的中心'); zcT.textContent = zc ? `中心 ${zc.join(',')}` : '还没点中心'; }), zcT, inputRow('半径', zr), inputRow('倍数', zf),
      edit2('放大', async (G, m, t) => { if (!zc) { toast('先点中心'); return null; } const r = G.radialZoom(m, zc, +zr.value, +zf.value); return { text: G.applyLayer(t, 'ground', r.data), msg: `将以 (${zc}) 为中心、半径 ${zr.value} 放大 ${zf.value} 倍，改动 ${r.moved} 格（只动地形，不动单位和触发器）。` }; }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '地貌贴花（沙漠/盐湖/荒原的不规则斑块）')), note('只改普通陆地格，不碰水、悬崖和浅水。图块编号（gid）在下面列出的里面挑。'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, act('点中心', async () => { dc = await pickPt('点贴花的中心'); dcT.textContent = dc ? `中心 ${dc.join(',')}` : '还没点中心'; }), dcT, inputRow('半径', dr), inputRow('图块 gid', dg), act('列出图块', async () => { const { model } = await snap(); const G = await K('geo35.js'); dgList.innerHTML = ''; dgList.append(pre(G.listGids(model).filter((g) => g.props.length).slice(0, 80).map((g) => `${g.gid}  ${g.tileset}  ${g.props.join(',')}`).join('\n'))); }),
        edit2('贴花', async (G, m, t) => { if (!dc) { toast('先点中心'); return null; } if (!+dg.value) { toast('先填图块 gid'); return null; } const r = G.blobDecal(m, { cx: dc[0], cy: dc[1], r: +dr.value, gid: +dg.value }); if (!r.cells) { toast('这里没有可改的普通陆地'); return null; } return { text: G.applyLayer(t, 'ground', r.data), msg: `将贴 ${r.cells} 格。` }; })), dgList),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '导入高程栅格（ESRI ASCII .asc → 深水/浅水/陆地/山）')),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, fileBtn('选 .asc 文件', (t, f) => { asc = t; toast('已读入 ' + f.name); }, '.asc,.txt'), inputRow('海平面（低于=深水）', sea), inputRow('浅水带', shore), inputRow('山高≥（可空）', mnt),
        edit2('导入高程', async (G, m, t) => { if (!asc) { toast('先选文件'); return null; } const { grid, w, h: hh } = G.parseAscGrid(asc); const r = G.rasterToLayers(m, grid, w, hh, { sea: +sea.value, shoreBand: +shore.value, mountain: mnt.value === '' ? Infinity : +mnt.value }); return { text: G.applyLayer(t, 'ground', r.data), msg: `将用 ${w}×${hh} 的高程栅格重画整张地形（原有地形会被覆盖，单位和触发器不动）。` }; }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '国界 GeoJSON → 城市归属对照')), note('读入 GeoJSON（每个国家一个 Feature），按经纬度范围画到地图上，列出每座指挥中心落在哪个国家、和它的队伍是否一致。'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, fileBtn('选 GeoJSON', (t, f) => { try { geo = JSON.parse(t); toast('已读入 ' + f.name); } catch (e) { toast('不是合法的 JSON：' + e.message, 5000); } }, '.json,.geojson'), inputRow('国家名字段', nameP), inputRow('范围', bbox), inputRow('国家→队伍', ct),
        act('对照', async () => { if (!geo) return toast('先选 GeoJSON'); const { model } = await snap(); const [G, M] = await Promise.all([K('geo35.js'), K('mapops.js')]); const bb = bbox.value.trim() ? bbox.value.split(',').map(Number) : undefined; zones = G.rasterizeCountries(M.rasterizePolygons, geo, model.width, model.height, { bbox: bb, nameProp: nameP.value || 'name' }); const map = {}; for (const q of ct.value.split(/[,，]/)) { const [k, v] = q.split(/[:：]/); if (k && v !== undefined && v.trim() !== '') map[k.trim()] = +v; } const rows = G.cityOwnership(model, zones, map); res.innerHTML = ''; const bad = rows.filter((r) => r.mismatch); res.append(pre(`识别出 ${zones.names.length} 个国家：${zones.names.slice(0, 30).join('、')}\n指挥中心 ${rows.length} 座，${rows.filter((r) => r.country).length} 座落在某个国家内；归属和队伍不一致的 ${bad.length} 座。`), bad.length ? table(['位置', '落在', '应属队伍', '现队伍', ''], bad.slice(0, 40).map((r) => [`(${r.x},${r.y})`, r.country, r.want, r.team, h('button', { style: 'font-size:11px', onclick: () => jump(r.x, r.y) }, '定位')])) : null); }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '城市自动选址')), note('从「能建造、离水离山有余量」的格子里，按最小间距贪心选点。只给候选位置，不改地图。'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('个数', sn), inputRow('最小间距', sd), inputRow('离水山余量', sm),
        act('选址', async () => { const { model } = await snap(); const G = await K('geo35.js'); const r = G.siteCities(model, { n: +sn.value, minDist: +sd.value, margin: +sm.value, zones }); res.innerHTML = ''; res.append(pre(`选出 ${r.sites.length} 个${r.short ? `，还差 ${r.short} 个（间距太大或可建造的地方不够）` : ''}（候选点 ${r.candidates} 个）`), table(['#', '位置', '国家', ''], r.sites.map((q, i) => [i + 1, `(${q.x},${q.y})`, q.zone || '', h('button', { style: 'font-size:11px', onclick: () => jump(q.x, q.y) }, '定位')]))); }))), res);
});

tab('text', '文本', (box) => {
  const res = h('div', {});
  const editText = (what, fn) => act(what, async () => { const { text, rwApi } = await snap(); const T = await K('text35.js'); const r = await fn(T, text); if (!r) return; if (!(await confirmBox(what, r.msg + '\n确定后会用新结果重新载入地图。', '应用'))) return; await applyText(rwApi, text, r.text, what); });
  const colorRules = h('textarea', { rows: 2, style: 'width:100%', placeholder: '太约:#4fa3ff,东协:#ff5a5a' }, ''), neutral = txt('', 80, '#ffd24a'), renameMap = txt('', 260, '东亚战区：中国，华北战区：中国'), budget = num(60, 54);
  const elim = { name: txt('日本', 70), capital: txt('东京', 70), foe: txt('东协', 70), chars: num(200, 60) }, elimOut = h('div', {});
  const scr = h('textarea', { rows: 3, style: 'width:100%', placeholder: '把一条消息贴在这里，看会不会超出屏幕' }, ''), scrOut = h('div', {});
  box.append(note('文本相关：统计、标点、开场压缩、阵营着色、批量替换名称、覆灭文本草稿、屏幕预览。生成的文字只是草稿，请再润色。'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      act('文本统计 + 标点检查', async () => { const { model } = await snap(); const T = await K('text35.js'); const s = T.textPanel(model); res.innerHTML = ''; res.append(pre(`${s.count} 条 / ${s.chars} 字；中位 ${s.median} 字；最长一条 ${s.max} 字；最长一行 ${s.maxLine} 字；超 30 字的行 ${s.over30} 条`), itemList(T.lintPunct(model), model)); }, { class: 'primary' }),
      editText('消息标点改全角', async (T, t) => { const r = T.fixPunct(t); return r.changed ? { text: r.text, msg: `将修改 ${r.changed} 条消息里的 ${r.chars} 个半角标点。` } : (toast('没有需要修改的'), null); }),
      act('阶段通报时间表', async () => { const { model } = await snap(); const T = await K('text35.js'); const rows = T.phaseTable(model); res.innerHTML = ''; res.append(table(['时间（秒）', '触发器', '内容'], rows.slice(0, 80).map((r) => [Math.round(r.at / 1000), r.key, r.text.slice(0, 30)])), ...T.phaseGaps(rows).map((g) => h('div', { style: 'color:' + lc.yellow }, `间隔过大:${g.from} → ${g.to},隔 ${Math.round(g.gapMs / 1000)} 秒`))); })),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '开场压缩')), inputRow('放完不超过（秒）', budget),
      h('div', { class: 'row', style: 'gap:6px' }, act('预览', async () => { const { model } = await snap(); const T = await K('text35.js'); const r = T.compressIntro(model, { budgetSec: +budget.value }); res.innerHTML = ''; res.append(pre(r.plan.length ? `开场介绍 ${r.plan.length} 条：最后一条 ${(r.before / 1000).toFixed(0)}s → ${(r.total / 1000).toFixed(1)}s` + (r.plan.some((p) => p.longest > 30) ? '\n有消息单行超 30 字，请先用「消息标点」和排版处理' : '') : '没有名字以「开场」或 intro 开头的消息触发器。')); }),
        editText('应用', async (T, t) => { const { parseTmx } = await K('tmx.js'); const r = T.compressIntro(parseTmx(t), { budgetSec: +budget.value }); if (!r.plan.length) return (toast('没有开场消息'), null); return { text: T.applyTimes(t, r.plan).text, msg: `将把 ${r.plan.length} 条开场介绍的时间重排，最后一条 → ${(r.total / 1000).toFixed(1)} 秒。` }; }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '按阵营着色 / 批量替换名称')), colorRules, inputRow('其余文字颜色', neutral),
      editText('应用着色', async (T, t) => { const rs = colorRules.value.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const i = s.lastIndexOf(':'); return { test: s.slice(0, i), color: s.slice(i + 1) }; }); if (!rs.length) return (toast('先填规则'), null); const r = T.applyCampColors(t, rs, { neutral: neutral.value || null }); return { text: r.text, msg: `将修改 ${r.hits} 处文字颜色。` }; }),
      inputRow('名称替换', renameMap), editText('应用替换', async (T, t) => { const mp = Object.fromEntries(renameMap.value.split(',').filter(Boolean).map((s) => s.split(':'))); const r = T.renameInTexts(t, mp); return { text: r.text, msg: `将替换 ${r.hits} 处。` }; })),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '覆灭文本草稿')), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('势力', elim.name), inputRow('首都', elim.capital), inputRow('征服者', elim.foe), inputRow('字数', elim.chars)),
      act('生成', async () => { const T = await K('text35.js'); const r = T.eliminationText({ name: elim.name.value, capital: elim.capital.value, foe: elim.foe.value, chars: +elim.chars.value, seed: Date.now() % 1000 }); elimOut.innerHTML = ''; elimOut.append(pre(r.plan.map((p) => `[+${(p.at / 1000).toFixed(1)}s]\n${p.text}`).join('\n\n') + `\n\n共 ${r.chars} 字 / ${r.messages.length} 条`)); }), elimOut),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '屏幕预览')), scr, act('预览', async () => { const T = await K('text35.js'); const r = T.screenPreview(scr.value, { cols: 30 }); scrOut.innerHTML = ''; scrOut.append(pre(r.box + '\n' + (r.ok ? '没有超出' : '超出的行:' + r.over.map((o) => `第${o.i}行（${o.w}）`).join('、')))); }), scrOut), res);
});


tab('text2', '文本工具', (box) => {
  const res = h('div', {});
  const doEdit = (what, fn) => act(what, async () => { const { text, model, rwApi } = await snap(); const T = await K('text35.js'); const r = await fn(T, text, model); if (!r) return; if (!(await confirmBox(what, r.msg + '\n确定后会用新结果重新载入地图。', '应用'))) return; await busy('正在写入…', async () => { await applyText(rwApi, text, r.text, what); }); });
  const ev = select([['neutral', '中立城被占'], ['enemy', '被敌人占领'], ['recapture', '收复'], ['ally', '盟友占领'], ['lost', '我方失守']], 'neutral', () => {}), cities = txt('北京,上海,广州', 200), who = txt('蓝方', 70);
  const match = txt('', 140, '正则，可空，如 中国|东协'), kmatch = txt('', 120, '触发器名正则，可空');
  const lang = txt('en', 54), vars = txt('A=蓝方,C=北京', 200), dl = h('textarea', { rows: 4, style: 'width:100%', placeholder: '每行一条消息，按字数算出每条该停留多久、从什么时候开始放' });
  box.append(note('这里的修改都先预览再应用，可「撤销上一次」。全角标点只改紧挨汉字的那种（数字里的小数点、时间 12:30 不动）。'),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '标点')), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      doEdit('一键修全角标点', async (T, t) => { const r = T.fixPunct(t); return r.changed ? { text: r.text, msg: `将改 ${r.changed} 条消息里的 ${r.chars} 个标点为全角。` } : (toast('没有需要改的标点'), null); }),
      act('检查标点（成对 / 结尾逗号）', async () => { const { model } = await snap(); const T = await K('text35.js'); res.innerHTML = ''; res.append(itemList(T.lintPunct(model), model)); }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '战报模板')), note('按事件类型批量出战报句子（每行已按 30 字折好，标点全角）。复制进触发器的 globalMessage 就行。'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('事件', ev), inputRow('城市（逗号分隔）', cities), inputRow('势力', who), act('生成', async () => { const T = await K('text35.js'); const rows = T.reportRows(cities.value.split(/[,，、\s]+/).filter(Boolean), ev.value, { who: who.value }); res.innerHTML = ''; res.append(table(['城市', '战报'], rows.map((r) => [r.city, r.text]))); }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '文本导出 / 导入（CSV）')), note('导出所有消息文字（可按势力名 / 触发器名筛选），在表格软件里改完再导进来，只会改有变化的那几条。'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('文字含', match), inputRow('触发器名', kmatch), act('导出 CSV', async () => { const { text } = await snap(); const T = await K('text35.js'); download((A.mapName || 'map') + '_texts.csv', T.exportTextsFiltered(text, { match: match.value || null, keyMatch: kmatch.value || null }), 'text/csv'); }),
        fileBtn('导入 CSV', async (csv) => { const { text, rwApi } = await snap(); const T = await K('text35.js'); const r = T.importTexts(text, csv); if (!r.changed) return toast('没有变化的条目'); if (!(await confirmBox('导入文本', `将改 ${r.changed} 个触发器的文字。确定后会重新载入地图。`, '应用'))) return; await busy('正在写入…', async () => { await applyText(rwApi, text, r.text, '导入文本'); }); }, '.csv,.txt'))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '多语言文本包')), note('导出「原文 / 译文」两栏的 CSV，译好后选语言代码导入，会写成 globalMessage_en 之类的属性（游戏按玩家语言选用）。'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('语言代码', lang), act('导出翻译模板', async () => { const { text } = await snap(); const T = await K('text35.js'); download((A.mapName || 'map') + '_locale.csv', T.exportLocaleTemplate(text), 'text/csv'); }),
        fileBtn('导入译文', async (csv) => { const { text, rwApi } = await snap(); const T = await K('text35.js'); const r = T.importLocale(text, csv, lang.value.trim()); if (!r.written) return toast('没有读到译文（第 4 列为空）'); if (!(await confirmBox('导入译文', `将写入 ${r.written} 条 ${lang.value} 译文。确定后会重新载入地图。`, '应用'))) return; await busy('正在写入…', async () => { await applyText(rwApi, text, r.text, '导入译文'); }); }, '.csv,.txt'),
        act('看覆盖率', async () => { const { model } = await snap(); const T = await K('text35.js'); const c = T.localeCoverage(model, lang.value.trim()); res.innerHTML = ''; res.append(pre(`${lang.value}：${c.have} / ${c.total} 条有译文（${c.pct}%）`)); }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '占位符 {A} {C} {O}')), note('文字里写 {A} 这类占位符时，列出每个占位符用了几次，没给值的会标红（游戏里会原样显示成 {A}）。'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('变量（名=值，逗号分隔）', vars), act('检查占位符', async () => { const { model } = await snap(); const T = await K('text35.js'); const v = Object.fromEntries(vars.value.split(/[,，]/).map((q) => q.split('=')).filter((q) => q[0].trim() && q[1] !== undefined).map((q) => [q[0].trim(), q[1].trim()])); res.innerHTML = ''; res.append(table(['占位符', '次数', '例'], T.placeholderTable(model).map((r) => [`{${r.name}}`, r.count, r.keys[0]])), itemList(T.lintPlaceholders(model, v), model)); }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '自动排延迟')), dl,
      h('div', { class: 'row', style: 'gap:6px;margin-top:4px' }, act('算时间', async () => { const T = await K('text35.js'); const rows = T.autoDelays(dl.value.split('\n').filter((x) => x.trim())); res.innerHTML = ''; res.append(table(['#', '开始', '停留', '内容'], rows.map((r, i) => [i + 1, `${(r.at / 1000).toFixed(1)}s`, `${(r.dur / 1000).toFixed(1)}s`, r.text.slice(0, 40)])), pre(rows.length ? `全部放完需要 ${((rows[rows.length - 1].at + rows[rows.length - 1].dur) / 1000).toFixed(1)} 秒` : '没有内容')); }))), res);
});

tab('force', '兵力', (box) => {
  let refText = null; const res = h('div', {}), radius = num(12, 54);
  const addUnits = (what, make) => act(what, async () => { const { text, model, rwApi } = await snap(); const U = await K('units35.js'); const r = await make(U, model); if (!r || !r.list.length) return toast('没有放下任何单位'); if (!(await confirmBox(what, `将放置 ${r.list.length} 个单位${r.miss && r.miss.length ? '\n注意:' + r.miss.slice(0, 3).join(';') : ''}。确定后重新载入地图。`, '应用'))) return; await applyText(rwApi, text, U.insertUnits(text, r.list), what); });
  const tiers = h('textarea', { rows: 2, style: 'width:100%' }, '0：强\n1：弱'), per = h('textarea', { rows: 3, style: 'width:100%' }, '{"强":{"heavyTank":3,"fireBee":1},"弱":{"heavyTank":1}}');
  const fleet = select(['航母编队', '驱逐舰队', '战列舰队', '巡逻艇队'].map((x) => [x, x]), '驱逐舰队', () => {}), ftm = num(0, 54);
  box.append(note('兵力对照表按类别统计每队单位，可与参考图（欧陆）逐类比较。放兵工具只在能站的格子上放，放不下的会如实报告。'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      act('兵力对照表', async () => { const { model } = await snap(); const U = await K('units35.js'), { parseTmx } = await K('tmx.js'); const t = U.forceTable(model); res.innerHTML = ''; res.append(pre(U.forceTableText(t))); if (refText) { res.append(h('b', {}, '与参考图（每队平均）对照'), table(['类别', '本图', '参考', '倍数', '判断'], U.compareForces(model, parseTmx(refText)).rows.map((r) => [r.cat, r.mine, r.ref, r.ratio ?? '-', r.note]))); } }, { class: 'primary' }),
      fileBtn('选参考图（可选）', (t, f) => { refText = t; toast('参考图:' + f.name); }, '.tmx'),
      act('每城附近兵力', async () => { const { model } = await snap(); const U = await K('units35.js'); const rows = U.cityForces(model, { radius: +radius.value }); res.innerHTML = ''; res.append(table(['城市', '队', '工厂', '兵', '合计', ''], rows.slice(0, 120).map((r) => [r.name || `(${r.x},${r.y})`, r.team, r.factories, r.army, r.total, h('button', { style: 'font-size:11px', onclick: () => jump(r.x, r.y) }, '定位')]))); }), inputRow('半径（格）', radius),
      act('单位预算与热力', async () => { const { model } = await snap(); const U = await K('units35.js'); const b = U.unitBudget(model), hm = U.heatGrid(model), u = U.heatUneven(hm); res.innerHTML = ''; res.append(pre(`预置对象 ${b.total} 个；工厂 ${b.factories};可移动 ${b.mobile}\n兵力分布不均匀度 ${u.cv}(越小越均匀；有兵的 ${u.filled}/${u.total} 格块）`), itemList(b.issues, model)); }),
      act('模组单位名校验', async () => { const { model } = await snap(); const U = await K('units35.js'); res.innerHTML = ''; res.append(itemList(U.lintUnitNames(model, []), model)); })),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '按强弱档批量放兵')), note('左边每行「队伍：档名」；右边 JSON 写每档在每座城周围放什么。'), tiers, per,
      addUnits('放兵', async (U, m) => { const t = Object.fromEntries(tiers.value.split('\n').filter(Boolean).map((s) => s.split(':'))); return U.planForces(m, t, JSON.parse(per.value)); })),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '舰队 / 工厂成组')), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, fleet, inputRow('队伍', ftm),
      addUnits('点地图放舰队', async (U, m) => { const p = await pickPt('点放舰队的海面'); return p ? U.planFleet(m, fleet.value, p, +ftm.value) : null; }),
      addUnits('点地图放 3 座并排工厂', async (U, m) => { const p = await pickPt('点工厂组中心'); if (!p) return null; const r = U.factoryRow(m, { cx: p[0], cy: p[1], n: 3, unit: 'landFactory', team: +ftm.value }); if (!r.ok) { toast(r.reason); return null; } return r; }))), res);
});


tab('batch', '兵力批量', (box) => {
  const res = h('div', {});
  const doIt = (what, fn) => act(what, async () => { const { text, model, rwApi } = await snap(); const U = await K('units35.js'); const r = await fn(U, model, text); if (!r) return; if (!(await confirmBox(what, r.msg + '\n确定后会用新结果重新载入地图。', '应用'))) return; await busy('正在写入…', async () => { await applyText(rwApi, text, r.text, what); }); });
  // 区域放兵
  let box1 = null; const boxTxt = h('span', { style: 'font-size:12px;color:var(--dim)' }, '还没框区域');
  const unit1 = txt('heavyTank', 120, '单位名'), team1 = num(0, 46), cnt1 = num(10, 56);
  // 替换
  const team2 = txt('', 46, '空=所有队'), from2 = txt('extractorT1', 120), to2 = txt('extractorT2', 120);
  // 行军
  let pa = null, pb = null; const ptxt = h('span', { style: 'font-size:12px;color:var(--dim)' }, '还没选起点/终点'); const unit3 = select(['heavyTank', 'lightTank', 'mechGun', 'builder', 'fireBee', 'helicopter', 'battleShip', 'destroyer', 'hovercraft'].map((x) => [x, x]), 'heavyTank', () => {});
  box.append(note('放兵只会放在这个单位站得住的格子上（陆军不放水里、舰船只放水上）；放不下的会如实报告。每一步都先预览，确认后才改地图，可「撤销上一次」。'),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '在框出的区域里放兵')),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, act('框区域', async () => { const a = await pickPt('点区域的一个角'); if (!a) return; const b = await pickPt('点对角'); if (!b) return; box1 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; boxTxt.textContent = `区域 ${box1.join(',')}`; }), boxTxt, inputRow('单位', unit1), inputRow('队伍', team1), inputRow('数量', cnt1),
        doIt('放兵', async (U, m, t) => { if (!box1) { toast('先框一个区域'); return null; } const r = U.placeInRegion(m, { box: box1, unit: unit1.value.trim(), team: +team1.value, count: +cnt1.value }); if (!r.list.length) { toast('这个区域里放不下（地形不对或太挤）'); return null; } return { text: U.insertUnits(t, r.list), msg: `将放 ${r.list.length} 个 ${unit1.value}（队伍 ${team1.value}）${r.short ? `；还有 ${r.short} 个放不下` : ''}。` }; }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '批量替换单位')),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('队伍', team2), inputRow('原单位', from2), inputRow('换成', to2),
        doIt('替换', async (U, m, t) => { const r = U.replaceUnits(t, { team: team2.value === '' ? null : +team2.value, from: from2.value.trim(), to: to2.value.trim() }); if (!r.changed) { toast('没有符合的单位'); return null; } return { text: r.text, msg: `将把 ${r.changed} 个 ${from2.value} 换成 ${to2.value}。` }; }))),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '行军时间估算')),
      note('速度是粗估（格/秒），没有在游戏里核对，只适合比较「哪边更快」。陆军按能走的路径算，空军走直线，舰船走水路。'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, act('点起点', async () => { pa = await pickPt('点起点'); ptxt.textContent = `起点 ${pa ? pa.join(',') : '?'} → 终点 ${pb ? pb.join(',') : '?'}`; }), act('点终点', async () => { pb = await pickPt('点终点'); ptxt.textContent = `起点 ${pa ? pa.join(',') : '?'} → 终点 ${pb ? pb.join(',') : '?'}`; }), unit3, ptxt,
        act('估算', async () => { if (!pa || !pb) return toast('先点起点和终点'); const { model } = await snap(); const U = await K('units35.js'); const r = U.travelTime(model, pa, pb, unit3.value); res.innerHTML = ''; res.append(pre(r.ok ? `${unit3.value}：约 ${r.dist} 格，${r.secs} 秒（${Math.floor(r.secs / 60)} 分 ${r.secs % 60} 秒）` : `算不出：${r.reason}`)); }))), res);
});

tab('author', '触发器写作', (box) => {
  const res = h('div', {}), dsl = h('textarea', { rows: 5, style: 'width:100%;font-family:monospace;font-size:12px', placeholder: '检测A: unitDetect @(120,80) 3x3 { unitType=commandCenter, maxUnits=0 }\n战报A: unitAdd @(0,0) { globalMessage="某城易主", activatedBy=检测A, team=-1 }' }, '');
  const tplSel = select([['holdCities', '多城守满 N 分钟'], ['eliminationChain', '覆灭连锁'], ['phaseAnnounce', '阶段通报'], ['reinforceWaves', '增援波次'], ['airdrop', '空投']], 'phaseAnnounce', () => draw()), tplBox = h('div', {}); let tplInputs = {};
  const draw = async () => { const A35 = await K('author.js'); const t = A35.TEMPLATES35[tplSel.value]; tplBox.innerHTML = ''; tplInputs = {}; tplBox.append(note(t.desc)); for (const p of t.params) { const el = p.type === 'multiline' ? h('textarea', { rows: 3, style: 'width:260px' }, String(p.def)) : h('input', { value: Array.isArray(p.def) ? p.def.join(',') : p.def, style: 'width:160px' }); tplInputs[p.k] = { el, p }; tplBox.append(inputRow(p.label, p.type === 'pt' ? h('span', {}, el, h('button', { onclick: async () => { const pt = await pickPt('点位置'); if (pt) el.value = pt.join(','); } }, '点地图')) : el)); } };
  draw();
  const filt = txt('type=unitDetect team=3', 220), fk = txt('warmup', 90), fv = txt('30s', 90);
  const doEdit = (what, fn) => act(what, async () => { const { text, rwApi } = await snap(); const A35 = await K('author.js'); const r = await fn(A35, text); if (!r) return; if (!(await confirmBox(what, r.msg + '\n确定后重新载入地图。', '应用'))) return; await applyText(rwApi, text, r.text, what); });
  box.append(note('用一行一个触发器的速记语法写触发器，或从模板生成；全部在插入前做格式检查，名字重复会拒绝（避免引用混乱）。'),
    dsl, h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      doEdit('插入速记语法', async (A35, t) => { const r = A35.insertDsl(t, dsl.value); return { text: r.text, msg: `将插入 ${r.count} 个触发器。` }; }),
      act('导出为速记语法', async () => { const { model } = await snap(); const A35 = await K('author.js'); dsl.value = A35.toDsl(model); }),
      act('下载触发器 JSON', async () => { const { model } = await snap(); const A35 = await K('author.js'); download((A.mapName || 'map') + '_triggers.json', A35.exportTriggersJson(model), 'application/json'); }),
      h('span', {}, fileBtn('导入触发器 JSON', async (t) => { const { text, rwApi } = await snap(); const A35 = await K('author.js'); const r = A35.importTriggersJson(text, t); if (await confirmBox('导入 JSON', `更新 ${r.updated} 个、新增 ${r.added} 个触发器。确定后重新载入地图。`, '应用')) await applyText(rwApi, text, r.text, '导入触发器'); }, '.json')),
      doEdit('统一属性顺序', async (A35, t) => { const r = A35.sortAllProps(t); return r.changed ? { text: r.text, msg: `将重排 ${r.changed} 个触发器的属性顺序（内容不变，只减少 diff 噪音）。` } : (toast('已经是统一顺序'), null); }),
      act('合并建议', async () => { const { model } = await snap(); const A35 = await K('author.js'); const r = A35.mergeSuggestions(model); res.innerHTML = ''; res.append(r.length ? table(['数量', '触发器', '合并后框', '说明'], r.slice(0, 20).map((s) => [s.count, s.keys.join('、') + '…', s.bbox.join(','), s.note])) : pre('没有明显可合并的相邻检测区。')); })),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '批量改属性')), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('筛选', filt), inputRow('属性', fk), inputRow('改成', fv)),
      note('筛选语法同命令行 find：例如 type=unitDetect team=3 name~^占。属性值留空表示删除该属性。'),
      doEdit('批量改', async (A35, t) => { const R = await K('refactor.js'); const r = R.batchSet(t, filt.value, fv.value === '' ? {} : { [fk.value]: fv.value }, fv.value === '' ? [fk.value] : []); return r.changed ? { text: r.text, msg: `将修改 ${r.changed} 个触发器。` } : (toast('没有符合条件的触发器'), null); })),
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '模板')), tplSel, tplBox,
      doEdit('生成并插入', async (A35, t) => { const prm = {}; for (const [k, { el, p }] of Object.entries(tplInputs)) { const v = el.value; prm[k] = p.type === 'int' ? parseInt(v, 10) : p.type === 'num' ? +v : p.type === 'pt' || p.type === 'box' ? v.split(',').map(Number) : v; } const { parseTmx } = await K('tmx.js'); const m = parseTmx(t); prm.W = prm.W ?? m.width; prm.H = prm.H ?? m.height; const list = A35.buildTemplate(tplSel.value, prm); const { insertTriggers } = await K('templates.js'); return { text: insertTriggers(t, list), msg: `将插入 ${list.length} 个触发器（${list[0].name} 等）。` }; })), res);
});

tab('tables', '城市/势力表', (box) => {
  const cityBox = h('div', {}), facBox = h('div', {}); let cityRows = [], facRows = [];
  const load = async () => {
    const { model } = await snap(); const A35 = await K('author.js'); cityRows = A35.cityTable(model); facRows = A35.factionTable(model); cityBox.innerHTML = ''; facBox.innerHTML = '';
    cityBox.append(h('b', {}, `城市（${cityRows.length}）`), h('div', { style: 'max-height:260px;overflow:auto' }, table(['名字', '队', 'x', 'y', ''], cityRows.map((r) => [h('input', { value: r.name, style: 'width:110px', onchange: (e) => { r.name = e.target.value; } }), h('input', { type: 'number', value: r.team, style: 'width:50px', onchange: (e) => { r.team = +e.target.value; } }), r.x, r.y, h('button', { style: 'font-size:11px', onclick: () => jump(r.x, r.y) }, '定位')]))), itemList(A35.lintCityTable(cityRows), model, { max: 3 }));
    const F = A35.FACTION_FIELDS; facBox.append(h('b', {}, `势力（team_info,${facRows.length}）`), h('div', { style: 'max-height:260px;overflow:auto' }, table(['队', '城', ...F], facRows.map((r) => [r.team, r.cities, ...F.map((f) => h('input', { value: r[f], style: 'width:78px', disabled: !r.hasInfo, onchange: (e) => { r[f] = e.target.value; } }))]))), itemList(A35.lintFactionTable(facRows), model, { max: 3 }));
  };
  box.append(note('改完点「应用」会写回地图。没有 team_info 的队伍不能在这里改（需要先在触发器页新建「队伍设置」）。'), h('div', { class: 'row', style: 'gap:6px' }, act('读取', load, { class: 'primary' }),
    act('应用城市表', async () => { const { text, rwApi } = await snap(); const A35 = await K('author.js'); const r = A35.applyCityTable(text, cityRows); if (!r.changed) return toast('城市表没有改动'); await applyText(rwApi, text, r.text, `城市表（${r.changed} 处）`); }),
    act('应用势力表', async () => { const { text, rwApi } = await snap(); const A35 = await K('author.js'); const r = A35.applyFactionTable(text, facRows); if (!r.changed) return toast('势力表没有改动'); await applyText(rwApi, text, r.text, `势力表（${r.changed} 处）`); })), cityBox, facBox);
});

tab('zones', '区域与经纬度', (box) => {
  const key = () => 'rwkit35.zones.' + (A.mapName || ''); const get = () => { try { return JSON.parse(localStorage.getItem(key()) || '[]'); } catch { return []; } }; const put = (z) => { try { localStorage.setItem(key(), JSON.stringify(z)); } catch { toast('浏览器不让存储，区域只在这次有效'); } };
  const list = h('div', {}), name = txt('', 100, '区域名，如 新疆');
  const draw = async () => { list.innerHTML = ''; const zs = get(); if (!zs.length) { list.append(note('还没有命名区域。点「画区域」后在地图上点两个对角。')); return; } const { model } = await snap(); const A35 = await K('author.js'); const rep = A35.zoneReport(model, zs); list.append(table(['名字', '框', '单位', '触发器', '城市', '队伍', ''], rep.map((r, i) => [r.name, r.box.join(','), r.units, r.triggers, r.cities, r.teams.join('/'), h('span', {}, h('button', { style: 'font-size:11px', onclick: () => jump((r.box[0] + r.box[2]) / 2, (r.box[1] + r.box[3]) / 2) }, '定位'), h('button', { style: 'font-size:11px', onclick: () => { zs.splice(i, 1); put(zs); draw(); } }, '删'))]))); };
  const bbox = txt('60,-12,150,55', 150), cellOut = h('div', {});
  box.append(note('命名区域存在本浏览器里（按地图名），不写进地图文件。可用来数某个区域里有多少单位、城市。'), h('div', { class: 'row', style: 'gap:6px' }, name, act('画区域', async () => { const a = await pickPt('点区域的一个角'); if (!a) return; const b = await pickPt('点对角'); if (!b) return; const zs = get(); zs.push({ name: name.value || `区域${zs.length + 1}`, box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] }); put(zs); draw(); })), list,
    h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '经纬度 ↔ 格子')), inputRow('地图范围 lon0,lat0,lon1,lat1', bbox), act('点地图看经纬度与比例尺', async () => { const p = await pickPt('点任意位置'); if (!p) return; const { model } = await snap(); const G = await K('geo35.js'); const c = G.geoConv(bbox.value.split(',').map(Number), model.width, model.height); const bar = c.scaleBar(p[1], 20); cellOut.innerHTML = ''; cellOut.append(pre(`格 (${p[0]},${p[1]}) ≈ 经纬度 ${c.toLonLat(p[0], p[1]).join(', ')}\n这里每格 ≈ ${c.kmPerCell(p[1])} km;屏幕上 ${bar.px}px ≈ ${bar.km} km`)); }), cellOut));
  draw();
});

tab('log', '变更与项目', (box) => {
  const res = h('div', {}); const DB = 'rwkit35', ST = 'base';
  const idb = () => new Promise((ok, no) => { try { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch (e) { no(e); } });
  const put = async (k, v) => { const d = await idb(); return new Promise((ok, no) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).put(v, k); t.oncomplete = ok; t.onerror = () => no(t.error); }); };
  const get = async (k) => { const d = await idb(); return new Promise((ok, no) => { const q = d.transaction(ST).objectStore(ST).get(k); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); };
  box.append(note('「记录当前为基准」之后，每次再点「与基准比较」，会列出触发器/单位/地形/文本改了多少。基准存在本浏览器里。'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      act('记录当前为基准', async () => { const { text } = await snap(); await put('base:' + (A.mapName || ''), text); toast('已记录基准'); }),
      act('与基准比较', async () => { const base = await get('base:' + (A.mapName || '')); if (!base) return toast('还没有基准，先点「记录当前为基准」'); const { text } = await snap(); const D = await K('deliver.js'); const s = D.changeSummary(base, text); res.innerHTML = ''; res.append(pre(D.changeText(s)), s.triggers.sample.added.length ? pre('新增:' + s.triggers.sample.added.join('、')) : null, s.triggers.sample.changed.length ? pre('修改（前 5）:\n' + s.triggers.sample.changed.map((c) => c.key + '\n  ' + c.diff.slice(0, 3).join('\n  ')).join('\n')) : null); }, { class: 'primary' }),
      act('队伍颜色建议', async () => { const { model } = await snap(); const D = await K('deliver.js'); const c = D.colorAdvice(model); res.innerHTML = ''; res.append(itemList(c.items, model), pre(c.plan ? JSON.stringify(c.plan).slice(0, 400) : '没有推荐方案')); })), res);
});


// ---- 规则文件（rules.json）表单：存在本浏览器里（按地图名）,交付检查会用它的口径；也能导出/导入文件 ----
const rulesKey = () => 'rwkit35.rules.' + (A.mapName || '');
export function getRules() { try { return JSON.parse(localStorage.getItem(rulesKey()) || '{}'); } catch { return {}; } }
const putRules = (r) => { try { localStorage.setItem(rulesKey(), JSON.stringify(r)); return true; } catch { toast('浏览器不让存储，规则只在这次有效'); return false; } };

tab('view', '视图与规则', (box) => {
  // 1) 叠加层
  const ovBtns = [['none', '关闭叠加'], ['k35-gap', '海峡宽度'], ['k35-shallow', '仅浅水连通处'], ['k35-heat', '兵力热力'], ['k35-zones', '命名区域'], ['k35-diff', '与基准的地形差异']];
  const gapIn = num(A.settings.minGap35 || 12, 54); gapIn.onchange = () => { A.settings.minGap35 = +gapIn.value || 12; };
  box.append(h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '地图叠加层')),
    note('直接画在地图上，关掉工具箱也还在。改了地形后叠加层会自动重算。'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, inputRow('海峡至少（格）', gapIn), ...ovBtns.map(([k, l]) => h('button', { class: A.overlayKind === k ? 'primary' : '', onclick: (e) => { A.settings.minGap35 = +gapIn.value || 12; A.hooks.setOverlay(k); [...e.currentTarget.parentNode.querySelectorAll('button')].forEach((b) => b.classList.remove('primary')); e.currentTarget.classList.add('primary'); } }, l)))));
  // 2) 按队伍显示/隐藏单位
  const teamBox = h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' });
  const drawTeams = async () => { const O = await import('./overlay35.js'); const hid = O.hiddenTeams(); teamBox.innerHTML = ''; const ts = O.teamsInMap(); if (!ts.length) { teamBox.append(note('当前地图没有带队伍的单位。')); return; }
    for (const t of ts) { const cb = h('input', { type: 'checkbox' }); cb.checked = !hid.has(t.team); cb.onchange = () => { const s = new Set(O.hiddenTeams()); cb.checked ? s.delete(t.team) : s.add(t.team); O.setHiddenTeams(s); }; teamBox.append(h('label', { style: 'display:flex;gap:4px;align-items:center;margin:0' }, cb, h('span', { style: `display:inline-block;width:12px;height:12px;border-radius:3px;background:${t.color}` }), `队伍 ${t.team}（${t.n}）`)); } };
  box.append(h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '按队伍显示 / 隐藏单位')), note('只影响画面，不改地图。用来单独看一个势力的兵力摆放。'), teamBox, act('全部显示', async () => { const O = await import('./overlay35.js'); O.setHiddenTeams(null); drawTeams(); })));
  drawTeams();
  // 3) 规则文件
  const R0 = getRules(), C0 = { ...(R0.check || {}) }; const D0 = { lineMax: 30, linesMax: 12, minGap: 12, minDeep: 0, shallowWalkable: true, smallIsland: 120, riverMax: 3, openingSecs: 120, clearance: 0, mapBudget: 1200000 };
  const CHK = [['lineMax', '每行最多（字）'], ['linesMax', '每条最多（行）'], ['minGap', '海峡至少（格）'], ['minDeep', '深水带至少（格，0=不查）'], ['smallIsland', '小岛面积≤（格）'], ['riverMax', '河最宽（格）'], ['openingSecs', '开局检查时长（秒）'], ['clearance', '海军绕行余量（格）'], ['mapBudget', '地图面积预算（格）']];
  const chk = {}; for (const [k] of CHK) chk[k] = num(C0[k] ?? D0[k], 80);
  const shallow = h('input', { type: 'checkbox' }); shallow.checked = C0.shallowWalkable ?? D0.shallowWalkable;
  const teams = num(R0.teams ?? '', 60), mw = num(R0.mapSize ? R0.mapSize[0] : '', 70), mh = num(R0.mapSize ? R0.mapSize[1] : '', 70);
  const lst = (v) => txt((v || []).join(','), 260, '用逗号分隔'); const fc = lst(R0.forbidClasses), fg = lst(R0.forbidGids), nu = lst(R0.noUnits), banned = lst((R0.text || {}).banned);
  const msg = h('div', {});
  const collect = () => { const r = { ...R0 }; const setIf = (k, v, ok) => { if (ok) r[k] = v; else delete r[k]; };
    setIf('teams', +teams.value, teams.value !== ''); setIf('mapSize', [+mw.value, +mh.value], mw.value !== '' && mh.value !== '');
    const split = (el) => el.value.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
    setIf('forbidClasses', split(fc), split(fc).length); setIf('forbidGids', split(fg).map(Number).filter(Number.isFinite), split(fg).length); setIf('noUnits', split(nu), split(nu).length);
    const text = { ...(r.text || {}) }; const b = split(banned); if (b.length) text.banned = b; else delete text.banned; if (Object.keys(text).length) r.text = text; else delete r.text;
    const check = {}; for (const [k] of CHK) if (+chk[k].value !== D0[k]) check[k] = +chk[k].value; if (shallow.checked !== D0.shallowWalkable) check.shallowWalkable = shallow.checked; if (Object.keys(check).length) r.check = check; else delete r.check; return r; };
  const save = async () => { const r = collect(), A35 = await K('author.js'), bad = A35.validateRules(r); msg.innerHTML = ''; msg.append(bad.length ? itemList(bad, null) : note('规则格式没问题。')); if (!bad.some((x) => x.sev === 'error') && putRules(r)) toast('规则已保存，交付检查会按它来'); return r; };
  box.append(h('div', { class: 'sec' }, h('div', { class: 'sech' }, h('h3', {}, '项目规则（rules.json）')),
    note('交付检查、文本检查、地形检查都按这里的口径。留空/保持默认就是用内置口径。'),
    inputRow('队伍数', teams), inputRow('地图尺寸', h('span', {}, mw, ' × ', mh)), inputRow('禁用地形类', fc), inputRow('禁用图块 gid', fg), inputRow('禁放单位', nu), inputRow('禁用词', banned),
    h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-top:6px' }, ...CHK.map(([k, l]) => inputRow(l, chk[k])), inputRow('浅水算陆军可走', shallow)),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:6px' },
      act('保存', save, { class: 'primary' }), act('导出 rules.json', async () => { const r = await save(); download('rules.json', JSON.stringify(r, null, 2), 'application/json'); }),
      fileBtn('导入 rules.json', async (t) => { const A35 = await K('author.js'); let r; try { r = JSON.parse(t); } catch (e) { return toast('不是合法的 JSON:' + e.message, 5000); } const bad = A35.validateRules(r); if (bad.some((x) => x.sev === 'error')) { msg.innerHTML = ''; msg.append(itemList(bad, null)); return; } putRules(r); toast('已导入，重新打开工具箱后生效'); }, '.json'),
      act('恢复默认', async () => { try { localStorage.removeItem(rulesKey()); } catch { /* 没有存储 */ } toast('已清除，重新打开工具箱后恢复默认'); })), msg));
});

export async function toolbox(start = 'deliver') {
  const body = h('div', {}), tabs = h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap;margin-bottom:8px' }), pane = h('div', {});
  const show = (id) => { pane.innerHTML = ''; const t = TABS.find((x) => x.id === id) || TABS[0]; t.render(pane); [...tabs.children].forEach((b, i) => { b.classList.toggle('primary', TABS[i].id === t.id); }); };
  TABS.forEach((t) => tabs.append(h('button', { onclick: () => show(t.id) }, t.label)));
  body.append(tabs, pane); show(start);
  const undoBtn = { label: '撤销上一次', value: undefined, check: async () => { if (!undoText) { toast('没有可撤销的'); return false; } const { rwApi } = await import('./api.js'); const t = undoText; undoText = null; await rwApi.loadText(t, (A.mapName || 'map') + '.tmx'); toast('已恢复到上一次工具箱修改之前'); return false; } };
  return modal('RWKit 3.5 工具箱', body, [undoBtn, { label: '关闭', value: 1 }], { full: true });
}
