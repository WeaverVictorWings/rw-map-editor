// 调试触发器：一键加一组测试用触发器，发布前一键移除
// 自己加的触发器都打上 rwDebug 标记，只删自己的，绝不碰用户手写的
import { A } from './state.js';
import { h, modal, toast, confirmBox } from './ui.js';
import { HELP } from './help.js';
import { makeTrigger } from './triggers.js';

const ed = A.ed;
export const DEBUG_TAG = 'rwDebug';

const isDebug = (o) => (o.props || []).some((p) => p.name === DEBUG_TAG);

export function debugTriggers(ed2 = ed) {
  const T = ed2.map && ed2.map.group('Triggers');
  return T ? T.objects.filter(isDebug) : [];
}

// 往地图里加调试触发器。kind 见 DEBUG_KINDS
export function addDebugTriggers(ed2, kinds = ['clock']) {
  const T = ed2.map.ensureGroup('Triggers');
  const W = ed2.map.width, H = ed2.map.height;
  const taken = new Set(T.objects.map((o) => (o.props.find((p) => p.name === 'id') || {}).value || o.attrs.name));
  const out = [];
  ed2.begin('添加调试触发器');
  ed2.op.snapshotGroup(T);
  for (const k of kinds) {
    if (k === 'clock') {
      // 每 10 秒在屏幕中间报一次时间，方便对秒
      const rect = { x: (W * 10) >> 1, y: (H * 10) >> 1, w: 20, h: 20 };
      const o = makeTrigger('basic', rect, { id: '调试_计时', delay: '0s', repeatDelay: '10s', text: '调试：每 10 秒' }, '调试_计时', taken);
      o.props.push({ name: DEBUG_TAG, value: '1' });
      T.objects.push(o); taken.add('调试_计时'); out.push(o);
    } else if (k === 'coords') {
      // 点一下地图报一次坐标（区域检测 + 显示文字）
      const rect = { x: 0, y: 0, w: W * 10, h: H * 10 };
      const o = makeTrigger('teamTagDetect', rect, { id: '调试_坐标', teamTag: 'debug_coords' }, '调试_坐标', taken);
      o.props.push({ name: DEBUG_TAG, value: '1' });
      T.objects.push(o); taken.add('调试_坐标'); out.push(o);
    } else if (k === 'spawn') {
      // 开局在中央刷一个便于辨认的单位，验证触发器链是否通
      const rect = { x: ((W >> 1) - 1) * 10, y: ((H >> 1) - 1) * 10, w: 20, h: 20 };
      const o = makeTrigger('unitAdd', rect, {
        id: '调试_刷兵', spawnUnits: 'builder', team: '0', delay: '5s', repeatDelay: '30s',
      }, '调试_刷兵', taken);
      o.props.push({ name: DEBUG_TAG, value: '1' });
      T.objects.push(o); taken.add('调试_刷兵'); out.push(o);
    }
  }
  ed2.commit();
  return out;
}

export function removeDebugTriggers(ed2 = ed) {
  const T = ed2.map && ed2.map.group('Triggers');
  if (!T) return 0;
  const list = T.objects.filter(isDebug);
  if (!list.length) return 0;
  ed2.begin('移除调试触发器');
  ed2.op.snapshotGroup(T);
  for (const o of list) {
    const i = T.objects.indexOf(o);
    if (i >= 0) T.objects.splice(i, 1);
  }
  ed2.commit();
  return list.length;
}

export const DEBUG_KINDS = [
  { id: 'clock', cn: '计时播报', desc: '每 10 秒在屏幕上报一次时间，用来核对触发时刻' },
  { id: 'coords', cn: '坐标检测', desc: '区域铺满全图，配合队伍标签输出坐标信息' },
  { id: 'spawn', cn: '中央刷兵', desc: '开局 5 秒后在正中央刷一个建造者，验证刷兵链路是否通' },
];

export async function debugTrigDialog() {
  if (!ed.map) { toast('先打开一张地图'); return; }
  const st = { kinds: ['clock'] };
  const body = h('div', {});
  body.append(h('div', { style: 'font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:8px' },
    '勾选要加的调试触发器。加进去的都带「rwDebug」标记，发布前点「全部移除」就能干净删掉，不会动你自己写的触发器。'));
  for (const k of DEBUG_KINDS) {
    const row = h('label', { class: 'row', style: 'gap:8px;align-items:flex-start;margin:8px 0;font-size:13px' });
    const chk = h('input', {
      type: 'checkbox', checked: st.kinds.includes(k.id),
      onchange: (e) => {
        if (e.target.checked) st.kinds.push(k.id);
        else st.kinds = st.kinds.filter((x) => x !== k.id);
      },
    });
    chk.checked = st.kinds.includes(k.id);
    const desc = h('div', {});
    desc.append(h('div', { style: 'font-weight:600' }, k.cn), h('div', { style: 'font-size:11px;color:var(--muted)' }, k.desc));
    row.append(chk, desc);
    body.append(row);
  }
  const n = debugTriggers().length;
  body.append(h('div', { style: 'font-size:12px;color:var(--muted);margin-top:10px' },
    n ? `地图上现在有 ${n} 个调试触发器。` : '地图上现在没有调试触发器。'));

  await modal('调试触发器', body, [
    { label: '全部移除', value: 'del', check: () => { const d = removeDebugTriggers(ed); toast(d ? `已移除 ${d} 个` : '没有可移除的'); } },
    { label: '关闭', value: 0 },
    {
      label: '加进地图', value: 1, primary: true,
      check: () => {
        if (!st.kinds.length) { toast('至少勾一个'); return false; }
        const added = addDebugTriggers(ed, st.kinds);
        toast(`已加 ${added.length} 个调试触发器`);
        return true;
      },
    },
  ], { wide: true });
}

Object.assign(HELP, {
  'tool.debugtrig': {
    t: '调试触发器',
    s: '加测试用触发器查逻辑，发布前一键清掉',
    b: '菜单「触发器」→「调试触发器…」。勾选计时播报 / 坐标检测 / 中央刷兵，加进地图后进游戏试，看逻辑有没有通。这些触发器都带 rwDebug 标记，点「全部移除」只删它们，你自己写的触发器不受影响。',
    tips: ['发布前记得跑一次「全部移除」。', '可以配合「触发器模拟器」先不动游戏就看触发时刻。'],
  },
});
