// 素材修复：把“图块编号超出了现有图块集范围”这类问题，能安全替换的自动换掉
// 只做有把握的等价替换：
//   · 图块：四邻都是同一种地形、且该地形族里存在同角点图块 → 换成同族同角点的图块
//   · 单位：按单位表换回这个单位 / 这支队伍应该用的图块（含换了队伍版本的情况）
// 其余一律列出来让用户自己决定，绝不猜。
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast } from './ui.js';
import { objProp } from './tmx.js';
import { UNIT_CN } from './editor.js';

const ed = A.ed;

Object.assign(HELP, {
  'tool.assetfix': {
    t: '素材修复',
    s: '图块编号坏了？把能安全替换的自动换回来',
    b: '打开一张图块编号坏掉的地图（比如从别的版本改过、图块集被删过），菜单「编辑」→「素材修复」。它会先分析哪些图块能用现有素材里的同族同角点图块替换、哪些单位能换回单位表里的正确图块，列出来给你看过再修。一次修复=一步撤销。',
    tips: [
      '只替换“有把握”的：四邻同地形、单位表里查得到的。',
      '判断不了的不动，只在列表里标出来，让你自己处理。',
      '修完可以 Ctrl+Z 一步还原。',
    ],
  },
});

const DIRS4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// 一个图块的地形四角签名（同一套图块集内部比较才有效）
function sigOf(ts, gid) {
  if (!ts) return null;
  const info = ts.tiles.get(gid - ts.firstgid);
  if (!info || !info.terrain || info.terrain.length !== 4) return null;
  return info.terrain.join(',');
}

function terrCn(ts, sig) {
  const names = (sig || '').split(',').map((k) => ts.terrainNames[+k]).filter(Boolean);
  const uniq = [...new Set(names)];
  return uniq.length ? uniq.join('/') : '同地形';
}

// 四邻是否给出唯一、可靠的替换图块
function neighbourTile(m, L, W, H, i) {
  const x = i % W, y = (i / W) | 0;
  const votes = [];
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return null; // 地图边上不猜
    const g = L.data[ny * W + nx];
    if (!g) return null;
    const nts = m.tilesetOf(g);
    const sig = sigOf(nts, g);
    if (!sig) return null;
    votes.push({ ts: nts, sig, gid: g });
  }
  if (votes.length !== 4) return null;
  const base = votes[0];
  // 四邻必须来自同一套图块集、并且四角签名完全一样，才算“有把握”
  if (!votes.every((v) => v.ts === base.ts && v.sig === base.sig)) return null;
  // 找这套图块集里同签名的图块：优先 id 最小的（通常是标准整格图块）
  let best = -1;
  for (const [id, inf] of base.ts.tiles) {
    if (!inf.terrain || inf.terrain.length !== 4 || inf.terrain.join(',') !== base.sig) continue;
    if (best < 0 || id < best) best = id;
  }
  if (best < 0) return null;
  return { gid: base.ts.firstgid + best, by: terrCn(base.ts, base.sig), near: [x, y] };
}

function addFix(map, f) {
  const key = `${f.kind}|${f.from}|${f.to}`;
  let cur = map.get(key);
  // 注意：cells / objs 必须用新数组，不能和 f 共用——否则 for…of 遍历 f.cells 时又往同一个数组里 push，会无限膨胀
  if (!cur) { cur = { kind: f.kind, from: f.from, to: f.to, why: f.why, cells: [], objs: [] }; map.set(key, cur); }
  for (const c of (f.cells || [])) cur.cells.push(c);
  for (const o of (f.objs || [])) cur.objs.push(o);
  cur.count = cur.cells.length + cur.objs.length;
}

// 分析这张图缺哪些图块、哪些能安全替换
export function planFixes(ed2 = A.ed) {
  const m = ed2.map;
  if (!m) return { missing: [], fixes: [] };
  const W = m.width, H = m.height;
  const fixMap = new Map();
  const missing = [];

  // ---- 1. 图块图层里越界的编号 ----
  for (const L of m.layers) {
    if (!L.data) continue;
    for (let i = 0; i < L.data.length; i++) {
      const g = L.data[i];
      if (!g || m.tilesetOf(g)) continue;
      const x = i % W, y = (i / W) | 0;
      const nf = neighbourTile(m, L, W, H, i);
      if (nf) {
        addFix(fixMap, {
          kind: 'tile', from: g, to: nf.gid, why: `四邻都是「${nf.by}」，换成同族同角点的图块`, cells: [{ layer: L.name, i, x, y }], objs: [],
        });
      } else {
        missing.push({ kind: 'tile', layer: L.name, x, y, gid: g, reason: '四邻不是同一种地形，判断不出该换成哪个图块' });
      }
    }
  }

  // ---- 2. 单位对象：换回单位表里的正确图块 ----
  for (const { o } of ed2.allObjects()) {
    const name = objProp(o, 'unit');
    const gid = +o.attrs.gid || 0;
    const x = Math.floor(+(o.attrs.x || 0) / 20), y = Math.floor(+(o.attrs.y || 0) / 20);
    if (!name) {
      if (gid && !m.tilesetOf(gid)) missing.push({ kind: 'object', name: o.attrs.name || '', gid, x, y, reason: '不是单位对象，没有可推断的替代图块' });
      continue;
    }
    const team = +(objProp(o, 'team') ?? 0);
    const cn = UNIT_CN[name] || name;
    const ts = gid ? m.tilesetOf(gid) : null;
    if (ts) {
      // 图块本身合法：只处理“图块和单位/队伍对不上”这种有把握的情况
      const info = ts.tiles.get(gid - ts.firstgid);
      const tu = info && info.props ? info.props.unit : undefined;
      const tt = info && info.props ? info.props.team : undefined;
      const wantTeam = ed2.unitIndex.has(name + '|' + team) ? ed2.unitGid(name, team) : 0;
      if (tu !== undefined && tu !== name) {
        const want = ed2.unitGid(name, team);
        if (want && m.tilesetOf(want)) {
          addFix(fixMap, { kind: 'unit', from: gid, to: want, why: `图块是「${tu}」的，换成「${cn}」第 ${team + 1} 队图块`, cells: [], objs: [{ o, from: gid }] });
        }
      } else if (wantTeam && +tt !== team && tt !== undefined) {
        addFix(fixMap, { kind: 'unit-team', from: gid, to: wantTeam, why: `单位「${cn}」用的是第 ${(+tt) + 1} 队图块，换成第 ${team + 1} 队版本`, cells: [], objs: [{ o, from: gid }] });
      }
      continue;
    }
    // 图块坏了 / 没有：换回单位表里的图块
    const want = ed2.unitGid(name, team);
    if (want && m.tilesetOf(want)) {
      addFix(fixMap, {
        kind: 'unit', from: gid, to: want, why: `单位「${cn}」的图块不在现有素材里，换回单位表里第 ${team + 1} 队的图块`, cells: [], objs: [{ o, from: gid }],
      });
    } else {
      missing.push({ kind: 'unit', name: cn, raw: name, team, gid, x, y, reason: '单位表里也找不到这个单位 / 队伍能用的图块' });
    }
  }

  const fixes = [...fixMap.values()].sort((a, b) => b.count - a.count);
  return { missing, fixes };
}

// 应用修复：整次修复=一步撤销
export function applyFixes(ed2 = A.ed, fixes = null) {
  const m = ed2.map;
  if (!m) return { changed: 0, kinds: 0 };
  const list = (fixes || planFixes(ed2).fixes).filter((f) => f && f.count > 0);
  if (!list.length) return { changed: 0, kinds: 0 };
  const op = ed2.begin('素材修复');
  // 先给要改到的对象组拍“改动前”快照，再改对象
  const groups = new Set();
  for (const f of list) for (const o of (f.objs || [])) { const G = ed2.groupOf(o.o); if (G) groups.add(G); }
  for (const G of groups) op.snapshotGroup(G);
  let changed = 0;
  for (const f of list) {
    for (const o of (f.objs || [])) {
      if (+o.o.attrs.gid === +f.from) { o.o.attrs.gid = String(f.to); changed++; }
    }
    for (const c of (f.cells || [])) {
      const L = m.layers.find((l) => l.name === c.layer);
      if (!L) continue;
      if (+L.data[c.i] !== +f.from) continue;             // 计划过期就不动这一格
      op.tile(L, c.i, L.data[c.i], L.flips.get(c.i) || 0, f.to, L.flips.get(c.i) || 0);
      changed++;
    }
  }
  ed2.commit();
  return { changed, kinds: list.length };
}

function row(label, value, color) {
  return h('div', { class: 'hrow', style: 'align-items:baseline' },
    h('span', { style: 'color:var(--muted);font-size:12px;min-width:84px' }, label),
    h('span', { style: `font-size:13px${color ? `;color:${color}` : ''}` }, value));
}

export function assetFixDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const plan = planFixes(ed);
  const auto = plan.fixes.reduce((s, f) => s + f.count, 0);
  if (!auto && !plan.missing.length) {
    const body = h('div', {},
      h('div', { style: 'font-size:13px;color:var(--ok);margin-bottom:8px' }, '✓ 没有发现坏掉的图块编号，也没有找不到图块的单位。'),
      h('div', { class: 'hint' }, '“地图依赖检查”里的图块集缺失、外部图片这些是素材文件本身的问题，这里不处理。'));
    return modal('素材修复', body, [{ label: '关闭', value: 0, primary: true }], { wide: true });
  }

  const body = h('div', {});
  body.append(
    h('div', { class: 'hint', style: 'margin-bottom:8px' }, '只替换有把握的等价值：四邻同地形的图块、单位表里查得到的单位图块。判断不了的不动，列在下面让你自己决定。'),
    h('div', { style: 'display:flex;gap:12px;margin-bottom:10px' },
      h('div', { style: 'flex:1;border:1px solid var(--line,#2a2f3a);border-radius:8px;padding:10px' },
        h('div', { style: 'font-size:22px;font-weight:700;color:var(--accent)' }, String(auto)),
        h('div', { class: 'hint' }, '处可以自动修复')),
      h('div', { style: 'flex:1;border:1px solid var(--line,#2a2f3a);border-radius:8px;padding:10px' },
        h('div', { style: 'font-size:22px;font-weight:700;color:var(--warn)' }, String(plan.missing.length)),
        h('div', { class: 'hint' }, '处需要你自己决定'))),
  );

  if (plan.fixes.length) {
    body.append(h('h3', { style: 'font-size:14px;margin:12px 0 6px' }, `能自动修复的（${plan.fixes.length} 类，共 ${auto} 处）`));
    const wrap = h('div', { style: 'max-height:32vh;overflow:auto' });
    for (const f of plan.fixes) {
      const fromTs = ed.map.tilesetOf(+f.from), toTs = ed.map.tilesetOf(+f.to);
      const tag = f.kind === 'unit-team' ? '单位换队' : f.kind === 'unit' ? '单位' : '图块';
      const where = f.kind === 'tile' ? `图层「${f.cells[0] ? f.cells[0].layer : '?'}」` : '单位';
      wrap.append(h('div', { class: 'hrow', style: 'align-items:baseline;gap:8px' },
        h('span', { style: 'font-size:11px;color:var(--muted);min-width:56px' }, `[${tag}]`),
        h('span', { style: 'font-size:12px;flex:1;min-width:0' },
          h('div', {}, `${where}：${f.from} → ${f.to}（${f.count} 处）`),
          h('div', { class: 'hint' }, f.why + (fromTs && toTs ? `；${fromTs.name || '?'} → ${toTs.name || '?'}` : ''))),
        h('span', { class: 'hint', style: 'font-size:11px' }, `${f.count} 处`)));
    }
    body.append(wrap);
  }

  if (plan.missing.length) {
    body.append(h('h3', { style: 'font-size:14px;margin:12px 0 6px' }, `需要你自己决定的（${plan.missing.length} 处，前 60 条）`));
    const wrap = h('div', { style: 'max-height:28vh;overflow:auto' });
    for (const item of plan.missing.slice(0, 60)) {
      const tag = item.kind === 'tile' ? '图块' : item.kind === 'unit' ? '单位' : '对象';
      const name = item.kind === 'unit' ? `${item.name}（第 ${item.team + 1} 队）`
        : item.kind === 'tile' ? `图层「${item.layer || '?'}」` : (item.name || '无名对象');
      const cellText = item.kind === 'tile' ? `格 ${item.x},${item.y} · gid=${item.gid}` : `gid=${item.gid} · 格 ${item.x},${item.y}`;
      wrap.append(h('div', { class: 'hrow', style: 'align-items:baseline;gap:8px' },
        h('span', { style: 'font-size:11px;color:var(--warn);min-width:56px' }, `[${tag}]`),
        h('span', { style: 'font-size:12px;flex:1;min-width:0' },
          h('div', {}, item.kind === 'tile' ? `${name} · ${cellText}` : `${name} · ${item.layer ? `图层「${item.layer}」· ` : ''}${cellText}`),
          h('div', { class: 'hint' }, item.reason))));
    }
    if (plan.missing.length > 60) wrap.append(h('div', { class: 'hint' }, `…还有 ${plan.missing.length - 60} 处没有列出`));
    body.append(wrap);
  }

  body.append(h('div', { class: 'hint', style: 'margin-top:10px' }, '修复只改这些图块编号，其它什么都不动；一次修复算一步，可以 Ctrl+Z 撤回。'));

  const buttons = [{ label: '关闭', value: 0 }];
  if (auto) buttons.push({
    label: `全部自动修复（${auto} 处）`, primary: true,
    value: () => {
      const r = applyFixes(ed, plan.fixes);
      toast(`修好了 ${r.changed} 处素材${plan.missing.length ? `，还有 ${plan.missing.length} 处要你自己处理` : ''}`);
      return r;
    },
  });
  return modal('素材修复', body, buttons, { wide: true });
}
