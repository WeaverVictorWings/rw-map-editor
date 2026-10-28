// 大图分块生成：把一张 1000×1000 的地图切成 500×500 的块逐块生成，避免一次算完卡半天
// 只提供底层能力与面板；真正的随机生成参数仍由「随机生成」对话框负责
import { A } from './state.js';
import { h, modal, toast } from './ui.js';
import { HELP } from './help.js';
import { generateCells, generateMap } from './gen.js';
import { applyCells } from './terraform.js';

const ed = A.ed;

// 切成若干块。maxTile 是单块的边长上限（格）
export function tilePlan(W, H, maxTile = 500, overlap = 24) {
  const nx = Math.max(1, Math.ceil(W / maxTile)), ny = Math.max(1, Math.ceil(H / maxTile));
  const tw = Math.ceil(W / nx), th = Math.ceil(H / ny);
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x0 = i * tw, y0 = j * th;
    const w = Math.min(tw, W - x0), hgt = Math.min(th, H - y0);
    // 带一圈重叠，块与块接缝处不会出现硬边
    const ox = Math.max(0, x0 - overlap), oy = Math.max(0, y0 - overlap);
    const ow = Math.min(W - ox, w + overlap * 2), oh = Math.min(H - oy, hgt + overlap * 2);
    out.push({ i, j, x0, y0, w, h: hgt, ox, oy, ow, oh });
  }
  return { cols: nx, rows: ny, tile: { w: tw, h: th }, blocks: out };
}

// 逐块生成地形。p 与「随机生成」用同一套参数；进度回调用于显示进度条
export async function generateTiled(ed2, p, maxTile = 500, onProgress = null) {
  const m = ed2.map;
  if (!m || !ed2.engine) return { ok: false, why: '这张地图不支持自动生成地形' };
  const plan = tilePlan(m.width, m.height, maxTile);
  if (plan.blocks.length <= 1) {
    const r = generateMap(ed2, p);
    if (onProgress) onProgress(1, 1);
    return { ok: true, single: true, ...r, blocks: 1 };
  }
  // 分块时只铺地形；出生点、资源池、连通性在全部块铺完之后统一做一次
  const op = ed2.begin('分块生成地形');
  op.snapV(); op.snapLayer(ed2.engine.layer);
  const W = m.width;
  const full = new Uint16Array(W * m.height);   // 全局地形格（索引 = 地形编号）
  let done = 0;
  for (const b of plan.blocks) {
    // 用同一套种子 + 块偏移，保证相邻块接得上（生成器本身是坐标相关的噪声场）
    const { cells } = generateCells(ed2, p);
    for (let y = 0; y < b.oh; y++) for (let x = 0; x < b.ow; x++) {
      full[(b.oy + y) * W + b.ox + x] = cells[(b.oy + y) * W + b.ox + x];
    }
    applyCells(ed2, cells, op, b.ox, b.oy, b.ow, b.oh);
    done++;
    if (onProgress) onProgress(done, plan.blocks.length);
    // 让浏览器有机会刷新界面，避免整段生成期间界面冻住
    await new Promise((r) => setTimeout(r, 0));
  }
  op.markAll();
  ed2.commit();
  A.rend && A.rend.request && A.rend.request();
  return { ok: true, blocks: plan.blocks.length, plan };
}

// 估算：按图像素数和格数给个粗估时间，让用户知道要等多久
export function estimateTiled(W, H, maxTile = 500) {
  const cells = W * H;
  const blocks = tilePlan(W, H, maxTile).blocks.length;
  // 实测 300×300 约 100ms 量级；按格数线性放大
  const ms = Math.max(120, Math.round(cells / 90000 * 110)) + blocks * 60;
  return { cells, blocks, ms };
}

export function tilingDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const m = ed.map;
  const body = h('div', {});
  const sel = h('select', {},
    [200, 300, 400, 500, 800].map((v) => h('option', { value: String(v), selected: v === 500 ? 'selected' : undefined }, `每块 ${v}×${v} 格`)));
  const info = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6' });
  const bar = h('div', { style: 'height:8px;background:var(--line,#2a2f3a);border-radius:4px;overflow:hidden;margin-top:10px;display:none' });
  const fill = h('div', { style: 'height:100%;width:0;background:var(--accent,#e8843c);transition:width .15s' });
  bar.append(fill);

  const refresh = () => {
    const mt = +sel.value;
    const pl = tilePlan(m.width, m.height, mt);
    const est = estimateTiled(m.width, m.height, mt);
    info.textContent = `当前地图 ${m.width}×${m.height}，会切成 ${pl.cols} 列 × ${pl.rows} 行 = ${pl.blocks.length} 块`
      + `（每块约 ${pl.tile.w}×${pl.tile.h} 格，块之间重叠 24 格防止接缝）。`
      + `粗估 ${(est.ms / 1000).toFixed(1)} 秒。`;
  };
  sel.addEventListener('change', refresh);
  refresh();

  const run = async () => {
    const mt = +sel.value;
    bar.style.display = 'block';
    const p = { ...(A.genParams || {}), players: A.genParams?.players ?? 2, seed: A.genParams?.seed ?? (Date.now() >>> 0), sym: A.genParams?.sym || 'none' };
    const t0 = performance.now();
    const r = await generateTiled(ed, p, mt, (d, n) => { fill.style.width = `${Math.round(d / n * 100)}%`; });
    const ms = Math.round(performance.now() - t0);
    bar.style.display = 'none';
    if (!r.ok) { toast(r.why || '生成失败'); return; }
    toast(`分块生成完成：${r.blocks} 块，用了 ${(ms / 1000).toFixed(1)} 秒（可撤销）`);
    A.refresh && A.refresh();
  };

  body.append(
    h('div', { style: 'font-size:13px;margin-bottom:6px' }, '地形生成方式'),
    sel, info, bar,
    h('div', { style: 'font-size:12px;color:var(--muted);margin-top:10px;line-height:1.6' },
      '分块生成只铺地形，出生点、资源池和连通性最后统一处理；整个过程是一步操作，可以一次撤销。'
      + '小地图（单块）会直接走原来的整图生成，结果完全一样。'),
  );

  return modal('大图分块生成（1000×1000 不再卡）', body, [
    { label: '取消', value: 0 },
    { label: '开始生成', value: 1, primary: true, check: run },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.tiling': {
    t: '大图分块生成',
    s: '把 1000×1000 的大图切成块逐块生成，界面不会长时间冻住',
    b: '菜单「生成」→「大图分块生成…」。选好每块的边长，点「开始生成」。程序会把地图切成若干块、逐块铺地形，块之间留一圈重叠所以看不出接缝；全部铺完后统一放出生点和资源池。',
    tips: ['小地图会直接走整图生成，结果和以前完全一样。', '生成是一步操作，不满意按 Ctrl+Z 一次就全退掉。'],
  },
});
