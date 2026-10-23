// 试玩检查清单（带测试记录）、地图体检评分、导出 / 导入全部个人数据
import { A } from './state.js';
import { objProp } from './tmx.js';
import { runChecks } from './check.js';
import { balanceReport } from './pathing.js';
import { kvGet, kvSet } from './util.js';
import { saveFile, pickFile } from './files.js';
import { h, modal, closeModal, toast, busy } from './ui.js';
import { icon } from './icons.js';
import { HELP, helpBtn } from './help.js';

const ed = A.ed;

Object.assign(HELP, {
  'tool.checklist': { t: '试玩检查清单', s: '进游戏要测哪几项', b: '根据这张地图的内容（出生点、资源池、水域、触发器、作战日志……）列出进游戏要逐项确认的东西。勾完可以写备注，每次测试都会记下来，下次打开能看到上次发现的问题改了没有。' },
  'tool.score': { t: '地图体检', s: '给地图打个分，告诉你扣分在哪', b: '综合“能玩吗”检查、平衡报告、细节丰富程度，给出 100 分制的分数和每一项的扣分原因、改进办法。只是参考，好玩最重要。' },
  'tool.userdata': { t: '导出 / 导入个人数据', s: '换手机、电脑和手机之间同步', b: '把你的印章、细节预设、色块、设置、地图库信息打包成一个文件；在另一台设备上导入就能接着用。地图本身请另外保存。' },
});

// ---------------- 试玩检查清单 ----------------
function buildItems() {
  const m = ed.map, items = [];
  const sp = ed.spawns().filter((s) => s.team >= 0);
  const T = m.group('Triggers'), trig = T ? T.objects.filter((o) => o.attrs.type) : [];
  const has = (re) => trig.some((o) => re.test(o.attrs.type || ''));
  const mi = ed.mapInfo(), type = mi ? objProp(mi, 'type') || 'skirmish' : 'skirmish';
  items.push(['open', '地图能在游戏里打开，选图界面能看到封面']);
  items.push(['spawn', `${sp.length} 个出生点都能正常开局（指挥中心和建造者都在）`]);
  if (sp.length > 10) items.push(['bigroom', `超过 10 队：用大房间（服务器）测试第 11 队以后的出生点`]);
  if (A.rend.pools.length) items.push(['pool', `资源池能建采集器，${A.rend.pools.length} 个都正常`]);
  items.push(['walk', '陆军能从你的出生点走到敌人那里，没有被悬崖或水挡死']);
  const G = m.ground, wet = G && G.data.some((g) => { const i = m.tileInfo(g); return i && 'water' in i.props; });
  if (wet) items.push(['naval', '船能在水上走，陆军不能下水；浅滩陆军能过']);
  if (m.tilesets.some((t) => t.name === 'rw_colors')) items.push(['color', '色块的性质正确（水色块船能走、悬崖色块过不去……）']);
  if (has(/unitAdd/i)) items.push(['spawnTrig', '刷兵触发器按时刷出单位，位置和队伍都对']);
  if (has(/unitDetect/i)) items.push(['detect', '区域检测：单位进入 / 离开区域时触发器会反应']);
  if (has(/changeCredits/i)) items.push(['credits', '资金变化正确（多少钱、多久一次）']);
  if (has(/mapText/i)) items.push(['text', '地图上的文字显示正常，颜色和位置对']);
  if (trig.some((o) => objProp(o, 'globalMessage'))) items.push(['log', '作战日志里的消息按时间出现']);
  if (type === 'survival') items.push(['waves', '敌人按波次从敌军出生点出来，打完最后一波正确结束']);
  if (type === 'mission' || type === 'challenge') items.push(['obj', '任务目标按顺序出现，全部完成后判定胜利']);
  items.push(['perf', '大地图在手机上不卡、不闪退']);
  return items;
}
export async function checklistDialog() {
  if (!ed.map) return;
  const key = 'testlog:' + A.mapName;
  const log = (await kvGet(key)) || [];
  const items = buildItems();
  const last = log[0];
  const state = Object.fromEntries(items.map(([id]) => [id, last && last.items[id] ? last.items[id] : { ok: false, note: '' }]));
  const box = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '进游戏按这张清单逐项试。勾上没问题的，有问题就写一句备注。'), helpBtn('tool.checklist')),
    last ? h('div', { class: 'hint', style: 'margin:8px 0', html: `上次测试：${new Date(last.time).toLocaleString()}，${Object.values(last.items).filter((x) => x.ok).length}/${Object.keys(last.items).length} 项通过。` + (Object.entries(last.items).filter(([, x]) => !x.ok && x.note).length ? '<br>上次发现的问题：' + Object.entries(last.items).filter(([, x]) => !x.ok && x.note).map(([, x]) => '「' + x.note + '」').join('、') : '') }) : null);
  for (const [id, text] of items) {
    const s = state[id];
    box.append(h('div', { class: 'chk ' + (s.ok ? 'ok' : 'info') },
      h('input', { type: 'checkbox', checked: s.ok, style: 'width:auto;margin-top:3px', onchange: (e) => { s.ok = e.target.checked; } }),
      h('div', { style: 'flex:1' }, h('div', { class: 't' }, text), h('input', { placeholder: '有问题就写一句（可不填）', value: s.note || '', style: 'margin-top:4px', oninput: (e) => { s.note = e.target.value; } }))));
  }
  const ok = await modal('试玩检查清单', box, [{ label: '关闭', value: false }, { label: '保存这次测试记录', value: true, primary: true }], { wide: true });
  if (!ok) return;
  log.unshift({ time: Date.now(), items: state });
  await kvSet(key, log.slice(0, 20));
  const bad = Object.values(state).filter((x) => !x.ok).length;
  toast(bad ? `已记录：还有 ${bad} 项没通过，改完再测一次` : '全部通过，可以发布了！', 3600);
}

// ---------------- 地图体检评分 ----------------
export async function scoreDialog() {
  if (!ed.map) return;
  const res = await busy('正在体检…', async () => {
    const out = [];
    let score = 100;
    const ded = (n, why, how) => { score -= n; out.push({ n, why, how }); };
    const checks = runChecks(ed, { triggerIssues: A.hooks.triggerIssues ? A.hooks.triggerIssues() : [] });
    const err = checks.filter((c) => c.level === 'error'), warn = checks.filter((c) => c.level === 'warn');
    if (err.length) ded(Math.min(40, err.length * 12), `${err.length} 个会影响游戏的问题`, '打开“能玩吗？”逐个修，大多能一键修好。');
    if (warn.length) ded(Math.min(15, warn.length * 3), `${warn.length} 个提醒`, '看看“能玩吗？”里的黄色项。');
    const sp = ed.spawns().filter((s) => s.team >= 0);
    if (sp.length >= 2 && sp.length <= 24) {
      const r = balanceReport(ed, 30), f = r.fair;
      if (f) {
        if (f.nearestSpread > 3) ded(Math.min(15, f.nearestSpread * 2), `各队最近资源池距离相差 ${f.nearestSpread} 格`, '用“平衡报告”找出吃亏的队，给它挪近或加一个资源池。');
        if (f.nearSpread > 1) ded(Math.min(10, f.nearSpread * 3), `各队附近资源池数量相差 ${f.nearSpread} 个`, '对称地放资源池，或用整图镜像。');
        if (f.areaRatio && f.areaRatio > 1.3) ded(Math.min(10, Math.round((f.areaRatio - 1) * 15)), `地盘最大是最小的 ${f.areaRatio.toFixed(1)} 倍`, '把出生点挪到更对称的位置。');
      }
      if (r.rows.some((x) => x.island)) ded(10, '有的队陆军走不到任何敌人', '如果不是海战图，用道路工具或浅滩打通。');
    } else if (sp.length < 2) ded(20, '出生点少于 2 个', '在单位模式里放出生点。');
    // 细节丰富程度
    const eng = ed.engine, m = ed.map;
    if (eng) {
      const W = m.width, H = m.height, step = Math.max(1, Math.floor(Math.sqrt(W * H / 40000)));
      const kinds = new Set(); let edges = 0, n = 0, deco = 0;
      for (let y = 0; y < H; y += step) for (let x = 0; x < W - 1; x += step) { const i = y * W + x, t = eng.tileTerrain(i); kinds.add(t); n++; if (eng.tileTerrain(i + 1) !== t) edges++; if (m.items && m.items.data[i]) deco++; }
      if (kinds.size < 3) ded(8, '地形种类太少', '试试“自动丰富细节”里的预设。');
      if (deco / n < 0.01) ded(6, '几乎没有树、碎石等装饰', '用“自然点缀”或物品笔刷撒一些。');
      if (edges / n < 0.02) ded(4, '地形边缘太规整', '用“边缘自然化”。');
    }
    return { score: Math.max(0, Math.round(score)), out };
  });
  const grade = res.score >= 90 ? ['很好', 'var(--ok)'] : res.score >= 70 ? ['不错', 'var(--info)'] : res.score >= 50 ? ['还需要改改', 'var(--warn)'] : ['问题较多', 'var(--err)'];
  modal('地图体检', h('div', {},
    h('div', { class: 'score', style: `--c:${grade[1]}` }, h('b', {}, res.score), h('span', {}, grade[0]), helpBtn('tool.score')),
    res.out.length ? h('div', {}, res.out.map((x) => h('div', { class: 'chk warn' }, h('div', { class: 'icn' }, '-' + x.n), h('div', {}, h('div', { class: 't' }, x.why), h('div', { class: 'd' }, x.how))))) : h('p', {}, '没有扣分项。')),
  [{ label: '关闭', value: 1, primary: true }]);
}

// ---------------- 个人数据 ----------------
const KEYS = ['stamps', 'detailPresets', 'settings', 'library', 'mods', 'lessonsDone'];
export async function exportUserData() {
  const data = { rwUserData: 1, time: Date.now() };
  for (const k of KEYS) data[k] = await kvGet(k);
  const r = await saveFile('铁锈地图编辑器-个人数据.json', JSON.stringify(data), 'application/json');
  if (r.ok) toast('个人数据' + r.where);
}
export async function importUserData() {
  const r = await pickFile('.json,application/json'); if (!r) return;
  try {
    const d = JSON.parse(await r.file.text());
    if (!d.rwUserData) throw new Error('不是个人数据文件');
    for (const k of KEYS) if (d[k] !== undefined && d[k] !== null) await kvSet(k, d[k]);
    toast('已导入。部分设置重新打开后生效。', 3600);
  } catch (e) { toast('导入失败：' + e.message); }
}
