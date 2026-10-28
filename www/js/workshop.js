// 工坊发布包：封面 + 简介 + 版本说明 + 地图本体，一键打成 zip
// 依赖：zip.js（写包）、check.js（封面渲染）、editorial.js（自动简介）、io.js（序列化地图）
import { A } from './state.js';
import { h, modal, busy, toast, toggle } from './ui.js';
import { saveFile } from './files.js';
import { writeZip } from './zip.js';
import { renderPreview } from './check.js';
import { buildDescription } from './editorial.js';
import { serializeOnce } from './io.js';
import { kvGet, kvSet } from './util.js';
import { helpBtn, HELP } from './help.js';
import { icon } from './icons.js';

const ed = A.ed, rend = A.rend;
const te = new TextEncoder();

const nowText = () => {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const byteLen = (data) => (typeof data === 'string' ? te.encode(data).length : data.length);
export function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

// 封面：交给 check.js 的 renderPreview（和“导出封面”同一套，带资源池黄点）
export async function coverBytes(size = 500) {
  if (!ed.map) throw new Error('还没有地图');
  const cv = renderPreview(ed, rend, size, { pools: true });
  return new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

// 简介兜底：editorial.js 没写出来时也能出一个能看的 README
export function fallbackDescription(ed2 = ed) {
  const m = ed2.map;
  if (!m) return '';
  const sp = ed2.spawns();
  const teams = new Set(sp.map((s) => s.team)).size;
  const pools = ed2.poolTiles().length;
  return [
    `《${A.mapName || '未命名地图'}》`,
    `${m.width}×${m.height} 格 · ${teams ? teams + ' 队' : '还没放出生点'} · ${pools} 个资源池`,
    '',
    '一张用铁锈地图编辑器做出来的对战图。开局先占住身边的资源池，再往中间推。',
  ].join('\n');
}

// 打包：opts 里每个字段都对应一个勾选项；返回 { bytes, files, size, ms }
export async function buildPackage(opts = {}) {
  if (!ed.map) throw new Error('先打开一张地图再打包');
  const t0 = performance.now();
  const o = {
    name: String(opts.name || A.mapName || '未命名地图').trim() || '未命名地图',
    version: String(opts.version || '1.0.0').trim() || '1.0.0',
    author: String(opts.author || '').trim(),
    description: opts.description,
    changelog: opts.changelog,
    cover: opts.cover !== false,
    readme: opts.readme !== false,
    changelogFile: opts.changelogFile !== false,
    mapFile: opts.mapFile !== false,
    coverSize: Math.max(120, Math.min(1200, +opts.coverSize || 500)),
  };
  const files = [];
  if (o.cover) files.push({ name: 'cover.png', data: await coverBytes(o.coverSize) });

  let desc = o.description == null ? '' : String(o.description).trim();
  if (!desc) {
    try { desc = String(buildDescription(ed) || '').trim(); } catch (e) { desc = ''; }
    if (!desc) desc = fallbackDescription();
  }
  if (o.readme) {
    const lines = [
      `# ${o.name}`,
      '',
      `- 版本：${o.version}`,
      o.author ? `- 作者：${o.author}` : '',
      `- 更新时间：${nowText()}`,
      `- 地图尺寸：${ed.map.width}×${ed.map.height} 格`,
      '',
      '## 简介',
      '',
      desc,
      '',
      '## 文件说明',
      '',
      '· map.tmx：地图本体，放进游戏的地图文件夹就能试玩。',
      o.cover ? '· cover.png：封面图，和地图同名放在一起就会显示。' : '',
      '',
      '由铁锈地图编辑器导出。',
    ].filter((l) => l !== '');
    files.push({ name: 'README.md', data: lines.join('\n') + '\n' });
  }
  if (o.changelogFile) {
    const log = String(o.changelog == null ? '' : o.changelog).trim() || '（这一版还没写更新说明）';
    files.push({
      name: 'changelog.md',
      data: `# 更新说明\n\n## ${o.version}（${nowText()}）\n\n${log}\n\n- 打包时间：${nowText()}\n`,
    });
  }
  if (o.mapFile) files.push({ name: 'map.tmx', data: await serializeOnce() });

  const bytes = writeZip(files);
  return {
    bytes,
    files: files.map((f) => ({ name: f.name, size: byteLen(f.data) })),
    size: bytes.length,
    meta: { ...o, description: desc },
    ms: Math.round(performance.now() - t0),
  };
}

// ---------------- 对话框 ----------------
export async function workshopDialog() {
  if (!ed.map) { toast('先打开一张地图再发布'); return; }
  const saved = (await kvGet('workshopMeta')) || {};
  const nameI = h('input', { value: saved.name || A.mapName || '', placeholder: '地图名（也会写进 README）' });
  const verI = h('input', { value: saved.version || '1.0.0', placeholder: '1.0.0' });
  const authorI = h('input', { value: saved.author || '', placeholder: '怎么写都行，可以不填' });
  const descTa = h('textarea', { rows: 8, style: 'width:100%;font-size:12.5px;line-height:1.6' });
  let autoDesc = '';
  try { autoDesc = String(buildDescription(ed) || '').trim(); } catch (e) { autoDesc = ''; }
  descTa.value = saved.description || autoDesc || fallbackDescription();
  const logTa = h('textarea', { rows: 4, style: 'width:100%;font-size:12.5px' , placeholder: '例如：修了右边出生点太挤的问题，中间加了两个资源池' });
  logTa.value = saved.changelog || '';
  const st = { cover: true, readme: true, changelogFile: true, mapFile: true };
  const info = h('div', { class: 'hint' }, '正在估算体积…');

  const recount = async () => {
    try {
      const pkg = await buildPackage({
        name: nameI.value, version: verI.value, author: authorI.value,
        description: descTa.value, changelog: logTa.value,
        cover: st.cover, readme: st.readme, changelogFile: st.changelogFile, mapFile: st.mapFile,
      });
      info.textContent = `将打包 ${pkg.files.length} 个文件、约 ${fmtSize(pkg.size)}（${pkg.files.map((f) => `${f.name} ${fmtSize(f.size)}`).join('、')}）`;
    } catch (e) { info.textContent = '估算失败：' + (e.message || e); }
  };
  const boxes = [
    ['cover', 'cover.png 封面（工坊列表里显示）'],
    ['mapFile', 'map.tmx 地图本体'],
    ['readme', 'README.md 简介'],
    ['changelogFile', 'changelog.md 版本说明'],
  ].map(([k, label]) => toggle(label, st[k], (v) => { st[k] = v; recount(); }));

  const body = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '把这张图整理成能直接上传工坊的压缩包：封面、简介、更新说明和地图本体。'), helpBtn('tool.workshop')),
    h('div', { class: 'grid2' },
      h('div', {}, h('label', {}, '地图名'), nameI),
      h('div', {}, h('label', {}, '版本号'), verI)),
    h('div', {}, h('label', {}, '作者'), authorI),
    h('div', { class: 'row', style: 'align-items:flex-end;gap:8px' },
      h('div', { style: 'flex:1' }, h('label', {}, '简介（README 正文）'), descTa)),
    h('div', { class: 'row', style: 'gap:8px;margin-top:4px' },
      h('button', { onclick: () => { descTa.value = autoDesc || fallbackDescription(); } }, '按地图自动生成'),
      h('span', { class: 'hint' }, '会自动带上尺寸、队伍、资源池和检查结果')),
    h('div', {}, h('label', {}, '这一版更新了什么（写进 changelog.md）'), logTa),
    h('div', { style: 'margin-top:10px' }, h('label', {}, '打进包里的文件'), h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px 14px' }, boxes)),
    h('div', { style: 'margin-top:8px' }, info),
  );

  recount();          // 打开对话框先估算一次
  const r = await modal('工坊发布包', body, [
    { label: '取消', value: null },
    {
      label: '导出 .zip',
      primary: true,
      value: async () => {
        await kvSet('workshopMeta', { name: nameI.value, version: verI.value, author: authorI.value, description: descTa.value, changelog: logTa.value });
        const pkg = await busy('正在打包…', () => buildPackage({
          name: nameI.value, version: verI.value, author: authorI.value,
          description: descTa.value, changelog: logTa.value,
          cover: st.cover, readme: st.readme, changelogFile: st.changelogFile, mapFile: st.mapFile,
        }));
        const base = String(nameI.value || A.mapName || '地图').replace(/[\\/:*?"<>|]/g, '_');
        const ver = String(verI.value || '1.0.0').replace(/[\\/:*?"<>|]/g, '_');
        const r2 = await saveFile(`${base}-${ver}.zip`, pkg.bytes, 'application/zip');
        if (r2.ok) toast(`已导出 ${pkg.files.length} 个文件，共 ${fmtSize(pkg.size)}${r2.where ? '：' + r2.where : ''}`, 3600);
        return pkg;
      },
    },
  ], { wide: true });
  return r;
}

Object.assign(HELP, {
  'tool.workshop': {
    t: '工坊发布包',
    s: '封面、简介、版本说明和地图一键打成一个 zip',
    b: '填好地图名、版本、作者和更新说明，勾选要打包的文件，点「导出 .zip」。封面用当前地图渲染，简介可以点「按地图自动生成」。',
    tips: ['README.md 里会自动写尺寸、队伍、资源池和检查结果。', '打完包先自己解压看一眼，再上传工坊。'],
  },
});
