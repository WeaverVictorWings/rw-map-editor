// 队伍颜色与联盟表：自定义队伍颜色、把队伍编成盟友组（只做配色与联盟关系，队伍号检查交给 teamhelp.js）
import { A } from './state.js';
import { h, modal, toast, select, confirmBox } from './ui.js';
import { kvGet, kvSet } from './util.js';
import { HELP, helpBtn } from './help.js';
import { TEAM_COLORS, teamInfo, teamDialog } from './teamhelp.js';

const KEY = 'teamChart';
const STYLE_ID = 'rw-teamchart-css';
const CSS = `
.tc-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.tc-sw{width:26px;height:26px;border-radius:6px;border:1px solid var(--line2);padding:0;background:none;flex:none}
.tc-name{min-width:110px}
.tc-team{font-variant-numeric:tabular-nums}
.tc-grp{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:5px;
  background:var(--bg3);color:var(--muted);font-size:12px;font-weight:700}
`;

function injectCss() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.append(st);
}

const GROUPS = ['A', 'B', 'C', 'D'];

function defaultColor(team) { return TEAM_COLORS[Math.abs(team) % TEAM_COLORS.length][0]; }

async function loadState() {
  let s = null;
  try { s = await kvGet(KEY); } catch (e) { s = null; }
  return {
    colors: (s && s.colors) || {},
    alliances: Array.isArray(s && s.alliances) ? s.alliances.map((g) => [...g].sort((a, b) => a - b)) : [],
  };
}

async function saveState(st) {
  await kvSet(KEY, st);
  return st;
}

// ---------------- 对外 API ----------------
export async function teamChart() {
  const st = await loadState();
  const rows = teamInfo().map((t) => {
    const hex = (st.colors[String(t.team)] || (t.color && t.color[0]) || defaultColor(t.team)).toLowerCase();
    const gi = st.alliances.findIndex((g) => g.includes(t.team));
    return {
      team: t.team, color: hex, defaultColor: defaultColor(t.team),
      label: (TEAM_COLORS.find((c) => c[0].toLowerCase() === hex) || [null, '自定义'])[1],
      spawns: t.spawns, units: t.units,
      alliance: gi >= 0 ? GROUPS[gi] || String(gi + 1) : '',
      allianceIndex: gi,
    };
  });
  const groups = st.alliances.map((g, i) => ({ id: i, label: GROUPS[i] || String(i + 1), teams: g }));
  return { rows, groups };
}

export async function allianceOf(team) {
  const st = await loadState();
  const i = st.alliances.findIndex((g) => g.includes(team));
  return i >= 0 ? GROUPS[i] || String(i + 1) : null;
}

// setAlliance(groups) / setAlliance(a, b, joined)
export async function setAlliance(...args) {
  const st = await loadState();
  if (args.length === 1 && Array.isArray(args[0])) {
    st.alliances = args[0].map((g) => [...new Set(g.filter((t) => Number.isInteger(t) && t >= 0))].sort((a, b) => a - b))
      .filter((g) => g.length > 0);
  } else {
    const [a, b, joined = true] = args;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return st.alliances;
    if (joined) {
      const ga = st.alliances.findIndex((g) => g.includes(a));
      const gb = st.alliances.findIndex((g) => g.includes(b));
      if (ga >= 0 && gb >= 0 && ga !== gb) {
        st.alliances[ga] = [...new Set([...st.alliances[ga], ...st.alliances[gb]])].sort((x, y) => x - y);
        st.alliances.splice(gb, 1);
      } else if (ga >= 0 && gb < 0) st.alliances[ga] = [...new Set([...st.alliances[ga], b])].sort((x, y) => x - y);
      else if (ga < 0 && gb >= 0) st.alliances[gb] = [...new Set([...st.alliances[gb], a])].sort((x, y) => x - y);
      else st.alliances.push([a, b].sort((x, y) => x - y));
    } else {
      const gi = st.alliances.findIndex((g) => g.includes(a) && g.includes(b));
      if (gi >= 0) {
        st.alliances[gi] = st.alliances[gi].filter((t) => t !== a && t !== b);
        if (!st.alliances[gi].length) st.alliances.splice(gi, 1);
      }
    }
  }
  await saveState(st);
  return st.alliances;
}

export async function setTeamColor(team, hex) {
  const st = await loadState();
  const h2 = String(hex || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(h2)) st.colors[String(team)] = h2;
  else delete st.colors[String(team)];
  await saveState(st);
  return h2;
}

// ---------------- 对话框 ----------------
export async function teamChartDialog() {
  injectCss();
  const state = await loadState();
  const rowsEl = h('div', {});
  const groupsEl = h('div', { class: 'hint' });
  let rows = [];

  const persist = async () => { await saveState(state); };
  const groupOptions = (cur) => {
    const opts = [['', '无'], ...state.alliances.map((g, i) => [GROUPS[i] || String(i + 1), `组 ${GROUPS[i] || i + 1}`]), ['new', '新建一组']];
    return opts.map(([v, l]) => [v, l]);
  };

  const render = () => {
    rowsEl.replaceChildren();
    rows = teamInfo();
    for (const t of rows) {
      const hex = state.colors[String(t.team)] || t.color[0];
      const gi = state.alliances.findIndex((g) => g.includes(t.team));
      const giShown = gi >= 0 && gi < GROUPS.length ? gi : -1;
      const sw = h('input', {
        class: 'tc-sw', type: 'color', value: hex, title: '队伍颜色',
        oninput: async (e) => { state.colors[String(t.team)] = e.target.value; await persist(); },
      });
      const sel = select(groupOptions(giShown >= 0 ? GROUPS[giShown] : ''), giShown >= 0 ? GROUPS[giShown] : '', async (v) => {
        if (v === 'new') {
          if (state.alliances.length >= GROUPS.length) { toast('最多四组联盟'); return; }
          const others = state.alliances.filter((x) => !x.includes(t.team));
          state.alliances = [...others, [t.team]];
          await persist(); render(); return;
        }
        state.alliances = state.alliances.map((g) => g.filter((x) => x !== t.team));
        if (v) {
          const idx = GROUPS.indexOf(v);
          if (idx >= 0) {
            if (!state.alliances[idx]) state.alliances[idx] = [];
            state.alliances[idx] = [...new Set([...state.alliances[idx], t.team])].sort((a, b) => a - b);
          }
        }
        state.alliances = state.alliances.filter((g) => g.length);
        await persist(); render();
      }, { style: 'width:96px' });
      rowsEl.append(h('div', { class: 'tc-row' },
        sw,
        h('b', { class: 'tc-team', style: 'min-width:64px' }, `第 ${t.team} 队`),
        h('span', { class: 'hint', style: 'flex:1;min-width:120px' }, `${t.spawns} 出生点 · ${t.units} 单位`),
        h('span', { class: 'hint' }, '盟友'),
        sel,
        t.spawns ? h('button', {
          class: 'ib', title: '跳到出生点',
          onclick: () => A.rend.centerOn(t.x / 20 - 0.5, t.y / 20 - 0.5),
        }, '定位') : null));
    }
    groupsEl.textContent = state.alliances.length
      ? `联盟：${state.alliances.map((g, i) => `组 ${GROUPS[i] || i + 1}：第 ${g.join('、')} 队`).join('；')}`
      : '还没有联盟组：从上面的“盟友”下拉选“新建一组”。';
  };

  const body = h('div', {},
    h('div', { class: 'row' }, h('p', { style: 'margin:0;flex:1' }, '给每个队伍挑颜色、把队伍编成盟友组（同一组在地图上视为盟友）。'), helpBtn('tool.teamchart')),
    rowsEl,
    h('div', { style: 'margin-top:10px' }, groupsEl),
    h('div', { class: 'hint', style: 'margin-top:10px' }, '队伍号检查（缺号、重复出生点、只有一队）用「队伍与阵营助手」；这里只管颜色和联盟关系。'),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { onclick: () => teamDialog() }, '打开队伍与阵营助手'),
      h('button', { onclick: async () => {
        if (!(await confirmBox('恢复默认颜色', '把所有队伍颜色改回默认配色？联盟组保留。', '恢复', '取消'))) return;
        state.colors = {};
        await persist(); render(); toast('颜色已恢复默认');
      } }, '颜色恢复默认'))
  );

  render();
  await modal('队伍颜色与联盟', body, [{ label: '关闭', primary: true, value: 'ok' }], { wide: true });
  return teamChart();
}

Object.assign(HELP, {
  'tool.teamchart': {
    t: '队伍颜色与联盟',
    s: '自定义队伍配色、编盟友组',
    b: '给每个队伍指定颜色，或者把几个队伍编成同一联盟组。联盟组只存在编辑器里，方便你按“2v2 / 3v3”的思路规划，不会自动改进地图文件。队伍号检查交给「队伍与阵营助手」。',
    tips: ['颜色存在本机，导入导出设置时会一起走。', '联盟组按 A、B、C、D 排，最多四组。'],
  },
});
