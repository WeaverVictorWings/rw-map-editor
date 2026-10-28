// 自动备份：定时把当前地图存一份，崩了/刷新了能捞回来
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast, confirmBox, slider, promptBox } from './ui.js';
import { kvGet, kvSet, kvDel } from './util.js';
import { serializeOnce, loadMapFromText } from './io.js';
import { saveFile } from './files.js';

Object.assign(HELP, {
  'tool.backup': { t: '自动备份', s: '定时存一份，崩了能捞回来', b: '每 N 分钟把当前地图悄悄存一份到浏览器里，最多留 5 份。不小心刷新了页面、软件崩了、忘了保存最后一步，都能在这里找回来。<b>只存地图本身，不存撤销历史</b>；地图超过 2.4MB 会自动跳过（浏览器存不下）。' },
});

const ed = A.ed;
// 多份历史备份，存在 IndexedDB（不限 2.4MB）。目录：kv 'bkList' = [{t,name,reason,note,size,w,h}]，正文：kv 'bk:<t>'
const LIST = 'bkList', BK = (t) => 'bk:' + t;
const TOTAL_CAP = 200e6;
let timer = 0, lastSnap = 0, busyNow = false;

export async function listBackups() { return ((await kvGet(LIST)) || []).sort((a, b) => b.t - a.t); }
async function trim(list) {
  const maxN = Math.max(1, A.settings.backupKeep || 8);
  list.sort((a, b) => b.t - a.t);
  let total = 0; const keep = [];
  for (const e of list) { total += e.size; if (keep.length < maxN && (total < TOTAL_CAP || !keep.length)) keep.push(e); else await kvDel(BK(e.t)); }
  return keep;
}
export async function backupNow(reason = '手动', note = '') {
  if (!ed.map || busyNow) return null;
  busyNow = true;
  try {
    let txt = '';
    try { txt = await serializeOnce(); } catch (e) { return null; }
    if (typeof txt !== 'string' || !txt) return null;
    let t = Date.now();
    const list = (await kvGet(LIST)) || [];
    const exist = new Set(list.map((x) => x.t));
    while (exist.has(t)) t++;
    if (!(await kvSet(BK(t), txt))) { toast('备份失败：本机存储可能已满。可以在“自检面板”里清理'); return null; }
    list.push({ t, name: A.mapName || '未命名', reason, note, size: txt.length, w: ed.map.width, h: ed.map.height });
    await kvSet(LIST, await trim(list));
    lastSnap = t;
    return t;
  } finally { busyNow = false; }
}
export async function noteBackup() {
  if (!ed.map) return;
  const note = await promptBox('给这一版写个备注', '备注', '', '会和一份备份一起保存，之后在“自动备份”列表里能看到。');
  if (note === null || note === undefined) return;
  if (await backupNow('备注', note)) toast('已存一份带备注的备份');
}
// 保存前把“磁盘上原来的那份文件”留下来（相当于 .bak），出了错能退回上一版
export async function saveBak(name, text) {
  if (typeof text !== 'string' || !text) return;
  await kvSet('bak:' + name, { text, time: Date.now(), name });
}
export async function getBak(name) { return kvGet('bak:' + name); }

export function startAutoBackup(minutes = 5) {
  stopAutoBackup();
  if (!minutes) return;
  timer = setInterval(() => {
    if (!ed.map || !ed.dirty || (A.lastEditTime || 0) <= lastSnap) return;
    const big = ed.map.width * ed.map.height > 2e6;
    if (Date.now() - lastSnap < minutes * 60e3 * (big ? 3 : 1)) return;
    backupNow('自动').catch(() => {});
  }, 30e3);
  if (!startAutoBackup.hooked) {
    startAutoBackup.hooked = true;
    document.addEventListener('visibilitychange', () => { if (document.hidden && ed.map && ed.dirty && (A.lastEditTime || 0) > lastSnap && Date.now() - lastSnap > 60e3) backupNow('切到后台').catch(() => {}); });
  }
}
export function stopAutoBackup() { if (timer) { clearInterval(timer); timer = 0; } }

const fmt = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export async function backupDialog() {
  const body = h('div', {});
  const draw = async () => {
    body.replaceChildren();
    const l = await listBackups(), bak = A.mapName ? await getBak(A.mapName) : null;
    body.append(h('div', { class: 'hint' }, `每 ${A.settings.backupMin ?? 5} 分钟（改过地图才存）、切到后台、保存前各存一份，最多留 ${A.settings.backupKeep || 8} 份。存的是地图本身，不含撤销历史。`));
    body.append(slider('自动备份间隔（分钟，0=关闭）', 0, 30, A.settings.backupMin ?? 5, (v) => { A.settings.backupMin = v; import('./dialogs.js').then((D) => D.saveSettings()); startAutoBackup(v); }));
    body.append(slider('最多保留几份', 2, 20, A.settings.backupKeep || 8, (v) => { A.settings.backupKeep = v; import('./dialogs.js').then((D) => D.saveSettings()); }));
    const restore = async (txt, name) => {
      if (!(await confirmBox('恢复这份备份？', '当前没保存的改动会被替换掉（建议先点“现在存一份”）。', '恢复', '取消'))) return;
      try { await loadMapFromText(txt, name + '.tmx'); ed.dirty = true; toast('已恢复备份'); A.refresh(); } catch (e) { toast('恢复失败：' + e.message); }
    };
    const rows = [];
    if (bak) rows.push(h('div', { class: 'hrow' }, h('span', { class: 'hstat' }, fmt(bak.time)), h('span', {}, bak.name), h('span', { class: 'hint' }, `上一版文件 · ${(bak.text.length / 1024).toFixed(0)}KB`), h('button', { class: 'ib', onclick: () => restore(bak.text, bak.name) }, '恢复')));
    for (const e of l) rows.push(h('div', { class: 'hrow' }, h('span', { class: 'hstat' }, fmt(e.t)), h('span', { translate: 'no' }, e.name), h('span', { class: 'hint' }, `${e.reason}${e.note ? ' · ' + e.note : ''} · ${e.w}×${e.h} · ${(e.size / 1024).toFixed(0)}KB`),
      h('button', { class: 'ib', onclick: async () => restore(await kvGet(BK(e.t)), e.name) }, '恢复'),
      h('button', { class: 'ib', onclick: async () => { const txt = await kvGet(BK(e.t)); if (txt) await saveFile(e.name + '-' + fmt(e.t).replace(/[\/: ]/g, '') + '.tmx', txt, 'application/octet-stream'); } }, '导出'),
      h('button', { class: 'ib', onclick: async () => { await kvDel(BK(e.t)); await kvSet(LIST, l.filter((x) => x.t !== e.t)); draw(); } }, '删除')));
    body.append(rows.length ? h('div', {}, ...rows) : h('div', { class: 'hint' }, '还没有备份。改动地图后会自动存，也可以点下面的“现在存一份”。'));
  };
  await draw();
  return modal('自动备份', body, [
    { label: '现在存一份', check: async () => { const ok = await backupNow('手动'); toast(ok ? '已存一份备份' : '没存成'); draw(); return false; } },
    { label: '写备注并存一份', check: async () => { await noteBackup(); draw(); return false; } },
    { label: '删除全部', check: async () => { if (await confirmBox('删除全部备份？', '不能恢复。', '删除', '取消', true)) { for (const e of await listBackups()) await kvDel(BK(e.t)); await kvSet(LIST, []); draw(); } return false; } },
    { label: '关闭', value: 0, primary: true },
  ], { wide: true });
}
export async function backupStats() { const l = await listBackups(); return { n: l.length, bytes: l.reduce((a, e) => a + e.size, 0) }; }
