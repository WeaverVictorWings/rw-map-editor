// 夺城模板（3.3）：把标成“城市”的指挥中心做成可夺取的城，一键生成换主 / 重生 / 战报 / 奖励 / 随主人变色的地名
// 触发器组：生成的对象都带 rwGroup=capture，可整组移除、整组重新生成（改参数 = 重新生成）。
// 导出变体：完整 / 轻量（无地名、战报、奖励）/ 无触发器（测试用），以及去掉编辑器自己的数据组。
import { A } from './state.js';
import { HELP } from './help.js';
import { h, modal, toast, busy, select } from './ui.js';
import { objProp } from './tmx.js';
import { passability, LAND } from './pathing.js';
import { teamHex } from './triggers.js';
import { roleOf, allyMap, components } from './checks2.js';

Object.assign(HELP, {
  'tool.capture': { t: '夺城模板', s: '把城市指挥中心做成可夺取的城', b: '先把要夺的指挥中心标成<b>城市</b>（角色 city；地理工具的“放城市”会自动标）。本工具给每座城生成：摧毁指挥中心 → 3 秒后换主并在原地重生 → 占领满 20 秒才播报战报并送援军 → 地名随主人变色。参数改了就“重新生成”，旧的整组替换。' },
});

const ed = A.ed;
export const DEFAULTS = { flipDelay: 3, hold: 20, msgCooldown: 60, texts: null, detect: 3, reward: true, labels: true, messages: true, tiers: { 1: 'experimentalHoverTank*1', 2: 'experimentalSpider*1, experimentalHoverTank*1', 3: 'experimentalSpider*2, experimentalHoverTank*2' } };
const REWCN = { experimentalHoverTank: '实验悬浮坦克', experimentalSpider: '实验蜘蛛' };
const cnUnits = (s) => s.split(',').map((x) => { const [u, n] = x.trim().split('*'); return `${REWCN[u] || u}×${n}`; }).join('、');
export const TEMPLATES = [
  (c) => `【战报】${c.name}失守,${c.loser}撤出,${c.captor}进驻。`,
  (c) => `【战报】${c.captor}攻入${c.name},守军退出了城区。`,
  (c) => `【战报】${c.name}易手!${c.captor}旗帜已插上城头。`,
  (c) => `【战报】经过短暂交火,${c.captor}占领了${c.name}。`,
  (c) => `【战报】${c.name}落入${c.captor}之手,${c.loser}后撤。`,
  (c) => `【战报】${c.captor}突破${c.name}外围防线,控制了全城。`,
];

function mk(type, x, y, w, hh, props, name) {
  const p = [...Object.entries(props).map(([k, v]) => ({ name: k, value: String(v) })), { name: 'rwGroup', value: 'capture' }];
  return { attrs: { name, x: String(x), y: String(y), width: String(w), height: String(hh), type }, props: p, extra: [] };
}
export function cities(ed2 = ed) { return ed2.spawns().filter((s) => roleOf(s) === 'city'); }
export function markAsCities(minBuilderDist = 6) {
  const sp = ed.spawns(), units = ed.unitsGroup().objects;
  const builders = units.filter((o) => objProp(o, 'unit') === 'builder').map((o) => [+o.attrs.x, +o.attrs.y]);
  let n = 0; ed.begin('标记城市'); ed.op.snapshotGroup(ed.unitsGroup());
  for (const s of sp) {
    if (objProp(s.o, 'rwRole')) continue;
    const near = builders.some(([bx, by]) => Math.hypot(bx - s.cx, by - s.cy) < minBuilderDist * 20);
    if (!near) { s.o.props.push({ name: 'rwRole', value: 'city' }); n++; }
  }
  ed.commit(); return n;
}
// ---------- 在场式夺城（多方）----------
// 每座城有一组候选队伍 S（城主 + 几个够得着的邻队，可用 rwCand="3,5,12" 指定）。
// 城里所有候选队伍的指挥中心都没了（Z，持续 flipDelay 秒）→ 城“无主”；
// 此时哪一队在城区里有单位、且其它候选队伍都没有单位，指挥中心就给哪一队；多方在场则僵持，谁也不给。
export function buildCapturePresence(opt = {}) {
  const o = { ...DEFAULTS, ...opt }, ed2 = ed, m = ed2.map, W = m.width, H = m.height;
  const cs = o.includeStarts ? ed2.spawns().filter((s) => roleOf(s) !== 'deco') : cities(), starts = ed2.spawns().filter((s) => roleOf(s) === 'start');
  const ally = allyMap(ed2), out = [];
  const nameOf = (t) => (o.teamNames && o.teamNames[t]) || `${t + 1}号`;
  const K = o.candidates || 3;
  cs.forEach((c, i) => {
    const tx = Math.floor(c.cx / 20), ty = Math.floor(c.cy / 20), n = `cap${String(i).padStart(3, '0')}`;
    const nm = objProp(c.o, 'rwName') || `城${i + 1}`, owner = c.team, ownerAlly = ally.get(owner);
    let S = String(objProp(c.o, 'rwCand') || '').split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number);
    if (!S.length) {
      const near = starts.filter((s) => s.team !== owner && !(ownerAlly !== undefined && ally.get(s.team) === ownerAlly))
        .map((s) => ({ t: s.team, d: Math.hypot(s.cx - c.cx, s.cy - c.cy) })).sort((x, y) => x.d - y.d);
      S = near.map((x) => x.t);
    }
    const important = objProp(c.o, 'rwNews') !== '0';
    S = [owner, ...S.filter((t, k) => t !== owner && S.indexOf(t) === k)].slice(0, (important ? K : (o.candidatesMinor ?? K)) + 1);
const D = (tag, t) => (o.debug ? { globalMessage: `[诊]${nm} ${tag}${nameOf(t)}`, globalMessage_textColor: '#ff66ff' } : {});
    const core = [(tx - 1) * 20, (ty - 1) * 20, 60, 60], zone = [(tx - 3) * 20, (ty - 3) * 20, 140, 140], pt = [tx * 20, ty * 20, 20, 20];
    // 城区里有指挥中心（只用“至少 1 个”的正向计数，不依赖 maxUnits:0 / 不指定队伍 / delay 这些没验证过的语义）：每个候选队伍各一个
    S.forEach((t) => out.push(mk('unitDetect', ...core, { team: t, unitType: 'commandCenter', minUnits: 1, resetActivationAfter: o.debug ? '15s' : '2s', ...D('h有指挥中心 ', t), id: `${n}_h${t}` }, `${n}_h${t}`)));
    // 各队在城区的兵力（原始探测，用来互斥）
    S.forEach((t) => out.push(mk('unitDetect', ...zone, { team: t, minUnits: 1, onlyAttack: 'true', resetActivationAfter: '2s', id: `${n}_n${t}` }, `${n}_n${t}`)));
    // 无主之后，唯一在场的队伍才能占领
    S.forEach((t) => {
      const others = S.filter((u) => u !== t).map((u) => `${n}_n${u}`).join(',');
      const blockers = [others, ...S.map((u) => `${n}_h${u}`)].filter(Boolean).join(',');
      out.push(mk('unitDetect', ...zone, { team: t, minUnits: 1, onlyAttack: 'true', warmup: `${Math.max(o.flipDelay, 6)}s`, deactivatedBy: blockers, resetActivationAfter: '8s', ...D('c在场 ', t), id: `${n}_c${t}` }, `${n}_c${t}`));
      out.push(mk('unitAdd', ...pt, { spawnUnits: 'commandCenter*1', team: t, activatedBy: `${n}_c${t}`, resetActivationAfter: '30s', ...D('u刷出指挥中心 ', t), id: `${n}_u${t}` }, `${n}_u${t}`));
      // 战报：只有“真的夺下了城”（占领触发后指挥中心撑过 hold 秒）才播，且只给重要城市（rwNews=1）；开局不会触发，冷却很长
      if (o.messages && objProp(c.o, 'rwNews') !== '0') out.push(mk('unitDetect', ...core, { team: t, unitType: 'commandCenter', minUnits: 1, activatedBy: `${n}_u${t}`, warmup: `${o.hold}s`, ...(o.reportReset ? { resetActivationAfter: `${o.reportReset}s` } : {}), globalMessage: `【战报】${nameOf(t)}占领了${nm}。`, globalMessage_textColor: teamHex(t), id: `${n}_r${t}` }, `${n}_r${t}`));
    });
    if (o.labels) {
      const mr = [(tx - 3) * 20, (ty + 3) * 20, 140, 20];
      out.push(mk('mapText', ...mr, { text: nm, textSize: 8, textColor: '#FFFFFF', resetActivationAfter: '2s', id: `${n}_m` }, `${n}_m`));
    }
  });
  return out;
}
export function buildCapture(opt = {}) {
  const o = { ...DEFAULTS, ...opt }, m = ed.map, W = m.width, H = m.height, pass = passability(ed);
  const cs = o.includeStarts ? ed.spawns().filter((s) => roleOf(s) !== 'deco') : cities(), starts = ed.spawns().filter((s) => roleOf(s) === 'start'), ally = allyMap(ed), comp = components(ed, pass);
  const out = [];
  cs.forEach((c, i) => {
    const tx = Math.floor(c.cx / 20), ty = Math.floor(c.cy / 20), n = `cap${String(i).padStart(3, '0')}`;
    const nm = objProp(c.o, 'rwName') || `城${i + 1}`;
    const owner = c.team, ownerAlly = ally.get(owner);
    let rival = objProp(c.o, 'rwRival');
    if (rival === undefined) {
      let best = null;
      for (const s of starts) { if (s.team === owner || (ownerAlly !== undefined && ally.get(s.team) === ownerAlly)) continue; const d = Math.hypot(s.cx - c.cx, s.cy - c.cy); if (!best || d < best.d) best = { d, t: s.team }; }
      rival = best ? best.t : owner;
    }
    rival = +rival;
    const tier = +(objProp(c.o, 'rwReward') || 0);
    const rect = [(tx - 1) * 20, (ty - 1) * 20, 60, 60], pt = [tx * 20, ty * 20, 20, 20];
    const det = (name, team, mn, mx, extra = {}) => {
      const pr = { team, unitType: 'commandCenter', id: name, ...extra }; if (mn !== null) pr.minUnits = mn; if (mx !== null) pr.maxUnits = mx;
      return mk('unitDetect', ...rect, pr, name);
    };
    out.push(det(`${n}_px`, owner, 1, null, { resetActivationAfter: '2s' }), det(`${n}_py`, rival, 1, null, { resetActivationAfter: '2s' }));
    out.push(det(`${n}_lx`, owner, 0, 0, { warmup: `${o.flipDelay}s`, resetActivationAfter: '5s', deactivatedBy: `${n}_py` }), det(`${n}_ly`, rival, 0, 0, { warmup: `${o.flipDelay}s`, resetActivationAfter: '5s', deactivatedBy: `${n}_px` }));
    out.push(mk('unitAdd', ...pt, { spawnUnits: 'commandCenter*1', team: rival, activatedBy: `${n}_lx`, resetActivationAfter: '12s', id: `${n}_ux` }, `${n}_ux`), mk('unitAdd', ...pt, { spawnUnits: 'commandCenter*1', team: owner, activatedBy: `${n}_ly`, resetActivationAfter: '12s', id: `${n}_uy` }, `${n}_uy`));
    if (o.messages) {
      const nameOf = (t) => (o.teamNames && o.teamNames[t]) || `${t + 1}号`;
      const ctx = (loser, captor) => ({ name: nm, loser: nameOf(loser), captor: nameOf(captor) });
      const lib = (o.texts || []).map((t) => String(t).trim()).filter(Boolean);
      const fill = (t, c) => t.replace(/\{name\}/g, c.name).replace(/\{loser\}/g, c.loser).replace(/\{captor\}/g, c.captor);
      const txt = (loser, captor) => (lib.length ? fill(lib[i % lib.length], ctx(loser, captor)) : TEMPLATES[i % TEMPLATES.length](ctx(loser, captor)));
      const cd = o.msgCooldown > 0 ? { resetActivationAfter: `${o.msgCooldown}s` } : {};
      out.push(det(`${n}_hy`, rival, 1, null, { warmup: `${o.hold}s`, ...cd, globalMessage: txt(owner, rival), globalMessage_textColor: teamHex(rival) }));
      out.push(det(`${n}_hx`, owner, 1, null, { warmup: `${o.hold}s`, activatedBy: `${n}_hy`, ...cd, globalMessage: txt(rival, owner), globalMessage_textColor: teamHex(owner) }));
      if (o.reward && tier >= 1) {
        const mainland = comp.lblLand[ty * W + tx] === comp.mainLand.id;
        const n_ = tier === 1 ? 1 : 2, units = mainland ? o.tiers[Math.min(3, tier)] : `experimentalHoverTank*${n_}`;
        // 奖励落点：离指挥中心 2 格起逐圈外扩，只落在陆军能走的格子
        let spot = [tx, ty];
        outer: for (let r = 2; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const X = tx + dx, Y = ty + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && (pass[Y * W + X] & LAND)) { spot = [X, Y]; break outer; } }
        const rp = [spot[0] * 20, spot[1] * 20, 20, 20];
        out.push(mk('unitAdd', ...rp, { spawnUnits: units, team: rival, activatedBy: `${n}_hy`, globalMessage: `【战利品】${nameOf(rival)}占领${nm}后缴获装备:${cnUnits(units)}。`, globalMessage_textColor: '#FFD34D', id: `${n}_rx` }, `${n}_rx`));
        out.push(mk('unitAdd', ...rp, { spawnUnits: units, team: owner, activatedBy: `${n}_hx`, globalMessage: `【战利品】${nameOf(owner)}占领${nm}后缴获装备:${cnUnits(units)}。`, globalMessage_textColor: '#FFD34D', id: `${n}_ry` }, `${n}_ry`));
      }
    }
    if (o.labels) {
      const mr = [(tx - 3) * 20, (ty + 3) * 20, 140, 20];
      out.push(mk('mapText', ...mr, { text: nm, textSize: 8, textColor: teamHex(owner), activatedBy: `${n}_px`, resetActivationAfter: '1s', id: `${n}_mx` }, `${n}_mx`));
      out.push(mk('mapText', ...mr, { text: nm, textSize: 8, textColor: teamHex(rival), activatedBy: `${n}_py`, resetActivationAfter: '1s', id: `${n}_my` }, `${n}_my`));
    }
  });
  return out;
}
export function removeCapture() {
  const T = ed.map.group('Triggers'); if (!T) return 0;
  const keep = T.objects.filter((o) => objProp(o, 'rwGroup') !== 'capture'), n = T.objects.length - keep.length;
  if (!n) return 0;
  ed.begin('移除夺城触发器'); ed.op.snapshotGroup(T); T.objects = keep; ed.commit(); return n;
}
export function generateCapture(opt = {}) {
  const objs = (opt.mode === 'duel' ? buildCapture : buildCapturePresence)(opt); if (!objs.length) throw new Error('没有标成“城市”的指挥中心');
  const T = ed.map.ensureGroup('Triggers');
  ed.begin('生成夺城触发器'); ed.op.snapshotGroup(T);
  T.objects = T.objects.filter((o) => objProp(o, 'rwGroup') !== 'capture');
  T.objects.push(...objs); ed.commit();
  return objs.length;
}

// ---------------- 导出变体 ----------------
export async function exportVariant(kind = 'full', { stripEditor = false } = {}) {
  const { serializeOnce } = await import('./io.js');
  const m = ed.map, T = m.group('Triggers'), saveObjs = T ? T.objects : null, saveGroups = m.groups.slice();
  try {
    if (T) {
      if (kind === 'none') T.objects = saveObjs.filter((o) => !['unitDetect', 'unitAdd', 'mapText'].includes(o.attrs.type || ''));
      if (kind === 'lite') T.objects = saveObjs.filter((o) => !(o.attrs.type === 'mapText' || /^cap\d+_(hx|hy|rx|ry)$/.test(o.attrs.name || '')));
    }
    if (stripEditor) m.groups = m.groups.filter((g) => !/^Editor/.test(g.name));
    return await serializeOnce();
  } finally { if (T) T.objects = saveObjs; m.groups = saveGroups; }
}

// ---------------- 对话框 ----------------
export function captureDialog() {
  const m = ed.map; if (!m) return;
  const n = cities().length, st = {};
  const num = (v, w = 50) => { const i = h('input', { value: v, style: { width: w + 'px' } }); return i; };
  const flip = num(DEFAULTS.flipDelay), hold = num(DEFAULTS.hold);
  const cb = (label, v) => { const i = h('input', { type: 'checkbox' }); i.checked = v; return [h('label', { style: { marginRight: '10px' } }, i, ' ' + label), i]; };
  const [lRew, iRew] = cb('占领奖励', true), [lLab, iLab] = cb('随主人变色的地名', true), [lMsg, iMsg] = cb('战报', true);
  const say = h('div', { style: { margin: '6px 0', fontSize: '12px' } }, `当前标为城市的指挥中心：${n} 个`);
  const cool = num(DEFAULTS.msgCooldown), lib = h('textarea', { rows: 4, style: { width: '100%', fontSize: '12px' }, placeholder: '战报文本库，每行一条，可用 {name}城名 {loser}失守方 {captor}占领方；留空用内置 6 条模板' });
  import('./util.js').then(async (u) => { const v = await u.kvGet('battleTexts'); if (v) lib.value = v; });
  const opts = () => { const t = lib.value; import('./util.js').then((u) => u.kvSet('battleTexts', t)); return { flipDelay: +flip.value || 3, hold: +hold.value || 20, msgCooldown: Math.max(0, +cool.value || 0), texts: t.split('\n'), reward: iRew.checked, labels: iLab.checked, messages: iMsg.checked }; };
  const dl = async (kind, fname) => { const text = await busy('生成文件…', () => exportVariant(kind, { stripEditor: true })); const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/xml' })), download: fname }); document.body.append(a); a.click(); a.remove(); };
  const body = h('div', { style: { minWidth: '460px' } },
    h('p', {}, '先标城市，再生成。生成的触发器整组可移除、整组重新生成。'),
    h('div', {}, h('button', { onclick: () => { const k = markAsCities(); say.textContent = `新标了 ${k} 个城市（共 ${cities().length} 个）`; } }, '把没有建造者的指挥中心标成城市')),
    h('div', { style: { marginTop: '8px' } }, '换主延迟(秒) ', flip, ' 占领满(秒)才播报 ', hold),
    h('div', { style: { marginTop: '6px' } }, lRew, lLab, lMsg),
    h('div', { style: { marginTop: '6px' } }, '同一条战报最短间隔(秒，0=不限) ', cool), lib,
    h('div', { style: { marginTop: '6px' } }, h('button', { title: '每个城市附近 3~7 格找可建造的空地放资源池', onclick: async () => { try { const m = await import('./tools331.js'); const r = m.addCityPools(1); say.textContent = `补了 ${r.placed} 个资源池` + (r.missed.length ? `，这些城市附近放不下：${r.missed.slice(0, 8).join(' ')}` : ''); A.rend.invalidateAll(); } catch (e) { say.textContent = '失败：' + e.message; } } }, '给每个城市补 1 个资源池')),
    h('div', { style: { marginTop: '8px' } },
      h('button', { class: 'primary', onclick: async () => { try { const k = await busy('生成中…', async () => generateCapture(opts())); say.textContent = `已生成 ${k} 个触发器（Ctrl+Z 可撤销）`; } catch (e) { say.textContent = '失败：' + e.message; } } }, '生成 / 重新生成'), ' ',
      h('button', { onclick: () => { say.textContent = `已移除 ${removeCapture()} 个`; } }, '整组移除')),
    h('div', { style: { marginTop: '10px' } }, h('b', {}, '导出变体（去掉编辑器自己的数据）：'), h('br', {}),
      h('button', { onclick: () => dl('full', 'map-完整版.tmx') }, '完整版'), ' ', h('button', { onclick: () => dl('lite', 'map-轻量版.tmx') }, '轻量版（无地名/战报/奖励）'), ' ', h('button', { onclick: () => dl('none', 'map-无触发器版.tmx') }, '无触发器版')),
    say);
  modal('夺城模板', body, [{ label: '关闭' }]);
}
