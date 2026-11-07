// RWKit · 单位簇布局:不对称、不过疏。按"围绕中心的随机泊松圈 + 最小/最大间距"放 n 个点。
export function rng(seed = 1) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function placeCluster({ cx, cy, n, minD = 3, maxD = 9, accept = () => true, taken = [], rand = rng(7), tries = 4000 }) {
  const pts = []; const all = [...taken];
  for (let t = 0; t < tries && pts.length < n; t++) {
    // 半径偏向近处(开方会过于均匀;这里用平方让靠中心更密),角度完全随机 → 无轴对称
    const a = rand() * Math.PI * 2, r = minD + (maxD - minD) * rand() ** 1.6; const x = Math.round(cx + Math.cos(a) * r * (0.8 + 0.4 * rand())), y = Math.round(cy + Math.sin(a) * r * (0.8 + 0.4 * rand()));
    if (!accept(x, y)) continue; if (all.some(([px, py]) => Math.hypot(px - x, py - y) < minD)) continue;
    pts.push([x, y]); all.push([x, y]);
  }
  return pts;
}
// 布局自检:最近邻距离统计,太疏/太挤/过度对称时提示
export function layoutStats(pts) {
  if (pts.length < 2) return { n: pts.length }; const nn = pts.map((p, i) => Math.min(...pts.filter((_, j) => j !== i).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
  const mean = nn.reduce((a, b) => a + b, 0) / nn.length; const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const sym = pts.filter(([x, y]) => pts.some(([a, b]) => Math.abs(a - (2 * cx - x)) < 0.5 && Math.abs(b - (2 * cy - y)) < 0.5)).length / pts.length;
  return { n: pts.length, nnMean: +mean.toFixed(2), nnMax: +Math.max(...nn).toFixed(2), pointSymmetric: +sym.toFixed(2), tooSparse: Math.max(...nn) > 12, tooSymmetric: sym > 0.6 };
}
