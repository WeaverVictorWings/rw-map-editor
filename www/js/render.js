// 渲染：64×64 格一块缓存；缩小时用整图概览；叠加层（通行图、地盘、对称差异）也分块缓存
import { objProp, placeholderRGB } from './tmx.js';

const C = 64;
const BASE_COLORS = ['#36c25b', '#e5484d', '#3e8ef7', '#f5c518', '#00bcd4', '#b36cf0', '#2b2b2b', '#ffffff', '#ff8c1a', '#8bc34a'];
export function teamColor(t) {
  const n = +t;
  if (n < 0 || Number.isNaN(n)) return '#9aa0a6';
  if (n < BASE_COLORS.length) return BASE_COLORS[n];
  const hue = (n * 137.508) % 360, light = 45 + (n % 3) * 10;
  return `hsl(${hue.toFixed(0)} 75% ${light}%)`;
}
export function teamTextColor(t) { const n = +t; return n === 6 ? '#fff' : '#000'; }

export class Renderer {
  constructor(canvas, ed) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.ed = ed;
    this.map = null;
    this.view = { z: 1, ox: 0, oy: 0 };
    this.cache = new Map(); this.cachePx = 0; this.budgetPx = 24e6;
    this.ovCache = new Map();
    this.pending = false;
    this.overlay = null;          // 编辑器提供的覆盖绘制
    this.tint = null;             // {kind, fn(i)->uint32 RGBA, opacity}
    this.reference = null;        // 描图参考图 {img, opacity, x, y, w, h}（地图像素坐标）
    this.dimOthers = false;       // 非当前层变暗
    this.activeLayer = null;      // 'ground' | 'items' | 'units'
    this.showGrid = true;
    this.colors = null;
    this.overview = null;
    this.pools = [];
    this.resize();
  }

  setMap(map) {
    this.map = map;
    this.clearCaches();
    this.buildColors();
    this.buildOverview();
    this.pools = this.ed.poolTiles();
    this.fit();
  }
  clearCaches() { this.cache.clear(); this.cachePx = 0; this.ovCache.clear(); }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = Math.max(1, r.width); this.ch = Math.max(1, r.height);
    this.cv.width = Math.round(this.cw * this.dpr);
    this.cv.height = Math.round(this.ch * this.dpr);
    this.request();
  }

  fit() {
    if (!this.map) return;
    const mw = this.map.width * this.map.tw, mh = this.map.height * this.map.th;
    const z = Math.min(this.cw / mw, this.ch / mh) * 0.94;
    this.view.z = z;
    this.view.ox = mw / 2 - this.cw / 2 / z;
    this.view.oy = mh / 2 - this.ch / 2 / z;
    this.request();
  }
  centerOn(tx, ty, z) {
    const m = this.map;
    if (z) this.view.z = z;
    this.view.ox = (tx + 0.5) * m.tw - this.cw / 2 / this.view.z;
    this.view.oy = (ty + 0.5) * m.th - this.ch / 2 / this.view.z;
    this.request();
  }
  zoomAt(sx, sy, factor) {
    const v = this.view;
    const mx = v.ox + sx / v.z, my = v.oy + sy / v.z;
    v.z = Math.min(8, Math.max(0.002, v.z * factor));
    v.ox = mx - sx / v.z; v.oy = my - sy / v.z;
    this.request();
  }
  setZoom(z) { this.zoomAt(this.cw / 2, this.ch / 2, z / this.view.z); }
  toMap(sx, sy) { const v = this.view; return { x: v.ox + sx / v.z, y: v.oy + sy / v.z }; }
  toScreen(mx, my) { const v = this.view; return { x: (mx - v.ox) * v.z, y: (my - v.oy) * v.z }; }

  buildColors() {
    const m = this.map;
    const col = new Uint8Array((m.maxGid + 2) * 4);
    for (const ts of m.tilesets) {
      if (!ts.image && ts.tilecount) {   // 没有图片的地块集：小地图、概览也用同色色块
        for (let id = 0; id < ts.tilecount; id++) {
          const k = (ts.firstgid + id) * 4; if (k + 3 >= col.length) break;
          const [pr, pg, pb] = placeholderRGB(ts.name || ts.imageSource || ts.source, id);
          col[k] = pr; col[k + 1] = pg; col[k + 2] = pb; col[k + 3] = 255;
        }
        continue;
      }
      if (!ts.image || !ts.columns) continue;
      const oc = new OffscreenCanvas(ts.image.width, ts.image.height);
      const c = oc.getContext('2d', { willReadFrequently: true });
      c.drawImage(ts.image, 0, 0);
      const img = c.getImageData(0, 0, ts.image.width, ts.image.height).data;
      const iw = ts.image.width, ih = ts.image.height;
      for (let id = 0; id < ts.tilecount; id++) {
        const sx = (id % ts.columns) * ts.tw, sy = Math.floor(id / ts.columns) * ts.th;
        if (sy >= ih) break;
        let r = 0, g = 0, b = 0, n = 0, tot = 0;
        for (let y = sy; y < sy + ts.th && y < ih; y += 2) for (let x = sx; x < sx + ts.tw && x < iw; x += 2) {
          const p = (y * iw + x) * 4; tot++;
          if (img[p + 3] > 40) { r += img[p]; g += img[p + 1]; b += img[p + 2]; n++; }
        }
        const k = (ts.firstgid + id) * 4;
        if (k + 3 < col.length && n) { col[k] = r / n; col[k + 1] = g / n; col[k + 2] = b / n; col[k + 3] = Math.round(255 * n / Math.max(1, tot)); }
      }
    }
    this.colors = col;
  }
  colorAt(layers, i) {
    const col = this.colors;
    let r = 20, g = 22, b = 26;
    for (const L of layers) {
      const gid = L.data[i]; if (!gid) continue;
      const k = gid * 4; if (k + 3 >= col.length) continue;
      const a = col[k + 3] / 255;
      r = r * (1 - a) + col[k] * a; g = g * (1 - a) + col[k + 1] * a; b = b * (1 - a) + col[k + 2] * a;
    }
    return [r, g, b];
  }

  buildOverview() {
    const m = this.map; if (!m) return;
    const max = 2048;
    const k = Math.max(1, Math.max(m.width, m.height) / max);
    const ow = Math.max(1, Math.round(m.width / k)), oh = Math.max(1, Math.round(m.height / k));
    const img = new ImageData(ow, oh), p = img.data;
    const layers = this.tileLayers();
    for (let y = 0; y < oh; y++) {
      const ty = Math.min(m.height - 1, Math.floor((y + 0.5) * m.height / oh));
      for (let x = 0; x < ow; x++) {
        const tx = Math.min(m.width - 1, Math.floor((x + 0.5) * m.width / ow));
        const [r, g, b] = this.colorAt(layers, ty * m.width + tx);
        const o = (y * ow + x) * 4; p[o] = r; p[o + 1] = g; p[o + 2] = b; p[o + 3] = 255;
      }
    }
    const cv = new OffscreenCanvas(ow, oh);
    cv.getContext('2d').putImageData(img, 0, 0);
    this.overview = cv;
    this.request();
  }

  invalidate(x0, y0, x1, y1) {
    const cx0 = Math.floor(x0 / C), cy0 = Math.floor(y0 / C), cx1 = Math.floor(x1 / C), cy1 = Math.floor(y1 / C);
    for (const store of [this.cache, this.ovCache]) {
      for (const [k, e] of store) {
        if (e.cx >= cx0 && e.cx <= cx1 && e.cy >= cy0 && e.cy <= cy1) { store.delete(k); if (store === this.cache) this.cachePx -= e.px; }
      }
    }
    this.request();
  }
  invalidateAll() { this.clearCaches(); this.request(); }
  setTint(t) { this.tint = t; this.ovCache.clear(); this.request(); }

  request() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.draw(); });
  }

  tileLayers() { return this.map.layers.filter((l) => l.visible); }
  layerAlpha(L) {
    if (!this.dimOthers || !this.activeLayer) return 1;
    const isGround = L === this.map.ground, isItems = L === this.map.items;
    if (this.activeLayer === 'ground') return isGround ? 1 : 0.35;
    if (this.activeLayer === 'items') return isItems ? 1 : 0.4;
    if (this.activeLayer === 'units') return 0.45;
    return 1;
  }

  renderTexChunk(cx, cy, s) {
    const m = this.map, tw = m.tw, th = m.th, W = m.width, H = m.height;
    const nx = Math.min(C, W - cx * C), ny = Math.min(C, H - cy * C);
    const pw = Math.ceil(nx * tw * s), ph = Math.ceil(ny * th * s);
    const cv = new OffscreenCanvas(Math.max(1, pw), Math.max(1, ph));
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = s < 1;
    const dw = tw * s, dh = th * s;
    for (const L of this.tileLayers()) {
      c.globalAlpha = this.layerAlpha(L);
      const d = L.data;
      for (let y = 0; y < ny; y++) {
        const row = (cy * C + y) * W + cx * C;
        for (let x = 0; x < nx; x++) {
          const i = row + x;
          const gid = d[i];
          if (!gid) continue;
          const ts = m.tilesetOf(gid);
          const dx = x * dw;
          if (!ts || !ts.image) {
            if (ts) { const [pr, pg, pb] = placeholderRGB(ts.name || ts.imageSource || ts.source, gid - ts.firstgid); c.fillStyle = `rgb(${pr},${pg},${pb})`; }
            else c.fillStyle = '#ff00ff';
            c.fillRect(dx, y * dh, dw, dh); continue;
          }
          const id = gid - ts.firstgid;
          const sx = (id % ts.columns) * ts.tw, sy = Math.floor(id / ts.columns) * ts.th;
          const w = ts.tw * s, h = ts.th * s;
          const dy = (y + 1) * dh - h;
          const f = L.flips.size ? L.flips.get(i) : 0;
          if (f) {
            c.save();
            c.translate(dx + w / 2, dy + h / 2);
            if (f & 4) c.scale(-1, 1);
            if (f & 2) c.scale(1, -1);
            if (f & 1) { c.rotate(Math.PI / 2); c.scale(1, -1); }
            c.drawImage(ts.image, sx, sy, ts.tw, ts.th, -w / 2, -h / 2, w, h);
            c.restore();
          } else c.drawImage(ts.image, sx, sy, ts.tw, ts.th, dx, dy, w, h);
        }
      }
    }
    c.globalAlpha = 1;
    return { cv, px: pw * ph };
  }

  renderColorChunk(cx, cy) {
    const m = this.map, W = m.width, H = m.height;
    const nx = Math.min(C, W - cx * C), ny = Math.min(C, H - cy * C);
    const img = new ImageData(nx, ny);
    const p = img.data;
    const layers = this.tileLayers();
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const [r, g, b] = this.colorAt(layers, (cy * C + y) * W + cx * C + x);
      const o = (y * nx + x) * 4; p[o] = r; p[o + 1] = g; p[o + 2] = b; p[o + 3] = 255;
    }
    const cv = new OffscreenCanvas(nx, ny);
    cv.getContext('2d').putImageData(img, 0, 0);
    return { cv, px: nx * ny };
  }

  renderTintChunk(cx, cy) {
    const m = this.map, W = m.width, H = m.height;
    const nx = Math.min(C, W - cx * C), ny = Math.min(C, H - cy * C);
    const img = new ImageData(nx, ny);
    const u32 = new Uint32Array(img.data.buffer);
    const fn = this.tint.fn;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) u32[y * nx + x] = fn((cy * C + y) * W + cx * C + x);
    const cv = new OffscreenCanvas(nx, ny);
    cv.getContext('2d').putImageData(img, 0, 0);
    return { cv, px: nx * ny, cx, cy };
  }

  getChunk(level, cx, cy, build) {
    const key = level + ':' + cx + ',' + cy;
    let e = this.cache.get(key);
    if (e) { this.cache.delete(key); this.cache.set(key, e); return e; }
    if (!build) return null;
    const r = level === 'c' ? this.renderColorChunk(cx, cy) : this.renderTexChunk(cx, cy, level);
    e = { cv: r.cv, px: r.px, cx, cy };
    this.cache.set(key, e); this.cachePx += r.px;
    while (this.cachePx > this.budgetPx && this.cache.size > 1) {
      const [k0, e0] = this.cache.entries().next().value;
      this.cache.delete(k0); this.cachePx -= e0.px;
    }
    return e;
  }

  draw() {
    const ctx = this.ctx, m = this.map, v = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#101216';
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!m) return;
    const tw = m.tw, th = m.th;
    const tileScreen = tw * v.z;
    let level;
    if (tileScreen < 5) level = 'c';
    else { level = 1; while (level / 2 >= v.z && level > 0.25) level /= 2; }
    const x0 = Math.max(0, Math.floor(v.ox / tw / C)), y0 = Math.max(0, Math.floor(v.oy / th / C));
    const x1 = Math.min(Math.ceil(m.width / C) - 1, Math.floor((v.ox + this.cw / v.z) / tw / C));
    const y1 = Math.min(Math.ceil(m.height / C) - 1, Math.floor((v.oy + this.ch / v.z) / th / C));
    const t0 = performance.now();
    let missing = false;
    const mapW = m.width * tw * v.z;
    const p0 = this.toScreen(0, 0);
    const useOverview = this.overview && mapW <= this.overview.width * 1.05;
    if (this.overview) {
      ctx.imageSmoothingEnabled = mapW < this.overview.width;
      ctx.drawImage(this.overview, p0.x, p0.y, mapW, m.height * th * v.z);
    }
    if (!useOverview) {
      const list = [];
      const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) list.push([cx, cy, Math.abs(cx - cxm) + Math.abs(cy - cym)]);
      list.sort((a, b) => a[2] - b[2]);
      // 可见块太多时临时放宽缓存，避免同一帧里互相挤掉
      const per = level === 'c' ? C * C : (C * tw * level) ** 2;
      this.budgetPx = Math.max(24e6, list.length * per * 1.2);
      for (const [cx, cy] of list) {
        const e = this.getChunk(level, cx, cy, performance.now() - t0 < 14);
        if (!e) { missing = true; continue; }
        const sx = (cx * C * tw - v.ox) * v.z, sy = (cy * C * th - v.oy) * v.z;
        const nx = Math.min(C, m.width - cx * C), ny = Math.min(C, m.height - cy * C);
        ctx.imageSmoothingEnabled = level !== 'c' && v.z < level;
        ctx.drawImage(e.cv, sx, sy, nx * tw * v.z, ny * th * v.z);
      }
    }
    // 叠加层
    if (this.tint) {
      ctx.globalAlpha = this.tint.opacity ?? 1;
      ctx.imageSmoothingEnabled = false;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const key = cx + ',' + cy;
        let e = this.ovCache.get(key);
        if (!e) { if (performance.now() - t0 > 40) { missing = true; continue; } e = this.renderTintChunk(cx, cy); this.ovCache.set(key, e); }
        const sx = (cx * C * tw - v.ox) * v.z, sy = (cy * C * th - v.oy) * v.z;
        ctx.drawImage(e.cv, sx, sy, e.cv.width * tw * v.z, e.cv.height * th * v.z);
      }
      ctx.globalAlpha = 1;
    }
    if (this.reference && this.reference.img && this.reference.visible !== false) {
      const r = this.reference;
      const a = this.toScreen(r.x, r.y);
      ctx.globalAlpha = r.opacity ?? 0.5;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(r.img, a.x, a.y, r.w * v.z, r.h * v.z);
      ctx.globalAlpha = 1;
    }
    this.drawFrame(tileScreen);
    if (missing) this.request();
  }

  drawFrame(tileScreen) {
    const ctx = this.ctx, m = this.map;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    const tl = this.toScreen(0, 0), br = this.toScreen(m.width * m.tw, m.height * m.th);
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    if (this.showGrid && tileScreen >= 14) this.drawGrid();
    this.drawPools(tileScreen);
    this.drawObjects(tileScreen);
    if (this.overlay) this.overlay(ctx);
    if (this.onDraw) this.onDraw();
  }

  drawGrid() {
    const ctx = this.ctx, m = this.map, v = this.view;
    const tw = m.tw, th = m.th;
    const gx0 = Math.max(0, Math.floor(v.ox / tw)), gy0 = Math.max(0, Math.floor(v.oy / th));
    const gx1 = Math.min(m.width, Math.ceil((v.ox + this.cw / v.z) / tw));
    const gy1 = Math.min(m.height, Math.ceil((v.oy + this.ch / v.z) / th));
    ctx.beginPath();
    for (let x = gx0; x <= gx1; x++) { const s = (x * tw - v.ox) * v.z; ctx.moveTo(s, (gy0 * th - v.oy) * v.z); ctx.lineTo(s, (gy1 * th - v.oy) * v.z); }
    for (let y = gy0; y <= gy1; y++) { const s = (y * th - v.oy) * v.z; ctx.moveTo((gx0 * tw - v.ox) * v.z, s); ctx.lineTo((gx1 * tw - v.ox) * v.z, s); }
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawPools(tileScreen) {
    if (!this.pools || tileScreen >= 16) return;
    const ctx = this.ctx, m = this.map;
    const r = Math.max(2.5, Math.min(7, tileScreen * 1.5));
    ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#3b2a00'; ctx.lineWidth = 1;
    for (const [x, y] of this.pools) {
      const s = this.toScreen((x + 0.5) * m.tw, (y + 0.5) * m.th);
      if (s.x < -10 || s.y < -10 || s.x > this.cw + 10 || s.y > this.ch + 10) continue;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill(); if (r > 3) ctx.stroke();
    }
  }

  drawObjects(tileScreen) {
    const ctx = this.ctx, m = this.map, v = this.view;
    const sel = this.ed.selected;
    const small = tileScreen < 6;
    for (const G of m.groups) {
      if (!G.visible) continue;
      const isTrig = G.name.toLowerCase() === 'triggers';
      if (isTrig && !this.ed.showTriggers) { if (v.z > 0.08) this.drawMapTexts(G, 0.75); continue; }
      // 同一位置的多个区域（模板常见）只画一次，标上数量
      const same = new Map();
      for (const o of G.objects) if (!o.attrs.gid) { const k = `${o.attrs.x},${o.attrs.y},${o.attrs.width},${o.attrs.height}`; const e = same.get(k); if (e) e.n++; else same.set(k, { first: o, n: 1 }); }
      for (const o of G.objects) {
        const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0);
        const w = +(o.attrs.width || 0), h = +(o.attrs.height || 0);
        const gid = o.attrs.gid ? (+o.attrs.gid & 0x1fffffff) : 0;
        if (gid) {
          const unit = objProp(o, 'unit') || '';
          if (small && unit !== 'commandCenter' && o !== sel) continue;
          const s = this.toScreen(x, y - h);
          const sw = Math.max(w * v.z, 3), sh = Math.max(h * v.z, 3);
          if (s.x > this.cw + 20 || s.y > this.ch + 20 || s.x + sw < -20 || s.y + sh < -20) continue;
          const ts = m.tilesetOf(gid);
          if (!small && ts && ts.image) {
            const id = gid - ts.firstgid;
            ctx.drawImage(ts.image, (id % ts.columns) * ts.tw, Math.floor(id / ts.columns) * ts.th, ts.tw, ts.th, s.x, s.y, sw, sh);
          }
          const team = objProp(o, 'team');
          if (unit === 'commandCenter') {
            const r = Math.max(5, Math.min(14, sw * 0.5));
            ctx.beginPath(); ctx.arc(s.x + sw / 2, s.y + sh / 2, r, 0, Math.PI * 2);
            ctx.fillStyle = teamColor(team); ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
            if (r >= 6) {
              ctx.fillStyle = teamTextColor(team);
              const label = team === undefined ? '?' : (+team >= 0 ? String(+team + 1) : 'N');
              ctx.font = `bold ${Math.round(r * (label.length > 2 ? 0.8 : 1.05))}px system-ui, sans-serif`;
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText(label, s.x + sw / 2, s.y + sh / 2 + 1);
            }
          } else if (small) {
            ctx.fillStyle = teamColor(team); ctx.fillRect(s.x, s.y, 3, 3);
          }
          if (o === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.strokeRect(s.x - 3, s.y - 3, sw + 6, sh + 6); ctx.setLineDash([]); }
        } else {
          const grp = same.get(`${o.attrs.x},${o.attrs.y},${o.attrs.width},${o.attrs.height}`);
          if (grp.first !== o && o !== sel) continue;
          const s = this.toScreen(x, y);
          const sw = Math.max(w * v.z, 8), sh = Math.max(h * v.z, 8);
          if (s.x > this.cw + 20 || s.y > this.ch + 20 || s.x + sw < -20 || s.y + sh < -40) continue;
          const kind = o.attrs.type || '';
          const color = (o.attrs.name || '').toLowerCase() === 'map_info' ? '255,200,0' : this.ed.triggerColor ? this.ed.triggerColor(o) : '120,200,255';
          ctx.fillStyle = `rgba(${color},0.12)`; ctx.fillRect(s.x, s.y, sw, sh);
          ctx.strokeStyle = o === sel ? '#fff' : `rgba(${color},0.95)`;
          ctx.lineWidth = o === sel ? 2 : 1.5;
          ctx.strokeRect(s.x, s.y, sw, sh);
          ctx.fillStyle = `rgba(${color},1)`;
          ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          if (kind === 'mapText') {
            const pr = (n) => (o.props.find((q) => q.name === n) || {}).value;
            const txt = pr('text');
            if (txt && v.z > 0.08) {
              const fs = Math.max(8, (+pr('textSize') || 20) * v.z);
              ctx.font = `bold ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              const cx = s.x + sw / 2, cy = s.y + sh / 2;
              ctx.lineWidth = Math.max(2, fs / 6); ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(txt, cx, cy);
              ctx.fillStyle = pr('textColor') || '#fff'; ctx.fillText(txt, cx, cy);
              if (pr('style') === 'arrow') { ctx.beginPath(); ctx.moveTo(cx - fs / 3, cy + fs * 0.7); ctx.lineTo(cx + fs / 3, cy + fs * 0.7); ctx.lineTo(cx, cy + fs * 1.2); ctx.closePath(); ctx.fill(); }
              ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
            }
          }
          if (o !== sel && (grp.first !== o || (sw < 26 && v.z < 0.3))) continue;
          const T = window.__rwT || String; const nm = (o.attrs.name || T(kind || '对象')) + (grp.n > 1 && o !== sel ? T(`  等 ${grp.n} 个`) : '');
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(nm, s.x, s.y - 2);
          ctx.fillText(nm, s.x, s.y - 2);
        }
      }
    }
  }
}

Renderer.prototype.drawMapTexts = function (G, alpha) {
  const ctx = this.ctx, v = this.view;
  ctx.globalAlpha = alpha;
  for (const o of G.objects) {
    if ((o.attrs.type || '').toLowerCase() !== 'maptext') continue;
    const pr = (n) => (o.props.find((q) => q.name === n) || {}).value;
    const txt = pr('text'); if (!txt || pr('activatedBy')) continue;
    const s = this.toScreen(+(o.attrs.x || 0) + +(o.attrs.width || 0) / 2, +(o.attrs.y || 0) + +(o.attrs.height || 0) / 2);
    if (s.x < -200 || s.y < -50 || s.x > this.cw + 200 || s.y > this.ch + 50) continue;
    const fs = Math.max(8, (+pr('textSize') || 20) * v.z);
    ctx.font = `bold ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, fs / 6); ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(txt, s.x, s.y);
    ctx.fillStyle = pr('textColor') || '#fff'; ctx.fillText(txt, s.x, s.y);
  }
  ctx.globalAlpha = 1;
};

// 小地图
export class Minimap {
  constructor(canvas, rend) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.r = rend;
    this.img = null; this.timer = 0;
  }
  rebuild() {
    const m = this.r.map; if (!m) return;
    const max = 180;
    const k = Math.max(m.width, m.height) / max;
    const mw = Math.max(1, Math.round(m.width / k)), mh = Math.max(1, Math.round(m.height / k));
    this.cv.width = mw; this.cv.height = mh;
    const img = new ImageData(mw, mh), p = img.data;
    const layers = this.r.tileLayers();
    for (let y = 0; y < mh; y++) {
      const ty = Math.min(m.height - 1, Math.floor((y + 0.5) * m.height / mh));
      for (let x = 0; x < mw; x++) {
        const tx = Math.min(m.width - 1, Math.floor((x + 0.5) * m.width / mw));
        const [r, g, b] = this.r.colorAt(layers, ty * m.width + tx);
        const o = (y * mw + x) * 4; p[o] = r; p[o + 1] = g; p[o + 2] = b; p[o + 3] = 255;
      }
    }
    this.img = img;
    this.r.buildOverview();
    this.r.pools = this.r.ed.poolTiles();
    this.draw();
  }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.rebuild(), 450); }
  draw() {
    const m = this.r.map; if (!m || !this.img) return;
    const c = this.ctx;
    c.putImageData(this.img, 0, 0);
    const sx = this.cv.width / (m.width * m.tw), sy = this.cv.height / (m.height * m.th);
    c.fillStyle = '#ffd34d';
    for (const [x, y] of this.r.pools) c.fillRect((x + 0.5) * m.tw * sx - 1, (y + 0.5) * m.th * sy - 1, 2, 2);
    for (const s of this.r.ed.spawns()) {
      c.fillStyle = teamColor(s.team);
      c.fillRect(s.cx * sx - 2.5, s.cy * sy - 2.5, 5, 5);
    }
    const v = this.r.view;
    c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.strokeRect(v.ox * sx, v.oy * sy, this.r.cw / v.z * sx, this.r.ch / v.z * sy);
  }
}
