// 截图导出：把地图按指定缩放渲染成一张大 PNG，可带网格/资源池/出生点标注
// 与「展示图」不同：这是按真实图块渲染的清晰截图，适合放大、发群、贴图鉴
import { A } from './state.js';
import { h, modal, toast, slider, toggle } from './ui.js';
import { HELP } from './help.js';
import { saveFile } from './files.js';
import { teamColor } from './render.js';

const ed = A.ed;

// 在离屏画布上按 scale 逐块渲染整张地图（tile = 20px）
export function renderFlat(ed2, rend, { scale = 1, grid = false, marks = true, maxSide = 4096 } = {}) {
  const m = ed2.map;
  const TW = m.tw || 20, TH = m.th || 20;
  let s = scale;
  // 别一口气做出手机扛不住的图
  while (Math.max(m.width * TW, m.height * TH) * s > maxSide && s > 0.2) s *= 0.8;
  const cv = new OffscreenCanvas(Math.max(1, Math.round(m.width * TW * s)), Math.max(1, Math.round(m.height * TH * s)));
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = s < 1;
  const CH = 64;   // 每次只画 64×64 格，避免一次性铺满内存
  for (let y0 = 0; y0 < m.height; y0 += CH) for (let x0 = 0; x0 < m.width; x0 += CH) {
    const px0 = Math.floor(x0 / CH), py0 = Math.floor(y0 / CH);
    const r = rend.renderTexChunk ? rend.renderTexChunk(px0, py0, s) : null;
    const tex = r && (r.cv || r);   // renderTexChunk 返回 {cv, px, cx, cy}
    if (!tex || !tex.width) continue;
    c.drawImage(tex, 0, 0, tex.width, tex.height, Math.round(x0 * TW * s), Math.round(y0 * TH * s), tex.width, tex.height);
  }
  // 网格
  if (grid && TW * s >= 6) {
    c.strokeStyle = 'rgba(0,0,0,0.18)';
    c.lineWidth = 1;
    for (let x = 0; x <= m.width; x++) { const X = Math.round(x * TW * s) + .5; c.beginPath(); c.moveTo(X, 0); c.lineTo(X, cv.height); c.stroke(); }
    for (let y = 0; y <= m.height; y++) { const Y = Math.round(y * TH * s) + .5; c.beginPath(); c.moveTo(0, Y); c.lineTo(cv.width, Y); c.stroke(); }
  }
  // 资源池 / 出生点标注
  if (marks) {
    c.fillStyle = '#ffd34d';
    for (const [x, y] of ed2.poolTiles()) {
      c.beginPath(); c.arc((x + 0.5) * TW * s, (y + 0.5) * TH * s, Math.max(2, TW * s * 0.3), 0, 7); c.fill();
    }
    for (const sp of ed2.spawns()) {
      const X = sp.cx * TW * s, Y = sp.cy * TH * s, r = Math.max(4, TW * s * 0.9);
      c.beginPath(); c.arc(X, Y, r, 0, Math.PI * 2);
      c.fillStyle = teamColor(sp.team); c.fill();
      c.lineWidth = Math.max(1, r * 0.12); c.strokeStyle = '#000'; c.stroke();
      if (r >= 8) {
        c.fillStyle = '#000'; c.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(sp.team + 1), X, Y + 0.5);
      }
    }
  }
  return { cv, scale: s };
}

export function shotDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const m = ed.map;
  const body = h('div', {});
  const zInp = h('input', { type: 'number', step: '0.5', min: '0.5', max: '8', value: '2', style: 'width:70px' });
  let useGrid = false, useMarks = true;
  const gridT = toggle('画网格', false, (v) => { useGrid = v; refresh(); });
  const markT = toggle('标资源池和出生点', true, (v) => { useMarks = v; refresh(); });
  const info = h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6' });
  const pv = h('canvas', { style: 'max-width:100%;max-height:320px;display:block;border:1px solid var(--line,#2a2f3a);margin-top:8px' });

  const refresh = () => {
    const z = Math.max(0.5, Math.min(8, +zInp.value || 2));
    const { cv, scale: s } = renderFlat(ed, A.rend, { scale: z, grid: useGrid, marks: useMarks });
    pv.width = cv.width; pv.height = cv.height;
    pv.getContext('2d').drawImage(cv, 0, 0);
    info.textContent = `输出 ${cv.width}×${cv.height} 像素（实际缩放 ×${s.toFixed(2)}）。地图 ${m.width}×${m.height} 格。`;
  };
  const re = () => setTimeout(refresh, 0);
  zInp.addEventListener('change', re);

  body.append(
    h('div', { class: 'row', style: 'gap:10px;align-items:center;flex-wrap:wrap' },
      h('span', { style: 'font-size:12px' }, '缩放倍数'), zInp, gridT, markT),
    info, pv,
    h('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6' },
      '这是按真实图块渲染的清晰截图，比「展示图」更大更清楚，适合放大看细节或贴到图鉴里。'
      + '为了不做爆内存，单边最多 4096 像素，超过会自动降一点比例。'),
  );
  refresh();

  const save = async () => {
    const z = Math.max(0.5, Math.min(8, +zInp.value || 2));
    const { cv } = renderFlat(ed, A.rend, { scale: z, grid: useGrid, marks: useMarks });
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const name = `${A.mapName}_截图x${z}.png`;
    const r = await saveFile(name, new Uint8Array(await blob.arrayBuffer()), 'image/png');
    if (r.ok) toast(`截图${r.where}：${name}`);
  };

  return modal('截图导出（按真实图块渲染的大图）', body, [
    { label: '取消', value: 0 },
    { label: '保存 PNG', value: 1, primary: true, check: save },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.shot': {
    t: '截图导出',
    s: '把地图按真实图块渲染成一张清晰的大 PNG，可以带网格和标注',
    b: '菜单「文件」→「截图导出…」。调缩放倍数，下面会马上显示效果预览和输出像素尺寸。勾上「画网格」方便讲坐标，勾上「标资源池和出生点」方便发给队友看分布。满意了点「保存 PNG」。',
    tips: ['单边最多 4096 像素，太大的图会自动降一点比例。', '和「展示图」的区别：截图是完整地图的高清版，展示图是带标题和图例的成品图。'],
  },
});
