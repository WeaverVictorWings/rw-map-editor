// 载入、保存、自动保存、最近打开、游戏文件夹、快照、导出
import { A } from './state.js';
import { RWMap, extractTemplate } from './tmx.js';
import { runChecks, renderPreview, renderPoster } from './check.js';
import { pickFile, saveFile, gameFolder, pickGameFolder, saveToGame, addRecent, recentText, listGameMaps, readGameMap, gameFolderSupported, isNative } from './files.js';
import { kvGet, kvSet, kvDel } from './util.js';
import { toast, busy, h, modal, confirmBox, promptBox, closeModal } from './ui.js';

const ed = A.ed, rend = A.rend;

export async function loadMapFromText(text, name, handle = null, opts = {}) {
  const map = await RWMap.parse(text, name);
  ed.setMap(map);
  rend.setMap(map);
  A.mini.rebuild();
  A.mapName = (name || '未命名').replace(/\.tmx$/i, '');
  A.fileHandle = handle; A.handleName = A.mapName;
  document.getElementById('welcome').classList.add('hidden');
  const tpl = extractTemplate(map);
  if (tpl && !(await kvGet('template'))) {
    await kvSet('template', { ...tpl, from: A.mapName, time: Date.now() });
    toast('已从这张地图取出图块素材，以后新建地图会用它');
  }
  if (!ed.engine) toast('这张地图的地面图块没有地形标注，自动过渡不可用，可以用“图块”模式直接画', 4200);
  A.refresh();
  if (!opts.noRecent) rememberRecent(text).catch(() => {});
  return map;
}

export async function openMap() {
  if (ed.dirty && !(await confirmBox('打开别的地图？', '当前地图还没保存，打开新地图会丢掉未保存的修改（自动保存的副本仍可恢复）。', '仍然打开'))) return;
  const r = await pickFile('.tmx');
  if (!r) return;
  try {
    await busy('正在读取地图…', async () => { await loadMapFromText(await r.file.text(), r.file.name, r.handle); });
    await kvDel('autosave');
  } catch (e) {
    console.error(e);
    modal('打不开这个文件', h('p', {}, e.message || String(e)), [{ label: '知道了', value: true, primary: true }]);
  }
}

export async function openRecent(entry) {
  const text = await recentText(entry.id);
  if (!text) { toast('这份记录已经过期了'); return; }
  await busy('正在打开…', () => loadMapFromText(text, entry.name + '.tmx', null, { noRecent: true }));
}

export async function openFromGame() {
  if (!gameFolderSupported()) { toast('这个设备不支持直接读取文件夹'); return; }
  if (!(await gameFolder())) { const ok = await chooseGameFolder(); if (!ok) return; }
  let files = [];
  try { files = await busy('正在读取文件夹…', () => listGameMaps()); } catch (e) { toast('读取失败：' + e.message); return; }
  if (!files.length) { toast('游戏文件夹里还没有 .tmx 地图'); return; }
  const list = h('div', { class: 'menulist' });
  for (const f of files.slice(0, 200)) {
    list.append(h('button', { class: 'mitem', onclick: async () => {
      closeModal();
      try { const text = await busy('正在打开…', () => readGameMap(f.name)); await busy('正在读取地图…', () => loadMapFromText(text, f.name)); A.fromGame = true; }
      catch (e) { modal('打不开这个文件', h('p', {}, e.message || String(e)), [{ label: '知道了', value: 1, primary: true }]); }
    } }, h('span', { class: 'ml' }, f.name), h('kbd', {}, f.size ? Math.round(f.size / 1024) + ' KB' : '')));
  }
  modal('从游戏文件夹打开', list, [{ label: '关闭', value: 0 }]);
}

async function thumbDataUrl(size = 128) {
  const cv = renderPreview(ed, rend, size);
  const blob = await cv.convertToBlob({ type: 'image/png' });
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
}
async function rememberRecent(text) {
  if (!ed.map) return;
  const m = ed.map;
  await addRecent({ name: A.mapName, w: m.width, h: m.height, teams: ed.usedTeams().size, thumb: await thumbDataUrl() }, text);
}

// ---- 序列化（同一时间只跑一个） ----
export function serializeOnce(opts = {}) {
  const run = async () => ed.map.serialize({ prune: opts.prune ?? (A.settings.prune || ed.pruneOnSave) });
  A.savePromise = (A.savePromise || Promise.resolve()).catch(() => {}).then(run);
  return A.savePromise;
}

async function confirmIssues() {
  const issues = runChecks(ed).filter((c) => c.level === 'error');
  if (!issues.length) return 'save';
  return modal('地图还有问题', h('div', {}, h('p', {}, `检查发现 ${issues.length} 个会影响游戏的问题：`),
    h('ul', {}, issues.slice(0, 6).map((i) => h('li', {}, i.title)))), [
    { label: '先去看看', value: 'check' }, { label: '仍然保存', value: 'save', primary: true }]);
}

export async function saveMap(saveAs = false) {
  if (!ed.map) return;
  const go = await confirmIssues();
  if (go === 'check') { A.hooks.openChecks && A.hooks.openChecks(); return; }
  if (go !== 'save') return;
  try {
    const text = await busy('正在生成地图文件…', () => serializeOnce());
    const handle = (!saveAs && A.handleName === A.mapName) ? A.fileHandle : null;
    const r = await saveFile(A.mapName + '.tmx', text, 'application/xml', handle);
    if (r.ok) {
      if (r.handle) { A.fileHandle = r.handle; A.handleName = A.mapName; }
      markSaved(text);
      toast(r.where + `：${A.mapName}.tmx`);
      A.hooks.coach && A.hooks.coach('saved');
    }
  } catch (e) {
    modal('保存失败', h('p', {}, e.message || String(e)), [{ label: '知道了', value: 1, primary: true }]);
  }
}

function markSaved(text) {
  ed.dirty = false; A.autoDirty = false;
  kvDel('autosave');
  rememberRecent(text).catch(() => {});
  A.refresh('top');
}

export async function chooseGameFolder() {
  const body = h('div', {},
    h('p', {}, '请选择游戏的地图文件夹。选一次以后，“保存到游戏”会把地图和预览图直接存进去。'),
    h('div', { class: 'hint', html: isNative()
      ? '手机上一般是 <b>内部存储 / rustedWarfare / maps</b>。在弹出的文件夹选择器里进入这个文件夹，点底部的“使用此文件夹”并允许访问。'
      : '电脑上一般在游戏安装目录下的 <b>mods/maps</b>（Steam 版可在库里右键游戏 → 管理 → 浏览本地文件找到）。' }));
  const ok = await modal('选择游戏地图文件夹', body, [{ label: '取消', value: false }, { label: '去选择', value: true, primary: true }]);
  if (!ok) return false;
  try { const r = await pickGameFolder(); if (r) { toast('已记住：' + r.name); A.refresh('top'); return true; } }
  catch (e) { if (!/cancel|abort/i.test(e.message || '')) toast('选择失败：' + (e.message || e)); }
  return false;
}

export async function saveToGameFlow() {
  if (!ed.map) return;
  if (!gameFolderSupported()) { toast('这个设备不支持直接写入文件夹，已改用普通保存'); return saveMap(); }
  if (!(await gameFolder())) { const ok = await chooseGameFolder(); if (!ok) return; }
  const go = await confirmIssues();
  if (go === 'check') { A.hooks.openChecks && A.hooks.openChecks(); return; }
  if (go !== 'save') return;
  try {
    const text = await busy('正在生成地图文件…', () => serializeOnce());
    const pv = renderPreview(ed, rend, 200);
    const png = new Uint8Array(await (await pv.convertToBlob({ type: 'image/png' })).arrayBuffer());
    const where = await busy('正在写入游戏文件夹…', () => saveToGame([
      { name: A.mapName + '.tmx', data: text, mime: 'application/octet-stream' },
      { name: A.mapName + '_map.png', data: png, mime: 'image/png' }]));
    markSaved(text);
    toast(`已存进「${where}」：${A.mapName}.tmx 和预览图。去游戏里用普通模式试玩吧`, 4200);
    A.hooks.coach && A.hooks.coach('saved');
  } catch (e) {
    const again = await modal('保存到游戏失败', h('div', {}, h('p', {}, e.message || String(e)), h('p', { class: 'hint' }, '可能是文件夹权限过期了。可以重新选择文件夹，或者改用普通保存。')),
      [{ label: '普通保存', value: 'save' }, { label: '重新选择文件夹', value: 'pick', primary: true }]);
    if (again === 'pick') { if (await chooseGameFolder()) return saveToGameFlow(); }
    else if (again === 'save') return saveMap();
  }
}

// ---- 自动保存 ----
export async function autosave(force = false) {
  if (!ed.map || (!A.autoDirty && !force) || (ed.op && !force)) return;
  try {
    const text = await serializeOnce();
    const ok = await kvSet('autosave', { name: A.mapName, text, time: Date.now() });
    if (ok) { A.autoDirty = false; A.lastAuto = Date.now(); A.refresh('top'); }
    else toast('自动保存失败：本机存储可能已满');
  } catch (e) { console.warn('自动保存失败', e); }
}

// ---- 快照（存在本机，可随时恢复整张图） ----
export async function snapshots() { return (await kvGet('snaps:' + A.mapName)) || []; }
export async function takeSnapshot() {
  const name = await promptBox('保存快照', '快照名称', new Date().toLocaleTimeString(), '快照保存整张地图，任何时候都能恢复到这个状态。每张地图最多保留 10 个。');
  if (!name) return;
  const text = await busy('正在保存快照…', () => serializeOnce());
  const list = await snapshots();
  list.unshift({ name, time: Date.now(), text });
  await kvSet('snaps:' + A.mapName, list.slice(0, 10));
  toast('快照已保存');
  A.refresh('dock');
}
export async function restoreSnapshot(s) {
  if (!(await confirmBox('恢复快照？', `恢复到「${s.name}」。当前的修改可以先存成另一个快照。恢复后撤销记录会清空。`, '恢复'))) return;
  const name = A.mapName;
  await busy('正在恢复…', () => loadMapFromText(s.text, name + '.tmx', A.fileHandle, { noRecent: true }));
  ed.dirty = true; A.autoDirty = true; A.refresh();
}
export async function deleteSnapshot(s) {
  const list = (await snapshots()).filter((x) => x.time !== s.time);
  await kvSet('snaps:' + A.mapName, list);
  A.refresh('dock');
}

// ---- 导出 ----
export async function exportPreview(size = 200) {
  const cvp = renderPreview(ed, rend, size);
  const blob = await cvp.convertToBlob({ type: 'image/png' });
  const r = await saveFile(A.mapName + '_map.png', new Uint8Array(await blob.arrayBuffer()), 'image/png');
  if (r.ok) toast(`预览图${r.where}：${A.mapName}_map.png`);
}
export async function exportPoster() {
  const cv = await busy('正在生成展示图…', () => renderPoster(ed, rend, A.mapName, 1400));
  const blob = await cv.convertToBlob({ type: 'image/png' });
  const r = await saveFile(A.mapName + '_展示图.png', new Uint8Array(await blob.arrayBuffer()), 'image/png');
  if (r.ok) toast('展示图' + r.where);
}
