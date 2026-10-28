// 分享码：把印章压成一段短文本（RWS1-），风格预设复用 detail.js 的 RWD1-
// 目的：像随机生成的分享码一样，在群里发一段字就能互换印章和自动细节风格。
import { A } from './state.js';
import { h, modal, toast, segmented, promptBox, closeModal } from './ui.js';
import { bytesToB64, b64ToBytes, deflate, inflate } from './util.js';
import { saveUserStamp } from './stamps.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const STAMP_PREFIX = 'RWS';

// base64 → base64url（分享码里不能出现 + / =）
function toUrl(b64) { return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromUrl(s) { let t = s.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return t; }

// deflate 可能在新版本 WebView 才有；没有就退回不压缩（RWS0-）
async function maybeDeflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try { return await deflate(bytes, 'deflate'); } catch { return null; }
}
async function maybeInflate(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('这个浏览器太旧，解不开压缩过的分享码；请升级系统 WebView 或换个浏览器');
  return inflate(bytes, 'deflate');
}

// ---- 印章打包：把 clip 压成紧凑二进制（地形名字表 + V/ground/items + 单位对象） ----
class Writer {
  constructor() { this.parts = []; }
  u8(v) { this.parts.push(new Uint8Array([v & 255])); }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 65535); this.parts.push(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); this.parts.push(b); }
  raw(b) { if (b && b.length) this.parts.push(b); }
  str(s) { const b = enc.encode(String(s == null ? '' : s)); this.u16(b.length); this.raw(b); }
  out() {
    const n = this.parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}
const bytesOf = (a) => (a ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength) : new Uint8Array(0));

function packStamp(stamp) {
  const c = stamp.clip || {};
  const w = new Writer();
  w.u8(1);
  w.u16(c.w | 0); w.u16(c.h | 0);
  w.u8((c.V ? 1 : 0) | (c.mask ? 2 : 0));
  w.str(stamp.name || stamp.cn || '印章');
  const names = c.names || [];
  w.u16(names.length);
  for (const n of names) w.str(n);
  const V = bytesOf(c.V), G = bytesOf(c.ground), I = bytesOf(c.items), M = bytesOf(c.mask);
  w.u32(V.length); w.raw(V);
  w.u32(G.length); w.raw(G);
  w.u32(I.length); w.raw(I);
  w.u32(M.length); w.raw(M);
  const objs = (c.objects || []).map((e) => ({ attrs: e.o && e.o.attrs, props: e.o && e.o.props, group: e.group, dx: e.dx, dy: e.dy }));
  const oj = enc.encode(JSON.stringify(objs));
  w.u32(oj.length); w.raw(oj);
  return w.out();
}

function unpackStamp(bin) {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  let p = 0;
  const u8 = () => bin[p++];
  const u16 = () => { const v = dv.getUint16(p); p += 2; return v; };
  const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
  const take = (n) => { const b = bin.subarray(p, p + n); p += n; return b; };
  const str = () => dec.decode(take(u16()));
  if (u8() !== 1) throw new Error('分享码版本不支持（请升级编辑器）');
  const w = u16(), h = u16();
  const flags = u8();
  const name = str();
  const names = [];
  for (let i = u16(); i > 0; i--) names.push(str());
  const rd = () => { const n = u32(); return n ? take(n) : null; };
  const Vb = rd(), Gb = rd(), Ib = rd(), Mb = rd();
  const objBytes = rd();
  const arr = (b, Ctor) => {
    if (!b || !b.length) return null;
    const copy = new Uint8Array(b.length); copy.set(b);   // 对齐后转成 Uint32Array
    return new Ctor(copy.buffer);
  };
  const clip = {
    w, h, names,
    V: (flags & 1) && Vb ? Uint8Array.from(Vb) : null,
    ground: arr(Gb, Uint32Array) || new Uint32Array(w * h),
    items: arr(Ib, Uint32Array) || new Uint32Array(w * h),
    mask: (flags & 2) && Mb ? Uint8Array.from(Mb) : null,
    objects: [],
  };
  if (objBytes && objBytes.length) {
    try { clip.objects = JSON.parse(dec.decode(objBytes)).map((e) => ({ group: e.group, dx: e.dx, dy: e.dy, o: { attrs: e.attrs, props: e.props, extra: [] } })); } catch { /* 坏数据就丢掉对象 */ }
  }
  return { name: name || '分享的印章', clip };
}

// 导出：印章 → RWS1-xxxx（大地形数据会自动压缩）
export async function encodeStamp(stamp) {
  const bin = packStamp(stamp);
  const z = await maybeDeflate(bin);
  return (z ? STAMP_PREFIX + '1-' : STAMP_PREFIX + '0-') + toUrl(bytesToB64(z || bin));
}
// 导入：RWS1-/RWS0- → {name, clip}
export async function decodeStamp(code) {
  const m = new RegExp('^' + STAMP_PREFIX + '([01])-([A-Za-z0-9_-]+)$').exec(String(code || '').trim());
  if (!m) throw new Error('不是印章分享码（应以 RWS1- 开头）');
  let bin = b64ToBytes(fromUrl(m[2]));
  if (m[1] === '1') bin = await maybeInflate(bin);
  return unpackStamp(bin);
}

// 复制到剪贴板（有些 WebView 没有 navigator.clipboard，退回选中文本复制）
export async function copyCode(code) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(code); return true; }
  } catch { /* 走兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    return true;
  } catch { return false; }
}

// ---- 分享码对话框：印章 / 风格 两个页签 ----
export async function shareCodeDialog(tab = 'stamp') {
  let cur = tab;
  const tabs = h('div', { style: 'margin: 4px 0 10px' });
  const pane = h('div');
  const body = h('div', {}, tabs, pane);

  const stampPane = () => {
    const ta = h('textarea', { rows: 4, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px', placeholder: '把印章分享码粘贴到这里，然后点“导入印章”' });
    return h('div', {},
      h('p', { style: 'margin:0 0 8px' }, '在“印章”面板里长按（电脑上右键）自己的印章 → “复制分享码”，把这段字发给朋友，他粘贴到这里就能导入。'),
      ta,
      h('button', { class: 'primary', style: 'margin-top:8px', onclick: async () => {
        try {
          const s = await decodeStamp(ta.value);
          await saveUserStamp(s.name, s.clip);
          toast(`已导入印章「${s.name}」（${s.clip.w}×${s.clip.h} 格）`);
          A.dockTab = 'stamps'; A.refresh('dock');
          closeModal(null);
        } catch (e) { toast('导入失败：' + e.message, 3500); }
      } }, '导入印章'));
  };

  const stylePane = async () => {
    const detail = await import('./detail.js');
    const ups = await detail.userPresets().catch(() => []);
    const list = [...detail.STYLE_PRESETS, ...ups.map((p) => ({ ...p, cn: '★ ' + p.cn }))];
    const ta = h('textarea', { rows: 4, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px', placeholder: '把风格分享码粘贴到这里，然后点“导入风格”' });
    const codeI = h('input', { readonly: true, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px' });
    let curStack = list[0] && list[0].stack;
    const show = () => { codeI.value = curStack ? detail.encodePreset(curStack) : ''; };
    const sel = h('select', { onchange: (e) => { const p = list.find((x) => String(x.id) === e.target.value); curStack = p && p.stack; show(); } });
    for (const p of list) sel.append(h('option', { value: p.id }, p.cn));
    show();
    return h('div', {},
      h('p', { style: 'margin:0 0 8px' }, '风格分享码 = 一组“自动丰富细节”的修改器。复制下面这段发给别人，或者在“自动丰富细节”里导入。'),
      h('label', {}, '选一个风格'),
      sel,
      h('div', { style: 'margin:8px 0' }, codeI),
      h('div', { class: 'row', style: 'margin-bottom:10px' },
        h('button', { onclick: async () => { if (curStack && await copyCode(detail.encodePreset(curStack))) toast('风格分享码已复制'); else toast('复制失败，请手动选中复制'); } }, '复制这个风格的分享码')),
      ta,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'primary', onclick: async () => {
          try {
            const stack = detail.decodePreset(ta.value);
            const name = await promptBox('导入风格', '给这个风格起个名字', '分享的风格');
            if (!name) return;
            await detail.saveUserPreset(name, stack);
            toast(`已导入风格「${name}」（${stack.length} 个修改器）`);
            A.refresh('dock');
            closeModal(null);
          } catch (e) { toast('导入失败：' + e.message, 3500); }
        } }, '导入风格')));
  };

  const draw = async () => {
    tabs.replaceChildren(segmented([['stamp', '印章'], ['style', '风格（自动细节）']], cur, (v) => { cur = v; draw(); }));
    pane.replaceChildren();
    pane.append(cur === 'stamp' ? stampPane() : await stylePane());
  };
  await draw();
  return modal('分享码', body, [{ label: '关闭', value: null }]);
}
