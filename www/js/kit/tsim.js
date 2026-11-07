// RWKit · 触发器运行模型(按 triggers_spec.md §2 的真实判定规则;250ms 一刻)。
// 能"打掉指挥中心 / 让刷出失败 / 改队伍",用来在交付前真正跑一遍夺城链、开局是否刷屏。
import { triggersOf, unitsOf, trigKey } from './tmx.js';
import { tms } from './schema.js';
const TICK = 250;
const L = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const has = (v) => v !== undefined && v !== '';
export class Sim {
  constructor(model) {
    this.ts = triggersOf(model).filter((o) => ['unitdetect', 'unitadd', 'basic', 'maptext', 'changecredits'].includes(o.type.toLowerCase())).map((o) => {
      const p = o.props; const t = { o, name: trigKey(o), type: o.type.toLowerCase(), x: o.x, y: o.y, w: o.w, h: o.h, p, ab: L(p.activatedBy).concat(L(p.whenActivatedIds)), db: L(p.deactivatedBy), all: /^true$/i.test(p.allToActivate || ''), delay: tms(p.delay), warm: tms(p.warmup) || 0, reset: tms(p.resetActivationAfter), rep: tms(p.repeatDelay), team: has(p.team) ? +p.team : null, msg: p.globalMessage, active: false, last: -1e12, since: null, fires: 0 };
      t.gate = t.delay === null; return t;
    });
    this.by = new Map(); for (const t of this.ts) { if (!this.by.has(t.name)) this.by.set(t.name, []); this.by.get(t.name).push(t); }
    for (const t of this.ts) for (const r of L(t.p.alsoActivate)) for (const y of this.by.get(r) || []) y.ab.push(t.name);   // alsoActivate = 反向 activatedBy
    this.units = unitsOf(model).filter((o) => o.props.unit).map((o) => ({ type: o.props.unit, team: +(o.props.team ?? 0), x: o.x + 10, y: o.y + 10 }));
    this.log = []; this.now = 0; this.spawnFail = 0; this.spawned = new Map(); this.credits = new Map();
  }
  count(t) { const ut = t.p.unitType || ''; let n = 0; for (const u of this.units) { if (ut && u.type !== ut) continue; if (t.team !== null && u.team !== t.team) continue; if (t.x <= u.x && u.x < t.x + t.w && t.y <= u.y && u.y < t.y + t.h) n++; } return n; }
  src(t) {
    let ok = 0, bad = 0;
    if (!t.gate) { if (this.now >= t.delay) { ok++; t.gate = true; } else bad++; }
    if (t.ab.length) { const act = t.ab.map((n) => (this.by.get(n) || []).some((a) => a.active)); if (t.all) { const a = act.every(Boolean); ok += +a; bad += +!a; } else { const a = act.some(Boolean); ok += +a; bad += +!a; } }
    if (t.type === 'unitdetect') {
      const mxs = t.p.maxUnits, mns = t.p.minUnits; const mx = has(mxs) ? +mxs : 1e9; const mn = has(mns) ? +mns : (has(mxs) ? 0 : 1); const n = this.count(t);
      if (n >= mn && n <= mx && t.w > 0 && t.h > 0) ok++; else bad++;
    }
    return [ok, bad];
  }
  met(t) { const [ok, bad] = this.src(t); return t.all ? ok > 0 && bad === 0 : ok > 0 || bad === 0; }
  fire(t) {
    t.fires++; t.active = true; t.last = this.now;
    if (t.msg) this.log.push({ t: this.now / 1000, name: t.name, msg: t.msg });
    if (t.type === 'unitadd' && has(t.p.spawnUnits) && t.p.spawnUnits !== 'NONE') {
      if (this.spawnFail > 0) { this.spawnFail--; this.log.push({ t: this.now / 1000, name: t.name, msg: '<<刷出失败(被挡住)>>' }); return; }
      const tm = has(t.p.team) ? +t.p.team : 0;
      for (const part of t.p.spawnUnits.split(',')) { const q = part.trim(); const nm = q.split('*')[0].split('(')[0].trim(); const n = q.includes('*') ? +q.split('*')[1].split('(')[0] : 1; const k = t.name + '|' + nm; this.spawned.set(k, (this.spawned.get(k) || 0) + n); if (nm === 'commandCenter') { this.units.push({ type: nm, team: tm, x: t.x + t.w / 2, y: t.y + t.h / 2 }); this.log.push({ t: this.now / 1000, name: t.name, msg: `<<刷出指挥中心 team${tm}>>` }); } }
    }
    if (t.type === 'changecredits') this.credits.set(t.team, (this.credits.get(t.team) || 0) + +(t.p.add || 0));
  }
  step() {
    for (const t of this.ts) {
      if (t.active && t.reset !== null && this.now >= t.last + t.reset) t.active = false;
      let go = false;
      if (!t.active) { if (this.met(t)) { if (t.since === null) t.since = this.now; go = this.now - t.since >= t.warm; } else t.since = null; } else t.since = null;
      if (t.db.some((n) => (this.by.get(n) || []).some((a) => a.active))) { t.active = false; go = false; t.gate = true; }
      if (go) this.fire(t); else if (t.active && t.rep && this.now >= t.last + t.rep) this.fire(t);
    }
    this.now += TICK;
  }
  run(upto, events = []) { const ev = [...events].sort((a, b) => a[0] - b[0]); let i = 0; while (this.now <= upto * 1000) { while (i < ev.length && ev[i][0] * 1000 <= this.now) ev[i++][1](this); this.step(); } return this; }
  // —— 场景工具 ——
  ccAt(x, y, r = 40) { return this.units.filter((u) => u.type === 'commandCenter' && Math.hypot(u.x - x, u.y - y) < r); }
  destroy(x, y) { this.units = this.units.filter((u) => !(u.type === 'commandCenter' && Math.hypot(u.x - x, u.y - y) < 40)); }
  capture(x, y, team) { for (const u of this.ccAt(x, y)) u.team = team; }
}
// 开局自检:前 N 秒有多少条消息(刷屏)、有没有触发器误触发
export function openingCheck(model, secs = 20) {
  const s = new Sim(model).run(secs); const msgs = s.log.filter((l) => !l.msg.startsWith('<<'));
  const unexpected = s.ts.filter((t) => t.fires > 0 && t.type !== 'maptext' && t.type !== 'unitdetect' && t.type !== 'basic').map((t) => t.name);
  return { messages: msgs.length, list: msgs.slice(0, 20), firedActions: unexpected, sim: s };
}
// 夺城场景:打掉某座城的 CC → 等刷中立 → 某队占领 → 看战报
export function captureScenario(model, { x, y, team, killAt = 5, capAt = 30, until = 80, spawnFail = 0 }) {
  const s = new Sim(model); s.spawnFail = spawnFail;
  s.run(until, [[killAt, (w) => w.destroy(x, y)], [capAt, (w) => w.capture(x, y, team)]]);
  return s;
}
