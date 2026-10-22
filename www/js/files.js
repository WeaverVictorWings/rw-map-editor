// 打开 / 保存 / 游戏文件夹 / 最近打开
// 安卓：原生插件（系统“另存为”、授权一次的游戏文件夹）；电脑：文件系统接口；最后退回到浏览器下载
import { bytesToB64, b64ToBytes, kvGet, kvSet, kvDel } from './util.js';

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
function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}
// .tmx 用通用二进制类型，避免安卓给文件名补上 .xml
function mimeFor(name, mime) { return /\.tmx$/i.test(name) ? 'application/octet-stream' : (mime || 'application/octet-stream'); }

export async function pickFile(accept = '.tmx') {
  if (!isNative() && window.showOpenFilePicker && accept === '.tmx') {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: '铁锈战争地图', accept: { 'application/xml': ['.tmx'] } }] });
      return { file: await handle.getFile(), handle };
    } catch (e) { if (e && e.name === 'AbortError') return null; }
  }
  return new Promise((res) => {
    const el = input();
    el.value = '';
    el.accept = isNative() && accept === '.tmx' ? '' : accept;
    el.onchange = () => res(el.files && el.files[0] ? { file: el.files[0], handle: null } : null);
    el.click();
  });
}
export async function pickImage() { const r = await pickFile('image/*'); return r ? r.file : null; }

export async function saveFile(name, data, mime, handle = null) {
  const bytes = toBytes(data);
  const sf = nativePlugin('SaveFile');
  if (sf) {
    try {
      await sf.save({ name, mime: mimeFor(name, mime), data: bytesToB64(bytes) });
      return { ok: true, where: '已保存' };
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
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: name, accept: { [mime || 'application/octet-stream']: [ext] } }] });
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

// ---------------- 游戏文件夹 ----------------
// 返回 {name} 或 null
export async function gameFolder() {
  if (isNative()) { const t = await kvGet('gameTree'); return t ? { name: t.name } : null; }
  const h = await kvGet('gameDir');
  return h ? { name: h.name } : null;
}
export function gameFolderSupported() { return isNative() ? !!nativePlugin('SaveFile') : !!window.showDirectoryPicker; }

export async function pickGameFolder() {
  if (isNative()) {
    const sf = nativePlugin('SaveFile');
    const r = await sf.pickFolder();
    if (!r || !r.uri) return null;
    await kvSet('gameTree', { uri: r.uri, name: r.name || '地图文件夹' });
    return { name: r.name };
  }
  if (!window.showDirectoryPicker) throw new Error('这个浏览器不支持选择文件夹，请用“保存”。');
  const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'rwmaps' });
  await kvSet('gameDir', h);
  return { name: h.name };
}
export async function forgetGameFolder() { await kvDel('gameTree'); await kvDel('gameDir'); }

async function dirHandle() {
  const h = await kvGet('gameDir');
  if (!h) return null;
  if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('没有得到文件夹的写入权限');
  }
  return h;
}

// files: [{name, data, mime}]
export async function saveToGame(files) {
  if (isNative()) {
    const t = await kvGet('gameTree'); if (!t) throw new Error('还没有选择游戏地图文件夹');
    const sf = nativePlugin('SaveFile');
    for (const f of files) await sf.writeToFolder({ tree: t.uri, name: f.name, mime: mimeFor(f.name, f.mime), data: bytesToB64(toBytes(f.data)) });
    return t.name;
  }
  const h = await dirHandle(); if (!h) throw new Error('还没有选择游戏地图文件夹');
  for (const f of files) {
    const fh = await h.getFileHandle(f.name, { create: true });
    const w = await fh.createWritable(); await w.write(toBytes(f.data)); await w.close();
  }
  return h.name;
}
export async function listGameMaps() {
  if (isNative()) {
    const t = await kvGet('gameTree'); if (!t) return [];
    const r = await nativePlugin('SaveFile').listFolder({ tree: t.uri });
    return (r.files || []).filter((f) => /\.tmx$/i.test(f.name)).sort((a, b) => (b.modified || 0) - (a.modified || 0));
  }
  const h = await dirHandle(); if (!h) return [];
  const out = [];
  for await (const [name, fh] of h.entries()) {
    if (fh.kind !== 'file' || !/\.tmx$/i.test(name)) continue;
    const f = await fh.getFile(); out.push({ name, size: f.size, modified: f.lastModified });
  }
  return out.sort((a, b) => b.modified - a.modified);
}
export async function readGameMap(name) {
  if (isNative()) {
    const t = await kvGet('gameTree');
    const r = await nativePlugin('SaveFile').readFromFolder({ tree: t.uri, name });
    return new TextDecoder().decode(b64ToBytes(r.data));
  }
  const h = await dirHandle();
  const fh = await h.getFileHandle(name);
  return (await fh.getFile()).text();
}

// ---------------- 最近打开 ----------------
export async function addRecent(entry, text) {
  const list = (await kvGet('recent')) || [];
  const id = entry.id || ('r' + Date.now());
  const rest = list.filter((r) => r.name !== entry.name && r.id !== id);
  const next = [{ ...entry, id, time: Date.now() }, ...rest].slice(0, 8);
  await kvSet('recent', next);
  await kvSet('recentText:' + id, text);
  for (const r of list) if (!next.find((n) => n.id === r.id)) await kvDel('recentText:' + r.id);
  return id;
}
export async function listRecent() { return (await kvGet('recent')) || []; }
export async function recentText(id) { return kvGet('recentText:' + id); }
export async function removeRecent(id) {
  const list = (await kvGet('recent')) || [];
  await kvSet('recent', list.filter((r) => r.id !== id));
  await kvDel('recentText:' + id);
}
