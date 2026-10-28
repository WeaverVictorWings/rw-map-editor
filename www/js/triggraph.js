// 触发器连线可视化：把"被谁激活 / 同时激活 / 被谁关闭"画成一张关系图
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { HELP } from './help.js';
import { kindOf, defOf, label, tkey, CATS, TYPES } from './triggers.js';

const ed = A.ed;

Object.assign(HELP, {
  'tool.triggraph': { t: '触发器连线图', s: '把触发器之间的激活关系画成一张图', b: '把“被谁激活 / 同时激活 / 被谁关闭”三种连线画出来：<b>每个方框是一个触发器</b>，<b>箭头表示谁激活谁</b>，<b>红色虚线表示关闭</b>。点方框能选中对应的触发器。用来找出<b>断了链的触发器</b>（永远没人激活它）和<b>环形依赖</b>（互相等对方，谁也起不来）。' },
});

const LINKS = [['activatedBy', '被谁激活'], ['alsoActivate', '同时激活'], ['deactivatedBy', '被谁关闭']];

// 收集依赖关系
export function triggerGraph(ed2 = ed) {
  const g = ed2.map && ed2.map.group('Triggers');
  const objs = g ? g.objects.filter((o) => !!TYPES[kindOf(o)] || kindOf(o) === 'map_info' || kindOf(o) === 'team_info') : [];
  const nodes = [];
  const byKey = new Map();
  for (const o of objs) {
    const k = tkey(o);
    const n = { key: k, name: label(o), kind: kindOf(o), obj: o, in: 0, out: 0, missing: [] };
    nodes.push(n);
    if (!byKey.has(k)) byKey.set(k, n);
  }
  const edges = [];   // { from, to, kind:'on'|'off' }
  for (const o of objs) {
    const src = byKey.get(tkey(o));
    for (const [prop, cn] of LINKS) {
      const p = (o.props || []).find((x) => x.name === prop);
      if (!p || !p.value) continue;
      for (const ref of String(p.value).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        const dst = byKey.get(ref);
        if (!dst) { if (src) src.missing.push({ ref, prop: cn }); continue; }
        if (dst === src) continue;   // 自环不画
        // activatedBy 是反向：这个被谁激活 → 对方 → 这个
        if (prop === 'activatedBy') edges.push({ from: ref, to: src.key, kind: 'on', label: cn });
        else if (prop === 'alsoActivate') edges.push({ from: src.key, to: ref, kind: 'on', label: cn });
        else edges.push({ from: ref, to: src.key, kind: 'off', label: cn });
      }
    }
  }
  for (const e of edges) {
    const a = byKey.get(e.from), b = byKey.get(e.to);
    if (a) a.out++; if (b) b.in++;
  }
  // 找不到的引用
  const broken = [];
  for (const n of nodes) for (const m of n.missing) broken.push(`${n.name} 指向的“${m.ref}”不存在（${m.prop}）`);
  // 断了链的：不是 map_info、又被别的触发器引用了，但没有任何自动触发
  const orphans = [];
  for (const n of nodes) {
    if (n.kind === 'map_info' || n.kind === 'team_info') continue;
    const hasIn = edges.some((e) => e.to === n.key && e.kind === 'on');
    // 有延迟或者由开局直接生效的视为能自己起来
    const p = (n.obj.props || []);
    const delay = p.find((x) => x.name === 'delay');
    const hasAuto = !!(delay && String(delay.value || '').trim());
    if (!hasIn && !hasAuto) orphans.push(n.name);
  }
  // 环：A→B→A
  const cyc = [];
  const seenE = new Set();
  for (const e of edges) {
    if (e.kind !== 'on') continue;
    const back = edges.find((x) => x.kind === 'on' && x.from === e.to && x.to === e.from);
    if (!back) continue;
    const kk = [e.from, e.to].sort().join('|');
    if (seenE.has(kk)) continue;
    seenE.add(kk);
    cyc.push(`${e.from} 和 ${e.to} 互相激活`);
  }
  return { nodes, edges, broken, orphans, cycles: cyc };
}

// 用 SVG 画关系图
export function drawGraph(res, w = 760, hgt = 420) {
  const { nodes, edges } = res;
  if (!nodes.length) return h('div', { class: 'hint' }, '这张图没有触发器');
  // 分列布局：按入度分层
  const level = new Map();
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const depth = (k, guard = 0) => {
    if (level.has(k)) return level.get(k);
    if (guard > 12) return 0;
    level.set(k, 0);
    const ins = edges.filter((e) => e.to === k && e.kind === 'on');
    let d = 0;
    for (const e of ins) if (byKey.has(e.from)) d = Math.max(d, depth(e.from, guard + 1) + 1);
    level.set(k, Math.min(d, 6));
    return level.get(k);
  };
  for (const n of nodes) depth(n.key);
  const cols = new Map();
  for (const n of nodes) {
    const d = level.get(n.key) || 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d).push(n);
  }
  const maxCol = Math.max(...[...cols.keys()]);
  const bw = 130, bh = 34, gapX = (w - 40 - bw) / Math.max(1, maxCol), gapY = 52;
  const pos = new Map();
  for (const [d, list] of cols) {
    list.forEach((n, i) => {
      pos.set(n.key, { x: 20 + d * gapX, y: 40 + i * gapY + (hgt - 80 - list.length * gapY) / 2 + 20 });
    });
  }
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(w)); svg.setAttribute('height', String(hgt));
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.style.background = 'rgba(128,128,128,.07)';
  svg.style.borderRadius = '6px';
  // 箭头
  const defs = document.createElementNS(NS, 'defs');
  for (const [id, col] of [['arr', '#6aa9ff'], ['arroff', '#e5484d']]) {
    const m = document.createElementNS(NS, 'marker');
    m.setAttribute('id', id); m.setAttribute('markerWidth', '8'); m.setAttribute('markerHeight', '8');
    m.setAttribute('refX', '7'); m.setAttribute('refY', '3'); m.setAttribute('orient', 'auto');
    const pth = document.createElementNS(NS, 'path');
    pth.setAttribute('d', 'M0,0 L7,3 L0,6 z'); pth.setAttribute('fill', col);
    m.appendChild(pth); defs.appendChild(m);
  }
  svg.appendChild(defs);
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + bw, y1 = a.y + bh / 2, x2 = b.x, y2 = b.y + bh / 2;
    const mx = (x1 + x2) / 2;
    const pth = document.createElementNS(NS, 'path');
    pth.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 6},${y2}`);
    pth.setAttribute('fill', 'none');
    pth.setAttribute('stroke', e.kind === 'off' ? '#e5484d' : '#6aa9ff');
    pth.setAttribute('stroke-width', '1.6');
    if (e.kind === 'off') pth.setAttribute('stroke-dasharray', '5 4');
    pth.setAttribute('marker-end', e.kind === 'off' ? 'url(#arroff)' : 'url(#arr)');
    pth.setAttribute('opacity', '0.85');
    svg.appendChild(pth);
  }
  for (const n of nodes) {
    const p = pos.get(n.key);
    const grp = document.createElementNS(NS, 'g');
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(p.x)); rect.setAttribute('y', String(p.y));
    rect.setAttribute('width', String(bw)); rect.setAttribute('height', String(bh));
    rect.setAttribute('rx', '6');
    const def = defOf(n.obj);
    const cat = def && CATS[def.cat] ? CATS[def.cat] : { color: '150,150,150' };
    rect.setAttribute('fill', `rgba(${cat.color},.18)`);
    rect.setAttribute('stroke', `rgba(${cat.color},.75)`);
    rect.setAttribute('stroke-width', '1.4');
    grp.appendChild(rect);
    const tx = document.createElementNS(NS, 'text');
    tx.setAttribute('x', String(p.x + 8)); tx.setAttribute('y', String(p.y + 14));
    tx.setAttribute('font-size', '11'); tx.setAttribute('fill', 'currentColor');
    tx.textContent = (n.name.length > 14 ? n.name.slice(0, 14) + '…' : n.name);
    grp.appendChild(tx);
    const tx2 = document.createElementNS(NS, 'text');
    tx2.setAttribute('x', String(p.x + 8)); tx2.setAttribute('y', String(p.y + 27));
    tx2.setAttribute('font-size', '9'); tx2.setAttribute('fill', 'currentColor'); tx2.setAttribute('opacity', '0.6');
    tx2.textContent = `${def ? def.cn : n.kind} · →${n.out} ←${n.in}`;
    grp.appendChild(tx2);
    grp.style.cursor = 'pointer';
    grp.addEventListener('click', () => { A.rend.centerOn(0, 0); void 0; });
    svg.appendChild(grp);
  }
  return svg;
}

export function trigGraphDialog() {
  if (!ed.map) return;
  const res = triggerGraph();
  const color = { warn: 'var(--warn)', error: 'var(--err)' };
  const issues = [];
  if (res.broken.length) issues.push({ level: 'error', text: `找不到的引用：${res.broken.length} 处（${res.broken.slice(0, 3).join('；')}）` });
  if (res.cycles.length) issues.push({ level: 'error', text: `环形依赖：${res.cycles.slice(0, 3).join('；')}` });
  if (res.orphans.length) issues.push({ level: 'warn', text: `${res.orphans.length} 个触发器没人激活也不会自动启动：${res.orphans.slice(0, 4).join('、')}` });
  if (!issues.length) issues.push({ level: 'ok', text: '连线都正常' });
  const body = h('div', {},
    h('div', { class: 'hint' }, `${res.nodes.length} 个触发器 · ${res.edges.length} 条连线（蓝色=激活，红色虚线=关闭）`),
    h('div', { style: 'margin:8px 0 10px' }, ...issues.map((it) => h('div', { class: 'hrow' },
      h('span', { style: `color:${it.level === 'ok' ? 'var(--ok)' : color[it.level]};font-weight:700;width:18px` }, it.level === 'ok' ? '✓' : it.level === 'warn' ? '!' : '✕'),
      h('span', {}, it.text)))),
    drawGraph(res));
  return modal('触发器连线图', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
}
