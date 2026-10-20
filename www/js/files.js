// 打开 / 保存文件：安卓用原生“另存为”插件，电脑用文件系统接口，最后退回到浏览器下载
import { bytesToB64 } from './util.js';

const Cap = () => window.Capacitor;
export const isNative = () => !!(Cap() && Cap().isNativePlatform && Cap().isNativePlatform());

export function nativePlugin(name) {
  const C = Cap();
  if (!C || !isNative()) return null;
  if (C.Plugins && C.Plugins[name]) return C.Plugins[name];
  const reg = C.registerPlugin || (window.capacitorExports && window.capacitorExports.registerPlugin);
  return reg ? reg(name) : null;
}

const input = () => document.getElementById('fileIn');

// 选一个文件；返回 {file, handle}
export async function pickFile(accept = '.tmx') {
  if (!isNative() && window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: '铁锈战争地图', accept: { 'application/xml': ['.tmx'] } }],
        excludeAcceptAllOption: false,
      });
      return { file: await handle.getFile(), handle };
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
    }
  }
  return new Promise((res) => {
    const el = input();
    el.value = '';
    el.accept = isNative() ? '' : accept;
    el.onchange = () => res(el.files && el.files[0] ? { file: el.files[0], handle: null } : null);
    el.click();
  });
}

export async function pickImage() {
  return new Promise((res) => {
    const el = input();
    el.value = '';
    el.accept = 'image/*';
    el.onchange = () => res(el.files && el.files[0] ? el.files[0] : null);
    el.click();
  });
}

function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

// 保存；返回 {ok, handle?, where}
export async function saveFile(name, data, mime, handle = null) {
  const bytes = toBytes(data);
  const sf = nativePlugin('SaveFile');
  if (sf) {
    try {
      const r = await sf.save({ name, mime, data: bytesToB64(bytes) });
      return { ok: true, where: r && r.uri ? '已保存' : '已保存' };
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/cancel/i.test(msg)) return { ok: false, cancelled: true };
      throw new Error('保存失败：' + msg);
    }
  }
  if (handle && handle.createWritable) {
    try {
      const w = await handle.createWritable();
      await w.write(bytes); await w.close();
      return { ok: true, handle, where: '已覆盖保存到原文件' };
    } catch (e) { console.warn('原地保存失败，改用另存为', e); }
  }
  if (window.showSaveFilePicker && !isNative()) {
    try {
      const ext = name.slice(name.lastIndexOf('.'));
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: name, accept: { [mime]: [ext] } }] });
      const w = await h.createWritable();
      await w.write(bytes); await w.close();
      return { ok: true, handle: h, where: '已保存' };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, cancelled: true };
      console.warn('另存为失败，改用下载', e);
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { ok: true, where: '已下载到“下载”文件夹' };
}
