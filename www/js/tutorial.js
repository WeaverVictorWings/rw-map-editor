// 新手教程：一步一步带着做，高亮要点的按钮，做完自动进入下一步
import { A } from './state.js';
import { kvGet, kvSet } from './util.js';
import { h, modal, closeModal, toast } from './ui.js';
import { icon } from './icons.js';
import { setMode } from './panels.js';
import * as D from './dialogs.js';
import { autoSnapshot } from './io.js';

const ed = A.ed;
const el = () => document.getElementById('coach');
const mob = () => A.isMobile();

// wait：事件名（以冒号结尾表示前缀），数组，或判断函数
const LESSONS = [
  { id: 'basics', title: '第一课：五分钟做一张能玩的图', desc: '画地形、对称、资源池、出生点、检查、保存', needMap: true, steps: [
    { before: () => setMode('terrain'), spot: '#dockBody .swatches', text: '这是<b>地形</b>模式。在右边（手机在下面）点一种地形，比如<b>浅水</b>。', wait: 'terrain:' },
    { spot: '#stage', text: '在地图上<b>按住拖动</b>画一笔。注意看：边缘会<b>自动加过渡</b>（沙滩、浅滩），不用自己拼图块。', wait: 'painted' },
    { spot: '#btnUndo', text: '画错了？点<b>撤销</b>。电脑按 Ctrl+Z，手机<b>两指轻点</b>一下屏幕也行。', wait: 'undo' },
    { spot: () => (mob() ? '#dockBody .seg' : '.quick .seg'), text: '对战图一般要对称。在“对称”里选<b>左右</b>，再画一笔——另一半会同时画上。', wait: () => ed.sym !== 'none', then: 'painted' },
    { spot: '[data-mode=items]', text: '切到<b>物品</b>模式，然后在地图上点一下，放一个<b>资源池</b>。', wait: 'item' },
    { spot: '[data-mode=units]', text: '切到<b>单位</b>模式，在地图上点一下放一个<b>出生点</b>（指挥中心 + 2 个建造者）。队伍号会自动往后排。', wait: 'spawn' },
    { spot: '#btnCheck', text: '点<b>能玩吗？</b>检查一下：缺 map_info、出生点压在水上、资源池太挤……都会告诉你，很多问题能一键修好。', wait: 'checked' },
    { spot: '#btnSave', text: '最后<b>保存</b>。点旁边的小箭头还能“保存到游戏文件夹”，存完直接进游戏玩。', wait: 'saved', skipLabel: '先不保存' },
  ] },
  { id: 'select', title: '第二课：框选、复制、印章', desc: '把做好的一块复制到别处，或者存成印章反复用', needMap: true, steps: [
    { before: () => setMode('terrain'), spot: '[data-tool=marquee]', text: '选<b>框选</b>工具（快捷键 M）。', wait: 'tool:marquee' },
    { spot: '#stage', text: '在地图上<b>拖出一个框</b>，选中一块区域。', wait: 'selected' },
    { spot: '#selbar', text: '下面出现了操作条：可以<b>复制、剪切、翻转、旋转</b>。点<b>复制</b>，再点<b>粘贴</b>。', wait: 'placed', hint: '粘贴后拖动摆位置，电脑点一下放下，手机点“放下”。' },
    { spot: '[data-tool=marquee]', text: '选中一块后点“<b>存印章</b>”，它就会出现在右边的<b>印章</b>面板里，以后一点就能放。印章面板里还有内置的标准基地、湖泊、浅滩等。', wait: null },
  ] },
  { id: 'triggers', title: '第三课：触发器入门', desc: '用模板做一座城夺城市，看懂“当……就……”', needMap: true, steps: [
    { spot: '[data-mode=triggers]', text: '切到<b>触发器</b>模式。触发器就是地图规则：<b>当</b>某件事发生，<b>就</b>做某件事。', wait: 'mode:triggers' },
    { spot: '#dockBody .tplrow', text: '最快的办法是用模板。点<b>城市争夺</b>，填个名字，再在地图上点城市的位置。', wait: 'trig:template' },
    { spot: '#dockBody .tlist', text: '每张卡片顶上的一句话就是这条规则的意思，例如“当区域里有第 1 队的建筑 → 第 1 队资金 +5”。点一张卡片可以改细节。', wait: null },
    { spot: '#dockBody', text: '点“<b>逻辑图</b>”能看到所有触发器怎么连在一起：绿线是“激活”，红色虚线是“关闭”。改完记得点“能玩吗？”检查一遍。', wait: null },
  ] },
  { id: 'big', title: '第四课：生成和改造整张地图', desc: '随机生成、图片转地图、等比缩放、整图镜像', needMap: false, steps: [
    { spot: '[data-mode=generate]', before: () => ed.map && setMode('generate'), text: '<b>生成</b>模式里是对整张地图的操作：随机生成、图片转地图、等比缩放、整图镜像、调整画布。', wait: null },
    { spot: '#dockBody .cards', text: '<b>图片转地图</b>：选一张图，自动找出主要颜色，你决定每种颜色变成什么地形、各占多少比例；预览满意了再生成，之后还能逐块改。', wait: null },
    { spot: '#dockBody .cards', text: '<b>等比缩放</b>：整张图放大 2 倍时，地形自动重铺，出生点和资源池跟着搬，资源池还可以按面积加多。', wait: null },
  ] },
];

let cur = null; // {lesson, i, phase}
let spotted = null;

function step() { return cur ? cur.lesson.steps[cur.i] : null; }
function query(sel) { const s = typeof sel === 'function' ? sel() : sel; try { return s ? document.querySelector(s) : null; } catch { return null; } }
function clearSpot() { if (spotted) spotted.classList.remove('spot'); spotted = null; }
function matches(w, evt) {
  if (!w) return false;
  if (typeof w === 'function') return !!w(evt);
  return (Array.isArray(w) ? w : [w]).some((x) => evt === x || (x.endsWith(':') && evt && evt.startsWith(x)));
}

function render() {
  const st = step(), box = el();
  clearSpot();
  if (!st) { box.classList.add('hidden'); return; }
  const n = cur.lesson.steps.length;
  box.innerHTML = '';
  box.append(h('div', { class: 'step' }, `${cur.i + 1}/${n}`),
    h('div', { class: 'txt', html: st.text + (st.hint ? `<div style="color:var(--muted);font-size:12px;margin-top:4px">${st.hint}</div>` : '') }),
    h('div', { class: 'cbtns' },
      h('button', { onclick: () => next() }, st.wait ? (st.skipLabel || '跳过') : (cur.i === n - 1 ? '完成' : '下一步')),
      h('button', { class: 'ib', title: '退出教程', onclick: () => stop(), html: icon('close') })));
  box.classList.remove('hidden');
  // 高亮（目标还没出现时稍后再试）
  let tries = 0;
  const spotIt = () => {
    if (!cur || step() !== st) return;
    const t = query(st.spot);
    if (t && t.offsetParent !== null) { t.classList.add('spot'); spotted = t; if (t.scrollIntoView && t.id !== 'stage') t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    else if (tries++ < 20) setTimeout(spotIt, 300);
  };
  spotIt();
  if (typeof st.wait === 'function' && st.wait(null) && cur.phase !== 'then') { if (st.then) { cur.phase = 'then'; } else setTimeout(next, 200); }
}
function next() {
  if (!cur) return;
  cur.i++; cur.phase = null;
  const st = step();
  if (!st) { finish(); return; }
  try { st.before && st.before(); } catch (e) { console.warn(e); }
  render();
}
function finish() {
  const l = cur.lesson;
  stop();
  kvGet('lessonsDone').then((d) => kvSet('lessonsDone', [...new Set([...(d || []), l.id])]));
  toast(`「${l.title}」完成！`, 3000);
}
function stop() { cur = null; clearSpot(); el().classList.add('hidden'); }

export function coach(evt) {
  const st = step(); if (!st) return;
  if (cur.phase === 'then') { if (matches(st.then, evt)) next(); return; }
  if (matches(st.wait, evt)) {
    if (st.then) { cur.phase = 'then'; return; }
    next();
  }
}

export async function startLesson(id) {
  const lesson = LESSONS.find((l) => l.id === id); if (!lesson) return;
  if (lesson.needMap) {
    // 教程总是在一张新的练习图上进行，不动你正在做的地图
    const tpl = await kvGet('template');
    if (!tpl) { await modal('先打开一张地图', h('p', {}, '教程需要图块素材。请先打开一张你已有的铁锈战争地图（.tmx），编辑器会从里面取出素材。'), [{ label: '知道了', value: 1, primary: true }]); return; }
    if (ed.map && ed.dirty) {
      const go = await modal('开始教程', h('p', {}, '教程会打开一张新的练习图。你当前地图还没保存的改动会先存成一个快照（在“历史”面板里可以恢复）。'), [{ label: '取消', value: 0 }, { label: '开始', value: 1, primary: true }]);
      if (!go) return;
      await autoSnapshot('开始教程前');
    }
    await D.createNewMap({ name: '教程练习', w: 80, h: 60, players: 2, start: 'blank', layout: 'lr', base: -1, pools: 1, center: 0 });
  }
  document.getElementById('welcome').classList.add('hidden');
  cur = { lesson, i: 0, phase: null };
  try { lesson.steps[0].before && lesson.steps[0].before(); } catch (e) { console.warn(e); }
  render();
}

export async function tutorialMenu() {
  const done = new Set((await kvGet('lessonsDone')) || []);
  const list = h('div', { class: 'cards' });
  for (const l of LESSONS) list.append(h('button', { class: 'acard', onclick: () => closeModal(l.id), html: icon(done.has(l.id) ? 'check' : 'tutorial') + `<div><b>${l.title}</b><small>${l.desc}${done.has(l.id) ? ' · 已完成' : ''}</small></div>` }));
  list.append(h('div', { class: 'hint', html: '任何时候都可以点工具旁边的 <b>?</b> 看说明，或者按 <b>Ctrl+K</b>（手机点左上角菜单 → 搜索功能）按名字找功能。' }));
  const id = await modal('新手教程', list, [{ label: '关闭', value: null }]);
  if (id) startLesson(id);
}

export function initTutorial() {
  A.hooks.coach = coach;
  A.hooks.tutorial = tutorialMenu;
}
