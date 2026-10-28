// 示例地图：只给参数方案和说明，不带任何游戏素材；生成时用用户自己的图块模板
import { A } from './state.js';
import { h, modal, busy, toast, confirmBox } from './ui.js';
import { createNewMap } from './dialogs.js';
import { kvGet } from './util.js';
import { helpBtn, HELP } from './help.js';
import { icon } from './icons.js';

const ed = A.ed;

// 三套参数：尺寸 / 人数 / 玩法 / 对称 / 资源池 / 种子
// 注意：这里只有数字和文字，没有图块、图片或地图数据
export const EXAMPLES = [
  {
    id: 'duel',
    cn: '1v1 对决 · 大陆',
    desc: '最经典的一对一：左右各一个出生点，中间是必争的资源池。先拿这张练“看对称、看距离”。',
    look: '看完先对比两边到中央资源池的格数；一边明显更近就换个种子，或者手动把池子挪一格。',
    cfg: { w: 160, h: 160, players: 2, start: 'gen', layout: 'lr', preset: 'continent', style: 'temperate', sym: 'lr', seed: 20251026, pools: 3, center: 2 },
  },
  {
    id: 'team4',
    cn: '4 人团战 · 内海',
    desc: '四角出生、中间内海，适合 2v2 / 4 人混战。资源池沿四角分布，海军可以从中间切进去。',
    look: '看四个出生点是不是都离内海有陆地连接；如果某角被水围死，把“连通出生点”开一下再生成。',
    cfg: { w: 200, h: 200, players: 4, start: 'gen', layout: 'ring', preset: 'sea', style: 'temperate', sym: 'quad', seed: 731905, pools: 2, center: 4 },
  },
  {
    id: 'ffa3',
    cn: '3 人混战 · 群岛',
    desc: '三个岛、没有对称，拼的是谁先摸清邻居的位置。岛图不保证陆军互通，适合带海军的玩法。',
    look: '跑一遍“能玩吗”：岛图如果报“出生点不连通”是正常的，建议加海军单位或改浅滩；想看纯陆军就把玩法换成“大陆”。',
    cfg: { w: 180, h: 180, players: 3, start: 'gen', layout: 'ring', preset: 'islands', style: 'desert', sym: 'none', seed: 44821, pools: 2, center: 1 },
  },
];

const PRESET_CN = { continent: '大陆对战', islands: '群岛海战', sea: '内海', river: '河谷', plateau: '高原要塞' };
const STYLE_CN = { temperate: '温带', snow: '雪原', desert: '沙漠', volcanic: '火山' };
const SYM_CN = { none: '不对称', lr: '左右', tb: '上下', rot: '中心旋转', quad: '四向' };

function paramTable(cfg) {
  const rows = [
    ['尺寸', `${cfg.w}×${cfg.h} 格`],
    ['人数 / 队伍', `${cfg.players} 人`],
    ['地形', `${PRESET_CN[cfg.preset] || cfg.preset} · ${STYLE_CN[cfg.style] || cfg.style}`],
    ['对称', SYM_CN[cfg.sym] || cfg.sym],
    ['资源池', `${cfg.pools} 个/队 · 中央 ${cfg.center} 个`],
    ['种子', String(cfg.seed)],
  ];
  return h('div', { class: 'hint', style: 'margin-top:6px;line-height:1.7' }, rows.map(([k, v]) => h('div', {}, `${k}：${v}`)));
}

// 生成一张示例到编辑器。opts.force：跳过“替换当前地图”确认；opts.expectTemplate：不抛错只返回提示
export async function generateExample(ex, opts = {}) {
  if (!ex || !ex.cfg) throw new Error('没有这个示例');
  const tpl = await kvGet('template');
  if (!tpl) throw new Error('还没有图块素材：先打开一张铁锈战争地图（.tmx）取素材，示例图会用它的图块生成');
  if (!opts.force && ed.map && ed.dirty) {
    const ok = await confirmBox('替换当前地图？', '生成示例会替换当前这张图。新地图不会进撤销栈，不能撤销。', '替换并生成', '取消');
    if (!ok) return null;
  }
  const t0 = performance.now();
  await createNewMap({ name: ex.cn, ...ex.cfg });
  const ms = Math.round(performance.now() - t0);
  const sp = ed.spawns();
  const teams = new Set(sp.map((s) => s.team)).size;
  let errors = 0, warns = 0;
  try {
    const list = (await import('./check.js')).runChecks(ed) || [];
    errors = list.filter((c) => c.level === 'error').length;
    warns = list.filter((c) => c.level === 'warn').length;
  } catch (e) { console.warn('示例图检查没跑起来', e); }
  const stats = {
    id: ex.id, name: ex.cn, w: ed.map.width, h: ed.map.height,
    teams, pools: ed.poolTiles().length, players: ex.cfg.players,
    ms, errors, warns,
  };
  if (typeof window !== 'undefined') window.__rwExampleLast = stats;
  return stats;
}

// ---------------- 对话框 ----------------
export async function examplesDialog() {
  const hasTpl = !!(await kvGet('template'));
  const listEl = h('div', {});
  const box = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '三套参数方案，点一下就能用你自己导入的图块生成到编辑器里，当参考图或起点。'), helpBtn('tool.examples')),
    !hasTpl ? h('div', { class: 'hint', style: 'color:var(--warn)' }, '还没有图块素材：先打开一张游戏导出的 .tmx 地图，示例才能生成。下面的参数可以看，生成按钮会提示先取素材。') : null,
  );
  for (const ex of EXAMPLES) {
    listEl.append(h('div', { class: 'card', style: 'margin-top:8px' },
      h('div', { class: 'row' }, h('b', { style: 'flex:1' }, ex.cn), h('small', { class: 'hint' }, `${ex.cfg.w}×${ex.cfg.h} · ${ex.cfg.players} 人`)),
      h('div', { class: 'hint', style: 'margin-top:4px' }, ex.desc),
      paramTable(ex.cfg),
      h('div', { class: 'hint', style: 'margin-top:4px' }, `看什么：${ex.look}`),
      h('div', { class: 'row', style: 'margin-top:6px' },
        h('button', { class: 'primary', html: icon('wand2') + ' 生成到编辑器', onclick: async () => {
          try {
            const st = await busy('正在生成示例…', () => generateExample(ex));
            if (st) {
              toast(`已生成《${st.name}》：${st.w}×${st.h}，${st.teams} 队，${st.pools} 个资源池，用时 ${st.ms}ms`, 3600);
              closeModal();
            }
          } catch (e) { toast(e.message || String(e), 5200); }
        } }))));
  }
  box.append(listEl);
  box.append(h('div', { class: 'hint', style: 'margin-top:8px' }, '示例只给参数，不含任何游戏素材；图块全部来自你打开过的地图模板。生成后可以继续用自动细节、触发器这些功能。'));
  await modal('示例地图', box, [{ label: '关闭', value: 1 }], { wide: true });
}

Object.assign(HELP, {
  'tool.examples': {
    t: '示例地图',
    s: '三套参数方案，一键生成当参考',
    b: '给的是尺寸、人数、玩法、对称和资源池这些参数，以及每张图该看什么。生成时用你自己打开过的地图模板里的图块，不包含任何游戏素材。',
    tips: ['生成会替换当前地图，记得先存好。', '岛图不保证陆军互通，检查里的提示要自己判断。'],
  },
});
