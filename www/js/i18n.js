// 界面多语言：源文字是中文，按中文原文查词典（js/i18n/<lang>.js）。
// 不改业务代码：用 MutationObserver 把页面上出现的中文文字、title、placeholder 换成当前语言。
// 查不到整句时：先把数字换成 # 再查，再按已知片段逐段替换；都查不到就保持中文。
export const LANGS = [
  ['zh', '简体中文'], ['en', 'English'], ['ru', 'Русский'], ['pt', 'Português (BR)'], ['es', 'Español'],
  ['id', 'Bahasa Indonesia'], ['tr', 'Türkçe'], ['zht', '繁體中文'], ['uk', 'Українська'], ['fr', 'Français'], ['ja', '日本語'],
];
const CJK = /[一-鿿]/;
const ATTRS = ['title', 'placeholder', 'aria-label'];
let D = null, lang = 'zh', multiRe = null, singleRe = null, spaced = true;
const cache = new Map();

export function detectLang() {
  const ls = (navigator.languages && navigator.languages[0]) || navigator.language || 'zh';
  const l = ls.toLowerCase();
  if (/^zh-(tw|hk|mo)|hant/.test(l)) return 'zht';
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('in') || l.startsWith('id') || l.startsWith('ms')) return 'id'; // 安卓老版本把印尼语报成 in
  if (l.startsWith('pt')) return 'pt';
  for (const [k] of LANGS) if (l.startsWith(k)) return k;
  return 'en';
}
export function getLang() { return lang; }
export function savedLang() { try { return localStorage.getItem('rwLang'); } catch { return null; } }
export function setLang(l) { try { localStorage.setItem('rwLang', l); } catch { /* 无痕模式 */ } }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export async function initI18n() {
  lang = savedLang() || detectLang();
  if (!LANGS.some(([k]) => k === lang)) lang = 'en';
  document.documentElement.lang = { zh: 'zh-CN', zht: 'zh-TW', pt: 'pt-BR' }[lang] || lang;
  if (lang === 'zh') return;
  try {
    const own = (await import(`./i18n/${lang}.js`)).default;
    // 没翻译到的句子先用英文顶上（繁中本身是全量的，不需要）
    const base = lang === 'en' || lang === 'zht' ? {} : (await import('./i18n/en.js')).default;
    D = Object.assign({}, base, own);
  } catch (e) { console.warn('i18n load failed', e); return; }
  spaced = !['ja', 'zht'].includes(lang);
  const keys = Object.keys(D);
  multiRe = new RegExp(keys.filter((k) => k.length > 1).sort((a, b) => b.length - a.length).map(esc).join('|'), 'g');
  const singles = keys.filter((k) => k.length === 1 && CJK.test(k));
  // 单个汉字只在两边都不是汉字时才替换（“第 3 队”里的“第”“队”），免得把别的词拆碎
  singleRe = singles.length ? new RegExp(`(^|[^\\u4e00-\\u9fff])(${singles.map(esc).join('|')})(?=[^\\u4e00-\\u9fff]|$)`, 'g') : null;
  window.__rwT = t;
  document.title = t(document.title);
  apply(document.body);
  new MutationObserver(onMut).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

const join = (before, word, after) => {
  if (!spaced) return word;
  let w = word;
  if (before && /[\p{L}\p{N}]$/u.test(before) && /^[\p{L}\p{N}]/u.test(w)) w = ' ' + w;
  if (after && /^[\p{L}\p{N}(]/u.test(after) && /[\p{L}\p{N}]$/u.test(w)) w = w + ' ';
  return w;
};
function tr(s) {
  const lead = s.match(/^\s*/)[0], trail = s.slice(lead.length).match(/\s*$/)[0], core = s.trim();
  let v = D[core];
  if (v !== undefined) return lead + v + trail;
  const nums = [];
  const norm = core.replace(/\d+(?:\.\d+)?/g, (m) => { nums.push(m); return '#'; });
  if (nums.length && (v = D[norm]) !== undefined) { let i = 0; return lead + v.replace(/#/g, () => nums[i++] ?? '#') + trail; }
  let out = core.replace(multiRe, (m, off, str) => join(str.slice(0, off), D[m], str.slice(off + m.length)));
  if (singleRe) out = out.replace(singleRe, (m, pre, ch, off, str) => pre + join(str.slice(0, off + pre.length), D[ch], str.slice(off + m.length)));
  if (spaced) out = out.replace(/ {2,}/g, ' ').replace(lang === 'fr' ? / ([,.)])/g : / ([,.:;!?)，。：）])/g, '$1');
  return lead + out.trim() + trail;
}
export function t(s) {
  if (!D || typeof s !== 'string' || !CJK.test(s)) return s;
  let r = cache.get(s);
  if (r === undefined) { r = tr(s); if (cache.size > 30000) cache.clear(); cache.set(s, r); }
  return r;
}

const done = new WeakMap(); // 节点 → 上次写进去的译文，避免自己触发自己
const skip = (el) => el && el.closest && el.closest('[translate="no"],textarea,script,style,[contenteditable="true"]');
function doText(n) {
  const v = n.data;
  if (!CJK.test(v) || done.get(n) === v || skip(n.parentElement)) return;
  const r = t(v);
  done.set(n, r);
  if (r !== v) n.data = r;
}
function doAttrs(el) {
  if (skip(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v || !CJK.test(v)) continue;
    let mem = done.get(el); if (!mem) done.set(el, (mem = {}));
    if (mem[a] === v) continue;
    const r = t(v); mem[a] = r;
    if (r !== v) el.setAttribute(a, r);
  }
}
function apply(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  doAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
}
function onMut(list) {
  for (const m of list) {
    if (m.type === 'childList') m.addedNodes.forEach(apply);
    else if (m.type === 'characterData') doText(m.target);
    else if (m.type === 'attributes') doAttrs(m.target);
  }
}
