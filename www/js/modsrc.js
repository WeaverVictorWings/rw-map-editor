// 单位源码编辑器（3.1）：边写边检查、键名/选项补全、整理格式。补全列表放在输入框下面，手机上也好点。
import { h } from './ui.js';
import { lintText, completions, formatIni, projectileNames } from './modlogic3.js';

export function srcEditor(u, mod, onChange) {
  const ta = h('textarea', { class: 'me-src', spellcheck: 'false', translate: 'no', autocapitalize: 'off', autocomplete: 'off', value: u.text });
  const diag = h('div', { class: 'me-diag' }), sug = h('div', { class: 'me-sug' });
  const jump = (line) => {
    const ls = ta.value.split('\n'); let pos = 0; for (let i = 0; i < line - 1 && i < ls.length; i++) pos += ls[i].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + (ls[line - 1] || '').length);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18; ta.scrollTop = Math.max(0, (line - 3) * lh);
  };
  const drawDiag = () => {
    const d = lintText(ta.value);
    diag.replaceChildren(d.length ? h('b', {}, d.length + ' 处可能有问题（点一条跳过去）') : h('span', { class: 'hint' }, '没发现格式问题'));
    for (const x of d.slice(0, 30)) diag.append(h('div', { class: 'me-d ' + x.lv, onclick: () => jump(x.line) }, '第 ' + x.line + ' 行：' + x.msg));
  };
  let t1 = 0, items = null;
  const drawSug = () => {
    sug.replaceChildren(); items = null;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const c = completions(ta.value, ta.selectionStart); let list = c.items;
    const pre = ta.value.slice(0, ta.selectionStart), m = /(^|\n)\s*projectile\s*:\s*([^\n]*)$/.exec(pre);
    if (m) { const p = m[2].trim().toLowerCase(); list = projectileNames(mod).filter((n) => n.toLowerCase().startsWith(p) && n.toLowerCase() !== p).map((n) => ({ label: n, insert: n, hint: '本 Mod 的弹道' })); c.from = ta.selectionStart - m[2].trimStart().length; }
    if (!list.length) return;
    items = { c, list };
    for (const it of list.slice(0, 8)) sug.append(h('button', { class: 'me-s', onmousedown: (e) => e.preventDefault(), onclick: () => accept(it) }, it.label, it.hint ? h('small', {}, ' ' + it.hint) : null));
  };
  const accept = (it) => {
    const c = items.c, v = ta.value; ta.value = v.slice(0, c.from) + it.insert + v.slice(ta.selectionStart);
    const p = c.from + it.insert.length; ta.setSelectionRange(p, p); ta.focus(); changed(true);
  };
  const changed = (now) => { u.text = ta.value; u.srcDirty = true; onChange && onChange(); clearTimeout(t1); t1 = setTimeout(drawDiag, now ? 0 : 300); drawSug(); };
  ta.addEventListener('input', () => changed());
  ta.addEventListener('click', drawSug); ta.addEventListener('keyup', (e) => { if (/Arrow|Home|End/.test(e.key)) drawSug(); });
  ta.addEventListener('keydown', (e) => {
    if ((e.key === 'Tab' || e.key === 'Enter') && items && items.list.length && !e.shiftKey && e.key === 'Tab') { e.preventDefault(); accept(items.list[0]); }
    else if (e.key === 'Escape') { sug.replaceChildren(); items = null; }
  });
  const bar = h('div', { class: 'me-bar2' },
    h('button', { onclick: () => { ta.value = formatIni(ta.value); changed(true); } }, '整理格式'),
    h('span', { class: 'hint' }, ' 写键名时下面会出补全，电脑上按 Tab 选第一个。'));
  drawDiag();
  return h('div', { class: 'me-srcwrap' }, bar, ta, sug, diag);
}
