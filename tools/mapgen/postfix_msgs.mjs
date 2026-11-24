#!/usr/bin/env node
// 出图后的文字收尾(生成脚本之后跑一遍,幂等;不管文件里一行一个对象还是全挤在一行):
//  1. 消息里的半角标点改全角,成对的半角引号改成 “ ”
//  2. 一条接一条播出的纯消息触发器链:前一条没说完(不是句号/问号/叹号/省略号收尾)就并进来,
//     每条最多 3 行、每行 ≤30 字;后面的触发器改接到合并后的那条,等待时间按字数重算
//  3. 任何一行超过 30 字的消息,在标点处断行;行首是标点的,把标点挪到上一行末尾
//  4. 仍然以逗号/顿号/分号结尾的消息,把结尾改成句号
//  5. 去掉 map_info 里的 loseCondition(游戏 1.15 起已删除)
// 用法: node tools/mapgen/postfix_msgs.mjs 输入.tmx 输出.tmx [--no-merge] [--report]
import fs from 'node:fs';
import { toFullwidth } from '../../kit/text35.js';

const args = process.argv.slice(2), flags = args.filter((a) => a.startsWith('--')), [inp, outp] = args.filter((a) => !a.startsWith('--'));
if (!inp || (!outp && !flags.includes('--report'))) { console.error('用法: node tools/mapgen/postfix_msgs.mjs 输入.tmx 输出.tmx [--no-merge] [--report]'); process.exit(2); }
if (outp && fs.existsSync(outp)) { console.error(`拒绝覆盖已有文件 ${outp}`); process.exit(2); }
const noMerge = flags.includes('--no-merge');
const clen = (s) => [...s].length;
const unesc = (s) => s.replace(/&#10;/g, '\n').replace(/&#xA;/gi, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
const propRe = (name) => new RegExp(`<property name="${name}" value=("[^"]*"|'[^']*')\\s*/>`);
const getProp = (seg, name) => { const m = seg.match(propRe(name)); return m ? unesc(m[1].slice(1, -1)) : null; };
const setProp = (seg, name, val) => propRe(name).test(seg) ? seg.replace(propRe(name), () => `<property name="${name}" value="${esc(val)}"/>`) : seg.replace(/<\/properties>/, () => `<property name="${name}" value="${esc(val)}"/></properties>`);
const TAIL = /[，、；：,;:]$/;
const LEAD = /^[，。、！？；：）”」》…]/;

// 断行:优先在标点之后断,其次在左括号/引号之前断;下一行不能以标点开头
const BRK_AFTER = new Set([...'，。、！？；：…']), BRK_BEFORE = new Set([...'（“「《【']);
function softWrap(line, w) {
  const cs = [...line]; if (cs.length <= w) return [line];
  let at = 0;
  for (let i = w; i >= 1; i--) { if ((BRK_AFTER.has(cs[i - 1]) || BRK_BEFORE.has(cs[i])) && cs[i] && !LEAD.test(cs[i])) { at = i; break; } }
  if (!at) { for (let i = w; i >= 1; i--) if (cs[i] && !LEAD.test(cs[i])) { at = i; break; } }
  if (!at) at = w;
  return [cs.slice(0, at).join(''), ...softWrap(cs.slice(at).join(''), w)];
}
const text = fs.readFileSync(inp, 'utf8');
// 把文件切成 [文字, 对象, 文字, 对象, …];对象 = <object …/> 或 <object …>…</object>
const parts = []; { const re = /<object\b[^>]*?(?:\/>|>[\s\S]*?<\/object>)/g; let last = 0, m; while ((m = re.exec(text))) { parts.push({ t: text.slice(last, m.index) }); parts.push({ o: m[0] }); last = m.index + m[0].length; } parts.push({ t: text.slice(last) }); }
const objs = parts.filter((p) => p.o !== undefined);
const nameOf = (seg) => (seg.match(/^<object\b[^>]*?\bname="([^"]*)"/) || [])[1] || '';
const typeOf = (seg) => (seg.match(/^<object\b[^>]*?\btype="([^"]*)"/) || [])[1] || '';
const stats = { punct: 0, quotes: 0, wrapped: 0, merged: 0, commaEnd: 0, lead: 0, lose: 0 };

// ---- 1. 标点/引号 ----
for (const p of objs) {
  const msg = getProp(p.o, 'globalMessage'); if (msg === null) continue;
  let m = msg.replace(/\(([^()]*[\u3400-\u9fff][^()]*)\)/g, '\uff08$1\uff09'); // 括号里有汉字的,换行也算
  m = toFullwidth(m);
  m = m.replace(/(?<=[\u3400-\u9fff\uff00-\uffef\u3000-\u303f\u2026])\.{2,}/g, '\u2026\u2026').replace(/(?<=[\u3400-\u9fff\uff01-\uffef\u3000-\u303f])\.(?!\d)/g, '\u3002');
  m = m.replace(/"([^"\n]*[㐀-鿿][^"\n]*)"/g, (_, a) => { stats.quotes++; return `“${a}”`; });
  m = toFullwidth(m); // 引号换成全角后,紧跟在引号后面的半角标点也要换
  if (m !== msg) { stats.punct++; p.o = setProp(p.o, 'globalMessage', m); }
}

// ---- 2. 连播合并 ----
const OK_KEYS = new Set(['globalMessage', 'globalMessage_textColor', 'team', 'activatedBy', 'deactivatedBy', 'warmup', 'delay']);
const info = (p) => { const props = {}; for (const m of p.o.matchAll(/<property name="([^"]*)" value=("[^"]*"|'[^']*')\s*\/>/g)) props[m[1]] = unesc(m[2].slice(1, -1)); return props; };
const dropped = new Set(), renamed = new Map();
if (!noMerge) {
  const by = new Map(); for (const p of objs) { const n = nameOf(p.o); if (n) by.set(n, p); }
  const deps = new Map(); // 谁被谁激活
  for (const p of objs) { const a = getProp(p.o, 'activatedBy'); if (!a) continue; for (const t of a.split(',').map((s) => s.trim()).filter(Boolean)) { if (!deps.has(t)) deps.set(t, []); deps.get(t).push(nameOf(p.o)); } }
  const isMsg = (p) => { if (!p || typeOf(p.o) !== 'unitAdd') return false; const pr = info(p); if (pr.globalMessage === undefined || pr.spawnUnits || pr.unit) return false; return Object.keys(pr).every((k) => OK_KEYS.has(k)); };
  const timeKey = (pr) => (pr.warmup !== undefined ? 'warmup' : pr.delay !== undefined ? 'delay' : 'warmup');
  const actOf = (p) => (info(p).activatedBy || '').split(',').map((x) => x.trim()).filter(Boolean);
  const follow = (last) => { const nx = deps.get(nameOf(last.o)) || []; if (nx.length !== 1) return null; const n = by.get(nx[0]); return isMsg(n) && actOf(n).join(',') === nameOf(last.o) ? n : null; };
  const processed = new Set();
  const mergeFrom = (head) => {
    processed.add(head);
    const hpr = info(head), hn = nameOf(head.o); let lines = hpr.globalMessage.split('\n'), last = head;
    for (;;) {
      if (!TAIL.test(lines.join('').trim())) break; // 只有以逗号/顿号/分号收尾的才算没说完(没标点的是标题行)
      const np = follow(last); if (!np || processed.has(np) || dropped.has(np)) break;
      const npr = info(np);
      if ((npr.team ?? '') !== (hpr.team ?? '') || (npr.globalMessage_textColor ?? '') !== (hpr.globalMessage_textColor ?? '') || (npr.deactivatedBy ?? '') !== (hpr.deactivatedBy ?? '')) break;
      const add = npr.globalMessage.split('\n'); if (lines.length + add.length > 3) break;
      lines = lines.concat(add); processed.add(np); dropped.add(np); renamed.set(nameOf(np.o), hn); stats.merged++; last = np;
    }
    if (last !== head) { head.o = setProp(head.o, 'globalMessage', lines.join('\n')); head.merged = clen(lines.join('')); }
    head.lastName = nameOf(last.o);
    return last;
  };
  for (const p of objs) {
    if (processed.has(p) || dropped.has(p) || !isMsg(p)) continue;
    let s0 = p, guard = 0; // 先退到这条链的开头
    for (;;) { const a = actOf(s0); if (a.length === 1 && guard++ < 10000) { const pr = by.get(a[0]); if (isMsg(pr) && (deps.get(a[0]) || []).length === 1 && !processed.has(pr)) { s0 = pr; continue; } } break; }
    for (let cur = s0; cur && !processed.has(cur);) { const last = mergeFrom(cur); cur = follow(last); }
  }
  // 依赖改接:原来接"链尾/被并掉的名字"的,改接合并后的链头;等待时间按合并后那条的字数重算
  const tailToHead = new Map(); for (const p of objs) if (p.lastName && p.lastName !== nameOf(p.o)) tailToHead.set(p.lastName, nameOf(p.o));
  for (const p of objs) {
    if (dropped.has(p)) continue;
    for (const k of ['activatedBy', 'deactivatedBy']) {
      const v = getProp(p.o, k); if (v === null) continue;
      const parts2 = v.split(',').map((s) => s.trim()); const np = [...new Set(parts2.map((t) => tailToHead.get(t) || renamed.get(t) || t))];
      if (np.join(',') !== parts2.join(',')) { p.o = setProp(p.o, k, np.join(',')); if (k === 'activatedBy' && isMsg(p)) p.retime = [...new Set(parts2.map((t) => tailToHead.get(t)).filter(Boolean))][0]; }
    }
  }
  for (const p of objs) if (p.retime && !dropped.has(p)) { const src = by.get(p.retime); const chars = src.merged || clen((getProp(src.o, 'globalMessage') || '').replace(/\n/g, '')); const secs = Math.max(3, Math.min(9, Math.ceil(chars * 0.13))); const pr = info(p); p.o = setProp(p.o, timeKey(pr), `${secs}s`); }
}

// ---- 3/4. 超长行、行首标点、结尾逗号 ----
for (const p of objs) {
  if (dropped.has(p)) continue;
  let msg = getProp(p.o, 'globalMessage'); if (msg === null) continue;
  let m = msg;
  if (m.split('\n').some((l) => clen(l) > 30)) { m = m.split('\n').flatMap((l) => softWrap(l, 30)).join('\n'); stats.wrapped++; }
  if (m.includes('\n')) { const ls = m.split('\n'); for (let i = 1; i < ls.length; i++) { while (ls[i] && LEAD.test(ls[i]) && clen(ls[i - 1]) < 30) { ls[i - 1] += ls[i][0]; ls[i] = ls[i].slice(1); stats.lead++; } } m = ls.filter((l, i) => l || i === 0).join('\n'); }
  if (TAIL.test(m.trim())) { m = m.replace(/[，、；：,;:]\s*$/, '。'); stats.commaEnd++; }
  if (m !== msg) p.o = setProp(p.o, 'globalMessage', m);
}

// ---- 5. loseCondition ----
for (const p of objs) if (/<property name="loseCondition"/.test(p.o)) { p.o = p.o.replace(/<property name="loseCondition" value="[^"]*"\s*\/>/, ''); stats.lose++; }

if (flags.includes('--report')) { console.log(JSON.stringify(stats), `并掉 ${dropped.size}`); if (!outp) process.exit(0); }
const skip = new Set(); parts.forEach((p, i) => { if (dropped.has(p)) { skip.add(p); if (i > 0 && parts[i - 1].t !== undefined && /^\s*$/.test(parts[i - 1].t)) skip.add(parts[i - 1]); } });
let res = parts.filter((p) => !skip.has(p)).map((p) => (p.t !== undefined ? p.t : p.o)).join('');
res = res.replace(/<property name="loseCondition" value="[^"]*"\s*\/>/g, () => { stats.lose++; return ''; }); // map_info 以外的地方(比如地图级属性)也一并去掉
fs.writeFileSync(outp, res);
console.log(`标点/引号改了 ${stats.punct} 条(引号 ${stats.quotes} 对);连播并掉 ${dropped.size} 个触发器;超长行断开 ${stats.wrapped} 条;行首标点挪回上一行 ${stats.lead} 处;结尾逗号改句号 ${stats.commaEnd} 条;去掉 loseCondition ${stats.lose} 处`);
console.log('已写入', outp);
