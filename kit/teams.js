// RWKit · 队伍编号/颜色/互换。游戏里队伍颜色由编号决定(0号蓝?以编辑器为准),这里用编辑器同一份色表。
export const SLOT_COL = ['#36c25b', '#e5484d', '#3e8ef7', '#f5c518', '#00bcd4', '#b36cf0', '#2b2b2b', '#ffffff', '#ff8c1a', '#8bc34a'];
export const slotColor = (n) => n < 0 ? '#888888' : n < SLOT_COL.length ? SLOT_COL[n] : `(编号 ${n}:编辑器按哈希生成,未在游戏内核对)`;
// 把全部 team 值按 perm(旧→新)重排:单位、触发器、队伍信息都改。只动 name="team" 的属性和 team_N 形式的 map 属性。
export function remapTeams(text, perm) {
  const P = (n) => (n >= 0 && perm[n] !== undefined ? perm[n] : n);
  let t = text.replace(/(<property\s+name="team"\s+value=")(-?\d+)(")/g, (_, a, n, c) => a + P(+n) + c);
  t = t.replace(/(<property\s+name="(?:team|teamTag)_?)(\d+)(_[^"]*"|")/g, (m, a, n, c) => a + P(+n) + c);
  return t;
}
export function swapTeams(text, a, b) { const n = Math.max(a, b) + 1; const perm = Array.from({ length: Math.max(n, 32) }, (_, i) => i); perm[a] = b; perm[b] = a; return remapTeams(text, perm); }
export function teamUsage(model) {
  const u = new Map(); for (const o of model.objects) if (o.props.team !== undefined && /^-?\d+$/.test(o.props.team)) { const k = +o.props.team; const e = u.get(k) || { units: 0, triggers: 0 }; if (o.props.unit !== undefined) e.units++; else e.triggers++; u.set(k, e); }
  return u;
}
// 检查:每个势力队伍是否都有指挥中心;队伍编号是否连续、有无空号
export function checkTeams(model, { expect, capitals = true } = {}) {
  const out = []; const u = teamUsage(model); const nums = [...u.keys()].filter((n) => n >= 0).sort((a, b) => a - b);
  const cc = new Map(); for (const o of model.objects) if (o.props.unit === 'commandCenter') cc.set(+o.props.team, (cc.get(+o.props.team) || 0) + 1);
  if (expect !== undefined && nums.length && Math.max(...nums) + 1 > expect) out.push({ sev: 'error', code: 'D01', msg: `用到了 ${Math.max(...nums)} 号队,但规则只允许 ${expect} 支队伍` });
  for (let i = 0; i < (nums.at(-1) ?? -1); i++) if (!u.has(i)) out.push({ sev: 'warn', code: 'D02', msg: `队伍编号 ${i} 空缺` });
  if (capitals) for (const n of nums) if (!cc.get(n)) out.push({ sev: 'warn', code: 'D03', msg: `${n} 号队没有任何指挥中心(开局即败?)` });
  return out;
}
