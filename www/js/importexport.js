// 设置与预置的导入导出：把印章、细节预设、快捷键、界面设置打包成一个文件，换设备或发给朋友
// 注意和工作文件（.rwproj）的区别：这里只带走“你自己的习惯和素材”，不带走地图
import { A } from './state.js';
import { h, modal, toast, busy } from './ui.js';
import { kvGet, kvSet } from './util.js';
import { HELP } from './help.js';

const FORMAT = 'rw-prefs';
const VERSION = 1;

// 要导出的键：都是“换设备还想带着”的东西
export const PREF_KEYS = [
  { key: 'settings', cn: '界面设置', desc: '网格、单位大小、主题这些' },
  { key: 'stamps', cn: '印章库', desc: '你自己存的印章（分享码形式）' },
  { key: 'detailPresets', cn: '细节预设', desc: '自动丰富细节里自己调的预设' },
  { key: 'quickbar', cn: '快捷工具栏', desc: '你配置的常用按钮' },
  { key: 'gameDir', cn: '游戏地图路径', desc: '保存到游戏文件夹用的路径' },
  { key: 'lessonsDone', cn: '教程进度', desc: '学过哪几课' },
];

export async function exportPrefs(keys = null) {
  const use = keys ? PREF_KEYS.filter((k) => keys.includes(k.key)) : PREF_KEYS;
  const data = {};
  for (const k of use) {
    const v = await kvGet(k.key);
    if (v !== null && v !== undefined) data[k.key] = v;
  }
  return { format: FORMAT, version: VERSION, app: 'rw-map-editor', created: Date.now(), data };
}

export async function importPrefs(obj, opts = {}) {
  if (!obj || obj.format !== FORMAT) throw new Error('不是设置文件（缺少 rw-prefs 标记）');
  const data = obj.data || {};
  let n = 0;
  for (const k of PREF_KEYS) {
    if (!(k.key in data)) continue;
    // 默认只补没有的键，避免把现在的设置冲掉；opts.overwrite=true 才整体覆盖
    if (!opts.overwrite && (await kvGet(k.key)) !== null) continue;
    await kvSet(k.key, data[k.key]);
    n++;
  }
  if ('settings' in data && A.settings) Object.assign(A.settings, data.settings);
  return n;
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function importexportDialog() {
  const st = { keys: PREF_KEYS.map((k) => k.key), overwrite: false };
  const body = h('div', {});
  body.append(h('div', { style: 'font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:10px' },
    '把你自己调好的习惯和素材带走（不含地图本身）。在新设备上导入后，印章、预设、设置都回来了。'));

  const list = h('div', {});
  for (const k of PREF_KEYS) {
    const row = h('label', { class: 'row', style: 'gap:8px;align-items:flex-start;margin:6px 0;font-size:13px' });
    const chk = h('input', {
      type: 'checkbox',
      onchange: (e) => {
        if (e.target.checked) st.keys.push(k.key);
        else st.keys = st.keys.filter((x) => x !== k.key);
      },
    });
    chk.checked = true;
    const d = h('div', {});
    d.append(h('div', { style: 'font-weight:600' }, k.cn), h('div', { style: 'font-size:11px;color:var(--muted)' }, k.desc));
    row.append(chk, d);
    list.append(row);
  }
  body.append(list);

  const ow = h('label', { class: 'row', style: 'gap:6px;font-size:13px;align-items:center;margin-top:12px' });
  const owChk = h('input', { type: 'checkbox', onchange: (e) => { st.overwrite = e.target.checked; } });
  ow.append(owChk, h('span', {}, '导入时覆盖现有设置（不勾则只补空缺的）'));
  body.append(ow);

  const file = h('input', {
    type: 'file', accept: '.json,application/json', style: 'display:none',
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const n = await importPrefs(JSON.parse(txt), { overwrite: st.overwrite });
        toast(n ? `已导入 ${n} 项设置` : '没有需要导入的（都已存在，或文件是空的）');
      } catch (err) {
        toast('导入失败：' + err.message);
      }
      e.target.value = '';
    },
  });
  body.append(file);

  const doExport = async () => {
    if (!st.keys.length) { toast('至少勾一项'); return false; }
    const obj = await exportPrefs(st.keys);
    const n = Object.keys(obj.data).length;
    download('rw-map-editor-设置.json', JSON.stringify(obj, null, 1));
    toast(`已导出 ${n} 项`);
    return false;
  };

  return modal('设置与预置：导入 / 导出', body, [
    { label: '导入…', value: 'in', check: () => { file.click(); return false; } },
    { label: '关闭', value: 0 },
    { label: '导出', value: 'out', primary: true, check: doExport },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.importexport': {
    t: '设置与预置导入导出',
    s: '把印章、预设、设置打包带走',
    b: '菜单「文件」→「设置与预置：导入 / 导出…」。勾选要带走的项目导出成一个 .json，在新设备上导入就行。只带习惯和素材，不带地图——要连地图一起走，用「文件 → 工程文件」。',
    tips: ['导入默认只补空缺的项，不会冲掉你在新设备上已经调好的东西；想整体覆盖就勾上那个选项。', '印章里可能含有你地图的图块，发给别人前确认一下。'],
  },
});
