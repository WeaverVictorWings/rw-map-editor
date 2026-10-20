// 分块渲染：64x64 格为一块，按缩放级别缓存；缩得很小时改用“每格一个像素”的颜色块
import { objProp } from './tmx.js';

const C = 64; // 每块格数
const TEAM_COLORS = ['#36c25b', '#e5484d', '#3e8ef7', '#f5c518', '#00bcd4', '#b36cf0', '#222', '#ffffff', '#ff8c1a', '#8bc34a'];
export function teamColor(t) {
  const n = +t;
  if (n < 0 || Number.isNaN(n)) return '#9aa0a6';
  return TEAM_COLORS[n % TEAM_COLORS.length];
}

export class Renderer {
  constructor(canvas, ed) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.ed = ed;
    this.map = null;
    this.view = { z: 1, ox: 0, oy: 0 };
    this.cache = new Map();
    this.cachePx = 0;
    this.budgetPx = 24e6;
    this.pending = false;
    this.overlay = null; // 由编辑器提供的覆盖层绘制函数
    this.showGrid = true;
    this.colors = null;
    this.resize();
  }

  setMap(map) {
    this.map = map;
    this.cache.clear(); this.cachePx = 0;
    this.overview = null;
    this.buildColors();
    this.buildOverview();
    this.pools = this.ed.poolTiles();
    this.fit();
  }

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
    const z = Math.min(this.cw / mw, this.ch / mh) * 0.95;
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

  toMap(sx, sy) { const v = this.view; return { x: v.ox + sx / v.z, y: v.oy + sy / v.z }; }
  toScreen(mx, my) { const v = this.view; return { x: (mx - v.ox) * v.z, y: (my - v.oy) * v.z }; }

  // 每个 gid 的平均颜色（rgb + 覆盖率）
  buildColors() {
    const m = this.map;
    const col = new Uint8Array((m.maxGid + 2) * 4);
    for (const ts of m.tilesets) {
      if (!ts.image || !ts.columns) continue;
      const oc = new OffscreenCanvas(ts.image.width, ts.image.height);
      const c = oc.getContext('2d', { willReadFrequently: true });
      c.drawImage(ts.image, 0, 0);
      const img = c.getImageData(0, 0, ts.image.width, ts.image.height).data;
      const iw = ts.image.width;
      for (let id = 0; id < ts.tilecount; id++) {
        const sx = (id % ts.columns) * ts.tw, sy = Math.floor(id / ts.columns) * ts.th;
        let r = 0, g = 0, b = 0, n = 0, tot = 0;
        for (let y = sy; y < sy + ts.th && y < ts.image.height; y += 2) {
          for (let x = sx; x < sx + ts.tw && x < iw; x += 2) {
            const p = (y * iw + x) * 4; tot++;
            if (img[p + 3] > 40) { r += img[p]; g += img[p + 1]; b += img[p + 2]; n++; }
          }
        }
        const k = (ts.firstgid + id) * 4;
        if (n) { col[k] = r / n; col[k + 1] = g / n; col[k + 2] = b / n; col[k + 3] = Math.round(255 * n / Math.max(1, tot)); }
      }
    }
    this.colors = col;
  }

  // 整图概览（最长边约 1024 像素），缩得很小时直接用它，块还没画好时垫在下面
  buildOverview() {
    const m = this.map; if (!m) return;
    const max = 1024;
    const k = Math.max(1, Math.max(m.width, m.height) / max);
    const ow = Math.max(1, Math.round(m.width / k)), oh = Math.max(1, Math.round(m.height / k));
    const img = new ImageData(ow, oh), p = img.data, col = this.colors;
    const layers = this.tileLayers();
    for (let y = 0; y < oh; y++) {
      const ty = Math.min(m.height - 1, Math.floor((y + 0.5) * m.height / oh));
      for (let x = 0; x < ow; x++) {
        const tx = Math.min(m.width - 1, Math.floor((x + 0.5) * m.width / ow));
        const i = ty * m.width + tx;
        let r = 20, g = 22, b = 26;
        for (const L of layers) {
          const gid = L.data[i]; if (!gid) continue;
          const kk = gid * 4, a = col[kk + 3] / 255;
          r = r * (1 - a) + col[kk] * a; g = g * (1 - a) + col[kk + 1] * a; b = b * (1 - a) + col[kk + 2] * a;
        }
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
    for (const [k, e] of this.cache) {
      if (e.cx >= cx0 && e.cx <= cx1 && e.cy >= cy0 && e.cy <= cy1) { this.cache.delete(k); this.cachePx -= e.px; }
    }
    this.request();
  }
  invalidateAll() { this.cache.clear(); this.cachePx = 0; this.request(); }

  request() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.draw(); });
  }

  tileLayers() { return this.map.layers.filter((l) => l.visible && !l.hiddenByEditor); }

  renderTexChunk(cx, cy, s) {
    const m = this.map, tw = m.tw, th = m.th;
    const W = m.width, H = m.height;
    const nx = Math.min(C, W - cx * C), ny = Math.min(C, H - cy * C);
    const pw = Math.ceil(nx * tw * s), ph = Math.ceil(ny * th * s);
    const cv = new OffscreenCanvas(Math.max(1, pw), Math.max(1, ph));
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = s < 1;
    const dw = tw * s, dh = th * s;
    for (const L of this.tileLayers()) {
      const d = L.data;
      for (let y = 0; y < ny; y++) {
        const row = (cy * C + y) * W + cx * C;
        for (let x = 0; x < nx; x++) {
          const i = row + x;
          const gid = d[i];
          if (!gid) continue;
          const ts = m.tilesetOf(gid);
          const dx = x * dw;
          if (!ts || !ts.image) { c.fillStyle = '#ff00ff'; c.fillRect(dx, y * dh, dw, dh); continue; }
          const id = gid - ts.firstgid;
          const sx = (id % ts.columns) * ts.tw, sy = Math.floor(id / ts.columns) * ts.th;
          const w = ts.tw * s, h = ts.th * s;
          const dy = (y + 1) * dh - h; // 大图块向上延伸（与 Tiled 一致）
          const f = L.flips.size ? L.flips.get(i) : 0;
          if (f) {
            c.save();
            c.translate(dx + w / 2, dy + h / 2);
            // Tiled 的顺序：先对角翻转，再水平、垂直（画布变换按相反顺序书写）
            if (f & 4) c.scale(-1, 1);
            if (f & 2) c.scale(1, -1);
            if (f & 1) { c.rotate(Math.PI / 2); c.scale(1, -1); }
            c.drawImage(ts.image, sx, sy, ts.tw, ts.th, -w / 2, -h / 2, w, h);
            c.restore();
          } else {
            c.drawImage(ts.image, sx, sy, ts.tw, ts.th, dx, dy, w, h);
          }
        }
      }
    }
    return { cv, px: pw * ph };
  }

  renderColorChunk(cx, cy) {
    const m = this.map, W = m.width, H = m.height;
    const nx = Math.min(C, W - cx * C), ny = Math.min(C, H - cy * C);
    const img = new ImageData(nx, ny);
    const p = img.data, col = this.colors;
    const layers = this.tileLayers();
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = (cy * C + y) * W + cx * C + x;
        let r = 20, g = 22, b = 26;
        for (const L of layers) {
          const gid = L.data[i];
          if (!gid) continue;
          const k = gid * 4;
          const a = col[k + 3] / 255;
          r = r * (1 - a) + col[k] * a; g = g * (1 - a) + col[k + 1] * a; b = b * (1 - a) + col[k + 2] * a;
        }
        const o = (y * nx + x) * 4;
        p[o] = r; p[o + 1] = g; p[o + 2] = b; p[o + 3] = 255;
      }
    }
    const cv = new OffscreenCanvas(nx, ny);
    cv.getContext('2d').putImageData(img, 0, 0);
    return { cv, px: nx * ny };
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
    ctx.fillStyle = '#121418';
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
    // 先铺整图概览：缩得够小时直接用它，否则作为底图
    const mapW = m.width * tw * v.z;
    if (this.overview) {
      const p0 = this.toScreen(0, 0);
      ctx.imageSmoothingEnabled = mapW < this.overview.width;
      ctx.drawImage(this.overview, p0.x, p0.y, mapW, m.height * th * v.z);
      if (mapW <= this.overview.width * 1.05) {
        this.drawFrame(tileScreen);
        return;
      }
    }
    ctx.imageSmoothingEnabled = level === 'c' ? false : v.z < level;
    // 由中心向外绘制，先出现视野中央
    const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
    const list = [];
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) list.push([cx, cy, Math.abs(cx - cxm) + Math.abs(cy - cym)]);
    list.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy] of list) {
      const build = performance.now() - t0 < 14;
      let e = this.getChunk(level, cx, cy, build);
      let isColor = level === 'c';
      if (!e) {
        missing = true;
        e = this.getChunk('c', cx, cy, performance.now() - t0 < 30);
        isColor = true;
        if (!e) continue;
      }
      const sx = (cx * C * tw - v.ox) * v.z, sy = (cy * C * th - v.oy) * v.z;
      const nx = Math.min(C, m.width - cx * C), ny = Math.min(C, m.height - cy * C);
      const prev = ctx.imageSmoothingEnabled;
      if (isColor) ctx.imageSmoothingEnabled = false;
      ctx.drawImage(e.cv, sx, sy, nx * tw * v.z, ny * th * v.z);
      ctx.imageSmoothingEnabled = prev;
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
    this.drawObjects();
    if (this.overlay) this.overlay(ctx);
    if (this.onDraw) this.onDraw();
  }

  // 资源池标记：缩小时图块太小看不清，用黄色圆点标出来
  drawPools(tileScreen) {
    if (!this.pools || tileScreen >= 16) return;
    const ctx = this.ctx, m = this.map;
    const r = Math.max(3, Math.min(7, tileScreen * 1.5));
    ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#3b2a00'; ctx.lineWidth = 1;
    for (const [x, y] of this.pools) {
      const s = this.toScreen((x + 0.5) * m.tw, (y + 0.5) * m.th);
      if (s.x < -10 || s.y < -10 || s.x > this.cw + 10 || s.y > this.ch + 10) continue;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
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

  drawObjects() {
    const ctx = this.ctx, m = this.map, v = this.view;
    const sel = this.ed.selected;
    for (const G of m.groups) {
      if (!G.visible) continue;
      const isTrig = G.name.toLowerCase() === 'triggers';
      if (isTrig && !this.ed.showTriggers) continue;
      for (const o of G.objects) {
        const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0);
        const w = +(o.attrs.width || 0), h = +(o.attrs.height || 0);
        const gid = o.attrs.gid ? (+o.attrs.gid & 0x1fffffff) : 0;
        if (gid) {
          const s = this.toScreen(x, y - h);
          const sw = Math.max(w * v.z, 3), sh = Math.max(h * v.z, 3);
          if (s.x > this.cw || s.y > this.ch || s.x + sw < 0 || s.y + sh < 0) continue;
          const ts = m.tilesetOf(gid);
          if (ts && ts.image && sw >= 6) {
            const id = gid - ts.firstgid;
            ctx.drawImage(ts.image, (id % ts.columns) * ts.tw, Math.floor(id / ts.columns) * ts.th, ts.tw, ts.th, s.x, s.y, sw, sh);
          }
          const team = objProp(o, 'team');
          const unit = objProp(o, 'unit') || '';
          if (unit === 'commandCenter' || sw < 6) {
            const r = Math.max(6, Math.min(14, sw * 0.5));
            ctx.beginPath(); ctx.arc(s.x + sw / 2, s.y + sh / 2, r, 0, Math.PI * 2);
            ctx.fillStyle = teamColor(team); ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
            if (unit === 'commandCenter' && r >= 6) {
              ctx.fillStyle = (+team === 6) ? '#fff' : '#000';
              ctx.font = `bold ${Math.round(r * 1.1)}px system-ui, sans-serif`;
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText(team === undefined ? '?' : (+team >= 0 ? String(+team + 1) : 'N'), s.x + sw / 2, s.y + sh / 2 + 1);
            }
          }
          if (o === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.strokeRect(s.x - 3, s.y - 3, sw + 6, sh + 6); ctx.setLineDash([]); }
        } else {
          const s = this.toScreen(x, y);
          const sw = Math.max(w * v.z, 8), sh = Math.max(h * v.z, 8);
          ctx.strokeStyle = o === sel ? '#fff' : 'rgba(255,200,0,0.9)';
          ctx.lineWidth = o === sel ? 2 : 1.5;
          ctx.strokeRect(s.x, s.y, sw, sh);
          ctx.fillStyle = 'rgba(255,200,0,0.95)';
          ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillText(o.attrs.name || o.attrs.type || '对象', s.x, s.y - 2);
        }
      }
    }
  }
}

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
    const img = new ImageData(mw, mh), p = img.data, col = this.r.colors;
    const layers = this.r.tileLayers();
    for (let y = 0; y < mh; y++) {
      const ty = Math.min(m.height - 1, Math.floor((y + 0.5) * m.height / mh));
      for (let x = 0; x < mw; x++) {
        const tx = Math.min(m.width - 1, Math.floor((x + 0.5) * m.width / mw));
        const i = ty * m.width + tx;
        let r = 20, g = 22, b = 26;
        for (const L of layers) {
          const gid = L.data[i]; if (!gid) continue;
          const kk = gid * 4, a = col[kk + 3] / 255;
          r = r * (1 - a) + col[kk] * a; g = g * (1 - a) + col[kk + 1] * a; b = b * (1 - a) + col[kk + 2] * a;
        }
        const o = (y * mw + x) * 4; p[o] = r; p[o + 1] = g; p[o + 2] = b; p[o + 3] = 255;
      }
    }
    this.img = img;
    this.r.buildOverview();
    this.r.pools = this.r.ed.poolTiles();
    this.draw();
  }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.rebuild(), 400); }
  draw() {
    const m = this.r.map; if (!m || !this.img) return;
    const c = this.ctx;
    c.putImageData(this.img, 0, 0);
    const sx = this.cv.width / (m.width * m.tw), sy = this.cv.height / (m.height * m.th);
    for (const G of m.groups) for (const o of G.objects) {
      if (objProp(o, 'unit') !== 'commandCenter') continue;
      c.fillStyle = teamColor(objProp(o, 'team'));
      c.fillRect(+o.attrs.x * sx - 2, (+o.attrs.y - 15) * sy - 2, 5, 5);
    }
    const v = this.r.view;
    c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.strokeRect(v.ox * sx, v.oy * sy, this.r.cw / v.z * sx, this.r.ch / v.z * sy);
  }
}
