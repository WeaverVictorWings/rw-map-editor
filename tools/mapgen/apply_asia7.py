# -*- coding: utf-8 -*-
# 把 asia_text7 的文本套进 v0.6,得到 v0.7(地形、单位、触发结构不动;只改文字、颜色、消息链长度)
import sys, re, json, random
sys.path.insert(0, '/home/claude/rw-map-editor/tools/mapgen'); sys.path.insert(0, '/home/claude/wg')
from tmxtext import Tmx, reflow, secs_for
import asia_text7 as X
import asia_spec as spec

SRC = '/home/claude/wg/out/大亚洲战争_v0.6.tmx'
DST = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/wg/out3/大亚洲战争_v0.7.tmx'
NAT = {s: v['zh'] for s, v in spec.SEATS.items()}
CAMP = {s: ('A' if s % 2 else 'B') for s in NAT}
DISP = {s: ('中国' if s in (1, 3, 5, 7, 9) else NAT[s]) for s in NAT}
CAMPN = spec.CAMPN
COL = {'A': X.RED, 'B': X.BLUE}
cities = json.load(open('/home/claude/wg/out/asia_cities.json'))

T = Tmx(SRC)

# ---- 1. 颜色:红蓝对调(含势名标签 textColor、所有消息)----
SW = {'#6FB4FF': '#FF6A5A', '#FF6A5A': '#6FB4FF'}
pat = re.compile('#6FB4FF|#FF6A5A', re.I)
for p in T.parts:
    if hasattr(p, 'seg'):
        p.seg = pat.sub(lambda m: SW[m.group(0).upper()], p.seg)


def order(prefix, first_act):
    """按 activatedBy 串出一条消息链(以 prefix 开头的消息触发器)"""
    objs = [o for k, o in T.by.items() if k.startswith(prefix) and o.get('globalMessage') is not None]
    names = {o.name for o in objs}
    start = [o for o in objs if o.get('activatedBy') not in names]
    assert len(start) == 1, (prefix, [o.name for o in start])
    seq = [start[0]]
    while True:
        nx = [o for o in objs if o.get('activatedBy') == seq[-1].name]
        if not nx: break
        assert len(nx) == 1, (prefix, [o.name for o in nx])
        seq.append(nx[0])
    assert len(seq) == len(objs), (prefix, len(seq), len(objs))
    return [o.name for o in seq]


stat = {'灭': 0, '陷': 0, '占': 0, '国': 0}
# ---- 2. 覆灭 / 首府陷落 ----
for s in NAT:
    nm = order(f'灭{s}报', None)
    head = T.msg(nm[0]).get('globalMessage').replace('\n', '')
    T.chain(nm, [head] + X.DEAD[s]); stat['灭'] += 1
    nm = order(f'陷{s}报', None)
    head = T.msg(nm[0]).get('globalMessage').replace('\n', '')
    T.chain(nm, [head] + [t.replace('{O}', '对方') for t in X.FALL[s]]); stat['陷'] += 1

# ---- 3. 城市易手(三条链:标题 / 正文 / 余波) ----
for ci, q in enumerate(cities):
    for t in range(20):
        h = f'占{ci}_{t}讯'
        if T.msg(h) is None: continue
        s_ = t + 1; own = q['owner']
        if own < 0: kk, fm = 'neutral', dict(A=DISP[s_], C=q['zh'], O='')
        elif t == own: kk, fm = 'back', dict(A=DISP[s_], C=q['zh'], O='')
        elif CAMP[s_] == CAMP[own + 1]:
            same = DISP[s_] == DISP[own + 1]
            fm = dict(A=NAT[s_] if same else DISP[s_], O=NAT[own + 1] if same else DISP[own + 1], C=q['zh']); kk = 'ally'
        else: kk, fm = 'enemy', dict(A=DISP[s_], O=DISP[own + 1], C=q['zh'])
        r = random.Random(ci * 131 + t * 17 + 5)
        fm['T'] = r.choice(X.TOUCH.get(fm['O'] or DISP.get(own + 1, ''), ['街头的收音机'])) if fm['O'] else ''
        heads = X.HEAD[kk]; h_ = heads[(ci + t) % len(heads)].format(**fm)
        pool = [b for tag, b in X.BODY[kk] if tag == 'any' or tag == ('port' if q.get('port') else 'inland')]
        b_ = r.choice(pool).format(**fm)
        c_ = r.choice(X.CODA[kk]).format(**fm)
        T.chain([h, h + '2', h + '3'], [h_, b_, c_]); stat['占'] += 1

# ---- 4. 势力里程碑 ----
for s in NAT:
    for k in range(3):
        o = T.msg(f'国{s}_{k}讯')
        m = int(T.by[f'国{s}_{k}'].get('minUnits'))
        tx = X.MILE[k][(s + k) % 4].format(N=DISP[s], m=m, p=max(m - 3, 1))
        T.set(f'国{s}_{k}讯', tx); stat['国'] += 1

# ---- 5. 开场 / 战局 / 提示 / 守报 / 终 ----
d = 3
for i, (tx, c) in enumerate(X.INTRO):
    T.set(f'开场{i + 1}', tx, c); T.msg(f'开场{i + 1}').set('delay', f'{d}s')
    d += secs_for(tx) + 1
for i, tx in enumerate(X.PHASE):
    T.set(f'战局{i + 1}', tx, X.GOLD)
for n, o in list(T.by.items()):
    if n.startswith('提示') and o.get('globalMessage') is not None:
        T.set(n, o.get('globalMessage').replace('\n', ''))
HOLD = {
    0: '【{C}·十城在手】十座代表城市已全部在手,三分钟倒计时开始。任何一座失守,计时重来。',
    1: '【前线记者】守住了一分钟。对面的电台还在呼叫,只是呼号换成了更急的语气。',
    2: '【参谋日记】两分钟。我盯着秒针,它走得比平时慢。再守一分钟,仗就打完了。',
    3: '【最后十秒】一步也不要退。后来的教科书会写:最长的一分钟,发生在这里。',
}
END = {
    1: '【{C}胜利】十座代表城市尽在掌握,倒计时归零。',
    3: '【对方参谋部·最后一份电报】“……对方已守满三分钟。我部无力再战,请求停火。”电文末尾没有署名。',
    4: '【事后补记】谈判桌已经摆好。据说双方都带了茶,谁也没有喝。',
}
for ab in 'AB':
    for i in range(4):
        T.set(f'守报{ab}{i}', HOLD[i].format(C=CAMPN[ab]), COL[ab])
    for i in (1, 3, 4):
        T.set(f'终{ab}{i}', END[i].format(C=CAMPN[ab]), COL[ab])
    T.set(f'终{ab}2', T.msg(f'终{ab}2').get('globalMessage').replace('\n', ''), COL[ab])
    T.set(f'尾{ab}0', T.msg(f'尾{ab}0').get('globalMessage').replace('\n', ''), X.GOLD)

# 终X2 的 warmup 要等前一条读完
for ab in 'AB':
    for i in (2, 3, 4):
        T.msg(f'终{ab}{i}').set('warmup', f'{secs_for(T.msg(f"终{ab}{i-1}").get("globalMessage"))}s')
    T.msg(f'尾{ab}0').set('warmup', f'{secs_for(T.msg(f"终{ab}4").get("globalMessage")) + 2}s')

import os
os.makedirs(os.path.dirname(DST), exist_ok=True)
T.save(DST)
print(stat, DST)
