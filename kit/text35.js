// RWKit 3.5 · 文本/新闻工具(D71–D85,不含已取消的 73 风格库、83 禁用词）
// 全部是纯函数：要么返回文本/行/表格，要么返回改过的 TMX 文本。
import { triggersOf, trigKey, unitsOf } from './tmx.js';
import { mapTriggers, exportTexts, importTexts, expandVars } from './refactor.js';
import { parseTimeFlex } from './schema35.js';

const MSGPROPS = ['globalMessage', 'text', 'introText'];
const clen = (s) => [...String(s)].length;
const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const CJKC = '[\\u3400-\\u9fff\\u3000-\\u303f\\uff00-\\uffef\\u300d\\u300f\\u3011\\u300b\\u201d\\u2019\\u2026]';
// 半角标点 → 全角（只处理紧挨着汉字的；数字里的 1,000 / 12:30 不动）
export function toFullwidth(s) {
  const L = new RegExp('(?<=' + CJKC + ')([,:!?;])|(,)(?=' + CJKC + ')', 'g');
  const M = { ',': '\uff0c', ':': '\uff1a', '!': '\uff01', '?': '\uff1f', ';': '\uff1b', ')': '\uff09', '(': '\uff08' };
  const pair = (x) => String(x).replace(/\(([^()\n]*?[\u3400-\u9fff][^()\n]*?)\)/g, '\uff08$1\uff09');
  const f = (x) => String(x).replace(L, (m) => M[m] || m);
  return f(f(pair(s)));
}
// 把整张地图里所有消息文字的标点改成全角；返回 {text, changed, chars}
export function fixPunct(text) {
  let chars = 0; const out = mapTriggers(text, (a, p) => { let ch = false; const np = { ...p }; for (const k of Object.keys(p)) { if (!MSGPROPS.some((b) => k === b || k.startsWith(b + '_')) || /_(textColor|delayPerChar)$/.test(k)) continue; const v = toFullwidth(p[k]); if (v !== p[k]) { chars += [...p[k]].filter((c, i) => c !== [...v][i]).length; np[k] = v; ch = true; } } return ch ? { props: np } : null; });
  return { ...out, chars };
}
const fmtMs = (ms) => (ms % 1000 === 0 ? `${ms / 1000}s` : `${Math.round(ms)}ms`);

// ---------- 排版：硬性每行 ≤ w 字，优先在标点处断，整句不拆开 ----------
export function splitSentences(text) { return (String(text).replace(/\n/g, '').match(/[^\u3002\uff01\uff1f!?\uff1b;\u2026]+[\u3002\uff01\uff1f!?\uff1b;\u2026]*/g) || []).map((s) => s.trim()).filter(Boolean); }
export function wrapHard(text, w = 30) {
  const lines = [];
  for (const raw of String(text).split('\n')) {
    let cur = '';
    const parts = raw.match(/[^\uff0c,\u3001\uff1a:\uff1b;]+[\uff0c,\u3001\uff1a:\uff1b;]*/g) || [raw];
    for (let p of parts) {
      while (clen(p) > w) { if (cur) { lines.push(cur); cur = ''; } const cs = [...p]; lines.push(cs.slice(0, w).join('')); p = cs.slice(w).join(''); }
      if (clen(cur) + clen(p) > w && cur) { lines.push(cur); cur = ''; }
      cur += p;
    }
    if (cur) lines.push(cur);
  }
  return lines.join('\n');
}
// 把一段话切成若干条消息：每条最多 maxLines 行，每行 ≤ w 字；整句不拆开（句子太长才在逗号处拆）
export function chunkMessages(text, { w = 30, maxLines = 3 } = {}) {
  const sents = splitSentences(text), msgs = []; let cur = [];
  const flush = () => { if (cur.length) { msgs.push(cur.join('\n')); cur = []; } };
  for (const s of sents) { const lines = wrapHard(s, w).split('\n'); if (cur.length && cur.length + lines.length > maxLines) flush(); cur.push(...lines); if (cur.length >= maxLines) flush(); }
  flush(); return msgs;
}

// ---------- D81 逐条延迟自动编排 ----------
// 读完一条需要的时间 ≈ 字数 × perCharMs,夹在 [minMs,maxMs];条与条之间再留 gapMs
export function autoDelays(msgs, { perCharMs = 130, minMs = 2600, maxMs = 9000, gapMs = 500, startMs = 0 } = {}) {
  let t = startMs; return msgs.map((m) => { const at = t, dur = Math.max(minMs, Math.min(maxMs, clen(String(m).replace(/\n/g, '')) * perCharMs)); t += dur + gapMs; return { text: m, at: Math.round(at), dur: Math.round(dur) }; });
}

// ---------- D71 覆灭文本生成器 ----------
// 草稿生成器：按"战局→抵抗→崩溃→首都→余波→评价"六段铺开，凑到目标字数。想要更像原模组的味道，请用 facts 塞入这个势力自己的细节。
const POOL = {
  open: ['{name}最后的指挥中心，在炮火中沉默了。', '{foe}的先头部队冲进了{capital},{name}的旗帜在硝烟里摇晃。', '电台里最后一道命令发出之后，{name}的大本营再也没有回音。', '消息传遍了战场:{name}的统帅部，陷落了。'],
  fight: ['街垒前，守军打光了最后一发炮弹，仍有人举着残旗不肯后退。', '最后一夜，{capital}的钟声响了很久，随后被炮声盖过。', '工厂里的工人放下扳手拿起了枪，可钢铁洪流不会因勇气而停步。', '弹药耗尽的炮兵拆下炮闩，宁可毁掉火炮，也不让它落入敌手。', '老兵们在街角列成最后一道防线，身后是来不及撤走的家人。'],
  crash: ['防线像被潮水冲垮的堤坝，各路部队失去联络，残部四散。', '补给线被一刀切断，前线的将士这才发现，身后已经没有退路。', '一座座据点相继熄火，雷达屏幕上{name}的光点一个接一个暗了下去。', '指挥链断裂的瞬间，命令变成了传言，传言又变成了溃逃。'],
  fall: ['{foe}的战旗插上了{capital}的最高处，在风中猎猎作响。', '{capital}的广场上，胜利者的履带碾过{name}曾经的阅兵场。', '城头换了旗，昨日的繁华，只剩断壁和余烟。'],
  after: ['幸存者们躲进地下室，听着头顶的履带声一阵阵远去。', '港口里的船只在火光中起锚，不知道能驶向何方。', '电报机还在滴滴作响，却再也等不到回电。', '田野无人收割，街道无人清扫，只有风穿过空荡的城。', '流亡者带着一把故土的泥，在陌生的海岸点起了第一堆篝火。'],
  verdict: ['{name}从此从地图上消失，但这片土地上的故事，并未就此写完。', '史书会记下{name}的名字，也会记下它是怎样倒下的。', '一个时代落幕了，而{foe}的目光，已经投向下一片战场。', '{name}倒下了，可它留下的伤口，会让所有人记很久。'],
  filler: ['这一仗打了很久，久到许多人已经忘了当初为何而战。', '每一座倒塌的城市背后，都有一个没来得及说完的名字。', '战争从不问谁对谁错，它只记得谁还站着。', '烽烟散去之后，留下的只有沉默的废墟和漫长的黎明。'],
};
export function eliminationText({ name, capital = '首都', foe = '敌军', facts = [], chars = 200, seed = 1, w = 30, maxLines = 3, perCharMs } = {}) {
  const r = rng(seed + name.length * 131), pick = (a) => a[Math.floor(r() * a.length)]; const fill = (s) => toFullwidth(expandVars(s, { name, capital, foe }));
  const order = ['open', 'fight', 'crash', 'fall', 'after', 'verdict']; const chosen = {}; order.forEach((k) => { chosen[k] = [fill(pick(POOL[k]))]; });
  const extraPool = [...POOL.fight, ...POOL.crash, ...POOL.after, ...POOL.filler].map(fill);
  const total = () => order.reduce((a, k) => a + chosen[k].reduce((b, s) => b + clen(s), 0), 0) + facts.reduce((a, s) => a + clen(s), 0);
  let guard = 0; const used = new Set(Object.values(chosen).flat());
  while (total() < chars * 0.92 && guard++ < 40) { const k = pick(['fight', 'crash', 'after']), s = pick(extraPool); if (used.has(s)) continue; used.add(s); chosen[k].push(s); }
  while (total() > chars * 1.15 && guard++ < 80) { const k = ['after', 'crash', 'fight'].find((q) => chosen[q].length > 1); if (!k) break; chosen[k].pop(); }
  const seq = [...chosen.open, ...chosen.fight, ...chosen.crash, ...facts, ...chosen.fall, ...chosen.after, ...chosen.verdict];
  const msgs = chunkMessages(seq.join(''), { w, maxLines }); const plan = autoDelays(msgs, perCharMs ? { perCharMs } : {});
  return { messages: msgs, plan, chars: seq.join('').length, text: msgs.join('\n') };
}

// ---------- D72 开场快放 ----------
// 把"势力介绍"这类开局消息按整句重新分条，并压缩到 budgetSec 内放完
export function compressIntro(model, { budgetSec = 60, keyRe = /^(开场|intro)/i, perCharMs = 100, minMs = 2200, gapMs = 400, startMs = 2000, w = 30 } = {}) {
  const rows = []; for (const o of triggersOf(model)) { if (!keyRe.test(trigKey(o)) || o.props.activatedBy) continue; const p = MSGPROPS.find((k) => o.props[k]); if (!p) continue; const d = parseTimeFlex(o.props.delay), wu = parseTimeFlex(o.props.warmup); const at = (d && !Number.isNaN(d.ms) ? d.ms : 0) + (wu && !Number.isNaN(wu.ms) ? wu.ms : 0); rows.push({ key: trigKey(o), prop: p, text: o.props[p], at }); }
  rows.sort((a, b) => a.at - b.at); if (!rows.length) return { plan: [], total: 0, before: 0, scale: 1 };
  const before = rows[rows.length - 1].at;
  const dur = rows.map((r) => Math.max(minMs, clen(r.text.replace(/\n/g, '')) * perCharMs)); const sum = dur.reduce((a, b) => a + b + gapMs, 0), avail = budgetSec * 1000 - startMs, scale = sum > avail ? Math.max(0.5, avail / sum) : 1;
  let t = startMs; const plan = rows.map((r, i) => { const at = Math.round(t); t += (dur[i] + gapMs) * scale; return { key: r.key, oldMs: r.at, newMs: at, lines: r.text.split('\n').length, longest: Math.max(...r.text.split('\n').map(clen)) }; });
  const total = plan[plan.length - 1].newMs; return { plan, total, before, scale: +scale.toFixed(2), tooLong: total > budgetSec * 1000, w };
}
export function applyTimes(text, plan) {
  const m = new Map(plan.map((p) => [p.key, p.newMs]));
  return mapTriggers(text, (a, p, k) => { if (!m.has(k)) return null; const np = { ...p }; delete np.warmup; np.delay = fmtMs(m.get(k)); return { props: np }; });
}

// ---------- D74 按阵营给文本着色 ----------
// rules: [{test: '太约'|RegExp, color:'#4fa3ff'}],命中第一条；neutral 给没命中的（如金色）。只改文字颜色属性 xxx_textColor
export function applyCampColors(text, rules, { neutral = null, onlyMissing = false } = {}) {
  const res = rules.map((r) => ({ re: r.test instanceof RegExp ? r.test : new RegExp(String(r.test).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), color: r.color })); let hits = 0;
  const out = mapTriggers(text, (a, p) => { let ch = false; const np = { ...p }; for (const base of MSGPROPS) { if (!p[base]) continue; const hit = res.find((r) => r.re.test(p[base])); const c = hit ? hit.color : neutral; if (!c) continue; const key = base + '_textColor'; if (onlyMissing && p[key]) continue; if (np[key] !== c) { np[key] = c; ch = true; hits++; } } return ch ? { props: np } : null; });
  return { ...out, hits };
}

// ---------- D75 战报模板 ----------
const REPORT = {
  neutral: ['{who}占领了{city},这座城市从此升起了新的旗帜。', '{city}易主:{who}的部队接管了全部设施。', '{who}的先锋踏入{city},守军望风而降。'],
  enemy: ['警报！{who}攻占了{city},前线形势急转直下。', '{city}失守，{who}的战旗已经飘在城头。', '{city}陷落了——{who}的钢铁洪流碾过了最后的街垒。'],
  recapture: ['{who}夺回了{city}!失地终于收复。', '{city}重回{who}之手，这一仗打得漂亮。', '反攻得手:{who}的部队重新占领了{city}。'],
  ally: ['盟友{who}占领了{city},战线继续向前推进。', '{city}落入盟军之手:{who}的旗帜升起。'],
  lost: ['我们失去了{city}!快组织反击。', '{city}被夺走了，{who}的部队就在城里。'],
};
export const REPORT_EVENTS = Object.keys(REPORT);
export function reportLines(event, ctx, { w = 30, seed = 1, all = false } = {}) {
  const pool = REPORT[event]; if (!pool) throw new Error('事件类型只能是:' + REPORT_EVENTS.join('/')); const r = rng(seed + clen(ctx.city || ''));
  const make = (s) => wrapHard(toFullwidth(expandVars(s, { who: ctx.who || '', city: ctx.city || '', from: ctx.from || '' })), w);
  return all ? pool.map(make) : [make(pool[Math.floor(r() * pool.length)])];
}
export function reportRows(cities, event, { who = '{who}', seed = 1 } = {}) { return cities.map((c, i) => ({ city: c, text: reportLines(event, { city: c, who }, { seed: seed + i })[0] })); }

// ---------- D76 / D85 名称替换与占位符 ----------
// map: {'东亚战区':'中国','华北战区':'中国'};所有消息文字里的旧名换成新名
export function renameInTexts(text, map, { props = MSGPROPS } = {}) {
  let hits = 0; const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const out = mapTriggers(text, (a, p) => { let ch = false; const np = { ...p }; for (const k of Object.keys(p)) { if (!props.some((b) => k === b || k.startsWith(b + '_')) || /_(textColor|delayPerChar)$/.test(k)) continue; let v = p[k]; for (const old of keys) if (v.includes(old)) { v = v.split(old).join(map[old]); hits++; } if (v !== p[k]) { np[k] = v; ch = true; } } return ch ? { props: np } : null; });
  return { ...out, hits };
}
export function placeholderTable(model) {
  const used = new Map(); for (const o of triggersOf(model)) for (const [k, v] of Object.entries(o.props)) { if (!MSGPROPS.some((b) => k === b || k.startsWith(b + '_'))) continue; for (const m of String(v).matchAll(/\{([^{}\s]+)\}/g)) { if (!used.has(m[1])) used.set(m[1], []); used.get(m[1]).push(trigKey(o)); } }
  return [...used.entries()].map(([name, keys]) => ({ name, count: keys.length, keys: keys.slice(0, 5) }));
}
export function lintPlaceholders(model, vars = {}) {
  const out = []; for (const row of placeholderTable(model)) { if (!(row.name in vars)) out.push({ sev: 'error', code: 'D85', msg: `占位符 {${row.name}} 出现 ${row.count} 次但没有给值（如 ${row.keys[0]}），游戏里会原样显示成 {${row.name}}`, key: row.keys[0], level: '模型验证' }); }
  for (const k of Object.keys(vars)) if (!placeholderTable(model).some((r) => r.name === k)) out.push({ sev: 'info', code: 'D85', msg: `变量 ${k} 定义了但没有任何文字用到`, level: '模型验证' });
  return out;
}

// ---------- D77 文本导出/导入（按势力/关键字筛选） ----------
export function exportTextsFiltered(text, { match = null, keyMatch = null } = {}) {
  const csv = exportTexts(text); if (!match && !keyMatch) return csv; const re = match ? new RegExp(match) : null, kre = keyMatch ? new RegExp(keyMatch) : null;
  const rows = parseCsvRows(csv); const head = rows.shift(); const keep = rows.filter((r) => (!re || re.test(r[2])) && (!kre || kre.test(r[0])));
  return [head, ...keep].map((r) => r.map(csvq).join(',')).join('\n') + '\n';
}
const csvq = (s) => (/[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""').replace(/\n/g, '\\n') + '"' : s);
function parseCsvRows(s) { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows.map((r) => r.map((x) => x.replace(/\\n/g, '\n'))); }
export { importTexts };

// ---------- D78 文本统计面板 ----------
export function textPanel(model, ref = null) {
  const lens = [], lines = [], per = []; for (const o of triggersOf(model)) for (const [k, v] of Object.entries(o.props)) { if (!MSGPROPS.includes(k) || !v) continue; const ls = String(v).split('\n'); lens.push(ls.reduce((a, l) => a + clen(l), 0)); ls.forEach((l) => lines.push(clen(l))); per.push({ key: trigKey(o), chars: lens[lens.length - 1], maxLine: Math.max(...ls.map(clen)) }); }
  const sorted = lens.slice().sort((a, b) => a - b), one = (a) => ({ count: a.length, chars: a.reduce((x, y) => x + y, 0), median: a[a.length >> 1] || 0, max: a[a.length - 1] || 0 });
  const s = one(sorted); s.maxLine = Math.max(0, ...lines); s.over30 = lines.filter((l) => l > 30).length; s.longest = per.sort((a, b) => b.maxLine - a.maxLine).slice(0, 5);
  if (ref) { const r = textPanel(ref); s.ref = { count: r.count, chars: r.chars, median: r.median }; s.ratio = { count: r.count ? +(s.count / r.count).toFixed(2) : null, chars: r.chars ? +(s.chars / r.chars).toFixed(2) : null }; }
  return s;
}

// ---------- D79 屏幕预览 ----------
// 模拟游戏左上角的消息框:cols=一行能放的"字"数；全角算 1 字，半角算 0.5
export function screenPreview(msg, { cols = 30 } = {}) {
  const wd = (l) => [...l].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 1 : 0.5), 0); const lines = String(msg).split('\n'); const over = lines.map((l, i) => ({ i: i + 1, w: wd(l) })).filter((x) => x.w > cols);
  const box = ['┌' + '─'.repeat(cols) + '┐', ...lines.map((l) => '│' + l + ' '.repeat(Math.max(0, Math.round(cols - wd(l)))) + (wd(l) > cols ? '→溢出' : '') + '│'), '└' + '─'.repeat(cols) + '┘'].join('\n');
  return { box, over, ok: !over.length, lines: lines.length, maxW: Math.max(...lines.map(wd)) };
}

// ---------- D80 / B31 标点配对检查 ----------
const PAIRS = [['「', '」'], ['『', '』'], ['\uff08', '\uff09'], ['(', ')'], ['《', '》'], ['“', '”'], ['【', '】'], ['[', ']']];
export function lintPunct(model) {
  const out = [], add = (sev, code, msg, o) => out.push({ sev, code, msg, key: o ? trigKey(o) : undefined, level: '模型验证' });
  for (const o of triggersOf(model)) for (const base of MSGPROPS) {
    const v = o.props[base]; if (!v) continue; const flat = String(v).replace(/\n/g, '');
    for (const [a, b] of PAIRS) { const na = flat.split(a).length - 1, nb = flat.split(b).length - 1; if (na !== nb) add('warn', 'D80', `${a}${b} 不成对（${na} 个开、${nb} 个关）`, o); }
    if ((flat.match(/"/g) || []).length % 2) add('warn', 'D80', '英文双引号数量是奇数', o);
    if (/[,.!?;:]/.test(flat) && /[一-鿿]/.test(flat)) { const m = flat.match(/[一-鿿][,.!?;:]|[,.!?;:][一-鿿]/); if (m) add('info', 'D80', `中文里混了半角标点「${m[0]}」（游戏里间距会难看）`, o); }
    if (/[\u3002\uff0c\uff01\uff1f]{2,}/.test(flat.replace(/……|——/g, ''))) add('info', 'D80', '连续重复的标点', o);
    if (/([\uff0c,\u3001\uff1b;\uff1a:])$/.test(flat)) add('warn', 'D80', `消息以「${flat.slice(-1)}」结尾，像是没写完`, o);
  }
  return out;
}

// ---------- D82 阶段通报/提示时间表 ----------
export function phaseTable(model, { keyRe = null, maxMs = 3600000 } = {}) {
  const rows = []; for (const o of triggersOf(model)) { if (o.props.activatedBy) continue; const p = MSGPROPS.find((k) => o.props[k]); if (!p) continue; if (keyRe && !keyRe.test(trigKey(o))) continue; const d = parseTimeFlex(o.props.delay), w = parseTimeFlex(o.props.warmup); const ms = (d && !Number.isNaN(d.ms) ? d.ms : 0) + (w && !Number.isNaN(w.ms) ? w.ms : 0); if (ms > maxMs) continue; rows.push({ key: trigKey(o), at: ms, text: String(o.props[p]).replace(/\n/g, ''), repeat: o.props.repeatDelay ?? null }); }
  return rows.sort((a, b) => a.at - b.at);
}
export function applyPhaseTable(text, rows) { const m = new Map(rows.map((r) => [r.key, r.at])); return mapTriggers(text, (a, p, k) => { if (!m.has(k)) return null; const np = { ...p }; delete np.warmup; np.delay = fmtMs(m.get(k)); return { props: np }; }); }
export function phaseGaps(rows, { maxGapMs = 180000 } = {}) { const out = []; for (let i = 1; i < rows.length; i++) if (rows[i].at - rows[i - 1].at > maxGapMs) out.push({ from: rows[i - 1].key, to: rows[i].key, gapMs: rows[i].at - rows[i - 1].at }); return out; }

// ---------- D84 多语言文本包 ----------
// 导出:key,prop,source,target（空）；导入：把 target 写成 prop_lang（如 globalMessage_en），保留默认文本
export function exportLocaleTemplate(text) {
  const rows = [['key', 'prop', 'source', 'target']]; mapTriggers(text, (a, p, k) => { for (const b of MSGPROPS) if (p[b]) rows.push([k, b, p[b], '']); return null; });
  return rows.map((r) => r.map(csvq).join(',')).join('\n') + '\n';
}
export function importLocale(text, csv, lang) {
  if (!/^[a-zA-Z]{2,5}(-[a-zA-Z]{2})?$/.test(lang)) throw new Error('语言代码形如 en / zh / pt-BR');
  const rows = parseCsvRows(csv).slice(1).filter((r) => r.length >= 4 && r[3]); const map = new Map(rows.map((r) => [r[0] + '\u0000' + r[1], r[3]])); let n = 0;
  const out = mapTriggers(text, (a, p, k) => { let ch = false; const np = { ...p }; for (const b of MSGPROPS) { const v = map.get(k + '\u0000' + b); if (v !== undefined) { np[`${b}_${lang}`] = v; if (p[b + '_textColor'] && !p[`${b}_${lang}_textColor`]) { /* 颜色沿用默认 */ } ch = true; n++; } } return ch ? { props: np } : null; });
  return { ...out, written: n };
}
export function localeCoverage(model, lang) { let total = 0, have = 0; for (const o of triggersOf(model)) for (const b of MSGPROPS) if (o.props[b]) { total++; if (o.props[`${b}_${lang}`]) have++; } return { total, have, pct: total ? Math.round((have / total) * 100) : 100 }; }
