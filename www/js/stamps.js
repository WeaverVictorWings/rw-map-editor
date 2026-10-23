// 印章库：内置常用组合 + 用户自己保存的选区
import { NONE } from './terrain.js';
import { kvGet, kvSet, b64ToBytes, bytesToB64 } from './util.js';

function blankClip(ed, w, h) {
  return { w, h, names: ed.engine ? ed.engine.names.slice() : [], V: new Uint8Array((w + 1) * (h + 1)).fill(NONE), ground: new Uint32Array(w * h), items: new Uint32Array(w * h), mask: null, objects: [] };
}
const T = (ed, ...names) => {
  if (!ed.engine) return -1;
  for (const n of names) { const t = ed.engine.index(n); if (t >= 0 && ed.engine.paintable.includes(t)) return t; }
  return -1;
};
function ellipse(clip, cx, cy, rx, ry, t, noise = 0, seed = 1) {
  if (t < 0) return;
  const W1 = clip.w + 1;
  for (let y = 0; y <= clip.h; y++) for (let x = 0; x <= clip.w; x++) {
    let r = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (noise) r += noise * (Math.sin(x * 1.7 + seed) * Math.cos(y * 1.3 + seed * 2) * 0.5);
    if (r <= 1) clip.V[y * W1 + x] = t;
  }
}
function rect(clip, x0, y0, x1, y1, t) {
  if (t < 0) return;
  const W1 = clip.w + 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) clip.V[y * W1 + x] = t;
}
function pool(ed, clip, cx, cy) {
  const it = ed.items.find((i) => i.pool); if (!it) return;
  for (const [dx, dy, g] of ed.stampCells(it)) {
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x < clip.w && y < clip.h) clip.items[y * clip.w + x] = g;
  }
}
function base(ed, clip, cx, cy, team = 0) {
  const mk = (unit, x, y, w, h, rot) => ({ o: ed.makeUnit(unit, team, 0, 0, w, h, rot), group: 'UnitObjects', dx: x, dy: y });
  clip.objects.push(mk('commandCenter', cx, cy, 30, 30, '-90.0'), mk('builder', cx - 10, cy + 60, 20, 20, '90.0'), mk('builder', cx + 10, cy + 60, 20, 20, '90.0'));
}

export const BUILTIN = [
  { id: 'base2', cn: '标准基地', desc: '1 个指挥中心、2 个建造者和 2 个资源池，资源池离指挥中心约 7 格。放下后队伍号自动排。',
    make: (ed) => { const c = blankClip(ed, 17, 12); base(ed, c, 8.5 * 20, 4 * 20); pool(ed, c, 2, 8); pool(ed, c, 14, 8); return c; } },
  { id: 'base3', cn: '富饶基地', desc: '指挥中心周围 3 个资源池，适合资源多的大地图。',
    make: (ed) => { const c = blankClip(ed, 19, 15); base(ed, c, 9.5 * 20, 6 * 20); pool(ed, c, 2, 4); pool(ed, c, 16, 4); pool(ed, c, 9, 12); return c; } },
  { id: 'pools3', cn: '资源点', desc: '3 个资源池排成三角，适合放在地图中央当争夺点。',
    make: (ed) => { const c = blankClip(ed, 13, 11); pool(ed, c, 2, 8); pool(ed, c, 10, 8); pool(ed, c, 6, 2); return c; } },
  { id: 'lake', cn: '湖泊', desc: '一片椭圆形的水，边缘自动加沙滩和浅滩。',
    make: (ed) => { const c = blankClip(ed, 18, 13); ellipse(c, 9, 6.5, 8, 5.5, T(ed, 'Shallow Water', 'Water'), 0.3, 3); ellipse(c, 9, 6.5, 4, 2.5, T(ed, 'Water', 'Shallow Water')); return c; } },
  { id: 'island', cn: '海上资源岛', desc: '水中的小岛，上面有 2 个资源池，需要海军或运输机才能占。放在海里用。',
    make: (ed) => { const c = blankClip(ed, 24, 22); ellipse(c, 12, 11, 11.5, 10.5, T(ed, 'Shallow Water', 'Water')); ellipse(c, 12, 11, 7.5, 6.5, T(ed, 'Sand')); ellipse(c, 12, 11, 5, 4, T(ed, 'Grass', 'Sand')); pool(ed, c, 9, 11); pool(ed, c, 15, 11); return c; } },
  { id: 'expand', cn: '扩张点', desc: '2 个资源池，旁边一小片树林当掩体。放在出生点和中央之间。',
    make: (ed) => { const c = blankClip(ed, 16, 12); ellipse(c, 12.5, 3, 3.2, 2.6, T(ed, 'Tree'), 0.5, 2); pool(ed, c, 4, 7); pool(ed, c, 9, 8); return c; } },
  { id: 'richcenter', cn: '中央富矿区', desc: '5 个资源池排成十字，四周有碎石点缀。放在地图正中央当争夺焦点。',
    make: (ed) => { const c = blankClip(ed, 17, 17); const st = ed.items.find((i) => i.name === 'Stone'); pool(ed, c, 8, 8); pool(ed, c, 8, 3); pool(ed, c, 8, 13); pool(ed, c, 3, 8); pool(ed, c, 13, 8);
      if (st && !st.stamp) for (const [x, y] of [[4, 4], [12, 4], [4, 12], [12, 12], [6, 6], [10, 10], [6, 10], [10, 6]]) c.items[y * c.w + x] = st.variants[0]; return c; } },
  { id: 'choke', cn: '隘口防守点', desc: '两块悬崖夹出一条窄路，路口有一座中立炮塔。适合放在两队之间。',
    make: (ed) => { const c = blankClip(ed, 20, 14); const cl = T(ed, 'Dirt Cliff', 'Cliff'); ellipse(c, 3.5, 7, 4, 7, cl, 0.3, 4); ellipse(c, 16.5, 7, 4, 7, cl, 0.3, 6);
      const tur = ['c_turret_t1', 'turret'].find((u) => ed.unitNames.includes(u)); if (tur) c.objects.push({ o: ed.makeUnit(tur, -1, 0, 0, 20, 20, '0'), group: 'UnitObjects', dx: 10 * 20, dy: 7 * 20 }); return c; } },
  { id: 'bridgehead', cn: '桥头堡', desc: '河上的一段浅滩渡口，对岸有 1 个资源池和沙滩，守住它就能过河。竖着的河上用。',
    make: (ed) => { const c = blankClip(ed, 20, 14); rect(c, 0, 0, 7, 14, T(ed, 'Shallow Water', 'Water')); rect(c, 0, 5, 7, 9, T(ed, 'Water Bridge', 'Shallow Water')); ellipse(c, 11, 7, 3, 5, T(ed, 'Sand')); pool(ed, c, 14, 7); return c; } },
  { id: 'highfort', cn: '高地据点', desc: '悬崖围起来的高地，里面有 1 个资源池，只有一个入口。易守难攻。',
    make: (ed) => { const c = blankClip(ed, 18, 16); const cl = T(ed, 'Dirt Cliff', 'Cliff'); ellipse(c, 9, 8, 8.5, 7.5, cl); ellipse(c, 9, 8, 5, 4.2, T(ed, 'Dirt', 'Grass')); rect(c, 8, 11, 10, 16, T(ed, 'Dirt', 'Grass')); pool(ed, c, 9, 7); return c; } },
  { id: 'ford', cn: '浅滩通道', desc: '一条可以让陆军过河的浅滩，竖着放在河上。',
    make: (ed) => { const c = blankClip(ed, 5, 16); rect(c, 0, 0, 5, 16, T(ed, 'Water Bridge', 'Shallow Water')); return c; } },
  { id: 'forest', cn: '树林', desc: '一片不规则的树林，可以挡住视线和通行。',
    make: (ed) => { const c = blankClip(ed, 16, 13); ellipse(c, 8, 6.5, 7, 5.5, T(ed, 'Tree', 'Frozen Trees'), 0.6, 5); return c; } },
  { id: 'plateau', cn: '悬崖高地', desc: '悬崖围出的一块高地，留了缺口可以上下。',
    make: (ed) => { const c = blankClip(ed, 18, 16); const cl = T(ed, 'Dirt Cliff', 'Cliff'); ellipse(c, 9, 8, 8, 7, cl); rect(c, 7, 12, 11, 16, T(ed, 'Dirt', 'Grass')); return c; } },
  { id: 'lava', cn: '岩浆坑', desc: '一片岩浆，四周自动加悬崖边。单位都过不去。',
    make: (ed) => { const c = blankClip(ed, 16, 12); ellipse(c, 8, 6, 7, 5, T(ed, 'Dirt Cliff')); ellipse(c, 8, 6, 4, 2.5, T(ed, 'Lava')); return c; } },
  { id: 'icelake', cn: '冰湖', desc: '雪地里的冰湖。',
    make: (ed) => { const c = blankClip(ed, 16, 12); ellipse(c, 8, 6, 7, 5, T(ed, 'Ice')); ellipse(c, 8, 6, 4, 3, T(ed, 'Ice Lake')); return c; } },
];

export function builtinStamps(ed) {
  const out = [];
  for (const b of BUILTIN) {
    try {
      const clip = b.make(ed);
      const usesTerrain = clip.V.some((v) => v !== NONE);
      if (usesTerrain && !ed.engine) continue;
      if (!usesTerrain && !clip.objects.length && !clip.items.some((v) => v)) continue;
      out.push({ ...b, clip, builtin: true });
    } catch (e) { console.warn('印章生成失败', b.id, e); }
  }
  return out;
}

// ---- 用户印章（存在本机） ----
function serClip(c) {
  return { ...c, V: c.V ? bytesToB64(c.V) : null, ground: bytesToB64(new Uint8Array(c.ground.buffer)), items: bytesToB64(new Uint8Array(c.items.buffer)), mask: c.mask ? bytesToB64(c.mask) : null,
    objects: c.objects.map((e) => ({ ...e, o: { attrs: e.o.attrs, props: e.o.props } })) };
}
function deserClip(s) {
  const u32 = (b) => { const by = b64ToBytes(b); return new Uint32Array(by.buffer, by.byteOffset, by.byteLength / 4); };
  return { ...s, V: s.V ? b64ToBytes(s.V) : null, ground: u32(s.ground), items: u32(s.items), mask: s.mask ? b64ToBytes(s.mask) : null,
    objects: s.objects.map((e) => ({ ...e, o: { attrs: e.o.attrs, props: e.o.props, extra: [] } })) };
}
export async function userStamps() {
  const list = (await kvGet('stamps')) || [];
  return list.map((s) => ({ id: s.id, cn: s.name, desc: `${s.clip.w}×${s.clip.h} 格，${new Date(s.time).toLocaleDateString()} 保存`, clip: deserClip(s.clip), builtin: false }));
}
export async function saveUserStamp(name, clip) {
  const list = (await kvGet('stamps')) || [];
  list.unshift({ id: 'u' + Date.now(), name, time: Date.now(), clip: serClip(clip) });
  await kvSet('stamps', list.slice(0, 60));
}
export async function deleteUserStamp(id) {
  const list = (await kvGet('stamps')) || [];
  await kvSet('stamps', list.filter((s) => s.id !== id));
}
export function exportStamp(stamp) { return JSON.stringify({ rwStamp: 1, name: stamp.cn, clip: serClip(stamp.clip) }); }
export function importStampText(text) {
  const j = JSON.parse(text);
  if (!j.rwStamp) throw new Error('不是印章文件');
  return { name: j.name, clip: deserClip(j.clip) };
}

// 缩略图：用图块平均色画出地形，资源池黄点，出生点彩色圆
export function stampThumb(ed, rend, clip, size = 72) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#20242c'; x.fillRect(0, 0, size, size);
  const s = Math.min(size / clip.w, size / clip.h);
  const ox = (size - clip.w * s) / 2, oy = (size - clip.h * s) / 2;
  const eng = ed.engine, col = rend.colors;
  for (let y = 0; y < clip.h; y++) for (let xx = 0; xx < clip.w; xx++) {
    const v = clip.V ? clip.V[y * (clip.w + 1) + xx] : NONE;
    let rgb = null;
    if (v !== NONE && eng) {
      const t = eng.index(clip.names[v]);
      const g = t >= 0 ? eng.solidGid(t) : 0;
      if (g) rgb = [col[g * 4], col[g * 4 + 1], col[g * 4 + 2]];
    }
    x.fillStyle = rgb ? `rgb(${rgb})` : 'rgba(255,255,255,0.06)';
    x.fillRect(ox + xx * s, oy + y * s, Math.ceil(s), Math.ceil(s));
    const it = clip.items[y * clip.w + xx] & 0x1fffffff;
    if (it && ed.poolGids && ed.poolGids.has(it)) { x.fillStyle = '#ffd34d'; x.beginPath(); x.arc(ox + (xx + 0.5) * s, oy + (y + 0.5) * s, Math.max(2, s), 0, 7); x.fill(); }
    else if (it) { x.fillStyle = 'rgba(160,200,120,0.7)'; x.fillRect(ox + xx * s, oy + y * s, Math.ceil(s), Math.ceil(s)); }
  }
  for (const e of clip.objects) {
    if (!e.o.props.some((p) => p.name === 'unit' && p.value === 'commandCenter')) continue;
    x.fillStyle = '#36c25b'; x.strokeStyle = '#000';
    x.beginPath(); x.arc(ox + e.dx / 20 * s, oy + e.dy / 20 * s, Math.max(3, s * 1.4), 0, 7); x.fill(); x.stroke();
  }
  return c;
}
