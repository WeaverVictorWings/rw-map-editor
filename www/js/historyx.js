// 撤销历史的增强操作：统计每一步改了多少、单独撤销中间某一步（保留后面的）
// 原理：先把目标那一步和它之后的都撤销 → 从 redo 栈里去掉目标 → 按顺序重做后面的。
// 后面步骤记录的是“改完后”的显式差异，所以重做时能原样落回去；被撤销的那一步就永久丢掉了。
import { A } from './state.js';
import { toast, confirmBox } from './ui.js';

const ed = A.ed;

// 一步操作改了什么（用于面板上的小字和确认框）
export function opInfo(i) {
  const op = ed.undoStack[i];
  if (!op) return null;
  const tiles = op.tI ? op.tI.length : 0;
  const verts = op.vI ? op.vI.length : 0;
  const objs = op.objs ? op.objs.reduce((s, e) => s + (e.after ? e.after.length : (e.before ? e.before.length : 0)), 0) : 0;
  const layers = op.snaps ? op.snaps.size : 0;
  return { index: i, label: op.label, time: op.time, tiles, verts, objects: objs, layerSnaps: layers, whole: !!op.meta, size: op.size };
}
export function opStatsText(i) {
  const s = opInfo(i); if (!s) return '';
  const parts = [];
  if (s.tiles) parts.push(`${s.tiles.toLocaleString()} 格`);
  if (s.verts) parts.push(`${s.verts.toLocaleString()} 个角点`);
  if (s.layerSnaps) parts.push(`${s.layerSnaps} 层`);
  if (s.objects) parts.push(`${s.objects} 个对象`);
  if (s.whole) parts.push('整张图');
  return parts.join(' · ') || '没有实际改动';
}
// 能不能单独撤销中间这一步：改尺寸/缩放/镜像这类整体操作不支持（它们会和后面的步骤冲突）
export function canDrop(i) {
  const op = ed.undoStack[i];
  return !!op && !op.meta && !ed.undoStack.slice(i + 1).some((o) => o.meta);
}

// 单独撤销第 i 步（0 起），保留它后面的步骤；成功返回 true
export function dropOp(i) {
  const target = ed.undoStack[i];
  if (!target) return false;
  if (target.meta) { toast('这一步是整图操作（改尺寸/缩放/镜像），不能单独撤销；只能撤销到它之前'); return false; }
  if (ed.undoStack.slice(i + 1).some((o) => o.meta)) { toast('后面还有整图操作（改尺寸/缩放/镜像），这一步不能单独撤销；可以先撤销到那一步之前'); return false; }
  if (ed.op) ed.commit();
  const snapU = ed.undoStack.slice(), snapR = ed.redoStack.slice();
  const restore = () => { ed.undoStack = snapU.slice(); ed.redoStack = snapR.slice(); };
  // 出错时把地图和两个栈都还原：先记下已经走了多少 undo/redo，失败时按原路走回去
  let steps = 0;          // >0 表示已经 undo 了这么多步，需要 redo 回来；<0 表示 redo 了这么多步
  const fail = (e) => {
    try {
      while (steps > 0 && ed.redoStack.length) { ed.redo(); steps--; }
      while (steps < 0 && ed.undoStack.length) { ed.undo(); steps++; }
    } catch (e2) { /* 尽力还原 */ }
    restore();
    A.rend && A.rend.invalidateAll();
    if (A.hooks.mini) A.hooks.mini(); else A.mini && A.mini.rebuild();
    A.refresh();
    toast(`单独撤销「${target.label}」时出错，已经原样恢复：${(e && e.message) || e}`, 4200);
    return false;
  };
  try {
    // 1) 撤到目标之前（此时 redo 栈尾就是目标）
    while (ed.undoStack.length > i) { ed.undo(); steps++; }
    // 2) 把目标从 redo 栈里剔除；但先把它重做一次再撤销，让地图回到“当时”的真实画面
    //    （后面那些步骤的 after 是在“目标还在”的画面下记的，直接剔掉会把目标的改动带回来）
    if (ed.redoStack[ed.redoStack.length - 1] !== target) { restore(); toast('找不到这一步，可能刚刚被撤销过'); return false; }
    ed.redo(); steps--;
    ed.undo(); steps++;
    const rest = ed.redoStack.filter((o) => o !== target);
    if (rest.length === ed.redoStack.length) { restore(); toast('找不到这一步，可能刚刚被撤销过'); return false; }
    ed.redoStack = rest;
    // 3) 重做后面的步骤。
    //    这些步骤的 before/after 是在“目标还在”的画面上记的，直接重做会把目标带回来。
    //    两步处理：①重做前先把 before 里“已经不在图上”的对象剔掉（setLiveObjects），
    //    让 apply 不会把它们装回去；②重做后再在新画面上重拍 after（redoAsNew）。
    let n = 0;
    while (ed.redoStack.length) {
      const next = ed.redoStack[ed.redoStack.length - 1];
      if (next && next.objs) for (const e of next.objs) next.setLiveObjects(e.group, e.group.objects);
      if (next && next.rebaseOnLive) next.rebaseOnLive();   // 格子 / 角点的“操作前”改成现在图上的样子，免得以后撤销时把被丢弃那步的改动带回来
      ed.redoAsNew(); next.lockLiveBefore(); steps--; n++;
    }
    ed.dirty = true;
    A.rend && A.rend.invalidateAll();
    if (A.hooks.mini) A.hooks.mini(); else A.mini && A.mini.rebuild();
    A.refresh();
    toast(n ? `已单独撤销「${target.label}」，后面的 ${n} 步保住了` : `已单独撤销「${target.label}」`, 3200);
    return true;
  } catch (e) { return fail(e); }
}

// 带确认框的版本（历史面板用）
export async function confirmDropOp(i) {
  const s = opInfo(i);
  if (!s) return false;
  if (s.whole) { toast('整图操作不能单独撤销'); return false; }
  const ok = await confirmBox('单独撤销这一步？',
    `会去掉这一步：\n「${s.label}」（${opStatsText(i)}）\n\n它后面的 ${Math.max(0, ed.undoStack.length - 1 - i)} 步会保留（按它们当时的改动重新落回去）。如果后面的步骤动过同一片格子，结果可能和原来不完全一样。`,
    '撤销这一步', '取消', true);
  if (!ok) return false;
  return dropOp(i);
}
