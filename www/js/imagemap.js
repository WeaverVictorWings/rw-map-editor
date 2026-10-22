// 图片转地图：取样、分色、按比例分配地形
// 颜色在 OKLab 空间里比较（比 RGB 更接近人眼），并允许按“目标占比”自动调节

export function srgbToOklab(r, g, b) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

// 把图片缩放到 W×H 格（每格一个颜色）。mode: 'smooth' 平均 | 'pixel' 最近邻（像素画）
export function sampleImage(bitmap, W, H, mode = 'smooth', blur = 0, crop = null) {
  const c = new OffscreenCanvas(W, H);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = mode !== 'pixel';
  x.imageSmoothingQuality = 'high';
  if (blur > 0) x.filter = `blur(${blur}px)`;
  const s = crop || { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  x.drawImage(bitmap, s.x, s.y, s.w, s.h, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const n = W * H;
  const lab = new Float32Array(n * 3), lum = new Float32Array(n), alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const [L, A, B] = srgbToOklab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    lab[i * 3] = L; lab[i * 3 + 1] = A; lab[i * 3 + 2] = B;
    lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    alpha[i] = d[i * 4 + 3];
  }
  return { W, H, lab, lum, alpha, rgba: d };
}

// k-means 分色：返回主色（OKLab 与 RGB）和占比
export function dominantColors(sample, k = 6, seed = 1) {
  const { lab, rgba } = sample;
  const n = lab.length / 3;
  const step = Math.max(1, Math.floor(n / 30000));
  const idx = [];
  for (let i = 0; i < n; i += step) if (sample.alpha[i] > 20) idx.push(i);
  if (!idx.length) return [];
  let r = seed * 16807 % 2147483647 || 1;
  const rand = () => (r = r * 16807 % 2147483647) / 2147483647;
  const C = [];
  C.push([...lab.subarray(idx[0] * 3, idx[0] * 3 + 3)]);
  const d2 = new Float64Array(idx.length).fill(Infinity);
  while (C.length < k) {
    let tot = 0;
    const last = C[C.length - 1];
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j] * 3;
      const d = (lab[i] - last[0]) ** 2 + (lab[i + 1] - last[1]) ** 2 + (lab[i + 2] - last[2]) ** 2;
      if (d < d2[j]) d2[j] = d;
      tot += d2[j];
    }
    if (tot <= 1e-9) break;
    let t = rand() * tot, pick = 0;
    for (let j = 0; j < idx.length; j++) { t -= d2[j]; if (t <= 0) { pick = j; break; } }
    C.push([...lab.subarray(idx[pick] * 3, idx[pick] * 3 + 3)]);
  }
  const K = C.length;
  const asg = new Int32Array(idx.length);
  for (let it = 0; it < 14; it++) {
    const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j] * 3;
      let best = 0, bd = Infinity;
      for (let c = 0; c < K; c++) { const d = (lab[i] - C[c][0]) ** 2 + (lab[i + 1] - C[c][1]) ** 2 + (lab[i + 2] - C[c][2]) ** 2; if (d < bd) { bd = d; best = c; } }
      asg[j] = best; const s = sum[best]; s[0] += lab[i]; s[1] += lab[i + 1]; s[2] += lab[i + 2]; s[3]++;
    }
    for (let c = 0; c < K; c++) if (sum[c][3]) C[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const out = C.map((c) => ({ lab: c, rgb: [0, 0, 0], share: 0, n: 0 }));
  for (let j = 0; j < idx.length; j++) {
    const o = out[asg[j]]; const i = idx[j] * 4;
    o.rgb[0] += rgba[i]; o.rgb[1] += rgba[i + 1]; o.rgb[2] += rgba[i + 2]; o.n++;
  }
  for (const o of out) { if (o.n) o.rgb = o.rgb.map((v) => Math.round(v / o.n)); o.share = o.n / idx.length; }
  return out.filter((o) => o.n).sort((a, b) => b.share - a.share);
}

// 按颜色分类：每格归到“距离 - 偏置”最小的主色，再映射到地形
export function classifyByColor(sample, colors, colorTerrain, bias) {
  const { lab, W, H } = sample;
  const n = W * H;
  const cells = new Uint8Array(n);
  const K = colors.length;
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2];
    let best = 0, bd = Infinity;
    for (let c = 0; c < K; c++) {
      const C = colors[c].lab;
      const d = Math.sqrt((L - C[0]) ** 2 + (A - C[1]) ** 2 + (B - C[2]) ** 2) - (bias[colorTerrain[c]] || 0);
      if (d < bd) { bd = d; best = c; }
    }
    cells[i] = colorTerrain[best];
  }
  return cells;
}

// 让各地形的占比接近目标：反复调节偏置
export function fitCoverage(sample, colors, colorTerrain, targets, K) {
  const bias = new Float64Array(K);
  let cells = classifyByColor(sample, colors, colorTerrain, bias);
  for (let it = 0; it < 40; it++) {
    const share = new Float64Array(K);
    for (let i = 0; i < cells.length; i++) share[cells[i]]++;
    let err = 0;
    for (const [t, want] of Object.entries(targets)) {
      const have = share[t] / cells.length;
      err = Math.max(err, Math.abs(have - want));
      bias[t] += (want - have) * 0.25;
    }
    if (err < 0.01) break;
    cells = classifyByColor(sample, colors, colorTerrain, bias);
  }
  return { cells, bias };
}

// 按亮度（高度图）分段。bands: [{t, share}]，从低到高；按占比自动定阈值
export function classifyByHeight(sample, bands, invert = false) {
  const { lum, W, H } = sample;
  const n = W * H;
  const vals = Float32Array.from(lum, (v) => (invert ? 1 - v : v));
  const sorted = Float32Array.from(vals).sort();
  const total = bands.reduce((s, b) => s + b.share, 0) || 1;
  const th = [];
  let acc = 0;
  for (let k = 0; k < bands.length - 1; k++) { acc += bands[k].share / total; th.push(sorted[Math.min(n - 1, Math.floor(acc * n))]); }
  const cells = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let k = 0; while (k < th.length && vals[i] > th[k]) k++;
    cells[i] = bands[k].t;
  }
  return cells;
}

// 水域分深浅：离岸超过 d 格的水改成深水
export function deepenWater(cells, W, H, waterSet, deepT, d) {
  if (deepT === undefined || deepT < 0) return;
  const dist = new Int32Array(W * H).fill(-1);
  const q = [];
  for (let i = 0; i < W * H; i++) if (!waterSet.has(cells[i])) { dist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % W;
    for (const u of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * H - W ? i + W : -1]) {
      if (u >= 0 && dist[u] < 0) { dist[u] = dist[i] + 1; q.push(u); }
    }
  }
  for (let i = 0; i < W * H; i++) if (waterSet.has(cells[i]) && dist[i] > d) cells[i] = deepT;
}

// 为每个主色挑一个最接近的地形（用图块的平均颜色比较）
export function suggestTerrains(colors, terrainColors) {
  return colors.map((c) => {
    let best = terrainColors[0].t, bd = Infinity;
    for (const tc of terrainColors) {
      const d = (c.lab[0] - tc.lab[0]) ** 2 + (c.lab[1] - tc.lab[1]) ** 2 + (c.lab[2] - tc.lab[2]) ** 2;
      if (d < bd) { bd = d; best = tc.t; }
    }
    return best;
  });
}
