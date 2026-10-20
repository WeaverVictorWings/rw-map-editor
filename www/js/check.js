// “能玩吗？”检查、资源分布报告、预览图
import { objProp } from './tmx.js';
import { teamColor } from './render.js';

export const MAP_TYPES = ['skirmish', 'mission', 'challenge', 'survival', 'endless'];

export function sizeTier(w, h) {
  const s = Math.max(w, h);
  if (s <= 500) return { level: 'ok', text: '小于等于 500：手机联机也比较安全' };
  if (s <= 1500) return { level: 'warn', text: '500–1500：建议在电脑上玩，手机可能卡顿' };
  if (s <= 4000) return { level: 'warn', text: '1500–4000：只建议 64 位电脑版，需要足够内存' };
  return { level: 'error', text: '超过 4000：仅供实验，没有找到能正常游玩的可靠证据' };
}

// 返回 [{level:'error'|'warn'|'ok'|'info', title, detail, goto?:{x,y}, fix?:{label, run}}]
export function runChecks(ed) {
  const m = ed.map, out = [];
  const add = (level, title, detail = '', extra = {}) => out.push({ level, title, detail, ...extra });

  if (m.tw !== 20 || m.th !== 20) add('error', '图块尺寸不是 20×20', `当前 ${m.tw}×${m.th}，游戏要求 20×20。`);

  // map_info
  const mi = ed.mapInfo();
  if (!mi) {
    add('error', '缺少 map_info', '游戏需要 Triggers 层里有一个 map_info 对象（type=skirmish），否则对局结束可能没有结算。',
      { fix: { label: '一键补上', run: () => ed.ensureMapInfo() } });
  } else {
    const t = objProp(mi, 'type');
    if (!t) add('error', 'map_info 没有 type 属性', '遭遇战地图应设为 skirmish。', { fix: { label: '设为 skirmish', run: () => ed.setMapInfoProp('type', 'skirmish') } });
    else if (!MAP_TYPES.includes(t)) add('warn', `map_info 的 type 是「${t}」`, '常见取值：' + MAP_TYPES.join(' / ') + '（社区整理，非官方完整列表）');
    else add('ok', `map_info 正常（type=${t}）`);
  }

  // 地面层
  const G = m.ground;
  if (!G) add('error', '没有 Ground 地面图层');
  else {
    let empty = 0, first = -1;
    const d = G.data;
    for (let i = 0; i < d.length; i++) if (!d[i]) { empty++; if (first < 0) first = i; }
    if (empty) {
      const counts = new Map();
      for (let i = 0; i < d.length; i += 97) if (d[i]) counts.set(d[i], (counts.get(d[i]) || 0) + 1);
      const fillGid = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      add('error', `地面有 ${empty.toLocaleString()} 个空格`, '游戏要求 Ground 层不能有空格。', {
        goto: { x: first % m.width, y: (first / m.width) | 0 },
        fix: fillGid ? { label: '用最常见的地面填满', run: () => {
          ed.begin('填满空格');
          for (let i = 0; i < d.length; i++) if (!d[i]) ed.op.tile(G, i, 0, 0, fillGid, 0);
          ed.commit();
        } } : null,
      });
    } else add('ok', '地面没有空格');
  }

  // 无效 gid
  for (const L of m.layers) {
    let bad = 0, first = -1;
    const d = L.data;
    for (let i = 0; i < d.length; i++) { const g = d[i]; if (g && !m.tilesetOf(g)) { bad++; if (first < 0) first = i; } }
    if (bad) add('error', `图层「${L.name}」有 ${bad.toLocaleString()} 个未定义图块`, '旧版本游戏遇到未定义图块会直接崩溃。', {
      goto: { x: first % m.width, y: (first / m.width) | 0 },
      fix: { label: '清除这些图块', run: () => {
        ed.begin('清除未定义图块');
        for (let i = 0; i < d.length; i++) if (d[i] && !m.tilesetOf(d[i])) ed.op.tile(L, i, d[i], L.flips.get(i) || 0, 0, 0);
        ed.commit();
      } },
    });
  }

  // 图块集
  for (const ts of m.tilesets) {
    if (ts.source) add('warn', `图块集「${ts.name || ts.source}」引用了外部文件`, '游戏和本编辑器都可能找不到它，建议用内嵌图片的图块集。');
    else if (!ts.embeddedPng) add('warn', `图块集「${ts.name}」没有内嵌图片`, '它引用的是外部图片「' + (ts.imageSource || '') + '」，换设备后可能显示不出来。');
  }
  const gts = ed.groundTs;
  if (gts) {
    const hasWaterTerrain = gts.terrainNames.some((n) => /water|lake/i.test(n));
    let waterProps = 0, badCase = 0;
    for (const [, inf] of gts.tiles) {
      for (const k of Object.keys(inf.props)) {
        if (k === 'water') waterProps++;
        if (k !== k.toLowerCase()) badCase++;
      }
    }
    if (hasWaterTerrain && !waterProps) add('error', '水面图块没有 water 属性', '没有这个属性，船不能在水上走，陆军反而能直接走过水面。');
    if (badCase) add('warn', `${badCase} 个图块属性名含大写字母`, '游戏只认小写属性名（例如 water，而不是 Water）。');
  }

  // 浮点属性
  let badFloat = 0;
  for (const g of m.groups) for (const o of g.objects) for (const p of o.props) if (p.type === 'float' && !Number.isFinite(parseFloat(p.value))) badFloat++;
  if (badFloat) add('error', `${badFloat} 个浮点属性的值不是数字`, '旧版本游戏遇到无效浮点属性会崩溃。');

  // 队伍
  const teams = new Map();
  let outside = 0;
  const pw = m.width * m.tw, ph = m.height * m.th;
  for (const g of m.groups) for (const o of g.objects) {
    const x = +(o.attrs.x || 0), y = +(o.attrs.y || 0);
    if (o.attrs.gid && (x < 0 || y < 0 || x > pw || y > ph)) outside++;
    if (objProp(o, 'unit') === 'commandCenter') {
      const t = +objProp(o, 'team');
      if (!teams.has(t)) teams.set(t, o);
    }
  }
  if (!teams.size) add('error', '没有任何出生点', '每支队伍至少需要一个指挥中心。到“单位”里点“出生点”添加。');
  else {
    const ids = [...teams.keys()].filter((t) => t >= 0).sort((a, b) => a - b);
    const gap = ids.some((t, i) => t !== i);
    add(gap ? 'warn' : 'ok', `${ids.length} 支队伍有出生点`, gap ? '队伍编号不连续：' + ids.map((t) => t + 1).join('、') + '（游戏里显示为第几队）' : '');
  }
  if (outside) add('warn', `${outside} 个单位在地图范围外`);

  // 资源池
  const pools = ed.poolTiles();
  if (!pools.length) add('warn', '地图上没有资源池', '到“物品”里选“资源池”放置。');
  else add('info', `共有 ${pools.length} 个资源池`);

  const tier = sizeTier(m.width, m.height);
  add(tier.level === 'ok' ? 'ok' : tier.level, `地图尺寸 ${m.width}×${m.height}`, tier.text);
  return out;
}

// 资源分布（直线距离，近似）
export function poolReport(ed, radius = 25) {
  const pools = ed.poolTiles();
  const rows = [];
  for (const g of ed.map.groups) for (const o of g.objects) {
    if (objProp(o, 'unit') !== 'commandCenter') continue;
    const tx = (+o.attrs.x + 15) / 20, ty = (+o.attrs.y - 15) / 20;
    let near = 0, nearest = Infinity;
    for (const [x, y] of pools) {
      const d = Math.hypot(x + 0.5 - tx, y + 0.5 - ty);
      if (d <= radius) near++;
      if (d < nearest) nearest = d;
    }
    rows.push({ team: +objProp(o, 'team'), near, nearest: Number.isFinite(nearest) ? Math.round(nearest) : null });
  }
  rows.sort((a, b) => a.team - b.team);
  return rows;
}

// 预览图（每格取平均色），最长边不超过 maxSide 像素
export function renderPreview(ed, rend, maxSide = 200) {
  const m = ed.map, col = rend.colors;
  const k = Math.max(m.width, m.height) / maxSide;
  const w = Math.max(1, Math.round(m.width / k)), h = Math.max(1, Math.round(m.height / k));
  const cv = new OffscreenCanvas(w, h);
  const c = cv.getContext('2d');
  const img = new ImageData(w, h), p = img.data;
  const layers = m.layers.filter((l) => l.visible);
  for (let y = 0; y < h; y++) {
    const ty0 = Math.floor(y * m.height / h), ty1 = Math.max(ty0 + 1, Math.floor((y + 1) * m.height / h));
    for (let x = 0; x < w; x++) {
      const tx0 = Math.floor(x * m.width / w), tx1 = Math.max(tx0 + 1, Math.floor((x + 1) * m.width / w));
      let R = 0, G = 0, B = 0, n = 0;
      const sy = Math.max(1, Math.floor((ty1 - ty0) / 4)), sx = Math.max(1, Math.floor((tx1 - tx0) / 4));
      for (let ty = ty0; ty < ty1; ty += sy) for (let tx = tx0; tx < tx1; tx += sx) {
        const i = ty * m.width + tx;
        let r = 20, g = 22, b = 26;
        for (const L of layers) {
          const gid = L.data[i]; if (!gid) continue;
          const kk = gid * 4, a = col[kk + 3] / 255;
          r = r * (1 - a) + col[kk] * a; g = g * (1 - a) + col[kk + 1] * a; b = b * (1 - a) + col[kk + 2] * a;
        }
        R += r; G += g; B += b; n++;
      }
      const o = (y * w + x) * 4; p[o] = R / n; p[o + 1] = G / n; p[o + 2] = B / n; p[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const sx = w / (m.width * m.tw), sy = h / (m.height * m.th);
  const r = Math.max(3, Math.round(Math.min(w, h) / 40));
  for (const g of m.groups) for (const o of g.objects) {
    if (objProp(o, 'unit') !== 'commandCenter') continue;
    const t = objProp(o, 'team');
    const x = (+o.attrs.x + 15) * sx, y = (+o.attrs.y - 15) * sy;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = teamColor(t); c.fill(); c.lineWidth = 1; c.strokeStyle = '#000'; c.stroke();
    if (r >= 5) {
      c.fillStyle = '#000'; c.font = `bold ${Math.round(r * 1.2)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(+t + 1), x, y + 0.5);
    }
  }
  return cv;
}
