// 印章与风格分享码增强：
//  - RWS2-/RWS3-：一组印章打包成一个码（老 RWS1-/RWS0- 仍可解，导入时自动识别）
//  - RWD2-/RWD3-：整套细节预设（含名字）打包成一个码（老的 RWD1- 仍可解）
import { A } from './state.js';
import { h, modal, toast, confirmBox, promptBox } from './ui.js';
import { bytesToB64, b64ToBytes, deflate, inflate } from './util.js';
import { userStamps, saveUserStamp } from './stamps.js';
import { decodeStamp } from './share.js';
import { HELP, helpBtn } from './help.js';

const enc = new TextEncoder(), dec = new TextDecoder();
export const STAMP_BUNDLE_PREFIX = 'RWS';
export const STYLE_BUNDLE_PREFIX = 'RWD';

function toUrl(b64) { return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromUrl(s) { let t = s.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return t; }

async function deflateBytes(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try { return await deflate(bytes, 'deflate'); } catch (e) { return null; }
}
async function inflateBytes(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('这个浏览器解不开压缩过的分享码，请升级浏览器');
  return inflate(bytes, 'deflate');
}

function stampName(s) { return String(s && (s.cn || s.name) || '印章'); }
function stampClip(s) { return (s && (s.clip || (s.w && s.h ? s : null))) || null; }

// ---------------- 一组印章 ----------------
export async function encodeStamps(stamps) {
  const list = (Array.isArray(stamps) ? stamps : []).map((s) => ({ name: stampName(s), clip: stampClip(s) }))
    .filter((s) => s.clip && Number(s.clip.w) > 0 && Number(s.clip.h) > 0);
  if (!list.length) throw new Error('没有可分享的印章');
  const json = JSON.stringify({ v: 2, stamps: list });
  const bin = enc.encode(json);
  const z = await deflateBytes(bin);
  return (z ? STAMP_BUNDLE_PREFIX + '2-' : STAMP_BUNDLE_PREFIX + '3-') + toUrl(bytesToB64(z || bin));
}

export async function decodeStamps(code) {
  const s = String(code || '').trim();
  const m = new RegExp('^' + STAMP_BUNDLE_PREFIX + '([23])-([A-Za-z0-9_-]+)$').exec(s);
  if (m) {
    let bin = b64ToBytes(fromUrl(m[2]));
    if (m[1] === '2') bin = await inflateBytes(bin);
    let obj;
    try { obj = JSON.parse(dec.decode(bin)); } catch (e) { throw new Error('印章包内容坏了，解不开'); }
    if (!obj || !Array.isArray(obj.stamps) || !obj.stamps.length) throw new Error('印章包里没有印章');
    return obj.stamps.map((st, i) => {
      if (!st || !st.clip || !(Number(st.clip.w) > 0) || !(Number(st.clip.h) > 0)) throw new Error(`第 ${i + 1} 个印章数据不完整`);
      return { name: String(st.name || `印章 ${i + 1}`), clip: st.clip };
    });
  }
  // 老码：单个印章 RWS1-/RWS0-
  const one = await decodeStamp(s);
  return [one];
}

// ---------------- 整套细节预设 ----------------
export async function encodeStyleBundle(preset) {
  const p = preset && preset.stack ? preset : { name: '分享的风格', stack: preset };
  if (!Array.isArray(p.stack) || !p.stack.length) throw new Error('这套风格是空的');
  const json = JSON.stringify({ v: 2, name: String(p.cn || p.name || '分享的风格'), stack: p.stack });
  const bin = enc.encode(json);
  const z = await deflateBytes(bin);
  return (z ? STYLE_BUNDLE_PREFIX + '2-' : STYLE_BUNDLE_PREFIX + '3-') + toUrl(bytesToB64(z || bin));
}

export async function decodeStyleBundle(code) {
  const s = String(code || '').trim();
  const m = new RegExp('^' + STYLE_BUNDLE_PREFIX + '([23])-([A-Za-z0-9_-]+)$').exec(s);
  if (m) {
    let bin = b64ToBytes(fromUrl(m[2]));
    if (m[1] === '2') bin = await inflateBytes(bin);
    let obj;
    try { obj = JSON.parse(dec.decode(bin)); } catch (e) { throw new Error('风格包内容坏了，解不开'); }
    if (!obj || !Array.isArray(obj.stack) || !obj.stack.length) throw new Error('风格包里没有修改器');
    return { name: String(obj.name || '分享的风格'), stack: obj.stack };
  }
  // 老码：RWD1- 只有 stack
  const detail = await import('./detail.js');
  return { name: '分享的风格', stack: detail.decodePreset(s) };
}

// ---------------- 对话框 ----------------
function guessName(clip) {
  const g = clip && clip.ground ? clip.ground : null;
  return g ? '印章 ' + Math.random().toString(36).slice(2, 5) : '印章';
}

export async function stampShareDialog() {
  const stamps = await userStamps().catch(() => []);
  const detail = await import('./detail.js');
  const presets = [...detail.STYLE_PRESETS, ...(await detail.userPresets().catch(() => [])).map((p) => ({ ...p, cn: '★ ' + p.cn }))];

  const picked = new Set(stamps.map((s) => s.id));
  const outI = h('textarea', { rows: 4, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px' });
  const info = h('span', { class: 'hint' });
  const listEl = h('div', {});
  const inI = h('textarea', { rows: 4, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px', placeholder: '粘贴一组印章分享码（RWS2- 或老的 RWS1-），也可以一次粘多行' });

  const renderList = () => {
    listEl.replaceChildren();
    if (!stamps.length) { listEl.append(h('div', { class: 'hint' }, '本机还没有存印章。先在“印章”面板里存几个。')); return; }
    for (const s of stamps) {
      const cb = h('input', { type: 'checkbox', checked: picked.has(s.id), onchange: (e) => { if (e.target.checked) picked.add(s.id); else picked.delete(s.id); } });
      listEl.append(h('label', { class: 'row', style: 'gap:8px;padding:4px 0;align-items:center;border-bottom:1px solid var(--line)' },
        cb, h('span', { style: 'flex:1' }, s.cn), h('span', { class: 'hint' }, `${s.clip ? s.clip.w + '×' + s.clip.h : '?'} 格`)));
    }
  };

  const gen = async () => {
    try {
      const sel = stamps.filter((s) => picked.has(s.id));
      if (!sel.length) { toast('先勾选至少一个印章'); return; }
      const code = await encodeStamps(sel);
      outI.value = code;
      info.textContent = `已打包 ${sel.length} 个印章，${code.length} 个字符（${(new Blob([code]).size / 1024).toFixed(1)} KB）`;
      toast(`已生成 ${sel.length} 个印章的分享码`);
    } catch (e) { toast('生成失败：' + e.message, 3500); }
  };

  const importOne = async (code) => {
    const list = await decodeStamps(code);
    for (const st of list) {
      const name = st.name && !/^印章 /.test(st.name) ? st.name : await promptBox('导入印章', '给这个印章起个名字', st.name || guessName(st.clip));
      if (!name) continue;
      await saveUserStamp(name, st.clip);
    }
    return list.length;
  };

  const styleSel = h('select', {}, ...presets.map((p, i) => h('option', { value: String(i) }, p.cn)));
  const styleOut = h('textarea', { rows: 3, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px' });
  const styleIn = h('textarea', { rows: 3, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px', placeholder: '粘贴风格分享码（RWD2- 或老的 RWD1-）' });

  const copy = async (text) => {
    if (!text) { toast('先点生成'); return; }
    try { await navigator.clipboard.writeText(text); toast('已复制'); } catch (e) {
      outI.select && outI.select(); toast('复制失败，请手动选中复制', 3000);
    }
  };

  renderList();
  const body = h('div', {},
    h('p', { style: 'margin:0' }, '把一组印章或一整套细节风格压成一段码，发群里别人粘贴就能一次导入。老的 RWS1-/RWD1- 码仍然能解。'),
    h('h3', { style: 'font-size:14px;margin:12px 0 6px' }, '① 一组印章'),
    listEl,
    h('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap' },
      h('button', { class: 'primary', onclick: gen }, '生成分享码'),
      h('button', { onclick: () => copy(outI.value) }, '复制'),
      h('button', { onclick: () => { picked.clear(); for (const s of stamps) picked.add(s.id); renderList(); } }, '全选'),
      h('button', { onclick: () => { picked.clear(); renderList(); } }, '全不选'),
      info),
    outI,
    h('h3', { style: 'font-size:14px;margin:12px 0 6px' }, '② 导入一组印章'),
    inI,
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'primary', onclick: async () => {
        const codes = String(inI.value || '').split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean);
        if (!codes.length) { toast('先粘贴分享码'); return; }
        let total = 0;
        for (const c of codes) {
          try { total += await importOne(c); } catch (e) { toast('导入失败：' + e.message, 3500); }
        }
        if (total) {
          toast(`已导入 ${total} 个印章`);
          A.dockTab = 'stamps'; A.refresh('dock');
        }
      } }, '导入印章')),
    h('h3', { style: 'font-size:14px;margin:14px 0 6px' }, '③ 一整套细节风格'),
    h('div', { class: 'row', style: 'margin-bottom:6px' }, styleSel,
      h('button', { class: 'primary', onclick: async () => {
        try {
          const p = presets[+styleSel.value];
          styleOut.value = await encodeStyleBundle(p);
          toast('风格包分享码已生成');
        } catch (e) { toast('生成失败：' + e.message, 3500); }
      } }, '生成风格码'),
      h('button', { onclick: () => copy(styleOut.value) }, '复制')),
    styleOut,
    styleIn,
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'primary', onclick: async () => {
        try {
          const b = await decodeStyleBundle(styleIn.value);
          const name = await promptBox('导入整套风格', '给这套风格起个名字（会出现在“自动丰富细节”的预设里）', b.name);
          if (!name) return;
          await detail.saveUserPreset(name, b.stack);
          toast(`已导入风格「${name}」（${b.stack.length} 个修改器）`);
          A.refresh('dock');
        } catch (e) { toast('导入失败：' + e.message, 3500); }
      } }, '导入整套风格'))
  );

  await modal('印章包 / 风格包', body, [{ label: '关闭', primary: true, value: 'ok' }], { wide: true });
  return { stamps: stamps.length };
}

Object.assign(HELP, {
  'tool.stampstyle': {
    t: '印章包 / 风格包',
    s: '一组印章或整套细节风格压成一个码',
    b: '把好几个印章一次打包成一段分享码，对方粘一次就能全导入；整套“自动丰富细节”的修改器也能打成 RWD2- 风格包。老的单个印章码 RWS1- 和风格码 RWD1- 还能照常解。',
    tips: ['码以大号前缀区分：RWS2-/RWS3- 是印章包，RWD2-/RWD3- 是风格包。', '导入时一次可以粘多行码。'],
  },
});
