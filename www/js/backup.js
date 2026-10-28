// 自动备份：定时把当前地图存一份，崩了/刷新了能捞回来
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast, toggle, confirmBox } from './ui.js';
import { kvGet, kvSet, kvDel } from './util.js';
import { serializeOnce } from './io.js';

Object.assign(HELP, {
  'tool.backup': { t: '自动备份', s: '定时存一份，崩了能捞回来', b: '每 N 分钟把当前地图悄悄存一份到浏览器里，最多留 5 份。不小心刷新了页面、软件崩了、忘了保存最后一步，都能在这里找回来。<b>只存地图本身，不存撤销历史</b>；地图超过 2.4MB 会自动跳过（浏览器存不下）。' },
});

const ed = A.ed;
const KEY = 'rwBackupList';        // 备份目录：[[时间戳, 名字], ...]
const BKEY = (t) => 'rwBackup:' + t;
const MAXN = 5;

let timer = 0;
let lastSnap = 0;

function listBackups() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveList(l) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) { /* 满了就放弃 */ } }

export async function backupNow(reason = '手动') {
  if (!ed.map) return null;
  let txt = '';
  try { txt = await serializeOnce(); } catch (e) { return null; }
  if (typeof txt !== 'string' || !txt) return null;
  if (!txt) return null;
  // 太大就别存，localStorage 一般只有 5MB
  if (txt.length > 2.4e6) { toast('地图太大，自动备份存不下（超过 2.4MB）'); return null; }
  // 同一毫秒内连存两次会撞时间戳，往后顺延
  let t = Date.now();
  const exist = new Set(listBackups().map(([x]) => x));
  while (exist.has(t)) t++;
  try {
    localStorage.setItem(BKEY(t), JSON.stringify({ t, reason, name: A.mapName || '未命名', txt }));
  } catch (e) {
    // 空间不够就先删最老的
    const l = listBackups();
    if (l.length) { try { localStorage.removeItem(BKEY(l[0][0])); } catch (e2) { /* 忽略 */ } }
    try { localStorage.setItem(BKEY(t), JSON.stringify({ t, reason, name: A.mapName || '未命名', txt })); }
    catch (e3) { return null; }
  }
  const l = listBackups().filter(([tt]) => tt !== t);
  l.push([t, A.mapName || '未命名']);
  while (l.length > MAXN) { const old = l.shift(); try { localStorage.removeItem(BKEY(old[0])); } catch (e) { /* 忽略 */ } }
  saveList(l);
  lastSnap = t;
  return t;
}

export function startAutoBackup(minutes = 5) {
  stopAutoBackup();
  if (!minutes) return;
  const ms = minutes * 60 * 1000;
  timer = setInterval(() => {
    if (!ed.map || !ed.dirty) return;
    backupNow('自动').catch(() => {});
  }, ms);
}

export function stopAutoBackup() {
  if (timer) { clearInterval(timer); timer = 0; }
}

const fmt = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function backupDialog() {
  const l = listBackups().sort((a, b) => b[0] - a[0]);
  const rows = l.map(([t, name]) => {
    let info = null;
    try { info = JSON.parse(localStorage.getItem(BKEY(t))); } catch (e) { info = null; }
    return { t, name, info };
  }).filter((r) => r.info);
  const body = h('div', {},
    h('div', { class: 'hint' }, `每 ${(A.settings.backupMin || 0)} 分钟自动存一份，最多留 ${MAXN} 份。存的是地图本身，不含撤销历史。`),
    rows.length
      ? h('div', {}, ...rows.map((r) => h('div', { class: 'hrow' },
        h('span', { class: 'hstat' }, fmt(r.t)),
        h('span', {}, r.name),
        h('span', { class: 'hint' }, `${r.info.reason} · ${(r.info.txt.length / 1024).toFixed(0)}KB`),
        h('button', {
          class: 'ib', title: '恢复这一份',
          onclick: async () => {
            if (!(await confirmBox('恢复这份备份？', '当前没保存的改动会被替换掉。', '恢复', '取消'))) return;
            const done = A.loadMapFromText(r.info.txt, r.info.name + '.tmx');
            if (done !== false) { toast('已恢复备份'); A.refresh(); }
          },
        }, '恢复'))))
      : h('div', { class: 'hint' }, '还没有备份。开一会自动备份，或者点上面的"现在存一份"。'));
  return modal('自动备份', body, [
    { label: '现在存一份', value: 1 },
    { label: '关掉所有备份', value: 2 },
    { label: '关闭', value: 0, primary: true },
  ], { wide: true }).then(async (v) => {
    if (v === 1) { await backupNow('手动'); toast('已存一份备份'); }
    if (v === 2) {
      for (const [t] of listBackups()) { try { localStorage.removeItem(BKEY(t)); } catch (e) { /* 忽略 */ } }
      saveList([]);
      toast('备份都删掉了');
    }
  });
}
